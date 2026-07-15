<template>
  <div class="erp-module-page stock-stats-page">
    <div class="stock-toolbar no-print">
      <el-button type="primary" @click="onPrint">打印统计报表</el-button>
      <el-button type="primary" @click="openQueryDialog">查询内容</el-button>
      <el-popover placement="bottom-start" trigger="click" width="300">
        <template #reference>
          <el-button>列设置</el-button>
        </template>
        <div class="column-setting-panel">
          <div class="column-setting-title">勾选要显示的列（打印同步）</div>
          <el-checkbox-group v-model="checkedColumnKeys" @change="onColumnSettingChange">
            <el-checkbox v-for="col in reportColumns" :key="col.key" :label="col.key">{{ col.label }}</el-checkbox>
          </el-checkbox-group>
          <div class="column-setting-actions">
            <el-button link type="primary" @click="resetColumnSetting">恢复默认</el-button>
          </div>
        </div>
      </el-popover>
      <el-button @click="exportReportXlsx">导出信息</el-button>
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

      <h2 class="report-title">库存统计报表</h2>

      <div class="report-meta">
        <span>报表生成时间：</span><span class="meta-value">{{ reportGeneratedAt || ' ' }}</span>
        <span class="meta-gap">报表代码：</span><span class="meta-value">{{ reportCode || ' ' }}</span>
      </div>
      <div class="report-meta">
        <span>查询截止时间：</span><span class="meta-value">{{ reportContext.cutoffDate || ' ' }}</span>
        <span class="meta-gap">仓库：</span><span class="meta-value">{{ reportContext.warehouseLabel || ' ' }}</span>
      </div>
      <div class="report-done">统计完毕，一共：{{ reportRows.length }} 条记录</div>

      <el-skeleton :loading="loading" animated :rows="8">
        <template #default>
          <div class="legacy-table-wrap">
            <el-table
              v-erp-list-h-scroll
              class="legacy-report-table"
              :data="reportRows"
              border
              stripe
              row-key="rowKey"
              empty-text="暂无数据"
            >
              <el-table-column
                v-for="col in visibleReportColumns"
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
      title="库存统计条件查询"
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
          <el-form-item label="库存截止日期" prop="cutoffDate">
            <el-date-picker v-model="form.cutoffDate" type="date" value-format="YYYY-MM-DD" placeholder="请选择日期" />
          </el-form-item>
          <el-form-item label="仓库" prop="warehouseCode">
            <el-select
              v-model="form.warehouseCode"
              filterable
              remote
              reserve-keyword
              clearable
              :remote-method="fetchWarehouses"
              @focus="fetchWarehouses('')"
              placeholder="请选择仓库"
            >
              <el-option label="全部仓库" :value="ALL_WAREHOUSE" />
              <el-option v-for="item in warehouseOptions" :key="item.code" :label="formatWarehouseLabel(item)" :value="item.code" />
            </el-select>
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
          <el-form-item label="物料名称">
            <el-input v-model="form.materialName" clearable />
          </el-form-item>
          <el-form-item label="英文名称">
            <el-input v-model="form.materialNameEn" clearable />
          </el-form-item>
          <el-form-item label="规格">
            <el-input v-model="form.materialSpec" clearable />
          </el-form-item>
          <el-form-item label="物料类别">
            <div class="category-condition-control">
              <el-input :model-value="form.materialCategoryNames" readonly placeholder="未选择类别" />
              <el-button type="primary" plain @click="openCategoryPicker">多选</el-button>
              <el-button plain @click="resetCategorySelection">重选</el-button>
            </div>
          </el-form-item>
          <el-form-item label="单位">
            <el-input v-model="form.unit" clearable />
          </el-form-item>
          <el-form-item label="颜色编码">
            <el-select
              v-model="form.colorCode"
              filterable
              remote
              reserve-keyword
              clearable
              :remote-method="fetchColors"
              @focus="fetchColors('')"
              placeholder="请选择颜色"
            >
              <el-option v-for="item in colorOptions" :key="item.code" :label="formatColorLabel(item)" :value="item.code" />
            </el-select>
          </el-form-item>

          <el-form-item label="只统计物料">
            <el-switch v-model="form.onlyMaterial" @change="syncTypeSwitch('material')" />
          </el-form-item>
          <el-form-item label="只统计成品">
            <el-switch v-model="form.onlyFinished" @change="syncTypeSwitch('finished')" />
          </el-form-item>
          <el-form-item label="库存不等于零">
            <el-switch v-model="form.nonZero" />
          </el-form-item>
          <el-form-item label="可用数量小于零">
            <el-switch v-model="form.availableNegative" />
          </el-form-item>
          <el-form-item label="滞留天数大于">
            <el-input-number v-model="form.dormantDaysGt" :min="0" :precision="0" controls-position="right" />
            <span class="inline-suffix">天</span>
          </el-form-item>
        </div>
      </el-form>
      <template #footer>
        <el-button :disabled="loading" @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="loading" @click="submitQuery">确定</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="categoryPickerVisible" title="选择材料分类" width="720px" append-to-body>
      <div class="category-picker-tip">可选择一个或多个材料分类，确认后仅回填查询条件，不会直接执行统计。</div>
      <div class="category-picker-search">
        <el-input
          v-model.trim="categoryKeyword"
          clearable
          placeholder="请输入分类编码或分类名称"
          @keyup.enter="searchCategories"
          @clear="searchCategories"
        />
        <el-button type="primary" @click="searchCategories">查询</el-button>
      </div>
      <el-table
        :data="categoryOptions"
        row-key="code"
        border
        stripe
        max-height="460"
      >
        <el-table-column label="操作" width="100" align="center">
          <template #default="{ row }">
            <el-button
              size="small"
              :type="isCategorySelected(row) ? 'success' : 'primary'"
              :plain="!isCategorySelected(row)"
              class="category-select-button"
              @click="toggleCategorySelection(row)"
            >
              {{ isCategorySelected(row) ? '已选择' : '选择' }}
            </el-button>
          </template>
        </el-table-column>
        <el-table-column prop="code" label="分类编码" min-width="180" />
        <el-table-column prop="name" label="分类名称" min-width="300" show-overflow-tooltip />
      </el-table>
      <div class="category-picker-pagination">
        <span>已选择 {{ categorySelectionDraft.length }} 项</span>
        <el-pagination
          v-model:current-page="categoryPage"
          v-model:page-size="categoryPageSize"
          :page-sizes="[10, 20, 50, 100]"
          :total="categoryTotal"
          layout="total, sizes, prev, pager, next"
          @size-change="onCategoryPageSizeChange"
          @current-change="fetchCategories"
        />
      </div>
      <template #footer>
        <el-button @click="categoryPickerVisible = false">取消</el-button>
        <el-button type="primary" @click="confirmCategorySelection">确认选择</el-button>
      </template>
    </el-dialog>

    <!-- 统计进度浮层：独立于查询弹窗，接口返回后渲染大表时仍持续显示 -->
    <Teleport to="body">
      <div v-show="queryProgress.active" class="stock-stats-query-progress-overlay no-print">
        <div class="query-progress-panel" aria-live="polite">
          <div class="query-progress-head">
            <el-icon class="query-progress-spinner" aria-hidden="true"><Loading /></el-icon>
            <span ref="queryProgressStageEl" class="query-progress-stage">{{ queryProgressBootStageText }}</span>
          </div>
          <div class="query-progress-bar" aria-hidden="true">
            <div class="query-progress-bar-inner"></div>
            <div class="query-progress-bar-inner query-progress-bar-inner--delay"></div>
          </div>
          <p class="query-progress-text">
            已等待 <span ref="queryProgressElapsedEl" class="query-progress-elapsed">0.0</span> 秒
            <span class="query-progress-dots" aria-hidden="true"><i></i><i></i><i></i></span>
          </p>
          <p v-if="queryProgress.isWideRange" class="query-progress-hint">
            全仓统计耗时较长，秒数与进度条会持续更新，请耐心等待
          </p>
          <p
            v-if="queryProgress.isWideRange"
            ref="queryProgressAliveHintEl"
            class="query-progress-alive-hint"
          >
            后台仍在运算，界面未卡死
          </p>
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
      <h2 class="report-title">库存统计报表</h2>
      <div class="report-meta">
        <span>查询截止时间：</span><span class="meta-value">{{ reportContext.cutoffDate || ' ' }}</span>
        <span class="meta-gap">仓库：</span><span class="meta-value">{{ reportContext.warehouseLabel || ' ' }}</span>
      </div>
      <table class="print-table">
        <thead>
          <tr>
            <th v-for="col in visibleReportColumns" :key="`print-head-${col.key}`" :class="{ 'qty-col': col.isQty }">
              {{ col.label }}
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in reportRows" :key="`print-${row.rowKey}`">
            <td v-for="col in visibleReportColumns" :key="`print-${row.rowKey}-${col.key}`" :class="{ 'qty-col': col.isQty }">
              {{ formatReportCell(row, col) }}
            </td>
          </tr>
        </tbody>
      </table>
    </section>
  </div>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { Loading } from '@element-plus/icons-vue'
