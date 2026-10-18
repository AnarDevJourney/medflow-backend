import type { Logger } from '@nestjs/common';
import type { KafkaMessage, Producer } from 'kafkajs';
import { DeadLetter, EventEnvelope, Topics } from '@medflow/contracts';

// Message that can never succeed (not JSON, not an envelope) → straight to
// the dead letters, no retries
export class InvalidMessageError extends Error {}

export function parseEnvelope(message: KafkaMessage): EventEnvelope {
  let value: unknown;
  try {
    value = JSON.parse(message.value?.toString() ?? '');
  } catch {
    throw new InvalidMessageError('Message is not valid JSON');
  }
  const envelope = value as Partial<EventEnvelope> | null;
  if (
    typeof envelope?.eventId !== 'string' ||
    typeof envelope.eventType !== 'string' ||
    typeof envelope.payload !== 'object' ||
    envelope.payload === null
  ) {
    throw new InvalidMessageError('Message is not an event envelope');
  }
  return envelope as EventEnvelope;
}

// Parks the original message in dead-letter.events (DOC 5.5). If this send
// fails too, the error propagates: the offset is not committed and KafkaJS
// redelivers the message later.
export async function sendToDeadLetter(
  producer: Producer,
  failedBy: string,
  logger: Logger,
  topic: string,
  partition: number,
  message: KafkaMessage,
  error: Error,
): Promise<void> {
  const letter: DeadLetter = {
    originalTopic: topic,
    partition,
    offset: message.offset,
    key: message.key?.toString() ?? null,
    value: message.value?.toString() ?? null,
    error: error.message,
    failedBy,
    failedAt: new Date().toISOString(),
  };
  await producer.send({
    topic: Topics.DEAD_LETTER,
    messages: [{ key: letter.key, value: JSON.stringify(letter) }],
  });
  const kind =
    error instanceof InvalidMessageError ? 'Invalid message' : 'Message';
  logger.error(
    `${kind} at ${topic}[${partition}]@${message.offset} moved to ${Topics.DEAD_LETTER}: ${error.message}`,
  );
}
