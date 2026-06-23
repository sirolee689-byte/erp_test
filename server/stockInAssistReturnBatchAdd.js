/**
 * 外协退料批量添加：父层外协成品 + 子层 BOM 配件展开（最多四层，同编码合并）。
 * bom_rate 仅取自 UB_ERP_Finance_currency.bom_rate，禁止用 rate 代替；空值默认 1。
 */
import { sql } from './db.js'
import { safeDecimalExpr, safeIntExpr, nvarcharTextExpr } from './buyOrderSqlSafe.js'
import { INV_BOM_MASTER_FROM, INV_BOM_PARTS_FROM } from './bomTables.js'
import {
  buildBomPartsUsageTreeNodesFromLayerCache,
  prefetchBomPartsLayersForUsageTree,
} from './bomUsageTreeBuild.js'
import {
  computeAssistKsum,
  computeAssistPrice,
  computeAssistTempx,
} from './stockInAssistBatchAdd.js'
import { customerSupplyLabel } from './stockInSaveLogic.js'

const ASSIST_HEADER_FROM = 'dbo.[UB_ERP_assist_order]'
const ASSIST_LINE_FROM = 'dbo.[UB_ERP_assist_order_list]'
const STOCK_IN_FROM = 'dbo.[UB_ERP_Stocks_Storage]'
const STOCK_IN_LINE_FROM = 'dbo.[UB_ERP_Stocks_Storage_list]'
const STOCK_OUT_FROM = 'dbo.[UB_ERP_Stocks_out]'
const STOCK_OUT_LINE_FROM = 'dbo.[UB_ERP_Stocks_out_list]'
const CURRENCY_FROM = 'dbo.[UB_ERP_Finance_currency]'

const KCAA_COLS = Array.from({ length: 35 }, (_, i) => `kcaa${String(i + 1).padStart(2, '0')}`)
const BOM_RETURN_FIXED_TAX = 0.08
const ASSIST_RETURN_KCAO031_CAP = 100000
const MAX_BOM_DEPTH = 4

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

/** 外协退料已选键：BOM 配件 systemcode + 成品 kcaa01（pm，仅前端去重） */
export function buildAssistReturnLineKey(systemcode, pm) {
  const sc = text(systemcode).toLowerCase()
  const product = text(pm).toLowerCase()
  if (!sc) return ''
  return `${sc}|${product}`
}

/** bom_rate 独立字段；空/无效 → 1，绝不回退 rate */
export function resolveBomRate(raw) {
  const n = toNumber(raw)
  return n > 0 ? round(n, 6) : 1
}

export function computeBomPartUnitPrice(salePrice, bomRate) {
  const sp = toNumber(salePrice)
  const br = resolveBomRate(bomRate)
  return round(sp / br, 4)
}

export function computeBomFixedTaxPrice(unitPrice) {
  const p = toNumber(unitPrice)
  return round(p * (1 + BOM_RETURN_FIXED_TAX), 4)
}

export function computePartLossRate(kcac05, kcaa33) {
  const k5 = toNumber(kcac05)
  if (k5 > 0) return k5 > 1 ? k5 / 100 : k5
  const k33 = toNumber(kcaa33)
  if (k33 > 0) return k33 > 1 ? k33 / 100 : k33
  return 0
}

export function computePartUsageTotal(kcac04, lossRate) {
  const usage = toNumber(kcac04)
  const lr = toNumber(lossRate)
  return round(usage * (1 + lr), 6)
}

/** BOM 配件备注：物理表无 info 列，用 Describe / d_info / remark 拼接 */
export function buildBomPartInfoText(partRow = {}) {
  return [text(partRow?.Describe), text(partRow?.d_info), text(partRow?.remark)].filter(Boolean).join(' / ')
}

/**
 * 旧系统口径：四层展开，第四层用量并入第三层物料编码，同 kcaa01 合并累加。
 * @param {any[]} nodes
 * @param {number} depth
 * @param {number} parentFactor
 * @param {Map<string, { kcaa01: string, totalUsage: number, sourceNode: any }>} acc
 */
