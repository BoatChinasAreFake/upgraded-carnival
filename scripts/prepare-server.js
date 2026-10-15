import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
const root=path.resolve('runtime/test-server');fs.mkdirSync(root,{recursive:true,mode:0o700});
const urls=new Set(['piston-meta.mojang.com','piston-data.mojang.com']);
async function download(url,max) {
  const parsed=new URL(url);if(parsed.protocol!=='https:' || !urls.has(parsed.hostname)) throw Error('Unexpected Mojang host');
  const r=await fetch(url,{redirect:'error',signal:AbortSignal.timeout(60000)});if(!r.ok) throw Error(`Download HTTP ${r.status}`);
  let size=0;const chunks=[];for await(const c of r.body){size+=c.length;if(size>max) throw Error('Download size limit');chunks.push(c);}return Buffer.concat(chunks);
}
const manifest=JSON.parse(await download('https://piston-meta.mojang.com/mc/game/version_manifest_v2.json',1024*1024));
const version=manifest.versions.find(v=>v.id==='1.20.4');if(!version) throw Error('1.20.4 absent');
const metadata=await download(version.url,1024*1024);if(crypto.createHash('sha1').update(metadata).digest('hex')!==version.sha1) throw Error('Metadata checksum mismatch');
const server=JSON.parse(metadata).downloads.server,jar=path.join(root,'server.jar');
if(!fs.existsSync(jar) || crypto.createHash('sha1').update(fs.readFileSync(jar)).digest('hex')!==server.sha1) {
  const bytes=await download(server.url,80*1024*1024);if(bytes.length!==server.size || crypto.createHash('sha1').update(bytes).digest('hex')!==server.sha1) throw Error('Server checksum mismatch');fs.writeFileSync(jar,bytes);
}
// Existing worlds/configuration are never overwritten. EULA acceptance is an explicit CLI flag.
if(process.argv.includes('--accept-eula')) fs.writeFileSync(path.join(root,'eula.txt'),'# Explicitly accepted by the owner for this controlled test\neula=true\n',{mode:0o600});
if(!fs.existsSync(path.join(root,'server.properties'))) fs.writeFileSync(path.join(root,'server.properties'),[
  'server-ip=127.0.0.1','server-port=25575','online-mode=false','enforce-secure-profile=false','gamemode=survival','difficulty=normal','level-type=minecraft:flat','generate-structures=false','spawn-protection=0','max-players=2','view-distance=3','simulation-distance=3','sync-chunk-writes=true','enable-rcon=false','level-seed=42','max-tick-time=60000'
].join('\n')+'\n',{mode:0o600});
console.log('Verified vanilla Java 1.20.4 server downloaded. Bound to loopback; offline authentication is test-only.');
if(!fs.existsSync(path.join(root,'eula.txt'))) console.log('To run it, explicitly accept https://aka.ms/MinecraftEULA with --accept-eula.');
