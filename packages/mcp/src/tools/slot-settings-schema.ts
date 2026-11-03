import { z } from 'zod';

export const slotSettingsSchema = z.object({
  stretchChildOnInsert: z.boolean().optional().describe('Stretch a newly inserted slot child'),
  displayEmptyByDefault: z
    .boolean()
    .optional()
    .describe('Show the slot empty by default in instances'),
  minChildren: z
    .number()
    .int()
    .min(0)
    .nullable()
    .optional()
    .describe('Minimum children; null removes the limit'),
  maxChildren: z
    .number()
    .int()
    .min(0)
    .nullable()
    .optional()
    .describe('Maximum children; null removes the limit'),
  allowPreferredValuesOnly: z
    .boolean()
    .optional()
    .describe('Restrict slot content to preferred components'),
});
