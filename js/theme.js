/* talk. — theme registry.
 *
 * One entry per theme. Everything the app needs to know about a theme lives
 * here: the label it shows, the browser chrome colour, the stylesheet that
 * carries its overrides, and which copy block gives it a voice.
 *
 * Adding a theme:
 *   1. create css/themes/<id>.css with a [data-theme="<id>"] block
 *   2. add css/themes/<id>.css to index.html and to the SHELL list in sw.js
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
      accent: "#557000",
      accentFill: "#d9ff6b",
      // Paper is the base token set in theme.css, so it ships no own file.
      css: null,
      copyKey: null,
      description: "现代海报：米白纸面",
      exampleStyle: "干净利落的现代书面英语"
    },
    constructivist: {
      id: "constructivist",
      label: "Constructivist",
      themeColor: "#d23b2f",
      accent: "#9e1f18",
      accentFill: "#d23b2f",
      css: "css/themes/constructivist.css",
      copyKey: "constructivist",
      description: "构成主义：粗斜切块与几何标语",
      exampleStyle: "口号式、短促有力的英语"
    },
    "swiss-lab": {
      id: "swiss-lab",
      label: "Swiss Lab",
      themeColor: "#e7e3da",
      accent: "#8f451f",
      accentFill: "#c46a3b",
      css: "css/themes/swiss-lab.css",
      copyKey: "swiss-lab",
      description: "安静的实验室：细线、刻度与观察记录",
      exampleStyle: "冷静、精确的观察记录式英语"
    },
    "topo-acid": {
      id: "topo-acid",
      label: "Topo Acid",
      themeColor: "#f4f4f2",
      accent: "#6f6100",
      accentFill: "#fffa00",
      css: "css/themes/topo-acid.css",
      copyKey: "topo-acid",
      description: "工业终端：纸白底、切角与唯一一种信号黄",
      exampleStyle: "工程说明与现场记录式英语"
    },
    "archive-grid": {
      id: "archive-grid",
      label: "Archive Grid",
      themeColor: "#f2f0ea",
      accent: "#4f6500",
      accentFill: "#c8f000",
      css: "css/themes/archive-grid.css",
      copyKey: "archive-grid",
      description: "实验记录终端：纸白、细线窗口与唯一一种酸性绿",
      exampleStyle: "实验室运行记录式英语"
    },
    "retro-stub": {
      id: "retro-stub",
      label: "Retro Stub",
      themeColor: "#f1e6cb",
      accent: "#2f6f6a",
      accentFill: "#be3a28",
      css: "css/themes/retro-stub.css",
      copyKey: "retro-stub",
      description: "票根拼贴：米纸、墨线、检票章与一条虚线路线",
      exampleStyle: "旅途与票根口吻的英语"
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
