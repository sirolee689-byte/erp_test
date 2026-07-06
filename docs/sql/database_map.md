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
| 接口 | — | `GET /api/stock-in/production-batch-lines?inboundType=5`；`dispatchSystemcode`、`warehouseCode`、`piNo` 必填；支持 `fetchAll=1` |
| 派工单主表校验 | `UB_ERP_Dispatch_order` | 按 `systemcode` + `scaj05=车间` 查 `del=0/pass=1/closed=0`，并与 `scaj01=派工单号` 交叉校验；失败「数据不存在,请联系IT部检查!」 |
| 子料来源 | `UB_ERP_Dispatch_order_list` + `UB_ERP_Bom_pi_cost`；开料部另读 `UB_ERP_Stocks_material.cutting_issue` | 非开料部：派工明细要求 `scak02=GUID`；按 `sid=PI` 且 `(top_kcaa01=派工物料 OR pq=派工物料)` 展开实际领料子料；同子料 `kcaa01` 合并显示。开料部（车间 `04`）：复用出库生产领料的 PI 裁片来源，`sid=PI` 且 CUT 裁片且 `kcaa05` 命中 `cutting_issue=1`，来源键为 `CUT|材料编码` |
| 已领料汇总 | `UB_ERP_Stocks_out` + `UB_ERP_Stocks_out_list` | `kcap03=4`、`kcap04=派工单号`、`kcap06=当前仓库`、明细 `kcaa01=子料`；已审和未审都计入已领料数量，未审单号用于窗口展示 |
| 已退料汇总 | `UB_ERP_Stocks_Storage` + `UB_ERP_Stocks_Storage_list` | `kcan03=5`、`kcan04=派工单号`、明细 `kcaa01=子料`；已审和未审都扣减可退数量，编辑时排除当前入库单 |
| 入库明细落库 | `UB_ERP_Stocks_Storage_list` | `kcao02=首个派工明细 scak02`（开料部为 `CUT|材料编码`），`reference=PI号`，`Describe/info=对应派工货品名称`；`kcaa01~35` 来自 PI 成本子料快照；单价/金额/税点保持 0 |

## 入库单 · 生产入库选派工单（s_search4 口径）

| 业务功能 | 物理表 | 关键字段 / 说明 |
|----------|--------|-----------------|
| 车间前置校验 | `UB_ERP_Stocks_workshop` | `code`；`del=0`；`pass=1`；无效则接口 400，提示「此生产车间错误,请重新选择!」 |
| 派工主表 | `UB_ERP_Dispatch_order` | `scaj01` 单号；`scaj04` PI；`scaj02/scaj06` 日期；`scaj05` 车间；`cj` 车间名；`systemcode` 供批量添加上下文；`pass=1`；`closed=0` |
| 派工明细 | `UB_ERP_Dispatch_order_list` | `scak01` 关联主表；`scak02=[GUID]` 有效行；`scak03/04/05` 派工/已入库/返修；余量 `scak03-scak04+scak05>0`（快照，与旧系统一致） |
| 接口 | — | `GET /api/stock-in/production-dispatch-pick-page`；参数 `workshopCode`、`inboundType`、`keyword`、`page/pageSize`；生产入库 `keyword` 为空时不加载派工单，搜索仅匹配派工单号 `scaj01` 与 PI号 `scaj04`；有搜索时 `kw_headers` 先筛头表再 JOIN `qual_lines`，列表 `COUNT(1) OVER()` 合并总数，生产入库(type4)不跑 `returned_lines` 汇总；生产退料(type5)仍汇总已退料并沿用既有派工头表搜索口径 |
| 编辑旧单关联恢复 | `UB_ERP_Dispatch_order` | `GET /api/stock-in/source-options` 对类型 `4/5` 返回派工主表 `systemcode` 为 `sourceSystemcode`；前端编辑旧单时按派工单号和车间恢复 `dispatchSystemcode`，避免已有派工单的入库单无法直接批量添加 |

## 入库单 · 采购入库选择采购单与状态同步

