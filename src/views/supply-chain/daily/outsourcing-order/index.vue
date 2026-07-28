<template>
  <div class="erp-module-page assist-order-page" :class="{ 'assist-order-page--form': isFormPanel }">
    <div class="assist-mode-bar erp-mode-bar">
      <el-button
        :type="pageMode === 'manage' ? 'primary' : 'default'"
        plain
        @click="switchToManage"
        @contextmenu.prevent="onErpModeBtnContextMenu('manage', $event)"
      >
        管理外协订单
      </el-button>
      <el-button
        v-permission="'add'"
        :type="pageMode === 'create' ? 'primary' : 'default'"
        plain
        @click="switchToCreate"
        @contextmenu.prevent="onErpModeBtnContextMenu('create', $event)"
      >
        外协订单添加
      </el-button>
      <el-button
        :type="pageMode === 'material-trace' ? 'primary' : 'default'"
        plain
        @click="switchMaterialTrace"
        @contextmenu.prevent="onErpModeBtnContextMenu('material-trace', $event)"
      >
        转向物料查询
      </el-button>
    </div>

    <div v-show="pageMode === 'manage'" class="assist-manage-panel">
    <el-alert v-if="errorMessage" :title="errorMessage" type="error" show-icon class="assist-alert" />

    <div class="assist-filter-bar erp-filter-bar">
      <div class="assist-filter-row erp-filter-row">
        <el-select
          v-model="filters.supplier"
          clearable
          filterable
          remote
          reserve-keyword
          class="assist-filter-select"
          :remote-method="fetchSupplierOptions"
          :loading="supplierLoading"
          placeholder="外协商"
        >
          <el-option
            v-for="item in supplierOptions"
            :key="item.code"
            :label="`${item.code} ${item.name}`"
            :value="item.code"
          />
        </el-select>
        <el-select v-model="filters.assistType" clearable class="assist-filter-select" placeholder="外协类型">
          <el-option label="其他外协" value="0" />
          <el-option label="订单外协" value="1" />
          <el-option label="订单外发" value="2" />
        </el-select>
        <span v-permission="'print'" class="assist-print-selected">已选择 {{ printSelectedCount }} 条</span>
        <el-button v-permission="'print'" :disabled="printSelectedCount === 0" @click="openSelectedPrint('0')">打印外协订单（外协格式）</el-button>
      </div>
      <div class="assist-filter-row erp-filter-row">
        <div class="assist-filter-field assist-filter-field--keyword">
          <span class="assist-filter-label">查询内容</span>
          <el-input
            v-model="filters.keyword"
            clearable
            class="assist-keyword-input"
            placeholder="单号 / 关联单号 / 备注"
            @keyup.enter="onSearch"
          />
        </div>
        <el-button type="primary" size="small" @click="onSearch">查询</el-button>
        <el-button size="small" @click="onReset">重置</el-button>
        <div class="assist-filter-divider erp-filter-divider" aria-hidden="true" />
        <div class="assist-filter-switch erp-filter-switch">
          <span class="switch-label">回收站</span>
          <el-switch v-model="filters.recycled" @change="onRecycleChange" />
        </div>
        <template v-if="!filters.recycled">
          <div class="assist-filter-divider erp-filter-divider" aria-hidden="true" />
          <div class="assist-filter-switch erp-filter-switch">
            <span class="switch-label">显示未审核</span>
            <el-switch v-model="filters.showUnaudited" @change="onSearch" />
          </div>
        </template>
        <div class="assist-filter-divider erp-filter-divider" aria-hidden="true" />
        <div class="assist-filter-switch erp-filter-switch">
          <span class="switch-label">显示全部</span>
          <el-switch v-model="filters.showAll" @change="onSearch" />
        </div>
      </div>
    </div>

    <el-alert
      v-if="filters.recycled"
      title="当前为回收站视图：可恢复或彻底删除（不可恢复）。"
      type="info"
      show-icon
      class="audit-alert"
    />
    <el-alert
      v-else-if="filters.showUnaudited"
      title="当前显示：未审核外协订单"
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

    <el-skeleton :loading="loading" animated :rows="8">
      <template #default>
        <ErpTableViewportHScroll>
        <el-table
          ref="listTableRef"
          :data="tableList"
          row-key="id"
          border
          stripe
          class="erp-list-table assist-table"
          style="width: 100%"
          :empty-text="loading ? '加载中...' : '暂无外协订单'"
          @expand-change="onExpandChange"
          @row-click="onListRowClick"
         @row-contextmenu="onErpListRowContextMenu">
      <el-table-column type="expand" width="1">
        <template #default="{ row }">
          <div v-loading="row.expandedLoading" class="assist-expand-inner">
          <el-table
            v-if="(row.expandedLines || []).length"
            :data="row.expandedLines || []"
            border
            size="small"
            class="assist-expand-lines-table"
            show-summary
            :summary-method="(param) => expandSummaryMethod(row.expandedLines, param)"
          >
            <el-table-column label="序号" width="70">
              <template #default="{ $index }">{{ $index + 1 }}</template>
            </el-table-column>
            <el-table-column label="操作" width="76" align="center">
              <template #default="{ row: line }">
                <el-button v-if="line._rowType !== 'fee'" size="small" type="primary" plain @click.stop="openExpandedLineBom(line)">查看</el-button>
              </template>
            </el-table-column>
            <el-table-column label="仓库相关" min-width="258">
              <template #default="{ row: line }">
                <div v-if="line._rowType !== 'fee'" class="assist-warehouse-cell">
                  <div class="assist-warehouse-cell__summary">
                    <span v-if="!(line.warehouse?.inbound || []).length">未入库</span>
                    <span v-for="item in line.warehouse?.inbound || []" :key="`in-${item.documentNo}`">入库单号：{{ item.documentNo }}，已入库数：{{ formatWarehouseQty(item.quantity) }}</span>
                  </div>
                  <el-button v-if="(line.warehouse?.inbound || []).length" link type="primary" size="small" @click.stop="toggleWarehouseDetail(line, 'inbound')">显示详情</el-button>
                  <div class="assist-warehouse-cell__summary">
                    <span v-if="!(line.warehouse?.outbound || []).length">未出库</span>
                    <span v-for="item in line.warehouse?.outbound || []" :key="`out-${item.documentNo}`">出库单号：{{ item.documentNo }}，已出库数：{{ formatWarehouseQty(item.quantity) }}</span>
                  </div>
                  <el-button v-if="(line.warehouse?.outbound || []).length" link type="primary" size="small" @click.stop="toggleWarehouseDetail(line, 'outbound')">显示详情</el-button>
                  <div v-if="line._warehouseDetail" class="assist-warehouse-cell__details">
                    <template v-for="item in line.warehouse?.[line._warehouseDetail] || []" :key="`${line._warehouseDetail}-detail-${item.documentNo}`">
                      <div>{{ line._warehouseDetail === 'inbound' ? '入库时间' : '出库时间' }}：{{ formatDate(item.documentDate) }}</div>
                      <div>{{ line._warehouseDetail === 'inbound' ? '送货单号' : '纸质单号' }}：{{ line._warehouseDetail === 'inbound' ? formatCell(item.deliveryNo) : formatCell(item.paperNo) }}</div>
                      <div>备注：{{ formatCell(item.remark) }}</div>
                    </template>
                  </div>
                </div>
              </template>
            </el-table-column>
            <el-table-column label="物料编码" prop="kcaa01" min-width="150" show-overflow-tooltip />
            <el-table-column label="材料名称" prop="kcaa02" min-width="160" show-overflow-tooltip />
            <el-table-column label="规格" prop="kcaa03" min-width="130" show-overflow-tooltip />
            <el-table-column label="颜色" prop="kcaa11" min-width="110" show-overflow-tooltip />
            <el-table-column label="单位" prop="kcaa04" width="80" show-overflow-tooltip />
            <el-table-column label="数量" prop="wxak03" width="90" align="right" />
            <el-table-column label="单价" prop="wxak04" width="110" align="right" />
            <el-table-column label="单价（含税）" prop="wxak041" width="110" align="right" />
            <el-table-column label="金额" prop="wxak05" width="110" align="right" />
            <el-table-column label="金额（含税）" prop="wxak051" width="110" align="right" />
            <el-table-column label="税点" prop="tax" width="90" align="right" />
            <el-table-column label="PO/PI" prop="piNo" min-width="120" show-overflow-tooltip />
            <el-table-column label="款号" prop="product" min-width="120" show-overflow-tooltip />
            <el-table-column label="外协内容" prop="describe" min-width="150" show-overflow-tooltip />
            <el-table-column label="交货日期" width="110">
              <template #default="{ row: line }">{{ formatDate(line.deliveryDate) }}</template>
            </el-table-column>
            <el-table-column label="备注" prop="remark" min-width="160" show-overflow-tooltip />
          </el-table>
          <el-empty v-else-if="!row.expandedLoading" description="暂无明细" />
          </div>
        </template>
      </el-table-column>
      <el-table-column
        label="操作"
        :width="assistOrderActionsColWidth"
        fixed="left"
        align="left"
        header-align="center"
        class-name="erp-col-actions"
      >
        <template #default="{ row }">
          <ErpTableActions class="assist-order-actions" @click.stop>
            <template v-if="filters.recycled">
              <el-button type="primary" plain @click.stop="runLifecycle(row, 'restore')">恢复</el-button>
              <el-button v-if="$isErpSuperAdmin()" type="danger" plain @click.stop="runLifecycle(row, 'hard-delete')">彻底删除</el-button>
            </template>
            <template v-else>
              <el-button type="info" plain @click.stop="openView(row)">查看</el-button>
              <template v-if="!isAudited(row)">
                <el-button
                  type="primary"
                  plain
                  :disabled="!canEdit(row)"
                  @click.stop="openEdit(row)"
                >
                  编辑
                </el-button>
                <el-button
                  type="success"
                  v-permission="'audit'"
                  plain
                  :disabled="!canAudit(row)"
                  @click.stop="runLifecycle(row, 'audit')"
                >
                  审核
                </el-button>
                <el-button
                  type="danger"
                  plain
                  :disabled="!canDelete(row)"
                  @click.stop="runLifecycle(row, 'delete')"
                >
                  删除
                </el-button>
              </template>
              <template v-else>
                <el-button
                  v-if="canUnaudit(row)"
                  v-permission="'unaudit'"
                  type="warning"
                  plain
                  @click.stop="runLifecycle(row, 'unaudit')"
                >
                  反审
                </el-button>
                <el-button
                  v-if="canClose(row)"
                  plain
                  @click.stop="runLifecycle(row, 'close')"
                >
                  结案
                </el-button>
                <el-button
                  v-if="canUnclose(row)"
                  plain
                  @click.stop="runLifecycle(row, 'unclose')"
                >
                  反结案
                </el-button>
              </template>
              <el-button
                v-permission="'print'"
                plain
                :type="isPrintSelected(row) ? 'primary' : 'default'"
                @click.stop="togglePrintSelect(row)"
              >
                {{ isPrintSelected(row) ? '已选择' : '打印选择' }}
              </el-button>
            </template>
          </ErpTableActions>
        </template>
      </el-table-column>
      <el-table-column label="外协订单号" prop="assistOrderNo" min-width="150" show-overflow-tooltip>
        <template #default="{ row }">
          <span class="code-text">{{ formatCell(row.assistOrderNo) }}</span>
        </template>
      </el-table-column>
      <el-table-column label="外协类型" width="108">
        <template #default="{ row }">{{ assistTypeText(row.assistType) }}</template>
      </el-table-column>
      <el-table-column label="审核" width="88">
        <template #default="{ row }">
          <el-tag v-if="isAudited(row)" type="success" size="small">已审核</el-tag>
          <el-tag v-else type="warning" size="small">未审核</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="结案" width="88">
        <template #default="{ row }">
          <el-tag v-if="isClosed(row)" type="success" size="small">已结案</el-tag>
          <el-tag v-else type="info" size="small">未结案</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="外协日期" width="116">
        <template #default="{ row }">{{ formatDate(row.assistDate) }}</template>
      </el-table-column>
      <el-table-column label="交货日期" width="116">
        <template #default="{ row }">{{ formatDate(row.deliveryDate) }}</template>
      </el-table-column>
      <el-table-column label="外协订单数据" min-width="500" class-name="assist-order-data-col">
        <template #default="{ row }">
          <div class="assist-order-data">
            <div class="assist-order-data__line">{{ assistOrderDataLines(row).line1 }}</div>
            <div class="assist-order-data__line">{{ assistOrderDataLines(row).line2 }}</div>
            <div class="assist-order-data__line">{{ assistOrderDataLines(row).line3 }}</div>
            <div class="assist-order-data__line">{{ assistOrderDataLines(row).line4 }}</div>
          </div>
        </template>
      </el-table-column>
      <el-table-column label="关联单号" prop="referenceNo" min-width="140" show-overflow-tooltip />
      <el-table-column label="币别" prop="currencyName" width="92" show-overflow-tooltip>
        <template #default="{ row }">{{ formatCell(row.currencyName || row.currencyCode) }}</template>
      </el-table-column>
      <el-table-column label="外协商" prop="supplierName" min-width="220" show-overflow-tooltip />
      <el-table-column label="备注" prop="remark" min-width="180" show-overflow-tooltip />
      <el-table-column label="打印注释" prop="notes" min-width="180" show-overflow-tooltip />
      <el-table-column label="操作记录" min-width="280" class-name="assist-op-record-col">
        <template #default="{ row }">
          <div class="assist-op-record">
            <div>{{ formatAssistOpRecordLine('添加', row.addtime, row.utruename || row.uname) }}</div>
            <div>{{ formatAssistOpRecordLine('修改', row.edittime, row.uptruename || row.upname) }}</div>
          </div>
        </template>
      </el-table-column>
        </el-table>
        </ErpTableViewportHScroll>

        <div v-if="tableList.length" class="assist-page-subtotal">
          本页统计,含税总金额:{{ formatPageStatMoney(pageSubtotal.amountInc) }} 元 ,&nbsp;&nbsp;不含税总金额:{{ formatPageStatMoney(pageSubtotal.amountEx) }} 元,&nbsp;&nbsp;一共税额:{{ formatPageStatMoney(pageTaxAmount) }} 元
        </div>

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
    </div>

    <div v-if="pageMode === 'material-trace'" class="assist-material-trace-panel">
      <AssistOrderMaterialTracePanel @open-view="onMaterialTraceOpenView" />
    </div>

    <div
      v-show="isFormPanel"
      ref="createPanelRef"
      v-loading="(pageMode === 'edit' || pageMode === 'view') && detailLoading"
      class="assist-create-panel"
      :class="{ 'assist-create-panel--readonly': isReadonlyForm }"
    >
      <div ref="formHeadRef" class="assist-form-head">
        <strong class="assist-form-head__title">{{ pageMode === 'view' ? '查看外协订单' : pageMode === 'edit' ? '编辑外协订单' : '新增外协订单' }}</strong>
        <div class="assist-form-head__actions">
          <el-button v-if="pageMode === 'view' || pageMode === 'edit'" @click="switchToManage">返回列表</el-button>
          <template v-if="pageMode !== 'view'">
            <el-button type="primary" :loading="saveLoading" @click="onSave">立即提交</el-button>
            <el-button @click="onFormReset">重置</el-button>
          </template>
        </div>
      </div>
      <AssistOrderEditForm
        ref="activeFormRef"
        :model="editForm"
        :rules="editRules"
        v-model:edit-tab="editTab"
        :footer-height="formFooterHeight"
        :supplier-options="supplierOptions"
        :supplier-loading="supplierLoading"
        :currency-options="currencyOptions"
        :readonly="isReadonlyForm"
        @assist-date-change="onAssistDateChange"
        @assist-order-no-focus="onAssistOrderNoFocus"
        @assist-order-no-blur="onAssistOrderNoBlur"
        @fetch-supplier="fetchSupplierOptions"
        @delete-selected-lines="deleteSelectedLines"
        @delete-all-lines="deleteAllLines"
        @open-batch-add="openBatchAdd"
        @toggle-line-mark="toggleLineMark"
        @view-line-pi-bom="openLinePiBom"
        @line-tax-excluded-change="onLineTaxExcludedChange"
        @line-tax-included-change="onLineTaxIncludedChange"
        @add-fee-row="addFeesRow"
        @reset-fees="resetFeesTab"
      />
    </div>

  </div>
