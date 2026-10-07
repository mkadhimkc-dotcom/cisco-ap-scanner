/* Persistence: one IndexedDB record holding the app state (all files and settings).
   IndexedDB holds large batches and survives longer than localStorage in Safari tabs. Its writes are
   asynchronous, so every save is also written synchronously to a localStorage journal: a reload or crash
   right after an edit cannot lose it. On load the newer copy wins. Falls back to localStorage alone when
   IndexedDB is unavailable (some private-browsing modes). IndexedDB writes are coalesced. */

const DB_NAME = 'labelscanner', DB_STORE = 'kv', KEY = 'state';
export const LEGACY_KEY = 'labelscanner.v3';   // localStorage key used before IndexedDB
export const JOURNAL_KEY = 'labelscanner.journal';

function openDb() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') return reject(new Error('no IndexedDB'));
    const r = indexedDB.open(DB_NAME, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(DB_STORE);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.onblocked = () => reject(new Error('IndexedDB blocked'));
  });
}
function req(db, mode, fn) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE, mode), r = fn(tx.objectStore(DB_STORE));
    tx.oncomplete = () => resolve(r && r.result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export class Store {
  constructor() { this.db = null; this.kind = 'none'; this.timer = null; this.getState = null; }

  async open() {
    try { this.db = await openDb(); this.kind = 'indexeddb'; }
    catch (e) { this.db = null; this.kind = typeof localStorage !== 'undefined' ? 'localstorage' : 'none'; }
    return this.kind;
  }

  /* -> saved state object or null. Moves an older localStorage copy into IndexedDB once. */
  async load() {
    let text = null;
    if (this.db) {
      try { text = await req(this.db, 'readonly', s => s.get(KEY)); } catch (e) { text = null; }
      if (text == null) {
        const legacy = readLegacy();
        if (legacy != null) {
          try { await req(this.db, 'readwrite', s => s.put(legacy, KEY)); removeLegacy(); text = legacy; } catch (e) { text = legacy; }
        }
      }
    } else text = readLegacy();
    const main = parse(text), journal = parse(readKey(JOURNAL_KEY));
    const best = journal && (!main || (journal.savedAt || 0) > (main.savedAt || 0)) ? journal : main;
    if (best && best === journal && this.db) this.flushText(JSON.stringify(best));
    return best;
  }

  /* getState() is called at write time, so a burst of edits costs one write. */
  save(getState) {
    this.getState = getState;
    this.journal();
    if (this.timer) return;
    this.timer = setTimeout(() => this.flush(), 150);
  }

  /* Synchronous copy, so nothing typed is lost if the page goes away before IndexedDB commits. */
  journal() {
    const st = this.getState();
    st.savedAt = Date.now();
    try { localStorage.setItem(JOURNAL_KEY, JSON.stringify(st)); } catch (e) { /* full (very large batch) or blocked */ }
  }

  async flush() {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    if (!this.getState) return;
    const st = this.getState();
    if (!st.savedAt) st.savedAt = Date.now();
    await this.flushText(JSON.stringify(st));
  }

  async flushText(text) {
    if (this.db) {
      try { await req(this.db, 'readwrite', s => s.put(text, KEY)); return; } catch (e) { /* fall through */ }
    }
    try { localStorage.setItem(LEGACY_KEY, text); } catch (e) { /* storage full or blocked */ }
  }

  async clear() {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    if (this.db) { try { await req(this.db, 'readwrite', s => s.delete(KEY)); } catch (e) { /* ignore */ } }
    removeLegacy();
    try { localStorage.removeItem(JOURNAL_KEY); } catch (e) { /* ignore */ }
  }

  /* Ask the browser not to evict our data under storage pressure (best effort). */
  async persist() {
    try { return navigator.storage && navigator.storage.persist ? await navigator.storage.persist() : false; } catch (e) { return false; }
  }
}

function readKey(k) { try { return typeof localStorage !== 'undefined' ? localStorage.getItem(k) : null; } catch (e) { return null; } }
function readLegacy() { return readKey(LEGACY_KEY); }
function parse(text) { try { return text ? JSON.parse(text) : null; } catch (e) { return null; } }
function removeLegacy() { try { localStorage.removeItem(LEGACY_KEY); } catch (e) { /* ignore */ } }
