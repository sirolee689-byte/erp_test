<template>
  <div class="stock-trace-panel">
    <div class="stock-trace-toolbar">
      <span class="toolbar-label">查询条件</span>
      <el-input
        v-model="filters.keyword"
        class="toolbar-field toolbar-field--keyword"
        clearable
        placeholder="材料编码/出库单号/关联单号/备注/PO/PI..."
        @keyup.enter="onSearch"
      />
      <el-button type="primary" @click="onSearch">立即查询</el-button>
      <el-button @click="queryAll">查询全部</el-button>
      <el-popover placement="bottom-start" trigger="click" width="360">
        <template #reference><el-button>列设置</el-button></template>
        <div class="column-setting-panel">
          <div class="column-setting-title">勾选要显示的列</div>
          <el-checkbox-group v-model="checkedColumns" @change="persistColumns">
            <el-checkbox v-for="column in columnOptions" :key="column.key" :label="column.key">{{ column.label }}</el-checkbox>
          </el-checkbox-group>
          <div class="column-setting-actions">
            <el-button link type="primary" @click="selectAllColumns">全选</el-button>
            <el-button link @click="clearColumns">全不选</el-button>
          </div>
        </div>
      </el-popover>
      <el-button :loading="exporting" @click="exportXlsx">导出信息</el-button>
    </div>

    <el-table
      ref="traceTableRef"
      v-loading="loading"
      v-erp-list-h-scroll
      :data="rows"
      border
      stripe
      class="stock-trace-table erp-list-table"
      :empty-text="loading ? '加载中' : '暂无数据'"
    >
      <el-table-column v-if="isColumnVisible('outboundDate')" label="出库日期" width="120" fixed="left">
        <template #default="{ row }">{{ fmtDate(row.outboundDate) }}</template>
      </el-table-column>
      <el-table-column v-if="isColumnVisible('outboundNo')" prop="outboundNo" label="出库单单号" min-width="130" fixed="left" show-overflow-tooltip />
      <el-table-column v-if="isColumnVisible('headerPass')" label="是否审核" width="90" align="center">
        <template #default="{ row }">{{ row.headerPass === '1' ? '已审' : '未审' }}</template>
      </el-table-column>
      <el-table-column v-if="isColumnVisible('warehouseName')" prop="warehouseName" label="所出仓库" min-width="140" show-overflow-tooltip />
      <el-table-column v-if="isColumnVisible('sourceOrderNo')" prop="sourceOrderNo" label="关联单号" min-width="130" show-overflow-tooltip />
      <el-table-column v-if="isColumnVisible('relatedNo')" prop="relatedNo" label="相关单号" min-width="130" show-overflow-tooltip />
      <el-table-column v-if="isColumnVisible('kcaa01')" prop="kcaa01" label="编码" min-width="130" show-overflow-tooltip />
      <el-table-column v-if="isColumnVisible('kcaa02')" prop="kcaa02" label="材料名称" min-width="160" show-overflow-tooltip />
      <el-table-column v-if="isColumnVisible('kcaa03')" prop="kcaa03" label="规格" min-width="140" show-overflow-tooltip />
      <el-table-column v-if="isColumnVisible('kcaq03')" prop="kcaq03" label="数量" width="110" align="right">
        <template #default="{ row }">{{ formatQty(row.kcaq03) }}</template>
      </el-table-column>
      <el-table-column v-if="isColumnVisible('kcaq04')" prop="kcaq04" label="单价" width="110" align="right">
        <template #default="{ row }">{{ formatPrice(row.kcaq04) }}</template>
      </el-table-column>
      <el-table-column v-if="isColumnVisible('kcaq041')" prop="kcaq041" label="单价含税" width="120" align="right">
        <template #default="{ row }">{{ formatPrice(row.kcaq041) }}</template>
      </el-table-column>
      <el-table-column v-if="isColumnVisible('tax')" prop="tax" label="税点" width="90" align="right">
        <template #default="{ row }">{{ formatTax(row.tax) }}</template>
      </el-table-column>
      <el-table-column v-if="isColumnVisible('relatedPartyName')" prop="relatedPartyName" label="关联单位" min-width="180" show-overflow-tooltip />
      <el-table-column v-if="isColumnVisible('reference')" prop="reference" label="PO/PI或报关单号" min-width="140" show-overflow-tooltip />
      <el-table-column v-if="isColumnVisible('product')" prop="product" label="客户订单号" min-width="140" show-overflow-tooltip />
      <el-table-column v-if="isColumnVisible('Describe')" prop="Describe" label="备注或报关型号" min-width="180" show-overflow-tooltip />
      <el-table-column v-if="isColumnVisible('kcaq08')" prop="kcaq08" label="报关单价" width="110" align="right">
        <template #default="{ row }">{{ formatPrice(row.kcaq08) }}</template>
      </el-table-column>
      <el-table-column v-if="isColumnVisible('version')" prop="version" label="版本" min-width="100" show-overflow-tooltip />
      <el-table-column v-if="isColumnVisible('kcaa02_en')" prop="kcaa02_en" label="名称(英文)" min-width="150" show-overflow-tooltip />
      <el-table-column v-if="isColumnVisible('kpname')" prop="kpname" label="名称(开票名)" min-width="150" show-overflow-tooltip />
      <el-table-column v-if="isColumnVisible('remark')" prop="remark" label="备注" min-width="150" show-overflow-tooltip />
      <el-table-column v-if="isColumnVisible('location')" prop="location" label="产地" min-width="120" show-overflow-tooltip />
      <el-table-column v-if="isColumnVisible('sale_price')" prop="sale_price" label="销售价格" width="110" align="right" />
      <el-table-column v-if="isColumnVisible('cost_price')" prop="cost_price" label="成本价格" width="110" align="right" />
      <el-table-column v-if="isColumnVisible('Customer_supply')" prop="Customer_supply" label="客户供应" width="100" />
      <el-table-column v-if="isColumnVisible('Customer_Name')" prop="Customer_Name" label="客户名称" min-width="150" show-overflow-tooltip />
    </el-table>

    <div class="stock-trace-pagination">
      <el-pagination
        v-model:current-page="page.page"
        v-model:page-size="page.pageSize"
        background
        layout="total, sizes, prev, pager, next, jumper"
        :total="page.total"
        :page-sizes="ERP_PAGE_SIZE_OPTIONS"
        @size-change="loadList"
        @current-change="loadList"
      />
    </div>
  </div>