</template>

<script setup>
import { useErpListRowContextMenu, useErpModeBtnContextMenu } from '@/composables/useErpListRowContextMenu'
import { useErpDeepLinkOpen } from '@/composables/useErpDeepLinkOpen'
import { ERP_PAGE_SIZE_OPTIONS } from '@/utils/erpPagination'
import { computed, nextTick, onMounted, onUnmounted, reactive, ref, watch } from 'vue'
import axios from 'axios'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  recalcAssistOrderLineFromQuotedPrices,
  recalcAssistOrderLineFromTaxExcluded,
  recalcAssistOrderLineFromTaxIncluded,
} from '@/utils/assistOrderAmount'
import { getErpTableActionsColWidthByRows } from '@/utils/erpTableActionsLayout'
import {
  calcAssistOrderExpandSubtotal,
  calcAssistOrderPageSubtotal,
} from '@/utils/assistOrderPageSubtotal'
import { refreshErpTableViewportHScroll } from '@/utils/erpTableViewportHScroll'
import { getPermissionModelFromStorage, hasPageAction } from '@/utils/menuPermission'
import { isErpSuperAdmin } from '@/utils/erpSuperAdmin'
import AssistOrderEditForm from './AssistOrderEditForm.vue'
import AssistOrderMaterialTracePanel from './material-trace-panel.vue'
import { createExpandPrefetch } from '@/utils/erpExpandPrefetch.js'
import {
  ASSIST_BATCH_MSG_ACCEPTED,
  ASSIST_BATCH_MSG_APPLY,
  ASSIST_BATCH_MSG_REJECTED,
  ASSIST_BATCH_REJECT_PI_MISMATCH,
  ASSIST_BATCH_REJECT_SUPPLIER_MISMATCH,
  ASSIST_BATCH_RESULT_PREFIX,
  buildAssistBatchSessionId,
  parseAssistBatchResultPayload,
  validateBatchApply,
  writeAssistBatchContext,
} from '@/utils/assistOrderBatchAdd'

