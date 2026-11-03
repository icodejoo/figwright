import { z } from 'zod';

import type { ToolSpec } from './spec.js';

export const createSlotTool: ToolSpec = {
  name: 'create_slot',
  description:
    'Create a native Slot inside a main COMPONENT with ComponentNode.createSlot(), which also creates its SLOT property. Returns nodeId, componentId and propertyId; configure the property with edit_component_property and add default content as slot children. Pass a variant COMPONENT, not a COMPONENT_SET or INSTANCE. In instances, fill a slot with normal node tools: create_frame (or any create_*) with parentId, or reparent_nodes with newParentId, set to the instance's SLOT sublayer (id like I<instance>;<slot>, read it from get_node); the main component is not affected (verified live). set_instance_properties cannot set SLOT. Availability depends on plan and editor; API failure reasons are returned unchanged. 可用性取决于套餐与编辑器，失败原因会原样返回。',
  inputSchema: z.object({
    componentId: z
      .string()
      .describe('Main component id (a variant is allowed; a component set is not)'),
  }),
  kind: 'write',
};
