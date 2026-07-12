import { Archive, CheckCircle2, Feather, MessageCircle, Route, Sparkles, Sprout, Target, type LucideIcon } from "lucide-react";
import { useState } from "react";
import type { AchievementResponse, ProfileResponse } from "../lib/api";
import type { ShelfItem } from "../types";
import { resolveTraceSlots, type TraceFocus, type TracePageModel } from "../viewModels/paperWorkspace";
import ImprintCollection from "./ImprintCollection";
import { ProfilePage } from "./TraceSections";

interface TraceWorkspaceProps {
  achievements: AchievementResponse | null;
  keptItems: ShelfItem[];
  keptSummary: string;
  model: TracePageModel;
  notice?: string | null;
  profile: ProfileResponse | null;
  onAcknowledge?: (key: string) => Promise<unknown> | void;
  onOpenManagement: () => void;
  onOverride: (key: string, value: string) => Promise<unknown>;
  onRefreshProfile: () => Promise<unknown>;
}

type TraceMode = "recent" | "kept";

const COIN_ICONS: Record<string, LucideIcon> = {
  new_path: Route,
  first_step: Sprout,
  breakthrough: Sparkles,
  action_done: Target,
  completion: Feather,
  memory_cleanse: MessageCircle,
};

function weekday(timestamp?: string) {
  if (!timestamp) return "";
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString("zh-CN", { weekday: "short" });
}

export default function TraceWorkspace({
  achievements,
  keptItems,
  keptSummary,
  model,
  notice,
  profile,
  onAcknowledge,
  onOpenManagement,
  onOverride,
  onRefreshProfile,
}: TraceWorkspaceProps) {
  const [focus, setFocus] = useState<TraceFocus>("traces");
  const [traceMode, setTraceMode] = useState<TraceMode>("recent");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const slots = resolveTraceSlots(focus);
  const focusPanel = (panel: TraceFocus) => {
    if (panel !== "traces") setTraceMode("recent");
    setFocus(panel);
  };

  const renderPanel = (panel: TraceFocus, primary: boolean) => {
    if (panel === "patterns") {
      return primary ? (
        <ProfilePage onOverride={onOverride} onRefresh={onRefreshProfile} profile={profile} />
      ) : (
        <PatternsSummary model={model} onFocus={() => focusPanel("patterns")} />
      );
    }

    if (panel === "imprints") {
      return primary ? (
        <ImprintCollection achievements={achievements} onAcknowledge={onAcknowledge} onBack={() => setFocus("traces")} />
      ) : (
        <ImprintsSummary model={model} onFocus={() => focusPanel("imprints")} />
      );
    }

    return primary ? (
      <TraceRecords
        expandedId={expandedId}
        keptItems={keptItems}
        keptSummary={keptSummary}
        mode={traceMode}
        model={model}
        notice={notice}
        onChangeMode={setTraceMode}
        onOpenManagement={onOpenManagement}
        onToggleExpanded={(id) => setExpandedId(expandedId === id ? null : id)}
      />
    ) : (
      <TracesSummary
        keptCount={keptItems.length}
        mode={traceMode}
        model={model}
        onFocus={() => setFocus("traces")}
      />
    );
  };

  return (
    <section className="trace-workspace" aria-label="留痕工作区">
      <main className={`trace-primary-panel is-${slots.left}`} key={slots.left}>
        {renderPanel(slots.left, true)}
      </main>
      <aside className="trace-insight-page">
        <section className={`trace-secondary-panel is-${slots.rightTop}`} key={`top-${slots.rightTop}`}>
          {renderPanel(slots.rightTop, false)}
        </section>
        <section className={`trace-secondary-panel is-${slots.rightBottom}`} key={`bottom-${slots.rightBottom}`}>
          {renderPanel(slots.rightBottom, false)}
        </section>
      </aside>
    </section>
  );
}

function TraceModeSwitch({ mode, onChange }: { mode: TraceMode; onChange: (mode: TraceMode) => void }) {
  return (
    <div className="trace-mode-switch" aria-label="留痕范围">
      <button aria-pressed={mode === "recent"} onClick={() => onChange("recent")} type="button">最近留下</button>
      <button aria-pressed={mode === "kept"} onClick={() => onChange("kept")} type="button">长期留下</button>
    </div>
  );
}

