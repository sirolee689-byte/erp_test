/**
 * 销售订单 PI BOM 用量树（只读 UB_ERP_Bom_Sales_list，禁止拉主 BOM）
 */
import sql from 'mssql'
import {
  BOM_USAGE_TREE_LAYER_BATCH_SIZE,
  normalizeUsageTreeParentKey,
  usageTreeChildParentKey,
} from './bomUsageTreeBuild.js'
import {
  fetchMasterBomVirtualRootQtyUnderHead,
  fetchPiBomListSkipBomCodePrefixes,
  parsePiBomVirtualRootQtyInfo,
  PI_LIST_PKCAA01_EXPR,
} from './salesOrderPiBom.js'
import { normKcaa01 } from './salesOrderSaveLogic.js'

const PI_BOM_LIST_FROM = 'dbo.[UB_ERP_Bom_Sales_list]'
const PI_BOM_HEAD_FROM = 'dbo.[UB_ERP_Bom_Sales]'
const PI_LIST_KCAC01_EXPR = `LTRIM(RTRIM(ISNULL(CAST(l.[kcac01] AS nvarchar(500)), N'')))`
const PI_LIST_KCAC02_EXPR = `LTRIM(RTRIM(ISNULL(CAST(l.[kcac02] AS nvarchar(500)), N'')))`

const LAYER_BATCH = BOM_USAGE_TREE_LAYER_BATCH_SIZE

/**
 * @param {import('mssql').ConnectionPool | import('mssql').Transaction} db
 * @param {string} piNo
 * @param {string[]} parentCodes
 * @param {string} productKcaa01 订单明细款号（pkcaa01 过滤，多明细 PI 隔离）
 */
