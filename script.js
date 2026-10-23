const LEGACY_STORAGE_KEY = "exercise-video-library:v1";
const STORAGE_PREFIX = "exercise-video-library:v2";
const LOCAL_STORAGE_KEY = "exercise-video-library:local:v3";
const BILIBILI_METADATA_PROXY = "/api/bilibili";
const VIDEOS_API = "/api/videos";

const state = {
  videos: [],
  activeId: null,
  activeCategory: "all",
  selectedTags: [],
  editingTags: [],
  renamingTag: "",
  storageMode: "local",
  writeToken: readStoredToken(),
  lastRemoteRefreshAt: 0,
  syncGeneration: 0,
  busy: false,
};

const elements = {
  form: document.querySelector("#videoForm"),
  urlsInput: document.querySelector("#urlsInput"),
  tagPicker: document.querySelector("#tagPicker"),
  tagInput: document.querySelector("#tagInput"),
  addTagButton: document.querySelector("#addTagButton"),
  editTagPicker: document.querySelector("#editTagPicker"),
  editTagInput: document.querySelector("#editTagInput"),
  editAddTagButton: document.querySelector("#editAddTagButton"),
  categoryFilter: document.querySelector("#categoryFilter"),
  searchInput: document.querySelector("#searchInput"),
  grid: document.querySelector("#videoGrid"),
  emptyState: document.querySelector("#emptyState"),
  template: document.querySelector("#videoCardTemplate"),
  statusLine: document.querySelector("#statusLine"),
  videoCount: document.querySelector("#videoCount"),
  exportButton: document.querySelector("#exportButton"),
  copyLibraryLinkButton: document.querySelector("#copyLibraryLinkButton"),
  syncButton: document.querySelector("#syncButton"),
  syncModal: document.querySelector("#syncModal"),
  syncForm: document.querySelector("#syncForm"),
  syncTokenInput: document.querySelector("#syncTokenInput"),
  syncStatus: document.querySelector("#syncStatus"),
  disconnectSyncButton: document.querySelector("#disconnectSyncButton"),
  cancelSyncButton: document.querySelector("#cancelSyncButton"),
  connectSyncButton: document.querySelector("#connectSyncButton"),
  localImportModal: document.querySelector("#localImportModal"),
  localImportStatus: document.querySelector("#localImportStatus"),
  skipLocalImportButton: document.querySelector("#skipLocalImportButton"),
  confirmLocalImportButton: document.querySelector("#confirmLocalImportButton"),
  openAddButton: document.querySelector("#openAddButton"),
  closeAddButton: document.querySelector("#closeAddButton"),
  addModal: document.querySelector("#addModal"),
  playerModal: document.querySelector("#playerModal"),
  editModal: document.querySelector("#editModal"),
  tagRenameModal: document.querySelector("#tagRenameModal"),
  closePlayerButton: document.querySelector("#closePlayerButton"),
  closeEditButton: document.querySelector("#closeEditButton"),
  editForm: document.querySelector("#editForm"),
  editTitleInput: document.querySelector("#editTitleInput"),
  editUrlInput: document.querySelector("#editUrlInput"),
  editStatusLine: document.querySelector("#editStatusLine"),
  tagRenameForm: document.querySelector("#tagRenameForm"),
  tagRenameInput: document.querySelector("#tagRenameInput"),
  tagRenameStatusLine: document.querySelector("#tagRenameStatusLine"),
  cancelTagRenameButton: document.querySelector("#cancelTagRenameButton"),
  playerSource: document.querySelector("#playerSource"),
  playerTitle: document.querySelector("#playerTitle"),
  playerTitleLink: document.querySelector("#playerTitleLink"),
  playerFrame: document.querySelector("#playerFrame"),
};

state.videos = loadVideos();

elements.form.addEventListener("submit", handleSubmit);
elements.exportButton.addEventListener("click", exportVideos);
document.querySelector("#importButton").addEventListener("click", () => document.querySelector("#importFile").click());
document.querySelector("#importFile").addEventListener("change", importVideos);
elements.copyLibraryLinkButton.addEventListener("click", copyLibraryLink);
elements.syncButton.addEventListener("click", openSyncSettings);
elements.syncForm.addEventListener("submit", connectSync);
elements.cancelSyncButton.addEventListener("click", closeSyncSettings);
elements.disconnectSyncButton.addEventListener("click", disconnectSync);
elements.skipLocalImportButton.addEventListener("click", closeLocalImport);
elements.confirmLocalImportButton.addEventListener("click", importLocalToCloud);
elements.openAddButton.addEventListener("click", openAddModal);
elements.addTagButton.addEventListener("click", () => addTypedTag("add"));
elements.editAddTagButton.addEventListener("click", () => addTypedTag("edit"));
elements.tagInput.addEventListener("keydown", (event) => handleTagInputKeydown(event, "add"));
elements.editTagInput.addEventListener("keydown", (event) => handleTagInputKeydown(event, "edit"));
elements.closeAddButton.addEventListener("click", closeAddModal);
elements.closePlayerButton.addEventListener("click", closePlayerModal);
elements.closeEditButton.addEventListener("click", closeEditModal);
elements.playerModal.addEventListener("click", handleBackdropClick);
elements.editForm.addEventListener("submit", handleEditSubmit);
elements.tagRenameForm.addEventListener("submit", handleTagRenameSubmit);
elements.cancelTagRenameButton.addEventListener("click", closeTagRenameModal);
elements.searchInput.addEventListener("input", render);
document.addEventListener("keydown", handleKeydown);
document.addEventListener("visibilitychange", refreshRemoteVideosWhenVisible);
window.addEventListener("focus", refreshRemoteVideosWhenVisible);
window.addEventListener("pageshow", refreshRemoteVideosWhenVisible);

