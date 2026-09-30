import test from 'node:test';
import assert from 'node:assert/strict';
import { GitHubClient } from '../src/github.js';
import { analyzeProfile, inspectTree, parseSince, parseUntil } from '../src/analyze.js';
import { renderMarkdown } from '../src/report.js';

const NOW = new Date('2026-09-27T12:00:00.000Z');
const repository = (name, extra = {}) => ({ name, private: false, fork: false, archived: false,
  html_url: `https://github.com/alice/${name}`, description: null, default_branch: 'main',
  language: 'JavaScript', pushed_at: '2026-09-20T00:00:00Z', stargazers_count: 0, ...extra });
const tree = (paths, truncated = false) => ({ tree: paths.map(path => ({ path, type: 'blob' })), truncated });

function fixtureClient({ repos = [repository('tool')], override } = {}) {
  const seen = [];
  const client = new GitHubClient({ fetchImpl: async (url, options) => {
    seen.push(url);
    const overridden = await override?.(url, options);
    if (overridden) return overridden;
    if (url.pathname === '/users/alice') return Response.json({ login: 'alice', type: 'User', name: 'Alice',
      bio: 'Builds tools', created_at: '2023-07-12T12:00:00Z', public_repos: repos.filter(repo => !repo.private).length,
      html_url: 'https://github.com/alice', followers: 2, following: 3 });
    if (url.pathname === '/users/alice/repos') return Response.json(repos);
    if (url.pathname === '/search/issues') return Response.json({ total_count: 0, incomplete_results: false, items: [] });
    if (url.pathname.includes('/git/trees/')) return Response.json(tree(['README.md', 'LICENSE', 'src/index.js', 'test/index.test.js', '.github/workflows/ci.yml']));
    if (url.pathname.endsWith('/commits')) return Response.json([{ sha: 'abc' }]);
    if (url.pathname.endsWith('/releases/latest')) return new Response('', { status: 404 });
    throw new Error(`Unexpected fixture request: ${url.pathname}`);
  } });
  return { client, seen };
}

test('calendar validation rejects rollover dates and future dates', () => {
  assert.equal(parseSince('2024-02-29', NOW), '2024-02-29T00:00:00.000Z');
  assert.equal(parseSince(undefined, NOW), '2026-06-29T12:00:00.000Z');
  for (const value of ['2026-02-29', '2026-02-30', '2026-13-01', '2026-09-28', 'yesterday', '2026-9-2']) assert.throws(() => parseSince(value, NOW));
});

test('end dates include a full past UTC day but never future time', () => {
  assert.equal(parseUntil(undefined, NOW), NOW.toISOString());
  assert.equal(parseUntil('2024-02-29', NOW), '2024-02-29T23:59:59.999Z');
  assert.equal(parseUntil('2026-09-27', NOW), NOW.toISOString());
  for (const value of ['2026-02-29', '2026-13-01', '2026-09-28', '2026-9-2', 'yesterday']) assert.throws(() => parseUntil(value, NOW));
});

test('historical windows reach all activity requests and keep the actual collection timestamp', async () => {
  const { client, seen } = fixtureClient();
  const report = await analyzeProfile(client, 'alice', { now: NOW, since: '2026-08-01', until: '2026-08-31' });
  assert.equal(report.generatedAt, NOW.toISOString());
  assert.equal(report.scope.since, '2026-08-01T00:00:00.000Z');
  assert.equal(report.scope.until, '2026-08-31T23:59:59.999Z');
  const queries = seen.filter(url => url.pathname === '/search/issues').map(url => url.searchParams.get('q'));
  assert.equal(queries.length, 3);
  assert.ok(queries.every(q => q.includes('2026-08-01T00:00:00.000Z..2026-08-31T23:59:59.999Z')));
  const commits = seen.find(url => url.pathname.endsWith('/commits'));
  assert.equal(commits.searchParams.get('since'), report.scope.since);
  assert.equal(commits.searchParams.get('until'), report.scope.until);
});

test('a historical end anchors the default 90-day window', async () => {
  const { client } = fixtureClient();
  const report = await analyzeProfile(client, 'alice', { now: NOW, until: '2026-09-01' });
  assert.equal(report.scope.since, '2026-06-03T23:59:59.999Z');
  assert.equal(report.scope.until, '2026-09-01T23:59:59.999Z');
});

