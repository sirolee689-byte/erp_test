/**
 * Express 可信代理配置：
 * - 默认只信任本机回环代理，适配开发环境的 Vite 和同机 Nginx/IIS；
 * - 服务器存在多层代理时，可在 .env 中配置代理层数或明确的地址范围。
 */
export function resolveTrustProxySetting(value) {
  const text = String(value ?? '').trim()
  if (!text) return 'loopback'

  const lower = text.toLowerCase()
  if (['false', 'off', 'no'].includes(lower)) return false
  if (['true', 'on', 'yes'].includes(lower)) return true
  if (/^\d+$/.test(text)) return Number(text)
  return text
}

function normalizeRequestIp(value) {
  const text = String(value ?? '').trim()
  return text.replace(/^::ffff:/i, '')
}

/** @param {import('express').Request} req */
export function getRequestIp(req) {
  // req.ip 已由 Express 按 trust proxy 规则解析，不能绕过它直接信任请求头。
  return normalizeRequestIp(
    req?.ip ||
      req?.socket?.remoteAddress ||
      req?.connection?.remoteAddress ||
      '',
  )
}
