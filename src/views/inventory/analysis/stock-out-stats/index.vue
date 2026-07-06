<template>
  <div class="erp-module-page stock-out-stats-page">
    <div class="stock-toolbar no-print">
      <el-button type="primary" @click="onPrint">打印统计报表</el-button>
      <el-button type="primary" @click="openQueryDialog">查询内容</el-button>
      <el-popover placement="bottom-start" trigger="click" width="300">
        <template #reference>
          <el-button>列设置</el-button>
        </template>
        <div class="column-setting-panel">
          <div class="column-setting-title">勾选要显示的列（打印、导出同步）</div>
          <el-checkbox-group v-model="checkedColumnKeys" @change="onColumnSettingChange">
            <el-checkbox v-for="col in availableColumns" :key="col.key" :label="col.key">{{ col.label }}</el-checkbox>
          </el-checkbox-group>
          <div class="column-setting-actions">
            <el-button link type="primary" @click="resetColumnSetting">恢复默认</el-button>
          </div>
        </div>
      </el-popover>
      <el-button v-if="hasExportPermission" @click="exportReportXlsx">导出信息</el-button>
    </div>

    <section class="report-shell">
      <header class="report-header">
        <div v-if="printLogoSrc" class="logo-wrap">
          <img class="logo" :src="printLogoSrc" alt="logo" @error="printLogoSrc = ''" />
        </div>
        <div class="head-info">
          <div v-if="printConfig.info" class="head-info-html" v-html="printConfig.info"></div>
          <div v-else class="head-info-placeholder">请先在打印设定中维护抬头信息</div>
        </div>
      </header>

      <h2 class="report-title">出库统计表</h2>

      <div class="report-meta">
        <span>报表生成时间：</span><span class="meta-value">{{ reportGeneratedAt || ' ' }}</span>
        <span class="meta-gap">报表代码：</span><span class="meta-value">{{ reportCode || ' ' }}</span>
      </div>
      <div class="report-meta">
        <span>统计日期：</span><span class="meta-value">{{ reportDateRangeText || ' ' }}</span>
        <span class="meta-gap">仓库：</span><span class="meta-value">{{ reportContext.warehouseLabel || ' ' }}</span>
      </div>
      <div class="report-done">统计完毕，一共：{{ detailRows.length }} 条记录</div>

      <el-skeleton :loading="loading" animated :rows="8">
        <template #default>
          <div class="legacy-table-wrap">
            <el-table
              v-erp-list-h-scroll
              class="legacy-report-table"
              :data="displayRows"
              border
              stripe
              row-key="rowKey"
              empty-text="暂无数据"
              :row-class-name="tableRowClassName"
            >
              <el-table-column
                v-for="col in visibleColumns"
                :key="col.key"
                :prop="col.key"
                :label="col.label"
                :width="col.width"
                :min-width="col.minWidth"
                align="center"
                :class-name="col.isQty ? 'qty-col' : ''"
                :label-class-name="col.isQty ? 'qty-col' : ''"
              >
                <template #default="{ row }">
                  <span>{{ formatReportCell(row, col) }}</span>
                </template>
              </el-table-column>
            </el-table>
          </div>
        </template>
      </el-skeleton>
    </section>

    <el-dialog
      v-model="dialogVisible"
      title="出库统计条件查询"
      width="920px"
      destroy-on-close
      :close-on-click-modal="!loading"
      :close-on-press-escape="!loading"
      :show-close="!loading"
      @closed="onDialogClosed"
    >
      <el-form ref="formRef" :model="form" :rules="rules" label-width="120px" class="query-form">
        <div class="query-tip">选择或输入条件后，请点击确定按钮，系统自动返回条件进行统计显示。</div>
        <div class="query-grid">
          <el-form-item label="统计开始日期" prop="startDate">
            <el-date-picker v-model="form.startDate" type="date" value-format="YYYY-MM-DD" placeholder="请选择开始日期" />
          </el-form-item>
          <el-form-item label="统计结束日期" prop="endDate">
            <el-date-picker v-model="form.endDate" type="date" value-format="YYYY-MM-DD" placeholder="请选择结束日期" />
          </el-form-item>
          <el-form-item label="仓库" prop="warehouseCode">
            <el-select
              v-model="form.warehouseCode"
              filterable
              remote
              reserve-keyword
              :remote-method="fetchWarehouses"
              @focus="fetchWarehouses('')"
              placeholder="请选择仓库"
            >
              <el-option label="全部仓库" :value="ALL_WAREHOUSE" />
              <el-option v-for="item in warehouseOptions" :key="item.code" :label="formatWarehouseLabel(item)" :value="item.code" />
            </el-select>
          </el-form-item>
          <el-form-item label="出库类别">
            <el-select v-model="form.outboundType" clearable placeholder="全部类别">
              <el-option v-for="item in outboundTypeOptions" :key="item.value" :label="item.label" :value="item.value" />
            </el-select>
          </el-form-item>

          <el-form-item label="材料代码">
            <el-select
              v-model="form.materialSystemcode"
              filterable
              remote
              reserve-keyword
              clearable
              :remote-method="fetchMaterials"
              @focus="fetchMaterials('')"
              placeholder="输入材料编码搜索"
            >
              <el-option v-for="item in materialOptions" :key="item.systemcode" :label="formatMaterialLabel(item)" :value="item.systemcode" />
            </el-select>
          </el-form-item>
          <el-form-item label="材料名称">
            <el-input v-model="form.materialName" clearable />
          </el-form-item>
          <el-form-item label="材料规格">
            <el-input v-model="form.materialSpec" clearable />
          </el-form-item>
          <el-form-item label="材料分类">
            <el-select
              v-model="form.materialCategories"
              multiple
              filterable
              remote
              reserve-keyword
              clearable
              collapse-tags
              collapse-tags-tooltip
              :remote-method="fetchCategories"
              @focus="fetchCategories('')"
              placeholder="请选择分类"
            >
              <el-option v-for="item in categoryOptions" :key="item.code" :label="formatCodeName(item)" :value="item.code" />
            </el-select>
          </el-form-item>
          <el-form-item label="关联单位">
            <el-select
              v-model="form.relatedParty"
              filterable
              remote
              reserve-keyword
              clearable
              allow-create
              default-first-option
              :remote-method="fetchRelatedParties"
              @focus="fetchRelatedParties('')"
              placeholder="输入关联单位搜索"
            >
              <el-option v-for="item in relatedPartyOptions" :key="`${item.code}-${item.name}`" :label="formatCodeName(item)" :value="item.code || item.name" />
            </el-select>
          </el-form-item>
        </div>
      </el-form>
      <div v-if="queryProgress.active" class="query-progress-panel">
        <el-progress :percentage="100" :indeterminate="true" :show-text="false" />
        <p class="query-progress-text">正在统计出库明细，已等待 {{ queryProgress.elapsedSec }} 秒。</p>
        <p v-if="queryProgress.elapsedSec >= 15" class="query-progress-hint">查询范围较大，请耐心等待，仍在统计中。</p>
      </div>
      <template #footer>
        <el-button :disabled="loading" @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="loading" @click="submitQuery">确定</el-button>
      </template>
    </el-dialog>

    <section class="print-document" aria-hidden="true">
      <p class="print-time">打印时间：{{ reportGeneratedAt }}</p>
      <header class="report-header print-header">
        <div v-if="printLogoSrc" class="logo-wrap">
          <img class="logo" :src="printLogoSrc" alt="logo" />
        </div>
        <div class="head-info">
          <div v-if="printConfig.info" class="head-info-html" v-html="printConfig.info"></div>
          <div v-else class="head-info-placeholder">请先在打印设定中维护抬头信息</div>
        </div>
      </header>
      <h2 class="report-title">出库统计表</h2>
      <div class="report-meta">
        <span>统计日期：</span><span class="meta-value">{{ reportDateRangeText || ' ' }}</span>
        <span class="meta-gap">仓库：</span><span class="meta-value">{{ reportContext.warehouseLabel || ' ' }}</span>
      </div>
      <table class="print-table">
        <thead>
          <tr>
            <th v-for="col in visibleColumns" :key="`print-head-${col.key}`" :class="{ 'qty-col': col.isQty }">{{ col.label }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in displayRows" :key="`print-${row.rowKey}`" :class="row.rowType ? `print-row-${row.rowType}` : ''">
            <td v-for="col in visibleColumns" :key="`print-${row.rowKey}-${col.key}`" :class="{ 'qty-col': col.isQty }">
              {{ formatReportCell(row, col) }}
            </td>
          </tr>
        </tbody>
      </table>
    </section>
  </div>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'
import axios from 'axios'
import ExcelJS from 'exceljs'
import { getPermissionModelFromStorage, hasPageAction } from '@/utils/menuPermission'

defineOptions({ name: 'InventoryAnalysisStockOutStats' })

const MENU_PATH = 'inventory/analysis/stock-out-stats'
const ALL_WAREHOUSE = '__ALL__'
const REPORT_TITLE = '出库统计表'
const COLUMN_SETTING_KEY = 'erp.stockOutStats.columnSetting.v1'
const EXPORT_THIN_BORDER = {
  top: { style: 'thin', color: { argb: 'FF333333' } },
  left: { style: 'thin', color: { argb: 'FF333333' } },
  bottom: { style: 'thin', color: { argb: 'FF333333' } },
  right: { style: 'thin', color: { argb: 'FF333333' } },
}
const EXPORT_HEADER_FILL = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FFF0F0F0' },
}

