import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

import { expect, it } from 'vitest';

import { dispatchTool, type DispatchContext } from '../packages/mcp/src/dispatch.js';
import { configureServerPerf, serverPerfStats } from '../packages/mcp/src/perf.js';
import { Relay } from '../packages/mcp/src/relay/relay.js';
import { createHostYield } from '../packages/plugin/protocol/host-yield.js';
import { dispatchSandboxMessage } from '../packages/plugin/src/dispatcher.js';
import { perfStats } from '../packages/plugin/src/perf.js';
import { RelayClient } from '../packages/plugin/ui/relay/client.js';
import { createToolBridge } from '../packages/plugin/ui/sandbox/tool-bridge.js';
import { ErrorCode, type RpcResponse } from '../packages/shared/src/index.js';

it('correlates real relay → UI → sandbox perf ids across concurrent calls and dispatch retries', async () => {
  // Bind only an ephemeral port; no election, existing relay, Figma connection or child process.
  const server = createServer();
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  const relay = new Relay({ server, serverVersion: '0.8.0' });
  const client = new RelayClient({ ports: [port], clientVersion: '0.8.0', WS: WebSocket });
  let emit: (raw: unknown) => void = () => {};
  const completions = new Map<string, () => void>();
  const delivered: string[] = [];
  const bridge = createToolBridge({
    subscribe: cb => {
      emit = cb;
      return () => {};
    },
    postMessage: raw => {
      delivered.push(raw.id);
      // Host-yield shares the message channel, but has a different tag and numeric ids.
      emit(createHostYield(1, 'yield-resume'));
      void dispatchSandboxMessage({
        raw,
        editorType: 'figma',
        handlers: {
          read: params =>
            new Promise(resolve => {
              const key = (params as { key: string }).key;
              completions.set(key, () => resolve({ key }));
            }),
        },
      }).then(outcome => {
        if (outcome.kind === 'reply') emit(outcome.reply);
        return undefined;
      });
    },
  });
  client.setToolHandler(bridge.handler);
  configureServerPerf(true);
  serverPerfStats({ reset: true });
  perfStats({ enabled: true, reset: true });
  const forwarded: string[] = [];
  const context = {
    node: { isConflicted: () => false, isLeader: () => false, onRoleChange: () => () => {} },
    follower: {
      sendRpc: async (method: string, params: unknown, requestId: string): Promise<RpcResponse> => {
        forwarded.push(requestId);
        const result = await relay.sendRequest(
          method,
          params,
          2000,
          undefined,
          undefined,
          requestId,
        );
        // Simulate loss of a response after sandbox completion. The real dispatch retry loop
        // creates the next UUID, while both completed attempts retain their own perf row.
        if ((params as { key: string }).key === 'retry' && forwarded.length === 3) {
          return { kind: 'err', requestId, code: ErrorCode.Internal, message: 'transport failed' };
        }
        return { kind: 'ok', requestId, result };
      },
    },
  } as unknown as DispatchContext;
  try {
    await client.connect();
    expect(client.getState().status).toBe('connected');
    const a = dispatchTool(context, 'read', { key: 'a' });
    const b = dispatchTool(context, 'read', { key: 'b' });
    await expect.poll(() => completions.size).toBe(2);
    expect(bridge.pendingCount()).toBe(2);
    completions.get('b')!();
    await expect(b).resolves.toEqual({ key: 'b' });
    expect(bridge.pendingCount()).toBe(1);
    completions.get('a')!();
    await expect(a).resolves.toEqual({ key: 'a' });

    const retry = dispatchTool(context, 'read', { key: 'retry' }, { retryDelayMs: 0 });
    await expect.poll(() => delivered.length).toBe(3);
    completions.get('retry')!();
    await expect.poll(() => delivered.length).toBe(4);
    completions.get('retry')!();
    await expect(retry).resolves.toEqual({ key: 'retry' });

    const serverCalls = serverPerfStats({});
    const pluginCalls = perfStats({}).calls;
    expect(new Set(forwarded).size).toBe(4);
    expect(delivered).toEqual(forwarded);
    expect(serverCalls).toHaveLength(4);
    expect(pluginCalls).toHaveLength(4);
    expect(serverCalls.map(c => c.requestId).toSorted()).toEqual(
      pluginCalls.map(c => c.id).toSorted(),
    );
    expect(serverCalls.filter(c => !c.success)).toHaveLength(1);
    expect(bridge.pendingCount()).toBe(0);
  } finally {
    configureServerPerf(false);
    serverPerfStats({ reset: true });
    perfStats({ enabled: false, reset: true });
    client.disconnect();
    bridge.dispose();
    await relay.stop();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});