export async function prefetchPiBomListLayers(db, piNo, parentCodes, productKcaa01) {
  /** @type {Map<string, Record<string, unknown>[]>} */
  const out = new Map()
  const pi = normKcaa01(piNo)
  const product = normKcaa01(productKcaa01)
  const uniq = [...new Set(parentCodes.map((p) => normalizeUsageTreeParentKey(p)).filter(Boolean))]
  if (!uniq.length || !product) return out

  for (let i = 0; i < uniq.length; i += LAYER_BATCH) {
    const chunk = uniq.slice(i, i + LAYER_BATCH)
    const req = new sql.Request(db)
    req.input('pi', sql.NVarChar(200), pi)
    req.input('product', sql.NVarChar(300), product)
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
        ${PI_LIST_KCAC01_EXPR} AS kcac01,
        ${PI_LIST_KCAC02_EXPR} AS kcac02,
        LTRIM(RTRIM(ISNULL(CAST(l.[systemcode] AS nvarchar(500)), N''))) AS systemcode,
        LTRIM(RTRIM(CONVERT(nvarchar(300), ISNULL(l.[kcaa01], N'')))) AS kcaa01,
        LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(l.[kcaa02], N'')))) AS kcaa02,
        LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(l.[kcaa03], N'')))) AS kcaa03,
        LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(l.[kcaa04], N'')))) AS kcaa04,
        LTRIM(RTRIM(CONVERT(nvarchar(300), ISNULL(l.[kcaa05], N'')))) AS kcaa05,
        LTRIM(RTRIM(CONVERT(nvarchar(300), ISNULL(l.[kcaa06], N'')))) AS kcaa06,
        LTRIM(RTRIM(CONVERT(nvarchar(300), ISNULL(l.[kcaa09], N'')))) AS kcaa09,
        LTRIM(RTRIM(CONVERT(nvarchar(300), ISNULL(l.[kcaa10], N'')))) AS kcaa10,
        LTRIM(RTRIM(CONVERT(nvarchar(300), ISNULL(l.[kcaa11], N'')))) AS kcaa11,
        l.[kcaa07] AS kcaa07,
        l.[kcaa08] AS kcaa08,
        l.[kcaa14] AS kcaa14,
        LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(l.[kcaa15], N'')))) AS kcaa15,
        LTRIM(RTRIM(CONVERT(nvarchar(300), ISNULL(l.[kcaa25], N'')))) AS kcaa25,
        l.[kcaa26] AS kcaa26,
        LTRIM(RTRIM(CONVERT(nvarchar(300), ISNULL(l.[kcaa27], N'')))) AS kcaa27,
        CAST(ISNULL(l.[kcac04], 0) AS decimal(18, 6)) AS kcac04,
        CAST(ISNULL(l.[kcac05], 0) AS decimal(18, 6)) AS kcac05,
        CAST(ISNULL(l.[kcaa33], 0) AS decimal(18, 6)) AS kcaa33,
        CONVERT(int, ISNULL(l.[seq], 0)) AS seq,
        LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(l.[Describe], N'')))) AS Describe
      FROM ${PI_BOM_LIST_FROM} AS l
      WHERE LTRIM(RTRIM(ISNULL(l.[sid], N''))) = @pi
        AND ${PI_LIST_PKCAA01_EXPR} = @product
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
  const kcaa07 =
    row.kcaa07 != null && row.kcaa07 !== '' && Number.isFinite(Number(row.kcaa07))
      ? Number(row.kcaa07)
      : null
  const kcaa08 =
    row.kcaa08 != null && row.kcaa08 !== '' && Number.isFinite(Number(row.kcaa08))
      ? Number(row.kcaa08)
      : null
  const kcaa14 =
    row.kcaa14 != null && row.kcaa14 !== '' && Number.isFinite(Number(row.kcaa14))
      ? Math.trunc(Number(row.kcaa14))
      : null
  const kcaa26 =
    row.kcaa26 != null && row.kcaa26 !== '' && Number.isFinite(Number(row.kcaa26))
      ? Number(row.kcaa26)
      : null
  return {
    id: row.id != null ? Number(row.id) : null,
    kcaa01: row.kcaa01 != null ? String(row.kcaa01) : '',
    kcaa02: row.kcaa02 != null ? String(row.kcaa02) : '',
    kcaa03: row.kcaa03 != null ? String(row.kcaa03) : '',
    kcaa04: row.kcaa04 != null ? String(row.kcaa04) : '',
    kcaa05: row.kcaa05 != null ? String(row.kcaa05) : '',
    kcaa06: row.kcaa06 != null ? String(row.kcaa06) : '',
    kcaa07: row.kcaa07 != null ? String(row.kcaa07) : '',
    kcaa08: row.kcaa08 != null ? String(row.kcaa08) : '',
    kcaa09: row.kcaa09 != null ? String(row.kcaa09) : '',
    kcaa10: row.kcaa10 != null ? String(row.kcaa10) : '',
    kcaa11: row.kcaa11 != null ? String(row.kcaa11) : '',
    kcaa07,
    kcaa08,
    kcaa14,
    kcaa15: row.kcaa15 != null ? String(row.kcaa15) : '',
    kcaa25: row.kcaa25 != null ? String(row.kcaa25) : '',
    kcaa26,
    kcaa27: row.kcaa27 != null ? String(row.kcaa27) : '',
    kcac04: Number(row.kcac04 ?? 0),
    kcac05: Number(row.kcac05 ?? 0),
    kcaa33: Number(row.kcaa33 ?? 0),
    Describe: row.Describe != null ? String(row.Describe) : '',
    Seq: seqNum,
    level,
    kcac01: row.kcac01 != null ? String(row.kcac01) : '',
    kcac02: row.kcac02 != null ? String(row.kcac02) : '',
    systemcode: row.systemcode != null ? String(row.systemcode) : '',
    children,
  }
}

