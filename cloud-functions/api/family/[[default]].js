import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual
} from "node:crypto";
import { getStore } from "@edgeone/pages-blob";

const STORE_NAME = "lya-family-media";
const COOKIE_NAME = "lya_family_session";
const SESSION_SECONDS = 7 * 24 * 60 * 60;
const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;
const MAX_PHOTOS = 500;
const PENDING_SECONDS = 20 * 60;
const VALID_SUBJECTS = new Set(["li-yu-an", "li-yu-en", "together"]);
const loginAttempts = new Map();

export default async function onRequest(context) {
  const request = context.request;
  const url = new URL(request.url);
  const method = request.method.toUpperCase();
  const path = url.pathname.replace(/^\/api\/family/, "") || "/";

  try {
    if (method === "OPTIONS") {
      return new Response(null, { status: 204, headers: baseHeaders() });
    }

    if (method === "POST" && !hasSameOrigin(request, url)) {
      return json({ error: "请求来源无效" }, 403);
    }

    if (path === "/login" && method === "POST") {
      return login(context, url);
    }

    if (path === "/logout" && method === "POST") {
      return json(
        { ok: true },
        200,
        { "Set-Cookie": clearSessionCookie() }
      );
    }

    if (path === "/session" && method === "GET") {
      return json(
        { authenticated: Boolean(readSession(request, context.env)) },
        200,
        { "Cache-Control": "no-store" }
      );
    }

    if (path === "/photos" && method === "GET") {
      return listPhotos();
    }

    const mediaMatch = path.match(/^\/media\/([a-z0-9-]{12,64})$/);
    if (mediaMatch && method === "GET") {
      return servePhoto(mediaMatch[1]);
    }

    if (path === "/upload-url" && method === "POST") {
      const authError = requireSession(request, context.env);
      if (authError) return authError;
      return createPhotoUpload(request);
    }

    if (path === "/publish" && method === "POST") {
      const authError = requireSession(request, context.env);
      if (authError) return authError;
      return publishPhoto(request);
    }

    return json({ error: "接口不存在" }, 404);
  } catch (error) {
    console.error("Family photo API error", error);
    return json({ error: "服务暂时不可用" }, 500);
  }
}

async function login(context, url) {
  const env = context.env || {};
  const expectedHash = String(env.FAMILY_UPLOAD_PASSWORD_HASH || "").toLowerCase();
  const sessionSecret = String(env.FAMILY_SESSION_SECRET || "");

  if (!/^[a-f0-9]{64}$/.test(expectedHash) || sessionSecret.length < 32) {
    return json({ error: "家庭上传尚未完成配置" }, 503);
  }

  const clientKey = clientRateKey(context);
  if (!canAttemptLogin(clientKey)) {
    return json({ error: "尝试次数过多，请稍后再试" }, 429);
  }

  const body = await readJson(context.request);
  const suppliedHash = sha256(String(body.password || ""));
  if (!safeEqual(suppliedHash, expectedHash)) {
    recordFailedLogin(clientKey);
    return json({ error: "家庭密码不正确" }, 401);
  }

  loginAttempts.delete(clientKey);
  const token = createSessionToken(sessionSecret);
  return json(
    { ok: true, expiresIn: SESSION_SECONDS },
    200,
    { "Set-Cookie": sessionCookie(token), "Cache-Control": "no-store" }
  );
}

async function createPhotoUpload(request) {
  const input = await readJson(request);
  const size = Number(input.size);
  const width = Number(input.width);
  const height = Number(input.height);
  const sha = String(input.sha256 || "").toLowerCase();
  const date = validDate(input.date) ? input.date : today();
  const subject = String(input.subject || "");

  if (!Number.isInteger(size) || size < 1 || size > MAX_UPLOAD_BYTES) {
    return json({ error: "照片压缩后需小于 4MB" }, 400);
  }
  if (!validDimension(width) || !validDimension(height)) {
    return json({ error: "照片尺寸无效" }, 400);
  }
  if (!/^[a-f0-9]{64}$/.test(sha)) {
    return json({ error: "照片校验值无效" }, 400);
  }
  if (!VALID_SUBJECTS.has(subject)) {
    return json({ error: "请选择李予安、李予恩或两人一起" }, 400);
  }

  const store = getStore(STORE_NAME);
  await cleanExpiredPending(store);
  const duplicate = await store.get(`hashes/${sha}.json`, {
    type: "json",
    consistency: "strong"
  });
  if (duplicate) {
    return json({ error: "这张照片已经发布过", duplicate: publicPhoto(duplicate) }, 409);
  }

  const id = `${Date.now().toString(36)}-${randomBytes(6).toString("hex")}`;
  const month = date.slice(0, 7).replace("-", "/");
  const blobKey = `photos/${month}/${id}.jpg`;
  const upload = await store.createUploadUrl(blobKey, {
    expireSeconds: 10 * 60,
    contentType: "image/jpeg"
  });
  const pending = {
    id,
    blobKey,
    sha256: sha,
    size,
    width,
    height,
    date,
    subject,
    createdAt: new Date().toISOString()
  };

  await store.setJSON(`pending/${id}.json`, pending, { onlyIfNew: true });
  return json({ id, uploadUrl: upload.url, contentType: "image/jpeg", maxBytes: MAX_UPLOAD_BYTES });
}

