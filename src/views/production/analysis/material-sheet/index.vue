<template>
  <div class="erp-module-page material-sheet-page">
    <div class="top-search-row no-print">
      <el-autocomplete
        v-model="piKeyword"
        :fetch-suggestions="fetchPiSuggestions"
        value-key="piNo"
        clearable
        class="pi-search"
        placeholder="请输入 PI 号"
        @select="onPickPi"
        @clear="clearReport"
        @keyup.enter="loadReport"
      />
      <el-button type="primary" @click="loadReport">查询内容</el-button>
    </div>

    <div class="report-shell">
      <div class="report-action-strip no-print">
        <el-button
          :type="activeTab === 'detail' ? 'warning' : 'primary'"
          size="small"
          @click="activeTab = 'detail'"
        >
          物料单统计表1（明细）
        </el-button>
        <el-button
          :type="activeTab === 'summary' ? 'warning' : 'primary'"
          size="small"
          @click="activeTab = 'summary'"
        >
          物料单统计表（汇总）
        </el-button>
        <el-button type="primary" size="small">外协清单</el-button>
        <el-button type="primary" size="small">位置裁片清单(包含非外协)</el-button>
        <el-button type="primary" size="small">生产清单</el-button>
        <el-button type="primary" size="small">生产标签</el-button>
        <el-button type="primary" size="small">导出为PDF信息</el-button>
        <el-button type="primary" size="small" @click="exportMaterialSheetXls">导出为xls信息</el-button>
      </div>

      <div class="report-tool-row no-print">
        <el-button size="small" type="primary" @click="onPrintMaterialSheet">打印统计报表</el-button>
        <el-button size="small" type="primary">打印预览</el-button>
        <el-button size="small" type="primary">保存报表数据</el-button>
        <el-button size="small" type="primary">查询内容</el-button>
      </div>

      <div class="report-meta-row no-print">
        <span>报表生成时间：</span><span class="underline">{{ generatedAt }}</span>
        <span>报表代码：</span><span class="underline">{{ reportCode }}</span>
      </div>

      <div v-loading="loading" class="report-body">
        <template v-if="activeTab === 'detail'">
          <template v-if="detailGroups.length">
            <section
              v-for="group in detailGroups"
              :key="group.key"
              class="product-section"
            >
              <ReportHeader :header="group.header" />
              <div class="report-table-wrap">
                <table class="report-table">
                  <thead>
                    <tr>
                      <th class="col-index">序号</th>
                      <th class="col-code">编码</th>
                      <th>名称</th>
                      <th>规格</th>
                      <th class="col-unit">单位</th>
                      <th class="col-match">备注</th>
                      <th class="col-num">用量</th>
                      <th class="col-num">损耗</th>
                      <th class="col-num">合计</th>
                      <th class="col-num">单物料合计</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="(row, idx) in group.rows" :key="row.__materialCostRowKey ?? `${group.key}-${idx}`">
                      <td>{{ idx + 1 }}</td>
                      <td>{{ row.kcaa01 }}</td>
                      <td>{{ row.kcaa02 }}</td>
                      <td>{{ row.kcaa03 }}</td>
                      <td>{{ row.kcaa04 }}</td>
                      <td>{{ row.Describe }}</td>
                      <td>{{ formatQty(scaleByOrderQty(row.yl, group)) }}</td>
                      <td>{{ formatLoss(row.loss_rate) }}</td>
                      <td>{{ formatQty(lineTotalQty(row, group)) }}</td>
                      <td>{{ formatQty(singleMaterialTotal(row, group)) }}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </section>
          </template>
          <el-empty v-else description="请选择 PI 号并查询物料单明细" />
        </template>

        <template v-else>
          <ReportHeader :header="summaryHeader" compact />
          <div v-if="consumptionLines.length" class="report-table-wrap">
            <table class="report-table">
              <thead>
                <tr>
                  <th class="col-index">序号</th>
                  <th class="col-code">ERP编码</th>
                  <th>名称</th>
                  <th>规格</th>
                  <th class="col-match">搭配</th>
                  <th class="col-unit">单位</th>
                  <th class="col-num">用量</th>
                  <th class="col-num">损耗</th>
                  <th class="col-num">合计</th>
                  <th class="col-num">单物料合计</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="(row, idx) in consumptionLines" :key="row.id ?? idx">
                  <td>{{ idx + 1 }}</td>
                  <td>{{ row.kcaa01 }}</td>
                  <td>{{ row.kcaa02 }}</td>
                  <td>{{ row.kcaa03 }}</td>
                  <td>{{ row.Describe }}</td>
                  <td>{{ row.kcaa04 }}</td>
                  <td>{{ formatQty(row.sumay) }}</td>
                  <td>{{ formatLoss(row.kcac05) }}</td>
                  <td>{{ formatQty(row.sumby) }}</td>
                  <td>{{ formatQty(summarySingleMaterialTotal(row)) }}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <el-empty v-else description="请选择 PI 号并查询物料单汇总" />
        </template>
      </div>
    </div>

    <section class="material-sheet-print-document" aria-hidden="true">
      <p class="material-sheet-print-time">打印时间：{{ printTimestamp }}</p>
      <template v-if="activeTab === 'detail'">
        <div
          v-for="group in detailGroups"
          :key="`print-detail-${group.key}`"
          class="material-sheet-print-section"
        >
          <p class="material-sheet-print-brand">{{ REPORT_BRAND }}</p>
          <p class="material-sheet-print-title">{{ REPORT_TITLE }}</p>
          <div
            v-for="(fieldRow, rowIdx) in DETAIL_HEADER_FIELD_ROWS"
            :key="`print-head-${group.key}-${rowIdx}`"
            class="material-sheet-print-head-row"
          >
            <span
              v-for="([label, key]) in fieldRow"
              :key="`${group.key}-${key}`"
              class="material-sheet-print-head-item"
            >{{ label }}：{{ formatHeaderValue(group.header?.[key], key) }}</span>
          </div>
          <table class="material-sheet-print-table">
            <thead>
              <tr>
                <th>序号</th>
                <th>编码</th>
                <th>名称</th>
                <th>规格</th>
                <th>单位</th>
                <th>备注</th>
                <th>用量</th>
                <th>损耗</th>
                <th>合计</th>
                <th>单物料合计</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(row, idx) in group.rows" :key="`print-row-${row.__materialCostRowKey ?? idx}`">
                <td>{{ idx + 1 }}</td>
                <td>{{ row.kcaa01 }}</td>
                <td>{{ row.kcaa02 }}</td>
                <td>{{ row.kcaa03 }}</td>
                <td>{{ row.kcaa04 }}</td>
                <td>{{ row.Describe }}</td>
                <td class="num">{{ formatQty(scaleByOrderQty(row.yl, group)) }}</td>
                <td class="num">{{ formatLoss(row.loss_rate) }}</td>
                <td class="num">{{ formatQty(lineTotalQty(row, group)) }}</td>
                <td class="num">{{ formatQty(singleMaterialTotal(row, group)) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </template>
      <template v-else>
        <div v-if="consumptionLines.length" class="material-sheet-print-section">
          <p class="material-sheet-print-brand">{{ REPORT_BRAND }}</p>
          <p class="material-sheet-print-title">{{ REPORT_TITLE }}</p>
          <div class="material-sheet-print-head-row">
            <span class="material-sheet-print-head-item">PI号：{{ formatHeaderValue(summaryHeader.piNo, 'piNo') }}</span>
            <span class="material-sheet-print-head-item">PO号：{{ formatHeaderValue(summaryHeader.poNo, 'poNo') }}</span>
            <span class="material-sheet-print-head-item">日期：{{ formatHeaderValue(summaryHeader.salesDate, 'salesDate') }}</span>
          </div>
          <table class="material-sheet-print-table">
            <thead>
              <tr>
                <th>序号</th>
                <th>ERP编码</th>
                <th>名称</th>
                <th>规格</th>
                <th>搭配</th>
                <th>单位</th>
                <th>用量</th>
                <th>损耗</th>
                <th>合计</th>
                <th>单物料合计</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(row, idx) in consumptionLines" :key="`print-sum-${row.id ?? idx}`">
                <td>{{ idx + 1 }}</td>
                <td>{{ row.kcaa01 }}</td>
                <td>{{ row.kcaa02 }}</td>
                <td>{{ row.kcaa03 }}</td>
                <td>{{ row.Describe }}</td>
                <td>{{ row.kcaa04 }}</td>
                <td class="num">{{ formatQty(row.sumay) }}</td>
                <td class="num">{{ formatLoss(row.kcac05) }}</td>
                <td class="num">{{ formatQty(row.sumby) }}</td>
                <td class="num">{{ formatQty(summarySingleMaterialTotal(row)) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </template>
    </section>
  </div>
</template>

<script setup>
// 与 router 生成的 route.name 一致，供布局 keep-alive 按组件名缓存
defineOptions({ name: 'production-analysis-material-sheet' })

import { computed, defineComponent, h, nextTick, ref } from 'vue'
import { ElMessage } from 'element-plus'
import axios from 'axios'
import ExcelJS from 'exceljs'
import { aggregateBomCostUsageFlatForDisplay } from '@/utils/bomCostUsageAggregate.js'

const REPORT_BRAND = '中山市卓越皮具有限公司'
const REPORT_TITLE = '成本物料单统计报表（成本价物料明细）'
const MATERIAL_SHEET_COL_COUNT = 10

const SUMMARY_HEADER_FIELD_ROWS = [
  [
    ['PI号', 'piNo'],
    ['PO号', 'poNo'],
    ['日期', 'salesDate'],
  ],
]

const DETAIL_HEADER_FIELD_ROWS = [
  ...SUMMARY_HEADER_FIELD_ROWS,
  [
    ['厂款号', 'factoryStyleNo'],
    ['名称', 'productName'],
    ['单品用量', 'singleUsage'],
  ],
  [
    ['客款号', 'customerStyleNo'],
    ['组别', 'groupName'],
    ['订单量', 'orderQty'],
  ],
]

const DETAIL_EXPORT_HEADERS = ['序号', '编码', '名称', '规格', '单位', '备注', '用量', '损耗', '合计', '单物料合计']
const SUMMARY_EXPORT_HEADERS = ['序号', 'ERP编码', '名称', '规格', '搭配', '单位', '用量', '损耗', '合计', '单物料合计']
const MATERIAL_SHEET_EXPORT_COL_WIDTHS = [8, 18, 18, 18, 8, 14, 12, 10, 12, 14]
const MATERIAL_SHEET_EXPORT_THIN_BORDER = {
  top: { style: 'thin', color: { argb: 'FF333333' } },
  left: { style: 'thin', color: { argb: 'FF333333' } },
  bottom: { style: 'thin', color: { argb: 'FF333333' } },
  right: { style: 'thin', color: { argb: 'FF333333' } },
}
const MATERIAL_SHEET_EXPORT_HEADER_FILL = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FFF0F0F0' },
}
const MATERIAL_SHEET_PRINT_PAGE_STYLE_ID = 'material-sheet-print-page-style'

const BOM_COST_BUILTIN_HIDE_PREFIXES = [
  'CUT-',
  'PQ-',
  'BAG-',
  'OUT',
  'TAG-',
  'ATG-',
  'KEY-',
  'STRAP-',
  'SP-',
  'SS-',
  'GS-',
  'HD-',
  'PS-',
  'CP-',
  'RP-PQ',
  'RMP-',
  'RCP-',
  'HL-',
  'CH-',
  'REM-',
  'MAK-',
  'RA-',
  'PEN-',
  'CRAD-',
  'RAIN-',
  'SA-',
  'BELT-',
  'ARH-',
  'SSB-',
  'PB-',
  'DS-',
  'ASB-',
]

const ReportHeader = defineComponent({
  name: 'ReportHeader',
  props: {
    header: {
      type: Object,
      default: () => ({}),
    },
    /** 汇总表：仅展示 PI号 / PO号 / 日期 */
    compact: {
      type: Boolean,
      default: false,
    },
  },
  setup(props) {
    const fields = [
      [
        ['PI号', 'piNo'],
        ['PO号', 'poNo'],
        ['日期', 'salesDate'],
      ],
      [
        ['厂款号', 'factoryStyleNo'],
        ['名称', 'productName'],
        ['单品用量', 'singleUsage'],
      ],
      [
        ['客款号', 'customerStyleNo'],
        ['组别', 'groupName'],
        ['订单量', 'orderQty'],
      ],
    ]
    const visibleFields = computed(() => (props.compact ? fields.slice(0, 1) : fields))
    return () =>
      h('div', { class: 'blank-report-head' }, [
        h('div', { class: 'brand-line' }, '中山市卓越皮具有限公司'),
        h('div', { class: 'report-title' }, '成本物料单统计报表（成本价物料明细）'),
        h(
          'div',
          { class: 'head-grid' },
          visibleFields.value.map((row) =>
            h(
              'div',
              { class: 'head-row' },
              row.map(([label, key]) =>
                h('div', { class: 'head-field' }, [
                  h('span', { class: 'head-label' }, `${label}：`),
                  h('span', { class: 'head-value' }, formatHeaderValue(props.header?.[key], key)),
                ]),
              ),
            ),
          ),
        ),
      ])
  },
})

const piKeyword = ref('')
const selectedPi = ref(null)
const loading = ref(false)
const activeTab = ref('detail')
const costLines = ref([])
const consumptionLines = ref([])
const materialHeaders = ref([])
const generatedAt = ref('')
const reportCode = ref('')

const headerByProduct = computed(() => {
  const map = new Map()
  for (const row of materialHeaders.value) {
    const key = String(row?.key ?? row?.productCode ?? '').trim()
    if (key && !map.has(key)) map.set(key, row)
  }
  return map
})

function mapMaterialCostRowsToBomCostRows(rows) {
  const list = Array.isArray(rows) ? rows : []
  return list.map((row, idx) => ({
    kcaa01: String(row?.kcaa01 ?? '').trim(),
    kcaa02: row?.kcaa02 != null ? String(row.kcaa02) : '',
    kcaa03: row?.kcaa03 != null ? String(row.kcaa03) : '',
    kcaa04: row?.kcaa04 != null ? String(row.kcaa04) : '',
    Describe: row?.Describe != null ? String(row.Describe) : '',
    yl: Number(row?.kcac04 ?? 0),
    loss_rate: Number(row?.kcac05 ?? 0),
    total_qty: Number.isFinite(Number(row?.kcac06)) ? Number(row.kcac06) : undefined,
    px: row?.px,
    level: 1,
    _flatIndex: idx,
  }))
}

const detailGroups = computed(() => {
  const map = new Map()
  for (const row of costLines.value) {
    const key = String(row.pq ?? '').trim() || '未分款'
    if (!map.has(key)) map.set(key, [])
    map.get(key).push(row)
  }
  return [...map.entries()].map(([key, rows]) => {
    const mergedRows = aggregateBomCostUsageFlatForDisplay(
      mapMaterialCostRowsToBomCostRows(rows),
      BOM_COST_BUILTIN_HIDE_PREFIXES,
    ).map((row, idx) => ({
      ...row,
      __materialCostRowKey: `${key}-${idx}`,
    }))
    return {
      key,
      rows: mergedRows,
      header: headerByProduct.value.get(key) ?? {},
    }
  })
})

const detailRowCount = computed(() => detailGroups.value.reduce((sum, group) => sum + group.rows.length, 0))

const activeRowCount = computed(() => (activeTab.value === 'detail' ? detailRowCount.value : consumptionLines.value.length))

const totalPiOrderQty = computed(() =>
  materialHeaders.value.reduce((sum, row) => {
    const n = Number(row?.orderQty)
    return sum + (Number.isFinite(n) ? n : 0)
  }, 0),
)

const summaryHeader = computed(() => materialHeaders.value[0] ?? {})

function makeReportCode() {
  const raw = `${Date.now()}${Math.random().toString(16).slice(2)}`
  return raw.toUpperCase().replace(/[^0-9A-F]/g, '').padEnd(32, '0').slice(0, 32)
}

function formatNow() {
  const d = new Date()
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

function formatQty(value) {
  const n = Number(value)
  if (!Number.isFinite(n)) return '0.000'
  return n.toFixed(3)
}

function formatLoss(value) {
  const n = Number(value)
  if (!Number.isFinite(n) || n === 0) return '0'
  return n.toFixed(6).replace(/0+$/, '').replace(/\.$/, '')
}

function orderQtyFromGroup(group) {
  const n = Number(group?.header?.orderQty)
  return Number.isFinite(n) ? n : 0
}

function scaleByOrderQty(value, group) {
  const base = Number(value)
  const orderQty = orderQtyFromGroup(group)
  if (!Number.isFinite(base) || orderQty === 0) return 0
  return base * orderQty
}

function lineTotalQty(row, group) {
  return scaleByOrderQty(row?.total_qty, group)
}

function singleMaterialTotal(row, group) {
  const orderQty = orderQtyFromGroup(group)
  if (orderQty === 0) return 0
  return lineTotalQty(row, group) / orderQty
}

function summarySingleMaterialTotal(row) {
  const total = Number(row?.sumby)
  const orderQty = totalPiOrderQty.value
  if (!Number.isFinite(total) || orderQty === 0) return 0
  return total / orderQty
}

function formatHeaderDate(value) {
  if (!value) return ''
  const d = value instanceof Date ? value : new Date(value)
  if (!Number.isFinite(d.getTime())) return String(value).slice(0, 10)
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

function formatHeaderValue(value, key) {
  if (key === 'salesDate') return formatHeaderDate(value)
  if (key === 'singleUsage') return ''
  if (key === 'orderQty') {
    const n = Number(value)
    if (!Number.isFinite(n)) return ''
    return String(n).replace(/\.0+$/, '')
  }
  return value == null ? '' : String(value)
}

function clearReport() {
  selectedPi.value = null
  costLines.value = []
  consumptionLines.value = []
  materialHeaders.value = []
  generatedAt.value = ''
  reportCode.value = ''
}

async function fetchPiSuggestions(query, cb) {
  const keyword = String(query ?? '').trim()
  if (!keyword) {
    cb([])
    return
  }
  try {
    const res = await axios.get('/api/sales-order/pi-suggest', { params: { keyword } })
    const list = Array.isArray(res?.data?.data?.list) ? res.data.data.list : []
    cb(list.map((row) => ({ id: row.id, piNo: row.piNo, value: row.piNo })))
  } catch {
    cb([])
  }
}

function onPickPi(row) {
  selectedPi.value = row
  piKeyword.value = String(row?.piNo ?? '')
  costLines.value = []
  consumptionLines.value = []
  materialHeaders.value = []
}

async function resolveSelectedPi() {
  if (selectedPi.value?.id && selectedPi.value?.piNo === piKeyword.value) return selectedPi.value
  const keyword = piKeyword.value.trim()
  if (!keyword) return null
  const res = await axios.get('/api/sales-order/pi-suggest', { params: { keyword } })
  const list = Array.isArray(res?.data?.data?.list) ? res.data.data.list : []
  const exact = list.find((row) => String(row.piNo ?? '').trim() === keyword)
  return exact || null
}

async function loadReport() {
  const picked = await resolveSelectedPi()
  if (!picked?.id) {
    ElMessage.warning('请先从 PI 号下拉框选择一个已审核销售订单')
    return
  }
  selectedPi.value = picked
  piKeyword.value = String(picked.piNo ?? '')
  loading.value = true
  try {
    const res = await axios.get(`/api/sales-order/${picked.id}/material-bill`)
    const data = res?.data?.data ?? {}
    costLines.value = Array.isArray(data.costLines) ? data.costLines : []
    consumptionLines.value = Array.isArray(data.consumptionLines) ? data.consumptionLines : []
    materialHeaders.value = Array.isArray(data.materialHeaders) ? data.materialHeaders : []
    generatedAt.value = formatNow()
    reportCode.value = makeReportCode()
  } catch (e) {
    costLines.value = []
    consumptionLines.value = []
    materialHeaders.value = []
    ElMessage.error(String(e?.response?.data?.msg ?? e?.message ?? '加载物料单失败'))
  } finally {
    loading.value = false
  }
}

const printTimestamp = ref('')

function materialSheetDefaultExportFileName() {
  const pi = String(piKeyword.value ?? '').trim()
  return pi ? `物料单-${pi}` : '下载.xls'
}

function materialSheetNormalizeExportFileName(s) {
  const raw = String(s ?? '').trim()
  if (!raw) return ''
  const safe = raw.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').replace(/[. ]+$/g, '').trim()
  if (!safe) return ''
  const withExt = /\.(xls|xlsx)$/i.test(safe) ? safe : `${safe}.xls`
  if (withExt.length <= 170) return withExt
  const extMatch = withExt.match(/\.(xls|xlsx)$/i)
  const ext = extMatch?.[0] || '.xls'
  const base = withExt.replace(/\.(xls|xlsx)$/i, '').slice(0, 170 - ext.length).replace(/[. ]+$/g, '')
  return `${base || '下载'}${ext}`
}

function formatHeaderRowText(header, fieldRow) {
  return fieldRow
    .map(([label, key]) => `${label}：${formatHeaderValue(header?.[key], key)}`)
    .join('    ')
}

function applyMaterialSheetExportTableStyle(ws, rowNumber, opts = {}) {
  const row = ws.getRow(rowNumber)
  row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
    cell.border = MATERIAL_SHEET_EXPORT_THIN_BORDER
    cell.alignment = {
      vertical: 'top',
      horizontal: colNumber >= 7 ? 'right' : 'left',
      wrapText: true,
    }
    if (opts.bold) cell.font = { ...(cell.font || {}), bold: true }
    if (opts.fill) cell.fill = opts.fill
  })
}

function materialSheetExportPageSetup() {
  return {
    paperSize: 9,
    orientation: 'portrait',
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 0,
    horizontalCentered: true,
    margins: {
      left: 0.31,
      right: 0.31,
      top: 0.31,
      bottom: 0.63,
      header: 0.2,
      footer: 0.2,
    },
  }
}

function detailRowToExportCells(row, group, idx) {
  return [
    idx + 1,
    row.kcaa01,
    row.kcaa02,
    row.kcaa03,
    row.kcaa04,
    row.Describe,
    formatQty(scaleByOrderQty(row.yl, group)),
    formatLoss(row.loss_rate),
    formatQty(lineTotalQty(row, group)),
    formatQty(singleMaterialTotal(row, group)),
  ]
}

function summaryRowToExportCells(row, idx) {
  return [
    idx + 1,
    row.kcaa01,
    row.kcaa02,
    row.kcaa03,
    row.Describe,
    row.kcaa04,
    formatQty(row.sumay),
    formatLoss(row.kcac05),
    formatQty(row.sumby),
    formatQty(summarySingleMaterialTotal(row)),
  ]
}

async function downloadMaterialSheetWorkbook(wb, downloadFileName) {
  const buf = await wb.xlsx.writeBuffer()
  const blob = new Blob([buf], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = materialSheetNormalizeExportFileName(downloadFileName) || materialSheetDefaultExportFileName()
  a.click()
  URL.revokeObjectURL(url)
  ElMessage.success('已导出')
}

async function exportDetailMaterialSheetXls(downloadFileName = materialSheetDefaultExportFileName()) {
  const groups = detailGroups.value
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('物料单明细', {
    views: [{ state: 'frozen', ySplit: 2 }],
    pageSetup: materialSheetExportPageSetup(),
  })
  let rowNum = 0
  for (let gi = 0; gi < groups.length; gi++) {
    const group = groups[gi]
    if (gi > 0) {
      ws.addRow([])
      rowNum += 1
    }
    const brandRow = ws.addRow([REPORT_BRAND])
    rowNum = brandRow.number
    ws.mergeCells(rowNum, 1, rowNum, MATERIAL_SHEET_COL_COUNT)
    ws.getRow(rowNum).font = { bold: true, size: 14 }
    ws.getCell(rowNum, 1).alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }

    const titleRow = ws.addRow([REPORT_TITLE])
    rowNum = titleRow.number
    ws.mergeCells(rowNum, 1, rowNum, MATERIAL_SHEET_COL_COUNT)
    ws.getRow(rowNum).font = { bold: true, size: 12 }
    ws.getCell(rowNum, 1).alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }

    for (const fieldRow of DETAIL_HEADER_FIELD_ROWS) {
      const added = ws.addRow([formatHeaderRowText(group.header, fieldRow)])
      rowNum = added.number
      ws.mergeCells(rowNum, 1, rowNum, MATERIAL_SHEET_COL_COUNT)
      ws.getCell(rowNum, 1).alignment = { horizontal: 'left', vertical: 'middle', wrapText: true }
    }

    const headerAdded = ws.addRow([...DETAIL_EXPORT_HEADERS])
    rowNum = headerAdded.number
    applyMaterialSheetExportTableStyle(ws, rowNum, {
      bold: true,
      fill: MATERIAL_SHEET_EXPORT_HEADER_FILL,
    })

    for (let i = 0; i < group.rows.length; i++) {
      const added = ws.addRow(detailRowToExportCells(group.rows[i], group, i))
      applyMaterialSheetExportTableStyle(ws, added.number)
    }
  }
  ws.columns.forEach((col, index) => {
    col.width = MATERIAL_SHEET_EXPORT_COL_WIDTHS[index] || 10
  })
  await downloadMaterialSheetWorkbook(wb, downloadFileName)
}

async function exportSummaryMaterialSheetXls(downloadFileName = materialSheetDefaultExportFileName()) {
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('物料单汇总', {
    views: [{ state: 'frozen', ySplit: 2 }],
    pageSetup: materialSheetExportPageSetup(),
  })
  const brandRow = ws.addRow([REPORT_BRAND])
  ws.mergeCells(1, 1, 1, MATERIAL_SHEET_COL_COUNT)
  ws.getRow(1).font = { bold: true, size: 14 }
  ws.getCell(1, 1).alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }

  const titleRow = ws.addRow([REPORT_TITLE])
  ws.mergeCells(2, 1, 2, MATERIAL_SHEET_COL_COUNT)
  ws.getRow(2).font = { bold: true, size: 12 }
  ws.getCell(2, 1).alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }

  const headRow = ws.addRow([
    formatHeaderRowText(summaryHeader.value, SUMMARY_HEADER_FIELD_ROWS[0]),
  ])
  ws.mergeCells(headRow.number, 1, headRow.number, MATERIAL_SHEET_COL_COUNT)
  ws.getCell(headRow.number, 1).alignment = { horizontal: 'left', vertical: 'middle', wrapText: true }

  const headerAdded = ws.addRow([...SUMMARY_EXPORT_HEADERS])
  applyMaterialSheetExportTableStyle(ws, headerAdded.number, {
    bold: true,
    fill: MATERIAL_SHEET_EXPORT_HEADER_FILL,
  })

  for (let i = 0; i < consumptionLines.value.length; i++) {
    const added = ws.addRow(summaryRowToExportCells(consumptionLines.value[i], i))
    applyMaterialSheetExportTableStyle(ws, added.number)
  }

  ws.columns.forEach((col, index) => {
    col.width = MATERIAL_SHEET_EXPORT_COL_WIDTHS[index] || 10
  })
  await downloadMaterialSheetWorkbook(wb, downloadFileName)
}

