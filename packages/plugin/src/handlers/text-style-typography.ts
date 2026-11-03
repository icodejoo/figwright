// The TextStyle typography beyond font / size / leading / tracking / wrap, written by both
// create_text_style and update_text_style. One list, so the two cannot drift apart.

const ENUM_FIELDS = ['textCase', 'textDecoration', 'leadingTrim'] as const;
const NUMBER_FIELDS = ['paragraphSpacing', 'paragraphIndent', 'listSpacing'] as const;
const BOOLEAN_FIELDS = ['hangingPunctuation', 'hangingList'] as const;

/** Check the typography fields' types before anything is created or written. */
export const assertTextStyleTypography = (p: Record<string, unknown>, tool: string): void => {
  for (const k of ENUM_FIELDS) {
    if (p[k] !== undefined && typeof p[k] !== 'string') {
      throw new TypeError(`${tool}: ${k} must be a string`);
    }
  }
  for (const k of NUMBER_FIELDS) {
    if (p[k] !== undefined && (typeof p[k] !== 'number' || !((p[k] as number) >= 0))) {
      throw new TypeError(`${tool}: ${k} must be a non-negative number`);
    }
  }
  for (const k of BOOLEAN_FIELDS) {
    if (p[k] !== undefined && typeof p[k] !== 'boolean') {
      throw new TypeError(`${tool}: ${k} must be a boolean`);
    }
  }
};

/**
 * Write the fields the caller gave. The style's own face must already be loaded (every typography
 * write needs it) — both handlers load it just before calling this.
 */
export const writeTextStyleTypography = (style: TextStyle, p: Record<string, unknown>): void => {
  const target = style as unknown as Record<string, unknown>;
  for (const k of [...ENUM_FIELDS, ...NUMBER_FIELDS, ...BOOLEAN_FIELDS]) {
    if (p[k] !== undefined) target[k] = p[k];
  }
};
