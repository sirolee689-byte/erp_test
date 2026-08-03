<template>
  <div class="erp-module-page dining-records-page">
    <div class="module-tabs">
      <el-button v-for="item in tabs" :key="item.key" :type="activeTab === item.key ? 'primary' : 'default'" @click="switchTab(item.key)">{{ item.label }}</el-button>
      <el-input v-if="activeTab === 'records'" v-model="keyword" class="date-search" clearable placeholder="搜索日期，如 2026-08 或 202608" />
    </div>

    <el-card v-if="activeTab === 'records'" v-loading="loading" shadow="never">
      <template #header><div class="card-header"><span>报餐管理</span><el-button text type="primary" @click="load">刷新</el-button></div></template>
      <div class="pagination-row pagination-row--top">
        <el-pagination v-model:current-page="page" v-model:page-size="pageSize" background layout="total, sizes, prev, pager, next, jumper" :total="filteredRows.length" :page-sizes="ERP_PAGE_SIZE_OPTIONS" />
      </div>
      <el-table :data="pagedRows" border stripe>
        <el-table-column label="日期" width="180"><template #default="{ row }">{{ row.date }}（周{{ row.weekday }}）</template></el-table-column>
        <el-table-column label="报餐数据" min-width="360">
          <template #default="{ row }">
            <div class="meal-summary">
              <div>一共报餐数：<b>{{ row.totalQuantity }}</b> 份量</div>
              <div>午餐数量：<b>{{ row.lunchQuantity }}</b> 份量　报餐人数：<b>{{ row.lunchPeople }}</b> 人</div>
              <div>晚餐数量：<b>{{ row.dinnerQuantity }}</b> 份量　报餐人数：<b>{{ row.dinnerPeople }}</b> 人</div>
            </div>
          </template>
        </el-table-column>
        <el-table-column prop="remark" label="备注" min-width="260" />
      </el-table>
      <el-empty v-if="!filteredRows.length" description="最近三个月暂无报餐数据" />
      <div v-if="filteredRows.length" class="pagination-row pagination-row--bottom">
        <el-pagination v-model:current-page="page" v-model:page-size="pageSize" background layout="total, sizes, prev, pager, next, jumper" :total="filteredRows.length" :page-sizes="ERP_PAGE_SIZE_OPTIONS" />
      </div>
    </el-card>

    <template v-else-if="activeTab === 'people'">
      <el-card class="people-search-card" shadow="never">
        <div class="people-search-row">
          <el-input
            v-model="peopleKeywordInput"
            class="people-search-input"
            clearable
            placeholder="日期 / 员工编码 / 报餐人 / 卡号"
            @keyup.enter="searchPeople"
          />
          <el-button type="primary" @click="searchPeople">查询</el-button>
          <el-button @click="resetPeople">重置</el-button>
        </div>
      </el-card>

      <el-card v-loading="peopleLoading" class="people-list-card" shadow="never">
        <template #header><div class="card-header"><span>报餐人记录搜索</span><el-button text type="primary" @click="loadPeople">刷新</el-button></div></template>
        <div class="pagination-row pagination-row--top">
          <el-pagination
            background
            layout="total, sizes, prev, pager, next, jumper"
            :total="peopleTotal"
            :current-page="peoplePage"
            :page-size="peoplePageSize"
            :page-sizes="ERP_PAGE_SIZE_OPTIONS"
            @size-change="changePeoplePageSize"
            @current-change="changePeoplePage"
          />
        </div>
        <el-table v-erp-list-h-scroll :data="peopleRows" row-key="rowKey" border stripe class="erp-list-table">
          <el-table-column label="操作" fixed="left" width="120">
            <template #default="{ row }">
              <el-tooltip :disabled="row.canCancel" :content="row.cancelReason" placement="top">
                <span>
                  <el-button
                    v-permission="'delete'"
                    type="danger"
                    plain
                    :disabled="!row.canCancel"
                    :loading="cancelingKey === row.rowKey"
                    @click="confirmCancel(row)"
                  >取消报餐</el-button>
                </span>
              </el-tooltip>
            </template>
          </el-table-column>
          <el-table-column prop="date" label="日期" width="130" />
          <el-table-column prop="reportTime" label="报餐时间" min-width="170" />
          <el-table-column prop="employeeCode" label="员工编码" min-width="130" />
          <el-table-column label="类型" width="90">
            <template #default="{ row }"><span :class="row.mealType === '2' ? 'meal-type--lunch' : 'meal-type--dinner'">{{ row.mealTypeName }}</span></template>
          </el-table-column>
          <el-table-column prop="employeeName" label="报餐人" min-width="120" />
          <el-table-column prop="cardNumber" label="卡号" min-width="150"><template #default="{ row }">{{ row.cardNumber || '—' }}</template></el-table-column>
        </el-table>
        <el-empty v-if="!peopleLoading && !peopleRows.length" description="最近三个月暂无符合条件的报餐记录" />
        <div v-if="peopleTotal" class="pagination-row pagination-row--bottom">
          <el-pagination
            background
            layout="total, sizes, prev, pager, next, jumper"
            :total="peopleTotal"
            :current-page="peoplePage"
            :page-size="peoplePageSize"
            :page-sizes="ERP_PAGE_SIZE_OPTIONS"
            @size-change="changePeoplePageSize"
            @current-change="changePeoplePage"
          />
        </div>
      </el-card>
    </template>

    <el-card v-else-if="activeTab === 'supplement'" v-loading="supplementLoading" shadow="never" class="supplement-card">
      <template #header>
        <div class="card-header">
          <span>打卡消费补录</span>
          <div class="supplement-head-actions">
            <el-button @click="resetSupplement">重置</el-button>
            <el-button v-permission="'add'" type="primary" :loading="supplementSaving" @click="saveSupplement">保存补录</el-button>
          </div>
        </div>
      </template>

      <el-tabs v-model="supplementSection" class="supplement-tabs">
        <el-tab-pane label="基础资料" name="base">
          <el-form label-width="100px" class="supplement-form">
            <div class="supplement-form-grid">
              <el-form-item label="添加时间" class="supplement-field"><el-input :model-value="supplementForm.openedAt" readonly /></el-form-item>
              <el-form-item label="经手人" class="supplement-field"><el-input :model-value="supplementForm.operatorName" readonly /></el-form-item>
              <el-form-item label="补录餐别" class="supplement-field">
                <el-select v-model="supplementForm.mealType" placeholder="请选择午餐或晚餐">
                  <el-option label="午餐" value="2" />
                  <el-option label="晚餐" value="3" />
                </el-select>
              </el-form-item>
              <el-form-item label="补录日期" class="supplement-field">
                <el-date-picker v-model="supplementForm.date" type="date" value-format="YYYY-MM-DD" :disabled-date="disableFutureSupplementDate" placeholder="请选择补录日期" />
              </el-form-item>
              <el-form-item label="备注" class="supplement-remark-item">
                <el-input v-model="supplementForm.remark" maxlength="500" show-word-limit placeholder="请输入补录备注" />
              </el-form-item>
            </div>
          </el-form>
        </el-tab-pane>

        <el-tab-pane :label="`人员添加（${supplementLines.length}）`" name="lines">
          <div v-permission="'add'" class="supplement-line-toolbar">
            <el-button type="danger" plain :disabled="!selectedSupplementIds.size" @click="removeSelectedSupplementLines">删除选定明细</el-button>
            <el-button type="danger" plain :disabled="!supplementLines.length" @click="removeAllSupplementLines">删除全部明细</el-button>
            <el-button type="primary" plain @click="openSupplementStaffWindow">批量添加</el-button>
          </div>
          <el-table v-erp-list-h-scroll :data="supplementLines" row-key="id" border stripe class="erp-list-table supplement-lines-table">
            <el-table-column label="选择" fixed="left" width="90" align="center">
              <template #default="{ row }">
                <el-button size="small" :class="{ 'supplement-line-mark--on': selectedSupplementIds.has(row.id) }" @click="toggleSupplementLine(row)">
                  {{ selectedSupplementIds.has(row.id) ? '已选择' : '选择' }}
                </el-button>
              </template>
            </el-table-column>
            <el-table-column label="序号" type="index" width="70" align="center" />
            <el-table-column prop="employeeCode" label="员工编码" min-width="140" />
            <el-table-column prop="employeeName" label="姓名" min-width="120" />
            <el-table-column prop="cardNumber" label="卡号" min-width="150" />
            <el-table-column prop="employeeMealType" label="员工餐类" min-width="110"><template #default="{ row }">{{ row.employeeMealType || '—' }}</template></el-table-column>
          </el-table>
          <el-empty v-if="!supplementLines.length" description="请点击“批量添加”选择补录人员" />
        </el-tab-pane>
      </el-tabs>
    </el-card>

    <el-card v-else-if="activeTab === 'one-click-supplement'" v-loading="oneClickLoading" shadow="never">
      <template #header><div class="card-header"><span>一键补录</span></div></template>
      <div class="erp-filter-bar">
        <div class="erp-filter-row">
          <el-input v-model="oneClickKeyword" clearable placeholder="输入员工姓名" class="one-click-name" @keyup.enter="searchOneClickStaff" />
          <el-button type="primary" @click="searchOneClickStaff">搜索员工</el-button>
          <el-date-picker v-model="oneClickMonth" type="month" value-format="YYYY-MM" format="YYYY年MM月" placeholder="选择月份" class="one-click-month" />
          <el-button type="primary" :disabled="!oneClickEmployee || !oneClickMonth" @click="loadOneClickPreview">查询漏卡</el-button>
        </div>
      </div>
      <el-table v-if="oneClickStaffRows.length" :data="oneClickStaffRows" border stripe class="erp-list-table one-click-staff-table">
        <el-table-column prop="employeeCode" label="员工编码" min-width="140" />
        <el-table-column prop="department" label="部门" min-width="140" />
        <el-table-column prop="employeeName" label="姓名" min-width="120" />
        <el-table-column prop="cardNumber" label="卡号" min-width="150" />
        <el-table-column label="操作" width="110"><template #default="{ row }"><el-button type="primary" plain size="small" @click="selectOneClickStaff(row)">选择</el-button></template></el-table-column>
      </el-table>
      <el-alert v-if="oneClickEmployee" :title="`已选择：${oneClickEmployee.employeeName}（${oneClickEmployee.employeeCode}）`" type="success" :closable="false" class="one-click-selected" />
      <el-table v-if="oneClickPreviewRows.length" :data="oneClickPreviewRows" border stripe class="erp-list-table">
        <el-table-column prop="sequence" label="序号" width="80" align="center" />
        <el-table-column label="日期" min-width="160"><template #default="{ row }">{{ row.date }}（周{{ row.weekday }}）</template></el-table-column>
        <el-table-column prop="mealTypeName" label="餐别" width="120" />
        <el-table-column prop="statusName" label="状态" width="120"><template #default><span class="review-status-error">漏卡</span></template></el-table-column>
      </el-table>
      <el-empty v-else-if="oneClickQueried && !oneClickLoading" description="该员工在所选月份没有可补录的漏卡记录" />
      <div v-if="oneClickPreviewRows.length" class="one-click-submit">
        <el-button v-permission="'add'" type="primary" :loading="oneClickSaving" @click="confirmOneClickSupplement">一键补录 {{ oneClickPreviewRows.length }} 条</el-button>
      </div>
    </el-card>

    <template v-else-if="activeTab === 'audit'">
      <el-card v-loading="reviewLoading" shadow="never" class="review-list-card">
        <template #header>
          <div class="card-header">
            <span>补录管理与审核</span>
            <el-button text type="primary" @click="loadSupplementReviews">刷新</el-button>
          </div>
        </template>
        <div class="erp-filter-bar">
          <div class="erp-filter-row review-filter-row">
            <el-input
              v-model="reviewKeywordInput"
              class="review-filter-keyword"
              clearable
              placeholder="日期 / 餐别 / 经手人 / 添加时间 / 批次号 / 员工姓名 / 卡号"
              @keyup.enter="searchSupplementReviews"
            />
            <el-button type="primary" size="small" @click="searchSupplementReviews">查询</el-button>
            <el-button size="small" @click="resetSupplementReviews">重置</el-button>
            <div class="erp-filter-divider" aria-hidden="true" />
            <el-button
              v-permission="'audit'"
              type="success"
              plain
              size="small"
              class="erp-filter-action-btn"
              :loading="reviewBatchAuditing"
              :disabled="reviewBatchAuditing || reviewLoading || reviewPendingCount === 0"
              @click="batchAuditSupplementReviewsCurrentPage"
            >批量审核（仅当前页）</el-button>
          </div>
        </div>
        <div class="pagination-row pagination-row--top">
          <el-pagination
            background
            layout="total, sizes, prev, pager, next, jumper"
            :total="reviewTotal"
            :current-page="reviewPage"
            :page-size="reviewPageSize"
            :page-sizes="ERP_PAGE_SIZE_OPTIONS"
            @size-change="changeReviewPageSize"
            @current-change="changeReviewPage"
          />
        </div>
        <el-table
          ref="reviewTable"
          v-erp-list-h-scroll
          :data="reviewRows"
          row-key="anchorId"
          border
          stripe
          class="erp-list-table review-table"
          @row-click="onReviewRowClick"
        >
          <el-table-column type="expand" width="1" class-name="review-expand-column">
            <template #default="{ row }">
              <div class="review-detail-wrap" v-loading="row.detailsLoading" @click.stop>
                <el-alert v-if="row.detailsError" :title="row.detailsError" type="error" :closable="false" show-icon />
                <el-table v-else :data="row.details || []" border stripe class="review-detail-table">
                  <el-table-column label="序号" type="index" width="80" align="center" />
                  <el-table-column prop="employeeName" label="员工名称" min-width="180" />
                  <el-table-column prop="cardNumber" label="卡号" min-width="180"><template #default="{ row: detail }">{{ detail.cardNumber || '—' }}</template></el-table-column>
                </el-table>
                <el-empty v-if="!row.detailsLoading && !row.detailsError && !row.details?.length" description="该批次暂无人员明细" />
              </div>
            </template>
          </el-table-column>
          <el-table-column label="序号" width="105" align="center">
            <template #default="{ row, $index }">
              <el-button text type="primary" class="review-expand-button" @click.stop="toggleReviewRow(row)">{{ expandedReviewIds.has(row.anchorId) ? '−' : '+' }}</el-button>
              <span>{{ reviewSequence($index) }}</span>
            </template>
          </el-table-column>
          <el-table-column label="操作" width="120" class-name="review-action-column">
            <template #default="{ row }">
              <span v-if="row.status === 'abnormal'" class="review-status-error">状态异常</span>
              <el-button
                v-else-if="row.status === 'pending'"
                v-permission="'audit'"
                type="success"
                plain
                :loading="reviewActionId === row.anchorId"
                @click.stop="confirmSupplementReview(row, 'audit')"
              >审核</el-button>
              <el-button
                v-else
                v-permission="'unaudit'"
                type="warning"
                plain
                :loading="reviewActionId === row.anchorId"
                @click.stop="confirmSupplementReview(row, 'unaudit')"
              >反审</el-button>
            </template>
          </el-table-column>
          <el-table-column prop="date" label="补录日期" width="140" />
          <el-table-column label="补录类型" width="110"><template #default="{ row }"><span :class="row.mealType === '2' ? 'meal-type--lunch' : 'meal-type--dinner'">{{ row.mealTypeName }}</span></template></el-table-column>
          <el-table-column prop="operatorName" label="经手人" min-width="150" />
          <el-table-column prop="addedAt" label="添加时间" min-width="190" />
          <el-table-column prop="peopleCount" label="补录总人数" width="130" align="center" />
        </el-table>
        <el-empty v-if="!reviewLoading && !reviewRows.length" description="暂无符合条件的补录批次" />
        <div v-if="reviewTotal" class="pagination-row pagination-row--bottom">
          <el-pagination
            background
            layout="total, sizes, prev, pager, next, jumper"
            :total="reviewTotal"
            :current-page="reviewPage"
            :page-size="reviewPageSize"
            :page-sizes="ERP_PAGE_SIZE_OPTIONS"
            @size-change="changeReviewPageSize"
            @current-change="changeReviewPage"
          />
        </div>
      </el-card>
    </template>

    <template v-else-if="activeTab === 'consumption'">
      <el-card v-loading="consumptionLoading" shadow="never" class="consumption-list-card">
        <template #header>
          <div class="card-header">
            <span>打卡消费记录搜索</span>
            <el-button text type="primary" @click="loadConsumptions">刷新</el-button>
          </div>
        </template>
        <div class="erp-filter-bar">
          <div class="erp-filter-row consumption-filter-row">
            <el-date-picker
              v-model="consumptionDateRange"
              type="daterange"
              value-format="YYYY-MM-DD"
              unlink-panels
              range-separator="至"
              start-placeholder="开始日期"
              end-placeholder="结束日期"
              class="consumption-filter-date"
            />
            <el-input
              v-model="consumptionFilters.employee"
              class="consumption-filter-employee"
              clearable
              placeholder="员工编号 / 姓名"
              @keyup.enter="searchConsumptions"
            />
            <el-select v-model="consumptionFilters.mealType" clearable placeholder="餐别" class="consumption-filter-meal">
              <el-option label="午餐" value="2" />
              <el-option label="晚餐" value="3" />
            </el-select>
            <el-input
              v-model="consumptionFilters.cardNumber"
              class="consumption-filter-card"
              clearable
              placeholder="卡号"
              @keyup.enter="searchConsumptions"
            />
            <el-button type="primary" size="small" @click="searchConsumptions">查询</el-button>
            <el-button size="small" @click="resetConsumptions">重置</el-button>
          </div>
        </div>
        <div class="pagination-row pagination-row--top">
          <el-pagination
            background
            layout="total, sizes, prev, pager, next, jumper"
            :total="consumptionTotal"
            :current-page="consumptionPage"
            :page-size="consumptionPageSize"
            :page-sizes="ERP_PAGE_SIZE_OPTIONS"
            @size-change="changeConsumptionPageSize"
            @current-change="changeConsumptionPage"
          />
        </div>
        <el-table
          v-erp-list-h-scroll
          :data="consumptionRows"
          row-key="id"
          border
          stripe
          class="erp-list-table"
        >
          <el-table-column prop="date" label="消费日期" width="130" />
          <el-table-column prop="edibleTime" label="消费时间" min-width="180" />
          <el-table-column prop="employeeCode" label="员工编号" min-width="130" />
          <el-table-column prop="employeeName" label="员工姓名" min-width="120" />
          <el-table-column label="卡号" min-width="150">
            <template #default="{ row }">{{ row.cardNumber || '—' }}</template>
          </el-table-column>
          <el-table-column label="餐别" width="90">
            <template #default="{ row }">
              <span :class="row.mealType === '2' ? 'meal-type--lunch' : 'meal-type--dinner'">{{ row.mealTypeName }}</span>
            </template>
          </el-table-column>
          <el-table-column prop="sourceLabel" label="消费来源" width="100" />
          <el-table-column prop="operatorName" label="操作人员" min-width="120" />
          <el-table-column prop="remark" label="备注" min-width="180">
            <template #default="{ row }">{{ row.remark || '—' }}</template>
          </el-table-column>
        </el-table>
        <el-empty v-if="!consumptionLoading && !consumptionRows.length" description="暂无符合条件的消费记录" />
        <div v-if="consumptionTotal" class="pagination-row pagination-row--bottom">
          <el-pagination
            background
            layout="total, sizes, prev, pager, next, jumper"
            :total="consumptionTotal"
            :current-page="consumptionPage"
            :page-size="consumptionPageSize"
            :page-sizes="ERP_PAGE_SIZE_OPTIONS"
            @size-change="changeConsumptionPageSize"
            @current-change="changeConsumptionPage"
          />
        </div>
      </el-card>
    </template>

    <el-card v-else shadow="never"><el-empty description="功能后续开放" /></el-card>
  </div>
