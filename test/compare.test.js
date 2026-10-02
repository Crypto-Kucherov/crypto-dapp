import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { compareSnapshots, renderComparison, validateSnapshot } from '../src/compare.js';
import { main, parseArgs } from '../src/index.js';

const example = JSON.parse(await readFile(new URL('../examples/crypto-kucherov.json', import.meta.url), 'utf8'));
const snapshot = () => structuredClone(example);
const repo = report => report.repositories.find(item => item.name.toLowerCase() === 'crypto-dapp');

function pair() {
  const before = snapshot();
  const after = snapshot();
  before.generatedAt = before.scope.until = '2026-09-01T12:00:00.000Z';
  after.generatedAt = after.scope.until = '2026-09-27T12:00:00.000Z';
  return { before, after };
}

function capture() {
  const text = { stdout: '', stderr: '' };
  return { text, options: {
    stdout: { write: value => { text.stdout += value; } },
    stderr: { write: value => { text.stderr += value; } },
    client: { get: () => { throw new Error('Comparison must not call GitHub'); } },
  } };
}

test('compares a real v1 export and reports net changes over an expanded window', () => {
  const { before, after } = pair();
  after.activity.pullRequests.count = 1;
  repo(after).commits.count = 5;
  repo(after).checks.tests = true;
  repo(after).checks.ci = true;
  repo(after).checks.sourceFiles = 7;
  repo(after).release = { status: 'present', tag: 'v0.1.0', url: 'https://github.com/Crypto-Kucherov/crypto-dapp/releases/tag/v0.1.0' };
  const result = compareSnapshots(before, after);
  assert.equal(result.kind, 'comparison');
  assert.equal(result.windowKind, 'expanded');
  assert.equal(result.metrics.pullRequests.delta, 1);
  const compared = result.repositoryChanges.compared[0];
  assert.equal(compared.commits.delta, 2);
  assert.equal(compared.sourceFiles.delta, 7);
  assert.deepEqual(compared.checks.tests, { before: false, after: true, changed: true });
  assert.equal(compared.release.changed, true);
  assert.match(result.warnings[0], /net count changes/);
  const markdown = renderComparison(result);
  assert.match(markdown, /Public PRs created \| 0 \| 1 \| \+1/);
  assert.match(markdown, /Test paths \| Not detected \| Found \| Changed/);
  assert.match(markdown, /v0\.1\.0/);
});

test('identical snapshots yield zero changes without inventing activity', () => {
  const before = snapshot();
  const result = compareSnapshots(before, structuredClone(before));
  assert.equal(result.windowKind, 'identical');
  assert.ok(Object.values(result.metrics).every(metric => metric.delta === 0));
  assert.equal(result.repositoryChanges.compared[0].checks.tests.changed, false);
  assert.equal(result.repositoryChanges.compared[0].release.changed, false);
  assert.deepEqual(result.warnings, []);
});

test('shifted rolling windows suppress activity deltas but retain current file evidence', () => {
  const { before, after } = pair();
  after.scope.since = '2026-06-29T12:00:00.000Z';
  after.activity.pullRequests.count = 4;
  repo(after).commits.count = 8;
  repo(after).checks.tests = true;
  const result = compareSnapshots(before, after);
  assert.equal(result.windowKind, 'different');
  assert.equal(result.metrics.pullRequests.delta, null);
  assert.equal(result.metrics.pullRequests.after.count, 4);
  assert.equal(result.metrics.publicRepositories.delta, 0);
  assert.equal(result.repositoryChanges.compared[0].commits.delta, null);
  assert.equal(result.repositoryChanges.compared[0].checks.tests.changed, true);
  assert.match(renderComparison(result), /Not comparable/);
});