const permissionModel = computed(() => getPermissionModelFromStorage())
const hasExportPermission = computed(() => hasPageAction(permissionModel.value, MENU_PATH, 'export'))

const loading = ref(false)
const dialogVisible = ref(false)
const formRef = ref()
const printConfig = reactive({ info: '' })
const printLogoSrc = ref('')
const reportGeneratedAt = ref('')
const reportCode = ref('')
const detailRows = ref([])
const canViewPrice = ref(false)
const reportContext = reactive({ startDate: '', endDate: '', warehouseCode: '', warehouseLabel: '' })
const queryProgress = reactive({ active: false, elapsedSec: 0 })
let queryProgressTimer = null

const form = reactive({
  startDate: '',
  endDate: '',
  warehouseCode: '',
  outboundType: '',
  materialSystemcode: '',
  materialName: '',
  materialSpec: '',
  materialCategories: [],
  relatedParty: '',
})

const rules = {
  startDate: [{ required: true, message: '统计开始日期不能为空', trigger: 'change' }],
  endDate: [{ required: true, message: '统计结束日期不能为空', trigger: 'change' }],
  warehouseCode: [{ required: true, message: '仓库不能为空', trigger: 'change' }],
}

const outboundTypeOptions = [
  { value: '0', label: '0 未知类别' },
  { value: '1', label: '1 采购退货' },
  { value: '2', label: '2 外协出库' },
  { value: '3', label: '3 外协退货' },
  { value: '4', label: '4 未知类别' },
  { value: '5', label: '5 未知类别' },
  { value: '6', label: '6 销售出库' },
  { value: '7', label: '7 生产领料' },
  { value: '8', label: '8 报损' },
  { value: '9', label: '9 盘亏' },
]

