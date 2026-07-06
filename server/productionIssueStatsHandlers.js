/**
 * 生产领用统计表 API。
 * 明细视图按出库明细逐条展示；汇总视图按 PI + 物料汇总预算、领用、退料、实领、未领。
 */
import { sql } from './db.js'
import { safeDecimalExpr, nvarcharTextExpr } from './buyOrderSqlSafe.js'
import { fetchStockStatsPrintHeader } from './stockStatsPrintHeader.js'

const WAREHOUSE_FROM = 'dbo.[UB_ERP_Stocks_Warehouse]'
const BOM_FROM = 'dbo.[UB_ERP_Bom_000]'
const SALES_FROM = 'dbo.[UB_ERP_Sales_order]'
const SALES_LINE_FROM = 'dbo.[UB_ERP_Sales_order_list]'
const PI_COST_FROM = 'dbo.[UB_ERP_Bom_pi_cost]'
const STOCK_OUT_HEADER_FROM = 'dbo.[UB_ERP_Stocks_out]'
const STOCK_OUT_LINE_FROM = 'dbo.[UB_ERP_Stocks_out_list]'
const STOCK_IN_HEADER_FROM = 'dbo.[UB_ERP_Stocks_Storage]'
const STOCK_IN_LINE_FROM = 'dbo.[UB_ERP_Stocks_Storage_list]'
const MENU_PATH = 'production/analysis/report-stats'
const REPORT_MAX_ROWS = 50000

const OUTBOUND_TYPE_IN = ["N'2'", "N'4'", "N'7'", "N'8'"]
const RETURN_TYPE_IN = ["N'3'", "N'5'"]

const PI_NO_EXPR = nvarcharTextExpr('h', 'kcap08', 200)
const DOC_NO_EXPR = nvarcharTextExpr('h', 'kcap01', 200)
const WORKSHOP_EXPR = nvarcharTextExpr('h', 'kehu', 500)
const MATERIAL_CODE_EXPR = nvarcharTextExpr('l', 'kcaa01', 200)
const ISSUE_QTY_EXPR = safeDecimalExpr('l', 'kcaq03', 0)

function tableTextExpr(col, size = 500) {
  return `LTRIM(RTRIM(CONVERT(nvarchar(${size}), ISNULL([${col}], N''))))`
}

function colTextExpr(alias, col, size = 500) {
  return `LTRIM(RTRIM(CONVERT(nvarchar(${size}), ISNULL(${alias}.[${col}], N''))))`
}

function text(v) {
  return String(v ?? '').trim()
}

function likePattern(v) {
  return `%${text(v).replace(/[\\%_]/g, '\\$&')}%`
}

function prefixPattern(v) {
  return `${text(v).replace(/[\\%_]/g, '\\$&')}%`
}

function normalizeDate(value) {
  const s = text(value)
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : ''
}

function normalizeChooses(value) {
  const s = text(value)
  return s === '1' || s === '2' ? s : ''
}

function normalizeViewMode(value) {
  return text(value) === 'summary' ? 'summary' : 'detail'
}

function parsePiList(value) {
  const raw = String(value ?? '').split(/[,，]/)
  const out = []
  const seen = new Set()
  for (const item of raw) {
    const v = text(item)
    if (!v || seen.has(v)) continue
    seen.add(v)
    out.push(v)
    if (out.length >= 50) break
  }
  return out
}

function parsePiOptionQuery(query = {}) {
  const pageRaw = Number(query.page ?? 1) || 1
  const pageSizeRaw = Number(query.pageSize ?? 10) || 10
  const page = Math.max(1, Math.floor(pageRaw))
  const pageSize = Math.min(100, Math.max(1, Math.floor(pageSizeRaw)))
  return { page, pageSize, startRow: (page - 1) * pageSize + 1, endRow: page * pageSize }
}

