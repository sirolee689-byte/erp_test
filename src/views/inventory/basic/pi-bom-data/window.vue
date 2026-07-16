<template>
  <div class="pi-bom-standalone-window erp-detail-form-context">
    <header class="pi-bom-standalone-header">
      <h1 class="pi-bom-standalone-title">{{ pageTitle }}</h1>
    </header>
    <template v-if="ready">
      <PiBomViewerPanel
        v-if="isViewMode"
        :order-id="orderId"
        :product-kcaa01="productKcaa01"
        :pi-no="resolvedPiNo"
        standalone
        @meta="onViewerMeta"
      />
      <PiBomEditorPanel
        v-else
        :order-id="orderId"
        :product-kcaa01="productKcaa01"
        :window-mode="windowMode"
        :parent-systemcode="parentSystemcode"
        standalone
      />
    </template>
    <el-empty v-else description="缺少订单或编码参数，无法打开" />
  </div>
</template>

<script setup>
import { computed, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { ElMessage } from 'element-plus'
import PiBomEditorPanel from './PiBomEditorPanel.vue'
import PiBomViewerPanel from './PiBomViewerPanel.vue'

defineOptions({ name: 'inventory-basic-pi-bom-data-window' })

const route = useRoute()
const windowMode = computed(() => String(route.query?.mode ?? 'parts-edit').trim().toLowerCase())
const orderId = computed(() => Number(route.query?.orderId ?? 0))
const productKcaa01 = computed(() => String(route.query?.kcaa01 ?? '').trim())
const parentSystemcode = computed(() => String(route.query?.parentSystemcode ?? '').trim())
const queryPiNo = computed(() => String(route.query?.piNo ?? '').trim())

/** 标题用 PI：优先 URL，详情加载后可用接口回填 */
const resolvedPiNo = ref('')

watch(
  queryPiNo,
  (v) => {
    if (v) resolvedPiNo.value = v
  },
  { immediate: true },
)

const isViewMode = computed(() => {
  const m = windowMode.value
  return m === 'view' || m === 'detail'
})

const ready = computed(() => {
  return Number.isFinite(orderId.value) && orderId.value > 0 && !!productKcaa01.value
})

const pageTitle = computed(() => {
  const code = productKcaa01.value
  const pi = String(resolvedPiNo.value ?? '').trim()
  if (isViewMode.value) {
    // 定稿：查看 PI-BOM  PI-XXXX  编码（两段之间各两个空格）
    if (pi && code) return `查看 PI-BOM  ${pi}  ${code}`
    if (code) return `查看 PI-BOM  ${code}`
    return '查看 PI-BOM'
  }
  if (windowMode.value === 'parts-edit') {
    return parentSystemcode.value ? `PI-BOM 配件明细编辑 - ${code}` : 'PI-BOM 配件明细编辑'
  }
  return code ? `编辑 PI-BOM - ${code}` : '编辑 PI-BOM'
})

watch(
  pageTitle,
  (t) => {
    if (t) document.title = t
  },
  { immediate: true },
)

function onViewerMeta(payload) {
  const pi = String(payload?.piNo ?? '').trim()
  if (pi) resolvedPiNo.value = pi
}

if (!ready.value) {
  ElMessage.error('新窗口缺少 orderId 或编码，无法打开')
}
</script>

<style scoped>
.pi-bom-standalone-window {
  min-height: 100vh;
  background: var(--el-bg-color);
}

.pi-bom-standalone-header {
  padding: 14px 16px 0;
}

.pi-bom-standalone-title {
  margin: 0;
  font-size: 18px;
  font-weight: 600;
  color: var(--el-text-color-primary);
}
</style>
