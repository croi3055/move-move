const headers = {
  "User-Agent": "Mozilla/5.0",
  Referer: "https://www.bilibili.com/",
};

export async function fetchBilibiliVideo(bvid) {
  try {
    const response = await fetch(`https://api.bilibili.com/x/web-interface/view?bvid=${encodeURIComponent(bvid)}`, {
      headers,
      signal: AbortSignal.timeout(4000),
    });
    if (response.ok) {
      const payload = await response.json();
      if (payload.code === 0 && payload.data?.pic) return payload.data;
    }
  } catch {
    // The API can reject datacenter IPs while the public video page still works.
  }

  const response = await fetch(`https://www.bilibili.com/video/${encodeURIComponent(bvid)}`, {
    headers,
    signal: AbortSignal.timeout(4000),
  });
  if (!response.ok) throw new Error("Bilibili page request failed");
  return parseBilibiliPage(await response.text(), bvid);
}

export function parseBilibiliPage(html, bvid) {
  const state = html.match(/window\.__INITIAL_STATE__\s*=\s*({[\s\S]*?})\s*;\s*\(function/);
  if (state) {
    const data = JSON.parse(state[1]).videoData;
    if (data?.bvid === bvid && data.pic) return data;
  }
  throw new Error("Bilibili page metadata unavailable");
}
