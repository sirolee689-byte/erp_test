<template>
  <div class="assist-trace-page">
    <div class="assist-trace-toolbar no-print">
      <span class="toolbar-label">分类</span>
      <el-select
        v-model="filters.bomCodeId"
        clearable
        class="toolbar-field toolbar-field--category"
        placeholder="全部"
      >
        <el-option label="全部" value="" />
        <el-option
          v-for="item in categories"
          :key="item.id"
          :label="item.flag1 || item.name || `分类 ${item.id}`"
          :value="item.id"
        />
      </el-select>
      <span class="toolbar-label">查询条件</span>
      <el-input
        v-model="filters.keyword"
        class="toolbar-field toolbar-field--keyword"
        clearable
        placeholder="外协单号/物料编码/PI/备注..."
        @keyup.enter="onSearch"
      />
      <el-button type="primary" :loading="loading" @click="onSearch">立即查询</el-button>
      <el-button :loading="loading" @click="queryAll">查询全部</el-button>
      <el-popover placement="bottom-start" trigger="click" width="320">
        <template #reference>
          <el-button>列设置</el-button>
        </template>
        <div class="column-setting-panel">
          <div class="column-setting-title">勾选要显示的列</div>
          <el-checkbox-group v-model="checkedColumnKeys" @change="onColumnSettingChange">
            <el-checkbox v-for="col in dataColumns" :key="col.key" :label="col.key">{{ col.label }}</el-checkbox>
          </el-checkbox-group>
          <div class="column-setting-actions">
            <el-button link type="primary" @click="resetColumnSetting">恢复默认</el-button>
          </div>
        </div>
      </el-popover>
      <el-button :disabled="!rows.length" @click="printCurrentPage">打印本页</el-button>
    </div>

    <ErpTableViewportHScroll>
      <el-table
        ref="traceTableRef"
        v-loading="loading"
        :data="rows"
        border
        stripe
        class="erp-list-table assist-trace-table"
        :empty-text="traceEmptyText"
      >
        <el-table-column label="操作" width="88" fixed="left" align="center" class-name="no-print-col">
          <template #default="{ row }">
            <el-button type="info" plain size="small" @click="onOpenView(row)">查看</el-button>
          </template>
        </el-table-column>
        <el-table-column
          v-for="col in visibleDataColumns"
          :key="col.key"
          :prop="col.key"
          :label="col.label"
          :width="col.width"
          :min-width="col.minWidth"
          :fixed="col.fixed"
          :align="col.align"
          show-overflow-tooltip
        >
          <template #default="{ row }">
            <span>{{ formatTraceCell(row, col) }}</span>
          </template>
        </el-table-column>
      </el-table>
    </ErpTableViewportHScroll>

    <div class="assist-trace-pagination no-print">
      <el-pagination
        v-model:current-page="page.page"
        v-model:page-size="page.pageSize"
        background
        layout="total, sizes, prev, pager, next, jumper"
        :total="page.total"
        :page-sizes="PAGE_SIZES"
        @size-change="onPageSizeChange"
        @current-change="onPageChange"
      />
    </div>
  </div>
</template>

