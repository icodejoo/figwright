import type { MutateResult } from '@figwright/shared';

import type { SandboxToolHandler } from '../dispatcher.js';
import { toFigmaFontName } from './convert.js';
import {
  assertBoolean,
  assertDecorationStyle,
  assertNonNegative,
  toDecorationColor,
  toDecorationMetric,
} from './text-detail.js';
import { isTextLike, unsupportedOnPath } from './text-like.js';

/**
 * Set a TEXT node's typography + layout/overflow props. Figma requires every font on the node —
 * plus the target fontName, if changing it — to be loaded before _any_ of them is written: the
 * layout/overflow three (textAutoResize/truncation/maxLines) are refused the same way typography
 * is, despite reading as node-level settings. Applied in order autoResize → truncation → maxLines
 * because maxLines only takes effect once truncation is ENDING.
 */
export const createSetTextPropertiesHandler =
  (figmaCtx: typeof figma): SandboxToolHandler =>
  async params => {
    const p = (params ?? {}) as {
      nodeId?: unknown;
      fontName?: unknown;
      fontSize?: unknown;
      lineHeight?: unknown;
      letterSpacing?: unknown;
      textCase?: unknown;
      textDecoration?: unknown;
      textDecorationStyle?: unknown;
      textDecorationOffset?: unknown;
      textDecorationThickness?: unknown;
      textDecorationColor?: unknown;
      textDecorationSkipInk?: unknown;
      leadingTrim?: unknown;
      listSpacing?: unknown;
      hangingPunctuation?: unknown;
      hangingList?: unknown;
      paragraphSpacing?: unknown;
      paragraphIndent?: unknown;
      textWrapStyle?: unknown;
      textAlignHorizontal?: unknown;
      textAlignVertical?: unknown;
      textTruncation?: unknown;
      maxLines?: unknown;
      textAutoResize?: unknown;
    };
    if (typeof p.nodeId !== 'string')
      throw new TypeError('set_text_properties: nodeId must be a string');
    if (
      p.paragraphSpacing !== undefined &&
      (typeof p.paragraphSpacing !== 'number' || p.paragraphSpacing < 0)
    ) {
      throw new TypeError('set_text_properties: paragraphSpacing must be a non-negative number');
    }
    if (
      p.paragraphIndent !== undefined &&
      (typeof p.paragraphIndent !== 'number' || p.paragraphIndent < 0)
    ) {
      throw new TypeError('set_text_properties: paragraphIndent must be a non-negative number');
    }
    if (p.textWrapStyle !== undefined && typeof p.textWrapStyle !== 'string') {
      throw new TypeError('set_text_properties: textWrapStyle must be a string');
    }
    if (p.textAlignHorizontal !== undefined && typeof p.textAlignHorizontal !== 'string') {
      throw new TypeError('set_text_properties: textAlignHorizontal must be a string');
    }
    if (p.textAlignVertical !== undefined && typeof p.textAlignVertical !== 'string') {
      throw new TypeError('set_text_properties: textAlignVertical must be a string');
    }
    if (p.textAutoResize !== undefined && typeof p.textAutoResize !== 'string') {
      throw new TypeError('set_text_properties: textAutoResize must be a string');
    }
    if (p.textTruncation !== undefined && typeof p.textTruncation !== 'string') {
      throw new TypeError('set_text_properties: textTruncation must be a string');
    }
    if (p.maxLines !== undefined && p.maxLines !== null && typeof p.maxLines !== 'number') {
      throw new TypeError('set_text_properties: maxLines must be a number or null');
    }

    // The rarer settings are converted up front too, so a malformed one fails before any write.
    if (p.leadingTrim !== undefined && p.leadingTrim !== 'NONE' && p.leadingTrim !== 'CAP_HEIGHT') {
      throw new TypeError('set_text_properties: leadingTrim must be NONE or CAP_HEIGHT');
    }
    const listSpacing =
      p.listSpacing === undefined
        ? undefined
        : assertNonNegative(p.listSpacing, 'set_text_properties: listSpacing');
    const hangingPunctuation =
      p.hangingPunctuation === undefined
        ? undefined
        : assertBoolean(p.hangingPunctuation, 'set_text_properties: hangingPunctuation');
    const hangingList =
      p.hangingList === undefined
        ? undefined
        : assertBoolean(p.hangingList, 'set_text_properties: hangingList');
    const decorationStyle =
      p.textDecorationStyle === undefined
        ? undefined
        : assertDecorationStyle(p.textDecorationStyle, 'set_text_properties: textDecorationStyle');
    const decorationOffset =
      p.textDecorationOffset === undefined
        ? undefined
        : toDecorationMetric(p.textDecorationOffset, 'set_text_properties: textDecorationOffset');
    const decorationThickness =
      p.textDecorationThickness === undefined
        ? undefined
        : toDecorationMetric(
            p.textDecorationThickness,
            'set_text_properties: textDecorationThickness',
          );
    const decorationSkipInk =
      p.textDecorationSkipInk === undefined
        ? undefined
        : assertBoolean(p.textDecorationSkipInk, 'set_text_properties: textDecorationSkipInk');

    const node = await figmaCtx.getNodeByIdAsync(p.nodeId);
    if (!isTextLike(node)) {
      throw new Error(`set_text_properties: node ${p.nodeId} is not a TEXT node or text on a path`);
    }
    // Refused before anything is written, so a path never takes half of a call.
    const missing = node.type === 'TEXT_PATH' ? unsupportedOnPath(p) : [];
    if (missing.length > 0) {
      throw new Error(
        `set_text_properties: ${p.nodeId} is text on a path, which has no ${missing.join(', ')} ` +
          '(its text follows the path, so there are no lines, boxes or paragraphs to set)',
      );
    }
    // The fields a path lacks were refused above, so the box-level writes below only reach TEXT.
    const text = node as TextNode;

    // Every write below needs the node's font(s) loaded — the layout/overflow three included, which
    // is not obvious and was got wrong here: Figma rejects `maxLines`, `textTruncation` and
    // `textAutoResize` with `Cannot write to node with unloaded font` just as it rejects a
    // typography write, so `{nodeId, maxLines: 3}` threw while `{nodeId, fontSize: 24, maxLines: 3}`
    // succeeded. Nothing in the type checker or a mocked test can see that; the batch inverse that
    // restores these same fields has always reloaded the captured fonts first.
    //
    // Load the node's current font(s) — every one of them when the node is mixed, so a range-wide
    // mutation succeeds — plus the new fontName, if one is being assigned. Skipped only when there
    // is nothing to write at all, which is the one case that touches no text.
    const fontName =
      p.fontName === undefined ? undefined : toFigmaFontName(p.fontName as Record<string, unknown>);
    const decorationColor =
      p.textDecorationColor === undefined
        ? undefined
        : toDecorationColor(
            figmaCtx,
            p.textDecorationColor,
            'set_text_properties: textDecorationColor',
          );

    const willWrite =
      p.fontName !== undefined ||
      p.fontSize !== undefined ||
      p.lineHeight !== undefined ||
      p.letterSpacing !== undefined ||
      p.textCase !== undefined ||
      p.textDecoration !== undefined ||
      p.textDecorationStyle !== undefined ||
      p.textDecorationOffset !== undefined ||
      p.textDecorationThickness !== undefined ||
      p.textDecorationColor !== undefined ||
      p.textDecorationSkipInk !== undefined ||
      p.leadingTrim !== undefined ||
      p.listSpacing !== undefined ||
      p.hangingPunctuation !== undefined ||
      p.hangingList !== undefined ||
      p.paragraphSpacing !== undefined ||
      p.paragraphIndent !== undefined ||
      p.textWrapStyle !== undefined ||
      p.textAlignHorizontal !== undefined ||
      p.textAlignVertical !== undefined ||
      p.textAutoResize !== undefined ||
      p.textTruncation !== undefined ||
      p.maxLines !== undefined;
    if (willWrite) {
      const fonts: FontNameInput[] =
        text.fontName === figmaCtx.mixed && text.characters.length > 0
          ? [...text.getRangeAllFontNames(0, text.characters.length)]
          : [text.fontName as FontName];
      // Copied above: getRangeAllFontNames hands back a frozen array (measured — see
      // set-text-range.ts), so pushing onto it threw on every mixed-font node given a fontName.
      if (fontName !== undefined) fonts.push(fontName);
      await Promise.all(fonts.map(font => figmaCtx.loadFontAsync(font)));
    }

    // `fontName` is declared as `FontName` (style required) even though the API accepts a
    // `FontNameInput` — its own JSDoc says so, and that is the only way to express "the instance
    // closest to these axis values" without knowing the family's style names. The typings never
    // widened the property alongside the setters, hence the cast.
    if (fontName !== undefined) text.fontName = fontName as FontName;
    if (p.fontSize !== undefined) text.fontSize = p.fontSize as number;
    if (p.lineHeight !== undefined) text.lineHeight = p.lineHeight as LineHeight;
    if (p.letterSpacing !== undefined) text.letterSpacing = p.letterSpacing as LetterSpacing;
    if (p.textCase !== undefined) text.textCase = p.textCase as TextNode['textCase'];
    if (p.textDecoration !== undefined)
      text.textDecoration = p.textDecoration as TextNode['textDecoration'];
    // The underline details follow textDecoration, so a call that turns the underline on and styles
    // it at once finds the decoration already in place.
    if (decorationStyle !== undefined) text.textDecorationStyle = decorationStyle;
    if (decorationOffset !== undefined) text.textDecorationOffset = decorationOffset;
    if (decorationThickness !== undefined) text.textDecorationThickness = decorationThickness;
    if (decorationColor !== undefined) text.textDecorationColor = decorationColor;
    if (decorationSkipInk !== undefined) text.textDecorationSkipInk = decorationSkipInk;
    if (p.leadingTrim !== undefined) text.leadingTrim = p.leadingTrim as TextNode['leadingTrim'];
    if (listSpacing !== undefined) text.listSpacing = listSpacing;
    if (hangingPunctuation !== undefined) text.hangingPunctuation = hangingPunctuation;
    if (hangingList !== undefined) text.hangingList = hangingList;
    if (p.paragraphSpacing !== undefined) text.paragraphSpacing = p.paragraphSpacing as number;
    if (p.paragraphIndent !== undefined) text.paragraphIndent = p.paragraphIndent as number;
    if (p.textWrapStyle !== undefined)
      text.textWrapStyle = p.textWrapStyle as TextNode['textWrapStyle'];
    if (p.textAlignHorizontal !== undefined)
      text.textAlignHorizontal = p.textAlignHorizontal as TextNode['textAlignHorizontal'];
    if (p.textAlignVertical !== undefined)
      text.textAlignVertical = p.textAlignVertical as TextNode['textAlignVertical'];

    if (p.textAutoResize !== undefined)
      text.textAutoResize = p.textAutoResize as TextNode['textAutoResize'];
    if (p.textTruncation !== undefined)
      text.textTruncation = p.textTruncation as TextNode['textTruncation'];
    if (p.maxLines !== undefined) text.maxLines = p.maxLines as number | null;

    const result: MutateResult = { ok: true, nodeId: text.id };
    return result;
  };
