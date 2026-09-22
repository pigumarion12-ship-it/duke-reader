(() => {
  'use strict';
  const play = document.getElementById('listenPlay');
  const restart = document.getElementById('listenRestart');
  const volume = document.getElementById('listenVolume');
  const level = document.getElementById('listenVolumeValue');
  const status = document.getElementById('listenStatus');
  const title = document.getElementById('listenTitle');
  const subtitle = document.getElementById('listenSubtitle');
  const choices = [...document.querySelectorAll('input[name="bgmCategory"]')];
  let playlists = null, player = null, selected = null, prepared = null, state = 'off', leaving = false;
  function render() {
    play.disabled = !player || !selected || leaving;
    restart.disabled = !player || !selected || leaving;
    play.textContent = state === 'playing' || state === 'loading' ? '一時停止' : '再生';
    play.setAttribute('aria-pressed', String(state === 'playing' || state === 'loading'));
    const value = Math.max(0, Math.min(100, Number(volume.value) || 0));
    level.textContent = value + '%';
    volume.setAttribute('aria-valuetext', value + '%');
  }
  function receive(detail) {
    state = detail.state;
    const messages = { off: 'BGMはオフです。聴きたい種類を選んでください。', loading: '音声を読み込んでいます…',
      playing: 'BGMを再生しています。', paused: '一時停止しています。',
      blocked: '「再生」を押すとBGMが始まります。', interrupted: '音声が中断されました。「再生」で続きから聴けます。',
      error: 'BGMを再生できませんでした。通信を確認し、もう一度「再生」を押してください。' };
    status.textContent = messages[state] || '';
    if (detail.category && playlists?.[detail.category]) {
      title.textContent = playlists[detail.category].name;
      subtitle.textContent = detail.title ? `${detail.index + 1} / ${detail.totalTracks}　${detail.title}` : '';
    }
    render();
  }
  function createPlayer() {
    if (!playlists || leaving || player) return;
    player = new window.LongBgmPlayer({ playlists, onStatus: receive });
    player.setVolume(Number(volume.value) / 100);
    prepared = null;
    render();
  }
  choices.forEach(choice => choice.addEventListener('change', () => {
    if (!choice.checked || !playlists || !Object.hasOwn(playlists, choice.value)) return;
    selected = choice.value;
    if (player && (state === 'playing' || state === 'loading')) {
      prepared = selected;
      void player.start(selected);
    } else {
      player?.stop();
      prepared = null;
      title.textContent = playlists[selected].name;
      subtitle.textContent = `${playlists[selected].tracks.length}本の音源を順に再生します。`;
      status.textContent = '「再生」を押すとBGMが始まります。';
    }
    render();
  }));
  play.addEventListener('click', () => {
    if (!player || !selected || leaving) return;
    if (state === 'playing' || state === 'loading') player.pause();
    else if (prepared === selected && (state === 'paused' || state === 'interrupted')) void player.resume();
    else { prepared = selected; void player.start(selected); }
  });
  restart.addEventListener('click', () => {
    if (!player || !selected || leaving) return;
    player.stop();
    prepared = selected;
    void player.start(selected);
  });
  volume.addEventListener('input', () => { player?.setVolume(Number(volume.value) / 100); render(); });
  window.addEventListener('pagehide', () => { leaving = true; player?.destroy(); player = null; prepared = null; render(); });
  window.addEventListener('pageshow', () => { leaving = false; createPlayer(); render(); });
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
    } catch (error) {
      playlists = null;
      player?.destroy(); player = null;
      status.textContent = error?.message === 'reflecting'
        ? 'BGMを反映しています。しばらくしてページを開き直してください。'
        : 'BGMの一覧を読み込めませんでした。通信を確認してページを開き直してください。';
      render();
    }
  })();
})();
