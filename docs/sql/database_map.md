# 数据库业务映射（L3）

> 单源：表/字段与页面功能的映射关系。页面交互细节见各模块 README。

## PI追溯

| 业务功能 | 物理表 | 关键字段 / 说明 |
|----------|--------|-----------------|
| PI正向追溯 | `UB_ERP_Bom_Sales` + `UB_ERP_Bom_Sales_list` + `UB_ERP_Sales_order_list` + `UB_ERP_Buy_order`/`_list` + `UB_ERP_assist_order`/`_list` + `UB_ERP_Dispatch_order`/`_list` + `UB_ERP_Stocks_Storage`/`_list` + `UB_ERP_Stocks_out`/`_list` | `GET /api/traceability/pi-trace/forward`：`Bom_Sales.sid=PI`（可选 `kcaa01`）；BOM 树首层 `list.kcac01=头.GUID`，下级 `kcac01=上级.kcac02`，`del=0`；CUT- 节点展示但不计入结构用量合计；PI 头领料/成品出库汇总不加 `pass`，入库要 `pass=1`；物料级成品出库明细要 `pass=1`。权限 `traceability/pi-trace:view`。 |
| PI反向追溯 | `UB_ERP_Bom_Sales_list` + `UB_ERP_Sales_order` + `UB_ERP_Sales_order_list` + `UB_ERP_Bom_pi_cost` +（可选）`UB_ERP_Bom_pi_consumption` | `GET .../reverse/list`：`del=0 pass=1` 关键字模糊，`id desc` 分页；`GET .../reverse/detail`：父行 `kcac02=子.kcac01` 且 `del=0`（不限 pass）递归至规格含 `PQ-`；销售主/明细 `pass=1 del=0`；日期筛 `xsaj02`；物料用量读 consumption（表/列探测），计价用量 `SUM(pi_cost.kcac06)` 不乘销售数量。 |

## 海关单

| 业务功能 | 物理表 | 关键字段 / 说明 |
|----------|--------|-----------------|
| 海关单预览匹配 | `UB_ERP_Sales_order`/`_list` + `UB_ERP_Dispatch_order`/`_list` + `UB_ERP_Stocks_Storage`/`_list` + `UB_ERP_Stocks_out`/`_list` + `UB_ERP_Stocks_workshop` + `UB_ERP_Stocks_Warehouse` | `POST /api/customs-declaration/preview`：Excel 行拼 `厂款号/颜色`（客款号 OUT 开头则为 `厂款号/颜色-OUT`）→`kcaa01`；销售明细定正式 PI；包装部已审未结案派工明细精确含编码定派工；精确失败时若该 PI 下包装部仅 1 条明细且厂款（去连字符互相包含）/颜色段全等则放宽命中真实编码；入库拆单键=正式 PI+入库日+派工单号；出库拆单键=正式 PI+出货日+派工单号；出库另校验销售明细唯一、`xsak03-xsak06` 可出余量、成品仓实际库存；入库日默认出货日−3 天。权限 `supply-chain/daily/customs-declaration:view`。 |
| 海关单生成生产入库 | `UB_ERP_Stocks_Storage` + `UB_ERP_Stocks_Storage_list` | `POST /api/customs-declaration/generate`：逐组调用 `createStockIn`；`kcan03=4`、车间包装部、仓成品仓、`kcan08`=正式 PI、备注含报关单号；保存自动审核。权限海关单 `add` + 入库单 `add`。 |
| 海关单生成成品出库 | `UB_ERP_Sales_order`/`_list` + `UB_ERP_Stocks_out`/`_list` | `POST /api/customs-declaration/generate-outbound`：逐组 `createStockOut`（`kcap03=6`、仓成品仓、`kcap04`=正式 PI、`in_tax=2`）；明细 `kcaq03`=截断入库量、`kcaq04`/`kcaq08`=申报单价、`Reference`=报关单号、`Describe`=报关单型号、`kcaq02`=销售明细键；保存后 `applyStockOutLifecycleAction` 自动审核。权限海关单 `add` + 出库单 `add`。 |

## BOM资料

| 业务功能 | 物理表 | 关键字段 / 说明 |
|----------|--------|-----------------|
| BOM主页分页列表 | `UB_ERP_Bom_000` + `UB_ERP_Bom_code` + `UB_ERP_Bom_cost` + `New_UB_ERP_Stocks_material` + `UB_ERP_Stocks_workshop` | `GET /api/inv/bom/list`；主列表来自 BOM 主档，按 `del/pass`、BOM分类前缀、裁片开关、关键词过滤；“需要运算”按 `UB_ERP_Bom_code.copen=1` 且 `flag5` 前缀判断；“已运算/未运算”和成本用量列复用当前页 `UB_ERP_Bom_cost` 的 `sid + pq` 汇总结果，避免列表主查询逐行重复查成本表。 |
| BOM转向物料查询 | `UB_ERP_Bom_Sales_list` + `UB_ERP_Bom_code` + `New_UB_ERP_Stocks_material` + `UB_ERP_Stocks_colorcode` + `UB_ERP_Finance_currency` + `UB_ERP_Sales_order` + `UB_ERP_Sales_order_list` + `UB_ERP_Bom_pi_cost` | `GET /api/inv/bom/material-trace/list` 查 `UB_ERP_Bom_Sales_list` 已审核未删除行，默认 `id desc`，分类按 `UB_ERP_Bom_code.flag5` 前缀过滤 `kcaa01`，关键字只搜高频字段；关键词搜索走快速分页，只取当前页所需行数+1，不计算精确总数，前端隐藏「共 N 条」并提示快速搜索；完整编码类关键词先按 `kcaa01/kcac01/kcac02` 精确查找，精确无结果才回落到多字段模糊搜；非关键词/查询全部仍保留精确总数。`GET /api/inv/bom/material-trace/:id/usage` 用当前行 `kcac01` 向上追 `kcac02` 最多三层找到 `PQ-` 成品（向上追溯 `UB_ERP_Bom_Sales_list` 仅按 `del=0`，不限 `pass`；上级/成品行常为 `pass=0`），找到成品后立即停止继续追溯，再按 `UB_ERP_Sales_order_list.kcaa01=成品款号` 关联已审核销售订单（主/明细 `pass=1`、`del=0`），计价用量为 `xsak03 * SUM(UB_ERP_Bom_pi_cost.kcac06)`；新系统不查 `UB_ERP_Bom_pi_consumption`。性能：`PQ3671B1/BO` 搜索约 2.56s→0.10s；`TAG-PQ2818B1/N` 搜索由 >30s 降到约 0.31s；展开模拟约 3.21s→1.69s；`kcac02` 目前无索引，进一步提速需单独确认 DDL。 |
| BOM MOQ查询 | `UB_ERP_Bom_pi_cost` + `UB_ERP_Sales_order_list` + `UB_ERP_Sales_order` + `UB_ERP_Stocks_colorcode` + `UB_ERP_Buy_order` + `UB_ERP_Buy_order_list` | `GET /api/inv/bom/moq/list`；输入编码必填，按 `pi_cost.kcaa01=@code OR pi_cost.kcaa11=@code` 精确匹配，且仅统计 `del=0`、`isok=1`。默认 `showAll=0` 时会过滤 `sid` 后缀 `-DECR/-CP`；`showAll=1` 显示全部。先按 `sid+pq+kcaa01+temp+kcaa11` 汇总 `SUM(kcac06)`，再批量准备销售单、颜色、当前 PI 采购价和最近采购价后组装结果，避免逐行重复查采购单。单价优先当前 PI 对应采购价（`bo.kcaj04=sid`），无则回退该物料最近采购价；金额=`totalUsage × 有效单价`。结果按 `sid desc` 分页，默认 10 条/页，底部返回全量结果的「总用量合计、金额合计」。 |
| BOM配件明细搭配 | `UB_ERP_Bom_parts` | `GET/PUT /api/inventory/bom/parts/:systemcode`：界面「搭配」列读写 `Describe`（`nvarchar(100)`）；「说明/备注」仍为 `remark`；搭配列在说明/备注左侧；一键运算树已读 `Describe` 写入成本用量表。 |
| PI_BOM资料查看基础资料 | `UB_ERP_Bom_Sales` + `New_UB_ERP_Stocks_material` + `UB_ERP_Stocks_colorcode` + `UB_ERP_Stocks_workshop` + `UB_ERP_System_supplier` | `GET /api/inventory/pi-bom-data/detail` 的 `basic`：按 `sid=PI`、`kcaa01=成品编码` 取主档；JOIN 分类名/颜色名/车间名/供应商名；衍生客供、采购/外协/自产勾选、保税、小数点配置、转换方式等；前端复用 BOM 同款 `BomBasicForm`（readonly）1:1 展示，PI号仅在独立窗标题。 |
| PI_BOM物料批量替换 | `UB_ERP_Bom_Sales_list` + `UB_ERP_Bom_000` + `UB_ERP_Sales_order` | `POST /api/inventory/pi-bom-data/replace-material`：body 须带与 ERP 内核共用的核心密钥 `key`（校验 `ERP_CORE_CONFIG_KEY`）；只读 `Bom_000` 取目标物料，更新 `Bom_Sales_list` 匹配行（`sid`+源 `kcaa01`，可选 `pkcaa01`；`Describe` 精确匹配，留空只命中搭配为空的行）；同步物料快照列；不改树键/用量/`Describe`/主档/`pi_cost`；支持 `dryRun:true` 预检；执行后销售订单标未运算。操作日志不记录核心密钥。 |

