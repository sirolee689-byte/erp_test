/**
 * BOM 模块路由注册（从 server/index.js 机械抽出，零行为变更）
 */
import crypto from 'node:crypto'
import { getPool, sql } from '../db.js'
import {
  getActorAuditTripletFromReq,
  resolveActorAuditTripletFromReq,
} from '../businessAuditFields.js'
import { writeLog } from '../operationLogWriter.js'
import { getSysUsersColumnsMeta } from '../sysUsersDb.js'
import {
  BOM_CONSUMPTION_FROM,
  BOM_COST_FROM,
  BOM_COST_TABLE,
  BOM_PARTS_KCAA_SYNC_NAMES,
  INV_BOM_CODE_FROM,
  INV_BOM_CURRENCY_FROM,
  INV_BOM_MASTER_FROM,
  INV_BOM_MASTER_TABLE,
  INV_BOM_PARTS_FROM,
  INV_BOM_PARTS_TABLE,
} from '../bomTables.js'
import { buildBomCostInsertPayloadFromFlatUsage } from '../bomUsageYl.js'
import {
  applyBomCostPxForPqRows,
  applyBomCostAuditToRows,
  enrichBomCostInsertRowsFromBom000,
  fetchBomMaterialPxByCategoryCodes,
  fetchBom000ForBomCostEnrich,
  formatBomCostAuditTimestamp,
  insertBomCostBulkEnriched,
  isPqBomCostHead,
} from '../bomCostEnrichFromBom000.js'
import { buildBomPartsUsageTreeNodes } from '../bomUsageTreeBuild.js'
import { flattenBomPartsCostUsageFlatForBomCost } from '../bomUsageFlatten.js'
import { handlePostBomMasterPropagate } from '../bomMasterPropagate.js'
import { markCurrentBomCostStale } from '../bomCostImpactScope.js'

const BOM_UNIT_CHANGE_FROM = 'dbo.[Bom_unit_change]'
const BOM_MATERIAL_FROM = 'dbo.[Bom_material]'
const BOM_STOCKS_WORKSHOP_FROM = 'dbo.[Bom_Stocks_workshop]'
const SYS_SUPPLIER_FROM = 'dbo.[System_supplier]'

/** 已审核禁止改删固定文案（与 server/index.js 一致） */
const HR_STAFF_AUDIT_LOCK_MSG = '该记录已审核锁定，请反审后再操作'

/**
 * 旧表审核状态：pass 为 nvarchar，'1' 表示已审核
 * @param {any} passVal
 */
function legacyDeptPassIsAudited(passVal) {
  return String(passVal ?? '').trim() === '1'
}

/** del 为空或0 表示仍在用（未逻辑删除） */
function legacyDeptRowIsActive(row) {
  if (!row) return false
  const d = String(row.del ?? '').trim()
  return d === '' || d === '0'
}

/**
 * @param {import('express').Express} app
 * @param {{
 *   escapeSqlLikePattern: (s: string) => string,
 *   formatBomColorcodeTimestamp: (date?: Date) => string,
 * }} deps
 */
export function registerBomRoutes(app, deps) {
  const { escapeSqlLikePattern, formatBomColorcodeTimestamp } = deps

function bomPartParseDecimal(raw) {
  if (raw === null || raw === undefined) return 0
  const s = String(raw).replace(/,/g, '').trim()
  if (s === '') return 0
  const n = Number(s)
  return Number.isFinite(n) ? n : 0
}

/** 配件用量类字段写入前规整（§2：与 decimal(18,6) 对齐，降低 JS 浮点误差） */
function bomPartRoundDecimal6(raw) {
  const n = bomPartParseDecimal(raw)
  if (!Number.isFinite(n)) return 0
  return Math.round(n * 1e6) / 1e6
}

/** 用量合计：kcac04 * (1 + kcac05)，与前端公式一致 */
function bomPartComputeKcac06(qtyRaw, lossRaw) {
  const q = bomPartRoundDecimal6(qtyRaw)
  const l = bomPartRoundDecimal6(lossRaw)
  return bomPartRoundDecimal6(q * (1 + l))
}

/**
 * Bom_parts：`kcac04`/`kcac05`/`cost_price` 库类型为 numeric/decimal（见 docs/bom_parts.txt）。
 * 禁止使用 bomKcacAsDecimalSql（内部 ISNULL(列, N'')），numeric 列与 nvarchar 字面量混用会触发转换异常。
 * @param {string} colExpr 列引用，如 p.kcac04
 */
function bomPartsNumericColAsDecimalSql(colExpr) {
  const c = String(colExpr ?? '').trim()
  // 与 bom_parts 数值列精度一致（多为 decimal(18,6)）；若用 4 位小数会误把损耗率等舍入（如 0.02345→0.0235）导致明细用量与金额偏差
  return `CAST(ISNULL(${c}, 0) AS decimal(18, 6))`
}

/**
 * Bom_parts.id 为 int（docs/bom_parts.txt）
 * @param {import('mssql').Request} request
 * @param {unknown} rawId
 */
function bomPartsSqlBindId(request, rawId) {
  const s0 = String(rawId ?? '').trim().replace(/\.0+$/, '')
  let v
  if (/^\d+$/.test(s0)) {
    v = parseInt(s0, 10)
  } else {
    const n = Number(rawId)
    if (!Number.isFinite(n)) throw new Error('无效的行 id')
    v = Math.trunc(n)
  }
  if (!Number.isFinite(v) || v < 1 || v > 2147483647) {
    throw new Error('无效的行 id')
  }
  request.input('id', sql.Int, v)
}

/** 是否视为数据库已有行（兼容整数字符串 id） */
function bomPartLineHasDbId(raw) {
  if (raw?.id == null || raw.id === '') return false
  const s = String(raw.id).trim().replace(/\.0+$/, '')
  return /^[1-9]\d*$/.test(s)
}

/** Bom_parts.[Seq]：排序序号（int） */
function bomPartParseSeq(raw) {
  const n = Number(raw)
  if (!Number.isFinite(n) || n < 0) return 0
  const t = Math.trunc(n)
  return t > 2147483647 ? 2147483647 : t
}

/** del 视为在册：空或 0（兼容数值类驱动返回） */
function bomPartsDelLooksActive(delS) {
  const s = String(delS ?? '').trim().toLowerCase()
  if (!s) return true
  if (s === '0') return true
  const n = Number(s.replace(/^'+|'+$/g, ''))
  return Number.isFinite(n) && n === 0
}

/**
 * 同主档 kcac01 + 配件 kcaa01 已有行（含软删），按 id 升序
 * @param {import('mssql').Transaction} tx
 */
async function bomPartsFindRowsByScAndPartCode(tx, systemcode, kcaa01) {
  const code = String(kcaa01 ?? '').trim()
  if (!code) return []
  const r = await new sql.Request(tx)
    .input('kcac01', sql.NVarChar(100), systemcode)
    .input('kcaa01', sql.NVarChar(300), code)
    .query(`
      SELECT p.id,
        LTRIM(RTRIM(ISNULL(CONVERT(nvarchar(10), p.del), N''))) AS del_s
      FROM ${INV_BOM_PARTS_FROM} AS p
      WHERE LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(p.kcac01, N'')))) =
            LTRIM(RTRIM(CONVERT(nvarchar(100), @kcac01)))
        AND LTRIM(RTRIM(CONVERT(nvarchar(300), ISNULL(p.kcaa01, N'')))) =
            LTRIM(RTRIM(CONVERT(nvarchar(300), @kcaa01)))
      ORDER BY p.id ASC
    `)
  return Array.isArray(r.recordset) ? r.recordset : []
}

/**
 * 根据配件物料编码（bom_000.kcaa01）解析对应 BOM 主档 systemcode，写入 Bom_parts.kcac02（跨主表关联）
 * @param {import('mssql').Transaction|import('mssql').ConnectionPool} poolOrTx
 */
async function bomPartsLookupSubBomSystemcode(poolOrTx, partMaterialCode) {
  const code = String(partMaterialCode ?? '').trim()
  if (!code) return ''
  const r = await new sql.Request(poolOrTx)
    .input('kcaa01', sql.NVarChar(300), code)
    .query(`
      SELECT TOP 1
        LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(b.systemcode, N'')))) AS sub_sc
      FROM ${INV_BOM_MASTER_FROM} AS b
      WHERE LTRIM(RTRIM(CONVERT(nvarchar(300), ISNULL(b.kcaa01, N'')))) = @kcaa01
        AND (ISNULL(b.del, N'') = N'' OR LTRIM(RTRIM(ISNULL(CONVERT(nvarchar(20), b.del), N''))) = N'0')
      ORDER BY b.id DESC
    `)
  return String(r.recordset?.[0]?.sub_sc ?? '').trim()
}

/** 保存明细时从 bom_000 同步至 Bom_parts 的 kcaa 列（kcaa01～kcaa35，以库内实际存在列为准） */
/** 物理列名为 kcaa01～kcaa35（不足两位须补零，禁止生成 kcaa1/kcaa9） */

/**
 * 无子档 BOM 时：这些列用请求体写回；其余 kcaa 列保持行内原值（避免误清空历史扩展字段）
 * @type {ReadonlySet<string>}
 */
const BOM_PARTS_KCAA_PAYLOAD_FALLBACK = new Set(['kcaa02', 'kcaa03', 'kcaa04', 'kcaa11'])

/**
 * 按配件行 p.kcaa01 匹配 bom_000 在册最新行（TOP 1 ORDER BY b.id DESC，与 GET 配件明细一致）
 * @param {string} alias
 */
function bomPartsSqlOuterApplyLatestBom000ByPartKcaa01(alias = 'b0') {
  const kcaaSelect = BOM_PARTS_KCAA_SYNC_NAMES.map((c) => `b.[${c}]`).join(',\n          ')
  return (
    `OUTER APPLY (
      SELECT TOP 1
        LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(b.systemcode, N'')))) AS sub_systemcode,
        ${kcaaSelect}
      FROM ${INV_BOM_MASTER_FROM} AS b
      WHERE LTRIM(RTRIM(CONVERT(nvarchar(300), ISNULL(b.kcaa01, N'')))) =
            LTRIM(RTRIM(CONVERT(nvarchar(300), ISNULL(p.kcaa01, N''))))
        AND (ISNULL(b.del, N'') = N'' OR LTRIM(RTRIM(ISNULL(CONVERT(nvarchar(20), b.del), N''))) = N'0')
      ORDER BY b.id DESC
    ) AS ${alias}`
  )
}

/**
 * UPDATE SET：kcaa 优先取自 OUTER APPLY 子 BOM；无匹配时 kcaa01 用 @kcaa01Up，kcaa02/03/04/11 用请求参数，其余保持原列
 * @param {Set<string>} partColset getInvBomPartsColumnSet
 * @param {string} alias
 * @returns {string[]}
 */
function bomPartsBuildKcaaSyncAssignments(partColset, alias = 'b0') {
  const parts = []
  for (const col of BOM_PARTS_KCAA_SYNC_NAMES) {
    if (!partColset.has(col)) continue
    if (col === 'kcaa01') {
      parts.push(`p.[kcaa01] = @kcaa01Up`)
      continue
    }
    if (BOM_PARTS_KCAA_PAYLOAD_FALLBACK.has(col)) {
      parts.push(`p.[${col}] = ISNULL(${alias}.[${col}], @${col})`)
    } else {
      parts.push(`p.[${col}] = ISNULL(${alias}.[${col}], p.[${col}])`)
    }
  }
  return parts
}

async function bomPartsAssertSubmittedCodesPersisted(tx, systemcode, submittedCodes) {
  const codes = [...new Set((submittedCodes ?? []).map((c) => String(c ?? '').trim()).filter(Boolean))]
  if (!codes.length) return

  const q = new sql.Request(tx)
  q.input('kcac01', sql.NVarChar(100), systemcode)
  codes.forEach((code, i) => q.input(`code${i}`, sql.NVarChar(300), code))

  const valuesSql = codes.map((_, i) => `(@code${i})`).join(',\n        ')
  const rs = await q.query(`
    ;WITH expected(kcaa01) AS (
      SELECT v.kcaa01
      FROM (VALUES
        ${valuesSql}
      ) AS v(kcaa01)
    ),
    saved AS (
      SELECT DISTINCT LTRIM(RTRIM(CONVERT(nvarchar(300), ISNULL(p.kcaa01, N'')))) AS kcaa01
      FROM ${INV_BOM_PARTS_FROM} AS p
      WHERE LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(p.kcac01, N'')))) =
            LTRIM(RTRIM(CONVERT(nvarchar(100), @kcac01)))
        AND (ISNULL(p.del, N'') = N'' OR LTRIM(RTRIM(ISNULL(CONVERT(nvarchar(20), p.del), N''))) = N'0')
    )
    SELECT e.kcaa01
    FROM expected AS e
    LEFT JOIN saved AS s
      ON s.kcaa01 = e.kcaa01
    WHERE s.kcaa01 IS NULL
  `)
  const missing = (rs.recordset ?? []).map((row) => String(row.kcaa01 ?? '').trim()).filter(Boolean)
  if (missing.length) {
    throw new Error(`保存后配件编码对账失败，以下编码未按原编码保存：${missing.join('、')}`)
  }
}

/** 子 BOM 在 bom_000 的 systemcode（与 kcac02 同源） */
function bomPartsSqlSubSystemcodeIsnullPreserve(partsCol, alias = 'b0') {
  return `p.[${partsCol}] = ISNULL(NULLIF(LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(${alias}.sub_systemcode, N'')))), N''), p.[${partsCol}])`
}

/** kcac02：子 BOM systemcode；无子档时保留行内原值 */
function bomPartsBuildKcac02Assignment(partColset, alias = 'b0') {
  if (!partColset.has('kcac02')) return null
  return bomPartsSqlSubSystemcodeIsnullPreserve('kcac02', alias)
}

/** systemcode：与 kcac02 一致，写入配件行上的子 BOM 身份证号（库内有该列时） */
function bomPartsBuildPartsSystemcodeAssignment(partColset, alias = 'b0') {
  if (!partColset.has('systemcode')) return null
  return bomPartsSqlSubSystemcodeIsnullPreserve('systemcode', alias)
}

/**
 * 单行保存 UPDATE：WHERE id + kcac01（主档 systemcode）双重锁定；kcaa01～35、kcac02、systemcode（若存在列）从 bom_000 同步；kcac04/05/06、cost_price、remark、Seq 来自请求体
 * @param {import('mssql').Transaction} tx
 * @param {Set<string>} partColset
 * @param {string} systemcode 主档 systemcode（即明细 kcac01）
 * @param {unknown} rawId 行 id
 * @param {Record<string, unknown>} raw 单行 lines[]
 */
async function bomPartsApplyFullLineUpdate(tx, partColset, systemcode, rawId, raw) {
  const kcaa01Up = String(raw?.kcaa01 ?? '').trim()
  const kcac04 = bomPartRoundDecimal6(raw?.kcac04)
  const kcac05 = bomPartRoundDecimal6(raw?.kcac05)
  const kcac06 = bomPartRoundDecimal6(
    raw?.kcac06 !== undefined && raw?.kcac06 !== null
      ? raw.kcac06
      : bomPartComputeKcac06(kcac04, kcac05),
  )
  const costNum = bomPartParseDecimal(raw?.cost_price)
  const seqNum = bomPartParseSeq(raw?.seq)

  const q = new sql.Request(tx)
  bomPartsSqlBindId(q, rawId)
  q.input('kcac01', sql.NVarChar(100), systemcode)
  q.input('kcaa01Up', sql.NVarChar(300), kcaa01Up)
  q.input('kcaa02', sql.NVarChar(500), raw?.kcaa02 != null ? String(raw.kcaa02) : '')
  q.input('kcaa03', sql.NVarChar(500), raw?.kcaa03 != null ? String(raw.kcaa03) : '')
  q.input('kcaa04', sql.NVarChar(100), raw?.kcaa04 != null ? String(raw.kcaa04) : '')
  q.input('kcaa11', sql.NVarChar(200), raw?.kcaa11 != null ? String(raw.kcaa11) : '')
  q.input('kcac04', sql.Decimal(18, 6), kcac04)
  q.input('kcac05', sql.Decimal(18, 6), kcac05)
  q.input('cost_price', sql.Decimal(18, 4), costNum)
  q.input('remark', sql.NVarChar(500), raw?.remark != null ? String(raw.remark) : '')
  q.input('seq', sql.Int, seqNum)
  if (partColset.has('kcac06')) {
    q.input('kcac06', sql.Decimal(18, 6), kcac06)
  }

  const applySql = bomPartsSqlOuterApplyLatestBom000ByPartKcaa01('b0')
  const setParts = []
  const kcac02Sql = bomPartsBuildKcac02Assignment(partColset, 'b0')
  if (kcac02Sql) setParts.push(kcac02Sql)
  const partsScSql = bomPartsBuildPartsSystemcodeAssignment(partColset, 'b0')
  if (partsScSql) setParts.push(partsScSql)
  setParts.push(...bomPartsBuildKcaaSyncAssignments(partColset, 'b0'))
  setParts.push('p.kcac04 = @kcac04', 'p.kcac05 = @kcac05')
  if (partColset.has('kcac06')) {
    setParts.push('p.kcac06 = @kcac06')
  }
  setParts.push('p.cost_price = @cost_price', 'p.remark = @remark', 'p.[Seq] = @seq')

  const ur = await q.query(`
    UPDATE p
    SET ${setParts.join(', ')}
    FROM ${INV_BOM_PARTS_FROM} AS p
    ${applySql}
    WHERE p.id = @id
      AND LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(p.kcac01, N'')))) =
          LTRIM(RTRIM(CONVERT(nvarchar(100), @kcac01)))
      AND (ISNULL(p.del, N'') = N'' OR p.del = N'0')
  `)
  const rowsAffected = Number(ur.rowsAffected?.[0] ?? 0)
  return { rowsAffected, kcaa01Up, kcac04, kcac05 }
}
let INV_BOM_MASTER_COLSET_PROMISE = null
async function getInvBomMasterColumnSet(pool) {
  if (INV_BOM_MASTER_COLSET_PROMISE) return INV_BOM_MASTER_COLSET_PROMISE
  const tbl = INV_BOM_MASTER_TABLE
  INV_BOM_MASTER_COLSET_PROMISE = (async () => {
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
      console.warn('[BOM主档] 读取 bom_000 列清单失败，已降级：', err?.message ?? err)
      return new Set()
    }
  })()
  return INV_BOM_MASTER_COLSET_PROMISE
}

/** Bom_parts 列清单（缓存），用于软删写 del/deltime 等兼容 */
let INV_BOM_PARTS_COLSET_PROMISE = null
async function getInvBomPartsColumnSet(pool) {
  if (INV_BOM_PARTS_COLSET_PROMISE) return INV_BOM_PARTS_COLSET_PROMISE
  const tbl = INV_BOM_PARTS_TABLE
  INV_BOM_PARTS_COLSET_PROMISE = (async () => {
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
      console.warn('[BOM配件表] 读取列清单失败，已降级：', err?.message ?? err)
      return new Set()
    }
  })()
  return INV_BOM_PARTS_COLSET_PROMISE
}

/**
 * Bom_parts.del 物理类型：少数旧库为 int/bit，多数为 nvarchar；错误类型会导致「软删」未命中或表现异常
 * @param {import('mssql').ConnectionPool} pool
 */
