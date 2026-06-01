/**
 * BOM 用量表运算：Bom_parts 树构建（批量预取层数据，避免逐父节点 N+1 查询）
 */
import sql from 'mssql'
import { INV_BOM_PARTS_FROM, INV_BOM_PARTS_TABLE } from './bomTables.js'

/** 与 index.js bomPartsNumericColAsDecimalSql 一致 */
const BOM_PARTS_KCAC01_EXPR = `LTRIM(RTRIM(ISNULL(CAST(p.kcac01 AS nvarchar(500)), N'')))`

/** 单层批量 IN 查询上限 */
export const BOM_USAGE_TREE_LAYER_BATCH_SIZE = 80

/**
 * @param {string} colExpr
 */
function bomPartsNumericColAsDecimalSql(colExpr) {
  const c = String(colExpr ?? '').trim()
  return `CAST(ISNULL(${c}, 0) AS decimal(18, 6))`
}

/**
 * @param {string} raw
 */
export function normalizeUsageTreeParentKey(raw) {
  return String(raw ?? '').trim()
}

/**
 * @param {import('mssql').ConnectionPool} pool
 * @param {string} kcac01Parent
 */
export async function fetchBomPartsLayerForUsageTree(pool, kcac01Parent) {
  const map = await fetchBomPartsLayersBatchForUsageTree(pool, [kcac01Parent])
  const parent = normalizeUsageTreeParentKey(kcac01Parent)
  return map.get(parent) ?? []
}

/**
 * 批量读取多个父 systemcode 下的配件层（按父分组、组内 Seq/id 排序与单层查询一致）
 * @param {import('mssql').ConnectionPool} pool
 * @param {string[]} kcac01Parents
 * @returns {Promise<Map<string, Record<string, unknown>[]>>}
 */
export async function fetchBomPartsLayersBatchForUsageTree(pool, kcac01Parents) {
  /** @type {Map<string, Record<string, unknown>[]>} */
  const out = new Map()
  const uniq = [
    ...new Set(kcac01Parents.map((p) => normalizeUsageTreeParentKey(p)).filter(Boolean)),
  ]
  if (!uniq.length) return out

  const chunkSize = BOM_USAGE_TREE_LAYER_BATCH_SIZE
  for (let i = 0; i < uniq.length; i += chunkSize) {
    const chunk = uniq.slice(i, i + chunkSize)
    const rq = pool.request()
    const orParts = []
    for (let j = 0; j < chunk.length; j++) {
      const pname = `pp${i}_${j}`
      rq.input(pname, sql.NVarChar(500), chunk[j])
      orParts.push(`${BOM_PARTS_KCAC01_EXPR} = @${pname}`)
    }
    const r = await rq.query(`
      SELECT
        ${BOM_PARTS_KCAC01_EXPR} AS kcac01_parent,
        p.id,
        LTRIM(RTRIM(ISNULL(CAST(p.kcac01 AS nvarchar(500)), N''))) AS kcac01,
        LTRIM(RTRIM(ISNULL(CAST(p.kcac02 AS nvarchar(500)), N''))) AS kcac02,
        LTRIM(RTRIM(CONVERT(nvarchar(300), ISNULL(p.kcaa01, N'')))) AS kcaa01,
        LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(p.kcaa02, N'')))) AS kcaa02,
        LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(p.kcaa03, N'')))) AS kcaa03,
        LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(p.kcaa04, N'')))) AS kcaa04,
        ${bomPartsNumericColAsDecimalSql('p.kcac04')} AS kcac04,
        ${bomPartsNumericColAsDecimalSql('p.kcac05')} AS kcac05,
        ${bomPartsNumericColAsDecimalSql('p.kcaa33')} AS kcaa33,
        CONVERT(int, ISNULL(p.kcaa13, 0)) AS kcaa13,
        LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(p.[Describe], N'')))) AS [Describe],
        p.[Seq] AS [Seq],
        LTRIM(RTRIM(ISNULL(CAST(p.systemcode AS nvarchar(500)), N''))) AS systemcode
      FROM ${INV_BOM_PARTS_FROM} AS p
      WHERE ${orParts.join(' OR ')}
      ORDER BY kcac01_parent,
        CASE WHEN p.[Seq] IS NULL THEN 1 ELSE 0 END,
        p.[Seq],
        p.id
    `)
    for (const row of r.recordset ?? []) {
      const parent = normalizeUsageTreeParentKey(row.kcac01_parent)
      if (!parent) continue
      if (!out.has(parent)) out.set(parent, [])
      out.get(parent).push(row)
    }
  }

  for (const p of uniq) {
    if (!out.has(p)) out.set(p, [])
  }
  return out
}

