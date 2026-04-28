<template>
  <div class="erp-module-page">
    <el-card shadow="never">
      <template #header>
        <span class="page-title">{{ pageTitle }}</span>
      </template>
      <p class="page-desc">
        数据表 <code>System_sales_customer</code>；默认每页 20 条；已审核行不可编辑/删除，需先反审。
      </p>

      <div class="search-row">
        <el-input
          v-model="keyword"
          placeholder="按编码/名称/地址 模糊搜索"
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
          新增客户
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
        title="当前显示：未审核（pass=0）的销售客户"
        type="warning"
        show-icon
        class="audit-alert"
      />

      <el-skeleton :loading="loading" animated :rows="6">
        <template #default>
          <el-table :data="tableList" border stripe row-key="id" style="width: 100%" :empty-text="loading ? '加载中…' : '暂无数据'">
            <el-table-column prop="s_code" label="编码" width="140" fixed="left" show-overflow-tooltip>
              <template #default="{ row }">
                <span class="code-bold">{{ row.s_code || '—' }}</span>
              </template>
            </el-table-column>

            <el-table-column label="状态" width="110">
              <template #default="{ row }">
                <el-tag v-if="passIsAudited(row)" type="success" size="small">已审核</el-tag>
                <el-tag v-else type="warning" size="small">未审核</el-tag>
              </template>
            </el-table-column>

            <el-table-column prop="s_name" label="名称" min-width="220" show-overflow-tooltip />
            <el-table-column prop="s_address" label="地址" min-width="220" show-overflow-tooltip />

            <el-table-column label="联系方式" min-width="180">
              <template #default="{ row }">
                <div v-if="hasAnyContact(row)" class="multi-line">
                  <div v-if="normalizeCell(row.s_lxr)">{{ row.s_lxr }}</div>
                  <div v-if="normalizeCell(row.s_tel)">{{ row.s_tel }}</div>
                  <div v-if="normalizeCell(row.s_mobile)">{{ row.s_mobile }}</div>
                </div>
                <span v-else>—</span>
              </template>
            </el-table-column>

            <el-table-column prop="s_payfor" label="结算方式" min-width="160" show-overflow-tooltip />
            <el-table-column prop="lxr" label="本厂联系人" min-width="140" show-overflow-tooltip />
            <el-table-column prop="s_info" label="备注" min-width="220" show-overflow-tooltip />

            <el-table-column label="操作" width="420" fixed="right">
              <template #default="{ row }">
                <div class="op-btns">
                  <el-button size="small" type="primary" plain @click="openViewDialog(row)">查看</el-button>

                  <el-button
                    v-if="!showRecycle"
                    v-permission="'edit'"
                    size="small"
                    type="primary"
                    plain
                    @click="openEditDialog(row)"
                  >
                    编辑
                  </el-button>

                  <el-button
                    v-if="!showRecycle && !passIsAudited(row)"
                    v-permission="'audit'"
                    size="small"
                    type="success"
                    :loading="row.__opLoading === 'audit'"
                    @click="auditRow(row)"
                  >
                    审核
                  </el-button>
                  <el-button
                    v-if="!showRecycle && passIsAudited(row)"
                    v-permission="'audit'"
                    size="small"
                    type="warning"
                    plain
                    :loading="row.__opLoading === 'unaudit'"
                    @click="unauditRow(row)"
                  >
                    反审
                  </el-button>
                  <el-button
                    v-if="!showRecycle"
                    v-permission="'delete'"
                    size="small"
                    type="danger"
                    plain
                    :loading="row.__opLoading === 'delete'"
                    @click="softDeleteRow(row)"
                  >
                    删除
                  </el-button>

                  <el-button
                    v-if="showRecycle"
                    v-permission="'edit'"
                    size="small"
                    type="primary"
                    plain
                    :loading="row.__opLoading === 'restore'"
                    @click="restoreRow(row)"
                  >
                    恢复
                  </el-button>
                  <el-button
                    v-if="showRecycle"
                    v-permission="'delete'"
                    size="small"
                    type="danger"
                    plain
                    :loading="row.__opLoading === 'permanent'"
                    @click="permanentDeleteRow(row)"
                  >
                    彻底删除
                  </el-button>
                </div>
              </template>
            </el-table-column>
          </el-table>

          <div class="pager-row">
            <el-pagination
              v-model:current-page="page"
              v-model:page-size="pageSize"
              background
              layout="total, sizes, prev, pager, next, jumper"
              :total="total"
              :page-sizes="[10, 20, 50, 100]"
              @size-change="onPageSizeChange"
              @current-change="onPageChange"
            />
          </div>
        </template>
      </el-skeleton>

      <el-dialog
        v-model="dialogVisible"
        :title="dialogMode === 'create' ? '新增客户' : '编辑客户'"
        width="860px"
        :close-on-click-modal="false"
      >
        <el-form ref="formRef" :model="formModel" :rules="formRules" label-width="110px" class="customer-form">
          <el-row :gutter="16">
            <el-col :span="12">
              <el-form-item label="编码" prop="s_code">
                <el-input v-model="formModel.s_code" placeholder="请输入编码（手动输入）" clearable />
              </el-form-item>
            </el-col>
            <el-col :span="12">
              <el-form-item label="名称" prop="s_name">
                <el-input v-model="formModel.s_name" placeholder="请输入名称" clearable />
              </el-form-item>
            </el-col>

            <el-col :span="12">
              <el-form-item label="类别" prop="s_lb">
                <el-select v-model="formModel.s_lb" placeholder="请选择类别" clearable style="width: 100%">
                  <el-option v-for="opt in customerTypeOptions" :key="opt" :label="opt" :value="opt" />
                </el-select>
              </el-form-item>
            </el-col>
            <el-col :span="12">
              <el-form-item label="结算方式" prop="s_payfor">
                <el-select
                  v-if="settlementMethodOptions.length"
                  v-model="formModel.s_payfor"
                  placeholder="请选择结算方式（可不填）"
                  clearable
                  filterable
                  style="width: 100%"
                >
                  <el-option v-for="opt in settlementMethodOptions" :key="opt" :label="opt" :value="opt" />
                </el-select>
                <el-input v-else v-model="formModel.s_payfor" placeholder="请输入结算方式（可不填）" clearable />
              </el-form-item>
            </el-col>

            <el-col :span="24">
              <el-form-item label="地址" prop="s_address">
                <el-input v-model="formModel.s_address" placeholder="请输入地址" clearable />
              </el-form-item>
            </el-col>

            <el-col :span="12">
              <el-form-item label="联系人" prop="s_lxr">
                <el-input v-model="formModel.s_lxr" placeholder="请输入联系人" clearable />
              </el-form-item>
            </el-col>
            <el-col :span="12">
              <el-form-item label="电话" prop="s_tel">
                <el-input v-model="formModel.s_tel" placeholder="请输入电话号码" clearable />
              </el-form-item>
            </el-col>
            <el-col :span="12">
              <el-form-item label="手机" prop="s_mobile">
                <el-input v-model="formModel.s_mobile" placeholder="请输入手机号码" clearable />
              </el-form-item>
            </el-col>
            <el-col :span="12">
              <el-form-item label="本厂联系人" prop="lxr">
                <el-input v-model="formModel.lxr" placeholder="请输入本厂联系人" clearable />
              </el-form-item>
            </el-col>

            <el-col :span="24">
              <el-form-item label="经营范围" prop="s_business">
                <el-input v-model="formModel.s_business" type="textarea" :rows="3" placeholder="请输入经营范围" />
              </el-form-item>
            </el-col>

            <el-col :span="24">
              <el-form-item label="备注" prop="s_info">
                <el-input v-model="formModel.s_info" type="textarea" :rows="3" placeholder="请输入备注" />
              </el-form-item>
            </el-col>
          </el-row>
        </el-form>

        <template #footer>
          <el-button @click="dialogVisible = false">取消</el-button>
          <el-button type="primary" :loading="formSubmitting" @click="submitForm">保存</el-button>
        </template>
      </el-dialog>

      <el-drawer v-model="viewVisible" title="查看客户" size="520px" destroy-on-close>
        <el-descriptions v-if="viewLoading" :column="1" border>
          <el-descriptions-item label="加载中">…</el-descriptions-item>
        </el-descriptions>
        <el-descriptions v-else :column="1" border>
          <el-descriptions-item label="编码">{{ viewModel.s_code || '—' }}</el-descriptions-item>
          <el-descriptions-item label="状态">{{ passIsAudited(viewModel) ? '已审核' : '未审核' }}</el-descriptions-item>
          <el-descriptions-item label="名称">{{ viewModel.s_name || '—' }}</el-descriptions-item>
          <el-descriptions-item label="地址">{{ viewModel.s_address || '—' }}</el-descriptions-item>
          <el-descriptions-item label="联系人">{{ viewModel.s_lxr || '—' }}</el-descriptions-item>
          <el-descriptions-item label="电话">{{ viewModel.s_tel || '—' }}</el-descriptions-item>
          <el-descriptions-item label="手机">{{ viewModel.s_mobile || '—' }}</el-descriptions-item>
          <el-descriptions-item label="结算方式">{{ viewModel.s_payfor || '—' }}</el-descriptions-item>
          <el-descriptions-item label="本厂联系人">{{ viewModel.lxr || '—' }}</el-descriptions-item>
          <el-descriptions-item label="经营范围">{{ viewModel.s_business || '—' }}</el-descriptions-item>
          <el-descriptions-item label="类别">{{ viewModel.s_lb || '—' }}</el-descriptions-item>
          <el-descriptions-item label="备注">{{ viewModel.s_info || '—' }}</el-descriptions-item>
        </el-descriptions>
      </el-drawer>
    </el-card>
  </div>
