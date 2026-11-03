import { z } from 'zod';

import { effectItemSchema } from './effect-schema.js';
import type { ToolSpec } from './spec.js';

export const CREATE_EFFECT_STYLE_TOOL_NAME = 'create_effect_style';

export const createEffectStyleTool: ToolSpec = {
  name: CREATE_EFFECT_STYLE_TOOL_NAME,
  description:
    'Supports progressive blurs (startRadius/startOffset/endOffset), NOISE (noiseType, noiseSizeVector, density; color required for every noiseType including MULTITONE, secondaryColor for DUOTONE, opacity for MULTITONE), TEXTURE (noiseSizeVector/radius/clipToShape), and GLASS (radius/lightIntensity/lightAngle/refraction/depth/dispersion). New effects: Starter availability untested. NOISE blendMode is rejected by Figma; GLASS splay is unsupported and rejected rather than lost. SHADER is unsupported. Known limitation: when radius in effects is bound to a variable, Figma may drop blurType / start and end radii when rebuilding the effect object; read back after writing to verify. ' +
    'Create a local effect style. Shadows (DROP_SHADOW / INNER_SHADOW) need color + offset; ' +
    'blurs (LAYER_BLUR / BACKGROUND_BLUR) need radius. Returns { ok, styleId, name }.',
  inputSchema: z.object({
    name: z.string().describe('Style name, e.g. "Elevation/Card"'),
    effects: z.array(effectItemSchema),
    description: z.string().optional(),
  }),
  kind: 'write',
};
