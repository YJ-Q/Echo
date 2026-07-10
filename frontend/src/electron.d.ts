export {};

export type MarginProvider = "local" | "openai" | "anthropic" | "siliconflow";

export interface MarginSettingsSnapshot {
  conversation: {
    provider: MarginProvider;
    model: string;
  };
  speech: {
    provider: "siliconflow";
    ttsModel: string;
    voice: string;
    speed: number;
    sttModel: string;
    language: string;
  };
  preferences: {
    lightReadingEnabled: boolean;
    fontScale: number;
    lineHeight: number;
    motion: "full" | "reduced";
  };
  keys: Record<Exclude<MarginProvider, "local">, {
    configured: boolean;
    masked: string;
  }>;
  secureStorageAvailable: boolean;
  dataDirectory: string;
}

export interface MarginSettingsPatch {
  conversation?: Partial<MarginSettingsSnapshot["conversation"]>;
  speech?: Partial<MarginSettingsSnapshot["speech"]>;
  preferences?: Partial<MarginSettingsSnapshot["preferences"]>;
  secrets?: Partial<Record<Exclude<MarginProvider, "local">, string>>;
}

export interface MarginSettingsResult {
  ok: boolean;
  settings: MarginSettingsSnapshot;
  restarted?: boolean;
  message?: string;
}

declare global {
  interface Window {
    marginDesktop?: {
      minimize: () => void;
      toggleMaximize: () => void;
      close: () => void;
      onWindowState: (callback: (state: { isMaximized: boolean }) => void) => () => void;
      getSettings: () => Promise<MarginSettingsSnapshot>;
      updateSettings: (patch: MarginSettingsPatch) => Promise<MarginSettingsResult>;
    };
  }
}
