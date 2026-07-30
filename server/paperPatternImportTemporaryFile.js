/**
 * 纸格导入的未提交 Excel 仅以 UUID 名称暂存；正式导入成功后会改名为时间戳归档文件。
 * 这里的删除和过期清理只处理 UUID 文件，绝不触碰已归档的上传资料。
 */
import fs from 'node:fs'
import path from 'node:path'
import { FILE_ID_RE, resolveUploadedPaperPatternFile } from './paperPatternImportPreview.js'
import { getPaperPatternUploadDir } from './paperPatternFilePaths.js'

export const PAPER_PATTERN_TEMP_FILE_MAX_AGE_MS = 24 * 60 * 60 * 1000

function isPaperPatternTemporaryFilename(name) {
  const parsed = path.parse(String(name ?? ''))
  return FILE_ID_RE.test(parsed.name) && /^\.xlsx?$/i.test(parsed.ext)
}

/** @returns {{ deleted: boolean, filePath: string | null }} */
export function discardPaperPatternTemporaryUpload(fileId) {
  const sourcePath = resolveUploadedPaperPatternFile(fileId)
  if (!sourcePath) return { deleted: false, filePath: null }
  fs.unlinkSync(sourcePath)
  return { deleted: true, filePath: sourcePath }
}

/**
 * 服务启动时回收异常关闭浏览器后遗留的临时文件。
 * @param {{ now?: number, maxAgeMs?: number, uploadDir?: string }} [opts]
 */
export function pruneExpiredPaperPatternTemporaryUploads(opts = {}) {
  const now = Number.isFinite(Number(opts.now)) ? Number(opts.now) : Date.now()
  const maxAgeMs = Number.isFinite(Number(opts.maxAgeMs))
    ? Math.max(0, Number(opts.maxAgeMs))
    : PAPER_PATTERN_TEMP_FILE_MAX_AGE_MS
  const uploadDir = path.resolve(opts.uploadDir || getPaperPatternUploadDir())
  let deletedCount = 0

  let entries
  try {
    entries = fs.readdirSync(uploadDir, { withFileTypes: true })
  } catch (e) {
    if (e?.code === 'ENOENT') return deletedCount
    throw e
  }

  for (const entry of entries) {
    if (!entry.isFile() || !isPaperPatternTemporaryFilename(entry.name)) continue
    const filePath = path.join(uploadDir, entry.name)
    try {
      const stat = fs.statSync(filePath)
      if (now - stat.mtimeMs < maxAgeMs) continue
      fs.unlinkSync(filePath)
      deletedCount += 1
    } catch (e) {
      if (e?.code !== 'ENOENT') {
        console.warn('[paper-pattern-import-temp] 清理过期临时文件失败：', filePath, e)
      }
    }
  }
  return deletedCount
}

/** POST /api/paper-pattern/import/discard-upload */
export function handlePostPaperPatternImportDiscardUpload(req, res) {
  try {
    const fileId = String(req.body?.fileId ?? '').trim()
    if (!FILE_ID_RE.test(fileId)) {
      res.status(400).json({ success: false, message: '临时文件标识无效' })
      return
    }
    const result = discardPaperPatternTemporaryUpload(fileId)
    if (!result.deleted) {
      res.status(404).json({ success: false, message: '临时 Excel 不存在或已归档' })
      return
    }
    res.json({ success: true, message: '已清理未导入的临时 Excel' })
  } catch (e) {
    console.error('POST /api/paper-pattern/import/discard-upload 失败：', e)
    res.status(500).json({ success: false, message: '清理临时 Excel 失败，请稍后重试' })
  }
}