</template>

<script setup>
import { computed, onMounted, onUnmounted, reactive, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  auditDiningSupplementReview,
  cancelDiningPeopleRecord,
  createDiningSupplement,
  createDiningOneClickSupplement,
  getDiningConsumptions,
  getDiningPeopleRecords,
  getDiningRecords,
  getDiningSupplementInit,
  getDiningSupplementStaff,
  getDiningOneClickSupplementPreview,
  getDiningSupplementReviewDetails,
  getDiningSupplementReviews,
  unauditDiningSupplementReview,
} from '@/api/diningRecordsApi'
import { ERP_PAGE_SIZE_OPTIONS } from '@/utils/erpPagination'
import {
  DINING_SUPPLEMENT_MSG_ACCEPTED,
  DINING_SUPPLEMENT_MSG_APPLY,
  DINING_SUPPLEMENT_MSG_REJECTED,
  buildDiningSupplementSessionId,
  parseDiningSupplementResultStorageEvent,
  readDiningSupplementResult,
  removeDiningSupplementContext,
  removeDiningSupplementResult,
  writeDiningSupplementContext,
} from '@/utils/diningSupplementBatch'

const tabs = [
  { key: 'records', label: '报餐管理' },
  { key: 'people', label: '报餐人记录搜索' },
  { key: 'supplement', label: '打卡消费补录' },
  { key: 'one-click-supplement', label: '一键补录' },
  { key: 'audit', label: '补录管理与审核' },
  { key: 'consumption', label: '打卡消费记录搜索' },
]
const activeTab = ref('records')
const loading = ref(false)
const rows = ref([])
const keyword = ref('')
const page = ref(1)
const pageSize = ref(10)
const peopleLoading = ref(false)
const peopleLoaded = ref(false)
const peopleRows = ref([])
const peopleKeywordInput = ref('')
const peopleKeyword = ref('')
const peoplePage = ref(1)
const peoplePageSize = ref(10)
const peopleTotal = ref(0)
const cancelingKey = ref('')
const supplementLoading = ref(false)
const supplementLoaded = ref(false)
const supplementSaving = ref(false)
const supplementSection = ref('base')
const supplementLines = ref([])
const selectedSupplementIds = ref(new Set())
const supplementMaxStaff = ref(500)
const supplementToday = ref('')
const supplementForm = reactive({ openedAt: '', operatorName: '', mealType: '', date: '', remark: '' })
const supplementStaffChildWindow = ref(null)
const activeSupplementSessionId = ref('')
const oneClickLoading = ref(false)
const oneClickSaving = ref(false)
const oneClickKeyword = ref('')
const oneClickMonth = ref('')
const oneClickStaffRows = ref([])
const oneClickEmployee = ref(null)
const oneClickPreviewRows = ref([])
const oneClickQueried = ref(false)
const reviewTable = ref(null)
const reviewLoading = ref(false)
const reviewLoaded = ref(false)
const reviewRows = ref([])
const reviewKeywordInput = ref('')
const reviewKeyword = ref('')
const reviewPage = ref(1)
const reviewPageSize = ref(10)
const reviewTotal = ref(0)
const reviewActionId = ref(null)
const reviewBatchAuditing = ref(false)
const expandedReviewIds = ref(new Set())
const reviewPendingCount = computed(() => reviewRows.value.filter((row) => row.status === 'pending').length)
const consumptionLoading = ref(false)
const consumptionLoaded = ref(false)
const consumptionRows = ref([])
const consumptionDateRange = ref([])
const consumptionFilters = reactive({ employee: '', mealType: '', cardNumber: '' })
const consumptionQuery = reactive({ startDate: '', endDate: '', employee: '', mealType: '', cardNumber: '' })
const consumptionPage = ref(1)
const consumptionPageSize = ref(10)
const consumptionTotal = ref(0)
const filteredRows = computed(() => {
  const search = String(keyword.value || '').replace(/\D/g, '')
  if (!search) return rows.value
  return rows.value.filter((item) => String(item.date || '').replace(/\D/g, '').includes(search))
})
const pagedRows = computed(() => filteredRows.value.slice((page.value - 1) * pageSize.value, page.value * pageSize.value))

