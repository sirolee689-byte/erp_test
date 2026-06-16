/**
 * 管理纸格导入资料：按 UB_ERP_System_uplod_file.id 下载磁盘 Excel
 */
import fs from 'node:fs'
import path from 'node:path'
import sql from 'mssql'
import { getPool } from './db.js'
import { resolvePaperPatternDownloadAbsolutePath } from './paperPatternFilePaths.js'
import { SYSTEM_UPLOAD_FILE_TABLE } from './paperPatternSystemUploadFile.js'

const FILEPATH_SCOPE_LIKE = '%ub_bom%'

const MIME_BY_EXT = {
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
}

/**
 * Content-Disposition: attachment
 * @param {string} displayName
 */
export function buildContentDispositionAttachment(displayName) {
  const raw = String(displayName ?? 'download').trim() || 'download'
  const asciiFallback =
    raw
      .replace(/["\\]/g, '_')
      .replace(/[^\x20-\x7e]/g, '_')
      .slice(0, 180) || 'download'
  const encoded = encodeURIComponent(raw).replace(/['()*]/g, (c) =>
    `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  )
  return `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encoded}`
}

/**
 * 下载保存名：优先库字段 filename（时间戳，如 20260519155801.xls），不用 truefilename
 * @param {string} filepath
 * @param {string} filename
 */
export function pickPaperPatternDownloadDisplayName(filepath, filename) {
  const fn = String(filename ?? '').trim()
  if (fn) return path.basename(fn)
  const fp = String(filepath ?? '').trim()
  if (fp) return path.basename(fp.replace(/\\/g, '/'))
  return 'download.xls'
}

/**
 * GET /api/paper-pattern/import/files/download?id=
 */
export async function handleGetPaperPatternImportFileDownload(req, res) {
  try {
    const id = Number(req.query?.id ?? 0)
    if (!Number.isFinite(id) || id <= 0) {
      res.status(400).json({ code: 400, msg: '缺少有效的文件 id', data: null })
      return
    }

    const pool = await getPool()
    const rowReq = pool.request()
    rowReq.input('id', sql.Int, id)
    rowReq.input('scopeLike', sql.NVarChar(200), FILEPATH_SCOPE_LIKE.toLowerCase())
    const rowResult = await rowReq.query(`
      SELECT TOP 1
        f.id,
        LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(f.filename, N'')))) AS filename,
        LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(f.filepath, N'')))) AS filepath,
        LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(f.truefilename, N'')))) AS truefilename
      FROM ${SYSTEM_UPLOAD_FILE_TABLE} AS f
      WHERE f.id = @id
        AND LOWER(LTRIM(RTRIM(CONVERT(nvarchar(max), ISNULL(f.filepath, N''))))) LIKE @scopeLike
    `)
    const row = rowResult.recordset?.[0]
    if (!row) {
      res.status(404).json({ code: 404, msg: '记录不存在或不在纸格资料范围内', data: null })
      return
    }

    const absolutePath = resolvePaperPatternDownloadAbsolutePath(row.filepath, row.filename)
    if (!absolutePath) {
      res.status(404).json({
        code: 404,
        msg: '服务器上未找到该文件，请确认 PAPER_PATTERN_DOWNLOAD_ROOT 配置与磁盘文件一致',
        data: null,
      })
      return
    }

    const displayName = pickPaperPatternDownloadDisplayName(row.filepath, row.filename)
    const ext = path.extname(absolutePath).toLowerCase()
    const contentType = MIME_BY_EXT[ext] || 'application/octet-stream'

    res.setHeader('Content-Type', contentType)
    res.setHeader('Content-Disposition', buildContentDispositionAttachment(displayName))
    try {
      const st = fs.statSync(absolutePath)
      if (st.isFile() && st.size >= 0) {
        res.setHeader('Content-Length', String(st.size))
      }
    } catch {
      /* 忽略 */
    }

    res.sendFile(absolutePath, (err) => {
      if (err && !res.headersSent) {
        console.error('GET /api/paper-pattern/import/files/download sendFile 失败：', err)
        res.status(500).json({ code: 500, msg: '发送文件失败', data: null })
      } else if (err) {
        console.error('GET /api/paper-pattern/import/files/download sendFile 失败：', err)
      }
    })
  } catch (err) {
    console.error('GET /api/paper-pattern/import/files/download 失败：', err)
    const detail = String(err?.message ?? err?.originalError?.message ?? '下载失败')
    if (!res.headersSent) {
      res.status(500).json({ code: 500, msg: `下载失败：${detail}`, data: null })
    }
  }
}
