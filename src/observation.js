import { Vec3 } from 'vec3';
export const vec = p => new Vec3(p.x,p.y,p.z);
export const key = p => `${p.x},${p.y},${p.z}`;
export const hazardNames = new Set(['lava','fire','soul_fire','cactus','magma_block','powder_snow','sweet_berry_bush','campfire','soul_campfire']);
export const hostileNames = new Set(['zombie','husk','drowned','skeleton','stray','spider','cave_spider','creeper','witch','pillager','vindicator','ravager','phantom','silverfish','endermite','slime','magma_cube','blaze','wither_skeleton','zoglin']);
export function eye(bot) { return bot.entity.position.offset(0,bot.entity.height ? Math.min(1.62,bot.entity.height*0.9) : 1.62,0); }
export function visible(bot, point, max=5, targetBlock) {
  const origin = eye(bot), delta = vec(point).minus(origin), length = delta.norm();
  if (length > max || length < 0.01) return length <= max;
  // raycast reads only the segment to a target. A block behind an occluder is never exposed.
  const hit = bot.world.raycast(origin,delta.scaled(1/length),length);
  return !hit || (targetBlock && hit.position.equals(targetBlock.position));
}
export function visibleBlock(bot, position, max=5) {
  const block = bot.blockAt(vec(position));
  if (!block) return null;
  return visible(bot, block.position.offset(.5,.5,.5), max, block) ? block : null;
}
export function visibleEntities(bot, radius=8) {
  return Object.values(bot.entities).filter(e => e !== bot.entity && e.position && bot.entity.position.distanceTo(e.position) <= radius && visible(bot,e.position.offset(0,Math.min(e.height ?? 1,1),0),radius));
}
export function observedBlocks(bot, radius=4) {
  const base=bot.entity.position.floored(), found=[];
  for(let x=-radius;x<=radius;x++) for(let y=-2;y<=2;y++) for(let z=-radius;z<=radius;z++) {
    const block=visibleBlock(bot,base.offset(x,y,z),radius+1);
    if(block && block.boundingBox !== 'empty') found.push(block);
  }
  return found;
}
export function safeStand(bot, policy, p) {
  if (!policy.area(p, bot.game.dimension)) return false;
  const feet=bot.blockAt(vec(p)), head=bot.blockAt(vec(p).offset(0,1,0)), ground=bot.blockAt(vec(p).offset(0,-1,0));
  return !!(feet && head && ground && feet.boundingBox==='empty' && head.boundingBox==='empty' && ground.boundingBox==='block' && ![feet,head,ground].some(b=>hazardNames.has(b.name)) && feet.name!=='water');
}
