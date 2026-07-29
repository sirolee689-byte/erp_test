<template>
  <div class="erp-module-page material-preparation-page">
    <div class="mode-toolbar no-print">
      <el-button
        v-for="item in modeOptions"
        :key="item.value"
        :type="activeMode === item.value ? 'primary' : 'default'"
        @click="switchMode(item.value)"
      >
        {{ item.label }}
      </el-button>
    </div>

    <div class="report-toolbar no-print">
      <el-button type="primary" @click="onPrint">打印统计报表</el-button>
      <el-button type="primary" @click="queryDialogVisible = true">查询内容</el-button>
      <el-popover placement="bottom-start" trigger="click" width="320">
        <template #reference><el-button>列设置</el-button></template>
        <div class="column-setting-panel">
          <div class="column-setting-title">固定列设置（打印、导出同步）</div>
          <el-checkbox-group v-model="checkedColumnKeys" @change="onColumnSettingChange">
            <el-checkbox v-for="col in configurableColumns" :key="col.key" :label="col.key">{{ col.label }}</el-checkbox>
          </el-checkbox-group>
          <el-button link type="primary" @click="resetColumnSetting">恢复默认</el-button>
        </div>
      </el-popover>
      <el-button v-if="isMaterialComponentMode" @click="openProductFilterDialog">
        产品编码筛选（{{ selectedProductCodes.length }}/{{ allProductCodes.length }}）
      </el-button>
      <el-button v-if="isMaterialComponentMode" @click="openComponentFilterDialog">
        配件列筛选（{{ selectedComponentNames.length }}/{{ allComponentNames.length }}）
      </el-button>
      <el-button v-if="hasExportPermission" @click="exportReportXlsx">导出信息</el-button>
    </div>

    <section class="report-shell">
      <ReportHeader :print-config="printConfig" :logo-src="printLogoSrc" />
      <h2 class="report-title">{{ reportTitle }}</h2>
      <div class="report-meta">
        <span>报表生成时间：{{ reportGeneratedAt || ' ' }}</span>
        <span>报表代码：{{ reportCode || ' ' }}</span>
      </div>
      <div class="report-meta">
        <span>PI号：{{ selectedPiNos.join('，') || ' ' }}</span>
      </div>
      <div class="report-done">统计完毕，一共：{{ detailCount }} 条记录</div>

      <el-skeleton :loading="loading" animated :rows="8">
        <template #default>
          <div class="report-table-wrap">
            <el-table
              v-erp-list-h-scroll
              :data="displayRows"
              border
              stripe
              row-key="rowKey"
              empty-text="暂无数据"
              :row-class-name="tableRowClassName"
              :span-method="spanMethod"
            >
              <el-table-column
                v-for="col in visibleColumns"
                :key="col.key"
                :prop="col.key"
                :label="col.label"
                :width="col.width"
                :min-width="col.minWidth"
                align="center"
              >
                <template #default="{ row }">{{ formatCell(row, col) }}</template>
              </el-table-column>
            </el-table>
          </div>
        </template>
      </el-skeleton>
    </section>

    <el-dialog v-model="queryDialogVisible" title="材料备料表查询" width="720px" :close-on-click-modal="!loading" :show-close="!loading">
      <el-form label-width="90px">
        <el-form-item label="PI号" required>
          <div class="pi-query-field">
            <el-input :model-value="selectedPiNos.join(', ')" readonly placeholder="请选择一个或多个PI" />
            <el-button type="primary" plain @click="openPiDialog">{{ selectedPiNos.length ? '重选' : '选择' }}</el-button>
          </div>
        </el-form-item>
      </el-form>
      <div v-if="queryProgress.active" class="query-progress-panel">
        <el-progress :percentage="100" :indeterminate="true" :show-text="false" />
        <p>正在生成备料表，已等待 {{ queryProgress.elapsedSec }} 秒。</p>
        <p v-if="queryProgress.elapsedSec >= 15" class="query-progress-hint">查询范围较大，请耐心等待，后台仍在统计。</p>
      </div>
      <template #footer>
        <el-button :disabled="loading" @click="queryDialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="loading" @click="loadReport">确定</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="piDialogVisible" title="选择 PI" width="900px" destroy-on-close append-to-body>
      <div class="pi-search-bar">
        <el-input v-model="piKeyword" clearable placeholder="输入PI号模糊查询" @keyup.enter="searchPiOptions" />
        <el-button type="primary" :loading="piLoading" @click="searchPiOptions">查询</el-button>
        <el-button type="primary" plain @click="confirmPiSelection">保存已选数据（{{ pendingPiNos.size }}）</el-button>
      </div>
      <el-table :data="piOptions" border empty-text="请输入PI号并点击查询">
        <el-table-column label="操作" width="110" align="center">
          <template #default="{ row }">
            <el-button
              size="small"
              :type="pendingPiNos.has(row.piNo) ? 'success' : 'primary'"
              :plain="!pendingPiNos.has(row.piNo)"
              @click="togglePi(row)"
            >
              {{ pendingPiNos.has(row.piNo) ? '已选择' : '选择' }}
            </el-button>
          </template>
        </el-table-column>
        <el-table-column prop="piNo" label="PI号" min-width="190" />
        <el-table-column prop="poNo" label="PO号" min-width="180" />
        <el-table-column prop="salesDate" label="销售订单日期" width="140">
          <template #default="{ row }">{{ formatDate(row.salesDate) }}</template>
        </el-table-column>
      </el-table>
      <div class="pi-pagination">
        <el-pagination
          v-model:current-page="piPage"
          v-model:page-size="piPageSize"
          :total="piTotal"
          :page-sizes="[10, 20, 50]"
          layout="total, sizes, prev, pager, next"
          @current-change="fetchPiOptions"
          @size-change="onPiPageSizeChange"
        />
      </div>
    </el-dialog>

    <el-dialog
      v-model="productFilterDialogVisible"
      title="产品编码筛选"
      width="720px"
      destroy-on-close
      append-to-body
    >
      <div class="component-filter-toolbar">
        <el-input
          v-model="productFilterKeyword"
          clearable
          placeholder="输入产品编码模糊搜索"
        />
        <el-button @click="selectAllProducts">全选</el-button>
        <el-button @click="clearPendingProducts">清空</el-button>
        <el-button type="primary" plain @click="selectMatchedProducts">选择当前搜索结果</el-button>
      </div>
      <el-table :data="filteredProductOptions" border max-height="440" empty-text="没有匹配的产品编码">
        <el-table-column label="操作" width="110" align="center">
          <template #default="{ row }">
            <el-button
              size="small"
              :type="pendingProductCodes.has(row.productCode) ? 'success' : 'primary'"
              :plain="!pendingProductCodes.has(row.productCode)"
              @click="toggleProduct(row.productCode)"
            >
              {{ pendingProductCodes.has(row.productCode) ? '已选择' : '选择' }}
            </el-button>
          </template>
        </el-table-column>
        <el-table-column prop="productCode" label="产品编码" min-width="300" />
      </el-table>
      <template #footer>
        <el-button @click="productFilterDialogVisible = false">取消</el-button>
        <el-button type="primary" @click="confirmProductFilter">
          确认筛选（{{ pendingProductCodes.size }}）
        </el-button>
      </template>
    </el-dialog>

    <el-dialog
      v-model="componentFilterDialogVisible"
      title="配件列筛选"
      width="720px"
      destroy-on-close
      append-to-body
    >
      <div class="component-filter-toolbar">
        <el-input
          v-model="componentFilterKeyword"
          clearable
          placeholder="输入配件列名称，例如主袋、拉牌"
        />
        <el-button @click="selectAllComponents">全选</el-button>
        <el-button @click="clearPendingComponents">清空</el-button>
        <el-button type="primary" plain @click="selectMatchedComponents">选择当前搜索结果</el-button>
      </div>
      <el-table :data="filteredComponentOptions" border max-height="440" empty-text="没有匹配的配件列">
        <el-table-column label="操作" width="110" align="center">
          <template #default="{ row }">
            <el-button
              size="small"
              :type="pendingComponentNames.has(row.componentName) ? 'success' : 'primary'"
              :plain="!pendingComponentNames.has(row.componentName)"
              @click="toggleComponent(row.componentName)"
            >
              {{ pendingComponentNames.has(row.componentName) ? '已选择' : '选择' }}
            </el-button>
          </template>
        </el-table-column>
        <el-table-column prop="componentName" label="配件列名称" min-width="300" />
      </el-table>
      <template #footer>
        <el-button @click="componentFilterDialogVisible = false">取消</el-button>
        <el-button type="primary" @click="confirmComponentFilter">
          确认筛选（{{ pendingComponentNames.size }}）
        </el-button>
      </template>
    </el-dialog>

    <section class="print-document" aria-hidden="true">
      <p class="print-time">打印时间：{{ reportGeneratedAt }}</p>
      <ReportHeader :print-config="printConfig" :logo-src="printLogoSrc" />
      <h2 class="report-title">{{ reportTitle }}</h2>
      <div class="report-meta">PI号：{{ selectedPiNos.join('，') }}</div>
      <table class="print-table">
        <thead><tr><th v-for="col in visibleColumns" :key="col.key">{{ col.label }}</th></tr></thead>
        <tbody>
          <tr v-for="row in displayRows" :key="row.rowKey" :class="{ 'print-group-row': row.rowType === 'group' }">
            <template v-if="row.rowType === 'group'">
              <td :colspan="visibleColumns.length">{{ row.groupLabel }}</td>
            </template>
            <template v-else>
              <td v-for="col in visibleColumns" :key="`${row.rowKey}-${col.key}`">{{ formatCell(row, col) }}</td>
            </template>
          </tr>
        </tbody>
      </table>
    </section>
  </div>
