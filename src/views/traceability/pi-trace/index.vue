<template>
  <div class="erp-module-page pi-trace-page">
    <el-card v-if="!canView" shadow="never">
      <el-alert type="error" show-icon :closable="false" title="无权限" description="您没有「PI追溯管理」权限，无法访问本页。" />
    </el-card>

    <template v-else>
      <el-card shadow="never" class="search-card">
        <template #header>
          <span class="page-title">{{ pageTitle }}</span>
        </template>

        <div class="mode-row">
          <span class="mode-label">追溯类别</span>
          <el-radio-group v-model="traceMode" @change="onModeChange">
            <el-radio-button label="forward">正向追溯</el-radio-button>
            <el-radio-button label="reverse">反向追溯</el-radio-button>
          </el-radio-group>
        </div>

        <!-- 正向查询 -->
        <el-form v-if="traceMode === 'forward'" :inline="true" class="search-form" @submit.prevent="onForwardSearch">
          <el-form-item label="PI号" required>
            <el-input
              v-model="forwardForm.pi"
              clearable
              placeholder="例如：PI-888"
              style="width: 220px"
              @keyup.enter="onForwardSearch"
            />
          </el-form-item>
          <el-form-item label="子类/成品编码">
            <el-input
              v-model="forwardForm.productCode"
              clearable
              placeholder="选填"
              style="width: 220px"
              @keyup.enter="onForwardSearch"
            />
          </el-form-item>
          <el-form-item>
            <el-button type="primary" :loading="forwardLoading" @click="onForwardSearch">查询</el-button>
            <el-button @click="onForwardReset">重置</el-button>
          </el-form-item>
        </el-form>

        <!-- 反向查询 -->
        <el-form v-else :inline="true" class="search-form" @submit.prevent="onReverseSearch">
          <el-form-item label="物料关键字" required>
            <el-input
              v-model="reverseForm.keyword"
              clearable
              placeholder="编码/名称/规格/GUID/备注等"
              style="width: 280px"
              @keyup.enter="onReverseSearch"
            />
          </el-form-item>
          <el-form-item label="销售日期起">
            <el-date-picker
              v-model="reverseForm.startDate"
              type="date"
              value-format="YYYY-MM-DD"
              placeholder="选填"
              style="width: 160px"
            />
          </el-form-item>
          <el-form-item label="销售日期止">
            <el-date-picker
              v-model="reverseForm.endDate"
              type="date"
              value-format="YYYY-MM-DD"
              placeholder="选填"
              style="width: 160px"
            />
          </el-form-item>
          <el-form-item>
            <el-button type="primary" :loading="reverseLoading" @click="onReverseSearch">查询</el-button>
            <el-button @click="onReverseReset">重置</el-button>
          </el-form-item>
        </el-form>
      </el-card>

      <!-- 正向结果 -->
      <template v-if="traceMode === 'forward'">
        <el-empty v-if="forwardEmptyMsg" :description="forwardEmptyMsg" />
        <div v-for="product in forwardProducts" :key="product.id" class="product-block">
          <el-card shadow="never">
            <template #header>
              <div class="product-header">
                <div class="product-title">所属成品编码：{{ product.kcaa01 || '-' }}</div>
                <div class="product-meta">
                  <span>销售数量：{{ formatQty(product.salesQty) }}</span>
                  <span>销售单位：{{ product.salesUnit || '-' }}</span>
                </div>
              </div>
            </template>

            <div class="header-bills">
              <div class="bill-line">
                <span class="bill-label">采购订单（{{ product.headerBills?.buy?.count ?? 0 }}）</span>
                <BillLinks :group="product.headerBills?.buy" kind="buy" />
              </div>
              <div class="bill-line">
                <span class="bill-label">外协订单（{{ product.headerBills?.assist?.count ?? 0 }}）</span>
                <BillLinks :group="product.headerBills?.assist" kind="assist" />
              </div>
              <div class="bill-line">
                <span class="bill-label">生产派工单（{{ product.headerBills?.dispatch?.count ?? 0 }}）</span>
                <BillLinks :group="product.headerBills?.dispatch" kind="dispatch" />
              </div>
              <div class="bill-line">
                <span class="bill-label">生产领料单（{{ product.headerBills?.productionIssue?.count ?? 0 }}）</span>
                <BillLinks :group="product.headerBills?.productionIssue" kind="stockOut" />
              </div>
              <div class="bill-line">
                <span class="bill-label">成品生产入库单（{{ product.headerBills?.stockInFg?.count ?? 0 }}）</span>
                <BillLinks :group="product.headerBills?.stockInFg" kind="stockIn" />
              </div>
              <div class="bill-line">
                <span class="bill-label">成品出库单（{{ product.headerBills?.stockOutFg?.count ?? 0 }}）</span>
                <BillLinks :group="product.headerBills?.stockOutFg" kind="stockOut" />
              </div>
            </div>

            <div class="tree-toolbar">
              <el-button size="small" @click="expandAll(product.id)">展开全部</el-button>
              <el-button size="small" @click="collapseAll(product.id)">收起全部</el-button>
              <span class="tree-toolbar-tip">提示：点三角或编码，可单独展开/收起该行；追溯单据仅显示有数据的类别</span>
            </div>

            <div v-if="!(product.bomTree || []).length" class="bom-explorer-empty">无 BOM 明细</div>
            <!-- 原生 table 扁平行：列必对齐；展开状态自管，CUT 编码完整 -->
            <div v-else class="bom-explorer">
              <table class="bom-tree-table">
                <thead>
                  <tr>
                    <th class="bom-th-code">编码</th>
                    <th>名称</th>
                    <th>规格</th>
                    <th class="bom-th-center">单位</th>
                    <th class="bom-th-num">用量</th>
                    <th class="bom-th-num">损耗</th>
                    <th class="bom-th-num">合计</th>
                    <th>备注</th>
                    <th class="bom-th-docs">正向追溯数据</th>
                  </tr>
                </thead>
                <tbody>
                  <tr
                    v-for="row in visibleBomRows(product)"
                    :key="`${product.id}-${row.id}`"
                    :class="{
                      'is-selected': selectedNodeId === row.id,
                      'is-top': row.depth === 0,
                    }"
                    @click="onSelectBomNode(row.id)"
                  >
                    <td class="bom-td-code">
                      <div class="bom-td-code-inner">
                        <span class="bom-tree-indent" :style="{ width: `${row.depth * BOM_TREE_INDENT_PX}px` }" />
                        <button
                          type="button"
                          class="bom-tree-caret"
                          :class="{ 'bom-tree-caret--leaf': !row.hasKids }"
                          :disabled="!row.hasKids"
                          :title="row.hasKids ? (row.expanded ? '收起' : '展开') : undefined"
                          @click.stop="onBomRowToggle(product.id, row)"
                        >
                          <template v-if="row.hasKids">{{ row.expanded ? '▼' : '▶' }}</template>
                        </button>
                        <span
                          class="bom-tree-code"
                          :class="{ 'bom-tree-code--branch': row.hasKids }"
                          :title="row.code"
                          @click.stop="onBomCodeActivate(product.id, row)"
                        >{{ row.code }}</span>
                      </div>
                    </td>
                    <td :title="row.kcaa02">{{ row.kcaa02 }}</td>
                    <td :title="row.kcaa03">{{ row.kcaa03 }}</td>
                    <td class="bom-td-center">{{ row.kcaa04 }}</td>
                    <td class="bom-td-num">{{ formatUsage4(row.kcac04) }}</td>
                    <td class="bom-td-num">{{ formatUsage4(row.kcac05) }}</td>
                    <td class="bom-td-num">{{ formatUsage4(row.kcac06) }}</td>
                    <td :title="row.Describe">{{ row.Describe }}</td>
                    <td class="bom-td-docs">
                      <div v-for="m in row.activeDocs" :key="m.key" class="bom-doc-line">
                        {{ m.label }}({{ row.docs[m.key].count }})：
                        <MaterialBillLinks :group="row.docs[m.key]" :kind="m.kind" />
                      </div>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </el-card>
        </div>
      </template>

      <!-- 反向结果 -->
      <template v-else>
        <el-card shadow="never" class="result-card">
          <el-table
            v-erp-list-h-scroll
            :data="reverseList"
            border
            stripe
            size="small"
            highlight-current-row
            empty-text="暂无数据"
            @current-change="onReverseRowChange"
          >
            <el-table-column prop="kcaa01" label="物料编码" min-width="140" show-overflow-tooltip />
            <el-table-column prop="kcaa02" label="物料名称" min-width="120" show-overflow-tooltip />
            <el-table-column prop="kcaa03" label="规格" min-width="120" show-overflow-tooltip />
            <el-table-column prop="kcaa04" label="单位" width="70" align="center" />
            <el-table-column label="用量" width="90" align="right">
              <template #default="{ row }">{{ formatUsage4(row.kcac04) }}</template>
            </el-table-column>
            <el-table-column label="损耗" width="80" align="right">
              <template #default="{ row }">{{ formatUsage4(row.kcac05) }}</template>
            </el-table-column>
            <el-table-column label="合计" width="90" align="right">
              <template #default="{ row }">{{ formatUsage4(row.kcac06) }}</template>
            </el-table-column>
            <el-table-column prop="Describe" label="备注" min-width="100" show-overflow-tooltip />
            <el-table-column label="审核状态" width="90" align="center">
              <template #default="{ row }">{{ row.pass === '1' ? '已审核' : '未审核' }}</template>
            </el-table-column>
            <el-table-column prop="parentKey" label="所属上级" min-width="140" show-overflow-tooltip />
          </el-table>

          <div class="pager-row">
            <el-pagination
              v-model:current-page="reversePage"
              v-model:page-size="reversePageSize"
              :total="reverseTotal"
              :page-sizes="ERP_PAGE_SIZE_OPTIONS"
              layout="total, sizes, prev, pager, next"
              background
              @size-change="onReverseSearch"
              @current-change="loadReverseList"
            />
          </div>
        </el-card>

        <el-card v-if="reverseDetail" shadow="never" class="detail-card" v-loading="reverseDetailLoading">
          <template #header>
            <span>向上追溯 · {{ reverseDetail.current?.kcaa01 || '' }}</span>
          </template>

          <div v-if="reverseDetail.product" class="product-found">
            <div>对应款号：{{ reverseDetail.product.productCode || reverseDetail.product.kcaa03 || '-' }}</div>
            <div>客款号：{{ reverseDetail.product.customerStyle || '-' }}</div>
            <div>材料编码：{{ reverseDetail.product.kcaa01 || '-' }}</div>
            <div>材料名称：{{ reverseDetail.product.kcaa02 || '-' }}</div>
            <div>组别：{{ reverseDetail.product.kcaa10 || '-' }}</div>
          </div>
          <el-alert v-else type="info" :closable="false" title="未找到含 PQ- 的成品节点" />

          <el-divider content-position="left">上级链路</el-divider>
          <el-table :data="reverseDetail.ancestors || []" border size="small" empty-text="无上级">
            <el-table-column prop="kcaa01" label="编码" min-width="140" />
            <el-table-column prop="kcaa02" label="名称" min-width="120" />
            <el-table-column prop="kcaa03" label="规格" min-width="120" />
            <el-table-column prop="sid" label="PI" min-width="100" />
          </el-table>

          <el-divider content-position="left">对应 PI / 销售</el-divider>
          <el-table :data="reverseDetail.pis || []" border size="small" empty-text="无关联销售订单">
            <el-table-column prop="piNo" label="对应PI号" min-width="110" />
            <el-table-column prop="poNo" label="PO号" min-width="110" />
            <el-table-column prop="salesDate" label="PI销售时间" width="120" />
            <el-table-column label="销售数量" width="100" align="right">
              <template #default="{ row }">{{ formatQty(row.salesQty) }}</template>
            </el-table-column>
            <el-table-column prop="piCustomerStyle" label="PI中客款号" min-width="120" />
            <el-table-column label="物料用量" width="110" align="right">
              <template #default="{ row }">{{ formatUsage4OrDash(row.materialUsage) }}</template>
            </el-table-column>
            <el-table-column label="计价用量" width="110" align="right">
              <template #default="{ row }">{{ formatUsage4OrDash(row.pricedUsage) }}</template>
            </el-table-column>
          </el-table>
        </el-card>
      </template>
    </template>
  </div>
