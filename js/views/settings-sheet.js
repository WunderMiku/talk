/* ============================================================
   talk. — Settings sheet, provider/channel editor & preferences
   ============================================================ */

import { $, $$, esc, attr, shorten, tapFeedback } from "../core/utils.js";
import { icon } from "../core/icons.js";
import { DIAG_KEY } from "../core/diagnostics.js";
import { qwenTtsProfile, qwenTtsEndpoint } from "../features/tts.js";

const PROTOCOL_OPTIONS = [
  { id: "openai", label: "OpenAI 兼容" },
  { id: "google", label: "Google Gemini" }
];

const CHANNEL_PICKS = {
  google: ["gemini-3.6-flash", "gemini-2.5-flash", "gemini-2.5-pro"],
  openai: ["deepseek-chat", "gpt-4o-mini", "qwen3.7-flash", "moonshot-v1-8k"]
};

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
  return {
    id: previous.id || `channel-${Date.now()}`,
    name,
    protocol: previous.protocol || "openai",
    provider: previous.provider || ((previous.protocol === "google") ? "google" : "custom"),
    baseUrl,
    model: String(read("model") ?? previous.model ?? "").trim(),
    apiKey: String(read("apiKey") || previous.apiKey || ""),
    models: previous.models || [],
    note: previous.note || "",
    isNew: Boolean(previous.isNew)
  };
}

