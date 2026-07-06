const PRINT_HEAD_FROM = 'dbo.[UB_ERP_System_Head]'

function text(value) {
  return String(value ?? '').trim()
}

function decodeHtmlValue(value) {
  return text(value)
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
}

export function resolvePrintLogoSrc(value) {
  const raw = decodeHtmlValue(value)
  if (!raw) return ''
  const srcMatch = raw.match(/\bsrc\s*=\s*["']([^"']+)["']/i)
  if (srcMatch?.[1]) return text(srcMatch[1])
  if (/^</.test(raw)) return ''
  return raw
}

export function buildSystemPrintLogoSql() {
  return `
    SELECT TOP (1)
      logo,
      info
    FROM ${PRINT_HEAD_FROM}
    ORDER BY id ASC
  `
}

export async function fetchSystemPrintLogoConfig(pool) {
  const rs = await pool.request().query(buildSystemPrintLogoSql())
  const row = rs.recordset?.[0] ?? {}
  return {
    logoSrc: resolvePrintLogoSrc(row.logo),
    headerHtml: text(row.info),
    info: text(row.info),
  }
}
