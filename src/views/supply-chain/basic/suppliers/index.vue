<template>
  <div class="erp-module-page supplier-page" :class="{ 'supplier-page--form': isFormMode }">
    <!--
      供应商资料（UB_ERP_System_supplier）：服务端分页 + keyword；审核/反审/软删/恢复标准件。
      默认只查已审 pass=1；可切换显示未审核；回收站仅查 del=1。
      顶栏「管理 / 添加」对齐采购订单：添加/编辑/查看均为当前页表单（查看只读，非弹窗/抽屉）。
    -->
    <div class="supplier-mode-bar erp-mode-bar">
      <el-button
        class="supplier-mode-btn erp-mode-btn"
        :type="pageMode === 'manage' ? 'primary' : 'default'"
        plain
        @click="switchToManage"
      >
        管理供应商
      </el-button>
      <el-button
        v-permission="'add'"
        class="supplier-mode-btn erp-mode-btn"
        :type="pageMode === 'create' ? 'primary' : 'default'"
        plain
        @click="switchToCreate"
      >
        供应商添加
      </el-button>
    </div>

    <div v-show="pageMode === 'manage'" class="supplier-manage-panel">
      <el-card shadow="never">
        <template #header>
          <span class="page-title">{{ pageTitle }}</span>
        </template>

        <!-- 关键字 → 查询 → 重置 → 竖线 → 回收站 → 竖线 → 显示未审核；右侧刷新 -->
        <div class="supplier-toolbar">
          <div class="supplier-toolbar-row">
            <div class="supplier-filter-actions">
              <el-input
                v-model="keyword"
                placeholder="按编码/名称/简称 模糊搜索"
                clearable
                class="supplier-keyword-input"
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
            <div class="supplier-command-actions">
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
              ref="tableRef"
              v-erp-list-h-scroll
              class="erp-list-table"
              :data="tableList"
              border
              stripe
              row-key="id"
              style="width: 100%"
              :empty-text="loading ? '加载中…' : '暂无数据'"
              @row-contextmenu="onErpListRowContextMenu"
            >
              <!-- 列序对齐旧系统：操作（左固定）→ 编码 → 状态 → … → 备注 -->
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

              <el-table-column
                prop="s_code"
                label="编码"
                width="140"
                align="center"
                header-align="center"
              >
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

              <el-table-column
                prop="s_name"
                label="名称"
                min-width="220"
                align="center"
                header-align="center"
              />
              <el-table-column
                prop="s_sname"
                label="简称"
                min-width="160"
                align="center"
                header-align="center"
              />
              <el-table-column
                prop="s_sh"
                label="税号"
                min-width="180"
                align="center"
                header-align="center"
              />
              <el-table-column
                prop="s_lb"
                label="类别"
                min-width="140"
                align="center"
                header-align="center"
              />

              <el-table-column
                label="联系方式"
                min-width="260"
                align="left"
                header-align="center"
                class-name="erp-col-multiline"
              >
                <template #default="{ row }">
                  <div class="erp-table-cell-multiline">
                    <div>
                      电话号码：{{ cellOrDash(row.s_tel) }}、传真号码：{{ cellOrDash(row.s_fax) }}
                    </div>
                    <div>
                      联系人：{{ cellOrDash(row.s_lxr) }}、手机：{{ cellOrDash(row.s_mobile) }}
                    </div>
                  </div>
                </template>
              </el-table-column>

              <el-table-column
                prop="s_payfor"
                label="结算方式"
                min-width="160"
                align="center"
                header-align="center"
              />

              <el-table-column
                label="货期"
                min-width="160"
                align="center"
                header-align="center"
                class-name="erp-col-multiline"
              >
                <template #default="{ row }">
                  <div class="erp-table-cell-multiline">
                    <!-- 外协必须用 s_wx_jh（旧系统曾误显示为 s_jh） -->
                    <div>采购：{{ normalizeDays(row.s_jh) }}</div>
                    <div>外协：{{ normalizeDays(row.s_wx_jh) }}</div>
                  </div>
                </template>
              </el-table-column>

              <el-table-column
                prop="sl"
                label="税率"
                width="110"
                align="center"
                header-align="center"
              />

              <el-table-column label="发票类型" min-width="160" align="center" header-align="center">
                <template #default="{ row }">
                  <span>{{ formatInvoiceType(row) }}</span>
                </template>
              </el-table-column>

              <el-table-column
                prop="s_info"
                label="备注"
                min-width="220"
                align="center"
                header-align="center"
              />
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

    <!-- 添加/编辑/查看：当前页表单（查看只读，对齐采购订单） -->
    <div v-if="isFormMode" class="supplier-form-panel">
      <div class="supplier-form-head">
        <strong>{{ formPanelTitle }}</strong>
        <div class="supplier-form-head__actions">
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
        class="supplier-edit-form"
      >
        <!-- 1. 初始时间（A） -->
        <div class="supplier-basic-row">
          <div class="supplier-basic-field">
            <span class="supplier-basic-label">初始时间</span>
            <el-form-item prop="intime">
              <el-date-picker
                v-model="formModel.intime"
                type="date"
                value-format="YYYY-MM-DD"
                placeholder="选择日期"
                class="supplier-input supplier-input--a"
              />
            </el-form-item>
          </div>
        </div>

        <!-- 2. 编码（A） -->
        <div class="supplier-basic-row">
          <div class="supplier-basic-field">
            <span class="supplier-basic-label supplier-basic-label--required">编码</span>
            <el-form-item prop="s_code">
              <el-input
                v-model="formModel.s_code"
                :placeholder="suggestedCode ? `建议编码：${suggestedCode}` : '请输入编码'"
                clearable
                class="supplier-input supplier-input--a"
              />
            </el-form-item>
          </div>
        </div>

        <!-- 3. 名称（A）、简称（A） -->
        <div class="supplier-basic-row">
          <div class="supplier-basic-field">
            <span class="supplier-basic-label supplier-basic-label--required">名称</span>
            <el-form-item prop="s_name">
              <el-input
                v-model="formModel.s_name"
                placeholder="请输入名称"
                clearable
                class="supplier-input supplier-input--a"
              />
            </el-form-item>
          </div>
          <div class="supplier-basic-field">
            <span class="supplier-basic-label">简称</span>
            <el-form-item prop="s_sname">
              <el-input
                v-model="formModel.s_sname"
                placeholder="请输入简称"
                clearable
                class="supplier-input supplier-input--a"
              />
            </el-form-item>
          </div>
        </div>

        <!-- 4. 类别（160px）、报价时效性（B）、采购货期（B）、外协货期（B） -->
        <div class="supplier-basic-row">
          <!-- 类别加宽 + 右侧多留空隙，避免与「报价时效性」贴在一起 -->
          <div class="supplier-basic-field supplier-basic-field--lb">
            <span class="supplier-basic-label">类别</span>
            <el-form-item prop="s_lb">
              <el-select
                v-model="formModel.s_lb"
                placeholder="请选择"
                clearable
                class="supplier-input supplier-input--lb"
              >
                <el-option v-for="opt in supplierTypeOptions" :key="opt" :label="opt" :value="opt" />
              </el-select>
            </el-form-item>
          </div>
          <div class="supplier-basic-field">
            <span class="supplier-basic-label">报价时效性</span>
            <el-form-item prop="s_bj">
              <div class="supplier-input-with-unit">
                <el-input
                  v-model="formModel.s_bj"
                  placeholder=""
                  clearable
                  class="supplier-input supplier-input--b"
                />
                <span class="supplier-unit">天</span>
              </div>
            </el-form-item>
          </div>
          <div class="supplier-basic-field">
            <span class="supplier-basic-label">采购货期</span>
            <el-form-item prop="s_jh">
              <div class="supplier-input-with-unit">
                <el-input
                  v-model="formModel.s_jh"
                  placeholder=""
                  clearable
                  class="supplier-input supplier-input--b"
                />
                <span class="supplier-unit">天</span>
              </div>
            </el-form-item>
          </div>
          <div class="supplier-basic-field">
            <span class="supplier-basic-label">外协货期</span>
            <el-form-item prop="s_wx_jh">
              <div class="supplier-input-with-unit">
                <el-input
                  v-model="formModel.s_wx_jh"
                  placeholder=""
                  clearable
                  class="supplier-input supplier-input--b"
                />
                <span class="supplier-unit">天</span>
              </div>
            </el-form-item>
          </div>
        </div>

        <!-- 5. 地址（C） -->
        <div class="supplier-basic-row">
          <div class="supplier-basic-field">
            <span class="supplier-basic-label">地址</span>
            <el-form-item prop="s_address">
              <el-input
                v-model="formModel.s_address"
                placeholder="请输入地址"
                clearable
                class="supplier-input supplier-input--c"
              />
            </el-form-item>
          </div>
        </div>

        <!-- 6. 经营范围（C） -->
        <div class="supplier-basic-row">
          <div class="supplier-basic-field">
            <span class="supplier-basic-label">经营范围</span>
            <el-form-item prop="s_business">
              <el-input
                v-model="formModel.s_business"
                placeholder="请输入经营范围"
                clearable
                class="supplier-input supplier-input--c"
              />
            </el-form-item>
          </div>
        </div>

        <!-- 7. 联系人、手机、电话号码、传真号码（A） -->
        <div class="supplier-basic-row">
          <div class="supplier-basic-field">
            <span class="supplier-basic-label">联系人</span>
            <el-form-item prop="s_lxr">
              <el-input
                v-model="formModel.s_lxr"
                placeholder="请输入联系人"
                clearable
                class="supplier-input supplier-input--a"
              />
            </el-form-item>
          </div>
          <div class="supplier-basic-field">
            <span class="supplier-basic-label">手机</span>
            <el-form-item prop="s_mobile">
              <el-input
                v-model="formModel.s_mobile"
                placeholder="请输入手机"
                clearable
                class="supplier-input supplier-input--a"
              />
            </el-form-item>
          </div>
          <div class="supplier-basic-field">
            <span class="supplier-basic-label">电话号码</span>
            <el-form-item prop="s_tel">
              <el-input
                v-model="formModel.s_tel"
                placeholder="请输入电话"
                clearable
                class="supplier-input supplier-input--a"
              />
            </el-form-item>
          </div>
          <div class="supplier-basic-field">
            <span class="supplier-basic-label">传真号码</span>
            <el-form-item prop="s_fax">
              <el-input
                v-model="formModel.s_fax"
                placeholder="请输入传真"
                clearable
                class="supplier-input supplier-input--a"
              />
            </el-form-item>
          </div>
        </div>

        <!-- 8. 结算方式、税号、开户行、账号（A） -->
        <div class="supplier-basic-row">
          <div class="supplier-basic-field">
            <span class="supplier-basic-label">结算方式</span>
            <el-form-item prop="s_payfor">
              <el-select
                v-if="settlementMethodOptions.length"
                v-model="formModel.s_payfor"
                placeholder="请选择"
                clearable
                filterable
                class="supplier-input supplier-input--a"
              >
                <el-option
                  v-for="opt in settlementMethodOptions"
                  :key="opt"
                  :label="opt"
                  :value="opt"
                />
              </el-select>
              <el-input
                v-else
                v-model="formModel.s_payfor"
                placeholder="请输入结算方式"
                clearable
                class="supplier-input supplier-input--a"
              />
            </el-form-item>
          </div>
          <div class="supplier-basic-field">
            <span class="supplier-basic-label">税号</span>
            <el-form-item prop="s_sh">
              <el-input
                v-model="formModel.s_sh"
                placeholder="请输入税号"
                clearable
                class="supplier-input supplier-input--a"
              />
            </el-form-item>
          </div>
          <div class="supplier-basic-field">
            <span class="supplier-basic-label">开户行</span>
            <el-form-item prop="s_bank">
              <el-input
                v-model="formModel.s_bank"
                placeholder="请输入开户行"
                clearable
                class="supplier-input supplier-input--a"
              />
            </el-form-item>
          </div>
          <div class="supplier-basic-field">
            <span class="supplier-basic-label">账号</span>
            <el-form-item prop="s_bank_number">
              <el-input
                v-model="formModel.s_bank_number"
                placeholder="请输入账号"
                clearable
                class="supplier-input supplier-input--a"
              />
            </el-form-item>
          </div>
        </div>

        <!-- 9. 开票类型三按钮（可多选）+ 默认税率（B） -->
        <div class="supplier-basic-row">
          <div class="supplier-basic-field">
            <span class="supplier-basic-label">开票类型</span>
            <div class="supplier-invoice-buttons">
              <el-button
                :type="formModel.kplx === '1' ? 'primary' : ''"
                :disabled="isViewMode"
                @click="toggleInvoiceFlag('kplx')"
              >
                普通发票
              </el-button>
              <el-button
                :type="formModel.kplxx === '1' ? 'primary' : ''"
                :disabled="isViewMode"
                @click="toggleInvoiceFlag('kplxx')"
              >
                增值税发票
              </el-button>
              <el-button
                :type="formModel.kplxxx === '1' ? 'primary' : ''"
                :disabled="isViewMode"
                @click="toggleInvoiceFlag('kplxxx')"
              >
                电子发票
              </el-button>
            </div>
          </div>
          <div class="supplier-basic-field">
            <span class="supplier-basic-label">默认税率</span>
            <el-form-item prop="sl">
              <el-input
                v-model="formModel.sl"
                placeholder=""
                clearable
                class="supplier-input supplier-input--b"
              />
            </el-form-item>
          </div>
        </div>

        <!-- 10. 备注（C） -->
        <div class="supplier-basic-row">
          <div class="supplier-basic-field">
            <span class="supplier-basic-label">备注</span>
            <el-form-item prop="s_info">
              <el-input
                v-model="formModel.s_info"
                type="textarea"
                :rows="2"
                placeholder="请输入备注"
                class="supplier-input supplier-input--c"
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
import { nextTick, onMounted, reactive, ref, computed } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Refresh } from '@element-plus/icons-vue'
import axios from 'axios'
import { getErpTableActionsColWidthByRows } from '@/utils/erpTableActionsLayout'
import { getPermissionModelFromStorage, hasPageAction } from '@/utils/menuPermission'
import { isErpSuperAdmin } from '@/utils/erpSuperAdmin'

