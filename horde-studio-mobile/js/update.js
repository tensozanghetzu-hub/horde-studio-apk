/* Self-update.
 *
 * The Android wrapper keeps a private folder that shadows the files bundled in
 * the APK: a file there is served instead of the bundled one, everything else
 * falls through untouched. So a fix is a small zip the app unpacks into that
 * folder — no reinstall, no Play Store, no Android install prompt.
 *
 * Only a change to the wrapper itself (native code, permissions) needs a real
 * APK install, and that is offered too.
 *
 * Nothing here runs on its own. The check is manual: Settings → App updates.
 */
(function (global) {
  'use strict';

  var DEFAULT_URL = 'https://tensozanghetzu-hub.github.io/horde-studio-apk/';

  function native() { return global.HSAndroid; }
  function can() { return !!(native() && native().jobStatus && native().updateInfo); }

  function baseUrl() {
    var s = (global.Store && global.Store.settings) || {};
    var u = (s.updateUrl || DEFAULT_URL || '').trim();
    if (!u) return '';
    return u.replace(/\/+$/, '');
  }

  function info() {
    try { return JSON.parse(native().updateInfo()); }
    catch (e) { return { apk: '?', apkCode: 0, overlay: false, rev: '' }; }
  }

  /* The server says where the APK actually is. GitHub cannot serve '/app', so
   * the address is read from the version file instead of being assumed. The
   * last one seen is kept, so Install still works after a reload. */
  var lastRemote = null;

  function remember(remote) {
    if (remote && typeof remote === 'object') {
      lastRemote = remote;
      try { localStorage.setItem('hs.remote', JSON.stringify(remote)); } catch (e) { }
    }
  }

  function cachedRemote() {
    if (lastRemote) return lastRemote;
    try { return JSON.parse(localStorage.getItem('hs.remote') || 'null'); }
    catch (e) { return null; }
  }

  /** Where to fetch the APK from: the version file if it said, else the old
   *  sandbox-style address, so older servers keep working. */
  function apkUrl() {
    var r = cachedRemote();
    var u = (r && r.apkUrl) || '';
    if (u) return u;
    var base = baseUrl();
    return base ? base + '/app' : '';
  }

  /* Poll a native background job until it finishes. */
  function runJob(start, onProgress) {
    return new Promise(function (resolve, reject) {
      var id;
      try { id = start(); } catch (e) { reject(e); return; }
      if (!id) { reject(new Error('This build cannot update itself')); return; }
      var timer = setInterval(function () {
        var st;
        try { st = JSON.parse(native().jobStatus(id)); }
        catch (e) { clearInterval(timer); reject(new Error('Lost track of the download')); return; }
        if (onProgress) onProgress(st.progress || 0, st.message || '');
        if (st.state === 'done') { clearInterval(timer); resolve(st.result); }
        else if (st.state === 'error') {
          clearInterval(timer);
          var msg = st.message || 'Download failed';
          if (/Failed to fetch|NetworkError|Unable to resolve/i.test(msg)) {
            msg = 'Could not reach ' + baseUrl() + ' — check the address and your connection.';
          }
          reject(new Error(msg));
        }
      }, 250);
    });
  }

  var Updates = {
    DEFAULT_URL: DEFAULT_URL,

    supported: function () { return can(); },

    info: info,

    baseUrl: baseUrl,
    apkUrl: apkUrl,

    /** Ask the server what is current, and work out what that means for us. */
    check: function (onProgress) {
      if (!can()) return Promise.reject(new Error('Self-update needs the newest APK. Install it once, then this screen handles the rest.'));
      var base = baseUrl();
      if (!base) return Promise.reject(new Error('No update address is set.'));
      return runJob(function () { return native().checkUpdate(base + '/version.json'); }, onProgress)
        .then(function (body) {
          var remote;
          try { remote = JSON.parse(body); }
          catch (e) { throw new Error('The server did not answer with a version file'); }
          var local = info();
          remember(remote);
          var out = { remote: remote, local: local };
          out.newApk = (remote.apkCode || 0) > (local.apkCode || 0);
          out.newWeb = String(remote.webRev || '') !== String(local.rev || '') ||
            (!local.overlay && !!remote.webRev);
          if (!out.newApk && !out.newWeb) out.upToDate = true;
          return out;
        });
    },

    /** Swap in the new web bundle. Resolves with the revision applied. */
    applyWeb: function (rev, onProgress) {
      if (!can()) return Promise.reject(new Error('Self-update needs the newest APK.'));
      var base = baseUrl();
      try { localStorage.setItem('hs.pendingRev', String(rev)); } catch (e) { }
      return runJob(function () { return native().applyWebUpdate(base + '/web.zip', String(rev)); }, onProgress);
    },

    /** Install a newer APK of the app. The download goes through Android and then
     *  Android's own install screen opens — the app never installs anything quietly. */
    installApk: function () {
      if (!can()) throw new Error('Self-update needs the newest APK.');
      var url = apkUrl();
      if (!url) throw new Error('No update address is set.');
      native().installApk(url);
    },

    /** Apply an update from a zip already on the phone — downloaded in a browser,
     *  sent over chat, copied from a computer. Needs no network at all, which is
     *  what makes it work when the update address is unreachable. */
    applyFile: function (onProgress) {
      if (!can()) return Promise.reject(new Error('Self-update needs the newest APK.'));
      return runJob(function () { return native().pickUpdateZip(); }, onProgress)
        .then(function (rev) {
          try { localStorage.setItem('hs.pendingRev', String(rev)); } catch (e) { }
          return rev;
        });
    },

    /** Fallback for when that route is blocked: let the browser deal with it. */
    openDownload: function () {
      if (!can()) throw new Error('Self-update needs the newest APK.');
      native().openDownload(apkUrl() || baseUrl() + '/');
    },

    reset: function () {
      if (!can()) throw new Error('Self-update needs the newest APK.');
      native().clearWebUpdate();
      try { localStorage.removeItem('hs.pendingRev'); localStorage.removeItem('hs.blockedRev'); localStorage.removeItem('hs.remote'); } catch (e) { }
      lastRemote = null;
    },

    /** Reload past the offline cache: after an update the service worker would
     *  otherwise serve the files it cached before, and nothing would change. */
    reloadFresh: function () {
      var done = function () { try { location.reload(); } catch (e) { } };
      try {
        if (!navigator.serviceWorker) return done();
        navigator.serviceWorker.getRegistrations().then(function (regs) {
          return Promise.all(regs.map(function (r) { return r.unregister(); }));
        }).then(function () {
          if (!global.caches || !caches.keys) return null;
          return caches.keys().then(function (keys) {
            return Promise.all(keys.map(function (k) { return caches.delete(k); }));
          });
        }).then(done, done);
      } catch (e) { done(); }
    },

    /** Forget the address and go back to the one this build shipped with. */
    saveUrl: function (url) {
      return global.Store.saveSettings({ updateUrl: (url || '').trim() });
    }
  };

  /* ---------- boot: tell the wrapper whether the last update survived ----------
   * The wrapper undoes an update that was applied but never booted. If we get
   * here at all, it booted, so call off the watchdog — and notice when it did
   * roll us back, so the same revision is not offered again blindly. */
  (function () {
    if (!can()) return;
    try {
      var pending = localStorage.getItem('hs.pendingRev');
      var blocked = localStorage.getItem('hs.blockedRev');
      var i = info();
      if (pending && !i.overlay) {
        localStorage.setItem('hs.blockedRev', pending);
        localStorage.removeItem('hs.pendingRev');
      } else if (i.overlay) {
        localStorage.removeItem('hs.pendingRev');
        if (blocked && blocked !== i.rev) localStorage.removeItem('hs.blockedRev');
      }
      native().confirmUpdate();
    } catch (e) { }
  })();

  global.Updates = Updates;
})(window);
