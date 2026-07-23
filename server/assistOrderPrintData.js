import { sql } from './db.js'
import { fetchSystemPrintLogoConfig } from './systemPrintLogo.js'

const HEADER_FROM = 'dbo.[UB_ERP_assist_order]'
const LINE_FROM = 'dbo.[UB_ERP_assist_order_list]'
const MONEY_FROM = 'dbo.[UB_ERP_assist_order_money]'
const SUPPLIER_FROM = 'dbo.[UB_ERP_System_supplier]'
const COLOR_FROM = 'dbo.[UB_ERP_Stocks_colorcode]'

/** 外协打印「合约条款」正文（序号由前端用「一：」…「十二：」拼出，须与业务定稿逐字一致） */
export const ASSIST_ORDER_CONTRACT_TERMS = [
  '乙方要按甲方提供正确及标准样板生产。未得甲方书面同意不能随便改变动物料及做法。',
  '乙方需按合约交货期交货完成合约，如因迟交而导致甲方损失或赔偿，则所有费用由乙方承担。',
  '甲方提供足够物料给乙方生产，一切超出生产用量则由乙方承担补料费用。',
  '甲乙双方应同时派人点算清楚物料移交数，以免事后争执。',
  '甲方有权派验货员于开始生产时到乙方厂验货，乙方应按验货员指示及标准完成成品。',
  '乙方如交货到甲方厂验收，发现问题由乙方立即返工，而甲方代为返工，则合理扣回返工费。',
  '凡有不合格的成品，乙方无条件返工，如有物料遗失，乙方要承担赔偿一切费用。',
  '每月对账金额以当月乙方送货单及甲方收货单为准。',
  '如乙方未能按期交货，而没有合理解释，甲方有权扣加工费每天5%',
  '乙方请按税点开增值税专用发票给甲方。（乙方的名称必须与“开票单位”及“收款单位”一致）甲方收到发票后才安排付款。',
  '本合约一式两份，甲乙双方各一份，自签订日起生效。',
  '甲方拥有由其支付模具费（或制版费）的模具归属权，模具在生产期间交由乙方保管，必要时，甲方有权拿回模具；乙方需无条件配合完整交还模具。',
]

function text(value) {
  return String(value ?? '').trim()
}

function number(value) {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

function clampInt(value, fallback, min, max) {
  const n = Math.trunc(Number(value))
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, n))
}

function money(value) {
  return number(value).toFixed(2)
}

function formatNumber(value, decimals) {
  return number(value).toFixed(decimals)
}

function dateText(value) {
  if (!value) return ''
  const d = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(d.getTime())) return text(value).slice(0, 10)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function normalizePrintSetup(setup = {}) {
  return {
    rowsPerPage: clampInt(setup.rowsPerPage ?? setup.print_s, 12, 3, 15),
    priceDecimals: clampInt(setup.priceDecimals ?? setup.decimalPlaces, 2, 2, 5),
  }
}

export function normalizeAssistOrderPrintFormat(value) {
  return text(value) === '1' ? 1 : 0
}

export function parseAssistOrderPrintNos(value) {
  return String(value ?? '')
    .split(',')
    .map((item) => text(item))
    .filter(Boolean)
}

function taxFlagText(value) {
  return text(value) === '2' ? '不含税' : '含税'
}

function lineColorText(line) {
  const code = text(line.kcaa11)
  const name = text(line.colorName)
  if (code && name) return `${code} ${name}`
  return code || name
}

function buildLineRows(lines, taxIncluded, setup) {
  const useTaxIncluded = text(taxIncluded) !== '2'
  return (Array.isArray(lines) ? lines : []).map((line, index) => {
    const price = useTaxIncluded ? line.wxak041 : line.wxak04
    const amount = useTaxIncluded ? line.wxak051 : line.wxak05
    return {
      type: 'line',
      seq: index + 1,
      materialCode: text(line.kcaa01),
      materialName: text(line.kcaa02),
      spec: text(line.kcaa03),
      product: text(line.product),
      color: lineColorText(line),
      group: text(line.kcaa10),
      unit: text(line.kcaa04),
      quantity: formatNumber(line.wxak03, 2),
      price: formatNumber(price, setup.priceDecimals),
      amount: money(amount),
      deliveryDate: dateText(line.deliveryDate),
      tax: text(line.tax),
      describe: text(line.describe),
    }
  })
}

