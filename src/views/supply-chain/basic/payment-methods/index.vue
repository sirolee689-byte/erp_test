<template>
  <div class="erp-module-page pm-page" :class="{ 'pm-page--form': isFormMode }">
    <!--
      结算方式：顶栏「管理 / 添加」与筛选行对齐供应商资料；
      添加/编辑为当前页表单（非弹窗）。
    -->
    <div class="pm-mode-bar erp-mode-bar">
      <el-button
        class="pm-mode-btn erp-mode-btn"
        :type="pageMode === 'manage' ? 'primary' : 'default'"
        plain
        @click="switchToManage"
      >
        管理结算方式
      </el-button>
      <el-button
        v-permission="'add'"
        class="pm-mode-btn erp-mode-btn"
        :type="pageMode === 'create' ? 'primary' : 'default'"
        plain
        @click="switchToCreate"
      >
        结算方式添加
      </el-button>
    </div>

    <div v-show="pageMode === 'manage'" class="pm-manage-panel">
      <el-card shadow="never">
        <template #header>
          <span class="page-title">{{ pageTitle }}</span>
        </template>

        <!-- 关键字 → 查询 → 重置 → 竖线 → 回收站 → 竖线 → 显示未审核；右侧刷新 -->
        <div class="pm-toolbar">
          <div class="pm-toolbar-row">
            <div class="pm-filter-actions">
              <el-input
                v-model="keyword"
                placeholder="按编码/名称/备注模糊搜索"
                clearable
                class="pm-keyword-input"
                @keyup.enter="onSearch"
              />
              <el-button class="erp-filter-action-btn" type="primary" @click="onSearch">查询</el-button>
              <el-button class="erp-filter-action-btn" @click="onReset">重置</el-button>
              <div class="erp-filter-divider" aria-hidden="true" />
              <div class="audit-switch erp-filter-switch">
                <span class="switch-label">回收站</span>
                <el-switch v-model="showRecycle" @change="onRecycleChange" />
              </div>
              <template v-if="!showRecycle">
                <div class="erp-filter-divider" aria-hidden="true" />
                <div class="audit-switch erp-filter-switch">
                  <span class="switch-label">显示未审核</span>
                  <el-switch v-model="showUnAudited" @change="onSearch" />
                </div>
              </template>
            </div>
            <div class="pm-command-actions">
              <el-button class="btn-view erp-filter-action-btn" :loading="loading" @click="loadData">
                <el-icon class="btn-icon"><Refresh /></el-icon>
                刷新
              </el-button>
            </div>
          </div>
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
            v-model:current-page="page"
            v-model:page-size="pageSize"
            background
            layout="total, sizes, prev, pager, next, jumper"
            :total="total"
            :page-sizes="ERP_PAGE_SIZE_OPTIONS"
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
              class="erp-list-table"
              style="width: 100%"
              :empty-text="loading ? '加载中…' : '暂无数据'"
              @row-contextmenu="onErpListRowContextMenu"
            >
              <el-table-column
                label="操作"
                :width="actionsColWidth"
                fixed="left"
                align="left"
                header-align="center"
                class-name="erp-col-actions"
              >
                <template #default="{ row }">
                  <ErpTableActions>
                    <template v-if="showRecycle">
                      <el-button
                        v-permission="'edit'"
                        type="primary"
                        plain
                        :loading="busyId === row.id"
                        @click="onRestore(row)"
                      >
                        恢复
                      </el-button>
                      <el-button
                        v-if="$isErpSuperAdmin()"
                        v-permission="'delete'"
                        type="danger"
                        plain
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
                        type="primary"
                        plain
                        :disabled="passIsAudited(row)"
                        :loading="busyId === row.id"
                        @click="openEditForm(row)"
                      >
                        编辑
                      </el-button>
                      <el-button
                        v-if="showUnAudited && !passIsAudited(row)"
                        v-permission="'audit'"
                        type="success"
                        plain
                        :loading="busyId === row.id"
                        @click="onAudit(row)"
                      >
                        审核
                      </el-button>
                      <el-button
                        v-if="!showUnAudited && passIsAudited(row)"
                        v-permission="'unaudit'"
                        type="warning"
                        plain
                        :loading="busyId === row.id"
                        @click="onUnaudit(row)"
                      >
                        反审
                      </el-button>
                      <el-button
                        v-if="showUnAudited"
                        v-permission="'delete'"
                        type="danger"
                        plain
                        :disabled="passIsAudited(row)"
                        :loading="busyId === row.id"
                        @click="onSoftDelete(row)"
                      >
                        删除
                      </el-button>
                    </template>
                  </ErpTableActions>
                </template>
              </el-table-column>

              <el-table-column prop="code" label="编码" min-width="120" show-overflow-tooltip>
                <template #default="{ row }">
                  <span class="code-bold">{{ row.code || '—' }}</span>
                </template>
              </el-table-column>
              <el-table-column prop="name" label="名称" min-width="160" show-overflow-tooltip />
              <el-table-column prop="payfor" label="天数" width="100" show-overflow-tooltip />
              <el-table-column label="状态" width="110" align="center" header-align="center">
                <template #default="{ row }">
                  <el-tag v-if="passIsAudited(row)" type="success" size="small">已审核</el-tag>
                  <el-tag v-else type="warning" size="small">未审核</el-tag>
                </template>
              </el-table-column>
            </el-table>

            <div class="pagination-row pagination-row--bottom">
              <el-pagination
                v-model:current-page="page"
                v-model:page-size="pageSize"
                background
                layout="total, sizes, prev, pager, next, jumper"
                :total="total"
                :page-sizes="ERP_PAGE_SIZE_OPTIONS"
                @size-change="onPageSizeChange"
                @current-change="onPageChange"
              />
            </div>
          </template>
        </el-skeleton>
      </el-card>
    </div>

    <!-- 添加/编辑：当前页表单（对齐供应商资料） -->
    <div v-if="isFormMode" class="pm-form-panel">
      <div class="pm-form-head">
        <strong>{{ pageMode === 'edit' ? '编辑结算方式' : '新增结算方式' }}</strong>
        <div class="pm-form-head__actions">
          <el-button v-if="pageMode === 'edit'" @click="switchToManage">返回列表</el-button>
          <el-button v-else @click="resetCreateForm">重置</el-button>
          <el-button type="primary" :loading="formSubmitting" @click="submitForm">保存</el-button>
        </div>
      </div>

      <el-form ref="formRef" :model="formModel" :rules="formRules" class="pm-edit-form">
        <!-- 1. 编码（A） -->
        <div class="pm-basic-row">
          <div class="pm-basic-field">
            <span class="pm-basic-label pm-basic-label--required">编码</span>
            <el-form-item prop="code">
              <el-input
                v-model="formModel.code"
                maxlength="50"
                show-word-limit
                :disabled="pageMode === 'edit'"
                :placeholder="suggestedCode ? `建议编码：${suggestedCode}` : '请输入编码'"
                clearable
                class="pm-input pm-input--a"
              />
            </el-form-item>
          </div>
        </div>

        <!-- 2. 名称（A）、天数（B）+「天」 -->
        <div class="pm-basic-row">
          <div class="pm-basic-field">
            <span class="pm-basic-label pm-basic-label--required">名称</span>
            <el-form-item prop="name">
              <el-input
                v-model="formModel.name"
                maxlength="200"
                show-word-limit
                placeholder="必填"
                clearable
                class="pm-input pm-input--a"
              />
            </el-form-item>
          </div>
          <div class="pm-basic-field">
            <span class="pm-basic-label pm-basic-label--required">天数</span>
            <el-form-item prop="payfor">
              <div class="pm-input-with-unit">
                <el-input
                  v-model="formModel.payfor"
                  maxlength="50"
                  placeholder="如 30"
                  clearable
                  class="pm-input pm-input--b"
                />
                <span class="pm-unit">天</span>
              </div>
            </el-form-item>
          </div>
        </div>

        <!-- 3. 备注（C） -->
        <div class="pm-basic-row">
          <div class="pm-basic-field">
            <span class="pm-basic-label">备注</span>
            <el-form-item prop="info">
              <el-input
                v-model="formModel.info"
                type="textarea"
                :rows="4"
                maxlength="500"
                show-word-limit
                placeholder="选填"
                class="pm-input pm-input--c"
              />
            </el-form-item>
          </div>
        </div>
      </el-form>
    </div>
  </div>
