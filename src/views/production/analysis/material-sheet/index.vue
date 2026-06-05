<template>
  <div class="erp-module-page material-sheet-page">
    <div class="top-search-row">
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
      <div class="report-action-strip">
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
        <el-button type="primary" size="small">导出为xls信息</el-button>
      </div>

      <div class="report-tool-row">
        <el-button size="small" type="primary">打印统计报表</el-button>
        <el-button size="small" type="primary">打印预览</el-button>
        <el-button size="small" type="primary">保存报表数据</el-button>
        <el-button size="small" type="primary">查询内容</el-button>
      </div>

      <div class="report-meta-row">
        <span>报表生成时间：</span><span class="underline">{{ generatedAt }}</span>
        <span>报表代码：</span><span class="underline">{{ reportCode }}</span>
      </div>
      <div class="report-meta-row">
        <span>查询起止时间：</span><span class="underline"></span>
      </div>

      <div class="report-page-row">
        <span>第1页/共1页</span>
        <el-button size="small" type="primary">首页</el-button>
        <el-button size="small" disabled>上一页</el-button>
        <el-button size="small" disabled>下一页</el-button>
        <el-button size="small" type="primary">尾页</el-button>
        <span>查第1页 每页20条记录 总共 {{ activeRowCount }} 条记录</span>
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
                      <td>{{ formatQty(row.yl) }}</td>
                      <td>{{ formatLoss(row.loss_rate) }}</td>
                      <td>{{ formatQty(row.total_qty) }}</td>
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
          <ReportHeader />
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
                  <td>{{ formatQty(row.sumby) }}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <el-empty v-else description="请选择 PI 号并查询物料单汇总" />
        </template>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, defineComponent, h, ref } from 'vue'
import { ElMessage } from 'element-plus'
import axios from 'axios'
import { aggregateBomCostUsageFlatForDisplay } from '@/utils/bomCostUsageAggregate.js'

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
    return () =>
      h('div', { class: 'blank-report-head' }, [
        h('div', { class: 'brand-line' }, '中山市卓越皮具有限公司'),
        h('div', { class: 'report-title' }, '成本物料单统计报表（成本价物料明细）'),
        h(
          'div',
          { class: 'head-grid' },
          fields.map((row) =>
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

function singleMaterialTotal(row, group) {
  const totalQty = Number(row?.total_qty)
  const orderQty = Number(group?.header?.orderQty)
  if (!Number.isFinite(totalQty) || !Number.isFinite(orderQty) || orderQty === 0) return 0
  return totalQty / orderQty
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
</style>