async function getInvBomPartsDelColumnKind(pool) {
  try {
    const r = await pool.request().input('tn', sql.NVarChar(128), INV_BOM_PARTS_TABLE).query(`
      SELECT DATA_TYPE AS dt
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = N'dbo' AND TABLE_NAME = @tn AND COLUMN_NAME = N'del'
    `)
    const dt = String(r.recordset?.[0]?.dt ?? '').toLowerCase()
    if (dt === 'bit' || dt === 'tinyint' || dt === 'smallint' || dt === 'int' || dt === 'bigint')
      return 'numeric'
    return 'nvarchar'
  } catch {
    return 'nvarchar'
  }
}
async function fetchBomUnitConversionDetail(pool, uUse, uPo, uQt) {
  const use = String(uUse ?? '').trim()
  const po = String(uPo ?? '').trim()
  const qt = String(uQt ?? '').trim()
  const empty = {
    purchase_direction: '',
    purchase_rate: '',
    quote_direction: '',
    quote_rate: '',
  }
  if (!use) return empty

  const str = (v) => (v == null ? '' : String(v))

  /** 采购 / 报价两条 TOP 1 互不依赖，并行以降低 BOM 详情 GET 尾延迟 */
  const tasks = []
  if (po) {
    tasks.push(
      pool
        .request()
        .input('uUse', sql.NVarChar(200), use)
        .input('uPo', sql.NVarChar(200), po)
        .query(`
        SELECT TOP 1
          LTRIM(RTRIM(CONVERT(nvarchar(80), ISNULL(c.change_bl, N'')))) AS rate,
          CASE
            WHEN LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(c.unit_name, N'')))) = @uPo
              AND LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(c.unit_name_tow, N'')))) = @uUse
              THEN N'po_to_use'
            WHEN LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(c.unit_name, N'')))) = @uUse
              AND LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(c.unit_name_tow, N'')))) = @uPo
              THEN N'use_to_po'
            ELSE N''
          END AS dir
        FROM ${BOM_UNIT_CHANGE_FROM} AS c
        WHERE (ISNULL(c.del, N'') = N'' OR c.del = N'0')
          AND LTRIM(RTRIM(ISNULL(c.pass, N''))) = N'1'
          AND (
            (LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(c.unit_name, N'')))) = @uPo
              AND LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(c.unit_name_tow, N'')))) = @uUse)
            OR
            (LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(c.unit_name, N'')))) = @uUse
              AND LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(c.unit_name_tow, N'')))) = @uPo)
          )
      `)
        .then((r) => ({ kind: 'purchase', row: r.recordset?.[0] })),
    )
  }
  if (qt) {
    tasks.push(
      pool
        .request()
        .input('uUse', sql.NVarChar(200), use)
        .input('uQt', sql.NVarChar(200), qt)
        .query(`
        SELECT TOP 1
          LTRIM(RTRIM(CONVERT(nvarchar(80), ISNULL(c.change_bl, N'')))) AS rate,
          CASE
            WHEN LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(c.unit_name, N'')))) = @uQt
              AND LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(c.unit_name_tow, N'')))) = @uUse
              THEN N'qt_to_use'
            WHEN LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(c.unit_name, N'')))) = @uUse
              AND LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(c.unit_name_tow, N'')))) = @uQt
              THEN N'use_to_qt'
            ELSE N''
          END AS dir
        FROM ${BOM_UNIT_CHANGE_FROM} AS c
        WHERE (ISNULL(c.del, N'') = N'' OR c.del = N'0')
          AND LTRIM(RTRIM(ISNULL(c.pass, N''))) = N'1'
          AND (
            (LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(c.unit_name, N'')))) = @uQt
              AND LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(c.unit_name_tow, N'')))) = @uUse)
            OR
            (LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(c.unit_name, N'')))) = @uUse
              AND LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(c.unit_name_tow, N'')))) = @uQt)
          )
      `)
        .then((r) => ({ kind: 'quote', row: r.recordset?.[0] })),
    )
  }

  let purchase_direction = ''
  let purchase_rate = ''
  let quote_direction = ''
  let quote_rate = ''
  const settled = await Promise.all(tasks)
  for (const item of settled) {
    if (item.kind === 'purchase' && item.row) {
      purchase_direction = str(item.row.dir).trim()
      purchase_rate = str(item.row.rate).trim()
    }
    if (item.kind === 'quote' && item.row) {
      quote_direction = str(item.row.dir).trim()
      quote_rate = str(item.row.rate).trim()
    }
  }

  return { purchase_direction, purchase_rate, quote_direction, quote_rate }
}

/**
 * 生产车间展示：编码, 名称（与分类名称逻辑类似；缺名称时保留逗号后占位便于测试核对）
 */
function buildBomWorkshopDisplay(code15, workshopName) {
  const c = String(code15 ?? '').trim()
  const n = String(workshopName ?? '').trim()
  if (!c && !n) return ''
  if (c && n) return `${c}, ${n}`
  if (c) return `${c}, —`
  return `—, ${n}`
}

/** 主列表生产车间：编码, 名称；缺名称时仅编码（空则空白，不用 em dash） */
function buildBomListWorkshopDisplay(code15, workshopName) {
  const c = String(code15 ?? '').trim()
  const n = String(workshopName ?? '').trim()
  if (!c && !n) return ''
  if (c && n) return `${c}, ${n}`
  return c || n
}

function bomListPurchaseDirectionLabel(kcaa27) {
  const n = Number(kcaa27)
  if (n === 1) return '使用->采购'
  if (n === 0) return '采购->使用'
  return ''
}

function bomListQuoteDirectionLabel(kcaa31) {
  const n = Number(kcaa31)
  if (n === 1) return '使用->报价'
  if (n === 0) return '报价->使用'
  return ''
}

function bomListBondedLabel(sign) {
  const s = String(sign ?? '').trim()
  if (s === '1') return '保税'
  if (s === '0') return '非保税'
  return ''
}

function bomListCustomerSupplyLabel(v) {
  const s = String(v ?? '').trim()
  if (s === '1' || s.toLowerCase() === 'y' || s === '是') return '是'
  if (s === '2' || s === '0' || s.toLowerCase() === 'n' || s === '否') return '否'
  return ''
}

/**
 * bom_000 列表 SELECT 片段：列不存在时 SELECT 空串占位，避免旧库报错
 * @param {Set<string>} colset
 */
function buildInvBomListMasterSelectLines(colset) {
  const has = (c) => colset.has(String(c).toLowerCase())
  const strCol = (col, alias, len = 500) => {
    const csql = col === 'decimal' ? '[decimal]' : col
    if (!has(col)) return `N'' AS ${alias}`
    return `LTRIM(RTRIM(CONVERT(nvarchar(${len}), ISNULL(b.${csql}, N'')))) AS ${alias}`
  }
  const decCol = (col, alias) => {
    if (!has(col)) return `N'' AS ${alias}`
    return `LTRIM(RTRIM(ISNULL(CONVERT(nvarchar(80), b.${col}), N''))) AS ${alias}`
  }
  const intCol = (col, alias) => {
    if (!has(col)) return `CAST(NULL AS int) AS ${alias}`
    return `b.${col} AS ${alias}`
  }
  return [
    strCol('kcaa02_en', 'kcaa02_en', 500),
    strCol('kpname', 'kpname', 500),
    strCol('kcaa05', 'kcaa05', 200),
    strCol('kcaa06', 'kcaa06', 300),
    strCol('kcaa09', 'kcaa09', 300),
    strCol('kcaa10', 'kcaa10', 200),
    strCol('kcaa11', 'kcaa11', 200),
    strCol('kcaa15', 'kcaa15', 50),
    strCol('location', 'location', 200),
    strCol('kcaa25', 'kcaa25', 100),
    decCol('kcaa26', 'kcaa26'),
    intCol('kcaa27', 'kcaa27'),
    strCol('kcaa29', 'kcaa29', 100),
    decCol('kcaa30', 'kcaa30'),
    intCol('kcaa31', 'kcaa31'),
    decCol('kcaa32', 'kcaa32'),
    decCol('kcaa33', 'kcaa33'),
    strCol('kcaa35', 'kcaa35', 80),
    decCol('sale_price', 'sale_price'),
    decCol('cost_price', 'cost_price'),
    intCol('Customer_supply', 'Customer_supply'),
    strCol('Customer_Name', 'Customer_Name', 500),
    strCol('uname', 'uname', 50),
    strCol('utruename', 'utruename', 50),
    strCol('uptruename', 'uptruename', 50),
    `LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(cat.name, N'')))) AS categoryName`,
    `LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(ws.name, N'')))) AS workshopName`,
  ]
}

/**
 * BOM 审计姓名：优先 Sys_Users.truename，无列或无值时回退登录态姓名
 * @param {import('mssql').ConnectionPool} pool
 * @param {{ uidInt: number | null, utruename: string | null }} actor
 */
async function resolveSysUsersTruenameForBomAudit(pool, actor) {
  const fallback = String(actor?.utruename ?? '').trim() || null
  const uidInt = actor?.uidInt
  if (!pool || uidInt == null) return fallback
  const meta = await getSysUsersColumnsMeta(pool)
  const qTruename = meta.qb('truename')
  const qPk = meta.legacyLayout ? meta.qb('uid') : meta.qb('userid')
  if (!qTruename || !qPk) return fallback
  const r = await pool.request().input('bomAuditUid', sql.Int, uidInt).query(`
    SELECT TOP (1) LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(u.${qTruename}, N'')))) AS truename
    FROM Sys_Users AS u
    WHERE u.${qPk} = @bomAuditUid
  `)
  const tn = String(r.recordset?.[0]?.truename ?? '').trim()
  return tn || fallback
}

function pushInvBomEditAuditOnMasterUpdate(colset, setParts, upd, actor) {
  if (colset.has('uptruename') && actor.utruename) {
    setParts.push('uptruename = @uptruename')
    upd.input('uptruename', sql.NVarChar(50), actor.utruename)
  }
}

function mapInvBomListRowExtraFields(row) {
  const str = (v) => (v == null ? '' : String(v))
  const addOp = str(row.utruename).trim()
  const editOp = str(row.uptruename).trim()
  const addtime = str(row.addtime).trim()
  const edittime = str(row.edittime).trim()
  const hasEdit = Boolean(edittime && edittime !== addtime)
  /** 列表「录入人/修改人」列：仅展示 bom_000.utruename / uptruename（时间见「输入/修改时间」列） */
  return {
    kcaa02_en: str(row.kcaa02_en),
    kpname: str(row.kpname),
    categoryName: str(row.categoryName),
    kcaa06: str(row.kcaa06),
    kcaa09: str(row.kcaa09),
    kcaa10: str(row.kcaa10),
    kcaa11: str(row.kcaa11),
    workshopDisplay: buildBomListWorkshopDisplay(row.kcaa15, row.workshopName),
    location: str(row.location),
    kcaa25: str(row.kcaa25),
    kcaa26: str(row.kcaa26),
    purchaseDirectionLabel: bomListPurchaseDirectionLabel(row.kcaa27),
    kcaa29: str(row.kcaa29),
    kcaa30: str(row.kcaa30),
    quoteDirectionLabel: bomListQuoteDirectionLabel(row.kcaa31),
    kcaa32: str(row.kcaa32),
    kcaa33: str(row.kcaa33),
    kcaa35: str(row.kcaa35),
    sale_price: str(row.sale_price),
    cost_price: str(row.cost_price),
    customerSupplyLabel: bomListCustomerSupplyLabel(row.Customer_supply),
    customerName: str(row.Customer_Name),
    bondedLabel: bomListBondedLabel(row.status ?? row.sign),
    addOperatorName: addOp,
    editOperatorName: editOp,
    showEditAuditLine: hasEdit || Boolean(editOp),
  }
}

/**
 * BOM 主档 systemcode：年月日 + MD5(时间随机+用户) + 用户尾缀（截断防超长）
 * @param {string|number|null|undefined} uidPart
 */