</template>

<script setup>
import { useErpListRowContextMenu } from '@/composables/useErpListRowContextMenu'
import { useErpDeepLinkOpen } from '@/composables/useErpDeepLinkOpen'
import { ERP_PAGE_SIZE_OPTIONS } from '@/utils/erpPagination'
import { ref, computed, reactive, nextTick } from 'vue'
import axios from 'axios'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Refresh } from '@element-plus/icons-vue'
import { getErpTableActionsColWidthByRows } from '@/utils/erpTableActionsLayout'
import { getPermissionModelFromStorage, hasPageAction } from '@/utils/menuPermission'
import { isErpSuperAdmin } from '@/utils/erpSuperAdmin'

const { onErpListRowContextMenu } = useErpListRowContextMenu()

/** 页面标题（与左侧菜单一致） */
const pageTitle = '结算方式'

/** manage | create | edit —— 添加/编辑走当前页，对齐供应商资料 */
const pageMode = ref('manage')
const isFormMode = computed(() => pageMode.value === 'create' || pageMode.value === 'edit')

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

const paymentMethodsPermissionModel = getPermissionModelFromStorage()
const PAYMENT_METHODS_MENU_PATH = 'supply-chain/basic/payment-methods'
const actionsColWidth = computed(() => getErpTableActionsColWidthByRows(tableList.value, getPaymentMethodRowActionLabels, {
  fallbackLabels: [],
}))

