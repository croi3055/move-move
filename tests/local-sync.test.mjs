import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";

function fixture() {
  const source = readFileSync(new URL("../script.js", import.meta.url), "utf8");
  const storage = new Map();
  const calls = [];
  const state = { writeToken: "", storageMode: "local", videos: [], syncGeneration: 0 };
  const elements = Object.fromEntries(["syncModal", "syncTokenInput", "disconnectSyncButton", "syncStatus", "connectSyncButton"].map((key) => [key, { value: "", focus() {} }]));
  const context = vm.createContext({ state, elements, URLSearchParams, structuredClone,
    STORAGE_PREFIX: "exercise-video-library:v2", LEGACY_STORAGE_KEY: "exercise-video-library:v1",
    LOCAL_STORAGE_KEY: "exercise-video-library:local:v3", VIDEOS_API: "/api/videos",
    document: { visibilityState: "visible" },
    localStorage: { getItem: (key) => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: (key) => storage.delete(key) },
    fetch: async (...args) => { calls.push(args); return { ok: true, json: async () => [] }; },
    render() {}, renderSyncState() {}, hydrateSavedBilibiliVideos: async () => {},
    getFriendlyErrorMessage: (error) => error.message,
  });
  vm.runInContext(source.slice(source.indexOf("async function loadRemoteVideos("), source.indexOf("function mergeVideos(")), context);
  vm.runInContext(source.slice(source.indexOf("function loadVideos("), source.indexOf("async function hydrateSavedBilibiliVideos(")), context);
  vm.runInContext(source.slice(source.indexOf("function isFallbackThumbnail("), source.indexOf("function isLegacyBilibiliEmbed(")), context);
  context.offerLocalImport = (videos) => { context.offeredVideos = videos; return videos.length > 0; };
  return { context, storage, calls, state, elements, run: (code) => vm.runInContext(code, context) };
}

test("visitors never read cloud data and do not inherit previous cloud caches", async () => {
  const f = fixture();
  f.storage.set("exercise-video-library:v2:default", JSON.stringify([{ title: "Owner data" }]));
  assert.equal(f.run("loadVideos()").length, 0);
  await f.run("loadRemoteVideos()");
  await f.run("persistVideos([{title: 'Local video'}])");
  await f.run("updatePersistedVideo('id', {title: 'Local edit'})");
  await f.run("deletePersistedVideo('id')");
  assert.equal(f.calls.length, 0);
  f.state.videos = [{ title: "Visitor data" }];
  f.run("saveVideos()");
  assert.equal(JSON.parse(f.storage.get("exercise-video-library:v2:default"))[0].title, "Owner data");
  assert.equal(JSON.parse(f.storage.get("exercise-video-library:local:v3"))[0].title, "Visitor data");
});

test("connecting to an empty cloud never uploads local data; disconnect restores local data", async () => {
  const f = fixture();
  f.state.videos = [{ title: "Local collection", url: "https://example.com/video" }];
  f.run("saveVideos()");
  f.elements.syncTokenInput.value = "test-placeholder";
  await f.run("connectSync({preventDefault(){}})");
  assert.equal(f.state.storageMode, "remote");
  assert.equal(f.state.videos.length, 0);
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0][1].headers["x-app-token"], "test-placeholder");
  assert.equal(f.calls[0][1].method, undefined);
  assert.equal(f.context.offeredVideos[0].title, "Local collection");
  f.run("disconnectSync()");
  assert.equal(f.state.videos[0].title, "Local collection");
  assert.equal(f.state.writeToken, "");
});

test("failed sync blocks cloud edits and late responses cannot overwrite local data", async () => {
  const f = fixture();
  f.state.writeToken = "test-placeholder";
  f.context.fetch = async () => { throw new Error("Offline"); };
  await f.run("loadRemoteVideos()");
  assert.equal(f.state.storageMode, "offline");
  await assert.rejects(f.run("persistVideos([])"), /云端未连接/);
  let resolveFetch;
  f.context.fetch = () => new Promise((resolve) => { resolveFetch = resolve; });
  const pending = f.run("loadRemoteVideos()");
  f.storage.set("exercise-video-library:local:v3", JSON.stringify([{ title: "Local only", url: "https://example.com/video" }]));
  f.run("disconnectSync()");
  resolveFetch({ ok: true, json: async () => [{ title: "Cloud only" }] });
  await pending;
  assert.equal(f.state.videos[0].title, "Local only");
  assert.equal(f.state.storageMode, "local");
});

test("incorrect sync key keeps local collection and is not stored", async () => {
  const f = fixture();
  f.state.videos = [{ title: "Local only" }];
  f.context.fetch = async () => ({ ok: false, status: 401 });
  f.elements.syncTokenInput.value = "incorrect-placeholder";
  await f.run("connectSync({preventDefault(){}})");
  assert.equal(f.state.writeToken, "");
  assert.equal(f.state.videos[0].title, "Local only");
  assert.equal(f.storage.has("exercise-video-library:write-token"), false);
});
