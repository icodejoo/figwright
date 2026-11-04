import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { z } from 'zod';

import { getFileTarget } from '../routing/target.js';
import type { ConnectedFile } from './list-files.js';
import type { ToolSpec } from './spec.js';

export const focusFileTool: ToolSpec = {
  name: 'focus_file',
  kind: 'read',
  serverOnly: true,
  description:
    'Windows only: bring a Figma desktop file tab and the Figma window to the foreground, stealing keyboard focus. fileName defaults to the current use_file claim. fileKey takes priority over the session fileKey, then local config. fileKey is the segment in figma.com/design/<fileKey>/... and must contain 10–40 ASCII letters or digits. Config path is FIGWRIGHT_FILES_JSON or ~/.figwright/files.json, formatted as {"file name":"AbCdEf123456"}. Sends figma://file/<fileKey> and polls list_files routed state for up to 6 seconds. Returns {focused:true,fileName,waitedMs} or {focused:false,hint} on timeout.',
  inputSchema: z.object({ fileName: z.string().optional(), fileKey: z.string().optional() }),
};

interface FocusDependencies {
  list: () => Promise<{ files: ConnectedFile[] }>;
  sleep?: (ms: number) => Promise<void>;
  launch?: (key: string) => Promise<void>;
  config?: () => Promise<unknown>;
  platform?: string;
  now?: () => number;
}

const readConfig = async (): Promise<unknown> => {
  try {
    return JSON.parse(
      await readFile(
        process.env.FIGWRIGHT_FILES_JSON ?? join(homedir(), '.figwright', 'files.json'),
        'utf8',
      ),
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {};
    throw error;
  }
};

const launchFile = (key: string): Promise<void> =>
  new Promise((resolve, reject) => {
    const child = spawn('cmd.exe', ['/c', 'start', '', `figma://file/${key}`], {
      detached: true,
      stdio: 'ignore',
    });
    child.once('error', reject);
    child.once('spawn', () => {
      child.unref();
      resolve();
    });
  });

export const handleFocusFile = async (
  args: { fileName?: string; fileKey?: string },
  deps: FocusDependencies,
) => {
  if ((deps.platform ?? process.platform) !== 'win32')
    throw new Error('focus_file: only Windows is supported');
  const target = getFileTarget();
  const fileName = args.fileName ?? target?.fileName ?? undefined;
  if (args.fileKey !== undefined && !/^[A-Za-z0-9]{10,40}$/.test(args.fileKey))
    throw new Error('focus_file: invalid fileKey; expected 10–40 ASCII letters or digits');
  const { files } = await deps.list();
  const boundSession =
    args.fileName === undefined && target
      ? files.find(file => file.sessionId === target.sessionId)
      : undefined;
  const matches = files.filter(file =>
    args.fileKey !== undefined
      ? file.fileKey === args.fileKey
      : boundSession
        ? file.sessionId === boundSession.sessionId
        : file.fileName === fileName,
  );
  if (matches.length > 1 && args.fileKey === undefined)
    throw new Error('focus_file: ambiguous fileName; provide fileKey');
  const session = matches[0];
  let key: unknown = args.fileKey ?? (session?.fileKey || undefined);
  if (key === undefined) {
    const config = await (deps.config ?? readConfig)();
    key =
      fileName !== undefined &&
      config &&
      typeof config === 'object' &&
      Object.hasOwn(config, fileName)
        ? (config as Record<string, unknown>)[fileName]
        : undefined;
  }
  if (typeof key !== 'string' || !/^[A-Za-z0-9]{10,40}$/.test(key))
    throw new Error(
      'focus_file: invalid or missing fileKey; expected 10–40 ASCII letters or digits; supply fileKey or configure files.json',
    );
  await (deps.launch ?? launchFile)(key);
  const sleep = deps.sleep ?? (ms => new Promise(resolve => setTimeout(resolve, ms)));
  const now = deps.now ?? Date.now;
  const startedAt = now();
  for (let waitedMs = 0; waitedMs <= 6000; waitedMs += 500) {
    const remaining = 6000 - Math.max(waitedMs, now() - startedAt);
    if (remaining < 0) break;
    if (waitedMs > 0) {
      // eslint-disable-next-line no-await-in-loop -- sequential polling must wait before the next file listing
      await sleep(Math.min(500, Math.max(0, 6000 - (now() - startedAt))));
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    // eslint-disable-next-line no-await-in-loop -- bound each probe by the remaining foreground wait budget
    const current = await Promise.race([
      deps.list(),
      new Promise<undefined>(resolve => {
        timer = setTimeout(() => resolve(undefined), Math.max(0, 6000 - (now() - startedAt)));
      }),
    ]).finally(() => clearTimeout(timer));
    if (!current) break;
    const focused = current.files.find(
      file =>
        file.routed &&
        (file.fileKey
          ? file.fileKey === key
          : session
            ? file.sessionId === session.sessionId
            : file.fileName === fileName),
    );
    if (focused)
      return {
        focused: true,
        fileName: focused.fileName ?? fileName,
        waitedMs: Math.max(waitedMs, now() - startedAt),
      };
  }
  return {
    focused: false,
    hint: 'The deep link was sent but the tab did not come to the front — check Figma is running and the fileKey is right.',
  };
};
