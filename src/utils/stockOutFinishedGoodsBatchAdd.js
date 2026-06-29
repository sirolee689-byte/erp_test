/**
 * 成品出库批量添加会话（独立新窗口与父页通信）
 */
export const STOCK_OUT_FG_BATCH_CTX_PREFIX = 'stock-out-fg-batch:'
export const STOCK_OUT_FG_BATCH_RESULT_PREFIX = 'stock-out-fg-batch-result:'

export const STOCK_OUT_FG_BATCH_MSG_APPLY = 'stock-out-fg-batch-apply'
export const STOCK_OUT_FG_BATCH_MSG_ACCEPTED = 'stock-out-fg-batch-accepted'
export const STOCK_OUT_FG_BATCH_MSG_REJECTED = 'stock-out-fg-batch-rejected'
export const STOCK_OUT_FG_BATCH_REJECT_WAREHOUSE_MISMATCH = 'warehouse-mismatch'
export const STOCK_OUT_FG_BATCH_REJECT_SOURCE_MISMATCH = 'source-mismatch'
export const STOCK_OUT_FG_BATCH_REJECT_CUSTOMER_MISMATCH = 'customer-mismatch'
export const STOCK_OUT_FG_BATCH_REJECT_SYSTEMCODE_MISMATCH = 'systemcode-mismatch'

export function buildStockOutFinishedGoodsBatchSessionId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `stock-out-fg-batch-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

export function readStockOutFinishedGoodsBatchContext(sessionId) {
  try {
    const raw = sessionStorage.getItem(`${STOCK_OUT_FG_BATCH_CTX_PREFIX}${sessionId}`)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

export function writeStockOutFinishedGoodsBatchContext(sessionId, payload) {
  sessionStorage.setItem(`${STOCK_OUT_FG_BATCH_CTX_PREFIX}${sessionId}`, JSON.stringify(payload))
}

export function writeStockOutFinishedGoodsBatchResult(sessionId, payload) {
  sessionStorage.setItem(`${STOCK_OUT_FG_BATCH_RESULT_PREFIX}${sessionId}`, JSON.stringify(payload))
}

export function readStockOutFinishedGoodsBatchResult(sessionId) {
  try {
    const raw = sessionStorage.getItem(`${STOCK_OUT_FG_BATCH_RESULT_PREFIX}${sessionId}`)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

export function removeStockOutFinishedGoodsBatchResult(sessionId) {
  try {
    sessionStorage.removeItem(`${STOCK_OUT_FG_BATCH_RESULT_PREFIX}${sessionId}`)
  } catch {
    // ignore
  }
}

/**
 * 成品出库：从材料编码推导默认报关型号（可手改，非强制）
 * 例：PQ-3691A1/N → 3691A1；PQ-3790A1 → 3790A1
 */
export function deriveFinishedGoodsCustomsModel(materialCode) {
  const code = String(materialCode ?? '').trim()
  if (!code.toUpperCase().startsWith('PQ-')) return ''
  const afterPrefix = code.slice(3).trim()
  if (!afterPrefix) return ''
  const slashIdx = afterPrefix.indexOf('/')
  return slashIdx >= 0 ? afterPrefix.slice(0, slashIdx).trim() : afterPrefix
}

export function validateStockOutFinishedGoodsBatchApply({
  openedWarehouseCode,
  currentWarehouseCode,
  openedSourceOrderNo,
  currentSourceOrderNo,
  openedCustomerCode,
  currentCustomerCode,
  openedSourceSystemcodeId,
  currentSourceSystemcodeId,
}) {
  const openedWh = text(openedWarehouseCode)
  const currentWh = text(currentWarehouseCode)
  if (!openedWh || !currentWh || openedWh !== currentWh) {
    return { ok: false, reason: STOCK_OUT_FG_BATCH_REJECT_WAREHOUSE_MISMATCH }
  }
  const openedSource = text(openedSourceOrderNo)
  const currentSource = text(currentSourceOrderNo)
  if (openedSource !== currentSource) {
    return { ok: false, reason: STOCK_OUT_FG_BATCH_REJECT_SOURCE_MISMATCH }
  }
  const openedCustomer = text(openedCustomerCode)
  const currentCustomer = text(currentCustomerCode)
  if (!openedCustomer || !currentCustomer || openedCustomer !== currentCustomer) {
    return { ok: false, reason: STOCK_OUT_FG_BATCH_REJECT_CUSTOMER_MISMATCH }
  }
  const openedSc = text(openedSourceSystemcodeId)
  const currentSc = text(currentSourceSystemcodeId)
  if (openedSc !== currentSc) {
    return { ok: false, reason: STOCK_OUT_FG_BATCH_REJECT_SYSTEMCODE_MISMATCH }
  }
  return { ok: true }
}

function text(v) {
  return String(v ?? '').trim()
}
