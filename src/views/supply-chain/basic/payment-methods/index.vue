<template>
  <div class="erp-module-page">
    <el-card shadow="never">
      <template #header>
        <span class="page-title">{{ pageTitle }}</span>
      </template>
      <p class="page-desc">
        数据表 <code>System_settlement_method</code>；默认每页 20 条；已审核行不可编辑/删除，需先反审。
      </p>

      <div class="search-row">
        <el-input
          v-model="keyword"
          placeholder="按编码/名称/备注模糊搜索"
          clearable
          style="max-width: 360px"
          @keyup.enter="onSearch"
        />
        <div class="audit-switch">
          <span class="switch-label">回收站</span>
          <el-switch v-model="showRecycle" @change="onRecycleChange" />
        </div>
        <div v-if="!showRecycle" class="audit-switch">
          <span class="switch-label">显示未审核</span>
          <el-switch v-model="showUnAudited" @change="onSearch" />
        </div>
        <el-button type="primary" @click="onSearch">查询</el-button>
        <el-button @click="onReset">重置</el-button>
        <el-button v-if="!showRecycle" v-permission="'add'" type="success" plain @click="openCreateDialog">
          新增结算方式
        </el-button>
        <el-button class="btn-view" :loading="loading" @click="loadData">
          <el-icon class="btn-icon"><Refresh /></el-icon>
          刷新
        </el-button>
      </div>

      <el-alert v-if="errorMessage" :title="errorMessage" type="error" show-icon class="error-alert" />
      <el-alert
        v-if="showRecycle"
        title="当前为回收站视图：仅显示已逻辑删除（del=1）的记录；可恢复，或彻底删除（物理删除，不可恢复）。"
        type="info"
        show-icon
        class="audit-alert"
      />
      <el-alert
        v-else-if="showUnAudited"
        title="当前显示：未审核（pass=0）的结算方式"
        type="warning"
        show-icon
        class="audit-alert"
      />

      <div class="pagination-row pagination-row--top">
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

      <el-skeleton :loading="loading" animated :rows="6">
        <template #default>
          <el-table
            :data="tableList"
            border
            stripe
            row-key="id"
            style="width: 100%"
            :empty-text="loading ? '加载中…' : '暂无数据'"
          >
            <el-table-column prop="code" label="编码" min-width="120" show-overflow-tooltip>
              <template #default="{ row }">
                <span class="code-bold">{{ row.code || '—' }}</span>
              </template>
            </el-table-column>
            <el-table-column prop="name" label="名称" min-width="160" show-overflow-tooltip />
            <el-table-column prop="payfor" label="天数" width="100" show-overflow-tooltip />
            <el-table-column label="审核" width="100">
              <template #default="{ row }">
                <el-tag v-if="passIsAudited(row)" type="success" size="small">已审核</el-tag>
                <el-tag v-else type="warning" size="small">未审核</el-tag>
              </template>
            </el-table-column>
            <el-table-column label="操作" width="340" fixed="right">
              <template #default="{ row }">
                <template v-if="showRecycle">
                  <el-button
                    type="primary"
                    link
                    size="small"
                    :loading="busyId === row.id"
                    @click="onRestore(row)"
                  >
                    恢复
                  </el-button>
                  <el-button
                    v-permission="'delete'"
                    type="danger"
                    link
                    size="small"
                    :loading="busyId === row.id"
                    @click="onHardDelete(row)"
                  >
                    彻底删除
                  </el-button>
                </template>
                <template v-else>
                  <el-button
                    v-if="showUnAudited"
                    v-permission="'edit'"
                    type="success"
                    link
                    size="small"
                    :disabled="passIsAudited(row)"
                    :loading="busyId === row.id"
                    @click="openEditDialog(row)"
                  >
                    编辑
                  </el-button>
                  <el-button
                    type="primary"
                    link
                    size="small"
                    :disabled="passIsAudited(row)"
                    :loading="busyId === row.id"
                    @click="onAudit(row)"
                  >
                    审核
                  </el-button>
                  <el-button
                    type="warning"
                    link
                    size="small"
                    :disabled="!passIsAudited(row)"
                    :loading="busyId === row.id"
                    @click="onUnaudit(row)"
                  >
                    反审
                  </el-button>
                  <el-button
                    type="danger"
                    link
                    size="small"
                    :disabled="passIsAudited(row)"
                    :loading="busyId === row.id"
                    @click="onSoftDelete(row)"
                  >
                    删除
                  </el-button>
                </template>
              </template>
            </el-table-column>
          </el-table>

          <div class="pagination-row pagination-row--bottom">
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

    <el-dialog v-model="createVisible" title="新增结算方式" width="560px" destroy-on-close @closed="resetCreateForm">
      <el-form ref="createFormRef" :model="createForm" :rules="createRules" label-width="120px">
        <el-form-item label="编码" prop="code">
          <el-input v-model="createForm.code" maxlength="50" show-word-limit placeholder="自动生成（可修改）" />
        </el-form-item>
        <el-form-item label="名称" prop="name">
          <el-input v-model="createForm.name" maxlength="200" show-word-limit placeholder="必填" />
        </el-form-item>
        <el-form-item label="天数" prop="payfor">
          <el-input v-model="createForm.payfor" maxlength="50" show-word-limit placeholder="必填，如 30" />
        </el-form-item>
        <el-form-item label="备注" prop="info">
          <el-input v-model="createForm.info" type="textarea" :rows="4" maxlength="500" show-word-limit placeholder="选填" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="createVisible = false">取消</el-button>
        <el-button type="primary" :loading="createSubmitting" @click="submitCreate">提交</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="editVisible" title="编辑结算方式" width="560px" destroy-on-close @closed="resetEditForm">
      <el-form ref="editFormRef" :model="editForm" :rules="editRules" label-width="120px">
        <el-form-item label="编码" prop="code">
          <el-input v-model="editForm.code" disabled />
        </el-form-item>
        <el-form-item label="名称" prop="name">
          <el-input v-model="editForm.name" maxlength="200" show-word-limit placeholder="必填" />
        </el-form-item>
        <el-form-item label="天数" prop="payfor">
          <el-input v-model="editForm.payfor" maxlength="50" show-word-limit placeholder="必填，如 30" />
        </el-form-item>
        <el-form-item label="备注" prop="info">
          <el-input v-model="editForm.info" type="textarea" :rows="4" maxlength="500" show-word-limit placeholder="选填" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="editVisible = false">取消</el-button>
        <el-button type="primary" :loading="editSubmitting" @click="submitEdit">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref } from 'vue'
