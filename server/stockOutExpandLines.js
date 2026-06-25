import { sql } from './db.js'

const LINE_FROM = 'dbo.[UB_ERP_Stocks_out_list]'
const COLOR_FROM = 'dbo.[UB_ERP_Stocks_colorcode]'

/** 明细表数值列（物理类型 numeric，禁止在 l.* 后再 AS 同名别名，否则驱动返回数组） */
const LINE_NUMERIC_FIELDS = ['kcaq03', 'kcaq04', 'kcaq041', 'kcaq05', 'kcaq051', 'kcaq08', 'tax', 'Tax']

function text(v) {
  return String(v ?? '').trim()
}

/** 驱动对重复列名会返回数组，取第一个标量 */
export function coerceScalarValue(value) {
  if (Array.isArray(value)) return value.length ? value[0] : null
  return value
}

/** 材料编码 kcaa01 中 / 后的颜色代码（供关联 UB_ERP_Stocks_colorcode.code） */
export function kcaa01ColorCodeExpr(alias = 'l') {
  const mat = `LTRIM(RTRIM(CONVERT(nvarchar(300), ISNULL(${alias}.[kcaa01], N''))))`
  return `CASE
    WHEN CHARINDEX(N'/', ${mat}) > 0
    THEN RIGHT(${mat}, LEN(${mat}) - CHARINDEX(N'/', ${mat}))
    ELSE N''
  END`
}

/** 列表展开明细 SQL：del=0、按 seq 排序，并关联颜色名称（仅 l.* + colorName，勿与 l.* 数值列同名重复） */
export function buildStockOutExpandLinesSql() {
  const colorCodeExpr = kcaa01ColorCodeExpr('l')
  return `
    SELECT
      l.*,
      LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(c.[name], N'')))) AS colorName
    FROM ${LINE_FROM} AS l
    LEFT JOIN ${COLOR_FROM} AS c
      ON LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(c.[code], N'')))) = ${colorCodeExpr}
     AND LTRIM(RTRIM(ISNULL(c.[pass], N''))) = N'1'
     AND (ISNULL(c.[del], N'') = N'' OR c.[del] = N'0')
    WHERE LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(l.[kcaq01], N'')))) = @outboundNo
      AND (ISNULL(l.[del], N'') = N'' OR l.[del] = N'0')
    ORDER BY ISNULL(l.[seq], l.[id]), l.[id]
  `
}

/** 颜色展示：kcaa11 为主，颜色名称括号拼接，如 TM(深啡色) */
export function buildStockOutColorText(kcaa11, colorName) {
  const code = text(kcaa11)
  const name = text(colorName)
  if (code && name) return `${code}(${name})`
  return code || name || ''
}

function serializeValue(value) {
  return value instanceof Date ? value.toISOString() : value
}

function toLineNumber(value) {
  const scalar = coerceScalarValue(value)
  if (scalar == null || scalar === '') return null
  const n = Number(scalar)
  return Number.isFinite(n) ? n : null
}

/** 展开/详情明细行标准化（保留原字段，补充 colorText、tax 等小写映射） */
export function enrichStockOutExpandLine(row = {}) {
  const out = {}
  for (const [key, value] of Object.entries(row)) {
    out[key] = serializeValue(coerceScalarValue(value))
  }
  for (const field of LINE_NUMERIC_FIELDS) {
    const n = toLineNumber(out[field])
    if (n != null) out[field] = n
  }
  const kcaa11 = text(out.kcaa11)
  const colorName = text(out.colorName)
  out.kcaa11 = kcaa11
  out.colorText = buildStockOutColorText(kcaa11, colorName)
  out.tax = toLineNumber(out.tax) ?? toLineNumber(out.Tax) ?? 0
  if (!text(out.reference)) out.reference = text(out.Reference)
  out.Describe = text(out.Describe ?? out.describe)
  out.systemcode = text(out.systemcode)
  return out
}

export async function queryStockOutExpandLines(pool, outboundNo) {
  const no = text(outboundNo)
  if (!no) return []
  const r = await pool.request().input('outboundNo', sql.NVarChar(200), no).query(buildStockOutExpandLinesSql())
  return (r.recordset ?? []).map(enrichStockOutExpandLine)
}
