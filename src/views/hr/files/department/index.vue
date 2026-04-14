<template>
  <div class="erp-module-page">
    <!--
     旧系统部门表：主键为 code；审核字段 pass（'1'已审）；del 为逻辑删除。
      顶部新增/刷新；搜索 name、code；表格分页默认 20；已审行禁用编辑/删除。
    -->
    <el-card shadow="never">
      <template #header>
        <span class="page-title">{{ pageTitle }}</span>
      </template>
      <p class="page-desc">
        数据表由环境变量 <code>HR_LEGACY_DEPT_TABLE</code> 指定（默认 <code>HR_Departments</code>）。列表表头为中文；库内字段名仍为英文（如
        <code>pass</code>：值为 <code>1</code> 表示已审核并锁定改删）。删除为逻辑删除。
      </p>

      <div class="operator-toolbar">
        <el-button v-permission="'add'" class="toolbar-btn btn-action" @click="openCreate">
          <el-icon class="btn-icon"><Plus /></el-icon>
          新增部门
        </el-button>
        <el-button class="toolbar-btn btn-view" :loading="loading" @click="loadList">
          <el-icon class="btn-icon"><Refresh /></el-icon>
          刷新
        </el-button>
      </div>

      <div class="search-row">
        <el-input
          v-model="keyword"
          placeholder="模糊搜索：部门名称、部门编码"
          clearable
          style="max-width: 380px"
          @keyup.enter="onSearch"
        />
        <el-button type="primary" @click="onSearch">查询</el-button>
        <el-button @click="onReset">重置</el-button>
      </div>

      <el-alert v-if="errorMessage" :title="errorMessage" type="error" show-icon class="error-alert" />

      <el-skeleton :loading="loading" animated :rows="8">
        <template #default>
          <el-table
            :data="tableList"
            row-key="code"
            border
            stripe
            style="width: 100%"
            :empty-text="loading ? '加载中…' : '暂无数据'"
          >
            <el-table-column prop="code" label="部门编码" min-width="100" show-overflow-tooltip />
            <el-table-column prop="name" label="部门名称" min-width="140" show-overflow-tooltip />
            <el-table-column prop="manager" label="负责人" min-width="100" show-overflow-tooltip>
              <template #default="{ row }">{{ row.manager ?? '—' }}</template>
            </el-table-column>
            <el-table-column prop="flag" label="标志" width="80" show-overflow-tooltip>
              <template #default="{ row }">{{ row.flag ?? '—' }}</template>
            </el-table-column>
            <el-table-column label="审核状态" min-width="96">
              <template #default="{ row }">
                <el-tag v-if="rowIsAudited(row)" type="success" effect="light">已审核</el-tag>
                <el-tag v-else type="info" effect="light">未审核</el-tag>
              </template>
            </el-table-column>
            <el-table-column prop="passutruename" label="审核人" min-width="110" show-overflow-tooltip>
              <template #default="{ row }">{{ row.passutruename ?? '—' }}</template>
            </el-table-column>
            <el-table-column prop="passtime" label="审核时间" min-width="150" show-overflow-tooltip>
              <template #default="{ row }">{{ row.passtime ?? '—' }}</template>
            </el-table-column>
            <el-table-column label="操作" min-width="320" fixed="right">
              <template #default="{ row }">
                <el-button v-permission="'edit'" size="small" :disabled="rowIsAudited(row)" @click="openEdit(row)">
                  编辑
                </el-button>
                <el-button
                  v-permission="'delete'"
                  size="small"
                  type="danger"
                  :disabled="rowIsAudited(row)"
                  @click="confirmDelete(row)"
                >
                  删除
                </el-button>
                <el-button
                  v-permission="'audit'"
                  size="small"
                  type="success"
                  plain
                  :disabled="rowIsAudited(row)"
                  @click="doAudit(row)"
                >
                  审核
                </el-button>
                <el-button
                  v-permission="'audit'"
                  size="small"
                  type="warning"
                  plain
                  :disabled="!rowIsAudited(row)"
                  @click="doUnaudit(row)"
                >
                  反审
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
        </template>
      </el-skeleton>
    </el-card>

    <el-dialog v-model="dialogVisible" :title="dialogTitle" width="480px" destroy-on-close>
      <el-form ref="formRef" :model="form" :rules="formRules" label-width="100px">
        <el-form-item label="部门编码" prop="code">
          <el-input v-model="form.code" :disabled="dialogMode === 'edit'" maxlength="50" placeholder="部门编码（唯一）" />
        </el-form-item>
        <el-form-item label="部门名称" prop="name">
          <el-input v-model="form.name" maxlength="50" placeholder="请输入部门名称" />
        </el-form-item>
        <el-form-item label="负责人" prop="manager">
          <el-input v-model="form.manager" maxlength="50" placeholder="负责人（可空）" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="submitting" @click="submitForm">确定</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import axios from 'axios'
import { Plus, Refresh } from '@element-plus/icons-vue'

/** 页面标题 */
const pageTitle = '部门资料'

const tableList = ref([])
const total = ref(0)
const loading = ref(false)
const errorMessage = ref('')
const keyword = ref('')
const page = ref(1)
/** 默认每页 20 条（旧表数据量可能较大） */
const pageSize = ref(20)

const dialogVisible = ref(false)
const dialogMode = ref('create')
const submitting = ref(false)
const formRef = ref()
const form = ref({
  code: '',
  name: '',
  manager: '',
})

const dialogTitle = computed(() => (dialogMode.value === 'edit' ? '编辑部门' : '新增部门'))

const formRules = {
  code: [{ required: true, message: '请输入部门编码', trigger: 'blur' }],
  name: [{ required: true, message: '请输入部门名称', trigger: 'blur' }],
}