</template>

<script setup>
import { computed, defineComponent, h, reactive, ref } from 'vue'
import axios from 'axios'
import { ElMessage } from 'element-plus'
import { ERP_PAGE_SIZE_OPTIONS } from '@/utils/erpPagination'
import { formatErpQtyDisplay, formatErpTrimDecimal } from '@/utils/erpNumberDisplay'
import { getPermissionModelFromStorage, hasPageAction } from '@/utils/menuPermission'
import { buildErpDeepLinkUrl, openInNewTab } from '@/utils/erpOpenInNewTab'

defineOptions({ name: 'traceability-pi-trace' })

const pageTitle = 'PI追溯管理'
const menuPath = 'traceability/pi-trace'
const model = getPermissionModelFromStorage()
const canView = computed(() => hasPageAction(model, menuPath, 'view'))

const BILL_PATH = {
  buy: '/supply-chain/daily/purchase-order',
  assist: '/supply-chain/daily/outsourcing-order',
  dispatch: '/production/daily/dispatch',
  stockIn: '/inventory/daily/stock-in',
  stockOut: '/inventory/daily/stock-out',
}

function openBill(kind, bill) {
  const path = BILL_PATH[kind]
  if (!path || !bill?.id) {
    ElMessage.warning('缺少单据主键，无法打开详情')
    return
  }
  openInNewTab(buildErpDeepLinkUrl(path, 'view', bill.id))
}

