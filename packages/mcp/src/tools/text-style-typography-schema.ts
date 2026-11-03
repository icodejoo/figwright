import { z } from 'zod';

import { leadingTrimSchema, listSpacingSchema } from './text-detail-schema.js';

/**
 * The TextStyle typography beyond font / size / leading / tracking / wrap, shared by
 * create_text_style and update_text_style so the two advertise exactly the same fields. A style
 * carries these for every node bound to it, which is how a "Label/Caps" token can be UPPERCASE
 * instead of every bound node being set to uppercase by hand.
 */
export const textStyleTypographyShape = {
  textCase: z
    .enum(['ORIGINAL', 'UPPER', 'LOWER', 'TITLE', 'SMALL_CAPS', 'SMALL_CAPS_FORCED'])
    .optional()
    .describe('Case transform every bound node inherits (CSS text-transform / font-variant-caps)'),
  textDecoration: z
    .enum(['NONE', 'UNDERLINE', 'STRIKETHROUGH'])
    .optional()
    .describe('Underline / strikethrough every bound node inherits'),
  leadingTrim: leadingTrimSchema.optional(),
  paragraphSpacing: z
    .number()
    .min(0)
    .optional()
    .describe('Space between paragraphs in px (paragraphs split at "\\n")'),
  paragraphIndent: z
    .number()
    .min(0)
    .optional()
    .describe('First-line indent of each paragraph in px'),
  listSpacing: listSpacingSchema.optional(),
  hangingPunctuation: z
    .boolean()
    .optional()
    .describe('Punctuation at the line start hangs outside the text box'),
  hangingList: z.boolean().optional().describe('List bullets / numbers hang outside the text box'),
} as const;
