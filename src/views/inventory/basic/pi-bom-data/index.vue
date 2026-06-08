<template>
  <div class="erp-module-page">
    <el-card shadow="never">
      <template #header>
        <span class="page-title">PI_BOM资料</span>
      </template>

      <div class="pi-bom-mode-row">
        <el-button type="primary" plain>管理PI-BOM资料</el-button>
        <el-button type="info" plain disabled>PI-BOM物料批量替换功能(待定)</el-button>
      </div>

      <div class="search-row">
        <el-input
          v-model="keyword"
          clearable
          class="keyword-input"
          placeholder="搜索PI号或编码"
          @keyup.enter="onSearch"
        />
        <el-button type="primary" @click="onSearch">查询</el-button>
        <el-button @click="onReset">重置</el-button>
        <el-button class="btn-view" :loading="loading" @click="loadData">
          <el-icon class="btn-icon"><Refresh /></el-icon>
          刷新
        </el-button>
      </div>

      <el-alert v-if="errorMessage" :title="errorMessage" type="error" show-icon class="error-alert" />

      <div class="pagination-row pagination-row--top">
        <el-pagination
          background
          layout="total, sizes, prev, pager, next, jumper"
          :total="total"
          :current-page="page"
          :page-size="pageSize"
          :page-sizes="[10, 20, 50, 100]"
          @size-change="onPageSizeChange"
          @current-change="onPageChange"
        />
      </div>

      <el-skeleton :loading="loading" animated :rows="8">
        <template #default>
          <ErpTableViewportHScroll>
            <el-table
              class="erp-list-table"
              :data="tableList"
              border
              stripe
              row-key="id"
              style="width: 100%"
              :empty-text="loading ? '加载中...' : '暂无数据'"
            >
              <el-table-column
                label="操作"
                width="132"
                fixed="left"
                align="left"
                header-align="center"
                class-name="erp-col-actions"
              >
                <template #default="{ row }">
                  <ErpTableActions>
                    <el-button type="primary" plain size="small" @click="openPiBomViewer(row)">查看PI-BOM</el-button>
                  </ErpTableActions>
                </template>
              </el-table-column>
              <el-table-column label="状态(是否审核)" width="120" align="center" header-align="center">
                <template #default="{ row }">
                  <el-tag v-if="isAudited(row)" type="success" size="small">已审核</el-tag>
                  <el-tag v-else type="warning" size="small">未审核</el-tag>
                </template>
              </el-table-column>
              <el-table-column label="录入时间" width="154" class-name="erp-col-datetime">
                <template #default="{ row }">{{ formatDateTime(row.addtime) }}</template>
              </el-table-column>
              <el-table-column label="PI号" prop="piNo" min-width="140" />
              <el-table-column label="编码" prop="kcaa01" min-width="180" />
              <el-table-column label="是否运算" width="110" align="center" header-align="center">
                <template #default="{ row }">
                  <el-tag v-if="isCalculated(row)" type="success" size="small">已运算</el-tag>
                  <el-tag v-else type="info" size="small">未运算</el-tag>
                </template>
              </el-table-column>
              <el-table-column label="成本用量" prop="usageCostText" min-width="190" align="right" />
              <el-table-column label="名称(中文)" prop="materialNameCn" min-width="220" />
              <el-table-column label="客户款号" prop="customerStyleNo" min-width="150" />
              <el-table-column label="组别" prop="groupName" min-width="120" />
              <el-table-column label="单位" prop="unit" width="92" />
              <el-table-column label="分类" prop="materialCategoryName" min-width="140" />
              <el-table-column label="工厂款号" prop="factoryStyleNo" min-width="150" />
            </el-table>
          </ErpTableViewportHScroll>

          <div class="pagination-row pagination-row--bottom">
            <el-pagination
              background
              layout="total, sizes, prev, pager, next, jumper"
              :total="total"
              :current-page="page"
              :page-size="pageSize"
              :page-sizes="[10, 20, 50, 100]"
              @size-change="onPageSizeChange"
              @current-change="onPageChange"
            />
          </div>
        </template>
      </el-skeleton>
    </el-card>

    <el-dialog
      v-model="viewerVisible"
      :title="viewerTitle"
      width="94vw"
      top="4vh"
      destroy-on-close
      class="pi-bom-view-dialog"
      @closed="resetViewer"
    >
      <el-alert v-if="viewerError" :title="viewerError" type="error" show-icon class="error-alert" />
      <el-skeleton :loading="viewerLoading" animated :rows="10">
        <template #default>
          <el-tabs v-model="viewerActiveTab" class="pi-bom-detail-tabs">
            <el-tab-pane label="基础资料" name="basic">
              <el-form
                v-if="viewerBasic"
                class="erp-detail-form pi-bom-basic-form"
                label-position="right"
                label-width="112px"
                size="default"
              >
                <div class="pi-bom-section-title">系统</div>
                <el-row :gutter="12">
                  <el-col :xs="24" :sm="8">
                    <el-form-item label="PI号">
                      <el-input :model-value="dVal(viewerBasic.piNo)" readonly />
                    </el-form-item>
                  </el-col>
                  <el-col :xs="24" :sm="16">
                    <el-form-item label="系统编码">
                      <el-input :model-value="dVal(viewerBasic.systemcode)" readonly />
                    </el-form-item>
                  </el-col>
                </el-row>

                <div class="pi-bom-section-title">基本资料</div>
                <el-row :gutter="12">
                  <el-col :xs="24" :sm="8">
                    <el-form-item label="编码">
                      <el-input :model-value="dVal(viewerBasic.kcaa01)" readonly />
                    </el-form-item>
                  </el-col>
                  <el-col :xs="24" :sm="16">
                    <el-form-item label="名称">
                      <el-input :model-value="dVal(viewerBasic.kcaa02)" readonly />
                    </el-form-item>
                  </el-col>
                  <el-col :xs="24" :sm="12">
                    <el-form-item label="英文名称">
                      <el-input :model-value="dVal(viewerBasic.kcaa02_en)" readonly />
                    </el-form-item>
                  </el-col>
                  <el-col :xs="24" :sm="12">
                    <el-form-item label="规格">
                      <el-input :model-value="dVal(viewerBasic.kcaa03)" readonly />
                    </el-form-item>
                  </el-col>
                  <el-col :xs="24" :sm="12">
                    <el-form-item label="分类">
                      <el-input :model-value="dVal(viewerBasic.kcaa05)" readonly />
                    </el-form-item>
                  </el-col>
                  <el-col :xs="24" :sm="12">
                    <el-form-item label="颜色">
                      <el-input :model-value="dVal(viewerBasic.kcaa11)" readonly />
                    </el-form-item>
                  </el-col>
                  <el-col :xs="24" :sm="12">
                    <el-form-item label="客户款号">
                      <el-input :model-value="dVal(viewerBasic.kcaa06)" readonly />
                    </el-form-item>
                  </el-col>
                  <el-col :xs="24" :sm="12">
                    <el-form-item label="工厂款号">
                      <el-input :model-value="dVal(viewerBasic.kcaa09)" readonly />
                    </el-form-item>
                  </el-col>
                  <el-col :xs="24" :sm="12">
                    <el-form-item label="组别">
                      <el-input :model-value="dVal(viewerBasic.kcaa10)" readonly />
                    </el-form-item>
                  </el-col>
                  <el-col :xs="24" :sm="12">
                    <el-form-item label="产地">
                      <el-input :model-value="dVal(viewerBasic.location)" readonly />
                    </el-form-item>
                  </el-col>
                </el-row>

                <div class="pi-bom-section-title">单位与损耗</div>
                <el-row :gutter="12">
                  <el-col :xs="24" :sm="8">
                    <el-form-item label="使用单位">
                      <el-input :model-value="dVal(viewerBasic.kcaa04)" readonly />
                    </el-form-item>
                  </el-col>
                  <el-col :xs="24" :sm="8">
                    <el-form-item label="采购单位">
                      <el-input :model-value="dVal(viewerBasic.kcaa25)" readonly />
                    </el-form-item>
                  </el-col>
                  <el-col :xs="24" :sm="8">
                    <el-form-item label="转换率">
                      <el-input :model-value="dVal(viewerBasic.kcaa26)" readonly />
                    </el-form-item>
                  </el-col>
                  <el-col :xs="24" :sm="12">
                    <el-form-item label="报价损耗">
                      <el-input :model-value="formatNullableNumber(viewerBasic.kcaa32)" readonly />
                    </el-form-item>
                  </el-col>
                  <el-col :xs="24" :sm="12">
                    <el-form-item label="物料损耗">
                      <el-input :model-value="formatNullableNumber(viewerBasic.kcaa33)" readonly />
                    </el-form-item>
                  </el-col>
                </el-row>

                <div class="pi-bom-section-title">价格与其它</div>
                <el-row :gutter="12">
                  <el-col :xs="24" :sm="12">
                    <el-form-item label="BOM价格">
                      <el-input :model-value="formatNullableNumber(viewerBasic.sale_price)" readonly />
                    </el-form-item>
                  </el-col>
                  <el-col :xs="24" :sm="12">
                    <el-form-item label="采购价格">
                      <el-input :model-value="formatNullableNumber(viewerBasic.cost_price)" readonly />
                    </el-form-item>
                  </el-col>
                  <el-col :xs="24" :sm="12">
                    <el-form-item label="币别(报价)">
                      <el-input :model-value="dVal(viewerBasic.kcaa34)" readonly />
                    </el-form-item>
                  </el-col>
                  <el-col :xs="24" :sm="12">
                    <el-form-item label="币别(采购)">
                      <el-input :model-value="dVal(viewerBasic.kcaa35)" readonly />
                    </el-form-item>
                  </el-col>
                  <el-col :span="24">
                    <el-form-item label="备注">
                      <el-input :model-value="dVal(viewerBasic.remark)" type="textarea" :rows="3" readonly />
                    </el-form-item>
                  </el-col>
                </el-row>
              </el-form>
              <el-empty v-else description="暂无PI-BOM基础资料" />
            </el-tab-pane>

            <el-tab-pane label="配件明细" name="parts" lazy>
              <ErpTableViewportHScroll>
                <el-table
                  ref="piBomPartsTableRef"
                  :data="viewerParts"
                  border
                  stripe
                  row-key="id"
                  class="erp-list-table pi-bom-detail-table"
                  max-height="calc(84vh - 260px)"
                  :empty-text="viewerLoading ? '加载中...' : '暂无配件明细'"
                >
                  <el-table-column type="index" label="序号" width="58" align="center" fixed="left" />
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
                <el-button :disabled="!viewerTree.length" @click="expandAllPiBomTree">展开全部</el-button>
                <el-button :disabled="!viewerTree.length" @click="collapseAllPiBomTree">关闭全部</el-button>
              </div>
              <ErpTableViewportHScroll>
                <el-table
                  ref="piBomTreeTableRef"
                  :data="viewerTree"
                  border
                  stripe
                  row-key="id"
                  :tree-props="{ children: 'children' }"
                  default-expand-all
                  class="erp-list-table pi-bom-tree-table"
                  max-height="calc(84vh - 300px)"
                  :empty-text="viewerLoading ? '加载中...' : '暂无PI-BOM树形数据'"
                >
                  <el-table-column label="编码" prop="kcaa01" min-width="220" fixed="left" show-overflow-tooltip />
                  <el-table-column label="名称" prop="kcaa02" min-width="180" show-overflow-tooltip />
                  <el-table-column label="规格" prop="kcaa03" min-width="150" show-overflow-tooltip />
                  <el-table-column label="单位" prop="kcaa04" width="80" align="center" show-overflow-tooltip />
                  <el-table-column label="用量" width="110" align="right">
                    <template #default="{ row }">{{ formatNumber(row.kcac04) }}</template>
                  </el-table-column>
                  <el-table-column label="损耗" width="100" align="right">
                    <template #default="{ row }">{{ formatNumber(row.kcac05) }}</template>
                  </el-table-column>
                  <el-table-column label="合计" width="110" align="right">
                    <template #default="{ row }">{{ formatNumber(row.kcac06) }}</template>
                  </el-table-column>
                  <el-table-column label="备注" prop="Describe" min-width="160" show-overflow-tooltip />
                  <el-table-column label="Seq" prop="Seq" width="72" align="center" />
                  <el-table-column label="层级" prop="level" width="72" align="center" />
                </el-table>
              </ErpTableViewportHScroll>
            </el-tab-pane>

            <el-tab-pane label="成本BOM用量表" name="cost" lazy>
              <div class="pi-bom-cost-header">{{ costUsageHeaderText }}</div>
              <ErpTableViewportHScroll>
                <el-table
                  ref="piBomCostTableRef"
                  :data="costUsageRows"
                  border
                  stripe
                  show-summary
                  :summary-method="costUsageSummaryMethod"
                  row-key="__rowKey"
                  class="erp-list-table pi-bom-cost-table"
                  max-height="calc(84vh - 300px)"
                  :empty-text="viewerLoading ? '加载中...' : '暂无成本BOM用量，可能尚未运算'"
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
    </el-dialog>
  </div>