const { onErpListRowContextMenu } = useErpListRowContextMenu()
/** 页面标题（与左侧菜单一致） */
const pageTitle = '供应商资料'

/** manage | create | edit | view —— 添加/编辑/查看走当前页，查看只读 */
const pageMode = ref('manage')
const isViewMode = computed(() => pageMode.value === 'view')
const isFormMode = computed(
  () => pageMode.value === 'create' || pageMode.value === 'edit' || pageMode.value === 'view',
)
const formPanelTitle = computed(() => {
  if (pageMode.value === 'view') return '查看供应商'
  if (pageMode.value === 'edit') return '编辑供应商'
  return '新增供应商'
})

const loading = ref(false)
const errorMessage = ref('')

const keyword = ref('')
const showRecycle = ref(false)
const showUnAudited = ref(false)

const tableList = ref([])
const total = ref(0)
const page = ref(1)
/** 默认每页 100（对齐旧系统管理供应商列表） */
const pageSize = ref(100)

const suppliersPermissionModel = getPermissionModelFromStorage()
const SUPPLIERS_MENU_PATH = 'supply-chain/basic/suppliers'
const actionsColWidth = computed(() => getErpTableActionsColWidthByRows(tableList.value, getSupplierRowActionLabels))

/** 操作列按钮文案：需与模板 v-if / v-permission 条件保持一致 */
function getSupplierRowActionLabels(row) {
  if (showRecycle.value) return [
    hasPageAction(suppliersPermissionModel, SUPPLIERS_MENU_PATH, 'edit') ? '恢复' : false,
    isErpSuperAdmin() && hasPageAction(suppliersPermissionModel, SUPPLIERS_MENU_PATH, 'delete') ? '彻底删除' : false,
  ]
  const labels = ['查看']
  if (showUnAudited.value) {
    if (hasPageAction(suppliersPermissionModel, SUPPLIERS_MENU_PATH, 'edit')) labels.push('编辑')
    if (!passIsAudited(row) && hasPageAction(suppliersPermissionModel, SUPPLIERS_MENU_PATH, 'audit')) labels.push('审核')
    if (hasPageAction(suppliersPermissionModel, SUPPLIERS_MENU_PATH, 'delete')) labels.push('删除')
  } else if (passIsAudited(row) && hasPageAction(suppliersPermissionModel, SUPPLIERS_MENU_PATH, 'unaudit')) {
    labels.push('反审')
  }
  return labels
}

