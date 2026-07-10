import { useEffect } from "react";
import { Archive, ArrowLeft, X } from "lucide-react";
import ShelfView from "./ShelfView";
import type { ManagementProposal } from "../lib/api";
import type { ShelfItem } from "../types";

interface ManagementSheetProps {
  items: ShelfItem[];
  summary: string;
  notice?: string | null;
  pendingProposal?: ManagementProposal | null;
  onClose: () => void;
  onBack: () => void;
  onConfirm: (proposal: ManagementProposal) => Promise<void> | void;
  onCancel: (proposal: ManagementProposal) => Promise<void> | void;
}

export default function ManagementSheet({
  items,
  summary,
  notice,
  pendingProposal,
  onClose,
  onBack,
  onConfirm,
  onCancel,
}: ManagementSheetProps) {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") pendingProposal ? onBack() : onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onBack, onClose, pendingProposal]);

  return (
    <div className="management-layer" role="dialog" aria-modal="true" aria-label="整理计划">
      <section className="management-paper">
        <button aria-label="关闭整理计划" className="management-close" onClick={onClose} type="button">
          <X aria-hidden="true" size={15} />
        </button>
        {pendingProposal ? (
          <div className="confirmation-paper">
            <span className="confirmation-kicker"><Archive aria-hidden="true" size={13} /> 整理确认</span>
            <h1>在落笔前，再看一遍</h1>
            <p>{pendingProposal.summary || "这份草案只会在你明确确认后执行。"}</p>
            <dl>
              <div><dt>范围</dt><dd>{pendingProposal.scope || "当前页"}</dd></div>
              <div><dt>风险</dt><dd>{pendingProposal.risk_level === "destructive" ? "不可恢复，当前版本不执行" : "执行后会留下操作记录"}</dd></div>
              <div><dt>动作</dt><dd>{pendingProposal.operations?.map((item) => item.operation_type).filter(Boolean).join("、") || "整理记录"}</dd></div>
            </dl>
            <div className="confirmation-actions">
              <button className="text-action" onClick={onBack} type="button"><ArrowLeft aria-hidden="true" size={12} /> 返回草案</button>
              <button className="text-action danger-text" onClick={() => void onCancel(pendingProposal)} type="button">取消这份草案</button>
              <button
                className="primary-paper-action"
                disabled={pendingProposal.risk_level === "destructive"}
                onClick={() => void onConfirm(pendingProposal)}
                type="button"
              >确认执行</button>
            </div>
          </div>
        ) : (
          <ShelfView items={items} notice={notice} section="management" summary={summary} />
        )}
      </section>
    </div>
  );
}
