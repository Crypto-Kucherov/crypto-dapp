import { validateUsername } from './github.js';
import { escapeMarkdown, link } from './report.js';

const ACTIVITY = ['pullRequests', 'issues', 'externalMergedPullRequests'];
const CHECKS = ['readme', 'license', 'tests', 'ci'];
const isCount = value => Number.isSafeInteger(value) && value >= 0;
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);

// Validate exported snapshots before arithmetic. Missing fields must never become zeros.
export function validateSnapshot(report, label = 'Snapshot') {
  const require = (condition, message) => {
    if (!condition) throw new Error(`${label}: ${message}`);
  };
  const timestamp = (value, field) => {
    require(typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value), `${field} must be a UTC ISO timestamp.`);
    const parsed = new Date(value);
    require(Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 19) === value.slice(0, 19), `${field} must be a real timestamp.`);
    return parsed.getTime();
  };
  const metric = (value, field) => {
    require(isObject(value) && typeof value.complete === 'boolean', `${field} needs a completeness flag.`);
    require(isCount(value.count) || (value.count === null && !value.complete), `${field} needs a nonnegative integer or an explicitly unknown count.`);
  };
  const warnings = (value, field) => require(value === undefined || (Array.isArray(value) && value.every(item => typeof item === 'string')), `${field} must be an array of strings.`);
  require(isObject(report) && report.schemaVersion === 1 && report.kind !== 'comparison', 'expected a profile snapshot with schemaVersion 1.');
  require(isObject(report.profile), 'profile is missing.');
  try { validateUsername(report.profile.login); } catch { throw new Error(`${label}: invalid profile login.`); }
  require(isCount(report.profile.publicRepositories), 'public repository count is missing or invalid.');
  require(isObject(report.scope) && report.scope.publicOnly === true, 'expected public-only coverage metadata.');
  require(typeof report.scope.repositoryListComplete === 'boolean', 'repository listing completeness is missing.');
  require(isCount(report.scope.maxRepos) && report.scope.maxRepos >= 1, 'repository inspection limit is missing.');
  const generated = timestamp(report.generatedAt, 'generatedAt');
  const since = timestamp(report.scope.since, 'scope.since');
  const until = timestamp(report.scope.until, 'scope.until');
  require(since <= until && until <= generated, 'activity window must end on or before generation and start on or before its end.');
  require(isObject(report.activity), 'activity is missing.');
  for (const key of ACTIVITY) metric(report.activity[key], `activity.${key}`);
  require(Array.isArray(report.repositories), 'repositories must be an array.');
  const names = new Set();
  for (const repo of report.repositories) {
    require(isObject(repo) && typeof repo.name === 'string' && repo.name.length > 0, 'each repository needs a name.');
    const key = repo.name.toLowerCase();
    require(!names.has(key), 'duplicate repository names are ambiguous.');
    names.add(key);
    require(typeof repo.inspected === 'boolean' && typeof repo.fork === 'boolean' && typeof repo.archived === 'boolean', 'repository inspection, fork and archive flags are required.');
    warnings(repo.warnings, 'repository warnings');
    if (!repo.inspected) continue;
    require(typeof repo.defaultBranch === 'string' && repo.defaultBranch.length > 0, 'inspected repositories need a default branch.');
    require(isObject(repo.checks), 'repository checks are missing.');
    for (const field of CHECKS) require(repo.checks[field] === null || typeof repo.checks[field] === 'boolean', `check ${field} must be true, false or null.`);
    require(repo.checks.sourceFiles === null || (isCount(repo.checks.sourceFiles) && typeof repo.checks.sourceFilesComplete === 'boolean'), 'source-file count needs explicit completeness.');
    metric(repo.commits, 'repository commits');
    require(isObject(repo.release) && ['present', 'absent', 'unknown'].includes(repo.release.status), 'release status is missing or invalid.');
    if (repo.release.status === 'present') require(typeof repo.release.tag === 'string' && repo.release.tag.length > 0, 'present release needs a tag.');
  }
  warnings(report.warnings, 'warnings');
  return report;
}

function compareMetric(before, after, reason = null) {
  if (before.count === null || after.count === null) reason = 'A count is unknown.';
  else if (!before.complete || !after.complete) reason = 'A count is incomplete.';
  return {
    before: { count: before.count, complete: before.complete },
    after: { count: after.count, complete: after.complete },
    delta: reason ? null : after.count - before.count,
    comparable: !reason,
    reason,
  };
}

function compareValue(before, after) {
  return { before, after, changed: before === null || after === null ? null : before !== after };
}

