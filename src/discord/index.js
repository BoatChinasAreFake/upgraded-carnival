import { MINECRAFT } from '../version.js';
import { Client,GatewayIntentBits,REST,Routes,SlashCommandBuilder } from 'discord.js';
import { VoiceBridge } from './voice.js';
import { loadSchematic } from '../schematic/load.js';
import { limitedResponse } from '../planner/http.js';
const coordinates=command=>command.addIntegerOption(o=>o.setName('x').setDescription('Block X').setRequired(true)).addIntegerOption(o=>o.setName('y').setDescription('Block Y').setRequired(true)).addIntegerOption(o=>o.setName('z').setDescription('Block Z').setRequired(true));
export function commandDefinitions() {
  return [
    ...['stop','resume','status','cancel'].map(name=>new SlashCommandBuilder().setName(name).setDescription({stop:'Immediately latch emergency stop',resume:'Admin: resume after emergency stop',status:'Show bot status',cancel:'Cancel the current task'}[name])),
    new SlashCommandBuilder().setName('ask').setDescription('Talk to the survival planner').addStringOption(o=>o.setName('text').setDescription('Request').setMaxLength(2000).setRequired(true)),
    coordinates(new SlashCommandBuilder().setName('move').setDescription('Walk within the allowed area')),
    coordinates(new SlashCommandBuilder().setName('mine').setDescription('Mine one visible authorized block')),
    new SlashCommandBuilder().setName('craft').setDescription('Craft an inventory recipe').addStringOption(o=>o.setName('item').setDescription('Minecraft item name').setRequired(true)).addIntegerOption(o=>o.setName('count').setDescription('Recipe repetitions, 1–4').setMinValue(1).setMaxValue(4)),
    new SlashCommandBuilder().setName('voice').setDescription('Join or leave your allowed voice channel').addStringOption(o=>o.setName('mode').setDescription('Mode').setChoices({name:'join',value:'join'},{name:'leave',value:'leave'}).setRequired(true)),
    new SlashCommandBuilder().setName('schematic').setDescription('Validate a .litematic and list materials').addAttachmentOption(o=>o.setName('file').setDescription(`Java ${MINECRAFT.version} .litematic, max 2 MiB`).setRequired(true)),
    coordinates(new SlashCommandBuilder().setName('materials').setDescription('Plan materials including supports for a loaded schematic').addStringOption(o=>o.setName('id').setDescription('Schematic SHA-256').setRequired(true))),
    coordinates(new SlashCommandBuilder().setName('build').setDescription('Build a validated schematic with checkpoints').addStringOption(o=>o.setName('id').setDescription('Schematic SHA-256').setRequired(true)))
  ].map(c=>c.setDMPermission(false).toJSON());
}
export async function downloadAttachment(attachment) {
  if(!attachment.name?.endsWith('.litematic') || attachment.size>2*1024*1024) throw Error('Requires .litematic <=2 MiB');
  const url=new URL(attachment.url);
  if(url.protocol!=='https:' || url.username || url.password || !['cdn.discordapp.com','media.discordapp.net'].includes(url.hostname)) throw Error('Attachment URL rejected');
  const response=await fetch(url,{redirect:'error',signal:AbortSignal.timeout(10000)});
  return limitedResponse(response,2*1024*1024);
}
export class DiscordBridge {
  constructor(bot,executor,policy,audit,planner,runner,builder) {
    Object.assign(this,{bot,executor,policy,audit,planner,runner,builder});this.schematics=new Map();this.building=false;this.conversations=new Set();
    this.client=new Client({intents:[GatewayIntentBits.Guilds,GatewayIntentBits.GuildMessages,GatewayIntentBits.MessageContent,GatewayIntentBits.GuildVoiceStates]});
    this.voice=new VoiceBridge(policy,audit,(text,p,signal)=>this.converse(text,p,signal),id=>this.principal(id));
    executor.on('stop',()=>{builder.cancel();runner.generation++;this.voice.interrupt();});
    this.client.on('interactionCreate',i=>void this.handle(i));
    this.client.on('error',()=>audit.write('discord-error',{code:'gateway'}));
    this.client.on('messageCreate',async message=>{
      if(message.author.bot || message.guildId!==policy.config.guildId || !policy.config.textChannelIds.includes(message.channelId) || !message.mentions.has(this.client.user)) return;
      try {const p=await this.principal(message.author.id);const reply=await this.converse(message.content.replace(/<@!?\d+>/g,'').slice(0,2000),p);await message.reply({content:reply,allowedMentions:{parse:[],repliedUser:false}});} catch {await message.reply({content:'Request rejected or service unavailable. Use /status or /stop.',allowedMentions:{parse:[],repliedUser:false}}).catch(()=>{});}
    });
  }
  async principal(id) {
    const guild=await this.client.guilds.fetch(this.policy.config.guildId),member=await guild.members.fetch({user:id,force:true});
    return Object.freeze({kind:'discord',guildId:guild.id,id,roles:Object.freeze([...member.roles.cache.keys()]),expiresAt:Date.now()+15000});
  }
  status() {const b=this.bot;return `Java ${b.version}; health ${b.health}/20; food ${b.food}/20; ${this.executor.stopped?'STOPPED':'running'}; ${this.runner.active||this.building?'task active':'idle'}.`}
  async converse(text,principal,signal) {
    if(!this.policy.operator(principal)) throw Error('Operator required');
    // A literal stop command takes the deterministic path, never the planner.
    if(/^(stop|emergency stop)[.!\s]*$/i.test(text.trim())) {this.executor.emergencyStop('discord-text');return 'Emergency stop latched.';}
    if(this.executor.stopped) return 'Emergency stop is latched. An admin must use /resume.';
    if(this.conversations.size>=4 || this.conversations.has(principal.id)) throw Error('Conversation busy');
    this.conversations.add(principal.id);const epoch=this.executor.epoch;
    try {
      const plan=await this.planner.propose(text,this.runner.snapshot());
      if(signal?.aborted || this.executor.stopped || epoch!==this.executor.epoch) throw Error('Conversation interrupted');
      principal=await this.principal(principal.id);
      if(signal?.aborted || epoch!==this.executor.epoch) throw Error('Conversation interrupted');
      if(this.building) throw Error('Build active');
      const result=await this.runner.run(plan.tasks,principal,()=>this.principal(principal.id),{allowDestructive:false});
      return (plan.reply+'\n'+(plan.tasks.some(t=>!['status','stay'].includes(t.kind))?result:this.status())).slice(0,1900);
    } finally {this.conversations.delete(principal.id);}
  }
  async handle(i) {
    if(!i.isChatInputCommand()) return;
    if(i.guildId!==this.policy.config.guildId || !this.policy.config.textChannelIds.includes(i.channelId)) {await i.reply({content:'Channel policy denied.',flags:64}).catch(()=>{});return;}
    await i.deferReply({flags:64});
    try {
      const p=await this.principal(i.user.id),name=i.commandName;
      if(!this.policy.operator(p)) throw Error('Operator role required');
      const pos=()=>({x:i.options.getInteger('x',true),y:i.options.getInteger('y',true),z:i.options.getInteger('z',true)});
      const refresh=()=>this.principal(p.id);let reply;
      if(name==='stop') {this.executor.emergencyStop('discord-slash');reply='Emergency stop latched.';}
      else if(name==='resume') {this.executor.resume(p);reply='Resumed. Remove runtime/STOP before resuming if present.';}
      else if(name==='cancel') {this.builder.cancel();this.runner.cancel();this.voice.interrupt();reply='Task cancelled.';}
      else if(name==='status') reply=this.status();
      else if(name==='ask') reply=await this.converse(i.options.getString('text',true),p);
      else if(['move','mine','craft'].includes(name)) {
        if(this.building) throw Error('Build active');
        const task=name==='craft'?{kind:name,name:i.options.getString('item',true),count:i.options.getInteger('count')??1}:{kind:name,position:pos()};
        reply=await this.runner.run([task],p,refresh);
      } else if(name==='voice') {
        if(i.options.getString('mode')==='leave') {this.voice.leave();reply='Left voice.';}
        else {const member=await i.guild.members.fetch({user:p.id,force:true}),channel=member.voice.channel;if(!channel) throw Error('Join an allowed voice channel first');await this.voice.join(channel);reply='Voice joined. Authorized operators’ speech is sent to the configured speech service; audio is not saved.';}
      } else if(name==='schematic') {
        if(!this.policy.has(p,'builder')) throw Error('Builder role required');
        const schematic=await loadSchematic(await downloadAttachment(i.options.getAttachment('file',true)));
        if(this.schematics.size>=4) this.schematics.delete(this.schematics.keys().next().value);
        this.schematics.set(schematic.sha256,schematic);reply=`Validated ${schematic.blocks.length} solid blocks. ID: ${schematic.sha256}\nMaterials: ${JSON.stringify(schematic.materials)}\nUse /materials at your origin for support planning, then /build.`;
      } else if(name==='materials' || name==='build') {
        const schematic=this.schematics.get(i.options.getString('id',true));if(!schematic) throw Error('Load the schematic first');
        if(name==='materials') {const plan=this.builder.plan(schematic,pos(),p);reply=`Materials including ${plan.supports.length} retained temporary supports: ${JSON.stringify(plan.materials)}`;}
        else {
          if(this.building || this.runner.active) throw Error('Task already active');this.building=true;
          try{const result=await this.builder.run(schematic,pos(),p,refresh);reply=`Build ${result.status}; ${result.completed.length} placements verified. Supports retained; removal needs an explicitly authorized mining task.`;}finally{this.building=false;}
        }
      } else throw Error('Unknown command');
      await i.editReply({content:reply.slice(0,1900),allowedMentions:{parse:[]}});
    } catch(error) {
      // Only our own bounded policy errors are exposed; avoid underlying library/service messages with credentials.
      this.audit.write('discord-request-failed',{command:i.commandName,code:'rejected'});
      await i.editReply({content:'Request rejected, interrupted, or unavailable. Check policy, visible reach, materials, and runtime status.',allowedMentions:{parse:[]}}).catch(()=>{});
    }
  }
  async start(token,applicationId) {
    if(!token || !applicationId) throw Error('Discord token/application ID missing');
    await new REST({version:'10',timeout:10000}).setToken(token).put(Routes.applicationGuildCommands(applicationId,this.policy.config.guildId),{body:commandDefinitions()});
    await this.client.login(token);
  }
  close() {this.voice.leave();this.client.destroy();}
}
