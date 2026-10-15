import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
export function loadSchematic(buffer) {
  if(!Buffer.isBuffer(buffer) || buffer.length>2*1024*1024) return Promise.reject(Error('Schematic exceeds 2 MiB'));
  return new Promise((resolve,reject)=>{
    const version=fileURLToPath(new URL('../version.js',import.meta.url));
    const parser=fileURLToPath(new URL('./parser-child.js',import.meta.url)),placement=fileURLToPath(new URL('../placement.js',import.meta.url));
    const child=spawn(process.execPath,['--permission',`--allow-fs-read=${parser}`,`--allow-fs-read=${placement}`,`--allow-fs-read=${version}`,'--max-old-space-size=64',parser,'--parse'],{stdio:['pipe','pipe','pipe'],env:{}});
    let length=0;const output=[];const timer=setTimeout(()=>child.kill('SIGKILL'),2500);
    child.stdout.on('data',b=>{length+=b.length;if(length>8*1024*1024) child.kill('SIGKILL');else output.push(b);});
    child.stderr.resume();child.stdin.on('error',()=>{});child.on('error',reject);
    child.on('close',code=>{clearTimeout(timer);if(code!==0) return reject(Error('Sandbox rejected schematic (format, limits or unsupported states)'));try{resolve({...JSON.parse(Buffer.concat(output)),sha256:crypto.createHash('sha256').update(buffer).digest('hex')});}catch{reject(Error('Invalid parser response'));}});
    child.stdin.end(buffer);
  });
}
