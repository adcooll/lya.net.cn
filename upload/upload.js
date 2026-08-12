(function () {
  const MAX_SOURCE_BYTES = 25 * 1024 * 1024;
  const MAX_OUTPUT_BYTES = 4 * 1024 * 1024;
  const MAX_EDGE = 1600;
  const MAX_BATCH = 20;
  const API_ROOT = "/api/family";

  const state = {
    authenticated: false,
    uploading: false,
    items: []
  };

  const els = {
    loginPanel: document.getElementById("loginPanel"),
    loginForm: document.getElementById("loginForm"),
    password: document.getElementById("familyPassword"),
    loginStatus: document.getElementById("loginStatus"),
    workspace: document.getElementById("uploadWorkspace"),
    logout: document.getElementById("logoutButton"),
    input: document.getElementById("photoInput"),
    subjects: [...document.querySelectorAll('input[name="photoSubject"]')],
    title: document.getElementById("photoTitle"),
    location: document.getElementById("photoLocation"),
    queue: document.getElementById("uploadQueue"),
    queueEmpty: document.getElementById("queueEmpty"),
    queueCount: document.getElementById("queueCount"),
    publish: document.getElementById("publishButton"),
    uploadStatus: document.getElementById("uploadStatus")
  };

  init();

  async function init() {
    bindEvents();
    refreshIcons();
    try {
      const response = await fetch(`${API_ROOT}/session`, {
        credentials: "same-origin",
        cache: "no-store"
      });
      const data = response.ok ? await response.json() : {};
      setAuthenticated(Boolean(data.authenticated));
    } catch {
      setAuthenticated(false);
    }
  }

  function bindEvents() {
    els.loginForm.addEventListener("submit", handleLogin);
    els.logout.addEventListener("click", handleLogout);
    els.input.addEventListener("change", () => addFiles([...els.input.files]));
    els.subjects.forEach((input) => input.addEventListener("change", renderQueue));
    els.publish.addEventListener("click", publishAll);

    els.queue.addEventListener("click", (event) => {
      const button = event.target.closest("[data-remove]");
      if (!button || state.uploading) return;
      removeItem(button.dataset.remove);
    });

    els.queue.addEventListener("change", (event) => {
      const input = event.target.closest("[data-date]");
      if (!input || state.uploading) return;
      const item = state.items.find((candidate) => candidate.key === input.dataset.date);
      if (item && validDate(input.value)) item.date = input.value;
    });

    window.addEventListener("pagehide", () => {
      state.items.forEach((item) => URL.revokeObjectURL(item.preview));
    });
  }

  async function handleLogin(event) {
    event.preventDefault();
    const password = els.password.value;
    if (!password) return;
    setStatus(els.loginStatus, "正在验证…");

    try {
      const response = await apiFetch("/login", {
        method: "POST",
        body: { password }
      });
      if (!response.ok) throw new Error(response.data.error || "验证失败");
      els.password.value = "";
      setStatus(els.loginStatus, "");
      setAuthenticated(true);
    } catch (error) {
      setStatus(els.loginStatus, error.message);
    }
  }

  async function handleLogout() {
    try {
      await apiFetch("/logout", { method: "POST", body: {} });
    } finally {
      setAuthenticated(false);
    }
  }

  function setAuthenticated(authenticated) {
    state.authenticated = authenticated;
    els.loginPanel.hidden = authenticated;
    els.workspace.hidden = !authenticated;
    if (!authenticated) {
      window.setTimeout(() => els.password.focus(), 0);
    }
    refreshIcons();
  }

  function addFiles(files) {
    let rejected = 0;
    for (const file of files) {
      if (state.items.length >= MAX_BATCH) {
        rejected += 1;
        continue;
      }
      if (!isImageFile(file) || file.size > MAX_SOURCE_BYTES) {
        rejected += 1;
        continue;
      }
      const key = `${file.name}-${file.size}-${file.lastModified}`;
      if (state.items.some((item) => item.key === key)) continue;
      state.items.push({
        key,
        file,
        preview: URL.createObjectURL(file),
        date: localDate(file.lastModified ? new Date(file.lastModified) : new Date()),
        status: "ready",
        message: formatBytes(file.size)
      });
    }
    els.input.value = "";
    renderQueue();
    setStatus(
      els.uploadStatus,
      rejected ? `有 ${rejected} 个文件不是支持的照片、超过 25MB，或超出每批 20 张限制。` : ""
    );
  }

  function removeItem(key) {
    const index = state.items.findIndex((item) => item.key === key);
    if (index < 0) return;
    URL.revokeObjectURL(state.items[index].preview);
    state.items.splice(index, 1);
    renderQueue();
  }

  function renderQueue() {
    els.queueCount.textContent = String(state.items.length);
    els.queueEmpty.hidden = state.items.length > 0;
    els.publish.disabled = state.uploading || !selectedSubject() || !state.items.some((item) => item.status === "ready" || item.status === "error");
    els.queue.innerHTML = state.items.map((item) => `
      <article class="queue-item" data-status="${item.status}">
        <div class="queue-preview">
          <img src="${item.preview}" alt="${escapeHtml(item.file.name)}">
        </div>
        <div class="queue-copy">
          <strong title="${escapeHtml(item.file.name)}">${escapeHtml(item.file.name)}</strong>
          <label class="queue-date">
            <span>拍摄日期</span>
            <input type="date" value="${item.date}" data-date="${escapeHtml(item.key)}" ${state.uploading ? "disabled" : ""}>
          </label>
          <p class="item-status">${escapeHtml(item.message)}</p>
        </div>
        <button class="remove-button" type="button" data-remove="${escapeHtml(item.key)}" aria-label="移除 ${escapeHtml(item.file.name)}" title="移除" ${state.uploading ? "disabled" : ""}>
          <i data-lucide="x"></i>
        </button>
      </article>
    `).join("");
    refreshIcons();
  }

  async function publishAll() {
    const pending = state.items.filter((item) => item.status === "ready" || item.status === "error");
    if (!pending.length || state.uploading) return;
    const subject = selectedSubject();
    if (!subject) {
      setStatus(els.uploadStatus, "请先选择照片属于哪个相册");
      return;
    }

    state.uploading = true;
    setStatus(els.uploadStatus, `准备发布 ${pending.length} 张照片…`);
    renderQueue();
    let published = 0;
    let duplicates = 0;
    let failed = 0;

    for (const item of pending) {
      try {
        item.status = "working";
        item.message = "正在压缩并移除定位信息…";
        renderQueue();
        const optimized = await optimizeImage(item.file);
        const sha256 = await digestHex(optimized.blob);

        item.message = `正在上传 ${formatBytes(optimized.blob.size)}…`;
        renderQueue();
        const ticket = await apiFetch("/upload-url", {
          method: "POST",
          body: {
            size: optimized.blob.size,
            width: optimized.width,
            height: optimized.height,
            date: item.date,
            sha256,
            subject
          }
        });

        if (ticket.response.status === 409) {
          item.status = "duplicate";
          item.message = "已发布过，未重复上传";
          duplicates += 1;
          continue;
        }
        if (!ticket.response.ok) {
          throw new Error(ticket.data.error || "无法创建上传任务");
        }

        const uploadResponse = await fetch(ticket.data.uploadUrl, {
          method: "PUT",
          headers: { "Content-Type": ticket.data.contentType },
          body: optimized.blob
        });
        if (!uploadResponse.ok) throw new Error("照片上传失败，请重试");

        item.message = "正在发布到相册…";
        renderQueue();
        const result = await apiFetch("/publish", {
          method: "POST",
          body: {
            id: ticket.data.id,
            title: els.title.value,
            location: els.location.value
          }
        });
        if (result.response.status === 409) {
          item.status = "duplicate";
          item.message = "已发布过，未重复上传";
          duplicates += 1;
          continue;
        }
        if (!result.response.ok) throw new Error(result.data.error || "发布失败");

        item.status = "published";
        item.message = "已发布到相册";
        published += 1;
      } catch (error) {
        item.status = "error";
        item.message = error.message || "发布失败，请重试";
        failed += 1;
      }
      renderQueue();
    }

    state.uploading = false;
    renderQueue();
    const parts = [];
    if (published) parts.push(`已发布 ${published} 张`);
    if (duplicates) parts.push(`${duplicates} 张已存在`);
    if (failed) parts.push(`${failed} 张失败`);
    setStatus(els.uploadStatus, parts.join("，") || "没有需要发布的照片", published > 0 && failed === 0);
  }

  async function optimizeImage(file) {
    const image = await decodeImage(file);
    const sourceWidth = image.width || image.naturalWidth;
    const sourceHeight = image.height || image.naturalHeight;
    if (!sourceWidth || !sourceHeight) throw new Error("无法读取这张照片");

    const scale = Math.min(1, MAX_EDGE / Math.max(sourceWidth, sourceHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(sourceWidth * scale));
    canvas.height = Math.max(1, Math.round(sourceHeight * scale));
    const context = canvas.getContext("2d", { alpha: false });
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    if (typeof image.close === "function") image.close();

    let quality = 0.84;
    let blob = await canvasToBlob(canvas, quality);
    while (blob.size > MAX_OUTPUT_BYTES && quality > 0.56) {
      quality -= 0.08;
      blob = await canvasToBlob(canvas, quality);
    }
    if (blob.size > MAX_OUTPUT_BYTES) throw new Error("照片压缩后仍超过 4MB");
    return { blob, width: canvas.width, height: canvas.height };
  }

  async function decodeImage(file) {
    if ("createImageBitmap" in window) {
      try {
        return await createImageBitmap(file, { imageOrientation: "from-image" });
      } catch {
        // Safari can decode some Photos formats through an image element instead.
      }
    }

    return new Promise((resolve, reject) => {
      const image = new Image();
      const url = URL.createObjectURL(file);
      image.onload = () => {
        URL.revokeObjectURL(url);
        resolve(image);
      };
      image.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error("浏览器无法读取该照片格式，请先转换为 JPEG"));
      };
      image.src = url;
    });
  }

  function canvasToBlob(canvas, quality) {
    return new Promise((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (blob) resolve(blob);
        else reject(new Error("照片压缩失败"));
      }, "image/jpeg", quality);
    });
  }

  async function digestHex(blob) {
    const digest = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
    return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  }

  async function apiFetch(path, options = {}) {
    const response = await fetch(`${API_ROOT}${path}`, {
      method: options.method || "GET",
      credentials: "same-origin",
      cache: "no-store",
      headers: options.body ? { "Content-Type": "application/json" } : undefined,
      body: options.body ? JSON.stringify(options.body) : undefined
    });
    let data = {};
    try {
      data = await response.json();
    } catch {
      data = { error: "服务返回了无法识别的内容" };
    }
    if (response.status === 401 && path !== "/login") setAuthenticated(false);
    return { response, data, ok: response.ok };
  }

  function setStatus(element, message, success = false) {
    element.textContent = message;
    element.classList.toggle("is-success", success);
  }

  function localDate(date) {
    const offset = date.getTimezoneOffset() * 60 * 1000;
    return new Date(date.getTime() - offset).toISOString().slice(0, 10);
  }

  function validDate(value) {
    return /^\d{4}-\d{2}-\d{2}$/.test(value);
  }

  function selectedSubject() {
    return els.subjects.find((input) => input.checked)?.value || "";
  }

  function isImageFile(file) {
    return file.type.startsWith("image/") || /\.(jpe?g|png|webp|heic|heif)$/i.test(file.name);
  }

  function formatBytes(bytes) {
    if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>'"]/g, (char) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      "'": "&#39;",
      "\"": "&quot;"
    })[char]);
  }

  function refreshIcons() {
    if (window.lucide) window.lucide.createIcons();
  }
})();
