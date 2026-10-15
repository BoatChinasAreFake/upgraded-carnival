import { Task } from './planner/schema.js';
import { observedBlocks } from './observation.js';
export class TaskRunner {
  constructor(bot,executor,policy,audit) {Object.assign(this,{bot,executor,policy,audit});this.active=false;this.generation=0;}
  cancel() {this.generation++;this.executor.cancel('task-cancel');}
  snapshot() {
    const b=this.bot;return {health:b.health,food:b.food,dimension:b.game.dimension,position:{x:Math.floor(b.entity.position.x),y:Math.floor(b.entity.position.y),z:Math.floor(b.entity.position.z)},inventory:b.inventory.items().map(i=>({name:i.name,count:i.count})),visibleBlocks:observedBlocks(b,3).slice(0,80).map(x=>({name:x.name,position:{x:x.position.x,y:x.position.y,z:x.position.z}}))};
  }
  async run(tasks,principal,refresh=async()=>principal,{allowDestructive=true}={}) {
    if(this.active) throw Error('Another task is running');
    if(tasks.length>Math.min(4,this.policy.config.maxTaskActions)) throw Error('Task budget exceeded');
    const parsed=tasks.map(t=>Task.parse(t));
    if(!allowDestructive && parsed.some(t=>t.kind==='mine')) throw Error('Mining requires the explicit /mine command');
    for(const task of parsed) this.policy.authorizeTask(principal,task);
    this.active=true;const generation=this.generation;
    try {
      for(const task of parsed) {
        if(generation!==this.generation || this.executor.stopped) throw Error('Task cancelled');
        principal=await refresh();if(generation!==this.generation) throw Error('Task cancelled');this.policy.authorizeTask(principal,task);
        if(task.kind==='status' || task.kind==='stay') continue;
        const action=task.kind==='mine'?{kind:'dig',position:task.position}:task;
        await this.executor.submit(action,principal,0);
      }
      return 'Requested tasks completed.';
    } finally {this.active=false;}
  }
}
