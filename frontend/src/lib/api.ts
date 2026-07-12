export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
export interface JsonObject {
  [key: string]: JsonValue;
}

export type QueryValue = string | number | boolean | null | undefined;
export type QueryParams = Record<string, QueryValue | QueryValue[]>;

export interface JsonRequestOptions<TBody = unknown> {
  method?: string;
  body?: TBody;
  query?: QueryParams;
  headers?: HeadersInit;
  signal?: AbortSignal;
  baseUrl?: string;
}

export interface MarginApiErrorInit {
  status?: number;
  code?: string;
  url?: string;
  method?: string;
  details?: unknown;
  responseBody?: unknown;
  cause?: unknown;
}

export class MarginApiError extends Error {
  status?: number;
  code: string;
  url?: string;
  method?: string;
  details?: unknown;
  responseBody?: unknown;
  override cause?: unknown;

  constructor(message: string, init: MarginApiErrorInit = {}) {
    super(message);
    this.name = 'MarginApiError';
    this.status = init.status;
    this.code = init.code || 'request_error';
    this.url = init.url;
    this.method = init.method;
    this.details = init.details;
    this.responseBody = init.responseBody;
    this.cause = init.cause;
  }
}

export function isMarginApiError(error: unknown): error is MarginApiError {
  return error instanceof MarginApiError;
}

export interface ChatRequest extends JsonObject {
  message: string;
}

export interface ReflectResponse {
  text: string;
  result?: ChatResponse;
  warning?: string;
}

export interface ChatResponse {
  reply: string;
  emotion?: string;
  tags?: string[];
  intent?: string;
  learning_session?: LearningSession | null;
  growth_suggestion?: GrowthSuggestion | null;
  behavior_hint?: unknown;
  decision?: unknown;
  memory_note?: string;
  insight_note?: string;
  explanation?: unknown;
  tone?: string;
  agent?: string;
  management_intent?: unknown;
  management_overview?: unknown;
  [key: string]: unknown;
}