const BillLinks = defineComponent({
  name: 'PiTraceBillLinks',
  props: {
    group: { type: Object, default: null },
    kind: { type: String, required: true },
  },
  setup(props) {
    return () => {
      const bills = props.group?.bills
      if (!Array.isArray(bills) || !bills.length) return h('span', '-')
      return h(
        'span',
        { class: 'bill-links' },
        bills.flatMap((b, i) => {
          const nodes = [
            h(
              'a',
              {
                href: 'javascript:;',
                class: 'bill-link',
                onClick: (e) => {
                  e.preventDefault()
                  openBill(props.kind, b)
                },
              },
              b.billNo || '-',
            ),
          ]
          if (i < bills.length - 1) nodes.push(h('span', ', '))
          return nodes
        }),
      )
    }
  },
})

const MaterialBillLinks = defineComponent({
  name: 'PiTraceMaterialBillLinks',
  props: {
    group: { type: Object, default: null },
    kind: { type: String, required: true },
  },
  setup(props) {
    return () => {
      const bills = props.group?.bills
      if (!Array.isArray(bills) || !bills.length) return h('span', '-')
      return h(
        'span',
        { class: 'bill-links' },
        bills.flatMap((b, i) => {
          const qtyText = formatErpTrimDecimal(b.qty, { maxDecimals: 4, empty: '' })
          const label = qtyText ? `${b.billNo}(${qtyText})` : b.billNo
          const nodes = [
            h(
              'a',
              {
                href: 'javascript:;',
                class: 'bill-link',
                onClick: (e) => {
                  e.preventDefault()
                  openBill(props.kind, b)
                },
              },
              label || '-',
            ),
          ]
          if (i < bills.length - 1) nodes.push(h('span', ', '))
          return nodes
        }),
      )
    }
  },
})

