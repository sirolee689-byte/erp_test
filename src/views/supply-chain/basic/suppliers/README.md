# 供应商资料（UB_ERP_System_supplier）

## 功能说明

- 列表：默认显示 **已审核**（`pass=1`）且在册（`del=0/空/NULL`）的供应商
- 顶栏：对齐采购订单——「管理供应商」/「供应商添加」
- **添加 / 编辑 / 查看**：均为**当前页表单**（不再用弹窗或抽屉）；查看与编辑同布局且只读；保存或「返回列表」后回到管理列表
- 筛选区：关键字旁为「查询」「重置」，其后竖线分隔「回收站」「显示未审核」，右侧「刷新」
- 切换：支持“显示未审核”（`pass=0`）
- 回收站：支持“回收站”视图（仅 `del=1`），并可 **恢复**
- 操作：审核、反审、软删、恢复；已审列表为「查看 + 反审」；未审为「查看 + 编辑 + 审核 + 删除」

## 添加/编辑/查看表单布局

列宽组（控件宽）：**A=250px / B=80px / C=500px**；类别单独 **160px**。行序：

1. 初始时间（A）→ `intime`（默认当天，可改）
2. 编码（A）→ `s_code`
3. 名称（A）、简称（A）→ `s_name`、`s_sname`
4. 类别（160px，与右侧字段多留间距）、报价时效性（B）+「天」、采购货期（B）+「天」、外协货期（B）+「天」→ `s_lb`、`s_bj`、`s_jh`、`s_wx_jh`
5. 地址（C）→ `s_address`
6. 经营范围（C）→ `s_business`
7. 联系人 / 手机 / 电话号码 / 传真号码（A）→ `s_lxr`、`s_mobile`、`s_tel`、`s_fax`
8. 结算方式 / 税号 / 开户行 / 账号（A）→ `s_payfor`、`s_sh`、`s_bank`、`s_bank_number`
9. 开票类型三按钮（可多选，样式对齐采购类型）+ 默认税率（B）→ `kplx`/`kplxx`/`kplxxx`、`sl`
10. 备注（C）→ `s_info`

- **类别下拉**固定：`采购` / `外协` / `共用` / `其他`
- **结算方式下拉**：`GET /api/supply-chain/settlement-methods/list`（已审在册）

## 列表展示（对齐旧系统）

- **列序**：操作（左固定）→ 编码 → 状态 → 名称 → 简称 → 税号 → 类别 → 联系方式 → 结算方式 → 货期 → 税率 → 发票类型 → 备注
- **联系方式**（两行）：
  - `电话号码：s_tel、传真号码：s_fax`
  - `联系人：s_lxr、手机：s_mobile`
- **货期**：采购取 `s_jh`；外协取 **`s_wx_jh`**（旧系统外协曾误用 `s_jh`，新系统已修正）
- **发票类型**：`kplx/kplxx/kplxxx` 有值时分别显示「普票」「增票」「电子发票」，可并列
- **排序**：`s_code DESC, id ASC`
- **分页**：默认每页 **100** 条；操作列宽按可见按钮数自动估算

## 前端页面

- `src/views/supply-chain/basic/suppliers/index.vue`

## 后端接口

- `GET /api/supply-chain/suppliers/list`
  - 入参：`page`、`pageSize`、`keyword?`、`pass?`、`recycled?`
  - 出参：`{ total, list }`（含 `s_fax`、`s_bj`、`intime`；排序 `s_code DESC, id ASC`）
- `GET /api/supply-chain/suppliers/suggest-code`：按 `s_code` 中 `CN-` + 纯数字取最大后缀 +1（例：最新 `CN-1254` → 建议 `CN-1255`；无号段时 `CN-1`；含回收站）
- `POST /api/supply-chain/suppliers`：新增（可写含 `intime`/`s_bj`/`s_fax`；默认 `pass=0`、`del=0`；`intime` 空则服务端兜底当天）
- `PUT /api/supply-chain/suppliers`：编辑（仅未审核且在册可改；同上字段）
- `PUT /api/supply-chain/suppliers/audit`：`{ id }`
- `PUT /api/supply-chain/suppliers/unaudit`：`{ id }`
- `DELETE /api/supply-chain/suppliers/:id`：软删（仅未审核）
- `PUT /api/supply-chain/suppliers/restore`：`{ id }`
- `DELETE /api/supply-chain/suppliers/:id/permanent`：彻底删除（仅回收站 del=1，不可恢复）

## 关键字段

- 主键：`id`
- 审核：`pass`（`1` 已审核，`0` 未审核）
- 逻辑删除：`del`（`1` 删除，`0/空/NULL` 在册）
- 初始时间：`intime`
- 报价时效性：`s_bj`（天数）
- 列表/表单字段：
  - `s_code`、`s_name`、`s_sname`、`s_sh`、`s_lb`
  - 联系方式：`s_tel`、`s_fax`、`s_lxr`、`s_mobile`
  - 结算方式：`s_payfor`
  - 货期：`s_jh`（采购天数）、`s_wx_jh`（外协天数）
  - 税率：`sl`
  - 发票类型：`kplx` / `kplxx` / `kplxxx`
  - 备注：`s_info`
  - 地址/经营范围/开户行/账号：`s_address`、`s_business`、`s_bank`、`s_bank_number`

## 已知问题 / 下一步

- 发票类型三个开关位，表单用高亮按钮可多选（值为 `'1'/'0'`）；列表展示用简称「普票/增票/电子发票」
