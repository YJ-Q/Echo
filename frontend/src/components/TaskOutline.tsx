import { Check, Circle, CircleDot } from "lucide-react";
import type { TaskNode } from "../types";

interface TaskOutlineProps {
  title: string;
  context: string;
  tasks: TaskNode[];
  onStepChange?: (task: TaskNode) => void;
  ribbonLabel?: string;
}

const icons = {
  done: Check,
  active: CircleDot,
  pending: Circle,
};

export default function TaskOutline({
  title,
  context,
  tasks,
  onStepChange,
  ribbonLabel = "正在读取草稿",
}: TaskOutlineProps) {
  return (
    <aside className="outline-page">
      <div className="bookmark" aria-label={ribbonLabel} title={ribbonLabel} />
      <div className="outline-status">
        <span className="status-ring" />
        <strong>Margin</strong>
        <span>{ribbonLabel}</span>
      </div>

      <div className="outline-heading">
        <p>{context}</p>
        <h2>{title}</h2>
      </div>

      <ol className="progress-thread">
        {tasks.length === 0 ? (
          <li className="progress-empty">还没有形成学习线。先在左页聊聊想推进的事情。</li>
        ) : (
          tasks.map((task, index) => {
            const Icon = icons[task.status];
            return (
              <li className={`progress-node is-${task.status}`} key={task.id}>
                <span aria-hidden="true" className="progress-marker">
                  <Icon aria-hidden="true" size={17} />
                </span>
                <div>
                  <h3>{task.title}</h3>
                  {task.detail && <p>{task.detail}</p>}
                  {task.status === "active" && (
                    <>
                      <span className="active-note">第 {index + 1} 步 · 正在这里</span>
                      {onStepChange && <button className="complete-step" onClick={() => onStepChange(task)} type="button">完成这个小步</button>}
                    </>
                  )}
                </div>
              </li>
            );
          })
        )}
      </ol>

      <footer className="outline-footer">
        <span>复盘线索</span>
        <span>继续这一线</span>
      </footer>
    </aside>
  );
}
