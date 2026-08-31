/**
 * Where the credentials in force for the current request live.
 *
 * Deliberately its own module with no imports at all. The model layer needs to *read* a credential
 * and the provider-credentials service needs to *set* one, and that service imports `PROVIDER_ENV`
 * from the model layer — so putting the reader there too would make a cycle in which whichever
 * module loaded first would find the other half-initialised.
 *
 * **Why an async store rather than a parameter.** The reads happen deep in the model layer
 * (`providerHasCredentials`, `baseUrlFor`, `requireKey`) and are synchronous, while loading a
 * school's overrides is a query. Threading a credentials object down through the chat pipeline, the
 * agent loop, every provider adapter and the embedding batcher would change dozens of signatures
 * for a value none of them care about. AsyncLocalStorage carries it instead: the request boundary
 * puts the school's overrides in scope and these readers find them there. Async context follows
 * awaits, so it survives the whole agent run.
 */
import { AsyncLocalStorage } from 'node:async_hooks';

const store = new AsyncLocalStorage();

/**
 * Runs `fn` with one school's credential overrides in scope.
 *
 * `overrides` is keyed by environment-variable name (`OPENAI_API_KEY`, …) so that `credentialFor`
 * is a drop-in for `process.env[name]` and the two cannot disagree about what a name means. With
 * nothing to override, `fn` runs directly — no store, no cost, and the platform's environment
 * applies exactly as it did before any of this existed.
 */
export const withCredentials = (overrides, fn) =>
  overrides && Object.keys(overrides).length > 0 ? store.run(overrides, fn) : fn();

/** This school's value for an environment variable, falling back to the platform's. */
export const credentialFor = (name) => {
  if (!name) return undefined;
  const overrides = store.getStore();
  return overrides?.[name] ?? process.env[name];
};
