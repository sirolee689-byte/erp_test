/**
 * 外协领料批量添加：外协明细展开子料 + 仓库库存计算可领数量。
 * SQL Server 2008 R2 兼容。
 */
import { sql } from './db.js'
import { safeDecimalExpr, safeIntExpr, nvarcharTextExpr } from './buyOrderSqlSafe.js'
import { calcOtherBatchStockQty } from './stockOutOtherBatchAdd.js'
import { computeAssistKsum } from './stockInAssistBatchAdd.js'
import {
  batchExpandAssistIssueLines,
  buildAssistIssueLineKey,
  buildAssistIssuePiCostHint,
  computeAssistIssueDefaultQty,
  computeAssistIssueRequiredQty,
  fetchBom000SnapshotsByKcaa01,
  filterExpandedAssistIssueRows,
} from './stockOutAssistIssueBomExpand.js'

const ASSIST_HEADER_FROM = 'dbo.[UB_ERP_assist_order]'
const ASSIST_LINE_FROM = 'dbo.[UB_ERP_assist_order_list]'
const STOCK_IN_FROM = 'dbo.[UB_ERP_Stocks_Storage]'
const STOCK_IN_LINE_FROM = 'dbo.[UB_ERP_Stocks_Storage_list]'
const STOCK_OUT_FROM = 'dbo.[UB_ERP_Stocks_out]'
const STOCK_OUT_LINE_FROM = 'dbo.[UB_ERP_Stocks_out_list]'
const BUY_HEADER_FROM = 'dbo.[UB_ERP_Buy_order]'
const BUY_LINE_FROM = 'dbo.[UB_ERP_Buy_order_list]'

const KCAA_COLS = Array.from({ length: 35 }, (_, i) => `kcaa${String(i + 1).padStart(2, '0')}`)

function text(v) {
  return String(v ?? '').trim()
}