test('reversed or future activity windows fail before the first GitHub request', async () => {
  for (const options of [{ since: '2026-09-02', until: '2026-09-01' },
    { until: '2026-09-28' }, { until: '2026-02-30' }, { until: '0000-01-01' }]) {
    const { client, seen } = fixtureClient();
    await assert.rejects(analyzeProfile(client, 'alice', { now: NOW, ...options }), /--since|--until/);
    assert.equal(seen.length, 0);
  }
});

test('tree checks skip vendored code and distinguish truncated absence', () => {
  const found = inspectTree(tree(['README.rst', 'COPYING', 'src/main.py', 'tests/test_main.py', '.github/workflows/test.yaml', 'vendor/sdk.js']));
  assert.equal(found.readme, true);
  assert.equal(found.license, true);
  assert.equal(found.tests, true);
  assert.equal(found.ci, true);
  assert.equal(found.sourceFiles, 2);
  const empty = inspectTree(tree(['README.md', 'node_modules/pkg/index.js', 'vendor/tests/test_x.py']));
  assert.equal(empty.sourceFiles, 0);
  assert.equal(empty.tests, false);
  const partial = inspectTree(tree(['README.md'], true));
  assert.equal(partial.readme, true);
  assert.equal(partial.tests, null);
  assert.equal(partial.sourceFilesComplete, false);
  assert.equal(inspectTree(null).readme, null);
});

test('supports Go, colocated JS tests and Python test files', () => {
  for (const path of ['pkg/main_test.go', 'src/index.test.mjs', 'src/button.spec.tsx', 'test_parser.py']) assert.equal(inspectTree(tree([path])).tests, true, path);
});

test('recognizes README files in GitHub repository overview locations', () => {
  for (const path of ['README.md', '.github/README.md', 'docs/readme.rst', 'docs/README', '.github/readme.txt']) {
    assert.equal(inspectTree(tree([path])).readme, true, path);
    assert.equal(inspectTree(tree([path], true)).readme, true, path);
  }
  const nested = ['packages/tool/README.md', 'docs/guides/README.md', 'vendor/README.md'];
  assert.equal(inspectTree(tree(nested)).readme, false);
  assert.equal(inspectTree(tree(nested, true)).readme, null);
});

test('a docs or .github README does not trigger missing-README advice', async () => {
  for (const path of ['docs/README.md', '.github/README.md']) {
    const { client } = fixtureClient({ override: url => url.pathname.includes('/git/trees/') ? Response.json(tree([path, 'src/main.js'])) : undefined });
    const report = await analyzeProfile(client, 'alice', { now: NOW });
    assert.equal(report.repositories[0].checks.readme, true);
    assert.ok(!report.recommendations.some(tip => tip.includes('add a README')));
  }
});

test('documentation and data in test folders do not establish test code', () => {
  const paths = ['tests/README.md', 'test/example.json', 'spec/schema.yaml', '__tests__/image.png', 'specs/notes.txt'];
  assert.equal(inspectTree(tree(paths)).tests, false);
  assert.equal(inspectTree(tree(paths)).sourceFiles, 0);
  assert.equal(inspectTree(tree(paths, true)).tests, null);
});

test('recognizes conventional colocated test names across supported languages', () => {
  for (const path of ['src/Vault.t.sol', 'app/UserTest.java', 'app/UserTests.kt', 'app/TestAccount.java',
    'src/CalculatorTests.cs', 'src/AccountTest.php', 'lib/parser_test.rb', 'lib/parser_spec.rb',
    'lib/parser_test.exs', 'src/widget.spec.cjs', 'pkg/parser_test.rs']) {
    const result = inspectTree(tree([path]));
    assert.equal(result.tests, true, path);
    assert.equal(result.sourceFiles, 1, path);
  }
});

