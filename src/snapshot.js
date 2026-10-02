import { readFile } from 'node:fs/promises';
import { validateSnapshot } from './compare.js';

export async function readSnapshot(path, label = 'Snapshot') {
  const text = await readFile(path, 'utf8');
  // Some editors prepend a UTF-8 byte order mark. Strip only the leading mark,
  // never characters inside saved values.
  try { return JSON.parse(text.replace(/^\uFEFF/, '')); }
  catch { throw new Error(`${label} is not valid JSON.`); }
}

// Comparison needs less metadata than a full profile renderer. Validate the
// additional presentation fields here without tightening older comparisons.
export function validateProfileReport(report) {
  validateSnapshot(report);
  const require = (condition, message) => {
    if (!condition) throw new Error(`Snapshot: ${message}`);
  };
  for (const field of ['warnings', 'recommendations', 'limitations']) {
    require(Array.isArray(report[field]) && report[field].every(value => typeof value === 'string'), `${field} must be an array of strings.`);
  }
  for (const field of ['listedRepositories', 'inspectedRepositories', 'apiRequests']) {
    require(Number.isSafeInteger(report.scope[field]) && report.scope[field] >= 0, `scope.${field} must be a nonnegative integer.`);
  }
  require(report.scope.listedRepositories === report.repositories.length, 'listed repository count must match the saved repository list.');
  require(report.scope.inspectedRepositories === report.repositories.filter(repo => repo.inspected).length
    && report.scope.inspectedRepositories <= report.scope.maxRepos, 'inspection count must match the saved evidence and limit.');
  require(typeof report.profile.createdAt === 'string' && report.profile.createdAt.length > 0, 'account creation date is missing.');
  return report;
}
