export const BUY_BATCH_CTX_PREFIX = 'buy-order-batch:'
export const BUY_BATCH_RESULT_PREFIX = 'buy-order-batch-result:'

export const BUY_BATCH_MSG_APPLY = 'buy-order-batch-apply'
export const BUY_BATCH_MSG_ACCEPTED = 'buy-order-batch-accepted'
export const BUY_BATCH_MSG_REJECTED = 'buy-order-batch-rejected'
export const BUY_BATCH_REJECT_PI_MISMATCH = 'pi-mismatch'
export const BUY_BATCH_REJECT_SUPPLIER_MISMATCH = 'supplier-mismatch'

export function buildBuyBatchSessionId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `buy-batch-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

export function readBuyBatchContext(sessionId) {
  try {
    const raw = sessionStorage.getItem(`${BUY_BATCH_CTX_PREFIX}${sessionId}`)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

export function writeBuyBatchContext(sessionId, payload) {
  sessionStorage.setItem(`${BUY_BATCH_CTX_PREFIX}${sessionId}`, JSON.stringify(payload))
}

export function writeBuyBatchResult(sessionId, payload) {
  sessionStorage.setItem(`${BUY_BATCH_RESULT_PREFIX}${sessionId}`, JSON.stringify(payload))
}

export function parseBuyBatchResultPayload(raw) {
  if (raw == null || raw === '') return null
  try {
    const payload = typeof raw === 'string' ? JSON.parse(raw) : raw
    if (!payload || !Array.isArray(payload.lines) || !payload.lines.length) return null
    return payload
  } catch {
    return null
  }
}

export function buildBuyBatchLineKey(piNo, kcaa01) {
  return `${String(piNo ?? '').trim().toLowerCase()}|${String(kcaa01 ?? '').trim().toLowerCase()}`
}

export function validateBuyBatchApply({
  openedPiNo,
  currentPiNo,
  openedSupplierCode,
  currentSupplierCode,
}) {
  const opened = String(openedPiNo ?? '').trim()
  const current = String(currentPiNo ?? '').trim()
  if (!opened || !current || opened !== current) {
    return { ok: false, reason: BUY_BATCH_REJECT_PI_MISMATCH }
  }
  const openedSupplier = String(openedSupplierCode ?? '').trim()
  const currentSupplier = String(currentSupplierCode ?? '').trim()
  if (!openedSupplier || !currentSupplier || openedSupplier !== currentSupplier) {
    return { ok: false, reason: BUY_BATCH_REJECT_SUPPLIER_MISMATCH }
  }
  return { ok: true }
}

