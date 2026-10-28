// `?perf=1` — a field recorder for "it was laggy on my machine".
//
// Lag that only shows on one real visit (cold cache, one browser, one moment)
// never reproduces in a rig, so this records it where it happens. It starts as
// early as the main bundle runs, keeps a per-second summary of frame pacing for
// the whole visit, collects the browser's own long-frame reports with the
// scripts that caused them, and marks when the intro settled — so a report
// says not just "frames were slow" but when, and what was running. "Copy
// report" puts it all on the clipboard as JSON; "Save" downloads it.
//
// Plain DOM, no React: it must not perturb what it measures, and it has to be
// up before the app mounts. Loaded only behind the query param (main.jsx), so
// normal visitors never download it.

const FRAME_SLOW = 1000 / 60 + 1; // a missed vsync at 60Hz
const FRAME_JANK = 2 * (1000 / 60) + 1; // two or more missed
const LIVE_WINDOW_MS = 5000;
const MAX_LOAF = 60; // keep the worst N long animation frames
const SLOW_RESOURCE_MS = 1000;

const t0 = performance.timeOrigin;
const seconds = new Map(); // whole second since navigation -> bucket
const recent = []; // [timestamp, delta] inside the live window
const milestones = [{ at: 0, what: "navigation start" }];
let loafs = [];
let lastFrame = 0;

const mark = (what) => milestones.push({ at: Math.round(performance.now()), what });

function onFrame(now) {
  if (lastFrame) {
    const d = now - lastFrame;
    const s = Math.floor(now / 1000);
    let b = seconds.get(s);
    if (!b) seconds.set(s, (b = { s, frames: 0, slow: 0, jank: 0, worst: 0 }));
    b.frames++;
    if (d > FRAME_SLOW) b.slow++;
    if (d > FRAME_JANK) b.jank++;
    if (d > b.worst) b.worst = d;
    recent.push([now, d]);
    while (recent.length && recent[0][0] < now - LIVE_WINDOW_MS) recent.shift();
  }
  lastFrame = now;
  requestAnimationFrame(onFrame);
}

// A hidden tab stops rAF entirely; the first frame back would read as one
// enormous stall, so drop the gap and say what happened instead.
document.addEventListener("visibilitychange", () => {
  lastFrame = 0;
  mark(document.hidden ? "tab hidden" : "tab visible");
});

// Long Animation Frames (Chromium): each entry names the scripts that ran in a
// frame over 50ms, with source URL and function. Buffered, so frames that
// happened before this module loaded are included.
function observeLongFrames() {
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        loafs.push({
          at: Math.round(e.startTime),
          duration: Math.round(e.duration),
          blocking: Math.round(e.blockingDuration ?? 0),
          renderMs: Math.round(e.renderStart ? e.startTime + e.duration - e.renderStart : 0),
          scripts: (e.scripts ?? [])
            .slice()
            .sort((a, b) => b.duration - a.duration)
            .slice(0, 3)
            .map((sc) => ({
              ms: Math.round(sc.duration),
              invoker: sc.invoker,
              fn: sc.sourceFunctionName || undefined,
              src: sc.sourceURL ? sc.sourceURL.split("/").pop() : undefined,
              char: sc.sourceCharPosition >= 0 ? sc.sourceCharPosition : undefined,
            })),
        });
      }
      if (loafs.length > MAX_LOAF) {
        loafs = loafs.sort((a, b) => b.duration - a.duration).slice(0, MAX_LOAF);
      }
    }).observe({ type: "long-animation-frame", buffered: true });
    return "long-animation-frame";
  } catch {
    // Safari / Firefox: no LoAF. The per-second frame summary still works.
    return "unsupported";
  }
}

// The intro hands over to the wall when .ui-chrome mounts (App.jsx), which is
// the moment "after the intro, while looking around" starts.
function watchSettle() {
  const seen = () => {
    if (!document.querySelector(".ui-chrome")) return false;
    mark("intro settled (.ui-chrome mounted)");
    return true;
  };
  if (seen()) return;
  const mo = new MutationObserver(() => {
    if (seen()) mo.disconnect();
  });
  mo.observe(document.documentElement, { childList: true, subtree: true });
}

function gpuName() {
  try {
    const gl = document.createElement("canvas").getContext("webgl");
    const ext = gl?.getExtension("WEBGL_debug_renderer_info");
    return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : "unknown";
  } catch {
    return "unknown";
  }
}

