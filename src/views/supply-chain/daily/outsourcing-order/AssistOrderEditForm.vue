<template>
  <el-form ref="formRef" :model="model" :rules="rules" label-width="110px" class="assist-edit-form">
    <el-tabs :model-value="editTab" @update:model-value="$emit('update:editTab', $event)">
      <el-tab-pane label="外协订单基础资料" name="header">
        <div class="assist-header-rows">
          <div class="assist-form-row assist-form-row--1">
            <el-form-item label="外协单号" prop="assistOrderNo">
              <el-input v-model="model.assistOrderNo" placeholder="系统建议，可手动修改" />
            </el-form-item>
          </div>
          <div class="assist-form-row assist-form-row--2">
            <el-form-item label="外协日期" prop="assistDate">
              <el-date-picker
                v-model="model.assistDate"
                type="date"
                value-format="YYYY-MM-DD"
                placeholder="请选择外协日期"
                @change="onAssistDateChanged"
              />
            </el-form-item>
            <el-form-item label="交货日期" prop="deliveryDate">
              <el-date-picker
                v-model="model.deliveryDate"
                type="date"
                value-format="YYYY-MM-DD"
                placeholder="请选择交货日期"
                :disabled-date="disableDeliveryBeforeAssist"
              />
            </el-form-item>
          </div>
          <div class="assist-form-row assist-form-row--2">
            <el-form-item label="外协类型" prop="assistType">
              <div class="assist-type-btns" role="radiogroup" aria-label="外协类型">
                <button
                  v-for="opt in assistTypeOptions"
                  :key="opt.value"
                  type="button"
                  class="assist-type-btn"
                  :class="{ 'is-active': model.assistType === opt.value }"
                  @click="model.assistType = opt.value"
                >
                  {{ opt.label }}
                </button>
              </div>
            </el-form-item>
            <el-form-item label="关联单号" prop="referenceNo">
              <el-autocomplete
                v-if="isOrderAssistType"
                v-model="model.referenceNo"
                :fetch-suggestions="fetchPiSuggestions"
                value-key="piNo"
                clearable
                placeholder="请输入 PI 号"
                @select="onPickPi"
                @blur="onReferenceNoBlur"
              />
              <el-input
                v-else
                v-model="model.referenceNo"
                clearable
                placeholder="可空或手动输入"
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
              <el-select v-model="model.taxIncluded">
                <el-option label="含税" value="1" />
                <el-option label="不含税" value="2" />
              </el-select>
            </el-form-item>
            <el-form-item label="币别" prop="currencyCode">
              <el-select v-model="model.currencyCode" filterable placeholder="请选择币别">
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
              />
            </el-form-item>
          </div>
          <div class="assist-form-row assist-form-row--1">
            <el-form-item label="备注">
              <el-input v-model="model.remark" type="textarea" :rows="3" />
            </el-form-item>
          </div>
          <div class="assist-form-row assist-form-row--1">
            <el-form-item label="打印注释">
              <el-input v-model="model.notes" type="textarea" :rows="3" />
            </el-form-item>
          </div>
        </div>
      </el-tab-pane>
      <el-tab-pane label="外协订单明细" name="lines">
        <div class="assist-lines-toolbar">
          <el-button type="primary" @click="$emit('open-material-selector')">选材</el-button>
          <el-button @click="$emit('add-blank-line')">新增空行</el-button>
        </div>
        <el-table :data="model.lines" border stripe height="360" empty-text="暂无明细">
          <el-table-column label="操作" width="72" fixed="left">
            <template #default="{ $index }">
              <el-button type="danger" link size="small" @click="$emit('remove-line', $index)">删除</el-button>
            </template>
          </el-table-column>
          <el-table-column label="序号" width="64">
            <template #default="{ $index }">{{ $index + 1 }}</template>
          </el-table-column>
          <el-table-column label="PI号" prop="piNo" min-width="120" show-overflow-tooltip />
          <el-table-column label="物料编码" prop="kcaa01" min-width="150" show-overflow-tooltip />
          <el-table-column label="中文名" prop="kcaa02" min-width="160" show-overflow-tooltip />
          <el-table-column label="规格" prop="kcaa03" min-width="140" show-overflow-tooltip />
          <el-table-column label="单位" prop="kcaa04" width="90" />
          <el-table-column label="数量" width="126">
            <template #default="{ row }">
              <el-input-number
                v-model="row.wxak03"
                :precision="2"
                :min="0"
                controls-position="right"
                @change="$emit('line-tax-excluded-change', row)"
              />
            </template>
          </el-table-column>
          <el-table-column label="不含税单价" width="138">
            <template #default="{ row }">
              <el-input-number
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
              <el-input-number
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
              <el-input-number
                v-model="row.wxak041"
                :precision="model.decimalPlaces"
                :min="0"
                controls-position="right"
                @change="$emit('line-tax-included-change', row)"
              />
            </template>
          </el-table-column>
          <el-table-column label="不含税金额" prop="wxak05" width="116" align="right" />
          <el-table-column label="含税金额" prop="wxak051" width="116" align="right" />
          <el-table-column label="交货日期" width="150">
            <template #default="{ row }">
              <el-date-picker v-model="row.deliveryDate" type="date" value-format="YYYY-MM-DD" />
            </template>
          </el-table-column>
          <el-table-column label="参考单号" width="150">
            <template #default="{ row }">
              <el-input v-model="row.referenceNo" />
            </template>
          </el-table-column>
          <el-table-column label="备注" width="180">
            <template #default="{ row }">
              <el-input v-model="row.remark" />
            </template>
          </el-table-column>
        </el-table>
      </el-tab-pane>
      <el-tab-pane label="额外费用清单" name="fees">
        <div class="assist-lines-toolbar">
          <el-button type="primary" @click="$emit('open-fee-selector')">选择费用</el-button>
          <el-button @click="$emit('add-blank-fee')">新增空行</el-button>
        </div>
        <el-table :data="model.fees" border stripe height="340" empty-text="暂无额外费用">
          <el-table-column label="操作" width="72" fixed="left">
            <template #default="{ $index }">
              <el-button type="danger" link size="small" @click="$emit('remove-fee', $index)">删除</el-button>
            </template>
          </el-table-column>
          <el-table-column label="序号" width="64">
            <template #default="{ $index }">{{ $index + 1 }}</template>
          </el-table-column>
          <el-table-column label="费用编码及名称" min-width="240">
            <template #default="{ row }">
              <el-input v-model="row.feeCode" placeholder="费用编码" />
              <el-input v-model="row.feeName" placeholder="费用名称" class="assist-inline-input" />
            </template>
          </el-table-column>
          <el-table-column label="费用" width="140">
            <template #default="{ row }">
              <el-input-number v-model="row.money" :precision="2" :min="0" controls-position="right" />
            </template>
          </el-table-column>
          <el-table-column label="税点" width="120">
            <template #default="{ row }">
              <el-input-number v-model="row.tax" :precision="6" :min="0" controls-position="right" />
            </template>
          </el-table-column>
          <el-table-column label="备注" min-width="180">
            <template #default="{ row }">
              <el-input v-model="row.remark" />
            </template>
          </el-table-column>
        </el-table>
      </el-tab-pane>
    </el-tabs>
  </el-form>
