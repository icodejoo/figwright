import { z } from 'zod';

import type { ToolSpec } from './spec.js';
export const getPerfStatsTool: ToolSpec = {
  name: 'get_perf_stats',
  kind: 'read',
  description:
    'Diagnose slow reads. Recording is off by default; enabled:true starts recording, enabled:false stops. Data exists only during the current plugin run and is cleared when the plugin restarts. The get_perf_stats diagnostic call itself is excluded. Returns calls (newest completed first), summary per tool over the returned calls, bufferSize (up to 200 completed calls), since (epoch ms), enabled. All durations are ms. Each call has id (bridge request id), tool, arrivedAt/startedAt (sandbox epoch ms), queueMs (start minus arrival; excludes host message queue before delivery), handlerMs (wall time), byId {count,totalMs,maxMs} (native getNodeByIdAsync attempts including fallback), pageLoadMs (explicit loads; implicit loads remain in byId), yieldCount/yieldMs (cooperative host waits), traversalMs/serializationMs (instrumented traversal/serialization wall time, including nested waits), success/error (first 120 characters). Stages may overlap; do not sum them. summary has count,p50Ms,p95Ms,maxMs of handlerMs and byIdMs total. reset clears the entire plugin buffer after reading. serverCalls separately reports this MCP process tool totalMs, including local processing and transport; no cross-process request correlation is claimed.',
  inputSchema: z.object({
    limit: z.number().int().min(1).max(200).default(50),
    tool: z.string().optional(),
    reset: z.boolean().optional(),
    enabled: z.boolean().optional(),
  }),
};
export const loadPageTool: ToolSpec = {
  name: 'load_page',
  kind: 'read',
  description:
    'Preload a page without editing the document. In dynamic-page mode reading nodes on an unloaded page triggers Figma loading; large files may exceed Figma internal 10-second timeout. Use this tool first to load and measure the wait. pageId omitted means current page; all:true loads pages sequentially with a cooperative host yield between pages, never one loadAllPagesAsync call. pageId and all:true are mutually exclusive. limit defaults to 10, maximum 100 pages per call; it cannot cancel an in-flight Figma load. Returns {pages:[{pageId,name,loadMs,nodeCount?,error?}],totalPages,remaining,success,stoppedBy?}. loadMs is wall milliseconds; nodeCount is immediate children only. Stops on first failure and returns the original Figma error text with elapsed loadMs and prior page results. After 100 seconds of wall time (including host yields), stops starting new pages and returns completed results with remaining and stoppedBy:"time budget"; success still describes the returned page results. This is a soft start budget: an in-flight load or host yield cannot be interrupted and may still exceed the 120-second sandbox timeout, in which case partial results cannot be returned. Loading all pages can be slow.',
  inputSchema: z.object({
    pageId: z.string().optional(),
    all: z.boolean().optional(),
    limit: z.number().int().min(1).max(100).default(10),
  }),
};
