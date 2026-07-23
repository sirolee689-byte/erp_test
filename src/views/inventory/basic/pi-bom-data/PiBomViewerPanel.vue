<template>
  <div class="pi-bom-viewer-panel" :class="{ 'pi-bom-viewer-panel--standalone': standalone }">
    <el-alert v-if="loadError" :title="loadError" type="error" show-icon class="error-alert" />
    <el-skeleton :loading="loading" animated :rows="10">
      <template #default>
        <el-tabs v-model="activeTab" class="pi-bom-detail-tabs">
          <el-tab-pane label="基础资料" name="basic">
            <div v-if="detailBasicForm" class="pi-bom-basic-form erp-detail-form-surface">
              <!-- 与 BOM「查看详情」同组件同排版（BomBasicForm readonly），表单内不显 PI号 -->
              <BomBasicForm
                :form="detailBasicForm"
                readonly
                :currency-dropdown-options="detailCurrencyDropdownOptions"
                :fetch-material-suggest="noopEmptySuggest"
                :fetch-color-suggest="noopEmptySuggest"
                :fetch-unit-suggest="noopEmptySuggest"
                :fetch-supplier-suggest="noopEmptySuggest"
                :fetch-workshop-suggest="noopEmptySuggest"
                :on-pick-material="noopBomBasicPicker"
                :on-pick-color="noopBomBasicPicker"
                :on-pick-unit-use="noopBomBasicPicker"
                :on-pick-unit-po="noopBomBasicPicker"
                :on-pick-unit-qt="noopBomBasicPicker"
                :on-pick-supplier="noopBomBasicPicker"
                :on-pick-workshop="noopBomBasicPicker"
                :on-numeric-input="noopBomBasicPicker"
                :on-kcaa01-keydown="noopBomBasicPicker"
                :on-kcaa01-paste="noopBomBasicPicker"
                :on-kcaa01-blur="noopBomBasicPicker"
              />
            </div>
            <el-empty v-else description="暂无PI-BOM基础资料" />
          </el-tab-pane>

          <el-tab-pane label="配件明细" name="parts" lazy>
            <div class="pi-bom-tab-toolbar pi-bom-parts-toolbar">
              <el-button v-if="partsParentStack.length > 1" :disabled="partsLoading" @click="backPiBomPartLevel">
                返回上级
              </el-button>
              <span class="pi-bom-parts-path">{{ partsPathText }}</span>
            </div>
            <el-alert v-if="partsError" :title="partsError" type="error" show-icon class="pi-bom-parts-alert" />
            <ErpTableViewportHScroll>
              <el-table
                ref="partsTableRef"
                :data="parts"
                v-loading="loading || partsLoading"
                border
                stripe
                :row-key="partRowKey"
                class="erp-list-table pi-bom-detail-table"
                :max-height="tableMaxHeight"
                :empty-text="loading || partsLoading ? '加载中...' : '暂无配件明细'"
              >
                <el-table-column type="index" label="序号" width="58" align="center" fixed="left" />
                <el-table-column label="操作" width="96" align="center" fixed="left">
                  <template #default="{ row }">
                    <ErpTableActions>
                      <el-button
                        type="primary"
                        plain
                        size="small"
                        :disabled="!canOpenPiBomPartChild(row)"
                        @click="openPiBomPartChild(row)"
                      >
                        查看
                      </el-button>
                    </ErpTableActions>
                  </template>
                </el-table-column>
                <el-table-column label="编码" min-width="200" fixed="left" show-overflow-tooltip>
                  <template #default="{ row }">
                    <span class="pi-bom-parts-code" :style="piBomPartsCodeCellStyle(row)">
                      {{ dVal(row.kcaa01) }}
                    </span>
                  </template>
                </el-table-column>
                <el-table-column label="名称" prop="kcaa02" min-width="180" show-overflow-tooltip />
                <el-table-column label="规格" prop="kcaa03" min-width="150" show-overflow-tooltip />
                <el-table-column label="颜色" prop="kcaa11" width="90" show-overflow-tooltip />
                <el-table-column label="单位" prop="kcaa04" width="80" align="center" show-overflow-tooltip />
                <el-table-column label="单位用量" width="112" align="right">
                  <template #default="{ row }">{{ formatNumber(row.kcac04) }}</template>
                </el-table-column>
                <el-table-column label="损耗率(%)" width="108" align="right">
                  <template #default="{ row }">{{ formatLossPct(row.kcac05) }}</template>
                </el-table-column>
                <el-table-column label="用量合计(kcac06)" width="124" align="right">
                  <template #default="{ row }">{{ formatNumber(row.kcac06) }}</template>
                </el-table-column>
                <el-table-column label="单价" width="112" align="right">
                  <template #default="{ row }">{{ formatMoney(row.cost_price) }}</template>
                </el-table-column>
                <el-table-column label="成本合计" width="110" align="right">
                  <template #default="{ row }">{{ formatMoney(partCostSum(row)) }}</template>
                </el-table-column>
                <el-table-column label="备注" prop="Describe" min-width="180" show-overflow-tooltip />
              </el-table>
            </ErpTableViewportHScroll>
          </el-tab-pane>

          <el-tab-pane label="PI_BOM树形" name="tree" lazy>
            <div class="pi-bom-tab-toolbar">
              <el-button :disabled="!tree.length" @click="expandAllTree">展开全部</el-button>
              <el-button :disabled="!tree.length" @click="collapseAllTree">关闭全部</el-button>
              <span class="pi-bom-tree-toolbar-hint">
                提示：点三角或编码，可手动展开/收起该行；展开时打开该支下全部层级
              </span>
            </div>
            <!-- 对齐 BOM用量表/PI追溯：原生 table + ▶/▼，用 Set 压可见行 -->
            <div class="pi-bom-native-tree-wrap" :style="{ maxHeight: tableMaxHeight }">
              <table v-if="tree.length" class="pi-bom-native-tree-table">
                <thead>
                  <tr>
                    <th class="pi-bom-th-code">编码</th>
                    <th>名称</th>
                    <th>规格</th>
                    <th class="pi-bom-th-center">单位</th>
                    <th class="pi-bom-th-num">用量</th>
                    <th class="pi-bom-th-num">损耗</th>
                    <th class="pi-bom-th-num">合计</th>
                    <th>备注</th>
                    <th class="pi-bom-th-center">Seq</th>
                    <th class="pi-bom-th-center">层级</th>
                  </tr>
                </thead>
                <tbody>
                  <tr
                    v-for="row in treeVisibleRows"
                    :key="row.id"
                    :class="{
                      'is-selected': treeSelectedId === row.id,
                      'is-top': row.depth === 0,
                    }"
                    @click="treeSelectedId = row.id"
                  >
                    <td class="pi-bom-td-code">
                      <div class="pi-bom-td-code-inner">
                        <span
                          class="pi-bom-tree-indent"
                          :style="{ width: `${row.depth * PI_BOM_TREE_INDENT_PX}px` }"
                        />
                        <button
                          type="button"
                          class="pi-bom-tree-caret"
                          :class="{ 'pi-bom-tree-caret--leaf': !row.hasKids }"
                          :disabled="!row.hasKids"
                          :title="row.hasKids ? (row.expanded ? '收起' : '展开') : undefined"
                          @click.stop="onTreeRowToggle(row)"
                        >
                          <template v-if="row.hasKids">{{ row.expanded ? '▼' : '▶' }}</template>
                        </button>
                        <span
                          class="pi-bom-tree-code"
                          :class="{ 'pi-bom-tree-code--branch': row.hasKids }"
                          :title="row.kcaa01"
                          @click.stop="onTreeCodeClick(row)"
                        >{{ row.kcaa01 }}</span>
                      </div>
                    </td>
                    <td :title="row.kcaa02">{{ row.kcaa02 }}</td>
                    <td :title="row.kcaa03">{{ row.kcaa03 }}</td>
                    <td class="pi-bom-td-center">{{ row.kcaa04 }}</td>
                    <td class="pi-bom-td-num">{{ formatNumber(row.kcac04) }}</td>
                    <td class="pi-bom-td-num">{{ formatNumber(row.kcac05) }}</td>
                    <td class="pi-bom-td-num">{{ formatNumber(row.kcac06) }}</td>
                    <td :title="row.Describe">{{ row.Describe }}</td>
                    <td class="pi-bom-td-center">{{ row.Seq }}</td>
                    <td class="pi-bom-td-center">{{ row.level }}</td>
                  </tr>
                </tbody>
              </table>
              <el-empty
                v-else
                :description="loading ? '加载中...' : '暂无PI-BOM树形数据'"
                :image-size="72"
              />
            </div>
          </el-tab-pane>

          <el-tab-pane label="成本BOM用量表" name="cost" lazy>
            <div class="pi-bom-cost-header">{{ costUsageHeaderText }}</div>
            <ErpTableViewportHScroll>
              <el-table
                ref="costTableRef"
                :data="costUsageRows"
                border
                stripe
                show-summary
                :summary-method="costUsageSummaryMethod"
                row-key="__rowKey"
                class="erp-list-table pi-bom-cost-table"
                :max-height="tableMaxHeight"
                :empty-text="loading ? '加载中...' : '暂无成本BOM用量，可能尚未运算'"
              >
                <el-table-column label="编码" prop="kcaa01" min-width="200" fixed="left" show-overflow-tooltip />
                <el-table-column label="名称" prop="kcaa02" min-width="170" show-overflow-tooltip />
                <el-table-column label="规格" prop="kcaa03" min-width="150" show-overflow-tooltip />
                <el-table-column label="单位" prop="kcaa04" width="80" align="center" show-overflow-tooltip />
                <el-table-column label="备注" prop="Describe" min-width="140" show-overflow-tooltip />
                <el-table-column label="用量" prop="yl" width="112" align="right">
                  <template #default="{ row }">{{ formatNumber(row.yl) }}</template>
                </el-table-column>
                <el-table-column label="损耗" prop="loss_rate" width="100" align="right">
                  <template #default="{ row }">{{ formatNumber(row.loss_rate) }}</template>
                </el-table-column>
                <el-table-column label="合计" prop="total_qty" width="112" align="right">
                  <template #default="{ row }">{{ formatNumber(row.total_qty) }}</template>
                </el-table-column>
              </el-table>
            </ErpTableViewportHScroll>
          </el-tab-pane>
        </el-tabs>
      </template>
    </el-skeleton>
  </div>
