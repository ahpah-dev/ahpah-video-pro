/*
 * AhPah Video Pro - media kept in this browser.
 * Every imported file is copied into IndexedDB, so a recovered or reopened project can get its media back
 * without importing it again. A small index in localStorage lists the stored files by name, so a file can
 * be found when the project's media id is not known. If the browser has no storage, or it is full, the
 * editor still works and the user is told the file will need importing again.
 */
(function () {
  'use strict';

  const AVP = window.AVP;
  const DB_NAME = 'ahpah-video-pro-media';
  const STORE = 'files';
  const INDEX_KEY = 'ahpah-video-pro.media-index';
  let dbPromise = null;
  let warned = false;

  function open() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve) => {
      if (typeof indexedDB === 'undefined') return resolve(null);
      let req;
      try {
        req = indexedDB.open(DB_NAME, 1);
      } catch (e) {
        return resolve(null);
      }
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    });
    return dbPromise;
  }

  // Runs one request in a transaction. Resolves to the request's result, or null if storage failed.
  function run(mode, make) {
    return open()
      .then(
        (db) =>
          new Promise((resolve, reject) => {
            if (!db) return resolve(null);
            const tx = db.transaction(STORE, mode);
            const req = make(tx.objectStore(STORE));
            tx.oncomplete = () => resolve(req.result === undefined ? null : req.result);
            tx.onerror = () => reject(tx.error);
            tx.onabort = () => reject(tx.error);
          })
      )
      .catch(() => null);
  }

  function readIndex() {
    try {
      return JSON.parse(localStorage.getItem(INDEX_KEY)) || {};
    } catch (e) {
      return {};
    }
  }

  function writeIndex(index) {
    try {
      localStorage.setItem(INDEX_KEY, JSON.stringify(index));
    } catch (e) {
      /* the index is only used to find files by name */
    }
  }

  function get(id) {
    return run('readonly', (st) => st.get(id)).then((rec) => rec || null);
  }

  AVP.mediaStore = {
    // Keeps a copy of an imported file. Resolves to true when it is stored.
    put(id, file, type) {
      const rec = { id, name: file.name, type, file };
      return run('readwrite', (st) => st.put(rec, id)).then((ok) => {
        if (ok === null) {
          if (!warned) {
            warned = true;
            AVP.toast(`${file.name} could not be kept for recovery (browser storage is full or off). It will need importing again after a reload.`, 'warn');
          }
          return false;
        }
        const index = readIndex();
        index[id] = { name: file.name, type };
        writeIndex(index);
        return true;
      });
    },

    // Finds a stored file: by its id first, then by name and type. Resolves to a File, or null.
    find(id, name, type) {
      return get(id).then((rec) => {
        if (rec && rec.file) return rec.file;
        const index = readIndex();
        const hit = Object.keys(index).find((k) => index[k].name === name && index[k].type === type);
        if (!hit) return null;
        return get(hit).then((r) => (r && r.file) || null);
      });
    },

    remove(id) {
      const index = readIndex();
      if (index[id]) {
        delete index[id];
        writeIndex(index);
      }
      return run('readwrite', (st) => st.delete(id));
    },
  };
})();