function TraceRecords({
  expandedId,
  keptItems,
  keptSummary,
  mode,
  model,
  notice,
  onChangeMode,
  onOpenManagement,
  onToggleExpanded,
}: {
  expandedId: string | null;
  keptItems: ShelfItem[];
  keptSummary: string;
  mode: TraceMode;
  model: TracePageModel;
  notice?: string | null;
  onChangeMode: (mode: TraceMode) => void;
  onOpenManagement: () => void;
  onToggleExpanded: (id: string) => void;
}) {
  return (
    <div className="trace-list-page">
      <header className="trace-heading">
        <div className="trace-heading-row">
          <div>
            <h1>{mode === "recent" ? "最近留下" : "长期留下"}</h1>
            <p>{mode === "recent" ? "最近 10 条 · 按留下的日期" : keptSummary}</p>
          </div>
          <TraceModeSwitch mode={mode} onChange={onChangeMode} />
        </div>
      </header>

      {mode === "recent" ? (
        <div className="trace-date-groups">
          {model.groups.length === 0 ? (
            <p className="trace-empty">还没有留下足够清楚的片段。真实对话和成长记录会慢慢出现在这里。</p>
          ) : model.groups.map((group) => (
            <section className="trace-date-group" key={group.dateKey}>
              <h2>{group.dateLabel}<span>{weekday(group.items[0]?.timestamp)}</span></h2>
              {group.items.map((item) => {
                const expanded = item.id === expandedId;
                return (
                  <article className={`trace-item${expanded ? " trace-item-expanded" : ""}`} key={item.id}>
                    <button aria-expanded={expanded} onClick={() => onToggleExpanded(item.id)} type="button">
                      <span className="trace-dot" />
                      <strong>{item.text}</strong>
                      <small>{item.source}</small>
                      <time>{item.timeLabel}</time>
                    </button>
                    {expanded && (
                      <div className="trace-expanded-copy">
                        <span>原始上下文</span>
                        <p>{item.context || "这条留痕没有附带更多原文。"}</p>
                        <button onClick={() => onToggleExpanded(item.id)} type="button">收起</button>
                      </div>
                    )}
                  </article>
                );
              })}
            </section>
          ))}
        </div>
      ) : (
        <div className="kept-trace-list">
          {notice && <div className="shelf-notice" role="status">{notice}</div>}
          {keptItems.length === 0 ? (
            <p className="trace-empty">还没有被主动留下的内容。值得长期回看的片段会收在这里。</p>
          ) : keptItems.map((item) => (
            <article key={item.id} style={{ "--item-accent": item.accent || "#8b7355" } as React.CSSProperties}>
              <CheckCircle2 aria-hidden="true" size={15} />
              <div><span>{item.eyebrow}</span><h2>{item.title}</h2><p>{item.detail}</p></div>
              {item.actionLabel && <button disabled={item.actionDisabled} onClick={item.onAction} type="button">{item.actionLabel}</button>}
            </article>
          ))}
          <button className="trace-manage-link" onClick={onOpenManagement} type="button"><Archive aria-hidden="true" size={13} /> 整理这些留痕</button>
        </div>
      )}
    </div>
  );
}

function PatternsSummary({ model, onFocus }: { model: TracePageModel; onFocus: () => void }) {
  return (
    <section className="trace-patterns">
      <header><h2>慢慢形成</h2><button onClick={onFocus} type="button">查看全部</button></header>
      {model.patterns.length === 0 ? (
        <p className="trace-side-empty">还没有形成稳定的长期理解。</p>
      ) : model.patterns.map((pattern) => (
        <article key={pattern.key}>
          <p>{pattern.value}</p>
          <footer>
            <span className={pattern.status === "confirmed" ? "is-confirmed" : "is-pending"}>
              {pattern.status === "confirmed" ? "已经确认" : "等待确认"}
            </span>
            {pattern.status === "pending" && <button onClick={onFocus} type="button">去确认</button>}
          </footer>
        </article>
      ))}
    </section>
  );
}

function ImprintsSummary({ model, onFocus }: { model: TracePageModel; onFocus: () => void }) {
  return (
    <section className="trace-recent-imprints">
      <header><h2>最近印记</h2><button onClick={onFocus} type="button">查看全部</button></header>
      <div className="recent-imprint-coins">
        {model.recentImprints.map((record, index) => {
          const Icon = COIN_ICONS[record.icon_type || ""] || Feather;
          return (
            <button aria-label={record.title || `第 ${index + 1} 枚成长印记`} key={record.key || record.id} onClick={onFocus} type="button">
              <Icon aria-hidden="true" size={21} strokeWidth={1.35} />
            </button>
          );
        })}
      </div>
      <p>共 {model.imprintTotal} 枚</p>
    </section>
  );
}

function TracesSummary({
  keptCount,
  mode,
  model,
  onFocus,
}: {
  keptCount: number;
  mode: TraceMode;
  model: TracePageModel;
  onFocus: () => void;
}) {
  const recentCount = model.groups.reduce((total, group) => total + group.items.length, 0);
  return (
    <section className="trace-summary-panel">
      <header><h2>{mode === "recent" ? "最近留下" : "长期留下"}</h2><button onClick={onFocus} type="button">回到左侧</button></header>
      <p>{mode === "recent" ? `最近收好了 ${recentCount} 条片段。` : `已有 ${keptCount} 条内容值得长期回看。`}</p>
    </section>
  );
}
