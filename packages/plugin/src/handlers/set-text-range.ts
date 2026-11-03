import type { MutateResult, SerializedLineHeight, SerializedPaint } from '@figwright/shared';

import type { SandboxToolHandler } from '../dispatcher.js';
import { toFigmaPaintsBound } from './bindings.js';
import { toFigmaFontName, toFigmaLineHeight } from './convert.js';
import {
  assertBoolean,
  assertDecorationStyle,
  assertNonNegative,
  toDecorationColor,
  toDecorationMetric,
} from './text-detail.js';
import { isTextLike, NOT_ON_A_PATH, unsupportedOnPath } from './text-like.js';

interface RangeInput {
  start: number;
  end: number;
  fontName?: Record<string, unknown>;
  fontSize?: number;
  fills?: SerializedPaint[];
  textDecoration?: string;
  textDecorationStyle?: string;
  textDecorationOffset?: unknown;
  textDecorationThickness?: unknown;
  textDecorationColor?: unknown;
  textDecorationSkipInk?: boolean;
  paragraphSpacing?: number;
  paragraphIndent?: number;
  listSpacing?: number;
  textCase?: string;
  lineHeight?: SerializedLineHeight;
  letterSpacing?: { unit: string; value: number };
  hyperlink?: { type: string; value: string } | null;
  listOptions?: string;
  indentation?: number;
  textWrapStyle?: string;
  textStyleId?: string;
  fillStyleId?: string;
  boundVariables?: Record<string, string | null>;
}

/** The rarer per-run values of one range, converted and validated before any write. */
interface RangeDetails {
  style?: TextDecorationStyle;
  offset?: TextDecorationOffset;
  thickness?: TextDecorationThickness;
  color?: TextDecorationColor;
  skipInk?: boolean;
  paragraphSpacing?: number;
  paragraphIndent?: number;
  listSpacing?: number;
}

/**
 * Style character ranges of a TEXT node — the write-side mirror of a read segment. Every per-run
 * property maps to its setRange* method; ranges apply in array order so a later range overrides an
 * earlier one where they overlap. Fonts are loaded up front (all fonts already on the node plus any
 * target fontName), since every range mutation requires the affected fonts loaded — exactly like
 * set_text_properties, but per range. Style-id / variable bindings use the async setters and
 * resolve the variable id to a Variable (like bind_variable_to_node); binding is applied last so it
 * wins over a direct value on the same field.
 */