</template>

<script setup>
import { computed, nextTick, ref, watch } from 'vue'
import axios from 'axios'
import ErpTableActions from '@/components/erp/ErpTableActions.vue'
import ErpTableViewportHScroll from '@/components/erp/ErpTableViewportHScroll.vue'
import BomBasicForm from '@/views/inv/bom/BomBasicForm.vue'
import { aggregateBomCostUsageFlatForDisplay } from '@/utils/bomCostUsageAggregate.js'

const props = defineProps({
  orderId: { type: Number, required: true },
  productKcaa01: { type: String, required: true },
  /** 列表/URL 的 PI 号；详情以接口 basic.piNo 为准，用于独立窗标题回填 */
  piNo: { type: String, default: '' },
  standalone: { type: Boolean, default: false },
})

const emit = defineEmits(['meta'])

const loading = ref(false)
const loadError = ref('')
const activeTab = ref('basic')
const basic = ref(null)
const parts = ref([])
const tree = ref([])
const costRows = ref([])
const costUsageRows = ref([])
const partsLoading = ref(false)
const partsError = ref('')
const partsParentStack = ref([])
const partsTableRef = ref(null)
const costTableRef = ref(null)
/** 已展开节点 id（对齐 BOM用量表：原生表 + Set，不用 el-table 树） */
const treeExpandedIds = ref(new Set())
const treeSelectedId = ref(null)
/** DIY：每层缩进像素 */
const PI_BOM_TREE_INDENT_PX = 18

