import { GitHubError, validateUsername } from './github.js';

const DAY = 86400000;
const UNKNOWN_CHECKS = { readme: null, license: null, tests: null, ci: null, sourceFiles: null };
const SOURCE_EXTENSION = /\.(?:[cm]?[jt]sx?|py|rs|go|sol|vy|java|kt|swift|c|h|cc|hh|cpp|hpp|cxx|hxx|cs|rb|php|ex|exs|sh|vue|svelte)$/i;
const IGNORED_DIRECTORY = /(^|\/)(?:node_modules|vendor|dist|build|coverage|\.git|\.venv|venv|\.tox|\.nox|__pycache__|__pypackages__|\.pytest_cache|\.mypy_cache|\.next|\.nuxt|\.svelte-kit|\.yarn)\//i;

function isTreeResponse(tree) {
  return tree !== null && typeof tree === 'object' && Array.isArray(tree.tree)
    && typeof tree.truncated === 'boolean'
    && tree.tree.every(entry => entry !== null && typeof entry === 'object'
      && ['blob', 'tree', 'commit'].includes(entry.type)
      && typeof entry.path === 'string' && entry.path.length > 0);
}

function isStableRelease(release) {
  if (!release || typeof release.tag_name !== 'string' || !release.tag_name.trim()
    || release.draft !== false || release.prerelease !== false || typeof release.html_url !== 'string') return false;
  try {
    const url = new URL(release.html_url);
    return url.protocol === 'https:' && url.hostname === 'github.com' && !url.username && !url.password;
  } catch { return false; }
}

function isTestPath(path) {
  // A README or data fixture in tests/ alone is not evidence of test code.
  if (!SOURCE_EXTENSION.test(path)) return false;
  if (/(^|\/)(__tests__|tests?|specs?)\//i.test(path)) return true;
  const name = path.slice(path.lastIndexOf('/') + 1);
  return /^.+[.-](test|spec)\.[cm]?[jt]sx?$/i.test(name)
    || /^(?:test_.+|.+(?:_test|[.-]test))\.(?:c|cc|cpp|cxx)$/i.test(name)
    || /^(?:test_.+\.py|.+_test\.(?:go|py|rs|rb|exs)|.+_spec\.rb|.+\.t\.sol)$/i.test(name)
    // Keep class-style test markers case-sensitive: Contest.php is not a test.
    || /^(?:Test[A-Z0-9_][\w.-]*|[\w.-]+Tests?)\.(?:java|kt|cs|php)$/.test(name);
}

function parseDate(value, option) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`${option} must use YYYY-MM-DD.`);
  const date = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new Error(`${option} must be a real calendar date.`);
  }
  return date;
}

export function parseSince(value, now) {
  if (value === undefined) return new Date(now.getTime() - 90 * DAY).toISOString();
  const date = parseDate(value, '--since');
  if (date > now) throw new Error('--since cannot be in the future.');
  return date.toISOString();
}

export function parseUntil(value, now) {
  if (value === undefined) return now.toISOString();
  const date = parseDate(value, '--until');
  if (date > now) throw new Error('--until cannot be in the future.');
  // Past days include their final millisecond; today stops at collection time.
  return new Date(Math.min(date.getTime() + DAY - 1, now.getTime())).toISOString();
}

export function inspectTree(tree, licenseMetadata = null) {
  if (!isTreeResponse(tree)) return { ...UNKNOWN_CHECKS };
  const paths = tree.tree.filter(entry => entry.type === 'blob').map(entry => entry.path);
  const meaningful = paths.filter(path => !IGNORED_DIRECTORY.test(path));
  const exists = regex => meaningful.some(path => regex.test(path)) ? true : (tree.truncated ? null : false);
  const readme = exists(/^(?:\.github\/|docs\/)?readme(?:\.(md|markdown|mdown|mkdn|rst|txt|textile|rdoc|org|creole|mediawiki|wiki|asciidoc|adoc|asc|pod))?$/i);
  const license = licenseMetadata?.spdx_id && licenseMetadata.spdx_id !== 'NOASSERTION'
    ? true : exists(/^(licen[cs]e|copying)(?:[.-][^/]+)?$/i);
  const tests = meaningful.some(isTestPath) ? true : (tree.truncated ? null : false);
  const ci = exists(/^\.github\/workflows\/[^/]+\.ya?ml$/i);
  const sourceFiles = meaningful.filter(path => !path.startsWith('.github/')
    && SOURCE_EXTENSION.test(path)).length;
  return { readme, license, tests, ci, sourceFiles, sourceFilesComplete: !tree.truncated };
}