| 业务功能 | 物理表 | 关键字段 / 说明 |
|----------|--------|-----------------|
| 采购单选择 | `UB_ERP_Buy_order` + `UB_ERP_System_supplier` | `GET /api/stock-in/source-order-page?inboundType=1`；只显示采购主表 `del=0/pass=1/closed=0`；采购单号 `kcaj01`，PI号/关联号 `kcaj04`，供应商编码 `kcaj05`，采购日期 `kcaj02`，前端暂存来源键 `systemcode`；供应商名称从供应商资料 `s_code` 关联 |
| 采购选择搜索 | `UB_ERP_Buy_order` + `UB_ERP_System_supplier` | 关键字匹配采购单号、PI号、供应商编码、采购单供应商快照 `kehu`、供应商资料 `s_name/name`；分页仍用 `ROW_NUMBER()` 兼容 SQL Server 2008 R2 |
| 采购单回填 | `UB_ERP_Stocks_Storage` | 选择后保存 `kcan04=UB_ERP_Buy_order.kcaj01`、`kcan05=UB_ERP_Buy_order.kcaj05`、`kehu=供应商正式名称`；采购主表 `systemcode` 只在前端暂存，不写入入库主表 |
| 审核状态同步 | `UB_ERP_Stocks_Storage` + `UB_ERP_Stocks_Storage_list` | 审核/反审核同步主表和明细 `pass`；复核/反复核同步主表和明细 `sp_flag`；明细匹配键为 `UB_ERP_Stocks_Storage_list.kcao01 = UB_ERP_Stocks_Storage.kcan01` |

## 入库单 · 盘盈入库批量选材

| 业务功能 | 物理表 | 关键字段 / 说明 |
|----------|--------|-----------------|
| 盘盈选材 | `UB_ERP_Bom_000` + `UB_ERP_Stocks_material` | `GET /api/stock-in/surplus-batch-lines`；只过滤物料主档 `del=0` 且 `kcaa01` 不为空；按 `kcaa01~kcaa35`、`systemcode`、`location`、`kcaa02_en`、`kpname` 等字段模糊查询；分页用 `ROW_NUMBER()`；不按当前库存是否大于 0 限制 |
| 最近复核入库价 | `UB_ERP_Stocks_Storage` + `UB_ERP_Stocks_Storage_list` | `POST /api/stock-in/surplus-batch-prices`；按当前仓库 `kcan06` + 物料 `kcaa01` 取主表 `pass=1` 且 `sp_flag=1`、主从未删除的最新入库明细 `kcao04/kcao041/tax` |
| 入库明细落库 | `UB_ERP_Stocks_Storage_list` | 前端带回默认 `kcao03=1`、`kcao031=1`，用户改实际盘盈数量；类型 `kcan03=7` 不要求关联单号或来源明细键；保存时物料快照仍按 `kcaa01` 从 `UB_ERP_Bom_000` 重新补齐 |

## 入库单 · 其他入库批量选材（新窗口）

| 业务功能 | 物理表 | 关键字段 / 说明 |
|----------|--------|-----------------|
| 其他入库批量选材 | `UB_ERP_Bom_000` + `UB_ERP_Stocks_Storage` + `UB_ERP_Stocks_Storage_list` + `UB_ERP_Stocks_out` + `UB_ERP_Stocks_out_list` | 前端窗口 `/inventory/daily/stock-in-other-batch-window`；`GET /api/stock-in/other-batch-lines` 按关键字从物料主档选材并 LEFT JOIN 当前仓库库存三列（账存=已审入−已审出，未审出=未审出库合计，实际=账存−未审出）；首屏 `requireKeyword=1` 且关键字为空时不查库 |
| 最近复核入库价 | `UB_ERP_Stocks_Storage` + `UB_ERP_Stocks_Storage_list` | 保存已选时复用 `POST /api/stock-in/surplus-batch-prices`；按仓库 `kcan06` + 物料 `kcaa01` 取 `pass=1` 且 `sp_flag=1` 最新入库明细价 |
| 分页兼容 | `UB_ERP_Bom_000` | `other-batch-lines` 使用 `ROW_NUMBER() OVER (ORDER BY kcaa01, systemcode)`（SQL Server 2008 R2 兼容） |

