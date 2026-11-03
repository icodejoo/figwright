import type { MutateResult } from '@figwright/shared';

import type { SandboxToolHandler } from '../dispatcher.js';

export const createSetExposedInstanceHandler =
  (figmaCtx: typeof figma): SandboxToolHandler =>
  async params => {
    const p = (params ?? {}) as { nodeId?: unknown; exposed?: unknown };
    if (typeof p.nodeId !== 'string')
      throw new TypeError('set_exposed_instance: nodeId must be a string');
    if (typeof p.exposed !== 'boolean')
      throw new TypeError('set_exposed_instance: exposed must be a boolean');
    const node = await figmaCtx.getNodeByIdAsync(p.nodeId);
    if (node === null) throw new Error(`set_exposed_instance: node ${p.nodeId} not found`);
    if (node.type !== 'INSTANCE')
      throw new Error(`set_exposed_instance: node ${p.nodeId} is not an INSTANCE`);
    let owner = node.parent;
    while (owner !== null && owner.type !== 'COMPONENT' && owner.type !== 'COMPONENT_SET') {
      if (owner.type === 'INSTANCE') {
        throw new Error(
          `set_exposed_instance: node ${node.id} inherits exposure inside an INSTANCE; edit the primary instance in the main component`,
        );
      }
      owner = owner.parent;
    }
    if (owner === null)
      throw new Error(
        `set_exposed_instance: node ${node.id} must be contained within a COMPONENT or COMPONENT_SET`,
      );
    if (owner.remote)
      throw new Error(
        `set_exposed_instance: node ${node.id} belongs to a read-only remote component`,
      );
    const previous = node.isExposedInstance;
    try {
      if (previous !== p.exposed) node.isExposedInstance = p.exposed;
      if (node.isExposedInstance !== p.exposed)
        throw new Error(
          `set_exposed_instance: node ${node.id} did not retain isExposedInstance=${p.exposed}`,
        );
    } catch (err) {
      // A failing op is not unwound by batch; restore here if the API mutated before throwing.
      try {
        if (node.isExposedInstance !== previous) node.isExposedInstance = previous;
        if (node.isExposedInstance !== previous)
          throw new Error('original exposure value was not restored', { cause: err });
      } catch (undoErr) {
        throw new Error(`${String(err)}; exposure rollback FAILED: ${String(undoErr)}`, {
          cause: undoErr,
        });
      }
      throw err;
    }
    const result: MutateResult = { ok: true, nodeId: node.id };
    return result;
  };