defineOptions({ name: 'supply-chain-daily-outsourcing-order' })

const menuPath = 'supply-chain/daily/outsourcing-order'
const model = getPermissionModelFromStorage()

const { onErpListRowContextMenu } = useErpListRowContextMenu()
const { onErpModeBtnContextMenu } = useErpModeBtnContextMenu()
const pageMode = ref('manage')
const createPanelInitialized = ref(false)

const listTableRef = ref(null)
const loading = ref(false)
const detailLoading = ref(false)
const saveLoading = ref(false)
const supplierLoading = ref(false)
const errorMessage = ref('')
const tableList = ref([])
const supplierOptions = ref([])
const currencyOptions = ref([])
const page = ref(1)
const pageSize = ref(10)
const total = ref(0)
const editTab = ref('header')
const editMode = ref('create')
const editId = ref(null)
const viewId = ref(null)
const activeFormRef = ref(null)
const activeBatchSessionId = ref('')
const printSelectedOrderNos = ref([])
const filters = reactive({
  keyword: '',
  keywordField: '',
  supplier: '',
  assistType: '',
  showUnaudited: false,
  showAll: false,
  recycled: false,
})
const editForm = reactive(defaultEditForm())

const assistOrderActionsColWidth = computed(() => {
  return getErpTableActionsColWidthByRows(tableList.value, getAssistOrderRowActionLabels)
})

/** 外协订单主列表操作列按钮：与模板 v-if / v-permission 保持一致，用于估算列宽 */
function getAssistOrderRowActionLabels(row) {
  if (filters.recycled) return ['恢复', isErpSuperAdmin() ? '彻底删除' : false]

  const labels = ['查看']
  if (!isAudited(row)) {
    // 编辑/删除按钮模板未加 v-permission，始终渲染（仅按 canEdit/canDelete 置灰）
    labels.push('编辑')
    if (hasPageAction(model, menuPath, 'audit')) labels.push('审核')
    labels.push('删除')
  } else {
    if (canUnaudit(row) && hasPageAction(model, menuPath, 'unaudit')) labels.push('反审')
    if (canClose(row)) labels.push('结案')
    if (canUnclose(row)) labels.push('反结案')
  }
  if (hasPageAction(model, menuPath, 'print')) labels.push(isPrintSelected(row) ? '已选择' : '打印选择')
  return labels
}

const printSelectedCount = computed(() => printSelectedOrderNos.value.length)

const pageSubtotal = computed(() => calcAssistOrderPageSubtotal(tableList.value))
/** 本页税额 = 含税总金额 − 不含税总金额（含税口径含额外费用） */
const pageTaxAmount = computed(() => {
  const inc = Number(pageSubtotal.value?.amountInc)
  const ex = Number(pageSubtotal.value?.amountEx)
  const a = Number.isFinite(inc) ? inc : 0
  const b = Number.isFinite(ex) ? ex : 0
  return Math.round((a - b) * 100) / 100
})

const isFormPanel = computed(() => pageMode.value === 'create' || pageMode.value === 'edit' || pageMode.value === 'view')
const isReadonlyForm = computed(() => pageMode.value === 'view')

const createPanelRef = ref(null)
const formHeadRef = ref(null)
const formFooterHeight = ref(56)
let formFooterRo = null

function syncFormFooterHeight() {
  const head = formHeadRef.value
  const panel = createPanelRef.value
  if (!head) return
  const h = Math.ceil(head.getBoundingClientRect().height)
  if (h > 0) {
    formFooterHeight.value = h
    panel?.style.setProperty('--assist-form-footer-height', `${h}px`)
  }
}

function bindFormFooterObserver() {
  formFooterRo?.disconnect()
  formFooterRo = null
  if (!formHeadRef.value) return
  syncFormFooterHeight()
  formFooterRo = new ResizeObserver(() => syncFormFooterHeight())
  formFooterRo.observe(formHeadRef.value)
}

watch(isFormPanel, async (on) => {
  if (!on) {
    formFooterRo?.disconnect()
    formFooterRo = null
    return
  }
  await nextTick()
  bindFormFooterObserver()
})

watch([tableList, loading, () => filters.recycled], async () => {
  if (loading.value) return
  await nextTick()
  listTableRef.value?.doLayout?.()
  const el = listTableRef.value?.$el
  if (el) refreshErpTableViewportHScroll(el)
})

const editRules = computed(() => ({
  assistOrderNo: [{ required: true, message: '请输入外协订单号', trigger: 'blur' }],
  assistDate: [{ required: true, message: '请选择外协日期', trigger: 'change' }],
  assistType: [{ required: true, message: '请选择外协类型', trigger: 'change' }],
  referenceNo:
    editForm.assistType === '1' || editForm.assistType === '2'
      ? [{ required: true, message: '请输入关联单号', trigger: 'blur' }]
      : [],
  supplierCode: [{ required: true, message: '请选择外协商', trigger: 'change' }],
  taxIncluded: [{ required: true, message: '请选择含税标记', trigger: 'change' }],
  currencyCode: [{ required: true, message: '请选择币别', trigger: 'change' }],
  decimalPlaces: [{ required: true, message: '请输入单价小数位', trigger: 'change' }],
  deliveryDate: [
    {
      validator: (_rule, value, callback) => {
        if (!value) {
          callback()
          return
        }
        const assist = editForm.assistDate
        if (!assist) {
          callback()
          return
        }
        if (new Date(value) < new Date(assist)) {
          callback(new Error('交货日期不能早于外协日期'))
          return
        }
        callback()
      },
      trigger: 'change',
    },
  ],
}))

