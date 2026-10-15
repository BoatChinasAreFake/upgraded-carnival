import test from 'node:test';
import assert from 'node:assert/strict';
import { DiscordBridge } from '../src/discord/index.js';
import { Executor } from '../src/executor.js';
import { TaskRunner } from '../src/tasks.js';
import { fakeBot,policy,principal,audit } from './helpers.js';
test('an old AI proposal cannot execute after emergency stop and admin resume',async()=>{
  const b=fakeBot(),p=policy(),e=new Executor(b,p,audit),runner=new TaskRunner(b,e,p,audit);let resolve;
  const bridge=new DiscordBridge(b,e,p,audit,{propose:()=>new Promise(r=>resolve=r)},runner,{cancel:()=>{}});bridge.principal=async()=>principal();
  const pending=bridge.converse('walk somewhere',principal());e.emergencyStop();e.resume(principal(['admin']));
  resolve({reply:'ok',tasks:[{kind:'move',position:{x:1,y:64,z:0}}]});await assert.rejects(pending,/interrupted/);assert.equal(b.entity.position.x,0);bridge.close();
});
test('AI mining proposals cannot authorize a destructive action even for a destroyer',async()=>{
  const b=fakeBot(),p=policy(),e=new Executor(b,p,audit),runner=new TaskRunner(b,e,p,audit);
  await assert.rejects(runner.run([{kind:'mine',position:{x:1,y:64,z:0}}],principal(),undefined,{allowDestructive:false}),/explicit/);assert.equal(e.current,null);
});