## 入库单 · 生产入库批量添加

| 业务功能 | 物理表 | 关键字段 / 说明 |
|----------|--------|-----------------|
| 派工单主表校验 | `UB_ERP_Dispatch_order` | `scaj01` 派工单号；`scaj05` 生产车间编码；`pass=1` 已审核；`del=0` 未删；`closed=0` 未结案 |
| 派工单明细来源 | `UB_ERP_Dispatch_order_list` | `scak01` 派工单号；`scak02` 明细唯一键（写入入库明细 `kcao02`）；`scak03` 派工数量 |
| 单位换算补全 | `UB_ERP_Bom_000` | 明细缺 `kcaa26/kcaa27` 时按 `kcaa01` 联 BOM 补全 |
| 物料浮动率 | `New_UB_ERP_Stocks_material` | `stocks_in` → 可入上限 `kcao031 = tempx + tempx × 浮动率` |
| 已入/未审入库汇总 | `UB_ERP_Stocks_Storage` + `UB_ERP_Stocks_Storage_list` | `kcan03=4`（生产入库）；`kcan04=scak01`；明细 `kcao02=scak02`；按 `pass` 分已审/未审 |
| 返工出库展示 | `UB_ERP_Stocks_out` + `UB_ERP_Stocks_out_list` | 关联 `kcan04/kcap04=派工单号`；明细 `kcao02=scak02`；**仅展示，不参与 tempx** |
| 入库明细落库 | `UB_ERP_Stocks_Storage_list` | `kcao02=scak02`；生产入库 `kcao04/kcao041/kcao05/kcao051=0`；`Customer_supply` 整型 |

## 入库单 · 生产退料批量添加

| 业务功能 | 物理表 | 关键字段 / 说明 |
|----------|--------|-----------------|
| 接口 | — | `GET /api/stock-in/production-batch-lines?inboundType=5`；`dispatchSystemcode`、`warehouseCode`、`piNo` 必填；支持 `fetchAll=1` |
| 派工单主表校验 | `UB_ERP_Dispatch_order` | 按 `systemcode` + `scaj05=车间` 查 `del=0/pass=1/closed=0`，并与 `scaj01=派工单号` 交叉校验；失败「数据不存在,请联系IT部检查!」 |
| 子料来源 | `UB_ERP_Dispatch_order_list` + `UB_ERP_Bom_pi_cost`；开料部另读 `New_UB_ERP_Stocks_material.cutting_issue` | 非开料部：派工明细要求 `scak02=GUID`；按 `sid=PI` 且 `(top_kcaa01=派工物料 OR pq=派工物料)` 展开实际领料子料；同子料 `kcaa01` 合并显示。开料部（车间 `04`）：复用出库生产领料的 PI 裁片来源，`sid=PI` 且 CUT 裁片且 `kcaa05` 命中 `cutting_issue=1`，来源键为 `CUT|材料编码` |
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
| 盘盈选材 | `UB_ERP_Bom_000` + `New_UB_ERP_Stocks_material` | `GET /api/stock-in/surplus-batch-lines`；只过滤物料主档 `del=0` 且 `kcaa01` 不为空；按 `kcaa01~kcaa35`、`systemcode`、`location`、`kcaa02_en`、`kpname` 等字段模糊查询；分页用 `ROW_NUMBER()`；不按当前库存是否大于 0 限制 |
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
| 入库标签扫码物料信息 | `UB_ERP_Stocks_Storage` + `UB_ERP_Stocks_Storage_list` + `UB_ERP_Bom_000` + `UB_ERP_Stocks_colorcode` + `New_UB_ERP_Stocks_material` + `UB_ERP_Buy_order` + `UB_ERP_Buy_order_list` + `UB_ERP_Stocks_out` + `UB_ERP_Stocks_out_list` | `GET /api/stock-in/material-qr-info?action=stocks&kcaa01=&kcao01=`；前端路由 `/stock-in/material-qr-info` 与旧入口 `/view.asp` 均免登录只读；按入库单号 `kcao01` + 物料编码 `kcaa01` 读取入库明细，展示物料快照/BOM 主档、颜色名、材料分类、货仓/板房实时库存、最近采购和最近入库；库存只统计已审核且未删除的入库/出库；页脚开发人显示“廖越锋” |
| 入库转向物料查询 | `UB_ERP_Stocks_Storage_list` + `UB_ERP_Stocks_Storage` | `GET /api/stock-in/material-trace/list`；页内切换 `pageMode=material-trace`；明细 `l.kcao01=h.kcan01` 回查主表，主从表均要求 `del=0/pass=1`；分页用 `ROW_NUMBER()`；关键字性能优先，仅直比模糊高频字段（入库单号、关联单号、物料编码、名称、规格、颜色、PO/PI、备注、供应商/外协商、仓库等）；价格列由前端入库单 `price` 权限控制；只读 |

## 派工单 · 批量选货与可派工余量

