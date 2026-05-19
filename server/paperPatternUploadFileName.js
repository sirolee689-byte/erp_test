/**
 * multer 在 Windows 上常将 UTF-8 中文文件名按 latin1 存入 originalname，需还原
 * @param {unknown} raw
 * @returns {string}
 */
export function decodePaperPatternUploadFileName(raw) {
  const s = String(raw ?? '').trim()
  if (!s) return ''
  try {
    const decoded = Buffer.from(s, 'latin1').toString('utf8').trim()
    if (decoded && !decoded.includes('\uFFFD')) return decoded
  } catch {
    /* ignore */
  }
  return s
}
