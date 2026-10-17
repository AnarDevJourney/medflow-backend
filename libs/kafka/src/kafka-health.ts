import { Inject, Injectable, OnApplicationShutdown } from '@nestjs/common';
import { HealthIndicatorService } from '@nestjs/terminus';
import { Admin, Kafka } from 'kafkajs';
import { KAFKA_CLIENT } from './kafka.constants';

const TIMEOUT_MS = 1500;

// "kafka" entry of GET /health: can we reach the broker right now?
@Injectable()
export class KafkaHealthIndicator implements OnApplicationShutdown {
  private admin: Admin | null = null;

  constructor(
    @Inject(KAFKA_CLIENT) private readonly kafka: Kafka,
    private readonly indicator: HealthIndicatorService,
  ) {}

  check = async () => {
    const result = this.indicator.check('kafka');
    try {
      await withTimeout(this.describeCluster(), TIMEOUT_MS);
      return result.up();
    } catch (error) {
      // Reconnect from scratch on the next check
      void this.admin?.disconnect().catch(() => undefined);
      this.admin = null;
      return result.down({ message: (error as Error).message });
    }
  };

  async onApplicationShutdown() {
    await this.admin?.disconnect();
  }

  private async describeCluster() {
    if (!this.admin) {
      this.admin = this.kafka.admin({ retry: { retries: 0 } });
      await this.admin.connect();
    }
    return this.admin.describeCluster();
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`timeout of ${ms}ms exceeded`)),
      ms,
    );
    promise.then(resolve, reject).finally(() => clearTimeout(timer));
  });
}