/**
 * 由已预取的层数据递归建 PI BOM 展示树（DFS 与 BOM 用量表运算 buildBomPartsUsageTreeNodesFromLayerCache 一致）
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
  const parent = normalizeUsageTreeParentKey(parentSc)
  const rows = layerCache.get(parent) ?? []
  const out = []
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    const childSc = usageTreeChildParentKey(row)
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
 * 从 Sales_list 行推导用量树根父键：头下无子行时用虚拟根（BAG/TAG/RMP expand key）
 * @param {string} headSc UB_ERP_Bom_Sales.systemcode
 * @param {Array<{ kcac01?: unknown, kcac02?: unknown, systemcode?: unknown, seq?: unknown, id?: unknown }>} listRows
 * @returns {string[]}
 */
export function resolvePiBomUsageTreeRootKeys(headSc, listRows) {
  const head = normalizeUsageTreeParentKey(headSc)
  if (!head) return []

  const rows = Array.isArray(listRows) ? listRows : []
  const hasHeadChildren = rows.some(
    (row) => normalizeUsageTreeParentKey(row?.kcac01) === head,
  )
  if (hasHeadChildren) return [head]

  /** @type {Set<string>} */
  const expandKeys = new Set()
  for (let i = 0; i < rows.length; i++) {
    const ek = usageTreeChildParentKey(rows[i])
    if (ek) expandKeys.add(ek)
  }

  /** @type {Map<string, number>} */
  const orderHint = new Map()
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    const parentKey = normalizeUsageTreeParentKey(row?.kcac01)
    if (!parentKey || parentKey === head || expandKeys.has(parentKey)) continue
    const seqRaw = row?.seq
    const hint =
      seqRaw != null && Number.isFinite(Number(seqRaw))
        ? Number(seqRaw)
        : row?.id != null && Number.isFinite(Number(row.id))
          ? Number(row.id)
          : 0
    const prev = orderHint.get(parentKey)
    if (prev == null || hint < prev) orderHint.set(parentKey, hint)
  }

  return [...orderHint.entries()]
    .sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0]))
    .map(([key]) => key)
}

/**
 * 虚拟根下无 BAG/TAG/RMP 父行时，按首层 CUT 子件推断顶级成品编码（仅树包装，不写库）
 * @param {any[]} children
 * @param {string} productKcaa01
 */
/**
 * @param {string} kcaa01 推断的 BAG/TAG/RMP 编码
 * @param {Map<string, { kcac04: number, kcac05: number }> | null | undefined} qtyByKcaa01
 */
export function resolveSyntheticTopLevelUsage(kcaa01, qtyByKcaa01) {
  const code = normKcaa01(kcaa01)
  let hit = code && qtyByKcaa01 ? qtyByKcaa01.get(code) : undefined
  if (!hit && code && qtyByKcaa01) {
    const dash = code.indexOf('-')
    if (dash > 0) hit = qtyByKcaa01.get(code.slice(0, dash + 1))
  }
  if (hit) {
    return {
      kcac04: Number.isFinite(hit.kcac04) ? hit.kcac04 : 1,
      kcac05: Number.isFinite(hit.kcac05) ? hit.kcac05 : 0,
    }
  }
  return { kcac04: 1, kcac05: 0 }
}

/**
 * @param {any[]} children
 * @param {string} productKcaa01
 * @param {Map<string, { kcac04: number, kcac05: number }> | null | undefined} [qtyByKcaa01]
 */
export function inferVirtualRootTopLevelMeta(children, productKcaa01, qtyByKcaa01) {
  const product = String(productKcaa01 ?? '').trim().toUpperCase()
  const suffix = product.startsWith('PQ-') ? `PQ${product.slice(3)}` : product
  const first = String(children[0]?.kcaa01 ?? '').trim().toUpperCase()
  let inferredKcaa01 = ''
  if (first.includes('CUT-BAG') || first.startsWith('BAG-')) {
    inferredKcaa01 = `BAG-${suffix}`
  } else if (first.includes('CUT-TAG') || first.startsWith('TAG-')) {
    inferredKcaa01 = `TAG-${suffix}`
  } else if (first.includes('CUT-RMP') || first.startsWith('RMP-')) {
    inferredKcaa01 = `RMP-${suffix}`
  }
  const usage = resolveSyntheticTopLevelUsage(inferredKcaa01, qtyByKcaa01)
  return { kcaa01: inferredKcaa01, kcac04: usage.kcac04, kcac05: usage.kcac05 }
}

