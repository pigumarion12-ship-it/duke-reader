/* Streaming background playlists. No narration element is read or modified. */
(function (root, factory) {
  'use strict';
  const Player = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = Player;
  else root.LongBgmPlayer = Player;
})(typeof window !== 'undefined' ? window : globalThis, function (root) {
  'use strict';
  const MAX_GAIN = 0.32;
  const FADE_SECONDS = 4;

  function copyPlaylists(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TypeError('Invalid playlists');
    const output = Object.create(null);
    const base = root.location && root.location.href;
    if (!base || !/^https?:/.test(base)) throw new TypeError('HTTP origin required');
    const origin = new URL(base).origin;
    for (const [category, value] of Object.entries(input)) {
      if (!/^[a-z][a-z0-9_-]{0,47}$/.test(category)) throw new TypeError('Invalid category');
      const tracks = Array.isArray(value) ? value : value && value.tracks;
      if (!Array.isArray(tracks) || !tracks.length || tracks.length > 256) throw new TypeError('Invalid tracks');
      const seen = new Set();
      output[category] = Object.freeze(tracks.map(track => {
        if (!track || typeof track.src !== 'string' || track.src.length > 1024 ||
            !/^\/?(?:[a-zA-Z0-9_.-]+\/)*[a-zA-Z0-9_.-]+\.(?:mp3|m4a|ogg|aac|wav)$/.test(track.src) ||
            track.src.split('/').some(part => part === '..' || part === '.')) throw new TypeError('Invalid audio path');
        const url = new URL(track.src, base);
        if (url.origin !== origin || url.username || url.password || seen.has(url.href)) throw new TypeError('Invalid or repeated source');
        if (!(Number.isFinite(track.duration) && track.duration > 0 && track.duration <= 14400)) throw new TypeError('Invalid duration');
        seen.add(url.href);
        return Object.freeze({ src: track.src, duration: track.duration, title: String(track.title || '').slice(0, 500) });
      }));
    }
    if (!Object.keys(output).length) throw new TypeError('Empty playlists');
    return Object.freeze(output);
  }

  class LongBgmPlayer {
    // start() belongs in a click/change handler. resume() may synchronize an already
    // authorized BGM session with narration. Construction and saved preferences never play.
    // setVolume(0..1) maps to a hard maximum gain of 0.32; the default 0.625 is gain 0.2.
    constructor({ playlists, onStatus = () => {} } = {}) {
      Object.defineProperty(this, 'playlists', { value: copyPlaylists(playlists), enumerable: true });
      this._onStatus = typeof onStatus === 'function' ? onStatus : () => {};
      this._volume = 0.625;
      this._generation = 0;
      this._authorized = false;
      this._desired = false;
      this._destroyed = false;
      this._context = null;
      this._master = null;
      this._decks = [];
      this._active = null;
      this._category = null;
      this._index = 0;
      this._fade = null;
      this._pending = null;
      this._timer = null;
      this._state = 'off';
      this._visibility = () => this._tick();
      root.document?.addEventListener('visibilitychange', this._visibility);
      this._emit('off');
    }

    _emit(state, reason = null) {
      this._state = state;
      const tracks = this._category ? this.playlists[this._category] : null;
      const track = tracks && tracks[this._index];
      const detail = Object.freeze({ state, reason, category: this._category,
        index: this._index, title: track?.title || '', volume: this._volume,
        gain: this._volume * MAX_GAIN, totalTracks: tracks?.length || 0 });
      try { this._onStatus(detail); } catch { /* A UI callback cannot interrupt cleanup. */ }
    }

    _ensureAudio() {
      if (this._context) return;
      const Context = root.AudioContext || root.webkitAudioContext;
      if (!Context || !root.Audio) throw new Error('Audio unavailable');
      const context = new Context();
      this._context = context;
      this._master = context.createGain();
      this._master.gain.value = this._volume * MAX_GAIN;
      this._master.connect(context.destination);
      for (let i = 0; i < 2; i++) {
        const audio = new root.Audio();
        audio.preload = 'metadata';
        audio.autoplay = false;
        audio.loop = false;
        audio.playbackRate = 1;
        audio.defaultPlaybackRate = 1;
        audio.preservesPitch = true;
        audio.volume = 1; // iOS volume control is handled by the GainNode.
        audio.disableRemotePlayback = true;
        audio.setAttribute('playsinline', '');
        const source = context.createMediaElementSource(audio);
        const gain = context.createGain();
        gain.gain.value = 0;
        source.connect(gain);
        gain.connect(this._master);
        const deck = { audio, source, gain, category: null, index: null, revision: 0, playId: 0, level: 0, handlers: [] };
        for (const event of ['timeupdate', 'ended', 'loadedmetadata']) {
          const listener = () => this._tick();
          audio.addEventListener(event, listener);
          deck.handlers.push([event, listener]);
        }
        const error = () => {
          if (audio.error && this._desired && (this._active === i || this._pending?.slot === i || this._fade?.to === i)) this._fail('media-error');
        };
        audio.addEventListener('error', error);
        deck.handlers.push(['error', error]);
        this._decks.push(deck);
      }
      this._contextState = () => {
        if (!this._desired || this._destroyed) return;
        if (context.state === 'running') this._tick();
        else if (context.state === 'suspended' || context.state === 'interrupted') {
          // Do not silently consume minutes of a track while iOS has muted its context.
          this.pause();
          this._emit('interrupted', 'audio-context');
        }
      };
      context.addEventListener?.('statechange', this._contextState);
    }

    _assign(slot, category, index) {
      const deck = this._decks[slot];
      if (deck.category === category && deck.index === index && !deck.audio.error) return;
      deck.audio.pause();
      deck.revision++;
      deck.category = category;
      deck.index = index;
      this._setLevel(slot, 0);
      deck.audio.src = this.playlists[category][index].src;
      deck.audio.playbackRate = 1;
      deck.audio.load();
    }

    _setLevel(slot, value, seconds = 0) {
      const deck = this._decks[slot];
      const now = this._context.currentTime;
      deck.gain.gain.cancelScheduledValues(now);
      deck.gain.gain.setValueAtTime(deck.level, now);
      if (seconds) deck.gain.gain.linearRampToValueAtTime(value, now + seconds);
      else deck.gain.gain.setValueAtTime(value, now);
      deck.level = value;
    }

    _play(slot, generation) {
      const deck = this._decks[slot];
      const revision = deck.revision;
      const playId = ++deck.playId;
      deck.audio.playbackRate = 1;
      let played;
      try { played = deck.audio.play(); } catch (error) { played = Promise.reject(error); }
      return Promise.resolve(played).then(() => {
        if (this._destroyed || generation !== this._generation || !this._desired) {
          if (revision === deck.revision && playId === deck.playId) deck.audio.pause();
          return false;
        }
        return revision === deck.revision && playId === deck.playId;
      });
    }

    _schedule() {
      if (this._timer !== null) return;
      this._timer = root.setInterval(() => this._tick(), 250);
    }

    _unschedule() {
      if (this._timer !== null) root.clearInterval(this._timer);
      this._timer = null;
    }

    _remaining(slot) {
      const audio = this._decks[slot].audio;
      // Browser media duration, not manifest duration, determines the boundary.
      return Number.isFinite(audio.duration) ? Math.max(0, audio.duration - audio.currentTime) : Infinity;
    }

    _freezeFade() {
      const fade = this._fade;
      if (!fade || fade.started === null) return;
      const progress = Math.min(1, Math.max(0, (this._context.currentTime - fade.started) / fade.duration));
      const fromLevel = fade.fromLevel * (1 - progress);
      const toLevel = fade.toLevel + (1 - fade.toLevel) * progress;
      this._decks[fade.from].level = fromLevel;
      this._decks[fade.to].level = toLevel;
      this._setLevel(fade.from, fromLevel);
      this._setLevel(fade.to, toLevel);
      fade.fromLevel = fromLevel;
      fade.toLevel = toLevel;
      fade.duration = Math.max(0.05, fade.duration * (1 - progress));
      fade.started = null;
    }

    _runFade(fade) {
      fade.started = this._context.currentTime;
      this._setLevel(fade.from, 0, fade.duration);
      this._setLevel(fade.to, 1, fade.duration);
    }

    _beginFade(from, to, duration = FADE_SECONDS) {
      const fade = { from, to, duration, started: null,
        fromLevel: this._decks[from].level, toLevel: this._decks[to].level };
      this._fade = fade;
      this._runFade(fade);
      this._emit('playing');
      this._schedule();
    }

    _finishFade() {
      const fade = this._fade;
      if (!fade) return;
      this._decks[fade.from].audio.pause();
      this._setLevel(fade.from, 0);
      this._setLevel(fade.to, 1);
      this._active = fade.to;
      this._index = this._decks[fade.to].index;
      this._fade = null;
      this._emit('playing');
      this._prepareNext();
    }

    _prepareNext() {
      if (this._active === null || this._fade || this._pending) return;
      const next = (this._index + 1) % this.playlists[this._category].length;
      this._assign(1 - this._active, this._category, next);
    }

    async _next() {
      if (this._pending || this._fade || !this._desired || this._active === null) return;
      const generation = this._generation;
      const from = this._active;
      const to = 1 - from;
      const next = (this._index + 1) % this.playlists[this._category].length;
      this._assign(to, this._category, next);
      // A previously primed deck is always reset before its audible first play.
      this._decks[to].audio.currentTime = 0;
      this._setLevel(to, 0);
      const pending = { slot: to, generation };
      this._pending = pending;
      try {
        const ready = await this._play(to, generation);
        if (!ready || this._pending !== pending) return;
        this._pending = null;
        const remaining = this._remaining(from);
        this._beginFade(from, to, Math.max(0.15, Math.min(FADE_SECONDS, remaining)));
      } catch (error) {
        if (generation === this._generation) this._fail(error?.name === 'NotAllowedError' ? 'user-action-required' : 'play-error');
      }
    }

    _tick() {
      if (!this._desired || this._destroyed || !this._context || this._context.state !== 'running') return;
      if (this._fade) {
        const fade = this._fade;
        if (fade.started === null) return;
        if (this._context.currentTime - fade.started >= fade.duration) this._finishFade();
        else return;
      }
      if (this._active === null || this._pending) return;
      const audio = this._decks[this._active].audio;
      if (audio.ended || this._remaining(this._active) <= FADE_SECONDS) void this._next();
    }

    async start(category) {
      if (this._destroyed) return false;
      if (!Object.hasOwn(this.playlists, category)) throw new TypeError('Unknown category');
      if (this._category === category && this._desired) return true;
      if (root.navigator?.userActivation && !root.navigator.userActivation.isActive) {
        this._emit(this._desired ? this._state : 'blocked', 'user-action-required');
        return false;
      }
      if (this._category === category && this._state === 'paused') return this.resume();
      const generation = ++this._generation;
      const wasPlaying = this._desired;
      this._desired = true;
      this._authorized = true;
      this._pending = null;
      this._freezeFade();
      let old = wasPlaying ? this._active : null;
      if (wasPlaying && this._fade) old = this._decks[this._fade.to].level >= this._decks[this._fade.from].level ? this._fade.to : this._fade.from;
      this._fade = null;
      this._category = category;
      this._index = 0;
      this._emit('loading');
      try {
        this._ensureAudio();
        const slot = old === null ? 0 : 1 - old;
        for (let i = 0; i < this._decks.length; i++) if (i !== old) { this._decks[i].audio.pause(); this._setLevel(i, 0); }
        this._assign(slot, category, 0);
        this._decks[slot].audio.currentTime = 0;
        const pending = { slot, generation };
        this._pending = pending;
        const resumed = this._context.resume();
        const played = this._play(slot, generation);
        // Both elements receive play() in the user gesture. Muted priming is bounded
        // and is invalidated by a newer play attempt, so a slow promise cannot stop it.
        if (old === null && this.playlists[category].length > 1) {
          const primeSlot = 1 - slot;
          this._assign(primeSlot, category, 1);
          const deck = this._decks[primeSlot], revision = deck.revision;
          const prime = this._play(primeSlot, generation), playId = deck.playId;
          void prime.then(() => {
            if (deck.revision === revision && deck.playId === playId) { deck.audio.pause(); try { deck.audio.currentTime = 0; } catch {} }
          }).catch(() => { if (deck.revision === revision && deck.playId === playId) deck.audio.pause(); });
        }
        const [ready] = await Promise.all([played, resumed]);
        if (!ready || generation !== this._generation || this._pending !== pending) return false;
        this._pending = null;
        if (old !== null) this._beginFade(old, slot);
        else {
          this._active = slot;
          this._setLevel(slot, 1, 0.6);
          this._emit('playing');
          this._prepareNext();
          this._schedule();
        }
        return true;
      } catch (error) {
        if (generation === this._generation) this._fail(error?.name === 'NotAllowedError' ? 'user-action-required' : 'play-error');
        return false;
      }
    }

    pause() {
      if (this._destroyed || !this._authorized || !this._category) return;
      this._desired = false;
      this._generation++;
      this._freezeFade();
      if (this._pending) {
        // If an explicit selection is still loading, retain that selection for resume.
        const incoming = this._decks[this._pending.slot];
        if (incoming && (this._active === null || this._decks[this._active].category !== this._category)) {
          this._active = this._pending.slot;
          this._index = incoming.index;
          for (let i = 0; i < this._decks.length; i++) this._setLevel(i, i === this._active ? 1 : 0);
        }
        this._pending = null;
      }
      this._decks.forEach(deck => deck.audio.pause());
      this._unschedule();
      this._emit('paused');
    }

    async resume() {
      if (this._destroyed || !this._authorized || this._active === null || !this._category) return false;
      if (this._desired && this._context.state === 'running') return true;
      const generation = ++this._generation;
      this._desired = true;
      this._emit('loading');
      try {
        const resumed = this._context.resume();
        const slots = this._fade ? [this._fade.from, this._fade.to] : [this._active];
        const results = await Promise.all([...slots.map(slot => this._play(slot, generation)), resumed]);
        if (generation !== this._generation || !this._desired || results.slice(0, slots.length).some(result => !result)) return false;
        if (this._fade) this._runFade(this._fade);
        else this._setLevel(this._active, 1, 0.35);
        this._emit('playing');
        this._schedule();
        this._tick();
        return true;
      } catch (error) {
        if (generation === this._generation) this._fail(error?.name === 'NotAllowedError' ? 'user-action-required' : 'play-error');
        return false;
      }
    }

    setVolume(value) {
      if (this._destroyed || typeof value !== 'number' || !Number.isFinite(value)) return;
      this._volume = Math.max(0, Math.min(1, value));
      if (this._master) {
        const now = this._context.currentTime;
        this._master.gain.cancelScheduledValues(now);
        this._master.gain.setValueAtTime(this._master.gain.value, now);
        this._master.gain.linearRampToValueAtTime(this._volume * MAX_GAIN, now + 0.12);
      }
      this._emit(this._state);
    }

    _fail(reason) {
      this._desired = false;
      this._generation++;
      this._pending = null;
      this._fade = null;
      this._unschedule();
      this._decks.forEach((deck, index) => { deck.audio.pause(); this._setLevel(index, 0); });
      this._emit('error', reason);
    }

    stop() {
      if (this._destroyed) return;
      this._desired = false;
      this._generation++;
      this._pending = null;
      this._fade = null;
      this._active = null;
      this._category = null;
      this._index = 0;
      this._unschedule();
      this._decks.forEach((deck, index) => {
        deck.audio.pause();
        this._setLevel(index, 0);
        deck.revision++;
        deck.category = null;
        deck.index = null;
        deck.audio.removeAttribute('src');
        deck.audio.load();
      });
      this._emit('off');
    }

    destroy() {
      if (this._destroyed) return;
      this.stop();
      this._destroyed = true;
      root.document?.removeEventListener('visibilitychange', this._visibility);
      this._decks.forEach(deck => {
        deck.handlers.forEach(([event, listener]) => deck.audio.removeEventListener(event, listener));
        deck.source.disconnect();
        deck.gain.disconnect();
      });
      if (this._context) {
        this._context.removeEventListener?.('statechange', this._contextState);
        this._master.disconnect();
        void this._context.close().catch(() => {});
      }
      this._decks = [];
      this._onStatus = () => {};
    }
  }
  return LongBgmPlayer;
});