test('unknown and incomplete metrics never become a numeric change', () => {
  const { before, after } = pair();
  before.activity.pullRequests = { count: null, complete: false };
  after.activity.issues = { count: 20, complete: false };
  repo(before).checks.tests = null;
  repo(before).checks.sourceFiles = 0;
  repo(before).checks.sourceFilesComplete = false;
  repo(after).checks.tests = true;
  repo(after).checks.sourceFiles = 7;
  repo(before).release = { status: 'unknown', tag: null };
  const result = compareSnapshots(before, after);
  assert.equal(result.metrics.pullRequests.delta, null);
  assert.equal(result.metrics.issues.delta, null);
  const compared = result.repositoryChanges.compared[0];
  assert.equal(compared.sourceFiles.delta, null);
  assert.equal(compared.checks.tests.changed, null);
  assert.equal(compared.release.changed, null);
  assert.match(renderComparison(result), /Unknown \| Found \| Uncertain/);
  assert.match(renderComparison(result), /20 \(incomplete\)/);
});

test('unknown file-tree output from v0.1 remains supported', () => {
  const { before, after } = pair();
  repo(before).checks = { readme: null, license: null, tests: null, ci: null, sourceFiles: null };
  const result = compareSnapshots(before, after);
  assert.equal(result.repositoryChanges.compared[0].sourceFiles.delta, null);
});

test('a changed default branch disables only commit arithmetic', () => {
  const { before, after } = pair();
  repo(after).defaultBranch = 'release/next';
  repo(after).commits.count = 30;
  const result = compareSnapshots(before, after);
  assert.equal(result.repositoryChanges.compared[0].commits.delta, null);
  assert.equal(result.metrics.pullRequests.delta, 0);
  assert.ok(result.warnings.some(warning => warning.includes('Default branch changed')));
});

test('incomplete listings do not assert that an omitted repository was created or deleted', () => {
  const { before, after } = pair();
  before.scope.repositoryListComplete = false;
  after.scope.repositoryListComplete = false;
  const added = structuredClone(repo(after));
  added.name = 'newly-visible';
  after.repositories = [added];
  after.profile.publicRepositories = 1;
  const result = compareSnapshots(before, after);
  assert.equal(result.repositoryChanges.listedOnlyAfter[0].absentFromOtherCompleteList, false);
  assert.ok(result.repositoryChanges.listedOnlyBefore.every(item => !item.absentFromOtherCompleteList));
  assert.match(renderComparison(result), /other listing incomplete/);
  assert.equal(result.metrics.publicRepositories.delta, -1);
});

test('complete lists establish different visibility without claiming creation or deletion', () => {
  const { before, after } = pair();
  after.repositories = [];
  after.profile.publicRepositories = 0;
  const result = compareSnapshots(before, after);
  assert.equal(result.repositoryChanges.listedOnlyBefore.length, 2);
  assert.ok(result.repositoryChanges.listedOnlyBefore.every(item => item.absentFromOtherCompleteList));
  assert.match(renderComparison(result), /not proof of creation or deletion/);
});

test('changed inspection coverage is not a missing-test regression', () => {
  const { before, after } = pair();
  after.scope.maxRepos = 1;
  repo(after).inspected = false;
  delete repo(after).checks;
  const result = compareSnapshots(before, after);
  assert.equal(result.repositoryChanges.compared[0].checks, undefined);
  assert.match(result.repositoryChanges.compared[0].reason, /not inspected in both/);
  assert.ok(result.warnings.some(warning => warning.includes('inspection limits differ')));
});

test('supports equivalent login and repository casing without false membership changes', () => {
  const { before, after } = pair();
  after.profile.login = after.profile.login.toLowerCase();
  repo(after).name = 'Crypto-Dapp';
  const result = compareSnapshots(before, after);
  assert.deepEqual(result.repositoryChanges.listedOnlyAfter, []);
  assert.deepEqual(result.repositoryChanges.listedOnlyBefore, []);
  assert.equal(result.repositoryChanges.compared.length, 1);
});

