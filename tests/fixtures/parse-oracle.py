#!/usr/bin/env python3
"""An independent reader, used by tests/card-parse-differential-test.js.

This file is deliberately NOT a port of anything in horde-studio-mobile. It walks
a PNG with struct/zlib and reads a card with json/decimal, so when it agrees with
the app the agreement means something: a bug that one implementation cannot see
about itself shows up as a difference between two.

That is the whole reason it exists. V8's JSON.parse keeps the last of two
duplicate keys and turns 1e999 into Infinity, and every claim our reader makes
about a card is built on top of that. If the only other reader we test against
is our own code copied into a fixture, "lossless" means nothing.

Usage (the test does this):  python3 parse-oracle.py <file> [<file> ...]
Prints one JSON object per file: chunks, duplicate keys, the numbers a reader
cannot hold, and the parsed value itself with the last key winning.
"""
import json
import math
import struct
import sys
import zlib
from decimal import Decimal, InvalidOperation

SIG = b'\x89PNG\r\n\x1a\n'
TEXTY = ('tEXt', 'iTXt', 'zTXt')


def png_chunks(data):
    """Every text chunk, found the way the spec says to find them.

    The length is honoured but never trusted: a body that runs past the end of the
    file is clamped here exactly as a reader must clamp it, and the CRC is checked
    so that "this file is intact" is not assumed by one side and denied by the
    other. Both are reported, and nothing here throws: a damaged file is a result,
    not a crash.
    """
    out = []
    n = len(data)
    if data[:8] != SIG:
        return {'sig': False, 'chunks': out, 'walked': 0}
    off = 8
    while off + 8 <= n:
        (length,) = struct.unpack('>I', data[off:off + 4])
        ctype = data[off + 4:off + 8].decode('latin1', 'replace')
        body = data[off + 8:off + 8 + length]
        crc_at = off + 8 + length
        crc = None
        if crc_at + 4 <= n:
            (crc,) = struct.unpack('>I', data[crc_at:crc_at + 4])
        crc_ok = crc is not None and crc == (zlib.crc32(data[off + 4:off + 8 + length]) & 0xffffffff)
        if ctype in TEXTY:
            rec = {'type': ctype, 'len': length, 'crcOk': bool(crc_ok),
                   'keyword': None, 'text': None, 'error': None}
            try:
                z = body.index(0)
                rec['keyword'] = body[:z].decode('latin1', 'replace')
                rest = body[z + 1:]
                if ctype == 'zTXt':
                    method = rest[0] if rest else -1
                    if method != 0:
                        raise ValueError('unknown compression method %r' % method)
                    rec['text'] = zlib.decompress(rest[1:]).decode('utf-8', 'replace')
                elif ctype == 'iTXt':
                    flag = rest[0] if len(rest) > 0 else 0
                    method = rest[1] if len(rest) > 1 else -1
                    p = 2
                    for _ in (0, 1):                     # language tag, translated keyword
                        while p < len(rest) and rest[p] != 0:
                            p += 1
                        p += 1
                    blob = rest[p:]
                    if flag == 1:
                        if method != 0:
                            raise ValueError('unknown compression method %r' % method)
                        blob = zlib.decompress(blob)
                    rec['text'] = blob.decode('utf-8', 'replace')
                else:                                     # tEXt: Latin-1 in the spec, UTF-8 in practice
                    rec['text'] = rest.decode('utf-8', 'replace')
            except Exception as exc:                      # noqa: BLE001 - a report, not a crash
                rec['error'] = '%s: %s' % (type(exc).__name__, exc)
            out.append(rec)
        off = crc_at + 4
        if ctype == 'IEND':
            break
    return {'sig': True, 'chunks': out, 'walked': n}


def hexd(f):
    """A float as the 64 bits it is, little-endian hex.

    Python prints 1.2345678901234567e+19 and JavaScript prints
    12345678901234567000 for the SAME double, and both are correct. So the two
    readers are compared by their bits, which is the only thing either of them
    actually promises to preserve.
    """
    try:
        return struct.pack('<d', float(f)).hex()
    except (OverflowError, ValueError):
        return 'unrepresentable'


def jsencode(v):
    """The parsed value, with every number reduced to its bits."""
    if isinstance(v, bool):
        return v
    if isinstance(v, (int, float)):
        return {'__num': hexd(v)}
    if isinstance(v, list):
        return [jsencode(x) for x in v]
    if isinstance(v, dict):
        return {k: jsencode(x) for k, x in v.items()}
    return v


