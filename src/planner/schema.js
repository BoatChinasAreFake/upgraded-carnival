import { z } from 'zod';
import { Point } from '../policy.js';
export const Task=z.discriminatedUnion('kind',[
  z.object({kind:z.literal('move'),position:Point}).strict(),
  z.object({kind:z.literal('mine'),position:Point}).strict(),
  z.object({kind:z.literal('craft'),name:z.string().regex(/^[a-z0-9_]+$/),count:z.number().int().min(1).max(4)}).strict(),
  z.object({kind:z.literal('status')}).strict(),
  z.object({kind:z.literal('stay')}).strict()
]);
export const Plan=z.object({reply:z.string().max(1500),tasks:z.array(Task).max(4)}).strict();
