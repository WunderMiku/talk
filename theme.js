/* talk. — theme registry. Add a CSS [data-theme] block, then register it here. */
(function () {
  const STORAGE_KEY = "talk.theme.v1";
  const themes = {
    paper: {
      id: "paper",
      label: "Paper",
      themeColor: "#f3f0e7"
    },
    constructivist: {
      id: "constructivist",
      label: "USSR",
      themeColor: "#d23b2f"
    },
    rhine: {
      id: "rhine",
      label: "Rhine Lab",
      themeColor: "#e7e3da"
    }
  };

  function current() {
    const id = document.documentElement.dataset.theme || "paper";
    return themes[id] || themes.paper;
  }

  function apply(id) {
    const theme = themes[id] || themes.paper;
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

  window.TALK_THEME = { themes, current, apply };
})();
