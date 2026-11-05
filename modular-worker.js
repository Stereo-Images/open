/* One coordinator per named room and origin. No window owns the ensemble. */
"use strict";
importScripts("modular-core.js?v=modular-1");
const { Ensemble, clock } = OpenModular;
const clients = new Map();
let ensemble = null, nextId = 0, lastState = 0;
const newSeed = () => crypto.getRandomValues(new Uint32Array(1))[0];
function send(client, data) {
  try { client.port.postMessage(data); } catch { disconnect(client, clock()); }
}
function broadcast(data) { for (const client of clients.values()) send(client, data); }
function state() {
  return { type: "state", ...(ensemble?.state() || { members: [], tone: null, seed: null }),
    notes: ensemble?.events.filter(e => e.at <= clock()).length || 0 };
}
function disconnect(client, now) {
  ensemble?.leave(client.id, now);
  clients.delete(client.id);
  client.port.close();
}
self.onconnect = ({ ports: [port] }) => {
  const client = { id: `w${++nextId}`, port, seen: clock() };
  clients.set(client.id, client);
  port.onmessage = ({ data }) => {
    if (!data || typeof data.type !== "string") return;
    const now = clock();
    client.seen = now;
    try {
      switch (data.type) {
        case "join": {
          if (!["short", "long", "infinite"].includes(data.length)) throw Error("Choose a valid length.");
          if (!ensemble || !ensemble.members.size) ensemble = new Ensemble({ seed: newSeed(), tone: data.tone, now });
          ensemble.join(client.id, { seed: newSeed(), length: data.length, now });
          send(client, { type: "joined", id: client.id, ...ensemble.state() });
          broadcast(state());
          break;
        }
        case "leave":
          ensemble?.leave(client.id, now);
          send(client, { type: "left", reason: "Stopped" });
          broadcast(state());
          break;
        case "disconnect": disconnect(client, now); broadcast(state()); break;
        case "ping": send(client, { type: "pong" }); break;
        case "score": send(client, { type: "score", request: data.request, score: ensemble?.snapshot(now) || null }); break;
      }
    } catch (error) { send(client, { type: "error", message: error.message }); }
  };
  port.onmessageerror = () => disconnect(client, clock());
  port.start();
  send(client, { type: "ready", id: client.id });
  send(client, state());
};
setInterval(() => {
  const now = clock();
  for (const client of clients.values()) {
    if (ensemble?.members.has(client.id) && now - client.seen > 8) {
      ensemble.leave(client.id, now);
      send(client, { type: "left", reason: "Connection paused. Press Play to rejoin." });
    }
    if (now - client.seen > 90) disconnect(client, now);
  }
  if (ensemble) {
    const { events, ended } = ensemble.plan(now);
    for (const event of events) broadcast({ type: "event", event });
    for (const id of ended) {
      const client = clients.get(id);
      if (client) send(client, { type: "left", reason: "Finished" });
    }
  }
  if (now - lastState >= 1) { lastState = now; broadcast(state()); }
}, 100);