async function searchCount(client, query) {
  try {
    const { data } = await client.get(`/search/issues?${new URLSearchParams({ q: query, per_page: '1' })}`);
    if (!Number.isSafeInteger(data?.total_count) || data.total_count < 0 || typeof data.incomplete_results !== 'boolean') {
      throw new GitHubError('Unexpected GitHub search response.');
    }
    return { count: data.total_count, complete: !data.incomplete_results,
      warning: data.incomplete_results ? 'GitHub search reported incomplete results.' : null };
  } catch (error) {
    return { count: null, complete: false, warning: error.message };
  }
}

async function inspectRepository(client, repo, username, since, until) {
  const base = `/repos/${encodeURIComponent(username)}/${encodeURIComponent(repo.name)}`;
  const result = {
    ...(Number.isSafeInteger(repo.id) && repo.id > 0 ? { id: repo.id } : {}),
    name: repo.name,
    url: repo.html_url,
    description: repo.description,
    fork: repo.fork,
    archived: repo.archived,
    defaultBranch: repo.default_branch,
    language: repo.language,
    pushedAt: repo.pushed_at,
    stars: repo.stargazers_count,
    inspected: true,
    checks: { ...UNKNOWN_CHECKS },
    commits: { count: null, complete: false },
    release: { status: 'unknown', tag: null, url: null },
    warnings: [],
  };
  try {
    const { data } = await client.get(`${base}/git/trees/${encodeURIComponent(repo.default_branch)}?recursive=1`);
    if (!isTreeResponse(data)) throw new GitHubError('Unexpected repository tree response.');
    result.checks = inspectTree(data, repo.license);
    if (data.truncated) result.warnings.push('File tree is truncated; missing files cannot be ruled out.');
  } catch (error) {
    if (error.emptyRepository) result.checks = inspectTree({ tree: [], truncated: false });
    else result.warnings.push(`File checks: ${error.message}`);
  }
  try {
    const params = new URLSearchParams({ author: username, sha: repo.default_branch, since, until });
    const commits = await client.paginate(`${base}/commits?${params}`, { maxPages: 3, itemKeys: commit => [commit.sha] });
    result.commits = { count: commits.items.length, complete: commits.complete };
    if (commits.warning) result.warnings.push(`Commit count: ${commits.warning}`);
  } catch (error) {
    if (error.emptyRepository) result.commits = { count: 0, complete: true };
    else result.warnings.push(`Commit count: ${error.message}`);
  }
  try {
    const { data } = await client.get(`${base}/releases/latest`);
    if (!isStableRelease(data)) throw new GitHubError('Unexpected GitHub stable release response.');
    result.release = { status: 'present', tag: data.tag_name, url: data.html_url };
  } catch (error) {
    if (error.status === 404) result.release = { status: 'absent', tag: null, url: null };
    else result.warnings.push(`Release check: ${error.message}`);
  }
  return result;
}

export function recommend(report) {
  const tips = [];
  const originals = report.repositories.filter(repo => !repo.fork);
  const active = originals.filter(repo => !repo.archived);
  if (report.scope.repositoryListComplete && active.length === 0) {
    tips.push('Build or maintain one useful original public project with a reproducible example.');
  }
  for (const repo of active.filter(repo => repo.inspected)) {
    if (repo.checks.sourceFiles === 0 && repo.checks.sourceFilesComplete) {
      tips.push(`${repo.name}: if this is a code project, ship a working implementation and example; documentation-only projects may intentionally have no code.`);
    }
    if (repo.checks.readme === false) tips.push(`${repo.name}: add a README in the root, .github/ or docs/ with purpose, installation and a reproducible example.`);
    if (repo.checks.license === false) tips.push(`${repo.name}: choose an appropriate license if you intend to share this as open source.`);
    if (repo.checks.sourceFiles > 0 && repo.checks.tests === false) tips.push(`${repo.name}: add tests for important behavior; no conventional test paths were detected.`);
    if (repo.checks.tests === true && repo.checks.ci === false) tips.push(`${repo.name}: consider running tests in GitHub Actions; no workflow file was detected.`);
    if (repo.checks.sourceFiles > 0 && repo.release.status === 'absent') tips.push(`${repo.name}: publish a release with usage notes when the project is ready.`);
  }
  if (report.activity.externalMergedPullRequests.count === 0 && report.activity.externalMergedPullRequests.complete) {
    tips.push('Contribute a useful fix, test or example to a project you use; no merged public PRs outside your repositories were found in this window.');
  }
  if (tips.length === 0) tips.push('Review the report’s coverage, reproduce your project’s setup, and choose a useful improvement based on real users’ needs.');
  return tips;
}

