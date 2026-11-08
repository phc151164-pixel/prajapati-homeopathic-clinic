/* Minimal OOXML workbook export. All patient-provided fields are literal text. */
(function(root){
'use strict';
const encoder=new TextEncoder();
const xml=value=>String(value??'').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g,'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;');
function crc32(bytes){let crc=0xffffffff;for(const byte of bytes){crc^=byte;for(let i=0;i<8;i++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}return (crc^0xffffffff)>>>0;}
function zip(files){const parts=[],central=[];let offset=0;
 for(const [path,content]of files){const name=encoder.encode(path),data=encoder.encode(content),crc=crc32(data),local=new Uint8Array(30+name.length),lv=new DataView(local.buffer);lv.setUint32(0,0x04034b50,true);lv.setUint16(4,20,true);lv.setUint16(10,0,true);lv.setUint16(12,33,true);lv.setUint32(14,crc,true);lv.setUint32(18,data.length,true);lv.setUint32(22,data.length,true);lv.setUint16(26,name.length,true);local.set(name,30);parts.push(local,data);
 const entry=new Uint8Array(46+name.length),cv=new DataView(entry.buffer);cv.setUint32(0,0x02014b50,true);cv.setUint16(4,20,true);cv.setUint16(6,20,true);cv.setUint16(14,33,true);cv.setUint32(16,crc,true);cv.setUint32(20,data.length,true);cv.setUint32(24,data.length,true);cv.setUint16(28,name.length,true);cv.setUint32(42,offset,true);entry.set(name,46);central.push(entry);offset+=local.length+data.length;
 }
 const size=central.reduce((n,x)=>n+x.length,0),end=new Uint8Array(22),ev=new DataView(end.buffer);ev.setUint32(0,0x06054b50,true);ev.setUint16(8,files.length,true);ev.setUint16(10,files.length,true);ev.setUint32(12,size,true);ev.setUint32(16,offset,true);
 const result=new Uint8Array(offset+size+22);let cursor=0;for(const part of [...parts,...central,end]){result.set(part,cursor);cursor+=part.length;}return result;
}
function workbook(patients){
 if(patients.length>1048575)throw Error('Too many rows for Excel. Narrow the patient filters.');
 const ns='http://schemas.openxmlformats.org/spreadsheetml/2006/main';
 const headers=['Patient ID','Patient name','Mobile number','Registered date','Completed visits'];
 const rows=[headers,...patients.map(p=>[p.patient_id,p.full_name,p.mobile,String(p.registered_at||'').slice(0,10),Number.isFinite(Number(p.completed_visits))?Number(p.completed_visits):0])];
 const data=rows.map((row,i)=>'<row r="'+(i+1)+'">'+row.map((value,j)=>{const ref=String.fromCharCode(65+j)+(i+1);return i>0&&j===4?'<c r="'+ref+'"><v>'+value+'</v></c>':'<c r="'+ref+'" t="inlineStr"'+(i===0?' s="1"':'')+'><is><t xml:space="preserve">'+xml(value)+'</t></is></c>';}).join('')+'</row>').join('');
 return zip([
 ['[Content_Types].xml','<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>'],
 ['_rels/.rels','<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'],
 ['xl/workbook.xml','<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="'+ns+'" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Patients" sheetId="1" r:id="rId1"/></sheets></workbook>'],
 ['xl/_rels/workbook.xml.rels','<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>'],
 ['xl/styles.xml','<?xml version="1.0"?><styleSheet xmlns="'+ns+'"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="2"><xf xfId="0"/><xf fontId="1" applyFont="1" xfId="0"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>'],
 ['xl/worksheets/sheet1.xml','<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="'+ns+'"><dimension ref="A1:E'+rows.length+'"/><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols><col min="1" max="1" width="19" customWidth="1"/><col min="2" max="2" width="32" customWidth="1"/><col min="3" max="4" width="20" customWidth="1"/><col min="5" max="5" width="19" customWidth="1"/></cols><sheetData>'+data+'</sheetData><autoFilter ref="A1:E'+rows.length+'"/></worksheet>']
 ]);
}
async function collect(readPage,filter,onProgress=()=>{}){const rows=[],seen=new Set();
 for(let page=0;page<=100000;page++){
  const r=await readPage({...filter,page}),items=r.items;
  if(!Array.isArray(items))throw Error('Patient list could not be loaded. Please try again.');
  for(const p of items.slice(0,30)){const key=p.id||p.patient_id;if(!key||seen.has(key))throw Error('Patient list changed during export. Please try again.');seen.add(key);rows.push(p);}
  onProgress(rows.length);if(items.length<=30)return rows;
 }
 throw Error('Too many records for one export. Narrow the search filters.');
}
function download(patients,filename){const blob=new Blob([workbook(patients)],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=filename;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);}
const api={workbook,collect,download};if(typeof module==='object'&&module.exports)module.exports=api;else root.PHCPatientExport=api;
})(typeof window==='object'?window:globalThis);
