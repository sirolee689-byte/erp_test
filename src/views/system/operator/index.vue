<template>
  <div class="erp-module-page">
    <el-card shadow="never">
      <template #header>
        <div class="header-row">
          <span class="page-title">{{ pageTitle }}</span>
          <div class="header-actions">
            <el-button type="primary" :loading="loading" @click="loadUsers">刷新</el-button>
          </div>
        </div>
      </template>
      <p class="page-desc">当前功能：{{ pageTitle }}</p>

      <!--
        Sys_Users 数据表展示（Element Plus 表格）
        说明：
        - 后端接口：GET /api/sys-users
        - 开发环境下由 Vite 代理转发到本地后端（默认 http://localhost:3001）
      -->
      <el-alert
        v-if="errorMessage"
        :title="errorMessage"
        type="error"
        show-icon
        class="error-alert"
      />

      <el-skeleton :loading="loading" animated :rows="6">
        <template #default>
          <el-table
            :data="users"
            border
            stripe
            style="width: 100%"
            :empty-text="loading ? '加载中...' : '暂无数据'"
          >
            <!--
              说明（动态列渲染）：
              - 由于你没有在此处提供 Sys_Users 的字段结构
              - 为了“先跑通”，这里从返回数据的第一行提取字段名生成列
              - 后续你确认字段后，我建议改成明确列（更友好，也方便格式化/排序/筛选）
            -->
            <el-table-column
              v-for="col in columns"
              :key="col"
              :prop="col"
              :label="col"
              min-width="140"
              show-overflow-tooltip
            />
          </el-table>
        </template>
      </el-skeleton>
    </el-card>
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue'
import { ElMessage } from 'element-plus'

/** 页面标题（与左侧菜单一致） */
const pageTitle = '操作员资料'

/**
 * 页面状态
 * - users：表格数据（来自 Sys_Users）
 * - loading：加载状态
 * - errorMessage：错误提示（用于页面内展示）
 */
const users = ref([])
const loading = ref(false)
const errorMessage = ref('')

/**
 * 动态生成表格列
 * 规则：取第一行数据的 key 作为列名
 */
const columns = computed(() => {
  const first = users.value?.[0]
  if (!first || typeof first !== 'object') return []
  return Object.keys(first)
})

/**
 * 从后端读取 Sys_Users
 */
async function loadUsers() {
  loading.value = true
  errorMessage.value = ''

  try {
    const res = await fetch('/api/sys-users', { method: 'GET' })
    const json = await res.json()

    if (!res.ok || !json?.ok) {
      const msg = json?.message || '读取失败'
      errorMessage.value = msg
      ElMessage.error(msg)
      users.value = []
      return
    }

    users.value = Array.isArray(json.data) ? json.data : []
    if (users.value.length === 0) {
      ElMessage.info('Sys_Users 暂无数据')
    }
  } catch (e) {
    // 典型原因：
    // - 后端服务未启动
    // - Vite 代理未生效
    // - 网络/端口被占用
    const msg = '接口请求失败：请确认后端已启动（npm run dev:server）并检查 .env 配置'
    errorMessage.value = msg
    ElMessage.error(msg)
    users.value = []
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  loadUsers()
})
</script>

<style scoped>
.erp-module-page {
  min-height: 200px;
}
.header-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.header-actions {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}
.page-title {
  font-size: 18px;
  font-weight: 600;
}
.page-desc {
  margin: 0;
  color: var(--el-text-color-secondary);
}
.error-alert {
  margin: 12px 0;
}
</style>