const tableMaxHeight = computed(() =>
  props.standalone ? 'calc(100vh - 220px)' : 'calc(84vh - 260px)',
)

const costUsageHeaderText = computed(() => {
  const b = basic.value
  const code = dVal(b?.kcaa01)
  const name = dVal(b?.kcaa02)
  const styleNo = dVal(b?.kcaa06)
  return `《成本BOM用量表》编码【${code}】,名称【${name}】,客户款号【${styleNo}】`
})

const partsPathText = computed(() => {
  const stack = partsParentStack.value ?? []
  if (!stack.length) return ''
  return stack.map((item) => String(item?.title ?? '').trim()).filter(Boolean).join(' / ')
})

/** 与 BOM 查看详情同一套字段映射（BomBasicForm） */
function buildBomBasicFormFromBasic(b) {
  const f = {
    systemcode: '',
    kcaa01: '',
    kcaa02: '',
    kcaa02_en: '',
    kpname: '',
    kcaa03: '',
    kcaa05: '',
    kcaa05_display: '',
    kcaa06: '',
    kcaa09: '',
    kcaa10: '',
    kcaa11: '',
    kcaa11_display: '',
    location: '国内',
    kcaa04: '',
    decimal: '2',
    kcaa25: '',
    kcaa27: 0,
    kcaa26: '',
    kcaa29: '',
    kcaa31: 0,
    kcaa30: '',
    kcaa32: '',
    kcaa33: '',
    sale_price: '',
    kcaa34: '',
    cost_price: '',
    kcaa35: '',
    Customer_Name: '',
    supplier_display: '',
    kcaa12_bool: false,
    kcaa13_bool: false,
    kcaa14_bool: true,
    customer_supply_bool: false,
    workshop_display: '',
    kcaa15: '',
    remark: '',
    sign_bool: false,
  }
  if (!b) return f
  f.systemcode = String(b.systemcode ?? '')
  f.kcaa01 = String(b.kcaa01 ?? '')
  f.kcaa02 = String(b.kcaa02 ?? '')
  f.kcaa02_en = String(b.kcaa02_en ?? '')
  f.kpname = String(b.kpname ?? '')
  f.kcaa03 = String(b.kcaa03 ?? '')
  f.kcaa05 = String(b.kcaa05 ?? '')
  const cat = String(b.categoryName ?? '').trim()
  f.kcaa05_display = f.kcaa05 ? (cat ? `${f.kcaa05},${cat}` : f.kcaa05) : ''
  f.kcaa06 = String(b.kcaa06 ?? '')
  f.kcaa09 = String(b.kcaa09 ?? '')
  f.kcaa10 = String(b.kcaa10 ?? '')
  f.kcaa11 = String(b.kcaa11 ?? '')
  const colorName = String(b.colorName ?? '').trim()
  f.kcaa11_display = f.kcaa11 ? (colorName ? `${f.kcaa11},${colorName}` : f.kcaa11) : ''
  f.location = String(b.location ?? '').trim() || '国内'
  f.kcaa04 = String(b.kcaa04 ?? '')
  f.decimal = String(b.decimal ?? '2') || '2'
  f.kcaa25 = String(b.kcaa25 ?? '')
  f.kcaa29 = String(b.kcaa29 ?? '')
  f.kcaa26 = String(b.kcaa26 ?? '')
  f.kcaa30 = String(b.kcaa30 ?? '')
  f.kcaa27 = Number(b.kcaa27) === 1 ? 1 : 0
  f.kcaa31 = Number(b.kcaa31) === 1 ? 1 : 0
  f.kcaa32 = String(b.kcaa32 ?? '')
  f.kcaa33 = String(b.kcaa33 ?? '')
  f.sale_price = String(b.sale_price ?? '')
  f.kcaa34 = String(b.kcaa34 ?? '')
  f.cost_price = String(b.cost_price ?? '')
  f.kcaa35 = String(b.kcaa35 ?? '')
  f.Customer_Name = String(b.Customer_Name ?? '')
  f.supplier_display = String(b.supplier_display ?? '').trim() || f.Customer_Name
  f.kcaa15 = String(b.kcaa15 ?? '')
  f.workshop_display = String(b.workshop_display ?? '').trim()
  f.remark = String(b.remark ?? '')
  f.kcaa12_bool = !!b.kcaa12_checked
  f.kcaa13_bool = !!b.kcaa13_checked
  f.kcaa14_bool = b.kcaa14_checked !== false
  f.customer_supply_bool = !!b.customer_supply_checked
  const sig = String(b.sign ?? '').trim()
  f.sign_bool = sig === '1' || sig.toLowerCase() === 'y'
  return f
}

