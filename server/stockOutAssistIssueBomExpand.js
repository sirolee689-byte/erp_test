/**
 * 外协领料批量添加：外协明细 → 子料展开（PI pi_cost 或 Bom_parts 直接子层）。
 * 不在接口内递归 BOM；PI 路径只读已运算 pi_cost。
 * 带 PI 时按 sid+pq 拉 pi_cost；子料候选以 Bom_000.systemcode 下 Bom_parts 直接子层为准。
 */
import { sql } from './db.js'
import { safeDecimalExpr, nvarcharTextExpr } from './buyOrderSqlSafe.js'
import { INV_BOM_MASTER_FROM, INV_BOM_PARTS_FROM } from './bomTables.js'
import { normKcaa01 } from './salesOrderSaveLogic.js'
import { PI_COST_PARENT_T_FIELD_KEYS } from './salesOrderPiCostFields.js'
import { computeAssistKsum } from './stockInAssistBatchAdd.js'

const PI_COST_FROM = 'dbo.[UB_ERP_Bom_pi_cost]'

const KCAA_COLS = Array.from({ length: 35 }, (_, i) => `kcaa${String(i + 1).padStart(2, '0')}`)

/** 订单外发 pi_cost 合并键：除用量外的一整套物料属性与来源字段 */
const PI_COST_OUTBOUND_MERGE_EXTRA = [
  'Describe',
  'location',
  'systemcode',
  'GUID',
  'top_kcaa01',
  'top_kcaa02',
  'kpname',
  'kcaa02_en',
  'version',
  'content',
  'Customer_Name',
  'Customer_supply',
  ...Array.from({ length: 35 }, (_, i) => `t_kcaa${String(i + 1).padStart(2, '0')}`),
]

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

/** 批量行去重键：外协明细 wxak02 + 子料 kcaa01 */
export function buildAssistIssueLineKey(wxak02, childKcaa01) {
  const src = text(wxak02).toLowerCase()
  const child = normKcaa01(childKcaa01).toLowerCase()
  if (!src || !child) return ''
  return `${src}|${child}`
}

/** 还需出库量 = 换算外协数量 × 单用量 */
export function computeAssistIssueRequiredQty({ wxak03, kcaa26, kcaa27, unitUsage }) {
  const ksum = computeAssistKsum(wxak03, kcaa26, kcaa27)
  const usage = toNumber(unitUsage)
  return round(ksum * usage, ASSIST_ISSUE_QTY_PRECISION)
}

/** 默认可领 = min(还需出库数量, 仓库实际库存) */
export function computeAssistIssueDefaultQty({ stillNeedQty, warehouseActualQty }) {
  const need = Math.max(0, toNumber(stillNeedQty))
  const stock = Math.max(0, toNumber(warehouseActualQty))
  return round(Math.min(need, stock), ASSIST_ISSUE_QTY_PRECISION)
}

/**
 * 内存汇总 pi_cost：同子料 kcaa01 累加 kcac04 为单用量。
 * @param {any[]} rows
 */
export function aggregatePiCostChildrenByMaterial(rows) {
  /** @type {Map<string, { kcaa01: string, unitUsage: number, snapshot: Record<string, unknown> }>} */
  const map = new Map()
  for (const row of Array.isArray(rows) ? rows : []) {
    const code = normKcaa01(row?.kcaa01)
    if (!code) continue
    const key = code.toLowerCase()
    const usage = toNumber(row?.kcac04)
    const prev = map.get(key) ?? { kcaa01: code, unitUsage: 0, snapshot: row }
    prev.unitUsage = round(prev.unitUsage + usage, 6)
    prev.snapshot = row
    map.set(key, prev)
  }
  return [...map.values()].map((entry) => ({
    childKcaa01: entry.kcaa01,
    unitUsage: entry.unitUsage,
    snapshot: entry.snapshot,
    expandSource: 'pi_cost',
  }))
}

