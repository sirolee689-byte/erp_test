<template>
  <section class="profile-page">
    <header class="profile-toolbar">
      <div>
        <h1>用餐记录</h1>
        <p>{{ scope === 'all' ? '查看全部历史报餐和刷卡记录' : '显示当天前23天至未来7天，每天一行' }}</p>
      </div>
      <div class="toolbar-actions">
        <el-button :type="scope === 'recent' ? 'primary' : 'default'" plain @click="switchScope('recent')">近31天</el-button>
        <el-button :type="scope === 'all' ? 'primary' : 'default'" plain @click="switchScope('all')">全部记录</el-button>
      </div>
    </header>

    <el-alert v-if="errorText" class="profile-alert" :title="errorText" type="error" show-icon :closable="false" />
    <div class="profile-summary">
      <span>共 <strong>{{ pagination.total }}</strong> 天记录</span>
      <el-button text type="primary" :icon="Refresh" :loading="loading" @click="loadRecords">刷新</el-button>
    </div>

    <div v-if="loading && !loaded" class="profile-loading"><el-icon class="is-loading"><Loading /></el-icon> 正在读取用餐记录…</div>

    <template v-else-if="rows.length">
      <div class="desktop-records">
        <el-table :data="rows" class="records-table" v-loading="loading">
          <el-table-column label="日期" min-width="130"><template #default="{ row }">{{ row.date }} {{ formatWeekday(row.date) }}</template></el-table-column>
          <el-table-column label="午餐报餐" min-width="110"><template #default="{ row }"><el-tag :type="reportTagType(row.lunch.reportLabel)" effect="plain">{{ row.lunch.reportLabel }}</el-tag></template></el-table-column>
          <el-table-column label="午餐打卡" min-width="150"><template #default="{ row }"><StatusCell :meal="row.lunch" /></template></el-table-column>
          <el-table-column label="晚餐报餐" min-width="110"><template #default="{ row }"><el-tag :type="reportTagType(row.dinner.reportLabel)" effect="plain">{{ row.dinner.reportLabel }}</el-tag></template></el-table-column>
          <el-table-column label="晚餐打卡" min-width="150"><template #default="{ row }"><StatusCell :meal="row.dinner" /></template></el-table-column>
        </el-table>
      </div>

      <div class="mobile-records" v-loading="loading">
        <article v-for="row in rows" :key="row.date" class="record-card">
          <strong class="record-date">{{ row.date }} {{ formatWeekday(row.date) }}</strong>
          <div class="meal-row"><span>午餐</span><el-tag :type="reportTagType(row.lunch.reportLabel)" effect="plain">{{ row.lunch.reportLabel }}</el-tag><StatusCell :meal="row.lunch" /></div>
          <div class="meal-row"><span>晚餐</span><el-tag :type="reportTagType(row.dinner.reportLabel)" effect="plain">{{ row.dinner.reportLabel }}</el-tag><StatusCell :meal="row.dinner" /></div>
        </article>
      </div>
    </template>

    <el-empty v-else-if="loaded && !loading" description="当前范围没有用餐记录" :image-size="104" />

    <footer v-if="pagination.total > 0" class="profile-pagination">
      <span>第 {{ pagination.page }} / {{ pagination.totalPages }} 页</span>
      <el-button :disabled="pagination.page <= 1 || loading" @click="changePage(pagination.page - 1)">上一页</el-button>
      <el-button :disabled="pagination.page >= pagination.totalPages || loading" @click="changePage(pagination.page + 1)">下一页</el-button>
    </footer>
  </section>
</template>

