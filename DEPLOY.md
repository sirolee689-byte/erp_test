# ERP 内网部署说明（Windows · 单体 Node · 29 端口）

目标：局域网通过 **`http://192.168.1.33:29`** 访问 ERP（页面 + 接口同一端口）。

## 1. 环境要求

- 便携 Node：`E:\ERP_TEST\.tools\node\`（系统 PATH 无 Node 时用这个）
- SQL Server 已就绪；`.env` 中 `DB_DATABASE` 须含 `NEW_UB_ERP_System_role`（当前为 `UB_ERP_V2.0`）
- 本机 **29** 端口：须先停 IIS 站点 **Ministock**（与 ERP 二选一）

## 2. 首次 / 重新部署

```powershell
cd E:\ERP_TEST
$env:Path = 'E:\ERP_TEST\.tools\node;' + $env:Path

# 停旧 MiniStock（管理员）
%windir%\system32\inetsrv\appcmd.exe stop site /site.name:Ministock

npm run build
# 后台启动（或用 scripts\start-production.ps1 / boot-start-erp.ps1）
Start-Process -FilePath .\.tools\node\node.exe -ArgumentList 'server\index.js' -WorkingDirectory E:\ERP_TEST -WindowStyle Hidden
```

## 3. 访问

| 项 | 值 |
|----|-----|
| 端口 | **29** |
| 局域网 | **http://192.168.1.33:29** |
| 本机自测 | http://127.0.0.1:29 |
| 健康检查 | http://127.0.0.1:29/api/health → `{"ok":true}` |

## 4. 关键配置（`.env`）

- `PORT=29`、`HOST=0.0.0.0`
- `NODE_ENV=production`、`DEBUG_API=false`
- `DB_DATABASE=UB_ERP_V2.0`（勿误连 `ERP_UB`）

## 5. 开机自启

计划任务名：`ERP-Production-Port29`（系统启动后跑 `scripts\boot-start-erp.ps1`）。

试跑：`schtasks /Run /TN "ERP-Production-Port29"`

## 6. 注意

- 重启 Node 后须**重新登录**（登录态在内存）
- 恢复旧 MiniStock：`appcmd start site /site.name:Ministock`（会与 ERP 争 29）
- 日志：`E:\ERP_TEST\logs\`