| 业务功能 | 物理表 | 关键字段 / 说明 |
|----------|--------|-----------------|
| 销售订单来源 | `UB_ERP_Sales_order` + `UB_ERP_Sales_order_list` | `xsak03` 销售数量；主表 `pass=1`、`del=0`、`closed=0` |
| 销售订单运算状态 | `UB_ERP_Sales_order` + `UB_ERP_Bom_pi_cost` | 销售订单列表、详情、物料单入口、PI-BOM资料首页统一按 `UB_ERP_Bom_pi_cost.sid = xsaj01` 且 `isok=1` 判断；存在有效行显示已运算，否则显示未运算。主表 `isok/is_pur/sign` 不再作为显示状态主判断。`POST /api/sales-order/:id/calculate` 一键运算含散件时同请求自动写散件自用量（纯散件单亦走该接口）。`POST /api/sales-order/:id/sync-bom` / `sync-bom-batch` 只按点选 `kcaa01` 覆盖该款 PI BOM 并写 `is_pur=0`，**不删** pi_cost；批量接口服务端并发 3；`PUT /api/sales-order/:id` 若 body 带非空 `syncedKcaa01`（本会话同步过），则 `DELETE` 该 PI 下全部 `UB_ERP_Bom_pi_cost`（`sid=PI`）并标未运算。 |
| 物料单颜色与搭配展示 | `UB_ERP_Bom_pi_cost` + `UB_ERP_Stocks_colorcode` + `UB_ERP_Sales_order` + `UB_ERP_Sales_order_list` | `GET /api/sales-order/:id/material-bill`：颜色取 `pi_cost.kcaa11`，LEFT JOIN `UB_ERP_Stocks_colorcode`（`code=kcaa11`）取 `name`，接口返回展示串「编码,中文名」（无名称则仅编码）；搭配优先 `bnfo`（历史库兼容 `binfo`）再回退 `Describe`；汇总按“编码 + 搭配”合并时，颜色展示串去重后用分号 `;` 拼接。 |
| 物料单外协清单报表 | `UB_ERP_Sales_order` + `UB_ERP_Sales_order_list` + `UB_ERP_Bom_pi_cost` + `UB_ERP_Stocks_colorcode` + `UB_ERP_Bom_Sales_list` | `GET /api/production/material-sheet/outsourcing-list`：主表 `del=0/pass=1`、未结案（`Closed` 空/0），日期 `xsaj02` 落在起止日；可选 `xsaj01`=PI、`xsaj06`=PO。明细厂款号用 `kcaa01` 匹配 `pi_cost.pq`；材料仅 `pi_cost.kcaa13=1` 且 `isok=1`，按编码+颜色+名称+规格合并 `SUM(kcac06)`，合计=`合并用量×xsak03`；颜色 JOIN `UB_ERP_Stocks_colorcode`。位置/裁片皮名：同 PI+厂款下 `Bom_Sales_list` 的 `CUT-` 行，清洗「主皮色/主皮/副皮色/副皮」后模糊匹配材料名/规格，下级按 `kcac01=cut.systemcode` 取描述+编码。只读，非外协订单。 |
| 物料单位置裁片清单报表 | `UB_ERP_Sales_order` + `UB_ERP_Sales_order_list` + `UB_ERP_Bom_pi_cost` + `UB_ERP_Stocks_colorcode` + `UB_ERP_Bom_Sales_list` | `GET /api/production/material-sheet/cut-position-list`：销售单筛选同外协清单。厂款号=`list.kcaa01` 对 `pi_cost.pq`。Part1：`pi_cost` 且 `isok=1`（**不限** `kcaa13`），合并与 CUT 匹配同外协清单。Part2：`Bom_Sales_list` 中 `sid=明细.xsak01` 且 `kcac01=明细.xsak02` 且 `kcaa13=1`/`del=0`，按 `seq` 追加，单位=`kcaa04`、单用量=`kcac04`、合计=`kcac04×xsak03`，位置/皮名固定 `-`；两段不去重；厂款 `materialsTotalQty`=全部行合计之和。只读。 |
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

## 外协订单 · 转向物料查询（search_wl 口径）

