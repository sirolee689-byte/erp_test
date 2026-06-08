<template>
  <div class="pi-bom-editor-panel" :class="{ 'pi-bom-editor-panel--standalone': standalone }">
    <el-alert v-if="loadError" :title="loadError" type="error" show-icon class="error-alert" />
    <div class="pi-bom-editor-body" :class="{ 'pi-bom-editor-body--warming': warming }">
    <el-skeleton :loading="loading" animated :rows="10">
      <template #default>
        <el-tabs v-model="activeTab" class="pi-bom-editor-tabs" @tab-change="onEditorTabChange">
          <el-tab-pane label="基础资料" name="basic">
            <el-form
              v-if="basicForm"
              class="erp-detail-form pi-bom-basic-form"
              label-position="right"
              label-width="112px"
              size="default"
            >
              <div class="pi-bom-section-title">系统</div>
              <el-row :gutter="12">
                <el-col :xs="24" :sm="8">
                  <el-form-item label="PI号">
                    <el-input :model-value="dVal(basicForm.piNo)" readonly />
                  </el-form-item>
                </el-col>
                <el-col :xs="24" :sm="16">
                  <el-form-item label="系统编码">
                    <el-input :model-value="dVal(basicForm.systemcode)" readonly />
                  </el-form-item>
                </el-col>
              </el-row>

              <div class="pi-bom-section-title">基本资料</div>
              <el-row :gutter="12">
                <el-col :xs="24" :sm="8">
                  <el-form-item label="编码">
                    <el-input :model-value="dVal(basicForm.kcaa01)" readonly />
                  </el-form-item>
                </el-col>
                <el-col :xs="24" :sm="16">
                  <el-form-item label="名称" required>
                    <el-input v-model="basicForm.kcaa02" :readonly="!basicEditable" maxlength="500" />
                  </el-form-item>
                </el-col>
                <el-col :xs="24" :sm="12">
                  <el-form-item label="英文名称">
                    <el-input v-model="basicForm.kcaa02_en" :readonly="!basicEditable" maxlength="500" />
                  </el-form-item>
                </el-col>
                <el-col :xs="24" :sm="12">
                  <el-form-item label="规格">
                    <el-input v-model="basicForm.kcaa03" :readonly="!basicEditable" maxlength="500" />
                  </el-form-item>
                </el-col>
                <el-col :xs="24" :sm="12">
                  <el-form-item label="分类" required>
                    <el-input v-model="basicForm.kcaa05" :readonly="!basicEditable" maxlength="200" />
                  </el-form-item>
                </el-col>
                <el-col :xs="24" :sm="12">
                  <el-form-item label="颜色">
                    <el-input v-model="basicForm.kcaa11" :readonly="!basicEditable" maxlength="200" />
                  </el-form-item>
                </el-col>
                <el-col :xs="24" :sm="12">
                  <el-form-item label="客户款号">
                    <el-input v-model="basicForm.kcaa06" :readonly="!basicEditable" maxlength="300" />
                  </el-form-item>
                </el-col>
                <el-col :xs="24" :sm="12">
                  <el-form-item label="工厂款号">
                    <el-input v-model="basicForm.kcaa09" :readonly="!basicEditable" maxlength="300" />
                  </el-form-item>
                </el-col>
                <el-col :xs="24" :sm="12">
                  <el-form-item label="组别">
                    <el-input v-model="basicForm.kcaa10" :readonly="!basicEditable" maxlength="200" />
                  </el-form-item>
                </el-col>
                <el-col :xs="24" :sm="12">
                  <el-form-item label="产地">
                    <el-select v-if="basicEditable" v-model="basicForm.location" placeholder="请选择" style="width: 100%">
                      <el-option label="国内" value="国内" />
                      <el-option label="进口" value="进口" />
                    </el-select>
                    <el-input v-else :model-value="dVal(basicForm.location)" readonly />
                  </el-form-item>
                </el-col>
              </el-row>

              <div class="pi-bom-section-title">单位与损耗</div>
              <el-row :gutter="12">
                <el-col :xs="24" :sm="8">
                  <el-form-item label="使用单位" required>
                    <el-input v-model="basicForm.kcaa04" :readonly="!basicEditable" maxlength="100" />
                  </el-form-item>
                </el-col>
                <el-col :xs="24" :sm="8">
                  <el-form-item label="采购单位" required>
                    <el-input v-model="basicForm.kcaa25" :readonly="!basicEditable" maxlength="100" />
                  </el-form-item>
                </el-col>
                <el-col :xs="24" :sm="8">
                  <el-form-item label="转换率">
                    <el-input v-model="basicForm.kcaa26" :readonly="!basicEditable" />
                  </el-form-item>
                </el-col>
                <el-col :xs="24" :sm="12">
                  <el-form-item label="报价损耗">
                    <el-input v-model="basicForm.kcaa32" :readonly="!basicEditable" />
                  </el-form-item>
                </el-col>
                <el-col :xs="24" :sm="12">
                  <el-form-item label="物料损耗">
                    <el-input v-model="basicForm.kcaa33" :readonly="!basicEditable" />
                  </el-form-item>
                </el-col>
              </el-row>

              <div class="pi-bom-section-title">价格与其它</div>
              <el-row :gutter="12">
                <el-col :xs="24" :sm="12">
                  <el-form-item label="BOM价格">
                    <el-input v-model="basicForm.sale_price" :readonly="!basicEditable" />
                  </el-form-item>
                </el-col>
                <el-col :xs="24" :sm="12">
                  <el-form-item label="采购价格">
                    <el-input v-model="basicForm.cost_price" :readonly="!basicEditable" />
                  </el-form-item>
                </el-col>
                <el-col :xs="24" :sm="12">
                  <el-form-item label="币别(报价)">
                    <el-input v-model="basicForm.kcaa34" :readonly="!basicEditable" maxlength="80" />
                  </el-form-item>
                </el-col>
                <el-col :xs="24" :sm="12">
                  <el-form-item label="币别(采购)">
                    <el-input v-model="basicForm.kcaa35" :readonly="!basicEditable" maxlength="80" />
                  </el-form-item>
                </el-col>
                <el-col :span="24">
                  <el-form-item label="备注">
                    <el-input
                      v-model="basicForm.remark"
                      type="textarea"
                      :rows="3"
                      :readonly="!basicEditable"
                      maxlength="2000"
                    />
                  </el-form-item>
                </el-col>
              </el-row>
            </el-form>
            <el-empty v-else description="暂无PI-BOM基础资料" />
          </el-tab-pane>

          <el-tab-pane label="配件明细" name="parts">
            <div class="pi-bom-tab-toolbar pi-bom-parts-toolbar">
              <el-button type="primary" :disabled="loading || partsLoading || partsSaving || !partsParentSystemcode" @click="openMaterialSelector">
                添加配件
              </el-button>
              <el-button :disabled="loading || partsLoading || partsSaving" @click="refreshParts">
                刷新
              </el-button>
              <el-button
                type="success"
                :loading="partsSaving"
                :disabled="loading || partsLoading || partsSaving || !partsParentSystemcode"
                @click="saveParts"
              >
                保存配件明细
              </el-button>
              <span class="pi-bom-parts-path">{{ partsPathText }}</span>
            </div>
            <el-alert v-if="partsError" :title="partsError" type="error" show-icon class="pi-bom-parts-alert" />
            <div class="pi-bom-parts-table-wrap">
              <el-table
                ref="partsTableRef"
                :data="partsList"
                v-loading="loading || partsLoading"
                border
                stripe
                :row-key="partRowKey"
                class="pi-bom-parts-table"
                :max-height="partsTableMaxHeight"
                :empty-text="loading || partsLoading ? '加载中...' : '暂无配件明细'"
              >
                <el-table-column type="index" label="序号" width="58" align="center" fixed="left" />
                <el-table-column label="操作" width="180" align="center">
                  <template #default="{ row }">
                    <ErpTableActions>
                      <el-button
                        tag="a"
                        :href="partsEditChildHref(row)"
                        target="_blank"
                        rel="noopener"
                        type="primary"
                        plain
                        size="small"
                        class="pi-bom-part-child-link"
                        :disabled="!canOpenPartChild(row)"
                        @click="guardPartChildLink($event, row)"
                      >
                        编辑配件
                      </el-button>
                      <el-button type="danger" plain size="small" @click="removePartRow(row)">删除</el-button>
                    </ErpTableActions>
                  </template>
                </el-table-column>
                <el-table-column label="编码" min-width="220" show-overflow-tooltip>
                  <template #default="{ row }">
                    <span class="pi-bom-parts-code">{{ dVal(row.kcaa01) }}</span>
                  </template>
                </el-table-column>
                <el-table-column label="名称" prop="kcaa02" min-width="180" show-overflow-tooltip />
                <el-table-column label="规格" prop="kcaa03" min-width="150" show-overflow-tooltip />
                <el-table-column label="颜色" prop="kcaa11" width="90" show-overflow-tooltip />
                <el-table-column label="单位" prop="kcaa04" width="80" align="center" show-overflow-tooltip />
                <el-table-column label="单位用量" width="112" align="right">
                  <template #default="{ row }">
                    <el-input-number
                      v-if="partEditable(row)"
                      v-model="row.kcac04"
                      :min="0"
                      :step="0.000001"
                      :controls="false"
                      class="pi-bom-parts-num"
                      @change="() => onPartQtyChange(row)"
                    />
                    <span v-else>{{ formatNumber(row.kcac04) }}</span>
                  </template>
                </el-table-column>
                <el-table-column label="损耗率(%)" width="108" align="right">
                  <template #default="{ row }">
                    <el-input-number
                      v-if="partEditable(row)"
                      :model-value="lossPctDisplay(row)"
                      :min="0"
                      :step="0.1"
                      :controls="false"
                      class="pi-bom-parts-num"
                      @update:model-value="(v) => onPartLossPctChange(row, v)"
                    />
                    <span v-else>{{ formatLossPct(row.kcac05) }}</span>
                  </template>
                </el-table-column>
                <el-table-column label="用量合计(kcac06)" width="124" align="right">
                  <template #default="{ row }">{{ formatNumber(row.kcac06) }}</template>
                </el-table-column>
                <el-table-column label="单价" width="112" align="right">
                  <template #default="{ row }">
                    <el-input-number
                      v-if="partEditable(row)"
                      v-model="row.cost_price"
                      :min="0"
                      :step="0.0001"
                      :controls="false"
                      class="pi-bom-parts-num"
                      @change="markPartsDirty"
                    />
                    <span v-else>{{ formatMoney(row.cost_price) }}</span>
                  </template>
                </el-table-column>
                <el-table-column label="成本合计" width="110" align="right">
                  <template #default="{ row }">{{ formatMoney(partCostSum(row)) }}</template>
                </el-table-column>
                <el-table-column label="备注" min-width="180" show-overflow-tooltip>
                  <template #default="{ row }">
                    <el-input v-if="partEditable(row)" v-model="row.Describe" maxlength="500" @input="markPartsDirty" />
                    <span v-else>{{ dVal(row.Describe) }}</span>
                  </template>
                </el-table-column>
              </el-table>
            </div>
          </el-tab-pane>
        </el-tabs>
      </template>
    </el-skeleton>
    </div>

    <div v-if="!loading && !warming" class="pi-bom-editor-footer">
      <el-button v-if="activeTab === 'basic' && basicEditable" type="primary" :loading="basicSaving" @click="saveBasic">
        保存主档
      </el-button>
      <el-button v-if="activeTab === 'parts'" type="success" :loading="partsSaving" @click="saveParts">
        保存配件明细
      </el-button>
      <el-button v-if="standalone" @click="closeStandaloneWindow">关闭</el-button>
    </div>

    <MaterialSelector v-model="materialSelectorVisible" @picked="onMaterialPicked" />
  </div>