import axios from 'axios'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Refresh } from '@element-plus/icons-vue'

/** 页面标题（与左侧菜单一致） */
const pageTitle = '结算方式'

const loading = ref(false)
const errorMessage = ref('')
const tableList = ref([])
const total = ref(0)
const page = ref(1)
const pageSize = ref(20)
const keyword = ref('')
const showUnAudited = ref(false)
const showRecycle = ref(false)
/** 当前正在请求后端的行主键（用于按钮 loading） */
const busyId = ref(0)

const createVisible = ref(false)
const createSubmitting = ref(false)
const createFormRef = ref()
const createForm = ref({
  code: '',
  name: '',
  payfor: '',
  info: '',
})

const createRules = {
  code: [{ required: true, message: '请输入编码', trigger: 'blur' }],
  name: [{ required: true, message: '请输入名称', trigger: 'blur' }],
  payfor: [{ required: true, message: '请输入天数', trigger: 'blur' }],
}

const editVisible = ref(false)
const editSubmitting = ref(false)
const editFormRef = ref()
const editForm = ref({
  id: 0,
  code: '',
  name: '',
  payfor: '',
  info: '',
})

const editRules = {
  name: [{ required: true, message: '请输入名称', trigger: 'blur' }],
  payfor: [{ required: true, message: '请输入天数', trigger: 'blur' }],
}

function passIsAudited(row) {
  return String(row?.pass ?? '').trim() === '1'
}