test('test directories still recognize code and ignore generated copies of named tests', () => {
  for (const path of ['tests/run.sh', '__tests__/Widget.tsx', 'spec/parser.rb', 'test/Contract.sol']) {
    assert.equal(inspectTree(tree([path])).tests, true, path);
    assert.equal(inspectTree(tree([path], true)).tests, true, path);
  }
  const copies = ['vendor/library/UserTest.php', 'node_modules/pkg/test.spec.js', 'build/TestAccount.java',
    'dist/Vault.t.sol', 'coverage/parser_test.exs'];
  assert.equal(inspectTree(tree(copies)).tests, false);
  assert.equal(inspectTree(tree(copies, true)).tests, null);
});

test('similar production names and test documentation do not match named-test conventions', () => {
  for (const path of ['src/Latest.java', 'src/Contest.php', 'src/Testament.cs', 'docs/AccountTest.md',
    'docs/parser_spec.rb.md', 'src/testing.py', 'src/widget.spec.json']) {
    assert.equal(inspectTree(tree([path])).tests, false, path);
  }
});

test('test-path recommendations distinguish documentation-only folders from recognized code', async () => {
  for (const [paths, expectsAdvice] of [
    [['src/User.php', 'tests/README.md'], true],
    [['src/User.php', 'src/UserTest.php'], false],
  ]) {
    const { client } = fixtureClient({ override: url => url.pathname.includes('/git/trees/') ? Response.json(tree(paths)) : undefined });
    const report = await analyzeProfile(client, 'alice', { now: NOW });
    assert.equal(report.recommendations.some(tip => tip.includes('add tests')), expectsAdvice);
  }
});

test('analyzes public originals, excludes private repos, and separates forks and archived repos', async () => {
  const { client, seen } = fixtureClient({ repos: [repository('tool'), repository('copy', { fork: true }),
    repository('old', { archived: true }), repository('private-work', { private: true }), repository('second')] });
  const report = await analyzeProfile(client, 'alice', { now: NOW, since: '2026-01-01', maxRepos: 1 });
  assert.equal(report.scope.listedRepositories, 4);
  assert.equal(report.scope.inspectedRepositories, 1);
  assert.deepEqual(report.repositories.map(repo => repo.name), ['tool', 'copy', 'old', 'second']);
  assert.equal(report.repositories[0].commits.count, 1);
  assert.equal(report.repositories[0].checks.tests, true);
  assert.equal(report.repositories[0].release.status, 'absent');
  assert.equal(report.repositories[1].skipReason, 'fork');
  assert.equal(report.repositories[2].skipReason, 'archived');
  assert.equal(report.repositories[3].skipReason, 'inspection limit');
  assert.ok(!seen.some(url => /copy|old|private-work|second/.test(url.pathname)));
  const commits = seen.find(url => url.pathname.endsWith('/commits'));
  assert.equal(commits.searchParams.get('author'), 'alice');
  assert.equal(commits.searchParams.get('sha'), 'main');
  assert.equal(commits.searchParams.get('since'), '2026-01-01T00:00:00.000Z');
  assert.equal(commits.searchParams.get('until'), NOW.toISOString());
  const searches = seen.filter(url => url.pathname === '/search/issues').map(url => url.searchParams.get('q'));
  assert.ok(searches.every(query => query.includes('is:public')));
  assert.ok(searches.some(query => query.includes('-user:alice') && query.includes('merged:')));
  assert.ok(report.warnings.some(warning => warning.includes('most recently pushed')));
});

test('unavailable activity stays unknown and produces no missing-PR advice', async () => {
  const { client } = fixtureClient({ override: url => {
    if (url.pathname === '/search/issues' || url.pathname.endsWith('/commits')) return new Response('', { status: 503 });
  } });
  const report = await analyzeProfile(client, 'alice', { now: NOW });
  assert.equal(report.activity.pullRequests.count, null);
  assert.equal(report.repositories[0].commits.count, null);
  assert.ok(!report.recommendations.some(tip => tip.includes('no merged public PRs')));
  assert.match(renderMarkdown(report), /Unknown/);
  assert.match(renderMarkdown(report), /Coverage warnings/);
});

