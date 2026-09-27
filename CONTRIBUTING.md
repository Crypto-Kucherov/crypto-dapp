# Contributing

Use Node.js 22 or newer. There are no runtime or test dependencies to install.

1. Reproduce the problem using public or synthetic data. Remove credentials
   or private information from examples.
2. Make a focused change that improves actual behavior, documentation or usability.
3. For behavior changes, include a test of the problem or relevant edge case.
4. Run `node --test` and include the result in your pull request.

Keep public-data scope explicit. Missing API responses must not become zero
activity, truncated data must be marked incomplete, and report text must treat
GitHub content as untrusted input. Do not introduce a speculative Legion scoring
formula, artificial commit generation, or token-sale promises.

## Possible next improvements

- Add representative snapshot-comparison cases for GitHub history or visibility changes.
- Document additional test-file conventions with representative fixtures.
- Add opt-in caching that preserves fetch timestamps and incomplete-data indicators.

Describe the user problem and resulting behavior in each pull request.
For external projects, follow their contribution guidelines and submit
changes only when they solve an actual problem.
