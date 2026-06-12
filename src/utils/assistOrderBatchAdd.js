export const ASSIST_BATCH_CTX_PREFIX = 'assist-order-batch:'
export const ASSIST_BATCH_RESULT_PREFIX = 'assist-order-batch-result:'

export const ASSIST_BATCH_MSG_APPLY = 'assist-order-batch-apply'
export const ASSIST_BATCH_MSG_ACCEPTED = 'assist-order-batch-accepted'
export const ASSIST_BATCH_MSG_REJECTED = 'assist-order-batch-rejected'
export const ASSIST_BATCH_REJECT_PI_MISMATCH = 'pi-mismatch'
export const ASSIST_BATCH_REJECT_SUPPLIER_MISMATCH = 'supplier-mismatch'

export function buildAssistBatchSessionId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `batch-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

export function readAssistBatchContext(sessionId) {
  const key = `${ASSIST_BATCH_CTX_PREFIX}${sessionId}`
  try {
    const raw = sessionStorage.getItem(key)
    if (!raw) return null
    return JSON.parse(raw)
  } catch {
    return null
  }
}

export function writeAssistBatchContext(sessionId, payload) {
  const key = `${ASSIST_BATCH_CTX_PREFIX}${sessionId}`
  sessionStorage.setItem(key, JSON.stringify(payload))
}

export function writeAssistBatchResult(sessionId, payload) {
  const key = `${ASSIST_BATCH_RESULT_PREFIX}${sessionId}`
  sessionStorage.setItem(key, JSON.stringify(payload))
}

export function readAssistBatchResult(sessionId) {
  const key = `${ASSIST_BATCH_RESULT_PREFIX}${sessionId}`
  try {
    const raw = sessionStorage.getItem(key)
    if (!raw) return null
    return JSON.parse(raw)
  } catch {
    return null
  }
}

export function buildAssistBatchLineKey(piNo, product, kcaa01) {
  const pi = String(piNo ?? '').trim().toLowerCase()
  const prod = String(product ?? '').trim().toLowerCase()
  const mat = String(kcaa01 ?? '').trim().toLowerCase()
  return `${pi}|${prod}|${mat}`
}

export function parseAssistBatchResultPayload(raw) {
  if (raw == null || raw === '') return null
  try {
    const payload = typeof raw === 'string' ? JSON.parse(raw) : raw
    if (!payload || !Array.isArray(payload.lines) || !payload.lines.length) return null
    return payload
  } catch {
    return null
  }
}

/** @returns {{ ok: true } | { ok: false, reason: string }} */
export function validateBatchApply({
  openedPiNo,
  currentPiNo,
  openedSupplierCode,
  currentSupplierCode,
  requirePi = true,
}) {
  const opened = String(openedPiNo ?? '').trim()
  const current = String(currentPiNo ?? '').trim()
  if (requirePi && (!opened || !current)) {
    return { ok: false, reason: 'missing-pi' }
  }
  if (requirePi && opened !== current) {
    return { ok: false, reason: ASSIST_BATCH_REJECT_PI_MISMATCH }
  }
  const openedSupplier = String(openedSupplierCode ?? '').trim()
  const currentSupplier = String(currentSupplierCode ?? '').trim()
  if (openedSupplier || currentSupplier) {
    if (!openedSupplier || !currentSupplier || openedSupplier !== currentSupplier) {
      return { ok: false, reason: ASSIST_BATCH_REJECT_SUPPLIER_MISMATCH }
    }
  }
  return { ok: true }
}