</template>

<script setup>
import { onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Refresh } from '@element-plus/icons-vue'
import axios from 'axios'

/** 页面标题（与左侧菜单一致） */
const pageTitle = '销售客户'

const customerTypeOptions = ['国内', '国外', '其他']

const settlementMethodOptions = ref(['COD'])

const loading = ref(false)
const errorMessage = ref('')

const keyword = ref('')
const showRecycle = ref(false)
const showUnAudited = ref(false)

const tableList = ref([])
const total = ref(0)
const page = ref(1)
const pageSize = ref(20)

const dialogVisible = ref(false)
const dialogMode = ref('create') // create | edit
const formRef = ref()
const formSubmitting = ref(false)

const viewVisible = ref(false)
const viewLoading = ref(false)
const viewModel = ref({})

const emptyForm = () => ({
  id: null,
  s_code: '',
  s_name: '',
  s_address: '',
  s_lxr: '',
  s_tel: '',
  s_mobile: '',
  s_payfor: '',
  lxr: '',
  s_info: '',
  s_business: '',
  s_lb: '',
})

const formModel = reactive(emptyForm())
const formRules = {
  s_code: [{ required: true, message: '请输入编码', trigger: 'blur' }],
  s_name: [{ required: true, message: '请输入名称', trigger: 'blur' }],
}

