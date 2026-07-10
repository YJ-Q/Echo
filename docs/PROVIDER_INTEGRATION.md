# Provider Integration

Date: 2026-07-11

## Supported Matrix

| Provider | Capability | Endpoint | Default model | Status |
| --- | --- | --- | --- | --- |
| OpenAI | Conversation | `POST /v1/chat/completions` | `gpt-4.1-mini` | Mock contract passed; live probe not run because no key was configured |
| Anthropic | Conversation | `POST /v1/messages` | `claude-sonnet-4-6` | Mock contract passed; live probe not run because no key was configured |
| SiliconFlow | Conversation | `POST /v1/chat/completions` | `deepseek-ai/DeepSeek-V3.2` | Mock and live probes passed |
| SiliconFlow | TTS | `POST /v1/audio/speech` | `FunAudioLLM/CosyVoice2-0.5B` | Mock and live probes passed |
| SiliconFlow | STT | `POST /v1/audio/transcriptions` | `FunAudioLLM/SenseVoiceSmall` | Mock and live probes passed |

Official references:

- [OpenAI Chat Completions](https://platform.openai.com/docs/api-reference/chat/completions/create)
- [Anthropic Messages](https://platform.claude.com/docs/en/api/messages)
- [Anthropic model IDs](https://platform.claude.com/docs/en/about-claude/models/overview)
- [SiliconFlow Chat Completions](https://docs.siliconflow.cn/en/api-reference/chat-completions/chat-completions)
- [SiliconFlow Text to Speech](https://docs.siliconflow.cn/en/api-reference/audio/create-speech)
- [SiliconFlow Speech to Text](https://docs.siliconflow.cn/cn/api-reference/audio/create-audio-transcriptions)

## Deterministic Tests

The automated suite injects fake environments and `fetch` implementations. It verifies URLs, authentication headers, request transformations, text extraction, token usage, trace IDs, timeouts, authentication failures, rate limits, invalid JSON, and empty responses without contacting suppliers.

```bash
node --test test/providerError.test.js test/llmProviders.test.js test/providerProbe.test.js test/providerProbeScript.test.js test/providerValidation.test.js test/ttsProvider.test.js test/sttProvider.test.js
```

## Live Probes

Live probes are opt-in and billable. They print only provider, capability, model, latency, stable result code, and trace ID. Generated text, audio, transcription, request headers, API keys, and upstream response bodies are never printed.

```bash
npm run probe:providers -- --provider=openai --capability=conversation
npm run probe:providers -- --provider=anthropic --capability=conversation
npm run probe:providers -- --provider=siliconflow --capability=conversation
npm run probe:providers -- --provider=siliconflow --capability=tts
npm run probe:providers -- --provider=siliconflow --capability=stt
```

The STT probe first synthesizes the word “Margin” through the configured SiliconFlow TTS model, then transcribes that in-memory audio. It does not create an audio file.

## Live Evidence

Authorized probes executed on 2026-07-11:

| Provider | Capability | Model | Result | Latency | Trace ID |
| --- | --- | --- | --- | ---: | --- |
| SiliconFlow | Conversation | `deepseek-ai/DeepSeek-V3.2` | PASS | 1693 ms | `ti_dq07myytg3boqci3g6` |
| SiliconFlow | TTS | `FunAudioLLM/CosyVoice2-0.5B` | PASS | 562 ms | `ti_n6g945djrx863mgbx0` |
| SiliconFlow | STT | `FunAudioLLM/SenseVoiceSmall` | PASS | 908 ms | Not returned by endpoint |

OpenAI and Anthropic live probes were intentionally skipped because their keys were not configured. This is recorded as “not run”, not as a pass or failure.

## Desktop Validation

Saving a remote conversation provider now performs a non-fallback live probe after the backend restarts. A successful response reports provider, model, and latency. Authentication, model, rate-limit, timeout, or transport failures trigger the existing encrypted-settings rollback and restart the previous configuration.

Local provider selection performs no external request. Changing only paper preferences performs no provider probe.

## Safe Troubleshooting

- `provider_auth_failed`: replace or re-authorize the selected key.
- `provider_model_unavailable`: choose a model ID currently available to the account.
- `provider_rate_limited`: wait for the supplier limit window; Margin does not automatically retry billable requests.
- `provider_timeout`: check network/proxy access and supplier status.
- `provider_invalid_json` or `provider_empty_response`: retain the trace ID and compare the configured endpoint/model with the official contract.

Do not paste API keys, complete upstream bodies, `.env` files, or encrypted settings files into issues or logs.
