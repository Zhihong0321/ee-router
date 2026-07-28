import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AgyOAuthSessionManager } from '../../src/providers/agy-oauth-session.js';

const managers: AgyOAuthSessionManager[] = [];

function fakeChild(): ChildProcessWithoutNullStreams {
  const child = new EventEmitter() as unknown as ChildProcessWithoutNullStreams;
  Object.assign(child, {
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    kill: vi.fn(() => true),
    pid: 1234,
  });
  return child;
}

afterEach(() => {
  for (const manager of managers.splice(0)) {
    const session = manager.status();
    if (session && ['starting', 'waiting', 'completing'].includes(session.state)) {
      manager.cancel(session.session_id);
    }
  }
  vi.restoreAllMocks();
});

describe('AgyOAuthSessionManager', () => {
  it('exposes only the consent URL and accepts a bounded code through stdin', async () => {
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
      home: '/storage',
      spawnProcess,
      diagnosticStore: null,
    });
    managers.push(manager);

    const started = await manager.start();
    expect(started).toMatchObject({
      state: 'waiting',
      code_required: true,
      secret_values_returned: false,
    });
    expect(started.auth_url).toContain('https://accounts.google.com/');
    expect(spawnProcess).toHaveBeenCalledWith(
      '/usr/bin/script',
      expect.arrayContaining(['-qefc', '/usr/local/bin/agy', '/dev/null']),
      expect.objectContaining({ shell: false, stdio: ['pipe', 'pipe', 'pipe'] }),
    );

    let stdin = '';
    child.stdin.on('data', chunk => {
      stdin += chunk.toString();
    });
    const submitted = manager.submitCode(started.session_id, '4/0-safe-test-code');
    expect(submitted.state).toBe('completing');
    expect(JSON.stringify(submitted)).not.toContain('4/0-safe-test-code');
    expect(stdin).toBe('4/0-safe-test-code\n');

    child.emit('close', 0, null);
    expect(manager.status(started.session_id)).toMatchObject({
      state: 'authenticated',
      message: 'Antigravity OAuth completed successfully',
    });
  });

  it('rejects arbitrary input and prevents concurrent OAuth processes', async () => {
    const child = fakeChild();
    const spawnProcess = vi.fn(() => {
      queueMicrotask(() => {
        child.stderr.write('https://accounts.google.com/o/oauth2/auth?state=another-test\n');
      });
      return child;
    });
    const manager = new AgyOAuthSessionManager({
      spawnProcess,
      diagnosticStore: null,
    });
    managers.push(manager);

    const started = await manager.start();
    expect(() => manager.submitCode(started.session_id, 'bad code; rm -rf /')).toThrow(
      'Invalid OAuth authorization code format',
    );
    await expect(manager.start()).rejects.toThrow('already active');
  });
});
