<template>
  <ErpPageDialog
    v-model="open"
    :title="dialogTitle"
    dialog-class="bom-detail-dialog bom-linked-detail-dialog erp-detail-form-context"
    append-to-body
    :modal="stackModal"
    @closed="onClosed"
  >
    <el-skeleton :loading="bootLoading" animated :rows="6">
      <template #default>
        <el-alert v-if="bootError" :title="bootError" type="error" show-icon class="bom-detail-alert" />
        <template v-else-if="bomBasic">
          <el-tabs v-model="activeTab">
            <el-tab-pane label="基础资料" name="basic">
              <div v-loading="basicFullLoading" class="bom-detail-body erp-detail-form-surface">
                <BomDetailBasicReadonly :basic="bomBasic" />
              </div>
            </el-tab-pane>
            <el-tab-pane label="配件明细" name="parts">
              <el-alert
                v-if="!bomSystemcode"
                type="warning"
                show-icon
                :closable="false"
                class="bom-parts-alert"
                title="主档缺少 systemcode，无法加载配件明细。"
              />
              <div v-else class="bom-parts-toolbar">
                <el-button type="primary" :disabled="partsReadOnly || !bomSystemcode" @click="materialSelectorVisible = true">
                  添加配件
                </el-button>
                <el-button :disabled="partsReadOnly || !bomSystemcode || partsLoading" @click="onRefreshParts">
                  刷新
                </el-button>
                <el-button
                  type="success"
                  :disabled="partsReadOnly || !bomSystemcode || partsLoading"
                  @click="saveParts"
                >
                  保存配件明细
                </el-button>
              </div>
              <el-alert v-if="partsError" :title="partsError" type="error" show-icon class="bom-parts-alert" />
              <div class="bom-parts-table-wrap">
                <el-table
                  v-loading="partsLoading"
                  :data="partsList"
                  border
                  stripe
                  :size="detailTableSize"
                  class="bom-parts-table"
                  :empty-text="partsLoading ? '加载中…' : '暂无配件'"
                  :row-key="partsRowKey"
                  max-height="calc(100vh - 320px)"
                >
                  <el-table-column type="index" label="序号" width="56" align="center" fixed="left" :index="partsRowIndex" />
                  <el-table-column label="操作" width="168" align="center" fixed="left">
                    <template #default="{ row }">
                      <ErpTableActions>
                        <el-button
                          type="info"
                          plain
                          class="bom-part-view-action-btn"
                          :disabled="!String(row.kcaa01 ?? '').trim()"
                          @click="openChildFromPartRow(row)"
                        >
                          查看
                        </el-button>
                        <el-button type="danger" plain :disabled="partLineReadonly(row)" @click="removePartRow(row)">
                          删除
                        </el-button>
                      </ErpTableActions>
                    </template>
                  </el-table-column>
                  <el-table-column prop="kcaa01" label="编码" min-width="120" fixed="left" show-overflow-tooltip />
                  <el-table-column prop="kcaa02" label="名称" min-width="108" show-overflow-tooltip />
                  <el-table-column prop="kcaa03" label="规格" min-width="92" show-overflow-tooltip />
                  <el-table-column prop="kcaa11" label="颜色" width="80" show-overflow-tooltip />
                  <el-table-column prop="kcaa04" label="单位" width="64" show-overflow-tooltip />
                  <el-table-column label="单位用量" width="118">
                    <template #default="{ row }">
                      <el-input-number
                        v-model="row.kcac04"
                        :disabled="partLineReadonly(row)"
                        :min="0"
                        :precision="6"
                        :step="0.000001"
                        :controls="false"
                        class="bom-parts-num"
                        @change="
                          () => {
                            syncPartKcac06(row)
                            markPartsDirty()
                          }
                        "
                      />
                    </template>
                  </el-table-column>
                  <el-table-column label="损耗率(%)" width="108">
                    <template #default="{ row }">
                      <el-input-number
                        :model-value="lossPctDisplay(row)"
                        :disabled="partLineReadonly(row)"
                        :min="0"
                        :precision="2"
                        :step="0.1"
                        :controls="false"
                        class="bom-parts-num"
                        @update:model-value="(v) => onLossPctChange(row, v)"
                      />
                    </template>
                  </el-table-column>
                  <el-table-column label="用量合计(kcac06)" width="124" align="right">
                    <template #default="{ row }">{{ formatUsageTotal(row) }}</template>
                  </el-table-column>
                  <el-table-column label="单价" width="112">
                    <template #default="{ row }">
                      <el-input-number
                        v-model="row.cost_price"
                        :disabled="partLineReadonly(row)"
                        :min="0"
                        :precision="4"
                        :step="0.0001"
                        :controls="false"
                        class="bom-parts-num"
                        @change="markPartsDirty"
                      />
                    </template>
                  </el-table-column>
                  <el-table-column label="成本合计" width="110" align="right">
                    <template #default="{ row }">{{ formatMoney(partCostSum(row)) }}</template>
                  </el-table-column>
                  <el-table-column label="备注" min-width="140">
                    <template #default="{ row }">
                      <el-input
                        v-model="row.remark"
                        :disabled="partLineReadonly(row)"
                        maxlength="500"
                        show-word-limit
                        @input="markPartsDirty"
                      />
                    </template>
                  </el-table-column>
                </el-table>
              </div>
              <div class="bom-parts-sum-row">
                <span>实际用量总和：<strong>{{ formatQtySumFooter(partsSumActualUsage) }}</strong></span>
                <span class="bom-parts-sum-gap">总成本：<strong>{{ formatMoney(partsSumCost) }}</strong></span>
              </div>
              <MaterialSelector v-model="materialSelectorVisible" @picked="onMaterialPicked" />
            </el-tab-pane>
          </el-tabs>
        </template>
      </template>
    </el-skeleton>
  </ErpPageDialog>
