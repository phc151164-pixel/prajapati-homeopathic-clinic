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
    [/स[िे]र\s+(?:में\s+)?दर्द|\b(?:sar|sir|seer)\s+(?:me(?:in)?\s+)?dard\b|\bheadache\b/giu, 'head pain', 'Head'],
    [/खाँसी|खांसी|खासी|\b(?:khansi|khasi|khaansi|khaasi|cough(?:ing)?)\b/giu, 'cough', 'Cough'],
    [/दबाव|dabav|dabaav|pressing/giu, 'pressing'],
    [/दाहिनी तरफ|दाईं तरफ|dahini taraf|right side/giu, 'right'],
    [/बाईं तरफ|baayi taraf|bain taraf|left side/giu, 'left'],
    [/झुकने पर|jhukne par|stooping/giu, 'stooping'],
    [/कनपटी|kanpati|temples?/giu, 'temples'],
    [/अंधेरा|अँधेरा|andhera|darkness/giu, 'darkness'],
    [/मतली|जी मिचल|matli|jee michal|\bnausea\b/giu, 'nausea'],
    [/उल्टी|उलटी|\bulti\b|vomit(?:ing)?/giu, 'vomiting'],
    [/दस्त|\bdast\b|diarrh[oe]+a/giu, 'diarrh'],
    [/कब्ज़?|\bkabz\b|constipation/giu, 'constipation'],
    [/चक्कर|\bchakkar\b|dizz(?:y|iness)|vertigo/giu, 'vertigo'],
    [/प्यास|प्‍यास|\bpyaas\b|thirst/giu, 'thirst'],
    [/जलन|\bjalan\b|burning/giu, 'burning'],
    [/बुखार|\bbukhar\b|fever/giu, 'fever']
  ];
  // Common spoken phrases mapped to words printed in Kent's chapter/rubric headings.
  const chapterVocabulary = [
    ['Mind', 'anxiety', /घबराहट|बेचैनी|\b(?:ghabrahat|bechaini|anxious|anxiety)\b/iu],
    ['Vertigo', 'vertigo', /चक्कर|\b(?:chakkar|dizzy|dizziness|vertigo)\b/iu],
    ['Eye', 'pain', /आँख(?:ों)?\s*(?:में\s*)?दर्द|आंख(?:ों)?\s*(?:में\s*)?दर्द|\b(?:eye pain|aankh (?:mein |me )?dard)\b/iu],
    ['Vision', 'dim', /धुंधला\s*(?:दिख|देख)|धुँधला\s*(?:दिख|देख)|\b(?:blurred vision|blurry vision|dhundhla dikh)\b/iu],
    ['Ear', 'pain', /कान\s*(?:में\s*)?दर्द|\b(?:earache|ear pain|kaan (?:mein |me )?dard)\b/iu],
    ['Hearing', 'impaired', /कम\s*सुनाई|सुनाई\s*कम|\b(?:hearing loss|poor hearing|kam sunai)\b/iu],
    ['Nose', 'sneezing', /छींक|\b(?:chheenk|cheenk|sneez\w*)\b/iu],
    ['Nose', 'discharge', /नाक\s*(?:बह|से पानी)|\b(?:runny nose|naak beh\w*)\b/iu],
    ['Face', 'pain', /चेहरे\s*(?:में\s*)?दर्द|\b(?:facial pain|face pain|chehre (?:mein |me )?dard)\b/iu],
    ['Mouth', 'dryness', /मुँह\s*सूख|मुंह\s*सूख|\b(?:dry mouth|munh sookh\w*)\b/iu],
    ['Teeth', 'pain', /दाँत\s*(?:में\s*)?दर्द|दांत\s*(?:में\s*)?दर्द|\b(?:toothache|tooth pain|daant (?:mein |me )?dard)\b/iu],
    ['Throat', 'pain', /गल[ेा]\s*(?:में\s*)?(?:दर्द|खराश)|\b(?:sore throat|throat pain|gale (?:mein |me )?(?:dard|kharash))\b/iu],
    ['External Throat', 'swelling', /गर्दन\s*(?:में\s*|की\s*)?सूजन|\b(?:neck swelling|swollen neck|gardan (?:mein |me )?sujan)\b/iu],
    ['Stomach', 'nausea', /मतली|जी मिचल|\b(?:matli|jee michal|nausea|nauseous)\b/iu],
    ['Stomach', 'vomiting', /उल्टी|उलटी|\b(?:ulti|vomit\w*)\b/iu],
    ['Stomach', 'thirst', /प्यास|प्‍यास|\b(?:pyaas|pyas|thirsty|thirst)\b/iu],
    ['Abdomen', 'pain', /पेट\s*(?:में\s*)?दर्द|\b(?:abdominal pain|belly pain|stomachache|pet (?:mein |me )?dard)\b/iu],
    ['Rectum', 'constipation', /कब्ज़?|\b(?:kabz|constipat\w*)\b/iu],
    ['Rectum', 'diarrh', /दस्त|\b(?:dast|diarrh[oe]+a)\b/iu],
    ['Stool', 'hard', /सख्त\s*मल|कड़ा\s*मल|\b(?:hard stools?|sakht mal)\b/iu],
    ['Bladder', 'urging frequent', /बार[ -]*बार\s*(?:पेशाब|मूत्र)|\b(?:frequent urination|baar baar peshab)\b/iu],
    ['Kidneys', 'pain', /गुर्द[ेो]\s*(?:में\s*)?दर्द|\b(?:kidney pain|gurde (?:mein |me )?dard)\b/iu],
    ['Prostate gland', 'swelling', /प्रोस्टेट\s*(?:में\s*|की\s*)?सूजन|\b(?:swollen prostate|prostate swelling)\b/iu],
    ['Urethra', 'burning', /पेशाब\s*(?:के समय|करते समय|में)\s*जलन|\b(?:burning urination|burning (?:when|while) urinating|peshab mein jalan)\b/iu],
    ['Urine', 'bloody', /पेशाब\s*में\s*खून|\b(?:blood in (?:the )?urine|bloody urine|peshab mein khoon)\b/iu],
    ['Genitalia Male', 'pain testes', /अंडकोष\s*(?:में\s*)?दर्द|\b(?:testicular pain|testicle pain)\b/iu],
    ['Genitalia Female', 'menses painful', /पीरियड\s*(?:में\s*|का\s*)?दर्द|दर्दनाक\s*माहवारी|\b(?:painful periods|menstrual cramps|period pain)\b/iu],
    ['Larynx and Trachea', 'hoarseness', /आवा[ज़ज]\s*(?:बैठ|भारी)|\b(?:hoarse(?:ness)?|awaz baith\w*)\b/iu],
    ['Respiration', 'difficult', /साँस\s*फूल|सांस\s*फूल|साँस\s*लेने\s*में\s*दिक्कत|\b(?:shortness of breath|difficulty breathing|saans phool\w*)\b/iu],
    ['Expectoration', 'bloody', /बलगम\s*में\s*खून|\b(?:blood in (?:the )?phlegm|bloody sputum|balgam mein khoon)\b/iu],
    ['Chest', 'pain', /सीने\s*(?:में\s*)?दर्द|\b(?:chest pain|seene (?:mein |me )?dard)\b/iu],
    ['Back', 'pain lumbar', /कमर\s*(?:में\s*)?दर्द|\b(?:lower back pain|kamar (?:mein |me )?dard)\b/iu],
    ['Back', 'pain', /पीठ\s*(?:में\s*)?दर्द|\b(?:back pain|backache|peeth (?:mein |me )?dard)\b/iu],
    ['Sleep', 'sleeplessness', /अनिद्रा|नींद\s*(?:की कमी|आने में दिक्कत)|\b(?:insomnia|sleeplessness|trouble sleeping)\b/iu],
    ['Chill', 'shaking', /कंपकंपी|कँपकँपी|\b(?:shivering|kapkapi|chills)\b/iu],
    ['Fever', 'heat in general', /बुखार|\b(?:bukhar|fever)\b/iu],
    ['Perspiration', 'profuse', /बहुत\s*पसीना|ज्यादा\s*पसीना|\b(?:excessive sweating|sweating a lot|zyada pasina)\b/iu],
    ['Skin', 'itching', /खुजली|\b(?:khujli|itching|itchy)\b/iu],
    ['Generalities', 'weakness', /कमज़ोरी|कमजोरी|\b(?:general weakness|weakness|kamzori|kamjori)\b/iu],
  ];
  const spokenFillers = new Set('i have has had am feel feeling got get getting feels there is are was were be been it its my me a an the to of in on at for from with very really some much little also too and or please patient reports says said chief complaint duration this that just one two three four five six seven eight nine ten day days week weeks month months'.split(' '));
  function spokenEnglishTerms(text) {
    if (!/^[a-z\d\s,'’()-]+$/iu.test(text)) return '';
    const words = (normalize(text).match(/[a-z]+/g) || []).filter(word => !spokenFillers.has(word));
    return words.length > 0 && words.length < 7 ? [...new Set(words)].join(' ') : '';
  }
  const chapterHits = text => chapterVocabulary.filter(([, , pattern]) => pattern.test(text));
  const extremityLocations = [
    [/घुटन[ाेों]|\b(?:ghutn[ae]|ghutan[ae]|knees?)\b/iu, 'knee'],
    [/टखन[ाेों]|\b(?:takhn[ae]|ankles?)\b/iu, 'ankle'],
    [/कोहन[ीि]|\b(?:kohni|elbows?)\b/iu, 'elbow'],
    [/कलाई|कलाइ|\b(?:kalai|wrists?)\b/iu, 'wrist'],
    [/कंध[ाेों]|कन्ध[ाेों]|\b(?:kandh[ae]|shoulders?)\b/iu, 'shoulder'],
    [/जांघ|जाँघ|\b(?:jaangh|jangh|thighs?)\b/iu, 'thigh'],
    [/पिंडल[ीि]|\b(?:pindli|calves|calf)\b/iu, 'calf'],
    [/एड़[ीि]|एड[ीि]|\b(?:edi|aedi|heels?)\b/iu, 'heel'],
    [/तलव[ाेों]|\b(?:talw[ae]|soles?)\b/iu, 'sole'],
    [/उंगली|उँगली|अंगुली|उंगलि|उँगलि|\b(?:ungli|ungliyan|fingers?)\b/iu, 'fingers'],
    [/हाथ|\b(?:haath|hath|hands?)\b/iu, 'hand'],
    [/बांह|बाँह|बाजू|\b(?:baazu|bazu|arms?)\b/iu, 'arm'],
    [/\b(?:foot|feet)\b/iu, 'foot'],
    [/पैर|पाँव|पांव|टांग|टाँग|\b(?:pair|paon|paanv|taang|tang|legs?)\b/iu, 'leg']
  ];
  const regionalSymptoms = [
    [/दर्द|पीड़ा|\b(?:dard|pain(?:ful)?|ache[sd]?|aching|hurts?)\b/iu, 'pain'],
    [/सूजन|सुजन|\b(?:sujan|soojan|swelling|swollen)\b/iu, 'swelling'],
    [/सुन्न|\b(?:sunn|numb(?:ness)?)\b/iu, 'numbness'],
    [/झनझन|झुनझुन|\b(?:jhanjhan\w*|tingl\w*)\b/iu, 'tingling'],
    [/अकड़|अकड|जकड़|\b(?:akad\w*|jakad\w*|stiff(?:ness)?)\b/iu, 'stiffness'],
    [/ऐंठन|मरोड़|\b(?:ainthan|cramp(?:s|ing)?)\b/iu, 'cramping'],
    [/कमज़ोरी|कमजोरी|\b(?:kamzori|kamjori|weak(?:ness)?)\b/iu, 'weakness']
  ];
  const headLocations = [
    [/माथ[ाे]|\b(?:math[ae]|maath[ae]|forehead)\b/iu, 'forehead'],
    [/कनपटी|\b(?:kanpati|temples?)\b/iu, 'temples'],
    [/स[िे]र\s+के\s+पीछे|\b(?:back of (?:the )?head|(?:sir|sar) ke (?:peechhe|piche)|occiput)\b/iu, 'occiput'],
  ];
  const coughQualifiers = [
    [/सूख[ीि]|\b(?:dry|sookhi|sukhi)\b/iu, 'dry'],
    [/बलगम|कफ|\b(?:balgam|phlegm|wet|productive)\b/iu, 'loose'],
    [/रात|\b(?:raat|rat|night)\b/iu, 'night'],
    [/सुबह|\b(?:subah|morning)\b/iu, 'morning'],
    [/शाम|\b(?:shaam|sham|evening)\b/iu, 'evening'],
  ];
  const hasHead = /स[िे]र|\b(?:head|sir|seer|sar)\b/iu;
  const findTerms = (rules, text) => rules.filter(([pattern]) => pattern.test(text)).map(([, label]) => label);
  const negation = /(?:नहीं|नही|बिना)|\b(?:no|not|never|without|nahi|nahin|nhi)\b/iu;
  const clauseBoundary = /\s*(?:[,，]|(?<![\p{L}\p{M}])(?:and|aur|और|तथा|or(?=\s+[^,]+\bbhi\b))(?![\p{L}\p{M}]))\s*/iu;
  const symptomTerms = new Set(['head pain', 'cough', 'nausea', 'vomiting', 'diarrh', 'constipation', 'vertigo', 'thirst', 'fever']);
  function detectedTerms(text) {
    return symptomVocabulary.filter(([pattern]) => text.search(pattern) !== -1);
  }

  function hasSymptom(text) {
    if (chapterHits(text).length || detectedTerms(text).some(([, term]) => symptomTerms.has(term))) return true;
    return findTerms(regionalSymptoms, text).length > 0 &&
      (hasHead.test(text) || findTerms(headLocations, text).length > 0 ||
        findTerms(extremityLocations, text).length > 0);
  }
  const relativeClause = /^(?:when|while|during|with)\b|^(?:जब|जैसे ही)\s/u;
  function transcriptExcerpts(text) {
    const excerpts = [];
    for (const sentence of text.match(/[^.!?।;\n]+[?]?/gu)?.map(part => part.trim()).filter(Boolean) || []) {
      // A qualifier such as “and pressure” belongs to the preceding symptom.
      // Keep negated lists together so an uncertain negation cannot turn into an affirmed symptom.
      if (negation.test(sentence) || sentence.endsWith('?')) {
        excerpts.push(sentence);
        continue;
      }
      let cursor = 0;
      for (const boundary of sentence.matchAll(new RegExp(clauseBoundary, 'giu'))) {
        const before = sentence.slice(cursor, boundary.index).trim();
        const after = sentence.slice(boundary.index + boundary[0].length).split(clauseBoundary)[0].trim();
        if (!relativeClause.test(normalize(after)) && hasSymptom(before) && hasSymptom(after)) {
          excerpts.push(before);
          cursor = boundary.index + boundary[0].length;
        }
      }
      excerpts.push(sentence.slice(cursor).trim());
    }
    return [...new Set(excerpts)];
  }

  function rubricSearchContext(text) {
    if (negation.test(text) || /\?|\b(?:maybe|possibly|whether|perhaps)\b/iu.test(text)) return {terms: '', chapter: ''};
    const matches = detectedTerms(text);
    const location = findTerms(extremityLocations, text)[0];
    const regional = findTerms(regionalSymptoms, text);
    const headParts = findTerms(headLocations, text);
    const head = matches.some(([, , chapter]) => chapter === 'Head') ||
      regional.includes('pain') && (hasHead.test(text) || headParts.length > 0);
    const cough = matches.some(([, , chapter]) => chapter === 'Cough');
    const limbs = Boolean(location && regional.length);
    const linked = /(?:ख[ााँ]+सी|खाँसने|खांसने)\s*(?:के समय|के दौरान|पर|से)|\b(?:khansi|khasi|cough)\s+(?:ke samay|ke dauran|par|se)\b|\b(?:when|while|on|during|with)\s+coughing\b|\b(?:when|while)\s+(?:i\s+)?cough\b/iu.test(text);
    const regionalHits = chapterHits(text).filter(([chapter]) => chapter !== 'Generalities' || !limbs);
    const otherChapters = new Set(regionalHits.map(([chapter]) => chapter));
    if (otherChapters.size > 1 || (otherChapters.size > 0 && (head || cough || limbs))) return {terms: '', chapter: ''};
    // Ambiguous mentions need review before they become a combined search.
    if ((head && cough && !linked) || (limbs && (head || cough))) return {terms: '', chapter: ''};
    if (limbs) {
      const root = [regional[0], location];
      const side = findTerms([
        [/दाहिन[ेीा]|दाएँ|दाएं|दाय[ेीं]|\b(?:right|dahin[aei]|daay[aein]+)\b/iu, 'right'],
        [/बाएँ|बाएं|बाय[ेीं]|\b(?:left|baay[aein]+|bain)\b/iu, 'left']
      ], text);
      return {terms: [...root, ...side].join(' '), chapter: 'Extremities',
        ...(side.length ? {broaderTerms: root.join(' ')} : {})};
    }
    const terms = matches.map(([, words]) => words);
    if (head) {
      return {terms: [...new Set(['head pain', ...terms.filter(term => term !== 'cough' || linked), ...headParts])].join(' '),
        chapter: 'Head'};
    }
    if (cough) {
      const qualifiers = findTerms(coughQualifiers, text);
      return {terms: ['cough', ...qualifiers].join(' '), chapter: 'Cough',
        ...(qualifiers.length > 1 ? {broaderTerms: ['cough', qualifiers[0]].join(' ')} : {})};
    }
    if (regionalHits.length === 1) {
      const [[chapter, query]] = regionalHits;
      return {terms: query, chapter};
    }
    if (regionalHits.length > 1) return {terms: '', chapter: ''};
    return {terms: terms.join(' ') || spokenEnglishTerms(text), chapter: ''};
  }

  function englishSearchTerms(text) {
    return rubricSearchContext(text).terms;
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
    module.exports = {draftChart, transcriptDraft, englishSearchTerms, transcriptExcerpts, rubricSearchContext, medicineSections};
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
  let kentAccount, kentWorker, kentReady;
  let kentCount = 0;
  let kentFromAccount = false;
  let kentMessage = 0;
  const kentPending = new Map();
  const kentDetails = new Map();
  function closeKent() {
    kentWorker?.terminate();
    kentWorker = kentReady = undefined;
    kentCount = 0;
    kentFromAccount = false;
    kentDetails.clear();
    for (const {reject} of kentPending.values()) reject(Error('The Kent index was closed.'));
    kentPending.clear();
  }
  function kentRequest(action, data = {}) {
    return new Promise((resolve, reject) => {
      const id = ++kentMessage;
      kentPending.set(id, {resolve, reject});
      try {
        kentWorker.postMessage({...data, id, action});
      } catch (error) {
        kentPending.delete(id);
        reject(error);
      }
    });
  }
  function openKent() {
    if (!kentAccount || !window.DecompressionStream || !window.indexedDB || !window.Worker) return Promise.resolve();
    if (kentReady) return kentReady;
    const worker = new Worker('/assets/kent-index-worker.js?v=5');
    kentWorker = worker;
    worker.onmessage = ({data}) => {
      const pending = kentPending.get(data.id);
      if (!pending) return;
      kentPending.delete(data.id);
      if (data.error) pending.reject(Error(data.error));
      else pending.resolve(data.result);
    };
    worker.onerror = () => {
      if (worker === kentWorker) closeKent();
    };
    kentReady = kentRequest('open', {account: kentAccount}).then(({count, accountIndex}) => {
      if (worker === kentWorker) {
        kentCount = count;
        kentFromAccount = accountIndex;
      }
    }).catch(error => {
      if (worker === kentWorker) closeKent();
      throw error;
    });
    return kentReady;
  }

  function kentImport(onChange) {
    const box = node('details');
    const picker = node('input');
    picker.type = 'file';
    picker.accept = '.gz,application/gzip';
    const label = node('label', 'Choose reconciled Kent JSONL.GZ');
    label.append(picker);
    const status = node('p');
    status.setAttribute('role', 'status');
    const showCount = () => {
      const source = kentFromAccount ? ' available from your PHC account.' : ' available on this browser.';
      status.textContent = kentCount ? kentCount.toLocaleString('en-IN') + ' Kent rubrics' + source
        : 'Import the reconciled Kent index to search the complete set.';
      label.hidden = kentFromAccount;
    };
    status.textContent = 'Checking your PHC account for the Kent index…';
    void openKent().then(() => {
      if (kentWorker) showCount();
      else {
        picker.disabled = true;
        status.textContent = 'Private Kent import is unavailable in this browser.';
      }
    }).catch(error => { status.textContent = error.message; });
    picker.addEventListener('change', async () => {
      const file = picker.files[0];
      if (!file || kentFromAccount) return;
      picker.disabled = true;
      status.textContent = 'Checking the Kent index…';
      try {
        await openKent().catch(() => {});
        const {count} = await kentRequest('import', {file});
        kentCount = count;
        kentDetails.clear();
        showCount();
        onChange();
      } catch (error) {
        status.textContent = error.message;
      } finally {
        picker.disabled = false;
        picker.value = '';
      }
    });
    box.append(node('summary', 'Private Kent index'), status,
      node('p', 'An index saved to your PHC account loads on each supported browser after sign-in.'), label);
    return box;
  }

  const kentRubric = rubric => ({
    ...rubric, source: 'Kent', edition: 'Private Kent reference',
    pageLabel: 'PDF page ' + rubric.page, privateKent: true
  });

  async function historicalMatches(entries, queries, limit) {
    await openKent().catch(() => {});
    const usePrivateKent = kentCount > 0;
    const usable = usePrivateKent ? entries.filter(entry => entry.source !== 'Kent') : entries;
    const lookup = usePrivateKent ? queries.flatMap(({query, chapter, broaderTerms}) =>
      [query, broaderTerms || ''].map(term => ({query: term, chapter, limit}))) : [];
    const privateMatches = lookup.length ? await kentRequest('search', {queries: lookup}) : [];
    return queries.map(({query, chapter}, index) => {
      const terms = normalize(query).trim().split(/\s+/u);
      const fallback = query.trim() ? usable.filter(entry =>
        (!chapter || normalize(entry.chapter) === normalize(chapter)) && terms.every(term => entry.words.includes(term))) : [];
      const exact = privateMatches[index * 2];
      const broader = !exact?.total && !fallback.length && Boolean(privateMatches[index * 2 + 1]?.total);
      const local = broader ? privateMatches[index * 2 + 1] : exact;
      const matches = (local?.matches || []).map(kentRubric);
      return {total: (local?.total || 0) + fallback.length, broader, fullKent: usePrivateKent,
        matches: [...matches, ...fallback.slice(0, limit)].slice(0, limit)};
    });
  }

  function studyEntries({repertory, boericke}) {
    return [repertory, boericke].flatMap((index, i) => index.rubrics.map(rubric => {
      const label = [rubric.chapter, ...rubric.path].join(' → ');
      const source = i === 0 ? 'Kent' : 'Boericke';
      return {...rubric, label, source, edition: index.edition, pageLabel: 'Page ' + rubric.page,
        words: normalize(label + ' ' + source + ' ' + rubric.aliases),
        medicines: rubric.historicalMedicines, pageUrl: index.pages[rubric.page]};
    }));
  }

  async function loadRubric(entry) {
    if (!entry.privateKent) return entry;
    if (!kentDetails.has(entry.id)) {
      if (kentDetails.size >= 25) kentDetails.delete(kentDetails.keys().next().value);
      kentDetails.set(entry.id, kentRequest('details', {rubricId: entry.id}).catch(error => {
        kentDetails.delete(entry.id);
        throw error;
      }));
    }
    return {...entry, ...await kentDetails.get(entry.id)};
  }

  function sourceExcerpt(lines, expanded = false) {
    const box = node('details');
    box.open = expanded;
    box.append(node('summary', 'Show PDF source excerpt'));
    for (const line of lines) {
      const passage = node('p');
      passage.className = 'kent-source-excerpt';
      passage.append(node('small', 'PDF page ' + line.pdfPage), node('br'));
      for (const span of line.spans) {
        const run = node(span.bold ? 'strong' : 'span');
        const color = span.displayColor || span.color;
        if (/^#[a-f0-9]{6}$/i.test(color)) run.style.color = color;
        run.append(span.italic ? node('em', span.text) : document.createTextNode(span.text));
        passage.append(run);
      }
      box.append(passage);
    }
    return box;
  }

  function historicalMedicineReference(medicines, pageUrl) {
    if (!medicines?.length) return node('p', 'Medicine entries have not been verified for this rubric.');
    const details = node('details');
    details.append(node('summary', 'Historical medicine entries'));
    const list = node('ul');
    for (const {name, abbreviation, grade, type} of medicines) {
      list.append(node('li', name + ' (' + abbreviation + ') · ' +
        (grade == null ? 'Grade unverified' : 'Grade ' + grade + ' (' + type + ')')));
    }
    details.append(list);
    if (pageUrl) {
      const link = node('a', 'View source scan');
      link.href = pageUrl;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      details.append(link);
    }
    return details;
  }

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
      const liveChart = node('div');
      liveChart.setAttribute('aria-label', 'Live historical study chart');
      const liveStatus = node('p');
      liveStatus.setAttribute('role', 'status');
      let liveIndex;
      let chartVersion = 0;
      let liveTimer;
      const selection = new Map();
      let studyPanel, studyLoading;
      const study = node('div');
      const studyStatus = node('p');
      studyStatus.setAttribute('role', 'status');
      async function library() {
        liveIndex ||= ui.api(endpoint + '?section=library').catch(error => {
          liveIndex = undefined;
          throw error;
        });
        return liveIndex;
      }
      async function showStudy() {
        if (studyPanel) {
          studyPanel.refreshTranscript();
          return studyPanel;
        }
        studyLoading ||= (async () => {
          const data = await library();
          if (!preview.isConnected) return;
          studyPanel = await repertorisation(study, ui.api, () => preview.value, {data, selection});
          return studyPanel;
        })().finally(() => { studyLoading = undefined; });
        return studyLoading;
      }
      async function updateLiveChart() {
        const version = ++chartVersion;
        const text = preview.value.trim();
        liveChart.replaceChildren();
        liveStatus.textContent = '';
        if (!text) return;
        const excerpts = transcriptExcerpts(text)
          .map(excerpt => ({excerpt, ...rubricSearchContext(excerpt)})).slice(-30);
        try {
          const entries = studyEntries(await library());
          const matches = await historicalMatches(entries, excerpts.map(({terms, chapter, broaderTerms}) => ({
            query: terms, chapter, broaderTerms
          })), 5);
          if (version !== chartVersion || !preview.isConnected) return;
          const table = node('table');
          table.className = 'kent-study-table';
          const header = table.createTHead().insertRow();
          for (const heading of ['Spoken excerpt', 'English symptom terms', 'Historical rubric candidates']) {
            header.append(node('th', heading));
          }
          const body = table.createTBody();
          for (const [i, {excerpt, terms, chapter}] of excerpts.entries()) {
            const row = body.insertRow();
            for (const value of [excerpt, terms || 'Review needed']) row.insertCell().textContent = value;
            const candidates = node('ul');
            const {matches: rubrics, total, broader, fullKent} = matches[i];
            if (broader) candidates.append(node('li', 'Broader source rubrics. Check the missing qualifier.'));
            for (const rubric of rubrics) {
              const item = node('li');
              item.append(action(rubric.label + ' · ' + rubric.source + ' · ' + rubric.pageLabel, async () => {
                try {
                  const panel = await showStudy();
                  await panel?.review(excerpt, terms, rubric.id);
                } catch (error) {
                  studyStatus.textContent = error.message;
                }
              }));
              candidates.append(item);
            }
            if (!rubrics.length) {
              const note = !terms ? 'Review the wording or use the chapter browser to find a rubric.'
                : !fullKent && ['Cough', 'Extremities'].includes(chapter)
                  ? 'Import the full Private Kent index on this browser to search ' + chapter + '.'
                  : 'No matching source rubric. Review the excerpt or revise the search terms.';
              candidates.append(node('li', note));
            }
            if (total > rubrics.length) candidates.append(node('li', total + ' matches in rubric review.'));
            row.insertCell().append(candidates);
          }
          liveChart.append(table);
          liveStatus.textContent = 'Draft suggestions. Review each excerpt and select the matching rubric to build the chart.';
        } catch (error) {
          if (version === chartVersion) liveStatus.textContent = error.message;
        }
      }
      function refreshLiveChart() {
        chartVersion++;
        clearTimeout(liveTimer);
        liveTimer = setTimeout(updateLiveChart, 180);
        studyPanel?.refreshTranscript();
      }
      preview.addEventListener('input', refreshLiveChart);
      preview.addEventListener('phc:transcript-ready', () => {
        if (preview.value.trim()) void showStudy().catch(error => { studyStatus.textContent = error.message; });
      });
      const importKent = kentImport(() => {
        for (const [id, rubric] of selection) {
          if (rubric.source === 'Kent') selection.delete(id);
        }
        studyPanel?.refreshIndex();
        refreshLiveChart();
      });
      const openStudy = action('Review symptoms and find rubrics', async () => {
        if (!preview.value.trim()) {
          studyStatus.textContent = 'Record or enter a transcript first.';
          return;
        }
        openStudy.disabled = true;
        try {
          await showStudy();
          studyStatus.textContent = '';
        } catch (error) {
          studyStatus.textContent = error.message;
        } finally {
          openStudy.disabled = false;
        }
      });
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
      ui.modal('Consultation document', [detail, ...fields, chart, classical, formatDraft, consultationRecorder(preview, ui), transcript, ui.el('h3', 'Live symptom and rubric draft'), importKent, liveStatus, liveChart, useTranscript, openStudy, studyStatus, study], values => ui.api(endpoint, {
        action: 'consultation', visitId: visit.id, version: saved?.version || 0,
        history: draftChart(values.history), observations: values.observations, follow_up: values.follow_up,
        consent: values.consent === 'yes', reviewed: values.reviewed === 'yes'
      }));
      document.getElementById('editor').addEventListener('close', () => {
        clearTimeout(liveTimer);
        chartVersion++;
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
      clearTimeout(timer);
      freezeDuration();
      pause.disabled = true;
      resume.disabled = false;
      status.textContent = 'Recording paused.';
    });
    const resume = action('Resume recording', () => {
      if (recorder?.state !== 'paused') return;
      recorder.resume();
      timer = setTimeout(() => stop.click(), Math.max(0, voice.limit - capturedMs));
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
      if (url) {
        status.textContent = 'A recording is already available. Delete it before starting another. Your transcript will stay in the preview.';
        return;
      }
      release();
      const token = generation;
      start.disabled = true;
      try {
        if (!await voice.prepare() || token !== generation) {
          if (token === generation) start.disabled = false;
          return;
        }
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
          const recording = new Blob(chunks, {type: recorder.mimeType});
          url = URL.createObjectURL(recording);
          void voice.transcribeRecording(recording);
          if (voice.usedLiveRecognition) preview.dispatchEvent(new Event('phc:transcript-ready'));
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
        timer = setTimeout(() => stop.click(), voice.limit);
        status.textContent = 'Recording on this device. Maximum ' + (voice.limit / 60000) + ' minutes per recording.';
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
    const sarvamConsent = consentCheckbox('sarvamConsent', 'Use Saaras v4 for this synthetic test clip. Audio will be sent to Sarvam.');
    const sarvam = sarvamConsent.querySelector('input');
    let useSarvam = false;
    const select = language.querySelector('select');
    let recognition, worker, fallbackLanguage, generation = 0;
    const stop = () => {
      if (recognition) recognition.stop();
      else generation++;
    };
    const abort = () => {
      generation++;
      worker?.terminate();
      worker = null;
      recognition?.abort();
      recognition = null;
    };
    checkbox.addEventListener('change', () => {
      if (checkbox.checked) return;
      abort();
      target.value = '';
      target.dispatchEvent(new Event('input'));
      status.textContent = 'Transcript preview cleared.';
    });
    async function prepare(installOnly = false) {
      if (!installOnly) {
        fallbackLanguage = undefined;
        useSarvam = sarvam.checked;
        if (useSarvam) return true;
      }
      if (!installOnly && !checkbox.checked) return true;
      const useFallback = () => {
        if (!installOnly && checkbox.checked) fallbackLanguage = select.value === 'hi-IN' ? 'hindi' : 'english';
        status.textContent = 'PHC transcription will run on this device after you stop recording. The first run downloads model files.';
        return true;
      };
      if (!supported || (!installOnly && select.value === 'hi-IN')) return useFallback();
      const options = {langs: [select.value], processLocally: true};
      try {
        let availability = await Speech.available(options);
        if (availability === 'downloadable' && typeof Speech.install === 'function') {
          status.textContent = 'Installing the language pack. Recording will start when it is ready.';
          await Speech.install(options);
          availability = await Speech.available(options);
        }
        if (!installOnly && !checkbox.checked) return false;
        const languageName = options.langs[0] === 'hi-IN' ? 'Hindi' : 'English (India)';
        if (availability === 'available') {
          status.textContent = languageName + ' is ready for on-device transcription.';
          return true;
        }
        const messages = {
          downloading: 'The language pack is downloading. Wait and check again.',
          downloadable: 'Chrome offers this language pack, but the download did not finish. Check your connection and try again.',
          unavailable: languageName + ' on-device transcription is unavailable in this Chrome installation.'
        };
        if (!installOnly) return useFallback();
        status.textContent = messages[availability] || 'Chrome returned an unknown language pack status.';
      } catch {
        if (!installOnly) return useFallback();
        status.textContent = 'Could not prepare on-device transcription. Check the language pack and try again.';
      }
      return false;
    }
    async function start(track) {
      if (useSarvam || fallbackLanguage || !supported || !checkbox.checked || recognition || track?.readyState !== 'live') return;
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
          if (additions.length) {
            target.value = [target.value, ...additions].filter(Boolean).join('\n');
            target.dispatchEvent(new Event('input'));
          }
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
    async function transcribeRecording(recording) {
      if (useSarvam) {
        if (!sarvam.checked) return;
        const token = generation;
        status.textContent = 'Transcribing test clip with Saaras v4…';
        try {
          const context = new AudioContext();
          let decoded;
          try {
            decoded = await context.decodeAudioData(await recording.arrayBuffer());
          } finally {
            await context.close();
          }
          const offline = new OfflineAudioContext(1, Math.ceil(decoded.duration * 16000), 16000);
          const source = offline.createBufferSource();
          source.buffer = decoded;
          source.connect(offline.destination);
          source.start();
          const samples = (await offline.startRendering()).getChannelData(0);
          let receivedText = false;
          const chunkSize = 25 * 16000;
          for (let offset = 0; offset < samples.length; offset += chunkSize) {
            if (token !== generation || !sarvam.checked) return;
            status.textContent = 'Saaras is transcribing part ' + (offset / chunkSize + 1) +
              ' of ' + Math.ceil(samples.length / chunkSize) + '…';
            const part = samples.subarray(offset, offset + chunkSize);
            const buffer = new ArrayBuffer(44 + part.length * 2);
            const view = new DataView(buffer);
            for (const [position, tag] of [[0, 'RIFF'], [8, 'WAVE'], [12, 'fmt '], [36, 'data']]) {
              for (let i = 0; i < tag.length; i++) view.setUint8(position + i, tag.charCodeAt(i));
            }
            for (const [position, value] of [[4, buffer.byteLength - 8], [16, 16], [24, 16000], [28, 32000], [40, part.length * 2]]) {
              view.setUint32(position, value, true);
            }
            for (const [position, value] of [[20, 1], [22, 1], [32, 2], [34, 16]]) view.setUint16(position, value, true);
            part.forEach((value, i) => view.setInt16(44 + i * 2, Math.max(-1, Math.min(1, value)) * 32767, true));
            const bytes = new Uint8Array(buffer);
            const blocks = [];
            for (let i = 0; i < bytes.length; i += 8192) blocks.push(String.fromCharCode(...bytes.subarray(i, i + 8192)));
            const {text} = await ui.api(endpoint + '?section=transcription', {
              consent: true, mime: 'audio/wav', audio: btoa(blocks.join(''))
            });
            if (token !== generation || !sarvam.checked) return;
            if (text.trim()) {
              receivedText = true;
              target.value = [target.value.trimEnd(), text.trim()].filter(Boolean).join('\n');
              target.dispatchEvent(new Event('input'));
            }
          }
          if (receivedText) target.dispatchEvent(new Event('phc:transcript-ready'));
          status.textContent = receivedText ? 'Saaras transcript ready for review.' : 'Saaras returned an empty transcript.';
        } catch (error) {
          if (token === generation) {
            status.textContent = error.message + (target.value ? ' Review the text already available before saving.' : '');
            target.dispatchEvent(new Event('input'));
          }
        }
        return;
      }
      if (!fallbackLanguage || !checkbox.checked) return;
      const token = generation;
      let context;
      status.textContent = 'Preparing the recording and loading the on-device model…';
      try {
        context = new AudioContext();
        const buffer = await context.decodeAudioData(await recording.arrayBuffer());
        const offline = new OfflineAudioContext(1, Math.ceil(buffer.duration * 16000), 16000);
        const source = offline.createBufferSource();
        source.buffer = buffer;
        source.connect(offline.destination);
        source.start();
        const samples = (await offline.startRendering()).getChannelData(0);
        if (token !== generation || !checkbox.checked) return;
        worker = new Worker('/assets/phc-transcription-worker-local.js', {type: 'module'});
        const fail = reason => {
          if (token !== generation) return;
          worker?.terminate();
          worker = null;
          status.textContent = reason + ' The recording is still available for playback.';
        };
        worker.onerror = () => fail('Could not start the local transcription engine.');
        worker.onmessage = ({data}) => {
          if (token !== generation) return;
          if (data.processing) {
            status.textContent = 'Transcribing locally…';
            return;
          }
          if (data.failed) return fail(data.failed === 'download' ? 'Could not download or initialize the Hindi speech model.' : 'The local speech model could not process this recording.');
          worker.terminate();
          worker = null;
          if (data.text) {
            target.value = [target.value.trimEnd(), data.text.trim()].filter(Boolean).join('\n');
            target.dispatchEvent(new Event('input'));
            target.dispatchEvent(new Event('phc:transcript-ready'));
          }
          status.textContent = data.text ? 'Transcript ready. Review it before saving.' : 'No speech recognized.';
        };
        worker.postMessage({samples, language: fallbackLanguage}, [samples.buffer]);
      } catch {
        if (token === generation) status.textContent = 'Could not decode or process the recorded audio.';
      } finally {
        if (context) await context.close().catch(() => {});
      }
    }
    stopDictation = abort;
    box.append(language, consent, sarvamConsent);
    if (supported) {
      if (typeof Speech.install === 'function') {
        const install = action('Install selected language pack', async () => {
          install.disabled = true;
          try {
            await prepare(true);
          } finally {
            install.disabled = false;
          }
        });
        box.append(install);
      }
    } else {
      status.textContent = 'PHC can transcribe the audio on this device after recording stops.';
    }
    box.append(status);
    return {box, prepare, start, stop, abort, transcribeRecording, get usedLiveRecognition() { return !useSarvam && !fallbackLanguage && checkbox.checked; }, get limit() { return useSarvam ? 40 * 60 * 1000 : 900000; }};
  }

  function kentPrivateReader() {
    const box = node('details');
    const picker = node('input');
    picker.type = 'file';
    picker.accept = '.html,text/html';
    const label = node('label', 'Choose Kent_Repertory_Formatted.html');
    label.append(picker);
    const search = node('input');
    search.type = 'search';
    const searchLabel = node('label', 'Search your Kent reference');
    searchLabel.append(search);
    const status = node('p');
    status.setAttribute('role', 'status');
    const results = node('div');
    let lines = [];
    function copy(source, target) {
      for (const child of source.childNodes) {
        if (child.nodeType === 3) {
          target.append(child.textContent);
          continue;
        }
        const tag = child.nodeName.toLowerCase();
        if (!['span', 'strong', 'i', 'br'].includes(tag)) continue;
        const item = node(tag);
        const color = child.getAttribute('style')?.match(/^color:(#[a-f0-9]{6})$/i);
        if (tag === 'span' && color) item.style.color = color[1];
        copy(child, item);
        target.append(item);
      }
    }
    function render() {
      results.replaceChildren();
      const query = normalize(search.value).trim();
      if (!query || !lines.length) return;
      const matches = lines.filter(line => line.text.includes(query));
      status.textContent = matches.length + ' matching passages. Showing up to 30.';
      for (const match of matches.slice(0, 30)) {
        const passage = node('p');
        copy(match.paragraph, passage);
        const result = node('article');
        result.className = 'card';
        result.style.backgroundColor = '#fff';
        result.style.color = '#000';
        result.append(node('h3', match.page), passage);
        results.append(result);
      }
    }
    search.addEventListener('input', render);
    picker.addEventListener('change', async () => {
      lines = [];
      results.replaceChildren();
      const file = picker.files[0];
      if (!file) return;
      status.textContent = 'Reading your local reference…';
      try {
        if (file.size > 25 * 1024 * 1024) throw Error('Choose a formatted Kent file under 25 MB.');
        const template = node('template');
        template.innerHTML = await file.text();
        const pages = template.content.querySelectorAll('section[id^="page-"]');
        if (!pages.length) throw Error('Choose the formatted Kent reference file.');
        for (const page of pages) {
          for (const paragraph of page.querySelectorAll('p')) {
            lines.push({page: 'PDF page ' + page.id.slice(5), paragraph, text: normalize(paragraph.textContent)});
          }
        }
        status.textContent = pages.length + ' pages loaded. Enter a heading or phrase.';
        render();
      } catch (error) {
        status.textContent = error.message;
      }
    });
    box.append(node('summary', 'Kent Repertory · Private formatted reference'),
      node('p', 'Open your formatted copy to search the original text with its colours, bold and italics. The file stays in this tab.'),
      label, searchLabel, status, results);
    return box;
  }

  function boerickeOcrReader() {
    const reader = node('details');
    reader.className = 'phc-repertory-ocr';
    // Visually checked against the uploaded scan, printed pages 553–554.
    const verifiedItalics = new Map([
      ['AWKWARD', ['Apis', 'Bov.', 'Nat. m.']],
      ['CATALEPSY', ['Acon.', 'Can. ind.', 'Crot. casc.', 'morph.', 'Mosch.', 'Op.']],
      ['COMPREHENSION —Easy', ['Coff.']],
      ['Coma Vigil', ['Hyos.']],
      ['Rapid answering', ['Lach.']],
      ['Slow answering, relapses', ['Helleb.', 'Phos. ac.']]
    ]);
    const secondPageItalics = new Map([
      ['Epileptic', ['Be//.', 'Cupr. ac.', 'CEnanibe', 'Sil.']],
      ['Masturbatic', ['Agn.', 'Phos. ac.', 'Staph.']],
      ['Senile', ['Aur. iod.', 'Bar. c.', 'Phos.']],
      ['Syphilitic', ['Kali iod.']],
      ['Jealousy', ['Lach.']],
      ['Joy, excessive', ['Coff.']],
      ['Shame, mortification, reserved displeasure', ['Staph.']],
      ['Downward motion, falling', ['Bor.', 'Sanic.']],
      ['Motion', ['Bry.']],
      ['Music', ['Acon.', 'Ambra.', 'Nat. c.', 'Sab.']]
    ]);
    function formattedLine(line, index) {
      const trimmed = line.trim();
      if (/^[A-Z][A-Z ,&()'’-]{2,65}$/u.test(trimmed)) return node('h3', line);
      const split = line.match(/^(.{2,105}?)([—–]|:\s)(.*)$/u);
      const paragraph = node('p');
      if (split && /\p{L}/u.test(split[1])) {
        paragraph.append(node('strong', split[1]), split[2]);
        const words = (index < 22 ? verifiedItalics : index < 51 ? secondPageItalics : null)?.get(split[1].trim()) || [];
        let offset = 0;
        for (const word of words) {
          const start = split[3].indexOf(word, offset);
          if (start === -1) continue;
          paragraph.append(split[3].slice(offset, start), node('i', word));
          offset = start + word.length;
        }
        paragraph.append(split[3].slice(offset));
      } else {
        paragraph.textContent = line;
      }
      return paragraph;
    }
    const status = node('p');
    status.setAttribute('role', 'status');
    const search = node('input');
    search.type = 'search';
    const label = node('label', 'Search the Boericke repertory OCR');
    label.append(search);
    const results = node('div');
    let lines;
    function render() {
      if (!lines) return;
      const query = normalize(search.value).trim();
      results.replaceChildren();
      if (!query) {
        status.textContent = 'Search a heading or phrase, or open the full OCR below.';
        return;
      }
      const matches = lines.flatMap((line, index) => normalize(line).includes(query) ? [{line, index}] : []);
      status.textContent = matches.length + ' matching lines' + (matches.length > 60 ? '. Showing the first 60.' : '.');
      for (const {line, index} of matches.slice(0, 60)) results.append(formattedLine(line, index));
    }
    search.addEventListener('input', render);
    const full = node('details');
    full.append(node('summary', 'Read full repertory and index'));
    full.addEventListener('toggle', () => {
      if (!full.open || !lines || full.children.length > 1) return;
      const content = document.createDocumentFragment();
      lines.forEach((line, index) => {
        if (line.trim()) content.append(formattedLine(line, index));
      });
      full.append(content);
    });
    const original = node('a', 'Read the original scan with printed italics');
    original.href = 'https://archive.org/details/materiamedicawit0000will/page/553/mode/2up';
    original.target = '_blank';
    original.rel = 'noopener noreferrer';
    const source = node('p');
    source.append(original);
    reader.append(node('summary', 'Boericke Repertory · Full OCR'),
      source,
      node('p', 'Oscar E. Boericke · Ninth edition, 1927 · Historical reference. OCR may contain errors. Italics are shown where checked against printed page 553.'),
      label, status, results, full);
    let loading = false;
    reader.addEventListener('toggle', async () => {
      if (!reader.open || lines || loading) return;
      loading = true;
      full.hidden = true;
      status.textContent = 'Loading repertory OCR…';
      try {
        const response = await fetch('/assets/boericke-repertory-1927-ocr.txt');
        if (!response.ok) throw Error('Could not load the repertory OCR.');
        lines = (await response.text()).split('\n');
        full.hidden = false;
        render();
      } catch {
        status.textContent = 'Could not load the repertory OCR. Close and reopen this section to retry.';
      } finally {
        loading = false;
      }
    });
    return reader;
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

  async function repertorisation(container, api, transcript, options = {}) {
    const data = options.data || await api(endpoint + '?section=library');
    const entries = studyEntries(data);
    const sessionStudy = Boolean(transcript);
    const saved = new Map((sessionStudy ? [] : data.progress).map(item => [item.book_id, item]));
    const selected = options.selection || new Map(entries.filter(entry => saved.get(entry.id)?.bookmarked)
      .map(entry => [entry.id, entry]));
    const panel = node('section');
    panel.className = 'card';
    const input = node('input');
    input.type = 'search';
    const label = node('label', 'Search historical rubrics');
    label.append(input);
    const chapterPicker = node('select');
    const chapterLabel = node('label', 'Kent chapter');
    chapterLabel.append(chapterPicker);
    const chapterSummary = node('p');
    chapterSummary.setAttribute('role', 'status');
    let browseOffset = 0;
    let chapterRequest = 0;
    const previous = action('Previous rubrics', () => {
      browseOffset -= 40;
      void renderResults();
    });
    const next = action('Next rubrics', () => {
      browseOffset += 40;
      void renderResults();
    });
    const pager = node('div');
    pager.hidden = true;
    pager.append(previous, next);
    async function refreshChapters() {
      const request = ++chapterRequest;
      const chosen = chapterPicker.value;
      try {
        await openKent();
        if (request !== chapterRequest) return;
        const counts = kentCount ? await kentRequest('chapters') : [];
        if (request !== chapterRequest) return;
        chapterPicker.replaceChildren(new Option('All chapters', ''));
        for (const {chapter, count} of counts) {
          chapterPicker.add(new Option(chapter + ' (' + count.toLocaleString('en-IN') + ')', chapter));
        }
        chapterPicker.value = counts.some(({chapter}) => chapter === chosen) ? chosen : '';
        chapterPicker.disabled = !counts.length;
        chapterSummary.textContent = counts.length
          ? counts.length + ' Kent chapters · ' + kentCount.toLocaleString('en-IN') + ' rubrics'
          : 'The full Kent index is required to browse chapters.';
      } catch {
        if (request === chapterRequest) chapterSummary.textContent = 'Kent chapters could not be loaded.';
      }
    }
    chapterPicker.disabled = true;
    chapterPicker.add(new Option('All chapters', ''));
    chapterPicker.addEventListener('change', () => {
      clearTimeout(searchTimer);
      browseOffset = 0;
      reviewChapter = '';
      reviewBroaderTerms = undefined;
      void renderResults();
    });
    const results = node('ul');
    const review = node('div');
    const excerptList = node('ul');
    let excerptLimit = 30;
    const moreExcerpts = action('Show more transcript excerpts', () => {
      excerptLimit += 30;
      refreshTranscript();
    });
    const symptom = node('input');
    const english = node('input');
    let reviewChapter = '';
    let reviewBroaderTerms;
    const reviewNotice = node('p');
    reviewNotice.setAttribute('role', 'status');
    async function reviewExcerpt(excerpt, terms = englishSearchTerms(excerpt), preferredId) {
      symptom.value = excerpt;
      chapterPicker.value = '';
      browseOffset = 0;
      ({chapter: reviewChapter, broaderTerms: reviewBroaderTerms} = rubricSearchContext(excerpt));
      reviewNotice.textContent = '';
      english.value = terms;
      input.value = terms;
      await renderResults(preferredId);
    }
    function refreshTranscript() {
      if (!sessionStudy) return;
      const excerpts = transcriptExcerpts(transcript());
      excerptList.replaceChildren();
      moreExcerpts.hidden = excerpts.length <= excerptLimit;
      for (const excerpt of excerpts.slice(0, excerptLimit)) {
        const item = node('li');
        item.append(action(excerpt, () => {
          void reviewExcerpt(excerpt);
          symptom.focus();
        }));
        excerptList.append(item);
      }
    }
    if (sessionStudy) {
      const symptomLabel = node('label', 'Review and edit symptom wording');
      const englishLabel = node('label', 'English rubric search terms');
      englishLabel.append(english);
      symptom.addEventListener('input', () => {
        const {terms, chapter, broaderTerms} = rubricSearchContext(symptom.value);
        english.value = terms;
        reviewChapter = chapter;
        reviewBroaderTerms = broaderTerms;
        reviewNotice.textContent = '';
      });
      symptomLabel.append(symptom);
      review.append(node('h3', 'Review transcript excerpts'),
        node('p', 'Choose an excerpt and confirm what the patient reported before adding a rubric.'),
        excerptList, moreExcerpts, symptomLabel, englishLabel, action('Find matching rubrics', () => {
          if (transcriptExcerpts(symptom.value).length > 1) {
            reviewNotice.textContent = 'Choose one symptom excerpt at a time for rubric search.';
            return;
          }
          if (english.value.trim() !== englishSearchTerms(symptom.value)) reviewBroaderTerms = undefined;
          input.value = english.value.trim() || symptom.value.trim();
          void renderResults();
        }), reviewNotice);
    }
    const selection = node('ul');
    const chart = node('table');
    chart.className = 'kent-study-table';
    const header = chart.createTHead().insertRow();
    for (const label of ['Historical source', 'Chapter', 'Selected entries']) header.append(node('th', label));
    const chartBody = chart.createTBody();
    const gradeChart = node('div');
    const status = node('p');
    status.setAttribute('role', 'status');
    let saving = false;
    const pending = new Set();
    let version = 0;
    let indexVersion = 0;
    let searchTimer;
    const save = action('Save study list', async () => {
      saving = true;
      renderSelection();
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
        renderSelection();
        void renderResults();
      }
    });
    async function renderResults(preferredId) {
      const request = ++version;
      const query = input.value.trim();
      const chapter = chapterPicker.value || reviewChapter;
      const browsing = !query && Boolean(chapterPicker.value);
      pager.hidden = true;
      results.replaceChildren();
      if (!query && !browsing) {
        results.append(node('li', 'Choose a Kent chapter to read its rubrics, or search by symptom.'));
        return;
      }
      results.append(node('li', 'Searching historical rubrics…'));
      try {
        let lookup;
        if (browsing) {
          const batch = await kentRequest('browse', {chapter, offset: browseOffset});
          lookup = {...batch, matches: batch.matches.map(kentRubric), fullKent: true};
        } else {
          [lookup] = await historicalMatches(entries, [{query, chapter,
            broaderTerms: chapterPicker.value ? undefined : reviewBroaderTerms}], 40);
        }
        const {matches, total, broader, fullKent} = lookup;
        if (request !== version) return;
        if (preferredId) matches.sort((a, b) => Number(b.id === preferredId) - Number(a.id === preferredId));
        results.replaceChildren();
        for (const entry of matches) {
          const item = node('li');
          const add = action('Add ' + entry.label + ' (' + entry.source + ')', async () => {
            const index = indexVersion;
            pending.add(entry.id);
            add.disabled = true;
            status.textContent = 'Loading source rubric…';
            try {
              const rubric = await loadRubric(entry);
              if (index === indexVersion) {
                selected.set(entry.id, rubric);
                status.textContent = '';
              }
            } catch (error) {
              if (index === indexVersion) status.textContent = error.message;
            } finally {
              pending.delete(entry.id);
              renderSelection();
              void renderResults(preferredId);
            }
          });
          add.disabled = saving || pending.has(entry.id) || selected.has(entry.id);
          item.append(add, node('p', entry.edition + ' · ' + entry.pageLabel));
          if (entry.privateKent) {
            const read = action('Read rubric', async () => {
              read.disabled = true;
              const reading = node('div', 'Loading rubric…');
              reading.setAttribute('role', 'status');
              item.append(reading);
              try {
                const rubric = await loadRubric(entry);
                reading.replaceChildren(historicalMedicineReference(rubric.medicines),
                  sourceExcerpt(rubric.sourceLines, true));
                reading.removeAttribute('role');
              } catch (error) {
                reading.textContent = error.message;
                read.disabled = false;
              }
            });
            item.append(read);
          }
          results.append(item);
        }
        if (broader) results.prepend(node('li', 'Broader source rubrics. Check the missing qualifier.'));
        if (!total) results.append(node('li', !fullKent && ['Cough', 'Extremities'].includes(reviewChapter)
          ? 'Import the full Private Kent index on this browser to search ' + reviewChapter + '.'
          : 'No matching rubrics in the current index.'));
        if (browsing && total) {
          results.prepend(node('li', chapter + ' · rubrics ' + (browseOffset + 1) + '–' +
            (browseOffset + matches.length) + ' of ' + total));
          pager.hidden = false;
          previous.disabled = browseOffset === 0;
          next.disabled = browseOffset + matches.length >= total;
        } else if (total > matches.length) {
          results.append(node('li', 'Showing ' + matches.length + ' of ' + total + ' matches. Refine your search to see more.'));
        }
      } catch (error) {
        if (request === version) results.replaceChildren(node('li', error.message));
      }
    }
    function renderSelection() {
      selection.replaceChildren();
      chartBody.replaceChildren();
      gradeChart.replaceChildren();
      const groups = new Map();
      for (const entry of selected.values()) {
        const key = entry.source + ' / ' + entry.chapter;
        const group = groups.get(key) || {source: entry.source, chapter: entry.chapter, count: 0};
        group.count++;
        groups.set(key, group);
        const item = node('li');
        const remove = action('Remove ' + entry.label + ' (' + entry.source + ')', () => {
          selected.delete(entry.id);
          renderSelection();
          void renderResults();
        });
        remove.disabled = saving;
        item.append(remove, node('p', entry.edition + ' · ' + entry.pageLabel),
          historicalMedicineReference(entry.medicines, entry.pageUrl));
        if (entry.sourceLines) item.append(sourceExcerpt(entry.sourceLines));
        selection.append(item);
      }
      for (const group of groups.values()) {
        const row = chartBody.insertRow();
        for (const value of [group.source, group.chapter, group.count]) row.insertCell().textContent = value;
      }
      chart.hidden = !selected.size;
      if (selected.size) {
        const table = node('table');
        table.className = 'kent-study-table';
        const heading = table.createTHead().insertRow();
        for (const label of ['Historical rubric', 'Medicine', 'Source grade']) heading.append(node('th', label));
        const body = table.createTBody();
        for (const entry of selected.values()) {
          const medicines = [...(entry.medicines || [])];
          medicines.sort((a, b) => (b.grade || 0) - (a.grade || 0) || a.name.localeCompare(b.name));
          for (const medicine of medicines.length ? medicines : [null]) {
            const row = body.insertRow();
            row.insertCell().textContent = entry.label + ' · ' + entry.source + ' · ' + entry.pageLabel;
            row.insertCell().textContent = medicine?.name || 'No medicine entry available';
            row.insertCell().textContent = medicine?.grade ?? '—';
          }
        }
        gradeChart.append(node('h3', 'Historical medicine grade chart'),
          node('p', 'For historical study. A dash indicates an unverified source grade.'), table);
      } else {
        selection.append(node('li', 'No rubrics selected.'));
      }
      save.disabled = saving || !entries.some(entry =>
        Boolean(saved.get(entry.id)?.bookmarked) !== selected.has(entry.id));
    }
    input.addEventListener('input', () => {
      reviewChapter = '';
      reviewBroaderTerms = undefined;
      browseOffset = 0;
      version++;
      clearTimeout(searchTimer);
      searchTimer = setTimeout(renderResults, 180);
    });
    function refreshIndex() {
      indexVersion++;
      renderSelection();
      void refreshChapters();
      void renderResults();
    }
    panel.append(review, chapterLabel, chapterSummary, label, node('h2', 'Search results'), results, pager,
      node('h2', 'Selected rubrics'), selection, chart, gradeChart, status);
    if (!sessionStudy) panel.append(kentImport(() => {
      for (const [id, rubric] of selected) {
        if (rubric.privateKent) selected.delete(id);
      }
      refreshIndex();
    }), node('p', 'Save study list applies to the built-in index. Imported Kent rubrics can be charted in this session.'), save);
    refreshTranscript();
    refreshIndex();
    container.replaceChildren(panel);
    if (!sessionStudy) container.prepend(kentPrivateReader(), boerickeOcrReader(), studyWorkflow());
    return {refreshTranscript, refreshIndex, review: reviewExcerpt};
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
    clearAccount() {
      closeKent();
      kentAccount = undefined;
    },
    init(account) {
      if (account !== kentAccount) closeKent();
      kentAccount = account;
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

