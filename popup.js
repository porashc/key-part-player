const searchForm = document.getElementById("searchForm");
const searchInput = document.getElementById("searchInput");
const searchResultsEl = document.getElementById("searchResults");
const nowPlayingEl = document.getElementById("nowPlaying");
const queueListEl = document.getElementById("queueList");
const clearQueueBtn = document.getElementById("clearQueueBtn");

function send(msg) {
  return chrome.runtime.sendMessage(msg);
}

searchForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const query = searchInput.value.trim();
  if (!query) return;
  searchResultsEl.innerHTML = `<div class="empty-note">Searching…</div>`;
  const { results } = await send({ type: "SEARCH", query });
  renderResults(results || []);
});

function renderResults(results) {
  if (!results.length) {
    searchResultsEl.innerHTML = `<div class="empty-note">No results.</div>`;
    return;
  }
  searchResultsEl.innerHTML = "";
  for (const r of results) {
    const row = document.createElement("div");
    row.className = "result-item";
    row.innerHTML = `
      <img src="${r.thumbnail}" alt="" />
      <div class="result-title">${escapeHtml(r.title)}</div>
      <button class="add-btn">+ Queue</button>
    `;
    row.querySelector(".add-btn").addEventListener("click", async () => {
      await send({ type: "ADD_TO_QUEUE", item: r });
      refresh();
    });
    searchResultsEl.appendChild(row);
  }
}

clearQueueBtn.addEventListener("click", async () => {
  await send({ type: "CLEAR_QUEUE" });
  refresh();
});

function renderState(state) {
  renderNowPlaying(state);
  renderQueue(state);
}

function renderNowPlaying(state) {
  const np = state.nowPlaying;
  if (state.currentIndex === -1 || !state.queue[state.currentIndex]) {
    nowPlayingEl.innerHTML = `<div class="np-empty">Nothing playing — add a song above.</div>`;
    return;
  }
  const current = state.queue[state.currentIndex];

  if (!np) {
    nowPlayingEl.innerHTML = `
      <div class="np-title">${escapeHtml(current.title)}</div>
      <div class="np-meta">loading key part…</div>
    `;
    return;
  }

  const windowLen = Math.max(0.001, np.endTime - np.startTime);
  const played = Math.max(0, (np.currentTime || np.startTime) - np.startTime);
  const pct = Math.min(100, (played / windowLen) * 100);

  nowPlayingEl.innerHTML = `
    <div class="np-title">${escapeHtml(np.title || current.title)}</div>
    <div class="np-meta">
      ${fmt(np.startTime)}–${fmt(np.endTime)}
      ${np.usedHeatmap ? "· from most-replayed part" : "· estimated highlight"}
    </div>
    <div class="np-bar-track"><div class="np-bar-fill" style="width:${pct}%"></div></div>
    <div class="np-controls">
      <button id="skipBtn">Skip ▶▶</button>
    </div>
  `;
  document.getElementById("skipBtn").addEventListener("click", async () => {
    await send({ type: "SKIP" });
    refresh();
  });
}

function renderQueue(state) {
  if (!state.queue.length) {
    queueListEl.innerHTML = `<div class="empty-note">Queue is empty.</div>`;
    return;
  }
  queueListEl.innerHTML = "";
  state.queue.forEach((item, idx) => {
    const row = document.createElement("div");
    row.className = "queue-item" + (idx === state.currentIndex ? " current" : "");
    row.innerHTML = `
      <div class="idx">${idx === state.currentIndex ? "▶" : idx + 1}</div>
      <div class="title">${escapeHtml(item.title)}</div>
      <button class="remove" title="Remove">✕</button>
    `;
    row.querySelector(".remove").addEventListener("click", async () => {
      await send({ type: "REMOVE_FROM_QUEUE", index: idx });
      refresh();
    });
    queueListEl.appendChild(row);
  });
}

function fmt(seconds) {
  const s = Math.max(0, Math.round(seconds || 0));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r.toString().padStart(2, "0")}`;
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str || "";
  return div.innerHTML;
}

async function refresh() {
  const { state } = await send({ type: "GET_STATE" });
  renderState(state);
}

refresh();
setInterval(refresh, 1000); // keep the progress bar / now-playing info live