import axios from 'axios'
import ExcelJS from 'exceljs'

defineOptions({ name: 'InventoryAnalysisStockStats' })

const REPORT_TIMEOUT_NORMAL_MS = 15000
const REPORT_TIMEOUT_CATEGORY_MS = 120000
const REPORT_ROWS_CHUNK_SIZE = 400

const loading = ref(false)
const dialogVisible = ref(false)
const queryProgress = reactive({
  active: false,
  isCategory: false,
  isWideRange: false,
})
const queryProgressStageEl = ref(null)
const queryProgressElapsedEl = ref(null)
const queryProgressAliveHintEl = ref(null)
let queryProgressWorker = null
let queryProgressWorkerBlobUrl = ''
let queryProgressProfile = {
  isCategory: false,
  isWideRange: false,
  rendering: false,
  renderTotal: 0,
  renderDone: 0,
}

/** 宽范围统计时按等待时长轮换阶段文案，避免长时间只有秒数变化像卡死 */
function resolveQueryProgressStageText(elapsedMs, profile = queryProgressProfile) {
  if (profile.rendering) {
    if (profile.renderDone > 0 && profile.renderDone < profile.renderTotal) {
      return `正在渲染报表（${profile.renderDone}/${profile.renderTotal} 条）`
    }
    return `正在渲染报表（共 ${profile.renderTotal || 0} 条），请稍候`
  }
  const sec = Math.floor(elapsedMs / 1000)
  if (profile.isCategory) {
    if (sec < 3) return '正在按类别筛选物料'
    if (sec < 6) return '正在汇总该类别的帐存数量'
    if (sec < 10) return '正在计算实存与可用数量'
    if (sec < 18) return '正在统计在途数量并整理结果'
    return '分类范围较大，后台仍在统计'
  }
  if (profile.isWideRange) {
    if (sec < 3) return '正在汇总全仓入库与出库'
    if (sec < 6) return '正在计算帐存与实存数量'
    if (sec < 10) return '正在统计在途数量'
    if (sec < 18) return '正在整理报表并筛选结果'
    return '查询范围较大，后台仍在统计'
  }
  return '正在统计库存'
}

