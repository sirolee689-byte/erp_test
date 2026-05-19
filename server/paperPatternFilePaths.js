/**
 * 纸格 Excel 上传/下载磁盘路径（.env 可配置；本地测试默认同一 upload 目录）
 */
import fs from 'node:fs'
import path from 'node:path'

/** 本地测试默认目录（与定稿一致；上线请在 .env 覆盖） */
export const PAPER_PATTERN_FILE_PATH_DEFAULT =
  'C:\\Users\\it_manager\\Desktop\\纸格测试资料\\upload'

export function getPaperPatternUploadDir() {
  const raw = String(process.env.PAPER_PATTERN_UPLOAD_DIR ?? '').trim()
  return raw || PAPER_PATTERN_FILE_PATH_DEFAULT
}

export function getPaperPatternDownloadRoot() {
  const raw = String(process.env.PAPER_PATTERN_DOWNLOAD_ROOT ?? '').trim()
  return raw || PAPER_PATTERN_FILE_PATH_DEFAULT
}

/**
 * 确保上传目录存在
 * @returns {string} 绝对路径
 */
export function ensurePaperPatternUploadDir() {
  const dir = path.resolve(getPaperPatternUploadDir())
  try {
    fs.mkdirSync(dir, { recursive: true })
  } catch (e) {
    console.error('创建纸格上传目录失败：', e)
  }
  return dir
}

/**
 * 将 System_uplod_file.filepath / filename 解析为可读绝对路径（防目录穿越）
 * @param {string} filepathRaw
 * @param {string} filenameRaw
 * @returns {string|null}
 */
export function resolvePaperPatternDownloadAbsolutePath(filepathRaw, filenameRaw) {
  const root = path.resolve(getPaperPatternDownloadRoot())
  const rootLower = root.toLowerCase()
  const candidates = []

  for (const raw of [filepathRaw, filenameRaw]) {
    const s = String(raw ?? '').trim()
    if (!s) continue
    const normalized = s.replace(/\\/g, '/')
    const base = path.basename(normalized)
    if (!base || base === '.' || base === '..') continue
    candidates.push(path.join(root, base))
  }

  for (const candidate of candidates) {
    const resolved = path.resolve(candidate)
    const resolvedLower = resolved.toLowerCase()
    const underRoot =
      resolvedLower === rootLower || resolvedLower.startsWith(`${rootLower}${path.sep}`)
    if (!underRoot) continue
    try {
      if (fs.existsSync(resolved) && fs.statSync(resolved).isFile()) return resolved
    } catch {
      /* 忽略单条探测失败 */
    }
  }
  return null
}