function parseReportQuery(query = {}) {
  return {
    viewMode: normalizeViewMode(query.viewMode),
    startDate: normalizeDate(query.startDate),
    endDate: normalizeDate(query.endDate),
    warehouseCode: text(query.warehouseCode),
    chooses: normalizeChooses(query.chooses),
    piPoNos: parsePiList(query.piPoNos ?? query.piPoNo),
    materialCode: text(query.materialCode),
    onlyUnissued: ['1', 'true', 'yes'].includes(text(query.onlyUnissued).toLowerCase()),
    lx: text(query.lx) || '1',
  }
}

function validateReportQuery(q) {
  if (!q.startDate) return '统计开始日期不能为空'
  if (!q.endDate) return '统计结束日期不能为空'
  if (!q.warehouseCode) return '仓库不能为空'
  if (q.viewMode === 'detail' && !q.chooses) return '统计标准不能为空'
  return ''
}

function bindReportParams(req, q) {
  req.input('startDate', sql.DateTime, new Date(`${q.startDate}T00:00:00`))
  req.input('endDate', sql.DateTime, new Date(`${q.endDate}T23:59:59`))
  req.input('warehouseCode', sql.NVarChar(200), q.warehouseCode)
  if (q.materialCode) {
    req.input('materialCode', sql.NVarChar(200), q.materialCode)
    req.input('materialPrefix', sql.NVarChar(220), prefixPattern(q.materialCode))
  }
  q.piPoNos.forEach((piNo, index) => req.input(`pi${index}`, sql.NVarChar(200), piNo))
}

function buildPiInSql(piList, expr = PI_NO_EXPR) {
  if (!piList.length) return ''
  const tokens = piList.map((_, index) => `@pi${index}`).join(', ')
  return `${expr} IN (${tokens})`
}

function activeDelSql(alias) {
  return `(ISNULL(${alias}.[del], N'') = N'' OR ${alias}.[del] = N'0')`
}

function buildBaseWhereParts(q) {
  const parts = [
    activeDelSql('h'),
    activeDelSql('l'),
    "LTRIM(RTRIM(ISNULL(CONVERT(nvarchar(20), h.[pass]), N''))) = N'1'",
    `LTRIM(RTRIM(CONVERT(nvarchar(20), ISNULL(h.[kcap03], N'')))) IN (${OUTBOUND_TYPE_IN.join(', ')})`,
    `${nvarcharTextExpr('h', 'kcap06', 200)} = @warehouseCode`,
    `LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(l.[kcaq01], N'')))) = LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(h.[kcap01], N''))))`,
  ]
  if (q.materialCode) {
    parts.push(`${MATERIAL_CODE_EXPR} = @materialCode`)
  }
  return parts
}

function buildPiScopeCteSql(q = {}) {
  const piFilter = buildPiInSql(q.piPoNos ?? [], tableTextExpr('xsaj01', 200))
  return `
    pi_scope AS (
      SELECT DISTINCT
        ${tableTextExpr('xsaj01', 200)} AS piNo,
        ${tableTextExpr('xsaj06', 500)} AS poNo,
        [xsaj02] AS salesDate
      FROM ${SALES_FROM}
      WHERE (ISNULL([del], N'') = N'' OR [del] = N'0')
        AND LTRIM(RTRIM(ISNULL(CONVERT(nvarchar(20), [pass]), N''))) = N'1'
        AND [xsaj02] >= @startDate
        AND [xsaj02] <= @endDate
        AND ${tableTextExpr('xsaj01', 200)} <> N''
        ${piFilter ? `AND ${piFilter}` : ''}
    )`
}

function buildReportWhereSql(q) {
  const parts = buildBaseWhereParts(q)
  if (q.chooses === '2') {
    parts.push('h.[kcap02] >= @startDate')
    parts.push('h.[kcap02] <= @endDate')
    const piWhere = buildPiInSql(q.piPoNos)
    if (piWhere) parts.push(piWhere)
    return `WHERE ${parts.join('\n      AND ')}`
  }

  // 明细 chooses=1：以销售订单 PI 时间为准；未手填 PI 时先按销售订单日期取 PI 集。
  const piWhere = buildPiInSql(q.piPoNos)
  if (piWhere) {
    parts.push(piWhere)
  } else {
    parts.push(`${PI_NO_EXPR} IN (SELECT piNo FROM pi_scope)`)
  }
  return `WHERE ${parts.join('\n      AND ')}`
}

