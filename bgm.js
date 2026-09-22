/* Connect the streaming BGM player to the existing reader controls. */
(() => {
  'use strict';
  const track = document.getElementById('bgmTrack');
  const volume = document.getElementById('bgmVolume');
  const value = document.getElementById('bgmVolumeValue');
  const preview = document.getElementById('bgmPreview');
  const status = document.getElementById('bgmStatus');
  if (!track || !volume || !value || !preview || !status) return;
  const storageKey = 'duke-long-bgm-volume-v1';
  let playlists = null, player = null, prepared = null, testing = false, leaving = false, timer = null;
  const narrations = () => [...document.querySelectorAll('audio')];
  const reading = () => narrations().some(audio => !audio.paused && !audio.ended && !audio.error);
  const selected = () => playlists && Object.hasOwn(playlists, track.value) ? track.value : null;
  const level = () => Math.max(0, Math.min(100, Number(volume.value) || 0));
  function render() {
    value.textContent = level() + '%';
    volume.setAttribute('aria-valuetext', level() + '%');
    preview.disabled = !player || !selected() || leaving;
    preview.textContent = testing ? 'BGMの試聴を止める' : 'BGMだけ試す';
    preview.setAttribute('aria-pressed', String(testing));
  }
  function receive(detail) {
    if (detail.state === 'error' || detail.state === 'blocked' || detail.state === 'interrupted') {
      testing = false;
      if (detail.state !== 'interrupted') prepared = null;
    }
    const messages = {
      off: selected() ? '朗読の再生に合わせてBGMが流れます。' : 'BGMはオフです。',
      loading: 'BGMを読み込んでいます…',
      paused: '朗読の再生に合わせてBGMが流れます。',
      blocked: '「BGMだけ試す」か朗読の再生ボタンを押してください。',
      interrupted: 'BGMが中断されました。再生ボタンを押すと続きから流れます。',
      error: 'BGMを再生できませんでした。通信を確認し、「BGMだけ試す」で再度お試しください。'
    };
    status.textContent = detail.state === 'playing'
      ? `${playlists?.[detail.category]?.name || 'BGM'}を${testing ? '試聴中' : '朗読に合わせて再生中'}です。${detail.title ? ' ' + detail.title : ''}`
      : messages[detail.state] || '';
    render();
  }
  function createPlayer() {
    if (player || !playlists || leaving) return;
    player = new window.LongBgmPlayer({ playlists, onStatus: receive });
    player.setVolume(level() / 100);
    prepared = null;
    render();
  }
  // Preparing both media elements inside the gesture grants iOS playback permission.
  // Immediate pause keeps selecting a category while idle silent.
  function prepare(category, playNow) {
    if (!player) return;
    prepared = category;
    void player.start(category);
    if (!playNow) player.pause();
  }
  function sync(gesture = false) {
    render();
    if (!player || leaving) return;
    const category = selected();
    if (!category) { testing = false; prepared = null; player.stop(); render(); return; }
    const wanted = testing || reading();
    if (prepared !== category) {
      if (gesture || wanted) prepare(category, wanted);
      return;
    }
    if (wanted) void player.resume();
    else player.pause();
  }
  function unlock() {
    const category = selected();
    if (category && player && !leaving && prepared !== category) prepare(category, testing || reading());
  }
  track.value = 'off';
  track.disabled = true;
  volume.min = '0'; volume.max = '100'; volume.step = '0.5'; volume.value = '62.5';
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey));
    if (typeof saved === 'number' && Number.isFinite(saved) && saved >= 0 && saved <= 100) volume.value = String(saved);
  } catch {}
  status.textContent = 'BGMの一覧を読み込んでいます…';
  track.addEventListener('change', () => {
    if (!selected()) testing = false;
    sync(true);
  });
  volume.addEventListener('input', () => {
    player?.setVolume(level() / 100);
    try { localStorage.setItem(storageKey, JSON.stringify(level())); } catch {}
    render();
  });
  preview.addEventListener('click', () => {
    if (!selected() || !player || leaving) return;
    testing = !testing;
    if (testing) narrations().forEach(audio => audio.pause());
    sync(true);
  });
  document.addEventListener('click', unlock, true);
  document.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') unlock(); }, true);
  document.addEventListener('play', event => {
    if (!narrations().includes(event.target)) return;
    testing = false;
    clearTimeout(timer);
    sync();
  }, true);
  for (const name of ['pause', 'ended', 'emptied', 'error']) {
    document.addEventListener(name, event => {
      if (!narrations().includes(event.target)) return;
      clearTimeout(timer);
      timer = setTimeout(() => sync(), 50);
    }, true);
  }
  window.addEventListener('pagehide', () => {
    leaving = true; testing = false; prepared = null;
    clearTimeout(timer);
    player?.destroy(); player = null;
    render();
  });
  window.addEventListener('pageshow', () => {
    leaving = false;
    track.value = 'off'; testing = false;
    createPlayer(); render();
  });
  render();
  void (async () => {
    try {
      const response = await fetch('playlists.json', { credentials: 'same-origin' });
      if (response.status === 503) throw new Error('reflecting');
      if (!response.ok) throw new Error('Manifest unavailable');
      const text = await response.text();
      if (text.length > 500000) throw new Error('Manifest too large');
      playlists = JSON.parse(text);
      createPlayer();
      const options = [new Option('オフ', 'off')];
      for (const [key, list] of Object.entries(playlists)) options.push(new Option(list.name || key, key));
      track.replaceChildren(...options);
      track.value = 'off'; track.disabled = false;
      status.textContent = 'BGMはオフです。';
      render();
    } catch (error) {
      playlists = null;
      player?.destroy(); player = null;
      status.textContent = error?.message === 'reflecting'
        ? 'BGMを反映しています。しばらくしてページを開き直してください。'
        : 'BGMの一覧を読み込めませんでした。通信を確認してページを開き直してください。';
      track.disabled = true; preview.disabled = true;
    }
  })();
})();