const tableRef = ref()

const formRef = ref()
const formSubmitting = ref(false)
const suggestedCode = ref('')

/** 类别固定四项 */
const supplierTypeOptions = ['采购', '外协', '共用', '其他']
const settlementMethodOptions = ref(['COD'])

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
  s_sname: '',
  s_sh: '',
  s_lb: '',
  s_bj: '',
  s_address: '',
  s_business: '',
  s_bank: '',
  s_bank_number: '',
  s_lxr: '',
  s_mobile: '',
  s_tel: '',
  s_fax: '',
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

function cellOrDash(v) {
  const s = String(v ?? '').trim()
  return s || '—'
}

function normalizeDays(v) {
  const s = String(v ?? '').trim()
  if (!s) return '—'
  return `${s} 天`
}

function formatInvoiceType(row) {
  const bits = []
  const k1 = String(row?.kplx ?? '').trim()
  const k2 = String(row?.kplxx ?? '').trim()
  const k3 = String(row?.kplxxx ?? '').trim()
  // 列表展示对齐旧系统简称：普票 / 增票 / 电子发票
  if (k1 === '1') bits.push('普票')
  if (k2 === '1') bits.push('增票')
  if (k3 === '1') bits.push('电子发票')
  return bits.length ? bits.join('、') : '—'
}

