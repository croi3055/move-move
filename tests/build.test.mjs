import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { renderSocialMetadata } from "../scripts/build.mjs";

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
test("each deployment generates its own social URLs", () => {
  for (const domain of ["d1d-public.vercel.app", "owner.example.com"]) {
    const result = renderSocialMetadata(html, { VERCEL_PROJECT_PRODUCTION_URL: domain, VERCEL_URL: "preview.example.com" });
    assert.ok(result.includes(`content="https://${domain}/"`));
    assert.ok(result.includes(`content="https://${domain}/assets/favicon.png"`));
    assert.ok(!result.includes("owner.example.com") || domain === "owner.example.com");
    assert.ok(!result.includes("preview.example.com"));
  }
});
test("explicit site overrides defaults; missing domain never leaks another site", () => {
  assert.ok(renderSocialMetadata(html, { SITE_URL: "https://custom.example.com", VERCEL_URL: "preview.example.com" }).includes("https://custom.example.com/"));
  assert.ok(renderSocialMetadata(html, { VERCEL_URL: "preview.example.com" }).includes("https://preview.example.com/"));
  assert.ok(!renderSocialMetadata(html).includes('property="og:url"'));
  for (const SITE_URL of ["javascript:alert(1)", "https://user:pass@example.com", "https://example.com/path", "https://example.com/?token=secret"]) {
    assert.throws(() => renderSocialMetadata(html, { SITE_URL }));
  }
});
