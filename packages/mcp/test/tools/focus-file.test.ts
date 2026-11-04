import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { bindFileTarget, clearFileTarget } from '../../src/routing/target.js';
import { handleFocusFile } from '../../src/tools/focus-file.js';
import type { ConnectedFile } from '../../src/tools/list-files.js';
import { fitInstanceMains } from '../../src/tools/result-budget.js';

vi.mock('node:child_process', () => ({ spawn: vi.fn<typeof spawn>() }));
afterEach(() => {
  clearFileTarget();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});
const file = (key: string | null = 'SessionKey123', routed = true): ConnectedFile => ({
  sessionId: 's',
  fileKey: key,
  fileName: 'Design',
  currentPage: null,
  pluginVersion: '0.8.0',
  routed,
  bound: false,
});
const deps = (key: string | null = 'SessionKey123') => ({
  platform: 'win32',
  now: () => 0,
  list: vi.fn<() => Promise<{ files: ConnectedFile[] }>>(async () => ({ files: [file(key)] })),
  sleep: vi.fn<(ms: number) => Promise<void>>(async () => {}),
  launch: vi.fn<(key: string) => Promise<void>>(async () => {}),
  config: vi.fn<() => Promise<Record<string, string>>>(async () => ({ Design: 'ConfigKey123' })),
});

describe('focus_file', () => {
  it('prefers explicit key, then session, then config, and defaults to the bound file', async () => {
    const d = deps();
    await handleFocusFile({ fileName: 'Design', fileKey: 'ExplicitKey123' }, d);
    expect(d.launch).toHaveBeenLastCalledWith('ExplicitKey123');
    expect(d.config).not.toHaveBeenCalled();
    await handleFocusFile({ fileName: 'Design' }, d);
    expect(d.launch).toHaveBeenLastCalledWith('SessionKey123');
    await bindFileTarget(
      async () => [
        { id: 's', fileName: 'Design', pageName: null, lastActivityAt: 1, pluginVersion: '0.8.0' },
      ],
      { sessionId: 's' },
    );
    const configured = deps(null);
    expect(await handleFocusFile({}, configured)).toMatchObject({
      focused: true,
      fileName: 'Design',
    });
    expect(configured.launch).toHaveBeenCalledWith('ConfigKey123');
  });
  it('reads FIGWRIGHT_FILES_JSON and treats a missing file as no configured key', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'figwright-focus-'));
    const configPath = join(dir, 'files.json');
    const { config: _config, ...options } = deps(null);
    vi.stubEnv('FIGWRIGHT_FILES_JSON', configPath);
    try {
      await expect(handleFocusFile({ fileName: 'Design' }, options)).rejects.toThrow(
        'invalid or missing fileKey',
      );
      await writeFile(configPath, JSON.stringify({ Design: 'LocalFileKey123' }));
      expect(await handleFocusFile({ fileName: 'Design' }, options)).toMatchObject({
        focused: true,
      });
      expect(options.launch).toHaveBeenCalledWith('LocalFileKey123');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
  it('uses the bound session even when another open file has the same name', async () => {
    await bindFileTarget(
      async () => [
        { id: 's', fileName: 'Design', pageName: null, lastActivityAt: 1, pluginVersion: '0.8.0' },
      ],
      { sessionId: 's' },
    );
    const d = deps();
    d.list.mockResolvedValue({
      files: [file(), { ...file('OtherFileKey123'), sessionId: 'other', routed: false }],
    });
    expect(await handleFocusFile({}, d)).toMatchObject({ focused: true });
    expect(d.launch).toHaveBeenCalledWith('SessionKey123');
    await expect(handleFocusFile({ fileName: 'Design' }, d)).rejects.toThrow('ambiguous fileName');
  });
  it('rejects invalid keys from all sources and unsupported platforms', async () => {
    for (const key of ['bad&calc.exe', 'short', 'a'.repeat(41), 'a/b123456789']) {
      const d = deps();
      await expect(handleFocusFile({ fileKey: key }, d)).rejects.toThrow('invalid fileKey');
      expect(d.launch).not.toHaveBeenCalled();
    }
    const d = deps('bad');
    await expect(handleFocusFile({ fileName: 'Design' }, d)).rejects.toThrow(
      'invalid or missing fileKey',
    );
    const c = deps(null);
    c.config.mockResolvedValue({ Design: 'bad' });
    await expect(handleFocusFile({ fileName: 'Design' }, c)).rejects.toThrow(
      'invalid or missing fileKey',
    );
    await expect(handleFocusFile({}, { ...deps(), platform: 'linux' })).rejects.toThrow(
      'only Windows',
    );
  });
  it('spawns cmd with separate arguments and no shell option', async () => {
    const child = Object.assign(new EventEmitter(), { unref: vi.fn<() => void>() });
    vi.mocked(spawn).mockImplementation(() => {
      queueMicrotask(() => child.emit('spawn'));
      return child as never;
    });
    const { launch: _launch, ...options } = deps();
    await handleFocusFile({ fileName: 'Design' }, options);
    expect(spawn).toHaveBeenCalledWith(
      'cmd.exe',
      ['/c', 'start', '', 'figma://file/SessionKey123'],
      { detached: true, stdio: 'ignore' },
    );
    expect(child.unref).toHaveBeenCalledOnce();
  });
  it('polls with injected list and sleep for success and timeout', async () => {
    const d = deps();
    d.list
      .mockResolvedValueOnce({ files: [file(null, false)] })
      .mockResolvedValueOnce({ files: [file(null, false)] })
      .mockResolvedValue({ files: [file(null, true)] });
    expect(await handleFocusFile({ fileName: 'Design' }, d)).toMatchObject({
      focused: true,
      waitedMs: 500,
    });
    expect(d.sleep).toHaveBeenCalledWith(500);
    const t = deps();
    t.list.mockResolvedValue({ files: [file(null, false)] });
    expect(await handleFocusFile({ fileName: 'Design' }, t)).toEqual({
      focused: false,
      hint: 'The deep link was sent but the tab did not come to the front — check Figma is running and the fileKey is right.',
    });
    expect(t.sleep).toHaveBeenCalledTimes(12);
  });
  it('trims mapping rows without changing aggregates', () => {
    const result = {
      instances: Array.from({ length: 100 }, () => ({ instanceId: 'x'.repeat(100) })),
      counts: { instances: 100 },
      distinctMains: [{ mainId: 'm', count: 100 }],
    };
    const fitted = fitInstanceMains(result, 1500);
    expect(fitted.truncated).toBe(true);
    expect(fitted.instances.length).toBeLessThan(100);
    expect(fitted.counts).toEqual(result.counts);
    expect(fitted.distinctMains).toEqual(result.distinctMains);
  });
});
