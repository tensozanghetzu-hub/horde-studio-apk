#!/usr/bin/env python3
"""Audit a character card for Horde Studio Mobile.

Finds the mechanical problems an audit usually turns up, so the fixes can be
proposed from evidence instead of guesses:

  1. macros that will print literally (unknown names)
  2. CORRUPTED macros glued to letters inside a real word
     ("being {{user}}ed" was "being tested", "grea{{user}} fear" was
     "greatest fear")
  3. which scenario actually wins when both exist
  4. fields that are pure metadata and change nothing

Usage:
    python3 card-audit.py path/to/card.json

Exit code 0 = clean, 1 = problems found. Read the report, then propose fixes
as before -> after pairs. Never rewrite the whole card.
"""

import json
import re
import sys

# --- what Horde Studio actually substitutes -------------------------------
RESOLVED = {
    'char', 'user', 'name', 'personality', 'description', 'scenario', 'persona',
    'sub', 'subj', 'obj', 'poss', 'poss_p', 'ref', 'reflexive',
}

# --- fields read by the importer ------------------------------------------
TEXT_FIELDS = ['description', 'personality', 'scenario', 'first_mes',
               'mes_example', 'post_history_instructions']

# --- fields nothing reads -------------------------------------------------
IGNORED = ['talkativeness', 'fav', 'creatorcomment', 'creator_notes', 'spec',
           'spec_version', 'create_date', 'character_version']


def load(path):
    with open(path, encoding='utf-8') as f:
        raw = json.load(f)
    # V2/V3 keep the real fields under data; V1 keeps them at the top.
    if isinstance(raw.get('data'), dict) and raw['data'].get('name'):
        data = dict(raw)
        data.update(raw['data'])
        return raw, data
    return raw, raw


def text_of(data):
    """Every string the app will read, labelled by field."""
    out = []
    for f in TEXT_FIELDS:
        v = data.get(f)
        if isinstance(v, str) and v.strip():
            out.append((f, v))
    for i, s in enumerate(data.get('scenario_list') or []):
        if isinstance(s, str) and s.strip():
            out.append(('scenario_list[%d]' % i, s))
    for i, s in enumerate(data.get('alternate_greetings') or []):
        if isinstance(s, str) and s.strip():
            out.append(('alternate_greetings[%d]' % i, s))
    book = data.get('character_book') or (data.get('data') or {}).get('character_book')
    if isinstance(book, dict):
        for i, e in enumerate(book.get('entries') or []):
            if isinstance(e, dict) and isinstance(e.get('content'), str):
                out.append(('character_book[%d]' % i, e['content']))
    return out


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        return 2
    path = sys.argv[1]
    raw, data = load(path)
    fields = text_of(data)
    problems = 0

    print('=' * 66)
    print('Card:', data.get('name') or '(unnamed)')
    print('File:', path)
    print('=' * 66)

    # -- 1. macros ---------------------------------------------------------
    print('\n1. MACROS')
    unknown, glued = {}, []
    for fname, text in fields:
        for m in re.finditer(r'\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}', text):
            name = m.group(1)
            if name.lower().replace('-', '_') not in RESOLVED:
                unknown.setdefault(name, []).append(fname)
        # a macro glued to a letter is corruption, not a macro.
        # capture the surrounding words so the broken word is readable.
        for m in re.finditer(r'.{0,34}\{\{[A-Za-z_]+\}\}.{0,34}', text, re.S):
            frag = m.group(0)
            if re.search(r'[A-Za-z]\{\{|\}\}[A-Za-z]', frag):
                clean = re.sub(r'\s+', ' ', frag).strip()
                glued.append((fname, clean))

    if unknown:
        problems += len(unknown)
        print('   UNKNOWN — these will print as literal braces:')
        for name, where in sorted(unknown.items()):
            print('     {{%s}}  in %s' % (name, ', '.join(sorted(set(where)))))
    else:
        print('   ok  every macro name is one the app resolves')

    if glued:
        # the same damage is usually duplicated across scenario/scenario_list
        grouped = {}
        for fname, frag in glued:
            grouped.setdefault(frag, []).append(fname)
        problems += len(grouped)
        print('\n   CORRUPTED — a macro glued to letters inside a real word:')
        for frag, where in grouped.items():
            print('     %-46r  in %s' % (frag, ', '.join(sorted(set(where)))))
        print('''
   How to repair these (do this, do not guess blindly):
     a. A macro glued on BOTH sides means a literal string was replaced by
        the macro, so the original word survives as prefix + suffix:
        "being {{user}}ed" = "being ___ed", "grea{{user}}" = "grea___".
     b. Find ONE string that makes every occurrence a real word. In the
        example above "test" does both: "tested", "greatest". Consistency
        across occurrences is the proof, because one find-and-replace
        caused all of them.
     c. Propose each repair as field, before -> after, with the reasoning.
     d. Re-run this audit afterwards: the glued list must come back empty.''')
    else:
        print('   ok  no macro is glued inside a word')

    # -- 2. scenario precedence -------------------------------------------
    print('\n2. SCENARIO')
    scen = (data.get('scenario') or '').strip()
    slist = data.get('scenario_list') or []
    first = (slist[0] or '').strip() if slist else ''
    def canon(t):
        return re.sub(r'\s+', ' ', re.sub(r'<[^>]*>', '', t or '')).strip()
    if scen and first:
        same = canon(scen) == canon(first)
        print('   both exist — "scenario" wins%s' % (
            ' (same text once tags are stripped)' if same else ''))
        print('   scenario_list[0] is a FALLBACK only; editing it alone changes nothing')
        if not same:
            problems += 1
            print('   WARNING: they differ in substance. The player sees "scenario".')
            print('   Edit that one, or make them match, or the two drift apart.')
    elif scen:
        print('   scenario only — used as the situation')
    elif first:
        print('   no scenario — scenario_list[0] is used as the fallback')
    else:
        print('   neither — there is no situation text')

    tags = set()
    for fname, text in fields:
        tags.update(re.findall(r'<\s*/?\s*([A-Za-z][A-Za-z0-9]*)\b', text))
    if tags:
        print('   tags present: %s' % ', '.join('<' + t + '>' for t in sorted(tags)[:8]))
        print('   ALL tags are stripped to plain text before the model sees them')
        print('   "<System>...</System>" does NOT act as a system message here')

    # -- 3. ignored metadata ----------------------------------------------
    print('\n3. IGNORED METADATA (safe to leave alone)')
    present = [k for k in IGNORED if k in data or k in raw]
    print('   ' + (', '.join(present) if present else 'none present'))
    if 'talkativeness' in present or 'fav' in present:
        print('   talkativeness/fav are SillyTavern group-chat fields; nothing reads them')

    # -- 4. structural sanity ---------------------------------------------
    print('\n4. STRUCTURE')
    checks = [
        ('description', bool((data.get('description') or '').strip()),
         'no description — the character has no sheet'),
        ('first_mes', bool((data.get('first_mes') or '').strip()),
         'no first_mes — the chat opens empty'),
    ]
    for _name, ok, msg in checks:
        if ok:
            print('   ok  %s present' % _name)
        else:
            problems += 1
            print('   MISSING  %s' % msg)
    if data.get('data') and data.get('name'):
        print('   note: fields exist both at top level and under data — the importer merges them')

    print('\n' + '=' * 66)
    print('PROBLEMS: %d' % problems if problems else 'CLEAN')
    print('=' * 66)
    return 1 if problems else 0


if __name__ == '__main__':
    sys.exit(main())
