<template>
  <div class="erp-module-page prod-issue-stats-page">
    <div class="view-switch-toolbar no-print">
      <el-button :type="activeView === 'detail' ? 'primary' : 'default'" @click="switchView('detail')">
        生产领用统计表（明细）
      </el-button>
      <el-button :type="activeView === 'summary' ? 'primary' : 'default'" @click="switchView('summary')">
        生产领用统计表（汇总）
      </el-button>
    </div>

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
            <el-checkbox v-for="col in activeColumns" :key="col.key" :label="col.key">{{ col.label }}</el-checkbox>
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

      <h2 class="report-title">{{ reportTitle }}</h2>

      <div class="report-meta">
        <span>报表生成时间：</span><span class="meta-value">{{ reportGeneratedAt || ' ' }}</span>
        <span class="meta-gap">报表代码：</span><span class="meta-value">{{ reportCode || ' ' }}</span>
      </div>
      <div class="report-meta">
        <span>统计日期：</span><span class="meta-value">{{ reportDateRangeText || ' ' }}</span>
        <span class="meta-gap">仓库：</span><span class="meta-value">{{ reportContext.warehouseLabel || ' ' }}</span>
      </div>
      <div class="report-meta">
        <span>统计标准：</span><span class="meta-value">{{ reportContext.choosesLabel || ' ' }}</span>
        <span class="meta-gap">PI/PO：</span><span class="meta-value">{{ reportContext.piPoText || ' ' }}</span>
        <span class="meta-gap">物料编码：</span><span class="meta-value">{{ reportContext.materialCode || ' ' }}</span>
      </div>
      <div class="report-done">统计完毕，一共：{{ reportRowCount }} 条记录</div>

      <el-skeleton :loading="loading" animated :rows="8">
        <template #default>
          <div v-if="activeView === 'detail'" class="legacy-table-wrap">
            <el-table
              v-erp-list-h-scroll
              class="legacy-report-table"
              :data="detailRows"
              border
              stripe
              row-key="rowKey"
              empty-text="暂无数据"
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

          <div v-else class="summary-section-wrap">
            <el-empty v-if="!summarySections.length" description="暂无数据" />
            <section v-for="section in summarySections" :key="section.piNo" class="summary-section">
              <div class="summary-title">
                <span>PI号：{{ section.piNo || ' ' }}</span>
                <span>PO号：{{ section.poNo || ' ' }}</span>
                <span>日期：{{ formatDate(section.salesDate) || ' ' }}</span>
              </div>
              <el-table
                v-erp-list-h-scroll
                class="legacy-report-table"
                :data="section.rows"
                border
                stripe
                row-key="rowKey"
                empty-text="暂无数据"
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
            </section>
          </div>
        </template>
      </el-skeleton>
    </section>

    <el-dialog
      v-model="dialogVisible"
      title="生产领用统计条件查询"
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
              <el-option v-for="item in warehouseOptions" :key="item.code" :label="formatWarehouseLabel(item)" :value="item.code" />
            </el-select>
          </el-form-item>
          <el-form-item v-if="activeView === 'detail'" label="统计标准" prop="chooses">
            <el-radio-group v-model="form.chooses">
              <el-radio label="1">销售订单 PI 时间</el-radio>
              <el-radio label="2">出库单时间</el-radio>
            </el-radio-group>
          </el-form-item>
          <el-form-item v-else label="只显示未领">
            <el-switch v-model="form.onlyUnissued" active-text="是" inactive-text="否" />
          </el-form-item>
          <el-form-item label="PI/PO号" class="span-2">
            <div class="pi-input-row">
              <el-input v-model="form.piPoNos" placeholder="可手动填写，多个用英文逗号分隔" @input="syncSelectedPisFromInput" />
              <el-button type="primary" plain @click="openPiDialog">选择</el-button>
              <el-button plain :disabled="!form.piPoNos" @click="clearPiPoNos">清空</el-button>
            </div>
          </el-form-item>
          <el-form-item label="物料编码">
            <el-autocomplete
              v-model="form.materialCode"
              clearable
              :fetch-suggestions="queryMaterialCodeSuggestions"
              placeholder="输入物料编码搜索"
              trigger-on-focus
            />
          </el-form-item>
        </div>
      </el-form>
      <div v-if="queryProgress.active" class="query-progress-panel">
        <el-progress :percentage="100" :indeterminate="true" :show-text="false" />
        <p class="query-progress-text">正在统计生产领用{{ activeView === 'summary' ? '汇总' : '明细' }}，已等待 {{ queryProgress.elapsedSec }} 秒。</p>
        <p v-if="queryProgress.elapsedSec >= 15" class="query-progress-hint">查询范围较大，请耐心等待，仍在统计中。</p>
      </div>
      <template #footer>
        <el-button :disabled="loading" @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="loading" @click="submitQuery">确定</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="piDialog.visible" title="选择 PI" width="920px" class="prod-pi-dialog">
      <div class="pi-dialog-toolbar">
        <el-input v-model="piDialog.keyword" clearable placeholder="PI号" @keyup.enter="searchPiDialog" />
        <el-button type="primary" @click="searchPiDialog">查询</el-button>
        <el-button type="primary" plain :disabled="!piDialog.selected.length" @click="applyPiSelection">保存已选数据</el-button>
      </div>
      <el-table
        v-loading="piDialog.loading"
        :data="piDialog.list"
        border
        stripe
        row-key="piNo"
      >
        <el-table-column label="操作" width="110" align="center" fixed="left" class-name="erp-col-actions">
          <template #default="{ row }">
            <ErpTableActions>
              <el-button
                :type="isPiRowSelected(row) ? 'success' : 'primary'"
                plain
                class="prod-pi-select-button"
                @click="choosePiRow(row)"
              >
                {{ isPiRowSelected(row) ? '已选择' : '选择' }}
              </el-button>
            </ErpTableActions>
          </template>
        </el-table-column>
        <el-table-column prop="piNo" label="PI号" min-width="140" align="center" />
        <el-table-column prop="poNo" label="PO号" min-width="140" align="center" />
        <el-table-column prop="customer" label="客户" min-width="180" align="center" />
      </el-table>
      <el-pagination
        v-model:current-page="piDialog.page"
        v-model:page-size="piDialog.pageSize"
        :page-sizes="[10, 20, 50, 100]"
        layout="total, sizes, prev, pager, next, jumper"
        :total="piDialog.total"
        class="pi-pagination"
        @size-change="onPiPageSizeChange"
        @current-change="onPiPageChange"
      />
    </el-dialog>

    <section class="print-document" aria-hidden="true">
      <p class="print-time">打印时间：{{ reportGeneratedAt }}</p>
      <header class="report-header print-header">
        <div v-if="printLogoSrc" class="logo-wrap">
          <img class="logo" :src="printLogoSrc" alt="logo" />
        </div>
        <div class="head-info">
          <div v-if="printConfig.info" class="head-info-html" v-html="printConfig.info"></div>
        </div>
      </header>
      <h2 class="report-title">{{ reportTitle }}</h2>
      <div class="report-meta">
        <span>统计日期：</span><span class="meta-value">{{ reportDateRangeText || ' ' }}</span>
        <span class="meta-gap">仓库：</span><span class="meta-value">{{ reportContext.warehouseLabel || ' ' }}</span>
      </div>
      <div class="report-meta">
        <span>PI/PO：</span><span class="meta-value">{{ reportContext.piPoText || ' ' }}</span>
        <span class="meta-gap">物料编码：</span><span class="meta-value">{{ reportContext.materialCode || ' ' }}</span>
      </div>

      <table v-if="activeView === 'detail'" class="print-table">
        <thead>
          <tr>
            <th v-for="col in visibleColumns" :key="`print-head-${col.key}`" :class="{ 'qty-col': col.isQty }">{{ col.label }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in detailRows" :key="`print-${row.rowKey}`">
            <td v-for="col in visibleColumns" :key="`print-${row.rowKey}-${col.key}`" :class="{ 'qty-col': col.isQty }">
              {{ formatReportCell(row, col) }}
            </td>
          </tr>
        </tbody>
      </table>

      <template v-else>
        <section v-for="section in summarySections" :key="`print-section-${section.piNo}`" class="print-summary-section">
          <div class="summary-title">
            <span>PI号：{{ section.piNo || ' ' }}</span>
            <span>PO号：{{ section.poNo || ' ' }}</span>
            <span>日期：{{ formatDate(section.salesDate) || ' ' }}</span>
          </div>
          <table class="print-table">
            <thead>
              <tr>
                <th v-for="col in visibleColumns" :key="`print-head-${section.piNo}-${col.key}`" :class="{ 'qty-col': col.isQty }">{{ col.label }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in section.rows" :key="`print-${row.rowKey}`">
                <td v-for="col in visibleColumns" :key="`print-${row.rowKey}-${col.key}`" :class="{ 'qty-col': col.isQty }">
                  {{ formatReportCell(row, col) }}
                </td>
              </tr>
            </tbody>
          </table>
        </section>
      </template>
    </section>
  </div>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import axios from 'axios'
import ExcelJS from 'exceljs'
import { formatErpQtyDisplay } from '@/utils/erpNumberDisplay.js'
import { getPermissionModelFromStorage, hasPageAction } from '@/utils/menuPermission'

defineOptions({ name: 'ProductionAnalysisReportStats' })

const MENU_PATH = 'production/analysis/report-stats'
const REPORT_TIMEOUT_MS = 180000
const COLUMN_SETTING_KEY_PREFIX = 'erp.productionIssueStats.columnSetting'
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

const activeView = ref('detail')
const loading = ref(false)
const dialogVisible = ref(false)
const hasQueried = ref(false)
const queryProgress = reactive({ active: false, elapsedSec: 0 })
let queryProgressTimer = null

const formRef = ref()
const printConfig = reactive({ info: '' })
const printLogoSrc = ref('')
const reportGeneratedAt = ref('')
const reportCode = ref('')
const detailRows = ref([])
const summarySections = ref([])
const reportContext = reactive({
  viewMode: 'detail',
  startDate: '',
  endDate: '',
  warehouseCode: '',
  warehouseLabel: '',
  chooses: '1',
  choosesLabel: '',
  piPoText: '',
  materialCode: '',
})

const form = reactive({
  startDate: '',
  endDate: '',
  warehouseCode: '',
  chooses: '1',
  piPoNos: '',
  materialCode: '',
  onlyUnissued: false,
  lx: '1',
})

const piDialog = reactive({
  visible: false,
  loading: false,
  keyword: '',
  list: [],
  selected: [],
  page: 1,
  pageSize: 10,
  total: 0,
})

const warehouseOptions = ref([])
const selectedPis = ref([])
const checkedColumnKeys = ref([])

const detailColumns = [
  { key: 'outboundNo', label: '单号', minWidth: 130 },
  { key: 'outboundDate', label: '日期', width: 110, format: 'date' },
  { key: 'piNo', label: 'PI号', minWidth: 120 },
  { key: 'workshopName', label: '领用车间', minWidth: 120 },
  { key: 'materialCode', label: '材料编码', minWidth: 130 },
  { key: 'materialName', label: '材料名称', minWidth: 160 },
  { key: 'materialSpec', label: '材料规格', minWidth: 140 },
  { key: 'unit', label: '单位', width: 70 },
  { key: 'issueQty', label: '领用数量', width: 110, isQty: true, format: 'qty' },
  { key: 'returnQty', label: '退料数量', width: 110, isQty: true, format: 'qty' },
  { key: 'netQty', label: '实领数量', width: 110, isQty: true, format: 'qty' },
  { key: 'remark', label: '备注', minWidth: 120 },
]

const summaryColumns = [
  { key: 'index', label: '序号', width: 70 },
  { key: 'materialCode', label: '编码', minWidth: 130 },
  { key: 'materialName', label: '名称', minWidth: 180 },
  { key: 'materialSpec', label: '规格', minWidth: 160 },
  { key: 'unit', label: '单位', width: 70 },
  { key: 'budgetQty', label: '预算数量', width: 110, isQty: true, format: 'qty' },
  { key: 'issueQty', label: '领用数量', width: 110, isQty: true, format: 'qty' },
  { key: 'returnQty', label: '退料数量', width: 110, isQty: true, format: 'qty' },
  { key: 'netQty', label: '实领数量', width: 110, isQty: true, format: 'qty' },
  { key: 'unissuedQty', label: '未领数量', width: 110, isQty: true, format: 'qty' },
  { key: 'remark', label: '备注', minWidth: 220 },
]

const activeColumns = computed(() => activeView.value === 'summary' ? summaryColumns : detailColumns)
const defaultColumnKeys = computed(() => activeColumns.value.map((col) => col.key))
const visibleColumns = computed(() => {
  const selected = new Set(checkedColumnKeys.value)
  return activeColumns.value.filter((col) => selected.has(col.key))
})
const reportTitle = computed(() => activeView.value === 'summary' ? '生产领用统计表（汇总）' : '生产领用统计表（明细）')
const reportRowCount = computed(() => activeView.value === 'summary'
  ? summarySections.value.reduce((sum, section) => sum + section.rows.length, 0)
  : detailRows.value.length)

const rules = computed(() => ({
  startDate: [{ required: true, message: '统计开始日期不能为空', trigger: 'change' }],
  endDate: [{ required: true, message: '统计结束日期不能为空', trigger: 'change' }],
  warehouseCode: [{ required: true, message: '仓库不能为空', trigger: 'change' }],
  chooses: activeView.value === 'detail'
    ? [{ required: true, message: '请选择统计标准', trigger: 'change' }]
    : [],
}))

const reportDateRangeText = computed(() => {
  if (!reportContext.startDate && !reportContext.endDate) return ''
  return `${reportContext.startDate || ''} 至 ${reportContext.endDate || ''}`
})

watch(activeView, () => {
  loadColumnSetting()
})

function makeReportCode() {
  const raw = `${Date.now()}${Math.random().toString(16).slice(2)}`
  return raw.toUpperCase().replace(/[^0-9A-F]/g, '').slice(0, 16)
}

function formatNow() {
  const d = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

function todayText() {
  const d = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function yearsAgoText(years) {
  const d = new Date()
  const target = new Date(d.getFullYear() - Number(years || 0), d.getMonth(), d.getDate())
  const pad = (n) => String(n).padStart(2, '0')
  return `${target.getFullYear()}-${pad(target.getMonth() + 1)}-${pad(target.getDate())}`
}

function formatDate(value) {
  if (!value) return ''
  const s = String(value)
  if (s.length >= 10) return s.slice(0, 10)
  return s
}

function formatReportCell(row, col) {
  if (!row || !col) return ''
  const value = row[col.key]
  if (col.format === 'date') return formatDate(value)
  if (col.format === 'qty') return formatErpQtyDisplay(value)
  return value ?? ''
}

function formatWarehouseLabel(item) {
  return `${String(item?.code ?? '').trim()} ${String(item?.name ?? '').trim()}`.trim()
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
  return exact?.code || fuzzy?.code || rows[0]?.code || ''
}

function columnSettingKey() {
  return `${COLUMN_SETTING_KEY_PREFIX}.${activeView.value}.v1`
}

function normalizeColumnKeys(keys) {
  if (!Array.isArray(keys)) return []
  const allowSet = new Set(activeColumns.value.map((col) => col.key))
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

function loadColumnSetting() {
  try {
    const raw = localStorage.getItem(columnSettingKey())
    if (!raw) {
      checkedColumnKeys.value = [...defaultColumnKeys.value]
      return
    }
    const parsed = JSON.parse(raw)
    const keys = normalizeColumnKeys(parsed)
    checkedColumnKeys.value = keys.length ? keys : [...defaultColumnKeys.value]
  } catch {
    checkedColumnKeys.value = [...defaultColumnKeys.value]
  }
}

function persistColumnSetting() {
  try {
    localStorage.setItem(columnSettingKey(), JSON.stringify(checkedColumnKeys.value))
  } catch {
    // 本地列设置失败不影响查询。
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

function switchView(mode) {
  if (activeView.value === mode) return
  activeView.value = mode
  reportContext.viewMode = mode
}

function parsePiPoList(textValue) {
  return String(textValue ?? '')
    .split(/[,，]/)
    .map((s) => s.trim())
    .filter(Boolean)
}

function syncSelectedPisFromInput() {
  selectedPis.value = parsePiPoList(form.piPoNos)
}

function syncPiPoInputFromSelected() {
  form.piPoNos = selectedPis.value.join(',')
}

function clearPiPoNos() {
  form.piPoNos = ''
  selectedPis.value = []
}

function startQueryProgressTimer() {
  stopQueryProgressTimer()
  queryProgress.active = true
  queryProgress.elapsedSec = 0
  queryProgressTimer = setInterval(() => {
    queryProgress.elapsedSec += 1
  }, 1000)
}

function stopQueryProgressTimer() {
  if (queryProgressTimer) {
    clearInterval(queryProgressTimer)
    queryProgressTimer = null
  }
  queryProgress.active = false
  queryProgress.elapsedSec = 0
}

function onDialogClosed() {
  if (!loading.value) stopQueryProgressTimer()
}

async function loadPrintConfig() {
  try {
    const { data } = await axios.get('/api/production-issue-stats/print-header')
    const cfg = data?.data ?? {}
    printConfig.info = cfg.headerHtml || cfg.info || ''
    printLogoSrc.value = cfg.logoSrc || ''
  } catch {
    // 抬头读取失败不影响报表查询。
  }
}

async function fetchWarehouses(keyword = '') {
  try {
    const { data } = await axios.get('/api/production-issue-stats/warehouse-options', { params: { keyword } })
    warehouseOptions.value = Array.isArray(data?.data?.list) ? data.data.list : []
  } catch {
    warehouseOptions.value = []
  }
}

async function queryMaterialCodeSuggestions(queryString, cb) {
  const keyword = String(queryString ?? '').trim()
  if (!keyword) {
    cb([])
    return
  }
  try {
    const { data } = await axios.get('/api/production-issue-stats/material-options', { params: { keyword } })
    const list = Array.isArray(data?.data?.list) ? data.data.list : []
    cb(list.map((item) => ({ value: String(item?.code ?? '').trim() })).filter((item) => item.value))
  } catch {
    cb([])
  }
}

function resolveWarehouseLabel(code) {
  const row = warehouseOptions.value.find((item) => String(item?.code ?? '').trim() === String(code ?? '').trim())
  return row ? formatWarehouseLabel(row) : String(code ?? '').trim()
}

function applyReportContext(payload = {}) {
  reportContext.viewMode = payload.viewMode || activeView.value
  reportContext.startDate = payload.startDate || form.startDate
  reportContext.endDate = payload.endDate || form.endDate
  reportContext.warehouseCode = payload.warehouseCode || form.warehouseCode
  reportContext.warehouseLabel = resolveWarehouseLabel(reportContext.warehouseCode)
  reportContext.chooses = payload.chooses || form.chooses
  reportContext.choosesLabel = activeView.value === 'summary'
    ? '销售订单 PI 时间'
    : (payload.choosesLabel || (form.chooses === '1' ? '销售订单 PI 时间' : '出库单时间'))
  const piList = parsePiPoList(form.piPoNos)
  reportContext.piPoText = piList.length ? piList.join(',') : '（未指定）'
  reportContext.materialCode = payload.materialCode || form.materialCode || ''
}

async function loadReport() {
  loading.value = true
  startQueryProgressTimer()
  try {
    const { data } = await axios.get('/api/production-issue-stats/report', {
      params: {
        viewMode: activeView.value,
        startDate: form.startDate,
        endDate: form.endDate,
        warehouseCode: form.warehouseCode,
        chooses: form.chooses,
        piPoNos: form.piPoNos,
        materialCode: form.materialCode,
        onlyUnissued: form.onlyUnissued ? '1' : '0',
        lx: form.lx,
      },
      timeout: REPORT_TIMEOUT_MS,
    })
    if (data?.code !== 200) {
      ElMessage.error(data?.msg || '查询失败')
      return
    }
    const payload = data?.data ?? {}
    if (activeView.value === 'summary') {
      summarySections.value = Array.isArray(payload.sections) ? payload.sections : []
      detailRows.value = []
    } else {
      detailRows.value = Array.isArray(payload.list) ? payload.list : []
      summarySections.value = []
    }
    applyReportContext(payload)
    reportGeneratedAt.value = formatNow()
    reportCode.value = makeReportCode()
    hasQueried.value = true
    if (payload.truncated) {
      ElMessage.warning('结果已超过上限，仅返回前 50000 条')
    }
    dialogVisible.value = false
  } catch (err) {
    ElMessage.error(err?.response?.data?.msg || err.message || '查询失败')
  } finally {
    loading.value = false
    stopQueryProgressTimer()
  }
}

async function submitQuery() {
  if (!formRef.value) return
  const valid = await formRef.value.validate().catch(() => false)
  if (!valid) return

  const piList = parsePiPoList(form.piPoNos)
  if (!piList.length) {
    try {
      await ElMessageBox.confirm(
        '未填写 PI/PO 会按所选时间范围查询，数据量可能较大、查询较慢，是否继续？',
        '提示',
        { type: 'warning', confirmButtonText: '继续查询', cancelButtonText: '取消' },
      )
    } catch {
      return
    }
  }

  await loadReport()
}

function openQueryDialog() {
  dialogVisible.value = true
}

async function openPiDialog() {
  piDialog.visible = true
  piDialog.keyword = ''
  piDialog.page = 1
  piDialog.selected = [...selectedPis.value]
  await searchPiDialog()
}

async function searchPiDialog() {
  piDialog.loading = true
  try {
    const { data } = await axios.get('/api/production-issue-stats/pi-options', {
      params: {
        keyword: piDialog.keyword,
        page: piDialog.page,
        pageSize: piDialog.pageSize,
        includeClosed: '1',
      },
    })
    piDialog.list = data?.data?.list || []
    piDialog.total = Number(data?.data?.total ?? piDialog.list.length)
  } catch (err) {
    ElMessage.error(err?.response?.data?.msg || err.message || '读取 PI 候选失败')
    piDialog.list = []
    piDialog.total = 0
  } finally {
    piDialog.loading = false
  }
}

function onPiPageSizeChange() {
  piDialog.page = 1
  searchPiDialog()
}

function onPiPageChange() {
  searchPiDialog()
}

function isPiRowSelected(row) {
  return piDialog.selected.includes(String(row?.piNo ?? '').trim())
}

function choosePiRow(row) {
  const piNo = String(row?.piNo ?? '').trim()
  if (!piNo) return
  const idx = piDialog.selected.indexOf(piNo)
  if (idx >= 0) piDialog.selected.splice(idx, 1)
  else piDialog.selected.push(piNo)
}

function applyPiSelection() {
  selectedPis.value = Array.from(new Set(piDialog.selected.map((pi) => String(pi ?? '').trim()).filter(Boolean)))
  syncPiPoInputFromSelected()
  piDialog.visible = false
}

function onPrint() {
  if (!hasQueried.value || reportRowCount.value <= 0) {
    ElMessage.warning('请先查询后再打印')
    return
  }
  window.print()
}

function exportFileName() {
  const range = reportDateRangeText.value || '未查询'
  const warehouse = reportContext.warehouseLabel || form.warehouseCode || ''
  const safe = `${reportTitle.value}-${range}-${warehouse}`.replace(/[\\/:*?"<>|]/g, '_').slice(0, 160)
  return `${safe || reportTitle.value}.xlsx`
}

function styleExportRow(row, opts = {}) {
  row.eachCell((cell) => {
    cell.border = EXPORT_THIN_BORDER
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }
    if (opts.bold) cell.font = { ...(cell.font || {}), bold: true }
    if (opts.fill) cell.fill = opts.fill
  })
}

function addExportMetaRow(ws, leftText, rightText, colCount) {
  if (colCount <= 1) {
    return ws.addRow([`${leftText}　${rightText}`])
  }
  const row = ws.addRow([leftText, rightText])
  const splitCol = Math.max(1, Math.floor(colCount / 2))
  ws.mergeCells(row.number, 1, row.number, splitCol)
  ws.mergeCells(row.number, splitCol + 1, row.number, colCount)
  return row
}

function addExportHeader(ws, columns) {
  const colCount = columns.length
  const titleRow = ws.addRow([reportTitle.value])
  ws.mergeCells(titleRow.number, 1, titleRow.number, colCount)
  titleRow.font = { bold: true, size: 14 }
  ws.getCell(titleRow.number, 1).alignment = { horizontal: 'center', vertical: 'middle' }
  addExportMetaRow(ws, `报表生成时间：${reportGeneratedAt.value || ''}`, `报表代码：${reportCode.value || ''}`, colCount)
  addExportMetaRow(ws, `统计日期：${reportDateRangeText.value || ''}`, `仓库：${reportContext.warehouseLabel || ''}`, colCount)
  addExportMetaRow(ws, `统计标准：${reportContext.choosesLabel || ''}`, `PI/PO：${reportContext.piPoText || ''}`, colCount)
  addExportMetaRow(ws, `物料编码：${reportContext.materialCode || ''}`, `只显示未领：${form.onlyUnissued ? '是' : '否'}`, colCount)
}

async function exportReportXlsx() {
  if (reportRowCount.value <= 0) {
    ElMessage.warning('暂无数据可导出')
    return
  }
  const columns = visibleColumns.value
  if (!columns.length) {
    ElMessage.warning('至少保留一列后再导出')
    return
  }

  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet(reportTitle.value, {
    views: [{ state: 'frozen', ySplit: 7 }],
    pageSetup: { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  })
  const colCount = columns.length
  addExportHeader(ws, columns)

  const countRow = ws.addRow([`统计完毕，一共：${reportRowCount.value} 条记录`])
  ws.mergeCells(countRow.number, 1, countRow.number, colCount)
  ws.addRow([])

  if (activeView.value === 'summary') {
    for (const section of summarySections.value) {
      const sectionRow = ws.addRow([`PI号：${section.piNo || ''}    PO号：${section.poNo || ''}    日期：${formatDate(section.salesDate) || ''}`])
      ws.mergeCells(sectionRow.number, 1, sectionRow.number, colCount)
      styleExportRow(sectionRow, { bold: true })
      const headRow = ws.addRow(columns.map((col) => col.label))
      styleExportRow(headRow, { bold: true, fill: EXPORT_HEADER_FILL })
      for (const row of section.rows) {
        const added = ws.addRow(columns.map((col) => formatReportCell(row, col)))
        styleExportRow(added)
      }
      ws.addRow([])
    }
  } else {
    const headRow = ws.addRow(columns.map((col) => col.label))
    styleExportRow(headRow, { bold: true, fill: EXPORT_HEADER_FILL })
    for (const row of detailRows.value) {
      const added = ws.addRow(columns.map((col) => formatReportCell(row, col)))
      styleExportRow(added)
    }
  }

  ws.columns.forEach((col, index) => {
    const reportCol = columns[index]
    col.width = Math.max(10, Math.min(42, Math.round((reportCol?.width || reportCol?.minWidth || 120) / 8)))
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
  await Promise.all([loadPrintConfig(), fetchWarehouses('')])
  const today = todayText()
  form.startDate = yearsAgoText(3)
  form.endDate = today
  form.warehouseCode = pickDefaultWarehouseCode()
  loadColumnSetting()
})
</script>

<style scoped>
.prod-issue-stats-page {
  min-height: calc(100vh - 118px);
  padding: 8px;
  background: #f5f7fb;
}

.view-switch-toolbar,
.stock-toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 8px;
}

.view-switch-toolbar {
  padding-bottom: 2px;
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

.legacy-table-wrap,
.summary-section-wrap {
  width: 100%;
  overflow: hidden;
}

.summary-section {
  margin-bottom: 18px;
}

.summary-title {
  display: flex;
  flex-wrap: wrap;
  gap: 24px;
  padding: 7px 10px;
  border: 1px solid #d7dce5;
  border-bottom: 0;
  background: #f7f9fc;
  font-size: 13px;
  font-weight: 700;
}

.legacy-report-table {
  width: 100%;
  font-size: 12px;
}

.legacy-report-table :deep(.el-table__cell) {
  padding: 2px 0;
  color: #000;
  text-align: center;
}

.legacy-report-table :deep(.qty-col .cell) {
  white-space: nowrap;
  font-weight: 600;
}

.query-form .query-tip {
  margin-bottom: 12px;
  color: #666;
  font-size: 13px;
}

.query-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0 16px;
}

.query-grid .span-2 {
  grid-column: 1 / -1;
}

.pi-input-row {
  display: flex;
  gap: 8px;
  width: 100%;
}

.pi-input-row .el-input {
  flex: 1;
}

.pi-dialog-toolbar {
  --prod-pi-control-height: 38px;
  --prod-pi-control-font-size: 15px;
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
  margin-bottom: 12px;
}

.pi-dialog-toolbar .el-input {
  width: 360px;
}

.pi-dialog-toolbar :deep(.el-input__wrapper) {
  min-height: var(--prod-pi-control-height);
}

.pi-dialog-toolbar :deep(.el-input__inner) {
  font-size: var(--prod-pi-control-font-size);
}

.pi-dialog-toolbar :deep(.el-button) {
  height: var(--prod-pi-control-height);
  padding-left: 18px;
  padding-right: 18px;
  font-size: var(--prod-pi-control-font-size);
}

.prod-pi-select-button {
  min-width: 74px;
}

.pi-pagination {
  margin-top: 12px;
  justify-content: flex-end;
}

.query-progress-panel {
  margin-top: 12px;
}

.query-progress-text {
  margin: 8px 0 0;
  font-size: 13px;
  color: #666;
}

.query-progress-hint {
  margin: 4px 0 0;
  font-size: 12px;
  color: #e6a23c;
}

.column-setting-panel {
  max-height: 360px;
  overflow: auto;
}

.column-setting-title {
  margin-bottom: 8px;
  font-size: 13px;
  color: #666;
}

.column-setting-actions {
  margin-top: 8px;
}

.print-document {
  display: none;
}

@media print {
  .no-print {
    display: none !important;
  }

  .prod-issue-stats-page {
    padding: 0;
    background: #fff;
  }

  .report-shell {
    display: none;
  }

  .print-document {
    display: block;
    padding: 12px;
    color: #000;
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
  }

  .print-table .qty-col {
    white-space: nowrap;
  }

  .print-time {
    font-size: 11px;
    margin: 0 0 8px;
  }

  .print-summary-section {
    margin-bottom: 14px;
    page-break-inside: avoid;
  }
}
</style>
