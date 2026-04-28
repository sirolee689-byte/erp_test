<template>
  <div class="erp-module-page">
    <!--
      供应商资料（System_supplier）：服务端分页 + keyword；审核/反审/软删/恢复标准件。
      默认只查已审 pass=1；可切换显示未审核；回收站仅查 del=1。
    -->
    <el-card shadow="never">
      <template #header>
        <span class="page-title">{{ pageTitle }}</span>
      </template>
      <p class="page-desc">
        数据表 <code>System_supplier</code>；默认每页 20 条；已审核行不可删除，需先反审。
      </p>

      <div class="search-row">
        <el-input
          v-model="keyword"
          placeholder="按编码/名称/简称 模糊搜索"
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
          新增供应商
        </el-button>
        <el-button class="btn-view" :loading="loading" @click="loadData">
          <el-icon class="btn-icon"><Refresh /></el-icon>
          刷新
        </el-button>
      </div>

      <el-alert v-if="errorMessage" :title="errorMessage" type="error" show-icon class="error-alert" />
      <el-alert
        v-if="showRecycle"
        title="当前为回收站视图：仅显示已逻辑删除（del=1）的记录；可恢复。"
        type="info"
        show-icon
        class="audit-alert"
      />
      <el-alert
        v-else-if="showUnAudited"
        title="当前显示：未审核（pass=0）的供应商资料"
        type="warning"
        show-icon
        class="audit-alert"
      />

      <el-skeleton :loading="loading" animated :rows="6">
        <template #default>
          <el-table
            ref="tableRef"
            :data="tableList"
            border
            stripe
            row-key="id"
            style="width: 100%"
            :max-height="tableMaxHeight"
            :empty-text="loading ? '加载中…' : '暂无数据'"
          >
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
            <el-table-column prop="s_sname" label="简称" min-width="160" show-overflow-tooltip />
            <el-table-column prop="s_sh" label="税号" min-width="180" show-overflow-tooltip />
            <el-table-column prop="s_lb" label="类别" min-width="140" show-overflow-tooltip />

            <el-table-column label="联系方式" min-width="180">
              <template #default="{ row }">
                <div class="multi-line">
                  <div>{{ row.s_lxr || '—' }}</div>
                  <div>{{ row.s_mobile || '—' }}</div>
                  <div>{{ row.s_tel || '—' }}</div>
                </div>
              </template>
            </el-table-column>

            <el-table-column prop="s_payfor" label="结算方式" min-width="160" show-overflow-tooltip />

            <el-table-column label="货期" min-width="160">
              <template #default="{ row }">
                <div class="multi-line">
                  <div>采购：{{ normalizeDays(row.s_jh) }}</div>
                  <div>外协：{{ normalizeDays(row.s_wx_jh) }}</div>
                </div>
              </template>
            </el-table-column>

            <el-table-column prop="sl" label="税率" width="110" show-overflow-tooltip />

            <el-table-column label="发票类型" min-width="160">
              <template #default="{ row }">
                <span>{{ formatInvoiceType(row) }}</span>
              </template>
            </el-table-column>

            <el-table-column prop="s_info" label="备注" min-width="220" show-overflow-tooltip />

            <el-table-column label="操作" width="320" fixed="right">
              <template #default="{ row }">
                <div class="op-btns">
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
        :title="dialogMode === 'create' ? '新增供应商' : '编辑供应商'"
        width="860px"
        :close-on-click-modal="false"
      >
        <el-form ref="formRef" :model="formModel" :rules="formRules" label-width="110px" class="supplier-form">
          <el-row :gutter="16">
            <el-col :span="12">
              <el-form-item label="编码" prop="s_code">
                <el-input
                  v-model="formModel.s_code"
                  :placeholder="suggestedCode ? `建议编码：${suggestedCode}（自增+1，仅供参考）` : '请输入编码（手动输入）'"
                  clearable
                />
              </el-form-item>
            </el-col>
            <el-col :span="12">
              <el-form-item label="名称" prop="s_name">
                <el-input v-model="formModel.s_name" placeholder="请输入名称" clearable />
              </el-form-item>
            </el-col>
            <el-col :span="12">
              <el-form-item label="简称" prop="s_sname">
                <el-input v-model="formModel.s_sname" placeholder="请输入简称" clearable />
              </el-form-item>
            </el-col>
            <el-col :span="12">
              <el-form-item label="税号" prop="s_sh">
                <el-input v-model="formModel.s_sh" placeholder="请输入税号" clearable />
              </el-form-item>
            </el-col>
            <el-col :span="12">
              <el-form-item label="类别" prop="s_lb">
                <el-input v-model="formModel.s_lb" placeholder="请输入类别" clearable />
              </el-form-item>
            </el-col>
            <el-col :span="12">
              <el-form-item label="结算方式" prop="s_payfor">
                <el-input v-model="formModel.s_payfor" placeholder="请输入结算方式" clearable />
              </el-form-item>
            </el-col>

            <el-col :span="12">
              <el-form-item label="联系人" prop="s_lxr">
                <el-input v-model="formModel.s_lxr" placeholder="请输入联系人" clearable />
              </el-form-item>
            </el-col>
            <el-col :span="12">
              <el-form-item label="手机" prop="s_mobile">
                <el-input v-model="formModel.s_mobile" placeholder="请输入手机" clearable />
              </el-form-item>
            </el-col>
            <el-col :span="12">
              <el-form-item label="电话" prop="s_tel">
                <el-input v-model="formModel.s_tel" placeholder="请输入电话" clearable />
              </el-form-item>
            </el-col>

            <el-col :span="12">
              <el-form-item label="货期(采购)" prop="s_jh">
                <el-input v-model="formModel.s_jh" placeholder="天数（例如 7）" clearable />
              </el-form-item>
            </el-col>
            <el-col :span="12">
              <el-form-item label="货期(外协)" prop="s_wx_jh">
                <el-input v-model="formModel.s_wx_jh" placeholder="天数（例如 10）" clearable />
              </el-form-item>
            </el-col>

            <el-col :span="12">
              <el-form-item label="税率" prop="sl">
                <el-input v-model="formModel.sl" placeholder="例如 13%" clearable />
              </el-form-item>
            </el-col>

            <el-col :span="12">
              <el-form-item label="发票类型">
                <el-checkbox v-model="formModel.kplx" true-value="1" false-value="0">普通发票</el-checkbox>
                <el-checkbox v-model="formModel.kplxx" true-value="1" false-value="0">增值税发票</el-checkbox>
                <el-checkbox v-model="formModel.kplxxx" true-value="1" false-value="0">电子发票</el-checkbox>
              </el-form-item>
            </el-col>

            <el-col :span="24">
              <el-form-item label="备注" prop="s_info">
                <el-input v-model="formModel.s_info" type="textarea" :rows="3" placeholder="请输入备注" />
              </el-form-item>
            </el-col>

            <el-col :span="24">
              <el-form-item label="地址" prop="s_address">
                <el-input v-model="formModel.s_address" placeholder="请输入地址" clearable />
              </el-form-item>
            </el-col>
            <el-col :span="24">
              <el-form-item label="经营范围" prop="s_business">
                <el-input v-model="formModel.s_business" type="textarea" :rows="3" placeholder="请输入经营范围" />
              </el-form-item>
            </el-col>
            <el-col :span="12">
              <el-form-item label="开户行" prop="s_bank">
                <el-input v-model="formModel.s_bank" placeholder="请输入开户行" clearable />
              </el-form-item>
            </el-col>
            <el-col :span="12">
              <el-form-item label="银行账号" prop="s_bank_number">
                <el-input v-model="formModel.s_bank_number" placeholder="请输入银行账号" clearable />
              </el-form-item>
            </el-col>
          </el-row>
        </el-form>

        <template #footer>
          <el-button @click="dialogVisible = false">取消</el-button>
          <el-button type="primary" :loading="formSubmitting" @click="submitForm">
            保存
          </el-button>
        </template>
      </el-dialog>
    </el-card>
  </div>
