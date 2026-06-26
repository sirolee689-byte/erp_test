/**
 * 生产领料批量添加：派工明细 → PI 成本用量展开实际出库材料（对齐旧 ub_erp_stocks_out_s5）。
 * 按全套物料属性分组，禁止仅按 kcaa01 合并。
 */
import { sql } from './db.js'
import { safeDecimalExpr, nvarcharTextExpr } from './buyOrderSqlSafe.js'
import { normKcaa01 } from './salesOrderSaveLogic.js'
import { PI_COST_PARENT_T_FIELD_KEYS } from './salesOrderPiCostFields.js'
import {
  buildPiCostOutboundMergeKey,
} from './stockOutAssistIssueBomExpand.js'

const PI_COST_FROM = 'dbo.[UB_ERP_Bom_pi_cost]'

const KCAA_COLS = Array.from({ length: 35 }, (_, i) => `kcaa${String(i + 1).padStart(2, '0')}`)

/** 生产领料批量：出库数量三位小数 */
export const PRODUCTION_ISSUE_QTY_PRECISION = 3

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

/** 批量行去重键：派工明细 scak02 + 材料全套属性合并键 */
export function buildProductionIssueLineKey(scak02, mergeKey) {
  const src = text(scak02).toLowerCase()
  const mat = text(mergeKey).toLowerCase()
  if (!src || !mat) return ''
  return `${src}|${mat}`
}

/**
 * 单条派工明细筛选 pi_cost：sid=PI 且 (top_kcaa01=顶层 OR pq=派工物料)。
 * @param {any[]} piCostRows
 * @param {{ pq?: string, topKcaa01?: string }} opts
 */
export function pickPiCostRowsForDispatchLine(piCostRows, { pq = '', topKcaa01 = '' } = {}) {
  const targetPq = normKcaa01(pq)
  const targetTop = normKcaa01(topKcaa01 || pq)
  if (!targetPq && !targetTop) return []
  return (Array.isArray(piCostRows) ? piCostRows : []).filter((row) => {
    const rowPq = normKcaa01(row?.pq)
    const rowTop = normKcaa01(row?.top_kcaa01 ?? row?.topKcaa01)
    if (targetPq && rowPq === targetPq) return true
    if (targetTop && rowTop === targetTop) return true
    return false
  })
}

/**
 * 同 mergeKey 累加 kcac06，再乘派工数量得本次派工需求量。
 * @param {any[]} rows
 * @param {number} scak03
 */
export function aggregateProductionIssueMaterialRows(rows, scak03) {
  const dispatchQty = toNumber(scak03)
  /** @type {Map<string, { mergeKey: string, kcaa01: string, unitUsageSum: number, snapshot: Record<string, unknown> }>} */
  const map = new Map()
  for (const row of Array.isArray(rows) ? rows : []) {
    const code = normKcaa01(row?.kcaa01)
    if (!code) continue
    const mergeKey = buildPiCostOutboundMergeKey(row)
    const usage = toNumber(row?.kcac06)
    const prev = map.get(mergeKey) ?? { mergeKey, kcaa01: code, unitUsageSum: 0, snapshot: row }
    prev.unitUsageSum = round(prev.unitUsageSum + usage, 6)
    prev.snapshot = row
    map.set(mergeKey, prev)
  }
  return [...map.values()].map((entry) => ({
    mergeKey: entry.mergeKey,
    childKcaa01: entry.kcaa01,
    unitUsageSum: entry.unitUsageSum,
    dispatchDemandQty: round(entry.unitUsageSum * dispatchQty, PRODUCTION_ISSUE_QTY_PRECISION),
    snapshot: entry.snapshot,
    expandSource: 'pi_cost_production',
  }))
}

/**
 * 单条派工明细展开为实际出库材料行。
 * @param {Record<string, unknown>} dispatchLine
 * @param {any[]} piCostRows 已按 PI 批量拉取的 pi_cost
 * @param {string} piNo
 */
