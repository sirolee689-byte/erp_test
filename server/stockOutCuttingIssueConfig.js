/**
 * 开料出库配置：材料分类 UB_ERP_Stocks_material.cutting_issue 开关（超级管理员维护）。
 */
import { sql } from './db.js'
import { nvarcharTextExpr } from './buyOrderSqlSafe.js'

const MATERIAL_CAT_FROM = 'dbo.[UB_ERP_Stocks_material]'

const MISSING_COLUMN_MSG =
  '材料分类表缺少 cutting_issue 字段，请先执行 scripts/migrations/sqlserver_stock_out_cutting_issue_flag.txt 迁移脚本后再使用开料出库配置。'

function text(v) {
  return String(v ?? '').trim()
}

/** @param {import('mssql').ConnectionPool} pool */
async function fetchMaterialColumnSet(pool) {
  const r = await pool.request().query(`
    SELECT LOWER(LTRIM(RTRIM(COLUMN_NAME))) AS col
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_NAME = N'UB_ERP_Stocks_material'
  `)
  return new Set((r.recordset ?? []).map((row) => text(row.col).toLowerCase()).filter(Boolean))
}

export async function hasCuttingIssueColumn(pool) {
  const cols = await fetchMaterialColumnSet(pool)
  return cols.has('cutting_issue')
}

/**
 * 读取已审未删材料分类及开料开关。
 * @param {import('mssql').ConnectionPool} pool
 */
export async function fetchCuttingIssueConfig(pool) {
  try {
    if (!(await hasCuttingIssueColumn(pool))) {
      return { ok: false, status: 503, msg: MISSING_COLUMN_MSG }
    }
    const r = await pool.request().query(`
      SELECT
        m.[id],
        LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(m.[code], N'')))) AS code,
        LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(m.[name], N'')))) AS name,
        LTRIM(RTRIM(CONVERT(nvarchar(20), ISNULL(m.[cutting_issue], N'0')))) AS cutting_issue
      FROM ${MATERIAL_CAT_FROM} AS m
      WHERE (ISNULL(m.[del], N'') = N'' OR m.[del] = N'0')
        AND ${nvarcharTextExpr('m', 'pass', 20)} = N'1'
      ORDER BY m.[id] DESC
    `)
    const list = (r.recordset ?? []).map((row) => ({
      id: Number(row.id) || 0,
      code: text(row.code),
      name: text(row.name),
      cutting_issue: text(row.cutting_issue) === '1' ? '1' : '0',
    }))
    return { ok: true, list }
  } catch (err) {
    return { ok: false, status: 500, msg: `读取开料出库配置失败：${String(err?.message ?? err)}` }
  }
}

/**
 * 批量更新开料开关（须超级管理员，门禁在 handler）。
 * @param {import('mssql').ConnectionPool} pool
 * @param {{ items?: Array<{ id?: number, cutting_issue?: string }> }} body
 */
export async function updateCuttingIssueConfig(pool, body = {}) {
  try {
    if (!(await hasCuttingIssueColumn(pool))) {
      return { ok: false, status: 503, msg: MISSING_COLUMN_MSG }
    }
    const items = Array.isArray(body.items) ? body.items : []
    if (!items.length) return { ok: false, status: 400, msg: '请至少提交一条分类配置' }

    let updated = 0
    for (const item of items) {
      const id = Number(item?.id)
      if (!Number.isInteger(id) || id <= 0) continue
      const flag = text(item?.cutting_issue) === '1' ? '1' : '0'
      const r = await pool.request()
        .input('id', sql.Int, id)
        .input('cutting_issue', sql.NVarChar(20), flag)
        .query(`
          UPDATE ${MATERIAL_CAT_FROM}
          SET [cutting_issue] = @cutting_issue
          WHERE [id] = @id
            AND (ISNULL([del], N'') = N'' OR [del] = N'0')
            AND LTRIM(RTRIM(ISNULL(CONVERT(nvarchar(20), [pass]), N''))) = N'1'
        `)
      updated += Number(r.rowsAffected?.[0] ?? 0)
    }
    return { ok: true, updated, msg: `已更新 ${updated} 条材料分类开料开关` }
  } catch (err) {
    return { ok: false, status: 500, msg: `保存开料出库配置失败：${String(err?.message ?? err)}` }
  }
}

/**
 * 开料批量：读取 cutting_issue=1 的分类编码列表。
 * @param {import('mssql').ConnectionPool} pool
 */
export async function fetchCuttingIssueCategoryCodes(pool) {
  if (!(await hasCuttingIssueColumn(pool))) return []
  const r = await pool.request().query(`
    SELECT LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(m.[code], N'')))) AS code
    FROM ${MATERIAL_CAT_FROM} AS m
    WHERE (ISNULL(m.[del], N'') = N'' OR m.[del] = N'0')
      AND ${nvarcharTextExpr('m', 'pass', 20)} = N'1'
      AND LTRIM(RTRIM(ISNULL(CONVERT(nvarchar(20), m.[cutting_issue]), N'0'))) = N'1'
      AND LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(m.[code], N'')))) <> N''
  `)
  return [...new Set((r.recordset ?? []).map((row) => text(row.code)).filter(Boolean))]
}
