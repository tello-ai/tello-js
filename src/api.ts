import { randomUUID } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import { ENV_API_KEY } from "./config.js";
import { CrewGenerationTimeoutError, type JsonObject } from "./errors.js";
import {
  CALL_OUTCOME_UNKNOWN,
  checkIdempotencyKey,
  pathId,
  resolveApiUrl,
  RestTransport,
  REVISE_OUTCOME_UNKNOWN,
  WRITE_OUTCOME_UNKNOWN,
} from "./rest.js";

export const DEFAULT_API_URL = "https://api.telloai.io/v1";
export const ENV_API_URL = "TELLO_API_URL";

export type TelloApiOptions = {
  /** Server API key; falls back to `TELLO_API_KEY`. */
  apiKey?: string;
  /** REST base URL; falls back to `TELLO_API_URL`, then `https://api.telloai.io/v1`. */
  apiUrl?: string;
  /** Per-request timeout in ms. Default 30 000. */
  timeoutMs?: number;
  /** Timeout in ms for call drafts and crew generation. Default 120 000. */
  longTimeoutMs?: number;
};

export type IdempotencyOptions = {
  /**
   * Sent as `Idempotency-Key`: resending the same request with the same key
   * returns the first answer instead of doing it again. 1-255 printable ASCII
   * characters, no comma.
   */
  idempotencyKey?: string;
};

export interface Tool {
  id: string;
  type: string;
  name: string;
  revision?: number;
  [field: string]: unknown;
}

export interface ToolPage {
  data: Tool[];
  /** Pass as `cursor` for the next page; null on the last page. */
  nextCursor: string | null;
  [field: string]: unknown;
}

export type ListToolsQuery = {
  /** Page size, 1-100 (server default 50). */
  limit?: number;
  /** The previous page's `nextCursor`. */
  cursor?: string;
};

export interface Agent {
  id: string;
  name: string;
  revision?: number;
  [field: string]: unknown;
}

export interface Crew {
  id: string;
  name: string;
  graph?: JsonObject;
  entryNodeId?: string;
  revision?: number;
  /** Names to fill in `variables` when calling the production revision. */
  requiredVariables?: string[];
  [field: string]: unknown;
}

/** An entry of `GET /agents` or `GET /crews`. */
export interface TargetSummary {
  id: string;
  name: string;
  description: string | null;
  /** Whether this is the account's default target (at most one across agents and crews). */
  isDefault: boolean;
  [field: string]: unknown;
}

export interface TargetList {
  data: TargetSummary[];
  [field: string]: unknown;
}

export interface CrewGenerateInput {
  /** The business goal, 1-2000 characters. */
  goal: string;
  [field: string]: unknown;
}

/** A crew generation job (`POST /crews/generate`, `GET /crew-generations/{id}`). */
export interface CrewGeneration {
  id: string;
  status: "running" | "succeeded" | "failed";
  goal?: string;
  /** The crew built; also present on some failures when the crew was left behind. */
  crew?: Crew | null;
  /** Why a failed job failed; branch on `code` (e.g. `crew_deploy_failed`). */
  error?: { code: string; message: string; [field: string]: unknown } | null;
  [field: string]: unknown;
}

export type GenerateAndWaitOptions = IdempotencyOptions & {
  /** Delay between job lookups in ms. Default 2 000. */
  pollIntervalMs?: number;
  /** Give up with {@link CrewGenerationTimeoutError} after this many ms. Default 600 000. */
  timeoutMs?: number;
};

/** The `POST /call-drafts` body: the agent request of a call create, without `crewId`. */
export interface CallDraftInput {
  agentId: string;
  to: string;
  /** This call's goal, up to 2000 characters; required when the agent stores none. */
  instructions?: string;
  variables?: JsonObject;
  [field: string]: unknown;
}

export interface CallDraft {
  /** `cd_` id; null when no draft was stored. */
  id: string | null;
  status: "pendingConfirmation" | "needsClarification" | "refused" | "confirmed";
  preview?: { summary: string; [field: string]: unknown } | null;
  /** The AI's question when `needsClarification`. */
  question?: string | null;
  revision?: number;
  revisionsLeft?: number;
  expiresAt?: string;
  /** The call placed at once, only when `confirmed`. */
  callId?: string | null;
  [field: string]: unknown;
}

/** A call object as the calls API returns it. */
export interface Call {
  id: string;
  status: string;
  [field: string]: unknown;
}

/**
 * Client for the Tello public REST resource API: tools, agents, crews, crew
 * generation and call drafts. Separate from the WebSocket {@link TelloClient}.
 *
 * Writes go live at once: a create or update deploys and promotes what it
 * saves, and the next call uses it. Requests are never retried; see
 * {@link TelloApiConnectionError} for what a lost response means.
 */
