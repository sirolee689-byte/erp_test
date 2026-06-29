/**
 * 生产领料批量添加：派工明细经 PI 成本展开 + 来源需出库/库存计算可领数量。
 * 列表按子料 kcaa01 合并展示（对齐外协领料批量）。SQL Server 2008 R2 兼容。
 */
import { sql } from './db.js'
import { safeDecimalExpr, safeIntExpr, nvarcharTextExpr } from './buyOrderSqlSafe.js'
import { calcOtherBatchStockQty } from './stockOutOtherBatchAdd.js'
import { validateProductionDispatchHeader } from './stockInProductionBatchAdd.js'
import {
  buildAssistIssueMaterialDedupKey,
  computeAssistStillNeedQty,
  fetchLatestPurchasePriceByMaterial,
  mergeAssistIssueSelectedKeys,
} from './stockOutAssistIssueBatchAdd.js'
import {
  computeAssistIssueDefaultQty,
  fetchBom000Kcaa02ByMaterialBatch,
} from './stockOutAssistIssueBomExpand.js'
import {
  batchExpandProductionDispatchLines,
  PRODUCTION_ISSUE_QTY_PRECISION,
} from './stockOutProductionIssueBomExpand.js'

const DISPATCH_HEADER_FROM = 'dbo.[UB_ERP_Dispatch_order]'
const DISPATCH_LINE_FROM = 'dbo.[UB_ERP_Dispatch_order_list]'
const STOCK_IN_FROM = 'dbo.[UB_ERP_Stocks_Storage]'
const STOCK_IN_LINE_FROM = 'dbo.[UB_ERP_Stocks_Storage_list]'
const STOCK_OUT_FROM = 'dbo.[UB_ERP_Stocks_out]'
const STOCK_OUT_LINE_FROM = 'dbo.[UB_ERP_Stocks_out_list]'
const PI_COST_FROM = 'dbo.[UB_ERP_Bom_pi_cost]'

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

function passApprovedSql(alias) {
  return `${nvarcharTextExpr(alias, 'pass', 20)} = N'1'`
}

/** 批量列表分页；fetchAll=1 时返回全量（供前端本地搜编码，不受 200 条上限） */
export function parseProductionIssueBatchPaging(query = {}) {
  const fetchAll = ['1', 'true', 'yes'].includes(String(query.fetchAll ?? '').trim().toLowerCase())
  const page = Math.max(1, Number.parseInt(query.page, 10) || 1)
  const rawPageSize = Number.parseInt(query.pageSize, 10) || 20
  const pageSize = fetchAll
    ? Number.MAX_SAFE_INTEGER
    : Math.min(200, Math.max(1, rawPageSize))
  return { page, pageSize, fetchAll }
}

/** 对合并后的批量行切片；fetchAll 时不截断 */
export function sliceProductionIssueBatchList(list, paging) {
  const rows = Array.isArray(list) ? list : []
  const total = rows.length
  const { fetchAll } = paging ?? {}
  if (fetchAll) {
    return { list: rows, total, page: 1, pageSize: total > 0 ? total : 1 }
  }
  const page = Math.max(1, paging?.page ?? 1)
  const pageSize = Math.max(1, paging?.pageSize ?? 20)
  const start = (page - 1) * pageSize
  return { list: rows.slice(start, start + pageSize), total, page, pageSize }
}

function parsePage(query = {}) {
  return parseProductionIssueBatchPaging(query)
}

/** 明细有效行：scak02 与 GUID 一致 */
function lineScak02MatchesGuidSql(alias = 'l') {
  return `
    AND ${nvarcharTextExpr(alias, 'scak02', 200)} = ${nvarcharTextExpr(alias, 'GUID', 200)}
    AND ${nvarcharTextExpr(alias, 'scak02', 200)} <> N''
  `
}

/** pi_cost.temp 空/非法时按 1 参与 PI 共用池总量计算 */
function piCostTempExpr(alias = 'c') {
  return safeDecimalExpr(alias, 'temp', 1)
}

/** PI 共用池剩余 = max(0, PI总量 − PI已出/占用) */
export function computePiRemainingQty({ piDemandQty, piIssuedQty }) {
  const remain = round(toNumber(piDemandQty) - toNumber(piIssuedQty), PRODUCTION_ISSUE_QTY_PRECISION)
  return remain > 0 ? remain : 0
}