| 业务功能 | 物理表 | 关键字段 / 说明 |
|----------|--------|-----------------|
| 分类下拉来源 | `UB_ERP_Bom_code` | `copen=1`；按 `px,id` 排序；展示 `flag1`；前缀优先取 `flag5`，空值时按分类名兼容映射（成品→`PQ-`、主袋→`BAG-`、裁片→`CUT-`、拉牌/吊牌→`TAG-`、肩带→`STRAP-`） |
| 转向查询主数据 | `UB_ERP_assist_order_list` | 仅查明细 `pass=1` 且 `del=0`；关键字模糊匹配单号/数量单价金额/税点/PI/备注/`kcaa01~35` 及扩展物料字段 |
| 外协头补充信息 | `UB_ERP_assist_order` | `wxaj01=wxak01` 回填外协类型、时间、外协商、含税、币别、交货日期、主表备注；返回 `headerId` 供查看 |
| 管理列表操作记录 | `UB_ERP_assist_order` | `GET /api/assist-order/list` 主表末列；添加=`addtime`+`utruename`（空回退 `uname`），修改=`edittime`+`uptruename`（空回退 `upname`）；展示文案「添加时间:…,操作者：… / 修改时间:…,操作者：…」 |
| 管理列表操作人筛选 | `UB_ERP_assist_order` | `GET /api/assist-order/list` 默认由服务端从登录态取得账号，精确过滤 `uname=@operatorAccount`；`showAll=1` 时取消该条件。前端不能指定其它账号；该条件同时作用于正常列表、未审核列表和回收站。 |
| 入库数量聚合 | `UB_ERP_Stocks_Storage` + `UB_ERP_Stocks_Storage_list` | 外协入库 `kcan03=2`；主/明细 `del=0`、主表 `pass=1`；按 `kcan04=外协单号` + `kcaa01` 汇总 `kcao03` |
| 出库数量聚合 | `UB_ERP_Stocks_out` + `UB_ERP_Stocks_out_list` | 外协领料出库 `kcap03=2`；主/明细 `del=0`、主表 `pass=1`；按 `kcap04=外协单号` + `kcaa01` 汇总 `kcaq03` |
| 订单外协批量添加数量 | `UB_ERP_assist_order` + `_list` + `UB_ERP_Bom_000` + `UB_ERP_Bom_parts` + `UB_ERP_Stocks_out` + `_list` | `GET /api/assist-order/batch-add-tree`（`assistType=1`）；已外协=`SUM(wxak03)`，键 `pi + pq(空则 Product) + kcaa01`；已外协出库=同键外协单下，父件 Bom_parts 直接子料（无子层回退父件）的 `SUM(kcaq03)`（`kcap03=2`，主从 `del=0`，含未审）；编辑可传 `excludeOrderNo`；出库列只读展示，不扣可入数量 |
| 接口 | — | `GET /api/assist-order/material-trace/bom-codes`（分类）；`GET /api/assist-order/material-trace/list`（分页 `page/pageSize`，默认 10；`all=1` 查询全部） |

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
| 其他出库批量选材 | `UB_ERP_Stocks_Storage` + `UB_ERP_Stocks_Storage_list` + `UB_ERP_Stocks_out` + `UB_ERP_Stocks_out_list` + `UB_ERP_Bom_000` | 按仓库 `kcan06/kcap06` + 物料 `kcaa01` 分组；账存=已审入库−已审出库；实际=账存−未审出库；价格取本仓最近 `pass=1` 且主表 `sp_flag=1` 入库明细；**关键字仅 `kcaa01`（materialCode）模糊** |
| 盘亏出库批量选材（类型 `9`） | 复用「其他出库批量选材」相关表 | 关联单号 `kcap04` 可手填或为空；点击批量添加走 `other-batch-lines` / `other-batch-prices`；仅实际库存（账存−未审）`>0` 可选；保存主表 `kcap03=9`、明细写 `UB_ERP_Stocks_out_list`；审核参与库存扣减但**不回写**采购/外协/生产/销售来源表 |
| 销售出库批量选材（类型 `10`） | 复用「其他出库批量选材」相关表 | 基础资料 `kcap04` 允许自由填写或为空；点击批量添加始终走 `other-batch-lines`/`other-batch-prices` 普通库存选材，按当前仓库实际库存出库；不走销售订单来源、不回写 `UB_ERP_Sales_order_list` |
| 采购退货关联采购单选择 | `UB_ERP_Buy_order` + `UB_ERP_Buy_order_list` | 仅显示主表 `del=0/pass=1/closed=0` 与明细 `del=0/pass=1`；按采购单分组首行显示「关联选择」；回填 `kcap04←kcaj01`、`kcap05/kehu←kcaj05/kehu`、前端隐藏 `sourceSystemcodeId←systemcode` |
| 生产领料关联派工单选择 | `UB_ERP_Dispatch_order` + `UB_ERP_Dispatch_order_list` + `UB_ERP_Stocks_out` + `UB_ERP_Stocks_workshop` | `GET /api/stock-out/production-dispatch-source-page`；主表 `del=0/pass=1/closed=0` 且 `scaj05=车间`；明细 `scak02=GUID`；排序 `scaj01` 倒序；关联出库单号按 `kcap04=派工单号` 聚合；回填 `kcap04←scaj01`、`kcap08←scaj04`（PI）、`kcap05/kehu←车间`、`sourceSystemcodeId←systemcode`（前端暂存，不入主表） |
| 成品出库关联销售订单选择 | `UB_ERP_Sales_order` + `UB_ERP_Sales_order_list`（主从展开；已出完也可选） | `GET /api/stock-out/finished-goods-source-page`；**主从展开**一行一明细；列表 `sourceOrderNo/kcaa01/orderQty/customerStyleNo/factoryStyleNo/orderDate/deliveryDate/groupRowNo` 及回填字段 `poNo/customerCode/customerName/sourceSystemcode`；弹窗列顺序：操作、PI号、货品编码、数量、客款号、厂款号、销售日期、交货日期；数量=`xsak03`（空回退 `plan_quantity`）、客款号=`kcaa06`、厂款号=`kcaa09`；PI 进列表靠 `INNER JOIN` 有效明细（`del=0/pass=1`、`xsak02=GUID`），**不要求** `xsak03-xsak06>0`；保存来源校验同口径；关键字含主表与明细 `kcaa01~03`；主表 `closed=0/del=0/pass=1`；回填 `kcap04←xsaj01`、`kcap08←xsaj06`、`kcap05/kehu←xsaj05/kehu`、`sourceSystemcodeId←systemcode` |
| 成品出库批量添加 | `UB_ERP_Sales_order` + `UB_ERP_Sales_order_list` + `UB_ERP_Finance_currency` + `UB_ERP_Stocks_Storage` + `UB_ERP_Stocks_Storage_list` + `UB_ERP_Stocks_out` + `UB_ERP_Stocks_out_list` | `GET /api/stock-out/finished-goods-batch-lines`；主表校验 `xsaj01/xsaj05/systemcode`；明细 `xsak01=订单`；可出货=`换算(xsak03)−已审出(按kcaa01)−未审出(按kcaq02=xsak02)`；库存按仓+子料；选行 `kcaq02←xsak02/systemcode`；**不带单价**；**关键字仅 `kcaa01` 模糊**；独立页 `/inventory/daily/stock-out-finished-goods-batch-window` |
| 生产领料批量添加 | `UB_ERP_Dispatch_order_list` + `UB_ERP_Bom_pi_cost` + `UB_ERP_Bom_000` + `New_UB_ERP_Stocks_material` + `UB_ERP_Stocks_Storage` + `UB_ERP_Stocks_Storage_list` + `UB_ERP_Stocks_out` + `UB_ERP_Stocks_out_list` + `UB_ERP_Buy_order` + `UB_ERP_Buy_order_list` | `GET /api/stock-out/production-issue-batch-lines`；**非开料部**：派工明细 `scak02=GUID` 经 pi_cost 展开（`sid=PI`、`isok=1`、`top_kcaa01` 或 `pq` 命中派工物料）；列表需出库=`SUM(kcac06×scak03)`；`Describe←Bom_000.kcaa02`；**开料部（车间 04）**：不走派工展开；`sid=PI` 且 CUT 裁片且 `kcaa05` 命中 `cutting_issue=1`；列表需出库=`SUM(kcac06×temp)`（裁片子集）；**PI共用池总量** `piDemandQty`=`ROUND(SUM(kcac06×ISNULL(temp,1)),3)`（`pi_cost.sid=PI、isok=1、kcaa01=子料`，全PI不按车间/派工）；**PI已出** `piIssuedQty`=`SUM(kcaq03)`（`kcap08=PI、kcaa01=子料、h.del=0`，不按车间/派工/仓库/pass）；**还需出库**=`min(派工剩余,PI剩余)`，派工剩余=需出库−本派工(`kcap03=4,kcap04`)+本仓+子料已审/未审；默认可领=`min(还需出库,实际库存)`；批量窗口 `sourceLineCode` 仅作去重；**落库 `kcaq02` 按子料 `kcaa01` 写 BOM.systemcode**；配置 `GET/PUT /api/stock-out/cutting-issue-config`；列表按子料 `kcaa01` 合并；**关键字仅子料 `kcaa01` 模糊** |
| 生产领料（计划外）类型 `7` | `UB_ERP_Stocks_out` + `UB_ERP_Dispatch_order`（选派工，选填）+ 复用上表或「其他出库批量选材」 | **强制** `kcap05` 生产车间、`kcap06` 仓库、`in_tax`；`kcap04` 派工单**选填**；有派工时 `kcap08←PI`，无派工时 `kcap08←纸质单号`；有派工批量走 `production-issue-batch-lines`，无派工走 `other-batch-lines`/`other-batch-prices`；**审核不回写** `scak04`；无派工来源明细 `kcaq02←BOM.systemcode` |
| 开料出库配置 | `New_UB_ERP_Stocks_material` | `GET/PUT /api/stock-out/cutting-issue-config`；字段 `cutting_issue`（`1`=纳入开料部批量）；仅超级管理员可 PUT；迁移见 `scripts/migrations/sqlserver_stock_out_cutting_issue_flag.txt` |
| 采购退货批量添加筛选 | `UB_ERP_Buy_order` + `UB_ERP_Buy_order_list` + `UB_ERP_Stocks_Storage` + `UB_ERP_Stocks_Storage_list` + `UB_ERP_Stocks_out` + `UB_ERP_Stocks_out_list` | 条件：`kcap04`+`kcap05`+`kcap06`；明细键 `kcak02`；采购可退池=本仓已审采购入库（`kcan03=1,kcan04,kcao02,kcan06`）−已审/未审退货出库（`kcap03=1,kcap04,kcaq02,kcap06`）；当前可退=`min(采购可退池, 仓库实际库存)`；选行 `kcaq02←kcak02`；**关键字仅 `kcaa01` 模糊**；独立页 `/inventory/daily/stock-out-purchase-return-batch-window` |
| 接口 | — | `GET /api/stock-out/other-batch-lines`；`POST /api/stock-out/other-batch-prices`；独立页 `/inventory/daily/stock-out-other-batch-window` |
| 采购退货新接口 | — | `GET /api/stock-out/purchase-return-source-page`；`GET /api/stock-out/purchase-return-batch-lines`；独立页 `/inventory/daily/stock-out-purchase-return-batch-window` |
| 出库单 · 生产领料（补数）类型 `8` | `UB_ERP_Stocks_out` + `UB_ERP_Dispatch_order`（选派工，选填）+ 复用生产领料批量或其他出库批量 | **强制** `kcap05` 生产车间、`kcap06` 仓库、`in_tax`；`kcap04` 派工单**选填**；有关联派工时 `kcap08←PI`、前端 `systemcode_id←UB_ERP_Dispatch_order.systemcode`，批量走 `production-issue-batch-lines`；无派工时 `kcap08←纸质单号`，批量走 `other-batch-lines`/`other-batch-prices`；**审核不回写** `scak04/scak05`。 |

## 系统管理 · 角色与权限

| 业务功能 | 物理表 | 关键字段 / 说明 |
|----------|--------|-----------------|
| 角色管理 | `New_UB_ERP_System_role` | `GET/POST/PUT/DELETE /api/roles` 只读取和维护新系统角色表；列表按 `pass`、`del` 与 `Status` 切换启用/回收站视图，角色名称、说明及 `Permissions` 均以此表为准。新 ERP 严禁回退、读取或写入旧系统角色表 `UB_ERP_System_role`，两套 ERP 的角色数据彼此独立。 |
| 操作员、登录与权限 | `New_UB_ERP_User` + `New_UB_ERP_System_role` | `New_UB_ERP_User.RoleID` 按 `RoleID` 关联新角色表，登录返回 `RoleName`、`Permissions` 与 `truename`（库列 `New_UB_ERP_User.truename`，供装饰首页欢迎语）；路由、菜单、按钮和接口权限统一使用 `New_UB_ERP_System_role.Permissions`。登录后默认落点 `/home`（侧栏隐藏、不进标签）。新表须具备当前角色模块使用的 `RoleID/RoleName/Description/pass/del/Status/Permissions` 等字段，且 `RoleID` 与用户表的关联数据一致。 |
| 操作审计与数据库配置 | `New_UB_ERP_System_role` | 角色新增、修改、删除、恢复、权限保存由中央白名单日志写入 `UB_Date_ERP_Operation_log`，目标表 `code=New_UB_ERP_System_role`；系统数据库配置的“系统角色权限表”登记新表名。`Sys_Roles` 是独立兼容表，本模块不使用。 |

## 全局操作日志

