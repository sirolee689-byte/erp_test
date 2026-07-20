<template>
  <div class="erp-module-page cust-page" :class="{ 'cust-page--form': isFormMode }">
    <!--
      销售客户：顶栏「管理 / 添加」与筛选行对齐供应商资料；
      添加/编辑/查看均为当前页表单（查看只读，非弹窗/抽屉）。
    -->
    <div class="cust-mode-bar erp-mode-bar">
      <el-button
        class="cust-mode-btn erp-mode-btn"
        :type="pageMode === 'manage' ? 'primary' : 'default'"
        plain
        @click="switchToManage"
      >
        管理销售客户
      </el-button>
      <el-button
        v-permission="'add'"
        class="cust-mode-btn erp-mode-btn"
        :type="pageMode === 'create' ? 'primary' : 'default'"
        plain
        @click="switchToCreate"
      >
        销售客户添加
      </el-button>
    </div>

    <div v-show="pageMode === 'manage'" class="cust-manage-panel">
      <el-card shadow="never">
        <template #header>
          <span class="page-title">{{ pageTitle }}</span>
        </template>

        <!-- 关键字 → 查询 → 重置 → 竖线 → 回收站 → 竖线 → 显示未审核；右侧刷新 -->
        <div class="cust-toolbar">
          <div class="cust-toolbar-row">
            <div class="cust-filter-actions">
              <el-input
                v-model="keyword"
                placeholder="按编码/名称/地址 模糊搜索"
                clearable
                class="cust-keyword-input"
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
            <div class="cust-command-actions">
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
          title="当前显示：未审核（pass=0）的销售客户"
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
                        :loading="row.__opLoading === 'restore'"
                        @click="restoreRow(row)"
                      >
                        恢复
                      </el-button>
                      <el-button
                        v-if="$isErpSuperAdmin()"
                        v-permission="'delete'"
                        type="danger"
                        plain
                        :loading="row.__opLoading === 'permanent'"
                        @click="permanentDeleteRow(row)"
                      >
                        彻底删除
                      </el-button>
                    </template>
                    <template v-else>
                      <el-button type="info" plain @click="openViewDialog(row)">查看</el-button>
                      <el-button
                        v-if="showUnAudited"
                        v-permission="'edit'"
                        type="primary"
                        plain
                        :disabled="passIsAudited(row)"
                        @click="openEditForm(row)"
                      >
                        编辑
                      </el-button>
                      <el-button
                        v-if="showUnAudited && !passIsAudited(row)"
                        v-permission="'audit'"
                        type="success"
                        plain
                        :loading="row.__opLoading === 'audit'"
                        @click="auditRow(row)"
                      >
                        审核
                      </el-button>
                      <el-button
                        v-if="!showUnAudited && passIsAudited(row)"
                        v-permission="'unaudit'"
                        type="warning"
                        plain
                        :loading="row.__opLoading === 'unaudit'"
                        @click="unauditRow(row)"
                      >
                        反审
                      </el-button>
                      <el-button
                        v-if="showUnAudited"
                        v-permission="'delete'"
                        type="danger"
                        plain
                        :disabled="passIsAudited(row)"
                        :loading="row.__opLoading === 'delete'"
                        @click="softDeleteRow(row)"
                      >
                        删除
                      </el-button>
                    </template>
                  </ErpTableActions>
                </template>
              </el-table-column>

              <el-table-column prop="s_code" label="编码" width="140" show-overflow-tooltip>
                <template #default="{ row }">
                  <span class="code-bold">{{ row.s_code || '—' }}</span>
                </template>
              </el-table-column>

              <el-table-column label="状态" width="110" align="center" header-align="center">
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

    <!-- 添加/编辑/查看：当前页表单（查看只读，对齐供应商资料） -->
    <div v-if="isFormMode" class="cust-form-panel">
      <div class="cust-form-head">
        <strong>{{ formPanelTitle }}</strong>
        <div class="cust-form-head__actions">
          <el-button v-if="pageMode !== 'create'" @click="switchToManage">返回列表</el-button>
          <el-button v-else @click="resetCreateForm">重置</el-button>
          <el-button
            v-if="!isViewMode"
            type="primary"
            :loading="formSubmitting"
            @click="submitForm"
          >
            保存
          </el-button>
        </div>
      </div>

      <el-form
        ref="formRef"
        :model="formModel"
        :rules="formRules"
        :disabled="isViewMode"
        class="cust-edit-form"
      >
        <!-- 1. 初始时间（A） -->
        <div class="cust-basic-row">
          <div class="cust-basic-field">
            <span class="cust-basic-label">初始时间</span>
            <el-form-item prop="intime">
              <el-date-picker
                v-model="formModel.intime"
                type="date"
                value-format="YYYY-MM-DD"
                placeholder="选择日期"
                class="cust-input cust-input--a"
              />
            </el-form-item>
          </div>
        </div>

        <!-- 2. 编码（A） -->
        <div class="cust-basic-row">
          <div class="cust-basic-field">
            <span class="cust-basic-label cust-basic-label--required">编码</span>
            <el-form-item prop="s_code">
              <el-input
                v-model="formModel.s_code"
                placeholder="请输入编码（手动输入）"
                clearable
                class="cust-input cust-input--a"
              />
            </el-form-item>
          </div>
        </div>

        <!-- 3. 名称（A）、税号（A）、类别（160） -->
        <div class="cust-basic-row">
          <div class="cust-basic-field">
            <span class="cust-basic-label cust-basic-label--required">名称</span>
            <el-form-item prop="s_name">
              <el-input
                v-model="formModel.s_name"
                placeholder="请输入名称"
                clearable
                class="cust-input cust-input--a"
              />
            </el-form-item>
          </div>
          <div class="cust-basic-field">
            <span class="cust-basic-label">税号</span>
            <el-form-item prop="s_sh">
              <el-input
                v-model="formModel.s_sh"
                placeholder="请输入税号"
                clearable
                class="cust-input cust-input--a"
              />
            </el-form-item>
          </div>
          <!-- 类别加宽 + 与税号留空隙 -->
          <div class="cust-basic-field cust-basic-field--lb">
            <span class="cust-basic-label">类别</span>
            <el-form-item prop="s_lb">
              <el-select
                v-model="formModel.s_lb"
                placeholder="请选择"
                clearable
                class="cust-input cust-input--lb"
              >
                <el-option v-for="opt in customerTypeOptions" :key="opt" :label="opt" :value="opt" />
              </el-select>
            </el-form-item>
          </div>
        </div>

        <!-- 4. 地址（B） -->
        <div class="cust-basic-row">
          <div class="cust-basic-field">
            <span class="cust-basic-label">地址</span>
            <el-form-item prop="s_address">
              <el-input
                v-model="formModel.s_address"
                placeholder="请输入地址"
                clearable
                class="cust-input cust-input--b"
              />
            </el-form-item>
          </div>
        </div>

        <!-- 5. 经营范围（B） -->
        <div class="cust-basic-row">
          <div class="cust-basic-field">
            <span class="cust-basic-label">经营范围</span>
            <el-form-item prop="s_business">
              <el-input
                v-model="formModel.s_business"
                type="textarea"
                :rows="3"
                placeholder="请输入经营范围"
                class="cust-input cust-input--b"
              />
            </el-form-item>
          </div>
        </div>

        <!-- 6. 联系人 / 手机 / 电话 / 传真（A） -->
        <div class="cust-basic-row">
          <div class="cust-basic-field">
            <span class="cust-basic-label">联系人</span>
            <el-form-item prop="s_lxr">
              <el-input
                v-model="formModel.s_lxr"
                placeholder="请输入联系人"
                clearable
                class="cust-input cust-input--a"
              />
            </el-form-item>
          </div>
          <div class="cust-basic-field">
            <span class="cust-basic-label">手机</span>
            <el-form-item prop="s_mobile">
              <el-input
                v-model="formModel.s_mobile"
                placeholder="请输入手机号码"
                clearable
                class="cust-input cust-input--a"
              />
            </el-form-item>
          </div>
          <div class="cust-basic-field">
            <span class="cust-basic-label">电话号码</span>
            <el-form-item prop="s_tel">
              <el-input
                v-model="formModel.s_tel"
                placeholder="请输入电话号码"
                clearable
                class="cust-input cust-input--a"
              />
            </el-form-item>
          </div>
          <div class="cust-basic-field">
            <span class="cust-basic-label">传真号码</span>
            <el-form-item prop="s_fax">
              <el-input
                v-model="formModel.s_fax"
                placeholder="请输入传真号码"
                clearable
                class="cust-input cust-input--a"
              />
            </el-form-item>
          </div>
        </div>

        <!-- 7. 结算方式（A）、本厂联系人（A） -->
        <div class="cust-basic-row">
          <div class="cust-basic-field">
            <span class="cust-basic-label">结算方式</span>
            <el-form-item prop="s_payfor">
              <el-select
                v-if="settlementMethodOptions.length"
                v-model="formModel.s_payfor"
                placeholder="请选择结算方式（可不填）"
                clearable
                filterable
                class="cust-input cust-input--a"
              >
                <el-option v-for="opt in settlementMethodOptions" :key="opt" :label="opt" :value="opt" />
              </el-select>
              <el-input
                v-else
                v-model="formModel.s_payfor"
                placeholder="请输入结算方式（可不填）"
                clearable
                class="cust-input cust-input--a"
              />
            </el-form-item>
          </div>
          <div class="cust-basic-field">
            <span class="cust-basic-label">本厂联系人</span>
            <el-form-item prop="lxr">
              <el-input
                v-model="formModel.lxr"
                placeholder="请输入本厂联系人"
                clearable
                class="cust-input cust-input--a"
              />
            </el-form-item>
          </div>
        </div>

        <!-- 8. 备注（B） -->
        <div class="cust-basic-row">
          <div class="cust-basic-field">
            <span class="cust-basic-label">备注</span>
            <el-form-item prop="s_info">
              <el-input
                v-model="formModel.s_info"
                type="textarea"
                :rows="3"
                placeholder="请输入备注"
                class="cust-input cust-input--b"
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
import { onMounted, reactive, ref, computed, nextTick } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Refresh } from '@element-plus/icons-vue'
import axios from 'axios'
import { getErpTableActionsColWidthByRows } from '@/utils/erpTableActionsLayout'
import { getPermissionModelFromStorage, hasPageAction } from '@/utils/menuPermission'
import { isErpSuperAdmin } from '@/utils/erpSuperAdmin'

