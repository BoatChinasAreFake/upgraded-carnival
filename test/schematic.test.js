import test from 'node:test';
import assert from 'node:assert/strict';
import { gzipSync } from 'node:zlib';
import { loadSchematic } from '../src/schematic/load.js';
import { constructionPlan } from '../src/schematic/build.js';
import { fixture } from './fixture.js';
test('sandbox parses material counts and negative region size coordinates',async()=>{
  const result=await loadSchematic(fixture({size:{x:-1,y:-1,z:-1},position:{x:2,y:3,z:4}}));assert.deepEqual(result.blocks,[{x:2,y:3,z:4,name:'cobblestone'}]);assert.equal(result.materials.cobblestone,1);assert.match(result.sha256,/^[0-9a-f]{64}$/);
});
test('sandbox rejects unsupported versions, block states, truncated data and gzip bombs',async()=>{
  for(const data of [fixture({dataVersion:3955}),fixture({name:'minecraft:chest'}),fixture({properties:{waterlogged:'true'}}),Buffer.from([10,0]),gzipSync(Buffer.alloc(9*1024*1024)),fixture({words:[[0,3]]})]) await assert.rejects(loadSchematic(data));
});
test('continuous packed values across 64 bit boundaries decode correctly',async()=>{
  // 33 two-bit palette indices, all cobblestone, including one crossing into second word.
  const result=await loadSchematic(fixture({size:{x:33,y:1,z:1},words:[[0x55555555,0x55555555],[0,1]]}));assert.equal(result.blocks.length,33);
});
test('supports are planned bottom up, included in materials, and terrain unknown is rejected',()=>{
  const schematic={blocks:[{x:0,y:2,z:0,name:'glass'}]},observe=p=>({name:p.y<0?'stone':'air',boundingBox:p.y<0?'block':'empty'});
  const plan=constructionPlan(schematic,{x:0,y:64,z:0},p=>observe({...p,y:p.y-64}));
  assert.deepEqual(plan.ordered.map(b=>b.y),[64,65,66]);assert.deepEqual(plan.materials,{cobblestone:2,glass:1});
  assert.throws(()=>constructionPlan(schematic,{x:0,y:64,z:0},()=>null),/visible/);
  assert.throws(()=>constructionPlan(schematic,{x:0,y:64,z:0},()=>({name:'chest',boundingBox:'block'})),/conflicts/);
});
test('three-bit palette index straddling a signed 64-bit word is decoded accurately',async()=>{
  const result=await loadSchematic(fixture({size:{x:22,y:1,z:1},paletteNames:['air','cobblestone','dirt','stone','glass'],words:[[-2147483648,0],[0,1]]}));
  assert.deepEqual(result.blocks,[{x:21,y:0,z:0,name:'stone'}]);
});