initializeApp();

async function initializeApp() {
  const url = new URL(window.location.href);
  url.searchParams.delete("library");
  window.history.replaceState({}, "", url);
  renderSyncState();
  render();
  await loadRemoteVideos();
  await hydrateSavedBilibiliVideos();
}

async function handleSubmit(event) {
  event.preventDefault();
  if (state.busy) return;

  const entries = parseVideoEntries(elements.urlsInput.value);
  if (!entries.length) {
    setStatus("先贴至少一个视频链接。");
    return;
  }

  const category = serializeTags([...state.selectedTags, elements.tagInput.value]);
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
  state.syncGeneration++;
  state.busy = true;
  try {
    requireCloudConnection();
    for (let index = 0; index < uniqueEntries.length; index += 1) {
      const entry = uniqueEntries[index];
      const url = entry.url;
      setStatus(`正在整理 ${index + 1}/${uniqueEntries.length}...`);
      const metadata = await getVideoMetadata(url);
      videos.push(createVideo(entry, metadata, category));
    }

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
    setStatus(getFriendlyErrorMessage(error, "保存失败，请稍后再试。"));
    return;
  } finally {
    state.busy = false;
    elements.form.querySelector("button[type='submit']").disabled = false;
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

  const videos = state.videos.map(({ title, url, category, thumbnail }) => ({ title, url, category, thumbnail: safeCoverUrl(thumbnail) || "" }));
  downloadExportFile(JSON.stringify({ format: "workout-videos", version: 1, exportedAt: new Date().toISOString(), videos }, null, 2));
}

function downloadExportFile(text) {
  const blob = new Blob([text], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `动一动-视频备份-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

async function copyLibraryLink() {
  const url = getLibraryUrl();

  try {
    await navigator.clipboard.writeText(url);
    window.alert("已复制当前跟练页面链接。");
  } catch {
    window.prompt("复制这个链接分享给朋友", url);
  }
}

function parseBackup(text) {
  const backup = JSON.parse(text);
  if (backup?.format !== "workout-videos" || backup.version !== 1 || !Array.isArray(backup.videos) || backup.videos.length > 2000) {
    throw new Error("不是支持的视频备份文件（版本 1，最多 2000 条）。");
  }
  return backup.videos.map((item) => {
    if (!item || typeof item.url !== "string" || item.url.length > 4096 || !safeHttpUrl(item.url) ||
        typeof item.title !== "string" || item.title.length > 1000 ||
        typeof item.category !== "string" || item.category.length > 500 ||
        (item.thumbnail && (typeof item.thumbnail !== "string" || item.thumbnail.length > 4096 || !safeCoverUrl(item.thumbnail)))) {
      throw new Error("备份包含无效的视频信息，未导入任何内容。");
    }
    const url = safeHttpUrl(item.url);
    const parsed = parseVideoUrl(url);
    return createVideo({ url, title: item.title }, { ...parsed, thumbnail: safeCoverUrl(item.thumbnail) || parsed.thumbnail || "" }, serializeTags(item.category.split("｜")));
  });
}

async function importVideos(event) {
  const file = event.target.files?.[0];
  event.target.value = "";
  if (!file || state.busy) return;
  state.syncGeneration++;
  state.busy = true;
  try {
    requireCloudConnection();
    if (file.size > 5 * 1024 * 1024) throw new Error("备份文件不能超过 5 MB。");
    const videos = parseBackup(await file.text());
    const seen = new Set(state.videos.map((video) => safeHttpUrl(video.url)));
    const additions = videos.filter((video) => {
      if (seen.has(video.url)) return false;
      seen.add(video.url);
      return true;
    });
    if (!additions.length) { window.alert("没有新视频可导入，已有链接均已跳过。"); return; }
    const target = state.writeToken ? "云端收藏" : "此浏览器的本地收藏";
    if (!window.confirm(`向${target}追加 ${additions.length} 个视频，跳过 ${videos.length - additions.length} 个重复项？不会覆盖已有视频。`)) return;
    const saved = await persistVideos(additions);
    state.videos = mergeVideos(saved, state.videos);
    saveVideos();
    render();
  } catch (error) {
    window.alert(getFriendlyErrorMessage(error, "导入失败。"));
  } finally {
    state.busy = false;
  }
}

function getLibraryUrl() {
  const url = new URL(window.location.href);
  url.hash = "";

  url.searchParams.delete("library");

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
    const data = await fetchJson(oembedUrl);
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
    () => fetchJson(proxyUrl, { timeoutMs: 10000 }),
    () => fetchJson(apiUrl),
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
  const { timeoutMs = 5000 } = options;
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error("metadata request failed");
    return await response.json();
  } finally {
    window.clearTimeout(timeout);
  }
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

function safeHttpUrl(value) {
  if (typeof value !== "string" || /[\u0000-\u0020\u007f\\]/.test(value)) return "";
  try {
    const url = new URL(value);
    return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password ? url.href : "";
  } catch {
    return "";
  }
}

function safeCoverUrl(value) {
  if (safeHttpUrl(value)) return value;
  if (typeof value !== "string" || !value.startsWith("/api/bilibili?")) return "";
  const proxy = new URL(value, window.location.href);
  const cover = safeHttpUrl(proxy.searchParams.get("cover"));
  return cover && isBilibiliImageUrl(cover) ? makeBilibiliCoverProxyUrl(cover) : "";
}

function getThumbnailSrc(video) {
  const thumbnail = video.thumbnail || "";
  if (safeHttpUrl(thumbnail) && isBilibiliImageUrl(thumbnail)) return makeBilibiliCoverProxyUrl(thumbnail);
  if (isFallbackThumbnail(thumbnail)) return makeFallbackThumbnail(video.title || getDisplaySource(video));
  return safeCoverUrl(thumbnail) || makeFallbackThumbnail(video.title || getDisplaySource(video));
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
  const lines = getThumbnailTextLines(label || "未命名").map(escapeSvgText);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 360">
  <defs>
    <filter id="paper">
      <feTurbulence type="fractalNoise" baseFrequency="0.82" numOctaves="4" seed="8"/>
      <feColorMatrix type="saturate" values="0"/>
      <feComponentTransfer>
        <feFuncA type="table" tableValues="0 0.14"/>
      </feComponentTransfer>
    </filter>
    <filter id="soften">
      <feGaussianBlur stdDeviation="18"/>
    </filter>
  </defs>
  <rect width="640" height="360" fill="#f6f0e6"/>
  <rect width="640" height="360" filter="url(#paper)" opacity="0.5"/>
  <text x="58" y="158" font-family="Arial, sans-serif" font-size="38" font-weight="700" fill="#2f332f">${lines[0] || ""}</text>
  <text x="58" y="210" font-family="Arial, sans-serif" font-size="38" font-weight="700" fill="#2f332f">${lines[1] || ""}</text>
</svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

function getThumbnailTextLines(label) {
  const compactLabel = String(label).replace(/\s+/g, " ").trim();
  if (compactLabel.length <= 12) return [compactLabel];
  return [compactLabel.slice(0, 12), compactLabel.slice(12, 24) + (compactLabel.length > 24 ? "..." : "")];
}

function escapeSvgText(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function render() {
  renderFilters();
  renderCards();
  elements.videoCount.textContent = `${state.videos.length} 个视频`;
}

function renderSyncState() {
  elements.syncButton.textContent = !state.writeToken ? "同步设置" : state.storageMode === "remote" ? "已连接同步" : "同步未连接";
}

function renderFilters() {
  const categories = getCategories();
  if (!categories.includes(state.activeCategory)) state.activeCategory = "all";

  const filterOptions = ["all", ...categories];
  elements.categoryFilter.replaceChildren(
    ...filterOptions.map((category) => {
      const button = document.createElement("button");
      const isActive = category === state.activeCategory;
      button.type = "button";
      button.className = "filter-pill";
      button.textContent = category === "all" ? "全部" : category;
      button.title = category === "all" ? "" : "右键重命名标签";
      button.setAttribute("aria-pressed", String(isActive));
      button.addEventListener("click", () => {
        state.activeCategory = category;
        render();
      });
      if (category !== "all") {
        button.addEventListener("contextmenu", (event) => {
          event.preventDefault();
          openTagRenameModal(category);
        });
      }
      return button;
    }),
  );

  renderTagPicker("add");
  if (!elements.editModal.hidden) renderTagPicker("edit");
}

function renderTagPicker(mode) {
  const picker = mode === "edit" ? elements.editTagPicker : elements.tagPicker;
  replaceSelectedTags(mode, getRealTags(mode === "edit" ? state.editingTags : state.selectedTags));
  const selectedTags = mode === "edit" ? state.editingTags : state.selectedTags;
  const availableTags = uniqueTags([...selectedTags, ...getCategories()]).filter((tag) => tag !== "未分类");

  picker.replaceChildren();

  if (!availableTags.length) {
    const empty = document.createElement("span");
    empty.className = "tag-picker-empty";
    empty.textContent = "还没有标签";
    picker.append(empty);
    return;
  }

  availableTags.forEach((tag) => {
    const button = document.createElement("button");
    const isSelected = selectedTags.includes(tag);
    button.type = "button";
    button.className = "tag-option";
    button.dataset.tag = tag;
    button.title = "右键重命名标签";
    button.setAttribute("aria-pressed", String(isSelected));
    button.append(document.createTextNode(tag));
    if (isSelected) {
      const remove = document.createElement("span");
      remove.className = "tag-remove";
      remove.textContent = "×";
      remove.setAttribute("aria-hidden", "true");
      button.append(remove);
    }
    button.addEventListener("click", () => toggleSelectedTag(mode, tag));
    button.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      openTagRenameModal(tag);
    });
    picker.append(button);
  });
}

function toggleSelectedTag(mode, tag) {
  replaceSelectedTags(mode, getRealTags(mode === "edit" ? state.editingTags : state.selectedTags));
  const selectedTags = mode === "edit" ? state.editingTags : state.selectedTags;
  if (selectedTags.includes(tag)) {
    selectedTags.splice(selectedTags.indexOf(tag), 1);
  } else if (selectedTags.length < 3) {
    selectedTags.push(tag);
  } else {
    window.alert("一个视频最多选择 3 个标签。");
  }
  renderTagPicker(mode);
}

function addTypedTag(mode) {
  const input = mode === "edit" ? elements.editTagInput : elements.tagInput;
  const tag = normalizeTag(input.value);
  if (!tag) return;
  replaceSelectedTags(mode, getRealTags(mode === "edit" ? state.editingTags : state.selectedTags));
  const selectedTags = mode === "edit" ? state.editingTags : state.selectedTags;
  if (!selectedTags.includes(tag)) {
    if (selectedTags.length >= 3) {
      window.alert("一个视频最多选择 3 个标签。");
      return;
    }
    selectedTags.push(tag);
  }
  input.value = "";
  render();
}

function handleTagInputKeydown(event, mode) {
  if (event.key !== "Enter") return;
  event.preventDefault();
  addTypedTag(mode);
}

function openTagRenameModal(tag) {
  if (tag === "未分类") return;
  state.renamingTag = tag;
  elements.tagRenameInput.value = tag;
  setTagRenameStatus("");
  elements.tagRenameModal.hidden = false;
  window.setTimeout(() => elements.tagRenameInput.focus(), 0);
}

function closeTagRenameModal() {
  state.renamingTag = "";
  elements.tagRenameModal.hidden = true;
  elements.tagRenameForm.reset();
  setTagRenameStatus("");
}

async function handleTagRenameSubmit(event) {
  event.preventDefault();
  if (state.busy) return;
  const oldTag = state.renamingTag;
  const nextTag = normalizeTag(elements.tagRenameInput.value);
  if (!nextTag || nextTag === oldTag) return;

  const affectedVideos = state.videos.filter((video) => getVideoTags(video).includes(oldTag));
  if (!affectedVideos.length) {
    closeTagRenameModal();
    return;
  }

  elements.tagRenameForm.querySelector("button[type='submit']").disabled = true;
  state.syncGeneration++;
  state.busy = true;
  setTagRenameStatus("正在保存...");
  const previousCategories = new Map(affectedVideos.map((video) => [video.id, video.category]));
  affectedVideos.forEach((video) => {
    video.category = serializeTags(getVideoTags(video).map((tag) => (tag === oldTag ? nextTag : tag)));
  });

  state.selectedTags = state.selectedTags.map((tag) => (tag === oldTag ? nextTag : tag));
  state.editingTags = state.editingTags.map((tag) => (tag === oldTag ? nextTag : tag));
  if (state.activeCategory === oldTag) state.activeCategory = nextTag;
  saveVideos();
  render();

  try {
    await Promise.all(affectedVideos.map((video) => updatePersistedVideo(video.id, { category: video.category })));
    closeTagRenameModal();
  } catch (error) {
    affectedVideos.forEach((video) => {
      video.category = previousCategories.get(video.id) || video.category;
    });
    state.selectedTags = state.selectedTags.map((tag) => (tag === nextTag ? oldTag : tag));
    state.editingTags = state.editingTags.map((tag) => (tag === nextTag ? oldTag : tag));
    if (state.activeCategory === nextTag) state.activeCategory = oldTag;
    saveVideos();
    render();
    setTagRenameStatus(getFriendlyErrorMessage(error, "标签重命名失败，请稍后再试。"));
  } finally {
    state.busy = false;
    elements.tagRenameForm.querySelector("button[type='submit']").disabled = false;
  }
}

function renderCards() {
  const query = elements.searchInput.value.trim().toLowerCase();
  const filter = state.activeCategory;
  const videos = state.videos.filter((video) => {
    const tags = getVideoTags(video);
    const matchesFilter = filter === "all" || tags.includes(filter);
    const haystack = `${video.title} ${tags.join(" ")} ${getDisplaySource(video)}`.toLowerCase();
    return matchesFilter && haystack.includes(query);
  });

  elements.grid.replaceChildren();
  elements.emptyState.hidden = videos.length > 0;

  videos.forEach((video) => {
    const card = elements.template.content.firstElementChild.cloneNode(true);
    const thumbnailButton = card.querySelector(".thumbnail-button");
    const thumbnail = card.querySelector("img");
    const titleLink = card.querySelector(".card-title-link");
    const editButton = card.querySelector(".edit-button");
    const deleteButton = card.querySelector(".delete-button");

    let triedDirectCover = false;
    thumbnail.addEventListener("error", () => {
      const coverUrl = new URL(safeCoverUrl(video.thumbnail) || "/", window.location.href);
      const directCover = coverUrl.searchParams.get("cover");
      if (!triedDirectCover && safeHttpUrl(directCover) && isBilibiliImageUrl(directCover)) {
        triedDirectCover = true;
        thumbnail.referrerPolicy = "no-referrer";
        thumbnail.src = directCover;
        return;
      }
      const fallback = makeFallbackThumbnail(video.title || getDisplaySource(video));
      if (thumbnail.getAttribute("src") !== fallback) thumbnail.src = fallback;
    });
    thumbnail.src = getThumbnailSrc(video);
    thumbnail.alt = `${video.title} 的封面`;
    card.querySelector(".source-label").textContent = getDisplaySource(video);
    titleLink.textContent = video.title;
    const originalUrl = safeHttpUrl(video.url);
    if (originalUrl) titleLink.href = originalUrl;
    else titleLink.removeAttribute("href");
    renderCardTags(card, video);
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

function renderCardTags(card, video) {
  const actions = card.querySelector(".card-actions");
  const editButton = card.querySelector(".edit-button");
  const tags = getVideoTags(video);

  actions.querySelectorAll(".category-pill").forEach((pill) => pill.remove());
  tags.forEach((tag) => {
    const pill = document.createElement("span");
    pill.className = "category-pill";
    pill.textContent = tag;
    actions.insertBefore(pill, editButton);
  });
}

function playVideo(video) {
  const originalUrl = safeHttpUrl(video.url);
  const playbackUrl = safeHttpUrl(video.embedUrl || video.url);
  if (!originalUrl || !playbackUrl) {
    window.alert("这个视频的链接不安全或无效，请编辑后使用 HTTP(S) 地址。");
    return;
  }
  if (isExternalEntry(video)) {
    window.open(playbackUrl, "_blank", "noopener");
    return;
  }

  state.activeId = video.id;
  elements.playerModal.hidden = false;
  elements.playerSource.textContent = `${getDisplaySource(video)} · ${getVideoTags(video).join(" / ")}`;
  elements.playerTitleLink.textContent = video.title;
  elements.playerTitleLink.href = originalUrl;
  elements.playerFrame.replaceChildren();

  if (video.kind === "video") {
    const player = document.createElement("video");
    player.src = playbackUrl;
    player.controls = true;
    player.autoplay = true;
    player.muted = false;
    player.volume = 1;
    elements.playerFrame.append(player);
  } else {
    const player = document.createElement("iframe");
    player.src = safeHttpUrl(getPlayableEmbedUrl(video)) || playbackUrl;
    player.title = video.title;
    player.allow = "autoplay; accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share";
    player.allowFullscreen = true;
    player.tabIndex = 0;
    elements.playerFrame.append(player);
  }
  window.setTimeout(() => elements.playerModal.focus(), 0);
}

function getDisplaySource(video) {
  const parsed = parseVideoUrl(video.url);
  return parsed.source || video.source;
}

function isExternalEntry(video) {
  return video.kind === "external" || parseVideoUrl(video.url).kind === "external";
}

function deleteVideo(id) {
  if (state.busy) return;
  const video = state.videos.find((item) => item.id === id);
  if (!video) return;
  const shouldDelete = window.confirm(`删除「${video.title}」吗？`);
  if (!shouldDelete) return;
  state.syncGeneration++;
  state.busy = true;

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
      window.alert(getFriendlyErrorMessage(error, "删除失败，请稍后再试。"));
    }).finally(() => { state.busy = false; });
}

async function handleEditSubmit(event) {
  event.preventDefault();
  if (state.busy) return;

  const video = state.videos.find((item) => item.id === state.editingId);
  if (!video) return;
  const parsedEntries = parseVideoEntries(elements.editUrlInput.value);
  if (!parsedEntries.length) {
    setEditStatus("请输入一个有效的视频链接。");
    return;
  }

  const nextUrl = parsedEntries[0].url;
  const isUrlChanged = nextUrl !== video.url;
  const duplicate = state.videos.find((item) => item.id !== video.id && item.url === nextUrl);
  if (duplicate) {
    setEditStatus("这个链接已经在画廊里了。");
    return;
  }

  const updates = {
    title: elements.editTitleInput.value.trim() || video.title,
    url: nextUrl,
    category: serializeTags([...state.editingTags, elements.editTagInput.value]),
  };

  elements.editForm.querySelector("button[type='submit']").disabled = true;
  state.syncGeneration++;
  state.busy = true;
  setEditStatus(isUrlChanged ? "正在重新整理视频链接..." : "正在保存...");

  try {
    if (isUrlChanged) {
      const metadata = await getVideoMetadata(nextUrl);
      Object.assign(updates, {
        thumbnail: metadata.thumbnail || makeFallbackThumbnail(updates.title, metadata.source),
        source: metadata.source,
        embedUrl: metadata.embedUrl,
        kind: metadata.kind,
      });
      setEditStatus("正在保存...");
    }
    const updatedVideo = await updatePersistedVideo(video.id, updates);
    Object.assign(video, updatedVideo || updates);
    saveVideos();
    render();
    closeEditModal();
  } catch (error) {
    setEditStatus(getFriendlyErrorMessage(error, "保存失败，请稍后再试。"));
  } finally {
    state.busy = false;
    elements.editForm.querySelector("button[type='submit']").disabled = false;
  }
}

function getFriendlyErrorMessage(error, fallback) {
  const message = error?.message || "";
  if (/load failed|failed to fetch|network/i.test(message)) {
    return "网络请求失败，请检查网络后再试。";
  }
  return message || fallback;
}

async function loadRemoteVideos() {
  if (!state.writeToken || state.busy) return;
  const generation = state.syncGeneration;
  const token = state.writeToken;
  try {
    const response = await fetch(videosApiUrl({ _: Date.now() }), {
      cache: "no-store", headers: { "x-app-token": token },
    });
    if (!response.ok) throw new Error("remote unavailable");
    const videos = await response.json();
    if (generation !== state.syncGeneration || token !== state.writeToken || state.busy) return;
    state.lastRemoteRefreshAt = Date.now();
    state.storageMode = "remote";
    state.videos = videos;
    saveVideos();
    render();
  } catch {
    if (generation !== state.syncGeneration) return;
    state.storageMode = "offline";
  }
  renderSyncState();
}

function openSyncSettings() {
  if (state.busy) { window.alert("正在保存视频，请完成后再切换同步。"); return; }
  elements.syncModal.hidden = false;
  elements.syncTokenInput.value = "";
  elements.disconnectSyncButton.hidden = !state.writeToken;
  elements.syncStatus.textContent = state.writeToken
    ? "断开同步后会回到本地收藏，不会删除云端视频。重新连接时，如果此浏览器有本地收藏，会询问是否导入云端。"
    : "没有自行部署？无需填写，直接使用本地收藏即可。连接后显示云端收藏；如果此浏览器有本地收藏，会询问是否导入，未经确认不会上传。";
  elements.syncTokenInput.focus();
}

function closeSyncSettings() {
  state.syncGeneration++;
  elements.syncModal.hidden = true;
  elements.syncTokenInput.value = "";
}

async function connectSync(event) {
  event.preventDefault();
  if (state.busy) return;
  const token = elements.syncTokenInput.value.trim();
  if (!token) return;
  let localVideos = [];
  try {
    localVideos = state.writeToken ? JSON.parse(localStorage.getItem(LOCAL_STORAGE_KEY) || "[]") : state.videos;
    if (!Array.isArray(localVideos)) localVideos = [];
    localVideos = structuredClone(localVideos);
  } catch { /* Never overwrite unreadable local data. */ }
  const generation = ++state.syncGeneration;
  elements.connectSyncButton.disabled = true;
  elements.syncStatus.textContent = "正在连接…";
  try {
    const response = await fetch(videosApiUrl(), { cache: "no-store", headers: { "x-app-token": token } });
    if (!response.ok) throw new Error(response.status === 401 ? "同步密钥不正确。" : "同步服务不可用，请检查自己的部署配置。");
    const videos = await response.json();
    if (generation !== state.syncGeneration || state.busy) return;
    localStorage.setItem("exercise-video-library:write-token", token);
    state.writeToken = token;
    state.storageMode = "remote";
    state.videos = videos;
    state.activeCategory = "all";
    state.lastRemoteRefreshAt = Date.now();
    saveVideos();
    render();
    renderSyncState();
    closeSyncSettings();
    if (!offerLocalImport(localVideos)) await hydrateSavedBilibiliVideos();
  } catch (error) {
    if (generation === state.syncGeneration) elements.syncStatus.textContent = getFriendlyErrorMessage(error, "连接失败。");
  } finally {
    elements.connectSyncButton.disabled = false;
  }
}

function offerLocalImport(videos) {
  if (!videos.length) return false;
  state.pendingLocalImport = { videos, token: state.writeToken };
  elements.localImportStatus.textContent = `连接成功。检测到本地有 ${videos.length} 个视频，是否导入云端？`;
  elements.localImportModal.hidden = false;
  elements.skipLocalImportButton.focus();
  return true;
}

function closeLocalImport() {
  if (state.busy) return;
  state.pendingLocalImport = null;
  elements.localImportModal.hidden = true;
  elements.syncButton.focus();
}

async function importLocalToCloud() {
  const pending = state.pendingLocalImport;
  if (state.busy || !pending) return;
  state.busy = true;
  state.syncGeneration++;
  elements.confirmLocalImportButton.disabled = true;
  elements.skipLocalImportButton.disabled = true;
  try {
    requireCloudConnection();
    if (!state.writeToken || pending.token !== state.writeToken) throw new Error("同步连接已改变，请重新连接后再导入。");
    const videos = parseBackup(JSON.stringify({ format: "workout-videos", version: 1,
      videos: pending.videos.map((video) => ({ title: video.title || "未命名视频", url: video.url,
        category: video.category || "未分类", thumbnail: safeCoverUrl(video.thumbnail) || "" })) }));
    const seen = new Set(state.videos.map((video) => safeHttpUrl(video.url)));
    const additions = videos.filter((video) => {
      if (seen.has(video.url)) return false;
      seen.add(video.url);
      return true;
    });
    if (additions.length) {
      elements.localImportStatus.textContent = `正在导入 ${additions.length} 个视频…`;
      const saved = await persistVideos(additions);
      state.videos = mergeVideos(saved, state.videos);
      saveVideos();
      render();
    }
    state.busy = false;
    closeLocalImport();
    window.alert(additions.length ? `已导入 ${additions.length} 个视频，跳过 ${videos.length - additions.length} 个重复项。本地收藏仍保留。` : "这些视频已在云端，无需重复导入。本地收藏仍保留。");
  } catch (error) {
    elements.localImportStatus.textContent = getFriendlyErrorMessage(error, "导入失败，本地收藏仍保留，请稍后重试。");
  } finally {
    state.busy = false;
    elements.confirmLocalImportButton.disabled = false;
    elements.skipLocalImportButton.disabled = false;
  }
}

function disconnectSync() {
  if (state.busy) return;
  try { localStorage.removeItem("exercise-video-library:write-token"); }
  catch { window.alert("浏览器不允许修改存储，未断开同步。"); return; }
  state.syncGeneration++;
  state.writeToken = "";
  state.storageMode = "local";
  state.activeCategory = "all";
  state.videos = loadVideos();
  render();
  renderSyncState();
  closeSyncSettings();
}

function requireCloudConnection() {
  if (state.writeToken && state.storageMode !== "remote") {
    throw new Error("云端未连接，暂时无法修改。请重新连接同步，或断开后使用本地收藏。");
  }
}

function refreshRemoteVideosWhenVisible() {
  if (document.visibilityState === "hidden") return;
  if (Date.now() - state.lastRemoteRefreshAt < 3000) return;
  loadRemoteVideos();
}

async function persistVideos(videos) {
  requireCloudConnection();
  if (!state.writeToken) {
    return videos;
  }

  const response = await fetch(VIDEOS_API, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...writeTokenHeader(),
    },
    body: JSON.stringify({ videos }),
  });

  if (response.status === 401) {
    promptForWriteToken();
    throw new Error("同步授权已失效，请重新连接后再保存。");
  }

  if (!response.ok) {
    throw new Error("Supabase 保存失败。");
  }

  return response.json();
}

async function deletePersistedVideo(id) {
  requireCloudConnection();
  if (!state.writeToken) {
    return;
  }

  const response = await fetch(videosApiUrl({ id }), {
    method: "DELETE",
    headers: writeTokenHeader(),
  });

  if (response.status === 401) {
    promptForWriteToken();
    throw new Error("同步授权已失效，请重新连接后再删除。");
  }

  if (!response.ok) {
    throw new Error("Supabase 删除失败。");
  }
}

async function updatePersistedVideo(id, updates) {
  requireCloudConnection();
  if (!state.writeToken) {
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
    throw new Error("同步授权已失效，请重新连接后再保存。");
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
    ...(state.writeToken ? { "x-app-token": state.writeToken } : {}),
  };
}

function promptForWriteToken() {
  state.storageMode = "offline";
  renderSyncState();
  openSyncSettings();
}

function getCategories() {
  const categories = [...new Set(state.videos.flatMap(getVideoTags))];
  return categories.sort((a, b) => {
    if (a === "未分类") return 1;
    if (b === "未分类") return -1;
    return a.localeCompare(b, "zh-Hans-CN");
  });
}

function getVideoTags(video) {
  return parseTags(video.category);
}

function parseTags(value) {
  const tags = String(value || "")
    .split(/[｜|,，、]/)
    .map(normalizeTag)
    .filter(Boolean);
  return sanitizeTags(tags);
}

function normalizeTag(tag) {
  return String(tag || "").trim().replace(/\s+/g, " ").slice(0, 16);
}

function uniqueTags(tags) {
  const seen = new Set();
  return tags.filter((tag) => {
    const key = tag.toLowerCase();
    if (!tag || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function sanitizeTags(tags) {
  const unique = uniqueTags(tags.map(normalizeTag)).slice(0, 3);
  const realTags = unique.filter((tag) => tag !== "未分类");
  return realTags.length ? realTags : ["未分类"];
}

function getRealTags(tags) {
  return uniqueTags(tags.map(normalizeTag))
    .filter((tag) => tag !== "未分类")
    .slice(0, 3);
}

function replaceSelectedTags(mode, tags) {
  const normalizedTags = getRealTags(tags);
  if (mode === "edit") {
    state.editingTags = normalizedTags;
  } else {
    state.selectedTags = normalizedTags;
  }
}

function serializeTags(tags) {
  const normalizedTags = sanitizeTags(tags).filter((tag) => tag !== "未分类");
  return normalizedTags.length ? normalizedTags.join("｜") : "未分类";
}

function createVideo(entry, metadata, category) {
  const title = entry.title || metadata.title || fallbackTitle(entry.url, metadata.source);

  return {
    id: crypto.randomUUID(),
    url: entry.url,
    title,
    category,
    thumbnail: metadata.thumbnail || "",
    source: metadata.source,
    embedUrl: metadata.embedUrl,
    kind: metadata.kind,
    createdAt: Date.now(),
  };
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
  renderTagPicker("add");
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
  state.editingTags = getRealTags(getVideoTags(video));
  elements.editTitleInput.value = video.title;
  elements.editUrlInput.value = video.url;
  elements.editTagInput.value = "";
  renderTagPicker("edit");
  setEditStatus("");
  elements.editModal.hidden = false;
  window.setTimeout(() => elements.editTitleInput.focus(), 0);
}

function closeEditModal() {
  state.editingId = null;
  state.editingTags = [];
  elements.editModal.hidden = true;
  elements.editForm.reset();
  setEditStatus("");
}

function handleBackdropClick(event) {
  if (event.target === elements.playerModal) closePlayerModal();
}

function handleKeydown(event) {
  if (event.key === "Escape") {
    if (!elements.localImportModal.hidden) { closeLocalImport(); return; }
    if (!elements.syncModal.hidden) closeSyncSettings();
    if (!elements.playerModal.hidden) closePlayerModal();
    if (!elements.editModal.hidden) closeEditModal();
    if (!elements.tagRenameModal.hidden) closeTagRenameModal();
    if (!elements.addModal.hidden) closeAddModal();
    return;
  }

  if (elements.playerModal.hidden || isTypingTarget(event.target)) return;
  const player = elements.playerFrame.querySelector("video");
  if (!player) return;

  if (event.code === "Space") {
    event.preventDefault();
    if (player.paused) {
      player.play().catch(() => {});
    } else {
      player.pause();
    }
  }

  if (event.key.toLowerCase() === "m") {
    event.preventDefault();
    player.muted = !player.muted;
  }

  if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
    event.preventDefault();
    const delta = event.key === "ArrowLeft" ? -5 : 5;
    player.currentTime = Math.min(Math.max(player.currentTime + delta, 0), player.duration || player.currentTime + delta);
  }
}

function isTypingTarget(target) {
  return target?.closest?.("input, textarea, select, button, a, [contenteditable='true']");
}

function clearForm(shouldFocus = true) {
  elements.form.reset();
  state.selectedTags = [];
  renderTagPicker("add");
  setStatus("");
  if (shouldFocus) elements.urlsInput.focus();
}

function setStatus(message) {
  elements.statusLine.textContent = message;
}

function setEditStatus(message) {
  elements.editStatusLine.textContent = message;
}

function setTagRenameStatus(message) {
  elements.tagRenameStatusLine.textContent = message;
}

function loadVideos() {
  try {
    const stored = localStorage.getItem(getStorageKey());
    const videos = JSON.parse(stored || (state.writeToken ? localStorage.getItem(LEGACY_STORAGE_KEY) : "[]") || "[]");
    if (!Array.isArray(videos) || videos.some((video) => !video || typeof video.url !== "string")) throw new Error("Invalid saved library");
    state.storageBlockedKey = "";
    return videos;
  } catch {
    state.storageBlockedKey = getStorageKey();
    warnStorage("无法读取浏览器收藏。原始数据未被覆盖；请先保留浏览器数据。当前操作仅保留在此页面，请及时导出。");
    return [];
  }
}

function saveVideos() {
  try {
    if (state.storageBlockedKey === getStorageKey()) throw new Error("Unreadable original storage");
    localStorage.setItem(getStorageKey(), JSON.stringify(state.videos));
  } catch {
    warnStorage(state.writeToken ? "无法保存本机缓存。云端操作请以同步结果为准。" : "浏览器存储不可用或已满，当前改动仅保留在此页面。关闭或刷新前请导出备份。");
  }
}

function readStoredToken() {
  try { return localStorage.getItem("exercise-video-library:write-token") || ""; }
  catch { return ""; }
}

function warnStorage(message) {
  const note = document.querySelector(".footer-note");
  if (note) { note.textContent = message; note.setAttribute("role", "alert"); }
  if (!state.storageWarningShown) {
    state.storageWarningShown = true;
    window.setTimeout(() => window.alert(message), 0);
  }
}

function getStorageKey() {
  return state.writeToken ? `${STORAGE_PREFIX}:default` : LOCAL_STORAGE_KEY;
}

function videosApiUrl(params = {}) {
  const searchParams = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null) searchParams.set(key, value);
  });
  return `${VIDEOS_API}?${searchParams.toString()}`;
}

async function hydrateSavedBilibiliVideos() {
  const generation = state.syncGeneration;
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
    if (generation !== state.syncGeneration || state.busy) return;
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