/** 物料级追溯：只展示 count>0 的类别，全无则空白 */
const DOC_KIND_META = [
  { key: 'buy', label: '采购', kind: 'buy' },
  { key: 'assist', label: '外协', kind: 'assist' },
  { key: 'dispatch', label: '派工', kind: 'dispatch' },
  { key: 'stockIn', label: '入库', kind: 'stockIn' },
  { key: 'stockOutFg', label: '成品出库', kind: 'stockOut' },
]

function docsWithData(docs) {
  return DOC_KIND_META.filter((m) => Number(docs?.[m.key]?.count ?? 0) > 0)
}

function formatQty(v) {
  if (v == null || v === '') return '-'
  return formatErpQtyDisplay(v, '-')
}

function formatUsage4(v) {
  if (v == null || v === '') return '-'
  return formatErpTrimDecimal(v, { maxDecimals: 4, empty: '-' })
}

/** DIY：每层缩进像素，改数字即可调疏密 */
const BOM_TREE_INDENT_PX = 18

/**
 * 按展开状态把 BOM 树压成表格行（原生 table 才能保证列对齐；
 * 之前用子组件+CSS Grid，scoped 样式进不去，列会竖着堆）
 */
function visibleBomRows(product) {
  const expanded = expandedSetOf(product.id)
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
        code: String(n.kcaa01 ?? '').trim() || '-',
        kcaa02: n.kcaa02 || '',
        kcaa03: n.kcaa03 || '',
        kcaa04: n.kcaa04 || '',
        kcac04: n.kcac04,
        kcac05: n.kcac05,
        kcac06: n.kcac06,
        Describe: n.Describe || '',
        docs: n.docs,
        activeDocs: docsWithData(n.docs),
      })
      if (isExpanded) walk(kids, depth + 1)
    }
  }
  walk(product.bomTree || [], 0)
  return out
}

