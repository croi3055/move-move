import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { fetchBilibiliVideo } from "./lib/bilibili.js";
import { allowMetadataRequest, fetchCover } from "./lib/cover-proxy.js";
import { validateVideoInput } from "./lib/video-validation.js";

const root = process.cwd();
const port = Number(process.env.PORT || 4173);
const DEFAULT_LIBRARY_KEY = "default";

const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://${request.headers.host}`);

    if (url.pathname === "/api/bilibili") {
      await handleBilibiliMetadata(url, response);
      return;
    }

    if (url.pathname === "/api/videos") {
      await handleVideosApi(request, url, response);
      return;
    }

    await serveStaticFile(url, response);
  } catch {
    response.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Internal Server Error");
  }
}).listen(port, () => {
  console.log(`Preview running at http://127.0.0.1:${port}/`);
});

async function handleBilibiliMetadata(url, response) {
  if (!allowMetadataRequest(response.socket?.remoteAddress)) {
    response.writeHead(429, { "Retry-After": "60", "Cache-Control": "no-store" });
    response.end("Too many requests"); return;
  }
  const coverUrl = url.searchParams.get("cover") || "";
  if (coverUrl) {
    await handleBilibiliCoverProxy(coverUrl, response);
    return;
  }

  const bvid = url.searchParams.get("bvid") || "";

  if (!/^BV[a-zA-Z0-9]{10}$/.test(bvid)) {
    response.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
    response.end(JSON.stringify({ code: -1, message: "Invalid bvid" }));
    return;
  }

  let data;
  try {
    data = await fetchBilibiliVideo(bvid);
  } catch {
    response.writeHead(502, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
    response.end(JSON.stringify({ code: -1, message: "Bilibili metadata temporarily unavailable" }));
    return;
  }

  response.writeHead(200, {
    "Cache-Control": "public, max-age=86400",
    "Content-Type": "application/json; charset=utf-8",
  });
  response.end(
    JSON.stringify({
      code: 0,
      data: {
        bvid: data.bvid,
        cid: data.cid,
        pic: data.pic,
        title: data.title,
      },
    }),
  );
}

async function handleBilibiliCoverProxy(coverUrl, response) {
  try {
    const { type, buffer } = await fetchCover(coverUrl);
    response.writeHead(200, { "Cache-Control": "public, max-age=86400", "Content-Type": type, "X-Content-Type-Options": "nosniff" });
    response.end(buffer);
  } catch {
    response.writeHead(502, { "Cache-Control": "no-store" });
    response.end("Cover unavailable");
  }
}

async function serveStaticFile(url, response) {
  const requestedPath = url.pathname === "/" ? "/index.html" : url.pathname;
  // Never expose the project directory itself: it may contain credentials and Git metadata.
  const staticFiles = {
    "/index.html": "index.html",
    "/style.css": "style.css",
    "/script.js": "script.js",
    "/favicon.ico": "public/favicon.ico",
    "/favicon-32.png": "public/favicon-32.png",
    "/assets/favicon.png": "public/assets/favicon.png",
  };
  const relativePath = Object.hasOwn(staticFiles, requestedPath) ? staticFiles[requestedPath] : "";
  if (!relativePath) {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Not Found");
    return;
  }
  const filePath = join(root, relativePath);

  try {
    const content = await readFile(filePath);
    response.writeHead(200, {
      "Content-Type": mimeTypes[extname(filePath)] || "application/octet-stream",
    });
    response.end(content);
  } catch {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Not Found");
  }
}

async function handleVideosApi(request, url, response) {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    sendJson(response, 503, { error: "Supabase is not configured" });
    return;
  }

  const libraryKey = DEFAULT_LIBRARY_KEY;
  const requestedLibrary = url.searchParams.get("library") || request.headers["x-library-key"];
  if (requestedLibrary && requestedLibrary !== DEFAULT_LIBRARY_KEY) {
    sendJson(response, 400, { error: "不再支持共享视频库。" });
    return;
  }

  if (!process.env.APP_WRITE_TOKEN?.trim()) {
    sendJson(response, 503, { error: "服务器未配置同步密钥。" });
    return;
  }
  if (!isAuthorized(request)) {
    sendJson(response, 401, { error: "同步密钥无效。" });
    return;
  }

  if (request.method === "GET") {
    const data = await supabaseRequest(`videos?library_key=eq.${encodeURIComponent(libraryKey)}&select=*&order=created_at.desc`);
    sendJson(response, 200, data.map(fromRow));
    return;
  }

  if (request.method === "POST") {
    if (!isAuthorized(request, libraryKey)) {
      sendJson(response, 401, { error: "Unauthorized" });
      return;
    }

    const body = await readJsonBody(request);
    const videos = Array.isArray(body.videos) ? body.videos : [];

    if (!videos.length) {
      sendJson(response, 400, { error: "No videos provided" });
      return;
    }

    let rows;
    try {
      rows = videos.map((video) => toRow(validateVideoInput(video), libraryKey));
    } catch (error) {
      sendJson(response, 400, { error: error.message });
      return;
    }
    const data = await supabaseRequest("videos?on_conflict=library_key,url", {
      method: "POST",
      headers: {
        Prefer: "resolution=ignore-duplicates,return=representation",
      },
      body: JSON.stringify(rows),
    });
    sendJson(response, 200, data.map(fromRow));
    return;
  }

  if (request.method === "DELETE") {
    if (!isAuthorized(request, libraryKey)) {
      sendJson(response, 401, { error: "Unauthorized" });
      return;
    }

    const id = url.searchParams.get("id");
    if (!id) {
      sendJson(response, 400, { error: "Missing id" });
      return;
    }

    await supabaseRequest(`videos?id=eq.${encodeURIComponent(id)}&library_key=eq.${encodeURIComponent(libraryKey)}`, {
      method: "DELETE",
      headers: {
        Prefer: "return=minimal",
      },
    });
    response.writeHead(204);
    response.end();
    return;
  }

  if (request.method === "PATCH") {
    if (!isAuthorized(request, libraryKey)) {
      sendJson(response, 401, { error: "Unauthorized" });
      return;
    }

    const id = url.searchParams.get("id");
    if (!id) {
      sendJson(response, 400, { error: "Missing id" });
      return;
    }

    let body;
    try {
      body = validateVideoInput(await readJsonBody(request), { partial: true });
    } catch (error) {
      sendJson(response, 400, { error: error.message });
      return;
    }
    const updates = {};
    if (typeof body.title === "string" && body.title.trim()) updates.title = body.title.trim();
    if (typeof body.category === "string") updates.category = body.category.trim() || "未分类";

    if (!Object.keys(updates).length) {
      sendJson(response, 400, { error: "No updates provided" });
      return;
    }

    const data = await supabaseRequest(`videos?id=eq.${encodeURIComponent(id)}&library_key=eq.${encodeURIComponent(libraryKey)}`, {
      method: "PATCH",
      headers: {
        Prefer: "return=representation",
      },
      body: JSON.stringify(updates),
    });
    sendJson(response, 200, fromRow(data[0]));
    return;
  }

  response.writeHead(405, { Allow: "GET, POST, PATCH, DELETE" });
  response.end("Method Not Allowed");
}