const { onErpListRowContextMenu } = useErpListRowContextMenu()

/** 页面标题（与左侧菜单一致） */
const pageTitle = '销售客户'

/** manage | create | edit | view —— 添加/编辑/查看走当前页，查看只读 */
const pageMode = ref('manage')
const isViewMode = computed(() => pageMode.value === 'view')
const isFormMode = computed(
  () => pageMode.value === 'create' || pageMode.value === 'edit' || pageMode.value === 'view',
)
const formPanelTitle = computed(() => {
  if (pageMode.value === 'view') return '查看客户'
  if (pageMode.value === 'edit') return '编辑客户'
  return '新增客户'
})

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

const customersPermissionModel = getPermissionModelFromStorage()
const CUSTOMERS_MENU_PATH = 'supply-chain/basic/customers'
const actionsColWidth = computed(() => getErpTableActionsColWidthByRows(tableList.value, getCustomerRowActionLabels))

/** 操作列按钮文案：需与模板 v-if / v-permission 条件保持一致 */
function getCustomerRowActionLabels(row) {
  if (showRecycle.value) return [
    hasPageAction(customersPermissionModel, CUSTOMERS_MENU_PATH, 'edit') ? '恢复' : false,
    isErpSuperAdmin() && hasPageAction(customersPermissionModel, CUSTOMERS_MENU_PATH, 'delete') ? '彻底删除' : false,
  ]
  const labels = ['查看']
  if (showUnAudited.value) {
    if (hasPageAction(customersPermissionModel, CUSTOMERS_MENU_PATH, 'edit')) labels.push('编辑')
    if (!passIsAudited(row) && hasPageAction(customersPermissionModel, CUSTOMERS_MENU_PATH, 'audit')) labels.push('审核')
    if (hasPageAction(customersPermissionModel, CUSTOMERS_MENU_PATH, 'delete')) labels.push('删除')
  } else if (passIsAudited(row) && hasPageAction(customersPermissionModel, CUSTOMERS_MENU_PATH, 'unaudit')) {
    labels.push('反审')
  }
  return labels
}

