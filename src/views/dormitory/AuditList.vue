<template>
  <div class="audit-list-root">
    <p class="page-desc">
      数据来自 <code>Hr_room_in</code>（<code>del='0'</code>）+ <code>Hr_staff</code> + <code>HR_Departments</code> 联查；部门列仅展示
      <code>HR_Departments.name</code>。入住时间、<code>staff_truename</code> 与库端字段一致。
    </p>
    <div class="toolbar-row">
      <div class="audit-switch">
        <span class="switch-label">显示已审核</span>
        <el-switch v-model="showAudited" data-testid="switch-show-audited" />
      </div>
      <el-button type="primary" plain :loading="loading" @click="loadData">刷新</el-button>
    </div>
    <div class="search-row">
      <el-input
        v-model="keyword"
        placeholder="支持回车：工号、姓名、房号、部门名、备注"
        clearable
        style="max-width: 420px"
        data-testid="audit-keyword-input"
        @keyup.enter="onSearch"
      />
      <el-button type="primary" @click="onSearch">查询</el-button>
      <el-button @click="onReset">重置</el-button>
    </div>
    <el-alert v-if="errorMessage" :title="errorMessage" type="error" show-icon class="mb-12" />
    <el-alert
      v-if="showAudited"
      title="当前列表：已审核（pass=1），可操作【反审核】"
      type="success"
      show-icon
      class="mb-12"
    />
    <el-alert
      v-else
      title="当前列表：未审核（pass=0），可操作【通过审核】或【删除】（物理删除，不可恢复）"
      type="info"
      show-icon
      class="mb-12"
    />

    <el-table
      data-testid="audit-apply-table"
      :data="tableList"
      row-key="id"
      :row-class-name="auditTableRowClassName"
      border
      stripe
      class="lodging-table"
      :empty-text="loading ? '加载中…' : '暂无数据'"
    >
      <el-table-column prop="apply_date" label="申请日期" min-width="110" align="center" show-overflow-tooltip />
      <el-table-column prop="in_time" label="入住时间" min-width="120" align="center" show-overflow-tooltip />
      <el-table-column prop="staff_code" label="工号" min-width="100" align="center" show-overflow-tooltip />
      <el-table-column prop="emp_name" label="姓名" min-width="100" align="center" show-overflow-tooltip />
      <el-table-column label="部门" min-width="130" align="center" show-overflow-tooltip>
        <template #default="{ row }">{{ formatDeptName(row) }}</template>
      </el-table-column>
      <el-table-column prop="room_code" label="宿舍号" min-width="90" align="center" show-overflow-tooltip />
      <el-table-column prop="room_info" label="备注" min-width="140" align="center" show-overflow-tooltip>
        <template #default="{ row }">{{ row?.room_info?.trim?.() ? row.room_info : '—' }}</template>
      </el-table-column>
      <el-table-column label="状态" width="100" align="center">
        <template #default="{ row }">
          <el-tag v-if="String(row?.pass ?? '').trim() === '1'" type="success" size="small" data-testid="tag-pass-1">已审核</el-tag>
          <el-tag v-else type="info" size="small" data-testid="tag-pass-0">未审核</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="操作" min-width="200" fixed="right" align="center">
        <template #default="{ row }">
          <div v-if="String(row?.pass ?? '').trim() === '0'" class="audit-actions">
            <el-button
              v-permission="'audit'"
              type="primary"
              size="small"
              plain
              data-testid="btn-pass-audit"
              @click="onPassAudit(row)"
            >
              通过审核
            </el-button>
            <el-button
              v-permission="'audit'"
              type="danger"
              size="small"
              plain
              data-testid="btn-delete-checkin"
              @click="onHardDeleteCheckin(row)"
            >
              删除
            </el-button>
          </div>
          <el-button
            v-else-if="String(row?.pass ?? '').trim() === '1'"
            v-permission="'audit'"
            type="warning"
            size="small"
            plain
            data-testid="btn-un-audit"
            @click="onUnAudit(row)"
          >
            反审核
          </el-button>
        </template>
      </el-table-column>
    </el-table>

    <div class="pagination-row">
      <el-pagination
        background
        layout="total, sizes, prev, pager, next, jumper"
        :total="total"
        :current-page="page"
        :page-size="pageSize"
        :page-sizes="[10, 20, 50, 100]"
        @size-change="onPageSizeChange"
        @current-change="onPageChange"
      />
    </div>
  </div>
</template>

<script setup>
import { ref, watch, onMounted } from 'vue'
import axios from 'axios'
import { ElMessage, ElMessageBox } from 'element-plus'

const emit = defineEmits(['dorm-data-changed'])

const loading = ref(false)
const errorMessage = ref('')
const tableList = ref([])
const total = ref(0)
const page = ref(1)
const pageSize = ref(20)
const keyword = ref('')
/** 显示已审核：开=pass1，关=pass0 */
const showAudited = ref(false)

function passParam() {
  return showAudited.value ? '1' : '0'
}

/** 仅展示 HR_Departments.name（dept_name），不回退为部门编码 */
function formatDeptName(row) {
  const n = row?.dept_name != null ? String(row.dept_name).trim() : ''
  return n || '—'
}

