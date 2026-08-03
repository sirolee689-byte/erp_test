<template>
  <div v-loading="loading" class="erp-module-page">
    <div class="module-tabs">
      <el-button :type="activePanel === 'system' ? 'primary' : 'default'" @click="activePanel = 'system'">系统配置</el-button>
      <el-button :type="activePanel === 'report' ? 'primary' : 'default'" @click="activePanel = 'report'">报餐配置</el-button>
      <el-button :type="activePanel === 'exception' ? 'primary' : 'default'" @click="activePanel = 'exception'">特定设置</el-button>
    </div>

    <template v-if="activePanel === 'system'">
      <el-card class="section" shadow="never">
        <template #header>
          <div class="card-header">
            <span>打卡时间设置</span>
            <el-button type="primary" @click="saveConfig">保存时间设置</el-button>
          </div>
        </template>
        <div class="time-settings">
          <div class="time-row">
            <span class="meal-label">午餐打卡</span>
            <span>开始时间</span>
            <el-input v-model="config.two1" class="time-input" maxlength="5" />
            <span>结束时间</span>
            <el-input v-model="config.two2" class="time-input" maxlength="5" />
          </div>
          <div class="time-row">
            <span class="meal-label">晚餐打卡</span>
            <span>开始时间</span>
            <el-input v-model="config.three1" class="time-input" maxlength="5" />
            <span>结束时间</span>
            <el-input v-model="config.three2" class="time-input" maxlength="5" />
          </div>
          <div class="config-actions">
            <span class="meal-label">报餐截止</span>
            <span>截止时间</span>
            <el-input v-model="config.bc" class="time-input" maxlength="5" />
          </div>
        </div>
      </el-card>

      <el-card class="section" shadow="never">
        <template #header>
          <div class="card-header">
            <span>打卡授权 IP</span>
            <el-button type="primary" @click="open('machine')">新增授权 IP</el-button>
          </div>
        </template>
        <el-table :data="data.machines" border>
          <el-table-column prop="px" label="窗口序号" width="120" />
          <el-table-column prop="name" label="窗口名称" min-width="180" />
          <el-table-column prop="ip" label="授权 IP" min-width="180" />
          <el-table-column label="操作" width="150" align="center">
            <template #default="scope">
              <el-button link type="primary" @click="open('machine', scope.row)">编辑</el-button>
              <el-button link type="danger" @click="remove('machine', scope.row)">删除</el-button>
            </template>
          </el-table-column>
        </el-table>
      </el-card>
    </template>

    <el-card v-else-if="activePanel === 'report'" class="section" shadow="never">
      <template #header>
        <div class="card-header">
          <span>报餐配置</span>
          <div class="report-actions">
            <el-date-picker v-model="selectedMonth" type="month" value-format="YYYYMM" format="YYYYMM" :clearable="false" />
            <el-button v-if="!monthPrepared" type="primary" @click="prepareMonth">生成本月默认规则</el-button>
            <el-button v-else type="primary" @click="open('block')">新增特殊日期</el-button>
            <el-button v-if="monthPrepared && isSuperAdmin" type="danger" plain @click="removeMonth">删除本月准备</el-button>
          </div>
        </div>
      </template>
      <p class="hint">
        <template v-if="monthPrepared">{{ selectedMonth }} 已准备：工作日默认可报餐，周六日默认不可报餐。特殊日期可覆盖默认规则。</template>
        <template v-else>{{ selectedMonth }} 尚未准备，员工不能报餐。请先生成本月默认规则。</template>
      </p>
      <table class="report-tree-table">
        <thead><tr><th>年份月份</th><th>特殊日期</th><th>报餐状态</th><th>操作</th></tr></thead>
        <tbody>
          <tr v-for="row in visibleReportRows" :key="row.rowKey" :class="{ 'report-tree-parent': row.rowType === 'month' }">
            <td>
              <button v-if="row.rowType === 'month'" type="button" class="tree-toggle" @click="toggleMonth(row.month_key)">{{ expandedMonthKeys.has(row.month_key) ? '▼' : '▶' }}</button>
              <span :class="{ 'tree-child-cell': row.rowType === 'block' }">{{ row.month_key }}</span>
            </td>
            <td>{{ row.rowType === 'month' ? '本月默认：工作日可报餐，周六日不可报餐' : formatDateRange(row.start_date, row.end_date) }}</td>
            <td><el-tag :type="row.rowType === 'month' ? 'info' : row.report_status === 'allowed' ? 'success' : 'danger'">{{ row.rowType === 'month' ? '已准备' : row.report_status === 'allowed' ? '可报餐' : '不可报餐' }}</el-tag></td>
            <td>
              <template v-if="row.rowType === 'month'"><el-button v-if="isSuperAdmin" link type="danger" @click="removeMonth(row.month_key)">删除月份</el-button></template>
              <template v-else><el-button link @click="open('block', row)">编辑</el-button><el-button v-if="isSuperAdmin" link type="danger" @click="remove('block', row)">删除</el-button></template>
            </td>
          </tr>
          <tr v-if="!visibleReportRows.length"><td colspan="4" class="report-tree-empty">暂无已准备月份</td></tr>
        </tbody>
      </table>
    </el-card>

    <el-card v-else class="section" shadow="never">
      <template #header>
        <div class="card-header">
          <span>开放例外</span>
          <el-button type="primary" @click="open('exception')">新增</el-button>
        </div>
      </template>
      <p class="hint">常设开放在所有禁报日可报餐；临时开放仅在设定日期生效。</p>
      <el-table :data="data.exceptions" border>
        <el-table-column label="类型" width="120"><template #default="scope">{{ scope.row.rule_type === 'permanent' ? '常设' : '临时' }}</template></el-table-column>
        <el-table-column prop="target_name" label="对象" min-width="180" />
        <el-table-column label="日期" min-width="200"><template #default="scope">{{ scope.row.rule_type === 'permanent' ? '所有禁报日' : `${scope.row.start_date} 至 ${scope.row.end_date}` }}</template></el-table-column>
        <el-table-column label="操作" width="150" align="center"><template #default="scope"><el-button link @click="open('exception', scope.row)">编辑</el-button><el-button link type="danger" @click="remove('exception', scope.row)">删除</el-button></template></el-table-column>
      </el-table>
    </el-card>

    <el-dialog v-model="dialog.show" :title="dialog.title" width="460px">
      <el-form label-width="90px">
        <template v-if="dialog.kind === 'machine'">
          <el-form-item label="窗口序号"><el-input v-model="form.px" /></el-form-item>
          <el-form-item label="窗口名称"><el-input v-model="form.name" /></el-form-item>
          <el-form-item label="授权 IP"><el-input v-model="form.ip" /></el-form-item>
        </template>
        <template v-else-if="dialog.kind === 'block'">
          <el-form-item label="开始日期"><el-date-picker v-model="form.startDate" type="date" value-format="YYYY-MM-DD" :clearable="false" /></el-form-item>
          <el-form-item label="结束日期"><el-date-picker v-model="form.endDate" type="date" value-format="YYYY-MM-DD" :clearable="false" /></el-form-item>
          <el-form-item label="报餐状态"><el-radio-group v-model="form.reportStatus"><el-radio value="allowed">可报餐</el-radio><el-radio value="blocked">不可报餐</el-radio></el-radio-group></el-form-item>
        </template>
        <template v-else>
          <el-form-item label="规则"><el-radio-group v-model="form.ruleType"><el-radio value="permanent">常设开放</el-radio><el-radio value="temporary">临时开放</el-radio></el-radio-group></el-form-item>
          <el-form-item label="对象"><el-radio-group v-model="form.targetType"><el-radio value="department">部门</el-radio><el-radio value="staff">员工</el-radio></el-radio-group></el-form-item>
          <el-form-item label="选择"><el-select v-model="form.targetKey" filterable @change="targetChanged"><el-option v-for="item in options" :key="item.value" :value="item.value" :label="item.label" /></el-select></el-form-item>
          <template v-if="form.ruleType === 'temporary'">
            <el-form-item label="开始日期"><el-date-picker v-model="form.startDate" type="date" value-format="YYYY-MM-DD" :clearable="false" /></el-form-item>
            <el-form-item label="结束日期"><el-date-picker v-model="form.endDate" type="date" value-format="YYYY-MM-DD" :clearable="false" /></el-form-item>
          </template>
        </template>
        <el-form-item label="备注"><el-input v-model="form.remark" /></el-form-item>
      </el-form>
      <template #footer><el-button @click="dialog.show = false">取消</el-button><el-button type="primary" @click="submit">保存</el-button></template>
    </el-dialog>
  </div>