| 业务功能 | 物理表 | 关键字段 / 说明 |
|----------|--------|-----------------|
| 正式操作日志 | `UB_Date_ERP_Operation_log` | 全项目采用“业务事务日志 + 中央白名单补漏”；策略由 `server/action_map.js` 分类为 `business`、`central`、`ignore`，中央中间件只记录成功的已登记写接口，未知写接口不自动记录并由覆盖测试拦截。 |
| 日志公共字段 | `UB_Date_ERP_Operation_log` | `act_name/act_info/uname/utruename/code/systemcode/ip/addtime`；`code` 写实际业务主表，`systemcode` 可可靠取得时写入；`act_info` 仅保留可读中文业务摘要，不保存完整请求 JSON、密码、核心密钥、邮件密码、Token 或上传内容。 |
| 遗留日志表 | `Sys_OperationLogs` | 测试遗留，不再作为正式来源，项目写入和日志页面均使用 `UB_Date_ERP_Operation_log`。 |

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

## 系统内核 · 数据关联

| 业务功能 | 物理表 | 关键字段 / 说明 |
|----------|--------|-----------------|
| 只读数据流目录 | - | 页面 `/system/kernel/data-relations`；接口 `GET /api/system/kernel/data-relations`；目录由后端代码内置，不新增配置表、不查询具体订单数据 |
| 销售订单保存 | `UB_ERP_Sales_order`、`UB_ERP_Sales_order_list`、`UB_ERP_Bom_Sales`、`UB_ERP_Bom_Sales_list` | 订单主从正常保存；PI BOM 仅按新增款、删款做条件性对齐，已有在单款不从主 BOM 自动覆盖 |
| 保存/同步 PI BOM | `UB_ERP_Bom_Sales`、`UB_ERP_Bom_Sales_list`、`UB_ERP_Sales_order` | 保存 PI BOM 只改配件用量字段；同步 BOM 只替换选中款；两者均标未运算，但当下不删除旧 `UB_ERP_Bom_pi_cost` |
| 一键运算 | `UB_ERP_Bom_pi_cost`、`UB_ERP_Bom_pi_consumption`、`UB_ERP_Sales_order` | 只读当前 PI BOM 生成物料结果；汇总表存在时同步重建；散件自用量只写 `pi_cost` |
| 采购订单保存 | `UB_ERP_Buy_order`、`UB_ERP_Buy_order_list`、`UB_ERP_Buy_order_money`、`UB_ERP_Bom_buy_order`、`UB_ERP_Bom_buy_order_list` | 主表新增/更新；采购明细、额外费用和采购 BOM 主从快照按采购单号整批重写；已有采购入库的明细禁止删除或修改数量 |
| 采购订单审核 | `UB_ERP_Buy_order`、`UB_ERP_Buy_order_list` | 校验采购单状态和有效明细后，将主表 `pass` 更新为 `1` |
| 采购订单反审 | `UB_ERP_Buy_order`、`UB_ERP_Bom_buy_order`、`UB_ERP_Buy_order_sp`、`UB_ERP_Stocks_Storage` | 反审原因写 `UB_ERP_Buy_order_sp`，`oid` 取该采购单最新 BOM 快照 id，之后将主表 `pass` 恢复为 `0`；已有采购入库当前不阻止反审 |
| 入库单保存 | `UB_ERP_Stocks_Storage`、`UB_ERP_Stocks_Storage_list`、`UB_ERP_Stocks_Warehouse`、`UB_ERP_Bom_000` | 主表新增/更新，明细整单替换；有有效明细自动写主从 `pass=1`，空明细保存 `pass=0` 草稿；仓库和 BOM 物料快照在保存时校验 |
| 入库单来源校验 | `UB_ERP_Buy_order`、`UB_ERP_assist_order`、`UB_ERP_Dispatch_order`、`UB_ERP_Sales_order` | 按入库类型校验来源头表已审核、未删除、未结案且关联方匹配；保存不反写来源表，来源单号写 `kcan04`，来源明细键写 `kcao02` |
| 入库单审核/反审核 | `UB_ERP_Stocks_Storage`、`UB_ERP_Stocks_Storage_list` | 主从表 `pass` 同步更新；审核要求至少一条未删除、物料编码非空且 `kcao03>0` 的有效明细；已审核且未删除的入库数量才进入库存统计 |
| 入库单复核/反复核 | `UB_ERP_Stocks_Storage`、`UB_ERP_Stocks_Storage_list` | 主从表 `sp_flag` 同步更新；复核锁定单据但不改变 `pass` 和库存数量 |
| 出库单保存 | `UB_ERP_Stocks_out`、`UB_ERP_Stocks_out_list`、`UB_ERP_Stocks_Warehouse`、`UB_ERP_Bom_000` | 主表新增/更新，明细整单替换并固定保存为 `pass=0`；保存阶段不回写来源单据，空明细草稿可保存但不能审核 |
| 出库单审核/反审核 | `UB_ERP_Stocks_out`、`UB_ERP_Stocks_out_list` | 主从表 `pass` 同步更新；审核、反审核和操作日志在同一事务内；审核后才进入正式出库库存统计 |
| 出库来源数量回写 | `UB_ERP_Buy_order_list`、`UB_ERP_assist_order_list`、`UB_ERP_Dispatch_order_list`、`UB_ERP_Sales_order_list` | 按 `kcap03` 类型和明细 `kcaq02` 聚合：审核增加、反审核扣回 `kcak07/wxak08/scak04/scak05/xsak06`；扣回最低为 0；盘亏、其他、计划外和补数等未映射类型不回写 |
| 外协单保存 | `UB_ERP_assist_order`、`UB_ERP_assist_order_list`、`UB_ERP_assist_order_money`、`UB_ERP_Bom_Sales`、`UB_ERP_Bom_Sales_list`、`UB_ERP_Bom_000` | 主表新增/更新，明细和额外费用整单替换；PI 外协优先读取 PI BOM 快照，明细关联键最终取 `UB_ERP_Bom_000.GUID`；不直接生成入库或出库 |
| 外协单审核/反审 | `UB_ERP_assist_order` | 只更新主表 `pass`；当前不检查明细数量、不批量更新明细 `pass`，也不修改已有外协入库或领料出库 |
| 外协单结案/反结案 | `UB_ERP_assist_order` | 只更新主表 `closed`；结案要求已审核，反结案不自动反审；当前主表更新与操作日志未放在同一事务 |
| 派工单保存 | `UB_ERP_Dispatch_order`、`UB_ERP_Dispatch_order_list`、`UB_ERP_Stocks_workshop`、`UB_ERP_Sales_order`、`UB_ERP_Sales_order_list` | 校验车间和销售订单可派数量后保存派工主从表；编辑整单替换明细；未审核派工也占用可派数量；不回写销售订单、不写库存 |
| 派工单审核/反审核 | `UB_ERP_Dispatch_order`、`UB_ERP_Dispatch_order_list` | 主从表 `pass` 同步更新，空明细不能审核；不创建生产领料或生产入库；当前主表、明细和操作日志未放在同一事务 |
| 权限与边界 | - | 读取需要 `system/kernel/erp-core:view`；不是数据库外键图、实时数据追踪或自动 SQL 扫描 |

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
| 报表聚合口径（阶段1） | `UB_ERP_Stocks_Storage` + `UB_ERP_Stocks_Storage_list` + `UB_ERP_Stocks_out` + `UB_ERP_Stocks_out_list` + `UB_ERP_Bom_000` + `New_UB_ERP_Stocks_material` + `UB_ERP_Stocks_colorcode` | `GET /api/stock-stats/report` 采用数据库端批量 CTE：先以入库/出库并集确定基础物料集合，再按 `kcaa01 + 仓库` 一次性汇总已审/未审入出库与最后入/出库日期；BOM 用 `ROW_NUMBER()` 取每个物料最新有效行后统一关联类别与颜色，禁止逐行 N+1 查询与逐行 `TOP 1`。 |
| 报表聚合口径（阶段2） | `UB_ERP_Stocks_Storage` + `UB_ERP_Stocks_Storage_list` + `UB_ERP_Stocks_out` + `UB_ERP_Stocks_out_list` + `UB_ERP_Bom_000` + `New_UB_ERP_Stocks_material` + `UB_ERP_Stocks_colorcode` + `UB_ERP_Buy_order` + `UB_ERP_Buy_order_list` | `GET /api/stock-stats/report` 改为会话临时表分段汇总：`#base` 先确定物料+仓库基础行，`#ai/#ui/#oa` 分别汇总已审入库、未审入库和出库，`#bom` 取最新有效 BOM，`#pp/#pi` 汇总在途采购与采购入库，最后统一关联并套用弹窗筛选。业务口径不变，只解决全仓统计大型 CTE 返回慢的问题。 |
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
| 候选与抬头 | `UB_ERP_Stocks_Warehouse` + `UB_ERP_Bom_000` + `New_UB_ERP_Stocks_material` + `UB_ERP_System_Head` | 仓库候选只取已审核、未删除；材料代码候选来自 BOM 主档；材料分类候选来自 `New_UB_ERP_Stocks_material`；打印抬头复用 `UB_ERP_System_Head`。 |