test('rejects different accounts and reversed chronological input', () => {
  const { before, after } = pair();
  assert.throws(() => compareSnapshots(after, before), /first snapshot must be older/);
  after.profile.login = 'someone-else';
  assert.throws(() => compareSnapshots(before, after), /same GitHub account/);
});

test('matching account IDs allow renamed logins with an explicit warning', async () => {
  const { before, after } = pair();
  before.profile.id = after.profile.id = 123;
  after.profile.login = 'renamed-account';
  after.profile.url = 'https://github.com/renamed-account';
  after.activity.pullRequests.count += 2;
  const result = compareSnapshots(before, after);
  assert.equal(result.profile.id, 123);
  assert.equal(result.profile.login, 'renamed-account');
  assert.equal(result.profile.previousLogin, before.profile.login);
  assert.equal(result.metrics.pullRequests.delta, 2);
  assert.equal(result.repositoryChanges.compared[0].commits.delta, 0);
  assert.ok(result.warnings.some(warning => /Account renamed.*matched by GitHub account ID/.test(warning)));
  assert.match(renderComparison(result), /Account renamed/);
  const { renderHtml } = await import('../src/html.js');
  assert.match(renderHtml(result), /Account renamed/);
});

test('different account IDs reject comparisons even when a login is reused', () => {
  for (const login of ['Crypto-Kucherov', 'crypto-kucherov', 'someone-else']) {
    const { before, after } = pair();
    before.profile.id = 123;
    after.profile.id = 456;
    after.profile.login = login;
    assert.throws(() => compareSnapshots(before, after), /different GitHub account IDs/);
  }
});

test('legacy profile snapshots compare by login but cannot prove an account rename', () => {
  for (const withId of ['before', 'after', 'neither']) {
    const snapshots = pair();
    if (withId !== 'neither') snapshots[withId].profile.id = 123;
    snapshots.after.profile.login = snapshots.before.profile.login.toLowerCase();
    const result = compareSnapshots(snapshots.before, snapshots.after);
    assert.equal(result.metrics.pullRequests.delta, 0);
    assert.equal(result.profile.previousLogin, undefined);
    snapshots.after.profile.login = 'renamed-account';
    assert.throws(() => compareSnapshots(snapshots.before, snapshots.after), /same GitHub account/);
  }
});

