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

  /* Keep failed in-chat generations readable after their transient toast
     disappears. Store metadata and the provider error only—never prompts,
     replies, or credentials. The native log keeps at most 200 entries. */
  function logChatGenerationFailure(err, character, settings) {
    if (!err || err.name === 'AbortError') return;
    try {
      if (!global.Logs || !Logs.push) return;
      settings = settings || Store.settings || {};
      var preset = Store.PRESETS && Store.PRESETS[settings.provider];
      var provider = (preset && preset.label) || settings.provider || 'unknown provider';
      var model = settings.provider === 'horde'
        ? (settings.hordeTextModel || 'AI Horde')
        : (settings.model || 'model not selected');
      var detail = App.redactCredentials(String(err.message || err).replace(/\s+/g, ' ').trim());
      var parts = ['chat response failed', 'provider ' + provider, 'model ' + model];
      if (character && character.name) parts.push('character ' + character.name);
      if (err.status) parts.push('HTTP ' + err.status);
      parts.push(detail || err.name || 'unknown error');
      Logs.push(parts.join(' | '), 1200);
    } catch (e) { /* logging must never interfere with generation cleanup */ }
  }

  /* The Retry chip belongs to its failed user message, so persist the marker
     with that record. Removing it is persisted too, preventing stale chips
     from returning after the chat is reopened. */
  function persistRetryMarker(message, pending) {
    if (!message) return Promise.resolve();
    if (pending) message.retry = true;
    else delete message.retry;
    try {
      return Promise.resolve(Store.updateMessage(message)).catch(function (e) {
        console.error('retry marker save failed:', e);
        UI.toast('Could not save the Retry button: ' + (e && e.message || 'storage error'), 6000);
      });
    } catch (e) {
      console.error('retry marker save failed:', e);
      UI.toast('Could not save the Retry button: ' + (e && e.message || 'storage error'), 6000);
      return Promise.resolve();
    }
  }

  function clearRetryMarkers(messages) {
    var writes = [];
    (messages || []).forEach(function (message) {
      if (message && message.retry) writes.push(persistRetryMarker(message, false));
    });
    return Promise.all(writes);
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
      var groupMembers = App.state.groupCharacters || [];
      var isGroup = groupMembers.length > 1;
      $('#bar-title').textContent = isGroup ? 'Group chat' : ((ch && ch.name) || 'Chat');
      $('#bar-sub').textContent = App.chatSubtitle();
      if (isGroup) $('#char-state').hidden = true; else Views.stateStrip(ch);
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
            /* v1.39.112: import notes are persisted on the character, so they
               survive the toast timeout. A bulk import used to lose them
               entirely; now every card keeps its own, readable here. */
            (c.importNotes && c.importNotes.length
              ? '<div class="opt" data-a="notes">' + icon('eye') + ' Import notes (' + c.importNotes.length + ')</div>'
              : '') +
            /* v1.44.0: the card's own dates and its author's note, shown apart
               from the import notes because they are not a loss — they are what
               the file claims, which is the thing to check when two copies of a
               card disagree or an update lands. */
            (Store.cardDeclared && Store.cardDeclared(c)
              ? '<div class="opt" data-a="file">' + icon('eye') + ' From the card file</div>'
              : '') +
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
                else if (a === 'notes') {
                  UI.sheet({
                    title: 'Import notes — ' + (c.name || 'character'),
                    body: '<p class="hint" style="margin:0 0 8px">What this card carries that the app does not. Nothing was blocked; these are the losses to know about.</p>' +
                      c.importNotes.map(function (n) {
                        return '<div class="hint" style="margin-top:4px">• ' + esc(n) + '</div>';
                      }).join(''),
                    actions: [{ label: 'Close', cls: 'ghost', value: null }]
                  });
                }
                else if (a === 'file') {
                  App.cardFileNotes(c);
                }
                else if (a === 'makevh' || a === 'vh') {
                  VH.ensure(c);
                  c.vh.enabled = true;
                  App.persistVH(c).then(function () { App.editCharacter(c); });
                }
                else if (a === 'export') {
                  var exported = Store.characterToCard(c);
                  /* Item 1 of the compatibility letter: never claim a lossless
                     conversion. Text survives whole now, but a picture the app
                     never imported (a background, a lorebook entry image) has
                     nowhere to come back from, and saying nothing about that
                     would be a false promise. */
                  var lost = Store.cardUnrestoredImages(c, exported);
                  if (lost.length) {
                    UI.toast(lost.length + ' embedded image' + (lost.length === 1 ? '' : 's') +
                      ' in the card is not carried into this export — the text is complete, ' +
                      'the pictures are not', 6000);
                  }
                  /* v1.41.0 (review issue 3): the other thing an export can miss.
                     Said here as well as at import, because this is the moment it
                     matters and the only moment the user can still keep the file. */
                  var gaps = Store.cardSourceGaps ? Store.cardSourceGaps(c) : [];
                  if (gaps.length) {
                    UI.toast('This export is short ' + gaps.length + ' part' + (gaps.length === 1 ? '' : 's') +
                      ' of the card this app could not preserve: ' + gaps.slice(0, 3).join('; ') +
                      (gaps.length > 3 ? '…' : ''), 8000);
                  }
                  UI.download((c.name || 'character').replace(/[^\w\-]+/g, '_') + '.json',
                    JSON.stringify(exported, null, 2));
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

  /* v1.39.54: the shared tail of every import — file or link. Card text
     arrives as HTML — SillyTavern/Janitor descriptions, <br> line breaks,
     the bot's avatar as <img src="…">. Convert it to plain prose now, so
     the sheet, the greeting and the prompt never carry markup a model
     could read and echo back as literal text. */
  /* G (v1.39.69): say what the import could not carry. Each note is a real
     loss the player would otherwise only discover as "my card behaves
     strangely". Computed from the RAW card, before plainText rewrites it. */
  /* K4 (v1.39.76): a `chara_card_v3` whose fields sit at the top level instead
     of under `data` used to import as a character with no name, no sheet and
     no greeting — silently, because cardToCharacter reads `data` alone for V3.
     The card is still importable (see Store.cardToCharacter), but the person
     needs to know the file is malformed, not that the app ate it. */
  App.v3ShapeNote = function (card) {
    if (!card || card.spec !== 'chara_card_v3') return null;
    var data = card.data && typeof card.data === 'object' ? card.data : null;
    var hasData = !!(data && (data.first_mes || data.description || data.name));
    var hasTop = !!(card.first_mes || card.description || card.name);
    if (hasData) {
      if (hasTop && !data.first_mes && card.first_mes) {
        return 'This V3 card keeps its fields both at the top level and under "data", and the two disagree. ' +
          'The "data" copy is the one used — that is what the spec says to prefer.';
      }
      return null;
    }
    if (hasTop) {
      return 'This V3 card puts its fields at the top level instead of under "data", which is not what the spec ' +
        'asks for. They were read from the top level so nothing is lost, but other apps may show an empty character.';
    }
    return 'This card claims to be V3 but carries no character fields in either place. ' +
      'The file is probably damaged or a stub.';
  };

  App.importLossNotes = function (card) {
    var notes = [];
    var data = (card && card.data) || card || {};
    /* <START> is no longer a loss: v1.39.70 recovers the separator before the
       plain-text pass, so it parses the way every card guide intends. */
    var book = data.character_book ||
      (card && card.data && card.data.character_book) ||
      (card && card.character_book) || null;
    var entries = (book && Array.isArray(book.entries)) ? book.entries : [];
    /* v1.39.72: `constant` is honoured since v1.39.70, so an entry that uses
       it was no longer a loss and the note had become a lie. Portraits are
       carried on both import branches since v1.39.70 for the same reason. */
    /* v1.40.0: `selective` and `secondary_keys` ARE matched on now, so this is no
       longer a loss note. What is left is the SillyTavern-only `selectiveLogic`,
       which no card spec defines, and values that are not the boolean the spec
       describes. Both get named per entry on the Lore screen as well, because a
       note shown once at import is a note nobody re-reads after a week of chat. */
    var logic = 0, malformed = 0;
    entries.forEach(function (e) {
      if (!e) return;
      if (e.selectiveLogic !== undefined) logic++;
      if ((e.selective !== undefined && e.selective !== true && e.selective !== false) ||
        (e.case_sensitive !== undefined && e.case_sensitive !== true && e.case_sensitive !== false)) malformed++;
    });
    if (logic) {
      notes.push(logic + ' ' + (logic === 1 ? 'entry sets' : 'entries set') +
        ' "selectiveLogic", a SillyTavern setting with no definition in the V2 or V3 card spec. This app ' +
        'follows the spec instead: "selective": true needs a key from both lists, and the secondary list is ' +
        'ignored when selective is not true. The value stays in your card, so SillyTavern still reads it ' +
        'the way you left it; only the matching here differs.');
    }
    if (malformed) {
      notes.push(malformed + ' ' + (malformed === 1 ? 'entry has a malformed' : 'entries have a malformed') +
        ' "selective" or "case_sensitive" value (neither true nor false). The spec treats those as absent, ' +
        'so the entry matches on its primary keys, ignoring case. The Lore screen names the field.');
    }
    /* The two asks a book can make that depend on a switch. Worded the way the
       prompt ask is worded: the field is not lost, it is waiting, and the note says
       where to decide it. Nothing here changes which entries fire — the sentence is
       the only thing an import writes. */
    var regexed = entries.filter(function (e) { return e && e.use_regex === true; }).length;
    if (regexed) {
      notes.push(regexed + ' ' + (regexed === 1 ? 'entry sets' : 'entries set') + ' "use_regex", which means their keys are ' +
        'regular expressions instead of words to find. ' +
        (Store.settings && Store.settings.honorCardRegex
          ? 'Your "Cards may use regex keys" switch is on, so this app runs them — against the same short ' +
            'window as every keyword, with the spec\u2019s rule that an entry whose pattern does not compile ' +
            'cannot match, and with the shapes that would hang a phone refused. The Lore screen for this ' +
            'character says which of them fired.'
          : 'This app does not run a card\u2019s pattern until you say so: switch on "Cards may use regex keys" ' +
            'in Settings → System prompt. Until then those keys are searched for as plain text, which is why ' +
            'such an entry can look broken. The value stays in your card either way.'));
    }
    var bookAsk = book && book.recursive_scanning === true;
    if (bookAsk) {
      notes.push('This book asks for "recursive_scanning": an entry that came in is read again, so it can wake a ' +
        'second entry the conversation never mentioned. ' +
        (Store.settings && Store.settings.honorCardRecursion
          ? 'Your "Cards may chain lore entries" switch is on, so it does — three hops at most, each entry once, ' +
            'and always behind everything your own words brought in.'
          : 'A card cannot approve itself, so nothing chains until you switch on "Cards may chain lore entries" ' +
            'in Settings → System prompt. The value stays in your card either way.'));
    }
    var ordered = entries.filter(function (e) {
      return e && typeof e.insertion_order === 'number';
    }).length;
    if (ordered) {
      notes.push(ordered + ' ' + (ordered === 1 ? 'entry sets' : 'entries set') +
        ' "insertion_order". Horde picks which entries to inject by how recently their keys ' +
        'appeared, so that field changes nothing until you turn on "Follow the card\'s lore ' +
        'order" on this character — which then uses it, and "position", to order and place the ' +
        'entries that were admitted. The value is kept in the card either way.');
    }
    /* `position` gets its own line rather than a spot in the "not used" list,
       because it is not unused: it decides placement as soon as the card's lore
       order is switched on. Saying "not carried" would promise a loss that does
       not happen; saying nothing hides a field the author set deliberately. */
    var placed = entries.filter(function (e) { return e && e.position; }).length;
    if (placed && !ordered) {
      notes.push(placed + ' ' + (placed === 1 ? 'entry sets' : 'entries set') +
        ' "position" (before or after the character). Horde keeps world facts in one place inside the ' +
        'character sheet, so that field changes nothing until you turn on "Follow the card\'s lore order" ' +
        'on this character. The value is kept in the card either way.');
    }

    /* v1.39.112: the two notes above named the worst losses and left the rest
       undocumented, so a card whose book enforces `position: before_character`
       read exactly like a plain keys/content book. One line now names every
       field the importer drops. Warn-only; nothing changes. */
    /* v1.40.0: the book fields this app models grew — everything the matcher
       reads now — so this list is the honest boundary and not a smaller one. */
    var KEPT = {
      keys: 1, content: 1, enabled: 1, constant: 1, stage: 1, id: 1,
      selective: 1, case_sensitive: 1, position: 1, insertion_order: 1, priority: 1,
      /* v1.47.0: `use_regex` is read now — it is on the live entry and the matcher
         acts on it when the player's switch allows it — so leaving it in the list of
         fields this app "does not use" would be a false confession. It gets its own
         line below, because what it does depends on a setting. */
      use_regex: 1,
      extensions: 1
    };
    /* Fields the two notes above already name stay on their own lines; this
       one is for the rest, so a problem never appears twice. */
    var NOTED = { secondary_keys: 1, selective: 1, insertion_order: 1, selectiveLogic: 1 };
    var dropped = {};
    entries.forEach(function (e) {
      Object.keys(e || {}).forEach(function (k) {
        if (!KEPT[k] && !NOTED[k]) dropped[k] = (dropped[k] || 0) + 1;
      });
    });
    var dKeys = Object.keys(dropped).sort();
    if (dKeys.length) {
      /* v1.39.113: these stopped being losses the moment the source copy was
         kept. Saying "the app does not carry" promised an export would drop them
         too, and it no longer does, which is a different and better warning. */
      notes.push('The lorebook sets fields this app does not use (' +
        dKeys.join(', ') + ') — matching here reads keys, content, constant, stage, ' +
        'case_sensitive, selective and secondary_keys. ' +
        'The fields stay in the card, so an export carries them back out.');
    }
    if (data.system_prompt) {
      notes.push('This card carries its own system prompt. Horde\'s global prompt stays in charge by ' +
        'default — it carries the rules this app needs — but the card\'s text is imported and shown in ' +
        'full on the character, where you can switch it to "the card\'s" or "both". The V2 spec asks ' +
        'apps to replace the global prompt; this one makes that a choice you can see instead.');
    }
    /* v1.41.0 (review issue 1): a card can also *ask*, in the Horde extension
       fields, that its prompt take over. Saying nothing there would let the
       request decide the question silently, so the ask is recorded on the
       character, named here, and applied by nobody until the player or their own
       global preference says otherwise. */
    var askedMode = (typeof Store !== 'undefined' && Store && Store.hordeBlock)
      ? String((Store.hordeBlock(data, card) || {}).system_prompt_source || '') : '';
    if (askedMode === 'card' || askedMode === 'combine') {
      notes.push('This card asks, in its own Horde fields, that its system prompt ' +
        (askedMode === 'card' ? 'replace yours' : 'be added to yours') + '. The request is kept ' +
        'with the character and shown on it, but not applied: a card cannot approve itself. ' +
        'Open the character and pick the mode under "Card prompts and placement", or switch on ' +
        '"Cards may choose their prompt" in Settings → System prompt if you want every card ' +
        'you import to have that already decided.');
    } else if (askedMode && askedMode !== 'app') {
      notes.push('This card sets a Horde prompt mode this app does not know ("' +
        askedMode.slice(0, 24) + '"). It is kept in the card and this app uses your own prompt.');
    }
    /* v1.39.112: a card whose greeting and examples are full of *action* donates
       the register from turn one, and the style lock only corrects a habit once
       it is already in the transcript — so the first corrections land on the
       player's first replies, with no idea why. Named here, at import, where
       the player can still act on it. Density is a risk factor, not a cause:
       the catalogued runaway started from a card with zero asterisks. */
    var openingLines = [];
    [data.first_mes].concat(Array.isArray(data.alternate_greetings) ? data.alternate_greetings : [],
      [data.mes_example]).forEach(function (t) {
      String(t || '').split(/\r?\n/).forEach(function (l) {
        if (l.trim()) openingLines.push(l);
      });
    });
    var starred = openingLines.filter(function (l) { return /\*[^*\n]+\*/.test(l); }).length;
    if (openingLines.length && starred / openingLines.length >= 0.15) {
      notes.push('This card writes action in asterisks on ' + starred + ' of ' +
        openingLines.length + ' opening lines. Replies will imitate that; the app only ' +
        'corrects the habit once it appears, so the first corrections land on your first ' +
        'replies. Strip the `*` pairs in the card editor if you want plain-prose replies.');
    }
    /* v1.40.0 (item 5): a card full of macros this app does not know used to
       reach the model as literal double braces — the reader then treats `{{setvar::x}}`
       as part of the fiction. Which names resolve is asked of the resolver itself
       (api.js `unresolvedMacros`), so this note cannot claim a macro is unknown
       after the app has grown it, and cannot stay silent about one it dropped.
       Nothing is rewritten: the card keeps its text, and the note says what will
       happen rather than promising to fix it. */
    var FIELD = {
      description: 'description', personality: 'personality', scenario: 'scenario',
      first_mes: 'greeting', mes_example: 'example dialogue',
      post_history_instructions: 'post-history instructions', system_prompt: 'system prompt'
    };
    var names = {}, where = {};
    Object.keys(FIELD).forEach(function (k) {
      var t = data[k];
      if (typeof t !== 'string' || t.indexOf('{{') === -1) return;
      ((typeof API !== 'undefined' && API.unresolvedMacros) ? API.unresolvedMacros(t) : []).forEach(function (n) {
        names[n] = 1;
        if (!where[n]) where[n] = FIELD[k];
      });
    });
    /* v1.40.0: what this app carries is bounded, so a field longer than the
       bound is shortened HERE and the card is left alone. Said out loud rather
       than discovered two weeks later as "where did my text go". */
    var carried = (typeof Store !== 'undefined' && Store && Store.cardCarryOver)
      ? Store.cardCarryOver(data, card) : 0;
    if (carried) {
      notes.push(carried + ' ' + (carried === 1 ? 'field is' : 'fields are') + ' longer than the ' +
        ((typeof Store !== 'undefined' && Store.CARRY_CAP) ? Store.CARRY_CAP : 4000) +
        ' characters this app carries (the card’s system prompt or its ' +
        'Horde instructions). The character here is shortened; the card keeps its full text, and an ' +
        'export returns it unchanged.');
    }
    var found = Object.keys(names).sort().slice(0, 8);
    if (found.length) {
      notes.push('This card asks for macros this app does not implement: ' +
        found.map(function (n) { return '{{' + n + '}}'; }).join(', ') +
        ' (in the ' + found.map(function (n) { return where[n]; }).join(', ') + '). ' +
        'They are passed through as written, so the model sees the braces. Implemented here: ' +
        '{{char}}, {{user}}, {{name}}, {{personality}}, {{description}}, {{scenario}}, {{persona}}, ' +
        '{{original}} and the pronoun macros — plus <START> and the {{char}}:/{{user}}: line labels in ' +
        'example dialogue, which are parsed. Nothing in the card was changed to make it fit.');
    }
    return notes;
  };

  /* One rule for "no secret leaves this app in text a user might share". The
     crash log has redacted the configured keys this way; the request inspector
     needs the identical rule, so it is a function now rather than a second copy
     that can fall behind. Both shapes are caught: a key that appears in a
     provider's own error text is removed by name, and one that only appears as
     text is removed by pattern. */
  App.redactCredentials = function (text) {
    var out = String(text == null ? '' : text);
    var st = (typeof Store !== 'undefined' && Store && Store.settings) || {};
    [st.apiKey, st.hordeKey, st.cloudflareWorkerToken].forEach(function (secret) {
      secret = String(secret || '');
      if (secret.length >= 6) out = out.split(secret).join('[credential redacted]');
    });
    return out.replace(/sk-or-v1-[a-f0-9]{64}/gi, '[credential redacted]');
  };

  /* Display only, and honest about being a claim: the text is the file's, the
     dates are what the file states, and none of it is sent to the model. Every
     string here comes out of a card someone downloaded, so all of it is escaped
     and none of it is run through the macro engine. */
  App.cardFileNotes = function (c) {
    var d = Store.cardDeclared ? Store.cardDeclared(c) : null;
    if (!d) { UI.toast('This card carries no date or author note of its own.'); return; }
    var row = function (label, val) {
      return '<div class="hint" style="margin-top:5px"><b style="color:var(--text)">' + label + ': </b>' + esc(val) + '</div>';
    };
    UI.sheet({
      title: 'From the card file',
      body:
        '<div class="hint" style="margin:0 0 9px">What ' + esc(c.name || 'this card') +
        ' says about itself, in its own file. The app does not act on any of it and does not send it to the model.</div>' +
        (d.created ? row('Created', d.created) : '') +
        (d.modified ? row('Last modified', d.modified) : '') +
        (d.notes
          ? '<div style="margin-top:9px;padding:8px 10px;border:1px solid var(--line);border-radius:10px;font-size:13px;line-height:1.55">' +
            esc(d.notes) + '</div>' +
            (d.noteFrom ? '<div class="hint" style="margin-top:5px">Read from ' + esc(d.noteFrom) + '.</div>' : '')
          : '<div class="hint" style="margin-top:6px">No author\u2019s note in this file.</div>') +
        (d.noteLanguages.length
          ? '<div class="hint" style="margin-top:9px">The file carries the note in ' + d.noteLanguages.length +
            ' language' + (d.noteLanguages.length === 1 ? '' : 's') + ' as well: ' + esc(d.noteLanguages.join(', ')) +
            '. This app has one interface language, so the others stay untouched in the card.</div>'
          : '') +
        (d.odd.length
          ? '<div class="hint" style="margin-top:9px">Not as the spec writes it: ' + esc(d.odd.join('; ')) +
            '. Kept as found, so an export gives it back the same way.</div>'
          : ''),
      actions: [{ label: 'Close', cls: 'ghost', value: null }]
    });
  };

  App.prepareImportedCharacter = function (card) {
    var c = Store.cardToCharacter(card);
    c.importNotes = App.importLossNotes(card);
    /* v1.42.2 (research handoff §2.1/§2.2): what the container itself said. A PNG
       can carry several copies of the card and a card's JSON can hold a repeated
       key or a number a reader cannot hold; all three are read by this app in a
       fixed, defensible way — so the way through is to say which copy was used and
       what was settled by the parser, not to refuse the file. Collected while the
       bytes were read, shown here, and never written into the card. */
    if (card && card.__png && card.__png.notes && card.__png.notes.length) {
      c.importNotes = c.importNotes.concat(card.__png.notes);
    }
    /* The notes above promise that an unused field still stays in the card.
       That is only true when the source copy fitted, so say plainly when it did
       not, rather than leave a reassurance that does not hold. */
    if (!c.cardSource) {
      c.importNotes.push('This card is too large for the app to keep a copy of its source, so ' +
        'anything above is a real loss on export and not just an unused setting. Re-import the ' +
        'original file if you want them back.');
    }
    var shapeNote = App.v3ShapeNote(card);
    if (shapeNote) c.importNotes.unshift(shapeNote);
    /* v1.13.1: card text arrives as HTML — SillyTavern/Janitor
       descriptions, <br> line breaks, the bot's avatar as
       <img src="…">. Convert it to plain prose now, so the sheet,
       the greeting and the prompt never carry markup a model could
       read and echo back as literal text. */
    c.persona = API.plainText(c.persona);
    /* the two card fields, cleaned by the same rule so that switching the
       character to the split editor cannot change the text the prompt sends */
    c.descText = API.plainText(c.descText || '');
    c.persText = API.plainText(c.persText || '');
    /* v1.41.0 (review issue 3): the preserved copy has two shape limits, and a
       card that runs past one keeps a copy that is knowingly short. Saying so at
       import is the only honest place — by the time the user exports, "the app
       never damages a card" would be a promise it cannot keep. */
    if (typeof Store !== 'undefined' && Store && Store.cardSourceGaps) {
      var gaps = Store.cardSourceGaps(c);
      if (gaps.length) {
        (c.importNotes || (c.importNotes = [])).push(
          'This app keeps a copy of the card\'s own text so an export can give it back unchanged, ' +
          'and that copy cannot hold part of this card: ' + gaps.join('; ') + '. The character works ' +
          'normally — nothing was cut from it — but an export from here leaves those parts out, so ' +
          'keep the original file if you want them.');
      }
    }
    c.scenario = API.plainText(c.scenario);
    c.greeting = API.plainText(c.greeting);
    c.examples = API.plainText(c.examples);
    c.postHistory = API.plainText(c.postHistory);
    c.lorebook = (c.lorebook || []).map(function (e) {
      e.content = API.plainText(e.content);
      return e;
    });
    /* …and the intros, for the same reason (v1.39.14) */
    c.alternateGreetings = (c.alternateGreetings || []).map(function (g) {
      return API.plainText(g);
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
      return Promise.all((c.expressionPortraits || []).map(function (p) {
        return Views.normalizeDataUrl(p.src, 512).then(function (src) { if (src) p.src = src; });
      }));
    }).then(function () { return c; });
  };

  /* One card -> the preview sheet -> in. The sheet says plainly whether a
     lorebook and alternate intros came along, so a missing pill is never
     mistaken for a book that failed to import. */
  App.previewImport = function (card) {
    return App.prepareImportedCharacter(card).then(function (c) {
      return UI.sheet({
        title: 'Import "' + (c.name || 'character') + '"',
        body: '<p style="margin:0 0 8px;color:var(--muted);font-size:13.5px">' +
          esc((c.persona || '').slice(0, 260)) + (c.persona && c.persona.length > 260 ? '…' : '') + '</p>' +
          /* v1.39.11: say it plainly either way — a missing pill was
             indistinguishable from a book that failed to import */
          (c.lorebook && c.lorebook.length
            ? '<div class="hint">This card carries <b>' + c.lorebook.length + ' lorebook entr' + (c.lorebook.length === 1 ? 'y' : 'ies') + '</b> — they import with the card.</div>'
            : '<div class="hint">No lorebook embedded in this card.</div>') +
          /* ...and the same plain speech for multi-intro cards: the
             alternates become swipes on the opening message */
          (c.alternateGreetings && c.alternateGreetings.length
            ? '<div class="hint">It also brings <b>' + (c.alternateGreetings.length + 1) + ' intros</b> — swipe the first message to step into another one.</div>'
            : '') +
          (c.importNotes && c.importNotes.length
            ? '<div class="hint" style="margin-top:8px"><b>Not carried over:</b></div>' +
              c.importNotes.map(function (n) {
                return '<div class="hint" style="margin-top:4px">• ' + esc(n) + '</div>';
              }).join('')
            : ''),
        actions: [
          { label: 'Cancel', cls: 'ghost', value: null },
          { label: 'Import', cls: 'primary', onClick: function () { return c; } }
        ]
      }).then(function (res) {
        if (!res) return;
        return Store.putCharacter(res).then(function () { App.go('characters'); UI.toast('Imported ' + res.name); });
      });
    });
  };

  /* Several cards at once (a JanitorAI bulk export) import together,
     with no preview — there is nothing to preview one at a time. */
  App.importMany = function (cards) {
    return Promise.all(cards.map(App.prepareImportedCharacter)).then(function (chars) {
      return chars.reduce(function (p, c) {
        return p.then(function () { return Store.putCharacter(c); });
      }, Promise.resolve()).then(function () {
        App.go('characters');
        /* v1.39.112: the notes were computed for every card and then dropped
           on the floor — the bulk path never rendered them, so a folder of
           normal cards imported with every compatibility note silent. The
           notes are persisted on each character and readable from its menu;
           this toast is the pointer. */
        var withNotes = chars.filter(function (c) { return c.importNotes && c.importNotes.length; });
        if (withNotes.length) {
          UI.toast(withNotes.length + ' of ' + chars.length + ' cards carry import notes — open each character to read them', 6000);
        } else {
          UI.toast('Imported ' + chars.length + ' characters');
        }
      });
    });
  };

  App.importCard = function () {
    Views.pickFile('.json,.png,application/json,image/png').then(function (f) {
      if (!f) return;
      Store.readCardsFile(f).then(function (cards) {
        if (!cards || !cards.length) throw new Error('No character found in that file');
        return cards.length === 1 ? App.previewImport(cards[0]) : App.importMany(cards);
      }).catch(function (e) { UI.toast('Import failed: ' + e.message, 4000); });
    });
  };

  /* v1.39.54: Sillytavern-style "External Import" — paste a character page
     link (JanitorAI, Chub, Pygmalion, Risu, AICharacterCards) or a direct
     link to a card file, and the card comes in like a picked file. */
  App.importCardFromUrl = function () {
    UI.input('Import character from a link', {
      message: 'Paste a character page link (JanitorAI, Chub, Pygmalion, Risu, AICharacterCards) or a direct link to a card file (.png / .json).',
      placeholder: 'https://…',
      okLabel: 'Fetch'
    }).then(function (url) {
      if (!url) return;
      UI.toast('Fetching the character…', 2000);
      UrlImport.importFromUrl(url).then(function (cards) {
        if (!cards || !cards.length) throw new Error('No character found at that address');
        return cards.length === 1 ? App.previewImport(cards[0]) : App.importMany(cards);
      }).catch(function (e) { UI.toast('Import failed: ' + e.message, 4500); });
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
      /* v1.39.13 - multi-intro cards: every first message the card brought
         becomes a swipe on the opening bubble (1/10 arrows), so picking an
         intro is a flick instead of a re-import */
      var alts = [];
      if (greeting) alts.push(greeting);
      (c.alternateGreetings || []).forEach(function (g) {
        var alt = API.macros(String(g || ''), c, Store.settings).trim();
        if (alt && alts.indexOf(alt) === -1) alts.push(alt);
      });
      var first = greeting
        /* the flag the bubble footer reads to keep from diagnosing a stop that
           never happened: this text came out of the card, not out of a model.
           Only the write side knows that, so it says so here. */
        ? Store.addMessage({ sessionId: s.id, role: 'assistant', text: greeting, alts: alts, altIdx: 0, fromGreeting: true })
        : Promise.resolve(null);
      return first.then(function () { App.openSession(s.id); });
    });
  };

  App.openSession = function (id, opts) {
    opts = opts || {};
    App.stopSpeech();
    App.state.attach = null; App.renderAttach();   /* staging belongs to the chat you leave */
    return IDB.get('sessions', id).then(function (s) {
      if (!s) return UI.toast('Chat not found');
      return Promise.resolve(Store.getCharacter(s.charId)).then(function (c) {
        var memberIds = Array.isArray(s.groupCharIds) ? s.groupCharIds : [];
        return Promise.all(memberIds.map(function (charId) { return Store.getCharacter(charId); })).then(function (members) {
          members = members.filter(Boolean);
          if (!c && members.length) c = members[0];
          if (!c) return UI.toast('The character for this chat is missing');
          return Store.getMessages(id).then(function (msgs) {
            App.state.session = s; App.state.char = c;
            /* v1.48.0: opening their chat IS the read receipt - no separate "mark as
               read" to hunt for and nothing to forget to tap. Written back only when
               there was a mark to clear, so opening a chat stays the read-only
               operation it was for the last hundred releases. */
            if (c && c.vh && (c.vh.unread > 0 || c.vh.unreadAt)) { VH.read(c); App.persistVH(c); }
            App.state.groupCharacters = members.length > 1 ? members : [];
            App.state.messages = msgs;
            App.state.screen = null;
            App.go('chat');
            Views.thread(c, s, msgs, null, true);
            App.renderGroupSpeaker();
            App.initSceneCast(c, s);
            App.renderSceneCast();
            $('#input').focus();
            /* v1.45.0: a search hit is only useful if it takes you to the line. */
            if (opts.focusMid) App.focusMessage(opts.focusMid);
            /* v1.48.6: the one write opening a chat makes, and only when the
               cached count disagrees with the rows this call just loaded for
               the thread. It is what heals a chat whose number a stale save
               (or an archive restored over a live one) wrote back: the row
               label is the visible half, but `since = messageCount - memAt`
               gates auto-summarising, so an unrepaired cache can leave a chat
               permanently unable to remember anything, silently. Returned so
               a failed write is not simply swallowed. */
            return Store.reconcile(s, msgs);
          });
        });
      });
    });
  };

  App.createGroupChat = function (selectedIds) {
    var members = Store.characters.filter(function (c) { return !(c.vh && c.vh.enabled); });
    if (members.length < 2) return UI.toast('Create at least two regular characters before starting a group chat');
    var chosen = selectedIds || [];
    UI.sheet({
      title: 'New group chat',
      body: '<p class="hint" style="margin:0 0 10px">Choose two or more characters. Before each message, pick who should reply; automatic round-robin is available only when you choose it.</p>' +
        members.map(function (c) {
          return '<label class="field compact" style="display:flex;align-items:center;gap:10px"><input type="checkbox" data-group-member="' + esc(c.id) + '"' +
            (chosen.indexOf(c.id) >= 0 ? ' checked' : '') + '> ' + esc(c.name || 'Unnamed') + '</label>';
        }).join(''),
      actions: [
        { label: 'Cancel', cls: 'ghost', value: null },
        { label: 'Create group', cls: 'primary', onClick: function (b) {
          return Array.prototype.slice.call(b.querySelectorAll('[data-group-member]:checked')).map(function (el) {
            return el.getAttribute('data-group-member');
          });
        } }
      ]
    }).then(function (ids) {
      if (!ids) return;
      if (ids.length < 2) {
        UI.toast('Choose at least two characters');
        return App.createGroupChat(ids);
      }
      var selected = ids.map(function (id) { return members.find(function (c) { return c.id === id; }); }).filter(Boolean);
      var s = Store.newSession(selected[0].id, 'Group: ' + selected.map(function (c) { return c.name || 'Unnamed'; }).join(' + '));
      s.groupCharIds = selected.map(function (c) { return c.id; });
      s.speakerMode = 'manual';
      s.nextSpeakerId = '';
      return Store.putSession(s).then(function () { App.openSession(s.id); });
    });
  };

  App.renderGroupSpeaker = function () {
    var el = $('#group-speaker');
    if (!el) return;
    var members = App.state.groupCharacters || [];
    var session = App.state.session;
    if (!session || members.length < 2) {
      el.hidden = true;
      el.innerHTML = '';
      return;
    }
    var selected = members.find(function (c) { return c.id === session.nextSpeakerId; });
    var label = session.speakerMode === 'auto'
      ? 'Auto · round-robin'
      : (selected ? selected.name : 'Choose a speaker');
    el.hidden = false;
    el.innerHTML = '<div style="display:flex;align-items:center;gap:8px;padding:6px 12px 2px;color:var(--muted);font-size:12px">' +
      '<span>Next speaker</span><button type="button" class="chip" id="group-speaker-pick">' + esc(label) + '</button></div>';
    var button = el.querySelector('#group-speaker-pick');
    if (button) button.onclick = function () { App.pickGroupSpeaker(); };
  };

  App.pickGroupSpeaker = function (afterPick) {
    var members = App.state.groupCharacters || [], session = App.state.session;
    if (!session || members.length < 2) return;
    var rows = members.map(function (c) {
      return '<div class="opt" data-group-speaker="' + esc(c.id) + '">' + esc(c.name || 'Unnamed') +
        (session.nextSpeakerId === c.id && session.speakerMode !== 'auto' ? ' · next' : '') + '</div>';
    }).join('') + '<div class="opt" data-group-speaker="auto">Auto · round-robin</div>';
    UI.sheet({
      title: 'Choose the next speaker',
      body: '<p class="hint" style="margin:0 0 8px">Manual selection is the default. Auto advances through the group in order.</p>' + rows,
      actions: [{ label: 'Cancel', cls: 'ghost', value: null }],
      onMount: function (b, close) {
        b.querySelectorAll('[data-group-speaker]').forEach(function (row) {
          row.onclick = function () {
            var id = row.getAttribute('data-group-speaker');
            close();
            if (id === 'auto') { session.speakerMode = 'auto'; session.nextSpeakerId = ''; }
            else { session.speakerMode = 'manual'; session.nextSpeakerId = id; }
            Store.putSession(session).then(function () {
              if (App.state.session && App.state.session.id === session.id) App.state.session = session;
              App.renderGroupSpeaker();
              if (afterPick) afterPick();
            });
          };
        });
      }
    });
  };

  /* ---------------- scene cast (multi-person cards) ----------------
     A single card can hold several people. The cast strip lets the
     player say who is in the current scene and who the next message
     addresses; the app then tells the model every turn, so people in
     other rooms stop answering conversations they cannot hear. */

  /* v1.39.77: a label is only evidence of a person when the card uses it to
     SPEAK — with words after the colon, more than once. A section heading
     ending in a colon, and a field whose value describes the character, both
     look exactly like a spoken line to a naive scan; it put them in the Scene
     strip as if they were people standing on the porch. */
  var CAST_REV = 9;          /* bump when detection rules change */

  App.initSceneCast = function (char, session) {
    if (!char || !session) return;
    var members = App.state.groupCharacters || [];
    if (members.length > 1 || (char.vh && char.vh.enabled)) {
      if (!session.castChecked) { session.castChecked = true; Store.putSession(session); }
      return;
    }
    /* v1.39.86: a revision number only moves when the app ships a new rule, so
       editing the card — renaming someone, adding a Cast section — left the old
       cast in place indefinitely. The card's own content is the thing that
       changed; that is what this watches. */
    var fp = App.castFingerprint(char);
    /* v1.39.95: a one-person card has no scene to keep. Whatever a chat is
       carrying — a cast from an older version of the card, or a scan that
       mistook a mood for a person — is dropped here, and the bar hides. */
    /* v1.48.1: `castEdited` outranks this. The cast editor's own comment says
       "player's call — leave it alone", and the re-detect below honours it while
       this clear did not — so on a card whose people are written as headings rather
       than dialogue, every name typed in by hand was deleted the next time the chat
       opened, and the strip never came back to edit it in. A scanner's opinion is
       not evidence that the player was wrong. */
    if (session.sceneCast && session.sceneCast.length && !session.castEdited) {
      var one = App.detectCast(char);
      if (one.length < 2) {
        session.sceneCast = [];
        session.scenePresent = [];
        session.addressedTo = '';
        session.castChecked = true;
        session.castRev = CAST_REV;
        session.castFp = fp;
        Store.putSession(session);
        return;
      }
    }
    /* Older chats may hold headings the loose scan mistook for people, and
       older cards may name people the current scan can see. Re-detect once per
       card version, unless the player has edited the cast by hand. */
    if ((session.castRev !== CAST_REV || session.castFp !== fp) && !session.castEdited) {
      var fresh = App.detectCast(char);
      var wasPresent = Array.isArray(session.scenePresent) ? session.scenePresent : [];
      var wasCast = Array.isArray(session.sceneCast) ? session.sceneCast : [];
      var present = fresh.filter(function (n) { return wasPresent.indexOf(n) !== -1; });
      if (!present.length) present = fresh.slice();
      /* v1.39.85: a name the re-detect has only just learned about (a rota the
         old scan could not read) starts in the room. Sending someone away is a
         choice the player made about a name they could see; it says nothing
         about a name that was invisible until now. */
      fresh.forEach(function (n) {
        if (wasCast.indexOf(n) === -1 && present.indexOf(n) === -1) present.push(n);
      });
      /* the chat's own character is in the room unless the player says otherwise */
      var selfKey = String(char.name || '').toLowerCase().split(/[\s,]+/)[0];
      var selfInFresh = selfKey && fresh.filter(function (n) {
        return String(n).toLowerCase().split(/[\s,]+/)[0] === selfKey;
      })[0];
      if (selfInFresh && present.indexOf(selfInFresh) === -1) present.unshift(selfInFresh);
      session.sceneCast = fresh;
      session.scenePresent = present;
      if (session.addressedTo && fresh.indexOf(session.addressedTo) === -1) session.addressedTo = '';
      if (session.lastSpeaker && fresh.indexOf(session.lastSpeaker) === -1) session.lastSpeaker = '';
      session.castRev = CAST_REV;
      session.castFp = fp;
      session.castChecked = true;
      Store.putSession(session);
      return;
    }
    if (session.castChecked) return;
    session.castChecked = true;
    var names = App.detectCast(char);
    if (names.length >= 2) {
      session.sceneCast = names;
      session.scenePresent = names.slice();
      session.addressedTo = '';
    }
    session.castRev = CAST_REV;
    session.castFp = fp;
    Store.putSession(session);
  };

  /* A stable, cheap fingerprint of everything detectCast reads. */
  App.castFingerprint = function (char) {
    if (!char) return '';
    var src = [char.name, char.persona, char.greeting, char.scenario, char.examples].join('\u0001');
    var h = 5381;
    for (var i = 0; i < src.length; i++) h = (((h * 33) >>> 0) ^ src.charCodeAt(i)) >>> 0;
    return h.toString(36) + '.' + src.length.toString(36);
  };

  App.detectCast = function (char) {
    var blob = [char.persona, char.greeting, char.scenario, char.examples].join('\n');
    var cands = {}, order = [];
    function norm(s) { return String(s || '').toLowerCase().replace(/[\u2018\u2019]/g, "'"); }
    function firstWord(s) { return norm(s).split(/[\s,]+/)[0]; }
    function isSelf(name) {
      var low = norm(name), self = norm(char.name);
      if (!self) return false;
      return low === self || (firstWord(low) && firstWord(low) === firstWord(self));
    }
    /* v1.39.83: a card's field headers are not people.
       A multi-person card written as blocks — a Name field, then Age, Role,
       Appearance, Likes, and so on once per character — repeats those headers
       as many times as it has people, and the scan below counted each
       repetition as an act of speech. The headers then outranked the
       characters who actually speak, and the Scene bar filled with field
       names instead of people. Nothing here is card-specific: this is the
       standard character-card vocabulary, and the same leak hits every card
       of this shape. */
    var FIELD_WORDS = (function () {
      var w = ('name names fullname nickname alias age birthday gender sex species pronouns ' +
        'role roles occupation job jobs work class archetype title titles rank status ' +
        'appearance looks look build height weight hair eyes skin face body clothing clothes outfit ' +
        'personality traits trait temperament quirks quirk habits likes dislikes fears fear goals goal ' +
        'overall summary overview general note notes about current currently details info information ' +
        'extra additional misc other stats stat physical mental emotional behaviour behavior demeanor ' +
        'motivation motivations desire desires hobbies hobby skills skill abilities ability powers ' +
        'relationship relationships family relatives friends friend occupation backstory history ' +
        'background bio profile description summary notes note tags tag scenario setting location ' +
        'world lore rules rule instructions system greeting speech voice accent language languages ' +
        'nationality ethnicity affiliation alignment mood emotion emotions secrets secret kinks limits ' +
        'style example examples dialogue first message summary appearance').split(/\s+/);
      var m = {};
      w.forEach(function (k) { if (k) m[k] = 1; });
      return m;
    })();
    function isField(name) {
      var low = norm(name).replace(/[^a-z\s]/g, ' ').replace(/\s+/g, ' ').trim();
      if (!low) return false;
      if (FIELD_WORDS[low] || FIELD_WORDS[firstWord(low)]) return true;
      /* two-word headers: "hair color", "eye color", "body type", … */
      var parts = low.split(' ');
      if (parts.length === 2 && FIELD_WORDS[parts[0]] && FIELD_WORDS[parts[1]]) return true;
      return false;
    }
    /* Reject what cannot be a person's name in a dialogue label: too short or
       too long, a macro, or a SHOUTED heading ("Main INTRO", "BASIC INFO"). */
    function shaped(name) {
      var clean = String(name || '').replace(/\s+/g, ' ').trim();
      if (clean.length < 2 || clean.length > 24) return '';
      if (/[{}<>]/.test(clean)) return '';
      if (/[A-Z]{3,}/.test(clean)) return '';
      var low = norm(clean);
      if (low === 'user' || low === 'you') return '';
      if (isField(clean)) return '';
      return clean;
    }
    function slot(name) {
      var low = norm(name);
      if (!cands[low]) { cands[low] = { name: name, acts: 0, strong: 0 }; order.push(low); }
      return cands[low];
    }
    /* The card's own name is no longer dropped here — a multi-person card is
       allowed to list its own character in the scene. It is filtered at the
       end instead, where the rest of the cast is known. */
    function offer(name) { var n = shaped(name); if (n) slot(n); }
    function act(name) { var n = shaped(name); if (n) slot(n).acts++; }
    /* v1.39.83: a label followed by an actual quoted line — or by a sentence
       rather than one word — is someone speaking, and one is enough. That is
       a far stronger signal than the repetition the count was asking for, and
       it is what lets a card that writes each character once still get a
       cast. */
    /* v1.39.83+: a value that reads *about* someone is a field description,
       not a line of dialogue — "Overall: A loyal, easygoing father who's
       trying to get his life back together." Three tells, all general: it
       opens with an article, it runs on, and it never addresses or refers to
       anyone in the first or second person. Real speech does at least one of
       those. */
    var PERSON_MARKERS = /\b(you|your|yours|yourself|i|i'm|i've|i'll|i'd|me|my|mine|we|us|our|ours)\b/i;
    function describes(v) {
      if (!/^(?:a|an|the)\s/i.test(v)) return false;
      if (v.split(/\s+/).length < 6) return false;
      return !PERSON_MARKERS.test(v);
    }
    function speaks(name, value) {
      var n = shaped(name);
      if (!n) return;
      var c = slot(n), v = String(value || '').trim();
      c.acts++;
      /* quotation marks are the one unambiguous sign of a spoken line */
      if (/^["\u201c\u2018\u2014\u2013-]/.test(v)) c.strong++;
      if (describes(v)) c.desc = (c.desc || 0) + 1;
    }

    /* "Name: words" is someone speaking. A bare "Name:" is a section
       heading — it is offered so that later prose can still vouch for it,
       but the line itself proves nothing. */
    function scanLabels(text) {
      String(text || '').split('\n').forEach(function (line) {
        var t = line.replace(/^\s*[^A-Za-z{]+/, '');        /* strip emoji/bullets */
        var m = /^([A-Z][A-Za-z'’.-]+(?: [A-Z][A-Za-z'’.-]+)?)\s*:\s*(.*)$/.exec(t);
        if (!m) return;
        if (m[2].trim()) speaks(m[1], m[2]); else offer(m[1]);
      });
    }
    function scanNames(text) {
      var m, re = /^Name:\s*(.+)$/gim;
      while ((m = re.exec(String(text || '')))) offer(m[1]);
    }
    scanLabels(char.examples);
    scanLabels(char.greeting);
    scanLabels(char.persona);
    scanNames(char.persona);

    /* A two-word proper name right beside a speech verb is a person too —
       "Cora Vane said nothing", "asked Cora Vane". Requiring two capitalised
       words keeps ordinary prose out ("She said", "The door"). */
    var verb = '(?:said|says|asked|asks|replied|replies|answered|whispered|murmured|snapped|added|laughed|sighed)';
    var after = new RegExp('\\b([A-Z][a-z]+(?:\\s+[A-Z][a-z]+)+)\\s+' + verb + '\\b', 'g');
    var before = new RegExp('\\b' + verb + '\\s+([A-Z][a-z]+(?:\\s+[A-Z][a-z]+)+)\\b', 'g');
    var m;
    while ((m = after.exec(blob))) act(m[1]);
    while ((m = before.exec(blob))) act(m[1]);

    /* Prose vouches for a name the same way a label does: "Rose said",
       "asked Rose". This is what separates a person from a field name. */
    order.slice().forEach(function (low) {
      var name = cands[low].name;
      var q = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      var said = new RegExp(
        '(\\b' + q + '\\s+(?:said|says|asked|asks|replied|replies|answered|whispered|murmured|snapped|added|laughed|sighed)\\b)' +
        '|(\\b(?:said|asked|replied|answered|whispered|murmured|snapped)\\s+' + q + '\\b)', 'gi');
      cands[low].acts += (blob.match(said) || []).length;
    });

    /* v1.39.85: a card may simply say who is in it.
       Multi-person cards often end with their own rota — a heading like
       "Cast", "Characters" or "Who's here", then one bullet per person:
       "- **Name** — who they are". Those people are declared, not inferred,
       so the dialogue scan above is the wrong instrument: a character listed
       there who has not spoken yet is still in the room, and leaving her out
       means she cannot be sent away, addressed, or kept from narrating.
       General by construction — no names, only the heading vocabulary and the
       shape of a bullet. */
    var CAST_HEADING = /^(?:the\s+)?(?:cast(?:\s+list|\s+of\s+characters)?|characters?|main\s+characters?|supporting\s+characters?|other\s+characters?|side\s+characters?|npcs?|people|persons|who(?:'s|\u2019s)?\s+(?:here|present|in\s+(?:this\s+)?(?:scene|room))|present|in\s+this\s+scene|characters?\s+in\s+(?:this\s+)?(?:scene|room))\s*:?\s*$/i;
    /* a bullet, in the shapes cards write them */
    var BULLET = /^\s*(?:[-*\u2022\u2013\u2014]|\d+[.)])\s+(.+)$/;
    function castSectionNames(text) {
      var out = [];
      var lines = String(text || '').split('\n');
      var inside = false, budget = 0;
      for (var i = 0; i < lines.length; i++) {
        var line = String(lines[i] || '').replace(/\s+$/, '');
        var bare = line.replace(/^[#*_\s]+/, '').replace(/[*_\s]+$/, '').trim();
        if (!inside) {
          if (CAST_HEADING.test(bare)) { inside = true; budget = 40; }
          continue;
        }
        if (!budget--) { inside = false; continue; }
        if (!line.trim()) continue;
        var b = BULLET.exec(line);
        if (!b) {
          /* any non-bullet line ends the rota: prose, a new field block, a rule */
          if (/^[A-Z][A-Za-z '\/]{1,24}\s*:/.test(line.trim())) { inside = false; }
          continue;
        }
        var body = b[1].trim();
        var bold = /^\*\*(.+?)\*\*/.exec(body);
        var name;
        if (bold) name = bold[1];
        else {
          name = body.split(/\s+[\u2013\u2014]\s+|\s+-\s+/)[0];
          if (/\s*:\s/.test(name)) name = name.split(/\s*:\s*/)[0];
        }
        name = String(name || '').replace(/[*_`]/g, ' ').replace(/\s+/g, ' ').trim();
        name = name.replace(/^[-\u2022\s]+|[-.,;:!\s]+$/g, '');
        if (!name || name.length > 32) continue;
        out.push(name);
      }
      return out;
    }

    /* A person recurs. A heading, a field label and a one-off mention do not. */
    /* the loaded character's own name, usable even if she never appears in a
       dialogue label — a rota can declare her without her ever speaking */
    /* v1.39.95: how often the name appears anywhere, and the words right after
       it. A person's name recurs throughout a card; a mood word appears only in
       the label that gives it a value — "Warm: she likes company", "Upset: she
       hates being ignored". Once blank lines are ignored, that distinction
       decides whether a label is a speaker or a state.
       Nothing here is card vocabulary: the test is how the card USES the word,
       which is what keeps it general. */
    function bareLines(text) {
      var out = [];
      String(text || '').split('\n').forEach(function (line) {
        var t = line.replace(/^\s*[^A-Za-z{]+/, '');
        var m = /^([A-Z][A-Za-z'\u2019.-]+(?: [A-Z][A-Za-z'\u2019.-]+)?)\s*:\s*(\S.*)$/.exec(t);
        if (m) out.push({ name: m[1], value: m[2] });
      });
      return out;
    }
    /* v1.39.96: a mood word is used all through the card as an ordinary
       adjective — "Humor: Warm, dry, self-deprecating", "Speech: warm, soft" —
       so counting occurrences cannot tell it from a person's name, which really
       does recur as itself. What a mood does NOT do is appear as a label more
       than once, or outside the block its labels live in. */
    var personaLines = String(char.persona || '').split('\n');
    function labelIndexes(word) {
      var re = new RegExp('^\\s*' + String(word || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*:', 'i');
      var out = [];
      for (var i = 0; i < personaLines.length; i++) if (re.test(personaLines[i])) out.push(i);
      return out;
    }
    /* the run of labels a word belongs to: walk backwards over the previous
       label lines, whatever they are called */
    function inLabelBlock(word) {
      var at = labelIndexes(word);
      if (at.length !== 1) return false;
      var i = at[0], steps = 0, gaps = 0;
      while (i > 0 && steps < 60) {
        i--; steps++;
        var line = String(personaLines[i] || '').trim();
        if (!line) { gaps++; if (gaps > 3) break; continue; }
        if (/^[A-Z][A-Za-z'\u2019 .-]{0,28}:\s*\S/.test(line)) { return true; }
        gaps = 0;
      }
      return false;
    }
    var labelLines = bareLines(char.persona).concat(bareLines(char.greeting)).concat(bareLines(char.examples));
    function valueSays(word) {
      var re = new RegExp('(^|[^A-Za-z])' + String(word || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '($|[^A-Za-z])', 'i');
      return labelLines.some(function (l) { return re.test(l.value); });
    }
    function occurrences(word) {
      try {
        var re = new RegExp('(^|[^A-Za-z])' + String(word || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '($|[^A-Za-z])', 'gi');
        return (String(blob).match(re) || []).length;
      } catch (e) { return 0; }
    }

    var found = [], seen = {}, selfName = '', selfActs = 0;
    var selfLabel = shaped(String(char.name || '').trim());
    order.forEach(function (low) {
      if (isSelf(cands[low].name)) {
        selfName = cands[low].name;
        selfActs += (cands[low].acts >= 2 || cands[low].strong) ? 1 : 0;
        /* remember her under both her full and her short name, so a rota that
           lists "First Last" does not add a second copy of the same person */
        var sk = norm(cands[low].name);
        seen[sk] = true; seen[firstWord(sk)] = true;
        return;
      }
      var c = cands[low];
      /* v1.39.96: these two vetoes run BEFORE the evidence test, because a mood
         written as a quoted line ("Upset: 'I'm sorry…'") qualifies as speech by
         every other measure. What it cannot do is behave like a person. */
      /* a label that appears once and sits inside a run of other labels —
         "Humor:", "Speech:", "Greeting:", then "Warm:", "Teasing:" — is one
         value in a list, not a speaker; a person speaks more than once */
      if (inLabelBlock(c.name)) return;
      /* a word that appears only as a label, beside a sentence that describes
         somebody rather than being spoken by them */
      if (occurrences(c.name) <= c.acts && valueSays(c.name)) return;
      /* Quoted speech anywhere is enough. Otherwise a label needs to recur —
         and if every occurrence reads as a description of somebody rather
         than something they said, recurrence proves nothing. */
      if (!c.strong) {
        if (c.acts < 2) return;
        if ((c.desc || 0) >= c.acts) return;
      }
      var name = cands[low].name, key = norm(name);
      if (seen[key] || seen[firstWord(key)]) return;
      seen[key] = true; seen[firstWord(key)] = true;
      found.push(name);
    });
    /* v1.39.83: on a card that writes more than one person speaking, the
       loaded character is one of the speakers and belongs in the scene — the
       bar could not list her at all before, so a two-person card produced a
       cast of one and the whole strip hid itself. A single-person card still
       yields nothing, because there is no one else in `found`. */
    /* People the card declares, after the ones it shows speaking. A declared
       name doubles as proof, so it can rescue a card whose only speakers were
       labelled once, but it never displaces dialogue — the order stays the
       card's own. */
    var declared = castSectionNames(blob).map(shaped).filter(Boolean);
    var selfDeclared = false;
    declared.forEach(function (name) {
      var key = norm(name);
      /* the loaded character is listed under her own name, which the header
         already carries — that is proof she is here, not a second person */
      if (isSelf(name)) { selfDeclared = true; return; }
      if (found.some(function (f) { return norm(f) === key || firstWord(norm(f)) === firstWord(key); })) return;
      if (seen[key] || seen[firstWord(key)]) return;
      if (isField(name)) return;
      if (valueSays(name)) return;
      if (inLabelBlock(name)) return;
      seen[key] = true; seen[firstWord(key)] = true;
      found.push(name);
    });
    var selfAdd = selfDeclared ? selfLabel : (selfActs >= 1 ? (selfName || selfLabel) : '');
    if (selfAdd && found.length >= 1) found.unshift(selfAdd);
    return found.slice(0, 6);
  };

  /* How much of this reply is lifted from an earlier one. 5-word shingles
     and containment (share of the NEW text found in the old), because a
     model that loops rewrites a line or two and keeps the rest. */
  App.repeatScore = function (text, prevTexts) {
    var shingles = function (t) {
      var w = String(t || '').toLowerCase().replace(/[^a-z0-9\s']/g, ' ').split(/\s+/).filter(Boolean);
      var set = {};
      for (var i = 0; i + 4 < w.length; i++) set[w.slice(i, i + 5).join(' ')] = 1;
      return set;
    };
    var a = shingles(text), keys = Object.keys(a);
    if (keys.length < 8) return 0;
    var best = 0;
    (prevTexts || []).forEach(function (p) {
      var b = shingles(p), bk = Object.keys(b);
      if (!bk.length) return;
      var hit = 0;
      keys.forEach(function (k) { if (b[k]) hit++; });
      var score = hit / keys.length;
      if (score > best) best = score;
    });
    return best;
  };

  App.renderSceneCast = function () {
    var el = $('#scene-cast');
    if (!el) return;
    var session = App.state.session, char = App.state.char;
    var members = App.state.groupCharacters || [];
    var cast = session && Array.isArray(session.sceneCast) ? session.sceneCast : [];
    if (!session || members.length > 1 || (char && char.vh && char.vh.enabled) || cast.length < 2) {
      el.hidden = true;
      el.innerHTML = '';
      return;
    }
    var present = session.scenePresent || [];
    var to = String(session.addressedTo || '').trim();
    var chips = cast.map(function (n) {
      var on = present.indexOf(n) !== -1;
      return '<button type="button" class="chip' + (on ? ' on' : ' off') + '" data-scene-toggle="' + esc(n) + '"' +
        ' title="' + (on ? 'Present — tap to send away' : 'Away — tap to bring here') + '">' + esc(n) + '</button>';
    }).join('');
    el.hidden = false;
    el.innerHTML = '<div class="scene-cast">' +
      '<span class="sc-label">Scene</span>' + chips +
      '<span class="sc-label">Speaking to</span>' +
      '<button type="button" class="chip on" id="scene-to-pick">' + esc(to || 'Everyone') + '</button>' +
      '<button type="button" class="chip" id="scene-cast-edit" title="Edit the cast">✎</button></div>';
    el.querySelectorAll('[data-scene-toggle]').forEach(function (b) {
      b.onclick = function () { App.toggleScenePresent(b.getAttribute('data-scene-toggle')); };
    });
    el.querySelector('#scene-to-pick').onclick = function () { App.pickAddressedTo(); };
    el.querySelector('#scene-cast-edit').onclick = function () { App.editSceneCast(); };
  };

  App.toggleScenePresent = function (name) {
    var session = App.state.session;
    if (!session) return;
    var present = Array.isArray(session.scenePresent) ? session.scenePresent.slice() : [];
    var i = present.indexOf(name);
    if (i === -1) present.push(name); else present.splice(i, 1);
    session.scenePresent = present;
    if (session.addressedTo === name) session.addressedTo = '';   /* they just left */
    if (session.lastSpeaker === name) session.lastSpeaker = '';
    Store.putSession(session).then(function () { App.renderSceneCast(); });
  };

  App.pickAddressedTo = function () {
    var session = App.state.session;
    var cast = session && Array.isArray(session.sceneCast) ? session.sceneCast : [];
    if (!session || cast.length < 2) return;
    var rows = '<div class="opt" data-scene-to="">Everyone</div>' + cast.map(function (n) {
      return '<div class="opt" data-scene-to="' + esc(n) + '">' + esc(n) + ((session.addressedTo === n) ? ' · speaking' : '') + '</div>';
    }).join('');
    UI.sheet({
      title: 'Speaking to',
      /* v1.39.111: this used to be a one-shot that reset after one reply. A
         scene address is not a per-message setting — a player talking to Mara
         across a room is still talking to Mara next turn. The model had the
         roster and no addressee, so it re-staged rooms the player had left. */
      body: '<p class="hint" style="margin:0 0 8px">Only this person answers, until you change it. Choose Everyone to end it.</p>' + rows,
      actions: [{ label: 'Cancel', cls: 'ghost', value: null }],
      onMount: function (b, close) {
        b.querySelectorAll('[data-scene-to]').forEach(function (row) {
          row.onclick = function () {
            session.addressedTo = row.getAttribute('data-scene-to');
            close();
            Store.putSession(session).then(function () { App.renderSceneCast(); });
          };
        });
      }
    });
  };

  /** The editor's text into a cast list: one name per line, de-duplicated,
      inside the bounds the strip can actually render. Shared with Chat settings so
      the two entry points cannot disagree about what a name is. */
  App.parseCast = function (text) {
    var names = [], seen = {};
    String(text || '').split('\n').forEach(function (line) {
      var n = line.replace(/\s+/g, ' ').trim();
      if (!n || n.length > 24 || seen[n.toLowerCase()]) return;
      seen[n.toLowerCase()] = true;
      names.push(n);
    });
    return names.slice(0, 8);
  };

  /** Put a cast on a session and keep the rest of the scene state coherent with
      it: whoever left the stage cannot still be addressed, and cannot still be the
      last speaker. Resolves to whether anything actually changed, so a Save that
      changed nothing does not rewrite the chat. */
  App.applyCast = function (session, names) {
    if (!session) return false;
    var list = Array.isArray(names) ? names : App.parseCast(names);
    var was = Array.isArray(session.sceneCast) ? session.sceneCast : [];
    var same = list.length === was.length && list.every(function (n, i) { return n === was[i]; });
    if (same) return false;
    session.sceneCast = list;
    var present = (session.scenePresent || []).filter(function (n) { return list.indexOf(n) !== -1; });
    list.forEach(function (n) { if (present.indexOf(n) === -1) present.push(n); });
    session.scenePresent = present;
    if (session.addressedTo && list.indexOf(session.addressedTo) === -1) session.addressedTo = '';
    if (session.lastSpeaker && list.indexOf(session.lastSpeaker) === -1) session.lastSpeaker = '';
    session.castChecked = true;
    session.castEdited = true;      /* player's call — the scanner does not undo it */
    session.castRev = CAST_REV;
    return true;
  };

  /** Open the cast sheet for a chat. Takes the session so the Chat-settings field
      can use it too; defaults to the chat that is on screen. */
  App.editSceneCast = function (sessionFor) {
    var session = sessionFor || App.state.session;
    if (!session) return;
    var cast = Array.isArray(session.sceneCast) ? session.sceneCast : [];
    UI.sheet({
      title: 'Scene cast',
      body: '<p class="hint" style="margin:0 0 8px">One name per line. These are the people the app tracks in this chat — tap a name above to bring them into the scene or send them away.</p>' +
        '<textarea id="scene-cast-text" class="tall" style="width:100%">' + esc(cast.join('\n')) + '</textarea>',
      actions: [
        { label: 'Cancel', cls: 'ghost', value: null },
        { label: 'Save cast', cls: 'primary', onClick: function (b) {
          var names = App.parseCast(b.querySelector('#scene-cast-text').value || '');
          if (App.applyCast(session, names)) {
            Store.putSession(session).then(function () {
              /* only the chat on screen has a strip to redraw, and only a write
                 that changed something has anything to redraw */
              if (App.state.session && App.state.session.id === session.id) {
                App.state.session = session;
                App.renderSceneCast();
              }
            });
          }
          return null;
        } }
      ]
    });
  };

  App.nextGroupSpeaker = function (members, messages) {
    if (!members || !members.length) return null;
    var last = null;
    (messages || []).forEach(function (m) { if (m.role === 'assistant' && m.speakerId) last = m.speakerId; });
    var index = members.findIndex(function (c) { return c.id === last; });
    return members[(index + 1 + members.length) % members.length];
  };

  App.expressionPortraitFor = function (char, mood) {
    var text = String(mood || '').toLowerCase().trim();
    var portraits = char && Array.isArray(char.expressionPortraits) ? char.expressionPortraits : [];
    if (!text) return '';
    for (var i = 0; i < portraits.length; i++) {
      var p = portraits[i] || {};
      var keys = (p.keys && p.keys.length ? p.keys : [p.label]).map(function (k) { return String(k || '').toLowerCase().trim(); }).filter(Boolean);
      if (p.src && keys.some(function (k) { return text.indexOf(k) !== -1; })) return p.src;
    }
    return '';
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
    var windowed = messages.slice(-(settings.contextMessages || 40))
      .map(function (m) { return (m.role === 'user' ? 'You' : 'They') + ': ' + (m.text || ''); }).join('\n');
    /* v1.39.104: session.facts holds records now, so a raw join() would count
       "[object Object]" once per fact instead of its wording. Only what the
       prompt actually carries counts - the facts still true. */
    var contextChars = (session.summary || '').length +
      API.currentChatFacts(session).map(function (f) { return f.text; }).join('\n').length + windowed.length;
    return {
      messages: messages.length,
      replies: replies,
      rerolls: rerolls,
      autonomousMessages: auto,
      wordsPerReply: replies ? Math.round(words / replies) : 0,
      sinceSummary: Store.sinceMemory(session, Store.countTranscript(messages)),
      memoryEvery: settings.memoryEvery || 14,
      contextTokens: Math.ceil(contextChars / 4)
    };
  };

  /* v1.39.80: this sheet called `IDB.all('messages')`, a method that has never
     existed — the store has `getAll` and `getAllByIndex`. The call threw
     synchronously while the promise array was being built, so the `.catch()`
     below never ran and the menu simply closed with nothing happening and no
     toast. It reads through the same indexed getter the rest of the app uses. */
  App.chatHealthSheet = function (sessionId) {
    Promise.all([Store.getMessages(sessionId).then(function (list) {
      return (list || []).slice().sort(function (a, b) { return a.createdAt - b.createdAt; });
    }), IDB.get('sessions', sessionId)]).then(function (r) {
      var msgs = r[0] || [];
      var sess = r[1];
      if (!sess) { UI.toast('That chat no longer exists'); return; }
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
      /* v1.48.1: the cast field has to be able to say *why* the Scene bar is or is
         not there, which means reading the card the same way the strip does. Read
         only — opening a settings sheet must not write a cast into the chat. */
      return Promise.resolve(Store.getCharacter(s.charId)).then(function (castChar) {
      var ov = s.overrides || {};
      var scenePlace = ['character', 'memory', 'end'].indexOf(s.sceneNotePlacement) >= 0 ? s.sceneNotePlacement : 'end';
      var sceneFrequency = parseInt(s.sceneNoteFrequency, 10);
      if (!(sceneFrequency > 0)) sceneFrequency = 1;
      function persistSettings(message) {
        return Store.putSession(s).then(function () {
          /* This chat may stay open after the sheet closes. Generation reads
             App.state.session in memory, not the database; refresh that live
             object or the freshly saved style note won't reach the next
             prompt until the user leaves and reopens the chat. */
          if (App.state && App.state.session && App.state.session.id === s.id) App.state.session = s;
            if (message) UI.toast(message);
        });
      }
      var castNames = Array.isArray(s.sceneCast) ? s.sceneCast : [];
      var groupChat = Array.isArray(s.groupCharIds) ? s.groupCharIds.length > 1 : false;
      var castSeen = castChar ? App.detectCast(castChar) : [];
      var castRow;
      if (groupChat) {
        castRow = '<div class="field"><div class="field-head"><label>Scene cast</label></div>' +
          '<div class="hint">This chat has several characters, so the Scene bar is not used — who replies is ' +
          'chosen above the keyboard, and each of them brings their own card. The Scene bar is for one card ' +
          'that holds several people.</div></div>';
      } else if (castChar && castChar.vh && castChar.vh.enabled) {
        castRow = '<div class="field"><div class="field-head"><label>Scene cast</label></div>' +
          '<div class="hint">This character is living (Life is on), and the people around them come from their ' +
          'own life rather than from this chat, so the Scene bar is not used here.</div></div>';
      } else {
        /* the sentence has to explain the two ways this ends up doing nothing: a
           card whose people are written as headings, and a cast of one, which is not
           a scene — so the number is stated, not the promise */
        castRow = '<div class="field"><div class="field-head"><label>Scene cast — who is in this chat</label></div>' +
          '<textarea id="cs-cast" class="tall" placeholder="One name per line">' + esc(castNames.join('\n')) + '</textarea>' +
          '<div class="hint">' + (castSeen.length >= 2
            ? 'Read from this card: ' + castSeen.length + ' people (' + esc(castSeen.slice(0, 4).join(', ')) +
              (castSeen.length > 4 ? ', …' : '') + '). Names you type here replace that list, and the card is not ' +
              're-scanned over your head.'
            : 'This card names its people in a way the app will not infer — it only counts a name as someone ' +
              'in the scene when the card has them speak or is told so in prose, so headings and profile fields ' +
              'do not qualify. Type them here, one per line: two names or more and the Scene bar appears above ' +
              'the keyboard, and stays as you left it.') +
          '</div></div>';
      }

      UI.sheet({
        title: 'Chat settings — ' + (s.title || 'New chat'),
        body:
          '<div class="field"><div class="field-head"><label>Temperature (leave empty for the character\'s default)</label></div>' +
            '<input id="cs-temp" type="number" min="0" max="2" step="0.05" value="' + (ov.temperature === 0 || ov.temperature ? ov.temperature : '') + '" placeholder="default"></div>' +
          '<div class="field"><div class="field-head"><label>Max reply tokens (leave empty for default)</label></div>' +
            '<input id="cs-maxtok" type="number" min="32" max="2048" step="16" value="' + (ov.maxTokens || '') + '" placeholder="default"></div>' +
          '<div class="field"><div class="field-head"><label>Style note for this chat only</label></div>' +
            '<textarea id="cs-note" class="tall" placeholder="e.g. answer in short, clipped lines">' + esc(ov.note || '') + '</textarea></div>' +
          '<div class="field"><div class="field-head"><label>Scene note for this chat only</label></div>' +
            '<textarea id="cs-scene" class="tall" placeholder="e.g. Keep the current scene in the rain-soaked courtyard">' + esc(s.sceneNote || '') + '</textarea>' +
            '<div class="hint">A recurring scene reminder. It stays separate from the character-wide post-history note.</div></div>' +
          '<div class="field"><div class="field-head"><label>Scene note placement</label></div>' +
            '<select id="cs-scene-place"><option value="character"' + (scenePlace === 'character' ? ' selected' : '') + '>After character setup</option>' +
            '<option value="memory"' + (scenePlace === 'memory' ? ' selected' : '') + '>After lore and chat memory</option>' +
            '<option value="end"' + (scenePlace === 'end' ? ' selected' : '') + '>At the end of the context block</option></select></div>' +
          '<div class="field"><div class="field-head"><label>Repeat scene note</label></div>' +
            '<input id="cs-scene-frequency" type="number" min="1" max="20" step="1" value="' + sceneFrequency + '">' +
            '<div class="hint">Every N assistant replies (1 means every reply; 2 means every other reply). Leave the note blank to turn it off.</div></div>' +
            castRow,
        actions: [
          /* UI.sheet clears its body before resolving the returned promise.
             Capture every field inside onClick, while the form still exists;
             reading them in the .then below loses the values (and throws). */
          { label: 'Save', onClick: function (b) {
            return {
              action: 'save',
              temperature: b.querySelector('#cs-temp').value,
              maxTokens: b.querySelector('#cs-maxtok').value,
              note: b.querySelector('#cs-note').value,
              sceneNote: b.querySelector('#cs-scene').value,
              sceneNotePlacement: b.querySelector('#cs-scene-place').value,
              sceneNoteFrequency: b.querySelector('#cs-scene-frequency').value,
              cast: b.querySelector('#cs-cast') ? b.querySelector('#cs-cast').value : null
            };
          } },
          { label: 'Reset to defaults', cls: 'ghost', value: 'reset' },
          { label: 'Cancel', cls: 'ghost', value: null }
        ]
      }).then(function (res) {
        if (!res) return;
        if (res === 'reset') {
          s.overrides = null;
          s.sceneNote = '';
          s.sceneNotePlacement = 'end';
          s.sceneNoteFrequency = 1;
          return persistSettings('Chat settings reset to defaults');
        }
        if (!res || res.action !== 'save') return;
        var temp = String(res.temperature || '').trim();
        var maxt = parseInt(res.maxTokens, 10);
        var note = String(res.note || '').trim();
        var sceneNote = String(res.sceneNote || '').trim();
        var scenePlacement = ['character', 'memory', 'end'].indexOf(res.sceneNotePlacement) >= 0
          ? res.sceneNotePlacement : 'end';
        var sceneFrequency = parseInt(res.sceneNoteFrequency, 10);
        if (!(sceneFrequency > 0)) sceneFrequency = 1;
        sceneFrequency = Math.min(20, sceneFrequency);
        s.sceneNote = sceneNote;
        s.sceneNotePlacement = scenePlacement;
        s.sceneNoteFrequency = sceneFrequency;
        s.overrides = {};
        if (temp !== '') s.overrides.temperature = parseFloat(temp);
        if (maxt > 0) s.overrides.maxTokens = maxt;
        if (note) s.overrides.note = note;
        if (!Object.keys(s.overrides).length) s.overrides = null;
        /* a group chat and a living character get no field, so `cast` is null and
           nothing here touches a cast they never offered to change */
        var castChanged = res.cast !== null && res.cast !== undefined
          ? App.applyCast(s, App.parseCast(res.cast)) : false;
        /* the strip is on the chat screen, not in this sheet: it only needs
           redrawing when this chat is the one being looked at, and only when the
           cast actually moved — a Save that changed nothing has nothing to show */
        return persistSettings('Chat settings saved').then(function () {
          if (castChanged && App.state.session && App.state.session.id === s.id) App.renderSceneCast();
        });
        });
      });
    });
  };

  /** v1.39.0 H: after the third real exchange, an untitled chat learns its
      name from one tiny one-shot call. Silent on failure (a title is a
      nicety, not an availability problem). */
  /* v1.39.26: the auto-titler's candidate may be an instruction echo ("The
     user wants me to name this conversation in at most five…" — Nemotron
     answered the task by repeating it, and 60 characters of it became the
     chat's name). Clean a candidate; refuse anything that repeats the task
     instead of performing it. null = not a title. */
  App.validAutoTitle = function (raw) {
    var text = String(raw || '').trim().split('\n')[0].trim();
    if (!text) return null;
    /* meta prefaces — "Sure, here is a title: X" → keep X (but never eat a
       real colon title like "Draconica: The Reckoning") */
    text = text.replace(/^title\s*:\s*/i, '');
    var m = text.match(/^(?:sure[,.!]?|certainly[,.!]?|of course[,.!]?|okay[,.!]?|here(?:'|’)s|here is)[^:]{0,40}:\s*(.+)$/i);
    if (m) text = m[1].trim();
    text = text.replace(/^[\"'《]+|[\"'》]+$/g, '').replace(/[.。…]+$/g, '').trim();
    if (!text) return null;
    if (/(the user wants|name this conversation|this conversation in|at most (?:five|\d+) words?|no quotes|no commentary)/i.test(text)) return null;
    if (text.split(/\s+/).length > 10 || text.length > 60) return null;   /* a title, not a retold sentence */
    return text;
  };

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
      var title = App.validAutoTitle(text);
      if (!title) {
        /* an echo/miss: try again after a later reply; after 3 misses give
           up quietly (mark done so it stops costing a call per reply) */
        s._titleFails = (s._titleFails || 0) + 1;
        if (s._titleFails >= 3) { s.titleAuto = true; return Store.putSession(s); }
        return;
      }
      s.title = title;
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
        '<div class="opt" data-a="md">' + icon('edit') + ' For publishing (.md)</div>' +
        '<div class="opt" data-a="json">' + icon('download') + ' Backup (.json) — for Horde Studio</div>',
      onMount: function (b, close) {
        b.querySelectorAll('.opt').forEach(function (el) {
          el.onclick = function () {
            var a = el.getAttribute('data-a'); close();
            if (a === 'text') App.exportTranscript(id);
            else if (a === 'md') App.exportTranscript(id, 'md');
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
          rpgStatus: s.rpgStatus || null,
          continuity: s.continuity || null,
          chatLorebook: s.chatLorebook || [],
          sceneCast: s.sceneCast || [],
          scenePresent: s.scenePresent || [],
          messages: msgs.map(function (m) {
            return { role: m.role, text: m.text || '', createdAt: m.createdAt, image: m.image || null, imageCaption: m.imageCaption || null, autonomous: !!m.autonomous,
              rpgStatusProposal: m.rpgStatusProposal && m.rpgStatusProposal.state === 'pending' ? m.rpgStatusProposal : null,
              continuityProposal: m.continuityProposal && m.continuityProposal.state === 'pending' ? m.continuityProposal : null };
          })
        };
        UI.download(((c && c.name) || 'chat') + '-' + (s.title || 'chat') + '.hordechat.json',
          JSON.stringify(data, null, 2), 'application/json');
      });
    });
  };

  function safeImportedRpgProposal(proposal) {
    if (!proposal || proposal.state !== 'pending') return null;
    try {
      var safe = API.parseRpgUpdate('<rpg_update>' + JSON.stringify({ reason: proposal.reason, changes: proposal.changes }) + '</rpg_update>');
      return safe ? { state: 'pending', reason: safe.reason, changes: safe.changes, createdAt: Number(proposal.createdAt) || Date.now() } : null;
    } catch (e) { return null; }
  }

  function safeImportedContinuityProposal(proposal) {
    if (!proposal || proposal.state !== 'pending' || !API.parseContinuityUpdate) return null;
    try {
      var safe = API.parseContinuityUpdate('<continuity_update>' + JSON.stringify({ reason: proposal.reason, changes: proposal.changes }) + '</continuity_update>');
      return safe ? { state: 'pending', reason: safe.reason, changes: safe.changes, createdAt: Number(proposal.createdAt) || Date.now() } : null;
    } catch (e) { return null; }
  }

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
    s.rpgStatus = data.rpgStatus && data.rpgStatus.enabled ? normalizeRpgStatus(data.rpgStatus) : null;
    s.continuity = API.normalizeContinuity ? API.normalizeContinuity(data.continuity) : (s.continuity || null);
    s.chatLorebook = API.parseLorebookFile ? API.parseLorebookFile(JSON.stringify({ entries: data.chatLorebook || [] })) : [];
    s.sceneCast = Array.isArray(data.sceneCast) ? data.sceneCast.slice(0, 8) : [];
    s.scenePresent = Array.isArray(data.scenePresent)
      ? data.scenePresent.filter(function (n) { return s.sceneCast.indexOf(n) !== -1; })
      : s.sceneCast.slice();
    s.castChecked = s.sceneCast.length > 0;
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
        rpgStatusProposal: safeImportedRpgProposal(m.rpgStatusProposal),
        continuityProposal: safeImportedContinuityProposal(m.continuityProposal),
        createdAt: m.createdAt || Date.now()
      };
    });
    /* v1.48.6: this used to be the second definition of "how many messages" in
       the app — it excluded system notices, the `+1` in `Store.addMessage`
       counted them, so the two writers of the number disagreed about one chat.
       One rule now (`Store.countTranscript`), applied after the rows are in,
       and through the counter's door rather than a whole-row write that
       `putSession` is no longer allowed to move. */
    return Store.putSession(s).then(function () {
      return IDB.putMany('messages', msgs);
    }).then(function () {
      return Store.reconcile(s, msgs);
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

  /* v1.48.7: the ledger's maths moved into API.rpgNormalize, because the same
     numbers are read by the prompt that tells the model the rules and by the
     write path that enforces them. Two copies of that arithmetic is how a bar
     starts disagreeing with the story it is supposed to be tracking. */
  App.rpgStatusDefaults = function () {
    return API.rpgStatusDefaults();
  };

  function normalizeRpgStatus(raw) {
    return API.rpgNormalize(raw || {});
  }

  function rpgLines(value) {
    return String(value || '').split(/\r?\n/).map(function (line) {
      return line.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '').trim().slice(0, 240);
    }).filter(Boolean).slice(0, 80);
  }

  function rpgAttributesText(attrs) {
    return Object.keys(attrs || {}).map(function (key) { return key + ': ' + attrs[key]; }).join('\n');
  }

  function parseRpgAttributes(text) {
    var out = {};
    String(text || '').split(/\r?\n/).slice(0, 40).forEach(function (line) {
      var match = line.match(/^\s*([^:=]{1,48})\s*[:=]\s*(.{1,160})\s*$/);
      if (match) out[match[1].trim()] = match[2].trim();
    });
    return out;
  }

  function continuityRows(items, fields, statusField) {
    return (items || []).map(function (item) {
      var values = fields.map(function (f) { return item[f] || ''; });
      if (statusField) values.unshift(item[statusField] || 'open');
      return values.join(' | ');
    }).join('\n');
  }

  App.continuitySheet = function (sessionId) {
    IDB.get('sessions', sessionId).then(function (session) {
      if (!session) return UI.toast('Chat not found');
      var c = API.normalizeContinuity(session.continuity);
      var closeSheet;
      UI.sheet({
        title: 'Chat continuity — ' + (session.title || 'chat'),
        body:
          '<div class="hint">Opt-in, per-chat ledger. Different chats never share this state. Model suggestions stay pending until you review and apply them.</div>' +
          '<div class="field compact"><label>Enable continuity in prompts</label><div class="toggle' + (c.enabled ? ' on' : '') + '" id="cont-enabled"></div><div class="hint">Off by default to avoid extra model output. When enabled, relevant state is included for any character in this chat.</div></div>' +
          '<div class="group"><div class="group-title">Scene</div>' +
            '<div class="field"><label>Timeline stage</label><input id="cont-stage" maxlength="120" value="' + esc(c.stage) + '" placeholder="A named chapter, date, or timeline point"></div>' +
            '<div class="hint">Stage-gated lore entries are injected only when their exact stage matches this value. With continuity off or stage blank, stage-gated lore stays hidden.</div>' +
            '<div class="field"><label>Location</label><input id="cont-location" maxlength="160" value="' + esc(c.location) + '"></div>' +
            '<div class="field"><label>Time</label><input id="cont-time" maxlength="120" value="' + esc(c.time) + '" placeholder="Time of day, date, or elapsed time"></div>' +
            '<div class="field"><label>Present characters <span class="hint">one per line</span></label><textarea class="tall" id="cont-participants">' + esc(c.participants.join('\n')) + '</textarea></div>' +
          '</div>' +
          '<div class="group"><div class="group-title">Knowledge & truth</div>' +
            '<div class="field"><label>Knowledge records <span class="hint">who | fact | basis</span></label><textarea class="tall" id="cont-knowledge" placeholder="Warden | the gate is sealed | witnessed it\n{{user}} | the letter is forged | was told by Warden\nNarrator only | the key is cursed | hidden world truth">' + esc(continuityRows(c.knowledge, ['who', 'fact', 'basis'])) + '</textarea><div class="hint">Use each NPC’s name separately. Basis records provenance (witnessed, told by whom, inferred). Use {{user}} for player knowledge, Everyone for shared knowledge, or Narrator only for hidden world truth. NPC knowledge is injected only for present NPCs.</div></div>' +
          '</div>' +
          '<div class="group"><div class="group-title">Important objects</div>' +
            '<div class="field"><label>Object state <span class="hint">name | state | holder | basis</span></label><textarea class="tall" id="cont-objects" placeholder="Brass key | bent, still usable | Warden | picked up from the floor">' + esc(continuityRows(c.objects, ['name', 'state', 'holder', 'basis'])) + '</textarea></div>' +
          '</div>' +
          '<div class="group"><div class="group-title">Open and resolved events</div>' +
            '<div class="field"><label>Events <span class="hint">open/resolved | name | detail</span></label><textarea class="tall" id="cont-events" placeholder="open | Find the missing ledger | Last seen in the archive\nresolved | The alarm was disabled | Confirmed by the group">' + esc(continuityRows(c.events, ['name', 'detail'], 'status')) + '</textarea></div>' +
          '</div>',
        actions: [
          { label: 'Cancel', cls: 'ghost', value: null },
          { label: 'Save continuity', cls: 'primary', close: false, onClick: function (b) {
            var out = {
              enabled: b.querySelector('#cont-enabled').classList.contains('on'),
              stage: b.querySelector('#cont-stage').value.trim(), location: b.querySelector('#cont-location').value.trim(),
              time: b.querySelector('#cont-time').value.trim(),
              participants: b.querySelector('#cont-participants').value.split(/\r?\n/).map(function (x) { return x.trim(); }).filter(Boolean),
              knowledgeText: b.querySelector('#cont-knowledge').value,
              objectsText: b.querySelector('#cont-objects').value,
              eventsText: b.querySelector('#cont-events').value
            };
            function rows(text, min, label) {
              var parsed = [], error = '';
              String(text || '').split(/\r?\n/).forEach(function (line, i) {
                if (!line.trim()) return;
                var p = line.split('|').map(function (x) { return x.trim(); });
                if (p.length < min || p.slice(0, min).some(function (x) { return !x; })) error = label + ' line ' + (i + 1) + ' needs at least ' + min + ' non-empty fields separated by |.';
                else parsed.push(p);
              });
              return { parsed: parsed, error: error };
            }
            var k = rows(out.knowledgeText, 2, 'Knowledge'), o = rows(out.objectsText, 2, 'Object'), e = rows(out.eventsText, 2, 'Event');
            var problem = k.error || o.error || e.error;
            if (!problem && e.parsed.some(function (p) { return ['open', 'resolved'].indexOf(String(p[0]).toLowerCase()) < 0; })) problem = 'Event status must be open or resolved.';
            if (problem) { UI.toast(problem, 5000); return; }
            out.knowledge = k.parsed.map(function (p) { return { who: p[0], fact: p[1], basis: p.slice(2).join(' | ') }; });
            out.objects = o.parsed.map(function (p) { return { name: p[0], state: p[1], holder: p[2] || '', basis: p.slice(3).join(' | ') }; });
            out.events = e.parsed.map(function (p) { return { status: String(p[0]).toLowerCase() === 'resolved' ? 'resolved' : 'open', name: p[1], detail: p.slice(2).join(' | ') }; });
            delete out.knowledgeText; delete out.objectsText; delete out.eventsText;
            closeSheet(out);
          } }
        ],
        onMount: function (b, close) {
          closeSheet = close;
          var toggle = b.querySelector('#cont-enabled');
          toggle.onclick = function () { toggle.classList.toggle('on'); };
        }
      }).then(function (result) {
        if (!result) return;
        session.continuity = API.normalizeContinuity(result);
        return Store.putSession(session).then(function () {
          if (App.state.session && App.state.session.id === sessionId) App.state.session = session;
          UI.toast(session.continuity.enabled ? 'Continuity saved for this chat' : 'Continuity saved and kept off');
        });
      });
    }).catch(function (e) { UI.toast('Could not save continuity: ' + (e && e.message), 4000); });
  };

  App.reviewContinuityProposal = function (message) {
    var proposal = message && message.continuityProposal;
    if (!proposal || proposal.state !== 'pending') return;
    var safe = API.parseContinuityUpdate('<continuity_update>' + JSON.stringify({ reason: proposal.reason, changes: proposal.changes }) + '</continuity_update>');
    if (!safe) return UI.toast('This continuity proposal is invalid and cannot be applied.');
    function changeLine(x) {
      if (x.type === 'scene') return 'Scene ' + x.field + ' → ' + x.value;
      if (x.type === 'participant') return (x.op === 'add' ? 'Add present character: ' : 'Remove present character: ') + x.name;
      if (x.type === 'knowledge') return (x.op === 'add' ? 'Knowledge: ' : 'Remove knowledge: ') + x.who + ' — ' + x.fact + (x.basis ? ' (basis: ' + x.basis + ')' : '');
      if (x.type === 'object') return (x.op === 'set' ? 'Object state: ' : 'Remove object: ') + x.name + (x.state ? ' → ' + x.state : '') + (x.holder ? ' (holder: ' + x.holder + ')' : '');
      if (x.type === 'event') return x.op + ' event: ' + x.name + (x.detail ? ' — ' + x.detail : '');
      return 'Continuity change';
    }
    UI.sheet({
      title: 'Review continuity proposal',
      body: '<div class="hint">' + esc(safe.reason) + '</div><div class="hint" style="margin-top:12px">Nothing changes unless you choose Apply. Review each proposal against the actual conversation.</div><div class="group">' + safe.changes.map(function (x) { return '<div class="opt" style="white-space:normal">' + esc(changeLine(x)) + '</div>'; }).join('') + '</div>',
      actions: [
        { label: 'Cancel', cls: 'ghost', value: null },
        { label: 'Dismiss', cls: 'danger', value: 'dismiss' },
        { label: 'Apply approved changes', cls: 'primary', value: 'apply' }
      ]
    }).then(function (action) {
      if (!action) return;
      var sessionId = message.sessionId;
      return IDB.get('sessions', sessionId).then(function (session) {
        if (!session) return UI.toast('Chat not found');
        if (action === 'apply') session.continuity = API.applyContinuityProposal(session.continuity, safe);
        message.continuityProposal = { state: action === 'apply' ? 'approved' : 'dismissed', reason: safe.reason, changes: safe.changes, reviewedAt: Date.now() };
        return Promise.all([Store.putSession(session), Store.updateMessage(message)]).then(function () {
          if (App.state.session && App.state.session.id === sessionId) {
            App.state.session = session;
            Views.thread(App.state.char, session, App.state.messages);
          }
          UI.toast(action === 'apply' ? 'Approved continuity changes saved' : 'Continuity proposal dismissed');
        });
      });
    }).catch(function (e) { UI.toast('Could not update continuity: ' + (e && e.message), 4000); });
  };

  App.rpgStatusSheet = function (sessionId) {
    IDB.get('sessions', sessionId).then(function (session) {
      if (!session) return UI.toast('Chat not found');
      var current = normalizeRpgStatus(session.rpgStatus || {});
      var wasEnabled = !!(session.rpgStatus && session.rpgStatus.enabled);
      /* One view of the ledger for the whole sheet: the level, the threshold and
         the cap shown here are the ones API.rpgStatusPrompt tells the model and
         the ones rpgApplyUpdate enforces, read off the same object. */
      var v = API.rpgView(session.rpgStatus || {});
      var ruleText = API.rpgRuleInput(v.rule);
      var ruleSay = v.curve || (v.rule && v.rule.max)
        ? '<div class="hint">' + esc(v.curve ? v.text : 'no curve') + (v.limits.max ? ' · at most ' + v.limits.max + ' XP a turn' : '') +
          (v.curve ? ' · level ' + esc(String(v.level)) + ' at ' + v.xp + ' XP' : '') + '</div>'
        : '';
      var refusedLine = (v.status.declined && v.status.declined.length)
        ? '<div class="hint">Not offered again after you dismissed them: ' + esc(v.status.declined.map(function (d) { return d.label; }).join('; ')) + '</div>' : '';
      var statusActions = [{ label: 'Cancel', cls: 'ghost', value: null }];
      if (wasEnabled) statusActions.push(
        { label: 'Stop tracking', cls: 'ghost', value: 'stop' },
        { label: 'Save status', cls: 'primary', onClick: function (b) { return collectRpgStatus(b); } }
      );
      else statusActions.push({ label: 'Save & start tracking', cls: 'primary', onClick: function (b) { return collectRpgStatus(b); } });
      UI.sheet({
        title: 'RPG status — ' + (session.title || 'chat'),
        body:
          '<div class="hint">This sheet belongs to you in this conversation. Group chats share the same player sheet. AI changes are suggestions only; approve each one before it affects your ledger. With a level curve set, the app works the level and its target out of your XP — the model cannot set them, and one turn cannot move more XP than the cap.</div>' +
          '<div class="group"><div class="group-title">Progression</div>' +
            '<div class="field"><label>Level</label><input id="rpg-level" type="text" maxlength="40" value="' + esc(v.level) + '"' + (v.curve ? ' readonly' : '') + '></div>' +
            '<div class="field"><label>XP</label><input id="rpg-xp" type="number" min="0" step="1" value="' + v.xp + '"></div>' +
            (v.curve
              /* Under a curve the target is arithmetic, so it is shown, not typed —
                 a field a player edits and the app overwrites is a field that lies. */
              ? '<div class="field"><label>Next level</label><input type="text" value="' + esc(v.limits.toNext + ' more XP (at ' + v.limits.nextAt + ' total)') + '" readonly></div>'
              : '<div class="field"><label>XP target for next level (optional)</label><input id="rpg-next" type="number" min="0" step="1" value="' + (current.xpToNext == null ? '' : current.xpToNext) + '"></div>') +
            '<div class="field"><label>Level curve <span class="hint">manual, a step like 100, a growing one like 100 x1.5, or steps like 100,150,300 — add "max:20" to cap one turn</span></label><input id="rpg-rule" type="text" maxlength="80" value="' + esc(ruleText) + '">' + ruleSay + '</div>' +
            refusedLine +
          '</div>' +
          '<div class="group"><div class="group-title">Character sheet</div>' +
            '<div class="field"><label>Attributes <span class="hint">one per line: Strength: 8</span></label><textarea id="rpg-attributes" class="tall" placeholder="Strength: 8\nAgility: 6">' + esc(rpgAttributesText(current.attributes)) + '</textarea></div>' +
            '<div class="field"><label>Skills <span class="hint">one per line</span></label><textarea id="rpg-skills" class="tall" placeholder="Swordsmanship\nPersuasion">' + esc(current.skills.join('\n')) + '</textarea></div>' +
            '<div class="field"><label>Inventory <span class="hint">one item per line</span></label><textarea id="rpg-inventory" class="tall" placeholder="Iron sword\nHealing potion">' + esc(current.inventory.join('\n')) + '</textarea></div>' +
            '<div class="field"><label>Notes <span class="hint">one per line</span></label><textarea id="rpg-notes" class="tall" placeholder="Quest clues, rules, status details">' + esc(current.notes.join('\n')) + '</textarea></div>' +
          '</div>' +
          '<div class="field compact"><label>Let the AI suggest status changes</label><div class="toggle' + (current.suggestionsEnabled ? ' on' : '') + '" id="rpg-suggestions"></div><div class="hint">You review and approve every proposed XP, level, attribute, skill, inventory, or note change.</div></div>',
        actions: statusActions,
        onMount: function (b) {
          var toggle = b.querySelector('#rpg-suggestions');
          toggle.onclick = function () { current.suggestionsEnabled = !current.suggestionsEnabled; toggle.classList.toggle('on', current.suggestionsEnabled); };
        }
      }).then(function (result) {
        if (!result) return;
        if (result === 'stop') {
          session.rpgStatus = Object.assign({}, current, { enabled: false });
          return Store.putSession(session).then(function () {
            if (App.state.session && App.state.session.id === session.id) App.state.session = session;
            UI.toast('RPG status tracking stopped');
          });
        }
        if (typeof result !== 'object') return;
        session.rpgStatus = API.rpgNormalize({
          enabled: true,
          level: result.level, xp: result.xp,
          /* Under a curve the target the player typed is not a fact about the
             ledger, it is a wish: leave it out so the derived one stands. */
          xpToNext: v.curve ? null : (result.xpToNext === '' || result.xpToNext === undefined ? null : result.xpToNext),
          rule: result.rule,
          attributes: parseRpgAttributes(result.attributes),
          skills: rpgLines(result.skills), inventory: rpgLines(result.inventory), notes: rpgLines(result.notes),
          declined: current.declined, suggestionsEnabled: !!result.suggestionsEnabled
        });
        return Store.putSession(session).then(function () {
          if (App.state.session && App.state.session.id === session.id) App.state.session = session;
          UI.toast(wasEnabled ? 'RPG status saved' : 'RPG status tracking started');
        });
      });
    });
  };

  function collectRpgStatus(body) {
    return {
      level: body.querySelector('#rpg-level').value,
      xp: body.querySelector('#rpg-xp').value,
      xpToNext: (body.querySelector('#rpg-next') || {}).value,
      rule: body.querySelector('#rpg-rule').value,
      attributes: body.querySelector('#rpg-attributes').value,
      skills: body.querySelector('#rpg-skills').value,
      inventory: body.querySelector('#rpg-inventory').value,
      notes: body.querySelector('#rpg-notes').value,
      suggestionsEnabled: body.querySelector('#rpg-suggestions').classList.contains('on')
    };
  }

  function rpgChangeLabel(change) {
    if (!change) return '';
    if (change.field === 'xp') return (change.op === 'add' && change.value >= 0 ? '+' : '') + change.value + ' XP' + (change.op === 'set' ? ' (set total)' : '');
    if (change.field === 'level') return 'Level → ' + change.value;
    if (change.field === 'attributes') return change.op === 'remove' ? 'Remove attribute: ' + change.key : change.key + ' → ' + change.value;
    var label = change.field === 'inventory' ? 'Item' : (change.field === 'skills' ? 'Skill' : 'Note');
    return (change.op === 'add' ? 'Add ' : 'Remove ') + label + ': ' + change.value;
  }

  /* The only writer of the ledger besides this sheet, so it is where the rules
     are enforced: `API.rpgApplyUpdate` re-derives the level and the target from
     the curve, spends the per-turn XP cap across the whole change list rather
     than per line, and reports what it had to throw away. `notes` is an optional
     object the caller hands in to read that report — a refusal trimmed silently
     is a cap nobody can see working. */
  function applyRpgProposal(status, proposal, notes) {
    var res = API.rpgApplyUpdate(status, proposal.changes, { at: (App.state.session && App.state.session.messageCount) || 0 });
    if (notes) { notes.dropped = res.dropped; notes.label = res.label; }
    return res.status;
  }

  App.reviewRpgStatusProposal = function (message) {
    var proposal = message && message.rpgStatusProposal;
    if (!proposal || proposal.state !== 'pending') return;
    var safeProposal = API.parseRpgUpdate('<rpg_update>' + JSON.stringify({ reason: proposal.reason, changes: proposal.changes }) + '</rpg_update>');
    if (!safeProposal) return UI.toast('This status suggestion is invalid and cannot be applied');
    proposal.reason = safeProposal.reason;
    proposal.changes = safeProposal.changes;
    IDB.get('sessions', message.sessionId).then(function (session) {
      if (!session || !session.rpgStatus || !session.rpgStatus.enabled) {
        UI.toast('Start RPG status tracking before applying this suggestion');
        return;
      }
      var v = API.rpgView(session.rpgStatus);
      var changes = proposal.changes.map(function (change) {
        return '<div class="kv"><span>' + esc(rpgChangeLabel(change)) + '</span></div>';
      }).join('');
      /* Compute the answer before asking, with the functions that will be used to
         write it: "Apply" then promises nothing the sheet has not already shown,
         and a refusal by the curve is visible before it happens, not after. */
      var after = API.rpgApplyUpdate(session.rpgStatus, proposal.changes, {});
      UI.sheet({
        title: 'Review RPG status update',
        body: '<div class="field"><b>Why it was suggested</b><div class="hint">' + esc(proposal.reason || 'Story event') + '</div></div>' +
          '<div class="group"><div class="group-title">Proposed changes</div>' + changes + '</div>' +
          '<div class="hint">Nothing changes unless you choose Apply. The fictional characters will not be told about this bookkeeping unless the story establishes they know.</div>' +
          (v.curve ? '<div class="hint">Level and target come from your curve (' + esc(v.text) + (v.limits.max ? ', at most ' + v.limits.max + ' XP per turn' : '') + '), not from the model.</div>' : '') +
          '<div class="hint">Your ledger after Apply: level ' + esc(String(after.status.level)) + ' · ' + after.status.xp + ' XP' + (after.status.xpToNext == null ? '' : ' · ' + Math.max(0, after.status.xpToNext - after.status.xp) + ' to the next one') + '</div>' +
          (after.dropped && after.dropped.length ? '<div class="hint">The curve will cut this down: ' + esc(after.dropped.join('; ')) + '</div>' : '') +
          (v.status.declined && v.status.declined.length ? '<div class="hint">Dismissed here are not offered again: ' + esc(v.status.declined.map(function (d) { return d.label; }).join('; ')) + '</div>' : ''),
        actions: [
          { label: 'Later', cls: 'ghost', value: null },
          { label: 'Dismiss', cls: 'ghost', value: 'dismiss' },
          { label: 'Apply changes', cls: 'primary', value: 'apply' }
        ]
      }).then(function (choice) {
        if (!choice) return;
        var notes = {};
        if (choice === 'apply') {
          session.rpgStatus = applyRpgProposal(session.rpgStatus, proposal, notes);
          proposal.state = 'applied';
          if (notes.dropped && notes.dropped.length) proposal.dropped = notes.dropped;
        } else {
          /* Dismissal used to be invisible: the tag is stripped from the reply
             before the reply is stored, so the model never learned it had been
             refused and asked for the same +10 XP every turn for ever. "Later"
             is not a refusal and stays out of this list. */
          proposal.state = 'dismissed';
          session.rpgStatus = API.rpgApplyUpdate(session.rpgStatus, proposal.changes, {
            decline: true, at: session.messageCount || 0
          }).status;
        }
        return Promise.all([Store.putSession(session), Store.updateMessage(message)]).then(function () {
          if (App.state.session && App.state.session.id === session.id) {
            App.state.session = session;
            Views.thread(App.state.char, session, App.state.messages);
          }
          UI.toast(choice === 'apply'
            ? 'RPG status updated' + (notes.dropped && notes.dropped.length ? ' — the curve refused: ' + notes.dropped.join('; ') : '')
            : 'Dismissed — the model was told not to ask for that again', 3800);
        });
      });
    });
  };

  App.sessionMenu = function (id) {
    IDB.get('sessions', id).then(function (s) {
      if (!s) return;
      var rpg = s.rpgStatus && s.rpgStatus.enabled ? API.rpgView(s.rpgStatus) : null;
      UI.sheet({
        title: s.title || 'New chat',
        body:
          '<div class="opt" data-a="pin">' + icon('plus') + (s.pinned ? ' Unpin' : ' Pin to top') + '</div>' +
          '<div class="opt" data-a="archive">' + icon('download') + (s.archived ? ' Unarchive' : ' Archive') + '</div>' +
          '<div class="opt" data-a="rename">' + icon('edit') + ' Rename</div>' +
          '<div class="opt" data-a="settings">' + icon('edit') + ' Chat settings</div>' +
          '<div class="opt" data-a="rpg-status">' + icon('brain') + (s.rpgStatus && s.rpgStatus.enabled
            /* Read through the same view as the sheet and the prompt, so the menu
               cannot show a target the curve has already passed. */
            ? ' RPG status · level ' + esc(String(rpg.level)) + ' · ' + rpg.xp + ' XP' +
              (rpg.limits.toNext > 0 ? ' · ' + rpg.limits.toNext + ' to go' : '')
            : ' Start RPG status tracking') + '</div>' +
          '<div class="opt" data-a="continuity">' + icon('brain') + (s.continuity && s.continuity.enabled
            ? ' Continuity · ' + esc(s.continuity.stage || s.continuity.location || 'enabled')
            : ' Set up chat continuity') + '</div>' +
          '<div class="opt" data-a="health">' + icon('brain') + ' Chat health</div>' +
          '<div class="opt" data-a="mem">' + icon('brain') + ' Story memory</div>' +
          '<div class="opt" data-a="chatlore">Chat-only lore' +
            ((s.chatLorebook && s.chatLorebook.length) ? ' (' + s.chatLorebook.length + ')' : '') + '</div>' +
          '<div class="opt" data-a="inspector">' + icon('brain') + ' Prompt & context inspector</div>' +
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
              else if (a === 'rpg-status') App.rpgStatusSheet(id);
              else if (a === 'continuity') App.continuitySheet(id);
              else if (a === 'health') App.chatHealthSheet(id);
              else if (a === 'fork') App.forkTimeline(id);
              else if (a === 'mem') App.memorySheet(id);
              else if (a === 'chatlore') App.chatLoreBookSheet(id);
              else if (a === 'inspector') App.promptInspector(id);
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

  /* ---------------- text scripts (v1.45.0) ----------------
   * The list is replaced whole, never mutated in place, because DEFAULTS' array is
   * shared by every settings merge. `close: false` on Save is deliberate: a rule
   * that would freeze the screen has to be refused while the user can still fix it,
   * not accepted and reported afterwards. */
  App.regexSampleText = function () {
    var msgs = App.state && App.state.messages;
    if (Array.isArray(msgs)) {
      for (var i = msgs.length - 1; i >= 0; i--) {
        if (msgs[i] && msgs[i].role === 'assistant' && String(msgs[i].text || '').length > 40) {
          return String(msgs[i].text);
        }
      }
    }
    return 'She looked up from the ledger. "Alice: get down here," he shouted over the rain, ' +
      'and the lamp turned twice before it caught. *a stage direction you did not ask for*';
  };

  App.regexScriptsSheet = function () {
    var list = Array.isArray(Store.settings.regexScripts) ? Store.settings.regexScripts.slice() : [];
    var rows = list.map(function (sc, i) {
      var find = String(sc.pattern || '');
      if (find.length > 46) find = find.slice(0, 43) + '…';
      var repl = String(sc.replacement == null ? '' : sc.replacement);
      if (repl.length > 26) repl = repl.slice(0, 23) + '…';
      return '<div class="opt" data-idx="' + i + '" style="align-items:flex-start;gap:8px">' +
        '<span style="flex:1;min-width:0"><b style="display:block">' + esc(sc.name || 'Script ' + (i + 1)) +
        (sc.enabled === false ? ' <span style="color:var(--dim);font-weight:400">off</span>' : '') + '</b>' +
        '<code style="display:block;font-size:11.5px;overflow-wrap:anywhere">' + esc(find) + '</code>' +
        '<span style="display:block;font-size:11.5px;color:var(--muted);margin-top:2px">→ ' +
        (repl ? esc(repl) : '<i>deleted</i>') + '</span></span></div>';
    }).join('');
    return UI.sheet({
      title: 'Text scripts',
      body:
        '<div class="hint" style="margin:0 0 8px">' +
        (Store.settings.regexOn
          ? 'On — these run over each reply as it is drawn, and over chat lists. The stored chat is never changed.'
          : '<b>Off.</b> These rules are kept, but nothing is changed on screen until you switch scripts on in Settings → Generation.') +
        '</div>' +
        (rows || '<div class="hint" style="margin:0 0 8px">No rules yet. A rule is a find pattern and a replacement: ' +
          'for a habit the model has that you cannot train out, a name you want shortened, a marker you want gone.</div>') +
        '<div class="opt" data-new="1">' + icon('plus') + ' Add a rule</div>' +
        (list.length
          ? '<div class="opt" data-toggle-all="1">' + icon('refresh') + ' ' +
            (Store.settings.regexOn ? 'Turn all scripts off' : 'Turn all scripts on') + '</div>'
          : ''),
      dismissible: true,
      onMount: function (b, close) {
        Array.prototype.forEach.call(b.querySelectorAll('.opt'), function (el) {
          el.onclick = function () {
            var idx = el.getAttribute('data-idx');
            if (idx !== null) { close(); App.regexScriptEditor(Number(idx), list); return; }
            if (el.getAttribute('data-new') !== null) { close(); App.regexScriptEditor(-1, list); return; }
            if (el.getAttribute('data-toggle-all') !== null) {
              Store.saveSettings({ regexOn: Store.settings.regexOn !== true });
              close();
            }
          };
        });
      }
    });
  };

  App.regexScriptEditor = function (idx, list) {
    var cur = (idx >= 0 && list[idx]) ? list[idx] : { name: '', pattern: '', replacement: '$1', flags: 'gi', enabled: true };
    var sample = App.regexSampleText();
    var preview = function (sc) {
      var t = API.scriptTest(sc.pattern, sc.replacement, sc.flags, sample);
      if (!t.ok) return '<div class="hint" style="margin-top:8px;color:#e5484d">' + esc(t.why) + '</div>';
      return '<div class="hint" style="margin-top:8px">' +
        (t.hits ? t.hits + ' match' + (t.hits === 1 ? '' : 'es') + ' in the sample' : 'Nothing in the sample matches this pattern yet') +
        ' · ' + t.ms + ' ms</div>' +
        (t.changed
          ? '<div class="hint" style="margin-top:6px"><b>Before</b><div style="margin-top:2px;overflow-wrap:anywhere">' + esc(t.before) + '</div></div>' +
            '<div class="hint" style="margin-top:6px"><b>After</b><div style="margin-top:2px;overflow-wrap:anywhere">' + esc(t.after) + '</div></div>'
          : '');
    };
    var read = function (b) {
      return {
        id: cur.id || UI.uid('rx'),
        name: String(b.querySelector('#rx-name').value || '').trim().slice(0, 60),
        pattern: String(b.querySelector('#rx-pattern').value || '').slice(0, 400),
        replacement: String(b.querySelector('#rx-repl').value || '').slice(0, 400),
        flags: String(b.querySelector('#rx-flags').value || 'gi').slice(0, 8),
        enabled: cur.enabled !== false
      };
    };
    UI.sheet({
      title: idx >= 0 ? 'Edit script ' + (idx + 1) : 'New script',
      body:
        '<div class="field"><div class="field-head"><label>Name (optional)</label></div>' +
          '<input id="rx-name" maxlength="60" value="' + esc(cur.name || '') + '" placeholder="no asterisks"></div>' +
        '<div class="field"><div class="field-head"><label>Find</label></div>' +
          '<textarea id="rx-pattern" class="tall" placeholder="what to look for"></textarea>' +
          '<div class="hint">A JavaScript regular expression, written the way you would write one in code. ' +
          'It is tried against the reply you last received, or a sample passage if this chat has none.</div></div>' +
        '<div class="field"><div class="field-head"><label>Replace with</label></div>' +
          '<textarea id="rx-repl" placeholder="$1">' + esc(cur.replacement == null ? '' : cur.replacement) + '</textarea>' +
          '<div class="hint">Leave it empty to delete what the pattern finds. ' +
          'Dollar-one, dollar-two and dollar-zero refer back to the matched groups.</div></div>' +
        '<div class="field"><div class="field-head"><label>Flags</label></div>' +
          '<input id="rx-flags" maxlength="8" value="' + esc(cur.flags || 'gi') + '" placeholder="gi">' +
          '<div class="hint">g for every occurrence, i to ignore case, m for line anchors, s so a dot matches a newline. ' +
          'Anything else is ignored; g is always on, since a rule that only fixes the first instance surprises people.</div></div>' +
        '<div id="rx-prev">' + preview(cur) + '</div>',
      onMount: function (b) {
        ['rx-pattern', 'rx-repl', 'rx-flags'].forEach(function (idv) {
          var el = b.querySelector('#' + idv);
          if (el) el.oninput = function () {
            var box = b.querySelector('#rx-prev');
            if (box) box.innerHTML = preview(read(b));
          };
        });
      },
      actions: [
        { label: 'Save', cls: 'primary', close: false, onClick: function (b) {
            var sc = read(b);
            var t = API.scriptTest(sc.pattern, sc.replacement, sc.flags, sample);
            if (!t.ok) { UI.toast(t.why, 7000); return; }
            var next = list.slice();
            if (idx >= 0) next[idx] = sc; else next.push(sc);
            Store.saveSettings({ regexScripts: next });
            UI.toast('Script saved' + (Store.settings.regexOn ? '' : ' — still switched off in Settings'), 6000);
            UI.closeSheet();
          } },
        idx >= 0 ? { label: cur.enabled === false ? 'Enable' : 'Disable', cls: 'ghost', close: false, onClick: function (b) {
            var sc = read(b);
            sc.enabled = cur.enabled === false;
            var next = list.slice();
            next[idx] = sc;
            Store.saveSettings({ regexScripts: next });
            UI.closeSheet();
          } } : null,
        idx >= 0 ? { label: 'Delete', cls: 'danger', onClick: function () {
            var next = list.slice();
            next.splice(idx, 1);
            Store.saveSettings({ regexScripts: next });
            UI.toast('Script deleted');
          } } : null,
        { label: 'Cancel', cls: 'ghost', value: null }
      ].filter(Boolean)
    });
  };

  /* One assembly, two renderers (v1.45.0). The .txt export used to build its text and
     its memory block inside one expression, so a second format meant either copying
     that logic — and drifting from it — or not offering the format. The rows are
     decided once here, speaker labels and retired facts included, and each renderer
     only says them in its own voice. Display scripts are NOT applied: a transcript is
     what the model wrote, not what your screen showed. */
  App.transcriptParts = function (s, c, msgs) {
    var turns = (msgs || []).map(function (m) {
      if (m.role === 'user') {
        return { who: Store.settings.userName, text: m.text || '', image: m.image || null, caption: m.imageCaption || null, me: true };
      }
      var sp = API.splitSpeaker(c, s, m.text || '');
      return { who: sp.name, text: sp.text, image: m.image || null, caption: m.imageCaption || null, me: false };
    });
    return {
      turns: turns,
      createdAt: s && s.createdAt,
      summary: (s && s.summary) || '',
      facts: API.chatFactObjects(s).filter(function (f) { return f.to === null || f.to === undefined; }),
      retired: API.pastChatFacts(s),
      hasMemory: !!(s && s.summary) || API.chatFactObjects(s).length > 0 || API.pastChatFacts(s).length > 0
    };
  };
  App.renderTranscriptTxt = function (parts, title, charName) {
    return '# ' + charName + ' — ' + title + '\n' +
      '# ' + new Date(parts.createdAt || Date.now()).toLocaleString() + '\n\n' +
      parts.turns.map(function (t) {
        return t.who + ': ' + t.text + (t.image ? '\n[image: ' + t.image + ']' : '');
      }).join('\n\n') +
      (parts.hasMemory
        ? '\n\n---\nMemory: ' + parts.summary +
          parts.facts.map(function (f) { return '\n- ' + f.text; }).join('') +
          (parts.retired.length
            ? '\n\nNo longer true:\n' + parts.retired.map(function (f) {
                return '- ' + f.text + ' (until message ' + (f.to || 0) + ')';
              }).join('')
            : '')
        : '');
  };
  App.renderTranscriptMd = function (parts, title, charName) {
    var out = ['# ' + charName + ' — ' + title, '',
      '_Exported ' + new Date(parts.createdAt || Date.now()).toLocaleString() + ' · ' +
      parts.turns.length + ' messages_', ''].join('\n');
    out += parts.turns.map(function (t) {
      var block = '**' + t.who + ':** ' + String(t.text || '').trim();
      if (t.image) block += '\n\n' + (t.caption ? '![' + t.caption + '](' + t.image + ')' : '_(image attached)_');
      return block;
    }).join('\n\n');
    if (parts.hasMemory) {
      out += '\n\n---\n\n## What the chat remembered';
      if (parts.summary) out += '\n\n> ' + String(parts.summary).split('\n').join('\n> ');
      if (parts.facts.length) {
        out += '\n\nStill true:\n' + parts.facts.map(function (f) {
          return '- ' + f.text + ' (from message ' + (f.from || 0) + ')';
        }).join('\n');
      }
      if (parts.retired.length) {
        out += '\n\nNo longer true:\n' + parts.retired.map(function (f) {
          return '- ' + f.text + ' (stopped being true at message ' + (f.to || 0) + ')';
        }).join('\n');
      }
    }
    return out + '\n';
  };
  /* ---------------- searching inside chats (v1.45.0) ----------------
   * The box used to answer from the sessions index alone: character name, title,
   * summary. Good for finding "the one with Marcus", useless for "the chat where
   * the boat sank" — that phrase is 140 messages deep and the title is "New chat".
   * Message bodies live in a separate store with no text index, so this is a scan,
   * not a query: the indexed part answers immediately and the scan paints itself in
   * when it finishes. Both bounds are deliberate. A phone can read a few hundred
   * chats; it should not look like it hung while doing it, so the scan yields
   * between chats, says how far it got, and stops rather than walking a
   * four-figure archive for a two-letter word. */
  var SEARCH_MIN_CHARS = 3;        /* below this, "a" matches every chat in the app */
  var SEARCH_SCAN_SESSIONS = 250;
  var SEARCH_SCAN_MESSAGES = 400;
  var SEARCH_SNIPPET = 90;

  App.searchWords = function (q) {
    return String(q || '').trim().toLowerCase().split(/\s+/).filter(function (w) {
      return w.length >= 2;
    }).slice(0, 8);
  };

  /* One entry point, so typing, clearing and the jump all leave the same state
     behind: the query, the words to look for, and a scan that has not yet been
     allowed to start — a keystroke in the middle of a word must not fire 250
     IndexedDB reads. */
  App.setChatSearch = function (q) {
    App.state.chatSearch = q;
    if (App.state.searchTimer) { clearTimeout(App.state.searchTimer); App.state.searchTimer = null; }
    var words = App.searchWords(q);
    App.state.searchRun = (App.state.searchRun || 0) + 1;   /* any scan in flight is now stale */
    if (String(q || '').trim().length < SEARCH_MIN_CHARS || !words.length) {
      App.state.search = null;
    } else {
      App.state.search = {
        q: String(q).trim().toLowerCase(), words: words, hits: {},
        scanned: 0, total: 0, running: true, done: false, capped: false,
        run: App.state.searchRun
      };
    }
    var root = $('.screen');
    if (root) Views.chats(root);
    if (App.state.search) {
      App.state.searchTimer = setTimeout(function () {
        App.state.searchTimer = null;
        App.searchBodies();
      }, 260);
    }
  };

  /* Read every chat's tail. Resolves with the hit map; the list is repainted as it
     goes, because a scan nobody can see is worse than a slow one. */
  App.searchBodies = function () {
    var st = App.state.search;
    if (!st || st.run !== App.state.searchRun) return Promise.resolve({});
    var repaint = function () {
      if (st.run !== App.state.searchRun) return;
      var root = $('.screen');
      if (root && App.state.screen !== 'chat') { try { Views.chats(root); } catch (e) { /* view is gone */ } }
    };
    return IDB.getAll('sessions').then(function (all) {
      if (st.run !== App.state.searchRun) return st.hits;
      var pool = (all || []).filter(function (s) { return !s.archived || App.state.showArchived; });
      var list = pool.slice(0, SEARCH_SCAN_SESSIONS);
      if (pool.length > list.length) st.capped = true;
      st.total = list.length;
      var i = 0;
      var step = function () {
        if (st.run !== App.state.searchRun) return st.hits;
        if (i >= list.length) {
          st.running = false; st.done = true; repaint();
          return st.hits;
        }
        var s = list[i]; i++;
        return Promise.resolve(Store.getMessages(s.id)).then(function (msgs) {
          if (st.run !== App.state.searchRun) return st.hits;
          if (msgs && msgs.length > SEARCH_SCAN_MESSAGES) st.capped = true;
          var hit = App.scanForWords(msgs || [], st.words);
          if (hit.count) st.hits[s.id] = hit;
          st.scanned = i;
          if (i % 5 === 0) repaint();
          return step();
        }, function () { return step(); });
      };
      return step();
    }, function () { st.running = false; st.done = true; return st.hits; });
  };

  /* The oldest match wins the jump, not the newest: a chat you are looking for by
     what happened in it usually starts before the moment you remember. Words are
     ANDed within a message, the same rule the titles use, so a two-word query does
     not turn up every chat that mentions either of them. */
  App.scanForWords = function (msgs, words) {
    var out = { count: 0, first: null, snippet: '', role: '' };
    var list = (msgs && msgs.length > SEARCH_SCAN_MESSAGES)
      ? msgs.slice(msgs.length - SEARCH_SCAN_MESSAGES) : (msgs || []);
    for (var k = 0; k < list.length; k++) {
      var m = list[k];
      if (!m) continue;
      var hay = String(m.text || '');
      if (!hay) continue;
      var low = hay.toLowerCase(), at = -1, ok = true;
      for (var w = 0; w < words.length; w++) {
        var idx = low.indexOf(words[w]);
        if (idx < 0) { ok = false; break; }
        if (at < 0 || idx < at) at = idx;
      }
      if (!ok || at < 0) continue;
      if (!out.first) { out.first = m.id; out.role = m.role === 'user' ? 'you' : 'reply'; }
      if (out.count < 25) {
        out.count++;
        if (out.count === 1) out.snippet = App.searchCut(hay, at);
      }
    }
    return out;
  };

  App.searchCut = function (text, at) {
    var start = Math.max(0, at - Math.floor(SEARCH_SNIPPET / 3));
    var end = Math.min(text.length, start + SEARCH_SNIPPET);
    return (start > 0 ? '…' : '') + text.slice(start, end).replace(/\s+/g, ' ').trim() +
      (end < text.length ? '…' : '');
  };

  /* The row prints the matched words itself. Words are escaped for the regex and
     the text is escaped for HTML, in that order — the other way round the marks
     eat the entities. */
  App.searchSnippet = function (hit, words) {
    var raw = String((hit && hit.snippet) || '');
    var re = null;
    try {
      var alts = (words || []).filter(function (w) { return w && w.length >= 2; })
        .map(function (w) { return w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); });
      if (alts.length) re = new RegExp('(' + alts.join('|') + ')', 'gi');
    } catch (e) { re = null; }
    if (!re) return esc(raw);
    var out = '', last = 0, guard = 0;
    raw.replace(re, function (mm, g1, pos) {
      if (guard++ > 60) return mm;
      out += esc(raw.slice(last, pos)) + '<mark>' + esc(mm) + '</mark>';
      last = pos + mm.length;
      return mm;
    });
    return out + esc(raw.slice(last));
  };

  App.searchProgress = function () {
    var st = App.state.search;
    if (!st || st.done) return '';
    var t = 'Reading ' + st.scanned + (st.total ? ' of ' + st.total : '') + ' chats for that phrase…';
    if (st.capped) t += ' (stopped early — a longer phrase narrows it)';
    return t;
  };

  /* Jumping in from a result: land on the message, and light every other one that
     matches so you can see how much of the chat the phrase runs through. DOM-only
     on purpose — the marks must not reach the stored thread, and re-rendering it
     is the whole undo. */
  App.focusMessage = function (mid) {
    var thread = $('#thread');
    if (!thread) return;
    var lit = 0;
    var words = App.searchWords(App.state.chatSearch || '');
    if (words.length) {
      Array.prototype.forEach.call(thread.querySelectorAll('.msg'), function (el) {
        var t = (el.textContent || '').toLowerCase();
        if (words.every(function (w) { return t.indexOf(w) !== -1; })) {
          if (!mid || el.getAttribute('data-mid') !== String(mid)) { el.classList.add('msg-hit'); lit++; }
        }
      });
    }
    var el = null;
    if (mid && /^[\w:-]+$/.test(String(mid))) {
      el = thread.querySelector('.msg[data-mid="' + mid + '"]');
    }
    if (el) {
      el.classList.remove('msg-hit');
      el.classList.add('msg-find');
      if (el.scrollIntoView) { try { el.scrollIntoView({ block: 'center' }); } catch (e) { el.scrollIntoView(); } }
      setTimeout(function () { el.classList.remove('msg-find'); }, 2800);
      /* v1.45.0: the count is a footnote to a jump that worked. Toasts replace
         each other, so reporting it after a failure would erase the message that
         mattered — "that line is gone" — with a number nobody asked for. */
      if (lit) UI.toast(lit + ' other matching message' + (lit === 1 ? '' : 's') + ' here', 3500);
    } else if (mid) {
      UI.toast('That message is gone from this chat');
    }
  };

  App.exportTranscript = function (id, format) {
    /* returned, so a caller — or a test — can wait for the file to be built */
    return Promise.all([IDB.get('sessions', id), Store.getMessages(id)]).then(function (r) {
      var s = r[0], msgs = r[1];
      return Promise.resolve(Store.getCharacter(s.charId)).then(function (c) {
        var parts = App.transcriptParts(s, c, msgs);
        var title = s.title || 'New chat', charName = c ? c.name : 'Character';
        var stem = (charName + '-' + title).replace(/[^\w\- ]+/g, '').replace(/\s+/g, '_');
        if (format === 'md') {
          UI.download(stem + '.md', App.renderTranscriptMd(parts, title, charName), 'text/markdown');
        } else {
          UI.download(stem + '.txt', App.renderTranscriptTxt(parts, title, charName), 'text/plain');
        }
      });
    }).catch(function (e) { UI.toast('Could not export this chat: ' + (e && e.message), 5000); });
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
  /* v1.39.79: "what turn am I on?" had no answer anywhere on screen. The
     subtitle now carries it, and it is recomputed whenever the thread
     changes rather than only when the chat is opened. A turn is one message
     you sent — a reply, a reroll and a Continue all belong to the same turn,
     which is the only reading that survives someone continuing a cut reply. */
  App.chatTurn = function (messages) {
    var n = 0;
    (messages || []).forEach(function (m) { if (m.role === 'user' && !m.autonomous) n++; });
    return n;
  };

  App.chatSubtitle = function () {
    var ch = App.state.char, session = App.state.session;
    var groupMembers = App.state.groupCharacters || [];
    var isGroup = groupMembers.length > 1;
    var sub = session ? (session.title || 'New chat') : '';
    if (isGroup) {
      sub = groupMembers.map(function (x) { return x.name || 'Unnamed'; }).join(' + ') + ' · ' + sub;
    }
    /* Who you are in this thread — worth stating, since switching personas
       swaps which of a character's conversations you are looking at. */
    if (Store.settings.activePersona) sub = 'as ' + Store.personaLabel() + ' · ' + sub;
    if (!isGroup && ch && ch.vh && ch.vh.enabled) sub = VH.status(ch).text + ' · ' + sub;
    /* v1.39.80: the turn used to be appended last, and the header is a single
       ellipsised line — so a real chat title ("First Night on Coruscant · t…")
       pushed it off the edge. It now comes first, where truncation cannot
       reach it: the title is already in the Chats list, the turn is not. */
    var turn = App.chatTurn(App.state.messages);
    var lead = turn ? 'turn ' + turn : 'opening';
    return lead + ' · ' + sub;
  };

  App.refreshChatHead = function () {
    var sub = $('#bar-sub');
    if (!sub || App.state.screen !== 'chat') return;
    var text = App.chatSubtitle();
    if (sub.textContent !== text) sub.textContent = text;
  };

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

    /* Capture this turn's message list. App.state is reused while navigating,
       so an async failure must not attach Retry to whichever chat is open later. */
    var generationMessages = st.messages.slice();
    var history = generationMessages.slice();
    var target = null;

    /* v1.39.28: rerolling a continuation bubble re-CONTINUES from its severed
       source, replacing that bubble's take in place — a plain reroll would
       greet the cut text in history and replay it (the v1.39.17 disease). */
    if (opts.rerollFor && opts.rerollFor.continuationOf) {
      var srcId = opts.rerollFor.continuationOf, src = null;
      for (var ci = 0; ci < st.messages.length; ci++) if (st.messages[ci].id === srcId) src = st.messages[ci];
      if (src) {
        opts = { continueFor: src, replaceBubble: opts.rerollFor };
      }
    }

    var groupMembers = st.groupCharacters || [];
    if (groupMembers.length > 1) {
      var pinnedMessage = opts.rerollFor || opts.replaceBubble || opts.continueFor;
      var speakerId = (pinnedMessage && pinnedMessage.speakerId) || (session && session.nextSpeakerId);
      if (!speakerId && session && session.speakerMode === 'auto') {
        var autoSpeaker = App.nextGroupSpeaker(groupMembers, st.messages);
        speakerId = autoSpeaker && autoSpeaker.id;
      }
      var chosenSpeaker = groupMembers.find(function (member) { return member.id === speakerId; });
      if (!chosenSpeaker) {
        UI.toast('Choose the next speaker before generating a group reply');
        App.pickGroupSpeaker(function () { App.generateReply(opts); });
        return;
      }
      char = chosenSpeaker;
    }

    if (opts.rerollFor) {
      target = opts.rerollFor;
      history = history.filter(function (m) { return m.createdAt < target.createdAt || m.id === target.id; });
      history = history.filter(function (m) { return m.id !== target.id; });
    } else if (opts.continueFor) {
      target = opts.continueFor;
      /* v1.39.17: the cut message leaves the context and rides back as the
         assistant prefix (continueFrom below). Generating with the cut text
         still sitting in history used to make the model open a NEW beat
         that echoed the previous one — a rewrite, not a continuation. */
      history = history.filter(function (m) {
        /* replaceBubble (a continuation being re-spun) leaves the context too */
        if (opts.replaceBubble && m.id === opts.replaceBubble.id) return false;
        return m.id !== target.id;
      });
    }

    var msg;
    if (opts.rerollFor || opts.replaceBubble) {
      msg = opts.rerollFor || opts.replaceBubble;
      msg._stream = msg.text || '';
    } else if (opts.continueFor) {
      /* v1.39.28: Continue no longer rewrites the cut bubble in place — the
         continuation lands in its OWN bubble, seeded from the cut text. The
         original stays exactly as it ended (alt strip and all). */
      msg = { id: UI.uid('m'), sessionId: session.id, role: 'assistant', text: '',
        alts: [], altIdx: 0, createdAt: Date.now(), _stream: '', continuationOf: target.id };
      st.messages.push(msg);
    } else {
      msg = { id: UI.uid('m'), sessionId: session.id, role: 'assistant', text: '', alts: [], altIdx: 0, createdAt: Date.now(), _stream: '' };
      st.messages.push(msg);
    }
    if (groupMembers.length > 1) {
      msg.speakerId = char.id;
      msg.speakerName = char.name || 'Unnamed';
      msg.speakerAvatar = char.avatar || '';
    }

    /* v1.39.12: a re-spin edits the SAME bubble in place. appendMessage was
       handed the target message too, so the thread briefly held one message
       twice — cancel left two identical bubbles on screen until a reload
       quietly erased the clone; a provider error even dropped the stored
       message while its stale bubble stayed. Never again: the target's own
       element is the stage, and the old text sits in it until the new take
       lands whole. */
    var el = (opts.rerollFor || opts.replaceBubble)
      ? document.querySelector('#thread [data-mid="' + msg.id + '"]')
      : null;
    if (!el) el = Views.appendMessage(char, msg);
    el.classList.add('streaming');
    /* (v1.39.23's seam scroll died with the merge: a Continue now finishes
       in a fresh bubble, which followReply anchors on its own.) */
    st.busy = true;
    App.setStop(true);
    /* keep the CPU awake for the whole reply: switching apps or the screen
       going dark otherwise lets Android freeze this process, and the
       in-flight request stops ticking (see js/keepawake.js) */
    if (global.KeepAwake) KeepAwake.hold();

    var vhNote = opts.note || null;
    var rerollSeam = null;
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

    /* A reroll drops the rejected reply from the context, which leaves the
       model looking at exactly what it saw the first time — so it writes the
       same reply again. Tell it what it already tried, and call out replay. */
    if (opts.rerollFor) {
      var prior = [], seenPrior = {};
      var collectPrior = function (t) {
        t = String(t || '').trim();
        if (!t || seenPrior[t]) return;
        seenPrior[t] = true;
        prior.push(t);
      };
      collectPrior(opts.rerollFor.text);
      (opts.rerollFor.alts || []).forEach(collectPrior);
      var openings = prior.slice(-4).map(function (t) {
        return '- ' + String(t).split(/\n+/)[0].replace(/\s+/g, ' ').trim().slice(0, 140);
      }).join('\n');
      var rewrite = 'REWRITE — THIS OVERRIDES THE CARD AND ANY STYLE NOTE.\n' +
        'The reply you are writing replaces an attempt the player rejected. Write a genuinely different reply: ' +
        'a different opening line, different imagery, a different sequence of events. Do not paraphrase the rejected text.\n' +
        'Do not replay an encounter, conversation or action that already appears earlier in this transcript. ' +
        'Move the scene forward from the last message instead of retelling an earlier one.\n' +
        (openings ? 'Rejected already — do not reuse any of this:\n' + openings : '');
      vhNote = vhNote ? vhNote + '\n\n' + rewrite : rewrite;
      /* The same order, restated at the seam: this is the text the model
         reads immediately before writing, so the card cannot outvote it. */
      rerollSeam = 'REWRITE THIS REPLY. The previous attempt was rejected — do not write it again, ' +
        'not even reworded, and do not replay a scene that already happened earlier in the chat. ' +
        'Open on a different line and let the scene move somewhere it has not been yet.' +
        (openings ? '\nRejected openings:\n' + openings : '');
      /* Sampling relief: without it the model walks the same tokens again
         no matter what it was told. Applied to this request only. */
      var t = parseFloat(charSettings.temperature);
      if (!(t > 0)) t = 0.85;
      charSettings.temperature = Math.min(1.2, Math.round((t + 0.15) * 100) / 100);
      if (!charSettings.frequencyPenalty) charSettings.frequencyPenalty = 0.3;
    }

    /* Scene cast: a standing address (v1.39.111).
       This was a one-shot, cleared the moment it was read. Nothing carried who
       was being spoken to from one turn to the next, so a reply could end with
       a character asking the player something and the next reply re-staged a
       room the player had already left. The address now stands until the
       player changes it, and `lastSpeaker` rides with it so the model knows who
       held the floor. Both are cleared by the same events that remove someone
       from the cast - see refreshCast. */
    if (session && Array.isArray(session.sceneCast) && session.sceneCast.length >= 2) {
      var lines = [];
      if (session.addressedTo && session.sceneCast.indexOf(session.addressedTo) !== -1) {
        lines.push('The user is speaking to ' + session.addressedTo + '. Only ' + session.addressedTo +
          ' answers; others present may react briefly but do not answer for ' + session.addressedTo +
          '. This holds until the user speaks to someone else.');
      }
      if (session.lastSpeaker && session.sceneCast.indexOf(session.lastSpeaker) !== -1 &&
          session.lastSpeaker !== session.addressedTo) {
        lines.push('The last voice heard was ' + session.lastSpeaker + '.');
      }
      if (lines.length) {
        var toLine = lines.join('\n');
        vhNote = vhNote ? vhNote + '\n\n' + toLine : toLine;
      }
    }

    /* v1.21.0 (upstream 18.3.5): a save failure is not a provider failure.
       The model already did its work — a finished reply stays in the thread
       and the storage error is surfaced on its own, instead of the generic
       failure path deleting the reply and offering a re-spent retry. */
    function persist() {
      var save = (opts.rerollFor || opts.replaceBubble ? Store.updateMessage(msg) : Store.addMessage(msg));
      return save.then(function (r) { return { saved: true }; }, function (e) {
        if (msg.text && msg.text !== '…') {
          msg.saveFailed = true;
          UI.toast('Reply kept on screen, but it could not be saved: ' + (e && e.message), 6000);
          console.error('reply save failed:', e);
          return { saved: false };
        }
        throw e;
      }).then(function (result) {
        /* v1.39.111: remember who held the floor, so the next request knows it.
           The data was always in the transcript; nothing carried it forward, so
           the model re-staged rooms the player had already left. */
        if (result.saved && session && Array.isArray(session.sceneCast) && session.sceneCast.length >= 2) {
          var heard = String(msg.text || '').split(/\r?\n/).map(function (l) {
            return API.labelledName(l);
          }).filter(Boolean);
          if (heard.length) {
            session.lastSpeaker = heard[heard.length - 1];
            Store.putSession(session);
          }
        }
        if (result.saved && el && el.querySelector) {
          var actions = el.querySelector('.msg-actions');
          if (actions && msg.rpgStatusProposal && !actions.querySelector('[data-act="rpg-review"]')) {
            var review = document.createElement('button');
            review.type = 'button'; review.className = 'chip';
            review.setAttribute('data-act', 'rpg-review');
            review.title = 'Review proposed RPG status changes'; review.textContent = 'Review status update';
            actions.insertBefore(review, actions.firstChild);
          }
          if (actions && msg.continuityProposal && !actions.querySelector('[data-act="continuity-review"]')) {
            var continuityReview = document.createElement('button');
            continuityReview.type = 'button'; continuityReview.className = 'chip';
            continuityReview.setAttribute('data-act', 'continuity-review');
            continuityReview.title = 'Review proposed continuity changes'; continuityReview.textContent = 'Review continuity update';
            actions.insertBefore(continuityReview, actions.firstChild);
          }
        }
        return result;
      });
    }

    App.abort = new AbortController();
    App.genStart(s.provider === 'horde' ? 'Sending to the Horde…' : 'Generating…', App.abort);
    if (API.resetFinish) API.resetFinish();

    /* Replies already in the transcript, newest last. A looping model copies
       itself, and once a repeat is in the context it validates the next one. */
    var priorReplies = (st.messages || []).filter(function (m) {
      return m.role === 'assistant' && m.text && (!target || m.id !== target.id);
    }).slice(-5).map(function (m) { return m.text; });

    /* Once a few replies exist, say plainly that the scene must move. This is
       what stops the loop before it starts; the retry above catches the rest. */
    if (!rerollSeam && priorReplies.length >= 3) {
      rerollSeam = 'Do not retell, replay or reword anything already in this chat. ' +
        'Continue from the last message and let something happen that has not happened yet.';
    }

    /* v1.39.104: the chat's state, said again where it is actually read.
       Only present when this chat has continuity switched on. */
    var chatNow = App.chatNowBrief(session);

    var LOOP_ORDER = 'DO NOT REPEAT YOURSELF. This reply must not retell, replay or reword any beat that ' +
      'already appears in the transcript above, and must not run the same sequence again (arrival, ' +
      'instruction, training, dismissal, rest). Change what happens next: move time, place, or the ' +
      'situation forward in a way the story has not used yet. Say something new.';

    /* v1.39.112: the style lock's corrective used to land in the prompt with no
       surface at all, so a player whose replies abruptly went plain-prose had
       no way to know it was the app. One toast per chat, saying what happened
       and nothing about whose fault it was — the register is observed starting
       from cards with zero asterisks, so the app cannot attribute it. */
    if (session && !session.styleLockNotified && typeof API.styleLock === 'function' &&
        typeof API.requestWindow === 'function') {
      var lockWin = API.requestWindow(history, s).messages;
      if (API.styleLock(lockWin)) {
        var lockStars = 0;
        lockWin.forEach(function (m) {
          if (m && m.role === 'assistant') {
            lockStars += (String(m.text != null ? m.text : (m.content != null ? m.content : '')).match(/\*/g) || []).length;
          }
        });
        session.styleLockNotified = true;
        Store.putSession(session);
        UI.toast('Style lock: recent replies carried ' + lockStars + ' asterisks, so this reply was asked for in plain prose.', 6000);
      }
    }

    var loopTries = 0, bestText = '', bestScore = 2;
    function generateOnce() {
      var extra = opts.continueFor ? null : (loopTries ? LOOP_ORDER : null);
      return API.generate({
      settings: (loopTries ? Object.assign({}, charSettings, {
        temperature: Math.min(1.25, Math.round(((parseFloat(charSettings.temperature) || 0.85) + 0.12 * loopTries) * 100) / 100)
      }) : charSettings), character: char, session: session, history: history,
      continueFrom: opts.continueFor ? (target.text || '') : undefined,
      signal: App.abort ? App.abort.signal : undefined,
      note: vhNote,
      finalNote: [rerollSeam, chatNow, extra].filter(Boolean).join('\n\n') || null,
      onDelta: function (chunk, full) {
        var soFar = full || ((msg._stream || '') + chunk);
        /* v1.39.28: while continuing, `full` is seed + new prose — the new
           bubble shows only its own share as it grows. */
        msg._stream = opts.continueFor && target.text && soFar.indexOf(target.text) === 0
          ? soFar.slice(target.text.length) : soFar;
        var mt = el.querySelector('.mtext');
        var visibleStream = API.hideRpgUpdate ? API.hideRpgUpdate(msg._stream) : msg._stream;
        visibleStream = API.hideContinuityUpdate ? API.hideContinuityUpdate(visibleStream) : visibleStream;
        if (mt) mt.innerHTML = UI.md(visibleStream);
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
        var score = priorReplies.length ? App.repeatScore(text, priorReplies) : 0;
        if (score < bestScore) { bestScore = score; bestText = text; }
        /* A near-copy of an earlier reply is a failed generation, not a
           creative choice: spend up to two more passes before showing it. */
        if (score >= 0.55 && loopTries < 2 && text) {
          loopTries++;
          msg._stream = '';
          App.genSet('That reply repeated an earlier one — writing a different one…');
          return generateOnce();
        }
        return bestText || text;
      });
    }

    generateOnce().then(function (text) {
      text = (text || '').trim();
      /* A valid streaming frame can still finish without visible content.
         Treat that as a failed generation, not a successful reroll that
         silently leaves the old bubble in place. */
      if (!text) throw new Error('The model completed without a visible reply. Retry or choose another model.');
      App.genStop();
      var fin = API.lastFinish ? API.lastFinish() : null;
      if (fin) msg.finishReason = fin;
      var statusProposal = API.parseRpgUpdate ? API.parseRpgUpdate(text) : null;
      var continuityProposal = API.parseContinuityUpdate ? API.parseContinuityUpdate(text) : null;
      text = API.stripRpgUpdate ? API.stripRpgUpdate(text) : text;
      text = API.stripContinuityUpdate ? API.stripContinuityUpdate(text) : text;
      if (opts.rerollFor || opts.replaceBubble) { delete msg.rpgStatusProposal; delete msg.continuityProposal; }
      if (statusProposal && session.rpgStatus && session.rpgStatus.enabled === true &&
          session.rpgStatus.suggestionsEnabled !== false && !(opts.rerollFor || opts.replaceBubble || opts.continueFor)) {
        msg.rpgStatusProposal = {
          state: 'pending', reason: statusProposal.reason,
          changes: statusProposal.changes, createdAt: Date.now()
        };
        UI.toast('A status change was suggested — review the reply action', 4500);
      }
      if (continuityProposal && session.continuity && session.continuity.enabled === true &&
          !(opts.rerollFor || opts.replaceBubble || opts.continueFor)) {
        msg.continuityProposal = {
          state: 'pending', reason: continuityProposal.reason,
          changes: continuityProposal.changes, createdAt: Date.now()
        };
        UI.toast('A continuity change was suggested — review the reply action', 4500);
      }
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
          msg.speakerMood = newState.mood || '';
          msg.speakerPortrait = App.expressionPortraitFor(char, newState.mood);
          Store.putCharacter(char);
          if (groupMembers.length > 1) $('#char-state').hidden = true;
          else Views.stateStrip(char);
          var face = el.querySelector && el.querySelector('.av');
          if (face && Views.avatarHtml) face.innerHTML = Views.avatarHtml(msg.speakerPortrait || char.avatar || '', char.name || 'Character');
        }
      }
      msg._stream = null;
      /* A reply came through — clear retry markers in memory and IndexedDB,
         so an old chip does not return when this chat is reopened. */
      var retryMarkerWrites = clearRetryMarkers(generationMessages);
      if (App.state.screen === 'chat' && App.state.session && App.state.session.id === session.id) {
        var chips = document.querySelectorAll('#thread .chip.retry');
        for (var ci = 0; ci < chips.length; ci++) chips[ci].remove();
      }
      if (!text) { text = '…'; }
      if (opts.continueFor) {
        /* v1.39.28: generate() assembled seed + continuation; only the NEW
           prose belongs to the new bubble. A mid-word seam ("rh" + "ythms")
           heals across the divide — the dangling fragment moves to the front
           of the continuation, so neither bubble shows half a word. */
        var seed = String(target.text || '');
        var seeded = !!seed && text.indexOf(seed) === 0;
        var afterSeed = seeded ? text.slice(seed.length) : text;
        /* a tight join (no glue space) with letters on both sides marks a
           genuinely split word; a space-glued seam is a boundary, not a
           fragment, and an UNseeded reply (no continuation happened) keeps
           the original untouched entirely */
        var newPart = afterSeed.replace(/^\s+/, '').replace(/^[.,!?;:'"”’\)\]\}…]+\s*/, '');
        var fragM = seeded && !/^\s/.test(afterSeed) &&
          /[A-Za-z'\u2019]$/.test(seed) && /^[A-Za-z]/.test(newPart) && seed.match(/[A-Za-z'\u2019]+$/);
        if (fragM && fragM[0].length < seed.length) {
          target.text = seed.slice(0, seed.length - fragM[0].length).replace(/\s+$/, '');
          if (target.alts && target.alts.length) target.alts[target.altIdx || 0] = target.text;
          newPart = fragM[0] + newPart;
          Store.updateMessage(target).catch(function () {});
        }
        msg.text = newPart || '…';
        if (opts.replaceBubble) { msg.alts = msg.alts || []; msg.alts.push(msg.text); msg.altIdx = msg.alts.length - 1; }
        else { msg.alts = [msg.text]; msg.altIdx = 0; }
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
      /* v1.43.0: every character the reader sees has been through
         stripThinking and cleanReply. Keep the model's own text alongside it —
         only when they differ, and only while it is a size worth storing — so a
         cut is a decision the reader can review instead of a fact about the
         model. Restoring is deliberately manual: this text never re-enters a
         prompt or an alt by itself. */
      if (!opts.continueFor && API.replyProvenance) {
        var provInfo = API.replyProvenance(msg.text, text);
        if (provInfo) {
          msg.rawKept = text.length <= 12000;
          msg.raw = msg.rawKept ? text : null;
          msg.rawDropped = provInfo.dropped;
          msg.rawEarlyEnd = !!provInfo.endsEarly;
        } else if (msg.raw !== undefined) {
          delete msg.raw; delete msg.rawKept; delete msg.rawDropped; delete msg.rawEarlyEnd;
        }
      }
      /* v1.39.93: on a card with a cast, the header says who ACTUALLY spoke.
         It used to say the card's name whoever it was — so another speaker's
         line sat under the card's own name — and a reply in which the card's
         character spoke lost her name entirely, because the cleanup treated
         that label as the start of a turn she should not have written. */
      var scene = App.state.session;
      var spoken = (scene && Array.isArray(scene.sceneCast) && scene.sceneCast.length >= 2 && API.splitSpeaker)
        ? API.splitSpeaker(char, scene, msg.text || '') : null;
      if (spoken && spoken.name && spoken.name !== char.name) msg.speakerName = spoken.name;
      else delete msg.speakerName;
      el.classList.remove('streaming');
      /* v1.39.79: everything the bubble shows — text, word count, cut marker,
         continuation label — is rendered at once from the finished message. */
      var rebuilt = Views.refreshMessage ? Views.refreshMessage(char, msg) : null;
      if (rebuilt) el = rebuilt;
      var parts = App.burstFor(char, text);
      if (parts.length > 1 && !(opts.rerollFor || opts.continueFor)) {
        /* independent short texts arrive as separate bubbles */
        msg.text = parts[0];
        msg.alts = [parts[0]];
        msg.altIdx = 0;
        /* v1.43.0: the raw copy describes the WHOLE burst, not this bubble —
           offering it here would show a reader text belonging to three
           messages and invite them to paste all of it into this one. */
        delete msg.raw; delete msg.rawKept; delete msg.rawDropped; delete msg.rawEarlyEnd;
        var rebuilt2 = Views.refreshMessage ? Views.refreshMessage(char, msg) : null;
        if (rebuilt2) el = rebuilt2;
        return retryMarkerWrites.then(function () { return persist(); }).then(function (r) {
          /* if the first bubble could not be saved, the burst parts would
             not be either — keep what is on screen */
          if (!r.saved) return;
          return App.deliverBurst(char, msg, parts);
        });
      }
      return retryMarkerWrites.then(persist);
    }).then(function () {
      if (msg.saveFailed) return;   /* the ledger is down — do not write to it again */
      /* A finished reply must not yank the view to the last word if the
         user scrolled up to read it — follow only when they're at the
         bottom. v1.39.22: and when the reply itself is taller than the
         screen, "follow" means landing on its FIRST line, not its last. */
      App.refreshChatHead();
      var thrF = $('#thread');
      if (Views.followReply) Views.followReply(thrF, el); else Views.stickToBottom(thrF, false);
      App.afterReply();
      App.maybeAutoTitle();
    }).catch(function (e) {
      /* The handler must never throw: if it did, the cleanup below would be
         skipped and the "thinking" dots would run forever. */
      var retryWrite = Promise.resolve();
      try {
        logChatGenerationFailure(e, char, charSettings);
        msg._stream = null;
        App.genStop();
        if (e.name === 'AbortError') {
          if (!msg.text) {
            if (App.state.session && App.state.session.id === session.id) {
              App.state.messages = App.state.messages.filter(function (m) { return m.id !== msg.id; });
            }
            el.remove();
          } else {
            el.classList.remove('streaming');
            /* the take the user stopped never happened — put the bubble back
               to the text it had before the re-spin began (v1.39.28: a plain
               Continue has no old text in its new bubble — removal below
               handles it; only a re-spun continuation restores) */
            if (opts.rerollFor || opts.replaceBubble) {
              var rebuilt3 = Views.refreshMessage ? Views.refreshMessage(char, msg) : null;
              if (rebuilt3) el = rebuilt3;
            }
            Store.updateMessage(msg).catch(function (e) {
              UI.toast('Partial reply kept on screen, but it could not be saved: ' + (e && e.message), 6000);
            });
          }
          UI.toast('Stopped');
        } else if (opts.rerollFor || opts.continueFor) {
          /* the model failed the re-spin, not the story: the bubble and its
             stored text stay exactly as they were */
          el.classList.remove('streaming');
          var rebuilt4 = Views.refreshMessage ? Views.refreshMessage(char, msg) : null;
          if (rebuilt4) el = rebuilt4;
          UI.toast((opts.rerollFor || opts.replaceBubble ? 'Reroll' : 'Continue') + ' failed: ' + e.message, 6000);
        } else {
          el.remove();
          if (App.state.session && App.state.session.id === session.id) {
            App.state.messages = App.state.messages.filter(function (m) { return m.id !== msg.id; });
          }
          /* The Horde already tried five workers and all came back blank — offer a
             Retry on the message the user just wrote, so nothing has to be retyped. */
          var lastUser = null;
          for (var i = generationMessages.length - 1; i >= 0; i--) {
            if (generationMessages[i].role === 'user') { lastUser = generationMessages[i]; break; }
          }
          if (lastUser) {
            retryWrite = persistRetryMarker(lastUser, true);
            /* Save against the original session even if the user navigated
               away while the provider was still responding. */
            if (App.state.screen === 'chat' && App.state.session && App.state.session.id === session.id) {
              Views.thread(char, session, generationMessages);
            }
          }
          /* v1.39.94: a provider outage gets an offer, not just a sentence. */
          if (e && (e.providerDown || e.status >= 500)) {
            App.routeFailureSheet(e);
          } else {
            UI.toast('Error: ' + e.message, 6000);
          }
          console.error(e);
        }
      } catch (inner) {
        console.error('reply error handler failed:', inner);
      }
      return retryWrite;
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
      var resetSpeaker = sess.groupCharIds && sess.groupCharIds.length > 1 &&
        sess.speakerMode !== 'auto' && sess.nextSpeakerId;
      if (resetSpeaker) {
        sess.nextSpeakerId = '';
        return Store.putSession(sess).then(function () {
          st.session = sess;
          App.renderGroupSpeaker();
          var since = Store.sinceMemory(sess);
          if (s.autoMemory && since >= (s.memoryEvery || 14)) App.updateMemory(sess, true);
        });
      }
      st.session = sess;
      var since = Store.sinceMemory(sess);
      if (s.autoMemory && since >= (s.memoryEvery || 14)) App.updateMemory(sess, true);
    });
  };

  App.updateMemory = function (session, silent) {
    var char = App.state.char && App.state.char.id === session.charId ? App.state.char : null;
    return (char ? Promise.resolve(char) : Promise.resolve(Store.getCharacter(session.charId)))
      .then(function (c) {
        var usedMessages = [];
        return Store.getMessages(session.id).then(function (msgs) {
          usedMessages = (msgs || []).slice().sort(function (x, y) { return x.createdAt - y.createdAt; });
          return API.summarize({ settings: Store.settings, character: c, session: session, history: msgs });
        }).then(function (mem) {
          /* v1.39.86: nothing is written unless the model actually produced a
             summary. The old code stored whatever came back — including a
             refusal — and that text then stood in for the whole past on every
             later prompt. */
          if (!mem || !mem.summary || mem.ok === false) {
            /* v1.39.89: say WHY, and keep the raw reply so it can be inspected
               in the Memory sheet instead of vanishing into a toast. */
            App.lastMemoryFailure = {
              at: Date.now(),
              reason: (mem && mem.reason) || 'no usable summary came back',
              raw: (mem && mem.lastRaw) || '',
              characterName: (c && c.name) || '',
              sessionId: session.id,
              /* v1.39.91: what was asked, of which model, and how big it was */
              sent: mem && mem.sentMessages ? mem.sentMessages + ' messages, ~' + mem.sentTokens + ' tokens' : '',
              model: (mem && mem.model) || '',
              window: (mem && mem.window) || 0
            };
            /* v1.39.92: an automatic attempt used to fail in total silence — the
               chat simply never remembered, and nothing said so. It now says so
               once, and then stays quiet for five minutes so a persistent
               failure does not toast after every single reply. */
            var prev = App._memToastAt || {};
            var now = Date.now();
            var recent = prev[session.id] && (now - prev[session.id]) < 5 * 60 * 1000;
            if (!silent) {
              UI.toast('Memory not updated: ' + App.lastMemoryFailure.reason +
                '. Your existing memory is unchanged. See Memory for details.', 6000);
              prev[session.id] = now; App._memToastAt = prev;
            } else if (!recent) {
              UI.toast('Memory not updated: ' + App.lastMemoryFailure.reason + '. See Memory for details.', 4500);
              prev[session.id] = now; App._memToastAt = prev;
            }
            return;
          }
          session.summary = mem.summary;
          /* v1.39.104: facts are records now - a restatement is confirmed, a
             contradiction supersedes, and a fact the model reports as no
             longer true is retired only when the report names it. What the
             prompt is shown is the current list; the rest stays on the chat. */
          var chatFacts = API.applyChatMemory(session, mem);
          session.facts = chatFacts.facts;
          session.memCurrent = chatFacts.current.length;
          session.memAt = session.messageCount || 0;
          /* v1.39.93: remember exactly which turns this memory describes, so a
             reroll of one of them can be recognised as "the basis changed"
             instead of leaving a summary of a reply that no longer exists. */
          session.memAnchorCount = usedMessages.length;
          session.memAnchorHash = App.transcriptHash(usedMessages);
          session.memManual = false;
          return Store.putSession(session).then(function () {
            if (App.state && App.state.session && App.state.session.id === session.id) App.state.session = session;
            if (!silent) UI.toast('Memory updated');
            else UI.toast('Memory updated (' + (chatFacts.current.length || 0) + ' facts)');
          });
        }).catch(function (e) { if (!silent) UI.toast('Memory failed: ' + e.message, 4000); });
      });
  };

  /* A cheap digest of a run of messages: id + the alt that is showing. Two
     different replies in the same slot hash differently, which is exactly the
     question a reroll asks. */
  App.transcriptHash = function (msgs) {
    var h = 5381;
    (msgs || []).forEach(function (m) {
      var s = String(m.id || '') + '\u0001' + String(m.text || '');
      for (var i = 0; i < s.length; i++) h = (((h * 33) >>> 0) ^ s.charCodeAt(i)) >>> 0;
    });
    return h.toString(36);
  };

  /* v1.39.93: memory describes a story. If the replies it was built on are
     rerolled, edited or deleted, it describes a story that did not happen —
     so once the conversation CONTINUES past that point (the player sends the
     next message), the stale memory is dropped and will be rebuilt from the
     story that is actually there. Swiping back to the original reply restores
     the match and nothing is lost. Hand-written memory is left alone. */
  App.checkMemoryBasis = function (session) {
    if (!session || !session.memAnchorHash || session.memManual) return Promise.resolve(false);
    if (!session.summary && !(session.facts && session.facts.length)) return Promise.resolve(false);
    return Store.getMessages(session.id).then(function (list) {
      var msgs = (list || []).slice().sort(function (a, b) { return a.createdAt - b.createdAt; });
      var covered = msgs.slice(0, session.memAnchorCount || 0);
      if (App.transcriptHash(covered) === session.memAnchorHash) return false;
      session.summary = '';
      session.facts = [];
      session.memAt = 0;
      session.memAnchorHash = '';
      session.memAnchorCount = 0;
      if (App.state && App.state.session && App.state.session.id === session.id) App.state.session = session;
      return Store.putSession(session).then(function () {
        UI.toast('Memory cleared: it was built on a reply that has since been rerolled or edited. It will be rebuilt from the current story.', 6000);
        return true;
      });
    }).catch(function () { return false; });
  };

  /* v1.39.94: when the model's provider is down, the two things a player can
     actually do are "try again in a minute" and "use a different model". This
     offers both, and says plainly that the chat is intact. */
  App.routeFailureSheet = function (err) {
    var s = Store.settings || {};
    var free = /:free\s*$/i.test(s.model || '');
    UI.sheet({
      title: 'The model is unavailable',
      body: '<div class="hint" style="margin:0 0 10px">' + esc(String(err && err.message || 'The provider returned an error.')) + '</div>' +
        '<div class="hint" style="margin:0 0 10px">' +
        (free ? 'This is a <b>free route</b>. Free routes share a pool: at busy times every request ' +
          'is refused for a while, then it works again with nothing changed. It is not your key, ' +
          'your quota, or this app.' : 'This is the provider\'s server, not your settings.') +
        '</div>' +
        '<div class="hint" style="margin:0">Your message and the chat are untouched.</div>',
      actions: [
        { label: 'Later', cls: 'ghost', value: null },
        { label: 'Try again', cls: 'ghost', onClick: function () {
            UI.closeSheet();
            App.generateReply();
            return true;
          } },
        { label: 'Choose model', cls: 'primary', onClick: function () {
            UI.closeSheet();
            App.chooseModel(true);
            return true;
          } }
      ]
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
              entities: [{ id: 'npc_warden', name: 'Tide Warden', type: 'npc', isMajor: true,
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
                /* v1.39.103: this asked for kernel.sceneLocationLimit, which
                   the engine reads but not for pacing - it only reorders the
                   location list. The interval that actually makes the world
                   move between scenes is worldAgent.intervalTurns, and the
                   drafter never asked for it, so a drafted world never
                   breathed. It is asked for now, next to the cap it was
                   confused with. */
                JSON.stringify({ dmPrompt: '', intro: '', authorNote: '',
                  kernel: { sceneLocationLimit: 15 }, worldAgent: { enabled: true, intervalTurns: 15 } }) + ' ' +
                'where dmPrompt is 120-180 words: you are the showrunner and referee of this world; ' +
                'the core promise that the player can do anything; what persists and what never resets; ' +
                'simulation discipline — honor the clock, exits, who is present, and what characters ' +
                'could plausibly know; player agency — never write the player’s words, thoughts or ' +
                'consent; voice: second person, present tense, concrete, no purple prose. ' +
                'intro is the opening scene, 2-3 sentences, second person present tense, ending on a ' +
                'small hook. authorNote is one sentence on what keeps this world honest. ' +
                'kernel.sceneLocationLimit is an integer 10-30 — how many places the referee keeps in ' +
                'mind at once. worldAgent.intervalTurns is an integer 8-20: how many turns pass before the ' +
                'world itself moves off-screen (a faction acts, a rumour travels) so the story is not ' +
                'waiting on the player alone.',
                480, prog).then(function (referee) {
                if (!referee || !referee.dmPrompt) {
                  throw new Error('the model sent no referee prompt — press Create to try again');
                }
                /* 4 of 5 the ways in: the walks, the work, the numbers */
                stage = '4 of 5, the ways in';
                status(stage + '…');
                var waysInShape = JSON.stringify({
                  startingLives: [], startingQuests: [], goalPrograms: [],
                  /* only modules the engine actually reads: `relationships`
                     and `livingWorld` were asked for here for many releases
                     and nothing consumes either - the social web comes from
                     the people draft's own relationships array, and the world
                     moving on its own comes from worldAgent. */
                  gameRules: {
                    modules: { quests: true, inventory: true, commerce: true },
                    checks: [], dice: { sides: 20, defaultDifficulty: 11, criticals: true }, statBound: 3
                  },
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
                  '"value":integer, "min":0, "max":integer}]}. ' +
                  /* v1.39.103: a world the app drafts has to be as playable as
                     one an author writes. It used to be handed a social
                     sandbox - four modules, no checks, no dice, no turn
                     bound - so the referee could never call for a roll, never
                     had a vital floor, and could move a number by any amount
                     it liked in one turn. The shape now declares the dice the
                     engine already knows how to run, and asks for the two to
                     four checks this world's premise actually turns on. */
                  'gameRules.modules keeps quests and picks the rest honestly: inventory and commerce ' +
                  'unless this world has nothing to carry or trade, and health only when one of the stats ' +
                  'above can drop to zero - name that stat in "vitalStatId". ' +
                  'checks is 2-4 of {"name":"one or two words a referee would say out loud, ' +
                  'e.g. Sneak or Read the Room", "dc":integer 8-16, "stat":"one of the stat ids you gave", ' +
                  '"on_success":{"stats":{"stat id":integer -3 to +3}}, "on_failure":{"stats":{"stat id":integer ' +
                  '-3 to +3}}} - the rolls this world actually turns on, each with a consequence both ways. ' +
                  'dice keeps sides and defaultDifficulty from the shape and may raise criticals. ' +
                  'statBound is an integer 2-5: the most any one stat or the purse may move in a single turn.',
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
      /* v1.39.101: a check the engine settled before the scene began was
         already applied to this stage by phase one - resolving it a second
         time would roll twice for one action. Its verdict is carried into
         the turn's receipt instead. */
      var already = {};
      (settled || []).forEach(function (e) { already[String(e.name).toLowerCase()] = e; });
      var pending = {
        checkRequests: ((a.applied && a.applied.checkRequests) || []).filter(function (req) {
          return !already[String(req.name).toLowerCase()];
        })
      };
      var res = HW.resolveChecks(world, a.stage, pending);
      var settledHere = (settled || []).filter(function (e) {
        return !res.list.some(function (x) { return x.name === e.name; });
      });
      res.list = settledHere.map(function (e) {
        return { name: e.name, text: e.text, chip: e.chip, success: e.success, total: e.total, dc: e.dc, preRolled: true };
      }).concat(res.list);
      res.changes = settledHere.map(function (e) { return e.chip; }).concat(res.changes);
      /* the engine already logged and applied these; the receipt only
         needs to carry them, never to repeat the effects */
      res.changes = res.changes.filter(function (c, i) { return res.changes.indexOf(c) === i; });
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
      /* v1.39.101: a repair re-writes the scene, it does not re-roll the
         dice. The rolls that settled this turn are still settled. */
      var prompt2 = HW.buildPrompt(world, from, text, { settled: settled });
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
        /* v1.39.99: a repaired turn is answered from the same NOW state */
        finalNote: prompt2.note || null,
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

    /* v1.39.101: the two phases share one ladder of attempts, so a repair
       of the narration re-asks for the scene, never for a new roll. `settled`
       is null until phase one has run, and stays null for a world that names
       no checks - that turn is exactly what it always was. */
    var settled = null;

    function announceRolls(entries) {
      if (!entries || !entries.length) return;
      entries.forEach(function (e) {
        run.log.push({ role: 'check', content: e.text, at: Date.now() });
      });
      if (run.log.length > 200) run.log = run.log.slice(-200);
      /* the roll is part of the turn the moment it happens: a player
         waiting on the prose already sees the die, exactly as Isekai Zero
         puts the roll bar beside the scene rather than inside it */
      Views.worldRun(world, run, { changes: entries.map(function (e) { return e.chip; }), checks: entries });
    }

    /* Ask for the attempt and the check, long enough before the prose that
       the die cannot be written to fit. A world that names no checks, or a
       model that answers nothing, simply has no pre-rolled check. */
    function phaseOne() {
      var checks = (world.gameRules || {}).checks;
      if (!Array.isArray(checks) || !checks.length) return Promise.resolve(null);
      var built = HW.buildPrompt(world, base, text, null);
      return API.generate({
        settings: s,
        character: {
          id: world.id, name: world.name, persona: '', scenario: '',
          examples: '', lorebook: [],
          systemPrompt: built.system + '\n\n' + HW.intentRules()
        },
        session: { id: run.id },
        finalNote: built.note || null,
        history: built.messages.map(function (m) {
          return { id: 'w' + Math.random().toString(36).slice(2), role: m.role, text: m.content, createdAt: Date.now() };
        }),
        signal: wrAbort.signal,
        onProgress: function (info) {
          worldStatus('Reading the attempt — ' + String(App.worldProgressText(info)).toLowerCase(), info.waitTime);
        }
      }).then(function (answer) {
        var asked = HW.parseIntent(answer, world);
        asked.unrecognised.forEach(function (name) {
          base.rejections = (base.rejections || []).concat([{
            tag: '[[roll:check:' + name + ']]',
            reason: 'the world has no check named \u201C' + name + '\u201D',
            at: Date.now()
          }]).slice(-50);
        });
        if (!asked.checks.length) return null;
        var stage = HW.cloneRun(base);
        var entries = [], rejections = [];
        asked.checks.forEach(function (name) {
          var res = HW.resolveCheckNow(world, stage, name);
          if (res.entry) entries.push(res.entry);
          if (res.rejection) rejections.push(res.rejection);
        });
        base = stage;   /* the rolls happened; phase two starts from them */
        if (rejections.length) base.rejections = (base.rejections || []).concat(rejections).slice(-50);
        if (entries.length) announceRolls(entries);
        return entries.length ? entries : null;
      }).catch(function () {
        /* phase one is an aid, not a gate: a provider hiccup here must not
           cost the player their turn - the scene is written without a
           pre-rolled check, exactly as before this release */
        return null;
      });
    }

    phaseOne().then(function (entries) {
      settled = entries;
      var built = HW.buildPrompt(world, base, text, { settled: settled });
      /* v1.42.2 (§7): the turn's cost, kept on the run so the sheet can show what
         the budget is being spent on. Numbers only — it is never read back into a
         prompt, and a run that loses it simply shows nothing. */
      try { if (run && built && built.costs) run.promptCosts = built.costs; } catch (e) { }
      return API.generate({
        settings: s,
        /* the world is the referee: its own prompt is the whole system prompt */
        character: {
          id: world.id, name: world.name, persona: '', scenario: '',
          examples: '', lorebook: [], systemPrompt: built.system
        },
        session: { id: run.id },
        /* v1.39.99: the state restated immediately before the newest turn */
        finalNote: built.note || null,
        history: built.messages.map(function (m) {
          return { id: 'w' + Math.random().toString(36).slice(2), role: m.role, text: m.content, createdAt: Date.now() };
        }),
        signal: wrAbort.signal,
        onProgress: wrProgress
      });
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
    var groupMembers = App.state.groupCharacters || [];
    if (groupMembers.length > 1 && App.state.session && App.state.session.speakerMode !== 'auto' &&
        !groupMembers.some(function (c) { return c.id === App.state.session.nextSpeakerId; })) {
      UI.toast('Choose the next speaker before sending');
      App.pickGroupSpeaker();
      return;
    }
    var draft = input.value;
    input.value = ''; input.style.height = 'auto';
    if (stage) { App.state.attach = null; App.renderAttach(); }
    var char = App.state.char, session = App.state.session;
    /* v1.39.93: sending the next message is "continuing the conversation", and
       that is when a memory built on a rerolled reply stops describing the
       story. Checked here, not at the reroll itself, so a player who rerolls
       and then swipes back to the original keeps the memory. Runs in the
       background — it never delays the send. */
    App.checkMemoryBasis(session).catch(function () {});
    var msg = { sessionId: session.id, role: 'user', text: text, createdAt: Date.now() };
    if (stage) { msg.image = stage.image; msg.imageCaption = stage.caption; }
    Store.addMessage(msg).then(function (m) {
      App.state.messages.push(m);
      Views.appendMessage(char, m);
      App.refreshChatHead();
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
    clearRetryMarkers(App.state.messages);
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
        /* v1.48.6: `after.map(Store.delMessage)` deleted the rows and left
           `messageCount` on the old total forever — an over-count nobody ever
           saw, because nothing displays it as wrong. The batch recounts once:
           N parallel `messageCount - 1` writes would read the same row and
           lose all but one of the decrements. */
        return Store.removeMessages(after).then(function () {
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

  /**
   * Something of theirs landed while their chat was not in front of you: mark it,
   * and say so through whichever channel this platform actually has. A toast is for
   * when you are here; a system notice is for when you are not, and only where the
   * browser offers one - the Android wrapper has no notification channel, so on a
   * phone the count is the signal and nothing pretends otherwise. `tag` is per human
   * so three messages from one person arrive as one notice that updates, not three
   * that you swipe away one by one.
   */
  App.vhArrived = function (char, count, note) {
    if (!char) return;
    VH.arrived(char, count);
    App.persistVH(char);
    if (!document.hidden) { if (note) UI.toast(note); }
    else App.notifyAway(char, note);
    /* the screens that show a badge redraw themselves if one of them is open;
       nothing else is touched, because a background tick has no viewer */
    if (App.state.screen === 'chats') Views.chats($('.screen'));
    if (App.state.screen === 'life' || App.state.screen === 'now') Views.life($('.screen'));
  };

  /** A system notice, if this platform has them and the player said yes to one.
      Never a prompt here: permission is asked for by the switch that needs it. */
  App.notifyAway = function (char, note) {
    var st = Store.settings || {};
    if (st.notifyAway !== true) return false;
    /* typeof, not `in`: a key can exist and still be nothing, and a platform that
       half-implements this must be treated as one that does not, not crashed on. */
    if (typeof window.Notification !== 'function') return false;
    if (window.Notification.permission !== 'granted') return false;
    try {
      var n = new Notification((char && char.name) || 'They wrote', {
        body: note || 'A new message is waiting.',
        tag: 'horde-vh-' + ((char && char.id) || 'x')
      });
      if (n && n.close) setTimeout(function () { try { n.close(); } catch (e) {} }, 8000);
      return true;
    } catch (e) {
      /* a platform that throws on construct is a platform without them; the unread
         count still says the truth, which is the part that has to work */
      return false;
    }
  };

  /** Owned by the switch and not by the render: whether the toggle is worth writing
      at all is the browser's answer, and a denied permission must not leave a screen
      showing "on" beside a notification that will never arrive. */
  App.setNotifyAway = function (on, done) {
    if (!on) { Store.saveSettings({ notifyAway: false }); if (done) done(false); return; }
    if (typeof window.Notification !== 'function') {
      UI.toast('This platform offers no notifications - their messages wait as a count instead');
      if (done) done(null);
      return;
    }
    var N = window.Notification;
    if (N.permission === 'granted') {
      Store.saveSettings({ notifyAway: true }); if (done) done(true); return;
    }
    if (N.permission === 'denied') {
      UI.toast('Your browser has this app blocked from notifying you - allow it in site settings first');
      Store.saveSettings({ notifyAway: false }); if (done) done(false);
      return;
    }
    Promise.resolve(N.requestPermission()).then(function (p) {
      var granted = p === 'granted';
      Store.saveSettings({ notifyAway: granted });
      if (!granted) UI.toast('Not allowed - the switch stays off, and their messages still wait for you as a count');
      if (done) done(granted);
    }, function () {
      Store.saveSettings({ notifyAway: false });
      if (done) done(false);
    });
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
          speakerId: first.speakerId || '', speakerName: first.speakerName || '',
          speakerAvatar: first.speakerAvatar || '', speakerMood: first.speakerMood || '',
          speakerPortrait: first.speakerPortrait || '',
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

    if (!opts.background) {
      if (App.state.screen === 'now' || App.state.screen === 'life') Views.life($('.screen'));
      if (App.state.screen === 'feed') Views.feed($('.screen'));
    }

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
          history: Store.transcript(msgs), note: note   /* v1.48.6: the same selector the counter uses */
        }).then(function (text) {
          return Store.addMessage({
            sessionId: session.id, role: 'assistant', text: (text || '').trim(),
            alts: [(text || '').trim()], altIdx: 0, createdAt: Date.now()
          });
        }).then(function () {
          VH.noteReply(char, '');
          App.persistVH(char);
          /* re-checked here rather than trusted from the top of the function: the
             player may have opened this chat while the reply was being written, and
             a message they are looking at is not something they came back to */
          if (App.state.screen !== 'chat' || !App.state.session || App.state.session.id !== session.id) {
            App.vhArrived(char, 1, (char.name || 'They') + ' replied — open the chat');
          }
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
        /* the burst's other bubbles land in the same chat, so the whole of it is
           counted here, once, where the decision "you were not looking" is made */
        App.vhArrived(char, parts.length, (char.name || 'They') + ' sent you ' +
          (parts.length === 1 ? 'a message' : parts.length + ' messages'));
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
    var provider = s.imageProvider || 'horde';
    return App.generateImageResult(provider, {
      prompt: prompt, model: s.hordeModel, width: 512, height: 512,
      steps: Math.min(s.hordeSteps, 24), apikey: s.hordeKey, maxWait: s.hordeMaxWait,
      onProgress: function (i) {
        App.genSet(
          i.state === 'processing' ? 'Developing the photo…'
            : i.state === 'empty' ? 'Worker sent nothing — asking another…'
            : 'Queued · position ' + (i.queuePosition || 0), i.waitTime);
      }
    }).then(function (res) {
      return App.imageResultSource(res).then(function (src) { return { src: src, meta: res }; });
    }).then(function (out) {
      return Store.addMessage({
        sessionId: session.id, role: 'assistant',
        text: caption + imageResultNote(out.meta),
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
        App.vhArrived(char, 1, (char.name || 'They') + ' sent you a photo');
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
      s2.chatLorebook = (old.chatLorebook || []).map(function (e) {
        return Object.assign({}, e, { keys: (e.keys || []).slice() });
      });
      s2.sceneNote = old.sceneNote || '';
      s2.sceneNotePlacement = old.sceneNotePlacement || 'end';
      s2.sceneNoteFrequency = old.sceneNoteFrequency || 1;
      s2.groupCharIds = (old.groupCharIds || []).slice();
      s2.speakerMode = old.speakerMode || 'manual';
      s2.nextSpeakerId = old.nextSpeakerId || '';
      s2.sceneCast = (old.sceneCast || []).slice();
      s2.scenePresent = (old.scenePresent || []).slice();
      s2.castChecked = !!old.castChecked;
      s2.rpgStatus = old.rpgStatus ? JSON.parse(JSON.stringify(old.rpgStatus)) : null;
      s2.continuity = API.normalizeContinuity ? API.normalizeContinuity(old.continuity) : (old.continuity || null);
      return Store.putSession(s2).then(function () {
        var copies = msgs.map(function (m) {
          return Object.assign({}, m, { id: UI.uid('m'), sessionId: s2.id });
        });
        return IDB.putMany('messages', copies).then(function () { App.openSession(s2.id); });
      });
    }).then(function () { UI.toast('Timeline forked — this branch is now independent'); });
  };

  /* ---------------- image generation ---------------- */
  App.downloadChatImage = function (message) {
    var source = message && message.image;
    if (!source) return UI.toast('This message has no image to download.');
    UI.toast('Preparing image download…');
    return fetch(source, { mode: 'cors' }).then(function (response) {
      if (!response.ok) throw new Error('Image download returned HTTP ' + response.status);
      return response.blob();
    }).then(function (blob) {
      var mime = (blob.type || '').toLowerCase().split(';')[0];
      if (mime.indexOf('image/') !== 0) throw new Error('The image source did not return an image.');
      var ext = mime === 'image/jpeg' ? 'jpg' : (mime.split('/')[1] || 'png').replace(/[^a-z0-9]/g, '');
      var stamp = new Date().toISOString().replace(/[:.]/g, '-');
      UI.download('horde-studio-image-' + stamp + '.' + ext, blob, mime);
      return true;
    }).catch(function () {
      UI.toast('Could not fetch this image for download. Opening it so you can try saving it manually.', 5000);
      UI.lightbox(source);
      return false;
    });
  };

  App.imageProviderLabel = function (provider) {
    return provider === 'cloudflare' ? 'Cloudflare Workers AI'
      : provider === 'pollinations' ? 'Pollinations Classic' : 'AI Horde';
  };

  App.generateImageResult = function (provider, options) {
    options = options || {};
    if (provider === 'horde') return Horde.generateImage(options);
    return ImageGen.generate(provider, options, Store.settings);
  };

  App.imageResultSource = function (result) {
    if (result.dataUrl) return Promise.resolve(result.dataUrl);
    var url = result.url || '';
    if (/^data:image\//i.test(url)) return Promise.resolve(url);
    if (!url) return Promise.reject(new Error('The provider returned no image.'));
    return fetch(url, { mode: 'cors' })
      .then(function (r) { if (!r.ok) throw new Error('download failed'); return r.blob(); })
      .then(function (blob) {
        return new Promise(function (resolve) {
          try {
            var fr = new FileReader();
            fr.onload = function () { resolve(fr.result); };
            fr.onerror = function () { resolve(url); };
            fr.readAsDataURL(blob);
          } catch (e) { resolve(url); }
        });
      }).catch(function () { return url; });
  };

  function imageResultNote(result) {
    var parts = [];
    if (result.model) parts.push(result.model);
    if (result.seed !== undefined && result.seed !== null) parts.push('seed ' + result.seed);
    if (result.worker) parts.push('by ' + result.worker);
    return parts.length ? '\n\n_' + parts.join(' · ') + '_' : '';
  }

  App.imageSheet = function () {
    var s = Store.settings;
    var pickedSize = s.hordeSize || 640;
    var pickedProvider = s.imageProvider || 'horde';

    function providerHint(provider) {
      if (provider === 'pollinations') return 'No key required. Best-effort and rate-limited: one image request at a time per IP, at least 45 seconds between requests. Maximum 768×768; JPEGs include a small Pollinations logo.';
      if (provider === 'cloudflare') return 'Uses your own CORS-enabled Worker proxy. Set its HTTPS URL and APP_TOKEN in Settings first. FLUX Schnell controls its own output size and safety behavior.';
      return 'AI Horde is a free, volunteer-run GPU queue. Queue times vary; your selected model and size are honored.';
    }
    function updateProvider(body) {
      var provider = body.querySelector('#img-provider').value;
      pickedProvider = provider;
      body.querySelector('#img-provider-hint').textContent = providerHint(provider);
      body.querySelector('#img-model-wrap').hidden = provider !== 'horde';
      body.querySelector('#img-size-wrap').hidden = provider === 'cloudflare';
      body.querySelector('#img-nsfw-wrap').hidden = provider === 'cloudflare';
      body.querySelector('#img-nsfw-label').textContent = provider === 'pollinations'
        ? 'Request less restrictive output' : 'Allow NSFW for this image';
      body.querySelector('#img-policy-hint').textContent = provider === 'pollinations'
        ? 'Unchecked sends safe=true for stricter filtering; checked sends safe=false. Pollinations moderation and provider policies still apply.'
        : 'Marks the request as potentially adult so only workers that accept NSFW jobs can take it. Other Horde safety checks still apply.';
    }

    UI.sheet({
      title: 'Generate an image',
      body:
        '<div class="field"><div class="field-head"><label>Provider</label></div>' +
        '<select id="img-provider"><option value="horde"' + (pickedProvider === 'horde' ? ' selected' : '') + '>AI Horde</option>' +
        '<option value="pollinations"' + (pickedProvider === 'pollinations' ? ' selected' : '') + '>Pollinations Classic</option>' +
        '<option value="cloudflare"' + (pickedProvider === 'cloudflare' ? ' selected' : '') + '>Cloudflare Workers AI</option></select>' +
        '<div class="hint" id="img-provider-hint">' + esc(providerHint(pickedProvider)) + '</div></div>' +
        '<div class="field"><div class="field-head"><label>Prompt</label></div>' +
        '<textarea id="img-prompt" style="min-height:110px" placeholder="Describe the image you want to create…"></textarea></div>' +
        '<div class="field" id="img-model-wrap"><div class="field-head"><label>Horde model</label><span class="spacer"></span>' +
        '<button class="chip" id="img-model">Choose…</button></div>' +
        '<div class="hint" id="img-model-name">' + esc(Horde.imageModelLabel(s.hordeModel) || 'Any available (fastest)') + '</div></div>' +
        '<div class="field" id="img-nsfw-wrap"><label style="display:flex;align-items:center;gap:9px"><input type="checkbox" id="img-nsfw"> <span id="img-nsfw-label">Allow NSFW for this image</span></label>' +
        '<div class="hint" id="img-policy-hint">Marks the request as potentially adult so only workers that accept NSFW jobs can take it. Other Horde safety checks still apply.</div></div>' +
        '<div class="field" id="img-size-wrap"><div class="field-head"><label>Size</label><span class="spacer"></span><span class="val" id="img-size-v">' + pickedSize + 'px</span></div>' +
        '<div class="seg" id="img-size">' + [512, 640, 768, 1024].map(function (n) {
          return '<button data-size="' + n + '"' + (n === pickedSize ? ' class="on"' : '') + '>' + n + '</button>';
        }).join('') + '</div></div>',
      actions: [
        { label: 'Cancel', cls: 'ghost', value: null },
        { label: 'Generate', cls: 'primary', onClick: function (b) {
          var prompt = b.querySelector('#img-prompt').value.trim();
          return prompt ? { prompt: prompt, nsfw: b.querySelector('#img-nsfw').checked, provider: b.querySelector('#img-provider').value } : null;
        } }
      ],
      onMount: function (b) {
        updateProvider(b);
        b.querySelector('#img-provider').addEventListener('change', function () { updateProvider(b); });
        b.querySelector('#img-size').onclick = function (e) {
          var t = e.target.closest('button'); if (!t) return;
          pickedSize = parseInt(t.getAttribute('data-size'), 10);
          b.querySelectorAll('#img-size button').forEach(function (x) { x.classList.remove('on'); });
          t.classList.add('on');
          b.querySelector('#img-size-v').textContent = pickedSize + 'px';
        };
        b.querySelector('#img-model').onclick = function () {
          App.chooseHordeModel('image', false).then(function (m) {
            b.querySelector('#img-model-name').textContent = Horde.imageModelLabel(m) || 'Any available (fastest)';
          });
        };
      }
    }).then(function (request) {
      if (!request || !request.prompt) return;
      App.runImage(request.prompt, pickedSize, request.nsfw, request.provider);
    });
  };

  App.runImage = function (prompt, size, nsfw, provider) {
    var s = Store.settings;
    provider = provider || s.imageProvider || 'horde';
    var ctrl = new AbortController();
    App.abort = ctrl;
    App.genStart('Sending to ' + App.imageProviderLabel(provider) + '…', ctrl);
    var request;
    if (provider === 'horde') {
      request = Horde.modelStatus('image', s.hordeModel).then(function (st) {
        if (st && st.count === 0) {
          UI.toast('No workers for “' + s.hordeModel + '” — using any available model', 4000);
          return '';
        }
        return s.hordeModel;
      }).catch(function () { return s.hordeModel; }).then(function (model) {
        return App.generateImageResult('horde', {
          prompt: prompt, model: model, nsfw: !!nsfw, width: size, height: size,
          steps: s.hordeSteps, apikey: s.hordeKey, signal: ctrl.signal, maxWait: s.hordeMaxWait,
          onProgress: function (info) {
            if (info.state === 'processing') App.genSet('Painting on a volunteer GPU…', info.waitTime);
            else if (info.state === 'queued') App.genSet('Queued on the Horde · position ' + (info.queuePosition || 0), info.waitTime);
            else if (info.state === 'rate-limited') App.genSet('Horde rate limit — pausing ' + (info.waitTime || 10) + 's', info.waitTime);
            else if (info.state === 'retrying') App.genSet('Connection blip — retrying…', 0);
          }
        });
      });
    } else {
      if (provider === 'cloudflare' && (!s.cloudflareWorkerUrl || !s.cloudflareWorkerToken)) {
        request = Promise.reject(new Error('Configure your Worker URL and APP_TOKEN in Settings.'));
      } else {
        App.genSet('Generating with ' + App.imageProviderLabel(provider) + '…', 0);
        request = App.generateImageResult(provider, {
          prompt: prompt, width: size, height: size, nsfw: !!nsfw, signal: ctrl.signal
        });
      }
    }
    return request.then(function (res) {
      App.genSet('Saving image…', 0);
      return App.imageResultSource(res).then(function (image) {
        var label = '\u{1F3A8} ' + (prompt.length > 140 ? prompt.slice(0, 140) + '…' : prompt);
        var msg = {
          sessionId: App.state.session.id, role: 'assistant',
          text: label + imageResultNote(res), image: image, createdAt: Date.now()
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
    var provider = Store.settings.imageProvider || 'horde';
    return UI.sheet({
      title: 'Generate avatar',
      body: '<div class="field"><div class="field-head"><label>Prompt</label></div>' +
        '<textarea id="av-prompt" style="min-height:100px">' +
        esc((draft.name || '') + ', portrait, ' + (draft.tagline || '') + ', detailed face, soft lighting, digital painting') +
        '</textarea><div class="hint">Generated with ' + esc(App.imageProviderLabel(provider)) + '.</div></div>',
      actions: [
        { label: 'Cancel', cls: 'ghost', value: null },
        { label: 'Generate', cls: 'primary', onClick: function (b) { return b.querySelector('#av-prompt').value.trim() || null; } }
      ]
    }).then(function (prompt) {
      if (!prompt) return null;
      var ctrl = new AbortController();
      App.abort = ctrl;
      App.genStart('Generating avatar with ' + App.imageProviderLabel(provider) + '…', ctrl);
      return App.generateImageResult(provider, {
        prompt: prompt, model: Store.settings.hordeModel, width: 512, height: 512,
        steps: Math.min(Store.settings.hordeSteps, 30), apikey: Store.settings.hordeKey,
        signal: ctrl.signal, maxWait: Store.settings.hordeMaxWait,
        onProgress: function (i) {
          App.genSet(i.state === 'processing' ? 'Painting…' : 'Queued · position ' + (i.queuePosition || 0), i.waitTime);
        }
      }).then(function (res) { return App.imageResultSource(res); })
        .then(function (image) { App.genStop(); App.abort = null; UI.toast('Avatar generated'); return image; })
        .catch(function (e) {
          App.genStop(); App.abort = null;
          if (e.name !== 'AbortError') UI.toast('Failed: ' + e.message, 4000);
          return null;
        });
    });
  };

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
      } else if (type === 'image') {
        items.push({
          value: Horde.ANY_NSFW_IMAGE, label: 'Any available (NSFW-tagged)',
          sub: 'Horde-reference models marked NSFW with workers online'
        });
      }
      rows.forEach(function (r) {
        var name = typeof r === 'string' ? r : r.name;
        if (!name) return;
        var count = typeof r === 'string' ? 0 : (r.count || 0);
        var eta = typeof r === 'string' ? 0 : (r.eta || 0);
        var jobs = typeof r === 'string' ? 0 : (r.jobs || 0);
        items.push({
          value: name, label: name, dim: typeof r === 'string' ? false : !count,
          sub: typeof r === 'string' ? 'cached model · refresh to check workers' :
               (count ? count + ' workers' : 'no workers online') +
               (eta ? ' · ETA ' + eta + 's' : '') +
               (jobs ? ' · ' + jobs + ' jobs queued' : '')
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
      /* v1.39.104: the sheet works on fact RECORDS. Editing a current fact
         keeps its id and its date (it is the same fact, better worded);
         adding one becomes a new record; deleting one is a real delete, which
         is the player's decision to make and not the model's. */
      var facts = API.chatFactObjects(s).map(function (f) {
        return { id: f.id, text: f.text, from: f.from, to: f.to, by: f.by, retired: f.retired };
      });
      var editingFact = -1, deletingFact = -1, addingFact = false;
      function isCurrent(f) { return f.to === null || f.to === undefined; }
      function render(body) {
        var rows = facts.map(function (f, i) {
          if (editingFact === i) {
            return '<div class="field compact" style="align-items:stretch;flex-direction:column">' +
              '<textarea data-fact-edit="' + i + '" rows="3">' + esc(f.text) + '</textarea>' +
              '<div class="row"><button type="button" class="btn primary sm" data-save-fact="' + i + '">Apply edit</button>' +
              '<button type="button" class="btn ghost sm" data-cancel-edit="' + i + '">Cancel</button></div></div>';
          }
          if (deletingFact === i) {
            return '<div class="opt" style="justify-content:space-between;gap:8px"><span>Remove this fact?</span>' +
              '<button type="button" class="btn danger sm" data-confirm-delete="' + i + '">Delete</button>' +
              '<button type="button" class="btn ghost sm" data-cancel-delete="' + i + '">Cancel</button></div>';
          }
          var when = isCurrent(f)
            ? '<span class="hint">[' + (f.from || 0) + ']</span>'
            : '<span class="hint">no longer true since ' + (f.to || 0) + '</span>';
          return '<div class="opt" style="align-items:flex-start;gap:6px' + (isCurrent(f) ? '' : ';opacity:.72') + '">' +
            '<span style="flex:1;min-width:0;white-space:normal">' + esc(f.text) + ' ' + when + '</span>' +
            '<button type="button" class="chip" data-edit-fact="' + i + '" aria-label="Edit fact">' + icon('edit') + ' Edit</button>' +
            '<button type="button" class="chip" data-remove-fact="' + i + '" aria-label="Delete fact">' + icon('trash') + '</button></div>';
        });
        if (addingFact) rows.push('<div class="field" style="padding:8px 0"><textarea data-new-fact rows="3" placeholder="Enter a fact"></textarea>' +
          '<div class="row"><button type="button" class="btn primary sm" data-save-new-fact>Add fact</button>' +
          '<button type="button" class="btn ghost sm" data-cancel-new-fact>Cancel</button></div></div>');
        body.querySelector('#facts').innerHTML = rows.length
          ? rows.join('')
          : '<div class="hint" style="padding:6px 2px">No facts stored yet.</div>';

        body.querySelectorAll('#facts [data-edit-fact]').forEach(function (el) {
          el.onclick = function () {
            editingFact = parseInt(el.getAttribute('data-edit-fact'), 10);
            deletingFact = -1; addingFact = false; render(body);
            var input = body.querySelector('[data-fact-edit="' + editingFact + '"]');
            if (input) input.focus();
          };
        });
        body.querySelectorAll('#facts [data-save-fact]').forEach(function (el) {
          el.onclick = function () {
            var i = parseInt(el.getAttribute('data-save-fact'), 10);
            var input = body.querySelector('[data-fact-edit="' + i + '"]');
            var edited = String(input ? input.value : '').trim();
            if (!edited) { UI.toast('A fact cannot be empty'); return; }
            /* the same fact, better worded: keep its id and its date */
            facts[i].text = edited; editingFact = -1; render(body);
          };
        });
        body.querySelectorAll('#facts [data-cancel-edit]').forEach(function (el) {
          el.onclick = function () { editingFact = -1; render(body); };
        });
        body.querySelectorAll('#facts [data-remove-fact]').forEach(function (el) {
          el.onclick = function () {
            deletingFact = parseInt(el.getAttribute('data-remove-fact'), 10);
            editingFact = -1; addingFact = false; render(body);
          };
        });
        body.querySelectorAll('#facts [data-confirm-delete]').forEach(function (el) {
          el.onclick = function () {
            var i = parseInt(el.getAttribute('data-confirm-delete'), 10);
            facts.splice(i, 1); deletingFact = -1; render(body);
          };
        });
        body.querySelectorAll('#facts [data-cancel-delete]').forEach(function (el) {
          el.onclick = function () { deletingFact = -1; render(body); };
        });
        body.querySelectorAll('#facts [data-save-new-fact]').forEach(function (el) {
          el.onclick = function () {
            var input = body.querySelector('[data-new-fact]');
            var value = String(input ? input.value : '').trim();
            if (!value) { UI.toast('A fact cannot be empty'); return; }
            var nextId = 1;
            facts.forEach(function (f) { var m = /^f(\d+)$/.exec(f.id); if (m) nextId = Math.max(nextId, parseInt(m[1], 10) + 1); });
            facts.push({ id: 'f' + nextId, text: value, from: s.messageCount || 0, to: null, by: null });
            addingFact = false; render(body);
          };
        });
        body.querySelectorAll('#facts [data-cancel-new-fact]').forEach(function (el) {
          el.onclick = function () { addingFact = false; render(body); };
        });
      }
      UI.sheet({
        title: 'Memory · ' + (s.title || 'New chat'),
        body: (App.lastMemoryFailure && App.lastMemoryFailure.sessionId === s.id
          ? '<div class="field"><div class="hint" style="margin:0 0 8px"><b>The last memory attempt failed.</b> ' +
            esc(App.lastMemoryFailure.reason) + '. Nothing was overwritten.</div>' +
            (App.lastMemoryFailure.sent || App.lastMemoryFailure.model
              ? '<div class="hint" style="margin:0 0 8px">Asked: ' +
                esc(App.lastMemoryFailure.sent || 'unknown size') +
                (App.lastMemoryFailure.model ? ' · model ' + esc(App.lastMemoryFailure.model) : '') +
                (App.lastMemoryFailure.window ? ' · window ' + App.lastMemoryFailure.window + ' tokens' : '') + '</div>'
              : '') +
            '<div class="hint" style="margin:0 0 8px">What the model actually returned' +
            (App.lastMemoryFailure.raw ? ' (cut to 400 characters):' : ' was empty.') + '</div>' +
            (App.lastMemoryFailure.raw
              ? '<textarea readonly rows="6" style="font-size:12px">' + esc(App.lastMemoryFailure.raw.slice(0, 400)) + '</textarea>'
              : '') +
            '<div class="hint" style="margin:8px 0 0">Try Regenerate with AI. If it keeps failing, screenshot ' +
            'this so the failure can be diagnosed instead of guessed at.</div></div>'
          : '') +
        (typeof API !== 'undefined' && API.memoryLooksBroken && API.memoryLooksBroken(s.summary)
          ? '<div class="field" style="border-color:#b45309"><div class="hint" style="margin:0 0 8px">' +
            '<b>This memory does not read like a summary.</b> ' +
            (API.memoryIsWrapper && API.memoryIsWrapper(s.summary)
              /* v1.48.5: the shape in the player's screenshot — a whole JSON
                 answer kept as the chat's past. Named, because "does not read
                 like a summary" is not what you want to hear about text you can
                 read perfectly well; what you want is the button that fixes it. */
              ? 'What is stored here is the model\u2019s raw answer — braces, quotes and all — kept by an ' +
                'older version as the story so far, and handed back to the model on every prompt since. ' +
                'Recover pulls the summary out of it, and the facts too if the answer ever finished. ' +
                'Nothing changes until you tap Save.'
              : 'Older versions stored whatever the model replied — including a refusal — as the story so ' +
                'far, and that text has been standing in for the whole past on every prompt since. ' +
                'Clearing it costs you nothing you do not still have in the chat above.') +
            '</div>' +
            (API.memoryIsWrapper && API.memoryIsWrapper(s.summary)
              ? '<button type="button" class="btn ghost sm" id="recoverbad">Recover the summary</button> '
              : '') +
            '<button type="button" class="btn ghost sm" id="clearbad">Clear it</button></div>'
          : '') +
          '<div class="field"><div class="field-head"><label>Summary</label></div>' +
          '<textarea id="sum" class="tall">' + esc(s.summary || '') + '</textarea></div>' +
          '<div class="field"><div class="field-head"><label>Facts</label>' +
          '<span class="spacer"></span><button class="chip" id="addfact">' + icon('plus') + ' Add</button></div>' +
          '<div id="facts"></div><div class="hint">Edit or remove facts here, then tap Save to use the changes in this chat.</div></div>' +
          '<div class="field"><div class="row">' +
          '<button class="btn ghost sm" style="flex:1" id="regen">' + icon('refresh') + ' Regenerate with AI</button>' +
          '<button class="btn ghost sm" id="inject">Send to chat</button></div>' +
          '<div class="hint">Auto-summarisation runs every ' + Store.settings.memoryEvery + ' messages when enabled in Settings.</div></div>',
        actions: [
          { label: 'Close', cls: 'ghost', value: null },
          { label: 'Save', cls: 'primary', onClick: function (b) {
              s.summary = b.querySelector('#sum').value.trim();
              s.facts = facts.slice();
              s.memManual = true;   /* written by the player: never auto-cleared */
              return Store.putSession(s).then(function () {
                if (App.state && App.state.session && App.state.session.id === s.id) App.state.session = s;
                UI.toast('Memory saved');
                return true;
              });
            } }
        ],
        onMount: function (body, close) {
          render(body);
          var recoverBad = body.querySelector('#recoverbad');
          if (recoverBad) recoverBad.onclick = function () {
            var r = API.recoverMemory(s.summary);
            if (!r.ok) { UI.toast('Nothing to recover — ' + r.reason); return; }
            /* into the field the player is already editing, not straight into the
               store: recovering a memory must not quietly replace what they typed. */
            body.querySelector('#sum').value = r.text;
            if (r.facts.length && !facts.length) {
              var nextId = 1;
              facts.forEach(function (f) {
                var m = /^f(\d+)$/.exec(f.id);
                if (m) nextId = Math.max(nextId, parseInt(m[1], 10) + 1);
              });
              r.facts.forEach(function (f) {
                facts.push({ id: 'f' + (nextId++), text: f, from: 0, to: null, by: null });
              });
            }
            render(body);
            UI.toast(r.salvaged
              ? 'Recovered from an unfinished answer — check it, then tap Save'
              : 'Recovered — check it, then tap Save');
          };
          var clearBad = body.querySelector('#clearbad');
          if (clearBad) clearBad.onclick = function () {
            body.querySelector('#sum').value = '';
            facts.length = 0; render(body);
            UI.toast('Cleared — tap Save to keep it');
          };
          body.querySelector('#addfact').onclick = function () {
            addingFact = true; editingFact = -1; deletingFact = -1; render(body);
            var input = body.querySelector('[data-new-fact]');
            if (input) input.focus();
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

  /** v1.39.104: the chat's NOW anchor.
   *
   * Same reasoning as the world run's (v1.39.99): the continuity ledger is
   * injected early in the system prompt, and on a long chat the transcript
   * grows between it and the newest message - so the state the reply is
   * supposed to honour sits in the middle of a long context, which is where a
   * model reads worst. This restates the few things that are load-bearing, in
   * five short lines, immediately before the newest message.
   *
   * Only when continuity is switched ON for this chat. A chat without it has
   * no ledger to anchor, and inventing one would be a new feature, not a fix.
   * Terse on purpose: it is a reminder, not a second ledger, and the existing
   * "never change this ledger silently" rule still governs it. */
  App.chatNowBrief = function (session) {
    var c = session && session.continuity;
    if (!c || c.enabled !== true || !API.normalizeContinuity) return '';
    var n = API.normalizeContinuity(c);
    var lines = [];
    if (n.stage) lines.push('Stage: ' + n.stage);
    var where = [];
    if (n.location) where.push('at ' + n.location);
    if (n.time) where.push(n.time);
    if (where.length) lines.push('Where: ' + where.join(' \u2014 '));
    if (n.participants.length) lines.push('Who is here: ' + n.participants.slice(0, 8).join(', '));
    var open = n.events.filter(function (e) { return e.status === 'open'; });
    if (open.length) {
      lines.push('Open: ' + open.slice(0, 3).map(function (e) { return e.name; }).join('; '));
    }
    if (!lines.length) return '';
    return 'Where things stand right now - approved state, already in force:\n' + lines.join('\n') +
      '\nWrite from this, not from an earlier moment, and do not restate it.';
  };

  App.promptInspector = function (sessionId) {
    return IDB.get('sessions', sessionId).then(function (session) {
      if (!session) return UI.toast('Chat not found');
      return Promise.all([
        Store.getCharacter(session.charId),
        Store.getMessages(sessionId),
        Promise.all((session.groupCharIds || []).map(function (id) { return Store.getCharacter(id); }))
      ]).then(function (loaded) {
        var baseChar = loaded[0], messages = loaded[1], members = loaded[2].filter(Boolean);
        var char = baseChar, groupNotice = '';
        if (members.length > 1) {
          char = members.find(function (c) { return c.id === session.nextSpeakerId; }) ||
            (session.speakerMode === 'auto' ? App.nextGroupSpeaker(members, messages) : null) || members[0];
          if (session.speakerMode !== 'auto' && !session.nextSpeakerId) {
            groupNotice = 'No next speaker is selected yet. This preview uses ' + (char.name || 'the first group member') +
              ' for illustration; a real reply still requires your manual selection.';
          } else {
            groupNotice = 'Previewing the prompt for ' + (char.name || 'the selected speaker') + '.';
          }
        }
        if (!char) return UI.toast('The character for this chat is missing');
        var settings = Object.assign({}, Store.settings);
        if (char.systemPrompt) settings.systemPrompt = char.systemPrompt;
        if (char.temperature !== null && char.temperature !== undefined) settings.temperature = char.temperature;
        if (char.maxTokens) settings.maxTokens = char.maxTokens;
        var overrides = session.overrides || {};
        if (overrides.temperature !== null && overrides.temperature !== undefined && overrides.temperature !== '') settings.temperature = overrides.temperature;
        if (overrides.maxTokens) settings.maxTokens = overrides.maxTokens;
        var payload;
        if (settings.provider === 'horde') {
          var promptBudget = API.HORDE_CTX_TOKENS - API.maxTokensOf(settings) - 64;
          payload = [{ role: 'prompt', content: API.buildPrompt(char, session, messages, settings, overrides.note || null, promptBudget) }];
        } else {
          payload = API.buildChat(char, session, messages, settings, overrides.note || null);
        }
        var totalChars = payload.reduce(function (n, m) { return n + String(m.content || '').length; }, 0);
        var blocks = payload.map(function (m, i) {
          var role = m.role === 'prompt' ? 'Horde plain-text prompt' :
            (m.role === 'system' ? 'System prompt / context' : (m.role === 'user' ? 'User' : 'Assistant'));
          var content = String(m.content || '');
          var tokens = Math.ceil(content.length / 4);
          return '<details' + (i === 0 ? ' open' : '') + ' style="margin:7px 0;border:1px solid var(--line);border-radius:10px;padding:8px 10px">' +
            '<summary style="cursor:pointer;font-weight:600">' + esc((i + 1) + '. ' + role + ' · ~' + tokens + ' tokens · ' + content.length + ' chars') + '</summary>' +
            '<pre style="white-space:pre-wrap;overflow-wrap:anywhere;font-family:ui-monospace,monospace;font-size:12px;line-height:1.55;margin:8px 0 0;color:var(--text)">' + esc(content) + '</pre></details>';
        }).join('');
        var notice = groupNotice ? '<div class="hint" style="margin:0 0 9px">' + esc(groupNotice) + '</div>' : '';
        /* v1.44.0: the numbers the builders wrote while making THIS payload, not a
           second calculation about it. Everything above is what the model is sent;
           this is what never was, which is the half that answers "why did it forget". */
        var asm = API.lastAssembly ? API.lastAssembly() : null;
        var cutRows = [];
        var li = function (txt) { return '<div class="hint" style="margin-top:4px">\u2022 ' + txt + '</div>'; };
        if (asm) {
          if (asm.available > asm.window) {
            cutRows.push(li((asm.available - asm.window) + ' of the ' + asm.available +
              ' messages in this chat were not offered. "Messages in context" is ' +
              (asm.messageCap || asm.window) +
              ', cut back to the start of a turn, so the transcript carries ' + asm.sent + '.'));
          } else if (asm.ceilingIsDefault) {
            cutRows.push(li('No "Messages in context" value is set, so the default of ' + asm.messageCap +
              ' applies.'));
          }
          if (asm.trimmedByBudget) {
            cutRows.push(li(asm.trimmedByBudget + ' more dropped so the transcript fit the history budget of ' +
              asm.historyTokens.toLocaleString() + ' tokens.'));
          }
          if (asm.droppedByCap) {
            cutRows.push(li(asm.droppedByCap + ' dropped at the last step to fit the request cap (' +
              asm.bytes.toLocaleString() + ' bytes against ' + asm.cap.toLocaleString() + ').' +
              (asm.floor ? ' The floor is ' + asm.floor + ' turns, kept whatever they cost.' : '')));
          }
          if (asm.overCap) {
            cutRows.push(li('The request is <b>over its size cap</b> \u2014 ' + asm.bytes.toLocaleString() +
              ' of ' + asm.cap.toLocaleString() + ' bytes \u2014 because what the floor protects weighs more than ' +
              'the cap allows. A backend that trims an oversized request keeps its beginning, so the line that ' +
              'asks for the reply is the part at risk.'));
          }
          if (asm.examplesDropped) {
            cutRows.push(li('The card\u2019s example dialogue was dropped \u2014 the last resort when the transcript alone still does not fit.'));
          }
          if (asm.lore) {
            var L = asm.lore, sk = L.skipped || [];
            cutRows.push(li('Lorebook: ' + L.total + ' entries, ' + L.admitted + ' in this prompt \u2014 ceiling ' +
              L.limit + ' entries and ' + L.budget.toLocaleString() + ' bytes, keywords scanned over the last ' +
              L.turns + ' turn' + (L.turns === 1 ? '' : 's') + (L.compat ? ', in the book\u2019s own order.' : '.')));
            cutRows.push(li(sk.length
              ? 'Cut after they matched: ' + sk.map(function (x) {
                  return '\u201C' + esc(x.keys || '(no keywords)') + '\u201D \u2014 ' +
                    (x.why === 'budget' ? 'the byte budget' : x.why === 'both' ? 'both ceilings' : 'the entry ceiling') +
                    ' (entry ' + (x.entry + 1) + ')';
                }).join('; ')
              : 'Nothing was cut. An entry that is not above is one that found no keyword in the turns scanned \u2014 the Lore screen says which.'));
          }
          /* v1.46.0: recall spends a few hundred tokens on the model's own past, so
             the sheet says how many passages it took and where they came from —
             "the model brought up something from forty turns ago" is only reassuring
             when you can see it was paid for. */
          if (asm.recall) {
            var R = asm.recall;
            cutRows.push(li(!R.on
              ? 'Recall is off (Settings \u2192 Memory), so nothing older than this window was fetched.'
              : !R.passages
                ? 'Recall read ' + R.corpus + ' older messages and nothing in them matched this turn \u2014 a passage has to share two of your words to be fetched at all.'
                : 'Recall: ' + R.passages + ' passage' + (R.passages === 1 ? '' : 's') + ' of ' + R.ranked +
                  ' that matched, from ' + R.corpus + ' messages outside the window \u2014 ~' + R.tokens +
                  ' tokens' + (R.dropped ? ', ' + R.dropped + ' more that would not fit' : '') +
                  ' (from messages ' + (R.from || []).map(function (x) { return x + 1; }).join(', ') + ').'));
          }
        }
        var cuts = cutRows.length
          ? '<details open style="margin:7px 0;border:1px solid var(--line);border-radius:10px;padding:8px 10px">' +
            '<summary style="cursor:pointer;font-weight:600">What this request left out \u00b7 ' + cutRows.length + '</summary>' +
            cutRows.join('') + '</details>'
          : '';
        /* The body, from the function that posts it. `messages` is collapsed in
           the view because it is the block above, and showing a wall of it twice
           would bury the two fields worth reading. Opened only on a tap: a
           screenshot of a prompt is the user’s business, not the app’s. */
        var reqHtml = '', copyText = '';
        if (settings.provider === 'horde') {
          reqHtml = '<div class="hint" style="margin:9px 0 0">The Horde request is assembled in horde.js \u2014 worker and ' +
            'model negotiation first, then the prompt above as its own field. What this app decided is the prompt, its ' +
            'budget of ' + (API.HORDE_CTX_TOKENS || 8192).toLocaleString() + ' tokens, and the sampling on this card.</div>';
        } else if (API.chatRequestPlan) {
          var plan = API.chatRequestPlan(settings, payload, null);
          var body = plan.body;
          var shown = Object.assign({}, body, {
            messages: '[ ' + payload.length + ' messages, ' + totalChars.toLocaleString() +
              ' characters \u2014 shown block by block above ]'
          });
          copyText = App.redactCredentials(JSON.stringify(body, null, 2));
          reqHtml = '<details style="margin:9px 0 0;border:1px solid var(--line);border-radius:10px;padding:8px 10px">' +
            '<summary style="cursor:pointer;font-weight:600">Request body \u00b7 first round</summary>' +
            '<div class="hint" style="margin:6px 0">Exactly what goes to ' + esc(String(settings.model || 'the model')) +
            ' for a reply, from the one function that builds it. Your key is not in here \u2014 it rides in a header. ' +
            'A reroll or a continuation round adds one instruction line and sends back what it already has.</div>' +
            '<pre style="white-space:pre-wrap;overflow-wrap:anywhere;font-family:ui-monospace,monospace;font-size:11.5px;line-height:1.5;margin:6px 0 0;color:var(--text)">' +
            esc(App.redactCredentials(JSON.stringify(shown, null, 2))) + '</pre>' +
            '<button class="btn ghost sm" id="pi-copy" style="margin-top:8px">Copy full request (keys redacted)</button></details>';
        }
        return UI.sheet({
          title: 'Prompt & context inspector',
          body: notice + '<div class="hint" style="margin:0 0 9px">' + payload.length + ' messages · about ' +
            Math.ceil(totalChars / 4) + ' tokens / ' + totalChars.toLocaleString() + ' characters. Token count is a rough estimate; provider tokenizers differ.' +
            (asm && asm.modelWindow ? ' This model\u2019s window is read as ' + asm.modelWindow.toLocaleString() +
              ' tokens, of which the card and the reply budget take ' + (asm.cardTokens + asm.replyTokens).toLocaleString() + '.' : '') +
            '</div>' +
            (blocks || '<div class="hint">No prompt messages.</div>') + cuts + reqHtml,
          actions: [{ label: 'Close', cls: 'ghost', value: null }],
          onMount: function (b) {
            var cp = b.querySelector('#pi-copy');
            if (!cp) return;
            cp.onclick = function () {
              if (!navigator.clipboard || !navigator.clipboard.writeText) {
                UI.toast('This WebView has no clipboard access. The text above can still be selected and copied by hand.', 5000);
                return;
              }
              navigator.clipboard.writeText(copyText).then(function () {
                UI.toast('Request copied \u2014 any credential in it was replaced first');
              }, function () { UI.toast('The clipboard refused the write'); });
            };
          }
        });
      });
    }).catch(function (e) { UI.toast('Could not inspect this prompt: ' + (e && e.message), 4000); });
  };

  /* Per-chat lore is stored on the session, so separate AUs using the same
     character cannot leak facts into one another. */
  App.chatLoreBookSheet = function (sessionId) {
    IDB.get('sessions', sessionId).then(function (session) {
      if (!session) return;
      var entries = Array.isArray(session.chatLorebook) ? session.chatLorebook : [];
      var rows = entries.map(function (e, i) {
        var keys = (e.keys || []).join(', ') || 'No trigger keywords';
        var content = String(e.content || '').replace(/\s+/g, ' ').trim();
        if (content.length > 150) content = content.slice(0, 147) + '…';
        return '<div class="opt" data-chatlore-edit="' + i + '" style="align-items:flex-start;gap:8px">' +
          '<span style="flex:1;min-width:0"><b style="display:block">' + esc(keys) + '</b>' +
          '<span style="display:block;font-size:12px;color:var(--muted);margin-top:3px">' + esc(content || '(empty)') + '</span>' +
          (e.stage ? '<span style="display:block;font-size:11px;color:var(--dim);margin-top:3px">Stage: ' + esc(e.stage) + '</span>' : '') + '</span>' +
          '<span style="font-size:11px;color:var(--dim)">' + (e.enabled === false ? 'Off' : 'On') + '</span></div>';
      }).join('');
      UI.sheet({
        title: 'Chat-only lore — ' + (session.title || 'New chat'),
        body: '<p class="hint" style="margin:0 0 10px">These keyword facts apply only to this chat. The character’s own lorebook remains shared across its chats.</p>' +
          (rows || '<div class="hint" style="padding:10px 0">No chat-only lore yet. Add facts for this timeline, scene, or version of the character.</div>'),
        actions: [
          { label: 'Add entry', cls: 'primary', value: 'add' },
          { label: 'Done', cls: 'ghost', value: null }
        ],
        onMount: function (b, close) {
          b.querySelectorAll('[data-chatlore-edit]').forEach(function (el) {
            el.onclick = function () {
              var idx = parseInt(el.getAttribute('data-chatlore-edit'), 10);
              close();
              App.editChatLore(sessionId, idx);
            };
          });
        }
      }).then(function (action) {
        if (action === 'add') App.editChatLore(sessionId, null);
      });
    });
  };

  App.editChatLore = function (sessionId, idx, draft) {
    IDB.get('sessions', sessionId).then(function (session) {
      if (!session) return;
      var entries = Array.isArray(session.chatLorebook) ? session.chatLorebook.slice() : [];
      var isNew = idx === null || idx === undefined;
      var original = !isNew && entries[idx] ? entries[idx] : { id: UI.uid('cl'), keys: [], content: '', enabled: true, stage: '' };
      var entry = draft || Object.assign({}, original, { keys: (original.keys || []).slice() });
      UI.sheet({
        title: isNew ? 'New chat-only lore' : 'Edit chat-only lore',
        body: '<div class="field"><div class="field-head"><label>Trigger keywords</label></div>' +
          '<input type="text" id="clk" value="' + esc((entry.keys || []).join(', ')) + '" placeholder="silver gate, the old pact"></div>' +
          '<div class="field"><div class="field-head"><label>Content</label></div>' +
          '<textarea id="clc" class="tall">' + esc(entry.content || '') + '</textarea>' +
          '<div class="hint">Injected only in this chat when a keyword appears in recent messages. Keep details concise.</div></div>' +
          '<div class="field"><label>Timeline stage (optional, exact match)</label><input type="text" id="cls" maxlength="100" value="' + esc(entry.stage || '') + '" placeholder="e.g. Before the trial"><div class="hint">Requires the same active stage in Chat continuity. Leave blank for stage-independent lore; use * to always allow.</div></div>' +
          '<div class="field compact"><label>Enabled</label><div class="toggle' + (entry.enabled !== false ? ' on' : '') + '" id="cle"></div></div>',
        actions: [
          { label: 'Cancel', cls: 'ghost', value: null },
          (isNew ? null : { label: 'Remove', cls: 'danger', value: 'remove' }),
          { label: 'Save', cls: 'primary', onClick: function (b) {
            return {
              keys: b.querySelector('#clk').value.split(',').map(function (k) { return k.trim(); }).filter(Boolean),
              content: b.querySelector('#clc').value,
              stage: b.querySelector('#cls').value.trim().slice(0, 100),
              enabled: b.querySelector('#cle').classList.contains('on')
            };
          } }
        ].filter(Boolean),
        onMount: function (b) {
          b.querySelector('#cle').onclick = function () { this.classList.toggle('on'); };
        }
      }).then(function (result) {
        if (result === 'remove') {
          entries.splice(idx, 1);
          session.chatLorebook = entries;
        } else if (result && typeof result === 'object') {
          if (!result.keys.length || !String(result.content || '').trim()) {
            UI.toast('Add at least one keyword and some lore text');
            return App.editChatLore(sessionId, idx, {
              id: original.id, keys: result.keys, content: result.content, enabled: result.enabled, stage: result.stage
            });
          }
          entry.keys = result.keys;
          entry.content = String(result.content).trim();
          entry.enabled = result.enabled;
          entry.stage = result.stage || '';
          if (isNew) entries.push(entry); else entries[idx] = entry;
          session.chatLorebook = entries;
        } else {
          return App.chatLoreBookSheet(sessionId);
        }
        return Store.putSession(session).then(function () {
          if (App.state.session && App.state.session.id === sessionId) App.state.session = session;
          UI.toast(result === 'remove' ? 'Chat lore removed' : 'Chat lore saved');
          App.chatLoreBookSheet(sessionId);
        });
      });
    });
  };

  App.editLore = function (char, idx) {
    var entry = idx === null
      ? { id: UI.uid('l'), keys: [], content: '', enabled: true, stage: '',
          /* a new entry starts with nothing declared: no position, no order, no
             priority — so it never writes a spec field the author did not choose */
          constant: false, essential: false, selective: false, secondaryKeys: [], caseSensitive: false }
      : char.lorebook[idx];
    /* v1.40.0: the fields the matcher now honours are editable, not just
       importable. A card that arrived with them keeps exactly what it had (they
       are mirrored on import); this is for entries written here. */
    function chk(id, label, hint, on) {
      return '<div class="field compact"><label>' + label + '</label>' +
        '<div class="toggle' + (on ? ' on' : '') + '" id="' + id + '"></div>' +
        (hint ? '<div class="hint">' + hint + '</div>' : '') + '</div>';
    }
    UI.sheet({
      title: idx === null ? 'New lore entry' : 'Edit lore entry',
      body: '<div class="field"><div class="field-head"><label>Trigger keywords</label></div>' +
        '<input type="text" id="lk" value="' + esc((entry.keys || []).join(', ')) + '" placeholder="castle, the keep, iron gate"></div>' +
        '<div class="field"><div class="field-head"><label>Content</label></div>' +
        '<textarea id="lc" class="tall">' + esc(entry.content || '') + '</textarea>' +
        '<div class="hint">Injected whenever any keyword appears in recent messages.</div></div>' +
        '<div class="field"><label>Timeline stage (optional, exact match)</label><input type="text" id="ls" maxlength="100" value="' + esc(entry.stage || '') + '" placeholder="e.g. Before the trial"><div class="hint">Requires the same active stage in Chat continuity. Leave blank for stage-independent lore; use * to always allow.</div></div>' +
        '<div class="field compact"><label>Enabled</label><div class="toggle' + (entry.enabled !== false ? ' on' : '') + '" id="le"></div></div>' +
        chk('lcn', 'Always in the prompt', 'The card\'s <code>constant</code>: sent whether or not a keyword appears, while the budget lasts.', entry.constant === true) +
        chk('les', 'Treat as essential',
          'Horde\'s own flag (stored in the card\'s <code>extensions.horde_studio</code>): an essential entry is ' +
          'admitted ahead of any that is not always-on, so a tight budget spends itself on what the story ' +
          'cannot do without. It does not lift the byte limit.', entry.essential === true) +
        chk('lca', 'Match keys case-sensitively',
          'The V2/V3 <code>case_sensitive</code>: a key written with capitals only matches those capitals.',
          entry.caseSensitive === true) +
        chk('lse', 'Also require a second key',
          'The V2 <code>selective</code>: the entry needs a key from both lists before it fires — a primary ' +
          'keyword AND one from the list below. Secondary keys alone never wake an entry.',
          entry.selective === true) +
        '<div class="field"' + (entry.selective === true ? '' : ' hidden') + ' id="lsec-wrap">' +
          '<div class="field-head"><label>Second keys</label></div>' +
          '<input type="text" id="lsek" value="' + esc((entry.secondaryKeys || []).join(', ')) + '" placeholder="and any of these">' +
        '</div>' +
        '<div class="field"><div class="field-head"><label>Placement and order</label></div>' +
          '<input type="text" id="lpos" maxlength="11" value="' + esc(entry.position || '') + '" placeholder="before_char or after_char">' +
          '<input type="text" id="lior" maxlength="6" value="' + (entry.insertionOrder === null || entry.insertionOrder === undefined ? '' : entry.insertionOrder) + '" placeholder="insertion_order, e.g. 5">' +
          '<div class="hint">Both are the card\'s fields and both are applied only when the character has ' +
          '“Follow the card\'s lore order” on: placement says where an admitted entry sits relative to the ' +
          'character, and a lower order number means higher up. Leave blank to say nothing.</div></div>' +
        (entry.selectiveLogic !== undefined
          ? '<div class="hint" style="color:var(--warn,#fbbf24)">This entry carries SillyTavern\'s ' +
            '<code>selectiveLogic</code> (' + esc(String(entry.selectiveLogic)) + '), which no card spec ' +
            'defines. Horde matches the documented boolean rule instead; the value stays in the card.</div>'
          : '') +
        ((entry.selective !== undefined && entry.selective !== true && entry.selective !== false) ||
         (entry.caseSensitive !== undefined && entry.caseSensitive !== true && entry.caseSensitive !== false)
          ? '<div class="hint" style="color:var(--warn,#fbbf24)">A <code>selective</code> or ' +
            '<code>case_sensitive</code> on this entry is not true or false, so the spec treats it as absent. ' +
            'Flipping the switch here writes a real boolean.</div>'
          : '') +
        (typeof entry.priority === 'number'
          ? '<div class="hint">The card also set <code>priority: ' + esc(String(entry.priority)) + '</code> — ' +
            'read only in “follow the card\'s lore order” mode, where the lowest numbers are the first to be ' +
            'dropped when the book runs past its own token budget.</div>'
          : ''),
      actions: [
        { label: 'Cancel', cls: 'ghost', value: null },
        (idx === null ? null : { label: 'Delete', cls: 'danger', onClick: function () {
            char.lorebook.splice(idx, 1);
            Store.putCharacter(char).then(function () { Views.world($('.screen')); UI.toast('Entry removed'); });
          } }),
        { label: 'Save', cls: 'primary', onClick: function (b) {
            entry.keys = b.querySelector('#lk').value.split(',').map(function (k) { return k.trim(); }).filter(Boolean);
            entry.content = b.querySelector('#lc').value;
            entry.stage = b.querySelector('#ls').value.trim().slice(0, 100);
            function flag(id) { return !!b.querySelector('#' + id).classList.contains('on'); }
            entry.constant = flag('lcn');
            entry.essential = flag('les');
            entry.caseSensitive = flag('lca');
            entry.selective = flag('lse');
            entry.secondaryKeys = entry.selective
              ? b.querySelector('#lsek').value.split(',').map(function (k) { return k.trim(); }).filter(Boolean).slice(0, 12)
              : [];
            /* blank means "say nothing", which is not the same as either of the
               two spellings — an entry that never mentioned placement must not
               export a placement */
            var pos = b.querySelector('#lpos').value.trim();
            entry.position = (pos === 'before_char' || pos === 'after_char') ? pos : '';
            var ior = b.querySelector('#lior').value.trim();
            entry.insertionOrder = ior === '' || !isFinite(Number(ior)) ? null : Math.round(Number(ior));
            if (idx === null) char.lorebook.push(entry);
            Store.putCharacter(char).then(function () { Views.world($('.screen')); UI.toast('Saved'); });
          } }
      ].filter(Boolean),
      onMount: function (b) {
        b.querySelector('#le').onclick = function () {
          entry.enabled = entry.enabled === false;
          this.classList.toggle('on', entry.enabled !== false);
        };
        [['lcn', 'constant'], ['les', 'essential'], ['lca', 'caseSensitive'], ['lse', 'selective']].forEach(function (pair) {
          var el = b.querySelector('#' + pair[0]);
          el.onclick = function () {
            entry[pair[1]] = !entry[pair[1]];
            el.classList.toggle('on', entry[pair[1]] === true);
            /* the second-key list only means something to a selective entry, and
               a card that reads this file back should not see a list that nothing
               asks about - so clearing the switch hides and empties it */
            if (pair[1] === 'selective') {
              var w = b.querySelector('#lsec-wrap');
              if (w) w.hidden = entry.selective !== true;
              if (!entry.selective) b.querySelector('#lsek').value = '';
            }
          };
        });
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
                '<div class="opt" data-a="import-url">' + icon('download') + ' Import from URL</div>' +
                '<div class="opt" data-a="new">' + icon('plus') + ' New character</div>',
          onMount: function (b, close) {
            b.querySelectorAll('.opt').forEach(function (el) {
              el.onclick = function () {
                close();
                var a = el.getAttribute('data-a');
                if (a === 'import') App.importCard();
                else if (a === 'import-url') App.importCardFromUrl();
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
      /* v1.45.0: one call, because the bodies scan has to be started and
         cancelled from the same place the box is emptied. */
      App.setChatSearch(_chs.value);
    };
    var _att = $('#send-attach');
    if (_att) _att.onclick = function () { App.stageAttach(); };
    var _imp = $('#chats-import');
    if (_imp) _imp.onclick = function () { App.importChat(); };
    var _group = $('#chats-group');
    if (_group) _group.onclick = function () { App.createGroupChat(); };

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
        /* v1.39.18: capture the scroll anchor BEFORE the edit sheet steals
           the viewport. By confirm-time the keyboard reflow has already
           drifted scrollTop — anchoring on the drifted spot flung the
           reader a few messages up on every accepted edit. */
        var threadEl = $('#thread');
        var editAnchor = (threadEl && threadEl.children && threadEl.children.length)
          ? Views.threadAnchor(threadEl.children, threadEl.scrollTop) : null;
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
          delete msg.rpgStatusProposal;
          delete msg.continuityProposal;
          if (msg.alts && msg.alts.length) msg.alts[msg.altIdx || 0] = v;
          Store.updateMessage(msg).then(function () {
            Views.thread(App.state.char, App.state.session, App.state.messages, null, false, editAnchor);
          });
        });
      } else if (act === 'raw') {
        /* The app cut something out of this reply on the way to the screen.
           Show both texts and let the reader decide — the model's words are
           never re-inserted into a prompt or an alt by themselves. */
        if (!msg.rawKept || !msg.raw) {
          UI.toast('The removed text was not kept (' + (msg.rawDropped || 0) + ' characters)');
          return;
        }
        UI.input('What the model actually sent', {
          multiline: true, value: String(msg.raw), okLabel: 'Keep this text',
          message: msg.rawDropped + ' characters were removed while cleaning this reply' +
            (msg.rawEarlyEnd ? ', and the model also stopped mid-sentence.' : '.')
        }).then(function (v) {
          if (v === null || v === undefined) return;
          var keep = String(v);
          if (keep === msg.text) return;
          msg.text = keep;
          if (msg.alts && msg.alts.length) msg.alts[msg.altIdx || 0] = keep;
          delete msg.raw; delete msg.rawKept; delete msg.rawDropped; delete msg.rawEarlyEnd;
          Store.updateMessage(msg).then(function () {
            Views.thread(App.state.char, App.state.session, App.state.messages);
          }).catch(function () { UI.toast('Kept for this session only — the save failed'); });
        });
      } else if (act === 'del') {
        UI.confirm('Delete this message?', '', { danger: true, okLabel: 'Delete' }).then(function (ok) {
          if (!ok) return;
          Store.removeMessages([msg]).then(function () {
            App.state.messages = App.state.messages.filter(function (m) { return m.id !== msg.id; });
            Views.thread(App.state.char, App.state.session, App.state.messages);
          });
        });
      } else if (act === 'copy') {
        if (navigator.clipboard) navigator.clipboard.writeText(msg.text || '');
        UI.toast('Copied');
      } else if (act === 'download-image') {
        App.downloadChatImage(msg);
      } else if (act === 'rpg-review') {
        App.reviewRpgStatusProposal(msg);
      } else if (act === 'continuity-review') {
        App.reviewContinuityProposal(msg);
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
        /* Same message, fresh attempt: keep its persisted marker until a reply
           succeeds, so leaving during a failed/in-flight retry cannot lose it. */
        App.generateReply();
      } else if (act === 'cont') {
        if (App.state.busy) return UI.toast('Wait for the current reply');
        App.generateReply({ continueFor: msg });
      } else if (act === 'swipe') {
        var dir = parseInt(btn.getAttribute('data-dir'), 10);
        var n = msg.alts.length;
        msg.altIdx = ((msg.altIdx || 0) + dir + n) % n;
        msg.text = msg.alts[msg.altIdx];
        delete msg.rpgStatusProposal;
        delete msg.continuityProposal;
        Store.updateMessage(msg).then(function () { Views.thread(App.state.char, App.state.session, App.state.messages); });
      }
    });

    /* Virtual humans advance on real time: catch up when the app is opened,
       when it comes back to the foreground, and every minute while you're here. */
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) App.lifeTick();
    });
    setInterval(function () {
      if (!document.hidden) { App.lifeTick(); return; }
      /* v1.48.0: with the switch on, a pocketed app keeps advancing their day and
         still delivers what came due, so an arrival is a count waiting for you
         rather than a message generated the instant you unlocked the phone. The
         WebView is free to stop running this timer entirely while hidden - that is
         the platform's choice, not a bug this app can fix, and the catch-up on
         return is what makes either outcome correct. */
      if ((Store.settings || {}).lifeWhileAway === true) App.lifeTick({ background: true });
    }, 60000);

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