/**
 * 将虚拟根下子树包成与主 BOM 用量树一致的顶级成品层（BAG/TAG/RMP，level=1）
 * @param {string} rootKey
 * @param {any[]} children
 * @param {string} productKcaa01
 */
function buildPiBomSyntheticTopLevelNode(rootKey, children, productKcaa01, qtyByKcaa01) {
  const meta = inferVirtualRootTopLevelMeta(children, productKcaa01, qtyByKcaa01)
  return mapPiBomRowToUsageTreeNode(
    {
      id: null,
      kcaa01: meta.kcaa01,
      kcaa02: '',
      kcac01: '',
      kcac02: rootKey,
      systemcode: rootKey,
      kcac04: meta.kcac04,
      kcac05: meta.kcac05,
      kcaa33: 0,
      seq: null,
      Describe: '',
    },
    1,
    children,
  )
}

/**
 * @param {import('mssql').ConnectionPool | import('mssql').Transaction} db
 * @param {string} piNo
 * @param {string} productKcaa01
 */
export async function fetchPiBomListRowsForUsageTreeRoots(db, piNo, productKcaa01) {
  const pi = normKcaa01(piNo)
  const product = normKcaa01(productKcaa01)
  const r = await new sql.Request(db)
    .input('pi', sql.NVarChar(200), pi)
    .input('product', sql.NVarChar(300), product)
    .query(`
      SELECT
        ${PI_LIST_KCAC01_EXPR} AS kcac01,
        ${PI_LIST_KCAC02_EXPR} AS kcac02,
        LTRIM(RTRIM(ISNULL(CAST(l.[systemcode] AS nvarchar(500)), N''))) AS systemcode,
        CONVERT(int, ISNULL(l.[seq], 0)) AS seq,
        l.[id]
      FROM ${PI_BOM_LIST_FROM} AS l
      WHERE LTRIM(RTRIM(ISNULL(l.[sid], N''))) = @pi
        AND ${PI_LIST_PKCAA01_EXPR} = @product
    `)
  return r.recordset ?? []
}

/**
 * @param {import('mssql').ConnectionPool | import('mssql').Transaction} db
 * @param {string} piNo
 * @param {string} productKcaa01
 * @param {string} headSc
 */
export async function resolvePiBomUsageTreeRootKeysForProduct(db, piNo, productKcaa01, headSc) {
  const listRows = await fetchPiBomListRowsForUsageTreeRoots(db, piNo, productKcaa01)
  return resolvePiBomUsageTreeRootKeys(headSc, listRows)
}

/**
 * @param {import('mssql').ConnectionPool} pool
 * @param {string} piNo
 * @param {string} productKcaa01
 */
/**
 * 读取 PI 头 info 中虚拟根用量快照；无快照时返回空 Map（由调用方回退主 BOM）
 * @param {import('mssql').ConnectionPool | import('mssql').Transaction} db
 * @param {string} piNo
 * @param {string} productKcaa01
 */
export async function fetchPiBomVirtualRootQtyFromHead(db, piNo, productKcaa01) {
  const pi = normKcaa01(piNo)
  const product = normKcaa01(productKcaa01)
  const r = await new sql.Request(db)
    .input('pi', sql.NVarChar(200), pi)
    .input('product', sql.NVarChar(300), product)
    .query(`
      SELECT TOP 1 LTRIM(RTRIM(CONVERT(nvarchar(2000), ISNULL(h.[info], N'')))) AS info
      FROM ${PI_BOM_HEAD_FROM} AS h
      WHERE LTRIM(RTRIM(ISNULL(h.[sid], N''))) = @pi
        AND LTRIM(RTRIM(CONVERT(nvarchar(300), ISNULL(h.[kcaa01], N'')))) = @product
    `)
  return parsePiBomVirtualRootQtyInfo(r.recordset?.[0]?.info)
}

