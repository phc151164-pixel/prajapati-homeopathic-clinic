'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const deploy = require('../netlify/lib/deploy-context.cjs');
deploy.context = 'dev';
const {handler, enabled} = require('../netlify/handlers/smart-clinic.cjs');
const {draftChart, medicineSections} = require('../public/assets/smart-clinic.js');
const doctor = '11111111-1111-4111-8111-111111111111';
const visit = '22222222-2222-4222-8222-222222222222';
const origin = 'https://phc-preview.example';
const event = (method, query = {}, body, headers = {}) => ({
  httpMethod: method, rawUrl: origin + '/smart-clinic', queryStringParameters: query,
  headers: {origin, cookie: '__Host-phc_access=synthetic', ...headers},
  body: JSON.stringify(body)
});



test('case sheet recognizes explicit headings and preserves unclassified wording', () => {
  assert.equal(draftChart('मुख्य शिकायत: Synthetic sample\nDuration: 2 days\nUnclassified text'),
    'Chief complaint: Synthetic sample\nDuration: 2 days\nUnclassified text');
  assert.equal(draftChart('Follow-up: keep wording unchanged'), 'Follow-up: keep wording unchanged');
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

    const save = await handler(event('POST', {}, {action: 'progress', bookId: 'kent-rubric-pressing-cough',
      bookmarked: true, note: 'Private synthetic note', doctorId: visit}));
    assert.equal(save.statusCode, 200);
    assert.equal(progress.doctor_id, doctor);
    assert.equal(save.headers['Cache-Control'], 'no-store');
    const library = await handler(event('GET', {section: 'library', doctorId: visit}));
    assert.deepEqual(Object.keys(JSON.parse(library.body)).sort(), ['boericke', 'progress', 'repertory']);
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

test('medicine view separates source headings and preserves continuation text', () => {
  assert.deepEqual(medicineSections('Historical introduction\nMind.––First line\nSecond line\nHead.—Another section'), [
    {heading: 'Overview', text: 'Historical introduction'},
    {heading: 'Mind', text: 'First line\nSecond line'},
    {heading: 'Head', text: 'Another section'}
  ]);
});


test('independent transcript complaints search different chapters and linked wording stays together', () => {
  const {transcriptExcerpts, rubricSearchContext} = require('../public/assets/smart-clinic.js');
  const contexts = text => transcriptExcerpts(text).map(rubricSearchContext);
  for (const input of [
    'सिर में दर्द है और खाँसी भी है।',
    'seer mein dard hai or cough bhi hai',
    'sar dard hai aur khansi bhi hai',
    'I have a headache and a cough.',
    'Headache, cough',
  ]) {
    assert.deepEqual(contexts(input), [
      {terms: 'head pain', chapter: 'Head'}, {terms: 'cough', chapter: 'Cough'},
    ]);
  }
  assert.deepEqual(contexts('खाँसी के समय सिर में दर्द और दबाव'), [
    {terms:'head pain cough pressing', chapter:'Head'},
  ]);
  assert.deepEqual(contexts('headache when I cough'), [{terms:'head pain cough', chapter:'Head'}]);
  for (const input of ['No headache and cough', 'headache or cough', 'sar dard khansi']) {
    assert.deepEqual(contexts(input), [{terms:'', chapter:''}]);
  }
});