/** E2E 等场景按记录 id 稳定定位 tbody 行（勿删：与 scripts/e2e-dormitory-audit-reverse-toggle 联动） */
function auditTableRowClassName({ row }) {
  const id = Number(row?.id)
  if (!Number.isFinite(id) || id <= 0) return ''
  return `audit-row-id-${id}`
}

async function loadData() {
  loading.value = true
  errorMessage.value = ''
  try {
    const q = String(keyword.value ?? '').trim()
    const res = await axios.get('/api/hr/dormitory/lodging-in/audit-center-list', {
      params: {
        page: page.value,
        pageSize: pageSize.value,
        pass: passParam(),
        ...(q ? { keyword: q } : {}),
      },
    })
    const body = res.data
    if (body?.code !== 200) {
      errorMessage.value = String(body?.msg ?? '加载失败')
      tableList.value = []
      total.value = 0
      return
    }
    const pack = body.data ?? {}
    tableList.value = Array.isArray(pack.list) ? pack.list : []
    total.value = Number(pack.total ?? 0)
  } catch (e) {
    errorMessage.value = String(e?.response?.data?.msg ?? e?.message ?? '请求失败')
    tableList.value = []
    total.value = 0
  } finally {
    loading.value = false
  }
}

function onSearch() {
  page.value = 1
  loadData()
}

function onReset() {
  keyword.value = ''
  page.value = 1
  loadData()
}

function onPageSizeChange(size) {
  pageSize.value = size
  page.value = 1
  loadData()
}

function onPageChange(p) {
  page.value = p
  loadData()
}

async function onPassAudit(row) {
  const id = Number(row?.id)
  if (!Number.isFinite(id) || id <= 0) {
    ElMessage.error('记录 id 无效')
    return
  }
  try {
    await ElMessageBox.confirm('确认将该入住申请审核为「已通过」（pass=1）？', '通过审核', {
      type: 'warning',
      confirmButtonText: '确定',
      cancelButtonText: '取消',
    })
  } catch {
    return
  }
  try {
    const res = await axios.put('/api/hr/dormitory/lodging-in/audit', { id })
    const body = res.data
    if (body?.code !== 200) {
      ElMessage.error(String(body?.msg ?? '操作失败'))
      return
    }
    ElMessage.success('已通过审核')
    await loadData()
    emit('dorm-data-changed')
  } catch (e) {
    ElMessage.error(String(e?.response?.data?.msg ?? e?.message ?? '操作失败'))
  }
}

async function onHardDeleteCheckin(row) {
  const id = Number(row?.id)
  if (!Number.isFinite(id) || id <= 0) {
    ElMessage.error('记录 id 无效')
    return
  }
  try {
    await ElMessageBox.confirm('此操作将永久删除该入住申请，不可恢复，是否确定？', '删除确认', {
      type: 'error',
      confirmButtonText: '确定删除',
      cancelButtonText: '取消',
    })
  } catch {
    return
  }
  try {
    const res = await axios.delete('/api/dorm/delete-checkin', { data: { id } })
    const body = res.data
    if (body?.code !== 200) {
      ElMessage.error(String(body?.msg ?? '操作失败'))
      return
    }
    ElMessage.success('已彻底删除')
    await loadData()
    emit('dorm-data-changed')
  } catch (e) {
    ElMessage.error(String(e?.response?.data?.msg ?? e?.message ?? '操作失败'))
  }
}

async function onUnAudit(row) {
  const id = Number(row?.id)
  if (!Number.isFinite(id) || id <= 0) {
    ElMessage.error('记录 id 无效')
    return
  }
  try {
    await ElMessageBox.confirm('确认将该记录反审核为「未审核」（pass=0）？', '反审核', {
      type: 'warning',
      confirmButtonText: '确定反审核',
      cancelButtonText: '取消',
    })
  } catch {
    return
  }
  try {
    const res = await axios.put('/api/dorm/un-audit', { id })
    const body = res.data
    if (body?.code !== 200) {
      ElMessage.error(String(body?.msg ?? '操作失败'))
      return
    }
    ElMessage.success('已反审核')
    await loadData()
    emit('dorm-data-changed')
  } catch (e) {
    ElMessage.error(String(e?.response?.data?.msg ?? e?.message ?? '操作失败'))
  }
}

watch(showAudited, () => {
  page.value = 1
  loadData()
})

onMounted(() => {
  loadData()
})

defineExpose({ loadData })
</script>

<style scoped>
.page-desc {
  margin: 0 0 12px;
  font-size: 13px;
  color: var(--el-text-color-secondary);
}
.page-desc code {
  font-size: 12px;
}
.toolbar-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px;
  margin-bottom: 10px;
}
.audit-switch {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}
.switch-label {
  font-size: 14px;
  color: var(--el-text-color-regular);
}
.search-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 12px;
}
.mb-12 {
  margin-bottom: 12px;
}
.pagination-row {
  display: flex;
  justify-content: flex-end;
  margin-top: 16px;
}
.lodging-table :deep(.el-table__header th.el-table__cell) {
  text-align: center;
  background: var(--el-fill-color-light);
}
.audit-actions {
  display: inline-flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: center;
  gap: 6px;
}
</style>
