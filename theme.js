/* talk. — theme registry.
 *
 * One entry per theme. Everything the app needs to know about a theme lives
 * here: the label it shows, the browser chrome colour, the stylesheet that
 * carries its overrides, and which copy block gives it a voice.
 *
 * Adding a theme:
 *   1. create themes/<id>.css with a [data-theme="<id>"] block
 *   2. add themes/<id>.css to index.html and to the SHELL list in sw.js
 *   3. register the entry below (css + copyKey + label + accent)
 *   4. add a TALK_CONTENT.themeCopy[<id>] block when it needs its own voice
 */
(function () {
  const STORAGE_KEY = "talk.theme.v1";
  const DEFAULT_THEME = "paper";

  const themes = {
    paper: {
      id: "paper",
      label: "Paper",
      themeColor: "#f3f0e7",
      accent: "#b9e63b",
      // Paper is the base token set in theme.css, so it ships no own file.
      css: null,
      copyKey: null,
      description: "现代海报：米白纸面，荧光绿与珊瑚红"
    },
    constructivist: {
      id: "constructivist",
      label: "USSR",
      themeColor: "#d23b2f",
      accent: "#d23b2f",
      css: "themes/ussr.css",
      copyKey: "constructivist",
      description: "俄式构成主义：粗斜切块与标语"
    },
    rhine: {
      id: "rhine",
      label: "Rhine Lab",
      themeColor: "#e7e3da",
      accent: "#c46a3b",
      css: "themes/rhine.css",
      copyKey: "rhine",
      description: "安静的实验室：细线、刻度与观察记录"
    }
  };

  function list() {
    return Object.values(themes);
  }

  function metaOf(id) {
    return themes[id] || themes[DEFAULT_THEME];
  }

  function current() {
    return metaOf(document.documentElement.dataset.theme);
  }

  // Guard against a registry entry whose stylesheet was never linked from
  // index.html: inject it once instead of silently losing its overrides.
  function ensureStyles(theme) {
    if (!theme.css) return;
    const href = theme.css;
    const linked = Array.prototype.some.call(
      document.querySelectorAll('link[rel="stylesheet"]'),
      (link) => (link.getAttribute("href") || "").split("?")[0] === href
    );
    if (linked) return;
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = href;
    link.dataset.themeStyles = theme.id;
    document.head.appendChild(link);
  }

  function apply(id) {
    const theme = metaOf(id);
    ensureStyles(theme);
    document.documentElement.dataset.theme = theme.id;
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", theme.themeColor);
    try { localStorage.setItem(STORAGE_KEY, theme.id); } catch (_) { /* no-op */ }
    return theme;
  }

  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved && themes[saved]) apply(saved);
  } catch (_) { /* no-op */ }

  window.TALK_THEME = {
    themes,
    list,
    metaOf,
    current,
    apply,
    DEFAULT_THEME
  };
})();