<script setup>
import {
  formatErpMoneyDisplay,
  formatErpPriceDisplay,
  formatErpQtyDisplay,
  formatErpTrimDecimal,
} from '@/utils/erpNumberDisplay'
import { computed, nextTick, onMounted, reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'
import axios from 'axios'
import ErpTableViewportHScroll from '@/components/erp/ErpTableViewportHScroll.vue'
import { refreshErpTableViewportHScroll } from '@/utils/erpTableViewportHScroll'

defineOptions({ name: 'supply-chain-daily-outsourcing-order-material-trace-panel' })

const emit = defineEmits(['open-view'])

/** 旧系统分页档位 */
const PAGE_SIZES = [10, 25, 50, 100, 200, 300, 500]
const TRACE_COLUMN_SETTING_KEY = 'erp.assistOrderMaterialTrace.columnSetting.v1'

const ASSIST_TYPE_LABEL = {
  '0': '其他外协',
  '1': '订单外协',
  '2': '订单外发',
}

const dataColumns = [
  { key: 'assistOrderNo', label: '外协单号', minWidth: 130, fixed: 'left' },
  { key: 'wxak03', label: '数量', width: 100, format: 'qty', align: 'right' },
  { key: 'wxak04', label: '单价', width: 100, format: 'price', align: 'right' },
  { key: 'wxak041', label: '单价含税', width: 110, format: 'price', align: 'right' },
  { key: 'wxak05', label: '金额', width: 110, format: 'money', align: 'right' },
  { key: 'wxak051', label: '金额含税', width: 110, format: 'money', align: 'right' },
  { key: 'tax', label: '税点', width: 90, format: 'tax', align: 'right' },
  { key: 'pi', label: '关联 PI', minWidth: 130 },
  { key: 'supplier', label: '外协商', minWidth: 180, format: 'supplier' },
  { key: 'assistTypeLabel', label: '外协类型', width: 110, format: 'assistType' },
  { key: 'assistDate', label: '外协时间', width: 120, format: 'date' },
  { key: 'taxIncludedLabel', label: '是否含税', width: 90, format: 'taxIncluded' },
  { key: 'currencyName', label: '币别', width: 90 },
  { key: 'deliveryDate', label: '交货日期', width: 120, format: 'deliveryDate' },
  { key: 'headerRemark', label: '主表备注', minWidth: 140 },
  { key: 'lineSeq', label: '明细序号', width: 90, align: 'right' },
  { key: 'info', label: '外协内容', minWidth: 140 },
  { key: 'inboundQty', label: '入库数量', width: 110, format: 'qty', align: 'right' },
  { key: 'outboundQty', label: '出库数量', width: 110, format: 'qty', align: 'right' },
  { key: 'poPi', label: 'PO/PI', minWidth: 120 },
  { key: 'remark', label: '明细备注', minWidth: 140 },
  { key: 'kcaa01', label: '物料编码', minWidth: 140 },
  { key: 'kcaa02', label: '中文名', minWidth: 150 },
  { key: 'kcaa02_en', label: '英文名', minWidth: 140 },
  { key: 'kpname', label: '开票名', minWidth: 140 },
  { key: 'kcaa03', label: '规格', minWidth: 120 },
  { key: 'kcaa04', label: '单位', width: 80 },
  { key: 'kcaa05', label: '分类', width: 100 },
  { key: 'version', label: '版本', width: 80 },
  { key: 'kcaa06', label: '客户款号', minWidth: 120 },
  { key: 'kcaa09', label: '工厂款号', minWidth: 120 },
  { key: 'kcaa11', label: '颜色', minWidth: 120 },
  { key: 'location', label: '产地', minWidth: 100 },
  { key: 'sale_price', label: '销售价格', width: 110, format: 'price', align: 'right' },
  { key: 'cost_price', label: '成本价格', width: 110, format: 'price', align: 'right' },
  { key: 'Customer_supply', label: '客户供应', width: 100 },
  { key: 'Customer_Name', label: '客户名称', minWidth: 140 },
]

const defaultColumnKeys = dataColumns.map((col) => col.key)
const checkedColumnKeys = ref([...defaultColumnKeys])
const visibleDataColumns = computed(() => {
  const selected = new Set(checkedColumnKeys.value)
  return dataColumns.filter((col) => selected.has(col.key))
})

const traceTableRef = ref(null)
const loading = ref(false)
const rows = ref([])
const categories = ref([])
/** 进页默认不加载；用户点查询后才置 true */
const traceEverQueried = ref(false)
const lastQueryAll = ref(false)
const page = reactive({ page: 1, pageSize: 10, total: 0 })
const filters = reactive({ keyword: '', bomCodeId: '' })

const traceEmptyText = computed(() => {
  if (loading.value) return '加载中...'
  if (traceEverQueried.value) return '暂无数据'
  return '请填写条件后点「立即查询」'
})

function fmtDate(v) {
  if (!v) return ''
  const d = new Date(v)
  if (Number.isNaN(d.getTime())) return String(v)
  return d.toISOString().slice(0, 10)
}

function selectedCategory() {
  const id = Number(filters.bomCodeId)
  if (!Number.isFinite(id) || id <= 0) return null
  return categories.value.find((item) => Number(item.id) === id) || null
}

function normalizeColumnKeys(keys) {
  if (!Array.isArray(keys)) return []
  const allowSet = new Set(dataColumns.map((col) => col.key))
  const seen = new Set()
  const result = []
  for (const key of keys) {
    const name = String(key || '').trim()
    if (!allowSet.has(name) || seen.has(name)) continue
    seen.add(name)
    result.push(name)
  }
  return result
}

function persistColumnSetting() {
  try {
    localStorage.setItem(TRACE_COLUMN_SETTING_KEY, JSON.stringify(checkedColumnKeys.value))
  } catch {
    // 本地列设置失败不影响查询。
  }
}

function loadColumnSetting() {
  try {
    const raw = localStorage.getItem(TRACE_COLUMN_SETTING_KEY)
    if (!raw) return
    const keys = normalizeColumnKeys(JSON.parse(raw))
    checkedColumnKeys.value = keys.length ? keys : [...defaultColumnKeys]
  } catch {
    checkedColumnKeys.value = [...defaultColumnKeys]
  }
}

function onColumnSettingChange(val) {
  const keys = normalizeColumnKeys(val)
  if (!keys.length) {
    ElMessage.warning('至少保留一列')
    checkedColumnKeys.value = [...defaultColumnKeys]
    persistColumnSetting()
    return
  }
  checkedColumnKeys.value = keys
  persistColumnSetting()
  void refreshTraceTableHScroll()
}

function resetColumnSetting() {
  checkedColumnKeys.value = [...defaultColumnKeys]
  persistColumnSetting()
  ElMessage.success('已恢复默认列显示')
  void refreshTraceTableHScroll()
}

function formatTraceCell(row, col) {
  if (!row || !col) return ''
  if (col.format === 'date') return fmtDate(row.assistDate)
  if (col.format === 'deliveryDate') return fmtDate(row.deliveryDate)
  if (col.format === 'supplier') {
    return [row.supplierCode, row.supplierName].filter(Boolean).join(' / ') || '-'
  }
  if (col.format === 'assistType') {
    const raw = String(row.assistType ?? '').trim()
    return ASSIST_TYPE_LABEL[raw] || raw || '-'
  }
  if (col.format === 'taxIncluded') {
    const raw = String(row.taxIncluded ?? '').trim()
    if (raw === '1') return '含税'
    if (raw === '2' || raw === '0') return '不含税'
    return raw || '-'
  }
  if (col.format === 'qty') return formatErpQtyDisplay(row[col.key])
  if (col.format === 'price') return formatErpPriceDisplay(row[col.key])
  if (col.format === 'money') return formatErpMoneyDisplay(row[col.key])
  if (col.format === 'tax') return formatErpTrimDecimal(row[col.key], { maxDecimals: 4 })
  const value = row[col.key]
  if (value == null || value === '') return ''
  if (typeof value === 'number' || (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value)))) {
    return formatErpTrimDecimal(value, { maxDecimals: 4, empty: '' })
  }
  return String(value)
}

