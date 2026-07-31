<script setup>
/**
 * v1.1.6 宿舍电费报表（Tabs）
 * - Tab1：宿舍维度 GET /api/dorm/electric-report-data
 * - Tab2：人员分摊 GET /api/dorm/electric-allocation-report（算法与 ElectricManage.vue / v1.1.9 一致）
 */
import { computed, onMounted, ref } from 'vue'
import axios from 'axios'
import ExcelJS from 'exceljs'
import { Refresh, Download, Printer } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'

const activeTab = ref('summary')
const loading = ref(false)
const year = ref(new Date().getFullYear())
const month = ref(new Date().getMonth() + 1)

const tableData = ref([])
const statRoomCount = ref(0)
const statPeopleSum = ref(0)

const allocTableData = ref([])
/** Tab2：后端返回的异常说明（入住人数对账、未审/天数异常未参与摊费） */
const allocationAnomalyHint = ref('')

const SUMMARY_COLUMN_SETTING_KEY = 'erp.dormitory.electric-report.summary-columns.v1'
const ALLOCATION_COLUMN_SETTING_KEY = 'erp.dormitory.electric-report.allocation-columns.v1'

/** Tab1：报表生成时间（每次点击「查询」成功后刷新） */
const reportGeneratedAt = ref('')

const yearOptions = computed(() => {
  const out = []
  for (let y = 2020; y <= 2035; y += 1) out.push(y)
  return out
})

const monthOptions = computed(() => {
  const out = []
  for (let m = 1; m <= 12; m += 1) out.push(m)
  return out
})

const monthLabel = computed(() => `${year.value}年${month.value}月`)
const monthTitleYm = computed(() => `${year.value}-${month.value}`)

function pad2(n) {
  return String(n).padStart(2, '0')
}

