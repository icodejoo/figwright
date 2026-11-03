/** Optional API metadata only: no inferred descendant scan or false/empty payload overhead. */
export const readExposure = (
  node: SceneNode,
): {
  isExposedInstance?: true;
  exposedInstances?: string[];
} => {
  const out: { isExposedInstance?: true; exposedInstances?: string[] } = {};
  if (node.type === 'INSTANCE') {
    try {
      if (node.isExposedInstance === true) out.isExposedInstance = true;
    } catch {
      // Unavailable metadata must not prevent reading the rest of the node.
    }
  }
  if (['INSTANCE', 'COMPONENT', 'COMPONENT_SET', 'FRAME'].includes(node.type)) {
    try {
      // Only InstanceNode currently declares this API; tolerate other runtime providers.
      const instances = (node as { exposedInstances?: readonly InstanceNode[] }).exposedInstances;
      if (instances !== undefined && instances.length > 0)
        out.exposedInstances = instances.map(instance => instance.id);
    } catch {
      // A Figma getter may reject, e.g. when a referenced child is unavailable.
    }
  }
  return out;
};
