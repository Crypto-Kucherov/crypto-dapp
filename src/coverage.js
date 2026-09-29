const incompleteCount = metric => metric.count == null || metric.complete !== true;

// Completeness describes available evidence, not project quality. An absent
// test or release is a known result; intentionally uninspected repos are skipped.
export function hasIncompleteProfile(report) {
  if (!report.scope.repositoryListComplete) return true;
  if (['pullRequests', 'issues', 'externalMergedPullRequests'].some(key => incompleteCount(report.activity[key]))) return true;
  return report.repositories.some(repo => repo.inspected && (
    incompleteCount(repo.commits)
    || ['readme', 'license', 'tests', 'ci'].some(key => repo.checks[key] == null)
    || repo.checks.sourceFiles == null || repo.checks.sourceFilesComplete !== true
    || repo.release.status === 'unknown'
  ));
}
