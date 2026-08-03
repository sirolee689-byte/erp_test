<template>
  <main class="terminal-page" @click="focusCardInput">
    <transition name="toast-pop">
      <div v-if="lastResult" :key="resultKey" class="result-toast" :class="resultClass">
        <strong>{{ resultTitle }}</strong>
        <span v-if="lastResult.employee?.name">{{ lastResult.employee.name }}</span>
        <span v-if="lastResult.message">{{ lastResult.message }}</span>
      </div>
    </transition>

    <section v-if="loading" class="state-card">
      <el-icon class="is-loading" :size="34"><Loading /></el-icon>
      <p>正在读取终端配置……</p>
    </section>

    <section v-else-if="contextError" class="state-card error-state">
      <el-icon :size="42"><CircleCloseFilled /></el-icon>
      <h2>{{ contextError }}</h2>
      <p>请确认当前电脑IP已配置到饭堂终端表。</p>
      <el-button type="primary" @click.stop="initialize({ resetPage: true })">重新检查</el-button>
    </section>

    <template v-else-if="context">
      <section class="toolbar" @click.stop>
        <template v-if="context.testMode">
          <span class="test-date-fixed">{{ testDate }}</span>
          <el-radio-group v-model="testMealType" @change="refreshTarget">
            <el-radio-button label="lunch">午餐</el-radio-button>
            <el-radio-button label="dinner">晚餐</el-radio-button>
          </el-radio-group>
        </template>

        <el-input
          ref="cardInputRef"
          v-model="cardNumber"
          class="card-input"
          inputmode="numeric"
          maxlength="10"
          autocomplete="off"
          placeholder="请刷员工饭卡"
          :disabled="submitting || !canSwipe"
          @keyup.enter="submitSwipe"
          @blur="scheduleFocus"
        />
        <el-button
          type="primary"
          class="swipe-button"
          :loading="submitting"
          :disabled="!canSwipe"
          @click="submitSwipe"
        >
          {{ submitting ? '刷卡中' : '自动刷卡' }}
        </el-button>
      </section>

      <div v-if="!canSwipe" class="outside-time">当前不在午餐或晚餐刷卡时段</div>

      <section class="summary-strip">
        <div><span>应刷</span><strong>{{ summary.expected }}</strong><small>人</small></div>
        <div><span>已刷</span><strong>{{ summary.swiped }}</strong><small>人</small></div>
        <div class="pending"><span>未刷</span><strong>{{ summary.pending }}</strong><small>人</small></div>
        <div><span>补刷</span><strong>{{ summary.supplement }}</strong><small>人</small></div>
      </section>

      <section class="data-layout">
        <section class="data-card" @click.stop>
          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>刷卡时间</th>
                  <th>员工姓名</th>
                  <th>状态</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="row in recentRows" :key="row.id">
                  <td>{{ formatTime(row.edibleTime) }}</td>
                  <td class="employee-name">{{ row.employeeName || '未知员工' }}</td>
                  <td>
                    <el-tag :type="row.result === '补餐成功' ? 'warning' : 'success'" size="large">
                      {{ row.result }}
                    </el-tag>
                  </td>
                </tr>
                <tr v-if="!recentRows.length && !recentLoading">
                  <td colspan="3" class="empty-row">暂无刷卡记录</td>
                </tr>
              </tbody>
            </table>
            <div v-if="recentLoading" class="table-loading">
              <el-icon class="is-loading" :size="28"><Loading /></el-icon>
            </div>
          </div>

          <footer class="pagination-bar">
            <div class="page-size">
              <span>每页</span>
              <el-select v-model="pagination.pageSize" @change="changePageSize">
                <el-option v-for="size in pageSizeOptions" :key="size" :label="`${size}条`" :value="size" />
              </el-select>
            </div>
            <span>共 {{ pagination.total }} 条</span>
            <el-button :disabled="pagination.page <= 1 || recentLoading" @click="changePage(pagination.page - 1)">
              上一页
            </el-button>
            <strong>第 {{ pagination.page }} / {{ displayTotalPages }} 页</strong>
            <el-button
              :disabled="pagination.page >= pagination.totalPages || recentLoading"
              @click="changePage(pagination.page + 1)"
            >
              下一页
            </el-button>
          </footer>
        </section>

        <aside class="pending-card" @click.stop>
          <div class="pending-heading">
            <div>
              <p>待刷人员</p>
              <h2>未刷卡名单</h2>
            </div>
            <strong>{{ pendingRows.length }}<small>人</small></strong>
          </div>
          <div v-if="!pendingRows.length" class="pending-empty">全部人员已刷卡</div>
          <ul v-else class="pending-list">
            <li v-for="person in pendingRows" :key="person.uid">
              {{ person.employeeName }}
            </li>
          </ul>
        </aside>
      </section>
    </template>
  </main>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { CircleCloseFilled, Loading } from '@element-plus/icons-vue'
