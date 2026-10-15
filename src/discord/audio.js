import { Worker } from 'node:worker_threads';
import { endpoint,limitedResponse,serviceConfig } from '../planner/http.js';
export function pcmToWav(pcm) {
  // Discord decode: 48 kHz stereo signed 16-bit little-endian -> 24 kHz mono WAV.
  const samples=Math.floor(pcm.length/8),out=Buffer.alloc(samples*2+44);
  out.write('RIFF');out.writeUInt32LE(out.length-8,4);out.write('WAVEfmt ',8);out.writeUInt32LE(16,16);out.writeUInt16LE(1,20);out.writeUInt16LE(1,22);out.writeUInt32LE(24000,24);out.writeUInt32LE(48000,28);out.writeUInt16LE(2,32);out.writeUInt16LE(16,34);out.write('data',36);out.writeUInt32LE(samples*2,40);
  for(let i=0;i<samples;i++) {const offset=i*8,value=(pcm.readInt16LE(offset)+pcm.readInt16LE(offset+2)+pcm.readInt16LE(offset+4)+pcm.readInt16LE(offset+6))/4;out.writeInt16LE(Math.round(value),44+i*2);}
  return out;
}
export function speechToDiscord(pcm) {
  // OpenAI raw speech: 24 kHz mono -> Discord raw 48 kHz stereo.
  if(pcm.length%2) throw Error('Invalid speech PCM');
  const out=Buffer.alloc(pcm.length*4);for(let i=0;i<pcm.length/2;i++){const sample=pcm.readInt16LE(i*2);for(let n=0;n<4;n++) out.writeInt16LE(sample,i*8+n*2);}return out;
}
export function convertAudio(kind,pcm,signal) {
  if(pcm.length>4*1024*1024 || signal.aborted) return Promise.reject(Error('Audio limit or interruption'));
  return new Promise((resolve,reject)=>{
    const worker=new Worker(new URL('./audio-worker.js',import.meta.url),{resourceLimits:{maxOldGenerationSizeMb:64}});
    const cleanup=()=>{clearTimeout(timer);signal.removeEventListener('abort',abort);void worker.terminate();};
    const abort=()=>{cleanup();reject(Error('Audio interrupted'));};
    const timer=setTimeout(abort,5000);signal.addEventListener('abort',abort,{once:true});
    worker.once('error',()=>{cleanup();reject(Error('Audio worker failed'));});
    worker.once('message',({bytes,error})=>{cleanup();error?reject(Error(error)):resolve(Buffer.from(bytes));});
    worker.postMessage({kind,pcm});
  });
}
export class Speech {
  constructor() {this.config=serviceConfig();}
  async transcribe(pcm,signal) {
    if(!this.config.key) throw Error('Speech credential missing');
    const wav=await convertAudio('wav',pcm,signal);
    const form=new FormData();form.set('file',new Blob([wav],{type:'audio/wav'}),'speech.wav');form.set('model',process.env.STT_MODEL ?? 'gpt-4o-mini-transcribe');form.set('response_format','json');
    const response=await fetch(endpoint(this.config.base,'audio/transcriptions',this.config.hosts),{method:'POST',redirect:'error',headers:{Authorization:`Bearer ${this.config.key}`},body:form,signal:AbortSignal.any([signal,AbortSignal.timeout(15000)])});
    const result=JSON.parse((await limitedResponse(response)).toString());if(typeof result.text!=='string' || result.text.length>2000) throw Error('Invalid transcript');return result.text;
  }
  async synthesize(text,signal) {
    if(!this.config.key) throw Error('Speech credential missing');
    const response=await fetch(endpoint(this.config.base,'audio/speech',this.config.hosts),{method:'POST',redirect:'error',headers:{Authorization:`Bearer ${this.config.key}`,'Content-Type':'application/json'},body:JSON.stringify({model:process.env.TTS_MODEL ?? 'gpt-4o-mini-tts',voice:process.env.TTS_VOICE ?? 'alloy',input:text.slice(0,600),response_format:'pcm'}),signal:AbortSignal.any([signal,AbortSignal.timeout(15000)])});
    return convertAudio('discord',await limitedResponse(response,4*1024*1024),signal);
  }
}
