/**
 * 主表「供应商/外协商」kehu 与 System_supplier.s_name 一致时，解析 s_code 写入主表编码列（如 cgaa04、wxaa04）
 */
import { sql } from './db.js'

const SYS_SUPPLIER_FROM = 'dbo.[System_supplier]'

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
  return String(v).trim()
}

/**
 * 与供应商下拉一致：在册、已审、按 s_name 精确匹配
 * @param {import('mssql').ConnectionPool} pool
 * @param {string} sName
 */
export async function lookupSupplierSCodeBySName(pool, sName) {
  const n = cellStr(sName)
  if (!n) return ''
  const r = await pool
    .request()
    .input('pass', sql.NVarChar(10), '1')
    .input('name', sql.NVarChar(500), n)
    .query(`
      SELECT TOP 1
        LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(s.s_code, N'')))) AS s_code
      FROM ${SYS_SUPPLIER_FROM} AS s
      WHERE (ISNULL(s.del, N'') = N'' OR s.del = N'0')
        AND LTRIM(RTRIM(ISNULL(s.pass, N''))) = @pass
        AND LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(s.s_name, N'')))) = @name
      ORDER BY s.id ASC
    `)
  return cellStr(r.recordset?.[0]?.s_code)
}

/**
 * 将 kehu 对应供应商的 s_code 写入主表列（列须存在于 INFORMATION_SCHEMA 元数据中）
 * @param {import('mssql').ConnectionPool} pool
 * @param {{ headerCols: { name: string }[], headerColNames: Set<string> }} meta
 * @param {Record<string, unknown>} headerIn
 * @param {'cgaa04' | 'wxaa04'} supplierCodeColLower
 */
export async function applySupplierCodeColumnFromKehu(pool, meta, headerIn, supplierCodeColLower) {
  if (!meta.headerColNames.has(supplierCodeColLower)) return
  const kehu = cellStr(pickBodyField(headerIn, 'kehu'))
  let sc = ''
  if (kehu) sc = await lookupSupplierSCodeBySName(pool, kehu)
  const cm = meta.headerCols.find((c) => String(c.name).toLowerCase() === supplierCodeColLower)
  if (cm) headerIn[cm.name] = sc
}
