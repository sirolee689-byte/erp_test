/**
 * 销售订单 PI BOM 用量树（只读 UB_ERP_Bom_Sales_list，禁止拉主 BOM）
 */
import sql from 'mssql'
import { normalizeUsageTreeParentKey } from './bomUsageTreeBuild.js'
import { PI_BOM_MAX_DEPTH } from './salesOrderPiBom.js'
import { normKcaa01 } from './salesOrderSaveLogic.js'

const PI_BOM_LIST_FROM = 'dbo.[UB_ERP_Bom_Sales_list]'
const PI_BOM_HEAD_FROM = 'dbo.[UB_ERP_Bom_Sales]'
const PI_LIST_KCAC01_EXPR = `LTRIM(RTRIM(ISNULL(CAST(l.[kcac01] AS nvarchar(500)), N'')))`

const LAYER_BATCH = 80

/**
 * @param {import('mssql').ConnectionPool | import('mssql').Transaction} db
 * @param {string} piNo
 * @param {string[]} parentCodes
 */
export async function prefetchPiBomListLayers(db, piNo, parentCodes) {
  /** @type {Map<string, Record<string, unknown>[]>} */
  const out = new Map()
  const pi = normKcaa01(piNo)
  const uniq = [...new Set(parentCodes.map((p) => normalizeUsageTreeParentKey(p)).filter(Boolean))]
  if (!uniq.length) return out

  for (let i = 0; i < uniq.length; i += LAYER_BATCH) {
    const chunk = uniq.slice(i, i + LAYER_BATCH)
    const req = new sql.Request(db)
    req.input('pi', sql.NVarChar(200), pi)
    const orParts = []
    for (let j = 0; j < chunk.length; j++) {
      const pname = `pp${i}_${j}`
      req.input(pname, sql.NVarChar(500), chunk[j])
      orParts.push(`${PI_LIST_KCAC01_EXPR} = @${pname}`)
    }
    const r = await req.query(`
      SELECT
        ${PI_LIST_KCAC01_EXPR} AS kcac01_parent,
        l.[id],
        LTRIM(RTRIM(ISNULL(CAST(l.[systemcode] AS nvarchar(500)), N''))) AS systemcode,
        LTRIM(RTRIM(CONVERT(nvarchar(300), ISNULL(l.[kcaa01], N'')))) AS kcaa01,
        CAST(ISNULL(l.[kcac04], 0) AS decimal(18, 6)) AS kcac04,
        CAST(ISNULL(l.[kcac05], 0) AS decimal(18, 6)) AS kcac05,
        CONVERT(int, ISNULL(l.[seq], 0)) AS seq,
        LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(l.[Describe], N'')))) AS Describe
      FROM ${PI_BOM_LIST_FROM} AS l
      WHERE LTRIM(RTRIM(ISNULL(l.[sid], N''))) = @pi
        AND (${orParts.join(' OR ')})
      ORDER BY ${PI_LIST_KCAC01_EXPR}, ISNULL(l.[seq], l.[id]) ASC
    `)
    for (const row of r.recordset ?? []) {
      const parent = normalizeUsageTreeParentKey(row.kcac01_parent)
      if (!parent) continue
      if (!out.has(parent)) out.set(parent, [])
      out.get(parent).push(row)
    }
  }
  return out
}

/**
 * @param {Record<string, unknown>} row
 * @param {number} level
 * @param {any[]} children
 */
function mapPiBomRowToUsageTreeNode(row, level, children) {
  const seqRaw = row.seq
  const seqNum = seqRaw != null && Number.isFinite(Number(seqRaw)) ? Number(seqRaw) : null
  return {
    id: row.id != null ? Number(row.id) : null,
    kcaa01: row.kcaa01 != null ? String(row.kcaa01) : '',
    kcaa02: '',
    kcaa03: '',
    kcaa04: '',
    kcac04: Number(row.kcac04 ?? 0),
    kcac05: Number(row.kcac05 ?? 0),
    kcaa33: 0,
    Describe: row.Describe != null ? String(row.Describe) : '',
    Seq: seqNum,
    level,
    systemcode: row.systemcode != null ? String(row.systemcode) : '',
    children,
  }
}

/**
 * @param {string} parentSc
 * @param {number} level
 * @param {Set<string>} stack
 * @param {Map<string, Record<string, unknown>[]>} layerCache
 * @param {string} productKcaa01
 */
export function buildPiBomUsageTreeNodesFromLayerCache(
  parentSc,
  level,
  stack,
  layerCache,
  productKcaa01,
) {
  if (level > PI_BOM_MAX_DEPTH) {
    const err = new Error(`货品 ${productKcaa01} 的 PI BOM 超过 ${PI_BOM_MAX_DEPTH} 层，无法运算`)
    err.code = 'BOM_DEPTH'
    throw err
  }
  const parent = normalizeUsageTreeParentKey(parentSc)
  const rows = layerCache.get(parent) ?? []
  const out = []
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    const childSc = normalizeUsageTreeParentKey(row.systemcode)
    /** @type {any[]} */
    let children = []
    if (childSc) {
      if (stack.has(childSc)) {
        const err = new Error(`货品 ${productKcaa01} 的 PI BOM 存在循环引用`)
        err.code = 'BOM_CYCLE'
        throw err
      }
      const nextStack = new Set(stack)
      nextStack.add(childSc)
      children = buildPiBomUsageTreeNodesFromLayerCache(
        childSc,
        level + 1,
        nextStack,
        layerCache,
        productKcaa01,
      )
    }
    out.push(mapPiBomRowToUsageTreeNode(row, level, children))
  }
  return out
}

/**
 * @param {import('mssql').ConnectionPool} pool
 * @param {string} piNo
 * @param {string} productKcaa01
 */
export async function fetchPiBomHeadSystemcode(pool, piNo, productKcaa01) {
  const pi = normKcaa01(piNo)
  const product = normKcaa01(productKcaa01)
  const r = await pool
    .request()
    .input('pi', sql.NVarChar(200), pi)
    .input('product', sql.NVarChar(300), product)
    .query(`
      SELECT TOP 1 LTRIM(RTRIM(ISNULL(CAST(h.[systemcode] AS nvarchar(500)), N''))) AS systemcode
      FROM ${PI_BOM_HEAD_FROM} AS h
      WHERE LTRIM(RTRIM(ISNULL(h.[sid], N''))) = @pi
        AND LTRIM(RTRIM(CONVERT(nvarchar(300), ISNULL(h.[kcaa01], N'')))) = @product
    `)
  return normalizeUsageTreeParentKey(r.recordset?.[0]?.systemcode)
}

/**
 * @param {import('mssql').ConnectionPool} pool
 * @param {string} piNo
 * @param {string} productKcaa01
 */
export async function buildPiBomUsageTreeForProduct(pool, piNo, productKcaa01) {
  const headSc = await fetchPiBomHeadSystemcode(pool, piNo, productKcaa01)
  if (!headSc) {
    const err = new Error(`货品 ${productKcaa01} 未建立 PI BOM，无法运算`)
    err.code = 'PI_BOM_MISSING'
    throw err
  }
  const layerCache = await prefetchPiBomListLayers(pool, piNo, [headSc])
  const stack = new Set([headSc])
  return buildPiBomUsageTreeNodesFromLayerCache(headSc, 1, stack, layerCache, productKcaa01)
}
