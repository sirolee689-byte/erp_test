/**
 * 销售订单 PI BOM：从主 BOM 建款、按款物理删除（全树展开，无层数上限；循环引用仍失败）
 */
import crypto from 'node:crypto'
import { sql } from './db.js'
import {
  buildBomPartsUsageTreeNodesFromLayerCache,
  normalizeUsageTreeParentKey,
  usageTreeChildParentKey,
} from './bomUsageTreeBuild.js'
import {
  getPiBomListCopyColumnMeta,
  insertPiBomListRowFromBomPartsRow,
  mergePiListPartRowWithBom000Override,
  prefetchBom000OverrideSnapshotsByKcaa01,
  prefetchBomPartsLayersForPiListCopy,
} from './salesOrderPiBomListFromParts.js'
import { normKcaa01 } from './salesOrderSaveLogic.js'
import {
  INV_BOM_CODE_FROM,
  INV_BOM_MASTER_FROM as BOM_MASTER_FROM,
  INV_BOM_MASTER_TABLE as BOM_MASTER_TABLE,
} from './bomTables.js'
const PI_BOM_HEAD_FROM = 'dbo.[UB_ERP_Bom_Sales]'
const PI_BOM_LIST_FROM = 'dbo.[UB_ERP_Bom_Sales_list]'

/** Bom_code.id：不参与 PI「顶级成品」父层（OUT 产品线 / 裁片子档分类） */
export const PI_BOM_TOP_LEVEL_EXCLUDED_BOM_CODE_IDS = [3, 12]

/**
 * @typedef {{ parentSc?: string, topLevelParentKeys?: Set<string> }} PiBomListDedupeOpts
 */

/**
 * 读取 Bom_code 顶级成品前缀（copen=1、flag5 非空；排除 CUT/OUT）
 * @param {import('mssql').ConnectionPool | import('mssql').Transaction} db
 */
export async function fetchTopLevelFinishedBomCodeFlag5Prefixes(db) {
  const r = await new sql.Request(db).query(`
    SELECT
      LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(bc.flag5, N'')))) AS flag5
    FROM ${INV_BOM_CODE_FROM} AS bc
    WHERE LTRIM(RTRIM(CONVERT(nvarchar(50), ISNULL(bc.copen, N'')))) = N'1'
      AND LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(bc.flag5, N'')))) <> N''
      AND bc.id NOT IN (${PI_BOM_TOP_LEVEL_EXCLUDED_BOM_CODE_IDS.join(', ')})
    ORDER BY LEN(LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(bc.flag5, N''))))) DESC
  `)
  /** @type {string[]} */
  const out = []
  const seen = new Set()
  for (const row of r.recordset ?? []) {
    const f5 = String(row.flag5 ?? '').trim().toUpperCase()
    if (!f5 || seen.has(f5)) continue
    seen.add(f5)
    out.push(f5)
  }
  return out
}

/**
 * kcaa01 是否命中 Bom_code 顶级成品前缀（与列表 is_need_calc 一致：flag5 + '%'）
 * @param {unknown} kcaa01
 * @param {string[]} flag5Prefixes 建议已按长度降序
 */
export function kcaa01MatchesTopLevelFinishedBomCodePrefix(kcaa01, flag5Prefixes) {
  const code = String(kcaa01 ?? '').trim().toUpperCase()
  if (!code || !flag5Prefixes?.length) return false
  for (let i = 0; i < flag5Prefixes.length; i++) {
    const f = String(flag5Prefixes[i] ?? '').trim().toUpperCase()
    if (f && code.startsWith(f)) return true
  }
  return false
}

/**
 * 子树中 kcaa01 命中 Bom_code 顶级成品的节点 → 其展开父键（写入 list 时子行 parentSc）
 * @param {any[]} tree
 * @param {string[]} flag5Prefixes
 */
export function collectTopLevelParentKeysFromPiBomTree(tree, flag5Prefixes) {
  /** @type {Set<string>} */
  const keys = new Set()
  /** @param {any[]} nodes */
  function walk(nodes) {
    for (const node of nodes ?? []) {
      const code = node?.kcaa01 != null ? String(node.kcaa01) : ''
      if (kcaa01MatchesTopLevelFinishedBomCodePrefix(code, flag5Prefixes)) {
        const childKey = usageTreeChildParentKey(node)
        if (childKey) keys.add(childKey)
      }
      const children = Array.isArray(node?.children) ? node.children : []
      if (children.length) walk(children)
    }
  }
  walk(tree)
  return keys
}

