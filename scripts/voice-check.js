import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { voiceCapabilities } from '../src/discord/voice.js';
import davey from '@snazzah/davey';
import OpusScript from 'opusscript';
const capabilities=voiceCapabilities();assert(capabilities.daveVersion>=1);assert(crypto.getCiphers().includes('aes-256-gcm'));
const session=new davey.DAVESession(capabilities.daveVersion,'100000000000000001','100000000000000002');assert(session);
const codec=new OpusScript(48000,2,OpusScript.Application.AUDIO),pcm=Buffer.alloc(960*2*2),packet=codec.encode(pcm,960),decoded=codec.decode(packet);assert.equal(decoded.length,pcm.length);codec.delete();
console.log(capabilities.report);console.log('DAVE native session, AES-GCM, and Opus encode/decode passed. Live Discord voice negotiation/reception still requires credentials and a guild.');
