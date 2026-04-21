<template>
  <div class="room-list-root">
    <div class="toolbar-row">
      <el-button type="primary" @click="openCheckInDialog()">办理入住</el-button>
      <el-button type="primary" :loading="overviewLoading" @click="loadOverview">立即查询</el-button>
      <el-button @click="resetOverviewQuery">重置</el-button>
      <el-button type="primary" plain @click="queryOverviewAll">查询全部</el-button>
    </div>

    <el-dialog v-model="checkInVisible" title="办理入住" width="620px" destroy-on-close>
      <p class="panel-hint">办理后写入 <code>Hr_room_in</code>；<strong>pass 自动为已审核（'1'）</strong>。</p>
      <div class="audit-switch">
        <span class="switch-label">匹配未审核的房间资料</span>
        <el-switch v-model="useUnauditedRoom" />
      </div>
      <el-form ref="formRef" :model="form" :rules="rules" label-width="120px">
        <el-form-item label="入住人员" prop="staff_code">
          <el-select
            v-model="form.staff_code"
            filterable
            remote
            clearable
            :remote-method="remoteSearchStaff"
            :loading="staffLoading"
            placeholder="输入工号或姓名搜索（仅在职/非黑名单）"
            style="width: 360px"
          >
            <el-option
              v-for="opt in staffOptions"
              :key="opt.code"
              :label="`${opt.code}${opt.name ? ' - ' + opt.name : ''}`"
              :value="opt.code"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="房间编码" prop="room_code">
          <el-input v-model="form.room_code" clearable maxlength="50" style="width: 220px" />
        </el-form-item>
        <el-form-item label="入住日期" prop="in_time">
          <el-date-picker v-model="form.in_time" type="date" value-format="YYYY-MM-DD" style="width: 220px" />
        </el-form-item>
        <el-form-item label="优惠电量" prop="electric">
          <el-input-number v-model="form.electric" :min="0" :max="999999" :step="1" controls-position="right" />
        </el-form-item>
        <el-form-item label="备注" prop="room_info">
          <el-input v-model="form.room_info" type="textarea" :rows="3" maxlength="500" show-word-limit />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="checkInVisible = false">取消</el-button>
        <el-button v-permission="'add'" type="success" :loading="submitting" @click="onSubmitCheckIn">确认办理</el-button>
      </template>
    </el-dialog>

    <div class="filter-card">
      <div class="filter-title">房间列表</div>
      <div class="filter-row">
        <span class="filter-label">设定日期</span>
        <el-input-number v-model="ovYear" :min="1990" :max="2100" controls-position="right" class="ym-input" />
        <span class="ym-sep">年</span>
        <el-input-number v-model="ovMonth" :min="1" :max="12" controls-position="right" class="ym-input" />
        <span class="ym-sep">月</span>
        <el-button type="primary" :loading="overviewLoading" @click="loadOverviewByTjDate">立即查询</el-button>
        <span class="format-hint">（入住人员/人数显示“当前在住”；电费按 Hr_room_use.tj_date 同月汇总）</span>
      </div>
      <div class="filter-row">
        <el-input v-model="ovKeyword" clearable placeholder="搜索入住宿舍：房号/楼栋/名称/房型" style="width: 320px" @keyup.enter="loadOverview" />
        <el-input v-model="ovStaffKw" clearable placeholder="搜索入住员工：工号或姓名" style="width: 260px" @keyup.enter="loadOverview" />
      </div>
    </div>

    <el-alert v-if="overviewError" :title="overviewError" type="error" show-icon class="mb-12" />

    <el-table
      v-loading="overviewLoading"
      :data="overviewList"
      border
      stripe
      class="lodging-table"
      empty-text="暂无数据"
      style="width: 100%"
      data-testid="room-list-table"
    >
      <el-table-column prop="in_lou" label="楼号" min-width="90" align="center" show-overflow-tooltip />
      <el-table-column prop="s_code" label="编码" min-width="80" align="center" show-overflow-tooltip />
      <el-table-column prop="name" label="名称" min-width="90" align="center" show-overflow-tooltip />
      <el-table-column prop="code" label="类型" min-width="90" align="center" show-overflow-tooltip />
      <el-table-column label="状态" min-width="90" align="center" show-overflow-tooltip>
        <template #default="{ row }">{{ row?.s_code1 ?? '—' }}</template>
      </el-table-column>
      <el-table-column label="入住人数" width="100" align="center">
        <template #default="{ row }">
          <span class="occ-count">{{ Number(row?.live_in_count ?? 0) }}</span>
        </template>
      </el-table-column>
      <el-table-column label="剩余床位" width="100" align="center">
        <template #default="{ row }">{{ Number(row?.remaining_beds ?? 0) }}</template>
      </el-table-column>
      <el-table-column label="入住人员" min-width="160" align="center" show-overflow-tooltip>
        <template #default="{ row }">{{ row?.occupant_names || '—' }}</template>
      </el-table-column>
      <el-table-column label="电费(汇总)" min-width="110" align="center" show-overflow-tooltip>
        <template #default="{ row }">
          {{ formatMoney(row?.c_sum_money) }}
        </template>
      </el-table-column>
      <el-table-column label="操作" width="200" align="center" fixed="right">
        <template #default="{ row }">
          <el-button v-permission="'add'" type="success" size="small" link @click="openCheckInForRoom(row)">增加入住</el-button>
          <el-button v-permission="'view'" type="primary" size="small" link @click="openOccupantsByRow(row)">入住管理</el-button>
          <el-button v-permission="'view'" type="warning" size="small" link @click="openElectricManage(row)">电费管理</el-button>
          <el-button v-permission="'audit'" type="danger" size="small" link @click="onDeleteElectric(row)">删除电费</el-button>
        </template>
      </el-table-column>
    </el-table>

    <div class="pagination-row">
      <el-pagination
        background
        layout="total, sizes, prev, pager, next, jumper"
        :total="overviewTotal"
        v-model:current-page="ovPage"
        v-model:page-size="ovPageSize"
        :page-sizes="[10, 20, 50, 100]"
        @current-change="loadOverview"
        @size-change="onOvPageSizeChange"
      />
    </div>

    <el-dialog v-model="occupantsVisible" title="入住管理" width="860px" destroy-on-close>
      <div class="toolbar-row" style="margin-bottom: 10px">
        <div style="flex: 1 1 auto">
          <span class="filter-label">房间：</span>
          <b>{{ occupantsRoomCode || '—' }}</b>
        </div>
        <el-button type="primary" plain :loading="occupantsLoading" @click="loadOccupants">刷新</el-button>
      </div>
      <el-alert v-if="occupantsError" :title="occupantsError" type="error" show-icon class="mb-12" />
      <el-table v-loading="occupantsLoading" :data="occupantsList" border stripe empty-text="暂无在住人员">
        <el-table-column prop="in_time" label="入住时间" min-width="140" align="center" show-overflow-tooltip />
        <el-table-column prop="staff_truename" label="姓名" min-width="100" align="center" show-overflow-tooltip />
        <el-table-column prop="dept_name" label="部门" min-width="140" align="center" show-overflow-tooltip />
        <el-table-column prop="electric" label="优惠电量" min-width="90" align="center" show-overflow-tooltip />
        <el-table-column label="备注" min-width="240" align="center">
          <template #default="{ row }">
            <el-input
              v-model="row.room_info"
              size="small"
              clearable
              placeholder="填写备注，失焦自动保存"
              @blur="saveRoomInfo(row)"
            />
          </template>
        </el-table-column>
        <el-table-column label="操作" width="90" align="center" fixed="right">
          <template #default="{ row }">
            <el-button type="danger" size="small" link @click="openCheckOutDialog(row)">退宿</el-button>
          </template>
        </el-table-column>
      </el-table>
      <template #footer>
        <el-button type="primary" @click="occupantsVisible = false">关闭</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="checkOutVisible" title="办理退宿" width="520px" destroy-on-close>
      <el-form :model="checkOutForm" label-width="120px">
        <el-form-item label="退宿日期">
          <el-date-picker v-model="checkOutForm.out_date" type="date" value-format="YYYY-MM-DD" style="width: 220px" />
        </el-form-item>
        <el-form-item label="退宿时间">
          <el-time-select v-model="checkOutForm.out_hm" start="00:00" step="00:30" end="23:30" style="width: 220px" />
          <span class="format-hint" style="margin-left: 10px">默认 00:00</span>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="checkOutVisible = false">取消</el-button>
        <el-button type="danger" :loading="checkOutSubmitting" @click="submitCheckOut">确认退宿</el-button>
      </template>
    </el-dialog>

    <ElectricManage
      v-model="electricVisible"
      :room-code="electricRoomCode"
      :tj-date="electricTjDate"
      @saved="onElectricSaved"
    />
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import axios from 'axios'
import { ElMessage, ElMessageBox } from 'element-plus'
import ElectricManage from './ElectricManage.vue'

