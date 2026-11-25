'use strict';

const {createHash} = require('node:crypto');
const {execFileSync} = require('node:child_process');
const {mkdirSync, readFileSync, renameSync, rmSync} = require('node:fs');
const path = require('node:path');
const {pdf: source} = require('../docs/allen-keynotes-index.json');

const target = path.join(__dirname, '../public/assets/books');
const destination = path.join(target, 'allen-keynotes-1899.pdf');
const checksum = '2db369e0c30c694dc7bd2f0dee29d09c6b0255750f2a98a45fa0fb2ea8ed2e2a';
const valid = file => createHash('sha256').update(readFileSync(file)).digest('hex') === checksum;
mkdirSync(target, {recursive: true});
let staged = false;
try { staged = valid(destination); } catch (error) {
  if (error.code !== 'ENOENT') throw error;
}
if (!staged) {
  const temporary = destination + '.download';
  try {
    execFileSync('curl', ['--fail', '--location', '--silent', '--show-error',
      '--max-time', '90', '--retry', '2', '--output', temporary, source], {stdio: 'inherit'});
    if (!valid(temporary)) throw Error('Allen scan checksum mismatch');
    renameSync(temporary, destination);
  } finally {
    rmSync(temporary, {force: true});
  }
}
