import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import { test } from "node:test";

for (const mode of ["unconfigured", "write-disabled", "configured"]) {
test(`local preview and API security (${mode})`, async () => {
  const reservation = createServer();
  reservation.listen(0, "127.0.0.1");
  await once(reservation, "listening");
  const port = reservation.address().port;
  await new Promise((resolve) => reservation.close(resolve));

  const env = { ...process.env, PORT: String(port) };
  delete env.SUPABASE_URL;
  delete env.SUPABASE_SERVICE_ROLE_KEY;
  delete env.APP_WRITE_TOKEN;
  if (mode !== "unconfigured") {
    env.SUPABASE_URL = "https://database.invalid";
    env.SUPABASE_SERVICE_ROLE_KEY = "test-placeholder";
  }
  if (mode === "configured") env.APP_WRITE_TOKEN = "test-placeholder";
  const child = spawn(process.execPath, ["server.mjs"], { env, stdio: ["ignore", "pipe", "pipe"] });
  try {
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Preview startup timed out")), 5000);
      child.stdout.once("data", () => { clearTimeout(timeout); resolve(); });
      child.once("error", (error) => { clearTimeout(timeout); reject(error); });
      child.once("exit", () => { clearTimeout(timeout); reject(new Error("Preview exited early")); });
    });
    for (const path of ["/", "/index.html", "/style.css?v=32", "/script.js?v=33", "/favicon.ico", "/favicon-32.png", "/assets/favicon.png"]) {
      const response = await fetch(`http://127.0.0.1:${port}${path}`);
      assert.equal(response.status, 200, path);
      assert.ok((await response.arrayBuffer()).byteLength > 0, path);
    }
    for (const path of ["/.env", "/.env.example", "/.env.production", "/.git/config", "/api/videos.js", "/server.mjs", "/package.json", "/supabase/schema.sql", "/assets/../.git/config", "/%2e%2e%2f.git/config"]) {
      const response = await fetch(`http://127.0.0.1:${port}${path}`);
      assert.equal(response.status, 404, path);
    }
    if (mode === "unconfigured") {
      assert.equal((await fetch(`http://127.0.0.1:${port}/api/videos`)).status, 503);
    } else if (mode === "write-disabled") {
      for (const method of ["GET", "POST", "PATCH", "DELETE"]) {
        const response = await fetch(`http://127.0.0.1:${port}/api/videos?id=test`, {
          method,
        });
        assert.equal(response.status, 503);
        assert.match((await response.json()).error, /同步密钥/);
      }
    } else {
      for (const method of ["POST", "PATCH"]) {
        const invalid = { url: "javascript:alert(1)", embedUrl: "javascript:alert(1)" };
        const response = await fetch(`http://127.0.0.1:${port}/api/videos?id=test`, {
          method,
          headers: { "Content-Type": "application/json", "x-app-token": "test-placeholder" },
          body: JSON.stringify(method === "POST" ? { videos: [invalid] } : invalid),
        });
        assert.equal(response.status, 400);
      }
      assert.equal((await fetch(`http://127.0.0.1:${port}/api/videos`, { method: "POST" })).status, 401);
      assert.equal((await fetch(`http://127.0.0.1:${port}/api/videos`)).status, 401);
      assert.equal((await fetch(`http://127.0.0.1:${port}/api/videos?library=friend`)).status, 400);
    }
    assert.equal((await fetch(`http://127.0.0.1:${port}/api/bilibili?bvid=invalid`)).status, 400);
  } finally {
    if (child.exitCode === null) {
      const exited = once(child, "exit");
      child.kill();
      await exited;
    }
  }
});
}
