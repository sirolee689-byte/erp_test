<template>
  <el-form ref="formRef" :model="model" :rules="rules" label-width="110px" class="assist-edit-form">
    <el-tabs :model-value="editTab" @update:model-value="$emit('update:editTab', $event)">
      <el-tab-pane label="外协订单基础资料" name="header">
        <div class="assist-header-scroll">
        <div class="assist-header-rows">
          <div class="assist-form-row assist-form-row--1">
            <el-form-item label="外协单号" prop="assistOrderNo">
              <el-input
                v-model="model.assistOrderNo"
                placeholder="系统建议，可手动修改"
                :readonly="readonly"
                @focus="emit('assist-order-no-focus')"
                @blur="emit('assist-order-no-blur')"
              />
            </el-form-item>
          </div>
          <div class="assist-form-row assist-form-row--2">
            <el-form-item label="外协日期" prop="assistDate">
              <el-date-picker
                v-model="model.assistDate"
                type="date"
                value-format="YYYY-MM-DD"
                placeholder="请选择外协日期"
                :disabled="readonly"
                @change="onAssistDateChanged"
              />
            </el-form-item>
            <el-form-item label="交货日期" prop="deliveryDate">
              <el-date-picker
                v-model="model.deliveryDate"
                type="date"
                value-format="YYYY-MM-DD"
                placeholder="请选择交货日期"
                :disabled="readonly"
                :disabled-date="disableDeliveryBeforeAssist"
              />
            </el-form-item>
          </div>
          <div class="assist-form-row assist-form-row--2">
            <el-form-item label="外协类型" prop="assistType">
              <div class="assist-basic-buttons" role="radiogroup" aria-label="外协类型">
                <el-button
                  v-for="opt in assistTypeOptions"
                  :key="opt.value"
                  :type="model.assistType === opt.value ? 'primary' : ''"
                  :disabled="readonly"
                  @click="chooseAssistType(opt.value)"
                >
                  {{ opt.label }}
                </el-button>
              </div>
            </el-form-item>
            <el-form-item label="关联单号" prop="referenceNo">
              <el-autocomplete
                v-model="model.referenceNo"
                :fetch-suggestions="fetchPiSuggestions"
                value-key="piNo"
                clearable
                :disabled="readonly"
                :placeholder="referenceNoPlaceholder"
                @select="onPickPi"
                @blur="onReferenceNoBlur"
              />
            </el-form-item>
          </div>
          <div class="assist-form-row assist-form-row--1">
            <el-form-item label="外协商" prop="supplierCode">
              <el-select
                v-model="model.supplierCode"
                class="assist-field-supplier"
                filterable
                remote
                reserve-keyword
                :disabled="readonly"
                :remote-method="(kw) => $emit('fetch-supplier', kw)"
                :loading="supplierLoading"
                placeholder="输入编码或名称搜索"
              >
                <el-option
                  v-for="item in supplierOptions"
                  :key="item.code"
                  :label="`${item.code} ${item.name}`"
                  :value="item.code"
                />
              </el-select>
            </el-form-item>
          </div>
          <div class="assist-form-row assist-form-row--3">
            <el-form-item label="是否含税" prop="taxIncluded">
              <div class="assist-basic-buttons" role="radiogroup" aria-label="是否含税">
                <el-button
                  :type="model.taxIncluded === '1' ? 'primary' : ''"
                  :disabled="readonly"
                  @click="chooseTaxIncluded('1')"
                >
                  是
                </el-button>
                <el-button
                  :type="model.taxIncluded === '2' ? 'primary' : ''"
                  :disabled="readonly"
                  @click="chooseTaxIncluded('2')"
                >
                  否
                </el-button>
              </div>
            </el-form-item>
            <el-form-item label="币别" prop="currencyCode">
              <el-select v-model="model.currencyCode" filterable placeholder="请选择币别" :disabled="readonly">
                <el-option
                  v-for="item in currencyOptions"
                  :key="item.code"
                  :label="`${item.code} ${item.name}`"
                  :value="item.code"
                />
              </el-select>
            </el-form-item>
            <el-form-item label="小数点配置" prop="decimalPlaces">
              <el-input-number
                v-model="model.decimalPlaces"
                class="assist-field-sm"
                :min="0"
                :max="6"
                :step="1"
                :disabled="readonly"
              />
            </el-form-item>
          </div>
          <div class="assist-form-row assist-form-row--1">
            <el-form-item label="备注">
              <el-input v-model="model.remark" type="textarea" :rows="3" :readonly="readonly" />
            </el-form-item>
          </div>
          <div class="assist-form-row assist-form-row--1">
            <el-form-item label="打印注释">
              <el-input v-model="model.notes" type="textarea" :rows="3" :readonly="readonly" />
            </el-form-item>
          </div>
        </div>
        </div>
      </el-tab-pane>
      <el-tab-pane label="外协订单明细" name="lines">
        <div class="assist-lines-pane">
          <div v-if="!readonly" class="assist-lines-toolbar">
            <el-button type="danger" plain @click="$emit('delete-selected-lines')">删除选定明细</el-button>
            <el-button type="danger" plain @click="$emit('delete-all-lines')">删除全部明细</el-button>
            <el-button type="primary" @click="$emit('open-batch-add')">批量添加</el-button>
          </div>
          <div class="assist-lines-table-wrap">
            <ErpTableViewportHScroll :bottom-offset="assistLinesHScrollBottom">
              <el-table
                ref="linesTableRef"
                :data="model.lines"
                border
                stripe
                class="erp-list-table assist-lines-table"
                empty-text="暂无明细"
                :row-class-name="lineRowClassName"
              >
                <el-table-column
                  label="操作"
                  :width="assistLineActionsColWidth"
                  fixed="left"
                  align="center"
                  header-align="center"
                  class-name="erp-col-actions"
                >
                  <template #default="{ row }">
                    <ErpTableActions class="assist-line-actions">
                      <el-button
                        size="small"
                        type="primary"
                        plain
                        class="assist-line-action-btn"
                        @click="$emit('view-line-pi-bom', row)"
                      >
                        查看
                      </el-button>
                      <el-button
                        v-if="!readonly"
                        size="small"
                        class="assist-line-action-btn assist-line-mark-btn"
                        :class="{ 'assist-line-mark-btn--on': row._lineMarked }"
                        @click="$emit('toggle-line-mark', row)"
                      >
                        {{ row._lineMarked ? '已选择' : '删除' }}
                      </el-button>
                    </ErpTableActions>
                  </template>
                </el-table-column>
                <el-table-column label="序号" width="64" align="center">
                  <template #default="{ $index }">{{ model.lines.length - $index }}</template>
                </el-table-column>
          <el-table-column label="物料编码" prop="kcaa01" min-width="150" show-overflow-tooltip />
          <el-table-column label="中文名" prop="kcaa02" min-width="160" show-overflow-tooltip />
          <el-table-column label="规格" prop="kcaa03" min-width="140" show-overflow-tooltip />
          <el-table-column label="单位" prop="kcaa04" width="90" />
          <el-table-column label="数量" width="126">
            <template #default="{ row }">
              <template v-if="readonly">{{ formatErpQtyDisplay(row.wxak03) }}</template>
              <div v-else class="assist-line-qty-cell">
                <el-input-number
                  v-model="row.wxak03"
                  :precision="2"
                  :min="0"
                  :disabled="row.inboundLocked"
                  controls-position="right"
                  @change="$emit('line-tax-excluded-change', row)"
                />
                <span v-if="row.inboundLocked" class="assist-line-lock-tip">已入库，数量锁定</span>
              </div>
            </template>
          </el-table-column>
          <el-table-column label="不含税单价" width="138">
            <template #default="{ row }">
              <template v-if="readonly">{{ formatErpPriceDisplay(row.wxak04, { maxDecimals: model.decimalPlaces }) }}</template>
              <el-input-number
                v-else
                v-model="row.wxak04"
                :precision="model.decimalPlaces"
                :min="0"
                controls-position="right"
                @change="$emit('line-tax-excluded-change', row)"
              />
            </template>
          </el-table-column>
          <el-table-column label="税点" width="116">
            <template #default="{ row }">
              <template v-if="readonly">{{ formatErpPriceDisplay(row.tax, { maxDecimals: 4 }) }}</template>
              <el-input-number
                v-else
                v-model="row.tax"
                :precision="6"
                :min="0"
                controls-position="right"
                @change="$emit('line-tax-excluded-change', row)"
              />
            </template>
          </el-table-column>
          <el-table-column label="含税单价" width="138">
            <template #default="{ row }">
              <template v-if="readonly">{{ formatErpPriceDisplay(row.wxak041, { maxDecimals: model.decimalPlaces }) }}</template>
              <el-input-number
                v-else
                v-model="row.wxak041"
                :precision="model.decimalPlaces"
                :min="0"
                controls-position="right"
                @change="$emit('line-tax-included-change', row)"
              />
            </template>
          </el-table-column>
          <el-table-column label="不含税金额" width="116" align="right">
            <template #default="{ row }">{{ formatErpMoneyDisplay(row.wxak05) }}</template>
          </el-table-column>
          <el-table-column label="含税金额" width="116" align="right">
            <template #default="{ row }">{{ formatErpMoneyDisplay(row.wxak051) }}</template>
          </el-table-column>
          <el-table-column label="交货日期" width="150">
            <template #default="{ row }">
              <template v-if="readonly">{{ row.deliveryDate || '-' }}</template>
              <el-date-picker v-else v-model="row.deliveryDate" type="date" value-format="YYYY-MM-DD" />
            </template>
          </el-table-column>
          <el-table-column label="参考单号" width="150">
            <template #default="{ row }">
              <template v-if="readonly">{{ row.referenceNo || '-' }}</template>
              <el-input v-else v-model="row.referenceNo" />
            </template>
          </el-table-column>
          <el-table-column label="备注" width="180">
            <template #default="{ row }">
              <template v-if="readonly">{{ row.remark || '-' }}</template>
              <el-input v-else v-model="row.remark" />
            </template>
          </el-table-column>
              </el-table>
            </ErpTableViewportHScroll>
          </div>
        </div>
      </el-tab-pane>
      <el-tab-pane label="额外费用清单" name="fees">
        <div class="assist-fees-pane">
          <div v-if="!readonly" class="assist-fees-toolbar">
            <el-button size="small" @click="$emit('add-fee-row')">增行</el-button>
            <el-button size="small" @click="$emit('reset-fees')">重置</el-button>
          </div>
          <div class="assist-fees-table-wrap">
            <el-table
              ref="feesTableRef"
              :data="model.fees"
              border
              stripe
              class="assist-fees-table"
            >
          <el-table-column label="序号" width="64" align="center">
            <template #default="{ $index }">{{ $index + 1 }}</template>
          </el-table-column>
          <el-table-column label="费用编码及名称" min-width="280">
            <template #default="{ row }">
              <template v-if="readonly">{{ formatFeeLabel(row) || '-' }}</template>
              <el-select
                v-else
                v-model="row.feeCode"
                class="assist-fee-select"
                filterable
                remote
                clearable
                reserve-keyword
                placeholder="===请选择==="
                :remote-method="searchFeeOptions"
                :loading="feeOptionsLoading"
                @change="(code) => onFeeCodeChange(row, code)"
                @clear="onFeeCodeClear(row)"
              >
                <el-option
                  v-if="row.feeCode && !feeOptionExists(row.feeCode)"
                  :label="formatFeeLabel(row)"
                  :value="row.feeCode"
                />
                <el-option
                  v-for="opt in feeOptions"
                  :key="opt.feeCode"
                  :label="formatFeeLabel(opt)"
                  :value="opt.feeCode"
                />
              </el-select>
            </template>
          </el-table-column>
          <el-table-column label="费用" width="140">
            <template #default="{ row }">
              <template v-if="readonly">{{ formatErpMoneyDisplay(row.money) }}</template>
              <el-input v-else v-model="row.money" />
            </template>
          </el-table-column>
          <el-table-column label="税点(不含税填0)" width="150">
            <template #default="{ row }">
              <template v-if="readonly">{{ formatErpPriceDisplay(row.tax, { maxDecimals: 4 }) }}</template>
              <el-input v-else v-model="row.tax" />
            </template>
          </el-table-column>
          <el-table-column label="备注" min-width="180">
            <template #default="{ row }">
              <template v-if="readonly">{{ row.remark || '-' }}</template>
              <el-input v-else v-model="row.remark" />
            </template>
          </el-table-column>
            </el-table>
          </div>
        </div>
      </el-tab-pane>
    </el-tabs>
  </el-form>
