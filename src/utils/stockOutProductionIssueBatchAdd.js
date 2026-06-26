/**
 * 生产领料批量添加会话（独立新窗口与父页通信）
 */
export const STOCK_OUT_PI_BATCH_CTX_PREFIX = 'stock-out-pi-batch:'
export const STOCK_OUT_PI_BATCH_RESULT_PREFIX = 'stock-out-pi-batch-result:'

export const STOCK_OUT_PI_BATCH_MSG_APPLY = 'stock-out-pi-batch-apply'
export const STOCK_OUT_PI_BATCH_MSG_ACCEPTED = 'stock-out-pi-batch-accepted'
export const STOCK_OUT_PI_BATCH_MSG_REJECTED = 'stock-out-pi-batch-rejected'
export const STOCK_OUT_PI_BATCH_REJECT_WAREHOUSE_MISMATCH = 'warehouse-mismatch'
export const STOCK_OUT_PI_BATCH_REJECT_SOURCE_MISMATCH = 'source-mismatch'
export const STOCK_OUT_PI_BATCH_REJECT_WORKSHOP_MISMATCH = 'workshop-mismatch'
export const STOCK_OUT_PI_BATCH_REJECT_PI_MISMATCH = 'pi-mismatch'

function text(v) {
  return String(v ?? '').trim()
}

export function buildStockOutProductionIssueBatchSessionId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `stock-out-pi-batch-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

export function readStockOutProductionIssueBatchContext(sessionId) {
  try {
    const raw = sessionStorage.getItem(`${STOCK_OUT_PI_BATCH_CTX_PREFIX}${sessionId}`)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

export function writeStockOutProductionIssueBatchContext(sessionId, payload) {
  sessionStorage.setItem(`${STOCK_OUT_PI_BATCH_CTX_PREFIX}${sessionId}`, JSON.stringify(payload))
}

export function writeStockOutProductionIssueBatchResult(sessionId, payload) {
  sessionStorage.setItem(`${STOCK_OUT_PI_BATCH_RESULT_PREFIX}${sessionId}`, JSON.stringify(payload))
}

export function readStockOutProductionIssueBatchResult(sessionId) {
  try {
    const raw = sessionStorage.getItem(`${STOCK_OUT_PI_BATCH_RESULT_PREFIX}${sessionId}`)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

export function removeStockOutProductionIssueBatchResult(sessionId) {
  try {
    sessionStorage.removeItem(`${STOCK_OUT_PI_BATCH_RESULT_PREFIX}${sessionId}`)
  } catch {
    // ignore
  }
}

export function validateStockOutProductionIssueBatchApply({
  openedWarehouseCode,
  currentWarehouseCode,
  openedSourceOrderNo,
  currentSourceOrderNo,
  openedWorkshopCode,
  currentWorkshopCode,
  openedPiNo,
  currentPiNo,
}) {
  if (!text(openedWarehouseCode) || !text(currentWarehouseCode) || openedWarehouseCode !== currentWarehouseCode) {
    return { ok: false, reason: STOCK_OUT_PI_BATCH_REJECT_WAREHOUSE_MISMATCH }
  }
  if (text(openedSourceOrderNo) !== text(currentSourceOrderNo)) {
    return { ok: false, reason: STOCK_OUT_PI_BATCH_REJECT_SOURCE_MISMATCH }
  }
  if (text(openedWorkshopCode) !== text(currentWorkshopCode)) {
    return { ok: false, reason: STOCK_OUT_PI_BATCH_REJECT_WORKSHOP_MISMATCH }
  }
  if (text(openedPiNo) !== text(currentPiNo)) {
    return { ok: false, reason: STOCK_OUT_PI_BATCH_REJECT_PI_MISMATCH }
  }
  return { ok: true }
}

export function resolveProductionIssueBatchLineKey(row) {
  const lineKey = text(row?.lineKey)
  if (lineKey.startsWith('material|')) return lineKey.toLowerCase()
  const mat = text(row?.kcaa01 ?? row?.materialCode).toLowerCase()
  if (mat) return `material|${mat}`
  if (lineKey.includes('|')) return lineKey.toLowerCase()
  const scak02 = text(row?.scak02 ?? row?.sourceLineCode ?? row?.kcaq02).toLowerCase()
  const mergeKey = text(row?.mergeKey).toLowerCase()
  if (scak02 && mergeKey) return `${scak02}|${mergeKey}`
  if (scak02 && mat) return `${scak02}|${mat}`
  return lineKey.toLowerCase() || scak02
}
