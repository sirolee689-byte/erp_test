/**
 * 报价 handler 工厂：采购/外协共用实现，由 createQuotationHandlers(config) 参数化差异列与路由。
 * 零行为变更：逻辑与原先 purchaseQuotationHandlers.js 一致，仅抽取重复。
 */
import { sql } from './db.js'
import { applySupplierCodeColumnFromKehu } from './supplierSCodeLookup.js'
import { invBomMasterFrom } from './bomTables.js'

/**
 * @typedef {{
 *   label: string,
 *   headerTable: string,
 *   lineTable: string,
 *   docNoCol: string,
 *   quoteDateCol: string,
 *   expiryDateCol: string,
 *   supplierCol: string,
 *   lineDocNoCol: string,
 *   lineExclTaxCol: string,
 *   lineInclTaxCol: string,
 *   lineFkCandidates: string[],
 *   apiBase: string,
 *   checkDocNoQueryParam: string,
 * }} QuotationHandlerConfig
 */

/**
 * @param {QuotationHandlerConfig} config
 */
export function createQuotationHandlers(config) {
  const {
    label,
    headerTable: HEADER_TABLE,
    lineTable: LINE_TABLE,
    docNoCol,
    quoteDateCol,
    expiryDateCol,
    supplierCol,
    lineDocNoCol,
    lineExclTaxCol,
    lineInclTaxCol,
    lineFkCandidates,
    apiBase,
    checkDocNoQueryParam,
  } = config

  const HEADER_FROM = `dbo.[${HEADER_TABLE}]`
  const LINE_FROM = `dbo.[${LINE_TABLE}]`
  const SYS_SUPPLIER_FROM = 'dbo.[System_supplier]'

/** INSERT/UPDATE 参数名：避免列名与 T-SQL 保留字冲突（如 decimal） */
function pqSafeParamSuffix(colName) {
  const lower = String(colName ?? '').toLowerCase()
  if (lower === 'decimal') return 'dec_col'
  return String(colName ?? '').replace(/[^a-zA-Z0-9_]/g, '_')
}

/**
 * 报价单号尾部数字 +1（与最大 id 行上的单号规则一致）
 * @param {string} sampleRaw
 */
function incrementQuotationDocNoSuffix(sampleRaw) {
  const sample = String(sampleRaw ?? '').trim()
  if (!sample) return ''
  const m = sample.match(/^(.*?)(\d+)$/)
  if (!m) return `${sample}1`
  const prefix = m[1]
  const numStr = m[2]
  const n = BigInt(numStr) + BigInt(1)
  let next = String(n)
  if (next.length < numStr.length) next = next.padStart(numStr.length, '0')
  return `${prefix}${next}`
}

/** yyyy-MM-dd（本地日历） */
function formatLocalYmd(d = new Date()) {
  const x = d instanceof Date ? d : new Date(d)
  if (Number.isNaN(x.getTime())) return ''
  const y = x.getFullYear()
  const mo = String(x.getMonth() + 1).padStart(2, '0')
  const da = String(x.getDate()).padStart(2, '0')
  return `${y}-${mo}-${da}`
}

/**
 * 写入前归一化 body.header（decimal_view、报价日与 cgaa02 同步）
 * @param {QuotationMeta} meta
 * @param {Record<string, any>} headerIn
 */
function normalizeQuotationHeaderBody(meta, headerIn) {
  const h = { ...(headerIn && typeof headerIn === 'object' ? headerIn : {}) }
  const dec = pickBodyField(h, 'decimal')
  if (
    dec !== undefined &&
    meta.headerColNames.has('decimal_view') &&
    pickBodyField(h, 'decimal_view') === undefined
  ) {
    h.decimal_view = dec
  }
  const addStr = cellStr(pickBodyField(h, 'addtime'))
  const cgaa2 = pickBodyField(h, quoteDateCol)
  if (
    meta.headerColNames.has(quoteDateCol) &&
    (cgaa2 === undefined || cgaa2 === null || cellStr(cgaa2) === '') &&
    addStr
  ) {
    h[quoteDateCol] = addStr
  }
  return h
}

/** 审计 uid：优先数值型 userId，否则原始字符串 */
function actorUidStringForHeader(actor, req) {
  if (actor?.uidInt != null && Number.isFinite(actor.uidInt)) return String(actor.uidInt)
  const u = req?.user
  if (u?.userId != null && String(u.userId).trim() !== '') return String(u.userId).trim()
  return ''
}

/**
 * 明细 INSERT：规则 13 — uid/uname/utruename 由服务端从登录态写入，禁止前端 body 覆盖
 * @param {QuotationMeta} meta
 * @param {import('mssql').Request} lreq
 * @param {string[]} lc
 * @param {string[]} lv
 * @param {{ uidInt: number | null, uname: string | null, utruename: string | null }} actor
 * @param {import('express').Request} req
 * @param {number} lineIdx
 */
function appendQuotationLineAuditTriplet(meta, lreq, lc, lv, actor, req, lineIdx) {
  const uidStrActor = actorUidStringForHeader(actor, req)
  const unameVal =
    String(actor.uname ?? '').trim() ||
    String(actor.utruename ?? '').trim() ||
    String(uidStrActor || '')
  const utruenameVal =
    String(actor.utruename ?? '').trim() ||
    String(actor.uname ?? '').trim() ||
    String(uidStrActor || '')

  const pUid = `L${lineIdx}_pq_uid`
  const pUn = `L${lineIdx}_pq_uname`
  const pUtr = `L${lineIdx}_pq_utruename`

  const uidCmL = colMeta(meta, 'l', 'uid')
  if (meta.lineColNames.has('uid') && uidStrActor) {
    lc.push(bracketIdent('uid'))
    lv.push(`@${pUid}`)
    bindTypedParam(
      lreq,
      pUid,
      uidCmL || {
        name: 'uid',
        dataType: 'nvarchar',
        charMaxLength: 50,
        numericPrecision: null,
        numericScale: null,
      },
      uidStrActor,
    )
  }
  if (meta.lineColNames.has('uname') && unameVal) {
    lc.push(bracketIdent('uname'))
    lv.push(`@${pUn}`)
    bindTypedParam(
      lreq,
      pUn,
      colMeta(meta, 'l', 'uname') || {
        name: 'uname',
        dataType: 'nvarchar',
        charMaxLength: 50,
        numericPrecision: null,
        numericScale: null,
      },
      unameVal,
    )
  }
  if (meta.lineColNames.has('utruename') && utruenameVal) {
    lc.push(bracketIdent('utruename'))
    lv.push(`@${pUtr}`)
    bindTypedParam(
      lreq,
      pUtr,
      colMeta(meta, 'l', 'utruename') || {
        name: 'utruename',
        dataType: 'nvarchar',
        charMaxLength: 50,
        numericPrecision: null,
        numericScale: null,
      },
      utruenameVal,
    )
  }
}

/**
 * @typedef {{
 *   name: string,
 *   dataType: string,
 *   charMaxLength: number,
 *   numericPrecision: number | null,
 *   numericScale: number | null,
 * }} ColMeta
 */

/**
 * @typedef {{
 *   headerPk: string,
 *   linePk: string | null,
 *   lineFk: string,
 *   headerIdentity: string | null,
 *   lineIdentity: string | null,
 *   headerCols: ColMeta[],
 *   lineCols: ColMeta[],
 *   headerColNames: Set<string>,
 *   lineColNames: Set<string>,
 * }} QuotationMeta
 */

/** @type {Promise<QuotationMeta> | null} */
let metaPromise = null

function escapeSqlLikePattern(s) {
  return String(s ?? '')
    .replace(/\[/g, '[[]')
    .replace(/%/g, '[%]')
    .replace(/_/g, '[_]')
}

/** SQL Server 标识符括号转义 */
function bracketIdent(name) {
  const n = String(name ?? '').trim()
  if (!n) return '[]'
  return `[${n.replace(/]/g, ']]')}]`
}

function pickBodyField(body, colName) {
  if (!body || typeof body !== 'object') return undefined
  const target = String(colName ?? '').toLowerCase()
  for (const k of Object.keys(body)) {
    if (String(k).toLowerCase() === target) return body[k]
  }
  return undefined
}

function cellStr(v) {
  if (v === undefined || v === null) return ''
  if (typeof v === 'object' && v instanceof Date) return v.toISOString()
  return String(v).trim()
}

/**
 * @param {import('mssql').ConnectionPool} pool
 * @returns {Promise<QuotationMeta>}
 */
async function loadQuotationMeta(pool) {
  const reqCols = async (table) => {
    const r = await pool
      .request()
      .input('t', sql.NVarChar(128), table)
      .query(`
        SELECT
          COLUMN_NAME AS name,
          DATA_TYPE AS dataType,
          CHARACTER_MAXIMUM_LENGTH AS charMaxLength,
          NUMERIC_PRECISION AS numericPrecision,
          NUMERIC_SCALE AS numericScale
        FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = N'dbo' AND TABLE_NAME = @t
        ORDER BY ORDINAL_POSITION
      `)
    /** @type {ColMeta[]} */
    const out = []
    for (const row of r.recordset ?? []) {
      const name = String(row?.name ?? '').trim()
      if (!name) continue
      out.push({
        name,
        dataType: String(row?.dataType ?? ''),
        charMaxLength: Number(row?.charMaxLength ?? 0),
        numericPrecision: row?.numericPrecision != null ? Number(row.numericPrecision) : null,
        numericScale: row?.numericScale != null ? Number(row.numericScale) : null,
      })
    }
    return out
  }

  const fetchPk = async (table) => {
    const r = await pool
      .request()
      .input('t', sql.NVarChar(128), table)
      .query(`
        SELECT kcu.COLUMN_NAME AS name
        FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS tc
        INNER JOIN INFORMATION_SCHEMA.KEY_COLUMN_USAGE kcu
          ON tc.CONSTRAINT_NAME = kcu.CONSTRAINT_NAME
          AND tc.TABLE_SCHEMA = kcu.TABLE_SCHEMA
        WHERE tc.TABLE_SCHEMA = N'dbo'
          AND tc.TABLE_NAME = @t
          AND tc.CONSTRAINT_TYPE = N'PRIMARY KEY'
        ORDER BY kcu.ORDINAL_POSITION
      `)
    return (r.recordset ?? []).map((x) => String(x?.name ?? '').trim()).filter(Boolean)
  }

  const fetchIdentity = async (table) => {
    const r = await pool
      .request()
      .input('t', sql.NVarChar(128), table)
      .query(`
        SELECT c.name AS colName
        FROM sys.tables AS t
        INNER JOIN sys.columns AS c ON t.object_id = c.object_id
        INNER JOIN sys.identity_columns AS ic
          ON ic.object_id = c.object_id AND ic.column_id = c.column_id
        WHERE SCHEMA_NAME(t.schema_id) = N'dbo' AND t.name = @t
      `)
    const n = r.recordset?.[0]?.colName
    return n ? String(n).trim() : null
  }

  const resolveLineFk = async (lineCols) => {
    const r = await pool.request().query(`
      SELECT COL_NAME(fc.parent_object_id, fc.parent_column_id) AS fk_col
      FROM sys.foreign_keys AS fk
      INNER JOIN sys.foreign_key_columns AS fc ON fk.object_id = fc.constraint_object_id
      INNER JOIN sys.tables AS tp ON fk.referenced_object_id = tp.object_id
      INNER JOIN sys.tables AS tc ON fk.parent_object_id = tc.object_id
      WHERE SCHEMA_NAME(tp.schema_id) = N'dbo' AND tp.name = N'${HEADER_TABLE}'
        AND SCHEMA_NAME(tc.schema_id) = N'dbo' AND tc.name = N'${LINE_TABLE}'
    `)
    const fk = r.recordset?.[0]?.fk_col != null ? String(r.recordset[0].fk_col).trim() : ''
    if (fk) return fk
    const lowerSet = new Set(lineCols.map((c) => c.name.toLowerCase()))
    const candidates = lineFkCandidates
    for (const c of candidates) {
      if (!lowerSet.has(c.toLowerCase())) continue
      const hit = lineCols.find((x) => x.name.toLowerCase() === c.toLowerCase())
      if (hit) return hit.name
    }
    throw new Error(
      `[${label}] 未找到 ${LINE_TABLE} 指向 ${HEADER_TABLE} 的外键列；请在库中建立外键或为明细表增加 pid 等关联列`,
    )
  }

  const headerCols = await reqCols(HEADER_TABLE)
  const lineCols = await reqCols(LINE_TABLE)
  if (!headerCols.length) throw new Error(`[${label}] 表 ${HEADER_TABLE} 无列或不存在`)
  if (!lineCols.length) throw new Error(`[${label}] 表 ${LINE_TABLE} 无列或不存在`)

  const pkH = await fetchPk(HEADER_TABLE)
  if (pkH.length !== 1) {
    throw new Error(`[${label}] ${HEADER_TABLE} 需要单列主键，当前：${pkH.join(',') || '无'}`)
  }
  const headerPk = pkH[0]

  const pkL = await fetchPk(LINE_TABLE)
  const linePk = pkL.length === 1 ? pkL[0] : null

  const lineFk = await resolveLineFk(lineCols)
  const headerIdentity = await fetchIdentity(HEADER_TABLE)
  const lineIdentity = await fetchIdentity(LINE_TABLE)

  return {
    headerPk,
    linePk,
    lineFk,
    headerIdentity,
    lineIdentity,
    headerCols,
    lineCols,
    headerColNames: new Set(headerCols.map((c) => c.name.toLowerCase())),
    lineColNames: new Set(lineCols.map((c) => c.name.toLowerCase())),
  }
}

/**
 * @param {import('mssql').ConnectionPool} pool
 */
async function ensureQuotationMeta(pool) {
  if (!metaPromise) metaPromise = loadQuotationMeta(pool)
  try {
    return await metaPromise
  } catch (e) {
    metaPromise = null
    throw e
  }
}

/** 模块测试或迁移后可调用 */
function invalidateQuotationMetaCache() {
  metaPromise = null
}

/**
 * @param {QuotationMeta} meta
 * @param {'h' | 'l'} table
 * @param {string} colName
 * @returns {ColMeta | null}
 */
function colMeta(meta, table, colName) {
  const cols = table === 'l' ? meta.lineCols : meta.headerCols
  const key = String(colName ?? '').toLowerCase()
  return cols.find((c) => c.name.toLowerCase() === key) ?? null
}

/** 是否按字符串方式绑定（避免 int 与 nvarchar 比较时隐式转换失败） */
function isStringishSqlType(dataType) {
  const d = String(dataType ?? '').toLowerCase()
  return d.includes('char') || d === 'text' || d === 'ntext'
}

/**
 * 主键/明细外键条件绑定（与列类型一致）
 * @param {import('mssql').Request} rq
 * @param {string} pname
 * @param {ColMeta | null} cm
 * @param {string | number | bigint} value
 */
function bindPkOrFkParam(rq, pname, cm, value) {
  if (!cm || isStringishSqlType(cm.dataType)) {
    rq.input(pname, sql.NVarChar(200), value == null ? '' : String(value).trim())
    return
  }
  const d = String(cm.dataType ?? '').toLowerCase()
  if (d === 'bigint') {
    try {
      const bi = typeof value === 'bigint' ? value : BigInt(String(value))
      rq.input(pname, sql.BigInt, bi)
    } catch {
      rq.input(pname, sql.BigInt, BigInt(0))
    }
    return
  }
  if (d === 'int' || d === 'smallint' || d === 'tinyint') {
    const n = typeof value === 'number' ? value : Number(value)
    rq.input(pname, sql.Int, Number.isFinite(n) ? Math.trunc(n) : 0)
    return
  }
  rq.input(pname, sql.NVarChar(200), value == null ? '' : String(value).trim())
}

function pickRowCaseInsensitive(row, colName) {
  if (!row || !colName) return undefined
  const target = String(colName).toLowerCase()
  for (const k of Object.keys(row)) {
    if (String(k).toLowerCase() === target) return row[k]
  }
  return undefined
}

/**
 * 路由 / 查询参数中的主表键（支持字符串单号）
 * @returns {{ ok: true, value: string | number } | { ok: false, msg: string }}
 */
function parseRouteHeaderKey(raw, meta) {
  const s0 = raw == null ? '' : String(raw).trim()
  if (!s0) return { ok: false, msg: '参数错误：id' }
  let s = s0
  try {
    s = decodeURIComponent(s0).trim()
  } catch {
    s = s0
  }
  const pkCol = colMeta(meta, 'h', meta.headerPk)
  if (!pkCol) return { ok: false, msg: '参数错误：id' }
  if (isStringishSqlType(pkCol.dataType)) {
    if (!s) return { ok: false, msg: '参数错误：id' }
    return { ok: true, value: s }
  }
  const n = Number(s)
  if (!Number.isFinite(n) || n <= 0) return { ok: false, msg: '参数错误：id' }
  return { ok: true, value: Math.trunc(n) }
}

/**
 * body.id 主表键
 * @returns {{ ok: true, value: string | number } | { ok: false, msg: string }}
 */
function parseBodyHeaderKey(raw, meta) {
  if (raw === undefined || raw === null) return { ok: false, msg: '参数错误：id' }
  const pkCol = colMeta(meta, 'h', meta.headerPk)
  if (!pkCol) return { ok: false, msg: '参数错误：id' }
  if (isStringishSqlType(pkCol.dataType)) {
    const s = String(raw).trim()
    if (!s) return { ok: false, msg: '参数错误：id' }
    return { ok: true, value: s }
  }
  const n = typeof raw === 'number' ? raw : Number(raw)
  if (!Number.isFinite(n) || n <= 0) return { ok: false, msg: '参数错误：id' }
  return { ok: true, value: Math.trunc(n) }
}

/**
 * @param {ColMeta} cm
 * @param {any} rawVal
 * @param {import('mssql').Request} rq
 * @param {string} pname
 */
function bindTypedParam(rq, pname, cm, rawVal) {
  const dt = String(cm?.dataType ?? '').toLowerCase()
  if (rawVal === undefined) {
    rq.input(pname, sql.NVarChar(sql.MAX), null)
    return
  }
  if (dt === 'bit') {
    const b = rawVal === true || rawVal === 1 || rawVal === '1' || rawVal === 'true'
    rq.input(pname, sql.Bit, b ? 1 : 0)
    return
  }
  if (dt === 'int' || dt === 'smallint' || dt === 'tinyint') {
    const n = Number(rawVal)
    rq.input(pname, sql.Int, Number.isFinite(n) ? Math.trunc(n) : 0)
    return
  }
  if (dt === 'bigint') {
    try {
      rq.input(pname, sql.BigInt, BigInt(String(rawVal)))
    } catch {
      rq.input(pname, sql.BigInt, BigInt(0))
    }
    return
  }
  if (dt === 'decimal' || dt === 'numeric' || dt === 'money' || dt === 'smallmoney') {
    const n = Number(rawVal)
    const prec = cm.numericPrecision && cm.numericPrecision > 0 ? cm.numericPrecision : 18
    const scale = cm.numericScale != null && cm.numericScale >= 0 ? cm.numericScale : 4
    rq.input(pname, sql.Decimal(prec, scale), Number.isFinite(n) ? n : 0)
    return
  }
  if (dt === 'float' || dt === 'real') {
    const n = Number(rawVal)
    rq.input(pname, sql.Float, Number.isFinite(n) ? n : 0)
    return
  }
  if (dt === 'datetime' || dt === 'datetime2' || dt === 'smalldatetime' || dt === 'date') {
    const s = String(rawVal ?? '').trim()
    if (!s) {
      rq.input(pname, sql.NVarChar(50), null)
      return
    }
    const d = new Date(s)
    if (!Number.isNaN(d.getTime())) rq.input(pname, sql.DateTime, d)
    else rq.input(pname, sql.NVarChar(50), s)
    return
  }
  if (dt === 'nvarchar' || dt === 'varchar' || dt === 'nchar' || dt === 'char' || dt === 'text' || dt === 'ntext') {
    const s = rawVal == null ? '' : String(rawVal)
    const len = cm.charMaxLength === -1 ? sql.MAX : Math.min(4000, Math.max(1, cm.charMaxLength || 4000))
    rq.input(pname, sql.NVarChar(len), s)
    return
  }
  rq.input(pname, sql.NVarChar(sql.MAX), rawVal == null ? '' : String(rawVal))
}

/**
 * @param {QuotationMeta} meta
 * @param {Record<string, any>} row
 */
function getQuotationDisplayLabel(meta, row) {
  const candidates = [
    docNoCol,
    'systemcode',
    'SystemCode',
    'code',
    'quotation_code',
    'dh',
    'djbh',
    'bill_no',
    '单据编号',
  ]
  for (const k of candidates) {
    const v = pickBodyField(row, k)
    const s = cellStr(v)
    if (s) return s
  }
  const idv = pickBodyField(row, meta.headerPk)
  return idv != null ? `单据#${idv}` : `${label}`
}

/**
 * 供操作审计 prepare 阶段读取主表快照
 * @param {import('mssql').ConnectionPool} pool
 * @param {string | number} id
 */
async function fetchQuotationSnapshotForAudit(pool, id) {
  const meta = await ensureQuotationMeta(pool)
  const pk = meta.headerPk
  const pkCol = colMeta(meta, 'h', pk)
  const docCandidates = [docNoCol, 'systemcode', 'code', 'quotation_code', 'dh', 'djbh'].filter((c) =>
    meta.headerColNames.has(c.toLowerCase()),
  )
  const sel = [
    `${bracketIdent(pk)} AS pk_val`,
    ...(meta.headerColNames.has('pass') ? [`LTRIM(RTRIM(CONVERT(nvarchar(20), ISNULL(${bracketIdent('pass')}, N'')))) AS pass`] : []),
    ...(meta.headerColNames.has('del') ? [`LTRIM(RTRIM(CONVERT(nvarchar(20), ISNULL(${bracketIdent('del')}, N'')))) AS del`] : []),
    ...docCandidates.map((c) => `LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(${bracketIdent(c)}, N'')))) AS ${bracketIdent(c)}`),
  ]
  const rq = pool.request()
  bindPkOrFkParam(rq, 'id', pkCol, id)
  const r = await rq.query(`
    SELECT TOP 1 ${sel.join(', ')}
    FROM ${HEADER_FROM} AS h
    WHERE h.${bracketIdent(pk)} = @id
  `)
  const row = r.recordset?.[0]
  if (!row) return null
  const pkRaw = pickRowCaseInsensitive(row, 'pk_val')
  const out = {
    id: pkRaw !== undefined && pkRaw !== null ? pkRaw : id,
    pass: String(row.pass ?? ''),
    del: String(row.del ?? ''),
  }
  for (const c of docCandidates) {
    const k = c.toLowerCase()
    if (row[c] !== undefined) out[k] = String(row[c] ?? '')
  }
  return out
}

/**
 * @param {Record<string, any>} oldRow
 * @param {Record<string, any>} body
 */
function buildQuotationPutDiffChinese(oldRow, body) {
  const header = body?.header && typeof body.header === 'object' ? body.header : {}
  const parts = []
  const keys = new Set([...Object.keys(oldRow || {}), ...Object.keys(header)])
  for (const k of keys) {
    if (String(k).toLowerCase() === 'id') continue
    const oldV = cellStr(oldRow?.[k])
    const newV = cellStr(pickBodyField(header, k))
    if (oldV === newV) continue
    parts.push(`[${k}]：${oldV || '空'} → ${newV || '空'}`)
  }
  if (!parts.length) return '未检测到主表字段变更（明细整体保存未在此展开逐列比对）。'
  return `主表变更：${parts.join('；')}`
}

/**
 * 保存前读取主表整行（用于审计差异比对）
 * @param {import('mssql').ConnectionPool} pool
 * @param {string | number} id
 */
async function fetchQuotationHeaderFullForAudit(pool, id) {
  const meta = await ensureQuotationMeta(pool)
  const pk = meta.headerPk
  const pkCol = colMeta(meta, 'h', pk)
  const rq = pool.request()
  bindPkOrFkParam(rq, 'id', pkCol, id)
  const r = await rq.query(`
    SELECT TOP 1 *
    FROM ${HEADER_FROM}
    WHERE ${bracketIdent(pk)} = @id
  `)
  return r.recordset?.[0] ?? null
}

function headerListProjectionSql(meta) {
  return meta.headerCols
    .map((c) => {
      const b = bracketIdent(c.name)
      if (c.dataType.toLowerCase() === 'xml') return `CONVERT(nvarchar(max), ISNULL(h.${b}, N'')) AS ${b}`
      return `h.${b} AS ${b}`
    })
    .join(',\n          ')
}

function lineListProjectionSql(meta) {
  return meta.lineCols
    .map((c) => {
      const b = bracketIdent(c.name)
      if (c.dataType.toLowerCase() === 'xml') return `CONVERT(nvarchar(max), ISNULL(l.${b}, N'')) AS ${b}`
      return `l.${b} AS ${b}`
    })
    .join(',\n          ')
}

function lineOrderBy(meta) {
  const orderCols = ['Seq', 'seq', 'xh', 'sort', 'line_no', 'line_no_', 'xuhao']
  for (const oc of orderCols) {
    if (meta.lineColNames.has(oc.toLowerCase())) return `l.${bracketIdent(meta.lineCols.find((x) => x.name.toLowerCase() === oc.toLowerCase()).name)} ASC`
  }
  if (meta.linePk) return `l.${bracketIdent(meta.linePk)} ASC`
  return `1 ASC`
}

function keywordOrClause(meta, kwParamName) {
  const textish = (dt) => {
    const d = String(dt || '').toLowerCase()
    return (
      d.includes('char') ||
      d.includes('text') ||
      d === 'nvarchar' ||
      d === 'varchar' ||
      d === 'nchar' ||
      d === 'char'
    )
  }
  const cols = meta.headerCols.filter((c) => textish(c.dataType)).slice(0, 14)
  if (!cols.length) return '1=0'
  return cols
    .map(
      (c) =>
        `LTRIM(RTRIM(CONVERT(nvarchar(max), ISNULL(h.${bracketIdent(c.name)}, N'')))) LIKE @${kwParamName}`,
    )
    .join(' OR ')
}

function docNoColumns(meta) {
  return [docNoCol, 'systemcode', 'code', 'quotation_code', 'dh', 'djbh', 'bill_no'].filter((c) =>
    meta.headerColNames.has(c.toLowerCase()),
  )
}

/** 主表上与明细字符串外键对应的单号列（优先 cgaa01） */
function headerDocLinkColumn(meta) {
  const order = [docNoCol, ...docNoColumns(meta).filter((c) => c.toLowerCase() !== docNoCol)]
  const seen = new Set()
  for (const c of order) {
    const k = c.toLowerCase()
    if (seen.has(k)) continue
    seen.add(k)
    if (meta.headerColNames.has(k)) return c
  }
  return null
}

/**
 * 数字主键 + 明细 nvarchar 外键：用主表单号列查明细关联值
 * @param {import('mssql').ConnectionPool} pool
 * @param {QuotationMeta} meta
 * @param {string | number} headerPkVal
 */
async function fetchLineFilterStringFromNumericHeader(pool, meta, headerPkVal) {
  const docCol = headerDocLinkColumn(meta)
  if (!docCol) {
    throw new Error(`[${label}] 主表缺少 ${docNoCol}/单号列，无法按明细外键类型关联`)
  }
  const pkCol = colMeta(meta, 'h', meta.headerPk)
  const rq = pool.request()
  bindPkOrFkParam(rq, 'id', pkCol, headerPkVal)
  const r = await rq.query(`
    SELECT TOP 1 ${bracketIdent(docCol)} AS linkv
    FROM ${HEADER_FROM}
    WHERE ${bracketIdent(meta.headerPk)} = @id
  `)
  const v = r.recordset?.[0]?.linkv
  return v == null ? '' : String(v).trim()
}

/** 从主表行得到明细字符串外键应匹配的值（cgaa01= cgab01） */
function headerLineLinkFromHeaderRow(meta, headerRow) {
  const docCol = headerDocLinkColumn(meta)
  if (docCol) {
    const v = pickRowCaseInsensitive(headerRow, docCol)
    const s = cellStr(v)
    if (s) return s
  }
  const pkCol = colMeta(meta, 'h', meta.headerPk)
  if (pkCol && isStringishSqlType(pkCol.dataType)) {
    return cellStr(pickRowCaseInsensitive(headerRow, meta.headerPk))
  }
  return ''
}

function lineFkStringValueForInsert(meta, headerIn, newPkRaw) {
  const docCol = headerDocLinkColumn(meta)
  if (docCol) {
    const v = pickBodyField(headerIn, docCol)
    const s = cellStr(v)
    if (s) return s
  }
  const pkCol = colMeta(meta, 'h', meta.headerPk)
  if (pkCol && isStringishSqlType(pkCol.dataType)) {
    return cellStr(pickBodyField(headerIn, meta.headerPk)) || cellStr(newPkRaw)
  }
  return cellStr(newPkRaw)
}

/** UB_ERP ${label}：主表 cgaa01 = 明细 cgab01，列表汇总 cgab04/cgab05 */
function hasUbErpQuotationListAgg(meta) {
  return (
    meta.headerColNames.has(docNoCol) &&
    meta.lineColNames.has(lineDocNoCol) &&
    meta.lineColNames.has(lineExclTaxCol) &&
    meta.lineColNames.has(lineInclTaxCol)
  )
}

function sqlLineDelActiveClause(meta, alias = 'l') {
  const b = bracketIdent('del')
  const p = `${alias}.${b}`
  if (!meta.lineColNames.has('del')) return '1 = 1'
  return `(ISNULL(${p}, N'') = N'' OR ${p} = N'0')`
}

/**
 * 列表附加：明细行数、不含税/含税/税点合计；报价日 cgaa02、有效期 cgaa07 格式 yyyy-MM-dd
 */
function ubQuotationListAggSelectFragments(meta) {
  const cgab01 = bracketIdent(lineDocNoCol)
  const cgab04 = bracketIdent(lineExclTaxCol)
  const cgab05 = bracketIdent(lineInclTaxCol)
  const cgaa01 = bracketIdent(docNoCol)
  const lineWhere = sqlLineDelActiveClause(meta, 'l')

  const aggInner = `
      SELECT
        LTRIM(RTRIM(CONVERT(nvarchar(50), ISNULL(l.${cgab01}, N'')))) AS pq_link,
        COUNT(1) AS pq_line_count,
        SUM(CAST(ISNULL(l.${cgab04}, 0) AS decimal(18,6))) AS pq_sum_excl_tax,
        SUM(CAST(ISNULL(l.${cgab05}, 0) AS decimal(18,6))) AS pq_sum_incl_tax
      FROM ${LINE_FROM} AS l
      WHERE ${lineWhere}
      GROUP BY LTRIM(RTRIM(CONVERT(nvarchar(50), ISNULL(l.${cgab01}, N''))))
  `.trim()

  const joinOn = `pq_agg.pq_link = LTRIM(RTRIM(CONVERT(nvarchar(50), ISNULL(h.${cgaa01}, N''))))`

  const parts = [
    `ISNULL(pq_agg.pq_line_count, 0) AS pq_line_count`,
    `CAST(ISNULL(pq_agg.pq_sum_excl_tax, 0) AS decimal(18,6)) AS pq_sum_excl_tax`,
    `CAST(ISNULL(pq_agg.pq_sum_incl_tax, 0) AS decimal(18,6)) AS pq_sum_incl_tax`,
    `CAST(ISNULL(pq_agg.pq_sum_incl_tax, 0) - ISNULL(pq_agg.pq_sum_excl_tax, 0) AS decimal(18,6)) AS pq_tax_amount`,
  ]
  if (meta.headerColNames.has(quoteDateCol)) {
    const c2 = bracketIdent(quoteDateCol)
    parts.push(
      `CASE WHEN h.${c2} IS NULL THEN N'' ELSE CONVERT(nvarchar(10), h.${c2}, 23) END AS pq_quote_date_display`,
    )
  } else {
    parts.push(`CAST(N'' AS nvarchar(10)) AS pq_quote_date_display`)
  }
  if (meta.headerColNames.has(expiryDateCol)) {
    const c7 = bracketIdent(expiryDateCol)
    parts.push(
      `CASE WHEN h.${c7} IS NULL THEN N'' ELSE CONVERT(nvarchar(10), h.${c7}, 23) END AS pq_valid_until_display`,
    )
  } else {
    parts.push(`CAST(N'' AS nvarchar(10)) AS pq_valid_until_display`)
  }

  return { aggInner, joinOn, extraCols: parts.join(',\n            ') }
}

/**
 * @param {import('express').Express} app
 * @param {{
 *   getPool: () => Promise<import('mssql').ConnectionPool>,
 *   formatBomColorcodeTimestamp: (d?: Date) => string,
 *   getActorAuditTripletFromReq: (req: any) => { uidInt: number | null, uname: string, utruename: string },
 * }} deps
 */
function registerQuotationRoutes(app, deps) {
  const { getPool, formatBomColorcodeTimestamp, getActorAuditTripletFromReq } = deps

  /** 未审且在册（用于保存/审核前状态匹配） */
  function sqlWhereNotAuditedInCatalog(meta) {
    const parts = []
    if (meta.headerColNames.has('pass')) {
      parts.push(`LTRIM(RTRIM(ISNULL(${bracketIdent('pass')}, N''))) <> N'1'`)
    }
    if (meta.headerColNames.has('del')) {
      parts.push(`(ISNULL(${bracketIdent('del')}, N'') = N'' OR ${bracketIdent('del')} = N'0')`)
    }
    return parts.length ? ` AND ${parts.join(' AND ')}` : ''
  }

  /** 已审且在册 */
  function sqlWhereAuditedInCatalog(meta) {
    const parts = [`LTRIM(RTRIM(ISNULL(${bracketIdent('pass')}, N''))) = N'1'`]
    if (meta.headerColNames.has('del')) {
      parts.push(`(ISNULL(${bracketIdent('del')}, N'') = N'' OR ${bracketIdent('del')} = N'0')`)
    }
    return ` AND ${parts.join(' AND ')}`
  }

  /** 软删 WHERE：在册且未审 */
  function sqlWhereSoftDeleteOk(meta) {
    const parts = []
    if (meta.headerColNames.has('del')) {
      parts.push(`(ISNULL(${bracketIdent('del')}, N'') = N'' OR ${bracketIdent('del')} = N'0')`)
    }
    if (meta.headerColNames.has('pass')) {
      parts.push(`LTRIM(RTRIM(ISNULL(${bracketIdent('pass')}, N''))) <> N'1'`)
    }
    return parts.length ? ` AND ${parts.join(' AND ')}` : ''
  }

  /**
   * GET ${apiBase}/bom-detail?kcaa01=
   * 按材料编码读取 BOM 主档一行（在册），供明细「查看」；权限使用${label} view
   */
  app.get(`${apiBase}/bom-detail`, async (req, res) => {
    try {
      const code = String(req.query?.kcaa01 ?? '').trim()
      if (!code) {
        res.status(400).json({ code: 400, msg: '参数错误：kcaa01', data: null })
        return
      }
      const pool = await getPool()
      const bomFrom = invBomMasterFrom()
      const r = await pool.request().input('code', sql.NVarChar(200), code).query(`
        SELECT TOP 1 *
        FROM ${bomFrom} AS b
        WHERE LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(b.kcaa01, N'')))) = @code
          AND (ISNULL(b.del, N'') = N'' OR b.del = N'0')
      `)
      const row = r.recordset?.[0] ?? null
      if (!row) {
        res.status(404).json({ code: 404, msg: '未找到该材料编码对应的 BOM 资料', data: null })
        return
      }
      /** @type {Record<string, unknown>} */
      const safe = {}
      for (const [k, v] of Object.entries(row)) {
        if (v instanceof Date) safe[k] = v.toISOString()
        else if (typeof Buffer !== 'undefined' && Buffer.isBuffer(v)) safe[k] = `[binary:${v.length}]`
        else safe[k] = v
      }
      res.json({ code: 200, msg: 'success', data: { bom: safe } })
    } catch (err) {
      console.error(`GET ${apiBase}/bom-detail 失败：`, err)
      const detail = String(err?.message ?? err?.originalError?.message ?? '数据库查询失败')
      res.status(500).json({ code: 500, msg: `读取 BOM 资料失败：${detail}`, data: null })
    }
  })

  /**
   * GET ${apiBase}/list
   */
  app.get(`${apiBase}/list`, async (req, res) => {
    try {
      const pool = await getPool()
      const meta = await ensureQuotationMeta(pool)

      const page = Math.max(1, Number(req.query?.page ?? 1) || 1)
      const pageSizeRaw = Number(req.query?.pageSize ?? 20) || 20
      const pageSize = Math.min(100, Math.max(1, pageSizeRaw))

      const recycledRaw = String(req.query?.recycled ?? '').trim().toLowerCase()
      const recycled = recycledRaw === '1' || recycledRaw === 'true' || recycledRaw === 'yes'

      const passRaw = String(req.query?.pass ?? '1').trim()
      const pass = passRaw === '0' ? '0' : '1'

      const keywordRaw = String(req.query?.keyword ?? '').trim()
      const hasKeyword = keywordRaw.length > 0
      const kwPat = hasKeyword ? `%${escapeSqlLikePattern(keywordRaw)}%` : ''

      const hasDel = meta.headerColNames.has('del')
      const hasPass = meta.headerColNames.has('pass')
      const pk = meta.headerPk

      let whereExtra = ''
      if (recycled && hasDel) {
        whereExtra += ` AND LTRIM(RTRIM(ISNULL(h.${bracketIdent('del')}, N''))) = N'1' `
      } else if (!recycled && hasDel) {
        whereExtra += ` AND (ISNULL(h.${bracketIdent('del')}, N'') = N'' OR h.${bracketIdent('del')} = N'0') `
      }
      if (!recycled && hasPass) {
        whereExtra += ` AND LTRIM(RTRIM(ISNULL(h.${bracketIdent('pass')}, N''))) = @pass `
      }
      if (hasKeyword) {
        whereExtra += ` AND (${keywordOrClause(meta, 'kw')}) `
      }

      const countReq = pool.request()
      if (!recycled && hasPass) countReq.input('pass', sql.NVarChar(10), pass)
      if (hasKeyword) countReq.input('kw', sql.NVarChar(400), kwPat)

      const totalRow = await countReq.query(`
        SELECT COUNT(1) AS total
        FROM ${HEADER_FROM} AS h
        WHERE 1 = 1
        ${whereExtra}
      `)
      const total = Number(totalRow.recordset?.[0]?.total ?? 0)

      const safeOffset = (page - 1) * pageSize
      const startRow = safeOffset + 1
      const endRow = safeOffset + pageSize

      const listReq = pool.request()
      if (!recycled && hasPass) listReq.input('pass', sql.NVarChar(10), pass)
      listReq.input('startRow', sql.Int, startRow)
      listReq.input('endRow', sql.Int, endRow)
      if (hasKeyword) listReq.input('kw', sql.NVarChar(400), kwPat)

      const proj = headerListProjectionSql(meta)
      const orderPkDesc = `h.${bracketIdent(pk)} DESC`

      let listSql
      if (hasUbErpQuotationListAgg(meta)) {
        const { aggInner, joinOn, extraCols } = ubQuotationListAggSelectFragments(meta)
        listSql = `
        SELECT x.*
        FROM (
          SELECT
            ${proj},
            ${extraCols},
            ROW_NUMBER() OVER (ORDER BY ${orderPkDesc}) AS rn
          FROM ${HEADER_FROM} AS h
          LEFT JOIN (
            ${aggInner}
          ) AS pq_agg ON ${joinOn}
          WHERE 1 = 1
          ${whereExtra}
        ) AS x
        WHERE x.rn BETWEEN @startRow AND @endRow
        ORDER BY x.rn
      `
      } else {
        listSql = `
        SELECT x.*
        FROM (
          SELECT
            ${proj},
            ROW_NUMBER() OVER (ORDER BY ${orderPkDesc}) AS rn
          FROM ${HEADER_FROM} AS h
          WHERE 1 = 1
          ${whereExtra}
        ) AS x
        WHERE x.rn BETWEEN @startRow AND @endRow
        ORDER BY x.rn
      `
      }

      const listResult = await listReq.query(listSql)

      const list = (listResult.recordset ?? []).map((row) => {
        const { rn: _rn, ...rest } = row ?? {}
        const o = { ...rest }
        if (o.pq_line_count != null) o.pq_line_count = Number(o.pq_line_count)
        if (o.pq_sum_excl_tax != null) o.pq_sum_excl_tax = Number(o.pq_sum_excl_tax)
        if (o.pq_sum_incl_tax != null) o.pq_sum_incl_tax = Number(o.pq_sum_incl_tax)
        if (o.pq_tax_amount != null) o.pq_tax_amount = Number(o.pq_tax_amount)
        const pkVal = pickRowCaseInsensitive(o, pk)
        if (pkVal !== undefined && pkVal !== null) o.id = pkVal
        return o
      })
      res.json({ code: 200, msg: 'success', data: { total, list } })
    } catch (err) {
      console.error(`GET ${apiBase}/list 失败：`, err)
      const detail = String(err?.message ?? err?.originalError?.message ?? '数据库查询失败')
      res.status(500).json({ code: 500, msg: `读取${label}列表失败：${detail}`, data: null })
    }
  })

  /**
   * GET ${apiBase}/suggest-doc-no
   * 按最大主键行上的单号列自增 1，供新增默认单号
   */
  app.get(`${apiBase}/suggest-doc-no`, async (req, res) => {
    try {
      const pool = await getPool()
      const meta = await ensureQuotationMeta(pool)
      const pk = meta.headerPk
      const docCol = headerDocLinkColumn(meta)
      if (!docCol) {
        res.status(500).json({ code: 500, msg: `主表缺少单号列（${docNoCol} 等）`, data: null })
        return
      }
      const r = await pool.request().query(`
        SELECT TOP 1
          ${bracketIdent(pk)} AS pk_val,
          LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(${bracketIdent(docCol)}, N'')))) AS doc_no
        FROM ${HEADER_FROM}
        ORDER BY ${bracketIdent(pk)} DESC
      `)
      const row = r.recordset?.[0]
      const lastId = row?.pk_val
      const lastNo = row?.doc_no != null ? String(row.doc_no).trim() : ''
      const suggested = lastNo ? incrementQuotationDocNoSuffix(lastNo) : ''
      res.json({
        code: 200,
        msg: 'success',
        data: { lastId: lastId ?? null, lastNo, suggested },
      })
    } catch (err) {
      console.error(`GET ${apiBase}/suggest-doc-no 失败：`, err)
      const detail = String(err?.message ?? err?.originalError?.message ?? '数据库查询失败')
      res.status(500).json({ code: 500, msg: `获取建议单号失败：${detail}`, data: null })
    }
  })

  /**
   * GET ${apiBase}/check-doc-no?${checkDocNoQueryParam}=
   */
  app.get(`${apiBase}/check-doc-no`, async (req, res) => {
    try {
      const pool = await getPool()
      const meta = await ensureQuotationMeta(pool)
      const code = String(req.query?.[checkDocNoQueryParam] ?? '').trim()
      if (!code) {
        res.status(400).json({ code: 400, msg: `参数错误：${checkDocNoQueryParam}`, data: null })
        return
      }
      const errMsg = await assertDocNoUnique(pool, meta, code, null)
      res.json({
        code: 200,
        msg: 'success',
        data: { available: !errMsg, message: errMsg || '' },
      })
    } catch (err) {
      console.error(`GET ${apiBase}/check-doc-no 失败：`, err)
      const detail = String(err?.message ?? err?.originalError?.message ?? '数据库查询失败')
      res.status(500).json({ code: 500, msg: `检测单号失败：${detail}`, data: null })
    }
  })

  /**
   * GET ${apiBase}/supplier-options?keyword=&limit=
   * 已审核且在册供应商（System_supplier），用于报价「供应商/外协商」下拉
   */
  app.get(`${apiBase}/supplier-options`, async (req, res) => {
    try {
      const pool = await getPool()
      const keywordRaw = String(req.query?.keyword ?? '').trim()
      const limitRaw = Number(req.query?.limit ?? 30) || 30
      const limit = Math.min(50, Math.max(1, limitRaw))
      const hasKw = keywordRaw.length > 0
      const kwPat = hasKw ? `%${escapeSqlLikePattern(keywordRaw)}%` : '%'

      const rq = pool.request().input('pass', sql.NVarChar(10), '1').input('lim', sql.Int, limit)
      if (hasKw) rq.input('kw', sql.NVarChar(200), kwPat)
      const kwClause = hasKw
        ? ` AND (s.s_name LIKE @kw OR s.s_code LIKE @kw OR s.s_sname LIKE @kw) `
        : ''

      const r = await rq.query(`
        SELECT TOP (@lim)
          s.id,
          LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(s.s_code, N'')))) AS s_code,
          LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(s.s_name, N'')))) AS s_name
        FROM ${SYS_SUPPLIER_FROM} AS s
        WHERE (ISNULL(s.del, N'') = N'' OR s.del = N'0')
          AND LTRIM(RTRIM(ISNULL(s.pass, N''))) = @pass
          AND LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(s.s_name, N'')))) <> N''
          ${kwClause}
        ORDER BY s.s_name ASC
      `)

      res.json({ code: 200, msg: 'success', data: { list: r.recordset ?? [] } })
    } catch (err) {
      console.error(`GET ${apiBase}/supplier-options 失败：`, err)
      const detail = String(err?.message ?? err?.originalError?.message ?? '数据库查询失败')
      res.status(500).json({ code: 500, msg: `读取供应商下拉失败：${detail}`, data: null })
    }
  })

  /**
   * GET ${apiBase}/:id/lines
   */
  app.get(`${apiBase}/:id/lines`, async (req, res) => {
    try {
      const pool = await getPool()
      const meta = await ensureQuotationMeta(pool)
      const parsed = parseRouteHeaderKey(req.params.id, meta)
      if (!parsed.ok) {
        res.status(400).json({ code: 400, msg: parsed.msg || '参数错误：id', data: null })
        return
      }
      const fk = meta.lineFk
      const fkCol = colMeta(meta, 'l', fk)
      const pkCol = colMeta(meta, 'h', meta.headerPk)
      let lineBindVal = parsed.value
      if (
        fkCol &&
        isStringishSqlType(fkCol.dataType) &&
        pkCol &&
        !isStringishSqlType(pkCol.dataType)
      ) {
        lineBindVal = await fetchLineFilterStringFromNumericHeader(pool, meta, parsed.value)
      }
      const proj = lineListProjectionSql(meta)
      const orderBy = lineOrderBy(meta)
      const lrq = pool.request()
      bindPkOrFkParam(lrq, 'hid', fkCol, lineBindVal)
      const r = await lrq.query(`
        SELECT
          ${proj}
        FROM ${LINE_FROM} AS l
        WHERE l.${bracketIdent(fk)} = @hid
        ORDER BY ${orderBy}
      `)
      res.json({ code: 200, msg: 'success', data: { list: r.recordset ?? [] } })
    } catch (err) {
      console.error(`GET ${apiBase}/:id/lines 失败：`, err)
      const detail = String(err?.message ?? err?.originalError?.message ?? '数据库查询失败')
      res.status(500).json({ code: 500, msg: `读取${label}明细失败：${detail}`, data: null })
    }
  })

  /**
   * GET ${apiBase}/:id
   */
  app.get(`${apiBase}/:id`, async (req, res) => {
    try {
      const pool = await getPool()
      const meta = await ensureQuotationMeta(pool)
      const parsed = parseRouteHeaderKey(req.params.id, meta)
      if (!parsed.ok) {
        res.status(400).json({ code: 400, msg: parsed.msg || '参数错误：id', data: null })
        return
      }
      const pk = meta.headerPk
      const pkCol = colMeta(meta, 'h', pk)
      const hp = headerListProjectionSql(meta)
      const hrq = pool.request()
      bindPkOrFkParam(hrq, 'id', pkCol, parsed.value)
      const hr = await hrq.query(`
        SELECT TOP 1
          ${hp}
        FROM ${HEADER_FROM} AS h
        WHERE h.${bracketIdent(pk)} = @id
      `)
      const header = hr.recordset?.[0] ?? null
      if (!header) {
        res.status(404).json({ code: 404, msg: '记录不存在', data: null })
        return
      }
      const fk = meta.lineFk
      const fkCol = colMeta(meta, 'l', fk)
      const lineBindVal = fkCol && isStringishSqlType(fkCol.dataType)
        ? headerLineLinkFromHeaderRow(meta, header)
        : pickRowCaseInsensitive(header, pk) ?? parsed.value
      const lp = lineListProjectionSql(meta)
      const orderBy = lineOrderBy(meta)
      const lrq = pool.request()
      bindPkOrFkParam(lrq, 'hid', fkCol, lineBindVal)
      const lr = await lrq.query(`
        SELECT ${lp}
        FROM ${LINE_FROM} AS l
        WHERE l.${bracketIdent(fk)} = @hid
        ORDER BY ${orderBy}
      `)
      res.json({ code: 200, msg: 'success', data: { header, lines: lr.recordset ?? [] } })
    } catch (err) {
      console.error(`GET ${apiBase}/:id 失败：`, err)
      const detail = String(err?.message ?? err?.originalError?.message ?? '数据库查询失败')
      res.status(500).json({ code: 500, msg: `读取${label}详情失败：${detail}`, data: null })
    }
  })

  async function assertDocNoUnique(pool, meta, docValue, excludeId) {
    const cols = docNoColumns(meta)
    const v = String(docValue ?? '').trim()
    if (!v || !cols.length) return null
    const col = cols[0]
    const rq = pool.request().input('v', sql.NVarChar(200), v)
    let sqlWhere = `LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(h.${bracketIdent(col)}, N'')))) = @v`
    if (excludeId != null && meta.headerColNames.has(meta.headerPk.toLowerCase())) {
      const pkCm = colMeta(meta, 'h', meta.headerPk)
      bindPkOrFkParam(rq, 'ex', pkCm, excludeId)
      sqlWhere += ` AND h.${bracketIdent(meta.headerPk)} <> @ex`
    }
    if (meta.headerColNames.has('del')) {
      sqlWhere += ` AND (ISNULL(h.${bracketIdent('del')}, N'') = N'' OR h.${bracketIdent('del')} = N'0')`
    }
    const r = await rq.query(`
      SELECT COUNT(1) AS cnt FROM ${HEADER_FROM} AS h WHERE ${sqlWhere}
    `)
    const cnt = Number(r.recordset?.[0]?.cnt ?? 0)
    if (cnt > 0) return `单号/编码「${v}」已在在册记录中存在`
    return null
  }

  /**
   * POST ${apiBase}
   * body: { header: {}, lines: [] }
   */
  app.post(`${apiBase}`, async (req, res) => {
    /** @type {import('mssql').Transaction | null} */
    let tx = null
    try {
      const pool = await getPool()
      const meta = await ensureQuotationMeta(pool)
      const body = req.body ?? {}
      const headerIn = normalizeQuotationHeaderBody(
        meta,
        body.header && typeof body.header === 'object' ? body.header : {},
      )
      await applySupplierCodeColumnFromKehu(pool, meta, headerIn, supplierCol)
      const linesIn = Array.isArray(body.lines) ? body.lines : []

      const docCols = docNoColumns(meta)
      if (docCols.length) {
        const dv = pickBodyField(headerIn, docCols[0])
        const err = await assertDocNoUnique(pool, meta, dv, null)
        if (err) {
          res.status(400).json({ code: 400, msg: `新增失败：${err}`, data: null })
          return
        }
      }

      // SQL Server 2008 R2：事务边界（先 new Transaction(pool)，再 begin()；勿把 pool 传给 begin（会被当成隔离级别））
      tx = new sql.Transaction(pool)
      await tx.begin()
      const actor = getActorAuditTripletFromReq(req)

      const insertCols = []
      const insertVals = []
      const insReq = new sql.Request(tx)

      const skipInsert = new Set(
        [meta.headerPk, 'pass', 'del', 'uid', 'uname', 'utruename', 'edittime', 'deltime'].map((x) =>
          x.toLowerCase(),
        ),
      )
      if (meta.headerIdentity) skipInsert.add(meta.headerIdentity.toLowerCase())

      for (const cm of meta.headerCols) {
        const ln = cm.name.toLowerCase()
        if (skipInsert.has(ln)) continue
        const raw = pickBodyField(headerIn, cm.name)
        if (raw === undefined) continue
        const ps = pqSafeParamSuffix(cm.name)
        insertCols.push(bracketIdent(cm.name))
        insertVals.push(`@${ps}`)
        bindTypedParam(insReq, ps, cm, raw)
      }

      if (meta.headerColNames.has('pass')) {
        insertCols.push(bracketIdent('pass'))
        insertVals.push(`N'0'`)
      }
      if (meta.headerColNames.has('del')) {
        insertCols.push(bracketIdent('del'))
        insertVals.push(`N'0'`)
      }
      const uidCmAudit = colMeta(meta, 'h', 'uid')
      const uidStrActor = actorUidStringForHeader(actor, req)
      const unameIns =
        String(actor.uname ?? '').trim() ||
        String(actor.utruename ?? '').trim() ||
        String(uidStrActor || '')
      const utruenameIns =
        String(actor.utruename ?? '').trim() ||
        String(actor.uname ?? '').trim() ||
        String(uidStrActor || '')
      if (meta.headerColNames.has('uid') && uidStrActor) {
        insertCols.push(bracketIdent('uid'))
        insertVals.push('@audit_uid_ins')
        bindTypedParam(
          insReq,
          'audit_uid_ins',
          uidCmAudit || {
            name: 'uid',
            dataType: 'nvarchar',
            charMaxLength: 50,
            numericPrecision: null,
            numericScale: null,
          },
          uidStrActor,
        )
      }
      if (meta.headerColNames.has('uname') && unameIns) {
        insertCols.push(bracketIdent('uname'))
        insertVals.push('@audit_uname_ins')
        bindTypedParam(
          insReq,
          'audit_uname_ins',
          colMeta(meta, 'h', 'uname') || {
            name: 'uname',
            dataType: 'nvarchar',
            charMaxLength: 50,
            numericPrecision: null,
            numericScale: null,
          },
          unameIns,
        )
      }
      if (meta.headerColNames.has('utruename') && utruenameIns) {
        insertCols.push(bracketIdent('utruename'))
        insertVals.push('@audit_utruename_ins')
        bindTypedParam(
          insReq,
          'audit_utruename_ins',
          colMeta(meta, 'h', 'utruename') || {
            name: 'utruename',
            dataType: 'nvarchar',
            charMaxLength: 50,
            numericPrecision: null,
            numericScale: null,
          },
          utruenameIns,
        )
      }
      const bAddtimeIns = bracketIdent('addtime')
      if (meta.headerColNames.has('addtime') && !insertCols.includes(bAddtimeIns)) {
        insertCols.push(bAddtimeIns)
        insertVals.push('@addtime_fb_ins')
        insReq.input('addtime_fb_ins', sql.NVarChar(50), formatLocalYmd(new Date()))
      }

      if (!insertCols.length) {
        await tx.rollback()
        res.status(500).json({ code: 500, msg: '新增失败：没有可写入的主表字段', data: null })
        return
      }

      const pk = meta.headerPk
      const outIns = await insReq.query(`
        INSERT INTO ${HEADER_FROM} (${insertCols.join(', ')})
        OUTPUT INSERTED.${bracketIdent(pk)} AS new_id
        VALUES (${insertVals.join(', ')})
      `)
      const newIdRaw = outIns.recordset?.[0]?.new_id
      const pkColIns = colMeta(meta, 'h', pk)
      if (newIdRaw == null || (typeof newIdRaw === 'string' && !String(newIdRaw).trim())) {
        await tx.rollback()
        res.status(500).json({ code: 500, msg: '新增失败：未能取得主表主键', data: null })
        return
      }
      if (!isStringishSqlType(pkColIns?.dataType)) {
        const n = Number(newIdRaw)
        if (!Number.isFinite(n) || n <= 0) {
          await tx.rollback()
          res.status(500).json({ code: 500, msg: '新增失败：未能取得主表主键', data: null })
          return
        }
      }

      const fk = meta.lineFk
      const fkColIns = colMeta(meta, 'l', fk)
      const lineSkip = new Set([
        fk.toLowerCase(),
        'pass',
        'del',
        'uid',
        'uname',
        'utruename',
      ])
      if (meta.lineIdentity) lineSkip.add(meta.lineIdentity.toLowerCase())

      let lineIdx = 0
      for (const lineRow of linesIn) {
        if (!lineRow || typeof lineRow !== 'object') continue
        const lc = []
        const lv = []
        const lreq = new sql.Request(tx)
        for (const cm of meta.lineCols) {
          const ln = cm.name.toLowerCase()
          if (lineSkip.has(ln)) continue
          const raw = pickBodyField(lineRow, cm.name)
          if (raw === undefined) continue
          const lps = `${lineIdx}_${pqSafeParamSuffix(cm.name)}`
          lc.push(bracketIdent(cm.name))
          lv.push(`@L${lps}`)
          bindTypedParam(lreq, `L${lps}`, cm, raw)
        }
        appendQuotationLineAuditTriplet(meta, lreq, lc, lv, actor, req, lineIdx)
        lc.push(bracketIdent(fk))
        lv.push('@hid')
        let hidVal = newIdRaw
        if (fkColIns && isStringishSqlType(fkColIns.dataType)) {
          hidVal = lineFkStringValueForInsert(meta, headerIn, newIdRaw)
          if (
            !cellStr(hidVal) &&
            pkColIns &&
            !isStringishSqlType(pkColIns.dataType)
          ) {
            await tx.rollback()
            res.status(400).json({
              code: 400,
              msg: `新增失败：请填写${label}单号（${docNoCol}）以便关联明细`,
              data: null,
            })
            return
          }
        }
        bindPkOrFkParam(lreq, 'hid', fkColIns, hidVal)

        if (lc.length <= 1) continue

        await lreq.query(`
          INSERT INTO ${LINE_FROM} (${lc.join(', ')})
          VALUES (${lv.join(', ')})
        `)
        lineIdx += 1
      }

      await tx.commit()
      res.json({ code: 200, msg: 'success', data: { id: newIdRaw } })
    } catch (err) {
      try {
        if (tx) await tx.rollback()
      } catch {
        /* ignore */
      }
      console.error(`POST ${apiBase} 失败：`, err)
      const detail = String(err?.message ?? err?.originalError?.message ?? '数据库写入失败')
      res.status(500).json({ code: 500, msg: `新增${label}失败：${detail}`, data: null })
    }
  })

  /**
   * PUT ${apiBase}
   * body: { id, header: {}, lines: [] }
   */
  app.put(`${apiBase}`, async (req, res) => {
    /** @type {import('mssql').Transaction | null} */
    let tx = null
    try {
      const pool = await getPool()
      const meta = await ensureQuotationMeta(pool)
      const body = req.body ?? {}
      const parsedId = parseBodyHeaderKey(body.id, meta)
      if (!parsedId.ok) {
        res.status(400).json({ code: 400, msg: parsedId.msg || '参数错误：id', data: null })
        return
      }
      const id = parsedId.value
      const headerIn = normalizeQuotationHeaderBody(
        meta,
        body.header && typeof body.header === 'object' ? body.header : {},
      )
      await applySupplierCodeColumnFromKehu(pool, meta, headerIn, supplierCol)
      const linesIn = Array.isArray(body.lines) ? body.lines : []

      const pk = meta.headerPk
      const cur = await fetchHeaderStatus(pool, id)
      if (!cur) {
        res.status(404).json({ code: 404, msg: '记录不存在', data: null })
        return
      }
      if (meta.headerColNames.has('pass') && String(cur.pass ?? '').trim() === '1') {
        res.status(400).json({ code: 400, msg: '已审核记录禁止修改，请先反审', data: null })
        return
      }
      if (meta.headerColNames.has('del') && String(cur.del ?? '').trim() === '1') {
        res.status(400).json({ code: 400, msg: '回收站记录请恢复后再编辑', data: null })
        return
      }

      const docCols = docNoColumns(meta)
      if (docCols.length) {
        const dv = pickBodyField(headerIn, docCols[0])
        const err = await assertDocNoUnique(pool, meta, dv, id)
        if (err) {
          res.status(400).json({ code: 400, msg: `保存失败：${err}`, data: null })
          return
        }
      }

      tx = new sql.Transaction(pool)
      await tx.begin()
      const nowStr = formatBomColorcodeTimestamp()
      const actor = getActorAuditTripletFromReq(req)

      const pkColPut = colMeta(meta, 'h', pk)
      const fk = meta.lineFk
      const fkColPut = colMeta(meta, 'l', fk)
      const hdrBeforeRq = new sql.Request(tx)
      bindPkOrFkParam(hdrBeforeRq, 'id', pkColPut, id)
      const hdrBeforeRs = await hdrBeforeRq.query(`
        SELECT TOP 1 * FROM ${HEADER_FROM} WHERE ${bracketIdent(pk)} = @id
      `)
      const hdrBefore = hdrBeforeRs.recordset?.[0] ?? null
      const lineDelVal =
        fkColPut && isStringishSqlType(fkColPut.dataType) && hdrBefore
          ? headerLineLinkFromHeaderRow(meta, hdrBefore)
          : id

      const setParts = []
      const updReq = new sql.Request(tx)
      bindPkOrFkParam(updReq, 'id', pkColPut, id)

      const skipUpd = new Set(
        [meta.headerPk, 'pass', 'del', 'deltime', 'uid', 'uname', 'utruename'].map((x) => x.toLowerCase()),
      )

      for (const cm of meta.headerCols) {
        const ln = cm.name.toLowerCase()
        if (skipUpd.has(ln)) continue
        const raw = pickBodyField(headerIn, cm.name)
        if (raw === undefined) continue
        const ps = pqSafeParamSuffix(cm.name)
        setParts.push(`${bracketIdent(cm.name)} = @U_${ps}`)
        bindTypedParam(updReq, `U_${ps}`, cm, raw)
      }

      const uidCmPut = colMeta(meta, 'h', 'uid')
      const uidStrPut = actorUidStringForHeader(actor, req)
      const unamePut =
        String(actor.uname ?? '').trim() ||
        String(actor.utruename ?? '').trim() ||
        String(uidStrPut || '')
      const utruenamePut =
        String(actor.utruename ?? '').trim() ||
        String(actor.uname ?? '').trim() ||
        String(uidStrPut || '')
      if (meta.headerColNames.has('uid') && uidStrPut) {
        setParts.push(`${bracketIdent('uid')} = @audit_uid_put`)
        bindTypedParam(
          updReq,
          'audit_uid_put',
          uidCmPut || {
            name: 'uid',
            dataType: 'nvarchar',
            charMaxLength: 50,
            numericPrecision: null,
            numericScale: null,
          },
          uidStrPut,
        )
      }
      if (meta.headerColNames.has('uname') && unamePut) {
        setParts.push(`${bracketIdent('uname')} = @audit_uname_put`)
        bindTypedParam(
          updReq,
          'audit_uname_put',
          colMeta(meta, 'h', 'uname') || {
            name: 'uname',
            dataType: 'nvarchar',
            charMaxLength: 50,
            numericPrecision: null,
            numericScale: null,
          },
          unamePut,
        )
      }
      if (meta.headerColNames.has('utruename') && utruenamePut) {
        setParts.push(`${bracketIdent('utruename')} = @audit_utruename_put`)
        bindTypedParam(
          updReq,
          'audit_utruename_put',
          colMeta(meta, 'h', 'utruename') || {
            name: 'utruename',
            dataType: 'nvarchar',
            charMaxLength: 50,
            numericPrecision: null,
            numericScale: null,
          },
          utruenamePut,
        )
      }
      if (meta.headerColNames.has('edittime')) {
        setParts.push(`${bracketIdent('edittime')} = @edittime`)
        updReq.input('edittime', sql.NVarChar(50), nowStr)
      }

      // 允许仅改明细：若无业务字段可 SET，则用主键自赋值触发 UPDATE 以校验 WHERE 条件
      if (!setParts.length) {
        setParts.push(`${bracketIdent(pk)} = ${bracketIdent(pk)}`)
      }

      const ur = await updReq.query(`
        UPDATE ${HEADER_FROM}
        SET ${setParts.join(', ')}
        WHERE ${bracketIdent(pk)} = @id
        ${sqlWhereNotAuditedInCatalog(meta)}
      `)
      const affected = Array.isArray(ur.rowsAffected) ? Number(ur.rowsAffected[0] ?? 0) : 0
      if (affected <= 0) {
        await tx.rollback()
        res.status(400).json({ code: 400, msg: '保存失败：记录状态已变化或不存在', data: null })
        return
      }

      const hdrAfterRq = new sql.Request(tx)
      bindPkOrFkParam(hdrAfterRq, 'id', pkColPut, id)
      const hdrAfterRs = await hdrAfterRq.query(`
        SELECT TOP 1 * FROM ${HEADER_FROM} WHERE ${bracketIdent(pk)} = @id
      `)
      const hdrAfter = hdrAfterRs.recordset?.[0] ?? null
      const insertLineFkVal =
        fkColPut && isStringishSqlType(fkColPut.dataType) && hdrAfter
          ? headerLineLinkFromHeaderRow(meta, hdrAfter)
          : id

      const delRq = new sql.Request(tx)
      bindPkOrFkParam(delRq, 'hid', fkColPut, lineDelVal)
      const delL = await delRq.query(`
        DELETE FROM ${LINE_FROM} WHERE ${bracketIdent(fk)} = @hid
      `)
      void delL

      const lineSkip = new Set([
        fk.toLowerCase(),
        'pass',
        'del',
        'uid',
        'uname',
        'utruename',
      ])
      if (meta.lineIdentity) lineSkip.add(meta.lineIdentity.toLowerCase())

      let lineIdx = 0
      for (const lineRow of linesIn) {
        if (!lineRow || typeof lineRow !== 'object') continue
        const lc = []
        const lv = []
        const lreq = new sql.Request(tx)
        for (const cm of meta.lineCols) {
          const ln = cm.name.toLowerCase()
          if (lineSkip.has(ln)) continue
          const raw = pickBodyField(lineRow, cm.name)
          if (raw === undefined) continue
          const lps = `${lineIdx}_${pqSafeParamSuffix(cm.name)}`
          lc.push(bracketIdent(cm.name))
          lv.push(`@L${lps}`)
          bindTypedParam(lreq, `L${lps}`, cm, raw)
        }
        appendQuotationLineAuditTriplet(meta, lreq, lc, lv, actor, req, lineIdx)
        lc.push(bracketIdent(fk))
        lv.push('@hid')
        bindPkOrFkParam(lreq, 'hid', fkColPut, insertLineFkVal)

        if (lc.length <= 1) continue

        await lreq.query(`
          INSERT INTO ${LINE_FROM} (${lc.join(', ')})
          VALUES (${lv.join(', ')})
        `)
        lineIdx += 1
      }

      await tx.commit()
      res.json({ code: 200, msg: 'success', data: { id } })
    } catch (err) {
      try {
        if (tx) await tx.rollback()
      } catch {
        /* ignore */
      }
      console.error(`PUT ${apiBase} 失败：`, err)
      const detail = String(err?.message ?? err?.originalError?.message ?? '数据库写入失败')
      res.status(500).json({ code: 500, msg: `保存${label}失败：${detail}`, data: null })
    }
  })

  async function fetchHeaderStatus(pool, id) {
    const meta = await ensureQuotationMeta(pool)
    const pk = meta.headerPk
    const pkColSt = colMeta(meta, 'h', pk)
    const hasPass = meta.headerColNames.has('pass')
    const hasDel = meta.headerColNames.has('del')
    const sel = [
      `${bracketIdent(pk)} AS pk`,
      hasPass ? `LTRIM(RTRIM(CONVERT(nvarchar(20), ISNULL(${bracketIdent('pass')}, N'')))) AS pass` : `N'' AS pass`,
      hasDel ? `LTRIM(RTRIM(CONVERT(nvarchar(20), ISNULL(${bracketIdent('del')}, N'')))) AS del` : `N'0' AS del`,
    ]
    const rq = pool.request()
    bindPkOrFkParam(rq, 'id', pkColSt, id)
    const r = await rq.query(`
      SELECT TOP 1 ${sel.join(', ')}
      FROM ${HEADER_FROM}
      WHERE ${bracketIdent(pk)} = @id
    `)
    return r.recordset?.[0] ?? null
  }

  /**
   * PUT ${apiBase}/audit  body: { id }
   */
  app.put(`${apiBase}/audit`, async (req, res) => {
    try {
      const pool = await getPool()
      const meta = await ensureQuotationMeta(pool)
      if (!meta.headerColNames.has('pass')) {
        res.status(400).json({ code: 400, msg: '当前表无 pass 列，无法审核', data: null })
        return
      }
      const parsedId = parseBodyHeaderKey(req.body?.id, meta)
      if (!parsedId.ok) {
        res.status(400).json({ code: 400, msg: parsedId.msg || '参数错误：id', data: null })
        return
      }
      const id = parsedId.value
      const row = await fetchHeaderStatus(pool, id)
      if (!row) {
        res.status(404).json({ code: 404, msg: '记录不存在', data: null })
        return
      }
      if (meta.headerColNames.has('del') && String(row.del ?? '').trim() === '1') {
        res.status(400).json({ code: 400, msg: '回收站记录不可审核，请先恢复', data: null })
        return
      }
      const nowStr = formatBomColorcodeTimestamp()
      const pk = meta.headerPk
      const pkColAud = colMeta(meta, 'h', pk)
      const auditSets = [`${bracketIdent('pass')} = N'1'`]
      if (meta.headerColNames.has('edittime')) auditSets.push(`${bracketIdent('edittime')} = @edittime`)
      const auditReq = pool.request()
      bindPkOrFkParam(auditReq, 'id', pkColAud, id)
      if (meta.headerColNames.has('edittime')) auditReq.input('edittime', sql.NVarChar(50), nowStr)
      const auditRs = await auditReq.query(`
        UPDATE ${HEADER_FROM}
        SET ${auditSets.join(', ')}
        WHERE ${bracketIdent(pk)} = @id
        ${sqlWhereNotAuditedInCatalog(meta)}
      `)
      const affected = Array.isArray(auditRs.rowsAffected) ? Number(auditRs.rowsAffected[0] ?? 0) : 0
      if (affected <= 0) {
        res.status(400).json({ code: 400, msg: '审核失败：记录不存在或已审核', data: null })
        return
      }
      res.json({ code: 200, msg: 'success', data: null })
    } catch (err) {
      console.error(`PUT ${apiBase}/audit 失败：`, err)
      const detail = String(err?.message ?? err?.originalError?.message ?? '数据库写入失败')
      res.status(500).json({ code: 500, msg: `审核失败：${detail}`, data: null })
    }
  })

  /**
   * PUT ${apiBase}/unaudit  body: { id }
   */
  app.put(`${apiBase}/unaudit`, async (req, res) => {
    try {
      const pool = await getPool()
      const meta = await ensureQuotationMeta(pool)
      if (!meta.headerColNames.has('pass')) {
        res.status(400).json({ code: 400, msg: '当前表无 pass 列，无法反审', data: null })
        return
      }
      const parsedId = parseBodyHeaderKey(req.body?.id, meta)
      if (!parsedId.ok) {
        res.status(400).json({ code: 400, msg: parsedId.msg || '参数错误：id', data: null })
        return
      }
      const id = parsedId.value
      const row = await fetchHeaderStatus(pool, id)
      if (!row) {
        res.status(404).json({ code: 404, msg: '记录不存在', data: null })
        return
      }
      if (meta.headerColNames.has('del') && String(row.del ?? '').trim() === '1') {
        res.status(400).json({ code: 400, msg: '回收站记录不可反审', data: null })
        return
      }
      const nowStr = formatBomColorcodeTimestamp()
      const pk = meta.headerPk
      const pkColUn = colMeta(meta, 'h', pk)
      const unauditSets = [`${bracketIdent('pass')} = N'0'`]
      if (meta.headerColNames.has('edittime')) unauditSets.push(`${bracketIdent('edittime')} = @edittime`)
      const unauditReq = pool.request()
      bindPkOrFkParam(unauditReq, 'id', pkColUn, id)
      if (meta.headerColNames.has('edittime')) unauditReq.input('edittime', sql.NVarChar(50), nowStr)
      const unauditRs = await unauditReq.query(`
        UPDATE ${HEADER_FROM}
        SET ${unauditSets.join(', ')}
        WHERE ${bracketIdent(pk)} = @id
        ${sqlWhereAuditedInCatalog(meta)}
      `)
      const affected = Array.isArray(unauditRs.rowsAffected) ? Number(unauditRs.rowsAffected[0] ?? 0) : 0
      if (affected <= 0) {
        res.status(400).json({ code: 400, msg: '反审失败：记录未审核或不存在', data: null })
        return
      }
      res.json({ code: 200, msg: 'success', data: null })
    } catch (err) {
      console.error(`PUT ${apiBase}/unaudit 失败：`, err)
      const detail = String(err?.message ?? err?.originalError?.message ?? '数据库写入失败')
      res.status(500).json({ code: 500, msg: `反审失败：${detail}`, data: null })
    }
  })

  /**
   * PUT ${apiBase}/restore  body: { id }
   */
  app.put(`${apiBase}/restore`, async (req, res) => {
    try {
      const pool = await getPool()
      const meta = await ensureQuotationMeta(pool)
      if (!meta.headerColNames.has('del')) {
        res.status(400).json({ code: 400, msg: '当前表无 del 列，无法恢复', data: null })
        return
      }
      const parsedId = parseBodyHeaderKey(req.body?.id, meta)
      if (!parsedId.ok) {
        res.status(400).json({ code: 400, msg: parsedId.msg || '参数错误：id', data: null })
        return
      }
      const id = parsedId.value
      const nowStr = formatBomColorcodeTimestamp()
      const pk = meta.headerPk
      const pkColRs = colMeta(meta, 'h', pk)
      const restoreSets = [`${bracketIdent('del')} = N'0'`]
      if (meta.headerColNames.has('deltime')) restoreSets.push(`${bracketIdent('deltime')} = NULL`)
      if (meta.headerColNames.has('edittime')) restoreSets.push(`${bracketIdent('edittime')} = @edittime`)
      const restoreReq = pool.request()
      bindPkOrFkParam(restoreReq, 'id', pkColRs, id)
      if (meta.headerColNames.has('edittime')) restoreReq.input('edittime', sql.NVarChar(50), nowStr)
      const restoreRs = await restoreReq.query(`
        UPDATE ${HEADER_FROM}
        SET ${restoreSets.join(', ')}
        WHERE ${bracketIdent(pk)} = @id
          AND LTRIM(RTRIM(ISNULL(${bracketIdent('del')}, N''))) = N'1'
      `)
      const affected = Array.isArray(restoreRs.rowsAffected) ? Number(restoreRs.rowsAffected[0] ?? 0) : 0
      if (affected <= 0) {
        res.status(400).json({ code: 400, msg: '恢复失败：记录不在回收站', data: null })
        return
      }
      res.json({ code: 200, msg: 'success', data: null })
    } catch (err) {
      console.error(`PUT ${apiBase}/restore 失败：`, err)
      const detail = String(err?.message ?? err?.originalError?.message ?? '数据库写入失败')
      res.status(500).json({ code: 500, msg: `恢复失败：${detail}`, data: null })
    }
  })

  /**
   * DELETE ${apiBase}/:id  软删
   */
  app.delete(`${apiBase}/:id`, async (req, res) => {
    try {
      const pool = await getPool()
      const meta = await ensureQuotationMeta(pool)
      const parsed = parseRouteHeaderKey(req.params.id, meta)
      if (!parsed.ok) {
        res.status(400).json({ code: 400, msg: parsed.msg || '参数错误：id', data: null })
        return
      }
      const id = parsed.value
      if (!meta.headerColNames.has('del')) {
        res.status(400).json({ code: 400, msg: '当前表无 del 列，不支持软删', data: null })
        return
      }
      const row = await fetchHeaderStatus(pool, id)
      if (!row) {
        res.status(404).json({ code: 404, msg: '记录不存在', data: null })
        return
      }
      if (meta.headerColNames.has('pass') && String(row.pass ?? '').trim() === '1') {
        res.status(400).json({ code: 400, msg: '已审核记录禁止删除，请先反审', data: null })
        return
      }
      const nowStr = formatBomColorcodeTimestamp()
      const pk = meta.headerPk
      const pkColSf = colMeta(meta, 'h', pk)
      const softSets = [`${bracketIdent('del')} = N'1'`]
      if (meta.headerColNames.has('deltime')) softSets.push(`${bracketIdent('deltime')} = @deltime`)
      if (meta.headerColNames.has('edittime')) softSets.push(`${bracketIdent('edittime')} = @edittime`)
      const softReq = pool.request()
      bindPkOrFkParam(softReq, 'id', pkColSf, id)
      if (meta.headerColNames.has('deltime')) softReq.input('deltime', sql.NVarChar(50), nowStr)
      if (meta.headerColNames.has('edittime')) softReq.input('edittime', sql.NVarChar(50), nowStr)
      const softRs = await softReq.query(`
        UPDATE ${HEADER_FROM}
        SET ${softSets.join(', ')}
        WHERE ${bracketIdent(pk)} = @id
        ${sqlWhereSoftDeleteOk(meta)}
      `)
      const affected = Array.isArray(softRs.rowsAffected) ? Number(softRs.rowsAffected[0] ?? 0) : 0
      if (affected <= 0) {
        res.status(400).json({ code: 400, msg: '删除失败：记录状态已变化', data: null })
        return
      }
      res.json({ code: 200, msg: 'success', data: { id } })
    } catch (err) {
      console.error(`DELETE ${apiBase}/:id 失败：`, err)
      const detail = String(err?.message ?? err?.originalError?.message ?? '数据库写入失败')
      res.status(500).json({ code: 500, msg: `删除失败：${detail}`, data: null })
    }
  })

  /**
   * DELETE ${apiBase}/:id/permanent
   */
  app.delete(`${apiBase}/:id/permanent`, async (req, res) => {
    /** @type {import('mssql').Transaction | null} */
    let tx = null
    try {
      const pool = await getPool()
      const meta = await ensureQuotationMeta(pool)
      const parsed = parseRouteHeaderKey(req.params.id, meta)
      if (!parsed.ok) {
        res.status(400).json({ code: 400, msg: parsed.msg || '参数错误：id', data: null })
        return
      }
      const id = parsed.value
      const row = await fetchHeaderStatus(pool, id)
      if (!row) {
        res.status(404).json({ code: 404, msg: '记录不存在', data: null })
        return
      }
      if (!meta.headerColNames.has('del') || String(row.del ?? '').trim() !== '1') {
        res.status(400).json({ code: 400, msg: '仅允许彻底删除回收站中的记录', data: null })
        return
      }
      if (meta.headerColNames.has('pass') && String(row.pass ?? '').trim() === '1') {
        res.status(400).json({ code: 400, msg: '已审核记录禁止物理删除', data: null })
        return
      }

      tx = new sql.Transaction(pool)
      await tx.begin()
      const fk = meta.lineFk
      const fkColPm = colMeta(meta, 'l', fk)
      const hdrPm = await fetchQuotationHeaderFullForAudit(pool, id)
      const lineHidPerm =
        fkColPm && isStringishSqlType(fkColPm.dataType) && hdrPm
          ? headerLineLinkFromHeaderRow(meta, hdrPm)
          : id
      const permLineRq = new sql.Request(tx)
      bindPkOrFkParam(permLineRq, 'hid', fkColPm, lineHidPerm)
      await permLineRq.query(`
        DELETE FROM ${LINE_FROM} WHERE ${bracketIdent(fk)} = @hid
      `)
      const pk = meta.headerPk
      const pkColPm = colMeta(meta, 'h', pk)
      const permParts = [`LTRIM(RTRIM(ISNULL(${bracketIdent('del')}, N''))) = N'1'`]
      if (meta.headerColNames.has('pass')) {
        permParts.push(`LTRIM(RTRIM(ISNULL(${bracketIdent('pass')}, N''))) <> N'1'`)
      }
      const drRq = new sql.Request(tx)
      bindPkOrFkParam(drRq, 'id', pkColPm, id)
      const dr = await drRq.query(`
        DELETE FROM ${HEADER_FROM}
        WHERE ${bracketIdent(pk)} = @id
          AND ${permParts.join(' AND ')}
      `)
      const affected = Array.isArray(dr.rowsAffected) ? Number(dr.rowsAffected[0] ?? 0) : 0
      if (affected <= 0) {
        await tx.rollback()
        res.status(400).json({ code: 400, msg: '彻底删除失败：状态不符', data: null })
        return
      }
      await tx.commit()
      res.json({ code: 200, msg: 'success', data: { id } })
    } catch (err) {
      try {
        if (tx) await tx.rollback()
      } catch {
        /* ignore */
      }
      console.error(`DELETE ${apiBase}/:id/permanent 失败：`, err)
      const detail = String(err?.message ?? err?.originalError?.message ?? '数据库写入失败')
      res.status(500).json({ code: 500, msg: `彻底删除失败：${detail}`, data: null })
    }
  })
}

  return {
    ensureMeta: ensureQuotationMeta,
    invalidateMetaCache: invalidateQuotationMetaCache,
    getDisplayLabel: getQuotationDisplayLabel,
    fetchSnapshotForAudit: fetchQuotationSnapshotForAudit,
    buildPutDiffChinese: buildQuotationPutDiffChinese,
    fetchHeaderFullForAudit: fetchQuotationHeaderFullForAudit,
    registerRoutes: registerQuotationRoutes,
  }
}
