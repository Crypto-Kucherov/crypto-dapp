import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { renderHtml } from '../src/html.js';
import { compareSnapshots } from '../src/compare.js';
import { main } from '../src/index.js';

const beforePath = new URL('../examples/crypto-kucherov.json', import.meta.url);
const afterPath = new URL('../examples/crypto-kucherov-after.json', import.meta.url);
const before = JSON.parse(await readFile(beforePath, 'utf8'));
const after = JSON.parse(await readFile(afterPath, 'utf8'));
const profile = () => structuredClone(after);
const repo = report => report.repositories.find(item => item.inspected);

test('profile HTML includes dated coverage, metrics, skipped repos and interpretation', () => {
  const html = renderHtml(profile());
  for (const value of ['<!doctype html>', '<html lang="en">', '<main>', 'Crypto-Kucherov',
    '2026-09-27T14:03:24.715Z', '2025-01-01T00:00:00.000Z', 'Public PRs in window',
    'Snapshot coverage', 'Attributed commits in window', 'Detected source files',
    'Test paths', 'Actions workflow paths', 'v0.1.0', 'Not inspected: fork',
    'Suggested next steps', 'How to interpret this report', 'not live statistics']) assert.ok(html.includes(value), value);
  assert.match(html, /<caption>/);
  assert.match(html, /<th scope="row">/);
  assert.match(html, /<th scope="col">/);
  assert.match(html, /role="region"[^>]+tabindex="0"/);
});

test('HTML preserves unknown values and incomplete counts with their warnings', () => {
  const report = profile();
  report.activity.pullRequests = { count: null, complete: false };
  report.activity.issues = { count: 3, complete: false };
  report.scope.repositoryListComplete = false;
  report.warnings = ['GitHub search was incomplete'];
  repo(report).commits = { count: 300, complete: false };
  repo(report).checks.tests = null;
  repo(report).checks.sourceFiles = null;
  repo(report).release = { status: 'unknown' };
  repo(report).warnings = ['File tree unavailable'];
  const html = renderHtml(report);
  assert.match(html, /<dt>Public PRs in window<\/dt><dd>Unknown<\/dd>/);
  assert.match(html, /3 <span class="muted">\(incomplete\)<\/span>/);
  assert.match(html, /300 <span class="muted">\(incomplete\)<\/span>/);
  assert.match(html, /Test paths<\/th><td>Unknown/);
  assert.match(html, /Latest stable release<\/th><td>Unknown/);
  assert.match(html, /Coverage warnings/);
  assert.match(html, /crypto-dapp: File tree unavailable/);
  assert.ok(html.indexOf('GitHub search was incomplete') < html.indexOf('Snapshot coverage'));
});

test('empty profiles and empty comparisons have explicit readable empty states', () => {
  const report = profile();
  report.repositories = [];
  report.profile.publicRepositories = report.scope.listedRepositories = report.scope.inspectedRepositories = 0;
  assert.match(renderHtml(report), /No public repositories listed/);
  const comparison = renderHtml(compareSnapshots(report, report));
  assert.match(comparison, /No repository was present in both snapshots/);
  assert.match(comparison, /None observed/);
});

test('profile-controlled HTML and attribute payloads remain escaped text', () => {
  const report = profile();
  const payload = '</style><script>alert("x")</script><img src=x onerror="alert(1)"> & \'quoted\'';
  report.profile.login = payload;
  report.profile.url = 'javascript:alert(1)';
  report.profile.createdAt = payload;
  report.generatedAt = payload;
  report.scope.since = payload;
  report.recommendations = [payload];
  report.limitations = [payload];
  report.warnings = [payload];
  repo(report).name = repo(report).defaultBranch = repo(report).pushedAt = payload;
  repo(report).url = 'https://github.com.evil.example/';
  repo(report).release = { status: 'present', tag: payload, url: 'data:text/html,evil' };
  const skipped = report.repositories.find(item => !item.inspected);
  skipped.skipReason = payload;
  const html = renderHtml(report);
  for (const unsafe of ['<script', '<img', 'javascript:', 'data:text/html', 'github.com.evil.example']) assert.ok(!html.includes(unsafe), unsafe);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /&quot;x&quot;/);
  assert.match(html, /&amp; &#39;quoted&#39;/);
  assert.equal((html.match(/<style>/g) || []).length, 1);
  assert.equal((html.match(/<\/style>/g) || []).length, 1);
});

