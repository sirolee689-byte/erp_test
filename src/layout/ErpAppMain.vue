<template>
  <!-- AppMain：仅承载页签区 + 路由出口，与侧栏隔离 -->
  <el-main class="erp-main erp-app-main-root">
    <slot name="tags" />
    <div class="erp-content-card">
      <slot />
    </div>
  </el-main>
</template>

<script setup>
defineOptions({ name: 'ErpAppMain' })
</script>

<style scoped>
.erp-main {
  background: #f3f5f7;
  padding: 16px;
  min-width: 0;
  /* 主内容区横向由表体/视口底横条处理，避免白卡片与 el-card__body 再出一层横滚 */
  overflow-x: clip;
  overflow-y: visible;
}
.erp-content-card {
  background: #fff;
  border-radius: 12px;
  box-shadow: 0 6px 18px rgba(15, 23, 42, 0.08);
  padding: 16px;
  min-height: calc(100vh - 56px - 32px);
  min-width: 0;
}
</style>

<style>
/*
 * 插槽 DOM 归属父组件作用域，scoped 无法命中 #tags 内节点；
 * 以下限定在 .erp-app-main-root 内，避免污染全局。
 */
.erp-app-main-root .erp-tags-wrap {
  position: sticky;
  top: 0;
  z-index: 30;
  margin: -4px 0 12px;
  padding: 8px 0 4px;
  background: #f3f5f7;
}
.erp-app-main-root .erp-route-tabs .el-tabs__content {
  display: none;
}
.erp-app-main-root .erp-route-tabs .el-tabs__header {
  margin-bottom: 0;
}
.erp-app-main-root .erp-tab-label {
  display: inline-block;
  max-width: 140px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  vertical-align: bottom;
}
</style>
