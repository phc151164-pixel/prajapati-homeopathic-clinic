'use strict';

const {json, supa} = require('../functions/_common');
const {identify, sameOrigin} = require('../lib/doctor-auth.cjs');
const {context} = require('../lib/deploy-context.cjs');
const catalog = require('../../docs/reference-library-catalog.json');
const keynotes = require('../../docs/allen-keynotes-index.json');
const boericke = require('../../docs/boericke-repertory-index.json');
const repertory = require('../../docs/kent-repertory-index.json');
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
      if (q.section === 'consultation' && uuid.test(q.visitId || '')) {
        const rows = await supa('phc_consultation_documents?visit_id=eq.' + q.visitId);
        return json(200, {document: rows[0] || null});
      }
      if (q.section === 'library') {
        const progress = await supa('phc_reference_progress?doctor_id=eq.' + user.id + '&select=book_id,bookmarked,note,last_opened');
        return json(200, {catalog, progress, repertory, boericke, keynotes});
      }
      return json(400, {error: 'Invalid request.'});
    }
    if (event.httpMethod !== 'POST') return json(405, {error: 'Method not allowed.'});
    if (!sameOrigin(event)) return json(403, {error: 'Request origin not allowed.'});
    if (Buffer.byteLength(event.body || '') > 38000) return json(413, {error: 'Request too large.'});
    let body;
    try { body = JSON.parse(event.body); } catch { return json(400, {error: 'Invalid request.'}); }
    if (!body || typeof body !== 'object') return json(400, {error: 'Invalid request.'});
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
    const opening = body.action === 'reference_opened';
    const saving = body.action === 'progress' && typeof body.bookmarked === 'boolean'
      && typeof body.note === 'string' && body.note.length <= 4000;
    const knownEntry = catalog.some(book => book.id === body.bookId)
      || (saving && [repertory, boericke].some(index => index.rubrics.some(rubric => rubric.id === body.bookId)));
    if ((opening || saving) && knownEntry) {
      const key = 'doctor_id=eq.' + user.id + '&book_id=eq.' + body.bookId;
      const changes = opening ? {last_opened: new Date().toISOString()} : {bookmarked: body.bookmarked, note: body.note};
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
