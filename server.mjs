import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";

const root = process.cwd();
const port = Number(process.env.PORT || 4173);
const DEFAULT_LIBRARY_KEY = "default";

const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
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
  const coverUrl = url.searchParams.get("cover") || "";
  if (coverUrl) {
    await handleBilibiliCoverProxy(coverUrl, response);
    return;
  }

  const bvid = url.searchParams.get("bvid") || "";

  if (!/^BV[a-zA-Z0-9]+$/.test(bvid)) {
    response.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
    response.end(JSON.stringify({ code: -1, message: "Invalid bvid" }));
    return;
  }

  const upstream = await fetch(`https://api.bilibili.com/x/web-interface/view?bvid=${encodeURIComponent(bvid)}`, {
    headers: {
      Referer: "https://www.bilibili.com/",
      "User-Agent": "Mozilla/5.0",
    },
  });

  if (!upstream.ok) {
    response.writeHead(upstream.status, { "Content-Type": "application/json; charset=utf-8" });
    response.end(JSON.stringify({ code: -1, message: "Bilibili metadata request failed" }));
    return;
  }

  const payload = await upstream.json();
  const data = payload.data;

  if (!data) {
    response.writeHead(404, { "Content-Type": "application/json; charset=utf-8" });
    response.end(JSON.stringify({ code: -1, message: "Bilibili video not found" }));
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
  const safeCoverUrl = getSafeBilibiliCoverUrl(coverUrl);

  if (!safeCoverUrl) {
    response.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
    response.end(JSON.stringify({ code: -1, message: "Invalid cover url" }));
    return;
  }

  const upstream = await fetch(safeCoverUrl, {
    headers: {
      Referer: "https://www.bilibili.com/",
      "User-Agent": "Mozilla/5.0",
    },
  });

  if (!upstream.ok) {
    response.writeHead(upstream.status, { "Content-Type": "application/json; charset=utf-8" });
    response.end(JSON.stringify({ code: -1, message: "Bilibili cover request failed" }));
    return;
  }

  const imageBuffer = Buffer.from(await upstream.arrayBuffer());
  response.writeHead(200, {
    "Cache-Control": "public, max-age=86400",
    "Content-Type": upstream.headers.get("content-type") || "image/jpeg",
  });
  response.end(imageBuffer);
}

function getSafeBilibiliCoverUrl(coverUrl) {
  try {
    const parsedUrl = new URL(coverUrl.startsWith("//") ? `https:${coverUrl}` : coverUrl);
    const isAllowedHost = parsedUrl.hostname === "hdslb.com" || parsedUrl.hostname.endsWith(".hdslb.com");
    const isAllowedProtocol = parsedUrl.protocol === "https:" || parsedUrl.protocol === "http:";
    if (!isAllowedHost || !isAllowedProtocol) return "";
    parsedUrl.protocol = "https:";
    return parsedUrl.toString();
  } catch {
    return "";
  }
}

async function serveStaticFile(url, response) {
  const requestedPath = url.pathname === "/" ? "/index.html" : url.pathname;
  const filePath = normalize(join(root, decodeURIComponent(requestedPath)));

  if (!filePath.startsWith(root)) {
    response.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Forbidden");
    return;
  }

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

  const libraryKey = getLibraryKey(request, url);

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

    const data = await supabaseRequest("videos?on_conflict=library_key,url", {
      method: "POST",
      headers: {
        Prefer: "resolution=merge-duplicates,return=representation",
      },
      body: JSON.stringify(videos.map((video) => toRow(video, libraryKey))),
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

    const body = await readJsonBody(request);
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

function isAuthorized(request, libraryKey) {
  const token = process.env.APP_WRITE_TOKEN;
  if (!token) return true;
  if (request.headers["x-app-token"] === token) return true;
  return libraryKey !== DEFAULT_LIBRARY_KEY && normalizeLibraryKey(request.headers["x-library-key"]) === libraryKey;
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
  response.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
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

function getLibraryKey(request, url) {
  return normalizeLibraryKey(url.searchParams.get("library") || request.headers["x-library-key"]) || DEFAULT_LIBRARY_KEY;
}

function normalizeLibraryKey(value) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 64);
}
