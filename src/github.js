const API_ORIGIN = 'https://api.github.com';

export class GitHubError extends Error {
  constructor(message, { status = null, rateLimited = false } = {}) {
    super(message);
    this.name = 'GitHubError';
    this.status = status;
    this.rateLimited = rateLimited;
  }
}

// Accept only a GitHub login, never a URL or search-query fragment.
export function validateUsername(value) {
  if (typeof value !== 'string' || !/^[a-z\d](?:[a-z\d-]{0,37}[a-z\d])?$/i.test(value)
    || value.includes('--')) {
    throw new Error('Provide a GitHub username (1–39 letters, digits or single hyphens), not a URL.');
  }
  return value;
}

export class GitHubClient {
  constructor({ token = '', fetchImpl = globalThis.fetch, timeoutMs = 15000 } = {}) {
    this.token = token.trim();
    this.fetchImpl = fetchImpl;
    this.timeoutMs = timeoutMs;
    this.requests = 0;
    this.rateLimited = false;
  }

  async get(path) {
    const url = new URL(path, API_ORIGIN);
    if (!path.startsWith('/') || path.startsWith('//') || url.origin !== API_ORIGIN) {
      throw new Error('GitHub requests must stay on api.github.com.');
    }
    if (this.rateLimited) {
      throw new GitHubError('GitHub rate limit reached; remaining checks were skipped.', { rateLimited: true });
    }
    const headers = {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'crypto-dapp-github-report/0.1.0',
      'X-GitHub-Api-Version': '2022-11-28',
    };
    if (this.token) headers.Authorization = `Bearer ${this.token}`;

    let response;
    try {
      this.requests++;
      response = await this.fetchImpl(url, {
        headers,
        signal: AbortSignal.timeout(this.timeoutMs),
        // Never forward credentials to a redirect target.
        redirect: 'error',
      });
    } catch {
      throw new GitHubError('Cannot reach GitHub. Check your connection or retry after a timeout.');
    }
    if (!response.ok) {
      const rateLimited = response.status === 429 || (response.status === 403
        && (response.headers.get('x-ratelimit-remaining') === '0' || response.headers.has('retry-after')));
      if (rateLimited) {
        this.rateLimited = true;
        const reset = Number(response.headers.get('x-ratelimit-reset'));
        const resetDate = new Date(reset * 1000);
        const when = reset > 0 && Number.isFinite(resetDate.getTime()) ? ` Reset: ${resetDate.toISOString()}.` : '';
        throw new GitHubError(`GitHub rate limit reached.${when} Retry later; an optional GITHUB_TOKEN increases the primary limit.`,
          { status: response.status, rateLimited: true });
      }
      const messages = {
        401: 'GitHub rejected the token. Check GITHUB_TOKEN or run without it.',
        403: 'GitHub denied this request (permission or secondary rate limit). Retry later.',
        404: 'The requested GitHub resource was not found or is not publicly accessible.',
        409: 'This repository is empty or has no usable Git history.',
        422: 'GitHub could not process this request.',
      };
      throw new GitHubError(messages[response.status] || `GitHub returned HTTP ${response.status}. Retry later.`,
        { status: response.status });
    }
    try {
      return { data: await response.json(), headers: response.headers };
    } catch {
      throw new GitHubError('GitHub returned invalid JSON. Retry later.');
    }
  }

  async paginate(path, { maxPages = 10 } = {}) {
    const items = [];
    for (let page = 1; page <= maxPages; page++) {
      const params = new URL(path, API_ORIGIN);
      params.searchParams.set('per_page', '100');
      params.searchParams.set('page', String(page));
      let result;
      try {
        result = await this.get(params.pathname + params.search);
        if (!Array.isArray(result.data)) throw new GitHubError('Unexpected GitHub list response.');
      } catch (error) {
        if (page === 1) throw error;
        return { items, complete: false, warning: error.message };
      }
      items.push(...result.data);
      const hasNext = /rel="next"/.test(result.headers.get('link') || '');
      if (!hasNext) return { items, complete: true, warning: null };
    }
    return { items, complete: false, warning: `Stopped after ${maxPages} pages; counts are lower bounds.` };
  }
}
