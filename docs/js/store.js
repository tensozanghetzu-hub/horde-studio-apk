/* Data model, persistence, import/export */
(function (global) {
  'use strict';

  var DEFAULT_SYSTEM = 'You are {{char}}. Stay in character at all times. Write in a natural, immersive style, ' +
    'advancing the scene with concrete detail, action and dialogue. Never speak for {{user}}. ' +
    'Keep replies focused on what just happened and leave room for {{user}} to respond. ' +
    'Write only what {{char}} does and says: never include reasoning, planning, notes, ' +
    'outlines, or commentary about the prompt or the character card.';

  /* Bumped with each release; the wrapper reports the real one when it is there. */
  var VERSION = '1.4.7';

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
    systemPrompt: DEFAULT_SYSTEM,
    userName: 'You',
    userPersona: '',
    streaming: true,
    bursts: true,
    stripThinking: true,
    updateUrl: '',
    autoFinish: true,       /* keep going when a reply comes back cut off */
    hordeKey: '',
    hordeModel: '',          /* '' = any available worker, which is the fastest option */
    hordeSize: 640,
    hordeSteps: 20,
    hordeMaxWait: 600,       /* seconds before we give up on a queued job */
    hordeTextModel: '',
    autoMemory: true,
    memoryEvery: 14,
    sendOnEnter: false,
    showTokens: false
  };

  var Store = {
    settings: null,
    characters: [],
    PRESETS: PRESETS,
    VERSION: VERSION,

    init: function () {
      var self = this;
      return IDB.get('kv', 'settings').then(function (row) {
        self.settings = Object.assign({}, DEFAULTS, row ? row.value : {});
        if (!self.settings.baseUrl && self.settings.provider && PRESETS[self.settings.provider]) {
          self.settings.baseUrl = PRESETS[self.settings.provider].url;
        }
        return self.refreshCharacters();
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
        temperature: null, maxTokens: null,
        lorebook: [], vh: (global.VH ? VH.defaults() : null),
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

    /* ---------------- sessions ---------------- */
    newSession: function (charId, title) {
      return {
        id: UI.uid('s'), charId: charId, title: title || 'New chat',
        summary: '', facts: [], messageCount: 0,
        timeline: 'main', pending: null,
        createdAt: Date.now(), updatedAt: Date.now()
      };
    },

    putSession: function (s) {
      s.updatedAt = Date.now();
      return IDB.put('sessions', s);
    },

    getSessions: function (charId) {
      return IDB.getAllByIndex('sessions', 'charId', charId).then(function (list) {
        return (list || []).sort(function (a, b) { return (b.updatedAt || 0) - (a.updatedAt || 0); });
      });
    },

    allSessions: function () {
      return IDB.getAll('sessions').then(function (list) {
        return (list || []).sort(function (a, b) { return (b.updatedAt || 0) - (a.updatedAt || 0); });
      });
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
        if (s) { s.updatedAt = Date.now(); s.messageCount = (s.messageCount || 0) + 1; return IDB.put('sessions', s); }
      }).then(function () { return msg; });
    },

    updateMessage: function (msg) {
      return IDB.put('messages', msg);
    },

    delMessage: function (id) {
      return IDB.del('messages', id);
    },

    getMessages: function (sessionId) {
      return IDB.getAllByIndex('messages', 'sessionId', sessionId).then(function (list) {
        return (list || []).sort(function (a, b) { return a.createdAt - b.createdAt; });
      });
    },

    /* ---------------- import / export ---------------- */
    exportAll: function () {
      var self = this;
      return Promise.all([IDB.getAll('characters'), IDB.getAll('sessions'), IDB.getAll('messages')])
        .then(function (r) {
          var s = Object.assign({}, self.settings);
          delete s.apiKey; delete s.hordeKey;   // credentials never leave the device
          return JSON.stringify({
            format: 'horde-studio-mobile', version: 1, exportedAt: new Date().toISOString(),
            settings: s, characters: r[0] || [], sessions: r[1] || [], messages: r[2] || []
          }, null, 2);
        });
    },

    importAll: function (text) {
      var data = JSON.parse(text);
      if (!data || !data.characters) throw new Error('Not a Horde Studio backup');
      var chars = data.characters || [], sessions = data.sessions || [], msgs = data.messages || [];
      return Promise.all([
        IDB.putMany('characters', chars),
        IDB.putMany('sessions', sessions),
        IDB.putMany('messages', msgs)
      ]).then(function () { return { characters: chars.length, sessions: sessions.length, messages: msgs.length }; });
    },

    /* SillyTavern-style card -> internal character */
    cardToCharacter: function (card) {
      var data = card;
      if (card.spec === 'chara_card_v3' && card.data) {
        data = card.data;
        var desc = [data.description || '', data.personality || '', data.scenario || ''].filter(Boolean).join('\n\n');
        return {
          id: UI.uid('c'), name: data.name || 'Imported character',
          tagline: (data.tags || []).slice(0, 3).join(', '), avatar: '',
          persona: desc, scenario: '', greeting: data.first_mes || '',
          examples: data.mes_example || '', postHistory: '',
          tags: data.tags || [], systemPrompt: '', temperature: null, maxTokens: null,
          lorebook: Array.isArray(data.character_book && data.character_book.entries)
            ? data.character_book.entries.map(function (e) {
                return { id: UI.uid('l'), keys: e.keys || [], content: e.content || '', enabled: e.enabled !== false };
              })
            : [],
          createdAt: Date.now(), updatedAt: Date.now()
        };
      }
      return {
        id: UI.uid('c'), name: data.name || 'Imported character',
        tagline: (data.tags || []).slice(0, 3).join(', '), avatar: '',
        persona: [data.description || '', data.personality || ''].filter(Boolean).join('\n\n'),
        scenario: data.scenario || '', greeting: data.first_mes || '',
        examples: data.mes_example || '', postHistory: '',
        tags: data.tags || [], systemPrompt: '', temperature: null, maxTokens: null,
        lorebook: [], createdAt: Date.now(), updatedAt: Date.now()
      };
    },

    characterToCard: function (c) {
      return {
        name: c.name, description: c.persona || '', personality: '',
        scenario: c.scenario || '', first_mes: c.greeting || '', mes_example: c.examples || '',
        creatorcomment: 'Exported from Horde Studio Mobile',
        tags: c.tags || [], talkativeness: '0.5', fav: false,
        spec: 'chara_card_v2', spec_version: '2.0', data: { name: c.name }
      };
    },

    /* Read a character card from a .json or .png file */
    readCardFile: function (file) {
      return new Promise(function (resolve, reject) {
        var fr = new FileReader();
        if (/\.json$/i.test(file.name) || file.type === 'application/json') {
          fr.onload = function () {
            try { resolve(JSON.parse(fr.result)); } catch (e) { reject(new Error('Invalid JSON')); }
          };
          fr.readAsText(file);
          return;
        }
        fr.onload = function () {
          try {
            var view = new DataView(fr.result);
            if (view.getUint32(0) !== 0x89504e47) throw new Error('Not a PNG character card');
            var off = 8, chunks = [];
            while (off < view.byteLength) {
              var len = view.getUint32(off);
              var type = '';
              for (var i = 0; i < 4; i++) type += String.fromCharCode(view.getUint8(off + 4 + i));
              if (type === 'tEXt' || type === 'iTXt' || type === 'zTXt') {
                var payload = fr.result.slice(off + 8, off + 8 + len);
                chunks.push({ type: type, data: payload });
              }
              off += 12 + len;
              if (type === 'IEND') break;
            }
            var card = null;
            chunks.forEach(function (ch) {
              if (card) return;
              var bytes = new Uint8Array(ch.data);
              var nul = bytes.indexOf(0);
              var key = String.fromCharCode.apply(null, bytes.subarray(0, nul));
              var rest = bytes.subarray(nul + 1);
              if (key === 'ccv3') {
                var text = '';
                if (ch.type === 'iTXt') {
                  // iTXt: compression flag, compression method, lang tag, translated keyword, then text
                  var p = 2;
                  while (rest[p] !== 0) p++;
                  p++;
                  while (rest[p] !== 0) p++;
                  p++;
                  text = new TextDecoder().decode(rest.subarray(p));
                } else {
                  text = new TextDecoder().decode(rest);
                }
                try { card = JSON.parse(text); } catch (e) {}
              } else if (key === 'chara') {
                var b64 = new TextDecoder().decode(rest);
                try { card = JSON.parse(atob(b64)); } catch (e) {}
              }
            });
            if (!card) throw new Error('No character data embedded in this PNG');
            resolve(card);
          } catch (e) { reject(e); }
        };
        fr.readAsArrayBuffer(file);
      });
    },

    wipe: function () {
      return Promise.all([IDB.clear('characters'), IDB.clear('sessions'), IDB.clear('messages')]);
    }
  };

  global.Store = Store;
})(window);
