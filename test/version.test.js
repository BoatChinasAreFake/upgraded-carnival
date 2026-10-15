import test from 'node:test';
import assert from 'node:assert/strict';
import data from 'minecraft-data';
import mineflayer from 'mineflayer';
import { MINECRAFT,TEST_SERVER_DIRECTORY } from '../src/version.js';
import { loadSchematic } from '../src/schematic/load.js';
import { fixture } from './fixture.js';
import { Builder } from '../src/schematic/build.js';
import { fakeBot,policy,principal,audit } from './helpers.js';

test('pinned dependencies match Java 1.21.11 protocol and world data version',()=>{
  assert.equal(MINECRAFT.version,'1.21.11');
  assert.equal(MINECRAFT.protocolVersion,774);
  assert.equal(MINECRAFT.dataVersion,4671);
  const registry=data(MINECRAFT.version);
  assert.equal(registry.version.minecraftVersion,MINECRAFT.version);
  assert.equal(registry.version.version,MINECRAFT.protocolVersion);
  assert.equal(registry.version.dataVersion,MINECRAFT.dataVersion);
  assert.ok(mineflayer.testedVersions.includes(MINECRAFT.version));
  assert.equal(registry.supportFeature('sendsPlayerLoadedPacket'),true,'The client must announce player_loaded before survival interactions');
  assert.equal(TEST_SERVER_DIRECTORY,'runtime/test-server-1.21.11');
});
test('sandbox accepts the current v7 schematic format and rejects legacy/mismatched exports',async()=>{
  const schematic=await loadSchematic(fixture());
  assert.equal(schematic.format,7);assert.equal(schematic.dataVersion,4671);
  for(const options of [
    {format:6,dataVersion:3700},
    {format:7,dataVersion:3700},
    {format:6,dataVersion:4671},
    {format:7,subVersion:2},
    {dataVersion:4672}
  ]) await assert.rejects(loadSchematic(fixture(options)));
});
test('builder refuses obsolete in-memory schematics before inspecting or modifying the world',()=>{
  const b=fakeBot(),builder=new Builder(b,{},policy(),audit);
  assert.throws(()=>builder.plan({format:6,dataVersion:3700,blocks:[]},{x:0,y:64,z:0},principal()),/version/);
});
