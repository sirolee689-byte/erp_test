<template>
  <el-dialog
    v-model="visible"
    :title="`电费管理中心 - 房间 ${roomCode || '—'}`"
    width="980px"
    destroy-on-close
    align-center
  >
    <el-alert
      v-if="loadError"
      :title="loadError"
      type="error"
      show-icon
      class="mb-12"
    />

    <el-row :gutter="20">
      <el-col :span="8">
        <el-form
          :model="form"
          label-width="100px"
          label-position="left"
          class="electric-form"
        >
          <el-form-item label="统计月份">
            <el-input v-model="form.tj_date" size="default" placeholder="例如 2026-4" @change="onTjDateChange" />
          </el-form-item>
          <el-form-item label="上期读数">
            <el-input v-model="dispCStar" size="default" readonly class="readonly-input" />
          </el-form-item>
          <el-form-item v-if="isChangeMeter" label="旧表结束数">
            <el-input-number
              v-model="form.c_old_end"
              size="default"
              :min="0"
              :max="99999999"
              :step="1"
              controls-position="right"
              style="width: 100%"
            />
          </el-form-item>
          <el-form-item v-if="isChangeMeter" label="新表开始数">
            <el-input-number
              v-model="form.c_new_star"
              size="default"
              :min="0"
              :max="99999999"
              :step="1"
              controls-position="right"
              style="width: 100%"
            />
          </el-form-item>
          <el-form-item label="本期读数">
            <el-input-number
              v-model="form.c_this"
              size="default"
              :min="0"
              :max="99999999"
              :step="1"
              controls-position="right"
              style="width: 100%"
            />
          </el-form-item>
          <el-form-item label="换表">
            <el-switch v-model="isChangeMeter" />
          </el-form-item>
          <el-form-item label="用电量">
            <el-input
              v-model="dispUsedElectric"
              size="default"
              readonly
              class="readonly-input"
            />
          </el-form-item>
          <el-form-item label="单价(元)">
            <el-input-number
              v-model="form.price"
              size="default"
              :disabled="true"
              :min="0"
              :max="999999"
              :step="0.1"
              controls-position="right"
              style="width: 100%"
            />
          </el-form-item>
          <el-form-item label="合计金额">
            <el-input v-model="dispTotalMoney" size="default" readonly class="readonly-input" />
          </el-form-item>
          <el-form-item label="在住人数">
            <el-input v-model="dispOccupantCount" size="default" readonly class="readonly-input" />
          </el-form-item>
        </el-form>
      </el-col>

      <el-col :span="16">
        <div class="table-title">在住人员分摊明细</div>
        <el-table
          v-loading="loading"
          :data="shareRows"
          border
          stripe
          empty-text="暂无在住人员"
          height="360"
        >
          <el-table-column prop="staff_code" label="工号" min-width="90" align="center" show-overflow-tooltip />
          <el-table-column prop="staff_truename" label="姓名" min-width="90" align="center" show-overflow-tooltip />
          <el-table-column prop="dept_name" label="部门" min-width="140" align="center" show-overflow-tooltip />
          <el-table-column prop="stay_days" label="住宿天数" min-width="90" align="center" />
          <el-table-column prop="electric_discount" label="优惠电量" min-width="90" align="center" />
          <el-table-column label="分摊金额(元)" min-width="120" align="center">
            <template #default="{ row }">
              {{ formatMoney2(row?.share_money) }}
            </template>
          </el-table-column>
        </el-table>

        <el-alert
          :title="`计算口径：分摊金额 = (人均用电量 - 个人优惠度数) * 单价。结果向下取整。`"
          type="info"
          show-icon
          class="mt-12"
        />
      </el-col>
    </el-row>

    <template #footer>
      <el-button size="default" @click="visible = false">取消</el-button>
      <el-button
        v-permission="'add'"
        size="default"
        type="success"
        :loading="saving"
        :disabled="!roomCode"
        @click="onSave"
      >
        保存
      </el-button>
    </template>
  </el-dialog>
</template>

<script setup>
import { ref, computed, watch } from 'vue'
import axios from 'axios'
import { ElMessage } from 'element-plus'

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  roomCode: { type: String, default: '' },
  tjDate: { type: String, default: '' },
})
const emit = defineEmits(['update:modelValue', 'saved'])