</template>

<script setup>
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import * as api from '@/api/diningManagementApi'
import { isErpSuperAdmin } from '@/utils/erpSuperAdmin'

const activePanel = ref('system')
const loading = ref(false)
const data = reactive({ machines: [], reportMonths: [], blocks: [], exceptions: [] })
const config = reactive({ bc: '', two1: '', two2: '', three1: '', three2: '' })
function currentMonthKey() {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit' }).formatToParts(new Date())
  const values = Object.fromEntries(parts.map((item) => [item.type, item.value]))
  return `${values.year}${values.month}`
}

const selectedMonth = ref(currentMonthKey())
const isSuperAdmin = computed(() => isErpSuperAdmin())
const monthPrepared = computed(() => data.reportMonths.some((item) => item.month_key === selectedMonth.value && item.enabled === '1'))
const expandedMonthKeys = ref(new Set())
const visibleReportRows = computed(() => {
  const blocksByMonth = new Map()
  for (const block of data.blocks) {
    const rows = blocksByMonth.get(block.month_key) || []
    rows.push(block)
    blocksByMonth.set(block.month_key, rows)
  }
  const rows = []
  for (const month of data.reportMonths) {
    if (month.enabled !== '1') continue
    rows.push({ ...month, rowKey: `month-${month.month_key}`, rowType: 'month' })
    if (expandedMonthKeys.value.has(month.month_key)) {
      for (const block of blocksByMonth.get(month.month_key) || []) rows.push({ ...block, rowKey: `block-${block.id}`, rowType: 'block' })
    }
  }
  return rows
})
const targets = reactive({ departments: [], staff: [] })
const dialog = reactive({ show: false, kind: '', id: null, title: '' })
const form = reactive({})
const options = computed(() => form.targetType === 'staff' ? targets.staff : targets.departments)

