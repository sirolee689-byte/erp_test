/**
 * 纸格资料导入：导入前校验（读 Excel + 映射；不写 bom_000）
 */
import sql from 'mssql'
import { getPool } from './db.js'
import {
  FILE_ID_RE,
  parsePaperPatternExcelForPreview,
  resolveUploadedPaperPatternFile,
} from './paperPatternImportPreview.js'
import {
  ALLOWED,
  fetchPaperPatternMappingFieldToCol,
  PAPER_PATTERN_IMPORT_SYSTEM_FIELDS,
} from './paperPatternImportMapping.js'
import { INV_BOM_MASTER_FROM } from './bomTables.js'

/**
 * @param {import('mssql').ConnectionPool} pool
 * @param {string[]} codes 已 trim 的非空编号
 * @returns {Promise<Set<string>>}
 */
async function fetchExistingKcaa01Set(pool, codes) {
  const out = new Set()
  const uniq = [...new Set(codes.filter(Boolean))]
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
      SELECT LTRIM(RTRIM(CONVERT(nvarchar(300), ISNULL(b.kcaa01, N'')))) AS kcaa01
      FROM ${INV_BOM_MASTER_FROM} AS b
      WHERE (ISNULL(b.del, N'') = N'' OR LTRIM(RTRIM(ISNULL(CONVERT(nvarchar(20), b.del), N''))) = N'0')
        AND LTRIM(RTRIM(CONVERT(nvarchar(300), ISNULL(b.kcaa01, N'')))) IN (${inList})
    `)
    for (const r of rs.recordset || []) {
      const k = String(r.kcaa01 ?? '').trim()
      if (k) out.add(k)
    }
  }
  return out
}

/**
 * @param {{ cells: { colIndex: number, value: string }[] }} row
 * @param {number} colIndex
 */
function cellAt(row, colIndex) {
  const c = (row.cells || []).find((x) => Number(x.colIndex) === Number(colIndex))
  return c ? String(c.value ?? '') : ''
}

/**
 * GET /api/paper-pattern/import/validate?fileId=
 */
export async function handlePaperPatternImportValidateGet(req, res) {
  try {
    const fileId = String(req.query?.fileId ?? '').trim()
    if (!fileId || !FILE_ID_RE.test(fileId)) {
      res.status(400).json({ success: false, message: '缺少或非法参数 fileId' })
      return
    }
    const fp = resolveUploadedPaperPatternFile(fileId)
    if (!fp) {
      res.status(404).json({ success: false, message: '文件不存在' })
      return
    }

    const pool = await getPool()
    const fieldToCol = await fetchPaperPatternMappingFieldToCol(pool, fileId)
    if (!fieldToCol.has('kcaa01') || !fieldToCol.has('kcaa02')) {
      res.status(400).json({
        success: false,
        message: '请先完成字段映射（须映射 kcaa01、kcaa02）',
      })
      return
    }

    const parsed = parsePaperPatternExcelForPreview(fp)
    const excelTotalRows = Number(parsed.totalRows ?? 0)

    /** @type {{ rowIndex: number, data: Record<string, string>, errors: string[] }[]} */
    const rows = []
    for (const prow of parsed.rows || []) {
      if (Number(prow.rowIndex) < 2) continue
      const data = {}
      for (const { field } of PAPER_PATTERN_IMPORT_SYSTEM_FIELDS) {
        if (!ALLOWED.has(field) || !fieldToCol.has(field)) continue
        data[field] = cellAt(prow, fieldToCol.get(field))
      }
      const errors = []
      const k1 = String(data.kcaa01 ?? '').trim()
      const k2 = String(data.kcaa02 ?? '').trim()
      if (!k1) errors.push('编号不能为空')
      if (!k2) errors.push('名称不能为空')
      rows.push({ rowIndex: prow.rowIndex, data, errors })
    }

    const dataRowCount = rows.length

    const kcaa01Count = new Map()
    for (const r of rows) {
      const k = String(r.data.kcaa01 ?? '').trim()
      if (!k) continue
      kcaa01Count.set(k, (kcaa01Count.get(k) || 0) + 1)
    }
    for (const r of rows) {
      const k = String(r.data.kcaa01 ?? '').trim()
      if (k && (kcaa01Count.get(k) || 0) > 1) {
        r.errors.push('编号重复')
      }
    }

    const codesForDb = [...new Set(rows.map((r) => String(r.data.kcaa01 ?? '').trim()).filter(Boolean))]
    const existingDb = await fetchExistingKcaa01Set(pool, codesForDb)
    for (const r of rows) {
      const k = String(r.data.kcaa01 ?? '').trim()
      if (k && existingDb.has(k)) {
        r.errors.push('编号已存在')
      }
    }

    let okCount = 0
    let errorCount = 0
    for (const r of rows) {
      if (r.errors.length) errorCount += 1
      else okCount += 1
    }

    res.json({
      success: true,
      fileId,
      excelTotalRows,
      dataRowCount,
      okCount,
      errorCount,
      rows,
    })
  } catch (e) {
    console.error('GET /api/paper-pattern/import/validate 失败：', e)
    res.status(500).json({ success: false, message: '校验失败' })
  }
}
