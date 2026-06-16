/**
 * 外协订单明细保存：按外协类型从 PI BOM / UB_ERP_Bom_000 回查物料快照（kcaa01～kcaa35）
 */
import { sql } from './db.js'
import { INV_BOM_MASTER_FROM } from './bomTables.js'
import { normKcaa01 } from './salesOrderSaveLogic.js'
import { fetchBom000SnapshotForLine } from './salesOrderSaveService.js'
import { mapBom000ExtendedSnapshotRow, parseSnapshotIntOrNull } from './salesOrderLineBom000Snapshot.js'
import { bomCostParseDecimal6OrNull } from './bomCostEnrichFromBom000.js'

const PI_BOM_LIST_FROM = 'dbo.[UB_ERP_Bom_Sales_list]'
const PI_BOM_HEAD_FROM = 'dbo.[UB_ERP_Bom_Sales]'

const DECIMAL_KCAA = new Set(['kcaa07', 'kcaa08', 'kcaa19', 'kcaa22', 'kcaa23', 'kcaa24', 'kcaa26', 'kcaa30', 'kcaa32', 'kcaa33'])
const INT_KCAA = new Set(['kcaa12', 'kcaa13', 'kcaa14'])

export const ASSIST_LINE_KCAA_SNAPSHOT_FIELDS = Array.from({ length: 35 }, (_, i) =>
  `kcaa${String(i + 1).padStart(2, '0')}`,
)

function text(value) {
  return String(value ?? '').trim()
}

function snapshotSelectList(alias) {
  return ASSIST_LINE_KCAA_SNAPSHOT_FIELDS.map((col) => `${alias}.[${col}] AS ${col}`).join(',\n        ')
}

function parseKcaaCell(col, raw) {
  if (raw === null || raw === undefined || raw === '') {
    return INT_KCAA.has(col) ? null : ''
  }
  if (INT_KCAA.has(col)) return parseSnapshotIntOrNull(raw)
  if (DECIMAL_KCAA.has(col)) return bomCostParseDecimal6OrNull(raw)
  return text(raw)
}

/** @param {Record<string, unknown> | null | undefined} row */
export function mapAssistOrderBomSnapshotRow(row) {
  if (!row) return null
  const extended = mapBom000ExtendedSnapshotRow(row)
  /** @type {Record<string, unknown>} */
  const out = {
    kcaa02En: text(row.kcaa02_en ?? row.kcaa02En ?? extended.kcaa02_en),
    invoiceName: text(row.kpname ?? row.invoiceName),
    version: parseSnapshotIntOrNull(row.version),
    customerSupply: parseSnapshotIntOrNull(row.Customer_supply ?? row.customerSupply),
    type: extended.type ?? parseSnapshotIntOrNull(row.type) ?? 1,
    location: text(row.location),
    salePrice: bomCostParseDecimal6OrNull(row.sale_price),
    costPrice: bomCostParseDecimal6OrNull(row.cost_price),
    customerName: text(row.Customer_Name ?? row.customerName),
    snapshotRemark: text(row.remark),
  }
  for (const col of ASSIST_LINE_KCAA_SNAPSHOT_FIELDS) {
    out[col] = parseKcaaCell(col, row[col])
  }
  if (extended.kcaa02_en) out.kcaa02En = extended.kcaa02_en
  if (extended.kcaa12 != null) out.kcaa12 = extended.kcaa12
  if (extended.kcaa32 != null) out.kcaa32 = extended.kcaa32
  if (extended.kcaa33 != null) out.kcaa33 = extended.kcaa33
  if (extended.kcaa34) out.kcaa34 = extended.kcaa34
  if (extended.kcaa35) out.kcaa35 = extended.kcaa35
  if (extended.sale_price != null) out.salePrice = extended.sale_price
  if (extended.cost_price != null) out.costPrice = extended.cost_price
  if (extended.type != null) out.type = extended.type
  return out
}

/** @param {Record<string, unknown>} line @param {ReturnType<typeof mapAssistOrderBomSnapshotRow>} snapshot */
export function mergeBomSnapshotIntoAssistLine(line, snapshot) {
  if (!snapshot) return line
  const merged = { ...line }
  for (const col of ASSIST_LINE_KCAA_SNAPSHOT_FIELDS) {
    const snapVal = snapshot[col]
    if (snapVal !== null && snapVal !== undefined && String(snapVal).trim() !== '') {
      merged[col] = snapVal
    } else if (INT_KCAA.has(col) && snapVal != null) {
      merged[col] = snapVal
    } else if (DECIMAL_KCAA.has(col) && snapVal != null) {
      merged[col] = snapVal
    }
  }
  if (snapshot.kcaa02En) merged.kcaa02En = snapshot.kcaa02En
  if (snapshot.invoiceName) merged.invoiceName = snapshot.invoiceName
  if (snapshot.version != null) merged.version = snapshot.version
  if (snapshot.customerSupply != null) merged.customerSupply = snapshot.customerSupply
  if (snapshot.type != null) merged.type = snapshot.type
  if (snapshot.location) merged.location = snapshot.location
  if (snapshot.salePrice != null) merged.salePrice = snapshot.salePrice
  if (snapshot.costPrice != null) merged.costPrice = snapshot.costPrice
  if (snapshot.customerName) merged.customerName = snapshot.customerName
  if (snapshot.snapshotRemark) merged.snapshotRemark = snapshot.snapshotRemark
  return merged
}

