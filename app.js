(function () {
  const site = window.PHOTO_SITE;
  const photos = [...site.photos].sort((a, b) => new Date(b.date) - new Date(a.date));
  const state = {
    album: "全部",
    query: "",
    visiblePhotos: photos,
    activeIndex: 0,
    featureIndex: Math.max(photos.findIndex((item) => item.featured), 0),
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
    },
    {
      title: "原创儿歌风 04",
      tempo: 172,
      notes: ["D4", "F4", "A4", "D5", "F5", "D5", "A4", "F4", "E4", "G4", "B4", "E5", "G5", "E5", "B4", "G4"],
      bass: ["D3", "A2", "D3", "A2", "E3", "B2", "E3", "B2"],
      wave: "sawtooth"
    }
  ];

  const configuredMusic = window.LYA_MUSIC || {};
  const musicTracks = (Array.isArray(configuredMusic.tracks) ? configuredMusic.tracks : [])
    .filter((track) => track && track.title && track.src)
    .map((track) => ({
      title: track.title,
      src: withAssetVersion(track.src),
      type: "audio"
    }));
  const activeMusicTracks = musicTracks.length ? musicTracks : fallbackMusicTracks;

  const els = {
    intro: document.getElementById("siteIntro"),
    heroPhotoCount: document.getElementById("heroPhotoCount"),
    heroVideoCount: document.getElementById("heroVideoCount"),
    heroYearRange: document.getElementById("heroYearRange"),
    heroMiniGrid: document.getElementById("heroMiniGrid"),
    feature: document.getElementById("featurePhoto"),
    filters: document.getElementById("albumFilters"),
    stats: document.getElementById("statsStrip"),
    gallery: document.getElementById("gallery"),
    empty: document.getElementById("emptyState"),
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
    els.intro.textContent = site.intro;
    els.year.textContent = new Date().getFullYear();
    restoreTheme();
    preloadCriticalPhotos();
    renderFeature();
    renderHeroSummary();
    renderHeroMiniGrid();
    observeImageLoading(els.heroMiniGrid);
    renderMusic();
    startFeatureCarousel();
    renderFilters();
    applyFilters();
    bindEvents();
    requestMusicAutoplay();
    refreshIcons();
  }

  function renderFeature() {
    const photo = photos[state.featureIndex] || photos[0];
    if (!photo) {
      els.feature.innerHTML = "";
      return;
    }
    els.feature.style.setProperty("--feature-bg", `url("${versionedSrc(photo.thumb || photo.src)}")`);
    const media = photo.type === "video"
      ? `<video src="${versionedSrc(photo.src)}"${photo.thumb ? ` poster="${versionedSrc(photo.thumb)}"` : ""} muted playsinline preload="metadata"></video>`
      : `<img src="${versionedSrc(photo.src)}" alt="${photo.title}" loading="eager" fetchpriority="high" decoding="async">`;
    const typeLabel = photo.type === "video" ? "视频" : "照片";
    els.feature.innerHTML = `
      <span class="media-loading" aria-hidden="true"></span>
      ${media}
      <figcaption>
        <div>
          <p class="feature-title">${photo.title}</p>
          <p class="feature-meta">${photoMeta(photo)}</p>
        </div>
        <div class="feature-actions">
          <button class="feature-nav" type="button" data-feature-dir="-1" aria-label="上一张轮播照片" title="上一张">
            <i data-lucide="chevron-left"></i>
          </button>
          <span class="feature-chip">${state.featureIndex + 1}/${photos.length} · ${photo.album} · ${typeLabel}</span>
          <button class="feature-nav" type="button" data-feature-dir="1" aria-label="下一张轮播照片" title="下一张">
            <i data-lucide="chevron-right"></i>
          </button>
        </div>
      </figcaption>
    `;
    const featureImage = els.feature.querySelector("img");
    if (featureImage) {
      markLoaded(featureImage);
    }
    refreshIcons();
  }

  function renderHeroSummary() {
    const years = photos
      .map((photo) => new Date(photo.date).getFullYear())
      .filter((year) => Number.isFinite(year));
    const minYear = Math.min(...years);
    const maxYear = Math.max(...years);
    els.heroPhotoCount.textContent = photos.filter((photo) => (photo.type || "photo") === "photo").length;
    els.heroVideoCount.textContent = photos.filter((photo) => photo.type === "video").length;
    els.heroYearRange.textContent = minYear === maxYear ? String(maxYear) : `${minYear}-${maxYear}`;
  }

  function renderHeroMiniGrid() {
    const previewItems = photos.slice(0, 4);
    els.heroMiniGrid.innerHTML = previewItems
      .map((photo, index) => {
        const media = (photo.type || "photo") === "video"
          ? renderVideoPreview(photo)
          : `<img src="${versionedSrc(photo.thumb)}" alt="${photo.title}" loading="${index === 0 ? "eager" : "lazy"}" decoding="async">`;
        return `
          <button class="hero-mini-card" type="button" data-hero-index="${index}" aria-label="查看 ${photo.title}">
            <span class="media-loading" aria-hidden="true"></span>
            ${media}
            <span>${photo.title}</span>
          </button>
        `;
      })
      .join("");
  }

  function renderFilters() {
    const albums = ["全部", ...new Set(photos.map((photo) => photo.album))];
    els.filters.innerHTML = albums
      .map((album) => {
        const pressed = album === state.album ? "true" : "false";
        return `<button class="filter-button" type="button" data-album="${album}" aria-pressed="${pressed}">${album}</button>`;
      })
      .join("");
  }

  function renderStats(items) {
    const years = new Set(items.map((photo) => new Date(photo.date).getFullYear()));
    const albums = new Set(items.map((photo) => photo.album));
    els.stats.innerHTML = `
      <span class="stat"><strong>${items.length}</strong> 件</span>
      <span class="stat"><strong>${items.filter((photo) => photo.type === "video").length}</strong> 视频</span>
      <span class="stat"><strong>${albums.size}</strong> 组</span>
      <span class="stat"><strong>${years.size}</strong> 年</span>
    `;
  }

  function renderGallery(items) {
    els.empty.hidden = items.length > 0;
    els.gallery.innerHTML = items
      .map((photo, index) => {
        const ratio = `${photo.width} / ${photo.height}`;
        const tags = photo.tags.map((tag) => `<span class="tag">${tag}</span>`).join("");
        const type = photo.type || "photo";
        const media = type === "video"
          ? renderVideoPreview(photo)
          : `<img src="${versionedSrc(photo.thumb)}" alt="${photo.title}" loading="lazy" decoding="async">`;
        const typeIcon = type === "video" ? "play" : "image";
        const typeLabel = type === "video" ? "视频" : "照片";
        return `
          <article class="photo-card" tabindex="0" data-index="${index}" data-type="${type}">
            <span class="photo-media" style="--ratio: ${ratio}">
              <span class="media-loading" aria-hidden="true"></span>
              ${media}
              <span class="media-badge" aria-label="${typeLabel}">
                <i data-lucide="${typeIcon}"></i>
              </span>
            </span>
            <div class="photo-info">
              <h2>${photo.title}</h2>
              <p>${photoMeta(photo)} · ${typeLabel}</p>
              <div class="tags">${tags}</div>
            </div>
          </article>
        `;
      })
      .join("");
  }

  function applyFilters() {
    const query = normalize(state.query);
    state.visiblePhotos = photos.filter((photo) => {
      const albumMatch = state.album === "全部" || photo.album === state.album;
      const haystack = normalize([
        photo.title,
        photo.album,
        photo.location,
        photo.description,
        photo.type || "photo",
        ...photo.tags
      ].join(" "));
      return albumMatch && (!query || haystack.includes(query));
    });

    renderFilters();
    renderStats(state.visiblePhotos);
    renderGallery(state.visiblePhotos);
    observeImageLoading(els.gallery);
    refreshIcons();
  }

  function bindEvents() {
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
      if (!card) return;
      openLightbox(Number(card.dataset.index));
    });

    els.gallery.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      const card = event.target.closest(".photo-card");
      if (!card) return;
      event.preventDefault();
      openLightbox(Number(card.dataset.index));
    });

    els.feature.addEventListener("click", (event) => {
      const button = event.target.closest("[data-feature-dir]");
      if (!button) return;
      event.preventDefault();
      showFeature(Number(button.dataset.featureDir));
      restartFeatureCarousel();
    });

    els.heroMiniGrid.addEventListener("click", (event) => {
      const button = event.target.closest("[data-hero-index]");
      if (!button) return;
      state.featureIndex = Number(button.dataset.heroIndex);
      renderFeature();
      restartFeatureCarousel();
    });

    els.lightbox.addEventListener("click", (event) => {
      if (event.target.closest("[data-close]") || event.target.closest(".lightbox-close")) {
        closeLightbox();
      }
      if (event.target.closest(".lightbox-prev")) {
        showLightboxPhoto(state.activeIndex - 1);
      }
      if (event.target.closest(".lightbox-next")) {
        showLightboxPhoto(state.activeIndex + 1);
      }
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
      if (document.hidden) {
        stopFeatureCarousel();
      } else {
        startFeatureCarousel();
      }
    });

    window.addEventListener("pagehide", stopMusic);
  }

  function openLightbox(index) {
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
    const count = state.visiblePhotos.length;
    if (!count) return;
    state.activeIndex = (index + count) % count;
    const photo = state.visiblePhotos[state.activeIndex];
    const type = photo.type || "photo";
    const typeLabel = type === "video" ? "视频" : "照片";
    els.lightboxMedia.innerHTML = type === "video"
      ? `<video src="${versionedSrc(photo.src)}"${photo.thumb ? ` poster="${versionedSrc(photo.thumb)}"` : ""} controls playsinline preload="metadata"></video>`
      : `<img src="${versionedSrc(photo.src)}" alt="${photo.title}">`;
    els.lightboxTitle.textContent = photo.title;
    els.lightboxMeta.textContent = `${photo.album} · ${photoMeta(photo)} · ${typeLabel}`;
    els.lightboxDesc.textContent = photo.description;
    els.lightboxLink.href = versionedSrc(photo.src);
    els.lightboxLinkText.textContent = type === "video" ? "查看视频" : "查看照片";
  }

  function showFeature(direction) {
    if (!photos.length) return;
    state.featureIndex = (state.featureIndex + direction + photos.length) % photos.length;
    renderFeature();
  }

  function startFeatureCarousel() {
    if (state.featureTimer || photos.length <= 1) return;
    state.featureTimer = window.setInterval(() => {
      showFeature(1);
    }, 5000);
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
    if (state.musicPlaying) {
      stopMusic();
      return;
    }
    await startMusic({ userInitiated: true });
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
          state.musicMessage = "请添加贝乐虎 MP3";
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
    window.setTimeout(() => {
      startMusic({ userInitiated: false });
    }, 250);
  }

  async function startAudioTrack(track) {
    stopAudioTrack();
    const exists = await audioFileExists(track.src);
    if (!exists) {
      throw new Error("audio-missing");
    }
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
    const frequency = noteFrequency(note);
    const oscillator = state.musicContext.createOscillator();
    const gain = state.musicContext.createGain();
    oscillator.type = index % 4 === 0 ? "triangle" : wave;
    oscillator.frequency.setValueAtTime(frequency, start);
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
        try {
          node.stop();
        } catch (error) {
          // Already stopped by the Web Audio scheduler.
        }
      }
      if (typeof node.disconnect === "function") {
        try {
          node.disconnect();
        } catch (error) {
          // Already disconnected.
        }
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
    const octave = Number(octaveValue);
    const distance = semitones[letter] + (sharp ? 1 : 0) + (octave - 4) * 12;
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
    const nextTheme = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    setTheme(nextTheme);
  }

  function restoreTheme() {
    const stored = localStorage.getItem("lya-photo-theme");
    const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    setTheme(stored || (prefersDark ? "dark" : "light"));
  }

  function setTheme(theme) {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("lya-photo-theme", theme);
    const icon = theme === "dark" ? "sun" : "moon";
    els.themeToggle.innerHTML = `<i data-lucide="${icon}"></i>`;
    refreshIcons();
  }

  function formatDate(value) {
    return new Intl.DateTimeFormat("zh-CN", {
      year: "numeric",
      month: "short",
      day: "numeric"
    }).format(new Date(value));
  }

  function normalize(value) {
    return value.toLowerCase().trim();
  }

  function photoMeta(photo) {
    const dateText = formatDate(photo.date);
    if (!photo.location || photo.location === "地点未提供") {
      return dateText;
    }
    return `${photo.location} · ${dateText}`;
  }

  function renderVideoPreview(photo) {
    if (photo.thumb) {
      return `<img src="${versionedSrc(photo.thumb)}" alt="${photo.title} 视频封面" loading="lazy" decoding="async">`;
    }
    return `<video src="${versionedSrc(photo.src)}" muted playsinline preload="metadata" aria-label="${photo.title} 视频预览"></video>`;
  }

  function refreshIcons() {
    if (window.lucide) {
      window.lucide.createIcons();
    }
  }

  function withAssetVersion(src) {
    if (!src || /^(https?:)?\/\//.test(src) || src.startsWith("data:") || src.includes("?")) {
      return src;
    }
    const version = site.version || "20260619";
    return `${src}?v=${encodeURIComponent(version)}`;
  }

  function versionedSrc(src) {
    return withAssetVersion(src);
  }

  function preloadCriticalPhotos() {
    photos.slice(0, 6).forEach((photo, index) => {
      const href = versionedSrc(photo.thumb || photo.src);
      if (!href) return;
      const link = document.createElement("link");
      link.rel = "preload";
      link.as = "image";
      link.href = href;
      if (index === 0) {
        link.fetchPriority = "high";
      }
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
    const parent = image.closest(".feature-photo, .hero-mini-card, .photo-media");
    if (parent) {
      parent.classList.add("is-loaded");
    }
  }

  async function audioFileExists(src) {
    try {
      const url = new URL(src, window.location.href);
      if (url.origin !== window.location.origin) return true;
      const response = await window.fetch(url.href, {
        method: "HEAD",
        cache: "no-store"
      });
      return response.ok;
    } catch (error) {
      return true;
    }
  }

  init();
})();
