#!/usr/bin/env node
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { GitHubClient, validateUsername } from './github.js';
import { analyzeProfile } from './analyze.js';
import { renderMarkdown } from './report.js';

const HELP = `GitHub Activity Report

Usage: node src/index.js USERNAME [options]

Options:
  --format markdown|json   Output format (default: markdown)
  --out PATH              Save to a new file instead of stdout
  --since YYYY-MM-DD       Activity start date, UTC (default: 90 days ago)
  --max-repos N           Inspect 1–50 active original repos (default: 10)
  --help                  Show this help

Examples:
  node src/index.js Crypto-Kucherov
  node src/index.js Crypto-Kucherov --format json --out reports/profile.json
  node src/index.js Crypto-Kucherov --since 2026-01-01 --max-repos 5

Optional: GITHUB_TOKEN for a higher GitHub API rate limit.
Reads public data only. Does not calculate or predict Legion Score.
`;

export function parseArgs(args) {
  if (args.includes('--help') || args.includes('-h')) return { help: true };
  const options = { format: 'markdown', maxRepos: 10 };
  const seen = new Set();
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (!arg.startsWith('-')) {
      if (options.username) throw new Error('Provide exactly one GitHub username.');
      options.username = validateUsername(arg);
      continue;
    }
    if (!['--format', '--out', '--since', '--max-repos'].includes(arg)) throw new Error(`Unknown option: ${arg}`);
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
  if (!options.username) throw new Error('A GitHub username is required. Use --help for examples.');
  if (!['markdown', 'json'].includes(options.format)) throw new Error('--format must be markdown or json.');
  if (options.maxRepos < 1 || options.maxRepos > 50) throw new Error('--max-repos must be an integer from 1 to 50.');
  return options;
}

export async function main(args = process.argv.slice(2), {
  stdout = process.stdout, stderr = process.stderr, client,
} = {}) {
  try {
    const options = parseArgs(args);
    if (options.help) { stdout.write(HELP); return 0; }
    const github = client || new GitHubClient({ token: process.env.GITHUB_TOKEN || '' });
    const report = await analyzeProfile(github, options.username, options);
    const output = options.format === 'json' ? `${JSON.stringify(report, null, 2)}\n` : renderMarkdown(report);
    if (options.out) {
      const target = resolve(options.out);
      await mkdir(dirname(target), { recursive: true });
      // Refuse to destroy an earlier snapshot or accidentally overwrite project code.
      await writeFile(target, output, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
      stderr.write(`Saved ${options.format} report to ${target}\n`);
    } else stdout.write(output);
    if (report.warnings.length || report.repositories.some(repo => repo.warnings?.length)) {
      stderr.write('Some checks are incomplete. Read the coverage warnings in the report.\n');
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
