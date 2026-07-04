const LEGACY_STORAGE_KEY = "exercise-video-library:v1";
const STORAGE_PREFIX = "exercise-video-library:v2";
const LIBRARY_KEY_STORAGE = "exercise-video-library:library-key";
const DEFAULT_LIBRARY_KEY = "default";
const BILIBILI_METADATA_PROXY = "/api/bilibili";
const VIDEOS_API = "/api/videos";

const state = {
  libraryKey: getInitialLibraryKey(),
  videos: [],
  activeId: null,
  activeCategory: "all",
  storageMode: "local",
  writeToken: localStorage.getItem("exercise-video-library:write-token") || "",
};

const elements = {
  form: document.querySelector("#videoForm"),
  urlsInput: document.querySelector("#urlsInput"),
  categoryInput: document.querySelector("#categoryInput"),
  categoryOptions: document.querySelector("#categoryOptions"),
  categoryFilter: document.querySelector("#categoryFilter"),
  searchInput: document.querySelector("#searchInput"),
  grid: document.querySelector("#videoGrid"),
  emptyState: document.querySelector("#emptyState"),
  template: document.querySelector("#videoCardTemplate"),
  statusLine: document.querySelector("#statusLine"),
  videoCount: document.querySelector("#videoCount"),
  exportButton: document.querySelector("#exportButton"),
  copyLibraryLinkButton: document.querySelector("#copyLibraryLinkButton"),
  libraryButton: document.querySelector("#libraryButton"),
  openAddButton: document.querySelector("#openAddButton"),
  closeAddButton: document.querySelector("#closeAddButton"),
  addModal: document.querySelector("#addModal"),
  playerModal: document.querySelector("#playerModal"),
  editModal: document.querySelector("#editModal"),
  closePlayerButton: document.querySelector("#closePlayerButton"),
  closeEditButton: document.querySelector("#closeEditButton"),
  editForm: document.querySelector("#editForm"),
  editTitleInput: document.querySelector("#editTitleInput"),
  editCategoryInput: document.querySelector("#editCategoryInput"),
  editStatusLine: document.querySelector("#editStatusLine"),
  playerSource: document.querySelector("#playerSource"),
  playerTitle: document.querySelector("#playerTitle"),
  playerFrame: document.querySelector("#playerFrame"),
};

state.videos = loadVideos();

elements.form.addEventListener("submit", handleSubmit);
elements.exportButton.addEventListener("click", exportVideos);
elements.copyLibraryLinkButton.addEventListener("click", copyLibraryLink);
elements.libraryButton.addEventListener("click", switchLibrary);
elements.openAddButton.addEventListener("click", openAddModal);
elements.closeAddButton.addEventListener("click", closeAddModal);
elements.closePlayerButton.addEventListener("click", closePlayerModal);
elements.closeEditButton.addEventListener("click", closeEditModal);
elements.addModal.addEventListener("click", handleBackdropClick);
elements.playerModal.addEventListener("click", handleBackdropClick);
elements.editModal.addEventListener("click", handleBackdropClick);
elements.editForm.addEventListener("submit", handleEditSubmit);
elements.searchInput.addEventListener("input", render);
document.addEventListener("keydown", handleKeydown);

initializeApp();

async function initializeApp() {
  renderLibraryKey();
  render();
  await loadRemoteVideos();
  await hydrateSavedBilibiliVideos();
}

async function switchLibrary() {
  const nextLibraryKey = normalizeLibraryKey(window.prompt("输入库名/暗号", state.libraryKey));
  if (!nextLibraryKey || nextLibraryKey === state.libraryKey) return;

  state.libraryKey = nextLibraryKey;
  state.activeCategory = "all";
  localStorage.setItem(LIBRARY_KEY_STORAGE, state.libraryKey);
  setLibraryUrlParam(state.libraryKey);
  state.videos = loadVideos();
  renderLibraryKey();
  render();
  await loadRemoteVideos();
  await hydrateSavedBilibiliVideos();
}