/**
 * pi_cost 是否存在 top_kcaa01 = 外发对应 的锚点行（散件/锚点即自身场景）。
 * @param {any[]} piCostRows
 * @param {string} outsourceKcaa01
 * @param {string} [product]
 */
export function hasPiCostAnchorMatch(piCostRows, outsourceKcaa01, product = '') {
  const outsource = normKcaa01(outsourceKcaa01)
  const prod = normKcaa01(product)
  if (!outsource) return false
  return (Array.isArray(piCostRows) ? piCostRows : []).some((row) => {
    if (normKcaa01(row?.top_kcaa01 ?? row?.topKcaa01) !== outsource) return false
    if (prod && normKcaa01(row?.pq) !== prod) return false
    return true
  })
}

/**
 * @param {any[]} piCostRows 已按 sid+pq 筛过的 pi_cost 行
 * @param {string} outsourceKcaa01
 * @param {string} [product]
 */
export function pickPiCostChildrenForLine(piCostRows, outsourceKcaa01, product = '') {
  const outsource = normKcaa01(outsourceKcaa01)
  const prod = normKcaa01(product)
  const matched = (Array.isArray(piCostRows) ? piCostRows : []).filter((row) => {
    if (normKcaa01(row?.top_kcaa01 ?? row?.topKcaa01) !== outsource) return false
    if (prod && normKcaa01(row?.pq) !== prod) return false
    const child = normKcaa01(row?.kcaa01)
    if (!child || child === outsource) return false
    return true
  })
  return aggregatePiCostChildrenByMaterial(matched)
}

/** pickPiCostChildrenForLine 结果转 childKcaa01 → 用量条目 Map */
function buildPiCostUsageMap(piChildren) {
  const map = new Map()
  for (const entry of Array.isArray(piChildren) ? piChildren : []) {
    const key = normKcaa01(entry.childKcaa01).toLowerCase()
    if (key) map.set(key, entry)
  }
  return map
}

/**
 * @param {import('mssql').ConnectionPool} pool
 * @param {{ piNo: string, products?: string[] }} opts
 */
export async function fetchPiCostRowsForAssistIssue(pool, { piNo, products = [] }) {
  const pi = text(piNo)
  const pqs = [...new Set((products ?? []).map((c) => normKcaa01(c)).filter(Boolean))]
  if (!pi || !pqs.length) return []

  const req = pool.request().input('piNo', sql.NVarChar(200), pi)
  const inList = pqs.map((c, i) => {
    const p = `pq${i}`
    req.input(p, sql.NVarChar(300), c)
    return `@${p}`
  }).join(', ')

  const r = await req.query(`
    SELECT
      LTRIM(RTRIM(CONVERT(nvarchar(300), ISNULL(c.[pq], N'')))) AS pq,
      LTRIM(RTRIM(CONVERT(nvarchar(300), ISNULL(c.[kcaa01], N'')))) AS kcaa01,
      LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(c.[kcaa02], N'')))) AS kcaa02,
      LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(c.[kcaa03], N'')))) AS kcaa03,
      LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(c.[kcaa04], N'')))) AS kcaa04,
      LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(c.[kcaa11], N'')))) AS kcaa11,
      CAST(ISNULL(c.[kcac04], 0) AS decimal(18, 6)) AS kcac04,
      LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(c.[Describe], N'')))) AS Describe,
      LTRIM(RTRIM(CONVERT(nvarchar(300), ISNULL(c.[top_kcaa01], N'')))) AS top_kcaa01,
      LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(c.[top_kcaa02], N'')))) AS top_kcaa02,
      CAST(ISNULL(c.[sale_price], 0) AS decimal(18, 6)) AS sale_price,
      CAST(ISNULL(c.[cost_price], 0) AS decimal(18, 6)) AS cost_price
    FROM ${PI_COST_FROM} AS c
    WHERE LTRIM(RTRIM(ISNULL(c.[sid], N''))) = @piNo
      AND ISNULL(c.[isok], 0) = 1
      AND LTRIM(RTRIM(CONVERT(nvarchar(300), ISNULL(c.[pq], N'')))) IN (${inList})
    ORDER BY c.[id] ASC
  `)
  return r.recordset ?? []
}

