# GitHub 备份信息（爸爸专用）

更新时间：2026-03-08

## 1) 主工作仓库
- 本地路径：`/Users/ceo_claw/.openclaw/workspace`
- GitHub：`https://github.com/williamchiang2008-bit/ceo_claw`
- 远程名：`origin`
- 分支：`main`

## 2) 日程管理 App 仓库
- 本地路径：`/Users/ceo_claw/Projects/schedule-app`
- GitHub：`https://github.com/williamchiang2008-bit/ceo-schedule-app`
- 远程名：`origin`
- 分支：`main`

## 3) 一键备份脚本
- 脚本路径：`/Users/ceo_claw/.openclaw/workspace/scripts/backup-all.sh`
- 用法：
  ```bash
  /Users/ceo_claw/.openclaw/workspace/scripts/backup-all.sh
  ```

说明：
- 脚本会依次推送以上两个仓库
- 若仓库有未提交改动，会跳过该仓库（避免脏提交）
- 建议先 `git commit` 再执行脚本

## 4) 安全提醒
- 之前在聊天里暴露过 GitHub Token，建议尽快在 GitHub 中 Revoke 并重建。
- Token 设置建议：最小权限、30天过期。