async function handleSubmit(event) {
  event.preventDefault();

  const entries = parseVideoEntries(elements.urlsInput.value);
  if (!entries.length) {
    setStatus("先贴至少一个视频链接。");
    return;
  }

  const category = normalizeCategory(elements.categoryInput.value);
  const existingUrls = new Set(state.videos.map((video) => video.url));
  const uniqueEntries = entries.filter((entry) => !existingUrls.has(entry.url));
  const duplicateCount = entries.length - uniqueEntries.length;

  if (!uniqueEntries.length) {
    setStatus("这些链接已经都保存过了。");
    return;
  }

  elements.form.querySelector("button[type='submit']").disabled = true;
  setStatus(`正在整理 ${uniqueEntries.length} 个视频...`);

  const videos = [];
  for (let index = 0; index < uniqueEntries.length; index += 1) {
    const entry = uniqueEntries[index];
    const url = entry.url;
    setStatus(`正在整理 ${index + 1}/${uniqueEntries.length}...`);
    const metadata = await getVideoMetadata(url);
    videos.push(createVideo(entry, metadata, category));
  }

  try {
    const savedVideos = await persistVideos(videos);
    state.videos = mergeVideos(savedVideos, state.videos);
    saveVideos();
    elements.form.querySelector("button[type='submit']").disabled = false;
    clearForm(false);
    closeAddModal();
    setStatus("");
    render();
  } catch (error) {
    elements.form.querySelector("button[type='submit']").disabled = false;
    setStatus(error.message || "保存失败，请稍后再试。");
    return;
  }

  if (duplicateCount > 0) {
    window.setTimeout(() => alert(`已保存 ${videos.length} 个视频，跳过 ${duplicateCount} 个重复链接。`), 0);
  }
}

async function exportVideos() {
  if (!state.videos.length) {
    window.alert("还没有可以导出的视频。");
    return;
  }

  const text = state.videos
    .map((video) => `【${video.title || "未命名视频"}】 ${video.url}`)
    .join("\n");

  try {
    await navigator.clipboard.writeText(text);
    window.alert(`已复制 ${state.videos.length} 个标题和链接。`);
  } catch {
    downloadExportFile(text);
  }
}

