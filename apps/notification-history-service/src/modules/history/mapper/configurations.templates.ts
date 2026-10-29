import { roleAggregateId } from '@medflow/contracts';
import type { ConfigurationsEventPayloads } from '@medflow/contracts';
import {
  actorName,
  message,
  HistoryEventType,
  HistoryTemplates,
} from './history-template';

// configurations.events. Permission codes are data — the UI translates them.
export const configurationsTemplates: HistoryTemplates<
  Extract<HistoryEventType, keyof ConfigurationsEventPayloads>
> = {
  'role_permissions.updated': (event) => {
    const p = event.payload;
    const changes = [
      ...p.added.map((code) => `+${code}`),
      ...p.removed.map((code) => `-${code}`),
    ].join(', ');
    return {
      entityType: 'ROLE',
      entityId: roleAggregateId(p.role),
      summary: `${actorName(event)} changed the permissions of ${p.role} (${changes})`,
      message: message('permissions.updated', {
        actor: event.actor?.name ?? null,
        role: p.role,
        added: p.added,
        removed: p.removed,
      }),
      metadata: { role: p.role, added: p.added, removed: p.removed },
    };
  },
};
