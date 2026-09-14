/* AI Horde client: crowdsourced text + image generation (https://aihorde.net)
 *
 * The Horde is a queue, not an API: a job can legitimately sit for minutes behind
 * other people's work. So this client never silently waits — it reports queue
 * position and ETA on every poll, honours a cancel signal, backs off when the
 * cluster rate-limits us, and leaves the deadline to the caller.
 */
(function (global) {
  'use strict';

  var BASE = global.HORDE_BASE || 'https://aihorde.net/api/v2';
  var AGENT = 'HordeStudioMobile:1.1:local';
  var ANON = '0000000000';

  function key(s) { return (s && s.trim()) || ANON; }
  function sleep(ms, signal) {
    return new Promise(function (resolve, reject) {
      var t = setTimeout(function () { if (signal) signal.removeEventListener('abort', onAbort); resolve(); }, ms);
      function onAbort() { clearTimeout(t); reject(new DOMException('Aborted', 'AbortError')); }
      if (signal) {
        if (signal.aborted) { clearTimeout(t); return reject(new DOMException('Aborted', 'AbortError')); }
        signal.addEventListener('abort', onAbort);
      }
    });
  }

  /** One HTTP call. Never hangs: 30s ceiling, and 429s are reported, not swallowed. */
  function req(path, opts) {
    opts = opts || {};
    var headers = Object.assign({ 'Client-Agent': AGENT, 'apikey': key(opts.apikey) }, opts.headers || {});
    if (opts.json) { headers['Content-Type'] = 'application/json'; }

    var ctrl = new AbortController();
    var timer = setTimeout(function () { ctrl.abort(); }, opts.timeout ? opts.timeout * 1000 : 30000);
    var aborted = false;
    if (opts.signal) {
      if (opts.signal.aborted) { clearTimeout(timer); return Promise.reject(new DOMException('Aborted', 'AbortError')); }
      opts.signal.addEventListener('abort', function () { aborted = true; ctrl.abort(); });
    }

    return fetch(BASE + path, {
      method: opts.method || (opts.json ? 'POST' : 'GET'),
      headers: headers,
      body: opts.json ? JSON.stringify(opts.json) : undefined,
      signal: ctrl.signal
    }).then(function (r) {
      clearTimeout(timer);
      var reset = r.headers ? r.headers.get('x-ratelimit-reset') : null;
      return r.text().then(function (t) {
        var data = null;
        try { data = t ? JSON.parse(t) : null; } catch (e) { data = null; }
        if (!r.ok) {
          var msg = (data && (data.message || data.errors || data.error)) || t || r.statusText;
          if (typeof msg !== 'string') msg = JSON.stringify(msg);
          var err = new Error(msg.replace(/^Error:\s*/i, '').slice(0, 240));
          err.status = r.status;
          err.rateLimited = r.status === 429;
          err.retryAfter = r.headers ? (parseInt(r.headers.get('retry-after'), 10) || 0) : 0;
          err.reset = reset ? parseInt(reset, 10) : 0;
          throw err;
        }
        return data;
      });
    }, function (e) {
      clearTimeout(timer);
      if (aborted) throw new DOMException('Aborted', 'AbortError');
      if (e && e.name === 'AbortError') throw new Error('The Horde did not respond in 30s (network stall).');
      throw e;
    });
  }

  /* ---------- model lists (cached 5 min so we can warn about offline models) ---------- */
  var modelCache = {};

  function listModels(type) {
    var fresh = modelCache[type] && (Date.now() - modelCache[type].at < 5 * 60 * 1000);
    if (fresh) return Promise.resolve(modelCache[type].rows);
    return req('/status/models?type=' + type + '&model_state=all').then(function (rows) {
      var out = (rows || [])
        .filter(function (m) { return m.type === type && m.name; })
        .map(function (m) {
          return {
            name: m.name, count: m.count || 0, eta: m.eta || 0,
            jobs: Math.round(m.jobs || 0), perf: m.performance || 0
          };
        })
        .sort(function (a, b) { return (b.count - a.count) || (a.eta - b.eta); });
      modelCache[type] = { at: Date.now(), rows: out };
      return out;
    });
  }

  function onlineModels(type) {
    return listModels(type).then(function (rows) {
      return rows.filter(function (r) { return r.count > 0; });
    });
  }

  /** Is a specific model actually being served right now? null if unknown. */
  function modelStatus(type, name) {
    if (!name) return Promise.resolve(null);
    return listModels(type).then(function (rows) {
      for (var i = 0; i < rows.length; i++) if (rows[i].name === name) return rows[i];
      return null;
    }).catch(function () { return null; });
  }

  /** Cluster health summary for the connection test. */
  function health() {
    return Promise.all([listModels('text'), listModels('image')]).then(function (r) {
      function sum(rows, f) { return rows.reduce(function (a, m) { return a + (f ? f(m) : 1); }, 0); }
      var t = r[0], i = r[1];
      return {
        textWorkers: sum(t, function (m) { return m.count; }),
        textJobs: sum(t, function (m) { return m.jobs; }),
        textModels: t.filter(function (m) { return m.count > 0; }).length,
        imageWorkers: sum(i, function (m) { return m.count; }),
        imageJobs: sum(i, function (m) { return m.jobs; }),
        imageModels: i.filter(function (m) { return m.count > 0; }).length,
        imageEta: (i.filter(function (m) { return m.count > 0; })[0] || {}).eta || 0,
        textEta: (t.filter(function (m) { return m.count > 0; })[0] || {}).eta || 0
      };
    });
  }

  function whoami(apikey) {
    if (!apikey) return Promise.resolve(null);
    return req('/find_user', { apikey: apikey }).catch(function () { return null; });
  }

  /* ---------- shared queue waiter ---------- */
  /* kind: 'image' -> /generate/check + /generate/status ;  'text' -> /generate/text/status */
  function pollJob(kind, id, o) {
    var started = Date.now();
    var maxWait = (o.maxWait || 600) * 1000;   // generous: queues are real
    var rateLimitStrikes = 0;

    function step() {
      if (o.signal && o.signal.aborted) return Promise.reject(new DOMException('Aborted', 'AbortError'));
      var elapsed = Date.now() - started;
      if (elapsed > maxWait) {
        var secs = Math.round(maxWait / 1000);
        var how = secs >= 60 ? (Math.round(secs / 6) / 10) + ' minutes' : secs + ' seconds';
        var err = new Error('Still queued after ' + how +
          '. The Horde is busy — try “Any available model”, a smaller image, or later.');
        err.timedOut = true;
        return Promise.reject(err);
      }

      var path = kind === 'image' ? '/generate/check/' + id : '/generate/text/status/' + id;
      return req(path, { apikey: o.apikey, signal: o.signal, timeout: 35 }).then(function (res) {
        var done = kind === 'image' ? res.done : res.done;
        if (done && kind === 'text') return res;
        if (done) return req('/generate/status/' + id, { apikey: o.apikey, signal: o.signal, timeout: 35 });

        rateLimitStrikes = 0;
        var info = {
          state: res.processing ? 'processing' : 'queued',
          queuePosition: res.queue_position || 0,
          waiting: res.waiting || 0,
          processing: res.processing || 0,
          finished: res.finished || 0,
          waitTime: Math.round(res.wait_time || 0),
          elapsed: Math.round((Date.now() - started) / 1000)
        };
        if (o.onProgress) o.onProgress(info);

        /* Poll fast early, then ease off — and always respect the rate limiter. */
        var delay = info.state === 'processing' ? 2500
          : info.waitTime > 120 ? 8000
          : info.waitTime > 30 ? 5000 : 3000;
        return sleep(delay, o.signal).then(step);
      }, function (err) {
        if (err && err.name === 'AbortError') throw err;
        if (err && err.rateLimited) {
          rateLimitStrikes++;
          if (rateLimitStrikes > 4) throw new Error('The Horde is rate-limiting this device. Wait a minute and retry.');
          var wait = err.retryAfter || 10;
          if (o.onProgress) o.onProgress({ state: 'rate-limited', waitTime: wait, elapsed: Math.round((Date.now() - started) / 1000) });
          return sleep(wait * 1000, o.signal).then(step);
        }
        /* A single flaky read shouldn't kill a job that's still queued. */
        if (err && (err.status >= 500 || err.status === 0 || /network stall/i.test(err.message))) {
          if (o.onProgress) o.onProgress({ state: 'retrying', waitTime: 0, elapsed: Math.round((Date.now() - started) / 1000) });
          return sleep(6000, o.signal).then(step);
        }
        throw err;
      });
    }
    return step();
  }

  /* ---------- images ---------- */
  function generateImage(o) {
    var payload = {
      prompt: o.prompt,
      nsfw: !!o.nsfw,
      censor_nsfw: !o.nsfw,
      r2: true,
      trusted_workers: false,
      params: {
        n: 1,
        width: o.width || 640,
        height: o.height || o.width || 640,
        steps: o.steps || 20,
        cfg_scale: o.cfg || 6.5,
        sampler_name: 'k_euler',
        karras: true
      }
    };
    if (o.model) payload.models = [o.model];

    var tries = o.emptyTries === undefined ? 2 : Math.max(1, Math.min(5, o.emptyTries));

    function again(i) {
    return req('/generate/async', { method: 'POST', apikey: o.apikey, json: payload, signal: o.signal, timeout: 40 })
      .then(function (res) {
        if (!res || !res.id) throw new Error('The Horde refused the request.');
        return pollJob('image', res.id, o).then(function (st) {
          var g = (st.generations || [])[0];
          if (g && g.img) {
            return { url: g.img, seed: g.seed, worker: g.worker_name, model: g.model, id: g.id, kudos: res.kudos };
          }
          if (i + 1 >= tries) {
            throw new Error('The Horde returned no image' + (tries > 1 ? ' after ' + tries + ' tries' : '') +
              ' (job ' + (st.faulted ? 'faulted' : 'empty') + ').');
          }
          if (o.onProgress) o.onProgress({ state: 'empty', attempt: i + 1, of: tries, faulted: !!st.faulted });
          return sleep(1200, o.signal).then(function () { return again(i + 1); });
        });
      });
    }
    return again(0);
  }

  /* ---------- text ---------- */
  function generateText(o) {
    /* Ask for a context the workers can actually serve: prompt (≈4 chars/token)
       plus the reply, rounded up, within the range workers advertise. */
    var promptTokens = Math.ceil((o.prompt || '').length / 4);
    var wanted = promptTokens + (o.maxLength || 200) + 64;
    /* same ceiling api.js budgets the prompt against - one number, one place */
    var cap = (global.API && global.API.HORDE_CTX_TOKENS) || 8192;
    var ctx = Math.min(cap, Math.max(1024, wanted));

    var payload = {
      prompt: o.prompt,
      trusted_workers: false,
      slow_workers: true,
      params: {
        n: 1,
        frmtadsnsp: false,
        max_context_length: ctx,
        max_length: o.maxLength || 200,
        stop_sequence: o.stopSequence && o.stopSequence.length ? o.stopSequence : undefined,
        temperature: o.temperature,
        top_p: o.topP,
        top_k: o.topK || 0,
        rep_pen: o.repPen || 1.1,
        singleline: false
      }
    };
    if (o.model) payload.models = [o.model];
    if (!payload.params.stop_sequence) delete payload.params.stop_sequence;

    /* Some workers answer a job with nothing in it. That is a property of the
       worker, not of the request, so the fix is to ask a different one: resubmit
       and let the Horde dispatch elsewhere. */
    var tries = o.emptyTries === undefined ? 5 : Math.max(1, Math.min(6, o.emptyTries));
    /* Most empty jobs fail within a couple of seconds, so extra attempts are cheap.
       Cap the total time spent re-asking so a worker that hangs can't turn one
       message into a five-minute wait. */
    var budgetUntil = Date.now() + (o.emptyBudget === undefined ? 45000 : o.emptyBudget);

    function once(i) {
      return req('/generate/text/async', { method: 'POST', apikey: o.apikey, json: payload, signal: o.signal, timeout: 40 })
        .then(function (res) {
          if (!res || !res.id) throw new Error('The Horde refused the request.');
          return pollJob('text', res.id, o).then(function (st) {
            var g = (st.generations || [])[0];
            var text = g && g.text ? g.text.trim() : '';
            if (text) return { text: text, worker: g.worker_name, model: g.model, kudos: res.kudos, tries: i + 1 };

            var spent = Date.now() > budgetUntil;
            var used = i + 1;
            if (used >= tries || spent) {
              throw new Error('The Horde returned no text after ' + used + (used > 1 ? ' tries' : ' try') +
                ' (job ' + (st.faulted ? 'faulted' : 'empty') + '). Some workers come back blank — try again, ' +
                'or pick a specific model in Settings.');
            }
            if (o.onProgress) o.onProgress({ state: 'empty', attempt: used, of: tries, faulted: !!st.faulted });
            return sleep(1200, o.signal).then(function () { return once(i + 1); });
          });
        });
    }
    return once(0);
  }

  global.Horde = {
    BASE: BASE, ANON: ANON,
    listImageModels: function () { return listModels('image'); },
    listTextModels: function () { return listModels('text'); },
    onlineImageModels: function () { return onlineModels('image'); },
    onlineTextModels: function () { return onlineModels('text'); },
    modelStatus: modelStatus, health: health, whoami: whoami,
    generateImage: generateImage, generateText: generateText
  };
})(window);
