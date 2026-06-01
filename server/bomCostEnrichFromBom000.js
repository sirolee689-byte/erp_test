/**
 * bom_cost 运算落库：按 kcaa01 从 bom_000 补全主档字段（与纸格导入字段来源一致）
 */
import sql from 'mssql'
import { erpCodeLookupKey, normalizeErpCodeDisplay } from './paperPatternErpCodeNormalize.js'
import {
  BOM_COST_FROM,
  BOM_COST_TABLE,
  BOM_MATERIAL_FROM,
  INV_BOM_MASTER_FROM,
} from './bomTables.js'

export const BOM_COST_DEFAULT_TYPE = 1
export const BOM_COST_DEFAULT_VERSION = 100

/** 与 index.js formatBomColorcodeTimestamp 一致 */
export function formatBomCostAuditTimestamp(date = new Date()) {
  const d = date instanceof Date ? date : new Date(date)
  const pad2 = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()} ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`
}

/**
 * bom_000 行级 GUID（与 systemcode 同值落库）；优先 [GUID]，否则 systemcode
 * @param {Record<string, unknown>|undefined|null} m
 */
export function resolveBom000GuidForBomCostRow(m) {
  const guid = String(m?.master_guid ?? '').trim()
  if (guid) return guid
  const sc = String(m?.systemcode_disp ?? '').trim()
  return sc || null
}

/** @param {unknown} raw */
export function bomCostParseDecimal6OrNull(raw) {
  if (raw === null || raw === undefined) return null
  const s = String(raw).replace(/,/g, '').trim()
  if (s === '') return null
  const n = Number(s)
  if (!Number.isFinite(n)) return null
  return Math.round(n * 1e6) / 1e6
}

/** @param {unknown} raw */
function bomCostParseIntOrNull(raw) {
  if (raw === null || raw === undefined) return null
  const s = String(raw).trim()
  if (s === '') return null
  const n = Number(s)
  if (!Number.isFinite(n)) return null
  return Math.trunc(n)
}

/** @param {unknown} raw */
export function isPqBomCostHead(raw) {
  return String(raw ?? '').trim().toUpperCase().startsWith('PQ-')
}

/** SQL Server 2008：Bom_000 数值列安全转 float */
function bom000NumericColSql(colName) {
  const c = String(colName ?? '').trim()
  return `CASE
          WHEN b.[${c}] IS NULL THEN NULL
          WHEN ISNUMERIC(LTRIM(RTRIM(CONVERT(nvarchar(100), b.[${c}])))) = 1
            THEN CONVERT(float, LTRIM(RTRIM(CONVERT(nvarchar(100), b.[${c}]))))
          ELSE NULL
        END`
}

function bom000IntColSql(colName) {
  const c = String(colName ?? '').trim()
  return `CASE
          WHEN b.[${c}] IS NULL THEN NULL
          WHEN ISNUMERIC(LTRIM(RTRIM(CONVERT(nvarchar(100), b.[${c}])))) = 1
            THEN CONVERT(int, LTRIM(RTRIM(CONVERT(nvarchar(100), b.[${c}]))))
          ELSE NULL
        END`
}

/** 物理列（小写）缓存：表名 → Promise<Set> */
const COST_TABLE_COLSET_CACHE = new Map()

/**
 * @param {import('mssql').ConnectionPool} pool
 * @param {string} [tableName]
 * @returns {Promise<Set<string>>}
 */
export async function getCostTableColumnSet(pool, tableName = BOM_COST_TABLE) {
  const tbl = String(tableName ?? BOM_COST_TABLE).trim()
  if (!/^[A-Za-z0-9_]+$/.test(tbl)) return new Set()
  let p = COST_TABLE_COLSET_CACHE.get(tbl)
  if (!p) {
    p = (async () => {
      try {
        const r = await pool.request().input('tn', sql.NVarChar(128), tbl).query(`
          SELECT COLUMN_NAME AS name
          FROM INFORMATION_SCHEMA.COLUMNS
          WHERE TABLE_SCHEMA = N'dbo' AND TABLE_NAME = @tn
        `)
        const set = new Set()
        for (const row of r.recordset ?? []) {
          const n = String(row?.name ?? '').trim()
          if (n) set.add(n.toLowerCase())
        }
        return set
      } catch (err) {
        console.warn(`[${tbl}] 读取列清单失败：`, err?.message ?? err)
        return new Set()
      }
    })()
    COST_TABLE_COLSET_CACHE.set(tbl, p)
  }
  return p
}

/**
 * @param {import('mssql').ConnectionPool} pool
 * @returns {Promise<Set<string>>}
 */
export async function getBomCostColumnSet(pool) {
  return getCostTableColumnSet(pool, BOM_COST_TABLE)
}

/**
 * @param {import('mssql').ConnectionPool | import('mssql').Transaction} poolOrTx
 * @param {string[]} materialCodes 物料编码 kcaa01（去重前亦可）
 * @returns {Promise<Map<string, Record<string, unknown>>>} key = erpCodeLookupKey
 */
export async function fetchBom000ForBomCostEnrich(poolOrTx, materialCodes) {
  /** @type {Map<string, Record<string, unknown>>} */
  const out = new Map()
  const uniq = [...new Set(materialCodes.map((c) => normalizeErpCodeDisplay(c)).filter(Boolean))]
  if (!uniq.length) return out

  const chunkSize = 80
  for (let i = 0; i < uniq.length; i += chunkSize) {
    const chunk = uniq.slice(i, i + chunkSize)
    const rq = new sql.Request(poolOrTx)
    const partsDisp = []
    const partsLow = []
    for (let j = 0; j < chunk.length; j++) {
      const dname = `d${j}`
      const lname = `l${j}`
      rq.input(dname, sql.NVarChar(400), chunk[j])
      rq.input(lname, sql.NVarChar(400), erpCodeLookupKey(chunk[j]))
      partsDisp.push(`@${dname}`)
      partsLow.push(`@${lname}`)
    }
    const rs = await rq.query(`
      SELECT
        LTRIM(RTRIM(CONVERT(nvarchar(400), ISNULL(b.kcaa01, N'')))) AS kcaa01_disp,
        LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(b.kcaa04, N'')))) AS kcaa04,
        LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(b.kcaa02_en, N'')))) AS kcaa02_en,
        LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(b.kcaa05, N'')))) AS kcaa05,
        LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(b.kcaa11, N'')))) AS kcaa11,
        ${bom000IntColSql('kcaa12')} AS kcaa12,
        ${bom000IntColSql('kcaa13')} AS kcaa13,
        ${bom000IntColSql('kcaa14')} AS kcaa14,
        LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(b.kcaa25, N'')))) AS kcaa25,
        ${bom000NumericColSql('kcaa26')} AS kcaa26,
        LTRIM(RTRIM(CONVERT(nvarchar(80), ISNULL(b.kcaa27, N'')))) AS kcaa27,
        LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(b.kcaa28, N'')))) AS kcaa28,
        LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(b.kcaa29, N'')))) AS kcaa29,
        ${bom000NumericColSql('kcaa30')} AS kcaa30,
        LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(b.kcaa31, N'')))) AS kcaa31,
        ${bom000NumericColSql('kcaa32')} AS kcaa32,
        ${bom000NumericColSql('kcaa33')} AS kcaa33,
        LTRIM(RTRIM(CONVERT(nvarchar(80), ISNULL(b.kcaa34, N'')))) AS kcaa34,
        LTRIM(RTRIM(CONVERT(nvarchar(80), ISNULL(b.kcaa35, N'')))) AS kcaa35,
        LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(b.location, N'')))) AS location,
        LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(b.remark, N'')))) AS remark,
        LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(b.Customer_Name, N'')))) AS Customer_Name,
        ${bom000IntColSql('type')} AS type,
        ${bom000IntColSql('version')} AS version,
        ${bom000NumericColSql('cost_price')} AS cost_price,
        ${bom000NumericColSql('sale_price')} AS sale_price,
        LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(b.[GUID], N'')))) AS master_guid,
        LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(b.systemcode, N'')))) AS systemcode_disp
      FROM ${INV_BOM_MASTER_FROM} AS b
      WHERE (
          LTRIM(RTRIM(CONVERT(nvarchar(400), ISNULL(b.kcaa01, N'')))) IN (${partsDisp.join(', ')})
          OR LOWER(LTRIM(RTRIM(CONVERT(nvarchar(400), ISNULL(b.kcaa01, N''))))) IN (${partsLow.join(', ')})
        )
        AND (ISNULL(b.del, N'') = N'' OR LTRIM(RTRIM(ISNULL(CONVERT(nvarchar(20), b.del), N''))) = N'0')
      ORDER BY b.id DESC
    `)
    for (const r of rs.recordset || []) {
      const disp = normalizeErpCodeDisplay(String(r.kcaa01_disp ?? ''))
      const lk = erpCodeLookupKey(disp)
      if (!lk || out.has(lk)) continue
      out.set(lk, {
        kcaa04: String(r.kcaa04 ?? '').trim(),
        kcaa02_en: String(r.kcaa02_en ?? '').trim(),
        kcaa05: String(r.kcaa05 ?? '').trim(),
        kcaa11: String(r.kcaa11 ?? '').trim(),
        kcaa12: bomCostParseIntOrNull(r.kcaa12),
        kcaa13: bomCostParseIntOrNull(r.kcaa13),
        kcaa14: bomCostParseIntOrNull(r.kcaa14),
        kcaa25: String(r.kcaa25 ?? '').trim(),
        kcaa26: bomCostParseDecimal6OrNull(r.kcaa26),
        kcaa27: String(r.kcaa27 ?? '').trim(),
        kcaa28: String(r.kcaa28 ?? '').trim(),
        kcaa29: String(r.kcaa29 ?? '').trim(),
        kcaa30: bomCostParseDecimal6OrNull(r.kcaa30),
        kcaa31: String(r.kcaa31 ?? '').trim(),
        kcaa32: bomCostParseDecimal6OrNull(r.kcaa32),
        kcaa33: bomCostParseDecimal6OrNull(r.kcaa33),
        kcaa34: String(r.kcaa34 ?? '').trim(),
        kcaa35: String(r.kcaa35 ?? '').trim(),
        location: String(r.location ?? '').trim(),
        remark: String(r.remark ?? '').trim(),
        Customer_Name: String(r.Customer_Name ?? '').trim(),
        type: bomCostParseIntOrNull(r.type),
        version: bomCostParseIntOrNull(r.version),
        cost_price: bomCostParseDecimal6OrNull(r.cost_price),
        sale_price: bomCostParseDecimal6OrNull(r.sale_price),
        master_guid: String(r.master_guid ?? '').trim(),
        systemcode_disp: String(r.systemcode_disp ?? '').trim(),
      })
    }
  }
  return out
}

/**
 * @param {import('mssql').ConnectionPool | import('mssql').Transaction} poolOrTx
 * @param {string[]} categoryCodes bom_000.kcaa05
 * @returns {Promise<Map<string, number>>} key = trimmed Bom_material.code
 */
export async function fetchBomMaterialPxByCategoryCodes(poolOrTx, categoryCodes) {
  /** @type {Map<string, number>} */
  const out = new Map()
  const uniq = [
    ...new Set(categoryCodes.map((c) => String(c ?? '').trim()).filter(Boolean)),
  ]
  if (!uniq.length) return out

  const chunkSize = 80
  for (let i = 0; i < uniq.length; i += chunkSize) {
    const chunk = uniq.slice(i, i + chunkSize)
    const rq = new sql.Request(poolOrTx)
    const parts = []
    for (let j = 0; j < chunk.length; j++) {
      const name = `cat${j}`
      rq.input(name, sql.NVarChar(200), chunk[j])
      parts.push(`@${name}`)
    }
    const rs = await rq.query(`
      SELECT
        LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(m.code, N'')))) AS code,
        CASE
          WHEN m.px IS NULL THEN NULL
          WHEN ISNUMERIC(LTRIM(RTRIM(CONVERT(nvarchar(100), m.px)))) = 1
            THEN CONVERT(int, LTRIM(RTRIM(CONVERT(nvarchar(100), m.px))))
          ELSE NULL
        END AS px
      FROM ${BOM_MATERIAL_FROM} AS m
      WHERE LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(m.code, N'')))) IN (${parts.join(', ')})
        AND (ISNULL(m.del, N'') = N'' OR LTRIM(RTRIM(ISNULL(CONVERT(nvarchar(20), m.del), N''))) = N'0')
      ORDER BY m.id DESC
    `)
    for (const r of rs.recordset || []) {
      const code = String(r.code ?? '').trim()
      const px = bomCostParseIntOrNull(r.px)
      if (!code || px == null || out.has(code)) continue
      out.set(code, px)
    }
  }
  return out
}

/**
 * PQ 主 BOM 运算时，按行物料分类补 bom_cost.px。
 * @param {Array<Record<string, unknown>>} rows
 * @param {string} pq
 * @param {Map<string, number>} materialPxMap key = Bom_material.code
 */
export function applyBomCostPxForPqRows(rows, pq, materialPxMap) {
  if (!Array.isArray(rows) || !rows.length) return []
  if (!isPqBomCostHead(pq)) return rows
  return rows.map((row) => {
    const categoryCode = String(row?.kcaa05 ?? '').trim()
    if (!categoryCode || !materialPxMap?.has(categoryCode)) return row
    return {
      ...row,
      px: materialPxMap.get(categoryCode),
    }
  })
}

/**
 * @param {Record<string, unknown>|undefined|null} m
 */
function resolveTypeForBomCost(m) {
  const t = bomCostParseIntOrNull(m?.type)
  return t != null ? t : BOM_COST_DEFAULT_TYPE
}

/**
 * @param {Record<string, unknown>|undefined|null} m
 */
function resolveVersionForBomCost(m) {
  const v = bomCostParseIntOrNull(m?.version)
  return v != null ? v : BOM_COST_DEFAULT_VERSION
}

/**
 * 在运算 payload 上合并 bom_000（不改 kcaa02/kcaa03/kcac04~06/Describe）
 * @param {Array<Record<string, unknown>>} rows buildBomCostInsertPayloadFromFlatUsage 结果
 * @param {Map<string, Record<string, unknown>>} bom000Map
 */
export function enrichBomCostInsertRowsFromBom000(rows, bom000Map) {
  if (!Array.isArray(rows) || !rows.length) return []
  return rows.map((row) => {
    const code = String(row?.kcaa01 ?? '').trim()
    const lk = erpCodeLookupKey(normalizeErpCodeDisplay(code))
    const m = lk ? bom000Map.get(lk) : null
    const unit = m ? String(m.kcaa04 ?? '').trim() : ''
    const describe = String(row?.Describe ?? '').trim()
    const rowGuid = resolveBom000GuidForBomCostRow(m)
    /** @type {Record<string, unknown>} */
    const out = { ...row }
    out.binfo = describe
    out.GUID = rowGuid
    out.systemcode = rowGuid
    if (unit) {
      out.kcac03 = unit
      out.kcaa04 = unit
    }
    out.kcaa02_en = m ? String(m.kcaa02_en ?? '') : ''
    out.kcaa05 = m ? String(m.kcaa05 ?? '') : ''
    out.kcaa11 = m ? String(m.kcaa11 ?? '') : ''
    out.kcaa12 = m?.kcaa12 ?? null
    out.kcaa13 = m?.kcaa13 ?? null
    out.kcaa14 = m?.kcaa14 ?? null
    out.kcaa25 = m ? String(m.kcaa25 ?? '') : ''
    out.kcaa26 = m?.kcaa26 ?? null
    out.kcaa27 = m ? String(m.kcaa27 ?? '') : ''
    out.kcaa28 = m ? String(m.kcaa28 ?? '') : ''
    out.kcaa29 = m ? String(m.kcaa29 ?? '') : ''
    out.kcaa30 = m?.kcaa30 ?? null
    out.kcaa31 = m ? String(m.kcaa31 ?? '') : ''
    out.kcaa32 = m?.kcaa32 ?? null
    out.kcaa33 = m?.kcaa33 ?? null
    out.kcaa34 = m ? String(m.kcaa34 ?? '') : ''
    out.kcaa35 = m ? String(m.kcaa35 ?? '') : ''
    out.location = m ? String(m.location ?? '') : ''
    out.remark = m ? String(m.remark ?? '') : ''
    out.Customer_Name = m ? String(m.Customer_Name ?? '') : ''
    out.type = resolveTypeForBomCost(m)
    out.version = resolveVersionForBomCost(m)
    out.cost_price = m?.cost_price ?? null
    out.sale_price = m?.sale_price ?? null
    return out
  })
}

/**
 * 运算落库审计：uid/uname/utruename/addtime（同一批相同；值来自登录态）
 * @param {Array<Record<string, unknown>>} rows
 * @param {{ actor?: { uidInt?: number|null, uname?: string|null, utruename?: string|null }, addtime?: string }} audit
 */
export function applyBomCostAuditToRows(rows, audit) {
  if (!Array.isArray(rows) || !rows.length) return []
  const actor = audit?.actor ?? {}
  const addtime = String(audit?.addtime ?? '').trim()
  const uidInt =
    actor.uidInt != null && Number.isFinite(Number(actor.uidInt)) && Number(actor.uidInt) > 0
      ? Math.trunc(Number(actor.uidInt))
      : null
  const uid = uidInt != null ? String(uidInt) : null
  const uname = String(actor.uname ?? '').trim() || null
  const utruename = String(actor.utruename ?? '').trim() || null
  return rows.map((row) => ({
    ...row,
    uid,
    uname,
    utruename,
    addtime: addtime || null,
  }))
}

/** 落库列顺序（仅写入 bom_cost 表存在的列） */
const BOM_COST_INSERT_FIELD_SPECS = [
  { key: 'kcaa01', sql: 'kcaa01', kind: 'nv300' },
  { key: 'kcaa02', sql: 'kcaa02', kind: 'nv300' },
  { key: 'top_kcaa01', sql: 'top_kcaa01', kind: 'nv300' },
  { key: 'top_kcaa02', sql: 'top_kcaa02', kind: 'nv300' },
  { key: 'kcaa03', sql: 'kcaa03', kind: 'nv300' },
  { key: 'kcaa04', sql: 'kcaa04', kind: 'nv80' },
  { key: 'kcac03', sql: 'kcac03', kind: 'nv80' },
  { key: 'kcac04', sql: 'kcac04', kind: 'dec' },
  { key: 'kcac05', sql: 'kcac05', kind: 'dec' },
  { key: 'kcac06', sql: 'kcac06', kind: 'dec' },
  { key: 'kcac07', sql: 'kcac07', kind: 'dec_null' },
  { key: 'kcac08', sql: 'kcac08', kind: 'dec_null' },
  { key: 'Describe', sql: '[Describe]', kind: 'nv500' },
  { key: 'binfo', sql: 'binfo', kind: 'nv500' },
  { key: 'GUID', sql: '[GUID]', kind: 'nv300' },
  { key: 'systemcode', sql: 'systemcode', kind: 'nv300' },
  { key: 'uid', sql: 'uid', kind: 'nv50_null' },
  { key: 'uname', sql: 'uname', kind: 'nv50_null' },
  { key: 'utruename', sql: 'utruename', kind: 'nv50_null' },
  { key: 'addtime', sql: 'addtime', kind: 'nv50_null' },
  { key: 'kcaa02_en', sql: 'kcaa02_en', kind: 'nv500' },
  { key: 'kcaa05', sql: 'kcaa05', kind: 'nv300' },
  { key: 'kcaa11', sql: 'kcaa11', kind: 'nv300' },
  { key: 'kcaa12', sql: 'kcaa12', kind: 'int_null' },
  { key: 'kcaa13', sql: 'kcaa13', kind: 'int_null' },
  { key: 'kcaa14', sql: 'kcaa14', kind: 'int_null' },
  { key: 'kcaa25', sql: 'kcaa25', kind: 'nv300' },
  { key: 'kcaa26', sql: 'kcaa26', kind: 'dec_null' },
  { key: 'kcaa27', sql: 'kcaa27', kind: 'nv300' },
  { key: 'kcaa28', sql: 'kcaa28', kind: 'nv300' },
  { key: 'kcaa29', sql: 'kcaa29', kind: 'nv300' },
  { key: 'kcaa30', sql: 'kcaa30', kind: 'dec_null' },
  { key: 'kcaa31', sql: 'kcaa31', kind: 'nv300' },
  { key: 'kcaa32', sql: 'kcaa32', kind: 'dec_null' },
  { key: 'kcaa33', sql: 'kcaa33', kind: 'dec_null' },
  { key: 'kcaa34', sql: 'kcaa34', kind: 'nv300' },
  { key: 'kcaa35', sql: 'kcaa35', kind: 'nv300' },
  { key: 'type', sql: '[type]', kind: 'int' },
  { key: 'location', sql: 'location', kind: 'nv300' },
  { key: 'sale_price', sql: 'sale_price', kind: 'dec_null' },
  { key: 'cost_price', sql: 'cost_price', kind: 'dec_null' },
  { key: 'Customer_Name', sql: 'Customer_Name', kind: 'nv500' },
  { key: 'version', sql: 'version', kind: 'int' },
  { key: 'remark', sql: 'remark', kind: 'nv500' },
  { key: 'px', sql: 'px', kind: 'int_null' },
]

/**
 * @param {import('mssql').Request} req
 * @param {string} param
 * @param {typeof BOM_COST_INSERT_FIELD_SPECS[number]} spec
 * @param {unknown} val
 */
function bindBomCostInsertValue(req, param, spec, val) {
  const DEC = sql.Decimal(28, 10)
  const NV300 = sql.NVarChar(300)
  const NV80 = sql.NVarChar(80)
  const NV500 = sql.NVarChar(500)
  switch (spec.kind) {
    case 'dec':
      req.input(param, DEC, Number.isFinite(Number(val)) ? Number(val) : 0)
      break
    case 'dec_null':
      req.input(
        param,
        DEC,
        val == null || val === '' || !Number.isFinite(Number(val)) ? null : Number(val),
      )
      break
    case 'int':
      req.input(param, sql.Int, Number.isFinite(Number(val)) ? Math.trunc(Number(val)) : 0)
      break
    case 'int_null':
      req.input(
        param,
        sql.Int,
        val == null || val === '' || !Number.isFinite(Number(val)) ? null : Math.trunc(Number(val)),
      )
      break
    case 'nv80':
      req.input(param, NV80, val != null && String(val).trim() !== '' ? String(val).trim() : null)
      break
    case 'nv500':
      req.input(param, NV500, val != null && String(val).trim() !== '' ? String(val).trim() : null)
      break
    case 'nv50_null':
      req.input(param, sql.NVarChar(50), val != null && String(val).trim() !== '' ? String(val).trim() : null)
      break
    default:
      req.input(param, NV300, val != null && String(val).trim() !== '' ? String(val).trim() : null)
  }
}

/**
 * 批量 INSERT 成本用量表（bom_cost / UB_ERP_Bom_pi_cost 等；isok=0 若列存在）
 * @param {import('mssql').ConnectionPool} pool
 * @param {import('mssql').Transaction} tx
 * @param {string} tableName
 * @param {string} pq
 * @param {string} sid
 * @param {Array<Record<string, unknown>>} rows
 */
export async function insertCostBulkEnriched(pool, tx, tableName, pq, sid, rows) {
  if (!rows.length) return
  const tbl = String(tableName ?? BOM_COST_TABLE).trim()
  if (!/^[A-Za-z0-9_]+$/.test(tbl)) return
  const costFrom = `dbo.[${tbl}]`
  const colset = await getCostTableColumnSet(pool, tbl)
  const pqV = String(pq ?? '').trim()
  const sidV = String(sid ?? '').trim()

  /** @type {typeof BOM_COST_INSERT_FIELD_SPECS} */
  const activeSpecs = []
  for (const spec of BOM_COST_INSERT_FIELD_SPECS) {
    if (spec.key === 'px' && (tbl !== BOM_COST_TABLE || !isPqBomCostHead(pqV))) continue
    const colLower =
      spec.key === 'Describe' ? 'describe' : spec.key === 'GUID' ? 'guid' : spec.key.toLowerCase()
    if (colset.has(colLower)) activeSpecs.push(spec)
  }

  const insCols = ['pq', 'sid', ...activeSpecs.map((s) => s.sql), ...(colset.has('isok') ? ['isok'] : [])]
  const paramsPerRow = activeSpecs.length + (colset.has('isok') ? 1 : 0)
  const maxRowsPerChunk = Math.min(50, Math.floor((2000 - 2) / Math.max(paramsPerRow, 1)))

  for (let off = 0; off < rows.length; off += maxRowsPerChunk) {
    const slice = rows.slice(off, off + maxRowsPerChunk)
    const req = new sql.Request(tx)
    req.input('pq', sql.NVarChar(300), pqV)
    req.input('sid', sql.NVarChar(100), sidV)
    const valueTuples = []
    for (let i = 0; i < slice.length; i++) {
      const row = slice[i]
      const pre = `bc${off}_${i}_`
      const placeholders = ['@pq', '@sid']
      for (let s = 0; s < activeSpecs.length; s++) {
        const spec = activeSpecs[s]
        const p = `${pre}${spec.key}`
        bindBomCostInsertValue(req, p, spec, row[spec.key])
        placeholders.push(`@${p}`)
      }
      if (colset.has('isok')) placeholders.push('0')
      valueTuples.push(`(${placeholders.join(', ')})`)
    }
    await req.query(`
      INSERT INTO ${costFrom} (${insCols.join(', ')})
      VALUES ${valueTuples.join(',\n')}
    `)
  }
}

/**
 * 批量 INSERT bom_cost（按物理列动态拼接；isok=0）
 * @param {import('mssql').ConnectionPool} pool
 * @param {import('mssql').Transaction} tx
 * @param {string} pq
 * @param {string} sid
 * @param {Array<Record<string, unknown>>} rows
 */
export async function insertBomCostBulkEnriched(pool, tx, pq, sid, rows) {
  return insertCostBulkEnriched(pool, tx, BOM_COST_TABLE, pq, sid, rows)
}
