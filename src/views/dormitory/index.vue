<template>
  <div class="erp-module-page lodging-page">
    <!--
      v1.1.4 Tab 化宿舍工作台：房间列表 | 审核入住申请 | 住宿历史（只读）
    -->
    <el-card shadow="never">
      <template #header>
        <span class="page-title">住宿管理</span>
      </template>
      <el-tabs v-model="activeTab" @tab-change="onTabChange">
        <!-- 不使用 lazy：保证子组件 ref 始终存在，办理入住后可立即刷新历史/待审列表 -->
        <el-tab-pane label="房间列表" name="overview">
          <RoomList ref="roomRef" @dorm-data-changed="onDormDataChanged" />
        </el-tab-pane>
        <el-tab-pane label="审核入住申请" name="audit">
          <AuditList ref="auditRef" @dorm-data-changed="onDormDataChanged" />
        </el-tab-pane>
        <el-tab-pane label="住宿历史列表" name="history">
          <HistoryList ref="historyRef" />
        </el-tab-pane>
      </el-tabs>
    </el-card>
  </div>
</template>

<script setup>
import { ref } from 'vue'
import RoomList from './RoomList.vue'
import AuditList from './AuditList.vue'
import HistoryList from './HistoryList.vue'

const activeTab = ref('overview')
const roomRef = ref(null)
const auditRef = ref(null)
const historyRef = ref(null)

function onTabChange(name) {
  if (name === 'overview') roomRef.value?.loadOverview?.()
  if (name === 'audit') auditRef.value?.loadData?.()
  if (name === 'history') historyRef.value?.loadHistory?.()
}

function onDormDataChanged() {
  historyRef.value?.loadHistory?.()
  auditRef.value?.loadData?.()
}
</script>

<style scoped>
.lodging-page {
  min-height: 240px;
}
.page-title {
  font-size: 18px;
  font-weight: 600;
}
</style>
