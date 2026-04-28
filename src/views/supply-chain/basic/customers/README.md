# 销售客户（销售/采购/外协管理 → 基本资料）

## 物理表

- 表：`System_sales_customer`
- 主键：`id`
- 状态位：`pass`（审核）、`del`（逻辑删除）

## 前端页面

- 路径：`src/views/supply-chain/basic/customers/index.vue`
- 主要功能：
  - 列表/搜索/分页
  - 新增/编辑（**编码 `s_code` 手动填写**）
  - 查看（抽屉）
  - 审核/反审
  - 回收站（恢复/彻底删除）

## 列表显示列

- 编码：`s_code`
- 状态：`pass`（已审核/未审核）
- 名称：`s_name`
- 地址：`s_address`
- 联系方式：`s_lxr` / `s_tel` / `s_mobile`（空白不显示）
- 结算方式：`s_payfor`
- 本厂联系人：`lxr`
- 备注：`s_info`

## 新增/编辑字段

- `s_code`（必填，手动输入）
- `s_name`（必填）
- `s_address`
- `s_lxr`
- `s_tel`
- `s_mobile`
- `s_payfor`（下拉选择：关联 `System_settlement_method.name`；默认 COD；可不填）
- `lxr`
- `s_info`
- `s_business`
- `s_lb`（下拉：国内/国外/其他）

## 后端接口

- `GET /api/supply-chain/customers/list`：分页列表（默认 `pass=1`，回收站 `recycled=1`）
- `GET /api/supply-chain/customers/:id`：详情（回收站也可查看）
- `POST /api/supply-chain/customers`：新增（默认 `pass='0'`、`del='0'`）
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

