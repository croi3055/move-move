import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";
import handler from "../api/videos.js";
import { safeHttpUrl, validateVideoInput } from "../lib/video-validation.js";

const valid = {
  url: "https://www.bilibili.com/video/BV1Na4y1A7ZQ",
  embedUrl: "https://www.bilibili.com/blackboard/html5mobileplayer.html?bvid=BV1Na4y1A7ZQ",
  thumbnail: "/api/bilibili?cover=https%3A%2F%2Fi2.hdslb.com%2Fbfs%2Farchive%2Fexample.jpg",
  title: "Test video",
  kind: "iframe",
};
const dangerous = ["javascript:alert(1)", "JaVaScRiPt:alert(1)", "java\nscript:alert(1)", "data:text/html,test", "file:///tmp/test", "blob:https://example.com/id", "//example.com/video", "https://user:password@example.com", "https:\\example.com", " https://example.com"];

test("video input accepts platform URLs and rejects dangerous schemes and invalid types", () => {
  for (const url of [valid.url, "https://www.youtube.com/watch?v=abc", "https://vimeo.com/123", "https://www.xiaohongshu.com/explore/example", "https://app.h5.xet.pomoho.com/p/course/example", "https://example.com/video.mp4", "http://example.com/video"]) {
    assert.ok(safeHttpUrl(url));
    assert.equal(validateVideoInput({ ...valid, url }).url, url);
  }
  for (const value of dangerous) {
    assert.equal(safeHttpUrl(value), "");
    for (const field of ["url", "embedUrl", "thumbnail"]) {
      assert.throws(() => validateVideoInput({ ...valid, [field]: value }), field);
      assert.throws(() => validateVideoInput({ [field]: value }, { partial: true }), field);
    }
  }
  assert.equal(validateVideoInput({ ...valid, thumbnail: "data:image/svg+xml,old-placeholder" }).thumbnail, "");
  assert.throws(() => validateVideoInput({ ...valid, thumbnail: "/api/bilibili?cover=https://evil.example/image" }));
  assert.throws(() => validateVideoInput({ ...valid, kind: "unknown" }));
  assert.throws(() => validateVideoInput(null));
  assert.throws(() => validateVideoInput({ ...valid, embedUrl: null }));
  assert.deepEqual(validateVideoInput({ title: "New title" }, { partial: true }), { title: "New title" });
});

test("API requires owner authentication for reads and writes and rejects shared libraries", async () => {
  const oldEnv = { ...process.env };
  const oldFetch = globalThis.fetch;
  const calls = [];
  process.env.SUPABASE_URL = "https://database.invalid";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-placeholder";
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options });
    if (options.method === "DELETE") return new Response(null, { status: 204 });
    return new Response(JSON.stringify([]), { status: 200 });
  };
  async function call(method, library = "default", headers = {}, body = { videos: [valid] }) {
    const response = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(value) { this.value = value; }, setHeader() {}, end() {} };
    await handler({ method, query: { library, id: "test-id" }, headers, body }, response);
    return response;
  }
  try {
    for (const token of [undefined, "", "   "]) {
      if (token === undefined) delete process.env.APP_WRITE_TOKEN;
      else process.env.APP_WRITE_TOKEN = token;
      for (const method of ["GET", "POST", "PATCH", "DELETE"]) {
        assert.equal((await call(method)).statusCode, 503);
        assert.equal((await call(method, "friend", { "x-library-key": "friend" })).statusCode, 400);
      }
    }
    assert.equal(calls.length, 0);
    assert.equal((await call("GET")).statusCode, 503);
    process.env.APP_WRITE_TOKEN = "test-placeholder";
    assert.equal((await call("POST")).statusCode, 401);
    assert.equal((await call("GET")).statusCode, 401);
    assert.equal((await call("GET", "default", { "x-app-token": "test-placeholder" })).statusCode, 200);
    for (const method of ["GET", "POST", "PATCH", "DELETE"]) {
      assert.equal((await call(method, "friend", { "x-library-key": "friend" })).statusCode, 400);
      assert.equal((await call(method, "friend", { "x-app-token": "test-placeholder" })).statusCode, 400);
    }
    assert.equal((await call("POST", "default", { "x-app-token": "test-placeholder" })).statusCode, 200);
    assert.equal((await call("DELETE", "default", { "x-app-token": "test-placeholder" })).statusCode, 204);
    const before = calls.length;
    for (const field of ["url", "embedUrl", "thumbnail"]) {
      const invalid = { ...valid, [field]: "javascript:alert(1)" };
      assert.equal((await call("POST", "default", { "x-app-token": "test-placeholder" }, { videos: [valid, invalid] })).statusCode, 400);
      assert.equal((await call("PATCH", "default", { "x-app-token": "test-placeholder" }, { [field]: invalid[field] })).statusCode, 400);
    }
    assert.equal(calls.length, before);
  } finally {
    globalThis.fetch = oldFetch;
    for (const key of ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "APP_WRITE_TOKEN"]) {
      if (oldEnv[key] === undefined) delete process.env[key];
      else process.env[key] = oldEnv[key];
    }
  }
});

