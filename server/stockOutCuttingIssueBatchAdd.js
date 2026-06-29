/**
 * 开料部（车间 04）生产领料批量：PI 裁片结构源料，不走派工明细展开。
 * SQL Server 2008 R2 兼容。
 */
import { sql } from './db.js'
import { nvarcharTextExpr } from './buyOrderSqlSafe.js'
import { normKcaa01 } from './salesOrderSaveLogic.js'
import { PI_COST_PARENT_T_FIELD_KEYS } from './salesOrderPiCostFields.js'
import { validateProductionDispatchHeader } from './stockInProductionBatchAdd.js'
import { mergeAssistIssueSelectedKeys, fetchLatestPurchasePriceByMaterial } from './stockOutAssistIssueBatchAdd.js'
import { fetchCuttingIssueCategoryCodes } from './stockOutCuttingIssueConfig.js'
import {
  buildProductionIssueMaterialDedupKey,
  computeProductionIssueDefaultQty,
  fetchPiDemandByMaterial,
  fetchPiOutboundByMaterial,
  fetchProductionIssueOutboundLineKeys,
  fetchProductionSourceOutboundByChildMaterial,
  fetchWarehouseStockByMaterial,
  resolveProductionIssueDualQtyCaps,
  resolveProductionIssueLinePrice,
  resolveProductionIssueSelectState,
  parseProductionIssueBatchPaging,
  sliceProductionIssueBatchList,
} from './stockOutProductionIssueBatchAdd.js'
import { PRODUCTION_ISSUE_QTY_PRECISION } from './stockOutProductionIssueBomExpand.js'

const PI_COST_FROM = 'dbo.[UB_ERP_Bom_pi_cost]'

/** 旧系统开料部车间编码 */
export const CUTTING_WORKSHOP_CODE = '04'

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

function hasSelectedKeysInput(query = {}) {
  return Object.prototype.hasOwnProperty.call(query, 'selectedKeys')
}

export function isCuttingWorkshop(workshopCode) {
  return text(workshopCode) === CUTTING_WORKSHOP_CODE
}

/** pi_cost 行是否属于 CUT 裁片结构（t_kcaa01 或 top_kcaa01 以 CUT- 开头） */
export function isPiCostCutStructureRow(row) {
  const t = text(row?.t_kcaa01 ?? row?.tKcaa01).toUpperCase()
  const top = text(row?.top_kcaa01 ?? row?.topKcaa01).toUpperCase()
  return t.startsWith('CUT-') || top.startsWith('CUT-')
}

/** 开料明细 kcaq02：合成键，避免误写派工 scak04 */
export function buildCuttingIssueSourceLineCode(materialCode) {
  const mat = text(materialCode)
  return mat ? `CUT|${mat}` : ''
}

/**
 * 按 kcaa01 合并：需出库 = SUM(kcac06 × temp)。
 * @param {any[]} piCostRows
 */
export function aggregateCuttingIssueRows(piCostRows) {
  /** @type {Map<string, { childKcaa01: string, sourceDemandQty: number, snapshot: any, t_kcaa01: string, top_kcaa01: string }>} */
  const map = new Map()
  for (const row of Array.isArray(piCostRows) ? piCostRows : []) {
    const code = normKcaa01(row?.kcaa01)
    if (!code) continue
    const temp = toNumber(row?.temp)
    const usage = toNumber(row?.kcac06)
    const demand = usage * temp
    const prev = map.get(code)
    if (!prev) {
      map.set(code, {
        childKcaa01: code,
        sourceDemandQty: round(demand, PRODUCTION_ISSUE_QTY_PRECISION),
        snapshot: row,
        t_kcaa01: text(row?.t_kcaa01),
        top_kcaa01: text(row?.top_kcaa01),
      })
      continue
    }
    prev.sourceDemandQty = round(prev.sourceDemandQty + demand, PRODUCTION_ISSUE_QTY_PRECISION)
  }
  return [...map.values()]
}

