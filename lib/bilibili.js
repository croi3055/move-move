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
  const assignment = /window\.__INITIAL_STATE__\s*=\s*/.exec(html);
  if (assignment) {
    // Read the JSON object independently of the script that follows it.
    const start = assignment.index + assignment[0].length;
    let depth = 0;
    let quoted = false;
    let escaped = false;
    for (let index = start; index < html.length; index++) {
      const char = html[index];
      if (quoted) {
        if (escaped) escaped = false;
        else if (char === "\\") escaped = true;
        else if (char === '"') quoted = false;
        continue;
      }
      if (char === '"') quoted = true;
      else if (char === "{") depth++;
      else if (char === "}" && --depth === 0) {
        try {
          const data = JSON.parse(html.slice(start, index + 1)).videoData;
          if (data?.bvid === bvid && data.pic) return data;
        } catch { /* Reject malformed data without executing page scripts. */ }
        break;
      }
    }
  }
  throw new Error("Bilibili page metadata unavailable");
}