</template>

<script setup>
import { computed, ref, watch } from 'vue'
import axios from 'axios'
import { ElMessage, ElMessageBox } from 'element-plus'
import ErpPageDialog from '@/components/erp/ErpPageDialog.vue'
import BomDetailBasicReadonly from './BomDetailBasicReadonly.vue'
import MaterialSelector from '../../supply-chain/daily/purchase-quote/MaterialSelector.vue'
import { useUiDensity } from '@/composables/useUiDensity'

defineOptions({ inheritAttrs: false })

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  /** 本层要查看的配件行（由父组件栈传入） */
  partRow: { type: Object, default: null },
  /** 仅最顶层显示灰色遮罩，避免多层叠黑 */
  stackModal: { type: Boolean, default: true },
})

const emit = defineEmits(['update:modelValue', 'closed', 'view-child', 'saved'])

const { detailTableSize } = useUiDensity()

const open = computed({
  get: () => props.modelValue,
  set: (v) => emit('update:modelValue', v),
})

const bootLoading = ref(false)
const bootError = ref('')
const titleCode = ref('')
const bomBasic = ref(null)
const activeTab = ref('parts')
const basicFullLoading = ref(false)

const partsList = ref([])
const partsLoading = ref(false)
const partsError = ref('')
const partsPendingDeleteIds = ref([])
const partsSessionDirty = ref(false)
const lastPartsLoadedSystemcode = ref('')
const partsRequestSeq = ref(0)
const materialSelectorVisible = ref(false)

const dialogTitle = computed(() => {
  const c = String(titleCode.value ?? bomBasic.value?.kcaa01 ?? '').trim()
  return c ? `子件 BOM - ${c}` : '子件 BOM'
})

const bomSystemcode = computed(() => String(bomBasic.value?.systemcode ?? '').trim())

const partsReadOnly = computed(() => rowIsAudited(bomBasic.value))

const partsSumActualUsage = computed(() => {
  let s = 0
  for (const row of partsList.value || []) s += partUsageSum(row)
  return s
})

const partsSumCost = computed(() => {
  let s = 0
  for (const row of partsList.value || []) s += partCostSum(row)
  return s
})

function dVal(v) {
  const s = String(v ?? '').trim()
  return s || '—'
}

function rowIsAudited(rowOrBasic) {
  return String(rowOrBasic?.pass ?? '').trim() === '1'
}