function downloadExportFile(text) {
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `动一动-视频导出-${new Date().toISOString().slice(0, 10)}.txt`;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

async function copyLibraryLink() {
  const url = getLibraryUrl(state.libraryKey);

  try {
    await navigator.clipboard.writeText(url);
    window.alert("已复制当前跟练页面链接。");
  } catch {
    window.prompt("复制这个链接分享给朋友", url);
  }
}

function getLibraryUrl(libraryKey) {
  const url = new URL(window.location.href);
  url.hash = "";

  if (libraryKey === DEFAULT_LIBRARY_KEY) {
    url.searchParams.delete("library");
  } else {
    url.searchParams.set("library", libraryKey);
  }

  return url.toString();
}

async function getVideoMetadata(url) {
  const parsed = parseVideoUrl(url);
  const fallback = {
    title: "",
    thumbnail: parsed.thumbnail || "",
    source: parsed.source,
    embedUrl: parsed.embedUrl,
    kind: parsed.kind,
  };

  if (parsed.source === "Bilibili" && parsed.bvid) {
    return getBilibiliMetadata(parsed, fallback);
  }

  const oembedUrl = getOembedUrl(url, parsed.source);
  if (!oembedUrl) return fallback;

  try {
    const response = await fetch(oembedUrl);
    if (!response.ok) return fallback;
    const data = await response.json();
    return {
      ...fallback,
      title: data.title || fallback.title,
      thumbnail: data.thumbnail_url || fallback.thumbnail,
    };
  } catch {
    return fallback;
  }
}

function parseVideoUrl(url) {
  let parsedUrl;
  try {
    parsedUrl = new URL(url);
  } catch {
    return genericVideo(url);
  }

  const host = parsedUrl.hostname.replace(/^www\./, "");

  if (host.includes("youtube.com") || host.includes("youtu.be")) {
    const id = getYouTubeId(parsedUrl);
    return {
      source: "YouTube",
      kind: "iframe",
      embedUrl: id ? `https://www.youtube.com/embed/${id}` : url,
      thumbnail: id ? `https://img.youtube.com/vi/${id}/hqdefault.jpg` : "",
    };
  }

  if (host.includes("vimeo.com")) {
    const id = parsedUrl.pathname.split("/").filter(Boolean).at(-1);
    return {
      source: "Vimeo",
      kind: "iframe",
      embedUrl: id ? `https://player.vimeo.com/video/${id}` : url,
      thumbnail: "",
    };
  }

  if (host.includes("bilibili.com") || host.includes("b23.tv")) {
    const bvid = url.match(/BV[a-zA-Z0-9]+/)?.[0];
    return {
      source: "Bilibili",
      kind: "iframe",
      bvid,
      embedUrl: bvid ? makeBilibiliEmbedUrl({ bvid }) : url,
      thumbnail: "",
    };
  }

  if (isXiaohongshuHost(host)) {
    return {
      source: "小红书",
      kind: "external",
      embedUrl: url,
      thumbnail: "",
    };
  }

  if (isXiaoetongHost(host)) {
    return {
      source: "小鹅通",
      kind: "external",
      embedUrl: url,
      thumbnail: "",
    };
  }

  return genericVideo(url, host);
}

function isXiaohongshuHost(host) {
  return host.includes("xiaohongshu.com") || host.includes("xhslink.com") || host.includes("xhs.cn");
}

function isXiaoetongHost(host) {
  return (
    host.includes("xet.pomoho.com") ||
    host.includes("xiaoeknow.com") ||
    host.includes("xiaoe-tech.com") ||
    host.includes("xet.tech")
  );
}

function genericVideo(url, host = "视频链接") {
  const isDirectVideo = /\.(mp4|webm|ogg)(\?.*)?$/i.test(url);
  return {
    source: host,
    kind: isDirectVideo ? "video" : "iframe",
    embedUrl: url,
    thumbnail: "",
  };
}

function getYouTubeId(parsedUrl) {
  if (parsedUrl.hostname.includes("youtu.be")) {
    return parsedUrl.pathname.slice(1);
  }
  if (parsedUrl.pathname.startsWith("/shorts/")) {
    return parsedUrl.pathname.split("/")[2];
  }
  if (parsedUrl.pathname.startsWith("/embed/")) {
    return parsedUrl.pathname.split("/")[2];
  }
  return parsedUrl.searchParams.get("v");
}

function getOembedUrl(url, source) {
  if (source === "YouTube") {
    return `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(url)}`;
  }
  if (source === "Vimeo") {
    return `https://vimeo.com/api/oembed.json?url=${encodeURIComponent(url)}`;
  }
  return "";
}

async function getBilibiliMetadata(parsed, fallback) {
  try {
    const payload = await fetchBilibiliPayload(parsed.bvid);
    return mergeBilibiliPayload(parsed, fallback, payload);
  } catch {
    return fallback;
  }
}

async function fetchBilibiliPayload(bvid) {
  const encodedBvid = encodeURIComponent(bvid);
  const apiUrl = `https://api.bilibili.com/x/web-interface/view?bvid=${encodedBvid}`;
  const proxyUrl = `${BILIBILI_METADATA_PROXY}?bvid=${encodedBvid}`;
  const attempts = [
    () => fetchJson(proxyUrl, { allowJsonp: false }),
    () => fetchJson(apiUrl, { allowJsonp: false }),
    () => fetchJson(apiUrl, { allowJsonp: true }),
  ];

  for (const attempt of attempts) {
    try {
      const payload = await attempt();
      if (payload?.data) return payload;
    } catch {
      // Try the next metadata path.
    }
  }

  throw new Error("bilibili metadata unavailable");
}

async function fetchJson(url, options = {}) {
  const { allowJsonp = true } = options;
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 5000);

  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error("metadata request failed");
    return response.json();
  } catch {
    if (!allowJsonp) throw new Error("metadata request failed");
    return fetchJsonp(url);
  } finally {
    window.clearTimeout(timeout);
  }
}