</template>

<script setup>
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import axios from 'axios'
import { ElMessage } from 'element-plus'
import { refreshErpTableViewportHScroll } from '@/utils/erpTableViewportHScroll'
import { formatErpMoneyDisplay, formatErpPriceDisplay, formatErpQtyDisplay } from '@/utils/erpNumberDisplay'

const props = defineProps({
  model: { type: Object, required: true },
  rules: { type: Object, required: true },
  editTab: { type: String, required: true },
  footerHeight: { type: Number, default: 56 },
  supplierOptions: { type: Array, default: () => [] },
  supplierLoading: { type: Boolean, default: false },
  currencyOptions: { type: Array, default: () => [] },
  /** 查看模式：与编辑同布局，全程只读 */
  readonly: { type: Boolean, default: false },
})

const emit = defineEmits([
  'update:editTab',
  'assist-order-no-focus',
  'assist-order-no-blur',
  'assist-date-change',
  'fetch-supplier',
  'delete-selected-lines',
  'delete-all-lines',
  'open-batch-add',
  'toggle-line-mark',
  'view-line-pi-bom',
  'line-tax-excluded-change',
  'line-tax-included-change',
  'add-fee-row',
  'reset-fees',
])

const feeOptions = ref([])
const feeOptionsLoading = ref(false)
let feeSearchTimer = null