function formatNow() {
  const d = new Date()
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`
}

function fmtMoney(v) {
  const n = Number(v)
  if (!Number.isFinite(n)) return '—'
  return n.toFixed(2)
}

function fmtNum(v) {
  const n = Number(v)
  if (!Number.isFinite(n)) return '—'
  if (n === 0) return '0'
  return String(n)
}

function fmtShareEle(v) {
  const n = Number(v)
  if (!Number.isFinite(n)) return '—'
  const r = Math.round(n * 10000) / 10000
  return String(r)
}

function cellText(v) {
  if (v == null) return ''
  const s = String(v).trim()
  return s || ''
}

function isChangeMeter(row) {
  return String(row?.c_change ?? '').trim() === '1'
}

const summaryColumns = [
  { key: 'room_code', label: '宿舍编码', prop: 'room_code', minWidth: 96, fixed: 'left' },
  { key: 'room_name', label: '宿舍名称', prop: 'room_name', minWidth: 88 },
  { key: 'occupant_count_month', label: '入住人数', prop: 'occupant_count_month', width: 88, align: 'center' },
  { key: 'month', label: '月份', width: 100, align: 'center', value: () => monthLabel.value },
  { key: 'meter_read_date', label: '抄表日期', prop: 'meter_read_date', minWidth: 120 },
  { key: 'meter_reader', label: '抄表人', prop: 'meter_reader', width: 100 },
  { key: 'c_star', label: '上期抄表数', prop: 'c_star', width: 100, align: 'right' },
  { key: 'c_this', label: '本期抄表数', prop: 'c_this', width: 100, align: 'right' },
  { key: 'c_old_end', label: '换表旧表结束数', width: 120, align: 'right', value: (row) => (isChangeMeter(row) ? cellText(row.c_old_end) : '—') },
  { key: 'c_new_star', label: '新表开始数', width: 100, align: 'right', value: (row) => (isChangeMeter(row) ? cellText(row.c_new_star) : '—') },
  { key: 'used_electric', label: '用电量', prop: 'used_electric', width: 88, align: 'right' },
  { key: 'discount_kwh_month', label: '优惠电量', width: 88, align: 'right', value: (row) => fmtNum(row.discount_kwh_month) },
  { key: 'unit_price', label: '电费单价', prop: 'unit_price', width: 88, align: 'right' },
  { key: 'total_money', label: '电费', width: 96, align: 'right', value: (row) => fmtMoney(row.total_money) },
  { key: 'remark', label: '备注', prop: 'remark', minWidth: 100 },
]

const allocationColumns = [
  { key: 'month', label: '月份', width: 88, align: 'center', value: () => monthTitleYm.value },
  { key: 'room_code', label: '房号', prop: 'room_code', width: 96 },
  { key: 'staff_archive_code', label: '员工档案号', minWidth: 110, value: (row) => cellText(row.staff_archive_code) || cellText(row.staff_code) },
  { key: 'staff_display_name', label: '姓名', minWidth: 120, value: (row) => cellText(row.staff_display_name) || cellText(row.staff_truename) },
  { key: 'dept_name', label: '部门', prop: 'dept_name', minWidth: 120 },
  { key: 'position_name', label: '职务', prop: 'position_name', width: 100 },
  { key: 'c_star', label: '上期抄表数', prop: 'c_star', width: 100, align: 'right' },
  { key: 'c_this', label: '本期抄表数', prop: 'c_this', width: 100, align: 'right' },
  { key: 'dorm_used_electric', label: '宿舍用电量', prop: 'dorm_used_electric', width: 100, align: 'right' },
  { key: 'share_electric', label: '个人分摊电量', width: 110, align: 'right', value: (row) => fmtShareEle(row.share_electric) },
  { key: 'personal_discount_electric', label: '个人优惠电量', width: 110, align: 'right', value: (row) => fmtNum(row.personal_discount_electric) },
  { key: 'unit_price', label: '电费单价', prop: 'unit_price', width: 88, align: 'right' },
  { key: 'stay_days', label: '住宿天数', prop: 'stay_days', width: 88, align: 'center' },
  { key: 'share_money', label: '分摊电费', width: 120, align: 'right', value: (row) => fmtMoney(row.share_money) },
]

const summaryColumnKeys = ref([])
const allocationColumnKeys = ref([])
const activeColumnDefinitions = computed(() => (activeTab.value === 'summary' ? summaryColumns : allocationColumns))
const activeColumnKeys = computed({
  get: () => (activeTab.value === 'summary' ? summaryColumnKeys.value : allocationColumnKeys.value),
  set: (keys) => {
    const validKeys = activeColumnDefinitions.value.map((column) => column.key)
    const normalized = Array.isArray(keys) ? keys.filter((key) => validKeys.includes(key)) : []
    if (activeTab.value === 'summary') {
      summaryColumnKeys.value = normalized
      persistColumnSetting(SUMMARY_COLUMN_SETTING_KEY, normalized)
    } else {
      allocationColumnKeys.value = normalized
      persistColumnSetting(ALLOCATION_COLUMN_SETTING_KEY, normalized)
    }
  },
})
const visibleSummaryColumns = computed(() => summaryColumns.filter((column) => summaryColumnKeys.value.includes(column.key)))
const visibleAllocationColumns = computed(() => allocationColumns.filter((column) => allocationColumnKeys.value.includes(column.key)))

function loadColumnSetting(storageKey, columns) {
  try {
    const raw = localStorage.getItem(storageKey)
    const keys = raw ? JSON.parse(raw) : []
    const allowed = new Set(columns.map((column) => column.key))
    const selected = Array.isArray(keys) ? keys.filter((key) => allowed.has(key)) : []
    return selected.length ? selected : columns.map((column) => column.key)
  } catch {
    return columns.map((column) => column.key)
  }
}

function persistColumnSetting(storageKey, keys) {
  try {
    localStorage.setItem(storageKey, JSON.stringify(keys))
  } catch {
    // 本机列设置写入失败不影响统计查询。
  }
}

function resetColumnSetting() {
  activeColumnKeys.value = activeColumnDefinitions.value.map((column) => column.key)
}

function columnValue(row, column) {
  return typeof column.value === 'function' ? column.value(row) : cellText(row?.[column.prop])
}

async function loadSummary() {
  const res = await axios.get('/api/dorm/electric-report-data', {
    params: { year: year.value, month: month.value },
  })
  if (res.data?.code !== 200) {
    throw new Error(res.data?.msg || '宿舍报表加载失败')
  }
  const d = res.data.data ?? {}
  tableData.value = Array.isArray(d.list) ? d.list : []
  statRoomCount.value = Number(d.stat_room_count ?? 0)
  statPeopleSum.value = Number(d.stat_people_sum ?? 0)
}

async function loadAllocation() {
  const res = await axios.get('/api/dorm/electric-allocation-report', {
    params: { year: year.value, month: month.value },
  })
  if (res.data?.code !== 200) {
    throw new Error(res.data?.msg || '分摊报表加载失败')
  }
  const d = res.data.data ?? {}
  allocTableData.value = Array.isArray(d.list) ? d.list : []
  allocationAnomalyHint.value = String(d.allocation_anomaly_hint ?? '').trim()
}

/** 共享工具栏：一次查询刷新两个 Tab 的数据 */
async function onQuery() {
  loading.value = true
  try {
    await Promise.all([loadSummary(), loadAllocation()])
    reportGeneratedAt.value = formatNow()
  } catch (e) {
    console.error(e)
    ElMessage.error(String(e?.response?.data?.msg ?? e?.message ?? '加载失败'))
  } finally {
    loading.value = false
  }
}

async function exportSummaryXls() {
  if (!tableData.value.length) {
    ElMessage.warning('暂无数据可导出')
    return
  }
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('宿舍电费情况表', { views: [{ state: 'frozen', ySplit: 1 }] })
  if (!visibleSummaryColumns.value.length) {
    ElMessage.warning('请至少保留一列后再导出')
    return
  }
  ws.addRow(visibleSummaryColumns.value.map((column) => column.label))
  ws.getRow(1).font = { bold: true }
  for (const row of tableData.value) {
    ws.addRow(visibleSummaryColumns.value.map((column) => columnValue(row, column)))
  }
  ws.columns.forEach((col) => {
    let max = 10
    col.eachCell?.({ includeEmpty: true }, (cell) => {
      const len = String(cell.value ?? '').length
      if (len > max) max = len
    })
    col.width = Math.min(40, Math.max(12, max + 2))
  })
  const buf = await wb.xlsx.writeBuffer()
  const blob = new Blob([buf], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `宿舍电费情况表_${year.value}-${pad2(month.value)}.xlsx`
  a.click()
  URL.revokeObjectURL(url)
  ElMessage.success('已导出 XLS')
}

async function exportAllocationXls() {
  if (!allocTableData.value.length) {
    ElMessage.warning('暂无分摊数据可导出（需已完成抄表且当月有在住人员）')
    return
  }
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('宿舍费用分摊', { views: [{ state: 'frozen', ySplit: 1 }] })
  if (!visibleAllocationColumns.value.length) {
    ElMessage.warning('请至少保留一列后再导出')
    return
  }
  ws.addRow(visibleAllocationColumns.value.map((column) => column.label))
  ws.getRow(1).font = { bold: true }
  for (const row of allocTableData.value) {
    ws.addRow(visibleAllocationColumns.value.map((column) => columnValue(row, column)))
  }
  ws.columns.forEach((col) => {
    let max = 10
    col.eachCell?.({ includeEmpty: true }, (cell) => {
      const len = String(cell.value ?? '').length
      if (len > max) max = len
    })
    col.width = Math.min(42, Math.max(10, max + 2))
  })
  const buf = await wb.xlsx.writeBuffer()
  const blob = new Blob([buf], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `宿舍费用分摊_${year.value}-${pad2(month.value)}.xlsx`
  a.click()
  URL.revokeObjectURL(url)
  ElMessage.success('已导出分摊 XLS')
}

function onPrintAllocation() {
  if (!allocTableData.value.length) {
    ElMessage.warning('暂无分摊数据可导出')
    return
  }
  activeTab.value = 'allocation'
  document.documentElement.classList.add('print-electric-allocation')
  setTimeout(() => {
    window.print()
    setTimeout(() => document.documentElement.classList.remove('print-electric-allocation'), 800)
  }, 100)
}

function onPrintSummary() {
  activeTab.value = 'summary'
  document.documentElement.classList.add('print-electric-summary')
  setTimeout(() => {
    window.print()
    setTimeout(() => document.documentElement.classList.remove('print-electric-summary'), 800)
  }, 50)
}

onMounted(() => {
  summaryColumnKeys.value = loadColumnSetting(SUMMARY_COLUMN_SETTING_KEY, summaryColumns)
  allocationColumnKeys.value = loadColumnSetting(ALLOCATION_COLUMN_SETTING_KEY, allocationColumns)
  onQuery()
})
</script>

<template>
  <div class="erp-module-page electric-report-page">
    <el-card shadow="never" class="toolbar-card no-print">
      <div class="hint-line muted">温馨提示：报表统计，需要完成抄表。</div>
      <div class="toolbar-row">
        <span class="toolbar-label">统计年月</span>
        <el-select v-model="year" style="width: 110px">
          <el-option v-for="y in yearOptions" :key="y" :label="String(y)" :value="y" />
        </el-select>
        <span class="toolbar-gap">年</span>
        <el-select v-model="month" style="width: 90px">
          <el-option v-for="m in monthOptions" :key="m" :label="String(m)" :value="m" />
        </el-select>
        <span class="toolbar-gap">月</span>
        <el-button type="primary" :loading="loading" @click="onQuery">
          <el-icon class="btn-icon"><Refresh /></el-icon>
          查询
        </el-button>
      </div>
    </el-card>

    <el-tabs v-model="activeTab" class="report-tabs no-print">
      <el-tab-pane label="宿舍电费情况表" name="summary" />
      <el-tab-pane label="宿舍费用分摊情况" name="allocation" />
    </el-tabs>

    <!-- Tab1 -->
    <div v-show="activeTab === 'summary'" class="report-sheet summary-only">
      <div class="tab-inner-toolbar no-print">
        <el-popover placement="bottom-start" trigger="click" width="300">
          <template #reference><el-button>列设置</el-button></template>
          <div class="column-setting-panel">
            <div class="column-setting-title">勾选要显示的列（打印、导出同步）</div>
            <el-checkbox-group v-model="activeColumnKeys" class="column-setting-list">
              <el-checkbox v-for="column in activeColumnDefinitions" :key="column.key" :label="column.key">{{ column.label }}</el-checkbox>
            </el-checkbox-group>
            <div class="column-setting-actions"><el-button link type="primary" @click="resetColumnSetting">恢复默认</el-button></div>
          </div>
        </el-popover>
        <el-button v-permission="'view'" type="success" :disabled="loading" @click="exportSummaryXls">
          <el-icon class="btn-icon"><Download /></el-icon>
          导出信息
        </el-button>
        <el-button v-permission="'view'" @click="onPrintSummary">
          <el-icon class="btn-icon"><Printer /></el-icon>
          打印统计报表
        </el-button>
      </div>
      <div class="report-title-block">
        <h1 class="report-title">宿舍电费情况表</h1>
        <div class="report-meta-line">报表生成时间：{{ reportGeneratedAt || '—' }}</div>
      </div>
      <div class="report-summary">
        宿舍共计 <strong>{{ statRoomCount }}</strong> 间，住宿总人数 <strong>{{ statPeopleSum }}</strong> 人
      </div>

      <el-table
        v-loading="loading"
        :data="tableData"
        border
        stripe
        size="small"
        class="report-table"
        data-testid="electric-summary-table"
        empty-text="暂无数据"
      >
        <el-table-column
          v-for="column in visibleSummaryColumns"
          :key="column.key"
          :prop="column.prop"
          :label="column.label"
          :width="column.width"
          :min-width="column.minWidth"
          :align="column.align"
          :fixed="column.fixed"
          show-overflow-tooltip
        >
          <template #default="{ row }">{{ columnValue(row, column) }}</template>
        </el-table-column>
      </el-table>
    </div>

    <!-- Tab2 -->
    <div v-show="activeTab === 'allocation'" class="report-sheet allocation-only">
      <div class="tab-inner-toolbar no-print">
        <el-popover placement="bottom-start" trigger="click" width="300">
          <template #reference><el-button>列设置</el-button></template>
          <div class="column-setting-panel">
            <div class="column-setting-title">勾选要显示的列（打印、导出同步）</div>
            <el-checkbox-group v-model="activeColumnKeys" class="column-setting-list">
              <el-checkbox v-for="column in activeColumnDefinitions" :key="column.key" :label="column.key">{{ column.label }}</el-checkbox>
            </el-checkbox-group>
            <div class="column-setting-actions"><el-button link type="primary" @click="resetColumnSetting">恢复默认</el-button></div>
          </div>
        </el-popover>
        <el-button v-permission="'view'" type="success" :disabled="loading" @click="exportAllocationXls">
          <el-icon class="btn-icon"><Download /></el-icon>
          导出信息
        </el-button>
        <el-button v-permission="'view'" :disabled="loading" @click="onPrintAllocation">
          <el-icon class="btn-icon"><Printer /></el-icon>
          打印统计报表
        </el-button>
      </div>
      <div class="report-title-block">
        <h1 class="report-title">宿舍费用分摊情况报表</h1>
        <div class="report-meta-line">报表生成时间：{{ reportGeneratedAt || '—' }}</div>
        <div class="alloc-period-line">{{ monthTitleYm }} 宿舍电费明细</div>
      </div>
      <el-table
        v-loading="loading"
        :data="allocTableData"
        border
        stripe
        size="small"
        class="report-table"
        data-testid="electric-allocation-table"
        empty-text="暂无分摊数据（无在住人员的已抄表房间不在此表展示）"
      >
        <el-table-column
          v-for="column in visibleAllocationColumns"
          :key="column.key"
          :prop="column.prop"
          :label="column.label"
          :width="column.width"
          :min-width="column.minWidth"
          :align="column.align"
          show-overflow-tooltip
        >
          <template #default="{ row }">
            <el-tooltip
              v-if="column.key === 'share_money' && row.fee_share_applied === false"
              placement="top"
              content="该行未参与电费分摊池（档案未审、无匹配档案或住宿天数异常）；金额为 0，财务扣款前请人工确认。"
            >
              <span class="share-money-warn">{{ columnValue(row, column) }}</span>
            </el-tooltip>
            <template v-else>{{ columnValue(row, column) }}</template>
          </template>
        </el-table-column>
      </el-table>
      <div v-if="allocationAnomalyHint" class="allocation-anomaly-block" data-testid="electric-allocation-anomaly">
        <div class="allocation-anomaly-title">异常说明</div>
        <el-alert type="warning" :closable="false" show-icon>
          {{ allocationAnomalyHint }}
        </el-alert>
      </div>
    </div>
  </div>
</template>

<style scoped>
.erp-module-page {
  padding: 12px;
}
.toolbar-card {
  margin-bottom: 12px;
}
.hint-line {
  font-size: 13px;
  margin-bottom: 8px;
}
.toolbar-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}
.column-setting-panel {
  max-height: 360px;
  overflow-y: auto;
}
.column-setting-title {
  margin-bottom: 8px;
  color: #606266;
  font-size: 13px;
}
.column-setting-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.column-setting-actions {
  margin-top: 10px;
}
.toolbar-label {
  font-size: 14px;
  color: #606266;
}
.toolbar-gap {
  margin-right: 4px;
  color: #606266;
}
.btn-icon {
  margin-right: 4px;
}
.report-tabs {
  margin-bottom: 8px;
}
.tab-inner-toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 10px;
}
.report-sheet {
  background: #fff;
  border: 1px solid #dcdfe6;
  border-radius: 4px;
  padding: 16px 12px 20px;
}
.muted {
  color: #909399;
}
.report-title-block {
  text-align: center;
  margin-bottom: 12px;
}
.report-title {
  margin: 0 0 8px;
  font-size: 22px;
  font-weight: 600;
  letter-spacing: 1px;
  color: #303133;
}
.report-meta-line {
  text-align: center;
  font-size: 13px;
  color: #606266;
}
/* Tab2：统计月份副标题（在大标题与生成时间之间） */
.alloc-period-line {
  text-align: center;
  font-size: 16px;
  font-weight: 600;
  color: #303133;
  margin: 10px 0 12px;
}
.report-summary {
  text-align: left;
  font-size: 14px;
  margin-top: 8px;
  padding: 8px 0;
  border-top: 2px solid #67c23a;
  border-bottom: 2px solid #67c23a;
}
.report-table {
  width: 100%;
}
.allocation-anomaly-block {
  margin-top: 14px;
}
.allocation-anomaly-title {
  font-size: 14px;
  font-weight: 600;
  color: #e6a23c;
  margin-bottom: 8px;
}
.share-money-warn {
  color: #e6a23c;
  font-weight: 600;
  border-bottom: 1px dashed #e6a23c;
  cursor: help;
}

@media print {
  .no-print {
    display: none !important;
  }
  .erp-module-page {
    padding: 0;
  }
  .report-sheet {
    border: none;
  }
}
</style>

<style>
/* 打印时按当前选择的 Tab 隐藏另一块（与脚本里 html class 配合） */
@media print {
  html.print-electric-summary .allocation-only {
    display: none !important;
  }
  html.print-electric-allocation .summary-only {
    display: none !important;
  }
}
</style>
