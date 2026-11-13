/* Import a character card from a link, the way Sillytavern's "External Import"
 * does: a character page on JanitorAI, Chub, Pygmalion, Risu or AICharacterCards,
 * or a direct link to a card file (.png / .json).
 *
 * The download runs through the Android wrapper when there is one (HSAndroid),
 * because a native fetch has no CORS and gets past bot walls that stop a web
 * page cold. Everywhere else it falls back to fetch(), which works wherever
 * the host allows cross-origin reads (Chub, GitHub, ...).
 */
(function (global) {
  'use strict';

  function native() { return global.HSAndroid; }
  function hasBridge() { return !!(native() && native().fetchUrl && native().jobStatus); }

  function b64ToBytes(b64) {
    var bin = atob(b64);
    var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i) & 0xff;
    return bytes.buffer;
  }

  /* Poll a native fetch job until it lands. */
  function fetchViaBridge(url, opts) {
    return new Promise(function (resolve, reject) {
      var id;
      try {
        id = native().fetchUrl(url, opts.method || 'GET', opts.contentType || '', opts.body || '');
      } catch (e) { reject(e); return; }
      if (!id) { reject(new Error('This build cannot fetch addresses')); return; }
      var timer = setInterval(function () {
        var st;
        try { st = JSON.parse(native().jobStatus(id)); }
        catch (e) { clearInterval(timer); reject(new Error('Lost track of the download')); return; }
        if (st.state === 'done') {
          clearInterval(timer);
          try {
            var r = JSON.parse(st.result);
            resolve({ status: r.status, contentType: r.contentType || '', bytes: b64ToBytes(r.body || '') });
          } catch (e) { reject(new Error('The download came back unreadable')); }
        } else if (st.state === 'error') {
          clearInterval(timer);
          reject(new Error(st.message || 'Download failed'));
        }
      }, 200);
    });
  }

  function fetchViaFetch(url, opts) {
    var init = { method: opts.method || 'GET' };
    if (opts.body) {
      init.body = opts.body;
      if (opts.contentType) init.headers = { 'Content-Type': opts.contentType };
    }
    return fetch(url, init).then(function (res) {
      return res.arrayBuffer().then(function (buf) {
        return { status: res.status, contentType: res.headers.get('content-type') || '', bytes: buf };
      });
    });
  }

  function fetchBytes(url, opts, forceWeb) {
    opts = opts || {};
    function check(r) {
      if (r.status >= 400) throw new Error('The server answered ' + r.status + ' for that address');
      return r;
    }
    if (!forceWeb && hasBridge()) {
      /* The native fetch can be turned away where the web view's real
         browser fingerprint gets through (bot walls) — so a failed native
         attempt is retried through fetch() before giving up. */
      return fetchViaBridge(url, opts).then(check).catch(function () {
        return fetchViaFetch(url, opts).then(check);
      });
    }
    return fetchViaFetch(url, opts).then(check);
  }

  function isPng(bytes) {
    var b = new Uint8Array(bytes);
    return b.length > 4 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47;
  }

  function uuidFrom(url) {
    var m = String(url).match(/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/i);
    return m ? m[0] : null;
  }

  function hostOf(url) {
    try { return new URL(url).hostname.toLowerCase(); } catch (e) { return ''; }
  }

  /* Bytes -> cards: a PNG carries its card inside; anything else is read as JSON. */
  function cardsFromBytes(r) {
    if (isPng(r.bytes)) return Store.cardFromPngBytes(r.bytes).then(function (c) { return [c]; });
    var text = new TextDecoder().decode(r.bytes);
    var parsed;
    try { parsed = JSON.parse(text); } catch (e) { throw new Error('That address did not serve a character card'); }
    var cards = Store.cardsFromRaw(parsed);
    if (!cards.length) throw new Error('No character found at that address');
    return Promise.resolve(cards);
  }

  /* JanitorAI creators often write the whole card into the description,
     scenarios included ("Scenarios" section, "Scenario 1 — Title" entries),
     while the dedicated fields stay hidden. Pull those entries out into the
     card's scenario list so they land in the Scenario field instead of
     piling into Persona. Returns null when there is no such section. */
  function extractScenarios(html) {
    var text = String(html || '');
    /* Crude HTML -> text: block tags become line breaks, the rest is
       stripped. Good enough to find the section headers. */
    text = text.replace(/<(br|p|div|h[1-6]|li|tr)[^>]*>/gi, '\n')
               .replace(/<[^>]+>/g, '')
               .replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&')
               .replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/&quot;/gi, '"');
    var lines = text.split('\n').map(function (l) { return l.replace(/\s+/g, ' ').trim(); });
    var start = -1;
    for (var i = 0; i < lines.length; i++) {
      if (/^scenarios$/i.test(lines[i])) { start = i; break; }
    }
    if (start === -1) return null;
    var headerRe = /^scenario\s+\d+\s*[\u2014\u2013-]\s*(.+)$/i;
    var scenarios = [], current = null;
    for (var j = start + 1; j < lines.length; j++) {
      var m = lines[j].match(headerRe);
      if (m) {
        if (current) scenarios.push(current);
        current = { title: m[1].trim(), body: [] };
      } else if (current && lines[j]) {
        current.body.push(lines[j]);
      }
    }
    if (current) scenarios.push(current);
    if (!scenarios.length) return null;
    var list = scenarios.map(function (s) {
      return (s.title + '\n' + s.body.join('\n').trim()).trim();
    });
    /* Everything before the "Scenarios" header is the character writeup. */
    var before = lines.slice(0, start).join('\n').replace(/\n{3,}/g, '\n\n').trim();
    return { before: before, list: list };
  }

  /* JanitorAI page -> the character's own API (hampter). It answers without
     a login and allows cross-origin reads, so it works everywhere — unlike
     JannyAI's archive, which sits behind Cloudflare bot protection and 403s
     most clients. The definition fields are only filled when the creator
     made them public; when they are hidden, JannyAI is tried for the full
     card, and if that fails too the metadata card still imports. */
  function fromHampter(uuid) {
    return fetchBytes('https://janitorai.com/hampter/characters/' + uuid)
      .then(function (r) {
        var d;
        try { d = JSON.parse(new TextDecoder().decode(r.bytes)); }
        catch (e) { throw new Error('JanitorAI did not answer with a character'); }
        if (!d || !d.name) throw new Error('JanitorAI has no character at that address');
        var tags = [];
        (d.tags || []).forEach(function (t) { if (t && t.name) tags.push(t.name); });
        (d.custom_tags || []).forEach(function (t) { if (t) tags.push(t); });
        var card = {
          name: d.name,
          description: d.description || '',
          personality: d.personality || '',
          scenario: d.scenario || '',
          first_mes: d.first_message || '',
          mes_example: d.example_dialogs || '',
          creatorcomment: 'Imported from JanitorAI by ' + (d.creator_name || 'unknown') + '.',
          tags: tags,
          talkativeness: '0.5', fav: false,
          spec: 'chara_card_v2', spec_version: '2.0',
          data: { name: d.name },
          alternate_greetings: Array.isArray(d.first_messages) ? d.first_messages : []
        };
        /* Scenarios written into the description move to the Scenario
           field; the first one doubles as the greeting when the creator
           hid the real first message. */
        var split = extractScenarios(d.description || '');
        if (split) {
          card.scenario_list = split.list;
          card.description = split.before || card.description;
          if (!card.first_mes && split.list.length) card.first_mes = split.list[0];
          /* The scenarios double as intros, so the chat's opening bubble
             and the editor's Greeting switcher can step through them. */
          if (!card.alternate_greetings.length && split.list.length > 1) {
            card.alternate_greetings = split.list.slice(1);
          }
        }
        var hasDefinition = !!(d.first_message && String(d.first_message).trim());
        var avatarFile = d.avatar;
        if (!avatarFile) return { card: card, hasDefinition: hasDefinition };
        var avatarUrl = 'https://ella.janitorai.com/bot-avatars/' + avatarFile + '?width=512';
        return fetchBytes(avatarUrl).then(function (ar) {
          if (isPng(ar.bytes) || /^image\//i.test(ar.contentType || '')) {
            card.data.char_x = Store.bytesToDataUrl(ar.bytes, ar.contentType || 'image/png');
          }
          return { card: card, hasDefinition: hasDefinition };
        }).catch(function () { return { card: card, hasDefinition: hasDefinition }; });
      });
  }

  /* JannyAI's archive (the route Sillytavern takes for JanitorAI links). It
     carries the full card, definition included — but it sits behind
     Cloudflare bot protection, so it goes through the web view's fetch
     (a real browser fingerprint) rather than the native bridge. */
  function fromJanny(uuid) {
    return fetchBytes('https://api.jannyai.com/api/v1/download', {
      method: 'POST', contentType: 'application/json',
      body: JSON.stringify({ characterId: uuid })
    }, true).then(function (r) {
      var data;
      try { data = JSON.parse(new TextDecoder().decode(r.bytes)); }
      catch (e) { throw new Error('JannyAI did not answer with a character'); }
      if (!data || data.status !== 'ok' || !data.downloadUrl) {
        throw new Error('JannyAI has no copy of that character');
      }
      return fetchBytes(data.downloadUrl, null, true).then(cardsFromBytes);
    });
  }

  function fromJanitor(url) {
    var uuid = uuidFrom(url);
    if (!uuid) throw new Error('That JanitorAI link does not name a character');
    return fromHampter(uuid).then(function (h) {
      if (h.hasDefinition) return [h.card];
      /* The creator hid the definition — JannyAI's archive may still have
         the full card. If it does not, the metadata card imports as-is. */
      return fromJanny(uuid).catch(function () { return [h.card]; });
    }).catch(function () {
      /* hampter itself failed (private/deleted character?) — JannyAI is
         the only route left. */
      return fromJanny(uuid).catch(function () {
        throw new Error('Could not reach that JanitorAI character — it may be private, or the network blocked the request');
      });
    });
  }

  function parseChubUrl(url) {
    var parts = String(url).split('/');
    var idx = -1;
    parts.forEach(function (p, i) {
      if (p === 'www.chub.ai' || p === 'chub.ai' || p === 'www.characterhub.org' || p === 'characterhub.org') idx = i;
    });
    var rest = idx !== -1 ? parts.slice(idx + 1) : parts;
    if (rest.length < 2) return null;
    var first = rest[0].toLowerCase();
    if (first === 'characters') return { type: 'character', id: rest.slice(1).join('/') };
    if (first === 'lorebooks') return { type: 'lorebook', id: rest.join('/') };
    if (rest.length === 2) return { type: 'character', id: rest.join('/') };
    return null;
  }

  /* Chub page -> Chub's API, mapped onto a V2 card (mirrors Sillytavern). */
  function fromChub(url) {
    var parsed = parseChubUrl(url);
    if (!parsed || parsed.type !== 'character') throw new Error('That Chub link does not name a character');
    var seg = parsed.id.split('/');
    var creator = seg[0], project = seg[1] || '';
    return fetchBytes('https://api.chub.ai/api/characters/' + creator + '/' + project + '?full=true')
      .then(function (r) {
        var meta;
        try { meta = JSON.parse(new TextDecoder().decode(r.bytes)); }
        catch (e) { throw new Error('Chub did not answer with a character'); }
        var node = meta && meta.node;
        var def = node && node.definition;
        if (!def) throw new Error('Chub has no character at that address');
        var card = {
          spec: 'chara_card_v2', spec_version: '2.0',
          data: {
            name: def.name || project,
            description: def.personality || '',
            personality: def.tavern_personality || '',
            scenario: def.scenario || '',
            first_mes: def.first_message || '',
            mes_example: def.example_dialogs || '',
            creator_notes: def.description || '',
            system_prompt: def.system_prompt || '',
            post_history_instructions: def.post_history_instructions || '',
            alternate_greetings: Array.isArray(def.alternate_greetings) ? def.alternate_greetings : [],
            tags: Array.isArray(node.topics) ? node.topics : [],
            creator: creator,
            character_book: def.embedded_lorebook || null,
            extensions: def.extensions || {}
          }
        };
        var avatarUrl = node.max_res_url;
        if (!avatarUrl) return [card];
        return fetchBytes(avatarUrl).then(function (ar) {
          if (isPng(ar.bytes) || /^image\//i.test(ar.contentType || '')) {
            card.data.char_x = Store.bytesToDataUrl(ar.bytes, ar.contentType || 'image/png');
          }
          return [card];
        }).catch(function () { return [card]; });
      });
  }

  /* Pygmalion page -> the Pygsite export. */
  function fromPygmalion(url) {
    var uuid = uuidFrom(url);
    if (!uuid) throw new Error('That Pygmalion link does not name a character');
    return fetchBytes('https://server.pygmalion.chat/api/export/character/' + uuid + '/v2')
      .then(function (r) {
        var data;
        try { data = JSON.parse(new TextDecoder().decode(r.bytes)); }
        catch (e) { throw new Error('Pygmalion did not answer with a character'); }
        var card = data && data.character;
        if (!card || typeof card !== 'object') throw new Error('Pygmalion has no character at that address');
        var avatarUrl = card.data && card.data.avatar;
        if (!avatarUrl || !/^https?:\/\//i.test(avatarUrl)) return [card];
        return fetchBytes(avatarUrl).then(function (ar) {
          card.data.char_x = Store.bytesToDataUrl(ar.bytes, ar.contentType || 'image/png');
          return [card];
        }).catch(function () { return [card]; });
      });
  }

  function parseAicc(url) {
    try {
      var path = new URL(url).pathname.split('/').filter(Boolean);
      return path.length ? path.join('/') : null;
    } catch (e) { return null; }
  }

  function fromAicc(url) {
    var id = parseAicc(url);
    if (!id) throw new Error('That AICharacterCards link does not name a character');
    return fetchBytes('https://aicharactercards.com/wp-json/pngapi/v1/image/' + id).then(cardsFromBytes);
  }

  function fromRisu(url) {
    var m = String(url).match(/realm\.risuai\.net\/character\/([a-f0-9-]+)/i);
    if (!m) throw new Error('That Risu link does not name a character');
    return fetchBytes('https://realm.risuai.net/api/v1/download/png-v3/' + m[1] + '?non_commercial=true').then(cardsFromBytes);
  }

  function importFromUrl(url) {
    url = String(url || '').trim();
    if (!/^https?:\/\//i.test(url)) return Promise.reject(new Error('That does not look like a web address'));
    var host = hostOf(url);
    if (host.indexOf('janitorai') !== -1) return fromJanitor(url);
    if (host.indexOf('chub.ai') !== -1 || host.indexOf('characterhub.org') !== -1) return fromChub(url);
    if (host.indexOf('pygmalion.chat') !== -1) return fromPygmalion(url);
    if (host.indexOf('aicharactercards.com') !== -1) return fromAicc(url);
    if (host.indexOf('realm.risuai.net') !== -1) return fromRisu(url);
    if (host.indexOf('perchance.org') !== -1) {
      return Promise.reject(new Error('Perchance links are not supported yet — download the card file from the page instead'));
    }
    /* A direct link to a card file: PNG with the card inside, or JSON. */
    return fetchBytes(url).then(cardsFromBytes);
  }

  global.UrlImport = { importFromUrl: importFromUrl };
})(window);