export function compareSnapshots(before, after, { now = new Date() } = {}) {
  validateSnapshot(before, 'Before snapshot');
  validateSnapshot(after, 'After snapshot');
  if (before.profile.login.toLowerCase() !== after.profile.login.toLowerCase()) throw new Error('Both snapshots must belong to the same GitHub account.');
  if (new Date(before.generatedAt) > new Date(after.generatedAt)) throw new Error('The first snapshot must be older than or equal to the second snapshot.');
  const sameStart = Date.parse(before.scope.since) === Date.parse(after.scope.since);
  const sameEnd = Date.parse(before.scope.until) === Date.parse(after.scope.until);
  const windowKind = sameStart && sameEnd ? 'identical'
    : sameStart && Date.parse(after.scope.until) > Date.parse(before.scope.until) ? 'expanded' : 'different';
  const windowReason = windowKind === 'different' ? 'Activity windows differ; these totals cannot establish new activity.' : null;
  const warnings = [];
  if (windowKind === 'expanded') warnings.push('The activity window expanded with the same start date. Deltas are net count changes, not proof of newly authored work.');
  if (windowReason) warnings.push(windowReason);
  if (!before.scope.repositoryListComplete || !after.scope.repositoryListComplete) warnings.push('A repository list is incomplete. An omitted repository may simply be outside the fetched pages.');
  if (before.scope.maxRepos !== after.scope.maxRepos) warnings.push('Repository inspection limits differ. Missing inspection results are not regressions.');
  for (const [label, snapshot] of [['Before', before], ['After', after]]) {
    for (const warning of snapshot.warnings || []) warnings.push(`${label}: ${warning}`);
    for (const repo of snapshot.repositories) for (const warning of repo.warnings || []) warnings.push(`${label}, ${repo.name}: ${warning}`);
  }
  const metrics = { publicRepositories: compareMetric(
    { count: before.profile.publicRepositories, complete: true },
    { count: after.profile.publicRepositories, complete: true }),
  };
  for (const key of ACTIVITY) metrics[key] = compareMetric(before.activity[key], after.activity[key], windowReason);
  for (const [key, value] of Object.entries(metrics)) if (!value.comparable) warnings.push(`${key}: ${value.reason}`);
  const oldRepos = new Map(before.repositories.map(repo => [repo.name.toLowerCase(), repo]));
  const newRepos = new Map(after.repositories.map(repo => [repo.name.toLowerCase(), repo]));
  const listedOnlyAfter = after.repositories.filter(repo => !oldRepos.has(repo.name.toLowerCase())).map(repo => ({
    name: repo.name, url: repo.url, absentFromOtherCompleteList: before.scope.repositoryListComplete,
  }));
  const listedOnlyBefore = before.repositories.filter(repo => !newRepos.has(repo.name.toLowerCase())).map(repo => ({
    name: repo.name, url: repo.url, absentFromOtherCompleteList: after.scope.repositoryListComplete,
  }));
  const compared = [];
  for (const repo of after.repositories) {
    const old = oldRepos.get(repo.name.toLowerCase());
    if (!old || (!old.inspected && !repo.inspected)) continue;
    const result = { name: repo.name, url: repo.url, beforeInspected: old.inspected, afterInspected: repo.inspected };
    if (!old.inspected || !repo.inspected) {
      result.reason = 'Repository was not inspected in both snapshots; file and commit changes are unknown.';
      warnings.push(`${repo.name}: ${result.reason}`);
      compared.push(result);
      continue;
    }
    result.checks = Object.fromEntries(CHECKS.map(field => [field, compareValue(old.checks[field], repo.checks[field])]));
    result.sourceFiles = compareMetric(
      { count: old.checks.sourceFiles, complete: old.checks.sourceFilesComplete === true },
      { count: repo.checks.sourceFiles, complete: repo.checks.sourceFilesComplete === true });
    const branchReason = old.defaultBranch !== repo.defaultBranch ? 'Default branch changed; commit histories differ.' : null;
    result.commits = compareMetric(old.commits, repo.commits, branchReason || windowReason);
    const tag = release => release.status === 'present' ? release.tag : release.status === 'absent' ? null : undefined;
    result.release = {
      before: { status: old.release.status, tag: tag(old.release) ?? null },
      after: { status: repo.release.status, tag: tag(repo.release) ?? null },
      changed: tag(old.release) === undefined || tag(repo.release) === undefined ? null
        : old.release.status !== repo.release.status || tag(old.release) !== tag(repo.release),
    };
    if (branchReason) warnings.push(`${repo.name}: ${branchReason}`);
    if (Object.values(result.checks).some(value => value.changed === null) || result.release.changed === null
      || !result.sourceFiles.comparable || !result.commits.comparable) {
      warnings.push(`${repo.name}: some values cannot be compared; unknown or incomplete evidence is not a regression.`);
    }
    compared.push(result);
  }
  const snapshotSummary = snapshot => ({ generatedAt: snapshot.generatedAt, since: snapshot.scope.since,
    until: snapshot.scope.until, repositoryListComplete: snapshot.scope.repositoryListComplete, maxRepos: snapshot.scope.maxRepos });
  return {
    schemaVersion: 1, kind: 'comparison', generatedAt: now.toISOString(),
    profile: { login: after.profile.login, url: after.profile.url },
    before: snapshotSummary(before), after: snapshotSummary(after), windowKind,
    metrics, repositoryChanges: { listedOnlyAfter, listedOnlyBefore, compared },
    warnings: [...new Set(warnings)],
    limitations: [
      'This offline comparison describes saved public GitHub evidence, not Legion Score or developer quality.',
      'Counts are net snapshot differences. Search indexing, rewritten history and changed visibility can affect them; a negative difference does not prove lost contributions.',
      'Repositories listed in only one snapshot may be renamed, transferred, made private or omitted from incomplete pages; this is not proof of creation or deletion.',
      'File and release checks describe each snapshot’s repository state. Test and CI paths do not establish passing tests or successful runs.',
    ],
  };
}

