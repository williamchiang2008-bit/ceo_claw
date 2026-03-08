# 爸爸驾驶舱

一个本地网页，把三个 Agent 的核心状态放到同一页：

- Agent 基础信息（名字、emoji、模型）
- 活跃状态（最近会话是否在 15 分钟内）
- Token 使用（最近会话 Tk、累计 Tk）+ 累计Tk趋势图
- 当前任务（可手动更新）
- 页面内直接下发指令给任意 Agent，并拿到回复
- 技能中心标签页（共同可用技能 / 不可用技能 / 建议学习清单 / 操作指引）

## 启动

```bash
cd tri-agent-dashboard
node server.js
```

打开：<http://127.0.0.1:3789>

## 数据来源

- `openclaw agents list --json`
- `openclaw sessions --all-agents --json`
- `openclaw agent --agent <id> --message "..." --json`

## 说明

- 页面每 10 秒自动刷新一次；你也可以手动点“立即刷新状态/Tk”。
- 任务日志保存在 `tri-agent-dashboard/data/tasks.json`。