function formatFeeLabel(item) {
  const code = String(item?.feeCode ?? '').trim()
  const name = String(item?.feeName ?? '').trim()
  if (!code && !name) return ''
  if (!name) return code
  return `${code}, ${name}`
}

function feeOptionExists(feeCode) {
  const code = String(feeCode ?? '').trim()
  if (!code) return false
  return feeOptions.value.some((opt) => String(opt?.feeCode ?? '').trim() === code)
}

async function loadFeeOptions(keyword = '') {
  feeOptionsLoading.value = true
  try {
    const res = await axios.get('/api/assist-order/fee-options', {
      params: { keyword: String(keyword ?? '').trim() },
    })
    const body = res.data ?? {}
    if (body.code !== 200) throw new Error(body.msg || '读取费用失败')
    feeOptions.value = Array.isArray(body.data?.list) ? body.data.list : []
  } catch (err) {
    feeOptions.value = []
    ElMessage.error(err?.response?.data?.msg || err?.message || '读取费用失败')
  } finally {
    feeOptionsLoading.value = false
  }
}

function searchFeeOptions(keyword) {
  if (feeSearchTimer) clearTimeout(feeSearchTimer)
  feeSearchTimer = setTimeout(() => {
    loadFeeOptions(keyword)
  }, 200)
}