function buildFeeRows(fees, startSeq) {
  return (Array.isArray(fees) ? fees : []).map((fee, index) => ({
    type: 'fee',
    seq: startSeq + index,
    materialCode: text(fee.feeCode),
    materialName: text(fee.feeName),
    invoiceName: text(fee.invoiceName),
    spec: text(fee.spec),
    product: '',
    color: '',
    group: '',
    unit: '',
    quantity: '',
    price: '',
    amount: money(fee.money),
    deliveryDate: '',
    tax: text(fee.tax),
    describe: text(fee.remark),
  }))
}

function paginate(rows, rowsPerPage, orderHeader) {
  const pages = []
  for (let i = 0; i < rows.length || i === 0; i += rowsPerPage) {
    pages.push({
      pageNo: pages.length + 1,
      order: orderHeader,
      rows: rows.slice(i, i + rowsPerPage),
    })
  }
  return pages.map((page) => ({ ...page, pageTotal: pages.length }))
}

export function buildAssistOrderPrintDocument(order, rawSetup = {}) {
  const setup = normalizePrintSetup(rawSetup)
  const wxgs = normalizeAssistOrderPrintFormat(rawSetup.wxgs)
  const header = order?.header ?? {}
  const lineRows = buildLineRows(order?.lines ?? [], header.taxIncluded, setup)
  const feeRows = buildFeeRows(order?.fees ?? [], lineRows.length + 1)
  const rows = [...lineRows, ...feeRows]
  const lineQty = (order?.lines ?? []).reduce((sum, line) => sum + number(line.wxak03), 0)
  const useTaxIncluded = text(header.taxIncluded) !== '2'
  const lineAmount = (order?.lines ?? []).reduce(
    (sum, line) => sum + number(useTaxIncluded ? line.wxak051 : line.wxak05),
    0,
  )
  const feeAmount = (order?.fees ?? []).reduce((sum, fee) => sum + number(fee.money), 0)
  const printHeader = {
    assistOrderNo: text(header.assistOrderNo),
    date: dateText(header.assistDate),
    piNo: text(header.referenceNo),
    supplierCode: text(header.supplierCode),
    supplierName: text(header.supplierName),
    supplierShortName: text(header.supplierShortName) || text(header.supplierName),
    payFor: text(header.payFor),
    address: text(header.address),
    contact: text(header.contact),
    tel: text(header.tel),
    currencyName: text(header.currencyName) || text(header.currencyCode),
    taxFlag: taxFlagText(header.taxIncluded),
    remark: text(header.remark),
  }

  return {
    wxgs,
    showDescribeColumn: wxgs === 1,
    setup,
    header: printHeader,
    pages: paginate(rows, setup.rowsPerPage, printHeader),
    totals: {
      quantity: formatNumber(lineQty, 2),
      amount: money(lineAmount + feeAmount),
    },
    contractTerms: ASSIST_ORDER_CONTRACT_TERMS,
    signature: {
      partyA: '甲方',
      payableAccounting: '应付会计',
      partyB: '乙方',
      seal: '盖章',
      director: '厂长',
      date: '日期',
      makerName: text(order?.makerName),
      checker: '核对',
    },
  }
}

async function fetchPrintHeaderByOrderNo(pool, orderNo) {
  const result = await pool.request().input('orderNo', sql.NVarChar(200), orderNo).query(`
    SELECT TOP 1
      h.[id],
      LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(h.[wxaj01], N'')))) AS assistOrderNo,
      h.[wxaj02] AS assistDate,
      LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(h.[wxaj04], N'')))) AS referenceNo,
      LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(h.[wxaj05], N'')))) AS supplierCode,
      LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(h.[kehu], N'')))) AS supplierName,
      LTRIM(RTRIM(CONVERT(nvarchar(20), ISNULL(h.[wxaj06], N'')))) AS taxIncluded,
      LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(h.[wxaj07], N'')))) AS currencyCode,
      LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(h.[rmb], N'')))) AS currencyName,
      LTRIM(RTRIM(CONVERT(nvarchar(1000), ISNULL(h.[remark], N'')))) AS remark,
      LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(s.[s_sname], N'')))) AS supplierShortName,
      LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(s.[s_payfor], N'')))) AS payFor,
      LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(s.[s_address], N'')))) AS address,
      LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(s.[s_lxr], N'')))) AS contact,
      LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(s.[s_tel], N'')))) AS tel
    FROM ${HEADER_FROM} AS h
    LEFT JOIN ${SUPPLIER_FROM} AS s
      ON LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(s.[s_code], N'')))) = LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(h.[wxaj05], N''))))
     AND (ISNULL(s.[del], N'') = N'' OR s.[del] = N'0')
     AND LTRIM(RTRIM(CONVERT(nvarchar(20), ISNULL(s.[pass], N'')))) = N'1'
    WHERE LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(h.[wxaj01], N'')))) = @orderNo
      AND (ISNULL(h.[del], N'') = N'' OR h.[del] = N'0')
  `)
  return result.recordset?.[0] ?? null
}

