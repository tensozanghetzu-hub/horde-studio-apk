/* UI helpers: escaping, toasts, sheets, dialogs */
(function (global) {
  'use strict';

  function esc(s) {
    if (s === null || s === undefined) return '';
    return String(s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  /* Very small markdown-ish formatter: bold, italics, code, quotes, asterism */
  function md(s) {
    if (!s) return '';
    var out = esc(s);
    /* Pull fenced blocks out first: the inline rules below must not touch them,
       and their newlines have to survive (the <br> pass would double them). */
    var fences = [];
    out = out.replace(/```([\s\S]*?)```/g, function (_, c) {
      fences.push('<pre>' + c.replace(/^\n/, '').replace(/\n$/, '') + '</pre>');
      return '\u0000' + (fences.length - 1) + '\u0000';
    });
    out = out.replace(/`([^`\n]+)`/g, '<code>$1</code>');
    out = out.replace(/^\s*&gt;\s?(.+)$/gm, '<em>$1</em>');
    out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    out = out.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
    out = out.replace(/\n/g, '<br>');
    out = out.replace(/\u0000(\d+)\u0000/g, function (_, i) { return fences[+i]; });
    return out;
  }

  var toastTimer = null;
  function toast(msg, ms) {
    var el = document.getElementById('toast');
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.hidden = true; }, ms || 2600);
  }

  var sheetResolve = null;
  function closeSheet(val) {
    var wrap = document.getElementById('sheet-wrap');
    wrap.hidden = true;
    document.getElementById('sheet-actions').innerHTML = '';
    document.getElementById('sheet-body').innerHTML = '';
    document.getElementById('sheet-title').innerHTML = '';
    if (sheetResolve) { var r = sheetResolve; sheetResolve = null; r(val); }
  }

  /**
   * sheet({ title, body(html), actions:[{label,cls,value,close,onClick}], dismissible })
   * Resolves with the action `value`, or undefined when dismissed.
   */
  function sheet(opts) {
    return new Promise(function (resolve) {
      var wrap = document.getElementById('sheet-wrap');
      var titleEl = document.getElementById('sheet-title');
      var bodyEl = document.getElementById('sheet-body');
      var actEl = document.getElementById('sheet-actions');

      titleEl.innerHTML = opts.title ? esc(opts.title) : '';
      titleEl.hidden = !opts.title;
      bodyEl.innerHTML = opts.body || '';

      actEl.innerHTML = '';
      (opts.actions || []).forEach(function (a) {
        var b = document.createElement('button');
        b.className = 'btn ' + (a.cls || 'ghost');
        b.textContent = a.label;
        b.onclick = function () {
          var v = a.onClick ? a.onClick(bodyEl) : a.value;
          if (a.close !== false) closeSheet(v);
        };
        actEl.appendChild(b);
      });

      wrap.hidden = false;
      wrap.onclick = function (e) {
        if (e.target && e.target.getAttribute && e.target.getAttribute('data-close-sheet') !== null) {
          if (opts.dismissible !== false) closeSheet(undefined);
        }
      };
      sheetResolve = resolve;
      if (typeof opts.onMount === 'function') opts.onMount(bodyEl, closeSheet);
    });
  }

  function confirmBox(title, message, opts) {
    opts = opts || {};
    return sheet({
      title: title,
      body: '<p style="margin:0 0 4px;color:var(--muted);font-size:14px;line-height:1.5">' + esc(message) + '</p>',
      actions: [
        { label: opts.cancelLabel || 'Cancel', cls: 'ghost', value: false },
        { label: opts.okLabel || 'OK', cls: opts.danger ? 'danger' : 'primary', value: true }
      ]
    }).then(function (v) { return v === true; });
  }

  function inputBox(title, opts) {
    opts = opts || {};
    var id = 'ib' + Math.random().toString(36).slice(2, 8);
    var body =
      (opts.message ? '<p style="margin:0 0 10px;color:var(--muted);font-size:13.5px">' + esc(opts.message) + '</p>' : '') +
      (opts.multiline
        ? '<textarea id="' + id + '" class="tall" placeholder="' + esc(opts.placeholder || '') + '">' + esc(opts.value || '') + '</textarea>'
        : '<input id="' + id + '" type="' + (opts.type || 'text') + '" placeholder="' + esc(opts.placeholder || '') + '" value="' + esc(opts.value || '') + '">');
    return sheet({
      title: title,
      body: body,
      actions: [
        { label: 'Cancel', cls: 'ghost', value: null },
        { label: opts.okLabel || 'Save', cls: 'primary', onClick: function (b) { return b.querySelector('#' + id).value; } }
      ],
      onMount: function (b) {
        var el = b.querySelector('#' + id);
        setTimeout(function () { el.focus(); if (el.select) el.select(); }, 60);
      }
    });
  }

  var ICONS = {
    edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z"/>',
    copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/>',
    trash: '<path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/>',
    download: '<path d="M12 3v13"/><path d="M7 12l5 5 5-5"/><path d="M4 21h16"/>',
    upload: '<path d="M12 21V8"/><path d="M7 12l5-5 5 5"/><path d="M4 3h16"/>',
    chat: '<path d="M21 12a8 8 0 01-8 8H8l-5 3 1.5-4.5A8 8 0 1121 12z"/>',
    user: '<path d="M12 12a4 4 0 100-8 4 4 0 000 8z"/><path d="M4 21a8 8 0 0116 0"/>',
    image: '<rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8.5" cy="8.5" r="1.6"/><path d="M21 15l-5-5L5 21"/>',
    refresh: '<path d="M21 12a9 9 0 11-3-6.7"/><path d="M21 3v6h-6"/>',
    brain: '<path d="M9 3a3 3 0 00-3 3 3 3 0 00-1 5.8V15a3 3 0 003 3h1a2 2 0 002 2h4a2 2 0 002-2V6a3 3 0 00-3-3z"/><path d="M18 3a3 3 0 013 3 3 3 0 011 5.8"/>',
    key: '<circle cx="8" cy="15" r="4"/><path d="M10.8 12.2L20 3"/><path d="M17 4l3 3"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    share: '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="M8.6 13.5l6.8 4M15.4 6.5l-6.8 4"/>',
    sparkle: '<path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/>',
    time: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'
  };

  function icon(name, cls) {
    return '<svg class="' + (cls || '') + '" viewBox="0 0 24 24">' + (ICONS[name] || '') + '</svg>';
  }

  function fmtTime(ts) {
    if (!ts) return '';
    var d = new Date(ts), now = new Date();
    var diff = (now - d) / 1000;
    if (diff < 60) return 'just now';
    if (diff < 3600) return Math.floor(diff / 60) + 'm ago';
    if (diff < 86400) return Math.floor(diff / 3600) + 'h ago';
    var sameDay = d.toDateString() === now.toDateString();
    if (sameDay) return d.toTimeString().slice(0, 5);
    if (diff < 7 * 86400) return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getDay()];
    return d.toLocaleDateString();
  }

  function uid(prefix) {
    return (prefix || 'id') + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  function lightbox(src) {
    var d = document.createElement('div');
    d.style.cssText = 'position:fixed;inset:0;z-index:90;background:rgba(3,2,8,.94);display:grid;place-items:center;padding:16px';
    var img = document.createElement('img');
    img.src = src;
    img.style.cssText = 'max-width:100%;max-height:100%;border-radius:12px';
    d.appendChild(img);
    d.onclick = function () { document.body.removeChild(d); };
    document.body.appendChild(d);
  }

  function download(name, data, mime) {
    var blob = data instanceof Blob ? data : new Blob([data], { type: mime || 'application/json' });
    /* Inside the Android app, hand the bytes to the native side so they land in Downloads. */
    if (global.HSAndroid && global.HSAndroid.saveFile) {
      var fr = new FileReader();
      fr.onload = function () {
        var b64 = String(fr.result).split(',')[1] || '';
        global.HSAndroid.saveFile(name, b64);
      };
      fr.readAsDataURL(blob);
      return;
    }
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click();
    setTimeout(function () { document.body.removeChild(a); URL.revokeObjectURL(url); }, 400);
  }

  global.UI = {
    esc: esc, md: md, toast: toast, sheet: sheet, confirm: confirmBox, input: inputBox,
    closeSheet: closeSheet, icon: icon, fmtTime: fmtTime, uid: uid, lightbox: lightbox, download: download
  };
})(window);
