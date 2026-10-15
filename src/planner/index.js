import { Worker } from 'node:worker_threads';
import { Plan } from './schema.js';
export class Planner {
  constructor() {this.pending=new Map();this.sequence=0;this.worker=new Worker(new URL('./worker.js',import.meta.url),{resourceLimits:{maxOldGenerationSizeMb:64}});
    this.worker.on('message',({id,plan,error})=>{const request=this.pending.get(id);if(!request) return;clearTimeout(request.timer);this.pending.delete(id);error?request.reject(Error(error)):request.resolve(Plan.parse(plan));});
    this.worker.on('error',()=>this.fail());this.worker.on('exit',()=>this.fail());
  }
  fail() {for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(Error('Planner worker stopped'));}this.pending.clear();}
  propose(text,observation) {
    if(this.pending.size>=4) return Promise.reject(Error('Planner busy'));
    const id=++this.sequence;
    return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{this.pending.delete(id);reject(Error('Planner deadline exceeded'));},10000);this.pending.set(id,{resolve,reject,timer});this.worker.postMessage({id,text,observation});});
  }
  close() {this.fail();return this.worker.terminate();}
}