## 入库单 · 批量打印

| 业务功能 | 物理表 | 关键字段 / 说明 |
|----------|--------|-----------------|
| 入库单批量打印 | `UB_ERP_Stocks_Storage` + `UB_ERP_Stocks_Storage_list` + `UB_ERP_Stocks_colorcode` + `UB_ERP_System_Head` | 列表 `p_sum` 为逗号分隔 `kcan01`；`GET /api/stock-in/print-data?p_sum=&print_cn=`（`1` 明细 / `2` 汇总）；打印页 `/inventory/daily/stock-in-print`；主表 `del=0` 不按 `pass` 限制；明细 `kcao01=kcan01`、`del=0`；颜色名 JOIN `kcaa11`；LOGO 来自 `UB_ERP_System_Head.logo` |
| 入库单标签打印 | `UB_ERP_Stocks_Storage` + `UB_ERP_Stocks_Storage_list` + `UB_ERP_Stocks_colorcode` | 列表 `p_sumbq` 为逗号分隔 `kcan01`；`GET /api/stock-in/label-print-data?p_sumbq=`；打印页 `/inventory/daily/stock-in-label-print`；主表必须 `del=0/pass=1`；明细 `kcao01=kcan01`、`del=0`、按 `seq/id` 顺序一行一张标签；颜色名 JOIN `kcaa11`，找到显示 `颜色名称/颜色编码`，找不到显示 `颜色编码/颜色编码`；二维码内容沿用旧系统 `view.asp?action=stocks&kcaa01=材料编码&kcao01=入库单号` |
| 入库标签扫码物料信息 | `UB_ERP_Stocks_Storage` + `UB_ERP_Stocks_Storage_list` + `UB_ERP_Bom_000` + `UB_ERP_Stocks_colorcode` + `UB_ERP_Stocks_material` + `UB_ERP_Buy_order` + `UB_ERP_Buy_order_list` + `UB_ERP_Stocks_out` + `UB_ERP_Stocks_out_list` | `GET /api/stock-in/material-qr-info?action=stocks&kcaa01=&kcao01=`；前端路由 `/stock-in/material-qr-info` 与旧入口 `/view.asp` 均免登录只读；按入库单号 `kcao01` + 物料编码 `kcaa01` 读取入库明细，展示物料快照/BOM 主档、颜色名、材料分类、货仓/板房实时库存、最近采购和最近入库；库存只统计已审核且未删除的入库/出库；页脚开发人显示“廖越锋” |
| 入库转向物料查询 | `UB_ERP_Stocks_Storage_list` + `UB_ERP_Stocks_Storage` | `GET /api/stock-in/material-trace/list`；页内切换 `pageMode=material-trace`；明细 `l.kcao01=h.kcan01` 回查主表，主从表均要求 `del=0/pass=1`；分页用 `ROW_NUMBER()`；关键字性能优先，仅直比模糊高频字段（入库单号、关联单号、物料编码、名称、规格、颜色、PO/PI、备注、供应商/外协商、仓库等）；价格列由前端入库单 `price` 权限控制；只读 |

## 派工单 · 批量选货与可派工余量

| 业务功能 | 物理表 | 关键字段 / 说明 |
|----------|--------|-----------------|
| 销售订单来源 | `UB_ERP_Sales_order` + `UB_ERP_Sales_order_list` | `xsak03` 销售数量；主表 `pass=1`、`del=0`、`closed=0` |
| 已派工扣减 | `UB_ERP_Dispatch_order` + `UB_ERP_Dispatch_order_list` | `GET /api/dispatch-order/goods-options`；保存校验同口径；**本厂/大板**：按 `scaj04`(PI)+`scaj05`(车间)+`kcaa01` 独立池，不同车间互不占用；委外保留 `cj like '%生产%'` 或按 `scaj05` 特殊口径 |
| 接口 | — | `GET /api/dispatch-order/goods-options`；`POST/PUT /api/dispatch-order` 保存前数量校验 |