export function expandProductionDispatchLine(dispatchLine, piCostRows, piNo = '') {
  const pq = normKcaa01(dispatchLine?.kcaa01)
  const topKcaa01 = pq
  const scak03 = toNumber(dispatchLine?.scak03)
  const scak02 = text(dispatchLine?.scak02 || dispatchLine?.systemcode || dispatchLine?.GUID)
  const sid = text(piNo || dispatchLine?.pi)

  const matched = pickPiCostRowsForDispatchLine(piCostRows, { pq, topKcaa01 }).filter((row) => {
    const rowSid = text(row?.sid)
    return !sid || !rowSid || rowSid === sid
  })

  const children = aggregateProductionIssueMaterialRows(matched, scak03)
  return children.map((child) => ({
    ...child,
    scak02,
    scak03,
    dispatchKcaa01: pq,
    dispatchKcaa02: text(dispatchLine?.kcaa02),
    dispatchPi: text(dispatchLine?.pi || piNo),
    sourceLineCode: scak02,
  }))
}

/**
 * 批量拉取 PI 成本行：sid=PI 且 isok=1，top_kcaa01 或 pq 命中派工物料编码集合。
 * @param {import('mssql').ConnectionPool} pool
 * @param {{ piNo: string, dispatchMaterialCodes?: string[] }} opts
 */
export async function fetchPiCostRowsForProductionIssue(pool, { piNo, dispatchMaterialCodes = [] } = {}) {
  const pi = text(piNo)
  const codes = [...new Set((dispatchMaterialCodes ?? []).map((c) => normKcaa01(c)).filter(Boolean))]
  if (!pi || !codes.length) return []

  const req = pool.request().input('piNo', sql.NVarChar(200), pi)
  const topInList = codes.map((code, i) => {
    const p = `top${i}`
    req.input(p, sql.NVarChar(300), code)
    return `@${p}`
  }).join(', ')
  const pqInList = codes.map((code, i) => {
    const p = `pq${i}`
    req.input(p, sql.NVarChar(300), code)
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
      LTRIM(RTRIM(CONVERT(nvarchar(300), ISNULL(c.[pq], N'')))) AS pq,
      ${kcaaSelect},
      ${tKcaaSelect},
      CAST(ISNULL(c.[kcac04], 0) AS decimal(18, 6)) AS kcac04,
      CAST(ISNULL(c.[kcac05], 0) AS decimal(18, 6)) AS kcac05,
      CAST(ISNULL(c.[kcac06], 0) AS decimal(18, 6)) AS kcac06,
      LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(c.[Describe], N'')))) AS Describe,
      LTRIM(RTRIM(CONVERT(nvarchar(300), ISNULL(c.[top_kcaa01], N'')))) AS top_kcaa01,
      LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(c.[top_kcaa02], N'')))) AS top_kcaa02,
      LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(c.[systemcode], N'')))) AS systemcode,
      LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(c.[GUID], N'')))) AS GUID,
      LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(c.[location], N'')))) AS location,
      c.[sale_price] AS sale_price,
      c.[cost_price] AS cost_price,
      c.[kpname] AS kpname,
      c.[kcaa02_en] AS kcaa02_en,
      c.[version] AS version,
      c.[content] AS content,
      c.[Customer_Name] AS Customer_Name,
      c.[Customer_supply] AS Customer_supply,
      LTRIM(RTRIM(CONVERT(nvarchar(50), ISNULL(c.[temp], N'')))) AS temp
    FROM ${PI_COST_FROM} AS c
    WHERE LTRIM(RTRIM(ISNULL(c.[sid], N''))) = @piNo
      AND ISNULL(c.[isok], 0) = 1
      AND (
        LTRIM(RTRIM(CONVERT(nvarchar(300), ISNULL(c.[top_kcaa01], N'')))) IN (${topInList})
        OR LTRIM(RTRIM(CONVERT(nvarchar(300), ISNULL(c.[pq], N'')))) IN (${pqInList})
      )
    ORDER BY c.[id] ASC
  `)
  return r.recordset ?? []
}

/**
 * 批量展开派工明细列表。
 * @param {import('mssql').ConnectionPool} pool
 * @param {any[]} dispatchLines
 * @param {string} piNo
 */
export async function batchExpandProductionDispatchLines(pool, dispatchLines, piNo) {
  const lines = Array.isArray(dispatchLines) ? dispatchLines : []
  if (!lines.length) return []
  const dispatchMaterialCodes = lines.map((line) => normKcaa01(line?.kcaa01)).filter(Boolean)
  const piCostRows = await fetchPiCostRowsForProductionIssue(pool, { piNo, dispatchMaterialCodes })
  const expanded = []
  for (const line of lines) {
    expanded.push(...expandProductionDispatchLine(line, piCostRows, piNo))
  }
  return expanded
}
