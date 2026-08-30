(() => {
  const nativeFetch = window.fetch.bind(window);
  window.fetch = (input, init = {}) => {
    try {
      const url = typeof input === 'string' ? input : input?.url || '';
      const method = String(init?.method || (typeof input !== 'string' ? input?.method : 'GET')).toUpperCase();
      const pathname = new URL(url, window.location.href).pathname;
      if ((pathname === '/api/speech/session' || pathname === '/api/speech/token') && method === 'POST') {
        const headers = new Headers(init?.headers || (typeof input !== 'string' ? input.headers : undefined));
        return nativeFetch('/api/speech/token', { method: 'GET', headers });
      }
    } catch {}
    return nativeFetch(input, init);
  };
})();
