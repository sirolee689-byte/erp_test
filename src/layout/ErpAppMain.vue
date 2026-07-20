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
  flex: 1;
  min-height: 0;
  /* 面色走皮肤变量（全白=#f3f5f7，暖色皮肤在 element-override.scss 覆盖） */
  background: var(--erp-app-bg, #f3f5f7);
  padding: 16px;
  min-width: 0;
  /* 纵向滚动收进内容区；横向仍由表体/视口底横条处理 */
  overflow-x: clip;
  overflow-y: auto;
}
.erp-content-card {
  background: var(--erp-surface, #fff);
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
  /* el-main 有 16px 内边距；冻结时向上抵消，页签才会贴住顶栏。 */
  top: -16px;
  z-index: 30;
  /* 冻结标签栏贴紧顶部工具栏，不保留上方空白。 */
  margin: -16px 0 12px;
  padding: 0;
  /* 悬顶页签背景跟随皮肤，避免滚动时露出旧冷灰 */
  background: var(--erp-app-bg, #f3f5f7);
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
