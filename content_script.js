// content_script.js
// Injected into every frame that navigates to https://www.youtube.com/watch*
// (see manifest "all_frames": true). We only want to act on the ONE hidden
// iframe our extension itself creates (inside offscreen.html) — never on a
// tab the person is actually browsing normally. So: bail out immediately if
// this frame is the top-level frame of a real tab.

if (window.top === window.self) {
  // Real, top-level YouTube tab the user is browsing themselves — do nothing.
} else {
  runPlayerLogic();
}

function runPlayerLogic() {
  const FADE_SECONDS = 1.5;
  const FALLBACK_START_FRACTION = 0.30; // if no heatmap: start 30% into the song
  const FALLBACK_WINDOW_SECONDS = 25;
  const HEATMAP_WAIT_MS = 7000; // how long we wait for the heatmap svg to render
  const HEATMAP_POLL_MS = 250;
  const WINDOW_LEAD_SECONDS = 6; // start a bit before the detected peak
  const WINDOW_LENGTH_SECONDS = 28;
  const MIN_WINDOW_SECONDS = 12;

  let handled = false; // guard against double-init if script re-runs
  let video = null;
  let startTime = 0;
  let endTime = 0;
  let videoId = new URLSearchParams(location.search).get("v") || "";

  waitFor(() => document.querySelector("video"), 15000)
    .then((v) => {
      video = v;
      return waitFor(() => video.duration && !isNaN(video.duration) && video.duration > 0, 15000);
    })
    .then(() => findHeatmapWindow())
    .then(({ start, end, usedHeatmap }) => {
      startTime = start;
      endTime = end;
      beginSegmentPlayback(usedHeatmap);
    })
    .catch(() => {
      // Couldn't even get a video element (ad-only frame, blocked, etc.)
      // Tell the background to just move on rather than hang the queue.
      chrome.runtime.sendMessage({ type: "SEGMENT_ENDED", videoId });
    });

  function waitFor(conditionFn, timeoutMs) {
    return new Promise((resolve, reject) => {
      const start = Date.now();
      const iv = setInterval(() => {
        let ok;
        try {
          ok = conditionFn();
        } catch (e) {
          ok = false;
        }
        if (ok) {
          clearInterval(iv);
          resolve(typeof conditionFn() === "object" ? conditionFn() : true);
        } else if (Date.now() - start > timeoutMs) {
          clearInterval(iv);
          reject(new Error("timeout"));
        }
      }, 150);
    });
  }

  async function findHeatmapWindow() {
    const duration = video.duration;
    const svgPath = await waitForHeatmapPath().catch(() => null);

    if (svgPath) {
      const peakFraction = peakFractionFromPath(svgPath);
      if (peakFraction !== null) {
        let start = Math.max(0, peakFraction * duration - WINDOW_LEAD_SECONDS);
        let end = Math.min(duration, start + WINDOW_LENGTH_SECONDS);
        if (end - start < MIN_WINDOW_SECONDS) {
          start = Math.max(0, end - MIN_WINDOW_SECONDS);
        }
        return { start, end, usedHeatmap: true };
      }
    }

    // Fallback: no heatmap available for this video (too new / too few views)
    let start = duration * FALLBACK_START_FRACTION;
    let end = Math.min(duration, start + FALLBACK_WINDOW_SECONDS);
    return { start, end, usedHeatmap: false };
  }

  function waitForHeatmapPath() {
    return new Promise((resolve, reject) => {
      const startedAt = Date.now();
      const iv = setInterval(() => {
        const svg = document.querySelector(".ytp-heat-map-svg path, svg.ytp-heat-map-svg path");
        if (svg && svg.getAttribute("d")) {
          clearInterval(iv);
          resolve(svg.getAttribute("d"));
          return;
        }
        if (Date.now() - startedAt > HEATMAP_WAIT_MS) {
          clearInterval(iv);
          reject(new Error("no heatmap"));
        }
      }, HEATMAP_POLL_MS);
    });
  }

  // Parse the heatmap SVG path into a normalized (time%, intensity) curve and
  // return the time-fraction (0..1) of the most-replayed region.
  // The path is a series of numbers; YouTube renders it on a ~1000x100 viewBox
  // where x = time position, y = inverted heat (smaller y = more replayed).
  function peakFractionFromPath(d) {
    const nums = (d.match(/-?\d+(\.\d+)?/g) || []).map(Number);
    if (nums.length < 4) return null;

    const points = [];
    for (let i = 0; i + 1 < nums.length; i += 2) {
      points.push({ x: nums[i], y: nums[i + 1] });
    }
    if (!points.length) return null;

    const maxX = Math.max(...points.map((p) => p.x)) || 1000;
    const normalized = points.map((p) => ({
      t: clamp01(p.x / maxX),
      intensity: clamp01((100 - p.y) / 100),
    }));

    // Bucket into bins to smooth out bezier-control-point noise, then pick
    // the bin with the highest average intensity, skipping the very first
    // and last few percent (intros/outros tend to spike due to curve edges).
    const BINS = 40;
    const sums = new Array(BINS).fill(0);
    const counts = new Array(BINS).fill(0);
    for (const p of normalized) {
      const bin = Math.min(BINS - 1, Math.floor(p.t * BINS));
      sums[bin] += p.intensity;
      counts[bin] += 1;
    }
    let bestBin = -1;
    let bestAvg = -1;
    for (let i = 1; i < BINS - 1; i++) {
      if (counts[i] === 0) continue;
      const avg = sums[i] / counts[i];
      if (avg > bestAvg) {
        bestAvg = avg;
        bestBin = i;
      }
    }
    if (bestBin === -1) return null;
    return (bestBin + 0.5) / BINS;
  }

  function clamp01(n) {
    return Math.max(0, Math.min(1, n));
  }

  function beginSegmentPlayback(usedHeatmap) {
    if (handled) return;
    handled = true;

    const title = document.title.replace(/\s*-\s*YouTube\s*$/, "");

    chrome.runtime.sendMessage({
      type: "VIDEO_READY",
      videoId,
      title,
      duration: video.duration,
      startTime,
      endTime,
      usedHeatmap,
    });

    try {
      video.currentTime = startTime;
    } catch (e) {
      /* some players need a play() first before seek sticks; ignore */
    }
    video.muted = false;
    video.volume = 0;
    video.play().catch(() => {});

    let fadingIn = true;
    let ended = false;

    const onTimeUpdate = () => {
      if (ended) return;
      const t = video.currentTime;

      if (fadingIn) {
        const p = clamp01((t - startTime) / FADE_SECONDS);
        video.volume = p;
        if (p >= 1) fadingIn = false;
      }

      const timeLeft = endTime - t;
      if (timeLeft <= FADE_SECONDS) {
        video.volume = clamp01(timeLeft / FADE_SECONDS);
      }

      if (t >= endTime) {
        finish();
      }

      chrome.runtime.sendMessage({ type: "PROGRESS", videoId, currentTime: t }).catch(() => {});
    };

    const onEnded = () => finish();

    function finish() {
      if (ended) return;
      ended = true;
      video.removeEventListener("timeupdate", onTimeUpdate);
      video.removeEventListener("ended", onEnded);
      try {
        video.pause();
      } catch (e) {}
      chrome.runtime.sendMessage({ type: "SEGMENT_ENDED", videoId });
    }

    video.addEventListener("timeupdate", onTimeUpdate);
    video.addEventListener("ended", onEnded);
  }
}