## 采购订单 · 转向物料查询（search_wl 口径）

| 业务功能 | 物理表 | 关键字段 / 说明 |
|----------|--------|-----------------|
| 采购单批量打印 | `UB_ERP_Buy_order` + `UB_ERP_Buy_order_list` + `UB_ERP_Buy_order_money` + `UB_ERP_System_supplier` + `UB_ERP_Stocks_colorcode` + `UB_ERP_System_Head` | 列表 `p_sum` 为逗号分隔采购单号 `kcaj01`；`GET /api/buy-order/print-data?p_sum=&print_mx=&print_cn=`；`print_mx=1` 明细打印逐张输出，`print_mx=2` 汇总打印先校验供应商一致，再按物料、单价、含税单价、税率、交货日期等字段汇总；`print_cn=1/2` 对应中/英文；价格字段继续受采购单 `price` 权限控制；LOGO 来自 `UB_ERP_System_Head.logo`；本版不写 `UB_ERP_Buy_order_hb` |
| 分类下拉来源 | `UB_ERP_Bom_code` | `copen=1`；按 `px,id` 排序；分类前缀优先取 `flag5`，空值时按分类名做兼容映射（如主袋→`BAG-`、拉牌→`TAG-`、成品→`PQ-`、裁片→`CUT-`） |
| 转向查询主数据 | `UB_ERP_Buy_order_list` | 仅查 `pass=1` 且 `del=0`；支持关键词匹配采购明细字段与冗余物料字段（含 `kcaa01~kcaa35`、`kcaa02_en`、`kpname`、`location` 等） |
| 采购头补充信息 | `UB_ERP_Buy_order` | 通过 `kcaj01=kcak01` 回填关联单号、采购时间、下单人（`utruename`）、供应商 |
| 入库数量聚合 | `UB_ERP_Stocks_Storage` + `UB_ERP_Stocks_Storage_list` | 仅统计采购入库 `kcan03=1`，且主/明细都要求 `pass=1`、`del=0`；按 `kcan04=kcak01` + `kcaa01` 汇总入库数量 |
| 编辑数量锁定 | `UB_ERP_Buy_order_list` + `UB_ERP_Stocks_Storage` + `UB_ERP_Stocks_Storage_list` | 采购单反审后可编辑；保存前按采购单号 `kcan04=kcak01`、采购入库类型 `kcan03=1`、主从 `del=0` 检查入库引用。命中入库的采购明细不允许修改或删除采购数量，前端也禁用该行数量输入框 |
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

## 系统内核 · 数据库配置

| 业务功能 | 物理表 | 关键字段 / 说明 |
|----------|--------|-----------------|
| 数据库配置 | `UB_ERP_System_Database_Config` | 页面路径 `/system/kernel/database-config`；`GET/PUT /api/system/kernel/database-config` 维护项目表名的用途和备注说明；首次保存时自动建表 |
| 配置字段 | `UB_ERP_System_Database_Config` | `systemcode` 核心编码；`table_name` 数据库表名，只读展示；`purpose` 用途；`remark` 备注；`source` 来源；`sort_order` 排序 |
| 审计字段 | `UB_ERP_System_Database_Config` | 新增写 `addtime`、`ip`、`del='0'`、`pass='1'`；更新写 `edittime`、`ip` |
| 边界 | - | 本表只保存表名说明元数据，不参与业务 SQL 表名替换；真实表名迁移需要单独做白名单和逐模块改造 |
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

## 库存统计表 · 普通库存统计（第一期）

