# Key Part Player

A Chrome extension: search YouTube, queue songs, and it plays **only the
highlight/most-replayed section of each song** — then auto-advances to the
next one. No YouTube API key needed.

## How it works

- **Search**: scrapes `youtube.com/results` (no API key) for video results.
- **Queue**: held in the background service worker + `chrome.storage.local`.
- **Playback**: a hidden **offscreen document** loads the real
  `youtube.com/watch` page in an invisible iframe. A content script injected
  into that iframe:
  1. Waits for the real `<video>` element and its metadata.
  2. Looks for YouTube's own **"most replayed" heatmap** SVG on the seek bar
     and parses it to find the most-replayed timestamp.
  3. Seeks to a ~28s window around that peak, plays it, fades in/out
     (~1.5s) at the edges, then reports back and the background worker
     advances the queue.
  4. If a video has no heatmap (too new / not enough views), it falls back
     to starting 30% into the song for 25 seconds.

No YouTube Data API, no audio downloading, no BPM/beat detection — this
version is intentionally simple: heatmap-in, highlight-window-out.

## Installing it (unpacked, for personal use)

1. Open `chrome://extensions`.
2. Enable **Developer mode** (top right).
3. Click **Load unpacked** and select this `key-part-player` folder.
4. Click the extension icon, search for a song, hit **+ Queue**.

## Known limitations / things worth knowing

- **This scrapes YouTube's page structure**, which is unofficial and can
  break whenever YouTube changes their frontend. If search stops returning
  results, or the heatmap stops being found, that's the likely cause —
  the `walk()` function in `background.js` and the heatmap selector in
  `content_script.js` are the two places most likely to need updating.
- **Not every video has a heatmap** — it requires enough views/data. Those
  videos use the fixed 30%-in fallback, which is a rough heuristic, not a
  real "find the chorus" algorithm.
- **Ads**: the hidden iframe is a real YouTube watch page, so pre-roll ads
  can play there too, which will delay when the key-part detection kicks in.
  There's no ad-blocking logic here.
- **Autoplay-with-sound policies**: browsers restrict autoplay with audio
  unless there's been a relevant user gesture. Since the offscreen document
  is created right after you click "+ Queue" in the popup (a real user
  gesture), this generally works — but if you see silent playback, that's
  the first thing to check.
- **ToS note**: scraping YouTube's pages (for search and for the heatmap)
  is outside YouTube's official API and is a grey area under their Terms of
  Service. This is intended for personal, unpublished use — not something
  to ship to the Chrome Web Store as-is.
- **The heatmap parser is a heuristic**: it bins the SVG path into 40
  buckets and picks the highest-intensity bucket. It's deliberately
  forgiving of exact coordinate quirks, but it's still reverse-engineered
  from an undocumented element, not an official API — treat it as "usually
  finds a good moment," not "always finds the exact chorus."

## Where to go next (optional)

- Adjustable window length in the popup (currently fixed at ~28s / ~25s
  fallback).
- Skip-ads detection so the timer doesn't start counting during a pre-roll.
- A tiny backend proxy + the official YouTube Data API, if you ever want
  this to be reliable enough to publish rather than just run locally.