const visible = computed({
  get: () => props.modelValue,
  set: (v) => emit('update:modelValue', v),
})

const loading = ref(false)
const saving = ref(false)
const loadError = ref('')

const form = ref({
  tj_date: '',
  c_star: '0',
  c_old_end: 0,
  c_new_star: 0,
  c_this: 0,
  price: 0.93,
  change: false,
})

const occupants = ref([])

const historyLoading = ref(false)

const isChangeMeter = computed({
  get: () => !!form.value.change,
  set: (v) => {
    form.value.change = !!v
  },
})

const usedElectric = computed(() => {
  const cStarNum = Number(form.value.c_star ?? 0)
  const cStar = Number.isFinite(cStarNum) && cStarNum >= 0 ? cStarNum : 0
  const cThisNum = Number(form.value.c_this ?? 0)
  const cThis = Number.isFinite(cThisNum) && cThisNum >= 0 ? cThisNum : 0

  if (!isChangeMeter.value) {
    const v = cThis - cStar
    return v >= 0 ? v : 0
  }

  const cOldEndNum = Number(form.value.c_old_end ?? 0)
  const cOldEnd = Number.isFinite(cOldEndNum) && cOldEndNum >= 0 ? cOldEndNum : 0
  const cNewStarNum = Number(form.value.c_new_star ?? 0)
  const cNewStar = Number.isFinite(cNewStarNum) && cNewStarNum >= 0 ? cNewStarNum : 0
  const v = (cOldEnd - cStar) + (cThis - cNewStar)
  return v >= 0 ? v : 0
})

const totalMoney = computed(() => {
  const v = usedElectric.value * 0.93
  return Math.round(v * 100) / 100
})

const discountTotal = computed(() => {
  return (occupants.value ?? []).reduce((sum, r) => sum + Number(r?.electric_discount ?? 0), 0)
})

const shareRows = computed(() => {
  const list = Array.isArray(occupants.value) ? occupants.value : []
  const cnt = list.length
  if (cnt <= 0) return []
  const totalDays = list.reduce((sum, r) => sum + Number(r?.stay_days ?? 0), 0)
  const denomDays = Number.isFinite(totalDays) && totalDays > 0 ? totalDays : 0
  const ele = Number(usedElectric.value ?? 0)
  const totalEle = Number.isFinite(ele) && ele > 0 ? ele : 0
  return list.map((r) => {
    const disc = Number(r?.electric_discount ?? 0)
    const discount = Number.isFinite(disc) && disc >= 0 ? disc : 0
    const days = Number(r?.stay_days ?? 0)
    const stayDays = Number.isFinite(days) && days > 0 ? days : 0
    const shareEle = denomDays > 0 ? (totalEle / denomDays) * stayDays : 0
    const billedEle = Math.max(0, shareEle - discount)
    const money = billedEle * 0.93
    const safe = Number.isFinite(money) && money >= 0 ? money : 0
    const floored = Math.floor(safe * 100) / 100
    return { ...r, share_money: floored, share_electric: shareEle }
  })
})

const dispUsedElectric = computed(() => {
  return String(usedElectric.value)
})
const dispTotalMoney = computed(() => `${String(totalMoney.value)} 元`)
const dispOccupantCount = computed(() => String((occupants.value ?? []).length))
const dispCStar = computed(() => String(form.value.c_star ?? '0'))

function formatMoney2(v) {
  const n = Number(v ?? 0)
  if (!Number.isFinite(n)) return '0.00'
  return n.toFixed(2)
}

function ymNow() {
  const d = new Date()
  return `${d.getFullYear()}-${d.getMonth() + 1}`
}

async function loadContext() {
  const rc = String(props.roomCode ?? '').trim()
  if (!rc) return
  loading.value = true
  loadError.value = ''
  try {
    const res = await axios.get('/api/hr/dormitory/electric/context', {
      params: { room_code: rc, tj_date: form.value.tj_date || undefined },
    })
    const body = res.data
    if (body?.code !== 200) {
      loadError.value = String(body?.msg ?? '加载失败')
      occupants.value = []
      // loadContext 不再回填“上期读数”，由电费历史接口统一回填 c_star
      return
    }
    const pack = body.data ?? {}
    occupants.value = Array.isArray(pack?.occupants) ? pack.occupants : []
  } catch (e) {
    loadError.value = String(e?.response?.data?.msg ?? e?.message ?? '请求失败')
    occupants.value = []
  } finally {
    loading.value = false
  }
}