</template>

<script setup>
import { computed, nextTick, onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Refresh } from '@element-plus/icons-vue'
import axios from 'axios'

/** 页面标题（与左侧菜单一致） */
const pageTitle = '供应商资料'

const loading = ref(false)
const errorMessage = ref('')

const keyword = ref('')
const showRecycle = ref(false)
const showUnAudited = ref(false)

const tableList = ref([])
const total = ref(0)
const page = ref(1)
const pageSize = ref(20)

const tableRef = ref()
const tableMaxHeight = computed(() => 'calc(100vh - 260px)')

const dialogVisible = ref(false)
const dialogMode = ref('create') // create | edit
const formRef = ref()
const formSubmitting = ref(false)
const suggestedCode = ref('')

const emptyForm = () => ({
  id: null,
  s_code: '',
  s_name: '',
  s_sname: '',
  s_sh: '',
  s_lb: '',
  s_address: '',
  s_business: '',
  s_bank: '',
  s_bank_number: '',
  s_lxr: '',
  s_mobile: '',
  s_tel: '',
  s_payfor: '',
  s_jh: '',
  s_wx_jh: '',
  sl: '',
  kplx: '0',
  kplxx: '0',
  kplxxx: '0',
  s_info: '',
})

const formModel = reactive(emptyForm())
const formRules = {
  s_code: [{ required: true, message: '请输入编码', trigger: 'blur' }],
  s_name: [{ required: true, message: '请输入名称', trigger: 'blur' }],
}

