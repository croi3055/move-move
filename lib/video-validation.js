export function safeHttpUrl(value) {
  if (typeof value !== "string" || /[\u0000-\u0020\u007f\\]/.test(value)) return "";
  try {
    const url = new URL(value);
    return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password ? url.href : "";
  } catch {
    return "";
  }
}

function safeThumbnail(value) {
  // Old clients stored generated placeholders. Regenerate them from the title instead.
  if (value === "" || value.startsWith("data:image/svg+xml")) return "";
  if (safeHttpUrl(value)) return value;
  if (!value.startsWith("/api/bilibili?")) throw new Error("封面地址必须是 HTTP(S) 地址。");
  const proxy = new URL(value, "https://validation.invalid");
  const cover = safeHttpUrl(proxy.searchParams.get("cover"));
  if (cover) {
    const host = new URL(cover).hostname;
    if (host === "hdslb.com" || host.endsWith(".hdslb.com")) {
      return `/api/bilibili?cover=${encodeURIComponent(cover)}`;
    }
  }
  throw new Error("无效的封面代理地址。");
}

export function validateVideoInput(input, { partial = false } = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("无效的视频信息。");
  const video = { ...input };
  if (!partial || Object.hasOwn(video, "url")) {
    if (!safeHttpUrl(video.url)) throw new Error("视频链接必须是有效的 HTTP(S) 地址。");
  }
  if (Object.hasOwn(video, "embedUrl") && video.embedUrl !== "") {
    if (!safeHttpUrl(video.embedUrl)) throw new Error("播放地址必须是有效的 HTTP(S) 地址。");
  }
  if (Object.hasOwn(video, "thumbnail")) {
    if (typeof video.thumbnail !== "string") throw new Error("无效的封面地址。");
    video.thumbnail = safeThumbnail(video.thumbnail);
  }
  if (Object.hasOwn(video, "kind") && !["iframe", "video", "external"].includes(video.kind)) {
    throw new Error("无效的播放类型。");
  }
  return video;
}
