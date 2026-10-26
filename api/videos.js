import { validateVideoInput } from "../lib/video-validation.js";

const TABLE = "videos";
const DEFAULT_LIBRARY_KEY = "default";

export default async function handler(request, response) {
  response.setHeader("Cache-Control", "private, no-store");
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    response.status(503).json({ error: "Supabase is not configured" });
    return;
  }

  const libraryKey = DEFAULT_LIBRARY_KEY;
  const requestedLibrary = request.query.library || request.headers["x-library-key"];
  if (requestedLibrary && requestedLibrary !== DEFAULT_LIBRARY_KEY) {
    response.status(400).json({ error: "不再支持共享视频库。" });
    return;
  }

  if (!process.env.APP_WRITE_TOKEN?.trim()) {
    response.status(503).json({ error: "服务器未配置同步密钥。" });
    return;
  }
  if (!isAuthorized(request)) {
    response.status(401).json({ error: "同步密钥无效。" });
    return;
  }

  if (request.method === "GET") {
    await listVideos(response, libraryKey);
    return;
  }

  if (request.method === "POST") {
    if (!isAuthorized(request, libraryKey)) {
      response.status(401).json({ error: "Unauthorized" });
      return;
    }
    await createVideos(request, response, libraryKey);
    return;
  }

  if (request.method === "DELETE") {
    if (!isAuthorized(request, libraryKey)) {
      response.status(401).json({ error: "Unauthorized" });
      return;
    }
    await deleteVideo(request, response, libraryKey);
    return;
  }

  if (request.method === "PATCH") {
    if (!isAuthorized(request, libraryKey)) {
      response.status(401).json({ error: "Unauthorized" });
      return;
    }
    await updateVideo(request, response, libraryKey);
    return;
  }

  response.setHeader("Allow", "GET, POST, PATCH, DELETE");
  response.status(405).json({ error: "Method not allowed" });
}

async function listVideos(response, libraryKey) {
  const data = await supabaseRequest(`${TABLE}?library_key=eq.${encodeURIComponent(libraryKey)}&select=*&order=created_at.desc`);
  response.status(200).json(data.map(fromRow));
}

async function createVideos(request, response, libraryKey) {
  const body = parseBody(request.body);
  const videos = Array.isArray(body?.videos) ? body.videos : [];

  if (!videos.length) {
    response.status(400).json({ error: "No videos provided" });
    return;
  }

  let rows;
  try {
    rows = videos.map((video) => toRow(validateVideoInput(video), libraryKey));
  } catch (error) {
    response.status(400).json({ error: error.message });
    return;
  }
  const data = await supabaseRequest(`${TABLE}?on_conflict=library_key,url`, {
    method: "POST",
    headers: {
      Prefer: "resolution=ignore-duplicates,return=representation",
    },
    body: JSON.stringify(rows),
  });

  response.status(200).json(data.map(fromRow));
}

async function deleteVideo(request, response, libraryKey) {
  const id = request.query.id;

  if (!id) {
    response.status(400).json({ error: "Missing id" });
    return;
  }

  await supabaseRequest(`${TABLE}?id=eq.${encodeURIComponent(id)}&library_key=eq.${encodeURIComponent(libraryKey)}`, {
    method: "DELETE",
    headers: {
      Prefer: "return=minimal",
    },
  });

  response.status(204).end();
}

async function updateVideo(request, response, libraryKey) {
  const id = request.query.id;
  let body;
  try {
    body = validateVideoInput(parseBody(request.body), { partial: true });
  } catch (error) {
    response.status(400).json({ error: error.message });
    return;
  }

  if (!id) {
    response.status(400).json({ error: "Missing id" });
    return;
  }

  const updates = {};
  if (typeof body.title === "string" && body.title.trim()) updates.title = body.title.trim();
  if (typeof body.url === "string" && body.url.trim()) updates.url = body.url.trim();
  if (typeof body.category === "string") updates.category = body.category.trim() || "未分类";
  if (typeof body.thumbnail === "string") updates.thumbnail = body.thumbnail;
  if (typeof body.source === "string" && body.source.trim()) updates.source = body.source.trim();
  if (typeof body.embedUrl === "string" && body.embedUrl.trim()) updates.embed_url = body.embedUrl.trim();
  if (typeof body.kind === "string" && body.kind.trim()) updates.kind = body.kind.trim();

  if (!Object.keys(updates).length) {
    response.status(400).json({ error: "No updates provided" });
    return;
  }

  const data = await supabaseRequest(`${TABLE}?id=eq.${encodeURIComponent(id)}&library_key=eq.${encodeURIComponent(libraryKey)}`, {
    method: "PATCH",
    headers: {
      Prefer: "return=representation",
    },
    body: JSON.stringify(updates),
  });

  response.status(200).json(fromRow(data[0]));
}

async function supabaseRequest(path, options = {}) {
  const response = await fetch(`${process.env.SUPABASE_URL}/rest/v1/${path}`, {
    method: options.method || "GET",
    headers: {
      apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
    body: options.body,
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || "Supabase request failed");
  }

  if (response.status === 204) return null;
  return response.json();
}

function isAuthorized(request) {
  const token = process.env.APP_WRITE_TOKEN;
  if (!token?.trim()) return false;
  return request.headers["x-app-token"] === token;
}

function parseBody(body) {
  if (!body) return {};
  if (typeof body === "string") {
    try {
      return JSON.parse(body);
    } catch {
      return {};
    }
  }
  return body;
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
