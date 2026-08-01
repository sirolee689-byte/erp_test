<template>
  <section class="meal-page">
    <header class="meal-hero">
      <div>
        <p class="eyebrow">员工自助报餐</p>
        <h1>选择午餐或晚餐</h1>
        <p class="hero-text">可填写明天起未来一个月的报餐，截止前可以随时取消。</p>
      </div>
      <div class="cutoff-card">
        <el-icon><Clock /></el-icon>
        <span>次日报餐截止</span>
        <strong>{{ cutoffLabel }}</strong>
      </div>
    </header>

    <el-alert
      v-if="errorText"
      class="page-alert"
      :title="errorText"
      type="error"
      show-icon
      :closable="false"
    />

    <div v-if="loading" class="meal-loading" aria-live="polite">
      <el-icon class="is-loading"><Loading /></el-icon>
      <span>正在读取报餐状态…</span>
    </div>

    <template v-else>
      <div class="range-note">
        <el-icon><Calendar /></el-icon>
        <span>{{ rangeLabel }}</span>
        <el-button text type="primary" :icon="Refresh" :loading="refreshing" @click="loadMeals">刷新</el-button>
      </div>

      <div class="date-grid">
        <article v-for="day in dates" :key="day.date" class="date-card" :class="{ locked: !day.canEdit }">
          <header class="date-heading">
            <div class="date-main">
              <strong>{{ formatMonthDay(day.date) }}</strong>
              <span>{{ formatWeekday(day.date) }}</span>
            </div>
            <el-tag v-if="day.date === startDate" effect="plain" type="primary">明天</el-tag>
            <el-tag v-else-if="!day.canEdit" effect="plain" type="info">已截止</el-tag>
          </header>

          <p class="deadline-text">
            {{ day.canEdit ? `${formatDeadline(day.deadline)} 前可修改` : `${formatDeadline(day.deadline)} 已截止` }}
          </p>

          <div class="meal-actions">
            <button
              v-for="meal in mealOptions"
              :key="meal.key"
              type="button"
              class="meal-button"
              :class="{ selected: day[meal.key].selected }"
              :disabled="!day.canEdit || savingKey === `${day.date}|${meal.key}`"
              @click="toggleMeal(day, meal)"
            >
              <el-icon v-if="savingKey === `${day.date}|${meal.key}`" class="is-loading"><Loading /></el-icon>
              <el-icon v-else-if="day[meal.key].selected"><CircleCheckFilled /></el-icon>
              <el-icon v-else><Plus /></el-icon>
              <span>{{ day[meal.key].selected ? `已报${meal.label}` : `报${meal.label}` }}</span>
            </button>
          </div>
        </article>
      </div>
    </template>
  </section>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Calendar, CircleCheckFilled, Clock, Loading, Plus, Refresh } from '@element-plus/icons-vue'
import { getDiningMeals, setDiningMeal } from '@/api/diningApi'
import { clearDiningAuth } from '@/utils/diningAuthStorage'

const router = useRouter()
const loading = ref(true)
const refreshing = ref(false)
const errorText = ref('')
const cutoffTime = ref('')
const startDate = ref('')
const endDate = ref('')
const dates = ref([])
const savingKey = ref('')

const mealOptions = [
  { key: 'lunch', label: '午餐' },
  { key: 'dinner', label: '晚餐' },
]

const cutoffLabel = computed(() => cutoffTime.value ? `前一天 ${cutoffTime.value.slice(0, 5)}` : '前一天 13:30')
const rangeLabel = computed(() => {
  if (!startDate.value || !endDate.value) return '明天起未来一个月'
  return `${formatMonthDay(startDate.value)} 至 ${formatMonthDay(endDate.value)}`
})

function parseDiningDate(date) {
  return new Date(`${date}T00:00:00+08:00`)
}

function formatMonthDay(date) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(date ?? ''))
  if (!match) return date
  return `${Number(match[2])}月${Number(match[3])}日`
}

function formatWeekday(date) {
  const value = parseDiningDate(date)
  if (Number.isNaN(value.getTime())) return ''
  return new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', weekday: 'short' }).format(value)
}

function formatDeadline(deadline) {
  const [date = '', time = ''] = String(deadline ?? '').split(' ')
  return `${formatMonthDay(date)} ${time.slice(0, 5)}`
}

async function handleUnauthorized(error) {
  if (Number(error?.response?.status) !== 401) return false
  clearDiningAuth()
  await router.replace('/dining/login')
  return true
}

async function loadMeals() {
  if (!loading.value) refreshing.value = true
  errorText.value = ''
  try {
    const response = await getDiningMeals()
    const data = response.data?.data || {}
    cutoffTime.value = String(data.cutoffTime ?? '')
    startDate.value = String(data.start ?? '')
    endDate.value = String(data.end ?? '')
    dates.value = Array.isArray(data.dates) ? data.dates : []
  } catch (error) {
    if (await handleUnauthorized(error)) return
    errorText.value = String(error?.response?.data?.msg ?? '').trim() || '读取报餐状态失败，请稍后重试'
  } finally {
    loading.value = false
    refreshing.value = false
  }
}

