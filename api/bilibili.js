export default async function handler(request, response) {
  const { bvid } = request.query;

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