def analyse_json(text):
    """Duplicate keys, unholdable numbers, and the value with the last key winning."""
    dups = {}
    nums = []

    def pairs_hook(pairs):
        """Called once per object, with its pairs in file order — the only way to
        see a repeated key at all, since building the dict is where it disappears."""
        seen = {}
        for k, _v in pairs:
            seen[k] = seen.get(k, 0) + 1
        for k, c in seen.items():
            if c > 1:
                dups[k] = max(dups.get(k, 0), c)
        out = {}
        for k, v in pairs:
            out[k] = v                                   # last copy wins, as JSON.parse does
        return out

    def number(tok):
        """parse_int/parse_float both hand over the LITERAL, so the file's spelling
        is visible before the value is settled."""
        nums.append(tok)
        try:
            return float(Decimal(tok))
        except (OverflowError, ValueError, InvalidOperation):  # noqa: BLE001
            return float('inf') if not str(tok).startswith('-') else float('-inf')

    try:
        obj = json.loads(text, object_pairs_hook=pairs_hook,
                         parse_int=number, parse_float=number)
        bad = None
    except Exception as exc:                             # noqa: BLE001
        obj, bad = None, '%s: %s' % (type(exc).__name__, str(exc)[:160])

    bits = []
    lossy = []
    for tok in nums:
        try:
            bits.append(hexd(float(Decimal(str(tok)))))
        except Exception:                                # noqa: BLE001
            bits.append(hexd(float('nan')))
        try:
            d = Decimal(str(tok))
        except Exception:                                # noqa: BLE001
            continue
        try:
            f = float(d)
        except OverflowError:
            lossy.append({'token': str(tok), 'as': '-Infinity' if str(tok).startswith('-') else 'Infinity'})
            continue
        if not math.isfinite(f):
            lossy.append({'token': str(tok), 'as': repr(f), 'hex': hexd(f)})
            continue
        if Decimal(repr(f)).normalize() != d.normalize():
            lossy.append({'token': str(tok), 'as': repr(f), 'hex': hexd(f)})

    return {'error': bad, 'dupKeys': dups, 'numbers': [str(x) for x in nums],
            'lossy': lossy, 'bits': bits, 'value': jsencode(obj)}


def main(argv):
    """One report per file.

    Each text chunk is classified — a card copy, a stray keyword, or damage — and
    the tally is computed HERE, from Python's own walk, so the test can compare it
    with what the app counted without either side echoing the other's code.
    """
    rep = []
    import base64
    for path in argv:
        with open(path, 'rb') as fh:
            data = fh.read()
        entry = {'file': path, 'bytes': len(data)}
        entry.update(png_chunks(data))
        recs = []
        for ch in entry['chunks']:
            rec = {'type': ch['type'], 'keyword': ch['keyword'], 'crcOk': ch['crcOk'],
                   'state': 'card', 'detail': None, 'json': None, 'rawJson': None}
            if ch['error']:
                rec['state'], rec['detail'] = 'damaged', ch['error']
            elif not ch['keyword']:
                rec['state'], rec['detail'] = 'damaged', 'no keyword in the chunk'
            elif ch['keyword'] not in ('chara', 'ccv3'):
                rec['state'], rec['detail'] = 'stray', ch['keyword']
            elif ch['text'] is None:
                rec['state'], rec['detail'] = 'damaged', 'no text after the keyword'
            else:
                raw = ch['text']
                txt = None
                try:
                    txt = base64.b64decode(compact(raw), validate=False).decode('utf-8')
                except Exception:                          # noqa: BLE001
                    txt = None
                if txt is None:                            # raw JSON in a chunk is accepted too
                    txt = raw.strip().lstrip('\ufeff')
                rec['rawJson'] = txt
                rec['json'] = analyse_json(txt)
                if rec['json']['error']:
                    rec['state'], rec['detail'] = 'damaged', rec['json']['error']
            recs.append(rec)
        entry['cardChunks'] = recs
        entry['tally'] = {
            'readable': sum(1 for r in recs if r['state'] == 'card'),
            # the app lumps "no card in it" and "not JSON" together as unreadable
            'unreadable': sum(1 for r in recs if r['state'] == 'damaged'),
            'stray': sum(1 for r in recs if r['state'] == 'stray'),
            'badCrc': sum(1 for r in recs if not r['crcOk']),
        }
        entry['totals'] = {'chunks': len(recs)}
        rep.append(entry)
    json.dump(rep, sys.stdout)
    return 0


def compact(s):
    """base64 of a card is plain ASCII; anything else in the chunk is not, and
    b64decode would raise. Only whitespace is removed — which the card spec
    permits inside the field, and which this app also allows."""
    return ''.join(s.split())


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
