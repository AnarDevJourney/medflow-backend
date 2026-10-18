// Test helper for scripts/test-notifications.sh: connects to Socket.io via
// the gateway with an access token and prints every event as one JSON line.
// Usage: node scripts/lib/socket-listen.mjs <baseUrl> <accessToken|-> <seconds>
import { io } from 'socket.io-client';

const [url, token, seconds = '10'] = process.argv.slice(2);
const print = (name, data = null) =>
  console.log(JSON.stringify({ t: Date.now(), name, data }));

const socket = io(url, {
  transports: ['websocket'],
  reconnection: false,
  extraHeaders: token && token !== '-' ? { cookie: `access_token=${token}` } : {},
});

const finish = () => {
  socket.close();
  setTimeout(() => process.exit(0), 50);
};

socket.on('connect', () => print('connect'));
socket.on('connect_error', (err) => {
  print('connect_error', { message: err.message, code: err.data?.code ?? null });
  finish();
});
for (const name of ['notification', 'notification:count', 'session:expired', 'session:revoked']) {
  socket.on(name, (data) => print(name, data ?? null));
}
socket.on('disconnect', (reason) => {
  print('disconnect', { reason });
  finish();
});
setTimeout(finish, Number(seconds) * 1000);
