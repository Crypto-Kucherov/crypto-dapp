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
    if (url.pathname === '/users/alice') return Response.json({ id: 123, login: 'alice', type: 'User', name: 'Alice',
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

test('collection can signal incomplete API evidence while producing its report', async () => {
  const complete = outputs();
  assert.equal(await main(['alice', '--fail-on-incomplete'], complete.options), 0);
  for (const strict of [false, true]) {
    const client = publicClient();
    const fetch = client.fetchImpl;
    client.fetchImpl = async (...args) => args[0].pathname === '/search/issues' ? new Response('', { status: 503 }) : fetch(...args);
    const { captured, options } = outputs(client);
    const args = ['alice', '--format', 'json', ...(strict ? ['--fail-on-incomplete'] : [])];
    assert.equal(await main(args, options), strict ? 2 : 0);
    assert.equal(JSON.parse(captured.stdout).activity.pullRequests.count, null);
    if (strict) assert.match(captured.stderr, /exit code 2/);
  }
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

test('request timeout accepts bounded seconds only in collection mode', () => {
  assert.equal(parseArgs(['alice']).timeoutSeconds, 15);
  for (const seconds of ['1', '45', '120']) assert.equal(parseArgs(['alice', '--timeout', seconds]).timeoutSeconds, Number(seconds));
  for (const value of ['0', '-1', '121', '1.5', 'Infinity', '1e2', 'ten']) {
    assert.throws(() => parseArgs(['alice', '--timeout', value]), /--timeout/);
  }
  for (const args of [['alice', '--timeout'], ['alice', '--timeout', '1', '--timeout', '2'],
    ['--from', 'a.json', '--timeout', '30'], ['--compare', 'a.json', 'b.json', '--timeout', '30']]) {
    assert.throws(() => parseArgs(args), /--timeout/);
  }
});

test('CLI uses the selected timeout for every request', async t => {
  const milliseconds = [];
  const original = AbortSignal.timeout;
  t.mock.method(AbortSignal, 'timeout', value => {
    milliseconds.push(value);
    return original.call(AbortSignal, value);
  });
  t.mock.method(globalThis, 'fetch', publicClient().fetchImpl);
  const { options, captured } = outputs();
  delete options.client;
  assert.equal(await main(['alice', '--timeout', '45', '--format', 'json'], options), 0);
  assert.equal(JSON.parse(captured.stdout).profile.login, 'alice');
  assert.equal(milliseconds.length, 5);
  assert.ok(milliseconds.every(value => value === 45000));
});

test('output extensions select formats in every mode unless explicitly overridden', () => {
  for (const mode of [['alice'], ['--from', 'saved.json'], ['--compare', 'a.json', 'b.json']]) {
    for (const [path, expected] of [['report.json', 'json'], ['report.JSON', 'json'],
      ['report.html', 'html'], ['report.HTM', 'html'], ['report.md', 'markdown'],
      ['report', 'markdown'], ['report.json.txt', 'markdown'], ['.json', 'markdown']]) {
      assert.equal(parseArgs([...mode, '--out', path]).format, expected, path);
      assert.equal(parseArgs([...mode, '--out', path, '--format', 'markdown']).format, 'markdown');
      assert.equal(parseArgs([...mode, '--format', 'json', '--out', path]).format, 'json');
    }
    assert.equal(parseArgs(mode).format, 'markdown');
  }
  assert.throws(() => parseArgs(['alice', '--out', 'report.json', '--format', 'yaml']), /--format/);
});

test('inferred exports collect JSON once and render HTML and comparisons offline', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'inferred-format-'));
  try {
    const saved = join(dir, 'profile.JSON'), html = join(dir, 'profile.HTML'), comparison = join(dir, 'comparison.json');
    const live = outputs();
    assert.equal(await main(['alice', '--out', saved], live.options), 0);
    assert.equal(JSON.parse(await readFile(saved, 'utf8')).profile.login, 'alice');
    assert.equal(live.options.client.requests, 5);
    const offline = outputs();
    assert.equal(await main(['--from', saved, '--out', html], offline.options), 0);
    assert.match(await readFile(html, 'utf8'), /^<!doctype html>/);
    assert.equal(await main(['--compare', saved, saved, '--out', comparison], offline.options), 0);
    const changes = JSON.parse(await readFile(comparison, 'utf8'));
    assert.equal(changes.kind, 'comparison');
    assert.equal(changes.metrics.publicRepositories.delta, 0);
    assert.equal(offline.options.client.requests, 0);
    const override = join(dir, 'explicit.json');
    assert.equal(await main(['--from', saved, '--out', override, '--format', 'markdown'], offline.options), 0);
    assert.match(await readFile(override, 'utf8'), /^# GitHub activity report/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