async function fetchFromBomSalesList(db, referenceNo, product, kcaa01) {
  const ref = text(referenceNo)
  const mat = normKcaa01(kcaa01)
  const prod = normKcaa01(product)
  if (!ref || !mat) return null

  const req = new sql.Request(db)
  req.input('referenceNo', sql.NVarChar(200), ref)
  req.input('kcaa01', sql.NVarChar(300), mat)
  let productSql = ''
  if (prod) {
    req.input('product', sql.NVarChar(300), prod)
    productSql = `
      AND LTRIM(RTRIM(CONVERT(nvarchar(300), ISNULL(src.[pkcaa01], N'')))) = @product
    `
  }
  const r = await req.query(`
    SELECT TOP 1
      ${snapshotSelectList('src')},
      LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(src.[kpname], N'')))) AS kpname,
      LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(src.[kcaa02_en], N'')))) AS kcaa02_en,
      src.[version] AS version,
      src.[Customer_supply] AS Customer_supply,
      src.[type] AS type,
      LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(src.[location], N'')))) AS location,
      src.[sale_price] AS sale_price,
      src.[cost_price] AS cost_price,
      LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(src.[Customer_Name], N'')))) AS Customer_Name,
      CONVERT(nvarchar(max), ISNULL(src.[remark], N'')) AS remark
    FROM ${PI_BOM_LIST_FROM} AS src
    WHERE LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(src.[sid], N'')))) = @referenceNo
      AND LTRIM(RTRIM(CONVERT(nvarchar(300), ISNULL(src.[kcaa01], N'')))) = @kcaa01
      AND (ISNULL(src.[del], N'') = N'' OR src.[del] = N'0')
      ${productSql}
    ORDER BY src.[id] ASC
  `)
  return mapAssistOrderBomSnapshotRow(r.recordset?.[0])
}

async function fetchFromBomSales(db, referenceNo, kcaa01) {
  const ref = text(referenceNo)
  const code = normKcaa01(kcaa01)
  if (!ref || !code) return null

  const r = await new sql.Request(db)
    .input('referenceNo', sql.NVarChar(200), ref)
    .input('kcaa01', sql.NVarChar(300), code)
    .query(`
      SELECT TOP 1
        ${snapshotSelectList('src')},
        LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(src.[kpname], N'')))) AS kpname,
        LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(src.[kcaa02_en], N'')))) AS kcaa02_en,
        src.[version] AS version,
        src.[Customer_supply] AS Customer_supply,
        src.[type] AS type,
        LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(src.[location], N'')))) AS location,
        src.[sale_price] AS sale_price,
      src.[cost_price] AS cost_price,
      LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(src.[Customer_Name], N'')))) AS Customer_Name,
      CONVERT(nvarchar(max), ISNULL(src.[remark], N'')) AS remark
    FROM ${PI_BOM_HEAD_FROM} AS src
      WHERE LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(src.[sid], N'')))) = @referenceNo
        AND LTRIM(RTRIM(CONVERT(nvarchar(300), ISNULL(src.[kcaa01], N'')))) = @kcaa01
        AND (ISNULL(src.[del], N'') = N'' OR src.[del] = N'0')
      ORDER BY src.[id] ASC
    `)
  return mapAssistOrderBomSnapshotRow(r.recordset?.[0])
}

async function fetchFromBom000(db, kcaa01) {
  const code = normKcaa01(kcaa01)
  if (!code) return null
  const row = await fetchBom000SnapshotForLine(db, code)
  if (!row) return null
  return mapAssistOrderBomSnapshotRow({
    ...row,
    kpname: row.kpname,
    kcaa02_en: row.kcaa02_en,
    Customer_supply: row.Customer_supply,
    sale_price: row.sale_price,
    cost_price: row.cost_price,
  })
}

/**
 * @param {import('mssql').ConnectionPool | import('mssql').Transaction} db
 * @param {{ assistType?: string, referenceNo?: string, product?: string, kcaa01?: string }} opts
 */
export async function fetchAssistOrderLineBomSnapshot(db, opts) {
  const assistType = text(opts?.assistType ?? '0') || '0'
  const referenceNo = text(opts?.referenceNo)
  const product = text(opts?.product)
  const kcaa01 = normKcaa01(opts?.kcaa01)
  if (!kcaa01) return null

  if (assistType === '1' || assistType === '2') {
    const fromList = await fetchFromBomSalesList(db, referenceNo, product, kcaa01)
    if (fromList) return fromList
    if (assistType === '2') {
      const headCode = normKcaa01(product || kcaa01)
      const fromHead = await fetchFromBomSales(db, referenceNo, headCode)
      if (fromHead) return fromHead
    }
  }

  return fetchFromBom000(db, kcaa01)
}

/**
 * 按 kcaa01 查 UB_ERP_Bom_000 行级 GUID 与 Customer_Name（明细 wxak02/GUID/systemcode 与 Customer_Name 兜底）
 * @param {import('mssql').ConnectionPool | import('mssql').Transaction} db
 * @param {string} kcaa01
 * @returns {Promise<{ bomGuid: string, customerName: string } | null>}
 */
export async function fetchAssistLineBom000Keys(db, kcaa01) {
  const code = normKcaa01(kcaa01)
  if (!code) return null

  const r = await new sql.Request(db)
    .input('kcaa01', sql.NVarChar(300), code)
    .query(`
      SELECT TOP 1
        LTRIM(RTRIM(ISNULL(CAST(b.[GUID] AS nvarchar(500)), N''))) AS bomGuid,
        LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(b.[Customer_Name], N'')))) AS customerName
      FROM ${INV_BOM_MASTER_FROM} AS b
      WHERE LTRIM(RTRIM(CONVERT(nvarchar(300), ISNULL(b.[kcaa01], N'')))) = @kcaa01
        AND (ISNULL(b.[del], N'') = N'' OR b.[del] = N'0')
      ORDER BY b.[id] DESC
    `)
  const row = r.recordset?.[0]
  if (!row) return null
  const bomGuid = text(row.bomGuid)
  return {
    bomGuid,
    customerName: text(row.customerName),
  }
}
