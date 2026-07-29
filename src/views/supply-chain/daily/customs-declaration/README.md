# 海关单模块

## 操作日志

预览匹配属于只读 POST，不写操作日志；生成生产入库或成品出库成功后，由中央白名单写入 `UB_Date_ERP_Operation_log`。



供应链 → 日常工作 → **海关单**（菜单位于销售订单正下方）。



领域规则见根目录 `CONTEXT.md`「海关单」节；定稿摘要见 `.scratch/customs-declaration/定稿.md`。



## 路由与权限



| 项 | 值 |

|---|---|

| 前端路由 / 菜单 path | `supply-chain/daily/customs-declaration` |

| 页面 | `src/views/supply-chain/daily/customs-declaration/index.vue` |

| 后端 | `server/customsDeclarationHandlers.js` + `customsDeclarationService.js` |

| 角色权限 | `view`（预览）、`add`（确认生成）；生成入库另须 `inventory/daily/stock-in` 的 `add`；生成出库另须 `inventory/daily/stock-out` 的 `add` |



## 已完成功能



- 页内标签：**入库单** / **出库单**；**同一份 Excel 上传预览**，两标签共用结果

- 上传与仓库根目录 [`docs/海关单模版.md`](../../../../../docs/海关单模版.md) 同列表头的 Excel（前端 SheetJS/`xlsx` 解析，支持 `.xls` / `.xlsx`）；**出货日期按 Excel 序列号解析**（关闭 `cellDates`，避免东八区少一天）

- **入库**：正式 PI（销售明细）→ 包装部派工 → 按 **正式 PI + 入库日期 + 派工单号** 分组；入库日期默认出货日 − 3 天

- **出库**：按同一份 Excel 的可匹配明细**独立解析**销售明细/成品仓校验（不再只看入库成功行）→ 按 **正式 PI + 出货日期 + 派工单号** 分组；预览成品仓可用量 = 仓内库存 + 本批待入库数量（按行序扣减）

- 出库失败行单独列出（组内 + 全局失败表，含中文原因），并覆盖整批 Excel 行的失败明细（不会因入库失败而“消失”）；摘要格式与入库对称（共/成功/失败/将生成）

- 编码拼接：默认 `厂款号/颜色`；客款号以 `OUT` 开头时拼 `厂款号/颜色-OUT`

- 精确编码失败时：若该 Excel PI 下包装部合计仅 1 条明细，且厂款号（去连字符后互相包含）、颜色段全等，则放宽命中真实编码；数量仍按可入余量截断

- 入库：申报量超过可入余量则截断；确认生成生产入库（自动审核）；`kcan08`=正式 PI；报关单号写入备注

- 出库：数量默认=本次可入库数量（与入库同口径）；若该行提示“可入余量为 0 / 该派工明细已入 X”（代表历史已入完），则回退用 Excel 申报数量继续做销售可出与成品仓库存校验；单价/报关单价=申报单价；海关单号/报关型号写入明细；主表成品出库、成品仓、不含税、关联正式 PI、客户自动带出；确认生成时明细必须带销售明细键（`sourceLineCode`/`kcaq02`），保存后按出库单号回查 id 再自动审核

- 出库失败行（含「该行入库未通过，出库数量无法确定」、缺申报单价、销售未唯一命中、销售可出不足、成品仓库存不足等）单独列出，不影响其它可生成组

- 第一版不做自动防重（仅提示已有生产入库/库存数量）



## 接口



| 方法 | 路径 | 权限 | 说明 |

|------|------|------|------|

| POST | `/api/customs-declaration/preview` | view | body `{ rows[] }`，返回 `groups` / `outboundGroups` / `failedRows` / `outboundFailedRows` |

| POST | `/api/customs-declaration/generate` | add + 入库 add | body `{ groups[] }`，批量 `createStockIn` |

| POST | `/api/customs-declaration/generate-outbound` | add + 出库 add | body `{ outboundGroups[] }`，批量 `createStockOut` + 自动审核 |



## 固定主表口径



**入库**



- 类型：生产入库（`4`）

- 车间：包装部（按名称解析）

- 仓库：成品仓

- 单价/金额/税点：0



**出库**



- 类型：成品出库（`6`）

- 仓库：成品仓

- 含税：不含税（`in_tax=2`）

- 关联单号：正式 PI（`kcap04`）



## 已知问题 / 下一步



- 无导入痕迹表，重复上传靠人工看预览提示

- 出库预览已计入本批待入库数量；确认生成出库前建议先完成入库落库；入库生成成功后会自动刷新出库预览并同步失败原因

- 菜单对非 `*` 角色需在角色权限里单独勾选「海关单」