async function exportMaterialSheetXls() {
  if (activeTab.value === 'detail') {
    if (!detailGroups.value.length) {
      ElMessage.warning('暂无数据可导出')
      return
    }
    await exportDetailMaterialSheetXls()
    return
  }
  if (!consumptionLines.value.length) {
    ElMessage.warning('暂无数据可导出')
    return
  }
  await exportSummaryMaterialSheetXls()
}

function applyMaterialSheetPrintPageStyle() {
  let el = document.getElementById(MATERIAL_SHEET_PRINT_PAGE_STYLE_ID)
  if (!el) {
    el = document.createElement('style')
    el.id = MATERIAL_SHEET_PRINT_PAGE_STYLE_ID
    document.head.appendChild(el)
  }
  el.textContent = `@media print {
    @page {
      size: A4 portrait;
      margin: 8mm 8mm 16mm;
      @bottom-center {
        content: counter(page) " / " counter(pages);
        font-size: 12px;
        font-weight: 600;
        color: #333;
      }
    }
  }`
}

function removeMaterialSheetPrintPageStyle() {
  document.getElementById(MATERIAL_SHEET_PRINT_PAGE_STYLE_ID)?.remove()
}

function formatMaterialSheetPrintTimestamp(d = new Date()) {
  const dt = d instanceof Date ? d : new Date(d)
  if (Number.isNaN(dt.getTime())) return ''
  const pad2 = (n) => String(n).padStart(2, '0')
  return `${dt.getFullYear()}-${dt.getMonth() + 1}-${dt.getDate()} ${pad2(dt.getHours())}:${pad2(dt.getMinutes())}:${pad2(
    dt.getSeconds(),
  )}`
}

