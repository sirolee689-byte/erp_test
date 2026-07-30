const SALES_ORDER_ACTIONS = [
  {
    id: 'save-order',
    name: '新增/编辑保存',
    trigger: '销售订单新增或编辑页面点击“保存”',
    interfaces: [
      { method: 'POST', path: '/api/sales-order', purpose: '新增销售订单' },
      { method: 'PUT', path: '/api/sales-order/:id', purpose: '编辑销售订单' },
    ],
    summary: '保存订单主从数据，并按订单明细中的成品款对齐 PI BOM。',
    transactionResult: '订单主表、明细和本次需要增删的 PI BOM 在同一事务内提交；任一步失败则回滚。',
    reads: [
      { tableName: 'UB_ERP_Sales_order', purpose: '销售订单主表', detail: '编辑时读取订单状态、PI号和原主表信息。' },
      { tableName: 'UB_ERP_Sales_order_list', purpose: '销售订单明细表', detail: '编辑时读取原货品和数量，用于判断是否变为未运算。' },
      { tableName: 'UB_ERP_System_sales_customer', purpose: '销售客户资料表', detail: '校验客户已审核并取得客户名称快照。' },
      { tableName: 'UB_ERP_System_currency', purpose: '系统币别配置表', detail: '解析币别编号和名称快照。' },
      { tableName: 'UB_ERP_Bom_000', purpose: 'BOM物料主档', detail: '取得销售明细物料快照；新增款时作为 PI BOM 主档来源。' },
      { tableName: 'UB_ERP_Bom_parts', purpose: 'BOM配件明细表', detail: '仅新增款建立 PI BOM 时读取并展开主 BOM 配件树。' },
      { tableName: 'UB_ERP_Bom_code', purpose: 'BOM分类编码表', detail: '仅建立 PI BOM 时读取结构行过滤和顶级成品规则。' },
      { tableName: 'UB_ERP_Bom_Sales', purpose: 'PI销售BOM主表', detail: '读取当前 PI 已有成品款，用于计算新增款和删款。' },
    ],
    writes: [
      { tableName: 'UB_ERP_Sales_order', purpose: '销售订单主表', operation: '新增/更新', detail: '新增主表或更新现有主表及审计字段。' },
      { tableName: 'UB_ERP_Sales_order_list', purpose: '销售订单明细表', operation: '整单替换', detail: '按 PI 先删除旧明细，再写入当前合并后的明细。' },
      { tableName: 'UB_ERP_Bom_Sales', purpose: 'PI销售BOM主表', operation: '条件性增删', conditional: true, detail: '只删除已不在订单中的款，只为尚无 PI BOM 的新增款建立主档；已有款不覆盖。' },
      { tableName: 'UB_ERP_Bom_Sales_list', purpose: 'PI销售BOM配件表', operation: '条件性增删', conditional: true, detail: '随删款清理对应配件树；新增款时从主 BOM 建立配件树。' },
      { tableName: 'UB_ERP_Bom_pi_cost', purpose: 'PI物料明细结果表', operation: '条件性删除', conditional: true, detail: '仅明细货品集合、订货数量变化，或同步 BOM 后再保存时，删除该 PI 的旧结果。' },
    ],
    conditions: [
      '已有 PI BOM 的在单款保存时保持原样，不从主 BOM 自动覆盖。',
      '编辑保存清理旧 pi_cost 时不清 UB_ERP_Bom_pi_consumption。',
    ],
  },
  {
    id: 'save-pi-bom',
    name: '保存 PI BOM',
    trigger: '销售订单 PI BOM 页签点击“保存 PI BOM”',
    interfaces: [
      { method: 'PUT', path: '/api/sales-order/:id/pi-bom', purpose: '保存当前成品款的 PI BOM 用量' },
    ],
    summary: '维护订单内 PI BOM 配件的用量、损耗和搭配，不从主 BOM 重新建树。',
    transactionResult: 'PI BOM 配件更新和销售订单未运算标记在同一事务内提交。',
    reads: [
      { tableName: 'UB_ERP_Sales_order', purpose: '销售订单主表', detail: '校验订单存在、未审核且未进入回收站。' },
      { tableName: 'UB_ERP_Sales_order_list', purpose: '销售订单明细表', detail: '校验当前成品款仍属于该订单。' },
      { tableName: 'UB_ERP_Bom_Sales', purpose: 'PI销售BOM主表', detail: '确认当前成品款已有 PI BOM 主档。' },
      { tableName: 'UB_ERP_Bom_Sales_list', purpose: 'PI销售BOM配件表', detail: '校验提交行确实属于当前 PI 和成品款。' },
    ],
    writes: [
      { tableName: 'UB_ERP_Bom_Sales_list', purpose: 'PI销售BOM配件表', operation: '更新', detail: '仅更新 kcac04、kcac05 和 Describe。' },
      { tableName: 'UB_ERP_Sales_order', purpose: '销售订单主表', operation: '更新', detail: '将订单标为未运算并更新操作审计字段。' },
    ],
    conditions: [
      '保存 PI BOM 当下不删除 UB_ERP_Bom_pi_cost；需要重新执行一键运算刷新物料单。',
      '不读取 UB_ERP_Bom_parts，也不从主 BOM 覆盖 PI BOM。',
    ],
  },
  {
    id: 'sync-bom',
    name: '同步 BOM',
    trigger: '销售订单明细选择成品款后执行单款或批量同步 BOM',
    interfaces: [
      { method: 'POST', path: '/api/sales-order/:id/sync-bom', purpose: '同步单个成品款' },
      { method: 'POST', path: '/api/sales-order/:id/sync-bom-batch', purpose: '批量同步选中成品款' },
    ],
    summary: '按选中成品款读取主 BOM，删除并重建对应的 PI BOM 主档和配件树。',
    transactionResult: '每个成品款独立事务替换 PI BOM；批量全部完成后再将订单标为未运算。',
    reads: [
      { tableName: 'UB_ERP_Sales_order', purpose: '销售订单主表', detail: '读取 PI号并校验订单状态。' },
      { tableName: 'UB_ERP_Sales_order_list', purpose: '销售订单明细表', detail: '校验选中成品款属于当前订单。' },
      { tableName: 'UB_ERP_Bom_000', purpose: 'BOM物料主档', detail: '读取选中成品款的主 BOM 头和物料快照。' },
      { tableName: 'UB_ERP_Bom_parts', purpose: 'BOM配件明细表', detail: '递归展开主 BOM 配件树。' },
      { tableName: 'UB_ERP_Bom_code', purpose: 'BOM分类编码表', detail: '读取结构行过滤和顶级成品规则。' },
    ],
    writes: [
      { tableName: 'UB_ERP_Bom_Sales', purpose: 'PI销售BOM主表', operation: '选中款替换', detail: '删除并重建选中成品款的 PI BOM 主档。' },
      { tableName: 'UB_ERP_Bom_Sales_list', purpose: 'PI销售BOM配件表', operation: '选中款替换', detail: '删除并按主 BOM 重新建立选中款的完整配件树。' },
      { tableName: 'UB_ERP_Sales_order', purpose: '销售订单主表', operation: '更新', detail: '至少一款同步成功后标为未运算，并更新操作审计字段。' },
    ],
    conditions: [
      '只覆盖用户选中的成品款，其它成品款 PI BOM 保持不变。',
      '同步当下不删除 UB_ERP_Bom_pi_cost；同步后再保存订单时才按现有规则清理旧结果。',
    ],
  },
  {
    id: 'calculate',
    name: '一键运算',
    trigger: '销售订单列表操作列点击“一键运算”',
    interfaces: [
      { method: 'POST', path: '/api/sales-order/:id/calculate', purpose: '生成或重算销售订单物料单' },
    ],
    summary: '只读取当前 PI BOM 计算物料明细，并按条件生成汇总结果。',
    transactionResult: '目标范围的旧物料结果先删除再写入；失败时事务回滚，不留下部分运算结果。',
    reads: [
      { tableName: 'UB_ERP_Sales_order', purpose: '销售订单主表', detail: '读取 PI号、订单状态和运算范围。' },
      { tableName: 'UB_ERP_Sales_order_list', purpose: '销售订单明细表', detail: '读取成品款、订货数量并判断整款或散件。' },
      { tableName: 'UB_ERP_Bom_Sales', purpose: 'PI销售BOM主表', detail: '定位每个成品款的 PI BOM 根节点。' },
      { tableName: 'UB_ERP_Bom_Sales_list', purpose: 'PI销售BOM配件表', detail: '作为一键运算的 BOM 树唯一来源。' },
      { tableName: 'UB_ERP_Bom_code', purpose: 'BOM分类编码表', detail: '读取整款、散件和隐藏结构前缀规则。' },
      { tableName: 'UB_ERP_Bom_000', purpose: 'BOM物料主档', detail: '补充物料快照及排序分类编码。' },
      { tableName: 'New_UB_ERP_Stocks_material', purpose: '材料分类表', detail: '按材料分类补充物料单 px 排序。' },
      { tableName: 'UB_ERP_Bom_pi_cost', purpose: 'PI物料明细结果表', detail: '判断已有运算结果；部分重算时用于重建整单汇总。' },
    ],
    writes: [
      { tableName: 'UB_ERP_Bom_pi_cost', purpose: 'PI物料明细结果表', operation: '整单/选中款替换', detail: '删除目标范围旧结果后写入当前 PI BOM 的新运算结果；散件写自身用量。' },
      { tableName: 'UB_ERP_Bom_pi_consumption', purpose: 'PI物料汇总结果表', operation: '条件性重建', conditional: true, detail: '仅该物理表存在时重建；散件自用量不进入汇总表。' },
      { tableName: 'UB_ERP_Sales_order', purpose: '销售订单主表', operation: '更新', detail: '更新操作审计字段，并按物料结果覆盖情况写入运算状态。' },
    ],
    conditions: [
      '运算只读 PI BOM，禁止从 UB_ERP_Bom_000 / UB_ERP_Bom_parts 覆盖当前 PI BOM。',
      '未运算订单通常整单重算；已运算且仅部分款同步时可只重算同步过的整款。',
      'UB_ERP_Bom_pi_consumption 不存在时仍可完成明细运算。',
    ],
  },
]