const traceMode = ref('forward')

const forwardForm = reactive({ pi: '', productCode: '' })
const forwardLoading = ref(false)
const forwardProducts = ref([])
const forwardEmptyMsg = ref('')
/** 各成品已展开节点 id：productId -> Set<nodeId>；默认全收起只看顶层 */
const expandedByProduct = ref({})
const EMPTY_EXPAND_SET = new Set()
const selectedNodeId = ref(null)

function expandedSetOf(productId) {
  return expandedByProduct.value[productId] ?? EMPTY_EXPAND_SET
}

function toggleExpand(productId, nodeId) {
  const set = new Set(expandedByProduct.value[productId] || [])
  if (set.has(nodeId)) set.delete(nodeId)
  else set.add(nodeId)
  expandedByProduct.value = { ...expandedByProduct.value, [productId]: set }
}

function onSelectBomNode(nodeId) {
  selectedNodeId.value = nodeId
}

function onBomRowToggle(productId, row) {
  onSelectBomNode(row.id)
  if (!row.hasKids) return
  toggleExpand(productId, row.id)
}

function onBomCodeActivate(productId, row) {
  onSelectBomNode(row.id)
  if (!row.hasKids) return
  toggleExpand(productId, row.id)
}

function walkTree(nodes, fn) {
  for (const n of nodes || []) {
    fn(n)
    if (n.children?.length) walkTree(n.children, fn)
  }
}

function expandAll(productId) {
  const product = forwardProducts.value.find((p) => p.id === productId)
  if (!product) return
  const set = new Set()
  walkTree(product.bomTree || [], (row) => {
    if (row.children?.length) set.add(row.id)
  })
  expandedByProduct.value = { ...expandedByProduct.value, [productId]: set }
}

function collapseAll(productId) {
  expandedByProduct.value = { ...expandedByProduct.value, [productId]: new Set() }
}

function formatUsage4OrDash(v) {
  if (v == null || v === '') return '-'
  return formatErpTrimDecimal(v, { maxDecimals: 4, empty: '-' })
}

function onModeChange() {
  forwardEmptyMsg.value = ''
  reverseDetail.value = null
}

function onForwardReset() {
  forwardForm.pi = ''
  forwardForm.productCode = ''
  forwardProducts.value = []
  forwardEmptyMsg.value = ''
  expandedByProduct.value = {}
  selectedNodeId.value = null
}