function formatTime(value) {
  return String(value || '').trim().slice(0, 5)
}

async function load() {
  loading.value = true
  try {
    const [management, targetResult] = await Promise.all([api.getDiningManagement(selectedMonth.value), api.getDiningManagementTargets()])
    Object.assign(data, management.data.data)
    expandedMonthKeys.value = new Set(data.reportMonths.filter((item) => item.enabled === '1').map((item) => item.month_key))
    Object.assign(config, management.data.data.config)
    config.bc = formatTime(config.bc)
    config.two1 = formatTime(config.two1)
    config.two2 = formatTime(config.two2)
    config.three1 = formatTime(config.three1)
    config.three2 = formatTime(config.three2)
    Object.assign(targets, targetResult.data.data)
  } finally {
    loading.value = false
  }
}

function reset(input = {}) {
  Object.keys(form).forEach(key => delete form[key])
  Object.assign(form, { remark: '', ...input })
}

function open(kind, row) {
  dialog.show = true
  dialog.kind = kind
  dialog.id = row?.id || null
  dialog.title = row ? '编辑' : '新增'
  reset(row
    ? { ...row, ruleType: row.rule_type, targetType: row.target_type, targetKey: row.target_key, targetName: row.target_name, startDate: row.start_date, endDate: row.end_date }
    : kind === 'block'
      ? { monthKey: selectedMonth.value, reportStatus: 'blocked', startDate: '', endDate: '' }
      : { ruleType: 'permanent', targetType: 'department', startDate: '', endDate: '' })
}

