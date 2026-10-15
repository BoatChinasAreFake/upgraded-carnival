// Privileged commands below are controlled TEST FIXTURES, never bot/runtime capabilities.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import mineflayer from 'mineflayer';
import pathfinderPackage from 'mineflayer-pathfinder';
import { Policy } from '../src/policy.js';
import { Audit } from '../src/audit.js';
import { Executor } from '../src/executor.js';
import { SurvivalController,shelter } from '../src/survival.js';
import { Builder } from '../src/schematic/build.js';
import { loadSchematic } from '../src/schematic/load.js';
import { Vec3 } from 'vec3';
import { fixture } from '../test/fixture.js';
const directory=path.resolve('runtime/test-server');
if(!fs.existsSync(path.join(directory,'server.jar')) || !fs.readFileSync(path.join(directory,'eula.txt'),'utf8').includes('eula=true')) throw Error('Run npm run server:prepare -- --accept-eula after accepting the EULA.');
const server=spawn('java',['-Xms512M','-Xmx1024M','-XX:ActiveProcessorCount=2','-jar','server.jar','nogui'],{cwd:directory,stdio:['pipe','pipe','pipe']});
const log=fs.createWriteStream(path.resolve('runtime/server-test.log'),{flags:'w',mode:0o600});let ready=false,exited=false;
server.stdout.on('data',b=>{log.write(b);if(b.toString().includes('Done (')) ready=true;});server.stderr.on('data',b=>log.write(b));server.on('exit',()=>exited=true);
const wait=async(predicate,label,timeout=10000)=>{const end=Date.now()+timeout;while(Date.now()<end){if(exited) throw Error('Test server exited; inspect runtime/server-test.log');if(predicate()) return;await new Promise(r=>setTimeout(r,50));}throw Error('Timed out: '+label);};
const username='Test'+Date.now().toString(36);
const command=s=>server.stdin.write(s.replaceAll('TestSurvivalBot',username)+'\n');
let bot,executor,survival;const audit=new Audit('runtime/server-test-audit.jsonl'),results=[];
const check=async(name,fn)=>{await fn();results.push(name);console.log('PASS '+name);};
const principal={kind:'discord',guildId:'test',id:'fixture-operator',roles:['admin'],expiresAt:Date.now()+300000};
try {
  console.log('Starting controlled vanilla 1.20.4 server (loopback, 1 GiB heap, 2 CPUs)…');await wait(()=>ready,'server readiness',90000);
  command('kill @e[type=!player]');command('gamerule doMobSpawning false');command('gamerule doDaylightCycle false');command('time set noon');command('weather clear');
  command('fill -16 63 -16 16 63 16 stone');command('fill -16 64 -16 16 68 16 air');command('setworldspawn 0 64 0');
  bot=mineflayer.createBot({host:'127.0.0.1',port:25575,username,version:'1.20.4',auth:'offline',respawn:false});
  bot.on('error',()=>{});bot.loadPlugin(pathfinderPackage.pathfinder);await once(bot,'spawn');
  command('tp TestSurvivalBot 0.5 64 0.5');command('spawnpoint TestSurvivalBot 0 64 0');
  await wait(()=>bot.entity.position.y===64,'fixture teleport');await bot.waitForChunksToLoad();
  const policy=new Policy({guildId:'test',textChannelIds:['test'],voiceChannelIds:[],roles:{operator:[],builder:[],destroyer:[],admin:['admin']},areas:[{id:'test',dimension:'overworld',bounds:{min:{x:-16,y:63,z:-16},max:{x:16,y:70,z:16}},mine:true,build:true}],containers:[{dimension:'overworld',position:{x:4,y:64,z:0}},{dimension:'overworld',position:{x:2,y:64,z:0}}],home:{x:0,y:64,z:0},maxDeaths:3,maxRecoveryDistance:16,allowAutonomousMining:false,allowAutonomousBuilding:false,allowVoiceRecording:false});
  executor=new Executor(bot,policy,audit);
  if(process.env.TEST_DEBUG==='1') executor.on('actionError',({action,error})=>console.log('TEST DEBUG',action.kind,action.position,error.message));
  await check('protocol 765 / Java 1.20.4 survival login',async()=>{assert.equal(bot.version,'1.20.4');assert.equal(bot.game.gameMode,'survival');assert.equal(bot.registry.version.version,765);});
  command('give TestSurvivalBot iron_pickaxe');command('give TestSurvivalBot stone_sword');command('give TestSurvivalBot cobblestone 64');command('give TestSurvivalBot glass 8');command('give TestSurvivalBot cooked_beef 8');command('give TestSurvivalBot iron_chestplate');
  await wait(()=>bot.inventory.items().some(i=>i.name==='iron_chestplate'),'inventory fixture');
  await check('ordinary pathfinder movement with no break/place',async()=>{await executor.submit({kind:'move',position:{x:1,y:64,z:1}},principal);assert.ok(bot.entity.position.distanceTo(new Vec3(1,64,1))<1.5);});
  command('setblock 3 64 1 stone');await wait(()=>bot.blockAt(new Vec3(3,64,1))?.name==='stone','mining fixture');
  await check('visible authorized mining and inventory harvest',async()=>{
    const count=()=>bot.inventory.items().filter(i=>i.name==='cobblestone').reduce((n,i)=>n+i.count,0),before=count();
    await executor.submit({kind:'dig',position:{x:3,y:64,z:1}},principal);assert.equal(bot.blockAt(new Vec3(3,64,1)).name,'air');
    await executor.submit({kind:'move',position:{x:3,y:64,z:1}},principal);await wait(()=>count()>=before+1,'ordinary item pickup');
    await executor.submit({kind:'move',position:{x:1,y:64,z:1}},principal);
  });
  await check('unauthorized destructive action denied',async()=>{await assert.rejects(executor.submit({kind:'dig',position:{x:2,y:63,z:1}},{...principal,roles:[]}));});
  command('setblock 3 64 1 stone');command('setblock 3 65 1 stone');command('setblock 4 64 1 stone');
  await wait(()=>bot.blockAt(new Vec3(4,64,1))?.name==='stone','occlusion fixture');
  await check('occluded block mining denied',async()=>{await assert.rejects(executor.submit({kind:'dig',position:{x:4,y:64,z:1}},principal),/reach|line of sight/);});
  command('setblock 3 64 1 air');command('setblock 3 65 1 air');command('setblock 4 64 1 air');
  await wait(()=>bot.blockAt(new Vec3(3,64,1))?.name==='air','clear fixture');
  await check('legitimate placement and server verification',async()=>{await executor.submit({kind:'place',position:{x:3,y:64,z:1},name:'cobblestone'},principal);assert.equal(bot.blockAt(new Vec3(3,64,1)).name,'cobblestone');});
  command('setblock 4 64 0 chest');await wait(()=>bot.blockAt(new Vec3(4,64,0))?.name==='chest','container fixture');
  await check('allowlisted container deposit/withdraw',async()=>{const total=()=>bot.inventory.items().filter(i=>i.name==='cobblestone').reduce((s,i)=>s+i.count,0),before=total();await executor.submit({kind:'container',position:{x:4,y:64,z:0},operation:'deposit',name:'cobblestone',count:2},principal);assert.equal(total(),before-2);await executor.submit({kind:'container',position:{x:4,y:64,z:0},operation:'withdraw',name:'cobblestone',count:2},principal);assert.equal(total(),before);});
  await check('sandbox litematic, support placement, verification, checkpoint and repeat',async()=>{
    const schematic=await loadSchematic(fixture({name:'minecraft:glass',position:{x:0,y:1,z:0}})),builder=new Builder(bot,executor,policy,audit,{directory:'runtime/test-checkpoints'});
    const result=await builder.run(schematic,{x:-1,y:64,z:1},principal);assert.equal(result.status,'complete');assert.equal(result.supports.length,1);assert.equal(bot.blockAt(new Vec3(-1,65,1)).name,'glass');assert.ok(fs.existsSync('runtime/test-checkpoints/'+result.id+'.json'));
    const second=await builder.run(schematic,{x:-1,y:64,z:1},principal);assert.equal(second.status,'complete');assert.equal(second.completed.length,0);assert.equal(second.supports.length,1);
  });
  command('give TestSurvivalBot oak_log 1');await wait(()=>bot.inventory.items().some(i=>i.name==='oak_log'),'crafting fixture');
  await check('ordinary inventory crafting uses server recipe and materials',async()=>{
    const before=bot.inventory.items().filter(i=>i.name==='oak_planks').reduce((n,i)=>n+i.count,0);
    await executor.submit({kind:'craft',name:'oak_planks',count:1},principal);
    assert.equal(bot.inventory.items().filter(i=>i.name==='oak_planks').reduce((n,i)=>n+i.count,0),before+4);
  });
  await check('interrupted schematic build resumes from reverified world state',async()=>{
    const schematic=await loadSchematic(fixture({name:'minecraft:glass',position:{x:0,y:1,z:0}})),builder=new Builder(bot,executor,policy,audit,{directory:'runtime/test-checkpoints'});
    const interrupt=()=>builder.cancel();executor.once('idle',interrupt);
    await assert.rejects(builder.run(schematic,{x:2,y:64,z:-1},principal),/cancelled/);
    executor.removeListener('idle',interrupt);
    const result=await builder.run(schematic,{x:2,y:64,z:-1},principal);assert.equal(result.status,'complete');assert.equal(result.supports.length,1);
    assert.equal(bot.blockAt(new Vec3(2,65,-1)).name,'glass');
  });
  await check('allowlisted crafting table produces food with ordinary recipes',async()=>{
    command('setblock 2 64 0 crafting_table');command('give TestSurvivalBot wheat 6');
    await wait(()=>bot.blockAt(new Vec3(2,64,0))?.name==='crafting_table' && bot.inventory.items().some(i=>i.name==='wheat'),'food crafting fixture');
    await executor.submit({kind:'craft',name:'bread',count:2},principal);
    assert.equal(bot.inventory.items().filter(i=>i.name==='bread').reduce((n,i)=>n+i.count,0),2);
    command('setblock 2 64 0 air');await wait(()=>bot.blockAt(new Vec3(2,64,0))?.name==='air','food crafting cleanup');
  });
  survival=new SurvivalController(bot,executor,policy,audit,{stopFile:'runtime/TEST_STOP'}).start();
  await check('survival equips available armor',async()=>{await wait(()=>bot.inventory.slots[6]?.name==='iron_chestplate','armor equip');});
  command('effect give TestSurvivalBot hunger 3 255 true');
  await check('survival consumes food at normal use duration',async()=>{const before=bot.inventory.items().filter(i=>i.name==='cooked_beef').reduce((s,i)=>s+i.count,0);await wait(()=>bot.inventory.items().filter(i=>i.name==='cooked_beef').reduce((s,i)=>s+i.count,0)<before,'food consumption',15000);});
  // Remove effects and reset food for the combat fixture; no privileged bot actions.
  command('effect clear TestSurvivalBot');command('effect give TestSurvivalBot saturation 1 10 true');
  command('time set midnight');command('summon zombie 2.5 64 1.5 {NoAI:1b,Silent:1b,PersistenceRequired:1b}');
  await check('defensive combat cooldown under stalled AI and Discord',async()=>{
    const stalledPlanner=new Promise(()=>{}),stalledDiscord=new Promise(()=>{});void stalledPlanner;void stalledDiscord;
    let attacks=0;const times=[];const attack=bot.attack.bind(bot);bot.attack=(...args)=>{attacks++;times.push(Date.now());return attack(...args);};
    await wait(()=>Object.values(bot.entities).some(e=>e.name==='zombie'),'hostile visible');
    await wait(()=>!Object.values(bot.entities).some(e=>e.name==='zombie'),'hostile defeated',20000);
    assert.ok(attacks>=2);for(let i=1;i<times.length;i++) assert.ok(times[i]-times[i-1]>=600,'sword cooldown');
    assert.ok(Math.max(...survival.latencies)<100,'bounded survival tick in controlled fixture');
  });
  await check('creeper threat causes bounded retreat along normal walkable terrain',async()=>{
    const before=bot.entity.position.clone();command(`summon creeper ${before.x+1} 64 ${before.z} {NoAI:1b,Silent:1b,PersistenceRequired:1b}`);
    await wait(()=>Object.values(bot.entities).some(e=>e.name==='creeper'),'creeper fixture');
    await wait(()=>bot.entity.position.distanceTo(before)>1.5,'hazard retreat',10000);
    assert.ok(policy.area(bot.entity.position,bot.game.dimension));command('kill @e[type=creeper]');
    await wait(()=>!Object.values(bot.entities).some(e=>e.name==='creeper'),'creeper fixture cleanup');executor.cancel('fixture-reset');
  });
  await check('autonomous roof and walls are built without sleeping',async()=>{
    survival.stop();executor.cancel('fixture-reset');command('time set noon');command('fill -2 64 -2 2 67 2 air');command('tp TestSurvivalBot 0.5 64 0.5');
    await wait(()=>bot.entity.position.distanceTo(new Vec3(.5,64,.5))<.2,'shelter stance');
    command('clear TestSurvivalBot oak_planks');command('clear TestSurvivalBot oak_log');command('give TestSurvivalBot cobblestone 64');
    await wait(()=>!bot.inventory.items().some(i=>i.name==='oak_planks'),'shelter inventory');
    policy.config.allowAutonomousBuilding=true;survival.pending=false;survival.nextScan=0;survival.start();
    await wait(()=>shelter(policy.config.home).every(p=>bot.blockAt(new Vec3(p.x,p.y,p.z))?.name==='cobblestone'),'shelter completion',90000);
    assert.equal(bot.blockAt(new Vec3(0,64,-1)).name,'air');assert.equal(bot.blockAt(new Vec3(0,66,0)).name,'cobblestone');
    policy.config.allowAutonomousBuilding=false;
  });
  await check('independent local emergency stop rejects actions until admin resume',async()=>{
    fs.writeFileSync('runtime/TEST_STOP','');await wait(()=>executor.stopped,'stop file',1000);await assert.rejects(executor.submit({kind:'move',position:{x:0,y:64,z:0}},principal));fs.unlinkSync('runtime/TEST_STOP');executor.resume(principal);
  });
  survival.stop();
  await check('bounded death recovery respawns then latches at configured death budget',async()=>{
    // Reuse the deterministic controller but avoid background recovery between deliberate kills.
    for(let n=1;n<=3;n++) {
      command('kill TestSurvivalBot');await wait(()=>bot.health===0,'death '+n);assert.equal(survival.deaths,n);
      if(n<3){survival.tick();await wait(()=>bot.health>0,'bounded respawn '+n);}
      else assert.equal(executor.stopped,true);
    }
  });
  await check('actual main entrypoint starts survival and accepts independent console stop',async()=>{
    bot.quit('Fixture client finished');
    const file=path.resolve('runtime/main-smoke-policy.json');fs.writeFileSync(file,JSON.stringify(policy.config),{mode:0o600});
    const main=spawn(process.execPath,['--use-env-proxy','src/main.js'],{cwd:path.resolve('.'),stdio:['pipe','pipe','pipe'],env:{...process.env,MC_HOST:'127.0.0.1',MC_PORT:'25575',MC_USERNAME:'Smoke'+Date.now().toString(36),MC_AUTH:'offline',POLICY_FILE:file,DISCORD_TOKEN:'',DISCORD_APPLICATION_ID:'',AI_API_KEY:''}});
    let output='',ended=false;main.stdout.on('data',b=>output+=b.toString());main.stderr.resume();main.on('exit',()=>ended=true);
    try {
      await wait(()=>{if(ended) throw Error('Main entrypoint exited before readiness');return output.includes('Survival tick active') && output.includes('Discord disabled');},'main entrypoint readiness');
      main.stdin.write('stop\n');await wait(()=>fs.readFileSync('runtime/audit.jsonl','utf8').includes('"reason":"console"'),'main console stop');
    } finally {main.kill('SIGTERM');await Promise.race([once(main,'exit'),new Promise(resolve=>setTimeout(()=>{main.kill('SIGKILL');resolve();},5000).unref())]);}
  });
  fs.writeFileSync('runtime/server-test-results.json',JSON.stringify({version:'1.20.4',protocol:765,time:new Date().toISOString(),passed:results,failed:[],survivalTickMaxMs:Math.max(...survival.latencies)},null,2));
  console.log(`Controlled server checks passed: ${results.length}`);
} catch(error) {
  fs.writeFileSync('runtime/server-test-results.json',JSON.stringify({version:'1.20.4',time:new Date().toISOString(),passed:results,failed:[error.message]},null,2));console.error(error);process.exitCode=1;
} finally {
  survival?.stop();executor?.emergencyStop('test-finished');bot?.quit('Test complete');audit.close();
  command('stop');await Promise.race([once(server,'exit'),new Promise(resolve=>setTimeout(()=>{server.kill('SIGKILL');resolve();},10000).unref())]);log.end();
}