function fetchJsonp(url) {
  return new Promise((resolve, reject) => {
    const callbackName = `__biliCallback_${Date.now()}_${Math.random().toString(16).slice(2)}`;
    const script = document.createElement("script");
    const timeout = window.setTimeout(() => {
      cleanup();
      reject(new Error("metadata jsonp timed out"));
    }, 5000);

    function cleanup() {
      window.clearTimeout(timeout);
      script.remove();
      delete window[callbackName];
    }

    window[callbackName] = (payload) => {
      cleanup();
      resolve(payload);
    };

    const separator = url.includes("?") ? "&" : "?";
    script.src = `${url}${separator}callback=${callbackName}`;
    script.onerror = () => {
      cleanup();
      reject(new Error("metadata jsonp failed"));
    };
    document.head.append(script);
  });
}

function mergeBilibiliPayload(parsed, fallback, payload) {
  const data = payload?.data;
  if (!data) return fallback;

  return {
    ...fallback,
    title: data.title || fallback.title,
    thumbnail: normalizeBilibiliImageUrl(data.pic) || fallback.thumbnail,
    embedUrl: makeBilibiliEmbedUrl({
      bvid: parsed.bvid,
      cid: data.cid,
    }),
  };
}

function makeBilibiliEmbedUrl({ bvid, cid }) {
  const params = new URLSearchParams({
    bvid,
    as_wide: "1",
    auto_play: "1",
    autoplay: "1",
    danmaku: "0",
    hideCoverInfo: "1",
    is_muted: "0",
    isMuted: "0",
    muted: "0",
    p: "1",
    volume: "1",
  });

  if (cid) params.set("cid", cid);
  return `https://www.bilibili.com/blackboard/html5mobileplayer.html?${params.toString()}`;
}

