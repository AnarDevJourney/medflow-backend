import { Topic } from '@medflow/contracts';

export const OUTBOX_OPTIONS = Symbol('OUTBOX_OPTIONS');

export interface OutboxModuleOptions {
  // The service's own domain topic (one topic per producer, DOC 5.1)
  topic: Topic;
}
