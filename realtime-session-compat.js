(() => {
  const nativeFetch = window.fetch.bind(window);
  window.fetch = (input, init = {}) => {
    try {
      const url = typeof input === 'string' ? input : input?.url || '';
      const method = String(init?.method || (typeof input !== 'string' ? input?.method : 'GET')).toUpperCase();
      if (new URL(url, window.location.href).pathname === '/api/speech/session' && method === 'POST') {
        const headers = new Headers(init?.headers || (typeof input !== 'string' ? input.headers : undefined));
        return nativeFetch('/api/speech/token', { method: 'GET', headers });
      }
    } catch {}
    return nativeFetch(input, init);
  };
})();