const baseColumns = [
  { key: 'auditStatus', label: '状态', width: 80 },
  { key: 'outboundNo', label: '单号', minWidth: 150 },
  { key: 'sourceOrderNo', label: 'PI/关联号', minWidth: 140 },
  { key: 'outboundDate', label: '日期', width: 120, format: 'date' },
  { key: 'outboundTypeLabel', label: '出库类别', width: 110 },
  { key: 'relatedParty', label: '部门/供应商/客户', minWidth: 170 },
  { key: 'materialCode', label: '材料编码', minWidth: 150 },
  { key: 'materialName', label: '材料名称', minWidth: 220 },
  { key: 'materialSpec', label: '材料规格', minWidth: 160 },
  { key: 'unit', label: '单位', width: 70 },
  { key: 'quantity', label: '数量', width: 100, isQty: true, format: 'qty' },
]
const priceColumns = [
  { key: 'unitPrice', label: '单价', width: 100, isQty: true, format: 'money4' },
  { key: 'amount', label: '金额', width: 110, isQty: true, format: 'money2' },
  { key: 'unitPriceTax', label: '单价含税', width: 110, isQty: true, format: 'money4' },
  { key: 'amountTax', label: '金额含税', width: 120, isQty: true, format: 'money2' },
]
const tailColumns = [
  { key: 'remark', label: '备注', minWidth: 200 },
]
const availableColumns = computed(() => [
  ...baseColumns,
  ...(canViewPrice.value ? priceColumns : []),
  ...tailColumns,
])
const defaultColumnKeys = computed(() => availableColumns.value.map((col) => col.key))
const checkedColumnKeys = ref([])
const visibleColumns = computed(() => {
  const selected = new Set(checkedColumnKeys.value.length ? checkedColumnKeys.value : defaultColumnKeys.value)
  return availableColumns.value.filter((col) => selected.has(col.key))
})
const warehouseOptions = ref([])
const materialOptions = ref([])
const categoryOptions = ref([])
const relatedPartyOptions = ref([])