export interface ApiInfoResponse {
  name?: string;
  status?: string;
  capabilities?: {
    tts?: boolean;
    stt?: boolean;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export interface ActionRecord {
  id?: number | string;
  title?: string;
  detail?: string;
  status?: 'pending' | 'active' | 'done' | 'dismissed' | string;
  priority?: number;
  completion_hint?: string;
  [key: string]: unknown;
}

export interface ActionListResponse {
  actions?: ActionRecord[];
  [key: string]: unknown;
}

export interface ActionMutationResponse {
  action?: ActionRecord;
  [key: string]: unknown;
}

export interface SummaryRecord {
  id?: number | string;
  date?: string;
  summary?: string;
  emotional_trend?: string;
  behavioral_pattern?: string;
  echo_reflection?: string;
  [key: string]: unknown;
}

export interface SummaryListResponse {
  summaries?: SummaryRecord[];
  current_reflection?: Record<string, unknown> | null;
  [key: string]: unknown;
}

export interface TtsResponse {
  text?: string;
  audio?: {
    mime_type?: string;
    data?: string;
    size_bytes?: number;
  };
  [key: string]: unknown;
}

export interface SttResponse {
  transcript: string;
  provider?: string;
  model?: string;
  [key: string]: unknown;
}

export interface LearningStep {
  title?: string;
  action?: string;
  status?: string;
  [key: string]: unknown;
}

export interface LearningSession {
  id?: number | string;
  topic?: string;
  status?: string;
  current_step?: number;
  created_at?: string;
  updated_at?: string;
  steps?: LearningStep[];
  [key: string]: unknown;
}

export interface GrowthSuggestion {
  key: string;
  topic: string;
  reason: string;
  experiment: string;
  status: 'pending' | 'confirmed' | 'dismissed';
  source_input?: string;
  session_id?: number | string | null;
  created_at?: string;
  updated_at?: string;
  [key: string]: unknown;
}

export interface GrowthSuggestionMutationResponse {
  suggestion: GrowthSuggestion;
  session?: LearningSession | null;
  already_confirmed?: boolean;
  [key: string]: unknown;
}

export interface LearningViewModel {
  id?: number | string | null;
  topic?: string;
  status?: string;
  total_steps?: number;
  completed_steps?: number;
  current_step_index?: number;
  ratio?: number;
  step_labels?: Array<{
    index: number;
    title?: string;
    status?: string;
  }>;
  current_step?: {
    index: number;
    title?: string;
    action?: string;
    status?: string;
  } | null;
  next_step?: {
    index: number;
    title?: string;
    action?: string;
    status?: string;
  } | null;
  summary?: string;
  [key: string]: unknown;
}

export interface LearningActiveResponse {
  sessions?: LearningSession[];
  current_session?: LearningSession | null;
  current_learning?: LearningViewModel | null;
  pending_suggestion?: GrowthSuggestion | null;
  [key: string]: unknown;
}

export interface MemoryCard {
  id?: number | string;
  timestamp?: string;
  user_input?: string;
  echo_response?: string;
  memory_note?: string;
  insight_note?: string;
  tags?: string[];
  emotion?: string;
  priority_bucket?: string;
  salience?: number;
  reinforcement_count?: number;
  pinned?: boolean;
  [key: string]: unknown;
}

export interface MemoryViewModel {
  overview?: {
    total_memories?: number;
    pinned_count?: number;
    core_count?: number;
    important_count?: number;
    ambient_count?: number;
    [key: string]: unknown;
  };
  pinned_memories?: MemoryCard[];
  recent_memory_notes?: Array<{
    id?: number | string;
    timestamp?: string;
    memory_note?: string;
    priority_bucket?: string;
    salience?: number;
    pinned?: boolean;
  }>;
  tag_heatmap?: Array<{
    tag?: string;
    count?: number;
  }>;
  emotion_distribution?: Array<{
    emotion?: string;
    count?: number;
  }>;
  priority_groups?: Record<string, MemoryCard[]>;
  summary?: string;
  [key: string]: unknown;
}

export interface MemoryResponse {
  memories?: MemoryCard[];
  growth_records?: GrowthRecord[];
  current_memory?: MemoryViewModel | null;
  [key: string]: unknown;
}

export interface GrowthRecord {
  id: string;
  timestamp?: string;
  text: string;
  context?: string;
  source: '成长记录';
}

export interface MemoryMutationResponse {
  memory?: MemoryCard;
  [key: string]: unknown;
}

export interface ProfileSignal {
  key?: string;
  value?: string;
  updated_at?: string;
  [key: string]: unknown;
}

export interface ProfileSummary {
  profile_note?: string;
  stable_signals?: ProfileSignal[];
  developing_signals?: ProfileSignal[];
  long_term_notes?: string[];
  [key: string]: unknown;
}

export interface ProfileResponse {
  profile?: ProfileSignal[];
  summary?: string | ProfileSummary;
  [key: string]: unknown;
}

export interface AchievementRecord {
  id?: number | string;
  key?: string;
  title?: string;
  description?: string | null;
  locked_description?: string;
  unlocked?: boolean;
  hidden?: boolean;
  rarity?: string;
  source_type?: string;
  source_id?: number | string | null;
  icon_type?: string;
  palette_key?: string;
  accent_color?: string;
  unlocked_at?: string | null;
  is_new?: boolean;
  [key: string]: unknown;
}

export interface AchievementResponse {
  summary?: {
    total?: number;
    unlocked?: number;
    hidden?: number;
    [key: string]: unknown;
  };
  recent_unlocks?: Array<{
    id?: number | string;
    achievement_id?: number | string;
    title?: string;
    description?: string | null;
    rarity?: string;
    icon_type?: string;
    palette_key?: string;
    accent_color?: string;
    unlocked_at?: string | null;
    is_new?: boolean;
    [key: string]: unknown;
  }>;
  groups?: Array<{
    key?: string;
    label?: string;
    count?: number;
    [key: string]: unknown;
  }>;
  achievements?: AchievementRecord[];
  [key: string]: unknown;
}

export interface ManagementOverviewCandidate {
  id?: string;
  target_type?: string;
  target_id?: number | string | null;
  title?: string;
  description?: string;
  reason?: string;
  suggested_operation?: string;
  risk_level?: string;
  [key: string]: unknown;
}

export interface ManagementOverviewRecommendation {
  operation_type?: string;
  label?: string;
  reason?: string;
  [key: string]: unknown;
}

export interface ManagementOverviewResponse {
  scope?: string;
  headline?: string;
  summary?: string;
  risk_level?: string;
  stats?: Record<string, unknown>;
  stats_items?: Array<{
    key?: string;
    label?: string;
    value?: number;
    [key: string]: unknown;
  }>;
  candidates?: ManagementOverviewCandidate[];
  recommendations?: ManagementOverviewRecommendation[];
  suggested_operations?: ManagementOverviewRecommendation[];
  available_operations?: string[];
  scopes?: Array<Record<string, unknown>>;
  [key: string]: unknown;
}

export interface ManagementProposal {
  id?: number | string;
  scope?: string;
  status?: string;
  summary?: string;
  risk_level?: string;
  operations?: Array<{
    operation_type?: string;
    target_type?: string;
    target_id?: number | string | null;
    target_ids?: Array<number | string | null>;
    reason?: string;
    [key: string]: unknown;
  }>;
  preview?: {
    before?: unknown[];
    after?: unknown[];
  };
  created_at?: string;
  [key: string]: unknown;
}

export interface ManagementProposalExecutionResponse {
  proposal?: ManagementProposal;
  events?: unknown[];
  results?: unknown[];
  already_executed?: boolean;
  [key: string]: unknown;
}

export interface ManagementProposalListResponse {
  proposals?: ManagementProposal[];
  [key: string]: unknown;
}

export interface ManagementProposalCreateResponse {
  proposal?: ManagementProposal;
  [key: string]: unknown;
}

export interface LearningStepUpdateResponse {
  session?: LearningSession;
  already_applied?: boolean;
  [key: string]: unknown;
}

type EnvelopeError = {
  code?: string;
  message?: string;
  [key: string]: unknown;
};

type Envelope<T> = {
  ok: boolean;
  data?: T;
  error?: EnvelopeError;
};

export async function fetchApiInfo(
  options: Omit<JsonRequestOptions, 'body' | 'method'> = {}
): Promise<ApiInfoResponse> {
  return requestJson<ApiInfoResponse>('/api', options);
}

export async function fetchActions(
  limit = 12,
  options: Omit<JsonRequestOptions, 'body' | 'method' | 'query'> = {}
): Promise<ActionListResponse> {
  return requestJson<ActionListResponse>('/actions', {
    ...options,
    query: { limit }
  });
}

export async function fetchSummaries(
  limit = 5,
  options: Omit<JsonRequestOptions, 'body' | 'method' | 'query'> = {}
): Promise<SummaryListResponse> {
  return requestJson<SummaryListResponse>('/summary/recent', {
    ...options,
    query: { limit }
  });
}

export async function fetchState(query = '', options: Omit<JsonRequestOptions, 'query' | 'body' | 'method'> = {}): Promise<Record<string, unknown>> {
  return requestJson<Record<string, unknown>>('/state', {
    ...options,
    query: query ? { query } : undefined
  });
}

export async function fetchLearningLine(
  options: Omit<JsonRequestOptions, 'body' | 'method'> = {}
): Promise<LearningActiveResponse> {
  return requestJson<LearningActiveResponse>('/learning/active', options);
}

export async function fetchMemoryView(
  limit = 24,
  options: Omit<JsonRequestOptions, 'body' | 'method' | 'query'> = {}
): Promise<MemoryResponse> {
  return requestJson<MemoryResponse>('/memory', {
    ...options,
    query: { limit }
  });
}

export async function keepMemory(
  id: number | string,
  options: Omit<JsonRequestOptions<JsonObject>, 'query' | 'method' | 'body'> = {}
): Promise<MemoryMutationResponse> {
  return requestJson(`/memory/${encodeURIComponent(String(id))}/pin`, {
    ...options,
    method: 'POST',
    body: {}
  });
}

export async function softenMemory(
  id: number | string,
  options: Omit<JsonRequestOptions<JsonObject>, 'query' | 'method' | 'body'> = {}
): Promise<MemoryMutationResponse> {
  return requestJson(`/memory/${encodeURIComponent(String(id))}/priority`, {
    ...options,
    method: 'POST',
    body: {
      priority_bucket: 'ambient',
      salience: 0.28,
      pinned: false,
      reinforcement_count: 1
    }
  });
}

export async function fetchProfile(
  options: Omit<JsonRequestOptions, 'body' | 'method'> = {}
): Promise<ProfileResponse> {
  return requestJson('/memory/profile', options);
}

export async function refreshProfile(
  options: Omit<JsonRequestOptions<JsonObject>, 'query' | 'method' | 'body'> = {}
): Promise<ProfileResponse> {
  return requestJson('/memory/profile/refresh', {
    ...options,
    method: 'POST',
    body: {}
  });
}

export async function overrideProfile(
  key: string,
  value: string,
  options: Omit<JsonRequestOptions<JsonObject>, 'query' | 'method' | 'body'> = {}
): Promise<ProfileResponse> {
  return requestJson('/memory/profile/override', {
    ...options,
    method: 'POST',
    body: { key, value }
  });
}

export async function fetchAchievements(
  options: Omit<JsonRequestOptions, 'body' | 'method'> = {}
): Promise<AchievementResponse> {
  return requestJson<AchievementResponse>('/achievements', options);
}

export async function acknowledgeAchievement(
  key: string,
  options: Omit<JsonRequestOptions<JsonObject>, 'query' | 'method' | 'body'> = {}
): Promise<{ key?: string; acknowledged_at?: string; [key: string]: unknown }> {
  return requestJson(`/achievements/${encodeURIComponent(key)}/acknowledge`, {
    ...options,
    method: 'POST',
    body: {}
  });
}

export async function fetchManagementOverview(
  scope: 'all' | 'learning' | 'memory' | 'actions' = 'all',
  options: Omit<JsonRequestOptions, 'body' | 'method' | 'query'> = {}
): Promise<ManagementOverviewResponse> {
  return requestJson<ManagementOverviewResponse>('/management/overview', {
    ...options,
    query: { scope }
  });
}

export async function fetchManagementProposals(
  options: Omit<JsonRequestOptions, 'body' | 'method'> = {}
): Promise<ManagementProposalListResponse> {
  return requestJson<ManagementProposalListResponse>('/management/proposals', options);
}

export async function sendChat(
  input: string | ChatRequest,
  options: Omit<JsonRequestOptions<ChatRequest>, 'query' | 'method' | 'body'> = {}
): Promise<ChatResponse> {
  const body = typeof input === 'string' ? { message: input } : input;
  return requestJson<ChatResponse>('/chat', {
    ...options,
    method: 'POST',
    body
  });
}

export async function sendReflect(
  input: JsonObject & { message: string },
  options: Omit<JsonRequestOptions<JsonObject>, 'query' | 'method' | 'body'> = {}
): Promise<ReflectResponse> {
  return requestJson<ReflectResponse>('/api/reflect', {
    ...options,
    method: 'POST',
    body: input
  });
}

export async function confirmGrowthSuggestion(
  key: string,
  options: Omit<JsonRequestOptions<JsonObject>, 'query' | 'method' | 'body'> = {}
): Promise<GrowthSuggestionMutationResponse> {
  return requestJson<GrowthSuggestionMutationResponse>(`/learning/suggestions/${encodeURIComponent(key)}/confirm`, {
    ...options,
    method: 'POST',
    body: {}
  });
}

export async function dismissGrowthSuggestion(
  key: string,
  options: Omit<JsonRequestOptions<JsonObject>, 'query' | 'method' | 'body'> = {}
): Promise<GrowthSuggestionMutationResponse> {
  return requestJson<GrowthSuggestionMutationResponse>(`/learning/suggestions/${encodeURIComponent(key)}/dismiss`, {
    ...options,
    method: 'POST',
    body: {}
  });
}

export async function executeManagementProposal(
  id: number | string,
  confirmationText = '',
  options: Omit<JsonRequestOptions<JsonObject>, 'query' | 'method' | 'body'> = {}
): Promise<ManagementProposalExecutionResponse> {
  return requestJson<ManagementProposalExecutionResponse>(`/management/proposals/${encodeURIComponent(String(id))}/confirm`, {
    ...options,
    method: 'POST',
    body: confirmationText ? { confirmation_text: confirmationText } : {}
  });
}

export async function createManagementProposal(
  input: JsonObject,
  options: Omit<JsonRequestOptions<JsonObject>, 'query' | 'method' | 'body'> = {}
): Promise<ManagementProposalCreateResponse> {
  return requestJson<ManagementProposalCreateResponse>('/management/proposals', {
    ...options,
    method: 'POST',
    body: input
  });
}

export async function confirmManagementProposal(
  id: number | string,
  confirmationText = '',
  options: Omit<JsonRequestOptions<JsonObject>, 'query' | 'method' | 'body'> = {}
): Promise<ManagementProposalExecutionResponse> {
  return executeManagementProposal(id, confirmationText, options);
}

export async function cancelManagementProposal(
  id: number | string,
  cancellationReason = '',
  options: Omit<JsonRequestOptions<JsonObject>, 'query' | 'method' | 'body'> = {}
): Promise<ManagementProposalExecutionResponse> {
  return requestJson<ManagementProposalExecutionResponse>(`/management/proposals/${encodeURIComponent(String(id))}/cancel`, {
    ...options,
    method: 'POST',
    body: cancellationReason ? { cancellation_reason: cancellationReason } : {}
  });
}

export async function updateLearningStep(
  sessionId: number | string,
  stepIndex: number | string,
  status: 'pending' | 'active' | 'done' = 'done',
  result = '',
  options: Omit<JsonRequestOptions<JsonObject>, 'query' | 'method' | 'body'> = {}
): Promise<LearningStepUpdateResponse> {
  return requestJson<LearningStepUpdateResponse>(`/learning/${encodeURIComponent(String(sessionId))}/steps/${encodeURIComponent(String(stepIndex))}`, {
    ...options,
    method: 'POST',
    body: result ? { status, result } : { status }
  });
}

export async function updateActionStatus(
  id: number | string,
  status: 'pending' | 'active' | 'done' | 'dismissed',
  options: Omit<JsonRequestOptions<JsonObject>, 'query' | 'method' | 'body'> = {}
): Promise<ActionMutationResponse> {
  return requestJson<ActionMutationResponse>(`/actions/${encodeURIComponent(String(id))}/status`, {
    ...options,
    method: 'POST',
    body: { status }
  });
}

export async function generateSummary(
  options: Omit<JsonRequestOptions<JsonObject>, 'query' | 'method' | 'body'> = {}
): Promise<SummaryRecord> {
  return requestJson<SummaryRecord>('/summary', {
    ...options,
    method: 'POST',
    body: {}
  });
}

export async function synthesizeSpeech(
  text: string,
  options: Omit<JsonRequestOptions<JsonObject>, 'query' | 'method' | 'body'> = {}
): Promise<TtsResponse> {
  return requestJson<TtsResponse>('/tts', {
    ...options,
    method: 'POST',
    body: { text }
  });
}

export async function transcribeAudio(
  audio: Blob,
  options: Omit<JsonRequestOptions<JsonObject>, 'query' | 'method' | 'body'> = {}
): Promise<SttResponse> {
  if (audio.size === 0) {
    throw new MarginApiError('录音内容为空，请重新录制。', { code: 'empty_audio' });
  }

  const bytes = new Uint8Array(await audio.arrayBuffer());
  let binary = '';
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }

  return requestJson<SttResponse>('/stt', {
    ...options,
    method: 'POST',
    body: {
      audio_base64: btoa(binary),
      mime_type: audio.type || 'audio/webm',
      filename: `margin-recording-${Date.now()}.webm`
    }
  });
}

export async function requestJson<TResponse, TBody = unknown>(
  path: string,
  options: JsonRequestOptions<TBody> = {}
): Promise<TResponse> {
  const method = options.method || 'GET';
  const url = buildRequestUrl(path, options.baseUrl, options.query);
  const headers = new Headers(options.headers || undefined);
  headers.set('Accept', 'application/json');

  const body = options.body === undefined ? undefined : JSON.stringify(options.body);
  if (body !== undefined && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  let response: Response;

  try {
    response = await fetch(url, {
      method,
      headers,
      body,
      signal: options.signal
    });
  } catch (error) {
    throw normalizeFetchError(error, { url, method });
  }

  const text = await response.text();
  const parsed = text ? safeJsonParse(text) : undefined;

  if (parsed instanceof Error) {
    throw new MarginApiError('Margin API returned invalid JSON', {
      status: response.status,
      code: 'invalid_json_response',
      url,
      method,
      responseBody: text,
      cause: parsed
    });
  }

  if (!response.ok) {
    throw buildRequestError(response, parsed, { url, method });
  }

  if (isEnvelope(parsed)) {
    if (!parsed.ok) {
      throw buildEnvelopeError(response, parsed, { url, method });
    }

    return parsed.data as TResponse;
  }

  return parsed as TResponse;
}

function buildRequestUrl(
  path: string,
  baseUrl?: string,
  query?: QueryParams
): string {
  const hasAbsoluteUrl = /^[a-zA-Z][a-zA-Z\d+\-.]*:\/\//.test(path) || path.startsWith('//');

  if (baseUrl || hasAbsoluteUrl) {
    const url = baseUrl ? new URL(path, baseUrl) : new URL(path);
    appendQuery(url.searchParams, query);
    return url.toString();
  }

  const [pathname, existingSearch = ''] = path.split('?');
  const searchParams = new URLSearchParams(existingSearch);
  appendQuery(searchParams, query);
  const search = searchParams.toString();

  return search ? `${pathname}?${search}` : pathname;
}

function appendQuery(params: URLSearchParams, query?: QueryParams): void {
  if (!query) {
    return;
  }

  for (const [key, value] of Object.entries(query)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        if (item !== undefined && item !== null) {
          params.append(key, String(item));
        }
      }
      continue;
    }

    if (value !== undefined && value !== null) {
      params.set(key, String(value));
    }
  }
}

