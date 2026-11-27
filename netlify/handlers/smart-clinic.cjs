'use strict';

const {json, supa} = require('../functions/_common');
const {identify, sameOrigin} = require('../lib/doctor-auth.cjs');
const {context} = require('../lib/deploy-context.cjs');
const boericke = require('../../docs/boericke-repertory-index.json');
const repertory = require('../../docs/kent-repertory-index.json');
const rubricIds = new Set([repertory, boericke].flatMap(index => index.rubrics.map(rubric => rubric.id)));
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const consultationFields = ['history', 'observations', 'follow_up'];

exports.enabled = () => process.env.PHC_SMART_CLINIC_ENABLED === 'true'
  && process.env.PHC_DASHBOARD_ENABLED === 'true'
  && process.env.PHC_ENVIRONMENT === 'staging'
  && ['deploy-preview', 'branch-deploy', 'dev'].includes(context)
  && process.env.CONTEXT !== 'production'
  && process.env.SUPABASE_URL === 'https://cefhdbqlzuxvnmktyxyk.supabase.co';

exports.handler = async event => {
  if (!exports.enabled()) return json(404, {error: 'Smart Clinic is unavailable.'});
  const user = await identify(event);
  if (!user) return json(401, {error: 'Doctor sign-in required.'});
  const q = event.queryStringParameters || {};
  try {
    if (event.httpMethod === 'GET') {
      if (q.section === 'medicines') {
        const rows = await supa('phc_medicine_library?doctor_id=eq.' + user.id + '&select=medicines');
        return json(200, {medicines: rows[0]?.medicines || []});
      }
      if (q.section === 'consultation' && uuid.test(q.visitId || '')) {
        const rows = await supa('phc_consultation_documents?visit_id=eq.' + q.visitId);
        return json(200, {document: rows[0] || null});
      }
      if (q.section === 'library') {
        const progress = await supa('phc_reference_progress?doctor_id=eq.' + user.id + '&select=book_id,bookmarked,note,last_opened');
        return json(200, {progress: progress.filter(row => rubricIds.has(row.book_id)), repertory, boericke});
      }
      return json(400, {error: 'Invalid request.'});
    }
    if (event.httpMethod !== 'POST') return json(405, {error: 'Method not allowed.'});
    if (!sameOrigin(event)) return json(403, {error: 'Request origin not allowed.'});
    if (Buffer.byteLength(event.body || '') > (['medicines', 'transcription'].includes(q.section) ? 2000000 : 38000)) return json(413, {error: 'Request too large.'});
    let body;
    try { body = JSON.parse(event.body); } catch { return json(400, {error: 'Invalid request.'}); }
    if (!body || typeof body !== 'object') return json(400, {error: 'Invalid request.'});
    if (q.section === 'transcription') {
      const formats = {'audio/webm': 'webm', 'audio/mp4': 'mp4', 'audio/ogg': 'ogg'};
      if (body.consent !== true || !Object.hasOwn(formats, body.mime) ||
          typeof body.audio !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(body.audio)) {
        return json(400, {error: 'Confirm cloud transcription consent and supply a test recording.'});
      }
      const key = process.env.PHC_SARVAM_API_KEY;
      if (!key) return json(503, {error: 'Saaras v4 needs a server API key before it can transcribe.'});
      const form = new FormData();
      form.append('file', new Blob([Buffer.from(body.audio, 'base64')], {type: body.mime}), 'recording.' + formats[body.mime]);
      form.append('model', 'saaras:v4');
      form.append('language_code', 'hi-IN');
      form.append('mode', 'codemix');
      const response = await fetch('https://api.sarvam.ai/speech-to-text', {
        method: 'POST', headers: {'api-subscription-key': key}, body: form, signal: AbortSignal.timeout(20000)
      });
      if (!response.ok) return json(502, {error: 'Saaras could not transcribe the clip. Check the provider configuration and clip length.'});
      const result = await response.json();
      if (typeof result.transcript !== 'string') return json(502, {error: 'Saaras returned no transcript.'});
      return json(200, {text: result.transcript});
    }
    if (q.section === 'medicines') {
      const records = body.medicines;
      if (!Array.isArray(records) || !records.length || records.length > 1500 ||
          records.some(row => typeof row?.name !== 'string' || !row.name.trim() || row.name.length > 150 ||
            !Number.isInteger(row.page) || row.page < 1 || row.page > 595 ||
            typeof row.text !== 'string' || row.text.length > 50000)) {
        return json(400, {error: 'Choose the Boericke medicine data file.'});
      }
      const medicines = records.map(({name, page, text}) => ({name, page, text}));
      const key = 'phc_medicine_library?doctor_id=eq.' + user.id;
      const rows = await supa(key, 'PATCH', {medicines});
      if (!rows.length) {
        try {
          await supa('phc_medicine_library', 'POST', {doctor_id: user.id, medicines});
        } catch (error) {
          if (error.code !== '23505') throw error;
          await supa(key, 'PATCH', {medicines});
        }
      }
      return json(200, {count: medicines.length});
    }
    if (body.action === 'consultation' && typeof body.visitId === 'string' && uuid.test(body.visitId)
      && Number.isInteger(body.version) && body.version >= 0 && body.version < 2147483647
      && body.consent === true && typeof body.reviewed === 'boolean'
      && consultationFields.every(field => typeof body[field] === 'string' && body[field].length <= 3000)
      && consultationFields.some(field => body[field].trim())) {
      const document = await supa('rpc/phc_save_consultation_document', 'POST', {
        p_actor: user.id, p_visit: body.visitId, p_version: body.version,
        p_history: body.history, p_observations: body.observations,
        p_follow_up: body.follow_up, p_consent: body.consent, p_reviewed: body.reviewed
      });
      return json(200, {document});
    }
    const saving = body.action === 'progress' && typeof body.bookmarked === 'boolean'
      && typeof body.note === 'string' && body.note.length <= 4000;
    if (saving && rubricIds.has(body.bookId)) {
      const key = 'doctor_id=eq.' + user.id + '&book_id=eq.' + body.bookId;
      const changes = {bookmarked: body.bookmarked, note: body.note};
      let rows = await supa('phc_reference_progress?' + key, 'PATCH', changes);
      if (!rows.length) {
        try {
          rows = await supa('phc_reference_progress', 'POST', {doctor_id: user.id, book_id: body.bookId, bookmarked: false, note: '', ...changes});
        } catch (error) {
          if (error.code !== '23505') throw error;
          rows = await supa('phc_reference_progress?' + key, 'PATCH', changes);
        }
      }
      const {book_id, bookmarked, note, last_opened} = rows[0];
      return json(200, {progress: {book_id, bookmarked, note, last_opened}});
    }
    return json(400, {error: 'Check the entered values and confirm consent if required.'});
  } catch (error) {
    if (error.code === '40001') return json(409, {error: 'Another edit was saved. Reopen this visit before saving again.'});
    return json(503, {error: 'Smart Clinic data is temporarily unavailable.'});
  }
};
