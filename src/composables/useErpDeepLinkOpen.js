import { onMounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'

/**
 * 新标签深链：?erpOpen=view|edit|create&erpRecordId= 打开后自动执行对应动作
 * @param {{
 *   handlers: Partial<Record<'view' | 'edit' | 'create' | 'manage' | 'material-trace', (recordId: string | null, query: Record<string, string>) => void | Promise<void>>>,
 *   clearQuery?: boolean,
 * }} options
 */
export function useErpDeepLinkOpen(options) {
  const route = useRoute()
  const router = useRouter()
  const handlers = options.handlers ?? {}
  const clearQuery = options.clearQuery !== false

  async function runFromQuery() {
    const erpOpen = String(route.query?.erpOpen ?? route.query?.erpMode ?? '').trim().toLowerCase()
    if (!erpOpen || !handlers[erpOpen]) return

    const rawId = route.query?.erpRecordId
    const recordId = rawId == null || String(rawId).trim() === '' ? null : String(rawId)

    /** @type {Record<string, string>} */
    const query = {}
    for (const [k, v] of Object.entries(route.query ?? {})) {
      if (Array.isArray(v)) query[k] = String(v[0] ?? '')
      else if (v != null) query[k] = String(v)
    }

    await handlers[erpOpen](recordId, query)

    if (clearQuery && (route.query?.erpOpen || route.query?.erpMode || route.query?.erpRecordId)) {
      const nextQuery = { ...route.query }
      delete nextQuery.erpOpen
      delete nextQuery.erpMode
      delete nextQuery.erpRecordId
      await router.replace({ path: route.path, query: nextQuery })
    }
  }

  onMounted(() => {
    void runFromQuery()
  })

  watch(
    () => [route.query?.erpOpen, route.query?.erpMode, route.query?.erpRecordId],
    () => {
      void runFromQuery()
    },
  )
}