function onFeeCodeChange(row, code) {
  const nextCode = String(code ?? '').trim()
  if (!nextCode) {
    onFeeCodeClear(row)
    return
  }
  const matched = feeOptions.value.find((opt) => String(opt?.feeCode ?? '').trim() === nextCode)
  if (matched) {
    row.feeName = String(matched.feeName ?? '').trim()
  }
}

function onFeeCodeClear(row) {
  row.feeCode = ''
  row.feeName = ''
}

const assistLinesHScrollBottom = computed(() => {
  const h = Number(props.footerHeight)
  return Number.isFinite(h) && h > 0 ? h : 56
})
/** DIY：操作列宽，约两钮最小宽之和 + 间距 + 单元格留白（见 .assist-line-action-btn） */
const assistLineActionsColWidth = 118
const linesTableRef = ref(null)
const feesTableRef = ref(null)

async function refreshLinesTableLayout() {
  await nextTick()
  linesTableRef.value?.doLayout?.()
  const el = linesTableRef.value?.$el
  if (el) refreshErpTableViewportHScroll(el)
}

async function refreshFeesTableLayout() {
  await nextTick()
  feesTableRef.value?.doLayout?.()
}

watch(
  () => props.editTab,
  async (tab) => {
    await nextTick()
    if (tab === 'lines') refreshLinesTableLayout()
    if (tab === 'fees') {
      refreshFeesTableLayout()
      if (!feeOptions.value.length) loadFeeOptions('')
    }
  },
)

watch(
  () => props.footerHeight,
  () => {
    if (props.editTab === 'lines') refreshLinesTableLayout()
  },
)

watch(
  () => props.model.lines,
  () => {
    if (props.editTab === 'lines') refreshLinesTableLayout()
  },
  { deep: true },
)

onMounted(async () => {
  await nextTick()
  if (props.editTab === 'lines') refreshLinesTableLayout()
  if (props.editTab === 'fees') refreshFeesTableLayout()
})

function lineRowClassName({ row }) {
  return row?._lineMarked ? 'assist-line-row--marked' : ''
}

const formRef = ref(null)

const assistTypeOptions = [
  { label: '订单外协', value: '1' },
  { label: '订单外发', value: '2' },
  { label: '其他外协', value: '0' },
]

/** 与采购订单「采购类型」一致：点按钮切换；关联单号清理由下方 watch 处理 */
function chooseAssistType(value) {
  if (props.readonly) return
  props.model.assistType = value
}

/** 与采购订单「是否含税」一致：是=1 / 否=2 */
function chooseTaxIncluded(value) {
  if (props.readonly) return
  props.model.taxIncluded = value
}

