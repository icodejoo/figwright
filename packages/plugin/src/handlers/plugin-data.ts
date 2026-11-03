export interface PluginDataParams {
  targetType: 'NODE' | 'STYLE' | 'VARIABLE' | 'VARIABLE_COLLECTION';
  targetId: string;
  namespace?: string;
  key?: string;
  value?: string;
}
export const pluginDataTarget = async (
  ctx: typeof figma,
  p: PluginDataParams,
): Promise<PluginDataMixin> => {
  const target =
    p.targetType === 'NODE'
      ? await ctx.getNodeByIdAsync(p.targetId)
      : p.targetType === 'STYLE'
        ? await ctx.getStyleByIdAsync(p.targetId)
        : p.targetType === 'VARIABLE'
          ? await ctx.variables.getVariableByIdAsync(p.targetId)
          : p.targetType === 'VARIABLE_COLLECTION'
            ? await ctx.variables.getVariableCollectionByIdAsync(p.targetId)
            : null;
  if (target === null) throw new Error(`plugin_data: ${p.targetType} ${p.targetId} not found`);
  return target;
};
export const readPluginData = (t: PluginDataMixin, p: PluginDataParams, key: string): string =>
  p.namespace === undefined ? t.getPluginData(key) : t.getSharedPluginData(p.namespace, key);
export const writePluginData = (t: PluginDataMixin, p: PluginDataParams, value: string): void => {
  if (p.namespace === undefined) t.setPluginData(p.key!, value);
  else t.setSharedPluginData(p.namespace, p.key!, value);
};