export function __buildPiCostCuttingIssueSqlForTest() {
  return `
    FROM ${PI_COST_FROM} AS c
    WHERE LTRIM(RTRIM(ISNULL(c.[sid], N''))) = @piNo
      AND ISNULL(c.[isok], 0) = 1
      AND (
        UPPER(LTRIM(RTRIM(CONVERT(nvarchar(300), ISNULL(c.[t_kcaa01], N''))))) LIKE N'CUT-%'
        OR UPPER(LTRIM(RTRIM(CONVERT(nvarchar(300), ISNULL(c.[top_kcaa01], N''))))) LIKE N'CUT-%'
      )
      AND LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(c.[kcaa05], N'')))) IN (@cat0)
  `
}

/**
 * @param {import('mssql').ConnectionPool} pool
 * @param {{ piNo: string, categoryCodes: string[] }} opts
 */
export async function fetchPiCostRowsForCuttingIssue(pool, { piNo, categoryCodes = [] } = {}) {
  const pi = text(piNo)
  const cats = [...new Set((categoryCodes ?? []).map((c) => text(c)).filter(Boolean))]
  if (!pi || !cats.length) return []

  const req = pool.request().input('piNo', sql.NVarChar(200), pi)
  const catInList = cats.map((code, i) => {
    const p = `cat${i}`
    req.input(p, sql.NVarChar(100), code)
    return `@${p}`
  }).join(', ')

  const kcaaSelect = KCAA_COLS.map((col) => `c.[${col}]`).join(', ')
  const tKcaaSelect = ['t_kcaa01', 't_kcaa02', ...PI_COST_PARENT_T_FIELD_KEYS.map((k) => `t_${k}`)]
    .map((col) => `c.[${col}]`)
    .join(', ')

  const r = await req.query(`
    SELECT
      c.[id],
      LTRIM(RTRIM(ISNULL(c.[sid], N''))) AS sid,
      ${kcaaSelect},
      ${tKcaaSelect},
      CAST(ISNULL(c.[kcac06], 0) AS decimal(18, 6)) AS kcac06,
      LTRIM(RTRIM(CONVERT(nvarchar(300), ISNULL(c.[top_kcaa01], N'')))) AS top_kcaa01,
      LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(c.[Describe], N'')))) AS Describe,
      LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(c.[systemcode], N'')))) AS systemcode,
      LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(c.[GUID], N'')))) AS GUID,
      LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(c.[location], N'')))) AS location,
      LTRIM(RTRIM(CONVERT(nvarchar(50), ISNULL(c.[temp], N'')))) AS temp
    FROM ${PI_COST_FROM} AS c
    WHERE LTRIM(RTRIM(ISNULL(c.[sid], N''))) = @piNo
      AND ISNULL(c.[isok], 0) = 1
      AND (
        UPPER(LTRIM(RTRIM(CONVERT(nvarchar(300), ISNULL(c.[t_kcaa01], N''))))) LIKE N'CUT-%'
        OR UPPER(LTRIM(RTRIM(CONVERT(nvarchar(300), ISNULL(c.[top_kcaa01], N''))))) LIKE N'CUT-%'
      )
      AND LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(c.[kcaa05], N'')))) IN (${catInList})
    ORDER BY c.[id] ASC
  `)
  return r.recordset ?? []
}

function filterCuttingRows(rows, keyword) {
  const kw = text(keyword).toLowerCase()
  if (!kw) return rows
  return rows.filter((row) => text(row.childKcaa01).toLowerCase().includes(kw))
}