test('invalid GitHub search totals stay unknown instead of becoming complete counts', async () => {
  for (const data of [null, { total_count: -1, incomplete_results: false },
    { total_count: Number.MAX_SAFE_INTEGER + 1, incomplete_results: false },
    { total_count: 1.5, incomplete_results: false }, { total_count: 0, incomplete_results: 'false' }]) {
    const { client } = fixtureClient({ override: url => url.pathname === '/search/issues' ? Response.json(data) : undefined });
    const report = await analyzeProfile(client, 'alice', { now: NOW });
    assert.ok(Object.values(report.activity).every(metric => metric.count === null && !metric.complete));
    assert.ok(report.warnings.some(warning => warning.includes('Unexpected GitHub search response')));
    assert.ok(!report.recommendations.some(tip => tip.includes('no merged public PRs')));
  }
});

test('malformed tree entries and missing truncation metadata never imply absent files', async () => {
  for (const data of [null, { tree: [] }, { tree: [], truncated: 'false' },
    { tree: [null], truncated: false }, { tree: [{ type: 'blob' }], truncated: false },
    { tree: [{ type: 'unknown', path: 'README.md' }], truncated: false }]) {
    assert.equal(inspectTree(data).sourceFiles, null);
    const { client } = fixtureClient({ override: url => url.pathname.includes('/git/trees/') ? Response.json(data) : undefined });
    const report = await analyzeProfile(client, 'alice', { now: NOW });
    assert.equal(report.repositories[0].checks.readme, null);
    assert.equal(report.repositories[0].checks.tests, null);
    assert.match(report.repositories[0].warnings[0], /Unexpected repository tree response/);
    assert.ok(!report.recommendations.some(tip => tip.includes('add a README') || tip.includes('add tests')));
  }
});

test('empty complete trees and valid non-file entries remain supported', () => {
  const result = inspectTree({ truncated: false, tree: [
    { type: 'tree', path: 'src' }, { type: 'commit', path: 'submodules/library' },
  ] });
  assert.equal(result.sourceFiles, 0);
  assert.equal(result.sourceFilesComplete, true);
  assert.equal(result.readme, false);
  assert.equal(inspectTree(tree([])).tests, false);
});

test('malformed or non-stable latest-release responses remain unknown with a warning', async () => {
  const stable = { tag_name: 'v1.0.0', html_url: 'https://github.com/alice/tool/releases/tag/v1.0.0', draft: false, prerelease: false };
  for (const data of [null, {}, { ...stable, tag_name: '' }, { ...stable, draft: true },
    { ...stable, prerelease: true }, { ...stable, html_url: 'javascript:PRIVATE_MARKER' }]) {
    const { client } = fixtureClient({ override: url => url.pathname.endsWith('/releases/latest') ? Response.json(data) : undefined });
    const report = await analyzeProfile(client, 'alice', { now: NOW });
    assert.equal(report.repositories[0].release.status, 'unknown');
    assert.ok(report.repositories[0].warnings.some(warning => warning.includes('Unexpected GitHub stable release response')));
    assert.ok(!JSON.stringify(report).includes('PRIVATE_MARKER'));
    assert.ok(!report.recommendations.some(tip => tip.includes('publish a release')));
  }
  const { client } = fixtureClient({ override: url => url.pathname.endsWith('/releases/latest') ? Response.json(stable) : undefined });
  const report = await analyzeProfile(client, 'alice', { now: NOW });
  assert.deepEqual(report.repositories[0].release, { status: 'present', tag: stable.tag_name, url: stable.html_url });
});

test('a truncated tree does not produce false missing-file advice', async () => {
  const { client } = fixtureClient({ override: url => url.pathname.includes('/git/trees/') ? Response.json(tree(['README.md'], true)) : undefined });
  const report = await analyzeProfile(client, 'alice', { now: NOW });
  assert.equal(report.repositories[0].checks.tests, null);
  assert.ok(!report.recommendations.some(tip => /working implementation|add tests|choose an appropriate license/.test(tip)));
  assert.match(report.repositories[0].warnings[0], /truncated/);
});

