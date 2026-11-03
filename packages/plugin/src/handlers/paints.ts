/**
 * Write a node's fills or strokes, PATTERN, VIDEO and SHADER paints included.
 *
 * The synchronous `fills` / `strokes` setters refuse a PATTERN paint outright — even one read back
 * off the same node and written back unchanged (measured) — so any read-modify-write of a node that
 * already holds a pattern threw before it could save anything else. Only the async setters take one
 * (they load the pattern's source node first). VIDEO / SHADER keep the existing async policy;
 * typings do not document a requirement for those paints. Other paints keep the synchronous
 * assignment: async setters yield to the editor before they write, and the callers that read the
 * array they write back rely on nothing awaiting in between.
 */
// Typings require async only for PATTERN. Evidence for VIDEO / SHADER is insufficient; keep
// restores aligned with writePaints' existing policy rather than claiming an API requirement.
export const needsAsyncPaintSetter = (paints: unknown): boolean =>
  Array.isArray(paints) &&
  paints.some(p => ['PATTERN', 'VIDEO', 'SHADER'].includes((p as Paint | null)?.type ?? ''));

export const writePaints = async (
  node: BaseNode,
  field: 'fills' | 'strokes',
  paints: readonly Paint[],
): Promise<void> => {
  const target = node as unknown as Partial<MinimalFillsMixin & MinimalStrokesMixin> &
    Record<string, unknown>;
  const setter = field === 'fills' ? target.setFillsAsync : target.setStrokesAsync;
  if (needsAsyncPaintSetter(paints) && typeof setter === 'function') {
    await setter.call(node, paints);
    return;
  }
  target[field] = paints;
};