</template>

<script setup>
import { computed, nextTick, ref, watch } from 'vue'
import axios from 'axios'
import { ElMessage, ElMessageBox } from 'element-plus'
import ErpTableActions from '@/components/erp/ErpTableActions.vue'
import MaterialSelector from '../../../supply-chain/daily/purchase-quote/MaterialSelector.vue'

const props = defineProps({
  orderId: { type: Number, required: true },
  productKcaa01: { type: String, required: true },
  /** edit=成品主档可编辑；parts-edit=下层配件维护（基础资料只读） */
  windowMode: { type: String, default: 'edit' },
  /** 配件明细当前层父级 systemcode */
  parentSystemcode: { type: String, default: '' },
  standalone: { type: Boolean, default: false },
})

const emit = defineEmits(['saved-basic', 'saved-parts'])

const loading = ref(false)
const warming = ref(false)
const loadError = ref('')
const activeTab = ref('basic')
let partsLayoutRaf = 0
const basicForm = ref(null)
const basicSaving = ref(false)
const partsList = ref([])
const partsLoading = ref(false)
const partsSaving = ref(false)
const partsError = ref('')
const partsPendingDeleteIds = ref([])
const partsDirty = ref(false)
const materialSelectorVisible = ref(false)
const partsTableRef = ref(null)
const partsParentStack = ref([])

