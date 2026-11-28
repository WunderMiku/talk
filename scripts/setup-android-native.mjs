#!/usr/bin/env node
/**
 * Configures the generated Capacitor Android project:
 * 1. Enables cleartext HTTP in AndroidManifest.xml (for local LAN LLM proxies).
 * 2. Registers TalkPrintBridge (Android PrintManager) in MainActivity.java so
 *    Intensive Reader PDF export works natively inside the APK WebView.
 * 3. Copies icons/icon-512.png into mipmap launcher icons if present.
 */
import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ANDROID = path.join(ROOT, "android");

if (!existsSync(ANDROID)) {
  console.error("android/ directory not found. Run `npx cap add android` first.");
  process.exit(1);
}

// 1. AndroidManifest.xml — allow cleartext local LAN API endpoints
const manifestPath = path.join(ANDROID, "app/src/main/AndroidManifest.xml");
let manifest = await readFile(manifestPath, "utf8");
if (!manifest.includes("android.permission.VIBRATE")) {
  manifest = manifest.replace(/<manifest[^>]*>/, (tag) => `${tag}\n    <uses-permission android:name="android.permission.VIBRATE" />`);
  await writeFile(manifestPath, manifest, "utf8");
  console.log("Patched AndroidManifest.xml (VIBRATE permission)");
}

if (!manifest.includes("usesCleartextTraffic")) {
  manifest = manifest.replace("<application", '<application\n        android:usesCleartextTraffic="true"');
  await writeFile(manifestPath, manifest, "utf8");
  console.log("Patched AndroidManifest.xml (usesCleartextTraffic=true)");
}

// 2. MainActivity.java — transparent bottom gesture bar + safe-area insets + PrintManager bridge
const mainActPath = path.join(ANDROID, "app/src/main/java/app/wundermiku/talk/MainActivity.java");
if (existsSync(mainActPath)) {
  const javaCode = `package app.wundermiku.talk;

import android.content.Context;
import android.graphics.Color;
import android.os.Build;
import android.os.Bundle;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.print.PrintAttributes;
import android.print.PrintDocumentAdapter;
import android.print.PrintManager;
import android.view.View;
import android.view.Window;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    private int lastBottomDp = 0;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        Window window = getWindow();
        WindowCompat.setDecorFitsSystemWindows(window, false);
        window.setNavigationBarColor(Color.TRANSPARENT);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            window.setNavigationBarContrastEnforced(false);
        }

        View content = findViewById(android.R.id.content);
        if (content != null) {
            ViewCompat.setOnApplyWindowInsetsListener(content, (view, windowInsets) -> {
                Insets bars = windowInsets.getInsets(
                    WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout()
                );
                // Keep top safely below status bar / punch-hole, let canvas bleed behind bottom gesture bar.
                view.setPadding(bars.left, bars.top, bars.right, 0);
                float density = getResources().getDisplayMetrics().density;
                lastBottomDp = Math.round(bars.bottom / Math.max(density, 1f));
                pushSafeBottom();
                return WindowInsetsCompat.CONSUMED;
            });
            ViewCompat.requestApplyInsets(content);
        }

        if (this.bridge != null && this.bridge.getWebView() != null) {
            WebView wv = this.bridge.getWebView();
            wv.addJavascriptInterface(new TalkPrintBridge(), "TalkPrintBridge");
            wv.addJavascriptInterface(new TalkSystemBars(), "TalkSystemBars");
            wv.addJavascriptInterface(new TalkHaptics(), "TalkHaptics");
        }
    }

    @Override
    public void onResume() {
        super.onResume();
        View content = findViewById(android.R.id.content);
        if (content != null) {
            ViewCompat.requestApplyInsets(content);
            content.invalidate();
        }
        WebView webView = bridge != null ? bridge.getWebView() : null;
        if (webView != null) {
            webView.onResume();
            webView.resumeTimers();
            webView.post(() -> {
                webView.invalidate();
                webView.requestLayout();
                webView.evaluateJavascript(
                    "window.dispatchEvent(new Event('talk:native-resume'));",
                    null
                );
            });
            pushSafeBottom();
        }
    }

    private void pushSafeBottom() {
        WebView webView = bridge != null ? bridge.getWebView() : null;
        if (webView == null) return;
        final String js = "document.documentElement.style.setProperty('--native-safe-bottom','" + lastBottomDp + "px');";
        webView.post(() -> webView.evaluateJavascript(js, null));
    }

    private class TalkHaptics {
        @JavascriptInterface
        public void tick() {
            tick(9);
        }

        @JavascriptInterface
        public void tick(final int ms) {
            runOnUiThread(() -> {
                try {
                    Vibrator v = (Vibrator) getSystemService(Context.VIBRATOR_SERVICE);
                    if (v == null || !v.hasVibrator()) return;
                    int duration = Math.max(4, Math.min(ms, 24));
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                        v.vibrate(VibrationEffect.createOneShot(duration, VibrationEffect.DEFAULT_AMPLITUDE));
                    } else {
                        v.vibrate(duration);
                    }
                } catch (Exception ignored) { }
            });
        }
    }

    private class TalkSystemBars {
        @JavascriptInterface
        public void sync(final String colorHex, final boolean isDark) {
            runOnUiThread(() -> {
                Window window = getWindow();
                try {
                    int parsed = Color.parseColor(colorHex != null ? colorHex.trim() : "#F3F0E7");
                    window.setStatusBarColor(parsed);
                    window.getDecorView().setBackgroundColor(parsed);
                } catch (IllegalArgumentException ignored) { }
                window.setNavigationBarColor(Color.TRANSPARENT);
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    window.setNavigationBarContrastEnforced(false);
                }
                WindowInsetsControllerCompat controller = WindowCompat.getInsetsController(window, window.getDecorView());
                if (controller != null) {
                    controller.setAppearanceLightStatusBars(!isDark);
                    controller.setAppearanceLightNavigationBars(!isDark);
                }
                pushSafeBottom();
            });
        }
    }

    private class TalkPrintBridge {
        @JavascriptInterface
        public void print(final String jobName) {
            runOnUiThread(() -> {
                WebView webView = bridge != null ? bridge.getWebView() : null;
                if (webView == null) return;
                PrintManager pm = (PrintManager) getSystemService(Context.PRINT_SERVICE);
                if (pm == null) return;
                String name = (jobName != null && !jobName.trim().isEmpty()) ? jobName.trim() : "talk-reader";
                PrintDocumentAdapter adapter = webView.createPrintDocumentAdapter(name);
                PrintAttributes attrs = new PrintAttributes.Builder()
                    .setMediaSize(PrintAttributes.MediaSize.ISO_A4)
                    .setMinMargins(PrintAttributes.Margins.NO_MARGINS)
                    .build();
                pm.print(name, adapter, attrs);
            });
        }
    }
}
`;
  await writeFile(mainActPath, javaCode, "utf8");
  console.log("Patched MainActivity.java (Edge-to-Edge nav + TalkPrintBridge)");
}

