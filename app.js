(function () {
  const site = window.PHOTO_SITE || { photos: [] };
  const SUBJECTS = {
    all: {
      label: "全部时光",
      title: "安与恩",
      kicker: "两个孩子 · 三本相册",
      intro: "把各自的成长与一起走过的日子，放在同一个家里。",
      short: "安恩",
      note: "家庭总览",
      accent: "#26332e",
      soft: "var(--surface-soft)"
    },
    "li-yu-an": {
      label: "李予安",
      title: "李予安",
      kicker: "大娃 · 独立成长相册",
      intro: "从初见世界到每一次新的尝试，按时间收藏予安自己的成长。",
      short: "予安",
      note: "大娃的照片",
      accent: "#20745f",
      soft: "var(--elder-soft)"
    },
    "li-yu-en": {
      label: "李予恩",
      title: "李予恩",
      kicker: "小娃 · 独立成长相册",
      intro: "给予恩留下一本自己的成长册，慢慢收进每一个新表情和新发现。",
      short: "予恩",
      note: "小娃的照片",
      accent: "#c95848",
      soft: "var(--younger-soft)"
    },
    together: {
      label: "两人一起",
      title: "予安与予恩",
      kicker: "两人一起 · 共同相册",
      intro: "同框的笑脸、一起的游戏，以及只属于两个人的共同成长。",
      short: "安恩",
      note: "两个人的合照",
      accent: "#35658d",
      soft: "var(--together-soft)"
    }
  };
  const SUBJECT_KEYS = new Set(["li-yu-an", "li-yu-en", "together"]);
  let photos = (Array.isArray(site.photos) ? site.photos : [])
    .map(normalizePhoto)
    .sort((a, b) => new Date(b.date) - new Date(a.date));

  const state = {
    view: viewFromUrl(),
    album: "全部",
    query: "",
    visiblePhotos: [],
    activePhotos: [],
    activeIndex: 0,
    featureIndex: 0,
    featureTimer: null,
    musicIndex: 0,
    musicPlaying: false,
    musicAutoplayBlocked: false,
    musicMessage: "",
    musicAudio: null,
    musicTimer: null,
    musicContext: null,
    musicGain: null,
    musicNodes: []
  };

  const fallbackMusicTracks = [
    {
      title: "原创儿歌风 01",
      tempo: 156,
      notes: ["C4", "E4", "G4", "C5", "G4", "E4", "A4", "G4", "E4", "G4", "C5", "D5", "C5", "G4", "E4", "C4"],
      bass: ["C3", "C3", "G2", "G2", "A2", "A2", "G2", "G2"],
      wave: "square"
    },
    {
      title: "原创儿歌风 02",
      tempo: 148,
      notes: ["G4", "B4", "D5", "E5", "D5", "B4", "G4", "A4", "B4", "D5", "G5", "E5", "D5", "B4", "A4", "G4"],
      bass: ["G3", "D3", "E3", "C3", "G3", "D3", "G2", "G2"],
      wave: "triangle"
    },
    {
      title: "原创儿歌风 03",
      tempo: 164,
      notes: ["F4", "A4", "C5", "F5", "E5", "C5", "A4", "C5", "D5", "F5", "A5", "G5", "F5", "D5", "C5", "A4"],
      bass: ["F3", "C3", "D3", "A2", "B2", "F3", "C3", "F2"],
      wave: "square"
    }
  ];

  const configuredMusic = window.LYA_MUSIC || {};
  const musicTracks = (Array.isArray(configuredMusic.tracks) ? configuredMusic.tracks : [])
    .filter((track) => track && track.title && track.src)
    .map((track) => ({ title: track.title, src: withAssetVersion(track.src), type: "audio" }));
  const activeMusicTracks = musicTracks.length ? musicTracks : fallbackMusicTracks;

  const els = {
    body: document.body,
    title: document.getElementById("pageTitle"),
    viewKicker: document.getElementById("viewKicker"),
    intro: document.getElementById("siteIntro"),
    albumKicker: document.getElementById("albumKicker"),
    albumTitle: document.getElementById("albumTitle"),
    peopleNav: document.getElementById("peopleNav"),
    heroPhotoCount: document.getElementById("heroPhotoCount"),
    heroVideoCount: document.getElementById("heroVideoCount"),
    heroYearRange: document.getElementById("heroYearRange"),
    feature: document.getElementById("featurePhoto"),
    filters: document.getElementById("albumFilters"),
    stats: document.getElementById("statsStrip"),
    gallery: document.getElementById("gallery"),
    empty: document.getElementById("emptyState"),
    emptyMonogram: document.getElementById("emptyMonogram"),
    emptyTitle: document.getElementById("emptyTitle"),
    emptyCopy: document.getElementById("emptyCopy"),
    search: document.getElementById("searchInput"),
    year: document.getElementById("year"),
    themeToggle: document.getElementById("themeToggle"),
    lightbox: document.getElementById("lightbox"),
    lightboxMedia: document.getElementById("lightboxMedia"),
    lightboxTitle: document.getElementById("lightboxTitle"),
    lightboxMeta: document.getElementById("lightboxMeta"),
    lightboxDesc: document.getElementById("lightboxDesc"),
    lightboxLink: document.getElementById("lightboxLink"),
    lightboxLinkText: document.getElementById("lightboxLinkText"),
    musicPlayer: document.querySelector(".music-player"),
    musicLabel: document.querySelector(".music-label"),
    musicTitle: document.getElementById("musicTitle"),
    musicToggle: document.getElementById("musicToggle"),
    musicPrev: document.getElementById("musicPrev"),
    musicNext: document.getElementById("musicNext")
  };

  function init() {
    els.year.textContent = new Date().getFullYear();
    restoreTheme();
    preloadCriticalPhotos();
    renderView();
    renderMusic();
    bindEvents();
    requestMusicAutoplay();
    loadFamilyPhotos();
  }

  async function loadFamilyPhotos() {
    try {
      const response = await window.fetch("/api/family/photos", {
        cache: "no-store",
        credentials: "same-origin"
      });
      if (!response.ok) return;
      const data = await response.json();
      const uploaded = Array.isArray(data.photos)
        ? data.photos.filter(validFamilyPhoto).map((photo) => normalizePhoto({ ...photo, dynamic: true }))
        : [];
      if (!uploaded.length) return;

      const known = new Set(photos.flatMap((photo) => [photo.id, photo.src]));
      const newPhotos = uploaded.filter((photo) => !known.has(photo.id) && !known.has(photo.src));
      if (!newPhotos.length) return;

      photos = [...photos, ...newPhotos].sort((a, b) => new Date(b.date) - new Date(a.date));
      state.album = "全部";
      state.featureIndex = 0;
      renderView();
    } catch (error) {
      // The static album remains available when family storage is offline.
    }
  }

  function renderView() {
    const config = SUBJECTS[state.view];
    els.body.dataset.view = state.view;
    els.title.textContent = config.title;
    els.viewKicker.textContent = config.kicker;
    els.intro.textContent = config.intro;
    els.albumKicker.textContent = state.view === "all" ? "Family timeline" : config.note;
    els.albumTitle.textContent = config.label;
    document.title = `${config.title}｜家庭相册`;
    renderPeopleNav();
    renderHeroSummary();
    renderFeature();
    applyFilters();
    restartFeatureCarousel();
    refreshIcons();
  }

  function renderPeopleNav() {
    els.peopleNav.innerHTML = Object.entries(SUBJECTS).map(([key, config]) => {
      const count = photosForView(key).length;
      const current = key === state.view ? ' aria-current="page"' : "";
      return `
        <button class="person-tab" type="button" data-view="${key}"${current}
          style="--tab-accent:${config.accent};--tab-soft:${config.soft}">
          <span class="person-monogram" aria-hidden="true">${config.short}</span>
          <span class="person-label">
            <strong>${config.label}</strong>
            <small>${config.note}</small>
          </span>
          <em class="person-count">${count} 件</em>
        </button>
      `;
    }).join("");
  }

  function renderFeature() {
    const items = photosForView(state.view);
    if (!items.length) {
      const config = SUBJECTS[state.view];
      els.feature.style.removeProperty("--feature-ratio");
      els.feature.innerHTML = `
        <div class="feature-empty">
          <strong>${config.short}</strong>
          <p>等待第一张属于${config.label}的照片</p>
        </div>
      `;
      return;
    }

    state.featureIndex = (state.featureIndex + items.length) % items.length;
    const photo = items[state.featureIndex];
    els.feature.style.setProperty("--feature-ratio", `${Number(photo.width) || 4} / ${Number(photo.height) || 3}`);
    const media = photo.type === "video"
      ? `<video src="${escapeAttr(versionedSrc(photo.src))}"${photo.thumb ? ` poster="${escapeAttr(versionedSrc(photo.thumb))}"` : ""} muted playsinline preload="metadata"></video>`
      : `<img src="${escapeAttr(versionedSrc(photo.src))}" alt="${escapeAttr(photo.title)}" loading="eager" fetchpriority="high" decoding="async">`;
    const typeLabel = photo.type === "video" ? "视频" : "照片";
    els.feature.innerHTML = `
      <span class="media-loading" aria-hidden="true"></span>
      ${media}
      <button class="feature-open" type="button" data-feature-open aria-label="查看 ${escapeAttr(photo.title)}"></button>
      <figcaption>
        <div>
          <p class="feature-title">${escapeHtml(photo.title)}</p>
          <p class="feature-meta">${escapeHtml(photoMeta(photo))}</p>
        </div>
        <div class="feature-actions">
          <button class="feature-nav" type="button" data-feature-dir="-1" aria-label="上一张轮播照片" title="上一张">
            <i data-lucide="chevron-left"></i>
          </button>
          <span class="feature-chip">${state.featureIndex + 1}/${items.length} · ${escapeHtml(subjectLabel(photo))} · ${typeLabel}</span>
          <button class="feature-nav" type="button" data-feature-dir="1" aria-label="下一张轮播照片" title="下一张">
            <i data-lucide="chevron-right"></i>
          </button>
        </div>
      </figcaption>
    `;
    const image = els.feature.querySelector("img");
    if (image) markLoaded(image);
    refreshIcons();
  }

  function renderHeroSummary() {
    const items = photosForView(state.view);
    const years = items
      .map((photo) => new Date(photo.date).getFullYear())
      .filter(Number.isFinite);
    const minYear = years.length ? Math.min(...years) : null;
    const maxYear = years.length ? Math.max(...years) : null;
    els.heroPhotoCount.textContent = items.filter((photo) => photo.type === "photo").length;
    els.heroVideoCount.textContent = items.filter((photo) => photo.type === "video").length;
    els.heroYearRange.textContent = minYear === null ? "--" : (minYear === maxYear ? String(maxYear) : `${minYear}-${maxYear}`);
  }

  function renderFilters() {
    const viewItems = photosForView(state.view);
    const albums = ["全部", ...new Set(viewItems.map((photo) => photo.album).filter(Boolean))];
    els.filters.innerHTML = albums.map((album) => {
      const pressed = album === state.album ? "true" : "false";
      return `<button class="filter-button" type="button" data-album="${escapeAttr(album)}" aria-pressed="${pressed}">${escapeHtml(album)}</button>`;
    }).join("");
  }

  function renderStats(items) {
    const years = new Set(items.map((photo) => new Date(photo.date).getFullYear()).filter(Number.isFinite));
    const subjects = new Set(items.map((photo) => photo.subject));
    els.stats.innerHTML = `
      <span class="stat"><strong>${items.length}</strong> 件</span>
      <span class="stat"><strong>${items.filter((photo) => photo.type === "video").length}</strong> 视频</span>
      <span class="stat"><strong>${subjects.size}</strong> 相册</span>
      <span class="stat"><strong>${years.size}</strong> 年</span>
    `;
  }

  function renderGallery(items) {
    els.gallery.innerHTML = items.map((photo, index) => {
      const type = photo.type || "photo";
      const media = type === "video"
        ? renderVideoPreview(photo)
        : `<img src="${escapeAttr(versionedSrc(photo.thumb || photo.src))}" alt="${escapeAttr(photo.title)}" loading="lazy" decoding="async">`;
      const typeIcon = type === "video" ? "play" : "image";
      const typeLabel = type === "video" ? "视频" : "照片";
      const orientation = Number(photo.height) > Number(photo.width) ? "portrait" : "landscape";
      const tags = [subjectLabel(photo), ...(photo.tags || []).filter((tag) => tag !== "孩子")]
        .slice(0, 3)
        .map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`)
        .join("");
      return `
        <article class="photo-card" tabindex="0" data-index="${index}" data-type="${type}" data-orientation="${orientation}">
          <span class="photo-media">
            <span class="media-loading" aria-hidden="true"></span>
            ${media}
            <span class="media-badge" aria-label="${typeLabel}"><i data-lucide="${typeIcon}"></i></span>
          </span>
          <div class="photo-info">
            <h2>${escapeHtml(photo.title)}</h2>
            <p>${escapeHtml(photoMeta(photo))} · ${typeLabel}</p>
            <div class="tags">${tags}</div>
          </div>
        </article>
      `;
    }).join("");
    observeImageLoading(els.gallery);
  }

  function applyFilters() {
    const query = normalize(state.query);
    const viewItems = photosForView(state.view);
    const availableAlbums = new Set(viewItems.map((photo) => photo.album));
    if (state.album !== "全部" && !availableAlbums.has(state.album)) state.album = "全部";

    state.visiblePhotos = viewItems.filter((photo) => {
      const albumMatch = state.album === "全部" || photo.album === state.album;
      const haystack = normalize([
        photo.title,
        photo.album,
        photo.location,
        photo.description,
        subjectLabel(photo),
        photo.type || "photo",
        ...(photo.tags || [])
      ].join(" "));
      return albumMatch && (!query || haystack.includes(query));
    });

    renderFilters();
    renderStats(state.visiblePhotos);
    renderGallery(state.visiblePhotos);
    renderEmptyState(viewItems.length);
    refreshIcons();
  }

  function renderEmptyState(viewCount) {
    const empty = state.visiblePhotos.length === 0;
    els.empty.hidden = !empty;
    if (!empty) return;
    const config = SUBJECTS[state.view];
    els.emptyMonogram.textContent = config.short;
    if (viewCount && (state.query || state.album !== "全部")) {
      els.emptyTitle.textContent = "没有找到符合条件的照片";
      els.emptyCopy.textContent = "换一个搜索词或筛选条件再看看。";
      return;
    }
    els.emptyTitle.textContent = `${config.label}还没有照片`;
    els.emptyCopy.textContent = "下一次上传时选择这个相册，照片发布后会自动出现在这里。";
  }

  function bindEvents() {
    els.peopleNav.addEventListener("click", (event) => {
      const button = event.target.closest("[data-view]");
      if (!button) return;
      setView(button.dataset.view);
    });

    els.filters.addEventListener("click", (event) => {
      const button = event.target.closest("[data-album]");
      if (!button) return;
      state.album = button.dataset.album;
      applyFilters();
    });

    els.search.addEventListener("input", (event) => {
      state.query = event.target.value;
      applyFilters();
    });

    els.gallery.addEventListener("click", (event) => {
      const card = event.target.closest(".photo-card");
      if (card) openLightbox(Number(card.dataset.index), state.visiblePhotos);
    });

    els.gallery.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      const card = event.target.closest(".photo-card");
      if (!card) return;
      event.preventDefault();
      openLightbox(Number(card.dataset.index), state.visiblePhotos);
    });

    els.feature.addEventListener("click", (event) => {
      const nav = event.target.closest("[data-feature-dir]");
      if (nav) {
        showFeature(Number(nav.dataset.featureDir));
        restartFeatureCarousel();
        return;
      }
      if (event.target.closest("[data-feature-open]")) {
        openLightbox(state.featureIndex, photosForView(state.view));
      }
    });

    els.lightbox.addEventListener("click", (event) => {
      if (event.target.closest("[data-close]") || event.target.closest(".lightbox-close")) closeLightbox();
      if (event.target.closest(".lightbox-prev")) showLightboxPhoto(state.activeIndex - 1);
      if (event.target.closest(".lightbox-next")) showLightboxPhoto(state.activeIndex + 1);
    });

    els.themeToggle.addEventListener("click", toggleTheme);
    els.musicToggle.addEventListener("click", toggleMusic);
    els.musicPrev.addEventListener("click", () => changeMusic(-1));
    els.musicNext.addEventListener("click", () => changeMusic(1));

    document.addEventListener("keydown", (event) => {
      if (!els.lightbox.classList.contains("is-open")) return;
      if (event.key === "Escape") closeLightbox();
      if (event.key === "ArrowLeft") showLightboxPhoto(state.activeIndex - 1);
      if (event.key === "ArrowRight") showLightboxPhoto(state.activeIndex + 1);
    });

    document.addEventListener("visibilitychange", () => {
      if (document.hidden) stopFeatureCarousel();
      else startFeatureCarousel();
    });
    window.addEventListener("popstate", () => setView(viewFromUrl(), false));
    window.addEventListener("pagehide", stopMusic);
  }

  function setView(view, updateUrl = true) {
    if (!SUBJECTS[view]) view = "all";
    state.view = view;
    state.album = "全部";
    state.featureIndex = 0;
    if (updateUrl) {
      const url = new URL(window.location.href);
      if (view === "all") url.searchParams.delete("person");
      else url.searchParams.set("person", view);
      history.pushState({ view }, "", `${url.pathname}${url.search}${url.hash}`);
    }
    renderView();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function openLightbox(index, items) {
    if (!items.length) return;
    state.activePhotos = items;
    showLightboxPhoto(index);
    els.lightbox.classList.add("is-open");
    els.lightbox.setAttribute("aria-hidden", "false");
    document.body.style.overflow = "hidden";
    els.lightbox.querySelector(".lightbox-close").focus();
  }

  function closeLightbox() {
    els.lightbox.classList.remove("is-open");
    els.lightbox.setAttribute("aria-hidden", "true");
    document.body.style.overflow = "";
    els.lightboxMedia.innerHTML = "";
  }

  function showLightboxPhoto(index) {
    const count = state.activePhotos.length;
    if (!count) return;
    state.activeIndex = (index + count) % count;
    const photo = state.activePhotos[state.activeIndex];
    const type = photo.type || "photo";
    const typeLabel = type === "video" ? "视频" : "照片";
    els.lightboxMedia.innerHTML = type === "video"
      ? `<video src="${escapeAttr(versionedSrc(photo.src))}"${photo.thumb ? ` poster="${escapeAttr(versionedSrc(photo.thumb))}"` : ""} controls playsinline preload="metadata"></video>`
      : `<img src="${escapeAttr(versionedSrc(photo.src))}" alt="${escapeAttr(photo.title)}">`;
    els.lightboxTitle.textContent = photo.title;
    els.lightboxMeta.textContent = `${subjectLabel(photo)} · ${photoMeta(photo)} · ${typeLabel}`;
    els.lightboxDesc.textContent = photo.description || "";
    els.lightboxLink.href = versionedSrc(photo.src);
    els.lightboxLinkText.textContent = type === "video" ? "查看视频" : "查看照片";
  }

  function showFeature(direction) {
    const items = photosForView(state.view);
    if (!items.length) return;
    state.featureIndex = (state.featureIndex + direction + items.length) % items.length;
    renderFeature();
  }

  function startFeatureCarousel() {
    const items = photosForView(state.view);
    if (state.featureTimer || items.length <= 1) return;
    state.featureTimer = window.setInterval(() => showFeature(1), 5000);
    els.feature.dataset.carousel = "running";
  }

  function stopFeatureCarousel() {
    if (!state.featureTimer) return;
    window.clearInterval(state.featureTimer);
    state.featureTimer = null;
    els.feature.dataset.carousel = "paused";
  }

  function restartFeatureCarousel() {
    stopFeatureCarousel();
    startFeatureCarousel();
  }

  async function toggleMusic() {
    if (state.musicPlaying) stopMusic();
    else await startMusic({ userInitiated: true });
  }

  async function startMusic(options = {}) {
    const track = activeMusicTracks[state.musicIndex];
    state.musicAutoplayBlocked = false;
    state.musicMessage = "";
    if (track.type === "audio") {
      try {
        await startAudioTrack(track);
      } catch (error) {
        state.musicPlaying = false;
        if (error.name === "NotAllowedError") {
          state.musicAutoplayBlocked = !options.userInitiated;
          state.musicMessage = options.userInitiated ? "浏览器暂时禁止播放" : "";
        } else if (error.message === "audio-missing") {
          state.musicMessage = "请添加儿歌音频";
        } else {
          state.musicMessage = "音频暂时无法播放";
        }
        renderMusic();
        return false;
      }
    } else {
      ensureMusicContext();
      if (state.musicContext.state === "suspended") {
        try {
          await state.musicContext.resume();
        } catch (error) {
          state.musicAutoplayBlocked = !options.userInitiated;
          renderMusic();
          return false;
        }
      }
      state.musicPlaying = true;
      playMusicLoop();
    }
    renderMusic();
    return true;
  }

  function stopMusic() {
    state.musicPlaying = false;
    stopAudioTrack();
    clearMusicLoop();
    stopMusicNodes();
    renderMusic();
  }

  async function changeMusic(direction) {
    state.musicIndex = (state.musicIndex + direction + activeMusicTracks.length) % activeMusicTracks.length;
    state.musicAutoplayBlocked = false;
    state.musicMessage = "";
    if (state.musicPlaying) {
      stopAudioTrack();
      clearMusicLoop();
      stopMusicNodes();
      await startMusic({ userInitiated: true });
    } else {
      renderMusic();
    }
  }

  function requestMusicAutoplay() {
    if (!configuredMusic.autoplay) return;
    window.setTimeout(() => startMusic({ userInitiated: false }), 250);
  }

  async function startAudioTrack(track) {
    stopAudioTrack();
    const exists = await audioFileExists(track.src);
    if (!exists) throw new Error("audio-missing");
    const audio = new Audio(track.src);
    state.musicAudio = audio;
    audio.preload = "auto";
    audio.volume = 0.72;
    audio.addEventListener("ended", () => changeMusic(1), { once: true });
    audio.addEventListener("error", () => {
      if (state.musicAudio !== audio) return;
      state.musicPlaying = false;
      renderMusic();
    }, { once: true });
    await audio.play();
    state.musicPlaying = true;
  }

  function stopAudioTrack() {
    if (!state.musicAudio) return;
    state.musicAudio.pause();
    state.musicAudio.removeAttribute("src");
    state.musicAudio.load();
    state.musicAudio = null;
  }

  function ensureMusicContext() {
    if (state.musicContext) return;
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    state.musicContext = new AudioContext();
    state.musicGain = state.musicContext.createGain();
    state.musicGain.gain.value = 0.08;
    state.musicGain.connect(state.musicContext.destination);
  }

  function playMusicLoop() {
    clearMusicLoop();
    scheduleTrack();
    state.musicTimer = window.setInterval(scheduleTrack, trackDurationMs(activeMusicTracks[state.musicIndex]));
  }

  function clearMusicLoop() {
    if (!state.musicTimer) return;
    window.clearInterval(state.musicTimer);
    state.musicTimer = null;
  }

  function scheduleTrack() {
    if (!state.musicPlaying || !state.musicContext) return;
    stopMusicNodes();
    const track = activeMusicTracks[state.musicIndex];
    const beat = 60 / track.tempo;
    const now = state.musicContext.currentTime + 0.04;
    track.notes.forEach((note, index) => {
      scheduleTone(note, now + index * beat * 0.5, beat * 0.42, index, track.wave || "square", 0.34);
    });
    (track.bass || []).forEach((note, index) => {
      scheduleTone(note, now + index * beat, beat * 0.72, index, "triangle", 0.18);
    });
  }

  function scheduleTone(note, start, duration, index, wave, peak) {
    const oscillator = state.musicContext.createOscillator();
    const gain = state.musicContext.createGain();
    oscillator.type = index % 4 === 0 ? "triangle" : wave;
    oscillator.frequency.setValueAtTime(noteFrequency(note), start);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(peak, start + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    oscillator.connect(gain);
    gain.connect(state.musicGain);
    oscillator.start(start);
    oscillator.stop(start + duration + 0.04);
    state.musicNodes.push(oscillator, gain);
  }

  function stopMusicNodes() {
    state.musicNodes.forEach((node) => {
      if (typeof node.stop === "function") {
        try { node.stop(); } catch (error) { /* already stopped */ }
      }
      if (typeof node.disconnect === "function") {
        try { node.disconnect(); } catch (error) { /* already disconnected */ }
      }
    });
    state.musicNodes = [];
  }

  function trackDurationMs(track) {
    const beat = 60 / track.tempo;
    const melodySeconds = track.notes.length * beat * 0.5 + beat * 0.45;
    const bassSeconds = (track.bass || []).length * beat + beat * 0.72;
    return Math.ceil((Math.max(melodySeconds, bassSeconds) + 0.12) * 1000);
  }

  function noteFrequency(note) {
    const match = note.match(/^([A-G])(#?)(\d)$/);
    if (!match) return 440;
    const [, letter, sharp, octaveValue] = match;
    const semitones = { C: -9, D: -7, E: -5, F: -4, G: -2, A: 0, B: 2 };
    const distance = semitones[letter] + (sharp ? 1 : 0) + (Number(octaveValue) - 4) * 12;
    return 440 * Math.pow(2, distance / 12);
  }

  function renderMusic() {
    const track = activeMusicTracks[state.musicIndex];
    const label = configuredMusic.intro || (musicTracks.length ? "儿歌播放" : "原创儿歌风");
    els.musicLabel.textContent = label;
    els.musicTitle.textContent = state.musicMessage || (state.musicAutoplayBlocked ? "点一下播放儿歌" : track.title);
    els.musicPlayer.classList.toggle("is-playing", state.musicPlaying);
    els.musicPlayer.classList.toggle("is-blocked", state.musicAutoplayBlocked);
    els.musicPlayer.classList.toggle("is-error", Boolean(state.musicMessage));
    els.musicToggle.setAttribute("aria-label", state.musicPlaying ? "暂停音乐" : "播放音乐");
    els.musicToggle.title = state.musicPlaying ? "暂停" : "播放";
    els.musicToggle.innerHTML = `<i data-lucide="${state.musicPlaying ? "pause" : "play"}"></i>`;
    refreshIcons();
  }

  function toggleTheme() {
    setTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark");
  }

  function restoreTheme() {
    const stored = localStorage.getItem("lya-photo-theme");
    const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    setTheme(stored || (prefersDark ? "dark" : "light"));
  }

  function setTheme(theme) {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("lya-photo-theme", theme);
    els.themeToggle.innerHTML = `<i data-lucide="${theme === "dark" ? "sun" : "moon"}"></i>`;
    refreshIcons();
  }

  function normalizePhoto(photo) {
    return {
      ...photo,
      type: photo.type === "video" ? "video" : "photo",
      subject: SUBJECT_KEYS.has(photo.subject) ? photo.subject : "li-yu-an",
      tags: Array.isArray(photo.tags) ? photo.tags : []
    };
  }

  function photosForView(view) {
    return view === "all" ? photos : photos.filter((photo) => photo.subject === view);
  }

  function subjectLabel(photo) {
    return SUBJECTS[photo.subject]?.label || SUBJECTS["li-yu-an"].label;
  }

  function viewFromUrl() {
    const view = new URLSearchParams(window.location.search).get("person");
    return SUBJECTS[view] ? view : "all";
  }

  function formatDate(value) {
    return new Intl.DateTimeFormat("zh-CN", {
      year: "numeric",
      month: "short",
      day: "numeric"
    }).format(new Date(value));
  }

  function normalize(value) {
    return String(value || "").toLowerCase().trim();
  }

  function photoMeta(photo) {
    const dateText = formatDate(photo.date);
    return !photo.location || photo.location === "地点未提供" ? dateText : `${photo.location} · ${dateText}`;
  }

  function renderVideoPreview(photo) {
    if (photo.thumb) {
      return `<img src="${escapeAttr(versionedSrc(photo.thumb))}" alt="${escapeAttr(photo.title)} 视频封面" loading="lazy" decoding="async">`;
    }
    return `<video src="${escapeAttr(versionedSrc(photo.src))}" muted playsinline preload="metadata" aria-label="${escapeAttr(photo.title)} 视频预览"></video>`;
  }

  function refreshIcons() {
    if (window.lucide) window.lucide.createIcons();
  }

  function withAssetVersion(src) {
    if (!src || /^(https?:)?\/\//.test(src) || src.startsWith("data:") || src.startsWith("/api/") || src.includes("?")) return src;
    return `${src}?v=${encodeURIComponent(site.version || "20260812")}`;
  }

  function versionedSrc(src) {
    return withAssetVersion(src);
  }

  function validFamilyPhoto(photo) {
    return Boolean(
      photo &&
      /^[a-z0-9-]{12,64}$/.test(String(photo.id || "")) &&
      photo.type === "photo" &&
      SUBJECT_KEYS.has(photo.subject) &&
      typeof photo.title === "string" &&
      photo.src === `/api/family/media/${photo.id}` &&
      Number.isFinite(Number(photo.width)) &&
      Number.isFinite(Number(photo.height)) &&
      Array.isArray(photo.tags)
    );
  }

  function preloadCriticalPhotos() {
    photos.slice(0, 4).forEach((photo, index) => {
      const href = versionedSrc(photo.thumb || photo.src);
      if (!href) return;
      const link = document.createElement("link");
      link.rel = "preload";
      link.as = "image";
      link.href = href;
      if (index === 0) link.fetchPriority = "high";
      document.head.appendChild(link);
    });
  }

  function observeImageLoading(root) {
    root.querySelectorAll("img").forEach(markLoaded);
  }

  function markLoaded(image) {
    if (image.complete && image.naturalWidth > 0) {
      image.classList.add("is-loaded");
      markImageParentLoaded(image);
      return;
    }
    image.addEventListener("load", () => {
      image.classList.add("is-loaded");
      markImageParentLoaded(image);
    }, { once: true });
    image.addEventListener("error", () => {
      image.classList.add("is-loaded");
      markImageParentLoaded(image);
    }, { once: true });
  }

  function markImageParentLoaded(image) {
    const parent = image.closest(".feature-photo, .photo-media");
    if (parent) parent.classList.add("is-loaded");
  }

  async function audioFileExists(src) {
    try {
      const url = new URL(src, window.location.href);
      if (url.origin !== window.location.origin) return true;
      const response = await window.fetch(url.href, { method: "HEAD", cache: "no-store" });
      return response.ok;
    } catch (error) {
      return true;
    }
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function escapeAttr(value) {
    return escapeHtml(value);
  }

  init();
})();