test('present account IDs must be positive safe integers in saved snapshots', () => {
  for (const id of [null, '123', 0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    const report = snapshot();
    report.profile.id = id;
    assert.throws(() => validateSnapshot(report), /profile ID/);
  }
});

test('offline CLI rejects a reused login without creating a comparison file', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'github-account-identity-'));
  try {
    const { before, after } = pair();
    before.profile.id = 123;
    after.profile.id = 456;
    const older = join(dir, 'before.json'), newer = join(dir, 'after.json'), output = join(dir, 'comparison.json');
    await writeFile(older, JSON.stringify(before));
    await writeFile(newer, JSON.stringify(after));
    const { text, options } = capture();
    assert.equal(await main(['--compare', older, newer, '--format', 'json', '--out', output], options), 1);
    assert.equal(text.stdout, '');
    assert.match(text.stderr, /different GitHub account IDs/);
    await assert.rejects(readFile(output), { code: 'ENOENT' });
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('rejects unknown schemas, impossible dates, invalid counts and ambiguous repositories', () => {
  const edits = [
    r => { r.schemaVersion = 2; },
    r => { r.kind = 'comparison'; },
    r => { r.generatedAt = '2026-02-30T00:00:00.000Z'; },
    r => { r.scope.since = '2027-01-01T00:00:00.000Z'; },
    r => { r.scope.until = '2027-01-01T00:00:00.000Z'; },
    r => { r.activity.pullRequests.count = -1; },
    r => { r.activity.pullRequests.count = 1.5; },
    r => { r.activity.pullRequests.count = null; },
    r => { delete r.activity.pullRequests.complete; },
    r => { delete r.scope.repositoryListComplete; },
    r => { r.scope.publicOnly = false; },
    r => { repo(r).checks.tests = 'false'; },
    r => { repo(r).checks.sourceFilesComplete = undefined; },
    r => { repo(r).release = { status: 'present', tag: null }; },
    r => { r.repositories.push(structuredClone(repo(r))); },
  ];
  for (const edit of edits) {
    const r = snapshot(); edit(r);
    assert.throws(() => validateSnapshot(r), /^Error: Snapshot:/);
  }
});

test('report text escapes snapshot-controlled Markdown and rejects dangerous links', () => {
  const { before, after } = pair();
  const name = 'repo|<script>\n# forged';
  repo(before).name = name;
  const newer = repo(after);
  newer.name = name;
  newer.url = 'javascript:alert(1)';
  newer.release = { status: 'present', tag: '<img src=x>\n# forged' };
  after.warnings = ['<script>alert(1)</script>\n# forged'];
  const md = renderComparison(compareSnapshots(before, after));
  for (const value of ['<script>', '<img', 'javascript:', '\n# forged']) assert.ok(!md.includes(value));
  assert.ok(md.includes('repo\\|&lt;script&gt;'));
});

test('comparison CLI rejects collection options, extra arguments and missing files', () => {
  for (const args of [['--compare'], ['--compare', 'a'], ['--compare', 'a', '--format', 'json'],
    ['--compare', 'a', 'b', 'c'], ['--compare', 'a', 'b', '--since', '2026-01-01'],
    ['--compare', 'a', 'b', '--max-repos', '3']]) assert.throws(() => parseArgs(args));
  assert.deepEqual(parseArgs(['--compare', 'a.json', 'b.json', '--format', 'json']).compare, ['a.json', 'b.json']);
});

test('comparison CLI runs offline, writes Markdown/JSON and preserves existing files', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'snapshot-compare-'));
  try {
    const { before, after } = pair();
    after.activity.pullRequests.count = 2;
    const first = join(dir, 'before.json'), second = join(dir, 'after.json'), output = join(dir, 'diff.md');
    await writeFile(first, JSON.stringify(before));
    await writeFile(second, JSON.stringify(after));
    const json = capture();
    assert.equal(await main(['--compare', first, second, '--format', 'json'], json.options), 0);
    assert.equal(JSON.parse(json.text.stdout).metrics.pullRequests.delta, 2);
    assert.match(json.text.stderr, /comparison warnings/);
    const md = capture();
    assert.equal(await main(['--compare', first, second, '--out', output], md.options), 0);
    assert.equal(md.text.stdout, '');
    assert.match(await readFile(output, 'utf8'), /GitHub snapshot comparison/);
    const repeat = capture();
    assert.equal(await main(['--compare', first, second, '--out', output], repeat.options), 1);
    assert.match(repeat.text.stderr, /already exists/);
    const original = await readFile(first, 'utf8');
    assert.equal(await main(['--compare', first, second, '--out', first], capture().options), 1);
    assert.equal(await readFile(first, 'utf8'), original);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('invalid JSON and missing input fail without printing snapshot contents', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'snapshot-invalid-'));
  try {
    const file = join(dir, 'invalid.json');
    await writeFile(file, '{private text');
    const invalid = capture();
    assert.equal(await main(['--compare', file, file], invalid.options), 1);
    assert.equal(invalid.text.stdout, '');
    assert.match(invalid.text.stderr, /not valid JSON/);
    assert.ok(!invalid.text.stderr.includes('private text'));
    const missing = capture();
    assert.equal(await main(['--compare', join(dir, 'missing.json'), file], missing.options), 1);
    assert.equal(missing.text.stdout, '');
    assert.match(missing.text.stderr, /ENOENT/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('different repository IDs under the same name suppress all repository deltas', async () => {
  const { before, after } = pair();
  repo(before).id = 100;
  repo(after).id = 200;
  repo(after).commits.count = 1000;
  repo(after).checks.tests = true;
  const result = compareSnapshots(before, after);
  const changed = result.repositoryChanges.compared[0];
  assert.match(changed.reason, /different repositories/);
  for (const field of ['commits', 'checks', 'sourceFiles', 'release']) assert.equal(changed[field], undefined);
  assert.equal(result.metrics.pullRequests.delta, 0);
  assert.match(renderComparison(result), /Repository ID changed/);
  const { renderHtml } = await import('../src/html.js');
  assert.match(renderHtml(result), /Repository ID changed/);
});

test('renamed repositories with stable IDs retain comparisons and explain the match', () => {
  const { before, after } = pair();
  const newer = repo(after);
  repo(before).id = newer.id = 100;
  newer.name = 'renamed-tool';
  newer.commits.count += 2;
  const result = compareSnapshots(before, after);
  assert.deepEqual(result.repositoryChanges.listedOnlyAfter, []);
  assert.deepEqual(result.repositoryChanges.listedOnlyBefore, []);
  assert.equal(result.repositoryChanges.compared[0].previousName, 'crypto-dapp');
  assert.equal(result.repositoryChanges.compared[0].commits.delta, 2);
  assert.ok(result.warnings.some(warning => /matched by GitHub repository ID/.test(warning)));
});

test('ID matches take precedence when another repository reuses the old name', () => {
  const { before, after } = pair();
  repo(before).id = 100;
  const renamed = repo(after);
  renamed.id = 100;
  renamed.name = 'new-name';
  after.repositories.push({ ...structuredClone(renamed), id: 200, name: 'crypto-dapp' });
  const result = compareSnapshots(before, after);
  const compared = result.repositoryChanges.compared;
  assert.equal(compared.find(item => item.name === 'new-name').commits.delta, 0);
  assert.equal(compared.find(item => item.name === 'crypto-dapp'), undefined);
  assert.deepEqual(result.repositoryChanges.listedOnlyAfter.map(item => item.name), ['crypto-dapp']);
  assert.deepEqual(result.repositoryChanges.listedOnlyBefore, []);
});

function renamedWithLegacyReplacement() {
  const { before, after } = pair();
  const old = repo(before), renamed = repo(after);
  old.id = renamed.id = 100;
  renamed.name = 'new-name';
  renamed.url = 'https://github.com/Crypto-Kucherov/new-name';
  renamed.commits.count += 2;
  const replacement = structuredClone(old);
  delete replacement.id;
  replacement.name = 'Crypto-Dapp';
  replacement.commits.count = 999;
  after.repositories.push(replacement);
  after.profile.publicRepositories++;
  after.scope.listedRepositories++;
  after.scope.inspectedRepositories++;
  return { before, after };
}

test('legacy name reuse cannot borrow a renamed repository history in either list order', () => {
  for (const reverse of [false, true]) {
    const { before, after } = renamedWithLegacyReplacement();
    if (reverse) after.repositories.reverse();
    const changes = compareSnapshots(before, after).repositoryChanges;
    assert.equal(changes.compared.length, 1);
    assert.equal(changes.compared[0].name, 'new-name');
    assert.equal(changes.compared[0].commits.delta, 2);
    assert.deepEqual(changes.listedOnlyAfter.map(item => item.name), ['Crypto-Dapp']);
    assert.equal(changes.listedOnlyAfter[0].absentFromOtherCompleteList, true);
    assert.deepEqual(changes.listedOnlyBefore, []);
  }
});

test('a legacy repository displaced by a known rename stays visible in the older list', () => {
  for (const complete of [true, false]) {
    const { before, after } = renamedWithLegacyReplacement();
    // Reverse the repository states while preserving chronological timestamps.
    [before.repositories, after.repositories] = [after.repositories, before.repositories];
    after.scope.repositoryListComplete = complete;
    const changes = compareSnapshots(before, after).repositoryChanges;
    assert.equal(changes.compared.length, 1);
    assert.equal(changes.compared[0].previousName, 'new-name');
    assert.equal(changes.compared[0].commits.delta, -2);
    assert.deepEqual(changes.listedOnlyAfter, []);
    assert.deepEqual(changes.listedOnlyBefore.map(item => item.name), ['Crypto-Dapp']);
    assert.equal(changes.listedOnlyBefore[0].absentFromOtherCompleteList, complete);
  }
});

test('two repositories swapping names retain their own histories regardless of order', () => {
  for (const reverseBefore of [false, true]) for (const reverseAfter of [false, true]) {
    const { before, after } = pair();
    const old = repo(before);
    old.id = 100;
    before.repositories = [old, { ...structuredClone(old), id: 200, name: 'other', commits: { count: 40, complete: true } }];
    after.repositories = [
      { ...structuredClone(old), name: 'other', commits: { count: old.commits.count + 2, complete: true } },
      { ...structuredClone(old), id: 200, commits: { count: 45, complete: true } },
    ];
    if (reverseBefore) before.repositories.reverse();
    if (reverseAfter) after.repositories.reverse();
    const changes = compareSnapshots(before, after).repositoryChanges;
    assert.deepEqual(changes.listedOnlyAfter, []);
    assert.deepEqual(changes.listedOnlyBefore, []);
    assert.equal(changes.compared.length, 2);
    assert.equal(changes.compared.find(item => item.name === 'other').commits.delta, 2);
    assert.equal(changes.compared.find(item => item.name === 'crypto-dapp').commits.delta, 5);
  }
});

test('uninspected ID matches still reserve identity before legacy name matching', () => {
  const { before, after } = renamedWithLegacyReplacement();
  repo(before).inspected = false;
  after.repositories.find(item => item.name === 'new-name').inspected = false;
  const changes = compareSnapshots(before, after).repositoryChanges;
  assert.deepEqual(changes.compared, []);
  assert.deepEqual(changes.listedOnlyBefore, []);
  assert.deepEqual(changes.listedOnlyAfter.map(item => item.name), ['Crypto-Dapp']);
});

test('offline comparison exports do not attribute a replacement history to a renamed project', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'repo-identity-'));
  try {
    const { before, after } = renamedWithLegacyReplacement();
    const older = join(dir, 'before.json'), newer = join(dir, 'after.json');
    await writeFile(older, JSON.stringify(before));
    await writeFile(newer, JSON.stringify(after));
    for (const format of ['json', 'markdown', 'html']) {
      const { text, options } = capture();
      assert.equal(await main(['--compare', older, newer, '--format', format], options), 0);
      if (format === 'json') {
        const changes = JSON.parse(text.stdout).repositoryChanges;
        assert.equal(changes.compared.length, 1);
        assert.deepEqual(changes.listedOnlyAfter.map(item => item.name), ['Crypto-Dapp']);
      } else {
        assert.match(text.stdout, /Listed only after/);
        assert.match(text.stdout, /Crypto-Dapp/);
        assert.match(text.stdout, /\+2/);
        assert.doesNotMatch(text.stdout, /999|\+996/);
      }
    }
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('legacy snapshots without IDs still compare by name', () => {
  for (const withId of ['before', 'after', 'neither']) {
    const snapshots = pair();
    if (withId !== 'neither') repo(snapshots[withId]).id = 100;
    const result = compareSnapshots(snapshots.before, snapshots.after);
    assert.equal(result.repositoryChanges.compared[0].commits.delta, 0);
    assert.equal(result.repositoryChanges.compared[0].reason, undefined);
  }
});

test('invalid and duplicate saved repository IDs are rejected', () => {
  for (const id of [null, '100', 0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    const report = snapshot();
    repo(report).id = id;
    assert.throws(() => validateSnapshot(report), /repository ID/);
  }
  const report = snapshot();
  for (const item of report.repositories) item.id = 100;
  assert.throws(() => validateSnapshot(report), /duplicate repository IDs/);
});
