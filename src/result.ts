/**
 * A dependency-free `Result` — a plain discriminated union, not a class. It
 * carries no methods, so it never locks you into rowcodec's error handling:
 * pattern-match on `ok`, or convert to your library of choice at the boundary
 * (see the README for neverthrow / fp-ts / effect adapters).
 */
export interface Ok<T> {
  readonly ok: true
  readonly value: T
}

export interface Err<E> {
  readonly ok: false
  readonly error: E
}

export type Result<T, E = MappingError> = Ok<T> | Err<E>

/** The structured error `safeMapRows` / `safeDecompose` report instead of throwing. */
export interface MappingError {
  readonly message: string
  /** Location of the failure, e.g. `posts[0].title` (empty when unknown). */
  readonly path: string
  /** The original thrown value (e.g. a `ZodError`), for inspection. */
  readonly cause?: unknown
}

/**
 * Error thrown by the (throwing) mapping functions, carrying the field `path`
 * where the failure occurred. The `message` is preserved from the underlying
 * error so existing messages/matchers keep working.
 */
export class RowcodecError extends Error {
  readonly path: string
  constructor(message: string, path: string, cause?: unknown) {
    super(message)
    this.name = 'RowcodecError'
    this.path = path
    if (cause !== undefined) this.cause = cause
  }
}

/** Wrap a thrown value with a path, preserving an already-located error. */
export function locate(thrown: unknown, path: string): RowcodecError {
  if (thrown instanceof RowcodecError) return thrown
  const message = thrown instanceof Error ? thrown.message : String(thrown)
  return new RowcodecError(message, path, thrown)
}

export const ok = <T>(value: T): Ok<T> => ({ ok: true, value })

export const err = <E>(error: E): Err<E> => ({ ok: false, error })

export const isOk = <T, E>(result: Result<T, E>): result is Ok<T> => result.ok

export const isErr = <T, E>(result: Result<T, E>): result is Err<E> => !result.ok

/** Normalize any thrown value into a `MappingError`. */
export function toMappingError(thrown: unknown): MappingError {
  if (thrown instanceof RowcodecError) {
    return { message: thrown.message, path: thrown.path, cause: thrown.cause ?? thrown }
  }
  return {
    message: thrown instanceof Error ? thrown.message : String(thrown),
    path: '',
    cause: thrown,
  }
}
