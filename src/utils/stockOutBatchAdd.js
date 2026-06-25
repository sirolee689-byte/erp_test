/**
 * 其他出库批量选材会话（独立新窗口与父页通信）
 */
export const STOCK_OUT_BATCH_CTX_PREFIX = 'stock-out-batch:'
export const STOCK_OUT_BATCH_RESULT_PREFIX = 'stock-out-batch-result:'

export const STOCK_OUT_BATCH_MSG_APPLY = 'stock-out-batch-apply'
export const STOCK_OUT_BATCH_MSG_ACCEPTED = 'stock-out-batch-accepted'
export const STOCK_OUT_BATCH_MSG_REJECTED = 'stock-out-batch-rejected'
export const STOCK_OUT_BATCH_REJECT_WAREHOUSE_MISMATCH = 'warehouse-mismatch'

export function buildStockOutBatchSessionId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `stock-out-batch-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

export function readStockOutBatchContext(sessionId) {
  try {
    const raw = sessionStorage.getItem(`${STOCK_OUT_BATCH_CTX_PREFIX}${sessionId}`)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

export function writeStockOutBatchContext(sessionId, payload) {
  sessionStorage.setItem(`${STOCK_OUT_BATCH_CTX_PREFIX}${sessionId}`, JSON.stringify(payload))
}

export function writeStockOutBatchResult(sessionId, payload) {
  sessionStorage.setItem(`${STOCK_OUT_BATCH_RESULT_PREFIX}${sessionId}`, JSON.stringify(payload))
}

export function readStockOutBatchResult(sessionId) {
  try {
    const raw = sessionStorage.getItem(`${STOCK_OUT_BATCH_RESULT_PREFIX}${sessionId}`)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

export function removeStockOutBatchResult(sessionId) {
  try {
    sessionStorage.removeItem(`${STOCK_OUT_BATCH_RESULT_PREFIX}${sessionId}`)
  } catch {
    // ignore
  }
}

export function validateStockOutBatchApply({ openedWarehouseCode, currentWarehouseCode }) {
  const opened = text(openedWarehouseCode)
  const current = text(currentWarehouseCode)
  if (!opened || !current || opened !== current) {
    return { ok: false, reason: STOCK_OUT_BATCH_REJECT_WAREHOUSE_MISMATCH }
  }
  return { ok: true }
}

function text(v) {
  return String(v ?? '').trim()
}
