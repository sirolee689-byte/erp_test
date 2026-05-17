/**
 * Bom_parts 单行插入 + 与库存 BOM 保存一致的「子件主档同步」UPDATE（从 index.js 抽取，供纸格导入等复用）
 */
import sql from 'mssql'

const INV_BOM_MASTER_TABLE = (() => {
  const raw = String(process.env.INV_BOM_MASTER_TABLE ?? 'bom_000').trim()
  return /^[A-Za-z0-9_]+$/.test(raw) ? raw : 'bom_000'
})()
const INV_BOM_MASTER_FROM = `dbo.[${INV_BOM_MASTER_TABLE}]`

const INV_BOM_PARTS_TABLE = (() => {
  const raw = String(process.env.INV_BOM_PARTS_TABLE ?? 'Bom_parts').trim()
  return /^[A-Za-z0-9_]+$/.test(raw) ? raw : 'Bom_parts'
})()
const INV_BOM_PARTS_FROM = `dbo.[${INV_BOM_PARTS_TABLE}]`

/** 纸格专用列缓存，避免与 index.js 内 INV_BOM_PARTS_COLSET_PROMISE 混用 */
let PP_BOM_PARTS_COLSET_PROMISE = null

/**
 * @param {import('mssql').ConnectionPool} pool
 */
export async function getBomPartsColumnSetForPaperPattern(pool) {
  if (PP_BOM_PARTS_COLSET_PROMISE) return PP_BOM_PARTS_COLSET_PROMISE
  const tbl = INV_BOM_PARTS_TABLE
  PP_BOM_PARTS_COLSET_PROMISE = (async () => {
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
      console.warn('[Bom_parts 纸格] 读取列清单失败：', err?.message ?? err)
      return new Set()
    }
  })()
  return PP_BOM_PARTS_COLSET_PROMISE
}

/**
 * @param {import('mssql').ConnectionPool} pool
 */
export async function getBomPartsDelColumnKindForPaperPattern(pool) {
  return getBomPartsColumnDataKindForPaperPattern(pool, 'del')
}

/**
 * Bom_parts 列物理类型：数值型或 nvarchar（与 del 探测规则一致，供 pass 等状态位写入）
 * @param {import('mssql').ConnectionPool} pool
 * @param {string} columnName
 * @returns {Promise<'numeric'|'nvarchar'>}
 */
export async function getBomPartsColumnDataKindForPaperPattern(pool, columnName) {
  const col = String(columnName ?? '').trim()
  if (!col) return 'nvarchar'
  try {
    const r = await pool
      .request()
      .input('tn', sql.NVarChar(128), INV_BOM_PARTS_TABLE)
      .input('col', sql.NVarChar(128), col).query(`
      SELECT DATA_TYPE AS dt
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = N'dbo' AND TABLE_NAME = @tn AND COLUMN_NAME = @col
    `)
    const dt = String(r.recordset?.[0]?.dt ?? '').toLowerCase()
    if (dt === 'bit' || dt === 'tinyint' || dt === 'smallint' || dt === 'int' || dt === 'bigint')
      return 'numeric'
    return 'nvarchar'
  } catch {
    return 'nvarchar'
  }
}

/** 纸格导入 Bom_parts：pass 默认已审核 */
export const PAPER_PATTERN_BOM_PARTS_PASS_DEFAULT = '1'

/** @param {unknown} raw */
function bomPartParseDecimal(raw) {
  if (raw === null || raw === undefined) return 0
  const s = String(raw).replace(/,/g, '').trim()
  if (s === '') return 0
  const n = Number(s)
  return Number.isFinite(n) ? n : 0
}

/** 纸格/辅料：空或无效为 null；有效数保留六位小数（与 Bom_000 一致） */
function bomPartParseDecimalOrNull(raw) {
  if (raw === null || raw === undefined) return null
  const s = String(raw).replace(/,/g, '').trim()
  if (s === '') return null
  const n = Number(s)
  if (!Number.isFinite(n)) return null
  return Math.round(n * 1e6) / 1e6
}

/** @param {unknown} raw */
function bomPartRoundDecimal6(raw) {
  const n = bomPartParseDecimal(raw)
  if (!Number.isFinite(n)) return 0
  return Math.round(n * 1e6) / 1e6
}

/** 用量合计：kcac04 * (1 + kcac05) */
function bomPartComputeKcac06(qtyRaw, lossRaw) {
  const q = bomPartRoundDecimal6(qtyRaw)
  const l = bomPartRoundDecimal6(lossRaw)
  return bomPartRoundDecimal6(q * (1 + l))
}