// 3. Replace ALL Android launcher icons (including API 26+ Adaptive Icons)
//    Per-density assets live in icons/android/<density>/ and are regenerated
//    offline; copying one 512px bitmap into every bucket makes the launcher
//    scale it by density and shows a different crop than the app info page.
const srcIcon = path.join(ROOT, "icons/icon-512.png");
const iconDensities = ["mdpi", "hdpi", "xhdpi", "xxhdpi", "xxxhdpi"];
const resDir = path.join(ANDROID, "app/src/main/res");

if (existsSync(srcIcon)) {
  for (const density of iconDensities) {
    const dir = path.join(resDir, `mipmap-${density}`);
    await mkdir(dir, { recursive: true });
    const set = path.join(ROOT, "icons", "android", density);
    const legacy = existsSync(path.join(set, "ic_launcher.png"))
      ? path.join(set, "ic_launcher.png")
      : srcIcon;
    const foreground = existsSync(path.join(set, "ic_launcher_foreground.png"))
      ? path.join(set, "ic_launcher_foreground.png")
      : legacy;
    await copyFile(legacy, path.join(dir, "ic_launcher.png"));
    await copyFile(legacy, path.join(dir, "ic_launcher_round.png"));
    await copyFile(foreground, path.join(dir, "ic_launcher_foreground.png"));
    const background = existsSync(path.join(set, "ic_launcher_background.png"))
      ? path.join(set, "ic_launcher_background.png")
      : null;
    if (background) await copyFile(background, path.join(dir, "ic_launcher_background.png"));
  }

  // Remove any default Capacitor vector foreground/background XMLs that could shadow our PNGs
  for (const stale of [
    "drawable/ic_launcher_foreground.xml",
    "drawable-v24/ic_launcher_foreground.xml",
    "drawable/ic_launcher_background.xml"
  ]) {
    await rm(path.join(resDir, stale), { force: true });
  }

  // Adaptive background must be the icon's own ink, not the paper colour.
  const valuesDir = path.join(resDir, "values");
  await mkdir(valuesDir, { recursive: true });
  await writeFile(
    path.join(valuesDir, "ic_launcher_background.xml"),
    `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <color name="ic_launcher_background">#141414</color>
</resources>
`,
    "utf8"
  );

  // Point API 26+ Adaptive Icons at the transparent foreground + ink background.
  const anydpiDir = path.join(resDir, "mipmap-anydpi-v26");
  await mkdir(anydpiDir, { recursive: true });
  const adaptiveXml = `<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@mipmap/ic_launcher_background"/>
    <foreground android:drawable="@mipmap/ic_launcher_foreground"/>
</adaptive-icon>
`;
  await writeFile(path.join(anydpiDir, "ic_launcher.xml"), adaptiveXml, "utf8");
  await writeFile(path.join(anydpiDir, "ic_launcher_round.xml"), adaptiveXml, "utf8");
  console.log("Replaced all Android mipmap & API 26+ Adaptive Icons");
}