const formRef = ref()
const formSubmitting = ref(false)

function todayString() {
  const d = new Date()
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/** 库中 intime 可能是 2026-7-10，日期控件需要补零为 YYYY-MM-DD */
function normalizeIntimeForPicker(raw) {
  const s = String(raw ?? '').trim()
  if (!s) return todayString()
  const m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/)
  if (!m) return s
  const p = (n) => String(Number(n)).padStart(2, '0')
  return `${m[1]}-${p(m[2])}-${p(m[3])}`
}

const emptyForm = () => ({
  id: null,
  intime: todayString(),
  s_code: '',
  s_name: '',
  s_sh: '',
  s_lb: '',
  s_address: '',
  s_business: '',
  s_lxr: '',
  s_mobile: '',
  s_tel: '',
  s_fax: '',
  s_payfor: '',
  lxr: '',
  s_info: '',
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

async function switchToCreate() {
  pageMode.value = 'create'
  Object.assign(formModel, emptyForm())
  // 默认 COD（允许清空不填）；intime 已由 emptyForm 置为当天
  formModel.s_payfor = 'COD'
  await loadSettlementMethodOptions()
  await nextTick()
  formRef.value?.clearValidate?.()
}

async function resetCreateForm() {
  if (pageMode.value !== 'create') return
  Object.assign(formModel, emptyForm())
  formModel.s_payfor = 'COD'
  await nextTick()
  formRef.value?.clearValidate?.()
}

async function fetchCustomerDetail(id) {
  const res = await axios.get(`/api/supply-chain/customers/${id}`)
  if (res?.data?.code !== 200) throw new Error(res?.data?.msg || '加载失败')
  return res?.data?.data ?? null
}

/** 填充当前页表单（查看/编辑共用） */
async function fillCustomerForm(source, id) {
  Object.assign(formModel, {
    ...emptyForm(),
    id,
    intime: normalizeIntimeForPicker(source?.intime),
    s_code: String(source?.s_code ?? '').trim(),
    s_name: String(source?.s_name ?? '').trim(),
    s_sh: String(source?.s_sh ?? '').trim(),
    s_lb: String(source?.s_lb ?? '').trim(),
    s_address: String(source?.s_address ?? '').trim(),
    s_business: String(source?.s_business ?? '').trim(),
    s_lxr: String(source?.s_lxr ?? '').trim(),
    s_mobile: String(source?.s_mobile ?? '').trim(),
    s_tel: String(source?.s_tel ?? '').trim(),
    s_fax: String(source?.s_fax ?? '').trim(),
    s_payfor: String(source?.s_payfor ?? '').trim(),
    lxr: String(source?.lxr ?? '').trim(),
    s_info: String(source?.s_info ?? '').trim(),
  })
  await loadSettlementMethodOptions()
  await nextTick()
  formRef.value?.clearValidate?.()
}

/** 深链可能只带 id，或列表缺字段：优先列表，再拉详情补齐 */
async function resolveCustomerSource(row) {
  let source = row
  const id = Number(row?.id)
  if (!Number.isFinite(id) || id <= 0) return { id: null, source: null }

  if (!String(row?.s_code ?? '').trim()) {
    const fromList = tableList.value.find((r) => Number(r?.id) === id)
    if (fromList) source = fromList
  }
  if (!String(source?.s_code ?? '').trim() || source?.intime === undefined) {
    try {
      const detail = await fetchCustomerDetail(id)
      if (detail) source = detail
    } catch (err) {
      ElMessage.error(err?.response?.data?.msg || err?.message || '加载客户失败')
      return { id: null, source: null }
    }
  }
  return { id, source }
}

/** 查看：与编辑同布局，只读（已审核也可看） */
async function openViewDialog(row) {
  const { id, source } = await resolveCustomerSource(row)
  if (!id || !source) return
  await fillCustomerForm(source, id)
  pageMode.value = 'view'
}

async function openEditForm(row) {
  const { id, source } = await resolveCustomerSource(row)
  if (!id || !source) return

  if (passIsAudited(source)) {
    const code = String(source?.s_code ?? '').trim() || '—'
    const name = String(source?.s_name ?? '').trim() || '—'
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

  await fillCustomerForm(source, id)
  pageMode.value = 'edit'
}

async function submitForm() {
  if (isViewMode.value) return
  try {
    await formRef.value?.validate?.()
  } catch {
    return
  }
  formSubmitting.value = true
  try {
    const payload = { ...formModel }
    if (pageMode.value === 'create') {
      const res = await axios.post('/api/supply-chain/customers', payload)
      if (res?.data?.code !== 200) throw new Error(res?.data?.msg || '新增失败')
      ElMessage.success('新增成功（待审核）')
    } else {
      const res = await axios.put('/api/supply-chain/customers', payload)
      if (res?.data?.code !== 200) throw new Error(res?.data?.msg || '保存失败')
      ElMessage.success('保存成功')
    }
    pageMode.value = 'manage'
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

useErpDeepLinkOpen({
  handlers: {
    view: async (recordId) => {
      const id = Number(recordId)
      if (!Number.isFinite(id) || id <= 0) return
      await openViewDialog({ id })
    },
    edit: async (recordId) => {
      const id = Number(recordId)
      if (!Number.isFinite(id) || id <= 0) return
      await openEditForm({ id })
    },
  },
})

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
.cust-mode-bar {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-bottom: 12px;
}
.cust-toolbar {
  margin-bottom: 12px;
}
.cust-toolbar-row,
.cust-filter-actions,
.cust-command-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}
.cust-toolbar-row {
  justify-content: space-between;
  row-gap: 10px;
}
.cust-filter-actions {
  flex: 1 1 auto;
  min-width: 0;
}
.cust-command-actions {
  flex: 0 0 auto;
}
.cust-keyword-input {
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
.multi-line {
  line-height: 18px;
  white-space: pre-line;
}

/* —— 当前页表单（对齐供应商资料布局） —— */
.cust-form-panel {
  background: var(--el-bg-color);
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 4px;
  padding: 16px 20px 24px;
}
.cust-form-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 16px;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--el-border-color-lighter);
}
.cust-form-head strong {
  font-size: 16px;
}
.cust-form-head__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.cust-edit-form {
  --cust-label-width: 88px;
  --cust-input-height: 36px;
}
.cust-basic-row {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  gap: 16px 28px;
  margin-bottom: 14px;
}
.cust-basic-field {
  display: inline-flex;
  align-items: flex-start;
  gap: 10px;
  min-width: 0;
}
.cust-basic-label {
  flex: 0 0 var(--cust-label-width);
  min-height: var(--cust-input-height);
  display: inline-flex;
  align-items: center;
  justify-content: flex-end;
  font-size: 14px;
  color: var(--el-text-color-primary);
  white-space: nowrap;
}
.cust-basic-label--required {
  color: #e60000;
}
.cust-basic-field :deep(.el-form-item) {
  margin-bottom: 0;
}
.cust-basic-field :deep(.el-form-item__content) {
  margin-left: 0 !important;
  line-height: var(--cust-input-height);
}
.cust-basic-field :deep(.el-input__wrapper),
.cust-basic-field :deep(.el-select__wrapper) {
  min-height: var(--cust-input-height);
}
/* 列宽组：A=250 / B=500；类别单独 160 */
.cust-input--a {
  width: 250px;
}
.cust-input--b {
  width: 500px;
}
/* DIY：类别下拉宽度，默认 160px */
.cust-input--lb {
  width: 160px;
}
/* DIY：类别与左侧「税号」的额外间距 */
.cust-basic-field--lb {
  margin-left: 36px;
}
.cust-basic-field :deep(.el-date-editor.cust-input--a) {
  width: 250px;
}
</style>