import {
  getDiningTerminalContext,
  getDiningTerminalRecent,
  swipeDiningCard,
} from '@/api/diningTerminalApi'
import { shouldKeepDiningCardFocus } from './focusPolicy.js'

const loading = ref(true)
const contextError = ref('')
const context = ref(null)
const cardNumber = ref('')
const cardInputRef = ref(null)
const submitting = ref(false)
const lastResult = ref(null)
const resultKey = ref(0)
const recentRows = ref([])
const pendingRows = ref([])
const recentLoading = ref(false)
const testDate = ref('2026-07-31')
const testMealType = ref('lunch')
const pageSizeOptions = [10, 20, 50]
const pagination = ref({ page: 1, pageSize: 10, total: 0, totalPages: 0 })
const summary = ref({ expected: 0, swiped: 0, pending: 0, supplement: 0 })
let contextTimer = null
let focusTimer = null
let resultTimer = null

const audioFiles = {
  success: '/dining-audio/success.wav',
  supplement_success: '/dining-audio/supplement-success.wav',
  duplicate: '/dining-audio/duplicate.wav',
  not_reported: '/dining-audio/not-reported.wav',
  employee_not_found: '/dining-audio/card-not-found.wav',
  error: '/dining-audio/terminal-unauthorized.wav',
}

const selectedDate = computed(() => context.value?.testMode ? testDate.value : context.value?.serverDate || '')
const canSwipe = computed(() => Boolean(context.value?.testMode || context.value?.activeMeal))
const displayTotalPages = computed(() => Math.max(1, pagination.value.totalPages))
const isSuccessResult = computed(() => ['success', 'supplement_success'].includes(lastResult.value?.status))
const resultClass = computed(() => ({
  success: isSuccessResult.value,
  warning: lastResult.value?.status === 'duplicate',
  error: !isSuccessResult.value && lastResult.value?.status !== 'duplicate',
}))
const resultTitle = computed(() => ({
  success: '打卡成功',
  supplement_success: '补餐成功',
  duplicate: '重复打卡',
  not_reported: '未报餐',
  employee_not_found: '没有找到员工档案',
  error: '刷卡失败',
}[lastResult.value?.status] || '刷卡结果'))

function targetParams() {
  if (!context.value?.testMode) return {}
  return { date: testDate.value, mealType: testMealType.value }
}

function focusCardInput() {
  if (!shouldKeepDiningCardFocus(context.value) || !canSwipe.value || submitting.value) return
  nextTick(() => cardInputRef.value?.focus())
}

function scheduleFocus() {
  if (!shouldKeepDiningCardFocus(context.value)) return
  clearTimeout(focusTimer)
  focusTimer = setTimeout(focusCardInput, 80)
}

function playResultAudio(status) {
  const source = audioFiles[status] || audioFiles.error
  const audio = new Audio(source)
  audio.play().catch(() => {})
}

function showResult(result) {
  clearTimeout(resultTimer)
  lastResult.value = result
  resultKey.value += 1
  playResultAudio(result.status)
  resultTimer = setTimeout(() => { lastResult.value = null }, 3500)
}

function apiMessage(error, fallback) {
  return error?.response?.data?.msg || fallback
}

async function initialize({ resetPage = false } = {}) {
  loading.value = true
  contextError.value = ''
  const previousTarget = `${selectedDate.value}:${context.value?.activeMeal?.key || testMealType.value}`
  try {
    const response = await getDiningTerminalContext()
    context.value = response.data?.data
    testDate.value = '2026-07-31'
    if (!testMealType.value) testMealType.value = context.value?.activeMeal?.key || 'lunch'
    const nextTarget = `${selectedDate.value}:${context.value?.activeMeal?.key || testMealType.value}`
    await loadRecent({ resetPage: resetPage || Boolean(previousTarget && previousTarget !== nextTarget) })
    focusCardInput()
  } catch (error) {
    context.value = null
    contextError.value = apiMessage(error, '终端配置读取失败')
    playResultAudio('error')
  } finally {
    loading.value = false
  }
}