function normalizeCell(v) {
  const s = String(v ?? '').trim()
  return s ? s : ''
}

function hasAnyContact(row) {
  return Boolean(normalizeCell(row?.s_lxr) || normalizeCell(row?.s_tel) || normalizeCell(row?.s_mobile))
}

function passIsAudited(row) {
  return String(row?.pass ?? '').trim() === '1'
}

async function loadData() {
  loading.value = true
  errorMessage.value = ''
  try {
    const pass = showRecycle.value ? undefined : showUnAudited.value ? '0' : '1'
    const params = {
      page: page.value,
      pageSize: pageSize.value,
      keyword: keyword.value.trim() || undefined,
      pass,
      recycled: showRecycle.value ? 1 : 0,
    }
    const res = await axios.get('/api/supply-chain/customers/list', { params })
    const data = res?.data?.data ?? {}
    total.value = Number(data.total ?? 0) || 0
    const list = Array.isArray(data.list) ? data.list : []
    tableList.value = list.map((r) => ({ ...r, __opLoading: '' }))
  } catch (err) {
    errorMessage.value = String(err?.response?.data?.msg || err?.message || '加载失败')
  } finally {
    loading.value = false
  }
}

function onSearch() {
  page.value = 1
  loadData()
}

function onRecycleChange() {
  page.value = 1
  if (showRecycle.value) showUnAudited.value = false
  loadData()
}

function onReset() {
  keyword.value = ''
  showRecycle.value = false
  showUnAudited.value = false
  page.value = 1
  pageSize.value = 20
  loadData()
}

function onPageChange() {
  loadData()
}

