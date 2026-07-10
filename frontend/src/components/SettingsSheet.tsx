import { FormEvent, useEffect, useState } from "react";
import { Check, ExternalLink, KeyRound, SlidersHorizontal, Volume2 } from "lucide-react";
import type { MarginProvider, MarginSettingsPatch, MarginSettingsSnapshot } from "../electron";

interface SettingsSheetProps {
  settings: MarginSettingsSnapshot;
  desktopAvailable: boolean;
  saving: boolean;
  notice?: string | null;
  onSave: (patch: MarginSettingsPatch) => Promise<void>;
  onOpenManagement?: () => void;
}

const PROVIDERS: Array<{ value: MarginProvider; label: string }> = [
  { value: "local", label: "本地陪伴" },
  { value: "openai", label: "OpenAI" },
  { value: "anthropic", label: "Anthropic" },
  { value: "siliconflow", label: "SiliconFlow" },
];

function defaultModel(provider: MarginProvider) {
  const defaults: Record<MarginProvider, string> = {
    local: "margin-local",
    openai: "gpt-4.1-mini",
    anthropic: "claude-3-5-sonnet-latest",
    siliconflow: "deepseek-ai/DeepSeek-V3.2",
  };
  return defaults[provider];
}

export default function SettingsSheet({
  settings,
  desktopAvailable,
  saving,
  notice,
  onSave,
  onOpenManagement,
}: SettingsSheetProps) {
  const [provider, setProvider] = useState(settings.conversation.provider);
  const [model, setModel] = useState(settings.conversation.model);
  const [conversationKey, setConversationKey] = useState("");
  const [speechKey, setSpeechKey] = useState("");
  const [lightReadingEnabled, setLightReadingEnabled] = useState(settings.preferences.lightReadingEnabled);
  const [motion, setMotion] = useState(settings.preferences.motion);
  const [fontScale, setFontScale] = useState(settings.preferences.fontScale);

  useEffect(() => {
    setProvider(settings.conversation.provider);
    setModel(settings.conversation.model);
    setLightReadingEnabled(settings.preferences.lightReadingEnabled);
    setMotion(settings.preferences.motion);
    setFontScale(settings.preferences.fontScale);
    setConversationKey("");
    setSpeechKey("");
  }, [settings]);

  const handleProviderChange = (nextProvider: MarginProvider) => {
    setProvider(nextProvider);
    setModel(defaultModel(nextProvider));
    setConversationKey("");
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const secrets: MarginSettingsPatch["secrets"] = {};
    if (provider !== "local" && conversationKey.trim()) secrets[provider] = conversationKey.trim();
    if (speechKey.trim()) secrets.siliconflow = speechKey.trim();

    await onSave({
      conversation: { provider, model: model.trim() || defaultModel(provider) },
      preferences: { lightReadingEnabled, motion, fontScale },
      secrets,
    });
  };

  const providerKeyState = provider === "local" ? null : settings.keys[provider];
  const speechKeyState = settings.keys.siliconflow;
  const speechReady = speechKeyState.configured || Boolean(speechKey.trim()) || (provider === "siliconflow" && Boolean(conversationKey.trim()));

  return (
    <section className="settings-sheet workspace-page" aria-labelledby="settings-title">
      <header className="settings-heading">
        <span>Settings paper · 01</span>
        <h1 id="settings-title">设置</h1>
        <p>把供应商、声音与纸页偏好收在这里。密钥只在桌面主进程中加密保存。</p>
      </header>

      <form className="settings-form" onSubmit={submit}>
        <section className="settings-group">
          <div className="settings-group-title">
            <KeyRound aria-hidden="true" size={15} />
            <div><h2>对话</h2><p>决定 Margin 使用哪一种模型继续你的线索。</p></div>
          </div>
          <label>
            <span>供应商</span>
            <select value={provider} onChange={(event) => handleProviderChange(event.target.value as MarginProvider)}>
              {PROVIDERS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
            </select>
          </label>
          <label>
            <span>模型</span>
            <input value={model} onChange={(event) => setModel(event.target.value)} />
          </label>
          {providerKeyState && (
            <label>
              <span>API Key <KeyStatus configured={providerKeyState.configured} /></span>
              <input
                autoComplete="off"
                disabled={!desktopAvailable || !settings.secureStorageAvailable}
                onChange={(event) => setConversationKey(event.target.value)}
                placeholder={providerKeyState.configured ? `${providerKeyState.masked} · 留空则不更改` : "输入后将加密保存"}
                type="password"
                value={conversationKey}
              />
            </label>
          )}
        </section>

        <section className="settings-group">
          <div className="settings-group-title">
            <Volume2 aria-hidden="true" size={15} />
            <div><h2>声音</h2><p>轻读负责朗读新回复；麦克风只在点击后进行云端转写。</p></div>
          </div>
          {provider === "siliconflow" ? (
            <p className="settings-key-note">声音服务复用上方的 SiliconFlow Key，不会再保存第二份密钥。</p>
          ) : (
            <label>
              <span>SiliconFlow Key <KeyStatus configured={speechKeyState.configured} /></span>
              <input
                autoComplete="off"
                disabled={!desktopAvailable || !settings.secureStorageAvailable}
                onChange={(event) => setSpeechKey(event.target.value)}
                placeholder={speechKeyState.configured ? `${speechKeyState.masked} · 留空则不更改` : "TTS 与 STT 共用此密钥"}
                type="password"
                value={speechKey}
              />
            </label>
          )}
          <ToggleRow
            checked={lightReadingEnabled}
            disabled={!speechReady}
            label="自动轻读新回复"
            note="首次安装默认关闭；开启后只读新生成的回复。"
            onChange={setLightReadingEnabled}
          />
        </section>

        <section className="settings-group">
          <div className="settings-group-title">
            <SlidersHorizontal aria-hidden="true" size={15} />
            <div><h2>纸页</h2><p>调整阅读尺度，并决定是否保留墨迹显现动画。</p></div>
          </div>
          <label>
            <span>字号 {Math.round(fontScale * 100)}%</span>
            <input max="1.16" min="0.92" onChange={(event) => setFontScale(Number(event.target.value))} step="0.04" type="range" value={fontScale} />
          </label>
          <ToggleRow
            checked={motion === "reduced"}
            label="减少动效"
            note="保留层级变化，取消纸张位移与线段绘制。"
            onChange={(enabled) => setMotion(enabled ? "reduced" : "full")}
          />
        </section>

        <footer className="settings-actions">
          <div>
            {!desktopAvailable && <p>浏览器预览不保存密钥，请在桌面应用中配置。</p>}
            {desktopAvailable && !settings.secureStorageAvailable && <p>系统安全存储不可用，密钥保存已暂停。</p>}
            {notice && <p className="settings-notice" role="status">{notice}</p>}
          </div>
          {onOpenManagement && (
            <button className="text-action" onClick={onOpenManagement} type="button">
              打开全部整理 <ExternalLink aria-hidden="true" size={12} />
            </button>
          )}
          <button className="primary-paper-action" disabled={saving || !desktopAvailable} type="submit">
            {saving ? "正在验证并应用……" : "验证并应用"}
          </button>
        </footer>
      </form>
    </section>
  );
}

function KeyStatus({ configured }: { configured: boolean }) {
  return <small className={configured ? "is-configured" : ""}>{configured && <Check aria-hidden="true" size={10} />}{configured ? "已配置" : "未配置"}</small>;
}

function ToggleRow({
  checked,
  disabled = false,
  label,
  note,
  onChange,
}: {
  checked: boolean;
  disabled?: boolean;
  label: string;
  note: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div className="settings-toggle-row">
      <div><strong>{label}</strong><p>{note}</p></div>
      <button
        aria-label={checked ? `关闭${label}` : `开启${label}`}
        aria-pressed={checked}
        className={`paper-switch${checked ? " is-on" : ""}`}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        type="button"
      ><span /></button>
    </div>
  );
}