/**
 * BFS 预取子树全部层（按 kcac02 展开；已缓存的父不再查库）
 * @param {import('mssql').ConnectionPool} pool
 * @param {string} rootSystemcode
 * @returns {Promise<Map<string, Record<string, unknown>[]>>}
 */
export async function prefetchBomPartsLayersForUsageTree(pool, rootSystemcode) {
  const root = normalizeUsageTreeParentKey(rootSystemcode)
  /** @type {Map<string, Record<string, unknown>[]>} */
  const cache = new Map()
  if (!root) return cache

  /** @type {Set<string>} */
  const pending = new Set([root])

  while (pending.size > 0) {
    const batch = [...pending].slice(0, BOM_USAGE_TREE_LAYER_BATCH_SIZE)
    for (const p of batch) pending.delete(p)

    const fetched = await fetchBomPartsLayersBatchForUsageTree(pool, batch)
    for (const [parent, rows] of fetched) {
      cache.set(parent, rows)
      for (const row of rows) {
        const child = normalizeUsageTreeParentKey(row.kcac02)
        if (child && !cache.has(child)) pending.add(child)
      }
    }
  }

  return cache
}

/**
 * @param {Record<string, unknown>} row
 * @param {number} level
 * @param {any[]} children
 */
export function mapBomPartsRowToUsageTreeNode(row, level, children) {
  const dVal = row.Describe != null ? String(row.Describe) : row.describe != null ? String(row.describe) : ''
  const seqRaw = row.Seq != null ? row.Seq : row.seq
  const seqNum = seqRaw != null && seqRaw !== '' && Number.isFinite(Number(seqRaw)) ? Number(seqRaw) : null
  return {
    id: row.id != null ? Number(row.id) : null,
    kcaa01: row.kcaa01 != null ? String(row.kcaa01) : '',
    kcaa02: row.kcaa02 != null ? String(row.kcaa02) : '',
    kcaa03: row.kcaa03 != null ? String(row.kcaa03) : '',
    kcaa04: row.kcaa04 != null ? String(row.kcaa04) : '',
    kcac01: row.kcac01 != null ? String(row.kcac01) : '',
    kcac02: row.kcac02 != null ? String(row.kcac02) : '',
    kcac04: Number(row.kcac04 ?? 0),
    kcac05: Number(row.kcac05 ?? 0),
    kcaa33: Number(row.kcaa33 ?? 0),
    kcaa13: Number(row.kcaa13 ?? 0) === 1 ? 1 : 0,
    Describe: dVal,
    Seq: seqNum,
    level,
    systemcode: row.systemcode != null ? String(row.systemcode) : '',
    children,
    /** 原始 Bom_parts 行（PI BOM 写入 UB_ERP_Bom_Sales_list 时按列快照） */
    _sourceRow: row,
  }
}

/**
 * 由已预取的层数据递归建树（DFS 顺序与旧版逐层查询一致）
 * @param {string} kcac01Parent
 * @param {number} level
 * @param {Set<string>} bomHeadStack
 * @param {Map<string, Record<string, unknown>[]>} layerCache
 */
export function buildBomPartsUsageTreeNodesFromLayerCache(
  kcac01Parent,
  level,
  bomHeadStack,
  layerCache,
) {
  const parent = normalizeUsageTreeParentKey(kcac01Parent)
  const rows = layerCache.get(parent) ?? []
  const out = []
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    const childSc = normalizeUsageTreeParentKey(row.kcac02)
    /** @type {any[]} */
    let children = []
    if (childSc) {
      if (bomHeadStack.has(childSc)) {
        const err = new Error('检测到BOM循环引用')
        err.code = 'BOM_CYCLE'
        throw err
      }
      const nextStack = new Set(bomHeadStack)
      nextStack.add(childSc)
      children = buildBomPartsUsageTreeNodesFromLayerCache(childSc, level + 1, nextStack, layerCache)
    }
    out.push(mapBomPartsRowToUsageTreeNode(row, level, children))
  }
  return out
}

/**
 * 递归构建 Bom_parts 树（先 BFS 批量预取，再内存 DFS）
 * @param {import('mssql').ConnectionPool} pool
 * @param {string} kcac01Parent
 * @param {number} level 根层为 1
 * @param {Set<string>} bomHeadStack
 */
export async function buildBomPartsUsageTreeNodes(pool, kcac01Parent, level, bomHeadStack) {
  const root = normalizeUsageTreeParentKey(kcac01Parent)
  const t0 = Date.now()
  const layerCache = await prefetchBomPartsLayersForUsageTree(pool, root)
  const tree = buildBomPartsUsageTreeNodesFromLayerCache(root, level, bomHeadStack, layerCache)
  console.log(
    '[bom-usage-tree]',
    JSON.stringify({
      root,
      layerParents: layerCache.size,
      ms: Date.now() - t0,
    }),
  )
  return tree
}
