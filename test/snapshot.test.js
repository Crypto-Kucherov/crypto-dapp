import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { main, parseArgs } from '../src/index.js';
import { validateProfileReport } from '../src/snapshot.js';

const fixture = fileURLToPath(new URL('../examples/crypto-kucherov-after.json', import.meta.url));
const example = JSON.parse(await readFile(fixture, 'utf8'));
const snapshot = () => structuredClone(example);
function capture() {
  const output = { stdout: '', stderr: '', calls: 0 };
  return { output, options: {
    client: { get() { output.calls++; throw new Error('Offline mode must not fetch data'); },
      paginate() { output.calls++; throw new Error('Offline mode must not list repositories'); } },
    stdout: { write(value) { output.stdout += value; } }, stderr: { write(value) { output.stderr += value; } },
  } };
}

test('saved profile renders offline in all formats with original timestamps and counters', async () => {
  for (const format of ['markdown', 'html', 'json']) {
    const { output, options } = capture();
    assert.equal(await main(['--from', fixture, '--format', format], options), 0);
    assert.equal(output.calls, 0);
    assert.ok(output.stdout.includes(example.generatedAt));
    assert.ok(output.stdout.includes(example.scope.since));
    assert.match(output.stderr, /no new GitHub data/);
    if (format === 'json') assert.deepEqual(JSON.parse(output.stdout), example);
    else assert.match(output.stdout, format === 'html' ? /<!doctype html>/ : /# GitHub activity report/);
  }
});

test('offline profile mode accepts one input and refuses collection flags or mixed modes', () => {
  const invalid = [['--from'], ['--from', '--format', 'html'], ['--from', 'a', 'b'],
    ['alice', '--from', 'a'], ['--from', 'a', '--compare', 'b', 'c'],
    ['--compare', 'a', 'b', '--from', 'c'], ['--from', 'a', '--from', 'b'],
    ['--from', 'a', '--since', '2026-01-01'], ['--from', 'a', '--max-repos', '5']];
  for (const args of invalid) assert.throws(() => parseArgs(args), args.join(' '));
  assert.equal(parseArgs(['--from', 'snapshot with spaces.json']).from, 'snapshot with spaces.json');
});

test('profile renderer rejects invalid schemas, lists and inconsistent coverage before output', async () => {
  const edits = [
    r => { r.schemaVersion = 2; }, r => { r.kind = 'comparison'; },
    r => { r.recommendations = 'not a list'; }, r => { r.limitations = [42]; },
    r => { delete r.warnings; }, r => { delete r.profile.createdAt; },
    r => { r.scope.listedRepositories = 42; }, r => { r.scope.inspectedRepositories = 0; },
    r => { r.scope.apiRequests = -1; }, r => { r.scope.apiRequests = '<img src=x>'; },
    r => { r.activity.issues.count = null; },
  ];
  for (const edit of edits) {
    const report = snapshot(); edit(report);
    assert.throws(() => validateProfileReport(report), /^Error: Snapshot:/);
  }
  const dir = await mkdtemp(join(tmpdir(), 'invalid-profile-'));
  try {
    const input = join(dir, 'invalid.json');
    const report = snapshot(); report.recommendations = 'PRIVATE_MARKER';
    await writeFile(input, JSON.stringify(report));
    const { output, options } = capture();
    assert.equal(await main(['--from', input], options), 1);
    assert.equal(output.stdout, '');
    assert.equal(output.calls, 0);
    assert.match(output.stderr, /recommendations must be an array/);
    assert.ok(!output.stderr.includes('PRIVATE_MARKER'));
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('older exports with unknown trees still render without silently replacing evidence', () => {
  const report = snapshot();
  report.repositories[0].checks = { readme: null, license: null, tests: null, ci: null, sourceFiles: null };
  assert.equal(validateProfileReport(report), report);
});

test('offline output preserves partial evidence and escapes saved content', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'partial-profile-'));
  try {
    const input = join(dir, 'profile.json');
    const report = snapshot();
    report.activity.pullRequests = { count: null, complete: false };
    report.repositories[0].commits = { count: 300, complete: false };
    report.repositories[0].warnings = ['History truncated'];
    report.repositories[0].url = 'javascript:alert(1)';
    report.warnings = ['<img src=x onerror=alert(1)>'];
    report.recommendations = ['<script>bad()</script>'];
    await writeFile(input, JSON.stringify(report));
    for (const format of ['html', 'markdown']) {
      const { output, options } = capture();
      assert.equal(await main(['--from', input, '--format', format], options), 0);
      assert.match(output.stdout, /Unknown/);
      assert.match(output.stdout, /incomplete/);
      assert.match(output.stdout, /History truncated/);
      assert.match(output.stderr, /coverage warnings/);
      for (const unsafe of ['<img', '<script', 'javascript:']) assert.ok(!output.stdout.includes(unsafe));
      assert.equal(output.calls, 0);
    }
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('offline file output supports spaces, creates directories and protects source and destination', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'offline-profile-'));
  try {
    const input = join(dir, 'saved profile.json');
    const original = JSON.stringify(example);
    await writeFile(input, original);
    const target = join(dir, 'nested', 'profile.html');
    assert.equal(await main(['--from', input, '--format', 'html', '--out', target], capture().options), 0);
    const html = await readFile(target, 'utf8');
    assert.match(html, /Public profile snapshot/);
    for (const path of [input, target]) {
      const { output, options } = capture();
      assert.equal(await main(['--from', input, '--out', path], options), 1);
      assert.match(output.stderr, /already exists/);
      assert.equal(output.stdout, '');
    }
    assert.equal(await readFile(input, 'utf8'), original);
    assert.equal(await readFile(target, 'utf8'), html);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('bad JSON and missing files fail offline without reflecting file contents', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'unreadable-profile-'));
  try {
    const input = join(dir, 'broken.json');
    await writeFile(input, '{PRIVATE_MARKER');
    for (const path of [input, join(dir, 'missing.json')]) {
      const { output, options } = capture();
      assert.equal(await main(['--from', path], options), 1);
      assert.equal(output.stdout, '');
      assert.equal(output.calls, 0);
      assert.ok(!output.stderr.includes('PRIVATE_MARKER'));
      assert.match(output.stderr, path === input ? /Snapshot is not valid JSON/ : /ENOENT/);
    }
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('UTF-8 BOM snapshots render and compare offline without changing saved text', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'bom-snapshot-'));
  try {
    const report = snapshot();
    report.profile.bio = 'Keep embedded \uFEFF text';
    const file = join(dir, 'bom.json');
    await writeFile(file, '\uFEFF' + JSON.stringify(report));
    const rendered = capture();
    assert.equal(await main(['--from', file, '--format', 'json'], rendered.options), 0);
    assert.deepEqual(JSON.parse(rendered.output.stdout), report);
    const compared = capture();
    assert.equal(await main(['--compare', file, file, '--format', 'json'], compared.options), 0);
    assert.equal(JSON.parse(compared.output.stdout).metrics.publicRepositories.delta, 0);
    assert.equal(rendered.output.calls + compared.output.calls, 0);
    await writeFile(file, '\uFEFF{PRIVATE_MARKER');
    const invalid = capture();
    assert.equal(await main(['--from', file], invalid.options), 1);
    assert.doesNotMatch(invalid.output.stderr, /PRIVATE_MARKER/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
