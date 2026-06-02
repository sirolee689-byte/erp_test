/**
 * 销售订单 PI BOM 配件行：从 Bom_parts 按列快照写入 UB_ERP_Bom_Sales_list
 */
import sql from 'mssql'
import {
  BOM_USAGE_TREE_LAYER_BATCH_SIZE,
  normalizeUsageTreeParentKey,
} from './bomUsageTreeBuild.js'
import {
  INV_BOM_MASTER_FROM,
  INV_BOM_PARTS_FROM,
  INV_BOM_PARTS_TABLE,
} from './bomTables.js'
import { normKcaa01 } from './salesOrderSaveLogic.js'

const PI_BOM_LIST_TABLE = 'UB_ERP_Bom_Sales_list'
const PI_BOM_LIST_FROM = 'dbo.[UB_ERP_Bom_Sales_list]'

const BOM_PARTS_KCAC01_EXPR = `LTRIM(RTRIM(ISNULL(CAST(p.kcac01 AS nvarchar(500)), N'')))`

/** 写入时由服务端覆盖，不从 Bom_parts 抄 */
const PI_LIST_INSERT_OVERRIDE = new Set([
  'sid',
  'kcac01',
  'pkcaa01',
  'uid',
  'uname',
  'utruename',
  'addtime',
  'del',
])

/** 自增/主键，不插入 */
const PI_LIST_INSERT_SKIP = new Set(['id'])

/** 源表列名 → 目标表列名（仅当目标无同名源列时） */
const PARTS_TO_LIST_COLUMN_ALIAS = new Map([['seq', 'Seq']])

/**
 * PI BOM 配件行：先抄 Bom_parts，再按子件 kcaa01 用 bom_000 覆盖（无主档则保留 parts）
 * @type {readonly string[]}
 */
export const PI_BOM_LIST_BOM000_OVERRIDE_COLS = [
  'kcaa02_en',
  'location',
  'sale_price',
  'cost_price',
  'Customer_supply',
  'Customer_Name',
  'remark',
  'GUID',
  'version',
  'kcac03',
]

const BOM000_OVERRIDE_BATCH_SIZE = 40

const BOM000_KCAA01_EXPR = `LTRIM(RTRIM(CONVERT(nvarchar(300), ISNULL(b.[kcaa01], N''))))`

const NUMERIC_SQL_TYPES = new Set([
  'bit',
  'tinyint',
  'smallint',
  'int',
  'bigint',
  'decimal',
  'numeric',
  'float',
  'real',
  'money',
  'smallmoney',
])

/** @type {Promise<{ copyCols: { targetCol: string, sourceCol: string, dataType: string }[] }> | null} */
let PI_BOM_LIST_COPY_META_PROMISE = null

function bomPartsNumericColAsDecimalSql(colExpr) {
  const c = String(colExpr ?? '').trim()
  return `CAST(ISNULL(${c}, 0) AS decimal(18, 6))`
}

function quoteSqlBracketName(name) {
  const n = String(name ?? '').trim()
  if (!n) return ''
  if (n === 'Describe') return 'p.[Describe]'
  return `p.[${n.replace(/]/g, '')}]`
}

/**
 * @param {string} sourceCol
 * @param {string} dataType
 * @param {string} aliasCol
 */
function bomPartsSelectExprForColumn(sourceCol, dataType, aliasCol) {
  const src = quoteSqlBracketName(sourceCol)
  const alias = String(aliasCol ?? sourceCol).trim()
  const dt = String(dataType ?? '').toLowerCase()
  if (NUMERIC_SQL_TYPES.has(dt)) {
    if (dt === 'int' || dt === 'bigint' || dt === 'smallint' || dt === 'tinyint') {
      return `CONVERT(int, ISNULL(${src}, 0)) AS [${alias}]`
    }
    return `${bomPartsNumericColAsDecimalSql(src)} AS [${alias}]`
  }
  return `LTRIM(RTRIM(CONVERT(nvarchar(max), ISNULL(${src}, N'')))) AS [${alias}]`
}

/**
 * @param {import('mssql').ConnectionPool} pool
 */
async function loadTableColumnMeta(pool, tableName) {
  /** @type {Map<string, { name: string, dataType: string }>} */
  const byLower = new Map()
  const r = await pool.request().input('tn', sql.NVarChar(128), tableName).query(`
    SELECT COLUMN_NAME AS name, DATA_TYPE AS dt
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = N'dbo' AND TABLE_NAME = @tn
    ORDER BY ORDINAL_POSITION
  `)
  for (const row of r.recordset ?? []) {
    const name = String(row?.name ?? '').trim()
    if (!name) continue
    const lower = name.toLowerCase()
    byLower.set(lower, { name, dataType: String(row?.dt ?? '').toLowerCase() })
  }
  return byLower
}

/**
 * @param {import('mssql').ConnectionPool} pool
 */
