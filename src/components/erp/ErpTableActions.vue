<template>
  <div
    ref="rootRef"
    class="erp-table-actions erp-table-actions--grid"
    v-bind="$attrs"
    :style="gridStyle"
  >
    <slot />
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onBeforeUnmount, onUpdated, nextTick } from 'vue'
import { getErpTableActionsColCount } from '@/utils/erpTableActionsLayout'

defineOptions({ inheritAttrs: false })

const rootRef = ref(null)
const buttonCount = ref(0)

function isButtonVisible(el) {
  if (!(el instanceof HTMLElement)) return false
  if (el.style.display === 'none') return false
  const cs = getComputedStyle(el)
  return cs.display !== 'none' && cs.visibility !== 'hidden'
}

function countVisibleButtons() {
  const root = rootRef.value
  if (!root) return 0
  let n = 0
  root.querySelectorAll('.el-button').forEach((btn) => {
    if (isButtonVisible(btn)) n += 1
  })
  return n
}

function refresh() {
  buttonCount.value = countVisibleButtons()
}

let mutationObserver = null

onMounted(async () => {
  await nextTick()
  refresh()
  const root = rootRef.value
  if (!root || typeof MutationObserver === 'undefined') return
  mutationObserver = new MutationObserver(() => {
    refresh()
  })
  mutationObserver.observe(root, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['style', 'class'],
  })
})

onUpdated(() => {
  nextTick(refresh)
})

onBeforeUnmount(() => {
  mutationObserver?.disconnect()
  mutationObserver = null
})

const colCount = computed(() => getErpTableActionsColCount(buttonCount.value))

const gridStyle = computed(() => ({
  '--erp-table-actions-cols': String(colCount.value),
}))
</script>
