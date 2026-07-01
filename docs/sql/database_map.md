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

## 入库单 · 生产退料批量添加

| 业务功能 | 物理表 | 关键字段 / 说明 |
|----------|--------|-----------------|
| 接口 | — | `GET /api/stock-in/production-batch-lines?inboundType=5`；`dispatchSystemcode` **必填** |
| 派工单主表校验 | `UB_ERP_Dispatch_order` | 按 `systemcode` + `scaj05=车间` 查 `del=0/pass=1/closed=0`，并与 `scaj01=派工单号` 交叉校验；失败「数据不存在,请联系IT部检查!」 |
| 派工单明细 | `UB_ERP_Dispatch_order_list` | `scak01=派工单号`；无明细返回「此订单无清单数据,请检查订单数据!」 |
| 已退/未审退料汇总 | `UB_ERP_Stocks_Storage` + `UB_ERP_Stocks_Storage_list` | `kcan03=5`（生产退料）；`kcan04=scak01`；明细 `kcao02=scak02` |
| 返工出库展示 | `UB_ERP_Stocks_out` + `UB_ERP_Stocks_out_list` | `kcap04=派工单号`；明细 `kcaq02=scak02`；已审 `kcaq03` 展示为「返工数量」，不参与 tempx |

## 入库单 · 生产入库选派工单（s_search4 口径）

| 业务功能 | 物理表 | 关键字段 / 说明 |
|----------|--------|-----------------|
| 车间前置校验 | `UB_ERP_Stocks_workshop` | `code`；`del=0`；`pass=1`；无效则接口 400，提示「此生产车间错误,请重新选择!」 |
| 派工主表 | `UB_ERP_Dispatch_order` | `scaj01` 单号；`scaj04` PI；`scaj02/scaj06` 日期；`scaj05` 车间；`cj` 车间名；`systemcode` 供批量添加上下文；`pass=1`；`closed=0` |
| 派工明细 | `UB_ERP_Dispatch_order_list` | `scak01` 关联主表；`scak02=[GUID]` 有效行；`scak03/04/05` 派工/已入库/返修；余量 `scak03-scak04+scak05>0`（快照，与旧系统一致） |
| 接口 | — | `GET /api/stock-in/production-dispatch-pick-page`；参数 `workshopCode`、`inboundType`、`keyword`、`page/pageSize`；生产入库 `keyword` 为空时不加载派工单，搜索仅匹配派工单号 `scaj01` 与 PI号 `scaj04`；有搜索时 `kw_headers` 先筛头表再 JOIN `qual_lines`，列表 `COUNT(1) OVER()` 合并总数，生产入库(type4)不跑 `returned_lines` 汇总；生产退料(type5)仍汇总已退料并沿用既有派工头表搜索口径 |

## 入库单 · 采购入库选择采购单与状态同步

| 业务功能 | 物理表 | 关键字段 / 说明 |
|----------|--------|-----------------|
| 采购单选择 | `UB_ERP_Buy_order` + `UB_ERP_System_supplier` | `GET /api/stock-in/source-order-page?inboundType=1`；只显示采购主表 `del=0/pass=1/closed=0`；采购单号 `kcaj01`，PI号/关联号 `kcaj04`，供应商编码 `kcaj05`，采购日期 `kcaj02`，前端暂存来源键 `systemcode`；供应商名称从供应商资料 `s_code` 关联 |
| 采购选择搜索 | `UB_ERP_Buy_order` + `UB_ERP_System_supplier` | 关键字匹配采购单号、PI号、供应商编码、采购单供应商快照 `kehu`、供应商资料 `s_name/name`；分页仍用 `ROW_NUMBER()` 兼容 SQL Server 2008 R2 |
| 采购单回填 | `UB_ERP_Stocks_Storage` | 选择后保存 `kcan04=UB_ERP_Buy_order.kcaj01`、`kcan05=UB_ERP_Buy_order.kcaj05`、`kehu=供应商正式名称`；采购主表 `systemcode` 只在前端暂存，不写入入库主表 |
| 审核状态同步 | `UB_ERP_Stocks_Storage` + `UB_ERP_Stocks_Storage_list` | 审核/反审核同步主表和明细 `pass`；复核/反复核同步主表和明细 `sp_flag`；明细匹配键为 `UB_ERP_Stocks_Storage_list.kcao01 = UB_ERP_Stocks_Storage.kcan01` |

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
| 出库转向物料查询 | `UB_ERP_Stocks_out_list` + `UB_ERP_Stocks_out` | `GET /api/stock-out/material-trace/list`；明细 `del=0` 且主表 `pass=1`、`del=0`；`l.kcaq01=h.kcap01` 直比 JOIN；关键字直比模糊 10 列（`kcaa01/kcaq01/kcaa02/remark/Reference/Product/Describe` + 主表 `kcap04/kehu/ck`）；页内切换 `pageMode=material-trace` 或独立页 `/inventory/daily/stock-out-material-trace-window` |
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

