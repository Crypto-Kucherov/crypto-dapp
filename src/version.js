import { readFileSync } from 'node:fs';

// Resolve relative to the module so diagnostics also work outside the project.
export const VERSION = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;
export const USER_AGENT = `crypto-dapp-github-report/${VERSION}`;