/** @param {Date} [d] */
export function formatSalesOrderAuditTime(d = new Date()) {
  const x = d instanceof Date ? d : new Date(d)
  const p = (n) => String(n).padStart(2, '0')
  return `${x.getFullYear()}-${p(x.getMonth() + 1)}-${p(x.getDate())} ${p(x.getHours())}:${p(x.getMinutes())}:${p(x.getSeconds())}`
}

export function newPiBomSystemcode() {
  return crypto.randomBytes(20).toString('hex').toUpperCase().slice(0, 40)
}

/**
 * PI list 行展开键：优先 Bom_parts systemcode/kcac02；若已被其它物理行占用则生成新键（多路径共用 systemcode 时各写一行）。
 * @param {Record<string, unknown> | null | undefined} sourceRow
 * @param {Map<number, string>} expandKeyByPartsId
 * @param {Set<string>} usedExpandKeys
 */
export function resolvePiListExpandKeyFromBomPartsRow(sourceRow, expandKeyByPartsId, usedExpandKeys) {
  const partsId = Number(sourceRow?.id)
  if (Number.isFinite(partsId) && partsId > 0 && expandKeyByPartsId.has(partsId)) {
    return expandKeyByPartsId.get(partsId)
  }
  let key = usageTreeChildParentKey(sourceRow)
  if (!key || usedExpandKeys.has(key)) {
    key = newPiBomSystemcode()
  }
  usedExpandKeys.add(key)
  if (Number.isFinite(partsId) && partsId > 0) {
    expandKeyByPartsId.set(partsId, key)
  }
  return key
}

