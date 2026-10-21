'use strict';
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..');
const catalog=JSON.parse(fs.readFileSync(path.join(root,'data/calendar.json'),'utf8'));
const previous=JSON.parse(fs.readFileSync(path.join(root,'data/legacy-baseline.json'),'utf8'));
if(catalog.version!==1 || !Array.isArray(catalog.events) || typeof catalog.revision!=='string')throw Error('Invalid public catalog');
const result='// Generated from data/calendar.json; do not edit by hand.\nconst CALENDAR_CATALOG_REVISION = '+JSON.stringify(catalog.revision)+';\nconst CALENDAR_DATA = '+JSON.stringify(catalog.events,null,2)+';\nconst CALENDAR_PREVIOUS = '+JSON.stringify(previous)+';\n';
fs.writeFileSync(path.join(root,'calendar-data.js'),result);
console.log('Synced fallback catalog '+catalog.revision);
