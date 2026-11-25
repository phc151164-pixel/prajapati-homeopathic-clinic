(() => {
  'use strict';

  const endpoint = 'smart-clinic';
  const normalize = text => text.normalize('NFC').toLowerCase().replace(/œ/g, 'oe')
    .normalize('NFD').replace(/([a-z])\p{M}+/gu, '$1').normalize('NFC');
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
  function medicineSections(text) {
    const sections = [];
    let current = {heading: 'Overview', text: ''};
    for (const line of text.split(/\r?\n/u)) {
      const marker = line.match(/^\s*([\p{L}][\p{L} &/’'-]{0,48})\.\s*(?:[–—]{1,2}|--+)\s*(.*)$/u);
      if (marker) {
        if (current.text.trim()) sections.push(current);
        current = {heading: marker[1].trim(), text: marker[2]};
      } else {
        current.text += (current.text ? '\n' : '') + line;
      }
    }
    if (current.text.trim()) sections.push(current);
    return sections;
  }

  if (typeof module !== 'undefined') {
    module.exports = {draftChart, medicineSections};
    return;
  }

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
      ui.modal('Consultation document', [detail, ...fields, chart, classical, formatDraft, voice, consultationRecorder()], values => ui.api(endpoint, {
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

  function studyWorkflow() {
    const guide = node('details');
    guide.className = 'card';
    guide.append(node('summary', 'Study workflow'));
    const steps = [
      ['Case Taking', 'Record the complaints, history and general symptoms described in a study case.'],
      ['Symptom Analysis', 'Classify observations as mental generals, physical generals or particular symptoms.'],
      ['Evaluation of Symptoms', 'Distinguish characteristic observations from common ones.'],
      ['Totality of Symptoms', 'Organise the selected observations into one case summary.'],
      ['Rubric Selection', 'Find and review corresponding historical rubrics and sub-rubrics.'],
      ['Repertorial Analysis', 'Compare how historical sources recorded the selected rubrics and grades.'],
      ['Materia Medica Reference', 'Read the corresponding historical descriptions in the Medicine section.']
    ];
    const list = node('ol');
    for (const [heading, description] of steps) {
      const item = node('li');
      item.append(node('strong', heading), node('p', description));
      list.append(item);
    }
    const methods = node('ul');
    for (const method of ['J. T. Kent · General to Particular',
      'Bönninghausen · Particular to General', 'C. M. Boger · Pathological and General Approach']) {
      methods.append(node('li', method));
    }
    const glossary = node('dl');
    for (const [term, meaning] of [
      ['Mental Generals', 'Observations about mood, emotions or thinking.'],
      ['Physical Generals', 'Whole-person observations such as sleep, appetite or temperature preferences.'],
      ['Particular Symptoms', 'Observations tied to a specific complaint or body area.'],
      ['Modalities', 'Circumstances in which a symptom changes.'],
      ['Concomitant Symptoms', 'Other symptoms that occur alongside the main complaint.'],
      ['LSMC', 'Location, Sensation, Modality and Concomitant.'],
      ['Rubrics and Sub-rubrics', 'Standard repertory headings and their narrower categories.'],
      ['Remedy Gradation', 'The grade recorded by the source for an entry.'],
      ['Totality of Symptoms', 'The selected observations considered together.'],
      ['Susceptibility', 'A historical term describing a person’s responsiveness to influences.']
    ]) {
      glossary.append(node('dt', term), node('dd', meaning));
    }
    const medicine = action('Open Medicine', () => {
      document.querySelector('#nav button[data-section="medicines"]')?.click();
    });
    guide.append(node('p', 'Traditional historical workflow for educational study.'),
      node('h2', 'Seven steps'), list, node('h2', 'Traditional methods'), methods,
      node('h2', 'Terminology'), glossary, medicine);
    return guide;
  }

  async function repertorisation(container, api) {
    const {repertory, boericke, progress} = await api(endpoint + '?section=library');
    const entries = [repertory, boericke].flatMap((index, position) =>
      index.rubrics.map(rubric => ({
        id: rubric.id,
        label: [rubric.chapter, ...rubric.path].join(' → '),
        terms: rubric.aliases,
        source: position === 0 ? 'Kent' : 'Boericke'
      })));
    const saved = new Map(progress.map(item => [item.book_id, item]));
    const selected = new Set(entries.filter(entry => saved.get(entry.id)?.bookmarked).map(entry => entry.id));
    const panel = node('section');
    panel.className = 'card';
    const input = node('input');
    input.type = 'search';
    const label = node('label', 'Search historical rubrics');
    label.append(input);
    const results = node('ul');
    const selection = node('ul');
    const status = node('p');
    status.setAttribute('role', 'status');
    let saving = false;
    const save = action('Save study list', async () => {
      saving = true;
      render();
      try {
        for (const entry of entries) {
          const prior = saved.get(entry.id);
          if (Boolean(prior?.bookmarked) === selected.has(entry.id)) continue;
          const {progress: updated} = await api(endpoint, {
            action: 'progress', bookId: entry.id,
            bookmarked: selected.has(entry.id), note: prior?.note || ''
          });
          saved.set(entry.id, updated);
        }
        status.textContent = 'Study list saved.';
      } catch (error) {
        status.textContent = error.message;
      } finally {
        saving = false;
        render();
      }
    });
    function render() {
      const terms = normalize(input.value).trim().split(/\s+/u);
      const matching = entries.filter(entry => terms.every(term =>
        normalize(entry.label + ' ' + entry.source + ' ' + entry.terms).includes(term)));
      results.replaceChildren();
      selection.replaceChildren();
      for (const entry of matching) {
        const item = node('li');
        const add = action('Add ' + entry.label + ' (' + entry.source + ')', () => {
          selected.add(entry.id);
          status.textContent = '';
          render();
        });
        add.disabled = saving || selected.has(entry.id);
        item.append(add);
        results.append(item);
      }
      if (!matching.length) results.append(node('li', 'No matching rubrics in the current index.'));
      for (const entry of entries.filter(entry => selected.has(entry.id))) {
        const item = node('li');
        const remove = action('Remove ' + entry.label + ' (' + entry.source + ')', () => {
          selected.delete(entry.id);
          status.textContent = '';
          render();
        });
        remove.disabled = saving;
        item.append(remove);
        selection.append(item);
      }
      if (!selected.size) selection.append(node('li', 'No rubrics selected.'));
      save.disabled = saving || !entries.some(entry =>
        Boolean(saved.get(entry.id)?.bookmarked) !== selected.has(entry.id));
    }
    input.addEventListener('input', render);
    panel.append(node('p', entries.length + ' indexed rubrics for historical study.'),
      label, node('h2', 'Search results'), results,
      node('h2', 'Selected rubrics'), selection, save, status);
    render();
    container.replaceChildren(studyWorkflow(), panel);
  }

  const medicineNames = new Map(Object.entries({
    "ABADILLA": "SABADILLA",
    "ABINA": "SABINA",
    "ANICULA AQUA": "SANICULA AQUA",
    "ARISTOLOCHIA MILHOMEN": "ARISTOLOCHIA MILHOMENS",
    "BERBERIS VULGARI": "BERBERIS VULGARIS",
    "BLATTA ORIENTALI": "BLATTA ORIENTALIS",
    "BOLETUS LARICI": "BOLETUS LARICIS",
    "EDUM ACRE": "SEDUM ACRE",
    "ENEGA": "SENEGA",
    "ENNA": "SENNA",
    "GRAPHITE": "GRAPHITES",
    "HOMARU": "HOMARUS",
    "LOBELIA PURPURASCEN": "LOBELIA PURPURASCENS",
    "MOSCHU": "MOSCHUS",
    "RICINUS COMMUNI": "RICINUS COMMUNIS",
    "TIGMATA MAYDI": "STIGMATA MAYDIS",
    "UCCINUM": "SUCCINUM",
    "ULPHUR": "SULPHUR",
    "YPHILINUM": "SYPHILINUM"
}));

  async function medicines(container, api) {
    const panel = node('section');
    panel.className = 'card';
    const storageKey = 'phc-boericke-materia-medica';
    const url = endpoint + '?section=medicines';
    const notice = node('p', 'Historical reference only. This is not a treatment guide.');
    const picker = node('input');
    picker.type = 'file';
    picker.accept = '.json,application/json';
    const importLabel = node('label', 'Import Boericke medicine data');
    importLabel.append(picker);
    const status = node('p');
    status.setAttribute('role', 'status');
    const search = node('input');
    search.type = 'search';
    const searchLabel = node('label', 'Find medicine by name');
    searchLabel.append(search);
    const list = node('ul');
    const detail = node('article');
    detail.className = 'card';
    detail.hidden = true;
    let entries = [];
    function load(raw) {
      const data = JSON.parse(raw);
      const records = data?.medicines;
      if (!Array.isArray(records) || records.length === 0 || records.length > 1500 ||
          records.some(record => typeof record?.name !== 'string' || !record.name.trim() ||
            record.name.length > 150 || !Number.isInteger(record.page) ||
            record.page < 1 || record.page > 595 || typeof record.text !== 'string' ||
            record.text.length > 50000)) throw Error('Choose the Boericke_Medicines.json file.');
      entries = records.map(record => ({...record, name: medicineNames.get(record.name.trim().toUpperCase()) || record.name}))
        .sort((a, b) => a.name.localeCompare(b.name, 'en'));
    }
    function render() {
      const query = normalize(search.value).trim();
      const matching = entries.filter(record => normalize(record.name).includes(query));
      list.replaceChildren();
      status.textContent = entries.length ? matching.length + ' historical entries' : 'Import the medicine data file to open the alphabetical list.';
      for (const record of matching) {
        const item = node('li');
        item.append(action(record.name, () => {
          const title = node('h2', record.name);
          title.tabIndex = -1;
          const close = action('Back to medicine list', () => {
            detail.replaceChildren();
            detail.hidden = true;
            searchLabel.hidden = list.hidden = false;
            search.focus();
          });
          detail.replaceChildren(title, node('p', 'Boericke, ninth edition · PDF page ' + record.page), close);
          for (const entry of medicineSections(record.text)) {
            const section = node('section');
            section.append(node('h3', entry.heading));
            for (const paragraph of entry.text.trim().split(/\n\s*\n/u)) {
              section.append(node('p', paragraph.replace(/\n/u, ' ')));
            }
            detail.append(section);
          }
          searchLabel.hidden = list.hidden = true;
          detail.hidden = false;
          title.focus();
        }));
        list.append(item);
      }
    }
    picker.addEventListener('change', async () => {
      const file = picker.files[0];
      if (!file) return;
      try {
        if (file.size > 1900000) throw Error('The file exceeds the 1.9 MB upload limit.');
        const raw = await file.text();
        const data = JSON.parse(raw);
        await api(url, {medicines: data.medicines});
        load(raw);
        try { localStorage.removeItem(storageKey); } catch {}
        detail.replaceChildren();
        detail.hidden = true;
        searchLabel.hidden = list.hidden = false;
        render();
      } catch (error) {
        status.textContent = error.message;
      }
    });
    search.addEventListener('input', render);
    picker.disabled = true;
    panel.append(notice, importLabel, status, searchLabel, list, detail);
    container.replaceChildren(panel);
    status.textContent = 'Loading your saved medicines…';
    try {
      const result = await api(url);
      if (!panel.isConnected) return;
      if (result.medicines.length) {
        load(JSON.stringify(result));
      } else {
        const sync = action('Save this browser’s imported list to my account', async () => {
          sync.disabled = true;
          try {
            const raw = localStorage.getItem(storageKey);
            if (!raw) throw Error('Import the medicine data file first.');
            await api(url, {medicines: JSON.parse(raw).medicines});
            load(raw);
            localStorage.removeItem(storageKey);
            sync.remove();
            render();
          } catch (error) {
            status.textContent = error.message;
            sync.disabled = false;
          }
        });
        if (localStorage.getItem(storageKey)) importLabel.after(sync);
      }
      render();
    } catch (error) {
      status.textContent = error.message;
    } finally {
      picker.disabled = false;
    }
  }

  window.PHCSmartClinic = {
    consultation, repertorisation, medicines,
    close() {
      consultationRequest++;
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
