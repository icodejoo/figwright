import { z } from 'zod';

import { colorSpaceSchema } from './color-space-schema.js';

// The less common text settings shared by set_text_properties (whole node) and set_text_range (one
// run), so both advertise them the same way. Each mirrors the field get_node / get_design_context
// reads back, so a value read from Figma writes straight back.

/** Figma's LeadingTrim: CAP_HEIGHT trims the space above the cap height and below the baseline. */
export const leadingTrimSchema = z
  .enum(['NONE', 'CAP_HEIGHT'])
  .describe(
    'CAP_HEIGHT trims the empty space above the capital letters and below the baseline so the ' +
      'text box hugs the glyphs (CSS text-box-trim: trim-both cap alphabetic) — handy for centring a ' +
      'label optically in a button. NONE (default) keeps the font line box',
  );

const decorationMetric = z.union([
  z.object({ unit: z.literal('AUTO') }),
  z.object({ unit: z.enum(['PIXELS', 'PERCENT']), value: z.number() }),
]);

/** Underline / strikethrough line style. */
export const textDecorationStyleSchema = z
  .enum(['SOLID', 'WAVY', 'DOTTED'])
  .describe('Line style of the underline / strikethrough (CSS text-decoration-style)');

/** Distance of the underline from the baseline. */
export const textDecorationOffsetSchema = decorationMetric.describe(
  'Underline offset: { unit: "AUTO" } or { unit: "PIXELS" | "PERCENT", value } (CSS text-underline-offset)',
);

/** Stroke width of the underline / strikethrough. */
export const textDecorationThicknessSchema = decorationMetric.describe(
  'Line thickness: { unit: "AUTO" } or { unit: "PIXELS" | "PERCENT", value } (CSS text-decoration-thickness)',
);

/** Colour of the underline / strikethrough: the text colour (AUTO) or an explicit one. */
export const textDecorationColorSchema = z
  .union([
    z.literal('AUTO'),
    z.object({
      r: z.number().min(0).max(1),
      g: z.number().min(0).max(1),
      b: z.number().min(0).max(1),
      space: colorSpaceSchema.optional(),
    }),
  ])
  .describe(
    'Line colour: "AUTO" follows the text colour, or { r, g, b } in 0–1 like set_fills ' +
      '(CSS text-decoration-color)',
  );

/** Whether the underline skips descenders (CSS text-decoration-skip-ink: auto vs none). */
export const textDecorationSkipInkSchema = z
  .boolean()
  .describe(
    'true = the underline breaks around descenders (g, p, y); false = it runs straight through',
  );

/** Vertical gap between list items, px. */
export const listSpacingSchema = z
  .number()
  .min(0)
  .describe('Vertical distance between the items of a list, px');
