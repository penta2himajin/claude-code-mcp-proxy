import { createServer } from 'node:http';
import { TmuxManager } from './tmux-manager.mjs';

const tmux = new TmuxManager();
const API_KEY = process.env.API_KEY;

if (!API_KEY) {
  console.error('API_KEY environment variable is required');
  process.exit(1);
}

/** Parse JSON body from request */
function parseBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => { data += chunk; });
    req.on('end', () => {
      try { resolve(data ? JSON.parse(data) : {}); }
      catch { reject(new Error('Invalid JSON')); }
    });
    req.on('error', reject);
  });
}

/** Send JSON response */
function json(res, data, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

/** Parse query string */
function parseQuery(url) {
  const q = {};
  const idx = url.indexOf('?');
  if (idx >= 0) {
    for (const pair of url.slice(idx + 1).split('&')) {
      const [k, v] = pair.split('=');
      q[decodeURIComponent(k)] = decodeURIComponent(v || '');
    }
  }
  return q;
}

const server = createServer(async (req, res) => {
  // Auth check
  const auth = req.headers.authorization;
  if (auth !== `Bearer ${API_KEY}`) {
    return json(res, { error: 'Unauthorized' }, 401);
  }

  const path = req.url.split('?')[0];

  try {
    // GET /status - health + session status
    if (req.method === 'GET' && path === '/status') {
      const status = await tmux.getStatus();
      return json(res, { ok: true, ...status });
    }

    // POST /session/start - start Claude in tmux
    if (req.method === 'POST' && path === '/session/start') {
      const body = await parseBody(req);
      const result = await tmux.startClaude({
        prompt: body.prompt,
        workdir: body.workdir,
      });
      return json(res, result);
    }

    // POST /session/stop - kill tmux session
    if (req.method === 'POST' && path === '/session/stop') {
      const result = await tmux.stopClaude();
      return json(res, result);
    }

    // POST /session/send - send keys to tmux
    if (req.method === 'POST' && path === '/session/send') {
      const body = await parseBody(req);
      if (!body.text) {
        return json(res, { error: 'text is required' }, 400);
      }
      const result = await tmux.sendKeys(body.text, body.enter ?? true);
      return json(res, result);
    }

    // GET /session/output - capture tmux pane
    if (req.method === 'GET' && path === '/session/output') {
      const query = parseQuery(req.url);
      const lines = parseInt(query.lines) || 100;
      const output = await tmux.capturePane(lines);
      return json(res, { output });
    }

    json(res, { error: 'Not Found' }, 404);
  } catch (e) {
    console.error('Request error:', e);
    json(res, { error: e.message }, 500);
  }
});

const PORT = process.env.PORT || 8080;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
