<template>
  <!--
    全局静态侧栏：与路由出口（AppMain）完全分离，仅随布局挂载一次，
    切换页签/子路由时不应随页面组件销毁重建。
  -->
  <el-aside :width="asideWidth" class="erp-aside">
    <div class="erp-logo" :class="{ collapsed }">
      <span v-if="!collapsed">ERP系统</span>
      <span v-else class="erp-logo-mini">ERP</span>
    </div>
    <el-scrollbar class="erp-menu-scroll">
      <el-menu
        :router="true"
        :default-active="activePath"
        :collapse="collapsed"
        :collapse-transition="false"
        :unique-opened="true"
        class="erp-menu"
        background-color="var(--erp-sidebar-bg)"
        text-color="var(--erp-sidebar-text)"
        active-text-color="var(--erp-sidebar-active-text)"
      >
        <ErpMenuTree :nodes="menuNodes" />
      </el-menu>
    </el-scrollbar>
  </el-aside>
</template>

<script setup>
import ErpMenuTree from './ErpMenuTree.vue'

defineOptions({ name: 'ErpSidebar' })

defineProps({
  /** 侧栏宽度（与折叠态一致） */
  asideWidth: { type: String, required: true },
  /** 是否折叠 */
  collapsed: { type: Boolean, required: true },
  /** 权限过滤后的菜单树 */
  menuNodes: { type: Array, required: true },
  /** 当前路由 path，与菜单 index（带前导 /）对齐 */
  activePath: { type: String, required: true },
})
</script>

<style scoped>
.erp-aside {
  flex-shrink: 0;
  /* 侧栏底色跟随皮肤（默认深蓝；暖色/暗黑/豆沙绿在 element-override.scss 覆盖） */
  background-color: var(--erp-sidebar-bg, #0b1f3a);
  display: flex;
  flex-direction: column;
  transition: width 0.18s ease;
}
.erp-logo {
  flex-shrink: 0;
  height: 56px;
  line-height: 56px;
  padding: 0 16px;
  font-size: var(--erp-sidebar-logo-size, 16px);
  font-weight: 600;
  color: var(--erp-sidebar-logo-color, #fff);
  border-bottom: 1px solid var(--erp-sidebar-border, rgba(255, 255, 255, 0.12));
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.erp-logo.collapsed {
  padding: 0 8px;
  text-align: center;
}
.erp-logo-mini {
  display: inline-block;
  width: 100%;
}
.erp-menu-scroll {
  flex: 1;
  min-height: 0;
}
.erp-menu {
  border-right: none;
}
.erp-menu :deep(.el-menu-item),
.erp-menu :deep(.el-sub-menu__title) {
  color: var(--erp-sidebar-text, #ffffff) !important;
}
.erp-menu :deep(.el-menu-item:hover),
.erp-menu :deep(.el-sub-menu__title:hover) {
  background-color: var(--erp-sidebar-hover-bg, rgba(90, 167, 255, 0.16)) !important;
}
.erp-menu :deep(.el-menu-item.is-active) {
  background-color: var(--erp-sidebar-active-bg, rgba(90, 167, 255, 0.22)) !important;
}
.erp-menu :deep(.el-sub-menu.is-active > .el-sub-menu__title) {
  background-color: var(--erp-sidebar-active-subbg, rgba(90, 167, 255, 0.12)) !important;
}
</style>
