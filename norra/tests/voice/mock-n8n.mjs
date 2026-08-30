import { createServer } from 'node:http';

/** Stands in for the n8n voice-turn webhook. Records what it was sent. */
export function start(port, reply) {
  const seen = [];
  // The "never responds" case leaves a socket open, and `server.close()` waits
  // for it — which held the port and made the next scenario time out too.
  const sockets = new Set();
  const server = createServer(async (req, res) => {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    seen.push({ path: req.url, secret: req.headers['x-norra-secret'], body: JSON.parse(raw || '{}') });
    const answer = typeof reply === 'function' ? reply(seen.length) : reply;
    if (answer === null) {
      // Never respond: exercises the timeout path.
      return;
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify([answer]));
  });
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });

  const stop = () =>
    new Promise((resolve) => {
      for (const socket of sockets) socket.destroy();
      server.close(() => resolve());
    });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, () => resolve({ server, seen, stop }));
  });
}
