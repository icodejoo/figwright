import { z } from 'zod';

import type { ToolSpec } from './spec.js';

export const updateComponentTool: ToolSpec = {
  name: 'update_component',
  description:
    'Update documentation on a local COMPONENT or COMPONENT_SET in Figma Design. Targets the exact node, including a variant, without resolving to its set. Set either description (plain text) or descriptionMarkdown (rich text), not both: Figma keeps them synchronized. Empty strings clear descriptions. documentationLinks accepts at most one {uri}; [] clears it. Remote components are read-only and fail. Figma may not immediately refresh the description in its UI; API failures are returned.',
  inputSchema: z.object({
    componentId: z.string().describe('Exact local component or component-set id'),
    description: z
      .string()
      .optional()
      .describe('Plain text description; mutually exclusive with descriptionMarkdown'),
    descriptionMarkdown: z
      .string()
      .optional()
      .describe('Markdown description; mutually exclusive with description'),
    documentationLinks: z
      .array(z.object({ uri: z.string() }))
      .max(1)
      .optional()
      .describe('Zero or one documentation link'),
  }),
  kind: 'write',
};