/**
 * @param {import('mssql').ConnectionPool} pool
 * @param {string} piNo
 * @param {string} productKcaa01
 * @param {string} headSc
 */
export async function resolvePiBomVirtualRootQtyByKcaa01(pool, piNo, productKcaa01, headSc) {
  const fromHead = await fetchPiBomVirtualRootQtyFromHead(pool, piNo, productKcaa01)
  if (fromHead.size) return fromHead
  const skipPrefixes = await fetchPiBomListSkipBomCodePrefixes(pool)
  return fetchMasterBomVirtualRootQtyUnderHead(pool, headSc, skipPrefixes)
}

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
 * BFS 预取 PI BOM 子树全部层（下一层父键为子行 systemcode 优先，否则 kcac02）
 * @param {import('mssql').ConnectionPool | import('mssql').Transaction} db
 * @param {string} piNo
 * @param {string | string[]} rootSystemcode 单根或多虚拟根
 * @param {string} productKcaa01
 */
export async function prefetchPiBomListLayersForUsageTree(db, piNo, rootSystemcode, productKcaa01) {
  const roots = (Array.isArray(rootSystemcode) ? rootSystemcode : [rootSystemcode])
    .map((r) => normalizeUsageTreeParentKey(r))
    .filter(Boolean)
  /** @type {Map<string, Record<string, unknown>[]>} */
  const cache = new Map()
  if (!roots.length) return cache

  /** @type {Set<string>} */
  const pending = new Set(roots)

  while (pending.size > 0) {
    const batch = [...pending].slice(0, LAYER_BATCH)
    for (const p of batch) pending.delete(p)

    const fetched = await prefetchPiBomListLayers(db, piNo, batch, productKcaa01)
    for (const [parent, rows] of fetched) {
      cache.set(parent, rows)
      for (const row of rows) {
        const child = usageTreeChildParentKey(row)
        if (child && !cache.has(child)) pending.add(child)
      }
    }
  }

  return cache
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
  const rootKeys = await resolvePiBomUsageTreeRootKeysForProduct(pool, piNo, productKcaa01, headSc)
  if (!rootKeys.length) {
    const err = new Error(`货品 ${productKcaa01} 的 PI BOM 无法解析展开根，请先同步 BOM`)
    err.code = 'PI_BOM_TREE_EMPTY'
    throw err
  }
  const layerCache = await prefetchPiBomListLayersForUsageTree(
    pool,
    piNo,
    rootKeys,
    productKcaa01,
  )
  const virtualRootQtyByKcaa01 = await resolvePiBomVirtualRootQtyByKcaa01(
    pool,
    piNo,
    productKcaa01,
    headSc,
  )
  const useVirtualRootWrappers = rootKeys.length > 1 || rootKeys[0] !== headSc
  /** @type {any[]} */
  const tree = []
  for (let i = 0; i < rootKeys.length; i++) {
    const rootKey = rootKeys[i]
    const stack = new Set([rootKey])
    const childLevel = useVirtualRootWrappers ? 2 : 1
    const nodes = buildPiBomUsageTreeNodesFromLayerCache(
      rootKey,
      childLevel,
      stack,
      layerCache,
      productKcaa01,
    )
    if (!nodes.length) continue
    if (useVirtualRootWrappers) {
      tree.push(
        buildPiBomSyntheticTopLevelNode(rootKey, nodes, productKcaa01, virtualRootQtyByKcaa01),
      )
    } else {
      tree.push(...nodes)
    }
  }
  if (!tree.length) {
    const err = new Error(`货品 ${productKcaa01} 的 PI BOM 展开为空，无法运算`)
    err.code = 'PI_BOM_TREE_EMPTY'
    throw err
  }
  return tree
}