</template>

<script setup>
import { computed, nextTick, ref, watch } from 'vue'
import axios from 'axios'
import { ElMessage } from 'element-plus'
import { Refresh } from '@element-plus/icons-vue'
import ErpTableActions from '@/components/erp/ErpTableActions.vue'
import ErpTableViewportHScroll from '@/components/erp/ErpTableViewportHScroll.vue'
import { aggregateBomCostUsageFlatForDisplay } from '@/utils/bomCostUsageAggregate.js'

defineOptions({ name: 'inventory-basic-pi-bom-data' })

const loading = ref(false)
const errorMessage = ref('')
const tableList = ref([])
const total = ref(0)
const page = ref(1)
const pageSize = ref(20)
const keyword = ref('')

const viewerVisible = ref(false)
const viewerLoading = ref(false)
const viewerError = ref('')
const viewerRow = ref(null)
const viewerActiveTab = ref('basic')
const viewerBasic = ref(null)
const viewerParts = ref([])
const viewerTree = ref([])
const viewerCostRows = ref([])
const costUsageRows = ref([])
const piBomPartsTableRef = ref(null)
const piBomTreeTableRef = ref(null)
const piBomCostTableRef = ref(null)
const piBomTreeAutoExpanded = ref(false)

const viewerTitle = computed(() => {
  const row = viewerRow.value
  const pi = String(row?.piNo ?? '').trim()
  const code = String(row?.kcaa01 ?? '').trim()
  return pi || code ? `查看PI-BOM：${pi} / ${code}` : '查看PI-BOM'
})