const detailBasicForm = computed(() =>
  basic.value ? buildBomBasicFormFromBasic(basic.value) : null,
)

const detailCurrencyDropdownOptions = computed(() => {
  const set = new Set()
  const f = detailBasicForm.value
  const q = String(f?.kcaa34 ?? '').trim()
  const p = String(f?.kcaa35 ?? '').trim()
  if (q) set.add(q)
  if (p) set.add(p)
  return [...set].sort((a, b) => a.localeCompare(b, 'zh-CN'))
})

function noopBomBasicPicker() {}

function noopEmptySuggest(_query, cb) {
  if (typeof cb === 'function') cb([])
}

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

function partCostSum(row) {
  const qty = Number(row?.kcac06)
  const price = Number(row?.cost_price)
  if (!Number.isFinite(qty) || !Number.isFinite(price)) return 0
  return qty * price
}

function piBomPartsCodeCellStyle(row) {
  const level = Number(row?.level ?? 1)
  const depth = Number.isFinite(level) && level > 1 ? Math.min(level - 1, 10) : 0
  return { paddingLeft: `${depth * 18}px` }
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

function recomputeCostUsageRows() {
  const raw = costRows.value.map((row, idx) => ({
    kcaa01: String(row?.kcaa01 ?? '').trim(),
    kcaa02: row?.kcaa02 != null ? String(row.kcaa02) : '',
    kcaa03: row?.kcaa03 != null ? String(row.kcaa03) : '',
    kcaa04: row?.kcaa04 != null ? String(row.kcaa04) : '',
    Describe: row?.Describe != null ? String(row.Describe) : '',
    yl: Number(row?.kcac04 ?? row?.yl ?? 0),
    loss_rate: Number(row?.kcac05 ?? row?.loss_rate ?? 0),
    total_qty: Number(row?.kcac06 ?? row?.total_qty ?? 0),
    px: row?.px,
    _flatIndex: idx,
  }))
  costUsageRows.value = aggregateBomCostUsageFlatForDisplay(raw, []).map((row, idx) => ({
    ...row,
    __rowKey: `pi-cost-${idx}`,
  }))
}

function canOpenPiBomPartChild(row) {
  return Number(row?.id) > 0 && !!String(row?.systemcode ?? row?.kcac02 ?? '').trim()
}

function rootPartsParentFromBasic() {
  const b = basic.value
  const parentSystemcode = String(b?.systemcode ?? '').trim()
  const code = String(b?.kcaa01 ?? props.productKcaa01 ?? '').trim()
  return {
    title: code || '成品',
    parentSystemcode,
  }
}

function prepareParts(list) {
  return (Array.isArray(list) ? list : []).map((row, idx) => {
    const item = {
      ...row,
      _localKey: row?._localKey || genLocalKey(),
    }
    if (item.Seq == null || item.Seq === '') item.Seq = idx + 1
    syncPartKcac06(item)
    return item
  })
}

function replaceParts(list) {
  parts.value = prepareParts(list)
  partsError.value = ''
  scheduleTableLayout(partsTableRef)
}

async function loadPartsForParent(parentSystemcode) {
  const orderId = Number(props.orderId)
  const code = String(props.productKcaa01 ?? '').trim()
  const parent = String(parentSystemcode ?? '').trim()
  if (!Number.isFinite(orderId) || orderId <= 0 || !code || !parent) {
    partsError.value = '缺少订单ID、编码或父级systemcode，无法加载配件明细'
    parts.value = []
    return
  }
  partsLoading.value = true
  partsError.value = ''
  try {
    const res = await axios.get('/api/inventory/pi-bom-data/parts', {
      params: { orderId, kcaa01: code, parentSystemcode: parent },
    })
    const body = res.data
    if (body?.code !== 200) {
      partsError.value = body?.msg || '加载配件明细失败'
      parts.value = []
      return
    }
    replaceParts(body?.data?.parts ?? [])
  } catch (e) {
    partsError.value = String(e?.response?.data?.msg ?? e?.message ?? '加载配件明细失败')
    parts.value = []
  } finally {
    partsLoading.value = false
  }
}

async function openPiBomPartChild(row) {
  if (!canOpenPiBomPartChild(row)) return
  const parentSystemcode = String(row?.systemcode ?? row?.kcac02 ?? '').trim()
  const title = String(row?.kcaa01 ?? '').trim() || '下级'
  partsParentStack.value = [...partsParentStack.value, { title, parentSystemcode }]
  await loadPartsForParent(parentSystemcode)
}

async function backPiBomPartLevel() {
  if ((partsParentStack.value ?? []).length <= 1) return
  const nextStack = partsParentStack.value.slice(0, -1)
  const parentSystemcode = String(nextStack[nextStack.length - 1]?.parentSystemcode ?? '').trim()
  partsParentStack.value = nextStack
  await loadPartsForParent(parentSystemcode)
}

function walkTreeRows(rows, cb) {
  for (const row of rows ?? []) {
    cb(row)
    if (Array.isArray(row.children) && row.children.length) walkTreeRows(row.children, cb)
  }
}

/** 按展开 Set 压成表格行；展开一支时该支下有下级的一并写入 Set */
const treeVisibleRows = computed(() => {
  const expanded = treeExpandedIds.value
  /** @type {any[]} */
  const out = []
  const walk = (nodes, depth) => {
    for (const n of nodes || []) {
      const kids = Array.isArray(n.children) ? n.children : []
      const hasKids = kids.length > 0
      const isExpanded = hasKids && expanded.has(n.id)
      out.push({
        id: n.id,
        depth,
        hasKids,
        expanded: isExpanded,
        node: n,
        kcaa01: n.kcaa01 || '',
        kcaa02: n.kcaa02 || '',
        kcaa03: n.kcaa03 || '',
        kcaa04: n.kcaa04 || '',
        kcac04: n.kcac04,
        kcac05: n.kcac05,
        kcac06: n.kcac06,
        Describe: n.Describe || '',
        Seq: n.Seq,
        level: n.level,
      })
      if (isExpanded) walk(kids, depth + 1)
    }
  }
  walk(tree.value, 0)
  return out
})

/** 展开：本节点 + 该支下凡有下级的节点；收起：本节点及子孙从 Set 清掉 */
function toggleTreeExpand(node) {
  if (!node?.children?.length || node.id == null) return
  const set = new Set(treeExpandedIds.value)
  if (set.has(node.id)) {
    set.delete(node.id)
    walkTreeRows(node.children, (n) => {
      if (n.id != null) set.delete(n.id)
    })
  } else {
    set.add(node.id)
    walkTreeRows(node.children, (n) => {
      if (n.children?.length && n.id != null) set.add(n.id)
    })
  }
  treeExpandedIds.value = set
}

function onTreeRowToggle(row) {
  treeSelectedId.value = row.id
  if (!row.hasKids) return
  toggleTreeExpand(row.node)
}

function onTreeCodeClick(row) {
  treeSelectedId.value = row.id
  if (!row.hasKids) return
  toggleTreeExpand(row.node)
}

function expandAllTree() {
  const set = new Set()
  walkTreeRows(tree.value, (row) => {
    if (row.children?.length && row.id != null) set.add(row.id)
  })
  treeExpandedIds.value = set
}

function collapseAllTree() {
  treeExpandedIds.value = new Set()
}

function scheduleTableLayout(tableRef) {
  nextTick(() => {
    tableRef.value?.doLayout?.()
  })
}

function scheduleActiveTabLayout(tab = activeTab.value) {
  if (loading.value) return
  if (tab === 'parts') scheduleTableLayout(partsTableRef)
  if (tab === 'cost') scheduleTableLayout(costTableRef)
}

function costUsageSummaryMethod({ columns, data }) {
  return columns.map((col, idx) => {
    if (idx === 0) return '合计'
    const prop = col.property
    if (prop === 'yl') {
      return formatNumber(data.reduce((sum, row) => sum + (Number(row.yl) || 0), 0))
    }
    if (prop === 'total_qty') {
      return formatNumber(data.reduce((sum, row) => sum + (Number(row.total_qty) || 0), 0))
    }
    return ''
  })
}

async function loadDetail() {
  const orderId = Number(props.orderId)
  const code = String(props.productKcaa01 ?? '').trim()
  loading.value = true
  loadError.value = ''
  activeTab.value = 'basic'
  basic.value = null
  parts.value = []
  tree.value = []
  treeExpandedIds.value = new Set()
  treeSelectedId.value = null
  costRows.value = []
  costUsageRows.value = []
  partsParentStack.value = []
  partsError.value = ''
  if (!Number.isFinite(orderId) || orderId <= 0 || !code) {
    loadError.value = '缺少订单ID或编码，无法查看PI-BOM'
    loading.value = false
    return
  }
  try {
    const res = await axios.get('/api/inventory/pi-bom-data/detail', {
      params: { orderId, kcaa01: code },
    })
    const body = res.data
    if (body?.code !== 200) {
      loadError.value = body?.msg || '加载PI-BOM详情失败'
      return
    }
    const data = body.data ?? {}
    basic.value = data.basic ?? null
    const piFromBasic = String(data.basic?.piNo ?? data.piNo ?? props.piNo ?? '').trim()
    if (piFromBasic) emit('meta', { piNo: piFromBasic })
    const rootParent = rootPartsParentFromBasic()
    partsParentStack.value = rootParent.parentSystemcode ? [rootParent] : []
    replaceParts(Array.isArray(data.parts) ? data.parts : [])
    tree.value = Array.isArray(data.tree) ? data.tree : []
    treeExpandedIds.value = new Set()
    treeSelectedId.value = null
    costRows.value = Array.isArray(data.costRows) ? data.costRows : []
    recomputeCostUsageRows()
  } catch (e) {
    loadError.value = String(e?.response?.data?.msg ?? e?.message ?? '加载PI-BOM详情失败')
  } finally {
    loading.value = false
  }
}

watch(
  () => [props.orderId, props.productKcaa01],
  () => {
    void loadDetail()
  },
  { immediate: true },
)

watch(
  () => [activeTab.value, loading.value],
  ([tab, loadingNow]) => {
    if (loadingNow) return
    scheduleActiveTabLayout(tab)
  },
)
</script>

<style scoped>
.pi-bom-viewer-panel--standalone {
  padding: 0 16px 16px;
}

.error-alert {
  margin-bottom: 12px;
}

.pi-bom-detail-tabs {
  min-height: 420px;
}

.pi-bom-basic-form {
  max-height: calc(84vh - 230px);
  overflow: auto;
  padding-right: 8px;
}

.pi-bom-viewer-panel--standalone .pi-bom-basic-form {
  max-height: calc(100vh - 200px);
}

.pi-bom-tab-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
  margin-bottom: 10px;
}

