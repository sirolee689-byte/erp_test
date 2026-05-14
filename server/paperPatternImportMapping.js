/**
 * 纸格资料导入：列字段映射（读/写 paper_pattern_import_mapping）
 */
import sql from 'mssql'
import { getPool } from './db.js'
import { FILE_ID_RE, resolveUploadedPaperPatternFile } from './paperPatternImportPreview.js'

const TABLE = '[dbo].[paper_pattern_import_mapping]'

/** 当前阶段固定可选系统字段 */
export const PAPER_PATTERN_IMPORT_SYSTEM_FIELDS = [
  { field: 'kcaa01', label: '纸格编号' },
  { field: 'kcaa02', label: '纸格名称' },
  { field: 'kcaa06', label: '规格' },
  { field: 'kcaa09', label: '单位' },
  { field: 'kcaa10', label: '备注' },
  { field: 'kcaa11', label: '分类' },
]

export const ALLOWED = new Set(PAPER_PATTERN_IMPORT_SYSTEM_FIELDS.map((x) => x.field))

/**
 * 读取某次上传的「字段 → Excel 列号」映射（仅已保存的映射行）
 * @param {import('mssql').ConnectionPool} pool
 * @param {string} fileId
 * @returns {Promise<Map<string, number>>} fieldName -> colIndex(1-based)
 */
export async function fetchPaperPatternMappingFieldToCol(pool, fileId) {
  const rq = pool.request()
  rq.input('fid', sql.NVarChar(36), String(fileId ?? '').trim())
  const rs = await rq.query(`
    SELECT col_index AS colIndex, field_name AS field
    FROM ${TABLE}
    WHERE file_id = @fid
    ORDER BY col_index ASC
  `)
  const map = new Map()
  for (const r of rs.recordset || []) {
    const f = String(r.field ?? '').trim()
    const ci = Number(r.colIndex)
    if (f && Number.isFinite(ci)) map.set(f, ci)
  }
  return map
}
export async function handleGetPaperPatternMapping(req, res) {
  try {
    const fileId = String(req.query?.fileId ?? '').trim()
    if (!fileId || !FILE_ID_RE.test(fileId)) {
      res.status(400).json({ success: false, message: '缺少或非法参数 fileId' })
      return
    }
    const pool = await getPool()
    const rq = pool.request()
    rq.input('fid', sql.NVarChar(36), fileId)
    const rs = await rq.query(`
      SELECT col_index AS colIndex, field_name AS field
      FROM ${TABLE}
      WHERE file_id = @fid
      ORDER BY col_index ASC
    `)
    const mapping = (rs.recordset || []).map((r) => ({
      colIndex: Number(r.colIndex),
      field: String(r.field ?? '').trim(),
    }))
    res.json({ success: true, fileId, mapping })
  } catch (e) {
    console.error('GET /api/paper-pattern/import/mapping 失败：', e)
    res.status(500).json({ success: false, message: '读取映射失败' })
  }
}

/**
 * POST /api/paper-pattern/import/save-mapping
 * body: { fileId, mapping: [{ colIndex, field }] }
 */
export async function handleSavePaperPatternMapping(req, res) {
  try {
    const fileId = String(req.body?.fileId ?? '').trim()
    if (!fileId || !FILE_ID_RE.test(fileId)) {
      res.status(400).json({ success: false, message: '缺少或非法参数 fileId' })
      return
    }
    if (!resolveUploadedPaperPatternFile(fileId)) {
      res.status(404).json({ success: false, message: '文件不存在' })
      return
    }
    const raw = req.body?.mapping
    if (!Array.isArray(raw)) {
      res.status(400).json({ success: false, message: 'mapping 须为数组' })
      return
    }

    /** @type {{ colIndex: number, field: string }[]} */
    const normalized = []
    const seenCol = new Set()
    const seenField = new Set()

    for (const item of raw) {
      const colIndex = Number(item?.colIndex)
      const field = String(item?.field ?? '').trim()
      if (!Number.isFinite(colIndex) || colIndex < 1 || colIndex > 16384) {
        res.status(400).json({ success: false, message: `非法列号：${item?.colIndex}` })
        return
      }
      if (seenCol.has(colIndex)) {
        res.status(400).json({ success: false, message: `重复列号：${colIndex}` })
        return
      }
      seenCol.add(colIndex)
      if (!field) continue
      if (!ALLOWED.has(field)) {
        res.status(400).json({ success: false, message: `非法系统字段：${field}` })
        return
      }
      if (seenField.has(field)) {
        res.status(400).json({ success: false, message: `系统字段不可重复选择：${field}` })
        return
      }
      seenField.add(field)
      normalized.push({ colIndex, field })
    }

    const pool = await getPool()
    const tx = new sql.Transaction(pool)
    try {
      await tx.begin()
      const del = new sql.Request(tx)
      del.input('fid', sql.NVarChar(36), fileId)
      await del.query(`DELETE FROM ${TABLE} WHERE file_id = @fid`)

      for (const row of normalized) {
        const ins = new sql.Request(tx)
        ins.input('fid', sql.NVarChar(36), fileId)
        ins.input('ci', sql.Int, row.colIndex)
        ins.input('fn', sql.NVarChar(32), row.field)
        await ins.query(`
          INSERT INTO ${TABLE} (file_id, col_index, field_name)
          VALUES (@fid, @ci, @fn)
        `)
      }
      await tx.commit()
    } catch (e) {
      try {
        await tx.rollback()
      } catch (_) {
        /* ignore */
      }
      throw e
    }

    res.json({ success: true, fileId })
  } catch (e) {
    console.error('POST /api/paper-pattern/import/save-mapping 失败：', e)
    res.status(500).json({ success: false, message: '保存映射失败' })
  }
}