export async function getPiBomListCopyColumnMeta(pool) {
  if (PI_BOM_LIST_COPY_META_PROMISE) return PI_BOM_LIST_COPY_META_PROMISE
  PI_BOM_LIST_COPY_META_PROMISE = (async () => {
    const partsCols = await loadTableColumnMeta(pool, INV_BOM_PARTS_TABLE)
    const listCols = await loadTableColumnMeta(pool, PI_BOM_LIST_TABLE)
    /** @type {{ targetCol: string, sourceCol: string, dataType: string }[]} */
    const copyCols = []

    for (const [targetLower, targetMeta] of listCols) {
      if (PI_LIST_INSERT_SKIP.has(targetLower) || PI_LIST_INSERT_OVERRIDE.has(targetLower)) continue
      let sourceMeta = partsCols.get(targetLower)
      if (!sourceMeta) {
        const aliasSource = PARTS_TO_LIST_COLUMN_ALIAS.get(targetLower)
        if (aliasSource) sourceMeta = partsCols.get(String(aliasSource).toLowerCase())
      }
      if (!sourceMeta) continue
      copyCols.push({
        targetCol: targetMeta.name,
        sourceCol: sourceMeta.name,
        dataType: sourceMeta.dataType,
      })
    }

    return { copyCols }
  })()
  return PI_BOM_LIST_COPY_META_PROMISE
}

/**
 * @param {{ targetCol: string, sourceCol: string, dataType: string }[]} copyCols
 */
export function buildBomPartsSelectListForPiCopy(copyCols) {
  const parts = copyCols.map((c) =>
    bomPartsSelectExprForColumn(c.sourceCol, c.dataType, c.targetCol),
  )
  return parts.join(',\n        ')
}

/**
 * 批量读取 Bom_parts 层（含 PI 复制所需的全部同名列）
 * @param {import('mssql').ConnectionPool} pool
 * @param {string[]} kcac01Parents
 * @param {{ copyCols: { targetCol: string, sourceCol: string, dataType: string }[] }} meta
 */
