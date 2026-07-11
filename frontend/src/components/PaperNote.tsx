import type { ReactNode } from "react";

interface PaperNoteProps {
  title: string;
  children: ReactNode;
  footer?: ReactNode;
}

export default function PaperNote({ title, children, footer }: PaperNoteProps) {
  return (
    <section className="paper-note">
      <h3>{title}</h3>
      <div className="paper-note-body">{children}</div>
      {footer && <footer>{footer}</footer>}
    </section>
  );
}
