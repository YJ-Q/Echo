export type WorkspaceSection = "journal" | "learning" | "memory" | "settings";

export interface NavigationTab {
  id: WorkspaceSection;
  label: string;
}

export interface Message {
  id: string;
  role: "user" | "assistant";
  text: string;
  timestamp?: string;
}

export interface TaskNode {
  id: string;
  title: string;
  status: "done" | "active" | "pending";
  detail?: string;
}

export interface ShelfItem {
  id: string;
  eyebrow: string;
  title: string;
  detail: string;
  accent?: string;
  actionLabel?: string;
  onAction?: () => void;
  actionDisabled?: boolean;
}
