'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {buildSync} = require('esbuild');
const root = path.resolve(__dirname, '..');
const assets = path.join(root, 'public/assets');
const runtime = path.join(root, 'node_modules/@huggingface/transformers/dist');

buildSync({
  entryPoints: [path.join(__dirname, 'phc-transcription-worker.mjs')],
  outfile: path.join(assets, 'phc-transcription-worker-local.js'),
  bundle: true,
  platform: 'browser',
  format: 'esm',
  minify: true,
  legalComments: 'eof'
});
for (const file of ['ort-wasm-simd-threaded.jsep.mjs', 'ort-wasm-simd-threaded.jsep.wasm']) {
  fs.copyFileSync(path.join(runtime, file), path.join(assets, file));
}
