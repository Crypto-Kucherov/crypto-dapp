import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { GitHubClient } from '../src/github.js';
import { main, parseArgs } from '../src/index.js';

function publicClient() {
  return new GitHubClient({ fetchImpl: async url => {
    if (url.pathname === '/users/alice') return Response.json({ login: 'alice', type: 'User', name: 'Alice',
      html_url: 'https://github.com/alice', public_repos: 0, created_at: '2023-01-01T00:00:00Z' });
    if (url.pathname.endsWith('/repos')) return Response.json([]);
    if (url.pathname === '/search/issues') return Response.json({ total_count: 0, incomplete_results: false });
    throw new Error(`Unexpected request ${url}`);
  } });
}

function outputs(client = publicClient()) {
  const captured = { stdout: '', stderr: '' };
  return { captured, options: { client,
    stdout: { write: text => { captured.stdout += text; } },
    stderr: { write: text => { captured.stderr += text; } },
  } };
}

test('CLI validation rejects ambiguous and invalid flags', () => {
  for (const args of [[], ['a', 'b'], ['a', '--format', 'xml'], ['a', '--out'], ['a', '--bad'],
    ['a', '--max-repos', '0'], ['a', '--max-repos', '51'], ['a', '--max-repos', '1.2'],
    ['a', '--format', 'json', '--format', 'markdown']]) assert.throws(() => parseArgs(args));
  assert.equal(parseArgs(['alice', '--format', 'json']).format, 'json');
});

test('help works as an executable without network access', () => {
  const result = spawnSync(process.execPath, ['src/index.js', '--help'], { encoding: 'utf8' });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /Usage:/);
  assert.equal(result.stderr, '');
});

test('JSON output is machine-readable without stdout progress text', async () => {
  const { options, captured } = outputs();
  assert.equal(await main(['alice', '--format', 'json'], options), 0);
  const report = JSON.parse(captured.stdout);
  assert.equal(report.profile.login, 'alice');
  assert.equal(report.schemaVersion, 1);
  assert.equal(captured.stderr, '');
});

test('CLI passes an explicit end date to collection and rejects it in offline modes', async () => {
  const { options, captured } = outputs();
  assert.equal(await main(['alice', '--since', '2024-02-01', '--until', '2024-02-29', '--format', 'json'], options), 0);
  const report = JSON.parse(captured.stdout);
  assert.equal(report.scope.until, '2024-02-29T23:59:59.999Z');
  assert.ok(report.generatedAt > report.scope.until);
  for (const args of [['alice', '--until'], ['alice', '--until', '2024-01-01', '--until', '2024-02-01'],
    ['--from', 'a.json', '--until', '2024-02-29'], ['--compare', 'a.json', 'b.json', '--until', '2024-02-29']]) {
    assert.throws(() => parseArgs(args));
  }
});

test('profile collection supports standalone HTML on stdout', async () => {
  const { options, captured } = outputs();
  assert.equal(await main(['alice', '--format', 'html'], options), 0);
  assert.ok(captured.stdout.startsWith('<!doctype html>'));
  assert.match(captured.stdout, /Public profile snapshot/);
  assert.match(captured.stdout, /No public repositories listed/);
  assert.equal(captured.stderr, '');
});

test('writes a new snapshot and refuses to overwrite it', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'github-report-test-'));
  try {
    const path = join(dir, 'nested', 'report.json');
    const first = outputs();
    assert.equal(await main(['alice', '--format', 'json', '--out', path], first.options), 0);
    assert.equal(first.captured.stdout, '');
    assert.equal(JSON.parse(await readFile(path, 'utf8')).profile.login, 'alice');
    await writeFile(path, 'existing snapshot');
    const second = outputs();
    assert.equal(await main(['alice', '--out', path], second.options), 1);
    assert.match(second.captured.stderr, /already exists/);
    assert.equal(await readFile(path, 'utf8'), 'existing snapshot');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('missing user fails clearly rather than fabricating an empty profile', async () => {
  const client = new GitHubClient({ fetchImpl: async () => new Response('', { status: 404 }) });
  const { options, captured } = outputs(client);
  assert.equal(await main(['alice'], options), 1);
  assert.equal(captured.stdout, '');
  assert.match(captured.stderr, /not found/);
});

test('existing output files, directories and dangling links fail before any API request', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'output-preflight-'));
  try {
    const file = join(dir, 'saved.md');
    const dangling = join(dir, 'dangling.md');
    await writeFile(file, 'keep this report');
    await symlink(join(dir, 'missing.md'), dangling);
    for (const path of [file, dir, dangling, join(file, 'child.md')]) {
      const client = publicClient();
      const { options, captured } = outputs(client);
      assert.equal(await main(['alice', '--out', path], options), 1);
      assert.equal(client.requests, 0);
      assert.equal(captured.stdout, '');
      assert.match(captured.stderr, path.endsWith('child.md') ? /ENOTDIR/ : /already exists/);
    }
    assert.equal(await readFile(file, 'utf8'), 'keep this report');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('a destination created during collection is still protected by the final write', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'output-race-'));
  try {
    const file = join(dir, 'report.md');
    const client = publicClient();
    const fetch = client.fetchImpl;
    client.fetchImpl = async (...args) => {
      if (args[0].pathname === '/users/alice') await writeFile(file, 'another process wrote this');
      return fetch(...args);
    };
    const { options, captured } = outputs(client);
    assert.equal(await main(['alice', '--out', file], options), 1);
    assert.match(captured.stderr, /already exists/);
    assert.equal(await readFile(file, 'utf8'), 'another process wrote this');
  } finally { await rm(dir, { recursive: true, force: true }); }
});
