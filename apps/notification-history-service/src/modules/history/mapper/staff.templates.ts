import type { DomainEvent, StaffEventPayloads } from '@medflow/contracts';
import {
  actorName,
  message,
  HistoryEventType,
  HistoryTemplates,
} from './history-template';

const DEPARTMENT = 'DEPARTMENT';
const STAFF_MEMBER = 'STAFF_MEMBER';
const actor = (event: DomainEvent): string | null => event.actor?.name ?? null;

// staff.events
export const staffTemplates: HistoryTemplates<
  Extract<HistoryEventType, keyof StaffEventPayloads>
> = {
  'department.created': (event) => {
    const p = event.payload;
    return {
      entityType: DEPARTMENT,
      entityId: p.departmentId,
      summary: `${actorName(event)} created the department ${p.name}`,
      message: message('department.created', {
        actor: actor(event),
        name: p.name,
      }),
      metadata: { code: p.code },
    };
  },

  'department.updated': (event) => {
    const p = event.payload;
    const base = {
      entityType: DEPARTMENT,
      entityId: p.departmentId,
      metadata: { code: p.code, changedFields: p.changedFields },
    };
    const params = { actor: actor(event), name: p.name };
    if (!p.changedFields.includes('isActive')) {
      return {
        ...base,
        summary: `${actorName(event)} updated the department ${p.name} (${p.changedFields.join(', ')})`,
        message: message('department.updated', {
          ...params,
          fields: p.changedFields,
        }),
      };
    }
    return p.isActive
      ? {
          ...base,
          summary: `${actorName(event)} reactivated the department ${p.name}`,
          message: message('department.reactivated', params),
        }
      : {
          ...base,
          summary: `${actorName(event)} deactivated the department ${p.name}`,
          message: message('department.deactivated', params),
        };
  },

  // Entity = the person (user id), like the USER rows from auth. The own
  // edit (phone, bio) reads differently from an admin's edit.
  'staff.updated': (event) => {
    const p = event.payload;
    const name = `${p.firstName} ${p.lastName}`;
    const fields = p.changedFields.join(', ');
    const own = event.actor?.id === p.userId;
    return {
      entityType: STAFF_MEMBER,
      entityId: p.userId,
      summary: own
        ? `${name} updated their work profile (${fields})`
        : `${actorName(event)} updated the work profile of ${name} (${fields})`,
      message: own
        ? message('staff.profileUpdated', { name, fields: p.changedFields })
        : message('staff.updated', {
            actor: actor(event),
            name,
            fields: p.changedFields,
          }),
      metadata: {
        role: p.role,
        department: p.departmentName,
        title: p.title,
        changedFields: p.changedFields,
      },
    };
  },

  // Entity = the doctor (user id). Params carry ISO weekday numbers as
  // strings ('1' = Monday); the UI names them. An empty week reads
  // "cleared".
  'schedule.updated': (event) => {
    const p = event.payload;
    const name = `${p.firstName} ${p.lastName}`;
    const days = p.changedDays.map(String);
    const cleared = p.days.length === 0;
    return {
      entityType: STAFF_MEMBER,
      entityId: p.userId,
      summary: cleared
        ? `${actorName(event)} cleared the weekly schedule of ${name}`
        : `${actorName(event)} changed the weekly schedule of ${name} (days ${days.join(', ')})`,
      message: cleared
        ? message('schedule.cleared', { actor: actor(event), name })
        : message('schedule.updated', { actor: actor(event), name, days }),
      metadata: {
        changedDays: p.changedDays,
        workingDays: p.days.length,
      },
    };
  },

  // Params: type code (VACATION …) and 'YYYY-MM-DD' dates — the UI names
  // the type and formats the days. The reason never reaches history.
  'time_off.created': (event) => timeOffEntry(event, 'added'),
  'time_off.deleted': (event) => timeOffEntry(event, 'removed'),
};

const TIME_OFF_TYPES: Record<string, string> = {
  DAY_OFF: 'a day off',
  VACATION: 'a vacation',
  SICK_LEAVE: 'a sick leave',
  TRAINING: 'a training',
};

function timeOffEntry(
  event: DomainEvent<'time_off.created' | 'time_off.deleted'>,
  verb: 'added' | 'removed',
) {
  const p = event.payload;
  const name = `${p.firstName} ${p.lastName}`;
  const period =
    p.startDate === p.endDate ? p.startDate : `${p.startDate} – ${p.endDate}`;
  const what = TIME_OFF_TYPES[p.type] ?? p.type;
  return {
    entityType: STAFF_MEMBER,
    entityId: p.userId,
    summary: `${actorName(event)} ${verb} ${what} for ${name} (${period})`,
    message: message(verb === 'added' ? 'timeOff.created' : 'timeOff.deleted', {
      actor: actor(event),
      name,
      type: p.type,
      start: p.startDate,
      end: p.endDate,
    }),
    metadata: {
      type: p.type,
      startDate: p.startDate,
      endDate: p.endDate,
      days: p.days,
    },
  };
}
