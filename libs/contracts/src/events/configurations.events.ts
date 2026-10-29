import { createHash } from 'node:crypto';

// configurations.events — published by configurations-service.
// Aggregate = ROLE, key = roleAggregateId(role).

export const ConfigurationsEvents = {
  ROLE_PERMISSIONS_UPDATED: 'role_permissions.updated',
} as const;

// configurations-service: rewrite the role's Redis cache · notification:
// action history + Socket.io push to the role's room (open clients update)
export interface RolePermissionsUpdatedPayload {
  role: string;
  permissions: string[]; // the role's full list after the change
  added: string[];
  removed: string[];
}

export interface ConfigurationsEventPayloads {
  [ConfigurationsEvents.ROLE_PERMISSIONS_UPDATED]: RolePermissionsUpdatedPayload;
}

// A role has no uuid, but aggregate ids (outbox, Kafka key, action_history
// entity_id) are uuids — a stable name-based one (RFC 4122 version 5 layout)
export function roleAggregateId(role: string): string {
  const hash = createHash('sha1').update(`medflow:role:${role}`).digest();
  hash[6] = (hash[6] & 0x0f) | 0x50;
  hash[8] = (hash[8] & 0x3f) | 0x80;
  const hex = hash.subarray(0, 16).toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
