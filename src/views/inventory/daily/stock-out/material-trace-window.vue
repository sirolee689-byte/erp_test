<template>
  <div class="stock-trace-page">
    <div class="stock-trace-head">
      <h1>出库单-物料列表</h1>
    </div>
    <StockOutMaterialTracePanel />
  </div>
</template>

<script setup>
import StockOutMaterialTracePanel from './material-trace-panel.vue'

defineOptions({ name: 'inventory-daily-stock-out-material-trace-window' })
</script>

<style scoped>
.stock-trace-page {
  padding: 12px;
}

.stock-trace-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 10px;
}

.stock-trace-head h1 {
  margin: 0;
  font-size: 20px;
}
</style>
