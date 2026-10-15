import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
function files(directory) {return readdirSync(directory,{withFileTypes:true}).flatMap(e=>e.isDirectory()?files(`${directory}/${e.name}`):e.name.endsWith('.js')?[`${directory}/${e.name}`]:[]);}
for(const file of [...files('src'),...files('scripts'),...files('test')]) {const result=spawnSync(process.execPath,['--check',file],{stdio:'inherit'});if(result.status!==0) process.exit(1);}console.log('JavaScript syntax checks passed.');
