/* World packs.
 *
 * Upstream Horde Studio ships world-packs/ built from OpenStreetMap: real
 * places with coordinates, and walking routes between them, so a virtual
 * human's journey takes a believable number of minutes. This loads those
 * packs - converted to the small shape described in tools/build-worldpack.py -
 * and answers the only two questions the life engine asks:
 *
 *   which places can they be in, and how long does it take to walk there.
 *
 * Nothing here is required. Without a pack a virtual human keeps the three
 * default places and invents a journey time, exactly as before.
 */
(function (global) {
  'use strict';

  var catalog = null;
  var cache = {};        // id -> pack
  var askedFor = {};     // id -> true, so ensure() only fetches once

  function path(f) { return 'worlds/' + f; }

  function getJSON(f) {
    return fetch(path(f)).then(function (r) {
      if (!r.ok) throw new Error('That world pack is not installed');
      return r.json();
    });
  }

  /* --- lookups, built once per pack --- */

  function routeIndex(pack) {
    if (pack._routes) return pack._routes;
    var idx = {};
    (pack.routes || []).forEach(function (r) {
      var k = r.f < r.t ? r.f + '|' + r.t : r.t + '|' + r.f;
      if (idx[k] === undefined || r.m < idx[k]) idx[k] = r.m;
    });
    pack._routes = idx;
    return idx;
  }

  function placeIndex(pack) {
    if (pack._places) return pack._places;
    var m = {};
    (pack.places || []).forEach(function (p) { m[p.id] = p; });
    pack._places = m;
    return m;
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
      var vh_ = (global.VH || {});
      var seen = {};
      (vh.places || []).forEach(function (p) { seen[p.id] = 1; });

      var added = (pack.places || []).filter(function (p) {
        return !seen[p.id];
      }).map(function (p) {
        return { id: p.id, name: p.name, kind: p.kind, note: p.note || '' };
      });

      vh.places = (vh.places || []).concat(added);
      if (!vh_.place || !vh_.place(vh, vh.place)) {
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

    /* How long the walk takes. The pack's own routes when it knows the pair,
     * otherwise worked out from the coordinates - a straight line is an
     * underestimate, so allow for following streets. */
    minutes: function (pack, fromId, toId) {
      if (!pack || !fromId || !toId) return 0;
      if (fromId === toId) return 0;

      var key = fromId < toId ? fromId + '|' + toId : toId + '|' + fromId;
      var known = routeIndex(pack)[key];
      if (known !== undefined) return known;

      var places = placeIndex(pack);
      var a = places[fromId], b = places[toId];
      if (!a || !b || !a.ll || !b.ll) return 0;

      var m = metres(a.ll, b.ll) / 80 * 1.3;   // ~4.8 km/h, plus detours
      return Math.max(1, Math.round(m * 10) / 10);
    }
  };

  global.Worlds = Worlds;
})(window);
