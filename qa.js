/* Separate Q&A player. Existing book and supplement manifests remain unchanged. */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { root.DukeQA = api; api.mount(); }
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';
  const audioPrefix = 'audio/qa-exit-stop/';
  const speeds = [1, 1.25, 1.5, 1.75, 2];
  const sha = /^[a-f0-9]{64}$/;
  function isAllowedFile(file, order, index) {
    return Number.isInteger(order) && order >= 1 && order <= 15 && Number.isInteger(index) && index >= 1 && index <= 999 &&
      file === `${audioPrefix}qa${String(order).padStart(2, '0')}-p${String(index).padStart(3, '0')}.96k.mp3`;
  }
  function sourceURL(value) {
    if (typeof value !== 'string') return null;
    try {
      const url = new URL(value);
      if (url.protocol !== 'https:' || url.hostname !== 'investorduke.com' || url.port || url.username || url.password || !url.pathname.startsWith('/school/member_page/')) return null;
      return url.href;
    } catch { return null; }
  }
  function validate(data) {
    if (!data || data.schema_version !== 1 || !Array.isArray(data.items) || data.items.length !== 15) throw new Error('Invalid Q&A data');
    const ids = new Set();
    data.items.forEach((item, n) => {
      if (!item || item.order !== n + 1 || typeof item.id !== 'string' || !/^qa-[A-Za-z0-9_]+-\d{2}$/.test(item.id) || ids.has(item.id) ||
          typeof item.title !== 'string' || !item.title.trim() || item.title.length > 500 || (item.date !== null && (typeof item.date !== 'string' || !/^\d{4}-\d{2}(?:-\d{2})?$/.test(item.date))) ||
          typeof item.source_title !== 'string' || !sourceURL(item.source_url) || !sha.test(item.spoken_text_sha256) || !sha.test(item.manuscript_sha256) || item.original_audio_verified !== false ||
          !Array.isArray(item.paragraphs) || !item.paragraphs.length || item.paragraphs.some(p => typeof p !== 'string' || !p.trim() || p.length > 20000) ||
          !Array.isArray(item.audio) || !['pending', 'complete'].includes(item.audio_status) || (item.audio_status === 'complete') !== (item.audio.length > 0)) throw new Error('Invalid Q&A item');
      ids.add(item.id);
      item.audio.forEach((part, index) => {
        if (!part || part.index !== index + 1 || !isAllowedFile(part.file, item.order, part.index) ||
            !Number.isFinite(part.duration) || part.duration <= 0 || part.duration > 3600 || !Number.isSafeInteger(part.size) || part.size <= 0 || part.size > 25 * 1024 * 1024 || !sha.test(part.sha256)) throw new Error('Invalid Q&A audio');
      });
    });
    return data.items;
  }
  function mount() {
    const byId = id => document.getElementById(id);
    const player = byId('audio'), playButton = byId('audio-play'), reloadButton = byId('audio-reload'), partSelect = byId('audio-part'), speedSelect = byId('audio-speed'), openAudio = byId('audio-open');
    const storageKey = 'duke-qa-reader-v1';
    let items = [], current = 0, partIndex = 0, pending = 0, lastTime = 0, needsReload = false, switching = false, canContinue = false, loadId = 0, dataId = 0, controller;
    let saved = {};
    try { const value = JSON.parse(localStorage.getItem(storageKey)); if (value && typeof value === 'object') saved = value; } catch { /* Storage may be disabled. */ }
    speedSelect.value = String(speeds.includes(saved.speed) ? saved.speed : 1);
    const item = () => items[current];
    const recording = () => {
      const value = item()?.audio[partIndex];
      return value && isAllowedFile(value.file, item().order, partIndex + 1) ? value : null;
    };
    const position = () => pending || (player.error || needsReload ? lastTime : Number.isFinite(player.currentTime) ? player.currentTime : 0);
    function message(text) { byId('audio-status').textContent = text; }
    function node(tag, text, className) {
      const value = document.createElement(tag);
      if (text !== undefined) value.textContent = text;
      if (className) value.className = className;
      return value;
    }
    function persist() {
      if (!item()) return;
      try { localStorage.setItem(storageKey, JSON.stringify({ id: item().id, textHash: item().spoken_text_sha256, partIndex, time: position(), speed: Number(speedSelect.value) })); } catch { /* Playback also works without storage. */ }
    }
    function buttons() {
      playButton.disabled = reloadButton.disabled = !recording();
      playButton.textContent = needsReload || player.error ? '読み込み直して再生' : player.paused ? '▶ 再生する' : 'Ⅱ 一時停止';
      byId('previous-part').disabled = !recording() || partIndex === 0;
      byId('next-part').disabled = !recording() || partIndex + 1 >= item().audio.length;
    }
    function fallback(show = false) {
      const file = recording()?.file;
      openAudio.hidden = !show || !file;
      if (show && file) openAudio.href = file;
      else openAudio.removeAttribute('href');
    }
    function errorMessage(error) {
      if (error?.name === 'NotAllowedError') return '端末が再生を止めています。「再生する」を押して聴き始めてください。';
      if (player.error?.code === 2 || error?.name === 'NetworkError') return '通信が途切れました。「音声を読み込み直す」で続けられます。';
      if (player.error?.code === 3) return '音声を読み取れませんでした。読み込み直すか、別画面で開いてください。';
      if (player.error?.code === 4 || error?.name === 'NotSupportedError') return '音声を読み込めませんでした。読み込み直すか、別画面で開いてください。';
      if (player.error?.code === 1) return '音声の読み込みが中断されました。「音声を読み込み直す」で続けてください。';
      return '再生できませんでした。もう一度「再生する」を押すか、別画面で開いてください。';
    }
    function restore() {
      if (!pending || !Number.isFinite(player.duration)) return;
      const target = Math.min(pending, Math.max(0, player.duration - .05));
      try { player.currentTime = target; pending = 0; lastTime = target; } catch { /* Keep pending seek until canplay on mobile. */ }
    }
    function setPart(index, autoplay = false, seconds = 0) {
      const part = item()?.audio[index];
      if (!part || !isAllowedFile(part.file, item().order, index + 1)) return;
      switching = true; canContinue = false; loadId++; player.pause(); partIndex = index;
      pending = Number.isFinite(seconds) ? Math.max(0, Math.min(seconds, part.duration)) : 0;
      lastTime = pending; needsReload = false; partSelect.value = String(index);
      player.src = part.file; player.load(); player.playbackRate = Number(speedSelect.value); player.preservesPitch = true;
      switching = false; buttons(); fallback(); persist();
      message('Onyx B（AI音声）・「再生する」で聴き始める');
      if (autoplay) void play();
    }
    async function play(retry = false) {
      if (!recording()) return;
      if (retry && (needsReload || player.error)) setPart(partIndex, false, position());
      const expected = loadId;
      try { await player.play(); } catch (error) {
        if (expected !== loadId) return;
        canContinue = false;
        if (error?.name === 'AbortError') return;
        if (player.error || ['NotSupportedError', 'NetworkError'].includes(error?.name)) needsReload = true;
        buttons(); fallback(true); message(errorMessage(error));
      }
    }
    function clearAudio() {
      switching = true; canContinue = false; loadId++; player.pause(); player.removeAttribute('src'); player.load();
      partIndex = 0; pending = 0; lastTime = 0; needsReload = false; switching = false;
      partSelect.replaceChildren(); fallback(); buttons();
    }
    function renderCatalog() {
      const fragment = document.createDocumentFragment();
      for (const q of items) {
        const link = node('a', undefined, 'lecture-link'); link.href = '#' + encodeURIComponent(q.id);
        if (q.id === item()?.id) link.setAttribute('aria-current', 'page');
        link.append(node('span', `${String(q.order).padStart(2, '0')}  ${q.title}`, 'lecture-link-title'));
        link.append(node('span', q.audio_status === 'complete' ? '読む・聴く' : '本文を読む · 音声準備中', 'lecture-link-meta'));
        fragment.append(link);
      }
      byId('qa-list').replaceChildren(fragment);
    }
    function selectQuestion(index, restoreSaved = false, autoplay = false) {
      if (!Number.isInteger(index) || !items[index]) return;
      current = index; clearAudio();
      const q = item();
      byId('qa-title').textContent = q.title;
      byId('qa-meta').textContent = `質問 ${q.order} / 15 · ${q.date ? q.date + 'の講座' : '収録日未確認'}`;
      document.title = `${q.title} | Personal Library`;
      const source = byId('source-link'); source.href = sourceURL(q.source_url); source.hidden = false;
      byId('previous-question').disabled = index === 0; byId('next-question').disabled = index === items.length - 1;
      const fragment = document.createDocumentFragment();
      q.paragraphs.forEach(text => { const section = node('section'); section.append(node('p', text)); fragment.append(section); });
      byId('qa-text').replaceChildren(fragment); byId('audio-controls').hidden = !q.audio.length;
      renderCatalog();
      if (!q.audio.length) { buttons(); message('音声は準備中です。本文は読めます。'); persist(); return; }
      q.audio.forEach((part, index) => { const option = node('option', `区切り ${index + 1} / ${q.audio.length}`); option.value = String(index); partSelect.append(option); });
      const resume = restoreSaved && saved.id === q.id && saved.textHash === q.spoken_text_sha256 && Number.isInteger(saved.partIndex) && saved.partIndex >= 0 && saved.partIndex < q.audio.length;
      setPart(resume ? saved.partIndex : 0, autoplay, resume && Number.isFinite(saved.time) ? saved.time : 0);
    }
    function continueReading() {
      if (switching || !canContinue || !player.ended || player.error || needsReload || !recording()) return;
      canContinue = false;
      if (partIndex + 1 < item().audio.length) { setPart(partIndex + 1, true); return; }
      const next = items.findIndex((q, index) => index > current && q.audio.length > 0);
      if (next >= 0) {
        history.replaceState(null, '', '#' + encodeURIComponent(items[next].id));
        selectQuestion(next, false, true);
      } else {
        buttons(); message('質問と回答を最後まで聴き終えました。'); persist();
      }
    }
    function fromHash(initial = false) {
      if (!items.length) return;
      let id; try { id = decodeURIComponent(location.hash.slice(1)); } catch { id = ''; }
      if (!id && initial && typeof saved.id === 'string') id = saved.id;
      let index = items.findIndex(q => q.id === id); if (index < 0) index = 0;
      if (location.hash !== '#' + items[index].id) history.replaceState(null, '', '#' + encodeURIComponent(items[index].id));
      if (!initial && index === current) return;
      selectQuestion(index, initial);
      if (!initial) { if (matchMedia('(max-width: 860px)').matches) byId('catalog').open = false; byId('qa-title').focus({ preventScroll: true }); byId('reading').scrollIntoView({ block: 'start' }); }
    }
    async function load() {
      const expected = ++dataId; controller?.abort(); const request = new AbortController(); controller = request;
      const timer = setTimeout(() => request.abort(), 15000);
      byId('retry-data').disabled = true; byId('reading').setAttribute('aria-busy', 'true');
      try {
        const response = await fetch('qa-data.json', { cache: 'no-store', signal: request.signal });
        if (!response.ok) throw new Error('Unavailable');
        const loaded = validate(await response.json()); if (expected !== dataId) return;
        items = loaded; byId('load-error').hidden = true; fromHash(true);
      } catch {
        if (expected !== dataId) return;
        items = []; clearAudio(); byId('audio-controls').hidden = true; byId('qa-list').replaceChildren(); byId('qa-text').replaceChildren();
        byId('previous-question').disabled = byId('next-question').disabled = true;
        byId('source-link').hidden = true; byId('source-link').removeAttribute('href'); byId('qa-title').textContent = '質問を読み込めませんでした';
        byId('load-error').hidden = false; message('本文と音声を読み込めませんでした。');
      } finally {
        clearTimeout(timer);
        if (expected === dataId) { byId('retry-data').disabled = false; byId('reading').setAttribute('aria-busy', 'false'); }
      }
    }
    playButton.addEventListener('click', () => { if (player.paused || needsReload || player.error) void play(true); else { canContinue = false; player.pause(); } });
    reloadButton.addEventListener('click', () => { if (recording()) { setPart(partIndex, false, position()); void play(); } });
    partSelect.addEventListener('change', () => setPart(Number(partSelect.value), !player.paused));
    speedSelect.addEventListener('change', () => { if (!speeds.includes(Number(speedSelect.value))) speedSelect.value = '1'; player.playbackRate = Number(speedSelect.value); player.preservesPitch = true; persist(); });
    byId('previous-part').addEventListener('click', () => { if (partIndex > 0) setPart(partIndex - 1, !player.paused); });
    byId('next-part').addEventListener('click', () => { if (partIndex + 1 < item()?.audio.length) setPart(partIndex + 1, !player.paused); });
    for (const [id, delta] of [['previous-question', -1], ['next-question', 1]]) byId(id).addEventListener('click', () => { if (items[current + delta]) location.hash = encodeURIComponent(items[current + delta].id); });
    player.addEventListener('loadedmetadata', () => { restore(); player.playbackRate = Number(speedSelect.value); });
    player.addEventListener('canplay', restore);
    player.addEventListener('timeupdate', () => { if (!player.error && !needsReload && !pending && Number.isFinite(player.currentTime)) lastTime = player.currentTime; if (!switching) persist(); });
    player.addEventListener('play', () => { if (!recording() || player.paused || player.error) return; canContinue = true; buttons(); message('音声を読み込んでいます…'); });
    player.addEventListener('playing', () => { if (recording() && !player.paused && !player.error) { needsReload = false; restore(); buttons(); fallback(); message('再生中 · Onyx B（AI音声）'); } });
    player.addEventListener('waiting', () => { if (recording() && !player.paused && !player.error) message('音声の続きを読み込んでいます…'); });
    player.addEventListener('stalled', () => { if (recording() && !player.paused && !player.error) message('音声の読み込みを待っています。止まったままなら「音声を読み込み直す」を押してください。'); });
    player.addEventListener('pause', () => { if (!switching && recording() && player.paused) { if (!player.ended) canContinue = false; buttons(); persist(); if (!player.error && !needsReload && !player.ended) message('一時停止'); } });
    player.addEventListener('error', () => { if (switching || !recording()) return; canContinue = false; if (Number.isFinite(player.currentTime) && player.currentTime > 0) lastTime = player.currentTime; needsReload = true; buttons(); fallback(true); message(errorMessage()); });
    player.addEventListener('ended', continueReading);
    byId('retry-data').addEventListener('click', load);
    byId('skip-to-reading').addEventListener('click', event => {
      event.preventDefault();
      byId('reading').focus({ preventScroll: true });
      byId('reading').scrollIntoView({ block: 'start' });
    });
    addEventListener('hashchange', () => fromHash());
    addEventListener('pagehide', () => { canContinue = false; persist(); player.pause(); });
    void load();
  }
  return Object.freeze({ isAllowedFile, sourceURL, validate, mount });
});
