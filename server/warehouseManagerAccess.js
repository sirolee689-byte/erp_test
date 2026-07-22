/**
 * 出入库选仓：按仓库编码「参管人员」ename（Usercode 分号串）过滤 / 校验。
 * 规则：空 ename 不匹配任何人；匹配须为完整令牌（防 1258 误配 12580）。
 */
import { sql } from './db.js'

const DEFAULT_WAREHOUSE_FROM = 'dbo.[UB_ERP_Stocks_Warehouse]'

export function normalizeWarehouseManagerUsercode(v) {
  return String(v ?? '').trim()
}

/**
 * 纯 JS：ename 分号串是否含完整 usercode 令牌（与 SQL LIKE 口径一致）
 * @param {unknown} ename
 * @param {unknown} usercode
 */
export function enameContainsUsercode(ename, usercode) {
  const code = normalizeWarehouseManagerUsercode(usercode)
  if (!code) return false
  const raw = String(ename ?? '').trim()
  if (!raw) return false
  // 去掉空白后首尾加分号，保证完整令牌匹配
  const normalized = `;${raw.replace(/\s+/g, '')};`
  return normalized.includes(`;${code};`)
}

/**
 * SQL 片段：ename 列是否包含 @paramName 对应账号（参数须另 bind）
 * @param {string} enameExpr 列表达式，如 `[ename]` 或 `w.[ename]`
 * @param {string} [paramName='usercode'] 不含 @
 */
export function sqlWarehouseEnameContainsUsercode(enameExpr, paramName = 'usercode') {
  const p = String(paramName || 'usercode').replace(/^@/, '')
  return `(
    N';' + REPLACE(LTRIM(RTRIM(CONVERT(nvarchar(2000), ISNULL(${enameExpr}, N'')))), N' ', N'') + N';'
    LIKE N'%;' + @${p} + N';%'
  )`
}

/**
 * 校验当前账号是否为指定仓库参管人员（未删除仓 + ename 含完整令牌）
 * @param {import('mssql').ConnectionPool|import('mssql').Transaction} poolOrTx
 * @param {unknown} usercode
 * @param {unknown} warehouseCode
 * @param {{ warehouseFrom?: string }} [opts]
 * @returns {Promise<{ ok: boolean, msg?: string }>}
 */
export async function assertUserManagesWarehouse(poolOrTx, usercode, warehouseCode, opts = {}) {
  const code = normalizeWarehouseManagerUsercode(usercode)
  const wh = normalizeWarehouseManagerUsercode(warehouseCode)
  if (!code) {
    return { ok: false, msg: '无法识别当前操作员，请重新登录后再试' }
  }
  if (!wh) {
    return { ok: false, msg: '请先选择仓库' }
  }

  const warehouseFrom = opts.warehouseFrom || DEFAULT_WAREHOUSE_FROM
  const req = poolOrTx.request()
  req.input('code', sql.NVarChar(200), wh)
  req.input('usercode', sql.NVarChar(50), code)
  const r = await req.query(`
    SELECT TOP (1)
      LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL([code], N'')))) AS code
    FROM ${warehouseFrom}
    WHERE LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL([code], N'')))) = @code
      AND (ISNULL([del], N'') = N'' OR [del] = N'0')
      AND ${sqlWarehouseEnameContainsUsercode('[ename]', 'usercode')}
  `)
  if (!r.recordset?.[0]?.code) {
    return { ok: false, msg: '您不是该仓库的参管人员，无法选用' }
  }
  return { ok: true }
}
