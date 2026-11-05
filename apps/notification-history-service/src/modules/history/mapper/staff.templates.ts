import type { DomainEvent, StaffEventPayloads } from '@medflow/contracts';
import {
  actorName,
  message,
  HistoryEventType,
  HistoryTemplates,
} from './history-template';

const DEPARTMENT = 'DEPARTMENT';
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
};
