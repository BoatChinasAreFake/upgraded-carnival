import { parentPort } from 'node:worker_threads';
import { pcmToWav,speechToDiscord } from './audio.js';
parentPort.once('message',({kind,pcm})=>{
  try {const bytes=kind==='wav'?pcmToWav(Buffer.from(pcm)):speechToDiscord(Buffer.from(pcm));parentPort.postMessage({bytes});}
  catch {parentPort.postMessage({error:'Audio conversion rejected'});}
});
