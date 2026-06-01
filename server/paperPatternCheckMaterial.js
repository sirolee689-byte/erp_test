/**
 * 纸格导入：ERP 物料编码是否在 Bom_000.kcaa01 存在（只读校验，不写库）
 */
import sql from 'mssql'
import { getPool } from './db.js'
import { erpCodeLookupKey, normalizeErpCodeDisplay } from './paperPatternErpCodeNormalize.js'
import { INV_BOM_MASTER_FROM } from './bomTables.js'

/**
 * @param {import('mssql').ConnectionPool} pool
 * @param {string[]} keys 非空的小写比对键（已去重）
 * @returns {Promise<Set<string>>}
 */
async function fetchExistingErpLookupKeySet(pool, keys) {
  const out = new Set()
  const uniq = [...new Set(keys.filter(Boolean))]
  if (uniq.length === 0) return out

  const chunkSize = 80
  for (let i = 0; i < uniq.length; i += chunkSize) {
    const chunk = uniq.slice(i, i + chunkSize)
    const rq = pool.request()
    const parts = []
    for (let j = 0; j < chunk.length; j++) {
      const pname = `k${j}`
      rq.input(pname, sql.NVarChar(400), chunk[j])
      parts.push(`@${pname}`)
    }
    const inList = parts.join(', ')
    const rs = await rq.query(`
      SELECT LOWER(LTRIM(RTRIM(CONVERT(nvarchar(300), ISNULL(b.kcaa01, N''))))) AS lk
      FROM ${INV_BOM_MASTER_FROM} AS b
      WHERE (ISNULL(b.del, N'') = N'' OR LTRIM(RTRIM(ISNULL(CONVERT(nvarchar(20), b.del), N''))) = N'0')
        AND LOWER(LTRIM(RTRIM(CONVERT(nvarchar(300), ISNULL(b.kcaa01, N''))))) IN (${inList})
    `)
    for (const r of rs.recordset || []) {
      const lk = String(r.lk ?? '').trim()
      if (lk) out.add(lk)
    }
  }
  return out
}

/**
 * 输入编码列表 → 存在 / 不存在（空编码进 failed），与库键集合比对
 * @param {string[]} codes
 * @param {Set<string>} existingLowerKeys Bom_000 在册行的 kcaa01 经 LOWER+LTRIM+RTRIM 后的集合
 * @returns {{ success: string[], failed: string[] }}
 */
export function classifyErpCodesAgainstKeySet(codes, existingLowerKeys) {
  const success = []
  const failed = []
  const seenOk = new Set()
  const seenFail = new Set()

  const items = (codes || []).map((raw) => {
    const display = normalizeErpCodeDisplay(raw)
    const key = erpCodeLookupKey(display)
    return { display, key }
  })

  for (const { display, key } of items) {
    if (!key) {
      if (!seenFail.has('')) {
        seenFail.add('')
        failed.push('')
      }
      continue
    }
    if (existingLowerKeys.has(key)) {
      if (!seenOk.has(display)) {
        seenOk.add(display)
        success.push(display)
      }
    } else {
      if (!seenFail.has(display)) {
        seenFail.add(display)
        failed.push(display)
      }
    }
  }

  return { success, failed }
}

/**
 * 输入编码列表 → 存在 / 不存在（空编码进 failed）
 * @param {import('mssql').ConnectionPool} pool
 * @param {string[]} codes 原始编码（可重复、可含大小写与空白）
 * @returns {Promise<{ success: string[], failed: string[] }>}
 */
export async function classifyErpCodesAgainstBom000(pool, codes) {
  const items = (codes || []).map((raw) => {
    const display = normalizeErpCodeDisplay(raw)
    const key = erpCodeLookupKey(display)
    return { display, key }
  })
  const keysForDb = [...new Set(items.map((x) => x.key).filter(Boolean))]
  const existing = await fetchExistingErpLookupKeySet(pool, keysForDb)
  return classifyErpCodesAgainstKeySet(codes, existing)
}

/**
 * POST /api/paper-pattern/check-material
 * body: { codes: string[] }
 * 返回：{ success: true, check: { success: string[], failed: string[] } }（check.success=已存在编码，check.failed=不存在或空）
 */
export async function handlePostPaperPatternCheckMaterial(req, res) {
  try {
    const raw = req.body?.codes
    const codes = Array.isArray(raw) ? raw.map((x) => String(x ?? '')) : []
    if (codes.length > 2000) {
      res.status(400).json({ success: false, message: '一次最多校验 2000 条编码' })
      return
    }
    const pool = await getPool()
    const check = await classifyErpCodesAgainstBom000(pool, codes)
    res.json({ success: true, check })
  } catch (e) {
    console.error('POST /api/paper-pattern/check-material 失败：', e)
    res.status(500).json({ success: false, message: 'ERP 编码校验失败' })
  }
}
