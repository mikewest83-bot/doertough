// Compatibility shim for older Mike voice bundles.
// Canonical production token endpoint: GET /api/speech/token.
(() => {
  const originalFetch = window.fetch.bind(window);
  const TOKEN_KEY = 'mike_token';

  const getToken = () => {
    try { return localStorage.getItem(TOKEN_KEY) || ''; } catch { return ''; }
  };

  window.fetch = (input, init = {}) => {
    const url = typeof input === 'string' ? input : input?.url || '';
    const method = String(init?.method || (typeof input !== 'string' ? input?.method : 'GET')).toUpperCase();
    if (url.endsWith('/api/speech/session') && method === 'POST') {
      const headers = new Headers(init?.headers || (typeof input !== 'string' ? input?.headers : undefined));
      const token = getToken();
      if (token) headers.set('Authorization', `Bearer ${token}`);
      return originalFetch('/api/speech/token', { method: 'GET', headers, signal: init?.signal });
    }
    return originalFetch(input, init);
  };
})();
