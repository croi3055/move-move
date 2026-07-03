const TABLE = "videos";

export default async function handler(request, response) {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    response.status(503).json({ error: "Supabase is not configured" });
    return;
  }

  if (request.method === "GET") {
    await listVideos(response);
    return;
  }

  if (request.method === "POST") {
    if (!isAuthorized(request)) {
      response.status(401).json({ error: "Unauthorized" });
      return;
    }
    await createVideos(request, response);
    return;
  }

  if (request.method === "DELETE") {
    if (!isAuthorized(request)) {
      response.status(401).json({ error: "Unauthorized" });
      return;
    }
    await deleteVideo(request, response);
    return;
  }

  if (request.method === "PATCH") {
    if (!isAuthorized(request)) {
      response.status(401).json({ error: "Unauthorized" });
      return;
    }
    await updateVideo(request, response);
    return;
  }

  response.setHeader("Allow", "GET, POST, PATCH, DELETE");
  response.status(405).json({ error: "Method not allowed" });
}

async function listVideos(response) {
  const data = await supabaseRequest(`${TABLE}?select=*&order=created_at.desc`);
  response.status(200).json(data.map(fromRow));
}

async function createVideos(request, response) {
  const body = parseBody(request.body);
  const videos = Array.isArray(body?.videos) ? body.videos : [];

  if (!videos.length) {
    response.status(400).json({ error: "No videos provided" });
    return;
  }

  const rows = videos.map(toRow);
  const data = await supabaseRequest(`${TABLE}?on_conflict=url`, {
    method: "POST",
    headers: {
      Prefer: "resolution=merge-duplicates,return=representation",
    },
    body: JSON.stringify(rows),
  });

  response.status(200).json(data.map(fromRow));
}

async function deleteVideo(request, response) {
  const id = request.query.id;

  if (!id) {
    response.status(400).json({ error: "Missing id" });
    return;
  }

  await supabaseRequest(`${TABLE}?id=eq.${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: {
      Prefer: "return=minimal",
    },
  });

  response.status(204).end();
}

async function updateVideo(request, response) {
  const id = request.query.id;
  const body = parseBody(request.body);

  if (!id) {
    response.status(400).json({ error: "Missing id" });
    return;
  }

  const updates = {};
  if (typeof body.title === "string" && body.title.trim()) updates.title = body.title.trim();
  if (typeof body.category === "string") updates.category = body.category.trim() || "未分类";

  if (!Object.keys(updates).length) {
    response.status(400).json({ error: "No updates provided" });
    return;
  }

  const data = await supabaseRequest(`${TABLE}?id=eq.${encodeURIComponent(id)}`, {
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
  if (!token) return true;
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

function toRow(video) {
  return {
    id: video.id,
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