function todayYmd() {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

const DEFAULT_PRINT_NOTES =
  '注：仅加工，不含开料，不含包装     以上价格包含乙方送货至甲方的单程运费'

function defaultEditForm() {
  return {
    assistOrderNo: '',
    assistDate: todayYmd(),
    assistType: '1',
    referenceNo: '',
    referenceOrderId: null,
    supplierCode: '',
    taxIncluded: '1',
    // 新增默认人民币（编码 001，与外协报价/采购报价一致）；下拉仍可改
    currencyCode: '001',
    deliveryDate: '',
    remark: '',
    notes: DEFAULT_PRINT_NOTES,
    decimalPlaces: 4,
    lines: [],
    fees: blankFeesRows(),
  }
}

function resetEditForm(next = {}) {
  Object.assign(editForm, defaultEditForm(), next)
  activeFormRef.value?.clearValidate?.()
}

function activeEditFormRef() {
  return isFormPanel.value ? activeFormRef.value : null
}

function formatCell(value) {
  const s = String(value ?? '').trim()
  return s || '-'
}

/** 主表操作记录一行：日期 YYYY-MM-DD + 真实姓名（空则登录名）；空值仍出模板不填内容 */
function formatAssistOpRecordLine(kind, time, operator) {
  const raw = String(time ?? '').trim()
  let t = ''
  if (raw) {
    const formatted = formatDate(raw)
    t = formatted === '-' ? '' : formatted
  }
  const op = String(operator ?? '').trim()
  return `${kind}时间:${t},操作者：${op}`
}

function formatDate(value) {
  if (!value) return '-'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return String(value).slice(0, 10) || '-'
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function dateForInput(value) {
  const s = formatDate(value)
  return s === '-' ? '' : s
}

function normalizeLine(row = {}, index = 0) {
  return {
    seq: index + 1,
    _lineMarked: false,
    piNo: String(row.piNo ?? ''),
    product: String(row.product ?? ''),
    kcaa01: String(row.kcaa01 ?? ''),
    kcaa02: String(row.kcaa02 ?? ''),
    kcaa02En: String(row.kcaa02En ?? ''),
    invoiceName: String(row.invoiceName ?? ''),
    kcaa03: String(row.kcaa03 ?? ''),
    kcaa04: String(row.kcaa04 ?? ''),
    kcaa05: String(row.kcaa05 ?? ''),
    kcaa09: String(row.origin ?? row.kcaa09 ?? ''),
    kcaa10: String(row.kcaa10 ?? ''),
    kcaa11: String(row.kcaa11 ?? ''),
    version: String(row.version ?? ''),
    customerSupply: String(row.customerSupply ?? ''),
    wxak03: Number(row.wxak03 ?? row.orderQty ?? 0),
    wxak04: Number(row.wxak04 ?? 0),
    wxak041: Number(row.wxak041 ?? 0),
    wxak05: Number(row.wxak05 ?? 0),
    wxak051: Number(row.wxak051 ?? 0),
    tax: Number(row.tax ?? 0),
    deliveryDate: dateForInput(row.deliveryDate) || editForm.deliveryDate || '',
    referenceNo: String(row.referenceNo ?? editForm.referenceNo ?? ''),
    remark: String(row.remark ?? ''),
  }
}

/** DIY：额外费用 Tab 默认行数（重置/新建时） */
const ASSIST_FEE_ROW_COUNT = 5

const ASSIST_HEADER_TAB_PROPS = new Set([
  'assistOrderNo',
  'assistDate',
  'assistType',
  'referenceNo',
  'supplierCode',
  'taxIncluded',
  'currencyCode',
  'decimalPlaces',
  'deliveryDate',
])

function pickFirstValidationMessage(invalidFields) {
  if (!invalidFields || typeof invalidFields !== 'object') return ''
  for (const field of Object.keys(invalidFields)) {
    const errors = invalidFields[field]
    if (Array.isArray(errors) && errors[0]?.message) return String(errors[0].message)
  }
  return ''
}

function focusAssistEditTabForField(prop) {
  if (ASSIST_HEADER_TAB_PROPS.has(String(prop ?? '').trim())) {
    editTab.value = 'header'
  }
}

function normalizeFee(row = {}, index = 0) {
  return {
    seq: index + 1,
    feeCode: String(row.feeCode ?? row.kcaa01 ?? ''),
    feeName: String(row.feeName ?? row.kcaa02 ?? row.mtitle ?? ''),
    money: Number(row.money ?? 0),
    tax: Number(row.tax ?? 0),
    remark: String(row.remark ?? ''),
  }
}

function padFeesToFixedRows(fees) {
  const rows = (Array.isArray(fees) ? fees : []).map((fee, i) => normalizeFee(fee, i))
  while (rows.length < ASSIST_FEE_ROW_COUNT) {
    rows.push(normalizeFee({}, rows.length))
  }
  return rows
}

function blankFeesRows() {
  return padFeesToFixedRows([])
}

function addFeesRow() {
  editForm.fees.push(normalizeFee({}, editForm.fees.length))
}

function resetFeesTab() {
  editForm.fees = blankFeesRows()
}

function isAudited(row) {
  return String(row?.pass ?? '').trim() === '1'
}

function isClosed(row) {
  return String(row?.closed ?? '').trim() === '1'
}

function canEdit(row) {
  return !isAudited(row) && !isClosed(row)
}

function isDeleted(row) {
  return String(row?.del ?? '').trim() === '1'
}

function canAudit(row) {
  return !isDeleted(row) && !isAudited(row)
}

function canUnaudit(row) {
  return !isDeleted(row) && isAudited(row) && !isClosed(row)
}

function canClose(row) {
  return !isDeleted(row) && isAudited(row) && !isClosed(row)
}

function canUnclose(row) {
  return !isDeleted(row) && isClosed(row)
}

function canDelete(row) {
  return !isDeleted(row) && !isAudited(row) && !isClosed(row)
}

function assistTypeText(value) {
  const s = String(value ?? '').trim()
  if (s === '1') return '订单外协'
  if (s === '2') return '订单外发'
  return '其他外协'
}

function taxFlagText(value) {
  const s = String(value ?? '').trim()
  if (s === '1') return '含税'
  if (s === '2') return '不含税'
  return '-'
}

function formatMoney(n) {
  const num = Number(n)
  if (!Number.isFinite(num)) return '0.00'
  return num.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

/** 页底本页统计金额：千分位，末尾 0 去掉（如 1860 → 1,860） */
function formatPageStatMoney(n) {
  const num = Number(n)
  if (!Number.isFinite(num)) return '0'
  const rounded = Math.round(num * 100) / 100
  return rounded.toLocaleString('zh-CN', { minimumFractionDigits: 0, maximumFractionDigits: 2 })
}

function formatSubtotalQty(n) {
  const num = Number(n)
  if (!Number.isFinite(num)) return '0'
  if (Number.isInteger(num)) return String(num)
  return num.toLocaleString('zh-CN', { minimumFractionDigits: 0, maximumFractionDigits: 4 })
}

function formatSubtotalUnitPrice(n) {
  if (n === null || n === undefined) return '-'
  const num = Number(n)
  if (!Number.isFinite(num)) return '-'
  return num.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 4 })
}

function formatWarehouseQty(n) {
  const num = Number(n)
  if (!Number.isFinite(num)) return '0'
  return Number.isInteger(num) ? String(num) : num.toLocaleString('zh-CN', { minimumFractionDigits: 0, maximumFractionDigits: 4 })
}

function toggleWarehouseDetail(line, type) {
  line._warehouseDetail = line._warehouseDetail === type ? '' : type
}

function openExpandedLineBom(row) {
  const materialCode = String(row?.kcaa01 ?? '').trim()
  if (!materialCode) {
    ElMessage.warning('当前明细缺少物料编码，无法查看 BOM 资料')
    return
  }
  const opened = window.open(`/inventory/basic/bom-data-window?mode=detail&code=${encodeURIComponent(materialCode)}`, '_blank')
  if (!opened) ElMessage.error('无法打开新窗口，请检查浏览器是否拦截弹窗')
}

function expandSummaryMethod(expandedLines, { columns }) {
  const sub = calcAssistOrderExpandSubtotal(expandedLines)
  return columns.map((col) => {
    const prop = col.property
    if (prop === 'kcaa02') return '小计：'
    if (prop === 'wxak03') return formatSubtotalQty(sub.quantity)
    if (prop === 'wxak04') return formatSubtotalUnitPrice(sub.unitPriceEx)
    if (prop === 'wxak041') return formatSubtotalUnitPrice(sub.unitPriceInc)
    if (prop === 'wxak05') return formatMoney(sub.amountEx)
    if (prop === 'wxak051') return formatMoney(sub.amountInc)
    return ''
  })
}

function assistOrderDataLines(row) {
  const supplier = formatCell(row?.supplierName || row?.supplierCode)
  return {
    line1: `外协商：${supplier}`,
    line2: `${taxFlagText(row?.taxIncluded)}，总项数: ${row?.itemCount ?? 0}，总数量: ${row?.totalQty ?? 0}`,
    line3: `含税总价: ${formatMoney(row?.taxIncludedTotal)} 元，不含税总价: ${formatMoney(row?.taxExcludedTotal)} 元，税点总价: ${formatMoney(row?.taxDiffTotal)} 元`,
    line4: `额外费用：${formatMoney(row?.extraFeeTotal)} 元`,
  }
}

function isPrintSelected(row) {
  const orderNo = String(row?.assistOrderNo ?? '').trim()
  return !!orderNo && printSelectedOrderNos.value.includes(orderNo)
}

function togglePrintSelect(row) {
  const orderNo = String(row?.assistOrderNo ?? '').trim()
  if (!orderNo) {
    ElMessage.warning('该外协订单缺少单号，不能加入打印')
    return
  }
  printSelectedOrderNos.value = printSelectedOrderNos.value.includes(orderNo)
    ? printSelectedOrderNos.value.filter((item) => item !== orderNo)
    : [...printSelectedOrderNos.value, orderNo]
}

async function loadData() {
  loading.value = true
  errorMessage.value = ''
  try {
    const res = await axios.get('/api/assist-order/list', {
      params: {
        page: page.value,
        pageSize: pageSize.value,
        keyword: filters.keyword,
        keywordField: filters.keywordField || '',
        supplier: filters.supplier,
        assistType: filters.assistType,
        showUnaudited: filters.showUnaudited ? '1' : '',
        showAll: filters.showAll ? '1' : '',
        recycled: filters.recycled ? '1' : '',
      },
    })
    const body = res.data ?? {}
    if (body.code !== 200) throw new Error(body.msg || '读取外协订单列表失败')
    tableList.value = Array.isArray(body.data?.list) ? body.data.list : []
    total.value = Number(body.data?.total ?? 0)
    expandPrefetch.prefetch(tableList.value)
  } catch (err) {
    errorMessage.value = err?.response?.data?.msg || err?.message || '读取外协订单列表失败'
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

function onRecycleChange() {
  page.value = 1
  if (filters.recycled) {
    filters.showUnaudited = false
  }
  loadData()
}

function onReset() {
  filters.keyword = ''
  filters.keywordField = ''
  filters.supplier = ''
  filters.assistType = ''
  filters.showUnaudited = false
  filters.showAll = false
  filters.recycled = false
  page.value = 1
  loadData()
}

function onPageSizeChange() {
  page.value = 1
  loadData()
}

function onPageChange() {
  loadData()
}

async function fetchSupplierOptions(keyword = '') {
  supplierLoading.value = true
  try {
    const res = await axios.get('/api/assist-order/supplier-options', { params: { keyword } })
    const body = res.data ?? {}
    supplierOptions.value = Array.isArray(body.data?.list) ? body.data.list : []
  } catch {
    supplierOptions.value = []
  } finally {
    supplierLoading.value = false
  }
}

async function fetchCurrencyOptions() {
  const res = await axios.get('/api/assist-order/currency-options')
  const body = res.data ?? {}
  currencyOptions.value = Array.isArray(body.data?.list) ? body.data.list : []
}

async function fetchSuggestedNo() {
  const res = await axios.get('/api/assist-order/suggest-doc-no', {
    params: { saveDate: editForm.assistDate },
  })
  const suggested = String(res.data?.data?.suggested ?? '').trim()
  if (suggested) editForm.assistOrderNo = suggested
  return suggested
}

async function checkAssistOrderNo(options = {}) {
  const { silent = false } = options
  const code = String(editForm.assistOrderNo ?? '').trim()
  if (!code) return null
  const params = { assistOrderNo: code }
  if (editMode.value === 'edit' && editId.value) {
    params.excludeId = editId.value
  }
  try {
    const res = await axios.get('/api/assist-order/check-doc-no', { params })
    const available = Boolean(res.data?.data?.available)
    const message = String(res.data?.data?.message ?? res.data?.msg ?? '').trim()
    if (!silent) {
      if (available) ElMessage.success('该单号可以使用')
      else ElMessage.error(message || '该外协单号已在在册记录中存在')
    }
    return { available, message }
  } catch (err) {
    if (!silent) {
      ElMessage.error(err?.response?.data?.msg || err?.message || '检测外协单号失败')
    }
    return null
  }
}

async function onAssistOrderNoFocus() {
  if (editMode.value !== 'create') return
  if (String(editForm.assistOrderNo ?? '').trim()) return
  await fetchSuggestedNo()
  await checkAssistOrderNo()
}

async function onAssistOrderNoBlur() {
  if (!String(editForm.assistOrderNo ?? '').trim()) return
  await checkAssistOrderNo()
}

function switchToManage() {
  if (pageMode.value === 'manage') return
  pageMode.value = 'manage'
  viewId.value = null
  editId.value = null
}

function switchMaterialTrace() {
  pageMode.value = 'material-trace'
  viewId.value = null
  editId.value = null
}

async function onMaterialTraceOpenView(payload) {
  await openView({ id: Number(payload?.id) })
}

async function switchToCreate() {
  if (pageMode.value === 'create') return
  const preserveDraft =
    createPanelInitialized.value &&
    editMode.value === 'create' &&
    pageMode.value !== 'edit' &&
    pageMode.value !== 'view'

  pageMode.value = 'create'
  editMode.value = 'create'
  editId.value = null
  viewId.value = null
  editTab.value = 'header'

  if (!preserveDraft) {
    resetEditForm()
    await fetchSuggestedNo()
  }
  if (!createPanelInitialized.value) {
    await Promise.all([fetchSupplierOptions(''), fetchCurrencyOptions()])
  }
  createPanelInitialized.value = true
}

async function resolveOrderIdByPi(piNo) {
  const keyword = String(piNo ?? '').trim()
  if (!keyword) return null
  try {
    const res = await axios.get('/api/sales-order/pi-suggest', { params: { keyword } })
    const list = Array.isArray(res?.data?.data?.list) ? res.data.data.list : []
    const row = list.find((item) => String(item.piNo ?? '').trim() === keyword)
    const id = Number(row?.id ?? 0)
    return Number.isFinite(id) && id > 0 ? id : null
  } catch {
    return null
  }
}

async function applyDetailToEditForm(data) {
  const h = data?.header || {}
  resetEditForm({
    assistOrderNo: String(h.assistOrderNo ?? ''),
    assistDate: dateForInput(h.assistDate),
    assistType: String(h.assistType ?? '0'),
    referenceNo: String(h.referenceNo ?? ''),
    supplierCode: String(h.supplierCode ?? ''),
    taxIncluded: String(h.taxIncluded ?? '1') === '2' ? '2' : '1',
    currencyCode: String(h.currencyCode ?? ''),
    deliveryDate: dateForInput(h.deliveryDate),
    remark: String(h.remark ?? ''),
    notes: String(h.notes ?? ''),
    decimalPlaces: Number(h.decimalPlaces ?? 4),
    lines: [...(data?.lines || [])]
      .sort((a, b) => Number(b?.seq ?? 0) - Number(a?.seq ?? 0))
      .map((line, index) => normalizeLine(line, index)),
    fees: padFeesToFixedRows(data?.fees),
  })
  renumberLines()
  const refNo = String(editForm.referenceNo ?? '').trim()
  editForm.referenceOrderId = refNo ? await resolveOrderIdByPi(refNo) : null
}

async function onFormReset() {
  if (pageMode.value === 'create') {
    resetEditForm()
    editTab.value = 'header'
    await Promise.all([fetchSupplierOptions(''), fetchCurrencyOptions(), fetchSuggestedNo()])
    return
  }
  if (pageMode.value === 'edit' && editId.value) {
    detailLoading.value = true
    try {
      const data = await loadDetail(editId.value)
      applyDetailToEditForm(data)
      editTab.value = 'header'
    } catch (err) {
      ElMessage.error(err?.response?.data?.msg || err?.message || '重置失败')
    } finally {
      detailLoading.value = false
    }
  }
}

async function openEdit(row) {
  if (!canEdit(row)) return
  const id = Number(row?.id)
  if (!Number.isFinite(id) || id <= 0) {
    ElMessage.warning('外协订单参数无效')
    return
  }
  editMode.value = 'edit'
  editId.value = id
  viewId.value = null
  editTab.value = 'header'
  pageMode.value = 'edit'
  createPanelInitialized.value = true
  detailLoading.value = true
  try {
    await Promise.all([fetchSupplierOptions(''), fetchCurrencyOptions()])
    const data = await loadDetail(id)
    applyDetailToEditForm(data)
  } catch (err) {
    ElMessage.error(err?.response?.data?.msg || err?.message || '读取外协订单详情失败')
    pageMode.value = 'manage'
    editId.value = null
  } finally {
    detailLoading.value = false
  }
}

async function onAssistDateChange() {
  if (editMode.value === 'create') await fetchSuggestedNo()
  if (editForm.deliveryDate && editForm.assistDate) {
    if (new Date(editForm.deliveryDate) < new Date(editForm.assistDate)) {
      editForm.deliveryDate = ''
      ElMessage.warning('交货日期不能早于外协日期，已清空交货日期')
    }
  }
  await nextTick()
  activeEditFormRef()?.validateField?.('deliveryDate')
}

async function loadDetail(id) {
  const res = await axios.get(`/api/assist-order/${id}`)
  const body = res.data ?? {}
  if (body.code !== 200) throw new Error(body.msg || '读取外协订单详情失败')
  return {
    header: body.data?.header || null,
    lines: Array.isArray(body.data?.lines) ? body.data.lines : [],
    fees: Array.isArray(body.data?.fees) ? body.data.fees : [],
  }
}

const expandPrefetch = createExpandPrefetch({
  fetchBatch: async (ids) => {
    const { data } = await axios.get('/api/assist-order/expand-detail/batch', { params: { ids: ids.join(',') } })
    if (data.code !== 200) throw new Error(data.msg)
    return data.data || {}
  },
  fetchSingle: async (id) => {
    const detail = await loadDetail(id)
    return { lines: detail.lines, fees: detail.fees }
  },
  getRowId: (row) => Number(row?.id),
  applyToRow: (row, payload) => {
    row.expandedLines = buildExpandedDisplayRows(payload?.lines, payload?.fees)
    row.expandedLoaded = true
    row.expandedLoading = false
  },
  resetRow: (row) => {
    row.expandedLines = []
    row.expandedLoaded = false
    row.expandedLoading = false
  },
  onError: (msg) => ElMessage.error(msg),
})

function buildExpandedDisplayRows(lines, fees) {
  const lineRows = Array.isArray(lines) ? lines : []
  const feeRows = (Array.isArray(fees) ? fees : []).map((fee) => ({
    _rowType: 'fee',
    product: '',
    kcaa01: '',
    kcaa02: String(fee.feeName ?? fee.kcaa02 ?? fee.mtitle ?? ''),
    wxak03: '',
    wxak04: '',
    wxak041: '',
    wxak05: '',
    wxak051: fee.money,
    tax: fee.tax,
    deliveryDate: '',
    referenceNo: '',
    remark: String(fee.remark ?? ''),
  }))
  return [...lineRows, ...feeRows]
}

async function onExpandChange(row, expandedRows) {
  const expanded = expandedRows.some((item) => item.id === row.id)
  if (!expanded) return
  if (row.expandedLoaded) return
  await expandPrefetch.ensureLoaded(row)
}

function onListRowClick(row, column, event) {
  if (!row?.id || !listTableRef.value) return
  const target = event?.target
  if (target && typeof target.closest === 'function') {
    if (target.closest('.el-button, button, a, input, textarea, select')) return
    if (target.closest('.el-table__expand-icon')) return
  }
  if (column?.type === 'expand') return
  listTableRef.value.toggleRowExpansion(row)
}

function renumberLines() {
  const total = editForm.lines.length
  editForm.lines.forEach((line, i) => {
    line.seq = total - i
  })
}

async function deleteSelectedLines() {
  const marked = editForm.lines.filter((line) => line._lineMarked)
  if (!marked.length) {
    ElMessage.warning('请先在操作列点击删除标记要移除的行')
    return
  }
  try {
    await ElMessageBox.confirm(
      `确认删除已标记的 ${marked.length} 条明细吗？此操作仅影响当前页面，点「立即提交」后才会落库。`,
      '删除选定明细',
      {
        type: 'warning',
        confirmButtonText: '删除',
        cancelButtonText: '取消',
      },
    )
  } catch {
    return
  }
  const removeSet = new Set(marked)
  editForm.lines = editForm.lines.filter((line) => !removeSet.has(line))
  renumberLines()
  ElMessage.success('已删除选定明细')
}

async function deleteAllLines() {
  if (!editForm.lines.length) {
    ElMessage.warning('当前没有明细行')
    return
  }
  try {
    await ElMessageBox.confirm('确认要删除全部明细行吗？此操作仅影响当前页面，点「立即提交」后才会落库。', '删除全部明细', {
      type: 'warning',
      confirmButtonText: '删除全部',
      cancelButtonText: '取消',
    })
  } catch {
    return
  }
  editForm.lines = []
  ElMessage.success('已清空全部明细')
}

function buildBatchCurrentLines() {
  return editForm.lines.map((line) => ({
    piNo: line.piNo || editForm.referenceNo,
    product: line.product,
    kcaa01: line.kcaa01,
    wxak03: line.wxak03,
  }))
}

function applyBatchAddLines(lines) {
  const list = Array.isArray(lines) ? lines : []
  if (!list.length) return
  const newLines = list.map((row) => {
    const line = normalizeLine(row, 0)
    applyLineCalc(line, recalcAssistOrderLineFromQuotedPrices(line, { priceDecimals: editForm.decimalPlaces }))
    return line
  })
  editForm.lines.unshift(...newLines)
  renumberLines()
  ElMessage.success(`已批量添加 ${list.length} 条明细`)
}

function openBatchAdd() {
  const assistType = String(editForm.assistType ?? '')
  if (assistType !== '0' && assistType !== '1' && assistType !== '2') {
    ElMessage.warning('当前外协类型暂不支持批量添加，后续版本开放')
    return
  }
  const piNo = String(editForm.referenceNo ?? '').trim()
  if (assistType !== '0' && !piNo) {
    ElMessage.warning('订单外协须先填写关联 PI 号')
    return
  }
  const supplierCode = String(editForm.supplierCode ?? '').trim()
  if (!supplierCode) {
    ElMessage.warning('\u8bf7\u5148\u9009\u62e9\u5916\u534f\u5546\uff0c\u624d\u80fd\u6279\u91cf\u6dfb\u52a0\u5e76\u81ea\u52a8\u5e26\u51fa\u5355\u4ef7')
    return
  }
  const sessionId = buildAssistBatchSessionId()
  activeBatchSessionId.value = sessionId
  writeAssistBatchContext(sessionId, {
    piNo,
    supplierCode,
    assistType,
    excludeOrderNo: editMode.value === 'edit' ? String(editForm.assistOrderNo ?? '').trim() : '',
    deliveryDate: editForm.deliveryDate,
    decimalPlaces: editForm.decimalPlaces,
    currentLines: buildBatchCurrentLines(),
  })
  const url = `/supply-chain/daily/outsourcing-order-batch-window?sessionId=${encodeURIComponent(sessionId)}${piNo ? `&piNo=${encodeURIComponent(piNo)}` : ''}`
  const opened = window.open(url, '_blank')
  if (!opened) {
    ElMessage.error('无法打开新窗口，请检查浏览器是否拦截弹窗')
  }
}

function handleBatchStorageEvent(event) {
  const key = String(event?.key ?? '')
  if (!key.startsWith(ASSIST_BATCH_RESULT_PREFIX)) return
  const sessionId = key.slice(ASSIST_BATCH_RESULT_PREFIX.length)
  if (sessionId !== activeBatchSessionId.value) return
  const payload = parseAssistBatchResultPayload(event?.newValue)
  if (!payload?.lines?.length) return
  const validation = validateBatchApply({
    openedPiNo: payload.openedPiNo,
    currentPiNo: editForm.referenceNo,
    openedSupplierCode: payload.openedSupplierCode,
    currentSupplierCode: editForm.supplierCode,
    requirePi: String(editForm.assistType ?? '') !== '0',
  })
  if (!validation.ok) {
    if (validation.reason === ASSIST_BATCH_REJECT_PI_MISMATCH) {
      ElMessage.warning('\u5173\u8054 PI \u5df2\u53d8\u66f4\uff0c\u6279\u91cf\u9009\u6750\u5df2\u53d6\u6d88')
    } else if (validation.reason === ASSIST_BATCH_REJECT_SUPPLIER_MISMATCH) {
      ElMessage.warning('\u5916\u534f\u5546\u5df2\u53d8\u66f4\uff0c\u8bf7\u91cd\u65b0\u6253\u5f00\u6279\u91cf\u9009\u6750')
    }
    activeBatchSessionId.value = ''
    return
  }
  applyBatchAddLines(payload.lines)
  activeBatchSessionId.value = ''
}

function postBatchMessageToSource(source, payload) {
  if (!source || typeof source.postMessage !== 'function') return
  source.postMessage(payload, window.location.origin)
}

function handleBatchMessage(event) {
  if (event.origin !== window.location.origin) return
  const data = event.data
  if (!data || data.type !== ASSIST_BATCH_MSG_APPLY) return
  const sessionId = String(data.sessionId ?? '').trim()
  if (!sessionId || sessionId !== activeBatchSessionId.value) return

  const validation = validateBatchApply({
    openedPiNo: data.openedPiNo,
    currentPiNo: editForm.referenceNo,
    openedSupplierCode: data.openedSupplierCode,
    currentSupplierCode: editForm.supplierCode,
    requirePi: String(editForm.assistType ?? '') !== '0',
  })
  if (!validation.ok) {
    if (validation.reason === ASSIST_BATCH_REJECT_PI_MISMATCH) {
      ElMessage.warning('\u5173\u8054 PI \u5df2\u53d8\u66f4\uff0c\u6279\u91cf\u9009\u6750\u5df2\u53d6\u6d88')
    } else if (validation.reason === ASSIST_BATCH_REJECT_SUPPLIER_MISMATCH) {
      ElMessage.warning('\u5916\u534f\u5546\u5df2\u53d8\u66f4\uff0c\u8bf7\u91cd\u65b0\u6253\u5f00\u6279\u91cf\u9009\u6750')
    }
    postBatchMessageToSource(event.source, {
      type: ASSIST_BATCH_MSG_REJECTED,
      sessionId,
      reason: validation.reason,
    })
    return
  }

  const lines = Array.isArray(data.lines) ? data.lines : []
  if (!lines.length) {
    postBatchMessageToSource(event.source, {
      type: ASSIST_BATCH_MSG_REJECTED,
      sessionId,
      reason: 'empty-lines',
    })
    return
  }

  applyBatchAddLines(lines)
  activeBatchSessionId.value = ''
  postBatchMessageToSource(event.source, {
    type: ASSIST_BATCH_MSG_ACCEPTED,
    sessionId,
    lineCount: lines.length,
  })
}

function toggleLineMark(row) {
  if (!row) return
  row._lineMarked = !row._lineMarked
}

async function openLinePiBom(row) {
  const product = String(row?.product ?? '').trim()
  if (!product) {
    ElMessage.warning('该行缺少款号，无法打开 PI-BOM')
    return
  }
  let orderId = Number(editForm.referenceOrderId ?? 0)
  if (!Number.isFinite(orderId) || orderId <= 0) {
    const refNo = String(editForm.referenceNo ?? '').trim()
    if (!refNo) {
      ElMessage.warning('请先填写关联 PI 号')
      return
    }
    orderId = await resolveOrderIdByPi(refNo)
    if (orderId) editForm.referenceOrderId = orderId
  }
  if (!orderId) {
    ElMessage.warning('无法解析销售订单，请确认关联 PI 号是否正确')
    return
  }
  // 对齐 PI_BOM 资料「查看」：mode=view → PiBomViewerPanel（非编辑面板）
  const linePi = String(row?.piNo ?? '').trim()
  const formPi = String(editForm.referenceNo ?? '').trim()
  const pi = linePi || formPi
  let url = `/inventory/basic/pi-bom-data-window?mode=view&orderId=${encodeURIComponent(orderId)}&kcaa01=${encodeURIComponent(product)}`
  if (pi) url += `&piNo=${encodeURIComponent(pi)}`
  const opened = window.open(url, '_blank')
  if (!opened) {
    ElMessage.error('无法打开新窗口，请检查浏览器是否拦截弹窗')
  }
}

function applyLineCalc(row, next) {
  Object.assign(row, next)
}

function onLineTaxExcludedChange(row) {
  applyLineCalc(row, recalcAssistOrderLineFromTaxExcluded(row, { priceDecimals: editForm.decimalPlaces }))
}

function onLineTaxIncludedChange(row) {
  applyLineCalc(row, recalcAssistOrderLineFromTaxIncluded(row, { priceDecimals: editForm.decimalPlaces }))
}

function openSelectedPrint(wxgs) {
  const selected = printSelectedOrderNos.value
  if (!selected.length) {
    ElMessage.warning('请选择需要打印的订单')
    return
  }
  const query = new URLSearchParams({ p_sum: selected.join(','), wxgs: String(wxgs) })
  const opened = window.open(`/supply-chain/daily/outsourcing-order-print?${query.toString()}`, '_blank')
  if (!opened) ElMessage.error('无法打开打印窗口，请检查浏览器是否拦截弹窗')
}

async function openView(row) {
  const id = Number(row?.id)
  if (!Number.isFinite(id) || id <= 0) {
    ElMessage.warning('外协订单参数无效')
    return
  }
  viewId.value = id
  editId.value = null
  editTab.value = 'header'
  pageMode.value = 'view'
  createPanelInitialized.value = true
  detailLoading.value = true
  try {
    await Promise.all([fetchSupplierOptions(''), fetchCurrencyOptions()])
    const data = await loadDetail(id)
    applyDetailToEditForm(data)
  } catch (err) {
    ElMessage.error(err?.response?.data?.msg || err?.message || '读取外协订单详情失败')
    pageMode.value = 'manage'
    viewId.value = null
  } finally {
    detailLoading.value = false
  }
}

useErpDeepLinkOpen({
  handlers: {
    view: async (recordId) => {
      const id = Number(recordId)
      if (!Number.isFinite(id) || id <= 0) return
      await openView({ id })
    },
    manage: async () => switchToManage(),
    create: async () => {
      await switchToCreate()
    },
    'material-trace': async () => switchMaterialTrace(),
  },
})

const LIFECYCLE_CONFIRM = {
  audit: (label) => ({
    message: `确认要审核外协订单【${label}】吗？审核后将锁定编辑与删除。`,
    title: '审核确认',
    options: { type: 'warning', confirmButtonText: '审核', cancelButtonText: '取消' },
  }),
  unaudit: (label) => ({
    message: `确认要反审外协订单【${label}】吗？反审后可再编辑保存。`,
    title: '反审确认',
    options: { type: 'warning', confirmButtonText: '反审', cancelButtonText: '取消' },
  }),
  close: (label) => ({
    message: `确认要结案外协订单【${label}】吗？结案后须先反结案才能反审。`,
    title: '结案确认',
    options: { type: 'warning', confirmButtonText: '结案', cancelButtonText: '取消' },
  }),
  unclose: (label) => ({
    message: `确认要反结案外协订单【${label}】吗？反结案后可再结案或反审。`,
    title: '反结案确认',
    options: { type: 'warning', confirmButtonText: '反结案', cancelButtonText: '取消' },
  }),
  delete: (label) => ({
    message: `确认要删除外协订单【${label}】吗？删除后将移入回收站，可在回收站恢复。`,
    title: '删除确认',
    options: { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' },
  }),
  'hard-delete': (label) => ({
    message: `确认要彻底删除外协订单【${label}】吗？该操作不可恢复。`,
    title: '危险操作',
    options: {
      type: 'error',
      confirmButtonText: '彻底删除',
      cancelButtonText: '取消',
      confirmButtonClass: 'el-button--danger',
    },
  }),
  restore: (label) => ({
    message: `确认要恢复外协订单【${label}】吗？`,
    title: '恢复确认',
    options: { type: 'info', confirmButtonText: '恢复', cancelButtonText: '取消' },
  }),
}

async function confirmAssistOrderLifecycle(row, action) {
  const factory = LIFECYCLE_CONFIRM[action]
  if (!factory) return true
  const label = formatCell(row.assistOrderNo)
  const { message, title, options } = factory(label)
  try {
    await ElMessageBox.confirm(message, title, options)
    return true
  } catch {
    return false
  }
}

async function runLifecycle(row, action) {
  const id = Number(row?.id)
  if (!Number.isFinite(id) || id <= 0) {
    ElMessage.warning('外协订单参数无效')
    return
  }
  if (!(await confirmAssistOrderLifecycle(row, action))) return
  try {
    const res =
      action === 'delete'
        ? await axios.delete(`/api/assist-order/${id}`)
        : action === 'hard-delete'
          ? await axios.delete(`/api/assist-order/${id}/hard`)
          : await axios.post(`/api/assist-order/${id}/${action}`)
    const body = res.data ?? {}
    if (body.code !== 200) throw new Error(body.msg || '操作失败')
    ElMessage.success(body.msg || '操作成功')
    await loadData()
  } catch (err) {
    ElMessage.error(err?.response?.data?.msg || err?.message || '操作失败')
  }
}

async function onSave() {
  const form = activeEditFormRef()
  if (!form) return
  try {
    await form.validate()
  } catch (invalidFields) {
    const msg = pickFirstValidationMessage(invalidFields)
    ElMessage.warning(msg || '请完善必填项后再提交')
    focusAssistEditTabForField(Object.keys(invalidFields || {})[0])
    return
  }
  saveLoading.value = true
  try {
    const { lines: _lines, fees: _fees, referenceOrderId: _refOid, ...headerFields } = editForm
    const body = {
      header: headerFields,
      lines: editForm.lines.map((line, index) => {
        const { _lineMarked, ...rest } = line
        return { ...rest, seq: editForm.lines.length - index }
      }),
      fees: editForm.fees
        .filter((fee) => String(fee.feeCode ?? '').trim())
        .map((fee, index) => ({ ...fee, seq: index + 1 })),
    }
    const isCreateSave = pageMode.value === 'create'
    const res = isCreateSave
      ? await axios.post('/api/assist-order', body)
      : await axios.put(`/api/assist-order/${editId.value}`, body)
    const resp = res.data ?? {}
    if (resp.code !== 200) throw new Error(resp.msg || '保存失败')
    const finalNo = String(resp.data?.assistOrderNo ?? '').trim()
    ElMessage.success(resp.data?.changedOrderNo && finalNo ? `保存成功，最终单号：${finalNo}` : '保存成功')
    pageMode.value = 'manage'
    if (isCreateSave) {
      resetEditForm()
      createPanelInitialized.value = false
    }
    await loadData()
  } catch (err) {
    ElMessage.error(err?.response?.data?.msg || err?.message || '保存失败')
  } finally {
    saveLoading.value = false
  }
}

onMounted(async () => {
  window.addEventListener('storage', handleBatchStorageEvent)
  window.addEventListener('message', handleBatchMessage)
  await loadData()
})

onUnmounted(() => {
  formFooterRo?.disconnect()
  formFooterRo = null
  window.removeEventListener('storage', handleBatchStorageEvent)
  window.removeEventListener('message', handleBatchMessage)
})
</script>

<style scoped>
.assist-order-page {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

/* DIY：表单模式对齐入库单——不锁 100vh、不造内层滚动条；页面随内容自然增高 */
.assist-order-page--form {
  --assist-form-footer-height: 56px;
  gap: 8px;
}

.assist-order-page--form .assist-mode-bar {
  flex-shrink: 0;
  margin-bottom: 0;
}

.assist-mode-bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
}

.assist-material-trace-panel {
  padding: 0;
  background: var(--erp-surface, #fff);
}

.assist-create-panel {
  display: flex;
  flex-direction: column;
  gap: 0;
}

.assist-create-panel :deep(.assist-edit-form) {
  display: flex;
  flex-direction: column;
}

/* DIY：外协订单表单头（标题「新增/编辑/查看外协订单」+ 立即提交/重置/返回列表）
   标题字号建议 16～22；按钮高度建议 36～48，字号建议 13～16 */
.assist-form-head {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 8px 0 12px;
  border-bottom: 1px solid var(--el-border-color-light);
  --assist-form-head-title-font-size: 18px;
  --assist-form-head-btn-height: 36px;
  --assist-form-head-btn-font-size: 16px;
}

.assist-form-head__title {
  font-size: var(--assist-form-head-title-font-size);
}

.assist-form-head__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.assist-form-head__actions :deep(.el-button) {
  height: var(--assist-form-head-btn-height);
  min-height: var(--assist-form-head-btn-height);
  font-size: var(--assist-form-head-btn-font-size);
}

.assist-form-footer {
  display: flex;
  flex-shrink: 0;
  justify-content: flex-start;
  gap: 5px;              /* 两按钮间距，只改这里 */
  position: sticky;
  bottom: 0;
  z-index: 2;
  margin-left: 0px;    /* 整组右移，与打印注释输入框对齐 */
  padding: 10px 0 4px;
  border-top: 1px solid var(--el-border-color-light);
  background: var(--el-bg-color);
}

.assist-form-footer :deep(.el-button) {
  min-height: 40px;
  height: 40px;
  font-size: 15px;
  padding-left: 20px;
  padding-right: 20px;
  /* 不要在这里写 margin-left */
}
.assist-alert,
.audit-alert {
  margin-bottom: 14px;
}

.assist-filter-bar {
  margin-bottom: 4px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.assist-filter-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-start;
  gap: 8px;
  width: 100%;
}

.assist-print-selected {
  color: var(--el-text-color-secondary);
  font-size: 13px;
  white-space: nowrap;
}

.assist-filter-field {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.assist-filter-label {
  flex-shrink: 0;
  font-size: 13px;
  color: var(--el-text-color-regular);
  white-space: nowrap;
}

.assist-filter-select {
  min-width: 200px;
  width: min(240px, 100%);
}

.assist-keyword-input {
  flex: 0 0 420px;
  width: 420px;
  min-width: 420px;
  max-width: 420px;
}

.assist-filter-divider {
  width: 1px;
  height: 22px;
  margin: 0 20px;
  background: var(--el-border-color);
  flex-shrink: 0;
}

.assist-filter-switch {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.switch-label {
  font-size: 13px;
  color: var(--el-text-color-regular);
}

.assist-table {
  width: 100%;
}

.assist-expand-inner {
  padding: 8px 12px 12px;
  min-height: 48px;
}

.assist-expand-lines-table :deep(.el-table__footer-wrapper td) {
  background: var(--el-fill-color-light);
}

.assist-expand-lines-table :deep(.el-table__footer .cell) {
  font-weight: 600;
  text-align: right;
}

.assist-expand-lines-table :deep(.el-table__footer td.el-table__cell:nth-child(4) .cell) {
  text-align: left;
}

.assist-warehouse-cell {
  display: grid;
  gap: 4px;
  min-width: 230px;
  line-height: 1.45;
}

.assist-warehouse-cell__summary {
  display: grid;
  gap: 2px;
  color: var(--el-text-color-regular);
}

.assist-warehouse-cell__details {
  display: grid;
  gap: 2px;
  padding: 6px 8px;
  border: 1px solid var(--el-border-color-lighter);
  background: var(--el-fill-color-light);
  color: var(--el-text-color-secondary);
  font-size: 12px;
}

.assist-page-subtotal {
  margin: 8px 0 4px;
  padding: 10px 12px;
  border: 1px solid var(--el-border-color-lighter);
  background: var(--el-fill-color-light);
  font-size: 13px;
  line-height: 1.5;
  font-variant-numeric: tabular-nums;
  color: var(--el-text-color-primary);
}

.assist-order-data {
  display: flex;
  flex-direction: column;
  gap: 4px;
  line-height: 1.6;
  font-size: 13px;
}

.assist-order-data__line {
  white-space: normal;
  word-break: break-all;
}

/* 字号/颜色跟主表其它列（如外协商）一致，不单独缩小 */
.assist-op-record {
  line-height: 1.45;
}

.assist-material-toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 10px;
}

.assist-material-toolbar .el-input {
  max-width: 360px;
}

.assist-table :deep(.el-input-number) {
  width: 100%;
}

:deep(.assist-material-row--selectable) {
  --el-table-tr-bg-color: #fff7ed;
}

:deep(.assist-material-row--disabled) {
  color: var(--el-text-color-placeholder);
}

.code-text {
  font-weight: 650;
}

:deep(.assist-detail-dialog .el-dialog__body) {
  padding-top: 10px;
}

</style>