</template>

<script setup>
import { ERP_PAGE_SIZE_OPTIONS } from '@/utils/erpPagination'
import { nextTick, onMounted, reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'
import axios from 'axios'
import ExcelJS from 'exceljs'
import { refreshErpTableViewportHScroll } from '@/utils/erpTableViewportHScroll'
import {
  formatErpPriceDisplay,
  formatErpQtyDisplay,
  formatErpTrimDecimal,
} from '@/utils/erpNumberDisplay.js'

defineOptions({ name: 'StockOutMaterialTracePanel' })

const COLUMN_KEY = 'erp.stockOut.materialTrace.columnSetting.v1'
const columnOptions = [
  { key: 'outboundDate', label: '出库日期' },
  { key: 'outboundNo', label: '出库单单号' },
  { key: 'headerPass', label: '是否审核' },
  { key: 'warehouseName', label: '所出仓库' },
  { key: 'sourceOrderNo', label: '关联单号' },
  { key: 'relatedNo', label: '相关单号' },
  { key: 'kcaa01', label: '编码' },
  { key: 'kcaa02', label: '材料名称' },
  { key: 'kcaa03', label: '规格' },
  { key: 'kcaq03', label: '数量' },
  { key: 'kcaq04', label: '单价' },
  { key: 'kcaq041', label: '单价含税' },
  { key: 'tax', label: '税点' },
  { key: 'relatedPartyName', label: '关联单位' },
  { key: 'reference', label: 'PO/PI或报关单号' },
  { key: 'product', label: '客户订单号' },
  { key: 'Describe', label: '备注或报关型号' },
  { key: 'kcaq08', label: '报关单价' },
  { key: 'version', label: '版本' },
  { key: 'kcaa02_en', label: '名称(英文)' },
  { key: 'kpname', label: '名称(开票名)' },
  { key: 'remark', label: '备注' },
  { key: 'location', label: '产地' },
  { key: 'sale_price', label: '销售价格' },
  { key: 'cost_price', label: '成本价格' },
  { key: 'Customer_supply', label: '客户供应' },
  { key: 'Customer_Name', label: '客户名称' },
]
const defaultColumnKeys = columnOptions.map((item) => item.key)

const traceTableRef = ref(null)
const loading = ref(false)
const exporting = ref(false)
const queried = ref(false)
const rows = ref([])
const page = reactive({ page: 1, pageSize: 10, total: 0 })
const filters = reactive({ keyword: '' })
const checkedColumns = ref([...defaultColumnKeys])

function fmtDate(v) {
  if (!v) return ''
  const d = new Date(v)
  if (Number.isNaN(d.getTime())) return String(v)
  return d.toISOString().slice(0, 10)
}

function formatQty(v) {
  return formatErpQtyDisplay(v)
}

function formatPrice(v) {
  return formatErpPriceDisplay(v)
}

function formatTax(v) {
  return formatErpTrimDecimal(v, { maxDecimals: 2 })
}

function isColumnVisible(key) {
  return checkedColumns.value.includes(key)
}

function persistColumns() {
  localStorage.setItem(COLUMN_KEY, JSON.stringify(checkedColumns.value))
  refreshTraceTableHScroll()
}

function selectAllColumns() {
  checkedColumns.value = [...defaultColumnKeys]
  persistColumns()
}

function clearColumns() {
  checkedColumns.value = []
  persistColumns()
}

async function refreshTraceTableHScroll() {
  await nextTick()
  traceTableRef.value?.doLayout?.()
  const el = traceTableRef.value?.$el
  if (el) refreshErpTableViewportHScroll(el)
}

function requestParams(overrides = {}) {
  return {
    page: page.page,
    pageSize: page.pageSize,
    keyword: filters.keyword,
    all: '0',
    ...overrides,
  }
}

async function loadList(opts = {}) {
  queried.value = true
  loading.value = true
  try {
    const params = requestParams({ all: opts.all ? '1' : '0' })
    const { data } = await axios.get('/api/stock-out/material-trace/list', { params })
    if (data?.code !== 200) throw new Error(data?.msg || '读取出库转向物料列表失败')
    rows.value = data.data?.list || []
    page.total = Number(data.data?.total || 0)
  } catch (err) {
    ElMessage.error(err?.response?.data?.msg || err?.message || '读取出库转向物料列表失败')
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
  page.page = 1
  loadList({ all: true })
}

function exportCellText(row, key) {
  if (key === 'outboundDate') return fmtDate(row.outboundDate)
  if (key === 'headerPass') return row.headerPass === '1' ? '已审' : '未审'
  if (key === 'kcaq03') return formatQty(row.kcaq03)
  if (key === 'kcaq04') return formatPrice(row.kcaq04)
  if (key === 'kcaq041') return formatPrice(row.kcaq041)
  if (key === 'tax') return formatTax(row.tax)
  if (key === 'kcaq08') return formatPrice(row.kcaq08)
  return row?.[key] ?? ''
}

async function exportXlsx() {
  if (!queried.value) {
    ElMessage.warning('请先执行查询')
    return
  }
  exporting.value = true
  try {
    const currentRows = rows.value || []

    const visibleColumns = columnOptions.filter((column) => isColumnVisible(column.key))
    const workbook = new ExcelJS.Workbook()
    const sheet = workbook.addWorksheet('出库单转向物料查询')
    sheet.addRow(visibleColumns.map((column) => column.label))
    currentRows.forEach((row) => {
      sheet.addRow(visibleColumns.map((column) => exportCellText(row, column.key)))
    })
    sheet.getRow(1).font = { bold: true }
    sheet.columns.forEach((column) => { column.width = 18 })

    const buffer = await workbook.xlsx.writeBuffer()
    const blob = new Blob([buffer], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = '出库单转向物料查询.xlsx'
    link.click()
    URL.revokeObjectURL(url)
  } catch (err) {
    ElMessage.error(err?.response?.data?.msg || err?.message || '导出失败')
  } finally {
    exporting.value = false
  }
}

onMounted(async () => {
  try {
    const raw = localStorage.getItem(COLUMN_KEY)
    const saved = raw == null ? null : JSON.parse(raw)
    const allowed = new Set(defaultColumnKeys)
    if (Array.isArray(saved)) checkedColumns.value = saved.filter((key) => allowed.has(key))
  } catch {
    // 本地列设置失败不影响查询
  }
  await loadList()
})

defineExpose({ loadList, onSearch, queryAll })
</script>

<style scoped>
.stock-trace-toolbar {
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
  width: 220px;
}

.toolbar-field--keyword {
  width: 360px;
  max-width: 100%;
}

.stock-trace-pagination {
  display: flex;
  justify-content: flex-end;
  margin-top: 12px;
}

.column-setting-panel {
  max-height: 52vh;
  overflow: auto;
}

.column-setting-title {
  margin-bottom: 8px;
  color: var(--el-text-color-regular);
}

.column-setting-panel :deep(.el-checkbox-group) {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 6px;
}

.column-setting-actions {
  margin-top: 10px;
}
</style>
