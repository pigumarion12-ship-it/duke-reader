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
      : `${lectures.length}講座から選べます。準備中の講座も表示しています。`;
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
    if (lecture.status === "pending") {
      ui.transcript.replaceChildren(element("p", "message", "この講座の書き起こしは準備中です"));
      return;
    }
    const list = element("ol", "cue-list");
    list.setAttribute("aria-label", "時刻付きの書き起こし");
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
      : lecture.status === "available" ? "時刻は元動画の位置です。" : "";
    document.title = `${lecture.title} | DUKE 講座の書き起こし`;
    renderCatalog();
    renderPaging(index);
    renderTranscript(lecture);
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
