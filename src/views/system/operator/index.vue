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
        - 后端接口：GET /api/users
        - 后端从 SQL Server 的 Sys_Users 表查询数据（server/index.js）
        - 前端通过 axios 请求 /api/users（Vite 会把 /api 代理到本地后端端口）
        - 接口统一返回：{ code: 200, msg: 'success', data: [...] }
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
            <!-- 关键：前端固定列，确保展示字段与业务含义一致 -->
            <el-table-column prop="UserID" label="用户 ID" min-width="120" />
            <el-table-column prop="UserCode" label="工号" min-width="140" show-overflow-tooltip />
            <el-table-column prop="UserName" label="姓名" min-width="140" show-overflow-tooltip />

            <!-- 关键：状态列使用标签展示，1=启用，0=禁用 -->
            <el-table-column prop="Status" label="状态" min-width="120">
              <template #default="{ row }">
                <el-tag :type="row?.Status === 1 ? 'success' : 'info'" effect="light">
                  {{ row?.Status === 1 ? '启用' : '禁用' }}
                </el-tag>
              </template>
            </el-table-column>

            <!-- 关键：创建时间展示（后端返回 CreatedAt） -->
            <el-table-column prop="CreatedAt" label="创建时间" min-width="200" :formatter="formatDateTime" />
          </el-table>
        </template>
      </el-skeleton>
    </el-card>
  </div>
</template>

<script setup>
import { onMounted, ref } from 'vue'
import { ElMessage } from 'element-plus'
import axios from 'axios'

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
 * 关键：格式化创建时间
 * 说明：
 * - 后端通常返回 ISO 字符串或 Date 可序列化值
 * - 这里统一转成本地时间字符串，便于阅读
 */
function formatDateTime(row, column, cellValue) {
  if (!cellValue) return ''
  const d = new Date(cellValue)
  // 关键：无效日期直接返回原值，避免页面报错
  if (Number.isNaN(d.getTime())) return String(cellValue)
  return d.toLocaleString()
}

/**
 * 从后端读取 Sys_Users
 * 数据流说明（从数据库到网页）：
 * 1) 浏览器加载本页面后触发 onMounted
 * 2) loadUsers 使用 axios 请求 GET /api/users
 * 3) Vite 开发服务器将 /api 代理到后端（vite.config.js）
 * 4) 后端 /api/users 连接 SQL Server，查询 Sys_Users 表并返回 {code,msg,data}
 * 5) 前端拿到 data 数组后赋值给 users，el-table 自动渲染到页面
 */
async function loadUsers() {
  // 关键：进入加载态，避免用户重复点击和表格闪烁
  loading.value = true
  // 关键：清空旧错误提示
  errorMessage.value = ''

  try {
    // 关键：调用后端接口（统一走 /api/users）
    const res = await axios.get('/api/users')
    // 关键：取出后端 JSON 数据（axios 会把响应体放在 res.data）
    const json = res.data

    // 关键：按约定 code=200 视为成功
    if (json?.code !== 200) {
      const msg = json?.msg || '读取失败'
      errorMessage.value = msg
      ElMessage.error(msg)
      users.value = []
      return
    }

    // 关键：将用户列表写入响应式变量，触发表格更新
    users.value = Array.isArray(json.data) ? json.data : []
    if (users.value.length === 0) {
      ElMessage.info('Sys_Users 暂无数据')
    }
  } catch (e) {
    // 典型原因：
    // - 后端服务未启动
    // - Vite 代理未生效
    // - 网络/端口被占用
    // 关键：网络错误/代理错误/后端异常都会走到这里
    const msg = '接口请求失败：请确认后端已启动（npm run dev:server）并检查 .env 配置'
    errorMessage.value = msg
    ElMessage.error(msg)
    users.value = []
  } finally {
    // 关键：结束加载态
    loading.value = false
  }
}

onMounted(() => {
  // 关键：页面首次进入时自动加载用户列表
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
