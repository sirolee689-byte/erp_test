# 员工报餐系统（`views/dining`）

## 已完成功能

- 直接访问 `/dining`，未登录进入 `/dining/login`，已登录进入 `/dining/meal`；ERP 右上角“报餐系统”用新标签打开，不影响 ERP 登录。
- 员工使用 `DINING_DB_DATABASE` 指向库的 `UB_ERP_Hr_staff.new_code/password` 登录，仅允许 `del=0/pass=1`；当前测试库为 `UB_ERP_V2.0`，报餐会话使用独立 `dining_token/dining_user`，默认八小时。
- 报餐管理页按日期展示明天起未来 30 天，每天只有“报午餐”和“报晚餐”；桌面双列、手机单列，不提供菜式选择。
- 页面读取旧系统正式报餐记录。同一员工同日同餐的多道菜合并成一个已报状态，截止前可以提交或取消。
- 截止时间读取旧库饭堂配置 `bc`；前一天达到截止时间后锁定次日，更远日期仍可报。

## 页面与接口

- `/dining/login`：员工登录。
- `/dining/meal`：正式报餐与取消。
- `/dining/profile`：个人用餐记录，默认当天前23天至未来7天；午餐、晚餐合并为一天一行，日期显示星期，可切换全部历史并按10天分页。
- `/dining/change-password`：兼容旧链接，进入后打开与顶部相同的修改密码弹窗。
- `POST /api/dining/login`：正式库员工登录。
- `GET /api/dining/session`：恢复报餐登录状态。
- `POST /api/dining/logout`：退出报餐系统。
- `GET /api/dining/meals`：读取未来 30 天的午餐/晚餐状态及截止信息。
- `PUT /api/dining/meals`：按 `date/mealType/selected` 提交或取消报餐；操作人只取报餐会话，不接收前端员工 ID。
- `GET /api/dining/profile/meals`：读取当前员工个人报餐与刷卡历史；`scope=recent|all`、`page`，近期固定前23天至未来7天，午晚餐合并为一天一行，每页固定10天。
- `PUT /api/dining/password`：校验旧密码后直接更新当前员工旧表明文密码；成功后使该员工全部报餐会话失效。
- `/dining-terminal`：内网饭堂刷卡终端，不要求账号登录，但必须通过服务端IP授权。
- `GET /api/dining-terminal/context`：读取终端、午晚餐时段、`closed` 和测试模式。
- `POST /api/dining-terminal/swipe`：按10位饭卡号核对新旧报餐并写实际用餐流水。
- `GET /api/dining-terminal/recent`：读取当前终端最近20条有效刷卡记录。

## 旧系统兼容

- 新提交只在 `UB_ERP_Dining_meal` 写一条“午餐（统一餐）”或“晚餐（统一餐）”。
- 某日期餐次第一次从新系统提交时，自动在 `UB_ERP_Dining_dishes`、`UB_ERP_Dining_dishes_list` 补兼容主档和明细；已有旧菜单时复用当天主档。
- 取消采用软删除，并取消员工同日同餐的全部有效旧记录，以免旧系统多道菜仍被重复计数。
- 饭堂数据库必须显式配置 `DINING_DB_DATABASE`；当前试用使用 `UB_ERP_V2.0`，切换 `ERP_UB` 时不迁移测试报餐和刷卡流水。正式库账号的最小授权见 `docs/sql/dining_formal_db_permissions.md`。
- 个人中心合并本人报餐和成功刷卡：每行同时展示午餐和晚餐的报餐、打卡状态；未报餐且未刷卡显示“未报餐 / —”，已报餐无成功流水时按 `two2/three2` 判定“未打卡”或“漏卡”，正常刷卡与 `closed=1` 补餐成功均显示“已打卡”。
- 登录后的顶部栏吸顶显示员工姓名和饭卡号；饭卡号优先 `new_card_number`，为空才显示 `card_number`。顶部与左侧“修改密码”共用同一个改密弹窗。

## 饭堂刷卡终端

- 所有已授权窗口通用，不按 `UB_ERP_Dining_machine.jw` 限制部门；IP不存在时直接拒绝。
- 正式模式只按 `two1/two2` 自动识别午餐、按 `three1/three2` 自动识别晚餐；早餐、宵夜不在本期。
- `DINING_TERMINAL_TEST_MODE=true` 只有目标库为 `UB_ERP_V2.0` 时生效，可手动选择测试日期和午/晚餐；`ERP_UB` 强制关闭。
- 兼容 `card_number/new_card_number`，旧系统一餐多道菜只算已报一餐；成功、补餐、未报餐、重复刷卡均有大字和语音反馈。
- 同一员工、日期、餐别跨窗口只成功一次；后端使用 SQL Server 业务锁保护并发，不新增索引或表结构。
- 只读实测约为：员工识别 10ms、有效报餐 54ms、重复检查 508ms、当前窗口最近记录 307ms。两张大表目前只有主键，第一版不做索引 DDL。

## 已知边界

- 系统配置、公告、窗口授权和新管理员统计后台不在本期。
- 周末和节假日第一版默认允许报餐，尚无停餐日期配置。
- 正式外网登录必须启用 HTTPS；仓库代码只提供 `/dining` 页面，域名证书和反向代理由服务器部署配置完成。
- 后端改动后需用户手工重启 API并重新登录；测试电脑IP还必须在测试库 `UB_ERP_Dining_machine` 中存在。
