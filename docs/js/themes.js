/* Themes - the app's appearance, one token set per theme.
 *
 * The whole UI is built on CSS custom properties; a theme is a map from
 * custom-property name to value. THEMES.apply(name) writes them onto
 * document.documentElement, so switching is instant, needs no reload, and
 * touches nothing else in the app. The default :root values in app.css
 * ARE the "midnight" theme, so before themes.js ever runs the app looks
 * exactly as it always did.
 */
(function (global) {
  'use strict';

  function t(bg, bg2, sf, sf2, ln, lns, tx, mu, dm, ac, a2, deep, tint, soft, g1, g2, bar, ok, warn, err) {
    return {
      '--bg': bg, '--bg-2': bg2, '--surface': sf, '--surface-2': sf2,
      '--line': ln, '--line-soft': lns,
      '--text': tx, '--muted': mu, '--dim': dm,
      '--accent': ac, '--accent-2': a2, '--accent-deep': deep, '--accent-tint': tint,
      '--accent-soft': soft,
      '--glow-1': g1, '--glow-2': g2, '--bar-bg': bar,
      '--ok': ok, '--warn': warn, '--err': err
    };
  }
  var OK = '#34d399', WARN = '#fbbf24', ERR = '#f87171';

  var THEMES = {
    midnight:    { name: 'Midnight',    tokens: t('#0b0a12','#12101c','#171425','#1e1a2e','#2a2440','#221d36','#ece9f6','#9c96b8','#6f6a8a','#8b5cf6','#e879f9','#7c4dff','#ddd3ff','rgba(139,92,246,.16)','rgba(139,92,246,.18)','rgba(232,121,249,.10)','rgba(15,13,25,.94)',OK,WARN,ERR) },
    abyss:       { name: 'Abyss',       tokens: t('#070c14','#0c1220','#101a2c','#16233a','#24344f','#1a2740','#e8eef7','#93a3bc','#64748b','#38bdf8','#2dd4bf','#0ea5e9','#bae6fd','rgba(56,189,248,.16)','rgba(56,189,248,.16)','rgba(45,212,191,.10)','rgba(12,18,32,.94)',OK,WARN,ERR) },
    ember:       { name: 'Ember',       tokens: t('#120c08','#1a120c','#221710','#2b1d14','#422a1c','#33231a','#f6efe9','#b8a294','#8a7568','#f59e0b','#fb7185','#ea580c','#fde68a','rgba(245,158,11,.16)','rgba(245,158,11,.14)','rgba(251,113,133,.10)','rgba(26,18,12,.94)',OK,WARN,ERR) },
    loam:        { name: 'Loam',        tokens: t('#0a120d','#0f1a12','#14221a','#1b2d22','#2a4433','#20362a','#eaf4ee','#9bb8a8','#6c8a7a','#34d399','#a3e635','#059669','#a7f3d0','rgba(52,211,153,.16)','rgba(52,211,153,.15)','rgba(163,230,53,.09)','rgba(15,26,18,.94)','#4ade80',WARN,ERR) },
    'noir-rose': { name: 'Noir Rose',   tokens: t('#120a10','#190e16','#221220','#2c1829','#45263c','#362031','#f8eef4','#bd9cb2','#8d6f81','#fb7185','#f0abfc','#e11d48','#fecdd3','rgba(251,113,133,.16)','rgba(251,113,133,.15)','rgba(240,171,252,.10)','rgba(25,14,22,.94)',OK,WARN,'#fb7185') },
    graphite:    { name: 'Graphite',    tokens: t('#0d0e11','#131519','#191b21','#21242c','#323641','#262a33','#e8eaee','#9aa0ad','#6b7280','#3b82f6','#94a3b8','#2563eb','#bfdbfe','rgba(59,130,246,.16)','rgba(59,130,246,.15)','rgba(148,163,184,.08)','rgba(19,21,25,.94)',OK,WARN,ERR) },
    ultramarine: { name: 'Ultramarine', tokens: t('#0a0a1c','#101028','#16163a','#1e1e4a','#32326b','#26265a','#e9e9ff','#9d9dd4','#6d6da6','#6366f1','#22d3ee','#4f46e5','#c7d2fe','rgba(99,102,241,.16)','rgba(99,102,241,.20)','rgba(34,211,238,.10)','rgba(16,16,40,.94)',OK,WARN,ERR) },
    crimson:     { name: 'Crimson',     tokens: t('#150a0c','#1d0e11','#271216','#32191f','#4d252e','#3d1e25','#f9ecef','#c29aa4','#94707b','#ef4444','#fb923c','#dc2626','#fecaca','rgba(239,68,68,.16)','rgba(239,68,68,.14)','rgba(251,146,60,.10)','rgba(29,14,17,.94)',OK,WARN,ERR) },
    gilded:      { name: 'Gilded',      tokens: t('#100e0a','#17140d','#201c12','#2a2517','#443c26','#362f1e','#f5f0e3','#b3a88c','#857c64','#eab308','#f59e0b','#ca8a04','#fde68a','rgba(234,179,8,.16)','rgba(234,179,8,.14)','rgba(251,191,36,.08)','rgba(23,20,13,.94)',OK,WARN,ERR) },
    sunset:      { name: 'Sunset',      tokens: t('#170a13','#1f0f1b','#2a1322','#35192c','#522842','#422035','#fbeef4','#c49aae','#97708a','#fb923c','#f43f5e','#f97316','#fed7aa','rgba(251,146,60,.16)','rgba(251,146,60,.14)','rgba(244,63,94,.10)','rgba(31,15,27,.94)',OK,WARN,'#fb7185') },
    frost:       { name: 'Frost',       tokens: t('#0b1116','#101720','#16202b','#1d2937','#2e4052','#243343','#eaf2f7','#9fb4c4','#6e8496','#93c5fd','#67e8f9','#60a5fa','#dbeafe','rgba(147,197,253,.14)','rgba(147,197,253,.12)','rgba(103,232,249,.08)','rgba(16,23,32,.94)',OK,WARN,ERR) },
    coral:       { name: 'Coral',       tokens: t('#0a1018','#0e1521','#141e2e','#1a2739','#2c4258','#223448','#e9f1f7','#96aabf','#68809a','#f97362','#2dd4bf','#ea580c','#fed7aa','rgba(249,115,98,.16)','rgba(249,115,98,.14)','rgba(45,212,191,.10)','rgba(14,21,33,.94)',OK,WARN,ERR) },
    carbon:      { name: 'Carbon',      tokens: t('#08080a','#0e0e11','#151518','#1c1c21','#2c2c33','#232329','#ececee','#9b9ba5','#6f6f7a','#facc15','#a3a3a3','#eab308','#fef08a','rgba(250,204,21,.14)','rgba(250,204,21,.12)','rgba(163,163,163,.07)','rgba(14,14,17,.94)',OK,WARN,ERR) }
  };

  function apply(name) {
    var theme = THEMES[name] || THEMES.midnight;
    var el = document.documentElement;
    Object.keys(theme.tokens).forEach(function (k) {
      el.style.setProperty(k, theme.tokens[k]);
    });
    return theme;
  }

  global.THEMES = {
    list: function () { return Object.keys(THEMES); },
    get: function (name) { return THEMES[name] || THEMES.midnight; },
    apply: apply
  };
})(window);
