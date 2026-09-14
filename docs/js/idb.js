/* Tiny promise wrapper over IndexedDB */
(function (global) {
  'use strict';

  var DB_NAME = 'horde-studio';
  /* v2 adds authored worlds (.horde_world) and their playthroughs */
  var DB_VERSION = 2;

  function open() {
    return new Promise(function (resolve, reject) {
      var req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = function (e) {
        var db = req.result;
        if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv', { keyPath: 'key' });
        if (!db.objectStoreNames.contains('characters')) {
          var c = db.createObjectStore('characters', { keyPath: 'id' });
          c.createIndex('updatedAt', 'updatedAt');
        }
        if (!db.objectStoreNames.contains('sessions')) {
          var s = db.createObjectStore('sessions', { keyPath: 'id' });
          s.createIndex('charId', 'charId');
          s.createIndex('updatedAt', 'updatedAt');
        }
        if (!db.objectStoreNames.contains('messages')) {
          var m = db.createObjectStore('messages', { keyPath: 'id' });
          m.createIndex('sessionId', 'sessionId');
        }
        if (!db.objectStoreNames.contains('worlds')) {
          var w = db.createObjectStore('worlds', { keyPath: 'id' });
          w.createIndex('importedAt', 'importedAt');
        }
        if (!db.objectStoreNames.contains('worldRuns')) {
          var wr = db.createObjectStore('worldRuns', { keyPath: 'id' });
          wr.createIndex('worldId', 'worldId');
        }
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
  }

  var dbPromise = null;
  function db() {
    if (!dbPromise) dbPromise = open();
    return dbPromise;
  }

  function tx(store, mode) {
    return db().then(function (d) { return d.transaction(store, mode).objectStore(store); });
  }

  function wrap(request) {
    return new Promise(function (resolve, reject) {
      request.onsuccess = function () { resolve(request.result); };
      request.onerror = function () { reject(request.error); };
    });
  }

  var IDB = {
    get: function (store, key) {
      return tx(store, 'readonly').then(function (s) { return wrap(s.get(key)); });
    },
    getAll: function (store) {
      return tx(store, 'readonly').then(function (s) { return wrap(s.getAll()); });
    },
    getAllByIndex: function (store, index, key) {
      return tx(store, 'readonly').then(function (s) { return wrap(s.index(index).getAll(key)); });
    },
    put: function (store, value) {
      return tx(store, 'readwrite').then(function (s) { return wrap(s.put(value)); });
    },
    putMany: function (store, values) {
      return db().then(function (d) {
        return new Promise(function (resolve, reject) {
          var t = d.transaction(store, 'readwrite');
          var s = t.objectStore(store);
          values.forEach(function (v) { s.put(v); });
          t.oncomplete = resolve;
          t.onerror = function () { reject(t.error); };
        });
      });
    },
    del: function (store, key) {
      return tx(store, 'readwrite').then(function (s) { return wrap(s.delete(key)); });
    },
    deleteByIndex: function (store, index, key) {
      return db().then(function (d) {
        return new Promise(function (resolve, reject) {
          var t = d.transaction(store, 'readwrite');
          var s = t.objectStore(store);
          var cur = s.index(index).openCursor(IDBKeyRange.only(key));
          cur.onsuccess = function (e) {
            var c = e.target.result;
            if (c) { s.delete(c.primaryKey); c.continue(); }
          };
          t.oncomplete = resolve;
          t.onerror = function () { reject(t.error); };
        });
      });
    },
    clear: function (store) {
      return tx(store, 'readwrite').then(function (s) { return wrap(s.clear()); });
    },
    countByIndex: function (store, index, key) {
      return tx(store, 'readonly').then(function (s) { return wrap(s.index(index).count(key)); });
    }
  };

  global.IDB = IDB;
})(window);