| 业务功能 | 物理表 | 关键字段 / 说明 |
|----------|--------|-----------------|
| 统计来源 | `UB_ERP_Stocks_Storage` + `UB_ERP_Stocks_Storage_list` + `UB_ERP_Stocks_out` + `UB_ERP_Stocks_out_list` | 仅 `pass=1`、`del=0`；仓库 `kcan06`/`kcap06`；物料 `kcaa01`；期间 `kcan02`/`kcap02` |
| 报表聚合口径（阶段1） | `UB_ERP_Stocks_Storage` + `UB_ERP_Stocks_Storage_list` + `UB_ERP_Stocks_out` + `UB_ERP_Stocks_out_list` + `UB_ERP_Bom_000` + `UB_ERP_Stocks_material` + `UB_ERP_Stocks_colorcode` | `GET /api/stock-stats/report` 采用数据库端批量 CTE：先以入库/出库并集确定基础物料集合，再按 `kcaa01 + 仓库` 一次性汇总已审/未审入出库与最后入/出库日期；BOM 用 `ROW_NUMBER()` 取每个物料最新有效行后统一关联类别与颜色，禁止逐行 N+1 查询与逐行 `TOP 1`。 |
| 报表聚合口径（阶段2） | `UB_ERP_Stocks_Storage` + `UB_ERP_Stocks_Storage_list` + `UB_ERP_Stocks_out` + `UB_ERP_Stocks_out_list` + `UB_ERP_Bom_000` + `UB_ERP_Stocks_material` + `UB_ERP_Stocks_colorcode` + `UB_ERP_Buy_order` + `UB_ERP_Buy_order_list` | `GET /api/stock-stats/report` 改为会话临时表分段汇总：`#base` 先确定物料+仓库基础行，`#ai/#ui/#oa` 分别汇总已审入库、未审入库和出库，`#bom` 取最新有效 BOM，`#pp/#pi` 汇总在途采购与采购入库，最后统一关联并套用弹窗筛选。业务口径不变，只解决全仓统计大型 CTE 返回慢的问题。 |
| 在途数量 | `UB_ERP_Buy_order` + `UB_ERP_Buy_order_list` + `UB_ERP_Stocks_Storage` + `UB_ERP_Stocks_Storage_list` | 同接口批量 CTE：`max(0, 已审采购换算数量 - 已审采购入库换算数量)`；采购主表 `del=0/pass=1/kcaj02>=2019-01-01` 且 `< 截止日期`；采购入库 `del=0/pass=1/kcan03=1/kcan04=kcaj01/kcan06=当前仓库` 且 `< 截止日期`；数量均按明细 `kcaa26/kcaa27` 换算；仅展示，不参与帐存/实存/可用。 |
| 打印抬头 | `UB_ERP_System_Head` | `GET /api/stock-stats/print-header` 前端口径为 `logoSrc/info`；库存统计页与打印页抬头都直接联动“打印设定”。 |
| 仓库候选 | `UB_ERP_Stocks_Warehouse` | `GET /api/stock-stats/warehouse-options`（后续查询页预留） |
| 快照方案（已停用） | `UB_ERP_Stock_stats_snapshot` + `UB_ERP_Stock_stats_snapshot_line` | 当前库存统计页不再读写，待新方案确定后再恢复落库逻辑 |

## 入库统计表 · 入库明细统计（第一期）

| 业务功能 | 物理表 | 关键字段 / 说明 |
|----------|--------|-----------------|
| 报表来源 | `UB_ERP_Stocks_Storage` + `UB_ERP_Stocks_Storage_list` | `GET /api/stock-in-stats/report` 按入库明细逐行展示；主从通过 `l.kcao01 = h.kcan01` 关联；基础条件为主表 `del=0`、明细 `del=0`、入库日期 `kcan02` 在开始日 00:00:00 到结束日 23:59:59；不加 `pass=1`，未审核/反审未审记录保留展示。 |
| 查询字段 | 同上 | 仓库按 `h.kcan06`，全部仓库不限制；入库类别按 `h.kcan03`；材料代码精确匹配 `l.kcaa01`；材料名称/规格按 `l.kcaa02/l.kcaa03` 模糊；材料分类按 `l.kcaa05`；关联单位按 `h.kcan05/h.kehu`。 |
| 展示与总计 | 同上 | 数量取实际入库数量 `l.kcao03`；`l.kcao031` 是原始数量/可入库上限，不作为报表展示数量；调拨数量旧口径为 `l.kcao031 - l.kcao03`，第一期前端不展示该列；单价/金额取 `l.kcao04/kcao05/kcao041/kcao051`，受 `inventory/analysis/stock-in-stats:price` 控制；前端不显示单独仓库分组首行，也不生成仓库小计行，只保留真实明细和底部总计。 |
| 候选与抬头 | `UB_ERP_Stocks_Warehouse` + `UB_ERP_Bom_000` + `UB_ERP_Stocks_material` + `UB_ERP_System_Head` | 仓库候选只取已审核、未删除；材料代码候选来自 BOM 主档；材料分类候选来自 `UB_ERP_Stocks_material`；打印抬头复用 `UB_ERP_System_Head`。 |

