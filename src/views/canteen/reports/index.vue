<template>
  <div class="erp-module-page dining-reports-page">
    <div class="module-tabs">
      <el-button
        v-for="item in tabs"
        :key="item.key"
        :type="activeTab === item.key ? 'primary' : 'default'"
        @click="activeTab = item.key"
      >
        {{ item.label }}
      </el-button>
    </div>

    <template v-if="activeTab === 'daily-orders'">
      <section v-loading="loading" class="report-shell">
        <h2 class="report-title">每天订餐情况表</h2>

        <div class="report-filter-bar no-print">
          <el-date-picker
            v-model="queryDate"
            type="date"
            value-format="YYYY-MM-DD"
            format="YYYY-MM-DD"
            :clearable="false"
            class="date-picker"
            style="width: 140px !important; flex: 0 0 140px"
          />
          <el-button type="primary" :loading="loading" @click="loadDailyOrders">确定统计</el-button>
          <el-button v-if="hasExportPermission" :loading="exporting" :disabled="loading" @click="exportReportXlsx">
            导出信息
          </el-button>
        </div>

        <div class="report-stats">
          <div class="summary-row">
            <div class="summary-item"><span>当天总订餐人数</span><strong>{{ summary.totalPeople }}</strong><em>人</em></div>
            <div class="summary-item"><span>午餐订餐人数</span><strong>{{ summary.lunchPeople }}</strong><em>人</em></div>
            <div class="summary-item"><span>晚餐订餐人数</span><strong>{{ summary.dinnerPeople }}</strong><em>人</em></div>
          </div>

          <el-table
            v-if="pairedRows.length"
            v-erp-list-h-scroll
            :data="pairedRows"
            border
            class="daily-order-table erp-list-table"
          >
            <el-table-column label="序号" width="64" align="center"><template #default="{ row }">{{ row.left.sequence }}</template></el-table-column>
            <el-table-column label="员工编码" min-width="130" align="center"><template #default="{ row }">{{ row.left.employeeCode }}</template></el-table-column>
            <el-table-column label="部门" min-width="150" align="center"><template #default="{ row }">{{ row.left.department }}</template></el-table-column>
            <el-table-column label="员工名称" min-width="110" align="center"><template #default="{ row }">{{ row.left.employeeName }}</template></el-table-column>
            <el-table-column label="午餐" width="60" align="center"><template #default="{ row }"><span v-if="row.left.hasLunch" class="meal-check">√</span></template></el-table-column>
            <el-table-column label="晚餐" width="60" align="center"><template #default="{ row }"><span v-if="row.left.hasDinner" class="meal-check">√</span></template></el-table-column>

            <el-table-column label="序号" width="64" align="center"><template #default="{ row }">{{ row.right?.sequence || '' }}</template></el-table-column>
            <el-table-column label="员工编码" min-width="130" align="center"><template #default="{ row }">{{ row.right?.employeeCode || '' }}</template></el-table-column>
            <el-table-column label="部门" min-width="150" align="center"><template #default="{ row }">{{ row.right?.department || '' }}</template></el-table-column>
            <el-table-column label="员工名称" min-width="110" align="center"><template #default="{ row }">{{ row.right?.employeeName || '' }}</template></el-table-column>
            <el-table-column label="午餐" width="60" align="center"><template #default="{ row }"><span v-if="row.right?.hasLunch" class="meal-check">√</span></template></el-table-column>
            <el-table-column label="晚餐" width="60" align="center"><template #default="{ row }"><span v-if="row.right?.hasDinner" class="meal-check">√</span></template></el-table-column>
          </el-table>
          <el-empty v-else-if="!loading" description="所选日期暂无报餐人员" />
        </div>
      </section>
    </template>

    <template v-else-if="activeTab === 'missed-swipes'">
      <section v-loading="missedLoading" class="report-shell">
        <h2 class="report-title">订餐未刷卡明细</h2>

        <div class="report-filter-bar no-print">
          <span class="range-label">时间范围：</span>
          <el-date-picker
            v-model="missedQuery.startDate"
            type="date"
            value-format="YYYY-MM-DD"
            format="YYYY-MM-DD"
            :clearable="false"
            class="range-date-picker"
            style="width: 140px !important; flex: 0 0 140px"
          />
          <span class="range-separator">至</span>
          <el-date-picker
            v-model="missedQuery.endDate"
            type="date"
            value-format="YYYY-MM-DD"
            format="YYYY-MM-DD"
            :clearable="false"
            class="range-date-picker"
            style="width: 140px !important; flex: 0 0 140px"
          />
          <el-date-picker
            v-model="missedQuery.month"
            type="month"
            value-format="YYYY-MM"
            format="YYYY年MM月"
            placeholder="选择月份"
            clearable
            class="month-picker"
            style="width: 140px !important; flex: 0 0 140px"
            @change="applyMissedSwipeMonth"
          />
          <el-select v-model="missedQuery.department" clearable filterable placeholder="全部部门" class="department-select">
            <el-option v-for="item in missedDepartments" :key="item" :label="item" :value="item" />
          </el-select>
          <el-button type="primary" :loading="missedLoading" @click="loadMissedSwipes">确定统计</el-button>
          <el-button
            v-if="hasExportPermission"
            :loading="missedExporting"
            :disabled="missedLoading"
            @click="exportMissedSwipesXlsx"
          >
            导出信息
          </el-button>
        </div>

        <div class="report-stats">
          <el-table v-if="missedRows.length" v-erp-list-h-scroll :data="missedRows" border class="missed-swipe-table erp-list-table">
            <el-table-column prop="sequence" label="序号" width="64" align="center" />
            <el-table-column prop="department" label="部门" min-width="130" align="center" />
            <el-table-column prop="employeeCode" label="员工编码" min-width="130" align="center" />
            <el-table-column prop="employeeName" label="员工名称" min-width="110" align="center" />
            <el-table-column prop="cardNumber" label="卡号" min-width="130" align="center" />
            <el-table-column prop="position" label="岗位" min-width="120" align="center" />
            <el-table-column prop="mealType" label="餐别" width="90" align="center" />
            <el-table-column label="订餐日期" min-width="150" align="center"><template #default="{ row }">{{ formatMealDateWithWeek(row.mealDate) }}</template></el-table-column>
            <el-table-column label="刷卡情况" width="110" align="center"><template #default><span class="missed-status">未刷卡</span></template></el-table-column>
          </el-table>
          <el-empty v-else-if="missedQueried && !missedLoading" description="所选条件暂无订餐未刷卡人员" />
          <el-empty v-else-if="!missedLoading" description="请选择时间范围后点击确定统计" />
        </div>
      </section>
    </template>

    <template v-else-if="activeTab === 'monthly-orders'">
      <section v-loading="monthlyLoading" class="report-shell">
        <h2 class="report-title">月报餐统计表</h2>

        <div class="report-filter-bar no-print">
          <el-date-picker
            v-model="monthlyQueryMonth"
            type="month"
            value-format="YYYY-MM"
            format="YYYY年MM月"
            placeholder="选择统计月份"
            :clearable="false"
            class="monthly-date-picker"
            style="width: 140px !important; flex: 0 0 140px"
          />
          <el-button type="primary" :loading="monthlyLoading" @click="loadMonthlyOrders">确定统计</el-button>
          <el-button
            v-if="hasExportPermission"
            :loading="monthlyExporting"
            :disabled="monthlyLoading || !monthlyQueried"
            @click="exportMonthlyOrdersXlsx"
          >
            导出信息
          </el-button>
        </div>

        <div class="report-stats">
          <el-table v-if="monthlyQueried" v-erp-list-h-scroll :data="monthlyRows" border class="monthly-order-table erp-list-table">
            <el-table-column prop="date" label="日期" width="140" align="center" />
            <el-table-column label="午餐" align="center">
              <el-table-column prop="lunchTotal" label="总数" min-width="88" align="center" />
              <el-table-column prop="lunchEmployee" label="员工餐" min-width="96" align="center" />
              <el-table-column prop="lunchManagement" label="管理餐" min-width="96" align="center" />
            </el-table-column>
            <el-table-column label="" width="24" align="center" />
            <el-table-column label="晚餐" align="center">
              <el-table-column prop="dinnerTotal" label="总数" min-width="88" align="center" />
              <el-table-column prop="dinnerEmployee" label="员工餐" min-width="96" align="center" />
              <el-table-column prop="dinnerManagement" label="管理餐" min-width="96" align="center" />
            </el-table-column>
          </el-table>
          <el-empty v-else-if="!monthlyLoading" description="请选择统计月份后点击确定统计" />
        </div>
      </section>
    </template>

    <template v-else-if="activeTab === 'consumption-summary'">
      <section v-loading="consumptionLoading" class="report-shell">
        <h2 class="report-title">消费汇总</h2>

        <div class="report-filter-bar no-print">
          <span class="range-label">时间范围：</span>
          <el-date-picker
            v-model="consumptionQuery.startDate"
            type="date"
            value-format="YYYY-MM-DD"
            format="YYYY-MM-DD"
            :clearable="false"
            class="range-date-picker"
            style="width: 140px !important; flex: 0 0 140px"
          />
          <span class="range-separator">至</span>
          <el-date-picker
            v-model="consumptionQuery.endDate"
            type="date"
            value-format="YYYY-MM-DD"
            format="YYYY-MM-DD"
            :clearable="false"
            class="range-date-picker"
            style="width: 140px !important; flex: 0 0 140px"
          />
          <el-date-picker
            v-model="consumptionQuery.month"
            type="month"
            value-format="YYYY-MM"
            format="YYYY年MM月"
            placeholder="选择月份"
            clearable
            class="month-picker"
            style="width: 140px !important; flex: 0 0 140px"
            @change="applyConsumptionMonth"
          />
          <el-select v-model="consumptionQuery.department" clearable filterable placeholder="全部部门" class="department-select">
            <el-option v-for="item in missedDepartments" :key="item" :label="item" :value="item" />
          </el-select>
          <el-button type="primary" :loading="consumptionLoading" @click="loadConsumptionSummary">确定统计</el-button>
          <el-button
            v-if="hasExportPermission"
            :loading="consumptionExporting"
            :disabled="consumptionLoading || !consumptionQueried"
            @click="exportConsumptionSummaryXlsx"
          >
            导出信息
          </el-button>
        </div>

        <div class="report-stats">
          <el-table v-if="consumptionRows.length" v-erp-list-h-scroll :data="consumptionRows" border class="consumption-summary-table erp-list-table">
            <el-table-column prop="sequence" label="序号" width="64" align="center" />
            <el-table-column prop="employeeCode" label="员工编号" min-width="120" align="center" />
            <el-table-column prop="employeeName" label="员工名称" min-width="110" align="center" />
            <el-table-column prop="lunchOrders" label="报（午餐）" min-width="104" align="center" />
            <el-table-column prop="lunchSwipes" label="午餐" min-width="80" align="center" />
            <el-table-column prop="lunchSupplements" label="补餐（午）" min-width="104" align="center" />
            <el-table-column prop="lunchAmount" label="午餐金额" min-width="104" align="center" />
            <el-table-column prop="lunchMissedAmount" label="有报餐无消费金额（午）" min-width="176" align="center" />
            <el-table-column prop="dinnerOrders" label="报（晚餐）" min-width="104" align="center" />
            <el-table-column prop="dinnerSwipes" label="晚餐" min-width="80" align="center" />
            <el-table-column prop="dinnerSupplements" label="补餐（晚）" min-width="104" align="center" />
            <el-table-column prop="dinnerAmount" label="晚餐金额" min-width="104" align="center" />
            <el-table-column prop="dinnerMissedAmount" label="有报餐无消费金额（晚）" min-width="176" align="center" />
            <el-table-column prop="orderedMissed" label="有报餐未消费" min-width="128" align="center" />
            <el-table-column prop="orderedSwiped" label="有报餐有消费" min-width="128" align="center" />
            <el-table-column prop="supplementTotal" label="补餐总数" min-width="104" align="center" />
            <el-table-column prop="orderTotal" label="总计" min-width="80" align="center" />
            <el-table-column prop="subsidyAmount" label="可补贴金额" min-width="112" align="center" />
            <el-table-column prop="deductionAmount" label="代扣餐费" min-width="104" align="center" />
          </el-table>
          <el-empty v-else-if="consumptionQueried && !consumptionLoading" description="所选条件暂无消费汇总数据" />
          <el-empty v-else-if="!consumptionLoading" description="请选择时间范围后点击确定统计" />
        </div>
      </section>
    </template>

    <el-card v-else shadow="never">
      <el-empty :description="`${activeTabLabel}待开发`" />
    </el-card>
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue'
import { ElMessage } from 'element-plus'
import ExcelJS from 'exceljs'
import { getDiningConsumptionSummary, getDiningDailyOrders, getDiningMissedSwipeDepartments, getDiningMissedSwipes, getDiningMonthlyOrders } from '@/api/diningReportsApi'
import { pairDiningDailyOrderRows } from '@/utils/diningDailyOrderReport'
import { formatDiningMealDateWithWeek, getDiningMonthDateRange } from '@/utils/diningMissedSwipeReport'
import { getPermissionModelFromStorage, hasPageAction } from '@/utils/menuPermission'