function resolveMaterialSnapshot(row) {
  const snap = row.snapshot ?? {}
  const out = {
    kcaa01: text(row.childKcaa01),
    kcaa02: text(snap.kcaa02),
    kcaa03: text(snap.kcaa03),
    kcaa04: text(snap.kcaa04),
    kcaa11: text(snap.kcaa11),
    location: text(snap.location),
    systemcode: text(snap.systemcode || snap.GUID),
    GUID: text(snap.GUID || snap.systemcode),
  }
  for (const col of KCAA_COLS) {
    if (snap[col] != null && snap[col] !== '') out[col] = snap[col]
  }
  return out
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

function mapCuttingIssueLineRow(row, ctx) {
  const materialCode = text(row.childKcaa01)
  const sourceLineCode = buildCuttingIssueSourceLineCode(materialCode)
  const mat = resolveMaterialSnapshot(row)
  const stock = ctx.stockMap.get(materialCode) ?? {}
  const sourceOutbound = ctx.sourceOutboundMap.get(materialCode) ?? { approvedQty: 0, pendingQty: 0 }

  const warehouseBookQty = round(stock.bookQty ?? 0, PRODUCTION_ISSUE_QTY_PRECISION)
  const warehousePendingOutQty = round(stock.pendingOutQty ?? 0, PRODUCTION_ISSUE_QTY_PRECISION)
  const warehouseActualQty = round(stock.actualQty ?? 0, PRODUCTION_ISSUE_QTY_PRECISION)

  const sourceDemandQty = round(row.sourceDemandQty, PRODUCTION_ISSUE_QTY_PRECISION)
  const sourceApprovedOutQty = round(sourceOutbound.approvedQty, PRODUCTION_ISSUE_QTY_PRECISION)
  const sourcePendingOutQty = round(sourceOutbound.pendingQty, PRODUCTION_ISSUE_QTY_PRECISION)
  const piDemandQty = toNumber(ctx.piDemandMap?.get(materialCode))
  const piIssuedQty = toNumber(ctx.piIssuedMap?.get(materialCode))
  const qtyCaps = resolveProductionIssueDualQtyCaps({
    sourceDemandQty,
    dispatchApprovedOutQty: sourceApprovedOutQty,
    dispatchPendingOutQty: sourcePendingOutQty,
    piDemandQty,
    piIssuedQty,
    warehouseActualQty,
  })
  const { stillNeedQty, issueableQty, piRemainingQty, dispatchStillNeedQty } = qtyCaps
  const price = resolveProductionIssueLinePrice({ materialCode, purchasePriceMap: ctx.purchasePriceMap })
  const { kcaq04, kcaq041, tax } = price
  const materialName = text(mat.kcaa02)

  const materialLineKey = `material|${materialCode.toLowerCase()}`
  const materialDedupKey = buildProductionIssueMaterialDedupKey(materialCode)
  const alreadySelected = selectedSetHas(ctx.selectedSet, materialLineKey, materialDedupKey)
  const select = resolveProductionIssueSelectState({
    issueableQty,
    stillNeedQty,
    warehouseActualQty,
    alreadySelected,
  })

  return {
    lineKey: materialLineKey,
    sourceLineCode,
    kcaq02: sourceLineCode,
    scak02: sourceLineCode,
    t_kcaa01: text(row.t_kcaa01),
    top_kcaa01: text(row.top_kcaa01),
    dispatchKcaa01: text(row.t_kcaa01) || '-',
    dispatchKcaa02: text(row.top_kcaa01) || '-',
    sourceDemandQty,
    dispatchDemandQty: sourceDemandQty,
    sourceApprovedOutQty,
    sourcePendingOutQty,
    piDemandQty: qtyCaps.piDemandQty,
    piIssuedQty: qtyCaps.piIssuedQty,
    piRemainingQty,
    dispatchStillNeedQty,
    stillNeedQty,
    issueableQty,
    warehouseBookQty,
    warehousePendingOutQty,
    warehouseActualQty,
    warehouseDisplayActualQty: round(stock.displayActualQty ?? warehouseActualQty, PRODUCTION_ISSUE_QTY_PRECISION),
    kcaa01: materialCode,
    kcaa02: mat.kcaa02,
    kcaa03: mat.kcaa03,
    kcaa04: mat.kcaa04,
    kcaa11: mat.kcaa11,
    kcaq03: issueableQty,
    kcaq031: warehouseActualQty,
    kcaq04,
    kcaq041,
    kcaq05: round(issueableQty * kcaq04, 2),
    kcaq051: round(issueableQty * kcaq041, 2),
    tax,
    reference: text(ctx.piNo),
    Describe: materialName,
    info: materialName,
    expandSource: 'pi_cost_cutting',
    pendingOutboundText: formatPendingText(ctx.sourcePendingDocMap?.get(materialCode)),
    ...select,
    ...mat,
  }
}

function selectedSetHas(selectedSet, materialLineKey, materialDedupKey) {
  const set = selectedSet instanceof Set ? selectedSet : new Set()
  return set.has(materialLineKey) || (materialDedupKey && set.has(materialDedupKey))
}

/**
 * @param {import('mssql').ConnectionPool} pool
 * @param {Record<string, string>} query
 */
export async function fetchCuttingIssueBatchLines(pool, query = {}) {
  const sourceOrderNo = text(query.sourceOrderNo)
  const workshopCode = text(query.workshopCode)
  const warehouseCode = text(query.warehouseCode)
  const piNo = text(query.piNo)
  const dispatchSystemcode = text(query.dispatchSystemcode)

  if (!sourceOrderNo) return { ok: false, status: 400, msg: '请先选择关联派工单号' }
  if (!workshopCode) return { ok: false, status: 400, msg: '请先选择生产车间!' }
  if (!warehouseCode) return { ok: false, status: 400, msg: '请先选择仓库' }
  if (!piNo) return { ok: false, status: 400, msg: '请先带出 PI 号' }
  if (!isCuttingWorkshop(workshopCode)) {
    return { ok: false, status: 400, msg: '当前接口仅用于开料部批量添加' }
  }

  const keyword = text(query.keyword)
  const excludeOutboundNo = text(query.excludeOutboundNo)
  const paging = parseProductionIssueBatchPaging(query)
  const hasSelectedKeys = hasSelectedKeysInput(query)
  const outboundLineKeys = (!hasSelectedKeys && excludeOutboundNo)
    ? await fetchProductionIssueOutboundLineKeys(pool, excludeOutboundNo)
    : []
  const selectedSet = mergeAssistIssueSelectedKeys(query.selectedKeys, outboundLineKeys)

  const headerCheck = await validateProductionDispatchHeader(pool, {
    sourceOrderNo,
    workshopCode,
    dispatchSystemcode,
  })
  if (!headerCheck.ok) return headerCheck

  const categoryCodes = await fetchCuttingIssueCategoryCodes(pool)
  if (!categoryCodes.length) {
    return {
      ok: true,
      list: [],
      total: 0,
      page: paging.page,
      pageSize: paging.pageSize,
      sourceOrderNo,
      workshopCode,
      warehouseCode,
      piNo,
      batchMode: 'cutting',
      piCostHint: '未配置开料出库物料分类，请超级管理员在「开料出库配置」中勾选分类',
    }
  }

  const piCostRows = await fetchPiCostRowsForCuttingIssue(pool, { piNo, categoryCodes })
  const aggregated = aggregateCuttingIssueRows(piCostRows)
  const filtered = filterCuttingRows(aggregated, keyword)

  if (!filtered.length) {
    return {
      ok: true,
      list: [],
      total: 0,
      page: paging.page,
      pageSize: paging.pageSize,
      sourceOrderNo,
      workshopCode,
      warehouseCode,
      piNo,
      batchMode: 'cutting',
      piCostHint: '当前 PI 下未匹配到裁片结构源料，请确认 PI 已完成一键运算且分类配置正确',
    }
  }

  const materialCodes = [...new Set(filtered.map((row) => text(row.childKcaa01)).filter(Boolean))]
  const [stockMap, sourceOutboundResult, purchasePriceMap, piDemandMap, piIssuedMap] = await Promise.all([
    fetchWarehouseStockByMaterial(pool, { warehouseCode, materialCodes, excludeOutboundNo }),
    fetchProductionSourceOutboundByChildMaterial(pool, {
      sourceOrderNo,
      warehouseCode,
      materialCodes,
      excludeOutboundNo,
    }),
    fetchLatestPurchasePriceByMaterial(pool, materialCodes),
    fetchPiDemandByMaterial(pool, { piNo, materialCodes }),
    fetchPiOutboundByMaterial(pool, { piNo, materialCodes, excludeOutboundNo }),
  ])

  const ctx = {
    piNo,
    stockMap,
    sourceOutboundMap: sourceOutboundResult.aggMap,
    sourcePendingDocMap: sourceOutboundResult.pendingDocMap,
    piDemandMap,
    piIssuedMap,
    purchasePriceMap,
    selectedSet,
  }
  const mappedRows = filtered.map((row) => mapCuttingIssueLineRow(row, ctx))
  const sliced = sliceProductionIssueBatchList(mappedRows, paging)

  return {
    ok: true,
    list: sliced.list,
    total: sliced.total,
    page: sliced.page,
    pageSize: sliced.pageSize,
    fetchAll: paging.fetchAll,
    sourceOrderNo,
    workshopCode,
    warehouseCode,
    piNo,
    batchMode: 'cutting',
  }
}