/**
 * 订单外发：pi_cost 行合并键（旧系统 GROUP BY 全套物料属性 + 来源字段）。
 * @param {Record<string, unknown>} row
 */
export function buildPiCostOutboundMergeKey(row) {
  const parts = []
  for (const col of KCAA_COLS) {
    parts.push(normKcaa01(row?.[col]))
  }
  for (const col of PI_COST_OUTBOUND_MERGE_EXTRA) {
    parts.push(text(row?.[col]))
  }
  return parts.join('\u0001').toLowerCase()
}

/**
 * 订单外发：同 mergeKey 累加 kcac06 为单用量。
 * @param {any[]} rows
 */
export function aggregatePiCostOutboundChildren(rows) {
  /** @type {Map<string, { kcaa01: string, unitUsage: number, snapshot: Record<string, unknown> }>} */
  const map = new Map()
  for (const row of Array.isArray(rows) ? rows : []) {
    const code = normKcaa01(row?.kcaa01)
    if (!code) continue
    const key = buildPiCostOutboundMergeKey(row)
    const usage = toNumber(row?.kcac06)
    const prev = map.get(key) ?? { kcaa01: code, unitUsage: 0, snapshot: row }
    prev.unitUsage = round(prev.unitUsage + usage, 6)
    prev.snapshot = row
    map.set(key, prev)
  }
  return [...map.values()].map((entry) => ({
    childKcaa01: entry.kcaa01,
    unitUsage: entry.unitUsage,
    snapshot: entry.snapshot,
    expandSource: 'pi_cost_outbound',
  }))
}

/**
 * @param {import('mssql').ConnectionPool} pool
 * @param {{ pairs?: { sid: string, pq: string }[] }} opts
 */
