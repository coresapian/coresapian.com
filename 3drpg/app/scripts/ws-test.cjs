
const WebSocket = require('ws');

const URL = process.argv[2] || 'wss://dwftf.com/ws';
const PROTO = 1;

function makeClient(playerId, name) {
  const ws = new WebSocket(URL);
  const received = { welcome: null, snapshots: [], errors: [] };
  ws.on('open', () => {
    ws.send(JSON.stringify({ t: 'hello', protocolVersion: PROTO, playerId, name }));
  });
  ws.on('message', (data) => {
    let msg;
    try { msg = JSON.parse(data.toString()); } catch { return; }
    if (msg.t === 'welcome') received.welcome = msg;
    else if (msg.t === 'snapshot') received.snapshots.push(msg);
    else if (msg.t === 'error') received.errors.push(msg);
  });
  ws.on('error', (e) => received.errors.push({ wsError: e.message }));
  ws.on('close', () => received.closed = true);
  // Helper to send input
  ws.sendInput = (pos) => {
    ws.send(JSON.stringify({
      t: 'input',
      seq: 1,
      buttons: 0,
      yaw: 0,
      pitch: 0,
      moveX: 0,
      moveY: 0,
      jump: false,
      position: pos,
      realm: 'midgard',
      anim: 1,
    }));
  };
  return { ws, received };
}

(async () => {
  const p1 = makeClient('aaaa1111-1111-1111-1111-111111111111', 'AlphaTest');
  const p2 = makeClient('bbbb2222-2222-2222-2222-222222222222', 'BravoTest');

  // wait for both to connect + welcome
  await new Promise(r => setTimeout(r, 3000));
  console.log('P1 welcome:', JSON.stringify(p1.received.welcome)?.slice(0, 300));
  console.log('P2 welcome:', JSON.stringify(p2.received.welcome)?.slice(0, 300));
  console.log('P1 errors:', JSON.stringify(p1.received.errors)?.slice(0, 300));
  console.log('P2 errors:', JSON.stringify(p2.received.errors)?.slice(0, 300));

  // both send an input so the server sees them in the world
  if (p1.received.welcome) p1.ws.sendInput([10, 0, -5]);
  if (p2.received.welcome) p2.ws.sendInput([11, 0, -5]);

  // wait for a few snapshots (10Hz = 100ms each, wait 2s = ~20)
  await new Promise(r => setTimeout(r, 2500));

  // count snapshots that include the other player
  let p1SeesP2 = 0, p2SeesP1 = 0;
  const p1Id = 'aaaa1111-1111-1111-1111-111111111111';
  const p2Id = 'bbbb2222-2222-2222-2222-222222222222';
  for (const snap of p1.received.snapshots) {
    if (Array.isArray(snap.players) && snap.players.some(p => p.id === p2Id)) p1SeesP2++;
  }
  for (const snap of p2.received.snapshots) {
    if (Array.isArray(snap.players) && snap.players.some(p => p.id === p1Id)) p2SeesP1++;
  }

  console.log('P1 snapshots received:', p1.received.snapshots.length);
  console.log('P2 snapshots received:', p2.received.snapshots.length);
  console.log('P1 sees P2 in snapshots:', p1SeesP2);
  console.log('P2 sees P1 in snapshots:', p2SeesP1);

  // sample one snapshot to see its shape
  if (p1.received.snapshots.length > 0) {
    console.log('sample snapshot keys:', Object.keys(p1.received.snapshots[0]));
    console.log('sample snapshot.players:', JSON.stringify(p1.received.snapshots[0].players)?.slice(0, 400));
  }

  p1.ws.close();
  p2.ws.close();
  await new Promise(r => setTimeout(r, 500));

  const ok = p1.received.welcome && p2.received.welcome && p1SeesP2 > 0 && p2SeesP1 > 0;
  console.log(ok ? 'PASS: multiplayer verified' : 'FAIL: cross-visibility not established');
  process.exit(ok ? 0 : 1);
})();