function onPageSizeChange() {
  page.value = 1
  loadData()
}

async function openCreateDialog() {
  dialogMode.value = 'create'
  Object.assign(formModel, emptyForm())
  // 默认 COD（允许清空不填）
  formModel.s_payfor = 'COD'
  dialogVisible.value = true
  await Promise.resolve()
  formRef.value?.clearValidate?.()
}

async function openEditDialog(row) {
  if (passIsAudited(row)) {
    const code = String(row?.s_code ?? '').trim() || '—'
    const name = String(row?.s_name ?? '').trim() || '—'
    try {
      await ElMessageBox.alert(`客户「${name}」（编码：${code}）已审核，需先反审后才能编辑。`, '提示', {
        type: 'warning',
        confirmButtonText: '知道了',
      })
    } catch {
      // ignore
    }
    return
  }
  dialogMode.value = 'edit'
  Object.assign(formModel, { ...emptyForm(), ...row })
  dialogVisible.value = true
  await Promise.resolve()
  formRef.value?.clearValidate?.()
}

async function submitForm() {
  try {
    await formRef.value?.validate?.()
  } catch {
    return
  }
  formSubmitting.value = true
  try {
    const payload = { ...formModel }
    if (dialogMode.value === 'create') {
      const res = await axios.post('/api/supply-chain/customers', payload)
      if (res?.data?.code !== 200) throw new Error(res?.data?.msg || '新增失败')
      ElMessage.success('新增成功（待审核）')
    } else {
      const res = await axios.put('/api/supply-chain/customers', payload)
      if (res?.data?.code !== 200) throw new Error(res?.data?.msg || '保存失败')
      ElMessage.success('保存成功')
    }
    dialogVisible.value = false
    loadData()
  } catch (err) {
    ElMessage.error(err?.response?.data?.msg || err?.message || '保存失败')
  } finally {
    formSubmitting.value = false
  }
}

async function auditRow(row) {
  const id = Number(row?.id)
  if (!Number.isFinite(id) || id <= 0) return
  const code = String(row?.s_code ?? '').trim() || '—'
  const name = String(row?.s_name ?? '').trim() || '—'
  try {
    await ElMessageBox.confirm(`确认审核客户「${name}」（编码：${code}）？`, '提示', {
      type: 'warning',
      confirmButtonText: '审核',
      cancelButtonText: '取消',
    })
  } catch {
    return
  }
  row.__opLoading = 'audit'
  try {
    const res = await axios.put('/api/supply-chain/customers/audit', { id })
    if (res?.data?.code !== 200) throw new Error(res?.data?.msg || '审核失败')
    ElMessage.success('审核成功')
    loadData()
  } catch (err) {
    ElMessage.error(err?.response?.data?.msg || err?.message || '审核失败')
  } finally {
    row.__opLoading = ''
  }
}

async function unauditRow(row) {
  const id = Number(row?.id)
  if (!Number.isFinite(id) || id <= 0) return
  const code = String(row?.s_code ?? '').trim() || '—'
  const name = String(row?.s_name ?? '').trim() || '—'
  try {
    await ElMessageBox.confirm(`确认反审客户「${name}」（编码：${code}）？`, '提示', {
      type: 'warning',
      confirmButtonText: '反审',
      cancelButtonText: '取消',
    })
  } catch {
    return
  }
  row.__opLoading = 'unaudit'
  try {
    const res = await axios.put('/api/supply-chain/customers/unaudit', { id })
    if (res?.data?.code !== 200) throw new Error(res?.data?.msg || '反审失败')
    ElMessage.success('反审成功')
    loadData()
  } catch (err) {
    ElMessage.error(err?.response?.data?.msg || err?.message || '反审失败')
  } finally {
    row.__opLoading = ''
  }
}

