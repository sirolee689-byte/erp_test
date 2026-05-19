/**
 * 与 server/paperPatternUploadFileName.js 规则一致
 * @param {unknown} raw
 * @returns {string}
 */
export function decodePaperPatternUploadFileName(raw) {
  const s = String(raw ?? '').trim()
  if (!s) return ''
  try {
    const bytes = new Uint8Array(s.length)
    for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i) & 0xff
    const decoded = new TextDecoder('utf-8').decode(bytes).trim()
    if (decoded && !decoded.includes('\uFFFD')) return decoded
  } catch {
    /* ignore */
  }
  return s
}