test("cloud insertion skips a record added by another device without overwriting it", async () => {
  const keys = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "APP_WRITE_TOKEN"];
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  const oldFetch = globalThis.fetch;
  const existing = { ...valid, title: "Title edited on another device", category: "Keep tag", library_key: "default" };
  const rows = new Map([[valid.url, existing]]);
  let returned;
  try {
    process.env.SUPABASE_URL = "https://database.invalid";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "test-placeholder";
    process.env.APP_WRITE_TOKEN = "test-placeholder";
    globalThis.fetch = async (url, options) => {
      assert.match(url, /on_conflict=library_key,url/);
      assert.equal(options.headers.Prefer, "resolution=ignore-duplicates,return=representation");
      const inserted = [];
      for (const row of JSON.parse(options.body)) {
        if (rows.has(row.url)) continue;
        rows.set(row.url, row);
        inserted.push(row);
      }
      return new Response(JSON.stringify(inserted));
    };
    const response = { setHeader() {}, status(code) { assert.equal(code, 200); return this; }, json(value) { returned = value; } };
    await handler({ method: "POST", query: {}, headers: { "x-app-token": "test-placeholder" }, body: { videos: [valid, { ...valid, url: "https://example.com/new" }] } }, response);
    assert.equal(returned.length, 1);
    assert.equal(rows.get(valid.url), existing);
    assert.equal(rows.get(valid.url).title, "Title edited on another device");
    assert.ok(readFileSync(new URL("../server.mjs", import.meta.url), "utf8").includes("resolution=ignore-duplicates,return=representation"));
  } finally {
    globalThis.fetch = oldFetch;
    for (const key of keys) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
});

test("frontend rejects unsafe saved data before navigation or player creation", () => {
  const source = readFileSync(new URL("../script.js", import.meta.url), "utf8");
  const opened = [], players = [], alerts = [];
  const context = vm.createContext({ URL, state: {},
    window: { location: { href: "https://app.example/" }, alert: (message) => alerts.push(message), open: (url) => opened.push(url), setTimeout() {} },
    document: { createElement: (type) => ({ type }) },
    elements: { playerModal: {}, playerSource: {}, playerTitleLink: {}, playerFrame: { replaceChildren() {}, append: (player) => players.push(player) } },
    isExternalEntry: (video) => video.kind === "external", getDisplaySource: () => "Test", getVideoTags: () => [],
    getPlayableEmbedUrl: (video) => video.embedUrl,
    isBilibiliImageUrl: (url) => new URL(url).hostname.endsWith(".hdslb.com"),
    makeBilibiliCoverProxyUrl: (url) => `/api/bilibili?cover=${encodeURIComponent(url)}`,
    isFallbackThumbnail: (url) => !url || url.startsWith("data:image/svg+xml"),
    makeFallbackThumbnail: () => "safe-generated-placeholder",
  });
  vm.runInContext(source.slice(source.indexOf("function safeHttpUrl("), source.indexOf("function getPlayableEmbedUrl(")), context);
  vm.runInContext(source.slice(source.indexOf("function playVideo("), source.indexOf("function getDisplaySource(")), context);
  for (const url of dangerous) {
    context.video = { ...valid, embedUrl: url };
    vm.runInContext("playVideo(video)", context);
    context.value = url;
    assert.equal(vm.runInContext("safeHttpUrl(value)", context), "");
  }
  assert.equal(players.length, 0);
  assert.equal(opened.length, 0);
  assert.equal(alerts.length, dangerous.length);
  context.video = { ...valid, thumbnail: "data:text/html,test" };
  assert.equal(vm.runInContext("getThumbnailSrc(video)", context), "safe-generated-placeholder");
  vm.runInContext("playVideo(video)", context);
  assert.equal(players[0].src, valid.embedUrl);
  context.video = { ...valid, kind: "external" };
  vm.runInContext("playVideo(video)", context);
  assert.equal(opened[0], valid.embedUrl);
});
