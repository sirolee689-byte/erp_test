<template>
  <el-container class="erp-layout">
    <el-aside width="260px" class="erp-aside">
      <div class="erp-logo">ERP 基础框架</div>
      <el-scrollbar class="erp-menu-scroll">
        <el-menu
          :router="true"
          :default-active="active"
          class="erp-menu"
          background-color="#304156"
          text-color="#bfcbd9"
          active-text-color="#409eff"
        >
          <ErpMenuTree :nodes="menuStructure" />
        </el-menu>
      </el-scrollbar>
    </el-aside>
    <el-container>
      <el-header class="erp-header" height="56px">
        <span class="erp-header-title">{{ headerTitle }}</span>
      </el-header>
      <el-main class="erp-main">
        <router-view />
      </el-main>
    </el-container>
  </el-container>
</template>

<script setup>
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import menuStructure from '../../erp_structure_dump.json'
import ErpMenuTree from './ErpMenuTree.vue'

const route = useRoute()
const active = computed(() => route.path)
const headerTitle = computed(() => (route.meta.title ? String(route.meta.title) : '首页'))
</script>

<style scoped>
.erp-layout {
  min-height: 100vh;
}
.erp-aside {
  background-color: #304156;
  display: flex;
  flex-direction: column;
}
.erp-logo {
  flex-shrink: 0;
  height: 56px;
  line-height: 56px;
  padding: 0 16px;
  font-size: 16px;
  font-weight: 600;
  color: #fff;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
}
.erp-menu-scroll {
  flex: 1;
  min-height: 0;
}
.erp-menu {
  border-right: none;
}
.erp-header {
  display: flex;
  align-items: center;
  padding: 0 20px;
  background: #fff;
  border-bottom: 1px solid var(--el-border-color-lighter);
}
.erp-header-title {
  font-size: 16px;
  font-weight: 500;
  color: var(--el-text-color-primary);
}
.erp-main {
  background: var(--el-bg-color-page);
  padding: 16px;
}
</style>
