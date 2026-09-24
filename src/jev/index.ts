/**
 * `@thesnug/color-picker/jev`: the one path every Jev judgment in this package
 * takes. See docs/DESIGN.md, "Jev (TypeSafe System One)".
 *
 * `ask` sends all of a feature's questions about one state in a single System
 * One request and caches the answers on disk, keyed by the feature's question
 * version, the question definitions, and the state, so a judgment is paid for
 * once. A cache hit needs neither the SDK nor an API key, which is how answers
 * committed under `assets/cache/` work everywhere.
 *
 * `@typesafe-ai/sdk` is an optional peer dependency, loaded only on a cache
 * miss. The API key is read from `TYPESAFE_API_KEY` by the SDK itself; this
 * module never reads its value, passes it, or logs it.
 */

import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import type {
  EntryType,
  Questions,
  RequestOptions,
  SystemOneRequest,
  SystemOneResult,
} from "@typesafe-ai/sdk";

export type {
  ChoiceResponse,
  EntryType,
  NoulResponse,
  Question,
  Questions,
  ScoreResponse,
} from "@typesafe-ai/sdk";

/** Answers keyed by question name, typed from the questions asked. */
export type Answers<Q extends Questions> = SystemOneResult<Q>["answers"];

/** The part of `TypeSafeClient` that `ask` uses. Pass one to replace the SDK client, as tests do. */
export interface SystemOneClient {
  systemOne<const Q extends Questions>(
    request: SystemOneRequest<Q>,
    options?: RequestOptions,
  ): PromiseLike<SystemOneResult<Q>>;
}

export interface AskOptions {
  /**
   * The asking feature's question version. Bump it when the wording, criteria,
   * or meaning of the questions changes in a way the definitions alone do not
   * capture, to invalidate every cached answer for them.
   */
  version: string | number;
  /**
   * Directory of cached answers, or `false` to skip the cache. Defaults to
   * `$XDG_CACHE_HOME/color-picker/jev`, or `~/.cache/...` when unset. Pass
   * `COMMITTED_CACHE_DIR` to read and write the answers committed in this repo.
   */
  cache?: string | false;
  /** Model override. Part of the cache key when given. Defaults to the SDK's default, `jev-latest`. */
  model?: string;
  /** Replaces the SDK client. When given, neither the SDK nor `TYPESAFE_API_KEY` is needed. */
  client?: SystemOneClient;
  /** Cancels the request and any pending retries. */
  signal?: AbortSignal;
}

export interface AskResult<Q extends Questions> {
  answers: Answers<Q>;
  /** The model that answered, as it reported itself. */
  model: string;
  /** True when the answers came from the cache and no request was sent. */
  cached: boolean;
  /** The cache key: SHA-256 of the version, questions, state, and model override. */
  key: string;
}

/** Why Jev cannot be called. */
export type JevUnavailableReason = "sdk-missing" | "api-key-missing";

/**
 * Raised on a cache miss when Jev cannot be called. Callers that degrade
 * gracefully catch this and report `reason`.
 */
export class JevUnavailableError extends Error {
  readonly reason: JevUnavailableReason;

  constructor(reason: JevUnavailableReason, options?: ErrorOptions) {
    super(
      reason === "sdk-missing"
        ? "This Jev feature needs `@typesafe-ai/sdk`, an optional peer dependency. " +
            "Install it next to @thesnug/color-picker with `npm install @typesafe-ai/sdk`."
        : "This Jev feature needs a TypeSafe API key. Set the `TYPESAFE_API_KEY` environment variable.",
      options,
    );
    this.name = "JevUnavailableError";
    this.reason = reason;
  }
}

/** Bump when the cache file format changes, to invalidate every cached answer. */
export const JEV_CACHE_FORMAT = 1;

/** The answers committed in this package, under `assets/cache/`. */
export const COMMITTED_CACHE_DIR = fileURLToPath(new URL("../../assets/cache/", import.meta.url));

export function defaultCacheDir(): string {
  const base = process.env.XDG_CACHE_HOME || join(homedir(), ".cache");
  return join(base, "color-picker", "jev");
}

// ---------------------------------------------------------------------------
// Availability

type SdkModule = typeof import("@typesafe-ai/sdk");

async function loadSdk(): Promise<SdkModule> {
  try {
    return await import("@typesafe-ai/sdk");
  } catch (error) {
    throw new JevUnavailableError("sdk-missing", { cause: error });
  }
}

/** True when `TYPESAFE_API_KEY` is set to something other than whitespace. Never reads it further. */
function hasApiKey(): boolean {
  return Boolean(process.env.TYPESAFE_API_KEY?.trim());
}

/**
 * Whether a cache miss could be answered: the SDK is installed and an API key
 * is set. Lets a feature decide up front to skip Jev and say why.
 */
