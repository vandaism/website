/**
 * Guarded Web Storage access.
 *
 * `window.localStorage` / `window.sessionStorage` are not safe to touch directly:
 * the property getter itself throws `SecurityError` when storage is blocked
 * (Safari Private Browsing, third-party-cookie policies, some managed profiles),
 * `setItem` throws `QuotaExceededError` when the area is full, and stored JSON
 * can be corrupted by other scripts. Any of those thrown from a component method
 * aborts the rest of that method. These helpers turn every failure into a
 * `null` / `false` / fallback value so callers degrade to "no persistence".
 *
 * @typedef {object} Store
 * @property {(key: string) => string | null} get - Raw string, or null when missing or unreadable.
 * @property {(key: string, value: string) => boolean} set - True when persisted.
 * @property {(key: string) => void} remove
 * @property {<T>(key: string, fallback: T) => T} getJSON - Parsed value, or `fallback` when missing, unreadable or malformed.
 * @property {(key: string, value: unknown) => boolean} setJSON - True when persisted.
 */

/**
 * @param {'localStorage' | 'sessionStorage'} name
 * @returns {Store}
 */
function createStore(name) {
  /** @returns {Storage | null} */
  const area = () => {
    try {
      return window[name] ?? null;
    } catch {
      return null;
    }
  };

  /** @type {Store} */
  const store = {
    get(key) {
      try {
        return area()?.getItem(key) ?? null;
      } catch {
        return null;
      }
    },

    set(key, value) {
      try {
        const storage = area();
        if (!storage) return false;
        storage.setItem(key, value);
        return true;
      } catch {
        return false;
      }
    },

    remove(key) {
      try {
        area()?.removeItem(key);
      } catch {
        // Nothing to clean up if the area is unreachable.
      }
    },

    getJSON(key, fallback) {
      const raw = store.get(key);
      if (raw === null) return fallback;

      try {
        return JSON.parse(raw);
      } catch {
        return fallback;
      }
    },

    setJSON(key, value) {
      try {
        return store.set(key, JSON.stringify(value));
      } catch {
        return false;
      }
    },
  };

  return store;
}

export const localStore = createStore('localStorage');
export const sessionStore = createStore('sessionStorage');
