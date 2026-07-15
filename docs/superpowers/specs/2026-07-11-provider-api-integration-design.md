# Margin Provider API Integration Design

Date: 2026-07-11

## Goal

Make OpenAI, Anthropic, and SiliconFlow integrations independently verifiable, predictable under failure, and safe to diagnose without leaking API keys or upstream response bodies.

## Scope

- OpenAI conversation through Chat Completions.
- Anthropic conversation through Messages.
- SiliconFlow conversation, text-to-speech, and speech-to-text.
- Deterministic mock contract tests for every supported capability.
- Explicit opt-in live probes that never silently count the local fallback as supplier success.

## Adapter Contract

Every remote adapter accepts injected `env`, `fetchImpl`, and `timeoutMs` values. This removes reliance on mutable globals during tests and allows the probe service to test a selected configuration directly.

Conversation adapters expose the same shape:

```text
generateText({ messages }) -> {
  text,
  provider,
  model,
  traceId,
  usage
}
```

The normal conversation flow keeps the current local fallback. It stores only a stable error code as `fallback_reason`; raw supplier messages and response bodies are discarded.

## Failure Contract

`ProviderError` normalizes authentication, bad request/model, rate limit, timeout, transport, invalid JSON, empty response, and upstream availability failures. It carries provider, stable code, safe HTTP status, upstream status, retryability, and an optional trace ID.

Diagnostic detail is capped at 300 characters and redacts all configured keys. Keys never enter renderer state, logs, API responses, documentation, test output, or probe reports.

All remote calls use AbortController deadlines: 20 seconds for conversation and STT, 30 seconds for TTS.

## Verification Flow

Mock tests assert exact URLs, authentication headers, request transformation, response extraction, trace ID handling, and failure classification. They run without credentials or network access.

An explicit probe service performs a minimal non-fallback request for a chosen provider/capability. Desktop settings validation can use this service after a backend restart; failure restores the previous encrypted settings snapshot.

The developer live-probe command is opt-in and runs only when the matching environment key exists. It prints provider, capability, model, latency, stable result, and trace ID—never generated content, audio, transcription, headers, or credentials.

## Delivery Order

1. Shared timeout and error primitives.
2. OpenAI, Anthropic, and SiliconFlow conversation adapters.
3. SiliconFlow TTS/STT alignment.
4. Non-fallback probe service and route.
5. Desktop settings verification/rollback integration.
6. Opt-in live matrix and integration evidence.

## Deferred Scope

- Migrating OpenAI from Chat Completions to Responses.
- Adding new suppliers beyond the three already exposed in settings.
- Streaming responses.
- Automatic retries that could duplicate billable requests.
- Running billable live probes in public CI.
