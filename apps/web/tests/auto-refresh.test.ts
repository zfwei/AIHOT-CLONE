import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { startAutoRefresh } from "../app/lib/auto-refresh.ts";

class TrackedTarget extends EventTarget {
  listeners = new Map<string, Set<EventListenerOrEventListenerObject>>();
  override addEventListener(type: string, listener: EventListenerOrEventListenerObject | null, options?: AddEventListenerOptions | boolean) {
    if (listener) {
      const listeners = this.listeners.get(type) ?? new Set();
      listeners.add(listener);
      this.listeners.set(type, listeners);
    }
    super.addEventListener(type, listener, options);
  }
  override removeEventListener(type: string, listener: EventListenerOrEventListenerObject | null, options?: EventListenerOptions | boolean) {
    if (listener) this.listeners.get(type)?.delete(listener);
    super.removeEventListener(type, listener, options);
  }
  emit(type: string) { this.dispatchEvent(new Event(type)); }
  listenerCount() { return [...this.listeners.values()].reduce((sum, listeners) => sum + listeners.size, 0); }
}

class FakeWindow extends TrackedTarget {
  scrollY = 0;
  timers = new Map<number, { callback: () => void; interval: number }>();
  nextTimer = 0;
  setInterval(callback: () => void, interval: number) { const id = ++this.nextTimer; this.timers.set(id, { callback, interval }); return id; }
  clearInterval(id: number) { this.timers.delete(id); }
  tick() { for (const { callback } of this.timers.values()) callback(); }
}

function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}
const flush = async () => { await Promise.resolve(); await Promise.resolve(); };

function setup(t: TestContext, pauseWhileReading = false) {
  const win = new FakeWindow();
  const doc = Object.assign(new TrackedTarget(), {
    visibilityState: "visible",
    activeElement: null as null | { matches: (selector: string) => boolean; closest: (selector: string) => object | null },
  });
  const nav = { onLine: true };
  const state = { available: true, calls: 0, failures: 0, checked: [] as Date[], now: 1_800_000_000_000, run: async () => {} };
  const originals = new Map<string, PropertyDescriptor | undefined>();
  for (const [name, value] of [["window", win], ["document", doc], ["navigator", nav]] as const) {
    originals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, value });
  }
  t.mock.method(Date, "now", () => state.now);
  const controller = startAutoRefresh({
    intervalMs: 60_000, pauseWhileReading, available: () => state.available,
    refresh: () => { state.calls++; return state.run(); },
    checked: (at) => state.checked.push(at), failed: () => state.failures++,
  });
  t.after(() => {
    controller.stop();
    for (const [name, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    }
  });
  return { win, doc, nav, state, controller, advance: (ms = 60_000) => { state.now += ms; } };
}

test("visible idle pages check on the configured interval and report successful completion", async (t) => {
  const { win, state, advance } = setup(t);
  assert.equal(state.calls, 0);
  assert.equal(win.timers.size, 1);
  assert.equal([...win.timers.values()][0].interval, 60_000);
  win.tick();
  await flush();
  assert.equal(state.calls, 1);
  assert.equal(state.checked.length, 1);
  assert.ok(state.checked[0] instanceof Date);
  advance();
  win.tick();
  await flush();
  assert.equal(state.calls, 2);
  assert.equal(state.checked.length, 2);
  assert.equal(state.failures, 0);
});

test("hidden and offline pages skip timers and resume on visibility or online events", async (t) => {
  const { win, doc, nav, state, advance } = setup(t);
  doc.visibilityState = "hidden";
  win.tick();
  win.emit("focus");
  doc.emit("visibilitychange");
  await flush();
  assert.equal(state.calls, 0);
  doc.visibilityState = "visible";
  doc.emit("visibilitychange");
  await flush();
  assert.equal(state.calls, 1);
  advance();
  nav.onLine = false;
  win.tick();
  win.emit("focus");
  await flush();
  assert.equal(state.calls, 1);
  nav.onLine = true;
  win.emit("online");
  await flush();
  assert.equal(state.calls, 2);
});

test("focus and visibility events deduplicate even after a fast request has completed", async (t) => {
  const { win, doc, state, advance } = setup(t);
  win.emit("focus");
  doc.emit("visibilitychange");
  await flush();
  doc.emit("visibilitychange");
  win.emit("focus");
  await flush();
  assert.equal(state.calls, 1);
  advance(999);
  win.tick();
  await flush();
  assert.equal(state.calls, 1);
  advance(1);
  win.emit("focus");
  await flush();
  assert.equal(state.calls, 2);
});