export async function analyzeProfile(client, username, { since: sinceInput, until: untilInput, maxRepos = 10, now = new Date() } = {}) {
  validateUsername(username);
  if (!Number.isInteger(maxRepos) || maxRepos < 1 || maxRepos > 50) throw new Error('--max-repos must be an integer from 1 to 50.');
  const until = parseUntil(untilInput, now);
  const since = parseSince(sinceInput, sinceInput === undefined ? new Date(until) : now);
  if (!/^\d{4}-/.test(since)) throw new Error('The default window starts before year 0000; specify --since.');
  if (Date.parse(since) > Date.parse(until)) throw new Error('--since must be on or before --until.');
  const { data: profile } = await client.get(`/users/${encodeURIComponent(username)}`);
  if (profile.type !== 'User') throw new Error('This tool reports on personal GitHub accounts, not organizations.');
  if (!Number.isSafeInteger(profile.id) || profile.id <= 0) throw new GitHubError('Unexpected GitHub profile ID.');
  username = validateUsername(profile.login);
  const listing = await client.paginate(`/users/${encodeURIComponent(username)}/repos?type=owner&sort=pushed&direction=desc`, {
    itemKeys: repo => [repo.name.toLowerCase(), ...(Number.isSafeInteger(repo.id) && repo.id > 0 ? [`id:${repo.id}`] : [])],
  });
  // Filter explicitly even with a token: never include private repositories in an exported report.
  const publicRepos = listing.items.filter(repo => repo.private === false);
  const eligible = publicRepos.filter(repo => !repo.fork && !repo.archived);
  const selectedNames = new Set(eligible.slice(0, maxRepos).map(repo => repo.name));
  const dateWindow = `${since}..${until}`;
  const activity = {
    pullRequests: await searchCount(client, `author:${username} is:pr is:public created:${dateWindow}`),
    issues: await searchCount(client, `author:${username} is:issue is:public created:${dateWindow}`),
    externalMergedPullRequests: await searchCount(client, `author:${username} is:pr is:public is:merged -user:${username} merged:${dateWindow}`),
  };
  const repositories = [];
  // Sequential requests keep pressure on the API low and stop quickly on rate limits.
  for (const repo of publicRepos) {
    if (selectedNames.has(repo.name)) {
      repositories.push(await inspectRepository(client, repo, username, since, until));
    } else {
      repositories.push({ ...(Number.isSafeInteger(repo.id) && repo.id > 0 ? { id: repo.id } : {}),
        name: repo.name, url: repo.html_url, description: repo.description,
        fork: repo.fork, archived: repo.archived, language: repo.language, stars: repo.stargazers_count,
        pushedAt: repo.pushed_at, inspected: false,
        skipReason: repo.fork ? 'fork' : repo.archived ? 'archived' : 'inspection limit' });
    }
  }
  const warnings = [];
  if (!listing.complete) warnings.push(`Repository listing: ${listing.warning}`);
  if (eligible.length > maxRepos) warnings.push(`Only the ${maxRepos} most recently pushed active original repositories were inspected.`);
  for (const [name, value] of Object.entries(activity)) if (value.warning) warnings.push(`${name}: ${value.warning}`);
  const report = {
    schemaVersion: 1,
    generatedAt: now.toISOString(),
    profile: { id: profile.id, login: username, name: profile.name, url: profile.html_url, bio: profile.bio,
      createdAt: profile.created_at, publicRepositories: profile.public_repos,
      followers: profile.followers, following: profile.following },
    scope: { publicOnly: true, since, until, repositoryListComplete: listing.complete,
      listedRepositories: publicRepos.length, inspectedRepositories: selectedNames.size,
      maxRepos, apiRequests: client.requests },
    activity,
    repositories,
    warnings,
    limitations: [
      'This is a public GitHub report. It does not calculate or predict Legion Score, allocation eligibility or investment returns.',
      'Commit counts cover attributed commits on inspected repositories’ current default branches in the selected time window; they are not the GitHub contribution calendar.',
      'Forks and archived repositories are listed but not inspected. Repository push dates may reflect other contributors’ work.',
      'PR and issue searches cover public records only. External means outside repositories owned by this account, not an endorsement or a quality measure.',
      'File checks are path heuristics. A detected test or CI file does not establish that it runs or passes; a missing path may use a different convention.',
      'A release means the latest published, non-draft, non-prerelease GitHub release. Unknown checks and incomplete counts must not be treated as zero.',
    ],
  };
  report.recommendations = recommend(report);
  return report;
}
