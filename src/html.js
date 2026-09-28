import { createHash } from 'node:crypto';

// No scripts, remote assets or runtime dependencies. Every data value is escaped.
const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[char]));

function link(label, url) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === 'https:' && parsed.hostname === 'github.com' && !parsed.username && !parsed.password) {
      return `<a href="${escape(parsed.href)}" rel="noreferrer">${escape(label)}</a>`;
    }
  } catch { /* Invalid URLs remain plain text. */ }
  return escape(label);
}

const count = metric => metric?.count == null ? 'Unknown'
  : `${escape(metric.count)}${metric.complete ? '' : ' <span class="muted">(incomplete)</span>'}`;
const flag = value => value === true ? 'Found' : value === false ? 'Not detected' : 'Unknown';
const change = metric => metric.delta === null ? 'Not comparable' : escape(metric.delta > 0 ? `+${metric.delta}` : metric.delta);
const transition = value => value.changed === null ? 'Uncertain' : value.changed ? 'Changed' : 'Unchanged';
const release = value => value.status === 'present' ? link(value.tag, value.url)
  : value.status === 'absent' ? 'None published' : 'Unknown';
const list = items => `<ul>${items.map(item => `<li>${escape(item)}</li>`).join('')}</ul>`;
const section = (heading, body, className = '') => `<section class="${className}"><h2>${escape(heading)}</h2>${body}</section>`;

// Cell HTML is produced only by the helpers above or by fixed markup below.
function table(caption, headings, rows) {
  return `<div class="table-scroll" role="region" aria-label="${escape(caption)}" tabindex="0"><table>
<caption>${escape(caption)}</caption><thead><tr>${headings.map(heading => `<th scope="col">${escape(heading)}</th>`).join('')}</tr></thead>
<tbody>${rows.map(row => `<tr>${row.map((cell, index) => index === 0 ? `<th scope="row">${cell}</th>` : `<td>${cell}</td>`).join('')}</tr>`).join('\n')}</tbody></table></div>`;
}

const CSS = `
:root { color-scheme: light; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #1c2940; background: #f3f5f9; }
* { box-sizing: border-box; }
body { margin: 0; line-height: 1.6; }
main { max-width: 1120px; margin: auto; padding: 48px 24px; }
header { border-top: 5px solid #465ad5; padding: 28px 0 20px; }
.eyebrow { color: #4654b7; font-size: .76rem; font-weight: 750; letter-spacing: .14em; text-transform: uppercase; }
h1 { font-size: clamp(1.9rem, 5vw, 3rem); letter-spacing: -.04em; line-height: 1.15; margin: 12px 0 16px; }
h1 span { display: block; color: #596580; font-size: .55em; letter-spacing: -.01em; margin-top: 12px; }
h2 { font-size: 1.25rem; line-height: 1.35; margin: 0 0 16px; }
h3 { font-size: 1.04rem; margin: 24px 0 12px; }
p { margin: 8px 0; }
a { color: #3148b1; text-decoration-thickness: 1px; text-underline-offset: 3px; }
a:hover { color: #16277c; }
a:focus-visible, .table-scroll:focus-visible { outline: 3px solid #a44300; outline-offset: 4px; }
section { background: #fff; border: 1px solid #dfe4ed; border-radius: 14px; padding: 24px; margin: 20px 0; }
.notice { background: #fff8e7; border-color: #e8d2a0; }
.notice h2 { color: #77500c; }
.muted, footer { color: #5b667d; }
.cards { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 14px; margin: 16px 0 24px; }
.card { background: #fff; border: 1px solid #dfe4ed; border-radius: 12px; padding: 20px; }
.card dt { font-size: .82rem; color: #5b667d; }
.card dd { margin: 8px 0 0; font-size: 1.75rem; line-height: 1.2; font-weight: 700; }
.card dd .muted { font-size: .75rem; display: block; margin-top: 8px; }
header p, h1, h3, li, td, th, .card { overflow-wrap: anywhere; }
.table-scroll { overflow-x: auto; border: 1px solid #e2e7ef; border-radius: 8px; }
table { border-collapse: collapse; width: 100%; font-size: .87rem; text-align: left; }
caption { text-align: left; font-weight: 600; padding: 12px 14px; background: #f8f9fc; }
th, td { padding: 12px 14px; border-top: 1px solid #e2e7ef; vertical-align: top; min-width: 96px; }
thead th { font-size: .76rem; color: #5b667d; background: #f8f9fc; }
tbody th { font-weight: 600; }
tbody tr:nth-child(even) { background: #fafbfe; }
ul { padding-left: 22px; margin: 8px 0 0; }
li + li { margin-top: 8px; }
footer { border-top: 1px solid #dfe4ed; padding-top: 18px; font-size: .82rem; }
@media (max-width: 720px) { main { padding: 20px 16px; } section { padding: 18px; } .cards { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@media print { :root { background: #fff; color: #000; } main { max-width: none; padding: 0; } header { padding-top: 12px; } section, .card { border-radius: 0; } .cards { gap: 8px; } .table-scroll { overflow: visible; } table { font-size: 9pt; } th, td { min-width: 0; padding: 6px; } tr { break-inside: avoid; } h2, h3 { break-after: avoid; } a { color: inherit; } }
`;