function buildProductionIssueStatsReportSql(q) {
  const whereSql = buildReportWhereSql(q)
  const needsPiScope = q.chooses === '1' && !q.piPoNos.length
  const ctePrefix = needsPiScope ? `WITH ${buildPiScopeCteSql(q)}` : ''
  return `
    ${ctePrefix}
    SELECT TOP ${REPORT_MAX_ROWS}
      ${DOC_NO_EXPR} AS outboundNo,
      h.[kcap02] AS outboundDate,
      ${PI_NO_EXPR} AS piNo,
      ${WORKSHOP_EXPR} AS workshopName,
      ${MATERIAL_CODE_EXPR} AS materialCode,
      ${nvarcharTextExpr('l', 'kcaa02', 500)} AS materialName,
      ${nvarcharTextExpr('l', 'kcaa03', 500)} AS materialSpec,
      ${nvarcharTextExpr('l', 'kcaa04', 100)} AS unit,
      ${ISSUE_QTY_EXPR} AS issueQty,
      l.[id] AS lineId
    FROM ${STOCK_OUT_HEADER_FROM} AS h
    INNER JOIN ${STOCK_OUT_LINE_FROM} AS l
      ON LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(l.[kcaq01], N''))))
       = LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(h.[kcap01], N''))))
    ${whereSql}
    ORDER BY
      ${DOC_NO_EXPR} ASC,
      h.[kcap02] ASC,
      ${PI_NO_EXPR} ASC,
      ${WORKSHOP_EXPR} ASC,
      ${MATERIAL_CODE_EXPR} ASC,
      l.[id] ASC
  `
}

function buildSummaryRemarkSql() {
  return `
    STUFF((
      SELECT DISTINCT N'；' + NULLIF(LTRIM(RTRIM(CONVERT(nvarchar(1000), ISNULL(l2.[Describe], N'')))), N'')
      FROM ${STOCK_OUT_HEADER_FROM} AS h2
      INNER JOIN ${STOCK_OUT_LINE_FROM} AS l2
        ON ${colTextExpr('l2', 'kcaq01', 200)} = ${colTextExpr('h2', 'kcap01', 200)}
      WHERE ${activeDelSql('h2')}
        AND ${activeDelSql('l2')}
        AND LTRIM(RTRIM(ISNULL(CONVERT(nvarchar(20), h2.[pass]), N''))) IN (N'0', N'1')
        AND LTRIM(RTRIM(CONVERT(nvarchar(20), ISNULL(h2.[kcap03], N'')))) IN (${OUTBOUND_TYPE_IN.join(', ')})
        AND ${colTextExpr('h2', 'kcap06', 200)} = @warehouseCode
        AND h2.[kcap02] >= @startDate
        AND h2.[kcap02] <= @endDate
        AND ${colTextExpr('h2', 'kcap08', 200)} = b.piNo
        AND ${colTextExpr('l2', 'kcaa01', 200)} = b.materialCode
        AND ${colTextExpr('h2', 'kcap08', 200)} LIKE N'PI%'
      FOR XML PATH(''), TYPE
    ).value('.', 'nvarchar(max)'), 1, 1, N'')`
}