## 出库统计表 · 出库明细统计（第一期）

| 业务功能 | 物理表 | 关键字段 / 说明 |
|----------|--------|-----------------|
| 报表来源 | `UB_ERP_Stocks_out` + `UB_ERP_Stocks_out_list` | `GET /api/stock-out-stats/report` 按出库明细逐行展示；主从通过 `l.kcaq01 = h.kcap01` 关联；基础条件为主表 `del=0`、明细 `del=0`、出库日期 `kcap02` 在开始日 00:00:00 到结束日 23:59:59；不加 `pass=1`，未审核/反审未审记录保留展示。 |
| 查询字段 | 同上 | 仓库按 `h.kcap06`，全部仓库不限制；出库类别按 `h.kcap03`；材料代码候选显示 `kcaa01`，实际按明细 `systemcode` 精确匹配；材料名称/规格按 `l.kcaa02/l.kcaa03` 模糊；材料分类按 `l.kcaa05` 支持多选；关联单位按 `h.kcap05/h.kehu`。 |
| 展示与总计 | 同上 | 数量取实际出库数量 `l.kcaq03`；出库类别 `4` 显示「生产领料」；单价/金额取 `l.kcaq04/kcaq05/kcaq041/kcaq051`，受 `inventory/analysis/stock-out-stats:price` 控制；备注优先取明细 `Describe`，为空取主表 `remark`；前端不显示仓库分组首行，也不生成仓库小计行，只保留真实明细和底部总计。 |
| 候选与抬头 | `UB_ERP_Stocks_Warehouse` + `UB_ERP_Bom_000` + `New_UB_ERP_Stocks_material` + `UB_ERP_System_Head` | 仓库候选只取已审核、未删除；材料代码候选来自 BOM 主档并返回 `systemcode`；材料分类候选来自 `New_UB_ERP_Stocks_material`；打印抬头复用 `UB_ERP_System_Head`。 |

## 出入库统计表 · 收发流水统计（第一期）

| 业务功能 | 物理表 | 关键字段 / 说明 |
|----------|--------|-----------------|
| 报表来源 | `UB_ERP_Stocks_Storage` + `UB_ERP_Stocks_Storage_list` + `UB_ERP_Stocks_out` + `UB_ERP_Stocks_out_list` | `GET /api/stock-movement-stats/report` 用参数化 `UNION ALL` 合并入库、出库明细，再按日期、方向、单号、明细主键升序展示；不写入 `UB_ERP_Stocks_acc`。 |
| 筛选口径 | 入库 `kcan02/kcan06/kcan03`，出库 `kcap02/kcap06/kcap03` | 主表均要求 `del=0/pass=1`，明细要求 `del=0`；从物料联想列表选择时按两侧明细 `systemcode` 精确匹配，手工填写物料编码时按两侧明细 `kcaa01` 精确匹配；分类按两侧明细 `kcaa05` 多选 OR；收发类别以 `in:类别`、`out:类别` 分方向参数化过滤，避免同编号混淆。 |
| 字段与权限 | 明细物料快照 + `UB_ERP_Stocks_colorcode` | 入库数量/价格取 `kcao03/kcao04/kcao041/kcao05/kcao051`，出库取 `kcaq03/kcaq04/kcaq041/kcaq05/kcaq051`；颜色按 `kcaa11` 关联；价格金额列受 `inventory/analysis/stock-movement-stats:price` 控制，导出受 `export` 控制。 |

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
| 报表来源 | `UB_ERP_Stocks_Storage` + `UB_ERP_Stocks_Storage_list` + `UB_ERP_Stocks_out` + `UB_ERP_Stocks_out_list` + `UB_ERP_Bom_000` + `New_UB_ERP_Stocks_material` + `UB_ERP_Stocks_colorcode` | `GET /api/stock-io-stats/report` 按“仓库 + 物料编码 `kcaa01`”期间汇总；入库 `l.kcao01=h.kcan01`，出库 `l.kcaq01=h.kcap01`；主表要求 `del=0/pass=1`，明细只要求 `del=0`，不按明细 `pass` 过滤；日期按 `>= 开始日 00:00:00` 且 `< 结束日次日 00:00:00`。 |
| 查询字段 | 同上 | 开始日期、结束日期、仓库必填；第一期只支持具体仓库，不支持全部仓库；物料编码按明细 `kcaa01` 精确匹配，物料名称/规格按明细快照模糊，材料分类按明细 `kcaa05` 多选过滤。 |
| 计算字段 | 同上 | 上期结存=开始日前历史已审入库数量-历史已审出库数量；上期单价取开始日前最近有效入库 `kcao04`；本期入库=`kcan03 in (1,2,0,5)` 入库 - `kcap03=1` 出库；本期出库=`kcap03 in (4,0,10,7,2)` 出库 - `kcan03 in (3,4)` 入库；本期补数=`kcap03=8`；本期盈亏=`kcan03=7` 入库 - `kcap03=9` 出库；结存按“上期+入库-出库-补数+盈亏”。 |
| 展示与权限 | 同上 | 展示物料资料、类别、颜色、最后入库/出库时间、各数量/单价/金额和异常提示；价格/金额字段受 `inventory/analysis/stock-io-stats:price` 控制，导出受 `inventory/analysis/stock-io-stats:export` 控制；异常提示包括缺少物料资料、缺少分类/颜色、缺少成本单价、负结存、出库成本无法计算等。 |
| 候选与抬头 | `UB_ERP_Stocks_Warehouse` + `UB_ERP_Bom_000` + `New_UB_ERP_Stocks_material` + `UB_ERP_System_Head` | 物料候选来自 BOM，仅按 `kcaa01` 作为筛选值；打印抬头复用 `UB_ERP_System_Head`。 |

# 采购单打印补充映射（2026-07-02）

| 业务功能 | 物理表 | 关键字段 / 说明 |
|----------|--------|-----------------|
| 采购单打印抬头 | `UB_ERP_System_Head` | `GET /api/buy-order/print-data?p_sum=&print_mx=&print_cn=` 返回 `printConfig.logoSrc` 与 `printConfig.headerHtml/info`；前端按“LOGO 在上、表头内容在下”显示。 |
| 采购单打印内容 | `UB_ERP_Buy_order` + `UB_ERP_Buy_order_list` + `UB_ERP_Buy_order_money` | 打印页“交货地址”固定为 `中山市卓越皮具有限公司`；数量、单价、金额、税点和合计只改变显示格式，按统一数字展示规则去掉尾 0，不改变数据库原值。 |
| 采购单打印签字栏 | 登录态 | “订单编写”只取当前登录态 `truename`；没有 `truename` 时为空，不使用 `utruename` 兜底。 |
## 采购订单情况表 · 销售/采购/外协统计分析（第一期）

