import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Job, Queue, Worker } from 'bullmq';
import Redis from 'ioredis';
import { DataSource } from 'typeorm';
import { AppointmentEvents } from '@medflow/contracts';
import { OutboxService } from '@medflow/kafka';
import { toAppointmentPayload } from '../appointment.mapper';
import { Appointment, AppointmentStatus } from '../entities/appointment.entity';

const QUEUE = 'appointment-jobs';
const REMINDER = 'reminder';
const NO_SHOW_SWEEP = 'no-show-sweep';
const AGGREGATE = 'APPOINTMENT';
// The reminder goes out this long before the visit (DOC 6.2)
export const REMINDER_BEFORE_MS = 24 * 60 * 60 * 1000;
// Still SCHEDULED this long after the end → NO_SHOW
export const NO_SHOW_AFTER_MINUTES = 60;
const SWEEP_BATCH = 200;

interface ReminderData {
  appointmentId: string;
  startsAt: string; // the time the reminder was planned for
}

// One id per appointment, so a reschedule replaces it and a cancel removes
// it (BullMQ custom ids may not contain ':')
const reminderJobId = (appointmentId: string) => `reminder-${appointmentId}`;

// BullMQ jobs of the appointment lifecycle (DOC 6.8): a delayed reminder
// per appointment and the no-show sweep every 15 minutes. Both re-check the
// database when they run, so a stale job (moved, cancelled) does nothing.
@Injectable()
export class AppointmentJobsService
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(AppointmentJobsService.name);
  private queue?: Queue;
  private worker?: Worker;

  constructor(
    private readonly config: ConfigService,
    private readonly dataSource: DataSource,
    private readonly outbox: OutboxService,
  ) {}

  async onApplicationBootstrap() {
    const url = this.config.getOrThrow<string>('REDIS_URL');
    const connection = () => new Redis(url, { maxRetriesPerRequest: null });
    this.queue = new Queue(QUEUE, { connection: connection() });
    await this.queue.upsertJobScheduler(
      'no-show-sweep',
      { pattern: '*/15 * * * *', tz: 'Asia/Baku' },
      {
        name: NO_SHOW_SWEEP,
        opts: { removeOnComplete: true, removeOnFail: 100 },
      },
    );
    this.worker = new Worker(QUEUE, (job) => this.run(job), {
      connection: connection(),
      concurrency: 1,
    });
    this.worker.on('failed', (job, error) =>
      this.logger.error(`Job ${job?.name} ${job?.id} failed: ${error.message}`),
    );
  }

  async onApplicationShutdown() {
    await this.worker?.close();
    await this.queue?.close();
  }

  private run(job: Job): Promise<unknown> {
    if (job.name === REMINDER) {
      return this.sendReminder((job.data as ReminderData).appointmentId);
    }
    return this.sweepNoShows();
  }

  // Plans (or re-plans) the reminder at startsAt − 24 h; nothing when the
  // visit is less than 24 h away. Called after the booking is committed;
  // a Redis hiccup only costs the reminder, never the booking.
  async planReminder(appointment: Appointment): Promise<void> {
    try {
      await this.cancelReminder(appointment.id);
      const delay =
        appointment.startsAt.getTime() - REMINDER_BEFORE_MS - Date.now();
      if (delay <= 0) return;
      const data: ReminderData = {
        appointmentId: appointment.id,
        startsAt: appointment.startsAt.toISOString(),
      };
      await this.queue!.add(REMINDER, data, {
        jobId: reminderJobId(appointment.id),
        delay,
        removeOnComplete: true,
        removeOnFail: 100,
      });
    } catch (error) {
      this.logger.warn(
        `Reminder for ${appointment.id} not planned: ${(error as Error).message}`,
      );
    }
  }

  async cancelReminder(appointmentId: string): Promise<void> {
    try {
      await this.queue!.remove(reminderJobId(appointmentId));
    } catch (error) {
      this.logger.warn(
        `Reminder for ${appointmentId} not removed: ${(error as Error).message}`,
      );
    }
  }

  // The delay a planned reminder still has (ms), null if none is planned —
  // for the internal test endpoint
  async reminderDelay(appointmentId: string): Promise<number | null> {
    const job = await this.queue!.getJob(reminderJobId(appointmentId));
    if (!job) return null;
    return Math.max(0, job.timestamp + (job.opts.delay ?? 0) - Date.now());
  }

  // appointment.reminder_due once: still SCHEDULED, in the future, and not
  // reminded yet. Returns whether the event was written.
  async sendReminder(appointmentId: string): Promise<boolean> {
    return this.dataSource.transaction(async (em) => {
      const row = await em.findOne(Appointment, {
        where: { id: appointmentId },
        lock: { mode: 'pessimistic_write' },
      });
      if (
        !row ||
        row.status !== AppointmentStatus.SCHEDULED ||
        row.reminderSentAt ||
        row.startsAt.getTime() <= Date.now()
      ) {
        return false;
      }
      row.reminderSentAt = new Date();
      await em.save(row);
      await this.outbox.add(em, {
        eventType: AppointmentEvents.APPOINTMENT_REMINDER_DUE,
        aggregateType: AGGREGATE,
        aggregateId: row.id,
        actor: null,
        payload: toAppointmentPayload(row),
      });
      return true;
    });
  }

  // SCHEDULED appointments that ended more than an hour ago → NO_SHOW, in
  // batches. SKIP LOCKED: a row being checked in right now is left for the
  // next run. Returns how many were marked.
  async sweepNoShows(): Promise<number> {
    let total = 0;
    for (;;) {
      const marked = await this.dataSource.transaction(async (em) => {
        const rows = await em
          .createQueryBuilder(Appointment, 'a')
          .where('a.status = :status', { status: AppointmentStatus.SCHEDULED })
          .andWhere(
            `a.endsAt < now() - make_interval(mins => ${NO_SHOW_AFTER_MINUTES})`,
          )
          .orderBy('a.endsAt', 'ASC')
          .limit(SWEEP_BATCH)
          .setLock('pessimistic_write')
          .setOnLocked('skip_locked')
          .getMany();
        for (const row of rows) {
          row.status = AppointmentStatus.NO_SHOW;
          await em.save(row);
          await this.outbox.add(em, {
            eventType: AppointmentEvents.APPOINTMENT_NO_SHOW,
            aggregateType: AGGREGATE,
            aggregateId: row.id,
            actor: null,
            payload: toAppointmentPayload(row),
          });
        }
        return rows.length;
      });
      total += marked;
      if (marked < SWEEP_BATCH) break;
    }
    if (total) this.logger.log(`Marked ${total} appointment(s) as no-show`);
    return total;
  }
}
