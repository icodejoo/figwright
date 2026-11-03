import { z } from 'zod';

import { effectItemSchema } from './effect-schema.js';
import type { ToolSpec } from './spec.js';

export const SET_EFFECTS_TOOL_NAME = 'set_effects';

export const setEffectsTool: ToolSpec = {
  name: SET_EFFECTS_TOOL_NAME,
  description:
    'Supports progressive blurs (startRadius/startOffset/endOffset), NOISE (noiseType, noiseSizeVector, density; color required for every noiseType including MULTITONE, secondaryColor for DUOTONE, opacity for MULTITONE), TEXTURE (noiseSizeVector/radius/clipToShape), and GLASS (radius/lightIntensity/lightAngle/refraction/depth/dispersion). New effects: Starter availability untested. NOISE blendMode is rejected by Figma; GLASS splay is unsupported and rejected rather than lost. SHADER is unsupported. Known limitation: when radius in effects is bound to a variable, Figma may drop blurType / start and end radii when rebuilding the effect object; read back after writing to verify. ' +
    "Set a node's effects. Shadows (DROP_SHADOW / INNER_SHADOW) need color + offset; blurs need " +
    'radius. A drop shadow is written with showShadowBehindNode false unless it says true — what a ' +
    'CSS box-shadow draws. Returns { ok, nodeId }.',
  inputSchema: z.object({
    nodeId: z.string().describe('Figma node id to apply effects to'),
    effects: z.array(effectItemSchema).describe('Effects to apply'),
  }),
  kind: 'write',
};