test('explicitly empty repositories have complete absent-file and zero-commit evidence', async () => {
  const { client } = fixtureClient({ override: url => {
    if (url.pathname.endsWith('/commits') || url.pathname.includes('/git/trees/')) return Response.json({ message: 'Git Repository is empty.' }, { status: 409 });
  } });
  const report = await analyzeProfile(client, 'alice', { now: NOW });
  assert.deepEqual(report.repositories[0].commits, { count: 0, complete: true });
  assert.deepEqual(report.repositories[0].checks, {
    readme: false, license: false, tests: false, ci: false, sourceFiles: 0, sourceFilesComplete: true,
  });
  assert.deepEqual(report.repositories[0].warnings, []);
});

test('generic conflicts and missing resources never establish an empty repository', async () => {
  for (const status of [409, 404]) {
    const { client } = fixtureClient({ override: url => {
      if (url.pathname.endsWith('/commits') || url.pathname.includes('/git/trees/')) return new Response('', { status });
    } });
    const report = await analyzeProfile(client, 'alice', { now: NOW });
    assert.deepEqual(report.repositories[0].commits, { count: null, complete: false });
    assert.equal(report.repositories[0].checks.readme, null);
    assert.equal(report.repositories[0].warnings.length, 2);
  }
});

test('incomplete search counts are labelled and do not trigger zero-activity advice', async () => {
  const { client } = fixtureClient({ override: url => url.pathname === '/search/issues'
    ? Response.json({ total_count: 0, incomplete_results: true, items: [] }) : undefined });
  const report = await analyzeProfile(client, 'alice', { now: NOW });
  assert.equal(report.activity.externalMergedPullRequests.complete, false);
  assert.match(renderMarkdown(report), /0 \(incomplete\)/);
  assert.ok(!report.recommendations.some(tip => tip.includes('no merged public PRs')));
});

test('a user without public repos gets a useful report', async () => {
  const { client } = fixtureClient({ repos: [] });
  const report = await analyzeProfile(client, 'alice', { now: NOW });
  assert.equal(report.scope.inspectedRepositories, 0);
  assert.match(report.recommendations[0], /one useful original/);
  assert.match(renderMarkdown(report), /No public repositories listed/);
});

test('rejects organizations rather than presenting them as people', async () => {
  const { client } = fixtureClient({ override: url => url.pathname === '/users/alice' ? Response.json({ type: 'Organization' }) : undefined });
  await assert.rejects(analyzeProfile(client, 'alice', { now: NOW }), /personal GitHub accounts/);
});

test('escapes Markdown and rejects dangerous report links', async () => {
  const { client } = fixtureClient();
  const report = await analyzeProfile(client, 'alice', { now: NOW });
  report.repositories[0].name = 'repo|<script>\n![track](https://evil.example/image)';
  report.repositories[0].url = 'javascript:alert(1)';
  report.recommendations = ['<img src=x onerror=alert(1)>\n# forged heading'];
  const markdown = renderMarkdown(report);
  for (const unexpected of ['<script>', '<img', 'javascript:', '\n# forged heading']) assert.ok(!markdown.includes(unexpected));
  assert.ok(markdown.includes('repo\\|&lt;script&gt;'));
});

test('repeated repository and commit records remain usable without inflating counts', async () => {
  const repeated = repository('tool', { id: 42 });
  const { client, seen } = fixtureClient({ repos: [repeated], override: url => {
    if (url.pathname.endsWith('/repos')) return Response.json([repeated], url.searchParams.get('page') === '1'
      ? { headers: { link: '<https://api.github.com/next>; rel="next"' } } : {});
    if (url.pathname.endsWith('/commits')) return Response.json([{ sha: 'one' }, { sha: 'one' }, { sha: 'two' }]);
  } });
  const report = await analyzeProfile(client, 'alice', { now: NOW });
  assert.equal(report.repositories.length, 1);
  assert.equal(report.scope.listedRepositories, 1);
  assert.equal(report.scope.inspectedRepositories, 1);
  assert.equal(report.scope.repositoryListComplete, false);
  assert.deepEqual(report.repositories[0].commits, { count: 2, complete: false });
  assert.equal(seen.filter(url => url.pathname.includes('/git/trees/')).length, 1);
  assert.ok(report.warnings.some(warning => /Repeated records/.test(warning)));
  const { validateProfileReport } = await import('../src/snapshot.js');
  assert.equal(validateProfileReport(report), report);
});
