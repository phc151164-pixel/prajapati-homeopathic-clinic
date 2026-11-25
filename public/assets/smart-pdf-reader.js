(() => {
  'use strict';

  const vendor = '/assets/pdfjs/';
  let engine;
  function pdfEngine() {
    engine ||= import(vendor + 'pdf.min.mjs').then(pdf => {
      pdf.GlobalWorkerOptions.workerSrc = vendor + 'pdf.worker.min.mjs';
      return pdf;
    }).catch(error => {
      engine = null;
      throw error;
    });
    return engine;
  }

  const make = (tag, label) => {
    const element = window.document.createElement(tag);
    if (label) element.textContent = label;
    return element;
  };
  function button(label, click) {
    const element = make('button', label);
    element.type = 'button';
    element.className = 'secondary';
    element.addEventListener('click', click);
    return element;
  }
  function field(label, type) {
    const wrapper = make('label', label);
    const input = make('input');
    input.type = type;
    wrapper.append(input);
    return {wrapper, input};
  }
  const normalize = text => text.normalize('NFKC').toLowerCase().replace(/\s+/gu, ' ').trim();

  function create(title, container, bookUrl) {
    const pane = make('section');
    pane.className = 'card phc-pdf-pane';
    const file = field('Choose a local PDF', 'file');
    file.input.accept = 'application/pdf,.pdf';
    const page = field('Page', 'number');
    page.input.min = '1';
    page.input.required = true;
    const search = field('Find in PDF text', 'search');
    search.input.maxLength = 150;
    const view = make('div');
    view.className = 'phc-pdf-view';
    const canvas = make('canvas');
    canvas.setAttribute('role', 'img');
    view.append(canvas);
    const status = make('p');
    status.setAttribute('role', 'status');
    const result = make('p');
    result.setAttribute('role', 'status');
    const results = make('select');
    const resultLabel = make('label', 'Matching pages');
    resultLabel.hidden = true;
    resultLabel.append(results, button('Go to matching page', () => show(Number(results.value))));
    const controls = make('div');
    controls.hidden = true;
    const tools = make('div');
    tools.className = 'actions';
    const textDetails = make('details');
    const pageText = make('p');
    pageText.className = 'phc-pdf-text';
    textDetails.append(make('summary', 'Extracted page text'), pageText);

    let activePdf, loading, renderTask;
    let generation = 0, drawing = 0, finding = 0;
    let number = 1, zoom = 1;
    const textByPage = new Map();

    function clear() {
      generation++;
      drawing++;
      finding++;
      renderTask?.cancel();
      renderTask = null;
      if (loading) void loading.destroy().catch(() => {});
      loading = activePdf = null;
      textByPage.clear();
      file.input.value = search.input.value = status.textContent = result.textContent = pageText.textContent = '';
      canvas.width = canvas.height = 0;
      controls.hidden = resultLabel.hidden = true;
      results.replaceChildren();
    }

    async function readText(pdf, pageNumber) {
      if (!textByPage.has(pageNumber)) {
        const pdfPage = await pdf.getPage(pageNumber);
        const content = await pdfPage.getTextContent();
        const text = content.items.map(item => item.str ? item.str + (item.hasEOL ? '\n' : ' ') : '').join('').trim();
        if (pdf === activePdf) textByPage.set(pageNumber, text);
        return text;
      }
      return textByPage.get(pageNumber);
    }

    async function show(target) {
      if (!activePdf || !Number.isInteger(target) || target < 1 || target > activePdf.numPages) return;
      const token = ++drawing;
      renderTask?.cancel();
      const pdf = activePdf;
      number = target;
      page.input.value = String(number);
      pageText.textContent = '';
      status.textContent = 'Rendering page ' + number + ' of ' + pdf.numPages + '…';
      try {
        const pdfPage = await pdf.getPage(target);
        if (token !== drawing) return;
        const size = pdfPage.getViewport({scale: 1});
        const scale = Math.min((view.clientWidth || 320) * zoom / size.width, 2048 / Math.max(size.width, size.height));
        const viewport = pdfPage.getViewport({scale});
        const density = Math.min(window.devicePixelRatio || 1, 2);
        canvas.width = Math.ceil(viewport.width * density);
        canvas.height = Math.ceil(viewport.height * density);
        canvas.style.width = Math.ceil(viewport.width) + 'px';
        canvas.setAttribute('aria-label', title + ' page ' + number);
        renderTask = pdfPage.render({canvas, viewport, transform: [density, 0, 0, density, 0, 0]});
        await renderTask.promise;
        if (token !== drawing) return;
        status.textContent = 'Page ' + number + ' of ' + pdf.numPages + ' · Zoom ' + Math.round(zoom * 100) + '%';
        const text = await readText(pdf, target);
        if (token === drawing) pageText.textContent = text || 'This page has no embedded text.';
      } catch {
        if (token === drawing) status.textContent = 'Unable to read this page.';
      }
    }

    async function find() {
      const query = normalize(search.input.value);
      if (!activePdf || !query) return;
      const pdf = activePdf;
      const token = ++finding;
      resultLabel.hidden = true;
      results.replaceChildren();
      let pagesWithText = 0;
      try {
        for (let index = 1; index <= pdf.numPages; index++) {
          result.textContent = 'Searching page ' + index + ' of ' + pdf.numPages + '…';
          const text = await readText(pdf, index);
          if (token !== finding) return;
          if (text) pagesWithText++;
          if (normalize(text).includes(query)) {
            const option = make('option', 'Page ' + index);
            option.value = String(index);
            results.append(option);
          }
        }
        resultLabel.hidden = !results.length;
        result.textContent = !pagesWithText ? 'This PDF has no embedded text to search.' :
          results.length + ' matching page' + (results.length === 1 ? '' : 's') + '.';
        if (results.length) await show(Number(results.value));
      } catch {
        if (token === finding) result.textContent = 'Unable to search this PDF.';
      }
    }

    async function open(selected) {
      clear();
      const token = generation;
      if (!selected && !bookUrl) return;
      try {
        if (selected && (selected.size > 100 * 1024 * 1024 || !(await selected.slice(0, 1024).text()).includes('%PDF-'))) {
          if (token === generation) status.textContent = 'Choose a PDF no larger than 100 MB.';
          return;
        }
        if (token !== generation) return;
        status.textContent = 'Opening PDF…';
        const [engine, data] = await Promise.all([pdfEngine(), selected?.arrayBuffer()]);
        if (token !== generation) return;
        loading = engine.getDocument({
          ...(selected ? {data: new Uint8Array(data)} : {url: bookUrl}), cMapUrl: vendor + 'cmaps/', cMapPacked: true,
          standardFontDataUrl: vendor + 'standard_fonts/', iccUrl: vendor + 'iccs/',
          wasmUrl: vendor + 'decoders/', useWasm: false, isEvalSupported: false
        });
        const pdf = await loading.promise;
        if (token !== generation) return;
        activePdf = pdf;
        zoom = 1;
        page.input.max = String(pdf.numPages);
        controls.hidden = false;
        await show(1);
      } catch {
        if (token === generation) status.textContent = 'Unable to open this PDF. Check that the file is readable and unlocked.';
      }
    }
    file.input.addEventListener('change', () => { void open(file.input.files[0]); });

    function scale(change) {
      zoom = Math.max(0.5, Math.min(2, zoom + change));
      void show(number);
    }
    tools.append(button('Previous page', () => show(number - 1)),
      button('Next page', () => show(number + 1)), page.wrapper,
      button('Go to page', () => { if (page.input.reportValidity()) void show(page.input.valueAsNumber); }),
      button('Zoom out', () => scale(-0.25)), button('Zoom in', () => scale(0.25)), button('Close PDF', clear));
    search.input.addEventListener('keydown', event => { if (event.key === 'Enter') void find(); });
    search.input.addEventListener('input', () => {
      finding++;
      result.textContent = '';
      resultLabel.hidden = true;
    });
    results.addEventListener('change', () => show(Number(results.value)));
    controls.append(tools, search.wrapper, button('Find text', find), resultLabel, result, view, textDetails);
    // Refit without changing the active page or zoom when the device rotates.
    const resize = new ResizeObserver(() => { if (activePdf) void show(number); });
    resize.observe(view, {box: 'border-box'});
    pane.append(make('h2', title), file.wrapper, status, controls);
    if (bookUrl) {
      file.wrapper.hidden = true;
      void open();
    }
    container.append(pane);
    return () => {
      resize.disconnect();
      clear();
    };
  }

  window.PHCPdfReader = {create};
})();
