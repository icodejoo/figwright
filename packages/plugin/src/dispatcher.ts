import { ErrorCode } from '@figwright/shared';

import {
  createToolError,
  createToolResult,
  isPluginBridgeMessage,
  type PluginToolError,
  type PluginToolResult,
} from '../protocol/bridge.js';
import { withEditorContext } from '../protocol/editor-context.js';
import { beginPerf, finishPerf, type PerfCall } from './perf.js';

export type SandboxToolHandler = (params: unknown) => unknown | Promise<unknown>;
export type SandboxHandlers = Record<string, SandboxToolHandler>;

export interface DispatchInput {
  raw: unknown;
  scopedHandlers?: (call: PerfCall) => SandboxHandlers;
  handlers: SandboxHandlers;
  /**
   * `figma.editorType`, so a handler error can name the editor it was raised in. Required rather
   * than optional on purpose: an optional field is exactly the kind of claim that gets silently
   * dropped at one call site and never noticed (see `editor-context.ts`).
   */
  editorType: string;
  log?: (msg: string) => void;
}

export type DispatchOutcome =
  | { kind: 'reply'; reply: PluginToolResult | PluginToolError }
  | { kind: 'ignore' };

export const dispatchSandboxMessage = async (input: DispatchInput): Promise<DispatchOutcome> => {
  if (!isPluginBridgeMessage(input.raw)) return { kind: 'ignore' };
  if (input.raw.kind !== 'tool-call') return { kind: 'ignore' };

  const { id, method, params } = input.raw;
  const call = beginPerf(id, method);
  const handler = (call && input.scopedHandlers ? input.scopedHandlers(call) : input.handlers)[
    method
  ];
  const log = input.log ?? ((): void => {});

  if (handler === undefined) {
    if (call) finishPerf(call, `no sandbox handler (method=${method})`);
    log(`[sandbox] no handler for ${method}`);
    return {
      kind: 'reply',
      reply: createToolError({
        id,
        code: ErrorCode.MethodNotFound,
        message: `no sandbox handler (method=${method})`,
      }),
    };
  }

  try {
    if (call) {
      call.startedAt = Date.now();
      call.dispatchOverheadMs = call.startedAt - call.arrivedAt;
    }
    const result = await handler(params);
    if (call) {
      const failure =
        method === 'load_page' && (result as { success?: boolean }).success === false
          ? (result as { pages: { error?: string }[] }).pages.find(page => page.error !== undefined)
              ?.error
          : undefined;
      finishPerf(call, failure);
    }
    return { kind: 'reply', reply: createToolResult({ id, result }) };
  } catch (err) {
    const raised = err instanceof Error ? err.message : String(err);
    if (call) finishPerf(call, raised);
    log(`[sandbox] handler ${method} threw: ${raised}`);
    // FigJam and Dev Mode reject whole classes of call that Figma Design accepts, and the API's own
    // error rarely says which editor it came from. Naming it here is what lets an agent re-plan
    // instead of retrying the same call.
    return {
      kind: 'reply',
      reply: createToolError({
        id,
        code: ErrorCode.Internal,
        message: withEditorContext(raised, input.editorType),
      }),
    };
  }
};