const basicEditable = computed(() => props.windowMode === 'edit')
const partsParentSystemcode = computed(() => {
  const stack = partsParentStack.value ?? []
  return String(stack[stack.length - 1]?.parentSystemcode ?? '').trim()
})
const partsTableMaxHeight = computed(() => (props.standalone ? 'calc(100vh - 260px)' : 'calc(84vh - 300px)'))
const partsPathText = computed(() => {
  const stack = partsParentStack.value ?? []
  if (!stack.length) return ''
  return stack.map((item) => String(item?.title ?? '').trim()).filter(Boolean).join(' / ')
})

function dVal(v) {
  const s = String(v ?? '').trim()
  return s || '-'
}

function formatNumber(v) {
  const n = Number(v)
  if (!Number.isFinite(n)) return '-'
  return n.toFixed(4).replace(/\.?0+$/, '')
}

function formatMoney(v) {
  const n = Number(v)
  if (!Number.isFinite(n)) return '-'
  return n.toFixed(4).replace(/\.?0+$/, '')
}

function formatLossPct(v) {
  const n = Number(v)
  if (!Number.isFinite(n)) return '-'
  return (n * 100).toFixed(2).replace(/\.?0+$/, '')
}

function bomRound6(v) {
  const n = Number(v)
  if (!Number.isFinite(n)) return 0
  return Math.round(n * 1000000) / 1000000
}

