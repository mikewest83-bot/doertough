(() => {
  const TOKEN_KEY = 'mike_token';
  const token = () => { try { return localStorage.getItem(TOKEN_KEY) || ''; } catch { return ''; } };
  const authHeaders = () => token() ? { Authorization: `Bearer ${token()}` } : {};

  function addMessage(text, role = 'mike') {
    const chat = document.querySelector('.chat');
    if (!chat || !text) return;
    const bubble = document.createElement('div');
    bubble.className = `bubble ${role}`;
    bubble.textContent = text;
    chat.appendChild(bubble);
    chat.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function findVoiceControl() {
    return Array.from(document.querySelectorAll('main button')).find((el) => /^(END CONVERSATION|TAP TO TALK)$/i.test((el.textContent || '').replace(/\s+/g, ' ').trim())) || null;
  }

  async function prepareImage(file) {
    const maxDimension = 1600;
    const bitmap = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('The photo could not be read.'));
      reader.onload = () => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error('That image could not be decoded. Please choose a JPG or PNG.'));
        img.src = String(reader.result || '');
      };
      reader.readAsDataURL(file);
    });
    const naturalWidth = bitmap.naturalWidth || bitmap.width;
    const naturalHeight = bitmap.naturalHeight || bitmap.height;
    const scale = Math.min(1, maxDimension / Math.max(naturalWidth, naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(naturalHeight * scale));
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('Mike could not prepare that photo.');
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error('Mike could not compress that photo.')), 'image/jpeg', 0.72));
    return await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('The prepared photo could not be read.'));
      reader.onload = () => resolve(String(reader.result || ''));
      reader.readAsDataURL(blob);
    });
  }

  async function analyze(file, prompt, status, button) {
    button.disabled = true;
    status.style.display = 'inline';
    status.textContent = 'Preparing photo…';
    const image = await prepareImage(file);
    status.textContent = 'Mike is looking…';
    const response = await fetch('/api/vision/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ image: { dataUrl: image, mediaType: 'image/jpeg' }, prompt }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.message || result.error || `Vision request failed (${response.status}).`);
    addMessage(result.text || 'I could not get a useful answer from that photo.', 'mike');
    status.textContent = 'Done';
    button.disabled = false;
    setTimeout(() => { status.style.display = 'none'; }, 1200);
  }

  function install() {
    if (document.getElementById('mike-vision-launcher')) return true;
    const form = document.querySelector('main form');
    const voiceButton = findVoiceControl();
    if (!form && !voiceButton) return false;

    const wrap = document.createElement('div');
    wrap.id = 'mike-vision-wrap';
    wrap.style.cssText = 'display:flex;align-items:center;gap:8px;margin:8px 0 0;';
    const input = document.createElement('input');
    input.type = 'file'; input.accept = 'image/jpeg,image/png'; input.id = 'mike-vision-input'; input.style.display = 'none';
    const button = document.createElement('button');
    button.type = 'button'; button.id = 'mike-vision-launcher'; button.textContent = '📷 Ask Mike about a photo';
    button.setAttribute('aria-label', 'Ask Mike about a photo');
    button.style.cssText = 'width:100%;border:1px solid #24384a;background:#101820;color:#dbe7ef;border-radius:14px;padding:12px 14px;font-weight:800;font-size:14px;cursor:pointer;';
    const status = document.createElement('span');
    status.id = 'mike-vision-status'; status.style.cssText = 'font-size:12px;color:#8fa5b5;display:none;';
    wrap.append(button, input, status);
    if (voiceButton) voiceButton.insertAdjacentElement('afterend', wrap); else form.parentNode.insertBefore(wrap, form.nextSibling);

    button.addEventListener('click', () => {
      if (!token()) { addMessage('Sign in first, then tap “Ask Mike about a photo” again.', 'mike'); const auth = document.querySelector('.auth-btn'); if (auth) auth.click(); return; }
      input.click();
    });
    input.addEventListener('change', async () => {
      const file = input.files?.[0]; input.value = ''; if (!file) return;
      if (!['image/jpeg', 'image/png'].includes(file.type)) { addMessage('I can look at JPG or PNG images. If your phone offers HEIC, choose the JPEG version.', 'mike'); return; }
      if (file.size > 12 * 1024 * 1024) { addMessage('That image is too large. Please choose one under 12 MB.', 'mike'); return; }
      const prompt = window.prompt('What do you want Mike to look for?', 'What do you see in this photo?');
      if (!prompt || !prompt.trim()) return;
      try { await analyze(file, prompt.trim(), status, button); }
      catch (error) { console.error('[vision]', error); status.textContent = ''; status.style.display = 'none'; button.disabled = false; addMessage(error.message || 'Mike could not analyze that photo. Try again.', 'mike'); }
    });
    return true;
  }

  const observer = new MutationObserver(() => { if (install()) observer.disconnect(); });
  observer.observe(document.documentElement, { childList: true, subtree: true });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once: true }); else install();
})();
