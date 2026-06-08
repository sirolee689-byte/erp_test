/**
 * 库存基本资料：PI_BOM资料。
 * 首页列表按销售订单明细款展示：一行 = 一个 PI 号下的一个成品编码。
 */
import { sql } from './db.js'
import { resolveActorAuditTripletFromReq } from './businessAuditFields.js'
import { BOM_MATERIAL_FROM, BOM_PARTS_KCAA_SYNC_NAMES, INV_BOM_MASTER_FROM } from './bomTables.js'
import { PI_BOM_LIST_BOM000_OVERRIDE_COLS } from './salesOrderPiBomListFromParts.js'
import { buildSalesOrderCalcStatusExpr, pickSalesOrderCalcStatusColumn } from './salesOrderListQuery.js'
import {
  buildPiBomUsageTreeNodesFromLayerCache,
  fetchPiBomHeadSystemcode,
  prefetchPiBomListLayersForUsageTree,
  resolvePiBomUsageTreeRootKeysForProduct,
} from './salesOrderPiBomUsageTree.js'
import { newPiBomSystemcode } from './salesOrderPiBom.js'

const SALES_ORDER_HEADER_FROM = 'dbo.[UB_ERP_Sales_order]'
const SALES_ORDER_LINE_FROM = 'dbo.[UB_ERP_Sales_order_list]'
const PI_BOM_HEAD_FROM = 'dbo.[UB_ERP_Bom_Sales]'
const PI_BOM_LIST_FROM = 'dbo.[UB_ERP_Bom_Sales_list]'
const PI_COST_FROM = 'dbo.[UB_ERP_Bom_pi_cost]'
const PI_LIST_PKCAA01_EXPR = `LTRIM(RTRIM(CONVERT(nvarchar(300), ISNULL(l.[pkcaa01], N''))))`
const PI_LIST_KCAA01_EXPR = `LTRIM(RTRIM(CONVERT(nvarchar(300), ISNULL(l.[kcaa01], N''))))`
const PI_LIST_DESCRIBE_EXPR = `LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(l.[Describe], N''))))`
const BOM000_KCAA01_EXPR = `LTRIM(RTRIM(CONVERT(nvarchar(300), ISNULL(b.[kcaa01], N''))))`

/** 批量替换：不覆盖树键、用量、搭配、行身份 */
const PI_BOM_REPLACE_PRESERVE_LOWER = new Set([
  'id',
  'sid',
  'pkcaa01',
  'kcac01',
  'kcac02',
  'systemcode',
  'kcac04',
  'kcac05',
  'kcac06',
  'kcac07',
  'kcac08',
  'describe',
  'seq',
  'del',
  'addtime',
])

let salesOrderCalcStatusColumnPromise = null
let piBomListColumnSetPromise = null
let piBomHeadColumnSetPromise = null

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

function roundDecimal6(v) {
  const n = Number(String(v ?? '').replace(/,/g, '').trim())
  if (!Number.isFinite(n)) return 0
  return Math.round(n * 1e6) / 1e6
}

function parsePiBomPartSeq(v) {
  const n = Number(v)
  if (!Number.isFinite(n) || n < 0) return 0
  return Math.min(2147483647, Math.trunc(n))
}