async function toggleMeal(day, meal) {
  if (!day.canEdit || savingKey.value) return
  const selected = Boolean(day[meal.key]?.selected)
  const action = selected ? '取消' : '提交'
  try {
    await ElMessageBox.confirm(
      `确定${action}${formatMonthDay(day.date)}的${meal.label}吗？`,
      selected ? '取消报餐' : '确认报餐',
      {
        confirmButtonText: selected ? '确定取消' : '确认提交',
        cancelButtonText: '返回',
        type: selected ? 'warning' : 'success',
      },
    )
  } catch {
    return
  }

  savingKey.value = `${day.date}|${meal.key}`
  try {
    const response = await setDiningMeal(day.date, meal.key, !selected)
    ElMessage.success(String(response.data?.msg ?? '') || (selected ? '取消报餐成功' : '报餐成功'))
    await loadMeals()
  } catch (error) {
    if (await handleUnauthorized(error)) return
    ElMessage.error(String(error?.response?.data?.msg ?? '').trim() || `${action}报餐失败，请稍后重试`)
  } finally {
    savingKey.value = ''
  }
}

onMounted(loadMeals)
</script>

<style scoped>
.meal-page { max-width: 1120px; margin: 0 auto; color: #243b57; }
.meal-hero { display: flex; align-items: center; justify-content: space-between; gap: 24px; padding: 26px 28px; border-radius: 18px; color: #fff; background: linear-gradient(135deg, #1f6fb6, #2a91d7 58%, #4bb69b); box-shadow: 0 14px 34px rgba(34, 107, 167, .18); }
.eyebrow { margin: 0 0 5px; font-size: 13px; letter-spacing: .08em; opacity: .82; }
.meal-hero h1 { margin: 0; font-size: 27px; }
.hero-text { margin: 9px 0 0; font-size: 14px; line-height: 1.65; opacity: .9; }
.cutoff-card { min-width: 156px; display: grid; grid-template-columns: 26px 1fr; align-items: center; column-gap: 8px; padding: 15px 18px; border: 1px solid rgba(255,255,255,.28); border-radius: 14px; background: rgba(255,255,255,.12); backdrop-filter: blur(8px); }
.cutoff-card .el-icon { grid-row: 1 / 3; font-size: 25px; }
.cutoff-card span { font-size: 12px; opacity: .82; }
.cutoff-card strong { margin-top: 2px; font-size: 15px; }
.page-alert { margin-top: 18px; }
.meal-loading { min-height: 300px; display: flex; align-items: center; justify-content: center; gap: 10px; color: #71859d; }
.range-note { display: flex; align-items: center; gap: 8px; min-height: 54px; margin-top: 18px; padding: 0 6px; color: #617890; }
.range-note .el-button { margin-left: auto; }
.date-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; }
.date-card { min-width: 0; padding: 18px; border: 1px solid #dce8f3; border-radius: 15px; background: #fff; box-shadow: 0 8px 24px rgba(40, 77, 115, .055); }
.date-card.locked { background: #f8fafc; }
.date-heading { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.date-main { display: flex; align-items: baseline; gap: 9px; }
.date-main strong { font-size: 20px; color: #1f436b; }
.date-main span { font-size: 13px; color: #7f92a7; }
.deadline-text { margin: 8px 0 15px; font-size: 12px; color: #8a9caf; }
.meal-actions { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
.meal-button { min-width: 0; min-height: 50px; display: flex; align-items: center; justify-content: center; gap: 8px; padding: 0 12px; border: 1px solid #cbddeb; border-radius: 12px; color: #376083; background: #f8fbfe; font: inherit; font-weight: 600; cursor: pointer; transition: border-color .16s, background .16s, color .16s, transform .16s; }
.meal-button:hover:not(:disabled) { border-color: #409eff; color: #176dbd; transform: translateY(-1px); }
.meal-button.selected { border-color: #69b995; color: #157247; background: #edf9f3; }
.meal-button:disabled { cursor: not-allowed; opacity: .58; transform: none; }
@media (max-width: 760px) {
  .meal-hero { align-items: stretch; flex-direction: column; padding: 22px 20px; border-radius: 15px; }
  .meal-hero h1 { font-size: 24px; }
  .cutoff-card { min-width: 0; }
  .range-note { margin-top: 10px; }
  .date-grid { grid-template-columns: 1fr; gap: 12px; }
  .date-card { padding: 16px 14px; }
  .meal-button { min-height: 52px; padding: 0 8px; }
}
@media (max-width: 390px) {
  .meal-actions { gap: 8px; }
  .meal-button { font-size: 14px; }
}
</style>
