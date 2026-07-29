/**
 * 材料备料表 API。
 * 四种模式均按选定 PI 批量查询，不读取库存、不写入中间表。
 */
import { sql } from './db.js'
import { safeDecimalExpr } from './buyOrderSqlSafe.js'
import { fetchStockStatsPrintHeader } from './stockStatsPrintHeader.js'

const SALES_HEADER_FROM = 'dbo.[UB_ERP_Sales_order]'
const SALES_LINE_FROM = 'dbo.[UB_ERP_Sales_order_list]'
const PI_COST_FROM = 'dbo.[UB_ERP_Bom_pi_cost]'
const STOCK_OUT_HEADER_FROM = 'dbo.[UB_ERP_Stocks_out]'
const STOCK_OUT_LINE_FROM = 'dbo.[UB_ERP_Stocks_out_list]'
const CATEGORY_FROM = 'dbo.[UB_ERP_Stocks_material]'
const COLOR_FROM = 'dbo.[UB_ERP_Stocks_colorcode]'
const MENU_PATH = 'inventory/analysis/material-preparation'
const MODES = new Set([
  'material-by-pi',
  'material-by-component',
  'outbound-by-pi',
  'outbound-by-component',
])

function text(value) {
  return String(value ?? '').trim()
}

function numberValue(value) {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

function round6(value) {
  return Math.round((numberValue(value) + Number.EPSILON) * 1_000_000) / 1_000_000
}

function likePattern(value) {
  return `%${text(value).replace(/[\\%_]/g, '\\$&')}%`
}

function parsePiList(value) {
  const source = Array.isArray(value) ? value : String(value ?? '').split(/[,，]/)
  const seen = new Set()
  return source.map(text).filter((item) => item && !seen.has(item) && seen.add(item))
}

function normalizeMode(value) {
  const mode = text(value)
  return MODES.has(mode) ? mode : 'material-by-pi'
}

function parseReportQuery(query = {}) {
  return {
    mode: normalizeMode(query.mode),
    piNos: parsePiList(query.piNos ?? query.piNo),
  }
}

function validateReportQuery(query) {
  return query.piNos.length ? '' : 'PI号不能为空'
}

function parsePiOptionsQuery(query = {}) {
  const page = Math.max(1, Math.trunc(numberValue(query.page)) || 1)
  const pageSize = Math.min(100, Math.max(1, Math.trunc(numberValue(query.pageSize)) || 10))
  return { keyword: text(query.keyword), page, pageSize }
}

function selectedPiBatch(piNos) {
  const values = piNos.map((_, index) => `(@pi${index}, ${index + 1})`).join(',\n      ')
  return `
    CREATE TABLE #selectedPi (
      piNo nvarchar(200) NOT NULL PRIMARY KEY,
      sortNo int NOT NULL
    );
    INSERT INTO #selectedPi (piNo, sortNo)
    VALUES ${values};

    ;WITH ranked_sales AS (
      SELECT
        s.piNo,
        s.sortNo,
        LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(h.[xsaj06], N'')))) AS poNo,
        h.[xsaj02] AS salesDate,
        ROW_NUMBER() OVER (
          PARTITION BY s.piNo
          ORDER BY h.[id] DESC
        ) AS pickNo
      FROM #selectedPi AS s
      INNER JOIN ${SALES_HEADER_FROM} AS h
        ON h.[xsaj01] = s.piNo
      WHERE (ISNULL(h.[del], N'') = N'' OR h.[del] = N'0')
        AND LTRIM(RTRIM(CONVERT(nvarchar(20), ISNULL(h.[pass], N'')))) = N'1'
    )
    SELECT piNo, sortNo, poNo, salesDate
    INTO #piScope
    FROM ranked_sales
    WHERE pickNo = 1;

    SELECT piNo, poNo, salesDate, sortNo
    FROM #piScope
    ORDER BY sortNo ASC;
  `
}

function bindPiParams(request, piNos) {
  piNos.forEach((piNo, index) => request.input(`pi${index}`, sql.NVarChar(200), piNo))
}

function lookupCtes() {
  return `
    category_rank AS (
      SELECT
        LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL([code], N'')))) AS code,
        LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL([name], N'')))) AS name,
        ROW_NUMBER() OVER (
          PARTITION BY LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL([code], N''))))
          ORDER BY [id] DESC
        ) AS pickNo
      FROM ${CATEGORY_FROM}
      WHERE (ISNULL([del], N'') = N'' OR [del] = N'0')
        AND LTRIM(RTRIM(CONVERT(nvarchar(20), ISNULL([pass], N'')))) = N'1'
    ),
    color_rank AS (
      SELECT
        LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL([code], N'')))) AS code,
        LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL([name], N'')))) AS name,
        ROW_NUMBER() OVER (
          PARTITION BY LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL([code], N''))))
          ORDER BY [id] DESC
        ) AS pickNo
      FROM ${COLOR_FROM}
      WHERE (ISNULL([del], N'') = N'' OR [del] = N'0')
        AND LTRIM(RTRIM(CONVERT(nvarchar(20), ISNULL([pass], N'')))) = N'1'
    ),
    component_rank AS (
      SELECT
        l.[xsak01] AS piNo,
        LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(l.[kcaa01], N'')))) AS componentCode,
        LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(l.[kcaa02], N'')))) AS componentName,
        ROW_NUMBER() OVER (
          PARTITION BY l.[xsak01], l.[kcaa01]
          ORDER BY l.[id] DESC
        ) AS pickNo
      FROM ${SALES_LINE_FROM} AS l
      INNER JOIN #piScope AS p ON p.piNo = l.[xsak01]
      WHERE (ISNULL(l.[del], N'') = N'' OR l.[del] = N'0')
    )
  `
}

function materialDemandCte() {
  return `
    material_demand AS (
      SELECT
        p.piNo,
        LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(c.[pq], N'')))) AS componentCode,
        ISNULL(cr.componentName, N'') AS componentName,
        LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(c.[kcaa01], N'')))) AS materialCode,
        LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(c.[kcaa02], N'')))) AS materialName,
        LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(c.[kcaa03], N'')))) AS materialSpec,
        LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(c.[kcaa04], N'')))) AS unit,
        LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(c.[kcaa05], N'')))) AS categoryCode,
        LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(c.[kcaa11], N'')))) AS colorCode,
        SUM(
          CONVERT(decimal(38, 10), ${safeDecimalExpr('c', 'kcac06', 0)})
          * CONVERT(decimal(38, 10), ${safeDecimalExpr('c', 'temp', 1)})
        ) AS quantity
      FROM #piScope AS p
      INNER JOIN ${PI_COST_FROM} AS c ON c.[sid] = p.piNo
      LEFT JOIN component_rank AS cr
        ON cr.piNo = p.piNo
       AND cr.componentCode = LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(c.[pq], N''))))
       AND cr.pickNo = 1
      WHERE (ISNULL(c.[del], N'') = N'' OR c.[del] = N'0')
        AND LTRIM(RTRIM(CONVERT(nvarchar(20), ISNULL(c.[isok], N'')))) = N'1'
        AND LTRIM(RTRIM(CONVERT(nvarchar(20), ISNULL(c.[kcaa12], N'')))) = N'1'
      GROUP BY
        p.piNo,
        LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(c.[pq], N'')))),
        ISNULL(cr.componentName, N''),
        LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(c.[kcaa01], N'')))),
        LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(c.[kcaa02], N'')))),
        LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(c.[kcaa03], N'')))),
        LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(c.[kcaa04], N'')))),
        LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(c.[kcaa05], N'')))),
        LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(c.[kcaa11], N''))))
    )
  `
}

function materialComponentDemandCte() {
  return `
    material_component_demand AS (
      SELECT
        p.piNo,
        LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(c.[pq], N'')))) AS productCode,
        LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(c.[top_kcaa02], N'')))) AS componentName,
        LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(c.[kcaa01], N'')))) AS materialCode,
        LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(c.[kcaa02], N'')))) AS materialName,
        LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(c.[kcaa03], N'')))) AS materialSpec,
        LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(c.[kcaa04], N'')))) AS unit,
        LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(c.[kcaa05], N'')))) AS categoryCode,
        LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(c.[kcaa11], N'')))) AS colorCode,
        SUM(
          CONVERT(decimal(38, 10), ${safeDecimalExpr('c', 'kcac06', 0)})
          * CONVERT(decimal(38, 10), ${safeDecimalExpr('c', 'temp', 1)})
        ) AS quantity
      FROM #piScope AS p
      INNER JOIN ${PI_COST_FROM} AS c ON c.[sid] = p.piNo
      WHERE (ISNULL(c.[del], N'') = N'' OR c.[del] = N'0')
        AND LTRIM(RTRIM(CONVERT(nvarchar(20), ISNULL(c.[isok], N'')))) = N'1'
        AND LTRIM(RTRIM(CONVERT(nvarchar(20), ISNULL(c.[kcaa12], N'')))) = N'1'
      GROUP BY
        p.piNo,
        LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(c.[pq], N'')))),
        LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(c.[top_kcaa02], N'')))),
        LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(c.[kcaa01], N'')))),
        LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(c.[kcaa02], N'')))),
        LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(c.[kcaa03], N'')))),
        LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(c.[kcaa04], N'')))),
        LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(c.[kcaa05], N'')))),
        LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(c.[kcaa11], N''))))
    )
  `
}

function buildMaterialReportSql(mode, piNos) {
  const includeComponent = mode === 'material-by-component'
  if (includeComponent) {
    return `
      ${selectedPiBatch(piNos)}
      ;WITH
      ${lookupCtes()},
      ${materialComponentDemandCte()}
      SELECT
        d.piNo,
        d.productCode,
        N'' AS componentCode,
        CASE WHEN d.componentName = N'' THEN N'未命名配件' ELSE d.componentName END AS componentName,
        d.materialCode,
        d.materialName,
        d.materialSpec,
        d.unit,
        d.categoryCode,
        ISNULL(cat.name, N'') AS categoryName,
        d.colorCode,
        ISNULL(clr.name, N'') AS colorName,
        SUM(d.quantity) AS quantity
      FROM material_component_demand AS d
      LEFT JOIN category_rank AS cat ON cat.code = d.categoryCode AND cat.pickNo = 1
      LEFT JOIN color_rank AS clr ON clr.code = d.colorCode AND clr.pickNo = 1
      GROUP BY
        d.piNo, d.productCode, d.componentName,
        d.materialCode, d.materialName, d.materialSpec, d.unit,
        d.categoryCode, cat.name, d.colorCode, clr.name
      ORDER BY
        (SELECT sortNo FROM #piScope WHERE piNo = d.piNo),
        d.productCode, d.categoryCode, d.materialCode, d.componentName;
    `
  }
  return `
    ${selectedPiBatch(piNos)}
    ;WITH
    ${lookupCtes()},
    ${materialDemandCte()}
    SELECT
      d.piNo,
      ${includeComponent ? 'd.componentCode' : "N''"} AS componentCode,
      ${includeComponent ? 'd.componentName' : "N''"} AS componentName,
      d.materialCode,
      d.materialName,
      d.materialSpec,
      d.unit,
      d.categoryCode,
      ISNULL(cat.name, N'') AS categoryName,
      d.colorCode,
      ISNULL(clr.name, N'') AS colorName,
      SUM(d.quantity) AS quantity
    FROM material_demand AS d
    LEFT JOIN category_rank AS cat ON cat.code = d.categoryCode AND cat.pickNo = 1
    LEFT JOIN color_rank AS clr ON clr.code = d.colorCode AND clr.pickNo = 1
    GROUP BY
      d.piNo,
      ${includeComponent ? 'd.componentCode, d.componentName,' : ''}
      d.materialCode, d.materialName, d.materialSpec, d.unit,
      d.categoryCode, cat.name, d.colorCode, clr.name
    ORDER BY
      (SELECT sortNo FROM #piScope WHERE piNo = d.piNo),
      ${includeComponent ? 'd.componentCode,' : ''}
      d.categoryCode, d.materialCode;
  `
}

function outboundAggregateCte() {
  return `
    outbound_aggregate AS (
      SELECT
        p.piNo,
        LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(l.[kcaa01], N'')))) AS materialCode,
        LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(l.[kcaa02], N'')))) AS materialName,
        LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(l.[kcaa03], N'')))) AS materialSpec,
        LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(l.[kcaa04], N'')))) AS unit,
        LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(l.[kcaa05], N'')))) AS categoryCode,
        LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(l.[kcaa11], N'')))) AS colorCode,
        SUM(${safeDecimalExpr('l', 'kcaq03', 0)}) AS quantity
      FROM #piScope AS p
      INNER JOIN ${STOCK_OUT_HEADER_FROM} AS h
        ON h.[kcap04] = p.piNo OR h.[kcap08] = p.piNo
      INNER JOIN ${STOCK_OUT_LINE_FROM} AS l ON l.[kcaq01] = h.[kcap01]
      WHERE (ISNULL(h.[del], N'') = N'' OR h.[del] = N'0')
        AND LTRIM(RTRIM(CONVERT(nvarchar(20), ISNULL(h.[pass], N'')))) = N'1'
        AND (ISNULL(l.[del], N'') = N'' OR l.[del] = N'0')
        AND LTRIM(RTRIM(CONVERT(nvarchar(20), ISNULL(l.[kcaa12], N'')))) = N'1'
      GROUP BY
        p.piNo,
        LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(l.[kcaa01], N'')))),
        LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(l.[kcaa02], N'')))),
        LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(l.[kcaa03], N'')))),
        LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(l.[kcaa04], N'')))),
        LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(l.[kcaa05], N'')))),
        LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(l.[kcaa11], N''))))
    )
  `
}

function outboundRowsSelect() {
  return `
    SELECT
      o.piNo,
      o.materialCode,
      o.materialName,
      o.materialSpec,
      o.unit,
      o.categoryCode,
      ISNULL(cat.name, N'') AS categoryName,
      o.colorCode,
      ISNULL(clr.name, N'') AS colorName,
      o.quantity
    FROM outbound_aggregate AS o
    LEFT JOIN category_rank AS cat ON cat.code = o.categoryCode AND cat.pickNo = 1
    LEFT JOIN color_rank AS clr ON clr.code = o.colorCode AND clr.pickNo = 1
    ORDER BY
      (SELECT sortNo FROM #piScope WHERE piNo = o.piNo),
      o.categoryCode, o.materialCode;
  `
}

function buildOutboundReportSql(mode, piNos) {
  const componentMode = mode === 'outbound-by-component'
  return `
    ${selectedPiBatch(piNos)}
    ;WITH
    ${lookupCtes()},
    ${outboundAggregateCte()}
    ${outboundRowsSelect()}
    ${componentMode ? `
    ;WITH
    ${lookupCtes()},
    ${materialDemandCte()}
    SELECT piNo, componentCode, componentName, materialCode, quantity
    FROM material_demand
    WHERE quantity > 0
    ORDER BY
      (SELECT sortNo FROM #piScope WHERE piNo = material_demand.piNo),
      materialCode, componentCode;
    ` : ''}
  `
}

function buildReportSql(query) {
  return query.mode.startsWith('material-')
    ? buildMaterialReportSql(query.mode, query.piNos)
    : buildOutboundReportSql(query.mode, query.piNos)
}

function serializeRow(row, overrides = {}) {
  return {
    piNo: text(row.piNo),
    productCode: text(row.productCode),
    componentCode: text(row.componentCode),
    componentName: text(row.componentName),
    categoryCode: text(row.categoryCode),
    categoryName: text(row.categoryName),
    materialCode: text(row.materialCode),
    materialName: text(row.materialName),
    materialSpec: text(row.materialSpec),
    colorCode: text(row.colorCode),
    colorName: text(row.colorName),
    unit: text(row.unit),
    quantity: round6(row.quantity),
    ...overrides,
  }
}

function allocationKey(piNo, materialCode) {
  return `${text(piNo)}\u0000${text(materialCode)}`
}

function allocateOutboundComponentRows(outboundRows, demandRows) {
  const demandMap = new Map()
  for (const row of demandRows) {
    const demand = numberValue(row.quantity)
    if (demand <= 0) continue
    const key = allocationKey(row.piNo, row.materialCode)
    const list = demandMap.get(key) ?? []
    list.push({
      componentCode: text(row.componentCode),
      componentName: text(row.componentName),
      demand,
    })
    demandMap.set(key, list)
  }

  const result = []
  for (const rawRow of outboundRows) {
    const row = serializeRow(rawRow)
    const demands = (demandMap.get(allocationKey(row.piNo, row.materialCode)) ?? [])
      .sort((a, b) => a.componentCode.localeCompare(b.componentCode, 'zh-CN'))
    const totalDemand = demands.reduce((sum, item) => sum + item.demand, 0)
    if (!demands.length || totalDemand <= 0) {
      result.push({ ...row, componentCode: '', componentName: '未匹配配件' })
      continue
    }

    let allocated = 0
    demands.forEach((item, index) => {
      const quantity = index === demands.length - 1
        ? round6(row.quantity - allocated)
        : round6(row.quantity * item.demand / totalDemand)
      allocated = round6(allocated + quantity)
      result.push({
        ...row,
        componentCode: item.componentCode,
        componentName: item.componentName || item.componentCode,
        quantity,
      })
    })
  }
  return result
}

function serializePiRows(rows) {
  return rows.map((row) => ({
    piNo: text(row.piNo),
    poNo: text(row.poNo),
    salesDate: row.salesDate ?? null,
  }))
}

function serializeReportRows(mode, recordsets) {
  const outboundRows = recordsets?.[1] ?? []
  if (mode === 'outbound-by-component') {
    return allocateOutboundComponentRows(outboundRows, recordsets?.[2] ?? [])
  }
  return outboundRows.map((row) => serializeRow(row))
}

function buildPiOptionsSql(keyword) {
  return `
    ;WITH sales_rank AS (
      SELECT
        LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(h.[xsaj01], N'')))) AS piNo,
        LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(h.[xsaj06], N'')))) AS poNo,
        h.[xsaj02] AS salesDate,
        ROW_NUMBER() OVER (
          PARTITION BY h.[xsaj01]
          ORDER BY h.[id] DESC
        ) AS pickNo
      FROM ${SALES_HEADER_FROM} AS h
      WHERE (ISNULL(h.[del], N'') = N'' OR h.[del] = N'0')
        AND LTRIM(RTRIM(CONVERT(nvarchar(20), ISNULL(h.[pass], N'')))) = N'1'
        AND LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(h.[xsaj01], N'')))) <> N''
        ${keyword ? "AND LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(h.[xsaj01], N'')))) LIKE @keyword ESCAPE '\\'" : ''}
    ),
    numbered AS (
      SELECT
        piNo, poNo, salesDate,
        COUNT(1) OVER () AS total,
        ROW_NUMBER() OVER (ORDER BY piNo DESC) AS rowNo
      FROM sales_rank
      WHERE pickNo = 1
    )
    SELECT piNo, poNo, salesDate, total
    FROM numbered
    WHERE rowNo BETWEEN @rowStart AND @rowEnd
    ORDER BY rowNo ASC
  `
}

async function fetchPiOptions(pool, query) {
  const request = pool.request()
  if (query.keyword) request.input('keyword', sql.NVarChar(400), likePattern(query.keyword))
  request.input('rowStart', sql.Int, (query.page - 1) * query.pageSize + 1)
  request.input('rowEnd', sql.Int, query.page * query.pageSize)
  const result = await request.query(buildPiOptionsSql(query.keyword))
  const rows = result.recordset ?? []
  return {
    list: rows.map((row) => ({
      piNo: text(row.piNo),
      poNo: text(row.poNo),
      salesDate: row.salesDate ?? null,
    })),
    total: numberValue(rows[0]?.total),
    page: query.page,
    pageSize: query.pageSize,
  }
}

function sendError(res, error, prefix) {
  res.status(500).json({ code: 500, msg: `${prefix}：${String(error?.message ?? error)}`, data: null })
}

export function registerMaterialPreparationRoutes(app, { getPool }) {
  app.get('/api/material-preparation/print-header', async (_req, res) => {
    try {
      const pool = await getPool()
      res.json({ code: 200, msg: 'success', data: await fetchStockStatsPrintHeader(pool) })
    } catch (error) {
      sendError(res, error, '读取材料备料表打印抬头失败')
    }
  })

  app.get('/api/material-preparation/pi-options', async (req, res) => {
    try {
      const pool = await getPool()
      res.json({ code: 200, msg: 'success', data: await fetchPiOptions(pool, parsePiOptionsQuery(req.query)) })
    } catch (error) {
      sendError(res, error, '读取材料备料表PI候选失败')
    }
  })

  app.get('/api/material-preparation/report', async (req, res) => {
    try {
      const query = parseReportQuery(req.query)
      const validationError = validateReportQuery(query)
      if (validationError) {
        res.status(400).json({ code: 400, msg: validationError, data: null })
        return
      }

      const pool = await getPool()
      const request = pool.request()
      bindPiParams(request, query.piNos)
      const result = await request.query(buildReportSql(query))
      const piList = serializePiRows(result.recordsets?.[0] ?? [])
      const rows = serializeReportRows(query.mode, result.recordsets ?? [])
      res.json({
        code: 200,
        msg: 'success',
        data: { mode: query.mode, piList, list: rows },
      })
    } catch (error) {
      sendError(res, error, '读取材料备料表失败')
    }
  })
}

export const __materialPreparationForTest = {
  MENU_PATH,
  MODES,
  parsePiList,
  parseReportQuery,
  validateReportQuery,
  parsePiOptionsQuery,
  selectedPiBatch,
  buildPiOptionsSql,
  buildMaterialReportSql,
  buildOutboundReportSql,
  buildReportSql,
  allocateOutboundComponentRows,
  serializeReportRows,
}
