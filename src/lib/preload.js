// Asset warm-up helpers, formerly private to the Loader component. They live in
// App now (not the intro overlay) so skipping the intro — which unmounts the
// overlay — can never cancel the preload the scene mount is gated on.

// Warm one asset into the browser HTTP cache. Resolves on success OR failure — a single
// missing frame must never stall the whole gate.
export function preloadImage(url) {
  return new Promise((resolve) => {
    const img = new Image();
    // Off-DOM images are deprioritized by the browser, but these gate the hero
    // reveal — they ARE the critical bytes.
    img.fetchPriority = "high";
    img.onload = () => resolve();
    img.onerror = () => resolve();
    img.src = url;
  });
}

// Run tasks with a small concurrency cap so we don't fire hundreds of requests at once.
export async function runPool(tasks, concurrency, onEach) {
  let i = 0;
  const worker = async () => {
    while (i < tasks.length) {
      const task = tasks[i++];
      await task();
      onEach?.();
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(concurrency, tasks.length) }, worker),
  );
}