async function softDeleteRow(row) {
  const id = Number(row?.id)
  if (!Number.isFinite(id) || id <= 0) return
  if (passIsAudited(row)) {
    const code = String(row?.s_code ?? '').trim() || '—'
    const name = String(row?.s_name ?? '').trim() || '—'
    try {
      await ElMessageBox.alert(`客户「${name}」（编码：${code}）已审核，需先反审后才能删除。`, '提示', {
        type: 'warning',
        confirmButtonText: '知道了',
      })
    } catch {
      // ignore
    }
    return
  }
  try {
    await ElMessageBox.confirm('确认删除该客户？删除后进入回收站，可恢复。', '提示', {
      type: 'warning',
      confirmButtonText: '删除',
      cancelButtonText: '取消',
    })
  } catch {
    return
  }
  row.__opLoading = 'delete'
  try {
    const res = await axios.delete(`/api/supply-chain/customers/${id}`)
    if (res?.data?.code !== 200) throw new Error(res?.data?.msg || '删除失败')
    ElMessage.success('删除成功')
    loadData()
  } catch (err) {
    ElMessage.error(err?.response?.data?.msg || err?.message || '删除失败')
  } finally {
    row.__opLoading = ''
  }
}

async function restoreRow(row) {
  const id = Number(row?.id)
  if (!Number.isFinite(id) || id <= 0) return
  row.__opLoading = 'restore'
  try {
    const res = await axios.put('/api/supply-chain/customers/restore', { id })
    if (res?.data?.code !== 200) throw new Error(res?.data?.msg || '恢复失败')
    ElMessage.success('恢复成功')
    loadData()
  } catch (err) {
    ElMessage.error(err?.response?.data?.msg || err?.message || '恢复失败')
  } finally {
    row.__opLoading = ''
  }
}

async function permanentDeleteRow(row) {
  const id = Number(row?.id)
  if (!Number.isFinite(id) || id <= 0) return
  try {
    await ElMessageBox.confirm('确认彻底删除该客户？此操作不可恢复。', '提示', {
      type: 'warning',
      confirmButtonText: '彻底删除',
      cancelButtonText: '取消',
    })
  } catch {
    return
  }
  row.__opLoading = 'permanent'
  try {
    const res = await axios.delete(`/api/supply-chain/customers/${id}/permanent`)
    if (res?.data?.code !== 200) throw new Error(res?.data?.msg || '彻底删除失败')
    ElMessage.success('彻底删除成功')
    loadData()
  } catch (err) {
    ElMessage.error(err?.response?.data?.msg || err?.message || '彻底删除失败')
  } finally {
    row.__opLoading = ''
  }
}

async function openViewDialog(row) {
  const id = Number(row?.id)
  if (!Number.isFinite(id) || id <= 0) return
  viewVisible.value = true
  viewLoading.value = true
  viewModel.value = {}
  try {
    const res = await axios.get(`/api/supply-chain/customers/${id}`)
    if (res?.data?.code !== 200) throw new Error(res?.data?.msg || '加载失败')
    viewModel.value = res?.data?.data ?? {}
  } catch (err) {
    ElMessage.error(err?.response?.data?.msg || err?.message || '加载失败')
    viewVisible.value = false
  } finally {
    viewLoading.value = false
  }
}

onMounted(() => {
  loadSettlementMethodOptions()
  loadData()
})

async function loadSettlementMethodOptions() {
  try {
    const res = await axios.get('/api/supply-chain/settlement-methods/list', {
      params: { page: 1, pageSize: 100, pass: '1', recycled: 0 },
    })
    const list = res?.data?.data?.list
    const names = Array.isArray(list)
      ? list
          .map((r) => String(r?.name ?? '').trim())
          .filter(Boolean)
      : []
    const uniq = []
    const seen = new Set()
    for (const n of ['COD', ...names]) {
      if (seen.has(n)) continue
      seen.add(n)
      uniq.push(n)
    }
    settlementMethodOptions.value = uniq
  } catch {
    settlementMethodOptions.value = ['COD']
  }
}
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
}

.search-row {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  align-items: center;
  margin-bottom: 12px;
}
.audit-switch {
  display: flex;
  gap: 8px;
  align-items: center;
}
.switch-label {
  color: var(--el-text-color-regular);
  font-size: 13px;
}
.btn-view {
  margin-left: auto;
}
.btn-icon {
  margin-right: 6px;
}
.audit-alert,
.error-alert {
  margin-bottom: 10px;
}
.code-bold {
  font-weight: 600;
}
.multi-line {
  line-height: 18px;
  white-space: pre-line;
}
.op-btns {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}
.pager-row {
  display: flex;
  justify-content: flex-end;
  margin-top: 12px;
}
.customer-form {
  padding-top: 4px;
}
</style>