watch([keyword, pageSize], () => { page.value = 1 })

async function load() {
  loading.value = true
  try {
    const response = await getDiningRecords()
    rows.value = Array.isArray(response.data?.data?.rows) ? response.data.data.rows : []
    page.value = 1
  } catch (error) {
    ElMessage.error(String(error?.response?.data?.msg ?? '').trim() || '读取报餐管理数据失败')
  } finally {
    loading.value = false
  }
}

function normalizePeopleRows(items) {
  return (Array.isArray(items) ? items : []).map((item) => ({
    ...item,
    rowKey: `${item.uid}|${item.date}|${item.mealType}`,
  }))
}

async function loadPeople() {
  peopleLoading.value = true
  try {
    const response = await getDiningPeopleRecords({
      keyword: peopleKeyword.value,
      page: peoplePage.value,
      pageSize: peoplePageSize.value,
    })
    const data = response.data?.data || {}
    peopleRows.value = normalizePeopleRows(data.rows)
    peopleTotal.value = Number(data.pagination?.total || 0)
    peopleLoaded.value = true
  } catch (error) {
    ElMessage.error(String(error?.response?.data?.msg ?? '').trim() || '查询报餐人记录失败')
  } finally {
    peopleLoading.value = false
  }
}

function switchTab(key) {
  activeTab.value = key
  if (key === 'people' && !peopleLoaded.value) loadPeople()
  if (key === 'supplement' && !supplementLoaded.value) initializeSupplement()
  if (key === 'audit' && !reviewLoaded.value) loadSupplementReviews()
  if (key === 'consumption' && !consumptionLoaded.value) {
    applyDefaultConsumptionRange()
    loadConsumptions()
  }
}

