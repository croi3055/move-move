const MAX_BYTES = 5 * 1024 * 1024;
const requests = new Map();

// Per-instance guard only; a deployment-wide quota belongs at the hosting edge.
export function allowMetadataRequest(client) {
  const now = Date.now();
  for (const [key, value] of requests) if (value.until <= now) requests.delete(key);
  const key = String(client || "unknown").slice(0, 200);
  const value = requests.get(key) || { count: 0, until: now + 60000 };
  if (!requests.has(key) && requests.size >= 5000) return false;
  requests.set(key, value);
  return ++value.count <= 120;
}

export async function fetchCover(value) {
  const url = new URL(value.startsWith("//") ? `https:${value}` : value);
  if (!/^(https?:)$/.test(url.protocol) || !/^(?:[a-z0-9-]+\.)*hdslb\.com$/i.test(url.hostname) ||
      url.username || url.password || url.port) throw new Error("Invalid cover URL");
  url.protocol = "https:";
  const response = await fetch(url, {
    redirect: "error", signal: AbortSignal.timeout(6000),
    headers: { "User-Agent": "Mozilla/5.0", Referer: "https://www.bilibili.com/" },
  });
  const type = (response.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
  if (!response.ok || !["image/jpeg", "image/png", "image/webp", "image/gif", "image/avif"].includes(type) ||
      Number(response.headers.get("content-length")) > MAX_BYTES) {
    await response.body?.cancel();
    throw new Error("Invalid cover response");
  }
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > MAX_BYTES) throw new Error("Cover too large");
      chunks.push(value);
    }
  } finally {
    await reader.cancel();
  }
  if (!size) throw new Error("Empty cover");
  return { type, buffer: Buffer.concat(chunks) };
}