.pi-bom-parts-toolbar {
  row-gap: 8px;
}

.pi-bom-parts-path {
  color: var(--el-text-color-regular);
  line-height: 32px;
}

.pi-bom-parts-alert {
  margin-bottom: 10px;
}

.pi-bom-detail-table,
.pi-bom-cost-table {
  width: 100%;
}

.pi-bom-parts-code {
  display: inline-block;
}

.pi-bom-cost-header {
  margin-bottom: 10px;
  font-weight: 600;
  color: var(--el-text-color-primary);
}

.pi-bom-tree-toolbar-hint {
  color: var(--el-text-color-secondary);
  font-size: 12px;
  line-height: 1.5;
}

/* 对齐 PI 追溯 / BOM用量表：原生树表 + ▶/▼ */
.pi-bom-native-tree-wrap {
  width: 100%;
  overflow: auto;
  border: 1px solid var(--el-border-color);
  border-radius: 4px;
  background: #fff;
}
.pi-bom-native-tree-table {
  width: 100%;
  min-width: 1100px;
  border-collapse: collapse;
  table-layout: fixed;
  font-size: 13px;
  color: var(--el-text-color-primary);
}
.pi-bom-native-tree-table thead th {
  position: sticky;
  top: 0;
  z-index: 2;
  background: var(--el-fill-color-light);
  border-bottom: 1px solid var(--el-border-color);
  border-right: 1px solid var(--el-border-color-lighter);
  padding: 8px 10px;
  font-weight: 600;
  text-align: left;
  white-space: nowrap;
}
.pi-bom-native-tree-table thead th:last-child {
  border-right: none;
}
.pi-bom-th-code {
  width: 22%;
}
.pi-bom-th-center,
.pi-bom-td-center {
  text-align: center;
  width: 64px;
}
.pi-bom-th-num,
.pi-bom-td-num {
  text-align: right;
  width: 100px;
  font-variant-numeric: tabular-nums;
}
.pi-bom-native-tree-table tbody td {
  border-bottom: 1px solid var(--el-border-color-lighter);
  border-right: 1px solid var(--el-border-color-extra-light);
  padding: 7px 10px;
  vertical-align: middle;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  background: #fff;
}
.pi-bom-native-tree-table tbody td:last-child {
  border-right: none;
}
.pi-bom-native-tree-table tbody tr:hover td {
  background: var(--el-fill-color-light);
}
.pi-bom-native-tree-table tbody tr.is-selected td {
  background: var(--el-color-primary-light-7);
}
.pi-bom-native-tree-table tbody tr.is-top .pi-bom-tree-code {
  font-weight: 600;
}
.pi-bom-td-code {
  white-space: normal !important;
  overflow: visible !important;
  text-overflow: clip !important;
}
.pi-bom-td-code-inner {
  display: flex;
  align-items: flex-start;
  gap: 2px;
}
.pi-bom-tree-indent {
  flex: 0 0 auto;
  height: 1px;
  margin-top: 11px;
}
.pi-bom-tree-caret {
  flex: 0 0 20px;
  width: 20px;
  height: 22px;
  border: none;
  background: transparent;
  padding: 0;
  margin: 0;
  font-size: 10px;
  line-height: 22px;
  color: var(--el-text-color-secondary);
  cursor: pointer;
  user-select: none;
  text-align: center;
}
.pi-bom-tree-caret--leaf {
  visibility: hidden;
  cursor: default;
}
.pi-bom-tree-code {
  flex: 1;
  min-width: 0;
  font-size: 13px;
  color: var(--el-text-color-primary);
  word-break: break-all;
  white-space: normal;
  line-height: 1.35;
  padding-top: 2px;
}
.pi-bom-tree-code--branch {
  cursor: pointer;
}
.pi-bom-tree-code--branch:hover {
  color: var(--el-color-primary);
}
</style>