function normalizeBilibiliImageUrl(url) {
  if (!url) return "";
  const normalizedUrl = url.startsWith("//") ? `https:${url}` : url.replace(/^http:\/\//, "https://");
  if (normalizedUrl.includes("/transparent.png")) return "";
  return isBilibiliImageUrl(normalizedUrl) ? makeBilibiliCoverProxyUrl(normalizedUrl) : normalizedUrl;
}

function makeBilibiliCoverProxyUrl(url) {
  return `${BILIBILI_METADATA_PROXY}?cover=${encodeURIComponent(url)}`;
}

function isBilibiliImageUrl(url) {
  try {
    const parsedUrl = new URL(url, window.location.origin);
    return parsedUrl.hostname === "hdslb.com" || parsedUrl.hostname.endsWith(".hdslb.com");
  } catch {
    return false;
  }
}

function getThumbnailSrc(video) {
  const thumbnail = video.thumbnail || "";
  if (isBilibiliImageUrl(thumbnail)) return makeBilibiliCoverProxyUrl(thumbnail);
  return thumbnail || makeFallbackThumbnail(video.source);
}

function getPlayableEmbedUrl(video) {
  if (video.source !== "Bilibili") return video.embedUrl;

  const parsed = parseVideoUrl(video.url);
  if (!parsed.bvid) return video.embedUrl;

  try {
    const embedUrl = new URL(video.embedUrl || makeBilibiliEmbedUrl({ bvid: parsed.bvid }));
    embedUrl.searchParams.set("auto_play", "1");
    embedUrl.searchParams.set("autoplay", "1");
    embedUrl.searchParams.set("is_muted", "0");
    embedUrl.searchParams.set("isMuted", "0");
    embedUrl.searchParams.set("muted", "0");
    embedUrl.searchParams.set("volume", "1");
    return embedUrl.toString();
  } catch {
    return makeBilibiliEmbedUrl({ bvid: parsed.bvid });
  }
}

function makeFallbackThumbnail(label) {
  const lines = getThumbnailTextLines(label || "Workout").map((line) => encodeURIComponent(line));
  return `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 640 360'%3E%3Crect width='640' height='360' fill='%23256d69'/%3E%3Cpath d='M0 280c80-80 170-96 270-48s208 48 370-46v174H0z' fill='%23efb45d' opacity='.78'/%3E%3Ccircle cx='520' cy='92' r='56' fill='%23d8ece7' opacity='.86'/%3E%3Ctext x='44' y='156' font-family='Arial,sans-serif' font-size='42' font-weight='700' fill='%23fffdf7'%3E${lines[0] || ""}%3C/text%3E%3Ctext x='44' y='212' font-family='Arial,sans-serif' font-size='42' font-weight='700' fill='%23fffdf7'%3E${lines[1] || ""}%3C/text%3E%3C/svg%3E`;
}

function getThumbnailTextLines(label) {
  const compactLabel = String(label).replace(/\s+/g, " ").trim();
  if (compactLabel.length <= 12) return [compactLabel];
  return [compactLabel.slice(0, 12), compactLabel.slice(12, 24) + (compactLabel.length > 24 ? "..." : "")];
}

function render() {
  renderFilters();
  renderCards();
  elements.videoCount.textContent = `${state.videos.length} 个视频`;
}

function renderLibraryKey() {
  elements.libraryButton.textContent = getLibraryDisplayName(state.libraryKey);
  elements.libraryButton.title = `当前库：${state.libraryKey}`;
}

function getLibraryDisplayName(libraryKey) {
  return libraryKey === DEFAULT_LIBRARY_KEY ? "N" : libraryKey;
}

function renderFilters() {
  const categories = getCategories();
  if (!categories.includes(state.activeCategory)) state.activeCategory = "all";

  elements.categoryOptions.replaceChildren(
    ...categories.map((category) => {
      const option = document.createElement("option");
      option.value = category;
      return option;
    }),
  );

  const filterOptions = ["all", ...categories];
  elements.categoryFilter.replaceChildren(
    ...filterOptions.map((category) => {
      const button = document.createElement("button");
      const isActive = category === state.activeCategory;
      button.type = "button";
      button.className = "filter-pill";
      button.textContent = category === "all" ? "全部" : category;
      button.setAttribute("aria-pressed", String(isActive));
      button.addEventListener("click", () => {
        state.activeCategory = category;
        render();
      });
      return button;
    }),
  );
}

function renderCards() {
  const query = elements.searchInput.value.trim().toLowerCase();
  const filter = state.activeCategory;
  const videos = state.videos.filter((video) => {
    const matchesFilter = filter === "all" || video.category === filter;
    const haystack = `${video.title} ${video.category} ${getDisplaySource(video)}`.toLowerCase();
    return matchesFilter && haystack.includes(query);
  });

  elements.grid.replaceChildren();
  elements.emptyState.hidden = videos.length > 0;

  videos.forEach((video) => {
    const card = elements.template.content.firstElementChild.cloneNode(true);
    const thumbnailButton = card.querySelector(".thumbnail-button");
    const thumbnail = card.querySelector("img");
    const editButton = card.querySelector(".edit-button");
    const deleteButton = card.querySelector(".delete-button");

    thumbnail.src = getThumbnailSrc(video);
    thumbnail.alt = `${video.title} 的封面`;
    card.querySelector(".source-label").textContent = getDisplaySource(video);
    card.querySelector("h3").textContent = video.title;
    card.querySelector(".category-pill").textContent = video.category;
    thumbnailButton.addEventListener("click", () => playVideo(video));
    editButton.addEventListener("click", (event) => {
      event.stopPropagation();
      openEditModal(video);
    });
    deleteButton.addEventListener("click", (event) => {
      event.stopPropagation();
      deleteVideo(video.id);
    });
    elements.grid.append(card);
  });
}

function playVideo(video) {
  if (isExternalEntry(video)) {
    window.open(video.embedUrl || video.url, "_blank", "noopener");
    return;
  }

  state.activeId = video.id;
  elements.playerModal.hidden = false;
  elements.playerSource.textContent = `${video.source} · ${video.category}`;
  elements.playerTitle.textContent = video.title;
  elements.playerFrame.replaceChildren();

  if (video.kind === "video") {
    const player = document.createElement("video");
    player.src = video.embedUrl;
    player.controls = true;
    player.autoplay = true;
    player.muted = false;
    player.volume = 1;
    elements.playerFrame.append(player);
  } else {
    const player = document.createElement("iframe");
    player.src = getPlayableEmbedUrl(video);
    player.title = video.title;
    player.allow = "autoplay; accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share";
    player.allowFullscreen = true;
    elements.playerFrame.append(player);
  }
}

function getDisplaySource(video) {
  const parsed = parseVideoUrl(video.url);
  return parsed.source || video.source;
}

function isExternalEntry(video) {
  return video.kind === "external" || parseVideoUrl(video.url).kind === "external";
}

function deleteVideo(id) {
  const video = state.videos.find((item) => item.id === id);
  if (!video) return;
  const shouldDelete = window.confirm(`删除「${video.title}」吗？`);
  if (!shouldDelete) return;

  deletePersistedVideo(id)
    .then(() => {
      state.videos = state.videos.filter((item) => item.id !== id);
      if (state.activeId === id) {
        closePlayerModal();
      }
      saveVideos();
      render();
    })
    .catch((error) => {
      window.alert(error.message || "删除失败，请稍后再试。");
    });
}

async function handleEditSubmit(event) {
  event.preventDefault();

  const video = state.videos.find((item) => item.id === state.editingId);
  if (!video) return;

  const updates = {
    title: elements.editTitleInput.value.trim() || video.title,
    category: normalizeCategory(elements.editCategoryInput.value),
  };

  elements.editForm.querySelector("button[type='submit']").disabled = true;
  setEditStatus("正在保存...");

  try {
    const updatedVideo = await updatePersistedVideo(video.id, updates);
    Object.assign(video, updatedVideo || updates);
    saveVideos();
    render();
    closeEditModal();
  } catch (error) {
    setEditStatus(error.message || "保存失败，请稍后再试。");
  } finally {
    elements.editForm.querySelector("button[type='submit']").disabled = false;
  }
}

async function loadRemoteVideos() {
  try {
    const localVideos = loadVideos();
    const response = await fetch(videosApiUrl());
    if (!response.ok) throw new Error("remote unavailable");
    const videos = await response.json();
    state.storageMode = "remote";
    state.videos = videos.length ? videos : localVideos;
    saveVideos();
    render();
    if (!videos.length && localVideos.length) {
      migrateLocalVideos(localVideos);
    }
  } catch {
    state.storageMode = "local";
  }
}

async function persistVideos(videos) {
  if (state.storageMode !== "remote") {
    return videos;
  }

  const response = await fetch(VIDEOS_API, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...writeTokenHeader(),
    },
    body: JSON.stringify({ libraryKey: state.libraryKey, videos }),
  });

  if (response.status === 401) {
    promptForWriteToken();
    throw new Error("需要写入密钥，已保存到本机后请再点一次保存。");
  }

  if (!response.ok) {
    throw new Error("Supabase 保存失败。");
  }

  return response.json();
}

