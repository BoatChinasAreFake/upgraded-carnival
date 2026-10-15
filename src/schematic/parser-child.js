// Pure bounded parser in a permission-restricted subprocess. No eval, imports from input, files or network APIs.
import { gunzipSync } from 'node:zlib';
import { supportedPlacement } from '../placement.js';
const MAX_INPUT=2*1024*1024, MAX_NBT=8*1024*1024, MAX_BLOCKS=50000;
export function parseLitematic(input) {
  if(input.length>MAX_INPUT) throw Error('Input too large');
  const data=input[0]===0x1f && input[1]===0x8b ? gunzipSync(input,{maxOutputLength:MAX_NBT}) : input;
  if(data.length>MAX_NBT) throw Error('NBT too large');
  let offset=0,nodes=0;
  const need=n=>{if(n<0 || offset+n>data.length) throw Error('Truncated NBT');};
  const u8=()=>{need(1);return data[offset++];};
  const i32=()=>{need(4);const n=data.readInt32BE(offset);offset+=4;return n;};
  const string=()=>{need(2);const n=data.readUInt16BE(offset);offset+=2;need(n);if(n>1024) throw Error('String too long');const s=data.toString('utf8',offset,offset+n);offset+=n;return s;};
  const length=()=>{const n=i32();if(n<0 || n>100000) throw Error('Collection too large');return n;};
  function payload(type,depth=0) {
    if(depth>32 || ++nodes>300000) throw Error('NBT complexity limit');
    switch(type) {
      case 1: {need(1);return data.readInt8(offset++);}
      case 2: {need(2);const n=data.readInt16BE(offset);offset+=2;return n;}
      case 3:return i32();
      case 4:{need(8);const n=data.readBigInt64BE(offset);offset+=8;return n;}
      case 5:{need(4);const n=data.readFloatBE(offset);offset+=4;return n;}
      case 6:{need(8);const n=data.readDoubleBE(offset);offset+=8;return n;}
      case 7:{const n=length();need(n);const b=data.subarray(offset,offset+n);offset+=n;return b;}
      case 8:return string();
      case 9:{const kind=u8(),n=length();if(!kind && n) throw Error('Invalid list');return Array.from({length:n},()=>payload(kind,depth+1));}
      case 10:{const obj=Object.create(null);for(;;){const kind=u8();if(!kind) return obj;const name=string();if(Object.hasOwn(obj,name)) throw Error('Duplicate NBT key');obj[name]=payload(kind,depth+1);}}
      case 11:return Array.from({length:length()},()=>i32());
      case 12:return Array.from({length:length()},()=>payload(4,depth+1));
      default:throw Error('Invalid NBT tag');
    }
  }
  if(u8()!==10) throw Error('Root must be compound');string();const root=payload(10);
  if(offset!==data.length) throw Error('Trailing data');
  if(root.Version!==6 || (root.SubVersion ?? 1)!==1 || root.MinecraftDataVersion!==3700) throw Error('Requires litematic v6/subversion1 for Java 1.20.4 data version 3700');
  if(!root.Regions || typeof root.Regions!=='object' || Array.isArray(root.Regions)) throw Error('Missing regions');
  const regions=Object.values(root.Regions);if(!regions.length || regions.length>16) throw Error('Region limit');
  const blocks=[],occupied=new Map(),materials=Object.create(null);let volume=0;
  for(const r of regions) {
    for(const field of ['Entities','TileEntities','PendingBlockTicks','PendingFluidTicks']) if(r[field]!==undefined && (!Array.isArray(r[field]) || r[field].length)) throw Error('Entities, block entities and scheduled ticks unsupported');
    const size=r.Size,pos=r.Position;
    if(!size || !pos || !['x','y','z'].every(k=>Number.isInteger(size[k]) && size[k]!==0 && Math.abs(size[k])<=128 && Number.isInteger(pos[k]) && Math.abs(pos[k])<=100000)) throw Error('Invalid region bounds');
    const sx=Math.abs(size.x),sy=Math.abs(size.y),sz=Math.abs(size.z),count=sx*sy*sz;
    volume+=count;if(volume>MAX_BLOCKS) throw Error('Block volume limit');
    const palette=r.BlockStatePalette;if(!Array.isArray(palette) || !palette.length || palette.length>4096) throw Error('Palette limit');
    const names=palette.map(p=>{
      if(!p || typeof p.Name!=='string' || !/^minecraft:[a-z0-9_]+$/.test(p.Name) || (p.Properties && Object.keys(p.Properties).length)) throw Error('Unsupported block state');
      const name=p.Name.slice(10);if(name!=='air' && !supportedPlacement(name)) throw Error('Unsupported block: '+name);return name;
    });
    const bits=Math.max(2,Math.ceil(Math.log2(names.length))),words=r.BlockStates;
    if(!Array.isArray(words) || words.length!==Math.ceil(count*bits/64) || !words.every(w=>typeof w==='bigint')) throw Error('Invalid packed block states');
    const mask=(1n<<BigInt(bits))-1n;
    const min=Object.fromEntries(['x','y','z'].map(k=>[k,pos[k]+(size[k]<0?size[k]+1:0)]));
    for(let index=0;index<count;index++) {
      const bit=index*bits,word=Math.floor(bit/64),shift=bit%64;
      let n=BigInt.asUintN(64,words[word])>>BigInt(shift);
      if(shift+bits>64) n|=BigInt.asUintN(64,words[word+1])<<BigInt(64-shift);
      const paletteIndex=Number(n&mask),name=names[paletteIndex];if(name===undefined) throw Error('Palette index out of range');
      const p={x:min.x+index%sx,y:min.y+Math.floor(index/(sx*sz)),z:min.z+Math.floor(index/sx)%sz};
      const k=`${p.x},${p.y},${p.z}`;
      if(occupied.has(k) && occupied.get(k)!==name) throw Error('Overlapping conflicting regions');
      if(occupied.has(k)) continue;occupied.set(k,name);
      if(name!=='air') {blocks.push({...p,name});materials[name]=(materials[name]??0)+1;}
    }
  }
  if(!blocks.length) throw Error('Empty schematic');
  return {format:6,dataVersion:3700,volume,blocks,materials};
}
if(process.argv.includes('--parse')) {
  let size=0;const chunks=[];
  process.stdin.on('data',chunk=>{size+=chunk.length;if(size>MAX_INPUT) process.exit(2);chunks.push(chunk);});
  process.stdin.on('end',()=>{try{process.stdout.write(JSON.stringify(parseLitematic(Buffer.concat(chunks))));}catch{process.stderr.write('Schematic validation failed\n');process.exitCode=2;}});
}
