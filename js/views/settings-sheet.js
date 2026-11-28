/* ============================================================
   talk. — Settings sheet, provider/channel editor & preferences
   ============================================================ */

import { $, $$, esc, attr, shorten, tapFeedback } from "../core/utils.js";
import { icon } from "../core/icons.js";
import { DIAG_KEY } from "../core/diagnostics.js";
import { qwenTtsProfile, qwenTtsEndpoint } from "../features/tts.js";

const PROTOCOL_OPTIONS = [
  { id: "openai", label: "OpenAI 兼容" },
  { id: "anthropic", label: "Anthropic (Claude)" },
  { id: "google", label: "Google Gemini" }
];

const PROTOCOL_DEFAULT_URLS = {
  google: "https://generativelanguage.googleapis.com/v1beta",
  anthropic: "https://api.anthropic.com/v1",
  openai: ""
};

const CHANNEL_PICKS = {
  google: ["gemini-3.6-flash", "gemini-2.5-flash", "gemini-2.5-pro"],
  anthropic: ["claude-sonnet-4-5", "claude-haiku-4-5", "claude-opus-4-5", "claude-3-7-sonnet-latest"],
  openai: ["deepseek-chat", "gpt-4o-mini", "qwen3.7-flash", "moonshot-v1-8k"]
};

function protocolBadge(protocol) {
  if (protocol === "google") return "Gemini";
  if (protocol === "anthropic") return "Anthropic";
  return "OpenAI 兼容";
}