const PURCHASE_ORDER_ACTIONS = [
  {
    id: 'save-order',
    name: '新增/编辑保存',
    trigger: '采购订单新增或编辑页面点击“保存”',
    interfaces: [
      { method: 'POST', path: '/api/buy-order', purpose: '新增采购订单' },
      { method: 'PUT', path: '/api/buy-order/:id', purpose: '编辑采购订单' },
    ],
    summary: '保存采购订单主表，并整批重写采购明细、额外费用和采购 BOM 快照。',
    transactionResult: '主表、采购明细、额外费用、BOM 快照和操作日志在同一事务内提交；任一步失败则全部回滚。',
    reads: [
      { tableName: 'UB_ERP_Buy_order', purpose: '采购订单主表', detail: '新增时检查单号；编辑时读取原单号、状态和核心编码。' },
      { tableName: 'UB_ERP_Buy_order_list', purpose: '采购订单明细表', detail: '编辑时读取原明细，用于保护已有入库记录的采购数量。' },
      { tableName: 'UB_ERP_Stocks_Storage', purpose: '入库单主表', detail: '编辑时判断采购明细是否已被采购入库引用。' },
      { tableName: 'UB_ERP_Stocks_Storage_list', purpose: '入库单明细表', detail: '按采购单号、物料或来源键定位已有入库明细。' },
      { tableName: 'UB_ERP_System_supplier', purpose: '供应商资料表', detail: '校验供应商已审核、未删除且可用于采购，并取得名称快照。' },
      { tableName: 'UB_ERP_Finance_currency', purpose: '财务币别表', detail: '校验币别并取得币别名称和汇率快照。' },
      { tableName: 'UB_ERP_Bom_000', purpose: 'BOM物料主档', detail: '校验采购物料与费用项目，并生成采购明细和 BOM 主档快照。' },
      { tableName: 'UB_ERP_Bom_parts', purpose: 'BOM配件明细表', detail: '递归读取采购物料配件，生成订单 BOM 配件快照。' },
    ],
    writes: [
      { tableName: 'UB_ERP_Buy_order', purpose: '采购订单主表', operation: '新增/更新', detail: '新增主表或更新未审核、未结案、未删除采购单的基础资料。' },
      { tableName: 'UB_ERP_Buy_order_list', purpose: '采购订单明细表', operation: '整单替换', detail: '按采购单号删除旧明细，再写入当前采购物料、数量、价格和物料快照。' },
      { tableName: 'UB_ERP_Buy_order_money', purpose: '采购订单额外费用表', operation: '整单替换', detail: '按采购单号删除旧费用，再写入当前有效 FEE 类费用。' },
      { tableName: 'UB_ERP_Bom_buy_order', purpose: '采购订单BOM主快照表', operation: '整单替换', detail: '删除旧快照后，为当前采购明细重建 BOM 主档快照。' },
      { tableName: 'UB_ERP_Bom_buy_order_list', purpose: '采购订单BOM配件快照表', operation: '整单替换', detail: '删除旧快照后，按主 BOM 重建最多 6 层配件快照。' },
    ],
    conditions: [
      '编辑时，已有采购入库记录的明细不允许删除，也不允许修改采购数量。',
      '没有价格权限时，保存端不允许用页面数据覆盖采购价格、金额和费用金额。',
      '采购 BOM 是保存时的追溯快照，不会反向修改 UB_ERP_Bom_000 或 UB_ERP_Bom_parts。',
    ],
  },
  {
    id: 'audit',
    name: '审核',
    trigger: '采购订单未审核列表点击“审核”',
    interfaces: [
      { method: 'POST', path: '/api/buy-order/:id/audit', purpose: '审核采购订单' },
    ],
    summary: '校验采购单状态和有效明细后，将采购订单主表标为已审核。',
    transactionResult: '校验通过后更新采购订单主表的审核状态和审核人字段。',
    reads: [
      { tableName: 'UB_ERP_Buy_order', purpose: '采购订单主表', detail: '校验采购单存在、未删除且尚未审核。' },
      { tableName: 'UB_ERP_Buy_order_list', purpose: '采购订单明细表', detail: '确认采购单至少存在一条未删除的有效明细。' },
    ],
    writes: [
      { tableName: 'UB_ERP_Buy_order', purpose: '采购订单主表', operation: '更新', detail: '写入 pass=1，并更新审核人编号和姓名。' },
    ],
    conditions: [
      '回收站采购单不能审核，已审核采购单不能重复审核。',
      '采购单没有有效明细时审核失败。',
    ],
  },
  {
    id: 'unaudit',
    name: '反审',
    trigger: '采购订单已审核列表点击“反审”并填写原因',
    interfaces: [
      { method: 'POST', path: '/api/buy-order/:id/unaudit', purpose: '反审采购订单' },
    ],
    summary: '记录反审原因，并将采购订单主表恢复为未审核。',
    transactionResult: '当前实现先写反审原因，再更新采购订单主表；两步尚未包在同一数据库事务内。',
    reads: [
      { tableName: 'UB_ERP_Buy_order', purpose: '采购订单主表', detail: '校验采购单存在、已审核且不在回收站。' },
      { tableName: 'UB_ERP_Bom_buy_order', purpose: '采购订单BOM主快照表', detail: '读取该采购单最新 BOM 快照 id，作为反审原因的 oid。' },
      { tableName: 'UB_ERP_Stocks_Storage', purpose: '入库单主表', detail: '读取采购入库关联数量；当前规则不以已有入库作为反审阻断条件。' },
    ],
    writes: [
      { tableName: 'UB_ERP_Buy_order_sp', purpose: '采购订单反审原因表', operation: '新增', detail: '写入操作人、反审原因、采购单号和关联 BOM 快照 id。' },
      { tableName: 'UB_ERP_Buy_order', purpose: '采购订单主表', operation: '更新', detail: '将 pass 恢复为 0。' },
    ],
    conditions: [
      '反审原因必填；回收站或未审核采购单不能反审。',
      '已有采购入库记录时当前代码仍允许反审；之后编辑时由明细数量锁定规则保护已入库数量。',
    ],
  },
]