export class TelloApi {
  /** The REST base URL requests go to, without a trailing slash. */
  readonly apiUrl: string;
  readonly tools: ToolsApi;
  readonly agents: AgentsApi;
  readonly crews: CrewsApi;
  readonly crewGenerations: CrewGenerationsApi;
  readonly callDrafts: CallDraftsApi;

  constructor(options: TelloApiOptions = {}) {
    const apiKey = options.apiKey ?? process.env[ENV_API_KEY];
    if (!apiKey) {
      throw new Error(`apiKey is required (pass apiKey or set ${ENV_API_KEY})`);
    }
    this.apiUrl = resolveApiUrl(options.apiUrl ?? process.env[ENV_API_URL] ?? DEFAULT_API_URL);
    const transport = new RestTransport(
      apiKey,
      this.apiUrl,
      options.timeoutMs ?? 30_000,
      options.longTimeoutMs ?? 120_000,
    );
    this.tools = new ToolsApi(transport);
    this.agents = new AgentsApi(transport, "/agents");
    this.crewGenerations = new CrewGenerationsApi(transport);
    this.crews = new CrewsApi(transport, this.crewGenerations);
    this.callDrafts = new CallDraftsApi(transport);
  }
}

/** `/tools`: tools the account's agents and crews can call. */
export class ToolsApi {
  readonly #transport: RestTransport;

  constructor(transport: RestTransport) {
    this.#transport = transport;
  }

  /** One page of tools in id order. */
  async list(query: ListToolsQuery = {}): Promise<ToolPage> {
    return this.#transport.object<ToolPage>({
      method: "GET",
      path: "/tools",
      query: { limit: query.limit, cursor: query.cursor },
      expect: [200],
    });
  }

  async get(id: string): Promise<Tool> {
    return this.#transport.object<Tool>({ method: "GET", path: `/tools/${pathId(id)}`, expect: [200] });
  }

  /** Creates a tool; it is live at once. */
  async create(body: JsonObject, options: IdempotencyOptions = {}): Promise<Tool> {
    return this.#transport.object<Tool>({
      method: "POST",
      path: "/tools",
      body,
      expect: [201],
      idempotencyKey: checkIdempotencyKey(options.idempotencyKey),
      outcomeUnknown: WRITE_OUTCOME_UNKNOWN,
    });
  }

  /** Changes only the fields in `patch`; it is live at once. */
  async update(id: string, patch: JsonObject): Promise<Tool> {
    return this.#transport.object<Tool>({
      method: "PATCH",
      path: `/tools/${pathId(id)}`,
      body: patch,
      expect: [200],
      outcomeUnknown: WRITE_OUTCOME_UNKNOWN,
    });
  }

  async delete(id: string): Promise<void> {
    return this.#transport.empty({
      method: "DELETE",
      path: `/tools/${pathId(id)}`,
      expect: [204],
      outcomeUnknown: WRITE_OUTCOME_UNKNOWN,
    });
  }
}

/** List, get, create, update and delete of a call target (agent or crew). */
export abstract class TargetApi<T extends JsonObject> {
  protected readonly transport: RestTransport;
  readonly #path: string;

  constructor(transport: RestTransport, path: string) {
    this.transport = transport;
    this.#path = path;
  }