export async function fetchBomPartsLayersBatchForPiListCopy(pool, kcac01Parents, meta) {
  /** @type {Map<string, Record<string, unknown>[]>} */
  const out = new Map()
  const uniq = [
    ...new Set(kcac01Parents.map((p) => normalizeUsageTreeParentKey(p)).filter(Boolean)),
  ]
  if (!uniq.length) return out

  const selectList = buildBomPartsSelectListForPiCopy(meta.copyCols)
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
        ${selectList}
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
 * BFS 预取子树（列全集，供 PI BOM 写入）
 * @param {import('mssql').ConnectionPool} pool
 * @param {string} rootSystemcode
 * @param {{ copyCols: { targetCol: string, sourceCol: string, dataType: string }[] }} meta
 */
export async function prefetchBomPartsLayersForPiListCopy(pool, rootSystemcode, meta) {
  const root = normalizeUsageTreeParentKey(rootSystemcode)
  /** @type {Map<string, Record<string, unknown>[]>} */
  const cache = new Map()
  if (!root) return cache

  /** @type {Set<string>} */
  const pending = new Set([root])

  while (pending.size > 0) {
    const batch = [...pending].slice(0, BOM_USAGE_TREE_LAYER_BATCH_SIZE)
    for (const p of batch) pending.delete(p)

    const fetched = await fetchBomPartsLayersBatchForPiListCopy(pool, batch, meta)
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
 * @param {unknown} raw
 * @param {string} dataType
 */
/**
 * @param {Record<string, unknown>} partRow
 * @param {Record<string, unknown> | undefined} bom000Snap
 */
export function mergePiListPartRowWithBom000Override(partRow, bom000Snap) {
  if (!bom000Snap || typeof bom000Snap !== 'object') return partRow
  const out = { ...partRow }
  for (const col of PI_BOM_LIST_BOM000_OVERRIDE_COLS) {
    if (Object.prototype.hasOwnProperty.call(bom000Snap, col)) {
      out[col] = bom000Snap[col]
    }
  }
  return out
}

/**
 * 按子件编码批量读取 bom_000 覆盖字段（每码取 id 最大且未删的一条）
 * @param {import('mssql').ConnectionPool} pool
 * @param {string[]} kcaa01Codes
 * @returns {Promise<Map<string, Record<string, unknown>>>}
 */
export async function prefetchBom000OverrideSnapshotsByKcaa01(pool, kcaa01Codes) {
  /** @type {Map<string, Record<string, unknown>>} */
  const out = new Map()
  const uniq = [...new Set((kcaa01Codes ?? []).map((c) => normKcaa01(c)).filter(Boolean))]
  if (!uniq.length) return out

  for (let i = 0; i < uniq.length; i += BOM000_OVERRIDE_BATCH_SIZE) {
    const chunk = uniq.slice(i, i + BOM000_OVERRIDE_BATCH_SIZE)
    const rq = pool.request()
    const orParts = []
    for (let j = 0; j < chunk.length; j++) {
      const pname = `bk${i}_${j}`
      rq.input(pname, sql.NVarChar(300), chunk[j])
      orParts.push(`${BOM000_KCAA01_EXPR} = @${pname}`)
    }
    const r = await rq.query(`
      WITH ranked AS (
        SELECT
          ${BOM000_KCAA01_EXPR} AS kcaa01,
          LTRIM(RTRIM(ISNULL(CAST(b.[GUID] AS nvarchar(500)), N''))) AS [GUID],
          b.[version] AS version,
          LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(b.[kcaa25], N'')))) AS kcac03,
          LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(b.[kcaa02_en], N'')))) AS kcaa02_en,
          LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(b.[location], N'')))) AS location,
          CAST(ISNULL(b.[sale_price], 0) AS decimal(18, 6)) AS sale_price,
          CAST(ISNULL(b.[cost_price], 0) AS decimal(18, 6)) AS cost_price,
          CONVERT(int, ISNULL(b.[Customer_supply], 0)) AS Customer_supply,
          LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(b.[Customer_Name], N'')))) AS Customer_Name,
          CONVERT(nvarchar(max), ISNULL(b.[remark], N'')) AS remark,
          ROW_NUMBER() OVER (PARTITION BY ${BOM000_KCAA01_EXPR} ORDER BY b.[id] DESC) AS rn
        FROM ${INV_BOM_MASTER_FROM} AS b
        WHERE (${orParts.join(' OR ')})
          AND (ISNULL(b.[del], N'') = N'' OR b.[del] = N'0')
      )
      SELECT kcaa01, [GUID], version, kcac03, kcaa02_en, location, sale_price, cost_price, Customer_supply, Customer_Name, remark
      FROM ranked
      WHERE rn = 1
    `)
    for (const row of r.recordset ?? []) {
      const code = normKcaa01(row.kcaa01)
      if (!code) continue
      out.set(code, row)
    }
  }
  return out
}

function bindPiListCopyValue(raw, dataType) {
  const dt = String(dataType ?? '').toLowerCase()
  if (NUMERIC_SQL_TYPES.has(dt)) {
    if (dt === 'int' || dt === 'bigint' || dt === 'smallint' || dt === 'tinyint') {
      const n = Number(raw)
      return Number.isFinite(n) ? Math.trunc(n) : 0
    }
    const n = Number(raw)
    return Number.isFinite(n) ? n : 0
  }
  return raw == null ? '' : String(raw)
}

/**
 * @param {import('mssql').Transaction} tx
 * @param {{
 *   sid: string,
 *   parentSc: string,
 *   partRow: Record<string, unknown>,
 *   meta: { copyCols: { targetCol: string, sourceCol: string, dataType: string }[] },
 *   topProductKcaa01: string,
 *   actor: { uid?: string | null, uname?: string | null, utruename?: string | null },
 *   addtime: string,
 * }} opts
 */
export async function insertPiBomListRowFromBomPartsRow(tx, opts) {
  const { sid, parentSc, topProductKcaa01, partRow, meta, actor, addtime } = opts
  const ins = new sql.Request(tx)
  ins.input('sid', sql.NVarChar(200), sid)
  ins.input('kcac01', sql.NVarChar(500), parentSc)
  ins.input('pkcaa01', sql.NVarChar(300), normKcaa01(topProductKcaa01))
  ins.input('uname', sql.NVarChar(100), String(actor.uname ?? ''))
  ins.input('utruename', sql.NVarChar(100), String(actor.utruename ?? ''))
  ins.input('uid', sql.NVarChar(50), String(actor.uid ?? ''))
  ins.input('addtime', sql.NVarChar(50), addtime)

  const cols = [
    '[sid]',
    '[kcac01]',
    '[pkcaa01]',
    '[uname]',
    '[utruename]',
    '[uid]',
    '[addtime]',
    '[del]',
  ]
  const vals = [
    '@sid',
    '@kcac01',
    '@pkcaa01',
    '@uname',
    '@utruename',
    '@uid',
    '@addtime',
    `N'0'`,
  ]

  for (let i = 0; i < meta.copyCols.length; i++) {
    const { targetCol, dataType } = meta.copyCols[i]
    const key = targetCol
    const raw = partRow[key] ?? partRow[key.toLowerCase()] ?? partRow[targetCol]
    const pname = `c${i}`
    const val = bindPiListCopyValue(raw, dataType)
    const dt = String(dataType ?? '').toLowerCase()
    if (NUMERIC_SQL_TYPES.has(dt)) {
      if (dt === 'int' || dt === 'bigint' || dt === 'smallint' || dt === 'tinyint') {
        ins.input(pname, sql.Int, val)
      } else {
        ins.input(pname, sql.Decimal(18, 6), val)
      }
    } else {
      ins.input(pname, sql.NVarChar(sql.MAX), val)
    }
    cols.push(`[${targetCol.replace(/]/g, '')}]`)
    vals.push(`@${pname}`)
  }

  await ins.query(`
    INSERT INTO ${PI_BOM_LIST_FROM} (${cols.join(', ')})
    VALUES (${vals.join(', ')})
  `)
}
