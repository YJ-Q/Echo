import { useEffect, useRef } from "react";
import { ArrowLeft, CircleDashed, Footprints, Landmark, Lightbulb, Route, Sparkles, Stamp, Target } from "lucide-react";
import type { AchievementRecord, AchievementResponse } from "../lib/api";

interface ImprintCollectionProps {
  achievements: AchievementResponse | null;
  onBack: () => void;
  onAcknowledge?: (key: string) => Promise<unknown> | void;
}

interface ImprintUnlockNoticeProps {
  record: AchievementRecord;
  onAcknowledge: (key: string) => Promise<unknown> | void;
  onOpen: () => void;
}

const ICONS = {
  new_path: Route,
  first_step: Footprints,
  breakthrough: Lightbulb,
  completion: Landmark,
  action_done: Target,
  memory_cleanse: Stamp,
  hidden_spark: Sparkles,
};

export default function ImprintCollection({ achievements, onBack, onAcknowledge }: ImprintCollectionProps) {
  const acknowledged = useRef(new Set<string>());
  const records = achievements?.achievements || [];
  const newKeys = new Set(
    (achievements?.recent_unlocks || [])
      .filter((unlock) => unlock.is_new)
      .map((unlock) => String(unlock.achievement_id ?? "")),
  );

  useEffect(() => {
    const newest = records.find((record) => record.unlocked && record.key && (
      record.is_new || newKeys.has(String(record.id ?? ""))
    ));
    if (!newest?.key || acknowledged.current.has(newest.key)) return;

    acknowledged.current.add(newest.key);
    const timer = window.setTimeout(() => void onAcknowledge?.(newest.key as string), 1800);
    return () => window.clearTimeout(timer);
  }, [records, newKeys, onAcknowledge]);

  return (
    <section className="imprint-page" aria-labelledby="imprint-title">
      <header className="imprint-header">
        <button className="imprint-back" onClick={onBack} type="button"><ArrowLeft aria-hidden="true" size={13} /> 返回留痕</button>
        <span>Pressed archive · Margin</span>
        <h1 id="imprint-title">印记</h1>
        <p>不是奖励，也不计算完成度。这里只收好那些确实走过的时刻。</p>
      </header>

      <div className="imprint-grid">
        {records.map((record) => (
          <ImprintCard
            isNew={Boolean(record.is_new || newKeys.has(String(record.id ?? "")))}
            key={record.key || record.id}
            record={record}
          />
        ))}
      </div>

      <footer className="imprint-footer">
        <CircleDashed aria-hidden="true" size={13} />
        <span>隐藏印记只在真正发生后显影。</span>
      </footer>
    </section>
  );
}

export function ImprintUnlockNotice({ record, onAcknowledge, onOpen }: ImprintUnlockNoticeProps) {
  const acknowledgeRef = useRef(onAcknowledge);
  acknowledgeRef.current = onAcknowledge;

  useEffect(() => {
    if (!record.key) return;
    const timer = window.setTimeout(() => void acknowledgeRef.current(record.key as string), 3200);
    return () => window.clearTimeout(timer);
  }, [record.key]);

  const Icon = ICONS[record.icon_type as keyof typeof ICONS] || Stamp;
  return (
    <button className="imprint-unlock-notice" onClick={onOpen} type="button">
      <span><Icon aria-hidden="true" size={17} strokeWidth={1.2} /></span>
      <small>一枚新印记已经留下</small>
      <strong>{record.title || "去看看这枚印记"}</strong>
    </button>
  );
}

function ImprintCard({ record, isNew }: { record: AchievementRecord; isNew: boolean }) {
  const iconType = record.icon_type && Object.hasOwn(ICONS, record.icon_type) ? record.icon_type : "memory_cleanse";
  const hiddenLocked = record.hidden && !record.unlocked;
  const unlockedAt = record.unlocked_at ? new Date(record.unlocked_at) : null;
  const date = unlockedAt && !Number.isNaN(unlockedAt.getTime())
    ? unlockedAt.toLocaleDateString("zh-CN", { year: "numeric", month: "short", day: "numeric" })
    : null;

  return (
    <article
      className={`imprint-card${record.unlocked ? " is-unlocked" : " is-locked"}${hiddenLocked ? " is-hidden" : ""}${isNew ? " is-new" : ""}`}
      style={{ "--imprint-accent": record.accent_color || "#746858" } as React.CSSProperties}
    >
      <div className="imprint-seal" aria-hidden="true"><img alt="" src={`/assets/achievements/${iconType}.svg`} /></div>
      <span>{record.unlocked ? "已经留下" : hiddenLocked ? "尚未显影" : "还未发生"}</span>
      <h2>{hiddenLocked ? "未显影的印记" : record.title || "一枚印记"}</h2>
      <p>{record.unlocked ? record.description : record.locked_description}</p>
      {record.unlocked && date && <time>{date}</time>}
    </article>
  );
}