defineOptions({ name: 'CanteenReports' })

const MENU_PATH = 'canteen/reports'
const REPORT_TITLE = '每天订餐情况表'
const MISSED_REPORT_TITLE = '订餐未刷卡明细'
const MONTHLY_REPORT_TITLE = '月报餐统计表'
const CONSUMPTION_REPORT_TITLE = '消费汇总'
const EXPORT_THIN_BORDER = {
  top: { style: 'thin', color: { argb: 'FF333333' } },
  left: { style: 'thin', color: { argb: 'FF333333' } },
  bottom: { style: 'thin', color: { argb: 'FF333333' } },
  right: { style: 'thin', color: { argb: 'FF333333' } },
}
const EXPORT_HEADER_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF0F0F0' } }
const EXPORT_COLUMNS = [
  { key: 'sequence', label: '序号', width: 8 },
  { key: 'employeeCode', label: '员工编码', width: 16 },
  { key: 'department', label: '部门', width: 18 },
  { key: 'employeeName', label: '员工名称', width: 14 },
  { key: 'lunch', label: '午餐', width: 8 },
  { key: 'dinner', label: '晚餐', width: 8 },
]
const MISSED_EXPORT_COLUMNS = [
  { key: 'sequence', label: '序号', width: 8 },
  { key: 'department', label: '部门', width: 18 },
  { key: 'employeeCode', label: '员工编码', width: 16 },
  { key: 'employeeName', label: '员工名称', width: 14 },
  { key: 'cardNumber', label: '卡号', width: 16 },
  { key: 'position', label: '岗位', width: 14 },
  { key: 'mealType', label: '餐别', width: 10 },
  { key: 'mealDate', label: '订餐日期', width: 18 },
  { key: 'swipeStatus', label: '刷卡情况', width: 12 },
]
const MONTHLY_EXPORT_COLUMNS = [
  { key: 'date', label: '日期', width: 14 },
  { key: 'lunchTotal', label: '午餐总数', width: 12 },
  { key: 'lunchEmployee', label: '午餐员工餐', width: 14 },
  { key: 'lunchManagement', label: '午餐管理餐', width: 14 },
  { key: 'dinnerTotal', label: '晚餐总数', width: 12 },
  { key: 'dinnerEmployee', label: '晚餐员工餐', width: 14 },
  { key: 'dinnerManagement', label: '晚餐管理餐', width: 14 },
]
const CONSUMPTION_EXPORT_COLUMNS = [
  { key: 'sequence', label: '序号', width: 8 },
  { key: 'employeeCode', label: '员工编号', width: 16 },
  { key: 'employeeName', label: '员工名称', width: 14 },
  { key: 'lunchOrders', label: '报（午餐）', width: 14 },
  { key: 'lunchSwipes', label: '午餐', width: 10 },
  { key: 'lunchSupplements', label: '补餐（午）', width: 14 },
  { key: 'lunchAmount', label: '午餐金额', width: 14 },
  { key: 'lunchMissedAmount', label: '有报餐无消费金额（午）', width: 24 },
  { key: 'dinnerOrders', label: '报（晚餐）', width: 14 },
  { key: 'dinnerSwipes', label: '晚餐', width: 10 },
  { key: 'dinnerSupplements', label: '补餐（晚）', width: 14 },
  { key: 'dinnerAmount', label: '晚餐金额', width: 14 },
  { key: 'dinnerMissedAmount', label: '有报餐无消费金额（晚）', width: 24 },
  { key: 'orderedMissed', label: '有报餐未消费', width: 18 },
  { key: 'orderedSwiped', label: '有报餐有消费', width: 18 },
  { key: 'supplementTotal', label: '补餐总数', width: 14 },
  { key: 'orderTotal', label: '总计', width: 10 },
  { key: 'subsidyAmount', label: '可补贴金额', width: 16 },
  { key: 'deductionAmount', label: '代扣餐费', width: 14 },
]

