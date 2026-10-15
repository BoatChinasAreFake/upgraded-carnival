import { Readable } from 'node:stream';
import prism from 'prism-media';
import { createAudioPlayer,createAudioResource,joinVoiceChannel,entersState,VoiceConnectionStatus,AudioPlayerStatus,EndBehaviorType,StreamType,generateDependencyReport } from '@discordjs/voice';
import davey from '@snazzah/davey';
import { Speech } from './audio.js';
export function voiceCapabilities() {if(davey.DAVE_PROTOCOL_VERSION<1) throw Error('DAVE unavailable');return {daveVersion:davey.DAVE_PROTOCOL_VERSION,report:generateDependencyReport()};}
export class VoiceBridge {
  constructor(policy,audit,onText,authorize,{speech=new Speech()}={}) {
    voiceCapabilities();Object.assign(this,{policy,audit,onText,authorize,speech});this.player=createAudioPlayer();this.generation=0;this.receiving=new Map();this.processing=new Map();this.player.on('error',()=>audit.write('voice-error',{code:'playback'}));
  }
  async join(channel) {
    if(!this.policy.config.allowVoiceRecording || !this.policy.config.voiceChannelIds.includes(channel.id) || channel.guild.id!==this.policy.config.guildId) throw Error('Voice channel or recording policy denied');
    this.leave();
    this.connection=joinVoiceChannel({channelId:channel.id,guildId:channel.guild.id,adapterCreator:channel.guild.voiceAdapterCreator,selfDeaf:false,selfMute:false});
    this.connection.on('error',()=>this.audit.write('voice-error',{code:'connection'}));
    try {await entersState(this.connection,VoiceConnectionStatus.Ready,20000);} catch(error) {this.leave();throw error;}
    this.connection.subscribe(this.player);
    this.connection.receiver.speaking.on('start',id=>void this.receive(id,channel));
    this.audit.write('voice-joined',{channel:channel.id});
  }
  interrupt() {this.generation++;this.abort?.abort();this.abort=new AbortController();this.player.stop(true);}
  async receive(id,channel) {
    if(!this.connection || this.receiving.has(id) || (!this.processing.has(id) && this.receiving.size+this.processing.size>=2)) return;
    const connection=this.connection;
    let principal;try{principal=await this.authorize(id);}catch{return;}
    if(!this.policy.operator(principal) || this.connection!==connection) return;
    this.interrupt();const generation=this.generation;
    const opus=connection.receiver.subscribe(id,{end:{behavior:EndBehaviorType.AfterSilence,duration:600}}),decoder=new prism.opus.Decoder({rate:48000,channels:2,frameSize:960});
    const chunks=[];let size=0;this.receiving.set(id,{opus,decoder});const finish=()=>{clearTimeout(timer);opus.destroy();decoder.destroy();this.receiving.delete(id);};
    const timer=setTimeout(()=>finish(),12000);
    decoder.on('data',chunk=>{size+=chunk.length;if(size>48000*4*12) {finish();return;}chunks.push(chunk);});
    opus.on('error',()=>finish());decoder.on('error',()=>finish());
    decoder.on('end',async()=>{
      finish();if(size<19200 || generation!==this.generation) return;
      const token=Symbol('utterance');this.processing.set(id,token);const abort=this.abort;
      try {
        const transcript=await this.speech.transcribe(Buffer.concat(chunks),abort.signal);
        if(generation!==this.generation) return;
        principal=await this.authorize(id);if(!this.policy.operator(principal)) return;
        const reply=await this.onText(transcript,principal,abort.signal);
        if(generation===this.generation) await this.say(reply,generation);
      }catch{this.audit.write('voice-error',{code:'speech-or-authorization'});}finally{if(this.processing.get(id)===token) this.processing.delete(id);}
    });
    opus.pipe(decoder);
  }
  async say(text,generation=this.generation) {
    if(!this.connection) return;
    if(!this.abort) this.abort=new AbortController();
    const pcm=await this.speech.synthesize(text,this.abort.signal);
    if(generation!==this.generation || !this.connection) return;
    this.player.play(createAudioResource(Readable.from([pcm]),{inputType:StreamType.Raw}));
  }
  leave() {this.interrupt();for(const stream of this.receiving.values()){stream.opus.destroy();stream.decoder.destroy();}this.receiving.clear();this.processing.clear();this.connection?.destroy();this.connection=null;}
}