export const createSetTextRangeHandler =
  (figmaCtx: typeof figma): SandboxToolHandler =>
  async params => {
    const p = (params ?? {}) as { nodeId?: unknown; ranges?: unknown };
    if (typeof p.nodeId !== 'string') {
      throw new TypeError('set_text_range: nodeId must be a string');
    }
    if (!Array.isArray(p.ranges)) {
      throw new TypeError('set_text_range: ranges must be an array');
    }

    const node = await figmaCtx.getNodeByIdAsync(p.nodeId);
    if (!isTextLike(node)) {
      throw new Error(`set_text_range: node ${p.nodeId} is not a TEXT node or text on a path`);
    }
    const len = node.characters.length;

    const ranges = p.ranges as RangeInput[];
    // Text on a path accepts these per run and never draws them (measured), so they are refused up
    // front instead of answering ok for a change nobody will see.
    if (node.type === 'TEXT_PATH') {
      const missing = new Set<string>();
      for (const r of ranges) {
        for (const field of unsupportedOnPath(r as unknown as Record<string, unknown>)) {
          missing.add(field);
        }
        for (const field of Object.keys(r.boundVariables ?? {})) {
          if (NOT_ON_A_PATH.has(field)) missing.add(field);
        }
      }
      if (missing.size > 0) {
        throw new Error(
          `set_text_range: ${p.nodeId} is text on a path, which does not draw ` +
            `${[...missing].join(', ')}`,
        );
      }
    }
    // Every per-run setter used below exists on both node types; the ones a path lacks were
    // refused above.
    const text = node as TextNode;
    // The rarer fields are converted once, up front, so a malformed one fails before any range
    // mutates; the converted value is what the write loop below reuses.
    const details = new Map<RangeInput, RangeDetails>();
    for (const [i, r] of ranges.entries()) {
      const at = `set_text_range: ranges[${i}]`;
      const d: RangeDetails = {};
      if (r.textDecorationStyle !== undefined) {
        d.style = assertDecorationStyle(r.textDecorationStyle, `${at}.textDecorationStyle`);
      }
      if (r.textDecorationOffset !== undefined) {
        d.offset = toDecorationMetric(r.textDecorationOffset, `${at}.textDecorationOffset`);
      }
      if (r.textDecorationThickness !== undefined) {
        d.thickness = toDecorationMetric(
          r.textDecorationThickness,
          `${at}.textDecorationThickness`,
        );
      }
      if (r.textDecorationColor !== undefined) {
        d.color = toDecorationColor(figmaCtx, r.textDecorationColor, `${at}.textDecorationColor`);
      }
      if (r.textDecorationSkipInk !== undefined) {
        d.skipInk = assertBoolean(r.textDecorationSkipInk, `${at}.textDecorationSkipInk`);
      }
      if (r.paragraphSpacing !== undefined) {
        d.paragraphSpacing = assertNonNegative(r.paragraphSpacing, `${at}.paragraphSpacing`);
      }
      if (r.paragraphIndent !== undefined) {
        d.paragraphIndent = assertNonNegative(r.paragraphIndent, `${at}.paragraphIndent`);
      }
      if (r.listSpacing !== undefined) {
        d.listSpacing = assertNonNegative(r.listSpacing, `${at}.listSpacing`);
      }
      details.set(r, d);
    }
    // Validate every range up front so a bad range fails before any partial mutation.
    for (const r of ranges) {
      if (typeof r.start !== 'number' || typeof r.end !== 'number') {
        throw new TypeError('set_text_range: each range needs numeric start and end');
      }
      if (r.start < 0 || r.end > len || r.start >= r.end) {
        throw new RangeError(
          `set_text_range: range ${r.start}–${r.end} is out of bounds or empty (text length ${len})`,
        );
      }
    }

    // Every range mutation needs the fonts it touches loaded. Load all fonts currently on the node
    // plus any target fontName a range assigns, deduped, before mutating. getRangeAllFontNames
    // returns a non-extensible (frozen) array in Figma's runtime, so copy into a fresh array before
    // pushing the target fonts (a plain push throws "object is not extensible").
    const fonts: FontNameInput[] = [
      ...(len > 0 ? text.getRangeAllFontNames(0, len) : [text.fontName as FontName]),
    ];
    // Rebuilt once here, then reused for both the preload and the write below, so a malformed
    // fontName is rejected before any range mutates rather than partway through the loop.
    const rangeFonts = new Map<RangeInput, FontNameInput>();
    for (const r of ranges) {
      if (r.fontName === undefined) continue;
      const font = toFigmaFontName(r.fontName);
      rangeFonts.set(r, font);
      fonts.push(font);
    }
    const seen = new Set<string>();
    // Deduped on family + style alone, deliberately: loading is per face, and variation values
    // affect what gets rendered rather than what gets loaded. A style-less input loads the whole
    // family, so it gets its own key rather than colliding with a named instance of it.
    const uniqueFonts = fonts.filter(f => {
      const key = `${f.family} ${f.style ?? '*'}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    await Promise.all(uniqueFonts.map(f => figmaCtx.loadFontAsync(f)));

    /* eslint-disable no-await-in-loop -- ranges apply in order (a later range overrides an earlier
       one on overlap), and within a range the async style/variable bindings must land after the
       direct values, so these awaits are intentionally sequential. */
    for (const r of ranges) {
      const { start, end } = r;
      // Direct values first.
      const font = rangeFonts.get(r);
      if (font !== undefined) text.setRangeFontName(start, end, font);
      if (r.fontSize !== undefined) text.setRangeFontSize(start, end, r.fontSize);
      // A run's paints carry their own bindings, exactly like a node's — distinct from the
      // range-level `boundVariables` applied below, which binds a field on the run itself.
      if (r.fills !== undefined) {
        text.setRangeFills(
          start,
          end,
          await toFigmaPaintsBound(figmaCtx, r.fills, 'set_text_range'),
        );
      }
      if (r.textDecoration !== undefined) {
        text.setRangeTextDecoration(start, end, r.textDecoration as TextDecoration);
      }
      // The underline details follow the decoration itself, so a run that is underlined and styled
      // in one range finds the underline already in place.
      const d = details.get(r)!;
      if (d.style !== undefined) text.setRangeTextDecorationStyle(start, end, d.style);
      if (d.offset !== undefined) text.setRangeTextDecorationOffset(start, end, d.offset);
      if (d.thickness !== undefined) text.setRangeTextDecorationThickness(start, end, d.thickness);
      if (d.color !== undefined) text.setRangeTextDecorationColor(start, end, d.color);
      if (d.skipInk !== undefined) text.setRangeTextDecorationSkipInk(start, end, d.skipInk);
      if (d.paragraphSpacing !== undefined) {
        text.setRangeParagraphSpacing(start, end, d.paragraphSpacing);
      }
      if (d.paragraphIndent !== undefined) {
        text.setRangeParagraphIndent(start, end, d.paragraphIndent);
      }
      if (d.listSpacing !== undefined) text.setRangeListSpacing(start, end, d.listSpacing);
      if (r.textCase !== undefined) text.setRangeTextCase(start, end, r.textCase as TextCase);
      if (r.lineHeight !== undefined) {
        text.setRangeLineHeight(start, end, toFigmaLineHeight(r.lineHeight));
      }
      if (r.letterSpacing !== undefined) {
        text.setRangeLetterSpacing(start, end, r.letterSpacing as LetterSpacing);
      }
      if (r.hyperlink !== undefined) {
        text.setRangeHyperlink(start, end, r.hyperlink as HyperlinkTarget | null);
      }
      if (r.listOptions !== undefined) {
        text.setRangeListOptions(start, end, { type: r.listOptions as TextListOptions['type'] });
      }
      if (r.indentation !== undefined) text.setRangeIndentation(start, end, r.indentation);
      // Paragraph-scoped, unlike every other field here: Figma applies it to whole paragraphs the
      // range touches, so a range covering one character still restyles that character's paragraph.
      if (r.textWrapStyle !== undefined) {
        text.setRangeTextWrapStyle(start, end, r.textWrapStyle as TextWrapStyle);
      }
      // Design-system bindings: shared styles (async setters), then variable bindings last so a bound
      // variable wins over a direct value set on the same field above.
      // The face this style carries is not preloaded above, and does not need to be — the async
      // style-id setters load what they need themselves (see apply-style-to-node.ts, where the same
      // thing was checked against a real file with nothing loaded at all).
      if (r.textStyleId !== undefined)
        await text.setRangeTextStyleIdAsync(start, end, r.textStyleId);
      if (r.fillStyleId !== undefined)
        await text.setRangeFillStyleIdAsync(start, end, r.fillStyleId);
      if (r.boundVariables !== undefined) {
        for (const [field, variableId] of Object.entries(r.boundVariables)) {
          let variable: Variable | null = null;
          if (typeof variableId === 'string') {
            variable = await figmaCtx.variables.getVariableByIdAsync(variableId);
            if (variable === null) {
              throw new Error(`set_text_range: variable ${variableId} not found`);
            }
          }
          if (field === 'fills') {
            // A colour binding lives on the paint, not the node/run — setRangeBoundVariable rejects
            // `fills`. Bind the variable onto the run's current fill via setBoundVariableForPaint
            // (the range analogue of bind_variable_to_paint), preserving its colour, and write it back.
            const current = text.getRangeFills(start, end);
            const base: SolidPaint =
              Array.isArray(current) && current[0]?.type === 'SOLID'
                ? current[0]
                : { type: 'SOLID', color: { r: 0, g: 0, b: 0 } };
            const bound = figmaCtx.variables.setBoundVariableForPaint(base, 'color', variable);
            text.setRangeFills(start, end, [bound]);
          } else {
            text.setRangeBoundVariable(start, end, field as VariableBindableTextField, variable);
          }
        }
      }
    }
    /* eslint-enable no-await-in-loop */

    const result: MutateResult = { ok: true, nodeId: text.id };
    return result;
  };
