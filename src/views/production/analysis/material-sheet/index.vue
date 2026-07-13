<template>
  <div class="erp-module-page material-sheet-page">
    <div class="report-action-strip no-print">
        <el-button
          :type="activeTab === 'detail' ? 'primary' : undefined"
          size="small"
          @click="activeTab = 'detail'"
        >
          物料单统计表（明细）
        </el-button>
        <el-button
          :type="activeTab === 'summary' ? 'primary' : undefined"
          size="small"
          @click="activeTab = 'summary'"
        >
          物料单统计表（汇总）
        </el-button>
    </div>

    <div class="report-tool-row no-print">
      <el-button type="primary" @click="onPrintMaterialSheet">打印统计报表</el-button>
      <el-button type="primary" @click="onClickQueryContent">查询内容</el-button>
      <el-popover placement="bottom-start" trigger="click" width="300">
        <template #reference>
          <el-button>列设置</el-button>
        </template>
        <div class="column-setting-panel">
          <div class="column-setting-title">勾选要显示的列（打印同步）</div>
          <el-checkbox-group v-model="checkedColumnKeys" @change="onColumnSettingChange">
            <el-checkbox v-for="col in columnSettingOptions" :key="col.key" :label="col.key">{{ col.label }}</el-checkbox>
          </el-checkbox-group>
          <div class="column-setting-actions">
            <el-button link type="primary" @click="resetColumnSetting">恢复默认</el-button>
          </div>
        </div>
      </el-popover>
      <el-button @click="exportMaterialSheetXls">导出信息</el-button>
    </div>

    <div class="report-shell">

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
                      <th v-if="hasColumn('seq')" class="col-index">序号</th>
                      <th v-if="hasColumn('code')" class="col-code">编码</th>
                      <th v-if="hasColumn('color')" class="col-color">颜色</th>
                      <th v-if="hasColumn('name')">名称</th>
                      <th v-if="hasColumn('spec')">规格</th>
                      <th v-if="hasColumn('match')" class="col-match">搭配</th>
                      <th v-if="hasColumn('unit')" class="col-unit">单位</th>
                      <th v-if="hasColumn('usage')" class="col-num">用量</th>
                      <th v-if="hasColumn('loss')" class="col-loss">损耗</th>
                      <th v-if="hasColumn('total')" class="col-num">合计</th>
                      <th v-if="hasColumn('singleTotal')" class="col-num">单物料合计</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="(row, idx) in group.rows" :key="row.__materialCostRowKey ?? `${group.key}-${idx}`">
                      <td v-if="hasColumn('seq')">{{ idx + 1 }}</td>
                      <td v-if="hasColumn('code')">{{ row.kcaa01 }}</td>
                      <td v-if="hasColumn('color')">{{ row.kcaa11 }}</td>
                      <td v-if="hasColumn('name')">{{ row.kcaa02 }}</td>
                      <td v-if="hasColumn('spec')">{{ row.kcaa03 }}</td>
                      <td v-if="hasColumn('match')">{{ row.Describe }}</td>
                      <td v-if="hasColumn('unit')">{{ row.kcaa04 }}</td>
                      <td v-if="hasColumn('usage')">{{ formatQty(scaleByOrderQty(row.yl, group)) }}</td>
                      <td v-if="hasColumn('loss')">{{ formatLoss(row.loss_rate) }}</td>
                      <td v-if="hasColumn('total')">{{ formatQty(lineTotalQty(row, group)) }}</td>
                      <td v-if="hasColumn('singleTotal')">{{ formatQty(singleMaterialTotal(row, group)) }}</td>
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
                  <th v-if="hasColumn('seq')" class="col-index">序号</th>
                  <th v-if="hasColumn('code')" class="col-code">编码</th>
                  <th v-if="hasColumn('color')" class="col-color">颜色</th>
                  <th v-if="hasColumn('name')">名称</th>
                  <th v-if="hasColumn('spec')">规格</th>
                  <th v-if="hasColumn('match')" class="col-match">搭配</th>
                  <th v-if="hasColumn('unit')" class="col-unit">单位</th>
                  <th v-if="hasColumn('usage')" class="col-num">用量</th>
                  <th v-if="hasColumn('loss')" class="col-loss">损耗</th>
                  <th v-if="hasColumn('total')" class="col-num">合计</th>
                  <th v-if="hasColumn('singleTotal')" class="col-num">单物料合计</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="(row, idx) in consumptionLines" :key="row.id ?? idx">
                  <td v-if="hasColumn('seq')">{{ idx + 1 }}</td>
                  <td v-if="hasColumn('code')">{{ row.kcaa01 }}</td>
                  <td v-if="hasColumn('color')">{{ row.kcaa11 }}</td>
                  <td v-if="hasColumn('name')">{{ row.kcaa02 }}</td>
                  <td v-if="hasColumn('spec')">{{ row.kcaa03 }}</td>
                  <td v-if="hasColumn('match')">{{ row.Describe }}</td>
                  <td v-if="hasColumn('unit')">{{ row.kcaa04 }}</td>
                  <td v-if="hasColumn('usage')">{{ formatQty(row.sumay) }}</td>
                  <td v-if="hasColumn('loss')">{{ formatLoss(row.kcac05) }}</td>
                  <td v-if="hasColumn('total')">{{ formatQty(row.sumby) }}</td>
                  <td v-if="hasColumn('singleTotal')">{{ formatQty(summarySingleMaterialTotal(row)) }}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <el-empty v-else description="请选择 PI 号并查询物料单汇总" />
        </template>
      </div>
    </div>

    <el-dialog v-model="piDialog.visible" title="选择 PI" width="920px" class="buy-pi-dialog material-sheet-pi-dialog">
      <div class="buy-pi-toolbar">
        <el-input v-model="piDialog.keyword" clearable placeholder="PI号 / PO号 / 客户" @keyup.enter="searchPiDialog" />
        <el-button type="primary" @click="searchPiDialog">查询</el-button>
      </div>
      <el-table v-loading="piDialog.loading" :data="piDialog.list" border stripe row-key="piNo">
        <el-table-column label="操作" width="100" align="center" fixed="left">
          <template #default="{ row }">
            <el-button
              size="small"
              :type="isPiSelected(row) ? 'success' : 'primary'"
              :plain="!isPiSelected(row)"
              class="buy-pi-select-button"
              @click="choosePiFromDialog(row)"
            >
              {{ isPiSelected(row) ? '已选择' : '选择' }}
            </el-button>
          </template>
        </el-table-column>
        <el-table-column label="PI号" prop="piNo" min-width="180" show-overflow-tooltip />
        <el-table-column label="PO号" prop="poNo" min-width="180" show-overflow-tooltip />
        <el-table-column label="客户" prop="customer" min-width="220" show-overflow-tooltip />
      </el-table>
      <el-pagination
        v-model:current-page="piDialog.page"
        v-model:page-size="piDialog.pageSize"
        :page-sizes="piDialogPageSizes"
        layout="total, sizes, prev, pager, next, jumper"
        :total="piDialog.total"
        class="buy-pi-pagination"
        @size-change="onPiPageSizeChange"
        @current-change="onPiPageChange"
      />
    </el-dialog>

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
                <th v-if="hasColumn('seq')">序号</th>
                <th v-if="hasColumn('code')">编码</th>
                <th v-if="hasColumn('color')">颜色</th>
                <th v-if="hasColumn('name')">名称</th>
                <th v-if="hasColumn('spec')">规格</th>
                <th v-if="hasColumn('match')">搭配</th>
                <th v-if="hasColumn('unit')">单位</th>
                <th v-if="hasColumn('usage')">用量</th>
                <th v-if="hasColumn('loss')">损耗</th>
                <th v-if="hasColumn('total')">合计</th>
                <th v-if="hasColumn('singleTotal')">单物料合计</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(row, idx) in group.rows" :key="`print-row-${row.__materialCostRowKey ?? idx}`">
                <td v-if="hasColumn('seq')">{{ idx + 1 }}</td>
                <td v-if="hasColumn('code')">{{ row.kcaa01 }}</td>
                <td v-if="hasColumn('color')">{{ row.kcaa11 }}</td>
                <td v-if="hasColumn('name')">{{ row.kcaa02 }}</td>
                <td v-if="hasColumn('spec')">{{ row.kcaa03 }}</td>
                <td v-if="hasColumn('match')">{{ row.Describe }}</td>
                <td v-if="hasColumn('unit')">{{ row.kcaa04 }}</td>
                <td v-if="hasColumn('usage')" class="num">{{ formatQty(scaleByOrderQty(row.yl, group)) }}</td>
                <td v-if="hasColumn('loss')" class="num">{{ formatLoss(row.loss_rate) }}</td>
                <td v-if="hasColumn('total')" class="num">{{ formatQty(lineTotalQty(row, group)) }}</td>
                <td v-if="hasColumn('singleTotal')" class="num">{{ formatQty(singleMaterialTotal(row, group)) }}</td>
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
                <th v-if="hasColumn('seq')">序号</th>
                <th v-if="hasColumn('code')">ERP编码</th>
                <th v-if="hasColumn('color')">颜色</th>
                <th v-if="hasColumn('name')">名称</th>
                <th v-if="hasColumn('spec')">规格</th>
                <th v-if="hasColumn('match')">搭配</th>
                <th v-if="hasColumn('unit')">单位</th>
                <th v-if="hasColumn('usage')">用量</th>
                <th v-if="hasColumn('loss')">损耗</th>
                <th v-if="hasColumn('total')">合计</th>
                <th v-if="hasColumn('singleTotal')">单物料合计</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(row, idx) in consumptionLines" :key="`print-sum-${row.id ?? idx}`">
                <td v-if="hasColumn('seq')">{{ idx + 1 }}</td>
                <td v-if="hasColumn('code')">{{ row.kcaa01 }}</td>
                <td v-if="hasColumn('color')">{{ row.kcaa11 }}</td>
                <td v-if="hasColumn('name')">{{ row.kcaa02 }}</td>
                <td v-if="hasColumn('spec')">{{ row.kcaa03 }}</td>
                <td v-if="hasColumn('match')">{{ row.Describe }}</td>
                <td v-if="hasColumn('unit')">{{ row.kcaa04 }}</td>
                <td v-if="hasColumn('usage')" class="num">{{ formatQty(row.sumay) }}</td>
                <td v-if="hasColumn('loss')" class="num">{{ formatLoss(row.kcac05) }}</td>
                <td v-if="hasColumn('total')" class="num">{{ formatQty(row.sumby) }}</td>
                <td v-if="hasColumn('singleTotal')" class="num">{{ formatQty(summarySingleMaterialTotal(row)) }}</td>
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

