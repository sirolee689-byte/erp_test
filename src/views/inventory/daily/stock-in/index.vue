<template>
  <div class="erp-module-page">
    <el-card shadow="never">
      <template #header>
        <span class="page-title">{{ pageTitle }}</span>
      </template>
      <p class="page-desc">当前功能：{{ pageTitle }}</p>
    </el-card>
  </div>
</template>

<script setup>
/** 页面标题（与左侧菜单一致） */
const pageTitle = '入库单'
</script>

<style scoped>
.erp-module-page {
  min-height: 200px;
}
.page-title {
  font-size: 18px;
  font-weight: 600;
}
.page-desc {
  margin: 0;
  color: var(--el-text-color-secondary);
}
</style>
