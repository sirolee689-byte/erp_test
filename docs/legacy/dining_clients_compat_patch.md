# 旧饭堂刷卡页取消报餐兼容补丁

旧 `wap_online/clients.asp` 使用 GB2312 编码，不能用普通 UTF-8 编辑器直接覆盖，否则页面中文和语音文件名可能乱码。

补丁只修改两条 `UB_ERP_Dining_meal` 查询，增加：

```sql
AND del='0' AND pass='1'
```

用途：员工在新系统取消报餐后，旧刷卡页不再把软删除记录当成有效报餐。

脚本通过 `TargetPath` 指定旧源码副本，运行前会验证两条原始查询，并创建 `clients.asp.codex-backup`。任何一条查询不匹配时，脚本会在写文件前终止。

先执行只读检查，不修改文件：

```powershell
Set-Location D:\my_projects\ERP_TEST
powershell -ExecutionPolicy Bypass -File .\docs\legacy\apply_dining_clients_compat_patch.ps1 -TargetPath 'C:\Users\it_manager\Desktop\ERP源码\智能饭堂\报餐系统\wap_online\clients.asp' -CheckOnly
```

确认后再应用补丁：

```powershell
Set-Location D:\my_projects\ERP_TEST
powershell -ExecutionPolicy Bypass -File .\docs\legacy\apply_dining_clients_compat_patch.ps1 -TargetPath 'C:\Users\it_manager\Desktop\ERP源码\智能饭堂\报餐系统\wap_online\clients.asp'
```

本脚本不负责发布到旧网站；源码副本验证通过后，再由管理员按原部署方式发布。
