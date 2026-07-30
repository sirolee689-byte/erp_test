/**
 * 其他入库批量选材：从物料主档按关键字选材，并展示当前仓库库存三列（账存/未审出库/实际库存）。
 * SQL Server 2008 R2 兼容（ROW_NUMBER 分页）。
 */
import { sql } from './db.js'
import { nvarcharTextExpr, safeDecimalExpr } from './buyOrderSqlSafe.js'
import { calcOtherBatchStockQty } from './stockOutOtherBatchAdd.js'
import {
  buildSurplusBatchKeywordWhere,
  parseSurplusBatchPage,
} from './stockInSurplusBatchAdd.js'

const BOM_FROM = 'dbo.[UB_ERP_Bom_000]'
const MATERIAL_CAT_FROM = 'dbo.[New_UB_ERP_Stocks_material]'
const STOCK_IN_FROM = 'dbo.[UB_ERP_Stocks_Storage]'
const STOCK_IN_LINE_FROM = 'dbo.[UB_ERP_Stocks_Storage_list]'
const STOCK_OUT_FROM = 'dbo.[UB_ERP_Stocks_out]'
const STOCK_OUT_LINE_FROM = 'dbo.[UB_ERP_Stocks_out_list]'

const KCAA_COLS = Array.from({ length: 35 }, (_, i) => `kcaa${String(i + 1).padStart(2, '0')}`)

function text(v) {
  return String(v ?? '').trim()
}

function delActiveSql(alias) {
  return `ISNULL(${alias}.[del], N'0') IN (N'', N'0')`
}

function passApprovedSql(alias) {
  return `${alias}.[pass] = N'1'`
}

function bomSelectList() {
  const cols = [
    'GUID',
    'systemcode',
    'location',
    'sale_price',
    'cost_price',
    'Customer_supply',
    'Customer_Name',
    'remark',
    'kpname',
    'kcaa02_en',
    ...KCAA_COLS,
  ]
  return cols.map((col) => `${nvarcharTextExpr('bom', col, 500)} AS [${col}]`).join(',\n        ')
}

/** 按仓库 + 物料编码汇总已审入/已审出/未审出 */
export function buildOtherInboundStockAggCteSql() {
  return `
    inAgg AS (
      SELECT
        il.[kcaa01] AS materialCode,
        SUM(${safeDecimalExpr('il', 'kcao03')}) AS approvedInQty
      FROM ${STOCK_IN_FROM} AS ih
      INNER JOIN ${STOCK_IN_LINE_FROM} AS il
        ON il.[kcao01] = ih.[kcan01]
      WHERE ${delActiveSql('ih')}
        AND ${passApprovedSql('ih')}
        AND ${delActiveSql('il')}
        AND ih.[kcan06] = @warehouseCode
      GROUP BY il.[kcaa01]
    ),
    outAgg AS (
      SELECT
        ol.[kcaa01] AS materialCode,
        SUM(CASE WHEN oh.[pass] = N'1' THEN ${safeDecimalExpr('ol', 'kcaq03')} ELSE 0 END) AS approvedOutQty,
        SUM(CASE WHEN ISNULL(oh.[pass], N'0') <> N'1' THEN ${safeDecimalExpr('ol', 'kcaq03')} ELSE 0 END) AS pendingOutQty
      FROM ${STOCK_OUT_FROM} AS oh
      INNER JOIN ${STOCK_OUT_LINE_FROM} AS ol
        ON ol.[kcaq01] = oh.[kcap01]
      WHERE ${delActiveSql('oh')}
        AND ${delActiveSql('ol')}
        AND oh.[kcap06] = @warehouseCode
      GROUP BY ol.[kcaa01]
    )
  `
}