async function onForwardSearch() {
  if (!canView.value) {
    ElMessage.error('无 PI追溯管理 权限')
    return
  }
  const pi = String(forwardForm.pi ?? '').trim()
  if (!pi) {
    ElMessage.warning('请输入PI号')
    return
  }
  if (!/pi/i.test(pi)) {
    ElMessage.warning('请输入正确的PI号，例如：PI-888。')
    return
  }
  forwardLoading.value = true
  forwardEmptyMsg.value = ''
  forwardProducts.value = []
  expandedByProduct.value = {}
  selectedNodeId.value = null
  try {
    const res = await axios.get('/api/traceability/pi-trace/forward', {
      params: {
        pi,
        productCode: String(forwardForm.productCode ?? '').trim() || undefined,
      },
    })
    const body = res.data
    if (body?.code !== 200) {
      ElMessage.error(String(body?.msg ?? '查询失败'))
      return
    }
    if (body?.data?.empty || !body?.data?.products?.length) {
      forwardEmptyMsg.value = '无此PI数据。'
      return
    }
    // 默认只显示顶层配件，下级收起；点三角/编码再单独展开
    forwardProducts.value = body.data.products
  } catch (e) {
    ElMessage.error(String(e?.response?.data?.msg ?? e?.message ?? '请求失败'))
  } finally {
    forwardLoading.value = false
  }
}

const reverseForm = reactive({ keyword: '', startDate: '', endDate: '' })
const reverseLoading = ref(false)
const reverseList = ref([])
const reverseTotal = ref(0)
const reversePage = ref(1)
const reversePageSize = ref(10)
const reverseDetail = ref(null)
const reverseDetailLoading = ref(false)

function onReverseReset() {
  reverseForm.keyword = ''
  reverseForm.startDate = ''
  reverseForm.endDate = ''
  reverseList.value = []
  reverseTotal.value = 0
  reversePage.value = 1
  reverseDetail.value = null
}

function onReverseSearch() {
  reversePage.value = 1
  loadReverseList()
}

async function loadReverseList() {
  if (!canView.value) {
    ElMessage.error('无 PI追溯管理 权限')
    return
  }
  const keyword = String(reverseForm.keyword ?? '').trim()
  if (!keyword) {
    ElMessage.warning('请输入物料关键字')
    return
  }
  reverseLoading.value = true
  reverseDetail.value = null
  try {
    const res = await axios.get('/api/traceability/pi-trace/reverse/list', {
      params: {
        keyword,
        page: reversePage.value,
        pageSize: reversePageSize.value,
      },
    })
    const body = res.data
    if (body?.code !== 200) {
      ElMessage.error(String(body?.msg ?? '查询失败'))
      return
    }
    reverseList.value = body.data?.list ?? []
    reverseTotal.value = Number(body.data?.total ?? 0)
    if (reverseList.value.length) {
      await loadReverseDetail(reverseList.value[0].id)
    }
  } catch (e) {
    ElMessage.error(String(e?.response?.data?.msg ?? e?.message ?? '请求失败'))
  } finally {
    reverseLoading.value = false
  }
}

function onReverseRowChange(row) {
  if (!row?.id) return
  loadReverseDetail(row.id)
}

async function loadReverseDetail(id) {
  reverseDetailLoading.value = true
  try {
    const res = await axios.get('/api/traceability/pi-trace/reverse/detail', {
      params: {
        id,
        startDate: reverseForm.startDate || undefined,
        endDate: reverseForm.endDate || undefined,
      },
    })
    const body = res.data
    if (body?.code !== 200) {
      ElMessage.error(String(body?.msg ?? '加载详情失败'))
      return
    }
    reverseDetail.value = body.data
  } catch (e) {
    ElMessage.error(String(e?.response?.data?.msg ?? e?.message ?? '请求失败'))
  } finally {
    reverseDetailLoading.value = false
  }
}
</script>

