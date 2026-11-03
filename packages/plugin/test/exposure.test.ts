import { describe, expect, it } from 'vitest';

import { readExposure } from '../src/exposure.js';
import { project } from '../src/handlers/get-design-context.js';
import { createGetNodeHandler } from '../src/handlers/get-node.js';
import { createGetNodesInfoHandler } from '../src/handlers/get-nodes-info.js';
import { serializeFlatSync } from '../src/serializer.js';

const fake = (extra: Record<string, unknown>): SceneNode =>
  ({
    id: 'N',
    name: 'Node',
    type: 'INSTANCE',
    visible: true,
    locked: false,
    x: 0,
    y: 0,
    width: 10,
    height: 10,
    parent: null,
    ...extra,
  }) as unknown as SceneNode;

describe('exposure metadata', () => {
  it('survives both serialized node read handlers', async () => {
    const node = fake({ isExposedInstance: true, exposedInstances: [{ id: 'nested' }] });
    const ctx = { getNodeByIdAsync: async () => node } as unknown as typeof figma;
    const expected = { id: 'N', isExposedInstance: true, exposedInstances: ['nested'] };
    expect(await createGetNodeHandler(ctx)({ nodeId: 'N' })).toMatchObject({ node: expected });
    expect(await createGetNodesInfoHandler(ctx)({ nodeIds: ['N'] })).toMatchObject({
      nodes: [expected],
    });
  });
  it.each(['INSTANCE', 'COMPONENT', 'FRAME', 'COMPONENT_SET'])(
    'reads API-provided ids on %s',
    type => {
      const node = fake({ type, exposedInstances: [{ id: 'nested' }] });
      expect(serializeFlatSync(node).exposedInstances).toEqual(['nested']);
      expect(project(node, 'full').exposedInstances).toEqual(['nested']);
    },
  );

  it('carries a true exposure flag through serialization and design-context projection', () => {
    const node = fake({ isExposedInstance: true });
    expect(serializeFlatSync(node).isExposedInstance).toBe(true);
    expect(project(node, 'full').isExposedInstance).toBe(true);
  });

  it('leaves absent, false and empty metadata out, preserving the existing serialized output', () => {
    const original = serializeFlatSync(fake({}));
    expect(serializeFlatSync(fake({ isExposedInstance: false, exposedInstances: [] }))).toEqual(
      original,
    );
    expect(readExposure(fake({}))).toEqual({});
  });

  it('does not let an unavailable API getter break the existing read', () => {
    const node = fake({ isExposedInstance: true });
    Object.defineProperty(node, 'exposedInstances', {
      get: () => {
        throw new Error('unavailable');
      },
    });
    expect(readExposure(node)).toEqual({ isExposedInstance: true });
    expect(serializeFlatSync(node).isExposedInstance).toBe(true);
  });
});