async function publishPhoto(request) {
  const input = await readJson(request);
  const id = String(input.id || "");
  if (!/^[a-z0-9-]{12,64}$/.test(id)) {
    return json({ error: "上传编号无效" }, 400);
  }

  const store = getStore(STORE_NAME);
  const pending = await store.get(`pending/${id}.json`, {
    type: "json",
    consistency: "strong"
  });
  if (!pending) {
    return json({ error: "上传凭据已失效，请重新选择照片" }, 404);
  }
  if (Date.parse(pending.createdAt) + PENDING_SECONDS * 1000 < Date.now()) {
    await Promise.all([
      store.delete(`pending/${id}.json`),
      store.delete(pending.blobKey)
    ]);
    return json({ error: "上传凭据已过期，请重新选择照片" }, 410);
  }

  const duplicate = await store.get(`hashes/${pending.sha256}.json`, {
    type: "json",
    consistency: "strong"
  });
  if (duplicate) {
    await store.delete(`pending/${id}.json`);
    return json({ error: "这张照片已经发布过", duplicate: publicPhoto(duplicate) }, 409);
  }

  const uploaded = await store.get(pending.blobKey, {
    type: "arrayBuffer",
    consistency: "strong"
  });
  if (!uploaded || uploaded.byteLength < 1 || uploaded.byteLength > MAX_UPLOAD_BYTES) {
    return json({ error: "没有找到已上传的照片，或文件大小无效" }, 400);
  }
  if (pending.size !== uploaded.byteLength) {
    return json({ error: "照片上传不完整，请重试" }, 400);
  }

  const title = cleanText(input.title, 60) || `成长记录 ${pending.date}`;
  const location = cleanText(input.location, 40) || "地点未提供";
  const uploadedAt = new Date().toISOString();
  const photo = {
    id,
    type: "photo",
    title,
    album: "家庭上传",
    subject: pending.subject,
    date: pending.date,
    location,
    description: "由家庭成员上传。",
    tags: ["孩子", "家庭上传"],
    src: `/api/family/media/${id}`,
    thumb: `/api/family/media/${id}`,
    width: pending.width,
    height: pending.height,
    uploadedAt,
    sha256: pending.sha256,
    blobKey: pending.blobKey
  };

  try {
    await store.setJSON(`hashes/${pending.sha256}.json`, photo, { onlyIfNew: true });
  } catch (error) {
    if (error?.code !== "PRECONDITION_FAILED") throw error;
    const existing = await store.get(`hashes/${pending.sha256}.json`, {
      type: "json",
      consistency: "strong"
    });
    await Promise.all([
      store.delete(`pending/${id}.json`),
      store.delete(pending.blobKey)
    ]);
    return json({ error: "这张照片已经发布过", duplicate: existing ? publicPhoto(existing) : null }, 409);
  }

  try {
    await store.setJSON(`metadata/${id}.json`, photo, { onlyIfNew: true });
  } catch (error) {
    await store.delete(`hashes/${pending.sha256}.json`);
    throw error;
  }
  await store.delete(`pending/${id}.json`);
  return json({ ok: true, photo: publicPhoto(photo) }, 201);
}

async function listPhotos() {
  const store = getStore(STORE_NAME);
  const result = await store.list({ prefix: "metadata/", consistency: "strong" });
  const blobs = Array.isArray(result) ? result : (result?.blobs || []);
  const keys = blobs
    .map((item) => typeof item === "string" ? item : item?.key)
    .filter(Boolean)
    .slice(-MAX_PHOTOS);
  const records = await Promise.all(keys.map((key) => store.get(key, {
    type: "json",
    consistency: "strong"
  })));
  const photos = records
    .filter(Boolean)
    .map(publicPhoto)
    .sort((a, b) => new Date(b.uploadedAt || b.date) - new Date(a.uploadedAt || a.date));

  return json(
    { photos },
    200,
    { "Cache-Control": "public, max-age=10, stale-while-revalidate=30" }
  );
}

async function servePhoto(id) {
  const store = getStore(STORE_NAME);
  const photo = await store.get(`metadata/${id}.json`, {
    type: "json",
    consistency: "strong"
  });
  if (!photo?.blobKey) {
    return json({ error: "照片不存在" }, 404);
  }

  const body = await store.get(photo.blobKey, {
    type: "arrayBuffer",
    consistency: "eventual"
  });
  if (!body) {
    return json({ error: "照片不存在" }, 404);
  }

  return new Response(body, {
    headers: {
      "Content-Type": "image/jpeg",
      "Cache-Control": "public, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff"
    }
  });
}

