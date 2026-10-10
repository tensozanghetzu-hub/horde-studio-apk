/* Error log: the last 200 things that went wrong, kept on the phone by the
 * wrapper and shown in Settings → App updates. A toast is gone in two
 * seconds and nobody can report what they cannot see; the log is how "the
 * install failed" stops being a mystery.
 *
 * The wrapper holds the log (it must survive the web layer being swapped by
 * an update); this file only pushes to it and renders it. Logging is
 * best-effort and can never throw: the log is a last resort, not a failure
 * source.
 */
(function (global) {
  'use strict';

  function native() { return global.HSAndroid; }
  function can() { return !!(native() && native().logError); }

  var Logs = {
    /** Record one error. Never throws. */
    push: function (msg) {
      try {
        msg = String(msg || '').replace(/\s+/g, ' ').trim();
        if (!msg) return;
        if (msg.length > 300) msg = msg.slice(0, 300) + '…';
        if (can()) native().logError(msg);
        else console.error('[errorlog] ' + msg);
      } catch (e) { /* never break the caller over logging */ }
    },

    /** The whole log, newest first: [{t, m}, …] */
    list: function () {
      try {
        if (!can()) return [];
        var arr = JSON.parse(native().errorLog() || '[]');
        if (!Array.isArray(arr)) return [];
        return arr;
      } catch (e) { return []; }
    },

    clear: function () {
      try { if (can()) native().clearErrorLog(); } catch (e) { }
    }
  };

  /* Unexpected crashes, wherever they happen: without this they would only
   * be visible to someone reading adb. */
  try {
    global.addEventListener('error', function (ev) {
      if (!ev || !ev.message) return;
      var where = ev.filename ? ' (' + String(ev.filename).split('/').pop() + ':' + (ev.lineno || '?') + ')' : '';
      Logs.push('crash: ' + ev.message + where);
    });
    global.addEventListener('unhandledrejection', function (ev) {
      var r = ev && ev.reason;
      var msg = r && r.message ? r.message : (typeof r === 'string' ? r : 'unknown reason');
      Logs.push('crash: unhandled promise rejection: ' + msg);
    });
  } catch (e) { /* very old WebView: the rest of the log still works */ }

  global.Logs = Logs;
})(window);