function channelPicks(profile, models) {
  const picks = CHANNEL_PICKS[(profile.protocol || "openai") === "google" ? "google" : "openai"] || [];
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
  wordCacheStats,
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

  function openProviderPicker() {
    openSheetShell({ kicker: "MODEL SETUP", title: "选择供应商" });
    const body = $("#sheet-scroll", overlayRoot);
    if (!body) return;
    body.innerHTML = `
      <div class="template-list">
        ${providerTemplates.map((template) => `
          <button class="template-row" type="button" data-action="provider-template" data-template="${attr(template.id)}">
            <span class="template-head">
              <strong>${esc(template.name)}</strong>
              <span class="template-badge">${(template.protocol || "openai") === "google" ? "Gemini" : "OpenAI 兼容"}</span>
            </span>
            <span class="template-url mono">${esc(template.baseUrl || "自行填写地址")}</span>
            <span class="template-note">${esc(template.note || "")}</span>
          </button>`).join("")}
      </div>`;
  }

  function renderProviderSheet() {
    const sheet = $("#sheet-scroll");
    const d = state.providerDraft;
    if (!sheet || !d) return;
    const status = state.providerStatus || {};
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
          <input data-provider-field="baseUrl" value="${attr(d.baseUrl || "")}" inputmode="url" placeholder="${d.protocol === "google" ? "https://generativelanguage.googleapis.com/v1beta" : "https://api.deepseek.com"}" autocomplete="off" spellcheck="false" />
        </label>
        <label class="provider-field"><span>API Key</span>
          <input data-provider-field="apiKey" type="password" value="${attr(d.apiKey || "")}" placeholder="sk-…" autocomplete="off" />
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
        isNew: true
      };
    state.providerStatus = null;
    openSheetShell({ kicker: "MODEL", title: existing ? "编辑模型" : "添加模型" });
    renderProviderSheet();
  }

  function ttsSettingsHtml(draft) {
    const engine = draft.ttsEngine === "qwen" ? "qwen" : "native";
    return `
      <div class="tts-head">
        <span class="settings-subhead">发音</span>
        <div class="tts-engine-switch" role="group" aria-label="发音引擎">
          <button class="tts-engine-btn ${engine === "native" ? "active" : ""}" type="button" data-action="tts-engine" data-engine="native" aria-pressed="${engine === "native"}">系统原生</button>
          <button class="tts-engine-btn ${engine === "qwen" ? "active" : ""}" type="button" data-action="tts-engine" data-engine="qwen" aria-pressed="${engine === "qwen"}">Qwen 语音</button>
        </div>
      </div>
      ${engine === "qwen" ? (() => {
        const qwen = qwenTtsProfile(draft);
        return `<div class="qwen-tts-panel">
          <div class="tts-row">
            <input id="qwen-tts-model" type="text" data-setting="qwenTtsModel" value="${attr(draft.qwenTtsModel || "qwen-audio-3.1-tts-plus")}" placeholder="qwen-audio-3.1-tts-plus" spellcheck="false" aria-label="Qwen TTS 模型" />
            <input id="qwen-tts-voice" type="text" data-setting="qwenTtsVoice" value="${attr(draft.qwenTtsVoice || "longanhuan_v3.1")}" placeholder="longanhuan_v3.1" spellcheck="false" aria-label="Qwen TTS 音色" />
            <button class="btn btn-secondary tts-test-btn" type="button" data-action="test-tts">${icon("volume")} 试听</button>
          </div>
          ${qwen ? `<p class="tts-line" id="qwen-tts-endpoint">使用「${esc(qwen.name)}」的 API 密钥 · ${esc(qwenTtsEndpoint(qwen, draft.qwenTtsModel))}</p>` : `<p class="tts-line tts-error">还没有可用的 Qwen 密钥。请先在「模型」里填写 Qwen 的 API 密钥。</p>`}
          <p class="tts-line">模型默认 qwen-audio-3.1-tts-plus；音色可填 longanhuan_v3.1 或其他 Qwen 音色。</p>
          <span class="tts-status" id="tts-test-status">${qwen ? "密钥已就绪" : "需要先配置 Qwen 密钥"}</span>
          <p class="tts-line tts-https-warning">密钥只保存在本机；语音请求由浏览器直接发往 Qwen。公共设备建议关闭「记住密钥」。</p>
        </div>`;
      })() : `
        <div class="tts-row">
          <span class="tts-line">点击即读，无需下载</span>
          <button class="btn btn-secondary tts-test-btn" type="button" data-action="test-tts">${icon("volume")} 试听</button>
        </div>
        <span class="tts-status" id="tts-test-status"></span>
        <p class="tts-error" id="tts-error" hidden></p>`}`;
  }

  function modelSettingsHtml(draft) {
    const current = activeProfile(draft);
    return `
      <div class="model-profile-head">
        <span class="settings-subhead">可用模型</span>
        <span class="mono">${draft.profiles.length} 个</span>
      </div>
      ${draft.profiles.length ? "" : '<p class="provider-empty">还没有可用的模型。点下面添加一个，填好密钥就能查词。</p>'}
      <div class="provider-list" role="list" aria-label="模型渠道">
        ${draft.profiles.map((profile) => `
          <div class="provider-row ${profile.id === draft.activeProfileId ? "is-active" : ""}" role="listitem">
            <button class="provider-select" type="button" data-action="provider-select" data-profile="${attr(profile.id)}" aria-pressed="${profile.id === draft.activeProfileId}">
              <span class="provider-row-copy">
                <strong>${esc(profile.model || "未选模型")}</strong>
                <small class="mono">${esc(profile.name || "未命名")} · ${esc(profileHost(profile))}</small>
              </span>
              ${profile.id === draft.activeProfileId ? '<i class="provider-dot" aria-hidden="true"></i>' : ""}
            </button>
            <button class="provider-edit" type="button" data-action="provider-edit" data-profile="${attr(profile.id)}">编辑</button>
          </div>`).join("")}
        <button class="provider-add" type="button" data-action="provider-new">+ 添加模型</button>
      </div>
      <div class="field">
        <label>生成深度</label>
        <div class="detail-switch" role="group" aria-label="生成深度">
          ${Object.entries(detailLevels).map(([id, item]) => `
            <button class="detail-btn ${(draft.detailLevel || "standard") === id ? "active" : ""}" type="button" data-action="detail-level" data-level="${id}" aria-pressed="${(draft.detailLevel || "standard") === id}">${item.label}</button>`).join("")}
        </div>
      </div>
      ${profileSupportsThinking(current) ? `
      <div class="thinking-panel">
        <label class="check-row">
          <input type="checkbox" data-profile-option="enableThinking" ${draft.enableThinking ? "checked" : ""} />
          开启深度思考
        </label>
        <div class="thinking-budget-row">
          <label for="thinking-budget">思考预算（tokens）</label>
          <input id="thinking-budget" type="number" min="0" max="262144" step="128" data-profile-option="thinkingBudget" value="${Number(draft.thinkingBudget) || 0}" inputmode="numeric" />
        </div>
      </div>` : ""}
      <label class="check-row">
        <input type="checkbox" data-setting="remember" ${draft.remember ? "checked" : ""} />
        在这台设备上记住密钥
      </label>
      <div class="key-status ${hasModelConfig(draft) ? "" : "off"}" id="api-test-status">
        ${hasModelConfig(draft) ? `${icon("shield")} <span>已配置 · ${esc(current?.name || draft.model || "自定义")}</span>` : "<span>演示模式 · 无需密钥</span>"}
      </div>
      <div class="settings-inline-actions">
        <button class="btn btn-secondary" type="button" data-action="test-connection" ${draft.profiles.length ? "" : "disabled"}>${icon("sparkle")} 测试当前模型</button>
      </div>
      <p class="api-note"><b>浏览器限制：</b>部分服务商会用 CORS 拦截网页直连；这里失败不代表密钥有误。把地址换成自建代理可以绕开，也能把真实密钥留在服务端。</p>`;
  }

  function dataSettingsHtml(draft) {
    const stats = wordCacheStats();
    const lang = window.TALK_I18N?.lang || "zh";
    return `
      <div class="setting-group">
        <span class="settings-subhead">界面语言</span>
        <div class="level-row">
          <button class="level-chip${lang === "zh" ? " active" : ""}" type="button" data-action="lang" data-lang="zh" aria-pressed="${lang === "zh"}">中文</button>
          <button class="level-chip${lang === "en" ? " active" : ""}" type="button" data-action="lang" data-lang="en" aria-pressed="${lang === "en"}">English</button>
        </div>
      </div>
      <div class="theme-setting">
        <span class="settings-subhead">外观主题</span>
        <div class="theme-list" role="list" aria-label="外观主题">
          ${Object.values(window.TALK_THEME.themes).map((theme) => {
            const active = window.TALK_THEME.current().id === theme.id;
            return `<div class="theme-row${active ? " is-active open" : ""}" role="listitem" data-theme-row="${attr(theme.id)}">
              <button class="theme-row-head" type="button" data-action="theme-toggle" data-theme="${attr(theme.id)}" aria-expanded="${active}">
                <span class="theme-swatch" aria-hidden="true"><i style="background:${attr(theme.themeColor || "#f3f0e7")}"></i><i style="background:${attr(theme.accentFill || theme.accent || "#171813")}"></i></span>
                <span class="theme-row-copy"><strong>${esc(theme.label)}</strong><small>${esc(theme.description || "")}</small></span>
                <span class="theme-row-state">${active ? "使用中" : ""}</span>
                <span class="theme-row-chevron" aria-hidden="true">▾</span>
              </button>
              <div class="theme-row-body">
                <div class="theme-row-inner">
                  <div class="theme-row-actions">
                    ${active
                      ? '<span class="theme-row-current">当前正在使用</span>'
                      : `<button class="btn btn-secondary theme-apply" type="button" data-action="theme" data-theme="${attr(theme.id)}">使用这套主题</button>`}
                  </div>
                </div>
              </div>
            </div>`;
          }).join("")}
        </div>
      </div>
      <div class="setting-group">
        <span class="settings-subhead">学习阶段</span>
        <p class="settings-note">只影响句子模式</p>
        <div class="level-row">
          ${sentenceLevels.map((level) => `
            <button class="level-chip${draft.sentenceLevel === level.id ? " active" : ""}" type="button"
              data-action="sentence-level" data-level="${attr(level.id)}" aria-pressed="${draft.sentenceLevel === level.id}"
              title="${attr(level.hint)}">${esc(level.label)}</button>`).join("")}
        </div>
      </div>
      <div class="setting-group">
        <span class="settings-subhead">从句展开方式</span>
        <div class="level-row">
          <button class="level-chip${(draft.foldMode || "block") === "block" ? " active" : ""}" type="button" data-action="fold-mode" data-mode="block" aria-pressed="${(draft.foldMode || "block") === "block"}">缩进块</button>
          <button class="level-chip${draft.foldMode === "inline" ? " active" : ""}" type="button" data-action="fold-mode" data-mode="inline" aria-pressed="${draft.foldMode === "inline"}">句内插入</button>
        </div>
      </div>
      <div class="setting-group">
        <span class="settings-subhead">语境寻词长度</span>
        <p class="settings-note"><span id="reverse-token-value">${Number(draft.reverseMaxTokens) || 1500}</span> tokens · <span id="reverse-token-zone">${reverseZoneName(Number(draft.reverseMaxTokens) || 1500)}</span></p>
        <input class="setting-range" type="range" min="600" max="3000" step="100"
          value="${Number(draft.reverseMaxTokens) || 1500}" data-setting="reverseMaxTokens" aria-label="语境寻词输出上限" />
        <div class="token-scale" id="reverse-token-scale">
          <span class="token-zone${(Number(draft.reverseMaxTokens) || 1500) < 1000 ? " is-active" : ""}" style="flex:4">只给结论</span>
          <span class="token-zone${(Number(draft.reverseMaxTokens) || 1500) >= 1000 && (Number(draft.reverseMaxTokens) || 1500) < 2000 ? " is-active" : ""}" style="flex:10">分块讲解</span>
          <span class="token-zone${(Number(draft.reverseMaxTokens) || 1500) >= 2000 ? " is-active" : ""}" style="flex:10">成句拆解</span>
        </div>
        <div class="token-ticks">
          <span style="left:0">600</span>
          <span style="left:16.7%">1000</span>
          <span style="left:58.3%">2000</span>
          <span style="left:100%">3000</span>
        </div>
      </div>
      <div class="setting-group">
        <span class="settings-subhead">生成信息</span>
        <div class="level-row">
          <button class="level-chip${draft.showGenMeta !== false ? " active" : ""}" type="button" data-action="gen-meta" data-on="1" aria-pressed="${draft.showGenMeta !== false}">显示</button>
          <button class="level-chip${draft.showGenMeta === false ? " active" : ""}" type="button" data-action="gen-meta" data-on="0" aria-pressed="${draft.showGenMeta === false}">隐藏</button>
        </div>
      </div>
      <div class="setting-group">
        <span class="settings-subhead">例句风格</span>
        <p class="settings-note">只影响之后生成的例句</p>
        <div class="example-style-list">
          ${(window.TALK_THEME?.list?.() || []).map((theme) => `
            <label class="example-style-row">
              <span>${esc(theme.label)}</span>
              <input type="text" data-example-style="${attr(theme.id)}" value="${attr(exampleStyleFor(theme.id))}" spellcheck="false" aria-label="${attr(theme.label)} 的例句风格" />
            </label>`).join("")}
        </div>
        <button class="link-btn" type="button" data-action="reset-example-styles">恢复默认风格</button>
      </div>
      <label class="pref-toggle">
        <span class="pref-copy">
          <strong>预加载二级词条</strong>
          <span>词页出现后，在后台生成最多 ${prefetchLimit} 个相关词；会额外消耗模型额度。</span>
        </span>
        <span class="pref-switch">
          <input type="checkbox" data-setting="prefetch" ${draft.prefetch ? "checked" : ""} />
          <span class="pref-slider" aria-hidden="true"></span>
        </span>
      </label>
      <div class="cache-display-setting">
        <span class="pref-copy">
          <strong>缓存提示方式</strong>
          <span>虚线未缓存，实线已缓存</span>
        </span>
        <div class="cache-display-switch" role="group" aria-label="缓存提示方式">
          <button class="cache-display-btn ${draft.cacheDisplay !== "corner" ? "active" : ""}" type="button" data-action="cache-display" data-display="borders" aria-pressed="${draft.cacheDisplay !== "corner"}">边框</button>
          <button class="cache-display-btn ${draft.cacheDisplay === "corner" ? "active" : ""}" type="button" data-action="cache-display" data-display="corner" aria-pressed="${draft.cacheDisplay === "corner"}">三角标</button>
        </div>
      </div>
      <div class="cache-settings-summary">
        <span><strong>${stats.count}</strong> / ${stats.max} 个词条</span>
        <span>${formatBytes(stats.bytes)} · ${stats.backend}</span>
      </div>
      <p class="field-hint">句子分析缓存 ${sentenceCache.size} 条（按原文、深度、水平区分），可单独删除或整表清空。</p>
      <div class="cache-actions">
        <button class="btn btn-secondary cache-action-btn" type="button" data-action="open-cache">${icon("archive")} 缓存管理</button>
        <button class="btn btn-secondary cache-action-btn" type="button" data-action="export-word-cache">导出 JSON</button>
        <button class="btn btn-secondary cache-action-btn" type="button" data-action="import-word-cache">导入 JSON</button>
        <button class="btn btn-secondary cache-action-btn" type="button" data-action="clear-sentence-cache">清空句子</button>
        <input id="word-cache-file" type="file" accept="application/json,.json" hidden />
      </div>
      <div class="theme-cache-setting">
        <span class="settings-subhead">主题库</span>
        <div id="theme-cache-stats"><p class="api-note">正在读取主题缓存…</p></div>
        <button class="link-btn" type="button" data-action="clear-theme-cache">清空主题库</button>
      </div>
      <div class="diag-card">
        <span class="settings-subhead">运行日志</span>
        <p class="api-note">只记录请求类型、字符数与错误文本；密钥、令牌和长串已脱敏。出问题时复制它发给开发者。</p>
        <pre class="diag-preview" id="diag-preview">${esc(diagText().split("\n").slice(-9).join("\n"))}</pre>
        <div class="cache-actions">
          <button class="btn btn-secondary cache-action-btn" type="button" data-action="copy-diagnostics">${icon("copy")} 复制诊断</button>
          <button class="btn btn-secondary cache-action-btn" type="button" data-action="clear-diagnostics">清空日志</button>
        </div>
      </div>
      <button class="btn btn-secondary install-settings-btn" id="install-app" type="button" data-action="install-app" ${state.installPrompt ? "" : "hidden"}>${icon("external")} 安装到主屏幕</button>
`;
  }

  function renderSettingsContent() {
    const holder = $("#sheet-scroll");
    if (!holder || !state.draft) return;
    const prevScroll = holder.scrollTop;
    const draft = state.draft;
    const tab = state.settingsTab || "model";
    const settingsCopy = copyFor("settings");
    const tabs = settingsCopy.tabs;
    const sheetTitle = $(".sheet-title", overlayRoot);
    if (sheetTitle) sheetTitle.textContent = settingsCopy.title;
    const sheetKicker = $(".sheet-head .mono", overlayRoot);
    if (sheetKicker) sheetKicker.textContent = settingsCopy.kicker;
    holder.innerHTML = `
      <div class="sheet-content settings-sheet">
        <div class="settings-tabs" role="tablist" aria-label="设置分类">
          ${tabs.map(([id, label]) => `<button class="settings-tab ${tab === id ? "active" : ""}" type="button" role="tab" aria-selected="${tab === id}" data-action="settings-tab" data-tab="${id}">${label}</button>`).join("")}
        </div>
        <div class="settings-pane" role="tabpanel">
          ${tab === "tts" ? ttsSettingsHtml(draft) : tab === "data" ? dataSettingsHtml(draft) : modelSettingsHtml(draft)}
        </div>
        <div class="settings-footer">
          <span id="settings-save-status"><span data-app-version>v${appVersion}</span> · build <span data-app-build>${appBuild}</span> · ${state.settingsDirty ? "正在保存…" : "更改自动保存"}</span>
          <button class="btn btn-primary" type="button" data-action="save-settings">完成</button>
        </div>
      </div>`;
    holder.scrollTop = prevScroll;
    window.TALK_I18N?.apply(overlayRoot || document.body);
    if (tab === "tts") requestAnimationFrame(refreshTtsError);
    if (tab === "data") requestAnimationFrame(renderThemeCacheStats);
  }

  function openSettingsSheet() {
    state.settingsOpen = true;
    state.settingsDirty = false;
    state.settingsTab = state.settingsTab || "model";
    state.draft = {
      ...state.settings,
      profiles: (state.settings.profiles || []).map((profile) => ({ ...profile }))
    };
    const copy = copyFor("settings");
    openSheetShell({ kicker: copy.kicker, title: copy.title });
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
    "settings-tab"({ event, target }) {
      event.preventDefault();
      state.settingsTab = target.dataset.tab || "model";
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
      const next = readProviderForm(state.providerDraft);
      next.protocol = target.dataset.protocol || "openai";
      next.provider = next.protocol === "google" ? "google" : (next.provider === "google" ? "custom" : next.provider);
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
      state.settingsOpen = true;
      state.providerDraft = null;
      state.providerStatus = null;
      if (state.sheetOpen && $("#sheet-scroll")) {
        renderSettingsContent();
        $("#sheet-scroll")?.scrollTo({ top: 0 });
      } else {
        openSettingsSheet();
      }
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
      state.settingsOpen = true;
      state.providerDraft = null;
      state.providerStatus = null;
      if (state.sheetOpen && $("#sheet-scroll")) {
        renderSettingsContent();
        $("#sheet-scroll")?.scrollTo({ top: 0 });
      } else {
        openSettingsSheet();
      }
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
      state.draft.detailLevel = target.dataset.level || "standard";
      scheduleSettingsCommit();
      renderSettingsContent();
    },
    "tts-engine"({ event, target }) {
      event.preventDefault();
      if (!state.draft) return;
      state.draft.ttsEngine = target.dataset.engine === "qwen" ? "qwen" : "native";
      scheduleSettingsCommit();
      renderSettingsContent();
    },
    "cache-display"({ event, target }) {
      event.preventDefault();
      if (!state.draft) return;
      state.draft.cacheDisplay = target.dataset.display === "corner" ? "corner" : "borders";
      scheduleSettingsCommit();
      renderSettingsContent();
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
    "fold-mode"({ event, target }) {
      event.preventDefault();
      const mode = target.dataset.mode === "inline" ? "inline" : "block";
      if (state.draft) state.draft.foldMode = mode;
      scheduleSettingsCommit();
      $$('[data-action="fold-mode"]').forEach((chip) => {
        const active = chip.dataset.mode === mode;
        chip.classList.toggle("active", active);
        chip.setAttribute("aria-pressed", String(active));
      });
      if (state.route?.name === "sentence") refreshThemedPage();
    },
    "reset-example-styles"({ event }) {
      event.preventDefault();
      saveExampleStyles({});
      $$("[data-example-style]").forEach((input) => {
        input.value = exampleStyleFor(input.dataset.exampleStyle);
      });
      toast("已恢复默认例句风格");
    },
    "theme-toggle"({ event, target }) {
      event.preventDefault();
      const row = target.closest(".theme-row");
      if (!row) return;
      const willOpen = !row.classList.contains("open");
      $$(".theme-row.open").forEach((other) => {
        other.classList.remove("open");
        const head = other.querySelector(".theme-row-head");
        if (head) head.setAttribute("aria-expanded", "false");
      });
      row.classList.toggle("open", willOpen);
      target.setAttribute("aria-expanded", String(willOpen));
    },
    lang({ event, target }) {
      event.preventDefault();
      const next = target.dataset.lang === "en" ? "en" : "zh";
      window.TALK_I18N?.set(next);
      if (state.draft) state.draft.lang = next;
      renderSettingsContent();
      window.TALK_I18N?.apply(document.body);
      toast(next === "en" ? "Interface set to English" : "界面已切换为中文");
    },
    theme({ event, target }) {
      event.preventDefault();
      window.TALK_THEME.apply(target.dataset.theme);
      applyContentCopy();
      refreshThemedPage();
      if (state.route?.name === "word") {
        const current = getWord(state.route);
        if (current) scheduleThemeExamples(current);
      }
      renderSettingsContent();
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
      renderSettingsContent();
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
