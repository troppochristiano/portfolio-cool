import { useEffect, useRef, useState } from "react";

// Warm one asset into the browser HTTP cache. Resolves on success OR failure — a single
// missing frame must never stall the whole gate. Each settle bumps progress.
function preloadImage(url) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve();
    img.onerror = () => resolve();
    img.src = url;
  });
}

// Run tasks with a small concurrency cap so we don't fire hundreds of requests at once.
async function runPool(tasks, concurrency, onEach) {
  let i = 0;
  const worker = async () => {
    while (i < tasks.length) {
      const task = tasks[i++];
      await task();
      onEach();
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(concurrency, tasks.length) }, worker)
  );
}

export function Loader({ imageUrls, onPreloaded, done }) {
  const [progress, setProgress] = useState(0);
  const onPreloadedRef = useRef(onPreloaded);
  onPreloadedRef.current = onPreloaded;

  useEffect(() => {
    let cancelled = false;
    const total = imageUrls.length || 1;
    let loaded = 0;

    const tasks = imageUrls.map((u) => () => preloadImage(u));

    runPool(tasks, 12, () => {
      if (cancelled) return;
      loaded += 1;
      setProgress(Math.round((loaded / total) * 100));
    }).then(() => {
      if (cancelled) return;
      setProgress(100);
      onPreloadedRef.current(); // cache warm — parent can mount the scene now
    });

    return () => {
      cancelled = true;
    };
  }, [imageUrls]);

  return (
    <div className={`loader${done ? " is-hidden" : ""}`} aria-hidden={done}>
      <div className="loader__inner">
        <div className="loader__bar">
          <div className="loader__fill" style={{ width: `${progress}%` }} />
        </div>
        <div className={`loader__pct${progress >= 100 && !done ? " is-warming" : ""}`}>
          {progress >= 100 && !done ? "Preparing…" : `${progress}%`}
        </div>
      </div>
    </div>
  );
}
