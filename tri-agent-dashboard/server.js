const http = require('http');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const PORT = process.env.PORT || 3789;
const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
const DATA_DIR = path.join(ROOT, 'data');
const TASKS_FILE = path.join(DATA_DIR, 'tasks.json');
const TOKEN_HISTORY_FILE = path.join(DATA_DIR, 'token-history.json');
const SKILL_PLAN_FILE = path.join(DATA_DIR, 'skill-plan.json');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(TASKS_FILE)) fs.writeFileSync(TASKS_FILE, JSON.stringify({ currentTask: {}, logs: [] }, null, 2));
if (!fs.existsSync(TOKEN_HISTORY_FILE)) fs.writeFileSync(TOKEN_HISTORY_FILE, JSON.stringify({ points: [] }, null, 2));
if (!fs.existsSync(SKILL_PLAN_FILE)) {
  fs.writeFileSync(SKILL_PLAN_FILE, JSON.stringify({
    wishSkills: [
      { name: 'github', reason: '代码协作与PR流转' },
      { name: 'himalaya', reason: '邮件自动化' },
      { name: 'notion', reason: '知识库协同' },
      { name: 'tmux', reason: '并行任务自动化' },
      { name: 'model-usage', reason: '更精细的模型成本看板' }
    ]
  }, null, 2));
}

function runOpenClaw(args) {
  return new Promise((resolve, reject) => {
    execFile('openclaw', args, { maxBuffer: 8 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) return reject(new Error(stderr || err.message));
      resolve(stdout);
    });
  });
}

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

