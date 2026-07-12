import { Feather, MessageCircle, Route, Sparkles, Sprout, Target, type LucideIcon } from "lucide-react";
import { useState } from "react";
import type { TracePageModel } from "../viewModels/paperWorkspace";

interface TraceWorkspaceProps {
  model: TracePageModel;
  onOpenImprints: () => void;
  onOpenProfile: () => void;
}

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

export default function TraceWorkspace({ model, onOpenImprints, onOpenProfile }: TraceWorkspaceProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  return (
    <section className="trace-workspace" aria-label="留痕工作区">
      <div className="trace-list-page">
        <header className="trace-heading">
          <h1>最近留下</h1>
          <p>最近 10 条 · 按留下的日期</p>
        </header>

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
                    <button aria-expanded={expanded} onClick={() => setExpandedId(expanded ? null : item.id)} type="button">
                      <span className="trace-dot" />
                      <strong>{item.text}</strong>
                      <small>{item.source}</small>
                      <time>{item.timeLabel}</time>
                    </button>
                    {expanded && (
                      <div className="trace-expanded-copy">
                        <span>原始上下文</span>
                        <p>{item.context || "这条留痕没有附带更多原文。"}</p>
                        <button onClick={() => setExpandedId(null)} type="button">收起</button>
                      </div>
                    )}
                  </article>
                );
              })}
            </section>
          ))}
        </div>
      </div>

      <aside className="trace-insight-page">
        <section className="trace-patterns">
          <header><h2>慢慢形成</h2><button onClick={onOpenProfile} type="button">查看全部</button></header>
          {model.patterns.length === 0 ? (
            <p className="trace-side-empty">还没有形成稳定的长期理解。</p>
          ) : model.patterns.map((pattern) => (
            <article key={pattern.key}>
              <p>{pattern.value}</p>
              <footer>
                <span className={pattern.status === "confirmed" ? "is-confirmed" : "is-pending"}>
                  {pattern.status === "confirmed" ? "已经确认" : "等待确认"}
                </span>
                {pattern.status === "pending" && <button onClick={onOpenProfile} type="button">去确认</button>}
              </footer>
            </article>
          ))}
        </section>

        <section className="trace-recent-imprints">
          <header><h2>最近印记</h2><button onClick={onOpenImprints} type="button">查看全部</button></header>
          <div className="recent-imprint-coins">
            {model.recentImprints.map((record, index) => {
              const Icon = COIN_ICONS[record.icon_type || ""] || Feather;
              return (
                <button aria-label={record.title || `第 ${index + 1} 枚成长印记`} key={record.key || record.id} onClick={onOpenImprints} type="button">
                  <Icon aria-hidden="true" size={21} strokeWidth={1.35} />
                </button>
              );
            })}
          </div>
          <p>共 {model.imprintTotal} 枚</p>
        </section>
      </aside>
    </section>
  );
}