async function deletePersistedVideo(id) {
  if (state.storageMode !== "remote") {
    return;
  }

  const response = await fetch(videosApiUrl({ id }), {
    method: "DELETE",
    headers: writeTokenHeader(),
  });

  if (response.status === 401) {
    promptForWriteToken();
    throw new Error("需要写入密钥，已保存到本机后请再删除一次。");
  }

  if (!response.ok) {
    throw new Error("Supabase 删除失败。");
  }
}

async function updatePersistedVideo(id, updates) {
  if (state.storageMode !== "remote") {
    return updates;
  }

  const response = await fetch(videosApiUrl({ id }), {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      ...writeTokenHeader(),
    },
    body: JSON.stringify(updates),
  });

  if (response.status === 401) {
    promptForWriteToken();
    throw new Error("需要写入密钥，已保存到本机后请再保存一次。");
  }

  if (!response.ok) {
    throw new Error("Supabase 更新失败。");
  }

  return response.json();
}

function mergeVideos(incomingVideos, existingVideos) {
  const merged = new Map();
  [...incomingVideos, ...existingVideos].forEach((video) => {
    merged.set(video.url, video);
  });
  return [...merged.values()].sort((a, b) => b.createdAt - a.createdAt);
}

function writeTokenHeader() {
  return {
    "x-library-key": state.libraryKey,
    ...(state.writeToken ? { "x-app-token": state.writeToken } : {}),
  };
}