export function flattenAssistReturnBomTree(nodes, depth = 1, parentFactor = 1, acc = new Map()) {
  const list = Array.isArray(nodes) ? nodes : []
  for (const node of list) {
    const lossRate = computePartLossRate(node?.kcac05, node?.kcaa33)
    const usage = computePartUsageTotal(node?.kcac04, lossRate)
    const factor = round(toNumber(parentFactor) * usage, 6)
    const children = Array.isArray(node?.children) ? node.children : []
    const materialCode = text(node?.kcaa01)

    if (!children.length) {
      if (!materialCode) continue
      const key = materialCode.toLowerCase()
      const prev = acc.get(key) ?? { kcaa01: materialCode, totalUsage: 0, sourceNode: node }
      prev.totalUsage = round(prev.totalUsage + factor, 6)
      prev.sourceNode = node
      acc.set(key, prev)
      continue
    }

    if (depth >= 3) {
      if (!materialCode) continue
      const key = materialCode.toLowerCase()
      for (const child of children) {
        const cl = computePartLossRate(child?.kcac05, child?.kcaa33)
        const cu = computePartUsageTotal(child?.kcac04, cl)
        const qty = round(factor * cu, 6)
        const prev = acc.get(key) ?? { kcaa01: materialCode, totalUsage: 0, sourceNode: node }
        prev.totalUsage = round(prev.totalUsage + qty, 6)
        prev.sourceNode = node
        acc.set(key, prev)
      }
      continue
    }

    if (depth >= MAX_BOM_DEPTH) continue
    flattenAssistReturnBomTree(children, depth + 1, factor, acc)
  }
  return acc
}

function parsePage(query = {}) {
  const page = Math.max(1, Number.parseInt(query.page, 10) || 1)
  const rawPageSize = Number.parseInt(query.pageSize, 10) || 20
  const pageSize = Math.min(100, Math.max(1, rawPageSize))
  return { page, pageSize, startRow: (page - 1) * pageSize + 1, endRow: page * pageSize }
}

