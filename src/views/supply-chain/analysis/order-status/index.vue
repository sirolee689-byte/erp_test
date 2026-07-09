<template>
  <div class="erp-module-page purchase-status-page">
    <div class="report-toolbar no-print">
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

      <h2 class="report-title">{{ REPORT_TITLE }}</h2>

      <div class="report-meta">
        <span>报表生成时间：</span><span class="meta-value">{{ reportGeneratedAt || ' ' }}</span>
        <span class="meta-gap">报表代码：</span><span class="meta-value">{{ reportCode || ' ' }}</span>
      </div>
      <div class="report-meta">
        <span>查询日期：</span><span class="meta-value">{{ reportDateRangeText || ' ' }}</span>
        <span class="meta-gap">供应商：</span><span class="meta-value">{{ reportContext.supplierLabel || '全部' }}</span>
      </div>
      <div class="report-meta">
        <span>采购单号：</span><span class="meta-value">{{ reportContext.purchaseNo || '全部' }}</span>
        <span class="meta-gap">材料：</span><span class="meta-value">{{ materialContextText }}</span>
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
                  <span :class="{ 'negative-diff': col.key === 'differenceQty' && Number(row.differenceQty) < 0 }">
                    {{ formatReportCell(row, col) }}
                  </span>
                </template>
              </el-table-column>
            </el-table>
          </div>
        </template>
      </el-skeleton>
    </section>

    <el-dialog
      v-model="dialogVisible"
      title="采购订单情况查询"
      width="920px"
      destroy-on-close
      :close-on-click-modal="!loading"
      :close-on-press-escape="!loading"
      :show-close="!loading"
      @closed="onDialogClosed"
    >
      <el-form ref="formRef" :model="form" :rules="rules" label-width="130px" class="query-form">
        <div class="query-tip">选择或输入条件后，点击确定，系统统计采购订单执行情况。</div>
        <div class="query-grid">
          <el-form-item label="查询开始日期" prop="startDate">
            <el-date-picker v-model="form.startDate" type="date" value-format="YYYY-MM-DD" placeholder="请选择开始日期" />
          </el-form-item>
          <el-form-item label="查询结束日期" prop="endDate">
            <el-date-picker v-model="form.endDate" type="date" value-format="YYYY-MM-DD" placeholder="请选择结束日期" />
          </el-form-item>
          <el-form-item label="供应商">
            <el-select
              v-model="form.supplierCode"
              filterable
              remote
              reserve-keyword
              clearable
              :remote-method="fetchSuppliers"
              @focus="fetchSuppliers('')"
              @change="onSupplierChange"
              placeholder="请选择供应商"
            >
              <el-option v-for="item in supplierOptions" :key="item.code" :label="formatCodeName(item)" :value="item.code" />
            </el-select>
          </el-form-item>
          <el-form-item label="采购单号">
            <el-input v-model="form.purchaseNo" clearable placeholder="可手动输入采购单号" />
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
              @change="onMaterialChange"
              placeholder="输入材料代码搜索"
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
          <el-form-item label="包含未结案">
            <el-select v-model="form.includeUnclosed">
              <el-option label="是" value="1" />
              <el-option label="否" value="0" />
            </el-select>
          </el-form-item>
          <el-form-item label="只显示送货相差数">
            <el-select v-model="form.onlyDifference">
              <el-option label="否" value="0" />
              <el-option label="是" value="1" />
            </el-select>
          </el-form-item>
        </div>
      </el-form>
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
      <h2 class="report-title">{{ REPORT_TITLE }}</h2>
      <div class="report-meta">
        <span>查询日期：</span><span class="meta-value">{{ reportDateRangeText || ' ' }}</span>
        <span class="meta-gap">供应商：</span><span class="meta-value">{{ reportContext.supplierLabel || '全部' }}</span>
      </div>
      <table class="print-table">
        <thead>
          <tr>
            <th v-for="col in visibleColumns" :key="`print-head-${col.key}`">{{ col.label }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in displayRows" :key="`print-${row.rowKey}`" :class="row.rowType ? `print-row-${row.rowType}` : ''">
            <td v-for="col in visibleColumns" :key="`print-${row.rowKey}-${col.key}`">
              {{ formatReportCell(row, col) }}
            </td>
          </tr>
        </tbody>
      </table>
    </section>
  </div>
</template>

<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'
import axios from 'axios'
import ExcelJS from 'exceljs'
import {
  formatErpMoneyDisplay,
  formatErpQtyDisplay,
} from '@/utils/erpNumberDisplay'
import { getPermissionModelFromStorage, hasPageAction } from '@/utils/menuPermission'

defineOptions({ name: 'SupplyChainAnalysisOrderStatus' })

const MENU_PATH = 'supply-chain/analysis/order-status'
const REPORT_TITLE = '采购订单情况表'
const COLUMN_SETTING_KEY = 'erp.purchaseOrderStatus.columnSetting.v1'
const EXPORT_THIN_BORDER = {
  top: { style: 'thin', color: { argb: 'FF333333' } },
  left: { style: 'thin', color: { argb: 'FF333333' } },
  bottom: { style: 'thin', color: { argb: 'FF333333' } },
  right: { style: 'thin', color: { argb: 'FF333333' } },
}
const EXPORT_HEADER_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF0F0F0' } }

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
const canViewAmount = ref(false)
const supplierOptions = ref([])
const materialOptions = ref([])

const reportContext = reactive({
  startDate: '',
  endDate: '',
  supplierCode: '',
  supplierLabel: '',
  purchaseNo: '',
  materialCode: '',
  materialName: '',
  materialSpec: '',
})

const form = reactive({
  startDate: '',
  endDate: '',
  supplierCode: '',
  purchaseNo: '',
  materialSystemcode: '',
  materialCode: '',
  materialName: '',
  materialSpec: '',
  includeUnclosed: '1',
  onlyDifference: '0',
})

const dateOrderValidator = (_rule, _value, callback) => {
  if (form.startDate && form.endDate && form.startDate > form.endDate) callback(new Error('查询开始日期不能大于查询结束日期'))
  else callback()
}
const rules = {
  startDate: [
    { required: true, message: '查询开始日期不能为空', trigger: 'change' },
    { validator: dateOrderValidator, trigger: 'change' },
  ],
  endDate: [
    { required: true, message: '查询结束日期不能为空', trigger: 'change' },
    { validator: dateOrderValidator, trigger: 'change' },
  ],
}

const baseColumns = [
  { key: 'supplier', label: '供应商', minWidth: 170 },
  { key: 'purchaseNoDisplay', label: '采购单号', minWidth: 150 },
  { key: 'purchaseDate', label: '采购日期', width: 110, format: 'date' },
  { key: 'deliveryDate', label: '交货日期', width: 110, format: 'date' },
  { key: 'piNo', label: 'PI号', minWidth: 130 },
  { key: 'materialCode', label: '材料编码', minWidth: 150 },
  { key: 'materialName', label: '材料名称', minWidth: 220 },
  { key: 'materialSpec', label: '规格', minWidth: 160 },
  { key: 'colorName', label: '颜色', minWidth: 110 },
  { key: 'unit', label: '转使用单位', width: 100 },
  { key: 'purchaseQty', label: '采购数量', width: 110, isQty: true, format: 'qty' },
  { key: 'pendingInboundQty', label: '入库未审数量', width: 120, isQty: true, format: 'qty' },
  { key: 'inboundQty', label: '入库数量', width: 110, isQty: true, format: 'qty' },
]
const amountColumns = [
  { key: 'inboundAmount', label: '入库金额', width: 120, isQty: true, format: 'money' },
]
const tailColumns = [
  { key: 'returnQty', label: '退货数量', width: 110, isQty: true, format: 'qty' },
  { key: 'differenceQty', label: '差数', width: 110, isQty: true, format: 'qty' },
  { key: 'warning', label: '异常提示', minWidth: 220 },
]
const availableColumns = computed(() => [...baseColumns, ...(canViewAmount.value ? amountColumns : []), ...tailColumns])
const defaultColumnKeys = computed(() => availableColumns.value.map((col) => col.key))
const checkedColumnKeys = ref([])
const visibleColumns = computed(() => {
  const selected = new Set(checkedColumnKeys.value.length ? checkedColumnKeys.value : defaultColumnKeys.value)
  return availableColumns.value.filter((col) => selected.has(col.key))
})

const reportDateRangeText = computed(() => {
  if (!reportContext.startDate && !reportContext.endDate) return ''
  if (reportContext.startDate === reportContext.endDate) return reportContext.startDate
  return `${reportContext.startDate || ''} 至 ${reportContext.endDate || ''}`
})
const materialContextText = computed(() => {
  const parts = [reportContext.materialCode, reportContext.materialName, reportContext.materialSpec].filter(Boolean)
  return parts.length ? parts.join(' / ') : '全部'
})
const displayRows = computed(() => buildDisplayRows(detailRows.value, canViewAmount.value))

function pad2(n) {
  return String(n).padStart(2, '0')
}
function todayText() {
  const d = new Date()
  return dateTextFromDate(d)
}
function dateTextFromDate(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}
function monthOffsetDateText(offset) {
  const now = new Date()
  const firstOfTargetMonth = new Date(now.getFullYear(), now.getMonth() + offset, 1)
  const lastDay = new Date(firstOfTargetMonth.getFullYear(), firstOfTargetMonth.getMonth() + 1, 0).getDate()
  const day = Math.min(now.getDate(), lastDay)
  return dateTextFromDate(new Date(firstOfTargetMonth.getFullYear(), firstOfTargetMonth.getMonth(), day))
}
function formatNow() {
  const d = new Date()
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`
}
function makeReportCode() {
  return `${Date.now()}${Math.random().toString(16).slice(2)}`.toUpperCase().replace(/[^0-9A-F]/g, '').slice(0, 16)
}
function formatDate(value) {
  return String(value ?? '').trim().replace('T', ' ').slice(0, 10)
}
function formatReportCellValue(value, col) {
  if (col.format === 'date') return formatDate(value)
  if (col.format === 'qty') return formatErpQtyDisplay(value)
  if (col.format === 'money') return formatErpMoneyDisplay(value)
  return value ?? ''
}
function formatReportCell(row, col) {
  if (row.rowType === 'group') return col.key === 'supplier' ? row.label : ''
  if (row.rowType === 'total') {
    if (col.key === 'supplier') return row.label
    if (['purchaseQty', 'pendingInboundQty', 'inboundQty', 'inboundAmount', 'returnQty', 'differenceQty'].includes(col.key)) return formatReportCellValue(row[col.key], col)
    return ''
  }
  return formatReportCellValue(row[col.key], col)
}
function toNumber(value) {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}
function createTotals() {
  return { purchaseQty: 0, pendingInboundQty: 0, inboundQty: 0, inboundAmount: 0, returnQty: 0, differenceQty: 0 }
}
function addTotals(target, row, withAmount) {
  target.purchaseQty += toNumber(row.purchaseQty)
  target.pendingInboundQty += toNumber(row.pendingInboundQty)
  target.inboundQty += toNumber(row.inboundQty)
  target.returnQty += toNumber(row.returnQty)
  target.differenceQty += toNumber(row.differenceQty)
  if (withAmount) target.inboundAmount += toNumber(row.inboundAmount)
}
function buildDisplayRows(rows, withAmount) {
  const out = []
  const total = createTotals()
  for (const row of rows) {
    out.push(row)
    addTotals(total, row, withAmount)
  }
  if (rows.length) out.push({ rowKey: 'total', rowType: 'total', label: '总计', ...total })
  return out
}
function tableRowClassName({ row }) {
  if (row.rowType === 'group') return 'is-group-row'
  if (row.rowType === 'total') return 'is-total-row'
  if (Number(row.differenceQty) < 0) return 'is-negative-diff-row'
  return ''
}
function formatCodeName(item) {
  return `${String(item?.code ?? '').trim()} ${String(item?.name ?? '').trim()}`.trim()
}
function formatMaterialLabel(item) {
  return [item?.code, item?.name, item?.spec].map((v) => String(v ?? '').trim()).filter(Boolean).join(' / ')
}
function currentSupplierLabel() {
  const hit = supplierOptions.value.find((row) => String(row.code ?? '').trim() === String(form.supplierCode ?? '').trim())
  return hit ? formatCodeName(hit) : form.supplierCode || ''
}
function onSupplierChange() {}
function onMaterialChange(systemcode) {
  const hit = materialOptions.value.find((row) => String(row.systemcode ?? '').trim() === String(systemcode ?? '').trim())
  if (!hit) {
    if (!systemcode) form.materialCode = ''
    return
  }
  form.materialCode = String(hit.code ?? '').trim()
  form.materialName = String(hit.name ?? '').trim()
  form.materialSpec = String(hit.spec ?? '').trim()
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
  return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((key, index) => key === b[index])
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
  } else {
    checkedColumnKeys.value = keys
  }
  persistColumnSetting()
}
function resetColumnSetting() {
  checkedColumnKeys.value = [...defaultColumnKeys.value]
  persistColumnSetting()
  ElMessage.success('已恢复默认列显示')
}
async function loadPrintConfig() {
  try {
    const { data } = await axios.get('/api/purchase-order-status/print-header')
    const cfg = data?.data ?? {}
    printConfig.info = cfg.headerHtml || cfg.info || ''
    printLogoSrc.value = cfg.logoSrc || ''
  } catch {
    // 抬头读取失败不影响报表查询。
  }
}
async function fetchSuppliers(keyword = '') {
  try {
    const { data } = await axios.get('/api/purchase-order-status/supplier-options', { params: { keyword } })
    supplierOptions.value = Array.isArray(data?.data?.list) ? data.data.list : []
  } catch {
    supplierOptions.value = []
  }
}
async function fetchMaterials(keyword = '') {
  try {
    const { data } = await axios.get('/api/purchase-order-status/material-options', { params: { keyword } })
    materialOptions.value = Array.isArray(data?.data?.list) ? data.data.list : []
  } catch {
    materialOptions.value = []
  }
}
function openQueryDialog() {
  dialogVisible.value = true
}
function onDialogClosed() {
  formRef.value?.clearValidate?.()
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
  try {
    const wasDefaultColumns = sameColumnKeys(checkedColumnKeys.value, defaultColumnKeys.value)
    const params = { ...form }
    const { data } = await axios.get('/api/purchase-order-status/report', { params, timeout: 180000 })
    const body = data?.data ?? {}
    canViewAmount.value = body.canViewAmount === true
    detailRows.value = Array.isArray(body.list) ? body.list : []
    reportContext.startDate = body.startDate || form.startDate
    reportContext.endDate = body.endDate || form.endDate
    reportContext.supplierCode = body.supplierCode || form.supplierCode
    reportContext.supplierLabel = currentSupplierLabel()
    reportContext.purchaseNo = body.purchaseNo || form.purchaseNo
    reportContext.materialCode = body.materialCode || form.materialCode
    reportContext.materialName = body.materialName || form.materialName
    reportContext.materialSpec = body.materialSpec || form.materialSpec
    reportGeneratedAt.value = formatNow()
    reportCode.value = makeReportCode()
    checkedColumnKeys.value = wasDefaultColumns ? [...defaultColumnKeys.value] : normalizeColumnKeys(checkedColumnKeys.value)
    if (!checkedColumnKeys.value.length) checkedColumnKeys.value = [...defaultColumnKeys.value]
    dialogVisible.value = false
    ElMessage.success('统计完成')
  } catch (e) {
    ElMessage.error(String(e?.response?.data?.msg ?? e?.message ?? '读取采购订单情况表失败'))
  } finally {
    loading.value = false
  }
}
function submitQuery() {
  loadReport()
}
function onPrint() {
  if (!detailRows.value.length) {
    ElMessage.warning('暂无数据可打印')
    return
  }
  window.print()
}
function exportFileName() {
  const safe = `${REPORT_TITLE}-${reportDateRangeText.value || '未查询'}`.replace(/[\\/:*?"<>|]/g, '_').slice(0, 160)
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
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet(REPORT_TITLE, { views: [{ state: 'frozen', ySplit: 6 }] })
  const colCount = columns.length
  const titleRow = ws.addRow([REPORT_TITLE])
  ws.mergeCells(titleRow.number, 1, titleRow.number, colCount)
  titleRow.font = { bold: true, size: 14 }
  ws.getCell(titleRow.number, 1).alignment = { horizontal: 'center', vertical: 'middle' }
  addExportMetaRow(ws, `报表生成时间：${reportGeneratedAt.value || ''}`, `报表代码：${reportCode.value || ''}`, colCount)
  addExportMetaRow(ws, `查询日期：${reportDateRangeText.value || ''}`, `供应商：${reportContext.supplierLabel || '全部'}`, colCount)
  addExportMetaRow(ws, `采购单号：${reportContext.purchaseNo || '全部'}`, `材料：${materialContextText.value}`, colCount)
  const countRow = ws.addRow([`统计完毕，一共：${detailRows.value.length} 条记录`])
  ws.mergeCells(countRow.number, 1, countRow.number, colCount)
  ws.addRow([])
  const headRow = ws.addRow(columns.map((col) => col.label))
  styleExportRow(headRow, { bold: true, fill: EXPORT_HEADER_FILL })
  for (const row of displayRows.value) {
    const added = ws.addRow(columns.map((col) => formatReportCell(row, col)))
    styleExportRow(added, { bold: row.rowType === 'group' || row.rowType === 'total' })
  }
  ws.columns.forEach((col, index) => {
    const reportCol = columns[index]
    col.width = Math.max(10, Math.min(46, Math.round((reportCol?.width || reportCol?.minWidth || 120) / 8)))
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
onMounted(async () => {
  await Promise.all([loadPrintConfig(), fetchSuppliers(''), fetchMaterials('')])
  const today = todayText()
  form.startDate = monthOffsetDateText(-3)
  form.endDate = today
  checkedColumnKeys.value = [...defaultColumnKeys.value]
  loadColumnSetting()
})
</script>

<style scoped>
.purchase-status-page {
  min-height: calc(100vh - 118px);
  padding: 8px;
  background: #f5f7fb;
}
.report-toolbar {
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
  align-items: center;
  text-align: center;
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
  min-width: 120px;
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
  overflow-x: auto;
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
.legacy-report-table :deep(.is-group-row td),
.legacy-report-table :deep(.is-total-row td) {
  background: #f4f4f4 !important;
  font-weight: 700;
}
.legacy-report-table :deep(.is-negative-diff-row td) {
  background: #fff1f0 !important;
}
.negative-diff {
  color: #d93025;
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
.query-grid :deep(.el-select) {
  width: 100%;
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
  font-size: 10px;
}
.print-table th,
.print-table td {
  border: 1px solid #333;
  padding: 3px 4px;
  text-align: center;
  word-break: break-all;
}
.print-row-group,
.print-row-total {
  font-weight: 700;
  background: #eee;
}
@media print {
  @page {
    size: A4 landscape;
    margin: 10mm;
  }
  .purchase-status-page {
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
