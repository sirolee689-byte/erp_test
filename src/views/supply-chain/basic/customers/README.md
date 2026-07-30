# 销售客户（销售/采购/外协管理 → 基本资料）

## 物理表

- 表：`UB_ERP_System_sales_customer`
- 主键：`id`
- 状态位：`pass`（审核）、`del`（逻辑删除）

## 前端页面

- 路径：`src/views/supply-chain/basic/customers/index.vue`
- 顶栏：对齐供应商资料——「管理销售客户」/「销售客户添加」（已去掉工具条「新增客户」）
- **顶栏/内容区无框**（2026-07-23）：列表卡片与添加/编辑表单均不加外框线，对齐出入库。
- 筛选区：关键字旁为「查询」「重置」，其后竖线分隔「回收站」「显示未审核」，右侧「刷新」
- 主要功能：
  - 列表/搜索/分页
  - **添加 / 编辑 / 查看**：均为**当前页表单**（不再用弹窗或抽屉）；查看与编辑同布局且只读；保存或「返回列表」后回到管理列表
  - 编码 `s_code` 手动填写（无建议编码）
  - 审核/反审
  - 回收站（恢复/彻底删除；彻底删除仅 `New_UB_ERP_User.is_admin=1` 的超级管理员可执行）
- 列表：操作列左固定；状态列显示已审/未审；操作列宽按当前页可见按钮 + 权限实时估宽（`getErpTableActionsColWidthByRows`）

## 列表显示列

- 操作（左固定）→ 编码 → 状态 → 名称 → 地址 → 联系方式 → 结算方式 → 本厂联系人 → 备注
- 联系方式：`s_lxr` / `s_tel` / `s_mobile`（空白不显示）

## 新增/编辑/查看字段（当前页表单，列宽 A=250 / B=500；类别单独 160；查看只读）

1. 初始时间（A）→ `intime`（默认当天，可改）
2. 编码（A）→ `s_code`（必填，手动输入）
3. 名称（A）、税号（A）、类别（160）→ `s_name`、`s_sh`、`s_lb`（国内/国外/其他）
4. 地址（B）→ `s_address`
5. 经营范围（B）→ `s_business`
6. 联系人 / 手机 / 电话号码 / 传真号码（A）→ `s_lxr`、`s_mobile`、`s_tel`、`s_fax`
7. 结算方式（A）、本厂联系人（A）→ `s_payfor`（结算方式下拉；默认 COD；可不填）、`lxr`
8. 备注（B）→ `s_info`

## 后端接口

- `GET /api/supply-chain/customers/list`：分页列表（默认 `pass=1`，回收站 `recycled=1`；含 `intime`/`s_sh`/`s_fax`）
- `GET /api/supply-chain/customers/:id`：详情（回收站也可查看；含 `intime`/`s_sh`/`s_fax`）
- `POST /api/supply-chain/customers`：新增（默认 `pass='0'`、`del='0'`；`intime` 空则兜底当天）
- `PUT /api/supply-chain/customers`：编辑（仅在册且未审核）
- `PUT /api/supply-chain/customers/audit`：审核
- `PUT /api/supply-chain/customers/unaudit`：反审
- `PUT /api/supply-chain/customers/restore`：回收站恢复
- `DELETE /api/supply-chain/customers/:id`：逻辑删除（仅未审核且在册）
- `DELETE /api/supply-chain/customers/:id/permanent`：彻底删除（仅回收站）

## 权限（按钮级）

- 菜单 path：`supply-chain/basic/customers`
- `view`：列表与详情
- `add`：新增
- `edit`：编辑、恢复
- `audit`：审核、反审
- `delete`：逻辑删除、彻底删除

## 操作日志

新增、修改、审核、反审、删除、恢复和彻底删除成功后，由中央白名单写入一条 `UB_Date_ERP_Operation_log`；日志摘要保留客户编码、名称和关键字段差异。
