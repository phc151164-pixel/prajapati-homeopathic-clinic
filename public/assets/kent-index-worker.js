'use strict';

const maxFileBytes = 16 * 1024 * 1024;
const maxExpandedBytes = 192 * 1024 * 1024;
const maxRubrics = 80000;
let account, file, rubrics;
let requests = Promise.resolve();

const normalize = text => text.toLowerCase().replace(/œ/g, 'oe')
  .normalize('NFD').replace(/([a-z])\p{M}+/gu, '$1').normalize('NFC');

async function* rows(blob) {
  const reader = blob.stream().pipeThrough(new DecompressionStream('gzip')).getReader();
  const decoder = new TextDecoder('utf-8', {fatal: true});
  let tail = '';
  let bytes = 0;
  try {
    for (;;) {
      const {done, value} = await reader.read();
      if (value) bytes += value.byteLength;
      if (bytes > maxExpandedBytes) throw Error('The expanded Kent index is too large.');
      const lines = (tail + (done ? decoder.decode() : decoder.decode(value, {stream: true}))).split('\n');
      tail = lines.pop();
      if (tail.length > 1000000) throw Error('The Kent index contains an oversized record.');
      for (const line of lines) if (line.trim()) yield JSON.parse(line);
      if (done) break;
    }
    if (tail.trim()) yield JSON.parse(tail);
  } finally {
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

async function index(blob) {
  if (!blob?.size || blob.size > maxFileBytes) throw Error('Choose the Kent JSONL.GZ file under 16 MB.');
  const result = new Map();
  let metadata, summary;
  for await (const row of rows(blob)) {
    if (row.type === 'metadata') metadata = row;
    if (row.type === 'summary') summary = row;
    if (row.type !== 'rubricCandidate') continue;
    if (result.size >= maxRubrics || !/^kent-p\d+-r\d+$/.test(row.id) || result.has(row.id) ||
        !Number.isInteger(row.pdfPage) || row.pdfPage < 1 ||
        typeof row.chapterHint !== 'string' || !Array.isArray(row.pathCandidate) ||
        !row.pathCandidate.length || row.pathCandidate.some(part => typeof part !== 'string') ||
        row.hierarchyNeedsReview !== false || !Array.isArray(row.entries) || !Array.isArray(row.sourceLines)) {
      throw Error('Choose the reconciled Kent index with verified rubric paths.');
    }
    for (const entry of row.entries) {
      if (entry.kind === 'rubricTextFragment') continue;
      if (typeof entry.sourceName !== 'string' || !entry.sourceName.trim() ||
          typeof entry.abbreviation !== 'string' || ![null, 1, 2, 3].includes(entry.grade)) {
        throw Error('The Kent index contains an invalid historical medicine entry.');
      }
    }
    const label = [row.chapterHint, ...row.pathCandidate].join(' → ');
    const rubric = {id: row.id, label, chapter: row.chapterHint, page: row.pdfPage};
    const title = row.pathCandidate.map(part => part.replace(/\([^)]*\)/gu, '')).join(' ');
    result.set(row.id, {
      rubric,
      words: normalize(label),
      title: normalize(title),
      chapter: normalize(row.chapterHint)
    });
  }
  if (!result.size || !metadata?.nameReconciliation || summary?.candidates !== result.size) {
    throw Error('Choose the reconciled Kent JSONL.GZ file.');
  }
  return result;
}

async function storage(mode, blob) {
  const database = await new Promise((resolve, reject) => {
    const request = indexedDB.open('phc-kent-reference', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('indexes');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  try {
    return await new Promise((resolve, reject) => {
      const transaction = database.transaction('indexes', mode);
      const store = transaction.objectStore('indexes');
      const request = blob ? store.put(blob, account) : store.get(account);
      transaction.oncomplete = () => resolve(request.result);
      transaction.onabort = () => reject(transaction.error);
    });
  } finally {
    database.close();
  }
}

function search(queries) {
  return queries.map(({query, chapter: preferredChapter, limit}) => {
    const chapterFilter = preferredChapter ? normalize(preferredChapter) : '';
    const terms = [...new Set(normalize(query).match(/[\p{L}\p{M}\d]+/gu) || [])];
    if (!terms.length || !rubrics) return {total: 0, matches: []};
    const matches = [];
    for (const {rubric, words, title, chapter} of rubrics.values()) {
      if (chapterFilter && chapter !== chapterFilter) continue;
      const searchable = chapterFilter ? chapter + ' ' + title : words;
      if (!terms.every(term => searchable.includes(term))) continue;
      const relevance = terms.reduce((score, term) =>
        score + (chapter === term ? 4 : title.includes(term) ? 2 : 0), 0);
      matches.push({rubric, relevance});
    }
    matches.sort((a, b) => b.relevance - a.relevance || a.rubric.label.length - b.rubric.label.length);
    return {total: matches.length, matches: matches.slice(0, limit).map(({rubric}) => rubric)};
  });
}

async function details(id) {
  if (!rubrics?.has(id)) throw Error('The rubric is unavailable in the private index.');
  for await (const row of rows(file)) {
    if (row.id !== id) continue;
    const medicines = row.entries.filter(entry => entry.kind !== 'rubricTextFragment')
      .map(entry => ({
        abbreviation: entry.abbreviation, name: entry.sourceName, grade: entry.grade,
        type: 'Kent PDF'
      }));
    return {medicines, sourceLines: row.sourceLines};
  }
  throw Error('The source rubric could not be read.');
}

async function handle(message) {
  switch (message.action) {
    case 'open': {
      account = message.account;
      rubrics = undefined;
      file = await storage('readonly');
      if (file) rubrics = await index(file);
      return {count: rubrics?.size || 0};
    }
    case 'import': {
      const next = await index(message.file);
      await storage('readwrite', message.file);
      file = message.file;
      rubrics = next;
      return {count: rubrics.size};
    }
    case 'search': return search(message.queries);
    case 'details': return details(message.rubricId);
    default: throw Error('Unknown Kent index operation.');
  }
}
self.onmessage = ({data}) => {
  requests = requests.then(async () => {
    try {
      self.postMessage({id: data.id, result: await handle(data)});
    } catch (error) {
      self.postMessage({id: data.id, error: error.message || 'The private Kent file could not be read.'});
    }
  });
};
