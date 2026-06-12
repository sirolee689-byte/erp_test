import { sql } from './db.js'

const HEADER_FROM = 'dbo.[UB_ERP_assist_order]'
const LINE_FROM = 'dbo.[UB_ERP_assist_order_list]'
const MONEY_FROM = 'dbo.[UB_ERP_assist_order_money]'
const SUPPLIER_FROM = 'dbo.[System_supplier]'
const COLOR_FROM = 'dbo.[Bom_colorcode]'
const PRINT_SETUP_FROM = 'dbo.[UB_ERP_User_print_setup]'

export const ASSIST_ORDER_CONTRACT_TERMS = [
  '加工方必须按确认样板、工艺要求和订单资料生产。',
  '加工方必须按订单交期交货，延误交期造成损失由加工方承担。',
  '物料由加工方签收后负责保管，遗失、损坏或超耗由加工方承担。',
  '加工方不得擅自更改材料、规格、颜色、工艺或转交第三方加工。',
  '本公司有权随时到加工现场验货和抽查生产进度。',
  '加工不良品必须按本公司要求返工、返修或赔偿。',
  '验收以本公司最终检验结果为准，不合格品不得计入结算。',
  '对账必须凭外协单、送货单、验收记录和双方确认资料办理。',
  '加工方违反交期、质量或保密要求时，本公司有权按约定扣款。',
  '需要开票的业务必须按本公司要求提供合法有效发票。',
  '本公司提供的模具、图纸、样板和资料所有权归本公司所有。',
  '未尽事宜由双方协商处理，本单作为外协加工合同附件执行。',
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
    }
  })
}

function buildFeeRows(fees, startSeq) {
  return (Array.isArray(fees) ? fees : []).map((fee, index) => ({
    type: 'fee',
    seq: startSeq + index,
    materialCode: text(fee.feeCode),
    materialName: text(fee.feeName),
    spec: '',
    product: '',
    color: '',
    group: '',
    unit: '',
    quantity: '',
    price: '',
    amount: money(fee.money),
    deliveryDate: '',
    tax: text(fee.tax),
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
  return pages
}

export function buildAssistOrderPrintDocument(order, rawSetup = {}) {
  const setup = normalizePrintSetup(rawSetup)
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
    wxgs: 0,
    showDescribeColumn: false,
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

export async function readAssistOrderPrintSetup(pool, actor = {}, overrides = {}) {
  const uid = text(actor.uid ?? actor.id ?? actor.userId)
  let saved = {}
  if (uid) {
    const r = await pool.request().input('uid', sql.NVarChar(100), uid).query(`
      SELECT TOP 1 [print_s] AS rowsPerPage
      FROM ${PRINT_SETUP_FROM}
      WHERE LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL([uid], N'')))) = @uid
        AND LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL([code], N'')))) = N'assist_order'
      ORDER BY [id] DESC
    `)
    saved = r.recordset?.[0] ?? {}
  }
  return normalizePrintSetup({ ...saved, ...overrides })
}

export async function fetchAssistOrderPrintDocuments(pool, ids, actor = {}, setupOverrides = {}) {
  const orderIds = (Array.isArray(ids) ? ids : [])
    .map((id) => Math.trunc(Number(id)))
    .filter((id) => Number.isInteger(id) && id > 0)
  if (!orderIds.length) return []

  const setup = await readAssistOrderPrintSetup(pool, actor, setupOverrides)
  const docs = []
  for (const id of orderIds) {
    const headerResult = await pool.request().input('id', sql.Int, id).query(`
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
      WHERE h.[id] = @id
    `)
    const header = headerResult.recordset?.[0]
    if (!header?.id) continue

    const orderNo = text(header.assistOrderNo)
    const linesResult = await pool.request().input('orderNo', sql.NVarChar(200), orderNo).query(`
      SELECT
        ROW_NUMBER() OVER (ORDER BY l.[id] ASC) AS seq,
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
        l.[delivery_date] AS deliveryDate
      FROM ${LINE_FROM} AS l
      LEFT JOIN ${COLOR_FROM} AS c
        ON LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(c.[code], N'')))) = LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(l.[kcaa11], N''))))
       AND (ISNULL(c.[del], N'') = N'' OR c.[del] = N'0')
      WHERE LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(l.[wxak01], N'')))) = @orderNo
        AND (ISNULL(l.[del], N'') = N'' OR l.[del] = N'0')
      ORDER BY l.[id] ASC
    `)
    const feesResult = await pool.request().input('orderNo', sql.NVarChar(200), orderNo).query(`
      SELECT
        LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(m.[kcaa01], N'')))) AS feeCode,
        LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(NULLIF(m.[kcaa02], N''), m.[mtitle])))) AS feeName,
        m.[money],
        m.[tax]
      FROM ${MONEY_FROM} AS m
      WHERE LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(m.[assist_code], N'')))) = @orderNo
        AND ISNULL(m.[del], 0) = 0
      ORDER BY m.[id] ASC
    `)

    docs.push(buildAssistOrderPrintDocument({
      header,
      lines: linesResult.recordset ?? [],
      fees: feesResult.recordset ?? [],
      makerName: text(actor.trueName ?? actor.truename ?? actor.utruename ?? actor.name ?? actor.username),
    }, setup))
  }
  return docs
}
