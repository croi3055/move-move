export default async function handler(request, response) {
  const cover = getFirstQueryValue(request.query.cover);
  if (cover) {
    await handleCoverProxy(cover, response);
    return;
  }

  const bvid = getFirstQueryValue(request.query.bvid);

  if (!bvid || !/^BV[a-zA-Z0-9]+$/.test(bvid)) {
    response.status(400).json({ code: -1, message: "Invalid bvid" });
    return;
  }

  const apiUrl = `https://api.bilibili.com/x/web-interface/view?bvid=${encodeURIComponent(bvid)}`;
  const upstream = await fetch(apiUrl, {
    headers: {
      "User-Agent": "Mozilla/5.0",
      Referer: "https://www.bilibili.com/",
    },
  });

  if (!upstream.ok) {
    response.status(upstream.status).json({ code: -1, message: "Bilibili metadata request failed" });
    return;
  }

  const payload = await upstream.json();
  const data = payload.data;

  if (!data) {
    response.status(404).json({ code: -1, message: "Bilibili video not found" });
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
  const safeCoverUrl = getSafeBilibiliCoverUrl(coverUrl);

  if (!safeCoverUrl) {
    response.status(400).json({ code: -1, message: "Invalid cover url" });
    return;
  }

  const upstream = await fetch(safeCoverUrl, {
    headers: {
      "User-Agent": "Mozilla/5.0",
      Referer: "https://www.bilibili.com/",
    },
  });

  if (!upstream.ok) {
    response.status(upstream.status).json({ code: -1, message: "Bilibili cover request failed" });
    return;
  }

  const contentType = upstream.headers.get("content-type") || "image/jpeg";
  const imageBuffer = Buffer.from(await upstream.arrayBuffer());

  response.setHeader("Cache-Control", "s-maxage=86400, stale-while-revalidate=604800");
  response.setHeader("Content-Type", contentType);
  response.status(200).send(imageBuffer);
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

function getFirstQueryValue(value) {
  return Array.isArray(value) ? value[0] : value;
}
