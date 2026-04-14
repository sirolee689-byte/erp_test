<template>
  <div class="erp-module-page">
    <!--
      v1.0.9 人事档案精简管理（Hr_staff）
      - 只加载有效字段：code/name/sex/in_bm/card_number/meal_type/intime/pass
      - 搜索：name 模糊优先；否则 code 精确；否则 card_number 精确
      - pass='1'：禁用编辑/删除；审核/反审互斥
      - card_number 不足 10 位：红字提示
    -->
    <el-card shadow="never">
      <template #header>
        <span class="page-title">{{ pageTitle }}</span>
      </template>
      <p class="page-desc">仅展示必用字段；已审核（pass=1）记录锁定，编辑与删除需先反审。</p>

      <div class="operator-toolbar">
        <el-button v-permission="'add'" class="toolbar-btn btn-action" @click="openCreate">
          <el-icon class="btn-icon"><Plus /></el-icon>
          新增员工
        </el-button>
        <el-button class="toolbar-btn btn-view" :loading="loading" @click="loadList">
          <el-icon class="btn-icon"><Refresh /></el-icon>
          刷新
        </el-button>
      </div>

      <div class="search-row">
        <el-input
          v-model="qName"
          placeholder="姓名（模糊，优先）"
          clearable
          style="max-width: 220px"
          @keyup.enter="onSearch"
        />
        <el-input
          v-model="qCode"
          placeholder="工号（精确）"
          clearable
          style="max-width: 180px"
          @keyup.enter="onSearch"
        />
        <el-input
          v-model="qCard"
          placeholder="10位卡号（精确）"
          clearable
          style="max-width: 180px"
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
            <el-table-column prop="code" label="工号" min-width="100" show-overflow-tooltip />
            <el-table-column prop="name" label="姓名" min-width="110" show-overflow-tooltip />
            <el-table-column prop="sex" label="性别" width="70" show-overflow-tooltip />
            <el-table-column prop="in_bm" label="部门" min-width="120" show-overflow-tooltip />
            <el-table-column label="10位卡号" min-width="120" show-overflow-tooltip>
              <template #default="{ row }">
                <span :class="{ 'warn-text': cardNumberTooShort(row?.card_number) }">
                  {{ row?.card_number ?? '—' }}
                </span>
                <span v-if="cardNumberTooShort(row?.card_number)" class="warn-text-sub">（不足10位）</span>
              </template>
            </el-table-column>
            <el-table-column prop="meal_type" label="报餐类型" min-width="90" show-overflow-tooltip />
            <el-table-column prop="intime" label="入职时间" min-width="140" show-overflow-tooltip />
            <el-table-column label="审核状态" width="90">
              <template #default="{ row }">
                <el-tag v-if="rowIsAudited(row)" type="success" effect="light">已审核</el-tag>
                <el-tag v-else type="info" effect="light">未审核</el-tag>
              </template>
            </el-table-column>
            <el-table-column label="操作" min-width="360" fixed="right">
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

    <el-dialog v-model="dialogVisible" :title="dialogTitle" width="520px" destroy-on-close>
      <el-form ref="formRef" :model="form" :rules="formRules" label-width="100px">
        <el-form-item label="工号" prop="code">
          <el-input v-model="form.code" :disabled="dialogMode === 'edit'" maxlength="50" placeholder="请输入工号" />
        </el-form-item>
        <el-form-item label="姓名" prop="name">
          <el-input v-model="form.name" maxlength="50" placeholder="请输入姓名" />
        </el-form-item>
        <el-form-item label="性别" prop="sex">
          <el-input v-model="form.sex" maxlength="50" placeholder="男/女（可空）" />
        </el-form-item>
        <el-form-item label="部门" prop="in_bm">
          <el-input v-model="form.in_bm" maxlength="100" placeholder="部门（可空）" />
        </el-form-item>
        <el-form-item label="10位卡号" prop="card_number">
          <el-input v-model="form.card_number" maxlength="50" placeholder="卡号（可空）" />
        </el-form-item>
        <el-form-item label="报餐类型" prop="meal_type">
          <el-input v-model="form.meal_type" maxlength="50" placeholder="报餐类型（可空）" />
        </el-form-item>
        <el-form-item label="入职时间" prop="intime">
          <el-input v-model="form.intime" maxlength="50" placeholder="入职时间（可空）" />
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

/** 页面标题（与左侧菜单一致） */
const pageTitle = '员工档案资料'

const tableList = ref([])
const total = ref(0)
const loading = ref(false)
const errorMessage = ref('')

/** 搜索条件（name 模糊优先） */
const qName = ref('')
const qCode = ref('')
const qCard = ref('')

