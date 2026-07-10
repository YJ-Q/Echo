import { Archive, Award, Brain, CheckCircle2, Sparkles } from "lucide-react";
import type { ShelfItem } from "../types";

interface ShelfViewProps {
  section: "learning" | "memory" | "management";
  items: ShelfItem[];
  summary: string;
  notice?: string | null;
  onOpenManagement?: () => void;
  onOpenImprints?: () => void;
  eyebrow?: string;
  title?: string;
  footerText?: string;
}

const sectionCopy = {
  learning: { eyebrow: "当前主线", title: "学习轨迹", Icon: Sparkles },
  memory: { eyebrow: "被留在纸上的", title: "留痕", Icon: Brain },
  management: { eyebrow: "温和整理", title: "整理计划", Icon: Archive },
};

export default function ShelfView({ section, items, summary, notice, onOpenManagement, onOpenImprints, eyebrow, title, footerText }: ShelfViewProps) {
  const copy = sectionCopy[section];
  const Icon = copy.Icon;

  return (
    <section className="shelf-page">
      <header className="shelf-header">
        <span className="shelf-kicker"><Icon aria-hidden="true" size={14} /> {eyebrow || copy.eyebrow}</span>
        <h1>{title || copy.title}</h1>
        <p>{summary}</p>
      </header>

      <div className="shelf-list">
        {notice && <div className="shelf-notice" role="status">{notice}</div>}
        {items.length === 0 ? (
          <div className="shelf-empty">这一页暂时没有需要处理的内容。</div>
        ) : (
          items.map((item) => (
            <article className="shelf-item" key={item.id} style={{ "--item-accent": item.accent || "#8b7355" } as React.CSSProperties}>
              <div className="shelf-item-mark"><CheckCircle2 aria-hidden="true" size={15} /></div>
              <div className="shelf-item-copy">
                <span>{item.eyebrow}</span>
                <h2>{item.title}</h2>
                <p>{item.detail}</p>
              </div>
              {item.actionLabel && (
                <button disabled={item.actionDisabled} onClick={item.onAction} type="button">
                  {item.actionLabel}
                </button>
              )}
            </article>
          ))
        )}
      </div>

      <footer className="shelf-footer">
        <Award aria-hidden="true" size={14} />
        <span>{footerText || "成长不是积分，而是一些值得被看见的变化。"}</span>
        <div className="shelf-footer-actions">
          {section === "memory" && onOpenImprints && <button onClick={onOpenImprints} type="button">查看全部印记</button>}
          {onOpenManagement && (
            <button onClick={onOpenManagement} type="button">
              {section === "learning" ? "整理学习线" : "整理这些留痕"}
            </button>
          )}
        </div>
      </footer>
    </section>
  );
}