function formatQueryProgressElapsed(elapsedMs) {
  const sec = elapsedMs / 1000
  return sec < 10 ? sec.toFixed(1) : String(Math.floor(sec))
}

const queryProgressBootStageText = computed(() => resolveQueryProgressStageText(0, queryProgressProfile))

function ensureQueryProgressWorker() {
  if (queryProgressWorker) return queryProgressWorker
  // 独立线程计时：主线程忙于解析大报表 JSON 时，秒表仍持续推进
  const workerScript = [
    'let timer = null',
    'self.onmessage = function (event) {',
    '  var action = event.data',
    "  if (action === 'start') {",
    '    var startedAt = Date.now()',
    '    if (timer) clearInterval(timer)',
    '    timer = setInterval(function () {',
    "      self.postMessage({ elapsedMs: Date.now() - startedAt })",
    '    }, 200)',
    "  } else if (action === 'stop') {",
    '    if (timer) clearInterval(timer)',
    '    timer = null',
    '  }',
    '}',
  ].join('\n')
  const blob = new Blob([workerScript], { type: 'application/javascript' })
  queryProgressWorkerBlobUrl = URL.createObjectURL(blob)
  queryProgressWorker = new Worker(queryProgressWorkerBlobUrl)
  queryProgressWorker.onmessage = (event) => {
    paintQueryProgressUi(event.data?.elapsedMs ?? 0)
  }
  return queryProgressWorker
}

function disposeQueryProgressWorker() {
  if (!queryProgressWorker) return
  queryProgressWorker.postMessage('stop')
  queryProgressWorker.terminate()
  if (queryProgressWorkerBlobUrl) {
    URL.revokeObjectURL(queryProgressWorkerBlobUrl)
    queryProgressWorkerBlobUrl = ''
  }
  queryProgressWorker = null
}

function paintQueryProgressUi(elapsedMs) {
  const stageEl = queryProgressStageEl.value
  if (stageEl) {
    stageEl.textContent = resolveQueryProgressStageText(elapsedMs)
  }
  const elapsedEl = queryProgressElapsedEl.value
  if (elapsedEl) {
    elapsedEl.textContent = formatQueryProgressElapsed(elapsedMs)
  }
  const aliveHintEl = queryProgressAliveHintEl.value
  if (aliveHintEl) {
    aliveHintEl.classList.toggle('is-visible', elapsedMs >= 6000)
  }
}

function markQueryProgressRendering(totalCount, renderedCount = 0) {
  queryProgressProfile.rendering = true
  queryProgressProfile.renderTotal = totalCount
  queryProgressProfile.renderDone = renderedCount
  const stageEl = queryProgressStageEl.value
  if (stageEl) {
    stageEl.textContent = resolveQueryProgressStageText(0)
  }
}

