<template>
  <div class="erp-module-page history-price-page">
    <div class="report-toolbar no-print">
      <el-button type="primary" @click="onPrint">打印统计报表</el-button>
      <el-button type="primary" @click="openQueryDialog">查询内容</el-button>
      <el-popover placement="bottom-start" trigger="click" width="320">
        <template #reference>
          <el-button>列设置</el-button>
        </template>
        <div class="column-setting-panel">
          <div class="column-setting-title">勾选要显示的列（页面、打印、导出同步）</div>
          <el-checkbox-group v-model="checkedColumnKeys" @change="saveColumnSetting">
            <el-checkbox v-for="col in allColumns" :key="col.key" :label="col.key">{{ col.label }}</el-checkbox>
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
        <span>物料编码：</span><span class="meta-value">{{ reportContext.materialCode || ' ' }}</span>
        <span class="meta-gap">物料：</span><span class="meta-value">{{ materialContextText }}</span>
      </div>
      <div class="report-done">统计完毕，一共：{{ reportRows.length }} 个物料</div>

      <el-skeleton :loading="loading" animated :rows="8">
        <template #default>
          <div class="legacy-table-wrap">
            <el-table
              ref="reportTableRef"
              v-erp-list-h-scroll
              class="legacy-report-table"
              :data="reportRows"
              border
              stripe
              row-key="rowKey"
              empty-text="暂无数据"
              @row-click="onReportRowClick"
            >
              <el-table-column type="expand" width="1">
                <template #default="{ row }">
                  <div class="price-history-panel" @click.stop>
                    <el-table
                      v-if="row.prices.length"
                      class="price-history-table"
                      :data="row.prices"
                      border
                      size="small"
                    >
                      <el-table-column
                        v-for="col in visiblePriceColumns"
                        :key="`price-${col.key}`"
                        :prop="col.key"
                        :label="col.label"
                        :width="col.width"
                        :min-width="col.minWidth"
                        align="center"
                      >
                        <template #default="{ row: priceRow }">{{ formatPriceCell(priceRow, col) }}</template>
                      </el-table-column>
                    </el-table>
                    <el-empty v-else description="无历史价格" :image-size="68" />
                  </div>
                </template>
              </el-table-column>
              <el-table-column
                v-for="col in visibleMaterialColumns"
                :key="col.key"
                :prop="col.key"
                :label="col.label"
                :width="col.width"
                :min-width="col.minWidth"
                align="center"
              >
                <template #default="{ row }">{{ formatMaterialCell(row, col) }}</template>
              </el-table-column>
            </el-table>
          </div>
        </template>
      </el-skeleton>
    </section>

    <el-dialog
      v-model="dialogVisible"
      title="历史价格查询"
      width="900px"
      destroy-on-close
      :close-on-click-modal="!loading"
      :close-on-press-escape="!loading"
      :show-close="!loading"
    >
      <el-form ref="formRef" :model="form" :rules="rules" label-width="130px" class="query-form">
        <div class="query-tip">选择或输入条件后，点击确定，系统查询物料的报价和采购历史价格。</div>
        <div class="query-grid">
          <el-form-item label="开始日期" prop="startDate">
            <el-date-picker v-model="form.startDate" type="date" value-format="YYYY-MM-DD" placeholder="请选择开始日期" />
          </el-form-item>
          <el-form-item label="结束日期" prop="endDate">
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
          <el-form-item label="只显示有价格">
            <el-select v-model="form.onlyWithPrice">
              <el-option label="是" value="1" />
              <el-option label="否" value="0" />
            </el-select>
          </el-form-item>
          <el-form-item label="物料编码" prop="materialCode">
            <el-select
              v-model="form.materialCode"
              filterable
              remote
              reserve-keyword
              clearable
              allow-create
              default-first-option
              :remote-method="fetchMaterials"
              @focus="fetchMaterials(form.materialCode)"
              @change="onMaterialChange"
              placeholder="输入物料编码搜索"
            >
              <el-option v-for="item in materialOptions" :key="item.code" :label="item.code" :value="item.code" />
            </el-select>
          </el-form-item>
          <el-form-item label="物料名称">
            <el-input v-model="form.materialName" clearable />
          </el-form-item>
          <el-form-item label="规格">
            <el-input v-model="form.materialSpec" clearable />
          </el-form-item>
        </div>
      </el-form>
      <template #footer>
        <el-button :disabled="loading" @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="loading" @click="submitQuery">确定</el-button>
      </template>
    </el-dialog>

    <Teleport to="body">
      <div v-show="queryProgress.active" class="history-price-query-progress-overlay no-print">
        <div class="query-progress-panel" aria-live="polite">
          <div class="query-progress-head">
            <el-icon class="query-progress-spinner" aria-hidden="true"><Loading /></el-icon>
            <span>{{ queryProgress.rendering ? '正在渲染价格历史' : '正在查询历史价格' }}</span>
          </div>
          <div class="query-progress-bar" aria-hidden="true">
            <div class="query-progress-bar-inner"></div>
            <div class="query-progress-bar-inner query-progress-bar-inner--delay"></div>
          </div>
          <p class="query-progress-text">
            已等待 <span class="query-progress-elapsed">{{ queryProgress.elapsedText }}</span> 秒
            <span class="query-progress-dots" aria-hidden="true"><i></i><i></i><i></i></span>
          </p>
          <p class="query-progress-hint">历史价格查询会合并报价和采购记录，请耐心等待</p>
          <p v-if="queryProgress.elapsed >= 6" class="query-progress-alive-hint">后台仍在查询，界面未卡死</p>
        </div>
      </div>
    </Teleport>

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
      <div v-for="row in reportRows" :key="`print-${row.rowKey}`" class="print-material-block">
        <table class="print-table">
          <tbody>
            <tr>
              <th v-for="col in visibleMaterialColumns" :key="`pmh-${row.rowKey}-${col.key}`">{{ col.label }}</th>
            </tr>
            <tr>
              <td v-for="col in visibleMaterialColumns" :key="`pm-${row.rowKey}-${col.key}`">{{ formatMaterialCell(row, col) }}</td>
            </tr>
          </tbody>
        </table>
        <table class="print-table price-print-table">
          <thead>
            <tr>
              <th v-for="col in visiblePriceColumns" :key="`pph-${row.rowKey}-${col.key}`">{{ col.label }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="!row.prices.length">
              <td :colspan="visiblePriceColumns.length || 1">无历史价格</td>
            </tr>
            <tr v-for="priceRow in row.prices" :key="`pp-${priceRow.rowKey}`">
              <td v-for="col in visiblePriceColumns" :key="`pp-${priceRow.rowKey}-${col.key}`">{{ formatPriceCell(priceRow, col) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  </div>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { Loading } from '@element-plus/icons-vue'
import axios from 'axios'
import ExcelJS from 'exceljs'
import {
  formatErpPriceDisplay,
  formatErpQtyDisplay,
} from '@/utils/erpNumberDisplay'
import { getPermissionModelFromStorage, hasPageAction } from '@/utils/menuPermission'

defineOptions({ name: 'SupplyChainAnalysisPriceQuery' })

const MENU_PATH = 'supply-chain/analysis/price-query'
const REPORT_TITLE = '历史价格查询'
const COLUMN_SETTING_KEY = 'erp.historyPriceQuery.columnSetting.v1'
const REPORT_TIMEOUT_MS = 180000
const EXPORT_THIN_BORDER = {
  top: { style: 'thin', color: { argb: 'FF333333' } },
  left: { style: 'thin', color: { argb: 'FF333333' } },
  bottom: { style: 'thin', color: { argb: 'FF333333' } },
  right: { style: 'thin', color: { argb: 'FF333333' } },
}
const EXPORT_HEADER_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF0F0F0' } }

const materialColumns = [
  { key: 'materialCode', label: '材料编码', width: 150 },
  { key: 'materialName', label: '材料名称', minWidth: 220 },
  { key: 'materialSpec', label: '规格', minWidth: 180 },
  { key: 'bomUnit', label: 'BOM单位', width: 100 },
  { key: 'bomPrice', label: 'BOM价格', width: 110, format: 'money4' },
  { key: 'purchaseUnit', label: '采购单位', width: 100 },
  { key: 'priceCount', label: '价格记录数', width: 110, format: 'qty' },
]
const priceColumns = [
  { key: 'date', label: '日期', width: 120, format: 'date' },
  { key: 'currencyName', label: '币别', width: 100 },
  { key: 'price', label: '价格', width: 110, format: 'money4' },
  { key: 'priceWithTax', label: '含税价格', width: 120, format: 'money4' },
  { key: 'supplier', label: '供应商', minWidth: 220 },
  { key: 'sourceType', label: '价格来源', width: 100 },
  { key: 'sourceNo', label: '来源单号', width: 150 },
  { key: 'status', label: '状态', width: 100 },
]
const allColumns = [...materialColumns, ...priceColumns]
const defaultColumnKeys = allColumns.map((col) => col.key)

const permissionModel = computed(() => getPermissionModelFromStorage())
const hasExportPermission = computed(() => hasPageAction(permissionModel.value, MENU_PATH, 'export'))

const loading = ref(false)
const dialogVisible = ref(false)
const formRef = ref()
const reportTableRef = ref(null)
const printConfig = reactive({ info: '' })
const printLogoSrc = ref('')
const reportGeneratedAt = ref('')
const reportCode = ref('')
const reportRows = ref([])
const supplierOptions = ref([])
const materialOptions = ref([])
const checkedColumnKeys = ref(loadColumnSetting())
const reportContext = reactive({
  startDate: '',
  endDate: '',
  supplierCode: '',
  supplierLabel: '',
  materialCode: '',
  materialName: '',
  materialSpec: '',
  onlyWithPrice: '1',
})
const queryProgress = reactive({
  active: false,
  elapsed: 0,
  elapsedText: '0.0',
  rendering: false,
})
let queryProgressTimer = null

/** 点行展开/收起历史价明细（箭头列已全局隐藏） */
function onReportRowClick(row, column, event) {
  if (!row?.rowKey || !reportTableRef.value) return
  const target = event?.target
  if (target && typeof target.closest === 'function') {
    if (target.closest('.el-button, button, a, input, textarea, select')) return
    if (target.closest('.price-history-panel, .el-table__expand-icon')) return
  }
  if (column?.type === 'expand') return
  reportTableRef.value.toggleRowExpansion(row)
}

const form = reactive({
  startDate: '',
  endDate: '',
  supplierCode: '',
  supplierName: '',
  materialCode: '',
  materialName: '',
  materialSpec: '',
  onlyWithPrice: '1',
})

const rules = {
  startDate: [{ required: true, message: '开始日期不能为空', trigger: 'change' }],
  endDate: [
    { required: true, message: '结束日期不能为空', trigger: 'change' },
    {
      validator: (_rule, value, callback) => {
        if (form.startDate && value && form.startDate > value) callback(new Error('开始日期不能大于结束日期'))
        else callback()
      },
      trigger: 'change',
    },
  ],
  materialCode: [{ required: true, message: '物料编码不能为空', trigger: 'change' }],
}

const visibleMaterialColumns = computed(() => materialColumns.filter((col) => checkedColumnKeys.value.includes(col.key)))
const visiblePriceColumns = computed(() => priceColumns.filter((col) => checkedColumnKeys.value.includes(col.key)))
const reportDateRangeText = computed(() => {
  if (!reportContext.startDate && !reportContext.endDate) return ''
  return `${reportContext.startDate || ''} 至 ${reportContext.endDate || ''}`
})
const materialContextText = computed(() => {
  return [reportContext.materialName, reportContext.materialSpec].filter(Boolean).join(' / ') || '全部'
})

function loadColumnSetting() {
  try {
    const parsed = JSON.parse(localStorage.getItem(COLUMN_SETTING_KEY) || '[]')
    const valid = parsed.filter((key) => defaultColumnKeys.includes(key))
    return valid.length ? valid : [...defaultColumnKeys]
  } catch {
    return [...defaultColumnKeys]
  }
}

function saveColumnSetting() {
  localStorage.setItem(COLUMN_SETTING_KEY, JSON.stringify(checkedColumnKeys.value))
}

function resetColumnSetting() {
  checkedColumnKeys.value = [...defaultColumnKeys]
  saveColumnSetting()
}

function dateTextFromDate(date) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function monthOffsetDateText(offset) {
  const d = new Date()
  d.setMonth(d.getMonth() + offset)
  return dateTextFromDate(d)
}

function formatDateTime(value) {
  const d = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(d.getTime())) return ''
  return `${dateTextFromDate(d)} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`
}

function formatDate(value) {
  if (!value) return ''
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return String(value).slice(0, 10)
  return dateTextFromDate(d)
}

function buildReportCode() {
  return `${Date.now().toString(16).toUpperCase()}${Math.random().toString(16).slice(2, 6).toUpperCase()}`
}

function formatCodeName(item) {
  return [item?.code, item?.name].filter(Boolean).join(' ')
}

function formatMaterialCell(row, col) {
  const value = row[col.key]
  if (col.format === 'money4') return formatErpPriceDisplay(value)
  if (col.format === 'qty') return formatErpQtyDisplay(value)
  return value ?? ''
}

function formatPriceCell(row, col) {
  const value = row[col.key]
  if (col.format === 'money4') return formatErpPriceDisplay(value)
  if (col.format === 'date') return formatDate(value)
  return value ?? ''
}

function startQueryProgress() {
  stopQueryProgress()
  queryProgress.active = true
  queryProgress.elapsed = 0
  queryProgress.elapsedText = '0.0'
  queryProgress.rendering = false
  const start = Date.now()
  queryProgressTimer = window.setInterval(() => {
    const seconds = (Date.now() - start) / 1000
    queryProgress.elapsed = seconds
    queryProgress.elapsedText = seconds.toFixed(1)
  }, 100)
}

function stopQueryProgress() {
  if (queryProgressTimer) {
    window.clearInterval(queryProgressTimer)
    queryProgressTimer = null
  }
  queryProgress.active = false
  queryProgress.rendering = false
}

async function applyRowsInChunks(rows) {
  queryProgress.rendering = true
  reportRows.value = []
  const chunkSize = 200
  for (let i = 0; i < rows.length; i += chunkSize) {
    reportRows.value = reportRows.value.concat(rows.slice(i, i + chunkSize))
    await nextTick()
  }
}

async function fetchPrintHeader() {
  try {
    const { data } = await axios.get('/api/history-price-query/print-header')
    const payload = data?.data ?? {}
    printConfig.info = payload.info || payload.headerHtml || ''
    printLogoSrc.value = payload.logoSrc || ''
  } catch (err) {
    ElMessage.error(dataErrorMessage(err, '读取打印抬头失败'))
  }
}

async function fetchSuppliers(keyword = '') {
  try {
    const { data } = await axios.get('/api/history-price-query/supplier-options', { params: { keyword } })
    supplierOptions.value = data?.data?.list ?? []
  } catch (err) {
    ElMessage.error(dataErrorMessage(err, '读取供应商候选失败'))
  }
}

async function fetchMaterials(keyword = '') {
  try {
    const { data } = await axios.get('/api/history-price-query/material-options', { params: { keyword } })
    materialOptions.value = data?.data?.list ?? []
  } catch (err) {
    ElMessage.error(dataErrorMessage(err, '读取物料候选失败'))
  }
}

function onSupplierChange(code) {
  const item = supplierOptions.value.find((x) => x.code === code)
  form.supplierName = item?.name || ''
}

function onMaterialChange(code) {
  const item = materialOptions.value.find((x) => x.code === code)
  if (!item) return
  form.materialName = item.name || ''
  form.materialSpec = item.spec || ''
}

function openQueryDialog() {
  dialogVisible.value = true
  fetchSuppliers('')
  fetchMaterials(form.materialCode)
}

function buildQueryParams() {
  return {
    startDate: form.startDate,
    endDate: form.endDate,
    supplierCode: form.supplierCode,
    materialCode: form.materialCode,
    materialName: form.materialName,
    materialSpec: form.materialSpec,
    onlyWithPrice: form.onlyWithPrice,
  }
}

async function submitQuery() {
  if (!formRef.value) return
  await formRef.value.validate()
  await loadReport()
  dialogVisible.value = false
}

async function loadReport() {
  loading.value = true
  startQueryProgress()
  try {
    const params = buildQueryParams()
    const { data } = await axios.get('/api/history-price-query/report', { params, timeout: REPORT_TIMEOUT_MS })
    const payload = data?.data ?? {}
    reportGeneratedAt.value = formatDateTime(new Date())
    reportCode.value = buildReportCode()
    reportContext.startDate = payload.startDate || form.startDate
    reportContext.endDate = payload.endDate || form.endDate
    reportContext.supplierCode = payload.supplierCode || form.supplierCode
    reportContext.supplierLabel = form.supplierCode ? formatCodeName({ code: form.supplierCode, name: form.supplierName }) : '全部'
    reportContext.materialCode = payload.materialCode || form.materialCode
    reportContext.materialName = payload.materialName || form.materialName
    reportContext.materialSpec = payload.materialSpec || form.materialSpec
    reportContext.onlyWithPrice = String(payload.onlyWithPrice ? '1' : '0')
    await applyRowsInChunks(payload.list ?? [])
  } catch (err) {
    ElMessage.error(dataErrorMessage(err, '读取历史价格查询失败'))
  } finally {
    loading.value = false
    stopQueryProgress()
  }
}

function dataErrorMessage(err, fallback) {
  return err?.response?.data?.msg || err?.message || fallback
}

function onPrint() {
  window.print()
}

function addExportHeader(ws) {
  ws.addRow([REPORT_TITLE])
  ws.mergeCells(1, 1, 1, Math.max(1, visibleMaterialColumns.value.length + visiblePriceColumns.value.length))
  ws.getCell(1, 1).font = { bold: true, size: 16 }
  ws.getCell(1, 1).alignment = { horizontal: 'center' }
  ws.addRow([`报表生成时间：${reportGeneratedAt.value || ''}`, `报表代码：${reportCode.value || ''}`])
  ws.addRow([`查询日期：${reportDateRangeText.value || ''}`, `供应商：${reportContext.supplierLabel || '全部'}`])
  ws.addRow([`物料编码：${reportContext.materialCode || ''}`, `物料：${materialContextText.value}`])
  ws.addRow([])
}

async function exportReportXlsx() {
  if (!reportRows.value.length) {
    ElMessage.warning('暂无可导出的历史价格数据')
    return
  }
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet(REPORT_TITLE)
  addExportHeader(ws)
  const columns = [...visibleMaterialColumns.value, ...visiblePriceColumns.value]
  const headerRow = ws.addRow(columns.map((col) => col.label))
  headerRow.font = { bold: true }
  headerRow.fill = EXPORT_HEADER_FILL
  headerRow.eachCell((cell) => {
    cell.border = EXPORT_THIN_BORDER
    cell.alignment = { horizontal: 'center', vertical: 'middle' }
  })
  for (const material of reportRows.value) {
    if (!material.prices.length) {
      const row = ws.addRow([
        ...visibleMaterialColumns.value.map((col) => formatMaterialCell(material, col)),
        '无历史价格',
      ])
      row.eachCell((cell) => { cell.border = EXPORT_THIN_BORDER })
      continue
    }
    for (const priceRow of material.prices) {
      const row = ws.addRow([
        ...visibleMaterialColumns.value.map((col) => formatMaterialCell(material, col)),
        ...visiblePriceColumns.value.map((col) => formatPriceCell(priceRow, col)),
      ])
      row.eachCell((cell) => { cell.border = EXPORT_THIN_BORDER })
    }
  }
  ws.columns.forEach((col) => { col.width = 18 })
  const buffer = await wb.xlsx.writeBuffer()
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${REPORT_TITLE}_${reportContext.materialCode || '全部'}_${reportContext.endDate || ''}.xlsx`
  a.click()
  URL.revokeObjectURL(url)
}

onMounted(() => {
  form.startDate = monthOffsetDateText(-3)
  form.endDate = dateTextFromDate(new Date())
  fetchPrintHeader()
})

onBeforeUnmount(() => {
  stopQueryProgress()
})
</script>

<style scoped>
.history-price-page {
  min-height: 100%;
  background: #fff;
  color: #111827;
}

.report-toolbar {
  display: flex;
  gap: 8px;
  align-items: center;
  padding: 10px 0;
}

.report-shell {
  padding: 8px 40px 40px;
  background: #fff;
}

/* 抬头与采购订单情况表一致：上 LOGO、下地址/电话，整块居中（勿改回左右并排） */
.report-header {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
}

.logo-wrap {
  display: flex;
  align-items: center;
  justify-content: center;
}

/* DIY：LOGO 最大宽/高，建议宽 200~320、高 40~64，与采购订单情况表同口径 */
.logo {
  max-width: var(--erp-history-price-logo-max-width, 260px);
  max-height: var(--erp-history-price-logo-max-height, 48px);
  object-fit: contain;
}

.head-info {
  width: 100%;
  font-size: 14px;
  line-height: 1.3;
  text-align: center;
  color: #000;
}

.head-info-html :deep(*) {
  margin-top: 0;
  margin-bottom: 0;
}

.head-info-placeholder {
  color: #9ca3af;
}

.report-title {
  margin: 4px 0 10px;
  text-align: center;
  font-size: 20px;
  font-weight: 700;
}

.report-meta {
  display: flex;
  align-items: center;
  min-height: 22px;
  font-size: 13px;
}

.meta-gap {
  margin-left: 18px;
}

.meta-value {
  min-width: 80px;
  font-weight: 600;
}

.report-done {
  margin: 8px 0 4px;
  color: #ef4444;
  font-size: 13px;
  font-weight: 600;
}

.legacy-table-wrap {
  width: 100%;
  overflow-x: auto;
}

.legacy-report-table {
  min-width: 980px;
}

.price-history-panel {
  padding: 10px 18px 12px 48px;
  background: #f8fafc;
}

.price-history-table {
  width: 100%;
}

.query-form {
  padding-top: 4px;
}

.query-tip {
  margin-bottom: 16px;
  color: #6b7280;
}

.query-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 4px 32px;
}

.query-grid :deep(.el-select),
.query-grid :deep(.el-date-editor),
.query-grid :deep(.el-input-number) {
  width: 100%;
}

.column-setting-title {
  margin-bottom: 10px;
  color: #606266;
  font-size: 13px;
}

.column-setting-panel :deep(.el-checkbox-group) {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 6px 12px;
}

.column-setting-actions {
  margin-top: 10px;
  text-align: right;
}

.history-price-query-progress-overlay {
  position: fixed;
  inset: 0;
  z-index: 4000;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(15, 23, 42, 0.28);
}

.query-progress-panel {
  width: 360px;
  padding: 22px 24px;
  border-radius: 16px;
  background: #fff;
  box-shadow: 0 18px 50px rgba(15, 23, 42, 0.18);
}

.query-progress-head {
  display: flex;
  align-items: center;
  gap: 10px;
  font-weight: 700;
  color: #1f2937;
}

.query-progress-spinner {
  color: #2563eb;
  animation: query-progress-spin 1s linear infinite;
}

.query-progress-bar {
  position: relative;
  height: 8px;
  margin: 18px 0 12px;
  overflow: hidden;
  border-radius: 999px;
  background: #e5e7eb;
}

.query-progress-bar-inner {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 42%;
  border-radius: inherit;
  background: linear-gradient(90deg, #2563eb, #60a5fa);
  animation: query-progress-slide 1.45s ease-in-out infinite;
}

.query-progress-bar-inner--delay {
  animation-delay: 0.45s;
  opacity: 0.55;
}

.query-progress-text,
.query-progress-hint,
.query-progress-alive-hint {
  margin: 0;
  color: #4b5563;
  font-size: 13px;
}

.query-progress-hint,
.query-progress-alive-hint {
  margin-top: 8px;
}

.query-progress-alive-hint {
  color: #dc2626;
}

.query-progress-elapsed {
  font-weight: 700;
  color: #2563eb;
}

.query-progress-dots i {
  display: inline-block;
  width: 4px;
  height: 4px;
  margin-left: 4px;
  border-radius: 50%;
  background: #2563eb;
  animation: query-progress-dot-bounce 1s infinite;
}

.query-progress-dots i:nth-child(2) {
  animation-delay: 0.15s;
}

.query-progress-dots i:nth-child(3) {
  animation-delay: 0.3s;
}

.print-document {
  display: none;
}

.print-table {
  width: 100%;
  border-collapse: collapse;
  table-layout: fixed;
  font-size: 11px;
}

.print-table th,
.print-table td {
  border: 1px solid #888;
  padding: 4px 5px;
  word-break: break-word;
}

.print-material-block {
  margin-top: 10px;
}

.price-print-table {
  margin-top: 4px;
}

@keyframes query-progress-spin {
  to { transform: rotate(360deg); }
}

@keyframes query-progress-slide {
  0% { left: -45%; }
  100% { left: 105%; }
}

@keyframes query-progress-dot-bounce {
  0%, 80%, 100% { transform: translateY(0); opacity: 0.45; }
  40% { transform: translateY(-3px); opacity: 1; }
}

@media print {
  .no-print,
  .report-shell,
  .el-dialog__wrapper {
    display: none !important;
  }

  .print-document {
    display: block;
    color: #000;
  }

  .print-time {
    text-align: right;
    font-size: 11px;
  }
}
</style>
