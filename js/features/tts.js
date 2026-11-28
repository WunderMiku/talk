/* ============================================================
   talk. — Speech synthesis (System native + Qwen TTS) & audio cache
   ============================================================ */

import { $, $$, detectSourceLanguage, secureRemoteUrl } from "../core/utils.js";

const SILENT_AUDIO = "data:audio/wav;base64,UklGRsQAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YaAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const AUDIO_DB_NAME = "talk.audio.v1";
const AUDIO_DB_STORE = "audio";
const AUDIO_CACHE_VERSION = "v4";

export function isQwenProfile(profile = {}) {
  return profile.id === "qwen" || /qianwenaiapi|dashscope|qwencloudapi/i.test(profile.baseUrl || "");
}

export function qwenTtsProfile(cfg) {
  const profiles = (cfg?.profiles || []).filter((profile) => profile.apiKey && isQwenProfile(profile));
  if (!profiles.length) return null;
  return profiles.find((profile) => profile.id === cfg.activeProfileId)
    || profiles.find((profile) => profile.id === "qwen")
    || profiles[0];
}

export function qwenTtsEndpoint(profile, model = "") {
  const base = String(profile?.baseUrl || "").trim();
  if (!base) return "";
  try {
    const origin = secureRemoteUrl(new URL(base).origin);
    // Qwen3-TTS uses the multimodal generation route; Qwen-Audio-TTS uses
    // the dedicated non-realtime speech route.
    const path = /^qwen3-tts/i.test(String(model || ""))
      ? "/api/v1/services/aigc/multimodal-generation/generation"
      : "/api/v1/services/audio/tts/SpeechSynthesizer";
    return `${origin}${path}`;
  } catch (_) {
    return "";
  }
}