import { computed, defineComponent, h, nextTick, reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'
import axios from 'axios'
import ExcelJS from 'exceljs'
import { aggregateBomCostUsageFlatForDisplay } from '@/utils/bomCostUsageAggregate.js'

const REPORT_BRAND = '中山市卓越皮具有限公司'
const REPORT_TITLE = '成本物料单统计报表（成本价物料明细）'
const DETAIL_MATERIAL_SHEET_COL_COUNT = 11
/** 汇总不含「单物料合计」，最多 10 列 */
const SUMMARY_MATERIAL_SHEET_COL_COUNT = 10
/** 仅明细页签提供的列（汇总表/打印/导出/列设置均不出现） */
const DETAIL_ONLY_COLUMN_KEYS = new Set(['singleTotal'])
const COLUMN_SETTING_STORAGE_KEY = 'erp.production.materialSheet.columnSetting.v1'
const reportColumns = [
  { key: 'seq', label: '序号' },
  { key: 'code', label: '编码' },
  { key: 'color', label: '颜色' },
  { key: 'name', label: '名称' },
  { key: 'spec', label: '规格' },
  { key: 'match', label: '搭配' },
  { key: 'unit', label: '单位' },
  { key: 'usage', label: '用量' },
  { key: 'loss', label: '损耗' },
  { key: 'total', label: '合计' },
  { key: 'singleTotal', label: '单物料合计' },
]
const defaultColumnKeys = reportColumns.map((c) => c.key)

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

const DETAIL_EXPORT_HEADERS = ['序号', '编码', '颜色', '名称', '规格', '搭配', '单位', '用量', '损耗', '合计', '单物料合计']
const SUMMARY_EXPORT_HEADERS = ['序号', 'ERP编码', '颜色', '名称', '规格', '搭配', '单位', '用量', '损耗', '合计']
const DETAIL_MATERIAL_SHEET_EXPORT_COL_WIDTHS = [8, 18, 14, 18, 18, 14, 8, 12, 10, 12, 14]
const SUMMARY_MATERIAL_SHEET_EXPORT_COL_WIDTHS = [8, 18, 14, 18, 18, 14, 8, 12, 10, 12]
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
const checkedColumnKeys = ref(loadColumnSetting())
/** 列设置勾选项：汇总页不提供「单物料合计」 */
const columnSettingOptions = computed(() =>
  activeTab.value === 'summary'
    ? reportColumns.filter((col) => !DETAIL_ONLY_COLUMN_KEYS.has(col.key))
    : reportColumns,
)
const visibleReportColumns = computed(() => {
  const source =
    activeTab.value === 'summary'
      ? reportColumns.filter((col) => !DETAIL_ONLY_COLUMN_KEYS.has(col.key))
      : reportColumns
  const cols = source.filter((col) => checkedColumnKeys.value.includes(col.key))
  return cols.length ? cols : source
})
const queryForm = reactive({ piNo: '' })
const piDialogPageSizes = [10, 20, 50, 100]
const piDialog = reactive({
  visible: false,
  keyword: '',
  list: [],
  selected: [],
  page: 1,
  pageSize: 10,
  total: 0,
  loading: false,
})

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
    kcaa11: row?.kcaa11 != null ? String(row.kcaa11) : '',
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
  return n.toFixed(2)
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
  if (key === 'singleUsage') {
    const n = Number(value)
    if (!Number.isFinite(n)) return ''
    return n.toFixed(4)
  }
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

function loadColumnSetting() {
  try {
    const raw = localStorage.getItem(COLUMN_SETTING_STORAGE_KEY)
    if (!raw) return [...defaultColumnKeys]
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return [...defaultColumnKeys]
    const legal = parsed.filter((key) => reportColumns.some((col) => col.key === key))
    return legal.length ? legal : [...defaultColumnKeys]
  } catch {
    return [...defaultColumnKeys]
  }
}

function onColumnSettingChange() {
  localStorage.setItem(COLUMN_SETTING_STORAGE_KEY, JSON.stringify(checkedColumnKeys.value))
}

function resetColumnSetting() {
  checkedColumnKeys.value = [...defaultColumnKeys]
  onColumnSettingChange()
}

function hasColumn(key) {
  // 汇总页硬性隐藏仅明细列，避免本地列设置残留勾选仍显示
  if (activeTab.value === 'summary' && DETAIL_ONLY_COLUMN_KEYS.has(key)) return false
  return checkedColumnKeys.value.includes(key)
}

function onClickQueryContent() {
  queryForm.piNo = String(piKeyword.value ?? '').trim()
  openPiDialog()
}

function openPiDialog() {
  const pickedPi = String(queryForm.piNo ?? '').trim()
  piDialog.selected = pickedPi ? [pickedPi] : []
  piDialog.keyword = ''
  piDialog.page = 1
  piDialog.visible = true
  searchPiDialog()
}

async function searchPiDialog() {
  piDialog.loading = true
  try {
    const res = await axios.get('/api/buy-order/pi-options', {
      params: {
        keyword: String(piDialog.keyword ?? '').trim(),
        page: piDialog.page,
        pageSize: piDialog.pageSize,
      },
    })
    const list = Array.isArray(res?.data?.data?.list) ? res.data.data.list : []
    piDialog.list = list
      .map((row) => ({
        id: row.id,
        piNo: String(row.piNo ?? '').trim(),
        poNo: String(row.poNo ?? '').trim(),
        customer: String(row.customer ?? '').trim(),
      }))
      .filter((row) => row.piNo)
    piDialog.total = Number(res?.data?.data?.total ?? piDialog.list.length)
  } catch (e) {
    piDialog.list = []
    piDialog.total = 0
    ElMessage.error(String(e?.response?.data?.msg ?? e?.message ?? 'PI 查询失败'))
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

function isPiSelected(row) {
  return piDialog.selected.includes(String(row?.piNo ?? '').trim())
}

async function choosePiFromDialog(row) {
  const piNo = String(row?.piNo ?? '').trim()
  if (!piNo || loading.value) return
  queryForm.piNo = piNo
  piKeyword.value = piNo
  piDialog.selected = piNo ? [piNo] : []
  selectedPi.value = row
  piDialog.visible = false
  // 这里把“查询内容”改成一步到位：选中 PI 后直接加载报表
  await loadReport()
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
  const numStartCol = Number(opts.numStartCol ?? 7)
  const row = ws.getRow(rowNumber)
  row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
    cell.border = MATERIAL_SHEET_EXPORT_THIN_BORDER
    cell.alignment = {
      vertical: 'top',
      horizontal: colNumber >= numStartCol ? 'right' : 'left',
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
  const fullMap = {
    seq: idx + 1,
    code: row.kcaa01,
    color: row.kcaa11,
    name: row.kcaa02,
    spec: row.kcaa03,
    match: row.Describe,
    unit: row.kcaa04,
    usage: formatQty(scaleByOrderQty(row.yl, group)),
    loss: formatLoss(row.loss_rate),
    total: formatQty(lineTotalQty(row, group)),
    singleTotal: formatQty(singleMaterialTotal(row, group)),
  }
  return visibleReportColumns.value.map((col) => fullMap[col.key] ?? '')
}

function summaryRowToExportCells(row, idx) {
  const fullMap = {
    seq: idx + 1,
    code: row.kcaa01,
    color: row.kcaa11,
    name: row.kcaa02,
    spec: row.kcaa03,
    match: row.Describe,
    unit: row.kcaa04,
    usage: formatQty(row.sumay),
    loss: formatLoss(row.kcac05),
    total: formatQty(row.sumby),
    singleTotal: formatQty(summarySingleMaterialTotal(row)),
  }
  return visibleReportColumns.value.map((col) => fullMap[col.key] ?? '')
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
    ws.mergeCells(rowNum, 1, rowNum, DETAIL_MATERIAL_SHEET_COL_COUNT)
    ws.getRow(rowNum).font = { bold: true, size: 14 }
    ws.getCell(rowNum, 1).alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }

    const titleRow = ws.addRow([REPORT_TITLE])
    rowNum = titleRow.number
    ws.mergeCells(rowNum, 1, rowNum, DETAIL_MATERIAL_SHEET_COL_COUNT)
    ws.getRow(rowNum).font = { bold: true, size: 12 }
    ws.getCell(rowNum, 1).alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }

    for (const fieldRow of DETAIL_HEADER_FIELD_ROWS) {
      const added = ws.addRow([formatHeaderRowText(group.header, fieldRow)])
      rowNum = added.number
      ws.mergeCells(rowNum, 1, rowNum, DETAIL_MATERIAL_SHEET_COL_COUNT)
      ws.getCell(rowNum, 1).alignment = { horizontal: 'left', vertical: 'middle', wrapText: true }
    }

    const headerAdded = ws.addRow(visibleReportColumns.value.map((col) => col.label))
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
    col.width = DETAIL_MATERIAL_SHEET_EXPORT_COL_WIDTHS[index] || 10
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
  ws.mergeCells(1, 1, 1, SUMMARY_MATERIAL_SHEET_COL_COUNT)
  ws.getRow(1).font = { bold: true, size: 14 }
  ws.getCell(1, 1).alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }

  const titleRow = ws.addRow([REPORT_TITLE])
  ws.mergeCells(2, 1, 2, SUMMARY_MATERIAL_SHEET_COL_COUNT)
  ws.getRow(2).font = { bold: true, size: 12 }
  ws.getCell(2, 1).alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }

  const headRow = ws.addRow([
    formatHeaderRowText(summaryHeader.value, SUMMARY_HEADER_FIELD_ROWS[0]),
  ])
  ws.mergeCells(headRow.number, 1, headRow.number, SUMMARY_MATERIAL_SHEET_COL_COUNT)
  ws.getCell(headRow.number, 1).alignment = { horizontal: 'left', vertical: 'middle', wrapText: true }

  const headerAdded = ws.addRow(visibleReportColumns.value.map((col) => col.label))
  applyMaterialSheetExportTableStyle(ws, headerAdded.number, {
    bold: true,
    fill: MATERIAL_SHEET_EXPORT_HEADER_FILL,
  })

  for (let i = 0; i < consumptionLines.value.length; i++) {
    const added = ws.addRow(summaryRowToExportCells(consumptionLines.value[i], i))
    applyMaterialSheetExportTableStyle(ws, added.number)
  }

  ws.columns.forEach((col, index) => {
    col.width = SUMMARY_MATERIAL_SHEET_EXPORT_COL_WIDTHS[index] || 10
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
  background: var(--erp-app-bg, #f5f7fb);
}
.top-search-row {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 12px;
  padding: 16px;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 8px;
  background: var(--erp-surface, #fff);
  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.04);
}
.pi-search {
  flex: 1;
  min-width: 260px;
}
.report-shell {
  min-height: calc(100vh - 170px);
  overflow: hidden;
  border: 1px solid var(--el-border-color);
  border-left: 4px solid #1c7c73;
  border-radius: 8px;
  background: var(--erp-surface, #fff);
  box-shadow: 0 12px 30px rgba(15, 23, 42, 0.07);
}
.report-action-strip {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
  padding: 14px 18px;
  border-bottom: 1px solid var(--el-border-color-lighter);
  background: var(--el-fill-color-light, #f7f9fc);
}
.report-tool-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  padding: 12px 0 10px;
  background: var(--erp-surface, #fff);
}
.column-setting-title {
  margin-bottom: 8px;
  color: #334155;
  font-weight: 600;
}
.column-setting-actions {
  margin-top: 8px;
  text-align: right;
}
.pi-picker {
  display: flex;
  gap: 8px;
  width: 100%;
}
.buy-pi-toolbar {
  --buy-pi-control-height: 38px;
  --buy-pi-control-font-size: 15px;
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
}
.buy-pi-toolbar :deep(.el-input) {
  width: 360px;
}
.buy-pi-toolbar :deep(.el-input__wrapper) {
  min-height: var(--buy-pi-control-height);
}
.buy-pi-toolbar :deep(.el-input__inner) {
  font-size: var(--buy-pi-control-font-size);
}
.buy-pi-toolbar :deep(.el-button) {
  height: var(--buy-pi-control-height);
  padding-left: 18px;
  padding-right: 18px;
  font-size: var(--buy-pi-control-font-size);
}
.buy-pi-select-button {
  min-width: 74px;
}
.buy-pi-pagination {
  margin-top: 12px;
  justify-content: flex-start;
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
  width: 18px;
}
.col-code {
  width: 150px;
}
.col-color {
  /* 颜色含「编码,中文名」，略加宽；汇总多色用分号拼接时靠自动换行 */
  width: 100px;
}
.col-match {
  width: 92px;
}
.col-unit {
  width: 30px;
}
.col-num {
  /* 用量 / 合计 / 单物料合计 共用列宽 */
  width: 49px;
}
.col-loss {
  /* 损耗列独立宽度（与 .col-num 分开，可单独改） */
  width: 28px;
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
  html.print-material-sheet .material-sheet-print-table td.num {
    text-align: right;
  }
}
</style>
