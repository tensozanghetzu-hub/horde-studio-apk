/* LLM layer: OpenAI-compatible endpoints + AI Horde text, memory, summarisation */
(function (global) {
  'use strict';

  function macros(text, char, s) {
    if (!text) return '';
    var name = (char && char.name) || 'Assistant';
    var user = (s && s.userName) || 'You';
    return String(text)
      .replace(/\{\{char\}\}/gi, name)
      .replace(/\{\{user\}\}/gi, user)
      .replace(/\{\{name\}\}/gi, name)
      .replace(/\{\{personality\}\}/gi, (char && char.persona) || '')
      .replace(/\{\{description\}\}/gi, (char && char.persona) || '')
      .replace(/\{\{scenario\}\}/gi, (char && char.scenario) || '')
      .replace(/\{\{persona\}\}/gi, (s && s.userPersona) || '');
  }

  /* Turn a SillyTavern-style example block into alternating messages */
  function examplesToMessages(text, char, s) {
    var out = [], cur = null;
    String(text || '').split(/\r?\n/).forEach(function (raw) {
      var line = raw.trim();
      if (!line) return;
      var m = line.match(/^<START>$/i);
      if (m) { cur = null; return; }
      var isUser = /^\{\{user\}\}\s*:/i.test(line);
      var isChar = /^\{\{char\}\}\s*:/i.test(line) ||
        new RegExp('^' + (char && char.name ? char.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') : 'char') + '\\s*:', 'i').test(line);
      if (isUser) { out.push({ role: 'user', content: line.replace(/^[^\s:]*\s*:\s*/, '') }); cur = out[out.length - 1]; }
      else if (isChar) { out.push({ role: 'assistant', content: line.replace(/^[^\s:]*\s*:\s*/, '') }); cur = out[out.length - 1]; }
      else if (cur) { cur.content += '\n' + line; }
    });
    return out.filter(function (m) { return m.content && m.content.trim(); })
      .map(function (m) { m.content = macros(m.content, char, s); return m; });
  }

  function loreHits(entries, recent, limit) {
    if (!entries || !entries.length) return [];
    var text = (recent || '').toLowerCase();
    return entries.filter(function (e) {
      if (e.enabled === false) return false;
      return (e.keys || []).some(function (k) {
        return k && text.indexOf(String(k).toLowerCase()) !== -1;
      });
    }).slice(0, limit || 6);
  }

  function charSheet(char, s, session, recent) {
    var parts = [];
    var persona = macros(char.persona, char, s);
    if (persona) parts.push(persona);
    var scenario = macros(char.scenario, char, s);
    if (scenario) parts.push('Current situation: ' + scenario);
    if (s.userPersona) parts.push('About {{user}}: '.replace('{{user}}', s.userName) + s.userPersona);

    var lore = loreHits(char.lorebook, recent);
    if (lore.length) {
      parts.push('Relevant world facts:\n' + lore.map(function (e) {
        return '- ' + macros(e.content, char, s);
      }).join('\n'));
    }
    if (session && (session.summary || (session.facts && session.facts.length))) {
      var mem = [];
      if (session.summary) mem.push('Story so far: ' + session.summary);
      if (session.facts && session.facts.length) mem.push('Established facts:\n' + session.facts.map(function (f) { return '- ' + f; }).join('\n'));
      parts.push(mem.join('\n'));
    }
    var post = macros(char.postHistory, char, s);
    if (post) parts.push(post);
    return parts.join('\n\n');
  }

  function trimHistory(history, n, maxChars) {
    var msgs = history.slice(-n);
    var total = msgs.reduce(function (a, m) { return a + (m.content ? m.content.length : 0); }, 0);
    while (total > maxChars && msgs.length > 4) {
      total -= (msgs.shift().content || '').length;
    }
    return msgs;
  }

  /* ------------------------------------------------------------------
   * Context budget. Upstream 18.0.1 fixed replies being rejected with
   * "context exceeds the current provider input limit" because an audit
   * snapshot was counted against the same cap as the conversation. The
   * rule here: the character sheet and the life snapshot are never the
   * thing that gets cut — trim the conversation instead, and only then
   * the example dialogue.
   * ------------------------------------------------------------------ */
  var CONTEXT_CAP = 128000;   // bytes, provider-bound messages

  /* The Horde is the tight one. horde.js asks for a context of
     min(HORDE_CTX_TOKENS, prompt + reply + 64) and the worker window really is
     that size, so a prompt that is comfortable for a chat provider can still be
     too big here. When the worker truncates, a backend that keeps the head of
     the prompt leaves the model answering the start of the conversation forever,
     whatever you type next. So budget the prompt against this, not CONTEXT_CAP. */
  var HORDE_CTX_TOKENS = 8192;
  function bytesOf(s) {
    try { return new TextEncoder().encode(s || '').length; } catch (e) { return String(s || '').length; }
  }
  function totalBytes(msgs) {
    return msgs.reduce(function (a, m) { return a + bytesOf(m.content); }, 0);
  }
  function fitContext(msgs, floor) {
    var total = totalBytes(msgs);
    if (total <= CONTEXT_CAP) return msgs;
    var out = msgs.slice();
    while (total > CONTEXT_CAP && out.length > floor + 4) {
      total -= bytesOf(out.splice(floor, 1)[0].content);
    }
    return out;
  }

  /** Build the payload for an OpenAI-compatible endpoint. */
  function buildChat(character, session, history, s, note) {
    var recent = history.slice(-6).map(function (m) { return m.text || ''; }).join('\n');
    /* A world run (and any caller that knows better) supplies character.systemPrompt
       with the narrator rules plus live state. Fall back to the global prompt. */
    var system = macros(character.systemPrompt || s.systemPrompt, character, s);
    var sheet = charSheet(character, s, session, recent);
    if (sheet) system += '\n\n' + sheet;
    if (note) system += '\n\n' + note;

    var msgs = [{ role: 'system', content: system.trim() }];
    var ex = examplesToMessages(character.examples, character, s);
    ex.forEach(function (m) { msgs.push(m); });

    var hist = history.map(function (m) {
      return { role: m.role === 'user' ? 'user' : 'assistant', content: m.text || '' };
    }).filter(function (m) { return m.content.trim(); });

    hist = trimHistory(hist, s.contextMessages || 40, s.maxContextChars || 26000);
    hist.forEach(function (m) { msgs.push(m); });

    msgs = fitContext(msgs, 1 + ex.length);
    if (totalBytes(msgs) > CONTEXT_CAP && ex.length) {
      msgs = [msgs[0]].concat(msgs.slice(1 + ex.length));   // last resort: drop the examples
    }
    return msgs;
  }

  /** Build a plain-text prompt for AI Horde / non-chat backends. */
  function buildPrompt(character, session, history, s, note, budgetTokens) {
    var recent = history.slice(-6).map(function (m) { return m.text || ''; }).join('\n');
    var head = macros(character.systemPrompt || s.systemPrompt, character, s) +
      '\n\n' + charSheet(character, s, session, recent);
    if (note) head += '\n\n' + note;
    var ex = examplesToMessages(character.examples, character, s).map(function (m) {
      return (m.role === 'user' ? s.userName : character.name) + ': ' + m.content;
    }).join('\n');
    var hist = history.map(function (m) {
      return (m.role === 'user' ? s.userName : character.name) + ': ' + (m.text || '');
    });
    var join = function (h) {
      return [head.trim(), ex ? 'Example dialogue:\n' + ex : '', 'Chat history:\n' + h.join('\n'),
        character.name + ':'].filter(Boolean).join('\n\n');
    };
    /* head holds the character sheet and the life snapshot — trim history, never that */
    /* Drop the OLDEST turns first, so the newest thing you typed always survives.
       With a budget we trim harder than CONTEXT_CAP would, because the Horde's
       window is far smaller than a chat provider's. */
    var capBytes = budgetTokens ? budgetTokens * 4 : CONTEXT_CAP;
    while (hist.length > 2 && bytesOf(join(hist)) > capBytes) hist.shift();
    return join(hist);
  }

  function endpoint(s) {
    return String(s.baseUrl || '').replace(/\/+$/, '');
  }

  function headers(s) {
    var h = { 'Content-Type': 'application/json' };
    if (s.apiKey) h['Authorization'] = 'Bearer ' + s.apiKey;
    if (endpoint(s).indexOf('openrouter.ai') !== -1) {
      h['HTTP-Referer'] = location.origin;
      h['X-Title'] = 'Horde Studio Mobile';
    }
    return h;
  }

  function listModels(s) {
    if (s.provider === 'horde') return Horde.listTextModels().then(function (r) {
      return r.map(function (m) { return m.name; });
    });
    return fetch(endpoint(s) + '/models', { headers: headers(s) }).then(function (r) {
      return r.json().then(function (d) {
        if (!r.ok) throw new Error((d && (d.error && d.error.message)) || r.statusText);
        var arr = Array.isArray(d) ? d : (d.data || []);
        return arr.map(function (m) { return m.id || m.name; }).filter(Boolean);
      });
    });
  }

  function testConnection(s) {
    if (s.provider === 'horde') {
      return Horde.health().then(function (h) {
        var msg = h.textWorkers + ' text workers / ' + h.imageWorkers + ' image workers online · ' +
          h.textJobs + ' text + ' + h.imageJobs + ' image jobs queued · typical wait ~' + Math.max(h.textEta, 5) + 's';
        var who = Horde.whoami(s.hordeKey);
        return (who ? who.then(function (u) {
          if (u && u.kudos !== undefined) msg += ' · your kudos: ' + Math.round(u.kudos);
          return { ok: true, message: msg };
        }) : Promise.resolve({ ok: true, message: msg }));
      }).catch(function (e) { return { ok: false, message: e.message }; });
    }
    return listModels(s).then(function (m) {
      return { ok: true, message: m.length + ' models available' };
    }).catch(function (e) { return { ok: false, message: e.message }; });
  }

  /** Stream a chat completion. onDelta(textChunk). Returns full text. */
  function streamChat(s, messages, onDelta, signal, override) {
    /* The parser must follow the mode we actually asked for, not the global
       setting. summarize() (auto-memory) and quickText() (AI persona draft)
       force stream:false; when the user has streaming on, their JSON answer was
       fed to the SSE parser and came back as '' — so memory silently never
       updated. Derive one value and use it for both request and response. */
    var wantStream = (override && override.stream !== undefined)
      ? !!override.stream
      : (s.streaming !== false);
    var body = Object.assign({
      model: s.model,
      messages: messages,
      temperature: s.temperature,
      top_p: s.topP,
      max_tokens: s.maxTokens,
      stream: wantStream
    }, override || {});

    return fetch(endpoint(s) + '/chat/completions', {
      method: 'POST', headers: headers(s), body: JSON.stringify(body), signal: signal
    }).then(function (r) {
      if (!r.ok) {
        return r.text().then(function (t) {
          var msg = t;
          try { var j = JSON.parse(t); msg = (j.error && (j.error.message || JSON.stringify(j.error))) || j.message; } catch (e) {}
          throw new Error('API ' + r.status + ': ' + msg);
        });
      }
      if (!wantStream) {
        return r.json().then(function (d) {
          var txt = (d.choices && d.choices[0] && (d.choices[0].message ? d.choices[0].message.content : d.choices[0].text)) || '';
          if (onDelta) onDelta(txt);
          return txt;
        });
      }
      var reader = r.body.getReader(), dec = new TextDecoder(), buf = '', full = '';
      function pump() {
        return reader.read().then(function (res) {
          if (res.done) return full;
          buf += dec.decode(res.value, { stream: true });
          var lines = buf.split('\n');
          buf = lines.pop();
          for (var i = 0; i < lines.length; i++) {
            var line = lines[i].trim();
            if (!line || line.indexOf('data:') !== 0) continue;
            var payload = line.slice(5).trim();
            if (payload === '[DONE]') continue;
            try {
              var j = JSON.parse(payload);
              var ch = j.choices && j.choices[0];
              var delta = ch && (ch.delta ? ch.delta.content : ch.text);
              if (delta) { full += delta; if (onDelta) onDelta(delta, full); }
            } catch (e) { /* partial JSON, ignore */ }
          }
          return pump();
        });
      }
      return pump();
    });
  }

  /* Reveal a finished string progressively so Horde replies feel the same as streams */
  function revealText(text, onDelta) {
    return new Promise(function (resolve) {
      var words = text.split(/(\s+)/);
      var i = 0, out = '';
      (function step() {
        if (i >= words.length) return resolve(out);
        var chunk = words.slice(i, i + 3).join('');
        i += 3;
        out += chunk;
        if (onDelta) onDelta(chunk, out);
        setTimeout(step, 12);
      })();
    });
  }

  /** Refuse early (and clearly) when the chosen Horde model has no workers. */
  function guardModel(type, name) {
    if (!name) return Promise.resolve();
    return Horde.modelStatus(type, name).then(function (st) {
      if (st && st.count === 0) {
        var e = new Error('No workers are serving “' + name + '” right now. ' +
          'Set it to “Any available model” or pick one with workers online.');
        e.modelOffline = true;
        throw e;
      }
    }).catch(function (e) {
      if (e && e.modelOffline) throw e;   // real problem worth surfacing
      return null;                        // couldn't check: don't block the job
    });
  }

  function escapeRe(s) { return String(s || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

  /**
   * The Horde generates raw text: models happily keep writing past their own turn
   * ("Sera: ..." then "You: ...") and stop dead at max_length. Cut at the next
   * speaker so the reply is theirs and theirs alone.
   */
  /* ------------------------------------------------------------------
   * Thinking that leaks into the reply.
   *
   * Plenty of models plan out loud before they answer. Some wrap it in tags
   * (<think>, <reasoning>, …) and those are easy. The harder case is a model
   * that just starts thinking in plain prose — question headers, "let's refine
   * the response", references to "the prompt" — and only then writes the reply.
   * ------------------------------------------------------------------ */
  var THINK_TAGS = 'think|thinking|reasoning|reasoned|thought|thoughts|internal|analysis|' +
    'reflection|plan|planning|notes|scratchpad|chain[- ]?of[- ]?thought|antml:think';

  /** A line that is the model talking to itself rather than to the player. */
  function isMetaLine(L) {
    var l = String(L || '').trim();
    if (!l) return false;
    if (/\?$/.test(l) && l.length < 70) return true;                 // "How do they react?"
    if (/^(?:let's|lets|let me|wait|okay|ok[,.]|hmm|so,|now,|first,|firstly|then,|after that|actually,|maybe|perhaps|alright|right,|yes,|no,|i should|i'll|i will|i'd|i need|i can|i could|i must|i want to|we should|we need|the prompt|the instruction|the system|the card|note:|notes?:|step \d|finally,|also,|importantly,?|keep in mind|remember,?|one more|to sum|in summary,?)/i.test(l)) return true;
    if (/\b(?:the\s+)?(?:prompt|instruction|system prompt|card|scenario)\s+(?:says?|asks?|tells?|wants?|instructs?|requires?|mentions?)\b/i.test(l)) return true;
    if (/\b(?:refine|rework|rewrite|adjust|revise|tighten|trim)\s+(?:the\s+)?(?:response|reply|answer|draft|this)\b/i.test(l)) return true;
    if (/\b(?:i|we)\s+(?:should|need to|could|can|will|must|might)\s+(?:probably\s+)?\b/i.test(l) && l.length < 90) return true;
    if (/^(?:\[|\()\s*(?:ooc|note|meta|aside)/i.test(l)) return true;
    return false;
  }

  /** A line that is unmistakably the story: dialogue, an action beat, a speaker. */
  function isProseLine(L) {
    var l = String(L || '').trim();
    if (!l || isMetaLine(l)) return false;
    if (/^["“*_(]/.test(l)) return true;                             // speech, *action*, (beat)
    if (/["“”]/.test(l) && l.length > 40) return true;               // a line with dialogue in it
    if (l.length > 120) return true;                                 // a real paragraph
    if (/^[A-Z][\w'’ -]{1,24}:\s+\S/.test(l) && l.length > 24) return true;   // "Rachel: …"
    return false;
  }

  /** Planning commentary after the reply. Deliberately narrow: a character
      ending on a question is normal, so a bare "?" is not enough to cut. */
  function isTrailerMeta(L) {
    var l = String(L || '').trim();
    if (!l) return false;
    if (/\b(?:the\s+)?(?:prompt|instruction|system prompt|card|scenario)\s+(?:says?|asks?|tells?|wants?|instructs?)\b/i.test(l)) return true;
    if (/\b(?:refine|rework|rewrite|adjust|revise|tighten|trim)\s+(?:the\s+)?(?:response|reply|answer|draft|this)\b/i.test(l)) return true;
    if (/^(?:let's|lets|okay|ok,|alright|hmm|now,|finally,|in summary|to sum up|i'll|i will|i should)\b/i.test(l) && l.length > 20) return true;
    return false;
  }

  /**
   * Remove the model's reasoning from a reply, keeping what the character
   * actually says. Tagged blocks always go. An unlabelled preamble only goes
   * when several consecutive-looking planning lines precede the first real
   * line of story, so ordinary prose is never mistaken for thinking.
   */
  function stripThinking(text, enabled) {
    var t = String(text || '');
    if (!t) return t;
    if (enabled === false) return t;

    /* 1. <think>…</think> and friends, including when the model forgets to close */
    var re = new RegExp('<(?:' + THINK_TAGS + ')\\s*>[\\s\\S]*?(?:</(?:' + THINK_TAGS + ')\\s*>|$)', 'i');
    var out = t, m, guard = 0;
    while ((m = re.exec(out)) && guard++ < 20) {
      out = out.slice(0, m.index) + out.slice(m.index + m[0].length);
    }
    if (!out.trim()) return t;                    // it was all thinking — keep something

    /* 2. an unlabelled planning preamble in front of the reply.
          Scan the whole thing rather than stopping at the first story-looking
          line: a long context line inside the planning would otherwise cut the
          scan short and leave the rest of the reasoning behind. We only strip
          when planning clearly dominates the head and a reply is left over. */
    var lines = out.split('\n');
    var meta = [], prose = [], i;
    var lastMeta = -1;
    for (i = 0; i < lines.length; i++) {
      var l = lines[i].trim();
      meta[i] = !!l && isMetaLine(l);
      prose[i] = !!l && !meta[i] && isProseLine(l);
      if (meta[i]) lastMeta = i;
    }
    if (lastMeta >= 0) {
      var m = 0, p = 0, q = 0;
      var head = [];
      for (i = 0; i <= lastMeta; i++) {
        if (meta[i]) {
          m++;
          if (/\?\s*$/.test(lines[i]) && lines[i].length < 70) q++;   // "How do they react?"
        }
        if (prose[i]) p++;
        if (lines[i].trim()) head.push(lines[i]);
      }
      var refs = /\b(?:the\s+)?(?:prompt|instruction|system prompt|card|scenario)\s+(?:says?|asks?|tells?|wants?|instructs?)\b/i.test(head.join('\n'));
      var tailHasStory = false;
      for (i = lastMeta + 1; i < lines.length; i++) if (prose[i]) { tailHasStory = true; break; }

      if (m > p && (q >= 2 || refs || m >= 4)) {
        var rest = lines.slice(lastMeta + 1).join('\n').trim();
        if (rest.length >= 25 && tailHasStory) out = rest;
      }
    }
    return out;
  }

  function cleanReply(text, charName, userName) {
    if (!text) return '';
    var lines = String(text).split('\n');
    var out = [];
    var userRe = new RegExp('^\\s*' + escapeRe(userName) + '\\s*:', 'i');
    var charRe = new RegExp('^\\s*' + escapeRe(charName) + '\\s*:', 'i');
    for (var i = 0; i < lines.length; i++) {
      if (i > 0 && (userRe.test(lines[i]) || charRe.test(lines[i]))) break;
      out.push(lines[i]);
    }

    /* A model handing the pen back to the player ("What's your response as
       Aslyn?", "Your response:") is not part of the reply. Drop those trailing
       lines — but only short ones that are clearly a prompt, and never so many
       that nothing is left. */
    var asName = charName
      ? new RegExp('response\\s+as\\s+' + escapeRe(String(charName)) + '\\b', 'i')
      : null;
    var META = /^(?:your\s+)?(?:next\s+)?response\b[\s\S]*$/i;
    var META_ANY = /\byour\s+(?:next\s+)?response\b/i;
    var ASK = /^(?:\[|<)?(?:write|continue|you\s+respond|your\s+turn)\b/i;
    while (out.length > 1) {
      var last = out[out.length - 1];
      var isMeta = META.test(last) ||
        (asName && asName.test(last)) ||
        (ASK.test(last) && last.length < 80) ||
        (META_ANY.test(last) && last.length < 80 && /[?:]\s*$/.test(last)) ||
        isTrailerMeta(last);
      if (isMeta) out.pop(); else break;
    }

    var t = out.join('\n').replace(/\s+$/, '');
    if (charName) t = t.replace(new RegExp('^\\s*' + escapeRe(charName) + '\\s*:\\s*', 'i'), '');
    return t.trim();
  }

  /* Short words that can legitimately end a generation pass — if the last word is one of
     these we treat the next chunk as a new word and re-insert the space. */
  var COMMON_WORDS = /^(a|an|and|the|to|of|in|on|at|is|it|its|was|were|be|been|am|are|that|this|these|those|with|for|from|by|as|but|not|no|nor|or|so|if|then|than|there|here|their|his|her|hers|him|she|he|they|them|we|you|your|yours|i|my|our|have|has|had|will|would|can|could|should|shall|may|might|must|do|does|did|done|up|out|down|over|under|again|more|most|some|any|all|one|two|three|what|when|where|why|how|who|whom|which|because|about|into|onto|off|after|before|while|during|through|between|against|among|also|very|just|only|even|still|yet|ever|never|always|now|soon|later|today|tonight|yes|ok|okay|well|good|bad|right|left|back|away|enough|much|many|few|own|same|such|other|another|every|both|each|either|neither|mine|me|us|let|lets|go|going|went|come|coming|came|said|says|say|know|knows|knew|think|thought|want|wants|need|needs|see|saw|look|looked|take|took|give|gave|make|made|get|got|tell|told|ask|asked|keep|kept|put|find|found|leave|left|feel|felt|seem|seemed|turn|turned|stand|stood|hold|held|hear|heard|run|ran|move|moved|open|opened|close|closed|begin|began|start|started|stop|stopped|work|worked|try|tried|use|used)$/i;

  /** Does this read like it was cut off? */
  function looksTruncated(text) {
    var t = String(text || '').trim();
    if (!t) return false;
    if (/[.!?\u2026"\u201d'\u2019)\]]\s*$/.test(t)) return false;   // ended on real punctuation
    if (/\*\s*$/.test(t)) return false;                             // ended on an action beat
    return true;                                                  // dangling word, comma, dash…
  }

  /**
   * Break a one-line reply into its sentences. Returns null unless every piece
   * looks like a text someone would actually send — that keeps "Dr. Mara is
   * here" and long prose from being torn apart.
   */
  var ABBREV = /^(?:mr|mrs|ms|dr|st|jr|sr|prof|vs|etc|eg|ie|approx|no|al|fig|figs|vol|ch|pp|inc|ltd|co|mt|ft|sq|ave|rd|blvd)$/i;
  function splitSentences(t) {
    if (t.length > 220 || t.length < 12) return null;
    var parts = [], buf = '';
    for (var i = 0; i < t.length; i++) {
      buf += t.charAt(i);
      if (!/[.!?]/.test(t.charAt(i))) continue;
      var next = t.charAt(i + 1);
      if (next !== undefined && !/\s/.test(next)) continue;          // mid-word punctuation
      var word = (buf.trim().replace(/[.!?]+$/, '').match(/[\w'’-]+$/) || [''])[0];
      if (word.length <= 1 || ABBREV.test(word)) continue;            // initials and "Dr."
      parts.push(buf.trim());
      buf = '';
    }
    if (buf.trim()) parts.push(buf.trim());
    if (parts.length < 2) return null;
    /* every piece has to read as a text of its own: at least two words, and
       short enough to have been typed in one go */
    var ok = parts.every(function (p) {
      return p.split(/\s+/).length >= 2 && p.length <= 120;
    });
    return ok ? parts : null;
  }

  /**
   * Split one generation into the separate texts a person would actually send.
   *
   * Structured replies keep their explicit boundaries; for anything else this is a
   * deliberately conservative fallback — paragraphs, formatted blocks and anything
   * that reads like prose stay exactly as the model wrote it. (v18.0.1)
   */
  function splitBurst(text, max) {
    var t = String(text || '').trim();
    if (!t) return [];
    max = Math.max(1, Math.min(4, max || 1));
    if (max < 2) return [t];

    /* never break up formatting the model clearly meant as one block */
    if (/```|^\s*>|^\s*#{1,6}\s|^\s*\|/m.test(t)) return [t];
    if (t.indexOf('\n') === -1) {
      /* Bounded compatibility fallback: most models write a burst as one run-on
         line instead of separate lines. Split on sentence ends, but only when
         every piece is a plausible text of its own. */
      var sentences = splitSentences(t);
      if (sentences && sentences.length >= 2 && sentences.length <= max) return sentences;
      return [t];
    }

    var lines = t.split(/\n+/).map(function (l) {
      return l.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '').trim();
    }).filter(Boolean);
    if (lines.length < 2 || lines.length > max) return [t];
    if (t.length > 600) return [t];

    /* every line has to stand on its own: short enough to be one text, and either
       punctuated or short enough that punctuation doesn't matter */
    var ok = lines.every(function (l) {
      if (l.length > 180) return false;
      return /[.!?\u2026"'\u201d\u2019)\]]\s*$/.test(l) || l.length <= 60;
    });
    return ok ? lines : [t];
  }

  /** Where a reply should end, as Horde stop sequences. */
  function stopSeqs(char, s) {
    var u = String((s && s.userName) || 'You').trim();
    var c = String((char && char.name) || '').trim();
    var out = [];
    if (u) out.push('\n' + u + ':', '\n' + u + ' :', u + ':');
    if (c && c !== u) out.push('\n' + c + ':', '\n' + c + ' :');
    out.push('\n<START>', '<START>');
    return out.slice(0, 8);
  }

  /**
   * Main entry: generate the next reply.
   * If a reply comes back cut off mid-sentence, keep going until it lands on its
   * feet (up to 3 passes) — providers that stop cleanly just return after one.
   */
  function generate(o) {
    var s = o.settings, char = o.character, session = o.session;
    var maxRounds = (o.autoFinish === false || s.autoFinish === false) ? 1 : 3;
    var full = '';

    function round(idx) {
      if (o.signal && o.signal.aborted) return Promise.reject(new DOMException('Aborted', 'AbortError'));
      if (s.provider === 'horde') {
        /* buildPrompt ends with "Name:" — for a continuation we append what we have
           so the model carries on from that exact point. */
        /* A continuation round re-sends what we already have on top of the
           prompt, so it has to leave room for two replies, not one. */
        var budget = HORDE_CTX_TOKENS - (s.maxTokens || 200) * (idx > 0 ? 2 : 1) - 64;
        var base = buildPrompt(char, session, o.history, s, o.note, budget);
        var prompt = idx === 0 ? base : base + ' ' + full;
        return guardModel('text', s.hordeTextModel).then(function () {
          return Horde.generateText({
            prompt: prompt,
            model: s.hordeTextModel || '',
            maxLength: s.maxTokens,
            temperature: s.temperature,
            topP: s.topP,
            topK: s.topK,
            repPen: s.repPen,
            apikey: s.hordeKey,
            signal: o.signal,
            maxWait: s.hordeMaxWait,
            onProgress: o.onProgress,
            stopSequence: stopSeqs(char, s)
          });
        }).then(function (r) { return r.text; });
      }
      var msgs = buildChat(char, session, o.history, s, o.note);
      if (idx > 0) msgs.push({ role: 'assistant', content: full });
      /* Preview this pass in its own buffer. loop() cleans the returned text and
         commits it to `full` exactly once — accumulating here as well left two
         copies of every tag, so a single [[cash:+10]] settled as +20. */
      var streamed = '';
      return streamChat(s, msgs, function (chunk) {
        streamed += chunk;
        if (o.onDelta) o.onDelta(chunk, full + (full ? ' ' : '') + streamed);
      }, o.signal, o.override);
    }

    function loop(idx) {
      return round(idx).then(function (txt) {
        var raw = stripThinking(txt || '', s.stripThinking !== false);
        var piece = cleanReply(raw, char && char.name, s.userName);
        if (!piece) return full;

        /* Stitch without mangling. The hard part: when the previous pass ends with a
           letter and the next starts with one, it is either a word split by the token
           limit ("wes" + "t.") or a real word boundary ("and" + "how"). Only join tight
           when the last word does not read as a finished English word. */
        var glue = '';
        if (full) {
          var prevEnd = full.slice(-1), nextStart = piece.charAt(0);
          var lastWord = full.match(/[A-Za-z']+$/);
          var splitWord = /[A-Za-z0-9]$/.test(prevEnd) && /^[A-Za-z0-9]/.test(nextStart) &&
            !(lastWord && COMMON_WORDS.test(lastWord[0]));
          var hasSpace = /\s$/.test(full) || /^\s/.test(piece);
          var noSpace = /^[.,!?;:')"\u201d\u2019]/.test(nextStart) || /[(—–-]$/.test(prevEnd);
          glue = (hasSpace || splitWord || noSpace) ? '' : ' ';
        }
        var before = full;
        full = before ? before + glue + piece : piece;
        /* Clean the ASSEMBLED text too: a speaker label can land across a pass
           boundary ("...out here.\n\nMi" + "ira: ..."), which per-pass cleaning misses. */
        var joined = cleanReply(stripThinking(full, s.stripThinking !== false), char && char.name, s.userName);
        if (joined) full = joined;

        if (s.provider === 'horde' && o.onDelta) {
          /* reveal it like a stream so the Horde feels the same as everything else */
          return revealText(glue + piece, function () {
            if (o.onDelta) o.onDelta('', full);
          }).then(function () { return after(); });
        }
        if (idx > 0 && o.onDelta) o.onDelta(glue + piece, full);
        return after();
      });

      function after() {
        if (idx + 1 >= maxRounds) return full;
        if (!looksTruncated(full)) return full;
        if (o.signal && o.signal.aborted) return full;
        if (o.onProgress) o.onProgress({ state: 'continuing', waitTime: 0, elapsed: 0 });
        return loop(idx + 1);
      }
    }

    return loop(0);
  }

  /** Ask the model to compress the story so far into a summary + facts. */
  function summarize(o) {
    var s = o.settings, char = o.character, session = o.session, history = o.history;
    var convo = history.slice(-o.maxMessages || 40).map(function (m) {
      return (m.role === 'user' ? s.userName : char.name) + ': ' + (m.text || '');
    }).join('\n');

    var instruction =
      'You are a memory manager for a roleplay between ' + s.userName + ' and ' + char.name + '.\n' +
      'Read the transcript and return STRICT JSON only, with no commentary:\n' +
      '{"summary":"<3-6 sentences capturing plot, tone and where things stand>",' +
      '"facts":["<short durable fact>","..."]}\n' +
      'Keep at most 12 facts. Facts must be durable: names, places, relationships, injuries, promises, objects, goals.\n' +
      (session && session.summary ? 'Existing summary to extend:\n' + session.summary + '\n' : '') +
      (session && session.facts && session.facts.length ? 'Existing facts:\n' + session.facts.join('\n') + '\n' : '') +
      '\nTranscript:\n' + convo;

    var msgs = [{ role: 'system', content: instruction }, { role: 'user', content: 'Return the JSON now.' }];

    if (s.provider === 'horde') {
      return Horde.generateText({
        prompt: instruction + '\n\nJSON:',
        model: s.hordeTextModel || '',
        maxLength: 320, temperature: 0.3, topP: 0.9, apikey: s.hordeKey,
        maxWait: 300
      }).then(function (r) { return parseMemory(r.text); });
    }
    return streamChat(s, msgs, null, null, { stream: false, temperature: 0.3, max_tokens: 500 })
      .then(parseMemory);
  }

  function parseMemory(text) {
    var out = { summary: '', facts: [] };
    if (!text) return out;
    var start = text.indexOf('{');
    var end = text.lastIndexOf('}');
    if (start === -1 || end <= start) { out.summary = text.trim().slice(0, 800); return out; }
    try {
      var j = JSON.parse(text.slice(start, end + 1));
      out.summary = String(j.summary || '').trim();
      out.facts = (j.facts || []).map(function (f) { return String(f).trim(); }).filter(Boolean).slice(0, 12);
    } catch (e) {
      out.summary = text.trim().slice(0, 800);
    }
    return out;
  }

  /** Two-line pitch for a character (used by "generate persona"). */
  function quickText(s, prompt, maxTokens) {
    var msgs = [{ role: 'user', content: prompt }];
    if (s.provider === 'horde') {
      return Horde.generateText({ prompt: prompt, model: s.hordeTextModel || '', maxLength: maxTokens || 220,
        temperature: 0.9, apikey: s.hordeKey, maxWait: 300 }).then(function (r) { return r.text; });
    }
    return streamChat(s, msgs, null, null, { stream: false, temperature: 0.9, max_tokens: maxTokens || 220 });
  }

  /** One-shot generation from an arbitrary system + instruction (virtual humans). */
  function generateFree(o) {
    var s = o.settings;
    if (s.provider === 'horde') {
      return Horde.generateText({
        prompt: o.system + '\n\n' + o.instruction + '\n\n' + (o.name || '') + ':',
        model: s.hordeTextModel || '', maxLength: o.maxTokens || 120,
        temperature: 0.95, topP: 0.95, apikey: s.hordeKey,
        signal: o.signal, maxWait: 300, onProgress: o.onProgress
      }).then(function (r) { return r.text; });
    }
    return streamChat(s, [
      { role: 'system', content: o.system },
      { role: 'user', content: o.instruction }
    ], o.onDelta, o.signal, {
      max_tokens: o.maxTokens || 120, temperature: 0.95, stream: s.streaming
    });
  }

  global.API = {
    generateFree: generateFree,
    macros: macros, buildChat: buildChat, buildPrompt: buildPrompt, generate: generate,
    cleanReply: cleanReply, looksTruncated: looksTruncated,
    splitBurst: splitBurst,
    stripThinking: stripThinking,
    isMetaLine: isMetaLine,
    isProseLine: isProseLine,
    CONTEXT_CAP: CONTEXT_CAP,
    HORDE_CTX_TOKENS: HORDE_CTX_TOKENS,
    summarize: summarize, listModels: listModels, testConnection: testConnection,
    streamChat: streamChat, quickText: quickText, examplesToMessages: examplesToMessages,
    estTokens: function (t) { return Math.ceil((t || '').length / 4); }
  };
})(window);
