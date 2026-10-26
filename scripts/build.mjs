import { mkdir, readFile, writeFile, copyFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

export function renderSocialMetadata(html, env = {}) {
  const domain = env.VERCEL_PROJECT_PRODUCTION_URL || env.VERCEL_URL;
  const address = env.SITE_URL || (domain ? `https://${domain}` : "");
  let tags = "<!-- Social URLs omitted: no deployment origin configured. -->";
  if (address) {
    const url = new URL(address);
    if (!["https:", "http:"].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== "/") {
      throw new Error("SITE_URL must be an HTTP(S) origin without credentials, path or query");
    }
    const origin = url.origin;
    tags = `<meta property="og:url" content="${origin}/" />\n    <meta property="og:image" content="${origin}/assets/favicon.png" />\n    <meta name="twitter:image" content="${origin}/assets/favicon.png" />`;
  }
  if (!html.includes("<!-- deployment-social-meta -->")) throw new Error("Missing social metadata marker");
  return html.replace("<!-- deployment-social-meta -->", tags);
}

async function build() {
  const root = new URL("../", import.meta.url);
  const output = new URL("public/", root);
  await mkdir(output, { recursive: true });
  const html = await readFile(new URL("index.html", root), "utf8");
  await writeFile(new URL("index.html", output), renderSocialMetadata(html, process.env));
  for (const file of ["style.css", "script.js"]) {
    await copyFile(new URL(file, root), new URL(file, output));
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await build();
