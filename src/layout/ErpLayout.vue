<template>
  <el-container class="erp-layout">
    <el-aside :width="asideWidth" class="erp-aside">
      <div class="erp-logo" :class="{ collapsed: isCollapsed }">
        <span v-if="!isCollapsed">ERP 基础框架</span>
        <span v-else class="erp-logo-mini">ERP</span>
      </div>
      <el-scrollbar class="erp-menu-scroll">
        <el-menu
          :router="true"
          :default-active="active"
          :collapse="isCollapsed"
          :collapse-transition="false"
          class="erp-menu"
          background-color="#0b1f3a"
          text-color="#ffffff"
          active-text-color="#5aa7ff"
        >
          <ErpMenuTree :nodes="menuStructure" />
        </el-menu>
      </el-scrollbar>
    </el-aside>
    <el-container>
      <el-header class="erp-header" height="56px">
        <el-button class="collapse-btn" text @click="toggleCollapse">
          <el-icon :size="18">
            <component :is="isCollapsed ? Expand : Fold" />
          </el-icon>
        </el-button>
        <span class="erp-header-title">{{ headerTitle }}</span>
      </el-header>
      <el-main class="erp-main">
        <div class="erp-content-card">
          <router-view />
        </div>
      </el-main>
    </el-container>
  </el-container>
</template>

<script setup>
import { computed, ref } from 'vue'
import { useRoute } from 'vue-router'
import menuStructure from '../../erp_structure_dump.json'
import ErpMenuTree from './ErpMenuTree.vue'
import { Expand, Fold } from '@element-plus/icons-vue'

const route = useRoute()
const active = computed(() => route.path)
const headerTitle = computed(() => (route.meta.title ? String(route.meta.title) : '首页'))

const isCollapsed = ref(false)
const asideWidth = computed(() => (isCollapsed.value ? '64px' : '260px'))

function toggleCollapse() {
  isCollapsed.value = !isCollapsed.value
}
</script>

<style scoped>
.erp-layout {
  min-height: 100vh;
}
.erp-aside {
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
.erp-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 12px;
  background: #fff;
  border-bottom: 1px solid var(--el-border-color-lighter);
}
.collapse-btn {
  height: 32px;
  width: 32px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--el-text-color-regular);
}
.collapse-btn:hover {
  background: rgba(0, 0, 0, 0.04);
}
.erp-header-title {
  font-size: 16px;
  font-weight: 500;
  color: var(--el-text-color-primary);
}
.erp-main {
  background: #f3f5f7;
  padding: 16px;
  min-width: 0;
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
