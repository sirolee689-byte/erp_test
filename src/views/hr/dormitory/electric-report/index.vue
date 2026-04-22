<script setup>
/**
 * v1.1.6 宿舍电费报表（Tabs）
 * - Tab1：宿舍维度 GET /api/dorm/electric-report-data
 * - Tab2：人员分摊 GET /api/dorm/electric-allocation-report（算法与 ElectricManage.vue / v1.1.9 一致）
 */
import { computed, onMounted, ref } from 'vue'
import axios from 'axios'
import ExcelJS from 'exceljs'
import { Refresh, Download, Printer, Document } from '@element-plus/icons-vue'
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
  const ws = wb.addWorksheet('宿舍电费情况统计', { views: [{ state: 'frozen', ySplit: 1 }] })
  const headers = [
    '宿舍编码',
    '宿舍名称',
    '入住人数',
    '月份',
    '抄表日期',
    '抄表人',
    '上期抄表数',
    '本期抄表数',
    '换表旧表结束数',
    '新表开始数',
    '用电量',
    '优惠电量',
    '电费单价',
    '电费',
    '备注',
  ]
  ws.addRow(headers)
  ws.getRow(1).font = { bold: true }
  for (const row of tableData.value) {
    ws.addRow([
      cellText(row.room_code),
      cellText(row.room_name),
      row.occupant_count_month,
      monthLabel.value,
      cellText(row.meter_read_date),
      cellText(row.meter_reader),
      cellText(row.c_star),
      cellText(row.c_this),
      isChangeMeter(row) ? cellText(row.c_old_end) : '',
      isChangeMeter(row) ? cellText(row.c_new_star) : '',
      cellText(row.used_electric),
      fmtNum(row.discount_kwh_month),
      cellText(row.unit_price),
      fmtMoney(row.total_money),
      cellText(row.remark),
    ])
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
  a.download = `宿舍电费情况统计_${year.value}-${pad2(month.value)}.xlsx`
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
  const headers = [
    '月份',
    '房号',
    '员工档案号',
    '姓名',
    '部门',
    '职务',
    '上期抄表数',
    '本期抄表数',
    '宿舍用电量',
    '个人分摊电量',
    '个人优惠电量',
    '电费单价',
    '住宿天数',
    '分摊电费',
  ]
  ws.addRow(headers)
  ws.getRow(1).font = { bold: true }
  for (const row of allocTableData.value) {
    ws.addRow([
      monthTitleYm.value,
      cellText(row.room_code),
      cellText(row.staff_archive_code) || cellText(row.staff_code),
      cellText(row.staff_display_name) || cellText(row.staff_truename),
      cellText(row.dept_name),
      cellText(row.position_name),
      cellText(row.c_star),
      cellText(row.c_this),
      row.dorm_used_electric,
      fmtShareEle(row.share_electric),
      fmtNum(row.personal_discount_electric),
      cellText(row.unit_price),
      row.stay_days,
      fmtMoney(row.share_money),
    ])
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

/** 财务 PDF：走系统打印对话框，另存为 PDF */
function exportAllocationPdf() {
  if (!allocTableData.value.length) {
    ElMessage.warning('暂无分摊数据可导出')
    return
  }
  activeTab.value = 'allocation'
  document.documentElement.classList.add('print-electric-allocation')
  ElMessage.info('请在打印对话框中选择「另存为 PDF」')
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
      <el-tab-pane label="宿舍电费统计报表" name="summary" />
      <el-tab-pane label="宿舍费用分摊情况" name="allocation" />
    </el-tabs>

    <!-- Tab1 -->
    <div v-show="activeTab === 'summary'" class="report-sheet summary-only">
      <div class="tab-inner-toolbar no-print">
        <el-button v-permission="'view'" type="success" :disabled="loading" @click="exportSummaryXls">
          <el-icon class="btn-icon"><Download /></el-icon>
          导出为 XLS 信息
        </el-button>
        <el-button v-permission="'view'" @click="onPrintSummary">
          <el-icon class="btn-icon"><Printer /></el-icon>
          打印统计报表
        </el-button>
      </div>
      <div class="report-title-block">
        <h1 class="report-title">宿舍电费情况统计报表</h1>
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
        <el-table-column prop="room_code" label="宿舍编码" min-width="96" fixed />
        <el-table-column prop="room_name" label="宿舍名称" min-width="88" />
        <el-table-column prop="occupant_count_month" label="入住人数" width="88" align="center" />
        <el-table-column label="月份" width="100" align="center">
          <template #default>{{ monthLabel }}</template>
        </el-table-column>
        <el-table-column prop="meter_read_date" label="抄表日期" min-width="120" />
        <el-table-column prop="meter_reader" label="抄表人" width="100" />
        <el-table-column prop="c_star" label="上期抄表数" width="100" align="right" />
        <el-table-column prop="c_this" label="本期抄表数" width="100" align="right" />
        <el-table-column label="换表 旧表结束数" width="120" align="right">
          <template #default="{ row }">
            {{ isChangeMeter(row) ? cellText(row.c_old_end) : '—' }}
          </template>
        </el-table-column>
        <el-table-column label="新表开始数" width="100" align="right">
          <template #default="{ row }">
            {{ isChangeMeter(row) ? cellText(row.c_new_star) : '—' }}
          </template>
        </el-table-column>
        <el-table-column prop="used_electric" label="用电量" width="88" align="right" />
        <el-table-column label="优惠电量" width="88" align="right">
          <template #default="{ row }">
            {{ fmtNum(row.discount_kwh_month) }}
          </template>
        </el-table-column>
        <el-table-column prop="unit_price" label="电费单价" width="88" align="right" />
        <el-table-column label="电费" width="96" align="right">
          <template #default="{ row }">
            {{ fmtMoney(row.total_money) }}
          </template>
        </el-table-column>
        <el-table-column prop="remark" label="备注" min-width="100" show-overflow-tooltip />
      </el-table>
    </div>

    <!-- Tab2 -->
    <div v-show="activeTab === 'allocation'" class="report-sheet allocation-only">
      <div class="tab-inner-toolbar no-print">
        <el-button v-permission="'view'" type="success" :disabled="loading" @click="exportAllocationXls">
          <el-icon class="btn-icon"><Download /></el-icon>
          导出为 XLS 信息
        </el-button>
        <el-button v-permission="'view'" type="primary" :disabled="loading" @click="exportAllocationPdf">
          <el-icon class="btn-icon"><Document /></el-icon>
          导出为 PDF 信息
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
        <el-table-column label="月份" width="88" align="center">
          <template #default>{{ monthTitleYm }}</template>
        </el-table-column>
        <el-table-column prop="room_code" label="房号" width="96" />
        <el-table-column label="员工档案号" min-width="110">
          <template #default="{ row }">
            {{ cellText(row.staff_archive_code) || cellText(row.staff_code) }}
          </template>
        </el-table-column>
        <el-table-column label="姓名" min-width="120" show-overflow-tooltip>
          <template #default="{ row }">
            {{ cellText(row.staff_display_name) || cellText(row.staff_truename) }}
          </template>
        </el-table-column>
        <el-table-column prop="dept_name" label="部门" min-width="120" show-overflow-tooltip />
        <el-table-column prop="position_name" label="职务" width="100" show-overflow-tooltip />
        <el-table-column prop="c_star" label="上期抄表数" width="100" align="right" />
        <el-table-column prop="c_this" label="本期抄表数" width="100" align="right" />
        <el-table-column prop="dorm_used_electric" label="宿舍用电量" width="100" align="right" />
        <el-table-column label="个人分摊电量" width="110" align="right">
          <template #default="{ row }">
            {{ fmtShareEle(row.share_electric) }}
          </template>
        </el-table-column>
        <el-table-column label="个人优惠电量" width="110" align="right">
          <template #default="{ row }">
            {{ fmtNum(row.personal_discount_electric) }}
          </template>
        </el-table-column>
        <el-table-column prop="unit_price" label="电费单价" width="88" align="right" />
        <el-table-column prop="stay_days" label="住宿天数" width="88" align="center" />
        <el-table-column label="分摊电费" width="120" align="right">
          <template #default="{ row }">
            <el-tooltip
              v-if="row.fee_share_applied === false"
              placement="top"
              content="该行未参与电费分摊池（档案未审、无匹配档案或住宿天数异常）；金额为 0，财务扣款前请人工确认。"
            >
              <span class="share-money-warn">{{ fmtMoney(row.share_money) }}</span>
            </el-tooltip>
            <span v-else>{{ fmtMoney(row.share_money) }}</span>
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
