import { AsyncLocalStorage } from 'node:async_hooks';

// Per-request metadata readable from anywhere in the call chain (logs,
// outbox correlationId) without passing the Request object around.
// Populated once per request by requestIdMiddleware.
export interface RequestContextStore {
  requestId: string | null;
}

const storage = new AsyncLocalStorage<RequestContextStore>();

export const requestContext = {
  run<T>(store: RequestContextStore, callback: () => T): T {
    return storage.run(store, callback);
  },
  get(): RequestContextStore {
    return storage.getStore() ?? { requestId: null };
  },
};
