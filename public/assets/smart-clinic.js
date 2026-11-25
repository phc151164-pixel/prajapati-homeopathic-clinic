(() => {
  'use strict';

  const endpoint = 'smart-clinic';
  const aliases = {
    bonninghausen: 'bonninghausen boenninghausen repertory repertori lakshan',
    'boericke-pocket-manual': 'boericke borik borick repertory बोरिक',
    boger: 'boger repertory repertori lakshan',
    organon: 'organon hahnemann itihas',
    jahr: 'jahr yaar itihas',
    'allen-keynotes': 'allen keynotes keynote alan elan allen ki keynotes एलन कीनोट',
    'hahnemann-chronic-diseases': 'hahnemann chronic diseases purani bimari itihas पुरानी बीमारी',
    'materia-medica-pura': 'materia medica aushadhi aushadhiya औषधि'
  };
  const normalize = text => text.normalize('NFC').toLowerCase().replace(/œ/g, 'oe')
    .normalize('NFD').replace(/([a-z])\p{M}+/gu, '$1').normalize('NFC');
  const matches = (book, query) => {
    const searchable = normalize([book.title, book.title_hi, book.author, book.category,
      book.category === 'Repertory' ? 'रिपर्टरी' : '', aliases[book.id]].join(' '));
    return normalize(query).trim().split(/\s+/u).every(term => searchable.includes(term));
  };
  const matchesRubric = (rubric, query) => {
    const searchable = normalize([rubric.chapter, ...rubric.path, rubric.aliases].join(' '));
    return normalize(query).trim().split(/\s+/u).every(term => searchable.includes(term));
  };
  const pageLabel = page => typeof page === 'number' ? 'printed page ' + page : page;
  const chartLabels = new Map([
    ['chief complaint', 'Chief complaint'], ['मुख्य शिकायत', 'Chief complaint'],
    ['duration', 'Duration'], ['अवधि', 'Duration'],
    ['patient history', 'Patient history'], ['मरीज का इतिहास', 'Patient history']
  ]);
  const classicalHeadings = [
    'Chief complaint', 'Onset and duration', 'Location and sensation',
    'Aggravating and relieving factors', 'Accompanying symptoms',
    'Sleep, appetite and thirst', 'Patient-reported mood or stress',
    'Past and family history', 'Current medicines and allergies'
  ];
  function draftChart(transcript) {
    return transcript.split(/\n/u).map(line => {
      const label = line.match(/^\s*([^:：]+)[:：]\s*(.+)$/u);
      const heading = label && chartLabels.get(normalize(label[1]).trim());
      return heading ? heading + ': ' + label[2].trim() : line;
    }).join('\n');
  }
  function matchesKeynote(entry, query) {
    const name = normalize([entry.title, entry.aliases || ''].join(' ')).replace(/æ/g, 'ae');
    return normalize(query).replace(/æ/g, 'ae').trim().split(/\s+/u).every(term => name.includes(term));
  }
  if (typeof module !== 'undefined') {
    module.exports = {matches, matchesRubric, draftChart, matchesKeynote};
    return;
  }

  let disposeLibrary = () => {};
  let stopDictation = () => {};
  let disposeRecording = () => {};
  let consultationRequest = 0;
  const node = (tag, text) => {
    const element = document.createElement(tag);
    if (text !== undefined) element.textContent = text;
    return element;
  };
  const action = (text, click) => {
    const element = node('button', text);
    element.type = 'button';
    element.className = 'secondary';
    element.addEventListener('click', click);
    return element;
  };
  function card(title) {
    const element = node('section');
    element.className = 'card';
    element.append(node('h2', title));
    return element;
  }

  async function library(container, api) {
    const root = node('div');
    container.replaceChildren(root);
    let closed = false;
    disposeLibrary = () => { closed = true; };
    const state = node('p', 'Loading catalogue…');
    state.setAttribute('role', 'status');
    root.append(state);
    let data;
    try {
      data = await api(endpoint + '?section=library');
    } catch (error) {
      if (!closed) state.textContent = error.message;
      return;
    }
    if (closed) return;
    const progress = new Map(data.progress.map(item => [item.book_id, item]));
    const filters = card('Historical book catalogue');
    const search = node('input');
    search.type = 'search';
    search.placeholder = 'Boger, रिपर्टरी, aushadhi…';
    const label = node('label', 'Search titles and authors / शीर्षक और लेखक खोजें');
    label.append(search);
    const category = node('select');
    for (const name of ['All categories', 'Repertory', 'Materia Medica', 'History']) {
      category.append(node('option', name));
    }
    const categoryLabel = node('label', 'Category');
    categoryLabel.append(category);
    const mode = node('select');
    for (const name of ['All books', 'Bookmarked', 'Recently opened']) mode.append(node('option', name));
    const modeLabel = node('label', 'Show');
    modeLabel.append(mode);
    const toolbar = node('div');
    toolbar.className = 'toolbar';
    toolbar.append(label, categoryLabel, modeLabel);
    const results = node('div');
    results.className = 'phc-book-list';
    const reading = node('div');
    reading.hidden = true;
    let clearBook = () => {};
    function openBook(book, source, trigger) {
      clearBook();
      reading.replaceChildren();
      reading.hidden = false;
      filters.hidden = true;
      const panel = card(book.title);
      const close = action('Back to book list', () => {
        clearBook();
        reading.replaceChildren();
        reading.hidden = true;
        filters.hidden = false;
        trigger.focus();
      });
      panel.append(close);
      panel.append(source.cloneNode(true));
      clearBook = window.PHCPdfReader.create(
        book.pdf_path ? 'Book pages' : 'Open a PDF from this device', panel, book.pdf_path
      );
      if (!book.pdf_path) {
        panel.insertBefore(node('p', 'This edition is listed in the catalogue. Its scan has not been added to the app yet.'), panel.lastElementChild);
      }
      reading.append(panel);
      close.focus();
    }
    filters.append(node('p', 'Historical education only. Keep patient information out of reference notes.'), toolbar, state, results);
    const tabs = node('div');
    tabs.className = 'toolbar';
    const repertories = node('div');
    const tools = node('div');
    const sections = [filters, repertories, tools];
    const tabNames = ['Books', 'Repertory', 'PDF tools'];
    const buttons = tabNames.map((name, selected) => action(name, () => {
      clearBook();
      reading.replaceChildren();
      reading.hidden = true;
      sections.forEach((section, index) => { section.hidden = index !== selected; });
      buttons.forEach((button, index) => button.setAttribute('aria-pressed', String(index === selected)));
    }));
    buttons.forEach((button, index) => button.setAttribute('aria-pressed', String(index === 0)));
    repertories.hidden = tools.hidden = true;
    tabs.append(...buttons);
    root.append(tabs, filters, reading, repertories, tools);

    function render() {
      const books = data.catalog.filter(book => {
        const item = progress.get(book.id);
        return matches(book, search.value) && (!category.selectedIndex || book.category === category.value)
          && (!mode.selectedIndex || (mode.selectedIndex === 1 ? item?.bookmarked : item?.last_opened));
      });
      if (mode.selectedIndex === 2) books.sort((a, b) => progress.get(b.id).last_opened.localeCompare(progress.get(a.id).last_opened));
      if (mode.selectedIndex !== 2) books.sort((a, b) => a.title.localeCompare(b.title, 'en'));
      state.textContent = books.length + ' catalogue entries';
      results.replaceChildren();
      for (const book of books) {
        const entry = node('article');
        entry.className = 'visit';
        const saved = progress.get(book.id);
        const note = node('textarea');
        note.maxLength = 4000;
        note.value = saved?.note || '';
        const noteLabel = node('label', 'Private reference note');
        noteLabel.append(note);
        const source = node('a', 'Open edition at ' + book.source);
        source.href = book.source_url;
        source.target = '_blank';
        source.rel = 'noopener noreferrer';
        const feedback = node('p');
        feedback.setAttribute('role', 'status');
        const bookmark = node('input');
        bookmark.type = 'checkbox';
        bookmark.checked = saved?.bookmarked ?? false;
        const bookmarkLabel = node('label', 'Bookmark ');
        bookmarkLabel.append(bookmark);
        let pending = false;
        async function save() {
          if (pending) return;
          pending = true;
          saveButton.disabled = true;
          try {
            const result = await api(endpoint, {
              action: 'progress', bookId: book.id, bookmarked: bookmark.checked, note: note.value
            });
            progress.set(book.id, result.progress);
            feedback.textContent = 'Saved.';
          } catch (error) {
            feedback.textContent = error.message;
          } finally {
            pending = false;
            saveButton.disabled = false;
          }
        }
        const saveButton = action('Save bookmark and note', save);
        const markOpened = async () => {
          try {
            const {progress: item} = await api(endpoint, {action: 'reference_opened', bookId: book.id});
            const existing = progress.get(book.id) || item;
            progress.set(book.id, {...existing, last_opened: item.last_opened});
          } catch {
            feedback.textContent = 'The edition opened, but its reading history could not be saved.';
          }
        };
        source.addEventListener('click', markOpened);
        const readBook = action(book.pdf_path ? 'Read in app' : 'Edition details', () => {
          openBook(book, source, readBook);
          void markOpened();
        });
        const noteTools = node('details');
        noteTools.append(node('summary', 'Bookmark and notes'), noteLabel, bookmarkLabel, saveButton, feedback);
        entry.append(node('h3', book.title + ' / ' + book.title_hi),
          node('p', [book.author, book.year, book.category, 'English', book.rights].filter(Boolean).join(' · ')),
          readBook, noteTools);
        if (saved?.last_opened) entry.append(node('p', 'Last opened ' + new Date(saved.last_opened).toLocaleString('en-IN')));
        results.append(entry);
      }
    }
    search.addEventListener('input', render);
    category.addEventListener('change', render);
    mode.addEventListener('change', render);
    render();

    if (data.boericke) repertories.append(renderRepertory(data.boericke, progress, api));
    if (data.repertory) repertories.append(renderRepertory(data.repertory, progress, api));

    if (data.keynotes?.entries.length) filters.append(renderKeynotes(data.keynotes));

    const reader = card('Compare local editions');
    const columns = node('div');
    columns.className = 'phc-reader-columns';
    reader.append(node('p', 'Open one or two PDFs you have permission to read. Files stay on this device. Find text in searchable PDFs or compare scanned pages visually.'), columns);
    const clearFirst = window.PHCPdfReader.create('First edition', columns);
    const clearSecond = window.PHCPdfReader.create('Second edition', columns);
    tools.append(reader);
    disposeLibrary = () => {
      closed = true;
      clearBook();
      clearFirst();
      clearSecond();
    };
  }

  function renderRepertory(index, progress, api) {
    const panel = card(index.title || 'Kent Repertory / केंट रिपर्टरी');
    panel.append(node('p', index.coverage), node('p', index.edition + ' · Historical study'));
    const search = node('input');
    search.type = 'search';
    search.placeholder = 'Pressing, कनपटी, khansi…';
    const searchLabel = node('label', index.title ? 'Search Boericke rubrics' : 'Search rubrics / रूब्रिक खोजें');
    searchLabel.append(search);
    const chapter = node('select');
    chapter.append(node('option', 'All chapters'));
    for (const name of new Set(index.rubrics.map(rubric => rubric.chapter))) chapter.append(node('option', name));
    const chapterLabel = node('label', 'Chapter');
    chapterLabel.append(chapter);
    const savedOnly = node('input');
    savedOnly.type = 'checkbox';
    const savedLabel = node('label', 'Show my study list ');
    savedLabel.append(savedOnly);
    const toolbar = node('div');
    toolbar.className = 'toolbar';
    toolbar.append(searchLabel, chapterLabel, savedLabel);
    const count = node('p');
    count.setAttribute('role', 'status');
    const results = node('div');
    panel.append(toolbar, count, results);
    function render() {
      const rubrics = index.rubrics.filter(rubric => matchesRubric(rubric, search.value)
        && (!chapter.selectedIndex || rubric.chapter === chapter.value)
        && (!savedOnly.checked || progress.get(rubric.id)?.bookmarked));
      count.textContent = rubrics.length + (rubrics.length === 1 ? ' rubric' : ' rubrics');
      results.replaceChildren();
      for (const rubric of rubrics) {
        const item = node('details');
        item.className = 'visit';
        const source = node('a', index.source + ' · ' + pageLabel(rubric.page));
        source.href = index.pages[rubric.page];
        source.target = '_blank';
        source.rel = 'noopener noreferrer';
        const note = node('textarea');
        note.maxLength = 4000;
        note.value = progress.get(rubric.id)?.note || '';
        const noteLabel = node('label', 'Private study note');
        noteLabel.append(note);
        const bookmark = node('input');
        bookmark.type = 'checkbox';
        bookmark.checked = progress.get(rubric.id)?.bookmarked ?? false;
        const bookmarkLabel = node('label', 'Add to my study list ');
        bookmarkLabel.append(bookmark);
        const feedback = node('p');
        feedback.setAttribute('role', 'status');
        const save = action('Save study entry', async () => {
          save.disabled = true;
          try {
            const {progress: updated} = await api(endpoint, {
              action: 'progress', bookId: rubric.id, note: note.value, bookmarked: bookmark.checked
            });
            progress.set(rubric.id, updated);
            if (savedOnly.checked && !updated.bookmarked) render();
            else feedback.textContent = 'Saved.';
          } catch (error) {
            feedback.textContent = error.message;
          } finally {
            save.disabled = false;
          }
        });
        item.append(node('summary', [rubric.chapter, ...rubric.path].join(' → ')),
          source, bookmarkLabel, noteLabel, save, feedback);
        results.append(item);
      }
    }
    search.addEventListener('input', render);
    chapter.addEventListener('change', render);
    savedOnly.addEventListener('change', render);
    render();
    return panel;
  }

  function renderKeynotes(index) {
    const panel = card('Allen’s Keynotes entry index');
    panel.append(node('p', index.edition + ' · Historical reading'));
    const search = node('input');
    search.type = 'search';
    const label = node('label', 'Find an Allen entry by name');
    label.append(search);
    const count = node('p');
    count.setAttribute('role', 'status');
    const results = node('ul');
    const pagination = action('Show more entries', () => { limit += 30; render(); });
    let limit = 30;
    function render() {
      const matches = index.entries.filter(entry => matchesKeynote(entry, search.value));
      count.textContent = matches.length + ' matching index entries';
      results.replaceChildren();
      for (const entry of matches.slice(0, limit)) {
        const item = node('li');
        const link = node('a', entry.title + ' · printed p. ' + entry.page);
        link.href = index.pdf + '#page=' + entry.scanPage;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        item.append(link);
        results.append(item);
      }
      pagination.hidden = matches.length <= limit;
    }
    search.addEventListener('input', () => { limit = 30; render(); });
    panel.append(label, count, results, pagination);
    render();
    return panel;
  }

  async function consultation(visit, ui) {
    const request = ++consultationRequest;
    try {
      const {document: saved} = await ui.api(endpoint + '?section=consultation&visitId=' + visit.id);
      if (request !== consultationRequest) return;
      const fields = [
        ui.field('consent', 'Patient consent for structured documentation', 'select',
          saved ? 'yes' : '', [['', 'Select after obtaining consent'], ['yes', 'Consent confirmed']]),
        ui.field('history', 'Patient-reported history', 'textarea', saved?.history),
        ui.field('observations', 'Clinician observations', 'textarea', saved?.observations),
        ui.field('follow_up', 'Clinician follow-up plan', 'textarea', saved?.follow_up),
        ui.field('reviewed', 'Review status', 'select', 'no', [
          ['no', 'Save as draft'], ['yes', 'I am a qualified clinician and reviewed this version']
        ])
      ];
      for (const label of fields.slice(1, 4)) label.querySelector('textarea').maxLength = 3000;
      fields[0].querySelector('select').required = true;
      const detail = ui.el('p', saved?.reviewed_at ?
        'Last saved version reviewed on ' + new Date(saved.reviewed_at).toLocaleString('en-IN') :
        'Drafts require review by a qualified clinician.');
      const history = fields[1].querySelector('textarea');
      const voice = dictation(history, ui);
      const formatDraft = action('Format labelled transcript', () => {
        const formatted = draftChart(history.value);
        if (formatted.length <= history.maxLength) history.value = formatted;
        history.focus();
      });
      const chart = action('Insert case-sheet headings', () => {
        const headings = ['Chief complaint', 'Duration', 'Patient history'];
        if (!history.value.trim()) history.value = headings.map(heading => heading + ': ').join('\n');
        history.focus();
      });
      const classical = action('Insert classical case-taking headings', () => {
        const present = new Set(history.value.split('\n').map(line => normalize(line.split(':')[0]).trim()));
        const missing = classicalHeadings.filter(heading => !present.has(normalize(heading)));
        if (!missing.length) return history.focus();
        const updated = [history.value.trimEnd(), missing.map(heading => heading + ': ').join('\n')]
          .filter(Boolean).join('\n');
        if (updated.length <= history.maxLength) history.value = updated;
        else ui.message('There is not enough room to insert every heading.', true, 'editorMessage');
        history.focus();
      });
      ui.modal('Consultation document', [detail, ...fields, chart, classical, formatDraft, voice, consultationRecorder(), consultationLookup(ui.api)], values => ui.api(endpoint, {
        action: 'consultation', visitId: visit.id, version: saved?.version || 0,
        history: draftChart(values.history), observations: values.observations, follow_up: values.follow_up,
        consent: values.consent === 'yes', reviewed: values.reviewed === 'yes'
      }));
      document.getElementById('editor').addEventListener('close', () => {
        stopDictation();
        disposeRecording();
      }, {once: true});
    } catch (error) {
      if (request === consultationRequest) ui.message(error.message, true);
    }
  }

  function consultationLookup(api) {
    const box = node('details');
    box.append(node('summary', 'Search historical rubrics'));
    const input = node('input');
    input.type = 'search';
    const label = node('label', 'Historical search terms');
    label.append(input);
    const results = node('ul');
    const status = node('p');
    status.setAttribute('role', 'status');
    let index;
    const search = action('Find historical entries', async () => {
      if (!input.value.trim()) return;
      search.disabled = true;
      try {
        index ||= (await api(endpoint + '?section=library')).repertory;
        const entries = index.rubrics.filter(rubric => matchesRubric(rubric, input.value));
        results.replaceChildren();
        for (const rubric of entries.slice(0, 15)) {
          const item = node('li');
          const link = node('a', [rubric.chapter, ...rubric.path].join(' → ') + ' · ' + pageLabel(rubric.page));
          link.href = index.pages[rubric.page];
          link.target = '_blank';
          link.rel = 'noopener noreferrer';
          item.append(link);
          results.append(item);
        }
        status.textContent = entries.length + ' matching historical entries';
      } catch {
        status.textContent = 'The historical index is unavailable.';
      } finally {
        search.disabled = false;
      }
    });
    box.append(label, search, status, results);
    return box;
  }

  function consultationRecorder() {
    const box = node('details');
    box.append(node('summary', 'Record audio for this session'));
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
      box.append(node('p', 'Local recording is unavailable in this browser.'));
      return box;
    }
    const consent = node('input');
    consent.type = 'checkbox';
    const label = node('label', 'Patient consented to local audio recording ');
    label.append(consent);
    const audio = node('audio');
    audio.controls = true;
    audio.hidden = true;
    const status = node('p');
    status.setAttribute('role', 'status');
    let recorder, stream, url, timer;
    let generation = 0;
    function release() {
      generation++;
      clearTimeout(timer);
      if (recorder?.state === 'recording') recorder.stop();
      stream?.getTracks().forEach(track => track.stop());
      if (url) URL.revokeObjectURL(url);
      url = null;
      audio.pause();
      audio.removeAttribute('src');
      audio.hidden = true;
    }
    disposeRecording = release;
    const stop = action('Stop recording', () => {
      if (recorder?.state === 'recording') recorder.stop();
    });
    stop.disabled = true;
    const start = action('Start recording', async () => {
      if (!consent.checked) {
        status.textContent = 'Confirm recording consent before starting.';
        return;
      }
      release();
      const token = generation;
      start.disabled = true;
      try {
        const captured = await navigator.mediaDevices.getUserMedia({audio: true});
        if (token !== generation) {
          captured.getTracks().forEach(track => track.stop());
          return;
        }
        stream = captured;
        recorder = new MediaRecorder(stream);
        const chunks = [];
        recorder.ondataavailable = event => {
          if (token === generation && event.data.size) chunks.push(event.data);
        };
        recorder.onstop = () => {
          if (token !== generation) return;
          clearTimeout(timer);
          captured.getTracks().forEach(track => track.stop());
          start.disabled = false;
          stop.disabled = true;
          if (!chunks.length) {
            status.textContent = 'No audio was captured.';
            return;
          }
          url = URL.createObjectURL(new Blob(chunks, {type: recorder.mimeType}));
          audio.src = url;
          audio.hidden = false;
          status.textContent = 'Recording stopped. Playback is available until you close this form.';
        };
        recorder.onerror = () => {
          if (token !== generation) return;
          release();
          start.disabled = false;
          stop.disabled = true;
          status.textContent = 'Recording stopped because the microphone became unavailable.';
        };
        recorder.start(1000);
        stop.disabled = false;
        timer = setTimeout(() => stop.click(), 15 * 60 * 1000);
        status.textContent = 'Recording on this device. Maximum 15 minutes per recording.';
      } catch {
        if (token !== generation) return;
        release();
        start.disabled = false;
        status.textContent = 'Could not start recording. Check browser microphone permission.';
      }
    });
    consent.addEventListener('change', () => {
      if (consent.checked) return;
      release();
      start.disabled = false;
      stop.disabled = true;
      status.textContent = 'Recording cleared.';
    });
    box.append(node('p', 'Audio stays in this tab and is discarded when you close the form.'), label, start, stop, status, audio);
    return box;
  }

  function dictation(target, ui) {
    const box = node('div');
    const status = node('p');
    status.setAttribute('role', 'status');
    const Speech = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (typeof Speech?.available !== 'function' || !('processLocally' in Speech.prototype)) {
      box.append(node('p', 'On-device dictation is unavailable in this browser. You can type your notes.'));
      return box;
    }
    const language = ui.field('voiceLanguage', 'On-device dictation language', 'select', 'hi-IN',
      [['hi-IN', 'Hindi'], ['en-IN', 'English (India)']]);
    const consent = ui.field('voiceConsent', 'Separate patient consent for microphone use', 'select', '',
      [['', 'Select after obtaining consent'], ['yes', 'Consent confirmed']]);
    let recognition, generation = 0;
    const start = action('Dictate patient history', async () => {
      if (consent.querySelector('select').value !== 'yes') {
        status.textContent = 'Confirm microphone consent before starting.';
        return;
      }
      const token = ++generation;
      const lang = language.querySelector('select').value;
      start.disabled = true;
      try {
        const availability = await Speech.available({langs: [lang], processLocally: true});
        if (token !== generation) return;
        if (availability !== 'available') {
          status.textContent = 'This device does not have the selected on-device language pack.';
          start.disabled = false;
          return;
        }
        recognition = new Speech();
        recognition.processLocally = true;
        recognition.lang = lang;
        recognition.onresult = event => {
          if (token !== generation) return;
          const text = Array.from(event.results, result => result[0].transcript).join(' ');
          target.value = [target.value, text].filter(Boolean).join(' ').slice(0, target.maxLength);
          status.textContent = 'Check the transcript before saving.';
        };
        recognition.onerror = () => { status.textContent = 'Dictation could not continue. You can type your notes.'; };
        recognition.onend = () => { start.disabled = false; };
        recognition.start();
        status.textContent = 'Listening on this device…';
      } catch {
        if (token !== generation) return;
        status.textContent = 'On-device dictation could not start.';
        start.disabled = false;
      }
    });
    stopDictation = () => {
      generation++;
      recognition?.abort();
      recognition = null;
      start.disabled = false;
    };
    box.append(language, consent, start, action('Stop dictation', () => recognition?.stop()));
    if (typeof Speech.install === 'function') {
      const install = action('Install selected language pack', async () => {
        install.disabled = true;
        try {
          const lang = language.querySelector('select').value;
          const installed = await Speech.install({langs: [lang], processLocally: true});
          status.textContent = installed ? 'Language pack installed.' : 'This browser could not install the selected language pack.';
        } catch {
          status.textContent = 'This browser could not install the selected language pack.';
        } finally {
          install.disabled = false;
        }
      });
      box.append(install);
    }
    box.append(status);
    return box;
  }

  window.PHCSmartClinic = {
    library, consultation,
    close() {
      consultationRequest++;
      disposeLibrary();
      disposeLibrary = () => {};
      stopDictation();
      disposeRecording();
      disposeRecording = () => {};
      stopDictation = () => {};
    },
    init() {
      try { document.documentElement.dataset.theme = localStorage.getItem('phc-theme') || 'light'; } catch {}
      navigator.serviceWorker?.register('/admin-sw.js', {scope: '/admin'}).catch(() => {});
    },
    toggleTheme() {
      const root = document.documentElement;
      root.dataset.theme = root.dataset.theme === 'dark' ? 'light' : 'dark';
      try { localStorage.setItem('phc-theme', root.dataset.theme); } catch {}
    }
  };
  window.addEventListener('pagehide', () => window.PHCSmartClinic.close());
})();
