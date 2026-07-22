/**
 * 海关单 · 纯函数：PI 规范化、成品编码、出货日→入库日、分组键
 * SQL Server 2008 R2 无关；供 preview/generate 与单测共用。
 */

export function text(v) {
  return String(v ?? '').trim()
}

export function toNumber(v) {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

export function roundQty(n, p = 4) {
  const m = 10 ** p
  return Math.round((toNumber(n) + Number.EPSILON) * m) / m
}

/** Excel PI4106 / PI-4106 / PI4106A → 规范形 PI-4106 / PI-4106A */
export function normalizeExcelPi(raw) {
  const s = text(raw).toUpperCase().replace(/\s/g, '')
  if (!s) return ''
  const m = s.match(/^PI-?(\d+)([A-Z]*)$/i)
  if (!m) return s
  return `PI-${m[1]}${m[2] || ''}`
}

/**
 * 销售明细检索前缀：无字母后缀时用 PI-4106 做 LIKE 'PI-4106%'；
 * 已有后缀则精确匹配。
 */
export function excelPiMatchMode(raw) {
  const normalized = normalizeExcelPi(raw)
  const m = normalized.match(/^PI-(\d+)([A-Z]*)$/i)
  if (!m) return { mode: 'exact', value: normalized }
  if (m[2]) return { mode: 'exact', value: normalized }
  return { mode: 'prefix', value: `PI-${m[1]}` }
}

/** 客款号以 OUT 开头（忽略大小写）→ 拼编码时追加 -OUT */
export function isOutCustomerStyle(customerStyleNo) {
  return text(customerStyleNo).toUpperCase().startsWith('OUT')
}

/**
 * 厂款号 + 颜色 → 成品编码；客款号 OUT 开头时为 厂款号/颜色-OUT
 * @example buildMaterialCode('PQ-3689A1', '14') → 'PQ-3689A1/14'
 * @example buildMaterialCode('PQ-2284A1', 'BLU', 'OUTCA1358VI') → 'PQ-2284A1/BLU-OUT'
 */
export function buildMaterialCode(factoryStyleNo, color, customerStyleNo) {
  const style = text(factoryStyleNo)
  const c = text(color)
  if (!style || !c) return ''
  if (isOutCustomerStyle(customerStyleNo)) return `${style}/${c}-OUT`
  return `${style}/${c}`
}

/** 去掉连字符，便于厂款号松匹配 */
export function stripHyphens(s) {
  return text(s).replace(/-/g, '').toUpperCase()
}

/** 成品编码 `/` 前的厂款段 */
export function materialStylePrefix(kcaa01) {
  const d = text(kcaa01)
  const slash = d.indexOf('/')
  return (slash >= 0 ? d.slice(0, slash) : d).trim()
}

/** 成品编码 `/` 后的颜色段（含 -OUT） */
export function materialColorSegment(kcaa01) {
  const d = text(kcaa01)
  const slash = d.lastIndexOf('/')
  return slash >= 0 ? d.slice(slash + 1).trim() : ''
}

/**
 * 去连字符后任一方包含另一方（ATG-PQ3490A1 ↔ PQ-3490A1）
 */
export function styleLooseContains(excelFactoryStyle, erpStylePrefix) {
  const a = stripHyphens(excelFactoryStyle)
  const b = stripHyphens(erpStylePrefix)
  if (!a || !b) return false
  return a.includes(b) || b.includes(a)
}

/**
 * 唯一明细放宽：厂款松匹配 + 颜色段全等（忽略大小写）
 */
export function softMatchFactoryColor(factoryStyleNo, color, kcaa01) {
  if (!text(kcaa01)) return false
  if (!styleLooseContains(factoryStyleNo, materialStylePrefix(kcaa01))) return false
  return text(color).toUpperCase() === materialColorSegment(kcaa01).toUpperCase()
}

/**
 * 解析出货日期：支持 2026-03-11、2026/03/11、20260311
 * @returns {string|null} YYYY-MM-DD
 */
export function parseShipDate(raw) {
  const s = text(raw)
  if (!s) return null
  if (/^\d{8}$/.test(s)) {
    const y = Number(s.slice(0, 4))
    const mo = Number(s.slice(4, 6))
    const d = Number(s.slice(6, 8))
    if (!isValidYmd(y, mo, d)) return null
    return `${y}-${pad2(mo)}-${pad2(d)}`
  }
  const m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/)
  if (m) {
    const y = Number(m[1])
    const mo = Number(m[2])
    const d = Number(m[3])
    if (!isValidYmd(y, mo, d)) return null
    return `${y}-${pad2(mo)}-${pad2(d)}`
  }
  const dt = new Date(s)
  if (Number.isNaN(dt.getTime())) return null
  return `${dt.getFullYear()}-${pad2(dt.getMonth() + 1)}-${pad2(dt.getDate())}`
}

function pad2(n) {
  return String(n).padStart(2, '0')
}

function isValidYmd(y, mo, d) {
  if (!Number.isInteger(y) || !Number.isInteger(mo) || !Number.isInteger(d)) return false
  if (y < 1990 || y > 2100 || mo < 1 || mo > 12 || d < 1 || d > 31) return false
  const dt = new Date(y, mo - 1, d)
  return dt.getFullYear() === y && dt.getMonth() === mo - 1 && dt.getDate() === d
}

