import { NotificationTemplates } from './notification-template';

// auth.events — DOC 5.6: only user.session_revoked notifies in-app (the
// other auth reactions are emails, phase 4.3)
export const authNotifications: NotificationTemplates = {
  'user.session_revoked': (event) => [
    {
      recipientId: event.payload.userId,
      type: 'SESSION_REVOKED',
      title: 'You were signed out everywhere',
      message:
        'An old sign-in token of your account was used again, so all sessions were closed. If this was not you, change your password.',
      entityType: 'USER',
      entityId: event.payload.userId,
      link: '/profile',
      isUrgent: true,
    },
  ],
};
