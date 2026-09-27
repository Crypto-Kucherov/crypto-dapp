# GitHub Activity Report

A small, dependency-free CLI that turns a public GitHub profile into a readable
activity and repository report. Built for people who want to understand what
their public developer portfolio actually demonstrates.

[Русская инструкция](docs/README.ru.md) · [Example report](examples/crypto-kucherov.md) · [Example comparison](examples/comparison.md) · [MIT license](LICENSE)

**This tool reports observable GitHub data. It does not calculate or predict
Legion Score, token-sale allocations, or investment returns.** There is no
proprietary scoring formula or artificial contribution generator here.

## Quick start

Requires **Node.js 22 or newer**. No packages, API keys, wallet, or installation
step are required for public-data access.

```sh
git clone https://github.com/Crypto-Kucherov/crypto-dapp.git
cd crypto-dapp
node src/index.js Crypto-Kucherov
```

Save a snapshot in either format:

```sh
node src/index.js Crypto-Kucherov --out reports/profile.md
node src/index.js Crypto-Kucherov --format json --out reports/profile.json
node src/index.js Crypto-Kucherov --since 2026-01-01 --max-repos 5
```

Use a new output filename for each snapshot. Existing files are never overwritten.
Without `--out`, the report goes to stdout; diagnostics go to stderr.

## Compare saved snapshots

Comparison works entirely offline and needs no token. Pass the older JSON report
first and the newer one second:

```sh
node src/index.js --compare reports/before.json reports/after.json
node src/index.js --compare reports/before.json reports/after.json --format json --out reports/changes.json
```

Try the included, dated snapshots immediately after cloning:

```sh
node src/index.js --compare examples/crypto-kucherov.json examples/crypto-kucherov-after.json
```

These examples capture the public profile before and after the first release on
27 September 2026. They are historical snapshots, not current statistics.
[See the rendered comparison](examples/comparison.md).

The comparison shows public repository and PR/issue totals, repository visibility,
attributed commits, detected source files, README/license/test/CI paths, and stable
release tags. Unknown evidence stays unknown. Repositories omitted from incomplete
pages or excluded by a different inspection limit are not treated as deleted or broken.

For activity deltas, use the same `--since` date when collecting both reports:

```sh
node src/index.js Crypto-Kucherov --since 2026-01-01 --format json --out reports/before.json
# After making useful changes, save a later snapshot with the same start date:
node src/index.js Crypto-Kucherov --since 2026-01-01 --format json --out reports/after.json
node src/index.js --compare reports/before.json reports/after.json
```

| Condition | Comparison behavior |
| --- | --- |
| Same activity window | Show net differences for complete counts |
| Same start, later end | Show net differences with an expanded-window warning |
| Different starts, or an earlier end | Show both activity totals but suppress activity deltas |
| Unknown/incomplete counts | Show evidence without inventing a numeric delta |
| Different default branch | Suppress that repository’s commit delta |
| Different accounts, reversed snapshots, unsupported schema, malformed data | Exit with an error |

An expanded-window delta is not a count of newly authored work: indexing, history
rewrites or changed visibility may also affect totals. Current file/release
evidence can still be compared when activity windows differ. Check file paths
remain heuristics, not test or CI results. Neither report mode estimates Legion Score.

Comparison accepts only `--format` and `--out`; collection flags cannot change
the contents of saved snapshots. Use exported profile JSON with `schemaVersion: 1`,
including existing v0.1 reports. Comparison JSON has `kind: "comparison"` and cannot
itself be used as an input profile snapshot. Interpretation warnings go to stderr
and are included in the output; successful comparisons return exit code 0.

## What it reports

- Public repositories, with originals, forks and archived projects distinguished.
- Public PRs and issues created within the chosen time window.
- Public PRs merged into repositories outside the account’s ownership within that window.
- Attributed commits on inspected repositories’ current default branches.
- Root README and license, conventional test paths, GitHub Actions files, and
  the latest published stable GitHub release.
- Practical suggestions based on the evidence and explicit warnings for partial data.

The default window is the last 90 days, ending at the start of the run. `--since`
accepts a real `YYYY-MM-DD` calendar date and starts at midnight UTC. PR searches
use creation dates; the external merged-PR metric uses merge dates. Repository
file checks describe the current default branch, independent of the activity window.

## Coverage and interpretation

| Data | Scope |
| --- | --- |
| Repository list | Up to 1,000 public owned repositories, newest repository push first |
| Detailed inspection | Up to 10 active original repositories by default; `--max-repos` accepts 1–50 |
| Attributed commits | Up to 300 per inspected repo, filtered by author and time, on its default branch |
| PR / issue totals | Public GitHub search results, including an incomplete-results indicator |
| Forks / archived repos | Listed, but not inspected |
| Private activity | Excluded, including when a token is supplied |

Limits or API failures are shown as **incomplete** or **Unknown**, never silently
converted to zero. Counts after a pagination cap are lower bounds. A repository’s
last push may have been made by another contributor. These commit counts are
**not** the contribution calendar on your GitHub profile.

File detection is a heuristic: a test file does not prove passing tests, and a
workflow file does not prove successful CI. Nonstandard layouts may be missed.
Source-file counting recognizes common languages and excludes common generated
and dependency folders; documentation-only projects can legitimately have no code.
Recommendations are portfolio suggestions, not a quality rating or Legion policy.

## GitHub API access

The CLI only issues GET requests to `https://api.github.com`; it does not publish
changes, request a wallet, or contact a scoring service. Unauthenticated GitHub
REST access normally has a 60-request/hour primary limit. An optional
`GITHUB_TOKEN` environment variable increases the primary limit for authenticated
access. GitHub search has a separate limit and secondary limits can also apply.

Configure a token through your usual secret-management process if needed. No
write access is required for this tool. Never put tokens in a command argument,
README, report, or committed `.env` file. The CLI does not load `.env` files.

Requests are sequential with a 15-second timeout. Detected rate limiting stops
further requests and produces partial results if the profile and repo list are
already available. Failure to obtain those basic inputs is an error. Authentication,
network, missing-user and invalid-input failures return exit code 1; a report
with explicit coverage warnings returns 0. Redirects are rejected, and tokens
are never written into reports.

## Development

```sh
node --test
node src/index.js --help
```

Tests use mocked GitHub responses and require no network or credentials. They
cover pagination, rate limits, partial data, attribution scope, input validation,
Markdown escaping, and snapshot output. GitHub Actions runs them on Node 22 and 24.

The JSON output has `schemaVersion: 1`, a generation timestamp, a bounded activity
window, coverage metadata, repository findings, recommendations and limitations.
Use `--compare` to inspect snapshot changes with coverage and time-window checks.
Raw counter differences alone do not establish progress.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Useful improvements include better
documented layout detection, actionable error reports, and reproducible tests.
Please avoid changes whose only purpose is increasing contribution counts.

## Sources

- [GitHub REST: public user repositories](https://docs.github.com/en/rest/repos/repos#list-repositories-for-a-user)
- [GitHub REST: Git trees and truncation](https://docs.github.com/en/rest/git/trees#get-a-tree)
- [GitHub REST: search](https://docs.github.com/en/rest/search/search#search-issues-and-pull-requests)
- [GitHub API rate limits](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api)
- [GitHub profile contribution criteria](https://docs.github.com/en/account-and-profile/reference/profile-contributions-reference)
- [Legion’s explanation of developer contributions](https://help.legion.cc/en/articles/13566228-how-to-boost-your-legion-score-the-only-guide-you-need)

Maintained by [Crypto-Kucherov](https://github.com/Crypto-Kucherov). MIT licensed.
