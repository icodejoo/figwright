/* eslint-disable no-await-in-loop -- Sequential native calls preserve traversal budgets, alias dependencies and read-modify-write ordering. */
import { TimeSlice } from '../cooperative.js';
import type { SandboxToolHandler } from '../dispatcher.js';
import { bindingScope, createVariableResolver, visitBindings } from './variable-bindings.js';
type Kind =
  | 'VARIABLE_COLLECTION'
  | 'VARIABLE'
  | 'COMPONENT'
  | 'COMPONENT_SET'
  | 'STYLE'
  | 'ALL_LOCAL';
type Status = 'UNPUBLISHED' | 'CURRENT' | 'CHANGED';
const counts = () => ({ UNPUBLISHED: 0, CURRENT: 0, CHANGED: 0 });
type Publishable = Variable | VariableCollection | BaseStyle | ComponentNode | ComponentSetNode;
export const createGetPublishStatusHandler =
  (api: typeof figma, now: () => number = Date.now): SandboxToolHandler =>
  async params => {
    const p = (params ?? {}) as {
      kind?: Kind;
      ids?: string[];
      root?: string;
      statuses?: Status[];
      limit?: number;
    };
    const kind = p.kind ?? 'VARIABLE_COLLECTION';
    if (p.root !== undefined && kind !== 'COMPONENT' && kind !== 'COMPONENT_SET')
      throw new Error(
        'root is only supported for COMPONENT or COMPONENT_SET; variables and styles have no subtree',
      );
    const limit = p.limit ?? 500;
    if (!Number.isInteger(limit) || limit < 1 || limit > 5000)
      throw new Error('limit must be from 1 to 5000');
    const deadline = now() + 100000;
    const resolver = createVariableResolver(api);
    const items: {
      id: string;
      name: string;
      type: string;
      status: Status;
      key?: string;
      hiddenFromPublishing?: boolean;
    }[] = [];
    const total = counts();
    const countsByKind: Record<string, ReturnType<typeof counts>> = {};
    let complete = true,
      skippedRemote = 0,
      truncated = false;
    const ids = p.ids && new Set(p.ids);
    const slice = new TimeSlice();
    const found = new Set<string>();
    const failed: { id: string; error: string }[] = [];
    let failedCount = 0;
    const failure = (id: string, error: unknown) => {
      found.add(id);
      failedCount++;
      if (failed.length < 20)
        failed.push({
          id,
          error: (error instanceof Error ? error.message : String(error)).slice(0, 120),
        });
    };
    const inspect = async (object: Publishable, group: string) => {
      try {
        if (ids && !ids.has(object.id)) return;
        found.add(object.id);
        if (object.remote) {
          skippedRemote++;
          return;
        }
        const status = await object.getPublishStatusAsync();
        total[status]++;
        countsByKind[group]![status]++;
        if (p.statuses && !p.statuses.includes(status)) return;
        if (items.length >= limit) {
          truncated = true;
          return;
        }
        items.push({
          id: object.id,
          name: object.name,
          type: 'type' in object ? object.type : group,
          status,
          key: object.key,
          ...('hiddenFromPublishing' in object && {
            hiddenFromPublishing: object.hiddenFromPublishing,
          }),
        });
      } catch (error) {
        failure(object.id, error);
      }
    };
    const groups: Kind[] =
      kind === 'ALL_LOCAL'
        ? ['VARIABLE_COLLECTION', 'VARIABLE', 'STYLE', 'COMPONENT', 'COMPONENT_SET']
        : [kind];
    for (const group of groups) {
      countsByKind[group] = counts();
      if (now() >= deadline) {
        complete = false;
        break;
      }
      if (group === 'COMPONENT' || group === 'COMPONENT_SET') {
        const scope = await bindingScope(api, p.root);
        const traversal = await visitBindings(api, scope.nodes, deadline, now, async node => {
          if (node.type === group) await inspect(node, group);
        });
        complete = complete && traversal.complete;
      } else {
        let objects: Publishable[];
        if (
          p.ids &&
          kind !== 'ALL_LOCAL' &&
          (group === 'VARIABLE_COLLECTION' || group === 'VARIABLE' || group === 'STYLE')
        ) {
          objects = [];
          for (const id of new Set(p.ids)) {
            if (now() >= deadline) {
              complete = false;
              break;
            }
            try {
              const object =
                group === 'VARIABLE_COLLECTION'
                  ? await resolver.resolveCollection(id)
                  : group === 'VARIABLE'
                    ? await resolver.resolve(id)
                    : await api.getStyleByIdAsync(id);
              if (object) objects.push(object);
            } catch (error) {
              failure(id, error);
            }
          }
        } else if (group === 'VARIABLE_COLLECTION')
          objects = await api.variables.getLocalVariableCollectionsAsync();
        else if (group === 'VARIABLE') objects = await api.variables.getLocalVariablesAsync();
        else
          objects = [
            ...(await api.getLocalPaintStylesAsync()),
            ...(await api.getLocalTextStylesAsync()),
            ...(await api.getLocalEffectStylesAsync()),
            ...(await api.getLocalGridStylesAsync()),
          ];
        for (const object of objects) {
          if (now() >= deadline) {
            complete = false;
            break;
          }
          await inspect(object, group);
          if (slice.due()) await slice.yield();
        }
      }
    }
    return {
      kind,
      items,
      counts: total,
      countsByKind,
      skippedRemote,
      failed,
      failedCount,
      notFound: p.ids?.filter(id => !found.has(id)) ?? [],
      complete,
      ...(truncated ? { truncated: true } : {}),
    };
  };
