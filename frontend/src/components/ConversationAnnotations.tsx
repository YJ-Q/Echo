import { ArrowRight, Minus } from "lucide-react";
import PaperNote from "./PaperNote";

interface ConversationAnnotationsProps {
  seen: string;
  noticed: string;
  prompt: string;
  growthSuggestion?: {
    title: string;
    detail: string;
    experiment?: string;
    pending?: boolean;
  };
  growthSuggestionBusy?: boolean;
  onConfirmGrowth?: () => void;
  onDismissGrowth?: () => void;
  onOpenGrowth?: () => void;
  ribbonLabel?: string;
}

const sections = [
  { key: "seen", title: "我看见的" },
  { key: "noticed", title: "我注意到" },
  { key: "prompt", title: "还可以继续看看" },
] as const;

export default function ConversationAnnotations({
  seen,
  noticed,
  prompt,
  growthSuggestion,
  growthSuggestionBusy = false,
  onConfirmGrowth,
  onDismissGrowth,
  onOpenGrowth,
  ribbonLabel = "边注正在随对话形成",
}: ConversationAnnotationsProps) {
  const copy = { seen, noticed, prompt };

  return (
    <aside className="outline-page conversation-annotations" aria-label="当前对话边注">
      <div className="bookmark" aria-label={ribbonLabel} title={ribbonLabel} />
      <header className="annotation-heading">
        <h2>这段对话的边注</h2>
        <p>{ribbonLabel}</p>
      </header>

      <div className="annotation-list">
        {sections.map((section) => (
          <section className="annotation-section" key={section.key}>
            <h3><Minus aria-hidden="true" size={13} />{section.title}</h3>
            <p>{copy[section.key]}</p>
          </section>
        ))}
      </div>

      {growthSuggestion && (
        <PaperNote
          footer={growthSuggestion.pending ? (
            <div className="growth-suggestion-actions">
              <button disabled={growthSuggestionBusy} onClick={onDismissGrowth} type="button">
                先不形成
              </button>
              <button disabled={growthSuggestionBusy} onClick={onConfirmGrowth} type="button">
                形成这条成长线 <ArrowRight aria-hidden="true" size={13} />
              </button>
            </div>
          ) : onOpenGrowth && (
            <button className="paper-note-action" onClick={onOpenGrowth} type="button">
              去成长轨迹看看 <ArrowRight aria-hidden="true" size={13} />
            </button>
          )}
          title={growthSuggestion.title}
        >
          <p>{growthSuggestion.detail}</p>
          {growthSuggestion.experiment && (
            <p className="growth-suggestion-experiment">可以先试：{growthSuggestion.experiment}</p>
          )}
        </PaperNote>
      )}
    </aside>
  );
}