/** @param {unknown} raw */
function bomPartParseSeq(raw) {
  const n = Number(raw)
  if (!Number.isFinite(n) || n < 0) return 0
  const t = Math.trunc(n)
  return t > 2147483647 ? 2147483647 : t
}

/**
 * 纸格导入 Bom_parts 审计列：列存在则写入（值来自 req.user，非 Bom_000）
 * @param {Set<string>} partColset
 * @param {import('mssql').Request} q
 * @param {string} insCols
 * @param {string} insVals
 * @param {{ actor: { uidInt: number | null, uname: string | null, utruename: string | null }, addtime: string }} audit
 * @returns {{ insCols: string, insVals: string }}
 */
export function appendBomPartsPaperPatternAuditColumns(partColset, q, insCols, insVals, audit) {
  const actor = audit?.actor ?? { uidInt: null, uname: null, utruename: null }
  const addtime = String(audit?.addtime ?? '').trim()
  let cols = insCols
  let vals = insVals

  if (partColset.has('uid')) {
    const uidRaw = actor.uidInt
    const uidInt =
      uidRaw != null && Number.isFinite(Number(uidRaw)) && Number(uidRaw) > 0
        ? Math.trunc(Number(uidRaw))
        : null
    if (uidInt != null) {
      q.input('pp_audit_uid', sql.Int, uidInt)
      cols += ', uid'
      vals += ', @pp_audit_uid'
    }
  }
  if (partColset.has('uname')) {
    const uname = String(actor.uname ?? '').trim()
    if (uname) {
      q.input('pp_audit_uname', sql.NVarChar(50), uname)
      cols += ', uname'
      vals += ', @pp_audit_uname'
    }
  }
  if (partColset.has('utruename')) {
    const utruename = String(actor.utruename ?? '').trim()
    if (utruename) {
      q.input('pp_audit_utruename', sql.NVarChar(50), utruename)
      cols += ', utruename'
      vals += ', @pp_audit_utruename'
    }
  }
  if (partColset.has('addtime') && addtime) {
    q.input('pp_audit_addtime', sql.NVarChar(50), addtime)
    cols += ', addtime'
    vals += ', @pp_audit_addtime'
  }

  return { insCols: cols, insVals: vals }
}

/** @param {import('mssql').Request} request */
/** @param {unknown} rawId */
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

/**
 * @param {import('mssql').Transaction|import('mssql').ConnectionPool} poolOrTx
 * @param {string} partMaterialCode
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

const BOM_PARTS_KCAA_SYNC_NAMES = Array.from({ length: 35 }, (_, i) => `kcaa${String(i + 1).padStart(2, '0')}`)
const BOM_PARTS_KCAA_PAYLOAD_FALLBACK = new Set(['kcaa02', 'kcaa03', 'kcaa04', 'kcaa11'])

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
 * @param {Set<string>} partColset
 * @param {string} alias
 */
