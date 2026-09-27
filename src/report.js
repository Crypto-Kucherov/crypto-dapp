// GitHub bios, repo names and API messages are untrusted Markdown input.
export function escapeMarkdown(value) {
  return String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/[\\`*_{}\[\]()#!|~]/g, '\\$&');
}

export function link(label, url) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' || parsed.hostname !== 'github.com' || parsed.username || parsed.password) {
      return escapeMarkdown(label);
    }
    return `[${escapeMarkdown(label)}](${parsed.href.replace(/[()]/g, char => encodeURIComponent(char).replace('(', '%28').replace(')', '%29'))})`;
  } catch {
    return escapeMarkdown(label);
  }
}

function count(metric) {
  if (metric?.count === null || metric?.count === undefined) return 'Unknown';
  return `${metric.count}${metric.complete ? '' : ' (incomplete)'}`;
}

function flag(value) {
  return value === true ? 'Found' : value === false ? 'Not detected' : 'Unknown';
}

export function renderMarkdown(report) {
  const originalCount = report.repositories.filter(repo => !repo.fork).length;
  const forkCount = report.repositories.filter(repo => repo.fork).length;
  const lines = [
    `# GitHub activity report: ${escapeMarkdown(report.profile.login)}`,
    '',
    `Profile: ${link(report.profile.login, report.profile.url)}`,
    `Generated: ${escapeMarkdown(report.generatedAt)}`,
    `Activity window (UTC): ${escapeMarkdown(report.scope.since)} → ${escapeMarkdown(report.scope.until)}`,
    '',
    '> Public GitHub evidence only. This report does not calculate or predict Legion Score.',
    '',
    '## Overview',
    '',
    '| Metric | Value |',
    '| --- | --- |',
    `| Account created | ${escapeMarkdown(report.profile.createdAt)} |`,
    `| Public repositories reported by GitHub | ${report.profile.publicRepositories} |`,
    `| Repositories listed in this report | ${report.scope.listedRepositories}${report.scope.repositoryListComplete ? '' : ' (incomplete)'} |`,
    `| Originals / forks among listed repositories | ${originalCount} / ${forkCount} |`,
    `| Active original repositories inspected | ${report.scope.inspectedRepositories} |`,
    `| Public PRs created in window | ${count(report.activity.pullRequests)} |`,
    `| Public issues created in window | ${count(report.activity.issues)} |`,
    `| External public PRs merged in window | ${count(report.activity.externalMergedPullRequests)} |`,
    '',
    '## Repositories',
    '',
    '| Repository | Type | Last repository push | Attributed commits in window | README | License | Tests | Actions | Latest stable release |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- |',
  ];
  for (const repo of report.repositories) {
    const type = repo.fork ? 'Fork' : repo.archived ? 'Archived original' : 'Original';
    if (!repo.inspected) {
      lines.push(`| ${link(repo.name, repo.url)} | ${type}; ${escapeMarkdown(repo.skipReason)} | ${escapeMarkdown(repo.pushedAt || 'Unknown')} | — | — | — | — | — | — |`);
    } else {
      const release = repo.release.status === 'present' ? link(repo.release.tag, repo.release.url)
        : repo.release.status === 'absent' ? 'None published' : 'Unknown';
      lines.push(`| ${link(repo.name, repo.url)} | ${type} | ${escapeMarkdown(repo.pushedAt || 'Unknown')} | ${count(repo.commits)} | ${flag(repo.checks.readme)} | ${flag(repo.checks.license)} | ${flag(repo.checks.tests)} | ${flag(repo.checks.ci)} | ${release} |`);
    }
  }
  if (report.repositories.length === 0) lines.push('| No public repositories listed | — | — | — | — | — | — | — | — |');
  lines.push('', '## Suggested next steps', '', ...report.recommendations.map(tip => `- ${escapeMarkdown(tip)}`));
  const warnings = [...report.warnings];
  for (const repo of report.repositories) for (const warning of repo.warnings || []) warnings.push(`${repo.name}: ${warning}`);
  if (warnings.length) lines.push('', '## Coverage warnings', '', ...warnings.map(warning => `- ${escapeMarkdown(warning)}`));
  lines.push('', '## How to interpret this report', '', ...report.limitations.map(note => `- ${escapeMarkdown(note)}`),
    '', `API requests attempted: ${report.scope.apiRequests}.`, '');
  return lines.join('\n');
}
