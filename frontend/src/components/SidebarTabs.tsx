import { Settings } from "lucide-react";
import type { NavigationTab, WorkspaceSection } from "../types";

interface SidebarTabsProps {
  tabs: NavigationTab[];
  activeTab: WorkspaceSection;
  onSelect: (id: WorkspaceSection) => void;
}

export default function SidebarTabs({ tabs, activeTab, onSelect }: SidebarTabsProps) {
  return (
    <nav className="notebook-tabs" aria-label="留白分区">
      {tabs.map((tab) => (
        <button
          aria-label={tab.id === "settings" ? "设置" : tab.label}
          className={`notebook-tab${tab.id === "settings" ? " notebook-tab-add" : ""}${activeTab === tab.id ? " is-active" : ""}`}
          key={tab.id}
          onClick={() => onSelect(tab.id)}
          title={tab.id === "settings" ? "设置" : undefined}
          type="button"
        >
          {tab.id === "settings"
            ? <Settings aria-hidden="true" size={13} strokeWidth={1.4} />
            : <span>{tab.label}</span>}
        </button>
      ))}
    </nav>
  );
}
