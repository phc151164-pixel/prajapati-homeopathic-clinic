'use strict';

const {chromium} = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const kentFile = process.env.PHC_TEST_KENT_FILE;
const publicRoot = path.join(root, 'public');
const catalog = require(path.join(root,'docs/reference-library-catalog.json'));
const boericke = require(path.join(root,'docs/boericke-repertory-index.json'));
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
    if (section === 'library') return json({catalog,repertory,boericke,keynotes,progress:progress?[progress]:[]});
    if (section === 'transcription') {
      assert.equal(body.consent, true);
      assert.equal(body.mime, 'audio/wav');
      const wav = Buffer.from(body.audio, 'base64');
      assert.equal(wav.toString('ascii', 0, 4), 'RIFF');
      assert.ok(wav.readUInt32LE(40) <= 800000);
      return json({text: wav.readUInt32LE(40) === 800000 ? 'पहला हिस्सा' : 'दूसरा हिस्सा'});
    }
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
    await page.addInitScript(() => {
      window.SpeechRecognition = class {
        get processLocally() { return this.local; }
        set processLocally(value) { this.local = value; }
        static async available({processLocally}) { return processLocally ? 'available' : 'unavailable'; }
        start(track) {
          if (!this.processLocally || track?.kind !== 'audio') throw new Error('Expected a local audio track');
          const result = Object.assign([{transcript: 'Chief complaint sar dard khansi. Duration two days'}], {isFinal: true});
          this.onresult({resultIndex: 0, results: [result]});
        }
        stop() { this.onend(); }
        abort() { this.onend(); }
      };
    });
    await page.goto('http://127.0.0.1:'+srv.address().port+'/admin');
    const nav=async name=>{
      const target=page.locator('#nav').getByRole('button',{name,exact:true});
      if (!(await target.isVisible())) await page.locator('#dashboardMenu > summary').click();
      await target.click();
    };
    await page.locator('#appView').waitFor();
    assert.equal(await page.locator('#nav').getByRole('button', {name: 'Repertory', exact: true, includeHidden: true}).count(), 0);
    await nav('Repertorisation');
    await page.getByLabel('Search historical rubrics').fill('khansi');
    await page.getByRole('button', {name: /Add Head → Pain → Pressing → Coughing/}).click();
    await page.getByRole('cell', {name: 'Kent', exact: true}).waitFor();
    await page.getByRole('button', {name: 'Save study list'}).click();
    await page.getByText('Study list saved.').waitFor();
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
    await page.getByLabel('Patient consented to on-device transcription').check();
    await page.getByLabel('On-device transcription language').selectOption('en-IN');
    await page.getByRole('button', {name: 'Start recording'}).click();
    await page.getByText('Recording on this device.', {exact: false}).waitFor();
    await page.getByLabel('Live historical study chart').getByText(/Pressing → Coughing, while/).waitFor();
    await page.waitForTimeout(1300);
    await page.getByRole('button', {name: 'Stop recording'}).click();
    await page.locator('audio[src^="blob:"]').waitFor();
    assert.match(await page.getByLabel('Editable transcript preview').inputValue(), /sar dard khansi/);
    await page.getByRole('button', {name: 'Review symptoms and find rubrics'}).click();
    await page.getByRole('button', {name: 'Chief complaint sar dard khansi', exact: true}).click();
    await page.getByLabel('Review and edit symptom wording').fill('sar dard khansi');
    assert.equal(await page.getByLabel('English rubric search terms').inputValue(), 'head pain cough');
    await page.getByRole('button', {name: 'Find matching rubrics'}).click();
    await page.getByRole('button', {name: /Add Head → Pain → Pressing → Coughing/}).click();
    await page.getByRole('cell', {name: 'Kent', exact: true}).waitFor();
    if (kentFile) {
      await page.getByText('Private Kent index', {exact: true}).click();
      const picker = page.getByLabel('Choose reconciled Kent JSONL.GZ');
      await picker.setInputFiles(kentFile);
      await page.getByText('64,273 Kent rubrics available on this browser.').waitFor();
      const search = page.getByLabel('Search historical rubrics');
      await search.fill('head pain pressing coughing while');
      await page.getByRole('button', {name: /Add Head → PAIN, headache in general → Pressing .* → coughing, while/}).click();
      const grade = page.getByRole('row').filter({hasText: 'Bryonia Alba'});
      await grade.getByRole('cell', {name: '3', exact: true}).waitFor();
      await page.getByText('Show PDF source excerpt', {exact: true}).click();
      const excerpt = page.locator('.kent-source-excerpt').filter({hasText: 'Bry.'});
      await excerpt.locator('strong').filter({hasText: 'Bry.'}).waitFor();
      const originalColour = await excerpt.locator('strong').filter({hasText: 'Bry.'}).evaluate(el => getComputedStyle(el).color);
      assert.equal(originalColour, 'rgb(255, 0, 0)');
      await search.fill('head boiling bubbling');
      await page.getByRole('button', {name: /Add Head → BOILING sensation/}).first().click();
      const ungraded = page.getByRole('row').filter({hasText: /PDF page 280.*Aconitum Napellus/i});
      await ungraded.getByRole('cell', {name: '—', exact: true}).waitFor();
      await page.getByText('Show PDF source excerpt', {exact: true}).last().click();
      const black = page.locator('.kent-source-excerpt strong').filter({hasText: 'Acon.'});
      await black.waitFor();
      assert.equal(await black.evaluate(el => getComputedStyle(el).color), 'rgb(0, 0, 0)');
    }
    await page.evaluate(() => {
      // Hindi uses the app model independently of Chrome pack availability.
      window.SpeechRecognition.available = async () => 'unavailable';
      const OriginalWorker = window.Worker;
      window.Worker = class {
        constructor(url, options) {
          if (!url.endsWith('/phc-transcription-worker-local.js')) return new OriginalWorker(url, options);
        }
        postMessage({samples, language}) {
          if (!(samples instanceof Float32Array) || !samples.length || language !== 'hindi') {
            throw new Error('Expected decoded Hindi recording');
          }
          queueMicrotask(() => this.onmessage({data: {text: 'खाँसी के समय सिर में दर्द और दबाव'}}));
        }
        terminate() {}
      };
    });
    await page.getByRole('button', {name: 'Delete recording'}).click();
    await page.getByLabel('On-device transcription language').selectOption('hi-IN');
    await page.getByRole('button', {name: 'Start recording'}).click();
    
    await page.getByText('PHC transcription will run on this device', {exact: false}).waitFor();
    await page.waitForTimeout(1300);
    await page.getByRole('button', {name: 'Stop recording'}).click();
    await page.getByText('Transcript ready. Review it before saving.').waitFor();
    assert.match(await page.getByLabel('Editable transcript preview').inputValue(), /सिर में दर्द/);
    await page.getByLabel('Live historical study chart').getByText(kentFile
      ? /PDF page/ : /Pressing → Coughing, while/).first().waitFor();
    if (kentFile) {
      await page.getByRole('button', {name: /Remove Head → BOILING sensation/}).waitFor();
      await page.getByRole('button', {name: 'खाँसी के समय सिर में दर्द और दबाव', exact: true}).click();
      assert.equal(await page.getByLabel('English rubric search terms').inputValue(), 'head pain cough pressing');
    }
    await page.getByRole('button', {name: 'Delete recording'}).click();
    await page.getByLabel(/Use Saaras v4 for this synthetic test clip/).check();
    const transcript = page.getByLabel('Editable transcript preview');
    await transcript.fill('Existing draft');
    await page.getByRole('button', {name: 'Start recording'}).click();
    await page.getByText(/Maximum 40 minutes per recording/).waitFor();
    await page.getByRole('button', {name: 'Pause recording'}).click();
    await page.getByText('Recording paused.', {exact:true}).waitFor();
    await page.getByRole('button', {name: 'Resume recording'}).click();
    await page.waitForTimeout(27000);
    await page.getByRole('button', {name: 'Stop recording'}).click();
    await page.getByText('Saaras transcript ready for review.').waitFor();
    assert.equal(await transcript.inputValue(), 'Existing draft\nपहला हिस्सा\nदूसरा हिस्सा');
    const playback = page.locator('audio[src^="blob:"]');
    const playbackUrl = await playback.getAttribute('src');
    await page.getByRole('button', {name: 'Start recording'}).click();
    assert.equal(await playback.getAttribute('src'), playbackUrl);
    await page.getByLabel('Editable transcript preview').fill('Chief complaint sar dard khansi. Duration two days');
    await historyField.fill('');
    await page.getByRole('button', {name: 'Create draft from transcript'}).click();
    assert.match(await historyField.inputValue(), /Chief complaint: sar dard khansi/);
    assert.match(await historyField.inputValue(), /Duration: two days/);
    await page.getByLabel('Patient consented to structured documentation').check();
    await page.locator('#editorSave').click();
    await page.locator('#editor').waitFor({state:'hidden'});
    assert.equal(document.reviewed_at,null);
    await page.getByRole('button',{name:'Consultation document'}).click();
    await page.getByLabel('Review status').selectOption('yes');
    await page.locator('#editorSave').click();
    await page.locator('#editor').waitFor({state:'hidden'});
    assert.ok(document.reviewed_at);
    assert.match(document.history, /Duration: two days/);
    await page.evaluate(()=>navigator.serviceWorker.ready);
    assert.deepEqual(await page.evaluate(()=>caches.keys()),[]);
    if (kentFile) {
      await page.reload();
      await nav('Repertorisation');
      await page.getByText('Private Kent index', {exact: true}).click();
      await page.getByText('64,273 Kent rubrics available on this browser.').waitFor();
      await page.setViewportSize({width:390,height:844});
      await page.getByLabel('Search historical rubrics').fill('head boiling bubbling');
      await page.getByRole('button', {name: /Add Head → BOILING sensation/}).first().click();
      await page.getByRole('heading', {name: 'Historical medicine grade chart'}).waitFor();
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), 390);
    }
    const logout=page.locator('#logout');
    if (!(await logout.isVisible())) await page.locator('#dashboardMenu > summary').click();
    await logout.click();
    await page.locator('#loginView').waitFor();
    assert.equal(await page.locator('#smartLibraryNav').isVisible(),false);
    assert.equal((await page.request.get(new URL('/.netlify/functions/smart-clinic?section=library', page.url()).href)).status(), 401);
    assert.deepEqual(errors,[]);
    process.stdout.write('Chromium desktop + 390px smoke passed: rubric lookup and study chart, recording, mocked local transcription, case draft, review and logout.\n');
  } finally {await browser.close();srv.close();}
})().catch(error=>{console.error(error);srv.close();process.exitCode=1;});