function toNullableNumber(v) {
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/**
 * @param {string} parentSc
 * @param {any[]} nodes
 * @param {any[]} out
 * @param {number} level
 * @param {string} productKcaa01
 * @param {any} [parentNode]
 */
export function flattenPiBomPartRows(parentSc, nodes, out, level, productKcaa01, parentNode = null) {
  for (const node of nodes ?? []) {
    const sourceRow =
      node?._sourceRow && typeof node._sourceRow === 'object' ? node._sourceRow : node
    out.push({ parentSc, parentNode, node, sourceRow })
    const children = Array.isArray(node?.children) ? node.children : []
    if (children.length) {
      const childSc = usageTreeChildParentKey(node)
      if (!childSc) continue
      flattenPiBomPartRows(childSc, children, out, level + 1, productKcaa01, node)
    }
  }
}

/**
 * Bom_parts 物理行实例键（写入去重）。
 * - 父层为 Bom_code 顶级成品展开键（方案 A）：仅 `Bom_parts.id`
 * - 其余父层（方案 B）：`systemcode` → 行 `id` → `kcac02` → `kcaa01`
 * @param {Record<string, unknown> | null | undefined} sourceRow
 * @param {PiBomListDedupeOpts} [opts]
 */
export function piBomListPhysicalRowKey(sourceRow, opts) {
  const parentSc = normalizeUsageTreeParentKey(opts?.parentSc)
  const topLevel = opts?.topLevelParentKeys
  if (parentSc && topLevel?.has(parentSc)) {
    const rawId = sourceRow?.id
    const idNum = Number(rawId)
    if (rawId != null && rawId !== '' && Number.isFinite(idNum)) {
      return `id:${Math.trunc(idNum)}`
    }
    const kcac02 = normalizeUsageTreeParentKey(sourceRow?.kcac02)
    if (kcac02) return kcac02
    return normKcaa01(sourceRow?.kcaa01 != null ? String(sourceRow.kcaa01) : '')
  }
  const sc = normalizeUsageTreeParentKey(sourceRow?.systemcode)
  if (sc) return sc
  const rawId = sourceRow?.id
  const idNum = Number(rawId)
  if (rawId != null && rawId !== '' && Number.isFinite(idNum)) {
    return `id:${Math.trunc(idNum)}`
  }
  const kcac02 = normalizeUsageTreeParentKey(sourceRow?.kcac02)
  if (kcac02) return kcac02
  return normKcaa01(sourceRow?.kcaa01 != null ? String(sourceRow.kcaa01) : '')
}

/**
 * 建款/同步写入去重键：同一 PI、同一父 `kcac01`、同一物理行只插一行。
 * @param {string} parentSc 写入 UB_ERP_Bom_Sales_list.kcac01
 * @param {Record<string, unknown> | null | undefined} sourceRow Bom_parts 快照行
 * @param {PiBomListDedupeOpts} [opts]
 */
export function piBomListInsertDedupeKey(parentSc, sourceRow, opts) {
  const parent = normalizeUsageTreeParentKey(parentSc)
  const childInst = piBomListPhysicalRowKey(sourceRow, { ...opts, parentSc })
  if (!parent || !childInst) return ''
  return `${parent}\u001e${childInst}`
}

/**
 * @param {import('mssql').ConnectionPool | import('mssql').Transaction} db
 * @param {string} kcaa01
 */
export async function fetchMasterBomHeadByKcaa01(db, kcaa01) {
  const code = normKcaa01(kcaa01)
  const req = new sql.Request(db)
  req.input('kcaa01', sql.NVarChar(300), code)
  const r = await req.query(`
    SELECT TOP 1
      b.[id],
      LTRIM(RTRIM(ISNULL(CAST(b.[systemcode] AS nvarchar(500)), N''))) AS systemcode,
      LTRIM(RTRIM(CONVERT(nvarchar(300), ISNULL(b.[kcaa01], N'')))) AS kcaa01,
      LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(b.[kcaa02], N'')))) AS kcaa02,
      LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(b.[kcaa03], N'')))) AS kcaa03,
      LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(b.[kcaa04], N'')))) AS kcaa04,
      LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(b.[kcaa05], N'')))) AS kcaa05,
      LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(b.[kcaa06], N'')))) AS kcaa06,
      LTRIM(RTRIM(ISNULL(CAST(b.[GUID] AS nvarchar(500)), N''))) AS bomGuid,
      LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(b.[kcaa09], N'')))) AS kcaa09,
      LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(b.[kcaa10], N'')))) AS kcaa10,
      LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(b.[kcaa11], N'')))) AS kcaa11,
      b.[kcaa14] AS kcaa14,
      LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(b.[kcaa15], N'')))) AS kcaa15,
      LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(b.[kcaa25], N'')))) AS kcaa25,
      b.[kcaa26] AS kcaa26,
      LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(b.[kcaa27], N'')))) AS kcaa27,
      LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(b.[kcaa28], N'')))) AS kcaa28,
      LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(b.[kcaa29], N'')))) AS kcaa29,
      b.[kcaa30] AS kcaa30,
      LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(b.[kcaa31], N'')))) AS kcaa31,
      b.[type] AS type,
      LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(b.[location], N'')))) AS location,
      CONVERT(nvarchar(max), ISNULL(b.[remark], N'')) AS remark,
      LTRIM(RTRIM(CONVERT(nvarchar(20), ISNULL(b.[pass], N'')))) AS pass,
      b.[version] AS version
    FROM ${BOM_MASTER_FROM} AS b
    WHERE LTRIM(RTRIM(CONVERT(nvarchar(300), ISNULL(b.[kcaa01], N'')))) = @kcaa01
      AND (ISNULL(b.[del], N'') = N'' OR b.[del] = N'0')
    ORDER BY b.[id] DESC
  `)
  return r.recordset?.[0] ?? null
}

/**
 * @param {import('mssql').ConnectionPool | import('mssql').Transaction} db
 * @param {string} piNo
 */
export async function fetchPiBomHeadKcaa01Set(db, piNo) {
  const pi = normKcaa01(piNo)
  const req = new sql.Request(db)
  req.input('pi', sql.NVarChar(200), pi)
  const r = await req.query(`
    SELECT LTRIM(RTRIM(CONVERT(nvarchar(300), ISNULL(h.[kcaa01], N'')))) AS kcaa01
    FROM ${PI_BOM_HEAD_FROM} AS h
    WHERE LTRIM(RTRIM(ISNULL(h.[sid], N''))) = @pi
  `)
  return (r.recordset ?? []).map((row) => normKcaa01(row.kcaa01)).filter(Boolean)
}

/**
 * 收集该款 PI BOM 子树下所有 parent systemcode（含头）
 * @param {import('mssql').Transaction} tx
 * @param {string} piNo
 * @param {string} headSystemcode
 */
export async function collectPiBomSubtreeParentCodes(tx, piNo, headSystemcode) {
  const pi = normKcaa01(piNo)
  const head = normalizeUsageTreeParentKey(headSystemcode)
  /** @type {Set<string>} */
  const codes = new Set([head])
  /** @type {string[]} */
  let frontier = [head]
  while (frontier.length) {
    const batch = frontier.splice(0, 40)
    const req = new sql.Request(tx)
    req.input('pi', sql.NVarChar(200), pi)
    const or = []
    for (let i = 0; i < batch.length; i++) {
      const p = `sc${i}`
      req.input(p, sql.NVarChar(500), batch[i])
      or.push(`LTRIM(RTRIM(ISNULL(CAST(l.[kcac01] AS nvarchar(500)), N''))) = @${p}`)
    }
    const r = await req.query(`
      SELECT DISTINCT LTRIM(RTRIM(ISNULL(CAST(l.[systemcode] AS nvarchar(500)), N''))) AS systemcode
      FROM ${PI_BOM_LIST_FROM} AS l
      WHERE LTRIM(RTRIM(ISNULL(l.[sid], N''))) = @pi
        AND (${or.join(' OR ')})
    `)
    for (const row of r.recordset ?? []) {
      const sc = normalizeUsageTreeParentKey(row.systemcode)
      if (sc && !codes.has(sc)) {
        codes.add(sc)
        frontier.push(sc)
      }
    }
  }
  return codes
}

/**
 * @param {import('mssql').Transaction} tx
 * @param {string} piNo
 * @param {string} productKcaa01
 */
export async function deletePiBomProduct(tx, piNo, productKcaa01) {
  const pi = normKcaa01(piNo)
  const product = normKcaa01(productKcaa01)
  const headReq = new sql.Request(tx)
  headReq.input('pi', sql.NVarChar(200), pi)
  headReq.input('product', sql.NVarChar(300), product)
  const headR = await headReq.query(`
    SELECT TOP 1 LTRIM(RTRIM(ISNULL(CAST(h.[systemcode] AS nvarchar(500)), N''))) AS systemcode
    FROM ${PI_BOM_HEAD_FROM} AS h
    WHERE LTRIM(RTRIM(ISNULL(h.[sid], N''))) = @pi
      AND LTRIM(RTRIM(CONVERT(nvarchar(300), ISNULL(h.[kcaa01], N'')))) = @product
  `)
  const headSc = normalizeUsageTreeParentKey(headR.recordset?.[0]?.systemcode)
  if (!headSc) return

  const subtree = await collectPiBomSubtreeParentCodes(tx, pi, headSc)
  const codes = [...subtree]
  for (let i = 0; i < codes.length; i += 40) {
    const batch = codes.slice(i, i + 40)
    const delReq = new sql.Request(tx)
    delReq.input('pi', sql.NVarChar(200), pi)
    const or = []
    for (let j = 0; j < batch.length; j++) {
      const p = `c${i}_${j}`
      delReq.input(p, sql.NVarChar(500), batch[j])
      or.push(`LTRIM(RTRIM(ISNULL(CAST(l.[kcac01] AS nvarchar(500)), N''))) = @${p}`)
    }
    await delReq.query(`
      DELETE l
      FROM ${PI_BOM_LIST_FROM} AS l
      WHERE LTRIM(RTRIM(ISNULL(l.[sid], N''))) = @pi
        AND (${or.join(' OR ')})
    `)
  }

  const delHead = new sql.Request(tx)
  delHead.input('pi', sql.NVarChar(200), pi)
  delHead.input('product', sql.NVarChar(300), product)
  await delHead.query(`
    DELETE FROM ${PI_BOM_HEAD_FROM}
    WHERE LTRIM(RTRIM(ISNULL([sid], N''))) = @pi
      AND LTRIM(RTRIM(CONVERT(nvarchar(300), ISNULL([kcaa01], N'')))) = @product
  `)
}

/**
 * @param {import('mssql').ConnectionPool} pool
 * @param {import('mssql').Transaction} tx
 * @param {string} piNo
 * @param {string} productKcaa01
 * @param {{ uname?: string | null, utruename?: string | null, uid?: string | null, ip?: string | null }} actor
 */
export async function createPiBomFromMasterBom(pool, tx, piNo, productKcaa01, actor) {
  const pi = normKcaa01(piNo)
  const product = normKcaa01(productKcaa01)
  const master = await fetchMasterBomHeadByKcaa01(pool, product)
  if (!master?.systemcode) {
    const err = new Error(`货品 ${product} 未找到主 BOM 资料`)
    err.code = 'BOM_NOT_FOUND'
    throw err
  }
  const bomGuid = normKcaa01(master.bomGuid)
  if (!bomGuid) {
    const err = new Error(`货品 ${product} 在 bom_000 中缺少 GUID，无法写入 UB_ERP_Bom_Sales`)
    err.code = 'BOM_NOT_FOUND'
    throw err
  }
  const copyMeta = await getPiBomListCopyColumnMeta(pool)
  // PI 头 systemcode/GUID 与 bom_000.GUID 同值，建树父键须与 UB_ERP_Bom_Sales 头一致
  const headSc = bomGuid
  const layerCache = await prefetchBomPartsLayersForPiListCopy(pool, headSc, copyMeta)
  const stack = new Set([headSc])
  let tree
  try {
    // 建树与 BOM 资料用量表/bom_cost 一致（kcac02 展开）；写入 parentSc 用 resolvePiListExpandKeyFromBomPartsRow
    tree = buildBomPartsUsageTreeNodesFromLayerCache(headSc, 1, stack, layerCache, false)
  } catch (e) {
    if (e?.code === 'BOM_CYCLE') {
      const err = new Error(`货品 ${product} 的 BOM 存在循环引用`)
      err.code = 'BOM_CYCLE'
      throw err
    }
    throw e
  }

  // PI BOM 头：GUID 与 systemcode 两列写入相同值（均取自 bom_000.GUID）
  const headGuidAndSystemcode = bomGuid
  const now = formatSalesOrderAuditTime()
  const insHead = new sql.Request(tx)
  insHead.input('sid', sql.NVarChar(200), pi)
  insHead.input('kcaa01', sql.NVarChar(300), product)
  insHead.input('headGuidAndSystemcode', sql.NVarChar(500), headGuidAndSystemcode)
  insHead.input('kcaa02', sql.NVarChar(500), String(master.kcaa02 ?? ''))
  insHead.input('kcaa03', sql.NVarChar(500), String(master.kcaa03 ?? ''))
  insHead.input('kcaa04', sql.NVarChar(100), String(master.kcaa04 ?? ''))
  insHead.input('kcaa05', sql.NVarChar(100), String(master.kcaa05 ?? ''))
  insHead.input('kcaa06', sql.NVarChar(100), String(master.kcaa06 ?? ''))
  insHead.input('kcaa09', sql.NVarChar(100), String(master.kcaa09 ?? ''))
  insHead.input('kcaa10', sql.NVarChar(100), String(master.kcaa10 ?? ''))
  insHead.input('kcaa11', sql.NVarChar(100), String(master.kcaa11 ?? ''))
  insHead.input('kcaa14', sql.Int, toNullableNumber(master.kcaa14))
  insHead.input('kcaa15', sql.NVarChar(100), String(master.kcaa15 ?? ''))
  insHead.input('kcaa25', sql.NVarChar(100), String(master.kcaa25 ?? ''))
  insHead.input('kcaa26', sql.Decimal(18, 6), toNullableNumber(master.kcaa26))
  insHead.input('kcaa27', sql.NVarChar(100), String(master.kcaa27 ?? ''))
  insHead.input('kcaa28', sql.NVarChar(100), String(master.kcaa28 ?? ''))
  insHead.input('kcaa29', sql.NVarChar(100), String(master.kcaa29 ?? ''))
  insHead.input('kcaa30', sql.Decimal(18, 6), toNullableNumber(master.kcaa30))
  insHead.input('kcaa31', sql.NVarChar(100), String(master.kcaa31 ?? ''))
  insHead.input('type', sql.Int, toNullableNumber(master.type))
  insHead.input('location', sql.NVarChar(200), String(master.location ?? ''))
  const versionNo = Number(master.version)
  insHead.input('version', sql.Int, Number.isFinite(versionNo) ? versionNo : null)
  insHead.input('headRemark', sql.NVarChar(sql.MAX), String(master.remark ?? ''))
  insHead.input('headPass', sql.NVarChar(20), String(master.pass ?? ''))
  insHead.input('uname', sql.NVarChar(100), String(actor.uname ?? ''))
  insHead.input('utruename', sql.NVarChar(100), String(actor.utruename ?? ''))
  insHead.input('uid', sql.NVarChar(50), String(actor.uid ?? ''))
  insHead.input('addtime', sql.NVarChar(50), now)
  await insHead.query(`
    INSERT INTO ${PI_BOM_HEAD_FROM} (
      [sid], [kcaa01], [GUID], [systemcode], [kcaa02], [kcaa03], [kcaa04], [kcaa05], [kcaa06],
      [kcaa09], [kcaa10], [kcaa11], [kcaa14], [kcaa15], [kcaa25], [kcaa26], [kcaa27], [kcaa28],
      [kcaa29], [kcaa30], [kcaa31], [type], [location], [version], [remark],
      [uname], [utruename], [uid], [addtime], [del], [pass]
    ) VALUES (
      @sid, @kcaa01, @headGuidAndSystemcode, @headGuidAndSystemcode, @kcaa02, @kcaa03, @kcaa04, @kcaa05, @kcaa06,
      @kcaa09, @kcaa10, @kcaa11, @kcaa14, @kcaa15, @kcaa25, @kcaa26, @kcaa27, @kcaa28,
      @kcaa29, @kcaa30, @kcaa31, @type, @location, @version, @headRemark,
      @uname, @utruename, @uid, @addtime, N'0', @headPass
    )
  `)

  const topLevelFlag5Prefixes = await fetchTopLevelFinishedBomCodeFlag5Prefixes(pool)
  const topLevelParentKeys = collectTopLevelParentKeysFromPiBomTree(tree, topLevelFlag5Prefixes)

  /** @type {{ parentSc: string, node: any }[]} */
  const flat = []
  flattenPiBomPartRows(headSc, tree, flat, 1, product)

  const kcaa01ForOverride = flat
    .map(({ sourceRow }) => normKcaa01(sourceRow?.kcaa01))
    .filter(Boolean)
  const bom000OverrideByKcaa01 = await prefetchBom000OverrideSnapshotsByKcaa01(pool, kcaa01ForOverride)

  /** @type {Set<string>} */
  const insertedDedupeKeys = new Set()
  /** @type {Map<number, string>} */
  const expandKeyByPartsId = new Map()
  /** @type {Set<string>} */
  const usedExpandKeys = new Set([headSc])

  for (const { parentSc, parentNode, sourceRow } of flat) {
    const parentSourceRow =
      parentNode?._sourceRow && typeof parentNode._sourceRow === 'object'
        ? parentNode._sourceRow
        : parentNode
    const listParentSc = parentSourceRow
      ? resolvePiListExpandKeyFromBomPartsRow(parentSourceRow, expandKeyByPartsId, usedExpandKeys)
      : normalizeUsageTreeParentKey(parentSc)

    const dedupeKey = piBomListInsertDedupeKey(listParentSc, sourceRow, { topLevelParentKeys })
    if (dedupeKey) {
      if (insertedDedupeKeys.has(dedupeKey)) continue
      insertedDedupeKeys.add(dedupeKey)
    }

    const rowExpandKey = resolvePiListExpandKeyFromBomPartsRow(
      sourceRow,
      expandKeyByPartsId,
      usedExpandKeys,
    )
    const childCode = normKcaa01(sourceRow?.kcaa01)
    const bom000Snap = childCode ? bom000OverrideByKcaa01.get(childCode) : undefined
    const partRow = mergePiListPartRowWithBom000Override(
      { ...sourceRow, systemcode: rowExpandKey },
      bom000Snap,
    )
    await insertPiBomListRowFromBomPartsRow(tx, {
      sid: pi,
      parentSc: listParentSc,
      topProductKcaa01: product,
      partRow,
      meta: copyMeta,
      actor,
      addtime: now,
    })
  }
}

/**
 * @param {import('mssql').Transaction} tx
 * @param {string} piNo
 * @param {string[]} toDelete
 * @param {string[]} toCreate
 * @param {import('mssql').ConnectionPool} pool
 * @param {{ uname?: string | null, utruename?: string | null, uid?: string | null, ip?: string | null }} actor
 */
export async function applyPiBomAlignPlan(tx, pool, piNo, toDelete, toCreate, actor) {
  for (const code of toDelete ?? []) {
    await deletePiBomProduct(tx, piNo, code)
  }
  for (const code of toCreate ?? []) {
    await createPiBomFromMasterBom(pool, tx, piNo, code, actor)
  }
}

/**
 * 按款从主 BOM 覆盖 PI BOM（先删后建，用于「同步 BOM」）
 * @param {import('mssql').ConnectionPool} pool
 * @param {import('mssql').Transaction} tx
 * @param {string} piNo
 * @param {string} productKcaa01
 * @param {{ uname?: string | null, utruename?: string | null, uid?: string | null, ip?: string | null }} actor
 */
export async function replacePiBomFromMasterBom(pool, tx, piNo, productKcaa01, actor) {
  await deletePiBomProduct(tx, piNo, productKcaa01)
  await createPiBomFromMasterBom(pool, tx, piNo, productKcaa01, actor)
}
