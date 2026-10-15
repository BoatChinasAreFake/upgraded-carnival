import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import mineflayer from 'mineflayer';
import pathfinderPackage from 'mineflayer-pathfinder';
import { Policy } from './policy.js';
import { Audit } from './audit.js';
import { Executor } from './executor.js';
import { SurvivalController } from './survival.js';
import { Planner } from './planner/index.js';
import { TaskRunner } from './tasks.js';
import { Builder } from './schematic/build.js';
import { DiscordBridge } from './discord/index.js';
const policyFile=process.env.POLICY_FILE ?? 'config/policy.json';
if(!fs.existsSync(policyFile)) {console.error('Configure an owner-reviewed policy file first; see config/policy.example.json.');process.exit(1);}
const policy=new Policy(JSON.parse(fs.readFileSync(policyFile,'utf8')));
fs.mkdirSync('runtime/auth',{recursive:true,mode:0o700});
const audit=new Audit('runtime/audit.jsonl'),planner=new Planner();
const auth=process.env.MC_AUTH ?? 'microsoft';if(!['microsoft','offline'].includes(auth)) throw Error('Unsupported authentication');
const bot=mineflayer.createBot({host:process.env.MC_HOST ?? '127.0.0.1',port:Number(process.env.MC_PORT ?? 25565),username:process.env.MC_USERNAME ?? 'SurvivalBot',version:'1.20.4',auth,profilesFolder:path.resolve('runtime/auth'),respawn:false});
bot.loadPlugin(pathfinderPackage.pathfinder);
let executor,survival,discord,started=false;
const emergency=reason=>executor?.emergencyStop(reason);
const input=readline.createInterface({input:process.stdin});input.on('line',line=>{if(line.trim().toLowerCase()==='stop') emergency('console');});
async function close(reason) {emergency(reason);survival?.stop();discord?.close();input.close();await planner.close();bot.quit(reason);audit.close();}
for(const signal of ['SIGINT','SIGTERM']) process.once(signal,()=>{void close(signal).finally(()=>process.exit(0));});
process.on('uncaughtException',()=>{emergency('uncaught-error');console.error('Fatal internal error; emergency stop latched.');process.exit(1);});
process.on('unhandledRejection',()=>{emergency('unhandled-error');console.error('Internal promise failure; emergency stop latched.');});
bot.on('error',()=>console.error('Minecraft connection error. Check server and authentication; credentials are not logged.'));
bot.on('kicked',()=>{audit.write('connection-ended',{reason:'kicked'});emergency('kicked');});
bot.on('end',()=>{survival?.stop();discord?.close();input.close();void planner.close();console.log('Minecraft disconnected. No automatic reconnect.');});
bot.on('spawn',()=>{
  if(started) return;started=true;
  executor=new Executor(bot,policy,audit);survival=new SurvivalController(bot,executor,policy,audit).start();
  const runner=new TaskRunner(bot,executor,policy,audit),builder=new Builder(bot,executor,policy,audit);
  if(!policy.area(bot.entity.position,bot.game.dimension)) executor.emergencyStop('spawn-outside-policy');
  console.log('Minecraft Java 1.20.4 connected. Survival tick active; type stop or create runtime/STOP for emergency stop.');
  if(process.env.DISCORD_TOKEN) {
    discord=new DiscordBridge(bot,executor,policy,audit,planner,runner,builder);
    void discord.start(process.env.DISCORD_TOKEN,process.env.DISCORD_APPLICATION_ID).then(()=>console.log('Discord connected; guild commands registered.')).catch(()=>{audit.write('discord-error',{code:'startup'});console.error('Discord unavailable; survival and local emergency stop remain active.');});
  } else console.log('Discord disabled: DISCORD_TOKEN not configured.');
});