function safeJsonParse(text: string): unknown | Error {
  try {
    return JSON.parse(text) as unknown;
  } catch (error) {
    return error instanceof Error ? error : new Error('Failed to parse JSON');
  }
}

function isEnvelope(value: unknown): value is Envelope<unknown> {
  return Boolean(
    value &&
    typeof value === 'object' &&
    'ok' in value &&
    typeof (value as Envelope<unknown>).ok === 'boolean' &&
    (Object.prototype.hasOwnProperty.call(value, 'data') || Object.prototype.hasOwnProperty.call(value, 'error'))
  );
}

function buildEnvelopeError(
  response: Response,
  envelope: Envelope<unknown>,
  context: Pick<MarginApiErrorInit, 'url' | 'method'>
): MarginApiError {
  const error = envelope.error || {};
  const message = error.message || `Request failed with status ${response.status}`;
  return new MarginApiError(message, {
    status: response.status,
    code: error.code || `http_${response.status}`,
    url: context.url,
    method: context.method,
    details: error,
    responseBody: envelope
  });
}

function buildRequestError(
  response: Response,
  parsed: unknown,
  context: Pick<MarginApiErrorInit, 'url' | 'method'>
): MarginApiError {
  const envelopeError = extractError(parsed);
  const message =
    envelopeError.message ||
    `Request failed with status ${response.status}`;

  return new MarginApiError(message, {
    status: response.status,
    code: envelopeError.code || `http_${response.status}`,
    url: context.url,
    method: context.method,
    details: envelopeError,
    responseBody: parsed
  });
}

function extractError(parsed: unknown): EnvelopeError {
  if (!parsed || typeof parsed !== 'object') {
    return {};
  }

  const value = parsed as Record<string, unknown>;

  if (value.error && typeof value.error === 'object') {
    return value.error as EnvelopeError;
  }

  if (typeof value.error === 'string') {
    return { message: value.error };
  }

  if (typeof value.message === 'string' || typeof value.code === 'string') {
    return {
      message: typeof value.message === 'string' ? value.message : undefined,
      code: typeof value.code === 'string' ? value.code : undefined
    };
  }

  return {};
}

function normalizeFetchError(
  error: unknown,
  context: Pick<MarginApiErrorInit, 'url' | 'method'>
): MarginApiError {
  if (isMarginApiError(error)) {
    return error;
  }

  if (error instanceof Error && error.name === 'AbortError') {
    return new MarginApiError('Request was aborted', {
      code: 'request_aborted',
      url: context.url,
      method: context.method,
      cause: error
    });
  }

  return new MarginApiError('Failed to reach the Margin API', {
    code: 'network_error',
    url: context.url,
    method: context.method,
    cause: error
  });
}
