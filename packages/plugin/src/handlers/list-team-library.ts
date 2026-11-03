import type { SandboxToolHandler } from '../dispatcher.js';
export const createListTeamLibraryHandler =
  (api: typeof figma): SandboxToolHandler =>
  async params => {
    const p = (params ?? {}) as {
      libraryName?: string;
      collectionKey?: string;
      resolvedType?: VariableResolvedDataType;
      limit?: number;
    };
    const limit = p.limit ?? 200;
    if (!Number.isInteger(limit) || limit < 1 || limit > 2000)
      throw new Error('limit must be from 1 to 2000');
    if (p.resolvedType && !p.collectionKey) throw new Error('resolvedType requires collectionKey');
    const all = await api.teamLibrary.getAvailableLibraryVariableCollectionsAsync();
    const collections = all
      .filter(
        c => !p.libraryName || c.libraryName.toLowerCase().includes(p.libraryName.toLowerCase()),
      )
      .map(({ name, key, libraryName }) => ({ name, key, libraryName }));
    if (!p.collectionKey)
      return {
        collections: collections.slice(0, limit),
        ...(collections.length > limit && { truncated: true }),
      };
    const collection = collections.find(c => c.key === p.collectionKey);
    if (!collection)
      throw new Error(
        'Collection is not available in the enabled libraries or does not match libraryName',
      );
    const variables = (await api.teamLibrary.getVariablesInLibraryCollectionAsync(p.collectionKey))
      .filter(v => !p.resolvedType || v.resolvedType === p.resolvedType)
      .map(({ name, key, resolvedType }) => ({ name, key, resolvedType }));
    return {
      collection,
      variables: variables.slice(0, limit),
      ...(variables.length > limit && { truncated: true }),
    };
  };
