export type StyleKind = 'PAINT' | 'TEXT' | 'EFFECT' | 'GRID' | 'CUSTOM_ANIMATION';

export const styleFolder = (name: string): string => {
  const slash = name.lastIndexOf('/');
  return slash < 0 ? '' : name.slice(0, slash);
};

/** Keep the concrete API calls together; callers validate the styles' kind before moving. */
export const styleOrderApi = (ctx: typeof figma, kind: StyleKind) => {
  switch (kind) {
    case 'PAINT':
      return {
        list: () => ctx.getLocalPaintStylesAsync(),
        move: (a: BaseStyle, b: BaseStyle | null) =>
          ctx.moveLocalPaintStyleAfter(a as PaintStyle, b as PaintStyle | null),
        moveFolder: (a: string, b: string | null) => ctx.moveLocalPaintFolderAfter(a, b),
        type: 'PAINT',
      };
    case 'TEXT':
      return {
        list: () => ctx.getLocalTextStylesAsync(),
        move: (a: BaseStyle, b: BaseStyle | null) =>
          ctx.moveLocalTextStyleAfter(a as TextStyle, b as TextStyle | null),
        moveFolder: (a: string, b: string | null) => ctx.moveLocalTextFolderAfter(a, b),
        type: 'TEXT',
      };
    case 'EFFECT':
      return {
        list: () => ctx.getLocalEffectStylesAsync(),
        move: (a: BaseStyle, b: BaseStyle | null) =>
          ctx.moveLocalEffectStyleAfter(a as EffectStyle, b as EffectStyle | null),
        moveFolder: (a: string, b: string | null) => ctx.moveLocalEffectFolderAfter(a, b),
        type: 'EFFECT',
      };
    case 'GRID':
      return {
        list: () => ctx.getLocalGridStylesAsync(),
        move: (a: BaseStyle, b: BaseStyle | null) =>
          ctx.moveLocalGridStyleAfter(a as GridStyle, b as GridStyle | null),
        moveFolder: (a: string, b: string | null) => ctx.moveLocalGridFolderAfter(a, b),
        type: 'GRID',
      };
    case 'CUSTOM_ANIMATION':
      return {
        list: () => ctx.getLocalCustomAnimationStylesAsync(),
        move: (a: BaseStyle, b: BaseStyle | null) =>
          ctx.moveLocalCustomAnimationStyleAfter(
            a as CustomAnimationStyle,
            b as CustomAnimationStyle | null,
          ),
        moveFolder: (a: string, b: string | null) => ctx.moveLocalCustomAnimationFolderAfter(a, b),
        type: 'CUSTOM_ANIMATION',
      };
    default:
      throw new Error(`Unknown style kind: ${String(kind)}`);
  }
};

/** Derive immediate child folders in panel order from the local style list. */
export const siblingFolders = (styles: readonly BaseStyle[], parent: string): string[] => {
  const prefix = parent === '' ? '' : `${parent}/`;
  const folders = new Set<string>();
  for (const style of styles) {
    const folder = styleFolder(style.name);
    if (!folder.startsWith(prefix)) continue;
    const rest = folder.slice(prefix.length);
    if (rest !== '') folders.add(prefix + rest.split('/')[0]!);
  }
  return [...folders];
};