const costUsageHeaderText = computed(() => {
  const b = viewerBasic.value
  const code = dVal(b?.kcaa01)
  const name = dVal(b?.kcaa02)
  const styleNo = dVal(b?.kcaa06)
  return `《成本BOM用量表》编码【${code}】,名称【${name}】,客户款号【${styleNo}】`
})

function recomputePiBomCostUsageRows() {
  const raw = viewerCostRows.value.map((row, idx) => ({
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

function isAudited(row) {
  return String(row?.pass ?? '').trim() === '1'
}

function isCalculated(row) {
  return String(row?.calcStatus ?? '').trim() === '已运算'
}

function dVal(v) {
  const s = String(v ?? '').trim()
  return s || '-'
}

function formatDateTime(v) {
  const raw = String(v ?? '').trim()
  if (!raw) return '-'
  const d = new Date(raw)
  if (Number.isNaN(d.getTime())) return raw.replace('T', ' ').slice(0, 19)
  const y = d.getFullYear()
  const mo = String(d.getMonth() + 1).padStart(2, '0')
  const da = String(d.getDate()).padStart(2, '0')
  const h = String(d.getHours()).padStart(2, '0')
  const mi = String(d.getMinutes()).padStart(2, '0')
  return `${y}-${mo}-${da} ${h}:${mi}`
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

function formatNullableNumber(v) {
  if (v === null || v === undefined || v === '') return '-'
  return formatNumber(v)
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

function walkTreeRows(rows, cb) {
  for (const row of rows ?? []) {
    cb(row)
    if (Array.isArray(row.children) && row.children.length) walkTreeRows(row.children, cb)
  }
}

function expandAllPiBomTree() {
  nextTick(() => {
    const t = piBomTreeTableRef.value
    if (!t) return
    walkTreeRows(viewerTree.value, (row) => {
      if (row.children?.length) t.toggleRowExpansion(row, true)
    })
  })
}

function collapseAllPiBomTree() {
  nextTick(() => {
    const t = piBomTreeTableRef.value
    if (!t) return
    walkTreeRows(viewerTree.value, (row) => {
      if (row.children?.length) t.toggleRowExpansion(row, false)
    })
  })
}

function schedulePiBomTableLayout(tableRef) {
  nextTick(() => {
    const layout = () => tableRef.value?.doLayout?.()
    layout()
    if (typeof window !== 'undefined') {
      window.requestAnimationFrame?.(layout)
      window.setTimeout(layout, 80)
    }
  })
}

function scheduleActiveViewerTabLayout(tab = viewerActiveTab.value) {
  if (!viewerVisible.value || viewerLoading.value) return
  if (tab === 'parts') schedulePiBomTableLayout(piBomPartsTableRef)
  if (tab === 'tree') schedulePiBomTableLayout(piBomTreeTableRef)
  if (tab === 'cost') schedulePiBomTableLayout(piBomCostTableRef)
}

watch(
  () => [viewerVisible.value, viewerActiveTab.value, viewerLoading.value],
  ([vis, tab, loadingNow]) => {
    if (!vis || loadingNow) return
    scheduleActiveViewerTabLayout(tab)
    if (tab === 'tree' && !piBomTreeAutoExpanded.value) {
      piBomTreeAutoExpanded.value = true
      expandAllPiBomTree()
    }
  },
)

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

async function loadData() {
  loading.value = true
  errorMessage.value = ''
  try {
    const params = {
      page: page.value,
      pageSize: pageSize.value,
      keyword: String(keyword.value ?? '').trim() || undefined,
    }
    const res = await axios.get('/api/inventory/pi-bom-data/list', { params })
    const body = res.data
    if (body?.code !== 200) {
      errorMessage.value = body?.msg || '加载失败'
      tableList.value = []
      total.value = 0
      return
    }
    const data = body.data ?? {}
    total.value = Number(data.total ?? 0) || 0
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
  page.value = 1
  loadData()
}

function onPageChange(p) {
  page.value = p
  loadData()
}

function onPageSizeChange(ps) {
  pageSize.value = ps
  page.value = 1
  loadData()
}

async function openPiBomViewer(row) {
  const orderId = Number(row?.orderId)
  const code = String(row?.kcaa01 ?? '').trim()
  if (!Number.isFinite(orderId) || orderId <= 0 || !code) {
    ElMessage.warning('缺少订单ID或编码，无法查看PI-BOM')
    return
  }
  viewerRow.value = row
  viewerVisible.value = true
  viewerActiveTab.value = 'basic'
  viewerLoading.value = true
  viewerError.value = ''
  viewerBasic.value = null
  viewerParts.value = []
  viewerTree.value = []
  viewerCostRows.value = []
  costUsageRows.value = []
  piBomTreeAutoExpanded.value = false
  try {
    const res = await axios.get('/api/inventory/pi-bom-data/detail', {
      params: { orderId, kcaa01: code },
    })
    const body = res.data
    if (body?.code !== 200) {
      viewerError.value = body?.msg || '加载PI-BOM详情失败'
      return
    }
    const data = body.data ?? {}
    viewerBasic.value = data.basic ?? null
    viewerParts.value = Array.isArray(data.parts) ? data.parts : []
    viewerTree.value = Array.isArray(data.tree) ? data.tree : []
    viewerCostRows.value = Array.isArray(data.costRows) ? data.costRows : []
    recomputePiBomCostUsageRows()
  } catch (e) {
    viewerError.value = String(e?.response?.data?.msg ?? e?.message ?? '加载PI-BOM详情失败')
  } finally {
    viewerLoading.value = false
  }
}

function resetViewer() {
  viewerActiveTab.value = 'basic'
  viewerError.value = ''
  viewerBasic.value = null
  viewerParts.value = []
  viewerTree.value = []
  viewerCostRows.value = []
  costUsageRows.value = []
  piBomTreeAutoExpanded.value = false
}

loadData()
</script>

<style scoped>
.page-title {
  font-size: 18px;
  font-weight: 600;
}

.pi-bom-mode-row {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-bottom: 12px;
}

.search-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
  margin-bottom: 12px;
}

.keyword-input {
  width: min(420px, 100%);
}

.btn-view {
  margin-left: auto;
}

.btn-icon {
  margin-right: 4px;
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

.pi-bom-section-title {
  margin: 12px 0 10px;
  padding-left: 8px;
  border-left: 3px solid var(--el-color-primary);
  font-weight: 600;
  color: var(--el-text-color-primary);
}

.pi-bom-tab-toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-bottom: 10px;
}

.pi-bom-detail-table,
.pi-bom-tree-table,
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
</style>
