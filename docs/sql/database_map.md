# 数据库业务映射（L3）

> 单源：表/字段与页面功能的映射关系。页面交互细节见各模块 README。

## 入库单 · 生产入库批量添加

| 业务功能 | 物理表 | 关键字段 / 说明 |
|----------|--------|-----------------|
| 派工单主表校验 | `UB_ERP_Dispatch_order` | `scaj01` 派工单号；`scaj05` 生产车间编码；`pass=1` 已审核；`del=0` 未删；`closed=0` 未结案 |
| 派工单明细来源 | `UB_ERP_Dispatch_order_list` | `scak01` 派工单号；`scak02` 明细唯一键（写入入库明细 `kcao02`）；`scak03` 派工数量 |
| 单位换算补全 | `UB_ERP_Bom_000` | 明细缺 `kcaa26/kcaa27` 时按 `kcaa01` 联 BOM 补全 |
| 物料浮动率 | `UB_ERP_Stocks_material` | `stocks_in` → 可入上限 `kcao031 = tempx + tempx × 浮动率` |
| 已入/未审入库汇总 | `UB_ERP_Stocks_Storage` + `UB_ERP_Stocks_Storage_list` | `kcan03=4`（生产入库）；`kcan04=scak01`；明细 `kcao02=scak02`；按 `pass` 分已审/未审 |
| 返工出库展示 | `UB_ERP_Stocks_out` + `UB_ERP_Stocks_out_list` | 关联 `kcan04/kcap04=派工单号`；明细 `kcao02=scak02`；**仅展示，不参与 tempx** |
| 入库明细落库 | `UB_ERP_Stocks_Storage_list` | `kcao02=scak02`；生产入库 `kcao04/kcao041/kcao05/kcao051=0`；`Customer_supply` 整型 |

## 入库单 · 生产入库选派工单（s_search4 口径）

| 业务功能 | 物理表 | 关键字段 / 说明 |
|----------|--------|-----------------|
| 车间前置校验 | `UB_ERP_Stocks_workshop` | `code`；`del=0`；`pass=1`；无效则接口 400 |
| 派工主表 | `UB_ERP_Dispatch_order` | `scaj01` 单号；`scaj04` PI；`scaj02/scaj06` 日期；`scaj05` 车间；`cj` 车间名；`systemcode` 供批量添加上下文；`pass=1`；`closed=0` |
| 派工明细 | `UB_ERP_Dispatch_order_list` | `scak01` 关联主表；`scak02=[GUID]` 有效行；`scak03/04/05` 派工/已入库/返修；余量 `scak03-scak04+scak05>0`（快照，与旧系统一致） |
| 接口 | — | `GET /api/stock-in/production-dispatch-pick-page`；参数 `workshopCode`、`keyword`、`page/pageSize`；搜索仅头表字段 |

## 派工单 · 批量选货与可派工余量

| 业务功能 | 物理表 | 关键字段 / 说明 |
|----------|--------|-----------------|
| 销售订单来源 | `UB_ERP_Sales_order` + `UB_ERP_Sales_order_list` | `xsak03` 销售数量；主表 `pass=1`、`del=0`、`closed=0` |
| 已派工扣减 | `UB_ERP_Dispatch_order` + `UB_ERP_Dispatch_order_list` | `GET /api/dispatch-order/goods-options`；保存校验同口径；**本厂/大板**：按 `scaj04`(PI)+`scaj05`(车间)+`kcaa01` 独立池，不同车间互不占用；委外保留 `cj like '%生产%'` 或按 `scaj05` 特殊口径 |
| 接口 | — | `GET /api/dispatch-order/goods-options`；`POST/PUT /api/dispatch-order` 保存前数量校验 |

## 采购订单 · 转向物料查询（search_wl 口径）

