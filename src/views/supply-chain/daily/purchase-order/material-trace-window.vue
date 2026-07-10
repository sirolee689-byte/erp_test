<template>
  <div class="buy-trace-page">
    <div class="buy-trace-toolbar">
      <span class="toolbar-label">查询条件</span>
      <el-input
        v-model="filters.keyword"
        class="toolbar-field toolbar-field--keyword"
        clearable
        placeholder="采购单号/物料编码/备注/供应商..."
        @keyup.enter="onSearch"
      />
      <el-button type="primary" :loading="loading" @click="onSearch">立即查询</el-button>
      <el-button :loading="loading" @click="queryAll">查询全部</el-button>
      <el-popover placement="bottom-start" trigger="click" width="300">
        <template #reference>
          <el-button>列设置</el-button>
        </template>
        <div class="column-setting-panel">
          <div class="column-setting-title">勾选要显示的列</div>
          <el-checkbox-group v-model="checkedColumnKeys" @change="onColumnSettingChange">
            <el-checkbox v-for="col in traceColumns" :key="col.key" :label="col.key">{{ col.label }}</el-checkbox>
          </el-checkbox-group>
          <div class="column-setting-actions">
            <el-button link type="primary" @click="resetColumnSetting">恢复默认</el-button>
          </div>
        </div>
      </el-popover>
      <el-button :loading="exporting" @click="exportReportXlsx">导出信息</el-button>
    </div>

    <ErpTableViewportHScroll>
      <el-table
        ref="traceTableRef"
        v-loading="loading"
        :data="rows"
        border
        stripe
        class="erp-list-table buy-trace-table"
        :empty-text="traceEmptyText"
      >
        <el-table-column
          v-for="col in visibleTraceColumns"
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

    <div class="buy-trace-pagination">
      <el-pagination
        v-model:current-page="page.page"
        v-model:page-size="page.pageSize"
        background
        layout="total, sizes, prev, pager, next, jumper"
        :total="page.total"
        :page-sizes="ERP_PAGE_SIZE_OPTIONS"
        @size-change="onPageSizeChange"
        @current-change="onPageChange"
      />
    </div>
  </div>
</template>

