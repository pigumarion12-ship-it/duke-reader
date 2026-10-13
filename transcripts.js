"use strict";

(() => {
  const byId = (id) => document.getElementById(id);
  const ui = {
    skip: byId("skip-to-reading"),
    catalog: byId("catalog"),
    count: byId("catalog-count"),
    search: byId("lecture-search"),
    searchResult: byId("search-result"),
    list: byId("lecture-list"),
    emptySearch: byId("empty-search"),
    clearSearch: byId("clear-search"),
    reading: byId("reading"),
    title: byId("lecture-title"),
    meta: byId("lecture-meta"),
    source: byId("source-link"),
    status: byId("lecture-status"),
    error: byId("load-error"),
    retry: byId("retry"),
    transcript: byId("transcript"),
    paging: [byId("paging-top"), byId("paging-bottom")],
  };
  let lectures = [];
  let currentCode = "";
  let loading = false;
  let editions = new Map();
  let library = { chapters: [] };
  let view = "reading";
  let audioParts = [];
  let audioIndex = 0;
  const player = byId("narration");
  const partSelect = byId("narration-part");
  const speedSelect = byId("narration-speed");
  const playButton = byId("audio-play");
  const reloadAudio = byId("audio-reload");
  const openAudio = byId("audio-open");
  let audioLoadId = 0, audioPendingTime = 0, audioLastTime = 0;
  let audioNeedsReload = false, audioSwitching = false;

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function sourceURL(value) {
    if (typeof value !== "string") return null;
    try {
      const url = new URL(value);
      if (url.protocol !== "https:" || url.hostname !== "investorduke.com" ||
          url.port || url.username || url.password ||
          !url.pathname.startsWith("/school/member_page/")) return null;
      return url.href;
    } catch {
      return null;
    }
  }

  function validate(data) {
    if (!data || !Array.isArray(data.lectures) || data.lectures.length === 0 ||
        !Number.isInteger(data.total) || data.total !== data.lectures.length ||
        !Number.isInteger(data.available)) throw new Error("Invalid catalog");
    const codes = new Set();
    let available = 0;
    for (const lecture of data.lectures) {
      if (!lecture || typeof lecture.code !== "string" || !lecture.code.trim() ||
          codes.has(lecture.code) || typeof lecture.title !== "string" ||
          !lecture.title.trim() || typeof lecture.group !== "string" ||
          !["available", "pending"].includes(lecture.status) ||
          !Array.isArray(lecture.cues)) throw new Error("Invalid lecture");
      codes.add(lecture.code);
      if (lecture.status === "available") {
        available += 1;
        if (lecture.cues.length === 0) throw new Error("Missing transcript");
      }
      for (const cue of lecture.cues) {
        if (!cue || !Number.isFinite(cue.start_ms) || !Number.isFinite(cue.end_ms) ||
            cue.start_ms < 0 || cue.end_ms < cue.start_ms ||
            typeof cue.text !== "string") throw new Error("Invalid cue");
      }
    }
    if (data.available !== available) throw new Error("Invalid availability");
    return data.lectures;
  }

  function hashCode() {
    try { return decodeURIComponent(window.location.hash.slice(1)); }
    catch { return ""; }
  }

  function lectureLink(lecture, className) {
    const link = element("a", className);
    link.href = `#${encodeURIComponent(lecture.code)}`;
    link.addEventListener("click", (event) => {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      if (currentCode === lecture.code) {
        focusReading();
      } else {
        window.location.hash = encodeURIComponent(lecture.code);
      }
    });
    return link;
  }

  function normalized(text) {
    return text.normalize("NFKC").toLocaleLowerCase("ja").trim();
  }

  function renderCatalog() {
    const query = normalized(ui.search.value);
    const matches = lectures.filter((lecture) => normalized(lecture.title).includes(query));
    const fragment = document.createDocumentFragment();
    for (const lecture of matches) {
      const link = lectureLink(lecture, "lecture-link");
      if (lecture.code === currentCode) link.setAttribute("aria-current", "page");
      link.append(element("span", "lecture-link-title", lecture.title));
      const status = lecture.status === "pending" ? "準備中" : "閲覧できます";
      link.append(element("span", "lecture-link-meta", [lecture.group, status].filter(Boolean).join(" · ")));
      fragment.append(link);
    }
    ui.list.replaceChildren(fragment);
    ui.emptySearch.hidden = matches.length > 0;
    ui.searchResult.textContent = query
      ? `${lectures.length}講座のうち${matches.length}講座が見つかりました。`
      : `${lectures.length}講座から選べます。${lectures.some((lecture) => lecture.status === "pending") ? "準備中の講座も表示しています。" : ""}`;
  }

  function timestamp(milliseconds) {
    const total = Math.floor(milliseconds / 1000);
    const seconds = String(total % 60).padStart(2, "0");
    const minutes = Math.floor(total / 60);
    if (minutes < 60) return `${minutes}:${seconds}`;
    return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}:${seconds}`;
  }

  function renderPaging(index) {
    for (const nav of ui.paging) {
      const fragment = document.createDocumentFragment();
      for (const direction of [-1, 1]) {
        const lecture = lectures[index + direction];
        if (lecture) {
          const link = lectureLink(lecture, "paging-link");
          link.append(element("span", "", direction === -1 ? "前の講座" : "次の講座"));
          link.append(element("span", "paging-title", lecture.title));
          if (lecture.status === "pending") link.append(element("small", "", "準備中"));
          fragment.append(link);
        } else {
          fragment.append(element("span", "paging-edge", direction === -1 ? "最初の講座です" : "最後の講座です"));
        }
      }
      nav.replaceChildren(fragment);
      nav.hidden = false;
    }
  }

  function renderTranscript(lecture) {
    const edited = editions.get(lecture.code);
    byId("edition-reading").setAttribute("aria-pressed", String(view === "reading"));
    byId("edition-source").setAttribute("aria-pressed", String(view === "source"));
    if (view === "reading" && edited) {
      const fragment = document.createDocumentFragment();
      for (const paragraph of edited.paragraphs) {
        const row = element("section", "reading-paragraph" + (paragraph.uncertain ? " uncertain" : ""));
        row.append(element("span", "cue-time", `${timestamp(paragraph.start_ms)}–${timestamp(paragraph.end_ms)}`));
        row.append(element("p", "", paragraph.text));
        if (paragraph.uncertain) row.append(element("small", "reading-note", "この段落には、字幕・書き起こしだけでは確定できない箇所があります。"));
        fragment.append(row);
      }
      ui.transcript.replaceChildren(fragment);
      return;
    }
    if (lecture.status === "pending") {
      ui.transcript.replaceChildren(element("p", "message", "この講座の書き起こしは準備中です"));
      return;
    }
    const list = element("ol", "cue-list");
    list.setAttribute("aria-label", lecture.code === "20210414" ? "音声区間ごとの書き起こし" : "時刻付きの書き起こし");
    for (const cue of lecture.cues) {
      const row = element("li", "cue");
      const time = element("span", "cue-time", `${timestamp(cue.start_ms)}–${timestamp(cue.end_ms)}`);
      time.setAttribute("aria-label", `${timestamp(cue.start_ms)}から${timestamp(cue.end_ms)}まで`);
      row.append(time, element("p", "cue-text", cue.text));
      list.append(row);
    }
    ui.transcript.replaceChildren(list);
  }

  function focusReading() {
    if (window.matchMedia("(max-width: 860px)").matches) ui.catalog.open = false;
    ui.title.focus({ preventScroll: true });
    ui.reading.scrollIntoView({ block: "start" });
  }

  function selectFromHash(focus = false) {
    if (!lectures.length) return;
    const requested = hashCode();
    let index = lectures.findIndex((lecture) => lecture.code === requested);
    const missing = Boolean(window.location.hash) && index < 0;
    if (index < 0) index = 0;
    const lecture = lectures[index];
    const changedLecture = currentCode !== lecture.code;
    currentCode = lecture.code;
    if (requested !== currentCode) {
      window.history.replaceState(null, "", `#${encodeURIComponent(currentCode)}`);
    }
    ui.title.textContent = lecture.title;
    ui.meta.textContent = [lecture.group, `${index + 1} / ${lectures.length}講座`].filter(Boolean).join(" · ");
    const url = sourceURL(lecture.source_url);
    ui.source.removeAttribute("href");
    ui.source.hidden = !url;
    if (url) ui.source.href = url;
    ui.status.textContent = missing
      ? "指定された講座が見つからなかったため、最初の講座を表示しています。"
      : view === "reading"
        ? "AIが整えた読み上げ用の文章です。原音との全編照合は未実施です。時刻は元の書き起こしに対応します。"
        : lecture.code === "20210414"
          ? "音声からの自動書き起こしです。時刻は約5分の音声区間で、文ごとの時刻ではありません。"
          : "保存字幕をそのまま表示しています。時刻は元動画の位置です。";
    document.title = `${lecture.title} | Personal Library`;
    renderCatalog();
    renderPaging(index);
    renderTranscript(lecture);
    if (changedLecture) renderAudio(lecture);
    if (focus) focusReading();
  }

  async function load() {
    if (loading) return;
    loading = true;
    ui.error.hidden = true;
    ui.retry.disabled = true;
    ui.search.disabled = true;
    ui.reading.setAttribute("aria-busy", "true");
    ui.title.textContent = "講座を読み込んでいます";
    ui.status.textContent = "";
    ui.searchResult.textContent = "講座を読み込んでいます。";
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 20000);
    try {
      const response = await fetch("./transcripts.json", {
        credentials: "same-origin",
        mode: "same-origin",
        redirect: "error",
        signal: controller.signal,
      });
      if (!response.ok) throw new Error("Could not load catalog");
      const data = await response.json();
      const [editedResponse, libraryResponse] = await Promise.all([
        fetch("./reading-edition.json", { credentials: "same-origin", mode: "same-origin", redirect: "error", signal: controller.signal }),
        fetch("./library.json", { credentials: "same-origin", mode: "same-origin", redirect: "error", signal: controller.signal }),
      ]);
      if (!editedResponse.ok || !libraryResponse.ok) throw new Error("Could not load reading edition");
      const edited = await editedResponse.json();
      library = DukeAudioSource.validateLibrary(await libraryResponse.json());
      if (!Array.isArray(edited.lectures) || edited.lectures.length !== data.total || !Array.isArray(library.chapters)) throw new Error("Invalid reading edition");
      editions = new Map();
      for (const lecture of edited.lectures) {
        if (!lecture || typeof lecture.code !== "string" || editions.has(lecture.code) || !data.lectures.some(l => l.code === lecture.code) ||
            !Array.isArray(lecture.paragraphs) || !lecture.paragraphs.length) throw new Error("Invalid reading lecture");
        for (const p of lecture.paragraphs) {
          if (!p || typeof p.text !== "string" || !p.text.trim() || !Number.isInteger(p.start_ms) || !Number.isInteger(p.end_ms) ||
              p.start_ms < 0 || p.end_ms < p.start_ms || typeof p.uncertain !== "boolean") throw new Error("Invalid reading paragraph");
        }
        editions.set(lecture.code, lecture);
      }
      lectures = validate(data);
      ui.count.textContent = `全${data.total}講座`;
      ui.search.disabled = false;
      selectFromHash();
    } catch {
      lectures = [];
      currentCode = "";
      ui.list.replaceChildren();
      ui.transcript.replaceChildren();
      ui.source.hidden = true;
      ui.source.removeAttribute("href");
      ui.paging.forEach((nav) => { nav.hidden = true; });
      ui.emptySearch.hidden = true;
      ui.title.textContent = "書き起こしを読み込めませんでした";
      ui.searchResult.textContent = "講座の読み込みに失敗しました。";
      ui.error.hidden = false;
    } finally {
      window.clearTimeout(timeout);
      ui.reading.setAttribute("aria-busy", "false");
      ui.retry.disabled = false;
      loading = false;
    }
  }

  function activeAudio() {
    const recording = audioParts[audioIndex]?.audio?.onyx;
    return recording && DukeAudioSource.isAllowedFile(recording.file) ? recording : null;
  }
  function audioPosition() {
    return audioPendingTime || (player.error || audioNeedsReload ? audioLastTime : Number.isFinite(player.currentTime) ? player.currentTime : 0);
  }
  function audioMessage(message) { byId("audio-status").textContent = message; }
  function renderAudioButton() {
    playButton.disabled = !activeAudio();
    reloadAudio.disabled = !activeAudio();
    playButton.textContent = player.error || audioNeedsReload ? "読み込み直して再生" : player.paused ? "▶ 再生する" : "Ⅱ 一時停止";
  }
  function audioFallback(show = false) {
    const file = activeAudio()?.file;
    openAudio.hidden = !show || !file;
    if (show && file) openAudio.href = file;
    else openAudio.removeAttribute("href");
  }
  function audioErrorMessage(error) {
    if (error?.name === "NotAllowedError") return "端末が再生を止めています。「再生する」を押して聴き始めてください。";
    if (player.error?.code === 2 || error?.name === "NetworkError") return "通信が途切れました。「読み込み直して再生」で続けられます。";
    if (player.error?.code === 3) return "音声を読み取れませんでした。読み込み直すか、別画面で開いてください。";
    if (player.error?.code === 4 || error?.name === "NotSupportedError") return "音声を読み込めませんでした。読み込み直すか、別画面で開いてください。";
    if (player.error?.code === 1) return "音声の読み込みが中断されました。「読み込み直して再生」で続けられます。";
    return "再生できませんでした。もう一度「再生する」を押すか、別画面で開いてください。";
  }
  function restoreAudioPosition() {
    if (!audioPendingTime || !Number.isFinite(player.duration)) return;
    const target = Math.min(audioPendingTime, Math.max(0, player.duration - .05));
    try { player.currentTime = target; audioPendingTime = 0; audioLastTime = target; }
    catch { /* Some mobile players cannot seek until canplay. Keep the requested position. */ }
  }
  function setAudioPart(index, autoplay = false, seconds = 0) {
    const recording = audioParts[index]?.audio?.onyx;
    if (!Number.isInteger(index) || !recording || !DukeAudioSource.isAllowedFile(recording.file)) return;
    audioSwitching = true; audioLoadId++; player.pause();
    audioIndex = index;
    audioPendingTime = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
    audioLastTime = audioPendingTime; audioNeedsReload = false;
    partSelect.value = String(index);
    player.src = recording.file; player.load();
    player.playbackRate = Number(speedSelect.value); player.preservesPitch = true;
    byId("audio-previous").disabled = index === 0;
    byId("audio-next").disabled = index === audioParts.length - 1;
    audioSwitching = false; renderAudioButton(); audioFallback();
    audioMessage("Onyx B（AI音声）・「再生する」で聴き始める");
    if (autoplay) void playAudio();
  }
  async function playAudio(retry = false) {
    if (!activeAudio()) return;
    // Keep reload and play in the same user gesture; do not await metadata first.
    if (retry === true && (player.error || audioNeedsReload)) setAudioPart(audioIndex, false, audioPosition());
    const expected = audioLoadId;
    try { await player.play(); }
    catch (error) {
      if (expected !== audioLoadId || error?.name === "AbortError") return;
      if (player.error || error?.name === "NotSupportedError" || error?.name === "NetworkError") audioNeedsReload = true;
      renderAudioButton(); audioFallback(true); audioMessage(audioErrorMessage(error));
    }
  }
  function renderAudio(lecture) {
    audioSwitching = true; audioLoadId++; player.pause();
    player.removeAttribute("src");
    player.load();
    audioIndex = 0; audioPendingTime = 0; audioLastTime = 0; audioNeedsReload = false;
    const chapter = library.chapters.find(c => c.source === lecture.source_url);
    audioParts = chapter?.parts?.filter(p => p.audio?.onyx?.file && DukeAudioSource.isAllowedFile(p.audio.onyx.file)) || [];
    const complete = audioParts.length > 0 && audioParts.length === chapter.parts.length;
    audioSwitching = false; renderAudioButton(); audioFallback();
    byId("narration-controls").hidden = !complete;
    byId("audio-status").textContent = complete ? "Onyx B · 深みのある穏やかさ。声はAIで生成しています。" : ["RSI", "0405", "20260406"].includes(lecture.code) ? "音声化は見送りました。文字版は読めます。" : "この講座の音声はありません。文字版は読めます。";
    partSelect.replaceChildren();
    if (!complete) return;
    audioParts.forEach((part, index) => {
      const option = element("option", "", `区切り ${index + 1} / ${audioParts.length}`);
      option.value = String(index); partSelect.append(option);
    });
    setAudioPart(0);
  }
  for (const mode of ["reading", "source"]) byId("edition-" + mode).addEventListener("click", () => {
    view = mode;
    selectFromHash();
  });
  partSelect.addEventListener("change", () => setAudioPart(Number(partSelect.value), !player.paused));
  playButton.addEventListener("click", () => {
    if (player.paused || player.error || audioNeedsReload) void playAudio(true);
    else player.pause();
  });
  reloadAudio.addEventListener("click", () => {
    if (!activeAudio()) return;
    setAudioPart(audioIndex, false, audioPosition());
    void playAudio();
  });
  speedSelect.addEventListener("change", () => { player.playbackRate = Number(speedSelect.value); });
  byId("audio-previous").addEventListener("click", () => { if (audioIndex > 0) setAudioPart(audioIndex - 1, !player.paused); });
  byId("audio-next").addEventListener("click", () => { if (audioIndex + 1 < audioParts.length) setAudioPart(audioIndex + 1, !player.paused); });
  player.addEventListener("ended", () => {
    if (audioIndex + 1 < audioParts.length) setAudioPart(audioIndex + 1, true);
    else { renderAudioButton(); audioMessage("この講座の音声を聴き終えました。"); }
  });
  player.addEventListener("loadedmetadata", () => { restoreAudioPosition(); player.playbackRate = Number(speedSelect.value); });
  player.addEventListener("canplay", restoreAudioPosition);
  player.addEventListener("timeupdate", () => { if (!player.error && !audioNeedsReload && !audioPendingTime && Number.isFinite(player.currentTime)) audioLastTime = player.currentTime; });
  player.addEventListener("play", () => { renderAudioButton(); audioMessage("音声を読み込んでいます…"); });
  player.addEventListener("playing", () => {
    if (!activeAudio() || player.paused || player.error) return;
    audioNeedsReload = false; restoreAudioPosition(); renderAudioButton(); audioFallback(); audioMessage("再生中 · Onyx B（AI音声）");
  });
  player.addEventListener("waiting", () => { if (activeAudio() && !player.paused && !player.error) audioMessage("音声の続きを読み込んでいます…"); });
  player.addEventListener("stalled", () => { if (activeAudio() && !player.paused && !player.error) audioMessage("音声の読み込みを待っています。通信状態を確認してください。"); });
  player.addEventListener("pause", () => { if (!audioSwitching && activeAudio()) { renderAudioButton(); if (!player.error && !audioNeedsReload && !player.ended) audioMessage("一時停止"); } });
  player.addEventListener("error", () => {
    if (audioSwitching || !activeAudio()) return;
    if (Number.isFinite(player.currentTime) && player.currentTime > 0) audioLastTime = player.currentTime;
    audioNeedsReload = true; renderAudioButton(); audioFallback(true); audioMessage(audioErrorMessage());
  });
  window.addEventListener("pagehide", () => player.pause());

  ui.skip.addEventListener("click", (event) => {
    event.preventDefault();
    focusReading();
  });
  ui.search.addEventListener("input", renderCatalog);
  ui.clearSearch.addEventListener("click", () => {
    ui.search.value = "";
    renderCatalog();
    ui.search.focus();
  });
  ui.retry.addEventListener("click", load);
  window.addEventListener("hashchange", () => selectFromHash(true));
  load();
})();
