import { FormEvent, useEffect, useState } from "react";
import { Check, Feather, RefreshCw, X } from "lucide-react";
import type { ProfileResponse, ProfileSignal } from "../lib/api";

export type MemorySubpage = "traces" | "kept" | "profile" | "imprints";

export function TraceSectionNav({ active, onSelect }: { active: MemorySubpage; onSelect: (section: MemorySubpage) => void }) {
  const sections: Array<{ id: MemorySubpage; label: string }> = [
    { id: "traces", label: "最近留下" },
    { id: "kept", label: "长期留下" },
    { id: "profile", label: "慢慢形成" },
    { id: "imprints", label: "印记" },
  ];

  return (
    <nav className="trace-section-nav" aria-label="留痕视图">
      {sections.map((section) => (
        <button
          aria-current={active === section.id ? "page" : undefined}
          className={active === section.id ? "is-active" : ""}
          key={section.id}
          onClick={() => onSelect(section.id)}
          type="button"
        >{section.label}</button>
      ))}
    </nav>
  );
}

export function ProfilePage({
  profile,
  onRefresh,
  onOverride,
}: {
  profile: ProfileResponse | null;
  onRefresh: () => Promise<unknown>;
  onOverride: (key: string, value: string) => Promise<unknown>;
}) {
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const signals = readableProfileSignals(profile);
  const profileNote = readableProfileNote(profile);

  useEffect(() => {
    if (!editingKey) setDraft("");
  }, [editingKey]);

  const startCorrection = (signal: ProfileSignal) => {
    if (!signal.key) return;
    setEditingKey(signal.key);
    setDraft(signal.value || "");
    setNotice(null);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!editingKey || !draft.trim()) return;
    setSaving(true);
    try {
      await onOverride(editingKey, draft.trim());
      setNotice("这条理解已经按你的说法修正。");
      setEditingKey(null);
    } catch (error) {
      setNotice(error instanceof Error ? `暂时没能修正：${error.message}` : "暂时没能修正这条理解。");
    } finally {
      setSaving(false);
    }
  };

  const refresh = async () => {
    setSaving(true);
    setNotice("正在重新回看长期留下的线索……");
    try {
      await onRefresh();
      setNotice("这些理解已经根据现有留痕重新整理。");
    } catch (error) {
      setNotice(error instanceof Error ? `暂时没能重新整理：${error.message}` : "暂时没能重新整理。");
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="profile-page" aria-labelledby="profile-title">
      <header className="profile-heading">
        <span><Feather aria-hidden="true" size={13} /> 从反复出现的线索里</span>
        <h1 id="profile-title">慢慢形成</h1>
        <p>{profileNote}</p>
        <button disabled={saving} onClick={() => void refresh()} type="button"><RefreshCw aria-hidden="true" size={12} /> 重新整理</button>
      </header>

      <div className="profile-list">
        {signals.length === 0 ? (
          <div className="profile-empty">还没有形成稳定的长期理解。先留下几段真实对话即可。</div>
        ) : signals.map((signal, index) => (
          <article className="profile-signal" key={signal.key || index}>
            <span>{profileLabel(signal.key)}</span>
            <p>{signal.value || "这条理解还没有写完整。"}</p>
            {editingKey === signal.key ? (
              <form onSubmit={submit}>
                <input aria-label="写下更准确的说法" autoFocus onChange={(event) => setDraft(event.target.value)} value={draft} />
                <button aria-label="保存修正" disabled={saving || !draft.trim()} type="submit"><Check aria-hidden="true" size={12} /></button>
                <button aria-label="取消修正" onClick={() => setEditingKey(null)} type="button"><X aria-hidden="true" size={12} /></button>
              </form>
            ) : (
              <button onClick={() => startCorrection(signal)} type="button">这条不准确</button>
            )}
          </article>
        ))}
      </div>
      {notice && <p className="profile-notice" role="status">{notice}</p>}
    </section>
  );
}

function profileLabel(key?: string) {
  const labels: Record<string, string> = {
    communication_style: "更舒服的交流方式",
    learning_style: "学习时更顺手的方式",
    preferred_learning_style: "学习时更顺手的方式",
    recurring_pattern: "反复出现的模式",
    motivation: "更容易继续的动力",
    focus: "长期在意的方向",
    emotional_pattern: "常出现的感受",
    active_growth_area: "正在生长的方向",
    current_learning_focus: "当前学习重心",
    echo_interaction_style: "更舒服的陪伴方式",
    emotional_baseline: "近期常见的感受",
    learning_preference: "学习时更顺手的方式",
    preferred_language: "更习惯使用的语言",
    sustained_learning_topic: "持续出现的学习线",
  };
  return key && labels[key] ? labels[key] : "一条慢慢形成的理解";
}

function readableProfileSignals(profile: ProfileResponse | null) {
  const summary = profile?.summary;
  if (summary && typeof summary === "object") {
    const preferred = [...(summary.stable_signals || []), ...(summary.developing_signals || [])];
    if (preferred.length > 0) {
      return preferred.filter((signal, index) => (
        signal.key && preferred.findIndex((candidate) => candidate.key === signal.key) === index
      ));
    }
  }
  return profile?.profile || [];
}

function readableProfileNote(profile: ProfileResponse | null) {
  if (typeof profile?.summary === "string" && profile.summary.trim()) return profile.summary;
  if (profile?.summary && typeof profile.summary === "object" && profile.summary.profile_note) {
    return profile.summary.profile_note;
  }
  return "这里记录 Margin 对你的长期理解。它可以被你随时修正。";
}