/**
 * 双道限制：派工单剩余 与 PI 共用池剩余 取较紧者作为还需出库。
 * 派工维度：本派工+本仓已审/未审；PI 维度：全 PI 跨车间已出（不按 pass 区分）。
 */
export function computeProductionDualStillNeedQty({
  sourceDemandQty,
  dispatchApprovedOutQty = 0,
  dispatchPendingOutQty = 0,
  piDemandQty = 0,
  piIssuedQty = 0,
}) {
  const dispatchStillNeedQty = computeAssistStillNeedQty({
    sourceDemandQty,
    sourceApprovedOutQty: dispatchApprovedOutQty,
    sourcePendingOutQty: dispatchPendingOutQty,
  })
  const piRemainingQty = computePiRemainingQty({ piDemandQty, piIssuedQty })
  const stillNeedQty = round(
    Math.min(dispatchStillNeedQty, piRemainingQty),
    PRODUCTION_ISSUE_QTY_PRECISION,
  )
  return { dispatchStillNeedQty, piRemainingQty, stillNeedQty }
}

/** 派工单维度还需出库（不含 PI 共用池）；保留供单测与对照 */
export function computeProductionStillNeedQty(params) {
  return computeAssistStillNeedQty(params)
}

/** 批量行数量：派工需出库 + PI 共用池 + 库存，统一算还需出库与默认可选 */
export function resolveProductionIssueDualQtyCaps({
  sourceDemandQty,
  dispatchApprovedOutQty = 0,
  dispatchPendingOutQty = 0,
  piDemandQty = 0,
  piIssuedQty = 0,
  warehouseActualQty = 0,
}) {
  const demand = round(sourceDemandQty, PRODUCTION_ISSUE_QTY_PRECISION)
  const dual = computeProductionDualStillNeedQty({
    sourceDemandQty: demand,
    dispatchApprovedOutQty,
    dispatchPendingOutQty,
    piDemandQty,
    piIssuedQty,
  })
  const issueableQty = computeProductionIssueDefaultQty({
    stillNeedQty: dual.stillNeedQty,
    warehouseActualQty,
  })
  return {
    sourceDemandQty: demand,
    sourceApprovedOutQty: round(dispatchApprovedOutQty, PRODUCTION_ISSUE_QTY_PRECISION),
    sourcePendingOutQty: round(dispatchPendingOutQty, PRODUCTION_ISSUE_QTY_PRECISION),
    piDemandQty: round(piDemandQty, PRODUCTION_ISSUE_QTY_PRECISION),
    piIssuedQty: round(piIssuedQty, PRODUCTION_ISSUE_QTY_PRECISION),
    piRemainingQty: dual.piRemainingQty,
    dispatchStillNeedQty: dual.dispatchStillNeedQty,
    stillNeedQty: dual.stillNeedQty,
    issueableQty,
  }
}

/** 默认可领 = min(还需出库, 实际库存) */
export function computeProductionIssueDefaultQty({ stillNeedQty, warehouseActualQty }) {
  return computeAssistIssueDefaultQty({ stillNeedQty, warehouseActualQty })
}

/** 编辑态兜底：本单已存子料编码去重键 */
export function buildProductionIssueMaterialDedupKey(materialCode) {
  return buildAssistIssueMaterialDedupKey(materialCode)
}