export async function jevAvailability(): Promise<
  { available: true } | { available: false; reason: JevUnavailableReason }
> {
  if (!hasApiKey()) return { available: false, reason: "api-key-missing" };
  try {
    await loadSdk();
    return { available: true };
  } catch (error) {
    if (error instanceof JevUnavailableError) return { available: false, reason: error.reason };
    throw error;
  }
}

let sharedClient: SystemOneClient | undefined;

async function defaultClient(): Promise<SystemOneClient> {
  if (sharedClient) return sharedClient;
  // Checked before loading the SDK so the error names the missing key, not a
  // constructor failure. The SDK reads the key from the environment itself.
  if (!hasApiKey()) throw new JevUnavailableError("api-key-missing");
  const { TypeSafeClient } = await loadSdk();
  sharedClient = new TypeSafeClient();
  return sharedClient;
}

// ---------------------------------------------------------------------------
// Cache

interface CacheEntry {
  format: number;
  version: string | number;
  model: string;
  answeredAt: string;
  answers: Record<string, { type: string }>;
}

/**
 * JSON with object keys sorted at every depth, so the same state and questions
 * hash the same however their keys were ordered. Arrays keep their order:
 * score rubrics are ordered.
 */
function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) => {
    if (v === null || typeof v !== "object" || Array.isArray(v)) return v;
    return Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
  });
}

/** The cache key for a request. Exported so features can find or audit committed answers. */
export function cacheKey(
  state: EntryType,
  questions: Questions,
  options: Pick<AskOptions, "version" | "model">,
): string {
  const parts: Record<string, unknown> = { version: options.version, questions, state };
  if (options.model !== undefined) parts.model = options.model;
  return createHash("sha256").update(canonicalJson(parts)).digest("hex");
}

async function readCache<Q extends Questions>(
  path: string,
  questions: Q,
  version: string | number,
): Promise<CacheEntry | undefined> {
  let entry: CacheEntry;
  try {
    entry = JSON.parse(await readFile(path, "utf8")) as CacheEntry;
  } catch {
    // Missing or unreadable: ask again and overwrite.
    return undefined;
  }
  if (entry.format !== JEV_CACHE_FORMAT || entry.version !== version) return undefined;
  // The key already covers the questions; this guards against a hand-edited
  // or truncated file.
  for (const [name, question] of Object.entries(questions)) {
    if (entry.answers?.[name]?.type !== question.type) return undefined;
  }
  return entry;
}

async function writeCache(dir: string, path: string, entry: CacheEntry): Promise<void> {
  await mkdir(dir, { recursive: true });
  // Write then rename, so a concurrent reader never sees half a file.
  const temp = `${path}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temp, `${JSON.stringify(entry, null, 2)}\n`);
  await rename(temp, path);
}

// ---------------------------------------------------------------------------
// Ask

/**
 * Ask Jev every question in `questions` about `state` in one request, and
 * return the answers typed by question name and criteria.
 *
 * Answers are cached as `<key>.json` in the cache directory. A hit returns
 * without loading the SDK or needing a key; a changed `version`, question, or
 * state misses.
 *
 * @throws {JevUnavailableError} on a cache miss when the SDK is not installed or
 *   `TYPESAFE_API_KEY` is not set, and no `client` is given.
 * @throws {TypeError} when `questions` is empty.
 * @throws the SDK's `APIError` or `APIConnectionError` when the request fails after its retries.
 */
export async function ask<const Q extends Questions>(
  state: EntryType,
  questions: Q,
  options: AskOptions,
): Promise<AskResult<Q>> {
  if (Object.keys(questions).length === 0) throw new TypeError("ask needs at least one question.");

  const key = cacheKey(state, questions, options);
  const dir = options.cache === undefined ? defaultCacheDir() : options.cache;
  const path = dir === false ? undefined : join(dir, `${key}.json`);

  if (path) {
    const cached = await readCache(path, questions, options.version);
    if (cached) return { answers: cached.answers as unknown as Answers<Q>, model: cached.model, cached: true, key };
  }

  const client = options.client ?? (await defaultClient());
  const request: SystemOneRequest<Q> = { state, questions };
  if (options.model !== undefined) request.model = options.model;
  const requestOptions: RequestOptions = {};
  if (options.signal) requestOptions.signal = options.signal;
  const result = await client.systemOne(request, requestOptions);

  if (dir !== false && path) {
    await writeCache(dir, path, {
      format: JEV_CACHE_FORMAT,
      version: options.version,
      model: result.model,
      answeredAt: new Date().toISOString(),
      answers: result.answers as unknown as CacheEntry["answers"],
    });
  }
  return { answers: result.answers, model: result.model, cached: false, key };
}

/** Forget the shared SDK client, so the next miss builds a new one. For tests. */
export function resetJevClient(): void {
  sharedClient = undefined;
}
