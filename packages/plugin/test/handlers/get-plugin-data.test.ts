import { expect, it } from 'vitest';

import { createGetPluginDataHandler } from '../../src/handlers/get-plugin-data.js';
import { batch3Fake, fakeData } from './batch3-fake.js';
it('reads private/shared values and keys on every async target kind, without namespace leaks', async () => {
  const target = { id: 'x', ...fakeData() };
  target.setPluginData('__proto__', 'private');
  target.setSharedPluginData('figwright', 'tag', 'shared');
  const { ctx } = batch3Fake({ x: target });
  const get = createGetPluginDataHandler(ctx);
  for (const targetType of ['NODE', 'STYLE', 'VARIABLE', 'VARIABLE_COLLECTION']) {
    expect(await get({ targetType, targetId: 'x' })).toEqual({
      data: { ['__proto__']: 'private' },
    });
    expect(await get({ targetType, targetId: 'x', namespace: 'figwright' })).toEqual({
      data: { tag: 'shared' },
    });
    expect(await get({ targetType, targetId: 'x', key: 'missing' })).toEqual({ value: '' });
  }
  await expect(get({ targetType: 'NODE', targetId: 'missing' })).rejects.toThrow('not found');
});