/** 与后端 recentThreeMonthRange 一致：当前月及前两个月 */
function recentThreeMonthRangeLocal(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit' }).formatToParts(now)
  const current = Object.fromEntries(parts.map((item) => [item.type, item.value]))
  const year = Number(current.year)
  const month = Number(current.month)
  const start = new Date(Date.UTC(year, month - 3, 1))
  const endDay = new Date(Date.UTC(year, month, 0)).getUTCDate()
  const startDate = `${start.getUTCFullYear()}-${String(start.getUTCMonth() + 1).padStart(2, '0')}-01`
  const endDate = `${current.year}-${current.month}-${String(endDay).padStart(2, '0')}`
  return { startDate, endDate }
}

function applyDefaultConsumptionRange() {
  const range = recentThreeMonthRangeLocal()
  consumptionDateRange.value = [range.startDate, range.endDate]
  consumptionQuery.startDate = range.startDate
  consumptionQuery.endDate = range.endDate
  consumptionQuery.employee = ''
  consumptionQuery.mealType = ''
  consumptionQuery.cardNumber = ''
  consumptionFilters.employee = ''
  consumptionFilters.mealType = ''
  consumptionFilters.cardNumber = ''
}

async function initializeSupplement({ clearLines = false } = {}) {
  supplementLoading.value = true
  try {
    const response = await getDiningSupplementInit()
    const data = response.data?.data || {}
    supplementForm.openedAt = String(data.openedAt || '')
    supplementForm.operatorName = String(data.operatorName || '')
    supplementToday.value = String(data.today || '')
    supplementMaxStaff.value = Number(data.maxStaff || 500)
    supplementForm.mealType = ''
    supplementForm.date = ''
    supplementForm.remark = ''
    supplementSection.value = 'base'
    if (clearLines) {
      supplementLines.value = []
      selectedSupplementIds.value = new Set()
    }
    supplementLoaded.value = true
  } catch (error) {
    ElMessage.error(String(error?.response?.data?.msg || '').trim() || '初始化打卡消费补录失败')
  } finally {
    supplementLoading.value = false
  }
}

