import { z } from 'zod';

import { slotSettingsSchema } from './slot-settings-schema.js';
import type { ToolSpec } from './spec.js';

export const EDIT_COMPONENT_PROPERTY_TOOL_NAME = 'edit_component_property';

export const editComponentPropertyTool: ToolSpec = {
  name: EDIT_COMPONENT_PROPERTY_TOOL_NAME,
  description:
    'Change an existing component property: rename it, change its defaultValue, or (INSTANCE_SWAP ' +
    'or SLOT) change its preferredValues. SLOT also supports description and slotSettings, but SLOT/VARIANT do not support changing defaultValue. Availability depends on plan and editor; API failure reasons are returned unchanged. 可用性取决于套餐与编辑器，失败原因会原样返回。 Supply at least one. Renaming returns a new propertyId (the ' +
    '#id suffix is kept but the name part changes), so use the returned propertyId for later calls; ' +
    'existing bindings keep working. Get current property ids from get_component_api. Returns ' +
    '{ ok, componentId, propertyId, name }. In batch, changing a slot setting whose prior key is absent is refused because its unknown default cannot be faithfully restored; make that edit outside batch.',
  inputSchema: z.object({
    componentId: z.string().describe('Component or component-set id that owns the property'),
    propertyId: z.string().describe('Property id to edit (name#id, from get_component_api / add)'),
    name: z.string().describe('New property name').optional(),
    description: z.string().optional().describe('SLOT only: description; empty string clears it'),
    slotSettings: slotSettingsSchema
      .optional()
      .describe('SLOT only: settings; null min/max removes that limit'),
    defaultValue: z
      .union([z.boolean(), z.string()])
      .describe('New default (boolean / string / component key, matching the property type)')
      .optional(),
    preferredValues: z
      .array(z.object({ type: z.enum(['COMPONENT', 'COMPONENT_SET']), key: z.string() }))
      .describe('INSTANCE_SWAP or SLOT: replacement preferred components/sets')
      .optional(),
  }),
  kind: 'write',
};