<script setup>
import { ERP_MAX_PAGE_SIZE, ERP_PAGE_SIZE_OPTIONS } from '@/utils/erpPagination'
import {
  formatErpMoneyDisplay,
  formatErpPriceDisplay,
  formatErpQtyDisplay,
  formatErpTrimDecimal,
} from '@/utils/erpNumberDisplay'
import { computed, nextTick, onMounted, reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'
import axios from 'axios'
import ExcelJS from 'exceljs'
import ErpTableViewportHScroll from '@/components/erp/ErpTableViewportHScroll.vue'
import { refreshErpTableViewportHScroll } from '@/utils/erpTableViewportHScroll'

defineOptions({ name: 'supply-chain-daily-purchase-order-material-trace-window' })

const TRACE_COLUMN_SETTING_KEY = 'erp.buyOrderMaterialTrace.columnSetting.v1'
const TRACE_EXPORT_TITLE = '采购转向物料查询'
const EXPORT_THIN_BORDER = {
  top: { style: 'thin', color: { argb: 'FF333333' } },
  left: { style: 'thin', color: { argb: 'FF333333' } },
  bottom: { style: 'thin', color: { argb: 'FF333333' } },
  right: { style: 'thin', color: { argb: 'FF333333' } },
}
const EXPORT_HEADER_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF0F0F0' } }

const traceColumns = [
  { key: 'buyOrderNo', label: '采购订单单号', minWidth: 130, fixed: 'left' },
  { key: 'referenceNo', label: '关联单号/PI', minWidth: 140 },
  { key: 'buyDate', label: '采购时间', width: 120, format: 'date' },
  { key: 'creator', label: '下单人', minWidth: 100 },
  { key: 'supplier', label: '供应商/外协商', minWidth: 220, format: 'supplier' },
  { key: 'kcaa01', label: '物料编码', minWidth: 130 },
  { key: 'kcaa02', label: '物料名称', minWidth: 160 },
  { key: 'kcak03', label: '采购数量', width: 110, format: 'qty', align: 'right' },
  { key: 'inboundQty', label: '入库数量', width: 110, format: 'qty', align: 'right' },
  { key: 'kcak04', label: '单价', width: 110, format: 'price', align: 'right' },
  { key: 'kcak041', label: '含税单价', width: 120, format: 'price', align: 'right' },
  { key: 'kcak05', label: '金额', width: 110, format: 'money', align: 'right' },
  { key: 'kcak051', label: '含税金额', width: 120, format: 'money', align: 'right' },
  { key: 'tax', label: '税点', width: 90, format: 'tax', align: 'right' },
  { key: 'poPi', label: 'PO/PI', minWidth: 140 },
  { key: 'orderNo', label: '客户订单号', minWidth: 140 },
  { key: 'info', label: '备注', minWidth: 180 },
  { key: 'kcaa02_en', label: '名称(英文)', minWidth: 150 },
  { key: 'kpname', label: '名称(开票名)', minWidth: 150 },
  { key: 'location', label: '产地', minWidth: 120 },
  { key: 'sale_price', label: '销售价格', width: 110, format: 'price', align: 'right' },
  { key: 'cost_price', label: '成本价格', width: 110, format: 'price', align: 'right' },
  { key: 'Customer_supply', label: '客户供应', width: 100 },
  { key: 'Customer_Name', label: '客户名称', minWidth: 150 },
]

const defaultColumnKeys = traceColumns.map((col) => col.key)
const checkedColumnKeys = ref([...defaultColumnKeys])
const visibleTraceColumns = computed(() => {
  const selected = new Set(checkedColumnKeys.value)
  return traceColumns.filter((col) => selected.has(col.key))
})

const traceTableRef = ref(null)
const loading = ref(false)
const exporting = ref(false)
const rows = ref([])
/** 进页默认不加载；用户点「立即查询」或「查询全部」后才置 true */
const traceEverQueried = ref(false)
/** 记录最近一次查询是否「查询全部」，导出时复用同一口径 */
const lastQueryAll = ref(false)
const reportGeneratedAt = ref('')
const reportCode = ref('')
const page = reactive({ page: 1, pageSize: 10, total: 0 })
const filters = reactive({ keyword: '' })

const traceEmptyText = computed(() => {
  if (loading.value) return '加载中...'
  if (traceEverQueried.value) return '暂无数据'
  return '请输入关键字后点「立即查询」'
})

function fmtDate(v) {
  if (!v) return ''
  const d = new Date(v)
  if (Number.isNaN(d.getTime())) return String(v)
  return d.toISOString().slice(0, 10)
}

function formatNow() {
  const d = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

function makeReportCode() {
  const raw = `${Date.now()}${Math.random().toString(16).slice(2)}`
  return raw.toUpperCase().replace(/[^0-9A-F]/g, '').slice(0, 16)
}

function normalizeColumnKeys(keys) {
  if (!Array.isArray(keys)) return []
  const allowSet = new Set(traceColumns.map((col) => col.key))
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
  if (col.format === 'date') return fmtDate(row.buyDate)
  if (col.format === 'supplier') {
    return [row.supplierCode, row.supplierName].filter(Boolean).join(' / ') || '-'
  }
  if (col.format === 'qty') return formatErpQtyDisplay(row[col.key])
  if (col.format === 'price') return formatErpPriceDisplay(row[col.key])
  if (col.format === 'money') return formatErpMoneyDisplay(row[col.key])
  if (col.format === 'tax') return formatErpTrimDecimal(row[col.key], { maxDecimals: 4 })
  const value = row[col.key]
  if (value == null || value === '') return ''
  // 兜底：库内偶发数值字符串（如 30.00）也走去尾 0，避免裸 toFixed 样式上屏
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

async function loadList(opts = {}) {
  traceEverQueried.value = true
  lastQueryAll.value = !!opts.all
  loading.value = true
  try {
    const params = {
      page: page.page,
      pageSize: page.pageSize,
      keyword: filters.keyword,
      all: opts.all ? '1' : '0',
    }
    const { data } = await axios.get('/api/buy-order/material-trace/list', { params })
    if (data?.code !== 200) throw new Error(data?.msg || '读取转向物料列表失败')
    rows.value = data.data?.list || []
    page.total = Number(data.data?.total || 0)
    reportGeneratedAt.value = formatNow()
    reportCode.value = makeReportCode()
  } catch (err) {
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
  page.page = 1
  loadList({ all: true })
}

function onPageSizeChange() {
  if (!traceEverQueried.value) return
  loadList({ all: lastQueryAll.value })
}

function onPageChange() {
  if (!traceEverQueried.value) return
  loadList({ all: lastQueryAll.value })
}

function traceExportFileName() {
  const keyword = String(filters.keyword || '').trim() || (lastQueryAll.value ? '查询全部' : '未输入关键字')
  const safe = `${TRACE_EXPORT_TITLE}-${keyword}`.replace(/[\\/:*?"<>|]/g, '_').slice(0, 160)
  return `${safe || TRACE_EXPORT_TITLE}.xlsx`
}

function applyTraceExportRowStyle(row, opts = {}) {
  row.eachCell((cell) => {
    cell.border = EXPORT_THIN_BORDER
    cell.alignment = {
      horizontal: opts.horizontal || 'center',
      vertical: 'middle',
      wrapText: true,
    }
    if (opts.bold) cell.font = { ...(cell.font || {}), bold: true }
    if (opts.fill) cell.fill = opts.fill
  })
}

function addTraceExportMetaRow(ws, leftText, rightText, colCount) {
  if (colCount <= 1) {
    return ws.addRow([`${leftText}　${rightText}`])
  }
  const row = ws.addRow([leftText, rightText])
  const splitCol = Math.max(1, Math.floor(colCount / 2))
  ws.mergeCells(row.number, 1, row.number, splitCol)
  ws.mergeCells(row.number, splitCol + 1, row.number, colCount)
  return row
}

async function fetchAllTraceRowsForExport() {
  const total = Number(page.total || 0)
  if (!total) return []
  const baseParams = {
    keyword: filters.keyword,
    all: lastQueryAll.value ? '1' : '0',
  }
  const chunkSize = ERP_MAX_PAGE_SIZE
  const pages = Math.ceil(total / chunkSize)
  const allRows = []
  for (let currentPage = 1; currentPage <= pages; currentPage += 1) {
    const { data } = await axios.get('/api/buy-order/material-trace/list', {
      params: { ...baseParams, page: currentPage, pageSize: chunkSize },
    })
    if (data?.code !== 200) throw new Error(data?.msg || '读取转向物料列表失败')
    allRows.push(...(data.data?.list || []))
  }
  return allRows
}

async function exportReportXlsx() {
  if (!traceEverQueried.value || !page.total) {
    ElMessage.warning('暂无数据可导出')
    return
  }
  const columns = visibleTraceColumns.value
  if (!columns.length) {
    ElMessage.warning('至少保留一列后再导出')
    return
  }

  exporting.value = true
  try {
    const exportRows = await fetchAllTraceRowsForExport()
    if (!exportRows.length) {
      ElMessage.warning('暂无数据可导出')
      return
    }

    const wb = new ExcelJS.Workbook()
    const ws = wb.addWorksheet(TRACE_EXPORT_TITLE, {
      views: [{ state: 'frozen', ySplit: 5 }],
      pageSetup: {
        paperSize: 9,
        orientation: 'landscape',
        fitToPage: true,
        fitToWidth: 1,
        fitToHeight: 0,
      },
    })
    const colCount = columns.length
    const titleRow = ws.addRow([TRACE_EXPORT_TITLE])
    ws.mergeCells(titleRow.number, 1, titleRow.number, colCount)
    titleRow.font = { bold: true, size: 14 }
    ws.getCell(titleRow.number, 1).alignment = { horizontal: 'center', vertical: 'middle' }

    addTraceExportMetaRow(
      ws,
      `报表生成时间：${reportGeneratedAt.value || formatNow()}`,
      `报表代码：${reportCode.value || makeReportCode()}`,
      colCount,
    )
    addTraceExportMetaRow(
      ws,
      `查询关键字：${lastQueryAll.value ? '（查询全部）' : (String(filters.keyword || '').trim() || '（空）')}`,
      `统计条数：${exportRows.length}`,
      colCount,
    )

    const countRow = ws.addRow([`统计完毕，一共：${exportRows.length} 条记录`])
    ws.mergeCells(countRow.number, 1, countRow.number, colCount)
    ws.addRow([])

    const headRow = ws.addRow(columns.map((col) => col.label))
    applyTraceExportRowStyle(headRow, { bold: true, fill: EXPORT_HEADER_FILL })

    for (const row of exportRows) {
      const added = ws.addRow(columns.map((col) => formatTraceCell(row, col)))
      applyTraceExportRowStyle(added)
    }

    ws.columns.forEach((col, index) => {
      const traceCol = columns[index]
      col.width = Math.max(10, Math.min(36, Math.round((traceCol?.width || traceCol?.minWidth || 120) / 8)))
    })

    const buf = await wb.xlsx.writeBuffer()
    const blob = new Blob([buf], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = traceExportFileName()
    a.click()
    URL.revokeObjectURL(url)
    ElMessage.success('已导出 xlsx')
  } catch (err) {
    ElMessage.error(err?.response?.data?.msg || err?.message || '导出失败')
  } finally {
    exporting.value = false
  }
}

onMounted(() => {
  loadColumnSetting()
})
</script>

<style scoped>
.buy-trace-page {
  padding: 12px;
}

.buy-trace-toolbar {
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
}

.column-setting-actions {
  display: flex;
  justify-content: flex-end;
}

.buy-trace-pagination {
  margin-top: 10px;
  display: flex;
  justify-content: flex-end;
}
</style>
