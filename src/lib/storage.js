/**
 * Local-only persistence. Health data never leaves the browser unless the
 * user adds an AI key or connects Strava (which only reads from Strava).
 * Every access is guarded: storage can be disabled or full.
 */

const PREFIX = 'openwear:';

export function load(key, fallback = null) {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    return raw == null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}

/** Returns false if the value could not be saved (quota, private mode). */
export function save(key, value) {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
    return true;
  } catch (err) {
    console.warn(`OpenWear: could not persist "${key}" (${err.name}). Data stays in memory for this tab.`);
    return false;
  }
}

export function remove(key) {
  try {
    localStorage.removeItem(PREFIX + key);
  } catch {
    /* ignore */
  }
}
