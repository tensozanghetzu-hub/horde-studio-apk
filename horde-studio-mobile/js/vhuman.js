/* Virtual Humans 2.0 — a life that runs on its own clock.
 *
 * A character answers when you poke it. A virtual human has somewhere else to be:
 * places they go, journeys that take time, needs that build up, other people in
 * their life, a calendar, a relationship with you that is separate from the one
 * they have with anyone else, and the habit of reaching out first.
 *
 * On a phone there are no reliable background timers, so the engine works by
 * "catch-up": every time the app is opened (and every minute while it's in front of
 * you) it advances each human's state by however much real time actually elapsed.
 * Nothing simulates while the app is closed — catch-up resumes when you return.
 */
(function (global) {
  'use strict';

  var DAY = 86400000;

  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function hhmm(d) { return pad(d.getHours()) + ':' + pad(d.getMinutes()); }
  function parseT(s, fallbackMin) {
    var m = /^(\d{1,2}):(\d{2})$/.exec(String(s || '').trim());
    if (!m) return fallbackMin === undefined ? 0 : fallbackMin;
    return Math.max(0, Math.min(23, +m[1])) * 60 + Math.max(0, Math.min(59, +m[2]));
  }
  function mins(d) { return d.getHours() * 60 + d.getMinutes(); }
  function clamp(v) { return Math.max(-1, Math.min(1, v || 0)); }
  function clamp01(v) { return Math.max(0, Math.min(1, v === undefined ? 0.5 : v)); }
  function dayKey(ts) {
    var d = new Date(ts || Date.now());
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }
  function uid(p) { return (p || 'x') + '-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
  function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

  var MOODS = [
    { max: -0.6, label: 'wretched' }, { max: -0.25, label: 'low' },
    { max: 0.25, label: 'steady' }, { max: 0.6, label: 'good' },
    { max: 1.1, label: 'bright' }
  ];
  function moodLabel(v) {
    for (var i = 0; i < MOODS.length; i++) if (v <= MOODS[i].max) return MOODS[i].label;
    return 'steady';
  }
  function relLabel(v) {
    if (v < -0.5) return 'hostile';
    if (v < -0.15) return 'strained';
    if (v < 0.15) return 'neutral';
    if (v < 0.5) return 'warming';
    return 'close';
  }

  var NEED_LABELS = {
    energy: ['spent', 'tired', 'steady', 'rested', 'wide awake'],
    hunger: ['full', 'peckish', 'hungry', 'very hungry', 'starving'],
    social: ['solitary', 'fine alone', 'talkative', 'wanting company', 'lonely'],
    comfort: ['miserable', 'unsettled', 'settled', 'comfortable', 'deeply at ease']
  };
  function needLabel(key, v) {
    var labels = NEED_LABELS[key] || ['low', 'mid', 'high'];
    return labels[Math.max(0, Math.min(labels.length - 1, Math.floor(clamp01(v) * labels.length)))];
  }

  /* How likely they are to up and go somewhere, per hour awake. */
  var WANDER = { off: 0, low: 0.05, medium: 0.12, high: 0.22 };
  /* Autonomous generations allowed per day before the engine stops asking. */
  var DEFAULT_CAP = 12;

  var VH = {
    defaults: function () {
      return {
        enabled: false,
        autonomy: 'low',                 // off | low | medium | high
        routine: [
          { t: '07:00', a: 'waking up, coffee, opening the shutters' },
          { t: '09:00', a: 'working' },
          { t: '13:00', a: 'lunch, a little radio' },
          { t: '18:00', a: 'winding down for the evening' },
          { t: '23:00', a: 'asleep' }
        ],
        sleep: { start: '23:00', end: '07:00' },
        mood: 0,                          // -1 .. 1
        affinity: 0,                      // -1 .. 1
        trust: 0,
        tension: 0,
        replyDelay: { min: 15, max: 120 },  // seconds, while awake
        photos: true,
        lastTick: Date.now(),
        lastContact: 0,
        lastOutreach: 0,
        chronicle: [],                     // [{ts, text}] — the life beats

        /* ---- v18: the life around the inbox ---- */
        places: [
          { id: 'home', name: 'Home', kind: 'home', note: '' },
          { id: 'work', name: 'Work', kind: 'work', note: '' },
          { id: 'town', name: 'Town', kind: 'outdoor', note: '' }
        ],
        place: 'home',                     // where they are right now
        travel: null,                      // {from, to, startedAt, arriveAt}
        needs: { energy: 0.8, hunger: 0.25, social: 0.5, comfort: 0.7 },
        people: [],                        // [{id,name,relation,closeness,note}]
        calendar: [],                      // [{id,label,t,day,placeId}] day 0-6, or null = daily
        bonds: {},                         // persona -> {affinity,trust,tension,lastContact,exchanges}
        feed: [],                          // [{id,ts,kind,text,image,placeId}]
        gallery: [],                       // [{id,ts,prompt,refs,image}] — ideas, unpaid
        perms: { message: true, photo: true, post: true, travel: true },
        spend: { day: '', used: 0, cap: DEFAULT_CAP },
        burst: 3                           // most bubbles they'll send in one go
      };
    },

    ensure: function (char) {
      if (!char.vh || typeof char.vh !== 'object') char.vh = VH.defaults();
      var d = VH.defaults();
      Object.keys(d).forEach(function (k) {
        if (char.vh[k] === undefined) char.vh[k] = d[k];
      });
      /* v1.x lives get the v18 furniture without losing anything they had */
      if (!Array.isArray(char.vh.places) || !char.vh.places.length) char.vh.places = d.places;
      if (!char.vh.needs) char.vh.needs = d.needs;
      else Object.keys(d.needs).forEach(function (k) {
        if (char.vh.needs[k] === undefined) char.vh.needs[k] = d.needs[k];
      });
      if (!char.vh.perms) char.vh.perms = d.perms;
      else Object.keys(d.perms).forEach(function (k) {
        if (char.vh.perms[k] === undefined) char.vh.perms[k] = d.perms[k];
      });
      if (!char.vh.spend) char.vh.spend = d.spend;
      if (char.vh.spend.cap === undefined) char.vh.spend.cap = DEFAULT_CAP;
      if (!Array.isArray(char.vh.people)) char.vh.people = [];
      if (!Array.isArray(char.vh.calendar)) char.vh.calendar = [];
      if (!Array.isArray(char.vh.feed)) char.vh.feed = [];
      if (!Array.isArray(char.vh.gallery)) char.vh.gallery = [];
      if (!char.vh.bonds || typeof char.vh.bonds !== 'object') char.vh.bonds = {};
      if (!VH.place(char.vh, char.vh.place)) char.vh.place = (char.vh.places[0] || {}).id || 'home';
      if (char.vh.burst === undefined) char.vh.burst = 3;
      return char.vh;
    },

    /* ================= the clock ================= */
    isAsleep: function (vh, when) {
      var d = when ? new Date(when) : new Date();
      var s = parseT(vh.sleep.start, 23 * 60), e = parseT(vh.sleep.end, 7 * 60), now = mins(d);
      return s <= e ? (now >= s && now < e) : (now >= s || now < e);
    },

    /** What they're doing right now, straight off the routine. */
    activity: function (vh, when) {
      var d = when ? new Date(when) : new Date();
      if (VH.isAsleep(vh, d)) return 'asleep';
      var now = mins(d), best = null;
      (vh.routine || []).forEach(function (r) {
        var t = parseT(r.t, -1);
        if (t >= 0 && t <= now && (!best || t > best.t)) best = { t: t, a: r.a };
      });
      if (!best && (vh.routine || []).length) {
        /* before the first entry: use the last entry of the previous day */
        var last = null;
        (vh.routine || []).forEach(function (r) {
          var t = parseT(r.t, -1);
          if (t >= 0 && (!last || t > last.t)) last = { t: t, a: r.a };
        });
        best = last;
      }
      return best ? best.a : 'awake';
    },

    /** Human-readable "now" line, e.g. "Asleep · back at 07:00". */
    status: function (char, when) {
      var vh = VH.ensure(char);
      var d = when ? new Date(when) : new Date();
      var asleep = VH.isAsleep(vh, d);
      var txt = asleep ? 'Asleep' : (VH.activity(vh, d) || 'Awake');
      if (asleep) txt += ' · back around ' + vh.sleep.end;
      return {
        asleep: asleep,
        activity: VH.activity(vh, d),
        text: txt,
        time: hhmm(d),
        mood: moodLabel(vh.mood),
        relationship: relLabel(vh.affinity)
      };
    },

    /** Minutes until they're next awake (0 if awake now). */
    untilAwake: function (vh, when) {
      if (!VH.isAsleep(vh, when)) return 0;
      var d = new Date(when || Date.now());
      var e = parseT(vh.sleep.end, 7 * 60), now = mins(d);
      var diff = e - now;
      if (diff <= 0) diff += 24 * 60;
      return diff;
    },

    /* ================= places and journeys ================= */
    place: function (vh, id) {
      var list = (vh && vh.places) || [];
      for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
      return null;
    },
    placeName: function (vh, id) {
      var p = VH.place(vh, id);
      return p ? p.name : '';
    },
    atHome: function (vh) {
      var p = VH.place(vh, vh.place);
      return !!p && p.kind === 'home';
    },

    /** Where they are, or where they're headed. */
    where: function (vh) {
      if (vh.travel) {
        return {
          travelling: true,
          name: 'on the way to ' + VH.placeName(vh, vh.travel.to),
          from: VH.placeName(vh, vh.travel.from),
          to: VH.placeName(vh, vh.travel.to),
          eta: vh.travel.arriveAt,
          minutesLeft: Math.max(0, Math.round((vh.travel.arriveAt - Date.now()) / 60000))
        };
      }
      return {
        travelling: false,
        name: VH.placeName(vh, vh.place) || 'somewhere',
        id: vh.place
      };
    },

    /** Put them on their way somewhere. Minutes is the journey length. */
    depart: function (vh, placeId, minutes, now) {
      now = now || Date.now();
      if (!VH.place(vh, placeId)) return null;
      if (vh.place === placeId && !vh.travel) return null;
      var mins2 = minutes || (10 + Math.floor(Math.random() * 35));
      vh.travel = {
        from: vh.place, to: placeId,
        startedAt: now, arriveAt: now + mins2 * 60000
      };
      return vh.travel;
    },

    /** Choose somewhere to go: evening pulls home, daytime pulls out. */
    pickDestination: function (vh, when) {
      var list = (vh.places || []).filter(function (p) { return p.id !== vh.place; });
      if (!list.length) return null;
      var hour = new Date(when || Date.now()).getHours();
      var evening = hour >= 18 || hour < 6;
      var homes = list.filter(function (p) { return p.kind === 'home'; });
      var out = list.filter(function (p) { return p.kind !== 'home'; });
      if (evening && homes.length) return homes[0];
      if (!evening && out.length) return pick(out);
      return pick(list);
    },

    /* ================= needs ================= */
    /** Advance needs by real elapsed hours. Returns beats worth recording. */
    tickNeeds: function (vh, hours, asleep, at) {
      var beats = [], n = vh.needs;
      if (asleep) {
        n.energy = clamp01(n.energy + hours * 0.13);
        n.hunger = clamp01(n.hunger + hours * 0.01);
        n.social = clamp01(n.social + hours * 0.02);
        n.comfort = clamp01(n.comfort + hours * 0.05);
        return beats;
      }
      n.energy = clamp01(n.energy - hours * 0.035);
      n.hunger = clamp01(n.hunger + hours * 0.055);
      n.social = clamp01(n.social + hours * 0.04);
      /* comfort drifts toward what the current place affords */
      var target = VH.atHome(vh) ? 0.75 : (vh.travel ? 0.35 : 0.55);
      n.comfort = clamp01(n.comfort + (target - n.comfort) * Math.min(1, hours * 0.3));

      /* meals: if a mealtime hour passed while awake, they ate */
      var mealHours = [7, 13, 19];
      var now = at || Date.now();
      var from = now - hours * 3600000;
      for (var i = 0; i < mealHours.length; i++) {
        var mt = new Date(now); mt.setHours(mealHours[i], 0, 0, 0);
        if (mt.getTime() > from && mt.getTime() <= now) {
          n.hunger = clamp01(n.hunger - 0.6);
          beats.push('ate (' + (mealHours[i] === 7 ? 'breakfast' : mealHours[i] === 13 ? 'lunch' : 'dinner') + ')');
        }
      }
      /* running on empty sours the mood a little */
      if (n.energy < 0.25) vh.mood = clamp(vh.mood - hours * 0.02);
      if (n.hunger > 0.8) vh.mood = clamp(vh.mood - hours * 0.01);
      return beats;
    },

    /* ================= calendar ================= */
    /** The event happening now (within 45 min), if any. */
    eventNow: function (vh, when) {
      var d = new Date(when || Date.now());
      var now = mins(d), day = d.getDay();
      var hit = null;
      (vh.calendar || []).forEach(function (e) {
        if (e.day !== null && e.day !== undefined && e.day !== day) return;
        var t = parseT(e.t, -1);
        if (t < 0) return;
        var diff = Math.abs(t - now);
        if (diff <= 45 && (!hit || diff < hit.diff)) hit = { event: e, diff: diff, t: t };
      });
      return hit ? hit.event : null;
    },

    /** The next thing in the diary today (or tomorrow), if any. */
    nextEvent: function (vh, when) {
      var d = new Date(when || Date.now());
      var now = mins(d), day = d.getDay();
      var best = null;
      (vh.calendar || []).forEach(function (e) {
        if (e.day !== null && e.day !== undefined && e.day !== day) return;
        var t = parseT(e.t, -1);
        if (t < 0 || t <= now) return;
        if (!best || t < best.t) best = { event: e, t: t };
      });
      return best ? best.event : null;
    },

    eventsToday: function (vh, when) {
      var day = new Date(when || Date.now()).getDay();
      return (vh.calendar || []).filter(function (e) {
        return e.day === null || e.day === undefined || e.day === day;
      }).sort(function (a, b) { return parseT(a.t, 0) - parseT(b.t, 0); });
    },

    /* ================= relationships ================= */
    /** The bond with one player persona — each persona gets their own history. */
    bond: function (vh, persona) {
      persona = persona || (global.Store && Store.settings && Store.settings.userName) || 'You';
      if (!vh.bonds[persona]) {
        vh.bonds[persona] = {
          affinity: vh.affinity || 0, trust: vh.trust || 0, tension: vh.tension || 0,
          lastContact: 0, exchanges: 0, persona: persona
        };
      }
      return vh.bonds[persona];
    },
    noteBond: function (vh, persona, delta) {
      var b = VH.bond(vh, persona);
      b.affinity = clamp(b.affinity + (delta.affinity || 0));
      b.trust = clamp(b.trust + (delta.trust || 0));
      b.tension = clamp(b.tension + (delta.tension || 0));
      b.lastContact = Date.now();
      b.exchanges = (b.exchanges || 0) + 1;
      return b;
    },
    personas: function (vh) { return Object.keys(vh.bonds || {}); },

    /* ================= social feed & gallery ================= */
    feedAdd: function (vh, post) {
      if (!Array.isArray(vh.feed)) vh.feed = [];
      var p = {
        id: post.id || uid('post'), ts: post.ts || Date.now(),
        kind: post.kind || 'post', text: post.text || '',
        image: post.image || null, placeId: post.placeId || vh.place || null,
        autonomous: post.autonomous !== false
      };
      vh.feed.push(p);
      if (vh.feed.length > 80) vh.feed = vh.feed.slice(-80);
      return p;
    },
    galleryAdd: function (vh, idea) {
      if (!Array.isArray(vh.gallery)) vh.gallery = [];
      var g = {
        id: idea.id || uid('idea'), ts: idea.ts || Date.now(),
        prompt: idea.prompt || '', refs: idea.refs || [], image: idea.image || null
      };
      vh.gallery.push(g);
      if (vh.gallery.length > 40) vh.gallery = vh.gallery.slice(-40);
      return g;
    },

    /* ================= autonomy: permissions and spending ================= */
    perm: function (vh, key) {
      if (!vh.perms) return true;
      return vh.perms[key] !== false;
    },
    /** Today's autonomous spending. Resets when the local date changes. */
    spend: function (vh) {
      if (!vh.spend) vh.spend = { day: '', used: 0, cap: DEFAULT_CAP };
      var today = dayKey();
      if (vh.spend.day !== today) { vh.spend.day = today; vh.spend.used = 0; }
      if (vh.spend.cap === undefined) vh.spend.cap = DEFAULT_CAP;
      return {
        used: vh.spend.used || 0,
        cap: vh.spend.cap,
        left: Math.max(0, (vh.spend.cap || 0) - (vh.spend.used || 0))
      };
    },
    canSpend: function (vh) { return VH.spend(vh).left > 0; },
    spendOne: function (vh) {
      var s = VH.spend(vh);
      vh.spend.used = (vh.spend.used || 0) + 1;
      return VH.spend(vh);
    },

    /* ================= advancing the life ================= */
    /** Move everything forward by real elapsed time. Returns a summary. */
    tick: function (char) {
      var vh = VH.ensure(char);
      var now = Date.now();
      var last = vh.lastTick || now;
      var hours = Math.max(0, (now - last) / 3600000);
      var dueToArrive = !!(vh.travel && now >= vh.travel.arriveAt);
      vh.lastTick = now;
      /* A journey finishes on its own clock, not on the catch-up threshold —
         otherwise a trip only completes once 72 real seconds have passed. */
      if (hours < 0.02 && !dueToArrive) return { hours: 0, beats: [] };

      /* Cap the catch-up so a fortnight away doesn't produce a fortnight of news.
         The mood/need maths stays gentle; the diary just picks up where it is. */
      var simHours = Math.min(hours, 36);

      /* Mood drifts gently back toward neutral and tension cools on its own —
         but only a fraction per hour, so a night apart doesn't erase a mood. */
      vh.mood -= vh.mood * Math.min(0.35, simHours * 0.02);
      vh.tension -= vh.tension * Math.min(0.30, simHours * 0.03);
      /* long silences cool a warm relationship a little, and heat a cold one not at all */
      if (hours > 12 && vh.affinity > 0) vh.affinity -= Math.min(0.08, hours / 24 * 0.05);
      vh.mood = clamp(vh.mood); vh.affinity = clamp(vh.affinity);
      vh.tension = clamp(vh.tension);

      var asleep = VH.isAsleep(vh, now);
      var beats = [];

      /* journeys: finish the current one, maybe start another */
      if (vh.travel) {
        if (now >= vh.travel.arriveAt) {
          vh.place = vh.travel.to;
          beats.push('arrived at ' + VH.placeName(vh, vh.travel.to));
          vh.travel = null;
        } else {
          beats.push('travelling to ' + VH.placeName(vh, vh.travel.to));
        }
      } else if (!asleep && VH.perm(vh, 'travel') && simHours >= 0.5) {
        /* the diary wins: if something is about to start elsewhere, head there */
        var ev = VH.eventNow(vh, now) || VH.nextEvent(vh, now);
        var due = ev && parseT(ev.t, -1) - mins(new Date(now));
        var goto = null;
        if (ev && ev.placeId && ev.placeId !== vh.place && due !== null && due <= 60) goto = ev.placeId;
        else {
          var chance = (WANDER[vh.autonomy] || 0) * simHours;
          if (Math.random() < chance) {
            var dest = VH.pickDestination(vh, now);
            if (dest) goto = dest.id;
          }
        }
        if (goto && VH.depart(vh, goto, null, now)) {
          beats.push('left for ' + VH.placeName(vh, goto));
        }
      }

      /* needs */
      VH.tickNeeds(vh, simHours, asleep, now).forEach(function (b) { beats.push(b); });

      var act = VH.activity(vh, now);
      if (hours >= 1) {
        var lastBeat = vh.chronicle.length ? vh.chronicle[vh.chronicle.length - 1] : null;
        if (!lastBeat || lastBeat.text !== act || hours >= 6) beats.push(act);
      }
      /* one beat per tick is plenty — take the most interesting one */
      if (beats.length) {
        var text = beats[0];
        vh.chronicle = (vh.chronicle || []).concat([{ ts: now, text: text }]).slice(-40);
      }
      return { hours: hours, beats: beats.map(function (t) { return { ts: now, text: t }; }) };
    },

    /** Register that you spoke to them: warmth grows, they're "in contact". */
    noteContact: function (char, opts) {
      var vh = VH.ensure(char);
      opts = opts || {};
      vh.lastContact = Date.now();
      vh.affinity = clamp(vh.affinity + (opts.warm === false ? -0.01 : 0.02));
      vh.trust = clamp(vh.trust + 0.005);
      /* company satisfies a social need */
      vh.needs.social = clamp01((vh.needs.social || 0.5) - 0.25);
      var persona = opts.persona || (global.Store && Store.settings && Store.settings.userName) || 'You';
      VH.noteBond(vh, persona, { affinity: opts.warm === false ? -0.01 : 0.02, trust: 0.005 });
      return vh;
    },

    /** They replied: tension drops a touch, closeness depends on the exchange. */
    noteReply: function (char, userText) {
      var vh = VH.ensure(char);
      vh.tension = clamp(vh.tension - 0.05);
      var t = String(userText || '');
      var warm = /thank|please|sorry|miss|love|glad|happy|haha|lol/i.test(t);
      var cold = /hate|stupid|shut up|leave me|whatever|idiot/i.test(t);
      var d = { affinity: 0, trust: 0, tension: -0.05 };
      if (warm) {
        vh.affinity = clamp(vh.affinity + 0.04); vh.mood = clamp(vh.mood + 0.05);
        d.affinity = 0.04; d.trust = 0.01;
      }
      if (cold) {
        vh.affinity = clamp(vh.affinity - 0.05); vh.tension = clamp(vh.tension + 0.12);
        vh.mood = clamp(vh.mood - 0.08);
        d.affinity = -0.05; d.tension = 0.12;
      }
      var persona = (global.Store && Store.settings && Store.settings.userName) || 'You';
      VH.noteBond(vh, persona, d);
      return vh;
    },

    /* ================= delayed replies ================= */
    /** Seconds to wait before answering, or null if they answer right away. */
    replyDelay: function (char) {
      var vh = VH.ensure(char);
      if (vh.autonomy === 'off') return null;
      if (VH.isAsleep(vh)) {
        var d = new Date();
        var e = parseT(vh.sleep.end, 7 * 60), now = mins(d);
        var minsLeft = e - now;
        if (minsLeft <= 0) minsLeft += 24 * 60;
        return Math.min(minsLeft * 60, 10 * 3600);
      }
      var base = (vh.replyDelay.min || 15) + Math.random() * Math.max(0, (vh.replyDelay.max || 120) - (vh.replyDelay.min || 15));
      /* colder relationships take longer to answer */
      var factor = 1 + Math.max(0, -vh.affinity) * 1.5 + Math.max(0, vh.tension);
      /* on the move, or running on empty: slower still */
      if (vh.travel) factor *= 1.6;
      if ((vh.needs.energy || 1) < 0.25) factor *= 1.4;
      var delay = Math.round(base * factor);
      return delay > 8 ? delay : null;    // under 8s: just answer normally
    },

    /* ================= reaching out first ================= */
    var_hours: { off: 0, low: 20, medium: 6, high: 2 },

    /** Should they message you unprompted right now? */
    shouldReachOut: function (char) {
      var vh = VH.ensure(char);
      if (!vh.enabled || vh.autonomy === 'off') return null;
      if (VH.isAsleep(vh)) return null;
      if (!VH.canSpend(vh)) return null;                    // daily budget spent
      var now = Date.now();
      var since = (now - (vh.lastOutreach || vh.lastContact || now)) / 3600000;
      var gap = VH.var_hours[vh.autonomy] || 20;
      /* a high social need shortens the wait — they're the ones who get bored first */
      if ((vh.needs.social || 0) > 0.7) gap *= 0.6;
      if (since < gap) return null;
      /* don't spam: never more than one unprompted message per hour of real time */
      if (now - (vh.lastOutreach || 0) < 3600000) return null;
      var roll = Math.random();
      var photo = VH.perm(vh, 'photo') && vh.photos && roll < 0.22;
      if (!photo && !VH.perm(vh, 'message')) return null;
      return { kind: photo ? 'photo' : 'message', hours: since };
    },

    /* ================= prompt building ================= */
    contextLine: function (char, when, persona) {
      var vh = VH.ensure(char);
      var st = VH.status(char, when);
      var d = when ? new Date(when) : new Date();
      var days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
      var where = VH.where(vh);
      var who = persona || (global.Store && Store.settings && Store.settings.userName) || 'You';
      var b = VH.bond(vh, who);
      var n = vh.needs;

      var line = 'It is ' + st.time + ' on ' + days[d.getDay()] + '. ' +
        'You are at ' + where.name + (where.travelling ? ' (arriving in ' + where.minutesLeft + ' minutes)' : '') + '. ' +
        'Right now you are: ' + st.activity + '. ' +
        'Your mood is ' + st.mood + '. ' +
        'Needs: energy ' + needLabel('energy', n.energy) + ', hunger ' + needLabel('hunger', n.hunger) +
        ', company ' + needLabel('social', n.social) + ', comfort ' + needLabel('comfort', n.comfort) + '.';

      var ev = VH.eventNow(vh, when) || VH.nextEvent(vh, when);
      if (ev) {
        var evMins = parseT(ev.t, -1), nowMins = mins(d);
        line += ' ' + (evMins >= nowMins ? 'Coming up' : 'Happening now') + ': ' + ev.label +
          ' at ' + (ev.t || '') + (ev.placeId ? ' (' + VH.placeName(vh, ev.placeId) + ')' : '') + '.';
      }

      var close = (vh.people || []).slice()
        .sort(function (a, x) { return (x.closeness || 0) - (a.closeness || 0); }).slice(0, 2);
      if (close.length) {
        line += ' People in your life: ' + close.map(function (p) {
          return p.name + ' (' + p.relation + ', ' + relLabel((p.closeness || 0) * 2 - 1) + ')';
        }).join('; ') + '.';
      }

      line += ' Your relationship with ' + who + ' is ' + relLabel(b.affinity) +
        ' (affinity ' + b.affinity.toFixed(2) + ', trust ' + b.trust.toFixed(2) +
        ', tension ' + b.tension.toFixed(2) + ', ' + (b.exchanges || 0) + ' exchanges).';
      return line;
    },

    /** Prompt for an unprompted message / photo caption they send you. */
    outreachPrompt: function (char, session, history, kind) {
      var vh = VH.ensure(char);
      var s = global.Store ? Store.settings : { userName: 'You' };
      var lastUser = null, lastThem = null;
      (history || []).slice().reverse().forEach(function (m) {
        if (!lastUser && m.role === 'user') lastUser = m.text;
        if (!lastThem && m.role === 'assistant') lastThem = m.text;
      });
      var recent = (vh.chronicle || []).slice(-4).map(function (c) {
        return new Date(c.ts).toLocaleString() + ' — ' + c.text;
      }).join('\n');

      var max = Math.max(1, Math.min(4, vh.burst || 3));
      var burstNote = max > 1
        ? 'You may send up to ' + max + ' short separate messages, the way people actually text — ' +
          'put each one on its own line, one thought per line. One is fine if that is all you have to say.'
        : '';

      return [
        'You are ' + char.name + '. ' + (char.persona || ''),
        VH.contextLine(char),
        lastUser ? 'The last thing ' + s.userName + ' said to you was: "' + lastUser.slice(0, 200) + '"' : 'You have not spoken yet.',
        lastThem ? 'The last thing you said was: "' + lastThem.slice(0, 200) + '"' : '',
        recent ? 'Recent beats of your day:\n' + recent : '',
        '',
        kind === 'photo'
          ? 'You are sending them a photo. Write ONLY a one-line caption (under 15 words) for the picture you are sending, in your voice. No quotes, no stage directions.'
          : 'Send a short unprompted message to ' + s.userName + ' — the kind of thing a person actually fires off: an observation, a complaint, a small news item, a question, something you noticed. ' +
            burstNote + ' Under 40 words in total. Stay in voice. No narration, no asterisks, no "' + char.name + ':" prefix.'
      ].filter(Boolean).join('\n');
    },

    /** Extra instruction when they're answering late. */
    latenessNote: function (char, waitedMs, asleep) {
      var vh = VH.ensure(char);
      var mins = Math.round(waitedMs / 60000);
      var how = mins < 90 ? (mins + ' minutes') : (Math.round(mins / 60) + ' hours');
      var where = VH.where(vh);
      return 'You are replying ' + how + ' after they wrote' +
        (asleep ? ' — you were asleep, and only just saw it.'
                : ' — you were busy: ' + (where.travelling ? where.name : (VH.activity(vh) || 'occupied')) + '.') +
        ' React to the delay the way a real person would (an apology, a brush-off, or silence about it, depending on who you are).';
    },

    /* ================= the Life screen ================= */
    /** Everything the Life view needs, in one call. */
    life: function (char) {
      var vh = VH.ensure(char);
      var who = (global.Store && Store.settings && Store.settings.userName) || 'You';
      var b = VH.bond(vh, who);
      var where = VH.where(vh);
      var st = VH.summary(char);
      return {
        summary: st,
        where: where,
        places: (vh.places || []).slice(),
        needs: ['energy', 'hunger', 'social', 'comfort'].map(function (k) {
          return { key: k, value: clamp01(vh.needs[k]), label: needLabel(k, vh.needs[k]) };
        }),
        people: (vh.people || []).slice().sort(function (a, x) {
          return (x.closeness || 0) - (a.closeness || 0);
        }),
        calendar: {
          today: VH.eventsToday(vh),
          now: VH.eventNow(vh),
          next: VH.nextEvent(vh)
        },
        bond: {
          persona: who, affinity: b.affinity, trust: b.trust, tension: b.tension,
          label: relLabel(b.affinity), exchanges: b.exchanges || 0,
          lastContact: b.lastContact || vh.lastContact || 0
        },
        personas: VH.personas(vh),
        spend: VH.spend(vh),
        perms: {
          message: VH.perm(vh, 'message'), photo: VH.perm(vh, 'photo'),
          post: VH.perm(vh, 'post'), travel: VH.perm(vh, 'travel')
        },
        feed: (vh.feed || []).slice(-12).reverse(),
        gallery: (vh.gallery || []).slice(-12).reverse()
      };
    },

    /** Nudge state after an exchange, used for the meters. */
    summary: function (char) {
      var vh = VH.ensure(char);
      return {
        mood: vh.mood, moodLabel: moodLabel(vh.mood),
        affinity: vh.affinity, trust: vh.trust, tension: vh.tension,
        relationship: relLabel(vh.affinity),
        asleep: VH.isAsleep(vh),
        activity: VH.activity(vh),
        chronicle: (vh.chronicle || []).slice(-6).reverse()
      };
    },

    /* ================= portable lives ================= */
    /**
     * A clean template (no conversations) or a Full Portable Human with the saved
     * life and its chats. JSON here rather than upstream's ZIP: no zip library on
     * the device, and a single file is easier to move off a phone.
     */
    portable: function (char, sessions, messages, withHistory) {
      var vh = VH.ensure(char);
      var copy = JSON.parse(JSON.stringify(char));
      /* the publisher's private bits never travel */
      delete copy.id;
      var payload = {
        format: 'horde.human/1',
        kind: withHistory ? 'full' : 'template',
        exportedAt: new Date().toISOString(),
        app: 'horde-studio-mobile',
        character: copy,
        sessions: [],
        messages: []
      };
      if (withHistory) {
        var ids = {};
        (sessions || []).forEach(function (s) { ids[s.id] = true; });
        payload.sessions = JSON.parse(JSON.stringify(sessions || []));
        payload.messages = JSON.parse(JSON.stringify((messages || []).filter(function (m) {
          return ids[m.sessionId];
        })));
      } else {
        /* a template keeps the life's shape, not its memories of you */
        copy.vh.bonds = {};
        copy.vh.feed = [];
        copy.vh.gallery = [];
        copy.vh.chronicle = [];
        copy.vh.lastContact = 0;
        copy.vh.lastOutreach = 0;
        copy.vh.spend = { day: '', used: 0, cap: vh.spend && vh.spend.cap !== undefined ? vh.spend.cap : DEFAULT_CAP };
      }
      return payload;
    },

    /**
     * Turn an exported payload into something safe to save: fresh ids, an isolated
     * copy that never overwrites an existing life, and no queued autonomous jobs.
     */
    adopt: function (payload) {
      if (!payload || !payload.character) throw new Error('Not a portable human file');
      if (String(payload.format || '').indexOf('horde.human/') !== 0) {
        throw new Error('Unrecognised format: ' + (payload.format || 'unknown'));
      }
      var char = JSON.parse(JSON.stringify(payload.character));
      var stamp = Date.now().toString(36);
      var newId = uid('c');
      var sessions = JSON.parse(JSON.stringify(payload.sessions || []));
      var messages = JSON.parse(JSON.stringify(payload.messages || []));
      var map = {};
      sessions.forEach(function (s) {
        map[s.id] = uid('s');
        s.id = map[s.id];
        s.charId = newId;
        s.pending = null;            // never re-submit a job from another install
        s.timeline = s.timeline || 'main';
      });
      messages.forEach(function (m) {
        m.sessionId = map[m.sessionId] || m.sessionId;
        delete m.id;
      });
      char.id = newId;
      char.updatedAt = Date.now();
      VH.ensure(char);
      char.vh.spend = { day: '', used: 0, cap: (char.vh.spend && char.vh.spend.cap) || DEFAULT_CAP };
      char.vh.travel = null;
      char.vh.lastOutreach = 0;
      char.vh.lastTick = Date.now();
      return { character: char, sessions: sessions, messages: messages, kind: payload.kind || 'template' };
    }
  };

  global.VH = VH;
  global.VH.NEED_LABELS = NEED_LABELS;
  global.VH.needLabel = needLabel;
  global.VH.relLabel = relLabel;
  global.VH.uid = uid;
  global.VH.dayKey = dayKey;
  global.VH.DEFAULT_CAP = DEFAULT_CAP;
})(window);
