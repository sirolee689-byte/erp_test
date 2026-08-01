# 员工报餐系统（`views/dining`）

## 已完成功能

- 直接访问 `/dining`，未登录进入 `/dining/login`，已登录进入 `/dining/meal`；ERP 右上角“报餐系统”用新标签打开，不影响 ERP 登录。
- 员工使用旧正式库 `ERP_UB.dbo.UB_ERP_Hr_staff.new_code/password` 登录，仅允许 `del=0/pass=1`；报餐会话使用独立 `dining_token/dining_user`，默认八小时。
- 报餐管理页按日期展示明天起未来 30 天，每天只有“报午餐”和“报晚餐”；桌面双列、手机单列，不提供菜式选择。
- 页面读取旧系统正式报餐记录。同一员工同日同餐的多道菜合并成一个已报状态，截止前可以提交或取消。
- 截止时间读取旧库饭堂配置 `bc`；前一天达到截止时间后锁定次日，更远日期仍可报。

## 页面与接口

- `/dining/login`：员工登录。
- `/dining/meal`：正式报餐与取消。
- `/dining/profile`：个人中心占位页。
- `/dining/change-password`：修改密码占位页。
- `POST /api/dining/login`：正式库员工登录。
- `GET /api/dining/session`：恢复报餐登录状态。
- `POST /api/dining/logout`：退出报餐系统。
- `GET /api/dining/meals`：读取未来 30 天的午餐/晚餐状态及截止信息。
- `PUT /api/dining/meals`：按 `date/mealType/selected` 提交或取消报餐；操作人只取报餐会话，不接收前端员工 ID。

## 旧系统兼容

- 新提交只在 `UB_ERP_Dining_meal` 写一条“午餐（统一餐）”或“晚餐（统一餐）”。
- 某日期餐次第一次从新系统提交时，自动在 `UB_ERP_Dining_dishes`、`UB_ERP_Dining_dishes_list` 补兼容主档和明细；已有旧菜单时复用当天主档。
- 取消采用软删除，并取消员工同日同餐的全部有效旧记录，以免旧系统多道菜仍被重复计数。
- 正式库默认名为 `ERP_UB`，可用 `DINING_DB_DATABASE` 覆盖；数据库账号的最小授权见 `docs/sql/dining_formal_db_permissions.md`。

## 已知边界

- 个人中心和修改密码仍是占位页；系统配置、公告、窗口授权和新管理员统计后台不在本期。
- 周末和节假日第一版默认允许报餐，尚无停餐日期配置。
- 正式外网登录必须启用 HTTPS；仓库代码只提供 `/dining` 页面，域名证书和反向代理由服务器部署配置完成。
- 后端改动后需用户手工重启 API并重新登录；未授权正式库写权限前，查询可用，提交会显示中文权限提示。
