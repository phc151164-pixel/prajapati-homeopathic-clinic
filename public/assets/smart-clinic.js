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
  function transcriptDraft(transcript) {
    // Spoken headings can delimit sections even when recognition returns one line.
    const labels = /(?:^|[.?!।]\s+|\n+)(chief complaint|duration|patient history|मुख्य शिकायत|अवधि|मरीज का इतिहास)\s*[:：,]?\s+(?=\S)/giu;
    return draftChart(transcript.replace(labels, (match, heading, offset) => {
      const prefix = match.slice(0, match.indexOf(heading)).trim();
      return (offset ? prefix + '\n' : '') + heading + ': ';
    }));
  }

  const symptomVocabulary = [
    [/सिर (?:में )?दर्द|(?:sar|sir) (?:me(?:in)? )?dard|headache/giu, 'head pain'],
    [/खाँसी|खांसी|खासी|kha?nsi|khasi|cough(?:ing)?/giu, 'cough'],
    [/दबाव|dabav|dabaav|pressing/giu, 'pressing'],
    [/दाहिनी तरफ|दाईं तरफ|dahini taraf|right side/giu, 'right'],
    [/बाईं तरफ|baayi taraf|bain taraf|left side/giu, 'left'],
    [/झुकने पर|jhukne par|stooping/giu, 'stooping'],
    [/कनपटी|kanpati|temples?/giu, 'temples'],
    [/अंधेरा|अँधेरा|andhera|darkness/giu, 'darkness']
  ];
  function englishSearchTerms(text) {
    if (/(?:नहीं|नही|बिना)|\b(?:no|not|never|without|nahi|nahin|nhi)\b/iu.test(text)) return '';
    return symptomVocabulary.filter(([pattern]) => text.search(pattern) !== -1)
      .map(([, words]) => words).join(' ');
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
    module.exports = {draftChart, transcriptDraft, englishSearchTerms, medicineSections};
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
  function consentCheckbox(name, text, checked = false) {
    const label = node('label', text);
    const input = node('input');
    input.type = 'checkbox';
    input.name = name;
    input.value = 'yes';
    input.checked = checked;
    label.prepend(input);
    return label;
  }

  async function consultation(visit, ui) {
    const request = ++consultationRequest;
    try {
      const {document: saved} = await ui.api(endpoint + '?section=consultation&visitId=' + visit.id);
      if (request !== consultationRequest) return;
      const fields = [
        consentCheckbox('consent', 'Patient consented to structured documentation', Boolean(saved)),
        ui.field('history', 'Patient-reported history', 'textarea', saved?.history),
        ui.field('observations', 'Clinician observations', 'textarea', saved?.observations),
        ui.field('follow_up', 'Clinician follow-up plan', 'textarea', saved?.follow_up),
        ui.field('reviewed', 'Review status', 'select', 'no', [
          ['no', 'Save as draft'], ['yes', 'I am a qualified clinician and reviewed this version']
        ])
      ];
      for (const label of fields.slice(1, 4)) label.querySelector('textarea').maxLength = 3000;
      fields[0].querySelector('input').required = true;
      const detail = ui.el('p', saved?.reviewed_at ?
        'Last saved version reviewed on ' + new Date(saved.reviewed_at).toLocaleString('en-IN') :
        'Drafts require review by a qualified clinician.');
      const history = fields[1].querySelector('textarea');
      const transcript = ui.field('transcriptPreview', 'Editable transcript preview', 'textarea', '');
      const preview = transcript.querySelector('textarea');
      preview.removeAttribute('name');
      const study = node('div');
      const studyStatus = node('p');
      studyStatus.setAttribute('role', 'status');
      const openStudy = action('Review symptoms and find rubrics', async () => {
        if (!preview.value.trim()) {
          studyStatus.textContent = 'Record or enter a transcript first.';
          return;
        }
        openStudy.disabled = true;
        studyStatus.textContent = 'Loading historical rubric index…';
        try {
          await repertorisation(study, ui.api, preview.value);
          studyStatus.textContent = '';
        } catch (error) {
          studyStatus.textContent = error.message;
        } finally {
          openStudy.disabled = false;
        }
      });
      preview.addEventListener('input', () => study.replaceChildren());
      const useTranscript = action('Create draft from transcript', () => {
        const draft = transcriptDraft(preview.value.trim());
        if (!draft) return ui.message('Add or transcribe some text first.', true, 'editorMessage');
        const combined = [history.value.trimEnd(), draft].filter(Boolean).join('\n');
        if (combined.length > history.maxLength) {
          return ui.message('Shorten the transcript or history before adding this draft.', true, 'editorMessage');
        }
        history.value = combined;
        ui.message('Draft added. Review the wording before saving.', false, 'editorMessage');
        history.focus();
      });
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
      ui.modal('Consultation document', [detail, ...fields, chart, classical, formatDraft, consultationRecorder(preview, ui), transcript, useTranscript, openStudy, studyStatus, study], values => ui.api(endpoint, {
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

  function consultationRecorder(preview, ui) {
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
    const voice = recordingTranscription(preview, ui);
    const audio = node('audio');
    audio.controls = true;
    audio.hidden = true;
    const status = node('p');
    status.setAttribute('role', 'status');
    let recorder, stream, url, timer, clock, startedAt, capturedMs = 0;
    const duration = node('p', 'Recorded time 00:00');
    function updateDuration() {
      const seconds = Math.floor((capturedMs + (startedAt === undefined ? 0 : performance.now() - startedAt)) / 1000);
      duration.textContent = 'Recorded time ' + String(Math.floor(seconds / 60)).padStart(2, '0')
        + ':' + String(seconds % 60).padStart(2, '0');
    }
    function freezeDuration() {
      if (startedAt !== undefined) capturedMs += performance.now() - startedAt;
      startedAt = undefined;
      clearInterval(clock);
      updateDuration();
    }
    let generation = 0;
    function release() {
      generation++;
      voice.abort();
      clearTimeout(timer);
      if (recorder && recorder.state !== 'inactive') recorder.stop();
      stream?.getTracks().forEach(track => track.stop());
      if (url) URL.revokeObjectURL(url);
      url = null;
      audio.pause();
      audio.removeAttribute('src');
      audio.hidden = true;
      freezeDuration();
      capturedMs = 0;
      updateDuration();
      pause.disabled = resume.disabled = discard.disabled = stop.disabled = true;
    }
    disposeRecording = release;
    const stop = action('Stop recording', () => {
      if (recorder && recorder.state !== 'inactive') recorder.stop();
    });
    stop.disabled = true;
    const pause = action('Pause recording', () => {
      if (recorder?.state !== 'recording') return;
      voice.stop();
      recorder.pause();
      freezeDuration();
      pause.disabled = true;
      resume.disabled = false;
      status.textContent = 'Recording paused.';
    });
    const resume = action('Resume recording', () => {
      if (recorder?.state !== 'paused') return;
      recorder.resume();
      void voice.start(stream.getAudioTracks()[0]);
      startedAt = performance.now();
      clock = setInterval(updateDuration, 1000);
      pause.disabled = false;
      resume.disabled = true;
      status.textContent = 'Recording on this device.';
    });
    const discard = action('Delete recording', () => {
      release();
      status.textContent = 'Recording deleted.';
    });
    pause.disabled = resume.disabled = discard.disabled = true;
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
          voice.stop();
          clearTimeout(timer);
          captured.getTracks().forEach(track => track.stop());
          start.disabled = false;
          stop.disabled = pause.disabled = resume.disabled = true;
          freezeDuration();
          if (!chunks.length) {
            status.textContent = 'No audio was captured.';
            return;
          }
          url = URL.createObjectURL(new Blob(chunks, {type: recorder.mimeType}));
          audio.src = url;
          audio.hidden = false;
          discard.disabled = false;
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
        void voice.start(captured.getAudioTracks()[0]);
        stop.disabled = pause.disabled = false;
        startedAt = performance.now();
        clock = setInterval(updateDuration, 1000);
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
    box.append(node('p', 'Audio stays in this tab and is discarded when you close the form.'), label, start, pause, resume, stop, discard, duration, status, audio, voice.box);
    return box;
  }

  function recordingTranscription(target, ui) {
    const box = node('div');
    const status = node('p');
    status.setAttribute('role', 'status');
    const Speech = window.SpeechRecognition || window.webkitSpeechRecognition;
    const supported = typeof Speech?.available === 'function' && 'processLocally' in Speech.prototype;
    const language = ui.field('voiceLanguage', 'On-device transcription language', 'select', 'hi-IN',
      [['hi-IN', 'Hindi'], ['en-IN', 'English (India)']]);
    const consent = consentCheckbox('voiceConsent', 'Patient consented to on-device transcription');
    const checkbox = consent.querySelector('input');
    const select = language.querySelector('select');
    let recognition, generation = 0;
    const stop = () => {
      if (recognition) recognition.stop();
      else generation++;
    };
    const abort = () => {
      generation++;
      recognition?.abort();
      recognition = null;
    };
    checkbox.addEventListener('change', () => {
      if (checkbox.checked) return;
      abort();
      target.value = '';
      status.textContent = 'Transcript preview cleared.';
    });
    async function start(track) {
      if (!supported || !checkbox.checked || recognition || track?.readyState !== 'live') return;
      const token = ++generation;
      const lang = select.value;
      try {
        const availability = await Speech.available({langs: [lang], processLocally: true});
        if (token !== generation || track.readyState !== 'live') return;
        if (availability !== 'available') {
          status.textContent = 'Install the selected language pack before recording with transcription.';
          return;
        }
        recognition = new Speech();
        recognition.processLocally = true;
        recognition.continuous = true;
        recognition.lang = lang;
        recognition.onresult = event => {
          if (token !== generation) return;
          const additions = [];
          for (let i = event.resultIndex; i < event.results.length; i++) {
            if (event.results[i].isFinal) additions.push(event.results[i][0].transcript.trim());
          }
          if (additions.length) target.value = [target.value, ...additions].filter(Boolean).join(' ');
        };
        recognition.onerror = () => {
          if (token === generation) status.textContent = 'Transcription stopped. You can still review the audio and type the transcript.';
        };
        recognition.onend = () => {
          if (token === generation) recognition = null;
        };
        recognition.start(track);
        status.textContent = 'Transcribing on this device. Review the transcript before adding it to the case.';
      } catch {
        if (token !== generation) return;
        abort();
        status.textContent = 'This browser could not transcribe the recording track.';
      }
    }
    stopDictation = abort;
    if (supported) {
      box.append(language, consent);
      if (typeof Speech.install === 'function') {
        const install = action('Install selected language pack', async () => {
          install.disabled = true;
          try {
            const installed = await Speech.install({langs: [select.value], processLocally: true});
            status.textContent = installed ? 'Language pack installed.' : 'Language pack installation was unavailable.';
          } catch {
            status.textContent = 'Language pack installation was unavailable.';
          } finally {
            install.disabled = false;
          }
        });
        box.append(install);
      }
    } else {
      status.textContent = 'On-device transcription is unavailable here. Play the recording and type into the editable transcript preview.';
    }
    box.append(status);
    return {box, start, stop, abort};
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

  async function repertorisation(container, api, transcript) {
    const {repertory, boericke, progress} = await api(endpoint + '?section=library');
    const entries = [repertory, boericke].flatMap((index, position) =>
      index.rubrics.map(rubric => ({
        id: rubric.id,
        label: [rubric.chapter, ...rubric.path].join(' → '),
        terms: rubric.aliases,
        source: position === 0 ? 'Kent' : 'Boericke',
        chapter: rubric.chapter,
        page: rubric.page,
        edition: index.edition
      })));
    const sessionStudy = transcript !== undefined;
    const saved = new Map((sessionStudy ? [] : progress).map(item => [item.book_id, item]));
    const selected = new Set(entries.filter(entry => saved.get(entry.id)?.bookmarked).map(entry => entry.id));
    const panel = node('section');
    panel.className = 'card';
    const input = node('input');
    input.type = 'search';
    const label = node('label', 'Search historical rubrics');
    label.append(input);
    const results = node('ul');
    const review = node('div');
    if (sessionStudy) {
      const excerptList = node('ul');
      const symptom = node('input');
      const symptomLabel = node('label', 'Review and edit symptom wording');
      const english = node('input');
      const englishLabel = node('label', 'English rubric search terms');
      englishLabel.append(english);
      const translate = () => {
        english.value = englishSearchTerms(symptom.value);
      };
      symptom.addEventListener('input', translate);
      symptomLabel.append(symptom);
      const excerpts = [...new Set(transcript.split(/[.!?।;\n]+/u).map(text => text.trim()).filter(Boolean))];
      for (const excerpt of excerpts.slice(0, 30)) {
        const item = node('li');
        item.append(action(excerpt, () => {
          symptom.value = excerpt;
          translate();
          symptom.focus();
        }));
        excerptList.append(item);
      }
      review.append(node('h3', 'Review transcript excerpts'),
        node('p', 'Choose an excerpt and keep only the confirmed symptom words. Check for negation and who reported the symptom.'),
        excerptList, symptomLabel,
        node('p', 'English suggestions cover common indexed terms. Check the meaning before searching.'),
        englishLabel, action('Find matching rubrics', () => {
          input.value = english.value.trim() || symptom.value.trim();
          render();
        }));
    }
    const selection = node('ul');
    const chart = node('table');
    const header = chart.createTHead().insertRow();
    for (const label of ['Historical source', 'Chapter', 'Selected entries']) {
      header.append(node('th', label));
    }
    const chartBody = chart.createTBody();
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
      const query = normalize(input.value).trim();
      const terms = query.split(/\s+/u);
      const matching = sessionStudy && !query ? [] : entries.filter(entry => terms.every(term =>
        normalize(entry.label + ' ' + entry.source + ' ' + entry.terms).includes(term)));
      results.replaceChildren();
      selection.replaceChildren();
      for (const entry of matching.slice(0, 40)) {
        const item = node('li');
        const add = action('Add ' + entry.label + ' (' + entry.source + ')', () => {
          selected.add(entry.id);
          status.textContent = '';
          render();
        });
        add.disabled = saving || selected.has(entry.id);
        item.append(add, node('p', entry.edition + ' · Page ' + entry.page));
        results.append(item);
      }
      if (!matching.length) results.append(node('li', sessionStudy && !query ?
        'Enter reviewed symptom words to find historical rubrics.' : 'No matching rubrics in the current index.'));
      if (matching.length > 40) results.append(node('li', 'Showing 40 of ' + matching.length + ' matches. Refine your search to see more.'));
      const groups = new Map();
      for (const entry of entries.filter(entry => selected.has(entry.id))) {
        const key = entry.source + ' / ' + entry.chapter;
        const group = groups.get(key) || {source: entry.source, chapter: entry.chapter, count: 0};
        group.count++;
        groups.set(key, group);
        const item = node('li');
        const remove = action('Remove ' + entry.label + ' (' + entry.source + ')', () => {
          selected.delete(entry.id);
          status.textContent = '';
          render();
        });
        remove.disabled = saving;
        item.append(remove, node('p', entry.edition + ' · Page ' + entry.page));
        selection.append(item);
      }
      chartBody.replaceChildren();
      for (const group of groups.values()) {
        const row = chartBody.insertRow();
        for (const value of [group.source, group.chapter, group.count]) row.insertCell().textContent = value;
      }
      chart.hidden = !selected.size;
      if (!selected.size) selection.append(node('li', 'No rubrics selected.'));
      save.disabled = saving || !entries.some(entry =>
        Boolean(saved.get(entry.id)?.bookmarked) !== selected.has(entry.id));
    }
    input.addEventListener('input', render);
    panel.append(node('p', entries.length + ' indexed rubrics for historical study.'),
      review, label, node('h2', 'Search results'), results,
      node('h2', 'Selected rubrics'), selection, chart);
    if (!sessionStudy) panel.append(save, status);
    render();
    container.replaceChildren(panel);
    if (!sessionStudy) container.append(studyWorkflow());
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