const isOrderAssistType = computed(() => {
  const t = String(props.model.assistType ?? '')
  return t === '1' || t === '2'
})

const referenceNoPlaceholder = computed(() =>
  isOrderAssistType.value ? '请输入 PI 号' : '可空；可手填或搜索 PI',
)

watch(
  () => props.model.assistType,
  (now, prev) => {
    if (prev !== undefined && now !== prev) {
      props.model.referenceNo = ''
      props.model.referenceOrderId = null
    }
  },
)

function disableDeliveryBeforeAssist(date) {
  const assist = props.model.assistDate
  if (!assist) return false
  const min = new Date(assist)
  min.setHours(0, 0, 0, 0)
  const check = new Date(date)
  check.setHours(0, 0, 0, 0)
  return check.getTime() < min.getTime()
}

function onAssistDateChanged() {
  emit('assist-date-change')
  formRef.value?.validateField?.('deliveryDate')
}

function mapPiSuggestion(row) {
  return {
    id: row.id,
    piNo: row.piNo,
    value: row.piNo,
  }
}

async function fetchPiSuggestions(query, cb) {
  const keyword = String(query ?? '').trim()
  if (!keyword) {
    cb([])
    return
  }
  try {
    const res = await axios.get('/api/sales-order/pi-suggest', { params: { keyword } })
    const list = Array.isArray(res?.data?.data?.list) ? res.data.data.list : []
    cb(list.map(mapPiSuggestion))
  } catch {
    cb([])
  }
}

async function resolvePiRowByNo(piNo) {
  const keyword = String(piNo ?? '').trim()
  if (!keyword) return null
  try {
    const res = await axios.get('/api/sales-order/pi-suggest', { params: { keyword } })
    const list = Array.isArray(res?.data?.data?.list) ? res.data.data.list : []
    return list.find((row) => String(row.piNo ?? '').trim() === keyword) ?? null
  } catch {
    return null
  }
}

function onPickPi(row) {
  props.model.referenceNo = String(row?.piNo ?? '')
  const id = Number(row?.id ?? 0)
  props.model.referenceOrderId = Number.isFinite(id) && id > 0 ? id : null
  // 关联单号只带出 PI / 订单 id，交货日期由用户自行填写
}

async function onReferenceNoBlur() {
  const piNo = String(props.model.referenceNo ?? '').trim()
  if (!piNo) {
    props.model.referenceOrderId = null
    return
  }
  const row = await resolvePiRowByNo(piNo)
  if (row) {
    const id = Number(row.id ?? 0)
    props.model.referenceOrderId = Number.isFinite(id) && id > 0 ? id : null
  } else if (!isOrderAssistType.value) {
    props.model.referenceOrderId = null
  }
}

defineExpose({
  validate: () => formRef.value?.validate?.(),
  clearValidate: () => formRef.value?.clearValidate?.(),
  validateField: (field) => formRef.value?.validateField?.(field),
})
</script>

<style scoped>
.assist-edit-form {
  max-width: none;
  display: flex;
  flex-direction: column;
}

.assist-header-rows {
  display: flex;
  flex-direction: column;
  /* DIY：基础资料各输入框宽度 */
  --assist-field-width: 280px;
  --assist-textarea-width: 580px;
  --assist-field-width-sm: 120px;
  --assist-supplier-width: 400px;
  /* DIY：同一行表单项之间的水平间距 */
  --assist-row-gap: 2px;
  /* DIY：基础资料单行输入高度（对齐出库单）；不含外协类型/是否含税按钮 */
  --assist-base-input-height: var(--el-component-size);
  /* DIY：备注/打印注释多行高度（默认与单行同高，可自调） */
  --assist-remark-input-height: calc(var(--assist-base-input-height) * 1);
}

.assist-form-row {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  column-gap: var(--assist-row-gap);
  row-gap: 12px;
}

.assist-form-row--1 {
  flex-direction: column;
}

.assist-form-row :deep(.el-form-item__content) {
  justify-content: flex-start;
}

.assist-form-row :deep(.el-input),
.assist-form-row :deep(.el-select),
.assist-form-row :deep(.el-date-editor),
.assist-form-row :deep(.el-input-number),
.assist-form-row :deep(.el-autocomplete) {
  width: var(--assist-field-width);
  max-width: 100%;
}

.assist-form-row :deep(.assist-field-sm.el-input-number) {
  width: var(--assist-field-width-sm);
}