const reportDateRangeText = computed(() => {
  if (!reportContext.startDate && !reportContext.endDate) return ''
  if (reportContext.startDate === reportContext.endDate) return reportContext.startDate
  return `${reportContext.startDate || ''} 至 ${reportContext.endDate || ''}`
})

const displayRows = computed(() => buildDisplayRows(detailRows.value, canViewPrice.value))

function pad2(n) {
  return String(n).padStart(2, '0')
}

function todayText() {
  const d = new Date()
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}

function formatNow() {
  const d = new Date()
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`
}

function makeReportCode() {
  const raw = `${Date.now()}${Math.random().toString(16).slice(2)}`
  return raw.toUpperCase().replace(/[^0-9A-F]/g, '').slice(0, 16)
}

function toNumber(value) {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

function formatQty(value) {
  const n = toNumber(value)
  return n.toFixed(3).replace(/\.?0+$/, '') || '0'
}

function formatMoney(value, digits) {
  const n = toNumber(value)
  return n.toFixed(digits).replace(/\.?0+$/, '') || '0'
}

function formatDate(value) {
  const s = String(value ?? '').trim()
  if (!s) return ''
  return s.slice(0, 10)
}

function normalizeColumnKeys(keys) {
  if (!Array.isArray(keys)) return []
  const allowSet = new Set(availableColumns.value.map((col) => col.key))
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

function sameColumnKeys(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false
  return a.every((key, index) => key === b[index])
}

function loadColumnSetting() {
  try {
    const raw = localStorage.getItem(COLUMN_SETTING_KEY)
    const keys = raw ? normalizeColumnKeys(JSON.parse(raw)) : []
    checkedColumnKeys.value = keys.length ? keys : [...defaultColumnKeys.value]
  } catch {
    checkedColumnKeys.value = [...defaultColumnKeys.value]
  }
}

function persistColumnSetting() {
  try {
    localStorage.setItem(COLUMN_SETTING_KEY, JSON.stringify(checkedColumnKeys.value))
  } catch {
    // 本地列设置失败不影响查询和打印。
  }
}

function onColumnSettingChange(val) {
  const keys = normalizeColumnKeys(val)
  if (!keys.length) {
    ElMessage.warning('至少保留一列')
    checkedColumnKeys.value = [...defaultColumnKeys.value]
    persistColumnSetting()
    return
  }
  checkedColumnKeys.value = keys
  persistColumnSetting()
}

function resetColumnSetting() {
  checkedColumnKeys.value = [...defaultColumnKeys.value]
  persistColumnSetting()
  ElMessage.success('已恢复默认列显示')
}

function formatReportCell(row, col) {
  if (!row || !col) return ''
  if (row.rowType === 'total') {
    if (col.key === 'auditStatus') return row.label
    if (['quantity', 'amount', 'amountTax'].includes(col.key)) return formatReportCellValue(row[col.key], col)
    return ''
  }
  return formatReportCellValue(row[col.key], col)
}

function formatReportCellValue(value, col) {
  if (col.format === 'date') return formatDate(value)
  if (col.format === 'qty') return formatQty(value)
  if (col.format === 'money4') return formatMoney(value, 4)
  if (col.format === 'money2') return formatMoney(value, 2)
  return value ?? ''
}

function buildDisplayRows(rows, withPrice) {
  const out = []
  const totals = createTotals()
  rows.forEach((row, index) => {
    const detail = { ...row, rowKey: row.rowKey || `detail-${index}` }
    out.push(detail)
    addTotals(totals, detail, withPrice)
  })
  if (rows.length) out.push({ rowKey: 'total', rowType: 'total', label: '总计', ...totals })
  return out
}

function createTotals() {
  return { quantity: 0, amount: 0, amountTax: 0 }
}

function addTotals(target, row, withPrice) {
  target.quantity += toNumber(row.quantity)
  if (withPrice) {
    target.amount += toNumber(row.amount)
    target.amountTax += toNumber(row.amountTax)
  }
}

function tableRowClassName({ row }) {
  if (row.rowType === 'total') return 'is-total-row'
  return ''
}

function formatWarehouseLabel(item) {
  return `${String(item?.code ?? '').trim()} ${String(item?.name ?? '').trim()}`.trim()
}

function formatCodeName(item) {
  return `${String(item?.code ?? '').trim()} ${String(item?.name ?? '').trim()}`.trim()
}

function formatMaterialLabel(item) {
  const code = String(item?.code ?? '').trim()
  const name = String(item?.name ?? '').trim()
  const spec = String(item?.spec ?? '').trim()
  return [code, name, spec].filter(Boolean).join(' / ')
}

function pickDefaultWarehouseCode() {
  const rows = warehouseOptions.value
  const exact = rows.find((row) => {
    const code = String(row?.code ?? '').trim()
    const name = String(row?.name ?? '').trim()
    return code === '货仓' || name === '货仓'
  })
  const fuzzy = rows.find((row) => {
    const code = String(row?.code ?? '').trim()
    const name = String(row?.name ?? '').trim()
    return code.includes('货仓') || name.includes('货仓')
  })
  return exact?.code || fuzzy?.code || rows[0]?.code || ALL_WAREHOUSE
}

function currentWarehouseLabel() {
  if (form.warehouseCode === ALL_WAREHOUSE) return '全部仓库'
  const hit = warehouseOptions.value.find((row) => String(row.code ?? '').trim() === String(form.warehouseCode ?? '').trim())
  return hit ? formatWarehouseLabel(hit) : form.warehouseCode || ''
}

async function loadPrintConfig() {
  try {
    const { data } = await axios.get('/api/stock-out-stats/print-header')
    const cfg = data?.data ?? {}
    printConfig.info = cfg.headerHtml || cfg.info || ''
    printLogoSrc.value = cfg.logoSrc || ''
  } catch {
    // 抬头读取失败不影响报表查询。
  }
}

async function fetchWarehouses(keyword = '') {
  try {
    const { data } = await axios.get('/api/stock-out-stats/warehouse-options', { params: { keyword } })
    warehouseOptions.value = Array.isArray(data?.data?.list) ? data.data.list : []
  } catch {
    warehouseOptions.value = []
  }
}

async function fetchMaterials(keyword = '') {
  try {
    const { data } = await axios.get('/api/stock-out-stats/material-options', { params: { keyword } })
    materialOptions.value = Array.isArray(data?.data?.list) ? data.data.list : []
  } catch {
    materialOptions.value = []
  }
}

async function fetchCategories(keyword = '') {
  try {
    const { data } = await axios.get('/api/stock-out-stats/category-options', { params: { keyword } })
    categoryOptions.value = Array.isArray(data?.data?.list) ? data.data.list : []
  } catch {
    categoryOptions.value = []
  }
}

async function fetchRelatedParties(keyword = '') {
  try {
    const { data } = await axios.get('/api/stock-out-stats/related-party-options', { params: { keyword } })
    relatedPartyOptions.value = Array.isArray(data?.data?.list) ? data.data.list : []
  } catch {
    relatedPartyOptions.value = []
  }
}

function openQueryDialog() {
  if (!form.warehouseCode) form.warehouseCode = pickDefaultWarehouseCode()
  dialogVisible.value = true
}

function stopQueryProgressTimer() {
  if (queryProgressTimer != null) {
    clearInterval(queryProgressTimer)
    queryProgressTimer = null
  }
  queryProgress.active = false
}

function startQueryProgressTimer() {
  stopQueryProgressTimer()
  queryProgress.active = true
  queryProgress.elapsedSec = 0
  queryProgressTimer = setInterval(() => {
    queryProgress.elapsedSec += 1
  }, 1000)
}

async function loadReport() {
  const formInst = formRef.value
  if (formInst) {
    try {
      await formInst.validate()
    } catch {
      return
    }
  }
  loading.value = true
  startQueryProgressTimer()
  try {
    const wasDefaultColumns = sameColumnKeys(checkedColumnKeys.value, defaultColumnKeys.value)
    const params = {
      startDate: form.startDate,
      endDate: form.endDate,
      warehouseCode: form.warehouseCode,
      outboundType: form.outboundType,
      materialSystemcode: form.materialSystemcode,
      materialName: form.materialName,
      materialSpec: form.materialSpec,
      materialCategories: form.materialCategories.join(','),
      relatedParty: form.relatedParty,
    }
    const { data } = await axios.get('/api/stock-out-stats/report', { params, timeout: 180000 })
    const body = data?.data ?? {}
    canViewPrice.value = body.canViewPrice === true
    detailRows.value = Array.isArray(body.list) ? body.list : []
    reportContext.startDate = body.startDate || form.startDate
    reportContext.endDate = body.endDate || form.endDate
    reportContext.warehouseCode = body.warehouseCode || form.warehouseCode
    reportContext.warehouseLabel = body.allWarehouse ? '全部仓库' : currentWarehouseLabel()
    reportGeneratedAt.value = formatNow()
    reportCode.value = makeReportCode()
    checkedColumnKeys.value = wasDefaultColumns ? [...defaultColumnKeys.value] : normalizeColumnKeys(checkedColumnKeys.value)
    if (!checkedColumnKeys.value.length) checkedColumnKeys.value = [...defaultColumnKeys.value]
    dialogVisible.value = false
    ElMessage.success('统计完成')
  } catch (e) {
    ElMessage.error(String(e?.response?.data?.msg ?? e?.message ?? '读取出库统计表失败'))
  } finally {
    loading.value = false
    stopQueryProgressTimer()
  }
}

function submitQuery() {
  loadReport()
}

function onDialogClosed() {
  formRef.value?.clearValidate?.()
  stopQueryProgressTimer()
}

function onPrint() {
  if (!detailRows.value.length) {
    ElMessage.warning('暂无数据可打印')
    return
  }
  window.print()
}

function exportFileName() {
  const date = reportDateRangeText.value || `${form.startDate}-${form.endDate}` || '未查询'
  const warehouse = reportContext.warehouseLabel || currentWarehouseLabel() || '全部仓库'
  const safe = `${REPORT_TITLE}-${date}-${warehouse}`.replace(/[\\/:*?"<>|]/g, '_').slice(0, 160)
  return `${safe || REPORT_TITLE}.xlsx`
}

function styleExportRow(row, opts = {}) {
  row.eachCell((cell) => {
    cell.border = EXPORT_THIN_BORDER
    cell.alignment = { horizontal: opts.horizontal || 'center', vertical: 'middle', wrapText: true }
    if (opts.bold) cell.font = { ...(cell.font || {}), bold: true }
    if (opts.fill) cell.fill = opts.fill
  })
}

function addExportMetaRow(ws, leftText, rightText, colCount) {
  const row = ws.addRow([leftText, rightText])
  if (colCount > 1) {
    const splitCol = Math.max(1, Math.floor(colCount / 2))
    ws.mergeCells(row.number, 1, row.number, splitCol)
    ws.mergeCells(row.number, splitCol + 1, row.number, colCount)
  }
  return row
}

async function exportReportXlsx() {
  if (!hasExportPermission.value) {
    ElMessage.warning('没有导出权限')
    return
  }
  if (!detailRows.value.length) {
    ElMessage.warning('暂无数据可导出')
    return
  }
  const columns = visibleColumns.value
  if (!columns.length) {
    ElMessage.warning('至少保留一列后再导出')
    return
  }
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet(REPORT_TITLE, {
    views: [{ state: 'frozen', ySplit: 5 }],
    pageSetup: { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  })
  const colCount = columns.length
  const titleRow = ws.addRow([REPORT_TITLE])
  ws.mergeCells(titleRow.number, 1, titleRow.number, colCount)
  titleRow.font = { bold: true, size: 14 }
  ws.getCell(titleRow.number, 1).alignment = { horizontal: 'center', vertical: 'middle' }
  addExportMetaRow(ws, `报表生成时间：${reportGeneratedAt.value || ''}`, `报表代码：${reportCode.value || ''}`, colCount)
  addExportMetaRow(ws, `统计日期：${reportDateRangeText.value || ''}`, `仓库：${reportContext.warehouseLabel || ''}`, colCount)
  const countRow = ws.addRow([`统计完毕，一共：${detailRows.value.length} 条记录`])
  ws.mergeCells(countRow.number, 1, countRow.number, colCount)
  ws.addRow([])
  const headRow = ws.addRow(columns.map((col) => col.label))
  styleExportRow(headRow, { bold: true, fill: EXPORT_HEADER_FILL })
  for (const row of displayRows.value) {
    const added = ws.addRow(columns.map((col) => formatReportCell(row, col)))
    styleExportRow(added, { bold: row.rowType === 'total' })
  }
  ws.columns.forEach((col, index) => {
    const reportCol = columns[index]
    col.width = Math.max(10, Math.min(36, Math.round((reportCol?.width || reportCol?.minWidth || 120) / 8)))
  })
  const buf = await wb.xlsx.writeBuffer()
  const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = exportFileName()
  a.click()
  URL.revokeObjectURL(url)
  ElMessage.success('已导出 xlsx')
}

onBeforeUnmount(() => {
  stopQueryProgressTimer()
})

onMounted(async () => {
  await Promise.all([loadPrintConfig(), fetchWarehouses(''), fetchMaterials(''), fetchCategories(''), fetchRelatedParties('')])
  const today = todayText()
  form.startDate = today
  form.endDate = today
  form.warehouseCode = pickDefaultWarehouseCode()
  checkedColumnKeys.value = [...defaultColumnKeys.value]
  loadColumnSetting()
})
</script>

<style scoped>
.stock-out-stats-page {
  min-height: calc(100vh - 118px);
  padding: 8px;
  background: #f5f7fb;
}

.stock-toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 8px;
}

.report-shell {
  min-height: calc(100vh - 170px);
  padding: 18px 40px 48px;
  background: #fff;
  color: #000;
}

.report-header {
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  text-align: center;
}

.logo-wrap {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
}

.logo {
  max-width: 260px;
  max-height: 48px;
  object-fit: contain;
}

.head-info {
  width: 100%;
  font-size: 14px;
  line-height: 1.3;
  text-align: center;
  color: #000;
}

.head-info-placeholder {
  color: #999;
}

.head-info-html :deep(*) {
  margin-top: 0;
  margin-bottom: 0;
}

.report-title {
  margin: 4px 0 6px;
  text-align: center;
  font-size: 20px;
  font-weight: 700;
}

.report-meta {
  margin: 2px 0;
  font-size: 13px;
}

.meta-value {
  display: inline-block;
  min-width: 150px;
  font-weight: 600;
}

.meta-gap {
  margin-left: 20px;
}

.report-done {
  margin: 10px 0 4px;
  padding: 2px 8px;
  color: red;
  background: #f0f0f0;
  font-size: 13px;
}

.legacy-table-wrap {
  width: 100%;
  overflow: hidden;
}

.legacy-report-table {
  width: 100%;
  font-size: 12px;
}

.legacy-report-table :deep(.el-table__cell) {
  padding: 2px 0;
  color: #000;
}

.legacy-report-table :deep(.qty-col .cell) {
  font-weight: 600;
}

.legacy-report-table :deep(.is-total-row td) {
  background: #f4f4f4 !important;
  font-weight: 700;
}

.column-setting-title {
  margin-bottom: 8px;
  color: #606266;
  font-size: 13px;
}

.column-setting-panel :deep(.el-checkbox) {
  display: block;
  margin-right: 0;
  height: 26px;
}

.column-setting-actions {
  margin-top: 8px;
  text-align: right;
}

.query-form {
  padding-right: 12px;
}

.query-tip {
  margin-bottom: 16px;
  color: #909399;
}

.query-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  column-gap: 36px;
}

.query-grid :deep(.el-date-editor),
.query-grid :deep(.el-select),
.query-grid :deep(.el-input-number) {
  width: 100%;
}

.query-progress-panel {
  margin-top: 12px;
  padding: 10px 12px;
  border-radius: 8px;
  background: #f5f7fa;
}

.query-progress-text,
.query-progress-hint {
  margin: 6px 0 0;
  color: #606266;
  font-size: 13px;
}

.query-progress-hint {
  color: #e6a23c;
}

.print-document {
  display: none;
}

.print-time {
  margin: 0 0 4px;
  font-size: 12px;
}

.print-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 11px;
}

.print-table th,
.print-table td {
  border: 1px solid #333;
  padding: 3px 4px;
  text-align: center;
  word-break: break-all;
}

.print-row-total {
  font-weight: 700;
  background: #eee;
}

@media print {
  @page {
    size: A4 landscape;
    margin: 10mm;
  }

  .stock-out-stats-page {
    padding: 0;
    background: #fff;
  }

  .no-print,
  .report-shell {
    display: none !important;
  }

  .print-document {
    display: block;
    color: #000;
  }
}

@media (max-width: 900px) {
  .report-shell {
    padding: 14px;
  }

  .query-grid {
    grid-template-columns: 1fr;
    column-gap: 0;
  }
}
</style>
