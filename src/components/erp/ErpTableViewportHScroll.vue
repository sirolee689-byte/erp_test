<template>
  <div ref="hostRef" class="erp-table-viewport-hscroll-host">
    <slot />
  </div>
</template>

<script setup>
/**
 * 主列表表格外壳：自动为插槽内 el-table 挂载视口底部固定横向滚动条。
 * 用法：<ErpTableViewportHScroll><el-table class="erp-list-table" /></ErpTableViewportHScroll>
 * 主列表禁止 :max-height，避免与页面纵滚形成双重滚动条。
 */
import { nextTick, onMounted, onUnmounted, ref } from 'vue'
import { useErpTableViewportHScroll } from '@/composables/useErpTableViewportHScroll'
import { requestErpTableLayout } from '@/utils/erpTableViewportHScroll'

const props = defineProps({
  /** 距视口底边的偏移（px），例如底部有固定工具条时可设为 48 */
  bottomOffset: { type: Number, default: 0 },
  /** 在 host 内查找表格的选择器，默认主列表 class */
  tableSelector: { type: String, default: '.erp-list-table' },
})

const hostRef = ref(null)
const tableTargetRef = ref(null)
let mo = null

const resolveTableInHost = () => {
  const host = hostRef.value
  if (!host) return null
  return host.querySelector(props.tableSelector) || host.querySelector('.el-table')
}

const syncTableRef = async () => {
  await nextTick()
  const next = resolveTableInHost()
  if (next !== tableTargetRef.value) {
    tableTargetRef.value = next
    if (next) requestErpTableLayout(next)
  }
}

onMounted(async () => {
  await syncTableRef()
  if (hostRef.value) {
    mo = new MutationObserver(() => {
      syncTableRef()
    })
    mo.observe(hostRef.value, { childList: true, subtree: true })
  }
})

onUnmounted(() => {
  mo?.disconnect()
  mo = null
})

useErpTableViewportHScroll(tableTargetRef, () => ({
  bottomOffset: props.bottomOffset,
}))
</script>

<style scoped>
.erp-table-viewport-hscroll-host {
  width: 100%;
}
</style>
