// background.js — service worker
// Owns: queue state, YouTube search (scraped, no API key), and orchestration
// of the hidden offscreen player that actually plays each song's key part.

const STATE_KEY = "kpp_state_v1";

/** @type {{queue: Array<{videoId:string,title:string,thumbnail:string}>, currentIndex:number, nowPlaying: any}} */
let state = { queue: [], currentIndex: -1, nowPlaying: null };

async function loadState() {
  const stored = await chrome.storage.local.get(STATE_KEY);
  if (stored[STATE_KEY]) state = stored[STATE_KEY];
}
async function saveState() {
  await chrome.storage.local.set({ [STATE_KEY]: state });
}
loadState();

// ---------- Offscreen document management ----------

async function ensureOffscreenDocument() {
  const existing = await chrome.runtime.getContexts({
    contextTypes: ["OFFSCREEN_DOCUMENT"],
  });
  if (existing.length > 0) return;
  await chrome.offscreen.createDocument({
    url: "offscreen.html",
    reasons: ["IFRAME_SCRIPTING"],
    justification: "Hidden YouTube watch-page iframe used to play each song's key segment.",
  });
}

function loadVideoInOffscreen(videoId) {
  chrome.runtime.sendMessage({ type: "LOAD_VIDEO", videoId }).catch(() => {});
}

// ---------- YouTube search (scraped, no API key) ----------
// We fetch the public search results page and pull video entries out of the
// embedded ytInitialData JSON blob. This is unofficial and can break if
// YouTube changes its page structure — see README for notes.

async function searchYouTube(query) {
  const url = "https://www.youtube.com/results?search_query=" + encodeURIComponent(query);
  const res = await fetch(url, { credentials: "omit" });
  const html = await res.text();

  const match = html.match(/var ytInitialData\s*=\s*(\{.+?\});\s*<\/script>/s);
  if (!match) return [];

  let data;
  try {
    data = JSON.parse(match[1]);
  } catch (e) {
    return [];
  }

  const results = [];
  const seen = new Set();

  function walk(node) {
    if (!node || typeof node !== "object") return;
    if (node.videoRenderer) {
      const vr = node.videoRenderer;
      const videoId = vr.videoId;
      const title = vr.title?.runs?.[0]?.text || vr.title?.simpleText || "";
      const thumbs = vr.thumbnail?.thumbnails || [];
      const thumbnail = thumbs.length ? thumbs[thumbs.length - 1].url : "";
      if (videoId && title && !seen.has(videoId)) {
        seen.add(videoId);
        results.push({ videoId, title, thumbnail });
      }
    }
    for (const key in node) {
      if (Object.prototype.hasOwnProperty.call(node, key)) walk(node[key]);
    }
  }
  walk(data);

  return results.slice(0, 15);
}

// ---------- Queue orchestration ----------

async function addToQueue(item) {
  state.queue.push(item);
  await saveState();
  if (state.currentIndex === -1) {
    // nothing playing yet — start it
    state.currentIndex = 0;
    await saveState();
    await ensureOffscreenDocument();
    // small delay to let the offscreen doc finish initializing on first creation
    setTimeout(() => loadVideoInOffscreen(state.queue[state.currentIndex].videoId), 300);
  }
  return state;
}

async function advanceQueue() {
  if (state.currentIndex === -1) return;
  const nextIndex = state.currentIndex + 1;
  if (nextIndex < state.queue.length) {
    state.currentIndex = nextIndex;
    state.nowPlaying = null;
    await saveState();
    loadVideoInOffscreen(state.queue[nextIndex].videoId);
  } else {
    // queue exhausted
    state.currentIndex = -1;
    state.nowPlaying = null;
    await saveState();
  }
}

async function skipCurrent() {
  await advanceQueue();
}

async function removeFromQueue(idx) {
  if (idx === state.currentIndex) {
    // removing the one currently playing = skip
    state.queue.splice(idx, 1);
    state.nowPlaying = null;
    await saveState();
    if (state.currentIndex < state.queue.length) {
      loadVideoInOffscreen(state.queue[state.currentIndex].videoId);
    } else {
      state.currentIndex = -1;
      await saveState();
    }
    return;
  }
  state.queue.splice(idx, 1);
  if (idx < state.currentIndex) state.currentIndex -= 1;
  await saveState();
}

async function clearQueue() {
  state.queue = [];
  state.currentIndex = -1;
  state.nowPlaying = null;
  await saveState();
}

// ---------- Message routing ----------

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    switch (msg.type) {
      case "SEARCH": {
        const results = await searchYouTube(msg.query);
        sendResponse({ results });
        break;
      }
      case "ADD_TO_QUEUE": {
        await addToQueue(msg.item);
        sendResponse({ state });
        break;
      }
      case "SKIP": {
        await skipCurrent();
        sendResponse({ state });
        break;
      }
      case "REMOVE_FROM_QUEUE": {
        await removeFromQueue(msg.index);
        sendResponse({ state });
        break;
      }
      case "CLEAR_QUEUE": {
        await clearQueue();
        sendResponse({ state });
        break;
      }
      case "GET_STATE": {
        sendResponse({ state });
        break;
      }
      // ---- messages coming from the content script inside the hidden player ----
      case "VIDEO_READY": {
        state.nowPlaying = {
          videoId: msg.videoId,
          title: msg.title,
          duration: msg.duration,
          startTime: msg.startTime,
          endTime: msg.endTime,
          usedHeatmap: msg.usedHeatmap,
        };
        await saveState();
        sendResponse({ ok: true });
        break;
      }
      case "PROGRESS": {
        if (state.nowPlaying && state.nowPlaying.videoId === msg.videoId) {
          state.nowPlaying.currentTime = msg.currentTime;
        }
        sendResponse({ ok: true });
        break;
      }
      case "SEGMENT_ENDED": {
        await advanceQueue();
        sendResponse({ ok: true });
        break;
      }
      default:
        sendResponse({});
    }
  })();
  return true; // keep the message channel open for the async response
});