function disableFutureSupplementDate(value) {
  if (!supplementToday.value) return false
  const year = value.getFullYear()
  const month = String(value.getMonth() + 1).padStart(2, '0')
  const day = String(value.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}` > supplementToday.value
}

function toggleSupplementLine(row) {
  const next = new Set(selectedSupplementIds.value)
  if (next.has(row.id)) next.delete(row.id)
  else next.add(row.id)
  selectedSupplementIds.value = next
}

async function removeSelectedSupplementLines() {
  if (!selectedSupplementIds.value.size) return
  try { await ElMessageBox.confirm('确定删除选定明细吗？', '提示', { type: 'warning' }) } catch { return }
  supplementLines.value = supplementLines.value.filter((row) => !selectedSupplementIds.value.has(row.id))
  selectedSupplementIds.value = new Set()
  ElMessage.success('已删除选定明细')
}

async function removeAllSupplementLines() {
  if (!supplementLines.value.length) return
  try { await ElMessageBox.confirm('确定删除全部明细吗？', '提示', { type: 'warning' }) } catch { return }
  supplementLines.value = []
  selectedSupplementIds.value = new Set()
  ElMessage.success('已删除全部明细')
}

function openSupplementStaffWindow() {
  if (supplementLines.value.length >= supplementMaxStaff.value) return ElMessage.warning(`一张补录单最多添加${supplementMaxStaff.value}人`)
  if (activeSupplementSessionId.value) clearSupplementBatchSession(activeSupplementSessionId.value)
  const sessionId = buildDiningSupplementSessionId()
  activeSupplementSessionId.value = sessionId
  writeDiningSupplementContext(sessionId, {
    existingIds: supplementLines.value.map((row) => row.id),
    maxStaff: supplementMaxStaff.value,
  })
  const target = `/canteen/records/supplement-staff-window?sessionId=${encodeURIComponent(sessionId)}`
  const popup = window.open(target, '_blank')
  supplementStaffChildWindow.value = popup || null
  if (!popup) {
    clearSupplementBatchSession(sessionId)
    ElMessage.error('浏览器阻止了批量添加窗口，请允许本站打开新窗口')
  }
}

function replySupplementWindow(target, payload) {
  const child = target && typeof target.postMessage === 'function'
    ? target
    : (supplementStaffChildWindow.value && !supplementStaffChildWindow.value.closed ? supplementStaffChildWindow.value : null)
  if (child) child.postMessage(payload, window.location.origin)
}

function clearSupplementBatchSession(sessionId, { closeWindow = false } = {}) {
  const child = supplementStaffChildWindow.value
  // 父页面主动关闭自己打开的批量添加页，避免浏览器拦截子页面自关后一直停在“正在带回”。
  if (closeWindow && child && !child.closed) {
    try { child.close() } catch { /* 浏览器拒绝关闭时仍继续清理临时会话 */ }
  }
  removeDiningSupplementContext(sessionId)
  removeDiningSupplementResult(sessionId)
  if (activeSupplementSessionId.value === sessionId) activeSupplementSessionId.value = ''
  supplementStaffChildWindow.value = null
}

function applySupplementBatch(payload, replyTarget = null) {
  if (payload?.type !== DINING_SUPPLEMENT_MSG_APPLY) return false
  const sessionId = String(payload.sessionId || '')
  if (!sessionId || sessionId !== activeSupplementSessionId.value) return false
  const incoming = Array.isArray(payload.rows) ? payload.rows : []
  const existing = new Set(supplementLines.value.map((row) => Number(row.id)))
  const append = incoming.filter((row) => Number(row.id) > 0 && !existing.has(Number(row.id)))
  if (!append.length) {
    replySupplementWindow(replyTarget, {
      type: DINING_SUPPLEMENT_MSG_REJECTED,
      sessionId,
      message: '所选员工已在当前明细中',
    })
    clearSupplementBatchSession(sessionId, { closeWindow: true })
    ElMessage.warning('所选员工已在当前明细中')
    return true
  }
  if (supplementLines.value.length + append.length > supplementMaxStaff.value) {
    const message = `一张补录单最多添加${supplementMaxStaff.value}人`
    replySupplementWindow(replyTarget, { type: DINING_SUPPLEMENT_MSG_REJECTED, sessionId, message })
    clearSupplementBatchSession(sessionId, { closeWindow: true })
    ElMessage.warning(message)
    return true
  }
  supplementLines.value = [...supplementLines.value, ...append.map((row) => ({ ...row, id: Number(row.id) }))]
  supplementSection.value = 'lines'
  replySupplementWindow(replyTarget, { type: DINING_SUPPLEMENT_MSG_ACCEPTED, sessionId, lineCount: append.length })
  clearSupplementBatchSession(sessionId, { closeWindow: true })
  ElMessage.success(`已批量添加 ${append.length} 名员工`)
  return true
}

function onSupplementBatchMessage(event) {
  if (event.origin !== window.location.origin) return
  applySupplementBatch(event.data, event.source)
}

function onSupplementBatchStorage(event) {
  const payload = parseDiningSupplementResultStorageEvent(event)
  if (payload) applySupplementBatch(payload)
}

function recoverSupplementBatchResult() {
  if (!activeSupplementSessionId.value) return
  const payload = readDiningSupplementResult(activeSupplementSessionId.value)
  if (payload) applySupplementBatch(payload)
}

async function resetSupplement() {
  if (supplementLines.value.length || supplementForm.mealType || supplementForm.date || supplementForm.remark) {
    try { await ElMessageBox.confirm('重置后将清空当前补录草稿，是否继续？', '重置补录', { type: 'warning' }) } catch { return }
  }
  await initializeSupplement({ clearLines: true })
}

async function searchOneClickStaff() {
  const keyword = String(oneClickKeyword.value || '').trim()
  if (!keyword) return ElMessage.warning('请输入员工姓名')
  oneClickLoading.value = true
  try {
    const response = await getDiningSupplementStaff({ keyword, page: 1, pageSize: 20 })
    const data = response.data?.data || {}
    oneClickStaffRows.value = Array.isArray(data.list) ? data.list : []
    oneClickEmployee.value = null
    oneClickPreviewRows.value = []
    oneClickQueried.value = false
    if (!oneClickStaffRows.value.length) ElMessage.warning('没有找到可选员工')
  } catch (error) {
    ElMessage.error(String(error?.response?.data?.msg || '').trim() || '查询员工失败')
  } finally {
    oneClickLoading.value = false
  }
}

function selectOneClickStaff(row) {
  oneClickEmployee.value = {
    id: Number(row.id),
    employeeCode: String(row.employeeCode || ''),
    employeeName: String(row.employeeName || ''),
    department: String(row.department || ''),
    cardNumber: String(row.cardNumber || ''),
  }
  oneClickPreviewRows.value = []
  oneClickQueried.value = false
  ElMessage.success(`已选择员工：${oneClickEmployee.value.employeeName}`)
}

async function loadOneClickPreview() {
  if (!oneClickEmployee.value?.id) return ElMessage.warning('请先选择一名员工')
  if (!oneClickMonth.value) return ElMessage.warning('请选择月份')
  oneClickLoading.value = true
  try {
    const response = await getDiningOneClickSupplementPreview({
      staffId: oneClickEmployee.value.id,
      month: oneClickMonth.value,
    })
    const data = response.data?.data || {}
    if (data.employee) oneClickEmployee.value = data.employee
    oneClickPreviewRows.value = Array.isArray(data.rows) ? data.rows : []
    oneClickQueried.value = true
  } catch (error) {
    oneClickPreviewRows.value = []
    oneClickQueried.value = false
    ElMessage.error(String(error?.response?.data?.msg || '').trim() || '查询漏卡记录失败')
  } finally {
    oneClickLoading.value = false
  }
}

async function confirmOneClickSupplement() {
  if (!oneClickEmployee.value?.id || !oneClickMonth.value || !oneClickPreviewRows.value.length) return
  try {
    await ElMessageBox.confirm(
      `确定为 ${oneClickEmployee.value.employeeName} 生成 ${oneClickPreviewRows.value.length} 条待审核漏卡补录吗？`,
      '一键补录确认',
      { type: 'warning', confirmButtonText: '确定补录', cancelButtonText: '返回' },
    )
  } catch {
    return
  }
  oneClickSaving.value = true
  try {
    const response = await createDiningOneClickSupplement({
      staffId: oneClickEmployee.value.id,
      month: oneClickMonth.value,
    })
    const data = response.data?.data || {}
    const insertedCount = Number(data.insertedCount || 0)
    const skippedCount = Number(data.skippedCount || 0)
    if (insertedCount) ElMessage.success(`已生成 ${insertedCount} 条待审核补录${skippedCount ? `，跳过 ${skippedCount} 条` : ''}`)
    else ElMessage.warning('没有可补录的漏卡记录，请重新查询')
    reviewLoaded.value = false
    await loadOneClickPreview()
  } catch (error) {
    ElMessage.error(String(error?.response?.data?.msg || '').trim() || '一键补录保存失败')
  } finally {
    oneClickSaving.value = false
  }
}

function supplementSkippedText(items) {
  return (Array.isArray(items) ? items : []).slice(0, 20).map((item) => `${item.employeeName}：${item.reason}`).join('\n')
}

async function saveSupplement() {
  if (!supplementForm.mealType) return ElMessage.warning('请选择补录餐别')
  if (!supplementForm.date) return ElMessage.warning('请选择补录日期')
  if (!supplementLines.value.length) { supplementSection.value = 'lines'; return ElMessage.warning('请至少添加一名员工') }
  supplementSaving.value = true
  try {
    const response = await createDiningSupplement({
      openedAt: supplementForm.openedAt,
      mealType: supplementForm.mealType,
      date: supplementForm.date,
      remark: supplementForm.remark,
      staffIds: supplementLines.value.map((row) => row.id),
    })
    const result = response.data?.data || {}
    if (!Number(result.insertedCount || 0)) {
      const detail = supplementSkippedText(result.skipped)
      await ElMessageBox.alert(detail || '所选员工均已刷卡、已有待审核补录或已经失效。', '没有可保存的人员', { type: 'warning' })
      return
    }
    const skippedText = supplementSkippedText(result.skipped)
    const message = `批次 ${result.batchCode} 已保存 ${result.insertedCount} 人，等待审核。${skippedText ? `\n跳过 ${result.skippedCount} 人：\n${skippedText}` : ''}`
    await ElMessageBox.alert(message, '补录保存成功', { type: 'success' })
    await initializeSupplement({ clearLines: true })
  } catch (error) {
    ElMessage.error(String(error?.response?.data?.msg || '').trim() || '保存打卡消费补录失败')
  } finally {
    supplementSaving.value = false
  }
}

async function loadSupplementReviews() {
  reviewLoading.value = true
  expandedReviewIds.value = new Set()
  try {
    const response = await getDiningSupplementReviews({
      keyword: reviewKeyword.value,
      page: reviewPage.value,
      pageSize: reviewPageSize.value,
    })
    const data = response.data?.data || {}
    reviewRows.value = (Array.isArray(data.rows) ? data.rows : []).map((row) => ({
      ...row,
      details: null,
      detailsLoading: false,
      detailsError: '',
    }))
    reviewTotal.value = Number(data.pagination?.total || 0)
    reviewLoaded.value = true
  } catch (error) {
    ElMessage.error(String(error?.response?.data?.msg || '').trim() || '查询补录审核列表失败')
  } finally {
    reviewLoading.value = false
  }
}

function searchSupplementReviews() {
  reviewKeyword.value = String(reviewKeywordInput.value || '').trim()
  reviewPage.value = 1
  loadSupplementReviews()
}

function resetSupplementReviews() {
  reviewKeywordInput.value = ''
  reviewKeyword.value = ''
  reviewPage.value = 1
  loadSupplementReviews()
}

function changeReviewPageSize(value) {
  reviewPageSize.value = value
  reviewPage.value = 1
  loadSupplementReviews()
}

function changeReviewPage(value) {
  reviewPage.value = value
  loadSupplementReviews()
}

function reviewSequence(index) {
  return (reviewPage.value - 1) * reviewPageSize.value + index + 1
}

async function loadSupplementReviewDetails(row) {
  if (Array.isArray(row.details) || row.detailsLoading) return
  row.detailsLoading = true
  row.detailsError = ''
  try {
    const response = await getDiningSupplementReviewDetails(row.anchorId)
    row.details = Array.isArray(response.data?.data?.rows) ? response.data.data.rows : []
  } catch (error) {
    row.detailsError = String(error?.response?.data?.msg || '').trim() || '读取补录人员明细失败'
  } finally {
    row.detailsLoading = false
  }
}

function toggleReviewRow(row) {
  const next = new Set(expandedReviewIds.value)
  const opening = !next.has(row.anchorId)
  if (opening) next.add(row.anchorId)
  else next.delete(row.anchorId)
  expandedReviewIds.value = next
  reviewTable.value?.toggleRowExpansion(row, opening)
  if (opening) loadSupplementReviewDetails(row)
}

function onReviewRowClick(row, _column, event) {
  const target = event?.target
  if (target?.closest?.('.el-button, .review-detail-wrap, .el-table__expand-icon, .review-action-column')) return
  toggleReviewRow(row)
}

async function batchAuditSupplementReviewsCurrentPage() {
  const targets = reviewRows.value.filter((row) => row.status === 'pending')
  if (!targets.length) {
    ElMessage.warning('当前页没有可审核的补录批次')
    return
  }
  try {
    await ElMessageBox.confirm(
      `确定批量审核当前页 ${targets.length} 条待审补录吗？`,
      '批量审核确认',
      { type: 'warning', confirmButtonText: '批量审核', cancelButtonText: '取消' },
    )
  } catch {
    return
  }
  reviewBatchAuditing.value = true
  let success = 0
  let failed = 0
  const failedMessages = []
  try {
    for (const row of targets) {
      try {
        await auditDiningSupplementReview(row.anchorId)
        success += 1
      } catch (error) {
        failed += 1
        const conflicts = error?.response?.data?.data?.conflicts
        if (Array.isArray(conflicts) && conflicts.length) {
          const names = conflicts.slice(0, 5).map((item) => item.employeeName || item.uid).filter(Boolean).join('、')
          failedMessages.push(`${row.date} ${row.mealTypeName}：已有正式刷卡（${names}${conflicts.length > 5 ? '…' : ''}）`)
        } else {
          failedMessages.push(`${row.date} ${row.mealTypeName}：${String(error?.response?.data?.msg || error?.message || '审核失败').trim()}`)
        }
      }
    }
    if (failed > 0) {
      ElMessage.warning(`批量审核完成：成功 ${success} 条，失败 ${failed} 条`)
      console.warn('[补录批量审核失败明细]', failedMessages)
    } else {
      ElMessage.success(`批量审核完成：成功 ${success} 条`)
    }
    await loadSupplementReviews()
  } finally {
    reviewBatchAuditing.value = false
  }
}

async function loadConsumptions() {
  consumptionLoading.value = true
  try {
    const response = await getDiningConsumptions({
      startDate: consumptionQuery.startDate,
      endDate: consumptionQuery.endDate,
      employee: consumptionQuery.employee,
      mealType: consumptionQuery.mealType,
      cardNumber: consumptionQuery.cardNumber,
      page: consumptionPage.value,
      pageSize: consumptionPageSize.value,
    })
    const data = response.data?.data || {}
    consumptionRows.value = Array.isArray(data.rows) ? data.rows : []
    consumptionTotal.value = Number(data.pagination?.total || 0)
    if (data.range?.startDate && data.range?.endDate && !consumptionDateRange.value?.length) {
      consumptionDateRange.value = [data.range.startDate, data.range.endDate]
    }
    consumptionLoaded.value = true
  } catch (error) {
    ElMessage.error(String(error?.response?.data?.msg || '').trim() || '查询打卡消费记录失败')
  } finally {
    consumptionLoading.value = false
  }
}

function searchConsumptions() {
  const range = Array.isArray(consumptionDateRange.value) ? consumptionDateRange.value : []
  if (!range[0] || !range[1]) {
    ElMessage.warning('请选择消费日期范围')
    return
  }
  consumptionQuery.startDate = String(range[0])
  consumptionQuery.endDate = String(range[1])
  consumptionQuery.employee = String(consumptionFilters.employee || '').trim()
  consumptionQuery.mealType = String(consumptionFilters.mealType || '').trim()
  consumptionQuery.cardNumber = String(consumptionFilters.cardNumber || '').trim()
  consumptionPage.value = 1
  loadConsumptions()
}

function resetConsumptions() {
  applyDefaultConsumptionRange()
  consumptionPage.value = 1
  loadConsumptions()
}

function changeConsumptionPageSize(value) {
  consumptionPageSize.value = value
  consumptionPage.value = 1
  loadConsumptions()
}

function changeConsumptionPage(value) {
  consumptionPage.value = value
  loadConsumptions()
}

async function confirmSupplementReview(row, action) {
  if (row.status === 'abnormal') return
  const isAudit = action === 'audit'
  const verb = isAudit ? '审核' : '反审'
  try {
    await ElMessageBox.confirm(
      `确定${verb} ${row.date} 的${row.mealTypeName}补录吗？本批次共 ${row.peopleCount} 人。`,
      `${verb}补录`,
      { type: 'warning', confirmButtonText: `确定${verb}`, cancelButtonText: '返回' },
    )
  } catch {
    return
  }
  reviewActionId.value = row.anchorId
  try {
    if (isAudit) await auditDiningSupplementReview(row.anchorId)
    else await unauditDiningSupplementReview(row.anchorId)
    ElMessage.success(`补录${verb}成功`)
    await loadSupplementReviews()
  } catch (error) {
    const conflicts = error?.response?.data?.data?.conflicts
    if (isAudit && Array.isArray(conflicts) && conflicts.length) {
      const names = conflicts.slice(0, 20).map((item) => item.employeeName || item.uid).filter(Boolean).join('、')
      const suffix = conflicts.length > 20 ? `等 ${conflicts.length} 人` : ''
      await ElMessageBox.alert(`以下员工已经存在正式刷卡，本批次未审核：\n${names}${suffix}`, '审核冲突', { type: 'warning' })
    } else {
      ElMessage.error(String(error?.response?.data?.msg || '').trim() || `补录${verb}失败`)
    }
  } finally {
    reviewActionId.value = null
  }
}

function searchPeople() {
  peopleKeyword.value = String(peopleKeywordInput.value || '').trim()
  peoplePage.value = 1
  loadPeople()
}

function resetPeople() {
  peopleKeywordInput.value = ''
  peopleKeyword.value = ''
  peoplePage.value = 1
  loadPeople()
}

function changePeoplePageSize(value) {
  peoplePageSize.value = value
  peoplePage.value = 1
  loadPeople()
}

function changePeoplePage(value) {
  peoplePage.value = value
  loadPeople()
}

async function confirmCancel(row) {
  if (!row.canCancel) return
  try {
    await ElMessageBox.confirm(
      `确定取消 ${row.employeeName || row.employeeCode} 在 ${row.date} 的${row.mealTypeName}报餐吗？`,
      '取消报餐',
      { type: 'warning', confirmButtonText: '确定取消', cancelButtonText: '返回' },
    )
  } catch {
    return
  }
  cancelingKey.value = row.rowKey
  try {
    await cancelDiningPeopleRecord(row)
    ElMessage.success('取消报餐成功')
    if (peopleRows.value.length === 1 && peoplePage.value > 1) peoplePage.value -= 1
    await loadPeople()
  } catch (error) {
    ElMessage.error(String(error?.response?.data?.msg ?? '').trim() || '取消报餐失败')
  } finally {
    cancelingKey.value = ''
  }
}

onMounted(() => {
  load()
  window.addEventListener('message', onSupplementBatchMessage)
  window.addEventListener('storage', onSupplementBatchStorage)
  window.addEventListener('focus', recoverSupplementBatchResult)
})
onUnmounted(() => {
  window.removeEventListener('message', onSupplementBatchMessage)
  window.removeEventListener('storage', onSupplementBatchStorage)
  window.removeEventListener('focus', recoverSupplementBatchResult)
})
</script>

<style scoped>
.dining-records-page { min-height: 320px; }
.module-tabs { display: flex; flex-wrap: wrap; gap: 10px; margin-bottom: 16px; }
.date-search { width: min(280px, 100%); margin-left: auto; }
.people-search-card { margin-bottom: 16px; }
.people-search-row { display: flex; flex-wrap: wrap; gap: 10px; }
.people-search-input { width: min(420px, 100%); }
.card-header { display: flex; align-items: center; justify-content: space-between; font-size: 16px; font-weight: 600; }
/* DIY：补录审核关键字框宽度，与入库单筛查条约 420px 对齐；同行不换行 */
.review-list-card { --review-filter-keyword-width: 400px; }
.review-filter-row { flex-wrap: nowrap; }
.review-filter-keyword {
  flex: 0 0 var(--review-filter-keyword-width);
  width: min(var(--review-filter-keyword-width), 100%);
}
/* DIY：消费记录筛查控件宽度 */
.consumption-list-card {
  --consumption-filter-date-width: 280px;
  --consumption-filter-employee-width: 180px;
  --consumption-filter-meal-width: 110px;
  --consumption-filter-card-width: 160px;
}
.consumption-filter-row { flex-wrap: wrap; }
.consumption-filter-date { width: var(--consumption-filter-date-width); }
.consumption-filter-employee { width: var(--consumption-filter-employee-width); }
.consumption-filter-meal { width: var(--consumption-filter-meal-width); }
.consumption-filter-card { width: var(--consumption-filter-card-width); }
.meal-summary { line-height: 1.9; color: #334155; }
.meal-summary b { color: #0f5ba7; }
.meal-type--lunch { color: #1677ff; font-weight: 600; }
.meal-type--dinner { color: #e5484d; font-weight: 600; }
.pagination-row { display: flex; justify-content: flex-start; margin-bottom: 14px; }
.pagination-row--bottom { margin: 14px 0 0; }
.supplement-head-actions { display: flex; gap: 10px; }
.supplement-form-grid { display: grid; grid-template-columns: repeat(2, 350px); gap: 12px 20px; align-items: start; }
.supplement-field { width: 350px; margin-bottom: 0; }
.supplement-form :deep(.el-select), .supplement-form :deep(.el-date-editor), .supplement-form :deep(.el-input) { width: 100%; }
.supplement-form :deep(.el-input__wrapper), .supplement-form :deep(.el-select__wrapper) { min-height: 52px; box-sizing: border-box; }
.supplement-remark-item { grid-column: 1 / span 2; width: 500px; margin-bottom: 0; }
.supplement-line-toolbar { display: flex; flex-wrap: wrap; gap: 10px; margin-bottom: 14px; }
.supplement-line-mark--on { color: #fff; border-color: #909399; background: #909399; }
.one-click-name { width: min(260px, 100%); }
.one-click-month { width: 160px; }
.one-click-selected { margin: 14px 0; }
.one-click-submit { display: flex; justify-content: flex-end; margin-top: 14px; }
.review-table :deep(.review-expand-column) { padding: 0; border-right: 0; }
.review-table :deep(.review-expand-column .cell) { display: none; }
.review-expand-button { min-width: 26px; margin-right: 6px; font-size: 18px; }
.review-detail-wrap { padding: 12px 22px; background: #f8fafc; }
.review-detail-table { max-width: 720px; }
.review-status-error { color: #e5484d; font-weight: 600; }
@media (max-width: 760px) {
  .date-search, .people-search-input, .review-filter-keyword,
  .consumption-filter-date, .consumption-filter-employee, .consumption-filter-meal, .consumption-filter-card {
    margin-left: 0;
    width: 100%;
  }
  .one-click-name, .one-click-month { width: 100%; }
  .review-filter-row { flex-wrap: wrap; }
  .pagination-row :deep(.el-pagination) { flex-wrap: wrap; row-gap: 8px; }
}
@media (max-width: 760px) { .supplement-form-grid { grid-template-columns: 1fr; } .supplement-field, .supplement-remark-item { grid-column: auto; width: 100%; } .card-header { align-items: flex-start; gap: 10px; } }
</style>
