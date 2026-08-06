/**
 * Runs before every spec.
 *
 * jsdom implements neither `matchMedia` nor `crypto.randomUUID`, and both are read at
 * construction time by services the whole app depends on — ThemeService reads the OS
 * colour preference, ShelfComponent reads the phone width, ReactorService mints the
 * anonymous id. Without these a spec fails on injection before it reaches its own
 * assertions, which is a fact about jsdom rather than about the code under test.
 *
 * `setMediaQuery` lets a spec state the viewport it is describing.
 */

const matches = new Map<string, boolean>();

interface FakeMediaQueryList extends MediaQueryList {
  fire(value: boolean): void;
}

const lists = new Map<string, FakeMediaQueryList>();

/** Declares what a query answers from now on, and notifies anything listening. */
export function setMediaQuery(query: string, value: boolean): void {
  matches.set(query, value);
  lists.get(query)?.fire(value);
}

/** Back to "nothing matches", so one spec's viewport cannot leak into the next. */
export function resetMediaQueries(): void {
  matches.clear();
  lists.clear();
}

function createList(query: string): FakeMediaQueryList {
  const listeners = new Set<(event: MediaQueryListEvent) => void>();

  const list = {
    media: query,
    get matches() {
      return matches.get(query) ?? false;
    },
    onchange: null,
    addEventListener: (_type: string, listener: EventListenerOrEventListenerObject) =>
      listeners.add(listener as (event: MediaQueryListEvent) => void),
    removeEventListener: (_type: string, listener: EventListenerOrEventListenerObject) =>
      listeners.delete(listener as (event: MediaQueryListEvent) => void),
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => true,
    fire(value: boolean) {
      const event = { matches: value, media: query } as MediaQueryListEvent;
      for (const listener of listeners) listener(event);
    },
  };

  return list as unknown as FakeMediaQueryList;
}

window.matchMedia = ((query: string) => {
  const existing = lists.get(query);
  if (existing) return existing;

  const list = createList(query);
  lists.set(query, list);
  return list;
}) as typeof window.matchMedia;

/**
 * jsdom under this runner exposes no `localStorage`. ThemeService and ReactorService
 * both guard against storage being unavailable and would silently take that path,
 * so the specs that describe *remembering* need a real one to assert against.
 */
if (!globalThis.localStorage) {
  const entries = new Map<string, string>();

  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      get length() {
        return entries.size;
      },
      key: (index: number) => [...entries.keys()][index] ?? null,
      getItem: (key: string) => entries.get(key) ?? null,
      setItem: (key: string, value: string) => void entries.set(key, String(value)),
      removeItem: (key: string) => void entries.delete(key),
      clear: () => entries.clear(),
    } satisfies Storage,
  });
}

if (!globalThis.crypto?.randomUUID) {
  Object.defineProperty(globalThis.crypto ?? (globalThis as { crypto?: Crypto }), 'randomUUID', {
    configurable: true,
    value: () => `00000000-0000-4000-8000-${Date.now().toString(16).padStart(12, '0')}`,
  });
}
