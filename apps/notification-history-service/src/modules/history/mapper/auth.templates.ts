import type { AuthEventPayloads, DomainEvent } from '@medflow/contracts';
import {
  actorName,
  message,
  HistoryEventType,
  HistoryTemplates,
} from './history-template';

const USER = 'USER';
// The actor's name, or null = "System" in the reader's language
const actor = (event: DomainEvent): string | null => event.actor?.name ?? null;

// auth.events. inviteLink / resetLink hold raw tokens and are never copied.
export const authTemplates: HistoryTemplates<
  Extract<HistoryEventType, keyof AuthEventPayloads>
> = {
  'user.invited': (event) => {
    const p = event.payload;
    const name = `${p.firstName} ${p.lastName}`;
    return {
      entityType: USER,
      entityId: p.userId,
      summary: p.resent
        ? `${actorName(event)} resent the invitation to ${name}`
        : event.actor
          ? `${actorName(event)} invited ${name} as ${p.role}`
          : `${name} was created as ${p.role} by the system`, // seeded admin
      message: p.resent
        ? message('user.invitationResent', { actor: actor(event), name })
        : event.actor
          ? message('user.invited', { actor: actor(event), name, role: p.role })
          : message('user.createdBySystem', { name, role: p.role }),
      metadata: {
        email: p.email,
        role: p.role,
        departmentId: p.departmentId,
        title: p.title,
        resent: p.resent,
      },
    };
  },

  'user.activated': (event) => {
    const p = event.payload;
    const name = `${p.firstName} ${p.lastName}`;
    return {
      entityType: USER,
      entityId: p.userId,
      summary: event.actor
        ? `${name} accepted the invitation and activated the account`
        : `The account of ${name} was activated by the system`,
      message: {
        key: event.actor ? 'user.activated' : 'user.activatedBySystem',
        params: { name },
      },
      metadata: { email: p.email, role: p.role },
    };
  },

  'user.updated': (event) => {
    const p = event.payload;
    const name = `${p.firstName} ${p.lastName}`;
    const fields = p.changedFields.join(', ');
    return {
      entityType: USER,
      entityId: p.userId,
      summary:
        event.actor?.id === p.userId
          ? `${name} updated their profile (${fields})`
          : `${actorName(event)} updated the account of ${name} (${fields})`,
      message:
        event.actor?.id === p.userId
          ? message('user.profileUpdated', { name, fields: p.changedFields })
          : message('user.updated', {
              actor: actor(event),
              name,
              fields: p.changedFields,
            }),
      metadata: {
        email: p.email,
        role: p.role,
        changedFields: p.changedFields,
      },
    };
  },

  'user.deactivated': (event) => {
    const p = event.payload;
    return {
      entityType: USER,
      entityId: p.userId,
      summary: `${actorName(event)} deactivated the account of ${p.email}`,
      message: message('user.deactivated', {
        actor: actor(event),
        email: p.email,
      }),
      metadata: { email: p.email, role: p.role },
    };
  },

  'user.reactivated': (event) => {
    const p = event.payload;
    return {
      entityType: USER,
      entityId: p.userId,
      summary: `${actorName(event)} reactivated the account of ${p.email}`,
      message: message('user.reactivated', {
        actor: actor(event),
        email: p.email,
      }),
      metadata: { email: p.email, role: p.role, status: p.status },
    };
  },

  'user.session_revoked': (event) => {
    const p = event.payload;
    return {
      entityType: USER,
      entityId: p.userId,
      summary:
        'All sessions were revoked: a used refresh token was presented again (possible token theft)',
      message: message('user.sessionRevoked', {}),
      metadata: { reason: p.reason, familyId: p.familyId },
    };
  },

  'user.password_changed': (event) => {
    const p = event.payload;
    const name = event.actor?.name ?? p.firstName;
    return {
      entityType: USER,
      entityId: p.userId,
      summary:
        p.via === 'RESET'
          ? `${name} reset their password with an email link`
          : `${name} changed their password`,
      message: {
        key: p.via === 'RESET' ? 'user.passwordReset' : 'user.passwordChanged',
        params: { name },
      },
      metadata: { email: p.email, via: p.via },
    };
  },
};
