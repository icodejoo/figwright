import { TimeSlice } from '../cooperative.js';
import type { SandboxToolHandler } from '../dispatcher.js';
import { perfFor } from '../perf.js';
import { consumerLimit, consumerLocation } from './consumer-location.js';

/* eslint-disable no-await-in-loop -- cooperate while projecting a potentially large consumer list */

export const createGetStyleConsumersHandler =
  (figmaCtx: typeof figma): SandboxToolHandler =>
  async params => {
    const p = params as { styleId: string; limit?: number };
    const limit = consumerLimit(p.limit);
    const style = await figmaCtx.getStyleByIdAsync(p.styleId);
    if (style === null) throw new Error(`get_style_consumers: style ${p.styleId} not found`);
    await figmaCtx.loadAllPagesAsync();
    const found = await style.getStyleConsumersAsync();
    const slice = new TimeSlice(perfFor(figmaCtx));
    const consumers = [];
    for (const consumer of found) {
      if (consumers.length === limit) break;
      if (slice.due()) await slice.yield();
      consumers.push({
        ...(await consumerLocation(consumer.node, slice)),
        fields: [...consumer.fields],
      });
    }
    return { styleId: style.id, consumers, truncated: found.length > limit };
  };
