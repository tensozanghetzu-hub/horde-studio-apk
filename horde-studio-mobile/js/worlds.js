/* World packs.
 *
 * Upstream Horde Studio ships world-packs/ built from OpenStreetMap: real
 * places with coordinates, and walking routes between them, so a virtual
 * human's journey takes a believable number of minutes.
 *
 * Three questions the life engine asks of a pack:
 *
 *   how long is the walk  -> routed across the route graph, not just between
 *                            directly connected neighbours
 *   what can they do here -> every capability a place has, not one
 *   is it open right now  -> opening hours, when the pack records them
 *
 * Nothing here is required. Without a pack a virtual human keeps their default
 * places and invents a journey time, exactly as before.
 */
(function (global) {
  'use strict';

  var catalog = null;
  var cache = {};        // id -> pack
  var askedFor = {};     // id -> true, so preload only fetches once

  /* Walking speed for the straight-line fallback: upstream builds routes at
     4.5 km/h (75 m/min); a straight line underestimates, so allow for streets. */
  var WALK_MPM = 75;
  var DETOUR = 1.3;

  function path(f) { return 'worlds/' + f; }

  function getJSON(f) {
    return fetch(path(f)).then(function (r) {
      if (!r.ok) throw new Error('That world pack is not installed');
      return r.json();
    });
  }

  /* ---------------- indexes, built once per pack ---------------- */

  function placeIndex(pack) {
    if (pack._places) return pack._places;
    var m = {};
    (pack.places || []).forEach(function (p) { m[p.id] = p; });
    pack._places = m;
    return m;
  }

  /* Undirected adjacency. Upstream stores each direction; walking is symmetric
     and the converter keeps one edge per pair, so this is the same graph. */
  function graph(pack) {
    if (pack._graph) return pack._graph;
    var g = {};
    (pack.routes || []).forEach(function (r) {
      if (!r || !r.f || !r.t || r.f === r.t) return;
      (g[r.f] || (g[r.f] = [])).push({ to: r.t, m: r.m });
      (g[r.t] || (g[r.t] = [])).push({ to: r.f, m: r.m });
    });
    pack._graph = g;
    return g;
  }

  function radians(d) { return d * Math.PI / 180; }

  /** Straight-line metres between two [lon, lat] pairs. */
  function metres(a, b) {
    var R = 6371000;
    var dLat = radians(b[1] - a[1]);
    var dLon = radians(b[0] - a[0]);
    var la1 = radians(a[1]), la2 = radians(b[1]);
    var h = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return 2 * R * Math.asin(Math.sqrt(h));
  }

  /* Dijkstra over the walking graph, cached per starting place. 120 places and
     ~900 edges, so this is trivial even on a phone. */
  function distances(pack, from) {
    if (!pack._dist) pack._dist = {};
    if (pack._dist[from]) return pack._dist[from];

    var g = graph(pack);
    var dist = {};
    var prev = {};
    var done = {};
    dist[from] = 0;

    for (;;) {
      var best = null, bestD = Infinity;
      for (var id in dist) {
        if (!done[id] && dist[id] < bestD) { bestD = dist[id]; best = id; }
      }
      if (best === null) break;
      done[best] = 1;
      var edges = g[best] || [];
      for (var i = 0; i < edges.length; i++) {
        var e = edges[i];
        var nd = dist[best] + e.m;
        if (dist[e.to] === undefined || nd < dist[e.to]) {
          dist[e.to] = nd;
          prev[e.to] = best;
        }
      }
    }

    pack._dist[from] = { dist: dist, prev: prev };
    return pack._dist[from];
  }

  /* ---------------- opening hours ---------------- */

  var DAY = { su: 0, mo: 1, tu: 2, we: 3, th: 4, fr: 5, sa: 6 };

  /** "08:00" -> 480. Returns null if it is not a time. */
  function toMinutes(t) {
    var m = /^(\d{1,2}):(\d{2})$/.exec(String(t || '').trim());
    if (!m) return null;
    var h = +m[1], mi = +m[2];
    if (h > 23 || mi > 59) return null;
    return h * 60 + mi;
  }

  /** Expand "Mo-Fr", "Sa,Su", "Mo-We,Fr" into day numbers. */
  function dayList(spec) {
    var out = [];
    String(spec || '').toLowerCase().split(',').forEach(function (part) {
      part = part.trim();
      if (!part) return;
      var range = part.split('-');
      if (range.length === 2 && DAY[range[0]] !== undefined && DAY[range[1]] !== undefined) {
        var a = DAY[range[0]], b = DAY[range[1]];
        if (a <= b) { for (var i = a; i <= b; i++) out.push(i); }
        else { for (var j = a; j <= 6; j++) out.push(j); for (var k = 0; k <= b; k++) out.push(k); }
      } else if (DAY[part] !== undefined) {
        out.push(DAY[part]);
      }
    });
    return out;
  }

  /* Parse the OSM opening_hours string the converter keeps. Handles the shapes
     that actually appear: "24/7", "Mo-Fr 08:00-17:00", "Mo-Fr 08:00-12:00,
     13:00-17:00; Sa 10:00-14:00". Anything unusual returns null, and the app
     then simply treats the place as open rather than guessing. */
  function parseHours(text) {
    var s = String(text || '').trim();
    if (!s) return null;
    if (/^24\/7$/i.test(s)) return [{ days: [0, 1, 2, 3, 4, 5, 6], start: 0, end: 1440 }];

    var rules = [];
    var parts = s.split(';');
    for (var i = 0; i < parts.length; i++) {
      var part = parts[i].trim();
      var m = /^([A-Za-z,\-]+)\s+(.+)$/.exec(part);
      if (!m) return null;
      var days = dayList(m[1]);
      if (!days.length) return null;
      var spans = m[2].split(',');
      for (var j = 0; j < spans.length; j++) {
        var t = /^\s*(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})\s*$/.exec(spans[j]);
        if (!t) return null;
        var a = toMinutes(t[1]), b = toMinutes(t[2]);
        if (a === null || b === null) return null;
        rules.push({ days: days, start: a, end: b });
      }
    }
    return rules.length ? rules : null;
  }

  function hoursFor(place) {
    if (!place) return null;
    if (place._hours !== undefined) return place._hours;
    var h = null;
    if (Array.isArray(place.hours) && place.hours.length) h = place.hours;
    else if (place.oh) h = parseHours(place.oh);
    place._hours = h;      // null means "unknown", and is cached too
    return h;
  }

  /**
   * Is this place open at this moment?
   * Returns true, false, or null when the pack doesn't say - callers should
   * treat null as "probably", not as closed.
   */
  function isOpen(place, at) {
    var rules = hoursFor(place);
    if (!rules) return null;
    var d = new Date(at === undefined ? Date.now() : at);
    var day = d.getDay();                 // 0 = Sunday, matching DAY above
    var minute = d.getHours() * 60 + d.getMinutes();
    for (var i = 0; i < rules.length; i++) {
      var r = rules[i];
      if (!r.days || r.days.indexOf(day) === -1) continue;
      if (minute >= r.start && minute < r.end) return true;
      /* a span that runs past midnight, e.g. 18:00-02:00 */
      if (r.end < r.start && (minute >= r.start || minute < r.end)) return true;
    }
    return false;
  }

  var Worlds = {
    /** The packs installed in this build. Never rejects with anything fatal. */
    available: function () {
      if (catalog) return Promise.resolve(catalog);
      return getJSON('index.json').then(function (d) {
        catalog = d.packs || [];
        return catalog;
      });
    },

    /** Fetch a pack. Cached, so calling it repeatedly is free. */
    load: function (id) {
      if (cache[id]) return Promise.resolve(cache[id]);
      return getJSON(id + '.json').then(function (p) {
        cache[id] = p;
        return p;
      });
    },

    /** The pack if it happens to be in memory. Synchronous, may be null. */
    cached: function (id) { return cache[id] || null; },

    /** Warm the cache for a life that already uses a pack. Fire and forget. */
    preload: function (id) {
      if (!id || askedFor[id]) return;
      askedFor[id] = true;
      Worlds.load(id).catch(function () { /* offline, or not installed */ });
    },

    /* Merge a pack into a life. Nothing already there is touched: places you
     * wrote yourself stay exactly as they were, and the pack's are added
     * alongside. Loading a pack should never cost you something you made. */
    apply: function (vh, pack) {
      var seen = {};
      (vh.places || []).forEach(function (p) { seen[p.id] = 1; });

      var added = (pack.places || []).filter(function (p) {
        return !seen[p.id];
      }).map(function (p) {
        var place = {
          id: p.id, name: p.name, kind: p.kind || 'other',
          note: p.note || '', ll: p.ll,
          caps: (p.caps || []).slice()
        };
        if (p.hours) place.hours = p.hours;
        if (p.oh) place.oh = p.oh;
        return place;
      });

      vh.places = (vh.places || []).concat(added);
      if (!vh.places.some(function (p) { return p.id === vh.place; })) {
        vh.place = (vh.places[0] || {}).id || 'home';
      }
      vh.worldId = pack.id;
      cache[pack.id] = pack;
      return vh.places.length;
    },

    /* Drop a pack's places again. Anything of your own is untouched, so this
     * puts the life back exactly as it was before the pack was loaded. */
    remove: function (vh, pack) {
      var ids = {};
      (pack.places || []).forEach(function (p) { ids[p.id] = 1; });
      vh.places = (vh.places || []).filter(function (p) { return !ids[p.id]; });
      if (!vh.places.length) vh.places = [{ id: 'home', name: 'Home', kind: 'home', note: '' }];
      vh.worldId = null;
      return vh.places.length;
    },

    /**
     * How long the walk takes, in minutes.
     * Routed across the pack's walking graph, so a place that isn't a direct
     * neighbour still gets a real time rather than a guess.
     */
    minutes: function (pack, fromId, toId) {
      var r = Worlds.route(pack, fromId, toId);
      return r ? r.minutes : 0;
    },

    /**
     * The journey between two places.
     * { minutes, routed, hops } - routed is false when the graph doesn't reach
     * and the time is estimated from the coordinates instead.
     */
    route: function (pack, fromId, toId) {
      if (!pack || !fromId || !toId) return null;
      if (fromId === toId) return { minutes: 0, routed: true, hops: [fromId] };

      var d = distances(pack, fromId).dist;
      if (d[toId] !== undefined) {
        return {
          minutes: Math.round(d[toId] * 100) / 100,
          routed: true,
          hops: Worlds.path(pack, fromId, toId) || [fromId, toId]
        };
      }

      /* Not connected: fall back to the coordinates. */
      var places = placeIndex(pack);
      var a = places[fromId], b = places[toId];
      if (!a || !b || !a.ll || !b.ll) return null;
      var est = metres(a.ll, b.ll) / WALK_MPM * DETOUR;
      return {
        minutes: Math.max(1, Math.round(est * 10) / 10),
        routed: false,
        hops: [fromId, toId]
      };
    },

    /** The places you walk through, or null if the graph doesn't reach. */
    path: function (pack, fromId, toId) {
      if (!pack || fromId === toId) return [fromId];
      var res = distances(pack, fromId);
      if (res.dist[toId] === undefined) return null;
      var out = [toId], at = toId;
      while (at !== fromId) {
        at = res.prev[at];
        if (at === undefined) return null;
        out.unshift(at);
      }
      return out;
    },

    /** Every capability a place has. A cafe is food *and* leisure. */
    caps: function (pack, placeId) {
      var p = placeIndex(pack)[placeId];
      if (!p) return [];
      if (p.caps && p.caps.length) return p.caps;
      return p.kind ? [p.kind] : [];
    },

    /** true, false, or null when the pack doesn't record hours. */
    open: function (pack, placeId, at) {
      return isOpen(placeIndex(pack)[placeId], at);
    },

    /** Every place reachable within a travel budget, nearest first. */
    within: function (pack, fromId, maxMinutes) {
      if (!pack || !fromId) return [];
      var d = distances(pack, fromId).dist;
      var out = [];
      for (var id in d) {
        if (id === fromId) continue;
        if (maxMinutes === undefined || d[id] <= maxMinutes) {
          out.push({ id: id, minutes: Math.round(d[id] * 100) / 100 });
        }
      }
      return out.sort(function (a, b) { return a.minutes - b.minutes; });
    },

    /**
     * Somewhere to go for a need.
     * opts: { from, caps: [..], maxMinutes, at, requireOpen }
     * Prefers a place that is open and matches; accepts an unknown-hours place
     * over nothing. Returns null when nowhere qualifies.
     */
    search: function (pack, opts) {
      opts = opts || {};
      if (!pack) return null;
      var want = opts.caps || [];
      var at = opts.at === undefined ? Date.now() : opts.at;
      var from = opts.from;
      var max = opts.maxMinutes;
      var strict = opts.requireOpen === true;

      var pool = [];
      if (from) {
        var d = distances(pack, from).dist;
        for (var id in d) {
          if (id === from) continue;
          pool.push({ id: id, minutes: Math.round(d[id] * 100) / 100 });
        }
      } else {
        (pack.places || []).forEach(function (p) {
          pool.push({ id: p.id, minutes: 0 });
        });
      }

      var places = placeIndex(pack);
      var scored = [];
      pool.forEach(function (c) {
        if (max !== undefined && c.minutes > max) return;
        var p = places[c.id];
        if (!p) return;
        var caps = p.caps || (p.kind ? [p.kind] : []);
        var match = 0;
        want.forEach(function (w) { if (caps.indexOf(w) !== -1) match++; });
        if (want.length && !match) return;
        var open = isOpen(p, at);
        if (strict && open === false) return;
        scored.push({
          id: c.id, name: p.name, minutes: c.minutes, match: match,
          open: open,
          score: match * 100 - c.minutes + (open === false ? -1000 : (open === true ? 50 : 0))
        });
      });

      if (!scored.length) return null;
      scored.sort(function (a, b) { return b.score - a.score; });
      return scored[0];
    },

    /* --- internals the tests reach for --- */
    _parseHours: parseHours,
    _isOpen: isOpen,
    _metres: metres
  };

  global.Worlds = Worlds;
})(window);
