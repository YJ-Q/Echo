import { ChevronLeft, ChevronRight, Circle, CircleDot } from "lucide-react";
import { useMemo, useState, type FormEvent, type WheelEvent } from "react";
import type { MemoryCard } from "../lib/api";
import { selectVisibleGrowthNodes, type GrowthNodeModel, type GrowthPageModel } from "../viewModels/paperWorkspace";
import PaperNote from "./PaperNote";

interface GrowthJourneyProps {
  model: GrowthPageModel;
  currentAction: string;
  records: MemoryCard[];
  otherLines: string[];
  onRecordExperiment?: (result: string) => Promise<void>;
}

function recordDate(value?: string) {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return "未记日期";
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

export default function GrowthJourney({ model, currentAction, records, otherLines, onRecordExperiment }: GrowthJourneyProps) {
  const [focusIndex, setFocusIndex] = useState(model.currentStepIndex);
  const [recordIndex, setRecordIndex] = useState(0);
  const [experimentResult, setExperimentResult] = useState("");
  const [recordingResult, setRecordingResult] = useState(false);
  const [savingResult, setSavingResult] = useState(false);
  const [resultNotice, setResultNotice] = useState<string | null>(null);
  const visibleNodes = useMemo(() => selectVisibleGrowthNodes(model.nodes, focusIndex), [focusIndex, model.nodes]);
  const recentRecords = records.slice(0, 7);
  const selectedRecord = recentRecords[recordIndex];

  const moveFocus = (direction: number) => {
    setFocusIndex((current) => Math.min(Math.max(current + direction, 0), Math.max(model.nodes.length - 1, 0)));
  };

  const handleWheel = (event: WheelEvent<HTMLOListElement>) => {
    const direction = event.deltaY > 0 ? 1 : -1;
    const next = Math.min(Math.max(focusIndex + direction, 0), Math.max(model.nodes.length - 1, 0));
    if (next !== focusIndex) {
      event.preventDefault();
      setFocusIndex(next);
    }
  };

  const submitExperimentResult = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const result = experimentResult.trim();
    if (!result || !onRecordExperiment || savingResult) return;
    setSavingResult(true);
    setResultNotice(null);
    try {
      await onRecordExperiment(result);
      setExperimentResult("");
      setRecordingResult(false);
      setResultNotice("这次结果已经留下。");
    } catch (error) {
      setResultNotice(error instanceof Error ? error.message : "这次结果暂时没能留下，请稍后再试。");
    } finally {
      setSavingResult(false);
    }
  };

  return (
    <section className="workspace-page section-paper section-paper-learning growth-workspace" aria-label="成长轨迹">
      <div className="growth-reflection-page">
        <header className="growth-understanding">
          <h1>我现在的理解</h1>
          <p>{model.summary}</p>
        </header>

        <dl className="growth-observations">
          <div><dt>我注意到</dt><dd>{model.nodes[model.currentStepIndex]?.title || "这条成长线还在形成。"}</dd></div>
          <div><dt>可能担心</dt><dd>如果一次做得不够完整，会不会又退回原来的方式？</dd></div>
          <div><dt>想试试看</dt><dd>{currentAction}</dd></div>
        </dl>

        <PaperNote
          footer={<><span className="experiment-status"><CircleDot aria-hidden="true" size={12} /> 进行中</span>{onRecordExperiment && !recordingResult && <button className="paper-note-action" onClick={() => { setRecordingResult(true); setResultNotice(null); }} type="button">记录结果 <ChevronRight aria-hidden="true" size={12} /></button>}</>}
          title="本周小实验"
        >
          <p>{currentAction}</p>
          {recordingResult && (
            <form className="experiment-result-form" onSubmit={submitExperimentResult}>
              <label htmlFor="experiment-result">这次实际发生了什么？</label>
              <textarea
                id="experiment-result"
                maxLength={4000}
                onChange={(event) => setExperimentResult(event.target.value)}
                rows={3}
                value={experimentResult}
              />
              <div>
                <button onClick={() => setRecordingResult(false)} type="button">稍后再写</button>
                <button disabled={savingResult || !experimentResult.trim()} type="submit">留下结果</button>
              </div>
            </form>
          )}
          {resultNotice && <p className="experiment-result-notice" role="status">{resultNotice}</p>}
        </PaperNote>

        <section className="situation-records">
          <header><h2>真实情境记录</h2><span>一次只看一天</span></header>
          <nav aria-label="记录日期">
            <button aria-label="上一条日期" disabled={recordIndex <= 0} onClick={() => setRecordIndex((value) => Math.max(0, value - 1))} type="button"><ChevronLeft size={14} /></button>
            {recentRecords.map((record, index) => <button aria-current={index === recordIndex ? "date" : undefined} className={index === recordIndex ? "is-active" : ""} key={String(record.id ?? index)} onClick={() => setRecordIndex(index)} type="button">{recordDate(record.timestamp)}</button>)}
            <button aria-label="下一条日期" disabled={recordIndex >= recentRecords.length - 1} onClick={() => setRecordIndex((value) => Math.min(recentRecords.length - 1, value + 1))} type="button"><ChevronRight size={14} /></button>
          </nav>
          <article className="situation-record">
            {selectedRecord ? <><time>{selectedRecord.timestamp ? new Date(selectedRecord.timestamp).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false }) : ""}</time><p><strong>情境</strong>{selectedRecord.user_input || "这段情境没有留下原文。"}</p><p><strong>我的感受</strong>{selectedRecord.emotion || selectedRecord.insight_note || "当时的感受还没有被命名。"}</p><p><strong>结果与反思</strong>{selectedRecord.memory_note || "这次经历还可以继续回看。"}</p></> : <p className="growth-empty">还没有真实情境记录。完成一次小实验后，它会留在这里。</p>}
          </article>
        </section>
      </div>

      <aside className="growth-path-page">
        <header><h1>{model.topic}</h1><p>当前成长线</p></header>
        <ol className="growth-path" onWheel={handleWheel}>
          {visibleNodes.map((node) => <GrowthNode key={node.id} node={node} onSelect={() => setFocusIndex(node.index)} />)}
        </ol>
        <div className="growth-path-controls"><button disabled={focusIndex <= 0} onClick={() => moveFocus(-1)} type="button">查看前一节点</button><button disabled={focusIndex >= model.nodes.length - 1} onClick={() => moveFocus(1)} type="button">查看后一节点</button></div>
        <div className="other-growth-lines">
          {otherLines.slice(0, 2).map((line) => <button key={line} type="button">{line}</button>)}
          {otherLines.length > 2 && <span>另外 {otherLines.length - 2} 条</span>}
        </div>
      </aside>
    </section>
  );
}

function GrowthNode({ node, onSelect }: { node: GrowthNodeModel; onSelect: () => void }) {
  if (node.status === "active") {
    return <li className="is-active"><button aria-current="step" onClick={onSelect} type="button"><CircleDot aria-hidden="true" size={22} /><span><strong>{node.title}</strong><small>正在这里</small></span></button></li>;
  }
  return <li className={`is-${node.status}`}><button disabled={node.disabled} onClick={onSelect} type="button"><Circle aria-hidden="true" size={19} /><span><strong>{node.title}</strong><small>{node.status === "done" ? "已经走过" : "尚未开始"}</small></span></button></li>;
}
