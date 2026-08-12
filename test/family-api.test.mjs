import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import onRequest from "../cloud-functions/api/family/[[default]].js";

const password = "test-family-password";
const env = {
  FAMILY_UPLOAD_PASSWORD_HASH: createHash("sha256").update(password).digest("hex"),
  FAMILY_SESSION_SECRET: "test-session-secret-that-is-longer-than-32-characters"
};

function request(path, options = {}) {
  const headers = new Headers(options.headers || {});
  let body;
  if (options.body !== undefined) {
    headers.set("content-type", "application/json");
    body = JSON.stringify(options.body);
  }
  return onRequest({
    request: new Request(options.requestUrl || `https://lya.net.cn/api/family${path}`, {
      method: options.method || "GET",
      headers,
      body
    }),
    env: options.env || env,
    clientIp: options.clientIp || "127.0.0.1"
  });
}

test("correct family password creates a valid session", async () => {
  const login = await request("/login", {
    method: "POST",
    body: { password },
    clientIp: "127.0.0.2"
  });
  assert.equal(login.status, 200);
  const cookie = login.headers.get("set-cookie");
  assert.match(cookie, /lya_family_session=/);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /Secure/);
  assert.match(cookie, /SameSite=Strict/);

  const session = await request("/session", {
    headers: { cookie: cookie.split(";")[0] }
  });
  assert.equal(session.status, 200);
  assert.deepEqual(await session.json(), { authenticated: true });
});

test("wrong password is rejected", async () => {
  const response = await request("/login", {
    method: "POST",
    body: { password: "wrong" },
    clientIp: "127.0.0.3"
  });
  assert.equal(response.status, 401);
  assert.equal(response.headers.get("set-cookie"), null);
});

test("tampered session is not authenticated", async () => {
  const response = await request("/session", {
    headers: { cookie: "lya_family_session=forged.payload" }
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { authenticated: false });
});

test("cross-origin writes are rejected", async () => {
  const response = await request("/login", {
    method: "POST",
    headers: { origin: "https://example.com" },
    body: { password },
    clientIp: "127.0.0.4"
  });
  assert.equal(response.status, 403);
});

test("the public origin is accepted behind EdgeOne's internal function URL", async () => {
  const response = await request("/login", {
    method: "POST",
    headers: { origin: "https://lya.net.cn" },
    body: { password },
    requestUrl: "https://edgeone-function-internal/api/family/login",
    clientIp: "127.0.0.6"
  });
  assert.equal(response.status, 200);
});

test("upload URL requires a family session", async () => {
  const response = await request("/upload-url", {
    method: "POST",
    body: {
      size: 1024,
      width: 800,
      height: 600,
      date: "2026-08-12",
      sha256: "a".repeat(64)
    }
  });
  assert.equal(response.status, 401);
});

test("missing production secrets keeps login disabled", async () => {
  const response = await request("/login", {
    method: "POST",
    body: { password },
    env: {},
    clientIp: "127.0.0.5"
  });
  assert.equal(response.status, 503);
});

test("logout expires the session cookie", async () => {
  const response = await request("/logout", { method: "POST", body: {} });
  assert.equal(response.status, 200);
  assert.match(response.headers.get("set-cookie"), /Max-Age=0/);
});
