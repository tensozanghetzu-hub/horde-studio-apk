/* Router, chat engine, menus */
(function (global) {
  'use strict';

  var esc = UI.esc, icon = UI.icon;
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  function on2(root, sel, ev, fn) {
    (root.querySelectorAll ? root.querySelectorAll(sel) : []).forEach(function (el) {
      el.addEventListener(ev, fn);
    });
  }

  var App = {
    state: { screen: 'characters', query: '', tag: '', worldChar: null, messages: [], char: null, session: null, busy: false, lifeBusy: {}, settingsSection: 'connection', worldStatusOpen: false },
    stack: [],
    abort: null,
    deferredPrompt: null
  };

  /* ---------------- routing ---------------- */
  var TITLES = { characters: 'Horde Studio', now: 'Now', chats: 'Conversations', world: 'World', settings: 'Settings', settingsx: 'Settings', personas: 'Personas' };

  App.go = function (name, params) {
    if (App.stopSpeech) App.stopSpeech();
    params = params || {};
    if (name === 'now') name = 'life';                 // v1.x name for the Life screen
    if (name !== App.state.screen) App.stack.push(App.state.screen);
    App.state.screen = name;

    $$('.screen').forEach(function (el) { el.hidden = el.getAttribute('data-screen') !== name; });
    App.renderTyping();
    /* A settings sub-screen is still "in Settings" for the bottom nav. */
    var navName = name === 'settings-x' ? 'settings' : name;
    $$('.nav-btn').forEach(function (b) { b.classList.toggle('active', b.getAttribute('data-go') === navName); });

    var back = $('#btn-back'), act = $('#btn-bar-action');
    back.hidden = !(name === 'chat' || name === 'editor' || name === 'worldrun' || name === 'worldcorrect' || name === 'personas' || name === 'settings-x');
    act.hidden = !(name === 'chat' || name === 'characters' || name === 'worldrun');
    if (name === 'chat') act.setAttribute('aria-label', 'Conversation options');

    if (name === 'settings') {
      $('#bar-title').textContent = 'Settings';
      $('#bar-sub').textContent = '';
      Views.settings($('.screen'));
      App.mountInstall();
    } else if (name === 'personas') {
      $('#bar-title').textContent = 'Personas';
      $('#bar-sub').textContent = Store.personas.length +
        (Store.personas.length === 1 ? ' identity' : ' identities');
      Views.personas($('.screen'));
    } else if (name === 'settings-x') {
      /* v1.16.0: the one shared sub-screen behind Settings' section rows. */
      var sec = App.state.settingsSection || 'connection';
      var meta = Views.SETTINGS_SECTIONS[sec];
      $('#bar-title').textContent = meta ? meta.title : 'Settings';
      $('#bar-sub').textContent = '';
      Views[meta ? meta.view : 'settingsConnection']($('.screen'));
    } else if (name === 'characters') {
      $('#bar-title').textContent = 'Horde Studio';
      $('#bar-sub').textContent = Store.characters.length + (Store.characters.length === 1 ? ' character' : ' characters');
      Views.characters($('.screen'));
    } else if (name === 'now' || name === 'life') {
      $('#bar-title').textContent = 'Life';
      $('#bar-sub').textContent = '';
      Views.life($('.screen'));
    } else if (name === 'feed') {
      $('#bar-title').textContent = 'Their world';
      $('#bar-sub').textContent = '';
      Views.feed($('.screen'));
    } else if (name === 'chats') {
      $('#bar-title').textContent = 'Conversations';
      $('#bar-sub').textContent = '';
      Views.chats($('.screen'));
    } else if (name === 'world') {
      $('#bar-title').textContent = 'World & Memory';
      $('#bar-sub').textContent = '';
      Views.world($('.screen'));
    } else if (name === 'worlds') {
      $('#bar-title').textContent = 'Worlds';
      $('#bar-sub').textContent = '';
      Views.worlds($('.screen'));
    } else if (name === 'worldrun') {
      var wrun = App.state.worldRun;
      $('#bar-title').textContent = (App.state.world && App.state.world.name) || 'World';
      $('#bar-sub').textContent = wrun ? ('turn ' + (wrun.turn || 0)) : '';
    } else if (name === 'worldcorrect') {
      $('#bar-title').textContent = 'Correct world state';
      $('#bar-sub').textContent = (App.state.world && App.state.world.name) || '';
      Views.worldCorrect($('.screen'));
    } else if (name === 'chat') {
      var ch = App.state.char;
      $('#bar-title').textContent = (ch && ch.name) || 'Chat';
      var sub = App.state.session ? (App.state.session.title || 'New chat') : '';
      /* Who you are in this thread — worth stating, since switching personas
         swaps which of a character's conversations you are looking at. */
      if (Store.settings.activePersona) sub = 'as ' + Store.personaLabel() + ' · ' + sub;
      if (ch && ch.vh && ch.vh.enabled) {
        var st = VH.status(ch);
        sub = st.text + ' · ' + sub;
      }
      $('#bar-sub').textContent = sub;
      Views.stateStrip(ch);
    } else if (name === 'editor') {
      $('#bar-title').textContent = params.isNew ? 'New character' : 'Edit character';
      $('#bar-sub').textContent = '';
      Views.editor($('.screen'), params.char);
    }
    /* v1.25.0: on the world screen the bar action is the status button
       (stats, purse, pockets, tasks, party — the desktop sidebar, on
       demand, reachable from anywhere in the conversation); elsewhere it
       is the usual "more". */
    act.innerHTML = name === 'worldrun' ?
      '<svg viewBox="0 0 24 24"><path d="M5 20v-7M12 20V5M19 20v-4"/></svg>' :
      '<svg viewBox="0 0 24 24"><circle cx="12" cy="5" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="12" cy="19" r="1.6"/></svg>';
    window.scrollTo(0, 0);
  };

  App.back = function () {
    var prev = App.stack.pop() || 'characters';
    App.state.screen = null;
    App.go(prev);
  };

  /* Open a Settings section on the shared sub-screen (v1.16.0). */
  App.openSettings = function (sec) {
    if (!Views.SETTINGS_SECTIONS[sec]) sec = 'connection';
    App.state.settingsSection = sec;
    App.go('settings-x');
  };

  /* ---------------- characters ---------------- */
  App.editCharacter = function (char) {
    var isNew = !char;
    var c = char || Store.blankCharacter();
    if (isNew) { App.stack.push(App.state.screen); App.state.screen = null; }
    App.go('editor', { char: c, isNew: isNew });
  };

  App.saveCharacter = function (c) {
    Store.putCharacter(c).then(function () {
      UI.toast('Saved');
      App.state.screen = null;
      App.go('characters');
    });
  };

  App.deleteCharacter = function (id) {
    /* v1.21.0 (upstream 18.3.5): deleting the character a reply is generating
       for strands the in-flight turn mid-save. */
    if (App.state.busy && App.state.char && App.state.char.id === id) {
      return UI.toast('Wait for the current reply or stop it first');
    }
    Store.delCharacter(id).then(function () {
      UI.toast('Character deleted');
      App.state.screen = null;
      App.go('characters');
    }).catch(function (e) {
      UI.toast('Could not delete the character: ' + (e && e.message), 6000);
    });
  };

  App.openCharacter = function (id) {
    Promise.resolve(Store.getCharacter(id)).then(function (c) {
      if (!c) return UI.toast('Character not found');
      Store.getSessions(id).then(function (sessions) {
        var last = sessions[0];
        UI.sheet({
          title: c.name,
          body:
            '<div class="opt" data-a="chat">' + icon('chat') + ' ' + (last ? 'Continue “' + esc(last.title || 'New chat') + '”' : 'Start a chat') + '</div>' +
            '<div class="opt" data-a="new">' + icon('plus') + ' New chat</div>' +
            (sessions.length > 1 ? '<div class="opt" data-a="all">' + icon('time') + ' All chats (' + sessions.length + ')</div>' : '') +
            '<div class="opt" data-a="edit">' + icon('edit') + ' Edit character</div>' +
            (c.vh && c.vh.enabled
              ? '<div class="opt" data-a="vh">' + icon('time') + ' Life & schedule</div>'
              : '<div class="opt" data-a="makevh">' + icon('time') + ' Make a virtual human</div>') +
            '<div class="opt" data-a="world">' + icon('brain') + ' Lorebook & memory</div>' +
            '<div class="opt" data-a="export">' + icon('download') + ' Export as card (JSON)</div>' +
            '<div class="opt" data-a="dup">' + icon('copy') + ' Duplicate</div>' +
            '<div class="opt danger" data-a="del">' + icon('trash') + ' Delete</div>',
          dismissible: true,
          onMount: function (b, close) {
            b.querySelectorAll('.opt').forEach(function (el) {
              el.onclick = function () {
                var a = el.getAttribute('data-a');
                close();
                if (a === 'chat') {
                  if (last) App.openSession(last.id); else App.newChat(c.id);
                } else if (a === 'new') App.newChat(c.id);
                else if (a === 'all') { App.state.tag = ''; App.go('chats'); }
                else if (a === 'edit') App.editCharacter(c);
                else if (a === 'world') { App.state.worldChar = c.id; App.go('world'); }
                else if (a === 'makevh' || a === 'vh') {
                  VH.ensure(c);
                  c.vh.enabled = true;
                  App.persistVH(c).then(function () { App.editCharacter(c); });
                }
                else if (a === 'export') {
                  UI.download((c.name || 'character').replace(/[^\w\-]+/g, '_') + '.json',
                    JSON.stringify(Store.characterToCard(c), null, 2));
                } else if (a === 'dup') {
                  var d = Object.assign({}, c, { id: UI.uid('c'), name: (c.name || '') + ' (copy)', createdAt: Date.now() });
                  Store.putCharacter(d).then(function () { App.go('characters'); UI.toast('Duplicated'); });
                } else if (a === 'del') {
                  UI.confirm('Delete ' + c.name + '?', 'Chats and memories for this character are removed too.',
                    { danger: true, okLabel: 'Delete' }).then(function (ok) { if (ok) App.deleteCharacter(c.id); });
                }
              };
            });
          }
        });
      });
    });
  };

  App.characterMenu = function (id) { App.openCharacter(id); };

  /* ---------------- personas ---------------- */
  /* Which screen to land on after a persona switch/create: the one you are
     on, whenever it has a persona bar or persona rows. Sub-screens (a
     conversation, the editor) fall back to Cast, where the bar lives. */
  var MAIN_SCREENS = ['characters', 'life', 'chats', 'world', 'worlds', 'settings', 'personas'];
  function personaReturnScreen(was) {
    return (was && MAIN_SCREENS.indexOf(was) !== -1) ? was : 'characters';
  }
  /* Personas are switchable player identities. Each keeps its own chats with
     every character, and — because bonds are keyed by user name — its own
     separate relationship ledger with each virtual human. */

  App.newPersona = function () {
    var was = App.state.screen;
    UI.input('New persona', {
      message: 'Each persona gets its own chats with every character, and its own relationships.',
      placeholder: 'Name — e.g. Marcus',
      okLabel: 'Create'
    }).then(function (name) {
      if (!name) return;
      name = String(name).trim();
      if (!name) return UI.toast('A persona needs a name');
      var p = Store.blankPersona();
      p.name = name;
      Store.putPersona(p)
        .then(function () { return Store.switchPersona(p.id); })
        .then(function () {
          UI.toast('Now playing as ' + name);
          App.state.screen = null;
          /* Stay where we were — the bar is on Cast, Chats and Settings. */
          App.go(personaReturnScreen(was));
        });
    });
  };

  App.switchTo = function (id) {
    var was = App.state.screen;
    Store.switchPersona(id || '').then(function (p) {
      UI.toast(p ? 'Now playing as ' + (p.name || 'Unnamed')
                 : 'Back to ' + (Store.settings.defaultName || 'You'));
      App.state.screen = null;
      App.go(personaReturnScreen(was));
    });
  };

  App.deletePersona = function (id) {
    var was = App.state.screen;
    var p = (Store.personas || []).find(function (x) { return x.id === id; });
    if (!p) return;
    UI.confirm('Delete persona “' + (p.name || 'Unnamed') + '”?',
      'Every chat this persona had with every character goes too. Your other personas are untouched.',
      { danger: true, okLabel: 'Delete' }).then(function (ok) {
        if (!ok) return;
        Store.delPersona(id).then(function (n) {
          UI.toast('Persona deleted' + (n ? ' · ' + n + (n === 1 ? ' chat' : ' chats') + ' removed' : ''));
          App.state.screen = null;
          App.go(was === 'personas' ? 'personas' : 'settings');
        });
      });
  };

  App.editPersona = function (id, patch) {
    var p = (Store.personas || []).find(function (x) { return x.id === id; });
    if (!p) return;
    Object.assign(p, patch);
    Store.putPersona(p).then(function () {
      /* Keep the live identity in step when editing the persona in use. */
      if (Store.settings.activePersona === id) {
        return Store.applyPersona().then(function () { return Store.saveSettings(); });
      }
      return null;
    }).then(function () {
      if (App.state.screen === 'characters') return Views.renderPersonaBar();
      /* On the Personas screen, refresh just the row heading instead of
         re-rendering the whole screen, which would throw away the caret and
         scroll position. */
      if (App.state.screen === 'personas' && patch.name !== undefined) {
        var row = document.querySelector('[data-prow="' + id + '"]');
        var lbl = row && row.querySelector('label');
        if (lbl) lbl.textContent = p.name || 'Unnamed persona';
      }
    });
  };

  App.importCard = function () {
    Views.pickFile('.json,.png,application/json,image/png').then(function (f) {
      if (!f) return;
      Store.readCardFile(f).then(function (card) {
        var c = Store.cardToCharacter(card);
        /* v1.13.1: card text arrives as HTML — SillyTavern/Janitor
           descriptions, <br> line breaks, the bot's avatar as
           <img src="…">. Convert it to plain prose now, so the sheet,
           the greeting and the prompt never carry markup a model could
           read and echo back as literal text. */
        c.persona = API.plainText(c.persona);
        c.scenario = API.plainText(c.scenario);
        c.greeting = API.plainText(c.greeting);
        c.examples = API.plainText(c.examples);
        c.postHistory = API.plainText(c.postHistory);
        c.lorebook = (c.lorebook || []).map(function (e) {
          e.content = API.plainText(e.content);
          return e;
        });
        /* v1.12.0: the imported avatar joins the card, normalized like every
           other imported image (512px long edge, PNG only with real
           transparency) so a 12 MP card art never becomes several MB of
           base64 sitting in IndexedDB. Non-image values pass through. */
        /* v1.29.0: the card's other pictures join the avatar with the same
           diet (512px long edge), so a picture-heavy card never becomes
           several megabytes of base64 in IndexedDB. */
        return Views.normalizeDataUrl(c.avatar, 512).then(function (av) {
          if (av) c.avatar = av;
          return Views.normalizeCardImages(c.images);
        }).then(function () {
          UI.sheet({
            title: 'Import “' + (c.name || 'character') + '”',
            body: '<p style="margin:0 0 8px;color:var(--muted);font-size:13.5px">' +
              esc((c.persona || '').slice(0, 260)) + (c.persona && c.persona.length > 260 ? '…' : '') + '</p>' +
              (c.lorebook && c.lorebook.length ? '<span class="pill">' + c.lorebook.length + ' lorebook entries</span>' : ''),
            actions: [
              { label: 'Cancel', cls: 'ghost', value: null },
              { label: 'Import', cls: 'primary', onClick: function () { return c; } }
            ]
          }).then(function (res) {
            if (!res) return;
            Store.putCharacter(res).then(function () { App.go('characters'); UI.toast('Imported ' + res.name); });
          });
        });
      }).catch(function (e) { UI.toast('Import failed: ' + e.message, 4000); });
    });
  };

  /** v1.13.0: set the internal state by hand from the chat strip. The model
   *  still owns it from the next reply on — this just sets where it starts. */
  App.editCharState = function (char) {
    var st = char.state || {};
    UI.sheet({
      title: 'Internal state — ' + (char.name || 'character'),
      body:
        '<div class="field"><div class="field-head"><label>Mood</label></div>' +
        '<input type="text" id="cs-mood" value="' + esc(st.mood || '') + '" placeholder="weary but fond"></div>' +
        '<div class="field"><div class="field-head"><label>Intent</label></div>' +
        '<input type="text" id="cs-intent" value="' + esc(st.intent || '') + '" placeholder="what they are trying to do next"></div>' +
        '<div class="field"><div class="field-head"><label>Flags</label></div>' +
        '<input type="text" id="cs-flags" value="' + esc(st.flags || '') + '" placeholder="details worth remembering, comma-separated"></div>' +
        '<div class="hint">Sent to the model with every reply; the model updates it on its own each turn, ' +
        'and the block it writes back is hidden from you.</div>',
      actions: [
        { label: 'Cancel', cls: 'ghost', value: null },
        { label: 'Save', cls: 'primary', onClick: function (b) {
          return {
            mood: b.querySelector('#cs-mood').value.trim(),
            intent: b.querySelector('#cs-intent').value.trim(),
            flags: b.querySelector('#cs-flags').value.trim()
          };
        } }
      ]
    }).then(function (v) {
      if (!v) return;
      char.state = {
        mood: v.mood, intent: v.intent, flags: v.flags,
        updatedAt: Date.now(), by: 'user'
      };
      Store.putCharacter(char).then(function () {
        Views.stateStrip(char);
        UI.toast('State saved — the next reply picks up from here');
      });
    });
  };

  /* ---------------- sessions / chat ---------------- */
  App.newChat = function (charId, title) {
    var s = Store.newSession(charId, title);
    return Store.putSession(s).then(function () {
      return Promise.resolve(Store.getCharacter(charId));
    }).then(function (c) {
      var greeting = API.macros(c.greeting || '', c, Store.settings);
      var first = greeting
        ? Store.addMessage({ sessionId: s.id, role: 'assistant', text: greeting, alts: [greeting], altIdx: 0 })
        : Promise.resolve(null);
      return first.then(function () { App.openSession(s.id); });
    });
  };

  App.openSession = function (id) {
    App.stopSpeech();
    App.state.attach = null; App.renderAttach();   /* staging belongs to the chat you leave */
    IDB.get('sessions', id).then(function (s) {
      if (!s) return UI.toast('Chat not found');
      return Promise.resolve(Store.getCharacter(s.charId)).then(function (c) {
        return Store.getMessages(id).then(function (msgs) {
          App.state.session = s; App.state.char = c; App.state.messages = msgs;
          App.state.screen = null;
          App.go('chat');
          Views.thread(c, s, msgs, null, true);
          $('#input').focus();
        });
      });
    });
  };

  /** v1.39.0 G: the chat health numbers, computed off the ledger itself.
   *  Pure for tests: no DOM, no promises. */
  App.chatHealth = function (session, messages, settings) {
    messages = messages || [];
    var replies = 0, words = 0, rerolls = 0, auto = 0;
    messages.forEach(function (m) {
      if (m.role === 'assistant') {
        replies++;
        words += String(m.text || '').trim().split(/\s+/).filter(Boolean).length;
        rerolls += Math.max(0, (m.alts ? m.alts.length : 1) - 1);
      }
      if (m.autonomous) auto++;
    });
    var memAt = session.memAt || session.memoryAt || 0;
    var windowed = messages.slice(-(settings.contextMessages || 40))
      .map(function (m) { return (m.role === 'user' ? 'You' : 'They') + ': ' + (m.text || ''); }).join('\n');
    var contextChars = (session.summary || '').length +
      ((session.facts || []).join('\n')).length + windowed.length;
    return {
      messages: messages.length,
      replies: replies,
      rerolls: rerolls,
      autonomousMessages: auto,
      wordsPerReply: replies ? Math.round(words / replies) : 0,
      sinceSummary: Math.max(0, (session.messageCount || messages.length) - memAt),
      memoryEvery: settings.memoryEvery || 14,
      contextTokens: Math.ceil(contextChars / 4)
    };
  };

  App.chatHealthSheet = function (sessionId) {
    Promise.all([IDB.all('messages').then(function (all) {
      return all.filter(function (m) { return m.sessionId === sessionId; });
    }), IDB.get('sessions', sessionId)]).then(function (r) {
      var msgs = (r[0] || []).sort(function (a, b) { return a.createdAt - b.createdAt; });
      var sess = r[1];
      var h = App.chatHealth(sess, msgs, Store.settings);
      UI.sheet({
        title: 'Chat health',
        body: '<div class="group">' +
          '<div class="kv"><span>Messages</span><b>' + h.messages + '</b></div>' +
          '<div class="kv"><span>Replies from the character</span><b>' + h.replies + '</b></div>' +
          '<div class="kv"><span>Average reply length</span><b>' + h.wordsPerReply + ' words</b></div>' +
          '<div class="kv"><span>Rerolls spent</span><b>' + h.rerolls + '</b></div>' +
          (h.autonomousMessages ? '<div class="kv"><span>Sent on their own</span><b>' + h.autonomousMessages + '</b></div>' : '') +
          '<div class="kv"><span>Prompt weight (estimate)</span><b>~' + h.contextTokens + ' tokens</b></div>' +
          '<div class="kv"><span>Since last memory write</span><b>' + h.sinceSummary + ' of ' + h.memoryEvery + '</b></div>' +
          '</div>' +
          '<div class="hint" style="margin-top:10px">The weight estimate counts the memory and the ' +
          'recent history your next message will carry - if the model starts forgetting, ' +
          'let memory catch up or trim the thread.</div>'
      });
    }).catch(function (e) { UI.toast('Could not read the chat: ' + (e && e.message), 4000); });
  };

  App.chatSettingsSheet = function (sessionId) {
    IDB.get('sessions', sessionId).then(function (s) {
      if (!s) return;
      var ov = s.overrides || {}, sheetBody = document;
      UI.sheet({
        title: 'Chat settings — ' + (s.title || 'New chat'),
        body:
          '<div class="field"><div class="field-head"><label>Temperature (leave empty for the character\'s default)</label></div>' +
            '<input id="cs-temp" type="number" min="0" max="2" step="0.05" value="' + (ov.temperature === 0 || ov.temperature ? ov.temperature : '') + '" placeholder="default"></div>' +
          '<div class="field"><div class="field-head"><label>Max reply tokens (leave empty for default)</label></div>' +
            '<input id="cs-maxtok" type="number" min="32" max="2048" step="16" value="' + (ov.maxTokens || '') + '" placeholder="default"></div>' +
          '<div class="field"><div class="field-head"><label>Style note for this chat only</label></div>' +
            '<textarea id="cs-note" class="tall" placeholder="e.g. answer in short, clipped lines">' + esc(ov.note || '') + '</textarea></div>',
        actions: [
          { label: 'Save', value: 'save' },
          { label: 'Reset to defaults', cls: 'ghost', value: 'reset' },
          { label: 'Cancel', cls: 'ghost', value: null }
        ],
        onMount: function (b) { sheetBody = b; }
      }).then(function (res) {
        if (!res) return;
        if (res === 'reset') { s.overrides = null; return Store.putSession(s).then(function () { UI.toast('Chat follows the character again'); }); }
        var temp = $('#cs-temp', sheetBody).value.trim();
        var maxt = parseInt($('#cs-maxtok', sheetBody).value, 10);
        var note = $('#cs-note', sheetBody).value.trim();
        s.overrides = {};
        if (temp !== '') s.overrides.temperature = parseFloat(temp);
        if (maxt > 0) s.overrides.maxTokens = maxt;
        if (note) s.overrides.note = note;
        if (!Object.keys(s.overrides).length) s.overrides = null;
        return Store.putSession(s).then(function () { UI.toast('Chat settings saved'); });
      });
    });
  };

  /** v1.39.0 H: after the third real exchange, an untitled chat learns its
      name from one tiny one-shot call. Silent on failure (a title is a
      nicety, not an availability problem). */
  App.maybeAutoTitle = function () {
    var st = App.state;
    if (!st.session || !st.char) return;
    var s = st.session;
    if (s.title && s.title !== 'New chat' && !s.titleAuto) return;   /* user-named: hands off */
    if (s.titleAuto) return;                                          /* we named it once */
    var turns = st.messages.filter(function (m) { return m.role === 'user' || m.role === 'assistant'; });
    if (turns.length < 6) return;
    if (s._titling) return;
    s._titling = true;
    var transcript = turns.slice(0, 10).map(function (m) {
      return (m.role === 'user' ? Store.settings.userName : st.char.name) + ': ' + (m.text || '').slice(0, 220);
    }).join('\n').slice(0, 1400);
    return API.generateFree({
      settings: Store.settings, name: 'title',
      system: 'Name this conversation in at most five words. No quotes, no commentary, just the title.',
      instruction: transcript,
      maxTokens: 24, signal: null
    }).then(function (text) {
      s._titling = false;
      text = String(text || '').trim().replace(/^[\"'《]+|[\"'》]+$/g, '').split('\n')[0].slice(0, 60);
      if (!text) return;
      s.title = text;
      s.titleAuto = true;
      return Store.putSession(s).then(function () {
        if (App.state.screen === 'chats') Views.chats($('.screen'));
      });
    }).catch(function () { s._titling = false; });
  };

  /** v1.39.0 F: read a reply aloud. The engine lives on the device
      (speechSynthesis), so it works offline against whatever voice the
      platform carries. One utterance at a time; a second tap stops it. */
  App.stopSpeech = function () {
    try {
      if (global.speechSynthesis) global.speechSynthesis.cancel();
    } catch (e) { /* best effort */ }
    if (App.state.speakingBtn) {
      App.state.speakingBtn.innerHTML = iconSafe('volume');
      App.state.speakingBtn = null;
    }
  };

  function iconSafe(name) {
    return (typeof icon === 'function') ? '<svg viewBox="0 0 24 24">' + '</svg>' : name;
  }

  App.speakMessage = function (msg, btn) {
    if (!global.speechSynthesis) {
      UI.toast('This device offers no speech engine', 3200);
      return;
    }
    if (App.state.speakingBtn === btn) { App.stopSpeech(); return; }
    App.stopSpeech();
    var text = Views.speechText(msg.text || '');
    if (!text) return UI.toast('Nothing to say on this one');
    var u = new SpeechSynthesisUtterance(text);
    u.rate = 1; u.pitch = 1;
    u.onerror = u.onend = function () {
      if (App.state.speakingBtn === btn) {
        App.state.speakingBtn = null;
        btn.innerHTML = iconSafe('volume');
      }
    };
    App.state.speakingBtn = btn;
    btn.innerHTML = iconSafe('pause');
    global.speechSynthesis.speak(u);
  };

  /** v1.39.0 E: staged photo for the next send. The model reads only the
      caption the player writes - that is the honest translation from pixels
      to text-model words. */
  App.stageAttach = function () {
    if (App.state.busy) return UI.toast('Wait for the current reply');
    Views.pickFile('image/*').then(function (file) {
      if (!file) return;
      return Views.normalizeImage ? Views.normalizeImage(file, 640) :
        new Promise(function (resolve) {
          var fr = new FileReader();
          fr.onload = function () { resolve(fr.result); };
          fr.readAsDataURL(file);
        });
    }).then(function (dataUrl) {
      if (!dataUrl) return;
      return UI.input('Describe the photo - the character will read this', {
        placeholder: 'e.g. a red door with three locks'
      }).then(function (cap) {
        if (cap === null || !String(cap).trim()) return;
        App.state.attach = { image: dataUrl, caption: String(cap).trim() };
        App.renderAttach();
        $('#input').focus();
      });
    }).catch(function (e) { UI.toast('Could not read that image: ' + (e && e.message), 4000); });
  };

  App.renderAttach = function () {
    var el = $('#attach-stage');
    if (!el) return;
    var a = App.state.attach;
    if (!a) { el.hidden = true; el.innerHTML = ''; return; }
    el.hidden = false;
    el.innerHTML = '<img src="' + UI.esc(a.image) + '" alt="staged photo">' +
      '<span class="attach-cap">' + UI.esc(a.caption) + '</span>' +
      '<button class="chip" data-attach-x="1">✕</button>';
    el.querySelector('[data-attach-x]').onclick = function () {
      App.state.attach = null; App.renderAttach();
    };
  };

  /** v1.39.0 B: one readable export, one real backup Import is its twin. */
  App.exportSheet = function (id) {
    UI.sheet({
      title: 'Export transcript',
      body: '<div class="opt" data-a="text">' + icon('edit') + ' For reading (.txt)</div>' +
        '<div class="opt" data-a="json">' + icon('download') + ' Backup (.json) — for Horde Studio</div>',
      onMount: function (b, close) {
        b.querySelectorAll('.opt').forEach(function (el) {
          el.onclick = function () {
            var a = el.getAttribute('data-a'); close();
            if (a === 'text') App.exportTranscript(id);
            else App.exportTranscriptJson(id);
          };
        });
      }
    });
  };

  App.exportTranscriptJson = function (id) {
    Promise.all([IDB.get('sessions', id), Store.getMessages(id)]).then(function (r) {
      var s = r[0], msgs = r[1];
      return Promise.resolve(Store.getCharacter(s.charId)).then(function (c) {
        var data = {
          k: 'hordesession', v: 1, title: s.title || 'New chat',
          charName: c ? c.name : 'Character', createdAt: s.createdAt,
          summary: s.summary || '', facts: s.facts || [],
          messages: msgs.map(function (m) {
            return { role: m.role, text: m.text || '', createdAt: m.createdAt, image: m.image || null, imageCaption: m.imageCaption || null, autonomous: !!m.autonomous };
          })
        };
        UI.download(((c && c.name) || 'chat') + '-' + (s.title || 'chat') + '.hordechat.json',
          JSON.stringify(data, null, 2), 'application/json');
      });
    });
  };

  /** The twin: ingest a .hordechat.json backup as a NEW session under a
      character you choose. Never overwrites: import always creates. */
  App.importChatData = function (raw, charId) {
    var data = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!data || !(data.k === 'hordesession') || !Array.isArray(data.messages)) {
      throw new Error('not a Horde Studio chat backup');
    }
    var s = Store.newSession(charId, (data.title || 'Imported chat'));
    s.summary = data.summary || '';
    s.facts = Array.isArray(data.facts) ? data.facts : [];
    s.createdAt = data.createdAt || Date.now();
    var msgs = data.messages.filter(function (m) {
      return m && (m.role === 'user' || m.role === 'assistant' || m.role === 'system');
    }).map(function (m) {
      return {
        id: UI.uid('m'), sessionId: s.id, role: m.role,
        text: String(m.text || ''), image: m.image || null,
        imageCaption: m.imageCaption || null,
        alts: m.text ? [String(m.text)] : [], altIdx: 0,
        autonomous: !!m.autonomous,
        createdAt: m.createdAt || Date.now()
      };
    });
    s.messageCount = msgs.filter(function (m) { return m.role !== 'system'; }).length;
    return Store.putSession(s).then(function () {
      return IDB.putMany('messages', msgs);
    }).then(function () { return s; });
  };

  App.importChat = function () {
    Views.pickFile('.json,application/json').then(function (file) {
      if (!file) return;
      return file.text().then(function (txt) {
        if (!Store.characters.length) return UI.toast('Make a character first - the chat needs someone to talk to', 4200);
        function pickChar() {
          if (Store.characters.length === 1) return Promise.resolve(Store.characters[0]);
          return UI.sheet({
            title: 'Import to which character?',
            body: Store.characters.map(function (c, i) {
              return '<div class="opt" data-i="' + i + '">' + esc(c.name || 'Unnamed') + '</div>';
            }).join(''),
            onMount: function (b, close) {
              var promise = App._pickCharResolve = null;
            }
          });
        }
        /* a single sheet returning the chosen character through a promise */
        return new Promise(function (resolve) {
          if (Store.characters.length === 1) return resolve(Store.characters[0]);
          var closeRef = null;
          UI.sheet({
            title: 'Import to which character?',
            body: Store.characters.map(function (c, i) {
              return '<div class="opt" data-i="' + i + '">' + esc(c.name || 'Unnamed') + '</div>';
            }).join(''),
            onMount: function (b, close) {
              closeRef = close;
              b.querySelectorAll('.opt').forEach(function (el) {
                el.onclick = function () { close(); resolve(Store.characters[parseInt(el.getAttribute('data-i'), 10)]); };
              });
            }
          });
        }).then(function (char) {
          if (!char) return;
          return App.importChatData(txt, char.id).then(function () {
            UI.toast('Chat imported for ' + (char.name || 'the character'), 3200);
            App.openSession && Views.chats($('.screen'));
          });
        }).catch(function (e) { UI.toast('Import failed: ' + (e && e.message), 4200); });
      });
    });
  };

  /** v1.39.3: one confirmed tap back to factory for the Generation screen.
      Only that screen's nine keys move - credentials, model, personas and
      theme belong to other rooms. */
  /** v1.39.6: the vocabulary the world turn reports with, kept identical to
      the chat's - one mapper both call sites share. Pure for tests. */
  App.worldProgressText = function (info) {
    info = info || {};
    if (info.state === 'processing') return 'Generating on a volunteer GPU…';
    if (info.state === 'queued') return 'Queued on the Horde · position ' + (info.queuePosition || 0);
    if (info.state === 'rate-limited') return 'Horde rate limit — pausing ' + (info.waitTime || 10) + 's';
    if (info.state === 'retrying') return 'Connection blip — retrying…';
    if (info.state === 'continuing') return 'Reply got cut off — finishing it…';
    if (info.state === 'empty') return 'Worker sent nothing — asking another… (' +
      ((info.attempt || 0) + 1) + ' of ' + (info.of || 3) + ')';
    return 'Working…';
  };


  App.resetGenerationSettings = function () {
    return UI.confirm('Reset generation settings?',
      'Temperature, reply length, context window and the reply-behaviour toggles ' +
      'return to their factory values. Provider, API key, model and personas stay untouched.',
      { okLabel: 'Reset', danger: true }).then(function (yes) {
      if (!yes) return false;
      var patch = Store.generationDefaults();
      Object.assign(Store.settings, patch);
      return Store.saveSettings().then(function () {
        /* re-render only if the tinkerer is still standing on that screen */
        if (App.state.screen === 'settings-x') {
          var body = $ && $('.screen');
          if (body) Views.settingsGeneration(body);
        }
        UI.toast('Generation settings restored to defaults');
        return true;
      });
    });
  };

  App.sessionMenu = function (id) {
    IDB.get('sessions', id).then(function (s) {
      if (!s) return;
      UI.sheet({
        title: s.title || 'New chat',
        body:
          '<div class="opt" data-a="pin">' + icon('plus') + (s.pinned ? ' Unpin' : ' Pin to top') + '</div>' +
          '<div class="opt" data-a="archive">' + icon('download') + (s.archived ? ' Unarchive' : ' Archive') + '</div>' +
          '<div class="opt" data-a="rename">' + icon('edit') + ' Rename</div>' +
          '<div class="opt" data-a="settings">' + icon('edit') + ' Chat settings</div>' +
          '<div class="opt" data-a="health">' + icon('brain') + ' Chat health</div>' +
          '<div class="opt" data-a="mem">' + icon('brain') + ' Story memory</div>' +
          '<div class="opt" data-a="fork">' + icon('copy') + ' Fork an alternate timeline</div>' +
          '<div class="opt" data-a="export">' + icon('download') + ' Export transcript</div>' +
          '<div class="opt danger" data-a="del">' + icon('trash') + ' Delete chat</div>',
        onMount: function (b, close) {
          b.querySelectorAll('.opt').forEach(function (el) {
            el.onclick = function () {
              var a = el.getAttribute('data-a');
              close();
              if (a === 'rename') {
                UI.input('Rename chat', { value: s.title || '' }).then(function (v) {
                  if (v === null) return;
                  s.title = v.trim() || 'New chat';
                  s.titleAuto = false;   /* a name you chose is never overwritten (v1.39.0) */
                  Store.putSession(s).then(function () { Views.chats($('.screen')); });
                });
              } else if (a === 'pin') {
                s.pinned = !s.pinned;
                Store.putSession(s).then(function () { Views.chats($('.screen')); });
              } else if (a === 'archive') {
                s.archived = !s.archived;
                if (s.archived) s.pinned = false;
                Store.putSession(s).then(function () { Views.chats($('.screen')); });
              } else if (a === 'settings') App.chatSettingsSheet(id);
              else if (a === 'health') App.chatHealthSheet(id);
              else if (a === 'fork') App.forkTimeline(id);
              else if (a === 'mem') App.memorySheet(id);
              else if (a === 'export') App.exportSheet(id);
              else if (a === 'del') {
                /* v1.21.0 (upstream 18.3.5): the active chat's reply is still
                   generating — deleting it now would orphan the in-flight
                   save. */
                if (App.state.busy && App.state.session && App.state.session.id === id) {
                  return UI.toast('Wait for the current reply or stop it first');
                }
                UI.confirm('Delete this chat?', 'The transcript and its memory will be removed.',
                  { danger: true, okLabel: 'Delete' }).then(function (ok) {
                  if (!ok) return;
                  Store.delSession(id).then(function () {
                    if (App.state.session && App.state.session.id === id && App.state.screen === 'chat') {
                      App.state.screen = null; App.go('chats');
                    } else Views.chats($('.screen'));
                    UI.toast('Chat deleted');
                  });
                });
              }
            };
          });
        }
      });
    });
  };

  App.exportTranscript = function (id) {
    Promise.all([IDB.get('sessions', id), Store.getMessages(id)]).then(function (r) {
      var s = r[0], msgs = r[1];
      return Promise.resolve(Store.getCharacter(s.charId)).then(function (c) {
        var text = '# ' + (c ? c.name : 'Character') + ' — ' + (s.title || 'New chat') + '\n' +
          '# ' + new Date(s.createdAt).toLocaleString() + '\n\n' +
          msgs.map(function (m) {
            return (m.role === 'user' ? Store.settings.userName : (c ? c.name : 'Assistant')) + ': ' + (m.text || '') +
              (m.image ? '\n[image: ' + m.image + ']' : '');
          }).join('\n\n') +
          (s.summary ? '\n\n---\nMemory: ' + s.summary + '\n' + (s.facts || []).map(function (f) { return '- ' + f; }).join('\n') : '');
        UI.download((c ? c.name : 'chat') + '-' + (s.title || 'chat') + '.txt', text, 'text/plain');
      });
    });
  };

  /* ---------------- generation progress ---------------- */
  /* A Horde job can legitimately sit in a queue for minutes, so we show queue
     position, ETA and a live elapsed clock — plus a Cancel that actually works. */
  App.genStart = function (text, controller) {
    App.genInfo = { text: text || 'Working…', eta: 0, started: Date.now(), controller: controller || null };
    App.renderGen();
    App.renderTyping();
    clearInterval(App.genTick);
    App.genTick = setInterval(App.renderGen, 1000);
  };
  App.genSet = function (text, eta) {
    if (!App.genInfo) App.genStart(text);
    App.genInfo.text = text;
    if (eta !== undefined) App.genInfo.eta = eta;
    App.renderGen();
  };
  App.renderGen = function () {
    var b = $('#gen-banner'), i = App.genInfo;
    if (!b || !i) return;
    var el = Math.round((Date.now() - i.started) / 1000);
    var eta = i.eta ? ' · ~' + i.eta + 's left' : '';
    b.hidden = false;
    b.innerHTML = '<span>' + UI.esc(i.text) +
      ' <span style="color:var(--dim)">(' + el + 's' + eta + ')</span></span>' +
      '<button class="chip" data-act="cancel-gen">Cancel</button>';
  };
  App.genStop = function () {
    clearInterval(App.genTick);
    App.genTick = null;
    App.genInfo = null;
    var b = $('#gen-banner');
    if (b) { b.hidden = true; b.innerHTML = ''; }
    App.renderTyping();
  };

  /** The three dots mean "something is happening right now" — a reply on the way,
   *  or a virtual human mid-burst. Nothing else. */
  App.renderTyping = function () {
    var t = $('#typing');
    if (!t) return;
    var working = !!(App.genInfo || App.state.busy || App.state.bursting);
    t.hidden = !(working && App.state.screen === 'chat');
  };

  /* ---------------- generation ---------------- */
  App.generateReply = function (opts) {
    opts = opts || {};
    var st = App.state;
    if (st.busy) return;
    var s = Store.settings;
    var char = st.char, session = st.session;

    if (!s.provider || (s.provider !== 'horde' && !s.model && !s.apiKey)) {
      UI.toast('Set up a provider in Settings first', 3500);
      App.go('settings');
      return;
    }

    var history = st.messages.slice();
    var target = null;

    if (opts.rerollFor) {
      target = opts.rerollFor;
      history = history.filter(function (m) { return m.createdAt < target.createdAt || m.id === target.id; });
      history = history.filter(function (m) { return m.id !== target.id; });
    } else if (opts.continueFor) {
      target = opts.continueFor;
    }

    var msg;
    if (target) {
      msg = target;
      msg._stream = msg.text || '';
    } else {
      msg = { id: UI.uid('m'), sessionId: session.id, role: 'assistant', text: '', alts: [], altIdx: 0, createdAt: Date.now(), _stream: '' };
      st.messages.push(msg);
    }

    var el = Views.appendMessage(char, msg);
    el.classList.add('streaming');
    st.busy = true;
    App.setStop(true);
    /* keep the CPU awake for the whole reply: switching apps or the screen
       going dark otherwise lets Android freeze this process, and the
       in-flight request stops ticking (see js/keepawake.js) */
    if (global.KeepAwake) KeepAwake.hold();

    var vhNote = opts.note || null;
    var charSettings = Object.assign({}, s);
    if (char.systemPrompt) charSettings.systemPrompt = char.systemPrompt;
    if (char.temperature !== null && char.temperature !== undefined) charSettings.temperature = char.temperature;
    if (char.maxTokens) charSettings.maxTokens = char.maxTokens;

    /* v1.39.0 chatwork: the most local layer wins - this chat over this
       character over the global defaults. The chat's own style note joins
       whatever one-off note this generation was asked to hold. */
    var ov = (session && session.overrides) || null;
    if (ov) {
      if (ov.temperature !== null && ov.temperature !== undefined && ov.temperature !== '') charSettings.temperature = ov.temperature;
      if (ov.maxTokens) charSettings.maxTokens = ov.maxTokens;
    }
    var finalNote = [vhNote, ov && ov.note].filter(Boolean).join('\n\n') || null;
    vhNote = finalNote;

    /* v1.21.0 (upstream 18.3.5): a save failure is not a provider failure.
       The model already did its work — a finished reply stays in the thread
       and the storage error is surfaced on its own, instead of the generic
       failure path deleting the reply and offering a re-spent retry. */
    function persist() {
      var save = (opts.rerollFor || opts.continueFor ? Store.updateMessage(msg) : Store.addMessage(msg));
      return save.then(function (r) { return { saved: true }; }, function (e) {
        if (msg.text && msg.text !== '…') {
          msg.saveFailed = true;
          UI.toast('Reply kept on screen, but it could not be saved: ' + (e && e.message), 6000);
          console.error('reply save failed:', e);
          return { saved: false };
        }
        throw e;
      });
    }

    App.abort = new AbortController();
    App.genStart(s.provider === 'horde' ? 'Sending to the Horde…' : 'Generating…', App.abort);

    API.generate({
      settings: charSettings, character: char, session: session, history: history,
      signal: App.abort ? App.abort.signal : undefined,
      note: vhNote,
      onDelta: function (chunk, full) {
        msg._stream = full || ((msg._stream || '') + chunk);
        var mt = el.querySelector('.mtext');
        if (mt) mt.innerHTML = UI.md(msg._stream);
        Views.stickToBottom($('#thread'));
      },
      onProgress: function (info) {
        var txt;
        if (info.state === 'processing') txt = 'Generating on a volunteer GPU…';
        else if (info.state === 'queued') txt = 'Queued on the Horde · position ' + (info.queuePosition || 0);
        else if (info.state === 'rate-limited') txt = 'Horde rate limit — pausing ' + (info.waitTime || 10) + 's';
        else if (info.state === 'retrying') txt = 'Connection blip — retrying…';
        else if (info.state === 'continuing') txt = 'Reply got cut off — finishing it…';
        else if (info.state === 'empty') txt = 'Worker sent nothing — asking another… (' +
          ((info.attempt || 0) + 1) + ' of ' + (info.of || 3) + ')';
        else txt = 'Working…';
        App.genSet(txt, info.waitTime);
      }
    }).then(function (text) {
      text = (text || '').trim();
      App.genStop();
      /* v1.13.0: the reply may end with the character's updated internal
         state — pull it out before the message is stored or shown, and
         keep the character's state current for the next prompt. A reply
         without a usable block changes nothing. */
      if (char.stateTracking && !char.vh) {
        var newState = API.parseState(text);
        if (newState) {
          text = API.stripState(text);
          char.state = {
            mood: newState.mood, intent: newState.intent, flags: newState.flags,
            updatedAt: Date.now(), by: 'model'
          };
          Store.putCharacter(char);
          Views.stateStrip(char);
        }
      }
      msg._stream = null;
      /* A reply came through — a failed send is no longer failed: drop any
         Retry chip still showing in the thread. */
      for (var ri = 0; ri < st.messages.length; ri++) if (st.messages[ri].retry) st.messages[ri].retry = false;
      var chips = document.querySelectorAll('#thread .chip.retry');
      for (var ci = 0; ci < chips.length; ci++) chips[ci].remove();
      if (!text) { text = '…'; }
      if (opts.continueFor) {
        msg.text = (msg.text || '') + (msg.text ? '\n\n' : '') + text;
        if (msg.alts && msg.alts.length) msg.alts[msg.altIdx || 0] = msg.text;
      } else if (opts.rerollFor) {
        msg.text = text;
        msg.alts = msg.alts || [];
        msg.alts.push(text);
        msg.altIdx = msg.alts.length - 1;
      } else {
        msg.text = text;
        msg.alts = [text];
        msg.altIdx = 0;
      }
      el.classList.remove('streaming');
      var parts = App.burstFor(char, text);
      if (parts.length > 1 && !(opts.rerollFor || opts.continueFor)) {
        /* independent short texts arrive as separate bubbles */
        msg.text = parts[0];
        msg.alts = [parts[0]];
        msg.altIdx = 0;
        var mt2 = el.querySelector('.mtext');
        if (mt2) mt2.innerHTML = UI.md(parts[0]);
        return persist().then(function (r) {
          /* if the first bubble could not be saved, the burst parts would
             not be either — keep what is on screen */
          if (!r.saved) return;
          return App.deliverBurst(char, msg, parts);
        });
      }
      return persist();
    }).then(function () {
      if (msg.saveFailed) return;   /* the ledger is down — do not write to it again */
      /* A finished reply must not yank the view to the last word if the
         user scrolled up to read it — follow only when they're at the bottom. */
      Views.stickToBottom($('#thread'));
      App.afterReply();
      App.maybeAutoTitle();
    }).catch(function (e) {
      /* The handler must never throw: if it did, the cleanup below would be
         skipped and the "thinking" dots would run forever. */
      try {
        msg._stream = null;
        App.genStop();
        if (e.name === 'AbortError') {
          if (!msg.text) {
            App.state.messages = App.state.messages.filter(function (m) { return m.id !== msg.id; });
            el.remove();
          } else {
            el.classList.remove('streaming');
            Store.updateMessage(msg).catch(function (e) {
              UI.toast('Partial reply kept on screen, but it could not be saved: ' + (e && e.message), 6000);
            });
          }
          UI.toast('Stopped');
        } else {
          el.remove();
          App.state.messages = App.state.messages.filter(function (m) { return m.id !== msg.id; });
          /* The Horde already tried five workers and all came back blank — offer a
             Retry on the message the user just wrote, so nothing has to be retyped. */
          var lastUser = null;
          for (var i = st.messages.length - 1; i >= 0; i--) {
            if (st.messages[i].role === 'user') { lastUser = st.messages[i]; break; }
          }
          if (lastUser) {
            lastUser.retry = true;
            Views.thread(char, session, st.messages);
          }
          UI.toast('Error: ' + e.message, 6000);
          console.error(e);
        }
      } catch (inner) {
        console.error('reply error handler failed:', inner);
      }
    }).then(function () {
      /* Cleanup always runs, success or failure: a wedged busy flag is
         exactly how the thinking dots never stop. */
      st.busy = false;
      App.abort = null;
      App.setStop(false);
      App.renderTyping();
      if (global.KeepAwake) KeepAwake.release();
    });
  };

  App.afterReply = function () {
    var st = App.state, s = Store.settings;
    if (st.char && st.char.vh && st.char.vh.enabled) {
      VH.noteReply(st.char, '');
      App.persistVH(st.char);
      if (st.screen === 'chat') {
        var stt = VH.status(st.char);
        $('#bar-sub').textContent = stt.text + ' · ' + (st.session ? (st.session.title || 'New chat') : '');
      }
    }
    if (!st.session) return;
    IDB.get('sessions', st.session.id).then(function (sess) {
      if (!sess) return;
      st.session = sess;
      var since = (sess.messageCount || 0) - (sess.memAt || 0);
      if (s.autoMemory && since >= (s.memoryEvery || 14)) App.updateMemory(sess, true);
    });
  };

  App.updateMemory = function (session, silent) {
    var char = App.state.char && App.state.char.id === session.charId ? App.state.char : null;
    return (char ? Promise.resolve(char) : Promise.resolve(Store.getCharacter(session.charId)))
      .then(function (c) {
        return Store.getMessages(session.id).then(function (msgs) {
          return API.summarize({ settings: Store.settings, character: c, session: session, history: msgs });
        }).then(function (mem) {
          session.summary = mem.summary;
          session.facts = mem.facts;
          session.memAt = session.messageCount || 0;
          return Store.putSession(session).then(function () {
            if (!silent) UI.toast('Memory updated');
            else UI.toast('Memory updated (' + mem.facts.length + ' facts)');
          });
        }).catch(function (e) { if (!silent) UI.toast('Memory failed: ' + e.message, 4000); });
      });
  };

  App.setStop = function (on) {
    var b = $('#btn-send');
    b.classList.toggle('stop', !!on);
    b.innerHTML = on
      ? '<svg viewBox="0 0 24 24"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>'
      : '<svg viewBox="0 0 24 24"><path d="M4 12l16-8-6 8 6 8z"/></svg>';
  };

  /* ---------------- authored worlds ---------------- */

  /** Describe a world, get a world: FIVE bounded JSON requests, each at
   * most 480 tokens - under the Horde's 512-token anonymous wall, which the
   * v1.38.1 bench caught the old three-request flow dying against (stages
   * asking 700/800 are rejected outright when the client holds no kudos),
   * and whose model styles spend half their budget pretty-printing; every
   * ask therefore echoes a tiny example object of the exact one-line shape
   * it wants back. The four parts assemble into the same single-tape the
   * old three-part machine made, then run through the SAME HW.parse() an
   * imported file goes through, then HW.save(). Stop-on-failure: a failed
   * part is said so in the status line, nothing partial is saved, and the
   * player presses again. Opening the sheet spends nothing. */
  App.aiCreateWorld = function () {
    var closeRef = null;
    UI.sheet({
      title: 'Create a world with AI',
      body: '<div class="field"><div class="field-head"><label>Describe your world</label></div>' +
        '<textarea class="tall" id="aiw-idea" placeholder="e.g. a drowned city where the streets are canals and the oldest families live in the upper floors, above the water"></textarea>' +
        '<div class="hint">One or two lines is plenty — the model drafts the places, people, factions and rules. Five small requests, spent only when you press Create.</div></div>' +
        '<div id="aiw-status" class="hint" style="margin-top:8px"></div>',
      actions: [
        { label: 'Create (5 requests)', cls: 'primary', close: false, onClick: function (body) {
          var idea = $('#aiw-idea', body).value.trim();
          if (!idea) { UI.toast('Describe the world — even one line'); return; }
          var st = $('#aiw-status', body);
          function status(text) { if (st) st.textContent = text; }
          var stage = '';
          function prog(info) {
            if (!st) return;
            if (info.state === 'queued') st.textContent = stage + ' — queued on the Horde · position ' + (info.queuePosition || 0);
            else if (info.state === 'rate-limited') st.textContent = stage + ' — rate-limited, waiting ' + (info.waitTime || '?') + 's…';
            else st.textContent = stage + ' — the model is writing…';
          }
          var placesShape = JSON.stringify({
            name: 'Harbor of Rust', description: 'Salt wind over drowned docks.', startLocationId: 'loc_pier',
            locations: [{ id: 'loc_pier', name: 'Old Pier', mapType: 'outdoor', parentLocationId: null,
              description: 'Rotted planks, black water',
              exits: [{ to: 'loc_kettle', text: 'to the Salt Kettle' }] }] });
          /* 1 of 4 the places: a connected place you can walk */
          stage = '1 of 5, the places';
          status(stage + '…');
          API.aiJson(Store.settings,
            'You are creating a playable text roleplay world. The player’s direction: ' + idea + '. ' +
            'Preserve that direction exactly — if it describes a dark, strange, oppressive or eccentric ' +
            'place, create that place, not a safe version of it. ' +
            'Answer with the JSON only - the first character you write is {. Compact, single line, no ' +
            'markdown, no commentary. Echo this tiny shape, sized exactly, filling it with your own world: ' +
            placesShape + ' where mapType is one of region|building|outdoor|route|room, parentLocationId is ' +
            'the place it sits inside (null for the top region), every exit to and text names the ' +
            'destination place exactly as written, and the locations array holds exactly 4 places forming ' +
            'one connected place you can walk - every place reaches every other.',
            480, prog).then(function (places) {
            if (!places || !Array.isArray(places.locations) || !places.locations.length) {
              throw new Error('the model sent no places — press Create to try again');
            }
            /* 2 of 4 the people: the cast that lives there */
            stage = '2 of 5, the people';
            status(stage + '…');
            var placeIds = places.locations.map(function (l) { return l.id; }).join(', ');
            var peopleShape = JSON.stringify({
              entities: [{ id: 'npc_mara', name: 'Mara Vess', type: 'npc', isMajor: true,
                description: 'Hollow-eyed tide warden',
                persona: 'Patient and watchful, but she pockets what is not nailed down.',
                goal: 'To keep the toll honest', secrets: 'She takes a cut of every crossing',
                homeLocation: 'loc_pier',
                schedule: [{ time: '08:30', locationId: 'loc_pier', activity: 'On the toll desk', days: ['weekday'] },
                  { time: '20:00', locationId: 'loc_kettle', activity: 'Cards and quiet', days: ['weekday'] }] }],
              factions: [], relationships: [] }) +
              ' where factions is 0-1 of {id:fac_snake,name:string,goal:a few words} and relationships is ' +
              'a few of {a:an entity id,b:an entity id,label:short,score:integer from -100 to 100}';
            return API.aiJson(Store.settings,
              'For the roleplay world ' + (places.name || 'the world') + ' (the player wanted: ' + idea + '), ' +
              'draft its people. The place ids that exist: ' + placeIds + '. ' +
              'Answer with ONE JSON object only, first and last characters curlies. ' +
              'Single line, no markdown, no commentary. ' +
              'Echo this exact shape, filling it with people who belong to that world: ' + peopleShape + ' ' +
              '- all 3 people live inside the ONE entities array of that one object, each with a schedule ' +
              'of 2 entries across one ordinary day, each homeLocation and schedule locationId one of the ' +
              'place ids above.',
              480, prog).then(function (people) {
              if (!people || !Array.isArray(people.entities) || !people.entities.length) {
                throw new Error('the model sent no people — press Create to try again');
              }
              /* 3 of 4 the referee: the voice, the opening */
              stage = '3 of 5, the referee';
              status(stage + '…');
              var locIds = placeIds;
              return API.aiJson(Store.settings,
                'Finish the roleplay world ' + (places.name || 'the world') + '. ' +
                'Answer with ONE JSON object only, first and last characters curlies. Single line, no ' +
                'markdown, no commentary, with exactly these keys: ' +
                JSON.stringify({ dmPrompt: '', intro: '', authorNote: '', kernel: { sceneLocationLimit: 15 } }) + ' ' +
                'where dmPrompt is 120-180 words: you are the showrunner and referee of this world; ' +
                'the core promise that the player can do anything; what persists and what never resets; ' +
                'simulation discipline — honor the clock, exits, who is present, and what characters ' +
                'could plausibly know; player agency — never write the player’s words, thoughts or ' +
                'consent; voice: second person, present tense, concrete, no purple prose. ' +
                'intro is the opening scene, 2-3 sentences, second person present tense, ending on a ' +
                'small hook. authorNote is one sentence on what keeps this world honest. ' +
                'kernel.sceneLocationLimit is an integer 10-30.',
                480, prog).then(function (referee) {
                if (!referee || !referee.dmPrompt) {
                  throw new Error('the model sent no referee prompt — press Create to try again');
                }
                /* 4 of 5 the ways in: the walks, the work, the numbers */
                stage = '4 of 5, the ways in';
                status(stage + '…');
                var waysInShape = JSON.stringify({
                  startingLives: [], startingQuests: [], goalPrograms: [],
                  gameRules: { modules: { quests: true, relationships: true, livingWorld: true } },
                  hudConfig: {} });
                return API.aiJson(Store.settings,
                  'Finish the roleplay world ' + (places.name || 'the world') + ' on the way in. ' +
                  'The place ids that exist: ' + locIds + '. ' +
                  'Answer with ONE JSON object only, first and last characters curlies. Single line, no ' +
                  'markdown, no commentary, with exactly these keys: ' +
                  waysInShape + ' and fill them so: ' +
                  'startingLives is 1-2 of {"id":"origin_main", "name":"a walk-in role such as New Face in Town", ' +
                  '"role":"a few words", "startLocationId":"one of the ids above", "description":"one tight sentence", ' +
                  '"statOverrides":{"stat id":integer}, "obligations":["1-2 short commitments that become open tasks"], ' +
                  '"outfit":"what they wear"}. ' +
                  'startingQuests is 1-2 short open tasks this world really starts with. ' +
                  'goalPrograms is 0 or 1 of {"id":"scheme_snake", "name":"short", "actor":"an entity or faction id", ' +
                  '"steps":["3 short steps, in order"]}. ' +
                  'hudConfig is {"showClock":true, "startWeekday":"Monday", "startTimeHours":8, ' +
                  '"startTimeMinutes":integer 0-59, "timeStep":10, "stats":[3 of {"id":"stat_snake", "name":"string", ' +
                  '"value":integer, "min":0, "max":integer}]}.',
                  480, prog).then(function (/* waysIn */ waysIn) {
                  /* 5 of 5 the book and the bent: skills, classes, lore */
                  stage = '5 of 5, the book and the bent';
                  status(stage + '…');
                  var statIds = (((waysIn && waysIn.hudConfig) || {}).stats || [])
                    .map(function (s) { return s.id; }).join(', ') || 'the stat id';
                  var bookShape = JSON.stringify({ skillsCatalog: [], classes: [], lorebook: [] });
                  return API.aiJson(Store.settings,
                    'Finish the roleplay world ' + (places.name || 'the world') + ' one last time. ' +
                    'The stat ids the world tracks: ' + statIds + '. ' +
                    'Answer with ONE JSON object only, first and last characters curlies. Single line, no ' +
                    'markdown, no commentary, with exactly these keys: ' +
                    bookShape + ' and fill them so: ' +
                    'skillsCatalog is 2-3 of {"id":"skill_snake", "name":"a training a player can really claim, ' +
                    'short words", "description":"one line", "stat":"one of the stat ids the world tracks"}. ' +
                    'classes is 1-2 of {"id":"cls_snake", "name":"string", "description":"one sentence - the bent it ' +
                    'gives a run", "statOverrides":{"the stat id":integer}, "skills":["1-2 skill ids from skillsCatalog"], ' +
                    '"obligations":["0-1 short commitments"], "outfit":"string"}, or an empty array [] if the world ' +
                    'would not wear classes - ask whether the concept even wants them. ' +
                    'lorebook is 3 entries on the names and places of this world, each {"keyword":"a word or short phrase ' +
                    'that will really come up in play - a place name, a family name, an artefact; never a ' +
                    'word that hides inside a longer word", "text":"1-2 sentences of established fact", ' +
                    '"knownBy":"usually empty; npc:an entity id or faction:a faction id or secret, when it is ' +
                    'not general knowledge"}.',
                    480, prog).then(function (book) {
                  /* one tape: the referee, the ways in and the book ARE the
                     rules the old three-part machine knew */
                  var rules = {};
                  Object.keys(referee || {}).forEach(function (k) { rules[k] = referee[k]; });
                  Object.keys(waysIn || {}).forEach(function (k) { rules[k] = waysIn[k]; });
                  Object.keys(book || {}).forEach(function (k) { rules[k] = book[k]; });
                  var world = HW.parse(HW.assemble({ places: places, people: people, rules: rules }));
                  if (!world) {
                    throw new Error('the assembled world was missing its places — press Create to try again');
                  }
                  return HW.save(world).then(function () {
                    UI.toast('Created ' + world.name, 3200);
                    if (closeRef) closeRef();
                    App.go('worlds');
                  });
                });
              });
            });
          });
          }
          ).catch(function (e) {
            status('World draft failed: ' + (e && e.message || e) +
              ' Nothing partial was saved — press Create to try again.');
          });
        } },
        { label: 'Cancel', cls: 'ghost', value: null }
      ],
      onMount: function (b, close) { closeRef = close; }
    });
  };

  App.importWorld = function () {
    Views.pickFile('.horde_world,.json,application/json').then(function (file) {
      if (!file) return null;
      return file.text().then(function (txt) {
        var raw = null;
        try { raw = JSON.parse(txt); } catch (e) { raw = null; }
        if (!raw) { UI.toast('That file is not readable JSON', 4000); return null; }
        var world = HW.parse(raw);
        if (!world) { UI.toast('That is not a .horde_world file', 4500); return null; }
        /* v1.30.0: the world's face comes in with it - give the banner the
           same storage diet as card images (512px long edge) BEFORE it is
           stored, so a 2.5 MB world still arrives small. Web URLs and
           anything undecodable pass through the diet untouched. */
        return Promise.resolve(Views.dietDataUrl(world.banner, 512)).then(function (dieted) {
          if (dieted) world.banner = dieted;
          return HW.save(world);
        }).then(function () {
          UI.toast('Imported ' + world.name, 3200);
          App.go('worlds');
        });
      });
    }).catch(function (e) {
      UI.toast('Could not read that file: ' + (e && e.message), 4500);
    });
  };

  /** Begin a world: pick a role first, if it offers a choice. */
  App.startWorld = function (worldId) {
    HW.get(worldId).then(function (world) {
      if (!world) { UI.toast('That world is not installed'); return; }
      var lives = world.startingLives || [];
      if (lives.length > 1) { Views.worldRoles(world); return; }
      App.beginOrPickClass(worldId, lives.length === 1 ? lives[0].id : null);
    });
  };

  /* v1.38.0: after the life, the class. Worlds without classes pass
     straight through to the begin - no sheet for a question a world
     never asks. */
  App.beginOrPickClass = function (worldId, lifeId) {
    HW.get(worldId).then(function (world) {
      if (!world) { UI.toast('That world is not installed'); return; }
      if ((world.classes || []).length) { Views.worldClasses(world, lifeId); return; }
      App.beginWorld(worldId, lifeId, null);
    });
  };

  App.beginWorld = function (worldId, lifeId, classId) {
    HW.get(worldId).then(function (world) {
      if (!world) return;
      /* v1.39.4: freeze the effective persona into the run - persona
         switching already swaps settings.userName/userPersona in place, so
         this is always the identity the player currently picked. */
      var idname = (Store.settings && Store.settings.userName) || '';
      var idper = (Store.settings && Store.settings.userPersona) || '';
      var run = HW.start(world, lifeId, classId,
        (idname || idper) ? { name: idname, persona: idper } : null);
      return HW.saveRun(run).then(function () { App.openWorldRun(run.id); });
    });
  };

  App.openWorldRun = function (runId) {
    HW.allRuns().then(function (runs) {
      var run = null;
      (runs || []).forEach(function (r) { if (r.id === runId) run = r; });
      if (!run) { UI.toast('That run is gone'); App.go('worlds'); return; }
      return HW.get(run.worldId).then(function (world) {
        if (!world) { UI.toast('That world is not installed'); App.go('worlds'); return; }
        App.state.world = world;
        /* v1.27.1: heal runs saved before the pocket dedup */
        App.state.worldRun = HW.normalizeRun(run);
        /* a world nobody has entered yet opens with its own words */
        if (!run.log.length && world.intro) {
          run.log.push({ role: 'assistant', content: world.intro, at: Date.now() });
          HW.saveRun(run);
        }
        App.go('worldrun');
        Views.worldRun(world, run);
      });
    });
  };

  /** v1.26.0: pick a theme from Settings → Appearance. Applies in place,
     persists the pick, and quietly falls back to midnight for a name the
     theme registry doesn't know (a forward-compat safety, in case an old
     setting survives a world/app mismatch). */
  App.chooseTheme = function (id) {
    if (THEMES.list().indexOf(id) === -1) id = 'midnight';
    Store.settings.theme = id;
    THEMES.apply(id);
    return Store.saveSettings();
  };

  /** v1.25.0: the whole run, in a sheet - the desktop sidebar, on demand.
     The bar button that opens it is above the thread, so it works from
     anywhere in the conversation. A turn finishing while the sheet is
     open re-renders it (finishTurn), so it never shows stale numbers. */
  App.openWorldStatus = function () {
    var world = App.state.world, run = App.state.worldRun;
    if (!world || !run) return;
    App.state.worldStatusOpen = true;
    UI.sheet({
      title: (world.name || 'World') + ' — status',
      body: Views.worldStatusSheet(world, run),
      actions: [
        { label: 'Correct state…', cls: 'ghost', value: 'correct' },
        { label: 'Close', cls: 'ghost', value: null }
      ]
    }).then(function (v) {
      App.state.worldStatusOpen = false;
      if (v === 'correct') App.go('worldcorrect');
    });
  };

  /** One turn: ask the referee, then let the world apply what it reported. */
  App.worldTurn = function () {
    var world = App.state.world, run = App.state.worldRun;
    var input = $('#wr-input');
    if (!world || !run || !input) return;

    var text = input.value.trim();
    if (!text || App.state.worldBusy) return;

    var s = Store.settings;
    if (!s.provider || (s.provider !== 'horde' && !s.model && !s.apiKey)) {
      UI.toast('Set up a provider in Settings first', 3500);
      App.go('settings');
      return;
    }

    /* v1.29.1 - a turn is a transaction.
       Every candidate answer (the first, then the one repair) is judged on
       a deep copy of the run as it stood before the player's words. Only a
       final, validated answer is applied - once - and only then is that
       copy published as the run. A refused answer, a failed repair, an
       empty or echoing reply, a failed save, a stop: none of them leaves a
       quest, a minute, a coin, a companion, or a roll behind. The live run
       is never mutated while the model is talking. */
    var pre = HW.cloneRun(run);
    var base = HW.cloneRun(pre);
    var userLine = { role: 'user', content: text, at: Date.now() };
    base.log.push(userLine);
    /* optimistic display only - the player sees their words immediately;
       if the turn fails, failTurn() brings the pre-turn run back AND the
       words back into the box */
    run.log.push(userLine);
    input.value = '';   /* the words are in the thread now; a failed turn puts them back */
    Views.worldRun(world, run);

    App.state.worldBusy = true;
    if (global.KeepAwake) KeepAwake.hold();
    var typing = $('#wr-typing');
    if (typing) typing.hidden = false;
    /* v1.39.6: no more silent turns. Queue, workers, empties, continuations
       and the revealed text all breathe live into the typing widget - the
       same vocabulary the chats already talk in. */
    var tlabel = $('#wr-typing-label');
    function worldTypingClear() {
      if (tlabel) { tlabel.hidden = true; tlabel.textContent = ''; }
    }
    function worldStatus(txt, waitTime) {
      if (!tlabel) return;
      tlabel.hidden = !txt;
      tlabel.textContent = txt ? (waitTime ? txt + ' (about ' + waitTime + 's)' : txt) : '';
    }
    var wrProgress = function (info) {
      worldStatus(App.worldProgressText(info), info.waitTime);
    };
    /* v1.39.9: the turn in flight can be stopped - same idea as the chat's
       abort, hosted here. A stopped turn is no turn at all (the AbortError
       branch brings the pre-turn state back and returns the words). */
    var wrAbort = new AbortController();
    var wrStop = $('#wr-stop');
    if (wrStop) wrStop.onclick = wrAbort.abort.bind(wrAbort);

    /* v1.29.1: the run object keeps its identity for the whole session -
       the bar, the sheet and the views all hold references to it. A
       candidate's state reaches the player by COPYING the clone's fields
       onto the live run, never by swapping objects. */
    function adopt(next) {
      for (var k in run) {
        if (Object.prototype.hasOwnProperty.call(run, k) &&
            !Object.prototype.hasOwnProperty.call(next, k)) delete run[k];
      }
      for (var k2 in next) {
        if (Object.prototype.hasOwnProperty.call(next, k2)) run[k2] = next[k2];
      }
    }
    function refreshChrome(usePre) {
      var r = usePre ? pre : run;
      if (App.state.screen === 'worldrun') {
        var sub = $('#bar-sub');
        if (sub) sub.textContent = 'turn ' + (r.turn || 0);
      }
      /* v1.25.0: a status sheet left open must not show stale numbers */
      if (App.state.worldStatusOpen) {
        var wrap = document.getElementById('sheet-wrap');
        var sb = document.getElementById('sheet-body');
        if (wrap && !wrap.hidden && sb) sb.innerHTML = Views.worldStatusSheet(world, r);
      }
    }

    /* the turn happened: the validated candidate's state is the run's
       state now (same object, new contents) */
    function publish(next, hud) {
      /* a turn that finishes after the player walked away still SAVED its
         run - but it must not render onto another screen, or write a turn
         count onto another screen's bar (v1.24.1) */
      if (App.state.worldRun !== run) return;
      adopt(next);
      Views.worldRun(world, run, hud);
      refreshChrome(false);
    }

    /* the turn did not happen: the pre-turn state is restored into the run
       (same object), the player's words go back in the box, and they are
       told exactly what stood in the way */
    function failTurn(reason) {
      adopt(pre);
      if (input) input.value = text;
      Views.worldRun(world, run);
      refreshChrome(true);
      UI.toast(reason, 5000);
    }

    /* Judge one candidate answer on a fresh copy of the pre-turn state.
       Never touches the live run. */
    function assess(candidate) {
      var v = HW.validateReply(world, base, text, candidate);
      if (!v.ok) return { ok: false, reasons: v.reasons, candidate: String(candidate || '').trim() };
      var stage = HW.cloneRun(base);
      var applied = HW.applyTags(world, stage, v.text);
      /* v1.20.0: scene discipline - the audit compares the player's words
         with what THIS candidate actually recorded */
      applied.advisories = HW.auditClaims(world, stage, text, applied).advisories;
      /* v1.29.1: a check the world has no definition for cannot be part
         of this turn - refused before it is committed, not after the die
         has already been rolled */
      applied.rejections = applied.rejections.concat(HW.preflightChecks(world, applied));
      var reasons = [];
      if (HW.ledgerV2(world)) {
        applied.rejections.forEach(function (r) { reasons.push(r.tag + ' — ' + r.reason); });
        applied.advisories.forEach(function (a) { reasons.push(a.claim + ' — ' + a.note); });
      }
      if (reasons.length) {
        return { ok: false, reasons: reasons, candidate: v.text, stage: stage, applied: applied };
      }
      return { ok: true, text: v.text, stage: stage, applied: applied };
    }

    /* Commit the one validated candidate. Runs inside the transaction:
       the stage becomes the run only after it has also been saved. */
    function commitTurn(a) {
      HW.commit(a.stage, text, a.text, a.applied);
      /* v1.18.0: the world resolves the checks the final reply requested -
         in the transaction, so the verdict lands in the log right after
         the referee's line, and exactly once per turn even when repaired */
      var res = HW.resolveChecks(world, a.stage, a.applied);
      if (res.rejections.length) {
        a.stage.rejections = (a.stage.rejections || []).concat(res.rejections.map(function (r) {
          return { turn: a.stage.turn, tag: r.tag, reason: r.reason, at: r.at };
        }));
        if (a.stage.rejections.length > 50) a.stage.rejections = a.stage.rejections.slice(-50);
      }
      /* v1.29.1: the receipt for who actually answered this turn */
      if (s.provider === 'horde' && API.lastHorde) {
        a.stage.lastModel = API.lastHorde.model;
        a.stage.lastWorker = API.lastHorde.worker;
      }
      var hud = {
        changes: a.applied.changes.concat(res.changes),
        rejections: a.applied.rejections.concat(res.rejections),
        advisories: a.applied.advisories,
        checks: res.list
      };
      /* v1.39.9: one turn of grace. The pre-turn snapshot travels WITH the
         run so the player can take this turn back (edit & resend). One
         level deep - a snapshot never nests a snapshot of its own. */
      delete pre.lastTurnPre;
      a.stage.lastTurnPre = pre;
      return HW.saveRun(a.stage).then(function () {
        publish(a.stage, hud);
      }, function (err) {
        /* a run that cannot be saved is not a run that happened */
        failTurn('The run could not be saved - the turn was not made. ' +
          ((err && (err.message || err.name)) || ''));
      }).then(function () {
        /* v1.36.0: the story remembers itself. On the persona-chat
           cadence the run quietly asks the model once for a summary and
           facts, then saves the memory so the NEXT prompt carries it.
           Fire and forget: a memory pass must never hold up or fail the
           turn that triggered it. */
        if (s.autoMemory && HW.memoryDue(a.stage, s.memoryEvery || 14)) {
          API.summarizeWorld({ settings: s, world: world, run: a.stage }).then(function (mem) {
            if (!mem || (!mem.summary && (!mem.facts || !mem.facts.length))) return;
            HW.applyMemory(a.stage, mem);
            return HW.saveRun(a.stage);
          }).then(function () { /* the turn is already told; the memory waits for the next one */ }, function () {});
        }
      });
    }

    /* v1.17.0: when the world rejects the referee's bookkeeping, give the
       referee ONE chance to fix it - with the reasons. v1.29.1: the repair
       is judged like any candidate (on a fresh pre-turn copy); a repair
       that is not a valid turn fails the whole turn instead of standing
       the first answer up anyway. */
    function repairOnce(first) {
      /* a candidate that failed validation has no stage; judge the repair
         against the pre-turn state in that case */
      var from = first.stage || base;
      var prompt2 = HW.buildPrompt(world, from, text);
      /* the log alternates user/assistant (it may open with the world's
         intro), so keep each entry's real role; drop any old repair
         instructions that reached the log */
      var msgs = from.log.filter(function (m) { return m.role !== 'correction'; })
        .slice(-12).map(function (m) {
          return { role: m.role === 'user' ? 'user' : 'assistant', text: m.content };
        });
      msgs.push({ role: 'assistant',
                  text: first.candidate || '(the previous answer was empty)' });
      var repair = 'Your previous answer could not be used as a turn. The problems were:\n' +
        first.reasons.map(function (r) { return '- ' + r; }).join('\n') +
        '\nStart from the state of the world BEFORE this turn. Answer the player ONE ' +
        'final time: one complete reply with ALL the bookkeeping tags it needs - and ' +
        'only those. No analysis, no planning notes, no code blocks, no re-reading of ' +
        'the instructions.';
      msgs.push({ role: 'user', text: repair });
      return API.generate({
        settings: s,
        character: {
          id: world.id, name: world.name, persona: '', scenario: '',
          examples: '', lorebook: [], systemPrompt: prompt2.system
        },
        session: { id: run.id },
        history: msgs.map(function (m) {
          return { id: 'w' + Math.random().toString(36).slice(2),
                   role: m.role, text: m.text, createdAt: Date.now() };
        }),
        signal: wrAbort.signal,
        /* the repair is a second full generation - say so, or the player
           thinks the first silence repeated itself */
        onProgress: function (info) {
          worldStatus('Repairing the turn — ' + String(App.worldProgressText(info)).toLowerCase(), info.waitTime);
        }
      }).then(function (reply2) {
        var second = assess(reply2);
        if (!second.ok) {
          failTurn('The referee could not produce a valid turn - nothing changed. ' +
            second.reasons[0]);
          return;
        }
        /* the draft's refusals are part of what happened this turn - the
           ledger says so on the run, not just on the discarded draft */
        if (first.applied && first.applied.rejections.length) {
          second.stage.rejections = first.applied.rejections.map(function (r) {
            return { turn: second.stage.turn, tag: r.tag, reason: r.reason, at: r.at };
          }).concat(second.stage.rejections || []);
        }
        commitTurn(second);
      });
    }

    var built = HW.buildPrompt(world, base, text);
    API.generate({
      settings: s,
      /* the world is the referee: its own prompt is the whole system prompt */
      character: {
        id: world.id, name: world.name, persona: '', scenario: '',
        examples: '', lorebook: [], systemPrompt: built.system
      },
      session: { id: run.id },
      history: built.messages.map(function (m) {
        return { id: 'w' + Math.random().toString(36).slice(2), role: m.role, text: m.content, createdAt: Date.now() };
      }),
      signal: wrAbort.signal,
      onProgress: wrProgress
    }).then(function (reply) {
      /* v1 (opted-out) worlds: assess only refuses here for a broken
         answer (empty, code, planning, echo) - ledger rejections stay
         visible but do not fail the turn, the old leniency */
      var a = assess(reply);
      if (!a.ok) return repairOnce(a);
      return commitTurn(a);
    }).catch(function (e) {
      if (e && e.name === 'AbortError') {
        adopt(pre);
        if (input) input.value = text;
        Views.worldRun(world, run);
        refreshChrome(true);
        UI.toast('Stopped');
        return;
      }
      failTurn('The referee could not answer: ' + (e && e.message));
    }).then(function () {
      App.state.worldBusy = false;
      worldTypingClear();
      if (typing) typing.hidden = true;
      if (global.KeepAwake) KeepAwake.release();
    });
  };

  /** v1.39.9: take the last world turn back (a slip of the thumb is not a
      sentence). Two ways: Edit & resend (the run rewinds and your words
      land back in the box to change) or a plain take-back (same rewind,
      empty field). One level deep, persisted, transactional like the turn
      itself. */
  App.worldUndoMenu = function () {
    var world = App.state.world, run = App.state.worldRun;
    if (!world || !run) return;
    if (App.state.worldBusy) return UI.toast('Wait for the current turn');
    if (!run.lastTurnPre) return UI.toast('Nothing to take back - only the last turn can be rewound');
    var lastUser = null;
    for (var i = run.log.length - 1; i >= 0; i--) {
      if (run.log[i].role === 'user') { lastUser = run.log[i].content; break; }
    }
    UI.sheet({
      title: 'Take back this turn?',
      body: '<div class="opt" data-c="edit">Edit &amp; resend - the world returns to before your turn and your words come back to change</div>' +
            '<div class="opt" data-c="drop">Take this turn back - the world rewinds; type something else</div>',
      onMount: function (b, close) {
        b.querySelectorAll('[data-c]').forEach(function (el) {
          el.onclick = function () {
            var mode = el.getAttribute('data-c');
            close();
            if (mode === 'drop') return App.worldUndoTurn('');
            App.worldUndoTurn(lastUser || '');
          };
        });
      }
    });
  };

  App.worldUndoTurn = function (textForBox) {
    var world = App.state.world, run = App.state.worldRun;
    if (!world || !run) return;
    if (App.state.worldBusy) return UI.toast('Wait for the current turn');
    if (!run.lastTurnPre) return UI.toast('Nothing to take back');
    var snap = run.lastTurnPre;
    delete run.lastTurnPre;
    HW.adoptInto(run, snap);
    run.updatedAt = Date.now();
    var input = $('#wr-input');
    return HW.saveRun(run).then(function () {
      Views.worldRun(world, run);
      if (App.state.screen === 'worldrun') {
        var sub = $('#bar-sub');
        if (sub) sub.textContent = 'turn ' + (run.turn || 0);
      }
      if (input) {
        input.value = textForBox || '';
        if (textForBox) input.focus();
      }
      UI.toast(textForBox ? 'Turn taken back - change your words and send again' : 'Turn taken back');
    }, function (e) {
      UI.toast('The rewind could not be saved: ' + ((e && e.message) || ''), 5000);
    });
  };

  App.send = function () {
    var input = $('#input');
    var text = input.value.trim();
    var stage = App.state.attach || null;
    /* v1.39.0 E: a staged photo is a full message by itself - words optional */
    if ((!text && !stage) || App.state.busy) return;
    var draft = input.value;
    input.value = ''; input.style.height = 'auto';
    if (stage) { App.state.attach = null; App.renderAttach(); }
    var char = App.state.char, session = App.state.session;
    var msg = { sessionId: session.id, role: 'user', text: text, createdAt: Date.now() };
    if (stage) { msg.image = stage.image; msg.imageCaption = stage.caption; }
    Store.addMessage(msg).then(function (m) {
      App.state.messages.push(m);
      Views.appendMessage(char, m);
      Views.stickToBottom($('#thread'), true);   // your own send: always show it
      return App.afterUserMessage(m);
    }).catch(function (e) {
      /* v1.21.0 (upstream 18.3.5): a storage failure is not a failed send —
         give the text back instead of letting it vanish with the box. */
      if (input.value === '') input.value = draft;
      if (stage) { App.state.attach = stage; App.renderAttach(); }   /* give the photo back too */
      UI.toast('Your message was not sent — saving failed: ' + (e && e.message), 6000);
      console.error('send save failed:', e);
    });
  };

  /** What happens once a user message has landed: a fresh user turn
   *  supersedes any earlier Retry offer, virtual humans may answer on
   *  their own schedule, everyone else gets a reply generated now.
   *  Shared by a fresh send and by edit-and-resend. */
  App.afterUserMessage = function (m) {
    for (var ri = 0; ri < App.state.messages.length; ri++) if (App.state.messages[ri].retry) App.state.messages[ri].retry = false;
    var chips = document.querySelectorAll('#thread .chip.retry');
    for (var ci = 0; ci < chips.length; ci++) chips[ci].remove();
    var char = App.state.char, session = App.state.session;
    if (char.vh && char.vh.enabled) {
      VH.noteContact(char, {});
      var delay = VH.replyDelay(char);
      if (delay) {
        session.pending = { askedAt: Date.now(), dueAt: Date.now() + delay * 1000, asleep: VH.isAsleep(char.vh) };
        Store.putSession(session);
        var wait = VH.isAsleep(char.vh)
          ? (char.name + ' is asleep — they will answer around ' + char.vh.sleep.end + '.')
          : (char.name + ' is busy right now (' + (VH.activity(char.vh) || 'occupied') + ').');
        var sys = { sessionId: session.id, role: 'system', text: wait, createdAt: Date.now() };
        return Store.addMessage(sys).then(function (sm) {
          App.state.messages.push(sm);
          Views.appendMessage(char, sm);
          Views.stickToBottom($('#thread'), true);
          App.persistVH(char);
        });
      }
      App.persistVH(char);
    }
    App.generateReply();
  };

  /** Edit-and-resend (user messages): the edited line replaces the old one,
   *  everything said after it is cut, and a fresh reply is generated from
   *  the edit — the phone equivalent of re-sending. Resolves 'busy',
   *  'unchanged', 'cancelled' or undefined once the thread has settled. */
  App.editAndResend = function (msg, text) {
    var st = App.state;
    if (st.busy) return Promise.resolve('busy');
    if (text === (msg.text || '').trim()) return Promise.resolve('unchanged');
    var after = st.messages.slice(st.messages.indexOf(msg) + 1);
    function run() {
      msg.text = text;
      return Store.updateMessage(msg).then(function () {
        var del = after.map(function (x) { return Store.delMessage(x.id); });
        return Promise.all(del).then(function () {
          st.messages = st.messages.slice(0, st.messages.indexOf(msg) + 1);
          /* force the bottom pin: the accepted edit is the new "you were
             here", and the fresh reply lands below it - a mid-thread anchor
             would strand the reader up the thread (v1.28.3). */
          Views.thread(App.state.char, App.state.session, st.messages, null, true);
          return App.afterUserMessage(msg);
        });
      });
    }
    if (!after.length) return run();
    return UI.confirm('Resend from here?',
      'This resends your edited message for a fresh reply and deletes the ' +
      after.length + ' message' + (after.length > 1 ? 's' : '') + ' after it.',
      { danger: true, okLabel: 'Edit & resend' }).then(function (okc) {
        return okc ? run() : Promise.resolve('cancelled');
      });
  };

  /* ---------------- virtual humans ---------------- */
  App.persistVH = function (char) {
    if (!char || !char.vh) return Promise.resolve();
    return Store.putCharacter(char).then(function () { return Store.refreshCharacters(); });
  };

  App.openLatestOrNew = function (charId) {
    Store.getSessions(charId).then(function (sessions) {
      if (sessions && sessions.length) App.openSession(sessions[0].id);
      else App.newChat(charId);
    });
  };

  App.pickVirtualHuman = function () {
    var pool = Store.characters.filter(function (c) { return !(c.vh && c.vh.enabled); });
    if (!pool.length) { UI.toast('Every character is already a virtual human'); return; }
    UI.sheet({
      title: 'Who should get a life?',
      body: pool.map(function (c) {
        return '<div class="opt" data-c="' + c.id + '">' + Views.avatarHtml(c.avatar, c.name) +
          '<span style="flex:1">' + UI.esc(c.name || 'Unnamed') + '</span></div>';
      }).join(''),
      onMount: function (b, close) {
        b.querySelectorAll('[data-c]').forEach(function (el) {
          el.onclick = function () {
            close();
            Promise.resolve(Store.getCharacter(el.getAttribute('data-c'))).then(function (c) {
              VH.ensure(c);
              c.vh.enabled = true;
              c.vh.lastTick = Date.now();
              App.persistVH(c).then(function () {
                UI.toast((c.name || 'Character') + ' is now a virtual human');
                App.editCharacter(c);
              });
            });
          };
        });
      }
    });
  };

  App.vhSettings = function (char) { App.editCharacter(char); };

  /** The whole life, in a sheet: where they are, needs, people, diary, autonomy. */
  App.openLife = function (char) {
    var vh = VH.ensure(char);
    UI.sheet({
      title: (char.name || 'Virtual human') + ' — their life',
      body: Views.lifeSheet(char),
      actions: [{ label: 'Close', cls: 'ghost', value: null }],
      onMount: function (b) {
        b.querySelectorAll('[data-perm]').forEach(function (el) {
          el.onclick = function () {
            var key = el.getAttribute('data-perm');
            vh.perms[key] = !VH.perm(vh, key);
            el.classList.toggle('on', VH.perm(vh, key));
            App.persistVH(char);
          };
        });
        var cap = b.querySelector('#vh-cap'), capV = b.querySelector('#cap-v');
        if (cap) cap.oninput = function () {
          vh.spend.cap = Math.max(0, parseInt(cap.value, 10) || 0);
          if (capV) capV.textContent = vh.spend.cap;
          App.persistVH(char);
        };
        on2(b, '[data-l=export]', 'click', function () { App.exportChoices(char); });
        on2(b, '[data-l=feed]', 'click', function () { App.state.feedFor = char.id; App.go('feed'); });
      }
    });
  };

  /** Template or full export? */
  App.exportChoices = function (char) {
    UI.sheet({
      title: 'Export ' + (char.name || 'this life'),
      body: '<div class="opt" data-k="template"><div style="flex:1"><b>Clean template</b>' +
          '<div class="hint">The person, their places, people and diary. No conversations, no memories of you.</div></div></div>' +
        '<div class="opt" data-k="full"><div style="flex:1"><b>Full portable human</b>' +
          '<div class="hint">Everything, including your chats. Keep it private.</div></div></div>',
      onMount: function (b, close) {
        b.querySelectorAll('[data-k]').forEach(function (el) {
          el.onclick = function () {
            close();
            App.exportHuman(char, el.getAttribute('data-k') === 'full');
          };
        });
      }
    });
  };

  /** Force one unprompted message right now. */
  App.nudge = function (char) {
    if (App.state.busy) return UI.toast('Wait for the current reply');
    if (VH.isAsleep(char.vh)) return UI.toast((char.name || 'They') + ' is asleep right now');
    App.vhOutreach(char, true);
  };

  /* ---------------- message bursts (v18.0.1) ---------------- */
  /**
   * How many separate texts this reply should arrive as. Bursts only apply to a
   * life, and only when the reply genuinely reads as several short messages.
   */
  App.burstFor = function (char, text) {
    var vh = char && char.vh && char.vh.enabled ? VH.ensure(char) : null;
    if (!vh || Store.settings.bursts === false) return [text];
    var parts = API.splitBurst(text, vh.burst || 3);
    return parts.length ? parts : [text];
  };

  /**
   * Save the remaining bubbles of a burst, one after another, the way they'd
   * arrive if a real person were typing them. `first` is already on screen.
   */
  App.deliverBurst = function (char, first, parts, opts) {
    opts = opts || {};
    var rest = parts.slice(1);
    if (!rest.length) return Promise.resolve([first]);
    /* Bubbles keep landing after the generation itself is done, so track them:
       nothing else should start talking over the top of a burst. */
    App.state.bursting = (App.state.bursting || 0) + 1;
    App.renderTyping();
    var done = function () {
      App.state.bursting = Math.max(0, (App.state.bursting || 1) - 1);
      App.renderTyping();
    };
    var chain = Promise.resolve();
    var stamp = first.createdAt || Date.now();
    rest.forEach(function (text) {
      chain = chain.then(function () {
        return new Promise(function (r) { setTimeout(r, 700 + Math.random() * 1100); });
      }).then(function () {
        /* Stagger the arrival, but never date a bubble into the future — otherwise
           anything sent afterwards sorts before it and the transcript reorders itself. */
        stamp = Math.min(Date.now(), stamp + 2000 + Math.floor(Math.random() * 4000));
        var m = {
          id: UI.uid('m'), sessionId: first.sessionId, role: 'assistant', text: text,
          alts: [text], altIdx: 0, createdAt: stamp, burst: first.id,
          autonomous: first.autonomous || opts.autonomous || false
        };
        App.state.messages.push(m);
        if (App.state.screen === 'chat' && App.state.session && App.state.session.id === m.sessionId) {
          Views.appendMessage(char, m);
        }
        return Store.addMessage(m);
      });
    });
    return chain.then(function (r) { done(); return r; }, function (e) { done(); throw e; });
  };

  /**
   * Advance every virtual human by the real time that passed, deliver any reply
   * that has come due, and maybe have someone reach out. Runs on open and every
   * minute while the app is in front of you.
   */
  App.lifeTick = function (opts) {
    opts = opts || {};
    var vhs = Store.characters.filter(function (c) { return c.vh && c.vh.enabled; });
    var dirty = [];
    vhs.forEach(function (c) {
      var r = VH.tick(c);
      if (r.hours > 0.02) dirty.push(c);
    });
    dirty.forEach(function (c) { Store.putCharacter(c); });

    if (App.state.screen === 'now' || App.state.screen === 'life') Views.life($('.screen'));
    if (App.state.screen === 'feed') Views.feed($('.screen'));

    /* pending replies that are due */
    IDB.getAll('sessions').then(function (sessions) {
      (sessions || []).forEach(function (sess) {
        if (!sess.pending) return;
        if (Date.now() < sess.pending.dueAt) return;
        var char = Store.characters.find(function (c) { return c.id === sess.charId; }) || null;
        var load = char ? Promise.resolve(char) : Promise.resolve(Store.getCharacter(sess.charId));
        load.then(function (c) { App.deliverPending(c, sess, opts.force); });
      });
    });

    /* unprompted messages — at most one per tick, and only when idle */
    if (App.state.busy || App.state.bursting) return;
    for (var i = 0; i < vhs.length; i++) {
      var c = vhs[i];
      var act = VH.shouldReachOut(c);
      if (act) { App.vhOutreach(c, false, act.kind); break; }
    }
  };

  /** Generate the reply a virtual human owes you. */
  App.deliverPending = function (char, session, force) {
    if (!session.pending) return;
    if (App.state.busy && !force) return;
    var waited = Date.now() - (session.pending.askedAt || Date.now());
    var wasAsleep = session.pending.asleep;
    session.pending = null;
    Store.putSession(session);

    var openHere = App.state.session && App.state.session.id === session.id && App.state.screen === 'chat';
    if (!openHere) {
      /* Deliver in the background and tell them it landed. */
      Store.getMessages(session.id).then(function (msgs) {
        var note = VH.latenessNote(char, waited, wasAsleep);
        return API.generate({
          settings: Store.settings, character: char, session: session,
          history: msgs.filter(function (m) { return m.role !== 'system'; }), note: note
        }).then(function (text) {
          return Store.addMessage({
            sessionId: session.id, role: 'assistant', text: (text || '').trim(),
            alts: [(text || '').trim()], altIdx: 0, createdAt: Date.now()
          });
        }).then(function () {
          VH.noteReply(char, '');
          App.persistVH(char);
          if (App.state.screen !== 'chat' || !App.state.session || App.state.session.id !== session.id) {
            UI.toast((char.name || 'They') + ' replied — open the chat');
          }
          if (App.state.screen === 'chats') Views.chats($('.screen'));
        }).catch(function (e) { console.error(e); });
      });
      return;
    }

    App.state.session = session;
    App.generateReply({ note: VH.latenessNote(char, waited, wasAsleep) });
  };

  /** They message you first (or send a photo). */
  App.vhOutreach = function (char, forced, kind) {
    if (App.state.busy || App.state.bursting) return;
    var vh = VH.ensure(char);
    kind = kind || 'message';
    var manual = !!forced;
    /* 18.2.0: background life work is separate from the foreground chat.
       Outreach claims a per-character LIFE slot instead of the chat's busy
       flag — the player can send and read while the life runs, and the
       "working…" indicator stays off. A manual nudge is user-initiated, so
       it keeps the foreground flag and the banner. Two different characters
       may run life work at once; one character may not double-generate.
       Every way out of this function has to give the slot back. */
    if (App.state.lifeBusy[char.id]) return;
    App.state.lifeBusy[char.id] = true;
    if (manual) App.state.busy = true;
    function bail() {
      delete App.state.lifeBusy[char.id];
      if (manual) { App.state.busy = false; App.genStop(); }
      App.renderTyping();
    }
    if (kind === 'photo' && !VH.perm(vh, 'photo')) kind = 'message';
    if (kind === 'message' && !VH.perm(vh, 'message')) return bail();
    /* Manual nudges are free; autonomous activity spends the daily budget. */
    if (!manual && !VH.canSpend(vh)) return bail();

    Store.getSessions(char.id).then(function (sessions) {
      var session = sessions[0];
      if (!session) return App.newChat(char.id).then(function () { App.vhOutreach(char, forced, kind); });
      return Store.getMessages(session.id).then(function (msgs) {
        var prompt = VH.outreachPrompt(char, session, msgs, kind);
        var system = (char.persona || '') + '\n\n' + VH.contextLine(char);
        if (manual) App.genStart(kind === 'photo' ? (char.name + ' is sending something…') : (char.name + ' is typing…'));
        return API.generateFree({
          settings: Store.settings, system: system, instruction: prompt,
          name: char.name, maxTokens: kind === 'photo' ? 40 : 90
        }).then(function (text) {
          text = (text || '').trim().replace(/^["\u201c']|["\u201d']$/g, '');
          /* autonomous messages get the same cleanup as replies: trim the model
             writing our lines or handing the pen back */
          text = API.stripThinking(text, (Store.settings || {}).stripThinking !== false);
          text = API.cleanReply(text, char.name, (Store.settings || {}).userName);
          /* 18.0.3: a reply that comes back empty or malformed is a failed
             request — it costs nothing, sends nothing, and falls into the
             backoff below. Never auto-resubmit. */
          if (!text) throw new Error('the model came back empty — nothing was sent, nothing was spent');
          if (!manual) VH.spendOne(vh);
          if (kind === 'photo') return App.vhPhoto(char, session, text, { manual: manual });
          return App.saveAutonomous(char, session, text, { manual: manual });
        });
      });
    }).catch(function (e) {
      try {
        console.error(e);
        /* Back off after a failure: without this a worker that keeps returning
           nothing gets retried on every tick, all day. */
        vh.lastOutreach = Date.now();
        App.persistVH(char);
        UI.toast('Virtual human message failed: ' + e.message, 5000);
      } catch (inner) { console.error('outreach error handler failed:', inner); }
    }).then(function () { bail(); });
  };

  /**
   * Save what they sent you on their own. Short independent texts become separate
   * bubbles, and the whole thing lands in their feed as one post.
   */
  App.saveAutonomous = function (char, session, text, opts) {
    opts = opts || {};
    var vh = VH.ensure(char);
    var parts = App.burstFor(char, text);
    var base = Date.now();
    var first = {
      id: UI.uid('m'), sessionId: session.id, role: 'assistant', text: parts[0],
      alts: [parts[0]], altIdx: 0, autonomous: true, createdAt: base, burst: parts.length > 1 ? UI.uid('b') : null
    };
    VH.feedAdd(vh, {
      ts: base, kind: 'post', text: parts.join(' '), placeId: vh.place, autonomous: true
    });
    vh.lastOutreach = Date.now();
    VH.noteReply(char, '');

    return Store.addMessage(first).then(function (m) {
      App.persistVH(char);
      if (App.state.session && App.state.session.id === session.id && App.state.screen === 'chat') {
        App.state.messages.push(m);
        Views.appendMessage(char, m);
      } else {
        UI.toast((char.name || 'They') + ' sent you a message');
        if (App.state.screen === 'chats') Views.chats($('.screen'));
      }
      return App.deliverBurst(char, m, parts, { autonomous: true });
    });
  };

  /** A photo they send on their own: Horde image + their caption. */
  App.vhPhoto = function (char, session, caption, opts) {
    opts = opts || {};
    var s = Store.settings;
    var vh = VH.ensure(char);
    if (!opts.manual && !VH.perm(vh, 'photo')) return App.saveAutonomous(char, session, caption, opts);
    var prompt = [char.name, (char.persona || '').slice(0, 120), VH.activity(vh), caption].filter(Boolean).join(', ');
    return Horde.generateImage({
      prompt: prompt, model: s.hordeModel, width: 512, height: 512,
      steps: Math.min(s.hordeSteps, 24), apikey: s.hordeKey, maxWait: s.hordeMaxWait,
      onProgress: function (i) {
        App.genSet(
          i.state === 'processing' ? 'Developing the photo…'
            : i.state === 'empty' ? 'Worker sent nothing — asking another…'
            : 'Queued · position ' + (i.queuePosition || 0), i.waitTime);
      }
    }).then(function (res) {
      return fetch(res.url, { mode: 'cors' })
        .then(function (r) { if (!r.ok) throw new Error('download failed'); return r.blob(); })
        .then(function (b) {
          return new Promise(function (resolve) {
            try {
              var fr = new FileReader();
              fr.onload = function () { resolve(fr.result); };
              fr.onerror = function () { resolve(res.url); };
              fr.readAsDataURL(b);
            } catch (e) { resolve(res.url); }   // still show it, just not inlined
          });
        })
        .catch(function () { return res.url; })
        .then(function (src) { return { src: src, meta: res }; });
    }).then(function (out) {
      return Store.addMessage({
        sessionId: session.id, role: 'assistant',
        text: caption + '\n\n_' + (out.meta.model || 'image') + ' · seed ' + (out.meta.seed || '?') +
          ' · by ' + (out.meta.worker || 'a volunteer') + '_',
        image: out.src, autonomous: true, createdAt: Date.now()
      });
    }).then(function (m) {
      VH.feedAdd(vh, { ts: m.createdAt, kind: 'photo', text: caption, image: m.image, placeId: vh.place, autonomous: !opts.manual });
      vh.lastOutreach = Date.now();
      App.persistVH(char);
      if (App.state.session && App.state.session.id === session.id && App.state.screen === 'chat') {
        App.state.messages.push(m);
        Views.appendMessage(char, m);
      } else {
        UI.toast((char.name || 'They') + ' sent you a photo');
      }
    }).catch(function (e) {
      /* If the picture itself fails, they still said something. */
      console.error('vhPhoto failed', e);
      return Store.addMessage({
        sessionId: session.id, role: 'assistant', text: caption,
        alts: [caption], altIdx: 0, autonomous: true, createdAt: Date.now()
      }).then(function (m) {
        vh.lastOutreach = Date.now();
        App.persistVH(char);
        if (App.state.session && App.state.session.id === session.id && App.state.screen === 'chat') {
          App.state.messages.push(m);
          Views.appendMessage(char, m);
        }
      });
    });
  };

  /* ---------------- 18.2.0: storage inspection (mobile subset) ---------------- */
  /**
   * Read-only look at what the app is holding on this phone — the portable
   * part of 18.2.0's "service-wide storage inspection". Pure: takes gathered
   * data, returns display lines, so it is unit-testable and can never write.
   * The app never deletes your data on its own.
   */
  App.storageReport = function (d) {
    function mb(n) { return n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.ceil(n / 1024) + ' KB'; }
    d = d || {};
    var chars = d.characters || [], sessions = d.sessions || [], msgs = d.messages || [], worlds = d.worlds || [];
    var msgBytes = 0, chatImgBytes = 0, avatarBytes = 0, worldBytes = 0;
    var i, m;
    for (i = 0; i < msgs.length; i++) {
      m = msgs[i] || {};
      msgBytes += (m.text || '').length * 2; /* UTF-16 */
      if (m.image && /^data:/.test(m.image)) chatImgBytes += Math.round(m.image.length * 0.75); /* base64 → bytes */
    }
    for (i = 0; i < chars.length; i++) {
      if (chars[i] && chars[i].avatar && /^data:/.test(chars[i].avatar)) avatarBytes += Math.round(chars[i].avatar.length * 0.75);
    }
    for (i = 0; i < worlds.length; i++) {
      try { worldBytes += JSON.stringify(worlds[i]).length * 2; } catch (e) { /* skip broken world */ }
    }
    return {
      bytes: msgBytes + chatImgBytes + avatarBytes + worldBytes,
      lines: [
        ['Conversations', sessions.length + (sessions.length === 1 ? ' chat' : ' chats') + ' · ' + msgs.length + ' messages · ~' + mb(msgBytes)],
        ['Avatar images', '~' + mb(avatarBytes) + ' across ' + chars.length + ' character' + (chars.length === 1 ? '' : 's')],
        ['Chat images', '~' + mb(chatImgBytes)],
        ['Worlds', worlds.length + ' installed · ~' + mb(worldBytes)]
      ]
    };
  };

  /* ---------------- portable lives (v18) ---------------- */
  /**
   * Offer a life as a file. A clean template shares the person and the shape of
   * their life without your conversations; a full export carries the chats too.
   */
  App.exportHuman = function (char, withHistory) {
    var job = withHistory
      ? Store.getSessions(char.id).then(function (sessions) {
          return Promise.all((sessions || []).map(function (sess) { return Store.getMessages(sess.id); }))
            .then(function (lists) {
              var msgs = [];
              (lists || []).forEach(function (l) { msgs = msgs.concat(l || []); });
              return { sessions: sessions || [], messages: msgs };
            });
        })
      : Promise.resolve({ sessions: null, messages: null });

    job.then(function (r) {
      var payload = VH.portable(char, r.sessions, r.messages, withHistory);
      var json = JSON.stringify(payload, null, 2);
      var slug = String(char.name || 'character').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      var file = slug + (withHistory ? '.full' : '') + '.horde_human.json';
      var url = null;
      try { url = URL.createObjectURL(new Blob([json], { type: 'application/json' })); } catch (e) {}

      UI.sheet({
        title: (withHistory ? 'Full portable human' : 'Clean template') + ' · ' + (char.name || ''),
        body: '<p style="margin:0 0 10px;color:var(--muted);font-size:13.5px">' +
          (withHistory
            ? 'Includes the saved life <b>and</b> its conversations — keep it private.'
            : 'The person, their places, people and diary — with no conversation history.') +
          '</p>' +
          '<div class="pill">' + (Math.round(json.length / 1024 * 10) / 10) + ' KB</div>' +
          '<textarea id="exp-json" class="tall" style="margin-top:10px;font-size:11px" readonly>' + UI.esc(json.slice(0, 4000)) +
            (json.length > 4000 ? '\n…' : '') + '</textarea>',
        actions: [
          { label: 'Close', cls: 'ghost', value: null },
          {
            label: 'Copy', cls: 'ghost', close: false, onClick: function (body) {
              var ta = body.querySelector('#exp-json');
              ta.readOnly = true; ta.select(); ta.setSelectionRange(0, 999999);
              try { document.execCommand('copy'); UI.toast('Copied — paste it somewhere safe'); }
              catch (e) { UI.toast('Select the text and copy it'); }
            }
          },
          {
            label: 'Download', cls: 'primary', value: null, onClick: function () {
              if (!url) { UI.toast('Downloads are blocked here — use Copy instead'); return; }
              var a = document.createElement('a');
              a.href = url; a.download = file;
              document.body.appendChild(a); a.click(); a.remove();
              setTimeout(function () { URL.revokeObjectURL(url); }, 5000);
              UI.toast('Saved ' + file);
            }
          }
        ]
      });
    }).catch(function (e) { console.error(e); UI.toast('Export failed: ' + e.message, 5000); });
  };

  /** Read a portable human back in as an isolated copy. */
  App.importHuman = function () {
    Views.pickFile('.json,application/json,.horde_human').then(function (f) {
      if (!f) return;
      var fr = new FileReader();
      fr.onload = function () {
        var payload;
        try { payload = JSON.parse(fr.result); }
        catch (e) { return UI.toast('That file is not valid JSON', 5000); }
        var adopted;
        try { adopted = VH.adopt(payload); }
        catch (e) { return UI.toast(e.message, 5000); }

        var c = adopted.character;
        var bits = [];
        if (c.vh && c.vh.enabled) {
          bits.push((c.vh.places || []).length + ' places');
          bits.push((c.vh.people || []).length + ' people');
          bits.push((c.vh.feed || []).length + ' posts');
        }
        if (adopted.sessions.length) bits.push(adopted.sessions.length + ' chats');
        UI.sheet({
          title: 'Import “' + (c.name || 'unnamed') + '”',
          body: '<p style="margin:0 0 8px;color:var(--muted);font-size:13.5px">' +
            esc((c.persona || '').slice(0, 240)) + '</p>' +
            (bits.length ? '<div class="pill">' + esc(bits.join(' · ')) + '</div>' : '') +
            '<p style="margin:10px 0 0;color:var(--muted);font-size:12.5px">They arrive as a separate copy — ' +
            'nothing you already have is overwritten, and any queued jobs are dropped.</p>',
          actions: [
            { label: 'Cancel', cls: 'ghost', value: null },
            {
              label: 'Import', cls: 'primary', onClick: function () {
                return Store.putCharacter(c).then(function () {
                  var chain = Promise.resolve();
                  adopted.sessions.forEach(function (sess) { chain = chain.then(function () { return Store.putSession(sess); }); });
                  return chain.then(function () {
                    var mchain = Promise.resolve();
                    adopted.messages.forEach(function (m) { mchain = mchain.then(function () { return Store.addMessage(m); }); });
                    return mchain;
                  });
                }).then(function () { return Store.refreshCharacters(); })
                  .then(function () { App.go('characters'); UI.toast('Imported ' + (c.name || 'them')); });
              }
            }
          ]
        });
      };
      fr.onerror = function () { UI.toast('Could not read that file', 4000); };
      fr.readAsText(f);
    });
  };

  /** Fork a conversation into an alternate timeline. */
  App.forkTimeline = function (sessionId) {
    Promise.all([IDB.get('sessions', sessionId), Store.getMessages(sessionId)]).then(function (r) {
      var old = r[0], msgs = r[1];
      var n = (Store.characters.length + 1);
      var s2 = Store.newSession(old.charId, (old.title || 'New chat') + ' · branch');
      s2.timeline = 'branch-' + Date.now().toString(36);
      s2.summary = old.summary || '';
      s2.facts = (old.facts || []).slice();
      return Store.putSession(s2).then(function () {
        var copies = msgs.map(function (m) {
          return Object.assign({}, m, { id: UI.uid('m'), sessionId: s2.id });
        });
        return IDB.putMany('messages', copies).then(function () { App.openSession(s2.id); });
      });
    }).then(function () { UI.toast('Timeline forked — this branch is now independent'); });
  };

  /* ---------------- image generation ---------------- */
  App.imageSheet = function () {
    var s = Store.settings;
    var pickedSize = s.hordeSize;
    var last = App.state.messages.slice(-3).map(function (m) { return m.text; }).join(' ');
    var subject = (App.state.char ? App.state.char.name + ', ' : '') + (App.state.char ? (App.state.char.persona || '').slice(0, 120) : '');
    var suggested = subject || last.slice(0, 160);

    UI.sheet({
      title: 'Generate an image',
      body:
        '<div class="field"><div class="field-head"><label>Prompt</label></div>' +
        '<textarea id="img-prompt" style="min-height:110px">' + esc(suggested) + '</textarea>' +
        '<div class="hint">Sent to the AI Horde — a free, volunteer-run GPU cluster. Expect 20–60 seconds.</div></div>' +
        '<div class="field"><div class="field-head"><label>Model</label><span class="spacer"></span>' +
        '<button class="chip" id="img-model">Choose…</button></div>' +
        '<div class="hint" id="img-model-name">' + esc(s.hordeModel || 'Default') + '</div></div>' +
        '<div class="field"><div class="field-head"><label>Size</label><span class="spacer"></span><span class="val" id="img-size-v">' + s.hordeSize + 'px</span></div>' +
        '<div class="seg" id="img-size">' + [512, 640, 768, 1024].map(function (n) {
          return '<button data-size="' + n + '"' + (n === s.hordeSize ? ' class="on"' : '') + '>' + n + '</button>';
        }).join('') + '</div></div>',
      actions: [
        { label: 'Cancel', cls: 'ghost', value: null },
        { label: 'Generate', cls: 'primary', onClick: function (b) { return b.querySelector('#img-prompt').value.trim(); } }
      ],
      onMount: function (b) {
        b.querySelector('#img-size').onclick = function (e) {
          var t = e.target.closest('button'); if (!t) return;
          pickedSize = parseInt(t.getAttribute('data-size'), 10);
          b.querySelectorAll('#img-size button').forEach(function (x) { x.classList.remove('on'); });
          t.classList.add('on');
          b.querySelector('#img-size-v').textContent = pickedSize + 'px';
        };
        b.querySelector('#img-model').onclick = function () {
          App.chooseHordeModel('image', false).then(function (m) {
            b.querySelector('#img-model-name').textContent = m || 'Any available (fastest)';
          });
        };
      }
    }).then(function (prompt) {
      if (!prompt) return;
      App.runImage(prompt, pickedSize);
    });
  };

  App.runImage = function (prompt, size) {
    var s = Store.settings;
    var ctrl = new AbortController();
    App.abort = ctrl;
    App.genStart('Sending to the Horde…', ctrl);

    return Horde.modelStatus('image', s.hordeModel).then(function (st) {
      if (st && st.count === 0) {
        UI.toast('No workers for “' + s.hordeModel + '” — using any available model', 4000);
        return '';
      }
      return s.hordeModel;
    }).catch(function () { return s.hordeModel; }).then(function (model) {
      return Horde.generateImage({
        prompt: prompt, model: model, width: size, height: size,
        steps: s.hordeSteps, apikey: s.hordeKey, signal: ctrl.signal, maxWait: s.hordeMaxWait,
        onProgress: function (info) {
          if (info.state === 'processing') App.genSet('Painting on a volunteer GPU…', info.waitTime);
          else if (info.state === 'queued') App.genSet('Queued on the Horde · position ' + (info.queuePosition || 0), info.waitTime);
          else if (info.state === 'rate-limited') App.genSet('Horde rate limit — pausing ' + (info.waitTime || 10) + 's', info.waitTime);
          else if (info.state === 'retrying') App.genSet('Connection blip — retrying…', 0);
        }
      });
    }).then(function (res) {
      App.genSet('Downloading image…', 0);
      return fetch(res.url, { mode: 'cors' })
        .then(function (r) { if (!r.ok) throw new Error('download failed'); return r.blob(); })
        .then(function (blob) {
          return new Promise(function (resolve) {
            try {
              var fr = new FileReader();
              fr.onload = function () { resolve(fr.result); };
              fr.onerror = function () { resolve(res.url); };
              fr.readAsDataURL(blob);
            } catch (e) { resolve(res.url); }   // keep the remote URL if we can't inline it
          });
        })
        .catch(function () { return res.url; })
        .then(function (dataOrUrl) {
          var label = '\u{1F3A8} ' + (prompt.length > 140 ? prompt.slice(0, 140) + '…' : prompt);
          var msg = {
            sessionId: App.state.session.id, role: 'assistant',
            text: label + '\n\n_' + res.model + ' · seed ' + res.seed + ' · by ' + (res.worker || 'a volunteer') + '_',
            image: dataOrUrl, createdAt: Date.now()
          };
          return Store.addMessage(msg).then(function (m) {
            App.state.messages.push(m);
            Views.appendMessage(App.state.char, m);
          });
        });
    }).then(function () {
      App.genStop();
      App.abort = null;
    }).catch(function (e) {
      App.genStop();
      App.abort = null;
      if (e.name === 'AbortError') UI.toast('Image cancelled');
      else UI.toast('Image failed: ' + e.message, 6000);
    });
  };

  App.generateAvatar = function (draft) {
    return UI.sheet({
      title: 'Generate avatar',
      body: '<div class="field"><div class="field-head"><label>Prompt</label></div>' +
        '<textarea id="av-prompt" style="min-height:100px">' +
        esc((draft.name || '') + ', portrait, ' + (draft.tagline || '') + ', detailed face, soft lighting, digital painting') +
        '</textarea><div class="hint">Free via AI Horde · takes 20–60s.</div></div>',
      actions: [
        { label: 'Cancel', cls: 'ghost', value: null },
        { label: 'Generate', cls: 'primary', onClick: function (b) { return b.querySelector('#av-prompt').value.trim() || null; } }
      ]
    }).then(function (prompt) {
      if (!prompt) return null;
      UI.toast('Generating on the Horde…');
      var ctrl = new AbortController();
      App.abort = ctrl;
      App.genStart('Generating avatar on the Horde…', ctrl);
      return Horde.generateImage({
        prompt: prompt, model: Store.settings.hordeModel, width: 512, height: 512,
        steps: Math.min(Store.settings.hordeSteps, 30), apikey: Store.settings.hordeKey,
        signal: ctrl.signal, maxWait: Store.settings.hordeMaxWait,
        onProgress: function (i) {
          App.genSet(i.state === 'processing' ? 'Painting…' : 'Queued · position ' + (i.queuePosition || 0), i.waitTime);
        }
      }).then(function (res) {
        return fetch(res.url, { mode: 'cors' }).then(function (r) { return r.blob(); }).then(function (b) {
          return new Promise(function (resolve) {
            var fr = new FileReader();
            fr.onload = function () { resolve(fr.result); };
            fr.onerror = function () { resolve(res.url); };
            fr.readAsDataURL(b);
          });
        }).catch(function () { return res.url; });
      }).then(function (url) { App.genStop(); App.abort = null; UI.toast('Avatar generated'); return url; })
        .catch(function (e) {
          App.genStop(); App.abort = null;
          if (e.name !== 'AbortError') UI.toast('Failed: ' + e.message, 4000);
          return null;
        });
    });
  };

  /* ---------------- model pickers ---------------- */
  function modelSheet(title, items, current, onPick) {
    var rows = items.map(function (m) {
      return typeof m === 'string' ? { value: m, label: m, sub: '' } : m;
    });
    /* Model retention (upstream 18.3.6): if the current model is absent
       from the catalog — provider changed, model retired, exact ID typed
       by hand — pin it to the top so it stays visible and re-selectable. */
    if (current && !rows.some(function (m) { return m.value === current; })) {
      rows.unshift({ value: current, label: current, sub: 'your current model' });
    }
    return UI.sheet({
      title: title,
      body: '<input type="search" id="mf" placeholder="Filter models…" style="width:100%;padding:10px 12px;' +
        'border-radius:11px;border:1px solid var(--line);background:var(--bg-2);margin-bottom:10px">' +
        '<div id="mlist" style="max-height:52vh;overflow-y:auto"></div>',
      dismissible: true,
      onMount: function (b, close) {
        var list = b.querySelector('#mlist');
        function render(q) {
          var f = (q || '').toLowerCase();
          var shown = rows.filter(function (m) {
            return (m.label + ' ' + (m.sub || '')).toLowerCase().indexOf(f) !== -1;
          }).slice(0, 240);
          /* Exact IDs are accepted (upstream 18.3.6): a filter that matches
             nothing offers the typed string itself as a selectable row. */
          var qv = (q || '').trim();
          var exact = qv && !rows.some(function (m) { return m.value === qv; })
            ? [{ value: qv, label: 'Use exactly: ' + qv,
                 sub: 'saved as-is, even if the catalog does not list it' }]
            : [];
          list.innerHTML = (shown.length || exact.length)
            ? shown.concat(exact).map(function (m) {
                return '<div class="opt' + (m.value === current ? ' on' : '') + '" data-m="' + UI.esc(m.value) + '"' +
                  ' style="align-items:flex-start">' +
                  '<span style="flex:1;min-width:0">' +
                    '<span style="display:block' + (m.dim ? ';color:var(--dim)' : '') + '">' + UI.esc(m.label) + '</span>' +
                    (m.sub ? '<span style="display:block;font-size:11.5px;color:var(--dim);margin-top:2px">' +
                      UI.esc(m.sub) + '</span>' : '') +
                  '</span></div>';
              }).join('')
            : '<div class="hint" style="padding:12px">No models match.</div>';
          list.querySelectorAll('[data-m]').forEach(function (el) {
            el.onclick = function () { close(el.getAttribute('data-m')); };
          });
        }
        render('');
        b.querySelector('#mf').oninput = function () { render(this.value); };
      }
      /* v must be a real selection: '' (e.g. "Any available") is a valid
         pick and must save; undefined/null (dismissed) must not. */
    }).then(function (v) { if (v !== undefined && v !== null) onPick(v); return v; });
  }

  /* The model cache is stamped with the provider + endpoint it was
     fetched for (upstream 18.3.6: "a provider switch during discovery
     must not poison the next catalog"). Entries written before the
     stamp existed are bare arrays and are treated as stale. */
  function modelCacheSource(s) {
    return (s.provider || '') + '|' + String(s.baseUrl || '');
  }
  function readModelCache(s) {
    try {
      var raw = JSON.parse(localStorage.getItem('hs-models') || 'null');
      if (raw && raw.source === modelCacheSource(s) && Array.isArray(raw.models)) return raw.models;
    } catch (e) {}
    return null;
  }
  function writeModelCache(s, models) {
    try {
      localStorage.setItem('hs-models', JSON.stringify({ source: modelCacheSource(s), models: models }));
    } catch (e) {}
  }

  App.chooseModel = function (refresh) {
    var s = Store.settings;
    var cached = readModelCache(s);
    if (!refresh && cached && cached.length) {
      return modelSheet('Choose a model', cached, s.model, function (m) {
        Store.saveSettings({ model: m }).then(function () { Views.settings($('.screen')); });
      });
    }
    UI.toast('Fetching models…');
    return API.listModels(s).then(function (models) {
      writeModelCache(s, models);
      UI.closeSheet();
      return modelSheet('Choose a model', models, s.model, function (m) {
        Store.saveSettings({ model: m }).then(function () { Views.settings($('.screen')); });
      });
    }).catch(function (e) {
      UI.closeSheet();
      UI.toast('Could not list models: ' + e.message, 5000);
      return UI.input('Model name', { value: s.model, placeholder: 'e.g. meta-llama/llama-3.1-70b-instruct' })
        .then(function (v) {
          if (!v) return;
          Store.saveSettings({ model: v.trim() }).then(function () { Views.settings($('.screen')); });
        });
    });
  };

  App.chooseHordeModel = function (type, refresh) {
    var s = Store.settings;
    var cacheKey = 'hs-hmodels-' + type;
    var cached = null;
    try { cached = JSON.parse(localStorage.getItem(cacheKey) || 'null'); } catch (e) {}
    var current = type === 'image' ? s.hordeModel : s.hordeTextModel;

    function build(rows) {
      var items = [{
        value: '', label: 'Any available (fastest)',
        sub: 'no model filter — whichever worker is free picks it up'
      }];
      if (type === 'text') {
        items.push({
          value: Horde.ANY_UNCENSORED, label: 'Any available (uncensored)',
          sub: 'only uncensored / abliterated models, whichever is free'
        });
      }
      rows.forEach(function (r) {
        items.push({
          value: r.name, label: r.name, dim: !r.count,
          sub: (r.count ? r.count + ' workers' : 'no workers online') +
               (r.eta ? ' · ETA ' + r.eta + 's' : '') +
               (r.jobs ? ' · ' + r.jobs + ' jobs queued' : '')
        });
      });
      return items;
    }
    function pick(rows) {
      return modelSheet(type === 'image' ? 'Horde image model' : 'Horde text model',
        build(rows), current, function (m) {
          var patch = {}; patch[type === 'image' ? 'hordeModel' : 'hordeTextModel'] = m;
          Store.saveSettings(patch).then(function () { Views.settings($('.screen')); });
        });
    }
    if (!refresh && cached && cached.length) return pick(cached);
    UI.toast('Fetching Horde models…');
    return (type === 'image' ? Horde.listImageModels() : Horde.listTextModels()).then(function (rows) {
      try { localStorage.setItem(cacheKey, JSON.stringify(rows.map(function (r) { return r.name; }))); } catch (e) {}
      UI.closeSheet();
      return pick(rows);
    }).catch(function (e) {
      UI.closeSheet();
      UI.toast('Could not list Horde models: ' + e.message, 4000);
    });
  };

  /* ---------------- memory + lore ---------------- */
  App.memorySheet = function (sessionId) {
    IDB.get('sessions', sessionId).then(function (s) {
      if (!s) return;
      var facts = (s.facts || []).slice();
      function render(body) {
        body.querySelector('#facts').innerHTML = facts.length
          ? facts.map(function (f, i) {
              return '<div class="opt" data-i="' + i + '" style="align-items:flex-start">' + icon('sparkle') +
                '<span style="flex:1">' + esc(f) + '</span></div>';
            }).join('')
          : '<div class="hint" style="padding:6px 2px">No facts stored yet.</div>';
        body.querySelectorAll('#facts [data-i]').forEach(function (el) {
          el.onclick = function () {
            var i = parseInt(el.getAttribute('data-i'), 10);
            UI.confirm('Remove fact?', facts[i]).then(function (ok) {
              if (!ok) return;
              facts.splice(i, 1);
              render(body);
            });
          };
        });
      }
      UI.sheet({
        title: 'Memory · ' + (s.title || 'New chat'),
        body: '<div class="field"><div class="field-head"><label>Summary</label></div>' +
          '<textarea id="sum" class="tall">' + esc(s.summary || '') + '</textarea></div>' +
          '<div class="field"><div class="field-head"><label>Facts</label>' +
          '<span class="spacer"></span><button class="chip" id="addfact">' + icon('plus') + ' Add</button></div>' +
          '<div id="facts"></div></div>' +
          '<div class="field"><div class="row">' +
          '<button class="btn ghost sm" style="flex:1" id="regen">' + icon('refresh') + ' Regenerate with AI</button>' +
          '<button class="btn ghost sm" id="inject">Send to chat</button></div>' +
          '<div class="hint">Auto-summarisation runs every ' + Store.settings.memoryEvery + ' messages when enabled in Settings.</div></div>',
        actions: [
          { label: 'Close', cls: 'ghost', value: null },
          { label: 'Save', cls: 'primary', onClick: function (b) {
              s.summary = b.querySelector('#sum').value.trim();
              s.facts = facts;
              Store.putSession(s);
              UI.toast('Memory saved');
            } }
        ],
        onMount: function (body, close) {
          render(body);
          body.querySelector('#addfact').onclick = function () {
            UI.input('New fact').then(function (v) {
              if (!v) return;
              facts.push(v.trim());
              render(body);
            });
          };
          body.querySelector('#regen').onclick = function () {
            close();
            App.updateMemory(s, false);
          };
          body.querySelector('#inject').onclick = function () {
            close();
            UI.toast('Memory is injected automatically');
          };
        }
      });
    });
  };

  App.editLore = function (char, idx) {
    var entry = idx === null ? { id: UI.uid('l'), keys: [], content: '', enabled: true }
      : char.lorebook[idx];
    UI.sheet({
      title: idx === null ? 'New lore entry' : 'Edit lore entry',
      body: '<div class="field"><div class="field-head"><label>Trigger keywords</label></div>' +
        '<input type="text" id="lk" value="' + esc((entry.keys || []).join(', ')) + '" placeholder="castle, the keep, iron gate"></div>' +
        '<div class="field"><div class="field-head"><label>Content</label></div>' +
        '<textarea id="lc" class="tall">' + esc(entry.content || '') + '</textarea>' +
        '<div class="hint">Injected whenever any keyword appears in recent messages.</div></div>' +
        '<div class="field compact"><label>Enabled</label><div class="toggle' + (entry.enabled !== false ? ' on' : '') + '" id="le"></div></div>',
      actions: [
        { label: 'Cancel', cls: 'ghost', value: null },
        (idx === null ? null : { label: 'Delete', cls: 'danger', onClick: function () {
            char.lorebook.splice(idx, 1);
            Store.putCharacter(char).then(function () { Views.world($('.screen')); UI.toast('Entry removed'); });
          } }),
        { label: 'Save', cls: 'primary', onClick: function (b) {
            entry.keys = b.querySelector('#lk').value.split(',').map(function (k) { return k.trim(); }).filter(Boolean);
            entry.content = b.querySelector('#lc').value;
            if (idx === null) char.lorebook.push(entry);
            Store.putCharacter(char).then(function () { Views.world($('.screen')); UI.toast('Saved'); });
          } }
      ].filter(Boolean),
      onMount: function (b) {
        b.querySelector('#le').onclick = function () {
          entry.enabled = entry.enabled === false;
          this.classList.toggle('on', entry.enabled !== false);
        };
      }
    });
  };

  /* ---------------- install prompt ---------------- */
  App.mountInstall = function () {
    var group = $$('#settings-body .group').pop();
    if (!group || !App.deferredPrompt || $('#btn-install')) return;
    var field = document.createElement('div');
    field.className = 'field';
    field.innerHTML = '<button class="btn primary block sm" id="btn-install">' + icon('download') + ' Install on this phone</button>' +
      '<div class="hint">Adds a home-screen icon and runs full-screen, like a native app.</div>';
    group.appendChild(field);
    $('#btn-install').onclick = function () {
      if (!App.deferredPrompt) return;
      App.deferredPrompt.prompt();
      App.deferredPrompt.userChoice.then(function () { App.deferredPrompt = null; });
    };
  };

  /* ---------------- events ---------------- */
  function bindGlobal() {
    $$('.nav-btn').forEach(function (b) {
      b.onclick = function () { App.go(b.getAttribute('data-go')); };
    });
    $('#btn-back').onclick = App.back;

    $('#btn-bar-action').onclick = function () {
      if (App.state.screen === 'characters') {
        UI.sheet({
          title: 'Cast',
          body: '<div class="opt" data-a="import">' + icon('upload') + ' Import character card</div>' +
                '<div class="opt" data-a="new">' + icon('plus') + ' New character</div>',
          onMount: function (b, close) {
            b.querySelectorAll('.opt').forEach(function (el) {
              el.onclick = function () {
                close();
                if (el.getAttribute('data-a') === 'import') App.importCard();
                else App.editCharacter(null);
              };
            });
          }
        });
      } else if (App.state.screen === 'chat' && App.state.session) {
        App.sessionMenu(App.state.session.id);
      } else if (App.state.screen === 'worldrun') {
        App.openWorldStatus();
      }
    };

    $('#btn-add-char').onclick = function () { App.editCharacter(null); };
    $('#char-search').oninput = function () {
      App.state.query = this.value;
      Views.characters($('.screen'));
    };
    /* v1.39.0 boot wiring: chat search, photo staging, chat backup import */
    var _chs = $('#chat-search');
    if (_chs) _chs.oninput = function () {
      App.state.chatSearch = _chs.value;
      Views.chats($('.screen'));
    };
    var _att = $('#send-attach');
    if (_att) _att.onclick = function () { App.stageAttach(); };
    var _imp = $('#chats-import');
    if (_imp) _imp.onclick = function () { App.importChat(); };

    var input = $('#input');
    input.addEventListener('input', function () {
      this.style.height = 'auto';
      this.style.height = Math.min(this.scrollHeight, 120) + 'px';
    });
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey && Store.settings.sendOnEnter) {
        e.preventDefault(); App.send();
      }
    });
    $('#btn-send').onclick = function () {
      if (App.state.busy) {
        if (App.abort) App.abort.abort();
        return;
      }
      App.send();
    };

    var wrSend = $('#wr-send'), wrInput = $('#wr-input');
    if (wrSend) wrSend.onclick = function () { App.worldTurn(); };
    /* v1.39.9: the pencil on the last own world bubble */
    var wrThread = $('#wr-thread');
    if (wrThread) wrThread.addEventListener('click', function (e) {
      if (e.target.closest('[data-act=wr-edit-turn]') && App.worldUndoMenu) App.worldUndoMenu();
    });
    if (wrInput) wrInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); App.worldTurn(); }
    });
    $('#btn-img').onclick = App.imageSheet;

    /* Cancel inside the progress banner stops whichever job is running. */
    $('#gen-banner').addEventListener('click', function (e) {
      if (!e.target.closest('[data-act=cancel-gen]')) return;
      if (App.genInfo && App.genInfo.controller) App.genInfo.controller.abort();
      else if (App.abort) App.abort.abort();
      App.genStop();
    });

    /* message actions */
    $('#thread').addEventListener('click', function (e) {
      var light = e.target.closest('[data-lightbox]');
      if (light) { UI.lightbox(light.getAttribute('data-lightbox')); return; }
      var btn = e.target.closest('[data-act]');
      if (!btn) return;
      var wrap = e.target.closest('.msg');
      var mid = wrap.getAttribute('data-mid');
      var msg = App.state.messages.find(function (m) { return m.id === mid; });
      if (!msg) return;
      var act = btn.getAttribute('data-act');

      if (act === 'edit') {
        UI.input('Edit message', { value: msg.text || '', multiline: true }).then(function (v) {
          if (v === null) return;
          if (!v || !v.trim()) return UI.toast('The message can’t be empty');
          v = v.trim();
          if (msg.role === 'user') {
            /* User message: edit-and-resend. A plain in-place edit would
               leave the replies stranded, so a changed edit cuts what comes
               after and generates a fresh reply; an unchanged one does
               nothing and spends no request. */
            if (App.state.busy) return UI.toast('Wait for the current reply');
            App.editAndResend(msg, v);
            return;
          }
          msg.text = v;
          if (msg.alts && msg.alts.length) msg.alts[msg.altIdx || 0] = v;
          Store.updateMessage(msg).then(function () { Views.thread(App.state.char, App.state.session, App.state.messages); });
        });
      } else if (act === 'del') {
        UI.confirm('Delete this message?', '', { danger: true, okLabel: 'Delete' }).then(function (ok) {
          if (!ok) return;
          Store.delMessage(msg.id).then(function () {
            App.state.messages = App.state.messages.filter(function (m) { return m.id !== msg.id; });
            Views.thread(App.state.char, App.state.session, App.state.messages);
          });
        });
      } else if (act === 'copy') {
        if (navigator.clipboard) navigator.clipboard.writeText(msg.text || '');
        UI.toast('Copied');
      } else if (act === 'reroll') {
        if (App.state.busy) return UI.toast('Wait for the current reply');
        App.generateReply({ rerollFor: msg });
      } else if (act === 'rerollnote') {
        if (App.state.busy) return UI.toast('Wait for the current reply');
        UI.input('Steer the reroll', { placeholder: 'e.g. shorter, gentler, more hearts' }).then(function (note) {
          if (note === null) return;
          App.generateReply({ rerollFor: msg, note: 'Reroll instruction: ' + note.trim() });
        });
      } else if (act === 'say') {
        App.speakMessage(msg, btn);
      } else if (act === 'retry') {
        if (App.state.busy) return UI.toast('Wait for the current reply');
        /* Same message, fresh attempt: the Horde re-dispatches to whatever
           worker is free. */
        msg.retry = false;
        App.generateReply();
      } else if (act === 'cont') {
        if (App.state.busy) return UI.toast('Wait for the current reply');
        App.generateReply({ continueFor: msg });
      } else if (act === 'swipe') {
        var dir = parseInt(btn.getAttribute('data-dir'), 10);
        var n = msg.alts.length;
        msg.altIdx = ((msg.altIdx || 0) + dir + n) % n;
        msg.text = msg.alts[msg.altIdx];
        Store.updateMessage(msg).then(function () { Views.thread(App.state.char, App.state.session, App.state.messages); });
      }
    });

    /* Virtual humans advance on real time: catch up when the app is opened,
       when it comes back to the foreground, and every minute while you're here. */
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) App.lifeTick();
    });
    setInterval(function () { if (!document.hidden) App.lifeTick(); }, 60000);

    window.addEventListener('beforeinstallprompt', function (e) {
      e.preventDefault();
      App.deferredPrompt = e;
      if (App.state.screen === 'settings') App.mountInstall();
    });
  }

  /* Called by the Android wrapper when the system Back button is pressed.
     Returns true if the web UI handled it. */
  global.__hsBack = function () {
    var sheetWrap = $('#sheet-wrap');
    if (sheetWrap && !sheetWrap.hidden) { UI.closeSheet(); return true; }
    if (App.state.screen === 'chat' || App.state.screen === 'editor') { App.back(); return true; }
    return false;
  };

  /* ---------------- boot ---------------- */
  document.addEventListener('DOMContentLoaded', function () {
    Store.init().then(function () {
      /* v1.26.0: wear the saved theme before the first paint */
      THEMES.apply((Store.settings && Store.settings.theme) || 'midnight');
      bindGlobal();
      App.go('characters');
      var boot = $('#boot');
      boot.classList.add('gone');
      setTimeout(function () { App.lifeTick(); }, 600);
      setTimeout(function () { boot.remove(); }, 500);
      if ('serviceWorker' in navigator && location.protocol !== 'file:') {
        navigator.serviceWorker.register('sw.js').catch(function () {});
      }
    }).catch(function (e) {
      document.getElementById('boot').innerHTML =
        '<div style="padding:24px;text-align:center;color:#f87171">Storage failed to open:<br>' + esc(e.message) + '</div>';
      console.error(e);
    });
  });

  global.App = App;
})(window);