const STOCK_IN_ACTIONS = [
  {
    id: 'save-stock-in',
    name: '新增/编辑保存',
    trigger: '入库单新增或编辑页面点击“保存”',
    interfaces: [
      { method: 'POST', path: '/api/stock-in', purpose: '新增入库单' },
      { method: 'PUT', path: '/api/stock-in/:id', purpose: '编辑入库单' },
    ],
    summary: '校验仓库、关联方和来源单据后保存入库主从表；有有效明细时自动审核，空明细保存为待审核草稿。',
    transactionResult: '入库主表、整批重写的明细和操作日志在同一事务内提交；任一步失败则全部回滚。',
    reads: [
      { tableName: 'UB_ERP_Stocks_Storage', purpose: '入库单主表', detail: '生成单号时检查已有入库单；编辑时读取原单号、状态和核心编码。' },
      { tableName: 'UB_ERP_Stocks_Warehouse', purpose: '仓库资料表', detail: '校验仓库存在，并确认当前操作员属于该仓库参管人员。' },
      { tableName: 'UB_ERP_Bom_000', purpose: 'BOM物料主档', detail: '按每条入库物料编码重新读取并补齐物料快照字段。' },
      { tableName: 'UB_ERP_System_supplier', purpose: '供应商资料表', detail: '采购、外协入库按类型校验供应商或外协客户。' },
      { tableName: 'UB_ERP_Stocks_workshop', purpose: '生产车间表', detail: '生产入库、生产退料按类型校验生产车间。' },
      { tableName: 'UB_ERP_Customer', purpose: '客户资料表', detail: '销售退货等客户来源类型按条件校验客户。' },
      { tableName: 'UB_ERP_Buy_order', purpose: '采购订单主表', detail: '仅采购入库时校验来源采购单已审核、未删除、未结案且供应商匹配。' },
      { tableName: 'UB_ERP_assist_order', purpose: '外协订单主表', detail: '仅外协入库或外协退料时校验来源外协单状态和外协客户。' },
      { tableName: 'UB_ERP_Dispatch_order', purpose: '派工单主表', detail: '仅生产入库或生产退料时校验来源派工单状态和生产车间。' },
      { tableName: 'UB_ERP_Sales_order', purpose: '销售订单主表', detail: '仅销售退货等销售来源类型校验来源销售单状态和客户。' },
    ],
    writes: [
      { tableName: 'UB_ERP_Stocks_Storage', purpose: '入库单主表', operation: '新增/更新', detail: '保存基础资料；有有效明细时写 pass=1 和审核人信息，空明细写 pass=0。' },
      { tableName: 'UB_ERP_Stocks_Storage_list', purpose: '入库单明细表', operation: '整单替换', detail: '编辑时删除原明细，再写入当前数量、价格、来源明细键和 BOM 物料快照。' },
    ],
    conditions: [
      '采购、外协、生产和销售来源按入库类型分别校验；其他入库、盘盈入库不要求来源单据。',
      '保存不反写采购、外协、派工或销售来源表；主表 kcan04 保存来源单号，明细 kcao02 保存来源明细键。',
      '有有效明细的新增和待审核编辑会自动审核；空明细只保存待审核草稿，之后必须通过审核接口校验。',
      '库存统计只计算主从表已审核且未删除的 kcao03；保存为待审核草稿时不增加库存。',
    ],
  },
  {
    id: 'audit',
    name: '审核',
    trigger: '入库单未审核列表点击“审核”',
    interfaces: [
      { method: 'POST', path: '/api/stock-in/:id/audit', purpose: '审核入库单' },
    ],
    summary: '确认至少存在一条有效明细后，将入库主从表同步标为已审核，使入库数量进入库存统计。',
    transactionResult: '当前实现先更新主表，再更新明细表；两次更新尚未包在同一数据库事务内。',
    reads: [
      { tableName: 'UB_ERP_Stocks_Storage', purpose: '入库单主表', detail: '校验单据未删除、未审核、未复核、未结案且不是只读加工入库。' },
      { tableName: 'UB_ERP_Stocks_Storage_list', purpose: '入库单明细表', detail: '要求至少一条未删除、物料编码非空且入库数量大于 0 的有效明细。' },
    ],
    writes: [
      { tableName: 'UB_ERP_Stocks_Storage', purpose: '入库单主表', operation: '更新', detail: '写入 pass=1，并按真实字段写审核人和审核时间。' },
      { tableName: 'UB_ERP_Stocks_Storage_list', purpose: '入库单明细表', operation: '批量更新', detail: '按入库单号将全部明细 pass 同步为 1。' },
    ],
    conditions: [
      '空明细草稿可以保存，但不能审核。',
      '审核不直接写库存汇总表；库存报表按已审核入库主从表实时汇总。',
    ],
  },
  {
    id: 'unaudit',
    name: '反审核',
    trigger: '入库单已审核列表点击“反审”',
    interfaces: [
      { method: 'POST', path: '/api/stock-in/:id/unaudit', purpose: '反审核入库单' },
    ],
    summary: '将入库主从表同步恢复为未审核，使该单数量退出库存统计口径。',
    transactionResult: '当前实现先更新主表，再更新明细表；两次更新尚未包在同一数据库事务内。',
    reads: [
      { tableName: 'UB_ERP_Stocks_Storage', purpose: '入库单主表', detail: '校验单据已审核、未删除、未复核、未结案且不是只读加工入库。' },
    ],
    writes: [
      { tableName: 'UB_ERP_Stocks_Storage', purpose: '入库单主表', operation: '更新', detail: '写入 pass=0，并清空存在的审核人和审核时间字段。' },
      { tableName: 'UB_ERP_Stocks_Storage_list', purpose: '入库单明细表', operation: '批量更新', detail: '按入库单号将全部明细 pass 同步为 0。' },
    ],
    conditions: [
      '已复核入库单必须先反复核，才能反审核。',
      '反审核不删除入库数据，只让该单退出已审核库存统计口径。',
    ],
  },
  {
    id: 'review',
    name: '复核',
    trigger: '入库单已审核且未复核列表点击“复核”',
    interfaces: [
      { method: 'POST', path: '/api/stock-in/:id/review', purpose: '财务复核入库单' },
    ],
    summary: '将入库主从表同步标为已复核，锁定单据后续修改和反审核操作。',
    transactionResult: '当前实现先更新主表，再更新明细表；两次更新尚未包在同一数据库事务内。',
    reads: [
      { tableName: 'UB_ERP_Stocks_Storage', purpose: '入库单主表', detail: '校验单据已审核、未删除、未复核、未结案且可操作。' },
    ],
    writes: [
      { tableName: 'UB_ERP_Stocks_Storage', purpose: '入库单主表', operation: '更新', detail: '将 sp_flag 更新为 1。' },
      { tableName: 'UB_ERP_Stocks_Storage_list', purpose: '入库单明细表', operation: '批量更新', detail: '按入库单号将全部明细 sp_flag 同步为 1。' },
    ],
    conditions: [
      '未审核入库单不能复核。',
      '复核不改变 pass 和入库数量，只锁定当前已审核单据。',
    ],
  },
  {
    id: 'unreview',
    name: '反复核',
    trigger: '入库单已审核且已复核时点击“反复核”',
    interfaces: [
      { method: 'POST', path: '/api/stock-in/:id/unreview', purpose: '取消财务复核' },
    ],
    summary: '将入库主从表同步恢复为未复核，解除复核锁定。',
    transactionResult: '当前实现先更新主表，再更新明细表；两次更新尚未包在同一数据库事务内。',
    reads: [
      { tableName: 'UB_ERP_Stocks_Storage', purpose: '入库单主表', detail: '校验单据已审核、已复核、未删除、未结案且可操作。' },
    ],
    writes: [
      { tableName: 'UB_ERP_Stocks_Storage', purpose: '入库单主表', operation: '更新', detail: '将 sp_flag 恢复为 0。' },
      { tableName: 'UB_ERP_Stocks_Storage_list', purpose: '入库单明细表', operation: '批量更新', detail: '按入库单号将全部明细 sp_flag 同步为 0。' },
    ],
    conditions: [
      '只有已审核且已复核的入库单可以反复核。',
      '反复核后单据仍保持已审核，库存统计数量不变。',
    ],
  },
]