async function refreshTraceTableHScroll() {
  await nextTick()
  traceTableRef.value?.doLayout?.()
  const el = traceTableRef.value?.$el
  if (el) refreshErpTableViewportHScroll(el)
}

async function loadCategories() {
  try {
    const { data } = await axios.get('/api/assist-order/material-trace/bom-codes')
    if (data?.code !== 200) throw new Error(data?.msg || '读取分类失败')
    categories.value = Array.isArray(data.data?.list) ? data.data.list : []
  } catch (err) {
    categories.value = []
    ElMessage.error(err?.response?.data?.msg || err?.message || '读取分类失败')
  }
}

async function loadList(opts = {}) {
  traceEverQueried.value = true
  lastQueryAll.value = !!opts.all
  loading.value = true
  try {
    const cat = selectedCategory()
    const params = {
      page: page.page,
      pageSize: page.pageSize,
      keyword: filters.keyword,
      all: opts.all ? '1' : '0',
    }
    if (!opts.all && cat) {
      params.bomCodeId = cat.id
      if (cat.prefix) params.bomPrefix = cat.prefix
    }
    const { data } = await axios.get('/api/assist-order/material-trace/list', { params })
    if (data?.code !== 200) throw new Error(data?.msg || '读取转向物料列表失败')
    rows.value = data.data?.list || []
    page.total = Number(data.data?.total || 0)
  } catch (err) {
    rows.value = []
    page.total = 0
    ElMessage.error(err?.response?.data?.msg || err?.message || '读取转向物料列表失败')
  } finally {
    loading.value = false
    await refreshTraceTableHScroll()
  }
}

function onSearch() {
  page.page = 1
  loadList()
}

function queryAll() {
  filters.keyword = ''
  filters.bomCodeId = ''
  page.page = 1
  loadList({ all: true })
}

function onPageSizeChange() {
  page.page = 1
  if (!traceEverQueried.value) return
  loadList({ all: lastQueryAll.value })
}

function onPageChange() {
  if (!traceEverQueried.value) return
  loadList({ all: lastQueryAll.value })
}

function onOpenView(row) {
  const headerId = Number(row?.headerId)
  if (!Number.isFinite(headerId) || headerId <= 0) {
    ElMessage.warning('找不到所属外协订单')
    return
  }
  emit('open-view', { id: headerId, assistOrderNo: row?.assistOrderNo })
}

function printCurrentPage() {
  if (!rows.value.length) {
    ElMessage.warning('暂无数据可打印')
    return
  }
  window.print()
}

onMounted(() => {
  loadColumnSetting()
  loadCategories()
})
</script>

<style scoped>
.assist-trace-page {
  padding: 12px;
}

.assist-trace-toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 10px;
  flex-wrap: wrap;
}

.toolbar-label {
  color: #606266;
  white-space: nowrap;
}

.toolbar-field {
  width: 180px;
}

.toolbar-field--category {
  width: 160px;
}

.toolbar-field--keyword {
  width: 320px;
}

.column-setting-panel {
  display: grid;
  gap: 8px;
}

.column-setting-title {
  color: #606266;
  font-size: 12px;
}

.column-setting-panel :deep(.el-checkbox-group) {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 4px 8px;
  max-height: 320px;
  overflow: auto;
}

.column-setting-actions {
  display: flex;
  justify-content: flex-end;
}

.assist-trace-pagination {
  margin-top: 10px;
  display: flex;
  justify-content: flex-end;
}

@media print {
  .no-print {
    display: none !important;
  }

  .assist-trace-page {
    padding: 0;
  }

  .assist-trace-table {
    width: 100% !important;
  }
}
</style>