function buildProductionIssueSummarySql(q) {
  const materialBudgetFilter = q.materialCode
    ? `AND ${colTextExpr('c', 'kcaa01', 200)} LIKE @materialPrefix ESCAPE '\\'`
    : ''
  const materialLineFilter = q.materialCode
    ? `AND ${colTextExpr('l', 'kcaa01', 200)} LIKE @materialPrefix ESCAPE '\\'`
    : ''
  const onlyUnissuedFilter = q.onlyUnissued
    ? `WHERE CASE WHEN b.yssum = 0 THEN 0 ELSE b.yssum - ISNULL(i.lysum, 0) - ISNULL(r.tlsum, 0) END > 0`
    : ''

  return `
    WITH ${buildPiScopeCteSql(q)},
    budget AS (
      SELECT
        ps.piNo,
        ps.poNo,
        ps.salesDate,
        ${colTextExpr('c', 'kcaa01', 200)} AS materialCode,
        ${colTextExpr('c', 'kcaa02', 500)} AS materialName,
        ${colTextExpr('c', 'kcaa03', 500)} AS materialSpec,
        ${colTextExpr('c', 'kcaa04', 100)} AS unit,
        SUM(${safeDecimalExpr('c', 'kcac06', 0)} * ${safeDecimalExpr('sl', 'xsak03', 0)}) AS yssum
      FROM pi_scope AS ps
      INNER JOIN ${SALES_LINE_FROM} AS sl
        ON ${colTextExpr('sl', 'xsak01', 200)} = ps.piNo
      INNER JOIN ${PI_COST_FROM} AS c
        ON ${colTextExpr('c', 'sid', 200)} = ps.piNo
       AND ${colTextExpr('c', 'pq', 200)} = ${colTextExpr('sl', 'kcaa01', 200)}
      WHERE ${colTextExpr('c', 'kcaa01', 200)} <> N''
        ${materialBudgetFilter}
      GROUP BY
        ps.piNo,
        ps.poNo,
        ps.salesDate,
        ${colTextExpr('c', 'kcaa01', 200)},
        ${colTextExpr('c', 'kcaa02', 500)},
        ${colTextExpr('c', 'kcaa03', 500)},
        ${colTextExpr('c', 'kcaa04', 100)}
    ),
    issue_qty AS (
      SELECT
        ${colTextExpr('h', 'kcap08', 200)} AS piNo,
        ${colTextExpr('l', 'kcaa01', 200)} AS materialCode,
        SUM(${safeDecimalExpr('l', 'kcaq03', 0)}) AS lysum
      FROM ${STOCK_OUT_HEADER_FROM} AS h
      INNER JOIN ${STOCK_OUT_LINE_FROM} AS l
        ON ${colTextExpr('l', 'kcaq01', 200)} = ${colTextExpr('h', 'kcap01', 200)}
      WHERE ${activeDelSql('h')}
        AND ${activeDelSql('l')}
        AND LTRIM(RTRIM(ISNULL(CONVERT(nvarchar(20), h.[pass]), N''))) IN (N'0', N'1')
        AND LTRIM(RTRIM(CONVERT(nvarchar(20), ISNULL(h.[kcap03], N'')))) IN (${OUTBOUND_TYPE_IN.join(', ')})
        AND ${colTextExpr('h', 'kcap06', 200)} = @warehouseCode
        AND h.[kcap02] >= @startDate
        AND h.[kcap02] <= @endDate
        AND ${colTextExpr('h', 'kcap08', 200)} LIKE N'PI%'
        AND ${colTextExpr('h', 'kcap08', 200)} IN (SELECT piNo FROM pi_scope)
        ${materialLineFilter}
      GROUP BY ${colTextExpr('h', 'kcap08', 200)}, ${colTextExpr('l', 'kcaa01', 200)}
    ),
    return_qty AS (
      SELECT
        ${colTextExpr('h', 'kcan04', 200)} AS piNo,
        ${colTextExpr('l', 'kcaa01', 200)} AS materialCode,
        SUM(${safeDecimalExpr('l', 'kcao03', 0)}) AS tlsum
      FROM ${STOCK_IN_HEADER_FROM} AS h
      INNER JOIN ${STOCK_IN_LINE_FROM} AS l
        ON ${colTextExpr('l', 'kcao01', 200)} = ${colTextExpr('h', 'kcan01', 200)}
      WHERE ${activeDelSql('h')}
        AND ${activeDelSql('l')}
        AND LTRIM(RTRIM(ISNULL(CONVERT(nvarchar(20), h.[pass]), N''))) = N'1'
        AND LTRIM(RTRIM(CONVERT(nvarchar(20), ISNULL(h.[kcan03], N'')))) IN (${RETURN_TYPE_IN.join(', ')})
        AND ${colTextExpr('h', 'kcan06', 200)} = @warehouseCode
        AND ${colTextExpr('h', 'kcan04', 200)} IN (SELECT piNo FROM pi_scope)
        ${materialLineFilter}
      GROUP BY ${colTextExpr('h', 'kcan04', 200)}, ${colTextExpr('l', 'kcaa01', 200)}
    )
    SELECT TOP ${REPORT_MAX_ROWS}
      b.piNo,
      b.poNo,
      b.salesDate,
      b.materialCode,
      b.materialName,
      b.materialSpec,
      b.unit,
      b.yssum,
      ISNULL(i.lysum, 0) AS lysum,
      ISNULL(r.tlsum, 0) AS tlsum,
      ISNULL(i.lysum, 0) - ISNULL(r.tlsum, 0) AS slsum,
      CASE WHEN b.yssum = 0 THEN 0 ELSE b.yssum - ISNULL(i.lysum, 0) - ISNULL(r.tlsum, 0) END AS wlsim,
      ISNULL(${buildSummaryRemarkSql()}, N'') AS describeText
    FROM budget AS b
    LEFT JOIN issue_qty AS i
      ON i.piNo = b.piNo AND i.materialCode = b.materialCode
    LEFT JOIN return_qty AS r
      ON r.piNo = b.piNo AND r.materialCode = b.materialCode
    ${onlyUnissuedFilter}
    ORDER BY b.piNo ASC, b.materialCode ASC
  `
}

