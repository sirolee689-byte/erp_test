/**
 * 库存基本资料：PI_BOM资料。
 * 首页列表按销售订单明细款展示：一行 = 一个 PI 号下的一个成品编码。
 */
import { sql } from './db.js'
import { BOM_MATERIAL_FROM } from './bomTables.js'
import { buildSalesOrderCalcStatusExpr, pickSalesOrderCalcStatusColumn } from './salesOrderListQuery.js'
import {
  buildPiBomUsageTreeNodesFromLayerCache,
  fetchPiBomHeadSystemcode,
  prefetchPiBomListLayersForUsageTree,
  resolvePiBomUsageTreeRootKeysForProduct,
} from './salesOrderPiBomUsageTree.js'

const SALES_ORDER_HEADER_FROM = 'dbo.[UB_ERP_Sales_order]'
const SALES_ORDER_LINE_FROM = 'dbo.[UB_ERP_Sales_order_list]'
const PI_BOM_HEAD_FROM = 'dbo.[UB_ERP_Bom_Sales]'
const PI_BOM_LIST_FROM = 'dbo.[UB_ERP_Bom_Sales_list]'
const PI_COST_FROM = 'dbo.[UB_ERP_Bom_pi_cost]'
const PI_LIST_PKCAA01_EXPR = `LTRIM(RTRIM(CONVERT(nvarchar(300), ISNULL(l.[pkcaa01], N''))))`

let salesOrderCalcStatusColumnPromise = null

