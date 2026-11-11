// Hosting check for Hetzner Webhosting L.
// No dependencies. Answers the open questions in CONCEPT.md section 7:
// does Node.js run on the subdomain, is HTTPS in place, what are the memory
// limits, does the process stay alive, and do WebSockets get through.

const http = require('node:http');
const crypto = require('node:crypto');
const v8 = require('node:v8');
const os = require('node:os');

const startedAt = Date.now();
let requestCount = 0;

const mb = (n) => Math.round(n / 1024 / 1024) + ' MB';

function report(req) {
  const mem = process.memoryUsage();
  return {
    node: process.version,
    platform: `${process.platform} ${process.arch}`,
    pid: process.pid,
    startedAt: new Date(startedAt).toISOString(),
    uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
    requestsServed: requestCount,
    memory: {
      rss: mb(mem.rss),
      heapUsed: mb(mem.heapUsed),
      heapLimit: mb(v8.getHeapStatistics().heap_size_limit),
      machineTotal: mb(os.totalmem()),
    },
    cpus: os.cpus().length,
    listening: server.address(),
    // Names only, never values: values may be secrets.
    envNames: Object.keys(process.env).sort(),
    portEnv: process.env.PORT || null,
    request: {
      host: req.headers.host || null,
      forwardedProto: req.headers['x-forwarded-proto'] || null,
      forwardedFor: req.headers['x-forwarded-for'] ? 'present' : null,
      via: req.headers.via || null,
      httpVersion: req.httpVersion,
    },
  };
}

const page = `<!doctype html>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Hosting check</title>
<style>
  body { font: 15px/1.5 system-ui, sans-serif; max-width: 720px; margin: 2rem auto; padding: 0 16px; }
  td { padding: 4px 12px 4px 0; vertical-align: top; }
  .ok { color: #0a7d32; } .bad { color: #b42318; }
  pre { background: #f4f4f4; padding: 12px; overflow: auto; font-size: 13px; }
  @media (prefers-color-scheme: dark) { body { background: #111; color: #eee; } pre { background: #222; } }
</style>
<h1>Hosting check</h1>
<table id="t"></table>
<h2>Server report</h2>
<pre id="r">loading…</pre>
<script>
const t = document.getElementById('t');
function row(name, ok, detail) {
  const tr = t.insertRow();
  tr.insertCell().textContent = name;
  const c = tr.insertCell();
  c.textContent = (ok === null ? '…' : ok ? 'OK' : 'FAIL') + (detail ? ' — ' + detail : '');
  c.className = ok === null ? '' : ok ? 'ok' : 'bad';
  return c;
}
function set(c, ok, detail) { c.textContent = (ok ? 'OK' : 'FAIL') + ' — ' + detail; c.className = ok ? 'ok' : 'bad'; }

row('Node.js app reachable', true, 'this page was served by it');
row('HTTPS', location.protocol === 'https:', location.protocol);

(async () => {
  const r = await (await fetch('report')).json();
  document.getElementById('r').textContent = JSON.stringify(r, null, 2);

  // Clock sync feasibility: round-trip time of small requests.
  const c = row('Request round trip', null);
  const times = [];
  let offset = 0;
  for (let i = 0; i < 10; i++) {
    const a = performance.now(), sent = Date.now();
    const s = await (await fetch('time', { cache: 'no-store' })).json();
    const rtt = performance.now() - a;
    times.push(rtt);
    if (rtt <= Math.min(...times)) offset = s.now - (sent + rtt / 2);
  }
  times.sort((x, y) => x - y);
  set(c, true, 'best ' + times[0].toFixed(0) + ' ms, median ' + times[5].toFixed(0) +
    ' ms, clock offset ' + offset.toFixed(0) + ' ms');
})();

(() => {
  const c = row('WebSocket', null);
  let done = false;
  const finish = (ok, d) => { if (!done) { done = true; set(c, ok, d); } };
  try {
    const ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host +
      location.pathname.replace(/[^/]*$/, '') + 'ws');
    ws.onopen = () => ws.send('ping');
    ws.onmessage = (e) => { finish(e.data === 'echo:ping', 'connected and echoed'); ws.close(); };
    ws.onerror = () => finish(false, 'connection refused or blocked by the proxy');
    ws.onclose = () => finish(false, 'closed before echo');
    setTimeout(() => finish(false, 'no answer in 8 s'), 8000);
  } catch (e) { finish(false, String(e)); }
})();
</script>`;

const server = http.createServer((req, res) => {
  requestCount++;
  const path = new URL(req.url, 'http://x').pathname;
  if (path.endsWith('/report')) {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(report(req)));
  } else if (path.endsWith('/time')) {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({ now: Date.now() }));
  } else {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(page);
  }
});

// Minimal WebSocket echo (RFC 6455), short text frames only. Enough to learn
// whether the hosting proxy lets an upgrade through.
server.on('upgrade', (req, socket) => {
  const key = req.headers['sec-websocket-key'];
  if (!key) return socket.destroy();
  const accept = crypto.createHash('sha1')
    .update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n' +
    `Sec-WebSocket-Accept: ${accept}\r\n\r\n`);
  socket.on('data', (buf) => {
    const opcode = buf[0] & 0x0f;
    const len = buf[1] & 0x7f;
    if (opcode !== 1 || len > 125 || !(buf[1] & 0x80) || buf.length < 6 + len) return socket.end();
    const mask = buf.subarray(2, 6);
    const text = Buffer.from(buf.subarray(6, 6 + len).map((b, i) => b ^ mask[i % 4])).toString();
    const out = Buffer.from('echo:' + text);
    socket.write(Buffer.concat([Buffer.from([0x81, out.length]), out]));
  });
  socket.on('error', () => {});
});

// Hetzner's own example calls listen() with no port, so do the same unless a
// PORT variable is provided (local testing, or if the host sets one).
const onListen = () => console.log('Application is running...', JSON.stringify(server.address()));
if (process.env.PORT) server.listen(Number(process.env.PORT), onListen);
else server.listen(onListen);
