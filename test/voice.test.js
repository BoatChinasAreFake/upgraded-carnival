import test from 'node:test';
import assert from 'node:assert/strict';
import { pcmToWav,speechToDiscord } from '../src/discord/audio.js';
import { VoiceBridge,voiceCapabilities } from '../src/discord/voice.js';
import { commandDefinitions,downloadAttachment } from '../src/discord/index.js';
import { policy,audit } from './helpers.js';
test('audio converters preserve format and signed samples',()=>{
  const pcm=Buffer.alloc(16);for(let i=0;i<8;i++) pcm.writeInt16LE(-1000,i*2);
  const wav=pcmToWav(pcm);assert.equal(wav.toString('ascii',0,4),'RIFF');assert.equal(wav.readUInt32LE(24),24000);assert.equal(wav.readInt16LE(44),-1000);
  const discord=speechToDiscord(wav.subarray(44));assert.equal(discord.length,16);assert.equal(discord.readInt16LE(14),-1000);
});
test('voice interruption aborts in-flight speech immediately and stale speech cannot play',async()=>{
  let release,signal;const bridge=new VoiceBridge(policy(),audit,()=>{},()=>{}, {speech:{synthesize:(_text,s)=>{signal=s;return new Promise(r=>release=r);}}});
  bridge.connection={};let played=false;bridge.player.play=()=>{played=true;};
  const pending=bridge.say('hello');bridge.interrupt();assert.equal(signal.aborted,true);release(Buffer.alloc(3840));await pending;assert.equal(played,false);bridge.connection=null;bridge.leave();
});
test('current installed DAVE library exposes supported protocol and slash stop exists',()=>{
  assert.equal(voiceCapabilities().daveVersion,1);assert.ok(commandDefinitions().some(c=>c.name==='stop'));
});
test('attachment loader rejects SSRF and large/non-schematic input before network',async()=>{
  await assert.rejects(downloadAttachment({name:'x.litematic',size:1,url:'https://127.0.0.1/secret'}));
  await assert.rejects(downloadAttachment({name:'x.exe',size:1,url:'https://cdn.discordapp.com/file'}));
  await assert.rejects(downloadAttachment({name:'x.litematic',size:3*1024*1024,url:'https://cdn.discordapp.com/file'}));
});
test('bulk audio conversion runs in a bounded worker and honors interruption',async()=>{
  const {convertAudio}=await import('../src/discord/audio.js');
  const controller=new AbortController(),pcm=Buffer.alloc(38400);
  const result=await convertAudio('wav',pcm,controller.signal);assert.equal(result.toString('ascii',0,4),'RIFF');
  const interrupted=convertAudio('discord',pcm,controller.signal);controller.abort();await assert.rejects(interrupted,/interrupted/);
});
test('authorized received Opus reaches transcription, conversation and playback pipeline',async()=>{
  const {Readable}=await import('node:stream'),{default:OpusScript}=await import('opusscript');
  const codec=new OpusScript(48000,2,OpusScript.Application.AUDIO),packet=codec.encode(Buffer.alloc(3840),960);codec.delete();
  let transcribed=false,conversed=false,played=false;
  const bridge=new VoiceBridge(policy(),audit,async(text)=>{assert.equal(text,'status');conversed=true;return 'Health is twenty.';},async()=>({kind:'discord',guildId:'guild',id:'u',roles:['op']}),{speech:{transcribe:async bytes=>{transcribed=bytes.length>=19200;return 'status';},synthesize:async()=>Buffer.alloc(3840)}});
  bridge.connection={receiver:{subscribe:()=>Readable.from(Array.from({length:10},()=>packet))}};
  bridge.player.play=()=>{played=true;};await bridge.receive('u',{});
  const until=Date.now()+2000;while(!played && Date.now()<until) await new Promise(r=>setTimeout(r,10));
  assert.ok(transcribed && conversed && played);bridge.connection=null;bridge.leave();
});
