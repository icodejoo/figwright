import type { SandboxToolHandler } from '../dispatcher.js';
import { bindingScope, readBindings, visitBindings } from './variable-bindings.js';

export const createScanVariableBindingsHandler =
  (api: typeof figma, now: () => number = Date.now): SandboxToolHandler =>
  async params => {
    const p = (params ?? {}) as {
      root?: string;
      variableIds?: string[];
      collectionIds?: string[];
      sampleLimit?: number;
    };
    const deadline = now() + 100_000;
    const sampleLimit = p.sampleLimit ?? 3;
    if (!Number.isInteger(sampleLimit) || sampleLimit < 0 || sampleLimit > 20)
      throw new Error('sampleLimit must be an integer from 0 to 20');
    const scope = await bindingScope(api, p.root);
    const variables = new Map<string, Promise<Variable | null>>();
    const collections = new Map<string, Promise<VariableCollection | null>>();
    const variableFor = (id: string) => {
      if (!variables.has(id))
        variables.set(
          id,
          api.variables.getVariableByIdAsync(id).catch(() => null),
        );
      return variables.get(id)!;
    };
    const rows = new Map<
      string,
      {
        variableId: string;
        name?: string;
        collectionName?: string;
        count: number;
        editable: number;
        nested: number;
        fields: Record<string, number>;
        samples: string[];
      }
    >();
    const wanted = p.variableIds && new Set(p.variableIds);
    const collectionIds = p.collectionIds && new Set(p.collectionIds);
    const traversal = await visitBindings(api, scope.nodes, deadline, now, async node => {
      for (const binding of readBindings(api, node)) {
        const id = binding.variableId;
        if (wanted && !wanted.has(id)) continue;
        if (collectionIds) {
          // eslint-disable-next-line no-await-in-loop -- cached variable resolution for collection filter
          const variable = await variableFor(id);
          if (!variable || !collectionIds.has(variable.variableCollectionId)) continue;
        }
        let row = rows.get(id);
        if (!row) {
          row = { variableId: id, count: 0, editable: 0, nested: 0, fields: {}, samples: [] };
          rows.set(id, row);
        }
        row.count += 1;
        row.fields[binding.field] = (row.fields[binding.field] ?? 0) + 1;
        if (node.id.startsWith('I')) row.nested += 1;
        else {
          row.editable += 1;
          if (row.samples.length < sampleLimit && !row.samples.includes(node.id))
            row.samples.push(node.id);
        }
      }
    });
    for (const row of rows.values()) {
      if (now() >= deadline) break;
      // eslint-disable-next-line no-await-in-loop -- metadata is optional and cached, stop at budget
      const variable = await variableFor(row.variableId);
      if (!variable) continue;
      row.name = variable.name;
      const id = variable.variableCollectionId;
      if (!collections.has(id))
        collections.set(
          id,
          api.variables.getVariableCollectionByIdAsync(id).catch(() => null),
        );
      // eslint-disable-next-line no-await-in-loop -- one lookup per distinct collection
      const collection = await collections.get(id)!;
      if (collection) row.collectionName = collection.name;
    }
    return {
      root: scope.root,
      ...traversal,
      bindings: [...rows.values()].toSorted((a, b) => b.count - a.count),
    };
  };