</template>

<script setup>
import { computed, ref, watch } from 'vue'
import axios from 'axios'
import { ElMessage } from 'element-plus'

const props = defineProps({
  model: { type: Object, required: true },
  rules: { type: Object, required: true },
  editTab: { type: String, required: true },
  supplierOptions: { type: Array, default: () => [] },
  supplierLoading: { type: Boolean, default: false },
  currencyOptions: { type: Array, default: () => [] },
})

const emit = defineEmits([
  'update:editTab',
  'assist-date-change',
  'fetch-supplier',
  'open-material-selector',
  'add-blank-line',
  'remove-line',
  'line-tax-excluded-change',
  'line-tax-included-change',
  'open-fee-selector',
  'add-blank-fee',
  'remove-fee',
])

const formRef = ref(null)

const assistTypeOptions = [
  { label: '订单外协', value: '1' },
  { label: '订单外发', value: '2' },
  { label: '其他外协', value: '0' },
]

const isOrderAssistType = computed(() => {
  const t = String(props.model.assistType ?? '')
  return t === '1' || t === '2'
})

watch(
  () => props.model.assistType,
  (now, prev) => {
    if (prev !== undefined && now !== prev) {
      props.model.referenceNo = ''
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

function dateForInput(value) {
  if (!value) return ''
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) {
    const s = String(value).slice(0, 10)
    return s || ''
  }
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function applyDeliveryFromPiRow(row) {
  const d = dateForInput(row?.deliveryDate)
  if (!d) return
  const assist = props.model.assistDate
  if (assist && new Date(d) < new Date(assist)) {
    ElMessage.warning('PI 交货日期早于外协日期，未自动填入')
    return
  }
  props.model.deliveryDate = d
}

function mapPiSuggestion(row) {
  return {
    id: row.id,
    piNo: row.piNo,
    deliveryDate: row.deliveryDate ?? null,
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
  applyDeliveryFromPiRow(row)
}

async function onReferenceNoBlur() {
  if (!isOrderAssistType.value) return
  const piNo = String(props.model.referenceNo ?? '').trim()
  if (!piNo) return
  const row = await resolvePiRowByNo(piNo)
  if (row) applyDeliveryFromPiRow(row)
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
  --assist-row-gap: 16px;
}

.assist-form-row {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  column-gap: var(--assist-row-gap);
  row-gap: 8px;
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

.assist-type-btns {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.assist-type-btn {
  /* DIY：外协类型按钮尺寸与颜色 */
  --assist-type-btn-min-height: 36px;
  --assist-type-btn-min-width: 96px;
  --assist-type-btn-active-bg: #ff7800;
  min-height: var(--assist-type-btn-min-height);
  min-width: var(--assist-type-btn-min-width);
  padding: 0 14px;
  border: 1px solid var(--el-border-color);
  border-radius: 4px;
  background: #fff;
  color: var(--el-text-color-primary);
  font-size: inherit;
  line-height: 1.4;
  cursor: pointer;
}

.assist-type-btn.is-active {
  background: var(--assist-type-btn-active-bg);
  border-color: var(--assist-type-btn-active-bg);
  color: #fff;
}

.assist-lines-toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 10px;
}

.assist-inline-input {
  margin-top: 6px;
}
</style>