<script setup>
import { defineComponent, h, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { Loading, Refresh } from '@element-plus/icons-vue'
import { getDiningProfileMeals } from '@/api/diningApi'
import { clearDiningAuth } from '@/utils/diningAuthStorage'

const router = useRouter()
const loading = ref(false)
const loaded = ref(false)
const errorText = ref('')
const scope = ref('recent')
const rows = ref([])
const pagination = ref({ page: 1, pageSize: 10, total: 0, totalPages: 0 })

function reportTagType(label) {
  return label === '已报餐' ? 'success' : 'info'
}

function formatWeekday(date) {
  const value = new Date(`${date}T00:00:00+08:00`)
  if (Number.isNaN(value.getTime())) return ''
  return new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', weekday: 'short' }).format(value)
}

const StatusCell = defineComponent({
  props: { meal: { type: Object, required: true } },
  setup(props) {
    return () => h('span', { class: 'status-cell' }, [
      h('span', props.meal.swipeTime || '—'),
      h('span', { class: ['inline-status-tag', props.meal.status] }, props.meal.statusLabel),
    ])
  },
})

async function loadRecords(page = pagination.value.page) {
  loading.value = true
  errorText.value = ''
  try {
    const response = await getDiningProfileMeals(scope.value, page)
    const data = response.data?.data || {}
    rows.value = Array.isArray(data.rows) ? data.rows : []
    pagination.value = { ...pagination.value, ...(data.pagination || {}) }
  } catch (error) {
    if (Number(error?.response?.status) === 401) {
      clearDiningAuth()
      await router.replace('/dining/login')
      return
    }
    errorText.value = String(error?.response?.data?.msg ?? '').trim() || '读取个人用餐记录失败，请稍后重试'
  } finally {
    loaded.value = true
    loading.value = false
  }
}

async function switchScope(nextScope) {
  if (scope.value === nextScope) return
  scope.value = nextScope
  await loadRecords(1)
}

async function changePage(page) {
  if (page < 1 || page > pagination.value.totalPages || loading.value) return
  await loadRecords(page)
}

onMounted(loadRecords)
</script>

<style scoped>
.profile-page { max-width:1100px; margin:0 auto; }
.profile-toolbar { display:flex; align-items:center; justify-content:space-between; gap:18px; padding:22px 24px; border:1px solid #dce8f3; border-radius:16px; background:#fff; box-shadow:0 8px 24px rgba(40,77,115,.05); }
.profile-toolbar h1 { margin:0; color:#1f436b; font-size:24px; }
.profile-toolbar p { margin:7px 0 0; color:#8294aa; font-size:13px; }
.toolbar-actions { display:flex; flex:0 0 auto; gap:8px; }
.toolbar-actions .el-button { margin:0; }
.profile-alert { margin-top:16px; }
.profile-summary { display:flex; align-items:center; min-height:54px; gap:8px; color:#71859d; font-size:14px; }
.profile-summary strong { color:#2366a0; }
.profile-summary .el-button { margin-left:auto; }
.records-table { width:100%; border:1px solid #e0eaf4; border-radius:14px; overflow:hidden; }
:deep(.status-cell) { display:inline-flex; align-items:center; gap:8px; color:#617890; }
:deep(.inline-status-tag) { display:inline-flex; align-items:center; min-height:24px; padding:0 7px; border:1px solid #d9e2ec; border-radius:4px; color:#7d8c9f; background:#f4f6f8; font-size:12px; line-height:1; }
:deep(.inline-status-tag.swiped) { border-color:#b3e1c4; color:#1d7c48; background:#eff9f2; }
:deep(.inline-status-tag.missed) { border-color:#f3c4c4; color:#c45656; background:#fef0f0; }
:deep(.inline-status-tag.pending) { border-color:#f3d19e; color:#b88230; background:#fdf6ec; }
.mobile-records { display:none; }
.profile-loading { min-height:260px; display:flex; align-items:center; justify-content:center; gap:10px; color:#71859d; }
.profile-pagination { display:flex; align-items:center; justify-content:flex-end; gap:8px; margin-top:16px; color:#71859d; font-size:13px; }
.profile-pagination .el-button { margin:0; }
@media (max-width: 760px) {
  .profile-toolbar { align-items:stretch; flex-direction:column; padding:18px 16px; }
  .profile-toolbar h1 { font-size:21px; }
  .toolbar-actions { width:100%; }
  .toolbar-actions .el-button { flex:1; min-height:40px; }
  .desktop-records { display:none; }
  .mobile-records { display:grid; gap:10px; }
  .record-card { display:grid; gap:10px; padding:14px; border:1px solid #dce8f3; border-radius:13px; background:#fff; box-shadow:0 5px 15px rgba(40,77,115,.04); }
  .record-date { color:#1f436b; font-size:16px; }
  .meal-row { display:grid; grid-template-columns:34px 70px minmax(0,1fr); align-items:center; gap:8px; padding-top:10px; border-top:1px solid #edf2f7; color:#5d7690; font-size:13px; }
  .meal-row :deep(.status-cell) { justify-content:flex-end; gap:6px; white-space:nowrap; }
  .profile-pagination { justify-content:space-between; gap:6px; }
  .profile-pagination span { margin-right:auto; }
  .profile-pagination .el-button { min-height:38px; padding:0 10px; }
}
</style>