function formatAuditTime(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

function usageChildKey(row) {
  const sc = String(row?.systemcode ?? '').trim()
  if (sc) return sc
  return String(row?.kcac02 ?? '').trim()
}

function normalizePiBomPartLine(raw, idx = 0) {
  const id = raw?.id != null && Number(raw.id) > 0 ? Math.trunc(Number(raw.id)) : null
  const pendingDelete = raw?.pendingDelete === true
  const kcaa01 = String(raw?.kcaa01 ?? '').trim()
  const kcac04 = roundDecimal6(raw?.kcac04)
  const kcac05 = roundDecimal6(raw?.kcac05)
  return {
    id,
    pendingDelete,
    kcaa01,
    kcaa02: String(raw?.kcaa02 ?? '').trim(),
    kcaa03: String(raw?.kcaa03 ?? '').trim(),
    kcaa04: String(raw?.kcaa04 ?? '').trim(),
    kcaa11: String(raw?.kcaa11 ?? '').trim(),
    kcac04,
    kcac05,
    kcac06: roundDecimal6(raw?.kcac06 ?? kcac04 * (1 + kcac05)),
    cost_price: roundDecimal6(raw?.cost_price),
    Describe: String(raw?.Describe ?? raw?.remark ?? '').trim(),
    Seq: parsePiBomPartSeq(raw?.Seq ?? raw?.seq ?? idx + 1),
  }
}

async function getPiBomListColumnSet(pool) {
  if (piBomListColumnSetPromise) return piBomListColumnSetPromise
  piBomListColumnSetPromise = (async () => {
    const r = await pool.request().query(`
      SELECT COLUMN_NAME AS name
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = N'dbo' AND TABLE_NAME = N'UB_ERP_Bom_Sales_list'
    `)
    return new Set((r.recordset ?? []).map((row) => String(row.name ?? '').trim().toLowerCase()).filter(Boolean))
  })().catch((err) => {
    piBomListColumnSetPromise = null
    throw err
  })
  return piBomListColumnSetPromise
}

async function getPiBomHeadColumnSet(pool) {
  if (piBomHeadColumnSetPromise) return piBomHeadColumnSetPromise
  piBomHeadColumnSetPromise = (async () => {
    const r = await pool.request().query(`
      SELECT COLUMN_NAME AS name
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = N'dbo' AND TABLE_NAME = N'UB_ERP_Bom_Sales'
    `)
    return new Set((r.recordset ?? []).map((row) => String(row.name ?? '').trim().toLowerCase()).filter(Boolean))
  })().catch((err) => {
    piBomHeadColumnSetPromise = null
    throw err
  })
  return piBomHeadColumnSetPromise
}

function serializePiBomListRowAsBasic(row, piNo, productKcaa01) {
  if (!row) return null
  return {
    systemcode: toText(row.systemcode ?? row.kcac02),
    piNo,
    kcaa01: toText(row.kcaa01),
    kcaa02: toText(row.kcaa02),
    kcaa02_en: '',
    kcaa03: toText(row.kcaa03),
    kcaa04: toText(row.kcaa04),
    kcaa05: toText(row.kcaa05),
    kcaa06: toText(row.kcaa06),
    kcaa09: toText(row.kcaa09),
    kcaa10: toText(row.kcaa10),
    kcaa11: toText(row.kcaa11),
    kcaa25: '',
    kcaa26: null,
    kcaa32: toNumberOrNull(row.kcaa33),
    kcaa33: toNumberOrNull(row.kcaa33),
    kcaa34: '',
    kcaa35: '',
    sale_price: null,
    cost_price: toNumberOrNull(row.cost_price),
    location: '',
    remark: toText(row.Describe),
    pass: '',
    addtime: null,
    edittime: null,
    _nodeFromList: true,
    _productKcaa01: productKcaa01,
  }
}

async function fetchPiBomNodeBasic(pool, piNo, productKcaa01, nodeSystemcode) {
  const nodeSc = String(nodeSystemcode ?? '').trim()
  const head = await fetchPiBomDetailBasic(pool, piNo, productKcaa01)
  const headSc = String(head?.systemcode ?? '').trim()
  if (!nodeSc || (headSc && nodeSc === headSc)) return head
  const r = await pool
    .request()
    .input('pi', sql.NVarChar(200), piNo)
    .input('product', sql.NVarChar(300), productKcaa01)
    .input('nodeSc', sql.NVarChar(500), nodeSc)
    .query(`
      SELECT TOP 1
        LTRIM(RTRIM(ISNULL(CAST(l.[systemcode] AS nvarchar(500)), N''))) AS systemcode,
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
        CAST(ISNULL(l.[cost_price], 0) AS decimal(18, 6)) AS cost_price,
        CAST(ISNULL(l.[kcaa33], 0) AS decimal(18, 6)) AS kcaa33,
        LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(l.[Describe], N'')))) AS Describe
      FROM ${PI_BOM_LIST_FROM} AS l
      WHERE LTRIM(RTRIM(ISNULL(l.[sid], N''))) = @pi
        AND ${PI_LIST_PKCAA01_EXPR} = @product
        AND (
          LTRIM(RTRIM(ISNULL(CAST(l.[systemcode] AS nvarchar(500)), N''))) = @nodeSc
          OR LTRIM(RTRIM(ISNULL(CAST(l.[kcac02] AS nvarchar(500)), N''))) = @nodeSc
        )
        AND (ISNULL(l.[del], N'') = N'' OR l.[del] = N'0')
      ORDER BY l.[id] DESC
    `)
  return serializePiBomListRowAsBasic(r.recordset?.[0] ?? null, piNo, productKcaa01)
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

async function fetchPiBomPartsForParent(pool, piNo, productKcaa01, parentSystemcode) {
  const parentSc = String(parentSystemcode ?? '').trim()
  if (!parentSc) return []
  const r = await pool
    .request()
    .input('pi', sql.NVarChar(200), piNo)
    .input('product', sql.NVarChar(300), productKcaa01)
    .input('parentSc', sql.NVarChar(500), parentSc)
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
        CAST(ISNULL(l.[cost_price], 0) AS decimal(18, 6)) AS cost_price,
        CAST(ISNULL(l.[kcaa33], 0) AS decimal(18, 6)) AS kcaa33,
        CONVERT(int, ISNULL(l.[seq], 0)) AS Seq,
        LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(l.[Describe], N'')))) AS Describe
      FROM ${PI_BOM_LIST_FROM} AS l
      WHERE LTRIM(RTRIM(ISNULL(l.[sid], N''))) = @pi
        AND ${PI_LIST_PKCAA01_EXPR} = @product
        AND LTRIM(RTRIM(ISNULL(CAST(l.[kcac01] AS nvarchar(500)), N''))) = @parentSc
        AND (ISNULL(l.[del], N'') = N'' OR l.[del] = N'0')
      ORDER BY ISNULL(l.[seq], l.[id]) ASC, l.[id] ASC
    `)
  return (r.recordset ?? []).map((row, idx) => serializePiBomPartRow(row, idx))
}

async function fetchAllPiBomPartRowsForProduct(db, piNo, productKcaa01) {
  const r = await new sql.Request(db)
    .input('pi', sql.NVarChar(200), piNo)
    .input('product', sql.NVarChar(300), productKcaa01)
    .query(`
      SELECT
        l.[id],
        LTRIM(RTRIM(ISNULL(CAST(l.[systemcode] AS nvarchar(500)), N''))) AS systemcode,
        LTRIM(RTRIM(ISNULL(CAST(l.[kcac01] AS nvarchar(500)), N''))) AS kcac01,
        LTRIM(RTRIM(ISNULL(CAST(l.[kcac02] AS nvarchar(500)), N''))) AS kcac02
      FROM ${PI_BOM_LIST_FROM} AS l
      WHERE LTRIM(RTRIM(ISNULL(l.[sid], N''))) = @pi
        AND ${PI_LIST_PKCAA01_EXPR} = @product
        AND (ISNULL(l.[del], N'') = N'' OR l.[del] = N'0')
    `)
  return r.recordset ?? []
}

function collectCascadeDeleteIds(allRows, rootIds) {
  const byParent = new Map()
  const byId = new Map()
  for (const row of allRows ?? []) {
    const id = Number(row?.id)
    if (!Number.isFinite(id) || id <= 0) continue
    byId.set(id, row)
    const parent = String(row?.kcac01 ?? '').trim()
    if (!byParent.has(parent)) byParent.set(parent, [])
    byParent.get(parent).push(row)
  }

  const out = new Set()
  const queue = []
  for (const rawId of rootIds ?? []) {
    const id = Number(rawId)
    if (!Number.isFinite(id) || id <= 0 || out.has(id)) continue
    const row = byId.get(id)
    if (!row) continue
    out.add(id)
    const childKey = usageChildKey(row)
    if (childKey) queue.push(childKey)
  }

  while (queue.length) {
    const parent = queue.shift()
    for (const row of byParent.get(parent) ?? []) {
      const id = Number(row?.id)
      if (!Number.isFinite(id) || id <= 0 || out.has(id)) continue
      out.add(id)
      const childKey = usageChildKey(row)
      if (childKey) queue.push(childKey)
    }
  }
  return [...out]
}

async function deletePiBomPartRowsByIds(tx, piNo, productKcaa01, ids) {
  const uniq = [...new Set((ids ?? []).map((id) => Number(id)).filter((id) => Number.isFinite(id) && id > 0))]
  let deleted = 0
  for (let i = 0; i < uniq.length; i += 80) {
    const chunk = uniq.slice(i, i + 80)
    const req = new sql.Request(tx)
    req.input('pi', sql.NVarChar(200), piNo)
    req.input('product', sql.NVarChar(300), productKcaa01)
    const inSql = chunk.map((id, idx) => {
      const p = `id${idx}`
      req.input(p, sql.Int, id)
      return `@${p}`
    })
    const r = await req.query(`
      DELETE FROM ${PI_BOM_LIST_FROM}
      WHERE LTRIM(RTRIM(ISNULL([sid], N''))) = @pi
        AND LTRIM(RTRIM(CONVERT(nvarchar(300), ISNULL([pkcaa01], N'')))) = @product
        AND [id] IN (${inSql.join(', ')})
    `)
    deleted += Number(r.rowsAffected?.[0] ?? 0)
  }
  return deleted
}

async function updatePiBomPartRow(tx, piNo, productKcaa01, parentSystemcode, row) {
  const req = new sql.Request(tx)
  req.input('id', sql.Int, row.id)
  req.input('pi', sql.NVarChar(200), piNo)
  req.input('product', sql.NVarChar(300), productKcaa01)
  req.input('parentSc', sql.NVarChar(500), parentSystemcode)
  req.input('kcaa01', sql.NVarChar(300), row.kcaa01)
  req.input('kcaa02', sql.NVarChar(500), row.kcaa02)
  req.input('kcaa03', sql.NVarChar(500), row.kcaa03)
  req.input('kcaa04', sql.NVarChar(100), row.kcaa04)
  req.input('kcaa11', sql.NVarChar(300), row.kcaa11)
  req.input('kcac04', sql.Decimal(18, 6), row.kcac04)
  req.input('kcac05', sql.Decimal(18, 6), row.kcac05)
  req.input('kcac06', sql.Decimal(18, 6), row.kcac06)
  req.input('cost_price', sql.Decimal(18, 6), row.cost_price)
  req.input('Describe', sql.NVarChar(500), row.Describe)
  req.input('Seq', sql.Int, row.Seq)
  const r = await req.query(`
    UPDATE l
    SET l.[kcaa01] = @kcaa01,
        l.[kcaa02] = @kcaa02,
        l.[kcaa03] = @kcaa03,
        l.[kcaa04] = @kcaa04,
        l.[kcaa11] = @kcaa11,
        l.[kcac04] = @kcac04,
        l.[kcac05] = @kcac05,
        l.[kcac06] = @kcac06,
        l.[cost_price] = @cost_price,
        l.[Describe] = @Describe,
        l.[Seq] = @Seq
    FROM ${PI_BOM_LIST_FROM} AS l
    WHERE l.[id] = @id
      AND LTRIM(RTRIM(ISNULL(l.[sid], N''))) = @pi
      AND ${PI_LIST_PKCAA01_EXPR} = @product
      AND LTRIM(RTRIM(ISNULL(CAST(l.[kcac01] AS nvarchar(500)), N''))) = @parentSc
  `)
  return Number(r.rowsAffected?.[0] ?? 0)
}

async function insertPiBomPartRow(tx, colset, piNo, productKcaa01, parentSystemcode, row, actor) {
  if (!row.kcaa01) throw new Error('新增配件缺少编码')
  const systemcode = newPiBomSystemcode()
  const addtime = formatAuditTime()
  const cols = []
  const vals = []
  const req = new sql.Request(tx)

  function add(name, type, value) {
    const lower = name.toLowerCase()
    if (!colset.has(lower)) return
    const p = `p_${lower.replace(/[^a-z0-9_]/g, '')}`
    req.input(p, type, value)
    cols.push(`[${name}]`)
    vals.push(`@${p}`)
  }

  add('sid', sql.NVarChar(200), piNo)
  add('pkcaa01', sql.NVarChar(300), productKcaa01)
  add('kcac01', sql.NVarChar(500), parentSystemcode)
  add('kcac02', sql.NVarChar(500), systemcode)
  add('systemcode', sql.NVarChar(500), systemcode)
  add('kcaa01', sql.NVarChar(300), row.kcaa01)
  add('kcaa02', sql.NVarChar(500), row.kcaa02)
  add('kcaa03', sql.NVarChar(500), row.kcaa03)
  add('kcaa04', sql.NVarChar(100), row.kcaa04)
  add('kcaa11', sql.NVarChar(300), row.kcaa11)
  add('kcac04', sql.Decimal(18, 6), row.kcac04)
  add('kcac05', sql.Decimal(18, 6), row.kcac05)
  add('kcac06', sql.Decimal(18, 6), row.kcac06)
  add('cost_price', sql.Decimal(18, 6), row.cost_price)
  add('Describe', sql.NVarChar(500), row.Describe)
  add('Seq', sql.Int, row.Seq)
  add('del', sql.NVarChar(20), '0')
  add('uid', sql.NVarChar(50), actor?.uidInt != null ? String(actor.uidInt) : '')
  add('uname', sql.NVarChar(100), String(actor?.uname ?? ''))
  add('utruename', sql.NVarChar(100), String(actor?.utruename ?? ''))
  add('addtime', sql.NVarChar(50), addtime)

  if (!cols.length) throw new Error('UB_ERP_Bom_Sales_list 未找到可写字段')
  const r = await req.query(`
    INSERT INTO ${PI_BOM_LIST_FROM} (${cols.join(', ')})
    OUTPUT INSERTED.[id] AS id
    VALUES (${vals.join(', ')})
  `)
  return Number(r.recordset?.[0]?.id ?? 0)
}

async function markSalesOrderUncalculated(tx, orderId, actor, calcStatusColumn = 'is_pur') {
  const statusCol = String(calcStatusColumn || 'is_pur').replace(/]/g, ']]')
  const req = new sql.Request(tx)
  req.input('orderId', sql.Int, orderId)
  req.input('uid', sql.NVarChar(50), actor?.uidInt != null ? String(actor.uidInt) : '')
  req.input('uname', sql.NVarChar(100), String(actor?.uname ?? ''))
  req.input('utruename', sql.NVarChar(100), String(actor?.utruename ?? ''))
  req.input('edittime', sql.NVarChar(50), formatAuditTime())
  await req.query(`
    UPDATE ${SALES_ORDER_HEADER_FROM}
    SET [${statusCol}] = N'0',
        [uid] = @uid,
        [uname] = @uname,
        [utruename] = @utruename,
        [edittime] = @edittime
    WHERE [id] = @orderId
  `)
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

function resolvePiBomReplaceSyncColumns(listColset) {
  const cols = []
  const seen = new Set()
  const add = (col) => {
    const name = String(col ?? '').trim()
    const lower = name.toLowerCase()
    if (!name || PI_BOM_REPLACE_PRESERVE_LOWER.has(lower) || seen.has(lower)) return
    if (!listColset.has(lower)) return
    seen.add(lower)
    cols.push(name)
  }
  for (const col of BOM_PARTS_KCAA_SYNC_NAMES) add(col)
  for (const col of PI_BOM_LIST_BOM000_OVERRIDE_COLS) add(col)
  return cols
}

function quoteSqlBracketCol(tableAlias, col) {
  const safe = String(col ?? '').replace(/]/g, '')
  return `${tableAlias}.[${safe}]`
}

export function buildPiBomReplaceBomSelectList(syncCols) {
  return syncCols
    .map((col) => {
      const safe = String(col ?? '').replace(/]/g, '')
      const lower = safe.toLowerCase()
      const sourceExpr = lower === 'kcac03' ? 'b.[kcaa25]' : quoteSqlBracketCol('b', safe)
      return `${sourceExpr} AS [${safe}]`
    })
    .join(',\n          ')
}

async function fetchPiBomOrderContextByPiNo(pool, piNo) {
  const pi = String(piNo ?? '').trim()
  if (!pi) return { ok: false, status: 400, msg: '请填写 PI 号' }
  const r = await pool.request().input('pi', sql.NVarChar(200), pi).query(`
    SELECT TOP 1
      h.[id] AS orderId,
      LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(h.[xsaj01], N'')))) AS piNo
    FROM ${SALES_ORDER_HEADER_FROM} AS h
    WHERE LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(h.[xsaj01], N'')))) = @pi
      AND (ISNULL(h.[del], N'') = N'' OR h.[del] = N'0')
    ORDER BY h.[id] DESC
  `)
  const row = r.recordset?.[0]
  if (!row) return { ok: false, status: 404, msg: `未找到 PI 号「${pi}」对应的在册销售订单` }
  return {
    ok: true,
    orderId: Number(row.orderId),
    piNo: String(row.piNo ?? '').trim(),
  }
}

async function assertBom000TargetMaterialExists(pool, targetKcaa01) {
  const target = String(targetKcaa01 ?? '').trim()
  if (!target) return { ok: false, status: 400, msg: '请填写目标物料编码' }
  const r = await pool.request().input('target', sql.NVarChar(300), target).query(`
    SELECT TOP 1
      ${BOM000_KCAA01_EXPR} AS kcaa01,
      LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(b.[kcaa02], N'')))) AS kcaa02
    FROM ${INV_BOM_MASTER_FROM} AS b
    WHERE ${BOM000_KCAA01_EXPR} = LTRIM(RTRIM(@target))
      AND (ISNULL(b.[del], N'') = N'' OR LTRIM(RTRIM(ISNULL(CONVERT(nvarchar(20), b.[del]), N''))) = N'0')
    ORDER BY b.[id] DESC
  `)
  const row = r.recordset?.[0]
  if (!row) {
    return { ok: false, status: 400, msg: `目标物料「${target}」在物料档案中不存在，无法替换` }
  }
  return { ok: true, target, kcaa02: String(row.kcaa02 ?? '').trim() }
}

function bindPiBomReplaceFilterInputs(req, { piNo, pqCode, sourceCode, matchDescribe, hasPq }) {
  req.input('pi', sql.NVarChar(200), piNo)
  req.input('source', sql.NVarChar(300), sourceCode)
  req.input('matchDescribe', sql.NVarChar(500), String(matchDescribe ?? '').trim())
  if (hasPq) req.input('pq', sql.NVarChar(300), pqCode)
}

/** @param {boolean} hasPq */
export function buildPiBomReplaceWhereSql(hasPq) {
  const parts = [
    `LTRIM(RTRIM(ISNULL(l.[sid], N''))) = @pi`,
    `${PI_LIST_KCAA01_EXPR} = @source`,
    `(ISNULL(l.[del], N'') = N'' OR l.[del] = N'0')`,
    `${PI_LIST_DESCRIBE_EXPR} = @matchDescribe`,
  ]
  if (hasPq) parts.push(`${PI_LIST_PKCAA01_EXPR} = @pq`)
  return parts.join('\n        AND ')
}

async function countPiBomReplaceMatches(pool, filters) {
  const req = pool.request()
  bindPiBomReplaceFilterInputs(req, filters)
  const r = await req.query(`
    SELECT COUNT(1) AS matchedCount
    FROM ${PI_BOM_LIST_FROM} AS l
    WHERE ${buildPiBomReplaceWhereSql(filters.hasPq)}
  `)
  return Number(r.recordset?.[0]?.matchedCount ?? 0)
}

async function executePiBomMaterialReplace(tx, opts) {
  const {
    piNo,
    pqCode,
    sourceCode,
    targetCode,
    matchDescribe,
    hasPq,
    syncCols,
    listColset,
    actor,
    nowStr,
  } = opts
  if (!syncCols.length) throw new Error('明细表无可同步的物料字段')

  const req = new sql.Request(tx)
  req.input('pi', sql.NVarChar(200), piNo)
  req.input('source', sql.NVarChar(300), sourceCode)
  req.input('target', sql.NVarChar(300), targetCode)
  if (hasPq) req.input('pq', sql.NVarChar(300), pqCode)
  req.input('matchDescribe', sql.NVarChar(500), String(matchDescribe ?? '').trim())

  const bomSelect = buildPiBomReplaceBomSelectList(syncCols)
  const setParts = syncCols.map((col) => `${quoteSqlBracketCol('l', col)} = ${quoteSqlBracketCol('b', col)}`)
  if (listColset.has('edittime')) {
    setParts.push('l.[edittime] = @edittime')
    req.input('edittime', sql.NVarChar(50), nowStr)
  }
  if (listColset.has('uid')) {
    setParts.push('l.[uid] = @uid')
    req.input('uid', sql.NVarChar(50), actor?.uidInt != null ? String(actor.uidInt) : '')
  }
  if (listColset.has('uname')) {
    setParts.push('l.[uname] = @uname')
    req.input('uname', sql.NVarChar(100), String(actor?.uname ?? ''))
  }
  if (listColset.has('utruename')) {
    setParts.push('l.[utruename] = @utruename')
    req.input('utruename', sql.NVarChar(100), String(actor?.utruename ?? ''))
  }

  const r = await req.query(`
    UPDATE l
    SET ${setParts.join(',\n        ')}
    FROM ${PI_BOM_LIST_FROM} AS l
    CROSS APPLY (
      SELECT TOP 1
        ${bomSelect}
      FROM ${INV_BOM_MASTER_FROM} AS b
      WHERE ${BOM000_KCAA01_EXPR} = LTRIM(RTRIM(@target))
        AND (ISNULL(b.[del], N'') = N'' OR LTRIM(RTRIM(ISNULL(CONVERT(nvarchar(20), b.[del]), N''))) = N'0')
      ORDER BY b.[id] DESC
    ) AS b
    WHERE ${buildPiBomReplaceWhereSql(hasPq)}
  `)
  return Number(r.rowsAffected?.[0] ?? 0)
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

      const basic = await fetchPiBomDetailBasic(pool, ctx.piNo, ctx.kcaa01)
      const [parts, tree, costRows] = await Promise.all([
        fetchPiBomPartsForParent(pool, ctx.piNo, ctx.kcaa01, basic?.systemcode),
        fetchPiBomDetailTree(pool, ctx.piNo, ctx.kcaa01),
        fetchPiBomDetailCostRows(pool, ctx.piNo, ctx.kcaa01),
      ])

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

  app.get('/api/inventory/pi-bom-data/parts', async (req, res) => {
    try {
      const pool = await getPool()
      const orderId = Number(req.query?.orderId ?? 0)
      const product = String(req.query?.kcaa01 ?? '').trim()
      const parentSystemcode = String(req.query?.parentSystemcode ?? '').trim()
      const ctx = await fetchPiBomDataViewerContext(pool, orderId, product)
      if (!ctx.ok) {
        res.status(ctx.status ?? 400).json({ code: ctx.status ?? 400, msg: ctx.msg, data: null })
        return
      }
      if (!parentSystemcode) {
        res.status(400).json({ code: 400, msg: '缺少父级systemcode', data: null })
        return
      }

      const parts = await fetchPiBomPartsForParent(pool, ctx.piNo, ctx.kcaa01, parentSystemcode)
      res.json({
        code: 200,
        msg: 'success',
        data: {
          orderId: ctx.orderId,
          piNo: ctx.piNo,
          kcaa01: ctx.kcaa01,
          parentSystemcode,
          parts,
        },
      })
    } catch (err) {
      console.error('GET /api/inventory/pi-bom-data/parts 失败：', err)
      const detail = String(err?.message ?? err?.originalError?.message ?? '数据查询失败')
      res.status(500).json({ code: 500, msg: `读取PI_BOM配件明细失败：${detail}`, data: null })
    }
  })

  app.get('/api/inventory/pi-bom-data/node-basic', async (req, res) => {
    try {
      const pool = await getPool()
      const orderId = Number(req.query?.orderId ?? 0)
      const product = String(req.query?.kcaa01 ?? '').trim()
      const nodeSystemcode = String(req.query?.nodeSystemcode ?? '').trim()
      const ctx = await fetchPiBomDataViewerContext(pool, orderId, product)
      if (!ctx.ok) {
        res.status(ctx.status ?? 400).json({ code: ctx.status ?? 400, msg: ctx.msg, data: null })
        return
      }
      if (!nodeSystemcode) {
        res.status(400).json({ code: 400, msg: '缺少 nodeSystemcode', data: null })
        return
      }
      const basic = await fetchPiBomNodeBasic(pool, ctx.piNo, ctx.kcaa01, nodeSystemcode)
      if (!basic) {
        res.status(404).json({ code: 404, msg: '未找到该层 PI-BOM 节点资料', data: null })
        return
      }
      res.json({
        code: 200,
        msg: 'success',
        data: {
          orderId: ctx.orderId,
          piNo: ctx.piNo,
          kcaa01: ctx.kcaa01,
          nodeSystemcode,
          basic,
        },
      })
    } catch (err) {
      console.error('GET /api/inventory/pi-bom-data/node-basic 失败：', err)
      const detail = String(err?.message ?? err?.originalError?.message ?? '数据查询失败')
      res.status(500).json({ code: 500, msg: `读取PI_BOM节点资料失败：${detail}`, data: null })
    }
  })

  /**
   * PI-BOM 资料：替换面板联想（只返回编码）
   * - PI 候选：销售订单已审核在册的 PI
   * - PQ 候选：UB_ERP_Bom_Sales_list 下该 PI 的 pkcaa01
   * - 物料候选：bom_000（只校验存在性/编码相关，不限制是否已出现在该 PI）
   * - 搭配候选：UB_ERP_Bom_Sales_list 下 Describe（可选按 PQ 缩小）
   */
  app.get('/api/inventory/pi-bom-data/pi-suggest', async (req, res) => {
    try {
      const keyword = String(req.query?.keyword ?? '').trim()
      if (!keyword) {
        res.json({ code: 200, msg: 'success', data: { list: [] } })
        return
      }
      const pool = await getPool()
      const r = await pool
        .request()
        .input('keyword', sql.NVarChar(300), `%${escapeSqlLikePattern(keyword)}%`)
        .query(`
          SELECT TOP 20
            h.[id],
            LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(h.[xsaj01], N'')))) AS piNo
          FROM ${SALES_ORDER_HEADER_FROM} AS h
          WHERE (ISNULL(h.[del], N'') = N'' OR h.[del] = N'0')
            AND LTRIM(RTRIM(ISNULL(h.[pass], N''))) = N'1'
            AND LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(h.[xsaj01], N'')))) LIKE @keyword
          ORDER BY h.[id] DESC
        `)
      const list = (r.recordset ?? [])
        .map((row) => String(row?.piNo ?? '').trim())
        .filter((pi) => !!pi)
        .map((pi) => ({ code: pi }))
      res.json({ code: 200, msg: 'success', data: { list } })
    } catch (err) {
      console.error('GET /api/inventory/pi-bom-data/pi-suggest 失败：', err)
      const detail = String(err?.message ?? err?.originalError?.message ?? '查询失败')
      res.status(500).json({ code: 500, msg: `读取 PI 候选失败：${detail}`, data: null })
    }
  })

  app.get('/api/inventory/pi-bom-data/pq-suggest', async (req, res) => {
    try {
      const piNo = String(req.query?.piNo ?? '').trim()
      const keyword = String(req.query?.keyword ?? '').trim()
      if (!piNo) {
        res.json({ code: 200, msg: 'success', data: { list: [] } })
        return
      }
      const pool = await getPool()
      const listReq = pool
        .request()
        .input('pi', sql.NVarChar(200), piNo)
      if (keyword) listReq.input('keyword', sql.NVarChar(300), `%${escapeSqlLikePattern(keyword)}%`)

      const whereParts = [
        `LTRIM(RTRIM(ISNULL(l.[sid], N''))) = @pi`,
        `(ISNULL(l.[del], N'') = N'' OR l.[del] = N'0')`,
        `${PI_LIST_PKCAA01_EXPR} <> N''`,
        keyword
          ? `${PI_LIST_PKCAA01_EXPR} LIKE @keyword`
          : '1=1',
      ]

      const r = await listReq.query(`
        SELECT DISTINCT TOP 20
          ${PI_LIST_PKCAA01_EXPR} AS code
        FROM ${PI_BOM_LIST_FROM} AS l
        WHERE ${whereParts.join('\n          AND ')}
        ORDER BY code DESC
      `)
      const list = (r.recordset ?? []).map((row) => ({ code: String(row?.code ?? '').trim() })).filter((x) => !!x.code)
      res.json({ code: 200, msg: 'success', data: { list } })
    } catch (err) {
      console.error('GET /api/inventory/pi-bom-data/pq-suggest 失败：', err)
      const detail = String(err?.message ?? err?.originalError?.message ?? '查询失败')
      res.status(500).json({ code: 500, msg: `读取 PQ 候选失败：${detail}`, data: null })
    }
  })

  app.get('/api/inventory/pi-bom-data/material-suggest', async (req, res) => {
    try {
      const piNo = String(req.query?.piNo ?? '').trim()
      const keyword = String(req.query?.keyword ?? '').trim()
      const pqCode = String(req.query?.pqCode ?? '').trim()
      if (!piNo || !keyword) {
        res.json({ code: 200, msg: 'success', data: { list: [] } })
        return
      }
      const pool = await getPool()
      const pattern = `%${escapeSqlLikePattern(keyword)}%`

      const listReq = pool.request().input('pi', sql.NVarChar(200), piNo).input('keyword', sql.NVarChar(500), pattern)
      if (pqCode) listReq.input('pq', sql.NVarChar(300), pqCode)

      const whereParts = [
        `LTRIM(RTRIM(ISNULL(l.[sid], N''))) = @pi`,
        `(ISNULL(l.[del], N'') = N'' OR l.[del] = N'0')`,
        `${PI_LIST_KCAA01_EXPR} <> N''`,
        `${PI_LIST_KCAA01_EXPR} LIKE @keyword`,
      ]
      if (pqCode) whereParts.push(`${PI_LIST_PKCAA01_EXPR} = @pq`)

      const r = await listReq.query(`
        SELECT DISTINCT TOP 20
          ${PI_LIST_KCAA01_EXPR} AS code
        FROM ${PI_BOM_LIST_FROM} AS l
        WHERE ${whereParts.join('\n          AND ')}
        ORDER BY code DESC
      `)

      const list = (r.recordset ?? []).map((row) => ({ code: String(row?.code ?? '').trim() })).filter((x) => !!x.code)
      res.json({ code: 200, msg: 'success', data: { list } })
    } catch (err) {
      console.error('GET /api/inventory/pi-bom-data/material-suggest 失败：', err)
      const detail = String(err?.message ?? err?.originalError?.message ?? '查询失败')
      res.status(500).json({ code: 500, msg: `读取物料候选失败：${detail}`, data: null })
    }
  })

  app.get('/api/inventory/pi-bom-data/match-suggest', async (req, res) => {
    try {
      const piNo = String(req.query?.piNo ?? '').trim()
      const pqCode = String(req.query?.pqCode ?? '').trim()
      const keyword = String(req.query?.keyword ?? '').trim()
      if (!piNo) {
        res.json({ code: 200, msg: 'success', data: { list: [] } })
        return
      }
      const pool = await getPool()
      const listReq = pool
        .request()
        .input('pi', sql.NVarChar(200), piNo)
      if (pqCode) listReq.input('pq', sql.NVarChar(300), pqCode)
      if (keyword) listReq.input('keyword', sql.NVarChar(500), `%${escapeSqlLikePattern(keyword)}%`)

      const whereParts = [
        `LTRIM(RTRIM(ISNULL(l.[sid], N''))) = @pi`,
        `(ISNULL(l.[del], N'') = N'' OR l.[del] = N'0')`,
        `${PI_LIST_DESCRIBE_EXPR} <> N''`,
      ]
      if (pqCode) whereParts.push(`${PI_LIST_PKCAA01_EXPR} = @pq`)
      if (keyword) whereParts.push(`${PI_LIST_DESCRIBE_EXPR} LIKE @keyword`)

      const r = await listReq.query(`
        SELECT DISTINCT TOP 20
          ${PI_LIST_DESCRIBE_EXPR} AS code
        FROM ${PI_BOM_LIST_FROM} AS l
        WHERE ${whereParts.join('\n          AND ')}
        ORDER BY code DESC
      `)
      const list = (r.recordset ?? []).map((row) => ({ code: String(row?.code ?? '').trim() })).filter((x) => !!x.code)
      res.json({ code: 200, msg: 'success', data: { list } })
    } catch (err) {
      console.error('GET /api/inventory/pi-bom-data/match-suggest 失败：', err)
      const detail = String(err?.message ?? err?.originalError?.message ?? '查询失败')
      res.status(500).json({ code: 500, msg: `读取搭配候选失败：${detail}`, data: null })
    }
  })

  app.put('/api/inventory/pi-bom-data/basic', async (req, res) => {
    let tx = null
    try {
      const pool = await getPool()
      const body = req.body ?? {}
      const orderId = Number(body.orderId ?? 0)
      const product = String(body.kcaa01 ?? '').trim()
      const systemcode = String(body.systemcode ?? '').trim()
      const ctx = await fetchPiBomDataViewerContext(pool, orderId, product)
      if (!ctx.ok) {
        res.status(ctx.status ?? 400).json({ code: ctx.status ?? 400, msg: ctx.msg, data: null })
        return
      }
      if (!systemcode) {
        res.status(400).json({ code: 400, msg: '缺少 systemcode，无法保存主档', data: null })
        return
      }
      const kcaa02 = String(body.kcaa02 ?? '').trim()
      const kcaa05 = String(body.kcaa05 ?? '').trim()
      const kcaa04 = String(body.kcaa04 ?? '').trim()
      const kcaa25 = String(body.kcaa25 ?? '').trim()
      if (!kcaa02) {
        res.status(400).json({ code: 400, msg: '名称不能为空', data: null })
        return
      }
      if (!kcaa05 || !kcaa04 || !kcaa25) {
        res.status(400).json({ code: 400, msg: '分类、使用单位、采购单位不能为空', data: null })
        return
      }

      const colset = await getPiBomHeadColumnSet(pool)
      const actor = await resolveActorAuditTripletFromReq(pool, req)
      const nowStr = formatAuditTime()
      const str = (k, max = 800) => {
        let s = String(body[k] ?? '').trim()
        if (s.length > max) s = s.slice(0, max)
        return s
      }
      const decNum = (k) => {
        const raw = body[k]
        if (raw === '' || raw === null || raw === undefined) return null
        const n = Number(raw)
        return Number.isFinite(n) ? n : null
      }
      const dirInt = (k) => {
        const n = Number(body[k])
        if (n === 0 || n === 1) return n
        return 0
      }

      const calcStatusColumn = await ensureSalesOrderCalcStatusColumn(pool)
      tx = new sql.Transaction(pool)
      await tx.begin()

      const setParts = []
      const upd = new sql.Request(tx)
      upd.input('pi', sql.NVarChar(200), ctx.piNo)
      upd.input('product', sql.NVarChar(300), ctx.kcaa01)
      upd.input('systemcode', sql.NVarChar(500), systemcode)

      const setNvarchar = (col, param, val, len) => {
        if (!colset.has(col.toLowerCase())) return
        setParts.push(`[${col}] = @${param}`)
        upd.input(param, sql.NVarChar(len), val ?? '')
      }

      setNvarchar('kcaa02', 'kcaa02', kcaa02, 500)
      setNvarchar('kcaa02_en', 'kcaa02_en', str('kcaa02_en', 500), 500)
      setNvarchar('kcaa03', 'kcaa03', str('kcaa03', 500), 500)
      setNvarchar('kcaa05', 'kcaa05', kcaa05, 200)
      setNvarchar('kcaa06', 'kcaa06', str('kcaa06', 300), 300)
      setNvarchar('kcaa09', 'kcaa09', str('kcaa09', 300), 300)
      setNvarchar('kcaa10', 'kcaa10', str('kcaa10', 200), 200)
      setNvarchar('kcaa11', 'kcaa11', str('kcaa11', 200), 200)
      setNvarchar('location', 'location', str('location', 200) || '国内', 200)
      setNvarchar('kcaa04', 'kcaa04', kcaa04, 100)
      setNvarchar('kcaa25', 'kcaa25', kcaa25, 100)
      setNvarchar('kcaa29', 'kcaa29', str('kcaa29', 100), 100)
      setNvarchar('kcaa34', 'kcaa34', str('kcaa34', 80), 80)
      setNvarchar('kcaa35', 'kcaa35', str('kcaa35', 80), 80)
      setNvarchar('remark', 'remark', str('remark', 2000), 2000)

      if (colset.has('kcaa27')) {
        setParts.push('[kcaa27] = @kcaa27')
        upd.input('kcaa27', sql.Int, dirInt('kcaa27'))
      }
      if (colset.has('kcaa31')) {
        setParts.push('[kcaa31] = @kcaa31')
        upd.input('kcaa31', sql.Int, dirInt('kcaa31'))
      }

      const setDec = (col, param) => {
        if (!colset.has(col.toLowerCase())) return
        const n = decNum(param)
        setParts.push(`[${col}] = @${param}`)
        upd.input(param, sql.Decimal(18, 6), n != null ? n : 0)
      }
      setDec('kcaa26', 'kcaa26')
      setDec('kcaa30', 'kcaa30')
      setDec('kcaa32', 'kcaa32')
      setDec('kcaa33', 'kcaa33')
      setDec('sale_price', 'sale_price')
      setDec('cost_price', 'cost_price')

      if (colset.has('edittime')) {
        setParts.push('[edittime] = @edittime')
        upd.input('edittime', sql.NVarChar(50), nowStr)
      }
      if (colset.has('uid')) {
        setParts.push('[uid] = @uid')
        upd.input('uid', sql.NVarChar(50), actor?.uidInt != null ? String(actor.uidInt) : '')
      }
      if (colset.has('uname')) {
        setParts.push('[uname] = @uname')
        upd.input('uname', sql.NVarChar(100), String(actor?.uname ?? ''))
      }
      if (colset.has('utruename')) {
        setParts.push('[utruename] = @utruename')
        upd.input('utruename', sql.NVarChar(100), String(actor?.utruename ?? ''))
      }

      if (!setParts.length) {
        res.status(400).json({ code: 400, msg: '无可更新字段', data: null })
        return
      }

      const qr = await upd.query(`
        UPDATE ${PI_BOM_HEAD_FROM}
        SET ${setParts.join(', ')}
        WHERE LTRIM(RTRIM(ISNULL([sid], N''))) = @pi
          AND LTRIM(RTRIM(CONVERT(nvarchar(300), ISNULL([kcaa01], N'')))) = @product
          AND LTRIM(RTRIM(ISNULL(CAST([systemcode] AS nvarchar(500)), N''))) = @systemcode
      `)
      if ((qr.rowsAffected?.[0] ?? 0) <= 0) {
        await tx.rollback()
        tx = null
        res.status(400).json({ code: 400, msg: '保存失败：PI-BOM 主档不存在或 systemcode 不匹配', data: null })
        return
      }
      await markSalesOrderUncalculated(tx, ctx.orderId, actor, calcStatusColumn)
      await tx.commit()
      tx = null

      const basic = await fetchPiBomDetailBasic(pool, ctx.piNo, ctx.kcaa01)
      res.json({
        code: 200,
        msg: 'success',
        data: {
          orderId: ctx.orderId,
          piNo: ctx.piNo,
          kcaa01: ctx.kcaa01,
          systemcode,
          basic,
        },
      })
    } catch (err) {
      if (tx) {
        try {
          await tx.rollback()
        } catch (rollbackErr) {
          console.error('PUT /api/inventory/pi-bom-data/basic rollback 失败：', rollbackErr)
        }
      }
      console.error('PUT /api/inventory/pi-bom-data/basic 失败：', err)
      const detail = String(err?.message ?? err?.originalError?.message ?? '保存失败')
      res.status(500).json({ code: 500, msg: `保存PI_BOM主档失败：${detail}`, data: null })
    }
  })

  app.put('/api/inventory/pi-bom-data/parts', async (req, res) => {
    let tx = null
    try {
      const pool = await getPool()
      const orderId = Number(req.body?.orderId ?? 0)
      const product = String(req.body?.kcaa01 ?? '').trim()
      const parentSystemcode = String(req.body?.parentSystemcode ?? '').trim()
      const rawLines = Array.isArray(req.body?.lines) ? req.body.lines : []
      const ctx = await fetchPiBomDataViewerContext(pool, orderId, product)
      if (!ctx.ok) {
        res.status(ctx.status ?? 400).json({ code: ctx.status ?? 400, msg: ctx.msg, data: null })
        return
      }
      if (!parentSystemcode) {
        res.status(400).json({ code: 400, msg: '缺少父级systemcode，无法保存配件明细', data: null })
        return
      }
      if (!rawLines.length) {
        res.status(400).json({ code: 400, msg: '没有需要保存的配件明细', data: null })
        return
      }

      const lines = rawLines.map((row, idx) => normalizePiBomPartLine(row, idx))
      for (const row of lines) {
        if (row.pendingDelete) continue
        if (!row.kcaa01) {
          res.status(400).json({ code: 400, msg: '存在未选择编码的配件明细，请补齐后再保存', data: null })
          return
        }
        for (const key of ['kcac04', 'kcac05', 'kcac06', 'cost_price']) {
          const val = Number(row[key] ?? 0)
          if (!Number.isFinite(val) || val < 0) {
            res.status(400).json({ code: 400, msg: '配件明细的用量、损耗、单价不能为负数', data: null })
            return
          }
        }
      }

      const actor = await resolveActorAuditTripletFromReq(pool, req)
      const colset = await getPiBomListColumnSet(pool)
      const calcStatusColumn = await ensureSalesOrderCalcStatusColumn(pool)
      tx = new sql.Transaction(pool)
      await tx.begin()

      const deleteRootIds = lines
        .filter((row) => row.pendingDelete && Number(row.id) > 0)
        .map((row) => Number(row.id))
      let deletedIds = []
      if (deleteRootIds.length) {
        const allRows = await fetchAllPiBomPartRowsForProduct(tx, ctx.piNo, ctx.kcaa01)
        deletedIds = collectCascadeDeleteIds(allRows, deleteRootIds)
        await deletePiBomPartRowsByIds(tx, ctx.piNo, ctx.kcaa01, deletedIds)
      }

      let inserted = 0
      let updated = 0
      for (const row of lines) {
        if (row.pendingDelete) continue
        if (Number(row.id) > 0) {
          const affected = await updatePiBomPartRow(tx, ctx.piNo, ctx.kcaa01, parentSystemcode, row)
          if (!affected) throw new Error(`配件明细已变化或不属于当前层级，无法保存：${row.kcaa01}`)
          updated += affected
        } else {
          await insertPiBomPartRow(tx, colset, ctx.piNo, ctx.kcaa01, parentSystemcode, row, actor)
          inserted += 1
        }
      }

      await markSalesOrderUncalculated(tx, ctx.orderId, actor, calcStatusColumn)
      await tx.commit()
      tx = null

      const parts = await fetchPiBomPartsForParent(pool, ctx.piNo, ctx.kcaa01, parentSystemcode)
      res.json({
        code: 200,
        msg: 'success',
        data: {
          orderId: ctx.orderId,
          piNo: ctx.piNo,
          kcaa01: ctx.kcaa01,
          parentSystemcode,
          parts,
          inserted,
          updated,
          deleted: deletedIds.length,
        },
      })
    } catch (err) {
      if (tx) {
        try {
          await tx.rollback()
        } catch (rollbackErr) {
          console.error('PUT /api/inventory/pi-bom-data/parts rollback 失败：', rollbackErr)
        }
      }
      console.error('PUT /api/inventory/pi-bom-data/parts 失败：', err)
      const detail = String(err?.message ?? err?.originalError?.message ?? '保存失败')
      res.status(500).json({ code: 500, msg: `保存PI_BOM配件明细失败：${detail}`, data: null })
    }
  })

  app.post('/api/inventory/pi-bom-data/replace-material', async (req, res) => {
    let tx = null
    try {
      const pool = await getPool()
      const piNo = String(req.body?.piNo ?? '').trim()
      const pqCode = String(req.body?.pqCode ?? '').trim()
      const sourceCode = String(req.body?.sourceCode ?? '').trim()
      const targetCode = String(req.body?.targetCode ?? '').trim()
      const matchDescribe = String(req.body?.matchDescribe ?? '').trim()
      const dryRun = req.body?.dryRun === true

      if (!piNo) {
        res.status(400).json({ code: 400, msg: '请填写 PI 号', data: null })
        return
      }
      if (!sourceCode) {
        res.status(400).json({ code: 400, msg: '请填写物料源编码', data: null })
        return
      }
      if (!targetCode) {
        res.status(400).json({ code: 400, msg: '请填写目标物料编码', data: null })
        return
      }
      if (sourceCode === targetCode) {
        res.status(400).json({ code: 400, msg: '物料源编码与目标物料编码不能相同', data: null })
        return
      }

      const orderCtx = await fetchPiBomOrderContextByPiNo(pool, piNo)
      if (!orderCtx.ok) {
        res.status(orderCtx.status ?? 400).json({ code: orderCtx.status ?? 400, msg: orderCtx.msg, data: null })
        return
      }

      const targetCtx = await assertBom000TargetMaterialExists(pool, targetCode)
      if (!targetCtx.ok) {
        res.status(targetCtx.status ?? 400).json({ code: targetCtx.status ?? 400, msg: targetCtx.msg, data: null })
        return
      }

      const hasPq = !!pqCode
      const filters = {
        piNo: orderCtx.piNo,
        pqCode,
        sourceCode,
        matchDescribe,
        hasPq,
      }
      const matchedCount = await countPiBomReplaceMatches(pool, filters)
      if (matchedCount <= 0) {
        res.status(400).json({
          code: 400,
          msg: '未找到符合条件的 PI-BOM 配件明细行，未执行任何替换',
          data: { matchedCount: 0, updatedCount: 0, dryRun },
        })
        return
      }

      if (dryRun) {
        res.json({
          code: 200,
          msg: 'success',
          data: {
            piNo: orderCtx.piNo,
            orderId: orderCtx.orderId,
            pqCode: pqCode || null,
            sourceCode,
            targetCode,
            targetName: targetCtx.kcaa02,
            matchDescribe: matchDescribe || null,
            matchedCount,
            updatedCount: 0,
            dryRun: true,
          },
        })
        return
      }

      const listColset = await getPiBomListColumnSet(pool)
      const syncCols = resolvePiBomReplaceSyncColumns(listColset)
      if (!syncCols.length) {
        res.status(400).json({ code: 400, msg: '明细表无可同步的物料字段，请联系管理员检查表结构', data: null })
        return
      }

      const actor = await resolveActorAuditTripletFromReq(pool, req)
      const calcStatusColumn = await ensureSalesOrderCalcStatusColumn(pool)
      const nowStr = formatAuditTime()
      tx = new sql.Transaction(pool)
      await tx.begin()

      const updatedCount = await executePiBomMaterialReplace(tx, {
        piNo: orderCtx.piNo,
        pqCode,
        sourceCode,
        targetCode,
        matchDescribe,
        hasPq,
        syncCols,
        listColset,
        actor,
        nowStr,
      })
      if (updatedCount <= 0) {
        await tx.rollback()
        tx = null
        res.status(400).json({
          code: 400,
          msg: '替换失败：未更新任何明细行，请刷新后重试',
          data: { matchedCount, updatedCount: 0 },
        })
        return
      }

      await markSalesOrderUncalculated(tx, orderCtx.orderId, actor, calcStatusColumn)
      await tx.commit()
      tx = null

      res.json({
        code: 200,
        msg: 'success',
        data: {
          piNo: orderCtx.piNo,
          orderId: orderCtx.orderId,
          pqCode: pqCode || null,
          sourceCode,
          targetCode,
          targetName: targetCtx.kcaa02,
          matchDescribe: matchDescribe || null,
          matchedCount,
          updatedCount,
          dryRun: false,
        },
      })
    } catch (err) {
      if (tx) {
        try {
          await tx.rollback()
        } catch (rollbackErr) {
          console.error('POST /api/inventory/pi-bom-data/replace-material rollback 失败：', rollbackErr)
        }
      }
      console.error('POST /api/inventory/pi-bom-data/replace-material 失败：', err)
      const detail = String(err?.message ?? err?.originalError?.message ?? '替换失败')
      res.status(500).json({ code: 500, msg: `PI-BOM 物料批量替换失败：${detail}`, data: null })
    }
  })
}