| 业务功能 | 物理表 | 关键字段 / 说明 |
|----------|--------|-----------------|
| 报表来源 | `UB_ERP_Buy_order` + `UB_ERP_Buy_order_list` | `GET /api/purchase-order-status/report`；主从按 `h.kcaj01 = l.kcak01`；采购主表 `del=0`、采购明细 `del=0`；采购日期 `kcaj02 >= 开始日 00:00:00` 且 `< 结束日次日 00:00:00`；不强制采购单 `pass=1`，未审核采购单保留显示并在采购单号旁标记“未审”。 |
| 查询字段 | 同上 + `UB_ERP_System_supplier` + `UB_ERP_Bom_000` | 供应商候选来自 `UB_ERP_System_supplier` 已审未删采购/共用供应商，主查询按 `h.kcaj05` 精确筛选；采购单号按 `h.kcaj01` 模糊筛选；材料候选来自 BOM 主档，选择后优先按采购明细 `l.systemcode` 精确筛选，并回填材料编码、名称、规格。 |
| 入库与退货统计 | `UB_ERP_Stocks_Storage` + `UB_ERP_Stocks_Storage_list` + `UB_ERP_Stocks_out` + `UB_ERP_Stocks_out_list` | 已审核入库和未审入库按入库主表 `kcan04=采购单号`、入库明细 `GUID=采购明细 GUID` 汇总 `kcao031`；入库金额按已审核入库含税金额 `kcao051` 汇总；采购退货按出库主表 `del=0/pass=1/kcap03=1/kcap04=采购单号`、出库明细 `kcaa01=采购明细物料编码` 汇总 `kcaq03/kcaq051`；最终入库金额=已审入库含税金额-已审退货含税金额；性能口径为先按当前采购明细形成 `采购单号+GUID`、`采购单号+物料编码` 键集，再收窄入库/退货汇总范围，避免全库汇总。 |
| 展示与权限 | 同上 + `UB_ERP_Stocks_colorcode` | 采购数量按 `kcak03`、`kcaa26`、`kcaa27` 换算到使用单位；差数=换算后采购数量-（已审核入库数量-采购退货数量），入库未审数量只展示不参与差数；颜色通过 `UB_ERP_Stocks_colorcode.code=kcaa11` 取名称；入库金额受 `supply-chain/analysis/order-status:price` 控制，导出受 `export` 控制。 |
## 材料流水账 · 单物料结存流水（第一期）

| 业务功能 | 物理表 | 关键字段 / 说明 |
|----------|--------|-----------------|
| 报表来源 | `UB_ERP_Stocks_Storage` + `UB_ERP_Stocks_Storage_list` + `UB_ERP_Stocks_out` + `UB_ERP_Stocks_out_list` | `GET /api/material-flow-ledger/report` 用 `UNION ALL` 合并入库、出库明细；入库 `l.kcao01=h.kcan01`，出库 `l.kcaq01=h.kcap01`；主表统计 `del=0/pass in (0,1)`，明细只要求 `del=0`；未审单据同样参与期初和逐行结存，且注释前以红色“(未审)”标记；物料按明细 `kcaa01` 精确匹配；仓库分别按 `kcan06/kcap06` 精确匹配；不使用也不写入 `UB_ERP_Stocks_acc`。 |
| 上期结存 | 同上 | 查询开始日期之前：已审入库数量 `l.kcao03` 合计 - 已审出库数量 `l.kcaq03` 合计；第一行固定显示“上期结存”，后端再对区间内流水逐行滚动计算结存。 |
| 查询字段 | 同上 + `UB_ERP_Bom_000` + `New_UB_ERP_Stocks_material` | 必填开始日期、结束日期、仓库、物料编码；仓库默认“货仓”；弹窗不显示物料唯一码；材料分类筛入库/出库明细 `kcaa05`。 |
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
## 历史价格查询 · 销售/采购/外协统计分析（第一期）

| 业务功能 | 物理表 | 关键字段 / 说明 |
|----------|--------|-----------------|
| 基础物料 | `UB_ERP_Bom_000` | `GET /api/history-price-query/report`；基础物料只取 `del=0/pass=1`，物料编码 `kcaa01` 必填并支持模糊查询；展示字段为 `kcaa01/kcaa02/kcaa03/kcaa29/sale_price/kcaa25`。 |
| 报价价格 | `UB_ERP_Buy_offer` + `UB_ERP_Buy_offer_list` | 主从按 `h.cgaa01 = l.cgab01`；主表取 `del=0/pass=1`，明细取 `del=0`；报价日期 `cgaa02 >= 开始日 00:00:00` 且 `< 结束日次日 00:00:00`；供应商按 `h.cgaa04`；物料按 `l.kcaa01`；价格取 `l.cgab04`，税率取 `l.Tax`，币别 `h.rmb`，供应商名称 `h.kehu`，来源单号 `h.cgaa01`。 |
| 采购报价保存与 BOM 快照 | `UB_ERP_Buy_offer` + `UB_ERP_Buy_offer_list` + `UB_ERP_Bom_Buy` + `UB_ERP_Bom_Buy_list` | 新增与编辑保存共用一个事务；报价明细以物料 GUID 区分新增、更新、软删。新增明细复制 BOM 主档快照并新增采购 BOM 根节点与最多四层配件树；已有明细仅改报价字段，不刷新快照；删除明细同步软删根节点和下级树。`UB_ERP_Bom_Buy` 仅保存其实际存在的物料快照字段；`kcac01~kcac08`、用量、损耗、`seq` 只写 `UB_ERP_Bom_Buy_list`。`UB_ERP_Buy_offer_list.Seq` 保留页面提交顺序。 |
| 采购报价 Excel 明细核验 | `UB_ERP_Bom_000` | `POST /api/supply-chain/purchase-quotations/excel-import/materials` 只按提交编码批量读取 BOM 主档，要求在册、已审核、非 `CUT-`，返回物料快照供新增页暂存；不写 `UB_ERP_Buy_offer`、`UB_ERP_Buy_offer_list`、采购 BOM 快照或操作日志。`mq`、`zq` 仅来自 BOM 并只在当前录单页面显示，不向报价及快照表新增字段。 |
| 采购报价按物料查询 | `UB_ERP_Buy_offer` + `UB_ERP_Buy_offer_list` | `GET /api/supply-chain/purchase-quotations/material-query`：空材料编码直接返回空列表、不访问报价数据；仅以明细快照 `kcaa01` 做包含式模糊匹配，按 `l.cgab01=h.cgaa01` 关联；主表、明细均要求 `del=0/pass=1`，逐条返回而不按物料合并。`mq/zq` 仅在物理列存在时选择和展示，不新增字段，不写入任何报价或日志数据。 |
| 采购/外协报价列表展开 | `UB_ERP_Buy_offer_list` / 外协对应明细表 | `GET …/lines/batch`、`GET …/:id/lines` 仅投影展开展示列（主键、`kcaa01~03/05/11`、不含税/含税价、`Tax`、`remark`/`info`），并过滤明细 `del=0`；录单 `GET …/:id` 仍全量明细。 |
| 采购价格 | `UB_ERP_Buy_order` + `UB_ERP_Buy_order_list` | 主从按 `h.kcaj01 = l.kcak01`；主表取 `del=0/pass=1`，明细取 `del=0`；采购日期 `kcaj02 >= 开始日 00:00:00` 且 `< 结束日次日 00:00:00`；供应商按 `h.kcaj05`；物料按 `l.kcaa01`；价格取 `l.kcak04`，税率取 `l.Tax`，币别 `h.rmb`，供应商名称 `h.kehu`，来源单号 `h.kcaj01`。 |
| 展示与性能 | 同上 | 报价和采购用 `UNION ALL` 合并后按物料分组、价格日期倒序展示；第一条为“最近价格”，其余为“历史价格”；含税价格按 `价格 + 价格 * Tax`，`Tax > 1` 时按百分数除以 100；不走单独 `price` 权限，导出受 `supply-chain/analysis/price-query:export` 控制；SQL 先圈定 BOM 物料集合，再批量查报价/采购，禁止逐物料循环查价，不使用全局中间表。 |
## 库存统计表类别多选（2026-07-15）

| 业务功能 | 物理表 | 关键字段 / 说明 |
|---|---|---|
| 类别多选筛选 | `New_UB_ERP_Stocks_material` + `UB_ERP_Stocks_Storage_list` | `GET /api/stock-stats/category-options` 返回已审核、未删除分类，按 `px/code` 排序，支持按分类编码或分类名称模糊搜索，并用 SQL Server 2008 R2 兼容的 `ROW_NUMBER()` 分页（默认每页 10 条）。`GET /api/stock-stats/report` 将多分类编码参数化写入会话临时表 `#selectedCategory`，入库侧按 `l.kcaa05` 精确匹配任意已选分类；不按 BOM `kcaa05` 或类别名称模糊筛选。 |

