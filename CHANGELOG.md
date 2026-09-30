# Changelog

## 0.6.0 — 2026-09-30

- Distinguish explicit empty-repository responses from generic conflicts, preserving unknown evidence when emptiness is unconfirmed.
- Deduplicate paginated repository identities and commit SHAs, preserving warnings and marking affected coverage incomplete.
- Stop requests on secondary-limit messages even without retry or quota-exhaustion headers.
- Preserve stable repository IDs, follow renames, and suppress comparisons when a name refers to a different repository.
- Add offline `--version` / `-v` diagnostics and keep the GitHub User-Agent version in sync with package metadata.

## 0.5.0 — 2026-09-29

- Reject existing output paths before collection without spending GitHub API quota; retain protection against write races.
- Recognize repository README files in `.github/` and `docs/` as well as the root, avoiding incorrect missing-README suggestions.
- Keep malformed GitHub search counts, file trees and stable-release responses unknown with explicit warnings.
- Add inclusive UTC `--until` dates for historical activity windows while retaining the actual collection timestamp.
- Add `--fail-on-incomplete` for fresh and saved profiles: preserve the report and return exit code 2 for incomplete evidence.

## 0.4.0 — 2026-09-29

- Render a saved profile JSON as Markdown, HTML or JSON with `--from`, without GitHub requests.
- Validate saved profile coverage and presentation fields while preserving original timestamps, counters and warnings.
- Stop treating documentation or data-only test folders as evidence of test code.
- Recognize additional Solidity, Java, Kotlin, C#, PHP, Ruby and Elixir test filenames, with documented heuristic limits.
- Extend coverage to 62 offline tests.

## 0.3.0 — 2026-09-28

- Export profile reports and offline comparisons as standalone HTML with `--format html`.
- Add responsive layouts, accessible tables and print styles without scripts or remote assets.
- Preserve unknown values, incomplete counts, inspection limits and comparison warnings in browser reports.
- Escape untrusted text, restrict report links and protect pages with a content security policy.
- Include dated HTML examples and English/Russian instructions for sharing reports.

## 0.2.0 — 2026-09-27

- Compare two saved profile reports offline with Markdown and JSON output.
- Show repository visibility, file evidence, release tags and eligible net activity changes.
- Suppress activity deltas for incompatible windows, changed branches, incomplete or unknown counts.
- Validate snapshot schemas, account identity and chronological order before comparison.
- Add an executable example from the real snapshots before and after the v0.1 release.
- Extend coverage to 39 offline tests and document the workflow in English and Russian.

## 0.1.0 — 2026-09-27

- Add a dependency-free CLI for public GitHub activity reports.
- Export Markdown and versioned JSON snapshots with explicit coverage metadata.
- Distinguish original repositories, forks, archived projects and private data.
- Inspect repository files, attributed commits and stable releases.
- Handle pagination, rate limits, missing resources and incomplete searches.
- Add offline tests and a GitHub Actions matrix for Node 22 and 24.
- Replace the prototype scoring claims with executable instructions and documented limits.
- Include English/Russian documentation and a dated example from Crypto-Kucherov’s public profile.
