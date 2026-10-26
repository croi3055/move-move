import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { test } from "node:test";

const source = readFileSync(new URL("../script.js", import.meta.url), "utf8");
const ctx = vm.createContext({ URL, crypto });
vm.runInContext(source.slice(source.indexOf("async function initializeApp()")), ctx);
const run = (code) => vm.runInContext(code, ctx);

test("browser and share links normalize to the same Bilibili video", () => {
  const browser = "https://www.bilibili.com/video/BV1R3411A7g4/?spm_id_from333.337.search-card.all.click&vd_source=tracking";
  const share = "https://www.bilibili.com/video/BV1R3411A7g4/?share_source=copy_web&vd_source=tracking";
  ctx.input = browser + "\n【帕梅拉 - 10分钟暴汗有氧】 " + share;
  const result = run("parseVideoEntries(input)");
  assert.equal(result.length, 1);
  assert.equal(result[0].url, "https://www.bilibili.com/video/BV1R3411A7g4/");
  ctx.input = "【帕梅拉 - 10分钟暴汗有氧】 " + share;
  assert.equal(run("parseVideoEntry(input).title"), "帕梅拉 - 10分钟暴汗有氧");
  ctx.input = `[${browser}](${browser})`;
  assert.equal(run("parseVideoEntry(input).title"), "");
});

test("page and time parameters survive, unknown platform signatures remain intact", () => {
  ctx.input = "https://www.bilibili.com/video/BV1R3411A7g4/?p=2&t=40&vd_source=tracking";
  assert.equal(run("normalizeVideoUrl(input)"), "https://www.bilibili.com/video/BV1R3411A7g4/?p=2&t=40");
  ctx.input = "https://example.com/video?signature=abc&share_source=required";
  assert.equal(run("normalizeVideoUrl(input)"), ctx.input);
  ctx.input = "https://notbilibili.com/video?vd_source=required";
  assert.equal(run("normalizeVideoUrl(input)"), ctx.input);
});

test("pasted title has priority, metadata title supplies bare links", () => {
  ctx.entry = { url: "https://www.bilibili.com/video/BV1R3411A7g4/", title: "" };
  ctx.metadata = { title: "平台标题", source: "Bilibili" };
  assert.equal(run("createVideo(entry, metadata, '未分类').title"), "平台标题");
  ctx.entry.title = "我的分享标题";
  assert.equal(run("createVideo(entry, metadata, '未分类').title"), "我的分享标题");
});
