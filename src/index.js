#!/usr/bin/env node
import { lstat, mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { GitHubClient, validateUsername } from './github.js';
import { analyzeProfile } from './analyze.js';
import { renderMarkdown } from './report.js';
import { compareSnapshots, renderComparison } from './compare.js';
import { renderHtml } from './html.js';
import { readSnapshot, validateProfileReport } from './snapshot.js';

const HELP = `GitHub Activity Report

Usage: node src/index.js USERNAME [options]
       node src/index.js --from PROFILE.json [--format markdown|json|html] [--out PATH]
       node src/index.js --compare BEFORE.json AFTER.json [--format markdown|json|html] [--out PATH]

Options:
  --format markdown|json|html  Output format (default: markdown)
  --out PATH              Save to a new file instead of stdout
  --since YYYY-MM-DD       Activity start date, UTC (default: 90 days ago)
  --max-repos N           Inspect 1–50 active original repos (default: 10)
  --compare BEFORE AFTER Compare two saved JSON snapshots offline (no token needed)
  --from PROFILE.json    Render a saved profile offline without refreshing its data
  --help                  Show this help

Examples:
  node src/index.js Crypto-Kucherov
  node src/index.js Crypto-Kucherov --format json --out reports/profile.json
  node src/index.js Crypto-Kucherov --format html --out reports/profile.html
  node src/index.js Crypto-Kucherov --since 2026-01-01 --max-repos 5
  node src/index.js --compare reports/before.json reports/after.json
  node src/index.js --from reports/profile.json --format html --out reports/profile.html

Optional: GITHUB_TOKEN for a higher GitHub API rate limit.
Reads public data only. Does not calculate or predict Legion Score.
`;

export function parseArgs(args) {
  if (args.includes('--help') || args.includes('-h')) return { help: true };
  const options = { format: 'markdown', maxRepos: 10 };
  if (args[0] === '--compare') {
    if (!args[1] || !args[2] || args[1].startsWith('--') || args[2].startsWith('--')) {
      throw new Error('--compare requires two JSON snapshot paths: BEFORE AFTER.');
    }
    options.compare = args.slice(1, 3);
    args = args.slice(3);
  } else if (args[0] === '--from') {
    if (!args[1] || args[1].startsWith('--')) throw new Error('--from requires one JSON profile path.');
    options.from = args[1];
    args = args.slice(2);
  }
  const seen = new Set();
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (!arg.startsWith('-')) {
      if (options.compare) throw new Error('Comparison accepts exactly two snapshot paths and no username.');
      if (options.from) throw new Error('--from accepts exactly one snapshot path and no username.');
      if (options.username) throw new Error('Provide exactly one GitHub username.');
      options.username = validateUsername(arg);
      continue;
    }
    if (!['--format', '--out', '--since', '--max-repos'].includes(arg)) throw new Error(`Unknown option: ${arg}`);
    if ((options.compare || options.from) && ['--since', '--max-repos'].includes(arg)) throw new Error(`${arg} cannot change the coverage of saved snapshots.`);
    if (seen.has(arg)) throw new Error(`Duplicate option: ${arg}`);
    seen.add(arg);
    const value = args[++index];
    if (!value || value.startsWith('--')) throw new Error(`Missing value for ${arg}.`);
    if (arg === '--format') options.format = value;
    if (arg === '--out') options.out = value;
    if (arg === '--since') options.since = value;
    if (arg === '--max-repos') {
      if (!/^\d+$/.test(value)) throw new Error('--max-repos must be an integer from 1 to 50.');
      options.maxRepos = Number(value);
    }
  }
  if (!options.compare && !options.from && !options.username) throw new Error('A GitHub username is required. Use --help for examples.');
  if (!['markdown', 'json', 'html'].includes(options.format)) throw new Error('--format must be markdown, json or html.');
  if (options.maxRepos < 1 || options.maxRepos > 50) throw new Error('--max-repos must be an integer from 1 to 50.');
  return options;
}

export async function main(args = process.argv.slice(2), {
  stdout = process.stdout, stderr = process.stderr, client,
} = {}) {
  try {
    const options = parseArgs(args);
    if (options.help) { stdout.write(HELP); return 0; }
    const target = options.out ? resolve(options.out) : null;
    if (target) {
      // Avoid spending API quota on a report that cannot be saved. lstat also
      // catches dangling symlinks; the final exclusive write still handles races.
      let exists = true;
      try { await lstat(target); }
      catch (error) { if (error.code === 'ENOENT') exists = false; else throw error; }
      if (exists) throw Object.assign(new Error('Output already exists.'), { code: 'EEXIST' });
    }
    let report;
    if (options.compare) {
      const snapshots = [];
      for (const [index, path] of options.compare.entries()) {
        snapshots.push(await readSnapshot(path, `${index === 0 ? 'Before' : 'After'} snapshot`));
      }
      report = compareSnapshots(...snapshots);
    } else if (options.from) {
      report = validateProfileReport(await readSnapshot(options.from));
      stderr.write('Using a saved snapshot; no new GitHub data was fetched.\n');
    } else {
      const github = client || new GitHubClient({ token: process.env.GITHUB_TOKEN || '' });
      report = await analyzeProfile(github, options.username, options);
    }
    const output = options.format === 'json' ? `${JSON.stringify(report, null, 2)}\n`
      : options.format === 'html' ? renderHtml(report)
      : options.compare ? renderComparison(report) : renderMarkdown(report);
    if (target) {
      await mkdir(dirname(target), { recursive: true });
      // Refuse to destroy an earlier snapshot or accidentally overwrite project code.
      await writeFile(target, output, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
      stderr.write(`Saved ${options.format} report to ${target}\n`);
    } else stdout.write(output);
    if (report.warnings.length || report.repositories?.some(repo => repo.warnings?.length)) {
      stderr.write(options.compare ? 'Read the comparison warnings before interpreting changes.\n'
        : 'Some checks are incomplete. Read the coverage warnings in the report.\n');
    }
    return 0;
  } catch (error) {
    stderr.write(`Error: ${error.code === 'EEXIST' ? 'Output file already exists. Choose a new snapshot filename.' : error.message}\n`);
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exitCode = await main();
}