function passIsAudited(row) {
  return String(row?.pass ?? '').trim() === '1'
}

function normalizeDays(v) {
  const s = String(v ?? '').trim()
  if (!s) return '—'
  return `${s}天`
}

function formatInvoiceType(row) {
  const bits = []
  const k1 = String(row?.kplx ?? '').trim()
  const k2 = String(row?.kplxx ?? '').trim()
  const k3 = String(row?.kplxxx ?? '').trim()
  if (k1 === '1') bits.push('普通发票')
  if (k2 === '1') bits.push('增值税发票')
  if (k3 === '1') bits.push('电子发票')
  return bits.length ? bits.join('、') : '—'
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
    const res = await axios.get('/api/supply-chain/suppliers/list', { params })
    const data = res?.data?.data ?? {}
    total.value = Number(data.total ?? 0) || 0
    const list = Array.isArray(data.list) ? data.list : []
    tableList.value = list.map((r) => ({ ...r, __opLoading: '' }))
    await nextTick()
  } catch (err) {
    const msg = err?.response?.data?.msg || err?.message || '加载失败'
    errorMessage.value = String(msg)
  } finally {
    loading.value = false
  }
}

async function loadSuggestedCode() {
  try {
    const res = await axios.get('/api/supply-chain/suppliers/suggest-code')
    suggestedCode.value = String(res?.data?.data?.suggestedCode ?? '').trim()
  } catch {
    suggestedCode.value = ''
  }
}

function onSearch() {
  page.value = 1
  loadData()
}

