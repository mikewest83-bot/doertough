const pollAvatar = async (generationId) => {
  const job = ++avatarJobRef.current;
  if (!generationId) return;

  try {
    // Poll for up to ~90 seconds (120 × 750ms)
    for (let i = 0; i < 120; i++) {
      await new Promise((x) => setTimeout(x, 750));
      if (job !== avatarJobRef.current) return;

      try {
        const sd = await fetchJson(`/api/avatar/${encodeURIComponent(generationId)}`, {}, 12000);

        if (job !== avatarJobRef.current) return;

        if (sd.status === 'completed' && sd.videoUrl) {
          setVideo(sd.videoUrl);
          setAvatarReady(true);
          return;
        }

        if (sd.status === 'failed') {
          console.warn('Avatar generation failed');
          return;
        }
      } catch (err) {
        // Keep trying on temporary network issues
        if (err.name === 'AbortError') return;
        console.warn('Avatar poll temporary failure', err.message);
      }
    }
  } catch (e) {
    if (e.name !== 'AbortError') console.warn('avatar unavailable', e);
  }
};