## 材料备料表 · 库存统计分析

| 业务功能 | 物理表 | 关键字段 / 说明 |
|---|---|---|
| PI 候选 | `UB_ERP_Sales_order` | `GET /api/material-preparation/pi-options`；只取 `del=0/pass=1`，只按 `xsaj01` 模糊查询，SQL Server 2008 R2 `ROW_NUMBER()` 分页，默认每页 10 条。 |
| 物料单备料 | `UB_ERP_Bom_pi_cost` + `UB_ERP_Sales_order_list` | `GET /api/material-preparation/report`；PI 集合参数化写入请求级 `#selectedPi`；只取 `pi_cost.del=0/isok=1/kcaa12=1`；数量=`SUM(kcac06 * temp)`，`temp` 空或非法按 1，不重复乘 `xsak03`。分 PI 模式按材料和 PI 横向汇总；分配件模式按 `PI + pq产品编码 + 材料编码 + top_kcaa02配件名称` 汇总，每个不同 `top_kcaa02` 动态生成数量列，合计为各配件列之和。 |
| 出库单备料 | `UB_ERP_Stocks_out` + `UB_ERP_Stocks_out_list` | 主表 `del=0/pass=1`，明细 `del=0/kcaa12=1`，不限制 `kcap03`；PI 按 `kcap04` 或 `kcap08` 匹配；数量直接汇总 `kcaq03`。先汇总 `PI + 材料` 再关联 BOM 分配比例，避免 BOM 多行放大实际出库。 |
| 类别、颜色和输出 | `New_UB_ERP_Stocks_material` + `UB_ERP_Stocks_colorcode` + `UB_ERP_System_Head` | 分类按 `code=kcaa05`，颜色按 `code=kcaa11`；分配件保留 6 位小数，最后配件承接尾差，无有效配件需求进入“未匹配配件”；打印抬头读取 `UB_ERP_System_Head`；权限为 `inventory/analysis/material-preparation:view/export`。 |

## 供应链 · 供应商资料

| 业务功能 | 物理表 | 关键字段 / 说明 |
|----------|--------|-----------------|
| 供应商管理列表 | `UB_ERP_System_supplier` | `GET /api/supply-chain/suppliers/list`；在册 `del=0/空/NULL`，默认 `pass=1`，可切 `pass=0`；回收站 `del=1`；分页 `ROW_NUMBER()`；排序 `s_code DESC, id ASC`；列表字段含 `s_code/pass/s_name/s_sname/s_sh/s_lb/s_tel/s_fax/s_lxr/s_mobile/s_payfor/s_jh/s_wx_jh/s_bj/intime/sl/kplx/kplxx/kplxxx/s_info` 等；前端默认每页 100 条 |
| 供应商建议编码 | `UB_ERP_System_supplier` | `GET /api/supply-chain/suppliers/suggest-code`；只认 `s_code` 形如 `CN-` + 纯数字（含回收站）；取最大后缀 +1 返回如 `CN-1255`；无号段时 `CN-1` |
| 供应商新增/编辑 | `UB_ERP_System_supplier` | `POST/PUT /api/supply-chain/suppliers`；写入含 `intime`（初始时间，空则新增兜底当天）、`s_bj`（报价时效性天数）、`s_fax` 及主档字段；新增默认 `pass=0`/`del=0`；编辑仅未审在册；前端当前页表单（非弹窗） |

## 已弃用表

| 原用途 | 物理表 | 当前状态 |
|----------|--------|----------|
| 外协订单用户打印偏好 | `UB_ERP_User_print_setup` | 外协订单打印已改为与采购订单一致：每页行数仅影响当前打印页，代码不再读取或写入该表；既有数据可保留，待旧系统和历史查询均不再依赖后再自行弃用或清理。 |

## 供应链 · 销售客户

| 业务功能 | 物理表 | 关键字段 / 说明 |
|----------|--------|-----------------|
| 销售客户管理列表 | `UB_ERP_System_sales_customer` | `GET /api/supply-chain/customers/list`；在册 `del=0/空/NULL`，默认 `pass=1`，可切 `pass=0`；回收站 `del=1`；分页 `ROW_NUMBER()`；列表字段含 `s_code/pass/s_name/s_sh/s_lb/s_address/s_lxr/s_tel/s_mobile/s_fax/s_payfor/lxr/s_business/s_info/intime` 等 |
| 销售客户详情 | `UB_ERP_System_sales_customer` | `GET /api/supply-chain/customers/:id`；不区分 pass/del；含 `intime`/`s_sh`/`s_fax` 等主档字段 |
| 销售客户新增/编辑 | `UB_ERP_System_sales_customer` | `POST/PUT /api/supply-chain/customers`；写入含 `intime`（初始时间，空则新增兜底当天）、`s_sh`（税号）、`s_fax`（传真）及主档字段；新增默认 `pass=0`/`del=0`；编辑仅未审在册；前端当前页表单（非弹窗） |

## 库存基本资料 · 仓库编码

| 业务功能 | 物理表 | 关键字段 / 说明 |
|----------|--------|-----------------|
| 仓库编码列表 | `UB_ERP_Stocks_warehouse` | `GET /api/inventory/warehouse/list`；在册 `del=0`，默认 `pass=1`，可切 `pass=0`；回收站 `del=1`；关键字模糊 `code/name/info/ename`；排序 `code ASC, id ASC`；`ROW_NUMBER()` 分页；列表参管人员姓名由 `ename`（`Usercode` 分号串）批量查 `New_UB_ERP_User`（`del=0 pass=1`）解析。权限 `inventory/basic/warehouse:view`。 |
| 出入库选仓权限 | `UB_ERP_Stocks_warehouse` | `ename` 供入库/出库「仓库」候选与保存校验：登录 `userCode` 须为 `ename` 完整令牌之一；**空 `ename` 任何人不可选**；逻辑 `server/warehouseManagerAccess.js`；接口 `GET /api/stock-in/warehouse-options`、`GET /api/stock-out/warehouse-options` 及对应 SaveService。统计类仓库下拉本期不联动。 |
| 仓库编码详情 | `UB_ERP_Stocks_warehouse` | `GET /api/inventory/warehouse/:systemcode`；定位键 `systemcode`。 |
| 仓库编码新增 | `UB_ERP_Stocks_warehouse` | `POST /api/inventory/warehouse`；后端生成 `systemcode`；`code` **全表唯一**（含 `del=1`）；写入 `name/info2/negative/pd/ks/ename/etname/info` 及审计字段；未传 `logo` 则不写该列（保留库默认 HTML）。默认 `pass=0`/`del=0`。权限 `add`。 |
| 仓库编码修改 | `UB_ERP_Stocks_warehouse` | `PUT /api/inventory/warehouse`；仅未审在册；`code` 不可改；更新 `edittime`/`ip`，**不覆盖 `addtime`**；真表无 `eid/euname/eutruename/uptime` 故不写。未交 `logo` 不改原值。权限 `edit`。 |
| 仓库编码审核 | `UB_ERP_Stocks_warehouse` | `PUT .../audit`、`.../unaudit`、`.../audit-batch`；写 `pass` + `passuid`/`passuname`；批量审全部 `del=0 and pass=0`。权限 `audit`/`unaudit`。 |
| 仓库编码删除/恢复 | `UB_ERP_Stocks_warehouse` | 逻辑删写 `del=1` 及 `delid/delname/deltruename/deltime`（已审禁止）；恢复 `del=0`。不做物理删除。权限 `delete`/`edit`。 |
| 参管人员候选 | `New_UB_ERP_User` | `GET /api/inventory/warehouse/user-options`；`del=0 pass=1`；模糊 `Usercode`/`truename`。 |
| 操作日志 | `UB_Date_ERP_Operation_log` | 增改删恢复审反审批量审经 `operationAuditMiddleware` 写入；`code` 映射表名为 `UB_ERP_Stocks_warehouse`。 |
| 本期不做 | — | Excel 导入、打印、彻底删除、DDL。 |