const page = ref(1)
/** 默认每页 20（数据量大） */
const pageSize = ref(20)

const dialogVisible = ref(false)
const dialogMode = ref('create')
const submitting = ref(false)
const formRef = ref()
const form = ref({
  code: '',
  name: '',
  sex: '',
  in_bm: '',
  card_number: '',
  meal_type: '',
  intime: '',
})

const dialogTitle = computed(() => (dialogMode.value === 'edit' ? '编辑员工' : '新增员工'))

const formRules = {
  code: [{ required: true, message: '请输入工号', trigger: 'blur' }],
  name: [{ required: true, message: '请输入姓名', trigger: 'blur' }],
}

/** pass === '1' 为已审核 */
function rowIsAudited(row) {
  return String(row?.pass ?? '').trim() === '1'
}

/** card_number 不足 10 位提示（空值不提示） */
function cardNumberTooShort(v) {
  const s = String(v ?? '').trim()
  if (!s) return false
  return s.length < 10
}

/** 组装搜索参数：name 优先，其次 code，其次 card_number */
function buildQueryParams() {
  const name = String(qName.value ?? '').trim()
  const code = String(qCode.value ?? '').trim()
  const card = String(qCard.value ?? '').trim()
  if (name) return { name }
  if (code) return { code }
  if (card) return { card_number: card }
  return {}
}

async function loadList() {
  loading.value = true
  errorMessage.value = ''
  try {
    const res = await axios.get('/api/hr/staff', {
      params: {
        page: page.value,
        pageSize: pageSize.value,
        ...buildQueryParams(),
      },
    })
    const body = res.data
    if (body?.code !== 200) {
      errorMessage.value = String(body?.msg ?? '加载失败')
      tableList.value = []
      total.value = 0
      return
    }
    tableList.value = Array.isArray(body?.data?.list) ? body.data.list : []
    total.value = Number(body?.data?.total ?? 0)
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
  qName.value = ''
  qCode.value = ''
  qCard.value = ''
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
  form.value = { code: '', name: '', sex: '', in_bm: '', card_number: '', meal_type: '', intime: '' }
  dialogVisible.value = true
}

function openEdit(row) {
  if (rowIsAudited(row)) return
  dialogMode.value = 'edit'
  form.value = {
    code: String(row?.code ?? ''),
    name: String(row?.name ?? ''),
    sex: String(row?.sex ?? ''),
    in_bm: String(row?.in_bm ?? ''),
    card_number: String(row?.card_number ?? ''),
    meal_type: String(row?.meal_type ?? ''),
    intime: String(row?.intime ?? ''),
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
      code: String(form.value.code ?? '').trim(),
      name: String(form.value.name ?? '').trim(),
      sex: String(form.value.sex ?? '').trim(),
      in_bm: String(form.value.in_bm ?? '').trim(),
      card_number: String(form.value.card_number ?? '').trim(),
      meal_type: String(form.value.meal_type ?? '').trim(),
      intime: String(form.value.intime ?? '').trim(),
    }
    if (dialogMode.value === 'edit') {
      const res = await axios.put('/api/hr/staff', payload)
      const body = res.data
      if (body?.code !== 200) {
        ElMessage.error(String(body?.msg ?? '保存失败'))
        return
      }
      ElMessage.success('已保存')
    } else {
      const res = await axios.post('/api/hr/staff', payload)
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
    await ElMessageBox.confirm(`确定删除员工「${row?.name}」（工号=${code}）吗？`, '确认删除', { type: 'warning' })
  } catch {
    return
  }
  try {
    const res = await axios.delete(`/api/hr/staff/${encodeURIComponent(code)}`)
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
      `确定审核员工「${row?.name}」（工号=${row?.code}）吗？审核后将锁定编辑/删除，需反审后再操作。`,
      '确认审核',
      { type: 'warning' }
    )
  } catch {
    return
  }
  try {
    const res = await axios.put('/api/hr/staff/audit', { code: row.code })
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
    await ElMessageBox.confirm(`确定反审员工「${row?.name}」吗？反审后可再编辑或删除。`, '确认反审', {
      type: 'warning',
    })
  } catch {
    return
  }
  try {
    const res = await axios.put('/api/hr/staff/unaudit', { code: row.code })
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
  margin: 0;
  color: var(--el-text-color-secondary);
}

.error-alert {
  margin: 12px 0;
}
.search-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
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
.warn-text {
  color: #d12f19;
  font-weight: 700;
}
.warn-text-sub {
  color: #d12f19;
  margin-left: 6px;
}
</style>
