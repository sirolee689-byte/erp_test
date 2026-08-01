# 员工报餐系统：ERP_UB 最小写权限

以下脚本兼容 SQL Server 2008 R2，只供数据库管理员审核后在 SSMS 中手工执行。应用不会自动执行。

`erp_user` 已加入 `db_datareader`；这里只增加方案 A 必需的 INSERT/UPDATE，不授予 DELETE、ALTER、CONTROL 或 `db_datawriter`。

```sql
USE [ERP_UB];
GO

IF USER_ID(N'erp_user') IS NULL
BEGIN
    RAISERROR(N'ERP_UB 中不存在数据库用户 erp_user，请先建立登录映射。', 16, 1);
    RETURN;
END
GO

GRANT INSERT ON dbo.UB_ERP_Dining_dishes TO [erp_user];
GRANT INSERT ON dbo.UB_ERP_Dining_dishes_list TO [erp_user];
GRANT INSERT, UPDATE ON dbo.UB_ERP_Dining_meal TO [erp_user];
GO
```

如需回滚本次写权限，由数据库管理员手工执行：

```sql
USE [ERP_UB];
GO

REVOKE INSERT ON dbo.UB_ERP_Dining_dishes FROM [erp_user];
REVOKE INSERT ON dbo.UB_ERP_Dining_dishes_list FROM [erp_user];
REVOKE INSERT, UPDATE ON dbo.UB_ERP_Dining_meal FROM [erp_user];
GO
```