export async function fetchPiCostRowsForAssistIssueOutbound(pool, { pairs = [] } = {}) {
  const unique = []
  const seen = new Set()
  for (const pair of pairs ?? []) {
    const sid = text(pair?.sid)
    const pq = normKcaa01(pair?.pq)
    if (!sid || !pq) continue
    const key = `${sid.toLowerCase()}\u0001${pq.toLowerCase()}`
    if (seen.has(key)) continue
    seen.add(key)
    unique.push({ sid, pq })
  }
  if (!unique.length) return []

  const req = pool.request()
  const pairWhere = unique.map((pair, i) => {
    req.input(`sid${i}`, sql.NVarChar(200), pair.sid)
    req.input(`pq${i}`, sql.NVarChar(300), pair.pq)
    return `(LTRIM(RTRIM(ISNULL(c.[sid], N''))) = @sid${i} AND LTRIM(RTRIM(CONVERT(nvarchar(300), ISNULL(c.[pq], N'')))) = @pq${i})`
  }).join(' OR ')

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
      c.[Customer_supply] AS Customer_supply
    FROM ${PI_COST_FROM} AS c
    WHERE ISNULL(c.[isok], 0) = 1
      AND (${pairWhere})
    ORDER BY c.[id] ASC
  `)
  return r.recordset ?? []
}

/**
 * 订单外发单条外协明细：sid=明细.pi、pq=明细.kcaa01，子料来自 pi_cost.kcaa01。
 * @param {Record<string, unknown>} assistLine
 * @param {{ piNo?: string, piCostOutboundRows?: any[] }} ctx
 */
export function expandAssistIssueLineForOutbound(assistLine, ctx = {}) {
  const sid = text(assistLine.pi || ctx.piNo)
  const pq = normKcaa01(assistLine.kcaa01)
  const outsourceKcaa01 = pq
  const sourceLineCode = text(assistLine.wxak02 || assistLine.systemcode || assistLine.GUID)

  const matched = (Array.isArray(ctx.piCostOutboundRows) ? ctx.piCostOutboundRows : []).filter((row) => {
    const rowSid = text(row.sid)
    const rowPq = normKcaa01(row.pq)
    if (rowPq !== pq) return false
    if (sid && rowSid && rowSid !== sid) return false
    return true
  })

  let children = matched.length ? aggregatePiCostOutboundChildren(matched) : []
  if (!children.length) {
    children = buildFallbackSelfChild(assistLine)
  }

  return children.map((child) => ({
    ...assistLine,
    outsourceKcaa01,
    childKcaa01: child.childKcaa01,
    unitUsage: child.unitUsage,
    expandSource: child.expandSource,
    childSnapshot: child.snapshot,
    sourceLineCode,
    wxak02: sourceLineCode,
  }))
}

async function batchExpandAssistIssueLinesOutbound(pool, assistLines, piNo = '') {
  const lines = Array.isArray(assistLines) ? assistLines : []
  if (!lines.length) return []

  const pairs = lines.map((line) => ({
    sid: text(line.pi || piNo),
    pq: normKcaa01(line.kcaa01),
  })).filter((p) => p.sid && p.pq)

  const piCostOutboundRows = pairs.length
    ? await fetchPiCostRowsForAssistIssueOutbound(pool, { pairs })
    : []

  const ctx = { piNo, piCostOutboundRows }
  const flat = []
  for (const line of lines) {
    flat.push(...expandAssistIssueLineForOutbound(line, ctx))
  }
  return flat
}

/**
 * 批量查外发物料 Bom_000 头档 systemcode（对齐外协退料 fetchBomHeadByKcaa01）。
 * @param {import('mssql').ConnectionPool} pool
 * @param {string[]} materialCodes
 */
export async function fetchBomHeadSystemcodeBatch(pool, materialCodes = []) {
  const codes = [...new Set((materialCodes ?? []).map((c) => normKcaa01(c)).filter(Boolean))]
  if (!codes.length) return new Map()

  const req = pool.request()
  const inList = codes.map((c, i) => {
    const p = `mc${i}`
    req.input(p, sql.NVarChar(300), c)
    return `@${p}`
  }).join(', ')

  const r = await req.query(`
    SELECT
      ${nvarcharTextExpr('b', 'kcaa01', 300)} AS kcaa01,
      ${nvarcharTextExpr('b', 'systemcode', 200)} AS systemcode,
      ${nvarcharTextExpr('b', 'GUID', 200)} AS bomGuid,
      ROW_NUMBER() OVER (
        PARTITION BY LTRIM(RTRIM(CONVERT(nvarchar(300), ISNULL(b.[kcaa01], N''))))
        ORDER BY b.[id] DESC
      ) AS rn
    FROM ${INV_BOM_MASTER_FROM} AS b
    WHERE ${delActiveSql('b')}
      AND LTRIM(RTRIM(CONVERT(nvarchar(300), ISNULL(b.[kcaa01], N'')))) IN (${inList})
  `)

  const map = new Map()
  for (const row of r.recordset ?? []) {
    if (Number(row.rn) !== 1) continue
    const key = normKcaa01(row.kcaa01).toLowerCase()
    if (key) map.set(key, row)
  }
  return map
}

/**
 * 批量查物料编码对应 UB_ERP_Bom_000 货品名称（生产领料备注：pq → kcaa02）。
 * @param {import('mssql').ConnectionPool} pool
 * @param {string[]} materialCodes
 * @returns {Promise<Map<string, string>>} lowercase kcaa01 → kcaa02
 */
export async function fetchBom000Kcaa02ByMaterialBatch(pool, materialCodes = []) {
  const codes = [...new Set((materialCodes ?? []).map((c) => normKcaa01(c)).filter(Boolean))]
  if (!codes.length) return new Map()

  const req = pool.request()
  const inList = codes.map((c, i) => {
    const p = `mc${i}`
    req.input(p, sql.NVarChar(300), c)
    return `@${p}`
  }).join(', ')

  const r = await req.query(`
    SELECT
      ${nvarcharTextExpr('b', 'kcaa01', 300)} AS kcaa01,
      ${nvarcharTextExpr('b', 'kcaa02', 500)} AS kcaa02,
      ROW_NUMBER() OVER (
        PARTITION BY LTRIM(RTRIM(CONVERT(nvarchar(300), ISNULL(b.[kcaa01], N''))))
        ORDER BY b.[id] DESC
      ) AS rn
    FROM ${INV_BOM_MASTER_FROM} AS b
    WHERE ${delActiveSql('b')}
      AND LTRIM(RTRIM(CONVERT(nvarchar(300), ISNULL(b.[kcaa01], N'')))) IN (${inList})
  `)

  const map = new Map()
  for (const row of r.recordset ?? []) {
    if (Number(row.rn) !== 1) continue
    const key = normKcaa01(row.kcaa01).toLowerCase()
    const name = text(row.kcaa02)
    if (key && name) map.set(key, name)
  }
  return map
}

/** 外协明细 → Bom_parts 父键：优先 Bom_000.systemcode，wxak02 兜底 */
export function resolveAssistIssueBomParentKey(assistLine, bomHeadMap) {
  const code = normKcaa01(assistLine?.kcaa01)
  const head = code ? bomHeadMap?.get(code.toLowerCase()) : null
  return text(head?.systemcode || head?.bomGuid)
    || text(assistLine?.wxak02 || assistLine?.systemcode || assistLine?.GUID)
}

/**
 * @param {import('mssql').ConnectionPool} pool
 * @param {string[]} parentGuids Bom_000.systemcode 或 wxak02 兜底
 */
export async function fetchBomPartsDirectChildrenBatch(pool, parentGuids = []) {
  const parents = [...new Set((parentGuids ?? []).map((g) => text(g)).filter(Boolean))]
  if (!parents.length) return new Map()

  const req = pool.request()
  const inList = parents.map((g, i) => {
    const p = `pg${i}`
    req.input(p, sql.NVarChar(200), g)
    return `@${p}`
  }).join(', ')

  // kcaa01 已单独用 nvarcharTextExpr 选出，勿再列入 KCAA_COLS，否则驱动会得到重复列名数组
  const kcaaSelect = KCAA_COLS.filter((col) => col !== 'kcaa01').map((col) => `p.[${col}]`).join(', ')
  const r = await req.query(`
    SELECT
      ${nvarcharTextExpr('p', 'kcac01', 200)} AS parentGuid,
      ${nvarcharTextExpr('p', 'kcaa01', 300)} AS kcaa01,
      ${safeDecimalExpr('p', 'kcac04')} AS kcac04,
      ${kcaaSelect ? `${kcaaSelect},` : ''}
      p.[sale_price] AS sale_price,
      p.[cost_price] AS cost_price,
      p.[Describe] AS Describe,
      p.[kpname] AS kpname,
      p.[kcaa02_en] AS kcaa02_en,
      p.[version] AS version
    FROM ${INV_BOM_PARTS_FROM} AS p
    WHERE ${delActiveSql('p')}
      AND ${nvarcharTextExpr('p', 'kcac01', 200)} IN (${inList})
    ORDER BY p.[Seq], p.[id]
  `)

  /** @type {Map<string, any[]>} */
  const map = new Map()
  for (const row of r.recordset ?? []) {
    const parent = text(row.parentGuid)
    const child = normKcaa01(row.kcaa01)
    if (!parent || !child) continue
    const key = parent.toLowerCase()
    const list = map.get(key) ?? []
    list.push(row)
    map.set(key, list)
  }
  return map
}

function mapBomPartsChildren(rows) {
  return (Array.isArray(rows) ? rows : []).map((row) => ({
    childKcaa01: normKcaa01(row.kcaa01),
    unitUsage: round(toNumber(row.kcac04), 6) || 1,
    snapshot: row,
    expandSource: 'bom_parts',
  })).filter((x) => x.childKcaa01)
}

function buildFallbackSelfChild(assistLine) {
  return [{
    childKcaa01: normKcaa01(assistLine.kcaa01),
    unitUsage: 1,
    snapshot: assistLine,
    expandSource: 'self',
  }]
}

/**
 * 合并 Bom_parts 直接子层与 pi_cost 单用量（仅 top 锚点命中外发对应时取 pi_cost 汇总）。
 * @param {any[]} partsRows
 * @param {Map<string, { unitUsage: number, snapshot: any }>} [piUsageMap]
 */
export function mergeBomPartsWithPiUsage(partsRows, piUsageMap) {
  return (Array.isArray(partsRows) ? partsRows : []).map((row) => {
    const childKcaa01 = normKcaa01(row.kcaa01)
    const bomUsage = round(toNumber(row.kcac04), 6) || 1
    const piEntry = piUsageMap?.get(childKcaa01.toLowerCase())
    if (piEntry) {
      return {
        childKcaa01,
        unitUsage: piEntry.unitUsage,
        snapshot: piEntry.snapshot ?? row,
        expandSource: 'pi_cost',
      }
    }
    return {
      childKcaa01,
      unitUsage: bomUsage,
      snapshot: row,
      expandSource: 'bom_parts',
    }
  }).filter((x) => x.childKcaa01)
}

/**
 * 单条外协明细展开为子料候选（同步；需预先批量拉取 piCostRows / bomPartsMap / bomHeadMap）。
 * @param {Record<string, unknown>} assistLine
 * @param {{ piNo?: string, piCostRows?: any[], bomPartsMap?: Map<string, any[]>, bomHeadMap?: Map<string, any> }} ctx
 */
export function expandAssistIssueLine(assistLine, ctx = {}) {
  const piNo = text(ctx.piNo)
  const outsourceKcaa01 = normKcaa01(assistLine.kcaa01)
  const product = normKcaa01(assistLine.Product ?? assistLine.product)
  const parentGuid = resolveAssistIssueBomParentKey(assistLine, ctx.bomHeadMap)
  const sourceLineCode = text(assistLine.wxak02 || assistLine.systemcode || assistLine.GUID)

  const partsRows = parentGuid
    ? (ctx.bomPartsMap?.get(parentGuid.toLowerCase()) ?? [])
    : []

  let children = []
  const piAnchorMatched = piNo && hasPiCostAnchorMatch(ctx.piCostRows ?? [], outsourceKcaa01, product)
  const piUsageMap = piAnchorMatched
    ? buildPiCostUsageMap(pickPiCostChildrenForLine(ctx.piCostRows ?? [], outsourceKcaa01, product))
    : null

  if (partsRows.length) {
    children = piUsageMap
      ? mergeBomPartsWithPiUsage(partsRows, piUsageMap)
      : mapBomPartsChildren(partsRows)
  } else if (piAnchorMatched) {
    // 散件等无 Bom 直接子层、但 pi_cost 锚点即外发编码
    children = pickPiCostChildrenForLine(ctx.piCostRows ?? [], outsourceKcaa01, product)
  }

  if (!children.length) {
    children = buildFallbackSelfChild(assistLine)
  }

  return children.map((child) => ({
    ...assistLine,
    outsourceKcaa01,
    childKcaa01: child.childKcaa01,
    unitUsage: child.unitUsage,
    expandSource: child.expandSource,
    childSnapshot: child.snapshot,
    sourceLineCode,
    wxak02: sourceLineCode,
  }))
}

/**
 * @param {import('mssql').ConnectionPool} pool
 * @param {any[]} assistLines
 * @param {string} piNo
 * @param {{ assistType?: string }} [opts]
 */
export async function batchExpandAssistIssueLines(pool, assistLines, piNo = '', opts = {}) {
  const lines = Array.isArray(assistLines) ? assistLines : []
  if (!lines.length) return []

  if (text(opts.assistType) === '2') {
    return batchExpandAssistIssueLinesOutbound(pool, lines, piNo)
  }

  const outsourceCodes = lines.map((l) => normKcaa01(l.kcaa01)).filter(Boolean)
  const products = lines.map((l) => normKcaa01(l.Product ?? l.product)).filter(Boolean)

  const [piCostRows, bomHeadMap] = await Promise.all([
    text(piNo) ? fetchPiCostRowsForAssistIssue(pool, { piNo, products }) : Promise.resolve([]),
    fetchBomHeadSystemcodeBatch(pool, outsourceCodes),
  ])

  const parentGuids = lines
    .map((line) => resolveAssistIssueBomParentKey(line, bomHeadMap))
    .filter(Boolean)

  const bomPartsMap = await fetchBomPartsDirectChildrenBatch(pool, parentGuids)

  const ctx = { piNo, piCostRows, bomPartsMap, bomHeadMap }
  const flat = []
  for (const line of lines) {
    flat.push(...expandAssistIssueLine(line, ctx))
  }
  return flat
}

/**
 * 批量页 PI 提示：仅无展开或全部兜底 self 时提示，Bom 子层成功不误导。
 * @param {string} piNo
 * @param {any[]} expandedRaw
 * @param {{ assistType?: string }} [opts]
 */
export function buildAssistIssuePiCostHint(piNo, expandedRaw, opts = {}) {
  if (!text(piNo)) return ''
  const rows = Array.isArray(expandedRaw) ? expandedRaw : []
  if (!rows.length) {
    return '当前 PI 未找到可展开子料，请确认已完成销售订单一键运算'
  }
  if (rows.every((r) => text(r.expandSource) === 'self')) {
    return text(opts.assistType) === '2'
      ? '当前 PI 未命中 pi_cost 用量结果，已以外协明细本身兜底'
      : '当前 PI 未命中 pi_cost/BOM 子层，已以外协明细本身兜底'
  }
  return ''
}

/**
 * @param {import('mssql').ConnectionPool} pool
 * @param {string[]} materialCodes
 */
export async function fetchBom000SnapshotsByKcaa01(pool, materialCodes = []) {
  const codes = [...new Set((materialCodes ?? []).map((c) => normKcaa01(c)).filter(Boolean))]
  if (!codes.length) return new Map()

  const req = pool.request()
  const inList = codes.map((c, i) => {
    const p = `mc${i}`
    req.input(p, sql.NVarChar(300), c)
    return `@${p}`
  }).join(', ')

  const kcaaSelect = KCAA_COLS.map((col) => `b.[${col}]`).join(', ')
  const r = await req.query(`
    SELECT
      ${kcaaSelect},
      b.[sale_price] AS sale_price,
      b.[cost_price] AS cost_price,
      b.[kpname] AS kpname,
      b.[kcaa02_en] AS kcaa02_en,
      b.[version] AS version,
      b.[systemcode] AS systemcode,
      b.[GUID] AS bomGuid,
      ROW_NUMBER() OVER (
        PARTITION BY LTRIM(RTRIM(CONVERT(nvarchar(300), ISNULL(b.[kcaa01], N''))))
        ORDER BY b.[id] DESC
      ) AS rn
    FROM ${INV_BOM_MASTER_FROM} AS b
    WHERE ${delActiveSql('b')}
      AND LTRIM(RTRIM(CONVERT(nvarchar(300), ISNULL(b.[kcaa01], N'')))) IN (${inList})
  `)

  const map = new Map()
  for (const row of r.recordset ?? []) {
    if (Number(row.rn) !== 1) continue
    const key = normKcaa01(row.kcaa01).toLowerCase()
    if (key) map.set(key, row)
  }
  return map
}

/** 展开后关键字过滤（仅子料材料编码 kcaa01） */
export function filterExpandedAssistIssueRows(rows, keyword) {
  const kw = text(keyword).toLowerCase()
  if (!kw) return Array.isArray(rows) ? rows : []
  return (Array.isArray(rows) ? rows : []).filter((row) =>
    text(row.childKcaa01).toLowerCase().includes(kw),
  )
}
