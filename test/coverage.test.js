import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { hasIncompleteProfile } from '../src/coverage.js';
import { main, parseArgs } from '../src/index.js';

const example = JSON.parse(await readFile(new URL('../examples/crypto-kucherov-after.json', import.meta.url), 'utf8'));
const snapshot = () => structuredClone(example);
const capture = () => {
  const output = { stdout: '', stderr: '', requests: 0 };
  return { output, options: {
    stdout: { write(text) { output.stdout += text; } }, stderr: { write(text) { output.stderr += text; } },
    client: { get() { output.requests++; throw new Error('Unexpected network access'); } },
  } };
};

test('complete evidence includes known missing files, absent releases and zero activity', () => {
  const report = snapshot();
  report.repositories[0].checks = { readme: false, license: false, tests: false, ci: false, sourceFiles: 0, sourceFilesComplete: true };
  report.repositories[0].release = { status: 'absent', tag: null, url: null };
  report.repositories[0].commits = { count: 0, complete: true };
  assert.equal(hasIncompleteProfile(report), false);
});

test('unknown or partial evidence in each inspected area makes a profile incomplete', () => {
  for (const edit of [r => { r.scope.repositoryListComplete = false; },
    r => { r.activity.issues = { count: 10, complete: false }; },
    r => { r.activity.pullRequests = { count: null, complete: false }; },
    r => { r.repositories[0].commits = { count: 300, complete: false }; },
    r => { r.repositories[0].checks.tests = null; },
    r => { r.repositories[0].checks.sourceFilesComplete = false; },
    r => { r.repositories[0].checks.sourceFiles = null; },
    r => { r.repositories[0].release.status = 'unknown'; }]) {
    const report = snapshot(); edit(report);
    assert.equal(hasIncompleteProfile(report), true);
  }
});

test('intentional inspection limits and unrelated warnings do not fail completeness', () => {
  const report = snapshot();
  report.scope.maxRepos = 1;
  report.scope.listedRepositories++;
  report.repositories.push({ name: 'another', fork: false, archived: false, inspected: false, skipReason: 'inspection limit' });
  report.warnings = ['Only one active original repository was inspected.'];
  report.activity.extraMetadata = null;
  assert.equal(hasIncompleteProfile(report), false);
});

test('flagged offline profiles retain their partial report while returning exit code 2', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'incomplete-profile-'));
  try {
    const input = join(dir, 'profile.json'), target = join(dir, 'report.json');
    const report = snapshot();
    report.activity.issues = { count: null, complete: false };
    report.warnings = ['Search unavailable'];
    await writeFile(input, JSON.stringify(report));
    const plain = capture();
    assert.equal(await main(['--from', input, '--format', 'json'], plain.options), 0);
    const strict = capture();
    assert.equal(await main(['--from', input, '--format', 'json', '--out', target, '--fail-on-incomplete'], strict.options), 2);
    assert.equal(strict.output.stdout, '');
    assert.deepEqual(JSON.parse(await readFile(target, 'utf8')), JSON.parse(plain.output.stdout));
    assert.match(strict.output.stderr, /exit code 2/);
    const html = capture();
    assert.equal(await main(['--from', input, '--format', 'html', '--fail-on-incomplete'], html.options), 2);
    assert.match(html.output.stdout, /<!doctype html>/);
    assert.match(html.output.stdout, /Search unavailable/);
    assert.equal(strict.output.requests + plain.output.requests + html.output.requests, 0);
    const repeat = capture();
    assert.equal(await main(['--from', input, '--out', target, '--fail-on-incomplete'], repeat.options), 1);
    assert.match(repeat.output.stderr, /already exists/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('complete saved profiles return zero and malformed input still returns one', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'strict-profile-'));
  try {
    const input = join(dir, 'profile.json');
    await writeFile(input, JSON.stringify(example));
    assert.equal(await main(['--from', input, '--fail-on-incomplete'], capture().options), 0);
    await writeFile(input, '{not JSON');
    const invalid = capture();
    assert.equal(await main(['--from', input, '--fail-on-incomplete'], invalid.options), 1);
    assert.equal(invalid.output.stdout, '');
    assert.match(invalid.output.stderr, /not valid JSON/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('completeness flag takes no value, rejects duplicates and does not apply to comparisons', () => {
  assert.equal(parseArgs(['--fail-on-incomplete', 'alice']).failOnIncomplete, true);
  for (const args of [['alice', '--fail-on-incomplete', '--fail-on-incomplete'],
    ['alice', '--fail-on-incomplete', 'true'], ['--compare', 'a', 'b', '--fail-on-incomplete']]) assert.throws(() => parseArgs(args));
});
