/**
 * db.js — IndexedDB wrapper for Weather Lens
 *
 * Stores:
 *  - favourites: cities the user has saved
 *  - weatherCache: last-known weather per city (for offline display)
 */

const DB_NAME    = 'weather-lens-db';
const DB_VERSION = 1;

let _db = null;

/** Open (or create) the database, return a promise resolving to the IDBDatabase. */
function openDB() {
  if (_db) return Promise.resolve(_db);

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    // Runs when the DB is first created OR when DB_VERSION is bumped
    request.onupgradeneeded = event => {
      const db = event.target.result;

      // ── favourites store ──────────────────────────────────────────────
      if (!db.objectStoreNames.contains('favourites')) {
        const favStore = db.createObjectStore('favourites', { keyPath: 'id' });
        favStore.createIndex('name', 'name', { unique: false });
        favStore.createIndex('addedAt', 'addedAt', { unique: false });
      }

      // ── weatherCache store ────────────────────────────────────────────
      if (!db.objectStoreNames.contains('weatherCache')) {
        const cacheStore = db.createObjectStore('weatherCache', { keyPath: 'cityId' });
        cacheStore.createIndex('cachedAt', 'cachedAt', { unique: false });
      }

      console.log('[DB] Schema upgraded to version', DB_VERSION);
    };

    request.onsuccess = event => {
      _db = event.target.result;
      console.log('[DB] Opened successfully');
      resolve(_db);
    };

    request.onerror = event => {
      console.error('[DB] Error opening database:', event.target.error);
      reject(event.target.error);
    };
  });
}

/** Generic helper — run a transaction and return a promise. */
function transaction(storeName, mode, fn) {
  return openDB().then(db => {
    return new Promise((resolve, reject) => {
      const tx    = db.transaction(storeName, mode);
      const store = tx.objectStore(storeName);
      const req   = fn(store);

      req.onsuccess = () => resolve(req.result);
      req.onerror   = () => reject(req.error);
    });
  });
}

// ─── FAVOURITES ──────────────────────────────────────────────────────────────

export const favouritesDB = {
  /** Add a city to favourites */
  add(city) {
    return transaction('favourites', 'readwrite', store =>
      store.put({ ...city, addedAt: Date.now() })
    );
  },

  /** Remove a city by id */
  remove(id) {
    return transaction('favourites', 'readwrite', store =>
      store.delete(id)
    );
  },

  /** Get all saved cities, sorted by addedAt descending */
  getAll() {
    return openDB().then(db => {
      return new Promise((resolve, reject) => {
        const tx    = db.transaction('favourites', 'readonly');
        const store = tx.objectStore('favourites');
        const req   = store.getAll();

        req.onsuccess = () => resolve(
          (req.result || []).sort((a, b) => b.addedAt - a.addedAt)
        );
        req.onerror = () => reject(req.error);
      });
    });
  },

  /** Check if a city is already saved */
  has(id) {
    return transaction('favourites', 'readonly', store => store.get(id))
      .then(result => !!result);
  }
};

// ─── WEATHER CACHE ───────────────────────────────────────────────────────────

export const weatherCacheDB = {
  /** Store the latest weather data for a city */
  set(cityId, data) {
    return transaction('weatherCache', 'readwrite', store =>
      store.put({ cityId, data, cachedAt: Date.now() })
    );
  },

  /** Retrieve cached weather. Returns null if not found or too old. */
  get(cityId, maxAgeMs = 30 * 60 * 1000) {
    return transaction('weatherCache', 'readonly', store => store.get(cityId))
      .then(record => {
        if (!record) return null;
        const age = Date.now() - record.cachedAt;
        if (age > maxAgeMs) {
          console.log('[DB] Weather cache expired for', cityId);
          return null;
        }
        return record.data;
      });
  },

  /** Remove all cached weather entries older than maxAgeMs */
  prune(maxAgeMs = 60 * 60 * 1000) {
    return openDB().then(db => {
      return new Promise((resolve, reject) => {
        const tx    = db.transaction('weatherCache', 'readwrite');
        const store = tx.objectStore('weatherCache');
        const index = store.index('cachedAt');
        const bound = IDBKeyRange.upperBound(Date.now() - maxAgeMs);
        const req   = index.openCursor(bound);

        req.onsuccess = event => {
          const cursor = event.target.result;
          if (cursor) {
            cursor.delete();
            cursor.continue();
          } else {
            resolve();
          }
        };
        req.onerror = () => reject(req.error);
      });
    });
  }
};
