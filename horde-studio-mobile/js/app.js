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
    state: { screen: 'characters', query: '', tag: '', worldChar: null, messages: [], char: null, session: null, busy: false, lifeBusy: {} },
    stack: [],
    abort: null,
    deferredPrompt: null
  };

  /* ---------------- routing ---------------- */
  var TITLES = { characters: 'Horde Studio', now: 'Now', chats: 'Conversations', world: 'World', settings: 'Settings' };

  App.go = function (name, params) {
    params = params || {};
    if (name === 'now') name = 'life';                 // v1.x name for the Life screen
    if (name !== App.state.screen) App.stack.push(App.state.screen);
    App.state.screen = name;

    $$('.screen').forEach(function (el) { el.hidden = el.getAttribute('data-screen') !== name; });
    App.renderTyping();
    $$('.nav-btn').forEach(function (b) { b.classList.toggle('active', b.getAttribute('data-go') === name); });

    var back = $('#btn-back'), act = $('#btn-bar-action');
    back.hidden = !(name === 'chat' || name === 'editor' || name === 'worldrun');
    act.hidden = !(name === 'chat' || name === 'characters');
    if (name === 'chat') act.setAttribute('aria-label', 'Conversation options');

    if (name === 'settings') {
      $('#bar-title').textContent = 'Settings';
      $('#bar-sub').textContent = '';
      Views.settings($('.screen'));
      App.mountInstall();
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
    } else if (name === 'editor') {
      $('#bar-title').textContent = params.isNew ? 'New character' : 'Edit character';
      $('#bar-sub').textContent = '';
      Views.editor($('.screen'), params.char);
    }
    window.scrollTo(0, 0);
  };

  App.back = function () {
    var prev = App.stack.pop() || 'characters';
    App.state.screen = null;
    App.go(prev);
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
    Store.delCharacter(id).then(function () {
      UI.toast('Character deleted');
      App.state.screen = null;
      App.go('characters');
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
          /* Stay where we were — this is reachable from Settings too. */
          App.go(was === 'settings' ? 'settings' : 'characters');
        });
    });
  };

  App.switchTo = function (id) {
    var was = App.state.screen;
    Store.switchPersona(id || '').then(function (p) {
      UI.toast(p ? 'Now playing as ' + (p.name || 'Unnamed')
                 : 'Back to ' + (Store.settings.defaultName || 'You'));
      App.state.screen = null;
      App.go(was === 'settings' ? 'settings' : 'characters');
    });
  };

  App.deletePersona = function (id) {
    var p = (Store.personas || []).find(function (x) { return x.id === id; });
    if (!p) return;
    UI.confirm('Delete persona “' + (p.name || 'Unnamed') + '”?',
      'Every chat this persona had with every character goes too. Your other personas are untouched.',
      { danger: true, okLabel: 'Delete' }).then(function (ok) {
        if (!ok) return;
        Store.delPersona(id).then(function (n) {
          UI.toast('Persona deleted' + (n ? ' · ' + n + (n === 1 ? ' chat' : ' chats') + ' removed' : ''));
          App.state.screen = null;
          App.go('settings');
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
      /* In Settings, refresh just the row heading instead of re-rendering the
         whole screen, which would throw away the caret and scroll position. */
      if (App.state.screen === 'settings' && patch.name !== undefined) {
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
      }).catch(function (e) { UI.toast('Import failed: ' + e.message, 4000); });
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

  App.sessionMenu = function (id) {
    IDB.get('sessions', id).then(function (s) {
      if (!s) return;
      UI.sheet({
        title: s.title || 'New chat',
        body:
          '<div class="opt" data-a="rename">' + icon('edit') + ' Rename</div>' +
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
                  Store.putSession(s).then(function () { Views.chats($('.screen')); });
                });
              } else if (a === 'fork') App.forkTimeline(id);
              else if (a === 'mem') App.memorySheet(id);
              else if (a === 'export') App.exportTranscript(id);
              else if (a === 'del') {
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

    var vhNote = opts.note || null;
    var charSettings = Object.assign({}, s);
    if (char.systemPrompt) charSettings.systemPrompt = char.systemPrompt;
    if (char.temperature !== null && char.temperature !== undefined) charSettings.temperature = char.temperature;
    if (char.maxTokens) charSettings.maxTokens = char.maxTokens;

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
        return Store.addMessage(msg).then(function () {
          return App.deliverBurst(char, msg, parts);
        });
      }
      return (opts.rerollFor || opts.continueFor ? Store.updateMessage(msg) : Store.addMessage(msg));
    }).then(function () {
      /* A finished reply must not yank the view to the last word if the
         user scrolled up to read it — follow only when they're at the bottom. */
      Views.stickToBottom($('#thread'));
      App.afterReply();
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
            Store.updateMessage(msg);
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

  /** Describe a world, get a world: THREE bounded JSON requests, each under
   * the Horde's 512-token anonymous limit (places, people, rules), joined by
   * HW.assemble and run through the SAME HW.parse() an imported file goes
   * through, then HW.save(). Stop-on-failure: a failed part is said so in the
   * status line, nothing partial is saved, and the player presses again.
   * Opening the sheet spends nothing. */
  App.aiCreateWorld = function () {
    var closeRef = null;
    UI.sheet({
      title: 'Create a world with AI',
      body: '<div class="field"><div class="field-head"><label>Describe your world</label></div>' +
        '<textarea class="tall" id="aiw-idea" placeholder="e.g. a drowned city where the streets are canals and the oldest families live in the upper floors, above the water"></textarea>' +
        '<div class="hint">One or two lines is plenty — the model drafts the places, people, factions and rules. Three small requests, spent only when you press Create.</div></div>' +
        '<div id="aiw-status" class="hint" style="margin-top:8px"></div>',
      actions: [
        { label: 'Create (3 requests)', cls: 'primary', close: false, onClick: function (body) {
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
          /* 1/3 the places: a connected place you can walk */
          stage = '1 of 3, the places';
          status(stage + '…');
          API.aiJson(Store.settings,
            'You are creating a playable text roleplay world. The player\'s direction: "' +
            idea + '". Preserve that direction exactly — if it describes a dark, strange, ' +
            'oppressive or eccentric place, create that place, not a safe version of it. ' +
            'Return ONLY a JSON object, no markdown, no commentary, with exactly these keys: ' +
            '{"name":string (the world\'s title), ' +
            '"description":string (2-3 sentences), ' +
            '"startLocationId":string (the id of the first room), ' +
            '"locations":[{"id":"loc_snake","name":string,"mapType":"region|building|outdoor|route|room","parentLocationId":string or null (the place it is inside of, null for the top region),"description":string (1-2 sentences),"exits":[{"text":"to <place name>","travelTime":integer minutes,"isOneWay":false}]}, 5-7 places that form one connected place you can walk, with exits between them]}',
            480, prog).then(function (places) {
              if (!places || !Array.isArray(places.locations) || !places.locations.length) {
                throw new Error('the model sent no places — press Create to try again');
              }
              /* 2/3 the people: the cast that lives there */
              stage = '2 of 3, the people';
              status(stage + '…');
              return API.aiJson(Store.settings,
                'For the roleplay world "' + (places.name || '') + '" (the player wanted: "' +
                idea + '"), draft its people. ' +
                'Return ONLY a JSON object, no markdown, no commentary, with exactly these keys: ' +
                '{"entities":[{"id":"npc_snake","name":string,"type":"npc","isMajor":boolean,"description":string (1-2 sentences),"persona":string (2-3 sentences, with a real flaw),"goal":string (one sentence),"secrets":string (one sentence)}, 3-4 of them, fitting that world], ' +
                '"factions":[{"id":"fac_snake","name":string,"description":string (one sentence)}, 1-3], ' +
                '"relationships":[{"a":"npc_id","b":"npc_id","label":string (short),"score":integer from -100 to 100}, 3-6 pairs between the entities above]}',
                480, prog).then(function (people) {
                  if (!people || !Array.isArray(people.entities) || !people.entities.length) {
                    throw new Error('the model sent no people — press Create to try again');
                  }
                  /* 3/3 the rules: the referee, the opening, how to begin */
                  stage = '3 of 3, the rules';
                  status(stage + '…');
                  var locIds = places.locations.map(function (l) { return l.id; }).join(', ');
                  return API.aiJson(Store.settings,
                    'Finish the roleplay world "' + (places.name || '') + '". The place ids that exist: ' +
                    locIds + '. Return ONLY a JSON object, no markdown, no commentary, with exactly these keys: ' +
                    '{"dmPrompt":string (150-220 words: you are the showrunner and referee of this world; the core promise that the player can do anything; what persists and what never resets; simulation discipline — honor the clock, exits, who is present, and what characters could plausibly know; player agency — never write the player\'s words, thoughts or consent; voice: second person, present tense, concrete, no purple prose), ' +
                    '"intro":string (the opening scene, 3-5 sentences, second person present tense, ending on a small hook), ' +
                    '"authorNote":string (one sentence on what keeps this world honest), ' +
                    '"startingLives":[{"id":"origin_main","name":string (a walk-in role such as "New Face in Town"),"role":string (one sentence),"startLocationId":string (one of the ids listed above),"description":string (1-2 sentences)}], ' +
                    '"gameRules":{"modules":{"quests":true,"relationships":true,"livingWorld":true}}, ' +
                    '"hudConfig":{"showClock":true,"startWeekday":"Monday","startTimeHours":8,"timeStep":10}}',
                    480, prog).then(function (rules) {
                      if (!rules || !rules.dmPrompt) {
                        throw new Error('the model sent no referee prompt — press Create to try again');
                      }
                      var world = HW.parse(HW.assemble({
                        places: places, people: people, rules: rules
                      }));
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
        return HW.save(world).then(function () {
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
      App.beginWorld(worldId, lives.length === 1 ? lives[0].id : null);
    });
  };

  App.beginWorld = function (worldId, lifeId) {
    HW.get(worldId).then(function (world) {
      if (!world) return;
      var run = HW.start(world, lifeId);
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
        App.state.worldRun = run;
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

    input.value = '';
    var built = HW.buildPrompt(world, run, text);
    run.log.push({ role: 'user', content: text, at: Date.now() });
    Views.worldRun(world, run);

    App.state.worldBusy = true;
    var typing = $('#wr-typing');
    if (typing) typing.hidden = false;

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
      })
    }).then(function (reply) {
      var applied = HW.applyTags(world, run, (reply || '').trim() || '…');
      HW.commit(run, text, applied.text, applied);
      return HW.saveRun(run).then(function () {
        Views.worldRun(world, run, applied.changes);
      });
    }).catch(function (e) {
      if (e && e.name === 'AbortError') { UI.toast('Stopped'); return; }
      UI.toast('The referee could not answer: ' + (e && e.message), 5000);
    }).then(function () {
      App.state.worldBusy = false;
      if (typing) typing.hidden = true;
    });
  };

  App.send = function () {
    var input = $('#input');
    var text = input.value.trim();
    if (!text || App.state.busy) return;
    input.value = ''; input.style.height = 'auto';
    var char = App.state.char, session = App.state.session;
    var msg = { sessionId: session.id, role: 'user', text: text, createdAt: Date.now() };
    Store.addMessage(msg).then(function (m) {
      App.state.messages.push(m);
      Views.appendMessage(char, m);
      Views.stickToBottom($('#thread'), true);   // your own send: always show it
      return App.afterUserMessage(m);
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
          Views.thread(App.state.char, App.state.session, st.messages);
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
          list.innerHTML = shown.length
            ? shown.map(function (m) {
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
    }).then(function (v) { if (v && onPick) onPick(v); return v; });
  }

  App.chooseModel = function (refresh) {
    var s = Store.settings;
    var cached = null;
    try { cached = JSON.parse(localStorage.getItem('hs-models') || 'null'); } catch (e) {}
    if (!refresh && cached && cached.length) {
      return modelSheet('Choose a model', cached, s.model, function (m) {
        Store.saveSettings({ model: m }).then(function () { Views.settings($('.screen')); });
      });
    }
    UI.toast('Fetching models…');
    return API.listModels(s).then(function (models) {
      try { localStorage.setItem('hs-models', JSON.stringify(models)); } catch (e) {}
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
      }
    };

    $('#btn-add-char').onclick = function () { App.editCharacter(null); };
    $('#char-search').oninput = function () {
      App.state.query = this.value;
      Views.characters($('.screen'));
    };

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