/** 出货日减 days 天 → YYYY-MM-DD */
export function defaultInboundDateFromShip(shipYmd, days = 3) {
  const ship = parseShipDate(shipYmd)
  if (!ship) return null
  const [y, mo, d] = ship.split('-').map(Number)
  const dt = new Date(y, mo - 1, d)
  dt.setDate(dt.getDate() - Number(days))
  return `${dt.getFullYear()}-${pad2(dt.getMonth() + 1)}-${pad2(dt.getDate())}`
}

export function buildGroupKey(formalPi, inboundDate, dispatchOrderNo) {
  return `${text(formalPi)}|${text(inboundDate)}|${text(dispatchOrderNo)}`
}

/** 出库拆单：正式 PI + 出货日期 + 派工单号 */
export function buildOutboundGroupKey(formalPi, shipDate, dispatchOrderNo) {
  return `${text(formalPi)}|${text(shipDate)}|${text(dispatchOrderNo)}`
}

/**
 * 申报量相对可入余量：截断或失败
 * @returns {{ ok: boolean, inboundQty: number, truncated: boolean, reason?: string }}
 */
export function resolveInboundQtyAgainstTempx(declareQty, tempx) {
  const declare = roundQty(declareQty)
  const avail = roundQty(tempx)
  if (declare <= 0) {
    return { ok: false, inboundQty: 0, truncated: false, reason: '申报数量必须大于 0' }
  }
  if (avail <= 0) {
    return { ok: false, inboundQty: 0, truncated: false, reason: `可入余量为 ${avail}，无法入库` }
  }
  if (declare > avail) {
    return { ok: true, inboundQty: avail, truncated: true, reason: `申报 ${declare} 超过可入 ${avail}，已截断` }
  }
  return { ok: true, inboundQty: declare, truncated: false }
}

/** 同组内多行消耗同一 scak02 余量时，按行序扣减 */
export function allocateTempxAcrossLines(lines, getTempx) {
  const remaining = new Map()
  const out = []
  for (const line of lines) {
    const key = text(line.kcao02 || line.scak02)
    if (!remaining.has(key)) remaining.set(key, roundQty(getTempx(line)))
    const left = remaining.get(key)
    const resolved = resolveInboundQtyAgainstTempx(line.declareQty ?? line.kcao03, left)
    if (resolved.ok) {
      remaining.set(key, roundQty(left - resolved.inboundQty))
    }
    out.push({ ...line, ...resolved, tempxBefore: left })
  }
  return out
}

export function joinCustomsNos(nos = []) {
  return [...new Set((nos ?? []).map((x) => text(x)).filter(Boolean))].join('；')
}

/** 本批入库成功行 → 同编码待入数量合计（预览出库时计入成品仓可用量） */
export function buildPendingInboundByMaterial(successLines) {
  /** @type {Map<string, number>} */
  const map = new Map()
  for (const line of successLines ?? []) {
    const k = text(line.kcaa01)
    if (!k) continue
    map.set(k, roundQty((map.get(k) ?? 0) + toNumber(line.inboundQty)))
  }
  return map
}

/**
 * 成品仓可用量 = 仓内 actual + 本批待入；按编码维护剩余量供行序扣减
 * @param {Map<string, number>} stockActualByMaterial
 * @param {Map<string, number>} pendingInboundByMaterial
 */
export function initWarehouseRemaining(stockActualByMaterial, pendingInboundByMaterial) {
  /** @type {Map<string, number>} */
  const remaining = new Map()
  const keys = new Set([
    ...(stockActualByMaterial ?? new Map()).keys(),
    ...(pendingInboundByMaterial ?? new Map()).keys(),
  ])
  for (const k of keys) {
    const actual = roundQty(stockActualByMaterial?.get(k) ?? 0)
    const pending = roundQty(pendingInboundByMaterial?.get(k) ?? 0)
    remaining.set(k, roundQty(actual + pending))
  }
  return remaining
}

/**
 * 出库预览：校验成品仓可用量（含本批待入），按行序扣减前检查
 * @returns {{ ok: boolean, available: number, reason?: string }}
 */
export function resolveOutboundQtyAgainstWarehouse(
  outboundQty,
  kcaa01,
  warehouseRemaining,
  pendingInboundByMaterial,
) {
  const need = roundQty(outboundQty)
  const k = text(kcaa01)
  const pending = roundQty(pendingInboundByMaterial?.get(k) ?? 0)
  const left = roundQty(warehouseRemaining?.get(k) ?? 0)
  if (need <= 0) {
    return { ok: false, available: left, reason: '出库数量必须大于 0' }
  }
  if (need > left) {
    if (pending > 0) {
      return {
        ok: false,
        available: left,
        reason: `本批入库后成品仓仍不足（可出 ${left}，需出 ${need}）`,
      }
    }
    return {
      ok: false,
      available: left,
      reason: `成品仓库存不足（可出 ${left}，需出 ${need}），请先生成入库`,
    }
  }
  return { ok: true, available: left }
}

/** 出库预览行通过后扣减成品仓剩余量 */
export function deductWarehouseRemaining(warehouseRemaining, kcaa01, outboundQty) {
  const k = text(kcaa01)
  const left = roundQty(warehouseRemaining?.get(k) ?? 0)
  warehouseRemaining.set(k, roundQty(left - toNumber(outboundQty)))
}

export const CUSTOMS_WORKSHOP_NAME = '包装部'
export const CUSTOMS_WAREHOUSE_NAME = '成品仓'
export const CUSTOMS_INBOUND_TYPE = '4'
export const CUSTOMS_OUTBOUND_TYPE = '6'
