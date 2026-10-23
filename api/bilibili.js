import { fetchBilibiliVideo } from "../lib/bilibili.js";
import { allowMetadataRequest, fetchCover } from "../lib/cover-proxy.js";

export default async function handler(request, response) {
  if (request.method && request.method !== "GET") {
    response.status(405).json({ message: "GET only" }); return;
  }
  if (!allowMetadataRequest(request.headers?.["x-forwarded-for"] || request.socket?.remoteAddress)) {
    response.setHeader("Retry-After", "60");
    response.setHeader("Cache-Control", "no-store");
    response.status(429).json({ message: "Too many requests" }); return;
  }
  const cover = getFirstQueryValue(request.query.cover);
  if (cover) {
    await handleCoverProxy(cover, response);
    return;
  }

  const bvid = getFirstQueryValue(request.query.bvid);

  if (!bvid || !/^BV[a-zA-Z0-9]{10}$/.test(bvid)) {
    response.status(400).json({ code: -1, message: "Invalid bvid" });
    return;
  }

  let data;
  try {
    data = await fetchBilibiliVideo(bvid);
  } catch {
    response.setHeader("Cache-Control", "no-store");
    response.status(502).json({ code: -1, message: "Bilibili metadata temporarily unavailable" });
    return;
  }

  response.setHeader("Cache-Control", "s-maxage=86400, stale-while-revalidate=604800");
  response.status(200).json({
    code: 0,
    data: {
      bvid: data.bvid,
      cid: data.cid,
      pic: data.pic,
      title: data.title,
    },
  });
}

async function handleCoverProxy(coverUrl, response) {
  try {
    const { type, buffer } = await fetchCover(coverUrl);
    response.setHeader("Cache-Control", "s-maxage=86400, stale-while-revalidate=604800");
    response.setHeader("Content-Type", type);
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.status(200).send(buffer);
  } catch {
    response.setHeader("Cache-Control", "no-store");
    response.status(502).json({ message: "Cover unavailable" });
  }
}

function getFirstQueryValue(value) {
  return Array.isArray(value) ? value[0] : value;
}