async function cleanExpiredPending(store) {
  const result = await store.list({ prefix: "pending/", limit: 50, consistency: "strong" });
  const keys = (result?.blobs || []).map((item) => item.key).filter(Boolean);
  const pendingItems = await Promise.all(keys.map(async (key) => ({
    key,
    value: await store.get(key, { type: "json", consistency: "strong" })
  })));
  const expired = pendingItems.filter(({ value }) =>
    !value?.createdAt || Date.parse(value.createdAt) + PENDING_SECONDS * 1000 < Date.now()
  );
  await Promise.all(expired.flatMap(({ key, value }) => [
    store.delete(key),
    value?.blobKey ? store.delete(value.blobKey) : Promise.resolve()
  ]));
}

function publicPhoto(photo) {
  return {
    id: photo.id,
    type: "photo",
    title: photo.title,
    album: "家庭上传",
    subject: VALID_SUBJECTS.has(photo.subject) ? photo.subject : "li-yu-an",
    date: photo.date,
    location: photo.location || "地点未提供",
    description: "由家庭成员上传。",
    tags: ["孩子", "家庭上传"],
    src: `/api/family/media/${photo.id}`,
    thumb: `/api/family/media/${photo.id}`,
    width: photo.width,
    height: photo.height,
    uploadedAt: photo.uploadedAt
  };
}

function requireSession(request, env) {
  if (readSession(request, env)) return null;
  return json({ error: "请先输入家庭密码" }, 401, { "Cache-Control": "no-store" });
}

function readSession(request, env = {}) {
  const secret = String(env.FAMILY_SESSION_SECRET || "");
  if (secret.length < 32) return null;
  const token = readCookie(request.headers.get("cookie"), COOKIE_NAME);
  if (!token) return null;
  const [payload, signature] = token.split(".");
  if (!payload || !signature) return null;
  const expected = createHmac("sha256", secret).update(payload).digest("base64url");
  if (!safeEqual(signature, expected)) return null;

  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (data.v !== 1 || !Number.isFinite(data.exp) || data.exp <= Date.now()) return null;
    return data;
  } catch {
    return null;
  }
}

function createSessionToken(secret) {
  const payload = Buffer.from(JSON.stringify({
    v: 1,
    exp: Date.now() + SESSION_SECONDS * 1000,
    nonce: randomBytes(12).toString("hex")
  })).toString("base64url");
  const signature = createHmac("sha256", secret).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

function sessionCookie(token) {
  return `${COOKIE_NAME}=${token}; Path=/; Max-Age=${SESSION_SECONDS}; HttpOnly; Secure; SameSite=Strict`;
}

function clearSessionCookie() {
  return `${COOKIE_NAME}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict`;
}

function readCookie(header, name) {
  if (!header) return "";
  const prefix = `${name}=`;
  const item = header.split(";").map((part) => part.trim()).find((part) => part.startsWith(prefix));
  return item ? item.slice(prefix.length) : "";
}

function hasSameOrigin(request, url) {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  // EdgeOne invokes Cloud Functions through an internal URL, while browsers
  // retain the public lya.net.cn origin. Keep the production origin explicit.
  return origin === "https://lya.net.cn" || origin === url.origin;
}

function clientRateKey(context) {
  const forwarded = context.request.headers.get("x-forwarded-for") || "";
  return String(context.clientIp || forwarded.split(",")[0] || "unknown").trim();
}

function canAttemptLogin(key) {
  pruneLoginAttempts();
  const entry = loginAttempts.get(key);
  return !entry || entry.expiresAt <= Date.now() || entry.count < 8;
}

function recordFailedLogin(key) {
  const current = loginAttempts.get(key);
  if (!current || current.expiresAt <= Date.now()) {
    loginAttempts.set(key, { count: 1, expiresAt: Date.now() + 15 * 60 * 1000 });
    return;
  }
  current.count += 1;
}

function pruneLoginAttempts() {
  if (loginAttempts.size < 1000) return;
  const now = Date.now();
  for (const [key, entry] of loginAttempts) {
    if (entry.expiresAt <= now) loginAttempts.delete(key);
  }
}

async function readJson(request) {
  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > 16 * 1024) throw new Error("Request body too large");
  return request.json();
}

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...baseHeaders(), ...extraHeaders }
  });
}

function baseHeaders() {
  return {
    "Content-Type": "application/json; charset=utf-8",
    "X-Content-Type-Options": "nosniff"
  };
}

function sha256(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(String(left));
  const rightBuffer = Buffer.from(String(right));
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function cleanText(value, maxLength) {
  return String(value || "")
    .replace(/[<>&"'`\u0000-\u001f]/g, "")
    .trim()
    .slice(0, maxLength);
}

function validDimension(value) {
  return Number.isInteger(value) && value >= 1 && value <= 10000;
}

function validDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ""))) return false;
  return !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
}

function today() {
  return new Date().toISOString().slice(0, 10);
}