## 出库统计表 · 出库明细统计（第一期）

| 业务功能 | 物理表 | 关键字段 / 说明 |
|----------|--------|-----------------|
| 报表来源 | `UB_ERP_Stocks_out` + `UB_ERP_Stocks_out_list` | `GET /api/stock-out-stats/report` 按出库明细逐行展示；主从通过 `l.kcaq01 = h.kcap01` 关联；基础条件为主表 `del=0`、明细 `del=0`、出库日期 `kcap02` 在开始日 00:00:00 到结束日 23:59:59；不加 `pass=1`，未审核/反审未审记录保留展示。 |
| 查询字段 | 同上 | 仓库按 `h.kcap06`，全部仓库不限制；出库类别按 `h.kcap03`；材料代码候选显示 `kcaa01`，实际按明细 `systemcode` 精确匹配；材料名称/规格按 `l.kcaa02/l.kcaa03` 模糊；材料分类按 `l.kcaa05` 支持多选；关联单位按 `h.kcap05/h.kehu`。 |
| 展示与总计 | 同上 | 数量取实际出库数量 `l.kcaq03`；出库类别 `4` 显示「生产领料」；单价/金额取 `l.kcaq04/kcaq05/kcaq041/kcaq051`，受 `inventory/analysis/stock-out-stats:price` 控制；备注优先取明细 `Describe`，为空取主表 `remark`；前端不显示仓库分组首行，也不生成仓库小计行，只保留真实明细和底部总计。 |
| 候选与抬头 | `UB_ERP_Stocks_Warehouse` + `UB_ERP_Bom_000` + `UB_ERP_Stocks_material` + `UB_ERP_System_Head` | 仓库候选只取已审核、未删除；材料代码候选来自 BOM 主档并返回 `systemcode`；材料分类候选来自 `UB_ERP_Stocks_material`；打印抬头复用 `UB_ERP_System_Head`。 |

## 生产领用统计表（明细）· 生产管理（第一期）

| 业务功能 | 物理表 | 关键字段 / 说明 |
|----------|--------|-----------------|
| 报表来源 | `UB_ERP_Stocks_out` + `UB_ERP_Stocks_out_list` | `GET /api/production-issue-stats/report`；主从 `l.kcaq01=h.kcap01`；主表 `del=0/pass=1`，明细 `del=0`；出库类别固定 `kcap03 in (2,4,7,8)`；仓库 `h.kcap06`；物料编码按明细 `l.kcaa01` 精确匹配。 |
| 统计标准 | 同上 + `UB_ERP_Sales_order` | `chooses=1`：日期按销售订单 `xsaj02` 发现 PI（`xsaj01`），再按 `h.kcap08 IN PI` 查出库明细；手填 PI 时直接 `kcap08 IN`；`chooses=2`：日期按 `h.kcap02`，手填 PI 可选追加 `kcap08 IN`。 |
| 展示字段 | 同上 | 单号 `kcap01`、日期 `kcap02`、PI `kcap08`、领用车间 `kehu`、材料 `kcaa01/02/03/04`、领用数量 `kcaq03`；退料数量第一期固定 0；实领数量=领用数量；备注第一期留空；无小计/合计行。 |
| PI 候选 | `UB_ERP_Sales_order` | `GET /api/production-issue-stats/pi-options`；默认 `pass=1/del=0/closed=0`；`includeClosed=1` 为全部已审 PI；多选后以逗号写入查询条件。 |
| 权限与抬头 | `UB_ERP_System_Head` | 菜单 `production/analysis/report-stats`；动作 `view`/`export`；打印抬头复用 `UB_ERP_System_Head`；结果上限 50000 行。 |