const emit = defineEmits(['dorm-data-changed'])

const checkInVisible = ref(false)
const now = new Date()
const ovYear = ref(now.getFullYear())
const ovMonth = ref(now.getMonth() + 1)
const ovKeyword = ref('')
const ovStaffKw = ref('')
const ovPage = ref(1)
const ovPageSize = ref(20)
const overviewList = ref([])
const overviewTotal = ref(0)
const overviewLoading = ref(false)
const overviewError = ref('')

const useUnauditedRoom = ref(false)
const formRef = ref()
const submitting = ref(false)
const form = ref({ staff_code: '', room_code: '', in_time: '', electric: 0, room_info: '' })
const staffOptions = ref([])
const staffLoading = ref(false)
const rules = {
  staff_code: [{ required: true, message: '请选择入住人员', trigger: 'change' }],
  room_code: [{ required: true, message: '请输入房间编码', trigger: 'blur' }],
  in_time: [{ required: true, message: '请选择入住日期', trigger: 'change' }],
}

const passParam = computed(() => (useUnauditedRoom.value ? '0' : '1'))

const occupantsVisible = ref(false)
const occupantsRoomCode = ref('')
const occupantsList = ref([])
const occupantsLoading = ref(false)
const occupantsError = ref('')

const checkOutVisible = ref(false)
const checkOutSubmitting = ref(false)
const checkOutForm = ref({ id: 0, out_date: '', out_hm: '00:00' })
const roomInfoSaving = ref(new Set())

