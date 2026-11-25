'use strict';

const {chromium} = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const publicRoot = path.join(root, 'public');
const catalog = require(path.join(root,'docs/reference-library-catalog.json'));
const keynotes = require(path.join(root,'docs/allen-keynotes-index.json'));
const repertory = require(path.join(root,'docs/kent-repertory-index.json'));
const patientId = '11111111-1111-4111-8111-111111111111';
const visitId = '22222222-2222-4222-8222-222222222222';
const csp = fs.readFileSync(path.join(root, 'netlify.toml'), 'utf8').match(/Content-Security-Policy = "([^"]+)"/)[1];
let progress, document, signedIn = true;
const srv = http.createServer(async (req,res) => {
  const url = new URL(req.url,'http://localhost');
  const section = url.searchParams.get('section');
  if (url.pathname.startsWith('/.netlify/functions/')) {
    let raw = '';
    for await (const data of req) raw += data;
    const body = raw ? JSON.parse(raw) : {};
    const json = (data,status=200) => {res.writeHead(status,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify(data));};
    if (url.pathname.endsWith('/doctor-auth')) {
      if (body.action === 'logout') {signedIn=false;return json({ok:true});}
      return signedIn ? json({user:{email:'synthetic@example.test'},smartClinic:true}) : json({error:'Sign in'},401);
    }
    if (!signedIn) return json({error:'Sign in'},401);
    if (url.pathname.endsWith('/doctor-dashboard')) {
      const patient={id:patientId,full_name:'Synthetic patient',patient_id:'PHC-000001',mobile:'0000000000',registered_at:'2026-01-01'};
      if (section==='patients') return json({items:[patient],has_more:false});
      if (section==='patient') return json({patient,summary:{completed:0,upcoming:1},visits:[{id:visitId,visit_date:'2026-11-25',visit_time:'11:00',kind:'followup',mode:'walkin',state:'planned'}]});
      return json({items:[],bookings:[],counts:{},stats:{},has_more:false});
    }
    if (section === 'library') return json({catalog,repertory,keynotes,progress:progress?[progress]:[]});
    if (section === 'consultation') return json({document:document||null});
    if (body.action === 'reference_opened') {
      progress = {...progress, book_id: body.bookId, last_opened: new Date().toISOString()};
      return json({progress});
    }
    if (body.action === 'progress') {
      progress={book_id:body.bookId,bookmarked:body.bookmarked,note:body.note,last_opened:progress?.last_opened};
      return json({progress});
    }
    if (body.action === 'consultation') {
      assert.equal(body.visitId,visitId);
      assert.equal(body.consent,true);
      document={...body,version:body.version+1,reviewed_at:body.reviewed?new Date().toISOString():null};
      return json({document});
    }
    return json({error:'Unknown fixture endpoint'},404);
  }
  const requestPath = url.pathname === '/admin' ? '/admin.html' : url.pathname;
  const file = path.resolve(publicRoot, '.' + requestPath);
  const type = {'.pdf':'application/pdf','.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.webmanifest':'application/manifest+json','.webp':'image/webp','.png':'image/png'}[path.extname(file)];
  if (file.startsWith(publicRoot + path.sep) && type && fs.existsSync(file) && fs.statSync(file).isFile()) {
    res.writeHead(200,{'content-type':type,...(file.endsWith('admin.html')?{'content-security-policy':csp}:{})});
    return res.end(fs.readFileSync(file));
  }
  res.writeHead(404);res.end();
});
(async () => {
  await new Promise(resolve => srv.listen(0,'127.0.0.1',resolve));
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.PHC_TEST_CHROMIUM_PATH || undefined,
    args: ['--no-sandbox', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream']
  });
  try {
    const page=await browser.newPage({viewport:{width:1280,height:900}});
    const sample=await browser.newPage();
    await sample.setContent('<p>Historical fixture first page</p><p style="break-before:page">Independent second page</p>');
    const pdf=await sample.pdf(); await sample.close();
    const errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    await page.goto('http://127.0.0.1:'+srv.address().port+'/admin');
    const nav=async name=>{
      const target=page.locator('#nav').getByRole('button',{name,exact:true});
      if (!(await target.isVisible())) await page.locator('#dashboardMenu > summary').click();
      await target.click();
    };
    await page.locator('#appView').waitFor();
    assert.equal(await page.locator('#nav').getByRole('button', {name: 'Repertory', exact: true, includeHidden: true}).count(), 0);
    await nav('Patient records');
    await page.getByRole('button',{name:'Open profile',exact:true}).click();
    await page.getByRole('button',{name:'Consultation document'}).click();
    await page.getByRole('button', {name: 'Insert case-sheet headings'}).click();
    const historyField = page.getByLabel('Patient-reported history');
    assert.match(await historyField.inputValue(), /Chief complaint:/);
    await historyField.fill('Chief complaint: Synthetic note');
    const insertClassical = page.getByRole('button', {name: 'Insert classical case-taking headings'});
    await insertClassical.click();
    await insertClassical.click();
    const formatted = await historyField.inputValue();
    assert.match(formatted, /^Chief complaint: Synthetic note/);
    assert.match(formatted, /Aggravating and relieving factors:/);
    assert.equal(formatted.match(/Current medicines and allergies:/g).length, 1);

    assert.equal(await page.getByText('Search historical rubrics', {exact: true}).count(), 0);
    await page.getByText('Record audio for this session', {exact: true}).click();
    await page.getByRole('button', {name: 'Start recording'}).click();
    await page.getByText('Confirm recording consent before starting.').waitFor();
    await page.getByLabel('Patient consented to local audio recording').check();
    await page.getByRole('button', {name: 'Start recording'}).click();
    await page.getByText('Recording on this device.', {exact: false}).waitFor();
    await page.getByRole('button', {name: 'Stop recording'}).click();
    await page.locator('audio[src^="blob:"]').waitFor();
    await page.getByLabel('Patient-reported history').fill('Synthetic history');
    await page.getByLabel('Patient consent for structured documentation').selectOption('yes');
    await page.locator('#editorSave').click();
    await page.locator('#editor').waitFor({state:'hidden'});
    assert.equal(document.reviewed_at,null);
    await page.getByRole('button',{name:'Consultation document'}).click();
    await page.getByLabel('Review status').selectOption('yes');
    await page.locator('#editorSave').click();
    await page.locator('#editor').waitFor({state:'hidden'});
    assert.ok(document.reviewed_at);
    assert.equal(document.history,'Synthetic history');
    await page.evaluate(()=>navigator.serviceWorker.ready);
    assert.deepEqual(await page.evaluate(()=>caches.keys()),[]);
    const logout=page.locator('#logout');
    if (!(await logout.isVisible())) await page.locator('#dashboardMenu > summary').click();
    await logout.click();
    await page.locator('#loginView').waitFor();
    assert.equal(await page.locator('#smartLibraryNav').isVisible(),false);
    assert.equal((await page.request.get(new URL('/.netlify/functions/smart-clinic?section=library', page.url()).href)).status(), 401);
    assert.deepEqual(errors,[]);
    process.stdout.write('Chromium desktop + 390px smoke passed: library, PDF views, persistence, theme, consent/review, worker, logout.\n');
  } finally {await browser.close();srv.close();}
})().catch(error=>{console.error(error);srv.close();process.exitCode=1;});
