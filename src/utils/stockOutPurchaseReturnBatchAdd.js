/**
 * 采购退货批量添加会话（独立新窗口与父页通信）
 */
export const STOCK_OUT_PR_BATCH_CTX_PREFIX = 'stock-out-pr-batch:'
export const STOCK_OUT_PR_BATCH_RESULT_PREFIX = 'stock-out-pr-batch-result:'

export const STOCK_OUT_PR_BATCH_MSG_APPLY = 'stock-out-pr-batch-apply'
export const STOCK_OUT_PR_BATCH_MSG_ACCEPTED = 'stock-out-pr-batch-accepted'
export const STOCK_OUT_PR_BATCH_MSG_REJECTED = 'stock-out-pr-batch-rejected'
export const STOCK_OUT_PR_BATCH_REJECT_WAREHOUSE_MISMATCH = 'warehouse-mismatch'
export const STOCK_OUT_PR_BATCH_REJECT_SOURCE_MISMATCH = 'source-mismatch'
export const STOCK_OUT_PR_BATCH_REJECT_SUPPLIER_MISMATCH = 'supplier-mismatch'

export function buildStockOutPurchaseReturnBatchSessionId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `stock-out-pr-batch-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

export function readStockOutPurchaseReturnBatchContext(sessionId) {
  try {
    const raw = sessionStorage.getItem(`${STOCK_OUT_PR_BATCH_CTX_PREFIX}${sessionId}`)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

export function writeStockOutPurchaseReturnBatchContext(sessionId, payload) {
  sessionStorage.setItem(`${STOCK_OUT_PR_BATCH_CTX_PREFIX}${sessionId}`, JSON.stringify(payload))
}

export function writeStockOutPurchaseReturnBatchResult(sessionId, payload) {
  sessionStorage.setItem(`${STOCK_OUT_PR_BATCH_RESULT_PREFIX}${sessionId}`, JSON.stringify(payload))
}

export function readStockOutPurchaseReturnBatchResult(sessionId) {
  try {
    const raw = sessionStorage.getItem(`${STOCK_OUT_PR_BATCH_RESULT_PREFIX}${sessionId}`)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

export function removeStockOutPurchaseReturnBatchResult(sessionId) {
  try {
    sessionStorage.removeItem(`${STOCK_OUT_PR_BATCH_RESULT_PREFIX}${sessionId}`)
  } catch {
    // ignore
  }
}

export function validateStockOutPurchaseReturnBatchApply({
  openedWarehouseCode,
  currentWarehouseCode,
  openedSourceOrderNo,
  currentSourceOrderNo,
  openedSupplierCode,
  currentSupplierCode,
}) {
  const openedWh = text(openedWarehouseCode)
  const currentWh = text(currentWarehouseCode)
  if (!openedWh || !currentWh || openedWh !== currentWh) {
    return { ok: false, reason: STOCK_OUT_PR_BATCH_REJECT_WAREHOUSE_MISMATCH }
  }
  const openedSource = text(openedSourceOrderNo)
  const currentSource = text(currentSourceOrderNo)
  if (openedSource !== currentSource) {
    return { ok: false, reason: STOCK_OUT_PR_BATCH_REJECT_SOURCE_MISMATCH }
  }
  const openedSupplier = text(openedSupplierCode)
  const currentSupplier = text(currentSupplierCode)
  if (!openedSupplier || !currentSupplier || openedSupplier !== currentSupplier) {
    return { ok: false, reason: STOCK_OUT_PR_BATCH_REJECT_SUPPLIER_MISMATCH }
  }
  return { ok: true }
}

function text(v) {
  return String(v ?? '').trim()
}