const tabs = [
  { key: 'daily-orders', label: '每天订餐情况表' },
  { key: 'missed-swipes', label: '订餐未刷卡明细' },
  { key: 'monthly-orders', label: '月报餐统计表' },
  { key: 'consumption-summary', label: '消费汇总' },
]

function todayText() {
  const now = new Date()
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

const permissionModel = computed(() => getPermissionModelFromStorage())
const hasExportPermission = computed(() => hasPageAction(permissionModel.value, MENU_PATH, 'export'))

const activeTab = ref('daily-orders')
const queryDate = ref(todayText())
const loadedDate = ref('')
const loading = ref(false)
const exporting = ref(false)
const rows = ref([])
const summary = ref({ totalPeople: 0, lunchPeople: 0, dinnerPeople: 0 })
const missedLoading = ref(false)
const missedExporting = ref(false)
const missedQueried = ref(false)
const missedRows = ref([])
const missedDepartments = ref([])
const missedQuery = ref({ startDate: '', endDate: '', month: '', department: '' })
/** 最近一次成功统计的起止日期与部门，供导出文件名/元信息使用 */
const missedLoadedMeta = ref({ startDate: '', endDate: '', department: '' })
const monthlyQueryMonth = ref('')
const monthlyLoading = ref(false)
const monthlyExporting = ref(false)
const monthlyQueried = ref(false)
const monthlyRows = ref([])
const consumptionLoading = ref(false)
const consumptionExporting = ref(false)
const consumptionQueried = ref(false)
const consumptionRows = ref([])
const consumptionQuery = ref({ startDate: '', endDate: '', month: '', department: '' })
const consumptionLoadedMeta = ref({ startDate: '', endDate: '', department: '' })

const pairedRows = computed(() => pairDiningDailyOrderRows(rows.value))
const activeTabLabel = computed(() => tabs.find((item) => item.key === activeTab.value)?.label || '')

async function loadDailyOrders() {
  if (!queryDate.value) {
    ElMessage.warning('请选择统计日期')
    return
  }
  loading.value = true
  try {
    const response = await getDiningDailyOrders(queryDate.value)
    const data = response.data?.data || {}
    rows.value = Array.isArray(data.rows) ? data.rows : []
    summary.value = {
      totalPeople: Number(data.summary?.totalPeople || 0),
      lunchPeople: Number(data.summary?.lunchPeople || 0),
      dinnerPeople: Number(data.summary?.dinnerPeople || 0),
    }
    loadedDate.value = String(data.date || queryDate.value)
  } catch (error) {
    rows.value = []
    summary.value = { totalPeople: 0, lunchPeople: 0, dinnerPeople: 0 }
    loadedDate.value = ''
    ElMessage.error(String(error?.response?.data?.msg || error?.message || '读取每天订餐情况表失败'))
  } finally {
    loading.value = false
  }
}

function formatMealDateWithWeek(value) {
  return formatDiningMealDateWithWeek(value)
}

function applyMissedSwipeMonth(value) {
  if (!value) return
  const range = getDiningMonthDateRange(value)
  if (!range) return
  missedQuery.value.startDate = range.startDate
  missedQuery.value.endDate = range.endDate
}

function applyConsumptionMonth(value) {
  if (!value) return
  const range = getDiningMonthDateRange(value)
  if (!range) return
  consumptionQuery.value.startDate = range.startDate
  consumptionQuery.value.endDate = range.endDate
}

async function loadMissedSwipeDepartments() {
  try {
    const response = await getDiningMissedSwipeDepartments()
    missedDepartments.value = Array.isArray(response.data?.data?.list) ? response.data.data.list : []
  } catch (error) {
    missedDepartments.value = []
    ElMessage.error(String(error?.response?.data?.msg || error?.message || '读取部门失败'))
  }
}

async function loadMissedSwipes() {
  const { startDate, endDate, department } = missedQuery.value
  if (!startDate || !endDate) {
    ElMessage.warning('请选择完整的时间范围')
    return
  }
  missedLoading.value = true
  try {
    const response = await getDiningMissedSwipes({ startDate, endDate, department })
    const data = response.data?.data || {}
    missedRows.value = Array.isArray(data.rows) ? data.rows : []
    missedQueried.value = true
    missedLoadedMeta.value = {
      startDate: String(data.startDate || startDate),
      endDate: String(data.endDate || endDate),
      department: String(department || '').trim(),
    }
  } catch (error) {
    missedRows.value = []
    missedQueried.value = false
    missedLoadedMeta.value = { startDate: '', endDate: '', department: '' }
    ElMessage.error(String(error?.response?.data?.msg || error?.message || '读取订餐未刷卡明细失败'))
  } finally {
    missedLoading.value = false
  }
}

async function loadConsumptionSummary() {
  const { startDate, endDate, department } = consumptionQuery.value
  if (!startDate || !endDate) {
    ElMessage.warning('请选择完整的时间范围')
    return
  }
  consumptionLoading.value = true
  try {
    const response = await getDiningConsumptionSummary({ startDate, endDate, department })
    const data = response.data?.data || {}
    consumptionRows.value = Array.isArray(data.rows) ? data.rows : []
    consumptionQueried.value = true
    consumptionLoadedMeta.value = {
      startDate: String(data.startDate || startDate),
      endDate: String(data.endDate || endDate),
      department: String(data.department || department || '').trim(),
    }
  } catch (error) {
    consumptionRows.value = []
    consumptionQueried.value = false
    consumptionLoadedMeta.value = { startDate: '', endDate: '', department: '' }
    ElMessage.error(String(error?.response?.data?.msg || error?.message || '读取消费汇总失败'))
  } finally {
    consumptionLoading.value = false
  }
}

async function loadMonthlyOrders() {
  if (!monthlyQueryMonth.value) {
    ElMessage.warning('请选择统计月份')
    return
  }
  monthlyLoading.value = true
  try {
    const response = await getDiningMonthlyOrders(monthlyQueryMonth.value)
    const data = response.data?.data || {}
    monthlyRows.value = Array.isArray(data.rows) ? data.rows : []
    monthlyQueried.value = true
  } catch (error) {
    monthlyRows.value = []
    monthlyQueried.value = false
    ElMessage.error(String(error?.response?.data?.msg || error?.message || '读取月报餐统计表失败'))
  } finally {
    monthlyLoading.value = false
  }
}

function styleExportRow(row, opts = {}) {
  row.eachCell((cell) => {
    cell.border = EXPORT_THIN_BORDER
    cell.alignment = { horizontal: opts.horizontal || 'center', vertical: 'middle', wrapText: true }
    if (opts.bold) cell.font = { ...(cell.font || {}), bold: true }
    if (opts.fill) cell.fill = opts.fill
  })
}

function addExportFullRow(ws, text, colCount) {
  const row = ws.addRow([text])
  ws.mergeCells(row.number, 1, row.number, colCount)
  ws.getCell(row.number, 1).alignment = { horizontal: 'left', vertical: 'middle' }
  return row
}

function exportFileName() {
  const datePart = loadedDate.value || queryDate.value || '未统计'
  const safe = `${REPORT_TITLE}-${datePart}`.replace(/[\\/:*?"<>|]/g, '_').slice(0, 160)
  return `${safe || REPORT_TITLE}.xlsx`
}

function missedExportFileName() {
  const start = missedLoadedMeta.value.startDate || missedQuery.value.startDate || '未统计'
  const end = missedLoadedMeta.value.endDate || missedQuery.value.endDate || '未统计'
  const safe = `${MISSED_REPORT_TITLE}-${start}_${end}`.replace(/[\\/:*?"<>|]/g, '_').slice(0, 160)
  return `${safe || MISSED_REPORT_TITLE}.xlsx`
}

function monthlyExportFileName() {
  const month = monthlyQueryMonth.value || '未统计'
  const safe = `${MONTHLY_REPORT_TITLE}-${month}`.replace(/[\\/:*?"<>|]/g, '_').slice(0, 160)
  return `${safe || MONTHLY_REPORT_TITLE}.xlsx`
}

function consumptionExportFileName() {
  const start = consumptionLoadedMeta.value.startDate || consumptionQuery.value.startDate || '未统计'
  const end = consumptionLoadedMeta.value.endDate || consumptionQuery.value.endDate || '未统计'
  const safe = `${CONSUMPTION_REPORT_TITLE}-${start}_${end}`.replace(/[\\/:*?"<>|]/g, '_').slice(0, 160)
  return `${safe || CONSUMPTION_REPORT_TITLE}.xlsx`
}

function mealMark(flag) {
  return flag ? '√' : ''
}

async function downloadWorkbookBuffer(buf, fileName) {
  const blob = new Blob([buf], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  a.click()
  URL.revokeObjectURL(url)
}

async function exportReportXlsx() {
  if (!hasExportPermission.value) {
    ElMessage.warning('没有导出权限')
    return
  }
  if (!rows.value.length) {
    ElMessage.warning('暂无数据可导出')
    return
  }

  exporting.value = true
  try {
    const colCount = EXPORT_COLUMNS.length
    const wb = new ExcelJS.Workbook()
    const ws = wb.addWorksheet(REPORT_TITLE, {
      views: [{ state: 'frozen', ySplit: 5 }],
      pageSetup: { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
    })

    const titleRow = ws.addRow([REPORT_TITLE])
    ws.mergeCells(titleRow.number, 1, titleRow.number, colCount)
    titleRow.font = { bold: true, size: 14 }
    ws.getCell(titleRow.number, 1).alignment = { horizontal: 'center', vertical: 'middle' }

    addExportFullRow(ws, `统计日期：${loadedDate.value || queryDate.value || ''}`, colCount)
    addExportFullRow(
      ws,
      `当天总订餐人数：${summary.value.totalPeople}　午餐订餐人数：${summary.value.lunchPeople}　晚餐订餐人数：${summary.value.dinnerPeople}`,
      colCount,
    )
    addExportFullRow(ws, `统计完毕，一共：${rows.value.length} 条记录`, colCount)
    ws.addRow([])

    const headRow = ws.addRow(EXPORT_COLUMNS.map((col) => col.label))
    styleExportRow(headRow, { bold: true, fill: EXPORT_HEADER_FILL })

    for (const row of rows.value) {
      const added = ws.addRow([
        row.sequence ?? '',
        row.employeeCode || '',
        row.department || '',
        row.employeeName || '',
        mealMark(row.hasLunch),
        mealMark(row.hasDinner),
      ])
      styleExportRow(added)
    }

    ws.columns.forEach((col, index) => {
      col.width = EXPORT_COLUMNS[index]?.width || 12
    })

    const buf = await wb.xlsx.writeBuffer()
    await downloadWorkbookBuffer(buf, exportFileName())
    ElMessage.success('已导出 xlsx')
  } catch (error) {
    ElMessage.error(String(error?.message || '导出失败'))
  } finally {
    exporting.value = false
  }
}

async function exportMissedSwipesXlsx() {
  if (!hasExportPermission.value) {
    ElMessage.warning('没有导出权限')
    return
  }
  if (!missedRows.value.length) {
    ElMessage.warning('暂无数据可导出')
    return
  }

  missedExporting.value = true
  try {
    const colCount = MISSED_EXPORT_COLUMNS.length
    const startDate = missedLoadedMeta.value.startDate || missedQuery.value.startDate || ''
    const endDate = missedLoadedMeta.value.endDate || missedQuery.value.endDate || ''
    const department = missedLoadedMeta.value.department || String(missedQuery.value.department || '').trim()

    const wb = new ExcelJS.Workbook()
    const ws = wb.addWorksheet(MISSED_REPORT_TITLE, {
      views: [{ state: 'frozen', ySplit: 5 }],
      pageSetup: { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
    })

    const titleRow = ws.addRow([MISSED_REPORT_TITLE])
    ws.mergeCells(titleRow.number, 1, titleRow.number, colCount)
    titleRow.font = { bold: true, size: 14 }
    ws.getCell(titleRow.number, 1).alignment = { horizontal: 'center', vertical: 'middle' }

    addExportFullRow(ws, `时间范围：${startDate} 至 ${endDate}`, colCount)
    addExportFullRow(ws, `部门：${department || '全部部门'}`, colCount)
    addExportFullRow(ws, `统计完毕，一共：${missedRows.value.length} 条记录`, colCount)
    ws.addRow([])

    const headRow = ws.addRow(MISSED_EXPORT_COLUMNS.map((col) => col.label))
    styleExportRow(headRow, { bold: true, fill: EXPORT_HEADER_FILL })

    for (const row of missedRows.value) {
      const added = ws.addRow([
        row.sequence ?? '',
        row.department || '',
        row.employeeCode || '',
        row.employeeName || '',
        row.cardNumber || '',
        row.position || '',
        row.mealType || '',
        formatMealDateWithWeek(row.mealDate),
        '未刷卡',
      ])
      styleExportRow(added)
    }

    ws.columns.forEach((col, index) => {
      col.width = MISSED_EXPORT_COLUMNS[index]?.width || 12
    })

    const buf = await wb.xlsx.writeBuffer()
    await downloadWorkbookBuffer(buf, missedExportFileName())
    ElMessage.success('已导出 xlsx')
  } catch (error) {
    ElMessage.error(String(error?.message || '导出失败'))
  } finally {
    missedExporting.value = false
  }
}

async function exportMonthlyOrdersXlsx() {
  if (!hasExportPermission.value) {
    ElMessage.warning('没有导出权限')
    return
  }
  if (!monthlyQueried.value) {
    ElMessage.warning('请先完成统计')
    return
  }

  monthlyExporting.value = true
  try {
    const colCount = MONTHLY_EXPORT_COLUMNS.length
    const wb = new ExcelJS.Workbook()
    const ws = wb.addWorksheet(MONTHLY_REPORT_TITLE, {
      views: [{ state: 'frozen', ySplit: 4 }],
      pageSetup: { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
    })

    const titleRow = ws.addRow([MONTHLY_REPORT_TITLE])
    ws.mergeCells(titleRow.number, 1, titleRow.number, colCount)
    titleRow.font = { bold: true, size: 14 }
    ws.getCell(titleRow.number, 1).alignment = { horizontal: 'center', vertical: 'middle' }
    addExportFullRow(ws, `统计月份：${monthlyQueryMonth.value || ''}`, colCount)
    addExportFullRow(ws, `统计完毕，一共：${monthlyRows.value.length} 天`, colCount)
    ws.addRow([])

    const headRow = ws.addRow(MONTHLY_EXPORT_COLUMNS.map((col) => col.label))
    styleExportRow(headRow, { bold: true, fill: EXPORT_HEADER_FILL })
    for (const row of monthlyRows.value) {
      const added = ws.addRow(MONTHLY_EXPORT_COLUMNS.map((col) => row[col.key] ?? 0))
      styleExportRow(added)
    }
    ws.columns.forEach((col, index) => {
      col.width = MONTHLY_EXPORT_COLUMNS[index]?.width || 12
    })

    const buf = await wb.xlsx.writeBuffer()
    await downloadWorkbookBuffer(buf, monthlyExportFileName())
    ElMessage.success('已导出 xlsx')
  } catch (error) {
    ElMessage.error(String(error?.message || '导出失败'))
  } finally {
    monthlyExporting.value = false
  }
}

async function exportConsumptionSummaryXlsx() {
  if (!hasExportPermission.value) {
    ElMessage.warning('没有导出权限')
    return
  }
  if (!consumptionQueried.value) {
    ElMessage.warning('请先完成统计')
    return
  }

  consumptionExporting.value = true
  try {
    const colCount = CONSUMPTION_EXPORT_COLUMNS.length
    const startDate = consumptionLoadedMeta.value.startDate || consumptionQuery.value.startDate || ''
    const endDate = consumptionLoadedMeta.value.endDate || consumptionQuery.value.endDate || ''
    const department = consumptionLoadedMeta.value.department || String(consumptionQuery.value.department || '').trim()
    const wb = new ExcelJS.Workbook()
    const ws = wb.addWorksheet(CONSUMPTION_REPORT_TITLE, {
      views: [{ state: 'frozen', ySplit: 5 }],
      pageSetup: { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
    })
    const titleRow = ws.addRow([CONSUMPTION_REPORT_TITLE])
    ws.mergeCells(titleRow.number, 1, titleRow.number, colCount)
    titleRow.font = { bold: true, size: 14 }
    ws.getCell(titleRow.number, 1).alignment = { horizontal: 'center', vertical: 'middle' }
    addExportFullRow(ws, `时间范围：${startDate} 至 ${endDate}`, colCount)
    addExportFullRow(ws, `部门：${department || '全部部门'}`, colCount)
    addExportFullRow(ws, `统计完毕，一共：${consumptionRows.value.length} 条员工汇总`, colCount)
    ws.addRow([])
    const headRow = ws.addRow(CONSUMPTION_EXPORT_COLUMNS.map((col) => col.label))
    styleExportRow(headRow, { bold: true, fill: EXPORT_HEADER_FILL })
    for (const row of consumptionRows.value) {
      const added = ws.addRow(CONSUMPTION_EXPORT_COLUMNS.map((col) => row[col.key] ?? 0))
      styleExportRow(added)
    }
    ws.columns.forEach((col, index) => {
      col.width = CONSUMPTION_EXPORT_COLUMNS[index]?.width || 12
    })
    const buf = await wb.xlsx.writeBuffer()
    await downloadWorkbookBuffer(buf, consumptionExportFileName())
    ElMessage.success('已导出 xlsx')
  } catch (error) {
    ElMessage.error(String(error?.message || '导出失败'))
  } finally {
    consumptionExporting.value = false
  }
}

onMounted(() => {
  loadDailyOrders()
  loadMissedSwipeDepartments()
})
</script>

<style scoped>
.dining-reports-page {
  min-width: 0;
  min-height: calc(100vh - 118px);
  padding: 8px;
  background: #f5f7fb;
}

.module-tabs {
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

.report-title {
  margin: 4px 0 12px;
  text-align: center;
  font-size: 20px;
  font-weight: 700;
}

/* 查询条：与下方统计区用浅灰底+底边线隔开 */
.report-filter-bar {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-start;
  align-items: center;
  gap: 10px;
  margin: 0 -12px 20px;
  padding: 12px 14px;
  background: #f5f7fb;
  border-bottom: 1px solid #e5e7eb;
  border-radius: 4px 4px 0 0;
}

.report-stats {
  min-width: 0;
}

.date-picker {
  width: 110px !important;
  min-width: 0;
  height: 32px;
  --el-date-editor-width: 110px;
}

.range-label,
.range-separator {
  color: #303133;
  white-space: nowrap;
}

.range-date-picker,
.month-picker {
  width: 140px !important;
  flex: 0 0 140px;
  --el-date-editor-width: 140px;
}

.monthly-date-picker {
  width: 140px !important;
  min-width: 140px !important;
  max-width: 140px !important;
  flex: 0 0 140px;
  --el-date-editor-width: 140px;
}

.department-select {
  width: 180px;
}

:deep(.date-picker .el-input__wrapper) {
  min-height: 32px;
}

.summary-row {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 12px;
  margin-bottom: 14px;
}

.summary-item {
  display: flex;
  align-items: baseline;
  min-width: 200px;
  padding: 12px 16px;
  border: 1px solid #e5e7eb;
  border-radius: 4px;
  background: #fafafa;
}

.summary-item span {
  color: #606266;
}

.summary-item strong {
  margin-left: auto;
  color: #0f5ba7;
  font-size: 24px;
}

.summary-item em {
  margin-left: 4px;
  color: #909399;
  font-style: normal;
}

.daily-order-table {
  width: 100%;
}

.missed-swipe-table {
  width: 100%;
}

.monthly-order-table {
  width: 100%;
}

.consumption-summary-table {
  width: 100%;
}

.missed-status {
  color: #f56c6c;
  font-weight: 600;
}

.meal-check {
  color: #1677ff;
  font-size: 20px;
  font-weight: 700;
  line-height: 1;
}

:deep(.daily-order-table .el-table__cell) {
  padding: 5px 0;
}

:deep(.missed-swipe-table .el-table__cell) {
  padding: 5px 0;
}

:deep(.monthly-order-table .el-table__cell) {
  padding: 4px 0;
}

:deep(.consumption-summary-table .el-table__cell) {
  padding: 5px 0;
}

@media (max-width: 720px) {
  .report-shell {
    padding: 14px;
  }

  .report-filter-bar {
    margin-left: 0;
    margin-right: 0;
  }

  .summary-item {
    min-width: calc(50% - 6px);
    flex: 1 1 200px;
  }
}
</style>