async function loadElectricHistoryByMonth(tjDate) {
  const rc = String(props.roomCode ?? '').trim()
  const tj = String(tjDate ?? '').trim()
  if (!rc || !tj) return
  historyLoading.value = true
  loadError.value = ''
  try {
    const res = await axios.get('/api/dorm/get-electric-history', { params: { room_code: rc, tj_date: tj } })
    const body = res.data
    if (body?.code !== 200) {
      loadError.value = String(body?.msg ?? '加载电费历史失败')
      return
    }
    const pack = body.data ?? {}
    // 规则：月份有记录 → 回填 c_star(上期) 与 c_this(本期)
    // 月份无记录 → 上期取最近一条 c_this，本期默认 0
    form.value.c_star = String(pack?.c_star ?? pack?.fallback_last_c_this ?? form.value.c_star ?? '0')
    if (pack?.found) {
      const thisNum = Number(pack?.c_this ?? 0)
      form.value.c_this = Number.isFinite(thisNum) && thisNum >= 0 ? thisNum : 0
    } else {
      form.value.c_this = 0
    }
  } catch (e) {
    loadError.value = String(e?.response?.data?.msg ?? e?.message ?? '请求失败')
  } finally {
    historyLoading.value = false
  }
}

async function onTjDateChange() {
  // 统计月份变更：按要求调用 /api/dorm/get-electric-history，并回填读数
  await loadElectricHistoryByMonth(form.value.tj_date)
  // 同步刷新右侧在住人员（按月份过滤）
  await loadContext()
}

async function onSave() {
  const rc = String(props.roomCode ?? '').trim()
  if (!rc) return
  const tj = String(form.value.tj_date ?? '').trim()
  if (!tj) {
    ElMessage.error('请填写统计月份（例如 2026-4）')
    return
  }
  saving.value = true
  try {
    const res = await axios.post('/api/hr/dormitory/electric/settle', {
      room_code: rc,
      tj_date: tj,
      c_star: Number(form.value.c_star ?? 0),
      c_old_end: isChangeMeter.value ? Number(form.value.c_old_end ?? 0) : undefined,
      c_new_star: isChangeMeter.value ? Number(form.value.c_new_star ?? 0) : undefined,
      c_this: Number(form.value.c_this ?? 0),
      price: 0.93,
      change: isChangeMeter.value ? 1 : 0,
    })
    const body = res.data
    if (body?.code !== 200) {
      ElMessage({ type: 'error', message: String(body?.msg ?? '保存失败'), duration: 8000, showClose: true })
      return
    }
    ElMessage.success('保存成功')
    emit('saved', body.data ?? null)
    visible.value = false
  } catch (e) {
    ElMessage({ type: 'error', message: String(e?.response?.data?.msg ?? e?.message ?? '请求失败'), duration: 8000, showClose: true })
  } finally {
    saving.value = false
  }
}

watch(
  () => props.modelValue,
  async (v) => {
    if (!v) return
    form.value.tj_date = String(props.tjDate ?? '').trim() || ymNow()
    form.value.price = 0.93
    form.value.c_star = '0'
    form.value.c_old_end = 0
    form.value.c_new_star = 0
    form.value.c_this = 0
    form.value.change = false
    await loadContext()
    await loadElectricHistoryByMonth(form.value.tj_date)
  },
)

watch(
  () => props.roomCode,
  async () => {
    if (!props.modelValue) return
    await loadContext()
    await loadElectricHistoryByMonth(form.value.tj_date)
  },
)

watch(
  () => isChangeMeter.value,
  (v) => {
    if (v) return
    // 关闭换表：隐藏并清空旧表/新表字段
    form.value.c_old_end = 0
    form.value.c_new_star = 0
  },
)
</script>

<style scoped>
.mb-12 {
  margin-bottom: 12px;
}
.mt-12 {
  margin-top: 12px;
}
.table-title {
  font-weight: 600;
  margin: 2px 0 10px;
}
.readonly-input :deep(.el-input__wrapper) {
  background: #f2f3f5;
}
</style>