export function createTtsController({ state, usableApiKey, toast }) {
  let currentAudio = null;
  let ttsAudio = null;
  let lastTtsError = "";

  function primeAudio() {
    if (!ttsAudio) {
      ttsAudio = new Audio();
      ttsAudio.preload = "auto";
    }
    if (!ttsAudio.dataset.primed) {
      ttsAudio.dataset.primed = "1";
      ttsAudio.src = SILENT_AUDIO;
      const attempt = ttsAudio.play();
      if (attempt) attempt.catch(() => { /* The first click may be silent. */ });
    }
  }

  function stopSpeech() {
    if (currentAudio) {
      const audio = currentAudio;
      currentAudio = null;
      try { audio.pause(); } catch (_) { /* no-op */ }
      if (audio.dataset.url) URL.revokeObjectURL(audio.dataset.url);
    }
    if ("speechSynthesis" in window) window.speechSynthesis.cancel();
    $$(".is-speaking, .is-loading").forEach((item) => {
      item.classList.remove("is-speaking", "is-loading");
      item.removeAttribute("aria-busy");
    });
  }

  function setTtsLoading(button, loading) {
    if (!button) return;
    button.classList.toggle("is-loading", loading);
    if (loading) button.setAttribute("aria-busy", "true");
    else button.removeAttribute("aria-busy");
  }

  function pickSystemVoice() {
    if (!("speechSynthesis" in window)) return null;
    const voices = window.speechSynthesis.getVoices()
      .filter((voice) => /^en([-_]|$)/i.test(voice.lang) || /English/i.test(voice.name));
    const patterns = [
      /Microsoft.*(Aria|Jenny|Guy|Sonia|Ryan).*(Natural|Online)/i,
      /Microsoft.*(Aria|Jenny|Guy|Sonia|Ryan)/i,
      /Google US English/i,
      /Samantha/i,
      /Ava/i,
      /Microsoft.*English/i,
      /en-US/i
    ];
    for (const pattern of patterns) {
      const found = voices.find((voice) => pattern.test(voice.name) || pattern.test(voice.lang));
      if (found) return found;
    }
    return null;
  }

  function speakSystem(text, button) {
    if (!("speechSynthesis" in window)) return "system";
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "en-US";
    utterance.rate = 0.92;
    utterance.pitch = 1;
    const voice = pickSystemVoice();
    if (voice) utterance.voice = voice;
    if (button) {
      button.classList.add("is-speaking");
      utterance.onend = () => button.classList.remove("is-speaking");
      utterance.onerror = () => button.classList.remove("is-speaking");
    }
    window.speechSynthesis.speak(utterance);
    return "system";
  }

  async function playAudioBlob(blob, button) {
    if (!blob.size) throw new Error("语音接口返回了空音频。");
    const url = URL.createObjectURL(blob);
    const audio = ttsAudio || new Audio();
    ttsAudio = audio;
    try { audio.pause(); } catch (_) { /* no-op */ }
    if (audio.dataset.url) URL.revokeObjectURL(audio.dataset.url);
    audio.src = url;
    audio.dataset.url = url;
    currentAudio = audio;
    if (button) button.classList.add("is-speaking");
    const cleanup = () => {
      if (button) button.classList.remove("is-speaking");
      if (currentAudio === audio) currentAudio = null;
      URL.revokeObjectURL(url);
    };
    audio.onended = cleanup;
    audio.onerror = cleanup;
    try {
      await audio.play();
    } catch (error) {
      cleanup();
      throw error;
    }
  }

  async function playAudioUrl(url, button) {
    if (!url) throw new Error("语音接口没有返回音频地址。");
    url = secureRemoteUrl(url);
    const audio = ttsAudio || new Audio();
    ttsAudio = audio;
    try { audio.pause(); } catch (_) { /* no-op */ }
    if (audio.dataset.url) {
      URL.revokeObjectURL(audio.dataset.url);
      delete audio.dataset.url;
    }
    audio.src = url;
    currentAudio = audio;
    if (button) button.classList.add("is-speaking");
    const cleanup = () => {
      if (button) button.classList.remove("is-speaking");
      if (currentAudio === audio) currentAudio = null;
    };
    audio.onended = cleanup;
    audio.onerror = cleanup;
    try {
      await audio.play();
    } catch (error) {
      cleanup();
      throw error;
    }
    return "qwen-url";
  }

  function base64ToBlob(data, type = "audio/mpeg") {
    const raw = String(data || "").includes(",") ? String(data).split(",").pop() : String(data || "");
    const binary = atob(raw);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new Blob([bytes], { type });
  }

  function openAudioDb() {
    return new Promise((resolve, reject) => {
      if (!("indexedDB" in window)) {
        reject(new Error("IndexedDB unavailable"));
        return;
      }
      const request = indexedDB.open(AUDIO_DB_NAME, 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(AUDIO_DB_STORE)) db.createObjectStore(AUDIO_DB_STORE);
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async function getCachedAudio(key) {
    try {
      const db = await openAudioDb();
      return await new Promise((resolve) => {
        const request = db.transaction(AUDIO_DB_STORE, "readonly").objectStore(AUDIO_DB_STORE).get(key);
        request.onsuccess = () => resolve(request.result?.blob || null);
        request.onerror = () => resolve(null);
      });
    } catch (_) {
      return null;
    }
  }

  async function getAudioStats() {
    try {
      const db = await openAudioDb();
      const records = await new Promise((resolve) => {
        const req = db.transaction(AUDIO_DB_STORE, "readonly").objectStore(AUDIO_DB_STORE).getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => resolve([]);
      });
      return {
        count: records.length,
        bytes: records.reduce((sum, record) => sum + (record?.blob?.size || 0), 0),
        latest: records
          .filter((record) => record?.at)
          .sort((a, b) => Number(b.at) - Number(a.at))
          .slice(0, 8)
          .map((record) => ({ at: Number(record.at), bytes: record?.blob?.size || 0 }))
      };
    } catch (_) {
      return { count: 0, bytes: 0, latest: [] };
    }
  }

  async function clearAudioCache() {
    try {
      const db = await openAudioDb();
      await new Promise((resolve) => {
        const tx = db.transaction(AUDIO_DB_STORE, "readwrite");
        tx.objectStore(AUDIO_DB_STORE).clear();
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      });
    } catch (_) {
      // Ignore unavailable storage.
    }
  }

  async function putCachedAudio(key, blob) {
    try {
      const db = await openAudioDb();
      await new Promise((resolve, reject) => {
        const tx = db.transaction(AUDIO_DB_STORE, "readwrite");
        tx.objectStore(AUDIO_DB_STORE).put({ blob, at: Date.now() }, key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    } catch (_) {
      // Cache failures must never block playback.
    }
  }

  async function speakQwen(text, button, cfg, { bypassCache = false } = {}) {
    const profile = qwenTtsProfile(cfg);
    if (!profile) throw new Error("还没有可用的 Qwen API 密钥，请先在模型设置里填写。");
    const model = String(cfg.qwenTtsModel || "qwen-audio-3.1-tts-plus").trim();
    const endpoint = qwenTtsEndpoint(profile, model);
    if (!endpoint) throw new Error("Qwen API 地址为空，无法定位语音接口。");
    const isQwen3 = /^qwen3-tts/i.test(model);
    let voice = String(cfg.qwenTtsVoice || "").trim();
    if (isQwen3 && (!voice || /^longanhuan/i.test(voice))) voice = "Cherry";
    if (!voice) voice = "longanhuan_v3.1";
    const cacheKey = `qwen|${model}|${voice}|${text}|${AUDIO_CACHE_VERSION}`;
    if (!bypassCache) {
      const cached = await getCachedAudio(cacheKey);
      if (cached) {
        await playAudioBlob(cached, button);
        return "qwen-cache";
      }
    }
    const ttsTimeoutMs = 30_000;
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), ttsTimeoutMs);
    let response;
    let raw;
    try {
      response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${usableApiKey(profile.apiKey)}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model,
          input: isQwen3
            ? {
                text,
                voice,
                language_type: detectSourceLanguage(text) === "zh" ? "Chinese" : "English"
              }
            : {
                text,
                voice,
                format: "mp3",
                sample_rate: 24000
              }
        }),
        signal: controller.signal
      });
      raw = await response.text();
    } catch (error) {
      if (error?.name === "AbortError") throw new Error(`Qwen 语音请求超过 ${ttsTimeoutMs / 1000} 秒，已中断。`);
      throw error;
    } finally {
      window.clearTimeout(timer);
    }
    let payload = null;
    try { payload = raw ? JSON.parse(raw) : null; } catch (_) { /* handled below */ }
    if (!response.ok || !payload) {
      const message = payload?.message || payload?.code || raw.slice(0, 180) || `HTTP ${response.status}`;
      throw new Error(`Qwen 语音失败：${message}`);
    }
    const audio = payload.output?.audio || payload.audio || payload.output || {};
    if (audio.data) {
      const blob = base64ToBlob(audio.data, "audio/mpeg");
      await putCachedAudio(cacheKey, blob);
      await playAudioBlob(blob, button);
      return "qwen";
    }
    if (audio.url) {
      const audioUrl = secureRemoteUrl(audio.url);
      try {
        const file = await fetch(audioUrl);
        if (file.ok) {
          const blob = await file.blob();
          if (blob.size) {
            await putCachedAudio(cacheKey, blob);
            await playAudioBlob(blob, button);
            return "qwen";
          }
        }
      } catch (_) {
        // The signed OSS URL can still be played directly even when fetch is blocked.
      }
      return playAudioUrl(audioUrl, button);
    }
    throw new Error("Qwen 语音返回里没有 audio.url 或 audio.data。");
  }

  function refreshTtsError() {
    const box = $("#tts-error");
    if (!box) return;
    box.hidden = !lastTtsError;
    box.textContent = lastTtsError ? `最近错误：${lastTtsError}` : "";
  }

  async function speakText(text, button = null, cfg = state.settings, options = {}) {
    const clean = String(text || "").trim();
    if (!clean) return null;
    const engine = cfg.ttsEngine === "qwen" ? "qwen" : "native";
    if (engine === "native") {
      stopSpeech();
      return speakSystem(clean, button);
    }
    primeAudio();
    stopSpeech();
    setTtsLoading(button, true);
    try {
      const result = await speakQwen(clean, button, cfg, options);
      lastTtsError = "";
      return result;
    } catch (error) {
      lastTtsError = String(error?.message || error || "未知错误");
      refreshTtsError();
      toast(lastTtsError);
      console.warn("Qwen TTS failed; falling back to system speech.", error);
      return speakSystem(clean, button);
    } finally {
      setTtsLoading(button, false);
    }
  }

  async function testTts(button) {
    const status = $("#tts-test-status");
    const selected = state.draft || state.settings;
    const engine = selected.ttsEngine === "qwen" ? "qwen" : "native";
    if (status) {
      status.textContent = engine === "qwen" ? "正在请求 Qwen 语音…" : "正在使用设备系统语音";
    }
    lastTtsError = "";
    const result = await speakText("Talk is ready.", button, selected, { bypassCache: true });
    if (engine === "native") {
      refreshTtsError();
      return;
    }
    if (status) {
      status.textContent = String(result || "").startsWith("qwen")
        ? "Qwen 语音已就绪"
        : `Qwen 语音失败，已回退系统语音：${lastTtsError || "未知错误"}`;
    }
    refreshTtsError();
  }

  const actions = {
    speak: ({ event, target }) => {
      event.preventDefault();
      speakText(target.dataset.text || "", target);
    },
    "regenerate-audio": ({ event, target }) => {
      event.preventDefault();
      speakText(target.dataset.text || "", target, state.settings, { bypassCache: true });
    },
    "test-tts": ({ event, target }) => {
      event.preventDefault();
      testTts(target);
    }
  };

  return {
    stopSpeech,
    getAudioStats,
    clearAudioCache,
    refreshTtsError,
    speakText,
    testTts,
    actions
  };
}
