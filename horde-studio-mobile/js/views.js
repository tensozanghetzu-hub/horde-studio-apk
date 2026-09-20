/* Screen rendering */
(function (global) {
  'use strict';

  var esc = UI.esc, md = UI.md, icon = UI.icon;

  function $(sel, root) { return (root || document).querySelector(sel); }
  function on(root, sel, ev, fn) {
    (root.querySelectorAll ? root.querySelectorAll(sel) : []).forEach(function (el) {
      el.addEventListener(ev, fn);
    });
  }
  function initials(name) {
    return String(name || '?').trim().split(/\s+/).slice(0, 2).map(function (w) { return w[0]; }).join('').toUpperCase();
  }
  function avatarHtml(src, name, cls) {
    if (src) return '<img src="' + esc(src) + '" alt="" class="' + (cls || '') + '">';
    return '<div class="ph" style="width:100%;height:100%;display:grid;place-items:center;font-size:12px;color:var(--dim)">' +
      esc(initials(name)) + '</div>';
  }
  function pickFile(accept) {
    return new Promise(function (resolve) {
      var inp = document.createElement('input');
      inp.type = 'file'; inp.accept = accept;
      inp.onchange = function () { resolve(inp.files && inp.files[0]); };
      inp.click();
    });
  }
  function fileToDataUrl(file) {
    return new Promise(function (resolve, reject) {
      var fr = new FileReader();
      fr.onload = function () { resolve(fr.result); };
      fr.onerror = reject;
      fr.readAsDataURL(file);
    });
  }

  var Views = {};

  /* ================= PERSONA SWITCHER ================= */
  /* One-tap identity switching on the Characters tab. Editing lives in
     Settings — this bar answers only "who am I right now?". Hidden entirely
     until you have created at least one persona, so nothing changes for
     anyone who never touches it. */
  function renderPersonaBar() {
    var bar = $('#persona-bar');
    if (!bar) return;
    var list = Store.personas || [];
    var active = (Store.settings && Store.settings.activePersona) || '';

    bar.hidden = list.length === 0;
    if (bar.hidden) { bar.innerHTML = ''; return; }

    var defName = (Store.settings && Store.settings.defaultName) || 'You';
    bar.innerHTML =
      '<span class="persona-lbl">You are</span>' +
      '<button class="pchip' + (active ? '' : ' on') + '" data-persona="">' +
        icon('user') + esc(defName) + '</button>' +
      list.map(function (p) {
        return '<button class="pchip' + (active === p.id ? ' on' : '') + '" data-persona="' +
          esc(p.id) + '">' + icon('user') + esc(p.name || 'Unnamed') + '</button>';
      }).join('') +
      '<button class="pchip add" data-persona-new="1">' + icon('plus') + 'New</button>';

    on(bar, '.pchip', 'click', function (e) {
      var el = e.currentTarget;
      if (el.getAttribute('data-persona-new')) return App.newPersona();
      App.switchTo(el.getAttribute('data-persona') || '');
    });
  }
  Views.renderPersonaBar = function () { renderPersonaBar(); };

  /* ================= CAST ================= */
  Views.characters = function (root) {
    var q = (App.state.query || '').toLowerCase();
    var tag = App.state.tag || '';
    var list = Store.characters.filter(function (c) {
      var okQ = !q || (c.name || '').toLowerCase().indexOf(q) !== -1 ||
        (c.tagline || '').toLowerCase().indexOf(q) !== -1 ||
        (c.tags || []).join(' ').toLowerCase().indexOf(q) !== -1;
      var okT = !tag || (c.tags || []).indexOf(tag) !== -1;
      return okQ && okT;
    });

    var tags = {};
    Store.characters.forEach(function (c) { (c.tags || []).forEach(function (t) { tags[t] = (tags[t] || 0) + 1; }); });
    var tagNames = Object.keys(tags).sort(function (a, b) { return tags[b] - tags[a]; }).slice(0, 14);

    $('#tag-bar').innerHTML = tagNames.length
      ? '<button class="tag' + (tag ? '' : ' on') + '" data-tag="">All</button>' +
        tagNames.map(function (t) {
          return '<button class="tag' + (tag === t ? ' on' : '') + '" data-tag="' + esc(t) + '">' + esc(t) + '</button>';
        }).join('')
      : '';
    $('#tag-bar').hidden = !tagNames.length;
    on($('#tag-bar'), '.tag', 'click', function (e) {
      App.state.tag = e.currentTarget.getAttribute('data-tag');
      Views.characters(root);
    });

    renderPersonaBar();

    var grid = $('#char-grid');
    var empty = $('#char-empty');
    empty.hidden = Store.characters.length > 0;
    grid.hidden = list.length === 0;

    grid.innerHTML = list.map(function (c) {
      return '<div class="card" data-id="' + c.id + '">' +
        '<div class="card-art">' +
          (c.avatar ? '<img src="' + esc(c.avatar) + '" alt="">' :
            '<div class="ph">' + icon('user') + '</div>') +
          ((c.vh && c.vh.enabled)
            ? '<span class="badge-vh"><svg viewBox="0 0 24 24" style="width:10px;height:10px;stroke:currentColor"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg> living</span>'
            : '') +
          '<button class="card-menu" data-menu="' + c.id + '" aria-label="Options">' +
            '<svg viewBox="0 0 24 24"><circle cx="12" cy="5" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="12" cy="19" r="1.6"/></svg>' +
          '</button>' +
        '</div>' +
        '<div class="card-body">' +
          '<div class="card-name">' + esc(c.name || 'Unnamed') + '</div>' +
          '<div class="card-sub">' + esc(c.tagline || (c.persona || '').slice(0, 90)) + '</div>' +
          ((c.tags && c.tags.length) ? '<div class="card-tags">' +
            c.tags.slice(0, 3).map(function (t) { return '<span class="mini-tag">' + esc(t) + '</span>'; }).join('') +
            '</div>' : '') +
        '</div>' +
      '</div>';
    }).join('');

    on(grid, '.card', 'click', function (e) {
      if (e.target.closest('[data-menu]')) return;
      App.openCharacter(e.currentTarget.getAttribute('data-id'));
    });
    on(grid, '[data-menu]', 'click', function (e) {
      e.stopPropagation();
      App.characterMenu(e.currentTarget.getAttribute('data-menu'));
    });
    on(empty, '[data-act=new-char]', 'click', function () { App.editCharacter(null); });
    on(empty, '[data-act=import-card]', 'click', App.importCard);
  };

  /* ================= LIFE (virtual humans) ================= */
  function needBar(label, text, value) {
    var pct = Math.round(Math.max(0, Math.min(1, value || 0)) * 100);
    return '<div class="meter"><span>' + esc(label) + '</span><b>' + esc(text) + '</b>' +
      '<div class="bar"><i style="width:' + pct + '%"></i></div></div>';
  }
  function signedBar(label, text, value) {
    var pct = Math.round((Math.max(-1, Math.min(1, value || 0)) + 1) / 2 * 100);
    return '<div class="meter"><span>' + esc(label) + '</span><b>' + esc(text) + '</b>' +
      '<div class="bar"><i style="width:' + pct + '%"></i></div></div>';
  }

  Views.life = function (root) {
    var body = $('#now-body');
    var all = Store.characters;
    if (!all.length) {
      body.innerHTML = '<div class="empty"><div class="empty-art">' + icon('time') + '</div>' +
        '<h3>No one lives here yet</h3><p>Virtual humans are built on top of characters — create one first.</p>' +
        '<button class="btn primary" data-act="new">Create character</button>' +
        '<button class="btn ghost" data-act="import">Import a portable human</button></div>';
      on(body, '[data-act=new]', 'click', function () { App.editCharacter(null); });
      on(body, '[data-act=import]', 'click', App.importHuman);
      return;
    }
    var vhs = all.filter(function (c) { return c.vh && c.vh.enabled; });
    if (!vhs.length) {
      body.innerHTML = '<div class="empty"><div class="empty-art">' + icon('time') + '</div>' +
        '<h3>No virtual humans yet</h3>' +
        '<p>Turn a character into a virtual human and they get a life of their own: places they go, ' +
        'needs that build up, other people, a diary, hours where they sleep instead of answering, ' +
        'and the habit of messaging you first.</p>' +
        '<button class="btn primary" data-act="pick">Choose a character</button>' +
        '<button class="btn ghost" data-act="import">Import a portable human</button></div>';
      on(body, '[data-act=pick]', 'click', App.pickVirtualHuman);
      on(body, '[data-act=import]', 'click', App.importHuman);
      return;
    }

    body.innerHTML = '<div class="hint" style="margin:0 2px 10px">Their day advances on real time — ' +
      'open the app after a few hours away and you may find messages waiting.</div>' +
      vhs.map(function (c) { return lifeCard(c); }).join('') +
      '<button class="btn ghost block sm" data-act="pick" style="margin-top:4px">' + icon('plus') + ' Make another character a virtual human</button>' +
      '<button class="btn ghost block sm" data-act="import" style="margin-top:6px">Import a portable human</button>';

    on(body, '[data-act=pick]', 'click', App.pickVirtualHuman);
    on(body, '[data-act=import]', 'click', App.importHuman);
    on(body, '[data-a]', 'click', function (e) {
      var id = e.currentTarget.closest('[data-vh]').getAttribute('data-vh');
      var a = e.currentTarget.getAttribute('data-a');
      Promise.resolve(Store.getCharacter(id)).then(function (c) {
        if (a === 'chat') App.openLatestOrNew(c.id);
        else if (a === 'nudge') App.nudge(c);
        else if (a === 'life') App.openLife(c);
        else if (a === 'feed') { App.state.feedFor = c.id; App.go('feed'); }
      });
    });
  };
  Views.now = Views.life;

  function lifeCard(c) {
    var L = VH.life(c);
    var st = L.summary, vh = c.vh, where = L.where;
    var last = L.bond.lastContact ? UI.fmtTime(L.bond.lastContact) : 'never';
    var ev = L.calendar.now || L.calendar.next;
    return '<div class="vh-card" data-vh="' + c.id + '">' +
      '<div class="vh-top">' +
        '<div class="vh-av">' + (c.avatar
          ? '<img src="' + esc(c.avatar) + '" alt="">'
          : '<div class="ph">' + esc(initials(c.name)) + '</div>') + '</div>' +
        '<div style="flex:1;min-width:0">' +
          '<div class="vh-name">' + esc(c.name) + '</div>' +
          '<div class="vh-status">' + esc(st.asleep ? 'Asleep' : (st.activity || 'Awake')) +
            (st.asleep ? ' · back around ' + esc(vh.sleep.end) : '') + '</div>' +
          '<div class="vh-when">' + esc(where.name) +
            (where.travelling ? ' · ' + where.minutesLeft + ' min away' : '') +
            ' · you last spoke ' + esc(last) + '</div>' +
        '</div>' +
      '</div>' +
      (ev ? '<div class="vh-note">' + icon('time') + ' <b>' + esc(ev.t) + '</b> ' + esc(ev.label) +
        (ev.placeId ? ' · ' + esc(VH.placeName(vh, ev.placeId)) : '') + '</div>' : '') +
      '<div class="meters">' +
        signedBar('Mood', st.moodLabel, st.mood) +
        signedBar('You two', L.bond.label + ' · ' + L.bond.persona, L.bond.affinity) +
        needBar('Energy', L.needs[0].label, L.needs[0].value) +
        needBar('Company', L.needs[2].label, L.needs[2].value) +
      '</div>' +
      '<div class="vh-note">Autonomous today: <b>' + L.spend.used + ' / ' + L.spend.cap + '</b>' +
        (L.spend.left ? '' : ' · budget spent, they will not message on their own until tomorrow') + '</div>' +
      (st.chronicle.length
        ? '<div class="chron">' + st.chronicle.slice(0, 3).map(function (b) {
            return '<div><b>' + esc(UI.fmtTime(b.ts)) + '</b> — ' + esc(b.text) + '</div>';
          }).join('') + '</div>'
        : '') +
      '<div class="vh-acts">' +
        '<button class="btn sm" data-a="chat">Open chat</button>' +
        '<button class="btn sm ghost" data-a="life">Their life</button>' +
        '<button class="btn sm ghost" data-a="feed">Feed</button>' +
        '<button class="btn sm ghost" data-a="nudge">Nudge</button>' +
      '</div>' +
    '</div>';
  }

  /* ---------------- the full life, in a sheet ---------------- */
  Views.lifeSheet = function (c) {
    var vh = VH.ensure(c), L = VH.life(c);
    var where = L.where;

    var people = L.people.length
      ? L.people.map(function (p) {
          return '<div class="person"><div class="person-av">' + esc((p.name || '?').slice(0, 1).toUpperCase()) + '</div>' +
            '<div style="flex:1;min-width:0"><div>' + esc(p.name) + '</div>' +
            '<div class="hint">' + esc(p.relation || 'person') + (p.note ? ' · ' + esc(p.note) : '') + '</div></div>' +
            '<span class="pill">' + esc(VH.relLabel((p.closeness || 0) * 2 - 1)) + '</span></div>';
        }).join('')
      : '<div class="hint">Nobody yet — add the people in their life from the character editor.</div>';

    var today = L.calendar.today.length
      ? L.calendar.today.map(function (e) {
          return '<div class="ev"><b>' + esc(e.t) + '</b> ' + esc(e.label) +
            (e.placeId ? ' · ' + esc(VH.placeName(vh, e.placeId)) : '') + '</div>';
        }).join('')
      : '<div class="hint">Nothing in the diary today.</div>';

    var perms = [
      ['message', 'Messages on their own'],
      ['photo', 'Photos on their own'],
      ['post', 'Posts to their feed'],
      ['travel', 'Going out and about']
    ].map(function (p) {
      return '<div class="field compact"><label>' + p[1] + '</label>' +
        '<div class="toggle' + (L.perms[p[0]] ? ' on' : '') + '" data-perm="' + p[0] + '"></div></div>';
    }).join('');

    return '' +
      '<div class="life-head">' +
        '<div class="life-where">' + esc(where.name) + '</div>' +
        '<div class="hint">' + esc(L.summary.activity || '') +
          (where.travelling ? ' · arriving in ' + where.minutesLeft + ' min' : '') + '</div>' +
      '</div>' +
      '<div class="group-title">Needs</div>' +
      '<div class="meters">' + L.needs.map(function (n) {
        return needBar(n.key[0].toUpperCase() + n.key.slice(1), n.label, n.value);
      }).join('') + '</div>' +
      '<div class="group-title">You two</div>' +
      '<div class="meters">' +
        signedBar('Relationship', L.bond.label, L.bond.affinity) +
        signedBar('Trust', L.bond.trust.toFixed(2), L.bond.trust) +
        signedBar('Tension', L.bond.tension.toFixed(2), L.bond.tension) +
      '</div>' +
      '<div class="hint">' + L.bond.exchanges + ' exchanges with ' + esc(L.bond.persona) + '.' +
        (L.personas.length > 1 ? ' They know ' + (L.personas.length - 1) + ' other persona(s) separately.' : '') + '</div>' +
      '<div class="group-title">People</div>' + people +
      '<div class="group-title">Today</div>' + today +
      '<div class="group-title">Autonomy</div>' + perms +
      '<div class="field"><div class="field-head"><label>Daily budget for autonomous messages</label>' +
        '<span class="spacer"></span><span class="val" id="cap-v">' + L.spend.cap + '</span></div>' +
        '<div class="range-row"><input type="range" id="vh-cap" min="0" max="40" step="1" value="' + L.spend.cap + '">' +
        '<span class="hint">' + L.spend.used + ' used today</span></div>' +
        '<div class="hint">Counts messages, photos and posts they send on their own. Your own replies and nudges are free.</div></div>' +
      '<div class="vh-acts">' +
        '<button class="btn sm ghost" data-l="export">Export life</button>' +
        '<button class="btn sm ghost" data-l="feed">Open feed</button>' +
      '</div>';
  };

  /* ================= FEED ================= */
  Views.feed = function (root) {
    var body = $('#feed-body');
    var vhs = Store.characters.filter(function (c) { return c.vh && c.vh.enabled; });
    var only = App.state.feedFor;
    if (only) vhs = vhs.filter(function (c) { return c.id === only; });

    var posts = [];
    vhs.forEach(function (c) {
      (c.vh.feed || []).forEach(function (p) { posts.push({ post: p, char: c }); });
    });
    posts.sort(function (a, b) { return (b.post.ts || 0) - (a.post.ts || 0); });

    if (!posts.length) {
      body.innerHTML = '<div class="empty"><div class="empty-art">' + icon('time') + '</div>' +
        '<h3>Nothing posted yet</h3><p>When a virtual human sends you a photo or says something on ' +
        'their own, it shows up here — a record of the life outside your chat.</p>' +
        '<button class="btn ghost" data-act="life">Back to Life</button></div>';
      on(body, '[data-act=life]', 'click', function () { App.state.feedFor = null; App.go('life'); });
      return;
    }

    body.innerHTML = (only
        ? '<button class="btn ghost block sm" data-act="all" style="margin:0 2px 10px">Everyone’s feed</button>'
        : '') +
      posts.map(function (e) {
        var p = e.post, c = e.char;
        return '<div class="post" data-c="' + c.id + '">' +
          '<div class="post-head">' +
            '<div class="post-av">' + (c.avatar ? '<img src="' + esc(c.avatar) + '" alt="">' : esc(initials(c.name))) + '</div>' +
            '<div style="flex:1;min-width:0"><b>' + esc(c.name) + '</b>' +
            '<div class="hint">' + esc(UI.fmtTime(p.ts)) +
              (p.placeId ? ' · ' + esc(VH.placeName(c.vh, p.placeId)) : '') +
              (p.autonomous ? ' · sent on their own' : '') + '</div></div>' +
          '</div>' +
          (p.image ? '<img class="post-img" src="' + esc(p.image) + '" alt="">' : '') +
          (p.text ? '<div class="post-text">' + esc(p.text) + '</div>' : '') +
        '</div>';
      }).join('');

    on(body, '[data-act=all]', 'click', function () { App.state.feedFor = null; Views.feed($('.screen')); });
  };

  /* ================= CHATS ================= */
  Views.chats = function (root) {
    var list = $('#chat-list'), empty = $('#chats-empty');
    Store.allSessions().then(function (sessions) {
      var chars = {};
      Store.characters.forEach(function (c) { chars[c.id] = c; });
      list.innerHTML = sessions.map(function (s) {
        var c = chars[s.charId] || { name: 'Deleted character' };
        return '<div class="item" data-open="' + s.id + '">' +
          '<div class="item-av">' + avatarHtml(c.avatar, c.name) + '</div>' +
          '<div class="item-main">' +
            '<div class="item-title">' + esc(c.name) + ' <span style="color:var(--dim);font-weight:400">· ' + esc(s.title || 'New chat') + '</span></div>' +
            '<div class="item-sub">' + esc(s.summary ? s.summary.slice(0, 90) : (s.messageCount || 0) + ' messages') + '</div>' +
          '</div>' +
          '<div class="item-side">' + esc(UI.fmtTime(s.updatedAt)) +
            '<button class="chip" style="margin-left:6px" data-menu="' + s.id + '">' +
              '<svg viewBox="0 0 24 24"><circle cx="12" cy="5" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="12" cy="19" r="1.6"/></svg>' +
            '</button>' +
          '</div>' +
        '</div>';
      }).join('');
      empty.hidden = sessions.length > 0;
      on(list, '[data-open]', 'click', function (e) {
        if (e.target.closest('[data-menu]')) return;
        App.openSession(e.currentTarget.getAttribute('data-open'));
      });
      on(list, '[data-menu]', 'click', function (e) {
        e.stopPropagation();
        App.sessionMenu(e.currentTarget.getAttribute('data-menu'));
      });
    });
  };

  /* ================= WORLD ================= */
  Views.world = function (root) {
    var body = $('#world-body');
    var chars = Store.characters;
    if (!chars.length) {
      body.innerHTML = '<div class="empty"><div class="empty-art">' + icon('brain') + '</div>' +
        '<h3>No world yet</h3><p>Create a character first — worlds and memories hang off them.</p></div>';
      return;
    }
    var id = App.state.worldChar || chars[0].id;
    var c = chars.find(function (x) { return x.id === id; }) || chars[0];
    App.state.worldChar = c.id;

    body.innerHTML =
      '<div class="tag-bar">' + chars.map(function (x) {
        return '<button class="tag' + (x.id === c.id ? ' on' : '') + '" data-wc="' + x.id + '">' + esc(x.name || 'Unnamed') + '</button>';
      }).join('') + '</div>' +

      '<div class="group"><div class="group-title">Lorebook · ' + esc(c.name) + '</div>' +
        '<div id="lore-list">' + (c.lorebook || []).map(function (e, i) {
          return '<div class="kv" data-lore="' + i + '" style="cursor:pointer">' +
            '<span style="flex:1">' +
              '<b style="display:block;color:' + (e.enabled === false ? 'var(--dim)' : 'var(--text)') + '">' +
                esc((e.keys || []).join(', ') || '(no keys)') + '</b>' +
              '<span style="font-size:12px">' + esc((e.content || '').slice(0, 70)) + '</span>' +
            '</span></div>';
        }).join('') + '</div>' +
        '<div class="field"><button class="btn ghost block sm" data-act="lore-add">' + icon('plus') + ' Add lore entry</button></div>' +
      '</div>' +

      '<div class="group"><div class="group-title">Story memory</div>' +
        '<div class="field"><div class="hint" style="margin:0">Memory is stored per conversation. It gets injected into ' +
        'the prompt so long chats stay coherent without sending the whole transcript.</div></div>' +
        '<div id="mem-list"><div class="field"><span class="hint">Loading…</span></div></div>' +
      '</div>';

    on(body, '[data-wc]', 'click', function (e) {
      App.state.worldChar = e.currentTarget.getAttribute('data-wc');
      Views.world(root);
    });
    on(body, '[data-act=lore-add]', 'click', function () { App.editLore(c, null); });
    on($('#lore-list'), '[data-lore]', 'click', function (e) {
      App.editLore(c, parseInt(e.currentTarget.getAttribute('data-lore'), 10));
    });

    Store.getSessions(c.id).then(function (sessions) {
      var el = $('#mem-list');
      if (!sessions.length) {
        el.innerHTML = '<div class="field"><span class="hint">No conversations with this character yet.</span></div>';
        return;
      }
      el.innerHTML = sessions.map(function (s) {
        return '<div class="kv" data-mem="' + s.id + '" style="cursor:pointer">' +
          '<span style="flex:1"><b style="display:block">' + esc(s.title || 'New chat') + '</b>' +
          '<span style="font-size:12px">' + esc(s.summary ? s.summary.slice(0, 80) : 'No summary yet') + '</span></span>' +
          '<span style="color:var(--dim);font-size:11px">' + (s.facts ? s.facts.length : 0) + ' facts</span>' +
        '</div>';
      }).join('');
      on(el, '[data-mem]', 'click', function (e) {
        App.memorySheet(e.currentTarget.getAttribute('data-mem'));
      });
    });
  };

  /* ================= SETTINGS ================= */
  Views.settings = function (root) {
    var s = Store.settings;
    var U = global.Updates;
    var upInfo = (U && U.supported()) ? U.info() : { apk: '?', apkCode: 0, overlay: false, rev: '' };
    var upUrl = U ? (U.baseUrl() || U.DEFAULT_URL || '') : '';
    var verLabel = (upInfo.apk && upInfo.apk !== '?') ? upInfo.apk : (Store.VERSION || 'unknown');
    if (upInfo.overlay && upInfo.rev) verLabel += ' · files ' + upInfo.rev;
    var upNote = '';
    try {
      var blocked = localStorage.getItem('hs.blockedRev');
      if (blocked) upNote += 'The last update was rolled back automatically because the app never started on it. ';
    } catch (e) { }
    if (!U || !U.supported()) {
      upNote += 'Self-updating needs the newest APK installed once — after that this screen does the rest.';
    } else {
      upNote += 'Nothing is downloaded unless you press Check for update.';
    }
    var preset = Store.PRESETS[s.provider] || Store.PRESETS.custom;

    /* ---- personas ---- */
    var personas = Store.personas || [];
    var activeId = s.activePersona || '';
    var personaRows = personas.length
      ? personas.map(function (p) {
          var on = activeId === p.id;
          return '<div class="field" data-prow="' + esc(p.id) + '">' +
            '<div class="field-head"><label>' + esc(p.name || 'Unnamed persona') + '</label>' +
              '<span class="spacer"></span>' +
              (on ? '<span class="pill ok">active</span>'
                  : '<button class="chip" data-persona-use="' + esc(p.id) + '">Switch to</button>') +
              '<button class="chip" data-persona-del="' + esc(p.id) + '" aria-label="Delete persona">' + icon('trash') + '</button>' +
            '</div>' +
            '<input type="text" data-persona-name="' + esc(p.id) + '" value="' + esc(p.name || '') + '" placeholder="Persona name">' +
            '<textarea data-persona-text="' + esc(p.id) + '" style="margin-top:6px" placeholder="Who this persona is — appearance, background, goals.">' + esc(p.text || '') + '</textarea>' +
          '</div>';
        }).join('')
      : '<div class="field"><span class="hint">No personas yet. Add one to switch between identities — each keeps its own chats with every character and its own relationship with each virtual human.</span></div>';

    $('#settings-body').innerHTML =
      /* --- connection --- */
      '<div class="group">' +
        '<div class="group-title">Connection</div>' +
        '<div class="field">' +
          '<div class="field-head"><label>Provider</label></div>' +
          '<select id="set-provider">' +
            Object.keys(Store.PRESETS).map(function (k) {
              return '<option value="' + k + '"' + (k === s.provider ? ' selected' : '') + '>' +
                esc(Store.PRESETS[k].label) + '</option>';
            }).join('') +
          '</select>' +
          '<div class="hint" id="preset-note">' + esc(preset.note) + '</div>' +
        '</div>' +
        '<div class="field" id="url-field"' + (s.provider === 'horde' ? ' hidden' : '') + '>' +
          '<div class="field-head"><label>API base URL</label></div>' +
          '<input type="url" id="set-url" value="' + esc(s.baseUrl) + '" placeholder="https://…/v1" autocapitalize="off" autocorrect="off" spellcheck="false">' +
        '</div>' +
        '<div class="field"' + (s.provider === 'horde' ? ' hidden' : '') + '>' +
          '<div class="field-head"><label>API key</label></div>' +
          '<input type="password" id="set-key" value="' + esc(s.apiKey) + '" placeholder="' +
            (preset.keyRequired ? 'sk-…' : 'leave blank if not needed') + '" autocapitalize="off" autocorrect="off" spellcheck="false">' +
          '<div class="hint">Stored only in this app’s private storage on your phone. Never included in exports.</div>' +
        '</div>' +
        '<div class="field">' +
          '<div class="field-head"><label>Model</label></div>' +
          '<div class="row">' +
            '<button class="btn ghost sm" id="btn-model" style="flex:1;text-align:left">' + esc(s.model || 'Tap to choose a model') + '</button>' +
            '<button class="btn ghost sm" id="btn-refresh-models" title="Refresh list">' + icon('refresh') + '</button>' +
          '</div>' +
        '</div>' +
        '<div class="field">' +
          '<div class="row">' +
            '<button class="btn ghost sm" style="flex:1" id="btn-test">' + icon('key') + ' Test connection</button>' +
          '</div>' +
          '<div class="hint" id="test-out"></div>' +
        '</div>' +
      '</div>' +

      /* --- generation --- */
      '<div class="group">' +
        '<div class="group-title">Generation</div>' +
        '<div class="field"><div class="field-head"><label>Temperature</label><span class="spacer"></span><span class="val" id="v-temp">' + s.temperature + '</span></div>' +
          '<div class="range-row"><input type="range" id="set-temp" min="0" max="2" step="0.05" value="' + s.temperature + '"></div></div>' +
        '<div class="field"><div class="field-head"><label>Max reply length</label><span class="spacer"></span><span class="val" id="v-max">' + s.maxTokens + '</span></div>' +
          '<div class="range-row"><input type="range" id="set-max" min="64" max="2048" step="32" value="' + s.maxTokens + '"><span class="hint">tokens</span></div></div>' +
        '<div class="field"><div class="field-head"><label>Top P</label><span class="spacer"></span><span class="val" id="v-topp">' + s.topP + '</span></div>' +
          '<div class="range-row"><input type="range" id="set-topp" min="0.1" max="1" step="0.05" value="' + s.topP + '"></div></div>' +
        '<div class="field"><div class="field-head"><label>Messages in context</label><span class="spacer"></span><span class="val" id="v-ctx">' + s.contextMessages + '</span></div>' +
          '<div class="range-row"><input type="range" id="set-ctx" min="6" max="120" step="2" value="' + s.contextMessages + '"></div>' +
          '<div class="hint">Higher = longer memory per request, but slower and more expensive.</div></div>' +
        '<div class="field compact"><label>Stream replies</label><div class="toggle' + (s.streaming ? ' on' : '') + '" id="t-stream"></div></div>' +
        '<div class="field compact"><label>Finish cut-off replies</label><div class="toggle' + (s.autoFinish ? ' on' : '') + '" id="t-finish"></div></div>' +
        '<div class="field"><div class="hint" style="margin:0">If a reply stops mid-sentence (common on the Horde, which ' +
          'cuts at its token limit), the app asks for the rest and stitches it together — up to 3 passes.</div></div>' +
        '<div class="field compact"><label>Strip the model\'s thinking</label><div class="toggle' + (s.stripThinking !== false ? ' on' : '') + '" id="t-think"></div></div>' +
        '<div class="field"><div class="hint" style="margin:0">Some models plan out loud before they answer. ' +
          'When that planning is recognisable it is removed, so you only see what the character says.</div></div>' +
        '<div class="field compact"><label>Split replies into separate texts</label><div class="toggle' + (s.bursts !== false ? ' on' : '') + '" id="t-bursts"></div></div>' +
        '<div class="field"><div class="hint" style="margin:0">For virtual humans: when a reply reads like several short ' +
          'messages rather than one paragraph, it arrives as separate bubbles a few seconds apart.</div></div>' +
        '<div class="field compact"><label>Enter sends message</label><div class="toggle' + (s.sendOnEnter ? ' on' : '') + '" id="t-enter"></div></div>' +
      '</div>' +

      /* --- you --- */
      '<div class="group">' +
        '<div class="group-title">You</div>' +
        '<div class="field"><div class="hint" style="margin:0 0 6px">' +
          (activeId
            ? 'Editing the <b>' + esc(Store.personaLabel()) + '</b> persona. These two fields always follow whichever identity is active.'
            : 'Your default identity — used whenever no persona is selected.') +
        '</div></div>' +
        '<div class="field"><div class="field-head"><label>Your name</label></div>' +
          '<input type="text" id="set-uname" value="' + esc(s.userName) + '"></div>' +
        '<div class="field"><div class="field-head"><label>Your persona</label></div>' +
          '<textarea id="set-upersona" placeholder="Who you are in the story — appearance, background, goals.">' + esc(s.userPersona) + '</textarea></div>' +
      '</div>' +

      /* --- personas --- */
      '<div class="group">' +
        '<div class="group-title">Personas</div>' +
        '<div class="field"><div class="hint" style="margin:0 0 8px">Switchable identities. Each persona keeps its own chats with every character, and builds its own separate relationship with each virtual human. Switching is also one tap away at the top of the Characters tab.</div></div>' +
        personaRows +
        '<button class="btn ghost sm" id="btn-persona-add" style="margin-top:8px">' + icon('plus') + ' Add persona</button>' +
      '</div>' +

      /* --- system prompt --- */
      '<div class="group">' +
        '<div class="group-title">System prompt</div>' +
        '<div class="field"><textarea class="tall" id="set-system">' + esc(s.systemPrompt) + '</textarea>' +
          '<div class="hint">Sent before the character sheet. Macros: {{char}}, {{user}}, {{persona}}.</div>' +
          '<button class="btn ghost sm" id="btn-reset-sys">Reset to default</button></div>' +
      '</div>' +

      /* --- horde --- */
      '<div class="group">' +
        '<div class="group-title">AI Horde · images &amp; free text</div>' +
        '<div class="field"><div class="field-head"><label>Horde API key (optional)</label></div>' +
          '<input type="password" id="set-hkey" value="' + esc(s.hordeKey) + '" placeholder="0000000000 = anonymous">' +
          '<div class="hint">Free account at aihorde.net — a key jumps the queue. Anonymous works too.</div></div>' +
        '<div class="field"><div class="field-head"><label>Image model</label></div>' +
          '<div class="row"><button class="btn ghost sm" id="btn-hmodel" style="flex:1;text-align:left">' + esc(s.hordeModel || 'Tap to choose') + '</button>' +
          '<button class="btn ghost sm" id="btn-refresh-hmodels">' + icon('refresh') + '</button></div></div>' +
        '<div class="field"><div class="field-head"><label>Image size</label><span class="spacer"></span><span class="val" id="v-size">' + s.hordeSize + 'px</span></div>' +
          '<div class="hint">Smaller = cheaper in kudos and much shorter queue time.</div>' +
          '<div class="seg" id="seg-size">' + [512, 640, 768, 1024].map(function (n) {
            return '<button data-size="' + n + '"' + (n === s.hordeSize ? ' class="on"' : '') + '>' + n + '</button>';
          }).join('') + '</div></div>' +
        '<div class="field"><div class="field-head"><label>Diffusion steps</label><span class="spacer"></span><span class="val" id="v-steps">' + s.hordeSteps + '</span></div>' +
          '<div class="range-row"><input type="range" id="set-steps" min="10" max="50" step="1" value="' + s.hordeSteps + '"></div></div>' +
        '<div class="field"><div class="field-head"><label>Give up after</label><span class="spacer"></span><span class="val" id="v-maxwait">' + Math.round(s.hordeMaxWait/60) + ' min</span></div>' +
          '<div class="range-row"><input type="range" id="set-maxwait" min="2" max="20" step="1" value="' + Math.round(s.hordeMaxWait/60) + '"><span class="hint">queue wait</span></div>' +
          '<div class="hint">The Horde is a queue, not an API — busy models can hold a job for minutes. ' +
          'Jobs show queue position and ETA live, and you can cancel at any time.</div></div>' +
        '<div class="field"><div class="field-head"><label>Horde text model</label></div>' +
          '<div class="row"><button class="btn ghost sm" id="btn-htext" style="flex:1;text-align:left">' + esc(Horde.modelLabel(s.hordeTextModel) || 'Any available (recommended)') + '</button>' +
          '<button class="btn ghost sm" id="btn-refresh-tmodels">' + icon('refresh') + '</button></div>' +
          '<div class="hint">Only used when the provider above is set to AI Horde.</div></div>' +
      '</div>' +

      /* --- memory --- */
      '<div class="group">' +
        '<div class="group-title">Memory</div>' +
        '<div class="field compact"><label>Auto-summarise long chats</label><div class="toggle' + (s.autoMemory ? ' on' : '') + '" id="t-mem"></div></div>' +
        '<div class="field"><div class="field-head"><label>Summarise every</label><span class="spacer"></span><span class="val" id="v-memevery">' + s.memoryEvery + '</span></div>' +
          '<div class="range-row"><input type="range" id="set-memevery" min="6" max="60" step="2" value="' + s.memoryEvery + '"><span class="hint">msgs</span></div></div>' +
      '</div>' +

      /* --- data --- */
      '<div class="group">' +
        '<div class="group-title">Data</div>' +
        '<div class="field"><div class="row">' +
          '<button class="btn ghost sm" style="flex:1" id="btn-export">' + icon('download') + ' Backup</button>' +
          '<button class="btn ghost sm" style="flex:1" id="btn-import">' + icon('upload') + ' Restore</button>' +
        '</div><div class="hint">Backup exports everything except your API keys.</div></div>' +
        '<div class="field"><button class="btn danger block sm" id="btn-wipe">' + icon('trash') + ' Erase all characters and chats</button></div>' +
      '</div>' +

      /* --- updates --- */
      '<div class="group">' +
        '<div class="group-title">App updates</div>' +
        '<div class="field"><div class="kv"><span>App</span><b>' + esc(upInfo.apk || '?') + '</b></div>' +
        '<div class="kv"><span>Files in use</span><b>' + (upInfo.overlay
            ? 'update ' + esc(upInfo.rev)
            : 'as shipped in the app') + '</b></div></div>' +
        '<div class="field"><div class="field-head"><label>Update address</label></div>' +
          '<input type="text" id="set-updurl" spellcheck="false" value="' + esc(upUrl) + '" placeholder="https://...">' +
          '<div class="hint">Where the app looks for new files. It only ever looks when you press the button below.</div></div>' +
        '<div class="field">' +
          '<button class="btn ghost sm" id="btn-upd-check">Check for update</button> ' +
          '<button class="btn ghost sm" id="btn-upd-file">Apply from a file</button> ' +
          '<button class="btn ghost sm" id="btn-upd-reset">Reset to shipped files</button>' +
          '<div class="hint" id="upd-status" style="margin-top:8px">' + upNote + '</div>' +
        '</div>' +
      '</div>' +

      '<div class="group">' +
        '<div class="group-title">About</div>' +
        '<div class="field"><div class="kv"><span>Version</span><b>' + esc(verLabel) + ' · mobile</b></div>' +
        '<div class="kv"><span>Text</span><b>' + esc(s.provider === 'horde' ? 'AI Horde (free)' : (Store.PRESETS[s.provider] || {}).label || 'Custom') + '</b></div>' +
        '<div class="kv"><span>Images</span><b>AI Horde</b></div>' +
        '<div class="hint">Horde Studio Mobile is an unofficial, mobile-first client. It talks to whatever backend you configure — ' +
        'nothing is sent anywhere except your chosen provider.</div></div>' +
      '</div>';

    /* ---- wiring ---- */
    var body = $('#settings-body');
    function bind(sel, ev, fn) { var el = $(sel, body); if (el) el.addEventListener(ev, fn); }
    function set(patch) { Store.saveSettings(patch); }

    bind('#set-provider', 'change', function (e) {
      var p = e.target.value;
      set({ provider: p, baseUrl: Store.PRESETS[p].url });
      Views.settings(root);
    });
    bind('#set-url', 'change', function (e) { set({ baseUrl: e.target.value.trim() }); });
    bind('#set-key', 'change', function (e) { set({ apiKey: e.target.value.trim() }); });
    /* Identity edits land on the persona when one is active, else on the default. */
    bind('#set-uname', 'change', function (e) {
      Store.setIdentity({ name: e.target.value.trim() || 'You' }).then(function () { Views.settings(root); });
    });
    bind('#set-upersona', 'change', function (e) { Store.setIdentity({ text: e.target.value }); });

    /* ---- personas ---- */
    on(body, '[data-persona-use]', 'click', function (e) {
      App.switchTo(e.currentTarget.getAttribute('data-persona-use'));
    });
    on(body, '[data-persona-del]', 'click', function (e) {
      App.deletePersona(e.currentTarget.getAttribute('data-persona-del'));
    });
    on(body, '[data-persona-name]', 'change', function (e) {
      App.editPersona(e.currentTarget.getAttribute('data-persona-name'), { name: e.target.value.trim() });
    });
    on(body, '[data-persona-text]', 'change', function (e) {
      App.editPersona(e.currentTarget.getAttribute('data-persona-text'), { text: e.target.value });
    });
    bind('#btn-persona-add', 'click', function () { App.newPersona(); });
    bind('#set-system', 'change', function (e) { set({ systemPrompt: e.target.value }); });
    bind('#set-hkey', 'change', function (e) { set({ hordeKey: e.target.value.trim() }); });

    function range(sel, valSel, key, fmt) {
      var el = $(sel, body);
      el.addEventListener('input', function () {
        var v = parseFloat(el.value);
        if (valSel) $(valSel, body).textContent = fmt ? fmt(v) : v;
        var patch = {}; patch[key] = v; set(patch);
      });
    }
    range('#set-temp', '#v-temp', 'temperature', function (v) { return v.toFixed(2); });
    range('#set-max', '#v-max', 'maxTokens');
    range('#set-topp', '#v-topp', 'topP', function (v) { return v.toFixed(2); });
    range('#set-ctx', '#v-ctx', 'contextMessages');
    range('#set-steps', '#v-steps', 'hordeSteps');
    range('#set-memevery', '#v-memevery', 'memoryEvery');
    var mw = $('#set-maxwait', body);
    if (mw) mw.addEventListener('input', function () {
      var mins = parseInt(mw.value, 10);
      $('#v-maxwait', body).textContent = mins + ' min';
      set({ hordeMaxWait: mins * 60 });
    });

    function toggle(sel, key, after) {
      $(sel, body).addEventListener('click', function () {
        var patch = {}; patch[key] = !Store.settings[key]; set(patch);
        this.classList.toggle('on', Store.settings[key]);
        if (after) after();
      });
    }
    toggle('#t-stream', 'streaming');
    toggle('#t-finish', 'autoFinish');
    toggle('#t-bursts', 'bursts');
    toggle('#t-think', 'stripThinking');
    toggle('#t-enter', 'sendOnEnter');
    toggle('#t-mem', 'autoMemory');

    bind('#seg-size', 'click', function (e) {
      var b = e.target.closest('button'); if (!b) return;
      set({ hordeSize: parseInt(b.getAttribute('data-size'), 10) });
      body.querySelectorAll('#seg-size button').forEach(function (x) { x.classList.remove('on'); });
      b.classList.add('on');
      $('#v-size', body).textContent = Store.settings.hordeSize + 'px';
    });

    /* ---- updates ---- */
    var upStatus = $('#upd-status', body);
    function upSay(html) { if (upStatus) upStatus.innerHTML = html; }
    function upBar(pct, label) {
      upSay('<div class="upd-bar"><span style="width:' + Math.max(2, Math.min(100, pct || 0)) + '%"></span></div>' +
        '<div style="margin-top:4px">' + esc(label || 'Downloading') + ' ' + (pct || 0) + '%</div>');
    }

    bind('#set-updurl', 'change', function (e) {
      if (!U) return;
      U.saveUrl(e.target.value).then(function () { UI.toast('Update address saved'); });
    });

    bind('#btn-upd-check', 'click', function () {
      if (!U || !U.supported()) { upSay('Self-updating needs the newest APK installed once.'); return; }
      var btn = this;
      btn.disabled = true;
      upSay('Checking…');
      U.check().then(function (r) {
        btn.disabled = false;
        if (r.upToDate) {
          upSay('Up to date — app ' + esc(r.local.apk) + ', files ' +
            (r.local.overlay ? 'update ' + esc(r.local.rev) : 'as shipped') + '.');
          return;
        }
        var html = '';
        if (r.newWeb) html += '<p>Fixes are ready to apply <b>without reinstalling anything</b>.</p>';
        if (r.newApk) html += '<p>A new app version <b>' + esc(r.remote.apk || '') + '</b> is available. ' +
          'It downloads the APK and opens the Android install screen.</p>';
        if (r.remote.note) html += '<p>' + esc(r.remote.note) + '</p>';
        html += '<div class="row-gap" style="margin-top:8px">' +
          (r.newWeb ? '<button class="btn sm" id="btn-upd-apply">Apply now</button> ' : '') +
          (r.newApk ? '<button class="btn sm" id="btn-upd-install">Install app update</button> ' +
            '<button class="btn ghost sm" id="btn-upd-browser">Or in browser</button>' : '') +
          '</div>';
        upSay(html);

        var applyBtn = $('#btn-upd-apply', body);
        if (applyBtn) applyBtn.addEventListener('click', function () {
          applyBtn.disabled = true;
          upSay('Downloading the new files…');
          U.applyWeb(r.remote.webRev, function (p) { upBar(p, 'Downloading'); }).then(function () {
            upSay('Applied — reloading…');
            setTimeout(function () { U.reloadFresh(); }, 500);
          }).catch(function (e2) {
            applyBtn.disabled = false;
            upSay('Could not apply the update: ' + esc(e2.message || String(e2)));
          });
        });

        var instBtn = $('#btn-upd-install', body);
        if (instBtn) instBtn.addEventListener('click', function () {
          try { U.installApk(); upSay('Downloading — Android will ask you to confirm the install.'); }
          catch (e3) { upSay('Could not start the install: ' + esc(e3.message || String(e3))); }
        });
        var browBtn = $('#btn-upd-browser', body);
        if (browBtn) browBtn.addEventListener('click', function () {
          try { U.openDownload(); upSay('Opened in your browser — download and install there.'); }
          catch (e4) { upSay('Could not open the browser: ' + esc(e4.message || String(e4))); }
        });
      }).catch(function (e) {
        btn.disabled = false;
        var msg = e.message || String(e);
        if (/answered (502|503|504)/.test(msg)) {
          msg += ' That address belongs to a workspace that is no longer running. Either ' +
            'paste the current address into Update address above, or use ' +
            'Apply from a file — download the bundle in your browser and pick it here.';
        } else if (/answered (401|403)|refused the request/.test(msg)) {
          msg += ' Apply from a file works without the network: download the bundle in ' +
            'your browser, then pick it here.';
        }
        upSay('Could not check: ' + esc(msg));
      });
    });

    bind('#btn-upd-file', 'click', function () {
      if (!U || !U.supported()) { upSay('Self-updating needs the newest APK installed once.'); return; }
      upSay('Choose the update file you downloaded…');
      U.applyFile(function (p) { upBar(p, 'Applying'); }).then(function (rev) {
        upSay('Applied revision ' + esc(String(rev)) + ' — reloading…');
        setTimeout(function () { U.reloadFresh(); }, 600);
      }).catch(function (e2) {
        var m = (e2 && e2.message) || String(e2);
        upSay(/No file chosen/i.test(m) ? 'No file chosen — nothing changed.'
          : 'Could not apply that file: ' + esc(m));
      });
    });

    bind('#btn-upd-reset', 'click', function () {
      if (!U || !U.supported()) return;
      UI.confirm('Go back to the shipped files?', 'The update is removed and the app restarts on the copy that came with the APK. Your chats and characters are untouched.',
        { okLabel: 'Reset' }).then(function (ok) {
          if (!ok) return;
          U.reset();
          U.reloadFresh();
        });
    });

    bind('#btn-reset-sys', 'click', function () {
      set({ systemPrompt: 'You are {{char}}. Stay in character at all times. Write in a natural, immersive style, ' +
        'advancing the scene with concrete detail, action and dialogue. Never speak for {{user}}. ' +
        'Keep replies focused on what just happened and leave room for {{user}} to respond.' });
      Views.settings(root);
      UI.toast('System prompt reset');
    });

    bind('#btn-test', 'click', function () {
      var out = $('#test-out', body);
      out.innerHTML = '<span class="pill">Testing…</span>';
      API.testConnection(Store.settings).then(function (r) {
        out.innerHTML = '<span class="pill ' + (r.ok ? 'ok' : 'err') + '">' + esc(r.message) + '</span>';
      });
    });

    bind('#btn-refresh-models', 'click', function () { App.chooseModel(true); });
    bind('#btn-model', 'click', function () { App.chooseModel(false); });
    bind('#btn-refresh-hmodels', 'click', function () { App.chooseHordeModel('image', true); });
    bind('#btn-hmodel', 'click', function () { App.chooseHordeModel('image', false); });
    bind('#btn-refresh-tmodels', 'click', function () { App.chooseHordeModel('text', true); });
    bind('#btn-htext', 'click', function () { App.chooseHordeModel('text', false); });

    bind('#btn-export', 'click', function () {
      Store.exportAll().then(function (json) {
        UI.download('horde-studio-backup-' + new Date().toISOString().slice(0, 10) + '.json', json);
        UI.toast('Backup downloaded');
      });
    });
    bind('#btn-import', 'click', function () {
      pickFile('.json,application/json').then(function (f) {
        if (!f) return;
        var fr = new FileReader();
        fr.onload = function () {
          Promise.resolve()
            .then(function () { return Store.importAll(fr.result); })
            .then(function (r) {
              return Store.refreshCharacters().then(function () {
                UI.toast('Restored ' + r.characters + ' characters, ' + r.sessions + ' chats');
                Views.settings(root);
              });
            })
            .catch(function (e) { UI.toast('Restore failed: ' + e.message, 4000); });
        };
        fr.readAsText(f);
      });
    });
    bind('#btn-wipe', 'click', function () {
      UI.confirm('Erase everything?', 'All characters, chats and memories on this device will be deleted. This cannot be undone.',
        { danger: true, okLabel: 'Erase' }).then(function (ok) {
        if (!ok) return;
        Store.wipe().then(function () { return Store.refreshCharacters(); }).then(function () {
          UI.toast('Everything erased');
          App.go('characters');
        });
      });
    });
  };

  /* ================= EDITOR ================= */
  Views.editor = function (root, char) {
    var isNew = !char.id || !Store.characters.some(function (c) { return c.id === char.id; });
    VH.ensure(char);
    var vh = char.vh;
    var vh_enabled = !!vh.enabled;
    function slider(id, label, val) {
      var pct = Math.round((Math.max(-1, Math.min(1, val || 0)) + 1) / 2 * 100);
      return '<div style="margin-bottom:8px"><div style="display:flex;justify-content:space-between;font-size:12px;color:var(--muted)">' +
        '<span>' + esc(label) + '</span><span id="' + id + '-v">' + (val || 0).toFixed(2) + '</span></div>' +
        '<input type="range" id="' + id + '" min="-100" max="100" step="5" value="' + Math.round((val || 0) * 100) + '" style="width:100%"></div>';
    }
    $('#editor-body').innerHTML =
      '<div class="group">' +
        '<div class="field"><div class="avatar-edit" id="av-wrap">' +
          (char.avatar ? '<img src="' + esc(char.avatar) + '" alt="">' : '<div class="ph">' + icon('user') + '</div>') +
          '<div style="flex:1">' +
            '<button class="btn ghost sm block" data-act="av-url">Use image URL</button>' +
            '<button class="btn ghost sm block" style="margin-top:6px" data-act="av-file">Upload from phone</button>' +
            '<button class="btn ghost sm block" style="margin-top:6px" data-act="av-gen">Generate with AI Horde</button>' +
          '</div>' +
        '</div></div>' +
      '</div>' +

      '<div class="group">' +
        '<div class="group-title">Identity</div>' +
        '<div class="field"><div class="field-head"><label>Name</label></div>' +
          '<input type="text" id="e-name" value="' + esc(char.name) + '" placeholder="e.g. Seraphine Vale"></div>' +
        '<div class="field"><div class="field-head"><label>Tagline</label></div>' +
          '<input type="text" id="e-tagline" value="' + esc(char.tagline) + '" placeholder="Short hook shown on the card"></div>' +
        '<div class="field"><div class="field-head"><label>Tags</label></div>' +
          '<input type="text" id="e-tags" value="' + esc((char.tags || []).join(', ')) + '" placeholder="fantasy, mentor, slow-burn"></div>' +
      '</div>' +

      '<div class="group">' +
        '<div class="group-title">Character sheet</div>' +
        '<div class="field"><div class="field-head"><label>Persona</label>' +
          '<span class="spacer"></span><button class="chip" data-act="ai-persona">' + icon('sparkle') + ' AI draft</button></div>' +
          '<textarea class="tall" id="e-persona" placeholder="Appearance, personality, history, wants, voice…">' + esc(char.persona) + '</textarea></div>' +
        '<div class="field"><div class="field-head"><label>Scenario</label></div>' +
          '<textarea id="e-scenario" placeholder="Where the story starts.">' + esc(char.scenario) + '</textarea></div>' +
        '<div class="field"><div class="field-head"><label>Greeting (first message)</label></div>' +
          '<textarea id="e-greeting" placeholder="The opening line {{char}} sends.">' + esc(char.greeting) + '</textarea></div>' +
        '<div class="field"><div class="field-head"><label>Example dialogue</label></div>' +
          '<textarea class="tall" id="e-examples" placeholder="{{user}}: …&#10;{{char}}: …">' + esc(char.examples) + '</textarea>' +
          '<div class="hint">Alternating {{user}}: / {{char}}: lines. Optional, but it nails the voice.</div></div>' +
        '<div class="field"><div class="field-head"><label>Always-remember note</label></div>' +
          '<textarea id="e-post" placeholder="Appended last, right before the reply is generated.">' + esc(char.postHistory) + '</textarea></div>' +
      '</div>' +

      '<div class="group">' +
        '<div class="group-title">Virtual human</div>' +
        '<div class="field compact"><label>Give them their own life</label>' +
          '<div class="toggle' + (vh_enabled ? ' on' : '') + '" id="vh-on"></div></div>' +
        '<div id="vh-fields"' + (vh_enabled ? '' : ' hidden') + '>' +
          '<div class="field"><div class="field-head"><label>Reaches out to you</label></div>' +
            '<div class="seg" id="vh-auto">' + ['off', 'low', 'medium', 'high'].map(function (k) {
              return '<button data-a="' + k + '"' + (vh.autonomy === k ? ' class="on"' : '') + '>' +
                ({ off: 'Never', low: 'Rarely', medium: 'Sometimes', high: 'Often' })[k] + '</button>';
            }).join('') + '</div>' +
            '<div class="hint">Never = they only answer you. Often = they message on their own every couple of hours.</div></div>' +
          '<div class="field"><div class="field-head"><label>Asleep</label></div>' +
            '<div class="row"><input type="time" id="vh-sleep-start" value="' + esc(vh.sleep.start) + '" style="flex:1">' +
            '<input type="time" id="vh-sleep-end" value="' + esc(vh.sleep.end) + '" style="flex:1"></div>' +
            '<div class="hint">While asleep they do not answer — the message waits until they wake.</div></div>' +
          '<div class="field"><div class="field-head"><label>Takes this long to reply</label>' +
            '<span class="spacer"></span><span class="val" id="vh-dmin-v">' + vh.replyDelay.min + 's – ' + vh.replyDelay.max + 's</span></div>' +
            '<div class="range-row"><span class="hint">min</span><input type="range" id="vh-dmin" min="0" max="180" step="5" value="' + vh.replyDelay.min + '"></div>' +
            '<div class="range-row"><span class="hint">max</span><input type="range" id="vh-dmax" min="15" max="900" step="15" value="' + vh.replyDelay.max + '"></div></div>' +
          '<div class="field compact"><label>Sends photos</label><div class="toggle' + (vh.photos ? ' on' : '') + '" id="vh-photos"></div></div>' +
          '<div class="field"><div class="field-head"><label>Daily routine</label></div>' +
            '<div id="vh-routine"></div>' +
            '<button class="btn ghost sm block" id="vh-add" style="margin-top:8px">' + icon('plus') + ' Add time of day</button>' +
            '<div class="hint">What they are doing, from that hour onward. Drives their status and what they talk about.</div></div>' +
          '<div class="field"><div class="field-head"><label>Inner state</label></div>' +
            slider('vh-mood', 'Mood', vh.mood) +
            slider('vh-aff', 'Affinity', vh.affinity) +
            slider('vh-trust', 'Trust', vh.trust) +
            slider('vh-ten', 'Tension', vh.tension) +
            '<div class="hint">Drifts on its own as time passes and as you talk. Drag to steer the relationship.</div></div>' +
          '<div class="field"><div class="field-head"><label>Places in their life</label></div>' +
            '<div id="vh-places"></div>' +
            '<button class="btn ghost sm block" id="vh-add-place" style="margin-top:8px">' + icon('plus') + ' Add a place</button>' +
            '<div class="hint">Where their day happens. They travel between these in real time, and being somewhere else is why they took so long to answer.</div>' +
            '<div id="vh-world"></div>' +
            '<button class="btn ghost sm block" id="vh-world-pack" style="margin-top:8px">' + icon('download') + ' Load a world pack</button></div>' +
          '<div class="field"><div class="field-head"><label>People in their life</label></div>' +
            '<div id="vh-people"></div>' +
            '<button class="btn ghost sm block" id="vh-add-person" style="margin-top:8px">' + icon('plus') + ' Add a person</button>' +
            '<div class="hint">The supporting cast — colleagues, neighbours, family. They come up in conversation and give them something to talk about besides you.</div></div>' +
          '<div class="field"><div class="field-head"><label>Standing diary</label></div>' +
            '<div id="vh-cal"></div>' +
            '<button class="btn ghost sm block" id="vh-add-cal" style="margin-top:8px">' + icon('plus') + ' Add to the diary</button>' +
            '<div class="hint">Repeating commitments: a shift, a class, a standing dinner. They head off to these.</div></div>' +
          '<div class="field"><div class="field-head"><label>Texts in one go</label>' +
            '<span class="spacer"></span><span class="val" id="vh-burst-v">' + (vh.burst || 3) + '</span></div>' +
            '<div class="range-row"><input type="range" id="vh-burst" min="1" max="4" step="1" value="' + (vh.burst || 3) + '"></div>' +
            '<div class="hint">Most separate bubbles they may send in one reply, when what they wrote reads as several short texts rather than one paragraph.</div></div>' +
        '</div>' +
      '</div>' +

      '<div class="group">' +
        '<div class="group-title">Overrides (optional)</div>' +
        '<div class="field"><div class="field-head"><label>System prompt override</label></div>' +
          '<textarea id="e-sys" placeholder="Blank = use the global system prompt.">' + esc(char.systemPrompt) + '</textarea></div>' +
        '<div class="field"><div class="field-head"><label>Temperature</label><span class="spacer"></span><span class="val" id="v-ctemp">' +
            (char.temperature === null || char.temperature === undefined ? 'global' : char.temperature) + '</span></div>' +
          '<div class="range-row"><input type="range" id="e-temp" min="0" max="2" step="0.05" value="' +
            (char.temperature === null || char.temperature === undefined ? 0.85 : char.temperature) + '">' +
            '<button class="chip" id="e-temp-clear">global</button></div></div>' +
      '</div>' +

      '<div class="group">' +
        '<div class="field"><div class="row">' +
          '<button class="btn primary" style="flex:1" data-act="save">' + icon('edit') + ' Save character</button>' +
          (isNew ? '' : '<button class="btn danger" data-act="delete">' + icon('trash') + '</button>') +
        '</div></div>' +
      '</div>';

    var body = $('#editor-body');
    var draft = Object.assign({}, char);

    function collect() {
      draft.name = $('#e-name', body).value.trim();
      draft.tagline = $('#e-tagline', body).value.trim();
      draft.tags = $('#e-tags', body).value.split(',').map(function (t) { return t.trim(); }).filter(Boolean);
      draft.persona = $('#e-persona', body).value;
      draft.scenario = $('#e-scenario', body).value;
      draft.greeting = $('#e-greeting', body).value;
      draft.examples = $('#e-examples', body).value;
      draft.postHistory = $('#e-post', body).value;
      draft.systemPrompt = $('#e-sys', body).value;
      return draft;
    }

    on(body, '[data-act=av-url]', 'click', function () {
      UI.input('Avatar image URL').then(function (url) {
        if (!url) return;
        draft.avatar = url.trim();
        $('#av-wrap', body).querySelector('img,.ph').outerHTML = '<img src="' + esc(draft.avatar) + '" alt="">';
      });
    });
    on(body, '[data-act=av-file]', 'click', function () {
      pickFile('image/*').then(function (f) {
        if (!f) return;
        fileToDataUrl(f).then(function (d) {
          draft.avatar = d;
          var w = $('#av-wrap', body).querySelector('img,.ph');
          w.outerHTML = '<img src="' + esc(d) + '" alt="">';
        });
      });
    });
    on(body, '[data-act=av-gen]', 'click', function () {
      App.generateAvatar(draft).then(function (url) {
        if (!url) return;
        draft.avatar = url;
        var w = $('#av-wrap', body).querySelector('img,.ph');
        w.outerHTML = '<img src="' + esc(url) + '" alt="">';
      });
    });
    on(body, '[data-act=ai-persona]', 'click', function () {
      var name = $('#e-name', body).value.trim();
      if (!name) { UI.toast('Add a name first'); return; }
      UI.toast('Asking the model…');
      /* 18.1.0: a drafted persona keeps the direction the player gave instead
         of being normalised into an agreeable template. One bounded request,
         one field — the draft fills the persona box and nothing else. */
      API.quickText(Store.settings,
        'Write a roleplay character persona for a character named ' + name +
        (draft.tagline
          ? ' — their direction is "' + draft.tagline + '". Follow it exactly: if it describes an unsettling, obsessive, antagonistic, eccentric or solitary person, write that person, not a likable version of them. '
          : '. ') +
        'Use third person, under 200 words. Cover: appearance, personality (strengths and flaws as they actually are), wants, and how they speak. No headings.',
        320).then(function (txt) {
          $('#e-persona', body).value = txt.trim();
          UI.toast('Draft inserted — edit as you like');
        }).catch(function (e) { UI.toast('Draft failed: ' + e.message, 4000); });
    });
    $('#e-temp', body).addEventListener('input', function () {
      draft.temperature = parseFloat(this.value);
      $('#v-ctemp', body).textContent = draft.temperature.toFixed(2);
    });
    $('#e-temp-clear', body).addEventListener('click', function () {
      draft.temperature = null;
      $('#v-ctemp', body).textContent = 'global';
    });
    /* ---- virtual human block ---- */
    function renderRoutine() {
      var box = $('#vh-routine', body);
      if (!box) return;
      box.innerHTML = (vh.routine || []).map(function (r, i) {
        return '<div class="row" style="margin-bottom:6px" data-r="' + i + '">' +
          '<input type="time" value="' + esc(r.t) + '" style="width:104px;flex:0 0 auto" data-rt="' + i + '">' +
          '<input type="text" value="' + esc(r.a) + '" placeholder="what they are doing" style="flex:1" data-ra="' + i + '">' +
          '<button class="chip" data-rdel="' + i + '">' + icon('trash') + '</button></div>';
      }).join('');
      box.querySelectorAll('[data-rt]').forEach(function (el) {
        el.onchange = function () { vh.routine[+el.getAttribute('data-rt')].t = el.value; };
      });
      box.querySelectorAll('[data-ra]').forEach(function (el) {
        el.oninput = function () { vh.routine[+el.getAttribute('data-ra')].a = el.value; };
      });
      box.querySelectorAll('[data-rdel]').forEach(function (el) {
        el.onclick = function () { vh.routine.splice(+el.getAttribute('data-rdel'), 1); renderRoutine(); };
      });
    }
    renderRoutine();

    var KINDS = ['home', 'work', 'cafe', 'shop', 'outdoor', 'other'];
    var DAYS = ['Every day', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

    function placeOptions(sel) {
      return (vh.places || []).map(function (p) {
        return '<option value="' + esc(p.id) + '"' + (sel === p.id ? ' selected' : '') + '>' + esc(p.name) + '</option>';
      }).join('');
    }

    function renderPlaces() {
      var box = $('#vh-places', body);
      if (!box) return;
      box.innerHTML = (vh.places || []).map(function (p, i) {
        return '<div class="row" style="margin-bottom:6px" data-p="' + i + '">' +
          '<input type="text" value="' + esc(p.name) + '" placeholder="name" style="flex:1" data-pn="' + i + '">' +
          '<select data-pk="' + i + '" style="width:104px;flex:0 0 auto">' +
            KINDS.map(function (k) {
              return '<option value="' + k + '"' + (p.kind === k ? ' selected' : '') + '>' + k + '</option>';
            }).join('') +
          '</select>' +
          '<button class="chip" data-pdel="' + i + '">' + icon('trash') + '</button></div>' +
          '<input type="text" value="' + esc(p.note || '') + '" placeholder="what it is like there (optional)" ' +
            'style="width:100%;margin:-2px 0 8px" data-pnote="' + i + '">';
      }).join('') +
      '<div class="row"><span class="hint" style="flex:0 0 auto;margin-right:6px">Currently at</span>' +
      '<select id="vh-at" style="flex:1">' + placeOptions(vh.place) + '</select></div>';

      box.querySelectorAll('[data-pn]').forEach(function (el) {
        el.oninput = function () { vh.places[+el.getAttribute('data-pn')].name = el.value; };
      });
      box.querySelectorAll('[data-pk]').forEach(function (el) {
        el.onchange = function () { vh.places[+el.getAttribute('data-pk')].kind = el.value; };
      });
      box.querySelectorAll('[data-pnote]').forEach(function (el) {
        el.oninput = function () { vh.places[+el.getAttribute('data-pnote')].note = el.value; };
      });
      box.querySelectorAll('[data-pdel]').forEach(function (el) {
        el.onclick = function () {
          var list = vh.places || [];
          if (list.length <= 1) return UI.toast('They need at least one place');
          var i = +el.getAttribute('data-pdel');
          var gone = list[i];
          /* 18.1.0: removing a place that life still references says so,
             instead of the references quietly dangling. */
          var notes = [];
          if (vh.travel && (vh.travel.to === gone.id || vh.travel.from === gone.id)) {
            vh.travel = null;
            notes.push('trip to ' + gone.name + ' cancelled');
          }
          var moved = (vh.calendar || []).filter(function (e) { return e.placeId === gone.id; }).length;
          list.splice(i, 1);
          if (vh.place === gone.id) { vh.place = list[0].id; notes.push('now placed at ' + list[0].name); }
          (vh.calendar || []).forEach(function (e) { if (e.placeId === gone.id) e.placeId = null; });
          if (moved) notes.push(moved + ' diary event' + (moved > 1 ? 's' : '') + ' have no location');
          renderPlaces(); renderCal();
          if (notes.length) UI.toast(notes.join(' · '), 4000);
        };
      });
      var at = $('#vh-at', box);
      if (at) at.onchange = function () { vh.place = at.value; };
    }

    function renderPeople() {
      var box = $('#vh-people', body);
      if (!box) return;
      if (!(vh.people || []).length) {
        box.innerHTML = '<div class="hint">Nobody yet.</div>';
        return;
      }
      box.innerHTML = vh.people.map(function (p, i) {
        return '<div style="margin-bottom:10px" data-pe="' + i + '">' +
          '<div class="row" style="margin-bottom:6px">' +
            '<input type="text" value="' + esc(p.name) + '" placeholder="name" style="flex:1" data-pen="' + i + '">' +
            '<input type="text" value="' + esc(p.relation || '') + '" placeholder="relation" style="flex:1" data-per="' + i + '">' +
            '<button class="chip" data-pedel="' + i + '">' + icon('trash') + '</button></div>' +
          '<div class="row"><span class="hint" style="flex:0 0 auto;margin-right:6px">closeness</span>' +
            '<input type="range" min="0" max="100" value="' + Math.round((p.closeness === undefined ? 0.5 : p.closeness) * 100) + '" data-pec="' + i + '" style="flex:1"></div>' +
          '<input type="text" value="' + esc(p.note || '') + '" placeholder="a note about them (optional)" style="width:100%;margin-top:6px" data-penote="' + i + '">' +
        '</div>';
      }).join('');
      box.querySelectorAll('[data-pen]').forEach(function (el) {
        el.oninput = function () { vh.people[+el.getAttribute('data-pen')].name = el.value; };
      });
      box.querySelectorAll('[data-per]').forEach(function (el) {
        el.oninput = function () { vh.people[+el.getAttribute('data-per')].relation = el.value; };
      });
      box.querySelectorAll('[data-pec]').forEach(function (el) {
        el.oninput = function () { vh.people[+el.getAttribute('data-pec')].closeness = parseInt(el.value, 10) / 100; };
      });
      box.querySelectorAll('[data-penote]').forEach(function (el) {
        el.oninput = function () { vh.people[+el.getAttribute('data-penote')].note = el.value; };
      });
      box.querySelectorAll('[data-pedel]').forEach(function (el) {
        el.onclick = function () { vh.people.splice(+el.getAttribute('data-pedel'), 1); renderPeople(); };
      });
    }

    function renderCal() {
      var box = $('#vh-cal', body);
      if (!box) return;
      if (!(vh.calendar || []).length) {
        box.innerHTML = '<div class="hint">Nothing recurring.</div>';
        return;
      }
      box.innerHTML = vh.calendar.map(function (e, i) {
        return '<div class="row" style="margin-bottom:6px" data-c="' + i + '">' +
          '<input type="time" value="' + esc(e.t || '09:00') + '" style="width:96px;flex:0 0 auto" data-ct="' + i + '">' +
          '<input type="text" value="' + esc(e.label || '') + '" placeholder="what it is" style="flex:1" data-cl="' + i + '">' +
          '<select data-cd="' + i + '" style="width:104px;flex:0 0 auto">' +
            DAYS.map(function (d, di) {
              var val = di === 0 ? '' : String(di - 1);
              var cur = (e.day === null || e.day === undefined) ? '' : String(e.day);
              return '<option value="' + val + '"' + (cur === val ? ' selected' : '') + '>' + d + '</option>';
            }).join('') +
          '</select>' +
          '<select data-cp="' + i + '" style="width:96px;flex:0 0 auto">' +
            '<option value="">—</option>' + placeOptions(e.placeId) +
          '</select>' +
          '<button class="chip" data-cdel="' + i + '">' + icon('trash') + '</button></div>';
      }).join('');
      box.querySelectorAll('[data-ct]').forEach(function (el) {
        el.onchange = function () { vh.calendar[+el.getAttribute('data-ct')].t = el.value; };
      });
      box.querySelectorAll('[data-cl]').forEach(function (el) {
        el.oninput = function () { vh.calendar[+el.getAttribute('data-cl')].label = el.value; };
      });
      box.querySelectorAll('[data-cd]').forEach(function (el) {
        el.onchange = function () {
          var v = el.value;
          vh.calendar[+el.getAttribute('data-cd')].day = v === '' ? null : parseInt(v, 10);
        };
      });
      box.querySelectorAll('[data-cp]').forEach(function (el) {
        el.onchange = function () { vh.calendar[+el.getAttribute('data-cp')].placeId = el.value || null; };
      });
      box.querySelectorAll('[data-cdel]').forEach(function (el) {
        el.onclick = function () { vh.calendar.splice(+el.getAttribute('data-cdel'), 1); renderCal(); };
      });
    }

    renderPlaces();
    renderWorld();
    renderPeople();
    renderCal();

    function renderWorld() {
      var box = $('#vh-world', body);
      if (!box) return;
      var W = global.Worlds;
      if (!vh.worldId) {
        box.innerHTML = '<div class="hint">No world pack loaded. Add a pack to give them a real city to move through.</div>';
        return;
      }
      var pack = W && W.cached(vh.worldId);
      box.innerHTML = '<div class="hint">World: <b>' + esc(vh.worldId) + '</b> — ' +
        (pack ? pack.placeCount + ' places, ' + pack.routeCount +
                ' walking routes. Journeys take as long as they really take.'
              : 'journey times will be estimated until it loads.') +
        ' <button class="chip" id="vh-world-off">remove</button></div>';
      var off = $('#vh-world-off', box);
      if (off) off.onclick = function () {
        if (pack) W.remove(vh, pack); else vh.worldId = null;
        renderWorld(); renderPlaces(); renderCal();
        UI.toast('World pack removed');
      };
    }

    var worldBtn = $('#vh-world-pack', body);
    if (worldBtn) worldBtn.onclick = function () {
      var W = global.Worlds;
      if (!W) return UI.toast('World packs are not available in this build');
      W.available().then(function (packs) {
        if (!packs.length) return UI.toast('No world packs are installed');
        var p = packs[0];   /* one pack ships today; a picker if more arrive */
        var msg = p.description + ' That is ' + p.placeCount + ' places and ' +
          p.routeCount + ' walking routes. Their home and work are kept, and ' +
          'journeys take as long as the walk really takes. ' + (p.attribution || '');
        return UI.confirm('Load ' + p.name + '?', msg, { okLabel: 'Load' })
          .then(function (yes) {
            if (!yes) return;
            return W.load(p.id).then(function (pack) {
              var n = W.apply(vh, pack);
              renderWorld(); renderPlaces(); renderCal();
              UI.toast(n + ' places loaded');
            });
          });
      }).catch(function (e) {
        UI.toast(e && e.message ? e.message : 'Could not load that world pack');
      });
    };

    var addPlace = $('#vh-add-place', body);
    if (addPlace) addPlace.onclick = function () {
      vh.places.push({ id: VH.uid('p'), name: 'New place', kind: 'other', note: '' });
      renderPlaces(); renderCal();
    };
    var addPerson = $('#vh-add-person', body);
    if (addPerson) addPerson.onclick = function () {
      vh.people.push({ id: VH.uid('pe'), name: '', relation: '', closeness: 0.5, note: '' });
      renderPeople();
    };
    var addCal = $('#vh-add-cal', body);
    if (addCal) addCal.onclick = function () {
      vh.calendar.push({ id: VH.uid('ev'), label: '', t: '09:00', day: null, placeId: null });
      renderCal();
    };
    var burstEl = $('#vh-burst', body);
    if (burstEl) burstEl.oninput = function () {
      vh.burst = parseInt(burstEl.value, 10) || 1;
      var out = $('#vh-burst-v', body);
      if (out) out.textContent = vh.burst;
    };

    var vhOn = $('#vh-on', body);
    if (vhOn) vhOn.onclick = function () {
      vh.enabled = !vh.enabled;
      this.classList.toggle('on', vh.enabled);
      $('#vh-fields', body).hidden = !vh.enabled;
    };
    var vhAdd = $('#vh-add', body);
    if (vhAdd) vhAdd.onclick = function () {
      vh.routine.push({ t: '12:00', a: '' });
      renderRoutine();
    };
    var vhAuto = $('#vh-auto', body);
    if (vhAuto) vhAuto.onclick = function (e) {
      var b = e.target.closest('button'); if (!b) return;
      vh.autonomy = b.getAttribute('data-a');
      this.querySelectorAll('button').forEach(function (x) { x.classList.remove('on'); });
      b.classList.add('on');
    };
    function bindRange(id, fn) {
      var el = $('#' + id, body);
      if (el) el.oninput = function () { fn(parseInt(el.value, 10)); };
    }
    bindRange('vh-dmin', function (v) { vh.replyDelay.min = v; updDelay(); });
    bindRange('vh-dmax', function (v) { vh.replyDelay.max = v; updDelay(); });
    function updDelay() {
      if (vh.replyDelay.max < vh.replyDelay.min) vh.replyDelay.max = vh.replyDelay.min;
      var el = $('#vh-dmin-v', body);
      if (el) el.textContent = vh.replyDelay.min + 's – ' + vh.replyDelay.max + 's';
    }
    var vhPhotos = $('#vh-photos', body);
    if (vhPhotos) vhPhotos.onclick = function () { vh.photos = !vh.photos; this.classList.toggle('on', vh.photos); };
    ['vh-mood', 'vh-aff', 'vh-trust', 'vh-ten'].forEach(function (id, i) {
      var el = $('#' + id, body);
      if (!el) return;
      el.oninput = function () {
        var v = parseInt(el.value, 10) / 100;
        if (id === 'vh-mood') vh.mood = v;
        if (id === 'vh-aff') vh.affinity = v;
        if (id === 'vh-trust') vh.trust = v;
        if (id === 'vh-ten') vh.tension = v;
        var out = $('#' + id + '-v', body);
        if (out) out.textContent = v.toFixed(2);
      };
    });
    var ss = $('#vh-sleep-start', body), se = $('#vh-sleep-end', body);
    if (ss) ss.onchange = function () { vh.sleep.start = ss.value || '23:00'; };
    if (se) se.onchange = function () { vh.sleep.end = se.value || '07:00'; };

    on(body, '[data-act=save]', 'click', function () {
      var c = collect();
      if (!c.name) { UI.toast('Give the character a name'); return; }
      App.saveCharacter(c);
    });
    on(body, '[data-act=delete]', 'click', function () {
      UI.confirm('Delete ' + (draft.name || 'character') + '?', 'All their chats and memories go too.',
        { danger: true, okLabel: 'Delete' }).then(function (ok) { if (ok) App.deleteCharacter(draft.id); });
    });
  };

  /* ================= chat helpers ================= */
  function messageHtml(m, char, s) {
    var isMe = m.role === 'user';
    var who = isMe ? s.userName : char.name;
    var text = m.text || '';
    var body = m._stream !== undefined && m._stream !== null ? m._stream : text;
    return '<div class="msg' + (isMe ? ' me' : '') + (m.autonomous ? ' auto' : '') + '" data-mid="' + m.id + '">' +
      '<div class="av">' + (isMe
        ? '<div class="ph">' + esc(initials(s.userName)) + '</div>'
        : avatarHtml(char.avatar, char.name)) + '</div>' +
      '<div style="min-width:0;max-width:calc(100% - 44px)">' +
        '<div class="bubble">' +
          (!isMe ? '<div class="who">' + esc(who) + '</div>' : '') +
          '<div class="mtext">' + md(body) + '</div>' +
          (m.image ? '<img class="gen" src="' + esc(m.image) + '" alt="generated image" data-lightbox="' + esc(m.image) + '">' : '') +
          (m.autonomous ? '<div class="auto-tag">· sent on their own</div>' : '') +
        '</div>' +
        '<div class="msg-actions">' +
          (isMe
            ? '<button class="chip" data-act="edit">' + icon('edit') + ' Edit</button>' +
              '<button class="chip" data-act="del">' + icon('trash') + '</button>'
            : '<button class="chip" data-act="reroll">' + icon('refresh') + ' Reroll</button>' +
              '<button class="chip" data-act="cont">Continue</button>' +
              '<button class="chip" data-act="edit">' + icon('edit') + '</button>' +
              '<button class="chip" data-act="copy">' + icon('copy') + '</button>' +
              '<button class="chip" data-act="del">' + icon('trash') + '</button>') +
        '</div>' +
        ((m.alts && m.alts.length > 1)
          ? '<div class="swipe">' +
            '<button data-act="swipe" data-dir="-1"><svg viewBox="0 0 24 24"><path d="M15 18l-6-6 6-6"/></svg></button>' +
            '<span>' + ((m.altIdx || 0) + 1) + ' / ' + m.alts.length + '</span>' +
            '<button data-act="swipe" data-dir="1"><svg viewBox="0 0 24 24"><path d="M9 18l6-6-6-6"/></svg></button>' +
            '</div>'
          : '') +
      '</div>' +
    '</div>';
  }

  Views.thread = function (char, session, messages, streamingId) {
    var s = Store.settings;
    var thread = $('#thread');
    var nearBottom = thread.scrollHeight - thread.scrollTop - thread.clientHeight < 120;
    thread.innerHTML = messages.map(function (m) {
      if (m.id === streamingId) m._stream = m._stream || '';
      return messageHtml(m, char, s);
    }).join('');
    var st = thread.querySelector('.msg.streaming .mtext') ||
      (streamingId ? thread.querySelector('[data-mid="' + streamingId + '"] .mtext') : null);
    if (nearBottom || streamingId) thread.scrollTop = thread.scrollHeight;
    return st;
  };

  Views.appendMessage = function (char, m) {
    var thread = $('#thread');
    var wrap = document.createElement('div');
    wrap.innerHTML = messageHtml(m, char, Store.settings);
    var el = wrap.firstElementChild;
    thread.appendChild(el);
    thread.scrollTop = thread.scrollHeight;
    return el;
  };

  Views.pickFile = pickFile;
  Views.fileToDataUrl = fileToDataUrl;
  Views.initials = initials;
  Views.avatarHtml = avatarHtml;

  /* ================= AUTHORED WORLDS ================= */
  /* Upstream .horde_world files: a place with streets and rooms, a cast,
     factions, lore and a set of rules. Artwork is stripped on import, so a
     2.5 MB world arrives at about 50 KB. */

  function worldBubble(m, world) {
    var isMe = m.role === 'user';
    var who = isMe ? (Store.settings.userName || 'You') : (world.name || 'Referee');
    return '<div class="msg' + (isMe ? ' me' : '') + '">' +
      '<div class="av"><div class="ph">' + esc(initials(who)) + '</div></div>' +
      '<div style="min-width:0;max-width:calc(100% - 44px)">' +
        '<div class="bubble">' +
          (!isMe ? '<div class="who">' + esc(who) + '</div>' : '') +
          '<div class="mtext">' + md(m.content || '') + '</div>' +
        '</div>' +
      '</div></div>';
  }

  /* The sheet folds. A world with many stats (a job grid, say) would otherwise
     render a HUD taller than several phone screens and bury the input under it
     - one line always shows (place, time, purse, tasks, what just changed) and
     the rest sits behind a tap. */
  var wrHudOpen = false;
  Views.wrHudOpen = function (v) { if (v === undefined) return wrHudOpen; wrHudOpen = !!v; };

  /* Time, stats, purse, pockets and tasks - whatever the world switches on. */
  Views.worldHud = function (world, run, changes) {
    var gr = world.gameRules || {}, hud = world.hudConfig || {};
    var loc = HW.location(world, run.locationId);
    var stats = hud.stats || [];

    var sheet = '';
    stats.forEach(function (st) {
      var v = run.stats[st.id];
      if (v === undefined) return;
      sheet += '<span>' + esc(st.name) + ' <b>' + esc(String(v)) + '</b>' +
             (st.max ? '/' + esc(String(st.max)) : '') + '</span>';
    });
    if ((gr.modules || {}).inventory !== false && run.inventory && run.inventory.length) {
      sheet += '<span>' + esc(run.inventory.join(', ')) + '</span>';
    }

    var head = '<span class="wr-at">' + esc(loc ? loc.name : 'Somewhere') + '</span>';
    if (hud.showClock !== false) {
      head += '<span><b>' + esc(HW.clockOf(run, hud).text) + '</b> · turn ' + (run.turn || 0) + '</span>';
    }
    if ((gr.modules || {}).commerce !== false && run.stats[run.cashId] !== undefined) {
      head += '<span><b>' + esc(String(run.stats[run.cashId])) + '</b> ' +
             esc(gr.currencyName || 'cash') + '</span>';
    }
    if ((gr.modules || {}).quests !== false) {
      var open = (run.quests || []).filter(function (q) { return !q.done; });
      if (open.length) {
        head += '<span>tasks: ' + esc(open.map(function (q) { return q.text; }).join('; ')) + '</span>';
      }
    }

    var collapsible = stats.length > 6;
    if (collapsible) {
      head += '<button type="button" class="wr-hud-toggle" data-act="wr-hud-toggle">' +
             (wrHudOpen ? 'hide sheet' : 'sheet (' + stats.length + ')') + '</button>';
    }

    var out = '<div class="wr-hud-row">' + head + '</div>';
    if (sheet) {
      out += '<div class="wr-hud-more"' + (collapsible && !wrHudOpen ? ' hidden' : '') + '>' + sheet + '</div>';
    }
    if (changes && changes.length) {
      out += '<div class="wr-changes">' + changes.map(function (c) {
        return '<span class="chip">' + esc(c) + '</span>';
      }).join('') + '</div>';
    }
    return out;
  };

  /* Flip the folded sheet in place - no re-render, so the change chips
     from the last turn stay visible. */
  Views.bindWorldHud = function (hud, world) {
    on(hud, '[data-act=wr-hud-toggle]', 'click', function () {
      wrHudOpen = !wrHudOpen;
      var more = hud.querySelector('.wr-hud-more');
      if (more) more.hidden = !wrHudOpen;
      var btn = hud.querySelector('[data-act=wr-hud-toggle]');
      if (btn) btn.textContent = wrHudOpen ? 'hide sheet' :
        'sheet (' + ((world.hudConfig || {}).stats || []).length + ')';
    });
  };

  Views.worldRun = function (world, run, changes) {
    var hud = $('#wr-hud'), thread = $('#wr-thread');
    if (hud) {
      hud.hidden = false;
      hud.innerHTML = Views.worldHud(world, run, changes);
      Views.bindWorldHud(hud, world);
    }
    if (!thread) return;
    thread.innerHTML = (run.log || []).map(function (m) { return worldBubble(m, world); }).join('');
    thread.scrollTop = thread.scrollHeight;
  };

  Views.worlds = function (root) {
    var body = $('#worlds-body');
    if (!body) return;

    Promise.all([HW.all(), HW.allRuns(), HW.bundled()]).then(function (res) {
      var list = res[0] || [], runs = res[1] || [], shipped = res[2] || [];
      var have = {};
      list.forEach(function (w) { have[w.id] = 1; });
      var offered = shipped.filter(function (e) { return !have[e.id]; });
      var html = '';

      if (runs.length) {
        html += '<div class="group"><div class="group-title">In progress</div>' +
          runs.map(function (r) {
            return '<div class="wr-card" data-run="' + esc(r.id) + '">' +
              '<div style="flex:1;min-width:0">' +
                '<div class="wr-name">' + esc(r.worldName || 'World') + '</div>' +
                '<div class="wr-sub">' + esc(r.lifeName ? 'as ' + r.lifeName : '') +
                  (r.lifeName ? ' · ' : '') + 'turn ' + (r.turn || 0) + '</div>' +
              '</div>' +
              '<button class="chip" data-act="wr-del" data-run="' + esc(r.id) + '">' + icon('trash') + '</button>' +
            '</div>';
          }).join('') + '</div>';
      }

      html += '<div class="group"><div class="group-title">Installed worlds</div>';
      if (!list.length) {
        html += '<div class="empty" style="padding:16px 4px"><p>No worlds yet. Import a ' +
          '<b>.horde_world</b> file. The artwork is stripped out on the way in, so a ' +
          '2.5 MB world arrives at about 50 KB.</p></div>';
      } else {
        html += list.map(function (w) {
          var sum = HW.summarise(w);
          return '<div class="wr-card" data-world="' + esc(w.id) + '">' +
            '<div style="flex:1;min-width:0">' +
              '<div class="wr-name">' + esc(w.name) + '</div>' +
              '<div class="wr-sub">' + sum.locations + ' places · ' + sum.people + ' people · ' +
                sum.factions + ' factions · ' + sum.lore + ' lore</div>' +
              (w.description
                ? '<div class="wr-sub" style="margin-top:4px">' +
                  esc(String(w.description).slice(0, 160)) + '</div>' : '') +
            '</div>' +
            '<button class="chip" data-act="world-del" data-world="' + esc(w.id) + '">' + icon('trash') + '</button>' +
          '</div>';
        }).join('');
      }
      if (offered.length) {
        html += '<div class="group"><div class="group-title">Available to install</div>' +
          offered.map(function (e) {
            return '<div class="wr-card" data-install="' + esc(e.id) + '">' +
              '<div style="flex:1;min-width:0">' +
                '<div class="wr-name">' + esc(e.name) + '</div>' +
                '<div class="wr-sub">' + (e.places || 0) + ' places · ' + (e.people || 0) +
                  ' people · ' + (e.factions || 0) + ' factions · ' + (e.roles || 0) + ' ways to begin</div>' +
                (e.description ? '<div class="wr-sub" style="margin-top:4px">' +
                  esc(e.description) + '</div>' : '') +
                (e.attribution ? '<div class="wr-sub" style="margin-top:4px;opacity:.7">' +
                  esc(e.attribution) + '</div>' : '') +
              '</div>' +
              '<button class="chip" data-act="world-install" data-install="' + esc(e.id) + '">Install</button>' +
            '</div>';
          }).join('') + '</div>';
      }

      html += '</div>';
      html += '<div class="field"><button class="btn ghost block sm" data-act="world-import">' +
        icon('plus') + ' Import a world file</button></div>';

      body.innerHTML = html;

      on(body, '[data-act=world-import]', 'click', function () { App.importWorld(); });
      on(body, '[data-world]', 'click', function (e) {
        if (e.target.closest('[data-act]')) return;
        App.startWorld(this.getAttribute('data-world'));
      });
      on(body, '[data-run]', 'click', function (e) {
        if (e.target.closest('[data-act]')) return;
        App.openWorldRun(this.getAttribute('data-run'));
      });
      on(body, '[data-act=world-install]', 'click', function () {
        var id = this.getAttribute('data-install');
        HW.installBundled(id).then(function (w) {
          UI.toast('Installed ' + (w && w.name), 3200);
          App.go('worlds');
        }).catch(function (e) {
          UI.toast((e && e.message) || 'Could not install that world', 4500);
        });
      });
      on(body, '[data-act=world-del]', 'click', function () {
        var id = this.getAttribute('data-world');
        UI.confirm('Delete this world?', 'Any playthroughs in it are removed too.',
          { danger: true, okLabel: 'Delete' }).then(function (yes) {
          if (!yes) return;
          HW.remove(id).then(function () { App.go('worlds'); });
        });
      });
      on(body, '[data-act=wr-del]', 'click', function () {
        var id = this.getAttribute('data-run');
        UI.confirm('Abandon this run?', 'The story so far is deleted.',
          { danger: true, okLabel: 'Abandon' }).then(function (yes) {
          if (!yes) return;
          HW.removeRun(id).then(function () { App.go('worlds'); });
        });
      });
    });
  };

  /* The roles a world lets you begin as, when it offers more than one. */
  Views.worldRoles = function (world) {
    var body = $('#worlds-body');
    if (!body) return;
    var lives = world.startingLives || [];
    body.innerHTML =
      '<div class="group"><div class="group-title">Begin as…</div>' +
      lives.map(function (l) {
        return '<div class="wr-card" data-life="' + esc(l.id) + '">' +
          '<div style="flex:1;min-width:0">' +
            '<div class="wr-name">' + esc(l.name || l.role || 'Someone') + '</div>' +
            (l.role ? '<div class="wr-sub">' + esc(l.role) +
              (l.socialRank ? ' · ' + esc(l.socialRank) : '') + '</div>' : '') +
            (l.description ? '<div class="wr-sub" style="margin-top:4px">' +
              esc(l.description) + '</div>' : '') +
          '</div></div>';
      }).join('') + '</div>' +
      '<div class="field"><button class="btn ghost block sm" data-act="worlds-back">Back to worlds</button></div>';

    on(body, '[data-life]', 'click', function () {
      App.beginWorld(world.id, this.getAttribute('data-life'));
    });
    on(body, '[data-act=worlds-back]', 'click', function () { App.go('worlds'); });
  };

  global.Views = Views;
})(window);
