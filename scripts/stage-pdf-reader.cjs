'use strict';

const {copyFileSync, cpSync, mkdirSync} = require('node:fs');
const path = require('node:path');
const source = path.dirname(require.resolve('pdfjs-dist/package.json'));
const target = path.join(__dirname, '../public/assets/pdfjs');
mkdirSync(target, {recursive: true});
for (const file of ['LICENSE', 'legacy/build/pdf.min.mjs', 'legacy/build/pdf.worker.min.mjs']) {
  copyFileSync(path.join(source, file), path.join(target, path.basename(file)));
}
for (const directory of ['cmaps', 'standard_fonts', 'iccs']) {
  cpSync(path.join(source, directory), path.join(target, directory), {recursive: true});
}
const decoders = path.join(target, 'decoders');
mkdirSync(decoders, {recursive: true});
for (const file of ['jbig2_nowasm_fallback.js', 'openjpeg_nowasm_fallback.js',
  'LICENSE_JBIG2', 'LICENSE_PDFJS_JBIG2', 'LICENSE_OPENJPEG', 'LICENSE_PDFJS_OPENJPEG']) {
  copyFileSync(path.join(source, 'wasm', file), path.join(decoders, file));
}
