// Client bridge for OpenAI Realtime function calls.
// The browser only forwards authenticated tool requests to Mike's server;
// tool implementations and provider credentials remain server-side.
(() => {
  const originalFetch = window.fetch.bind(window);
  const originalCreateDataChannel = RTCPeerConnection.prototype.createDataChannel;
  const TOKEN_KEY = 'mike_token';

  const getToken = () => {
    try { return localStorage.getItem(TOKEN_KEY) || ''; } catch { return ''; }
  };

  // Backward-compatibility shim for the voice client. The production server's
  // canonical token endpoint is GET /api/speech/token; older bundles call
  // POST /api/speech/session. Translate only that exact request.
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

  RTCPeerConnection.prototype.createDataChannel = function (...args) {
    const channel = originalCreateDataChannel.apply(this, args);
    if (args[0] !== 'oai-events') return channel;

    channel.addEventListener('message', async (event) => {
      let message;
      try { message = JSON.parse(event.data); } catch { return; }
      if (message?.type !== 'response.function_call_arguments.done') return;

      const callId = String(message.call_id || '');
      const name = String(message.name || '');
      if (!callId || !name) return;

      let output;
      try {
        const token = getToken();
        const response = await originalFetch('/api/realtime/tool', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({ name, arguments: message.arguments || '{}' }),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || `tool_failed_${response.status}`);
        output = data.output ?? JSON.stringify(data);
      } catch (error) {
        output = JSON.stringify({ error: error.message || 'tool_failed' });
      }

      if (channel.readyState !== 'open') return;
      channel.send(JSON.stringify({
        type: 'conversation.item.create',
        item: {
          type: 'function_call_output',
          call_id: callId,
          output: String(output),
        },
      }));
      channel.send(JSON.stringify({ type: 'response.create' }));
    });

    return channel;
  };
})();
