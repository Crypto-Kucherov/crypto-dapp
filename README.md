# GitHub Activity Report

A small, dependency-free CLI that turns a public GitHub profile into a readable
activity and repository report. Built for people who want to understand what
their public developer portfolio actually demonstrates.

[Русская инструкция](docs/README.ru.md) · [Example report](examples/crypto-kucherov.md) · [Example comparison](examples/comparison.md) · [MIT license](LICENSE)

**This tool reports observable GitHub data. It does not calculate or predict
Legion Score, token-sale allocations, or investment returns.** There is no
proprietary scoring formula or artificial contribution generator here.

## Run on GitHub without installing Node.js

Repository owners and collaborators with write access can generate a report from
[Actions → Generate profile report](https://github.com/Crypto-Kucherov/crypto-dapp/actions/workflows/report.yml):

1. Select **Run workflow**, keep `main`, and enter a public GitHub username.
2. Optionally set UTC start/end dates and the repository inspection limit.
3. Run the workflow, then open the completed run to read its report summary.
4. Download the `github-profile-…` artifact for the JSON, Markdown and standalone
   HTML files. Extract the ZIP and open `profile.html` in your browser.

Other users can fork this repository, enable Actions in their fork, and follow
the same steps there. The workflow runs only when requested; it has no schedule.
It uses GitHub's automatic read-only token, so no personal token or other secret
needs to be configured. Only public profile data is collected.

All three files come from one snapshot, with the same collection time. By default,
incomplete evidence marks the run as failed **after** the reports are uploaded, so
you can still inspect warnings. Uncheck `fail_on_incomplete` to allow partial data.
An invalid input or an error that prevents collection produces no report artifact.

Reports and run summaries in a public repository are publicly accessible; GitHub
requires sign-in to download artifacts. Artifacts are retained for **7 days**, so
download the JSON if you want to keep it for a later comparison. Reports are not
committed to the repository.

## Quick start

Requires **Node.js 22 or newer**. No packages, API keys, wallet, or installation
step are required for public-data access.

```sh
git clone https://github.com/Crypto-Kucherov/crypto-dapp.git
cd crypto-dapp
node src/index.js Crypto-Kucherov
```

Save a report in Markdown, JSON or HTML:

```sh
node src/index.js Crypto-Kucherov --out reports/profile.md
node src/index.js Crypto-Kucherov --format json --out reports/profile.json
node src/index.js Crypto-Kucherov --format html --out reports/profile.html
node src/index.js Crypto-Kucherov --since 2026-01-01 --max-repos 5
```

Use a new output filename for each snapshot. Existing files are never overwritten.
An existing output path is rejected before any GitHub requests, preserving API quota.
The final write also refuses replacement if another process creates that file during collection.
Without `--out`, the report goes to stdout; diagnostics go to stderr.

## Open a report in your browser

Use `--format html --out reports/profile.html`, then open that file in your browser.
The responsive report includes dated metrics, repository evidence, coverage warnings
and interpretation notes. It can be shared as one file or printed using the browser.
Once saved, it needs no network connection: styling is embedded, with no scripts,
remote fonts, images or other assets. GitHub links open only when you follow them.
Collecting a fresh profile still requires GitHub API access.

The HTML is a static view, not a live dashboard. Keep JSON snapshots for future
comparisons; HTML files cannot be used as comparison inputs. Text from GitHub is
escaped, links are restricted to HTTPS GitHub URLs, and an embedded content
security policy blocks scripts and remote assets.

Download [the example profile HTML](examples/profile.html) or
[the example comparison HTML](examples/comparison.html) and open it locally.
These examples use the saved public data from 27 September 2026.

## Convert a saved profile offline

Already have a JSON profile? Use `--from` to render it without spending GitHub API
requests or fetching newer data:

```sh
node src/index.js --from reports/profile.json --format html --out reports/profile.html
node src/index.js --from reports/profile.json --out reports/profile.md
node src/index.js --from examples/crypto-kucherov-after.json --format html --out reports/example-profile.html
```

The input must be a complete profile export with `schemaVersion: 1` (v0.1 and newer),
including its coverage and interpretation fields; comparison exports are not accepted.
Reports with explicitly unknown or incomplete evidence are supported. Dates, counts,
warnings and suggestions stay as saved. In particular, `apiRequests` describes the
original collection, not this offline conversion. A message on stderr identifies
the saved-data mode; stdout contains only the report.

`--from` accepts `--format`, `--out` and `--fail-on-incomplete`, with Markdown as the default.
It cannot be combined with a username, `--compare`, `--since`, `--until` or `--max-repos`.
Invalid JSON, unsupported schemas and inconsistent coverage fail before rendering.
UTF-8 JSON files saved with a leading byte order mark (BOM) are supported in both
offline modes; characters inside saved values remain unchanged.
Existing files, including the source snapshot, are never overwritten.

## Compare saved snapshots

Comparison works entirely offline and needs no token. Pass the older JSON report
first and the newer one second:

```sh
node src/index.js --compare reports/before.json reports/after.json
node src/index.js --compare reports/before.json reports/after.json --format json --out reports/changes.json
node src/index.js --compare reports/before.json reports/after.json --format html --out reports/changes.html
```

Try the included, dated snapshots immediately after cloning:

```sh
node src/index.js --compare examples/crypto-kucherov.json examples/crypto-kucherov-after.json
node src/index.js --compare examples/crypto-kucherov.json examples/crypto-kucherov-after.json --format html --out reports/example.html
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
| Same name, different saved GitHub repository IDs | Suppress all repository evidence comparisons |
| Renamed repository, same saved GitHub ID | Match the repository and explain the rename |
| Renamed account, same saved GitHub account ID | Compare snapshots and explain the previous login |
| Different saved GitHub account IDs, including under the same login | Reject the comparison |
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

New reports retain GitHub repository IDs. Older snapshots without IDs remain
supported by matching names, but cannot distinguish a repository recreated under
the same name. A present ID must be a positive safe integer and unique in its list.

Each repository can match at most one repository in the other snapshot. All ID
matches are reserved before falling back to names, regardless of list order or
inspection status. If a repository is renamed and another takes its previous name,
the replacement is listed only on its own side of the comparison; it cannot borrow
the renamed project's commit history, even when the replacement has no saved ID.
Visibility still describes what the snapshots list, not proof of creation or deletion.

New profile exports also retain the numeric account ID from GitHub's public user
response. GitHub describes this as a [durable ID independent of the login](https://docs.github.com/en/rest/users/users#get-a-user-using-their-id).
Matching account IDs allow comparison after a username change, with a visible
rename warning. Different IDs reject the comparison even if the login is unchanged.
If either older snapshot lacks an account ID, both logins must still match
(ignoring case); that fallback cannot detect a username reused by another account.
A present account ID must be a positive safe integer. Collection rejects a missing
or malformed API account ID before requesting repositories or activity.

## What it reports

- Public repositories, with originals, forks and archived projects distinguished.
- Public PRs and issues created within the chosen time window.
- Public PRs merged into repositories outside the account’s ownership within that window.
- Attributed commits on inspected repositories’ current default branches.
- Repository README and root license, conventional test paths, GitHub Actions files, and
  the latest published stable GitHub release.
- Practical suggestions based on the evidence and explicit warnings for partial data.

The default window is the last 90 days, ending at the start of the run. `--since`
accepts a real `YYYY-MM-DD` calendar date and starts at midnight UTC. `--until`
sets an inclusive UTC end day; a past day ends at 23:59:59.999, while today stops
at the start of the run. Future dates and reversed windows are rejected before
any API request. Without `--since`, the window starts 90 days before its end.

```sh
node src/index.js Crypto-Kucherov --since 2026-08-01 --until 2026-08-31 --format json --out reports/august.json
```

`generatedAt` always describes collection time. The date window filters activity;
it does not reconstruct historical file trees, repository lists or releases, which
still describe the state observed at collection. Rerunning the same window may
yield different counts after indexing, history or visibility changes. PR searches
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

Repeated repositories (by name or ID) and commit SHAs are counted once. Repeated
records make pagination incomplete because changing page order may also omit
records. Reports preserve this warning, including after later page failures.

Search counts must be nonnegative safe integers with explicit completeness metadata.
Malformed file trees or latest-release payloads become **Unknown** with a warning;
they do not establish missing files, a missing release or complete coverage.

An explicit GitHub `409` response saying the repository is empty establishes
zero commits and absent files. Other conflicts or unavailable trees remain
unknown; an HTTP status alone does not prove an empty repository.

File detection is a heuristic: a test file does not prove passing tests, and a
workflow file does not prove successful CI. Nonstandard layouts may be missed.
README detection checks the repository root, `.github/` and `docs/`, following
[GitHub's documented overview locations](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/about-readmes).
A README nested inside a package or guide does not satisfy this overview check.
Source-file counting recognizes common languages and excludes common generated
and dependency folders; documentation-only projects can legitimately have no code.
Recommendations are portfolio suggestions, not a quality rating or Legion policy.

### Recognized test paths

Only files with a recognized source-code extension can establish test-path evidence.
Documentation, images and data alone under `tests/` or `spec/` do not count. The same
generated/dependency-folder exclusions apply to both source counting and test checks.

| Layout | Examples recognized by this tool |
| --- | --- |
| Code under `test/`, `tests/`, `spec/`, `specs/`, `__tests__/` at any depth | `tests/run.sh`, `spec/parser.rb`, `test/Contract.sol` |
| JavaScript / TypeScript | `parser.test.js`, `widget.spec.tsx`, `parser-test.mjs` |
| Python | `test_parser.py`, `parser_test.py` |
| Go / Rust | `parser_test.go`, `parser_test.rs` |
| Ruby / Elixir | `parser_test.rb`, `parser_spec.rb`, `parser_test.exs` |
| Solidity | `Vault.t.sol` |
| Java / Kotlin / C# / PHP | `UserTest.java`, `UserTests.kt`, `CalculatorTests.cs`, `UserTest.php`, `TestAccount.java` |

Class-style `Test` / `Tests` suffixes and the `Test` prefix are case-sensitive.
The prefix must be followed by an uppercase letter, digit or underscore to avoid
matching names such as `Testament.cs`. These are filename heuristics, so helper
code may also match; inline tests and nonstandard layouts may be missed.
If a tree is truncated and no matching test was found, the result remains **Unknown**.
Already-saved reports retain their original checks when rendered with `--from`.

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
already available. Secondary-limit messages are recognized even when GitHub omits
`Retry-After` and the primary quota is not exhausted. Ordinary permission errors
do not suppress unrelated checks, and API response bodies are not copied to reports.
Failure to obtain those basic inputs or invalid input returns
exit code 1. Optional-check failures produce a report with coverage warnings and
return 0 by default, or 2 with `--fail-on-incomplete`. Redirects are rejected, and tokens
are never written into reports.

### Fail a script on incomplete evidence

```sh
node src/index.js Crypto-Kucherov --fail-on-incomplete --format json --out reports/check.json
node src/index.js --from reports/check.json --fail-on-incomplete
```

With `--fail-on-incomplete`, a profile is still written, but the process returns
**2** if listing, activity counts or inspected repository evidence is unknown or
incomplete. This includes capped commit counts, truncated trees and failed release
checks. Known absence (such as no tests or no published release) is complete evidence
and does not fail. Forks, archived repositories and projects intentionally excluded
by `--max-repos` do not fail this check. It is not a code-quality gate.

The flag supports fresh and saved profiles, not `--compare`. A comparison can have
non-comparable windows even with complete input data. Plain report generation keeps
its existing behavior. Automation can distinguish:

| Exit code | Meaning |
| --- | --- |
| `0` | Report produced; inspect warnings for partial data unless the flag was used |
| `1` | Input, collection or output error prevented report generation |
| `2` | Report produced with incomplete evidence and `--fail-on-incomplete` was set |

## Development

Check the installed version without contacting GitHub:

```sh
node src/index.js --version
```

`-v` is an alias. Run version diagnostics on their own, without collection or
output flags. Include the version when reporting a bug; requests use the same
package version in their User-Agent header.

```sh
node --test
node src/index.js --help
```

Tests use mocked GitHub responses and require no network or credentials. They
cover pagination, rate limits, partial data, attribution scope, input validation,
Markdown/HTML escaping, safe links, standalone HTML and snapshot output. GitHub
Actions runs them on Node 22 and 24.

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