async function loadData() {
  loading.value = true
  errorMessage.value = ''
  try {
    const pass = showUnAudited.value ? '0' : '1'
    const kw = String(keyword.value ?? '').trim()
    const params = {
      page: page.value,
      pageSize: pageSize.value,
      ...(showRecycle.value ? { recycled: '1' } : { pass }),
      ...(kw ? { keyword: kw } : {}),
    }
    const res = await axios.get('/api/supply-chain/settlement-methods/list', { params })
    const body = res.data
    if (body?.code !== 200) {
      errorMessage.value = body?.msg || '加载失败'
      tableList.value = []
      total.value = 0
      return
    }
    const data = body.data ?? {}
    total.value = Number(data.total ?? 0)
    tableList.value = Array.isArray(data.list) ? data.list : []
  } catch (e) {
    errorMessage.value = String(e?.response?.data?.msg ?? e?.message ?? '网络错误')
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
  showUnAudited.value = false
  showRecycle.value = false
  page.value = 1
  loadData()
}

function onRecycleChange() {
  if (showRecycle.value) {
    showUnAudited.value = false
  }
  page.value = 1
  loadData()
}

function onPageChange(p) {
  page.value = p
  loadData()
}

function onPageSizeChange(ps) {
  pageSize.value = ps
  page.value = 1
  loadData()
}

async function onAudit(row) {
  const id = Number(row?.id)
  const name = String(row?.name ?? '').trim()
  if (!Number.isFinite(id) || id <= 0) return
  try {
    await ElMessageBox.confirm(`确认要审核【${name || row?.code || id}】吗？审核后将允许在业务单据中选用。`, '确认审核', {
      type: 'warning',
      confirmButtonText: '确定',
      cancelButtonText: '取消',
    })
  } catch {
    return
  }
  busyId.value = id
  try {
    const res = await axios.put('/api/supply-chain/settlement-methods/audit', { id })
    if (res.data?.code === 200) {
      ElMessage.success('审核成功')
      await loadData()
    } else {
      ElMessage.error(res.data?.msg || '审核失败')
    }
  } catch (e) {
    ElMessage.error(String(e?.response?.data?.msg ?? e?.message ?? '审核失败'))
  } finally {
    busyId.value = 0
  }
}

async function onUnaudit(row) {
  const id = Number(row?.id)
  const name = String(row?.name ?? '').trim()
  if (!Number.isFinite(id) || id <= 0) return
  try {
    await ElMessageBox.confirm(
      `确认要反审【${name || row?.code || id}】吗？反审后将禁止在业务单据中选用，已引用的业务不受影响。`,
      '确认反审',
      { type: 'warning', confirmButtonText: '确定', cancelButtonText: '取消' },
    )
  } catch {
    return
  }
  busyId.value = id
  try {
    const res = await axios.put('/api/supply-chain/settlement-methods/unaudit', { id })
    if (res.data?.code === 200) {
      ElMessage.success('反审成功')
      await loadData()
    } else {
      ElMessage.error(res.data?.msg || '反审失败')
    }
  } catch (e) {
    ElMessage.error(String(e?.response?.data?.msg ?? e?.message ?? '反审失败'))
  } finally {
    busyId.value = 0
  }
}

async function onSoftDelete(row) {
  const id = Number(row?.id)
  const name = String(row?.name ?? '').trim()
  if (!Number.isFinite(id) || id <= 0) return
  try {
    await ElMessageBox.confirm(
      `确认要删除【${name || row?.code || id}】吗？删除后将移入回收站，可在回收站恢复（已审核的需先反审）。`,
      '确认删除',
      { type: 'warning', confirmButtonText: '确定', cancelButtonText: '取消' },
    )
  } catch {
    return
  }
  busyId.value = id
  try {
    const res = await axios.delete(`/api/supply-chain/settlement-methods/${encodeURIComponent(String(id))}`)
    if (res.data?.code === 200) {
      ElMessage.success('已移入回收站')
      await loadData()
    } else {
      ElMessage.error(res.data?.msg || '删除失败')
    }
  } catch (e) {
    ElMessage.error(String(e?.response?.data?.msg ?? e?.message ?? '删除失败'))
  } finally {
    busyId.value = 0
  }
}

function openEditDialog(row) {
  editForm.value = {
    id: Number(row?.id ?? 0) || 0,
    code: String(row?.code ?? '').trim(),
    name: String(row?.name ?? '').trim(),
    payfor: String(row?.payfor ?? '').trim(),
    info: String(row?.info ?? '').trim(),
  }
  editFormRef.value?.clearValidate?.()
  editVisible.value = true
}

function resetEditForm() {
  editForm.value = { id: 0, code: '', name: '', payfor: '', info: '' }
  editFormRef.value?.resetFields?.()
}

async function submitEdit() {
  const form = editFormRef.value
  if (!form) return
  try {
    await form.validate()
  } catch {
    return
  }
  editSubmitting.value = true
  try {
    const payload = {
      id: Number(editForm.value.id),
      code: String(editForm.value.code ?? '').trim(),
      name: String(editForm.value.name ?? '').trim(),
      payfor: String(editForm.value.payfor ?? '').trim(),
      info: String(editForm.value.info ?? '').trim(),
    }
    const res = await axios.put('/api/supply-chain/settlement-methods', payload)
    if (res.data?.code === 200) {
      ElMessage.success('保存成功')
      editVisible.value = false
      resetEditForm()
      await loadData()
    } else {
      ElMessage.error(res.data?.msg || '保存失败')
    }
  } catch (e) {
    ElMessage.error(String(e?.response?.data?.msg ?? e?.message ?? '保存失败'))
  } finally {
    editSubmitting.value = false
  }
}

async function fetchSuggestedCode() {
  try {
    const res = await axios.get('/api/supply-chain/settlement-methods/suggest-code')
    if (res.data?.code === 200) {
      const c = String(res.data?.data?.suggestedCode ?? '').trim()
      if (c) return c
    }
  } catch {
    // 忽略：建议编码失败不阻断新增
  }
  return ''
}

async function openCreateDialog() {
  resetCreateForm()
  createVisible.value = true
  const suggested = await fetchSuggestedCode()
  if (suggested) {
    createForm.value.code = suggested
  }
}

function resetCreateForm() {
  createForm.value = { code: '', name: '', payfor: '', info: '' }
  createFormRef.value?.resetFields?.()
}

async function submitCreate() {
  const form = createFormRef.value
  if (!form) return
  try {
    await form.validate()
  } catch {
    return
  }
  createSubmitting.value = true
  try {
    const payload = {
      code: String(createForm.value.code ?? '').trim(),
      name: String(createForm.value.name ?? '').trim(),
      payfor: String(createForm.value.payfor ?? '').trim(),
      info: String(createForm.value.info ?? '').trim(),
    }
    const res = await axios.post('/api/supply-chain/settlement-methods', payload)
    if (res.data?.code === 200) {
      ElMessage.success('保存成功')
      createVisible.value = false
      resetCreateForm()
      await loadData()
    } else {
      ElMessage.error(res.data?.msg || '保存失败')
    }
  } catch (e) {
    ElMessage.error(String(e?.response?.data?.msg ?? e?.message ?? '保存失败'))
  } finally {
    createSubmitting.value = false
  }
}

async function onRestore(row) {
  const id = Number(row?.id)
  const name = String(row?.name ?? '').trim()
  if (!Number.isFinite(id) || id <= 0) return
  try {
    await ElMessageBox.confirm(`确认要恢复【${name || row?.code || id}】吗？恢复后将回到在册列表（按审核状态筛选）。`, '确认恢复', {
      type: 'warning',
      confirmButtonText: '确定',
      cancelButtonText: '取消',
    })
  } catch {
    return
  }
  busyId.value = id
  try {
    const res = await axios.put('/api/supply-chain/settlement-methods/restore', { id })
    if (res.data?.code === 200) {
      ElMessage.success('恢复成功')
      await loadData()
    } else {
      ElMessage.error(res.data?.msg || '恢复失败')
    }
  } catch (e) {
    ElMessage.error(String(e?.response?.data?.msg ?? e?.message ?? '恢复失败'))
  } finally {
    busyId.value = 0
  }
}

/** 回收站内物理删除（后端仅允许 del=1 的行） */
async function onHardDelete(row) {
  const id = Number(row?.id)
  const name = String(row?.name ?? '').trim()
  if (!Number.isFinite(id) || id <= 0) return
  try {
    await ElMessageBox.confirm(
      `确认要彻底删除【${name || row?.code || id}】吗？该操作不可恢复，请谨慎操作。`,
      '彻底删除',
      { type: 'error', confirmButtonText: '确定删除', cancelButtonText: '取消' },
    )
  } catch {
    return
  }
  busyId.value = id
  try {
    const res = await axios.delete(`/api/supply-chain/settlement-methods/${encodeURIComponent(String(id))}/permanent`)
    if (res.data?.code === 200) {
      ElMessage.success('已彻底删除')
      await loadData()
    } else {
      ElMessage.error(res.data?.msg || '彻底删除失败')
    }
  } catch (e) {
    ElMessage.error(String(e?.response?.data?.msg ?? e?.message ?? '彻底删除失败'))
  } finally {
    busyId.value = 0
  }
}

loadData()
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
  margin: 0 0 12px;
  color: var(--el-text-color-secondary);
  font-size: 13px;
}
.search-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
  margin-bottom: 12px;
}
.audit-switch {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}
.switch-label {
  font-size: 13px;
  color: var(--el-text-color-regular);
}
.btn-view {
  margin-left: auto;
}
.btn-icon {
  margin-right: 4px;
}
.error-alert,
.audit-alert {
  margin-bottom: 12px;
}
.code-bold {
  font-weight: 700;
}
</style>