## 系统内核 · 系统EMAIL发送配置

| 业务功能 | 物理表 | 关键字段 / 说明 |
|----------|--------|-----------------|
| 系统邮件发送配置 | `UB_ERP_System_mail` | 单条全局配置，页面路径 `/system/kernel/erp-core`；`GET/PUT /api/system/kernel/mail-config` 按 `id ASC` 读取第一条；无记录时保存新增 |
| 配置字段 | `UB_ERP_System_mail` | `systemcode` 核心编码；`ConstFromNameCn` 发件中文名；`ConstFromNameEn` 发件英文名；`ConstFrom` 系统发件地址；`ConstMailDomain` SMTP 地址；`ConstMailServerUserName` 邮箱登录名；`ConstMailServerPassword` 邮箱密码密文 |
| 审计字段 | `UB_ERP_System_mail` | 新增写 `addtime`、`ip`、`del='0'`、`pass='1'`；更新写 `editime` |
| 页面展示字段 | - | `code=005`、`IT_manager=UB_ERP_System_mail` 只用于页面展示，本次不写入业务表 |
| 密钥与日志 | `UB_Date_ERP_Operation_log` | 核心密钥只走后端环境变量校验，不入库；邮箱密码用 `ERP_MAIL_CRYPTO_KEY` 可逆加密，日志不记录核心密钥和邮箱密码 |

## 系统内核 · 打印设定
| 业务功能 | 物理表 | 关键字段 / 说明 |
|----------|--------|-----------------|
| 系统打印抬头配置 | `UB_ERP_System_Head` | 单条全局配置，页面路径 `/system/kernel/print-setting`；`GET/PUT /api/system/kernel/print-config` 按 `id ASC` 读取第一条；无记录时保存新增 |
| 抬头基础字段 | `UB_ERP_System_Head` | `systemcode` 核心编码；`qyname` 企业中文名；`qyenname` 企业英文名；`sh` 企业税号；`address` 企业地址；`title` 系统中文名；`entitle` 系统英文名 |
| 打印内容字段 | `UB_ERP_System_Head` | `logo` 单据 LOGO，页面按图片预览并支持上传更换；`info` 单据标头 HTML 内容，页面按“LOGO 在上、标头文字在下”的方式可视化编辑，是打印页顶部抬头优先来源 |
| 图片兼容规则 | `UB_ERP_System_Head` | `logo` 兼容旧系统 `<img ...>` 标签或纯图片路径；页面解析 `src` 预览图片，上传后尽量保留旧标签格式只替换图片地址；上传目录可用 `ERP_PRINT_IMAGE_DIR` 固定 |
| 兼容保留字段 | `UB_ERP_System_Head` | `[cn-s]`、`[cn-t]`、`[en-US]`、`[it-IT]`、`bc`、`wxs`、`index_logo`、`index_img`、`index_wx` 本页面不再展示；接口保存时保留已加载值，避免误清空旧数据 |
| 数字配置字段 | `UB_ERP_System_Head` | 真实表字段 `[cn-s]`、`[cn-t]`、`[en-US]`、`[it-IT]`、`bc`、`wxs` 为 `int`，页面按数字输入，空值保存 `NULL` |
| 审计字段 | `UB_ERP_System_Head` | 新增写 `addtime`、`ip`；更新写真实字段 `edittime` |
| 页面展示字段 | - | `code=002`、`IT_manager=UB_ERP_System_Head` 只用于页面展示，本次不写入业务表 |
| 密钥与日志 | `UB_Date_ERP_Operation_log` | ERP 内核所有功能共用 `ERP_CORE_CONFIG_KEY`；保存成功写操作日志，日志不记录核心密钥 |

### 出库单批量打印（2026-06-30）

| 业务功能 | 物理表 | 关键字段 / 说明 |
|----------|--------|-----------------|
| 出库单打印入口 | `UB_ERP_Stocks_out` | `GET /api/stock-out/print-data` 保留 `id` 单张详情兼容；批量打印使用 `p_sum`（逗号分隔的 `systemcode`）和 `print_cn`（`1` 明细、`2` 汇总）。打印查询按 `systemcode` 找主表，找不到第 x 张时返回“其中第【x】张单数据不存在，请返回检测！”。 |
| 出库单打印明细 | `UB_ERP_Stocks_out_list` + `UB_ERP_Stocks_colorcode` | 明细模式按 `kcaq01=UB_ERP_Stocks_out.kcap01` 查询 `del=0` 明细；汇总模式按 `kcaa01/kcaa02/kcaa03/kcaa11/kcaa04` 分组合计 `kcaq03`；颜色名称按 `kcaa11 = UB_ERP_Stocks_colorcode.code` 关联有效颜色。 |
| 出库单打印 LOGO | `UB_ERP_System_Head` | 打印数据接口同时读取第一条打印设定的 `logo`，兼容旧系统 `<img ...>` 或纯图片路径，返回 `printConfig.logoSrc`；前端未取到时回退 `/images/logo.png`。 |
## 当前准则：入库单采购入库选择窗口