async function loadRecent({ resetPage = false } = {}) {
  if (!context.value || !selectedDate.value) return
  if (resetPage) pagination.value.page = 1
  recentLoading.value = true
  try {
    const response = await getDiningTerminalRecent({
      ...targetParams(),
      page: pagination.value.page,
      pageSize: pagination.value.pageSize,
    })
    const data = response.data?.data || {}
    recentRows.value = data.rows || []
    pendingRows.value = data.pendingRows || []
    pagination.value = { ...pagination.value, ...(data.pagination || {}) }
    summary.value = { ...summary.value, ...(data.summary || {}) }
  } catch (error) {
    recentRows.value = []
    pendingRows.value = []
    pagination.value = { ...pagination.value, total: 0, totalPages: 0 }
    summary.value = { expected: 0, swiped: 0, pending: 0, supplement: 0 }
  } finally {
    recentLoading.value = false
    focusCardInput()
  }
}

function refreshTarget() {
  loadRecent({ resetPage: true })
}

function changePageSize() {
  loadRecent({ resetPage: true })
}

function changePage(page) {
  pagination.value.page = page
  loadRecent()
}

async function submitSwipe() {
  if (!canSwipe.value || submitting.value) return
  const value = cardNumber.value.trim()
  if (value.length !== 10) {
    showResult({ status: 'error', message: '饭卡号必须是10位' })
    cardNumber.value = ''
    scheduleFocus()
    return
  }

  submitting.value = true
  try {
    const response = await swipeDiningCard(value, targetParams())
    const result = response.data?.data || { status: 'error', message: '没有收到刷卡结果' }
    showResult(result)
    if (['success', 'supplement_success'].includes(result.status)) {
      await loadRecent({ resetPage: true })
    }
  } catch (error) {
    showResult({ status: 'error', message: apiMessage(error, '刷卡处理失败') })
  } finally {
    cardNumber.value = ''
    submitting.value = false
    scheduleFocus()
  }
}

function formatTime(value) {
  if (!value) return ''
  const legacy = /(?:^|\s)(\d{2}:\d{2}:\d{2})$/.exec(String(value))
  if (legacy) return legacy[1]
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return String(value)
  return new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).format(date)
}

onMounted(() => {
  initialize({ resetPage: true })
  contextTimer = setInterval(() => {
    if (!context.value?.testMode && !submitting.value) initialize()
  }, 60000)
})

onBeforeUnmount(() => {
  clearInterval(contextTimer)
  clearTimeout(focusTimer)
  clearTimeout(resultTimer)
})
</script>