function onRecycleChange() {
  page.value = 1
  if (showRecycle.value) {
    showUnAudited.value = false
  }
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

async function auditRow(row) {
  const id = Number(row?.id)
  if (!Number.isFinite(id) || id <= 0) return
  const code = String(row?.s_code ?? '').trim() || '—'
  const name = String(row?.s_name ?? '').trim() || '—'
  try {
    await ElMessageBox.confirm(`确认审核供应商「${name}」（编码：${code}）？`, '提示', {
      type: 'warning',
      confirmButtonText: '审核',
      cancelButtonText: '取消',
    })
  } catch {
    return
  }
  row.__opLoading = 'audit'
  try {
    const res = await axios.put('/api/supply-chain/suppliers/audit', { id })
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
    await ElMessageBox.confirm(`确认反审供应商「${name}」（编码：${code}）？`, '提示', {
      type: 'warning',
      confirmButtonText: '反审',
      cancelButtonText: '取消',
    })
  } catch {
    return
  }
  row.__opLoading = 'unaudit'
  try {
    const res = await axios.put('/api/supply-chain/suppliers/unaudit', { id })
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
      await ElMessageBox.alert(`供应商「${name}」（编码：${code}）已审核，需先反审后才能删除。`, '提示', {
        type: 'warning',
        confirmButtonText: '知道了',
      })
    } catch {
      // ignore
    }
    return
  }
  try {
    await ElMessageBox.confirm('确认删除该供应商？删除后进入回收站，可恢复。', '提示', {
      type: 'warning',
      confirmButtonText: '删除',
      cancelButtonText: '取消',
    })
  } catch {
    return
  }
  row.__opLoading = 'delete'
  try {
    const res = await axios.delete(`/api/supply-chain/suppliers/${id}`)
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
    const res = await axios.put('/api/supply-chain/suppliers/restore', { id })
    if (res?.data?.code !== 200) throw new Error(res?.data?.msg || '恢复失败')
    ElMessage.success('恢复成功')
    loadData()
  } catch (err) {
    ElMessage.error(err?.response?.data?.msg || err?.message || '恢复失败')
  } finally {
    row.__opLoading = ''
  }
}

onMounted(() => {
  loadData()
})

async function openCreateDialog() {
  dialogMode.value = 'create'
  Object.assign(formModel, emptyForm())
  dialogVisible.value = true
  await loadSuggestedCode()
  await nextTick()
  formRef.value?.clearValidate?.()
}

async function openEditDialog(row) {
  if (passIsAudited(row)) {
    const code = String(row?.s_code ?? '').trim() || '—'
    const name = String(row?.s_name ?? '').trim() || '—'
    try {
      await ElMessageBox.alert(`供应商「${name}」（编码：${code}）已审核，需先反审后才能编辑。`, '提示', {
        type: 'warning',
        confirmButtonText: '知道了',
      })
    } catch {
      // ignore
    }
    return
  }
  dialogMode.value = 'edit'
  suggestedCode.value = ''
  Object.assign(formModel, {
    ...emptyForm(),
    ...row,
    kplx: String(row?.kplx ?? '').trim() === '1' ? '1' : '0',
    kplxx: String(row?.kplxx ?? '').trim() === '1' ? '1' : '0',
    kplxxx: String(row?.kplxxx ?? '').trim() === '1' ? '1' : '0',
  })
  dialogVisible.value = true
  await nextTick()
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
      const res = await axios.post('/api/supply-chain/suppliers', payload)
      if (res?.data?.code !== 200) throw new Error(res?.data?.msg || '新增失败')
      ElMessage.success('新增成功（待审核）')
    } else {
      const res = await axios.put('/api/supply-chain/suppliers', payload)
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

async function permanentDeleteRow(row) {
  const id = Number(row?.id)
  if (!Number.isFinite(id) || id <= 0) return
  try {
    await ElMessageBox.confirm('确认彻底删除该供应商？此操作不可恢复。', '提示', {
      type: 'warning',
      confirmButtonText: '彻底删除',
      cancelButtonText: '取消',
    })
  } catch {
    return
  }
  row.__opLoading = 'permanent'
  try {
    const res = await axios.delete(`/api/supply-chain/suppliers/${id}/permanent`)
    if (res?.data?.code !== 200) throw new Error(res?.data?.msg || '彻底删除失败')
    ElMessage.success('彻底删除成功')
    loadData()
  } catch (err) {
    ElMessage.error(err?.response?.data?.msg || err?.message || '彻底删除失败')
  } finally {
    row.__opLoading = ''
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
.supplier-form {
  padding-top: 4px;
}
</style>
