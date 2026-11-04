import { z } from 'zod';

import type { ToolSpec } from './spec.js';

export const listChildrenTool: ToolSpec = {
  name: 'list_children',
  kind: 'read',
  description:
    'Read only direct children of nodeId, including page ids (loaded first), without serializing subtrees. Optional types filters node types. Returns {nodeId,children:[{id,name,type,visible,index}],count}; index is the original sibling position and count is the total matching count. Up to 5000 matching children are returned; larger results carry truncated:true and a note.',
  inputSchema: z.object({ nodeId: z.string(), types: z.array(z.string()).optional() }),
};
