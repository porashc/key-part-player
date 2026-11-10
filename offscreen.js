// offscreen.js
// This document's only job is to host a hidden iframe and navigate it to the
// requested YouTube watch page. All the real logic (finding the key part,
// playing it, fading, detecting when it's over) happens in content_script.js,
// which Chrome injects into that iframe because it matches youtube.com/watch*.

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === "LOAD_VIDEO") {
    const iframe = document.getElementById("player");
    // Cache-bust-ish param so a re-add of the same video still reloads cleanly.
    iframe.src = `https://www.youtube.com/watch?v=${encodeURIComponent(msg.videoId)}&autoplay=1&_t=${Date.now()}`;
  }
});