| 业务功能 | 物理表 | 关键字段 / 说明 |
|----------|--------|-----------------|
| 采购入库选择页 | `UB_ERP_Buy_order` + `UB_ERP_Buy_order_list` + `UB_ERP_Finance_currency` | `GET /api/stock-in/source-order-page?inboundType=1`；显示采购订单 + 采购明细汇总，不是单纯采购主表；采购主表 `del=0/pass=1/closed=0`，采购明细 `del=0`；按采购单号、采购明细来源键、物料和单位换算字段汇总 |
| 采购数量与价格 | `UB_ERP_Buy_order_list` + `UB_ERP_Finance_currency` | 采购数量按 `kcak03`、`kcaa26`、`kcaa27` 换算到使用单位；单价和金额结合单位换算与汇率展示；价格列由前端入库单 `price` 权限控制 |
| 入库数量统计 | `UB_ERP_Stocks_Storage` + `UB_ERP_Stocks_Storage_list` | 按 `kcan03=1`、`kcan04=采购单号`、`kcao02=采购明细来源键` 统计；`pass=0` 为入库单未审数，`pass=1` 为已入库数量；主从表均排除 `del=1` |
| 采购退货统计 | `UB_ERP_Stocks_out` + `UB_ERP_Stocks_out_list` | 按采购退货类型 `kcap03=1`、`kcap04=采购单号`、材料编码 `kcaa01` 汇总已审核且未删除退货数量；差数 = 采购换算数量 - 未审入库 - 已审入库 + 已审退货 |
| 采购单回填 | `UB_ERP_Stocks_Storage` | 点击同一采购单第一行“关联选择”后，前端回填 `kcan04=kcaj01`、供应商编码/名称和隐藏来源键，并清空当前入库明细 |
## 当前准则：入库单采购入库选择窗口性能

| 业务功能 | 物理表 | 关键字段 / 说明 |
|----------|--------|-----------------|
| 采购来源页 | `UB_ERP_Buy_order` + `UB_ERP_Buy_order_list` + `UB_ERP_Finance_currency` + `UB_ERP_System_supplier` | `GET /api/stock-in/source-order-page?inboundType=1` 先按采购订单和采购明细取当前请求页；主表要求 `del=0/pass=1/closed=0`，明细要求 `del=0`；分页用 `ROW_NUMBER()` 兼容 SQL Server 2008 R2 |
| 当前页入库统计 | `UB_ERP_Stocks_Storage` + `UB_ERP_Stocks_Storage_list` | 不再全量汇总后分页；只按当前页的 `sourceOrderNo=kcan04` 与 `sourceLineCode=kcao02` 补算 `pendingInboundQty/approvedInboundQty` |
| 当前页退货统计 | `UB_ERP_Stocks_out` + `UB_ERP_Stocks_out_list` | 只按当前页的 `sourceOrderNo=kcap04` 与 `kcaa01` 补算 `returnQty`；差数由后端按 `采购数量 - 未审入库 - 已入库 + 退货数量` 合成 |
| 采购选择搜索 | `UB_ERP_Buy_order` + `UB_ERP_Buy_order_list` | `ZY-260904` 这类优先匹配 `kcaj01`；`OA-10431` 这类优先匹配 `kcaa01`；普通关键字再走采购字段、币别、材料名称/规格等多字段模糊搜索 |
# 当前准则：入库单外协入库选择窗口

| 业务点 | 表 | 规则 |
|---|---|---|
| 外协入库选择页 | `UB_ERP_assist_order` + `UB_ERP_assist_order_list` + `UB_ERP_Finance_currency` | `GET /api/stock-in/source-order-page?inboundType=2`；默认主表 `del=0/pass=1/closed=0`，明细 `del=0`；传 `includeUnaudited=1` 时保留未审行但只读禁选；供应商列显示 `UB_ERP_assist_order.kehu`，外协日期按 `yyyy-mm-dd` 输出 |
| 外协商筛选 | `UB_ERP_System_supplier` | 候选只取 `del=0/pass=1` 且 `s_lb in ('外协','共用')`；前端传 `assistSupplierCode` 后按 `UB_ERP_assist_order.wxaj05` 过滤 |
| 外协入库数量 | `UB_ERP_Stocks_Storage` + `UB_ERP_Stocks_Storage_list` | 当前页补算；按 `kcan03=2`、`kcan04=外协单号`、`kcao02=外协明细键`、主从 `del=0`、主表 `pass=1` 汇总 `kcao03` |
| 外协选择页性能 | 同上 | 基础资料选择页不显示也不计算单价/金额；首屏不强制精确 `COUNT`，一次预取 3 页并多取 1 条判断 `hasMore`；外协单号形态关键字优先匹配 `wxaj01` 精确/前缀，普通关键字才走多字段模糊 |