const STOCK_OUT_ACTIONS = [
  {
    id: 'save-stock-out',
    name: '新增/编辑保存',
    trigger: '出库单新增或编辑页面点击“保存”',
    interfaces: [
      { method: 'POST', path: '/api/stock-out', purpose: '新增出库单' },
      { method: 'PUT', path: '/api/stock-out/:id', purpose: '编辑出库单' },
    ],
    summary: '校验仓库、关联方、来源单据和物料后，保存待审核的出库主从数据。',
    transactionResult: '出库主表、整批重写的明细和操作日志在同一事务内提交；任一步失败则全部回滚。',
    reads: [
      { tableName: 'UB_ERP_Stocks_out', purpose: '出库单主表', detail: '生成单号时检查已有出库单；编辑时读取原单号、状态和核心编码。' },
      { tableName: 'UB_ERP_Stocks_Warehouse', purpose: '仓库资料表', detail: '校验仓库存在，并确认当前操作员属于该仓库参管人员。' },
      { tableName: 'UB_ERP_Bom_000', purpose: 'BOM物料主档', detail: '按每条出库物料编码重新读取并写入物料快照。' },
      { tableName: 'UB_ERP_System_supplier', purpose: '供应商资料表', detail: '采购退货和外协领料等类型校验供应商或外协商。' },
      { tableName: 'UB_ERP_Stocks_workshop', purpose: '生产车间表', detail: '生产领料等类型校验生产车间；加工后外协按条件校验本厂车间。' },
      { tableName: 'UB_ERP_System_sales_customer', purpose: '销售客户资料表', detail: '成品出库校验已审核销售客户；其他出库允许保留手填关联单位。' },
      { tableName: 'UB_ERP_Customer', purpose: '客户资料表', detail: '部分历史客户来源类型按条件校验客户。' },
      { tableName: 'UB_ERP_Buy_order', purpose: '采购订单主表', detail: '采购退货保存时校验采购单已审核、未删除、未结案且供应商匹配。' },
      { tableName: 'UB_ERP_assist_order', purpose: '外协订单主表', detail: '外协领料或外协退货保存时校验外协单状态和外协商。' },
      { tableName: 'UB_ERP_Sales_order', purpose: '销售订单主表', detail: '成品出库保存时校验销售订单已审核、未删除且未结案。' },
      { tableName: 'UB_ERP_Sales_order_list', purpose: '销售订单明细表', detail: '成品出库确认销售订单至少存在有效且已审核的来源明细。' },
    ],
    writes: [
      { tableName: 'UB_ERP_Stocks_out', purpose: '出库单主表', operation: '新增/更新', detail: '保存基础资料并固定写 pass=0；编辑不改变原单号和核心编码。' },
      { tableName: 'UB_ERP_Stocks_out_list', purpose: '出库单明细表', operation: '整单替换', detail: '编辑时删除原明细，再写入当前数量、价格、来源键和 BOM 物料快照。' },
    ],
    conditions: [
      '保存只建立待审核出库单，不在保存阶段回写采购、外协、派工或销售明细的已用数量。',
      '生产领料的派工单选择和数量上限由选单接口提供；当前保存服务不重新读取派工单主表。',
      '空明细可以保存草稿，但必须至少有一条有效明细才能审核。',
      '未审核出库会占用可用库存，但只有审核后才进入正式出库库存统计。',
    ],
  },
  {
    id: 'audit',
    name: '审核',
    trigger: '出库单未审核列表点击“审核”',
    interfaces: [
      { method: 'POST', path: '/api/stock-out/:id/audit', purpose: '审核出库单' },
    ],
    summary: '审核出库主从表，并按出库类型把数量增加到对应来源明细的已用数量字段。',
    transactionResult: '来源数量回写、出库主从状态和操作日志在同一事务内提交；失败时全部回滚。',
    reads: [
      { tableName: 'UB_ERP_Stocks_out', purpose: '出库单主表', detail: '校验单据未删除、未审核且未结案，并取得出库类型和单号。' },
      { tableName: 'UB_ERP_Stocks_out_list', purpose: '出库单明细表', detail: '要求至少一条有效明细，并按 kcaq02 汇总来源明细键和出库数量。' },
    ],
    writes: [
      { tableName: 'UB_ERP_Stocks_out', purpose: '出库单主表', operation: '更新', detail: '写入 pass=1，并按真实字段写审核人和审核时间。' },
      { tableName: 'UB_ERP_Stocks_out_list', purpose: '出库单明细表', operation: '批量更新', detail: '按出库单号将全部明细 pass 同步为 1。' },
      { tableName: 'UB_ERP_Buy_order_list', purpose: '采购订单明细表', operation: '条件性更新', conditional: true, detail: '仅采购退货类型增加 kcak07，并按物料单位换算。' },
      { tableName: 'UB_ERP_assist_order_list', purpose: '外协订单明细表', operation: '条件性更新', conditional: true, detail: '仅外协领料或退货类型增加 wxak08，并按物料单位换算。' },
      { tableName: 'UB_ERP_Dispatch_order_list', purpose: '派工单明细表', operation: '条件性更新', conditional: true, detail: '生产领料增加 scak04，生产返修增加 scak05；补数和计划外类型不回写。' },
      { tableName: 'UB_ERP_Sales_order_list', purpose: '销售订单明细表', operation: '条件性更新', conditional: true, detail: '仅成品出库类型增加 xsak06。' },
    ],
    conditions: [
      '来源回写按明细 kcaq02 聚合并匹配来源表 systemcode、GUID 或 id；目标字段不存在时跳过该来源回写。',
      '盘亏、其他出库及不在映射中的出库类型只审核出库主从表，不回写上游单据。',
      '审核不写独立库存汇总表；库存报表按已审核、未删除的出入库主从数据实时统计。',
    ],
  },
  {
    id: 'unaudit',
    name: '反审核',
    trigger: '出库单已审核列表点击“反审”并填写原因',
    interfaces: [
      { method: 'POST', path: '/api/stock-out/:id/unaudit', purpose: '反审核出库单' },
    ],
    summary: '将出库主从表恢复为未审核，并按原出库类型扣回审核时写入的来源已用数量。',
    transactionResult: '来源数量扣回、出库主从状态和反审日志在同一事务内提交；失败时全部回滚。',
    reads: [
      { tableName: 'UB_ERP_Stocks_out', purpose: '出库单主表', detail: '校验单据已审核、未删除且未结案，并取得出库类型和单号。' },
      { tableName: 'UB_ERP_Stocks_out_list', purpose: '出库单明细表', detail: '按 kcaq02 汇总审核时已回写的来源数量。' },
    ],
    writes: [
      { tableName: 'UB_ERP_Stocks_out', purpose: '出库单主表', operation: '更新', detail: '写入 pass=0，并清空存在的审核人和审核时间字段。' },
      { tableName: 'UB_ERP_Stocks_out_list', purpose: '出库单明细表', operation: '批量更新', detail: '按出库单号将全部明细 pass 同步为 0。' },
      { tableName: 'UB_ERP_Buy_order_list', purpose: '采购订单明细表', operation: '条件性扣回', conditional: true, detail: '采购退货类型扣回 kcak07，结果最低为 0。' },
      { tableName: 'UB_ERP_assist_order_list', purpose: '外协订单明细表', operation: '条件性扣回', conditional: true, detail: '外协领料或退货类型扣回 wxak08，结果最低为 0。' },
      { tableName: 'UB_ERP_Dispatch_order_list', purpose: '派工单明细表', operation: '条件性扣回', conditional: true, detail: '生产领料扣回 scak04，生产返修扣回 scak05，结果最低为 0。' },
      { tableName: 'UB_ERP_Sales_order_list', purpose: '销售订单明细表', operation: '条件性扣回', conditional: true, detail: '成品出库类型扣回 xsak06，结果最低为 0。' },
    ],
    conditions: [
      '反审原因必填；未审核、回收站或已结案出库单不能反审核。',
      '扣回结果使用最低 0 保护，避免来源明细已用数量出现负数。',
      '反审核不删除出库数据；该单退出正式库存统计，但仍作为未审核出库占用可用库存。',
    ],
  },
]

