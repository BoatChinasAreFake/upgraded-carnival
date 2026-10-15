import nbt from 'prismarine-nbt';
import { gzipSync } from 'node:zlib';
export function fixture({name='minecraft:cobblestone',size={x:1,y:1,z:1},position={x:0,y:0,z:0},properties,paletteNames,words=[[0,1]],dataVersion=3700}={}) {
  const xyz=p=>nbt.comp(Object.fromEntries(Object.entries(p).map(([k,v])=>[k,nbt.int(v)])));
  const palette=[{Name:nbt.string('minecraft:air')},{Name:nbt.string(name),...(properties?{Properties:nbt.comp(Object.fromEntries(Object.entries(properties).map(([k,v])=>[k,nbt.string(v)])))}:{})}];
  if(paletteNames) palette.splice(0,palette.length,...paletteNames.map(Name=>({Name:nbt.string('minecraft:'+Name)})));
  const root=nbt.comp({Version:nbt.int(6),SubVersion:nbt.int(1),MinecraftDataVersion:nbt.int(dataVersion),Regions:nbt.comp({test:nbt.comp({Size:xyz(size),Position:xyz(position),BlockStatePalette:nbt.list(nbt.comp(palette)),BlockStates:nbt.longArray(words),Entities:nbt.list(nbt.comp([])),TileEntities:nbt.list(nbt.comp([]))})})});
  return gzipSync(nbt.writeUncompressed(root));
}