function buildKeywordWhere(keyword) {
  const kw = text(keyword)
  if (!kw) return ''
  const likeCols = ['kcaa01', 'kcaa02', 'kcaa03', 'kcaa11', 'Reference', 'Describe', 'info', 'wxak02', 'systemcode']
  const parts = likeCols.map((col) => `${nvarcharTextExpr('l', col)} LIKE @keyword`)
  return `AND (${parts.join(' OR ')})`
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

function unitConvertText(kcaa04, kcaa25, kcaa26, kcaa27, wxak03) {
  const useUnit = text(kcaa04)
  const buyUnit = text(kcaa25)
  if (!buyUnit || buyUnit === useUnit) return '否'
  const dir = text(kcaa27) === '1' ? '使用->采购' : '采购->使用'
  return `${buyUnit} / ${dir} / ${text(kcaa26) || '1'} / ${text(wxak03)}`
}

async function fetchInboundAggByDetailKey(pool, { sourceOrderNo, detailKeys, excludeReceiptNo }) {
  const keys = (detailKeys ?? []).map((k) => text(k)).filter(Boolean)
  if (!keys.length) return new Map()
  const exclude = text(excludeReceiptNo)
  const excludeSql = exclude ? `AND ${nvarcharTextExpr('h', 'kcan01', 200)} <> @excludeReceiptNo` : ''
  const req = pool.request()
    .input('sourceOrderNo', sql.NVarChar(200), sourceOrderNo)
    .input('inboundType', sql.NVarChar(20), '3')
  if (exclude) req.input('excludeReceiptNo', sql.NVarChar(200), exclude)
  const inList = keys.map((k, i) => {
    const p = `dk${i}`
    req.input(p, sql.NVarChar(200), k)
    return `@${p}`
  }).join(', ')
  const r = await req.query(`
    SELECT
      ${nvarcharTextExpr('l', 'kcao02', 200)} AS detailKey,
      SUM(CASE WHEN ${nvarcharTextExpr('h', 'pass', 20)} = N'1' THEN ${safeDecimalExpr('l', 'kcao03')} ELSE 0 END) AS approvedQty,
      SUM(CASE WHEN ${nvarcharTextExpr('h', 'pass', 20)} <> N'1' THEN ${safeDecimalExpr('l', 'kcao03')} ELSE 0 END) AS pendingQty
    FROM ${STOCK_IN_FROM} AS h
    INNER JOIN ${STOCK_IN_LINE_FROM} AS l
      ON ${nvarcharTextExpr('l', 'kcao01', 200)} = ${nvarcharTextExpr('h', 'kcan01', 200)}
    WHERE ${nvarcharTextExpr('h', 'del', 20)} IN (N'', N'0')
      AND ${nvarcharTextExpr('l', 'del', 20)} IN (N'', N'0')
      AND ${nvarcharTextExpr('h', 'kcan03', 20)} = @inboundType
      AND ${nvarcharTextExpr('h', 'kcan04', 200)} = @sourceOrderNo
      ${excludeSql}
      AND ${nvarcharTextExpr('l', 'kcao02', 200)} IN (${inList})
    GROUP BY l.[kcao02]
  `)
  const map = new Map()
  for (const row of r.recordset ?? []) {
    map.set(text(row.detailKey), { approvedQty: toNumber(row.approvedQty), pendingQty: toNumber(row.pendingQty) })
  }
  return map
}

async function fetchInboundPendingDocs(pool, { sourceOrderNo, detailKeys, excludeReceiptNo }) {
  const keys = (detailKeys ?? []).map((k) => text(k)).filter(Boolean)
  if (!keys.length) return new Map()
  const exclude = text(excludeReceiptNo)
  const excludeSql = exclude ? `AND ${nvarcharTextExpr('h', 'kcan01', 200)} <> @excludeReceiptNo` : ''
  const req = pool.request()
    .input('sourceOrderNo', sql.NVarChar(200), sourceOrderNo)
    .input('inboundType', sql.NVarChar(20), '3')
  if (exclude) req.input('excludeReceiptNo', sql.NVarChar(200), exclude)
  const inList = keys.map((k, i) => {
    const p = `dk${i}`
    req.input(p, sql.NVarChar(200), k)
    return `@${p}`
  }).join(', ')
  const r = await req.query(`
    SELECT
      ${nvarcharTextExpr('l', 'kcao02', 200)} AS detailKey,
      ${nvarcharTextExpr('h', 'kcan01', 200)} AS docNo,
      ${safeDecimalExpr('l', 'kcao03')} AS qty
    FROM ${STOCK_IN_FROM} AS h
    INNER JOIN ${STOCK_IN_LINE_FROM} AS l
      ON ${nvarcharTextExpr('l', 'kcao01', 200)} = ${nvarcharTextExpr('h', 'kcan01', 200)}
    WHERE ${nvarcharTextExpr('h', 'del', 20)} IN (N'', N'0')
      AND ${nvarcharTextExpr('l', 'del', 20)} IN (N'', N'0')
      AND ${nvarcharTextExpr('h', 'kcan03', 20)} = @inboundType
      AND ${nvarcharTextExpr('h', 'pass', 20)} <> N'1'
      AND ${nvarcharTextExpr('h', 'kcan04', 200)} = @sourceOrderNo
      ${excludeSql}
      AND ${nvarcharTextExpr('l', 'kcao02', 200)} IN (${inList})
  `)
  const map = new Map()
  for (const row of r.recordset ?? []) {
    const key = text(row.detailKey)
    if (!map.has(key)) map.set(key, [])
    map.get(key).push({ docNo: text(row.docNo), qty: toNumber(row.qty) })
  }
  return map
}

async function getStockOutMeta(pool) {
  const r = await pool.request().query(`
    SELECT
      CASE
        WHEN COL_LENGTH('dbo.UB_ERP_Stocks_out', 'kcap04') IS NOT NULL THEN N'kcap04'
        WHEN COL_LENGTH('dbo.UB_ERP_Stocks_out', 'kcan04') IS NOT NULL THEN N'kcan04'
        WHEN COL_LENGTH('dbo.UB_ERP_Stocks_out', 'sourceOrderNo') IS NOT NULL THEN N'sourceOrderNo'
        ELSE N''
      END AS linkCol,
      CASE
        WHEN COL_LENGTH('dbo.UB_ERP_Stocks_out_list', 'kcaq03') IS NOT NULL THEN N'kcaq03'
        WHEN COL_LENGTH('dbo.UB_ERP_Stocks_out_list', 'kcao03') IS NOT NULL THEN N'kcao03'
        ELSE N'kcaq03'
      END AS qtyCol,
      CASE
        WHEN COL_LENGTH('dbo.UB_ERP_Stocks_out_list', 'kcaq01') IS NOT NULL THEN N'kcaq01'
        WHEN COL_LENGTH('dbo.UB_ERP_Stocks_out_list', 'kcao01') IS NOT NULL THEN N'kcao01'
        ELSE N'kcaq01'
      END AS lineDocCol
  `)
  return {
    linkCol: text(r.recordset?.[0]?.linkCol),
    qtyCol: text(r.recordset?.[0]?.qtyCol) || 'kcaq03',
    lineDocCol: text(r.recordset?.[0]?.lineDocCol) || 'kcaq01',
  }
}

async function fetchOutboundAggByMaterial(pool, { sourceOrderNo, materialCodes, linkCol, qtyCol, lineDocCol }) {
  const mats = (materialCodes ?? []).map((k) => text(k)).filter(Boolean)
  if (!mats.length || !linkCol || !qtyCol || !lineDocCol) return { aggMap: new Map(), pendingMap: new Map() }
  const req = pool.request().input('sourceOrderNo', sql.NVarChar(200), sourceOrderNo)
  const inList = mats.map((k, i) => {
    const p = `mc${i}`
    req.input(p, sql.NVarChar(200), k)
    return `@${p}`
  }).join(', ')
  const r = await req.query(`
    SELECT
      ${nvarcharTextExpr('ol', 'kcaa01', 300)} AS materialCode,
      ${nvarcharTextExpr('o', 'kcap01', 200)} AS docNo,
      ${nvarcharTextExpr('o', 'pass', 20)} AS pass,
      ${safeDecimalExpr('ol', qtyCol)} AS qty
    FROM ${STOCK_OUT_FROM} AS o
    INNER JOIN ${STOCK_OUT_LINE_FROM} AS ol
      ON ${nvarcharTextExpr('ol', lineDocCol, 200)} = ${nvarcharTextExpr('o', 'kcap01', 200)}
    WHERE ${nvarcharTextExpr('o', 'del', 20)} IN (N'', N'0')
      AND ${nvarcharTextExpr('ol', 'del', 20)} IN (N'', N'0')
      AND ${nvarcharTextExpr('o', linkCol, 200)} = @sourceOrderNo
      AND ${nvarcharTextExpr('ol', 'kcaa01', 300)} IN (${inList})
  `)
  const aggMap = new Map()
  const pendingMap = new Map()
  for (const row of r.recordset ?? []) {
    const key = text(row.materialCode)
    if (!aggMap.has(key)) aggMap.set(key, { approvedQty: 0, pendingQty: 0 })
    const item = aggMap.get(key)
    if (text(row.pass) === '1') item.approvedQty += toNumber(row.qty)
    else {
      item.pendingQty += toNumber(row.qty)
      if (!pendingMap.has(key)) pendingMap.set(key, [])
      pendingMap.get(key).push({ docNo: text(row.docNo), qty: toNumber(row.qty) })
    }
  }
  return { aggMap, pendingMap }
}

function mapParentRow(row, ctx) {
  const detailKey = text(row.wxak02 || row.systemcode || row.GUID)
  const productCode = text(row.kcaa01)
  const inbound = ctx.inboundMap.get(detailKey) ?? { approvedQty: 0, pendingQty: 0 }
  const outbound = ctx.outboundMap.get(productCode) ?? { approvedQty: 0, pendingQty: 0 }
  const orderQty = computeAssistKsum(row.wxak03, row.kcaa26, row.kcaa27)
  const tempx = computeAssistTempx(orderQty, inbound.approvedQty, inbound.pendingQty)
  const rate = toNumber(ctx.exchangeRate) || 1
  const info = [text(row.Describe), text(row.info)].filter(Boolean).join(' / ')
  const unitPrice = computeAssistPrice(row.wxak04, row.kcaa26, row.kcaa27, rate)
  const unitPriceTax = computeAssistPrice(row.wxak041, row.kcaa26, row.kcaa27, rate)
  const amount = round(orderQty * unitPrice, 2)
  const amountTax = round(orderQty * unitPriceTax, 2)

  return {
    lineKey: detailKey,
    productKcaa01: productCode,
    pm: productCode,
    wxak02: detailKey,
    kcaa01: productCode,
    kcaa02: text(row.kcaa02),
    kcaa03: text(row.kcaa03),
    kcaa04: text(row.kcaa04),
    kcaa11: text(row.kcaa11),
    currencyDisplay: `${text(ctx.currencyName) || text(ctx.currencyCode) || '-'} / ${rate}`,
    tempx,
    kcao04: unitPrice,
    kcao041: unitPriceTax,
    kcao05: amount,
    kcao051: amountTax,
    tax: toNumber(row.tax),
    reference: text(row.reference),
    info,
    orderQty,
    orderQtyRaw: toNumber(row.wxak03),
    pendingInboundText: formatPendingText(ctx.pendingInboundMap.get(detailKey)),
    pendingOutboundText: formatPendingText(ctx.pendingOutboundMap.get(productCode)),
    actualInboundQty: round(inbound.approvedQty, 4),
    actualOutboundQty: round(outbound.approvedQty, 4),
    unitConvertText: unitConvertText(row.kcaa04, row.kcaa25, row.kcaa26, row.kcaa27, row.wxak03),
    selectable: false,
    selectState: 'expand_only',
    selectLabel: '请展开选择',
  }
}

export async function fetchStockInAssistReturnBatchLines(pool, query = {}) {
  const sourceOrderNo = text(query.sourceOrderNo)
  if (!sourceOrderNo) return { ok: false, status: 400, msg: '请先选择外协单号' }
  const supplierCode = text(query.supplierCode)
  const excludeReceiptNo = text(query.excludeReceiptNo)
  const keyword = text(query.keyword)
  const { page, pageSize, startRow, endRow } = parsePage(query)

  const sourceWhere = `(
    ${nvarcharTextExpr('h', 'wxaj01', 200)} = @sourceOrderNo
    OR ${nvarcharTextExpr('h', 'GUID', 200)} = @sourceOrderNo
  )`
  const headerWhere = `
    ${sourceWhere}
    AND ${nvarcharTextExpr('h', 'del', 20)} IN (N'', N'0')
    AND ${nvarcharTextExpr('h', 'pass', 20)} = N'1'
    AND ${nvarcharTextExpr('h', 'Closed', 20)} IN (N'', N'0')
    ${supplierCode ? `AND ${nvarcharTextExpr('h', 'wxaj05', 200)} = @supplierCode` : ''}
  `

  const countReq = pool.request().input('sourceOrderNo', sql.NVarChar(200), sourceOrderNo)
  if (keyword) countReq.input('keyword', sql.NVarChar(200), `%${keyword}%`)
  if (supplierCode) countReq.input('supplierCode', sql.NVarChar(200), supplierCode)
  const countR = await countReq.query(`
    SELECT COUNT(1) AS total
    FROM (
      SELECT ${nvarcharTextExpr('l', 'kcaa01', 300)} AS materialCode,
             ${nvarcharTextExpr('l', 'wxak02', 200)} AS detailKey
      FROM ${ASSIST_LINE_FROM} AS l
      INNER JOIN ${ASSIST_HEADER_FROM} AS h
        ON ${nvarcharTextExpr('h', 'wxaj01', 200)} = ${nvarcharTextExpr('l', 'wxak01', 200)}
      WHERE ${headerWhere}
        AND ${nvarcharTextExpr('l', 'del', 20)} IN (N'', N'0')
        ${buildKeywordWhere(keyword)}
      GROUP BY ${nvarcharTextExpr('l', 'kcaa01', 300)}, ${nvarcharTextExpr('l', 'wxak02', 200)}
    ) AS g
  `)
  const total = Number(countR.recordset?.[0]?.total ?? 0)

  const kcaaSelect = KCAA_COLS.map((col) => `MAX(l.[${col}]) AS [${col}]`).join(', ')
  const listReq = pool.request()
    .input('sourceOrderNo', sql.NVarChar(200), sourceOrderNo)
    .input('startRow', sql.Int, startRow)
    .input('endRow', sql.Int, endRow)
  if (keyword) listReq.input('keyword', sql.NVarChar(200), `%${keyword}%`)
  if (supplierCode) listReq.input('supplierCode', sql.NVarChar(200), supplierCode)

  const listR = await listReq.query(`
    WITH grouped AS (
      SELECT
        MIN(l.[id]) AS id,
        ${nvarcharTextExpr('l', 'kcaa01', 300)} AS groupMaterialCode,
        ${nvarcharTextExpr('l', 'wxak02', 200)} AS groupDetailKey,
        MAX(l.[wxak02]) AS wxak02,
        MAX(l.[systemcode]) AS systemcode,
        MAX(l.[GUID]) AS GUID,
        SUM(${safeDecimalExpr('l', 'wxak03')}) AS wxak03,
        MAX(${safeDecimalExpr('l', 'wxak04')}) AS wxak04,
        MAX(${safeDecimalExpr('l', 'wxak041')}) AS wxak041,
        MAX(${safeDecimalExpr('l', 'Tax')}) AS tax,
        MAX(l.[Reference]) AS reference,
        MAX(l.[Describe]) AS [Describe],
        MAX(l.[info]) AS info,
        ${kcaaSelect},
        MAX(${nvarcharTextExpr('h', 'rmb', 200)}) AS currencyName,
        MAX(${nvarcharTextExpr('h', 'wxaj07', 200)}) AS currencyCode,
        MAX(ISNULL(NULLIF(${nvarcharTextExpr('h', 'rmb_hl', 50)}, N''), N'1')) AS headerRate,
        MAX(ISNULL(NULLIF(${nvarcharTextExpr('c', 'rate', 50)}, N''), N'1')) AS currencyRate,
        MIN(${safeIntExpr('l', 'seq')}) AS sortSeq
      FROM ${ASSIST_LINE_FROM} AS l
      INNER JOIN ${ASSIST_HEADER_FROM} AS h
        ON ${nvarcharTextExpr('h', 'wxaj01', 200)} = ${nvarcharTextExpr('l', 'wxak01', 200)}
      LEFT JOIN ${CURRENCY_FROM} AS c
        ON ${nvarcharTextExpr('c', 'code', 100)} = ${nvarcharTextExpr('h', 'wxaj07', 100)}
      WHERE ${headerWhere}
        AND ${nvarcharTextExpr('l', 'del', 20)} IN (N'', N'0')
        ${buildKeywordWhere(keyword)}
      GROUP BY ${nvarcharTextExpr('l', 'kcaa01', 300)}, ${nvarcharTextExpr('l', 'wxak02', 200)}
    ),
    numbered AS (
      SELECT grouped.*, ROW_NUMBER() OVER (ORDER BY sortSeq, id) AS rn
      FROM grouped
    )
    SELECT * FROM numbered WHERE rn BETWEEN @startRow AND @endRow ORDER BY rn
  `)

  const rawRows = listR.recordset ?? []
  if (!rawRows.length) return { ok: true, list: [], total, page, pageSize }

  const detailKeys = [...new Set(rawRows.map((row) => text(row.wxak02 || row.systemcode || row.GUID)).filter(Boolean))]
  const materialCodes = [...new Set(rawRows.map((row) => text(row.kcaa01)).filter(Boolean))]
  const outMeta = await getStockOutMeta(pool)
  const [inboundMap, pendingInboundMap, outboundResult] = await Promise.all([
    fetchInboundAggByDetailKey(pool, { sourceOrderNo, detailKeys, excludeReceiptNo }),
    fetchInboundPendingDocs(pool, { sourceOrderNo, detailKeys, excludeReceiptNo }),
    fetchOutboundAggByMaterial(pool, {
      sourceOrderNo,
      materialCodes,
      linkCol: outMeta.linkCol,
      qtyCol: outMeta.qtyCol,
      lineDocCol: outMeta.lineDocCol,
    }),
  ])

  const headerRate = toNumber(rawRows[0]?.headerRate) || toNumber(rawRows[0]?.currencyRate) || 1
  const ctx = {
    inboundMap,
    pendingInboundMap,
    outboundMap: outboundResult.aggMap,
    pendingOutboundMap: outboundResult.pendingMap,
    exchangeRate: headerRate,
    currencyName: text(rawRows[0]?.currencyName),
    currencyCode: text(rawRows[0]?.currencyCode),
  }
  return { ok: true, list: rawRows.map((row) => mapParentRow(row, ctx)), total, page, pageSize }
}

async function fetchBomHeadByKcaa01(pool, productKcaa01) {
  const code = text(productKcaa01)
  if (!code) return null
  const r = await pool.request().input('kcaa01', sql.NVarChar(200), code).query(`
    SELECT TOP 1
      ${nvarcharTextExpr('b', 'kcaa01', 200)} AS kcaa01,
      ${nvarcharTextExpr('b', 'systemcode', 200)} AS systemcode,
      ${nvarcharTextExpr('b', 'GUID', 200)} AS bomGuid
    FROM ${INV_BOM_MASTER_FROM} AS b
    WHERE ${nvarcharTextExpr('b', 'kcaa01', 200)} = @kcaa01
      AND ${nvarcharTextExpr('b', 'del', 20)} IN (N'', N'0')
    ORDER BY b.[id] DESC
  `)
  return r.recordset?.[0] ?? null
}

async function fetchBomPartsDetailByKcaa01(pool, materialCodes) {
  const codes = (materialCodes ?? []).map((k) => text(k)).filter(Boolean)
  if (!codes.length) return new Map()
  const req = pool.request()
  const inList = codes.map((k, i) => {
    const p = `mc${i}`
    req.input(p, sql.NVarChar(200), k)
    return `@${p}`
  }).join(', ')
  const r = await req.query(`
    SELECT
      ${nvarcharTextExpr('p', 'kcaa01', 300)} AS kcaa01,
      ${nvarcharTextExpr('p', 'kcaa02', 500)} AS kcaa02,
      ${nvarcharTextExpr('p', 'kcaa02_en', 500)} AS kcaa02_en,
      ${nvarcharTextExpr('p', 'kcaa03', 500)} AS kcaa03,
      ${nvarcharTextExpr('p', 'kcaa04', 100)} AS kcaa04,
      ${nvarcharTextExpr('p', 'kcaa29', 100)} AS kcaa29,
      ${safeDecimalExpr('p', 'kcac04')} AS kcac04,
      ${safeDecimalExpr('p', 'kcac05')} AS kcac05,
      ${safeDecimalExpr('p', 'kcac06')} AS kcac06,
      ${safeDecimalExpr('p', 'sale_price')} AS sale_price,
      ${nvarcharTextExpr('p', 'remark', 500)} AS remark,
      ${nvarcharTextExpr('p', 'Describe', 500)} AS [Describe],
      ${nvarcharTextExpr('p', 'd_info', 500)} AS d_info,
      ${nvarcharTextExpr('p', 'd_code', 200)} AS d_code,
      ${nvarcharTextExpr('p', 'systemcode', 200)} AS systemcode,
      ${nvarcharTextExpr('p', 'GUID', 200)} AS partGuid,
      ${nvarcharTextExpr('p', 'Customer_supply', 50)} AS Customer_supply,
      ${nvarcharTextExpr('p', 'kcaa23', 100)} AS kcaa23
    FROM ${INV_BOM_PARTS_FROM} AS p
    WHERE ${nvarcharTextExpr('p', 'del', 20)} IN (N'', N'0')
      AND ${nvarcharTextExpr('p', 'kcaa01', 300)} IN (${inList})
  `)
  const map = new Map()
  for (const row of r.recordset ?? []) {
    const key = text(row.kcaa01).toLowerCase()
    if (!key || map.has(key)) continue
    map.set(key, row)
  }
  return map
}

async function fetchBomRatesByCurrencyCodes(pool, currencyCodes) {
  const codes = [...new Set((currencyCodes ?? []).map((k) => text(k)).filter(Boolean))]
  if (!codes.length) return new Map()
  const req = pool.request()
  const inList = codes.map((k, i) => {
    const p = `cc${i}`
    req.input(p, sql.NVarChar(100), k)
    return `@${p}`
  }).join(', ')
  const r = await req.query(`
    SELECT
      ${nvarcharTextExpr('c', 'code', 100)} AS code,
      ${nvarcharTextExpr('c', 'name', 200)} AS name,
      ${safeDecimalExpr('c', 'bom_rate')} AS bom_rate
    FROM ${CURRENCY_FROM} AS c
    WHERE ${nvarcharTextExpr('c', 'del', 20)} IN (N'', N'0')
      AND ${nvarcharTextExpr('c', 'pass', 20)} = N'1'
      AND ${nvarcharTextExpr('c', 'code', 100)} IN (${inList})
  `)
  const map = new Map()
  for (const row of r.recordset ?? []) {
    map.set(text(row.code).toLowerCase(), {
      name: text(row.name),
      bomRate: resolveBomRate(row.bom_rate),
    })
  }
  return map
}

function mapBomPartRow(flatEntry, partRow, ctx) {
  const pm = text(ctx.productKcaa01)
  const systemcode = text(partRow?.systemcode || flatEntry.sourceNode?.systemcode)
  const lineKey = buildAssistReturnLineKey(systemcode, pm)
  const currencyCode = text(partRow?.kcaa23)
  const currencyInfo = ctx.bomRateMap.get(currencyCode.toLowerCase()) ?? { name: currencyCode || '-', bomRate: 1 }
  const bomRate = currencyInfo.bomRate
  const salePrice = toNumber(partRow?.sale_price ?? flatEntry.sourceNode?.sale_price)
  const unitPrice = computeBomPartUnitPrice(salePrice, bomRate)
  const unitPriceTax = computeBomFixedTaxPrice(unitPrice)
  const usageQty = round(flatEntry.totalUsage, 6)
  const lossRate = computePartLossRate(partRow?.kcac05 ?? flatEntry.sourceNode?.kcac05, partRow?.kcaa33 ?? flatEntry.sourceNode?.kcaa33)
  const baseUsage = toNumber(partRow?.kcac04 ?? flatEntry.sourceNode?.kcac04)
  const usageTotal = flatEntry.totalUsage
  const costTotal = round(usageTotal * unitPriceTax, 4)
  const alreadySelected = ctx.selectedSet.has(lineKey)
  const customerSupplyRaw = text(partRow?.Customer_supply)

  const out = {
    lineKey,
    pm,
    productKcaa01: pm,
    seq: ctx.seq,
    // 落库用数字 0/1/2；界面「是否客供」用 customerSupplyLabel
    Customer_supply: customerSupplyRaw,
    customerSupplyLabel: customerSupplyLabel(customerSupplyRaw) || '-',
    kcaa01: text(flatEntry.kcaa01),
    kcaa02: text(partRow?.kcaa02 || flatEntry.sourceNode?.kcaa02),
    kcaa02_en: text(partRow?.kcaa02_en),
    kcaa04: text(partRow?.kcaa04 || flatEntry.sourceNode?.kcaa04),
    kcaa29: text(partRow?.kcaa29),
    usageQty: baseUsage,
    lossRate,
    lossRatePercent: round(lossRate * 100, 4),
    usageTotal,
    unitPrice,
    unitPriceTax,
    costTotal,
    remark: text(partRow?.remark),
    partGuid: text(partRow?.partGuid || systemcode),
    currencyName: currencyInfo.name,
    bomRate,
    currencyDisplay: `${currencyInfo.name || currencyCode || '-'} / ${bomRate}`,
    systemcode,
    GUID: text(partRow?.partGuid || systemcode),
    kcao02: systemcode,
    kcao03: 0,
    kcao031: ASSIST_RETURN_KCAO031_CAP,
    kcao04: unitPrice,
    kcao041: 0,
    kcao05: 0,
    kcao051: 0,
    tax: BOM_RETURN_FIXED_TAX,
    info: buildBomPartInfoText(partRow),
    reference: text(partRow?.d_code),
    sale_price: salePrice,
    selectable: !alreadySelected,
    selectState: alreadySelected ? 'picked' : 'select',
    selectLabel: alreadySelected ? '已选择' : '选择',
  }
  for (const col of KCAA_COLS) {
    if (partRow?.[col] != null) out[col] = partRow[col]
  }
  return out
}

export async function fetchStockInAssistReturnBomParts(pool, query = {}) {
  const sourceOrderNo = text(query.sourceOrderNo)
  const productKcaa01 = text(query.productKcaa01)
  if (!sourceOrderNo) return { ok: false, status: 400, msg: '请先选择外协单号' }
  if (!productKcaa01) return { ok: false, status: 400, msg: '请先指定外协成品编码' }

  const selectedSet = new Set(
    text(query.selectedKeys)
      .split(',')
      .map((x) => x.trim().toLowerCase())
      .filter(Boolean),
  )

  const head = await fetchBomHeadByKcaa01(pool, productKcaa01)
  const rootKey = text(head?.bomGuid || head?.systemcode)
  if (!rootKey) {
    return { ok: true, list: [], productKcaa01, bomMissing: true, msg: '未找到该成品的主 BOM 资料' }
  }

  const layerCache = await prefetchBomPartsLayersForUsageTree(pool, rootKey)
  const stack = new Set([rootKey])
  let tree
  try {
    tree = buildBomPartsUsageTreeNodesFromLayerCache(rootKey, 1, stack, layerCache, false)
  } catch (err) {
    if (err?.code === 'BOM_CYCLE') {
      return { ok: false, status: 400, msg: `成品 ${productKcaa01} 的 BOM 存在循环引用` }
    }
    throw err
  }

  const merged = flattenAssistReturnBomTree(tree)
  const materialCodes = [...merged.keys()].map((k) => merged.get(k).kcaa01).filter(Boolean)
  if (!materialCodes.length) {
    return { ok: true, list: [], productKcaa01, bomMissing: false }
  }

  const [partMap, bomRateMap] = await Promise.all([
    fetchBomPartsDetailByKcaa01(pool, materialCodes),
    fetchBomRatesByCurrencyCodes(pool, []),
  ])

  const currencyCodes = []
  for (const code of materialCodes) {
    const part = partMap.get(text(code).toLowerCase())
    const cc = text(part?.kcaa23)
    if (cc) currencyCodes.push(cc)
  }
  const bomRateMapResolved = currencyCodes.length
    ? await fetchBomRatesByCurrencyCodes(pool, currencyCodes)
    : bomRateMap

  let seq = 0
  const list = []
  for (const entry of merged.values()) {
    seq += 1
    const partRow = partMap.get(text(entry.kcaa01).toLowerCase()) ?? {}
    list.push(mapBomPartRow(entry, partRow, {
      productKcaa01,
      selectedSet,
      bomRateMap: bomRateMapResolved,
      seq,
    }))
  }

  return { ok: true, list, productKcaa01, bomMissing: false }
}