/** 大结果集分批写入表格，避免主线程长时间阻塞导致进度秒表假死 */
async function applyReportRowsInChunks(list) {
  const rows = Array.isArray(list) ? list : []
  if (rows.length <= REPORT_ROWS_CHUNK_SIZE) {
    reportRows.value = rows
    return
  }
  reportRows.value = []
  for (let i = 0; i < rows.length; i += REPORT_ROWS_CHUNK_SIZE) {
    reportRows.value = reportRows.value.concat(rows.slice(i, i + REPORT_ROWS_CHUNK_SIZE))
    markQueryProgressRendering(rows.length, reportRows.value.length)
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
}
const formRef = ref()
const printConfig = reactive({ info: '' })
const printLogoSrc = ref('')
const reportGeneratedAt = ref('')
const reportCode = ref('')
const reportRows = ref([])
const reportContext = reactive({ cutoffDate: '', warehouseCode: '', warehouseLabel: '' })

const form = reactive({
  cutoffDate: '',
  warehouseCode: '',
  materialCode: '',
  materialName: '',
  materialNameEn: '',
  materialSpec: '',
  materialCategoryCodes: [],
  materialCategoryNames: '',
  unit: '',
  colorCode: '',
  onlyMaterial: true,
  onlyFinished: false,
  nonZero: true,
  availableNegative: false,
  dormantDaysGt: 0,
})

const warehouseOptions = ref([])
const categoryOptions = ref([])
const categoryPickerVisible = ref(false)
const categorySelectionDraft = ref([])
const categoryKeyword = ref('')
const categoryPage = ref(1)
const categoryPageSize = ref(10)
const categoryTotal = ref(0)
const colorOptions = ref([])
const STOCK_STATS_COLUMN_SETTING_KEY = 'erp.stockStats.columnSetting.v1'
const STOCK_STATS_EXPORT_TITLE = '库存统计表'
const ALL_WAREHOUSE = '__ALL__'
const STOCK_STATS_EXPORT_THIN_BORDER = {
  top: { style: 'thin', color: { argb: 'FF333333' } },
  left: { style: 'thin', color: { argb: 'FF333333' } },
  bottom: { style: 'thin', color: { argb: 'FF333333' } },
  right: { style: 'thin', color: { argb: 'FF333333' } },
}
const STOCK_STATS_EXPORT_HEADER_FILL = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FFF0F0F0' },
}
const reportColumns = [
  { key: 'categoryText', label: '类别编码', width: 140, isQty: false },
  { key: 'location', label: '产地', width: 90, isQty: false },
  { key: 'materialCode', label: '物料编码', minWidth: 140, isQty: false },
  { key: 'materialName', label: '物料名称', minWidth: 220, isQty: false },
  { key: 'materialNameEn', label: '英文名称', minWidth: 220, isQty: false },
  { key: 'materialSpec', label: '规格', minWidth: 160, isQty: false },
  { key: 'colorCode', label: '颜色编码', width: 100, isQty: false },
  { key: 'colorName', label: '颜色名称', width: 110, isQty: false },
  { key: 'unit', label: '单位', width: 70, isQty: false },
  // 数量列默认给足宽度，确保列名与数据都完整显示，不依赖用户手动拖拽。
  { key: 'bookedQty', label: '帐存数量', width: 130, isQty: true, format: 'qty' },
  { key: 'unapprovedInQty', label: '入库未审数量', width: 150, isQty: true, format: 'qty' },
  { key: 'actualQty', label: '实存数量', width: 130, isQty: true, format: 'qty' },
  { key: 'inTransitQty', label: '在途数量', width: 130, isQty: true, format: 'qty' },
  { key: 'availableQty', label: '可用数量', width: 130, isQty: true, format: 'qty' },
  { key: 'lastInDate', label: '最后入库日期', width: 140, isQty: false },
  { key: 'lastOutDate', label: '最后出库日期', width: 140, isQty: false },
]
const defaultColumnKeys = reportColumns.map((col) => col.key)
const checkedColumnKeys = ref([...defaultColumnKeys])
const visibleReportColumns = computed(() => {
  const selected = new Set(checkedColumnKeys.value)
  return reportColumns.filter((col) => selected.has(col.key))
})

const rules = {
  cutoffDate: [{ required: true, message: '库存截止日期不能为空', trigger: 'change' }],
  warehouseCode: [{ required: true, message: '仓库不能为空', trigger: 'change' }],
}

function makeReportCode() {
  const raw = `${Date.now()}${Math.random().toString(16).slice(2)}`
  return raw.toUpperCase().replace(/[^0-9A-F]/g, '').slice(0, 16)
}

function formatNow() {
  const d = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

function formatQty(value) {
  const n = Number(value)
  if (!Number.isFinite(n)) return '0.000'
  return n.toFixed(3).replace(/\.?0+$/, '') || '0'
}

function normalizeColumnKeys(keys) {
  if (!Array.isArray(keys)) return []
  const allowSet = new Set(reportColumns.map((col) => col.key))
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
    localStorage.setItem(STOCK_STATS_COLUMN_SETTING_KEY, JSON.stringify(checkedColumnKeys.value))
  } catch {
    // 本地存储失败不影响页面主流程。
  }
}

