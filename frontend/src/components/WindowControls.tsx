import { Minus, X } from "lucide-react";

export default function WindowControls() {
  if (!window.marginDesktop) return null;

  return (
    <>
      <div className="window-drag-region" />
      <div className="window-controls" aria-label="窗口控制">
        <button aria-label="最小化" onClick={() => window.marginDesktop?.minimize()} type="button">
          <Minus aria-hidden="true" size={12} />
        </button>
        <button aria-label="关闭" onClick={() => window.marginDesktop?.close()} type="button">
          <X aria-hidden="true" size={12} />
        </button>
      </div>
    </>
  );
}
