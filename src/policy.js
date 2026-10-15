import { z } from 'zod';
export const Point = z.object({ x: z.number().int().min(-30000000).max(30000000), y: z.number().int().min(-64).max(319), z: z.number().int().min(-30000000).max(30000000) }).strict();
const Box = z.object({ min: Point, max: Point }).strict().refine(b => ['x','y','z'].every(k => b.min[k] <= b.max[k]), 'invalid bounds');
export const PolicySchema = z.object({
  guildId: z.string(), textChannelIds: z.array(z.string()), voiceChannelIds: z.array(z.string()),
  roles: z.object({ operator: z.array(z.string()), builder: z.array(z.string()), destroyer: z.array(z.string()), admin: z.array(z.string()) }).strict(),
  areas: z.array(z.object({ id: z.string(), dimension: z.string(), bounds: Box, build: z.boolean(), mine: z.boolean() }).strict()),
  containers: z.array(z.object({ dimension: z.string(), position: Point }).strict()),
  home: Point, dimension: z.string().default('overworld'),
  maxDeaths: z.number().int().min(1).max(5).default(3), maxRecoveryDistance: z.number().min(1).max(128).default(32),
  maxTaskActions: z.number().int().min(1).max(10000).default(500),
  allowAutonomousMining: z.boolean().default(false), allowAutonomousBuilding: z.boolean().default(false),
  allowVoiceRecording: z.boolean().default(false), allowPlayerCombat: z.literal(false).default(false)
}).strict();
export const inside = (p,b) => p && ['x','y','z'].every(k => p[k] >= b.min[k] && p[k] <= b.max[k]);
export class Policy {
  constructor(config) { this.config = PolicySchema.parse(config); }
  has(principal, role) { return principal?.kind === 'discord' && principal.guildId === this.config.guildId && (!principal.expiresAt || principal.expiresAt>=Date.now()) && principal.roles.some(r => this.config.roles[role].includes(r) || this.config.roles.admin.includes(r)); }
  operator(p) { return this.has(p,'operator'); }
  authorizeTask(p, task) {
    if (!this.operator(p)) throw Error('Operator role required');
    if (task.kind === 'build' && !this.has(p,'builder')) throw Error('Builder role required');
    if (task.kind === 'mine' && !this.has(p,'destroyer')) throw Error('Destroyer role required');
    if (task.kind === 'stop') return;
    if (task.position && !this.area(task.position, this.config.dimension)) throw Error('Task outside allowed area');
  }
  area(position, dimension, permission) { return this.config.areas.find(a => a.dimension === dimension && inside(position,a.bounds) && (!permission || a[permission])); }
  check(action, principal, dimension) {
    const system = principal?.kind === 'survival';
    if (!system && !this.operator(principal)) throw Error('Operator role required');
    if (dimension !== this.config.dimension) throw Error('Dimension not permitted');
    if (action.position && !this.area(action.position, dimension, action.kind === 'dig' ? 'mine' : action.kind === 'place' ? 'build' : undefined)) throw Error('Area policy denied');
    if (action.kind === 'dig' && (system ? !this.config.allowAutonomousMining : !this.has(principal,'destroyer'))) throw Error('Mining denied');
    if (action.kind === 'place' && (system ? !this.config.allowAutonomousBuilding : !this.has(principal,'builder'))) throw Error('Building denied');
    if (action.kind === 'container' && !this.config.containers.some(c => c.dimension === dimension && ['x','y','z'].every(k => c.position[k] === action.position[k]))) throw Error('Container denied');
    if (action.kind === 'attack' && action.player) throw Error('Player combat denied');
  }
}