const ASSIST_ORDER_ACTIONS = [
  {
    id: 'save-order',
    name: '新增/编辑保存',
    trigger: '外协订单新增或编辑页面点击“立即提交”',
    interfaces: [
      { method: 'POST', path: '/api/assist-order', purpose: '新增外协订单' },
      { method: 'PUT', path: '/api/assist-order/:id', purpose: '编辑外协订单' },
    ],
    summary: '校验外协商和币别，保存外协主表，并整批重写外协明细和额外费用。',
    transactionResult: '主表、明细、额外费用和操作日志在同一事务内提交；任一步失败则全部回滚。',
    reads: [
      { tableName: 'UB_ERP_assist_order', purpose: '外协订单主表', detail: '生成单号、检查重复；编辑时读取原单号、状态和核心编码。' },
      { tableName: 'UB_ERP_System_supplier', purpose: '供应商资料表', detail: '校验外协商属于外协或共用类型，且已审核、未删除。' },
      { tableName: 'UB_ERP_Finance_currency', purpose: '财务币别表', detail: '校验币别并取得币别名称和汇率快照。' },
      { tableName: 'UB_ERP_Bom_Sales_list', purpose: 'PI销售BOM配件表', detail: '订单外协或订单外发优先读取 PI BOM 物料快照。' },
      { tableName: 'UB_ERP_Bom_Sales', purpose: 'PI销售BOM主表', detail: '订单外发在配件快照未命中时按条件读取 PI BOM 主快照。' },
      { tableName: 'UB_ERP_Bom_000', purpose: 'BOM物料主档', detail: '作为物料快照兜底，并取得明细 wxak02、GUID、systemcode 使用的 BOM GUID；费用编码也从 FEE 物料核对名称。' },
    ],
    writes: [
      { tableName: 'UB_ERP_assist_order', purpose: '外协订单主表', operation: '新增/更新', detail: '保存外协类型、PI、外协商、币别、交期和备注等基础资料。' },
      { tableName: 'UB_ERP_assist_order_list', purpose: '外协订单明细表', operation: '整单替换', detail: '先删除原明细，再写入当前数量、价格和物料快照；新写明细 pass 固定为 1。' },
      { tableName: 'UB_ERP_assist_order_money', purpose: '外协订单额外费用表', operation: '整单替换', detail: '先删除原费用，再写入已选择费用编码的有效行。' },
    ],
    conditions: [
      '主表新增固定 pass=0、closed=0、del=0；明细保存时当前代码固定写 pass=1。',
      '保存不写入库单或出库单；外协入库、外协领料由后续单据按外协单号关联。',
      '已审核、已结案或回收站外协订单不能编辑保存。',
    ],
  },
  {
    id: 'audit',
    name: '审核',
    trigger: '外协订单未审核列表点击“审核”',
    interfaces: [
      { method: 'POST', path: '/api/assist-order/:id/audit', purpose: '审核外协订单' },
    ],
    summary: '校验外协订单状态后，将外协主表标为已审核。',
    transactionResult: '当前实现先更新主表，再另写操作日志；两步尚未包在同一数据库事务内。',
    reads: [
      { tableName: 'UB_ERP_assist_order', purpose: '外协订单主表', detail: '校验单据存在、未删除且尚未审核。' },
    ],
    writes: [
      { tableName: 'UB_ERP_assist_order', purpose: '外协订单主表', operation: '更新', detail: '将 pass 更新为 1。' },
    ],
    conditions: [
      '当前审核不检查是否存在外协明细，也不批量更新明细 pass。',
      '审核不创建入库或出库数据，只让外协单可被后续外协入库和领料流程引用。',
    ],
  },
  {
    id: 'unaudit',
    name: '反审',
    trigger: '外协订单已审核且未结案时点击“反审”',
    interfaces: [
      { method: 'POST', path: '/api/assist-order/:id/unaudit', purpose: '反审外协订单' },
    ],
    summary: '将未结案的外协订单主表恢复为未审核。',
    transactionResult: '当前实现先更新主表，再另写操作日志；两步尚未包在同一数据库事务内。',
    reads: [
      { tableName: 'UB_ERP_assist_order', purpose: '外协订单主表', detail: '校验单据已审核、未删除且未结案。' },
    ],
    writes: [
      { tableName: 'UB_ERP_assist_order', purpose: '外协订单主表', operation: '更新', detail: '将 pass 恢复为 0。' },
    ],
    conditions: [
      '已结案外协订单必须先反结案，再执行反审。',
      '当前反审不检查已有外协入库或领料记录，也不改这些下游单据。',
    ],
  },
  {
    id: 'close',
    name: '结案',
    trigger: '外协订单已审核且未结案时点击“结案”',
    interfaces: [
      { method: 'POST', path: '/api/assist-order/:id/close', purpose: '结案外协订单' },
    ],
    summary: '将已审核外协订单标为已结案，阻止后续编辑和反审。',
    transactionResult: '当前实现先更新主表，再另写操作日志；两步尚未包在同一数据库事务内。',
    reads: [
      { tableName: 'UB_ERP_assist_order', purpose: '外协订单主表', detail: '校验单据已审核、未删除且尚未结案。' },
    ],
    writes: [
      { tableName: 'UB_ERP_assist_order', purpose: '外协订单主表', operation: '更新', detail: '将 closed 更新为 1。' },
    ],
    conditions: [
      '未审核或回收站外协订单不能结案。',
      '结案不结转数量，也不写入库、出库或财务结算表。',
    ],
  },
  {
    id: 'unclose',
    name: '反结案',
    trigger: '外协订单已结案时点击“反结案”',
    interfaces: [
      { method: 'POST', path: '/api/assist-order/:id/unclose', purpose: '反结案外协订单' },
    ],
    summary: '将外协订单恢复为未结案，之后可以再次结案或反审。',
    transactionResult: '当前实现先更新主表，再另写操作日志；两步尚未包在同一数据库事务内。',
    reads: [
      { tableName: 'UB_ERP_assist_order', purpose: '外协订单主表', detail: '校验单据当前已结案且不在回收站。' },
    ],
    writes: [
      { tableName: 'UB_ERP_assist_order', purpose: '外协订单主表', operation: '更新', detail: '将 closed 恢复为 0。' },
    ],
    conditions: [
      '未结案或回收站外协订单不能反结案。',
      '反结案不自动反审，主表 pass 保持原值。',
    ],
  },
]

