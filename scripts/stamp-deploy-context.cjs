'use strict';
const fs=require('node:fs'),path=require('node:path');
const context=['production','deploy-preview','branch-deploy','dev'].includes(process.env.CONTEXT)?process.env.CONTEXT:'unknown';
fs.writeFileSync(path.join(__dirname,'../netlify/lib/deploy-context.cjs'),"// Generated at build time. Contains no secrets.\nmodule.exports="+JSON.stringify({context})+";\n");
console.log('Notification deployment safety context:',context);