| 业务功能 | 物理表 | 关键字段 / 说明 |
|----------|--------|-----------------|
| 分类下拉来源 | `UB_ERP_Bom_code` | `copen=1`；按 `px,id` 排序；分类前缀优先取 `flag5`，空值时按分类名做兼容映射（如主袋→`BAG-`、拉牌→`TAG-`、成品→`PQ-`、裁片→`CUT-`） |
| 转向查询主数据 | `UB_ERP_Buy_order_list` | 仅查 `pass=1` 且 `del=0`；支持关键词匹配采购明细字段与冗余物料字段（含 `kcaa01~kcaa35`、`kcaa02_en`、`kpname`、`location` 等） |
| 采购头补充信息 | `UB_ERP_Buy_order` | 通过 `kcaj01=kcak01` 回填关联单号、采购时间、下单人（`utruename`）、供应商 |
| 入库数量聚合 | `UB_ERP_Stocks_Storage` + `UB_ERP_Stocks_Storage_list` | 仅统计采购入库 `kcan03=1`，且主/明细都要求 `pass=1`、`del=0`；按 `kcan04=kcak01` + `kcaa01` 汇总入库数量 |
| 接口 | — | `GET /api/buy-order/material-trace/bom-codes`（分类）；`GET /api/buy-order/material-trace/list`（分页 `page/pageSize`，默认 10） |
## 出库单 · 库存出库与来源回写