/** 操作列按钮文案：需与模板 v-if / v-permission 条件保持一致 */
function getPaymentMethodRowActionLabels(row) {
  if (showRecycle.value) return [
    hasPageAction(paymentMethodsPermissionModel, PAYMENT_METHODS_MENU_PATH, 'edit') ? '恢复' : false,
    isErpSuperAdmin() && hasPageAction(paymentMethodsPermissionModel, PAYMENT_METHODS_MENU_PATH, 'delete') ? '彻底删除' : false,
  ]
  const labels = []
  if (showUnAudited.value) {
    if (hasPageAction(paymentMethodsPermissionModel, PAYMENT_METHODS_MENU_PATH, 'edit')) labels.push('编辑')
    if (!passIsAudited(row) && hasPageAction(paymentMethodsPermissionModel, PAYMENT_METHODS_MENU_PATH, 'audit')) labels.push('审核')
    if (hasPageAction(paymentMethodsPermissionModel, PAYMENT_METHODS_MENU_PATH, 'delete')) labels.push('删除')
  } else if (passIsAudited(row) && hasPageAction(paymentMethodsPermissionModel, PAYMENT_METHODS_MENU_PATH, 'unaudit')) {
    labels.push('反审')
  }
  return labels
}

const formRef = ref()
const formSubmitting = ref(false)
const suggestedCode = ref('')

const emptyForm = () => ({
  id: 0,
  code: '',
  name: '',
  payfor: '',
  info: '',
})

const formModel = reactive(emptyForm())