function onPrintMaterialSheet() {
  const hasData =
    activeTab.value === 'detail' ? detailGroups.value.length > 0 : consumptionLines.value.length > 0
  if (!hasData) {
    ElMessage.warning('暂无数据可打印')
    return
  }
  printTimestamp.value = formatMaterialSheetPrintTimestamp(new Date())
  applyMaterialSheetPrintPageStyle()
  const cleanupPrintClass = () => {
    document.documentElement.classList.remove('print-material-sheet')
    removeMaterialSheetPrintPageStyle()
    window.removeEventListener('afterprint', cleanupPrintClass)
  }
  document.documentElement.classList.add('print-material-sheet')
  window.addEventListener('afterprint', cleanupPrintClass)
  nextTick(() => {
    setTimeout(() => {
      window.print()
      setTimeout(cleanupPrintClass, 3000)
    }, 120)
  })
}
</script>

<style scoped>
.material-sheet-page {
  min-height: calc(100vh - 118px);
  padding: 16px;
  background: #f5f7fb;
}
.top-search-row {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 12px;
  padding: 16px;
  border: 1px solid #e3e8f2;
  border-radius: 8px;
  background: #fff;
  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.04);
}
.pi-search {
  flex: 1;
  min-width: 260px;
}
.report-shell {
  min-height: calc(100vh - 170px);
  overflow: hidden;
  border: 1px solid #dce3ee;
  border-left: 4px solid #1c7c73;
  border-radius: 8px;
  background: #fff;
  box-shadow: 0 12px 30px rgba(15, 23, 42, 0.07);
}
.report-action-strip {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
  padding: 14px 18px;
  border-bottom: 1px solid #e5eaf2;
  background: #f7f9fc;
}
.report-tool-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  padding: 12px 18px 6px;
  background: #fff;
}
.report-meta-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
  padding: 0 18px;
  min-height: 26px;
  color: #334155;
  font-size: 13px;
}
.underline {
  display: inline-block;
  min-width: 170px;
  border-bottom: 1px solid #94a3b8;
  line-height: 20px;
}
.report-page-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin: 12px 18px 0;
  padding: 8px 10px;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  background: #f8fafc;
  color: #334155;
  font-size: 13px;
}
.report-body {
  padding: 14px 18px 20px;
}
.product-section + .product-section {
  margin-top: 18px;
}
:deep(.blank-report-head) {
  position: relative;
  max-width: 1120px;
  margin: 0 auto 14px;
  padding: 18px 22px 16px;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  background: linear-gradient(180deg, #ffffff 0%, #fbfdff 100%);
  text-align: center;
}
:deep(.brand-line) {
  color: #1e3a8a;
  font-size: 16px;
  font-weight: 600;
  line-height: 24px;
}
:deep(.report-title) {
  margin-bottom: 14px;
  color: #0f172a;
  font-size: 18px;
  font-weight: 700;
  line-height: 26px;
}
:deep(.head-grid) {
  display: grid;
  gap: 8px;
  text-align: left;
}
:deep(.head-row) {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  column-gap: 22px;
  row-gap: 8px;
  align-items: center;
}
:deep(.head-field) {
  display: flex;
  align-items: center;
  min-width: 0;
}
:deep(.head-label) {
  flex: none;
  min-width: 76px;
  color: #475569;
  font-size: 14px;
  line-height: 22px;
}
:deep(.head-value) {
  display: inline-block;
  flex: 1;
  min-width: 0;
  border-bottom: 1px solid #cbd5e1;
  color: #0f172a;
  line-height: 22px;
  min-height: 22px;
  padding: 0 8px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.report-table-wrap {
  overflow-x: auto;
  border: 1px solid #cbd5e1;
  border-radius: 6px;
}
.report-table {
  width: 100%;
  border-collapse: collapse;
  border-style: hidden;
  table-layout: fixed;
  font-size: 13px;
}
.report-table th,
.report-table td {
  border: 1px solid #cbd5e1;
  padding: 5px 8px;
  line-height: 19px;
  text-align: center;
  word-break: break-all;
}
.report-table th {
  color: #0f172a;
  font-weight: 600;
  background: #eef4fb;
}
.report-table tbody tr:nth-child(even) {
  background: #fafcff;
}
.report-table tbody tr:hover {
  background: #edf6ff;
}
.report-action-strip :deep(.el-button),
.report-tool-row :deep(.el-button),
.report-page-row :deep(.el-button) {
  border-radius: 16px;
  font-weight: 600;
}
.col-index {
  width: 58px;
}
.col-code {
  width: 150px;
}
.col-match {
  width: 92px;
}
.col-unit {
  width: 62px;
}
.col-num {
  width: 90px;
}
@media (max-width: 900px) {
  .top-search-row {
    align-items: stretch;
    flex-direction: column;
  }
  .pi-search {
    width: 100%;
  }
  .head-grid {
    gap: 8px;
  }
  :deep(.head-row) {
    grid-template-columns: 1fr;
    row-gap: 8px;
  }
  .report-action-strip,
  .report-tool-row,
  .report-page-row {
    overflow-x: auto;
    flex-wrap: nowrap;
  }
}
.material-sheet-print-document {
  display: none;
}
</style>

<style>
/* 物料单：浏览器打印（与 onPrintMaterialSheet 的 html class 配合） */
@media print {
  html.print-material-sheet,
  html.print-material-sheet body {
    width: 100% !important;
    height: auto !important;
    margin: 0 !important;
    padding: 0 !important;
    overflow: visible !important;
    background: #fff !important;
  }
  html.print-material-sheet body {
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  html.print-material-sheet body * {
    visibility: hidden !important;
  }
  html.print-material-sheet .erp-layout > .el-aside,
  html.print-material-sheet .erp-header,
  html.print-material-sheet .erp-tags-wrap {
    display: none !important;
  }
  html.print-material-sheet .erp-module-page > :not(.material-sheet-print-document) {
    display: none !important;
  }
  html.print-material-sheet .material-sheet-print-document,
  html.print-material-sheet .material-sheet-print-document * {
    visibility: visible !important;
  }
  html.print-material-sheet .material-sheet-print-document {
    display: block !important;
    position: static !important;
    box-sizing: border-box !important;
    width: 98% !important;
    max-width: 275mm !important;
    margin: 0 auto !important;
    color: #000 !important;
    background: #fff !important;
  }
  html.print-material-sheet .material-sheet-print-time {
    margin: 0 0 8px;
    font-size: 12px;
    font-weight: 600;
  }
  html.print-material-sheet .material-sheet-print-section + .material-sheet-print-section {
    margin-top: 16px;
    page-break-before: auto;
  }
  html.print-material-sheet .material-sheet-print-brand {
    margin: 0 0 4px;
    text-align: center;
    font-size: 16px;
    font-weight: 700;
  }
  html.print-material-sheet .material-sheet-print-title {
    margin: 0 0 10px;
    text-align: center;
    font-size: 15px;
    font-weight: 700;
  }
  html.print-material-sheet .material-sheet-print-head-row {
    display: flex;
    flex-wrap: wrap;
    gap: 8px 24px;
    margin-bottom: 6px;
    font-size: 12px;
    font-weight: 600;
  }
  html.print-material-sheet .material-sheet-print-table {
    width: 100%;
    border-collapse: collapse;
    table-layout: fixed;
    font-size: 11px;
    font-weight: 700;
  }
  html.print-material-sheet .material-sheet-print-table th,
  html.print-material-sheet .material-sheet-print-table td {
    border: 1px solid #333;
    padding: 4px 5px;
    text-align: center;
    word-break: break-all;
  }
  html.print-material-sheet .material-sheet-print-table th {
    background: #eef4fb;
  }
  html.print-material-sheet .material-sheet-print-table td.num,
  html.print-material-sheet .material-sheet-print-table th:nth-child(n + 7) {
    text-align: right;
  }
}
</style>
