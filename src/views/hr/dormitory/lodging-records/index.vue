<script setup>
import { ref } from 'vue'
import RoomList from '@/views/dormitory/RoomList.vue'
import LodgingHistory from '@/views/dormitory/LodgingHistory.vue'

const mode = ref('manage')
</script>

<template>
  <div class="erp-module-page">
    <div class="erp-mode-bar">
      <el-button :type="mode === 'manage' ? 'primary' : 'default'" plain @click="mode = 'manage'">管理住宿</el-button>
      <el-button :type="mode === 'history' ? 'primary' : 'default'" plain @click="mode = 'history'">住/退宿记录</el-button>
    </div>
    <el-card shadow="never">
      <template #header><span class="page-title">{{ mode === 'manage' ? '管理住宿' : '住/退宿记录' }}</span></template>
      <RoomList v-if="mode === 'manage'" />
      <LodgingHistory v-else />
    </el-card>
  </div>
</template>

<style scoped>
.page-title { font-size: 18px; font-weight: 600; }
</style>