## 进销存统计报表 · 期间汇总（第一期）

| 业务功能 | 物理表 | 关键字段 / 说明 |
|----------|--------|-----------------|
| 报表来源 | `UB_ERP_Stocks_Storage` + `UB_ERP_Stocks_Storage_list` + `UB_ERP_Stocks_out` + `UB_ERP_Stocks_out_list` + `UB_ERP_Bom_000` + `UB_ERP_Stocks_material` + `UB_ERP_Stocks_colorcode` | `GET /api/stock-io-stats/report` 按“仓库 + 物料编码 `kcaa01`”期间汇总；入库 `l.kcao01=h.kcan01`，出库 `l.kcaq01=h.kcap01`；主表要求 `del=0/pass=1`，明细只要求 `del=0`，不按明细 `pass` 过滤；日期按 `>= 开始日 00:00:00` 且 `< 结束日次日 00:00:00`。 |
| 查询字段 | 同上 | 开始日期、结束日期、仓库必填；第一期只支持具体仓库，不支持全部仓库；物料编码按明细 `kcaa01` 精确匹配，物料名称/规格按明细快照模糊，材料分类按明细 `kcaa05` 多选过滤。 |
| 计算字段 | 同上 | 上期结存=开始日前历史已审入库数量-历史已审出库数量；上期单价取开始日前最近有效入库 `kcao04`；本期入库=`kcan03 in (1,2,0,5)` 入库 - `kcap03=1` 出库；本期出库=`kcap03 in (4,0,10,7,2)` 出库 - `kcan03 in (3,4)` 入库；本期补数=`kcap03=8`；本期盈亏=`kcan03=7` 入库 - `kcap03=9` 出库；结存按“上期+入库-出库-补数+盈亏”。 |
| 展示与权限 | 同上 | 展示物料资料、类别、颜色、最后入库/出库时间、各数量/单价/金额和异常提示；价格/金额字段受 `inventory/analysis/stock-io-stats:price` 控制，导出受 `inventory/analysis/stock-io-stats:export` 控制；异常提示包括缺少物料资料、缺少分类/颜色、缺少成本单价、负结存、出库成本无法计算等。 |
| 候选与抬头 | `UB_ERP_Stocks_Warehouse` + `UB_ERP_Bom_000` + `UB_ERP_Stocks_material` + `UB_ERP_System_Head` | 物料候选来自 BOM，仅按 `kcaa01` 作为筛选值；打印抬头复用 `UB_ERP_System_Head`。 |

# 采购单打印补充映射（2026-07-02）

| 业务功能 | 物理表 | 关键字段 / 说明 |
|----------|--------|-----------------|
| 采购单打印抬头 | `UB_ERP_System_Head` | `GET /api/buy-order/print-data?p_sum=&print_mx=&print_cn=` 返回 `printConfig.logoSrc` 与 `printConfig.headerHtml/info`；前端按“LOGO 在上、表头内容在下”显示。 |
| 采购单打印内容 | `UB_ERP_Buy_order` + `UB_ERP_Buy_order_list` + `UB_ERP_Buy_order_money` | 打印页“交货地址”固定为 `中山市卓越皮具有限公司`；数量、单价、金额、税点和合计只改变显示格式，按统一数字展示规则去掉尾 0，不改变数据库原值。 |
| 采购单打印签字栏 | 登录态 | “订单编写”只取当前登录态 `truename`；没有 `truename` 时为空，不使用 `utruename` 兜底。 |
## 材料流水账 · 单物料结存流水（第一期）

