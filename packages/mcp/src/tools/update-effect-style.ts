import { z } from 'zod';

import { effectItemSchema } from './effect-schema.js';
import type { ToolSpec } from './spec.js';

export const UPDATE_EFFECT_STYLE_TOOL_NAME = 'update_effect_style';

export const updateEffectStyleTool: ToolSpec = {
  name: UPDATE_EFFECT_STYLE_TOOL_NAME,
  description:
    'Supports progressive blurs (startRadius/startOffset/endOffset), NOISE (noiseType, noiseSizeVector, density; color required for every noiseType including MULTITONE, secondaryColor for DUOTONE, opacity for MULTITONE), TEXTURE (noiseSizeVector/radius/clipToShape), and GLASS (radius/lightIntensity/lightAngle/refraction/depth/dispersion). New effects: Starter availability untested. NOISE blendMode is rejected by Figma; GLASS splay is unsupported and rejected rather than lost. SHADER is unsupported. Known limitation: when radius in effects is bound to a variable, Figma may drop blurType / start and end radii when rebuilding the effect object; read back after writing to verify. ' +
    'Update an existing effect style by id. Any of name / effects / description may be omitted to ' +
    'leave unchanged; effects, when given, replaces the whole list. Shadows (DROP_SHADOW / ' +
    'INNER_SHADOW) need color + offset; blurs (LAYER_BLUR / BACKGROUND_BLUR) need radius. Use this ' +
    'to keep a shared style in sync with code instead of creating a duplicate. Because effects ' +
    'replace wholesale, an effect written back WITHOUT its boundVariables clears the variables it ' +
    'was bound to — re-send them, or change the variable itself instead. Returns { ok, ' +
    'styleId, name }.',
  inputSchema: z.object({
    styleId: z.string().describe('Effect style id to update'),
    name: z.string().optional(),
    effects: z.array(effectItemSchema).optional().describe('New effects (replaces all)'),
    description: z.string().optional(),
  }),
  kind: 'write',
};