.assist-form-row :deep(.assist-field-supplier.el-select) {
  width: var(--assist-supplier-width);
}

.assist-form-row--1 :deep(.el-textarea) {
  width: var(--assist-textarea-width);
}
/* 只统一单行输入/下拉/日期/数字高度；不碰外协类型/是否含税按钮 */
.assist-header-rows :deep(.el-input__wrapper),
.assist-header-rows :deep(.el-select__wrapper),
.assist-header-rows :deep(.el-input-number .el-input__wrapper) {
  height: var(--assist-base-input-height);
  min-height: var(--assist-base-input-height);
  box-sizing: border-box;
}
.assist-header-rows :deep(.el-date-editor) {
  height: var(--assist-base-input-height);
}
.assist-header-rows :deep(.el-textarea__inner) {
  height: var(--assist-remark-input-height);
  min-height: var(--assist-remark-input-height);
  box-sizing: border-box;
}

/* DIY：外协类型/是否含税按钮 — 对齐采购订单 buy-basic-buttons（高 40、宽 106、字 16） */
.assist-basic-buttons {
  --assist-basic-button-width: 106px;
  --assist-basic-button-height: 40px;
  --assist-basic-button-font-size: 16px;
  display: inline-flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}

.assist-basic-buttons :deep(.el-button) {
  width: var(--assist-basic-button-width);
  min-width: var(--assist-basic-button-width);
  height: var(--assist-basic-button-height);
  margin-left: 0;
  padding-left: 0;
  padding-right: 0;
  font-size: var(--assist-basic-button-font-size);
}

.assist-edit-form :deep(.el-tabs__header) {
  flex-shrink: 0;
}

/* 基础资料/明细均随内容增高，不造内层滚动条（对齐入库单添加） */
.assist-header-scroll {
  padding-right: 4px;
  padding-bottom: 18px;
}

.assist-lines-pane {
  display: flex;
  flex-direction: column;
}

.assist-lines-toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 10px;
  flex-shrink: 0;
  /* DIY：外协订单明细工具栏按钮高度/字号；建议高度 36～48，字号 13～16 */
  --assist-line-toolbar-btn-height: 36px;
  --assist-line-toolbar-btn-font-size: 16px;
}
.assist-lines-toolbar :deep(.el-button) {
  height: var(--assist-line-toolbar-btn-height);
  min-height: var(--assist-line-toolbar-btn-height);
  font-size: var(--assist-line-toolbar-btn-font-size);
}

.assist-lines-table-wrap {
  width: 100%;
}

/* DIY：操作列两钮等宽 AssistOrderEditForm.vue .assist-line-action-btn */
.assist-line-action-btn {
  --assist-line-action-btn-min-width: 52px;
  min-width: var(--assist-line-action-btn-min-width);
  padding-left: 8px;
  padding-right: 8px;
}

:deep(.assist-lines-table td.erp-col-actions .cell) {
  padding-left: 4px;
  padding-right: 4px;
}

:deep(.assist-lines-table .assist-line-actions.erp-table-actions--grid) {
  column-gap: 2px;
}

/* DIY：删除/已选择按钮配色 AssistOrderEditForm.vue .assist-line-mark-btn */
.assist-line-mark-btn {
  background-color: #ff7800;
  border-color: #ff7800;
  color: #fff;
}

.assist-line-mark-btn:hover {
  background-color: #e56e00;
  border-color: #e56e00;
  color: #fff;
}

.assist-line-mark-btn--on {
  background-color: #ccc !important;
  border-color: #ccc !important;
  color: #333 !important;
}

.assist-line-mark-btn--on:hover {
  background-color: #bbb !important;
  border-color: #bbb !important;
  color: #333 !important;
}

:deep(.assist-line-row--marked) {
  --el-table-tr-bg-color: #f5f5f5;
}

.assist-line-qty-cell {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.assist-line-lock-tip {
  color: var(--el-color-warning-dark-2);
  font-size: 12px;
  line-height: 16px;
  white-space: nowrap;
}

.assist-fees-pane {
  display: flex;
  flex-direction: column;
}

.assist-fees-toolbar {
  display: flex;
  align-items: center;
  margin-bottom: 6px;
  flex-shrink: 0;
}

.assist-fees-table-wrap {
  width: 100%;
}

.assist-fee-select {
  width: 100%;
}

:deep(.assist-fees-table .assist-fee-select .el-select__wrapper) {
  width: 100%;
}

:deep(.assist-fees-table .el-table__body td .cell) {
  display: flex;
  align-items: center;
}
</style>