<style scoped>
.terminal-page {
  min-height: 100vh;
  padding: 20px;
  box-sizing: border-box;
  overflow-x: hidden;
  color: #17324d;
  background: #f2f6fa;
}
.toolbar, .outside-time, .summary-strip, .data-layout {
  width: min(1380px, 100%);
  margin-inline: auto;
}
.toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px;
  box-sizing: border-box;
  border: 1px solid #d9e3ec;
  border-radius: 12px;
  background: #fff;
  box-shadow: 0 6px 18px rgba(45, 92, 125, .07);
}
.test-date-fixed {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 170px;
  height: 40px;
  flex: 0 0 170px;
  box-sizing: border-box;
  border: 1px solid #dcdfe6;
  border-radius: 4px;
  color: #606266;
  background: #f5f7fa;
  font-weight: 600;
}
.card-input { flex: 1; min-width: 260px; }
.card-input :deep(.el-input__wrapper) {
  min-height: 52px;
  padding-inline: 18px;
  font-size: 24px;
  letter-spacing: .12em;
}
.swipe-button { width: 132px; height: 52px; font-size: 18px; font-weight: 700; }
.outside-time {
  margin-top: 12px;
  padding: 12px;
  box-sizing: border-box;
  border-radius: 9px;
  color: #9b2c2c;
  background: #fff0f0;
  text-align: center;
  font-weight: 700;
}
.summary-strip {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  margin-top: 14px;
  border: 1px solid #d9e3ec;
  border-radius: 12px;
  overflow: hidden;
  background: #fff;
}
.summary-strip > div {
  display: flex;
  align-items: baseline;
  justify-content: center;
  gap: 8px;
  padding: 14px 10px;
  border-right: 1px solid #e5edf3;
}
.summary-strip > div:last-child { border-right: 0; }
.summary-strip span, .summary-strip small { color: #6b7f90; }
.summary-strip strong { color: #1677b8; font-size: 30px; line-height: 1; }
.summary-strip .pending strong { color: #d14343; }
.data-layout {
  display: grid;
  grid-template-columns: minmax(0, 7fr) minmax(260px, 3fr);
  gap: 14px;
  margin-top: 14px;
}
.data-card, .pending-card {
  position: relative;
  border: 1px solid #d9e3ec;
  border-radius: 12px;
  overflow: hidden;
  background: #fff;
  box-shadow: 0 6px 18px rgba(45, 92, 125, .07);
}
.table-wrap { position: relative; min-height: 270px; }
table { width: 100%; border-collapse: collapse; table-layout: fixed; }
th, td { padding: 16px 24px; border-bottom: 1px solid #e7edf2; text-align: left; }
th { color: #5b7082; background: #f7f9fb; font-size: 15px; }
td { font-size: 22px; }
th:first-child, td:first-child { width: 30%; }
th:last-child, td:last-child { width: 22%; text-align: center; }
.employee-name { font-weight: 700; }
.empty-row { height: 190px; color: #7a8d9d; text-align: center !important; }
.table-loading {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  color: #409eff;
  background: rgba(255, 255, 255, .7);
}
.pagination-bar {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 12px;
  min-height: 62px;
  padding: 8px 18px;
  box-sizing: border-box;
  color: #607486;
  background: #fafcfd;
}
.pending-card {
  padding: 18px;
  box-sizing: border-box;
}
.pending-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding-bottom: 14px;
  border-bottom: 1px solid #e7edf2;
}
.pending-heading p { margin: 0 0 3px; color: #d14343; font-size: 13px; font-weight: 700; }
.pending-heading h2 { margin: 0; font-size: 20px; }
.pending-heading > strong { color: #d14343; font-size: 30px; }
.pending-heading small { margin-left: 3px; color: #7a8d9d; font-size: 14px; font-weight: 400; }
.pending-list {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(68px, 1fr));
  align-content: start;
  gap: 0 4px;
  margin: 0;
  padding: 6px 0 0;
  list-style: none;
}
.pending-list li {
  min-width: 0;
  padding: 8px 4px;
  border-bottom: 1px solid #edf1f4;
  color: #344e63;
  overflow: hidden;
  font-size: 18px;
  font-weight: 600;
  line-height: 0.7;
  text-align: center;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.pending-empty { padding: 80px 10px; color: #4a9265; text-align: center; }
.page-size { display: flex; align-items: center; gap: 8px; }
.page-size .el-select { width: 90px; }
.result-toast {
  position: fixed;
  z-index: 2000;
  top: 18px;
  left: 50%;
  display: flex;
  align-items: center;
  gap: 14px;
  min-width: 320px;
  max-width: min(680px, calc(100vw - 30px));
  padding: 18px 24px;
  border: 2px solid;
  border-radius: 12px;
  box-sizing: border-box;
  transform: translateX(-50%);
  box-shadow: 0 12px 34px rgba(32, 55, 73, .2);
  font-size: 20px;
}
.result-toast strong { font-size: 28px; }
.result-toast.success { color: #11633a; border-color: #59bd82; background: #eaf9f0; }
.result-toast.warning { color: #865a08; border-color: #e5ad35; background: #fff7df; }
.result-toast.error { color: #992f2f; border-color: #df6b6b; background: #fff0f0; }
.state-card {
  width: min(680px, 100%);
  margin: 12vh auto 0;
  padding: 48px 24px;
  box-sizing: border-box;
  border: 1px solid #d9e3ec;
  border-radius: 14px;
  color: #73889a;
  background: #fff;
  text-align: center;
}
.state-card p { margin-bottom: 24px; }
.error-state { color: #9b2c2c; }
.toast-pop-enter-active, .toast-pop-leave-active { transition: .2s ease; }
.toast-pop-enter-from, .toast-pop-leave-to { opacity: 0; transform: translate(-50%, -12px); }

@media (max-width: 900px) {
  .terminal-page { padding: 12px; }
  .toolbar { flex-wrap: wrap; }
  .card-input { order: 3; min-width: 0; flex-basis: calc(100% - 144px); }
  .swipe-button { order: 4; }
  .data-layout { grid-template-columns: 1fr; }
  th, td { padding: 14px 12px; }
  .pagination-bar { flex-wrap: wrap; justify-content: center; }
}

@media (max-width: 520px) {
  .test-date-fixed { width: 100%; flex-basis: 100%; }
  .toolbar .el-radio-group { width: 100%; }
  .toolbar :deep(.el-radio-button) { flex: 1; }
  .toolbar :deep(.el-radio-button__inner) { width: 100%; }
  .card-input { flex-basis: 100%; }
  .swipe-button { width: 100%; }
  .summary-strip > div { flex-direction: column; align-items: center; gap: 3px; }
  .summary-strip strong { font-size: 25px; }
  th:first-child, td:first-child { width: 32%; }
  th:last-child, td:last-child { width: 30%; }
  th, td { padding: 12px 8px; font-size: 15px; }
  .result-toast { flex-wrap: wrap; min-width: 0; }
  .result-toast strong { font-size: 23px; }
}
</style>