function targetChanged(value) {
  form.targetName = options.value.find(item => item.value === value)?.label || ''
}

async function saveConfig() {
  await api.saveDiningConfig(config)
  ElMessage.success('保存成功')
}

async function submit() {
  const payload = { ...form }
  const actions = { machine: [api.addDiningMachine, api.updateDiningMachine], block: [api.addDiningBlock, api.updateDiningBlock], exception: [api.addDiningException, api.updateDiningException] }[dialog.kind]
  await (dialog.id ? actions[1](dialog.id, payload) : actions[0](payload))
  dialog.show = false
  await load()
  ElMessage.success('保存成功')
}

function formatDateRange(start, end) {
  return start === end ? start : `${start} 至 ${end}`
}

async function prepareMonth() {
  await ElMessageBox.confirm(`确认生成 ${selectedMonth.value} 的默认规则吗？生成后工作日可报餐、周六日不可报餐。`, '生成本月默认规则', { type: 'warning' })
  await api.prepareDiningReportMonth(selectedMonth.value)
  await load()
  ElMessage.success('本月默认规则已生成')
}

async function removeMonth(monthKey = selectedMonth.value) {
  await ElMessageBox.confirm(`删除 ${monthKey} 的月份准备后，该月员工都不能报餐，且其全部特殊日期会一并删除。是否继续？`, '确认删除', { type: 'warning' })
  await api.deleteDiningReportMonth(monthKey)
  await load()
  ElMessage.success('已删除本月准备')
}

function toggleMonth(monthKey) {
  const next = new Set(expandedMonthKeys.value)
  if (next.has(monthKey)) next.delete(monthKey)
  else next.add(monthKey)
  expandedMonthKeys.value = next
}

async function remove(kind, row) {
  await ElMessageBox.confirm('删除后立即失效，是否继续？', '确认删除')
  const actions = { machine: api.deleteDiningMachine, block: api.deleteDiningBlock, exception: api.deleteDiningException }
  await actions[kind](row.id)
  await load()
  ElMessage.success('删除成功')
}

onMounted(load)
watch(selectedMonth, load)
</script>

<style scoped>
.erp-module-page { padding: 16px; }
.module-tabs { display: flex; gap: 10px; margin-bottom: 16px; }
.section { margin-bottom: 16px; }
.card-header { display: flex; align-items: center; justify-content: space-between; }
.report-actions { display: flex; align-items: center; gap: 10px; }
.report-tree-table { width: 100%; border-collapse: collapse; color: var(--el-text-color-regular); }
.report-tree-table th, .report-tree-table td { height: 48px; padding: 0 12px; border: 1px solid var(--el-border-color-lighter); text-align: left; }
.report-tree-table th { color: var(--el-text-color-primary); background: var(--el-fill-color-light); font-weight: 600; }
.report-tree-parent td { background: #f8fbff; font-weight: 600; }
.tree-toggle { width: 25px; padding: 0; border: 0; color: var(--el-color-primary); background: transparent; font: inherit; cursor: pointer; }
.tree-child-cell { padding-left: 25px; }
.report-tree-empty { color: var(--el-text-color-secondary); text-align: center !important; }
.time-settings { padding: 4px 8px; }
.time-row { display: flex; align-items: center; gap: 12px; margin-bottom: 14px; color: #111; }
.meal-label { width: 64px; }
.time-input { width: 86px; }
.time-input :deep(.el-input__wrapper) { min-height: 46px; padding: 0 10px; border: 1px solid #7d7d7d; border-radius: 2px; background: #fff; box-shadow: none; }
.time-input :deep(.el-input__inner) { color: #111; font-size: 26px; line-height: 44px; }
.config-actions { display: flex; align-items: center; gap: 12px; }
.hint { margin: 0 0 12px; color: var(--el-text-color-secondary); font-size: 13px; }
</style>
