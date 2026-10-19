# Moonshot 校内服部署

校内服使用普通 HTTP 与独立 Node.js 服务，不依赖 Cloudflare Worker、Durable Object 或 R2。默认地址为 `http://172.10.17.186:8000/`，运行时数据都放在 `D:\moonshot-campus\`。

## 管理员一次性准备

请管理员完成：

1. 将服务器固定为 `172.10.17.186`，并确认客户端能访问该地址。
2. 在 Windows Defender 防火墙放行 TCP 8000，范围限制在校园网段。
3. 关闭睡眠/休眠，确保登录会话维持；服务使用“登录时”计划任务启动。
4. 如需 SSH 运维，启用 Windows OpenSSH Server（sshd）并限制来源网段。
5. 确认 D 盘有足够空间；C 盘不用于应用、Node、数据、日志或备份。

## 安装

以 `sshuser` 登录，不需要管理员权限。准备 `campus-release-<commit>.zip`。联网安装会下载 Node 22 Windows x64 便携 ZIP；离线时可提前把 `node-v22*-win-x64.zip` 放在安装脚本目录、`D:\moonshot-campus\` 或当前目录。

```powershell
Expand-Archive .\campus-release-<commit>.zip .\campus-release
Set-ExecutionPolicy -Scope Process Bypass
.\campus-release\deploy\campus\install.ps1 -ReleaseZip .\campus-release-<commit>.zip
```

默认端口 8000，允许的网页来源为 `172.10.17.186,localhost,127.0.0.1`。脚本会创建 `app`、`node`、`data`、`logs`、`backups`，注册登录启动服务任务和每日 03:30 备份任务。服务异常退出后，运行脚本在 5 秒后重启；计划任务也配置 1 分钟间隔、最多 999 次重启。

## 更新

把新发布 ZIP 拷到服务器，然后运行：

```powershell
 D:\moonshot-campus\app\deploy\campus\update.ps1 -ReleaseZip .\campus-release-<commit>.zip
```

更新前会备份 SQLite 数据及头像，更新后启动服务并检查 `/health`。

## 备份和恢复

每日任务会先停止写入服务，再复制 `campus.sqlite*`（含 WAL 文件）和 `avatars`，完成后恢复服务，只保留最近 14 份。手动备份：

```powershell
 D:\moonshot-campus\app\deploy\campus\backup.ps1
```

恢复前停止 `MoonshotCampusServer` 任务，再将备份中的 `campus.sqlite*` 和 `avatars` 复制回 `D:\moonshot-campus\data\`，之后重新启动任务。

## 查看日志与修改端口

- 日志：`D:\moonshot-campus\logs\server-YYYY-MM-DD.log`
- 计划任务：任务计划程序中的 `MoonshotCampusServer` 和 `MoonshotCampusDailyBackup`
- 修改 `D:\moonshot-campus\app\config.json` 中的 `PORT` 后重启服务任务，并同步调整防火墙规则与访问地址。
- `ALLOWED_ORIGINS` 填允许网页访问的主机名/IP，逗号分隔；不要填写 URL scheme 或端口。

## 常见问题

- `/health` 不通：确认任务状态、日志、端口和防火墙规则。
- 浏览器显示离线：确认网页与服务器同源访问，或把访问网页的主机名/IP 加入 `ALLOWED_ORIGINS`；检查 `/ws` 是否被代理/防火墙阻断。
- 端口被占用：在 `config.json` 改端口后重启服务，并放行对应 TCP 端口。
- 离线安装缺 Node：将官方 Node.js 22 x64 ZIP 放在上述任一搜索目录后重跑安装脚本。
- 卸载：运行 `uninstall.ps1` 只移除计划任务，不删除数据库、头像、日志和备份。
