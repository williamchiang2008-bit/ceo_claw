const http = require('http');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const PORT = process.env.PORT || 3789;
const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
const DATA_DIR = path.join(ROOT, 'data');
const TASKS_FILE = path.join(DATA_DIR, 'tasks.json');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(TASKS_FILE)) {
  fs.writeFileSync(TASKS_FILE, JSON.stringify({ currentTask: {}, logs: [] }, null, 2));
}

function runOpenClaw(args) {
  return new Promise((resolve, reject) => {
    execFile('openclaw', args, { maxBuffer: 5 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) return reject(new Error(stderr || err.message));
      resolve(stdout);
    });
  });
}

function readTasks() {
  try {
    return JSON.parse(fs.readFileSync(TASKS_FILE, 'utf8'));
  } catch {
    return { currentTask: {}, logs: [] };
  }
}

function writeTasks(data) {
  fs.writeFileSync(TASKS_FILE, JSON.stringify(data, null, 2));
}

function json(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

function aggregateAgents(agents, sessions, tasks) {
  const byAgent = new Map();
  for (const s of sessions) {
    if (!byAgent.has(s.agentId)) byAgent.set(s.agentId, []);
    byAgent.get(s.agentId).push(s);
  }

  return agents.map((a) => {
    const ownSessions = (byAgent.get(a.id) || []).sort((x, y) => y.updatedAt - x.updatedAt);
    const latest = ownSessions[0] || null;
    const totalTokens = ownSessions.reduce((n, s) => n + (s.totalTokens || 0), 0);
    const active = latest ? latest.ageMs < 15 * 60 * 1000 : false;

    return {
      id: a.id,
      name: a.identityName || a.name || a.id,
      emoji: a.identityEmoji || '🤖',
      model: latest?.model ? `${latest.modelProvider}/${latest.model}` : a.model,
      active,
      latestSessionKey: latest?.key || null,
      latestUpdatedAt: latest?.updatedAt || null,
      latestAgeMs: latest?.ageMs || null,
      latestTokens: latest?.totalTokens || 0,
      totalTokens,
      currentTask: tasks.currentTask[a.id] || '',
      sessionsCount: ownSessions.length,
    };
  });
}

async function getOverview() {
  const [agentsRaw, sessionsRaw] = await Promise.all([
    runOpenClaw(['agents', 'list', '--json']),
    runOpenClaw(['sessions', '--all-agents', '--json']),
  ]);

  const agents = JSON.parse(agentsRaw);
  const sessionsPayload = JSON.parse(sessionsRaw);
  const sessions = sessionsPayload.sessions || [];
  const tasks = readTasks();

  return {
    updatedAt: Date.now(),
    agents: aggregateAgents(agents, sessions, tasks),
    taskLogs: (tasks.logs || []).slice(-50).reverse(),
  };
}

function serveStatic(req, res) {
  const reqPath = req.url === '/' ? '/index.html' : req.url;
  const filePath = path.join(PUBLIC_DIR, reqPath);
  if (!filePath.startsWith(PUBLIC_DIR)) return json(res, 403, { error: 'forbidden' });
  if (!fs.existsSync(filePath)) return json(res, 404, { error: 'not found' });
  const ext = path.extname(filePath);
  const typeMap = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
  };
  res.writeHead(200, { 'Content-Type': typeMap[ext] || 'text/plain; charset=utf-8' });
  fs.createReadStream(filePath).pipe(res);
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === 'GET' && req.url === '/api/overview') {
      const data = await getOverview();
      return json(res, 200, data);
    }

    if (req.method === 'POST' && req.url === '/api/task') {
      const body = await parseBody(req);
      const { agentId, task } = body;
      if (!agentId) return json(res, 400, { error: 'agentId required' });
      const tasks = readTasks();
      tasks.currentTask[agentId] = task || '';
      tasks.logs.push({ id: `${Date.now()}`, agentId, task: task || '', at: Date.now(), type: 'task-set' });
      writeTasks(tasks);
      return json(res, 200, { ok: true });
    }

    if (req.method === 'POST' && req.url === '/api/chat') {
      const body = await parseBody(req);
      const { agentId, message } = body;
      if (!agentId || !message) return json(res, 400, { error: 'agentId and message required' });

      const tasks = readTasks();
      tasks.currentTask[agentId] = message;
      tasks.logs.push({ id: `${Date.now()}`, agentId, task: message, at: Date.now(), type: 'chat-send' });
      writeTasks(tasks);

      const output = await runOpenClaw(['agent', '--agent', agentId, '--message', message, '--json', '--timeout', '180']);
      const payload = JSON.parse(output);
      const reply = payload?.result?.payloads?.map((p) => p.text).filter(Boolean).join('\n') || '';

      tasks.logs.push({ id: `${Date.now()}-reply`, agentId, task: reply, at: Date.now(), type: 'chat-reply' });
      writeTasks(tasks);

      return json(res, 200, {
        ok: true,
        reply,
        usage: payload?.result?.meta?.agentMeta?.lastCallUsage || null,
      });
    }

    if (req.method === 'POST' && req.url === '/api/broadcast') {
      const body = await parseBody(req);
      const { message, agentIds } = body;
      if (!message) return json(res, 400, { error: 'message required' });

      const overview = await getOverview();
      const targets = Array.isArray(agentIds) && agentIds.length
        ? overview.agents.filter((a) => agentIds.includes(a.id)).map((a) => a.id)
        : overview.agents.map((a) => a.id);

      const tasks = readTasks();
      const replies = [];

      for (const agentId of targets) {
        tasks.currentTask[agentId] = message;
        tasks.logs.push({ id: `${Date.now()}-${agentId}`, agentId, task: message, at: Date.now(), type: 'broadcast-send' });
        writeTasks(tasks);

        const output = await runOpenClaw(['agent', '--agent', agentId, '--message', message, '--json', '--timeout', '180']);
        const payload = JSON.parse(output);
        const reply = payload?.result?.payloads?.map((p) => p.text).filter(Boolean).join('\n') || '';
        replies.push({ agentId, reply, usage: payload?.result?.meta?.agentMeta?.lastCallUsage || null });

        tasks.logs.push({ id: `${Date.now()}-${agentId}-reply`, agentId, task: reply, at: Date.now(), type: 'broadcast-reply' });
        writeTasks(tasks);
      }

      return json(res, 200, { ok: true, replies });
    }

    return serveStatic(req, res);
  } catch (e) {
    return json(res, 500, { error: e.message || 'server error' });
  }
});

server.listen(PORT, () => {
  console.log(`tri-agent-dashboard running: http://127.0.0.1:${PORT}`);
});
