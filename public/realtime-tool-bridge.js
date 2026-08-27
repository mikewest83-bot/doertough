// Client bridge for OpenAI Realtime function calls.
// The browser only forwards authenticated tool requests to Mike's server;
// tool implementations and provider credentials remain server-side.
(() => {
  const originalCreateDataChannel = RTCPeerConnection.prototype.createDataChannel;
  const TOKEN_KEY = 'mike_token';

  const getToken = () => {
    try { return localStorage.getItem(TOKEN_KEY) || ''; } catch { return ''; }
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
        const response = await fetch('/api/realtime/tool', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(getToken() ? { Authorization: `Bearer ${getToken()}` } : {}),
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
