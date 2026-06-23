/**
 * Stock-in assist batch add.
 *
 * This file intentionally mirrors the purchase batch module shape, but keeps
 * assist-specific quantity rules separate:
 * tempx = converted assist quantity - approved inbound - pending inbound.
 * Assist outbound/return quantities are shown only; they do not reduce tempx.
 */
import { sql } from './db.js'
import { safeDecimalExpr, safeIntExpr, nvarcharTextExpr } from './buyOrderSqlSafe.js'

const ASSIST_HEADER_FROM = 'dbo.[UB_ERP_assist_order]'
const ASSIST_LINE_FROM = 'dbo.[UB_ERP_assist_order_list]'
const STOCK_IN_FROM = 'dbo.[UB_ERP_Stocks_Storage]'
const STOCK_IN_LINE_FROM = 'dbo.[UB_ERP_Stocks_Storage_list]'
const STOCK_OUT_FROM = 'dbo.[UB_ERP_Stocks_out]'
const STOCK_OUT_LINE_FROM = 'dbo.[UB_ERP_Stocks_out_list]'
const MATERIAL_CAT_FROM = 'dbo.[UB_ERP_Stocks_material]'
const CURRENCY_FROM = 'dbo.[UB_ERP_Finance_currency]'

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

export function computeAssistKsum(wxak03, kcaa26, kcaa27) {
  const qty = toNumber(wxak03)
  const ratio = toNumber(kcaa26)
  const dir = text(kcaa27)
  if (!(ratio > 0)) return round(qty, 4)
  if (dir === '1') return round(qty / ratio, 4)
  if (dir === '0') return round(qty * ratio, 4)
  return round(qty, 4)
}

export function parseAssistFloatRate(raw) {
  const s = text(raw)
  if (!s) return 0
  if (s.endsWith('%')) {
    const n = toNumber(s.slice(0, -1))
    return n > 1 ? n / 100 : n
  }
  const n = toNumber(s)
  return n > 1 ? n / 100 : n
}

export function computeAssistTempx(ksum, approvedInboundQty, pendingInboundQty) {
  return round(Math.max(0, toNumber(ksum) - toNumber(approvedInboundQty) - toNumber(pendingInboundQty)), 4)
}

export function computeAssistKcao031(tempx, stocksInRate) {
  return round(Math.max(0, toNumber(tempx) + toNumber(tempx) * toNumber(stocksInRate)), 4)
}

export function computeAssistPrice(price, kcaa26, kcaa27, rate) {
  const p = toNumber(price)
  const ratio = toNumber(kcaa26)
  const r = toNumber(rate)
  let converted = p
  if (ratio > 0 && text(kcaa27) === '0') converted = converted / ratio
  if (r > 0) converted = converted / r
  return round(converted, 4)
}

