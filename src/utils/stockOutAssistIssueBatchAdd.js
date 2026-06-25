/**
 * 外协领料批量添加会话（独立新窗口与父页通信）
 */
export const STOCK_OUT_AI_BATCH_CTX_PREFIX = 'stock-out-ai-batch:'
export const STOCK_OUT_AI_BATCH_RESULT_PREFIX = 'stock-out-ai-batch-result:'

export const STOCK_OUT_AI_BATCH_MSG_APPLY = 'stock-out-ai-batch-apply'
export const STOCK_OUT_AI_BATCH_MSG_ACCEPTED = 'stock-out-ai-batch-accepted'
export const STOCK_OUT_AI_BATCH_MSG_REJECTED = 'stock-out-ai-batch-rejected'
export const STOCK_OUT_AI_BATCH_REJECT_WAREHOUSE_MISMATCH = 'warehouse-mismatch'
export const STOCK_OUT_AI_BATCH_REJECT_SOURCE_MISMATCH = 'source-mismatch'
export const STOCK_OUT_AI_BATCH_REJECT_SUPPLIER_MISMATCH = 'supplier-mismatch'
export const STOCK_OUT_AI_BATCH_REJECT_PI_MISMATCH = 'pi-mismatch'

export function buildStockOutAssistIssueBatchSessionId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `stock-out-ai-batch-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

export function readStockOutAssistIssueBatchContext(sessionId) {
  try {
    const raw = sessionStorage.getItem(`${STOCK_OUT_AI_BATCH_CTX_PREFIX}${sessionId}`)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

export function writeStockOutAssistIssueBatchContext(sessionId, payload) {
  sessionStorage.setItem(`${STOCK_OUT_AI_BATCH_CTX_PREFIX}${sessionId}`, JSON.stringify(payload))
}

export function writeStockOutAssistIssueBatchResult(sessionId, payload) {
  sessionStorage.setItem(`${STOCK_OUT_AI_BATCH_RESULT_PREFIX}${sessionId}`, JSON.stringify(payload))
}

export function readStockOutAssistIssueBatchResult(sessionId) {
  try {
    const raw = sessionStorage.getItem(`${STOCK_OUT_AI_BATCH_RESULT_PREFIX}${sessionId}`)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

export function removeStockOutAssistIssueBatchResult(sessionId) {
  try {
    sessionStorage.removeItem(`${STOCK_OUT_AI_BATCH_RESULT_PREFIX}${sessionId}`)
  } catch {
    // ignore
  }
}

export function validateStockOutAssistIssueBatchApply({
  openedWarehouseCode,
  currentWarehouseCode,
  openedSourceOrderNo,
  currentSourceOrderNo,
  openedSupplierCode,
  currentSupplierCode,
  openedPiNo,
  currentPiNo,
}) {
  const openedWh = text(openedWarehouseCode)
  const currentWh = text(currentWarehouseCode)
  if (!openedWh || !currentWh || openedWh !== currentWh) {
    return { ok: false, reason: STOCK_OUT_AI_BATCH_REJECT_WAREHOUSE_MISMATCH }
  }
  if (text(openedSourceOrderNo) !== text(currentSourceOrderNo)) {
    return { ok: false, reason: STOCK_OUT_AI_BATCH_REJECT_SOURCE_MISMATCH }
  }
  if (text(openedSupplierCode) !== text(currentSupplierCode)) {
    return { ok: false, reason: STOCK_OUT_AI_BATCH_REJECT_SUPPLIER_MISMATCH }
  }
  if (text(openedPiNo) !== text(currentPiNo)) {
    return { ok: false, reason: STOCK_OUT_AI_BATCH_REJECT_PI_MISMATCH }
  }
  return { ok: true }
}

function text(v) {
  return String(v ?? '').trim()
}
