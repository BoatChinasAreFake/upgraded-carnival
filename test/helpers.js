import { MINECRAFT } from '../src/version.js';
import { EventEmitter } from 'node:events';
import mcData from 'minecraft-data';
import { Vec3 } from 'vec3';
import { Policy } from '../src/policy.js';
export const config={guildId:'guild',textChannelIds:['text'],voiceChannelIds:['voice'],roles:{operator:['op'],builder:['build'],destroyer:['dig'],admin:['admin']},areas:[{id:'test',dimension:'overworld',bounds:{min:{x:-16,y:60,z:-16},max:{x:16,y:80,z:16}},mine:true,build:true}],containers:[{dimension:'overworld',position:{x:4,y:64,z:0}}],home:{x:0,y:64,z:0},dimension:'overworld',maxDeaths:3,maxRecoveryDistance:32,maxTaskActions:500,allowAutonomousMining:false,allowAutonomousBuilding:false,allowVoiceRecording:true,allowPlayerCombat:false};
export const principal=(roles=['op','build','dig'])=>({kind:'discord',guildId:'guild',id:'user',roles,expiresAt:Date.now()+15000});
export const audit={events:[],write(event,fields){this.events.push({event,...fields});}};
export function fakeBot() {
  const bot=new EventEmitter();bot.registry=mcData(MINECRAFT.version);bot.game={dimension:'overworld'};bot.health=20;bot.food=20;bot.oxygenLevel=20;bot.entity={position:new Vec3(0,64,0),height:1.8};bot.entities={};bot.time={timeOfDay:6000};bot.inventory={items:()=>[],slots:[]};bot.world={raycast:()=>null};
  bot.blockAt=p=>({name:p.y<64?'stone':'air',boundingBox:p.y<64?'block':'empty',position:p,canHarvest:()=>true,getProperties:()=>({}),digTime:()=>100});
  bot.pathfinder={setMovements:()=>{},setGoal:()=>{},goto:async goal=>{bot.entity.position=new Vec3(goal.x,goal.y,goal.z);}};bot.clearControlStates=()=>{};bot.stopDigging=()=>{};bot.deactivateItem=()=>{};bot.quit=()=>{};bot.equip=async i=>{bot.heldItem=i;};bot.attack=e=>{bot.attacked=e;};bot.lookAt=async()=>{};bot.canDigBlock=()=>true;bot.respawn=()=>{bot.respawned=true;};
  return bot;
}
export const policy=()=>new Policy(config);
