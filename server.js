const http = require('http');
const fs = require('fs');
const path = require('path');
const { randomUUID, randomBytes } = require('crypto');

const sessions = new Map();

function generateSessionCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 5; i += 1) {
    const idx = Math.floor(Math.random() * alphabet.length);
    code += alphabet[idx];
  }
  if (sessions.has(code)) {
    return generateSessionCode();
  }
  return code;
}

function createSession() {
  const code = generateSessionCode();
  const hostSecret = randomUUID ? randomUUID() : randomBytes(16).toString('hex');
  const session = {
    code,
    hostSecret,
    players: new Map(),
    hostClients: new Set(),
    playerClients: new Map(),
    createdAt: Date.now(),
  };
  sessions.set(code, session);
  return session;
}

function getSession(code) {
  if (!code) return undefined;
  return sessions.get(code.toUpperCase());
}

function sendSSE(res, event, data) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

function broadcastHost(session) {
  const payload = {
    code: session.code,
    players: Array.from(session.players.values()).map((player) => ({
      id: player.id,
      name: player.name,
      role: player.role,
      alive: player.alive,
    })),
  };
  for (const res of session.hostClients) {
    sendSSE(res, 'session_update', payload);
  }
}

function broadcastPlayer(session, playerId) {
  const player = session.players.get(playerId);
  const clients = session.playerClients.get(playerId);
  if (!clients) return;
  const payload = player
    ? {
        id: player.id,
        name: player.name,
        role: player.role,
        alive: player.alive,
      }
    : { id: playerId, missing: true };
  for (const res of clients) {
    sendSSE(res, 'player_state', payload);
  }
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > 1e6) {
        req.socket.destroy();
        reject(new Error('Payload too large'));
      }
    });
    req.on('end', () => {
      if (!data) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(data));
      } catch (err) {
        reject(err);
      }
    });
  });
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function notFound(res) {
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not found' }));
}