/** 开票类型可多选：点一下开/关（查看模式不可改） */
function toggleInvoiceFlag(key) {
  if (isViewMode.value) return
  formModel[key] = formModel[key] === '1' ? '0' : '1'
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

async function loadSettlementMethodOptions() {
  try {
    const res = await axios.get('/api/supply-chain/settlement-methods/list', {
      params: { page: 1, pageSize: 100, pass: '1', recycled: 0 },
    })
    const list = res?.data?.data?.list
    const names = Array.isArray(list)
      ? list.map((r) => String(r?.name ?? '').trim()).filter(Boolean)
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
  pageSize.value = 100
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
  await loadSuggestedCode()
  await loadSettlementMethodOptions()
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

/** 列表已含主档字段；填充当前页表单（查看/编辑共用） */
async function fillSupplierForm(source, id) {
  suggestedCode.value = ''
  Object.assign(formModel, {
    ...emptyForm(),
    ...source,
    id,
    intime: normalizeIntimeForPicker(source?.intime),
    s_fax: String(source?.s_fax ?? '').trim(),
    s_bj: String(source?.s_bj ?? '').trim(),
    kplx: String(source?.kplx ?? '').trim() === '1' ? '1' : '0',
    kplxx: String(source?.kplxx ?? '').trim() === '1' ? '1' : '0',
    kplxxx: String(source?.kplxxx ?? '').trim() === '1' ? '1' : '0',
  })
  await loadSettlementMethodOptions()
  await nextTick()
  formRef.value?.clearValidate?.()
}

function resolveSupplierSource(row) {
  let source = row
  const id = Number(row?.id)
  if (!Number.isFinite(id) || id <= 0) return { id: null, source: null }
  // 深链可能只带 id，从当前列表取完整行
  if (!String(row?.s_code ?? '').trim()) {
    const fromList = tableList.value.find((r) => Number(r?.id) === id)
    if (fromList) source = fromList
  }
  return { id, source }
}

/** 查看：与编辑同布局，只读（已审核也可看） */
async function openViewDialog(row) {
  const { id, source } = resolveSupplierSource(row)
  if (!id || !source) return
  await fillSupplierForm(source, id)
  pageMode.value = 'view'
}

async function openEditForm(row) {
  const { id, source } = resolveSupplierSource(row)
  if (!id || !source) return

  if (passIsAudited(source)) {
    const code = String(source?.s_code ?? '').trim() || '—'
    const name = String(source?.s_name ?? '').trim() || '—'
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

  await fillSupplierForm(source, id)
  pageMode.value = 'edit'
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
      const res = await axios.post('/api/supply-chain/suppliers', payload)
      if (res?.data?.code !== 200) throw new Error(res?.data?.msg || '新增失败')
      ElMessage.success('新增成功（待审核）')
    } else {
      const res = await axios.put('/api/supply-chain/suppliers', payload)
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

onMounted(() => {
  loadSettlementMethodOptions()
  loadData()
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
.supplier-mode-bar {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-bottom: 12px;
}
.supplier-toolbar {
  margin-bottom: 12px;
}
.supplier-toolbar-row,
.supplier-filter-actions,
.supplier-command-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}
.supplier-toolbar-row {
  justify-content: space-between;
  row-gap: 10px;
}
.supplier-filter-actions {
  flex: 1 1 auto;
  min-width: 0;
}
.supplier-command-actions {
  flex: 0 0 auto;
}
.supplier-keyword-input {
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

/* —— 当前页表单（对齐采购订单基础资料布局） —— */
.supplier-form-panel {
  background: var(--el-bg-color);
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 4px;
  padding: 16px 20px 24px;
}
.supplier-form-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 16px;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--el-border-color-lighter);
}
.supplier-form-head strong {
  font-size: 16px;
}
.supplier-form-head__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.supplier-edit-form {
  --supplier-label-width: 88px;
  --supplier-input-height: 36px;
}
.supplier-basic-row {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  gap: 16px 28px;
  margin-bottom: 14px;
}
.supplier-basic-field {
  display: inline-flex;
  align-items: flex-start;
  gap: 10px;
  min-width: 0;
}
.supplier-basic-label {
  flex: 0 0 var(--supplier-label-width);
  min-height: var(--supplier-input-height);
  display: inline-flex;
  align-items: center;
  justify-content: flex-end;
  font-size: 14px;
  color: var(--el-text-color-primary);
  white-space: nowrap;
}
.supplier-basic-label--required {
  color: #e60000;
}
.supplier-basic-field :deep(.el-form-item) {
  margin-bottom: 0;
}
.supplier-basic-field :deep(.el-form-item__content) {
  margin-left: 0 !important;
  line-height: var(--supplier-input-height);
}
.supplier-basic-field :deep(.el-input__wrapper),
.supplier-basic-field :deep(.el-select__wrapper) {
  min-height: var(--supplier-input-height);
}
/* 列宽组：A=250 / B=80 / C=500；类别单独 160 */
.supplier-input--a {
  width: 250px;
}
.supplier-input--b {
  width: 80px;
}
/* DIY：类别下拉宽度，默认 160px */
.supplier-input--lb {
  width: 160px;
}
.supplier-input--c {
  width: 500px;
}
/* DIY：类别与右侧「报价时效性」的额外间距（叠在行 gap 之上） */
.supplier-basic-field--lb {
  margin-right: 36px;
}
.supplier-input-with-unit {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.supplier-unit {
  font-size: 14px;
  color: var(--el-text-color-regular);
  white-space: nowrap;
}
.supplier-invoice-buttons {
  display: inline-flex;
  align-items: center;
  gap: 12px;
  min-height: var(--supplier-input-height);
}
.supplier-invoice-buttons :deep(.el-button) {
  margin-left: 0;
  height: var(--supplier-input-height);
  font-size: 14px;
}
</style>
