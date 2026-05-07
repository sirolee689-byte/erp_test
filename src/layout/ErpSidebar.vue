<template>
  <!--
    全局静态侧栏：与路由出口（AppMain）完全分离，仅随布局挂载一次，
    切换页签/子路由时不应随页面组件销毁重建。
  -->
  <el-aside :width="asideWidth" class="erp-aside">
    <div class="erp-logo" :class="{ collapsed }">
      <span v-if="!collapsed">ERP 基础框架</span>
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
        background-color="#0b1f3a"
        text-color="#ffffff"
        active-text-color="#5aa7ff"
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
  background-color: #0b1f3a;
  display: flex;
  flex-direction: column;
  transition: width 0.18s ease;
}
.erp-logo {
  flex-shrink: 0;
  height: 56px;
  line-height: 56px;
  padding: 0 16px;
  font-size: 16px;
  font-weight: 600;
  color: #fff;
  border-bottom: 1px solid rgba(255, 255, 255, 0.12);
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
  color: #ffffff !important;
}
.erp-menu :deep(.el-menu-item:hover),
.erp-menu :deep(.el-sub-menu__title:hover) {
  background-color: rgba(90, 167, 255, 0.16) !important;
}
.erp-menu :deep(.el-menu-item.is-active) {
  background-color: rgba(90, 167, 255, 0.22) !important;
}
.erp-menu :deep(.el-sub-menu.is-active > .el-sub-menu__title) {
  background-color: rgba(90, 167, 255, 0.12) !important;
}
</style>
