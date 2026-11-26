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
if (!manifest.includes("usesCleartextTraffic")) {
  manifest = manifest.replace("<application", '<application\n        android:usesCleartextTraffic="true"');
  await writeFile(manifestPath, manifest, "utf8");
  console.log("Patched AndroidManifest.xml (usesCleartextTraffic=true)");
}

// 2. MainActivity.java — register Android PrintManager JS bridge
const mainActPath = path.join(ANDROID, "app/src/main/java/app/wundermiku/talk/MainActivity.java");
if (existsSync(mainActPath)) {
  const javaCode = `package app.wundermiku.talk;

import android.content.Context;
import android.os.Bundle;
import android.print.PrintAttributes;
import android.print.PrintDocumentAdapter;
import android.print.PrintManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        if (this.bridge != null && this.bridge.getWebView() != null) {
            this.bridge.getWebView().addJavascriptInterface(new TalkPrintBridge(), "TalkPrintBridge");
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
  console.log("Patched MainActivity.java (TalkPrintBridge)");
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
