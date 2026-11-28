import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';

const migration = readFileSync(new URL('../supabase/migrations/20261125090000_smart_clinic.sql', import.meta.url), 'utf8');
const kentMigration = readFileSync(new URL('../supabase/migrations/20261128162701_phc_private_kent_account_index.sql', import.meta.url), 'utf8');
const doctor = '11111111-1111-4111-8111-111111111111';
const inactive = '22222222-2222-4222-8222-222222222222';
const visit = '33333333-3333-4333-8333-333333333333';

test('consultation database enforces authorization, consent, version and review integrity', async () => {
  const db = await PGlite.create();
  try {
    await db.exec(`
      CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
      CREATE TABLE public.phc_admin_accounts(user_id uuid PRIMARY KEY, active boolean NOT NULL);
      CREATE TABLE public.phc_visits(id uuid PRIMARY KEY);
      CREATE TABLE public.phc_audit_log(actor uuid, action text, entity_id text);
      INSERT INTO public.phc_admin_accounts VALUES ('${doctor}', true), ('${inactive}', false);
      INSERT INTO public.phc_visits VALUES ('${visit}');
    `);
    await db.exec(migration);
    await db.exec(kentMigration);
    const digest = 'a'.repeat(64);
    await db.query('INSERT INTO public.phc_kent_account_indexes VALUES ($1,$2,3,1)', [doctor, digest]);
    await db.query("INSERT INTO public.phc_kent_index_parts VALUES($1,$2,0,decode('010203','hex'))", [doctor, digest]);
    const save = async (version, consent, reviewed, actor = doctor) => (await db.query(
      'SELECT * FROM public.phc_save_consultation_document($1,$2,$3,$4,$5,$6,$7,$8)',
      [actor, visit, version, 'Synthetic history', '', '', consent, reviewed]
    )).rows[0];
    for (const role of ['anon', 'authenticated']) {
      await db.exec('SET ROLE ' + role);
      await assert.rejects(db.query('SELECT * FROM public.phc_kent_account_indexes'), {code: '42501'});
      await assert.rejects(db.query('SELECT * FROM public.phc_kent_index_parts'), {code: '42501'});
      await assert.rejects(db.query('SELECT * FROM public.phc_reference_progress'), {code: '42501'});
      await assert.rejects(db.query('SELECT * FROM public.phc_consultation_documents'), {code: '42501'});
      await assert.rejects(save(0, true, true), {code: '42501'});
      await db.exec('RESET ROLE');
    }
    await db.exec('SET ROLE service_role');
    assert.equal((await db.query("SELECT encode(content,'hex') AS value FROM public.phc_kent_index_parts WHERE doctor_id=$1", [doctor])).rows[0].value, '010203');
    await assert.rejects(db.query('UPDATE public.phc_kent_index_parts SET content=content'), {code:'42501'});
    await assert.rejects(save(0, true, false, inactive), {code: '42501'});
    await assert.rejects(save(0, false, true), {code: '22023'});
    assert.equal((await save(0, true, false)).reviewed_at, null);
    const reviewed = await save(1, true, true);
    assert.equal(reviewed.version, 2);
    assert.ok(reviewed.reviewed_at);
    assert.equal((await save(2, true, false)).reviewed_at, null);
    await assert.rejects(save(1, true, false), {code: '40001'});
    await assert.rejects(db.query('UPDATE public.phc_consultation_documents SET version=1'), {code: '42501'});
    await db.exec('RESET ROLE');
    const {rows} = await db.query('SELECT * FROM public.phc_audit_log');
    assert.equal(rows.length, 3);
    assert.ok(rows.every(row => row.entity_id === visit && row.actor === doctor));
    await db.query(
      'INSERT INTO public.phc_reference_progress(doctor_id,book_id,bookmarked,note,last_opened) VALUES($1,$2,true,$3,now())',
      [doctor, 'boger', 'Synthetic reference note']
    );
    await save(3, true, true);

    const restored = await PGlite.create({loadDataDir: await db.dumpDataDir('gzip')});
    try {
      const {rows: [record]} = await restored.query(
        'SELECT d.version, d.consent_at, d.reviewed_at FROM public.phc_consultation_documents d JOIN public.phc_visits v ON v.id = d.visit_id WHERE v.id = $1',
        [visit]
      );
      assert.equal(record.version, 4);
      assert.ok(record.consent_at && record.reviewed_at);
      assert.equal((await restored.query('SELECT count(*)::integer AS total FROM public.phc_audit_log')).rows[0].total, 4);
      const {rows: [bookmark]} = await restored.query(
        'SELECT bookmarked, note, last_opened FROM public.phc_reference_progress WHERE doctor_id = $1 AND book_id = $2',
        [doctor, 'boger']
      );
      assert.equal(bookmark.bookmarked, true);
      assert.equal(bookmark.note, 'Synthetic reference note');
      assert.ok(bookmark.last_opened);
      await restored.exec('SET ROLE authenticated');
      await assert.rejects(restored.query('SELECT * FROM public.phc_consultation_documents'), {code: '42501'});
    } finally {
      await restored.close();
    }

  } finally {
    await db.close();
  }
});
