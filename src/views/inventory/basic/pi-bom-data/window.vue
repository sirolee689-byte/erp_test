<template>
  <div class="pi-bom-standalone-window">
    <header class="pi-bom-standalone-header">
      <h1 class="pi-bom-standalone-title">{{ pageTitle }}</h1>
    </header>
    <PiBomEditorPanel
      v-if="ready"
      :order-id="orderId"
      :product-kcaa01="productKcaa01"
      :window-mode="windowMode"
      :parent-systemcode="parentSystemcode"
      standalone
    />
    <el-empty v-else description="缺少订单或编码参数，无法打开" />
  </div>
</template>

<script setup>
import { computed, ref } from 'vue'
import { useRoute } from 'vue-router'
import { ElMessage } from 'element-plus'
import PiBomEditorPanel from './PiBomEditorPanel.vue'

defineOptions({ name: 'inventory-basic-pi-bom-data-window' })

const route = useRoute()
const windowMode = computed(() => String(route.query?.mode ?? 'parts-edit').trim().toLowerCase())
const orderId = computed(() => Number(route.query?.orderId ?? 0))
const productKcaa01 = computed(() => String(route.query?.kcaa01 ?? '').trim())
const parentSystemcode = computed(() => String(route.query?.parentSystemcode ?? '').trim())

const ready = computed(() => {
  return Number.isFinite(orderId.value) && orderId.value > 0 && !!productKcaa01.value
})

const pageTitle = computed(() => {
  const pi = productKcaa01.value
  if (windowMode.value === 'parts-edit') {
    return parentSystemcode.value ? `PI-BOM 配件明细编辑 - ${pi}` : 'PI-BOM 配件明细编辑'
  }
  return pi ? `编辑 PI-BOM - ${pi}` : '编辑 PI-BOM'
})

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