function serializeDate(value) {
  if (value instanceof Date) return value.toISOString()
  return value ?? ''
}

function numberValue(value) {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

function serializeReportRow(row, index) {
  const issueQty = numberValue(row.issueQty)
  return {
    rowKey: `${text(row.outboundNo)}-${Number(row.lineId ?? index)}`,
    outboundNo: text(row.outboundNo),
    outboundDate: serializeDate(row.outboundDate),
    piNo: text(row.piNo),
    workshopName: text(row.workshopName),
    materialCode: text(row.materialCode),
    materialName: text(row.materialName),
    materialSpec: text(row.materialSpec),
    unit: text(row.unit),
    issueQty,
    returnQty: 0,
    netQty: issueQty,
    remark: '',
  }
}

function cleanSummaryRemark(value) {
  return text(value).replace(/[,，]+/g, '；').replace(/；+/g, '；').replace(/^；|；$/g, '')
}

function serializeSummarySections(rows = []) {
  const sections = []
  const map = new Map()
  for (const row of rows) {
    const piNo = text(row.piNo)
    if (!piNo) continue
    let section = map.get(piNo)
    if (!section) {
      section = {
        piNo,
        poNo: text(row.poNo),
        salesDate: serializeDate(row.salesDate),
        rows: [],
      }
      map.set(piNo, section)
      sections.push(section)
    }
    const yssum = numberValue(row.yssum)
    const lysum = numberValue(row.lysum)
    const tlsum = numberValue(row.tlsum)
    const slsum = numberValue(row.slsum)
    const wlsim = yssum === 0 ? 0 : numberValue(row.wlsim)
    section.rows.push({
      rowKey: `${piNo}-${text(row.materialCode)}-${section.rows.length + 1}`,
      index: section.rows.length + 1,
      materialCode: text(row.materialCode),
      materialName: text(row.materialName),
      materialSpec: text(row.materialSpec),
      unit: text(row.unit),
      budgetQty: yssum,
      issueQty: lysum,
      returnQty: tlsum,
      netQty: slsum,
      unissuedQty: wlsim,
      remark: cleanSummaryRemark(row.describeText),
    })
  }
  return sections
}

function flattenSummaryRows(sections = []) {
  return sections.flatMap((section) => section.rows.map((row) => ({ ...row, piNo: section.piNo })))
}

function choosesLabel(chooses) {
  return chooses === '1' ? '销售订单 PI 时间' : '出库单时间'
}

async function fetchWarehouseOptions(pool, keyword = '') {
  const req = pool.request()
  let kwSql = ''
  if (keyword) {
    req.input('kw', sql.NVarChar(400), likePattern(keyword))
    kwSql = `AND (
      ${tableTextExpr('code', 200)} LIKE @kw ESCAPE '\\'
      OR ${tableTextExpr('name', 500)} LIKE @kw ESCAPE '\\'
    )`
  }
  const r = await req.query(`
    SELECT TOP 100
      ${tableTextExpr('code', 200)} AS code,
      ${tableTextExpr('name', 500)} AS name
    FROM ${WAREHOUSE_FROM}
    WHERE (ISNULL([del], N'') = N'' OR [del] = N'0')
      AND LTRIM(RTRIM(ISNULL(CONVERT(nvarchar(20), [pass]), N''))) = N'1'
      ${kwSql}
    ORDER BY [code] ASC
  `)
  return r.recordset ?? []
}

async function fetchMaterialOptions(pool, keyword = '') {
  const req = pool.request()
  let kwSql = ''
  if (keyword) {
    req.input('kw', sql.NVarChar(400), likePattern(keyword))
    kwSql = `AND ${tableTextExpr('kcaa01', 200)} LIKE @kw ESCAPE '\\'`
  }
  const r = await req.query(`
    SELECT TOP 100
      ${tableTextExpr('kcaa01', 200)} AS code
    FROM ${BOM_FROM}
    WHERE (ISNULL([del], N'') = N'' OR [del] = N'0')
      AND ${tableTextExpr('kcaa01', 200)} <> N''
      ${kwSql}
    ORDER BY [kcaa01] ASC, [id] DESC
  `)
  return r.recordset ?? []
}

function buildPiOptionsKeywordSql(hasKeyword) {
  if (!hasKeyword) return ''
  return `
      AND ${tableTextExpr('xsaj01', 200)} LIKE @kw ESCAPE '\\'
    `
}

async function fetchPiOptions(pool, { keyword = '', includeClosed = false, page = 1, pageSize = 10 } = {}) {
  const startRow = (page - 1) * pageSize + 1
  const endRow = page * pageSize
  const countReq = pool.request()
  const listReq = pool.request()
    .input('startRow', sql.Int, startRow)
    .input('endRow', sql.Int, endRow)

  if (keyword) {
    countReq.input('kw', sql.NVarChar(400), likePattern(keyword))
    listReq.input('kw', sql.NVarChar(400), likePattern(keyword))
  }
  const keywordSql = buildPiOptionsKeywordSql(Boolean(keyword))

  const closedSql = includeClosed
    ? ''
    : `AND LTRIM(RTRIM(ISNULL(CONVERT(nvarchar(20), [closed]), N'0'))) = N'0'`

  const whereSql = `
    WHERE LTRIM(RTRIM(ISNULL(CONVERT(nvarchar(20), [pass]), N''))) = N'1'
      AND (ISNULL([del], N'') = N'' OR [del] = N'0')
      ${closedSql}
      ${keywordSql}
  `

  const totalRow = await countReq.query(`SELECT COUNT(1) AS total FROM ${SALES_FROM} ${whereSql}`)
  const total = Number(totalRow.recordset?.[0]?.total ?? 0)
  const r = await listReq.query(`
    SELECT piNo, poNo, customer
    FROM (
      SELECT ROW_NUMBER() OVER (
        ORDER BY CASE WHEN [addtime] IS NULL THEN 1 ELSE 0 END ASC, [addtime] DESC, [id] DESC
      ) AS rn,
        ${tableTextExpr('xsaj01', 200)} AS piNo,
        ${tableTextExpr('xsaj06', 500)} AS poNo,
        ${tableTextExpr('xsaj05', 500)} AS customer
      FROM ${SALES_FROM}
      ${whereSql}
    ) AS src
    WHERE src.rn BETWEEN @startRow AND @endRow
    ORDER BY src.rn ASC
  `)
  return { page, pageSize, total, list: r.recordset ?? [] }
}

function sendError(res, err, prefix) {
  res.status(500).json({ code: 500, msg: `${prefix}：${String(err?.message ?? err)}`, data: null })
}

export function registerProductionIssueStatsRoutes(app, { getPool }) {
  app.get('/api/production-issue-stats/print-header', async (_req, res) => {
    try {
      const pool = await getPool()
      res.json({ code: 200, msg: 'success', data: await fetchStockStatsPrintHeader(pool) })
    } catch (err) {
      sendError(res, err, '读取生产领用统计打印抬头失败')
    }
  })

  app.get('/api/production-issue-stats/warehouse-options', async (req, res) => {
    try {
      const pool = await getPool()
      res.json({ code: 200, msg: 'success', data: { list: await fetchWarehouseOptions(pool, text(req.query?.keyword)) } })
    } catch (err) {
      sendError(res, err, '读取生产领用统计仓库候选失败')
    }
  })

  app.get('/api/production-issue-stats/material-options', async (req, res) => {
    try {
      const pool = await getPool()
      res.json({ code: 200, msg: 'success', data: { list: await fetchMaterialOptions(pool, text(req.query?.keyword)) } })
    } catch (err) {
      sendError(res, err, '读取生产领用统计物料候选失败')
    }
  })

  app.get('/api/production-issue-stats/pi-options', async (req, res) => {
    try {
      const pool = await getPool()
      const { page, pageSize } = parsePiOptionQuery(req.query ?? {})
      const includeClosed = text(req.query?.includeClosed) === '1'
      const data = await fetchPiOptions(pool, {
        keyword: text(req.query?.keyword),
        includeClosed,
        page,
        pageSize,
      })
      res.json({ code: 200, msg: 'success', data })
    } catch (err) {
      sendError(res, err, '读取生产领用统计 PI 候选失败')
    }
  })

  app.get('/api/production-issue-stats/report', async (req, res) => {
    try {
      const q = parseReportQuery(req.query ?? {})
      const errMsg = validateReportQuery(q)
      if (errMsg) {
        res.status(400).json({ code: 400, msg: errMsg, data: null })
        return
      }

      const pool = await getPool()
      const dbReq = pool.request()
      bindReportParams(dbReq, q)
      if (q.viewMode === 'summary') {
        const result = await dbReq.query(buildProductionIssueSummarySql(q))
        const sections = serializeSummarySections(result.recordset ?? [])
        const list = flattenSummaryRows(sections)
        res.json({
          code: 200,
          msg: 'success',
          data: {
            viewMode: 'summary',
            sections,
            list,
            startDate: q.startDate,
            endDate: q.endDate,
            warehouseCode: q.warehouseCode,
            piPoNos: q.piPoNos,
            materialCode: q.materialCode,
            onlyUnissued: q.onlyUnissued,
            truncated: list.length >= REPORT_MAX_ROWS,
          },
        })
        return
      }

      const result = await dbReq.query(buildProductionIssueStatsReportSql(q))
      const list = (result.recordset ?? []).map((row, index) => serializeReportRow(row, index))
      res.json({
        code: 200,
        msg: 'success',
        data: {
          viewMode: 'detail',
          list,
          startDate: q.startDate,
          endDate: q.endDate,
          warehouseCode: q.warehouseCode,
          chooses: q.chooses,
          choosesLabel: choosesLabel(q.chooses),
          piPoNos: q.piPoNos,
          materialCode: q.materialCode,
          lx: q.lx,
          truncated: list.length >= REPORT_MAX_ROWS,
        },
      })
    } catch (err) {
      sendError(res, err, '读取生产领用统计表失败')
    }
  })
}

export const __productionIssueStatsForTest = {
  MENU_PATH,
  REPORT_MAX_ROWS,
  parseReportQuery,
  parsePiList,
  validateReportQuery,
  buildReportWhereSql,
  buildProductionIssueStatsReportSql,
  buildPiScopeCteSql,
  buildProductionIssueSummarySql,
  buildPiOptionsKeywordSql,
  serializeReportRow,
  serializeSummarySections,
  choosesLabel,
}