export function resolveProductionIssueSelectState({
  issueableQty,
  stillNeedQty,
  warehouseActualQty,
  alreadySelected,
}) {
  if (alreadySelected) {
    return { selectable: false, selectState: 'picked', selectLabel: '已选择' }
  }
  if (toNumber(warehouseActualQty) <= 0) {
    return { selectable: false, selectState: 'no_stock', selectLabel: '库存不足' }
  }
  if (toNumber(stillNeedQty) <= 0) {
    return { selectable: false, selectState: 'unavailable', selectLabel: '不可选' }
  }
  if (toNumber(issueableQty) > 0) {
    return { selectable: true, selectState: 'available', selectLabel: '选择' }
  }
  return { selectable: false, selectState: 'no_stock', selectLabel: '库存不足' }
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

function joinDistinctText(values = [], fallback = '-') {
  const list = [...new Set((values ?? []).map((v) => text(v)).filter(Boolean))]
  if (!list.length) return fallback
  if (list.length <= 2) return list.join(' / ')
  return `${list.slice(0, 2).join(' / ')} 等${list.length}项`
}

function hasSelectedKeysInput(query = {}) {
  return Object.prototype.hasOwnProperty.call(query, 'selectedKeys')
}

export function __buildProductionIssueOutboundLineKeysSqlForTest() {
  return `
    SELECT
      ${nvarcharTextExpr('l', 'kcaq02', 200)} AS sourceLineCode,
      ${nvarcharTextExpr('l', 'kcaa01', 300)} AS materialCode
    FROM ${STOCK_OUT_LINE_FROM} AS l
    WHERE ${nvarcharTextExpr('l', 'kcaq01', 200)} = @outboundNo
      AND ${delActiveSql('l')}
  `
}

export async function fetchProductionIssueOutboundLineKeys(pool, outboundNo) {
  const no = text(outboundNo)
  if (!no) return []
  const r = await pool.request().input('outboundNo', sql.NVarChar(200), no).query(__buildProductionIssueOutboundLineKeysSqlForTest())
  const keys = []
  for (const row of r.recordset ?? []) {
    const src = text(row.sourceLineCode).toLowerCase()
    const mat = text(row.materialCode).toLowerCase()
    if (src && mat) keys.push(`${src}|${mat}`)
    const matKey = buildProductionIssueMaterialDedupKey(row.materialCode)
    if (matKey) keys.push(matKey)
  }
  return keys
}

export function __buildProductionDispatchBatchListSqlForTest() {
  const kcaaSelect = KCAA_COLS.map((col) => `l.[${col}]`).join(', ')
  return `
    SELECT
      l.[id],
      ${nvarcharTextExpr('l', 'scak02', 200)} AS scak02,
      ${nvarcharTextExpr('l', 'systemcode', 200)} AS systemcode,
      ${nvarcharTextExpr('l', 'GUID', 200)} AS GUID,
      ${safeDecimalExpr('l', 'scak03')} AS scak03,
      ${nvarcharTextExpr('l', 'pi', 200)} AS pi,
      ${kcaaSelect}
    FROM ${DISPATCH_LINE_FROM} AS l
    INNER JOIN ${DISPATCH_HEADER_FROM} AS h
      ON ${nvarcharTextExpr('h', 'scaj01', 200)} = ${nvarcharTextExpr('l', 'scak01', 200)}
    WHERE ${nvarcharTextExpr('h', 'scaj01', 200)} = @sourceOrderNo
      AND ${delActiveSql('h')}
      AND ${passApprovedSql('h')}
      AND LTRIM(RTRIM(ISNULL(CONVERT(nvarchar(20), h.[closed]), N'0'))) = N'0'
      AND ${nvarcharTextExpr('h', 'scaj05', 200)} = @workshopCode
      AND ${delActiveSql('l')}
      ${lineScak02MatchesGuidSql('l')}
    ORDER BY ${safeIntExpr('l', 'seq')}, l.[id]
  `
}

export function __buildProductionSourceOutboundSqlForTest() {
  return `
    FROM ${STOCK_OUT_FROM} AS h
    INNER JOIN ${STOCK_OUT_LINE_FROM} AS l
      ON ${nvarcharTextExpr('l', 'kcaq01', 200)} = ${nvarcharTextExpr('h', 'kcap01', 200)}
    WHERE ${delActiveSql('h')}
      AND ${delActiveSql('l')}
      AND ${nvarcharTextExpr('h', 'kcap03', 20)} = N'4'
      AND ${nvarcharTextExpr('h', 'kcap04', 200)} = @sourceOrderNo
      AND ${nvarcharTextExpr('h', 'kcap06', 200)} = @warehouseCode
      AND ${nvarcharTextExpr('l', 'kcaa01', 300)} IN (@mc0)
  `
}

/** PI 共用池总量：sid=PI、isok=1，按子料 SUM(kcac06×temp) */
export function __buildPiDemandSqlForTest() {
  return `
    FROM ${PI_COST_FROM} AS c
    WHERE LTRIM(RTRIM(ISNULL(c.[sid], N''))) = @piNo
      AND ISNULL(c.[isok], 0) = 1
      AND ${nvarcharTextExpr('c', 'kcaa01', 300)} IN (@mc0)
  `
}

/** PI 已出/占用：kcap08=PI、kcaa01=子料、h.del=0，不按车间/派工/仓库/pass 过滤 */
export function __buildPiOutboundSqlForTest() {
  return `
    FROM ${STOCK_OUT_FROM} AS h
    INNER JOIN ${STOCK_OUT_LINE_FROM} AS l
      ON ${nvarcharTextExpr('l', 'kcaq01', 200)} = ${nvarcharTextExpr('h', 'kcap01', 200)}
    WHERE ${delActiveSql('h')}
      AND ${delActiveSql('l')}
      AND ${nvarcharTextExpr('h', 'kcap08', 200)} = @piNo
      AND ${nvarcharTextExpr('l', 'kcaa01', 300)} IN (@mc0)
  `
}

export async function fetchPiDemandByMaterial(pool, { piNo, materialCodes } = {}) {
  const pi = text(piNo)
  const mats = (materialCodes ?? []).map((k) => text(k)).filter(Boolean)
  if (!pi || !mats.length) return new Map()

  const req = pool.request().input('piNo', sql.NVarChar(200), pi)
  const inList = mats.map((k, i) => {
    const p = `mc${i}`
    req.input(p, sql.NVarChar(300), k)
    return `@${p}`
  }).join(', ')

  const r = await req.query(`
    SELECT
      ${nvarcharTextExpr('c', 'kcaa01', 300)} AS materialCode,
      ROUND(SUM(${safeDecimalExpr('c', 'kcac06')} * ${piCostTempExpr('c')}), 3) AS piDemandQty
    FROM ${PI_COST_FROM} AS c
    WHERE LTRIM(RTRIM(ISNULL(c.[sid], N''))) = @piNo
      AND ISNULL(c.[isok], 0) = 1
      AND ${nvarcharTextExpr('c', 'kcaa01', 300)} IN (${inList})
    GROUP BY c.[kcaa01]
  `)

  const map = new Map()
  for (const row of r.recordset ?? []) {
    map.set(text(row.materialCode), toNumber(row.piDemandQty))
  }
  return map
}

export async function fetchPiOutboundByMaterial(pool, { piNo, materialCodes, excludeOutboundNo } = {}) {
  const pi = text(piNo)
  const mats = (materialCodes ?? []).map((k) => text(k)).filter(Boolean)
  if (!pi || !mats.length) return new Map()

  const exclude = text(excludeOutboundNo)
  const excludeSql = exclude
    ? `AND ${nvarcharTextExpr('h', 'kcap01', 200)} <> @excludeOutboundNo`
    : ''

  const req = pool.request().input('piNo', sql.NVarChar(200), pi)
  if (exclude) req.input('excludeOutboundNo', sql.NVarChar(200), exclude)

  const inList = mats.map((k, i) => {
    const p = `mc${i}`
    req.input(p, sql.NVarChar(300), k)
    return `@${p}`
  }).join(', ')

  const r = await req.query(`
    SELECT
      ${nvarcharTextExpr('l', 'kcaa01', 300)} AS materialCode,
      SUM(${safeDecimalExpr('l', 'kcaq03')}) AS issuedQty
    FROM ${STOCK_OUT_FROM} AS h
    INNER JOIN ${STOCK_OUT_LINE_FROM} AS l
      ON ${nvarcharTextExpr('l', 'kcaq01', 200)} = ${nvarcharTextExpr('h', 'kcap01', 200)}
    WHERE ${delActiveSql('h')}
      AND ${delActiveSql('l')}
      AND ${nvarcharTextExpr('h', 'kcap08', 200)} = @piNo
      ${excludeSql}
      AND ${nvarcharTextExpr('l', 'kcaa01', 300)} IN (${inList})
    GROUP BY l.[kcaa01]
  `)

  const map = new Map()
  for (const row of r.recordset ?? []) {
    map.set(text(row.materialCode), toNumber(row.issuedQty))
  }
  return map
}

export async function fetchProductionSourceOutboundByChildMaterial(pool, {
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
    AND ${nvarcharTextExpr('h', 'kcap03', 20)} = N'4'
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

export async function fetchWarehouseStockByMaterial(pool, { warehouseCode, materialCodes, excludeOutboundNo }) {
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

function resolveMaterialSnapshot(row) {
  const snap = row.snapshot ?? {}
  const out = {
    kcaa01: text(row.childKcaa01),
    kcaa02: text(snap.kcaa02),
    kcaa03: text(snap.kcaa03),
    kcaa04: text(snap.kcaa04),
    kcaa11: text(snap.kcaa11),
    sale_price: snap.sale_price,
    cost_price: snap.cost_price,
    kpname: text(snap.kpname),
    kcaa02_en: text(snap.kcaa02_en),
    version: snap.version,
    location: text(snap.location),
    Describe: text(snap.Describe),
    Customer_Name: text(snap.Customer_Name),
    Customer_supply: text(snap.Customer_supply),
    systemcode: text(snap.systemcode || snap.GUID),
    GUID: text(snap.GUID || snap.systemcode),
  }
  for (const col of KCAA_COLS) {
    if (snap[col] != null && snap[col] !== '') out[col] = snap[col]
  }
  return out
}

function filterExpandedRows(rows, keyword) {
  const kw = text(keyword).toLowerCase()
  if (!kw) return rows
  return rows.filter((row) => text(row.childKcaa01).toLowerCase().includes(kw))
}

/** 生产领料：子料按最近已审采购订单明细取价，无采购价则归零 */
export function resolveProductionIssueLinePrice({ materialCode = '', purchasePriceMap } = {}) {
  const price = purchasePriceMap?.get(text(materialCode).toLowerCase())
  return {
    tax: round(price?.tax ?? 0, 4),
    kcaq04: round(price?.kcaq04 ?? 0, 4),
    kcaq041: round(price?.kcaq041 ?? 0, 4),
  }
}

/** 生产领料备注：派工物料 pq → Bom_000.kcaa02；未命中时兜底派工明细名称 */
export function resolveProductionIssueDispatchDescribe(dispatchKcaa01, fallbackName = '', dispatchProductNameMap) {
  const code = text(dispatchKcaa01).toLowerCase()
  const fromBom = code ? text(dispatchProductNameMap?.get(code)) : ''
  return fromBom || text(fallbackName)
}

/** 同子料多派工货品名称去重后用 / 拼接 */
export function joinProductionIssueDispatchProductNames(names = []) {
  const list = [...new Set((names ?? []).map((v) => text(v)).filter(Boolean))]
  return list.join(' / ')
}

function mapProductionIssueLineRow(row, ctx) {
  const materialCode = text(row.childKcaa01)
  const scak02 = text(row.scak02 || row.sourceLineCode)
  const mat = resolveMaterialSnapshot(row)

  const stock = ctx.stockMap.get(materialCode) ?? {}
  const sourceOutbound = ctx.sourceOutboundMap.get(materialCode) ?? { approvedQty: 0, pendingQty: 0 }
  const warehouseBookQty = round(stock.bookQty ?? 0, PRODUCTION_ISSUE_QTY_PRECISION)
  const warehousePendingOutQty = round(stock.pendingOutQty ?? 0, PRODUCTION_ISSUE_QTY_PRECISION)
  const warehouseActualQty = round(stock.actualQty ?? 0, PRODUCTION_ISSUE_QTY_PRECISION)

  const sourceDemandQty = round(row.dispatchDemandQty, PRODUCTION_ISSUE_QTY_PRECISION)
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
  const kcaq05 = round(issueableQty * kcaq04, 2)
  const kcaq051 = round(issueableQty * kcaq041, 2)

  const dispatchKcaa01 = text(row.dispatchKcaa01)
  const dispatchProductName = resolveProductionIssueDispatchDescribe(
    dispatchKcaa01,
    row.dispatchKcaa02,
    ctx.dispatchProductNameMap,
  )

  return {
    mergeKey: text(row.mergeKey),
    sourceLineCode: scak02,
    kcaq02: scak02,
    scak02,
    dispatchKcaa01,
    dispatchKcaa02: dispatchProductName,
    dispatchQty: round(row.scak03, PRODUCTION_ISSUE_QTY_PRECISION),
    dispatchDemandQty: sourceDemandQty,
    sourceDemandQty,
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
    kcaq05,
    kcaq051,
    tax,
    reference: text(ctx.piNo),
    Describe: dispatchProductName,
    info: dispatchProductName,
    expandSource: text(row.expandSource),
    unitUsageSum: row.unitUsageSum,
    pendingOutboundText: formatPendingText(ctx.sourcePendingDocMap.get(materialCode)),
    materialSnapshot: mat,
  }
}

/** 批量窗口按子料 kcaa01 合并：同编码只显示一行，需出库累加、已出/未审只扣一次。 */
export function __aggregateProductionIssueRowsByMaterialForTest(rows, selectedSet = new Set(), ctx = {}) {
  const groups = new Map()
  for (const row of Array.isArray(rows) ? rows : []) {
    const materialCode = text(row.kcaa01)
    const key = materialCode.toLowerCase()
    if (!key) continue
    const existing = groups.get(key)
    if (!existing) {
      groups.set(key, {
        ...row,
        __dispatchCodes: [text(row.dispatchKcaa01)],
        __dispatchProductNames: [text(row.Describe) || text(row.dispatchKcaa02)],
        __scak02List: [text(row.scak02 || row.sourceLineCode)],
        __alreadySelected: row.selectState === 'picked' || row.selectLabel === '已选择',
      })
      continue
    }
    existing.sourceDemandQty = round(
      toNumber(existing.sourceDemandQty) + toNumber(row.sourceDemandQty ?? row.dispatchDemandQty),
      PRODUCTION_ISSUE_QTY_PRECISION,
    )
    existing.dispatchDemandQty = existing.sourceDemandQty
    existing.__dispatchCodes.push(text(row.dispatchKcaa01))
    existing.__dispatchProductNames.push(text(row.Describe) || text(row.dispatchKcaa02))
    existing.__scak02List.push(text(row.scak02 || row.sourceLineCode))
    if (row.selectState === 'picked' || row.selectLabel === '已选择') existing.__alreadySelected = true
  }

  const merged = []
  for (const item of groups.values()) {
    const materialCode = text(item.kcaa01)
    const materialLineKey = `material|${materialCode.toLowerCase()}`
    const materialDedupKey = buildProductionIssueMaterialDedupKey(materialCode)
    const sourceLineCode = text(item.__scak02List.find(Boolean))
    const mat = item.materialSnapshot ?? {}

    const sourceOutbound = ctx.sourceOutboundMap?.get(materialCode) ?? {
      approvedQty: item.sourceApprovedOutQty,
      pendingQty: item.sourcePendingOutQty,
    }
    const sourceApprovedOutQty = round(sourceOutbound.approvedQty, PRODUCTION_ISSUE_QTY_PRECISION)
    const sourcePendingOutQty = round(sourceOutbound.pendingQty, PRODUCTION_ISSUE_QTY_PRECISION)
    const sourceDemandQty = round(item.sourceDemandQty, PRODUCTION_ISSUE_QTY_PRECISION)
    const piDemandQty = toNumber(ctx.piDemandMap?.get(materialCode))
    const piIssuedQty = toNumber(ctx.piIssuedMap?.get(materialCode))
    const warehouseActualQty = round(item.warehouseActualQty, PRODUCTION_ISSUE_QTY_PRECISION)
    const qtyCaps = resolveProductionIssueDualQtyCaps({
      sourceDemandQty,
      dispatchApprovedOutQty: sourceApprovedOutQty,
      dispatchPendingOutQty: sourcePendingOutQty,
      piDemandQty,
      piIssuedQty,
      warehouseActualQty,
    })
    const { stillNeedQty, issueableQty, piRemainingQty, dispatchStillNeedQty } = qtyCaps
    const alreadySelected = item.__alreadySelected
      || selectedSet.has(materialLineKey)
      || (materialDedupKey && selectedSet.has(materialDedupKey))
    const select = resolveProductionIssueSelectState({
      issueableQty,
      stillNeedQty,
      warehouseActualQty,
      alreadySelected,
    })

    const dispatchSummary = joinDistinctText(item.__dispatchCodes)
    const dispatchProductName = joinProductionIssueDispatchProductNames(item.__dispatchProductNames)

    const kcaq04 = toNumber(item.kcaq04)
    const kcaq041 = toNumber(item.kcaq041)
    const next = {
      ...item,
      lineKey: materialLineKey,
      sourceLineCode,
      kcaq02: sourceLineCode,
      scak02: sourceLineCode,
      dispatchKcaa01: dispatchSummary,
      dispatchKcaa02: dispatchProductName,
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
      kcaq03: issueableQty,
      kcaq031: warehouseActualQty,
      kcaq05: round(issueableQty * kcaq04, 2),
      kcaq051: round(issueableQty * kcaq041, 2),
      pendingOutboundText: formatPendingText(ctx.sourcePendingDocMap?.get(materialCode)),
      Describe: dispatchProductName,
      info: dispatchProductName,
      ...select,
    }
    for (const col of KCAA_COLS) {
      if (mat[col] != null && next[col] == null) next[col] = mat[col]
    }
    if (mat.systemcode) next.systemcode = mat.systemcode
    if (mat.GUID) next.GUID = mat.GUID
    if (mat.location) next.location = mat.location
    delete next.__dispatchCodes
    delete next.__dispatchProductNames
    delete next.__scak02List
    delete next.__alreadySelected
    delete next.materialSnapshot
    merged.push(next)
  }
  return merged
}

/**
 * @param {import('mssql').ConnectionPool} pool
 * @param {Record<string, string>} query
 */
export async function fetchStockOutProductionIssueBatchLines(pool, query = {}) {
  const sourceOrderNo = text(query.sourceOrderNo)
  const workshopCode = text(query.workshopCode)
  const warehouseCode = text(query.warehouseCode)
  const piNo = text(query.piNo)
  const dispatchSystemcode = text(query.dispatchSystemcode)

  if (!sourceOrderNo) return { ok: false, status: 400, msg: '请先选择关联派工单号' }
  if (!workshopCode) return { ok: false, status: 400, msg: '请先选择生产车间!' }
  if (!warehouseCode) return { ok: false, status: 400, msg: '请先选择仓库' }
  if (!piNo) return { ok: false, status: 400, msg: '请先带出 PI 号' }

  // 开料部（04）走独立 pi_cost 裁片逻辑，避免与派工展开循环依赖
  if (text(workshopCode) === '04') {
    const { fetchCuttingIssueBatchLines } = await import('./stockOutCuttingIssueBatchAdd.js')
    return fetchCuttingIssueBatchLines(pool, query)
  }

  const keyword = text(query.keyword)
  const excludeOutboundNo = text(query.excludeOutboundNo)
  const paging = parseProductionIssueBatchPaging(query)
  const { page, pageSize } = paging
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

  const listReq = pool.request()
    .input('sourceOrderNo', sql.NVarChar(200), sourceOrderNo)
    .input('workshopCode', sql.NVarChar(200), workshopCode)
  const listR = await listReq.query(__buildProductionDispatchBatchListSqlForTest())
  const dispatchLines = listR.recordset ?? []
  if (!dispatchLines.length) {
    return {
      ok: true,
      list: [],
      total: 0,
      page,
      pageSize,
      sourceOrderNo,
      workshopCode,
      warehouseCode,
      piNo,
    }
  }

  const expandedRaw = await batchExpandProductionDispatchLines(pool, dispatchLines, piNo)
  const dispatchMaterialCodes = [...new Set(expandedRaw.map((row) => text(row.dispatchKcaa01)).filter(Boolean))]
  const dispatchProductNameMap = await fetchBom000Kcaa02ByMaterialBatch(pool, dispatchMaterialCodes)
  const filtered = filterExpandedRows(expandedRaw, keyword)
  if (!filtered.length) {
    return {
      ok: true,
      list: [],
      total: 0,
      page,
      pageSize,
      sourceOrderNo,
      workshopCode,
      warehouseCode,
      piNo,
      piCostHint: '当前派工单未匹配到 PI 成本用量材料，请确认 PI 已完成一键运算',
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
    dispatchProductNameMap,
    selectedSet,
  }
  const mappedRows = filtered.map((row) => mapProductionIssueLineRow(row, ctx))
  const mergedRows = __aggregateProductionIssueRowsByMaterialForTest(mappedRows, selectedSet, ctx)
  const sliced = sliceProductionIssueBatchList(mergedRows, paging)

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
  }
}
