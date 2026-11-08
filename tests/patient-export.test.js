const test=require('node:test');
const assert=require('node:assert/strict');
const {collect,workbook}=require('../public/assets/patient-export.js');
const patient=i=>({id:'id-'+i,patient_id:'PHC-'+i,full_name:'Patient '+i,mobile:'08103684642',registered_at:'2026-11-09T01:00:00Z',completed_visits:2});
test('export includes every matching page without repeating lookahead rows',async()=>{
 const source=Array.from({length:65},(_,i)=>patient(i)),calls=[];
 const rows=await collect(async filter=>{calls.push(filter);return {items:source.slice(filter.page*30,filter.page*30+31)};},{search:'Patient',from:'2026-11-01',filterVisits:'true'});
 assert.equal(rows.length,65);assert.equal(rows[64].id,'id-64');assert.deepEqual(calls.map(x=>x.page),[0,1,2]);assert.ok(calls.every(x=>x.search==='Patient'&&x.filterVisits==='true'&&x.from==='2026-11-01'));
});
test('failed later page cannot silently produce a partial export',async()=>{
 await assert.rejects(collect(async({page})=>{if(page)throw Error('Session expired');return {items:Array.from({length:31},(_,i)=>patient(i))};},{}),/Session expired/);
});
test('duplicate records during pagination stop the export',async()=>{
 await assert.rejects(collect(async({page})=>({items:page?[patient(0)]:Array.from({length:31},(_,i)=>patient(i))}),{}),/changed during export/);
});
test('empty list creates a workbook with headers and no private clinical notes',()=>{
 const text=new TextDecoder().decode(workbook([]));assert.match(text,/Patient name/);assert.match(text,/A1:E1/);assert.doesNotMatch(text,/undefined/);
});
test('spreadsheet text preserves identifiers and never creates formulas from names',()=>{
 const text=new TextDecoder().decode(workbook([{...patient(1),full_name:'=HYPERLINK("https://example.com") & <test>\u0000',admin_notes:'DO NOT EXPORT'}]));
 assert.match(text,/t="inlineStr"/);assert.match(text,/08103684642/);assert.match(text,/&amp; &lt;test&gt;/);assert.doesNotMatch(text,/<f>|DO NOT EXPORT|\u0000<\/t>/);
});
