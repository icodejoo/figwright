import { z } from 'zod';

import { boundVariablesSchema } from './binding-schema.js';
import { colorSpaceSchema } from './color-space-schema.js';

// Shared Zod effect schema, reused by set_effects / create_effect_style so the shadow + blur shape
// can't drift between them (they previously copy-pasted the same inline JSON shape). Loose so an
// effect read back from get_node round-trips into a write. The plugin's toFigmaEffect enforces that
// shadows carry color + offset and blurs carry radius.

const rgba = z.object({
  r: z.number(),
  g: z.number(),
  b: z.number(),
  a: z.number(),
  space: colorSpaceSchema.optional(),
});

/** One effect: DROP_SHADOW / INNER_SHADOW (color + offset) or LAYER_BLUR / BACKGROUND_BLUR (radius). */
export const effectItemSchema = z
  .object({
    type: z.enum([
      'DROP_SHADOW',
      'INNER_SHADOW',
      'LAYER_BLUR',
      'BACKGROUND_BLUR',
      'NOISE',
      'TEXTURE',
      'GLASS',
    ]),
    visible: z.boolean(),
    blurType: z.enum(['NORMAL', 'PROGRESSIVE']).optional(),
    startRadius: z.number().min(0).optional(),
    startOffset: z.object({ x: z.number(), y: z.number() }).optional(),
    endOffset: z.object({ x: z.number(), y: z.number() }).optional(),
    noiseType: z.enum(['MONOTONE', 'DUOTONE', 'MULTITONE']).optional(),
    noiseSize: z.number().positive().optional(),
    noiseSizeVector: z.object({ x: z.number().positive(), y: z.number().positive() }).optional(),
    density: z.number().optional(),
    secondaryColor: rgba.optional(),
    opacity: z.number().min(0).max(1).optional(),
    clipToShape: z.boolean().optional(),
    lightIntensity: z.number().min(0).max(1).optional(),
    lightAngle: z.number().optional(),
    refraction: z.number().min(0).max(1).optional(),
    depth: z.number().min(1).optional(),
    dispersion: z.number().min(0).max(1).optional(),
    radius: z
      .number()
      .describe(
        "Figma's radius, not a CSS length: a CSS blur(σ) is radius σ ÷ 0.43, and a box-shadow blur " +
          'B is radius B ÷ 0.85 (measured).',
      )
      .optional(),
    color: rgba
      .describe(
        'Effect color (RGBA 0–1). Required for shadows and every NOISE variant, including MULTITONE.',
      )
      .optional(),
    offset: z
      .object({ x: z.number(), y: z.number() })
      .describe('Shadow offset in px. Required for shadows.')
      .optional(),
    spread: z.number().optional(),
    showShadowBehindNode: z
      .boolean()
      .describe(
        "DROP_SHADOW only: also draw the shadow through the node's translucent areas. Omit for false, " +
          'which is what a CSS box-shadow draws; a shadow read from Figma carries it only when true.',
      )
      .optional(),
    blendMode: z
      .string()
      .describe(
        'Shadows only: the blend mode the shadow is composited with, e.g. "MULTIPLY". Omit for NORMAL.',
      )
      .optional(),
    boundVariables: boundVariablesSchema
      .describe(
        'Bindable fields: color (COLOR variable) and radius / spread / offsetX / offsetY (FLOAT).',
      )
      .optional(),
  })
  .loose();
