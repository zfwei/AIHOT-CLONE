export interface AutoRefreshOptions {
  intervalMs: number;
  pauseWhileReading?: boolean;
  available: () => boolean;
  refresh: () => Promise<void>;
  checked: (at: Date) => void;
  failed: () => void;
}

/** Revalidate the current route without navigation; hidden tabs and active input stay untouched. */
export function startAutoRefresh(options: AutoRefreshOptions) {
  let stopped = false;
  let pending = false;
  let lastStarted = 0;
  let reading = Boolean(options.pauseWhileReading && window.scrollY > 120);
  const request = async (manual = false) => {
    const active = document.activeElement;
    const editing = active?.matches('input, textarea, select, [contenteditable]:not([contenteditable="false"])') || active?.closest('[role="dialog"]');
    if (stopped || pending || !options.available() || document.visibilityState !== "visible" || !navigator.onLine) return;
    if (!manual && (editing || (options.pauseWhileReading && window.scrollY > 120) || Date.now() - lastStarted < 1000)) return;
    pending = true;
    lastStarted = Date.now();
    try {
      await options.refresh();
      if (!stopped) options.checked(new Date());
    } catch {
      if (!stopped) options.failed();
    } finally {
      pending = false;
    }
  };
  const check = () => { void request(); };
  const onScroll = () => {
    const next = window.scrollY > 120;
    if (reading && !next) check();
    reading = next;
  };
  const timer = window.setInterval(check, options.intervalMs);
  window.addEventListener("focus", check);
  window.addEventListener("online", check);
  document.addEventListener("visibilitychange", check);
  if (options.pauseWhileReading) window.addEventListener("scroll", onScroll, { passive: true });
  return {
    refresh: () => request(true),
    stop: () => {
      stopped = true;
      window.clearInterval(timer);
      window.removeEventListener("focus", check);
      window.removeEventListener("online", check);
      document.removeEventListener("visibilitychange", check);
      if (options.pauseWhileReading) window.removeEventListener("scroll", onScroll);
    },
  };
}
