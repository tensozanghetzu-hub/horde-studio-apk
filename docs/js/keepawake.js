/* Keep the phone awake while a reply is being generated.
 *
 * Without this, the moment the user switches apps or the screen goes dark,
 * Android can sleep the CPU and freeze this process — and a frozen process
 * ticks no timers: the Horde queue poll, the 35-second read timeouts that
 * drive its retries, the stream deadline, all of it stops. The reply looks
 * like it hangs until the app is foregrounded again. Holding a partial
 * wake lock (in the wrapper, via HSAndroid.setReplyInFlight) keeps the CPU
 * running and exempts the process from the background freeze on Android 12+.
 *
 * The wrapper caps the lock at 30 minutes, so a lost release can never
 * drain the battery. This module only counts: hold() when a reply goes
 * in flight, release() when it settles — refcounted, because a chat reply
 * and a world turn (or an image) can be in flight at the same time.
 */
(function (global) {
  'use strict';

  var refs = 0;

  function native() { return global.HSAndroid; }

  var KeepAwake = {
    hold: function () {
      refs++;
      try {
        if (native() && native().setReplyInFlight) native().setReplyInFlight(true);
      } catch (e) { /* the lock is best-effort; a reply must never fail over it */ }
    },

    release: function () {
      refs = Math.max(0, refs - 1);
      try {
        if (native() && native().setReplyInFlight) native().setReplyInFlight(refs > 0);
      } catch (e) { }
    },

    refs: function () { return refs; }
  };

  global.KeepAwake = KeepAwake;
})(window);
