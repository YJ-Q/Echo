import { FormEvent, KeyboardEvent, useEffect, useRef, useState } from "react";
import { ArrowRight, Mic, Square, Volume2 } from "lucide-react";
import type { Message } from "../types";

interface ReflectiveMarginProps {
  messages: Message[];
  isSending: boolean;
  error?: string | null;
  onSend: (message: string) => Promise<void> | void;
  onSpeak?: (message: Message) => Promise<void> | void;
  onStopSpeak?: () => void;
  onLightReadingChange?: (enabled: boolean) => Promise<void> | void;
  onOpenSettings?: () => void;
  onTranscribe?: (audio: Blob) => Promise<string>;
  onRecordingStart?: () => void;
  lightReadingEnabled?: boolean;
  speakingId?: string | null;
  ttsAvailable?: boolean;
  sttAvailable?: boolean;
}

function splitParagraphs(text: string) {
  return text.split(/\n{2,}|\n/).filter(Boolean);
}

export default function ReflectiveMargin({
  messages,
  isSending,
  error,
  onSend,
  onSpeak,
  onStopSpeak,
  onLightReadingChange,
  onOpenSettings,
  onTranscribe,
  onRecordingStart,
  lightReadingEnabled = false,
  speakingId,
  ttsAvailable = false,
  sttAvailable = false,
}: ReflectiveMarginProps) {
  const [draft, setDraft] = useState("");
  const [recordingState, setRecordingState] = useState<"idle" | "recording" | "transcribing">("idle");
  const [recordingError, setRecordingError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [messages, isSending]);

  useEffect(() => () => {
    recorderRef.current?.stop();
    streamRef.current?.getTracks().forEach((track) => track.stop());
  }, []);

  const submit = async () => {
    const message = draft.trim();
    if (!message || isSending) return;
    setDraft("");
    await onSend(message);
  };

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    void submit();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void submit();
    }
  };

  const stopRecording = () => {
    if (recorderRef.current?.state === "recording") {
      recorderRef.current.stop();
    }
  };

  const startRecording = async () => {
    if (!sttAvailable || !onTranscribe || recordingState !== "idle") return;
    setRecordingError(null);
    onRecordingStart?.();

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      streamRef.current = stream;
      recorderRef.current = recorder;
      chunksRef.current = [];

      recorder.addEventListener("dataavailable", (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      });
      recorder.addEventListener("stop", async () => {
        stream.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
        setRecordingState("transcribing");
        try {
          const audio = new Blob(chunksRef.current, { type: recorder.mimeType || "audio/webm" });
          const transcript = await onTranscribe(audio);
          setDraft((current) => [current.trim(), transcript.trim()].filter(Boolean).join(current.trim() ? " " : ""));
        } catch (error) {
          setRecordingError(error instanceof Error ? error.message : "这段声音暂时没能转成文字。");
        } finally {
          chunksRef.current = [];
          recorderRef.current = null;
          setRecordingState("idle");
        }
      }, { once: true });

      recorder.start();
      setRecordingState("recording");
    } catch (error) {
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      recorderRef.current = null;
      setRecordingError(error instanceof Error ? `无法开始录音：${error.message}` : "无法开始录音，请检查麦克风权限。");
      setRecordingState("idle");
    }
  };

  return (
    <section className="reflection-page">
      <header className="reflection-header">
        <div className="brand-block">
          <span className="brand-name">Margin</span>
          <span className="brand-cn">留白</span>
        </div>
        <div className="reading-controls">
          <span>轻读</span>
          <button
            aria-label={lightReadingEnabled ? "关闭轻读" : "开启轻读"}
            aria-pressed={lightReadingEnabled}
            className={`paper-switch${lightReadingEnabled ? " is-on" : ""}`}
            disabled={!ttsAvailable}
            onClick={() => void onLightReadingChange?.(!lightReadingEnabled)}
            type="button"
          >
            <span />
          </button>
          {!ttsAvailable && (
            <button className="reading-setup" onClick={onOpenSettings} type="button">配置语音</button>
          )}
        </div>
      </header>

      <div className="conversation" aria-live="polite">
        {messages.length === 0 ? (
          <div className="empty-conversation">
            <p>这一页还很安静。</p>
            <p>写下一件此刻放在心上的事，Margin 会陪你把它慢慢摊开。</p>
          </div>
        ) : (
          messages.map((message) => (
            <article className={`message message-${message.role}`} key={message.id}>
              {splitParagraphs(message.text).map((paragraph, index) => (
                <p key={`${message.id}-${index}`}>{paragraph}</p>
              ))}
              {message.timestamp && <time>{message.timestamp}</time>}
              {message.role === "assistant" && ttsAvailable && lightReadingEnabled && (
                <button
                  aria-label={speakingId === message.id ? "停止朗读" : "朗读这段回答"}
                  className="speech-button"
                  onClick={() => speakingId === message.id ? onStopSpeak?.() : void onSpeak?.(message)}
                  type="button"
                >
                  {speakingId === message.id
                    ? <Square aria-hidden="true" size={10} />
                    : <Volume2 aria-hidden="true" size={12} />}
                  <span>{speakingId === message.id ? "停止" : "再读一遍"}</span>
                </button>
              )}
            </article>
          ))
        )}
        {isSending && (
          <div className="ink-thinking" role="status">
            <span />
            <span />
            <span />
            <span className="sr-only">Margin 正在思考</span>
          </div>
        )}
        <div ref={endRef} />
      </div>

      <form className="paper-composer" onSubmit={handleSubmit}>
        <textarea
          aria-label="写下此刻的想法"
          disabled={isSending}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="写下此刻的想法……"
          rows={1}
          value={draft}
        />
        <button
          aria-label={recordingState === "recording" ? "结束录音并转写" : "开始语音输入"}
          className={`composer-icon${recordingState === "recording" ? " is-recording" : ""}`}
          disabled={!sttAvailable || recordingState === "transcribing" || isSending}
          onClick={recordingState === "recording" ? stopRecording : () => void startRecording()}
          title={sttAvailable ? "云端转写，文字写入后不会自动发送" : "请先在设置中配置语音服务"}
          type="button"
        >
          <Mic aria-hidden="true" size={16} />
        </button>
        <button aria-label="发送" className="composer-icon send-button" disabled={!draft.trim() || isSending} type="submit">
          <ArrowRight aria-hidden="true" size={17} />
        </button>
      </form>
      {recordingState !== "idle" && (
        <p className={`recording-status is-${recordingState}`} role="status">
          {recordingState === "recording" ? "正在录音 · 再次点击麦克风结束" : "正在通过云端把声音转成文字……"}
        </p>
      )}
      {recordingError && <p className="inline-error">{recordingError}</p>}
      {error && <p className="inline-error">{error}</p>}
    </section>
  );
}