export function buildOtherInboundBatchListSql({ keyword = '' } = {}) {
  const keywordWhere = buildSurplusBatchKeywordWhere(keyword)
  return `
    WITH ${buildOtherInboundStockAggCteSql()},
    source AS (
      SELECT
        ${bomSelectList()},
        LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(cat.[name], N'')))) AS categoryName,
        ISNULL(i.[approvedInQty], 0) AS approvedInQty,
        ISNULL(o.[approvedOutQty], 0) AS approvedOutQty,
        ISNULL(o.[pendingOutQty], 0) AS pendingOutQty
      FROM ${BOM_FROM} AS bom
      LEFT JOIN ${MATERIAL_CAT_FROM} AS cat
        ON cat.[code] = bom.[kcaa05]
        AND ${delActiveSql('cat')}
      LEFT JOIN inAgg AS i
        ON i.[materialCode] = ${nvarcharTextExpr('bom', 'kcaa01', 300)}
      LEFT JOIN outAgg AS o
        ON o.[materialCode] = ${nvarcharTextExpr('bom', 'kcaa01', 300)}
      WHERE ${delActiveSql('bom')}
        AND ${nvarcharTextExpr('bom', 'kcaa01', 300)} <> N''
        ${keywordWhere}
    ),
    numbered AS (
      SELECT
        ROW_NUMBER() OVER (ORDER BY [kcaa01] ASC, [systemcode] ASC) AS rn,
        COUNT(1) OVER () AS totalCount,
        *
      FROM source
    )
    SELECT *
    FROM numbered
    WHERE rn BETWEEN @startRow AND @endRow
    ORDER BY rn ASC
  `
}

export function enrichOtherInboundBatchRow(row = {}, alreadySelected = false) {
  const stock = calcOtherBatchStockQty({
    approvedInQty: row.approvedInQty,
    approvedOutQty: row.approvedOutQty,
    pendingOutQty: row.pendingOutQty,
  })
  const lineKey = (text(row.systemcode) || text(row.GUID) || text(row.kcaa01)).toLowerCase()
  return {
    ...row,
    lineKey,
    materialCode: text(row.kcaa01),
    location: text(row.location),
    categoryName: text(row.categoryName) || text(row.kcaa05),
    ...stock,
    // 其他入库不按库存正数限制可选，仅父页已选行不可再选
    selectable: !alreadySelected,
    selectLabel: alreadySelected ? '已选择' : '选择',
    selectState: alreadySelected ? 'picked' : 'select',
  }
}

export async function fetchStockInOtherBatchLines(pool, query = {}) {
  const warehouseCode = text(query.warehouseCode)
  if (!warehouseCode) {
    return { ok: false, status: 400, msg: '请先选择仓库' }
  }
  const requireKeyword = text(query.requireKeyword) === '1'
  const keyword = text(query.keyword)
  if (requireKeyword && !keyword) {
    return { ok: true, list: [], total: 0, page: 1, pageSize: parseSurplusBatchPage(query).pageSize, warehouseCode }
  }

  const { page, pageSize, startRow, endRow } = parseSurplusBatchPage(query)
  const selectedKeys = new Set(
    (Array.isArray(query.selectedKeys) ? query.selectedKeys : String(query.selectedKeys ?? '').split(','))
      .map((k) => text(k).toLowerCase())
      .filter(Boolean),
  )

  let req = pool.request()
    .input('warehouseCode', sql.NVarChar(200), warehouseCode)
    .input('startRow', sql.Int, startRow)
    .input('endRow', sql.Int, endRow)
  if (keyword) req = req.input('keyword', sql.NVarChar(400), `%${keyword}%`)

  const r = await req.query(buildOtherInboundBatchListSql({ keyword }))
  const rawRows = r.recordset ?? []
  const total = rawRows.length > 0 ? Number(rawRows[0].totalCount ?? 0) : 0
  const list = rawRows.map((row) => {
    const key = (text(row.systemcode) || text(row.GUID) || text(row.kcaa01)).toLowerCase()
    return enrichOtherInboundBatchRow(row, selectedKeys.has(key))
  })
  return { ok: true, list, total, page, pageSize, warehouseCode }
}

export { parseSurplusBatchPage as parseOtherInboundBatchPage }