  /** Every target of this kind on the account. */
  async list(): Promise<TargetList> {
    return this.transport.object<TargetList>({ method: "GET", path: this.#path, expect: [200] });
  }

  async get(id: string): Promise<T> {
    return this.transport.object<T>({ method: "GET", path: `${this.#path}/${pathId(id)}`, expect: [200] });
  }

  /** Creates, deploys and promotes it; the next call uses it. */
  async create(body: JsonObject, options: IdempotencyOptions = {}): Promise<T> {
    return this.transport.object<T>({
      method: "POST",
      path: this.#path,
      body,
      expect: [201],
      idempotencyKey: checkIdempotencyKey(options.idempotencyKey),
      outcomeUnknown: WRITE_OUTCOME_UNKNOWN,
    });
  }

  /** Changes only the fields in `patch`, then deploys and promotes it. */
  async update(id: string, patch: JsonObject): Promise<T> {
    return this.transport.object<T>({
      method: "PATCH",
      path: `${this.#path}/${pathId(id)}`,
      body: patch,
      expect: [200],
      outcomeUnknown: WRITE_OUTCOME_UNKNOWN,
    });
  }

  async delete(id: string): Promise<void> {
    return this.transport.empty({
      method: "DELETE",
      path: `${this.#path}/${pathId(id)}`,
      expect: [204],
      outcomeUnknown: WRITE_OUTCOME_UNKNOWN,
    });
  }
}

/** `/agents`: single agents that answer calls. */
export class AgentsApi extends TargetApi<Agent> {}

/** `/crews`: graphs of member agents that hand a call over to each other. */
export class CrewsApi extends TargetApi<Crew> {
  readonly #generations: CrewGenerationsApi;

  constructor(transport: RestTransport, generations: CrewGenerationsApi) {
    super(transport, "/crews");
    this.#generations = generations;
  }

  /**
   * Starts building, deploying and promoting a crew from a goal. The account
   * builds one crew at a time: another goal in progress is
   * `409 crew_generation_in_progress` (`data.id` is that job); the same goal
   * returns its job instead of a new one.
   */
  async generate(input: CrewGenerateInput, options: IdempotencyOptions = {}): Promise<CrewGeneration> {
    return this.transport.object<CrewGeneration>({
      method: "POST",
      path: "/crews/generate",
      body: input,
      expect: [202, 200],
      idempotencyKey: checkIdempotencyKey(options.idempotencyKey),
      long: true,
      outcomeUnknown: WRITE_OUTCOME_UNKNOWN,
    });
  }

  /**
   * {@link generate}, then polls the job until it is no longer `running` and
   * returns it. A `failed` job is returned, not thrown: branch on `status`.
   */
  async generateAndWait(input: CrewGenerateInput, options: GenerateAndWaitOptions = {}): Promise<CrewGeneration> {
    const pollIntervalMs = options.pollIntervalMs ?? 2_000;
    const timeoutMs = options.timeoutMs ?? 600_000;
    const deadline = Date.now() + timeoutMs;
    let job = await this.generate(input, { idempotencyKey: options.idempotencyKey });
    while (job.status === "running") {
      const left = deadline - Date.now();
      if (left <= 0) {
        throw new CrewGenerationTimeoutError(job.id, timeoutMs);
      }
      await sleep(Math.min(pollIntervalMs, left));
      job = await this.#generations.get(job.id);
    }
    return job;
  }
}

/** `/crew-generations`: jobs started by `crews.generate`. */
export class CrewGenerationsApi {
  readonly #transport: RestTransport;

  constructor(transport: RestTransport) {
    this.#transport = transport;
  }

  async get(id: string): Promise<CrewGeneration> {
    return this.#transport.object<CrewGeneration>({
      method: "GET",
      path: `/crew-generations/${pathId(id)}`,
      expect: [200],
    });
  }
}

/**
 * `/call-drafts`: review the scenario of an outbound call before dialing.
 * Confirming a draft places a real, billed call.
 */
export class CallDraftsApi {
  readonly #transport: RestTransport;

  constructor(transport: RestTransport) {
    this.#transport = transport;
  }

  /**
   * Builds a draft. Usually nothing is dialed (`pendingConfirmation`,
   * `needsClarification`, `refused`), but an agent with a ready scenario is
   * called at once (`confirmed` with `callId`). Every status is a success.
   */
  async create(body: CallDraftInput, options: IdempotencyOptions = {}): Promise<CallDraft> {
    return this.#transport.object<CallDraft>({
      method: "POST",
      path: "/call-drafts",
      body,
      expect: [201],
      idempotencyKey: checkIdempotencyKey(options.idempotencyKey),
      long: true,
      outcomeUnknown: CALL_OUTCOME_UNKNOWN,
    });
  }

  /** Applies `request` and returns a draft with a new id; the old one can no longer be confirmed. */
  async revise(draftId: string, request: string, options: IdempotencyOptions = {}): Promise<CallDraft> {
    return this.#transport.object<CallDraft>({
      method: "POST",
      path: `/call-drafts/${pathId(draftId)}/revise`,
      body: { request },
      expect: [200],
      idempotencyKey: checkIdempotencyKey(options.idempotencyKey),
      long: true,
      outcomeUnknown: REVISE_OUTCOME_UNKNOWN,
    });
  }

  /**
   * Places the draft's call — a real, billed call — and returns it. The API
   * requires an idempotency key, so a UUID v4 is made when none is given; it
   * is on any error (`idempotencyKey`) so a retry with it never dials twice.
   */
  async confirm(draftId: string, options: IdempotencyOptions = {}): Promise<Call> {
    return this.#transport.object<Call>({
      method: "POST",
      path: `/call-drafts/${pathId(draftId)}/confirm`,
      expect: [201],
      idempotencyKey: checkIdempotencyKey(options.idempotencyKey) ?? randomUUID(),
      long: true,
      outcomeUnknown: CALL_OUTCOME_UNKNOWN,
    });
  }
}
