const simple=new Set(['crafting_table','cobblestone','stone','dirt','glass','bricks','stone_bricks','oak_planks','spruce_planks','birch_planks','jungle_planks','acacia_planks','dark_oak_planks','mangrove_planks','cherry_planks','bamboo_planks','crimson_planks','warped_planks','sandstone','terracotta']);
const colors=['white','orange','magenta','light_blue','yellow','lime','pink','gray','light_gray','cyan','purple','blue','brown','green','red','black'];
for(const color of colors) for(const suffix of ['wool','concrete']) simple.add(`${color}_${suffix}`);
export const supportedPlacement=name=>simple.has(name);
export const supportedReference=name=>(supportedPlacement(name) && name!=='crafting_table') || ['grass_block','bedrock','deepslate'].includes(name);
