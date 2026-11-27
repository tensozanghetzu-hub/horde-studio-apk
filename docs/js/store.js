/* Data model, persistence, import/export */
(function (global) {
  'use strict';

  /* Both previous defaults, kept verbatim so init can upgrade an install that
     never edited its prompt. An edited prompt (even by one character) is never
     touched: that is the user's own text and not ours to decide about. */
  var LEGACY_SYSTEM = 'You are {{char}}. Stay in character at all times. Write in a natural, immersive style, ' +
    'advancing the scene with concrete detail, action and dialogue. Never speak for {{user}}. ' +
    'Keep replies focused on what just happened and leave room for {{user}} to respond. ' +
    'Write only what {{char}} does and says: never include reasoning, planning, notes, ' +
    'outlines, or commentary about the prompt or the character card.';
  /* v1.39.108: this one asked for asterisks. "Asterisk italics for thoughts
     and actions" is read by the model as its own house style, so a narrator
     began marking every word - and long chats then amplified it out of the
     transcript until replies were unreadable. The request is simply gone. */
  var LEGACY_SYSTEM_STARRED = 'You are {{char}}. Stay in character at all times. Write in a natural, immersive style, ' +
    'advancing the scene with concrete detail, action and dialogue. Use double quotes for ' +
    'spoken dialogue and asterisk italics (*like this*) for thoughts and actions. ' +
    'Never speak for {{user}}. ' +
    'Keep replies focused on what just happened and leave room for {{user}} to respond. ' +
    'Write only what {{char}} does and says: never include reasoning, planning, notes, ' +
    'outlines, or commentary about the prompt or the character card.';

  /* v1.39.108: no asterisks. The old line asked for them, and the model read
     that as licence to mark its own narration - first every second word, then
     nearly every word in a long chat, because each starred reply was fed back
     as an example for the next one. Plain prose, dialogue in quotes. */
  var DEFAULT_SYSTEM = 'You are {{char}}. Stay in character at all times. Write in a natural, immersive style, ' +
    'advancing the scene with concrete detail, action and dialogue. ' +
    'Write narration and action as plain prose with no markers of any kind: no asterisks, ' +
    'no underscores, no brackets, no bold. Write spoken dialogue inside double quotation marks. ' +
    'If earlier replies in this chat use asterisks, do not imitate them: the transcript is not ' +
    'a style guide. ' +
    'Never speak for {{user}}. ' +
    'Keep replies focused on what just happened and leave room for {{user}} to respond. ' +
    'Write only what {{char}} does and says: never include reasoning, planning, notes, ' +
    'outlines, or commentary about the prompt or the character card.';

  /* Bumped with each release; the wrapper reports the real one when it is there. */
  function isProbablyJson(text) {
    var t = String(text || '').trim();
    return t.charAt(0) === '{' || t.charAt(0) === '[';
  }

  var VERSION = '1.48.8';

  var PRESETS = {
    openrouter: { label: 'OpenRouter', url: 'https://openrouter.ai/api/v1', keyRequired: true, note: 'One key, hundreds of models. Best default for phones.' },
    openai: { label: 'OpenAI', url: 'https://api.openai.com/v1', keyRequired: true, note: 'GPT-4o / GPT-4.1 family.' },
    together: { label: 'Together AI', url: 'https://api.together.xyz/v1', keyRequired: true, note: 'Fast open-weight hosting.' },
    nvidia: { label: 'NVIDIA NIM', url: 'https://integrate.api.nvidia.com/v1', keyRequired: true, note: 'Hosted open models.' },
    nanogpt: { label: 'NanoGPT', url: 'https://nano-gpt.com/api/v1', keyRequired: true, note: 'Pay-as-you-go OpenAI-compatible.' },
    ollama: { label: 'Ollama (home PC)', url: 'http://192.168.1.50:11434/v1', keyRequired: false, note: 'Local model server. Use your PC’s LAN IP — phone must share the Wi-Fi.' },
    lmstudio: { label: 'LM Studio (home PC)', url: 'http://192.168.1.50:1234/v1', keyRequired: false, note: 'Local model server over LAN.' },
    koboldcpp: { label: 'KoboldCpp (home PC)', url: 'http://192.168.1.50:5001/v1', keyRequired: false, note: 'Local model server over LAN.' },
    custom: { label: 'Custom (OpenAI-compatible)', url: 'https://', keyRequired: false, note: 'Any endpoint speaking the OpenAI chat-completions API.' },
    horde: { label: 'AI Horde (free, no key)', url: '', keyRequired: false, note: 'Crowdsourced volunteer GPUs. Slow but completely free, no signup.' }
  };

  var DEFAULTS = {
    provider: 'openrouter',
    baseUrl: PRESETS.openrouter.url,
    apiKey: '',
    model: '',
    temperature: 0.85,
    maxTokens: 400,
    topP: 0.95,
    topK: 0,
    repPen: 1.1,
    contextMessages: 40,
    /* v1.39.82: how many tokens of transcript to send. Visible and editable
       now — it used to be a 26 000-character literal inside api.js that
       silently outranked the message-count slider above. */
    historyTokens: 6000,
    systemPrompt: DEFAULT_SYSTEM,
    /* v1.41.0 (review issue 1): the one global say a card gets about the prompt
       that runs this app. Off by default, because "off" is the answer to a card
       asking; a card's own request lives on the character as `systemPromptAsked`
       until this is on or the player grants it there. */
    honorCardSystemPrompt: false,
    /* v1.47.0: the two lorebook asks a card can make that change what the model sees
       — regex keys, and one entry waking another. Both off, both global, both
       honoured only when the book also asked: a card cannot approve itself, and a
       switch that changed matching for every card at once is a preference, not a
       migration. See `loreOpts` in api.js for what each one unlocks. */
    honorCardRegex: false, honorCardRecursion: false,
    userName: 'You',
    userPersona: '',
    /* pronoun macros: {{sub}} {{obj}} {{poss}} {{poss_p}} {{ref}} */
    pronounPreset: 'they',
    pronouns: {},
    /* Personas: settings.userName / userPersona always hold the *effective*
       identity — the one every existing code path already reads. Switching a
       persona swaps these two in place, so nothing else has to change.
       defaultName / defaultPersona are the fallback identity used when no
       persona is selected, and are what the Settings fields edit in that case. */
    activePersona: '',
    defaultName: 'You',
    defaultPersona: '',
    /* 0 = not yet migrated. Bumped whenever the persona fields change shape;
       the migration seeds the fallback identity from userName/userPersona.
       We key on this rather than on undefined because DEFAULTS supplies keys. */
    personaSchema: 0,
    streaming: true,
    bursts: true,
    stripThinking: true,
    /* v1.43.0 */ replyFallback: '', reasoningOff: false,
    /* v1.45.0: display-only text scripts. `regexOn` is the switch the Generation
       screen owns, so its reset restores it; `regexScripts` is the list itself and
       the reset leaves it alone — putting a temperature back is a setting, deleting
       somebody's five saved rules is data. The list is always replaced whole
       (never pushed into), so DEFAULTS' array is never a shared mutable. */
    regexOn: false,
    regexScripts: [],
    /* v1.46.0: recall — scoring the messages the history window left out, on the
       phone, with no model. Off by default for the same reason the scripts are: a
       retriever that fires on the wrong word is a new failure mode, and it costs
       the prompt tokens. Not in GEN_KEYS: like autoMemory and memoryEvery this
       belongs to the Memory screen, and *Reset generation* has no claim on it. */
    recallOn: false,
    recallCount: 6,
    /* v1.48.0: whether a virtual human's day keeps advancing while the app is in
       your pocket, and whether an arrival tells you with a system notice. Both off,
       and both owned by the Generation screen — which is why they are in GEN_KEYS
       below: the first spends model calls you are not watching, so a reset that
       restores generation parameters restores this too, and nobody should have to
       remember where they left a cost switch. What they count (the unread marks)
       lives on the characters, and no settings reset touches it. */
    lifeWhileAway: false,
    notifyAway: false,
    updateUrl: '',
    autoFinish: true,       /* keep going when a reply comes back cut off */
    hordeKey: '',
    hordeModel: '',          /* '' = any available worker, which is the fastest option */
    hordeSize: 640,
    hordeSteps: 20,
    hordeMaxWait: 600,       /* seconds before we give up on a queued job */
    hordeTextModel: '',      /* '' = any available; Horde.ANY_UNCENSORED = uncensored only */
    imageProvider: 'horde',
    cloudflareWorkerUrl: '',
    cloudflareWorkerToken: '',
    autoMemory: true,
    memoryEvery: 14,
    sendOnEnter: false,
    showTokens: false,
    /* v1.26.0: appearance. One of THEMES.list(); 'midnight' is the
       original look and the fallback for anything unrecognized. */
    theme: 'midnight'
  };

  /* v1.39.3: the keys the Generation settings screen owns, and nothing else.
     The reset button builds its patch from exactly this list - provider, key,
     model, personas, theme are somebody else's screen and must not move. */
  var GEN_KEYS = ['temperature', 'maxTokens', 'topP', 'contextMessages',
                  'streaming', 'autoFinish', 'stripThinking', 'bursts', 'sendOnEnter', 'replyFallback', 'reasoningOff',
                  /* v1.45.0: the switch only. See DEFAULTS for why the list stays out. */
                  'regexOn',
                  /* v1.48.0: the two switches, for the reason in DEFAULTS. Neither is
                     a data list: `regexScripts` stayed out for being somebody's rules,
                     and the unread marks were never settings at all. */
                  'lifeWhileAway', 'notifyAway'];

  /* One repair, so the two ways in cannot drift apart: the count becomes the
       truth, and a bookmark that now sits past the end of the transcript is
       pulled back to it. That second half is not decoration — `memAt` ahead of
       `messageCount` makes `since` negative, and a negative `since` clears no
       `>=` gate, so a chat left in that state could never summarise again even
       after its count was fixed. Clamping only ever lowers a bookmark that is
       beyond the end, which cannot mean anything true. */
  function applyCount(s, n) {
    var at = s.memAt || 0;
    var changed = s.messageCount !== n || at > n;
    s.messageCount = n;
    if (at > n) s.memAt = n;
    return changed;
  }

  var Store = {
    settings: null,
    characters: [],
    personas: [],
    PRESETS: PRESETS,
    VERSION: VERSION,
    defaultSystem: DEFAULT_SYSTEM,
    GEN_KEYS: GEN_KEYS,

    /* Factory values for the nine generation keys, copied fresh so the
       caller can assign the object without aliasing DEFAULTS. */
    generationDefaults: function () {
      var p = {};
      GEN_KEYS.forEach(function (k) { p[k] = DEFAULTS[k]; });
      return p;
    },

    init: function () {
      var self = this;
      return IDB.get('kv', 'settings').then(function (row) {
        self.settings = Object.assign({}, DEFAULTS, row ? row.value : {});
        if (!self.settings.baseUrl && self.settings.provider && PRESETS[self.settings.provider]) {
          self.settings.baseUrl = PRESETS[self.settings.provider].url;
        }
        /* v1.5.0 migration: seed the fallback identity from the legacy fields,
           so an existing install behaves exactly as it did before. Keyed on
           personaSchema, not on undefined — DEFAULTS supplies these keys. */
        var s = self.settings, dirty = false;
        if (['horde', 'pollinations', 'cloudflare'].indexOf(s.imageProvider) === -1) {
          s.imageProvider = 'horde';
          dirty = true;
        }
        if (s.personaSchema !== 1) {
          s.defaultName = s.userName || 'You';
          s.defaultPersona = s.userPersona || '';
          s.activePersona = '';
          s.personaSchema = 1;
          dirty = true;
        }
        /* v1.16.0 migration: the default system prompt gained a
           dialogue/thought formatting line. Give it to users who still hold
           the old default verbatim; anyone who ever edited the prompt (even
           one character) is left untouched. */
        if (s.systemPrompt === LEGACY_SYSTEM || s.systemPrompt === LEGACY_SYSTEM_STARRED) {
          s.systemPrompt = DEFAULT_SYSTEM;
          dirty = true;
        }
        var saved = dirty ? self.saveSettings() : Promise.resolve();
        return saved
          .then(function () { return self.refreshPersonas(); })
          .then(function () { return self.applyPersona(); })
          .then(function () { return self.refreshCharacters(); });
      });
    },

    saveSettings: function (patch) {
      if (patch) Object.assign(this.settings, patch);
      return IDB.put('kv', { key: 'settings', value: this.settings });
    },

    refreshCharacters: function () {
      var self = this;
      return IDB.getAll('characters').then(function (list) {
        self.characters = (list || []).sort(function (a, b) { return (b.updatedAt || 0) - (a.updatedAt || 0); });
        return self.characters;
      });
    },

    /* ---------------- characters ---------------- */
    blankCharacter: function () {
      return {
          id: UI.uid('c'), name: '', tagline: '', avatar: '',
          persona: '', scenario: '', greeting: '', examples: '',
          postHistory: '', tags: [], systemPrompt: '',
          /* v1.40.0 (compatibility letter, items 2, 3, 4, 6). Every one of these
             defaults to "what this app has always done", so an existing or
             hand-made character is unaffected until the player chooses.
               postHistoryPlacement  'sheet' | 'tail' | 'off'  (item 2)
               systemPromptSource    '' (= app) | 'card' | 'combine'  (item 3)
               cardSystemPrompt      the card's own text, kept and SHOWN, applied
                                     only when systemPromptSource says so
               loreCompat            honour the book's own ordering and budget
               loreScanTurns         0 = the app's 6-turn window (item 4c)
               loreBookScan/Budget   the card's own numbers, read in compat mode
               directives            `extensions.horde_studio.*` (item 6)
               cardAsked             what the card asked for at import, kept so an
                                     export can tell a player's choice from the
                                     author's (v1.41.0, review issue 2)
               systemPromptAsked     the card's request only — never applied by
                                     itself (v1.41.0, review issue 1)
               personaSplit/descText/persText  the card's two persona fields,
                                     editable apart (v1.41.0, review request 4) */
          postHistoryPlacement: 'sheet', systemPromptSource: '', cardSystemPrompt: '',
          systemPromptAsked: '', cardAsked: null,
          loreCompat: false, loreScanTurns: 0, loreBookScan: 0, loreBookBudget: 0,
          directives: { agency: '', style: '', canon: '', progression: '', stages: '', priority: '' },
          personaSplit: false, descText: '', persText: '',
          temperature: null, maxTokens: null,
          lorebook: [], expressionPortraits: [], vh: (global.VH ? VH.defaults() : null),
          /* v1.13.0: internal state — off by default, so existing and new
             chats behave exactly as before until it is switched on. */
          stateTracking: false, state: { mood: '', intent: '', flags: '' },
          createdAt: Date.now(), updatedAt: Date.now()
      };
    },

    getCharacter: function (id) {
      return this.characters.find(function (c) { return c.id === id; }) ||
        IDB.get('characters', id);
    },

    putCharacter: function (c) {
      c.updatedAt = Date.now();
      var self = this;
      return IDB.put('characters', c).then(function () { return self.refreshCharacters(); });
    },

    delCharacter: function (id) {
      var self = this;
      return IDB.getAllByIndex('sessions', 'charId', id).then(function (sessions) {
        return Promise.all((sessions || []).map(function (s) { return self.delSession(s.id); }));
      }).then(function () {
        return IDB.del('characters', id);
      }).then(function () { return self.refreshCharacters(); });
    },

    /* ---------------- personas ---------------- */
    refreshPersonas: function () {
      var self = this;
      return IDB.getAll('personas').then(function (list) {
        self.personas = (list || []).sort(function (a, b) { return (b.updatedAt || 0) - (a.updatedAt || 0); });
        return self.personas;
      });
    },

    blankPersona: function () {
      /* v1.31.0: avatar is the persona's own photo; it lives on the persona
         record (never in settings), so each identity keeps its own face. */
      return { id: UI.uid('p'), name: '', text: '', avatar: '', createdAt: Date.now(), updatedAt: Date.now() };
    },

    putPersona: function (p) {
      p.updatedAt = Date.now();
      var self = this;
      return IDB.put('personas', p).then(function () { return self.refreshPersonas(); });
    },

    /** Deleting a persona also removes its chats, mirroring character deletion.
        Resolves with the number of chats that went with it. */
    delPersona: function (id) {
      var self = this;
      return IDB.getAll('sessions').then(function (all) {
        var mine = (all || []).filter(function (s) { return (s.personaId || '') === id; });
        return Promise.all(mine.map(function (s) { return self.delSession(s.id); }))
          .then(function () { return mine.length; });
      }).then(function (n) {
        if (self.settings.activePersona === id) {
          self.settings.activePersona = '';
          self.settings.userName = self.settings.defaultName || 'You';
          self.settings.userPersona = self.settings.defaultPersona || '';
          return self.saveSettings().then(function () { return n; });
        }
        return n;
      }).then(function (n) {
        return IDB.del('personas', id)
          .then(function () { return self.refreshPersonas(); })
          .then(function () { return n; });
      });
    },

    activePersonaObj: function () {
      var id = (this.settings && this.settings.activePersona) || '';
      if (!id) return null;
      return (this.personas || []).find(function (p) { return p.id === id; }) || null;
    },

    /** Switch identity. Pass '' to return to the default (Settings) identity. */
    switchPersona: function (id) {
      var s = this.settings;
      /* Leaving the default identity — stash it so we can come back. */
      if (!s.activePersona) { s.defaultName = s.userName; s.defaultPersona = s.userPersona; }
      var p = id ? (this.personas || []).find(function (x) { return x.id === id; }) : null;
      if (id && !p) return Promise.resolve(null);
      s.activePersona = p ? p.id : '';
      s.userName = p ? (p.name || 'You') : (s.defaultName || 'You');
      s.userPersona = p ? (p.text || '') : (s.defaultPersona || '');
      s.pronounPreset = (p && p.pronounPreset) || 'they';
      s.pronouns = (p && p.pronouns) || {};
      return IDB.put('kv', { key: 'settings', value: s }).then(function () { return p || null; });
    },

    /** Re-apply the active persona's name/text — used on boot. */
    applyPersona: function () {
      var p = this.activePersonaObj(), s = this.settings;
      if (!p) return Promise.resolve(null);
      s.userName = p.name || 'You';
      s.userPersona = p.text || '';
      s.pronounPreset = p.pronounPreset || 'they';
      s.pronouns = p.pronouns || {};
      return Promise.resolve(p);
    },

    /** Who you are right now — the persona name, or the default. */
    personaLabel: function () {
      var p = this.activePersonaObj();
      return p ? (p.name || 'Unnamed') : ((this.settings && this.settings.defaultName) || 'You');
    },

    /** Editing the identity in Settings has to land in the right place:
        the persona record when one is active, otherwise the default pair. */
    setIdentity: function (patch) {
      var s = this.settings, p = this.activePersonaObj();
      if (patch.name !== undefined) s.userName = patch.name;
      if (patch.text !== undefined) s.userPersona = patch.text;
      if (patch.pronounPreset !== undefined) s.pronounPreset = patch.pronounPreset;
      if (patch.pronouns !== undefined) s.pronouns = Object.assign({}, s.pronouns || {}, patch.pronouns);
      var chain = Promise.resolve();
      if (p) {
        if (patch.name !== undefined) p.name = patch.name;
        if (patch.text !== undefined) p.text = patch.text;
        if (patch.pronounPreset !== undefined) p.pronounPreset = patch.pronounPreset;
        if (patch.pronouns !== undefined) p.pronouns = Object.assign({}, p.pronouns || {}, patch.pronouns);
        chain = this.putPersona(p);
      } else {
        if (patch.name !== undefined) s.defaultName = patch.name;
        if (patch.text !== undefined) s.defaultPersona = patch.text;
      }
      return chain.then(function () { return s; });
    },

    /* ---------------- sessions ---------------- */
    newSession: function (charId, title) {
      return {
        id: UI.uid('s'), charId: charId, title: title || 'New chat',
        personaId: (this.settings && this.settings.activePersona) || '',
        summary: '', facts: [], messageCount: 0,
        /* Keyword lore scoped to this transcript only; legacy sessions read as empty. */
        chatLorebook: [],
        /* recurring scene reminder and per-chat prompt placement/cadence */
        sceneNote: '', sceneNotePlacement: 'end', sceneNoteFrequency: 1,
        /* Empty groupCharIds means this remains a normal one-character chat. */
        groupCharIds: [], speakerMode: 'manual', nextSpeakerId: '',
        /* Scene cast for multi-person cards: who is in this chat's cast,
           who is currently present, and who the next message addresses.
           An empty cast keeps the feature off for this chat. */
        sceneCast: [], scenePresent: [], addressedTo: '', castChecked: false,
        /* v1.39.111: who last held the floor. Rides with addressedTo so the
           request knows both who is being spoken to and who spoke last; both
           are cleared when the person leaves the cast. */
        lastSpeaker: '',
        /* v1.39.112: one-shot flag so the style-lock toast fires once per chat. */
        styleLockNotified: false,
        timeline: 'main', pending: null,
        /* v1.39.0 chatwork: pin & archive live on the session, the layer the
           list sorts and hides by. Old sessions arrive without them and
           read as false. */
        pinned: false, archived: false,
        /* per-chat generation overrides (temperature/maxTokens) and a style
           note, set from Chat settings; null means "like the character". */
        overrides: null,
        /* Optional player RPG ledger, scoped to this transcript and shared across its group speakers. */
        rpgStatus: null,
        /* Generic continuity state is opt-in and isolated to this conversation. */
        continuity: { enabled: false, stage: '', location: '', time: '', participants: [], knowledge: [], events: [] },
        /* auto-title bookkeeping: once we named it for you, a manual rename
           is never overwritten; unset means the chat may learn its name. */
        titleAuto: false,
        createdAt: Date.now(), updatedAt: Date.now()
      };
    },

    /* v1.48.6: `messageCount` is a cache of something the message store owns,
       and it used to be maintained by one `+1` that nobody ever subtracted
       from — so a whole transcript of repairs hung on every caller being
       well-behaved. They were not: 33 places in `app.js` hand `putSession` an
       object they loaded earlier (there is no `getSession(id)`, only
       `getSessions`/`allSessions`, so a snapshot is what you get by default),
       and a background job that finished after its own read wrote the old
       number back over the new one. Measured: 12 rows on disk, `messageCount`
       1. Because `since = messageCount - memAt` gates auto-summarising, the
       chat did not just display a wrong figure — it silently stopped being
       able to reach the gate again.
       So: the number has an owner (recountSession / reconcile / addMessage),
       a generic save carries the STORED value forward instead of the one in
       the caller's hand, and opening a chat reconciles the cache against the
       rows it loaded anyway. That last part is what makes forgetting the door
       survivable: a missed update costs one re-open, not a permanent lie. */
    putSession: function (s) {
      var self = this;
      return IDB.get('sessions', s.id).then(function (cur) {
        if (cur) s.messageCount = cur.messageCount;
        s.updatedAt = Date.now();
        return IDB.put('sessions', s);
      });
    },

    /* What "how many messages" means, in one place. It is the transcript, not
       every row: a vhuman "is busy right now" notice is a bubble in the
       thread and deliberately not a turn — `app.js` keeps it out of the prompt
       history and out of the export for the same reason. Written twice before
       (the `+1` counted it, the importer's recount did not), which is how the
       two writers of this number could disagree about the same chat. */
    transcript: function (list) {
      return (list || []).filter(function (m) { return m && m.role !== 'system'; });
    },
    countTranscript: function (list) { return Store.transcript(list).length; },

    /* The door for a caller holding only an id: read the rows, count them,
       store the truth. */
    recountSession: function (sessionId) {
      return IDB.getAllByIndex('messages', 'sessionId', sessionId).then(function (list) {
        var n = Store.countTranscript(list);
        return IDB.get('sessions', sessionId).then(function (s) {
          if (!s) return n;
          var dirty = applyCount(s, n);
          if (Store.reconcileLedger(s, list)) dirty = true;
          if (!dirty) return n;
          s.updatedAt = Date.now();
          return IDB.put('sessions', s).then(function () { return n; });
        });
      });
    },

    /* v1.48.8: the ledger gets the same repair through the same door. Its
       history lives on the replies that earned it (`msg.rpgAward`), so the total
       is a cache of those rows and a batch delete — an edit-and-resend, a
       removed message — is the moment it has to follow. One function rather than
       a rule each of the callers has to remember, which is the mistake v1.48.6
       was about. The arithmetic is not repeated here: `API.rpgLedger` owns it, so
       the log, the sheet and the prompt cannot disagree about what the rows say.
       A store that has no API loaded (a bare harness) reconciles nothing rather
       than inventing its own rules. */
    reconcileLedger: function (s, list) {
      if (!s || !s.rpgStatus || s.rpgStatus.enabled !== true) return false;
      if (typeof API === 'undefined' || !API.rpgLedger) return false;
      var res = API.rpgLedger(s.rpgStatus, list);
      if (!res.changed) return false;
      s.rpgStatus = res.status;
      return true;
    },

    /* The same repair for a caller that already has the rows — which is every
       path that matters, since opening a chat loads all of them for the thread.
       Writes only when something is actually wrong. */
    reconcile: function (s, list) {
      var n = Store.countTranscript(list);
      if (!s) return Promise.resolve(n);
      var dirty = applyCount(s, n);
      if (Store.reconcileLedger(s, list)) dirty = true;
      if (!dirty) return Promise.resolve(n);
      s.updatedAt = Date.now();
      return IDB.put('sessions', s).then(function () { return n; });
    },

    /* One question with three callers in `app.js`: the chat's health readout,
       and both halves of the auto-memory trigger. Un-clamped, a bookmark ahead
       of the count answered negative — and a negative number never reaches
       `>= memoryEvery`, so a chat whose count had been rewound could not
       remember again, ever, without an error message anywhere. */
    sinceMemory: function (s, liveCount) {
      if (!s) return 0;
      var seen = typeof liveCount === 'number' ? liveCount : (s.messageCount || 0);
      /* `memoryAt` is what the bookmark was called before v1.39; a session
         that only carries the old name must not read as "never summarised",
         which is what dropping the alias would have done here. */
      var at = s.memAt || s.memoryAt || 0;
      return Math.max(0, seen - at);
    },

    /* Every persona gets its own threads with a character. Sessions written
       before v1.5.0 carry no personaId and belong to the default identity. */
    getSessions: function (charId) {
      var active = (this.settings && this.settings.activePersona) || '';
      return IDB.getAllByIndex('sessions', 'charId', charId).then(function (list) {
        return (list || []).filter(function (s) {
          return (s.personaId || '') === active;
        }).sort(function (a, b) { return (b.updatedAt || 0) - (a.updatedAt || 0); });
      });
    },

    allSessions: function () {
      var active = (this.settings && this.settings.activePersona) || '';
      return IDB.getAll('sessions').then(function (list) {
        return (list || []).filter(function (s) {
          return (s.personaId || '') === active;
        }).sort(function (a, b) { return (b.updatedAt || 0) - (a.updatedAt || 0); });
      });
    },

    /** How many sessions exist across ALL personas — powers the "nothing was
       lost" hint on the Chats screen when the active identity is empty but
       another identity has conversations. */
    sessionTotal: function () {
      return IDB.getAll('sessions').then(function (list) { return (list || []).length; });
    },

    delSession: function (id) {
      return IDB.deleteByIndex('messages', 'sessionId', id).then(function () { return IDB.del('sessions', id); });
    },

    /* ---------------- messages ---------------- */
    addMessage: function (msg) {
      var self = this;
      msg.id = msg.id || UI.uid('m');
      msg.createdAt = msg.createdAt || Date.now();
      return IDB.put('messages', msg).then(function () {
        return IDB.get('sessions', msg.sessionId);
      }).then(function (s) {
        if (!s) return null;
        s.updatedAt = Date.now();
        /* a delta, not a recount: this runs on every reply, and the base it
           increments is reconciled whenever the chat is opened. A system notice
           is a notice in the thread but not a turn — see countTranscript. */
        if (msg.role !== 'system') s.messageCount = (s.messageCount || 0) + 1;
        return IDB.put('sessions', s);
      }).then(function () { return msg; });
    },

    updateMessage: function (msg) {
      return IDB.put('messages', msg);
    },

    /* The raw delete. Anything that changes the transcript through this had
       better recount: `removeMessages` does, in one pass for a whole batch. */
    delMessage: function (id) {
      return IDB.del('messages', id);
    },

    /* Edit-and-resend deletes every turn after the edited one. `delMessage`
       alone left `messageCount` holding the old total forever — an over-count
       is as invisible as a rewind, and the memory gate reads it either way.
       One recount after the batch, rather than one per row: the deletes are
       issued in parallel, so N decrements would race each other and lose. */
    removeMessages: function (list) {
      var ids = (list || []).map(function (m) { return m && m.id; }).filter(Boolean);
      var self = this;
      var sessionId = null;
      (list || []).some(function (m) { if (m && m.sessionId) { sessionId = m.sessionId; return true; } return false; });
      return Promise.all(ids.map(function (id) { return IDB.del('messages', id); })).then(function () {
        return sessionId === null ? ids.length : self.recountSession(sessionId);
      });
    },

    getMessages: function (sessionId) {
      return IDB.getAllByIndex('messages', 'sessionId', sessionId).then(function (list) {
        return (list || []).sort(function (a, b) { return a.createdAt - b.createdAt; });
      });
    },

    /* ---------------- import / export ---------------- */
    exportAll: function () {
      var self = this;
      return Promise.all([
        IDB.getAll('characters'), IDB.getAll('sessions'),
        IDB.getAll('messages'), IDB.getAll('personas'),
        IDB.getAll('worlds'), IDB.getAll('worldRuns')
      ]).then(function (r) {
        var s = Object.assign({}, self.settings);
        delete s.apiKey; delete s.hordeKey; delete s.cloudflareWorkerToken; // credentials never leave the device
        return JSON.stringify({
          format: 'horde-studio-mobile', version: 1, exportedAt: new Date().toISOString(),
          settings: s, characters: r[0] || [], sessions: r[1] || [],
          messages: r[2] || [], personas: r[3] || [],
          worlds: r[4] || [], worldRuns: r[5] || []
        }, null, 2);
      });
    },

    importAll: function (text) {
      var data = JSON.parse(text);
      if (!data || !data.characters) throw new Error('Not a Horde Studio backup');
      var self = this;
      var chars = data.characters || [], sessions = data.sessions || [], msgs = data.messages || [];
      var personas = data.personas || [];
      /* Backups written before 1.5.0 have no worlds/worldRuns keys. An absent
         key must leave whatever is installed alone — never clear it. */
      var worlds = Array.isArray(data.worlds) ? data.worlds : [];
      var worldRuns = Array.isArray(data.worldRuns) ? data.worldRuns : [];
      return Promise.all([
        IDB.putMany('characters', chars),
        IDB.putMany('sessions', sessions),
        IDB.putMany('messages', msgs),
        personas.length ? IDB.putMany('personas', personas) : Promise.resolve(),
        worlds.length ? IDB.putMany('worlds', worlds) : Promise.resolve(),
        worldRuns.length ? IDB.putMany('worldRuns', worldRuns) : Promise.resolve()
      ]).then(function () { return self.refreshPersonas(); })
        .then(function () {
          return {
            characters: chars.length, sessions: sessions.length,
            messages: msgs.length, personas: personas.length,
            worlds: worlds.length, worldRuns: worldRuns.length
          };
        });
    },

    /* SillyTavern-style card -> internal character */
    /* Cards may carry several starting scenarios (scenario_list, the
       SillyTavern convention). Keep the list so the player can choose which
       one to start from; the character's `scenario` field holds the
       currently chosen one (the prompt already injects that field). */
    scenarioList: function (data) {
      data = data || {};
      var out = [];
      function add(s) {
        s = (s == null ? '' : String(s)).trim();
        if (s && out.indexOf(s) === -1) out.push(s);
      }
      if (Array.isArray(data.scenario_list)) data.scenario_list.forEach(add);
      add(data.scenario); /* the card's declared default, appended if unlisted */
      return out;
    },

    /* The card's avatar (char_x, the SillyTavern convention). A usable value
       is a data: image URI or a web URL; a relative path from another
       SillyTavern install would point at a file that does not exist here, so
       reject it rather than storing a broken <img>. */
    cardAvatar: function (x) {
      x = (x == null ? '' : String(x)).trim();
      return (/^data:image\//i.test(x) || /^https?:\/\//i.test(x)) ? x : '';
    },

    /* v1.29.0 — pictures a card carries BESIDES its avatar. Card authors
       (the v3 spec allows arbitrary fields in `data`) often stash extra
       images there — data-URLs, or image web URLs, top-level or nested a
       couple of levels deep. Collect them as [{name, src}]: char_x itself
       and any duplicate of the avatar are excluded, non-image strings are
       ignored, and the haul is capped at 8 pictures. */
    cardImages: function (data, avatar) {
      var out = [];
      var seen = {};
      if (avatar) seen[avatar] = true;
      var isImage = function (v) {
        if (typeof v !== 'string') return false;
        v = v.trim();
        if (!v) return false;
        return /^data:image\//i.test(v) ||
          /^https?:\/\/\S+\.(png|jpe?g|webp|gif)(?:\?\S*)?$/i.test(v);
      };
      (function walk(obj, prefix, depth) {
        if (!obj || typeof obj !== 'object' || Array.isArray(obj) || depth > 3) return;
        Object.keys(obj).forEach(function (k) {
          if (out.length >= 8) return;
          if (k === 'char_x') return;                 /* the avatar, handled separately */
          var v = obj[k];
          var name = prefix ? prefix + '_' + k : k;
          if (isImage(v)) {
            if (!seen[v]) { seen[v] = true; out.push({ name: name, src: v }); }
          } else if (v && typeof v === 'object') {
            walk(v, name, depth + 1);
          }
        });
      })(data, '', 0);
      return out;
    },

    /* v1.40.0 (items 3, 4c, 6): three small reads that both import branches
       need, kept here so the two cannot drift apart.
       - the card's own `system_prompt`, kept verbatim for display and only
         applied if the character says so (see API.systemTextOf)
       - the book's `scan_depth` / `token_budget`, which the app treats as
         limits it may NARROW, never widen, and only in compat mode
       - `extensions.horde_studio.*`, the fields Horde owns: read only when the
         card actually sets them, capped so a card cannot use them to grow the
         prompt past the editor's own limits */
    cardSystemPromptOf: function (data) {
      var sp = data && data.system_prompt;
      return (sp == null ? '' : String(sp)).trim().slice(0, Store.CARRY_CAP);
    },
    bookLimitsOf: function (card, data) {
      var book = (data && data.character_book) || (card && card.data && card.data.character_book) ||
        (card && card.character_book) || null;
      function num(v) { var n = Number(v); return (isFinite(n) && n > 0) ? n : 0; }
      return { scan: book ? num(book.scan_depth) : 0, budget: book ? num(book.token_budget) : 0 };
    },
    /* The six fields are CARRIED whole (up to a storage bound) and BUDGETED at
       the point of use, in api.js. Truncating on import would mean an export
       from here returned a shorter text than the card had, which is the one
       thing item 1 rules out; a prompt that grows without limit is a different
       problem, and it is solved where the prompt is built. */
    CARRY_CAP: 4000,
    cardDirectives: function (data, card) {
      var hx = Store.hordeBlock(data, card);
      var out = {};
      ['agency', 'style', 'canon', 'progression', 'stages', 'priority'].forEach(function (k) {
        var v = hx[k];
        v = (v == null ? '' : String(v)).trim();
        out[k] = v ? v.slice(0, Store.CARRY_CAP) : '';
      });
      return out;
    },
    /* how much of the card's text this app carries, so the importer can say so
       when it had to cut - the card keeps its own copy either way */
    cardCarryOver: function (data, card) {
      var hx = Store.hordeBlock(data, card);
      var over = 0;
      ['agency', 'style', 'canon', 'progression', 'stages', 'priority'].forEach(function (k) {
        if (String(hx[k] == null ? '' : hx[k]).trim().length > Store.CARRY_CAP) over++;
      });
      if (String(data && data.system_prompt ? data.system_prompt : '').trim().length > Store.CARRY_CAP) over++;
      return over;
    },

    /* What this app ADDS to a card's `extensions.horde_studio` (item 6): the
       six authoring fields, plus the per-character choices that have no home
       anywhere else in the spec. Keys are written only when they carry a value,
       so a character that decided nothing exports the extensions object it came
       in with - an export is never the moment a card grows fields. */
    hordeCardFields: function (c) {
      var out = {};
      var was = (c && c.cardAsked) || null;
      /* Characters saved by v1.40.0 have no snapshot to compare against, but the
         card they came from is still in there. Read the ask off the copy rather
         than falling back to the old rule, so clearing something works for them
         too and not only for cards imported from this version on. */
      if (!was && c && c.cardSource) {
        try {
          var sc = c.cardSource;
          var sx = (sc.body && sc.body.extensions) || (sc.top && sc.top.extensions) || null;
          if (sx) was = Store.hordeCardChoices({ extensions: sx }, {}).asked;
        } catch (err) { was = null; }
      }
      var d = (c && c.directives) || {};
      var wd = (was && was.directives) || {};
      /* One rule for every key this app owns: write the character's value when it
         is not what the card said at import, and say nothing when it is. An
         untouched card therefore exports the author's own bytes — including a
         value this app would never have written itself, which is what the old
         code preserved too — while a value the player moved BACK to the default
         is a change like any other and gets written. Without that second half,
         clearing a Horde instruction or resetting a mode did nothing at all: the
         key stayed out of the export, the preserved copy kept the author's
         value, and the next import put it straight back (review issue 2). */
      ['agency', 'style', 'canon', 'progression', 'stages', 'priority'].forEach(function (k) {
        var v = String(d[k] || '').trim();
        if (was) { if (v !== String(wd[k] || '')) out[k] = v; }
        else if (v) out[k] = v;
      });
      var place = (c.postHistoryPlacement === 'tail' || c.postHistoryPlacement === 'off')
        ? c.postHistoryPlacement : 'sheet';
      if (was ? place !== was.postHistoryPlacement : place !== 'sheet') out.post_history_placement = place;
      var compat = c.loreCompat === true;
      if (was ? compat !== was.loreCompat : compat) out.lore_compat = compat;
      var turns = Math.min(24, Math.max(0, parseInt(c.loreScanTurns, 10) || 0));
      if (was ? turns !== was.loreScanTurns : turns > 0) out.lore_scan_turns = turns;
      /* The prompt mode is not snapshot-compared, because there is nothing to
         compare it with: the card's `system_prompt_source` is an author's request,
         which the preserved copy carries back out untouched, while the
         character's `systemPromptSource` is a person's decision — and 'app' is a
         decision like any other, which is how "not this card's prompt" survives
         being saved and re-imported. */
      if (c.systemPromptSource) out.system_prompt_source = String(c.systemPromptSource);
      return out;
    },
    /* The same keys read back, with every unknown value falling to the app's own
       default rather than to a guess: a card that says `post_history_placement:
       "middle"` gets the sheet placement, which is what it had before this
       feature existed at all. */
    hordeCardChoices: function (data, card) {
      var hx = Store.hordeBlock(data, card);
      var PL = { sheet: 'sheet', tail: 'tail', off: 'off' };
      var SRC = { app: 'app', card: 'card', combine: 'combine' };
      var turns = parseInt(hx.lore_scan_turns, 10);
      var place = PL[hx.post_history_placement] || 'sheet';
      var compat = hx.lore_compat === true;
      var scan = turns > 0 ? Math.min(24, turns) : 0;
      var asked = SRC[hx.system_prompt_source] || '';
      var dirs = Store.cardDirectives(data, card);
      return {
        postHistoryPlacement: place,
        compat: compat, scan: scan,
        /* v1.41.0 (review issue 1). A card asking for its own prompt is a request
           about who is in charge of the conversation, not a line of character
           text, so it is recorded here and applied by nobody. `systemPromptAsked`
           is what the editor offers and what CARDS.md documents; the field the
           prompt actually reads is `systemPromptSource`, which only a person (or
           their own global preference) can set. */
        systemPromptAsked: asked,
        directives: dirs,
        /* The snapshot an export compares against: exactly what this import
           derived from the card, so "the player changed it" and "the card said
           this and nobody touched it since" cannot be confused (issue 2). Keys
           the card never wrote are absent, which is how the old rule — add only
           non-default values — still works for hand-made characters. Copied, not
           aliased: the live directives are the very object the editor writes
           into, and a snapshot that moves when the character does would say
           nothing was ever changed. */
        asked: {
          postHistoryPlacement: place,
          systemPromptSource: asked,
          loreCompat: compat,
          loreScanTurns: scan,
          directives: Object.assign({}, dirs)
        }
      };
    },
    /* `extensions.horde_studio` as the card wrote it, from whichever of the three
       places a card may keep its extensions. Never edited in place. */
    hordeBlock: function (data, card) {
      var ext = (data && data.extensions) || (card && card.extensions) ||
        (card && card.data && card.data.extensions) || {};
      var hx = (ext && (ext.horde_studio || ext.hordeStudio)) || {};
      return (hx && typeof hx === 'object' && !Array.isArray(hx)) ? hx : {};
    },
    /* Where the mode itself is decided: api.js `cardPromptMode`, which reads the
       character's `systemPromptSource` (a person's decision) and only falls back
       to the card's request through the player's own global preference. The
       request is kept on the character as `systemPromptAsked` for the editor and
       for export, and never applies itself. */

    /* the lorebook a card embeds. V2 puts it in data.character_book,
       V3 in data.character_book too, and legacy V1 cards hang it off the
       top level — accept all three, drop nothing. */
    bookFromCard: function (card, data) {
      var book = (data && data.character_book)
        || (card.data && card.data.character_book)
        || card.character_book || null;
      var entries = book && book.entries;
      return Array.isArray(entries) ? entries.map(function (e) {
        /* C1 (v1.39.70): `constant` is the field authors rely on most — an
           entry that must always be in context. It used to be dropped here, so
           a card relying on it silently got nothing. */
        /* v1.40.0: the fields the matcher honours are imported, not just
           preserved. `selectiveLogic` is the exception — a SillyTavern field
           with no place in either spec — so it rides in as a raw value purely so
           the Lore screen can say it is not applied, and nothing reads it.
           `essential` is Horde's own (extensions.horde_studio.essential on the
           entry): the app-author's way of saying "this must survive the
           budget". Import caps content at the same length the editor does, so a
           book cannot grow the prompt past what this screen will let you type. */
        var hx = (e.extensions && e.extensions.horde_studio) || {};
        /* These are mirrored as the card wrote them, not as the app reads them: a
           card that says `selective: "true"` keeps that string in the live entry,
           so an export cannot rewrite the author's bytes, while the matcher -
           which requires `=== true` - ignores it and the Lore screen calls the
           entry malformed. Same reasoning for `position` (a free string in V2,
           where only `after_char` means after) and for the two numbers. */
        var out = { id: UI.uid('l'), keys: e.keys || [], content: e.content || '',
          enabled: e.enabled !== false, stage: e.stage || '',
          constant: e.constant === true,
          selective: e.selective,
          secondaryKeys: Array.isArray(e.secondary_keys) ? e.secondary_keys.slice() : [],
          caseSensitive: e.case_sensitive,
          /* `use_regex` is V3's, and it is mirrored as the card wrote it: the matcher
             requires the boolean `true`, so a card carrying "true" keeps that string
             in the live entry, survives an export byte for byte, and the Lore screen
             calls the entry what it is rather than guessing. */
          useRegex: e.use_regex,
          position: e.position === undefined ? '' : String(e.position),
          insertionOrder: e.insertion_order === undefined ? null : e.insertion_order,
          priority: e.priority === undefined ? null : e.priority,
          essential: hx.essential === true || e.essential === true };
        if (e.selectiveLogic !== undefined) out.selectiveLogic = e.selectiveLogic;
        return out;
      }) : [];
    },

    /* "+10 intros" cards: the extra first messages ride in
       alternate_greetings (V2/V3 data, legacy top level). Trimmed, deduped,
       and any entry that just restates first_mes is not carried twice. */
    altGreetingsFromCard: function (card, data) {
      var first = (((data && data.first_mes) || (card.data && card.data.first_mes) || card.first_mes) || '').trim();
      var raw = (data && data.alternate_greetings)
        || (card.data && card.data.alternate_greetings)
        || card.alternate_greetings;
      var out = [];
      if (!Array.isArray(raw)) return out;
      raw.forEach(function (g) {
        g = (g == null ? '' : String(g)).trim();
        if (g && g !== first && out.indexOf(g) === -1) out.push(g);
      });
      return out;
    },

    expressionPortraitsFromCard: function (data, card) {
      var extensions = (data && data.extensions) || (card && card.extensions) || {};
      var horde = extensions.horde_studio || extensions.hordeStudio || {};
      var list = horde.expression_portraits || horde.expressionPortraits;
      if (!Array.isArray(list)) return [];
      return list.filter(function (e) { return e && typeof e === 'object'; }).map(function (e) {
        return { id: UI.uid('expr'), label: String(e.label || ''),
          keys: Array.isArray(e.keys) ? e.keys.map(String).slice(0, 20) : [],
          src: String(e.src || '').slice(0, 12000000) };
      }).filter(function (e) { return e.src && (e.label || e.keys.length); }).slice(0, 12);
    },

    /* A card's fields, top level and `data` merged with `data` winning.
       The card object itself must not survive in the result: `card.data`
       would come along as a `data` property and the image scanner would walk
       it again, importing every picture twice under a "data_" name. */
    mergeCardData: function (card) {
      var out = Object.assign({}, card, card.data);
      delete out.data;
      return out;
    },

    /* ---------------- non-destructive round trip (v1.39.113) -------------
       A card carries far more than this app models: client-specific
       extensions, lorebook properties the matcher has no use for, V3 fields
       with no Horde equivalent. Until now those died at the border, so a card
       that had merely been opened in the APK came back out diminished, and a
       re-import of that export made the loss permanent. Import notes tell the
       user about it, but a warning does not restore anything.

       `cardSource` is the restore: a plain-JSON copy of what the file actually
       said - both the top level and under `data`, because other tools read
       either - plus the book's own properties and one raw record per lorebook
       entry. Export overlays this app's live values onto it, so a field the
       user never touched survives with its value AND its type, and a field
       they edited is written in both places at once.

       It is data, never behaviour. Nothing here is read when a prompt is
       built, no preserved field becomes a macro target or a style
       instruction, and nothing in it is shown as the card's sheet. Preserved,
       not used - the distinction the import notes make in words.
       ------------------------------------------------------------------ */
    SOURCE_CAP: 2 * 1024 * 1024,        /* JSON bytes; a bigger source is not kept */

    /* Clone a value for the preserved copy: JSON-safe, and with base64 picture
       payloads left out. A data: URL is a whole image inside a string, and the
       app already carries those as the avatar and the picture gallery (see
       cardAvatar / cardImages), so keeping them again would double several
       megabytes per card for nothing. Each path left out is recorded so export
       can put the app's own copy back and report what it cannot. */
    /* Two bounds on the SHAPE of the preserved copy, and both are reported rather
       than silently trimmed. 200 levels is far past anything a card tool has ever
       written; the number exists so a broken or hostile file cannot use recursion
       to exhaust the app's stack, and 60 000 values is the same idea for breadth.
       Anything past either one is left out of the copy and its path recorded, so
       the import says so and the export names it — the reviewer's phrase for the
       old behaviour was "silently discarded", and silently was the problem. */
    SRC_DEPTH: 200,
    SRC_NODES: 60000,
    _srcClone: function (v, path, acc, depth) {
      function leave(why) {
        if (!acc.gaps) acc.gaps = [];
        if (acc.gaps.length < 8) acc.gaps.push((path || '(root)') + ' — ' + why);
        else acc.gapsMore = (acc.gapsMore || 0) + 1;
      }
      if (typeof v === 'string') {
        if (/^data:[^,]*base64,/i.test(v) || /^data:image\//i.test(v)) {
          if (acc.imgs.indexOf(path) === -1) acc.imgs.push(path);
          return undefined;
        }
        return v;
      }
      if (v === null || typeof v !== 'object') {
        if (v === undefined || typeof v === 'function') return undefined;
        return v;
      }
      if (depth > Store.SRC_DEPTH) { leave('nested past ' + Store.SRC_DEPTH + ' levels'); return undefined; }
      acc.nodes = (acc.nodes || 0) + 1;
      if (acc.nodes > Store.SRC_NODES) { leave('past ' + Store.SRC_NODES + ' values'); return undefined; }
      if (Array.isArray(v)) {
        var arr = [];
        for (var i = 0; i < v.length; i++) {
          var item = Store._srcClone(v[i], path + '[' + i + ']', acc, depth + 1);
          arr.push(item === undefined ? null : item);
        }
        return arr;
      }
      var o = {};
      Object.keys(v).forEach(function (k) {
        var val = Store._srcClone(v[k], path ? path + '.' + k : k, acc, depth + 1);
        if (val !== undefined) o[k] = val;
      });
      return o;
    },

    /* Canonical JSON with sorted keys, so "did the user change this field?"
       does not depend on key order or on a field arriving as 5 vs "5" -
       types are compared too, which is the point of preserving them. */
    _canon: function (v) {
      if (v === null || typeof v !== 'object') return JSON.stringify(v === undefined ? null : v);
      if (Array.isArray(v)) return '[' + v.map(Store._canon).join(',') + ']';
      return '{' + Object.keys(v).sort().map(function (k) {
        return JSON.stringify(k) + ':' + Store._canon(v[k]);
      }).join(',') + '}';
    },
    _sameVal: function (a, b) { return Store._canon(a) === Store._canon(b); },

    /* The copy of the source worth keeping. `data` wins over the top level,
       which is the rule cardToCharacter already imports by, so the two views
       of one card can never disagree about what the card said. */
    cardSourceFor: function (card, data, lore) {
      var src = card || {};
      var acc = { imgs: [], nodes: 0 };
      var top = {}, body = {};
      Object.keys(src).forEach(function (k) {
        if (k === 'data' || k === 'spec' || k === 'spec_version' ||
            /* `__png` is what this app noticed about the file it read, not part of
               the card: letting it ride into the preserved copy would export a
               note as if the author had written it. */
            k === 'cardSource' || k === 'importNotes' || k === '__png') return;
        if (k === 'character_book') return;                 /* kept apart, see below */
        var v = Store._srcClone(src[k], k, acc, 0);
        if (v !== undefined) top[k] = v;
      });
      if (src.data && typeof src.data === 'object' && !Array.isArray(src.data)) {
        Object.keys(src.data).forEach(function (k) {
          if (k === 'character_book') return;
          var v = Store._srcClone(src.data[k], 'data.' + k, acc, 0);
          if (v !== undefined) body[k] = v;
        });
      }
      var s = { top: top, body: body, imgs: acc.imgs };
      if (typeof src.spec === 'string') s.spec = src.spec;
      if (typeof src.spec_version === 'string') s.spec_version = src.spec_version;

      var book = (data && data.character_book) ||
        (src.data && src.data.character_book) || src.character_book || null;
      if (book && typeof book === 'object' && !Array.isArray(book)) {
        var meta = {};
        Object.keys(book).forEach(function (k) {
          if (k === 'entries') return;
          var v = Store._srcClone(book[k], 'book.' + k, acc, 0);
          if (v !== undefined) meta[k] = v;
        });
        s.book = meta;
        /* Book-level settings this app ignores (token_budget, recursion_depth,
           scan_depth...) are still the author's, so they ride back out. Where
           the book lived matters as much as what it held: a V1 card hangs it
           off the top level, a V2 card puts it in data. */
        s.bookAt = {
          top: !!(src.character_book && typeof src.character_book === 'object'),
          data: !!(src.data && src.data.character_book)
        };
        var ents = book.entries;
        if (Array.isArray(ents)) {
          /* Keyed by the id this app minted for each entry, never by position:
             entries get reordered, deleted and added in the editor, and a raw
             record attached to array index would follow the index rather than
             the entry. Ids the source itself uses are irrelevant here, so
             duplicate or missing source ids cannot collide. */
          s.lore = [];
          ents.forEach(function (e, i) {
            if (!e || typeof e !== 'object' || !lore || !lore[i]) return;
            var raw = Store._srcClone(e, 'book.entries[' + i + ']', acc, 0);
            if (raw) s.lore.push({ uid: lore[i].id, raw: raw });
          });
        }
      }
      if (acc.gaps && acc.gaps.length) {
        /* the copy is kept — it is still worth more than nothing — but it is
           marked incomplete so the import and the export can say which parts of
           the card this app cannot carry back */
        s.gaps = acc.gaps.slice();
        if (acc.gapsMore) s.gapsMore = acc.gapsMore;
      }
      var text;
      try { text = JSON.stringify(s); } catch (err) { return null; }
      if (text.length > Store.SOURCE_CAP) return null;
      s.bytes = text.length;
      return s;
    },

    /* The parts of a card's own JSON this app could not keep a copy of, as
       `path — reason` lines. Empty for the ordinary card. */
    /* What the card file says about itself. V3 added three fields for exactly
       this — `creation_date`, `modification_date`, `creator_notes` (with
       `creator_notes_multilingual`) — and this app already keeps them, inside
       `cardSource`, preserved and never read. Reading them for a screen is a
       different permission from reading them for a prompt: nothing returned here
       reaches a model, a macro, or the card's own text, and the wording the user
       sees is the card's claim, not a fact the app verified.
         * the dates are Unix seconds in UTC, per SPEC_V3; `0` is a deliberate
           "unknown", so it is reported as that and not as 1970.
         * a note in the user's language wins over the plain field, and the plain
           field wins when the multilingual object has no English key — the
           branch order the spec spells out.
         * a value that is not what the spec allows is named, not discarded. */
    cardDeclared: function (c) {
      var src = c && c.cardSource;
      if (!src) return null;
      function pick(k) {
        var v = src.body ? src.body[k] : undefined;
        if (v === undefined || v === null) v = src.top ? src.top[k] : undefined;
        return (v === undefined || v === null) ? null : v;
      }
      var out = { created: '', modified: '', notes: '', noteFrom: '', noteLanguages: [], odd: [] };

      function stamp(key) {
        var v = pick(key);
        if (v === null) return '';
        if (typeof v !== 'number' && !(typeof v === 'string' && /^\d+$/.test(v.trim()))) {
          out.odd.push(key + ' is not a number');
          return '';
        }
        var n = Number(v);
        if (n === 0) return 'unknown (left that way on purpose)';
        if (n > 1e11) { out.odd.push(key + ' is in milliseconds, not the seconds the spec asks for'); n = Math.floor(n / 1000); }
        var d = new Date(n * 1000);
        if (isNaN(d.getTime())) { out.odd.push(key + ' is not a date this app can read'); return ''; }
        return d.toLocaleString();
      }
      out.created = stamp('creation_date');
      out.modified = stamp('modification_date');

      var ml = pick('creator_notes_multilingual');
      var plain = pick('creator_notes');
      if (ml && typeof ml === 'object' && !Array.isArray(ml)) {
        var langs = Object.keys(ml).filter(function (k) { return typeof ml[k] === 'string' && ml[k].trim(); });
        if (langs.length) out.noteLanguages = langs.slice(0, 8);
        if (typeof ml.en === 'string' && ml.en.trim()) { out.notes = ml.en; out.noteFrom = 'the English copy'; }
        else if (typeof plain === 'string' && plain.trim()) {
          out.notes = plain;
          out.noteFrom = langs.length ? 'the plain field, which the spec reads as English when the translated copies do not include it' : 'the plain field';
        }
      } else if (typeof plain === 'string' && plain.trim()) {
        out.notes = plain; out.noteFrom = 'the plain field';
      } else if (plain !== null && typeof plain !== 'string') {
        out.odd.push('creator_notes is not a string');
      }
      /* one line, control characters gone, clipped: this is a file's text being
         put on a screen, and a 40 KB note is not a note. */
      out.notes = String(out.notes || '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 700);
      if (!out.created && !out.modified && !out.notes && !out.odd.length) return null;
      return out;
    },

    cardSourceGaps: function (c) {
      var s = c && c.cardSource;
      if (!s) return [];
      /* The raw path is a thousand segments long when the thing that did not fit
         is a thousand segments deep, and a note nobody can read says nothing. So
         collapse a repeated tail into a count, which is the part that actually
         matters, and keep the head of the path where the reader can find it. */
      function readable(line) {
        var at = line.indexOf(' — ');
        var path = at === -1 ? line : line.slice(0, at);
        var why = at === -1 ? '' : line.slice(at);
        var parts = String(path).split('.');
        var last = parts[parts.length - 1];
        var run = 0;
        for (var i = parts.length - 1; i >= 0 && parts[i] === last; i--) run++;
        if (run > 3) parts = parts.slice(0, parts.length - run).concat([last + ' ×' + run]);
        var p = parts.join('.');
        if (p.length > 110) p = p.slice(0, 64) + '…' + p.slice(-40);
        return p + why;
      }
      var out = (s.gaps || []).map(readable);
      if (s.gapsMore) out.push('and ' + s.gapsMore + ' more');
      return out;
    },

    /* Resolve a recorded path like `data.extensions.bg` or
       `book.entries[2].content` against the exported card, to find out whether
       a picture the app stripped came back. */
    _resolve: function (root, path) {
      var parts = String(path).replace(/\[(\d+)\]/g, '.$1').split('.');
      var v = root;
      for (var i = 0; i < parts.length && v != null; i++) v = v[parts[i]];
      return v;
    },

    /* Where each picture the card carried should go on the way out, and which
       ones this app has nothing to put back. It knows two kinds of image - the
       avatar and the gallery - and the gallery remembers the key the card used
       (`image_2` stays `image_2`), so the file comes back shaped like itself
       instead of renumbered. Anything else that was a picture: a background, an
       image inside a lorebook entry - was never imported, and the export
       reports it rather than claiming a lossless conversion. */
    imageRestorePlan: function (c) {
      var s = (c && c.cardSource) || {};
      var byName = {};
      ((c && c.images) || []).forEach(function (im) {
        if (im && im.name && im.src) byName[String(im.name)] = im.src;
      });
      var targets = [], lost = [];
      (s.imgs || []).forEach(function (p) {
        var leaf = String(p).split('.').pop();
        var src = leaf === 'char_x' ? ((c && c.avatar) || null)
          : (/^image_\d+$/.test(leaf) ? (byName[leaf] || null) : null);
        /* a nested picture key (extensions.art, an entry's image) has no place
           in this app's model, so it cannot be filled from anywhere */
        if (!src || /[.\[]/.test(String(p).slice(0, String(p).length - leaf.length).replace(/^data\.$/, ''))) {
          lost.push(p);
          return;
        }
        targets.push({ path: p, inBody: /^data\./.test(p), leaf: leaf, src: src });
      });
      return { targets: targets, lost: lost };
    },

    /* The pictures an export could not put back, for the caller to warn about. */
    cardUnrestoredImages: function (c, card) {
      var s = c && c.cardSource;
      if (!s || !s.imgs || !s.imgs.length) return [];
      var plan = Store.imageRestorePlan(c);
      /* only a loss if nothing in the export carries that picture after all */
      return plan.lost.filter(function (p) {
        var v = Store._resolve(card, p);
        return !(typeof v === 'string' && v.length);
      });
    },

    cardToCharacter: function (card) {
      var data = card;
      /* v1.39.16: a V2 card MAY keep its fields only under data (the spec
         asks for both top level and data; plenty of tools write just data).
         Merge with data winning so either packing imports whole. */
      if ((card.spec === 'chara_card_v2' || card.spec === 'chara_card_v3') && card.data) {
        data = Store.mergeCardData(card);
      }
      if (card.spec === 'chara_card_v3' && card.data) {
        /* K4 (v1.39.76): the V3 branch reads `data` alone, so a V3 card whose
           fields sit at the TOP level (no `data`, or a `data` holding only the
           name) imported as an empty character with no warning. Merge the two
           with `data` winning — the same rule the V2 branch has always used,
           and what the spec's own "prefer data" wording amounts to. A card
           that was already correct reads identically: every field it uses
           comes from `data`. */
        data = Store.mergeCardData(card);
        var slist = Store.scenarioList(data);
        var main = (data.scenario || '').trim();
        /* A1 (v1.39.69): the scenario is NOT folded in. It used to be, back
           when `scenario` was imported as '' — v1.11.0 started using the field
           separately and left the fold behind, so a V3 card paid for its
           scenario twice on every turn (once here, once as
           "Current situation:"). The V2 branch never folded, which is the
           proof it is not needed. */
        var desc = [data.description || '', data.personality || ''].filter(Boolean).join('\n\n');
        var v3book = Store.bookFromCard(card, data);
        var lim = Store.bookLimitsOf(card, data);
        var ch = Store.hordeCardChoices(data, card);
        return {
          id: UI.uid('c'), name: data.name || 'Imported character',
          tagline: (data.tags || []).slice(0, 3).join(', '), avatar: Store.cardAvatar(data.char_x),
          images: Store.cardImages(data, Store.cardAvatar(data.char_x)),
          /* the normalizer guarantees the declared default is in the list
             (appended if the card forgot it), so it is always a valid pick */
          persona: desc, scenario: main ? main : (slist[0] || ''),
          scenarioList: slist,
          greeting: data.first_mes || '',
          /* v1.39.16: the author's always-remember line used to die at the
             border — every card that carried one imported silent */
          examples: data.mes_example || '', postHistory: String(data.post_history_instructions || ''),
          /* v1.40.0: the card's own system prompt and Horde's authoring fields come in
             now. Both placement choices start at this app's long-standing behaviour:
             post-history text joins the sheet, and the global prompt stays in charge. */
          cardSystemPrompt: Store.cardSystemPromptOf(data),
          /* v1.41.0 (review issue 1): the ask and the decision are two different
             fields. `systemPromptAsked` is the card's request, kept to show and to
             export back; `systemPromptSource` stays empty until a person chooses —
             or until they have switched the global preference on for their own
             cards, which is the one path the preference was always meant to have. */
          postHistoryPlacement: ch.postHistoryPlacement,
          systemPromptAsked: ch.systemPromptAsked, systemPromptSource: '',
          cardAsked: ch.asked,
          /* the card's two persona fields, kept apart so they can be edited apart
             (review request 4). `persona` stays the combined string the prompt
             reads, so nothing downstream changes. */
          descText: String(data.description || ''), persText: String(data.personality || ''),
          personaSplit: false,
          directives: ch.directives,
          loreCompat: ch.compat, loreScanTurns: ch.scan,
          loreBookScan: lim.scan, loreBookBudget: lim.budget,
          tags: data.tags || [], systemPrompt: '', temperature: null, maxTokens: null,
          lorebook: v3book,
          cardSource: Store.cardSourceFor(card, data, v3book),
          /* A2 (v1.39.70): the V3 branch never set this, so a V3 card's
             expression portraits imported as undefined and re-exported
             without them — a round trip through the app deleted them. */
          expressionPortraits: Store.expressionPortraitsFromCard(data, card),
          alternateGreetings: Store.altGreetingsFromCard(card, data),
          createdAt: Date.now(), updatedAt: Date.now()
        };
      }
      var list2 = Store.scenarioList(data);
      var v12book = Store.bookFromCard(card, data);
      var lim = Store.bookLimitsOf(card, data);
      var ch = Store.hordeCardChoices(data, card);
      return {
        id: UI.uid('c'), name: data.name || 'Imported character',
        tagline: (data.tags || []).slice(0, 3).join(', '), avatar: Store.cardAvatar(data.char_x),
        images: Store.cardImages(data, Store.cardAvatar(data.char_x)),
        persona: [data.description || '', data.personality || ''].filter(Boolean).join('\n\n'),
        scenario: (data.scenario || '').trim() || (list2[0] || ''),
        scenarioList: list2,
        greeting: data.first_mes || '',
        examples: data.mes_example || '', postHistory: String(data.post_history_instructions || ''),
        /* v1.40.0: the card's own system prompt and Horde's authoring fields come in
           now. Both placement choices start at this app's long-standing behaviour:
           post-history text joins the sheet, and the global prompt stays in charge. */
        cardSystemPrompt: Store.cardSystemPromptOf(data),
        /* v1.41.0 (review issue 1): the ask and the decision are two different
           fields. `systemPromptAsked` is the card's request, kept to show and to
           export back; `systemPromptSource` stays empty until a person chooses —
           or until they have switched the global preference on for their own
           cards, which is the one path the preference was always meant to have. */
        postHistoryPlacement: ch.postHistoryPlacement,
        systemPromptAsked: ch.systemPromptAsked, systemPromptSource: '',
        cardAsked: ch.asked,
        /* the card's two persona fields, kept apart so they can be edited apart
           (review request 4). `persona` stays the combined string the prompt
           reads, so nothing downstream changes. */
        descText: String(data.description || ''), persText: String(data.personality || ''),
        personaSplit: false,
        directives: ch.directives,
        loreCompat: ch.compat, loreScanTurns: ch.scan,
        loreBookScan: lim.scan, loreBookBudget: lim.budget,
        tags: data.tags || [], systemPrompt: '', temperature: null, maxTokens: null,
        /* V2 cards with an embedded book were losing it entirely here */
        lorebook: v12book,
        cardSource: Store.cardSourceFor(card, data, v12book),
        expressionPortraits: Store.expressionPortraitsFromCard(data, card),
        alternateGreetings: Store.altGreetingsFromCard(card, data),
        createdAt: Date.now(), updatedAt: Date.now()
      };
    },

    /* H1 (v1.39.69): before that fix, every V3 import baked the scenario into
       the persona, and the exporter wrote that persona into `description`
       while ALSO writing `scenario` — so the duplication became permanent and
       survived re-import. Strip a scenario that duplicates the scenario field
       exactly, as a trailing block.

       Deliberately narrow: an exact trailing match only, never a fuzzy or
       shape-based strip, so a persona that merely mentions the scenario keeps
       its text. Nothing is lost either way, because the scenario is written to
       its own field in the same export. */
    stripDuplicateScenario: function (persona, scenario) {
      var p = String(persona == null ? '' : persona);
      var sc = String(scenario == null ? '' : scenario).trim();
      if (!p || !sc) return p;
      var tail = p.replace(/\s+$/, '');
      if (tail === sc) return '';                       /* pure duplicate */
      if (tail.length > sc.length + 2 &&
          tail.slice(-sc.length) === sc &&
          /\n\n$/.test(tail.slice(0, tail.length - sc.length))) {
        return tail.slice(0, tail.length - sc.length).replace(/\s+$/, '');
      }
      return p;
    },

    /* Export is the source with this app's edits laid over it, not a fresh
       card rebuilt from the handful of fields the app models.

       "Unedited" cannot mean "equal to the raw field", because import does not
       copy fields verbatim: it runs card text through plainText, joins
       description and personality into one persona string, falls back to the
       first scenario in the list, and trims duplicate greetings. So the test
       re-runs that derivation over the preserved source and compares. Equal
       means the user never touched it - the field goes back out as the card
       wrote it, type and all, and description and personality stay separate.
       Different means they edited it here, and the new value is written into
       both representations so no other reader finds a stale duplicate of the
       old one. */
    characterToCard: function (c) {
      var bare = Store.characterToCardBare(c);
      var s = c && c.cardSource;
      if (!s) return bare;                        /* imported before v1.39.113 */

      var top = JSON.parse(JSON.stringify(s.top || {}));
      var body = JSON.parse(JSON.stringify(s.body || {}));
      /* Derive from the same merged view the import used, not from `data`
         alone: a V1 card has no `data` at all, and some tools write a V2 card's
         fields only at the top level. Deriving from `body` there would read an
         empty card, call every field "edited", and write the sanitized copy
         over the author's text - the exact damage this whole block exists to
         stop. */
      var merged = {};
      Object.keys(top).forEach(function (k) { merged[k] = top[k]; });
      Object.keys(body).forEach(function (k) { merged[k] = body[k]; });


      function clean(v) {
        var t = String(v == null ? '' : v);
        return (typeof API !== 'undefined' && API && API.plainText) ? API.plainText(t) : t;
      }
      /* put both copies of a field: the V2 spec asks for the fields in data,
         top level too, and tools read either one */
      function put(k, v) { top[k] = v; body[k] = v; }
      /* write only when the live value is not what import would have made from
         the source - the whole of the non-destructive rule in one line */
      function keepOrWrite(key, live, derived) {
        if (Store._sameVal(live, derived)) {
          /* untouched: the author's own value, copied into both places. The V2
             spec asks for the character fields in `data` AND at the top level,
             and this app has written both since v1.39.73 because other tools
             read only one of the two - so the copy goes wherever a reader looks,
             while the text itself stays exactly as the card had it. */
          if (merged[key] !== undefined) put(key, JSON.parse(JSON.stringify(merged[key])));
          return;
        }
        put(key, live);
      }

      /* The persona, three cases: edited as the card's own two fields, unchanged,
         or edited as one box. See `characterToCardBare` for the same three. */
      var personaSplit = Store.personaSplitOn(c);
      var scList = (typeof Store.scenarioList === 'function') ? (Store.scenarioList(merged) || []) : [];
      var scMain = String(merged.scenario || '').trim();
      var alt = Store.altGreetingsFromCard(merged, merged);

      keepOrWrite('name', c.name, merged.name || 'Imported character');
      var personaSaid = clean([merged.description || '', merged.personality || '']
        .filter(Boolean).join('\n\n'));
      if (personaSplit) {
        /* Each half is compared with the card's own half, so editing the
           description leaves the personality exactly as the author wrote it and
           the other way round — the thing review request 4 asked for. A half that
           still matches is copied out verbatim rather than re-written. */
        ['description', 'personality'].forEach(function (k) {
          /* No `stripDuplicateScenario` here, unlike the merged path below (and
             unlike v1.41.0, which ran it and so deleted a card's description on
             the spot for merely repeating the scenario line — review finding C).
             That rule exists because ONE persona string that recites the scenario
             puts it in the sheet twice; it is a fix for a shape this mode does not
             have. Here the description is the card's own field, edited as itself:
             a field the player never typed in must come back out as it went in,
             and one they did must go out exactly as they wrote it, because the
             app is not the authority on what their prose needs to say twice. */
          var live = clean(String(c[k === 'description' ? 'descText' : 'persText'] == null ? ''
            : c[k === 'description' ? 'descText' : 'persText']));
          var said = merged[k];
          if (Store._sameVal(live, clean(String(said == null ? '' : said)))) {
            if (said !== undefined) put(k, JSON.parse(JSON.stringify(said)));
            return;
          }
          put(k, live);
        });
      } else if (Store._sameVal(c.persona, personaSaid)) {
        /* the two fields stay two fields - a card that keeps its personality
           separately keeps it separately through an edit of nothing at all */
        if (merged.description !== undefined) put('description', JSON.parse(JSON.stringify(merged.description)));
        if (merged.personality !== undefined) put('personality', JSON.parse(JSON.stringify(merged.personality)));
      } else {
        /* the persona box holds both fields, so an edit cannot be split back in
           two: the merged text goes into description and personality is
           emptied rather than left holding the old half - that is how the app
           has always exported, and it is the only honest option here. The old
           text is not lost: it was inside the string being edited. */
        put('description', bare.description);
        put('personality', '');
      }
      keepOrWrite('scenario', c.scenario, clean(scMain ? scMain : (scList[0] || '')));
      keepOrWrite('first_mes', c.greeting, clean(merged.first_mes || ''));
      keepOrWrite('mes_example', c.examples, clean(merged.mes_example || ''));
      keepOrWrite('post_history_instructions', c.postHistory || '',
        clean(String(merged.post_history_instructions || '')));
      /* v1.40.0 (item 3): the card's prompt is kept as the card wrote it. The
         app's own copy is the trimmed string the import produced, so an
         untouched character compares equal and the author's bytes go back out;
         only a real edit rewrites the field. Derived the way cardToCharacter
         derives it - no clean() here, or a card whose text plainText would alter
         would look "edited" on every export. */
      keepOrWrite('system_prompt', c.cardSystemPrompt || '',
        Store.cardSystemPromptOf(merged));
      keepOrWrite('alternate_greetings', c.alternateGreetings || [],
        alt.map(function (g) { return clean(g); }));
      keepOrWrite('tags', c.tags || [], merged.tags || []);
      keepOrWrite('scenario_list', c.scenarioList || [], scList);
      /* fields the app shows but does not own: keep the author's, add ours only
         where the card had nothing, so an export is never missing a V2 staple */
      ['creatorcomment', 'talkativeness', 'fav'].forEach(function (k) {
        if (merged[k] === undefined) { top[k] = bare[k]; body[k] = bare[k]; }
      });

      /* pictures: the data URLs were left out of the copy, so the app's own
         copies go back onto the keys the card used. What the app carries that
         the card had no key for keeps the bare export's numbering. */
      var plan = Store.imageRestorePlan(c);
      var namedChar = plan.targets.filter(function (t) { return t.leaf === 'char_x'; });
      if (bare.char_x && !namedChar.length) top.char_x = bare.char_x;
      Object.keys(bare.data || {}).forEach(function (k) {
        if (/^image_\d+$/.test(k) && !plan.targets.some(function (t) { return t.leaf === k; })) {
          body[k] = bare.data[k];
        }
      });
      plan.targets.forEach(function (t) {
        (t.inBody ? body : top)[t.leaf] = t.src;
        /* V2 puts char_x at the top level; a card that kept it in data gets it
           in both, so neither reader finds a different answer */
        if (t.leaf === 'char_x') {
          if (t.inBody) top.char_x = t.src; else body.char_x = t.src;
        }
      });

      /* extensions are somebody else's namespace: preserve every key the card
         had and replace only our own, so another client's settings survive a
         round trip through here untouched */
      var srcExt = (body.extensions && typeof body.extensions === 'object') ? body.extensions
        : ((top.extensions && typeof top.extensions === 'object') ? top.extensions : null);
      var liveExt = (bare.data && bare.data.extensions) || null;
      if (srcExt || liveExt) {
        var ext = JSON.parse(JSON.stringify(srcExt || {}));
        var horde = (ext.horde_studio && typeof ext.horde_studio === 'object') ? ext.horde_studio : {};
        if (liveExt && liveExt.horde_studio) {
          Object.keys(liveExt.horde_studio).forEach(function (k) { horde[k] = liveExt.horde_studio[k]; });
        } else if (horde.expression_portraits) {
          horde.expression_portraits = [];      /* every portrait was deleted here */
        }
        ext.horde_studio = horde;
        body.extensions = JSON.parse(JSON.stringify(ext));
        /* extensions are not a spec-duplicated field: only mirror the copy
           upward if the card kept its extensions at the top level too.
           Inventing a second one would be this app adding a field. */
        if (top.extensions && typeof top.extensions === 'object') {
          top.extensions = JSON.parse(JSON.stringify(ext));
        }
      }

      /* the book: entry properties are matched by our own per-entry id, never
         by position, so edits, deletions, additions and reordering all attach
         the unknown properties to the entry they belong to */
      var rawByUid = {};
      (s.lore || []).forEach(function (rec) {
        if (rec && rec.uid && rec.raw) rawByUid[rec.uid] = rec.raw;
      });
      var entries = (c.lorebook || []).map(function (e) {
        var had = !!rawByUid[e.id];
        var r = had ? JSON.parse(JSON.stringify(rawByUid[e.id])) : {};
        var same = {
          keys: [e.keys || [], r.keys || []],
          content: [e.content || '', clean(r.content || '')],
          enabled: [e.enabled !== false, r.enabled !== false],
          stage: [e.stage || '', r.stage || ''],
          constant: [e.constant === true, r.constant === true],
          /* v1.40.0: the matcher honours these now, so an entry authored HERE has
             to carry them out too. The live value is the card's own (bookFromCard
             mirrors it), so an untouched entry compares equal and the author's
             bytes - including a value this app would not have written - survive
             verbatim. */
          selective: [e.selective, r.selective],
          secondary_keys: [e.secondaryKeys || [], r.secondary_keys || []],
          case_sensitive: [e.caseSensitive, r.case_sensitive],
          use_regex: [e.useRegex, r.use_regex],
          position: [e.position || '', r.position || ''],
          insertion_order: [e.insertionOrder, r.insertion_order],
          priority: [e.priority, r.priority]
        };
        /* For these, absence IS the default: never written into an entry the card
           did not have, so importing a plain V1 book and exporting it does not
           turn every entry into a declared one. */
        var UNSET_OK = { constant: 1, selective: 1, case_sensitive: 1, use_regex: 1, position: 1,
          insertion_order: 1, priority: 1 };
        function isNothing(v) {
          return v === false || v === null || v === undefined || v === '' ||
            (Array.isArray(v) && !v.length);
        }
        Object.keys(same).forEach(function (k) {
          if (had && Store._sameVal(same[k][0], same[k][1])) return;
          if (!had && UNSET_OK[k] && isNothing(same[k][0])) return;   /* do not invent one */
          if (same[k][0] === undefined) { delete r[k]; return; }
          r[k] = same[k][0];
        });
        /* `essential` is Horde's flag, not a spec field: it goes in the entry's
           own extensions namespace, where a client that does not know it leaves
           it alone and an export carries it back. */
        if (e.essential === true) {
          r.extensions = Object.assign({}, r.extensions || {}, {
            horde_studio: Object.assign({}, (r.extensions || {}).horde_studio || {}, { essential: true })
          });
        } else if (r.extensions && r.extensions.horde_studio && r.extensions.horde_studio.essential) {
          delete r.extensions.horde_studio.essential;
        }
        return r;
      });
      if (entries.length || s.book || (s.bookAt && s.bookAt.data)) {
        var book = Object.assign({ name: (c.name || 'character') + ' lorebook' }, s.book || {}, { entries: entries });
        body.character_book = book;
        top.character_book = (s.bookAt && s.bookAt.top) ? book : JSON.parse(JSON.stringify(book));
        if (!(s.bookAt && (s.bookAt.top || s.bookAt.data))) delete top.character_book;
      }

      var out = top;
      out.spec = s.spec || 'chara_card_v2';
      out.spec_version = s.spec_version || '2.0';
      out.data = body;
      return out;
    },

    /* The two-field persona is only real when the two fields are there. A record
       that carries the flag without the halves — saved by a build that has since
       changed, or edited by hand in storage — must not export two empty strings
       over the author's text: the merged path, which keeps the text it can see,
       is the safe reading. */
    personaSplitOn: function (c) {
      return !!(c && c.personaSplit === true &&
        (typeof c.descText === 'string' || typeof c.persText === 'string'));
    },

    characterToCardBare: function (c) {
      var split = Store.personaSplitOn(c);
      var card = {
        name: c.name,
        /* the scenario fold belongs to the merged shape only — see the same rule
           in `characterToCard`, and review finding C */
        description: split ? String(c.descText || '')
          : Store.stripDuplicateScenario(c.persona || '', c.scenario || ''),
        personality: split ? String(c.persText || '') : '',
        scenario: c.scenario || '', first_mes: c.greeting || '', mes_example: c.examples || '',
        creatorcomment: 'Exported from Horde Studio Mobile',
        tags: c.tags || [], talkativeness: '0.5', fav: false,
        spec: 'chara_card_v2', spec_version: '2.0', data: { name: c.name }
      };
      /* H2 (v1.39.73): the V2 spec asks for the character fields BOTH at the
         top level and under `data`, and other tools read only one of the two.
         We used to write them top level and leave `data` with nothing but the
         name, so a card exported here looked truncated elsewhere. The values
         are identical, so our own import (which merges with `data` winning)
         reads the same text it always did. `personality` stays empty on
         purpose WHILE THE CHARACTER IS EDITED AS ONE PERSONA STRING: this app
         keeps one string, and copying it into `personality` too would double the
         sheet for any tool that joins the two fields. Edited as the card's two
         fields (v1.41.0, review request 4), each half goes back under its own
         name and neither is doubled. */
      ['description', 'personality', 'scenario', 'first_mes', 'mes_example',
       'creatorcomment', 'tags', 'talkativeness', 'fav'].forEach(function (k) {
        card.data[k] = card[k];
      });
      if (c.scenarioList && c.scenarioList.length) card.scenario_list = c.scenarioList;
      if (c.postHistory) card.data.post_history_instructions = c.postHistory;
      /* v1.40.0: a character holding the card's own prompt writes it back, or a
         round trip through the app drops the field the app can now honour. */
      if (c.cardSystemPrompt) card.data.system_prompt = c.cardSystemPrompt;
      /* the embedded lorebook rides along: exporting used to drop it, so a
         round trip through us silently un-carried the card's world */
      if (c.lorebook && c.lorebook.length) {
        card.data.character_book = {
          name: (c.name || 'character') + ' lorebook',
          entries: c.lorebook.map(function (e) {
            var out = { keys: e.keys || [], content: e.content || '', enabled: e.enabled !== false, stage: e.stage || '' };
            if (e.constant) out.constant = true;
            /* v1.40.0: every field the matcher now reads has to be written by the
               path that has no source copy to fall back on, or an entry authored
               in this app loses its conditions on the way out. */
            if (e.selective === true) out.selective = true;
            if (e.secondaryKeys && e.secondaryKeys.length) out.secondary_keys = e.secondaryKeys.slice();
            if (e.caseSensitive === true) out.case_sensitive = true;
            if (e.position === 'before_char' || e.position === 'after_char') out.position = e.position;
            if (typeof e.insertionOrder === 'number') out.insertion_order = e.insertionOrder;
            if (typeof e.priority === 'number') out.priority = e.priority;
            if (e.essential === true) out.extensions = { horde_studio: { essential: true } };
            return out;
          })
        };
      }
      var horde = Store.hordeCardFields(c);
      if (c.expressionPortraits && c.expressionPortraits.length) {
        horde.expression_portraits = c.expressionPortraits.map(function (e) {
          return { label: e.label || '', keys: e.keys || [], src: e.src || '' };
        });
      }
      if (Object.keys(horde).length) {
        card.data.extensions = Object.assign({}, card.data.extensions || {});
        card.data.extensions.horde_studio = horde;
      }
      /* the intros ride back out too - a card that boasted ten arrivals
         keeps them through an import-export round trip */
      if (c.alternateGreetings && c.alternateGreetings.length) {
        card.data.alternate_greetings = c.alternateGreetings;
      }
      if (c.avatar) card.char_x = c.avatar;
      /* v1.29.0: the card's other pictures ride back out in data, so a
         round trip (export → import) keeps them */
      (c.images || []).forEach(function (im, i) {
        card.data['image_' + (i + 1)] = im.src;
      });
      return card;
    },

    /* Read a character card from a .json or .png file */
    /* Bytes -> data URL, chunked so a big card art never blows the call
       stack the way String.fromCharCode.apply on the whole buffer would. */
    bytesToDataUrl: function (buf, mime) {
      var bytes = new Uint8Array(buf);
      var bin = '';
      var CHUNK = 0x8000;
      for (var i = 0; i < bytes.length; i += CHUNK) {
        bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
      }
      return 'data:' + (mime || 'application/octet-stream') + ';base64,' + btoa(bin);
    },

    /* ---- PNG card containers (K1-K3, v1.39.76) ---------------------------
       A card PNG carries its JSON in a text chunk. Four things are legal and
       all four appear in the wild:

         tEXt      keyword \0 text
         zTXt      keyword \0 method(1) zlib(text)
         iTXt      keyword \0 flag(1) method(1) lang \0 translated \0 text
         (iTXt with flag = 1 compresses that text)

       and the card itself is base64 in `chara` (V2) or `ccv3` (V3) — the V3
       spec says `ccv3` is base64 UTF-8 JSON, and says an application should
       prefer it when both are present. This reader used to: parse every chunk
       as plain text, parse `ccv3` as raw JSON (never decoding it), take the
       first chunk in file order, and give up on anything compressed. It now
       does the opposite of all four. */

    /* zlib inflate for a compressed chunk. The browser primitive is not
       present in very old WebViews, so its absence is reported as a fact
       rather than crashing the import. */
    inflateBytes: function (bytes) {
      if (typeof global.DecompressionStream !== 'function' || typeof global.Response !== 'function') {
        return Promise.reject(new Error('This card\'s text is compressed, and this Android WebView is too old to unpack it. Update Android System WebView (Play Store) — or import the .json version of the card.'));
      }
      try {
        var stream = new Blob([bytes]).stream()
          .pipeThrough(new global.DecompressionStream('deflate'));
        return new global.Response(stream).arrayBuffer().then(function (b) {
          return new Uint8Array(b);
        });
      } catch (e) {
        return Promise.reject(new Error('This card\'s text is compressed and could not be unpacked: ' + (e && e.message)));
      }
    },

    /* One chunk -> { key, text }, or null if it is not a text chunk we know.
       Async only because zTXt/compressed iTXt have to be inflated. */
    pngTextChunk: function (ch) {
      var bytes = new Uint8Array(ch.data);
      var nul = bytes.indexOf(0);
      if (nul < 0) return Promise.resolve(null);
      var key = String.fromCharCode.apply(null, Array.prototype.slice.call(bytes.subarray(0, nul)));
      var rest = bytes.subarray(nul + 1);
      var utf8 = function (b) { return new TextDecoder().decode(b); };

      if (ch.type === 'zTXt') {
        /* keyword \0 method(1) compressed */
        return Store.inflateBytes(rest.subarray(1))
          .then(function (out) { return { key: key, text: utf8(out) }; })
          .catch(function (e) { return Promise.reject(e); });
      }
      if (ch.type === 'iTXt') {
        /* keyword \0 flag(1) method(1) lang \0 translated \0 text */
        var flag = rest[0], p = 2;
        while (p < rest.length && rest[p] !== 0) p++;
        p++;
        while (p < rest.length && rest[p] !== 0) p++;
        p++;
        var body = rest.subarray(p);
        if (flag === 1) {
          return Store.inflateBytes(body)
            .then(function (out) { return { key: key, text: utf8(out) }; })
            .catch(function (e) { return Promise.reject(e); });
        }
        return Promise.resolve({ key: key, text: utf8(body) });
      }
      /* tEXt: the payload is Latin-1 in the spec, but every card writer puts
         UTF-8 JSON there and every reader treats it as UTF-8. Do the same. */
      return Promise.resolve({ key: key, text: utf8(rest) });
    },

    /* v1.42.2: LOOK at a card's own JSON before it is parsed, so the import can
       say what no parser can know afterwards. Two things about real files are
       decided by the reader, not written in the file: a key that appears twice in
       one object (V1: "A mapping in JSON objects with duplicate keys is
       UNDEFINED BEHAVIOR"; JSON.parse keeps the last), and a number the reader
       cannot hold (1e999 arrives as Infinity, a 20-digit integer arrives rounded).
       Neither is a bug here and neither is a reason to refuse a file — so the app
       reads it the way the spec says and hands the user a note.
       This is a scanner, not a parser: it tracks where it is (so the note can name
       a path) and nothing else. It never throws and never claims to have checked
       more than it did. */
    _dec: function (tok) {
      /* a decimal literal as (sign, digits, exponent10), with leading and trailing
         zeros folded out so 1.0, 1e0 and 1 compare equal while 1e999 does not */
      var m = /^([+-]?)(\d+)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/.exec(String(tok));
      if (!m) return null;
      var digits = (m[2] + (m[3] || '')).replace(/^0+/, '');
      var exp = (m[4] ? parseInt(m[4], 10) : 0) - (m[3] ? m[3].length : 0);
      if (!digits.length) return { sign: '', digits: '0', exp: 0 };
      var tz = 0;
      while (digits.length > 1 && digits.charAt(digits.length - 1) === '0') { digits = digits.slice(0, -1); tz++; }
      return { sign: m[1] === '-' ? '-' : '', digits: digits, exp: exp + tz };
    },
    _decEq: function (a, b) {
      var x = Store._dec(a), y = Store._dec(b);
      if (!x || !y) return false;
      return x.sign === y.sign && x.digits === y.digits && x.exp === y.exp;
    },
    jsonAnomalies: function (text) {
      var s = String(text === null || text === undefined ? '' : text);
      var out = { dupKeys: [], numbers: [], numberCount: 0, checked: false, scanned: 0 };
      /* A card's JSON is read on a phone, so the look is bounded: beyond 8 MB the
         import says nothing rather than pretending to have finished. */
      if (s.length > 8 * 1024 * 1024) { out.tooBig = s.length; return out; }
      out.checked = true; out.scanned = s.length;
      var frames = [], pending = null, i = 0;
      function trail() { var f = frames[frames.length - 1]; return f ? f.trail : ''; }
      while (i < s.length) {
        var c = s.charCodeAt(i);
        if (c === 32 || c === 10 || c === 9 || c === 13) { i++; continue; }
        if (c === 123 || c === 91) {                       /* { or [ */
          var p = frames[frames.length - 1];
          var here = !p ? '' : (p.kind === 'a' ? p.trail + '[' + p.index + ']'
            : (pending === null ? p.trail : p.trail + (p.trail ? '.' : '') + pending));
          frames.push({ kind: c === 123 ? 'o' : 'a', trail: here, index: 0, keys: {} });
          pending = null; i++; continue;
        }
        if (c === 125 || c === 93) { frames.pop(); pending = null; i++; continue; }   /* } or ] */
        var fr = frames[frames.length - 1];
        if (c === 44) { if (fr) { if (fr.kind === 'a') fr.index++; fr.expectKey = fr.kind === 'o'; } i++; continue; }
        if (c === 58) { if (fr) fr.expectKey = false; i++; continue; }               /* : */
        if (c === 34) {                                    /* a string */
          var j = i + 1, esc = false;
          while (j < s.length) { var d = s.charAt(j); if (esc) { esc = false; } else if (d === '\\') esc = true; else if (d === '"') break; j++; }
          var raw = s.slice(i + 1, j); i = j + 1;
          var val; try { val = JSON.parse('"' + raw + '"'); } catch (e) { val = raw; }
          var f2 = frames[frames.length - 1];
          if (f2 && f2.kind === 'o' && f2.expectKey !== false) {
            /* the first repeat is recorded, a third copy of the same key only
               raises its count — three is the shape of a hand-edited file, and a
               note that says "twice" when it said it three times is worse than one
               that says nothing */
            f2.keys[val] = (f2.keys[val] || 0) + 1;
            if (f2.keys[val] === 2) {
              var rec = { path: (f2.trail ? f2.trail + '.' : '') + val, key: val, count: 2 };
              f2.dups = f2.dups || {};
              f2.dups[val] = rec;
              out.dupKeys.push(rec);
            } else if (f2.keys[val] > 2 && f2.dups && f2.dups[val]) {
              f2.dups[val].count = f2.keys[val];
            }
            pending = val;
          } else { pending = null; }
          continue;
        }
        var head = s.charAt(i);
        if (head === '-' || (head >= '0' && head <= '9')) {
          var k = i;
          while (k < s.length && /[-+.eE0-9]/.test(s.charAt(k))) k++;
          var tok = s.slice(i, k); i = k;
          out.numberCount++;
          var v2 = Number(tok);
          var written = isFinite(v2) ? String(v2) : (v2 > 0 ? 'Infinity' : (v2 < 0 ? '-Infinity' : 'NaN'));
          if (written !== tok) out.numbers.push({ token: tok, as: written, lossy: !isFinite(v2) || !Store._decEq(tok, written) });
          pending = null;
          continue;
        }
        var m2 = /^(true|false|null)/.exec(s.slice(i));
        if (m2) { i += m2[1].length; pending = null; continue; }
        /* anything else is not JSON this scanner recognises: stop looking rather
           than walk the rest of a file that will not parse anyway */
        break;
      }
      out.lostNumbers = out.numbers.filter(function (n) { return n.lossy; });
      return out;
    },

    /* A chunk's text -> the card object inside it, or null.
       K1: `ccv3` is base64 per the spec — decode it first. Raw JSON is
       accepted after that because it costs nothing and old local fixtures
       were written that way. `chara` is always base64, but a bare JSON
       payload there is accepted for the same reason.
       v1.42.2: an optional `sink` collects the JSON text that was parsed, so the
       PNG reader can run jsonAnomalies over the bytes that actually became the
       card — not over a chunk it threw away. */
    cardFromChunkText: function (key, text, sink) {
      var decodeBase64Json = function (b64) {
        try {
          var bin = atob(String(b64).replace(/\s+/g, ''));
          var bytes = new Uint8Array(bin.length);
          for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i) & 0xff;
          var json = new TextDecoder().decode(bytes);
          if (sink) sink.json = json;
          return JSON.parse(json);
        } catch (e) { return null; }
      };
      var parseRaw = function (t) {
        try {
          var json2 = String(t).replace(/^\uFEFF/, '').trim();
          if (sink) sink.json = json2;
          return JSON.parse(json2);
        } catch (e) { return null; }
      };
      var looksBase64 = /^[A-Za-z0-9+/=\s]+$/.test(String(text).slice(0, 200)) && String(text).trim().length > 8;
      if (key === 'ccv3') {
        /* base64 first (the spec), raw second */
        return (looksBase64 ? decodeBase64Json(text) : null) || parseRaw(text);
      }
      /* chara: SillyTavern has always written base64 here */
      return decodeBase64Json(text) || parseRaw(text);
    },

    /* Pull the embedded card out of PNG bytes. Shared by file import and URL
       import, so both read cards the same way. */
    cardFromPngBytes: function (buf) {
      return new Promise(function (resolve, reject) {
        try {
          var view = new DataView(buf);
          if (view.getUint32(0) !== 0x89504e47) throw new Error('Not a PNG character card');
          var off = 8, chunks = [];
          while (off < view.byteLength) {
            var len = view.getUint32(off);
            var type = '';
            for (var i = 0; i < 4; i++) type += String.fromCharCode(view.getUint8(off + 4 + i));
            if (type === 'tEXt' || type === 'iTXt' || type === 'zTXt') {
              chunks.push({ type: type, data: buf.slice(off + 8, off + 8 + len) });
            }
            off += 12 + len;
            if (type === 'IEND') break;
          }
          if (!chunks.length) throw new Error('No character data embedded in this PNG');

          /* Read every chunk, then choose. K2: `ccv3` wins over `chara`
             regardless of file order — a stale V2 copy in `chara` must not
             shadow the real V3 card. */
          Promise.all(chunks.map(function (ch) {
            return Store.pngTextChunk(ch)
              .then(function (t) {
                /* v1.42.2: a text chunk with no keyword in it is a damaged card,
                   not an absence of one, and a chunk under some other keyword is
                   data this app did not use. Both are counted rather than
                   silently dropped, because both are things the author can act on. */
                if (!t) return { unreadable: '(truncated)' };
                if (t.key !== 'ccv3' && t.key !== 'chara') return { other: t.key };
                var sink = {};
                var card = Store.cardFromChunkText(t.key, t.text, sink);
                if (!card || typeof card !== 'object') return { unreadable: t.key };
                return { key: t.key, type: ch.type, card: card, json: sink.json || '' };
              })
              .catch(function (e) { return { error: e }; });
          })).then(function (found) {
            var usable = found.filter(function (f) { return f && f.card; });
            var pick = -1;
            var card = null;
            for (var k = 0; k < usable.length; k++) {
              if (usable[k].key === 'ccv3') { pick = k; card = usable[k].card; break; }
            }
            if (pick < 0 && usable.length) { pick = 0; card = usable[0].card; }
            if (!card) {
              /* A compressed chunk that could not be inflated is a different
                 failure from "there was no card here", and the person holding
                 the phone can act on the first and not the second. */
              var err = found.filter(function (f) { return f && f.error; })[0];
              if (err) throw err.error;
              throw new Error('No character data embedded in this PNG');
            }
            /* v1.42.2 (the research handoff's §2.2 and §2.1): say which copy was
               read, when the others disagreed, and what the card's own bytes did
               that a parser settles silently. Choosing `ccv3` was already the
               rule; what was missing was telling anyone, so a card that looked
               wrong gave the author nothing to check. This whole block is
               inspection only — it reads, it does not touch `card` or `buf` — and
               it is wrapped so that a fault in a note can never cost a user their
               import. */
            try {
              var notes = [];
              var ignoredKeys = usable.filter(function (f, ix) { return ix !== pick; }).map(function (f) { return f.key; });
              var unreadable = found.filter(function (f) { return f && (f.unreadable || f.error); }).length;
              var unknowns = found.filter(function (f) { return f && f.other; })
                .map(function (f) { return String(f.other); }).filter(Boolean);
              var differing = usable.filter(function (f, ix) {
                return ix !== pick && !Store._sameVal(f.card, card);
              }).map(function (f) { return f.key; });
              if (usable.length > 1 || unreadable || unknowns.length) {
                notes.push('This PNG carried ' + usable.length + ' readable ' +
                  (usable.length === 1 ? 'copy' : 'copies') + ' of the card data' +
                  (ignoredKeys.length ? ' (' + ignoredKeys.join(', ') + ' ignored' : '') +
                  (unreadable ? (ignoredKeys.length ? ', plus ' : ' (') + unreadable + ' chunk' + (unreadable > 1 ? 's' : '') + ' this app could not read' : '') +
                  (unknowns.length ? (ignoredKeys.length || unreadable ? ', and ' : ' (') + 'data under the keyword' + (unknowns.length > 1 ? 's ' : ' ') + unknowns.join(', ') + ' that the card spec does not define' : '') +
                  '. The app reads ' + usable[pick].key + ' first' +
                  (usable[pick].key === 'ccv3' ? ' (the V3 chunk), so a stale copy in the older field cannot shadow it' : '') +
                  '; nothing in the file was changed.');
              }
              if (differing.length) {
                notes.push('The ignored copies do not say the same thing as the one that was read (' +
                  differing.join(', ') + '). What this app shows and exports is the ' + usable[pick].key +
                  ' copy — if that is not the one you meant, the file has to be repaired where it came from.');
              }
              var anom = Store.jsonAnomalies(usable[pick].json);
              card.__png = {
                chunks: chunks.length, readable: usable.length, used: usable[pick].key,
                ignored: ignoredKeys, differing: differing, unreadable: unreadable,
                unknownKeys: unknowns, dupKeys: anom.dupKeys, numbers: anom.numbers,
                checked: anom.checked, notes: notes
              };
              if (anom.dupKeys.length) {
                notes.push('The card’s own JSON repeats ' + anom.dupKeys.length +
                  (anom.dupKeys.length === 1 ? ' key' : ' keys') + ' inside one object (' +
                  anom.dupKeys.slice(0, 3).map(function (d) { return d.path + ' ×' + (d.count || 2); }).join(', ') +
                  (anom.dupKeys.length > 3 ? ', and ' + (anom.dupKeys.length - 3) + ' more' : '') +
                  '). A file like that has no single meaning — the card spec calls duplicate keys undefined behaviour — ' +
                  'and this app keeps the LAST copy, the way JSON.parse does. Nothing was cut to make it fit; if a field ' +
                  'looks wrong, that is the first thing to check in the file.');
              }
              var lost = anom.lostNumbers || [];
              if (lost.length) {
                notes.push(lost.length + ' number' + (lost.length === 1 ? '' : 's') + ' in the card’s JSON cannot be held ' +
                  'as written (' + lost.slice(0, 3).map(function (n) { return n.token + ' → ' + n.as; }).join(', ') +
                  (lost.length > 3 ? ', and ' + (lost.length - 3) + ' more' : '') + '). The character works normally and ' +
                  'nothing was dropped, but an export from here writes the app’s form, not the file’s.');
              }
            } catch (eNote) { /* the import does not depend on this */ }
            /* A PNG-embedded card IS its own avatar: SillyTavern stores the
               picture in the file, not in the JSON. Attach the file itself
               when the embedded JSON carries no usable char_x of its own.
               (v3 cards keep char_x inside `data`.) */
            var target = (card.spec === 'chara_card_v3' && card.data) ? card.data : card;
            if (!Store.cardAvatar(target.char_x)) {
              target.char_x = Store.bytesToDataUrl(buf, 'image/png');
            }
            resolve(card);
          }).catch(reject);
        } catch (e) { reject(e); }
      });
    },

    /* One parsed JSON value -> the cards it carries. A plain card is one;
       a JanitorAI bulk export ({exported_at, characters: {id: {...}}, skipped})
       carries one card per character, so it unwraps into many. */
    cardsFromRaw: function (raw) {
      if (raw && typeof raw === 'object' && raw.characters && typeof raw.characters === 'object') {
        var entries = Array.isArray(raw.characters)
          ? raw.characters
          : Object.keys(raw.characters).map(function (k) { return raw.characters[k]; });
        var out = [];
        entries.forEach(function (entry) {
          if (!entry || typeof entry !== 'object') return;
          var card = (entry.card && typeof entry.card === 'object') ? entry.card : entry;
          var alts = Array.isArray(card.alternate_greetings) ? card.alternate_greetings : [];
          var name = card.name || entry.character_name || 'Imported character';
          var hadFirst = !!(card.first_mes && String(card.first_mes).trim());
          var c = {
            name: name,
            description: card.description || '',
            personality: card.personality || '',
            scenario: card.scenario || '',
            first_mes: hadFirst ? card.first_mes : (alts[0] || ''),
            mes_example: card.mes_example || '',
            creatorcomment: hadFirst
              ? 'Converted from a JanitorAI bulk export.'
              : 'Converted from a JanitorAI bulk export. The export could not fetch the definition, so the main greeting/scenario/examples were not recovered; the first alternate greeting is used as the opening.',
            tags: card.tags || [],
            talkativeness: '0.5', fav: false,
            spec: 'chara_card_v2', spec_version: '2.0',
            data: { name: name },
            alternate_greetings: alts
          };
          var ad = card.avatar_data;
          if (ad && ad.base64) c.char_x = 'data:' + (ad.mimeType || 'image/png') + ';base64,' + ad.base64;
          out.push(c);
        });
        return out;
      }
      return [raw];
    },

    /* A picked file -> every card it carries (usually one). */
    /* K5 (v1.39.76): the reader used to be chosen by FILE NAME, so a PNG
       saved as .json said "Invalid JSON" and a JSON saved as .png said "Not a
       PNG character card" — both of which are the app describing its own
       guesswork as your mistake. Sniff the bytes instead: every PNG opens with
       the same eight, and anything else is text. */
    readCardsFile: function (file) {
      return new Promise(function (resolve, reject) {
        var fr = new FileReader();
        fr.onload = function () {
          var buf = fr.result;
          var head = new Uint8Array(buf, 0, Math.min(8, buf.byteLength));
          var isPng = head.length === 8 && head[0] === 0x89 && head[1] === 0x50 &&
            head[2] === 0x4e && head[3] === 0x47 && head[4] === 0x0d &&
            head[5] === 0x0a && head[6] === 0x1a && head[7] === 0x0a;
          if (isPng) {
            Store.cardFromPngBytes(buf).then(function (card) { resolve([card]); }, reject);
            return;
          }
          var text;
          try { text = new TextDecoder().decode(buf); }
          catch (e) { reject(new Error('That file is neither a PNG card nor readable text')); return; }
          /* a text file that is not JSON gets the honest error, and says what
             it actually is rather than blaming the extension */
          var parsed;
          try { parsed = JSON.parse(text.replace(/^\uFEFF/, '')); }
          catch (e) {
            reject(new Error(isProbablyJson(text) ? 'That file looks like JSON but will not parse — it may be truncated.'
              : 'That file is not a character card (no JSON and no PNG data in it).'));
            return;
          }
          try { resolve(Store.cardsFromRaw(parsed)); }
          catch (e) { reject(e); }
        };
        fr.onerror = function () { reject(new Error('That file could not be read')); };
        fr.readAsArrayBuffer(file);
      });
    },

    readCardFile: function (file) {
      return Store.readCardsFile(file).then(function (cards) {
        if (!cards || !cards.length) throw new Error('No character found in that file');
        return cards[0];
      });
    },

    wipe: function () {
      var self = this;
      return Promise.all([
        IDB.clear('characters'), IDB.clear('sessions'),
        IDB.clear('messages'), IDB.clear('personas')
      ]).then(function () { return self.refreshPersonas(); });
    }
  };

  global.Store = Store;
})(window);