function toNumber(v) {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

function round(n, p = 4) {
  const m = 10 ** p
  return Math.round((toNumber(n) + Number.EPSILON) * m) / m
}

/** 外协领料批量：出库数量口径统一三位小数（与 kcaq03 / 界面展示一致） */
const ASSIST_ISSUE_QTY_PRECISION = 3

function delActiveSql(alias) {
  return `ISNULL(${alias}.[del], N'0') IN (N'', N'0')`
}

function passApprovedSql(alias) {
  return `${nvarcharTextExpr(alias, 'pass', 20)} = N'1'`
}

/** 外协来源剩余 = 换算外协数量 - 已出 + 退回/调整(wxak07) */
export function computeAssistSourceRemain({ wxak03, wxak07, wxak08, kcaa26, kcaa27 }) {
  const ksum = computeAssistKsum(wxak03, kcaa26, kcaa27)
  const remain = round(toNumber(ksum) - toNumber(wxak08) + toNumber(wxak07), 4)
  return remain > 0 ? remain : 0
}

/** 来源需求 = 换算外协数量 × 单用量 */
export function computeAssistSourceDemandQty(params) {
  return computeAssistIssueRequiredQty(params)
}

/** 还需出库 = 来源需求 - 来源已审出 - 来源未审出 */
export function computeAssistStillNeedQty({ sourceDemandQty, sourceApprovedOutQty, sourcePendingOutQty }) {
  const remain = round(
    toNumber(sourceDemandQty) - toNumber(sourceApprovedOutQty) - toNumber(sourcePendingOutQty),
    ASSIST_ISSUE_QTY_PRECISION,
  )
  return remain > 0 ? remain : 0
}

/** 当前可领 = min(来源剩余 - 未审出库占用, 仓库实际库存) — 保留供单测/来源维度 */
export function computeAssistIssueableQty({ sourceRemain, pendingIssueOut, warehouseActualQty }) {
  const pool = Math.max(0, toNumber(sourceRemain) - toNumber(pendingIssueOut))
  const stock = Math.max(0, toNumber(warehouseActualQty))
  return round(Math.min(pool, stock), ASSIST_ISSUE_QTY_PRECISION)
}

export function resolveAssistIssueSelectState({ issueableQty, stillNeedQty, alreadySelected, warehouseActualQty }) {
  if (alreadySelected) {
    return { selectState: 'picked', selectLabel: '已选择', selectable: false }
  }
  if (toNumber(warehouseActualQty) <= 0) {
    return { selectState: 'disabled_stock', selectLabel: '库存不足', selectable: false }
  }
  if (toNumber(stillNeedQty) <= 0) {
    return { selectState: 'disabled_source', selectLabel: '不可选', selectable: false }
  }
  if (toNumber(issueableQty) > 0) {
    return { selectState: 'select', selectLabel: '选择', selectable: true }
  }
  return { selectState: 'disabled_stock', selectLabel: '库存不足', selectable: false }
}

/** 外协单总外协数量：按明细换算后汇总，供批量窗口展示整单口径。 */
export function computeAssistOrderTotalQty(rows = []) {
  const list = Array.isArray(rows) ? rows : []
  return round(list.reduce((sum, row) => (
    sum + toNumber(computeAssistKsum(row?.wxak03, row?.kcaa26, row?.kcaa27))
  ), 0), 4)
}

function formatPendingText(rows, qtyKey = 'qty') {
  const list = Array.isArray(rows) ? rows : []
  if (!list.length) return '-'
  const totalQty = round(list.reduce((sum, row) => sum + toNumber(row[qtyKey]), 0), 4)
  const docNos = list.map((row) => text(row.docNo)).filter(Boolean)
  const uniqueDocs = [...new Set(docNos)]
  const docText = uniqueDocs.length > 3 ? `${uniqueDocs.slice(0, 3).join('、')}...` : uniqueDocs.join('、')
  return `${totalQty} / ${uniqueDocs.length} / ${docText || '-'}`
}

/** 子料单位换算说明；使用单位=采购单位时返回「否」，前端显示「无转换」 */
function unitConvertText(kcaa04, kcaa25, kcaa26, kcaa27, refQty) {
  const useUnit = text(kcaa04)
  const buyUnit = text(kcaa25)
  if (!buyUnit || buyUnit === useUnit) return '否'
  const dir = text(kcaa27) === '1' ? '使用->采购' : '采购->使用'
  return `${buyUnit} / ${dir} / ${text(kcaa26) || '1'} / ${text(refQty)}`
}

function parsePage(query = {}) {
  const page = Math.max(1, Number.parseInt(query.page, 10) || 1)
  const rawPageSize = Number.parseInt(query.pageSize, 10) || 20
  const pageSize = Math.min(200, Math.max(1, rawPageSize))
  return { page, pageSize }
}

function buildPiFilter(piNo) {
  return text(piNo)
    ? `AND LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(h.[wxaj04], N'')))) = @piNo`
    : ''
}

function resolveDetailKey(row) {
  return text(row.wxak02 || row.systemcode || row.GUID || row.sourceLineCode)
}

/** 编辑态兜底：本单已存子料编码去重（kcaq02 与展开 wxak02 不一致时仍拦截） */
export function buildAssistIssueMaterialDedupKey(materialCode) {
  const mat = text(materialCode).toLowerCase()
  return mat ? `*|${mat}` : ''
}

/** 合并请求 selectedKeys 与本单已存明细键（编辑态 excludeOutboundNo 兜底） */
export function mergeAssistIssueSelectedKeys(selectedKeysInput, outboundLineKeys = []) {
  const selectedSet = new Set(
    text(selectedKeysInput).split(',').map((x) => x.trim().toLowerCase()).filter(Boolean),
  )
  for (const key of outboundLineKeys) {
    const normalized = text(key).toLowerCase()
    if (normalized) selectedSet.add(normalized)
  }
  return selectedSet
}

function hasSelectedKeysInput(query = {}) {
  return Object.prototype.hasOwnProperty.call(query, 'selectedKeys')
}

export function __buildAssistIssueOutboundLineKeysSqlForTest() {
  return `
    SELECT
      ${nvarcharTextExpr('l', 'kcaq02', 200)} AS sourceLineCode,
      ${nvarcharTextExpr('l', 'kcaa01', 300)} AS materialCode
    FROM ${STOCK_OUT_LINE_FROM} AS l
    WHERE ${nvarcharTextExpr('l', 'kcaq01', 200)} = @outboundNo
      AND ${delActiveSql('l')}
  `
}

async function fetchAssistIssueOutboundLineKeys(pool, outboundNo) {
  const no = text(outboundNo)
  if (!no) return []
  const r = await pool.request().input('outboundNo', sql.NVarChar(200), no).query(__buildAssistIssueOutboundLineKeysSqlForTest())
  const keys = []
  for (const row of r.recordset ?? []) {
    const key = buildAssistIssueLineKey(row.sourceLineCode, row.materialCode)
    if (key) keys.push(key.toLowerCase())
    const matKey = buildAssistIssueMaterialDedupKey(row.materialCode)
    if (matKey) keys.push(matKey)
  }
  return keys
}

async function fetchAssistOrderAssistType(pool, sourceOrderNo) {
  const no = text(sourceOrderNo)
  if (!no) return ''
  const r = await pool.request().input('sourceOrderNo', sql.NVarChar(200), no).query(`
    SELECT TOP 1
      LTRIM(RTRIM(CONVERT(nvarchar(20), ISNULL(h.[wxaj03], N'')))) AS assistType
    FROM ${ASSIST_HEADER_FROM} AS h
    WHERE ${nvarcharTextExpr('h', 'wxaj01', 200)} = @sourceOrderNo
      AND ${delActiveSql('h')}
    ORDER BY h.[id] DESC
  `)
  return text(r.recordset?.[0]?.assistType)
}

function resolveAssistLinePiNo(assistLine, headerPiNo = '') {
  return text(assistLine?.pi || headerPiNo)
}

function validateOutboundAssistIssuePi(assistLines, piNo, assistType) {
  if (text(assistType) !== '2') return null
  const headerPi = text(piNo)
  const missing = (assistLines ?? []).some((line) => !resolveAssistLinePiNo(line, headerPi))
  if (missing && !headerPi) {
    return '订单外发须有关联 PI 且已完成一键运算'
  }
  return null
}

function buildAssistIssueBatchBaseWhere({ piNo = '' } = {}) {
  return `
      WHERE ${nvarcharTextExpr('l', 'wxak01', 200)} = @sourceOrderNo
        AND ${nvarcharTextExpr('h', 'wxaj05', 200)} = @supplierCode
        AND ${delActiveSql('h')}
        AND ${nvarcharTextExpr('h', 'pass', 20)} = N'1'
        AND LTRIM(RTRIM(ISNULL(h.[closed], N'0'))) = N'0'
        AND ${delActiveSql('l')}
        AND ${nvarcharTextExpr('l', 'pass', 20)} = N'1'
        ${buildPiFilter(piNo)}
  `
}

function buildAssistIssueBatchListAllSql({ piNo = '' } = {}) {
  const kcaaSelect = KCAA_COLS.map((col) => `l.[${col}]`).join(', ')
  return `
    SELECT
      l.[id], l.[wxak02], l.[systemcode], l.[GUID],
      l.[wxak03], l.[wxak04], l.[wxak041], l.[wxak05], l.[wxak051],
      l.[wxak07], l.[wxak08], l.[Tax], l.[Reference], l.[Describe],
      l.[info], l.[wxak06], l.[pi], l.[Product],
      l.[location], l.[sale_price], l.[cost_price],
      l.[Customer_Name], l.[Customer_supply], l.[remark], l.[kpname], l.[kcaa02_en], l.[version],
      ${kcaaSelect}
    FROM ${ASSIST_LINE_FROM} AS l
    INNER JOIN ${ASSIST_HEADER_FROM} AS h
      ON ${nvarcharTextExpr('h', 'wxaj01', 200)} = ${nvarcharTextExpr('l', 'wxak01', 200)}
    ${buildAssistIssueBatchBaseWhere({ piNo })}
    ORDER BY ${safeIntExpr('l', 'seq')}, l.[id]
  `
}

export function __buildAssistIssueBatchCountSqlForTest(opts = {}) {
  const keywordWhere = opts.keyword
    ? `AND ${nvarcharTextExpr('l', 'kcaa01')} LIKE @keyword`
    : ''
  return `
    SELECT COUNT(1) AS total
    FROM ${ASSIST_LINE_FROM} AS l
    INNER JOIN ${ASSIST_HEADER_FROM} AS h
      ON ${nvarcharTextExpr('h', 'wxaj01', 200)} = ${nvarcharTextExpr('l', 'wxak01', 200)}
    ${buildAssistIssueBatchBaseWhere({ piNo: opts.piNo ?? '' })}
    ${keywordWhere}
  `
}

export function __buildAssistIssueBatchListSqlForTest(opts = {}) {
  return buildAssistIssueBatchListAllSql({ piNo: opts.piNo ?? '' })
}

async function fetchSourceOutboundByChildMaterial(pool, {
  sourceOrderNo,
  warehouseCode,
  materialCodes,
  excludeOutboundNo,
}) {
  const mats = (materialCodes ?? []).map((k) => text(k)).filter(Boolean)
  if (!mats.length) return { aggMap: new Map(), pendingDocMap: new Map() }

  const exclude = text(excludeOutboundNo)
  const excludeSql = exclude
    ? `AND ${nvarcharTextExpr('h', 'kcap01', 200)} <> @excludeOutboundNo`
    : ''

  const req = pool.request()
    .input('sourceOrderNo', sql.NVarChar(200), sourceOrderNo)
    .input('warehouseCode', sql.NVarChar(200), warehouseCode)
  if (exclude) req.input('excludeOutboundNo', sql.NVarChar(200), exclude)

  const inList = mats.map((k, i) => {
    const p = `mc${i}`
    req.input(p, sql.NVarChar(300), k)
    return `@${p}`
  }).join(', ')

  const baseWhere = `
    ${delActiveSql('h')}
    AND ${delActiveSql('l')}
    AND ${nvarcharTextExpr('h', 'kcap03', 20)} = N'2'
    AND ${nvarcharTextExpr('h', 'kcap04', 200)} = @sourceOrderNo
    AND ${nvarcharTextExpr('h', 'kcap06', 200)} = @warehouseCode
    ${excludeSql}
    AND ${nvarcharTextExpr('l', 'kcaa01', 300)} IN (${inList})
  `

  const aggR = await req.query(`
    SELECT
      ${nvarcharTextExpr('l', 'kcaa01', 300)} AS materialCode,
      SUM(CASE WHEN ${nvarcharTextExpr('h', 'pass', 20)} = N'1' THEN ${safeDecimalExpr('l', 'kcaq03')} ELSE 0 END) AS approvedQty,
      SUM(CASE WHEN ${nvarcharTextExpr('h', 'pass', 20)} <> N'1' THEN ${safeDecimalExpr('l', 'kcaq03')} ELSE 0 END) AS pendingQty
    FROM ${STOCK_OUT_FROM} AS h
    INNER JOIN ${STOCK_OUT_LINE_FROM} AS l
      ON ${nvarcharTextExpr('l', 'kcaq01', 200)} = ${nvarcharTextExpr('h', 'kcap01', 200)}
    WHERE ${baseWhere}
    GROUP BY l.[kcaa01]
  `)

  const pendingR = await req.query(`
    SELECT
      ${nvarcharTextExpr('l', 'kcaa01', 300)} AS materialCode,
      ${nvarcharTextExpr('h', 'kcap01', 200)} AS docNo,
      ${safeDecimalExpr('l', 'kcaq03')} AS qty
    FROM ${STOCK_OUT_FROM} AS h
    INNER JOIN ${STOCK_OUT_LINE_FROM} AS l
      ON ${nvarcharTextExpr('l', 'kcaq01', 200)} = ${nvarcharTextExpr('h', 'kcap01', 200)}
    WHERE ${baseWhere}
      AND ${nvarcharTextExpr('h', 'pass', 20)} <> N'1'
  `)

  const aggMap = new Map()
  for (const row of aggR.recordset ?? []) {
    const key = text(row.materialCode)
    aggMap.set(key, {
      approvedQty: toNumber(row.approvedQty),
      pendingQty: toNumber(row.pendingQty),
    })
  }

  const pendingDocMap = new Map()
  for (const row of pendingR.recordset ?? []) {
    const key = text(row.materialCode)
    if (!pendingDocMap.has(key)) pendingDocMap.set(key, [])
    pendingDocMap.get(key).push({ docNo: text(row.docNo), qty: toNumber(row.qty) })
  }

  return { aggMap, pendingDocMap }
}

export function __buildSourceOutboundAggSqlForTest() {
  return `
    FROM ${STOCK_OUT_FROM} AS h
    INNER JOIN ${STOCK_OUT_LINE_FROM} AS l
      ON l.[kcaq01] = h.[kcap01]
    WHERE ISNULL(h.[del], N'0') IN (N'', N'0')
      AND ISNULL(l.[del], N'0') IN (N'', N'0')
      AND h.[kcap03] = N'2'
      AND h.[kcap04] = @sourceOrderNo
      AND h.[kcap06] = @warehouseCode
      AND l.[kcaa01] IN (@mc0)
  `
}

async function fetchWarehouseStockByMaterial(pool, { warehouseCode, materialCodes, excludeOutboundNo }) {
  const mats = (materialCodes ?? []).map((k) => text(k)).filter(Boolean)
  if (!mats.length) return new Map()
  const exclude = text(excludeOutboundNo)
  const excludeSql = exclude ? `AND oh.[kcap01] <> @excludeOutboundNo` : ''
  const req = pool.request().input('warehouseCode', sql.NVarChar(200), warehouseCode)
  if (exclude) req.input('excludeOutboundNo', sql.NVarChar(200), exclude)
  const inList = mats.map((k, i) => {
    const p = `mc${i}`
    req.input(p, sql.NVarChar(300), k)
    return `@${p}`
  }).join(', ')
  const r = await req.query(`
    SELECT
      x.[materialCode],
      ISNULL(i.[approvedInQty], 0) AS approvedInQty,
      ISNULL(o.[approvedOutQty], 0) AS approvedOutQty,
      ISNULL(o.[pendingOutQty], 0) AS pendingOutQty
    FROM (
      SELECT DISTINCT v.[materialCode]
      FROM (VALUES ${mats.map((_, i) => `(@mc${i})`).join(', ')}) AS v([materialCode])
    ) AS x
    LEFT JOIN (
      SELECT il.[kcaa01] AS materialCode, SUM(${safeDecimalExpr('il', 'kcao03')}) AS approvedInQty
      FROM ${STOCK_IN_FROM} AS ih
      INNER JOIN ${STOCK_IN_LINE_FROM} AS il ON il.[kcao01] = ih.[kcan01]
      WHERE ${delActiveSql('ih')} AND ${delActiveSql('il')} AND ih.[pass] = N'1'
        AND ih.[kcan06] = @warehouseCode AND il.[kcaa01] IN (${inList})
      GROUP BY il.[kcaa01]
    ) AS i ON i.[materialCode] = x.[materialCode]
    LEFT JOIN (
      SELECT ol.[kcaa01] AS materialCode,
        SUM(CASE WHEN oh.[pass] = N'1' THEN ${safeDecimalExpr('ol', 'kcaq03')} ELSE 0 END) AS approvedOutQty,
        SUM(CASE WHEN ISNULL(oh.[pass], N'0') <> N'1' THEN ${safeDecimalExpr('ol', 'kcaq03')} ELSE 0 END) AS pendingOutQty
      FROM ${STOCK_OUT_FROM} AS oh
      INNER JOIN ${STOCK_OUT_LINE_FROM} AS ol ON ol.[kcaq01] = oh.[kcap01]
      WHERE ${delActiveSql('oh')} AND ${delActiveSql('ol')} AND oh.[kcap06] = @warehouseCode
        ${excludeSql} AND ol.[kcaa01] IN (${inList})
      GROUP BY ol.[kcaa01]
    ) AS o ON o.[materialCode] = x.[materialCode]
  `)
  const map = new Map()
  for (const row of r.recordset ?? []) {
    map.set(text(row.materialCode), calcOtherBatchStockQty({
      approvedInQty: row.approvedInQty,
      approvedOutQty: row.approvedOutQty,
      pendingOutQty: row.pendingOutQty,
    }))
  }
  return map
}

export function __buildAssistIssueLatestPurchasePriceSqlForTest(codeCount) {
  const n = Math.max(0, Math.floor(Number(codeCount) || 0))
  if (n <= 0) return ''
  const inList = Array.from({ length: n }, (_, i) => `@mc${i}`).join(', ')
  return `
    WITH latest_price AS (
      SELECT
        ${nvarcharTextExpr('l', 'kcaa01', 300)} AS materialCode,
        ${safeDecimalExpr('l', 'kcak04')} AS kcaq04,
        ${safeDecimalExpr('l', 'kcak041')} AS kcaq041,
        ${safeDecimalExpr('l', 'tax', 0)} AS tax,
        ROW_NUMBER() OVER (
          PARTITION BY ${nvarcharTextExpr('l', 'kcaa01', 300)}
          ORDER BY ISNULL(h.[id], 0) DESC, ISNULL(l.[id], 0) DESC
        ) AS rn
      FROM ${BUY_HEADER_FROM} AS h
      INNER JOIN ${BUY_LINE_FROM} AS l
        ON ${nvarcharTextExpr('l', 'kcak01', 200)} = ${nvarcharTextExpr('h', 'kcaj01', 200)}
      WHERE ${delActiveSql('h')}
        AND ${passApprovedSql('h')}
        AND ${delActiveSql('l')}
        AND ${passApprovedSql('l')}
        AND ${nvarcharTextExpr('l', 'kcaa01', 300)} IN (${inList})
    )
    SELECT materialCode, kcaq04, kcaq041, tax
    FROM latest_price
    WHERE rn = 1
  `
}

export async function fetchLatestPurchasePriceByMaterial(pool, materialCodes = []) {
  const mats = [...new Set((materialCodes ?? []).map((k) => text(k)).filter(Boolean))]
  if (!mats.length) return new Map()
  const req = pool.request()
  mats.forEach((code, i) => {
    req.input(`mc${i}`, sql.NVarChar(300), code)
  })
  const r = await req.query(__buildAssistIssueLatestPurchasePriceSqlForTest(mats.length))
  const map = new Map()
  for (const row of r.recordset ?? []) {
    const key = text(row.materialCode).toLowerCase()
    if (!key) continue
    map.set(key, {
      kcaq04: toNumber(row.kcaq04),
      kcaq041: toNumber(row.kcaq041),
      tax: toNumber(row.tax),
    })
  }
  return map
}

export function resolveAssistIssueLinePrice({ row = {}, mat = {}, materialCode = '', ctx = {} } = {}) {
  const isOutboundAssist = text(ctx.assistType) === '2'
  if (isOutboundAssist) {
    const price = ctx.purchasePriceMap?.get(text(materialCode).toLowerCase())
    return {
      tax: round(price?.tax ?? 0, 4),
      kcaq04: round(price?.kcaq04 ?? 0, 4),
      kcaq041: round(price?.kcaq041 ?? 0, 4),
    }
  }

  const salePrice = toNumber(mat.sale_price)
  const tax = toNumber(row.tax ?? row.Tax)
  const kcaq04 = salePrice > 0 ? salePrice : toNumber(row.wxak04)
  const kcaq041 = toNumber(row.wxak041) || round(kcaq04 * (1 + tax), 4)
  return {
    tax,
    kcaq04,
    kcaq041,
  }
}

function resolveChildMaterialFields(row, bomSnapshot) {
  const snap = bomSnapshot != null ? bomSnapshot : (row.childSnapshot ?? {})
  const out = {
    kcaa01: text(row.childKcaa01),
    kcaa02: text(snap.kcaa02 ?? row.kcaa02),
    kcaa03: text(snap.kcaa03 ?? row.kcaa03),
    kcaa04: text(snap.kcaa04 ?? row.kcaa04),
    kcaa11: text(snap.kcaa11 ?? row.kcaa11),
    sale_price: snap.sale_price ?? row.sale_price,
    cost_price: snap.cost_price ?? row.cost_price,
    kpname: text(snap.kpname ?? row.kpname),
    kcaa02_en: text(snap.kcaa02_en ?? row.kcaa02_en),
    version: snap.version ?? row.version,
  }
  for (const col of KCAA_COLS) {
    if (snap[col] != null && snap[col] !== '') out[col] = snap[col]
  }
  return out
}

function mapExpandedLineRow(row, ctx) {
  const detailKey = resolveDetailKey(row)
  const materialCode = text(row.childKcaa01)
  const lineKey = buildAssistIssueLineKey(detailKey, materialCode) || `${detailKey}|${materialCode}`
  const usePiCostSnapshot = text(row.expandSource) === 'pi_cost_outbound'
  const bomSnap = usePiCostSnapshot ? null : ctx.bomMap.get(materialCode.toLowerCase())
  const mat = resolveChildMaterialFields(row, bomSnap)

  const stock = ctx.stockMap.get(materialCode) ?? {}
  const sourceOutbound = ctx.sourceOutboundMap.get(materialCode) ?? { approvedQty: 0, pendingQty: 0 }
  const warehouseActualQty = stock.actualQty ?? 0
  const assistOrderQty = computeAssistKsum(row.wxak03, row.kcaa26, row.kcaa27)
  const sourceDemandQty = computeAssistSourceDemandQty({
    wxak03: row.wxak03,
    kcaa26: row.kcaa26,
    kcaa27: row.kcaa27,
    unitUsage: row.unitUsage,
  })
  const sourceApprovedOutQty = round(sourceOutbound.approvedQty, ASSIST_ISSUE_QTY_PRECISION)
  const sourcePendingOutQty = round(sourceOutbound.pendingQty, ASSIST_ISSUE_QTY_PRECISION)
  const stillNeedQty = computeAssistStillNeedQty({
    sourceDemandQty,
    sourceApprovedOutQty,
    sourcePendingOutQty,
  })
  const issueableQty = computeAssistIssueDefaultQty({ stillNeedQty, warehouseActualQty })
  const materialDedupKey = buildAssistIssueMaterialDedupKey(materialCode)
  const alreadySelected = ctx.selectedSet.has(lineKey.toLowerCase())
    || (materialDedupKey && ctx.selectedSet.has(materialDedupKey))
  const select = resolveAssistIssueSelectState({
    issueableQty,
    stillNeedQty,
    alreadySelected,
    warehouseActualQty,
  })

  const price = resolveAssistIssueLinePrice({ row, mat, materialCode, ctx })
  const tax = price.tax
  const kcaq04 = price.kcaq04
  const kcaq041 = price.kcaq041
  const kcaq03 = issueableQty
  const kcaq05 = round(kcaq03 * kcaq04, 2)
  const kcaq051 = round(kcaq03 * kcaq041, 2)

  const remarkText = [text(row.Describe), text(row.info)].filter(Boolean).join(' / ')
  const convertText = unitConvertText(
    mat.kcaa04,
    mat.kcaa25,
    mat.kcaa26,
    mat.kcaa27,
    assistOrderQty,
  )

  const out = {
    lineKey,
    sourceLineCode: detailKey,
    kcaq02: detailKey,
    wxak02: detailKey,
    outsourceKcaa01: text(row.outsourceKcaa01),
    unitUsage: toNumber(row.unitUsage),
    expandSource: text(row.expandSource),
    kcaa01: materialCode,
    kcaa02: mat.kcaa02,
    kcaa03: mat.kcaa03,
    kcaa04: mat.kcaa04,
    kcaa11: mat.kcaa11,
    wxak03: toNumber(row.wxak03),
    assistOrderQty,
    assistOrderTotalQty: toNumber(ctx.assistOrderTotalQty),
    wxak07: toNumber(row.wxak07),
    wxak08: toNumber(row.wxak08),
    returnCode: text(row.Product ?? row.returnCode),
    sourceDemandQty,
    stillNeedQty,
    requiredQty: stillNeedQty,
    sourceApprovedOutQty,
    sourcePendingOutQty,
    warehouseBookQty: toNumber(stock.bookQty),
    warehousePendingOutQty: toNumber(stock.pendingOutQty),
    warehouseActualQty,
    warehouseDisplayActualQty: toNumber(stock.displayActualQty ?? warehouseActualQty),
    issueableQty,
    pendingOutboundText: formatPendingText(ctx.sourcePendingDocMap.get(materialCode)),
    unitConvertText: convertText,
    actualInboundQty: null,
    kcaq03,
    kcaq031: warehouseActualQty,
    kcaq04,
    kcaq041,
    kcaq05,
    kcaq051,
    tax,
    reference: text(row.Reference ?? row.reference ?? row.pi ?? row.Product),
    Describe: remarkText,
    info: text(row.info),
    location: text(row.location ?? mat.location),
    sale_price: mat.sale_price,
    cost_price: mat.cost_price,
    Customer_Name: text(row.Customer_Name),
    Customer_supply: text(row.Customer_supply),
    kpname: mat.kpname,
    kcaa02_en: mat.kcaa02_en,
    version: mat.version,
    ...select,
  }
  for (const col of KCAA_COLS) {
    if (mat[col] != null && out[col] == null) out[col] = mat[col]
  }
  return out
}

function joinDistinctText(values = [], fallback = '-') {
  const list = [...new Set((values ?? []).map((v) => text(v)).filter(Boolean))]
  if (!list.length) return fallback
  if (list.length <= 2) return list.join(' / ')
  return `${list.slice(0, 2).join(' / ')} 等${list.length}项`
}

/** 批量窗口展示按子料编码合并：同 kcaa01 只显示一行，数量口径累加。 */
export function __aggregateAssistIssueRowsByMaterialForTest(rows, selectedSet = new Set()) {
  const groups = new Map()
  for (const row of Array.isArray(rows) ? rows : []) {
    const materialCode = text(row.kcaa01)
    const key = materialCode.toLowerCase()
    if (!key) continue
    const existing = groups.get(key)
    if (!existing) {
      groups.set(key, {
        ...row,
        __sourceLineCodes: [text(row.sourceLineCode || row.kcaq02 || row.wxak02)],
        __outsourceCodes: [text(row.outsourceKcaa01)],
        __alreadySelected: row.selectState === 'picked' || row.selectLabel === '已选择',
      })
      continue
    }
    existing.assistOrderQty = round(toNumber(existing.assistOrderQty) + toNumber(row.assistOrderQty), 4)
    existing.unitUsage = round(toNumber(existing.unitUsage) + toNumber(row.unitUsage), 6)
    existing.sourceDemandQty = round(toNumber(existing.sourceDemandQty) + toNumber(row.sourceDemandQty), ASSIST_ISSUE_QTY_PRECISION)
    // stillNeedQty 不在合并阶段累加：各行已用整单子料维度的已出/未审量计算，累加会重复扣减
    existing.__sourceLineCodes.push(text(row.sourceLineCode || row.kcaq02 || row.wxak02))
    existing.__outsourceCodes.push(text(row.outsourceKcaa01))
    if (row.selectState === 'picked' || row.selectLabel === '已选择') existing.__alreadySelected = true
  }

  const merged = []
  for (const item of groups.values()) {
    const materialCode = text(item.kcaa01)
    const materialLineKey = `material|${materialCode.toLowerCase()}`
    const sourceLineCode = text(item.__sourceLineCodes.find(Boolean))
    const materialDedupKey = buildAssistIssueMaterialDedupKey(materialCode)
    const alreadySelected = item.__alreadySelected
      || selectedSet.has(materialLineKey)
      || selectedSet.has(materialDedupKey)

    const sourceApprovedOutQty = toNumber(item.sourceApprovedOutQty)
    const sourcePendingOutQty = toNumber(item.sourcePendingOutQty)
    const stillNeedQty = computeAssistStillNeedQty({
      sourceDemandQty: item.sourceDemandQty,
      sourceApprovedOutQty,
      sourcePendingOutQty,
    })
    const issueableQty = computeAssistIssueDefaultQty({
      stillNeedQty,
      warehouseActualQty: item.warehouseActualQty,
    })
    const select = resolveAssistIssueSelectState({
      issueableQty,
      stillNeedQty,
      alreadySelected,
      warehouseActualQty: item.warehouseActualQty,
    })

    const kcaq04 = toNumber(item.kcaq04)
    const kcaq041 = toNumber(item.kcaq041)
    const next = {
      ...item,
      lineKey: materialLineKey,
      sourceLineCode,
      kcaq02: sourceLineCode,
      wxak02: sourceLineCode,
      outsourceKcaa01: joinDistinctText(item.__outsourceCodes),
      stillNeedQty,
      requiredQty: stillNeedQty,
      issueableQty,
      kcaq03: issueableQty,
      kcaq031: toNumber(item.warehouseActualQty),
      kcaq05: round(issueableQty * kcaq04, 2),
      kcaq051: round(issueableQty * kcaq041, 2),
      ...select,
    }
    delete next.__sourceLineCodes
    delete next.__outsourceCodes
    delete next.__alreadySelected
    merged.push(next)
  }
  return merged
}

/**
 * @param {import('mssql').ConnectionPool} pool
 * @param {Record<string, string>} query
 */
export async function fetchStockOutAssistIssueBatchLines(pool, query = {}) {
  const sourceOrderNo = text(query.sourceOrderNo)
  const supplierCode = text(query.supplierCode)
  const warehouseCode = text(query.warehouseCode)
  const piNo = text(query.piNo)
  if (!sourceOrderNo) return { ok: false, status: 400, msg: '请先选择关联外协单号' }
  if (!supplierCode) return { ok: false, status: 400, msg: '请先选择外协商' }
  if (!warehouseCode) return { ok: false, status: 400, msg: '请先选择仓库' }

  const keyword = text(query.keyword)
  const excludeOutboundNo = text(query.excludeOutboundNo)
  const { page, pageSize } = parsePage(query)
  const hasSelectedKeys = hasSelectedKeysInput(query)
  const outboundLineKeys = (!hasSelectedKeys && excludeOutboundNo)
    ? await fetchAssistIssueOutboundLineKeys(pool, excludeOutboundNo)
    : []
  const selectedSet = mergeAssistIssueSelectedKeys(query.selectedKeys, outboundLineKeys)

  const assistType = await fetchAssistOrderAssistType(pool, sourceOrderNo)

  const listReq = pool.request()
    .input('sourceOrderNo', sql.NVarChar(200), sourceOrderNo)
    .input('supplierCode', sql.NVarChar(200), supplierCode)
  if (piNo) listReq.input('piNo', sql.NVarChar(200), piNo)

  const listR = await listReq.query(buildAssistIssueBatchListAllSql({ piNo }))
  const assistLines = listR.recordset ?? []
  const assistOrderTotalQty = computeAssistOrderTotalQty(assistLines)
  if (!assistLines.length) {
    return { ok: true, list: [], total: 0, page, pageSize, sourceOrderNo, supplierCode, warehouseCode, piNo, assistType }
  }

  const piErr = validateOutboundAssistIssuePi(assistLines, piNo, assistType)
  if (piErr) {
    return { ok: false, status: 400, msg: piErr }
  }

  const expandedRaw = await batchExpandAssistIssueLines(pool, assistLines, piNo, { assistType })
  const filtered = filterExpandedAssistIssueRows(expandedRaw, keyword)
  if (!filtered.length) {
    return { ok: true, list: [], total: 0, page, pageSize, sourceOrderNo, supplierCode, warehouseCode, piNo, assistType }
  }

  const materialCodes = [...new Set(filtered.map((row) => text(row.childKcaa01)).filter(Boolean))]

  const skipBomSnapshot = text(assistType) === '2'
  const [sourceOutboundResult, stockMap, bomMap, purchasePriceMap] = await Promise.all([
    fetchSourceOutboundByChildMaterial(pool, {
      sourceOrderNo,
      warehouseCode,
      materialCodes,
      excludeOutboundNo,
    }),
    fetchWarehouseStockByMaterial(pool, { warehouseCode, materialCodes, excludeOutboundNo }),
    skipBomSnapshot ? Promise.resolve(new Map()) : fetchBom000SnapshotsByKcaa01(pool, materialCodes),
    skipBomSnapshot ? fetchLatestPurchasePriceByMaterial(pool, materialCodes) : Promise.resolve(new Map()),
  ])

  const ctx = {
    assistType,
    sourceOutboundMap: sourceOutboundResult.aggMap,
    sourcePendingDocMap: sourceOutboundResult.pendingDocMap,
    stockMap,
    bomMap,
    purchasePriceMap,
    selectedSet,
    assistOrderTotalQty,
  }
  const mergedRows = __aggregateAssistIssueRowsByMaterialForTest(
    filtered.map((row) => mapExpandedLineRow(row, ctx)),
    selectedSet,
  )
  const total = mergedRows.length
  const start = (page - 1) * pageSize
  const list = mergedRows.slice(start, start + pageSize)

  return {
    ok: true,
    list,
    total,
    page,
    pageSize,
    sourceOrderNo,
    supplierCode,
    warehouseCode,
    piNo,
    assistType,
    piCostHint: buildAssistIssuePiCostHint(piNo, expandedRaw, { assistType }),
  }
}