// 4. Optional channel isolation & build versioning (e.g. TALK_APP_SUFFIX=neo, TALK_BUILD=295).
//    Keeps Gradle `namespace` at app.wundermiku.talk so MainActivity.java stays untouched while
//    giving channel APKs a distinct applicationId, launcher label, and FileProvider authority so
//    they install side-by-side with the production app without overwriting it.
const rawSuffix = String(process.env.TALK_APP_SUFFIX || "").trim().toLowerCase();
const appSuffix = rawSuffix.replace(/[^a-z0-9]/g, "");
const buildNum = Number.parseInt(String(process.env.TALK_BUILD || "").trim(), 10);

if (appSuffix || Number.isInteger(buildNum) && buildNum > 0) {
  const baseAppId = "app.wundermiku.talk";
  const targetAppId = appSuffix ? `${baseAppId}.${appSuffix}` : baseAppId;
  const targetAppName = appSuffix ? `talk. ${appSuffix}` : "talk.";

  const gradlePath = path.join(ANDROID, "app/build.gradle");
  if (existsSync(gradlePath)) {
    let gradle = await readFile(gradlePath, "utf8");
    if (appSuffix) {
      gradle = gradle.replace(/applicationId\s+"[^"]+"/, `applicationId "${targetAppId}"`);
    }
    if (Number.isInteger(buildNum) && buildNum > 0) {
      gradle = gradle.replace(/versionCode\s+\d+/, `versionCode ${buildNum}`);
      const versionName = appSuffix ? `1.0.${buildNum}-${appSuffix}` : `1.0.${buildNum}`;
      gradle = gradle.replace(/versionName\s+"[^"]+"/, `versionName "${versionName}"`);
    } else if (appSuffix) {
      gradle = gradle.replace(/versionName\s+"([^"]+)"/, (_, cur) => `versionName "${cur}-${appSuffix}"`);
    }
    await writeFile(gradlePath, gradle, "utf8");
    console.log(`Patched build.gradle (applicationId=${targetAppId}${Number.isInteger(buildNum) && buildNum > 0 ? `, versionCode=${buildNum}` : ""})`);
  }

  if (appSuffix) {
    const stringsPath = path.join(ANDROID, "app/src/main/res/values/strings.xml");
    if (existsSync(stringsPath)) {
      let stringsXml = await readFile(stringsPath, "utf8");
      stringsXml = stringsXml
        .replace(/(<string name="app_name">)[^<]*(<\/string>)/, `$1${targetAppName}$2`)
        .replace(/(<string name="title_activity_main">)[^<]*(<\/string>)/, `$1${targetAppName}$2`)
        .replace(/(<string name="package_name">)[^<]*(<\/string>)/, `$1${targetAppId}$2`)
        .replace(/(<string name="custom_url_scheme">)[^<]*(<\/string>)/, `$1${targetAppId}$2`);
      await writeFile(stringsPath, stringsXml, "utf8");
      console.log(`Patched strings.xml (app_name=${targetAppName}, package_name=${targetAppId})`);
    }

    const assetConfigPath = path.join(ANDROID, "app/src/main/assets/capacitor.config.json");
    if (existsSync(assetConfigPath)) {
      const capCfg = JSON.parse(await readFile(assetConfigPath, "utf8"));
      capCfg.appId = targetAppId;
      capCfg.appName = targetAppName;
      await writeFile(assetConfigPath, `${JSON.stringify(capCfg, null, 2)}\n`, "utf8");
      console.log(`Patched assets/capacitor.config.json (appId=${targetAppId}, appName=${targetAppName})`);
    }
  }
}

