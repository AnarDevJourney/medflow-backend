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
};
