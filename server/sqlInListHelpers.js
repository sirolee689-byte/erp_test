import { sql } from './db.js'
import { ERP_MAX_PAGE_SIZE } from './erpPagination.js'

function text(v) {
  return String(v ?? '').trim()
}

/** 去重正整数 id；超 ERP_MAX_PAGE_SIZE 时返回 { ok: false } */
export function normalizeIntIds(rawIds, options = {}) {
  const max = Number(options.max ?? ERP_MAX_PAGE_SIZE)
  const source = Array.isArray(rawIds) ? rawIds : String(rawIds ?? '').split(',')
  const ids = [...new Set(source.map((value) => Number(value)).filter((id) => Number.isInteger(id) && id > 0))]
  if (!ids.length) return { ok: true, ids: [] }
  if (ids.length > max) {
    return { ok: false, status: 400, msg: `一次最多查询 ${max} 条记录` }
  }
  return { ok: true, ids }
}

export function bindIntInList(request, prefix, values) {
  const list = [...new Set(values)]
  if (!list.length) return { inSql: 'NULL', list }
  const placeholders = list.map((value, index) => {
    const key = `${prefix}${index}`
    request.input(key, sql.Int, value)
    return `@${key}`
  })
  return { inSql: placeholders.join(', '), list }
}

export function bindNVarCharInList(request, prefix, values, len = 200) {
  const list = [...new Set(values.map(text).filter(Boolean))]
  if (!list.length) return { inSql: 'NULL', list }
  const placeholders = list.map((value, index) => {
    const key = `${prefix}${index}`
    request.input(key, sql.NVarChar(len), value)
    return `@${key}`
  })
  return { inSql: placeholders.join(', '), list }
}

export function groupRowsByKey(rows, keyFn) {
  const map = new Map()
  for (const row of rows ?? []) {
    const key = text(keyFn(row))
    if (!key) continue
    if (!map.has(key)) map.set(key, [])
    map.get(key).push(row)
  }
  return map
}
