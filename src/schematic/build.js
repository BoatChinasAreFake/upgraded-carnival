import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { vec, key, visibleBlock, safeStand } from '../observation.js';
import { supportedReference } from '../placement.js';
const directions=[{x:0,y:-1,z:0},{x:1,y:0,z:0},{x:-1,y:0,z:0},{x:0,y:0,z:1},{x:0,y:0,z:-1},{x:0,y:1,z:0}];
export function constructionPlan(schematic,origin,observe,{maxSupports=128,maxDepth=8}={}) {
  const requested=schematic.blocks.map(b=>({...b,x:b.x+origin.x,y:b.y+origin.y,z:b.z+origin.z,temporary:false}));
  const planned=new Map(requested.map(b=>[key(b),b])),ordered=[],done=new Set(),supports=[];
  for(const b of requested) {
    const existing=observe(b);if(!existing) throw Error('Build site is not fully visible; survey it first');
    if(existing.name===b.name) done.add(key(b));
    else if(!['air','cave_air','void_air'].includes(existing.name)) throw Error('Build conflicts with existing blocks; automatic demolition is forbidden');
  }
  function supported(b) {
    return directions.some(d=>{
      const p={x:b.x+d.x,y:b.y+d.y,z:b.z+d.z};
      if(done.has(key(p))) return true;
      const existing=observe(p);return existing?.boundingBox==='block' && supportedReference(existing.name);
    });
  }
  let pending=requested.filter(b=>!done.has(key(b)));
  while(pending.length) {
    const next=pending.find(supported);
    if(next) {ordered.push(next);done.add(key(next));pending=pending.filter(b=>b!==next);continue;}
    const root=pending.slice().sort((a,b)=>a.y-b.y)[0],chain=[];let grounded=false;
    for(let depth=1;depth<=maxDepth;depth++) {
      const p={x:root.x,y:root.y-depth,z:root.z,name:'cobblestone',temporary:true};
      const existing=observe(p);
      if(!existing) throw Error('Support terrain unknown or occluded');
      if(existing.boundingBox==='block' && supportedReference(existing.name)) {grounded=true;break;}
      if(!['air','cave_air','void_air'].includes(existing.name) || planned.has(key(p))) throw Error('Unsafe support column');
      chain.push(p);
    }
    if(!grounded || supports.length+chain.length>maxSupports) throw Error('Cannot provide bounded legitimate supports');
    for(const p of chain.reverse()) {ordered.push(p);supports.push(p);done.add(key(p));}
  }
  const materials={};for(const b of ordered) materials[b.name]=(materials[b.name]??0)+1;
  return {ordered,materials,supports,requested};
}
export class Builder {
  constructor(bot,executor,policy,audit,{directory='runtime/checkpoints'}={}) {Object.assign(this,{bot,executor,policy,audit,directory});this.cancelled=false;}
  cancel() {this.cancelled=true;}
  plan(schematic,origin,principal) {
    this.policy.authorizeTask(principal,{kind:'build',position:origin});
    if(schematic.blocks.length>Math.min(512,this.policy.config.maxTaskActions)) throw Error('Build exceeds bounded visible-site action budget');
    const plan=constructionPlan(schematic,origin,p=>visibleBlock(this.bot,p,6));
    for(const b of plan.ordered) {
      this.policy.check({kind:'place',position:b},principal,this.bot.game.dimension);
      if(b.name==='crafting_table') this.policy.check({kind:'container',position:b},principal,this.bot.game.dimension);
    }
    return plan;
  }
  checkpoint(id,data) {
    fs.mkdirSync(this.directory,{recursive:true,mode:0o700});const file=path.join(this.directory,id+'.json');
    fs.writeFileSync(file+'.tmp',JSON.stringify(data,null,2),{mode:0o600});fs.renameSync(file+'.tmp',file);
  }
  async run(schematic,origin,principal,refresh=async()=>principal) {
    this.cancelled=false;const plan=this.plan(schematic,origin,principal),id=crypto.createHash('sha256').update(schematic.sha256+JSON.stringify(origin)+this.bot.game.dimension).digest('hex');
    if(plan.ordered.length>this.policy.config.maxTaskActions) throw Error('Build exceeds action budget');
    for(const [name,n] of Object.entries(plan.materials)) if(this.bot.inventory.items().filter(i=>i.name===name).reduce((s,i)=>s+i.count,0)<n) throw Error(`Missing material ${name}: ${n}`);
    const previousFile=path.join(this.directory,id+'.json');
    const previous=fs.existsSync(previousFile)?JSON.parse(fs.readFileSync(previousFile,'utf8')):null;
    const supports=[...new Map([...(previous?.supports??[]),...plan.supports].map(p=>[key(p),p])).values()];
    const state={id,schematic:schematic.sha256,origin,dimension:this.bot.game.dimension,completed:[],supports,status:'running'};
    this.checkpoint(id,state);
    try {
      for(const b of plan.ordered) {
        if(this.cancelled || this.executor.stopped) throw Error('Build cancelled');
        principal=await refresh();if(this.cancelled || this.executor.stopped) throw Error('Build cancelled');this.policy.authorizeTask(principal,{kind:'build',position:origin});
        if(this.bot.entity.position.distanceTo(vec(b))>4) {
          const stands=[];for(let x=-2;x<=2;x++) for(let z=-2;z<=2;z++) {
            const p={x:b.x+x,y:b.y,z:b.z+z};if(safeStand(this.bot,this.policy,p)) stands.push(p);
          }
          const stand=stands.sort((a,c)=>this.bot.entity.position.distanceTo(vec(a))-this.bot.entity.position.distanceTo(vec(c)))[0];
          if(!stand) throw Error('No safe reachable construction stance');
          await this.executor.submit({kind:'move',position:stand},principal,0);
        }
        await this.executor.submit({kind:'place',position:{x:b.x,y:b.y,z:b.z},name:b.name},principal,0);
        if(visibleBlock(this.bot,b,5)?.name!==b.name) throw Error('Verification failed');
        state.completed.push(key(b));this.checkpoint(id,state);
      }
      // Final reconciliation uses visible world state, never trusts saved completion flags.
      for(const b of plan.requested) if(visibleBlock(this.bot,b,6)?.name!==b.name) throw Error('Final verification requires site survey');
      state.status='complete';this.audit.write('build-complete',{id,blocks:state.completed.length});
    } catch(error) {state.status='paused';throw error;} finally {this.checkpoint(id,state);}
    return state;
  }
}