const formRules = {
  code: [{ required: true, message: '请输入编码', trigger: 'blur' }],
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

function onPageChange() {
  loadData()
}

function onPageSizeChange() {
  page.value = 1
  loadData()
}

function switchToManage() {
  pageMode.value = 'manage'
  if (showRecycle.value) {
    showRecycle.value = false
    showUnAudited.value = false
    keyword.value = ''
    page.value = 1
  }
  loadData()
}

async function loadSuggestedCode() {
  try {
    const res = await axios.get('/api/supply-chain/settlement-methods/suggest-code')
    if (res.data?.code === 200) {
      suggestedCode.value = String(res.data?.data?.suggestedCode ?? '').trim()
      if (suggestedCode.value && !String(formModel.code ?? '').trim()) {
        formModel.code = suggestedCode.value
      }
      return
    }
  } catch {
    // 忽略：建议编码失败不阻断新增
  }
  suggestedCode.value = ''
}

async function switchToCreate() {
  pageMode.value = 'create'
  Object.assign(formModel, emptyForm())
  await loadSuggestedCode()
  await nextTick()
  formRef.value?.clearValidate?.()
}

async function resetCreateForm() {
  if (pageMode.value !== 'create') return
  Object.assign(formModel, emptyForm())
  await loadSuggestedCode()
  await nextTick()
  formRef.value?.clearValidate?.()
}

async function openEditForm(row) {
  let source = row
  const id = Number(row?.id)
  if (!Number.isFinite(id) || id <= 0) return

  // 深链可能只带 id，从当前列表取完整行
  if (!String(row?.code ?? '').trim()) {
    const fromList = tableList.value.find((r) => Number(r?.id) === id)
    if (fromList) source = fromList
  }

  if (passIsAudited(source)) {
    const code = String(source?.code ?? '').trim() || '—'
    const name = String(source?.name ?? '').trim() || '—'
    try {
      await ElMessageBox.alert(`结算方式「${name}」（编码：${code}）已审核，需先反审后才能编辑。`, '提示', {
        type: 'warning',
        confirmButtonText: '知道了',
      })
    } catch {
      // ignore
    }
    return
  }

  suggestedCode.value = ''
  Object.assign(formModel, {
    ...emptyForm(),
    id,
    code: String(source?.code ?? '').trim(),
    name: String(source?.name ?? '').trim(),
    payfor: String(source?.payfor ?? '').trim(),
    info: String(source?.info ?? '').trim(),
  })
  pageMode.value = 'edit'
  await nextTick()
  formRef.value?.clearValidate?.()
}

useErpDeepLinkOpen({
  handlers: {
    edit: async (recordId) => {
      const id = Number(recordId)
      if (!Number.isFinite(id) || id <= 0) return
      await openEditForm({ id })
    },
  },
})

async function submitForm() {
  try {
    await formRef.value?.validate?.()
  } catch {
    return
  }
  formSubmitting.value = true
  try {
    const payload = {
      code: String(formModel.code ?? '').trim(),
      name: String(formModel.name ?? '').trim(),
      payfor: String(formModel.payfor ?? '').trim(),
      info: String(formModel.info ?? '').trim(),
    }
    if (pageMode.value === 'create') {
      const res = await axios.post('/api/supply-chain/settlement-methods', payload)
      if (res.data?.code !== 200) throw new Error(res.data?.msg || '新增失败')
      ElMessage.success('保存成功')
    } else {
      const res = await axios.put('/api/supply-chain/settlement-methods', {
        ...payload,
        id: Number(formModel.id),
      })
      if (res.data?.code !== 200) throw new Error(res.data?.msg || '保存失败')
      ElMessage.success('保存成功')
    }
    pageMode.value = 'manage'
    await loadData()
  } catch (e) {
    ElMessage.error(String(e?.response?.data?.msg ?? e?.message ?? '保存失败'))
  } finally {
    formSubmitting.value = false
  }
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
.pm-mode-bar {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 12px;
}
/* 列表卡片与出入库一致：不加外框线 */
.pm-manage-panel > :deep(.el-card) {
  border: none;
  background: transparent;
  box-shadow: none;
}
.pm-manage-panel > :deep(.el-card > .el-card__body) {
  padding: 0;
}
.pm-manage-panel > :deep(.el-card > .el-card__header) {
  padding-left: 0;
  padding-right: 0;
  border-bottom: none;
}
.pm-toolbar {
  margin-bottom: 12px;
}
.pm-toolbar-row,
.pm-filter-actions,
.pm-command-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}
.pm-toolbar-row {
  justify-content: space-between;
  row-gap: 10px;
}
.pm-filter-actions {
  flex: 1 1 auto;
  min-width: 0;
}
.pm-command-actions {
  flex: 0 0 auto;
}
.pm-keyword-input {
  flex: 0 1 360px;
  width: min(360px, 100%);
}
.audit-switch {
  display: inline-flex;
  gap: 8px;
  align-items: center;
}
.switch-label {
  color: var(--el-text-color-regular);
  font-size: 13px;
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

/* —— 当前页表单（对齐出入库：无外框线） —— */
.pm-form-panel {
  background: transparent;
  border: none;
  border-radius: 0;
  padding: 0;
}
.pm-form-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 16px;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--el-border-color-lighter);
}
.pm-form-head strong {
  font-size: 16px;
}
.pm-form-head__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.pm-edit-form {
  --pm-label-width: 88px;
  --pm-input-height: 36px;
}
.pm-basic-row {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  gap: 16px 28px;
  margin-bottom: 14px;
}
.pm-basic-field {
  display: inline-flex;
  align-items: flex-start;
  gap: 10px;
  min-width: 0;
}
.pm-basic-label {
  flex: 0 0 var(--pm-label-width);
  min-height: var(--pm-input-height);
  display: inline-flex;
  align-items: center;
  justify-content: flex-end;
  font-size: 14px;
  color: var(--el-text-color-primary);
  white-space: nowrap;
}
.pm-basic-label--required {
  color: #e60000;
}
.pm-basic-field :deep(.el-form-item) {
  margin-bottom: 0;
}
.pm-basic-field :deep(.el-form-item__content) {
  margin-left: 0 !important;
  line-height: var(--pm-input-height);
}
.pm-basic-field :deep(.el-input__wrapper),
.pm-basic-field :deep(.el-select__wrapper) {
  min-height: var(--pm-input-height);
}
/* 列宽组：A=250 / B=80 / C=500 */
.pm-input--a {
  width: 250px;
}
.pm-input--b {
  width: 80px;
}
.pm-input--c {
  width: 500px;
}
.pm-input-with-unit {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.pm-unit {
  font-size: 14px;
  color: var(--el-text-color-regular);
  white-space: nowrap;
}
</style>