function escapeSqlLikePattern(s) {
  return String(s ?? '')
    .replace(/\[/g, '[[]')
    .replace(/%/g, '[%]')
    .replace(/_/g, '[_]')
}

async function ensureSalesOrderCalcStatusColumn(pool) {
  if (!salesOrderCalcStatusColumnPromise) {
    salesOrderCalcStatusColumnPromise = pool
      .request()
      .query(`
        SELECT c.COLUMN_NAME
        FROM INFORMATION_SCHEMA.COLUMNS AS c
        WHERE c.TABLE_NAME = N'UB_ERP_Sales_order'
      `)
      .then((r) => pickSalesOrderCalcStatusColumn((r.recordset ?? []).map((row) => row.COLUMN_NAME)))
      .catch(() => 'is_pur')
  }
  return salesOrderCalcStatusColumnPromise
}

function formatDecimal(v) {
  const n = Number(v)
  if (!Number.isFinite(n)) return '0.0000'
  return n.toFixed(4)
}

function formatUsageCostText(row) {
  const count = Number(row.piCostRowCount ?? 0)
  if (!Number.isFinite(count) || count <= 0) return '-'
  return `成本：${formatDecimal(row.piCostKcac04Total)},${formatDecimal(row.piCostKcac06Total)}`
}

function serializePiBomDataRow(row) {
  return {
    id: row.id != null ? Number(row.id) : 0,
    orderId: row.orderId != null ? Number(row.orderId) : 0,
    piNo: row.piNo != null ? String(row.piNo) : '',
    kcaa01: row.kcaa01 != null ? String(row.kcaa01) : '',
    pass: row.pass != null ? String(row.pass) : '',
    addtime: row.addtime ?? null,
    calcStatus: row.calcStatus != null ? String(row.calcStatus) : '',
    usageCostText: formatUsageCostText(row),
    materialNameCn: row.materialNameCn != null ? String(row.materialNameCn) : '',
    customerStyleNo: row.customerStyleNo != null ? String(row.customerStyleNo) : '',
    groupName: row.groupName != null ? String(row.groupName) : '',
    unit: row.unit != null ? String(row.unit) : '',
    materialCategoryName: row.materialCategoryName != null ? String(row.materialCategoryName) : '',
    factoryStyleNo: row.factoryStyleNo != null ? String(row.factoryStyleNo) : '',
  }
}

function toText(v) {
  return v != null ? String(v) : ''
}

function toNumberOrNull(v) {
  if (v == null || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

function usageTotal(kcac04, kcac05, fallback) {
  const fb = toNumberOrNull(fallback)
  if (fb != null) return fb
  const qty = Number(kcac04 ?? 0)
  const loss = Number(kcac05 ?? 0)
  if (!Number.isFinite(qty)) return 0
  return qty * (1 + (Number.isFinite(loss) ? loss : 0))
}

function serializePiBomBasic(row) {
  if (!row) return null
  return {
    systemcode: toText(row.systemcode),
    piNo: toText(row.piNo),
    kcaa01: toText(row.kcaa01),
    kcaa02: toText(row.kcaa02),
    kcaa02_en: toText(row.kcaa02_en),
    kcaa03: toText(row.kcaa03),
    kcaa04: toText(row.kcaa04),
    kcaa05: toText(row.kcaa05),
    kcaa06: toText(row.kcaa06),
    kcaa09: toText(row.kcaa09),
    kcaa10: toText(row.kcaa10),
    kcaa11: toText(row.kcaa11),
    kcaa12: toText(row.kcaa12),
    kcaa14: toText(row.kcaa14),
    kcaa15: toText(row.kcaa15),
    kcaa25: toText(row.kcaa25),
    kcaa26: toText(row.kcaa26),
    kcaa27: toText(row.kcaa27),
    kcaa28: toText(row.kcaa28),
    kcaa29: toText(row.kcaa29),
    kcaa30: toText(row.kcaa30),
    kcaa31: toText(row.kcaa31),
    kcaa32: toNumberOrNull(row.kcaa32),
    kcaa33: toNumberOrNull(row.kcaa33),
    kcaa34: toText(row.kcaa34),
    kcaa35: toText(row.kcaa35),
    sale_price: toNumberOrNull(row.sale_price),
    cost_price: toNumberOrNull(row.cost_price),
    type: toText(row.type),
    location: toText(row.location),
    version: toText(row.version),
    remark: toText(row.remark),
    pass: toText(row.pass),
    addtime: row.addtime ?? null,
    edittime: row.edittime ?? null,
  }
}

function serializePiBomPartRow(row, idx = 0) {
  const kcac04 = toNumberOrNull(row.kcac04) ?? 0
  const kcac05 = toNumberOrNull(row.kcac05) ?? 0
  return {
    id: row.id != null ? Number(row.id) : idx + 1,
    rowNo: idx + 1,
    systemcode: toText(row.systemcode),
    kcac01: toText(row.kcac01),
    kcac02: toText(row.kcac02),
    kcaa01: toText(row.kcaa01),
    kcaa02: toText(row.kcaa02),
    kcaa03: toText(row.kcaa03),
    kcaa04: toText(row.kcaa04),
    kcaa05: toText(row.kcaa05),
    kcaa06: toText(row.kcaa06),
    kcaa09: toText(row.kcaa09),
    kcaa10: toText(row.kcaa10),
    kcaa11: toText(row.kcaa11),
    kcac04,
    kcac05,
    kcac06: usageTotal(kcac04, kcac05, row.kcac06),
    cost_price: toNumberOrNull(row.cost_price) ?? 0,
    kcaa33: toNumberOrNull(row.kcaa33) ?? 0,
    Seq: toNumberOrNull(row.Seq ?? row.seq),
    level: toNumberOrNull(row.level),
    Describe: toText(row.Describe),
  }
}

function mapTreeUsageTotals(nodes) {
  return (Array.isArray(nodes) ? nodes : []).map((node) => {
    const kcac04 = toNumberOrNull(node.kcac04) ?? 0
    const kcac05 = toNumberOrNull(node.kcac05) ?? 0
    const children = mapTreeUsageTotals(node.children)
    return {
      ...node,
      kcac04,
      kcac05,
      kcac06: usageTotal(kcac04, kcac05, node.kcac06),
      children,
    }
  })
}

function flattenPiBomTreeForParts(nodes, out = []) {
  for (const node of Array.isArray(nodes) ? nodes : []) {
    const id = node?.id != null ? Number(node.id) : null
    if (id != null && Number.isFinite(id)) {
      out.push(serializePiBomPartRow(node, out.length))
    }
    if (Array.isArray(node?.children) && node.children.length) {
      flattenPiBomTreeForParts(node.children, out)
    }
  }
  return out
}

function serializePiBomCostRow(row, idx = 0) {
  const kcac04 = toNumberOrNull(row.kcac04) ?? 0
  const kcac05 = toNumberOrNull(row.kcac05) ?? 0
  const kcac06 = toNumberOrNull(row.kcac06) ?? usageTotal(kcac04, kcac05, null)
  return {
    id: row.id != null ? Number(row.id) : idx + 1,
    rowNo: idx + 1,
    pq: toText(row.pq),
    kcaa01: toText(row.kcaa01),
    kcaa02: toText(row.kcaa02),
    kcaa03: toText(row.kcaa03),
    kcaa04: toText(row.kcaa04),
    Describe: toText(row.Describe),
    kcac04,
    kcac05,
    kcac06,
    yl: kcac04,
    loss_rate: kcac05,
    total_qty: kcac06,
    px: toNumberOrNull(row.px),
    Seq: toNumberOrNull(row.Seq ?? row.seq),
    topKcaa01: toText(row.topKcaa01),
    topKcaa02: toText(row.topKcaa02),
  }
}

async function fetchPiBomDataViewerContext(pool, orderId, productKcaa01) {
  const product = String(productKcaa01 ?? '').trim()
  if (!Number.isFinite(orderId) || orderId <= 0 || !product) {
    return { ok: false, status: 400, msg: '缺少订单ID或编码' }
  }
  const r = await pool
    .request()
    .input('orderId', sql.Int, orderId)
    .input('product', sql.NVarChar(300), product)
    .query(`
      SELECT TOP 1
        h.[id] AS orderId,
        LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(h.[xsaj01], N'')))) AS piNo,
        LTRIM(RTRIM(ISNULL(h.[pass], N''))) AS orderPass,
        LTRIM(RTRIM(ISNULL(h.[del], N''))) AS orderDel,
        l.[id] AS lineId,
        LTRIM(RTRIM(CONVERT(nvarchar(300), ISNULL(l.[kcaa01], N'')))) AS kcaa01
      FROM ${SALES_ORDER_HEADER_FROM} AS h
      INNER JOIN ${SALES_ORDER_LINE_FROM} AS l
        ON LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(h.[xsaj01], N'')))) =
           LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(l.[xsak01], N''))))
      WHERE h.[id] = @orderId
        AND LTRIM(RTRIM(CONVERT(nvarchar(300), ISNULL(l.[kcaa01], N'')))) = @product
        AND (ISNULL(h.[del], N'') = N'' OR h.[del] = N'0')
    `)
  const row = r.recordset?.[0]
  if (!row) return { ok: false, status: 404, msg: '未找到该订单明细，或订单已删除' }
  return {
    ok: true,
    orderId: Number(row.orderId),
    lineId: Number(row.lineId),
    piNo: String(row.piNo ?? '').trim(),
    kcaa01: String(row.kcaa01 ?? '').trim(),
    orderPass: String(row.orderPass ?? '').trim(),
  }
}

async function fetchPiBomDetailBasic(pool, piNo, productKcaa01) {
  const r = await pool
    .request()
    .input('pi', sql.NVarChar(200), piNo)
    .input('product', sql.NVarChar(300), productKcaa01)
    .query(`
      SELECT TOP 1
        LTRIM(RTRIM(ISNULL(CAST(h.[systemcode] AS nvarchar(500)), N''))) AS systemcode,
        LTRIM(RTRIM(ISNULL(h.[sid], N''))) AS piNo,
        LTRIM(RTRIM(CONVERT(nvarchar(300), ISNULL(h.[kcaa01], N'')))) AS kcaa01,
        LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(h.[kcaa02], N'')))) AS kcaa02,
        LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(h.[kcaa02_en], N'')))) AS kcaa02_en,
        LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(h.[kcaa03], N'')))) AS kcaa03,
        LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(h.[kcaa04], N'')))) AS kcaa04,
        LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(h.[kcaa05], N'')))) AS kcaa05,
        LTRIM(RTRIM(CONVERT(nvarchar(300), ISNULL(h.[kcaa06], N'')))) AS kcaa06,
        LTRIM(RTRIM(CONVERT(nvarchar(300), ISNULL(h.[kcaa09], N'')))) AS kcaa09,
        LTRIM(RTRIM(CONVERT(nvarchar(300), ISNULL(h.[kcaa10], N'')))) AS kcaa10,
        LTRIM(RTRIM(CONVERT(nvarchar(300), ISNULL(h.[kcaa11], N'')))) AS kcaa11,
        h.[kcaa12] AS kcaa12,
        h.[kcaa14] AS kcaa14,
        LTRIM(RTRIM(CONVERT(nvarchar(300), ISNULL(h.[kcaa15], N'')))) AS kcaa15,
        LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(h.[kcaa25], N'')))) AS kcaa25,
        h.[kcaa26] AS kcaa26,
        LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(h.[kcaa27], N'')))) AS kcaa27,
        LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(h.[kcaa28], N'')))) AS kcaa28,
        LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(h.[kcaa29], N'')))) AS kcaa29,
        h.[kcaa30] AS kcaa30,
        LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(h.[kcaa31], N'')))) AS kcaa31,
        h.[kcaa32] AS kcaa32,
        h.[kcaa33] AS kcaa33,
        LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(h.[kcaa34], N'')))) AS kcaa34,
        LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(h.[kcaa35], N'')))) AS kcaa35,
        h.[sale_price] AS sale_price,
        h.[cost_price] AS cost_price,
        LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(h.[type], N'')))) AS type,
        LTRIM(RTRIM(CONVERT(nvarchar(300), ISNULL(h.[location], N'')))) AS location,
        LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(h.[version], N'')))) AS version,
        LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(h.[remark], N'')))) AS remark,
        LTRIM(RTRIM(ISNULL(h.[pass], N''))) AS pass,
        h.[addtime] AS addtime,
        h.[edittime] AS edittime
      FROM ${PI_BOM_HEAD_FROM} AS h
      WHERE LTRIM(RTRIM(ISNULL(h.[sid], N''))) = @pi
        AND LTRIM(RTRIM(CONVERT(nvarchar(300), ISNULL(h.[kcaa01], N'')))) = @product
    `)
  return serializePiBomBasic(r.recordset?.[0] ?? null)
}

async function fetchPiBomDetailParts(pool, piNo, productKcaa01) {
  const r = await pool
    .request()
    .input('pi', sql.NVarChar(200), piNo)
    .input('product', sql.NVarChar(300), productKcaa01)
    .query(`
      SELECT
        l.[id],
        LTRIM(RTRIM(ISNULL(CAST(l.[systemcode] AS nvarchar(500)), N''))) AS systemcode,
        LTRIM(RTRIM(ISNULL(CAST(l.[kcac01] AS nvarchar(500)), N''))) AS kcac01,
        LTRIM(RTRIM(ISNULL(CAST(l.[kcac02] AS nvarchar(500)), N''))) AS kcac02,
        LTRIM(RTRIM(CONVERT(nvarchar(300), ISNULL(l.[kcaa01], N'')))) AS kcaa01,
        LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(l.[kcaa02], N'')))) AS kcaa02,
        LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(l.[kcaa03], N'')))) AS kcaa03,
        LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(l.[kcaa04], N'')))) AS kcaa04,
        LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(l.[kcaa05], N'')))) AS kcaa05,
        LTRIM(RTRIM(CONVERT(nvarchar(300), ISNULL(l.[kcaa06], N'')))) AS kcaa06,
        LTRIM(RTRIM(CONVERT(nvarchar(300), ISNULL(l.[kcaa09], N'')))) AS kcaa09,
        LTRIM(RTRIM(CONVERT(nvarchar(300), ISNULL(l.[kcaa10], N'')))) AS kcaa10,
        LTRIM(RTRIM(CONVERT(nvarchar(300), ISNULL(l.[kcaa11], N'')))) AS kcaa11,
        CAST(ISNULL(l.[kcac04], 0) AS decimal(18, 6)) AS kcac04,
        CAST(ISNULL(l.[kcac05], 0) AS decimal(18, 6)) AS kcac05,
        CAST(ISNULL(l.[kcac04], 0) * (1 + ISNULL(l.[kcac05], 0)) AS decimal(18, 6)) AS kcac06,
        CAST(ISNULL(l.[kcaa33], 0) AS decimal(18, 6)) AS kcaa33,
        CONVERT(int, ISNULL(l.[seq], 0)) AS Seq,
        LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(l.[Describe], N'')))) AS Describe
      FROM ${PI_BOM_LIST_FROM} AS l
      WHERE LTRIM(RTRIM(ISNULL(l.[sid], N''))) = @pi
        AND ${PI_LIST_PKCAA01_EXPR} = @product
      ORDER BY ISNULL(l.[seq], l.[id]) ASC, l.[id] ASC
    `)
  return (r.recordset ?? []).map((row, idx) => serializePiBomPartRow(row, idx))
}

async function fetchPiBomDetailTree(pool, piNo, productKcaa01) {
  const headSc = await fetchPiBomHeadSystemcode(pool, piNo, productKcaa01)
  if (!headSc) return []
  const rootKeys = await resolvePiBomUsageTreeRootKeysForProduct(pool, piNo, productKcaa01, headSc)
  if (!rootKeys.length) return []
  const layerCache = await prefetchPiBomListLayersForUsageTree(pool, piNo, rootKeys, productKcaa01)
  const tree = []
  for (const rootKey of rootKeys) {
    const nodes = buildPiBomUsageTreeNodesFromLayerCache(
      rootKey,
      1,
      new Set([rootKey]),
      layerCache,
      productKcaa01,
    )
    tree.push(...nodes)
  }
  return mapTreeUsageTotals(tree)
}

async function fetchPiBomDetailCostRows(pool, piNo, productKcaa01) {
  const r = await pool
    .request()
    .input('pi', sql.NVarChar(200), piNo)
    .input('product', sql.NVarChar(300), productKcaa01)
    .query(`
      SELECT
        c.[id],
        LTRIM(RTRIM(CONVERT(nvarchar(300), ISNULL(c.[pq], N'')))) AS pq,
        LTRIM(RTRIM(CONVERT(nvarchar(300), ISNULL(c.[kcaa01], N'')))) AS kcaa01,
        LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(c.[kcaa02], N'')))) AS kcaa02,
        LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(c.[kcaa03], N'')))) AS kcaa03,
        LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(c.[kcaa04], N'')))) AS kcaa04,
        CAST(ISNULL(c.[kcac04], 0) AS decimal(18, 6)) AS kcac04,
        CAST(ISNULL(c.[kcac05], 0) AS decimal(18, 6)) AS kcac05,
        CAST(ISNULL(c.[kcac06], 0) AS decimal(18, 6)) AS kcac06,
        CASE
          WHEN c.[px] IS NULL THEN NULL
          WHEN ISNUMERIC(LTRIM(RTRIM(CONVERT(nvarchar(100), c.[px])))) = 1
            THEN CONVERT(int, LTRIM(RTRIM(CONVERT(nvarchar(100), c.[px]))))
          ELSE NULL
        END AS px,
        LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(c.[Describe], N'')))) AS Describe,
        LTRIM(RTRIM(CONVERT(nvarchar(300), ISNULL(c.[top_kcaa01], N'')))) AS topKcaa01,
        LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(c.[top_kcaa02], N'')))) AS topKcaa02
      FROM ${PI_COST_FROM} AS c
      WHERE LTRIM(RTRIM(ISNULL(c.[sid], N''))) = @pi
        AND LTRIM(RTRIM(CONVERT(nvarchar(300), ISNULL(c.[pq], N'')))) = @product
      ORDER BY
        CASE WHEN c.[px] IS NULL THEN 1 ELSE 0 END ASC,
        c.[px] ASC,
        c.[id] ASC
    `)
  return (r.recordset ?? []).map((row, idx) => serializePiBomCostRow(row, idx))
}

export function registerPiBomDataRoutes(app, { getPool }) {
  app.get('/api/inventory/pi-bom-data/list', async (req, res) => {
    try {
      const pool = await getPool()
      const page = Math.max(1, Number(req.query?.page ?? 1) || 1)
      const pageSizeRaw = Number(req.query?.pageSize ?? 20) || 20
      const pageSize = Math.min(100, Math.max(1, pageSizeRaw))
      const keyword = String(req.query?.keyword ?? '').trim()
      const hasKeyword = keyword.length > 0
      const keywordPattern = `%${escapeSqlLikePattern(keyword)}%`
      const calcCol = await ensureSalesOrderCalcStatusColumn(pool)
      const calcStatusExpr = buildSalesOrderCalcStatusExpr(calcCol)
      const whereSql = `
        WHERE (ISNULL(h.[del], N'') = N'' OR h.[del] = N'0')
          AND LTRIM(RTRIM(ISNULL(h.[pass], N''))) = N'1'
          AND LTRIM(RTRIM(CONVERT(nvarchar(300), ISNULL(l.[kcaa01], N'')))) <> N''
          ${
            hasKeyword
              ? `AND (
            LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(l.[xsak01], N'')))) LIKE @keyword
            OR LTRIM(RTRIM(CONVERT(nvarchar(300), ISNULL(l.[kcaa01], N'')))) LIKE @keyword
          )`
              : ''
          }
      `

      const countReq = pool.request()
      if (hasKeyword) countReq.input('keyword', sql.NVarChar(500), keywordPattern)
      const totalRow = await countReq.query(`
        SELECT COUNT(1) AS total
        FROM ${SALES_ORDER_LINE_FROM} AS l
        INNER JOIN ${SALES_ORDER_HEADER_FROM} AS h
          ON LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(h.[xsaj01], N'')))) =
             LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(l.[xsak01], N''))))
        ${whereSql}
      `)
      const total = Number(totalRow.recordset?.[0]?.total ?? 0)

      const startRow = (page - 1) * pageSize + 1
      const endRow = page * pageSize
      const listReq = pool.request()
      listReq.input('startRow', sql.Int, startRow)
      listReq.input('endRow', sql.Int, endRow)
      if (hasKeyword) listReq.input('keyword', sql.NVarChar(500), keywordPattern)

      const listResult = await listReq.query(`
        SELECT
          x.[id],
          x.[orderId],
          x.[piNo],
          x.[kcaa01],
          x.[pass],
          x.[addtime],
          x.[calcStatus],
          x.[piCostRowCount],
          x.[piCostKcac04Total],
          x.[piCostKcac06Total],
          x.[materialNameCn],
          x.[customerStyleNo],
          x.[groupName],
          x.[unit],
          x.[materialCategoryName],
          x.[factoryStyleNo]
        FROM (
          SELECT
            l.[id],
            h.[id] AS orderId,
            LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(l.[xsak01], N'')))) AS piNo,
            LTRIM(RTRIM(CONVERT(nvarchar(300), ISNULL(l.[kcaa01], N'')))) AS kcaa01,
            LTRIM(RTRIM(ISNULL(h.[pass], N''))) AS pass,
            ISNULL(l.[addtime], h.[addtime]) AS addtime,
            ${calcStatusExpr} AS calcStatus,
            ISNULL(pc.[rowCount], 0) AS piCostRowCount,
            CAST(ISNULL(pc.[totalKcac04], 0) AS decimal(18, 6)) AS piCostKcac04Total,
            CAST(ISNULL(pc.[totalKcac06], 0) AS decimal(18, 6)) AS piCostKcac06Total,
            LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(l.[kcaa02], N'')))) AS materialNameCn,
            LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(l.[kcaa06], N'')))) AS customerStyleNo,
            LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(l.[kcaa10], N'')))) AS groupName,
            LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(l.[kcaa04], N'')))) AS unit,
            LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(m.[name], N'')))) AS materialCategoryName,
            LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(l.[kcaa09], N'')))) AS factoryStyleNo,
            ROW_NUMBER() OVER (
              ORDER BY ISNULL(l.[addtime], h.[addtime]) DESC, h.[id] DESC, ISNULL(l.[seq], l.[id]) ASC
            ) AS rn
          FROM ${SALES_ORDER_LINE_FROM} AS l
          INNER JOIN ${SALES_ORDER_HEADER_FROM} AS h
            ON LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(h.[xsaj01], N'')))) =
               LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(l.[xsak01], N''))))
          LEFT JOIN ${BOM_MATERIAL_FROM} AS m
            ON LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(m.[code], N'')))) =
               LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(l.[kcaa05], N''))))
            AND (ISNULL(m.[del], N'') = N'' OR m.[del] = N'0')
          LEFT JOIN (
            SELECT
              LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(c.[sid], N'')))) AS sid,
              LTRIM(RTRIM(CONVERT(nvarchar(300), ISNULL(c.[pq], N'')))) AS pq,
              COUNT_BIG(1) AS [rowCount],
              ISNULL(SUM(ISNULL(CONVERT(decimal(18, 6), c.[kcac04]), 0)), 0) AS totalKcac04,
              ISNULL(SUM(ISNULL(CONVERT(decimal(18, 6), c.[kcac06]), 0)), 0) AS totalKcac06
            FROM ${PI_COST_FROM} AS c
            GROUP BY
              LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(c.[sid], N'')))),
              LTRIM(RTRIM(CONVERT(nvarchar(300), ISNULL(c.[pq], N''))))
          ) AS pc
            ON pc.[sid] = LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(l.[xsak01], N''))))
           AND pc.[pq] = LTRIM(RTRIM(CONVERT(nvarchar(300), ISNULL(l.[kcaa01], N''))))
          ${whereSql}
        ) AS x
        WHERE x.rn BETWEEN @startRow AND @endRow
        ORDER BY x.rn
      `)

      res.json({
        code: 200,
        msg: 'success',
        data: { total, list: (listResult.recordset ?? []).map((row) => serializePiBomDataRow(row)) },
      })
    } catch (err) {
      console.error('GET /api/inventory/pi-bom-data/list 失败：', err)
      const detail = String(err?.message ?? err?.originalError?.message ?? '数据库查询失败')
      res.status(500).json({ code: 500, msg: `读取PI_BOM资料列表失败：${detail}`, data: null })
    }
  })

  app.get('/api/inventory/pi-bom-data/detail', async (req, res) => {
    try {
      const pool = await getPool()
      const orderId = Number(req.query?.orderId ?? 0)
      const product = String(req.query?.kcaa01 ?? '').trim()
      const ctx = await fetchPiBomDataViewerContext(pool, orderId, product)
      if (!ctx.ok) {
        res.status(ctx.status ?? 400).json({ code: ctx.status ?? 400, msg: ctx.msg, data: null })
        return
      }

      const [basic, tree, costRows] = await Promise.all([
        fetchPiBomDetailBasic(pool, ctx.piNo, ctx.kcaa01),
        fetchPiBomDetailTree(pool, ctx.piNo, ctx.kcaa01),
        fetchPiBomDetailCostRows(pool, ctx.piNo, ctx.kcaa01),
      ])
      const parts = flattenPiBomTreeForParts(tree)

      res.json({
        code: 200,
        msg: 'success',
        data: {
          orderId: ctx.orderId,
          lineId: ctx.lineId,
          piNo: ctx.piNo,
          kcaa01: ctx.kcaa01,
          orderPass: ctx.orderPass,
          basic,
          parts,
          tree,
          costRows,
        },
      })
    } catch (err) {
      console.error('GET /api/inventory/pi-bom-data/detail 失败：', err)
      const detail = String(err?.message ?? err?.originalError?.message ?? '数据查询失败')
      res.status(500).json({ code: 500, msg: `读取PI_BOM详情失败：${detail}`, data: null })
    }
  })
}