const DISPATCH_ORDER_ACTIONS = [
  {
    id: 'save-order',
    name: '新增/编辑保存',
    trigger: '派工单新增或编辑页面点击“保存”',
    interfaces: [
      { method: 'POST', path: '/api/dispatch-order', purpose: '新增派工单' },
      { method: 'PUT', path: '/api/dispatch-order/:id', purpose: '编辑派工单' },
    ],
    summary: '校验生产车间和销售订单可派数量后，保存待审核的派工主从数据。',
    transactionResult: '派工主表、整批重写的明细和操作日志在同一事务内提交；任一步失败则全部回滚。',
    reads: [
      { tableName: 'UB_ERP_Dispatch_order', purpose: '派工单主表', detail: '生成单号和检查重复；编辑时读取原单号、类型、PI、车间和状态。' },
      { tableName: 'UB_ERP_Dispatch_order_list', purpose: '派工单明细表', detail: '汇总同 PI、货品和车间的已派工数量；未审核派工同样占用可派数量。' },
      { tableName: 'UB_ERP_Stocks_workshop', purpose: '生产车间表', detail: '校验生产车间存在且未删除，并取得车间名称快照。' },
      { tableName: 'UB_ERP_Sales_order', purpose: '销售订单主表', detail: '校验关联 PI 的销售订单已审核、未删除且未结案。' },
      { tableName: 'UB_ERP_Sales_order_list', purpose: '销售订单明细表', detail: '读取销售数量和货品快照，计算每个货品当前可派数量。' },
    ],
    writes: [
      { tableName: 'UB_ERP_Dispatch_order', purpose: '派工单主表', operation: '新增/更新', detail: '新增写单号、PI、车间、交期和备注；编辑仅更新日期、交期和备注。' },
      { tableName: 'UB_ERP_Dispatch_order_list', purpose: '派工单明细表', operation: '整单替换', detail: '编辑时删除原明细，再写入当前派工数量和销售货品快照。' },
    ],
    conditions: [
      '允许空明细保存草稿；有明细时同一张派工单只能关联一个 PI，且货品不能重复。',
      '本厂和大板派工按 PI、货品、生产车间独立计算可派数量；未审核派工也计入占用。',
      '保存不写库存、不创建生产领料或生产入库，也不回写销售订单数量。',
    ],
  },
  {
    id: 'audit',
    name: '审核',
    trigger: '派工单未审核列表点击“审核”',
    interfaces: [
      { method: 'POST', path: '/api/dispatch-order/:id/audit', purpose: '审核派工单' },
    ],
    summary: '确认派工单至少有一条明细后，将派工主从表同步标为已审核。',
    transactionResult: '当前实现先更新主表，再更新明细，最后另写操作日志；这些步骤尚未包在同一数据库事务内。',
    reads: [
      { tableName: 'UB_ERP_Dispatch_order', purpose: '派工单主表', detail: '校验单据未删除且尚未审核。' },
      { tableName: 'UB_ERP_Dispatch_order_list', purpose: '派工单明细表', detail: '审核前要求至少存在一条派工明细。' },
    ],
    writes: [
      { tableName: 'UB_ERP_Dispatch_order', purpose: '派工单主表', operation: '更新', detail: '将 pass 更新为 1，并按真实字段写审核人。' },
      { tableName: 'UB_ERP_Dispatch_order_list', purpose: '派工单明细表', operation: '批量更新', detail: '按派工单号将全部明细 pass 同步为 1。' },
    ],
    conditions: [
      '空明细草稿不能审核。',
      '审核不写销售订单、库存、领料或入库表；生产领料和生产入库由各自单据后续关联派工单。',
    ],
  },
  {
    id: 'unaudit',
    name: '反审核',
    trigger: '派工单已审核列表点击“反审核”',
    interfaces: [
      { method: 'POST', path: '/api/dispatch-order/:id/unaudit', purpose: '反审核派工单' },
    ],
    summary: '将派工主从表同步恢复为未审核。',
    transactionResult: '当前实现先更新主表，再更新明细，最后另写操作日志；这些步骤尚未包在同一数据库事务内。',
    reads: [
      { tableName: 'UB_ERP_Dispatch_order', purpose: '派工单主表', detail: '校验单据已审核且未删除。' },
    ],
    writes: [
      { tableName: 'UB_ERP_Dispatch_order', purpose: '派工单主表', operation: '更新', detail: '将 pass 恢复为 0，并清空存在的审核人字段。' },
      { tableName: 'UB_ERP_Dispatch_order_list', purpose: '派工单明细表', operation: '批量更新', detail: '按派工单号将全部明细 pass 同步为 0。' },
    ],
    conditions: [
      '当前反审核不检查是否已有生产领料或生产入库，也不改这些下游单据。',
      '反审核后派工数量仍保留，并继续计入保存阶段的可派数量占用。',
    ],
  },
]

