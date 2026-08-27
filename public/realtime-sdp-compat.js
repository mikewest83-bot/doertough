// Compatibility shim for the low-level WebRTC client in Mike AI.
// OpenAI's Realtime WebRTC endpoint expects the SDP offer as the raw body
// with Content-Type: application/sdp. Older Mike client code builds a
// FormData body containing an `sdp` Blob. Normalize that request here so the
// browser reaches the current Realtime endpoint with the correct wire format.
(() => {
  const originalFetch = window.fetch.bind(window);
  const realtimeCallsUrl = 'https://api.openai.com/v1/realtime/calls';

  window.fetch = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : input?.url;
    const method = String(init?.method || (typeof input !== 'string' ? input?.method : 'GET')).toUpperCase();
    const body = init?.body;

    if (url === realtimeCallsUrl && method === 'POST' && body instanceof FormData) {
      const sdpPart = body.get('sdp');
      if (sdpPart && typeof sdpPart.text === 'function') {
        const sdp = await sdpPart.text();
        const headers = new Headers(init.headers || (typeof input !== 'string' ? input?.headers : undefined));
        headers.set('Content-Type', 'application/sdp');
        return originalFetch(input, { ...init, headers, body: sdp });
      }
    }

    return originalFetch(input, init);
  };
})();
