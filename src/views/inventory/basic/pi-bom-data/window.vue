<template>
  <div class="pi-bom-standalone-window erp-detail-form-context">
    <header class="pi-bom-standalone-header">
      <h1 class="pi-bom-standalone-title">{{ pageTitle }}</h1>
      <button
        v-if="isViewMode"
        type="button"
        class="pi-bom-standalone-close"
        aria-label="关闭"
        title="关闭"
        @click="closeStandaloneWindow"
      >
        <el-icon><Close /></el-icon>
      </button>
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
import { Close } from '@element-plus/icons-vue'
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

function closeStandaloneWindow() {
  window.close()
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
  position: relative;
  display: flex;
  align-items: center;
  min-height: 44px;
  padding: 14px 16px 0;
}

.pi-bom-standalone-title {
  margin: 0;
  font-size: 18px;
  font-weight: 600;
  color: var(--el-text-color-primary);
}

.pi-bom-standalone-close {
  position: absolute;
  top: 14px;
  right: 16px;
  width: var(--erp-dialog-close-size, 44px);
  height: var(--erp-dialog-close-size, 44px);
  margin: 0;
  padding: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 2px solid var(--el-color-danger) !important;
  border-radius: var(--el-border-radius-base) !important;
  background-color: #fff !important;
  color: var(--el-color-danger) !important;
  box-shadow: 0 1px 4px rgb(0 0 0 / 12%);
  cursor: pointer;
  transition:
    background-color 0.15s ease,
    border-color 0.15s ease,
    box-shadow 0.15s ease;
}

.pi-bom-standalone-close:hover,
.pi-bom-standalone-close:focus-visible {
  border-color: var(--el-color-danger) !important;
  background-color: var(--el-color-danger-light-9, #fef2f2) !important;
  outline: none;
}

.pi-bom-standalone-close :deep(.el-icon),
.pi-bom-standalone-close :deep(svg) {
  width: var(--erp-dialog-close-icon-size, 22px);
  height: var(--erp-dialog-close-icon-size, 22px);
  font-size: var(--erp-dialog-close-icon-size, 22px);
  color: var(--el-color-danger) !important;
  font-weight: 700;
}
</style>
