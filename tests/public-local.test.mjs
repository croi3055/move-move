import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { test } from "node:test";
import { fetchCover, allowMetadataRequest } from "../lib/cover-proxy.js";

const source = readFileSync(new URL("../script.js", import.meta.url), "utf8");
function fixture() {
  const store = new Map();
  const warnings = [];
  const context = vm.createContext({ URL, URLSearchParams, crypto, Blob, AbortController,
    state: { videos: [], writeToken: "", syncGeneration: 0 },
    LOCAL_STORAGE_KEY: "local", STORAGE_PREFIX: "cloud", LEGACY_STORAGE_KEY: "legacy",
    document: { querySelector: () => null },
    window: { setTimeout: (fn) => fn(), alert: (text) => warnings.push(text) },
    localStorage: { getItem: (k) => store.get(k) || null, setItem: (k, v) => store.set(k, v) },
  });
  // Load declarations without booting or mutating a real browser library.
  vm.runInContext(source.slice(source.indexOf("async function initializeApp()")), context);
  return { context, store, warnings, run: (code) => vm.runInContext(code, context) };
}

test("backup parser preserves title/tags but regenerates IDs and playback, rejecting unsafe input", () => {
  const f = fixture();
  f.context.text = JSON.stringify({ format: "workout-videos", version: 1, videos: [{
    title: "自定义标题", url: "https://www.bilibili.com/video/BV1Qb4y1q7bU", category: "有氧｜体态",
    thumbnail: "", id: "old", embedUrl: "javascript:alert(1)", token: "not-imported",
  }] });
  const [video] = f.run("parseBackup(text)");
  assert.equal(video.title, "自定义标题");
  assert.equal(video.category, "有氧｜体态");
  assert.notEqual(video.id, "old");
  assert.match(video.embedUrl, /^https:/);
  assert.equal(video.token, undefined);
  f.context.text = f.context.text.replace("https://www.bilibili.com/video/BV1Qb4y1q7bU", "javascript:alert(1)");
  assert.throws(() => f.run("parseBackup(text)"), /无效/);
  assert.throws(() => f.run('parseBackup(\'{"format":"workout-videos","version":2,"videos":[]}\')'), /支持/);
});

test("corrupt local data is never overwritten; quota errors retain memory and warn", () => {
  const f = fixture();
  f.store.set("local", "broken-json");
  assert.equal(f.run("loadVideos()").length, 0);
  f.run("state.videos = [{url:'https://example.com'}]; saveVideos()");
  assert.equal(f.store.get("local"), "broken-json");
  assert.ok(f.warnings.length);
  f.context.localStorage.setItem = () => { throw new Error("quota"); };
  f.run("state.storageBlockedKey = ''; saveVideos()");
  assert.equal(f.context.state.videos.length, 1);
});

test("pending changes block cloud switching and background refresh", async () => {
  const f = fixture();
  f.run("state.busy = true; state.writeToken = 'test-only'");
  f.context.fetch = () => { throw new Error("must not fetch"); };
  await f.run("loadRemoteVideos()");
  await f.run("connectSync({preventDefault(){}})");
  f.run("disconnectSync()");
  assert.equal(f.context.state.writeToken, "test-only");
});

test("import previews destination, deduplicates and only appends; export excludes credentials", async () => {
  const f = fixture();
  f.context.state.videos = [{ id: "existing", url: "https://example.com/old", title: "保留", category: "有氧" }];
  f.context.render = () => {};
  let preview;
  f.context.window.confirm = (message) => { preview = message; return true; };
  const item = { title: "新增", url: "https://example.com/new", category: "体态", thumbnail: "" };
  f.context.event = { target: { value: "backup.json", files: [{ size: 100, text: async () => JSON.stringify({
    format: "workout-videos", version: 1, videos: [item, item, { ...item, url: "https://example.com/old" }],
  }) }] } };
  await f.run("importVideos(event)");
  assert.match(preview, /本地收藏追加 1 个视频，跳过 2/);
  assert.equal(f.context.state.videos.length, 2);
  assert.equal(f.context.state.videos.find((v) => v.id === "existing").title, "保留");
  f.context.state.writeToken = "test-secret-never-export";
  f.context.state.videos[0].token = "extra-secret";
  let exported;
  f.context.downloadExportFile = (text) => { exported = text; };
  await f.run("exportVideos()");
  assert.equal(JSON.parse(exported).version, 1);
  assert.ok(!exported.includes("secret"));
});

test("cover proxy restricts host, redirects, MIME and streamed size; limits repeated requests", async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async (url, options) => {
      assert.equal(options.redirect, "error");
      assert.ok(options.signal);
      return new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "image/png" } });
    };
    assert.equal((await fetchCover("https://i0.hdslb.com/test.png")).buffer.length, 3);
    for (const url of ["https://evil.test/a", "https://i0.hdslb.com:444/a", "https://user@i0.hdslb.com/a"]) await assert.rejects(fetchCover(url));
    globalThis.fetch = async () => new Response("<svg/>", { headers: { "content-type": "image/svg+xml" } });
    await assert.rejects(fetchCover("https://i0.hdslb.com/a"));
    globalThis.fetch = async () => new Response(new Uint8Array(5 * 1024 * 1024 + 1), { headers: { "content-type": "image/png" } });
    await assert.rejects(fetchCover("https://i0.hdslb.com/a"));
    for (let i = 0; i < 120; i++) assert.equal(allowMetadataRequest("test-client"), true);
    assert.equal(allowMetadataRequest("test-client"), false);
  } finally { globalThis.fetch = original; }
});

test("local-to-cloud prompt requires consent, skips duplicates and preserves local storage", async () => {
  const f = fixture();
  f.context.elements = Object.fromEntries(["localImportStatus", "localImportModal", "skipLocalImportButton", "confirmLocalImportButton", "syncButton"].map((key) => [key, { focus() {} }]));
  f.context.state.writeToken = "test-token";
  f.context.state.storageMode = "remote";
  f.context.state.videos = [{ id: "cloud", url: "https://example.com/old", title: "云端标题", category: "有氧" }];
  f.context.localVideos = [{ url: "https://example.com/new", title: "新视频", category: "体态" }, { url: "https://example.com/old", title: "本地标题", category: "体态" }];
  f.store.set("local", JSON.stringify(f.context.localVideos));
  const original = f.store.get("local");
  let writes = 0;
  f.context.persistVideos = async (videos) => { writes++; return videos; };
  f.context.render = () => {};
  f.run("offerLocalImport(localVideos)");
  assert.equal(writes, 0);
  f.run("closeLocalImport()");
  assert.equal(writes, 0);
  f.run("offerLocalImport(localVideos)");
  await f.run("importLocalToCloud()");
  assert.equal(writes, 1);
  assert.equal(f.context.state.videos.length, 2);
  assert.equal(f.context.state.videos.find((v) => v.id === "cloud").title, "云端标题");
  assert.equal(f.store.get("local"), original);
  f.run("offerLocalImport(localVideos)");
  await f.run("importLocalToCloud()");
  assert.equal(writes, 1);
  f.context.localVideos = [{ url: "https://example.com/failed", title: "失败测试", category: "有氧" }];
  f.context.persistVideos = async () => { throw new Error("网络失败，本地收藏保留"); };
  f.run("offerLocalImport(localVideos)");
  await f.run("importLocalToCloud()");
  assert.equal(f.context.elements.localImportModal.hidden, false);
  assert.equal(f.context.elements.confirmLocalImportButton.disabled, false);
  assert.equal(f.context.state.videos.length, 2);
  assert.equal(f.store.get("local"), original);
});
