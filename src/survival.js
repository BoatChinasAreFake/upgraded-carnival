import fs from 'node:fs';
import { performance } from 'node:perf_hooks';
import { vec, visibleEntities, hostileNames, safeStand, observedBlocks, visibleBlock } from './observation.js';
import { attackCooldown } from './executor.js';
const SELF=Object.freeze({kind:'survival'});
export function shelter(home) {
  const point=(x,y,z)=>({x:home.x+x,y:home.y+y,z:home.z+z});
  const pillars=[];for(const x of [-1,1]) for(const z of [-1,1]) for(let y=0;y<2;y++) pillars.push(point(x,y,z));
  const roof=[];for(let x=-1;x<=1;x++) for(let z=-1;z<=1;z++) roof.push(point(x,2,z));
  const sides=[];for(const [x,z] of [[-1,0],[1,0],[0,1]]) for(let y=0;y<2;y++) sides.push(point(x,y,z));
  return [...pillars,...roof,...sides];
}
export class SurvivalController {
  constructor(bot,executor,policy,audit,{stopFile='runtime/STOP',tickMs=50}={}) {
    this.bot=bot;this.executor=executor;this.policy=policy;this.audit=audit;this.stopFile=stopFile;this.tickMs=tickMs;
    this.pending=false;this.deaths=0;this.respawnSent=false;this.respawnDeadline=0;this.deathPosition=null;this.recoverUntil=0;this.nextScan=0;this.retries=new Map();this.latencies=[];this.buildVantage=0;this.buildMoves=0;
    bot.on('spawn',()=>{this.respawnSent=false;this.respawnDeadline=0;});
    bot.on('death',()=>{
      this.respawnSent=false;this.respawnDeadline=0;this.deaths++;this.deathPosition=bot.entity.position.clone();this.recoverUntil=Date.now()+60000;
      this.audit.write('death',{count:this.deaths});
      if(this.deaths>=policy.config.maxDeaths) executor.emergencyStop('death-budget');
    });
  }
  start() { this.timer=setInterval(()=>this.tick(),this.tickMs);return this; }
  stop() { clearInterval(this.timer); }
  act(action,priority=20) {
    const signature=JSON.stringify(action),until=this.retries.get(signature) ?? 0;
    if(this.pending || until>Date.now()) return false;
    const token=Symbol('survival-action');this.pending=token;
    this.executor.submit(action,SELF,priority).catch(()=>{this.retries.set(signature,Date.now()+3000);if(action.kind==='place') this.buildNeedsVantage=true;}).finally(()=>{if(this.pending===token) this.pending=false;});return true;
  }
  tick() {
    const started=performance.now();
    try {
      if(fs.existsSync(this.stopFile)) { if(!this.executor.stopped) this.executor.emergencyStop('stop-file');return; }
      const b=this.bot;if(this.executor.stopped || !b.entity) return;
      if(b.health<=0) {
        if(this.respawnSent && Date.now()>this.respawnDeadline) this.executor.emergencyStop('respawn-timeout');
        else if(!this.respawnSent && this.deaths<this.policy.config.maxDeaths && this.act({kind:'respawn'},100)) {this.respawnSent=true;this.respawnDeadline=Date.now()+5000;}
        return;
      }
      const threats=visibleEntities(b,8).filter(e=>hostileNames.has(e.name));
      const closest=threats.sort((a,c)=>a.position.distanceTo(b.entity.position)-c.position.distanceTo(b.entity.position))[0];
      const feet=b.blockAt(b.entity.position.floored()),ground=b.blockAt(b.entity.position.floored().offset(0,-1,0));
      const dangerous=b.entity.isInLava || feet?.name==='lava' || feet?.name==='fire' || feet?.name==='soul_fire' || ground?.name==='magma_block' || b.oxygenLevel<8;
      if(dangerous || (closest && (closest.name==='creeper' || b.health<=8))) {
        if(this.executor.current && !this.executor.current.abort.signal.aborted && this.executor.current.priority<90) {this.executor.cancel('hazard');this.pending=false;}
        const destination=this.escape(threats);
        if(destination) this.act({kind:'move',position:destination},90);
        else if(dangerous) this.executor.emergencyStop('no-safe-escape');
        return;
      }
      if(closest && closest.position.distanceTo(b.entity.position)<=3) {
        if(this.executor.current && !this.executor.current.abort.signal.aborted && this.executor.current.priority<80) {this.executor.cancel('close-hostile');this.pending=false;}
        const weapon=b.inventory.items().find(i=>i.name.endsWith('_sword'));
        if(weapon && b.heldItem?.name!==weapon.name) this.act({kind:'equip',name:weapon.name,destination:'hand'},80);
        else if(performance.now()-Math.max(this.executor.lastAttack,this.executor.lastEquip)>=attackCooldown(b.heldItem)) this.act({kind:'attack',entityId:closest.id},80);
        return;
      }
      if(b.food<18) {
        const foods=b.inventory.items().filter(i=>b.registry.foodsByName[i.name] && !/rotten_flesh|spider_eye|pufferfish|poisonous_potato|chorus_fruit|raw_|^(chicken|beef|porkchop|mutton|rabbit|cod|salmon)$/.test(i.name));
        foods.sort((a,c)=>b.registry.foodsByName[c.name].foodPoints-b.registry.foodsByName[a.name].foodPoints);
        if(foods[0]) {this.act({kind:'eat',name:foods[0].name},70);return;}
      }
      if(this.pending || this.executor.current || Date.now()<this.nextScan) return;
      this.nextScan=Date.now()+750;
      for(const [suffix,destination] of [['helmet','head'],['chestplate','torso'],['leggings','legs'],['boots','feet']]) {
        const score=name=>name.startsWith('netherite')?6:name.startsWith('diamond')?5:name.startsWith('iron')?4:name.startsWith('chainmail')?3:name.startsWith('golden')?2:1;
        const item=b.inventory.items().filter(i=>i.name.endsWith('_'+suffix)).sort((a,c)=>score(c.name)-score(a.name))[0];
        const slot={head:5,torso:6,legs:7,feet:8}[destination],worn=b.inventory.slots[slot];
        if(item && (!worn || score(item.name)>score(worn.name))) {this.act({kind:'equip',name:item.name,destination},30);return;}
      }
      if(this.deathPosition && Date.now()<this.recoverUntil) {
        const dist=b.entity.position.distanceTo(this.deathPosition);
        if(dist<=this.policy.config.maxRecoveryDistance && dist>2 && safeStand(b,this.policy,this.deathPosition.floored())) {this.act({kind:'move',position:this.deathPosition.floored(),range:1},25);return;}
        this.deathPosition=null; // Never chase lost items indefinitely or through unknown terrain.
      }
      const items=b.inventory.items(),count=name=>items.filter(i=>i.name===name).reduce((n,i)=>n+i.count,0);
      const log=items.find(i=>/^(oak|spruce|birch|jungle|acacia|dark_oak|mangrove|cherry)_log$/.test(i.name));
      if(log) {this.act({kind:'craft',name:log.name.replace('_log','_planks'),count:1});return;}
      const planks=items.filter(i=>i.name.endsWith('_planks')).reduce((n,i)=>n+i.count,0);
      if(planks>=4 && !count('crafting_table')) {this.act({kind:'craft',name:'crafting_table',count:1});return;}
      if(planks>=2 && count('stick')<4) {this.act({kind:'craft',name:'stick',count:1});return;}
      // A crafting table is infrastructure: its position must be owner-allowlisted, never implicitly open arbitrary containers.
      const table=observedBlocks(b,3).find(x=>x.name==='crafting_table' && this.policy.config.containers.some(c=>c.dimension===b.game.dimension && vec(c.position).equals(x.position)));
      if(table && count('wheat')>=3 && b.recipesFor(b.registry.itemsByName.bread.id,null,1,table).length) {this.act({kind:'craft',name:'bread',count:1});return;}
      if(!table && count('crafting_table')>0 && this.policy.config.allowAutonomousBuilding) {
        const position=this.policy.config.containers.find(c=>c.dimension===b.game.dimension && visibleBlock(b,c.position,4)?.name==='air')?.position;
        if(position) {this.act({kind:'place',name:'crafting_table',position});return;}
      }
      if(table) for(const name of ['stone_pickaxe','stone_sword','wooden_pickaxe']) {
        if(items.some(i=>i.name===name || (name==='wooden_pickaxe' && i.name.endsWith('_pickaxe')))) continue;
        if(b.recipesFor(b.registry.itemsByName[name].id,null,1,table).length) {this.act({kind:'craft',name,count:1});return;}
      }
      if(this.policy.config.allowAutonomousBuilding && b.entity.position.distanceTo(vec(this.policy.config.home))<=4 && count('cobblestone')>0) {
        const requested=shelter(this.policy.config.home),missing=requested.filter(p=>b.blockAt(vec(p))?.name!=='cobblestone');
        if(missing.length) {
          const viewpoints=[[2,0],[2,2],[0,2],[-2,2],[-2,0],[-2,-2],[0,-2],[2,-2]];
          if(this.buildNeedsVantage && this.buildMoves<24) {
            this.buildNeedsVantage=false;
            const [x,z]=viewpoints[this.buildVantage++%viewpoints.length],home=this.policy.config.home,p={x:home.x+x,y:home.y,z:home.z+z};
            if(safeStand(b,this.policy,p)){this.buildMoves++;this.act({kind:'move',position:p});return;}
          }
          for(const position of missing) {
            const target=visibleBlock(b,position,4.5);
            if(target?.name==='air' && this.policy.area(position,b.game.dimension,'build') && !vec(position).equals(b.entity.position.floored())) {
              if(this.act({kind:'place',position,name:'cobblestone'})) return;
            }
          }
          // Bounded survey from ordinary safe walking positions, never place through an occluder.
          if(this.buildMoves<24) {
            const [x,z]=viewpoints[this.buildVantage++%viewpoints.length],home=this.policy.config.home,p={x:home.x+x,y:home.y,z:home.z+z};
            if(safeStand(b,this.policy,p)){this.buildMoves++;this.act({kind:'move',position:p});return;}
          }
        }
      }
      const night=b.time?.timeOfDay>=12500 && b.time?.timeOfDay<=23500;
      if(night && b.entity.position.distanceTo(vec(this.policy.config.home))>2 && safeStand(b,this.policy,this.policy.config.home)) {this.act({kind:'move',position:this.policy.config.home,range:1});return;}
      if(this.policy.config.allowAutonomousMining) {
        const wanted=observedBlocks(b,4).filter(block=>this.policy.area(block.position,b.game.dimension,'mine') && (block.name==='wheat' && block.getProperties().age===7 || (planks<8 && block.name.endsWith('_log')) || (count('cobblestone')<32 && block.name==='stone')));
        if(wanted[0]) this.act({kind:'dig',position:wanted[0].position});
      }
    } catch { this.audit.write('survival-error',{code:'observation-or-policy'}); }
    finally { this.latencies.push(performance.now()-started);if(this.latencies.length>200) this.latencies.shift(); }
  }
  escape(threats) {
    const b=this.bot,base=b.entity.position.floored(),options=[];
    for(let x=-2;x<=2;x++) for(let z=-2;z<=2;z++) if(x || z) {
      const p=base.offset(x,0,z);
      if(!safeStand(b,this.policy,p) || !visibleBlock(b,p.offset(0,-1,0),4)) continue;
      const danger=threats.reduce((score,e)=>score+1/Math.max(.2,e.position.distanceTo(p)),0);
      options.push({p,score:danger+.002*p.distanceTo(vec(this.policy.config.home))});
    }
    options.sort((a,c)=>a.score-c.score);return options[0]?.p;
  }
}
