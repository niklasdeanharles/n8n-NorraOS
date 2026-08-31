import { createServer } from 'node:http';

/**
 * Stands in for an n8n webhook. Records what it was sent.
 *
 * `reply` may be a value or a function of `(callNumber, body)`. Return an
 * object for a JSON answer, a string for a plain-text one (which is what a
 * streaming agent-turn actually sends back), or null to never respond.
 * Returning from the function is also the hook a scenario uses to act like the
 * workflow does — writing a `tool_calls_log` row, say — before answering.
 */
export function start(port, reply) {
  const seen = [];
  // The "never responds" case leaves a socket open, and `server.close()` waits
  // for it — which held the port and made the next scenario time out too.
  const sockets = new Set();
  const server = createServer(async (req, res) => {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    seen.push({ path: req.url, secret: req.headers['x-norra-secret'], body: JSON.parse(raw || '{}') });
    // A throwing reply stands for a workflow that fails, which is a 500 on the
    // wire. Letting it escape would take the whole scenario process down
    // instead — the harness would look broken where the app is not.
    let answer;
    try {
      answer = typeof reply === 'function' ? await reply(seen.length, seen[seen.length - 1].body) : reply;
    } catch (error) {
      res.writeHead(500, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ message: error instanceof Error ? error.message : 'workflow failed' }));
    }
    if (answer === null) {
      // Never respond: exercises the timeout path.
      return;
    }
    if (typeof answer === 'string') {
      res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
      return res.end(answer);
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