</template>

<script setup>
import { computed, defineComponent, h, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'
import axios from 'axios'
import ExcelJS from 'exceljs'
import { getPermissionModelFromStorage, hasPageAction } from '@/utils/menuPermission'

defineOptions({ name: 'InventoryAnalysisMaterialPreparation' })

const MENU_PATH = 'inventory/analysis/material-preparation'
const COLUMN_SETTING_KEY = 'erp.materialPreparation.columnSetting.v1'
const modeOptions = [
  { value: 'material-by-pi', label: '物料单备料表（分PI）' },
  { value: 'material-by-component', label: '物料单备料表（分配件）' },
  { value: 'outbound-by-pi', label: '出库单备料表（分PI）' },
  { value: 'outbound-by-component', label: '出库单备料表（分配件）' },
]
const fixedColumns = [
  { key: 'seq', label: '序号', width: 68 },
  { key: 'category', label: '类别', minWidth: 120 },
  { key: 'materialCode', label: '材料编码', minWidth: 140 },
  { key: 'materialName', label: '材料名称', minWidth: 190 },
  { key: 'materialSpec', label: '规格', minWidth: 150 },
  { key: 'color', label: '颜色', minWidth: 120 },
  { key: 'unit', label: '单位', width: 76 },
]
const materialComponentColumns = [
  { key: 'piNo', label: 'PI号', minWidth: 120 },
  { key: 'productCode', label: '产品编码', minWidth: 140 },
]
const outboundComponentColumns = [
  { key: 'componentCode', label: '配件编码', minWidth: 140 },
  { key: 'componentName', label: '配件名称', minWidth: 170 },
]

const permissionModel = computed(() => getPermissionModelFromStorage())
const hasExportPermission = computed(() => hasPageAction(permissionModel.value, MENU_PATH, 'export'))
const activeMode = ref('material-by-pi')
const loading = ref(false)
const queryDialogVisible = ref(false)
const piDialogVisible = ref(false)
const productFilterDialogVisible = ref(false)
const componentFilterDialogVisible = ref(false)
const piLoading = ref(false)
const piKeyword = ref('')
const piOptions = ref([])
const piPage = ref(1)
const piPageSize = ref(10)
const piTotal = ref(0)
const selectedPiNos = ref([])
const pendingPiNos = ref(new Set())
const reportPiList = ref([])
const rawRows = ref([])
const checkedColumnKeys = ref([])
const productFilterKeyword = ref('')
const selectedProductCodes = ref([])
const pendingProductCodes = ref(new Set())
const componentFilterKeyword = ref('')
const selectedComponentNames = ref([])
const pendingComponentNames = ref(new Set())
const printConfig = reactive({ info: '' })
const printLogoSrc = ref('')
const reportGeneratedAt = ref('')
const reportCode = ref('')
const queryProgress = reactive({ active: false, elapsedSec: 0 })
let queryProgressTimer

const ReportHeader = defineComponent({
  props: { printConfig: Object, logoSrc: String },
  setup(props) {
    return () => h('header', { class: 'report-header' }, [
      props.logoSrc ? h('div', { class: 'logo-wrap' }, [h('img', { class: 'logo', src: props.logoSrc, alt: 'logo' })]) : null,
      h('div', { class: 'head-info' }, [
        props.printConfig?.info
          ? h('div', { class: 'head-info-html', innerHTML: props.printConfig.info })
          : h('div', { class: 'head-info-placeholder' }, '请先在打印设定中维护抬头信息'),
      ]),
    ])
  },
})

const isByPiMode = computed(() => activeMode.value.endsWith('-by-pi'))
const isMaterialComponentMode = computed(() => activeMode.value === 'material-by-component')
const reportTitle = computed(() => modeOptions.find((item) => item.value === activeMode.value)?.label || '材料备料表')
const configurableColumns = computed(() => [
  ...fixedColumns,
  ...(activeMode.value === 'outbound-by-component' ? outboundComponentColumns : []),
])
const visibleFixedColumns = computed(() => {
  const selected = new Set(checkedColumnKeys.value)
  return [
    ...(isMaterialComponentMode.value ? materialComponentColumns : []),
    ...configurableColumns.value.filter((item) => selected.has(item.key)),
  ]
})
const dynamicPiColumns = computed(() => reportPiList.value.map((item, index) => ({
  key: `pi_${index}`,
  label: item.piNo,
  minWidth: 120,
  piNo: item.piNo,
  format: 'qty',
})))
const allDynamicComponentColumns = computed(() => {
  const names = []
  const seen = new Set()
  for (const row of rawRows.value) {
    const name = text(row.componentName) || '未命名配件'
    if (seen.has(name)) continue
    seen.add(name)
    names.push(name)
  }
  return names.map((componentName, index) => ({
    key: `component_${index}`,
    label: componentName,
    minWidth: 110,
    componentName,
    format: 'qty',
  }))
})
const allComponentNames = computed(() => allDynamicComponentColumns.value.map((item) => item.componentName))
const selectedComponentNameSet = computed(() => new Set(selectedComponentNames.value))
const dynamicComponentColumns = computed(() => allDynamicComponentColumns.value.filter(
  (item) => selectedComponentNameSet.value.has(item.componentName),
))
const filteredComponentOptions = computed(() => {
  const keyword = text(componentFilterKeyword.value).toLocaleLowerCase()
  return allComponentNames.value
    .filter((componentName) => !keyword || componentName.toLocaleLowerCase().includes(keyword))
    .map((componentName) => ({ componentName }))
})
const visibleColumns = computed(() => {
  if (isByPiMode.value) {
    return [...visibleFixedColumns.value, ...dynamicPiColumns.value, { key: 'totalQuantity', label: '合计', minWidth: 110, format: 'qty' }]
  }
  if (isMaterialComponentMode.value) {
    const totalLabel = selectedComponentNames.value.length === allComponentNames.value.length ? '合计' : '筛选合计'
    return [...visibleFixedColumns.value, ...dynamicComponentColumns.value, { key: 'totalQuantity', label: totalLabel, minWidth: 110, format: 'qty' }]
  }
  return [...visibleFixedColumns.value, { key: 'quantity', label: '数量', minWidth: 110, format: 'qty' }]
})

function materialKey(row) {
  return [row.categoryCode, row.categoryName, row.materialCode, row.materialName, row.materialSpec, row.colorCode, row.colorName, row.unit].join('\u0000')
}

const pivotRows = computed(() => {
  const map = new Map()
  for (const row of rawRows.value) {
    const key = materialKey(row)
    if (!map.has(key)) map.set(key, { ...row, quantities: {}, totalQuantity: 0 })
    const target = map.get(key)
    target.quantities[row.piNo] = round6(numberValue(target.quantities[row.piNo]) + numberValue(row.quantity))
    target.totalQuantity = round6(target.totalQuantity + numberValue(row.quantity))
  }
  return [...map.values()]
    .sort((a, b) => `${a.categoryCode}-${a.materialCode}`.localeCompare(`${b.categoryCode}-${b.materialCode}`, 'zh-CN'))
    .map((row, index) => ({ ...row, seq: index + 1, rowKey: `detail-${index}` }))
})

const materialComponentRows = computed(() => {
  const map = new Map()
  for (const row of rawRows.value) {
    const key = [row.piNo, row.productCode, materialKey(row)].join('\u0000')
    if (!map.has(key)) map.set(key, { ...row, componentQuantities: {} })
    const target = map.get(key)
    const componentName = text(row.componentName) || '未命名配件'
    target.componentQuantities[componentName] = round6(
      numberValue(target.componentQuantities[componentName]) + numberValue(row.quantity),
    )
  }
  return [...map.values()]
    .sort((a, b) => {
      const piSort = selectedPiNos.value.indexOf(a.piNo) - selectedPiNos.value.indexOf(b.piNo)
      if (piSort) return piSort
      return `${a.productCode}-${a.categoryCode}-${a.materialCode}`
        .localeCompare(`${b.productCode}-${b.categoryCode}-${b.materialCode}`, 'zh-CN')
    })
})

const allProductCodes = computed(() => {
  const codes = []
  const seen = new Set()
  for (const row of materialComponentRows.value) {
    const productCode = text(row.productCode) || '未填写产品编码'
    if (seen.has(productCode)) continue
    seen.add(productCode)
    codes.push(productCode)
  }
  return codes
})
const selectedProductCodeSet = computed(() => new Set(selectedProductCodes.value))
const filteredProductOptions = computed(() => {
  const keyword = text(productFilterKeyword.value).toLocaleLowerCase()
  return allProductCodes.value
    .filter((productCode) => !keyword || productCode.toLocaleLowerCase().includes(keyword))
    .map((productCode) => ({ productCode }))
})

const filteredMaterialComponentRows = computed(() => {
  const selectedNames = selectedComponentNames.value
  return materialComponentRows.value
    .filter((row) => selectedProductCodeSet.value.has(text(row.productCode) || '未填写产品编码'))
    .map((row) => {
      const quantities = selectedNames.map((componentName) => numberValue(row.componentQuantities?.[componentName]))
      return {
        ...row,
        totalQuantity: round6(quantities.reduce((sum, quantity) => sum + quantity, 0)),
        hasSelectedQuantity: quantities.some((quantity) => Math.abs(quantity) > 0.0000005),
      }
    })
    .filter((row) => row.hasSelectedQuantity)
    .map((row, index) => ({ ...row, seq: index + 1, rowKey: `detail-${index}` }))
})

const componentRows = computed(() => {
  const rows = [...rawRows.value].sort((a, b) => {
    const piSort = selectedPiNos.value.indexOf(a.piNo) - selectedPiNos.value.indexOf(b.piNo)
    if (piSort) return piSort
    return `${a.componentCode}-${a.materialCode}`.localeCompare(`${b.componentCode}-${b.materialCode}`, 'zh-CN')
  })
  const output = []
  let currentPi = ''
  let currentComponent = ''
  let seq = 0
  for (const row of rows) {
    if (row.piNo !== currentPi) {
      currentPi = row.piNo
      currentComponent = ''
      const pi = reportPiList.value.find((item) => item.piNo === row.piNo)
      output.push({ rowKey: `pi-${row.piNo}`, rowType: 'group', groupLabel: `PI：${row.piNo}　PO：${pi?.poNo || ''}　日期：${formatDate(pi?.salesDate)}` })
    }
    const componentKey = `${row.piNo}\u0000${row.componentCode}\u0000${row.componentName}`
    if (componentKey !== currentComponent) {
      currentComponent = componentKey
      output.push({ rowKey: `component-${componentKey}`, rowType: 'group', groupLabel: `配件：${row.componentCode || ''} ${row.componentName || '未匹配配件'}`.trim() })
    }
    seq += 1
    output.push({ ...row, seq, rowKey: `detail-${seq}` })
  }
  return output
})

const displayRows = computed(() => {
  if (isByPiMode.value) return pivotRows.value
  if (isMaterialComponentMode.value) return filteredMaterialComponentRows.value
  return componentRows.value
})
const detailCount = computed(() => displayRows.value.filter((row) => row.rowType !== 'group').length)

function text(value) { return String(value ?? '').trim() }
function numberValue(value) { const n = Number(value); return Number.isFinite(n) ? n : 0 }
function round6(value) { return Math.round((numberValue(value) + Number.EPSILON) * 1_000_000) / 1_000_000 }
function formatQty(value) { return numberValue(value).toFixed(6).replace(/\.?0+$/, '') || '0' }
function formatDate(value) { return text(value).slice(0, 10) }
function pad2(value) { return String(value).padStart(2, '0') }
function formatNow() { const d = new Date(); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}` }
function makeReportCode() { return `${Date.now()}${Math.random().toString(16).slice(2)}`.toUpperCase().replace(/[^0-9A-F]/g, '').slice(0, 16) }
function formatCategory(row) { return `${text(row.categoryCode)} ${text(row.categoryName)}`.trim() }
function formatColor(row) { return `${text(row.colorCode)} ${text(row.colorName)}`.trim() }
function formatCell(row, col) {
  if (row.rowType === 'group') return col === visibleColumns.value[0] ? row.groupLabel : ''
  if (col.piNo) return formatQty(row.quantities?.[col.piNo])
  if (col.componentName) return formatQty(row.componentQuantities?.[col.componentName])
  if (col.key === 'category') return formatCategory(row)
  if (col.key === 'color') return formatColor(row)
  if (col.format === 'qty') return formatQty(row[col.key])
  return row[col.key] ?? ''
}
function tableRowClassName({ row }) { return row.rowType === 'group' ? 'is-group-row' : '' }
function spanMethod({ row, columnIndex }) { return row.rowType === 'group' ? (columnIndex === 0 ? [1, visibleColumns.value.length] : [0, 0]) : [1, 1] }

function normalizeColumnKeys(keys) {
  const allowed = new Set([...fixedColumns, ...outboundComponentColumns].map((item) => item.key))
  return [...new Set((Array.isArray(keys) ? keys : []).filter((key) => allowed.has(key)))]
}
function saveColumnSetting() { try { localStorage.setItem(COLUMN_SETTING_KEY, JSON.stringify(checkedColumnKeys.value)) } catch {} }
function loadColumnSetting() {
  try {
    const keys = normalizeColumnKeys(JSON.parse(localStorage.getItem(COLUMN_SETTING_KEY) || '[]'))
    checkedColumnKeys.value = keys.length ? keys : [...fixedColumns, ...outboundComponentColumns].map((item) => item.key)
  } catch {
    checkedColumnKeys.value = [...fixedColumns, ...outboundComponentColumns].map((item) => item.key)
  }
}
function onColumnSettingChange(value) {
  const keys = normalizeColumnKeys(value)
  if (!keys.length) {
    ElMessage.warning('至少保留一列固定列')
    resetColumnSetting()
    return
  }
  checkedColumnKeys.value = keys
  saveColumnSetting()
}
function resetColumnSetting() {
  checkedColumnKeys.value = [...fixedColumns, ...outboundComponentColumns].map((item) => item.key)
  saveColumnSetting()
}

function resetProductFilter(rows = rawRows.value) {
  const codes = []
  const seen = new Set()
  for (const row of rows) {
    const productCode = text(row.productCode) || '未填写产品编码'
    if (seen.has(productCode)) continue
    seen.add(productCode)
    codes.push(productCode)
  }
  selectedProductCodes.value = codes
  pendingProductCodes.value = new Set(codes)
  productFilterKeyword.value = ''
}
function openProductFilterDialog() {
  pendingProductCodes.value = new Set(selectedProductCodes.value)
  productFilterKeyword.value = ''
  productFilterDialogVisible.value = true
}
function toggleProduct(productCode) {
  const next = new Set(pendingProductCodes.value)
  if (next.has(productCode)) next.delete(productCode)
  else next.add(productCode)
  pendingProductCodes.value = next
}
function selectAllProducts() {
  pendingProductCodes.value = new Set(allProductCodes.value)
}
function clearPendingProducts() {
  pendingProductCodes.value = new Set()
}
function selectMatchedProducts() {
  const next = new Set(pendingProductCodes.value)
  for (const item of filteredProductOptions.value) next.add(item.productCode)
  pendingProductCodes.value = next
}
function confirmProductFilter() {
  if (!pendingProductCodes.value.size) {
    ElMessage.warning('请至少选择一个产品编码')
    return
  }
  selectedProductCodes.value = allProductCodes.value.filter((code) => pendingProductCodes.value.has(code))
  productFilterDialogVisible.value = false
}

function resetComponentFilter(rows = rawRows.value) {
  const names = []
  const seen = new Set()
  for (const row of rows) {
    const componentName = text(row.componentName) || '未命名配件'
    if (seen.has(componentName)) continue
    seen.add(componentName)
    names.push(componentName)
  }
  selectedComponentNames.value = names
  pendingComponentNames.value = new Set(names)
  componentFilterKeyword.value = ''
}
function openComponentFilterDialog() {
  pendingComponentNames.value = new Set(selectedComponentNames.value)
  componentFilterKeyword.value = ''
  componentFilterDialogVisible.value = true
}
function toggleComponent(componentName) {
  const next = new Set(pendingComponentNames.value)
  if (next.has(componentName)) next.delete(componentName)
  else next.add(componentName)
  pendingComponentNames.value = next
}
function selectAllComponents() {
  pendingComponentNames.value = new Set(allComponentNames.value)
}
function clearPendingComponents() {
  pendingComponentNames.value = new Set()
}
function selectMatchedComponents() {
  const next = new Set(pendingComponentNames.value)
  for (const item of filteredComponentOptions.value) next.add(item.componentName)
  pendingComponentNames.value = next
}
function confirmComponentFilter() {
  if (!pendingComponentNames.value.size) {
    ElMessage.warning('请至少选择一个配件列')
    return
  }
  selectedComponentNames.value = allComponentNames.value.filter((name) => pendingComponentNames.value.has(name))
  componentFilterDialogVisible.value = false
}

async function loadPrintHeader() {
  try {
    const { data } = await axios.get('/api/material-preparation/print-header')
    const config = data?.data ?? {}
    printConfig.info = config.headerHtml || config.info || ''
    printLogoSrc.value = config.logoSrc || ''
  } catch {}
}

function openPiDialog() {
  pendingPiNos.value = new Set(selectedPiNos.value)
  piDialogVisible.value = true
  piOptions.value = []
  piTotal.value = 0
}
function togglePi(row) {
  const next = new Set(pendingPiNos.value)
  if (next.has(row.piNo)) next.delete(row.piNo)
  else next.add(row.piNo)
  pendingPiNos.value = next
}
function confirmPiSelection() {
  selectedPiNos.value = [...pendingPiNos.value]
  piDialogVisible.value = false
}
async function fetchPiOptions() {
  if (!text(piKeyword.value)) {
    piOptions.value = []
    piTotal.value = 0
    ElMessage.warning('请输入PI号后查询')
    return
  }
  piLoading.value = true
  try {
    const { data } = await axios.get('/api/material-preparation/pi-options', {
      params: { keyword: text(piKeyword.value), page: piPage.value, pageSize: piPageSize.value },
    })
    piOptions.value = data?.data?.list || []
    piTotal.value = numberValue(data?.data?.total)
  } catch (error) {
    ElMessage.error(text(error?.response?.data?.msg || error?.message || '读取PI候选失败'))
  } finally {
    piLoading.value = false
  }
}
function searchPiOptions() { piPage.value = 1; fetchPiOptions() }
function onPiPageSizeChange() { piPage.value = 1; fetchPiOptions() }

function stopProgress() {
  if (queryProgressTimer) clearInterval(queryProgressTimer)
  queryProgressTimer = null
  queryProgress.active = false
}
function startProgress() {
  stopProgress()
  queryProgress.active = true
  queryProgress.elapsedSec = 0
  queryProgressTimer = setInterval(() => { queryProgress.elapsedSec += 1 }, 1000)
}
async function loadReport() {
  if (!selectedPiNos.value.length) {
    ElMessage.warning('请选择PI号')
    return
  }
  loading.value = true
  startProgress()
  try {
    const { data } = await axios.get('/api/material-preparation/report', {
      params: { mode: activeMode.value, piNos: selectedPiNos.value.join(',') },
      timeout: 180000,
    })
    const body = data?.data ?? {}
    reportPiList.value = body.piList || []
    rawRows.value = body.list || []
    if (activeMode.value === 'material-by-component') {
      resetProductFilter(rawRows.value)
      resetComponentFilter(rawRows.value)
    } else {
      resetProductFilter([])
      resetComponentFilter([])
    }
    reportGeneratedAt.value = formatNow()
    reportCode.value = makeReportCode()
    queryDialogVisible.value = false
    ElMessage.success('统计完成')
  } catch (error) {
    ElMessage.error(text(error?.response?.data?.msg || error?.message || '读取材料备料表失败'))
  } finally {
    loading.value = false
    stopProgress()
  }
}
async function switchMode(mode) {
  activeMode.value = mode
  if (selectedPiNos.value.length) await loadReport()
}
function onPrint() {
  if (!detailCount.value) return ElMessage.warning('暂无数据可打印')
  window.print()
}

async function exportReportXlsx() {
  if (!hasExportPermission.value) return ElMessage.warning('没有导出权限')
  if (!detailCount.value) return ElMessage.warning('暂无数据可导出')
  const workbook = new ExcelJS.Workbook()
  const worksheet = workbook.addWorksheet(reportTitle.value, {
    views: [{ state: 'frozen', ySplit: 5 }],
    pageSetup: { paperSize: 9, orientation: 'landscape', fitToWidth: 1 },
  })
  const columns = visibleColumns.value
  const columnCount = columns.length
  const titleRow = worksheet.addRow([reportTitle.value])
  worksheet.mergeCells(titleRow.number, 1, titleRow.number, columnCount)
  titleRow.font = { bold: true, size: 14 }
  titleRow.alignment = { horizontal: 'center' }
  const metaRow = worksheet.addRow([`报表生成时间：${reportGeneratedAt.value}`, `报表代码：${reportCode.value}`])
  const middle = Math.max(1, Math.floor(columnCount / 2))
  worksheet.mergeCells(metaRow.number, 1, metaRow.number, middle)
  worksheet.mergeCells(metaRow.number, middle + 1, metaRow.number, columnCount)
  const filterRow = worksheet.addRow([`PI号：${selectedPiNos.value.join('，')}`])
  worksheet.mergeCells(filterRow.number, 1, filterRow.number, columnCount)
  worksheet.addRow([])
  const headerRow = worksheet.addRow(columns.map((col) => col.label))
  headerRow.font = { bold: true }
  for (const row of displayRows.value) {
    if (row.rowType === 'group') {
      const excelRow = worksheet.addRow([row.groupLabel])
      worksheet.mergeCells(excelRow.number, 1, excelRow.number, columnCount)
      excelRow.font = { bold: true }
    } else {
      worksheet.addRow(columns.map((col) => formatCell(row, col)))
    }
  }
  worksheet.columns.forEach((column, index) => {
    column.width = Math.max(10, Math.min(36, Math.round((columns[index]?.width || columns[index]?.minWidth || 120) / 8)))
  })
  const blob = new Blob([await workbook.xlsx.writeBuffer()], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `${reportTitle.value}-${selectedPiNos.value.join('_')}`.replace(/[\\/:*?"<>|]/g, '_').slice(0, 160) + '.xlsx'
  anchor.click()
  URL.revokeObjectURL(url)
  ElMessage.success('已导出 xlsx')
}

onMounted(() => {
  loadColumnSetting()
  loadPrintHeader()
})
onBeforeUnmount(stopProgress)
</script>

<style scoped>
.material-preparation-page { min-height: calc(100vh - 118px); padding: 8px; background: #f5f7fb; }
.mode-toolbar, .report-toolbar { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 8px; }
.mode-toolbar { padding-bottom: 8px; border-bottom: 1px solid #dce3ee; }
.report-shell { min-height: calc(100vh - 220px); padding: 18px 36px 48px; background: #fff; color: #000; }
.report-header { display: flex; flex-direction: column; align-items: center; text-align: center; }
.report-header :deep(.logo-wrap) { width: 100%; display: flex; justify-content: center; align-items: center; }
.report-header :deep(.logo) { display: block; width: auto !important; height: auto !important; max-width: 260px !important; max-height: 48px !important; object-fit: contain; }
.report-header :deep(.head-info) { width: 100%; font-size: 14px; line-height: 1.3; color: #000; }
.report-header :deep(.head-info-html *) { margin-top: 0; margin-bottom: 0; }
.report-title { margin: 4px 0 6px; text-align: center; font-size: 20px; }
.report-meta { display: flex; flex-wrap: wrap; gap: 30px; margin: 2px 0; font-size: 13px; }
.report-done { margin: 12px 0 4px; color: #d00; font-size: 13px; }
.report-table-wrap { overflow-x: auto; }
.report-table-wrap :deep(.el-table) { min-width: 1120px; }
.report-table-wrap :deep(.is-group-row td) { font-weight: 700; text-align: left; background: #edf2f7 !important; }
.column-setting-title { margin-bottom: 8px; color: #606266; }
.column-setting-panel :deep(.el-checkbox) { width: 48%; margin-right: 0; }
.pi-query-field { display: flex; width: 100%; gap: 8px; }
.pi-search-bar { display: flex; gap: 10px; margin-bottom: 12px; }
.pi-search-bar .el-input { flex: 1; }
.pi-pagination { display: flex; justify-content: flex-end; margin-top: 14px; }
.component-filter-toolbar { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 12px; }
.component-filter-toolbar .el-input { min-width: 260px; flex: 1; }
.query-progress-panel { margin: 10px 0 0; text-align: center; color: #606266; }
.query-progress-hint { color: #d97706; }
.print-document { display: none; }
@media print {
  .no-print, .mode-toolbar, .report-toolbar, .report-shell { display: none !important; }
  .print-document { display: block; color: #000; }
  .print-time { font-size: 10px; }
  .print-table { width: 100%; border-collapse: collapse; font-size: 9px; }
  .print-table th, .print-table td { border: 1px solid #333; padding: 3px; text-align: center; word-break: break-all; }
  .print-group-row td { font-weight: 700; text-align: left; background: #eee !important; }
}
@media (max-width: 760px) {
  .report-shell { padding: 12px; }
  .pi-search-bar { flex-wrap: wrap; }
}
</style>