async function supabaseRequest(path, options = {}) {
  const upstream = await fetch(`${process.env.SUPABASE_URL}/rest/v1/${path}`, {
    method: options.method || "GET",
    headers: {
      apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
    body: options.body,
  });

  if (!upstream.ok) {
    throw new Error(await upstream.text());
  }

  if (upstream.status === 204) return null;
  return upstream.json();
}

function isAuthorized(request) {
  const token = process.env.APP_WRITE_TOKEN;
  if (!token?.trim()) return false;
  return request.headers["x-app-token"] === token;
}

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (error) {
        reject(error);
      }
    });
    request.on("error", reject);
  });
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "private, no-store" });
  response.end(JSON.stringify(payload));
}

function toRow(video, libraryKey) {
  return {
    id: video.id,
    library_key: libraryKey,
    url: video.url,
    title: video.title,
    category: video.category || "未分类",
    thumbnail: video.thumbnail,
    source: video.source,
    embed_url: video.embedUrl,
    kind: video.kind || "iframe",
    created_at: video.createdAt ? new Date(video.createdAt).toISOString() : new Date().toISOString(),
  };
}

function fromRow(row) {
  return {
    id: row.id,
    libraryKey: row.library_key || DEFAULT_LIBRARY_KEY,
    url: row.url,
    title: row.title,
    category: row.category,
    thumbnail: row.thumbnail,
    source: row.source,
    embedUrl: row.embed_url,
    kind: row.kind,
    createdAt: new Date(row.created_at).getTime(),
  };
}
