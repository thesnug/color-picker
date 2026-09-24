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
import type { EntryType, Questions, RequestOptions, SystemOneRequest, SystemOneResult } from "@typesafe-ai/sdk";
export type { ChoiceResponse, EntryType, NoulResponse, Question, Questions, ScoreResponse, } from "@typesafe-ai/sdk";
/** Answers keyed by question name, typed from the questions asked. */
export type Answers<Q extends Questions> = SystemOneResult<Q>["answers"];
/** The part of `TypeSafeClient` that `ask` uses. Pass one to replace the SDK client, as tests do. */
export interface SystemOneClient {
    systemOne<const Q extends Questions>(request: SystemOneRequest<Q>, options?: RequestOptions): PromiseLike<SystemOneResult<Q>>;
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
export declare class JevUnavailableError extends Error {
    readonly reason: JevUnavailableReason;
    constructor(reason: JevUnavailableReason, options?: ErrorOptions);
}
/** Bump when the cache file format changes, to invalidate every cached answer. */
export declare const JEV_CACHE_FORMAT = 1;
/** The answers committed in this package, under `assets/cache/`. */
export declare const COMMITTED_CACHE_DIR: string;
export declare function defaultCacheDir(): string;
/**
 * Whether a cache miss could be answered: the SDK is installed and an API key
 * is set. Lets a feature decide up front to skip Jev and say why.
 */
export declare function jevAvailability(): Promise<{
    available: true;
} | {
    available: false;
    reason: JevUnavailableReason;
}>;
/** The cache key for a request. Exported so features can find or audit committed answers. */
export declare function cacheKey(state: EntryType, questions: Questions, options: Pick<AskOptions, "version" | "model">): string;
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
export declare function ask<const Q extends Questions>(state: EntryType, questions: Q, options: AskOptions): Promise<AskResult<Q>>;
/** Forget the shared SDK client, so the next miss builds a new one. For tests. */
export declare function resetJevClient(): void;
//# sourceMappingURL=index.d.ts.map