test("manual refresh bypasses the reading pause while pending requests and route work remain exclusive", async (t) => {
  const { win, state, controller, advance } = setup(t, true);
  win.scrollY = 600;
  win.tick();
  assert.equal(state.calls, 0);
  const pending = deferred();
  state.run = () => pending.promise;
  const manual = controller.refresh();
  assert.equal(state.calls, 1);
  advance();
  win.tick();
  win.emit("focus");
  await controller.refresh();
  assert.equal(state.calls, 1);
  assert.equal(state.checked.length, 0);
  pending.resolve();
  await manual;
  assert.equal(state.checked.length, 1);
  state.run = async () => {};
  state.available = false;
  await controller.refresh();
  win.scrollY = 0;
  win.tick();
  await flush();
  assert.equal(state.calls, 1);
  state.available = true;
  win.scrollY = 600;
  await controller.refresh();
  assert.equal(state.calls, 2);
});

test("active form editing and dialog focus defer automatic refresh until interaction ends", async (t) => {
  const { win, doc, state } = setup(t);
  for (const tag of ["input", "textarea", "select", "contenteditable"]) {
    doc.activeElement = { matches: (selector) => selector.includes(tag), closest: () => null };
    win.tick();
    win.emit("focus");
    await flush();
    assert.equal(state.calls, 0, tag);
  }
  doc.activeElement = { matches: () => false, closest: (selector) => selector === '[role="dialog"]' ? {} : null };
  win.tick();
  await flush();
  assert.equal(state.calls, 0);
  doc.activeElement = null;
  win.tick();
  await flush();
  assert.equal(state.calls, 1);
});

test("reading away from the top pauses checks and returning to the top triggers one check", async (t) => {
  const { win, state, advance } = setup(t, true);
  win.scrollY = 121;
  win.emit("scroll");
  win.tick();
  win.emit("focus");
  await flush();
  assert.equal(state.calls, 0);
  win.scrollY = 120;
  win.emit("scroll");
  await flush();
  assert.equal(state.calls, 1);
  advance();
  win.scrollY = 0;
  win.emit("scroll");
  await flush();
  assert.equal(state.calls, 1, "scrolling within the top area does not repeatedly refresh");
  win.scrollY = 800;
  win.emit("scroll");
  win.scrollY = 0;
  win.emit("scroll");
  await flush();
  assert.equal(state.calls, 2);
});

test("stop removes timers and listeners and ignores a request that completes after cleanup", async (t) => {
  const { win, doc, state, controller } = setup(t, true);
  assert.equal(win.listenerCount(), 3);
  assert.equal(doc.listenerCount(), 1);
  const queuedTick = [...win.timers.values()][0].callback;
  const pending = deferred();
  state.run = () => pending.promise;
  const request = controller.refresh();
  assert.equal(state.calls, 1);
  controller.stop();
  controller.stop();
  assert.equal(win.timers.size, 0);
  assert.equal(win.listenerCount(), 0);
  assert.equal(doc.listenerCount(), 0);
  pending.resolve();
  await request;
  assert.equal(state.checked.length, 0);
  assert.equal(state.failures, 0);
  queuedTick();
  win.emit("focus");
  win.emit("online");
  win.emit("scroll");
  doc.emit("visibilitychange");
  await controller.refresh();
  assert.equal(state.calls, 1);
});

test("failed refreshes notify once, release the pending guard and allow a later successful check", async (t) => {
  const { win, state, controller, advance } = setup(t);
  state.run = async () => { throw new Error("Fixture loader failure"); };
  win.tick();
  await flush();
  assert.equal(state.failures, 1);
  assert.equal(state.checked.length, 0);
  state.run = async () => {};
  advance();
  win.tick();
  await flush();
  assert.equal(state.calls, 2);
  assert.equal(state.checked.length, 1);
  const pending = deferred();
  state.run = () => pending.promise;
  const request = controller.refresh();
  controller.stop();
  pending.reject(new Error("Fixture late failure"));
  await request;
  assert.equal(state.failures, 1, "cleanup suppresses late failure notifications too");
});
