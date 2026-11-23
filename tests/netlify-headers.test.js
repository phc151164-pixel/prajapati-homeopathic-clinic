const test=require('node:test'),assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const config=readFileSync(require.resolve('../netlify.toml'),'utf8');

test('public headers cover every path and sensitive routes retain stricter rules',()=>{
 const rule=path=>config.split('[[headers]]').find(block=>block.includes('for = "'+path+'"'));
 const publicRule=rule('/*');
 assert.match(publicRule,/X-Content-Type-Options = "nosniff"/);
 assert.match(publicRule,/X-Frame-Options = "SAMEORIGIN"/);
 assert.match(publicRule,/Referrer-Policy = "strict-origin-when-cross-origin"/);
 assert.doesNotMatch(publicRule,/Content-Security-Policy/);
 for(const path of ['/admin*','/doctor-calendar.html']){
  assert.match(rule(path),/X-Frame-Options = "DENY"/);
  assert.match(rule(path),/Referrer-Policy = "no-referrer"/);
  assert.match(rule(path),/Cache-Control = "no-store"/);
 }
 assert.match(rule('/admin*'),/frame-ancestors 'none'/);
 assert.match(rule('/admin.webmanifest'),/Cache-Control = "no-cache"/);
});
