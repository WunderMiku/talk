/* talk. — optional Capacitor Android native bridge (no-op in standard browsers) */
(function () {
  "use strict";
  const cap = window.Capacitor;
  if (!cap || !cap.isNativePlatform || !cap.isNativePlatform()) return;

  document.documentElement.classList.add("is-native-app");

  // Local assets are bundled inside the APK; skip browser Service Worker registration.
  if ("serviceWorker" in navigator) {
    try {
      Object.defineProperty(navigator.serviceWorker, "register", {
        value: () => Promise.resolve(null),
        configurable: true
      });
    } catch (_) { /* ignore */ }
  }

  // Native Android PrintManager bridge for Intensive Reader PDF export.
  window.TALK_NATIVE_PRINT = function (title) {
    if (window.TalkPrintBridge && typeof window.TalkPrintBridge.print === "function") {
      window.TalkPrintBridge.print(String(title || document.title || "talk-reader"));
      return true;
    }
    return false;
  };

  // Sync Android StatusBar + transparent bottom gesture bar with active talk. theme.
  function syncStatusBar() {
    const theme = window.TALK_THEME?.current?.();
    const color = theme?.themeColor || "#f3f0e7";
    const isDark = /^#([0-3]|4[0-5])/i.test(color.trim());
    if (window.TalkSystemBars && typeof window.TalkSystemBars.sync === "function") {
      window.TalkSystemBars.sync(color, isDark);
      return;
    }
    const sb = cap.Plugins?.StatusBar;
    if (!sb) return;
    sb.setBackgroundColor?.({ color }).catch?.(() => {});
    sb.setStyle?.({ style: isDark ? "DARK" : "LIGHT" }).catch?.(() => {});
  }

  // Handle Android hardware / gesture back button gracefully.
  const appPlugin = cap.Plugins?.App;
  if (appPlugin?.addListener) {
    appPlugin.addListener("backButton", () => {
      const overlayClose = document.querySelector("#overlay-root [data-action='close-sheet'], #overlay-root .sheet-close");
      if (overlayClose) {
        overlayClose.click();
        return;
      }
      const workspaceClose = document.querySelector("#workspace-root [data-action='close-workspace']");
      if (workspaceClose) {
        workspaceClose.click();
        return;
      }
      const layerClose = document.querySelector(
        "#layer-root .word-layer:not(.is-closing):last-of-type [data-action='layer-back'], "
        + "#layer-root .word-layer:not(.is-closing):last-of-type [data-action='close-layer'], "
        + "#layer-root .word-layer:not(.is-closing):last-of-type .back-btn"
      );
      if (layerClose) {
        layerClose.click();
        return;
      }
      const hash = location.hash || "#/";
      if (hash !== "#/" && hash !== "#" && hash !== "") {
        history.back();
        return;
      }
      appPlugin.exitApp?.();
    });
  }

  // Force a 1-frame GPU compositor repaint when returning from Android background
  // so WebView never stays visually blank until the first touch event.
  // Avoid mutating transform on <html> because transform creates a containing block
  // that shifts position:fixed elements (composer bar, toasts) for one frame.
  let resumeTimer = 0;
  function kickRepaint() {
    window.clearTimeout(resumeTimer);
    resumeTimer = window.setTimeout(() => {
      syncStatusBar();
      const target = document.body;
      if (target) {
        const prevOpacity = target.style.opacity;
        target.style.opacity = "0.9999";
        window.requestAnimationFrame(() => {
          target.style.opacity = prevOpacity;
          window.dispatchEvent(new Event("resize"));
        });
      } else {
        window.dispatchEvent(new Event("resize"));
      }
    }, 32);
  }

  if (appPlugin?.addListener) {
    appPlugin.addListener("appStateChange", (state) => {
      if (state && state.isActive) kickRepaint();
    });
  }
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) kickRepaint();
  });
  window.addEventListener("pageshow", (event) => {
    if (event.persisted) kickRepaint();
  });
  window.addEventListener("talk:native-resume", kickRepaint);

  window.addEventListener("DOMContentLoaded", () => {
    syncStatusBar();
    const obs = new MutationObserver(syncStatusBar);
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  });
})();