function promptForWriteToken() {
  const token = window.prompt("请输入写入密钥");
  if (!token) return;
  state.writeToken = token;
  localStorage.setItem("exercise-video-library:write-token", token);
}

async function migrateLocalVideos(localVideos) {
  try {
    const savedVideos = await persistVideos(localVideos);
    state.videos = mergeVideos(savedVideos, state.videos);
    saveVideos();
    render();
  } catch {
    // Keep local cache visible if cloud migration is not permitted yet.
  }
}

function getCategories() {
  return [...new Set(state.videos.map((video) => video.category))].sort((a, b) => a.localeCompare(b, "zh-Hans-CN"));
}

function normalizeCategory(category) {
  return category.trim() || "未分类";
}

function createVideo(entry, metadata, category) {
  const title = entry.title || metadata.title || fallbackTitle(entry.url, metadata.source);

  return {
    id: crypto.randomUUID(),
    libraryKey: state.libraryKey,
    url: entry.url,
    title,
    category,
    thumbnail: metadata.thumbnail || (shouldUseGeneratedThumbnail(metadata) ? makeFallbackThumbnail(title) : ""),
    source: metadata.source,
    embedUrl: metadata.embedUrl,
    kind: metadata.kind,
    createdAt: Date.now(),
  };
}

function shouldUseGeneratedThumbnail(metadata) {
  return metadata.kind === "external" || metadata.source === "小红书";
}

function parseVideoEntries(value) {
  const rawEntries = value
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map(parseVideoEntry)
    .filter(Boolean);

  const seen = new Set();
  return rawEntries.filter((entry) => {
    if (seen.has(entry.url)) return false;
    seen.add(entry.url);
    return true;
  });
}

function parseVideoEntry(text) {
  const markdownMatch = text.match(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/);
  const url = markdownMatch?.[2] || text.match(/https?:\/\/[^\s)\]]+/)?.[0];
  if (!url) return null;

  const beforeUrl = text.slice(0, text.indexOf(url)).trim();
  const markdownTitle = markdownMatch?.[1] || "";
  const title = cleanPastedTitle(beforeUrl || markdownTitle);

  return {
    title,
    url: url.replace(/[，。！？、,.!?]+$/, ""),
  };
}

