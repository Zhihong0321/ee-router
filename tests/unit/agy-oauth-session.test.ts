import { EventEmitter } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough, type Readable } from 'node:stream';
import type { ChildProcessByStdio } from 'node:child_process';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AgyOAuthSessionManager } from '../../src/providers/agy-oauth-session.js';

const managers: AgyOAuthSessionManager[] = [];
const temporaryRoots: string[] = [];

function fakeChild(): ChildProcessByStdio<null, Readable, Readable> {
  const child = new EventEmitter() as unknown as ChildProcessByStdio<null, Readable, Readable>;
  Object.assign(child, {
    stdin: null,
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    kill: vi.fn(() => true),
    pid: 1234,
  });
  return child;
}

afterEach(async () => {
  for (const manager of managers.splice(0)) {
    const session = manager.status();
    if (session && ['starting', 'waiting', 'completing'].includes(session.state)) {
      manager.cancel(session.session_id);
    }
  }
  await Promise.all(temporaryRoots.splice(0).map(root => rm(root, { recursive: true, force: true })));
  vi.restoreAllMocks();
});

describe('AgyOAuthSessionManager', () => {
  it('exposes only the consent URL with stdin closed for browser callback', async () => {
    const home = await mkdtemp(join(tmpdir(), 'eter-agy-oauth-manager-'));
    temporaryRoots.push(home);
    const child = fakeChild();
    const spawnProcess = vi.fn(() => {
      queueMicrotask(() => {
        child.stderr.write(
          'Authentication required. Visit https://accounts.google.com/o/oauth2/auth?state=test-state&code_challenge=test-challenge\n' +
          'Waiting for authentication...\n',
        );
      });
      return child;
    });
    const manager = new AgyOAuthSessionManager({
      binary: '/usr/local/bin/agy',
      home,
      spawnProcess,
      diagnosticStore: null,
    });
    managers.push(manager);

    const started = await manager.start();
    expect(started).toMatchObject({
      state: 'waiting',
      code_required: false,
      secret_values_returned: false,
    });
    expect(started.auth_url).toContain('https://accounts.google.com/');
    expect(spawnProcess).toHaveBeenCalledWith(
      '/usr/local/bin/agy',
      expect.arrayContaining(['-p', '--model', 'gemini-3.6-flash-low']),
      expect.objectContaining({ shell: false, stdio: ['ignore', 'pipe', 'pipe'] }),
    );

    expect(() => manager.submitCode(started.session_id, '4/0-safe-test-code')).toThrow(
      'Authorization codes are disabled',
    );

    child.emit('close', 0, null);
    expect(manager.status(started.session_id)).toMatchObject({
      state: 'authenticated',
      message: 'Antigravity OAuth completed successfully',
    });
  });

  it('rejects arbitrary input and prevents concurrent OAuth processes', async () => {
    const home = await mkdtemp(join(tmpdir(), 'eter-agy-oauth-manager-'));
    temporaryRoots.push(home);
    const child = fakeChild();
    const spawnProcess = vi.fn(() => {
      queueMicrotask(() => {
        child.stderr.write('https://accounts.google.com/o/oauth2/auth?state=another-test\n');
      });
      return child;
    });
    const manager = new AgyOAuthSessionManager({
      home,
      spawnProcess,
      diagnosticStore: null,
    });
    managers.push(manager);

    const started = await manager.start();
    expect(() => manager.submitCode(started.session_id, 'bad code; rm -rf /')).toThrow(
      'Authorization codes are disabled',
    );
    await expect(manager.start()).rejects.toThrow('already active');
  });
});
