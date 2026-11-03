import { toDocumentRgb } from './convert.js';

// Wire → Figma conversions for the underline details and a few other rarely used text settings,
// shared by set_text_properties (node level) and set_text_range (per run). Each is validated here,
// before the caller writes anything, so a malformed value never lands halfway through a call.

/** `{ unit: 'AUTO' }` or `{ unit: 'PIXELS' | 'PERCENT', value }` — a decoration offset / thickness. */
export const toDecorationMetric = (raw: unknown, where: string): TextDecorationOffset => {
  const m = (raw ?? {}) as { unit?: unknown; value?: unknown };
  if (m.unit === 'AUTO') return { unit: 'AUTO' };
  if (m.unit === 'PIXELS' || m.unit === 'PERCENT') {
    if (typeof m.value !== 'number' || !Number.isFinite(m.value)) {
      throw new TypeError(`${where}: a ${m.unit} value needs a numeric value`);
    }
    return { unit: m.unit, value: m.value };
  }
  throw new TypeError(`${where}: unit must be AUTO / PIXELS / PERCENT`);
};

/** "AUTO" (follow the text colour) or `{ r, g, b, space? }` → Figma's `{ value }` colour wrapper. */
export const toDecorationColor = (
  figmaCtx: typeof figma,
  raw: unknown,
  where: string,
): TextDecorationColor => {
  if (raw === 'AUTO') return { value: 'AUTO' };
  const c = (raw ?? {}) as { r?: unknown; g?: unknown; b?: unknown; space?: unknown };
  if (typeof c.r !== 'number' || typeof c.g !== 'number' || typeof c.b !== 'number') {
    throw new TypeError(`${where}: must be "AUTO" or { r, g, b } in 0–1`);
  }
  const color = toDocumentRgb(figmaCtx, { r: c.r, g: c.g, b: c.b, space: c.space }, where);
  return { value: { type: 'SOLID', color } };
};

const DECORATION_STYLES = new Set(['SOLID', 'WAVY', 'DOTTED']);

export const assertDecorationStyle = (raw: unknown, where: string): TextDecorationStyle => {
  if (typeof raw !== 'string' || !DECORATION_STYLES.has(raw)) {
    throw new TypeError(`${where}: must be SOLID / WAVY / DOTTED`);
  }
  return raw as TextDecorationStyle;
};

export const assertBoolean = (raw: unknown, where: string): boolean => {
  if (typeof raw !== 'boolean') throw new TypeError(`${where}: must be a boolean`);
  return raw;
};

export const assertNonNegative = (raw: unknown, where: string): number => {
  if (typeof raw !== 'number' || !(raw >= 0)) {
    throw new TypeError(`${where}: must be a non-negative number`);
  }
  return raw;
};
