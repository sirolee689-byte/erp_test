export const STOCK_BATCH_CTX_PREFIX = 'stock-in-batch:'
export const STOCK_BATCH_RESULT_PREFIX = 'stock-in-batch-result:'

export const STOCK_BATCH_MSG_APPLY = 'stock-in-batch-apply'
export const STOCK_BATCH_MSG_ACCEPTED = 'stock-in-batch-accepted'
export const STOCK_BATCH_MSG_REJECTED = 'stock-in-batch-rejected'
export const STOCK_BATCH_REJECT_SOURCE_MISMATCH = 'source-mismatch'
export const STOCK_BATCH_REJECT_SUPPLIER_MISMATCH = 'supplier-mismatch'

export function buildStockBatchSessionId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `stock-batch-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

/** 外协退料已选键：BOM systemcode + 成品 kcaa01（pm） */
export function buildAssistReturnLineKey(systemcode, pm) {
  const sc = String(systemcode ?? '').trim().toLowerCase()
  const product = String(pm ?? '').trim().toLowerCase()
  if (!sc) return ''
  return `${sc}|${product}`
}

export function readStockBatchContext(sessionId) {
  try {
    const raw = sessionStorage.getItem(`${STOCK_BATCH_CTX_PREFIX}${sessionId}`)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

export function writeStockBatchContext(sessionId, payload) {
  sessionStorage.setItem(`${STOCK_BATCH_CTX_PREFIX}${sessionId}`, JSON.stringify(payload))
}

// 与采购订单批量添加一致：结果只写 sessionStorage，避免 localStorage 触发跨窗 storage 事件抢先消费且无法回 accepted
export function writeStockBatchResult(sessionId, payload) {
  sessionStorage.setItem(`${STOCK_BATCH_RESULT_PREFIX}${sessionId}`, JSON.stringify(payload))
}

export function readStockBatchResult(sessionId) {
  try {
    const raw = sessionStorage.getItem(`${STOCK_BATCH_RESULT_PREFIX}${sessionId}`)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

export function removeStockBatchResult(sessionId) {
  try {
    sessionStorage.removeItem(`${STOCK_BATCH_RESULT_PREFIX}${sessionId}`)
  } catch {
    // ignore
  }
}

export function validateStockBatchApply({
  openedSourceOrderNo,
  currentSourceOrderNo,
  openedSupplierCode,
  currentSupplierCode,
}) {
  const opened = String(openedSourceOrderNo ?? '').trim()
  const current = String(currentSourceOrderNo ?? '').trim()
  if (opened !== current) {
    return { ok: false, reason: STOCK_BATCH_REJECT_SOURCE_MISMATCH }
  }
  const openedSupplier = String(openedSupplierCode ?? '').trim()
  const currentSupplier = String(currentSupplierCode ?? '').trim()
  if (!openedSupplier || !currentSupplier || openedSupplier !== currentSupplier) {
    return { ok: false, reason: STOCK_BATCH_REJECT_SUPPLIER_MISMATCH }
  }
  return { ok: true }
}