<style scoped>
.pi-trace-page {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.page-title {
  font-size: 18px;
  font-weight: 600;
}
.mode-row {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 12px;
}
.mode-label {
  font-weight: 600;
}
.search-form {
  margin-bottom: 0;
}
.product-block {
  margin-top: 4px;
}
.product-header {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.product-title {
  font-weight: 600;
  font-size: 15px;
}
.product-meta {
  display: flex;
  gap: 24px;
  color: var(--el-text-color-secondary);
  font-size: 13px;
}
.header-bills {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: 12px;
  font-size: 13px;
}
.bill-line {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: baseline;
}
.bill-label {
  font-weight: 600;
  min-width: 160px;
}
.tree-toolbar {
  margin-bottom: 8px;
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
}
.tree-toolbar-tip {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
.bom-explorer-empty {
  padding: 16px;
  color: var(--el-text-color-secondary);
  font-size: 13px;
}
/* DIY：列宽改 th/td 的 width/min-width；缩进改 BOM_TREE_INDENT_PX */
.bom-explorer {
  border: 1px solid var(--el-border-color);
  border-radius: 4px;
  background: #fff;
  max-height: min(70vh, 900px);
  overflow: auto;
}
.bom-tree-table {
  width: 100%;
  min-width: 1100px;
  border-collapse: collapse;
  table-layout: fixed;
  font-size: 13px;
  color: var(--el-text-color-primary);
}
.bom-tree-table thead th {
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
.bom-tree-table thead th:last-child {
  border-right: none;
}
.bom-th-code {
  width: 26%;
}
.bom-th-center,
.bom-td-center {
  text-align: center;
  width: 56px;
}
.bom-th-num,
.bom-td-num {
  text-align: right;
  width: 72px;
  font-variant-numeric: tabular-nums;
}
.bom-th-docs {
  width: 22%;
}
.bom-tree-table tbody td {
  border-bottom: 1px solid var(--el-border-color-lighter);
  border-right: 1px solid var(--el-border-color-extra-light);
  padding: 7px 10px;
  vertical-align: middle;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  background: #fff;
}
.bom-tree-table tbody td:last-child {
  border-right: none;
}
.bom-tree-table tbody tr:hover td {
  background: var(--el-fill-color-light);
}
.bom-tree-table tbody tr.is-selected td {
  background: var(--el-color-primary-light-7);
}
.bom-tree-table tbody tr.is-top .bom-tree-code {
  font-weight: 600;
}
.bom-td-code {
  white-space: normal !important;
  overflow: visible !important;
  text-overflow: clip !important;
}
.bom-td-code-inner {
  display: flex;
  align-items: flex-start;
  gap: 2px;
}
.bom-tree-indent {
  flex: 0 0 auto;
  height: 1px;
  margin-top: 11px;
}
.bom-tree-caret {
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
.bom-tree-caret--leaf {
  visibility: hidden;
  cursor: default;
}
.bom-tree-code {
  flex: 1;
  min-width: 0;
  font-size: 13px;
  color: var(--el-text-color-primary);
  word-break: break-all;
  white-space: normal;
  line-height: 1.35;
  padding-top: 2px;
}
.bom-tree-code--branch {
  cursor: pointer;
}
.bom-tree-code--branch:hover {
  color: var(--el-color-primary);
}
.bom-td-docs {
  white-space: normal !important;
  overflow: visible !important;
  text-overflow: unset !important;
  font-size: 12px;
  line-height: 1.45;
}
.bom-doc-line {
  display: flex;
  flex-wrap: wrap;
  gap: 2px 4px;
  align-items: baseline;
}
.pager-row {
  margin-top: 12px;
  display: flex;
  justify-content: flex-end;
}
.product-found {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 8px 16px;
  margin-bottom: 8px;
  font-size: 13px;
}
.detail-card {
  margin-top: 4px;
}
:deep(.bill-link) {
  color: var(--el-color-primary);
  text-decoration: none;
  cursor: pointer;
}
:deep(.bill-link:hover) {
  text-decoration: underline;
}
</style>