const electricVisible = ref(false)
const electricRoomCode = ref('')
const electricTjDate = ref('')

function formatMoney(v) {
  if (v == null || String(v).trim() === '') return '—'
  return `${String(v).trim()} 元`
}

async function remoteSearchStaff(keyword) {
  const kw = String(keyword ?? '').trim()
  staffLoading.value = true
  try {
    const params = kw ? { keyword: kw } : {}
    const res = await axios.get('/api/hr/dormitory/check-in/staff-options', { params })
    const body = res.data
    if (body?.code !== 200) {
      staffOptions.value = []
      return
    }
    staffOptions.value = Array.isArray(body.data) ? body.data : []
  } catch {
    staffOptions.value = []
  } finally {
    staffLoading.value = false
  }
}

function todayYmd() {
  const d = new Date()
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

function openCheckInDialog() {
  checkInVisible.value = true
  if (!form.value.in_time) form.value.in_time = todayYmd()
  formRef.value?.clearValidate?.()
}

function resetOverviewQuery() {
  const d = new Date()
  ovYear.value = d.getFullYear()
  ovMonth.value = d.getMonth() + 1
  ovKeyword.value = ''
  ovStaffKw.value = ''
  ovPage.value = 1
  loadOverview()
}

function queryOverviewAll() {
  ovKeyword.value = ''
  ovStaffKw.value = ''
  ovPage.value = 1
  loadOverview()
}

function onOvPageSizeChange() {
  ovPage.value = 1
  loadOverview()
}

async function loadOverview() {
  overviewLoading.value = true
  overviewError.value = ''
  try {
    const tjDate = `${Number(ovYear.value)}-${Number(ovMonth.value)}`
    const res = await axios.get('/api/hr/dormitory/lodging-overview', {
      params: {
        year: ovYear.value,
        month: ovMonth.value,
        tj_date: tjDate,
        page: ovPage.value,
        pageSize: ovPageSize.value,
        ...(ovKeyword.value.trim() ? { keyword: ovKeyword.value.trim() } : {}),
        ...(ovStaffKw.value.trim() ? { staffKeyword: ovStaffKw.value.trim() } : {}),
      },
    })
    const body = res.data
    if (body?.code !== 200) {
      overviewError.value = String(body?.msg ?? '加载失败')
      overviewList.value = []
      overviewTotal.value = 0
      return
    }
    const pack = body.data ?? {}
    overviewList.value = Array.isArray(pack.list) ? pack.list : []
    overviewTotal.value = Number(pack.total ?? 0)
  } catch (e) {
    overviewError.value = String(e?.response?.data?.msg ?? e?.message ?? '请求失败')
    overviewList.value = []
    overviewTotal.value = 0
  } finally {
    overviewLoading.value = false
  }
}

function loadOverviewByTjDate() {
  ovPage.value = 1
  loadOverview()
}

function openCheckInForRoom(row) {
  checkInVisible.value = true
  form.value.room_code = String(row?.s_code ?? '').trim()
  form.value.staff_code = ''
  form.value.in_time = todayYmd()
  form.value.electric = 0
  form.value.room_info = ''
  formRef.value?.clearValidate?.()
}

function openOccupantsByRow(row) {
  occupantsRoomCode.value = String(row?.s_code ?? '').trim()
  if (!occupantsRoomCode.value) {
    ElMessage.error('缺少房间编码（房号）')
    return
  }
  occupantsVisible.value = true
  loadOccupants()
}

function openElectricManage(row) {
  const rc = String(row?.s_code ?? '').trim()
  if (!rc) {
    ElMessage.error('缺少房间编码（房号）')
    return
  }
  electricRoomCode.value = rc
  electricTjDate.value = `${Number(ovYear.value)}-${Number(ovMonth.value)}`
  electricVisible.value = true
}

async function onElectricSaved() {
  await loadOverview()
  emit('dorm-data-changed')
}

async function onDeleteElectric(row) {
  const roomCode = String(row?.s_code ?? '').trim()
  if (!roomCode) {
    ElMessage.error('缺少房间编码（房号）')
    return
  }
  const tjDate = `${Number(ovYear.value)}-${Number(ovMonth.value)}`
  try {
    await ElMessageBox.confirm(
      `确认删除此房间在当前设定月份（${tjDate}）的所有电费数据吗？`,
      '删除确认',
      {
        type: 'warning',
        confirmButtonText: '确认删除',
        cancelButtonText: '取消',
        confirmButtonClass: 'el-button--danger',
      },
    )
  } catch {
    return
  }

  try {
    const res = await axios.post('/api/dorm/delete-electric', { room_code: roomCode, tj_date: tjDate })
    const body = res.data
    if (body?.code !== 200) {
      ElMessage.error(String(body?.msg ?? '删除失败'))
      return
    }
    ElMessage.success(`已删除 ${roomCode} ${tjDate} 的电费数据`)
    await loadOverview()
    emit('dorm-data-changed')
  } catch (e) {
    ElMessage.error(String(e?.response?.data?.msg ?? e?.message ?? '请求失败'))
  }
}

async function loadOccupants() {
  const rc = String(occupantsRoomCode.value ?? '').trim()
  if (!rc) return
  occupantsLoading.value = true
  occupantsError.value = ''
  try {
    const res = await axios.get('/api/hr/dormitory/room-occupants', { params: { room_code: rc } })
    const body = res.data
    if (body?.code !== 200) {
      occupantsError.value = String(body?.msg ?? '加载失败')
      occupantsList.value = []
      return
    }
    occupantsList.value = Array.isArray(body.data) ? body.data : []
  } catch (e) {
    occupantsError.value = String(e?.response?.data?.msg ?? e?.message ?? '请求失败')
    occupantsList.value = []
  } finally {
    occupantsLoading.value = false
  }
}

function openCheckOutDialog(row) {
  const id = Number(row?.id)
  if (!Number.isFinite(id) || id <= 0) {
    ElMessage.error('缺少入住记录 id')
    return
  }
  checkOutForm.value = { id, out_date: todayYmd(), out_hm: '00:00' }
  checkOutVisible.value = true
}

async function submitCheckOut() {
  const id = Number(checkOutForm.value?.id)
  const outDate = String(checkOutForm.value?.out_date ?? '').trim()
  const outHm = String(checkOutForm.value?.out_hm ?? '').trim() || '00:00'
  if (!Number.isFinite(id) || id <= 0) return
  if (!outDate) {
    ElMessage.error('请选择退宿日期')
    return
  }
  checkOutSubmitting.value = true
  try {
    const outTime = `${outDate} ${outHm}`
    const res = await axios.put('/api/hr/dormitory/check-out', { id, out_time: outTime })
    const body = res.data
    if (body?.code !== 200) {
      ElMessage.error(String(body?.msg ?? '退宿失败'))
      return
    }
    ElMessage.success('退宿成功')
    checkOutVisible.value = false
    await loadOccupants()
    await loadOverview()
    emit('dorm-data-changed')
  } catch (e) {
    ElMessage.error(String(e?.response?.data?.msg ?? e?.message ?? '请求失败'))
  } finally {
    checkOutSubmitting.value = false
  }
}

async function saveRoomInfo(row) {
  const id = Number(row?.id)
  if (!Number.isFinite(id) || id <= 0) return
  if (roomInfoSaving.value.has(id)) return
  roomInfoSaving.value.add(id)
  try {
    const room_info = row?.room_info != null ? String(row.room_info).trim() : ''
    const res = await axios.put('/api/hr/dormitory/room-in/room-info', { id, room_info })
    const body = res.data
    if (body?.code !== 200) {
      ElMessage.error(String(body?.msg ?? '保存备注失败'))
      return
    }
    ElMessage.success('备注已保存')
  } catch (e) {
    ElMessage.error(String(e?.response?.data?.msg ?? e?.message ?? '请求失败'))
  } finally {
    roomInfoSaving.value.delete(id)
  }
}

async function onSubmitCheckIn() {
  try {
    await formRef.value?.validate()
  } catch {
    return
  }
  submitting.value = true
  try {
    const res = await axios.post('/api/hr/dormitory/check-in', {
      staff_code: String(form.value.staff_code ?? '').trim(),
      room_code: String(form.value.room_code ?? '').trim(),
      pass: passParam.value,
      in_time: String(form.value.in_time ?? '').trim(),
      electric: Number(form.value.electric ?? 0),
      room_info: String(form.value.room_info ?? '').trim(),
    })
    const body = res.data
    if (body?.code !== 200) {
      ElMessage({ type: 'error', message: String(body?.msg ?? '办理失败'), duration: 8000, showClose: true })
      return
    }
    ElMessage.success('办理入住成功')
    checkInVisible.value = false
    form.value = { staff_code: '', room_code: '', in_time: todayYmd(), electric: 0, room_info: '' }
    formRef.value?.clearValidate?.()
    await loadOverview()
    emit('dorm-data-changed')
  } catch (e) {
    const msg = String(e?.response?.data?.msg ?? e?.message ?? '请求失败')
    ElMessage({ type: 'error', message: msg, duration: 8000, showClose: true })
  } finally {
    submitting.value = false
  }
}

onMounted(() => {
  loadOverview()
})

defineExpose({ loadOverview })
</script>

<style scoped>
.toolbar-row {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-bottom: 12px;
}
.panel-hint {
  margin: 0 0 8px;
  font-size: 13px;
  color: var(--el-text-color-secondary);
}
.panel-hint code {
  font-size: 12px;
}
.audit-switch {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 10px;
}
.switch-label {
  font-size: 14px;
  color: var(--el-text-color-regular);
}
.filter-card {
  margin-bottom: 12px;
  padding: 12px;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 8px;
  background: var(--el-bg-color);
}
.filter-title {
  font-weight: 600;
  margin-bottom: 10px;
}
.filter-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
  margin-bottom: 8px;
}
.filter-label {
  font-size: 14px;
  color: var(--el-text-color-regular);
}
.ym-input {
  width: 120px;
}
.ym-sep {
  margin-right: 4px;
}
.format-hint {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
.mb-12 {
  margin-bottom: 12px;
}
.pagination-row {
  display: flex;
  justify-content: flex-end;
  margin-top: 16px;
}
.occ-count {
  color: var(--el-color-danger);
  font-weight: 600;
}
.lodging-table :deep(.el-table__header th.el-table__cell) {
  text-align: center;
  background: var(--el-fill-color-light);
}
</style>