function writeJson(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
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
      try { resolve(JSON.parse(raw)); } catch (e) { reject(e); }
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

function appendTokenPoint(agents) {
  const history = readJson(TOKEN_HISTORY_FILE, { points: [] });
  history.points.push({ at: Date.now(), agents: agents.map((a) => ({ id: a.id, totalTokens: a.totalTokens, latestTokens: a.latestTokens })) });
  if (history.points.length > 300) history.points = history.points.slice(-300);
  writeJson(TOKEN_HISTORY_FILE, history);
}

async function getOverview() {
  const [agentsRaw, sessionsRaw] = await Promise.all([
    runOpenClaw(['agents', 'list', '--json']),
    runOpenClaw(['sessions', '--all-agents', '--json']),
  ]);

  const agents = JSON.parse(agentsRaw);
  const sessions = JSON.parse(sessionsRaw).sessions || [];
  const tasks = readJson(TASKS_FILE, { currentTask: {}, logs: [] });
  const aggr = aggregateAgents(agents, sessions, tasks);
  appendTokenPoint(aggr);

  return {
    updatedAt: Date.now(),
    agents: aggr,
    taskLogs: (tasks.logs || []).slice(-80).reverse(),
  };
}

async function getSkillsData() {
  const [agentsRaw, skillsRaw] = await Promise.all([
    runOpenClaw(['agents', 'list', '--json']),
    runOpenClaw(['skills', 'list', '--json'])
  ]);

  const agents = JSON.parse(agentsRaw);
  const skillPayload = JSON.parse(skillsRaw);
  const skills = skillPayload.skills || [];
  const eligible = skills.filter((s) => s.eligible);
  const blocked = skills.filter((s) => !s.eligible);
  const wish = readJson(SKILL_PLAN_FILE, { wishSkills: [] }).wishSkills || [];

  return {
    updatedAt: Date.now(),
    summary: {
      total: skills.length,
      eligible: eligible.length,
      blocked: blocked.length,
      commonForAllThree: eligible.map((s) => s.name),
    },
    agents: agents.map((a) => ({ id: a.id, name: a.identityName || a.name || a.id, emoji: a.identityEmoji || '🤖' })),
    eligible,
    blocked: blocked.slice(0, 25),
    wishSkills: wish,
    playbook: [
      '看可用技能：openclaw skills list --eligible --json',
      '看某个技能详情：openclaw skills info <skill-name>',
      '缺依赖时，按 missing.bins / missing.env / missing.config 逐项补齐',
      '补齐后刷新本页面，或点“立即刷新状态/Tk”让Token和状态同步更新'
    ]
  };
}

function getTokenHistory() {
  return readJson(TOKEN_HISTORY_FILE, { points: [] });
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
    if (req.method === 'GET' && req.url === '/api/overview') return json(res, 200, await getOverview());
    if (req.method === 'GET' && req.url === '/api/token-history') return json(res, 200, getTokenHistory());
    if (req.method === 'GET' && req.url === '/api/skills') return json(res, 200, await getSkillsData());

    if (req.method === 'POST' && req.url === '/api/task') {
      const { agentId, task } = await parseBody(req);
      if (!agentId) return json(res, 400, { error: 'agentId required' });
      const tasks = readJson(TASKS_FILE, { currentTask: {}, logs: [] });
      tasks.currentTask[agentId] = task || '';
      tasks.logs.push({ id: `${Date.now()}`, agentId, task: task || '', at: Date.now(), type: 'task-set' });
      writeJson(TASKS_FILE, tasks);
      return json(res, 200, { ok: true });
    }

    if (req.method === 'POST' && req.url === '/api/chat') {
      const { agentId, message } = await parseBody(req);
      if (!agentId || !message) return json(res, 400, { error: 'agentId and message required' });

      const tasks = readJson(TASKS_FILE, { currentTask: {}, logs: [] });
      tasks.currentTask[agentId] = message;
      tasks.logs.push({ id: `${Date.now()}`, agentId, task: message, at: Date.now(), type: 'chat-send' });
      writeJson(TASKS_FILE, tasks);

      const output = await runOpenClaw(['agent', '--agent', agentId, '--message', message, '--json', '--timeout', '180']);
      const payload = JSON.parse(output);
      const reply = payload?.result?.payloads?.map((p) => p.text).filter(Boolean).join('\n') || '';

      tasks.logs.push({ id: `${Date.now()}-reply`, agentId, task: reply, at: Date.now(), type: 'chat-reply' });
      writeJson(TASKS_FILE, tasks);

      return json(res, 200, { ok: true, reply, usage: payload?.result?.meta?.agentMeta?.lastCallUsage || null });
    }

    if (req.method === 'POST' && req.url === '/api/broadcast') {
      const { message, agentIds } = await parseBody(req);
      if (!message) return json(res, 400, { error: 'message required' });

      const overview = await getOverview();
      const targets = Array.isArray(agentIds) && agentIds.length ? overview.agents.filter((a) => agentIds.includes(a.id)).map((a) => a.id) : overview.agents.map((a) => a.id);

      const tasks = readJson(TASKS_FILE, { currentTask: {}, logs: [] });
      const replies = [];

      for (const agentId of targets) {
        tasks.currentTask[agentId] = message;
        tasks.logs.push({ id: `${Date.now()}-${agentId}`, agentId, task: message, at: Date.now(), type: 'broadcast-send' });
        writeJson(TASKS_FILE, tasks);

        const output = await runOpenClaw(['agent', '--agent', agentId, '--message', message, '--json', '--timeout', '180']);
        const payload = JSON.parse(output);
        const reply = payload?.result?.payloads?.map((p) => p.text).filter(Boolean).join('\n') || '';
        replies.push({ agentId, reply, usage: payload?.result?.meta?.agentMeta?.lastCallUsage || null });

        tasks.logs.push({ id: `${Date.now()}-${agentId}-reply`, agentId, task: reply, at: Date.now(), type: 'broadcast-reply' });
        writeJson(TASKS_FILE, tasks);
      }

      return json(res, 200, { ok: true, replies });
    }

    return serveStatic(req, res);
  } catch (e) {
    return json(res, 500, { error: e.message || 'server error' });
  }
});

server.listen(PORT, () => {
  console.log(`爸爸驾驶舱运行中: http://127.0.0.1:${PORT}`);
});