function bomPartsBuildKcaaSyncAssignments(partColset, alias = 'b0') {
  const parts = []
  for (const col of BOM_PARTS_KCAA_SYNC_NAMES) {
    if (!partColset.has(col)) continue
    if (col === 'kcaa01') {
      parts.push(`p.[kcaa01] = ISNULL(${alias}.[kcaa01], @kcaa01Up)`)
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

function bomPartsSqlSubSystemcodeIsnullPreserve(partsCol, alias = 'b0') {
  return `p.[${partsCol}] = ISNULL(NULLIF(LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(${alias}.sub_systemcode, N'')))), N''), p.[${partsCol}])`
}

/** @param {Set<string>} partColset */
function bomPartsBuildKcac02Assignment(partColset, alias = 'b0') {
  if (!partColset.has('kcac02')) return null
  return bomPartsSqlSubSystemcodeIsnullPreserve('kcac02', alias)
}

/** @param {Set<string>} partColset */
function bomPartsBuildPartsSystemcodeAssignment(partColset, alias = 'b0') {
  if (!partColset.has('systemcode')) return null
  return bomPartsSqlSubSystemcodeIsnullPreserve('systemcode', alias)
}

/** @param {Record<string, unknown>|null|undefined} raw */
function bomPartResolveKcac05ForUpdate(raw) {
  if (raw && Object.prototype.hasOwnProperty.call(raw, 'kcac05') && raw.kcac05 === null) return null
  return bomPartRoundDecimal6(raw?.kcac05)
}

/**
 * @param {Record<string, unknown>|null|undefined} raw
 * @param {number} kcac04
 * @param {number|null} kcac05
 */
function bomPartResolveKcac06ForUpdate(raw, kcac04, kcac05) {
  if (raw && Object.prototype.hasOwnProperty.call(raw, 'kcac06') && raw.kcac06 === null) return null
  if (raw?.kcac06 !== undefined && raw?.kcac06 !== null) {
    return bomPartRoundDecimal6(raw.kcac06)
  }
  const loss = kcac05 === null || kcac05 === undefined ? 0 : kcac05
  return bomPartRoundDecimal6(bomPartComputeKcac06(kcac04, loss))
}

/**
 * 同步 UPDATE：支持 kcac05/kcac06 显式写 NULL（纸格 CUT 预览行）
 * @param {import('mssql').Transaction} tx
 * @param {Set<string>} partColset
 * @param {string} systemcode
 * @param {unknown} rawId
 * @param {Record<string, unknown>} raw
 */
async function bomPartsApplyFullLineUpdate(tx, partColset, systemcode, rawId, raw) {
  const kcaa01Up = String(raw?.kcaa01 ?? '').trim()
  const kcac04 = bomPartRoundDecimal6(raw?.kcac04)
  const kcac05 = bomPartResolveKcac05ForUpdate(raw)
  const kcac06 = bomPartResolveKcac06ForUpdate(raw, kcac04, kcac05)
  const costNum = bomPartParseDecimalOrNull(raw?.cost_price)
  const saleNum = bomPartParseDecimalOrNull(raw?.sale_price)
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
  q.input('kcac05', sql.Decimal(18, 6), kcac05 === null ? null : kcac05)
  q.input('cost_price', sql.Decimal(18, 6), costNum)
  if (partColset.has('sale_price')) {
    q.input('sale_price', sql.Decimal(18, 6), saleNum)
  }
  q.input('remark', sql.NVarChar(500), raw?.remark != null ? String(raw.remark) : '')
  q.input('seq', sql.Int, seqNum)
  if (partColset.has('kcac06')) {
    q.input('kcac06', sql.Decimal(18, 6), kcac06 === null ? null : kcac06)
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
  if (partColset.has('sale_price')) {
    setParts.push('p.sale_price = @sale_price')
  }

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

/**
 * 插入一行 Bom_parts 并执行全字段同步 UPDATE
 * @param {import('mssql').Transaction} tx
 * @param {Set<string>} partColset
 * @param {'numeric'|'nvarchar'} delColKind
 * @param {'numeric'|'nvarchar'} passColKind
 * @param {string} parentSystemcode 父主档 systemcode
 * @param {{
 *   kcaa01: string,
 *   kcac04: number|string,
 *   kcac05?: number|string,
 *   remark?: string,
 *   seq: number,
 *   kcac03?: string|null,
 *   describe?: string|null,
 *   kcaa02?: string,
 *   kcaa03?: string,
 *   kcaa04?: string,
 *   kcaa11?: string,
 *   kcac06FromExcel?: string|number|null,
 *   useNullKcac05AndKcac06?: boolean,
 *   type?: number|null,
 *   kcaa02EnFromBom000?: string,
 *   locationFromBom000?: string,
 *   sale_price?: number|string|null,
 *   nullPrices?: boolean,
 *   version?: number,
 * }} line
 * @param {{ actor: { uidInt: number | null, uname: string | null, utruename: string | null }, addtime: string }} [audit] 纸格导入登录态审计
 * kcac06FromExcel：非空可解析时写入 kcac06（如纸格 I 列合计），否则按 kcac04*(1+kcac05) 计算；
 * useNullKcac05AndKcac06：裁片 CUT 子档行，kcac05/kcac06 写库 NULL；type：库内有列时写入，缺省为 1；
 * version：库内有 [version] 列时写入，缺省 100；sale_price：辅料行从 Bom_000 抄 BOM 价；
 * kcaa02EnFromBom000/locationFromBom000：仅辅料行从 Bom_000 抄入 Bom_parts（列存在时 UPDATE）
 * @returns {Promise<number>} inserted id
 */
export async function insertBomPartsLinePaperPattern(
  tx,
  partColset,
  delColKind,
  passColKind,
  parentSystemcode,
  line,
  audit,
) {
  const kcaa01 = String(line.kcaa01 ?? '').trim()
  if (!kcaa01) throw new Error('Bom_parts 新增缺少 kcaa01')

  const useNullLossAndTotal = line.useNullKcac05AndKcac06 === true
  const kcac04 = bomPartRoundDecimal6(line.kcac04)
  const kcac05 = useNullLossAndTotal ? null : bomPartRoundDecimal6(line.kcac05)
  const kcac06FromExcel = line.kcac06FromExcel
  const kcac06Explicit =
    !useNullLossAndTotal &&
    kcac06FromExcel !== undefined &&
    kcac06FromExcel !== null &&
    String(kcac06FromExcel).replace(/,/g, '').trim() !== ''
  const kcac06Ins = useNullLossAndTotal
    ? null
    : kcac06Explicit
      ? bomPartRoundDecimal6(kcac06FromExcel)
      : bomPartComputeKcac06(kcac04, kcac05 ?? 0)
  const nullPrices = line.nullPrices === true
  const costNum = nullPrices ? null : bomPartParseDecimalOrNull(line?.cost_price)
  const saleNum = nullPrices ? null : bomPartParseDecimalOrNull(line?.sale_price)
  const seqIns = bomPartParseSeq(line.seq)
  const remark = line.remark != null ? String(line.remark) : ''

  const subIns = await bomPartsLookupSubBomSystemcode(tx, kcaa01)
  const q = new sql.Request(tx)
  q.input('kcac01', sql.NVarChar(100), parentSystemcode)
  q.input('kcaa01', sql.NVarChar(300), kcaa01)
  q.input('kcaa02', sql.NVarChar(500), line.kcaa02 != null ? String(line.kcaa02) : '')
  q.input('kcaa03', sql.NVarChar(500), line.kcaa03 != null ? String(line.kcaa03) : '')
  q.input('kcaa04', sql.NVarChar(100), line.kcaa04 != null ? String(line.kcaa04) : '')
  q.input('kcaa11', sql.NVarChar(200), line.kcaa11 != null ? String(line.kcaa11) : '')
  q.input('kcac04', sql.Decimal(18, 6), kcac04)
  q.input('kcac05', sql.Decimal(18, 6), kcac05 === null ? null : kcac05)
  q.input('cost_price', sql.Decimal(18, 6), costNum)
  q.input('remark', sql.NVarChar(500), remark)
  q.input('seq', sql.Int, seqIns)
  const delValSql = delColKind === 'numeric' ? '@delIns' : `N'0'`
  if (delColKind === 'numeric') {
    q.input('delIns', sql.Int, 0)
  }

  let insCols =
    'kcac01, kcaa01, kcaa02, kcaa03, kcaa04, kcaa11, kcac04, kcac05, cost_price, remark, del, [Seq]'
  let insVals = `@kcac01, @kcaa01, @kcaa02, @kcaa03, @kcaa04, @kcaa11, @kcac04, @kcac05, @cost_price, @remark, ${delValSql}, @seq`
  if (partColset.has('kcac06')) {
    q.input('kcac06', sql.Decimal(18, 6), kcac06Ins === null ? null : kcac06Ins)
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

  if (partColset.has('type')) {
    let typeIns = 1
    if (line && Object.prototype.hasOwnProperty.call(line, 'type')) {
      const nt = Number(line.type)
      if (Number.isFinite(nt)) typeIns = Math.trunc(nt)
    }
    q.input('typeIns', sql.Int, typeIns)
    insCols += ', [type]'
    insVals += ', @typeIns'
  }

  if (partColset.has('sale_price')) {
    q.input('sale_price', sql.Decimal(18, 6), saleNum)
    insCols += ', sale_price'
    insVals += ', @sale_price'
  }

  if (partColset.has('version')) {
    let versionIns = 100
    if (line && Object.prototype.hasOwnProperty.call(line, 'version')) {
      const nv = Number(line.version)
      if (Number.isFinite(nv)) versionIns = Math.trunc(nv)
    }
    q.input('versionIns', sql.Int, versionIns)
    insCols += ', [version]'
    insVals += ', @versionIns'
  }

  if (partColset.has('pass')) {
    if (passColKind === 'numeric') {
      q.input('pp_pass_ins', sql.Int, 1)
      insCols += ', pass'
      insVals += ', @pp_pass_ins'
    } else {
      insCols += ', pass'
      insVals += `, N'${PAPER_PATTERN_BOM_PARTS_PASS_DEFAULT}'`
    }
  }

  if (audit) {
    const merged = appendBomPartsPaperPatternAuditColumns(partColset, q, insCols, insVals, audit)
    insCols = merged.insCols
    insVals = merged.insVals
  }

  const ir = await q.query(`
    INSERT INTO ${INV_BOM_PARTS_FROM} (${insCols})
    OUTPUT INSERTED.id AS inserted_id
    VALUES (${insVals})
  `)
  const newId = Number(ir.recordset?.[0]?.inserted_id)
  if (!Number.isFinite(newId) || newId < 1) {
    throw new Error('Bom_parts 新增失败：未取得 INSERTED.id')
  }

  await bomPartsApplyFullLineUpdate(tx, partColset, parentSystemcode, newId, {
    kcaa01,
    kcaa02: line.kcaa02 != null ? String(line.kcaa02) : '',
    kcaa03: line.kcaa03 != null ? String(line.kcaa03) : '',
    kcaa04: line.kcaa04 != null ? String(line.kcaa04) : '',
    kcaa11: line.kcaa11 != null ? String(line.kcaa11) : '',
    kcac04,
    kcac05: useNullLossAndTotal ? null : kcac05,
    kcac06: useNullLossAndTotal ? null : kcac06Ins,
    cost_price: costNum,
    sale_price: saleNum,
    remark,
    seq: seqIns,
  })

  const kcaa04Master = line.kcac03FromMaster != null ? String(line.kcac03FromMaster).trim() : ''
  if (partColset.has('kcac03') && kcaa04Master) {
    const u3 = new sql.Request(tx)
    u3.input('id', sql.Int, newId)
    u3.input('kcac01p', sql.NVarChar(100), parentSystemcode)
    u3.input('kc3', sql.NVarChar(300), kcaa04Master)
    await u3.query(`
      UPDATE p
      SET p.kcac03 = @kc3
      FROM ${INV_BOM_PARTS_FROM} AS p
      WHERE p.id = @id
        AND LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(p.kcac01, N'')))) =
            LTRIM(RTRIM(CONVERT(nvarchar(100), @kcac01p)))
    `)
  }

  if (partColset.has('describe') && line.describe !== undefined && line.describe !== null) {
    const ud = new sql.Request(tx)
    ud.input('id', sql.Int, newId)
    ud.input('kcac01p', sql.NVarChar(100), parentSystemcode)
    ud.input('dsc', sql.NVarChar(500), String(line.describe))
    await ud.query(`
      UPDATE p
      SET p.[Describe] = @dsc
      FROM ${INV_BOM_PARTS_FROM} AS p
      WHERE p.id = @id
        AND LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(p.kcac01, N'')))) =
            LTRIM(RTRIM(CONVERT(nvarchar(100), @kcac01p)))
    `)
  }

  // 辅料：从 Bom_000 抄 kcaa02_en、location 至 Bom_parts 同名列（列存在且调用方传入时）
  const copyKcaa02En = Object.prototype.hasOwnProperty.call(line, 'kcaa02EnFromBom000')
  const copyLoc = Object.prototype.hasOwnProperty.call(line, 'locationFromBom000')
  if ((copyKcaa02En && partColset.has('kcaa02_en')) || (copyLoc && partColset.has('location'))) {
    const ux = new sql.Request(tx)
    ux.input('id', sql.Int, newId)
    ux.input('kcac01p', sql.NVarChar(100), parentSystemcode)
    const sets = []
    if (copyKcaa02En && partColset.has('kcaa02_en')) {
      ux.input('k02en', sql.NVarChar(500), String(line.kcaa02EnFromBom000 ?? ''))
      sets.push('p.kcaa02_en = @k02en')
    }
    if (copyLoc && partColset.has('location')) {
      ux.input('loc', sql.NVarChar(200), String(line.locationFromBom000 ?? ''))
      sets.push('p.location = @loc')
    }
    if (sets.length) {
      await ux.query(`
        UPDATE p
        SET ${sets.join(', ')}
        FROM ${INV_BOM_PARTS_FROM} AS p
        WHERE p.id = @id
          AND LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(p.kcac01, N'')))) =
              LTRIM(RTRIM(CONVERT(nvarchar(100), @kcac01p)))
      `)
    }
  }

  const triple = String(subIns || '').trim()
  if (triple && (partColset.has('guid') || partColset.has('dr_systemcode'))) {
    const ug = new sql.Request(tx)
    ug.input('id', sql.Int, newId)
    ug.input('kcac01p', sql.NVarChar(100), parentSystemcode)
    ug.input('trip', sql.NVarChar(100), triple)
    const sets = []
    if (partColset.has('guid')) sets.push('p.[GUID] = @trip')
    if (partColset.has('dr_systemcode')) sets.push('p.dr_systemcode = @trip')
    if (partColset.has('systemcode')) sets.push('p.systemcode = @trip')
    if (sets.length) {
      await ug.query(`
        UPDATE p
        SET ${sets.join(', ')}
        FROM ${INV_BOM_PARTS_FROM} AS p
        WHERE p.id = @id
          AND LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(p.kcac01, N'')))) =
              LTRIM(RTRIM(CONVERT(nvarchar(100), @kcac01p)))
      `)
    }
  }

  return newId
}
