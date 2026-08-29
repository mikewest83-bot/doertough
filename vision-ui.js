(() => {
  const TOKEN_KEY = 'mike_token';
  const token = () => { try { return localStorage.getItem(TOKEN_KEY) || ''; } catch { return ''; } };
  const authHeaders = () => token() ? { Authorization: `Bearer ${token()}` } : {};
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  function addMessage(text, role = 'mike') {
    const chat = document.querySelector('.chat');
    if (!chat || !text) return;
    const bubble = document.createElement('div');
    bubble.className = `bubble ${role}`;
    bubble.textContent = text;
    chat.appendChild(bubble);
    chat.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function install() {
    if (document.getElementById('mike-vision-launcher')) return true;
    const form = document.querySelector('main form');
    if (!form) return false;

    const wrap = document.createElement('div');
    wrap.id = 'mike-vision-wrap';
    wrap.style.cssText = 'display:flex;align-items:center;gap:8px;margin:8px 0 0;';

    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/jpeg,image/png,image/webp';
    input.id = 'mike-vision-input';
    input.style.display = 'none';

    const button = document.createElement('button');
    button.type = 'button';
    button.id = 'mike-vision-launcher';
    button.textContent = '📷 Ask Mike about a photo';
    button.setAttribute('aria-label', 'Ask Mike about a photo');
    button.style.cssText = 'flex:1;border:1px solid #24384a;background:#101820;color:#dbe7ef;border-radius:14px;padding:12px 14px;font-weight:800;font-size:14px;cursor:pointer;';

    const status = document.createElement('span');
    status.id = 'mike-vision-status';
    status.style.cssText = 'font-size:12px;color:#8fa5b5;display:none;';

    wrap.append(button, input, status);
    form.parentNode.insertBefore(wrap, form.nextSibling);

    button.addEventListener('click', () => {
      if (!token()) {
        addMessage('Sign in first, then tap “Ask Mike about a photo” again.', 'mike');
        const auth = document.querySelector('.auth-btn');
        if (auth) auth.click();
        return;
      }
      input.click();
    });

    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      input.value = '';
      if (!file) return;
      if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
        addMessage('I can look at JPG, PNG, or WebP images.', 'mike');
        return;
      }
      if (file.size > 5 * 1024 * 1024) {
        addMessage('That image is too large. Please choose one under 5 MB.', 'mike');
        return;
      }
      const prompt = window.prompt('What do you want Mike to look for?', 'What do you see in this photo?');
      if (!prompt || !prompt.trim()) return;
      try { await analyze(file, prompt.trim(), status, button); }
      catch (error) { console.error('[vision]', error); status.textContent = ''; status.style.display = 'none'; button.disabled = false; addMessage(error.message || 'Mike could not analyze that photo. Try again.', 'mike'); }
    });

    return true;
  }

  async function analyze(file, prompt, status, button) {
    button.disabled = true;
    status.style.display = 'inline';
    status.textContent = 'Mike is looking…';
    const data = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('The photo could not be read.'));
      reader.onload = () => resolve(String(reader.result || ''));
      reader.readAsDataURL(file);
    });

    // Use Mike's authenticated, quota-aware production Realtime endpoint.
    const sessionResponse = await fetch('/api/speech/token', {
      method: 'GET',
      headers: authHeaders(),
    });
    const session = await sessionResponse.json().catch(() => ({}));
    if (!sessionResponse.ok || !session.token) throw new Error(session.message || session.error || 'Mike Vision is temporarily unavailable.');

    const pc = new RTCPeerConnection();
    const audio = new Audio();
    audio.autoplay = true;
    pc.addTransceiver('audio', { direction: 'recvonly' });
    const dc = pc.createDataChannel('oai-events');
    let finished = false;
    const startedAt = Date.now();
    const finish = async (text) => {
      if (finished) return;
      finished = true;
      if (text) addMessage(text, 'mike');
      status.textContent = 'Done';
      await sleep(250);
      try { dc.close(); } catch {}
      try { pc.close(); } catch {}
      try { audio.pause(); audio.srcObject = null; } catch {}
      if (session.sessionKey) {
        const seconds = Math.min(Math.ceil((Date.now() - startedAt) / 1000), Number(session.maxSessionSeconds || 600));
        fetch('/api/speech/session-end', { method: 'POST', keepalive: true, headers: { 'Content-Type': 'application/json', ...authHeaders() }, body: JSON.stringify({ sessionKey: session.sessionKey, seconds }) }).catch(() => {});
      }
      button.disabled = false;
      setTimeout(() => { status.style.display = 'none'; }, 1200);
    };

    let transcript = '';
    dc.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        if (message.type === 'response.audio_transcript.delta') transcript += String(message.delta || '');
        if (message.type === 'response.audio_transcript.done') transcript = String(message.transcript || transcript).trim();
        if (message.type === 'response.done') finish(transcript.trim());
        if (message.type === 'error') finish(message.error?.message || 'Mike Vision returned an error.');
      } catch {}
    };
    pc.ontrack = (event) => { audio.srcObject = event.streams[0]; audio.play().catch(() => {}); };
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    while (pc.iceGatheringState !== 'complete') await sleep(50);
    const form = new FormData();
    form.append('sdp', new Blob([pc.localDescription.sdp], { type: 'application/sdp' }));
    const answerResponse = await fetch('https://api.openai.com/v1/realtime/calls', { method: 'POST', headers: { Authorization: `Bearer ${session.token}` }, body: form });
    const answer = await answerResponse.text();
    if (!answerResponse.ok) throw new Error(`Realtime connection failed (${answerResponse.status}).`);
    await pc.setRemoteDescription({ type: 'answer', sdp: answer });

    const waitForOpen = async () => {
      for (let i = 0; i < 100; i += 1) {
        if (dc.readyState === 'open') return;
        if (dc.readyState === 'closed') throw new Error('Realtime Vision connection closed.');
        await sleep(50);
      }
      throw new Error('Realtime Vision connection timed out.');
    };
    await waitForOpen();
    dc.send(JSON.stringify({
      type: 'conversation.item.create',
      item: {
        type: 'message',
        role: 'user',
        content: [
          { type: 'input_text', text: prompt },
          { type: 'input_image', image_url: data, detail: 'auto' },
        ],
      },
    }));
    dc.send(JSON.stringify({ type: 'response.create' }));
  }

  const observer = new MutationObserver(() => { if (install()) observer.disconnect(); });
  observer.observe(document.documentElement, { childList: true, subtree: true });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once: true }); else install();
})();