function profileHost(profile) {
  try {
    return new URL(String(profile.baseUrl || "")).host;
  } catch (_) {
    return String(profile.baseUrl || "").replace(/^https?:\/\//, "").split("/")[0] || "未填地址";
  }
}

function readProviderForm(previous = {}) {
  const read = (name) => $(`[data-provider-field="${name}"]`)?.value;
  const baseUrl = String(read("baseUrl") ?? previous.baseUrl ?? "").trim();
  const name = String(read("name") ?? previous.name ?? "").trim();
  const protocol = previous.protocol || "openai";
  return {
    id: previous.id || `channel-${Date.now()}`,
    name,
    protocol,
    provider: previous.provider || (protocol === "google" ? "google" : protocol === "anthropic" ? "anthropic" : "custom"),
    baseUrl,
    model: String(read("model") ?? previous.model ?? "").trim(),
    apiKey: String(read("apiKey") || previous.apiKey || ""),
    models: previous.models || [],
    note: previous.note || "",
    thinkingCapable: Boolean(previous.thinkingCapable) || protocol === "anthropic",
    enableThinking: Boolean(previous.enableThinking),
    thinkingBudget: Number(previous.thinkingBudget) || 0,
    isNew: Boolean(previous.isNew)
  };
}

function channelPicks(profile, models) {
  const proto = profile.protocol || "openai";
  const picks = CHANNEL_PICKS[proto] || CHANNEL_PICKS.openai || [];
  return picks.filter((id) => models.includes(id));
}

export function createSettingsSheet({
  state,
  overlayRoot,
  llm: LLM,
  appVersion,
  appBuild,
  providerTemplates,
  customTemplate,
  detailLevels,
  sentenceLevels,
  prefetchLimit,
  sentenceCache,
  copyFor,
  openSheetShell,
  closeSheet,
  activeProfile,
  applyProfileToSettings,
  syncDraftProfile,
  profileSupportsThinking,
  hasModelConfig,
  persistSettings,
  applyCacheDisplay,
  refreshCacheBorders,
  activeWordData,
  schedulePrefetch,
  hydrateLayerWithModel,
  sentenceLevelOf,
  reverseZoneName,
  exampleStyleFor,
  saveExampleStyles,
  wordCacheSummary,
  wordCacheStats,
  themeCacheStatsSync,
  formatBytes,
  diagText,
  refreshTtsError,
  renderThemeCacheStats,
  applyContentCopy,
  refreshThemedPage,
  getWord,
  scheduleThemeExamples,
  toast
}) {
  const VALID_TABS = new Set(["model", "reading", "appearance", "data"]);

  function resolveTab(tab) {
    if (tab === "tts") return "reading";
    return VALID_TABS.has(tab) ? tab : "model";
  }

  function settingsStatus(text) {
    const target = $("#settings-save-status");
    if (target) target.textContent = text;
  }

  function commitSettingsDraft() {
    if (!state.draft) return;
    if (state.settingsSaveTimer) {
      window.clearTimeout(state.settingsSaveTimer);
      state.settingsSaveTimer = null;
    }
    syncDraftProfile(state.draft);
    state.draft.apiKey = String(state.draft.apiKey || "").trim();
    state.draft.baseUrl = String(state.draft.baseUrl || "").trim();
    state.draft.model = String(state.draft.model || "").trim();
    state.settings = {
      ...state.draft,
      profiles: state.draft.profiles.map((profile) => ({ ...profile }))
    };
    persistSettings(state.settings);
    state.settingsDirty = false;
    applyCacheDisplay();
    refreshCacheBorders();
    const active = activeWordData();
    if (active) schedulePrefetch(active);
    settingsStatus("已自动保存");
  }

  function scheduleSettingsCommit() {
    if (!state.draft) return;
    state.settingsDirty = true;
    settingsStatus("正在保存…");
    if (state.settingsSaveTimer) window.clearTimeout(state.settingsSaveTimer);
    state.settingsSaveTimer = window.setTimeout(commitSettingsDraft, 240);
  }

  function flushSettingsDraft() {
    if (!state.settingsDirty) return;
    commitSettingsDraft();
  }

  function fetchChannelModels(profile) {
    return LLM.listModels(profile, { timeoutMs: 15_000 });
  }

  function testChannel(profile) {
    return LLM.pingModel(profile, {
      timeoutMs: 20_000,
      prompt: "Reply with the single word: pong",
      maxTokens: 16
    });
  }

  function returnToSettingsRoot({ resetScroll = false } = {}) {
    state.settingsOpen = true;
    state.settingsSubView = "";
    state.providerDraft = null;
    state.providerStatus = null;
    const copy = copyFor("settings");
    openSheetShell({
      kicker: copy.kicker,
      title: copy.title,
      reuse: Boolean($(".sheet", overlayRoot) && $(".sheet-backdrop", overlayRoot)),
      backAction: ""
    });
    renderSettingsContent();
    if (resetScroll) $("#sheet-scroll")?.scrollTo({ top: 0 });
  }

  function openProviderPicker() {
    state.settingsSubView = "provider-picker";
    openSheetShell({
      kicker: "MODEL SETUP",
      title: "选择供应商",
      reuse: Boolean(state.sheetOpen),
      backAction: "settings-back",
      backLabel: "返回设置"
    });
    const body = $("#sheet-scroll", overlayRoot);
    if (!body) return;
    body.innerHTML = `
      <div class="template-list">
        ${providerTemplates.map((template) => `
          <button class="template-row" type="button" data-action="provider-template" data-template="${attr(template.id)}">
            <span class="template-head">
              <strong>${esc(template.name)}</strong>
              <span class="template-badge">${esc(protocolBadge(template.protocol || "openai"))}</span>
            </span>
            <span class="template-url mono">${esc(template.baseUrl || "自行填写地址")}</span>
            <span class="template-note">${esc(template.note || "")}</span>
          </button>`).join("")}
      </div>`;
    body.scrollTop = 0;
  }

  function renderProviderSheet() {
    const sheet = $("#sheet-scroll");
    const d = state.providerDraft;
    if (!sheet || !d) return;
    const status = state.providerStatus || {};
    const urlPlaceholder = d.protocol === "google"
      ? "https://generativelanguage.googleapis.com/v1beta"
      : d.protocol === "anthropic"
        ? "https://api.anthropic.com/v1"
        : "https://api.deepseek.com";
    const keyPlaceholder = d.protocol === "anthropic" ? "sk-ant-…" : "sk-…";
    sheet.innerHTML = `
      <div class="provider-form">
        <label class="provider-field"><span>名称</span>
          <input data-provider-field="name" value="${attr(d.name || "")}" placeholder="例如 DeepSeek 主力" autocomplete="off" spellcheck="false" />
        </label>
        <div class="provider-field"><span>协议</span>
          <div class="provider-protocols" role="group" aria-label="协议">
            ${PROTOCOL_OPTIONS.map((item) => `<button class="provider-protocol ${(d.protocol || "openai") === item.id ? "active" : ""}" type="button" data-action="provider-protocol" data-protocol="${item.id}" aria-pressed="${(d.protocol || "openai") === item.id}">${esc(item.label)}</button>`).join("")}
          </div>
        </div>
        <label class="provider-field"><span>Base URL</span>
          <input data-provider-field="baseUrl" value="${attr(d.baseUrl || "")}" inputmode="url" placeholder="${attr(urlPlaceholder)}" autocomplete="off" spellcheck="false" />
        </label>
        <label class="provider-field"><span>API Key</span>
          <input data-provider-field="apiKey" type="password" value="${attr(d.apiKey || "")}" placeholder="${attr(keyPlaceholder)}" autocomplete="off" />
        </label>
        <div class="provider-field"><span>模型</span>
          <div class="provider-model-row">
            <input data-provider-field="model" value="${attr(d.model || "")}" list="provider-model-options" placeholder="先获取，或手动填写" autocomplete="off" spellcheck="false" />
            <button class="btn btn-secondary" type="button" data-action="provider-fetch">获取模型</button>
          </div>
          <datalist id="provider-model-options">
            ${(d.models || []).map((id) => `<option value="${attr(id)}"></option>`).join("")}
          </datalist>
          <p class="provider-hint">${(d.models || []).length ? `${d.models.length} 个可用模型` : "填好地址与密钥后点「获取模型」"}</p>
          ${channelPicks(d, d.models || []).length ? `<div class="provider-picks">${channelPicks(d, d.models || []).map((id, index) => `<button class="provider-pick ${index === 0 ? "primary" : ""}" type="button" data-action="provider-pick" data-model="${attr(id)}">${esc(id)}${index === 0 ? " · 推荐" : ""}</button>`).join("")}</div>` : ""}
          ${(d.models || []).length ? `<div class="provider-models" role="listbox" aria-label="可选模型">
            ${d.models.map((id) => `<button class="provider-model-option ${id === d.model ? "is-current" : ""}" type="button" role="option" aria-selected="${id === d.model}" data-action="provider-pick" data-model="${attr(id)}">${esc(id)}</button>`).join("")}
          </div>` : ""}
        </div>
        <p class="provider-status ${status.tone || ""}">${esc(status.text || "先获取模型，再点测试确认能连通。")}</p>
        <div class="provider-actions">
          <button class="btn btn-secondary" type="button" data-action="provider-test">测试</button>
          <button class="btn btn-primary" type="button" data-action="provider-save">保存</button>
        </div>
        ${d.isNew ? "" : '<button class="link-btn provider-delete" type="button" data-action="provider-delete">删除这个模型</button>'}
      </div>`;
  }

  function openProviderSheet(profileId, template = null) {
    const draft = state.draft;
    if (!draft) return;
    const existing = profileId ? draft.profiles.find((item) => item.id === profileId) : null;
    state.providerDraft = existing
      ? { ...existing, isNew: false }
      : {
        id: `channel-${Date.now()}`,
        name: template?.name || "",
        protocol: template?.protocol || "openai",
        provider: template?.provider || "custom",
        baseUrl: template?.baseUrl || "",
        model: template?.model || "",
        apiKey: "",
        models: [],
        note: template?.note || "",
        thinkingCapable: Boolean(template?.thinkingCapable) || template?.protocol === "anthropic",
        enableThinking: Boolean(template?.enableThinking),
        thinkingBudget: Number(template?.thinkingBudget) || 0,
        isNew: true
      };
    state.providerStatus = null;
    state.settingsSubView = "provider-editor";
    openSheetShell({
      kicker: "MODEL",
      title: existing ? "编辑模型" : "添加模型",
      reuse: Boolean(state.sheetOpen),
      backAction: "settings-back",
      backLabel: "返回设置"
    });
    renderProviderSheet();
    $("#sheet-scroll")?.scrollTo({ top: 0 });
  }

  function ttsCardBodyHtml(draft) {
    const engine = draft.ttsEngine === "qwen" ? "qwen" : "native";
    if (engine === "qwen") {
      const qwen = qwenTtsProfile(draft);
      return `<div class="qwen-tts-panel">
        <div class="tts-row">
          <input id="qwen-tts-model" type="text" data-setting="qwenTtsModel" value="${attr(draft.qwenTtsModel || "qwen-audio-3.1-tts-plus")}" placeholder="qwen-audio-3.1-tts-plus" spellcheck="false" aria-label="Qwen TTS 模型" />
          <input id="qwen-tts-voice" type="text" data-setting="qwenTtsVoice" value="${attr(draft.qwenTtsVoice || "longanhuan_v3.1")}" placeholder="longanhuan_v3.1" spellcheck="false" aria-label="Qwen TTS 音色" />
          <button class="btn btn-secondary tts-test-btn" type="button" data-action="test-tts">${icon("volume")} 试听</button>
        </div>
        ${qwen ? `<p class="tts-line" id="qwen-tts-endpoint">使用「${esc(qwen.name)}」的 API 密钥 · ${esc(qwenTtsEndpoint(qwen, draft.qwenTtsModel))}</p>` : `<p class="tts-line tts-error">还没有可用的 Qwen 密钥。请先在「模型」里填写 Qwen 的 API 密钥。</p>`}
        <p class="tts-line">默认 qwen-audio-3.1-tts-plus；音色可填 longanhuan_v3.1 或其他 Qwen 音色。</p>
        <span class="tts-status" id="tts-test-status">${qwen ? "密钥已就绪" : "需要先配置 Qwen 密钥"}</span>
        <p class="tts-line tts-https-warning">密钥只保存在本机；语音请求由浏览器直接发往 Qwen。</p>
      </div>`;
    }
    return `
      <div class="tts-row">
        <span class="tts-line">调用系统朗读，点击即读、无需额外额度</span>
        <button class="btn btn-secondary tts-test-btn" type="button" data-action="test-tts">${icon("volume")} 试听</button>
      </div>
      <span class="tts-status" id="tts-test-status"></span>
      <p class="tts-error" id="tts-error" hidden></p>`;
  }

  function modelSettingsHtml(draft) {
    const current = activeProfile(draft);
    return `
      <section class="settings-card">
        <div class="settings-card-head">
          <span class="settings-subhead">模型渠道</span>
          <span class="mono">${draft.profiles.length} 个</span>
        </div>
        ${draft.profiles.length ? "" : '<p class="provider-empty">还没有可用的模型。点下面添加一个，填好密钥就能查词。</p>'}
        <div class="provider-list" role="list" aria-label="模型渠道">
          ${draft.profiles.map((profile) => `
            <div class="provider-row ${profile.id === draft.activeProfileId ? "is-active" : ""}" role="listitem">
              <button class="provider-select" type="button" data-action="provider-select" data-profile="${attr(profile.id)}" aria-pressed="${profile.id === draft.activeProfileId}">
                <span class="provider-row-copy">
                  <span class="provider-row-title">
                    <strong>${esc(profile.model || "未选模型")}</strong>
                    <span class="provider-proto-pill">${esc(protocolBadge(profile.protocol || "openai"))}</span>
                  </span>
                  <small class="mono">${esc(profile.name || "未命名")} · ${esc(profileHost(profile))}</small>
                </span>
                ${profile.id === draft.activeProfileId ? '<i class="provider-dot" aria-hidden="true"></i>' : ""}
              </button>
              <button class="provider-edit" type="button" data-action="provider-edit" data-profile="${attr(profile.id)}">编辑</button>
            </div>`).join("")}
          <button class="provider-add" type="button" data-action="provider-new">+ 添加模型</button>
        </div>
      </section>

      <section class="settings-card">
        <div class="settings-card-head">
          <span class="settings-subhead">连接与安全</span>
        </div>
        <div class="settings-status-row">
          <div class="key-status ${hasModelConfig(draft) ? "" : "off"}" id="api-test-status">
            ${hasModelConfig(draft) ? `${icon("shield")} <span>已配置 · ${esc(current?.name || draft.model || "自定义")}</span>` : "<span>演示模式 · 无需密钥</span>"}
          </div>
          <button class="btn btn-secondary settings-test-btn" type="button" data-action="test-connection" ${draft.profiles.length ? "" : "disabled"}>${icon("sparkle")} 测试连通</button>
        </div>
        ${profileSupportsThinking(current) ? `
        <div class="settings-card-divider"></div>
        <div class="thinking-panel compact">
          <label class="pref-toggle inline-toggle">
            <span class="pref-copy">
              <strong>开启深度思考</strong>
              <span>允许模型先推理再输出，复杂句子更细致但耗时更长。</span>
            </span>
            <span class="pref-switch">
              <input type="checkbox" data-profile-option="enableThinking" ${draft.enableThinking ? "checked" : ""} />
              <span class="pref-slider" aria-hidden="true"></span>
            </span>
          </label>
          <div class="thinking-budget-row">
            <label for="thinking-budget">思考预算（tokens，0 为自动）</label>
            <input id="thinking-budget" type="number" min="0" max="262144" step="128" data-profile-option="thinkingBudget" value="${Number(draft.thinkingBudget) || 0}" inputmode="numeric" />
          </div>
        </div>` : ""}
        <div class="settings-card-divider"></div>
        <label class="pref-toggle inline-toggle">
          <span class="pref-copy">
            <strong>在这台设备上记住密钥</strong>
            <span>仅保存在当前浏览器本机存储，公共设备建议关闭。</span>
          </span>
          <span class="pref-switch">
            <input type="checkbox" data-setting="remember" ${draft.remember ? "checked" : ""} />
            <span class="pref-slider" aria-hidden="true"></span>
          </span>
        </label>
        <details class="settings-hint-disclosure">
          <summary>网页直连与 CORS 说明</summary>
          <p class="api-note">部分服务商会用 CORS 拦截网页直连，测试失败不代表密钥有误。把地址换成自建代理可以绕开，也能把真实密钥留在服务端。</p>
        </details>
      </section>`;
  }

  function readingSettingsHtml(draft) {
    const engine = draft.ttsEngine === "qwen" ? "qwen" : "native";
    const budget = Number(draft.reverseMaxTokens) || 1500;
    return `
      <section class="settings-card">
        <div class="settings-card-head">
          <span class="settings-subhead">查词与解析</span>
        </div>
        <div class="settings-block">
          <div class="settings-row-label">
            <strong>生成深度</strong>
            <span>决定词条释义与搭配详略</span>
          </div>
          <div class="detail-switch" role="group" aria-label="生成深度">
            ${Object.entries(detailLevels).map(([id, item]) => `
              <button class="detail-btn ${(draft.detailLevel || "standard") === id ? "active" : ""}" type="button" data-action="detail-level" data-level="${id}" aria-pressed="${(draft.detailLevel || "standard") === id}">${item.label}</button>`).join("")}
          </div>
        </div>
        <div class="settings-card-divider"></div>
        <div class="settings-block">
          <div class="settings-row-label">
            <strong>学习阶段</strong>
            <span>用于句子拆解与重点标注</span>
          </div>
          <div class="level-row">
            ${sentenceLevels.map((level) => `
              <button class="level-chip${draft.sentenceLevel === level.id ? " active" : ""}" type="button"
                data-action="sentence-level" data-level="${attr(level.id)}" aria-pressed="${draft.sentenceLevel === level.id}"
                title="${attr(level.hint)}">${esc(level.label)}</button>`).join("")}
          </div>
        </div>
        <div class="settings-card-divider"></div>
        <div class="settings-block">
          <div class="settings-row-label">
            <strong>语境寻词长度</strong>
            <span><span id="reverse-token-value">${budget}</span> tokens · <span id="reverse-token-zone">${reverseZoneName(budget)}</span></span>
          </div>
          <input class="setting-range" type="range" min="600" max="3000" step="100"
            value="${budget}" data-setting="reverseMaxTokens" aria-label="语境寻词输出上限" />
          <div class="token-scale" id="reverse-token-scale">
            <span class="token-zone${budget < 1000 ? " is-active" : ""}" style="flex:4">只给结论</span>
            <span class="token-zone${budget >= 1000 && budget < 2000 ? " is-active" : ""}" style="flex:10">分块讲解</span>
            <span class="token-zone${budget >= 2000 ? " is-active" : ""}" style="flex:10">成句拆解</span>
          </div>
          <div class="token-ticks">
            <span style="left:0">600</span>
            <span style="left:16.7%">1000</span>
            <span style="left:58.3%">2000</span>
            <span style="left:100%">3000</span>
          </div>
        </div>
      </section>

      <section class="settings-card" id="tts-settings-card">
        <div class="tts-head">
          <span class="settings-subhead">朗读发音</span>
          <div class="tts-engine-switch" role="group" aria-label="发音引擎">
            <button class="tts-engine-btn ${engine === "native" ? "active" : ""}" type="button" data-action="tts-engine" data-engine="native" aria-pressed="${engine === "native"}">系统原生</button>
            <button class="tts-engine-btn ${engine === "qwen" ? "active" : ""}" type="button" data-action="tts-engine" data-engine="qwen" aria-pressed="${engine === "qwen"}">Qwen 语音</button>
          </div>
        </div>
        <div id="tts-card-body">${ttsCardBodyHtml(draft)}</div>
      </section>

      <details class="settings-card settings-disclosure">
        <summary class="settings-disclosure-head">
          <span class="settings-subhead">高级生成选项</span>
          <span class="settings-disclosure-hint">预加载 · 例句风格</span>
        </summary>
        <div class="settings-disclosure-body">
          <label class="pref-toggle inline-toggle">
            <span class="pref-copy">
              <strong>预加载二级词条</strong>
              <span>词页出现后，在后台生成最多 ${prefetchLimit} 个相关词；会额外消耗模型额度。</span>
            </span>
            <span class="pref-switch">
              <input type="checkbox" data-setting="prefetch" ${draft.prefetch ? "checked" : ""} />
              <span class="pref-slider" aria-hidden="true"></span>
            </span>
          </label>
          <div class="settings-card-divider"></div>
          <div class="settings-block">
            <div class="settings-row-label">
              <strong>例句风格</strong>
              <span>只影响之后生成的例句</span>
            </div>
            <div class="example-style-list">
              ${(window.TALK_THEME?.list?.() || []).map((theme) => `
                <label class="example-style-row">
                  <span>${esc(theme.label)}</span>
                  <input type="text" data-example-style="${attr(theme.id)}" value="${attr(exampleStyleFor(theme.id))}" spellcheck="false" aria-label="${attr(theme.label)} 的例句风格" />
                </label>`).join("")}
            </div>
            <button class="link-btn" type="button" data-action="reset-example-styles">恢复默认风格</button>
          </div>
        </div>
      </details>`;
  }

  function appearanceSettingsHtml(draft) {
    const lang = window.TALK_I18N?.lang || "zh";
    const currentThemeId = window.TALK_THEME.current().id;
    return `
      <section class="settings-card">
        <div class="settings-inline-row">
          <div class="settings-row-label">
            <strong>界面语言</strong>
            <span>仅切换界面文字，词条解析保持双语</span>
          </div>
          <div class="level-row compact" role="group" aria-label="界面语言">
            <button class="level-chip${lang === "zh" ? " active" : ""}" type="button" data-action="lang" data-lang="zh" aria-pressed="${lang === "zh"}">中文</button>
            <button class="level-chip${lang === "en" ? " active" : ""}" type="button" data-action="lang" data-lang="en" aria-pressed="${lang === "en"}">English</button>
          </div>
        </div>
      </section>

      <section class="settings-card">
        <div class="settings-card-head">
          <span class="settings-subhead">外观主题</span>
          <span class="mono">点选即切换</span>
        </div>
        <div class="theme-grid" role="list" aria-label="外观主题">
          ${Object.values(window.TALK_THEME.themes).map((theme) => {
            const active = currentThemeId === theme.id;
            const accentSwatch = theme.accentFill || theme.accent || "#171813";
            const baseSwatch = theme.themeColor && theme.themeColor !== accentSwatch ? theme.themeColor : "#efe5cf";
            return `<button class="theme-card${active ? " is-active" : ""}" type="button" role="listitem" data-action="theme" data-theme="${attr(theme.id)}" aria-pressed="${active}">
              <span class="theme-card-bar" aria-hidden="true">
                <i class="bar-bg" style="background:${attr(baseSwatch)}"></i>
                <i class="bar-accent" style="background:${attr(accentSwatch)}"></i>
              </span>
              <span class="theme-card-head">
                <strong>${esc(theme.label)}</strong>
                <span class="theme-card-state">${active ? "使用中" : ""}</span>
              </span>
              <small>${esc(theme.description || "")}</small>
            </button>`;
          }).join("")}
        </div>
      </section>

      <section class="settings-card">
        <div class="settings-card-head">
          <span class="settings-subhead">界面细节</span>
        </div>
        <div class="settings-inline-row">
          <div class="settings-row-label">
            <strong>生成信息</strong>
            <span>词条底部显示模型与耗时脚注</span>
          </div>
          <div class="level-row compact" role="group" aria-label="生成信息">
            <button class="level-chip${draft.showGenMeta !== false ? " active" : ""}" type="button" data-action="gen-meta" data-on="1" aria-pressed="${draft.showGenMeta !== false}">显示</button>
            <button class="level-chip${draft.showGenMeta === false ? " active" : ""}" type="button" data-action="gen-meta" data-on="0" aria-pressed="${draft.showGenMeta === false}">隐藏</button>
          </div>
        </div>
        <div class="settings-card-divider"></div>
        <div class="settings-inline-row">
          <div class="settings-row-label">
            <strong>缓存提示方式</strong>
            <span>虚线未缓存 · 实线已缓存</span>
          </div>
          <div class="cache-display-switch" role="group" aria-label="缓存提示方式">
            <button class="cache-display-btn ${draft.cacheDisplay !== "corner" ? "active" : ""}" type="button" data-action="cache-display" data-display="borders" aria-pressed="${draft.cacheDisplay !== "corner"}">边框</button>
            <button class="cache-display-btn ${draft.cacheDisplay === "corner" ? "active" : ""}" type="button" data-action="cache-display" data-display="corner" aria-pressed="${draft.cacheDisplay === "corner"}">三角标</button>
          </div>
        </div>
      </section>`;
  }

  function dataSettingsHtml() {
    const stats = wordCacheSummary ? wordCacheSummary() : wordCacheStats();
    const themeStats = themeCacheStatsSync
      ? themeCacheStatsSync()
      : { count: Array.isArray(state.themeDecks) ? state.themeDecks.length : 0, displayCount: Array.isArray(state.themeDisplay) ? state.themeDisplay.length : 0, max: 8, bytes: 0, words: 0 };
    return `
      <section class="settings-card">
        <div class="settings-card-head">
          <span class="settings-subhead">本机存储</span>
          <span class="mono">${esc(stats.backend)}</span>
        </div>
        <div class="data-metrics-row">
          <div class="data-metric">
            <span class="data-metric-label">词条</span>
            <strong>${stats.count}</strong>
            <span class="mono">${formatBytes(stats.bytes)}</span>
          </div>
          <div class="data-metric">
            <span class="data-metric-label">句子</span>
            <strong>${sentenceCache.size}</strong>
            <span class="mono">永久保留</span>
          </div>
          <div class="data-metric">
            <span class="data-metric-label">主题库</span>
            <strong>${themeStats.count}</strong>
            <span class="mono">${formatBytes(themeStats.bytes)}</span>
          </div>
        </div>
        <div class="cache-actions data-primary-actions">
          <button class="btn btn-primary cache-action-btn" type="button" data-action="open-cache">${icon("archive")} 缓存管理</button>
          <button class="btn btn-secondary cache-action-btn" type="button" data-action="export-word-cache">导出 JSON</button>
          <button class="btn btn-secondary cache-action-btn" type="button" data-action="import-word-cache">导入 JSON</button>
          <input id="word-cache-file" type="file" accept="application/json,.json" hidden />
        </div>
      </section>

      <section class="settings-card">
        <div class="settings-card-head">
          <span class="settings-subhead">按类清理</span>
        </div>
        <div class="settings-inline-row">
          <div class="settings-row-label">
            <strong>句子分析缓存</strong>
            <span>当前 ${sentenceCache.size} 条，按原文、深度与水平区分</span>
          </div>
          <button class="btn btn-secondary settings-compact-btn" type="button" data-action="clear-sentence-cache">清空句子</button>
        </div>
        <div class="settings-card-divider"></div>
        <div class="settings-inline-row">
          <div class="settings-row-label">
            <strong>主题词展库</strong>
            <span id="theme-cache-inline">${themeStats.count} 套主题 · 展览 ${themeStats.displayCount}/${themeStats.max} · 共 ${themeStats.words} 词</span>
          </div>
          <button class="btn btn-secondary settings-compact-btn" type="button" data-action="clear-theme-cache">清空主题库</button>
        </div>
      </section>

      <details class="settings-card settings-disclosure">
        <summary class="settings-disclosure-head">
          <span class="settings-subhead">运行诊断</span>
          <span class="settings-disclosure-hint">脱敏日志 · 排障用</span>
        </summary>
        <div class="settings-disclosure-body">
          <p class="api-note">只记录请求类型、字符数与错误文本；密钥、令牌和长串已脱敏。出问题时复制它发给开发者。</p>
          <pre class="diag-preview" id="diag-preview">${esc(diagText().split("\n").slice(-9).join("\n"))}</pre>
          <div class="cache-actions">
            <button class="btn btn-secondary cache-action-btn" type="button" data-action="copy-diagnostics">${icon("copy")} 复制诊断</button>
            <button class="btn btn-secondary cache-action-btn" type="button" data-action="clear-diagnostics">清空日志</button>
          </div>
        </div>
      </details>

      <button class="btn btn-secondary install-settings-btn" id="install-app" type="button" data-action="install-app" ${state.installPrompt ? "" : "hidden"}>${icon("external")} 安装到主屏幕</button>`;
  }

  function renderSettingsContent() {
    const holder = $("#sheet-scroll");
    if (!holder || !state.draft) return;
    const prevScroll = holder.scrollTop;
    const draft = state.draft;
    const tab = resolveTab(state.settingsTab);
    state.settingsTab = tab;
    const settingsCopy = copyFor("settings");
    const tabs = settingsCopy.tabs;
    const sheetTitle = $(".sheet-title", overlayRoot);
    if (sheetTitle) sheetTitle.textContent = settingsCopy.title;
    const sheetKicker = $(".sheet-head .mono", overlayRoot);
    if (sheetKicker) sheetKicker.textContent = settingsCopy.kicker;
    const paneHtml = tab === "reading"
      ? readingSettingsHtml(draft)
      : tab === "appearance"
        ? appearanceSettingsHtml(draft)
        : tab === "data"
          ? dataSettingsHtml()
          : modelSettingsHtml(draft);
    holder.innerHTML = `
      <div class="sheet-content settings-sheet">
        <div class="settings-tabs" role="tablist" aria-label="设置分类">
          ${tabs.map(([id, label]) => `<button class="settings-tab ${tab === id ? "active" : ""}" type="button" role="tab" aria-selected="${tab === id}" data-action="settings-tab" data-tab="${id}">${label}</button>`).join("")}
        </div>
        <div class="settings-pane" role="tabpanel" data-tab-pane="${tab}">
          ${paneHtml}
        </div>
        <div class="settings-footer">
          <span id="settings-save-status"><span data-app-version>v${appVersion}</span> · build <span data-app-build>${appBuild}</span> · ${state.settingsDirty ? "正在保存…" : "更改自动保存"}</span>
          <button class="btn btn-primary" type="button" data-action="save-settings">完成</button>
        </div>
      </div>`;
    holder.scrollTop = prevScroll;
    if (window.TALK_I18N?.lang === "en") {
      window.TALK_I18N.apply(overlayRoot || document.body);
    }
    if (tab === "reading") requestAnimationFrame(refreshTtsError);
  }

  function openSettingsSheet() {
    // Idempotency guard: if the settings root sheet is already open and visible,
    // never tear down DOM, discard draft edits, replay animations, or reset scroll.
    const existingSettings = $("#sheet-scroll .settings-sheet", overlayRoot);
    if (state.settingsOpen && state.sheetOpen && !state.settingsSubView && !state.providerDraft && existingSettings) {
      if (state.sheetCloseTimer) {
        window.clearTimeout(state.sheetCloseTimer);
        state.sheetCloseTimer = null;
      }
      $(".sheet-backdrop", overlayRoot)?.classList.add("show");
      $(".sheet", overlayRoot)?.classList.add("show");
      return;
    }

    // If returning from a settings sub-sheet (provider picker/editor or cache dashboard),
    // preserve the live draft and smoothly reuse the existing sheet shell.
    if (state.settingsOpen && state.sheetOpen && state.draft) {
      flushSettingsDraft();
      returnToSettingsRoot({ resetScroll: true });
      return;
    }

    state.settingsOpen = true;
    state.settingsSubView = "";
    state.providerDraft = null;
    state.providerStatus = null;
    state.settingsDirty = false;
    state.settingsTab = resolveTab(state.settingsTab);
    state.draft = {
      ...state.settings,
      profiles: (state.settings.profiles || []).map((profile) => ({ ...profile }))
    };
    const copy = copyFor("settings");
    const canReuse = Boolean($(".sheet", overlayRoot) && $(".sheet-backdrop", overlayRoot));
    openSheetShell({ kicker: copy.kicker, title: copy.title, reuse: canReuse, backAction: "" });
    renderSettingsContent();
  }

  function saveSettings() {
    if (!state.draft) return;
    flushSettingsDraft();
    closeSheet();
    const topLayer = state.wordLayers[state.wordLayers.length - 1];
    if (topLayer && !topLayer.data) void hydrateLayerWithModel(topLayer);
    const active = activeWordData();
    if (active) schedulePrefetch(active);
    toast(hasModelConfig() ? "设置已保存" : "已切换到演示模式");
  }

  async function testConnection() {
    if (!state.draft) return;
    const status = $("#api-test-status");
    if (!status) return;
    if (!hasModelConfig(state.draft)) {
      status.className = "key-status off";
      status.innerHTML = "<span>填入密钥，或把地址指向本地服务。</span>";
      return;
    }
    status.className = "key-status";
    status.innerHTML = `<span>正在测试 ${esc(state.draft.model || "模型")}…</span>`;
    const result = await LLM.pingModel(state.draft, {
      timeoutMs: 30_000,
      prompt: "Reply with exactly: OK",
      maxTokens: 16
    });
    if (result.ok) {
      status.className = "key-status";
      status.innerHTML = `${icon("check")} <span>已连接 ${esc(state.draft.model || "模型")} · ${result.ms} ms</span>`;
    } else {
      status.className = "key-status off";
      status.innerHTML = `<span>${esc(shorten(result.text, 140))}</span>`;
    }
  }

  const actions = {
    settings({ event }) {
      event.preventDefault();
      tapFeedback();
      openSettingsSheet();
    },
    "settings-back"({ event }) {
      event.preventDefault();
      returnToSettingsRoot({ resetScroll: true });
    },
    "settings-tab"({ event, target }) {
      event.preventDefault();
      const nextTab = resolveTab(target.dataset.tab || "model");
      if (nextTab === state.settingsTab && $("#sheet-scroll .settings-pane", overlayRoot)) {
        return;
      }
      state.settingsTab = nextTab;
      renderSettingsContent();
      $("#sheet-scroll")?.scrollTo({ top: 0 });
    },
    "select-profile"({ event, target }) {
      event.preventDefault();
      if (!state.draft) return;
      syncDraftProfile(state.draft);
      const profile = state.draft.profiles.find((item) => item.id === target.dataset.profile);
      if (!profile) return;
      state.draft = applyProfileToSettings(state.draft, profile);
      scheduleSettingsCommit();
      renderSettingsContent();
    },
    "provider-new"({ event }) {
      event.preventDefault();
      if (!state.draft) return;
      syncDraftProfile(state.draft);
      openProviderPicker();
    },
    "provider-template"({ event, target }) {
      event.preventDefault();
      const template = providerTemplates.find((item) => item.id === target.dataset.template) || customTemplate;
      openProviderSheet(null, template);
    },
    "provider-select"({ event, target }) {
      event.preventDefault();
      const profile = state.draft?.profiles.find((item) => item.id === target.dataset.profile);
      if (!profile || profile.id === state.draft.activeProfileId) return;
      syncDraftProfile(state.draft);
      state.draft = applyProfileToSettings(state.draft, profile);
      commitSettingsDraft();
      renderSettingsContent();
      toast(`已切换到 ${profile.model || profile.name}`);
    },
    "provider-edit"({ event, target }) {
      event.preventDefault();
      if (!state.draft) return;
      syncDraftProfile(state.draft);
      openProviderSheet(target.dataset.profile || null);
    },
    "provider-protocol"({ event, target }) {
      event.preventDefault();
      const prevProto = state.providerDraft?.protocol || "openai";
      const next = readProviderForm(state.providerDraft);
      const nextProto = target.dataset.protocol || "openai";
      next.protocol = nextProto;
      if (nextProto === "google") next.provider = "google";
      else if (nextProto === "anthropic") next.provider = "anthropic";
      else if (next.provider === "google" || next.provider === "anthropic") next.provider = "custom";
      const prevDefault = PROTOCOL_DEFAULT_URLS[prevProto] || "";
      const nextDefault = PROTOCOL_DEFAULT_URLS[nextProto] || "";
      if (!next.baseUrl || (prevDefault && next.baseUrl === prevDefault)) {
        next.baseUrl = nextDefault;
      }
      next.thinkingCapable = nextProto === "anthropic" || Boolean(next.thinkingCapable);
      next.models = [];
      state.providerDraft = next;
      renderProviderSheet();
    },
    "provider-pick"({ event, target }) {
      event.preventDefault();
      if (state.providerDraft && target.dataset.model) {
        state.providerDraft.model = target.dataset.model;
        const input = $('[data-provider-field="model"]');
        if (input) input.value = target.dataset.model;
      }
    },
    async "provider-fetch"({ event }) {
      event.preventDefault();
      const profile = readProviderForm(state.providerDraft);
      if (!profile.baseUrl) { toast("先填 Base URL"); return; }
      state.providerDraft = profile;
      state.providerStatus = { tone: "", text: "正在获取模型…" };
      renderProviderSheet();
      try {
        const models = await fetchChannelModels(profile);
        state.providerDraft = { ...profile, models, model: profile.model || models[0] || "" };
        state.providerStatus = models.length
          ? { tone: "ok", text: `找到 ${models.length} 个模型，选一个再测试。` }
          : { tone: "bad", text: "没有取到模型；可以手动填写模型名。" };
      } catch (error) {
        state.providerStatus = { tone: "bad", text: `获取失败：${error.message}` };
      }
      renderProviderSheet();
    },
    async "provider-test"({ event }) {
      event.preventDefault();
      const profile = readProviderForm(state.providerDraft);
      if (!profile.baseUrl || !profile.model) { toast("地址与模型都要填"); return; }
      state.providerDraft = profile;
      state.providerStatus = { tone: "", text: "正在测试…" };
      renderProviderSheet();
      const result = await testChannel(profile);
      state.providerStatus = result.ok
        ? { tone: "ok", text: `连通 · ${result.ms} ms · 回复「${result.text}」` }
        : { tone: "bad", text: `失败 · ${result.ms} ms · ${result.text}` };
      renderProviderSheet();
    },
    "provider-save"({ event }) {
      event.preventDefault();
      const profile = readProviderForm(state.providerDraft);
      if (!profile.baseUrl || !profile.model) { toast("地址与模型都要填"); return; }
      const clean = { ...profile };
      delete clean.isNew;
      if (!clean.name) clean.name = profileHost(clean);
      const draft = state.draft;
      const index = draft.profiles.findIndex((item) => item.id === clean.id);
      if (index >= 0) draft.profiles[index] = clean;
      else draft.profiles.push(clean);
      state.draft = applyProfileToSettings(draft, clean);
      commitSettingsDraft();
      returnToSettingsRoot({ resetScroll: true });
      toast("模型已保存");
    },
    "provider-delete"({ event }) {
      event.preventDefault();
      const profile = state.providerDraft;
      if (!profile || !state.draft) return;
      if (!window.confirm(`删除「${profile.model || profile.name || "这个模型"}」？`)) return;
      state.draft.profiles = state.draft.profiles.filter((item) => item.id !== profile.id);
      state.draft = state.draft.profiles.length
        ? applyProfileToSettings(state.draft, state.draft.profiles[0])
        : { ...state.draft, activeProfileId: "", baseUrl: "", model: "", apiKey: "" };
      commitSettingsDraft();
      returnToSettingsRoot({ resetScroll: true });
    },
    "delete-profile"({ event }) {
      event.preventDefault();
      if (!state.draft || state.draft.profiles.length <= 1) return;
      const current = activeProfile(state.draft);
      if (!current) return;
      if (!window.confirm(`删除「${current.name}」？`)) return;
      state.draft.profiles = state.draft.profiles.filter((item) => item.id !== current.id);
      const next = state.draft.profiles[0];
      state.draft = applyProfileToSettings(state.draft, next);
      scheduleSettingsCommit();
      renderSettingsContent();
    },
    "detail-level"({ event, target }) {
      event.preventDefault();
      if (!state.draft) return;
      const next = target.dataset.level || "standard";
      if (state.draft.detailLevel === next) return;
      state.draft.detailLevel = next;
      scheduleSettingsCommit();
      $$('[data-action="detail-level"]').forEach((btn) => {
        const active = btn.dataset.level === next;
        btn.classList.toggle("active", active);
        btn.setAttribute("aria-pressed", String(active));
      });
    },
    "tts-engine"({ event, target }) {
      event.preventDefault();
      if (!state.draft) return;
      const next = target.dataset.engine === "qwen" ? "qwen" : "native";
      if ((state.draft.ttsEngine === "qwen" ? "qwen" : "native") === next) return;
      state.draft.ttsEngine = next;
      scheduleSettingsCommit();
      $$('[data-action="tts-engine"]').forEach((btn) => {
        const active = btn.dataset.engine === next;
        btn.classList.toggle("active", active);
        btn.setAttribute("aria-pressed", String(active));
      });
      const body = $("#tts-card-body");
      if (body) {
        body.innerHTML = ttsCardBodyHtml(state.draft);
        if (window.TALK_I18N?.lang === "en") window.TALK_I18N.apply(body);
        requestAnimationFrame(refreshTtsError);
      } else {
        renderSettingsContent();
      }
    },
    "cache-display"({ event, target }) {
      event.preventDefault();
      if (!state.draft) return;
      const next = target.dataset.display === "corner" ? "corner" : "borders";
      state.draft.cacheDisplay = next;
      scheduleSettingsCommit();
      $$('[data-action="cache-display"]').forEach((btn) => {
        const active = btn.dataset.display === next;
        btn.classList.toggle("active", active);
        btn.setAttribute("aria-pressed", String(active));
      });
    },
    "save-settings"({ event }) {
      event.preventDefault();
      saveSettings();
    },
    "test-connection"({ event }) {
      event.preventDefault();
      void testConnection();
    },
    "sentence-level"({ event, target }) {
      event.preventDefault();
      const level = sentenceLevelOf(target.dataset.level);
      if (state.draft) state.draft.sentenceLevel = level.id;
      scheduleSettingsCommit();
      $$('[data-action="sentence-level"]').forEach((chip) => {
        const active = chip.dataset.level === level.id;
        chip.classList.toggle("active", active);
        chip.setAttribute("aria-pressed", String(active));
      });
    },
    "gen-meta"({ event, target }) {
      event.preventDefault();
      const on = target.dataset.on === "1";
      if (state.draft) state.draft.showGenMeta = on;
      scheduleSettingsCommit();
      $$('[data-action="gen-meta"]').forEach((chip) => {
        const active = (chip.dataset.on === "1") === on;
        chip.classList.toggle("active", active);
        chip.setAttribute("aria-pressed", String(active));
      });
    },
    "reset-example-styles"({ event }) {
      event.preventDefault();
      saveExampleStyles({});
      $$("[data-example-style]").forEach((input) => {
        input.value = exampleStyleFor(input.dataset.exampleStyle);
      });
      toast("已恢复默认例句风格");
    },
    lang({ event, target }) {
      event.preventDefault();
      const next = target.dataset.lang === "en" ? "en" : "zh";
      if (window.TALK_I18N?.lang === next) return;
      window.TALK_I18N?.set(next);
      if (state.draft) state.draft.lang = next;
      renderSettingsContent();
      window.TALK_I18N?.apply(document.body);
      toast(next === "en" ? "Interface set to English" : "界面已切换为中文");
    },
    theme({ event, target }) {
      event.preventDefault();
      const nextTheme = target.dataset.theme;
      if (!nextTheme || window.TALK_THEME.current().id === nextTheme) return;
      window.TALK_THEME.apply(nextTheme);
      applyContentCopy();
      refreshThemedPage();
      if (state.route?.name === "word") {
        const current = getWord(state.route);
        if (current) scheduleThemeExamples(current);
      }
      // Update theme cards & sheet chrome in place so scroll position never jumps.
      $$('[data-action="theme"]').forEach((card) => {
        const active = card.dataset.theme === nextTheme;
        card.classList.toggle("is-active", active);
        card.setAttribute("aria-pressed", String(active));
        const badge = $(".theme-card-state", card);
        if (badge) badge.textContent = active ? (window.TALK_I18N?.lang === "en" ? "In use" : "使用中") : "";
      });
      const settingsCopy = copyFor("settings");
      const sheetTitle = $(".sheet-title", overlayRoot);
      if (sheetTitle) sheetTitle.textContent = settingsCopy.title;
      const sheetKicker = $(".sheet-head .mono", overlayRoot);
      if (sheetKicker) sheetKicker.textContent = settingsCopy.kicker;
      const tabLabelMap = Object.fromEntries(settingsCopy.tabs || []);
      $$('[data-action="settings-tab"]', overlayRoot).forEach((btn) => {
        if (tabLabelMap[btn.dataset.tab]) btn.textContent = tabLabelMap[btn.dataset.tab];
      });
      if (window.TALK_I18N?.lang === "en") window.TALK_I18N.apply(overlayRoot || document.body);
    },
    async "copy-diagnostics"() {
      const text = diagText();
      try {
        await navigator.clipboard.writeText(text);
        toast("诊断日志已复制（已脱敏）");
      } catch (_) {
        toast("复制失败，可在设置里手动查看");
      }
    },
    "clear-diagnostics"() {
      localStorage.removeItem(DIAG_KEY);
      const pre = $("#diag-preview");
      if (pre) pre.textContent = diagText().split("\n").slice(-9).join("\n");
      toast("运行日志已清空");
    },
    async "install-app"({ event, target }) {
      event.preventDefault();
      if (!state.installPrompt) {
        toast("请用浏览器菜单安装到主屏幕");
        return;
      }
      state.installPrompt.prompt();
      await state.installPrompt.userChoice.catch(() => null);
      state.installPrompt = null;
      target.hidden = true;
    }
  };

  return {
    openSettingsSheet,
    renderSettingsContent,
    scheduleSettingsCommit,
    commitSettingsDraft,
    flushSettingsDraft,
    saveSettings,
    testConnection,
    actions
  };
}
