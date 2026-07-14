import { ref } from 'vue'

/**
 * 列表展开明细批量预取控制器（采购单等模块共用）
 * @param {{
 *   fetchBatch: (ids: number[]) => Promise<Record<string, unknown>>,
 *   fetchSingle: (id: number) => Promise<unknown>,
 *   getRowId: (row: Record<string, unknown>) => number,
 *   applyToRow: (row: Record<string, unknown>, payload: unknown) => void,
 *   resetRow: (row: Record<string, unknown>) => void,
 *   onError?: (msg: string) => void,
 * }} options
 */
export function createExpandPrefetch(options) {
  const {
    fetchBatch,
    fetchSingle,
    getRowId,
    applyToRow,
    resetRow,
    onError,
  } = options

  const tokenRef = ref(0)
  /** 当前轮批量预取 Promise；ensureLoaded 可 await，避免展开时重复打单条 */
  let inFlightPrefetch = null

  function resolveLoadingKey(row) {
    if (row && ('expandedLoading' in row || 'expandedLoaded' in row)) return 'expandedLoading'
    return '__linesLoading'
  }

  async function prefetch(listRows) {
    const targetRows = Array.isArray(listRows) ? listRows : []
    const ids = targetRows.map((row) => getRowId(row)).filter((id) => Number.isFinite(id) && id > 0)
    if (!ids.length) return
    const token = ++tokenRef.value
    targetRows.forEach((row) => {
      resetRow(row)
      row[resolveLoadingKey(row)] = true
    })
    const run = (async () => {
      try {
        const batch = await fetchBatch(ids)
        if (token !== tokenRef.value) return
        targetRows.forEach((row) => {
          const id = String(getRowId(row))
          const payload = batch?.[id]
          if (payload != null) {
            applyToRow(row, payload)
          } else {
            resetRow(row)
          }
        })
      } catch (err) {
        if (token !== tokenRef.value) return
        targetRows.forEach((row) => resetRow(row))
        onError?.(err?.response?.data?.msg || err?.message || '预加载展开明细失败')
      } finally {
        if (token === tokenRef.value) {
          targetRows.forEach((row) => {
            row[resolveLoadingKey(row)] = false
          })
        }
      }
    })()
    inFlightPrefetch = run
    try {
      await run
    } finally {
      if (inFlightPrefetch === run) inFlightPrefetch = null
    }
  }

  async function ensureLoaded(row) {
    if (!row) return
    if (row.__linesLoaded || row.expandedLoaded) return
    // 批量预取进行中：等预取结束；若已写入则直接返回，勿再打单条
    if (inFlightPrefetch) {
      await inFlightPrefetch
      if (row.__linesLoaded || row.expandedLoaded) return
    }
    const loadingKey = resolveLoadingKey(row)
    row[loadingKey] = true
    try {
      const id = getRowId(row)
      const payload = await fetchSingle(id)
      applyToRow(row, payload)
    } catch (err) {
      resetRow(row)
      onError?.(err?.response?.data?.msg || err?.message || '读取展开明细失败')
    } finally {
      row[loadingKey] = false
    }
  }

  return { prefetch, ensureLoaded, tokenRef }
}