const median = (xs) => {
  if (!xs.length) return 0;
  const s = xs.slice().sort((a, b) => a - b);
  return s[s.length >> 1];
};

function buildReport(loafSupport) {
  const buckets = [...seconds.values()].sort((a, b) => a.s - b.s);
  const all = recent.map((r) => r[1]);
  return {
    page: location.href,
    recordedAt: new Date(t0).toISOString(),
    durationS: Math.round(performance.now() / 1000),
    env: {
      ua: navigator.userAgent,
      dpr: devicePixelRatio,
      viewport: `${innerWidth}x${innerHeight}`,
      screen: `${screen.width}x${screen.height}`,
      cores: navigator.hardwareConcurrency,
      memoryGB: navigator.deviceMemory,
      gpu: gpuName(),
      // Median frame interval of the live window ≈ the display's refresh.
      refreshHzEstimate: all.length ? Math.round(1000 / median(all)) : null,
      longFrameApi: loafSupport,
    },
    milestones,
    // One row per second: frames drawn, frames that missed one vsync (slow) or
    // two+ (jank), and the single worst frame in ms.
    perSecond: buckets.map((b) => [b.s, b.frames, b.slow, b.jank, Math.round(b.worst)]),
    perSecondColumns: ["second", "frames", "slow", "jank", "worstMs"],
    longFrames: loafs.slice().sort((a, b) => a.at - b.at),
    slowResources: performance
      .getEntriesByType("resource")
      .filter((r) => r.duration > SLOW_RESOURCE_MS)
      .map((r) => ({
        url: r.name.replace(location.origin, ""),
        startS: +(r.startTime / 1000).toFixed(1),
        ms: Math.round(r.duration),
        cached: r.transferSize === 0,
      })),
  };
}

function mountPanel(loafSupport) {
  const box = document.createElement("div");
  box.setAttribute("aria-hidden", "true");
  box.style.cssText =
    // Bottom-left: the top-left is the nav, bottom-right the intro readout/skip.
    "position:fixed;bottom:8px;left:8px;z-index:2147483647;padding:6px 8px;" +
    "font:11px/1.4 var(--font-main, ui-monospace, monospace);color:#fff;" +
    "background:rgba(0,0,0,.92);border:1px solid rgba(255,255,255,.25);" +
    "white-space:pre;pointer-events:auto";
  const line = document.createElement("div");
  const btn = (label, onClick) => {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = label;
    b.style.cssText =
      "margin:4px 6px 0 0;padding:1px 6px;font:inherit;color:#fff;cursor:pointer;" +
      "background:transparent;border:1px solid rgba(255,255,255,.4)";
    b.addEventListener("click", onClick);
    return b;
  };
  const flash = (b, text) => {
    const was = b.textContent;
    b.textContent = text;
    setTimeout(() => (b.textContent = was), 1400);
  };
  const json = () => JSON.stringify(buildReport(loafSupport), null, 1);
  const copy = btn("copy report", async (e) => {
    // Read before the await: the event's currentTarget is null once dispatch ends.
    const b = e.currentTarget;
    try {
      await navigator.clipboard.writeText(json());
      flash(b, "copied");
    } catch {
      flash(b, "use save");
    }
  });
  const save = btn("save", () => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([json()], { type: "application/json" }));
    a.download = `perf-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });
  box.append(line, copy, save);
  document.body.append(box);

  setInterval(() => {
    const ds = recent.map((r) => r[1]);
    const n = ds.length;
    const fps = n ? Math.round((n * 1000) / LIVE_WINDOW_MS) : 0;
    const worst = n ? Math.round(Math.max(...ds)) : 0;
    const slow = ds.filter((d) => d > FRAME_SLOW).length;
    const jank = ds.filter((d) => d > FRAME_JANK).length;
    line.textContent =
      `last 5s  fps ${fps}  worst ${worst}ms  slow ${slow}  jank ${jank}\n` +
      `long frames ${loafSupport === "unsupported" ? "n/a" : loafs.length}  ` +
      `t ${Math.round(performance.now() / 1000)}s`;
  }, 500);
}

export function startPerfProbe() {
  requestAnimationFrame(onFrame);
  const loafSupport = observeLongFrames();
  const ready = () => {
    watchSettle();
    mountPanel(loafSupport);
  };
  if (document.body) ready();
  else document.addEventListener("DOMContentLoaded", ready, { once: true });
}