test('HTML permits only credential-free HTTPS GitHub links and escapes URL attributes', () => {
  for (const url of ['javascript:alert(1)', 'http://github.com/alice', '//github.com/alice',
    'https://github.com:8443/alice', 'https://github.com:80/alice',
    'https://github.com.evil.example/alice', 'https://alice:secret@github.com/alice', 'not a URL']) {
    const report = profile();
    report.profile.url = url;
    const header = renderHtml(report).split('</header>')[0];
    assert.ok(!header.includes('<a '), url);
  }
  const report = profile();
  report.profile.url = 'https://github.com/Crypto-Kucherov?a=1&b="test"';
  assert.match(renderHtml(report), /href="https:\/\/github\.com\/Crypto-Kucherov\?a=1&amp;b=%22test%22" rel="noreferrer"/);
  report.profile.url = 'https://GITHUB.com:443/alice';
  assert.match(renderHtml(report).split('</header>')[0], /href="https:\/\/github\.com\/alice"/);
});

test('standalone pages carry a valid stylesheet CSP hash and no executable or remote assets', () => {
  for (const html of [renderHtml(profile()), renderHtml(compareSnapshots(before, after))]) {
    const css = html.match(/<style>([\s\S]*?)<\/style>/)[1];
    const hash = createHash('sha256').update(css).digest('base64');
    assert.ok(html.includes(`sha256-${hash}`));
    assert.match(html, /default-src &#39;none&#39;/);
    assert.match(html, /base-uri &#39;none&#39;; form-action &#39;none&#39;/);
    assert.ok(!/<(?:script|img|iframe|object|embed|link|form)\b/i.test(html));
    assert.ok(!/\b(?:src|onload|onclick|onerror)=|@import|url\(/i.test(html));
    assert.match(html, /@media print/);
  }
});

test('comparison HTML reports net changes and puts interpretation warnings before totals', () => {
  const html = renderHtml(compareSnapshots(before, after));
  assert.match(html, /Public PRs created<\/th><td>0<\/td><td>1<\/td><td>\+1/);
  assert.match(html, /Test paths<\/th><td>Not detected<\/td><td>Found<\/td><td>Changed/);
  assert.match(html, /Stable release<\/th><td>None published<\/td><td>v0.1.0/);
  assert.match(html, /expanded/);
  assert.ok(html.indexOf('Comparison warnings') < html.indexOf('Activity and repository totals'));
  assert.match(html, /not proof of newly authored work/);
});

test('comparison HTML preserves unavailable deltas and inspection or listing uncertainty', () => {
  const old = structuredClone(before), current = profile();
  current.scope.since = '2026-06-01T00:00:00.000Z';
  repo(old).checks.tests = null;
  old.scope.repositoryListComplete = false;
  const added = structuredClone(repo(current));
  added.name = 'newly-visible';
  current.repositories.push(added);
  const html = renderHtml(compareSnapshots(old, current));
  assert.match(html, /Public PRs created<\/th><td>0<\/td><td>1<\/td><td>Not comparable/);
  assert.match(html, /Test paths<\/th><td>Unknown<\/td><td>Found<\/td><td>Uncertain/);
  assert.match(html, /newly-visible/);
  assert.match(html, /other listing incomplete/);
  repo(current).inspected = false;
  assert.match(renderHtml(compareSnapshots(old, current)), /not inspected in both snapshots/);
});

test('comparison HTML escapes untrusted repository names, release tags and warnings', () => {
  const old = structuredClone(before), current = profile();
  repo(old).name = repo(current).name = '<img src=x onerror=alert(1)>';
  repo(current).url = 'javascript:alert(1)';
  repo(current).release = { status: 'present', tag: '</td><script>bad()</script>' };
  current.warnings = ['<iframe src="https://evil.example">'];
  const html = renderHtml(compareSnapshots(old, current));
  assert.ok(!/<(?:img|script|iframe)\b/.test(html));
  assert.ok(!html.includes('javascript:'));
  assert.match(html, /&lt;img/);
  assert.match(html, /&lt;script&gt;bad\(\)&lt;\/script&gt;/);
});

test('offline comparison CLI writes HTML and never overwrites an earlier export', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'html-report-'));
  try {
    const output = join(dir, 'nested', 'comparison.html');
    const captured = { stdout: '', stderr: '' };
    const options = { client: { get() { throw new Error('No network allowed'); } },
      stdout: { write(text) { captured.stdout += text; } }, stderr: { write(text) { captured.stderr += text; } } };
    const args = ['--compare', beforePath.pathname, afterPath.pathname, '--format', 'html', '--out', output];
    assert.equal(await main(args, options), 0);
    const html = await readFile(output, 'utf8');
    assert.ok(html.startsWith('<!doctype html>'));
    assert.match(html, /Snapshot comparison/);
    assert.equal(captured.stdout, '');
    assert.match(captured.stderr, /comparison warnings/);
    assert.equal(await main(args, options), 1);
    assert.match(captured.stderr, /already exists/);
    assert.equal(await readFile(output, 'utf8'), html);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