/** pass === '1' 为已审核 */
function rowIsAudited(row) {
  return String(row?.pass ?? '').trim() === '1'
}

async function loadList() {
  loading.value = true
  errorMessage.value = ''
  try {
    const k = String(keyword.value ?? '').trim()
    const res = await axios.get('/api/hr/departments', {
      params: {
        page: page.value,
        pageSize: pageSize.value,
        ...(k ? { keyword: k } : {}),
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
    const msg = e?.response?.data?.msg
    errorMessage.value = String(msg ?? e?.message ?? '请求失败')
    tableList.value = []
    total.value = 0
  } finally {
    loading.value = false
  }
}

function onSearch() {
  page.value = 1
  loadList()
}

function onReset() {
  keyword.value = ''
  page.value = 1
  loadList()
}

function onPageSizeChange(size) {
  pageSize.value = size
  page.value = 1
  loadList()
}

function onPageChange(p) {
  page.value = p
  loadList()
}

function openCreate() {
  dialogMode.value = 'create'
  form.value = { code: '', name: '', manager: '' }
  dialogVisible.value = true
}

function openEdit(row) {
  if (rowIsAudited(row)) return
  dialogMode.value = 'edit'
  form.value = {
    code: String(row?.code ?? ''),
    name: String(row?.name ?? ''),
    manager: String(row?.manager ?? ''),
  }
  dialogVisible.value = true
}

async function submitForm() {
  try {
    await formRef.value?.validate()
  } catch {
    return
  }
  submitting.value = true
  try {
    const payload = {
      code: form.value.code.trim(),
      name: form.value.name.trim(),
      manager: String(form.value.manager ?? '').trim(),
    }
    if (dialogMode.value === 'edit') {
      const res = await axios.put('/api/hr/departments', payload)
      const body = res.data
      if (body?.code !== 200) {
        ElMessage.error(String(body?.msg ?? '保存失败'))
        return
      }
      ElMessage.success('已保存')
    } else {
      const res = await axios.post('/api/hr/departments', payload)
      const body = res.data
      if (body?.code !== 200) {
        ElMessage.error(String(body?.msg ?? '新增失败'))
        return
      }
      ElMessage.success('已新增')
    }
    dialogVisible.value = false
    await loadList()
  } catch (e) {
    const msg = e?.response?.data?.msg
    ElMessage.error(String(msg ?? e?.message ?? '请求失败'))
  } finally {
    submitting.value = false
  }
}

async function confirmDelete(row) {
  if (rowIsAudited(row)) {
    ElMessage.warning('该记录已审核锁定，请反审后再操作')
    return
  }
  const code = String(row?.code ?? '')
  try {
    await ElMessageBox.confirm(`确定逻辑删除部门「${row.name}」（code=${code}）吗？`, '确认删除', {
      type: 'warning',
    })
  } catch {
    return
  }
  try {
    const res = await axios.delete(`/api/hr/departments/${encodeURIComponent(code)}`)
    const body = res.data
    if (body?.code !== 200) {
      ElMessage.error(String(body?.msg ?? '删除失败'))
      return
    }
    ElMessage.success('已删除')
    await loadList()
  } catch (e) {
    const msg = e?.response?.data?.msg
    ElMessage.error(String(msg ?? e?.message ?? '请求失败'))
  }
}

async function doAudit(row) {
  if (rowIsAudited(row)) return
  try {
    await ElMessageBox.confirm(
      `确定审核「${row.name}」（code=${row.code}）吗？审核后锁定编辑/删除，需反审才可改。`,
      '确认审核',
      { type: 'warning' }
    )
  } catch {
    return
  }
  try {
    const res = await axios.put('/api/hr/departments/audit', { code: row.code })
    const body = res.data
    if (body?.code !== 200) {
      ElMessage.error(String(body?.msg ?? '审核失败'))
      return
    }
    ElMessage.success('已审核')
    await loadList()
  } catch (e) {
    const msg = e?.response?.data?.msg
    ElMessage.error(String(msg ?? e?.message ?? '请求失败'))
  }
}

async function doUnaudit(row) {
  if (!rowIsAudited(row)) return
  try {
    await ElMessageBox.confirm(`确定反审部门「${row.name}」吗？反审后可再编辑或删除。`, '确认反审', {
      type: 'warning',
    })
  } catch {
    return
  }
  try {
    const res = await axios.put('/api/hr/departments/unaudit', { code: row.code })
    const body = res.data
    if (body?.code !== 200) {
      ElMessage.error(String(body?.msg ?? '反审失败'))
      return
    }
    ElMessage.success('已反审')
    await loadList()
  } catch (e) {
    const msg = e?.response?.data?.msg
    ElMessage.error(String(msg ?? e?.message ?? '请求失败'))
  }
}

onMounted(() => {
  loadList()
})
</script>

<style scoped>
.erp-module-page {
  min-height: 200px;
}
.page-title {
  font-size: 18px;
  font-weight: 600;
}
.page-desc {
  margin: 0 0 8px;
  color: var(--el-text-color-secondary);
  line-height: 1.5;
}
.error-alert {
  margin: 12px 0;
}
.search-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 8px 0 12px;
}
.operator-toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin: 10px 0 12px;
}
.toolbar-btn {
  height: 45px;
  padding: 0 18px;
  border-radius: 8px;
  font-weight: 500;
}
.btn-icon {
  margin-right: 8px;
}
.btn-action {
  background-color: #d6ecff;
  border-color: #bcdfff;
  color: #1f5faa;
}
.btn-view {
  background-color: #d6ecff;
  border-color: #bcdfff;
  color: #1f5faa;
}
.pagination-row {
  display: flex;
  justify-content: flex-end;
  margin-top: 12px;
}
</style>
