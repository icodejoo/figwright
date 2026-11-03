import { describe, it, expect, vi } from 'vitest';

import { createListTeamLibraryHandler } from '../../src/handlers/list-team-library.js';
const mock = <T extends (...args: never[]) => unknown>(implementation: T) =>
  vi.fn<T>(implementation);
const setup = () => ({
  teamLibrary: {
    getAvailableLibraryVariableCollectionsAsync: mock(async () => [
      { name: 'colors', key: 'c', libraryName: 'Tokens' },
      { name: 'sizes', key: 's', libraryName: 'Other' },
    ]),
    getVariablesInLibraryCollectionAsync: mock(async () => [
      { name: 'red', key: 'r', resolvedType: 'COLOR' },
      { name: 'size', key: 'n', resolvedType: 'FLOAT' },
    ]),
  },
});
describe('list_team_library', () => {
  it('lists and filters collections and reports truncation', async () => {
    const f = setup(),
      h = createListTeamLibraryHandler(f as unknown as typeof figma);
    expect(await h({ limit: 1 })).toMatchObject({ collections: [{ key: 'c' }], truncated: true });
    expect(await h({ libraryName: 'TOKEN' })).toEqual({
      collections: [{ name: 'colors', key: 'c', libraryName: 'Tokens' }],
    });
  });
  it('lists filtered variables and rejects unavailable collections', async () => {
    const f = setup(),
      h = createListTeamLibraryHandler(f as unknown as typeof figma);
    expect(await h({ collectionKey: 'c', resolvedType: 'FLOAT' })).toMatchObject({
      collection: { key: 'c' },
      variables: [{ key: 'n' }],
    });
    expect(await h({ collectionKey: 'c', limit: 1 })).toMatchObject({ truncated: true });
    await expect(h({ collectionKey: 'unknown' })).rejects.toThrow('not available');
    await expect(h({ resolvedType: 'COLOR' })).rejects.toThrow('requires collectionKey');
  });
  it('propagates native bare-string errors unchanged from both calls', async () => {
    const f = setup(),
      h = createListTeamLibraryHandler(f as unknown as typeof figma);
    f.teamLibrary.getVariablesInLibraryCollectionAsync.mockRejectedValueOnce(
      'library access denied',
    );
    await expect(h({ collectionKey: 'c' })).rejects.toBe('library access denied');
    f.teamLibrary.getAvailableLibraryVariableCollectionsAsync.mockRejectedValueOnce(
      'request failed',
    );
    await expect(h({})).rejects.toBe('request failed');
  });
});