| 业务功能 | 物理表 | 关键字段 / 说明 |
|----------|--------|-----------------|
| 报表来源 | `UB_ERP_Stocks_Storage` + `UB_ERP_Stocks_Storage_list` + `UB_ERP_Stocks_out` + `UB_ERP_Stocks_out_list` | `GET /api/material-flow-ledger/report` 用 `UNION ALL` 合并入库、出库明细；入库 `l.kcao01=h.kcan01`，出库 `l.kcaq01=h.kcap01`；主表要求 `del=0/pass=1`，明细只要求 `del=0`，不按明细 `pass` 过滤，以便结存对齐库存统计表“账存数量”；物料按明细 `kcaa01` 精确匹配；仓库分别按 `kcan06/kcap06` 精确匹配；不使用也不写入 `UB_ERP_Stocks_acc`。 |
| 上期结存 | 同上 | 查询开始日期之前：已审入库数量 `l.kcao03` 合计 - 已审出库数量 `l.kcaq03` 合计；第一行固定显示“上期结存”，后端再对区间内流水逐行滚动计算结存。 |
| 查询字段 | 同上 + `UB_ERP_Bom_000` + `UB_ERP_Stocks_material` | 必填开始日期、结束日期、仓库、物料编码；仓库默认“货仓”；弹窗不显示物料唯一码；材料分类筛入库/出库明细 `kcaa05`。 |
| 采购在途 | `UB_ERP_Buy_order` + `UB_ERP_Buy_order_list` | `包含采购在途=是` 时额外展示采购在途行，来源为已审核、未删除、未结案采购单明细；只作为展示，不参与上期结存和滚动结存。 |
| 展示字段 | 同上 | 序号、单号日期、录入日期/修改日期、入库数量、出库数量、结存、注释；注释统一为“单号、类别、PO/PI、关联单号”，不拼备注；不显示单价、金额，不走 `price` 权限；导出权限为 `inventory/analysis/flow-ledger:export`。 |
## 生产领用统计表（汇总）· 生产管理（第一期补充）

| 业务功能 | 物理表 | 关键字段 / 说明 |
|----------|--------|-----------------|
| PI 范围 | `UB_ERP_Sales_order` | `GET /api/production-issue-stats/report?viewMode=summary`；只取 `pass=1/del=0` 销售订单；销售订单日期 `xsaj02` 在开始日期 00:00:00 到结束日期 23:59:59；手填多个 PI 时按 `xsaj01 IN (...)` 过滤。 |
| 预算数量 | `UB_ERP_Bom_pi_cost` + `UB_ERP_Sales_order_list` | 按 `sid=PI`、`xsak01=sid`、`pi_cost.pq=sales_order_list.kcaa01` 关联；预算数量为 `SUM(pi_cost.kcac06 * sales_order_list.xsak03)`；结果以预算材料为主表，即预算有但未领用也显示。 |
| 领用数量 | `UB_ERP_Stocks_out` + `UB_ERP_Stocks_out_list` | 主从 `l.kcaq01=h.kcap01`；出库类别 `kcap03 in (2,4,7,8)`；主表 `del=0`，明细 `del=0`；审核状态包含已审和未审：`h.pass in (0,1)`；仓库 `h.kcap06=当前仓库`；日期按 `h.kcap02`；PI 字段 `h.kcap08 like 'PI%'` 且在当前 PI 范围内；物料编码按 `l.kcaa01` 前缀过滤。 |
| 退料数量 | `UB_ERP_Stocks_Storage` + `UB_ERP_Stocks_Storage_list` | 主从 `l.kcao01=h.kcan01`；入库类别 `kcan03 in (3,5)`；主表 `del=0/pass=1`，明细 `del=0`；仓库 `h.kcan06=当前仓库`；退料匹配 `h.kcan04=PI`、`l.kcaa01=物料编码`；第一期按旧系统口径不加退料日期范围。 |
| 展示与计算 | 同上 | 每个 PI 单独一张表；列为序号、编码、名称、规格、单位、预算数量、领用数量、退料数量、实领数量、未领数量、备注；实领=`领用-退料`；未领=`预算-领用-退料`，不是 `预算-实领`；预算为 0 时未领显示 0；备注来自出库明细 `Describe`，多个备注用分号展示。 |
