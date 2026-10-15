import { EventEmitter } from 'node:events';
import { AsyncLocalStorage } from 'node:async_hooks';
import { performance } from 'node:perf_hooks';
import { z } from 'zod';
import pathfinderPackage from 'mineflayer-pathfinder';
import { Point } from './policy.js';
import { vec, visible, visibleBlock, safeStand, hostileNames, hazardNames, eye, observedBlocks } from './observation.js';
const { goals, Movements } = pathfinderPackage;
const Name=z.string().regex(/^[a-z0-9_]+$/).max(80);
export const Action = z.discriminatedUnion('kind',[
  z.object({kind:z.literal('move'),position:Point,range:z.number().min(0).max(2).default(0)}).strict(),
  z.object({kind:z.literal('dig'),position:Point}).strict(),
  z.object({kind:z.literal('place'),position:Point,name:Name}).strict(),
  z.object({kind:z.literal('attack'),entityId:z.number().int()}).strict(),
  z.object({kind:z.literal('eat'),name:Name}).strict(),
  z.object({kind:z.literal('equip'),name:Name,destination:z.enum(['hand','head','torso','legs','feet'])}).strict(),
  z.object({kind:z.literal('craft'),name:Name,count:z.number().int().min(1).max(16)}).strict(),
  z.object({kind:z.literal('container'),position:Point,operation:z.enum(['withdraw','deposit']),name:Name,count:z.number().int().min(1).max(64)}).strict(),
  z.object({kind:z.literal('respawn')}).strict()
]);
export function attackCooldown(item) {
  const name=item?.name ?? '';
  const speed=name.endsWith('_sword') ? 1.6 : name.endsWith('_axe') ? (/^(wooden|stone)_/.test(name) ? .8 : name.startsWith('iron_') ? .9 : 1) : name.endsWith('_pickaxe') ? 1.2 : name.endsWith('_shovel') ? 1 : name.endsWith('_hoe') ? ({wooden_hoe:1,stone_hoe:2,iron_hoe:3}[name] ?? 4) : name==='trident' ? 1.1 : 4;
  return 1000/speed+50;
}
import { supportedPlacement,supportedReference } from './placement.js';
export { supportedPlacement } from './placement.js';
export class Executor extends EventEmitter {
  constructor(bot,policy,audit,{timeoutMs=12000}={}) {
    super(); this.bot=bot;this.policy=policy;this.audit=audit;this.timeoutMs=timeoutMs;
    this.context=new AsyncLocalStorage();this.installPacketGuard();
    this.queue=[];this.current=null;this.epoch=0;this.stopped=false;this.lastAttack=0;this.lastEquip=0;
    this.movements=new Movements(bot); this.movements.canDig=false;this.movements.allow1by1towers=false;
    this.movements.allowParkour=false;this.movements.allowFreeMotion=false;this.movements.allowSprinting=false;
    this.movements.canOpenDoors=false;this.movements.maxDropDown=1;this.movements.scafoldingBlocks=[];
    for(const name of [...hazardNames,'water']) { const id=bot.registry.blocksByName[name]?.id; if(id!==undefined) this.movements.blocksToAvoid.add(id); }
    this.movements.exclusionAreasStep.push(b=>policy.area(b.position,bot.game.dimension) ? 0 : 10000);
    bot.pathfinder.setMovements(this.movements); bot.pathfinder.thinkTimeout=2000;bot.pathfinder.tickTimeout=5;bot.pathfinder.searchRadius=32;
    bot.on('entityMoved',e=>{if(e===bot.entity && !policy.area(bot.entity.position,bot.game.dimension)) this.emergencyStop('area-boundary');});
    bot.on('death',()=>this.cancel('death'));
  }
  installPacketGuard() {
    if(!this.bot._client) return;
    const client=this.bot._client,write=client.write.bind(client);
    const controlled=new Set(['use_entity','use_item','block_place','block_dig','window_click','held_item_slot','arm_animation','client_command','chat','chat_message','chat_command','chat_command_signed']);
    client.write=(name,packet)=>{
      if(!controlled.has(name) || (name==='block_dig' && [1,5].includes(packet.status))) return write(name,packet);
      const ctx=this.context.getStore();
      try { if(!ctx) throw Error('No executor action context');this.guard(ctx);return write(name,packet); }
      catch {this.audit.write('packet-denied',{packet:name});return false;}
    };
  }
  cancellable(promise,signal) {
    return new Promise((resolve,reject)=>{
      const abort=()=>reject(Error('Action cancelled'));
      if(signal.aborted) {abort();Promise.resolve(promise).catch(()=>{});return;}
      signal.addEventListener('abort',abort,{once:true});
      Promise.resolve(promise).then(resolve,reject).finally(()=>signal.removeEventListener('abort',abort));
    });
  }
  submit(raw,principal={kind:'survival'},priority=0) {
    const action=Action.parse(raw);
    if(this.stopped) return Promise.reject(Error('Emergency stop latched'));
    if(this.queue.length>=32) return Promise.reject(Error('Action queue full'));
    return new Promise((resolve,reject)=>{
      if(this.current && priority>this.current.priority) this.cancel('survival-preemption');
      this.queue.push({action,principal,priority,resolve,reject});this.queue.sort((a,b)=>b.priority-a.priority);void this.pump();
    });
  }
  cancel(reason) {
    this.epoch++; this.bot.pathfinder.setGoal(null);this.bot.clearControlStates();
    try{this.bot.stopDigging();}catch{} this.bot.deactivateItem();
    if(this.bot.currentWindow) this.bot.closeWindow(this.bot.currentWindow);
    this.current?.abort.abort();
    for(const pending of this.queue.splice(0)) pending.reject(Error('Action cancelled'));
    this.audit.write('cancel',{reason});
  }
  emergencyStop(reason='operator') { this.stopped=true;this.cancel(reason);this.audit.write('emergency-stop',{reason});this.emit('stop'); }
  resume(principal) { if(!this.policy.has(principal,'admin')) throw Error('Admin required');this.stopped=false;this.audit.write('resume',{actor:principal.id}); }
  async pump() {
    if(this.current || this.stopped || !this.queue.length) return;
    const item=this.queue.shift();this.current={...item,abort:new AbortController(),epoch:this.epoch};
    const current=this.current;
    const timer=setTimeout(()=>{ this.emergencyStop('action-timeout');this.bot.quit('Action timeout'); },this.timeoutMs);timer.unref();
    try {
      this.guard(current);this.audit.write('action-start',{kind:item.action.kind,actor:item.principal.id ?? 'survival',position:item.action.position});
      await this.cancellable(this.context.run(current,()=>this.run(current)),current.abort.signal);this.guard(current);
      this.audit.write('action-complete',{kind:item.action.kind});item.resolve(true);
    } catch(error) { this.emit('actionError',{action:item.action,error});this.audit.write('action-failed',{kind:item.action.kind,code:current.abort.signal.aborted?'cancelled':'rejected'});item.reject(error); }
    finally { clearTimeout(timer);if(this.current===current) this.current=null;this.emit('idle');void this.pump(); }
  }
  guard(ctx) {
    if(this.stopped || ctx.epoch!==this.epoch || ctx.abort.signal.aborted) throw Error('Action cancelled');
    if(ctx.principal.expiresAt && ctx.principal.expiresAt<Date.now()) throw Error('Role authorization expired');
    const action=ctx.action, entity=action.kind==='attack'?this.bot.entities[action.entityId]:null;
    this.policy.check({...action,player:entity?.type==='player'},ctx.principal,this.bot.game.dimension);
    if(action.kind!=='respawn' && this.bot.health<=0) throw Error('Bot dead');
  }
  async equip(ctx,name,destination='hand') {
    this.guard(ctx);const item=this.bot.inventory.items().find(i=>i.name===name);if(!item) throw Error('Item unavailable');
    await this.bot.equip(item,destination);this.guard(ctx);this.lastEquip=performance.now();return item;
  }
  block(ctx) { this.guard(ctx);const b=visibleBlock(this.bot,ctx.action.position,4.5);if(!b) throw Error('Block outside reach or line of sight');return b; }
  async run(ctx) {
    const a=ctx.action,b=this.bot;
    switch(a.kind) {
      case 'move': {
        if(b.entity.position.distanceTo(vec(a.position))>32) throw Error('Move exceeds bounded navigation range');
        if(!safeStand(b,this.policy,a.position)) throw Error('Unsafe or unknown destination');
        await b.pathfinder.goto(new goals.GoalNear(a.position.x,a.position.y,a.position.z,a.range));
        if(b.entity.position.distanceTo(vec(a.position))>a.range+1.5) throw Error('Navigation not verified');break;
      }
      case 'equip': await this.equip(ctx,a.name,a.destination);break;
      case 'eat': {
        if(!b.registry.foodsByName[a.name] || /rotten_flesh|spider_eye|pufferfish|poisonous_potato|chorus_fruit|raw_/.test(a.name)) throw Error('Unsafe food');
        await this.equip(ctx,a.name);await b.consume();break;
      }
      case 'attack': {
        const e=b.entities[a.entityId];
        if(!e || !hostileNames.has(e.name) || e.type==='player' || e.position.distanceTo(b.entity.position)>3 || !visible(b,e.position.offset(0,.8,0),3.5)) throw Error('Not a visible close hostile');
        const now=performance.now();if(now-Math.max(this.lastAttack,this.lastEquip)<attackCooldown(b.heldItem)) throw Error('Combat cooldown');
        await b.lookAt(e.position.offset(0,.8,0),false);this.guard(ctx);
        if(e.position.distanceTo(b.entity.position)>3 || !visible(b,e.position.offset(0,.8,0),3.5)) throw Error('Target moved');
        b.attack(e);this.lastAttack=performance.now();break;
      }
      case 'dig': {
        let block=this.block(ctx);
        if(['air','cave_air','void_air','bedrock','water','lava'].includes(block.name) || hazardNames.has(block.name) || block.name.includes('chest') || block.name.includes('shulker') || block.name==='barrel' || this.policy.config.containers.some(c=>c.dimension===b.game.dimension && vec(c.position).equals(block.position))) throw Error('Protected block');
        const p=block.position, foot=b.entity.position.floored();
        if(p.x===foot.x && p.z===foot.z && p.y<=foot.y) throw Error('Cannot mine under feet');
        const above=b.blockAt(p.offset(0,1,0));if(above && (['sand','gravel'].includes(above.name) || hazardNames.has(above.name))) throw Error('Unstable or hazardous block');
        const tools=b.inventory.items().filter(i=>block.canHarvest(i.type));
        tools.sort((x,y)=>block.digTime(x.type,false,false,false,[],{})-block.digTime(y.type,false,false,false,[],{}));
        if(tools[0]) await this.equip(ctx,tools[0].name);
        block=this.block(ctx);if(!block.canHarvest(b.heldItem?.type ?? null) || !b.canDigBlock(block)) throw Error('Cannot harvest');
        await b.dig(block);this.guard(ctx);
        if(b.blockAt(p)?.name===block.name) throw Error('Mining not verified');break;
      }
      case 'place': {
        if(!supportedPlacement(a.name)) throw Error('Unsupported placement state');
        if(a.name==='crafting_table') this.policy.check({kind:'container',position:a.position},ctx.principal,b.game.dimension);
        const target=this.block(ctx);if(!['air','cave_air','void_air'].includes(target.name)) throw Error('Placement would replace existing block');
        if(b.entity.position.floored().equals(vec(a.position)) || b.entity.position.floored().offset(0,1,0).equals(vec(a.position))) throw Error('Placement intersects bot');
        await this.equip(ctx,a.name);
        const faces=[vec({x:0,y:1,z:0}),vec({x:1,y:0,z:0}),vec({x:-1,y:0,z:0}),vec({x:0,y:0,z:1}),vec({x:0,y:0,z:-1}),vec({x:0,y:-1,z:0})];
        let placed=false;
        for(let attempt=0;attempt<2 && !placed;attempt++) {
          if(attempt===1) {
            if(!b.entity.onGround) break;
            const ground=b.blockAt(b.entity.position.floored().offset(0,-1,0));
            if(!ground || hazardNames.has(ground.name)) break;
            await b.lookAt(vec(a.position).offset(.5,0,.5),false);this.guard(ctx);b.setControlState('jump',true);await b.waitForTicks(6);this.guard(ctx);b.setControlState('jump',false);
          }
          for(const face of faces) {
            const ref=b.blockAt(vec(a.position).minus(face));
            if(!ref || ref.boundingBox!=='block' || !supportedReference(ref.name)) continue;
            const hit=ref.position.offset(.5,.5,.5).plus(face.scaled(.5));
            const origin=eye(b),delta=hit.minus(origin),length=delta.norm();
            if(length>4.5) continue;
            const ray=b.world.raycast(origin,delta.scaled(1/length),length+.05);
            if(!ray || !ray.position.equals(ref.position) || !ray.intersect || ray.intersect.distanceTo(hit)>.1) continue;
            if(b.entity.position.floored().equals(vec(a.position)) || b.entity.position.floored().offset(0,1,0).equals(vec(a.position))) continue;
            this.guard(ctx);if(!['air','cave_air','void_air'].includes(this.block(ctx).name)) throw Error('Placement target changed');
            await b.lookAt(hit,false);this.guard(ctx);
            const latest=eye(b),difference=hit.minus(latest),distance=difference.norm();
            const latestRay=b.world.raycast(latest,difference.scaled(1/distance),distance+.05);
            if(distance>4.5 || !latestRay?.position.equals(ref.position) || latestRay.intersect?.distanceTo(hit)>.1) continue;
            if(!['air','cave_air','void_air'].includes(this.block(ctx).name) || b.entity.position.floored().equals(vec(a.position)) || b.entity.position.floored().offset(0,1,0).equals(vec(a.position))) throw Error('Placement target changed or intersects bot');
            await b._placeBlockWithOptions(ref,face,{forceLook:'ignore',swingArm:'right'});placed=true;break;
          }
        }
        if(!placed) throw Error('No reachable visible support');
        this.guard(ctx);if(b.blockAt(vec(a.position))?.name!==a.name) throw Error('Placement not verified');break;
      }
      case 'craft': {
        const item=b.registry.itemsByName[a.name];if(!item) throw Error('Unknown recipe');
        let table=observedBlocks(b,3).find(block=>block.name==='crafting_table');
        const handRecipe=b.recipesFor(item.id,null,1,null)[0];
        if(handRecipe) table=null;
        const recipe=handRecipe ?? b.recipesFor(item.id,null,1,table)[0];if(!recipe) throw Error('Materials or crafting table unavailable');
        if(table) this.policy.check({kind:'container',position:table.position},ctx.principal,b.game.dimension);
        for(const delta of recipe.delta) if(delta.count<0) {
          const available=b.inventory.items().filter(i=>i.type===delta.id && (delta.metadata==null || i.metadata===delta.metadata)).reduce((n,i)=>n+i.count,0);
          if(available<-delta.count*a.count) throw Error('Materials unavailable for all repetitions');
        }
        for(let iteration=0;iteration<a.count;iteration++) {
          this.guard(ctx);const before=b.inventory.items().filter(i=>i.type===item.id).reduce((n,i)=>n+i.count,0);
          // Close/synchronize each ordinary recipe invocation; do not rely on optimistic repeated-craft window state.
          await b.craft(recipe,1,table);this.guard(ctx);
          const deadline=Date.now()+1500;
          while(b.inventory.items().filter(i=>i.type===item.id).reduce((n,i)=>n+i.count,0)<before+recipe.result.count) {
            if(Date.now()>deadline) throw Error('Crafting result not verified');await b.waitForTicks(1);this.guard(ctx);
          }
        }
        break;
      }
      case 'container': {
        const block=this.block(ctx);if(!['chest','barrel'].includes(block.name)) throw Error('Unsupported container');
        if(block.name==='chest' && block.getProperties().type!=='single') throw Error('Double chests unsupported; allowlist single containers');
        const window=await b.openContainer(block);
        try { this.guard(ctx);const id=b.registry.itemsByName[a.name]?.id;if(!id) throw Error('Unknown item');await window[a.operation](id,null,a.count);this.guard(ctx); }
        finally {window.close();} break;
      }
      case 'respawn': if(b.health>0) throw Error('Not dead');b.respawn();break;
    }
  }
}