function document(report, title, body) {
  const styleHash = createHash('sha256').update(CSS).digest('base64');
  const policy = `default-src 'none'; style-src 'sha256-${styleHash}'; base-uri 'none'; form-action 'none'`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${escape(policy)}">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
<title>${escape(title)} — ${escape(report.profile.login)}</title>
<style>${CSS}</style>
</head>
<body><main>
<header><div class="eyebrow">GitHub Activity Report</div>
<h1>${escape(title)}<span>${link(report.profile.login, report.profile.url)}</span></h1>
<p class="muted">Generated (UTC): ${escape(report.generatedAt)}</p>
<p>Saved public GitHub evidence. This report does not calculate or predict Legion Score.</p></header>
${body}
<footer>Standalone report · No scripts or remote assets · Values describe the dated snapshot, not live statistics.</footer>
</main></body>
</html>
`;
}

function renderProfile(report) {
  const cards = [
    ['Public repositories', escape(report.profile.publicRepositories)],
    ['Public PRs in window', count(report.activity.pullRequests)],
    ['Public issues in window', count(report.activity.issues)],
    ['External PRs merged in window', count(report.activity.externalMergedPullRequests)],
  ];
  const warnings = [...report.warnings, ...report.repositories.flatMap(repo => (repo.warnings || []).map(warning => `${repo.name}: ${warning}`))];
  const overview = table('Snapshot coverage', ['Metric', 'Value'], [
    ['Account created', escape(report.profile.createdAt)],
    ['Activity start (UTC)', escape(report.scope.since)],
    ['Activity end (UTC)', escape(report.scope.until)],
    ['Repositories listed', count({ count: report.scope.listedRepositories, complete: report.scope.repositoryListComplete })],
    ['Originals / forks in this list', `${report.repositories.filter(repo => !repo.fork).length} / ${report.repositories.filter(repo => repo.fork).length}`],
    ['Active original repositories inspected', escape(report.scope.inspectedRepositories)],
    ['Inspection limit', escape(report.scope.maxRepos)],
    ['API requests attempted', escape(report.scope.apiRequests)],
  ]);
  const repos = report.repositories.map(repo => {
    const type = repo.fork ? 'Fork' : repo.archived ? 'Archived original' : 'Original';
    const heading = `<h3>${link(repo.name, repo.url)}</h3><p class="muted">${type} · Last repository push: ${escape(repo.pushedAt || 'Unknown')}</p>`;
    if (!repo.inspected) return `${heading}<p>Not inspected: ${escape(repo.skipReason || 'No inspection data')}.</p>`;
    return `${heading}${table(`${repo.name}: repository evidence`, ['Signal', 'Observed'], [
      ['Default branch', escape(repo.defaultBranch)],
      ['Attributed commits in window', count(repo.commits)],
      ['Detected source files', count({ count: repo.checks.sourceFiles, complete: repo.checks.sourceFilesComplete })],
      ['README', flag(repo.checks.readme)], ['License', flag(repo.checks.license)],
      ['Test paths', flag(repo.checks.tests)], ['Actions workflow paths', flag(repo.checks.ci)],
      ['Latest stable release', release(repo.release)],
    ])}`;
  }).join('\n') || '<p>No public repositories listed.</p>';
  return document(report, 'Public profile snapshot',
    `<dl class="cards">${cards.map(([label, value]) => `<div class="card"><dt>${label}</dt><dd>${value}</dd></div>`).join('')}</dl>`
    + (warnings.length ? section('Coverage warnings', list(warnings), 'notice') : '')
    + section('Coverage', overview) + section('Repositories', repos)
    + section('Suggested next steps', list(report.recommendations))
    + section('How to interpret this report', list(report.limitations)));
}

function renderComparison(report) {
  const snapshots = table('Snapshot windows (UTC)', ['Snapshot', 'Generated', 'Activity start', 'Activity end'],
    [['Before', report.before], ['After', report.after]].map(([label, snapshot]) => [label, escape(snapshot.generatedAt), escape(snapshot.since), escape(snapshot.until)]));
  const labels = { publicRepositories: 'Public repositories', pullRequests: 'Public PRs created',
    issues: 'Public issues created', externalMergedPullRequests: 'External public PRs merged' };
  const metrics = table('Activity and repository totals', ['Metric', 'Before', 'After', 'Net change'],
    Object.entries(report.metrics).map(([key, metric]) => [escape(labels[key] || key), count(metric.before), count(metric.after), change(metric)]));
  const visibility = [['Listed only after', report.repositoryChanges.listedOnlyAfter], ['Listed only before', report.repositoryChanges.listedOnlyBefore]]
    .map(([label, repos]) => `<p><strong>${label}:</strong> ${repos.length ? repos.map(repo => `${link(repo.name, repo.url)}${repo.absentFromOtherCompleteList ? '' : ' (other listing incomplete)'}`).join(', ') : 'None observed'}.</p>`).join('\n');
  const repos = report.repositoryChanges.compared.map(repo => {
    const heading = `<h3>${link(repo.name, repo.url)}</h3>`;
    if (repo.reason) return `${heading}<p>${escape(repo.reason)}</p>`;
    const checkLabels = { readme: 'README', license: 'License', tests: 'Test paths', ci: 'Actions workflow paths' };
    return heading + table(`${repo.name}: changes`, ['Signal', 'Before', 'After', 'Change'], [
      ['Attributed commits', count(repo.commits.before), count(repo.commits.after), change(repo.commits)],
      ['Detected source files', count(repo.sourceFiles.before), count(repo.sourceFiles.after), change(repo.sourceFiles)],
      ...Object.entries(repo.checks).map(([key, value]) => [escape(checkLabels[key] || key), flag(value.before), flag(value.after), transition(value)]),
      ['Stable release', release(repo.release.before), release(repo.release.after), transition(repo.release)],
    ]);
  }).join('\n') || '<p>No repository was present in both snapshots and inspected in at least one.</p>';
  return document(report, 'Snapshot comparison',
    (report.warnings.length ? section('Comparison warnings', list(report.warnings), 'notice') : '')
    + section('Compared snapshots', `<p>Activity windows: <strong>${escape(report.windowKind)}</strong>.</p>${snapshots}`)
    + section('Activity and repository totals', metrics) + section('Repository visibility', visibility)
    + section('Repository evidence', repos) + section('Interpretation', list(report.limitations)));
}

export function renderHtml(report) {
  return report.kind === 'comparison' ? renderComparison(report) : renderProfile(report);
}
