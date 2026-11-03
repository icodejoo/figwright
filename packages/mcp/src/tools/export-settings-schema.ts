import { z } from 'zod';
export const exportOptionsShape = {
  constraint: z
    .object({ type: z.enum(['SCALE', 'WIDTH', 'HEIGHT']), value: z.number().positive() })
    .optional()
    .describe('PNG/JPG size constraint; overrides scale. WIDTH/HEIGHT are pixels.'),
  contentsOnly: z.boolean().optional(),
  useAbsoluteBounds: z.boolean().optional(),
  suffix: z.string().optional(),
  svgOutlineText: z.boolean().optional(),
  svgIdAttribute: z.boolean().optional(),
  svgSimplifyStroke: z.boolean().optional(),
  colorProfile: z.enum(['DOCUMENT', 'SRGB', 'DISPLAY_P3_V4']).optional(),
};
export const exportSettingSchema = z.object({
  format: z.enum(['PNG', 'JPG', 'SVG', 'PDF']),
  ...exportOptionsShape,
});
