#!/usr/bin/env node
/**
 * Configures the generated Capacitor Android project:
 * 1. Enables cleartext HTTP in AndroidManifest.xml (for local LAN LLM proxies).
 * 2. Registers TalkPrintBridge (Android PrintManager) in MainActivity.java so
 *    Intensive Reader PDF export works natively inside the APK WebView.
 * 3. Copies icons/icon-512.png into mipmap launcher icons if present.
 */
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
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

// 3. Copy app icon into mipmap-xxxhdpi
const srcIcon = path.join(ROOT, "icons/icon-512.png");
if (existsSync(srcIcon)) {
  const targetDir = path.join(ANDROID, "app/src/main/res/mipmap-xxxhdpi");
  await mkdir(targetDir, { recursive: true });
  await copyFile(srcIcon, path.join(targetDir, "ic_launcher.png"));
  await copyFile(srcIcon, path.join(targetDir, "ic_launcher_round.png"));
  console.log("Copied app icon into mipmap-xxxhdpi");
}
