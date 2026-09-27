import test from 'node:test';
import assert from 'node:assert/strict';
import { GitHubClient, GitHubError, validateUsername } from '../src/github.js';

test('validates logins without allowing URLs, path traversal or search filters', () => {
  for (const value of ['Crypto-Kucherov', 'a', 'a'.repeat(39)]) assert.equal(validateUsername(value), value);
  for (const value of ['', '-bob', 'bob-', 'two--hyphens', 'a'.repeat(40), '../bob', 'a/b', 'bob is:merged', 'https://github.com/bob']) assert.throws(() => validateUsername(value));
});

test('sends the token only to the GitHub API and rejects redirects', async () => {
  const seen = [];
  const client = new GitHubClient({ token: 'test-token', fetchImpl: async (url, options) => {
    seen.push({ url, options });
    return Response.json({ login: 'alice' });
  } });
  await client.get('/users/alice');
  assert.equal(seen[0].url.origin, 'https://api.github.com');
  assert.equal(seen[0].options.headers.Authorization, 'Bearer test-token');
  assert.equal(seen[0].options.redirect, 'error');
  for (const path of ['https://example.com', '//example.com', '/\\example.com']) await assert.rejects(client.get(path));
  assert.equal(seen.length, 1);
});

test('paginates while preserving query filters', async () => {
  const client = new GitHubClient({ fetchImpl: async url => {
    assert.equal(url.searchParams.get('author'), 'alice');
    assert.equal(url.searchParams.get('per_page'), '100');
    return url.searchParams.get('page') === '1'
      ? Response.json([{ sha: 'one' }], { headers: { link: '<https://api.github.com/next>; rel="next"' } })
      : Response.json([{ sha: 'two' }]);
  } });
  const result = await client.paginate('/repos/a/b/commits?author=alice');
  assert.deepEqual(result.items, [{ sha: 'one' }, { sha: 'two' }]);
  assert.equal(result.complete, true);
  assert.equal(client.requests, 2);
});

test('marks capped pagination as incomplete', async () => {
  const client = new GitHubClient({ fetchImpl: async () => Response.json([{ id: 1 }], {
    headers: { link: '<https://api.github.com/next>; rel="next"' },
  }) });
  const result = await client.paginate('/users/alice/repos', { maxPages: 1 });
  assert.equal(result.complete, false);
  assert.match(result.warning, /lower bounds/);
});

test('keeps earlier pages when a later page fails', async () => {
  let calls = 0;
  const client = new GitHubClient({ fetchImpl: async () => ++calls === 1
    ? Response.json([{ id: 1 }], { headers: { link: '<https://api.github.com/next>; rel="next"' } })
    : new Response('', { status: 502 }) });
  const result = await client.paginate('/users/alice/repos');
  assert.deepEqual(result.items, [{ id: 1 }]);
  assert.equal(result.complete, false);
  assert.match(result.warning, /502/);
});

test('stops further HTTP calls after rate limiting', async () => {
  let calls = 0;
  const client = new GitHubClient({ fetchImpl: async () => {
    calls++;
    return new Response('', { status: 403, headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '1800000000' } });
  } });
  await assert.rejects(client.get('/users/alice'), error => error instanceof GitHubError && error.rateLimited && /Reset:/.test(error.message));
  await assert.rejects(client.get('/users/bob'), /remaining checks were skipped/);
  assert.equal(calls, 1);
});

test('handles secondary limits, authentication, timeout and invalid JSON without reflecting secrets', async () => {
  const secondary = new GitHubClient({ fetchImpl: async () => new Response('', { status: 429 }) });
  await assert.rejects(secondary.get('/users/a'), error => error.rateLimited);
  const unauthorized = new GitHubClient({ fetchImpl: async () => new Response('secret-token', { status: 401 }) });
  await assert.rejects(unauthorized.get('/users/a'), error => /rejected the token/.test(error.message) && !error.message.includes('secret-token'));
  const timeout = new GitHubClient({ fetchImpl: async () => { throw new Error('secret-token'); } });
  await assert.rejects(timeout.get('/users/a'), /Cannot reach GitHub/);
  const invalid = new GitHubClient({ fetchImpl: async () => new Response('not json') });
  await assert.rejects(invalid.get('/users/a'), /invalid JSON/);
});