function methodNotAllowed(res) {
  res.writeHead(405, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Method not allowed' }));
}

async function handleApi(req, res, parsedUrl) {
  const { pathname, searchParams } = parsedUrl;
  const segments = pathname.split('/').filter(Boolean);
  // segments[0] should be 'api'
  if (segments[1] === 'sessions' && segments.length === 2) {
    if (req.method === 'POST') {
      const session = createSession();
      sendJson(res, 201, { code: session.code, hostSecret: session.hostSecret });
      return;
    }
    methodNotAllowed(res);
    return;
  }

  if (segments[1] === 'sessions' && segments.length >= 3) {
    const code = segments[2];
    const session = getSession(code);
    if (!session) {
      notFound(res);
      return;
    }

    if (segments.length === 4 && segments[3] === 'join') {
      if (req.method !== 'POST') {
        methodNotAllowed(res);
        return;
      }
      try {
        const body = await parseBody(req);
        const name = (body.name || '').trim();
        if (!name) {
          sendJson(res, 400, { error: 'Name is required' });
          return;
        }
        const playerId = randomUUID ? randomUUID() : randomBytes(16).toString('hex');
        const player = {
          id: playerId,
          name,
          role: null,
          alive: true,
        };
        session.players.set(playerId, player);
        sendJson(res, 201, {
          code: session.code,
          playerId,
          name: player.name,
        });
        broadcastHost(session);
        broadcastPlayer(session, playerId);
      } catch (err) {
        sendJson(res, 400, { error: 'Invalid JSON body' });
      }
      return;
    }

    if (segments.length === 4 && segments[3] === 'roles') {
      if (req.method !== 'POST') {
        methodNotAllowed(res);
        return;
      }
      try {
        const body = await parseBody(req);
        if (body.hostSecret !== session.hostSecret) {
          sendJson(res, 403, { error: 'Invalid host secret' });
          return;
        }
        const assignments = body.assignments;
        if (!Array.isArray(assignments)) {
          sendJson(res, 400, { error: 'assignments must be an array' });
          return;
        }
        let updated = false;
        for (const item of assignments) {
          if (!item || typeof item.playerId !== 'string') continue;
          const player = session.players.get(item.playerId);
          if (!player) continue;
          player.role = typeof item.role === 'string' && item.role.trim() ? item.role.trim() : null;
          updated = true;
          broadcastPlayer(session, player.id);
        }
        if (updated) {
          broadcastHost(session);
        }
        sendJson(res, 200, { ok: true });
      } catch (err) {
        sendJson(res, 400, { error: 'Invalid JSON body' });
      }
      return;
    }

    if (segments.length === 5 && segments[3] === 'players' && segments[4]) {
      const playerId = segments[4];
      if (req.method === 'POST') {
        try {
          const body = await parseBody(req);
          if (body.hostSecret !== session.hostSecret) {
            sendJson(res, 403, { error: 'Invalid host secret' });
            return;
          }
          if (typeof body.alive !== 'boolean') {
            sendJson(res, 400, { error: 'alive flag is required' });
            return;
          }
          const player = session.players.get(playerId);
          if (!player) {
            notFound(res);
            return;
          }
          player.alive = body.alive;
          broadcastHost(session);
          broadcastPlayer(session, player.id);
          sendJson(res, 200, { ok: true });
        } catch (err) {
          sendJson(res, 400, { error: 'Invalid JSON body' });
        }
        return;
      }
      methodNotAllowed(res);
      return;
    }

    if (segments.length === 4 && segments[3] === 'stream') {
      if (req.method !== 'GET') {
        methodNotAllowed(res);
        return;
      }
      const playerId = searchParams.get('playerId');
      if (!playerId) {
        sendJson(res, 400, { error: 'playerId is required' });
        return;
      }
      const player = session.players.get(playerId);
      if (!player) {
        sendJson(res, 404, { error: 'Player not found' });
        return;
      }
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      });
      res.write('\n');
      let clients = session.playerClients.get(playerId);
      if (!clients) {
        clients = new Set();
        session.playerClients.set(playerId, clients);
      }
      clients.add(res);
      req.on('close', () => {
        clients.delete(res);
        if (clients.size === 0) {
          session.playerClients.delete(playerId);
        }
      });
      broadcastPlayer(session, playerId);
      return;
    }

    if (segments.length === 4 && segments[3] === 'host-stream') {
      if (req.method !== 'GET') {
        methodNotAllowed(res);
        return;
      }
      const hostSecret = searchParams.get('hostSecret');
      if (hostSecret !== session.hostSecret) {
        sendJson(res, 403, { error: 'Invalid host secret' });
        return;
      }
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      });
      res.write('\n');
      session.hostClients.add(res);
      req.on('close', () => {
        session.hostClients.delete(res);
      });
      broadcastHost(session);
      return;
    }
  }

  notFound(res);
}

const server = http.createServer((req, res) => {
  const parsedUrl = new URL(req.url, `http://${req.headers.host}`);
  if (parsedUrl.pathname.startsWith('/api/')) {
    handleApi(req, res, parsedUrl);
    return;
  }

  if (req.method === 'GET' || req.method === 'HEAD') {
    const publicDir = path.join(__dirname, 'public');
    const requestedPath = decodeURIComponent(parsedUrl.pathname === '/' ? '/index.html' : parsedUrl.pathname);
    let filePath = path.join(publicDir, requestedPath);

    if (!filePath.startsWith(publicDir)) {
      notFound(res);
      return;
    }

    fs.stat(filePath, (statErr, stats) => {
      if (statErr) {
        notFound(res);
        return;
      }

      if (stats.isDirectory()) {
        filePath = path.join(filePath, 'index.html');
      }

      fs.readFile(filePath, (readErr, data) => {
        if (readErr) {
          notFound(res);
          return;
        }
        const ext = path.extname(filePath);
        const contentType = {
          '.html': 'text/html',
          '.css': 'text/css',
          '.js': 'application/javascript',
          '.json': 'application/json',
        }[ext] || 'application/octet-stream';
        res.writeHead(200, { 'Content-Type': contentType });
        if (req.method === 'HEAD') {
          res.end();
        } else {
          res.end(data);
        }
      });
    });
    return;
  }

  methodNotAllowed(res);
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});
