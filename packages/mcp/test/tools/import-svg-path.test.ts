import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { resolveSvgPath } from '../../src/tools/import-svg.js';

describe('resolveSvgPath', () => {
  let dir = '';
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'figwright-svg-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('reads the file named by path into svg and drops path', async () => {
    const file = join(dir, 'a.svg');
    await writeFile(file, '<svg/>');
    expect(await resolveSvgPath({ path: file, name: 'logo' })).toEqual({
      svg: '<svg/>',
      name: 'logo',
    });
  });

  it('passes inline svg through', async () => {
    expect(await resolveSvgPath({ svg: '<svg/>' })).toEqual({ svg: '<svg/>' });
  });

  it('rejects both or neither of svg and path', async () => {
    await expect(resolveSvgPath({ svg: '<svg/>', path: 'x.svg' })).rejects.toThrow('not both');
    await expect(resolveSvgPath({})).rejects.toThrow('provide svg or path');
  });
});
