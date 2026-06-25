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

function delActiveSql(alias) {
  return `ISNULL(${alias}.[del], N'0') IN (N'', N'0')`
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
    4,
  )
  return remain > 0 ? remain : 0
}

/** 当前可领 = min(来源剩余 - 未审出库占用, 仓库实际库存) — 保留供单测/来源维度 */
export function computeAssistIssueableQty({ sourceRemain, pendingIssueOut, warehouseActualQty }) {
  const pool = Math.max(0, toNumber(sourceRemain) - toNumber(pendingIssueOut))
  const stock = Math.max(0, toNumber(warehouseActualQty))
  return round(Math.min(pool, stock), 4)
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
    ? `AND (${['kcaa01', 'kcaa02'].map((col) => `${nvarcharTextExpr('l', col)} LIKE @keyword`).join(' OR ')})`
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

function resolveChildMaterialFields(row, bomSnapshot) {
  const snap = bomSnapshot ?? row.childSnapshot ?? {}
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
  const bomSnap = ctx.bomMap.get(materialCode.toLowerCase())
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
  const sourceApprovedOutQty = round(sourceOutbound.approvedQty, 4)
  const sourcePendingOutQty = round(sourceOutbound.pendingQty, 4)
  const stillNeedQty = computeAssistStillNeedQty({
    sourceDemandQty,
    sourceApprovedOutQty,
    sourcePendingOutQty,
  })
  const issueableQty = computeAssistIssueDefaultQty({ stillNeedQty, warehouseActualQty })
  const alreadySelected = ctx.selectedSet.has(lineKey.toLowerCase())
  const select = resolveAssistIssueSelectState({
    issueableQty,
    stillNeedQty,
    alreadySelected,
    warehouseActualQty,
  })

  const salePrice = toNumber(mat.sale_price)
  const tax = toNumber(row.tax ?? row.Tax)
  const kcaq04 = salePrice > 0 ? salePrice : toNumber(row.wxak04)
  const kcaq041 = toNumber(row.wxak041) || round(kcaq04 * (1 + tax), 4)
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
  const selectedSet = new Set(
    text(query.selectedKeys).split(',').map((x) => x.trim().toLowerCase()).filter(Boolean),
  )

  const listReq = pool.request()
    .input('sourceOrderNo', sql.NVarChar(200), sourceOrderNo)
    .input('supplierCode', sql.NVarChar(200), supplierCode)
  if (piNo) listReq.input('piNo', sql.NVarChar(200), piNo)

  const listR = await listReq.query(buildAssistIssueBatchListAllSql({ piNo }))
  const assistLines = listR.recordset ?? []
  if (!assistLines.length) {
    return { ok: true, list: [], total: 0, page, pageSize, sourceOrderNo, supplierCode, warehouseCode, piNo }
  }

  const expandedRaw = await batchExpandAssistIssueLines(pool, assistLines, piNo)
  const filtered = filterExpandedAssistIssueRows(expandedRaw, keyword)
  const total = filtered.length
  const start = (page - 1) * pageSize
  const pageRows = filtered.slice(start, start + pageSize)

  if (!pageRows.length) {
    return { ok: true, list: [], total, page, pageSize, sourceOrderNo, supplierCode, warehouseCode, piNo }
  }

  const materialCodes = [...new Set(pageRows.map((row) => text(row.childKcaa01)).filter(Boolean))]

  const [sourceOutboundResult, stockMap, bomMap] = await Promise.all([
    fetchSourceOutboundByChildMaterial(pool, {
      sourceOrderNo,
      warehouseCode,
      materialCodes,
      excludeOutboundNo,
    }),
    fetchWarehouseStockByMaterial(pool, { warehouseCode, materialCodes, excludeOutboundNo }),
    fetchBom000SnapshotsByKcaa01(pool, materialCodes),
  ])

  const ctx = {
    sourceOutboundMap: sourceOutboundResult.aggMap,
    sourcePendingDocMap: sourceOutboundResult.pendingDocMap,
    stockMap,
    bomMap,
    selectedSet,
  }
  const list = pageRows.map((row) => mapExpandedLineRow(row, ctx))

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
    piCostHint: buildAssistIssuePiCostHint(piNo, expandedRaw),
  }
}