export async function fetchAssistOrderPrintDocuments(pool, { pSum = '', ids = [] } = {}, actor = {}, setupOverrides = {}) {
  let orderNos = parseAssistOrderPrintNos(pSum)
  if (!orderNos.length && Array.isArray(ids) && ids.length) {
    for (const rawId of ids) {
      const id = Math.trunc(Number(rawId))
      if (!Number.isInteger(id) || id <= 0) continue
      const result = await pool.request().input('id', sql.Int, id).query(`
        SELECT TOP 1 LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL([wxaj01], N'')))) AS assistOrderNo
        FROM ${HEADER_FROM}
        WHERE [id] = @id AND (ISNULL([del], N'') = N'' OR [del] = N'0')
      `)
      const orderNo = text(result.recordset?.[0]?.assistOrderNo)
      if (orderNo) orderNos.push(orderNo)
    }
  }
  if (!orderNos.length) return { ok: false, status: 400, code: 'EMPTY_P_SUM', msg: '请选择需要打印的订单' }

  // 与采购订单一致：本次打印页的选择只参与本次排版，不保存为用户偏好。
  const setup = normalizePrintSetup(setupOverrides)
  const printConfig = await fetchSystemPrintLogoConfig(pool)
  const docs = []
  for (let index = 0; index < orderNos.length; index += 1) {
    const header = await fetchPrintHeaderByOrderNo(pool, orderNos[index])
    if (!header?.id) return { ok: false, status: 404, code: 'MISSING_DOCUMENT', msg: `其中第 ${index + 1} 张单数据不存在，请返回检测` }

    const orderNo = text(header.assistOrderNo)
    const linesResult = await pool.request().input('orderNo', sql.NVarChar(200), orderNo).query(`
      SELECT
        ROW_NUMBER() OVER (ORDER BY ISNULL(l.[seq], l.[id]), l.[id]) AS seq,
        LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(l.[Product], N'')))) AS product,
        LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(l.[kcaa01], N'')))) AS kcaa01,
        LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(l.[kcaa02], N'')))) AS kcaa02,
        LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(l.[kcaa03], N'')))) AS kcaa03,
        LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(l.[kcaa04], N'')))) AS kcaa04,
        LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(l.[kcaa10], N'')))) AS kcaa10,
        LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(l.[kcaa11], N'')))) AS kcaa11,
        LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(c.[name], N'')))) AS colorName,
        l.[wxak03],
        l.[wxak04],
        l.[wxak041],
        l.[wxak05],
        l.[wxak051],
        l.[tax],
        l.[delivery_date] AS deliveryDate,
        LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(l.[Describe], N'')))) AS describe
      FROM ${LINE_FROM} AS l
      LEFT JOIN ${COLOR_FROM} AS c
        ON LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(c.[code], N'')))) = LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(l.[kcaa11], N''))))
       AND (ISNULL(c.[del], N'') = N'' OR c.[del] = N'0')
      WHERE LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(l.[wxak01], N'')))) = @orderNo
        AND (ISNULL(l.[del], N'') = N'' OR l.[del] = N'0')
      ORDER BY ISNULL(l.[seq], l.[id]), l.[id]
    `)
    const feesResult = await pool.request().input('orderNo', sql.NVarChar(200), orderNo).query(`
      SELECT
        LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(m.[kcaa01], N'')))) AS feeCode,
        LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(NULLIF(m.[kcaa02], N''), m.[mtitle])))) AS feeName,
        LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(m.[kpname], N'')))) AS invoiceName,
        LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(m.[kcaa03], N'')))) AS spec,
        m.[money],
        m.[tax],
        LTRIM(RTRIM(CONVERT(nvarchar(1000), ISNULL(m.[remark], N'')))) AS remark
      FROM ${MONEY_FROM} AS m
      WHERE LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(m.[assist_code], N'')))) = @orderNo
        AND ISNULL(m.[del], 0) = 0
      ORDER BY ISNULL(m.[kid], m.[id]), m.[id]
    `)

    docs.push(buildAssistOrderPrintDocument({
      header,
      lines: linesResult.recordset ?? [],
      fees: feesResult.recordset ?? [],
      makerName: text(actor.trueName ?? actor.truename ?? actor.utruename ?? actor.name ?? actor.username),
    }, { ...setup, wxgs: setupOverrides.wxgs }))
  }
  return { ok: true, list: docs, setup, printConfig }
}