function generateInvBomSystemcode(uidPart) {
  const uid = String(uidPart ?? '').trim() || '0'
  const d = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  const ymd = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`
  const rnd = `${Date.now()}_${crypto.randomBytes(12).toString('hex')}_${uid}`
  const md5 = crypto.createHash('md5').update(rnd, 'utf8').digest('hex')
  const tail = (uid.replace(/\D/g, '').slice(-6) || uid.slice(0, 8)).replace(/\s+/g, '')
  const raw = `${ymd}${md5.slice(0, 22)}${tail}`
  return raw.slice(0, 88)
}

/**
 * kcaa01 唯一（在册行）；编辑时排除指定 systemcode
 * @param {import('mssql').ConnectionPool} pool
 * @param {string} kcaa01
 * @param {string} [excludeSystemcode]
 */
async function countInvBomDuplicateKcaa01(pool, kcaa01, excludeSystemcode) {
  const code = String(kcaa01 ?? '').trim()
  if (!code) return 0
  const ex = String(excludeSystemcode ?? '').trim()
  const req = pool.request().input('kcaa01', sql.NVarChar(300), code)
  let sqlEx = ''
  if (ex) {
    req.input('exsc', sql.NVarChar(100), ex)
    sqlEx = ` AND LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(b.systemcode, N'')))) <> @exsc `
  }
  const r = await req.query(`
    SELECT COUNT(1) AS cnt
    FROM ${INV_BOM_MASTER_FROM} AS b
    WHERE LTRIM(RTRIM(CONVERT(nvarchar(300), ISNULL(b.kcaa01, N'')))) = @kcaa01
      AND (ISNULL(b.del, N'') = N'' OR LTRIM(RTRIM(ISNULL(CONVERT(nvarchar(20), b.del), N''))) = N'0')
      ${sqlEx}
  `)
  return Number(r.recordset?.[0]?.cnt ?? 0)
}

/**
 * bom_000 是否已存在指定 systemcode（任意 del，避免主键/唯一冲突）
 * @param {import('mssql').ConnectionPool} pool
 * @param {string} systemcode
 */
async function invBomMasterSystemcodeExists(pool, systemcode) {
  const sc = String(systemcode ?? '').trim()
  if (!sc) return false
  const r = await pool.request().input('sc', sql.NVarChar(100), sc).query(`
    SELECT TOP (1) 1 AS x
    FROM ${INV_BOM_MASTER_FROM} AS b
    WHERE LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(b.systemcode, N'')))) = @sc
  `)
  return (r.recordset ?? []).length > 0
}

/**
 * 单位换算建议：使用单位 + 目标单位（采购或报价单位），匹配 Bom_unit_change 已审在册行
 * @returns {{ direction: 0|1|null, rate: string }}
 */
/**
 * 按 systemcode 读取 bom_000 一行（不区分在册/删除，供审核/删除审计）
 * @param {import('mssql').ConnectionPool} pool
 * @param {string} systemcodeRaw
 */
async function fetchInvBomMasterRowBySystemcode(pool, systemcodeRaw) {
  const sc = String(systemcodeRaw ?? '').trim()
  if (!sc) return null
  const r = await pool.request().input('sc', sql.NVarChar(100), sc).query(`
    SELECT TOP (1)
      LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(b.systemcode, N'')))) AS systemcode,
      LTRIM(RTRIM(ISNULL(CONVERT(nvarchar(10), b.pass), N''))) AS pass,
      LTRIM(RTRIM(ISNULL(CONVERT(nvarchar(20), b.del), N''))) AS del,
      LTRIM(RTRIM(CONVERT(nvarchar(300), ISNULL(b.kcaa01, N'')))) AS kcaa01,
      LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(b.kcaa02, N'')))) AS kcaa02
    FROM ${INV_BOM_MASTER_FROM} AS b
    WHERE LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(b.systemcode, N'')))) = @sc
  `)
  return r.recordset?.[0] ?? null
}

/**
 * BOM 钻取/配件 Tab：按 kcaa01 轻量读主档（无 JOIN、无单位换算）
 * @param {import('mssql').ConnectionPool} pool
 * @param {string} kcaa01Raw
 */
async function fetchInvBomMasterBriefByKcaa01(pool, kcaa01Raw) {
  const code = String(kcaa01Raw ?? '').trim()
  if (!code) return null
  const r = await pool.request().input('code', sql.NVarChar(300), code).query(`
    SELECT TOP (1)
      LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(b.systemcode, N'')))) AS systemcode,
      LTRIM(RTRIM(ISNULL(CONVERT(nvarchar(10), b.pass), N''))) AS pass,
      LTRIM(RTRIM(CONVERT(nvarchar(300), ISNULL(b.kcaa01, N'')))) AS kcaa01,
      LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(b.kcaa02, N'')))) AS kcaa02,
      LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(b.kcaa03, N'')))) AS kcaa03
    FROM ${INV_BOM_MASTER_FROM} AS b
    WHERE LTRIM(RTRIM(CONVERT(nvarchar(300), ISNULL(b.kcaa01, N'')))) = @code
      AND (ISNULL(b.del, N'') = N'' OR LTRIM(RTRIM(ISNULL(CONVERT(nvarchar(20), b.del), N''))) = N'0')
  `)
  return r.recordset?.[0] ?? null
}

async function lookupBomUnitChangeDirectionRate(pool, useName, otherName) {
  const use = String(useName ?? '').trim()
  const other = String(otherName ?? '').trim()
  if (!use || !other) return { direction: null, rate: '' }
  const r = await pool
    .request()
    .input('uUse', sql.NVarChar(200), use)
    .input('uOther', sql.NVarChar(200), other)
    .query(`
      SELECT TOP 1
        LTRIM(RTRIM(CONVERT(nvarchar(80), ISNULL(c.change_bl, N'')))) AS rate,
        CASE
          WHEN LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(c.unit_name, N'')))) = @uOther
            AND LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(c.unit_name_tow, N'')))) = @uUse
            THEN 0
          WHEN LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(c.unit_name, N'')))) = @uUse
            AND LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(c.unit_name_tow, N'')))) = @uOther
            THEN 1
          ELSE NULL
        END AS dir
      FROM ${BOM_UNIT_CHANGE_FROM} AS c
      WHERE (ISNULL(c.del, N'') = N'' OR c.del = N'0')
        AND LTRIM(RTRIM(ISNULL(c.pass, N''))) = N'1'
        AND (
          (LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(c.unit_name, N'')))) = @uOther
            AND LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(c.unit_name_tow, N'')))) = @uUse)
          OR
          (LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(c.unit_name, N'')))) = @uUse
            AND LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(c.unit_name_tow, N'')))) = @uOther)
        )
    `)
  const row = r.recordset?.[0]
  if (!row || row.dir == null || row.dir === '') {
    return { direction: null, rate: '' }
  }
  const dirNum = Number(row.dir)
  const direction = dirNum === 0 || dirNum === 1 ? /** @type {0|1} */ (dirNum) : null
  const rate = row.rate != null ? String(row.rate).trim() : ''
  return { direction, rate }
}

/** bom_cost 是否含 del 列（进程内缓存；列表用量聚合可选过滤） */
let BOM_COST_DEL_COLUMN_PROMISE = null
async function getBomCostHasDelColumn(pool) {
  if (BOM_COST_DEL_COLUMN_PROMISE) return BOM_COST_DEL_COLUMN_PROMISE
  BOM_COST_DEL_COLUMN_PROMISE = (async () => {
    try {
      const r = await pool.request().input('tn', sql.NVarChar(128), BOM_COST_TABLE).query(`
        SELECT 1 AS x
        FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = N'dbo' AND TABLE_NAME = @tn AND COLUMN_NAME = N'del'
      `)
      return (r.recordset?.length ?? 0) > 0
    } catch {
      return false
    }
  })()
  return BOM_COST_DEL_COLUMN_PROMISE
}

/** Map 键：sid + "\\x1f" + pq */
function bomCostSidPqMapKey(sid, pq) {
  return `${String(sid ?? '').trim()}\x1f${String(pq ?? '').trim()}`
}

/**
 * 本页「需运算」行去重后的 (sid,pq)，供单次 GROUP BY 聚合（禁止逐行查 bom_cost）
 * @param {{ is_need_calc?: any, code?: any, systemcode?: any, master_guid?: any }[]} rows
 */
function collectDistinctBomCostSidPqPairsFromListRows(rows) {
  /** @type {{ sid: string, pq: string }[]} */
  const out = []
  const seen = new Set()
  if (!Array.isArray(rows)) return out
  for (const row of rows) {
    if (Number(row?.is_need_calc ?? 0) !== 1) continue
    const pq = row.code != null ? String(row.code).trim() : ''
    if (!pq) continue
    const sc = row.systemcode != null ? String(row.systemcode).trim() : ''
    const guid = row.master_guid != null ? String(row.master_guid).trim() : ''
    for (const sid of [sc, guid]) {
      if (!sid) continue
      const k = bomCostSidPqMapKey(sid, pq)
      if (seen.has(k)) continue
      seen.add(k)
      out.push({ sid, pq })
    }
  }
  return out
}

/**
 * 单次 GROUP BY 聚合 bom_cost（第二步；禁止对 pairs 循环 await query）
 * @param {import('mssql').ConnectionPool} pool
 * @param {{ sid: string, pq: string }[]} pairs
 * @returns {Promise<Map<string, { cnt: number, total4: number, total6: number }>>}
 */
async function fetchBomCostAggregatesMapBySidPqPairs(pool, pairs) {
  const map = new Map()
  if (!pairs.length) return map
  const hasDel = await getBomCostHasDelColumn(pool)
  const delFrag = hasDel ? ` AND (ISNULL(c.del, N'') = N'' OR c.del = N'0')` : ''

  const req = pool.request()
  const orParts = []
  for (let i = 0; i < pairs.length; i += 1) {
    req.input(`bc_agg_sid_${i}`, sql.NVarChar(200), pairs[i].sid)
    req.input(`bc_agg_pq_${i}`, sql.NVarChar(300), pairs[i].pq)
    orParts.push(
      `(LTRIM(RTRIM(CONVERT(nvarchar(200), c.sid))) = @bc_agg_sid_${i} AND LTRIM(RTRIM(CONVERT(nvarchar(300), c.pq))) = @bc_agg_pq_${i})`,
    )
  }
  const r = await req.query(`
    SELECT
      LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(c.sid, N'')))) AS sid,
      LTRIM(RTRIM(CONVERT(nvarchar(300), ISNULL(c.pq, N'')))) AS pq,
      COUNT_BIG(1) AS cnt,
      ISNULL(SUM(ISNULL(CONVERT(decimal(18, 6), c.kcac04), 0)), 0) AS total_kcac04,
      ISNULL(SUM(ISNULL(CONVERT(decimal(18, 6), c.kcac06), 0)), 0) AS total_kcac06
    FROM ${BOM_COST_FROM} AS c
    WHERE (${orParts.join(' OR ')})
    ${delFrag}
    GROUP BY
      LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(c.sid, N'')))),
      LTRIM(RTRIM(CONVERT(nvarchar(300), ISNULL(c.pq, N''))))
  `)
  for (const row of r.recordset ?? []) {
    const sid = row.sid != null ? String(row.sid).trim() : ''
    const pq = row.pq != null ? String(row.pq).trim() : ''
    if (!sid || !pq) continue
    map.set(bomCostSidPqMapKey(sid, pq), {
      cnt: Number(row.cnt ?? 0),
      total4: Number(row.total_kcac04 ?? 0),
      total6: Number(row.total_kcac06 ?? 0),
    })
  }
  return map
}

/** 从聚合 Map 取本行（优先 systemcode，其次 GUID） */
function lookupBomCostAggregateForMasterRow(row, aggMap) {
  const pq = row.code != null ? String(row.code).trim() : ''
  const sc = row.systemcode != null ? String(row.systemcode).trim() : ''
  const guid = row.master_guid != null ? String(row.master_guid).trim() : ''
  if (!pq) return null
  if (sc) {
    const hit = aggMap.get(bomCostSidPqMapKey(sc, pq))
    if (hit && hit.cnt > 0) return hit
  }
  if (guid && guid !== sc) {
    const hit2 = aggMap.get(bomCostSidPqMapKey(guid, pq))
    if (hit2 && hit2.cnt > 0) return hit2
  }
  return null
}

/**
 * v1.1.8：BOM 主档分页列表（SQL Server 2008 R2：仅 ROW_NUMBER 分页，禁用 OFFSET-FETCH）
 * GET /api/inv/bom/list
 * - 默认排序：优先按 edittime DESC；edittime 为空则按 addtime DESC（保证打开页面先看到最近更新/新增）
 * - 合并搜索 `keyword`（≥3）：全模糊 + 兼容「连字符不一致」（库内常见 PQ3691 与 PQ-3691）：额外
 *   `(REPLACE(b.kcaa01,N'-',N'') LIKE @kwNormLike OR …kcaa02…)`，@kwNormLike 为去掉关键字中 `-` 后的 `%…%`
 * - 兼容旧参：无 `keyword` 时可用 `code`/`name`（均≥3），分别为 `kcaa01`、`kcaa02` 的全模糊；前后端约定「不足 3 字不筛」
 * - 用户显式搜 `CUT-` 开头（keyword 或 code）时，即使 `bom_cut=0` 也临时取消全局 `kcaa01 NOT LIKE N'CUT-%'`，否则无法命中裁片行
 * - bom_cut=1（仅裁片）：结果仅限 `kcaa01` 以 `CUT-` 开头（`UPPER(trim(kcaa01)) LIKE N'CUT-%'`，大小写不敏感）；keyword/name/code 等其它筛选不变
 * - 过滤：del 在册 + pass（与项目列表页「显示未审核」一致）
 * - 裁片：bom_cut=0 时默认 `kcaa01 NOT LIKE N'CUT-%'`（除非显式 CUT- 搜索）；bom_cut=1 时仅保留 CUT- 前缀行
 * - recycled=1：仅查 del=1（回收站），不按 pass 过滤
 * - bom_code_id：可选；Bom_code.id，按该分类 flag5 前缀匹配 kcaa01（BOM 分类，非 Bom_material）
 * - v1.2.8+：每行返回用量运算列 `usageCalcLabel`（不需运算/未运算/已运算）：`Bom_code`（copen=1 且 flag5 非空）为前缀集，
 *   主档 kcaa01 以任一 flag5 开头且 del=0 为需运算；已运算判定为 bom_cost（表名见 BOM_COST_TABLE）存在 pq=kcaa01 且 sid 为主档 [GUID] 或 systemcode（与现行 POST /api/bom/usage-calc 落库 sid 一致并兼容 GUID）
 * - v1.3.0+：用量（成本）列 — 禁止 OUTER APPLY 逐行扫 bom_cost；第二步对「本页需运算行」去重 (sid,pq) 后 **单次** `GROUP BY sid,pq` 聚合，内存 `Map(sid+'\\x1f'+pq)` 回填；若物理表含 `del` 列则附加在册条件（与 INFORMATION_SCHEMA 探测一致）
 */
/**
 * BOM 列表「BOM 分类」下拉：Bom_code 全表按 id 升序（非 Bom_material）
 * GET /api/inv/bom/bom-code-categories
 */
app.get('/api/inv/bom/bom-code-categories', async (req, res) => {
  try {
    const pool = await getPool()
    const r = await pool.request().query(`
      SELECT
        bc.id,
        LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(bc.flag1, N'')))) AS flag1,
        LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(bc.flag5, N'')))) AS flag5
      FROM ${INV_BOM_CODE_FROM} AS bc
      ORDER BY bc.id ASC
    `)
    const list = (r.recordset ?? []).map((row) => ({
      id: Number(row.id),
      flag1: String(row.flag1 ?? '').trim(),
      flag5: String(row.flag5 ?? '').trim(),
    }))
    res.json({ code: 200, msg: 'success', data: { list } })
  } catch (err) {
    console.error('GET /api/inv/bom/bom-code-categories 失败：', err)
    const detail = String(err?.message ?? err?.originalError?.message ?? '数据库查询失败')
    res.status(500).json({ code: 500, msg: `读取 BOM 分类失败：${detail}`, data: null })
  }
})

app.get('/api/inv/bom/list', async (req, res) => {
  try {
    const page = Math.max(1, Number(req.query?.page ?? 1) || 1)
    const pageSizeRaw = Number(req.query?.pageSize ?? 10) || 10
    const pageSize = Math.min(100, Math.max(1, pageSizeRaw))

    const recycledRaw = String(req.query?.recycled ?? '').trim().toLowerCase()
    const recycled = recycledRaw === '1' || recycledRaw === 'true' || recycledRaw === 'yes'

    const passRaw = String(req.query?.pass ?? '1').trim()
    const pass = passRaw === '0' ? '0' : '1'

    /** 0=默认排除裁片编码（CUT- 前缀）；1=包含裁片 */
    const bomCutRaw = String(req.query?.bom_cut ?? '0').trim()
    const bomCutInclude = bomCutRaw === '1' || bomCutRaw.toLowerCase() === 'true'

    const keywordRaw = String(req.query?.keyword ?? '').trim()
    const keywordOk = keywordRaw.length >= 3
    const kwLike = keywordOk ? `%${escapeSqlLikePattern(keywordRaw)}%` : ''
    /** 去掉连字符后的关键词（用于匹配 TAG-PQ3691… 与 PQ-3691… 混写）； strip 后不足 3 字则不启用该分支 */
    const keywordNoHyphen = keywordRaw.replace(/-/g, '')
    const keywordNormOk = keywordOk && keywordNoHyphen.length >= 3
    const kwNormLike = keywordNormOk ? `%${escapeSqlLikePattern(keywordNoHyphen)}%` : ''

    const bomCodeIdRaw = Number(req.query?.bom_code_id ?? req.query?.bomCodeId ?? '')
    const bomCodeId =
      Number.isFinite(bomCodeIdRaw) && bomCodeIdRaw > 0 ? Math.trunc(bomCodeIdRaw) : 0
    const hasBomCodeFilter = bomCodeId > 0

    const codeRaw = String(req.query?.code ?? '').trim()
    const nameRaw = String(req.query?.name ?? '').trim()
    const codeOk = !keywordOk && codeRaw.length >= 3
    const nameOk = !keywordOk && nameRaw.length >= 3
    const nameLike = nameOk ? `%${escapeSqlLikePattern(nameRaw)}%` : ''
    const codeContainsLike = codeOk ? `%${escapeSqlLikePattern(codeRaw)}%` : ''

    const pool = await getPool()
    const bomMasterColset = await getInvBomMasterColumnSet(pool)
    const bomListExtraSelect = buildInvBomListMasterSelectLines(bomMasterColset).join(',\n          ')

    /** 用户显式按裁片编码搜索（以 CUT- 开头） */
    const isExplicitCutCodeSearch = codeOk && codeRaw.toUpperCase().startsWith('CUT-')
    /** 统一关键词搜索裁片编码（与 keyword 模式共用 CUT 排除逻辑） */
    const isExplicitCutKeywordSearch = keywordOk && keywordRaw.toUpperCase().startsWith('CUT-')

    const codeNoHyphen = codeRaw.replace(/-/g, '')
    const codeNormOk = codeOk && codeNoHyphen.length >= 3
    const codeNormLike = codeNormOk ? `%${escapeSqlLikePattern(codeNoHyphen)}%` : ''
    const codeCondSql =
      !keywordOk && codeOk
        ? codeNormOk
          ? ` AND (
            b.kcaa01 LIKE @codeContainsLike
            OR REPLACE(b.kcaa01, N'-', N'') LIKE @codeNormLike
          ) `
          : ' AND b.kcaa01 LIKE @codeContainsLike '
        : ''

    const keywordOrSql = keywordOk
      ? keywordNormOk
        ? ` AND (
          (b.kcaa01 LIKE @kwLike OR b.kcaa02 LIKE @kwLike)
          OR (
            REPLACE(b.kcaa01, N'-', N'') LIKE @kwNormLike
            OR REPLACE(b.kcaa02, N'-', N'') LIKE @kwNormLike
          )
        ) `
        : ' AND (b.kcaa01 LIKE @kwLike OR b.kcaa02 LIKE @kwLike) '
      : ''

    /** bom_cut=1：仅保留裁片主档（编码以 CUT- 开头，忽略大小写）；bom_cut=0：默认排除 CUT-，除非用户显式按 CUT- 搜索 */
    let whereCutSql = ''
    if (bomCutInclude) {
      whereCutSql = ` AND UPPER(LTRIM(RTRIM(CONVERT(nvarchar(300), ISNULL(b.kcaa01, N''))))) LIKE N'CUT-%' `
    } else if (!isExplicitCutCodeSearch && !isExplicitCutKeywordSearch) {
      whereCutSql = ` AND b.kcaa01 NOT LIKE N'CUT-%' `
    }
    /** Bom_code：flag5 非空时按 kcaa01 前缀；否则 kcaa05 与 id 字符串精确匹配 */
    const whereBomCodeSql = hasBomCodeFilter
      ? ` AND EXISTS (
          SELECT 1
          FROM ${INV_BOM_CODE_FROM} AS bc_f
          WHERE bc_f.id = @bomCodeId
            AND (
              (
                LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(bc_f.flag5, N'')))) <> N''
                AND UPPER(LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(b.kcaa01, N'')))))
                  LIKE UPPER(LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(bc_f.flag5, N''))))) + N'%'
              )
              OR (
                LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(bc_f.flag5, N'')))) = N''
                AND LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(b.kcaa05, N''))))
                  = LTRIM(RTRIM(CONVERT(nvarchar(50), bc_f.id)))
              )
            )
        ) `
      : ''
    const whereBase = recycled
      ? `
      WHERE LTRIM(RTRIM(ISNULL(CONVERT(nvarchar(20), b.del), N''))) = N'1'
      ${whereCutSql}
      ${whereBomCodeSql}
      ${keywordOk ? keywordOrSql : `${codeCondSql}${nameOk ? ' AND b.kcaa02 LIKE @nameLike ' : ''}`}
    `
      : `
      WHERE (ISNULL(b.del, N'') = N'' OR b.del = N'0')
        AND LTRIM(RTRIM(ISNULL(b.pass, N''))) = @pass
      ${whereCutSql}
      ${whereBomCodeSql}
      ${keywordOk ? keywordOrSql : `${codeCondSql}${nameOk ? ' AND b.kcaa02 LIKE @nameLike ' : ''}`}
    `

    const countReq = pool.request()
    if (!recycled) countReq.input('pass', sql.NVarChar(10), pass)
    if (hasBomCodeFilter) countReq.input('bomCodeId', sql.Int, bomCodeId)
    if (keywordOk) countReq.input('kwLike', sql.NVarChar(300), kwLike)
    if (keywordNormOk) countReq.input('kwNormLike', sql.NVarChar(300), kwNormLike)
    if (codeOk) countReq.input('codeContainsLike', sql.NVarChar(300), codeContainsLike)
    if (codeNormOk) countReq.input('codeNormLike', sql.NVarChar(300), codeNormLike)
    if (nameOk) countReq.input('nameLike', sql.NVarChar(300), nameLike)

    const tCount0 = Date.now()
    const totalRow = await countReq.query(`
      SELECT COUNT(1) AS total
      FROM ${INV_BOM_MASTER_FROM} AS b
      ${whereBase}
    `)
    const tCount1 = Date.now()
    if (tCount1 - tCount0 > 500) {
      console.warn(
        `[BOM列表] COUNT 查询耗时 ${tCount1 - tCount0}ms（>500ms）：kcaa01/kcaa02 含前导 % 的全模糊可能无法命中前缀索引，建议在库端评估索引或全文检索 CONTAINS`,
      )
    }
    const total = Number(totalRow.recordset?.[0]?.total ?? 0)

    const safeOffset = (page - 1) * pageSize
    const startRow = safeOffset + 1
    const endRow = safeOffset + pageSize

    const listReq = pool.request()
    if (!recycled) listReq.input('pass', sql.NVarChar(10), pass)
    if (hasBomCodeFilter) listReq.input('bomCodeId', sql.Int, bomCodeId)
    listReq.input('startRow', sql.Int, startRow)
    listReq.input('endRow', sql.Int, endRow)
    if (keywordOk) listReq.input('kwLike', sql.NVarChar(300), kwLike)
    if (keywordNormOk) listReq.input('kwNormLike', sql.NVarChar(300), kwNormLike)
    if (codeOk) listReq.input('codeContainsLike', sql.NVarChar(300), codeContainsLike)
    if (codeNormOk) listReq.input('codeNormLike', sql.NVarChar(300), codeNormLike)
    if (nameOk) listReq.input('nameLike', sql.NVarChar(300), nameLike)

    const tList0 = Date.now()
    const listResult = await listReq.query(`
      ;WITH base AS (
        SELECT
          LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(b.systemcode, N'')))) AS systemcode,
          LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(b.[GUID], N'')))) AS master_guid,
          b.kcaa01 AS code,
          b.kcaa02 AS product_name,
          b.kcaa03 AS spec,
          b.kcaa04 AS unit,
          CONVERT(nvarchar(100), ISNULL(b.addtime, N'')) AS addtime,
          CONVERT(nvarchar(100), ISNULL(b.edittime, N'')) AS edittime,
          CONVERT(nvarchar(500), ISNULL(b.remark, N'')) AS remark,
          b.kcaa12 AS isPurchase,
          b.kcaa13 AS isSubcontract,
          b.kcaa14 AS isSelfProduced,
          b.sign AS status,
          b.[version] AS version,
          b.pass AS pass,
          CASE
            WHEN LTRIM(RTRIM(ISNULL(CONVERT(nvarchar(20), b.del), N''))) = N'1' THEN 0
            WHEN EXISTS (
              SELECT 1
              FROM ${INV_BOM_CODE_FROM} AS bc
              WHERE LTRIM(RTRIM(CONVERT(nvarchar(50), ISNULL(bc.copen, N'')))) = N'1'
                AND LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(bc.flag5, N'')))) <> N''
                AND LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(b.kcaa01, N'')))) LIKE (
                  LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(bc.flag5, N'')))) + N'%'
                )
            ) THEN 1
            ELSE 0
          END AS is_need_calc,
          CASE
            WHEN LTRIM(RTRIM(ISNULL(CONVERT(nvarchar(20), b.del), N''))) = N'1' THEN 0
            WHEN NOT EXISTS (
              SELECT 1
              FROM ${INV_BOM_CODE_FROM} AS bc2
              WHERE LTRIM(RTRIM(CONVERT(nvarchar(50), ISNULL(bc2.copen, N'')))) = N'1'
                AND LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(bc2.flag5, N'')))) <> N''
                AND LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(b.kcaa01, N'')))) LIKE (
                  LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(bc2.flag5, N'')))) + N'%'
                )
            ) THEN 0
            WHEN EXISTS (
              SELECT 1
              FROM ${BOM_COST_FROM} AS c
              WHERE LTRIM(RTRIM(CONVERT(nvarchar(300), ISNULL(c.pq, N'')))) = LTRIM(RTRIM(CONVERT(nvarchar(300), ISNULL(b.kcaa01, N''))))
                AND (
                  LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(c.sid, N'')))) = LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(b.[GUID], N''))))
                  OR LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(c.sid, N'')))) = LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(b.systemcode, N''))))
                )
            ) THEN 1
            ELSE 0
          END AS has_bom_cost_cached,
          ${bomListExtraSelect},
          ROW_NUMBER() OVER (
            ORDER BY
              CASE
                WHEN LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(b.edittime, N'')))) = N''
                THEN LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(b.addtime, N''))))
                ELSE LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(b.edittime, N''))))
              END DESC,
              b.kcaa01 ASC
          ) AS rn
        FROM ${INV_BOM_MASTER_FROM} AS b
        LEFT JOIN ${BOM_MATERIAL_FROM} AS cat
          ON LTRIM(RTRIM(ISNULL(CONVERT(nvarchar(200), b.kcaa05), N''))) = LTRIM(RTRIM(ISNULL(CONVERT(nvarchar(200), cat.code), N'')))
        LEFT JOIN ${BOM_STOCKS_WORKSHOP_FROM} AS ws
          ON LTRIM(RTRIM(ISNULL(CONVERT(nvarchar(200), b.kcaa15), N''))) = LTRIM(RTRIM(ISNULL(CONVERT(nvarchar(200), ws.code), N'')))
        ${whereBase}
      )
      SELECT
        p.systemcode,
        p.master_guid,
        p.code,
        p.product_name,
        p.spec,
        p.unit,
        p.addtime,
        p.edittime,
        p.remark,
        p.isPurchase,
        p.isSubcontract,
        p.isSelfProduced,
        p.status,
        p.version,
        p.pass,
        p.is_need_calc,
        p.has_bom_cost_cached,
        p.kcaa02_en,
        p.kpname,
        p.kcaa05,
        p.kcaa06,
        p.kcaa09,
        p.kcaa10,
        p.kcaa11,
        p.kcaa15,
        p.location,
        p.kcaa25,
        p.kcaa26,
        p.kcaa27,
        p.kcaa29,
        p.kcaa30,
        p.kcaa31,
        p.kcaa32,
        p.kcaa33,
        p.kcaa35,
        p.sale_price,
        p.cost_price,
        p.Customer_supply,
        p.Customer_Name,
        p.uname,
        p.utruename,
        p.uptruename,
        p.categoryName,
        p.workshopName
      FROM base AS p
      WHERE p.rn BETWEEN @startRow AND @endRow
      ORDER BY p.rn
    `)
    const tList1 = Date.now()
    if (tList1 - tList0 > 500) {
      console.warn(
        `[BOM列表] LIST 查询耗时 ${tList1 - tList0}ms（>500ms）：建议 DBA 检查执行计划；大表可考虑全文检索优化含前导 % 的模糊条件`,
      )
    }

    const rawRows = listResult.recordset ?? []
    const bomCostPairs = collectDistinctBomCostSidPqPairsFromListRows(rawRows)
    const bomCostAggMap = await fetchBomCostAggregatesMapBySidPqPairs(pool, bomCostPairs)

    const list = rawRows.map((row) => {
      const isNeedCalc = Number(row.is_need_calc ?? 0) === 1
      const hasBomCostCached = Number(row.has_bom_cost_cached ?? 0) === 1
      let usageCalcLabel = '不需运算'
      let usageCalcStatus = 'none'
      if (isNeedCalc) {
        if (hasBomCostCached) {
          usageCalcLabel = '已运算'
          usageCalcStatus = 'done'
        } else {
          usageCalcLabel = '未运算'
          usageCalcStatus = 'pending'
        }
      }
      const aggHit = lookupBomCostAggregateForMasterRow(row, bomCostAggMap)
      const bomCostAggCnt = aggHit && Number(aggHit.cnt) > 0 ? Number(aggHit.cnt) : 0
      /** 用量（成本）：仅需运算行展示；库内列为 kcac04/kcac06 */
      let bomCostUsageCostText = ''
      if (isNeedCalc) {
        if (!bomCostAggCnt) {
          bomCostUsageCostText = '-'
        } else {
          const sum4 = Number(aggHit?.total4 ?? 0)
          const sum6 = Number(aggHit?.total6 ?? 0)
          const s4 = Number.isFinite(sum4) ? sum4.toFixed(4) : '0.0000'
          const s6 = Number.isFinite(sum6) ? sum6.toFixed(4) : '0.0000'
          bomCostUsageCostText = `成本：${s4},${s6}`
        }
      }
      return {
        systemcode: row.systemcode != null ? String(row.systemcode) : '',
        code: row.code != null ? String(row.code) : '',
        /** bom_000.kcaa02 名称(中文) */
        kcaa02: row.product_name != null ? String(row.product_name) : '',
        name: row.product_name != null ? String(row.product_name) : '',
        spec: row.spec != null ? String(row.spec) : '',
        unit: row.unit != null ? String(row.unit) : '',
        addtime: row.addtime != null ? String(row.addtime) : '',
        edittime: row.edittime != null ? String(row.edittime) : '',
        remark: row.remark != null ? String(row.remark) : '',
        isPurchase: row.isPurchase != null ? String(row.isPurchase) : '',
        isSubcontract: row.isSubcontract != null ? String(row.isSubcontract) : '',
        isSelfProduced: row.isSelfProduced != null ? String(row.isSelfProduced) : '',
        status: row.status != null ? String(row.status) : '',
        version: row.version != null ? String(row.version) : '',
        pass: row.pass != null ? String(row.pass) : '',
        isNeedCalc,
        hasBomCostCache: hasBomCostCached,
        usageCalcLabel,
        usageCalcStatus,
        bomCostUsageCostText,
        ...mapInvBomListRowExtraFields(row),
      }
    })

    res.json({ code: 200, msg: 'success', data: { total, list, recycled } })
  } catch (err) {
    console.error('GET /api/inv/bom/list 失败：', err)
    const detail = String(err?.message ?? err?.originalError?.message ?? '数据库查询失败')
    res.status(500).json({ code: 500, msg: `读取 BOM 列表失败：${detail}`, data: null })
  }
})

const BOM_COST_HIDE_PREFIX_CAP_SERVER = 50
const BOM_COST_HIDE_PREFIX_LEN_SERVER = 80

/** @param {unknown[]} list */
function normalizeBomCostHidePrefixesServer(list) {
  const arr = Array.isArray(list) ? list : []
  const seen = new Set()
  const out = []
  for (const item of arr) {
    const t = String(item ?? '').trim().slice(0, BOM_COST_HIDE_PREFIX_LEN_SERVER)
    if (!t) continue
    const k = t.toLowerCase()
    if (seen.has(k)) continue
    seen.add(k)
    out.push(t)
    if (out.length >= BOM_COST_HIDE_PREFIX_CAP_SERVER) break
  }
  return out
}

/**
 * 批量 INSERT Bom_consumption（单语句多 VALUES；切片控制参数数量）
 * @param {import('mssql').Transaction} tx
 * @param {string} pq
 * @param {string} sid
 * @param {{ kcaa01: string, kcaa02: string, kcaa03: string, kcaa04: string, sumay: number, sumby: number, kcac05: number }[]} rows
 */
async function insertBomConsumptionBulk(tx, pq, sid, rows) {
  if (!rows.length) return
  const pqV = String(pq ?? '').trim()
  const sidV = String(sid ?? '').trim()
  const DEC = sql.Decimal(28, 10)
  const NV300 = sql.NVarChar(300)
  const NV80 = sql.NVarChar(80)
  const ROW_PARAMS = 8
  const maxRowsPerChunk = Math.min(100, Math.floor((2000 - 2) / ROW_PARAMS))

  for (let off = 0; off < rows.length; off += maxRowsPerChunk) {
    const slice = rows.slice(off, off + maxRowsPerChunk)
    const req = new sql.Request(tx)
    req.input('pq', sql.NVarChar(300), pqV)
    req.input('sid', sql.NVarChar(100), sidV)
    const valueTuples = []
    for (let i = 0; i < slice.length; i++) {
      const row = slice[i]
      const pre = `p${off}_${i}_`
      const k2 = String(row.kcaa02 ?? '').trim()
      const k3 = String(row.kcaa03 ?? '').trim()
      const k4 = String(row.kcaa04 ?? '').trim()
      req.input(`${pre}k1`, NV300, String(row.kcaa01 ?? '').trim())
      req.input(`${pre}k2`, NV300, k2 || null)
      req.input(`${pre}k3`, NV300, k3 || null)
      req.input(`${pre}k4`, NV80, k4 || null)
      req.input(`${pre}sa`, DEC, Number.isFinite(Number(row.sumay)) ? Number(row.sumay) : 0)
      req.input(`${pre}sb`, DEC, Number.isFinite(Number(row.sumby)) ? Number(row.sumby) : 0)
      req.input(`${pre}lr`, DEC, Number.isFinite(Number(row.kcac05)) ? Number(row.kcac05) : 0)
      valueTuples.push(`(@pq, @sid, @${pre}k1, @${pre}k2, @${pre}k3, @${pre}k4, @${pre}sa, @${pre}sb, @${pre}lr)`)
    }
    await req.query(`
      INSERT INTO ${BOM_CONSUMPTION_FROM} (pq, sid, kcaa01, kcaa02, kcaa03, kcaa04, sumay, sumby, kcac05)
      VALUES ${valueTuples.join(',\n')}
    `)
  }
}

/** 按主档 systemcode 解析 pq（成品编码）、sid（主档 systemcode），供 bom_cost / Bom_consumption */
async function fetchBomUsageHeadBySystemcode(pool, systemcode) {
  const sc = String(systemcode ?? '').trim()
  if (!sc) return null
  const headRs = await pool
    .request()
    .input('sc', sql.NVarChar(100), sc)
    .query(`
      SELECT TOP 1
        LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(b.systemcode, N'')))) AS systemcode,
        LTRIM(RTRIM(CONVERT(nvarchar(300), ISNULL(b.kcaa01, N'')))) AS kcaa01
      FROM ${INV_BOM_MASTER_FROM} AS b
      WHERE LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(b.systemcode, N'')))) = @sc
        AND (ISNULL(b.del, N'') = N'' OR b.del = N'0')
    `)
  const head = headRs.recordset?.[0] ?? null
  const sid = String(head?.systemcode ?? '').trim()
  const pq = String(head?.kcaa01 ?? '').trim() || sc
  if (!sid) return null
  return { sid, pq }
}

async function fetchBomUsageCalcEligibility(pool, systemcode) {
  const sc = String(systemcode ?? '').trim()
  if (!sc) return null
  const rs = await pool
    .request()
    .input('sc', sql.NVarChar(100), sc)
    .query(`
      SELECT TOP 1
        LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(b.systemcode, N'')))) AS systemcode,
        LTRIM(RTRIM(CONVERT(nvarchar(300), ISNULL(b.kcaa01, N'')))) AS kcaa01,
        LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(b.[GUID], N'')))) AS master_guid,
        CASE
          WHEN LTRIM(RTRIM(ISNULL(CONVERT(nvarchar(20), b.del), N''))) = N'1' THEN 0
          WHEN EXISTS (
            SELECT 1
            FROM ${INV_BOM_CODE_FROM} AS bc
            WHERE LTRIM(RTRIM(CONVERT(nvarchar(50), ISNULL(bc.copen, N'')))) = N'1'
              AND LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(bc.flag5, N'')))) <> N''
              AND LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(b.kcaa01, N'')))) LIKE (
                LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(bc.flag5, N'')))) + N'%'
              )
          ) THEN 1
          ELSE 0
        END AS is_need_calc,
        CASE
          WHEN EXISTS (
            SELECT 1
            FROM ${BOM_COST_FROM} AS c
            WHERE LTRIM(RTRIM(CONVERT(nvarchar(300), ISNULL(c.pq, N'')))) = LTRIM(RTRIM(CONVERT(nvarchar(300), ISNULL(b.kcaa01, N''))))
              AND (
                LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(c.sid, N'')))) = LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(b.[GUID], N''))))
                OR LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(c.sid, N'')))) = LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(b.systemcode, N''))))
              )
          ) THEN 1
          ELSE 0
        END AS has_bom_cost_cached
      FROM ${INV_BOM_MASTER_FROM} AS b
      WHERE LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(b.systemcode, N'')))) = @sc
        AND (ISNULL(b.del, N'') = N'' OR b.del = N'0')
    `)
  const row = rs.recordset?.[0] ?? null
  if (!row) return null
  const sid = String(row.systemcode ?? '').trim()
  const pq = String(row.kcaa01 ?? '').trim() || sc
  if (!sid) return null
  return {
    sid,
    pq,
    systemcode: sid,
    code: pq,
    isNeedCalc: Number(row.is_need_calc ?? 0) === 1,
    hasBomCostCached: Number(row.has_bom_cost_cached ?? 0) === 1,
  }
}

async function runBomUsageCalcForHead(pool, head, hidePrefixes, actor) {
  const systemcode = String(head?.sid ?? head?.systemcode ?? '').trim()
  const pq = String(head?.pq ?? '').trim()
  if (!systemcode || !pq) throw new Error('主档缺少 systemcode 或物料编码')

  const tCalc0 = Date.now()
  const bomHeadStack = new Set([systemcode])
  const tTree0 = Date.now()
  const data = await buildBomPartsUsageTreeNodes(pool, systemcode, 1, bomHeadStack)
  const treeMs = Date.now() - tTree0
  const tFlat0 = Date.now()
  const flatCostUsageRaw = flattenBomPartsCostUsageFlatForBomCost(data, null, [])
  const flatMs = Date.now() - tFlat0
  const bomCostInsertPayload = buildBomCostInsertPayloadFromFlatUsage(
    flatCostUsageRaw,
    hidePrefixes,
    pq,
  )
  const tEnrich0 = Date.now()
  const bom000Map = await fetchBom000ForBomCostEnrich(
    pool,
    bomCostInsertPayload.map((r) => r.kcaa01),
  )
  const bomCostRowsEnriched = enrichBomCostInsertRowsFromBom000(bomCostInsertPayload, bom000Map)
  const bomMaterialPxMap = isPqBomCostHead(pq)
    ? await fetchBomMaterialPxByCategoryCodes(
        pool,
        bomCostRowsEnriched.map((r) => r.kcaa05),
      )
    : new Map()
  const bomCostRowsWithPx = applyBomCostPxForPqRows(bomCostRowsEnriched, pq, bomMaterialPxMap)
  const enrichMs = Date.now() - tEnrich0
  const bomCostRowsFinal = applyBomCostAuditToRows(bomCostRowsWithPx, {
    actor,
    addtime: formatBomCostAuditTimestamp(),
  })

  const tTx0 = Date.now()
  const tx = new sql.Transaction(pool)
  await tx.begin()
  try {
    const delBc = new sql.Request(tx)
    delBc.input('pq', sql.NVarChar(300), pq)
    delBc.input('sid', sql.NVarChar(100), systemcode)
    await delBc.query(`DELETE FROM ${BOM_COST_FROM} WHERE pq = @pq AND sid = @sid`)

    if (bomCostRowsFinal.length) {
      await insertBomCostBulkEnriched(pool, tx, pq, systemcode, bomCostRowsFinal)
    }

    const upOk = new sql.Request(tx)
    upOk.input('pq', sql.NVarChar(300), pq)
    upOk.input('sid', sql.NVarChar(100), systemcode)
    await upOk.query(`UPDATE ${BOM_COST_FROM} SET isok = 1 WHERE pq = @pq AND sid = @sid AND isok = 0`)

    await tx.commit()
  } catch (innerErr) {
    try {
      await tx.rollback()
    } catch {
      // ignore
    }
    console.error('POST /api/bom/usage-calc 事务失败：', innerErr)
    throw new Error('bom_cost写入失败')
  }

  const selBc = await pool
    .request()
    .input('pq', sql.NVarChar(300), pq)
    .input('sid', sql.NVarChar(100), systemcode)
    .query(`
      SELECT id, pq, sid, kcaa01, kcaa02, kcaa03, kcaa04, kcac04, kcac05, kcac06, kcac07, kcac08, [Describe], isok
      FROM ${BOM_COST_FROM}
      WHERE pq = @pq AND sid = @sid
      ORDER BY ${buildBomCostReadOrderBy(pq)}
    `)

  const bomCost = (selBc.recordset ?? []).map(mapBomCostRecordToDto)
  const txMs = Date.now() - tTx0
  const totalMs = Date.now() - tCalc0
  return {
    total: bomCost.length,
    data,
    flatCostUsageRaw,
    bomCost,
    metrics: {
      systemcode,
      flatRows: flatCostUsageRaw.length,
      bomCostFlatRows: flatCostUsageRaw.length,
      bomCostRows: bomCost.length,
      treeMs,
      flatMs,
      enrichMs,
      txMs,
      totalMs,
    },
  }
}

/**
 * 配件明细保存后，只清当前 BOM 的成本用量缓存。
 * 已审核 BOM 不允许编辑，所以这里不额外反审，也不递归影响上级 BOM。
 * @param {import('mssql').ConnectionPool | import('mssql').Transaction} executor
 * @param {string} systemcode 本次保存的 BOM systemcode
 * @returns {Promise<{ affected: number, unaudited: number, deleted: number }>}
 */
async function invalidateBomCostCacheForPartsChange(executor, systemcode) {
  return markCurrentBomCostStale(executor, systemcode)
}

/** 查询行 → 前端 bom_cost DTO */
function mapBomCostRecordToDto(r) {
  return {
    id: r.id,
    pq: r.pq != null ? String(r.pq) : '',
    sid: r.sid != null ? String(r.sid) : '',
    kcaa01: r.kcaa01 != null ? String(r.kcaa01) : '',
    kcaa02: r.kcaa02 != null ? String(r.kcaa02) : '',
    kcaa03: r.kcaa03 != null ? String(r.kcaa03) : '',
    kcaa04: r.kcaa04 != null ? String(r.kcaa04) : '',
    kcac04: r.kcac04 != null ? Number(r.kcac04) : 0,
    kcac05: r.kcac05 != null ? Number(r.kcac05) : 0,
    kcac06: r.kcac06 != null ? Number(r.kcac06) : 0,
    kcac07: r.kcac07 != null ? Number(r.kcac07) : null,
    kcac08: r.kcac08 != null ? Number(r.kcac08) : null,
    Describe: r.Describe != null ? String(r.Describe) : '',
    isok: r.isok != null ? Number(r.isok) : 0,
  }
}

/** PQ 主 BOM 成本用量表按 bom_cost.px 排序；其它主 BOM 保持旧的落库顺序。 */
function buildBomCostReadOrderBy(pq) {
  if (isPqBomCostHead(pq)) {
    return 'CASE WHEN px IS NULL THEN 1 ELSE 0 END ASC, px ASC, id ASC'
  }
  return 'id ASC'
}

/** 查询行 → 前端 Bom_consumption DTO */
function mapBomConsumptionRecordToDto(r) {
  return {
    id: r.id,
    pq: r.pq != null ? String(r.pq) : '',
    sid: r.sid != null ? String(r.sid) : '',
    kcaa01: r.kcaa01 != null ? String(r.kcaa01) : '',
    kcaa02: r.kcaa02 != null ? String(r.kcaa02) : '',
    kcaa03: r.kcaa03 != null ? String(r.kcaa03) : '',
    kcaa04: r.kcaa04 != null ? String(r.kcaa04) : '',
    sumay: r.sumay != null ? Number(r.sumay) : 0,
    sumby: r.sumby != null ? Number(r.sumby) : 0,
    kcac05: r.kcac05 != null ? Number(r.kcac05) : 0,
  }
}

/**
 * BOM 用量运算：递归 Bom_parts + 成本平铺 + 单事务覆盖写入 bom_cost（hidePrefixes 剔除 + 跳过主 BOM 根行，平铺不合并）
 * POST /api/bom/usage-calc
 * body: { systemcode, hidePrefixes?: string[] }
 * 成功：{ success:true, total(bom_cost 行数), data, flatCostUsageRaw, bomCost }（树 data 供「BOM用量表运算」不变）
 */
app.post('/api/bom/usage-calc', async (req, res) => {
  try {
    const systemcode = String(req.body?.systemcode ?? '').trim()
    if (!systemcode) {
      res.status(400).json({ success: false, msg: '参数错误：systemcode 不能为空', total: 0 })
      return
    }
    const hidePrefixes = normalizeBomCostHidePrefixesServer(
      Array.isArray(req.body?.hidePrefixes) ? req.body.hidePrefixes : [],
    )

    const pool = await getPool()
    const head = await fetchBomUsageHeadBySystemcode(pool, systemcode)
    if (!head) {
      res.status(404).json({ success: false, msg: '未找到对应主档或主档缺少 systemcode', total: 0 })
      return
    }
    const { sid, pq } = head

    const tCalc0 = Date.now()
    const bomHeadStack = new Set([systemcode])
    const tTree0 = Date.now()
    const data = await buildBomPartsUsageTreeNodes(pool, systemcode, 1, bomHeadStack)
    const treeMs = Date.now() - tTree0
    const tFlat0 = Date.now()
    const flatCostUsageRaw = flattenBomPartsCostUsageFlatForBomCost(data, null, [])
    const flatMs = Date.now() - tFlat0
    /** bom_cost：剔除隐藏前缀 + 跳过主档 pq 根行，平铺不合并（Bom_consumption 已停用，历史数据不维护） */
    const bomCostInsertPayload = buildBomCostInsertPayloadFromFlatUsage(
      flatCostUsageRaw,
      hidePrefixes,
      pq,
    )
    const tEnrich0 = Date.now()
    const bom000Map = await fetchBom000ForBomCostEnrich(
      pool,
      bomCostInsertPayload.map((r) => r.kcaa01),
    )
    const bomCostRowsEnriched = enrichBomCostInsertRowsFromBom000(bomCostInsertPayload, bom000Map)
    const bomMaterialPxMap = isPqBomCostHead(pq)
      ? await fetchBomMaterialPxByCategoryCodes(
          pool,
          bomCostRowsEnriched.map((r) => r.kcaa05),
        )
      : new Map()
    const bomCostRowsWithPx = applyBomCostPxForPqRows(bomCostRowsEnriched, pq, bomMaterialPxMap)
    const enrichMs = Date.now() - tEnrich0
    const actor = getActorAuditTripletFromReq(req)
    const bomCostRowsFinal = applyBomCostAuditToRows(bomCostRowsWithPx, {
      actor,
      addtime: formatBomCostAuditTimestamp(),
    })

    const tTx0 = Date.now()
    const tx = new sql.Transaction(pool)
    await tx.begin()
    try {
      const delBc = new sql.Request(tx)
      delBc.input('pq', sql.NVarChar(300), pq)
      delBc.input('sid', sql.NVarChar(100), sid)
      await delBc.query(`DELETE FROM ${BOM_COST_FROM} WHERE pq = @pq AND sid = @sid`)

      if (bomCostRowsFinal.length) {
        await insertBomCostBulkEnriched(pool, tx, pq, sid, bomCostRowsFinal)
      }

      const upOk = new sql.Request(tx)
      upOk.input('pq', sql.NVarChar(300), pq)
      upOk.input('sid', sql.NVarChar(100), sid)
      await upOk.query(`UPDATE ${BOM_COST_FROM} SET isok = 1 WHERE pq = @pq AND sid = @sid AND isok = 0`)

      await tx.commit()
    } catch (innerErr) {
      try {
        await tx.rollback()
      } catch {
        // ignore
      }
      console.error('POST /api/bom/usage-calc 事务失败：', innerErr)
      res.status(500).json({ success: false, msg: 'bom_cost写入失败', total: 0 })
      return
    }

    const selBc = await pool
      .request()
      .input('pq', sql.NVarChar(300), pq)
      .input('sid', sql.NVarChar(100), sid)
      .query(`
        SELECT id, pq, sid, kcaa01, kcaa02, kcaa03, kcaa04, kcac04, kcac05, kcac06, kcac07, kcac08, [Describe], isok
        FROM ${BOM_COST_FROM}
        WHERE pq = @pq AND sid = @sid
        ORDER BY ${buildBomCostReadOrderBy(pq)}
      `)

    const bomCost = (selBc.recordset ?? []).map(mapBomCostRecordToDto)

    const txMs = Date.now() - tTx0
    const totalMs = Date.now() - tCalc0
    console.log(
      '[bom-usage-calc]',
      JSON.stringify({
        systemcode,
        flatRows: flatCostUsageRaw.length,
        bomCostFlatRows: flatCostUsageRaw.length,
        bomCostRows: bomCost.length,
        treeMs,
        flatMs,
        enrichMs,
        txMs,
        totalMs,
      }),
    )

    res.json({
      success: true,
      total: bomCost.length,
      data,
      flatCostUsageRaw,
      bomCost,
    })
  } catch (err) {
    if (err?.code === 'BOM_CYCLE') {
      res.status(409).json({ success: false, msg: String(err.message ?? '检测到BOM循环引用'), total: 0 })
      return
    }
    console.error('POST /api/bom/usage-calc 失败：', err)
    res.status(500).json({ success: false, msg: 'bom_cost写入失败', total: 0 })
  }
})

/**
 * BOM 主页批量运算：只处理前端传入的当前页 systemcode；已运算或不需要运算的行跳过。
 */
app.post('/api/bom/usage-calc-batch', async (req, res) => {
  try {
    const rawSystemcodes = Array.isArray(req.body?.systemcodes) ? req.body.systemcodes : []
    const systemcodes = []
    const seen = new Set()
    for (const raw of rawSystemcodes) {
      const sc = String(raw ?? '').trim()
      if (!sc || seen.has(sc)) continue
      seen.add(sc)
      systemcodes.push(sc)
    }
    if (!systemcodes.length) {
      res.status(400).json({ code: 400, msg: '参数错误：systemcodes 不能为空', data: null })
      return
    }
    if (systemcodes.length > 100) {
      res.status(400).json({ code: 400, msg: '批量运算数量过多（最多 100 条）', data: null })
      return
    }

    const hidePrefixes = normalizeBomCostHidePrefixesServer(
      Array.isArray(req.body?.hidePrefixes) ? req.body.hidePrefixes : [],
    )
    const actor = getActorAuditTripletFromReq(req)
    const pool = await getPool()
    const success = []
    const skipped = []
    const failed = []

    for (const systemcode of systemcodes) {
      try {
        const head = await fetchBomUsageCalcEligibility(pool, systemcode)
        if (!head) {
          skipped.push({ systemcode, reason: '未找到在册 BOM 主档或主档缺少 systemcode' })
          continue
        }
        if (!head.isNeedCalc) {
          skipped.push({ systemcode, code: head.code, reason: '不需要运算' })
          continue
        }
        if (head.hasBomCostCached) {
          skipped.push({ systemcode, code: head.code, reason: '已运算，跳过' })
          continue
        }
        const calc = await runBomUsageCalcForHead(pool, head, hidePrefixes, actor)
        console.log('[bom-usage-calc-batch:item]', JSON.stringify(calc.metrics))
        success.push({ systemcode, code: head.code, total: calc.total })
      } catch (err) {
        failed.push({
          systemcode,
          msg: String(err?.message ?? '运算失败'),
        })
      }
    }

    res.json({
      code: 200,
      msg: 'success',
      data: {
        successCount: success.length,
        skipped,
        failed,
        success,
      },
    })
  } catch (err) {
    console.error('POST /api/bom/usage-calc-batch 失败：', err)
    const detail = String(err?.message ?? err?.originalError?.message ?? '批量运算失败')
    res.status(500).json({ code: 500, msg: `批量运算失败：${detail}`, data: null })
  }
})

/**
 * BOM 用量表：GET /api/bom/tree?systemcode=xxx
 * - 若 bom_cost 已有 pq+sid 缓存：hasCache=true，直接返回 bom_cost，不递归 Bom_parts、不平铺 flatCostUsageRaw
 * - 否则：hasCache=false，递归树 data + flatCostUsageRaw（前端本地筛选合并预览；首次落库用 POST /api/bom/usage-calc）
 */
app.get('/api/bom/tree', async (req, res) => {
  try {
    const systemcode = String(req.query?.systemcode ?? '').trim()
    const emptyPayload = {
      success: false,
      msg: '',
      data: null,
      hasCache: false,
      bom_cost: [],
      flatCostUsageRaw: [],
    }
    if (!systemcode) {
      res.status(400).json({ ...emptyPayload, success: false, msg: '参数错误：systemcode 不能为空', data: null })
      return
    }
    const pool = await getPool()
    const head = await fetchBomUsageHeadBySystemcode(pool, systemcode)
    if (!head) {
      res
        .status(404)
        .json({ ...emptyPayload, success: false, msg: '未找到对应主档或主档缺少 systemcode', data: null })
      return
    }
    const { pq, sid } = head

    const cntRs = await pool
      .request()
      .input('pq', sql.NVarChar(300), pq)
      .input('sid', sql.NVarChar(100), sid)
      .query(`SELECT COUNT_BIG(*) AS c FROM ${BOM_COST_FROM} WHERE pq = @pq AND sid = @sid`)
    const cacheCount = Number(cntRs.recordset?.[0]?.c ?? 0)

    if (cacheCount > 0) {
      const selBc = await pool
        .request()
        .input('pq', sql.NVarChar(300), pq)
        .input('sid', sql.NVarChar(100), sid)
        .query(`
          SELECT id, pq, sid, kcaa01, kcaa02, kcaa03, kcaa04, kcac04, kcac05, kcac06, kcac07, kcac08, [Describe], isok
          FROM ${BOM_COST_FROM}
          WHERE pq = @pq AND sid = @sid
          ORDER BY ${buildBomCostReadOrderBy(pq)}
        `)
      const bomCost = (selBc.recordset ?? []).map(mapBomCostRecordToDto)

      res.json({
        success: true,
        hasCache: true,
        data: [],
        flatCostUsageRaw: [],
        bom_cost: bomCost,
      })
      return
    }

    const bomHeadStack = new Set([systemcode])
    const data = await buildBomPartsUsageTreeNodes(pool, systemcode, 1, bomHeadStack)
    const flatCostUsageRaw = flattenBomPartsCostUsageFlatForBomCost(data, null, [])
    res.json({
      success: true,
      hasCache: false,
      data,
      flatCostUsageRaw,
      bom_cost: [],
    })
  } catch (err) {
    if (err?.code === 'BOM_CYCLE') {
      res.status(409).json({
        success: false,
        msg: String(err.message ?? '检测到BOM循环引用'),
        data: null,
        hasCache: false,
        bom_cost: [],
        flatCostUsageRaw: [],
      })
      return
    }
    console.error('GET /api/bom/tree 失败：', err)
    const detail = String(err?.message ?? err?.originalError?.message ?? '数据库查询失败')
    res.status(500).json({
      success: false,
      msg: `读取 BOM 树失败：${detail}`,
      data: null,
      hasCache: false,
      bom_cost: [],
      flatCostUsageRaw: [],
    })
  }
})

/**
 * BOM 配件明细列表（Tab 配件明细）
 * GET /api/inventory/bom/parts/:systemcode — :systemcode 为主档 systemcode（URL 编码）
 * - 单次往返：EXISTS 与旧版「先 TOP 1 主档」等价（无主档则 0 行 → 空列表）；含 del=1 等配件行
 * - bom_000 展示列：原逐行 OUTER APPLY 改为「本单 distinct kcaa01 + ROW_NUMBER」再 LEFT JOIN，语义同 TOP 1 ORDER BY id DESC
 */
app.get('/api/inventory/bom/parts/:systemcode', async (req, res) => {
  try {
    let systemcode = ''
    try {
      systemcode = decodeURIComponent(String(req.params?.systemcode ?? '').trim())
    } catch {
      systemcode = String(req.params?.systemcode ?? '').trim()
    }
    if (!systemcode) {
      res.status(400).json({ code: 400, msg: '参数错误：systemcode 不能为空', data: null })
      return
    }

    const pool = await getPool()
    const r = await pool
      .request()
      .input('sc', sql.NVarChar(100), systemcode)
      .query(`
      WITH part_keys AS (
        SELECT DISTINCT LTRIM(RTRIM(CONVERT(nvarchar(300), ISNULL(p0.kcaa01, N'')))) AS kcaa01_key
        FROM ${INV_BOM_PARTS_FROM} AS p0
        WHERE LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(p0.kcac01, N'')))) = @sc
      ),
      bh_ranked AS (
        SELECT
          LTRIM(RTRIM(CONVERT(nvarchar(300), ISNULL(b.kcaa01, N'')))) AS kcaa01_key,
          LTRIM(RTRIM(CONVERT(nvarchar(300), ISNULL(b.kcaa01, N'')))) AS j01,
          LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(b.kcaa02, N'')))) AS j02,
          LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(b.kcaa03, N'')))) AS j03,
          LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(b.kcaa11, N'')))) AS j11,
          LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(b.systemcode, N'')))) AS child_systemcode,
          LTRIM(RTRIM(ISNULL(CONVERT(nvarchar(10), b.pass), N''))) AS child_pass,
          ROW_NUMBER() OVER (
            PARTITION BY LTRIM(RTRIM(CONVERT(nvarchar(300), ISNULL(b.kcaa01, N''))))
            ORDER BY b.id DESC
          ) AS rn
        FROM ${INV_BOM_MASTER_FROM} AS b
        INNER JOIN part_keys AS pk
          ON LTRIM(RTRIM(CONVERT(nvarchar(300), ISNULL(b.kcaa01, N'')))) = pk.kcaa01_key
        WHERE (ISNULL(b.del, N'') = N'' OR LTRIM(RTRIM(ISNULL(CONVERT(nvarchar(20), b.del), N''))) = N'0')
      ),
      bh AS (
        SELECT kcaa01_key, j01, j02, j03, j11, child_systemcode, child_pass
        FROM bh_ranked
        WHERE rn = 1
      )
      SELECT
        p.id,
        LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(p.kcac01, N'')))) AS kcac01,
        LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(p.kcac02, N'')))) AS kcac02,
        CASE
          WHEN bh.j01 IS NOT NULL AND LTRIM(RTRIM(bh.j01)) <> N'' THEN bh.j01
          ELSE LTRIM(RTRIM(CONVERT(nvarchar(300), ISNULL(p.kcaa01, N''))))
        END AS kcaa01,
        CASE
          WHEN bh.j02 IS NOT NULL AND LTRIM(RTRIM(bh.j02)) <> N'' THEN bh.j02
          ELSE LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(p.kcaa02, N''))))
        END AS kcaa02,
        CASE
          WHEN bh.j03 IS NOT NULL AND LTRIM(RTRIM(bh.j03)) <> N'' THEN bh.j03
          ELSE LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(p.kcaa03, N''))))
        END AS kcaa03,
        LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(p.kcaa04, N'')))) AS kcaa04,
        CASE
          WHEN bh.j11 IS NOT NULL AND LTRIM(RTRIM(bh.j11)) <> N'' THEN bh.j11
          ELSE LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(p.kcaa11, N''))))
        END AS kcaa11,
        ${bomPartsNumericColAsDecimalSql('p.kcac04')} AS kcac04,
        ${bomPartsNumericColAsDecimalSql('p.kcac05')} AS kcac05,
        ${bomPartsNumericColAsDecimalSql('p.kcac06')} AS kcac06,
        ${bomPartsNumericColAsDecimalSql('p.cost_price')} AS cost_price,
        LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(p.remark, N'')))) AS remark,
        p.[Seq] AS seq,
        LTRIM(RTRIM(ISNULL(CONVERT(nvarchar(10), p.del), N''))) AS del,
        LTRIM(RTRIM(ISNULL(bh.child_systemcode, N''))) AS child_systemcode,
        LTRIM(RTRIM(ISNULL(bh.child_pass, N''))) AS child_pass
      FROM ${INV_BOM_PARTS_FROM} AS p
      LEFT OUTER JOIN bh
        ON LTRIM(RTRIM(CONVERT(nvarchar(300), ISNULL(p.kcaa01, N'')))) = bh.kcaa01_key
      WHERE LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(p.kcac01, N'')))) = @sc
        AND EXISTS (
          SELECT 1
          FROM ${INV_BOM_MASTER_FROM} AS h
          WHERE LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(h.systemcode, N'')))) = @sc
            AND (ISNULL(h.del, N'') = N'' OR h.del = N'0')
        )
      ORDER BY CASE WHEN p.[Seq] IS NULL THEN 1 ELSE 0 END, p.[Seq], p.id
    `)

    const list = (r.recordset ?? []).map((row) => ({
      id: row.id != null ? Number(row.id) : null,
      kcac01: row.kcac01 != null ? String(row.kcac01) : '',
      kcac02: row.kcac02 != null ? String(row.kcac02) : '',
      /** 子件编码对应 bom_000.systemcode，供配件「查看」钻取免二次查主档 */
      childSystemcode:
        row.child_systemcode != null ? String(row.child_systemcode).trim() : '',
      childPass: row.child_pass != null ? String(row.child_pass) : '',
      kcaa01: row.kcaa01 != null ? String(row.kcaa01) : '',
      kcaa02: row.kcaa02 != null ? String(row.kcaa02) : '',
      kcaa03: row.kcaa03 != null ? String(row.kcaa03) : '',
      kcaa04: row.kcaa04 != null ? String(row.kcaa04) : '',
      kcaa11: row.kcaa11 != null ? String(row.kcaa11) : '',
      kcac04: Number(row.kcac04 ?? 0),
      kcac05: Number(row.kcac05 ?? 0),
      kcac06: Number(row.kcac06 ?? 0),
      cost_price: Number(row.cost_price ?? 0),
      remark: row.remark != null ? String(row.remark) : '',
      seq:
        row.seq != null && row.seq !== '' && Number.isFinite(Number(row.seq)) ? Number(row.seq) : null,
      del: row.del != null ? String(row.del) : '0',
    }))

    res.json({ code: 200, msg: 'success', data: { list } })
  } catch (err) {
    console.error('GET /api/inventory/bom/parts/:systemcode 失败：', err)
    const detail = String(err?.message ?? err?.originalError?.message ?? '数据库查询失败')
    res.status(500).json({ code: 500, msg: `读取 BOM 配件明细失败：${detail}`, data: null })
  }
})

/**
 * BOM 配件明细批量保存：物理删除待删行 + 更新 + 新增
 * PUT /api/inventory/bom/parts/:systemcode
 * POST /api/inventory/bom/save-parts（body.systemcode + 与 PUT 相同 lines）
 * body: { lines: [{ id?, pendingDelete?, kcac01?, kcaa01, kcaa02, kcaa03, kcaa04, kcaa11, kcac04, kcac05, kcac06?, cost_price, remark, seq }] }
 * 保存逻辑：`UPDATE` 双重锁定 `id` + `kcac01`；`kcaa01`～`kcaa35`/`kcac02` 由 `bom_000` OUTER APPLY 同步（见 bomPartsApplyFullLineUpdate）。
 */
async function handleInventoryBomPartsPut(req, res) {
  /** @type {{ systemcode: string, kcaa01: string }[]} */
  const auditPhysicalPartDeletes = []
  /** @type {{ part: string, qty: string, loss: string }[]} */
  const auditUsageUpdates = []
  /** @type {{ master: string, part: string }[]} */
  const auditKcaaSync = []
  try {
    let systemcode = ''
    try {
      systemcode = decodeURIComponent(String(req.params?.systemcode ?? '').trim())
    } catch {
      systemcode = String(req.params?.systemcode ?? '').trim()
    }
    if (!systemcode) {
      res.status(400).json({ code: 400, msg: '参数错误：systemcode 不能为空', data: null })
      return
    }

    const lines = Array.isArray(req.body?.lines) ? req.body.lines : []
    if (!lines.length) {
      res.status(400).json({ code: 400, msg: 'body.lines 不能为空', data: null })
      return
    }

    const pool = await getPool()
    const check = await pool.request().input('sc', sql.NVarChar(100), systemcode).query(`
      SELECT TOP 1
        LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(b.systemcode, N'')))) AS systemcode,
        LTRIM(RTRIM(CONVERT(nvarchar(300), ISNULL(b.kcaa01, N'')))) AS kcaa01
      FROM ${INV_BOM_MASTER_FROM} AS b
      WHERE LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(b.systemcode, N'')))) = @sc
        AND (ISNULL(b.del, N'') = N'' OR b.del = N'0')
    `)
    const head = check.recordset?.[0] ?? null
    if (!head || !String(head.systemcode ?? '').trim()) {
      res.status(404).json({ code: 404, msg: '未找到对应主档或主档缺少 systemcode', data: null })
      return
    }
    const bomHeadKcaa01 = String(head.kcaa01 ?? '').trim() || systemcode

    const partColset = await getInvBomPartsColumnSet(pool)
    const delColKind = await getInvBomPartsDelColumnKind(pool)

    const tx = new sql.Transaction(pool)
    await tx.begin()
    try {
      let deleted = 0
      let updated = 0
      let inserted = 0
      const submittedPartCodes = []

      /** 先处理 pendingDelete，再更新/新增，避免「未删完就 INSERT」产生重复在册行 */
      const orderedLines = [...lines].sort((a, b) => {
        const pa = !!a?.pendingDelete
        const pb = !!b?.pendingDelete
        if (pa === pb) return 0
        return pa ? -1 : 1
      })

      for (const raw of orderedLines) {
        const pendingDelete = !!raw?.pendingDelete
        const hasId = bomPartLineHasDbId(raw)

        /** 前端传 kcac01 时须与 URL 主档一致，防止误改其它成品下的同名配件行 */
        if (!pendingDelete) {
          const lineMaster = String(raw?.kcac01 ?? '').trim()
          if (lineMaster && lineMaster !== systemcode) {
            throw new Error(
              `明细行的 kcac01（所属主档）须与当前主档 systemcode 一致；收到「${lineMaster}」，期望「${systemcode}」`,
            )
          }
        }

        if (hasId && pendingDelete) {
          const qPre = new sql.Request(tx)
          bomPartsSqlBindId(qPre, raw?.id)
          qPre.input('kcac01', sql.NVarChar(100), systemcode)
          const preRs = await qPre.query(`
            SELECT TOP 1
              LTRIM(RTRIM(CONVERT(nvarchar(300), ISNULL(p.kcaa01, N'')))) AS kcaa01
            FROM ${INV_BOM_PARTS_FROM} AS p
            WHERE p.id = @id
              AND LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(p.kcac01, N'')))) =
                  LTRIM(RTRIM(CONVERT(nvarchar(100), @kcac01)))
          `)
          const partCode = String(preRs.recordset?.[0]?.kcaa01 ?? '').trim()
          if (!partCode) {
            console.warn(
              `[BOM配件明细] 物理删跳过：未找到 id=${String(raw?.id ?? '')} 且 kcac01 匹配主档 systemcode=${systemcode} 的行`,
            )
            continue
          }
          const q = new sql.Request(tx)
          bomPartsSqlBindId(q, raw?.id)
          q.input('kcac01', sql.NVarChar(100), systemcode)
          q.input('kcaa01Del', sql.NVarChar(300), partCode)
          const ur = await q.query(`
            DELETE p
            FROM ${INV_BOM_PARTS_FROM} AS p
            WHERE LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(p.kcac01, N'')))) =
                  LTRIM(RTRIM(CONVERT(nvarchar(100), @kcac01)))
              AND LTRIM(RTRIM(CONVERT(nvarchar(300), ISNULL(p.kcaa01, N'')))) =
                  LTRIM(RTRIM(CONVERT(nvarchar(300), @kcaa01Del)))
              AND p.id = @id
          `)
          const aff = Number(ur.rowsAffected?.[0] ?? 0)
          deleted += aff
          if (aff > 0) {
            auditPhysicalPartDeletes.push({ systemcode, kcaa01: partCode })
          } else {
            console.warn(
              `[BOM配件明细] 物理删未命中：id=${String(raw?.id ?? '')} kcaa01=${partCode} systemcode=${systemcode}`,
            )
          }
          continue
        }

        if (hasId && !pendingDelete) {
          const kcaa01Up = String(raw?.kcaa01 ?? '').trim()
          if (!kcaa01Up) {
            throw new Error('配件明细缺少配件编码 kcaa01')
          }
          if (kcaa01Up) submittedPartCodes.push(kcaa01Up)
          const subSc = await bomPartsLookupSubBomSystemcode(tx, kcaa01Up)
          const upRes = await bomPartsApplyFullLineUpdate(tx, partColset, systemcode, raw?.id, raw)
          const affUp = upRes.rowsAffected
          updated += affUp
          if (affUp > 0) {
            auditUsageUpdates.push({
              part: kcaa01Up,
              qty: String(upRes.kcac04),
              loss: String(upRes.kcac05),
            })
            if (subSc) {
              auditKcaaSync.push({ master: systemcode, part: kcaa01Up })
            }
          }
          continue
        }

        if (!hasId && !pendingDelete) {
          const kcaa01 = String(raw?.kcaa01 ?? '').trim()
          if (!kcaa01) {
            throw new Error('新增行缺少配件编码 kcaa01')
          }
          submittedPartCodes.push(kcaa01)
          const kcac04 = bomPartRoundDecimal6(raw?.kcac04)
          const kcac05 = bomPartRoundDecimal6(raw?.kcac05)
          const kcac06Ins = bomPartRoundDecimal6(
            raw?.kcac06 !== undefined && raw?.kcac06 !== null
              ? raw.kcac06
              : bomPartComputeKcac06(kcac04, kcac05),
          )
          const costNum = bomPartParseDecimal(raw?.cost_price)
          const seqIns = bomPartParseSeq(raw?.seq)

          const existing = await bomPartsFindRowsByScAndPartCode(tx, systemcode, kcaa01)
          if (existing.length > 0) {
            const subMerge = await bomPartsLookupSubBomSystemcode(tx, kcaa01)
            const actives = existing.filter((row) => bomPartsDelLooksActive(row.del_s))
            const targetId = actives.length
              ? Math.min(...actives.map((row) => Number(row.id)))
              : Math.min(...existing.map((row) => Number(row.id)))
            const allIds = existing
              .map((row) => Number(row.id))
              .filter((n) => Number.isFinite(n) && n > 0)
            const otherIds = allIds.filter((id) => id !== targetId)

            /** 合并保留行：先恢复 del/deltime，再统一走「子 BOM 全字段同步」UPDATE */
            const setRevive = []
            if (delColKind === 'numeric') {
              setRevive.push('p.del = @delActiveNum')
            } else {
              setRevive.push(`p.del = N'0'`)
            }
            if (partColset.has('deltime')) {
              setRevive.push('p.deltime = NULL')
            }
            if (setRevive.length) {
              const qr = new sql.Request(tx)
              bomPartsSqlBindId(qr, targetId)
              qr.input('kcac01', sql.NVarChar(100), systemcode)
              if (delColKind === 'numeric') {
                qr.input('delActiveNum', sql.Int, 0)
              }
              await qr.query(`
                UPDATE p
                SET ${setRevive.join(', ')}
                FROM ${INV_BOM_PARTS_FROM} AS p
                WHERE p.id = @id
                  AND LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(p.kcac01, N'')))) =
                      LTRIM(RTRIM(CONVERT(nvarchar(100), @kcac01)))
              `)
            }

            const mergeUp = await bomPartsApplyFullLineUpdate(tx, partColset, systemcode, targetId, {
              ...raw,
              kcaa01,
              kcac04,
              kcac05,
              kcac06: kcac06Ins,
              seq: seqIns,
            })
            const affM = mergeUp.rowsAffected
            updated += affM
            if (affM > 0) {
              auditUsageUpdates.push({
                part: kcaa01,
                qty: String(kcac04),
                loss: String(kcac05),
              })
              if (subMerge) {
                auditKcaaSync.push({ master: systemcode, part: kcaa01 })
              }
            }

            for (const oid of otherIds) {
              const qd = new sql.Request(tx)
              bomPartsSqlBindId(qd, oid)
              qd.input('kcac01', sql.NVarChar(100), systemcode)
              qd.input('kcaa01Dedupe', sql.NVarChar(300), kcaa01)
              const ud = await qd.query(`
                DELETE p
                FROM ${INV_BOM_PARTS_FROM} AS p
                WHERE p.id = @id
                  AND LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(p.kcac01, N'')))) =
                      LTRIM(RTRIM(CONVERT(nvarchar(100), @kcac01)))
                  AND LTRIM(RTRIM(CONVERT(nvarchar(300), ISNULL(p.kcaa01, N'')))) =
                      LTRIM(RTRIM(CONVERT(nvarchar(300), @kcaa01Dedupe)))
              `)
              const daff = Number(ud.rowsAffected?.[0] ?? 0)
              deleted += daff
              if (daff > 0) {
                auditPhysicalPartDeletes.push({ systemcode, kcaa01: kcaa01 })
              }
            }
            continue
          }

          const subIns = await bomPartsLookupSubBomSystemcode(tx, kcaa01)
          const q = new sql.Request(tx)
          q.input('kcac01', sql.NVarChar(100), systemcode)
          q.input('kcaa01', sql.NVarChar(300), kcaa01)
          q.input('kcaa02', sql.NVarChar(500), raw?.kcaa02 != null ? String(raw.kcaa02) : '')
          q.input('kcaa03', sql.NVarChar(500), raw?.kcaa03 != null ? String(raw.kcaa03) : '')
          q.input('kcaa04', sql.NVarChar(100), raw?.kcaa04 != null ? String(raw.kcaa04) : '')
          q.input('kcaa11', sql.NVarChar(200), raw?.kcaa11 != null ? String(raw.kcaa11) : '')
          q.input('kcac04', sql.Decimal(18, 6), kcac04)
          q.input('kcac05', sql.Decimal(18, 6), kcac05)
          q.input('cost_price', sql.Decimal(18, 4), costNum)
          q.input('remark', sql.NVarChar(500), raw?.remark != null ? String(raw.remark) : '')
          q.input('seq', sql.Int, seqIns)
          const delValSql = delColKind === 'numeric' ? '@delIns' : `N'0'`
          if (delColKind === 'numeric') {
            q.input('delIns', sql.Int, 0)
          }
          let insCols =
            'kcac01, kcaa01, kcaa02, kcaa03, kcaa04, kcaa11, kcac04, kcac05, cost_price, remark, del, [Seq]'
          let insVals = `@kcac01, @kcaa01, @kcaa02, @kcaa03, @kcaa04, @kcaa11, @kcac04, @kcac05, @cost_price, @remark, ${delValSql}, @seq`
          if (partColset.has('kcac06')) {
            q.input('kcac06', sql.Decimal(18, 6), kcac06Ins)
            insCols =
              'kcac01, kcaa01, kcaa02, kcaa03, kcaa04, kcaa11, kcac04, kcac05, kcac06, cost_price, remark, del, [Seq]'
            insVals = `@kcac01, @kcaa01, @kcaa02, @kcaa03, @kcaa04, @kcaa11, @kcac04, @kcac05, @kcac06, @cost_price, @remark, ${delValSql}, @seq`
          }
          if (partColset.has('kcac02')) {
            q.input('kcac02Ins', sql.NVarChar(100), subIns || '')
            insCols = partColset.has('kcac06')
              ? 'kcac01, kcac02, kcaa01, kcaa02, kcaa03, kcaa04, kcaa11, kcac04, kcac05, kcac06, cost_price, remark, del, [Seq]'
              : 'kcac01, kcac02, kcaa01, kcaa02, kcaa03, kcaa04, kcaa11, kcac04, kcac05, cost_price, remark, del, [Seq]'
            insVals = partColset.has('kcac06')
              ? `@kcac01, @kcac02Ins, @kcaa01, @kcaa02, @kcaa03, @kcaa04, @kcaa11, @kcac04, @kcac05, @kcac06, @cost_price, @remark, ${delValSql}, @seq`
              : `@kcac01, @kcac02Ins, @kcaa01, @kcaa02, @kcaa03, @kcaa04, @kcaa11, @kcac04, @kcac05, @cost_price, @remark, ${delValSql}, @seq`
          }
          const ir = await q.query(`
            INSERT INTO ${INV_BOM_PARTS_FROM} (${insCols})
            OUTPUT INSERTED.id AS inserted_id
            VALUES (${insVals})
          `)
          const newId = Number(ir.recordset?.[0]?.inserted_id)
          if (!Number.isFinite(newId) || newId < 1) {
            throw new Error('新增配件明细失败：未取得有效的 INSERTED.id')
          }
          /** 插入后再 UPDATE：与编辑行一致，按 bom_000 同步 kcaa01～35 及 kcac02 */
          const insUp = await bomPartsApplyFullLineUpdate(tx, partColset, systemcode, newId, {
            ...raw,
            kcaa01,
            kcac04,
            kcac05,
            kcac06: kcac06Ins,
            seq: seqIns,
          })
          inserted += 1
          if (insUp.rowsAffected > 0 && subIns) {
            auditKcaaSync.push({ master: systemcode, part: kcaa01 })
          }
        }
      }

      await bomPartsAssertSubmittedCodesPersisted(tx, systemcode, submittedPartCodes)
      const cacheInvalidated = await invalidateBomCostCacheForPartsChange(tx, systemcode)
      if (cacheInvalidated.deleted > 0 || cacheInvalidated.unaudited > 0) {
        console.log(
          '[bom-current-cost-stale]',
          JSON.stringify({
            systemcode,
            affected: cacheInvalidated.affected,
            unaudited: cacheInvalidated.unaudited,
            deleted: cacheInvalidated.deleted,
          }),
        )
      }

      await tx.commit()

      for (const row of auditPhysicalPartDeletes) {
        try {
          await writeLog(
            req,
            '彻底删除BOM配件',
            `[彻底删除]了BOM配件，BOM系统编码：[${row.systemcode}]，移除配件编码：[${row.kcaa01}]`,
            { targetTable: 'Bom_parts' },
          )
        } catch (logErr) {
          console.warn('[BOM配件明细] 审计日志写入失败（不影响保存）：', logErr?.message ?? logErr)
        }
      }

      for (const u of auditUsageUpdates) {
        try {
          await writeLog(
            req,
            '更新BOM配件用量',
            `[更新]了配件用量，BOM：[${bomHeadKcaa01}]，配件：[${u.part}]，用量：[${u.qty}]，损耗：[${u.loss}]`,
            { targetTable: 'Bom_parts' },
          )
        } catch (logErr) {
          console.warn('[BOM配件明细] 用量审计写入失败（不影响保存）：', logErr?.message ?? logErr)
        }
      }

      for (const s of auditKcaaSync) {
        try {
          await writeLog(
            req,
            '同步BOM配件属性',
            `[同步]了BOM配件属性，主BOM：[${s.master}]，配件：[${s.part}]，已同步kcaa01-kcaa35共35个字段。`,
            { targetTable: 'Bom_parts' },
          )
        } catch (logErr) {
          console.warn('[BOM配件明细] 同步属性审计写入失败（不影响保存）：', logErr?.message ?? logErr)
        }
      }

      res.json({
        code: 200,
        msg: 'success',
        data: {
          deleted,
          updated,
          inserted,
          bomCostCacheDeleted: cacheInvalidated.deleted,
          bomImpactAffected: cacheInvalidated.affected,
          bomUnaudited: cacheInvalidated.unaudited,
          /** @deprecated 兼容旧前端；数值同 deleted */
          softDeleted: deleted,
        },
      })
    } catch (innerErr) {
      try {
        await tx.rollback()
      } catch {
        // ignore
      }
      throw innerErr
    }
  } catch (err) {
    console.error('PUT /api/inventory/bom/parts/:systemcode 失败：', err)
    const detail = String(err?.message ?? err?.originalError?.message ?? '数据库更新失败')
    res.status(500).json({ code: 500, msg: `保存 BOM 配件明细失败：${detail}`, data: null })
  }
}

app.put('/api/inventory/bom/parts/:systemcode', handleInventoryBomPartsPut)

/** 与 PUT /parts/:systemcode 相同 body；systemcode 放在 body.systemcode */
app.post('/api/inventory/bom/save-parts', async (req, res) => {
  const sc = String(req.body?.systemcode ?? '').trim()
  if (!sc) {
    res.status(400).json({ code: 400, msg: 'body.systemcode 不能为空', data: null })
    return
  }
  req.params = { ...req.params, systemcode: sc }
  return handleInventoryBomPartsPut(req, res)
})

/** BOM 主档一键更新：按物料编码将 bom_000 基础资料写回全库 Bom_parts / bom_cost 引用（不改用量、不重算） */
app.post('/api/inventory/bom/propagate-master', (req, res) =>
  handlePostBomMasterPropagate(req, res, { getPool, writeLog }),
)


/**
 * BOM 编码校验 / 版本提示：查询同编码在册行（编辑时可排除自身 systemcode）
 * GET /api/inventory/bom/check-code?kcaa01=&excludeSystemcode=
 */
app.get('/api/inventory/bom/check-code', async (req, res) => {
  try {
    const kcaa01 = String(req.query?.kcaa01 ?? '').trim()
    if (!kcaa01) {
      res.status(400).json({ code: 400, msg: '参数 kcaa01 不能为空', data: null })
      return
    }
    const exclude = String(req.query?.excludeSystemcode ?? '').trim()
    const pool = await getPool()
    const reqQ = pool.request().input('kcaa01', sql.NVarChar(300), kcaa01)
    let exSql = ''
    if (exclude) {
      reqQ.input('exsc', sql.NVarChar(100), exclude)
      exSql = ` AND LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(b.systemcode, N'')))) <> @exsc `
    }
    const listRs = await reqQ.query(`
      SELECT TOP 10
        LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(b.systemcode, N'')))) AS systemcode,
        LTRIM(RTRIM(ISNULL(CONVERT(nvarchar(40), b.[version]), N''))) AS version,
        LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(b.kcaa02, N'')))) AS kcaa02,
        LTRIM(RTRIM(ISNULL(CONVERT(nvarchar(10), b.pass), N''))) AS pass
      FROM ${INV_BOM_MASTER_FROM} AS b
      WHERE LTRIM(RTRIM(CONVERT(nvarchar(300), ISNULL(b.kcaa01, N'')))) = @kcaa01
        AND (ISNULL(b.del, N'') = N'' OR LTRIM(RTRIM(ISNULL(CONVERT(nvarchar(20), b.del), N''))) = N'0')
        ${exSql}
      ORDER BY b.id DESC
    `)
    const rows = (listRs.recordset ?? []).map((row) => ({
      systemcode: row.systemcode != null ? String(row.systemcode) : '',
      version: row.version != null ? String(row.version) : '',
      kcaa02: row.kcaa02 != null ? String(row.kcaa02) : '',
      pass: row.pass != null ? String(row.pass) : '',
    }))
    const dup = await countInvBomDuplicateKcaa01(pool, kcaa01, exclude)
    res.json({
      code: 200,
      msg: 'success',
      data: { duplicate: dup > 0, count: dup, rows },
    })
  } catch (err) {
    console.error('GET /api/inventory/bom/check-code 失败：', err)
    const detail = String(err?.message ?? err?.originalError?.message ?? '查询失败')
    res.status(500).json({ code: 500, msg: detail, data: null })
  }
})

/**
 * 单位换算建议（使用单位 + 采购/报价侧单位）
 * GET /api/inventory/bom/unit-rate-suggest?useUnit=&otherUnit=
 */
app.get('/api/inventory/bom/unit-rate-suggest', async (req, res) => {
  try {
    const useUnit = String(req.query?.useUnit ?? '').trim()
    const otherUnit = String(req.query?.otherUnit ?? '').trim()
    if (!useUnit || !otherUnit) {
      res.status(400).json({ code: 400, msg: 'useUnit、otherUnit 均不能为空', data: null })
      return
    }
    const pool = await getPool()
    const { direction, rate } = await lookupBomUnitChangeDirectionRate(pool, useUnit, otherUnit)
    res.json({
      code: 200,
      msg: 'success',
      data: {
        /** 0：对方→使用；1：使用→对方（与主档 kcaa27/kcaa31 一致） */
        direction,
        rate,
      },
    })
  } catch (err) {
    console.error('GET /api/inventory/bom/unit-rate-suggest 失败：', err)
    const detail = String(err?.message ?? err?.originalError?.message ?? '查询失败')
    res.status(500).json({ code: 500, msg: detail, data: null })
  }
})

/**
 * BOM 币别下拉：读 bom_currency.cn_name（表名见 INV_BOM_CURRENCY_TABLE）
 * GET /api/inventory/bom/currency-options
 */
app.get('/api/inventory/bom/currency-options', async (req, res) => {
  try {
    const pool = await getPool()
    const rs = await pool.request().query(`
      SELECT DISTINCT LTRIM(RTRIM(ISNULL([cn_name], N''))) AS cn_name
      FROM ${INV_BOM_CURRENCY_FROM}
      WHERE LTRIM(RTRIM(ISNULL([cn_name], N''))) <> N''
      ORDER BY cn_name
    `)
    const rows = (rs.recordset ?? []).map((r) => ({
      cn_name: String(r.cn_name ?? '').trim(),
    }))
    res.json({ code: 200, msg: 'success', data: { rows } })
  } catch (err) {
    console.error('GET /api/inventory/bom/currency-options 失败：', err)
    const detail = String(err?.message ?? err?.originalError?.message ?? '查询失败')
    res.status(500).json({ code: 500, msg: detail, data: { rows: [] } })
  }
})

/**
 * BOM 主档新增：INSERT bom_000（SQL Server 2008 R2 兼容写法）。
 * save-main：字段列表须含 systemcode、[GUID]、dr_systemcode，VALUES 三连同为最终 systemcode；[version] 固定 N'100'。
 * 逻辑位于 server/index.js（本项目无 server/controllers）。
 * systemcode 可由客户端传入（须库内不存在）；否则服务端生成并重试避免冲突。
 * POST /api/inventory/bom/save-main — 标准入口；POST /api/inventory/bom — 兼容旧调用。
 */
async function handleInvBomMasterSaveMain(req, res) {
  try {
    const body = req.body ?? {}
    const kcaa01 = String(body.kcaa01 ?? '').trim()
    const kcaa02 = String(body.kcaa02 ?? '').trim()
    const kcaa05 = String(body.kcaa05 ?? '').trim()
    const kcaa04 = String(body.kcaa04 ?? '').trim()
    const kcaa25 = String(body.kcaa25 ?? '').trim()
    if (!kcaa01 || !kcaa02) {
      res.status(400).json({ code: 400, msg: '编码与名称不能为空', data: null })
      return
    }
    if (!kcaa05 || !kcaa04 || !kcaa25) {
      res.status(400).json({ code: 400, msg: '分类、使用单位、采购单位不能为空', data: null })
      return
    }
    if (/\s/.test(kcaa01)) {
      res.status(400).json({ code: 400, msg: '编码不能包含空格', data: null })
      return
    }

    const pool = await getPool()
    if ((await countInvBomDuplicateKcaa01(pool, kcaa01, '')) > 0) {
      res.status(400).json({ code: 400, msg: `编码「${kcaa01}」已存在，请勿重复新增`, data: null })
      return
    }

    // 刷新 bom_000 列缓存，避免库内新加列后仍按旧清单 INSERT
    INV_BOM_MASTER_COLSET_PROMISE = null
    const colset = await getInvBomMasterColumnSet(pool)
    const actor = await resolveActorAuditTripletFromReq(pool, req)

    /** save-main 三连键 + 版本列缺一不可（列名按 INFORMATION_SCHEMA 转小写匹配：guid ↔ 物理列 GUID） */
    const saveMainRequired = ['systemcode', 'guid', 'dr_systemcode', 'version']
    const saveMainMissing = saveMainRequired.filter((c) => !colset.has(c))
    if (saveMainMissing.length) {
      res.status(500).json({
        code: 500,
        msg: `bom_000 缺少 save-main 必需列（${saveMainMissing.join(', ')}），无法写入三连键与版本`,
        data: null,
      })
      return
    }

    /** @type {string} */
    let systemcode = String(body.systemcode ?? '').trim()
    if (systemcode) {
      if (await invBomMasterSystemcodeExists(pool, systemcode)) {
        res.status(400).json({ code: 400, msg: 'systemcode 已存在，无法保存', data: null })
        return
      }
    } else {
      let resolved = false
      for (let i = 0; i < 12; i++) {
        const cand = generateInvBomSystemcode(actor.uidInt ?? actor.uname ?? '')
        if (!(await invBomMasterSystemcodeExists(pool, cand))) {
          systemcode = cand
          resolved = true
          break
        }
      }
      if (!resolved || !systemcode) {
        res.status(400).json({ code: 400, msg: 'systemcode 已存在或生成冲突，请稍后重试', data: null })
        return
      }
    }

    const nowStr = formatBomColorcodeTimestamp()

    const str = (k, max = 800) => {
      let s = String(body[k] ?? '').trim()
      if (s.length > max) s = s.slice(0, max)
      return s
    }
    const decNum = (k) => {
      const raw = body[k]
      if (raw === '' || raw === null || raw === undefined) return null
      const n = Number(raw)
      return Number.isFinite(n) ? n : null
    }
    const bitInt = (k) => {
      const v = body[k]
      if (v === true || v === 1 || v === '1') return 1
      return 0
    }
    const dirInt = (k) => {
      const n = Number(body[k])
      if (n === 0 || n === 1) return n
      return 0
    }

    /** @type {string[]} */
    const cols = []
    /** @type {string[]} */
    const vals = []
    const ins = pool.request()

    const pushNvarchar = (col, param, val, len) => {
      if (!colset.has(col.toLowerCase())) return
      cols.push(col === 'decimal' ? '[decimal]' : col)
      vals.push(`@${param}`)
      ins.input(param, sql.NVarChar(len), val ?? '')
    }

    // 三连赋值：同一参数绑定三次，保证 systemcode、GUID、dr_systemcode 绝对一致（2008 R2 兼容）
    ins.input('bom_sc_triple', sql.NVarChar(100), systemcode)
    cols.push('systemcode', '[GUID]', 'dr_systemcode')
    vals.push('@bom_sc_triple', '@bom_sc_triple', '@bom_sc_triple')
    // version：库内多为 int；用数值绑定，避免与 int 列隐式转换歧义
    ins.input('bom_version_ins', sql.Int, 100)
    cols.push('[version]')
    vals.push('@bom_version_ins')
    // 新增主档默认类型：bom_000.type = 1（列存在时写入；保留字列名须加方括号）
    if (colset.has('type')) {
      ins.input('bom_type_default', sql.Int, 1)
      cols.push('[type]')
      vals.push('@bom_type_default')
    }
    pushNvarchar('kcaa01', 'kcaa01', kcaa01, 300)
    pushNvarchar('kcaa02', 'kcaa02', kcaa02, 500)
    pushNvarchar('kcaa02_en', 'kcaa02_en', str('kcaa02_en', 500), 500)
    pushNvarchar('kpname', 'kpname', str('kpname', 500), 500)
    pushNvarchar('kcaa03', 'kcaa03', str('kcaa03', 500), 500)
    pushNvarchar('kcaa05', 'kcaa05', str('kcaa05', 200), 200)
    pushNvarchar('kcaa06', 'kcaa06', str('kcaa06', 300), 300)
    pushNvarchar('kcaa09', 'kcaa09', str('kcaa09', 300), 300)
    pushNvarchar('kcaa10', 'kcaa10', str('kcaa10', 200), 200)
    pushNvarchar('kcaa11', 'kcaa11', str('kcaa11', 200), 200)
    pushNvarchar('location', 'location', str('location', 200) || '国内', 200)
    pushNvarchar('kcaa04', 'kcaa04', str('kcaa04', 100), 100)
    pushNvarchar('kcaa25', 'kcaa25', str('kcaa25', 100), 100)
    pushNvarchar('kcaa29', 'kcaa29', str('kcaa29', 100), 100)
    pushNvarchar('kcaa34', 'kcaa34', str('kcaa34', 80), 80)
    pushNvarchar('kcaa35', 'kcaa35', str('kcaa35', 80), 80)
    pushNvarchar('remark', 'remark', str('remark', 2000), 2000)
    pushNvarchar('Customer_Name', 'Customer_Name', str('Customer_Name', 500), 500)
    pushNvarchar('decimal', 'bom_decimal', str('decimal', 20) || '2', 20)

    if (colset.has('kcaa15')) {
      cols.push('kcaa15')
      vals.push('@kcaa15')
      ins.input('kcaa15', sql.NVarChar(50), str('kcaa15', 50))
    }

    const pushInt = (col, param, v) => {
      if (!colset.has(col.toLowerCase())) return
      cols.push(col)
      vals.push(`@${param}`)
      ins.input(param, sql.Int, v)
    }
    pushInt('kcaa12', 'kcaa12', bitInt('kcaa12'))
    pushInt('kcaa13', 'kcaa13', bitInt('kcaa13'))
    pushInt('kcaa14', 'kcaa14', body.kcaa14 !== undefined && body.kcaa14 !== null ? bitInt('kcaa14') : 1)
    pushInt('Customer_supply', 'Customer_supply', bitInt('Customer_supply'))
    pushInt('kcaa27', 'kcaa27', dirInt('kcaa27'))
    pushInt('kcaa31', 'kcaa31', dirInt('kcaa31'))
    pushInt('sign', 'sign', body.sign !== undefined && body.sign !== null ? bitInt('sign') : 0)

    const pushDec = (col, param) => {
      if (!colset.has(col.toLowerCase())) return
      const n = decNum(param)
      cols.push(col)
      vals.push(`@${param}`)
      ins.input(param, sql.Decimal(18, 6), n != null ? n : 0)
    }
    if (colset.has('sale_price')) {
      const n = decNum('sale_price')
      cols.push('sale_price')
      vals.push('@sale_price')
      ins.input('sale_price', sql.Decimal(18, 6), n != null ? n : 0)
    }
    if (colset.has('cost_price')) {
      const n = decNum('cost_price')
      cols.push('cost_price')
      vals.push('@cost_price')
      ins.input('cost_price', sql.Decimal(18, 6), n != null ? n : 0)
    }
    pushDec('kcaa26', 'kcaa26')
    pushDec('kcaa30', 'kcaa30')
    pushDec('kcaa32', 'kcaa32')
    pushDec('kcaa33', 'kcaa33')

    if (colset.has('pass')) {
      cols.push('pass')
      vals.push("N'0'")
    }
    if (colset.has('del')) {
      cols.push('del')
      vals.push("N'0'")
    }
    if (colset.has('uid') && actor.uidInt != null) {
      cols.push('uid')
      vals.push('@uid')
      ins.input('uid', sql.Int, actor.uidInt)
    }
    if (colset.has('uname') && actor.uname) {
      cols.push('uname')
      vals.push('@uname')
      ins.input('uname', sql.NVarChar(50), actor.uname)
    }
    if (colset.has('utruename') && actor.utruename) {
      cols.push('utruename')
      vals.push('@utruename')
      ins.input('utruename', sql.NVarChar(50), actor.utruename)
    }
    if (colset.has('addtime')) {
      cols.push('addtime')
      vals.push('@addtime')
      ins.input('addtime', sql.NVarChar(50), nowStr)
    }
    if (colset.has('edittime')) {
      cols.push('edittime')
      vals.push('@edittime')
      ins.input('edittime', sql.NVarChar(50), nowStr)
    }

    if (!cols.length) {
      res.status(500).json({ code: 500, msg: '新增失败：未探测到可写入列', data: null })
      return
    }

    const qr = await ins.query(`
      INSERT INTO ${INV_BOM_MASTER_FROM} (${cols.join(', ')})
      VALUES (${vals.join(', ')})
    `)
    if ((qr.rowsAffected?.[0] ?? 0) <= 0) {
      res.status(500).json({ code: 500, msg: '新增失败：数据库未写入', data: null })
      return
    }
    res.json({ code: 200, msg: 'success', data: { systemcode } })
  } catch (err) {
    console.error('POST BOM 主档新增(save-main) 失败：', err)
    const detail = String(err?.message ?? err?.originalError?.message ?? '数据库写入失败')
    res.status(500).json({ code: 500, msg: `新增 BOM 失败：${detail}`, data: null })
  }
}

app.post('/api/inventory/bom/save-main', handleInvBomMasterSaveMain)
app.post('/api/inventory/bom', handleInvBomMasterSaveMain)

/**
 * BOM 主档保存（未审可改）：按 systemcode 更新
 * PUT /api/inventory/bom
 */
app.put('/api/inventory/bom', async (req, res) => {
  try {
    const body = req.body ?? {}
    const systemcode = String(body.systemcode ?? '').trim()
    if (!systemcode) {
      res.status(400).json({ code: 400, msg: 'systemcode 不能为空', data: null })
      return
    }
    const kcaa01 = String(body.kcaa01 ?? '').trim()
    const kcaa02 = String(body.kcaa02 ?? '').trim()
    const kcaa05 = String(body.kcaa05 ?? '').trim()
    const kcaa04 = String(body.kcaa04 ?? '').trim()
    const kcaa25 = String(body.kcaa25 ?? '').trim()
    if (!kcaa01 || !kcaa02) {
      res.status(400).json({ code: 400, msg: '编码与名称不能为空', data: null })
      return
    }
    if (!kcaa05 || !kcaa04 || !kcaa25) {
      res.status(400).json({ code: 400, msg: '分类、使用单位、采购单位不能为空', data: null })
      return
    }
    if (/\s/.test(kcaa01)) {
      res.status(400).json({ code: 400, msg: '编码不能包含空格', data: null })
      return
    }

    const pool = await getPool()
    if ((await countInvBomDuplicateKcaa01(pool, kcaa01, systemcode)) > 0) {
      res.status(400).json({ code: 400, msg: `编码「${kcaa01}」已被其他 BOM 使用`, data: null })
      return
    }

    const colset = await getInvBomMasterColumnSet(pool)
    const actor = await resolveActorAuditTripletFromReq(pool, req)
    const nowStr = formatBomColorcodeTimestamp()

    const str = (k, max = 800) => {
      let s = String(body[k] ?? '').trim()
      if (s.length > max) s = s.slice(0, max)
      return s
    }
    const decNum = (k) => {
      const raw = body[k]
      if (raw === '' || raw === null || raw === undefined) return null
      const n = Number(raw)
      return Number.isFinite(n) ? n : null
    }
    const bitInt = (k) => {
      const v = body[k]
      if (v === true || v === 1 || v === '1') return 1
      return 0
    }
    const dirInt = (k) => {
      const n = Number(body[k])
      if (n === 0 || n === 1) return n
      return 0
    }

    /** @type {string[]} */
    const setParts = []
    const upd = pool.request().input('systemcode', sql.NVarChar(100), systemcode)

    const setNvarchar = (col, param, val, len) => {
      if (!colset.has(col.toLowerCase())) return
      const csql = col === 'decimal' ? '[decimal]' : col
      setParts.push(`${csql} = @${param}`)
      upd.input(param, sql.NVarChar(len), val ?? '')
    }

    setNvarchar('kcaa01', 'kcaa01', kcaa01, 300)
    setNvarchar('kcaa02', 'kcaa02', kcaa02, 500)
    setNvarchar('kcaa02_en', 'kcaa02_en', str('kcaa02_en', 500), 500)
    setNvarchar('kpname', 'kpname', str('kpname', 500), 500)
    setNvarchar('kcaa03', 'kcaa03', str('kcaa03', 500), 500)
    setNvarchar('kcaa05', 'kcaa05', str('kcaa05', 200), 200)
    setNvarchar('kcaa06', 'kcaa06', str('kcaa06', 300), 300)
    setNvarchar('kcaa09', 'kcaa09', str('kcaa09', 300), 300)
    setNvarchar('kcaa10', 'kcaa10', str('kcaa10', 200), 200)
    setNvarchar('kcaa11', 'kcaa11', str('kcaa11', 200), 200)
    setNvarchar('location', 'location', str('location', 200) || '国内', 200)
    setNvarchar('kcaa04', 'kcaa04', str('kcaa04', 100), 100)
    setNvarchar('kcaa25', 'kcaa25', str('kcaa25', 100), 100)
    setNvarchar('kcaa29', 'kcaa29', str('kcaa29', 100), 100)
    setNvarchar('kcaa34', 'kcaa34', str('kcaa34', 80), 80)
    setNvarchar('kcaa35', 'kcaa35', str('kcaa35', 80), 80)
    setNvarchar('remark', 'remark', str('remark', 2000), 2000)
    setNvarchar('Customer_Name', 'Customer_Name', str('Customer_Name', 500), 500)
    setNvarchar('decimal', 'bom_decimal', str('decimal', 20) || '2', 20)

    if (colset.has('kcaa15')) {
      setParts.push('kcaa15 = @kcaa15')
      upd.input('kcaa15', sql.NVarChar(50), str('kcaa15', 50))
    }

    const setInt = (col, param, v) => {
      if (!colset.has(col.toLowerCase())) return
      setParts.push(`${col} = @${param}`)
      upd.input(param, sql.Int, v)
    }
    setInt('kcaa12', 'kcaa12', bitInt('kcaa12'))
    setInt('kcaa13', 'kcaa13', bitInt('kcaa13'))
    setInt('kcaa14', 'kcaa14', bitInt('kcaa14'))
    setInt('Customer_supply', 'Customer_supply', bitInt('Customer_supply'))
    setInt('kcaa27', 'kcaa27', dirInt('kcaa27'))
    setInt('kcaa31', 'kcaa31', dirInt('kcaa31'))
    setInt('sign', 'sign', bitInt('sign'))

    if (colset.has('sale_price')) {
      const n = decNum('sale_price')
      setParts.push('sale_price = @sale_price')
      upd.input('sale_price', sql.Decimal(18, 6), n != null ? n : 0)
    }
    if (colset.has('cost_price')) {
      const n = decNum('cost_price')
      setParts.push('cost_price = @cost_price')
      upd.input('cost_price', sql.Decimal(18, 6), n != null ? n : 0)
    }

    const setDec = (col, param) => {
      if (!colset.has(col.toLowerCase())) return
      const n = decNum(param)
      setParts.push(`${col} = @${param}`)
      upd.input(param, sql.Decimal(18, 6), n != null ? n : 0)
    }
    setDec('kcaa26', 'kcaa26')
    setDec('kcaa30', 'kcaa30')
    setDec('kcaa32', 'kcaa32')
    setDec('kcaa33', 'kcaa33')

    if (colset.has('edittime')) {
      setParts.push('edittime = @edittime')
      upd.input('edittime', sql.NVarChar(50), nowStr)
    }
    pushInvBomEditAuditOnMasterUpdate(colset, setParts, upd, actor)

    // 保存主档时保持 dr_systemcode、guid 与 systemcode 一致
    if (colset.has('dr_systemcode')) {
      setParts.push('dr_systemcode = @sync_dr_systemcode')
      upd.input('sync_dr_systemcode', sql.NVarChar(100), systemcode)
    }
    if (colset.has('guid')) {
      setParts.push('[GUID] = @sync_guid')
      upd.input('sync_guid', sql.NVarChar(100), systemcode)
    }

    if (!setParts.length) {
      res.status(400).json({ code: 400, msg: '无可更新字段', data: null })
      return
    }

    const qr = await upd.query(`
      UPDATE ${INV_BOM_MASTER_FROM}
      SET ${setParts.join(', ')}
      WHERE LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(systemcode, N'')))) = @systemcode
        AND (ISNULL(del, N'') = N'' OR LTRIM(RTRIM(ISNULL(CONVERT(nvarchar(20), del), N''))) = N'0')
        AND LTRIM(RTRIM(ISNULL(CONVERT(nvarchar(10), pass), N''))) <> N'1'
    `)
    if ((qr.rowsAffected?.[0] ?? 0) <= 0) {
      res.status(400).json({
        code: 400,
        msg: '保存失败：记录不存在、已审核或已删除',
        data: null,
      })
      return
    }
    res.json({ code: 200, msg: 'success', data: { systemcode } })
  } catch (err) {
    console.error('PUT /api/inventory/bom 失败：', err)
    const detail = String(err?.message ?? err?.originalError?.message ?? '数据库更新失败')
    res.status(500).json({ code: 500, msg: `保存 BOM 失败：${detail}`, data: null })
  }
})

/**
 * BOM 主档审核：PUT /api/inventory/bom/audit — body:{ systemcode }
 */
app.put('/api/inventory/bom/audit', async (req, res) => {
  try {
    const systemcode = String(req.body?.systemcode ?? '').trim()
    if (!systemcode) {
      res.status(400).json({ code: 400, msg: 'systemcode 不能为空', data: null })
      return
    }
    const pool = await getPool()
    const existing = await fetchInvBomMasterRowBySystemcode(pool, systemcode)
    if (!existing || !legacyDeptRowIsActive(existing)) {
      res.status(404).json({ code: 404, msg: '未找到该 BOM 或已在回收站', data: null })
      return
    }
    if (legacyDeptPassIsAudited(existing.pass)) {
      res.status(400).json({ code: 400, msg: '当前已是已审核状态', data: null })
      return
    }
    const edittimeStr = formatBomColorcodeTimestamp()
    await pool
      .request()
      .input('sc', sql.NVarChar(100), systemcode)
      .input('edittime', sql.NVarChar(50), edittimeStr)
      .query(`
        UPDATE ${INV_BOM_MASTER_FROM}
        SET pass = N'1', edittime = @edittime
        WHERE LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(systemcode, N'')))) = @sc
          AND (ISNULL(del, N'') = N'' OR LTRIM(RTRIM(ISNULL(CONVERT(nvarchar(20), del), N''))) = N'0')
      `)
    res.json({ code: 200, msg: 'success', data: { systemcode } })
  } catch (err) {
    console.error('PUT /api/inventory/bom/audit 失败：', err)
    const detail = String(err?.message ?? err?.originalError?.message ?? '数据库更新失败')
    res.status(500).json({ code: 500, msg: `审核失败：${detail}`, data: null })
  }
})

/**
 * BOM 主档批量审核：PUT /api/inventory/bom/audit-batch
 * body: { systemcodes: string[] } — 仅用于列表「当前页批量审核」（建议 <= 200）
 */
app.put('/api/inventory/bom/audit-batch', async (req, res) => {
  try {
    const body = req.body ?? {}
    const raw = body.systemcodes
    const systemcodes = Array.isArray(raw)
      ? [...new Set(raw.map((c) => String(c ?? '').trim()).filter(Boolean))]
      : []

    if (!systemcodes.length) {
      res.status(400).json({ code: 400, msg: 'systemcodes 不能为空', data: null })
      return
    }
    if (systemcodes.length > 200) {
      res.status(400).json({ code: 400, msg: '批量审核数量过多（最多 200 条）', data: null })
      return
    }

    const pool = await getPool()
    const tx = new sql.Transaction(pool)
    await tx.begin()
    try {
      const edittimeStr = formatBomColorcodeTimestamp()
      let successCount = 0
      /** @type {{ systemcode: string, msg: string }[]} */
      const failed = []

      for (const sc of systemcodes) {
        try {
          const existing = await fetchInvBomMasterRowBySystemcode(tx, sc)
          if (!existing || !legacyDeptRowIsActive(existing)) {
            failed.push({ systemcode: sc, msg: '未找到该 BOM 或已在回收站' })
            continue
          }
          if (legacyDeptPassIsAudited(existing.pass)) {
            continue
          }
          const q = new sql.Request(tx)
          q.input('sc', sql.NVarChar(100), sc)
          q.input('edittime', sql.NVarChar(50), edittimeStr)
          await q.query(`
            UPDATE ${INV_BOM_MASTER_FROM}
            SET pass = N'1', edittime = @edittime
            WHERE LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(systemcode, N'')))) = @sc
              AND (ISNULL(del, N'') = N'' OR LTRIM(RTRIM(ISNULL(CONVERT(nvarchar(20), del), N''))) = N'0')
          `)
          successCount += 1
        } catch (innerErr) {
          const detail = String(innerErr?.message ?? '审核失败')
          failed.push({ systemcode: sc, msg: detail })
        }
      }

      await tx.commit()
      res.json({
        code: 200,
        msg: 'success',
        data: { successCount, failed, total: systemcodes.length },
      })
    } catch (innerErr) {
      try {
        await tx.rollback()
      } catch {
        // ignore
      }
      throw innerErr
    }
  } catch (err) {
    console.error('PUT /api/inventory/bom/audit-batch 失败：', err)
    const detail = String(err?.message ?? err?.originalError?.message ?? '数据库更新失败')
    res.status(500).json({ code: 500, msg: `批量审核失败：${detail}`, data: null })
  }
})

/**
 * BOM 主档反审：PUT /api/inventory/bom/unaudit — body:{ systemcode }
 */
app.put('/api/inventory/bom/unaudit', async (req, res) => {
  try {
    const systemcode = String(req.body?.systemcode ?? '').trim()
    if (!systemcode) {
      res.status(400).json({ code: 400, msg: 'systemcode 不能为空', data: null })
      return
    }
    const pool = await getPool()
    const existing = await fetchInvBomMasterRowBySystemcode(pool, systemcode)
    if (!existing || !legacyDeptRowIsActive(existing)) {
      res.status(404).json({ code: 404, msg: '未找到该 BOM 或已在回收站', data: null })
      return
    }
    if (!legacyDeptPassIsAudited(existing.pass)) {
      res.status(400).json({ code: 400, msg: '当前为未审核状态，无需反审', data: null })
      return
    }
    const edittimeStr = formatBomColorcodeTimestamp()
    await pool
      .request()
      .input('sc', sql.NVarChar(100), systemcode)
      .input('edittime', sql.NVarChar(50), edittimeStr)
      .query(`
        UPDATE ${INV_BOM_MASTER_FROM}
        SET pass = N'0', edittime = @edittime
        WHERE LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(systemcode, N'')))) = @sc
          AND (ISNULL(del, N'') = N'' OR LTRIM(RTRIM(ISNULL(CONVERT(nvarchar(20), del), N''))) = N'0')
      `)
    res.json({ code: 200, msg: 'success', data: { systemcode } })
  } catch (err) {
    console.error('PUT /api/inventory/bom/unaudit 失败：', err)
    const detail = String(err?.message ?? err?.originalError?.message ?? '数据库更新失败')
    res.status(500).json({ code: 500, msg: `反审失败：${detail}`, data: null })
  }
})

/**
 * BOM 主档恢复（回收站）：PUT /api/inventory/bom/restore — body:{ systemcode }
 */
app.put('/api/inventory/bom/restore', async (req, res) => {
  try {
    const systemcode = String(req.body?.systemcode ?? '').trim()
    if (!systemcode) {
      res.status(400).json({ code: 400, msg: 'systemcode 不能为空', data: null })
      return
    }
    const pool = await getPool()
    const existing = await fetchInvBomMasterRowBySystemcode(pool, systemcode)
    if (!existing) {
      res.status(404).json({ code: 404, msg: '未找到该 BOM', data: null })
      return
    }
    if (legacyDeptRowIsActive(existing)) {
      res.status(400).json({ code: 400, msg: '当前记录未处于回收站，无需恢复', data: null })
      return
    }
    const edittimeStr = formatBomColorcodeTimestamp()
    await pool
      .request()
      .input('sc', sql.NVarChar(100), systemcode)
      .input('edittime', sql.NVarChar(50), edittimeStr)
      .query(`
        UPDATE ${INV_BOM_MASTER_FROM}
        SET del = N'0', edittime = @edittime
        WHERE LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(systemcode, N'')))) = @sc
          AND LTRIM(RTRIM(ISNULL(CONVERT(nvarchar(20), del), N''))) = N'1'
      `)
    res.json({ code: 200, msg: 'success', data: { systemcode } })
  } catch (err) {
    console.error('PUT /api/inventory/bom/restore 失败：', err)
    const detail = String(err?.message ?? err?.originalError?.message ?? '数据库更新失败')
    res.status(500).json({ code: 500, msg: `恢复失败：${detail}`, data: null })
  }
})

/**
 * BOM 主档彻底删除：DELETE /api/inventory/bom/systemcode/:systemcode/permanent（仅回收站 del=1）
 */
app.delete('/api/inventory/bom/systemcode/:systemcode/permanent', async (req, res) => {
  try {
    let systemcode = ''
    try {
      systemcode = decodeURIComponent(String(req.params?.systemcode ?? '').trim())
    } catch {
      systemcode = String(req.params?.systemcode ?? '').trim()
    }
    if (!systemcode) {
      res.status(400).json({ code: 400, msg: 'systemcode 不能为空', data: null })
      return
    }
    const pool = await getPool()
    const existing = await fetchInvBomMasterRowBySystemcode(pool, systemcode)
    if (!existing) {
      res.status(404).json({ code: 404, msg: '未找到该 BOM', data: null })
      return
    }
    if (legacyDeptRowIsActive(existing)) {
      res.status(400).json({
        code: 400,
        msg: '仅回收站中的记录可彻底删除，请先将记录移入回收站',
        data: null,
      })
      return
    }
    const delResult = await pool.request().input('sc', sql.NVarChar(100), systemcode).query(`
      DELETE FROM ${INV_BOM_MASTER_FROM}
      WHERE LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(systemcode, N'')))) = @sc
        AND LTRIM(RTRIM(ISNULL(CONVERT(nvarchar(20), del), N''))) = N'1'
    `)
    const affected = Array.isArray(delResult.rowsAffected)
      ? Number(delResult.rowsAffected[0] ?? 0)
      : Number(delResult.rowsAffected ?? 0)
    if (!Number.isFinite(affected) || affected < 1) {
      res.status(404).json({ code: 404, msg: '未找到可彻底删除的回收站记录', data: null })
      return
    }
    res.json({ code: 200, msg: 'success', data: { systemcode } })
  } catch (err) {
    console.error('DELETE /api/inventory/bom/systemcode/:systemcode/permanent 失败：', err)
    const detail = String(err?.message ?? err?.originalError?.message ?? '数据库删除失败')
    res.status(500).json({ code: 500, msg: `彻底删除失败：${detail}`, data: null })
  }
})

/**
 * BOM 主档逻辑删除：DELETE /api/inventory/bom/systemcode/:systemcode — 已审核禁止
 */
app.delete('/api/inventory/bom/systemcode/:systemcode', async (req, res) => {
  try {
    let systemcode = ''
    try {
      systemcode = decodeURIComponent(String(req.params?.systemcode ?? '').trim())
    } catch {
      systemcode = String(req.params?.systemcode ?? '').trim()
    }
    if (!systemcode) {
      res.status(400).json({ code: 400, msg: 'systemcode 不能为空', data: null })
      return
    }
    const pool = await getPool()
    const existing = await fetchInvBomMasterRowBySystemcode(pool, systemcode)
    if (!existing || !legacyDeptRowIsActive(existing)) {
      res.status(404).json({ code: 404, msg: '未找到该 BOM 或已在回收站', data: null })
      return
    }
    if (legacyDeptPassIsAudited(existing.pass)) {
      res.status(400).json({ code: 400, msg: HR_STAFF_AUDIT_LOCK_MSG, data: null })
      return
    }
    const deltimeStr = formatBomColorcodeTimestamp()
    await pool
      .request()
      .input('sc', sql.NVarChar(100), systemcode)
      .input('deltime', sql.NVarChar(50), deltimeStr)
      .query(`
        UPDATE ${INV_BOM_MASTER_FROM}
        SET del = N'1', deltime = @deltime
        WHERE LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(systemcode, N'')))) = @sc
          AND (ISNULL(del, N'') = N'' OR LTRIM(RTRIM(ISNULL(CONVERT(nvarchar(20), del), N''))) = N'0')
      `)
    res.json({ code: 200, msg: 'success', data: { systemcode } })
  } catch (err) {
    console.error('DELETE /api/inventory/bom/systemcode/:systemcode 失败：', err)
    const detail = String(err?.message ?? err?.originalError?.message ?? '数据库更新失败')
    res.status(500).json({ code: 500, msg: `删除失败：${detail}`, data: null })
  }
})

/**
 * BOM 主档轻量查询（配件钻取）：无 JOIN、无单位换算
 * GET /api/inventory/bom/:id/brief — :id 为 kcaa01（须注册在 /:id 全量详情之前）
 */
app.get('/api/inventory/bom/:id/brief', async (req, res) => {
  try {
    let code = ''
    try {
      code = decodeURIComponent(String(req.params?.id ?? '').trim())
    } catch {
      code = String(req.params?.id ?? '').trim()
    }
    if (!code) {
      res.status(400).json({ code: 400, msg: '参数错误：编码不能为空', data: null })
      return
    }

    const pool = await getPool()
    const row = await fetchInvBomMasterBriefByKcaa01(pool, code)
    if (!row) {
      res.status(404).json({ code: 404, msg: '未找到该编码对应的 BOM 资料', data: null })
      return
    }

    const str = (v) => (v == null ? '' : String(v))
    const basic = {
      systemcode: str(row.systemcode),
      pass: str(row.pass),
      kcaa01: str(row.kcaa01),
      kcaa02: str(row.kcaa02),
      kcaa03: str(row.kcaa03),
    }

    res.json({ code: 200, msg: 'success', data: { basic } })
  } catch (err) {
    console.error('GET /api/inventory/bom/:id/brief 失败：', err)
    const detail = String(err?.message ?? err?.originalError?.message ?? '数据库查询失败')
    res.status(500).json({ code: 500, msg: `读取 BOM 主档摘要失败：${detail}`, data: null })
  }
})

/**
 * BOM 主档详情（基础资料步骤）：仅选取约定列，不查询 kcaa16
 * GET /api/inventory/bom/:id — :id 为 kcaa01（URL 编码，支持含 / 的编码）
 * - LEFT JOIN Bom_material：kcaa05=code，带出 categoryName；分类展示名称
 * - LEFT JOIN Bom_Stocks_workshop：kcaa15=code，workshopName；workshop_display 为「编码, 名称」
 * - unit_conversion：采购/报价与使用的转换方向（po_to_use 等）及转换率；sale_price、kcaa34_display；kpname 开票名称
 * - systemcode：主档稳定键，供 Bom_parts.kcac01 关联
 */
app.get('/api/inventory/bom/:id', async (req, res) => {
  try {
    let code = ''
    try {
      code = decodeURIComponent(String(req.params?.id ?? '').trim())
    } catch {
      code = String(req.params?.id ?? '').trim()
    }
    if (!code) {
      res.status(400).json({ code: 400, msg: '参数错误：编码不能为空', data: null })
      return
    }

    const pool = await getPool()
    const r = await pool.request().input('code', sql.NVarChar(300), code).query(`
      SELECT TOP 1
        LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(b.systemcode, N'')))) AS systemcode,
        LTRIM(RTRIM(ISNULL(CONVERT(nvarchar(10), b.pass), N''))) AS pass,
        LTRIM(RTRIM(CONVERT(nvarchar(300), ISNULL(b.kcaa01, N'')))) AS kcaa01,
        LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(b.kcaa02, N'')))) AS kcaa02,
        LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(b.kcaa02_en, N'')))) AS kcaa02_en,
        LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(b.kpname, N'')))) AS kpname,
        LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(b.kcaa03, N'')))) AS kcaa03,
        LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(b.kcaa11, N'')))) AS kcaa11,
        LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(b.kcaa05, N'')))) AS kcaa05,
        LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(cat.name, N'')))) AS categoryName,
        LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(b.kcaa10, N'')))) AS kcaa10,
        LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(b.location, N'')))) AS location,
        LTRIM(RTRIM(CONVERT(nvarchar(300), ISNULL(b.kcaa06, N'')))) AS kcaa06,
        LTRIM(RTRIM(CONVERT(nvarchar(300), ISNULL(b.kcaa09, N'')))) AS kcaa09,
        LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(b.kcaa04, N'')))) AS kcaa04,
        LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(b.kcaa25, N'')))) AS kcaa25,
        LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(b.kcaa29, N'')))) AS kcaa29,
        LTRIM(RTRIM(ISNULL(CONVERT(nvarchar(80), b.cost_price), N''))) AS cost_price,
        LTRIM(RTRIM(ISNULL(CONVERT(nvarchar(80), b.sale_price), N''))) AS sale_price,
        LTRIM(RTRIM(ISNULL(CONVERT(nvarchar(80), b.kcaa34), N''))) AS kcaa34,
        LTRIM(RTRIM(CONVERT(nvarchar(80), ISNULL(b.kcaa35, N'')))) AS kcaa35,
        LTRIM(RTRIM(ISNULL(CONVERT(nvarchar(80), b.[decimal]), N''))) AS bom_decimal,
        LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(b.remark, N'')))) AS remark,
        LTRIM(RTRIM(ISNULL(CONVERT(nvarchar(80), b.kcaa32), N''))) AS kcaa32,
        LTRIM(RTRIM(ISNULL(CONVERT(nvarchar(80), b.kcaa33), N''))) AS kcaa33,
        LTRIM(RTRIM(ISNULL(CONVERT(nvarchar(80), b.kcaa26), N''))) AS kcaa26,
        LTRIM(RTRIM(ISNULL(CONVERT(nvarchar(20), b.kcaa27), N''))) AS kcaa27,
        LTRIM(RTRIM(ISNULL(CONVERT(nvarchar(80), b.kcaa30), N''))) AS kcaa30,
        LTRIM(RTRIM(ISNULL(CONVERT(nvarchar(20), b.kcaa31), N''))) AS kcaa31,
        LTRIM(RTRIM(ISNULL(CONVERT(nvarchar(20), b.kcaa12), N''))) AS kcaa12,
        LTRIM(RTRIM(ISNULL(CONVERT(nvarchar(20), b.kcaa13), N''))) AS kcaa13,
        LTRIM(RTRIM(ISNULL(CONVERT(nvarchar(20), b.kcaa14), N''))) AS kcaa14,
        LTRIM(RTRIM(ISNULL(CONVERT(nvarchar(20), b.kcaa15), N''))) AS kcaa15,
        LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(ws.name, N'')))) AS workshopName,
        LTRIM(RTRIM(ISNULL(CONVERT(nvarchar(20), b.Customer_supply), N''))) AS Customer_supply,
        LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(b.Customer_Name, N'')))) AS Customer_Name,
        LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(sup.s_name, N'')))) AS supplierName,
        LTRIM(RTRIM(ISNULL(CONVERT(nvarchar(20), b.sign), N''))) AS sign
      FROM ${INV_BOM_MASTER_FROM} AS b
      LEFT JOIN ${BOM_MATERIAL_FROM} AS cat
        ON LTRIM(RTRIM(ISNULL(CONVERT(nvarchar(200), b.kcaa05), N''))) = LTRIM(RTRIM(ISNULL(CONVERT(nvarchar(200), cat.code), N'')))
      LEFT JOIN ${BOM_STOCKS_WORKSHOP_FROM} AS ws
        ON LTRIM(RTRIM(ISNULL(CONVERT(nvarchar(200), b.kcaa15), N''))) = LTRIM(RTRIM(ISNULL(CONVERT(nvarchar(200), ws.code), N'')))
      LEFT JOIN ${SYS_SUPPLIER_FROM} AS sup
        ON LTRIM(RTRIM(ISNULL(CONVERT(nvarchar(500), b.Customer_Name), N''))) = LTRIM(RTRIM(ISNULL(CONVERT(nvarchar(100), sup.s_code), N'')))
      WHERE LTRIM(RTRIM(CONVERT(nvarchar(300), ISNULL(b.kcaa01, N'')))) = @code
    `)

    const row = r.recordset?.[0] ?? null
    if (!row) {
      res.status(404).json({ code: 404, msg: '未找到该编码对应的 BOM 资料', data: null })
      return
    }

    const str = (v) => (v == null ? '' : String(v))
    const flagChecked = (v) => {
      const s = str(v).trim()
      return s === '1' || s.toLowerCase() === 'y' || s === '是'
    }
    const csRaw = str(row.Customer_supply).trim()
    const customer_supply_checked =
      csRaw === ''
        ? false
        : Number.isFinite(Number(csRaw))
          ? Number(csRaw) === 1
          : flagChecked(row.Customer_supply)

    let unit_conversion = await fetchBomUnitConversionDetail(pool, row.kcaa04, row.kcaa25, row.kcaa29)
    const k26s = str(row.kcaa26).trim()
    const k30s = str(row.kcaa30).trim()
    if (k26s) unit_conversion = { ...unit_conversion, purchase_rate: k26s }
    if (k30s) unit_conversion = { ...unit_conversion, quote_rate: k30s }
    const k27s = str(row.kcaa27).trim()
    if (k27s === '0') unit_conversion = { ...unit_conversion, purchase_direction: 'po_to_use' }
    else if (k27s === '1') unit_conversion = { ...unit_conversion, purchase_direction: 'use_to_po' }
    const k31s = str(row.kcaa31).trim()
    if (k31s === '0') unit_conversion = { ...unit_conversion, quote_direction: 'qt_to_use' }
    else if (k31s === '1') unit_conversion = { ...unit_conversion, quote_direction: 'use_to_qt' }

    /** BOM 币别 kcaa34：测试期固定码表；未知编码原样返回便于核对库值 */
    const kcaa34Raw = str(row.kcaa34).trim()
    const kcaa34DisplayMap = { '001': '001,人民币', '002': '002,美元', '003': '003,港元' }
    const kcaa34_display =
      kcaa34Raw === '' ? '' : Object.prototype.hasOwnProperty.call(kcaa34DisplayMap, kcaa34Raw) ? kcaa34DisplayMap[kcaa34Raw] : kcaa34Raw

    const workshop_display = buildBomWorkshopDisplay(row.kcaa15, row.workshopName)
    const supplier_display = buildBomWorkshopDisplay(row.Customer_Name, row.supplierName)

    const basic = {
      systemcode: str(row.systemcode),
      pass: str(row.pass),
      kcaa01: str(row.kcaa01),
      kcaa02: str(row.kcaa02),
      kcaa02_en: str(row.kcaa02_en),
      kpname: str(row.kpname),
      kcaa03: str(row.kcaa03),
      kcaa11: str(row.kcaa11),
      kcaa05: str(row.kcaa05),
      categoryName: str(row.categoryName),
      kcaa10: str(row.kcaa10),
      location: str(row.location),
      kcaa06: str(row.kcaa06),
      kcaa09: str(row.kcaa09),
      kcaa04: str(row.kcaa04),
      kcaa25: str(row.kcaa25),
      kcaa29: str(row.kcaa29),
      cost_price: str(row.cost_price),
      sale_price: str(row.sale_price),
      kcaa34: kcaa34Raw,
      kcaa34_display: kcaa34_display,
      kcaa35: str(row.kcaa35),
      decimal: str(row.bom_decimal),
      remark: str(row.remark),
      kcaa32: str(row.kcaa32),
      kcaa33: str(row.kcaa33),
      kcaa26: str(row.kcaa26),
      kcaa27: str(row.kcaa27),
      kcaa30: str(row.kcaa30),
      kcaa31: str(row.kcaa31),
      Customer_Name: str(row.Customer_Name),
      supplier_display,
      sign: str(row.sign),
      unit_conversion,
      workshop_display,
      kcaa15: str(row.kcaa15),
      kcaa12_checked: flagChecked(row.kcaa12),
      kcaa13_checked: flagChecked(row.kcaa13),
      kcaa14_checked: flagChecked(row.kcaa14),
      customer_supply_checked,
    }

    res.json({ code: 200, msg: 'success', data: { basic } })
  } catch (err) {
    console.error('GET /api/inventory/bom/:id 失败：', err)
    const detail = String(err?.message ?? err?.originalError?.message ?? '数据库查询失败')
    res.status(500).json({ code: 500, msg: `读取 BOM 详情失败：${detail}`, data: null })
  }
})

}