const DATA_RELATION_CATALOG = {
  version: '4',
  modules: [
    {
      id: 'sales-order',
      name: '销售订单',
      menuPath: 'supply-chain/daily/sales-order',
      description: '销售订单保存、PI BOM维护、同步BOM和物料单运算的数据流。',
      actions: SALES_ORDER_ACTIONS,
    },
    {
      id: 'purchase-order',
      name: '采购订单',
      menuPath: 'supply-chain/daily/purchase-order',
      description: '采购订单保存、采购 BOM 快照、审核和反审的数据流。',
      actions: PURCHASE_ORDER_ACTIONS,
    },
    {
      id: 'stock-in',
      name: '入库单',
      menuPath: 'inventory/daily/stock-in',
      description: '入库单保存、自动审核、审核/反审核和财务复核的数据流。',
      actions: STOCK_IN_ACTIONS,
    },
    {
      id: 'stock-out',
      name: '出库单',
      menuPath: 'inventory/daily/stock-out',
      description: '出库单保存、审核/反审核及按出库类型回写来源数量的数据流。',
      actions: STOCK_OUT_ACTIONS,
    },
    {
      id: 'assist-order',
      name: '外协单',
      menuPath: 'supply-chain/daily/outsourcing-order',
      description: '外协订单保存、审核/反审和结案/反结案的数据流。',
      actions: ASSIST_ORDER_ACTIONS,
    },
    {
      id: 'dispatch-order',
      name: '派工单',
      menuPath: 'production/daily/dispatch',
      description: '派工单保存、可派数量校验及审核/反审核的数据流。',
      actions: DISPATCH_ORDER_ACTIONS,
    },
  ],
}

export function getSystemDataRelationCatalog() {
  return structuredClone(DATA_RELATION_CATALOG)
}