function mapBomBasicFromBrief(brief) {
  const b = brief && typeof brief === 'object' ? brief : {}
  return {
    systemcode: String(b?.systemcode ?? '').trim(),
    pass: String(b?.pass ?? '').trim(),
    kcaa01: String(b?.kcaa01 ?? '').trim(),
    kcaa02: String(b?.kcaa02 ?? '').trim(),
    kcaa03: String(b?.kcaa03 ?? '').trim(),
    _briefOnly: true,
  }
}

function bomPartDelLooksActive(delVal) {
  const s = String(delVal ?? '').trim().toLowerCase()
  if (!s) return true
  if (s === '0') return true
  const n = Number(s.replace(/^'+|'+$/g, ''))
  return Number.isFinite(n) && n === 0
}

function partLineReadonly(row) {
  return partsReadOnly.value || !bomPartDelLooksActive(row?.del)
}

function partsRowKey(row) {
  if (row?.id != null && Number(row.id) > 0) return `id-${row.id}`
  return String(row?._localKey ?? '')
}

function partsRowIndex(i) {
  return i + 1
}

function bomRound6(n) {
  const x = Number(n)
  if (!Number.isFinite(x)) return 0
  return Math.round(x * 1e6) / 1e6
}

function partUsageSum(row) {
  const q = Number(row?.kcac04)
  const loss = Number(row?.kcac05)
  const qq = Number.isFinite(q) ? q : 0
  const ll = Number.isFinite(loss) ? loss : 0
  return qq * (1 + ll)
}

function syncPartKcac06(row) {
  if (!row) return
  row.kcac06 = bomRound6(partUsageSum(row))
}

function formatUsageTotal(row) {
  return bomRound6(partUsageSum(row)).toFixed(6)
}

function partCostSum(row) {
  const p = Number(row?.cost_price)
  const price = Number.isFinite(p) ? p : 0
  return bomRound6(partUsageSum(row)) * price
}

function formatQtySumFooter(n) {
  return bomRound6(n).toFixed(6)
}

function formatMoney(n) {
  const x = Number(n)
  if (!Number.isFinite(x)) return '0.00'
  return x.toFixed(2)
}

function lossPctDisplay(row) {
  const v = Number(row?.kcac05)
  const d = Number.isFinite(v) ? v : 0
  return d * 100
}

function onLossPctChange(row, pctVal) {
  const p = Number(pctVal)
  row.kcac05 = Number.isFinite(p) ? p / 100 : 0
  syncPartKcac06(row)
  markPartsDirty()
}

function markPartsDirty() {
  partsSessionDirty.value = true
}

function isPartsDirty() {
  if (partsSessionDirty.value) return true
  if ((partsPendingDeleteIds.value ?? []).length > 0) return true
  return (partsList.value ?? []).some((r) => {
    const id = Number(r?.id)
    return !Number.isFinite(id) || id <= 0
  })
}