function cleanPastedTitle(title) {
  return title
    .trim()
    .replace(/\[$/, "")
    .trim()
    .replace(/^#+\s*/, "")
    .replace(/^【/, "")
    .replace(/】$/, "")
    .trim();
}

function fallbackTitle(url, source) {
  try {
    const parsedUrl = new URL(url);
    return parsedUrl.hostname.replace(/^www\./, "") || source || "未命名视频";
  } catch {
    return source || "未命名视频";
  }
}

function openAddModal() {
  elements.addModal.hidden = false;
  setStatus("");
  window.setTimeout(() => elements.urlsInput.focus(), 0);
}

function closeAddModal() {
  elements.addModal.hidden = true;
}

function closePlayerModal() {
  state.activeId = null;
  elements.playerModal.hidden = true;
  elements.playerFrame.replaceChildren();
}

function openEditModal(video) {
  state.editingId = video.id;
  elements.editTitleInput.value = video.title;
  elements.editCategoryInput.value = video.category;
  setEditStatus("");
  elements.editModal.hidden = false;
  window.setTimeout(() => elements.editTitleInput.focus(), 0);
}

function closeEditModal() {
  state.editingId = null;
  elements.editModal.hidden = true;
  elements.editForm.reset();
  setEditStatus("");
}

function handleBackdropClick(event) {
  if (event.target === elements.addModal) closeAddModal();
  if (event.target === elements.playerModal) closePlayerModal();
  if (event.target === elements.editModal) closeEditModal();
}

function handleKeydown(event) {
  if (event.key !== "Escape") return;
  if (!elements.playerModal.hidden) closePlayerModal();
  if (!elements.editModal.hidden) closeEditModal();
  if (!elements.addModal.hidden) closeAddModal();
}

function clearForm(shouldFocus = true) {
  elements.form.reset();
  setStatus("");
  if (shouldFocus) elements.urlsInput.focus();
}

function setStatus(message) {
  elements.statusLine.textContent = message;
}

function setEditStatus(message) {
  elements.editStatusLine.textContent = message;
}

function loadVideos() {
  try {
    const stored = localStorage.getItem(getStorageKey());
    if (stored) return JSON.parse(stored) || [];
    if (state.libraryKey === DEFAULT_LIBRARY_KEY) return JSON.parse(localStorage.getItem(LEGACY_STORAGE_KEY)) || [];
    return [];
  } catch {
    return [];
  }
}

function saveVideos() {
  localStorage.setItem(getStorageKey(), JSON.stringify(state.videos));
}

function getStorageKey() {
  return `${STORAGE_PREFIX}:${state.libraryKey}`;
}

function videosApiUrl(params = {}) {
  const searchParams = new URLSearchParams({
    library: state.libraryKey,
  });
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null) searchParams.set(key, value);
  });
  return `${VIDEOS_API}?${searchParams.toString()}`;
}

function getInitialLibraryKey() {
  const urlLibraryKey = normalizeLibraryKey(new URLSearchParams(window.location.search).get("library"));
  if (urlLibraryKey) {
    localStorage.setItem(LIBRARY_KEY_STORAGE, urlLibraryKey);
    return urlLibraryKey;
  }

  return DEFAULT_LIBRARY_KEY;
}

function normalizeLibraryKey(value) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 64);
}

function setLibraryUrlParam(libraryKey) {
  const url = new URL(window.location.href);
  if (libraryKey === DEFAULT_LIBRARY_KEY) {
    url.searchParams.delete("library");
  } else {
    url.searchParams.set("library", libraryKey);
  }
  window.history.replaceState({}, "", url);
}

async function hydrateSavedBilibiliVideos() {
  const targets = state.videos.filter((video) => {
    const parsed = parseVideoUrl(video.url);
    return (
      parsed.source === "Bilibili" &&
      parsed.bvid &&
      (isFallbackThumbnail(video.thumbnail) || isBilibiliImageUrl(video.thumbnail) || isLegacyBilibiliEmbed(video.embedUrl))
    );
  });

  if (!targets.length) return;

  let changed = false;
  for (const video of targets) {
    const parsed = parseVideoUrl(video.url);
    const metadata = await getVideoMetadata(video.url);
    if (metadata.thumbnail && (!isFallbackThumbnail(metadata.thumbnail) || video.thumbnail !== metadata.thumbnail)) {
      video.thumbnail = metadata.thumbnail;
      changed = true;
    }
    if (metadata.title && video.title === fallbackTitle(video.url, video.source)) {
      video.title = metadata.title;
      changed = true;
    }
    if (metadata.embedUrl) {
      video.embedUrl = metadata.embedUrl;
      changed = true;
    } else if (parsed.bvid && isLegacyBilibiliEmbed(video.embedUrl)) {
      video.embedUrl = makeBilibiliEmbedUrl({ bvid: parsed.bvid });
      changed = true;
    }
  }

  if (changed) {
    saveVideos();
    render();
  }
}

function isFallbackThumbnail(thumbnail) {
  return !thumbnail || thumbnail.startsWith("data:image/svg+xml") || thumbnail.includes("/transparent.png");
}

function isLegacyBilibiliEmbed(embedUrl) {
  return !embedUrl || !embedUrl.includes("blackboard/html5mobileplayer.html");
}
