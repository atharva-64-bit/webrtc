const express = require('express');
const http = require('http');
const WebSocket = require('ws');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(express.static('public'));

// rooms = { roomId: { password, clients: Map(clientId -> ws) } }
const rooms = {};

function send(ws, obj) {
  try { ws.send(JSON.stringify(obj)); } catch (e) {}
}

wss.on('connection', (ws) => {
  ws.id = null;
  ws.room = null;

  ws.on('message', (msg) => {
    let data;
    try { data = JSON.parse(msg); } catch { return; }

    const { type } = data;

    if (type === 'create') {
      const { roomId, password, clientId } = data;
      if (!roomId || !password) return send(ws, { type: 'error', message: 'Missing room or password' });
      if (rooms[roomId]) return send(ws, { type: 'error', message: 'Room already exists' });

      rooms[roomId] = { password, clients: new Map() };
      ws.id = clientId; ws.room = roomId;
      rooms[roomId].clients.set(clientId, ws);
      send(ws, { type: 'created', roomId });
    }

    else if (type === 'join') {
      const { roomId, password, clientId } = data;
      const room = rooms[roomId];
      if (!room) return send(ws, { type: 'error', message: 'Room not found' });
      if (room.password !== password) return send(ws, { type: 'error', message: 'Wrong password' });

      ws.id = clientId; ws.room = roomId;
      for (const [otherId, otherWs] of room.clients.entries()) {
        send(otherWs, { type: 'peer-joined', clientId });
        send(ws, { type: 'peer-joined', clientId: otherId });
      }
      room.clients.set(clientId, ws);
      send(ws, { type: 'joined', roomId });
    }

    else if (type === 'signal') {
      const { roomId, target, payload, from } = data;
      const room = rooms[roomId];
      if (!room) return;
      const targetWs = room.clients.get(target);
      if (targetWs) send(targetWs, { type: 'signal', from, payload });
    }

    else if (type === 'leave') {
      const { roomId, clientId } = data;
      const room = rooms[roomId];
      if (!room) return;
      room.clients.delete(clientId);
      for (const [, otherWs] of room.clients.entries()) {
        send(otherWs, { type: 'peer-left', clientId });
      }
      if (room.clients.size === 0) delete rooms[roomId];
    }
  });

  ws.on('close', () => {
    const { room, id } = ws;
    if (!room || !id) return;
    const r = rooms[room];
    if (!r) return;
    r.clients.delete(id);
    for (const [, otherWs] of r.clients.entries()) {
      send(otherWs, { type: 'peer-left', clientId: id });
    }
    if (r.clients.size === 0) delete rooms[room];
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