export function resolveAssistBatchSelectState({ tempx, alreadySelected }) {
  if (alreadySelected) return { selectState: 'picked', selectLabel: '已选择', selectable: false }
  if (toNumber(tempx) > 0) return { selectState: 'select', selectLabel: '选择', selectable: true }
  return { selectState: 'disabled_full', selectLabel: '不可选', selectable: false }
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

async function fetchInboundAggByDetailKey(pool, { sourceOrderNo, detailKeys, excludeReceiptNo, inboundType }) {
  const keys = (detailKeys ?? []).map((k) => text(k)).filter(Boolean)
  if (!keys.length) return new Map()
  const exclude = text(excludeReceiptNo)
  const excludeSql = exclude ? `AND ${nvarcharTextExpr('h', 'kcan01', 200)} <> @excludeReceiptNo` : ''
  const req = pool.request()
    .input('sourceOrderNo', sql.NVarChar(200), sourceOrderNo)
    .input('inboundType', sql.NVarChar(20), text(inboundType) || '2')
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

async function fetchInboundPendingDocs(pool, { sourceOrderNo, detailKeys, excludeReceiptNo, inboundType }) {
  const keys = (detailKeys ?? []).map((k) => text(k)).filter(Boolean)
  if (!keys.length) return new Map()
  const exclude = text(excludeReceiptNo)
  const excludeSql = exclude ? `AND ${nvarcharTextExpr('h', 'kcan01', 200)} <> @excludeReceiptNo` : ''
  const req = pool.request()
    .input('sourceOrderNo', sql.NVarChar(200), sourceOrderNo)
    .input('inboundType', sql.NVarChar(20), text(inboundType) || '2')
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

async function fetchFloatRates(pool, categoryCodes) {
  const codes = (categoryCodes ?? []).map((k) => text(k)).filter(Boolean)
  if (!codes.length) return new Map()
  const req = pool.request()
  const inList = codes.map((k, i) => {
    const p = `cc${i}`
    req.input(p, sql.NVarChar(200), k)
    return `@${p}`
  }).join(', ')
  const r = await req.query(`
    SELECT
      ${nvarcharTextExpr('m', 'code', 200)} AS categoryCode,
      ${nvarcharTextExpr('m', 'stocks_in', 50)} AS stocks_in
    FROM ${MATERIAL_CAT_FROM} AS m
    WHERE ${nvarcharTextExpr('m', 'code', 200)} IN (${inList})
  `)
  const map = new Map()
  for (const row of r.recordset ?? []) {
    map.set(text(row.categoryCode), parseAssistFloatRate(row.stocks_in))
  }
  return map
}

function mapAssistLineRow(row, ctx) {
  const detailKey = text(row.wxak02 || row.systemcode || row.GUID)
  const materialCode = text(row.kcaa01)
  const inbound = ctx.inboundMap.get(detailKey) ?? { approvedQty: 0, pendingQty: 0 }
  const outbound = ctx.outboundMap.get(materialCode) ?? { approvedQty: 0, pendingQty: 0 }
  const orderQty = computeAssistKsum(row.wxak03, row.kcaa26, row.kcaa27)
  const tempx = computeAssistTempx(orderQty, inbound.approvedQty, inbound.pendingQty)
  const floatRate = ctx.floatMap.get(text(row.kcaa05)) ?? 0
  const kcao031 = computeAssistKcao031(tempx, floatRate)
  const select = resolveAssistBatchSelectState({
    tempx,
    alreadySelected: ctx.selectedSet.has(detailKey.toLowerCase()),
  })
  const rate = toNumber(ctx.exchangeRate) || 1
  const info = [text(row.Describe), text(row.info)].filter(Boolean).join(' / ')
  const floatPct = round(floatRate * 100, 2)

  const out = {
    lineKey: detailKey,
    id: row.id,
    kcao02: detailKey,
    wxak02: detailKey,
    systemcode: text(row.systemcode) || detailKey,
    GUID: text(row.GUID) || text(row.systemcode) || detailKey,
    kcaa01: materialCode,
    kcaa02: text(row.kcaa02),
    kcaa03: text(row.kcaa03),
    kcaa04: text(row.kcaa04),
    kcaa11: text(row.kcaa11),
    kcaa25: text(row.kcaa25),
    kcaa26: row.kcaa26,
    kcaa27: text(row.kcaa27),
    kcaa05: text(row.kcaa05),
    reference: text(row.reference),
    info,
    currencyDisplay: `${text(ctx.currencyName) || text(ctx.currencyCode) || '-'} / ${rate}`,
    tempx,
    needQty: tempx,
    kcao031,
    overflowCap: kcao031,
    floatRate,
    floatRatePercent: floatPct,
    floatRateText: floatPct > 0 ? `${floatPct}%` : '0%',
    orderQty,
    orderQtyRaw: toNumber(row.wxak03),
    pendingInboundText: formatPendingText(ctx.pendingInboundMap.get(detailKey)),
    pendingOutboundText: formatPendingText(ctx.pendingOutboundMap.get(materialCode)),
    actualInboundQty: round(inbound.approvedQty, 4),
    actualOutboundQty: round(outbound.approvedQty, 4),
    unitConvertText: unitConvertText(row.kcaa04, row.kcaa25, row.kcaa26, row.kcaa27, row.wxak03),
    approvedInboundQty: inbound.approvedQty,
    pendingInboundQty: inbound.pendingQty,
    approvedOutboundQty: outbound.approvedQty,
    pendingOutboundQty: outbound.pendingQty,
    kcao04: computeAssistPrice(row.wxak04, row.kcaa26, row.kcaa27, rate),
    kcao041: computeAssistPrice(row.wxak041, row.kcaa26, row.kcaa27, rate),
    tax: toNumber(row.tax),
    wxak04: toNumber(row.wxak04),
    wxak041: toNumber(row.wxak041),
    availableQty: tempx,
    location: text(row.location),
    sale_price: row.sale_price,
    cost_price: row.cost_price,
    Customer_Name: text(row.Customer_Name),
    Customer_supply: text(row.Customer_supply),
    remark: text(row.remark),
    kpname: text(row.kpname),
    kcaa02_en: text(row.kcaa02_en),
    version: text(row.version),
    ...select,
  }
  for (const col of KCAA_COLS) {
    if (row[col] != null && out[col] == null) out[col] = row[col]
  }
  return out
}

export async function fetchStockInAssistBatchLines(pool, query = {}) {
  const sourceOrderNo = text(query.sourceOrderNo)
  if (!sourceOrderNo) {
    return { ok: false, status: 400, msg: '请先选择外协单号' }
  }
  const supplierCode = text(query.supplierCode)
  const inboundType = text(query.inboundType) === '3' ? '3' : '2'
  const excludeReceiptNo = text(query.excludeReceiptNo)
  const keyword = text(query.keyword)
  const { page, pageSize, startRow, endRow } = parsePage(query)
  const selectedSet = new Set(
    text(query.selectedKeys)
      .split(',')
      .map((x) => x.trim().toLowerCase())
      .filter(Boolean),
  )
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
        MAX(l.[location]) AS location,
        MAX(l.[sale_price]) AS sale_price,
        MAX(l.[cost_price]) AS cost_price,
        MAX(l.[Customer_Name]) AS Customer_Name,
        MAX(l.[Customer_supply]) AS Customer_supply,
        MAX(l.[remark]) AS remark,
        MAX(l.[kpname]) AS kpname,
        MAX(l.[kcaa02_en]) AS kcaa02_en,
        MAX(l.[version]) AS version,
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
  const categoryCodes = [...new Set(rawRows.map((row) => text(row.kcaa05)).filter(Boolean))]
  const outMeta = await getStockOutMeta(pool)
  const [inboundMap, pendingInboundMap, outboundResult, floatMap] = await Promise.all([
    fetchInboundAggByDetailKey(pool, { sourceOrderNo, detailKeys, excludeReceiptNo, inboundType }),
    fetchInboundPendingDocs(pool, { sourceOrderNo, detailKeys, excludeReceiptNo, inboundType }),
    fetchOutboundAggByMaterial(pool, {
      sourceOrderNo,
      materialCodes,
      linkCol: outMeta.linkCol,
      qtyCol: outMeta.qtyCol,
      lineDocCol: outMeta.lineDocCol,
    }),
    fetchFloatRates(pool, categoryCodes),
  ])

  const headerRate = toNumber(rawRows[0]?.headerRate) || toNumber(rawRows[0]?.currencyRate) || 1
  const ctx = {
    inboundMap,
    pendingInboundMap,
    outboundMap: outboundResult.aggMap,
    pendingOutboundMap: outboundResult.pendingMap,
    floatMap,
    selectedSet,
    exchangeRate: headerRate,
    currencyName: text(rawRows[0]?.currencyName),
    currencyCode: text(rawRows[0]?.currencyCode),
  }
  return { ok: true, list: rawRows.map((row) => mapAssistLineRow(row, ctx)), total, page, pageSize }
}
