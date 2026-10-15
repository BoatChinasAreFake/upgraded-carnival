import test from 'node:test';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { Executor,attackCooldown,Action } from '../src/executor.js';
import { Policy } from '../src/policy.js';
import { fakeBot,policy,principal,audit,config } from './helpers.js';
import { Vec3 } from 'vec3';
test('role, guild, construction, destructive and container policy fail closed',()=>{
  const p=policy();assert.throws(()=>p.check({kind:'dig',position:{x:1,y:64,z:0}},principal(['op']),'overworld'));
  assert.throws(()=>p.check({kind:'place',position:{x:20,y:64,z:0}},principal(),'overworld'));
  assert.throws(()=>p.check({kind:'container',position:{x:5,y:64,z:0}},principal(),'overworld'));
  assert.throws(()=>p.check({kind:'move',position:{x:1,y:64,z:0}},{...principal(),guildId:'other'},'overworld'));
  assert.throws(()=>p.check({kind:'place',position:{x:1,y:64,z:0}},{kind:'survival'},'overworld'));
  assert.throws(()=>p.check({kind:'attack',player:true},principal(),'overworld'));
  assert.throws(()=>new Policy({...config,allowPlayerCombat:true}));
});
test('action schema cannot smuggle privileged actions or parameters',()=>{
  assert.throws(()=>Action.parse({kind:'command',command:'/give @s diamond'}));
  assert.throws(()=>Action.parse({kind:'dig',position:{x:1,y:64,z:0},ignorePolicy:true}));
  assert.throws(()=>Action.parse({kind:'move',position:{x:NaN,y:64,z:0}}));
});
test('reach and line of sight gate mining before any dig packet',async()=>{
  const b=fakeBot(),e=new Executor(b,policy(),audit);b.dig=()=>{throw Error('Should not run');};
  await assert.rejects(e.submit({kind:'dig',position:{x:10,y:64,z:0}},principal()),/reach/);
  b.world.raycast=()=>({position:new Vec3(1,64,0)});
  await assert.rejects(e.submit({kind:'dig',position:{x:2,y:64,z:0}},principal()),/reach/);
});
test('stop during async equip prevents subsequent attack and resume requires admin',async()=>{
  const b=fakeBot(),e=new Executor(b,policy(),audit);let release;
  b.inventory.items=()=>[{name:'stone_sword',type:1}];b.equip=()=>new Promise(r=>release=r);
  const result=e.submit({kind:'equip',name:'stone_sword',destination:'hand'},principal());
  e.emergencyStop();release();await assert.rejects(result,/cancelled/);
  await assert.rejects(e.submit({kind:'attack',entityId:2}),/latched/);
  assert.throws(()=>e.resume(principal()),/Admin/);e.resume(principal(['admin']));assert.equal(e.stopped,false);
});
test('higher priority preempts movement and never overlaps execution',async()=>{
  const b=fakeBot(),e=new Executor(b,policy(),audit);let cancelMove;
  b.pathfinder.goto=()=>new Promise((r,j)=>cancelMove=()=>j(Error('cancelled')));
  b.pathfinder.setGoal=()=>cancelMove?.();
  const moving=e.submit({kind:'move',position:{x:2,y:64,z:0}},principal());
  const recovery=e.submit({kind:'equip',name:'stone_sword',destination:'hand'},{kind:'survival'},90);
  b.inventory.items=()=>[{name:'stone_sword'}];
  await assert.rejects(moving);await recovery;assert.equal(b.heldItem.name,'stone_sword');assert.equal(e.current,null);
});
test('defensive combat rejects players, unseen mobs and cooldown spam',async()=>{
  const b=fakeBot(),e=new Executor(b,policy(),audit);b.entities[2]={id:2,name:'zombie',type:'mob',position:new Vec3(2,64,0)};
  e.lastAttack=performance.now();await assert.rejects(e.submit({kind:'attack',entityId:2}),/cooldown/);
  e.lastAttack=-10000;e.lastEquip=-10000;await e.submit({kind:'attack',entityId:2});assert.equal(b.attacked.id,2);
  b.entities[2].type='player';await assert.rejects(e.submit({kind:'attack',entityId:2}),/Player/);
  assert.equal(attackCooldown({name:'stone_sword'}),675);assert.equal(attackCooldown({name:'stone_axe'}),1300);
});
test('expired authorization is rejected before side effects',async()=>{
  const e=new Executor(fakeBot(),policy(),audit);await assert.rejects(e.submit({kind:'move',position:{x:1,y:64,z:0}},{...principal(),expiresAt:1}),/expired/);
});
test('a stalled native consume promise does not delay emergency survival actions',async()=>{
  const b=fakeBot(),e=new Executor(b,policy(),audit);b.inventory.items=()=>[{name:'bread'},{name:'stone_sword'}];b.consume=()=>new Promise(()=>{});
  const eating=e.submit({kind:'eat',name:'bread'});await new Promise(r=>setTimeout(r,0));
  const before=performance.now(),defense=e.submit({kind:'equip',name:'stone_sword',destination:'hand'},{kind:'survival'},90);
  await assert.rejects(eating,/cancelled/);await defense;assert.ok(performance.now()-before<100);assert.equal(b.heldItem.name,'stone_sword');
});
test('outbound packet gate rejects late library writes after stop/resume and outside executor',async()=>{
  const b=fakeBot(),packets=[];b._client={write:(name,packet)=>packets.push({name,packet})};
  const e=new Executor(b,policy(),audit);b.inventory.items=()=>[{name:'bread'}];
  b.consume=()=>new Promise(resolve=>{setTimeout(()=>{b._client.write('use_item',{hand:0});resolve();},30);});
  const eating=e.submit({kind:'eat',name:'bread'});await new Promise(r=>setTimeout(r,0));
  e.emergencyStop();await assert.rejects(eating);e.resume(principal(['admin']));
  await new Promise(r=>setTimeout(r,50));b._client.write('use_entity',{target:1});assert.equal(packets.length,0);
});
test('1.21.11 copper tools and new melee weapons use conservative combat intervals',()=>{
  assert.equal(attackCooldown({name:'copper_sword'}),675);
  assert.equal(attackCooldown({name:'copper_axe'}),1300);
  assert.equal(attackCooldown({name:'copper_hoe'}),1050);
  assert.ok(attackCooldown({name:'mace'})>=1000/.6);
  for(const name of ['wooden_spear','copper_spear','netherite_spear']) assert.ok(attackCooldown({name})>=2000);
});