function genLocalKey() {
  return `tmp-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

function resetPartsSession() {
  lastPartsLoadedSystemcode.value = ''
  partsSessionDirty.value = false
  partsRequestSeq.value += 1
}

async function fetchBriefByKcaa01(code) {
  const res = await axios.get(`/api/inventory/bom/${encodeURIComponent(code)}/brief`)
  const body = res.data
  if (body?.code !== 200) throw new Error(body?.msg || '加载失败')
  return body?.data?.basic ?? null
}

async function ensureBasicFull() {
  if (!bomBasic.value?._briefOnly) return
  const code = String(bomBasic.value?.kcaa01 ?? '').trim()
  if (!code) return
  basicFullLoading.value = true
  try {
    const res = await axios.get(`/api/inventory/bom/${encodeURIComponent(code)}`)
    const body = res.data
    if (body?.code !== 200) {
      bootError.value = body?.msg || '加载失败'
      return
    }
    const basic = body?.data?.basic ?? null
    if (basic) {
      bomBasic.value = { ...basic, _briefOnly: false }
    }
  } catch (e) {
    bootError.value = String(e?.response?.data?.msg ?? e?.message ?? '网络错误')
  } finally {
    basicFullLoading.value = false
  }
}

async function loadParts(opts = {}) {
  const force = !!opts?.force
  const sc = bomSystemcode.value
  if (!sc) {
    partsError.value = '主档缺少 systemcode，无法加载配件明细。'
    partsList.value = []
    lastPartsLoadedSystemcode.value = ''
    return
  }
  if (!force && lastPartsLoadedSystemcode.value === sc) return

  const reqId = ++partsRequestSeq.value
  partsLoading.value = true
  partsError.value = ''
  try {
    const res = await axios.get(`/api/inventory/bom/parts/${encodeURIComponent(sc)}`)
    const body = res.data
    if (partsRequestSeq.value !== reqId) return
    if (body?.code !== 200) {
      partsError.value = body?.msg || '加载失败'
      partsList.value = []
      lastPartsLoadedSystemcode.value = ''
      return
    }
    const list = Array.isArray(body?.data?.list) ? body.data.list : []
    partsPendingDeleteIds.value = []
    partsSessionDirty.value = false
    partsList.value = list.map((r) => {
      const row = { ...r, _localKey: genLocalKey() }
      syncPartKcac06(row)
      return row
    })
    lastPartsLoadedSystemcode.value = sc
  } catch (e) {
    if (partsRequestSeq.value !== reqId) return
    partsError.value = String(e?.response?.data?.msg ?? e?.message ?? '网络错误')
    partsList.value = []
    lastPartsLoadedSystemcode.value = ''
  } finally {
    if (partsRequestSeq.value === reqId) partsLoading.value = false
  }
}

async function bootstrapFromPartRow(partRow) {
  const code = String(partRow?.kcaa01 ?? '').trim()
  if (!code) {
    bootError.value = '配件行无编码'
    return
  }
  const curCode = String(bomBasic.value?.kcaa01 ?? '').trim()
  if (curCode && curCode === code) {
    ElMessage.warning('已在当前子件 BOM')
    return
  }

  bootLoading.value = true
  bootError.value = ''
  activeTab.value = 'parts'
  try {
    const childSc = String(partRow?.childSystemcode ?? '').trim()
    let brief = null
    if (childSc) {
      brief = {
        systemcode: childSc,
        pass: partRow?.childPass,
        kcaa01: code,
        kcaa02: partRow?.kcaa02,
        kcaa03: partRow?.kcaa03,
      }
    } else {
      brief = await fetchBriefByKcaa01(code)
    }
    if (!String(brief?.systemcode ?? '').trim()) {
      bootError.value = '未找到该编码对应的 BOM 或缺少 systemcode'
      ElMessage.error(bootError.value)
      return
    }
    titleCode.value = code
    bomBasic.value = mapBomBasicFromBrief(brief)
    resetPartsSession()
    await loadParts({ force: true })
  } catch (e) {
    const msg = String(e?.response?.data?.msg ?? e?.message ?? '网络错误')
    bootError.value = msg
    ElMessage.error(msg)
  } finally {
    bootLoading.value = false
  }
}

/** 配件行「查看」：通知父组件再叠一层大弹窗 */
async function openChildFromPartRow(partRow) {
  const code = String(partRow?.kcaa01 ?? '').trim()
  if (!code) {
    ElMessage.warning('配件行无编码')
    return
  }
  const curCode = String(bomBasic.value?.kcaa01 ?? '').trim()
  if (curCode && curCode === code) {
    ElMessage.warning('已在当前子件 BOM')
    return
  }
  if (isPartsDirty()) {
    try {
      await ElMessageBox.confirm('当前有未保存的配件修改，打开下一层将丢弃本层未保存内容。', '确认查看', {
        type: 'warning',
        confirmButtonText: '继续',
        cancelButtonText: '取消',
      })
    } catch {
      return
    }
  }
  emit('view-child', partRow)
}

async function onRefreshParts() {
  if (isPartsDirty()) {
    try {
      await ElMessageBox.confirm('当前有未保存的修改，刷新将丢弃本地修改。', '确认刷新', {
        type: 'warning',
        confirmButtonText: '仍要刷新',
        cancelButtonText: '取消',
      })
    } catch {
      return
    }
  }
  await loadParts({ force: true })
}

async function removePartRow(row) {
  if (!bomPartDelLooksActive(row?.del)) {
    ElMessage.warning('该行已删除标记，不可移除')
    return
  }
  if (partsReadOnly.value) return
  try {
    await ElMessageBox.confirm('确认从明细中移除该行吗？已保存行需点「保存配件明细」后生效。', '删除确认', {
      type: 'warning',
      confirmButtonText: '确定',
      cancelButtonText: '取消',
    })
  } catch {
    return
  }
  const id = row?.id != null && Number(row.id) > 0 ? Number(row.id) : null
  if (id && !partsPendingDeleteIds.value.includes(id)) partsPendingDeleteIds.value.push(id)
  const idx = partsList.value.indexOf(row)
  if (idx >= 0) partsList.value.splice(idx, 1)
  markPartsDirty()
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
    cost_price: 0,
    remark: '',
  }
  syncPartKcac06(row)
  partsList.value.push(row)
  markPartsDirty()
}

async function saveParts() {
  const sc = bomSystemcode.value
  if (!sc) {
    ElMessage.warning('主档缺少 systemcode，无法保存')
    return
  }
  if (partsReadOnly.value) {
    ElMessage.warning('已审核的 BOM 不可修改配件')
    return
  }
  try {
    const activeRows = (partsList.value ?? []).filter((r) => bomPartDelLooksActive(r?.del))
    const kept = activeRows.map((r, idx) => {
      syncPartKcac06(r)
      return {
        id: r.id != null && Number(r.id) > 0 ? Number(r.id) : undefined,
        pendingDelete: false,
        kcac01: sc,
        kcaa01: String(r.kcaa01 ?? '').trim(),
        kcaa02: r.kcaa02,
        kcaa03: r.kcaa03,
        kcaa04: r.kcaa04,
        kcaa11: r.kcaa11,
        kcac04: r.kcac04,
        kcac05: r.kcac05,
        kcac06: r.kcac06,
        cost_price: r.cost_price,
        remark: r.remark,
        seq: idx + 1,
      }
    })
    const dels = (partsPendingDeleteIds.value ?? []).map((pid) => ({
      id: Number(pid),
      pendingDelete: true,
      kcac01: sc,
      kcaa01: '',
    }))
    const lines = [...kept, ...dels]
    if (!lines.length) {
      ElMessage.warning('没有需要保存的变更')
      return
    }
    const res = await axios.put(`/api/inventory/bom/parts/${encodeURIComponent(sc)}`, { lines })
    const body = res.data
    if (body?.code !== 200) {
      ElMessage.error(body?.msg || '保存失败')
      return
    }
    ElMessage.success('配件明细已保存')
    partsPendingDeleteIds.value = []
    if (bomBasic.value) bomBasic.value = { ...bomBasic.value, pass: '0' }
    emit('saved')
    await loadParts({ force: true })
  } catch (e) {
    ElMessage.error(String(e?.response?.data?.msg ?? e?.message ?? '保存失败'))
  }
}

function onClosed() {
  bootError.value = ''
  bomBasic.value = null
  titleCode.value = ''
  activeTab.value = 'parts'
  partsList.value = []
  partsPendingDeleteIds.value = []
  partsError.value = ''
  resetPartsSession()
  emit('closed')
}

watch(
  () => [open.value, activeTab.value],
  ([vis, tab]) => {
    if (!vis || tab !== 'basic') return
    void ensureBasicFull()
  },
)

watch(
  () => [open.value, activeTab.value, bomSystemcode.value],
  ([vis, tab, sc]) => {
    if (!vis || !String(sc ?? '').trim() || tab !== 'parts') return
    void loadParts()
  },
)

/** 打开本层时按 partRow 加载子件 BOM（每层独立实例，不覆盖其它层） */
watch(
  () => [open.value, props.partRow],
  ([vis, row]) => {
    if (!vis || !row || typeof row !== 'object') return
    const code = String(row?.kcaa01 ?? '').trim()
    const loaded = String(bomBasic.value?.kcaa01 ?? '').trim()
    if (code && loaded === code) return
    void bootstrapFromPartRow(row)
  },
  { immediate: true },
)
</script>

