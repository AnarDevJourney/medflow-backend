// Route table of the gateway: which path prefixes (after /api/v1) belong to
// which service. /internal/* is never listed, so it can't be reached from outside.
export interface ServiceRoute {
  name: string;
  urlEnv: string;
  prefixes: string[];
}

export const SERVICES: readonly ServiceRoute[] = [
  {
    name: 'auth-service',
    urlEnv: 'AUTH_SERVICE_URL',
    prefixes: ['/auth', '/users'],
  },
  {
    name: 'staff-service',
    urlEnv: 'STAFF_SERVICE_URL',
    prefixes: ['/departments', '/staff', '/schedules', '/time-off'],
  },
  {
    name: 'patient-service',
    urlEnv: 'PATIENT_SERVICE_URL',
    prefixes: ['/patients'],
  },
  {
    name: 'appointment-service',
    urlEnv: 'APPOINTMENT_SERVICE_URL',
    prefixes: ['/appointments'],
  },
  {
    name: 'medical-record-service',
    urlEnv: 'RECORD_SERVICE_URL',
    prefixes: [
      '/encounters',
      '/lab-orders',
      '/icd10',
      '/lab-tests',
      '/records',
    ],
  },
  {
    name: 'billing-service',
    urlEnv: 'BILLING_SERVICE_URL',
    prefixes: ['/invoices', '/payments', '/service-catalog', '/billing'],
  },
  {
    name: 'file-service',
    urlEnv: 'FILE_SERVICE_URL',
    prefixes: ['/files'],
  },
  {
    name: 'notification-history-service',
    urlEnv: 'NOTIFICATION_SERVICE_URL',
    prefixes: ['/notifications', '/history'],
  },
  {
    name: 'configurations-service',
    urlEnv: 'CONFIGURATIONS_SERVICE_URL',
    prefixes: ['/configurations'],
  },
];

// Socket.io lives in notification-history-service; the gateway proxies the upgrade
export const SOCKET_IO_PATH = '/socket.io';
export const SOCKET_IO_SERVICE = 'notification-history-service';