const formatCount = metric => metric.count === null ? 'Unknown' : `${metric.count}${metric.complete ? '' : ' (incomplete)'}`;
const change = metric => metric.delta === null ? 'Not comparable' : metric.delta > 0 ? `+${metric.delta}` : String(metric.delta);
const flag = value => value === true ? 'Found' : value === false ? 'Not detected' : 'Unknown';
const transition = value => value.changed === null ? 'Uncertain' : value.changed ? 'Changed' : 'Unchanged';

export function renderComparison(comparison) {
  const { before, after, metrics, repositoryChanges } = comparison;
  const lines = [
    `# GitHub snapshot comparison: ${escapeMarkdown(comparison.profile.login)}`, '',
    `Profile: ${link(comparison.profile.login, comparison.profile.url)}`, '',
    '| Snapshot | Generated (UTC) | Activity start | Activity end |',
    '| --- | --- | --- | --- |',
    `| Before | ${before.generatedAt} | ${before.since} | ${before.until} |`,
    `| After | ${after.generatedAt} | ${after.since} | ${after.until} |`, '',
    `Activity windows: **${comparison.windowKind}**.`, '',
    '## Activity and repository totals', '',
    '| Metric | Before | After | Net change |', '| --- | --- | --- | --- |',
  ];
  const labels = { publicRepositories: 'Public repositories', pullRequests: 'Public PRs created',
    issues: 'Public issues created', externalMergedPullRequests: 'External public PRs merged' };
  for (const [key, metric] of Object.entries(metrics)) lines.push(`| ${labels[key]} | ${formatCount(metric.before)} | ${formatCount(metric.after)} | ${change(metric)} |`);
  lines.push('', '## Repository visibility', '');
  for (const [label, repos] of [['Listed only after', repositoryChanges.listedOnlyAfter], ['Listed only before', repositoryChanges.listedOnlyBefore]]) {
    lines.push(`- ${label}: ${repos.length ? repos.map(repo => `${link(repo.name, repo.url)}${repo.absentFromOtherCompleteList ? '' : ' (other listing incomplete)'}`).join(', ') : 'None observed'}.`);
  }
  lines.push('', '## Repository evidence', '');
  if (!repositoryChanges.compared.length) lines.push('No repository was present in both snapshots and inspected in at least one.');
  for (const repo of repositoryChanges.compared) {
    lines.push(`### ${link(repo.name, repo.url)}`, '');
    if (repo.reason) { lines.push(escapeMarkdown(repo.reason), ''); continue; }
    lines.push('| Signal | Before | After | Change |', '| --- | --- | --- | --- |',
      `| Attributed commits | ${formatCount(repo.commits.before)} | ${formatCount(repo.commits.after)} | ${change(repo.commits)} |`,
      `| Detected source files | ${formatCount(repo.sourceFiles.before)} | ${formatCount(repo.sourceFiles.after)} | ${change(repo.sourceFiles)} |`);
    for (const [field, value] of Object.entries(repo.checks)) lines.push(`| ${{ readme: 'README', license: 'License', tests: 'Test paths', ci: 'Actions workflow paths' }[field]} | ${flag(value.before)} | ${flag(value.after)} | ${transition(value)} |`);
    const release = value => value.status === 'present' ? escapeMarkdown(value.tag) : value.status === 'absent' ? 'None published' : 'Unknown';
    lines.push(`| Stable release | ${release(repo.release.before)} | ${release(repo.release.after)} | ${transition(repo.release)} |`, '');
  }
  if (comparison.warnings.length) lines.push('## Comparison warnings', '', ...comparison.warnings.map(warning => `- ${escapeMarkdown(warning)}`), '');
  lines.push('## Interpretation', '', ...comparison.limitations.map(note => `- ${escapeMarkdown(note)}`), '');
  return lines.join('\n');
}
