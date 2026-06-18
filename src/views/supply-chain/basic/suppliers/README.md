# 供应商资料（UB_ERP_System_supplier）

## 功能说明

- 列表：默认显示 **已审核**（`pass=1`）且在册（`del=0/空/NULL`）的供应商
- 切换：支持“显示未审核”（`pass=0`）
- 回收站：支持“回收站”视图（仅 `del=1`），并可 **恢复**
- 操作：审核、反审、软删、恢复

## 前端页面

- `src/views/supply-chain/basic/suppliers/index.vue`

## 后端接口

- `GET /api/supply-chain/suppliers/list`
  - 入参：`page`、`pageSize`、`keyword?`、`pass?`、`recycled?`
  - 出参：`{ total, list }`
- `GET /api/supply-chain/suppliers/suggest-code`
- `POST /api/supply-chain/suppliers`：新增（手动填写 `s_code`，默认 `pass=0`、`del=0`）
- `PUT /api/supply-chain/suppliers`：编辑（仅未审核且在册可改）
- `PUT /api/supply-chain/suppliers/audit`：`{ id }`
- `PUT /api/supply-chain/suppliers/unaudit`：`{ id }`
- `DELETE /api/supply-chain/suppliers/:id`：软删（仅未审核）
- `PUT /api/supply-chain/suppliers/restore`：`{ id }`
- `DELETE /api/supply-chain/suppliers/:id/permanent`：彻底删除（仅回收站 del=1，不可恢复）

## 关键字段

- 主键：`id`
- 审核：`pass`（`1` 已审核，`0` 未审核）
- 逻辑删除：`del`（`1` 删除，`0/空/NULL` 在册）
- 列表展示字段：
  - `s_code`、`s_name`、`s_sname`、`s_sh`、`s_lb`
  - 新增补充：`s_address`、`s_business`、`s_bank`、`s_bank_number`
  - 联系方式：`s_lxr`、`s_mobile`、`s_tel`
  - 结算方式：`s_payfor`
  - 货期：`s_jh`（采购天数）、`s_wx_jh`（外协天数）
  - 税率：`sl`
  - 发票类型：`kplx` / `kplxx` / `kplxxx`
  - 备注：`s_info`

## 已知问题 / 下一步

- 发票类型字段采用 `kplx/kplxx/kplxxx` 三个开关位，前端以复选框编辑（值为 `'1'/'0'`）

