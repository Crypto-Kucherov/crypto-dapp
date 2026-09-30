import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { main, parseArgs } from '../src/index.js';
import { GitHubClient } from '../src/github.js';

const metadata = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));

test('version diagnostics run offline and match package metadata', async () => {
  for (const flag of ['--version', '-v']) {
    let output = '';
    const result = await main([flag], {
      client: { get() { assert.fail('version must not fetch GitHub'); } },
      stdout: { write(value) { output += value; } },
      stderr: { write() { assert.fail('version must not emit errors'); } },
    });
    assert.equal(result, 0);
    assert.equal(output, `${metadata.version}\n`);
  }
});

test('the executable resolves its version independently of the working directory', () => {
  const script = fileURLToPath(new URL('../src/index.js', import.meta.url));
  const result = spawnSync(process.execPath, [script, '--version'], { cwd: tmpdir(), encoding: 'utf8' });
  assert.equal(result.status, 0);
  assert.equal(result.stdout, `${metadata.version}\n`);
  assert.equal(result.stderr, '');
});

test('version mode rejects collection or output arguments instead of ignoring them', () => {
  for (const args of [['--version', '--out', 'report.md'], ['alice', '--version'],
    ['--from', 'profile.json', '-v'], ['--version', '--version']]) assert.throws(() => parseArgs(args));
});

test('GitHub request identification uses the installed package version', async () => {
  let headers;
  const client = new GitHubClient({ fetchImpl: async (_url, options) => {
    headers = options.headers;
    return Response.json({ login: 'alice' });
  } });
  await client.get('/users/alice');
  assert.equal(headers['User-Agent'], `crypto-dapp-github-report/${metadata.version}`);
});
