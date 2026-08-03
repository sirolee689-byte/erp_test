export const DINING_SUPPLEMENT_CTX_PREFIX = 'dining-supplement-batch:'
export const DINING_SUPPLEMENT_RESULT_PREFIX = 'dining-supplement-batch-result:'
export const DINING_SUPPLEMENT_MSG_APPLY = 'dining-supplement-batch-apply'
export const DINING_SUPPLEMENT_MSG_ACCEPTED = 'dining-supplement-batch-accepted'
export const DINING_SUPPLEMENT_MSG_REJECTED = 'dining-supplement-batch-rejected'

function contextKey(sessionId) {
  return `${DINING_SUPPLEMENT_CTX_PREFIX}${sessionId}`
}

function resultKey(sessionId) {
  return `${DINING_SUPPLEMENT_RESULT_PREFIX}${sessionId}`
}

export function buildDiningSupplementSessionId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  return `dining-supplement-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

export function writeDiningSupplementContext(sessionId, payload) {
  localStorage.setItem(contextKey(sessionId), JSON.stringify(payload))
}

export function readDiningSupplementContext(sessionId) {
  try {
    const raw = localStorage.getItem(contextKey(sessionId))
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

export function removeDiningSupplementContext(sessionId) {
  try { localStorage.removeItem(contextKey(sessionId)) } catch { /* 临时选择上下文清理失败不影响业务 */ }
}

export function writeDiningSupplementResult(sessionId, payload) {
  try {
    localStorage.setItem(resultKey(sessionId), JSON.stringify(payload))
    return true
  } catch {
    return false
  }
}

export function readDiningSupplementResult(sessionId) {
  try {
    const raw = localStorage.getItem(resultKey(sessionId))
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

export function removeDiningSupplementResult(sessionId) {
  try { localStorage.removeItem(resultKey(sessionId)) } catch { /* 临时选择结果清理失败不影响业务 */ }
}

export function parseDiningSupplementResultStorageEvent(event) {
  if (!event?.key?.startsWith(DINING_SUPPLEMENT_RESULT_PREFIX) || !event.newValue) return null
  try {
    return JSON.parse(event.newValue)
  } catch {
    return null
  }
}