function partUsageSum(row) {
  const qty = Number(row?.kcac04 ?? 0)
  const loss = Number(row?.kcac05 ?? 0)
  return (Number.isFinite(qty) ? qty : 0) * (1 + (Number.isFinite(loss) ? loss : 0))
}

function syncPartKcac06(row) {
  if (!row) return
  row.kcac06 = bomRound6(partUsageSum(row))
}

function genLocalKey() {
  return `tmp-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

function partRowKey(row) {
  const id = Number(row?.id)
  return Number.isFinite(id) && id > 0 ? `id-${id}` : row?._localKey || genLocalKey()
}

function partCostSum(row) {
  const qty = Number(row?.kcac06)
  const price = Number(row?.cost_price)
  if (!Number.isFinite(qty) || !Number.isFinite(price)) return 0
  return qty * price
}

function markPartsDirty() {
  partsDirty.value = true
}

function resetPartsEditState() {
  partsPendingDeleteIds.value = []
  partsDirty.value = false
  partsError.value = ''
}

function partEditable(row) {
  return !!row
}

function canOpenPartChild(row) {
  return Number(row?.id) > 0 && !!String(row?.systemcode ?? row?.kcac02 ?? '').trim()
}

function lossPctDisplay(row) {
  const n = Number(row?.kcac05)
  return Number.isFinite(n) ? bomRound6(n * 100) : 0
}

function onPartQtyChange(row) {
  syncPartKcac06(row)
  markPartsDirty()
}

function onPartLossPctChange(row, pctVal) {
  const p = Number(pctVal)
  row.kcac05 = Number.isFinite(p) ? bomRound6(p / 100) : 0
  syncPartKcac06(row)
  markPartsDirty()
}

function prepareParts(list) {
  return (Array.isArray(list) ? list : []).map((row, idx) => {
    const item = { ...row, _localKey: row?._localKey || genLocalKey() }
    if (item.Seq == null || item.Seq === '') item.Seq = idx + 1
    syncPartKcac06(item)
    return item
  })
}

function schedulePartsTableLayout() {
  if (partsLayoutRaf) cancelAnimationFrame(partsLayoutRaf)
  partsLayoutRaf = requestAnimationFrame(() => {
    partsLayoutRaf = 0
    partsTableRef.value?.doLayout?.()
  })
}

function onEditorTabChange(tabName) {
  if (tabName === 'parts') schedulePartsTableLayout()
}

async function warmupEditorTabs() {
  if (!basicForm.value) return
  const preferred = activeTab.value
  const other = preferred === 'parts' ? 'basic' : 'parts'
  activeTab.value = other
  await nextTick()
  if (other === 'parts') schedulePartsTableLayout()
  activeTab.value = preferred
  await nextTick()
  if (preferred === 'parts') schedulePartsTableLayout()
}

function replaceParts(list) {
  partsList.value = prepareParts(list)
  resetPartsEditState()
  nextTick(() => schedulePartsTableLayout())
}

function cloneBasic(raw) {
  if (!raw) return null
  return {
    ...raw,
    kcaa26: raw.kcaa26 != null ? String(raw.kcaa26) : '',
    kcaa32: raw.kcaa32 != null ? String(raw.kcaa32) : '',
    kcaa33: raw.kcaa33 != null ? String(raw.kcaa33) : '',
    sale_price: raw.sale_price != null ? String(raw.sale_price) : '',
    cost_price: raw.cost_price != null ? String(raw.cost_price) : '',
  }
}

function buildPiBomStandaloneUrl(mode, parentSc) {
  const url = new URL(window.location.href)
  url.pathname = '/inventory/basic/pi-bom-data-window'
  url.search = ''
  url.hash = ''
  url.searchParams.set('mode', mode)
  url.searchParams.set('orderId', String(props.orderId))
  url.searchParams.set('kcaa01', String(props.productKcaa01 ?? '').trim())
  url.searchParams.set('parentSystemcode', String(parentSc ?? '').trim())
  return url.toString()
}

function partsEditChildHref(row) {
  const parentSc = String(row?.systemcode ?? row?.kcac02 ?? '').trim()
  return parentSc ? buildPiBomStandaloneUrl('parts-edit', parentSc) : ''
}

function guardPartChildLink(ev, row) {
  if (!canOpenPartChild(row)) {
    ev?.preventDefault?.()
    ElMessage.warning('当前行无法下钻编辑配件')
  }
}

function closeStandaloneWindow() {
  window.close()
}

async function ensureDiscardPartChanges(actionName = '切换') {
  if (!partsDirty.value && !(partsPendingDeleteIds.value ?? []).length) return true
  try {
    await ElMessageBox.confirm(
      `当前配件明细有未保存修改，${actionName}会丢弃这些修改。`,
      '未保存的配件明细',
      { type: 'warning', confirmButtonText: '继续', cancelButtonText: '取消' },
    )
    return true
  } catch {
    return false
  }
}

async function loadPartsForParent(parentSystemcode) {
  const parent = String(parentSystemcode ?? '').trim()
  if (!parent) {
    partsError.value = '缺少父级 systemcode，无法加载配件明细'
    partsList.value = []
    return
  }
  partsLoading.value = true
  partsError.value = ''
  try {
    const res = await axios.get('/api/inventory/pi-bom-data/parts', {
      params: {
        orderId: props.orderId,
        kcaa01: props.productKcaa01,
        parentSystemcode: parent,
      },
    })
    const body = res.data
    if (body?.code !== 200) {
      partsError.value = body?.msg || '加载配件明细失败'
      partsList.value = []
      return
    }
    replaceParts(body?.data?.parts ?? [])
  } catch (e) {
    partsError.value = String(e?.response?.data?.msg ?? e?.message ?? '加载配件明细失败')
    partsList.value = []
  } finally {
    partsLoading.value = false
  }
}

async function refreshParts() {
  if (!(await ensureDiscardPartChanges('刷新'))) return
  await loadPartsForParent(partsParentSystemcode.value)
}

function openMaterialSelector() {
  materialSelectorVisible.value = true
}

function nextPartSeq() {
  let max = 0
  for (const row of partsList.value ?? []) {
    const n = Number(row?.Seq ?? row?.seq)
    if (Number.isFinite(n) && n > max) max = n
  }
  return max + 1
}

function onMaterialPicked(payload) {
  const kcaa01 = String(payload?.kcaa01 ?? '').trim()
  if (!kcaa01) return
  const row = {
    _localKey: genLocalKey(),
    id: null,
    kcaa01,
    kcaa02: String(payload?.kcaa02 ?? '').trim(),
    kcaa03: String(payload?.kcaa03 ?? '').trim(),
    kcaa04: String(payload?.kcaa05 ?? payload?.kcaa04 ?? '').trim(),
    kcaa11: String(payload?.kcaa11 ?? '').trim(),
    kcac04: 1,
    kcac05: 0,
    kcac06: 1,
    cost_price: Number(payload?.cost_price ?? payload?.kcaa33 ?? 0) || 0,
    Describe: '',
    Seq: nextPartSeq(),
  }
  syncPartKcac06(row)
  partsList.value = [...partsList.value, row]
  markPartsDirty()
}

async function removePartRow(row) {
  if (!row) return
  try {
    const childText = Number(row.id) > 0 ? '保存后会同时物理删除这行下面的所有子编码。' : '这行还没有保存，只会从页面移除。'
    await ElMessageBox.confirm(`确定删除配件 ${dVal(row.kcaa01)}？${childText}`, '删除配件明细', {
      type: 'warning',
      confirmButtonText: '确定',
      cancelButtonText: '取消',
    })
  } catch {
    return
  }
  const id = Number(row.id)
  if (Number.isFinite(id) && id > 0 && !partsPendingDeleteIds.value.includes(id)) {
    partsPendingDeleteIds.value = [...partsPendingDeleteIds.value, id]
  }
  const key = partRowKey(row)
  partsList.value = partsList.value.filter((item) => partRowKey(item) !== key)
  markPartsDirty()
}

async function saveBasic() {
  const form = basicForm.value
  if (!form || !basicEditable.value) return
  const kcaa02 = String(form.kcaa02 ?? '').trim()
  const kcaa05 = String(form.kcaa05 ?? '').trim()
  const kcaa04 = String(form.kcaa04 ?? '').trim()
  const kcaa25 = String(form.kcaa25 ?? '').trim()
  const systemcode = String(form.systemcode ?? '').trim()
  if (!kcaa02) {
    ElMessage.warning('请填写名称')
    return
  }
  if (!kcaa05 || !kcaa04 || !kcaa25) {
    ElMessage.warning('请填写分类、使用单位与采购单位')
    return
  }
  if (!systemcode) {
    ElMessage.warning('缺少 systemcode，无法保存主档')
    return
  }
  basicSaving.value = true
  try {
    const res = await axios.put('/api/inventory/pi-bom-data/basic', {
      orderId: props.orderId,
      kcaa01: props.productKcaa01,
      systemcode,
      kcaa02,
      kcaa02_en: form.kcaa02_en,
      kcaa03: form.kcaa03,
      kcaa05,
      kcaa06: form.kcaa06,
      kcaa09: form.kcaa09,
      kcaa10: form.kcaa10,
      kcaa11: form.kcaa11,
      location: form.location,
      kcaa04,
      kcaa25,
      kcaa26: form.kcaa26,
      kcaa32: form.kcaa32,
      kcaa33: form.kcaa33,
      sale_price: form.sale_price,
      cost_price: form.cost_price,
      kcaa34: form.kcaa34,
      kcaa35: form.kcaa35,
      remark: form.remark,
    })
    const body = res.data
    if (body?.code !== 200) {
      ElMessage.error(body?.msg || '保存失败')
      return
    }
    basicForm.value = cloneBasic(body?.data?.basic ?? form)
    ElMessage.success('PI-BOM 主档已保存，订单已标为未运算')
    emit('saved-basic', body?.data)
  } catch (e) {
    ElMessage.error(String(e?.response?.data?.msg ?? e?.message ?? '保存失败'))
  } finally {
    basicSaving.value = false
  }
}

async function saveParts() {
  const parentSystemcode = partsParentSystemcode.value
  if (!parentSystemcode) {
    ElMessage.warning('缺少父级 systemcode，无法保存')
    return
  }
  if (partsSaving.value) return
  const activeRows = (partsList.value ?? []).filter((row) => String(row?.kcaa01 ?? '').trim())
  for (const row of activeRows) {
    syncPartKcac06(row)
    const seq = Number(row?.Seq ?? row?.seq)
    if (!Number.isFinite(seq) || seq <= 0) row.Seq = nextPartSeq()
  }
  const lines = activeRows.map((row, idx) => ({
    id: Number(row.id) > 0 ? Number(row.id) : null,
    kcaa01: String(row.kcaa01 ?? '').trim(),
    kcaa02: String(row.kcaa02 ?? '').trim(),
    kcaa03: String(row.kcaa03 ?? '').trim(),
    kcaa04: String(row.kcaa04 ?? '').trim(),
    kcaa11: String(row.kcaa11 ?? '').trim(),
    kcac04: Number(row.kcac04 ?? 0) || 0,
    kcac05: Number(row.kcac05 ?? 0) || 0,
    kcac06: Number(row.kcac06 ?? 0) || 0,
    cost_price: Number(row.cost_price ?? 0) || 0,
    Describe: String(row.Describe ?? '').trim(),
    Seq: Number(row.Seq ?? idx + 1) || idx + 1,
  }))
  for (const id of partsPendingDeleteIds.value ?? []) {
    lines.push({ id, pendingDelete: true })
  }
  if (!lines.length) {
    ElMessage.warning('没有需要保存的配件明细')
    return
  }
  partsSaving.value = true
  partsError.value = ''
  try {
    const res = await axios.put('/api/inventory/pi-bom-data/parts', {
      orderId: props.orderId,
      kcaa01: props.productKcaa01,
      parentSystemcode,
      lines,
    })
    const body = res.data
    if (body?.code !== 200) {
      ElMessage.error(body?.msg || '保存失败')
      return
    }
    replaceParts(body?.data?.parts ?? [])
    ElMessage.success('配件明细已保存，订单已标为未运算')
    emit('saved-parts', body?.data)
  } catch (e) {
    ElMessage.error(String(e?.response?.data?.msg ?? e?.message ?? '保存失败'))
  } finally {
    partsSaving.value = false
  }
}

async function loadEditorData() {
  loading.value = true
  warming.value = false
  loadError.value = ''
  basicForm.value = null
  partsList.value = []
  partsParentStack.value = []
  resetPartsEditState()
  try {
    if (props.windowMode === 'parts-edit') {
      const parentSc = String(props.parentSystemcode ?? '').trim()
      const res = await axios.get('/api/inventory/pi-bom-data/node-basic', {
        params: {
          orderId: props.orderId,
          kcaa01: props.productKcaa01,
          nodeSystemcode: parentSc,
        },
      })
      const body = res.data
      if (body?.code !== 200) {
        loadError.value = body?.msg || '加载节点资料失败'
        return
      }
      basicForm.value = cloneBasic(body?.data?.basic ?? null)
      const title = String(basicForm.value?.kcaa01 ?? '').trim() || '下级'
      partsParentStack.value = [{ title, parentSystemcode: parentSc }]
      activeTab.value = 'parts'
      await loadPartsForParent(parentSc)
      return
    }

    const res = await axios.get('/api/inventory/pi-bom-data/detail', {
      params: { orderId: props.orderId, kcaa01: props.productKcaa01 },
    })
    const body = res.data
    if (body?.code !== 200) {
      loadError.value = body?.msg || '加载PI-BOM详情失败'
      return
    }
    const data = body.data ?? {}
    basicForm.value = cloneBasic(data.basic ?? null)
    const parentSc = String(basicForm.value?.systemcode ?? '').trim()
    const code = String(basicForm.value?.kcaa01 ?? props.productKcaa01).trim()
    if (parentSc) {
      partsParentStack.value = [{ title: code || '成品', parentSystemcode: parentSc }]
      await loadPartsForParent(parentSc)
    }
  } catch (e) {
    loadError.value = String(e?.response?.data?.msg ?? e?.message ?? '加载失败')
  } finally {
    loading.value = false
    warming.value = true
    await nextTick()
    await warmupEditorTabs()
    warming.value = false
  }
}

watch(
  () => [props.orderId, props.productKcaa01, props.windowMode, props.parentSystemcode],
  () => {
    void loadEditorData()
  },
  { immediate: true },
)
</script>

<style scoped>
.pi-bom-editor-panel {
  min-height: 360px;
}

.pi-bom-editor-body--warming {
  visibility: hidden;
  pointer-events: none;
}

.pi-bom-editor-panel--standalone {
  min-height: calc(100vh - 48px);
  padding: 12px 16px 72px;
  box-sizing: border-box;
}

.pi-bom-editor-tabs {
  min-height: 420px;
}

.pi-bom-basic-form {
  max-height: calc(84vh - 280px);
  overflow: auto;
  padding-right: 8px;
}

.pi-bom-editor-panel--standalone .pi-bom-basic-form {
  max-height: calc(100vh - 220px);
}

.pi-bom-section-title {
  margin: 12px 0 10px;
  padding-left: 8px;
  border-left: 3px solid var(--el-color-primary);
  font-weight: 600;
}

.pi-bom-tab-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
  margin-bottom: 10px;
}

.pi-bom-parts-path {
  color: var(--el-text-color-regular);
  line-height: 32px;
}

.pi-bom-parts-alert,
.error-alert {
  margin-bottom: 10px;
}

.pi-bom-parts-table-wrap {
  width: 100%;
  overflow-x: auto;
}

.pi-bom-parts-table {
  min-width: 1280px;
}

.pi-bom-parts-num {
  width: 100%;
}

.pi-bom-editor-footer {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid var(--el-border-color-lighter);
}

.pi-bom-part-child-link {
  text-decoration: none;
}
</style>
