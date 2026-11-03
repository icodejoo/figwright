import { vi } from 'vitest';
export const fakeData = () => {
  const privateData = new Map<string, string>();
  const sharedData = new Map<string, Map<string, string>>();
  const shared = (ns: string) => {
    if (!sharedData.has(ns)) sharedData.set(ns, new Map());
    return sharedData.get(ns)!;
  };
  const set = (map: Map<string, string>, key: string, value: string) => {
    if (value === '') map.delete(key);
    else map.set(key, value);
  };
  return {
    getPluginData: (key: string) => privateData.get(key) ?? '',
    setPluginData: (key: string, value: string) => set(privateData, key, value),
    getPluginDataKeys: () => [...privateData.keys()],
    getSharedPluginData: (ns: string, key: string) => shared(ns).get(key) ?? '',
    setSharedPluginData: (ns: string, key: string, value: string) => set(shared(ns), key, value),
    getSharedPluginDataKeys: (ns: string) => [...shared(ns).keys()],
  };
};
export const batch3Fake = (nodes: Record<string, unknown> = {}) => {
  const root = {
    id: '0:0',
    type: 'DOCUMENT',
    children: [] as { id: string }[],
    insertChild: vi.fn<(index: number, page: { id: string }) => void>(
      (index: number, page: { id: string }) => {
        const old = root.children.indexOf(page);
        if (old >= 0) {
          root.children.splice(old, 1);
          if (old < index) index -= 1;
        }
        root.children.splice(index, 0, page);
      },
    ),
  };
  const ctx = {
    root,
    currentPage: { id: '0:1' },
    getNodeByIdAsync: vi.fn<(id: string) => Promise<unknown>>(async (id: string) =>
      id === root.id ? root : (nodes[id] ?? null),
    ),
    getStyleByIdAsync: vi.fn<(id: string) => Promise<unknown>>(
      async (id: string) => nodes[id] ?? null,
    ),
    variables: {
      getVariableByIdAsync: vi.fn<(id: string) => Promise<unknown>>(
        async (id: string) => nodes[id] ?? null,
      ),
      getVariableCollectionByIdAsync: vi.fn<(id: string) => Promise<unknown>>(
        async (id: string) => nodes[id] ?? null,
      ),
    },
  } as unknown as typeof figma;
  return { ctx, root };
};