function loadColumnSetting() {
  try {
    const raw = localStorage.getItem(STOCK_STATS_COLUMN_SETTING_KEY)
    if (!raw) return
    const parsed = JSON.parse(raw)
    const keys = normalizeColumnKeys(parsed)
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
}

function resetColumnSetting() {
  checkedColumnKeys.value = [...defaultColumnKeys]
  persistColumnSetting()
  ElMessage.success('已恢复默认列显示')
}

function formatReportCell(row, col) {
  if (!row || !col) return ''
  const value = row[col.key]
  if (col.format === 'qty') return formatQty(value)
  return value ?? ''
}

function stockStatsExportFileName() {
  const date = String(reportContext.cutoffDate || form.cutoffDate || '').trim() || '未查询'
  const warehouse = String(reportContext.warehouseLabel || form.warehouseCode || '').trim() || '全部仓库'
  const safe = `${STOCK_STATS_EXPORT_TITLE}-${date}-${warehouse}`.replace(/[\\/:*?"<>|]/g, '_').slice(0, 160)
  return `${safe || STOCK_STATS_EXPORT_TITLE}.xlsx`
}

function applyStockStatsExportRowStyle(row, opts = {}) {
  row.eachCell((cell) => {
    cell.border = STOCK_STATS_EXPORT_THIN_BORDER
    cell.alignment = {
      horizontal: opts.horizontal || 'center',
      vertical: 'middle',
      wrapText: true,
    }
    if (opts.bold) cell.font = { ...(cell.font || {}), bold: true }
    if (opts.fill) cell.fill = opts.fill
  })
}

function addStockStatsExportMetaRow(ws, leftText, rightText, colCount) {
  if (colCount <= 1) {
    const row = ws.addRow([`${leftText}　${rightText}`])
    return row
  }
  const row = ws.addRow([leftText, rightText])
  const splitCol = Math.max(1, Math.floor(colCount / 2))
  ws.mergeCells(row.number, 1, row.number, splitCol)
  ws.mergeCells(row.number, splitCol + 1, row.number, colCount)
  return row
}

async function exportReportXlsx() {
  if (!reportRows.value.length) {
    ElMessage.warning('暂无数据可导出')
    return
  }
  const columns = visibleReportColumns.value
  if (!columns.length) {
    ElMessage.warning('至少保留一列后再导出')
    return
  }

  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet(STOCK_STATS_EXPORT_TITLE, {
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
  const titleRow = ws.addRow([STOCK_STATS_EXPORT_TITLE])
  ws.mergeCells(titleRow.number, 1, titleRow.number, colCount)
  titleRow.font = { bold: true, size: 14 }
  ws.getCell(titleRow.number, 1).alignment = { horizontal: 'center', vertical: 'middle' }

  addStockStatsExportMetaRow(
    ws,
    `报表生成时间：${reportGeneratedAt.value || ''}`,
    `报表代码：${reportCode.value || ''}`,
    colCount,
  )
  addStockStatsExportMetaRow(
    ws,
    `查询截止时间：${reportContext.cutoffDate || form.cutoffDate || ''}`,
    `仓库：${reportContext.warehouseLabel || form.warehouseCode || ''}`,
    colCount,
  )

  const countRow = ws.addRow([`统计完毕，一共：${reportRows.value.length} 条记录`])
  ws.mergeCells(countRow.number, 1, countRow.number, colCount)
  ws.addRow([])

  const headRow = ws.addRow(columns.map((col) => col.label))
  applyStockStatsExportRowStyle(headRow, { bold: true, fill: STOCK_STATS_EXPORT_HEADER_FILL })

  for (const row of reportRows.value) {
    const added = ws.addRow(columns.map((col) => formatReportCell(row, col)))
    applyStockStatsExportRowStyle(added)
  }

  ws.columns.forEach((col, index) => {
    const reportCol = columns[index]
    col.width = Math.max(10, Math.min(36, Math.round((reportCol?.width || reportCol?.minWidth || 120) / 8)))
  })

  const buf = await wb.xlsx.writeBuffer()
  const blob = new Blob([buf], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = stockStatsExportFileName()
  a.click()
  URL.revokeObjectURL(url)
  ElMessage.success('已导出 xlsx')
}

function formatWarehouseLabel(item) {
  return `${String(item?.code ?? '').trim()} ${String(item?.name ?? '').trim()}`.trim()
}

function currentWarehouseLabel() {
  if (form.warehouseCode === ALL_WAREHOUSE) return '全部仓库'
  const hit = warehouseOptions.value.find((row) => String(row.code ?? '').trim() === String(form.warehouseCode ?? '').trim())
  return hit ? formatWarehouseLabel(hit) : form.warehouseCode || ''
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

function formatColorLabel(item) {
  return `${String(item?.code ?? '').trim()} ${String(item?.name ?? '').trim()}`.trim()
}

async function loadPrintConfig() {
  try {
    const { data } = await axios.get('/api/stock-stats/print-header')
    const cfg = data?.data ?? {}
    printConfig.info = cfg.headerHtml || cfg.info || ''
    printLogoSrc.value = cfg.logoSrc || ''
  } catch {
    // 抬头读取失败不影响报表查询。
  }
}

async function fetchWarehouses(keyword = '') {
  try {
    const { data } = await axios.get('/api/stock-stats/warehouse-options', { params: { keyword } })
    warehouseOptions.value = Array.isArray(data?.data?.list) ? data.data.list : []
  } catch {
    warehouseOptions.value = []
  }
}

async function fetchMaterials(keyword = '') {
  try {
    const { data } = await axios.get('/api/stock-stats/material-options', { params: { keyword } })
    return Array.isArray(data?.data?.list) ? data.data.list : []
  } catch {
    return []
  }
}

async function queryMaterialCodeSuggestions(keyword, cb) {
  const list = await fetchMaterials(keyword)
  cb(
    list.map((item) => ({
      value: String(item?.code ?? '').trim(),
    })),
  )
}

async function fetchCategories() {
  try {
    const { data } = await axios.get('/api/stock-stats/category-options', {
      params: {
        keyword: categoryKeyword.value,
        page: categoryPage.value,
        pageSize: categoryPageSize.value,
      },
    })
    categoryOptions.value = Array.isArray(data?.data?.list) ? data.data.list : []
    categoryTotal.value = Number(data?.data?.total ?? 0)
  } catch {
    categoryOptions.value = []
    categoryTotal.value = 0
  }
}

async function openCategoryPicker() {
  categoryKeyword.value = ''
  categoryPage.value = 1
  categorySelectionDraft.value = form.materialCategoryCodes.map((code, index) => ({
    code: String(code ?? '').trim(),
    name: String(form.materialCategoryNames.split(',')[index] ?? '').trim(),
  })).filter((item) => item.code)
  await fetchCategories()
  categoryPickerVisible.value = true
}

function isCategorySelected(row) {
  const code = String(row?.code ?? '').trim()
  return categorySelectionDraft.value.some((item) => item.code === code)
}

function toggleCategorySelection(row) {
  const code = String(row?.code ?? '').trim()
  if (!code) return
  const index = categorySelectionDraft.value.findIndex((item) => item.code === code)
  if (index >= 0) {
    categorySelectionDraft.value.splice(index, 1)
    return
  }
  categorySelectionDraft.value.push({ code, name: String(row?.name ?? '').trim() })
}

function searchCategories() {
  categoryPage.value = 1
  fetchCategories()
}

function onCategoryPageSizeChange() {
  categoryPage.value = 1
  fetchCategories()
}

function confirmCategorySelection() {
  form.materialCategoryCodes = categorySelectionDraft.value.map((item) => item.code)
  form.materialCategoryNames = categorySelectionDraft.value.map((item) => item.name).filter(Boolean).join(',')
  categoryPickerVisible.value = false
}

function resetCategorySelection() {
  form.materialCategoryCodes = []
  form.materialCategoryNames = ''
  categorySelectionDraft.value = []
}

async function fetchColors(keyword = '') {
  try {
    const { data } = await axios.get('/api/stock-stats/color-options', { params: { keyword } })
    colorOptions.value = Array.isArray(data?.data?.list) ? data.data.list : []
  } catch {
    colorOptions.value = []
  }
}

function syncTypeSwitch(kind) {
  if (kind === 'material' && form.onlyMaterial) form.onlyFinished = false
  if (kind === 'finished' && form.onlyFinished) form.onlyMaterial = false
}

function openQueryDialog() {
  if (!form.warehouseCode) form.warehouseCode = pickDefaultWarehouseCode()
  dialogVisible.value = true
}

function isCategoryBulkQuery() {
  return form.materialCategoryCodes.length > 0
}

function hasNarrowReportCondition() {
  return [
    form.materialCode,
    form.materialName,
    form.materialNameEn,
    form.materialSpec,
    ...form.materialCategoryCodes,
    form.unit,
    form.colorCode,
  ].some((v) => String(v ?? '').trim() !== '')
}

function isWideRangeReportQuery() {
  return isCategoryBulkQuery() || !hasNarrowReportCondition()
}

function resolveReportTimeoutMs() {
  return isWideRangeReportQuery() ? REPORT_TIMEOUT_CATEGORY_MS : REPORT_TIMEOUT_NORMAL_MS
}

function stopQueryProgressTimer() {
  if (queryProgressWorker) {
    queryProgressWorker.postMessage('stop')
  }
  queryProgress.active = false
  queryProgress.isCategory = false
  queryProgress.isWideRange = false
}

function startQueryProgressTimer(isCategory, isWideRange) {
  stopQueryProgressTimer()
  queryProgressProfile = {
    isCategory,
    isWideRange,
    rendering: false,
    renderTotal: 0,
    renderDone: 0,
  }
  queryProgress.active = true
  queryProgress.isCategory = isCategory
  queryProgress.isWideRange = isWideRange
  nextTick(() => {
    paintQueryProgressUi(0)
    const worker = ensureQueryProgressWorker()
    worker.postMessage('start')
  })
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
  if (!form.cutoffDate || !form.warehouseCode) {
    dialogVisible.value = true
    return
  }
  const categoryQuery = isCategoryBulkQuery()
  loading.value = true
  const wideRangeQuery = isWideRangeReportQuery()
  startQueryProgressTimer(categoryQuery, wideRangeQuery)
  try {
    const params = {
      cutoffDate: form.cutoffDate,
      warehouseCode: form.warehouseCode,
      materialCode: String(form.materialCode ?? '').trim(),
      materialName: form.materialName,
      materialNameEn: form.materialNameEn,
      materialSpec: form.materialSpec,
      materialCategoryCodes: form.materialCategoryCodes.join(','),
      unit: form.unit,
      colorCode: form.colorCode,
      onlyMaterial: form.onlyMaterial ? '1' : '0',
      onlyFinished: form.onlyFinished ? '1' : '0',
      nonZero: form.nonZero ? '1' : '0',
      availableNegative: form.availableNegative ? '1' : '0',
      dormantDaysGt: form.dormantDaysGt || 0,
    }
    const { data } = await axios.get('/api/stock-stats/report', { params, timeout: resolveReportTimeoutMs() })
    const body = data?.data ?? {}
    const list = Array.isArray(body.list) ? body.list : []
    // 接口已返回：先关查询弹窗并切到渲染阶段，避免秒表停在 6.x 而表格还在刷
    dialogVisible.value = false
    markQueryProgressRendering(list.length)
    await applyReportRowsInChunks(list)
    reportContext.cutoffDate = body.cutoffDate || form.cutoffDate
    reportContext.warehouseCode = body.warehouseCode || form.warehouseCode
    reportContext.warehouseLabel = body.allWarehouse ? '全部仓库' : currentWarehouseLabel()
    reportGeneratedAt.value = formatNow()
    reportCode.value = makeReportCode()
    ElMessage.success('统计完成')
  } catch (e) {
    ElMessage.error(String(e?.response?.data?.msg ?? e?.message ?? '读取库存统计报表失败'))
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
  if (!loading.value) {
    stopQueryProgressTimer()
  }
}

function onPrint() {
  if (!reportRows.value.length) {
    ElMessage.warning('暂无数据可打印')
    return
  }
  window.print()
}

onBeforeUnmount(() => {
  stopQueryProgressTimer()
  disposeQueryProgressWorker()
})

onMounted(async () => {
  await Promise.all([loadPrintConfig(), fetchWarehouses(''), fetchCategories(), fetchColors('')])
  loadColumnSetting()
  const today = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  form.cutoffDate = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`
  form.warehouseCode = pickDefaultWarehouseCode()
  // 首次进入页面不自动跑统计，避免首屏长时间 loading.
  // 由用户在查询弹窗点“确定”后再触发查询。
})
</script>

<style scoped>
.stock-stats-page {
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

.stock-toolbar :deep(.el-button) {
  border-radius: 0;
  padding: 5px 10px;
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

.category-condition-control {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto auto;
  gap: 8px;
  width: 100%;
}

.category-picker-tip {
  margin-bottom: 10px;
  color: #606266;
  font-size: 13px;
}

.category-picker-search {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 8px;
  margin-bottom: 12px;
}

.category-select-button {
  min-width: 68px;
}

.category-picker-pagination {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-top: 12px;
  color: #606266;
  font-size: 13px;
}

.report-shell {
  padding: 18px 40px 28px;
  background: #fff;
  border: 1px solid #d8dce5;
}

.report-header {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
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
  color: #909399;
  font-size: 14px;
}

.head-info-html :deep(*) {
  margin-top: 0;
  margin-bottom: 0;
  color: #000;
}

.report-title {
  margin: 8px 0;
  text-align: center;
  color: #000;
  font-size: 20px;
  font-weight: 700;
}

.report-meta {
  margin-top: 3px;
  color: #000;
  font-size: 13px;
}

.report-done {
  margin: 14px 0 4px;
  padding-left: 10px;
  color: red;
  font-size: 13px;
  font-weight: 700;
}

.meta-gap {
  margin-left: 18px;
}

.meta-value {
  display: inline-block;
  min-width: 100px;
}

.legacy-table-wrap {
  overflow-x: auto;
}

.legacy-report-table {
  width: 100%;
  font-size: 12px;
}

.legacy-report-table :deep(.el-table__cell) {
  padding: 2px 0;
}

.legacy-report-table :deep(td.qty-col .cell),
.legacy-report-table :deep(th.qty-col .cell) {
  white-space: nowrap;
}

.query-tip {
  margin-bottom: 12px;
  color: #606266;
  font-size: 13px;
}

.query-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 6px 18px;
}

.query-grid :deep(.el-form-item) {
  margin-bottom: 10px;
}

.inline-suffix {
  margin-left: 8px;
  color: #606266;
}

.query-progress-panel {
  margin-top: 4px;
  padding: 12px 14px;
  border: 1px solid #dcdfe6;
  border-radius: 4px;
  background: #f5f7fa;
  animation: query-progress-breathe 2.4s ease-in-out infinite;
}

.stock-stats-query-progress-overlay {
  position: fixed;
  inset: 0;
  z-index: 4000;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.2);
}

.stock-stats-query-progress-overlay .query-progress-panel {
  width: min(520px, calc(100vw - 32px));
  margin-top: 0;
  box-shadow: 0 10px 28px rgba(0, 0, 0, 0.14);
}

.query-progress-head {
  display: flex;
  align-items: center;
  gap: 8px;
}

.query-progress-spinner {
  font-size: 18px;
  color: var(--el-color-primary);
  animation: query-progress-spin 0.9s linear infinite;
  will-change: transform;
}

.query-progress-stage {
  color: #303133;
  font-size: 13px;
  font-weight: 500;
}

.query-progress-bar {
  position: relative;
  margin-top: 10px;
  height: 6px;
  border-radius: 3px;
  background: #e4e7ed;
  overflow: hidden;
}

.query-progress-bar-inner {
  position: absolute;
  top: 0;
  left: 0;
  width: 42%;
  height: 100%;
  border-radius: 3px;
  background: linear-gradient(90deg, #79bbff 0%, var(--el-color-primary) 50%, #79bbff 100%);
  animation: query-progress-slide 1.1s ease-in-out infinite;
  will-change: transform;
}

.query-progress-bar-inner--delay {
  width: 28%;
  opacity: 0.55;
  animation-duration: 1.6s;
  animation-delay: 0.35s;
}

.query-progress-text {
  margin: 10px 0 0;
  color: #606266;
  font-size: 13px;
}

.query-progress-elapsed {
  display: inline-block;
  min-width: 28px;
  text-align: center;
  font-variant-numeric: tabular-nums;
  color: #303133;
  font-weight: 600;
}

.query-progress-dots {
  display: inline-flex;
  gap: 3px;
  margin-left: 4px;
  vertical-align: middle;
}

.query-progress-dots i {
  width: 4px;
  height: 4px;
  border-radius: 50%;
  background: #909399;
  animation: query-progress-dot-bounce 1s ease-in-out infinite;
  will-change: transform, opacity;
}

.query-progress-dots i:nth-child(2) {
  animation-delay: 0.15s;
}

.query-progress-dots i:nth-child(3) {
  animation-delay: 0.3s;
}

.query-progress-hint {
  margin: 8px 0 0;
  color: #606266;
  font-size: 12px;
}

.query-progress-alive-hint {
  display: none;
  margin: 4px 0 0;
  color: #e6a23c;
  font-size: 12px;
}

.query-progress-alive-hint.is-visible {
  display: block;
}

@keyframes query-progress-spin {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}

@keyframes query-progress-slide {
  0% {
    transform: translateX(-120%);
  }
  100% {
    transform: translateX(320%);
  }
}

@keyframes query-progress-dot-bounce {
  0%,
  80%,
  100% {
    transform: translateY(0);
    opacity: 0.35;
  }
  40% {
    transform: translateY(-3px);
    opacity: 1;
  }
}

@keyframes query-progress-breathe {
  0%,
  100% {
    border-color: #dcdfe6;
    background: #f5f7fa;
  }
  50% {
    border-color: #c6e2ff;
    background: #ecf5ff;
  }
}

.print-document {
  display: none;
}

@media print {
  .no-print,
  .el-dialog,
  .report-shell {
    display: none !important;
  }

  .stock-stats-page {
    padding: 0;
    background: #fff;
  }

  .print-document {
    display: block !important;
    color: #000;
  }

  .print-table {
    width: 100%;
    border-collapse: collapse;
    table-layout: fixed;
  }

  .print-table th,
  .print-table td {
    border: 1px solid #333;
    padding: 3px 4px;
    font-size: 10px;
    line-height: 14px;
    text-align: center;
    word-break: break-all;
  }

  .print-table th.qty-col,
  .print-table td.qty-col {
    white-space: nowrap;
    word-break: normal;
  }
}
</style>
