# 系统架构

dsh-call-session 系统拓扑规范与离线交互式架构图。

## 概述

系统架构覆盖前端协作看板、插件生命周期与工具门面、单播调度分发、公共黑板状态存储及 DSH 宿主环境。图表源文件基于 Archify 规范构建，交付物为单文件自包含 HTML。

## 结构

- `dsh-call-session.architecture.json`：架构拓扑规范源文件。
- `dsh-call-session-architecture.html`：离线交互式架构图交付物。

## 验证

执行以下命令校验架构规范并重新生成交付物：

```bash
node /home/dev/.agents/skills/archify/bin/archify.mjs validate architecture docs/architecture/dsh-call-session.architecture.json --quality showcase --json
node /home/dev/.agents/skills/archify/bin/archify.mjs deliver architecture docs/architecture/dsh-call-session.architecture.json docs/architecture/dsh-call-session-architecture.html --quality showcase --json
```
