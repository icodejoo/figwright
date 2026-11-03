import { z } from 'zod';

import { slotSettingsSchema } from './slot-settings-schema.js';
import type { ToolSpec } from './spec.js';

export const ADD_COMPONENT_PROPERTY_TOOL_NAME = 'add_component_property';

export const addComponentPropertyTool: ToolSpec = {
  name: ADD_COMPONENT_PROPERTY_TOOL_NAME,
  description:
    'Declare a component property on a component (or its variant set): BOOLEAN (show/hide a layer), ' +
    'TEXT (editable text), INSTANCE_SWAP (swappable nested instance), or SLOT (native slot content; defaultValue must be an empty string). SLOT binds to a frame via slotContentId; create_slot creates both automatically. Availability depends on plan and editor; API failure reasons are returned unchanged. 可用性取决于套餐与编辑器，失败原因会原样返回。 The property starts inert — ' +
    'attach it to a layer with bind_component_property (BOOLEAN→visible, TEXT→characters, ' +
    'INSTANCE_SWAP→mainComponent) for it to do anything. defaultValue must match the type (boolean / ' +
    'string / a component key string); preferredValues (INSTANCE_SWAP or SLOT) pre-populates the swap ' +
    'menu. VARIANT properties come from combine_as_variants, not here. Returns { ok, componentId, ' +
    'propertyId, name } — pass propertyId to bind / edit / delete / set_instance_properties.',
  inputSchema: z.object({
    componentId: z
      .string()
      .describe('Component or component-set id (a variant resolves to its set)'),
    name: z.string().describe('Property name, e.g. "Show Icon"'),
    type: z.enum(['BOOLEAN', 'TEXT', 'INSTANCE_SWAP', 'SLOT']).describe('Property type'),
    defaultValue: z
      .union([z.boolean(), z.string()])
      .describe(
        'Default: boolean (BOOLEAN), string (TEXT), component key (INSTANCE_SWAP), empty string (SLOT)',
      ),
    description: z.string().optional().describe('SLOT only: property description'),
    slotSettings: slotSettingsSchema.optional().describe('SLOT only: content settings and limits'),
    preferredValues: z
      .array(z.object({ type: z.enum(['COMPONENT', 'COMPONENT_SET']), key: z.string() }))
      .describe('INSTANCE_SWAP or SLOT: preferred components/sets')
      .optional(),
  }),
  kind: 'write',
};
