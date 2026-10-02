import { constants } from 'node:fs';
import { open, stat } from 'node:fs/promises';
import { validateSnapshot } from './compare.js';

export const MAX_SNAPSHOT_BYTES = 20 * 1024 * 1024;

async function readSnapshotText(path, label) {
  const check = info => {
    if (!info.isFile()) throw new Error(`${label} must be a regular file.`);
    if (info.size > MAX_SNAPSHOT_BYTES) throw new Error(`${label} exceeds the 20 MiB size limit.`);
  };
  check(await stat(path));
  const file = await open(path, constants.O_RDONLY | (constants.O_NONBLOCK || 0));
  try {
    check(await file.stat());
    const chunks = [];
    let size = 0;
    while (true) {
      // Read at most one byte past the limit, even if the file grows after stat.
      const buffer = Buffer.alloc(Math.min(65536, MAX_SNAPSHOT_BYTES - size + 1));
      const { bytesRead } = await file.read(buffer, 0, buffer.length, null);
      if (!bytesRead) break;
      size += bytesRead;
      if (size > MAX_SNAPSHOT_BYTES) throw new Error(`${label} exceeds the 20 MiB size limit.`);
      chunks.push(buffer.subarray(0, bytesRead));
    }
    return Buffer.concat(chunks, size).toString('utf8');
  } finally { await file.close(); }
}

export async function readSnapshot(path, label = 'Snapshot') {
  const text = await readSnapshotText(path, label);
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
