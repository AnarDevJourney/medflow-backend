import { Logger } from '@nestjs/common';
import { logLevel, LogEntry } from 'kafkajs';

const REPEAT_WINDOW_MS = 30_000;

// KafkaJS retries these by itself (broker restarting, coordinator still
// loading) — warnings, not errors. A real failure reaches our code as an
// exception and is logged there (outbox poller, consumer DLQ).
const RETRIED = [
  /^Response /,
  /^Connection error/,
  /^Connection timeout/,
  /^Failed to connect to seed broker/,
];

// Routes KafkaJS logs through Nest's logger (warnings and errors only).
// While the broker is down every client logs the same line every second,
// so a repeated line is printed at most once per 30 s.
export function nestLogCreator() {
  const logger = new Logger('Kafka');
  const lastLogged = new Map<string, number>();

  return ({ level, log }: LogEntry) => {
    if (level > logLevel.WARN) return;
    const { message, error } = log;
    const text = error ? `${message}: ${String(error)}` : message;

    const now = Date.now();
    if (now - (lastLogged.get(text) ?? 0) < REPEAT_WINDOW_MS) return;
    lastLogged.set(text, now);
    if (lastLogged.size > 100) lastLogged.clear();

    if (level === logLevel.ERROR && !RETRIED.some((re) => re.test(message))) {
      logger.error(text);
    } else {
      logger.warn(text);
    }
  };
}