| 业务功能 | 物理表 | 关键字段 / 说明 |
|----------|--------|-----------------|
| 出库单主表 | `UB_ERP_Stocks_out` | `kcap01` 出库单号；`kcap02` 出库日期；`kcap03` 出库类型；`kcap04` 来源单号；`kcap05` 往来单位编码；`kcap06` 仓库；`kcap08` 纸质单号（**外协领料类型 2 存 PI**）；`kcap09` 预留单号；`cj/cjname` 加工后外协本厂车间；`kehu` 往来单位名称快照；`in_tax` 是否含税；`pass/del/Closed`；**草稿可空明细保存，审核须至少一条 `del=0` 明细**。类型 `6` 前端默认 `in_tax=2`，切换到其它类型恢复 `in_tax=1`；类型 `10` 销售出库的 `kcap04` 为用户自由填写文本，可为空，不做销售订单来源校验 |
| 出库单操作日志 | `UB_Date_ERP_Operation_log` | 出库单新增、修改、删除、恢复、审核、反审核写入旧系统日志表；仅写旧表公共字段 `uid/uname/utruename/code/addtime/systemcode/ip/act_name/act_info`（列不存在则忽略），`code='UB_ERP_Stocks_out'`，`systemcode=UB_ERP_Stocks_out.systemcode`；新增 `act_name=出库单录入`，修改 `act_name=出库单修改`；审核/反审核内容使用出库单号 `kcap01` 与出库类型中文，不写出库编码、出库单编码或 `<br>`；`kcap03=9` 日志写旧系统名「盈亏出库」 |
| 外协领料选单 | `UB_ERP_assist_order` / `_list` + `UB_ERP_Stocks_Storage` / `_list` | `GET /api/stock-out/assist-issue-source-page`；主表 `del=0,pass=1,closed=0`；明细 `del=0,pass=1`；关键字只模糊搜 PI(`wxaj04`)、外协商(`wxaj05/kehu`)、外协单号(`wxaj01`)；过滤换算后 `wxak03-wxak08+wxak07>0`；入库数量 `inbound_agg` 按 `kcan04+kcao02` 预聚合 JOIN；列表 `COUNT(1) OVER` 一次取 total |
| 外协领料批量 | `UB_ERP_assist_order_list` + `UB_ERP_Bom_pi_cost` + `UB_ERP_Bom_parts` + `UB_ERP_Bom_000` + `UB_ERP_Stocks_out` + `UB_ERP_Stocks_out_list` + `UB_ERP_Buy_order` + `UB_ERP_Buy_order_list` | `GET /api/stock-out/assist-issue-batch-lines`；先读外协主表 `wxaj03`。**订单外协等**：先筛外协明细再 Bom_parts 展开（pi_cost 按 `sid+Product` 叠加 `kcac04` 单用量）。**订单外发（wxaj03=2）**：仅读 `UB_ERP_Bom_pi_cost`，`sid=明细.pi`、`pq=明细.kcaa01`，全属性分组后 `SUM(kcac06)` 为单用量，子料/快照取自 pi_cost；出库单价/含税单价/税点按子料 `kcaa01` 从最近已审核采购订单明细取 `kcak04/kcak041/tax`，无采购价写 0。库存三列按子料+仓：账存=已审入−已审出，实际=账存−未审出。还需出库=换算(wxak03)×单用量−本单号(`kcap04`)+本仓(`kcap06`)+子料(`kcaa01`)已审/未审外协领料出库(`kcap03=2`)；默认可选=min(实际库存,还需出库)。`kcaa01`=子料；批量窗口 `sourceLineCode←wxak02`；**落库 `kcaq02` 按子料 `kcaa01` 写 BOM.systemcode**；`kcaq03`←默认可选，`kcaq031`←仓存上限 |
| 出库单明细 | `UB_ERP_Stocks_out_list` | `kcaq01` 出库单号；`kcaq02` **默认按 `kcaa01` 查 `UB_ERP_Bom_000` 写 BOM.systemcode**（与 `GUID`/`systemcode` 同值）；**成品出库（`kcap03=6`）例外：写销售明细 `xsak02/systemcode`** 供审核回写 `xsak06`；`kcaq03` 出库数量；`kcaq04/kcaq041/kcaq05/kcaq051` 单价/金额；`kcaa01~kcaa35` 保存物料快照；`kcaa02_en` 抄 BOM 英文名称；`uid/uname/utruename/addtime` 保存时写入当前操作员与时间 |
| 库存可用量 | `UB_ERP_Stocks_Storage` + `UB_ERP_Stocks_Storage_list` + `UB_ERP_Stocks_out` + `UB_ERP_Stocks_out_list` | 可用量 = 已审核入库 - 已审核出库 - 未审核出库占用；按物料、仓库、颜色、版本、库位维度聚合 |
| 采购退货回写 | `UB_ERP_Buy_order_list` | 审核增加、反审核扣回 `kcak07`；使用 `kcaa26/kcaa27` 做单位换算 |
| 外协领料/退货回写 | `UB_ERP_assist_order_list` | 审核增加、反审核扣回 `wxak08`；使用 `kcaa26/kcaa27` 做单位换算 |
| 生产领料回写 | `UB_ERP_Dispatch_order_list` | 审核增加、反审核扣回 `scak04`；不做单位换算 |
| 生产返修回写 | `UB_ERP_Dispatch_order_list` | 审核增加、反审核扣回 `scak05`；不做单位换算 |
| 成品出库回写 | `UB_ERP_Sales_order_list` | 审核增加、反审核扣回 `xsak06`；不做单位换算 |
| 成品出库明细报关字段 | `UB_ERP_Stocks_out_list` | 类型 `kcap03=6`：报关单号=`Reference`、报关型号=`Describe`（兼容 `info`）、报关单价=`kcaq08`；改不含税单价时前端同步 `kcaq08`；工具栏「填报关单号」一键填满所有行 `Reference` |
| 其他出库批量选材 | `UB_ERP_Stocks_Storage` + `UB_ERP_Stocks_Storage_list` + `UB_ERP_Stocks_out` + `UB_ERP_Stocks_out_list` + `UB_ERP_Bom_000` | 按仓库 `kcan06/kcap06` + 物料 `kcaa01` 分组；账存=已审入库−已审出库；实际=账存−未审出库；价格取本仓最近 `pass=1` 且主表 `sp_flag=1` 入库明细 |
| 盘亏出库批量选材（类型 `9`） | 复用「其他出库批量选材」相关表 | 关联单号 `kcap04` 可手填或为空；点击批量添加走 `other-batch-lines` / `other-batch-prices`；仅实际库存（账存−未审）`>0` 可选；保存主表 `kcap03=9`、明细写 `UB_ERP_Stocks_out_list`；审核参与库存扣减但**不回写**采购/外协/生产/销售来源表 |
| 销售出库批量选材（类型 `10`） | 复用「其他出库批量选材」相关表 | 基础资料 `kcap04` 允许自由填写或为空；点击批量添加始终走 `other-batch-lines`/`other-batch-prices` 普通库存选材，按当前仓库实际库存出库；不走销售订单来源、不回写 `UB_ERP_Sales_order_list` |
| 采购退货关联采购单选择 | `UB_ERP_Buy_order` + `UB_ERP_Buy_order_list` | 仅显示主表 `del=0/pass=1/closed=0` 与明细 `del=0/pass=1`；按采购单分组首行显示「关联选择」；回填 `kcap04←kcaj01`、`kcap05/kehu←kcaj05/kehu`、前端隐藏 `sourceSystemcodeId←systemcode` |
| 生产领料关联派工单选择 | `UB_ERP_Dispatch_order` + `UB_ERP_Dispatch_order_list` + `UB_ERP_Stocks_out` + `UB_ERP_Stocks_workshop` | `GET /api/stock-out/production-dispatch-source-page`；主表 `del=0/pass=1/closed=0` 且 `scaj05=车间`；明细 `scak02=GUID`；排序 `scaj01` 倒序；关联出库单号按 `kcap04=派工单号` 聚合；回填 `kcap04←scaj01`、`kcap08←scaj04`（PI）、`kcap05/kehu←车间`、`sourceSystemcodeId←systemcode`（前端暂存，不入主表） |
| 成品出库关联销售订单选择 | `UB_ERP_Sales_order` + `UB_ERP_Sales_order_list`（EXISTS 可出过滤） | `GET /api/stock-out/finished-goods-source-page`；**一行一 PI**，只查销售订单主表分页；列表返回 `sourceOrderNo/poNo/customerCode/customerName/sourceSystemcode`；有可出明细用 `EXISTS`（`l.xsak01=h.xsaj01` 直比；明细 `del=0/pass=1`、`xsak02=GUID` 且 `xsak03-xsak06>0`）；弹窗仅关键字筛选（无客户下拉）；主表须 `closed=0/del=0/pass=1`；关键字搜主表 `xsaj01/xsaj02/xsaj03/xsaj04/xsaj05/xsaj06/xsaj08/rmb`；回填 `kcap04←xsaj01`、`kcap08←xsaj06`、`kcap05/kehu←xsaj05/kehu`、`sourceSystemcodeId←systemcode` |
| 成品出库批量添加 | `UB_ERP_Sales_order` + `UB_ERP_Sales_order_list` + `UB_ERP_Finance_currency` + `UB_ERP_Stocks_Storage` + `UB_ERP_Stocks_Storage_list` + `UB_ERP_Stocks_out` + `UB_ERP_Stocks_out_list` | `GET /api/stock-out/finished-goods-batch-lines`；主表校验 `xsaj01/xsaj05/systemcode`；明细 `xsak01=订单`；可出货=`换算(xsak03)−已审出(按kcaa01)−未审出(按kcaq02=xsak02)`；库存按仓+子料；选行 `kcaq02←xsak02/systemcode`；**不带单价**；独立页 `/inventory/daily/stock-out-finished-goods-batch-window` |
| 生产领料批量添加 | `UB_ERP_Dispatch_order_list` + `UB_ERP_Bom_pi_cost` + `UB_ERP_Bom_000` + `UB_ERP_Stocks_material` + `UB_ERP_Stocks_Storage` + `UB_ERP_Stocks_Storage_list` + `UB_ERP_Stocks_out` + `UB_ERP_Stocks_out_list` + `UB_ERP_Buy_order` + `UB_ERP_Buy_order_list` | `GET /api/stock-out/production-issue-batch-lines`；**非开料部**：派工明细 `scak02=GUID` 经 pi_cost 展开（`sid=PI`、`isok=1`、`top_kcaa01` 或 `pq` 命中派工物料）；列表需出库=`SUM(kcac06×scak03)`；`Describe←Bom_000.kcaa02`；**开料部（车间 04）**：不走派工展开；`sid=PI` 且 CUT 裁片且 `kcaa05` 命中 `cutting_issue=1`；列表需出库=`SUM(kcac06×temp)`（裁片子集）；**PI共用池总量** `piDemandQty`=`ROUND(SUM(kcac06×ISNULL(temp,1)),3)`（`pi_cost.sid=PI、isok=1、kcaa01=子料`，全PI不按车间/派工）；**PI已出** `piIssuedQty`=`SUM(kcaq03)`（`kcap08=PI、kcaa01=子料、h.del=0`，不按车间/派工/仓库/pass）；**还需出库**=`min(派工剩余,PI剩余)`，派工剩余=需出库−本派工(`kcap03=4,kcap04`)+本仓+子料已审/未审；默认可领=`min(还需出库,实际库存)`；批量窗口 `sourceLineCode` 仅作去重；**落库 `kcaq02` 按子料 `kcaa01` 写 BOM.systemcode**；配置 `GET/PUT /api/stock-out/cutting-issue-config`；列表按子料 `kcaa01` 合并 |
| 生产领料（计划外）类型 `7` | `UB_ERP_Stocks_out` + `UB_ERP_Dispatch_order`（选派工，选填）+ 复用上表或「其他出库批量选材」 | **强制** `kcap05` 生产车间、`kcap06` 仓库、`in_tax`；`kcap04` 派工单**选填**；有派工时 `kcap08←PI`，无派工时 `kcap08←纸质单号`；有派工批量走 `production-issue-batch-lines`，无派工走 `other-batch-lines`/`other-batch-prices`；**审核不回写** `scak04`；无派工来源明细 `kcaq02←BOM.systemcode` |
| 开料出库配置 | `UB_ERP_Stocks_material` | `GET/PUT /api/stock-out/cutting-issue-config`；字段 `cutting_issue`（`1`=纳入开料部批量）；仅超级管理员可 PUT；迁移见 `scripts/migrations/sqlserver_stock_out_cutting_issue_flag.txt` |
| 采购退货批量添加筛选 | `UB_ERP_Buy_order` + `UB_ERP_Buy_order_list` + `UB_ERP_Stocks_Storage` + `UB_ERP_Stocks_Storage_list` + `UB_ERP_Stocks_out` + `UB_ERP_Stocks_out_list` | 条件：`kcap04`+`kcap05`+`kcap06`；明细键 `kcak02`；采购可退池=本仓已审采购入库（`kcan03=1,kcan04,kcao02,kcan06`）−已审/未审退货出库（`kcap03=1,kcap04,kcaq02,kcap06`）；当前可退=`min(采购可退池, 仓库实际库存)`；选行 `kcaq02←kcak02`；独立页 `/inventory/daily/stock-out-purchase-return-batch-window` |
| 接口 | — | `GET /api/stock-out/other-batch-lines`；`POST /api/stock-out/other-batch-prices`；独立页 `/inventory/daily/stock-out-other-batch-window` |
| 采购退货新接口 | — | `GET /api/stock-out/purchase-return-source-page`；`GET /api/stock-out/purchase-return-batch-lines`；独立页 `/inventory/daily/stock-out-purchase-return-batch-window` |
| 出库单 · 生产领料（补数）类型 `8` | `UB_ERP_Stocks_out` + `UB_ERP_Dispatch_order`（选派工，选填）+ 复用生产领料批量或其他出库批量 | **强制** `kcap05` 生产车间、`kcap06` 仓库、`in_tax`；`kcap04` 派工单**选填**；有关联派工时 `kcap08←PI`、前端 `systemcode_id←UB_ERP_Dispatch_order.systemcode`，批量走 `production-issue-batch-lines`；无派工时 `kcap08←纸质单号`，批量走 `other-batch-lines`/`other-batch-prices`；**审核不回写** `scak04/scak05`。 |
