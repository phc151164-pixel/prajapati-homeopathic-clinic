'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const deploy = require('../netlify/lib/deploy-context.cjs');
deploy.context = 'dev';
const {handler, enabled} = require('../netlify/handlers/smart-clinic.cjs');
const {matches, matchesRubric, draftChart, matchesKeynote} = require('../public/assets/smart-clinic.js');
const catalog = require('../docs/reference-library-catalog.json');
const doctor = '11111111-1111-4111-8111-111111111111';
const visit = '22222222-2222-4222-8222-222222222222';
const origin = 'https://phc-preview.example';
const event = (method, query = {}, body, headers = {}) => ({
  httpMethod: method, rawUrl: origin + '/smart-clinic', queryStringParameters: query,
  headers: {origin, cookie: '__Host-phc_access=synthetic', ...headers},
  body: JSON.stringify(body)
});

test('historical catalogue supports Hindi, English, Hinglish aliases and translated titles', () => {
  assert.deepEqual(catalog.filter(book => matches(book, 'बोगर repertori')).map(book => book.id), ['boger']);
  assert.ok(catalog.some(book => matches(book, 'aushadhi hahnemann')));
  assert.ok(catalog.some(book => matches(book, 'bönninghausen')));
  assert.equal(catalog.find(book => matches(book, 'एलन keynotes')).id, 'allen-keynotes');
  assert.equal(catalog.find(book => matches(book, 'purani bimari')).id, 'hahnemann-chronic-diseases');
  assert.ok(catalog.every(book => book.content_status === 'external_catalogue_only'));
});

test('Kent rubric search preserves hierarchy, Hindi and Hinglish aliases, and page provenance', () => {
  const index = require('../docs/kent-repertory-index.json');
  const find = query => index.rubrics.filter(rubric => matchesRubric(rubric, query)).map(rubric => rubric.id);
  assert.deepEqual(find('Head pressing khansi'), ['kent-rubric-pressing-cough']);
  assert.deepEqual(find('कनपटी'), ['kent-rubric-tearing-temples']);
  assert.deepEqual(find('Mind यात्रा safar'), ['kent-rubric-mind-travel']);
  assert.deepEqual(find('behoshi रात'), ['kent-rubric-mind-unconscious-night']);
  assert.deepEqual(find('Sides Right'), ['kent-rubric-tearing-sides-right']);
  assert.equal(new Set(index.rubrics.map(rubric => rubric.id)).size, index.rubrics.length);
  assert.ok(index.rubrics.every(rubric => new URL(index.pages[rubric.page]).hostname === 'wellcomecollection.org'));
});

test('case sheet recognizes explicit headings and preserves unclassified wording', () => {
  assert.equal(draftChart('मुख्य शिकायत: Synthetic sample\nDuration: 2 days\nUnclassified text'),
    'Chief complaint: Synthetic sample\nDuration: 2 days\nUnclassified text');
  assert.equal(draftChart('Follow-up: keep wording unchanged'), 'Follow-up: keep wording unchanged');
});

test('Allen index returns name aliases and distinct scan and printed page references', () => {
  const index = require('../docs/allen-keynotes-index.json');
  const find = query => index.entries.filter(entry => matchesKeynote(entry, query));
  assert.equal(find('नक्स वोमिका')[0].title, 'Nux vomica');
  assert.equal(find('beladona')[0].scanPage, 63);
  assert.equal(find('Bryonia Alba')[0].page, 66);
  assert.ok(index.entries.every(entry => entry.scanPage === entry.page + 6));
});

test('Smart Clinic restricts deployment, authorizes the doctor, and binds writes to the session', async t => {
  const settings = {PHC_SMART_CLINIC_ENABLED: 'true', PHC_ENVIRONMENT: 'staging', PHC_DASHBOARD_ENABLED: 'true', CONTEXT: 'dev',
    PHC_SUPABASE_AUTH_KEY: 'synthetic', SUPABASE_URL: 'https://cefhdbqlzuxvnmktyxyk.supabase.co'};
  const old = Object.fromEntries(Object.keys(settings).map(key => [key, process.env[key]]));
  Object.assign(process.env, settings);
  const requests = [];
  let active = true;
  let stale = false;
  let progress;
  t.mock.method(globalThis, 'fetch', async (raw, options) => {
    const url = new URL(raw);
    requests.push({url, options});
    if (url.pathname === '/auth/v1/user') return Response.json({id: doctor});
    if (url.pathname.endsWith('/phc_admin_accounts')) return Response.json(active ? [{user_id: doctor}] : []);
    if (url.pathname.endsWith('/phc_reference_progress')) {
      if (options.method === 'PATCH') return Response.json(progress ? [progress] : []);
      if (options.method === 'POST') progress = {...JSON.parse(options.body), last_opened: null};
      return Response.json(progress ? [progress] : []);
    }
    if (url.pathname.endsWith('/phc_save_consultation_document')) {
      if (stale) return Response.json({code: '40001', message: 'Internal detail'}, {status: 409});
      return Response.json({visit_id: visit, version: 1});
    }
    throw Error('Unexpected provider request');
  });
  try {
    assert.equal(enabled(), true);
    process.env.CONTEXT = 'production';
    assert.equal((await handler(event('GET', {section: 'library'}))).statusCode, 404);
    process.env.CONTEXT = 'dev';
    process.env.SUPABASE_URL = 'https://production.example';
    assert.equal(enabled(), false);
    process.env.SUPABASE_URL = settings.SUPABASE_URL;
    assert.equal(requests.length, 0);

    assert.equal((await handler(event('GET', {section: 'library'}, undefined, {cookie: ''}))).statusCode, 401);
    active = false;
    assert.equal((await handler(event('GET', {section: 'library'}))).statusCode, 401);
    active = true;
    assert.equal((await handler(event('POST', {}, {}, {origin: 'https://other.example'}))).statusCode, 403);

    const consultation = {action: 'consultation', visitId: visit, version: 0, consent: false,
      reviewed: false, history: 'Synthetic only', observations: '', follow_up: '', actor: visit};
    assert.equal((await handler(event('POST', {}, consultation))).statusCode, 400);
    assert.equal((await handler(event('POST', {}, {...consultation, consent: true}))).statusCode, 200);
    assert.equal(JSON.parse(requests.at(-1).options.body).p_actor, doctor);
    stale = true;
    const conflict = await handler(event('POST', {}, {...consultation, consent: true}));
    assert.equal(conflict.statusCode, 409);
    assert.doesNotMatch(conflict.body, /Internal detail/);

    const save = await handler(event('POST', {}, {action: 'progress', bookId: 'boger',
      bookmarked: true, note: 'Private synthetic note', doctorId: visit}));
    assert.equal(save.statusCode, 200);
    assert.equal(progress.doctor_id, doctor);
    assert.equal(save.headers['Cache-Control'], 'no-store');
    await handler(event('GET', {section: 'library', doctorId: visit}));
    assert.equal(requests.at(-1).url.searchParams.get('doctor_id'), 'eq.' + doctor);
    assert.equal((await handler(event('POST', {}, {action: 'progress', bookId: 'kent-rubric-pressing-cough',
      bookmarked: true, note: 'Historical study'}))).statusCode, 200);
    assert.equal((await handler(event('POST', {}, {action: 'progress', bookId: 'unknown-rubric',
      bookmarked: true, note: ''}))).statusCode, 400);
  } finally {
    for (const [key, value] of Object.entries(old)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
