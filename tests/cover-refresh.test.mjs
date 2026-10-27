import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";

const source = readFileSync(new URL("../script.js", import.meta.url), "utf8");
function fixture() {
  const context = vm.createContext({ URL, URLSearchParams, state: { videos: [], syncGeneration: 0 },
    saveVideos() {}, render() {} });
  vm.runInContext(source.slice(source.indexOf("async function initializeApp()")), context);
  context.saveVideos = () => {};
  context.render = () => {};
  return context;
}

test("cloud refresh preserves recovered covers without restoring deleted records or old fields", () => {
  const c = fixture();
  c.cached = [
    { id: "1", url: "https://example.com/a", thumbnail: "https://i2.hdslb.com/a.jpg", title: "Old" },
    { id: "2", url: "https://example.com/b", thumbnail: "https://i2.hdslb.com/b.jpg" },
  ];
  c.incoming = [{ id: "1", url: "https://example.com/a", thumbnail: "", title: "Edited remotely" }];
  let result = vm.runInContext("preserveCachedCovers(incoming, cached)", c);
  assert.equal(result.length, 1);
  assert.equal(result[0].title, "Edited remotely");
  assert.equal(result[0].thumbnail, c.cached[0].thumbnail);
  c.incoming[0].url = "https://example.com/new";
  assert.equal(vm.runInContext("preserveCachedCovers(incoming, cached)[0].thumbnail", c), "");
  c.incoming[0].url = c.cached[0].url;
  c.incoming[0].thumbnail = "https://i2.hdslb.com/new.jpg";
  assert.equal(vm.runInContext("preserveCachedCovers(incoming, cached)[0].thumbnail", c), c.incoming[0].thumbnail);
});

test("metadata hydration applies to the current record after an overlapping cloud refresh", async () => {
  const c = fixture();
  const video = { id: "1", url: "https://www.bilibili.com/video/BV1Na4y1A7ZQ/", title: "My title", thumbnail: "" };
  c.state.videos = [video];
  let resolve;
  c.getVideoMetadata = () => new Promise((done) => { resolve = done; });
  const pending = vm.runInContext("hydrateSavedBilibiliVideos()", c);
  c.state.videos = [{ ...video, title: "Edited title" }];
  resolve({ thumbnail: "https://i2.hdslb.com/a.jpg" });
  await pending;
  assert.equal(c.state.videos[0].thumbnail, "https://i2.hdslb.com/a.jpg");
  assert.equal(c.state.videos[0].title, "Edited title");
  assert.equal(video.thumbnail, "");
});
