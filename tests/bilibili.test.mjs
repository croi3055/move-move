import assert from "node:assert/strict";
import { test } from "node:test";
import { parseBilibiliPage } from "../lib/bilibili.js";

test("page metadata does not depend on the code following INITIAL_STATE", () => {
  const data = { bvid: "BV1Na4y1A7ZQ", title: '标题含 } 和 " 引号', pic: "https://i2.hdslb.com/a.jpg" };
  for (const suffix of [";(function(){})()", ";</script>", ";window.next = {};"]) {
    assert.deepEqual(parseBilibiliPage(`window.__INITIAL_STATE__=${JSON.stringify({ videoData: data })}${suffix}`, data.bvid), data);
  }
  assert.throws(() => parseBilibiliPage(`window.__INITIAL_STATE__=${JSON.stringify({ videoData: data })};`, "BV1Qb4y1q7bU"));
  assert.throws(() => parseBilibiliPage("window.__INITIAL_STATE__={bad};", data.bvid));
});
