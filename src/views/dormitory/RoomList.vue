<template>
  <div class="room-list-root">
    <el-dialog v-model="checkInVisible" title="办理入住" width="620px" destroy-on-close>
      <p class="panel-hint">办理后写入 <code>UB_ERP_Hr_room_in</code>，房间容量会立即重新汇总。</p>
      <el-form ref="formRef" :model="form" :rules="rules" label-width="120px">
        <el-form-item label="入住人员" prop="staff_systemcode">
          <el-select
            v-model="form.staff_systemcode"
            filterable
            remote
            clearable
            :remote-method="remoteSearchStaff"
            @change="onStaffSelected"
            :loading="staffLoading"
            placeholder="输入工号或姓名搜索（仅在职/非黑名单）"
            style="width: 360px"
          >
            <el-option
              v-for="opt in staffOptions"
              :key="opt.systemcode"
              :label="`${opt.code}${opt.name ? ' - ' + opt.name : ''}`"
              :value="opt.systemcode"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="部门">
          <el-input v-model="form.staff_department" disabled style="width: 360px" />
        </el-form-item>
        <el-form-item label="房间编码" prop="room_code">
          <el-input v-model="form.room_code" clearable maxlength="50" style="width: 220px" />
        </el-form-item>
        <el-form-item label="入住时间" prop="in_time">
          <el-date-picker v-model="form.in_time" type="date" value-format="YYYY-MM-DD" style="width: 220px" />
          <el-time-select v-model="form.in_hm" start="00:00" step="00:30" end="23:30" style="width: 130px; margin-left: 12px" />
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
      </div>
      <div class="filter-row">
        <el-input v-model="ovKeyword" clearable placeholder="搜索入住宿舍：房号/楼栋/名称/房型" style="width: 320px" @keyup.enter="loadOverview" />
        <el-input v-model="ovStaffKw" clearable placeholder="搜索入住员工：工号或姓名" style="width: 260px" @keyup.enter="loadOverview" />
        <el-button v-permission="'add'" type="warning" @click="openElectricBatch">一键录入（电费）</el-button>
      </div>
    </div>

    <el-alert v-if="overviewError" :title="overviewError" type="error" show-icon class="mb-12" />

    <div class="pagination-row pagination-row--top">
      <el-pagination
        background
        layout="total, sizes, prev, pager, next, jumper"
        :total="overviewTotal"
        v-model:current-page="ovPage"
        v-model:page-size="ovPageSize"
        :page-sizes="ERP_PAGE_SIZE_OPTIONS"
        @current-change="loadOverview"
        @size-change="onOvPageSizeChange"
      />
    </div>

    <el-table
      v-loading="overviewLoading"
      :data="overviewList"
      border
      stripe
      v-erp-list-h-scroll
      class="lodging-table erp-list-table"
      empty-text="暂无数据"
      style="width: 100%"
     data-testid="room-list-table"
     @row-contextmenu="onErpListRowContextMenu">
      <el-table-column label="操作" :width="roomListActionsColWidth" align="center" fixed="left" class-name="erp-col-actions">
        <template #default="{ row }">
          <ErpTableActions>
            <el-button v-permission="'add'" type="success" plain @click="openCheckInForRoom(row)">增加入住</el-button>
            <el-button v-permission="'view'" type="info" plain @click="openOccupantsByRow(row)">入住管理</el-button>
            <el-button v-permission="'view'" type="warning" plain @click="openElectricManage(row)">电费管理</el-button>
            <el-button v-permission="'audit'" type="danger" plain @click="onDeleteElectric(row)">删除电费</el-button>
          </ErpTableActions>
        </template>
      </el-table-column>
      <el-table-column prop="s_code" label="房号" min-width="80" align="center" show-overflow-tooltip />
      <el-table-column label="入住人员" min-width="220" align="center" show-overflow-tooltip>
        <template #default="{ row }">{{ row?.occupant_names || '—' }}</template>
      </el-table-column>
      <el-table-column label="入住人数" width="90" align="center">
        <template #default="{ row }">
          <span class="occ-count">{{ Number(row?.live_in_count ?? 0) }}</span>
        </template>
      </el-table-column>
      <el-table-column label="剩余床位" width="90" align="center">
        <template #default="{ row }">{{ Number(row?.remaining_beds ?? 0) }}</template>
      </el-table-column>
      <el-table-column :label="electricColumnLabel" min-width="100" align="center" show-overflow-tooltip>
        <template #default="{ row }">
          {{ formatMoney(row?.c_sum_money) }}
        </template>
      </el-table-column>
      <el-table-column prop="in_lou" label="楼号" min-width="90" align="center" show-overflow-tooltip />
      <el-table-column prop="name" label="名称" min-width="90" align="center" show-overflow-tooltip />
      <el-table-column prop="code" label="类型" min-width="90" align="center" show-overflow-tooltip />
      <el-table-column label="状态" min-width="90" align="center" show-overflow-tooltip>
        <template #default="{ row }">{{ row?.s_code1 ?? '—' }}</template>
      </el-table-column>
    </el-table>

    <div class="pagination-row pagination-row--bottom">
      <el-pagination
        background
        layout="total, sizes, prev, pager, next, jumper"
        :total="overviewTotal"
        v-model:current-page="ovPage"
        v-model:page-size="ovPageSize"
        :page-sizes="ERP_PAGE_SIZE_OPTIONS"
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

    <el-dialog
      v-model="batchElectricVisible"
      title="一键录入（电费）"
      width="780px"
      destroy-on-close
      @closed="resetElectricBatch"
    >
      <el-alert
        type="info"
        show-icon
        :closable="false"
        class="mb-12"
        title="模板说明：Excel 第 1 个工作表，A 列为房号，B 列为上期读数，C 列为本期读数（第一行可为表头）。"
      />
      <div class="filter-row">
        <span class="filter-label">录入月份</span>
        <el-input-number v-model="batchYear" :min="1990" :max="2100" controls-position="right" class="ym-input" />
        <span class="ym-sep">年</span>
        <el-input-number v-model="batchMonth" :min="1" :max="12" controls-position="right" class="ym-input" />
        <span class="ym-sep">月</span>
      </div>
      <el-upload
        class="batch-electric-upload"
        :class="{ 'is-file-ready': !!batchFileName }"
        drag
        :auto-upload="false"
        :limit="1"
        accept=".xlsx,.xls"
        :show-file-list="false"
        :on-change="onBatchFileChange"
        :on-remove="onBatchFileRemove"
        :on-exceed="onBatchFileExceed"
        :file-list="batchFileList"
      >
        <!-- 已选文件时换文案，避免拖拽区仍像空着 -->
        <div v-if="batchFileName" class="batch-upload-ready">
          <div class="batch-upload-ready__mark">✓</div>
          <div class="batch-upload-ready__name" :title="batchFileName">{{ batchFileName }}</div>
          <div class="batch-upload-ready__hint">已选择，点击此处可重新选择文件</div>
          <el-button type="danger" link @click.stop="onBatchFileRemove">清除</el-button>
        </div>
        <div v-else class="el-upload__text">将 Excel 拖到此处，或<em>点击上传</em></div>
        <template #tip>
          <div class="el-upload__tip">仅支持 .xlsx / .xls；上传后点「解析预览」查看结果，确认后再写入。</div>
        </template>
      </el-upload>
      <div class="toolbar-row" style="margin-top: 8px">
        <el-button type="primary" :loading="batchPreviewLoading" :disabled="!batchFileBase64" @click="runBatchPreview">
          解析预览
        </el-button>
        <span v-if="batchSummaryText" class="format-hint">{{ batchSummaryText }}</span>
      </div>
      <el-alert v-if="batchError" :title="batchError" type="error" show-icon class="mb-12" style="margin-top: 10px" />
      <el-table
        v-if="batchPreviewRows.length"
        :data="batchPreviewRows"
        border
        stripe
        max-height="320"
        empty-text="暂无解析结果"
        style="width: 100%; margin-top: 10px"
      >
        <el-table-column prop="excelRow" label="行号" width="70" align="center" />
        <el-table-column prop="room_code" label="房号" min-width="90" align="center" show-overflow-tooltip />
        <el-table-column prop="c_star" label="上期读数" min-width="90" align="center" />
        <el-table-column prop="c_this" label="本期读数" min-width="90" align="center" />
        <el-table-column label="结果" width="90" align="center">
          <template #default="{ row }">
            <el-tag v-if="row.status === 'ok'" type="success" size="small">可导入</el-tag>
            <el-tag v-else-if="row.status === 'overwrite'" type="warning" size="small">将覆盖</el-tag>
            <el-tag v-else type="info" size="small">跳过</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="reason" label="说明" min-width="220" show-overflow-tooltip />
      </el-table>
      <template #footer>
        <el-button @click="batchElectricVisible = false">取消</el-button>
        <el-button
          type="danger"
          :loading="batchImportLoading"
          :disabled="!batchCanImport"
          @click="confirmBatchImport"
        >
          确认导入
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { useErpListRowContextMenu } from '@/composables/useErpListRowContextMenu'
import { ERP_PAGE_SIZE_OPTIONS } from '@/utils/erpPagination'
import { ref, computed, onMounted, watch } from 'vue'
import axios from 'axios'
import { ElMessage, ElMessageBox } from 'element-plus'
import ElectricManage from './ElectricManage.vue'
import { getErpTableActionsColWidthByRows } from '@/utils/erpTableActionsLayout'
import { getPermissionModelFromStorage, hasPageAction } from '@/utils/menuPermission'
const { onErpListRowContextMenu } = useErpListRowContextMenu()

const menuPath = 'hr/dormitory/lodging-records'
const model = getPermissionModelFromStorage()

const roomListActionsColWidth = computed(() => getErpTableActionsColWidthByRows(overviewList.value, getRoomListRowActionLabels, { compact: true }))

/** 房间列表主表操作列按钮：与模板 v-permission 保持一致，用于估算列宽 */
function getRoomListRowActionLabels() {
  const labels = []
  if (hasPageAction(model, menuPath, 'add')) labels.push('增加入住')
  if (hasPageAction(model, menuPath, 'view')) labels.push('入住管理')
  if (hasPageAction(model, menuPath, 'view')) labels.push('电费管理')
  if (hasPageAction(model, menuPath, 'audit')) labels.push('删除电费')
  return labels
}

const emit = defineEmits(['dorm-data-changed'])

const checkInVisible = ref(false)
const now = new Date()
const ovYear = ref(now.getFullYear())
const ovMonth = ref(now.getMonth() + 1)
const ovKeyword = ref('')
const ovStaffKw = ref('')
const ovPage = ref(1)
const ovPageSize = ref(20)
const electricColumnLabel = computed(() => `${Number(ovYear.value)}年${Number(ovMonth.value)}月,电费`)
const overviewList = ref([])
const overviewTotal = ref(0)
const overviewLoading = ref(false)
const overviewError = ref('')

const formRef = ref()
const submitting = ref(false)
const form = ref({ staff_systemcode: '', staff_department: '', room_code: '', room_systemcode: '', in_time: '', in_hm: '00:00', electric: 15, room_info: '' })
const staffOptions = ref([])
const staffLoading = ref(false)
const rules = {
  staff_systemcode: [{ required: true, message: '请选择入住人员', trigger: 'change' }],
  room_code: [{ required: true, message: '请输入房间编码', trigger: 'blur' }],
  in_time: [{ required: true, message: '请选择入住日期', trigger: 'change' }],
}

const passParam = computed(() => '1')

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

const batchElectricVisible = ref(false)
const batchYear = ref(now.getFullYear())
const batchMonth = ref(now.getMonth() + 1)
const batchFileList = ref([])
const batchFileName = ref('')
const batchFileBase64 = ref('')
const batchPreviewLoading = ref(false)
const batchImportLoading = ref(false)
const batchError = ref('')
const batchPreviewRows = ref([])
const batchSummary = ref(null)

const batchCanImport = computed(() => {
  return (batchPreviewRows.value ?? []).some((r) => r.status === 'ok' || r.status === 'overwrite')
})
const batchSummaryText = computed(() => {
  const s = batchSummary.value
  if (!s) return ''
  return `合计 ${s.total} 行：可导入 ${s.ok}，将覆盖 ${s.overwrite}，跳过 ${s.skip}`
})

watch([batchYear, batchMonth], () => {
  // 改月份后旧预览失效，须重新点「解析预览」
  batchPreviewRows.value = []
  batchSummary.value = null
})

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

function onStaffSelected(systemcode) {
  const selected = staffOptions.value.find((item) => String(item?.systemcode ?? '').trim() === String(systemcode ?? '').trim())
  form.value.staff_department = String(selected?.department ?? '').trim()
}

function buildCheckInTime() {
  const date = String(form.value.in_time ?? '').trim()
  const hm = String(form.value.in_hm ?? '').trim() || '00:00'
  return date ? `${date} ${hm}` : ''
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
  form.value.staff_systemcode = ''
  form.value.staff_department = ''
  form.value.room_systemcode = String(row?.systemcode ?? '').trim()
  form.value.in_time = todayYmd()
  form.value.in_hm = '00:00'
  form.value.electric = 15
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

function openElectricBatch() {
  batchYear.value = Number(ovYear.value)
  batchMonth.value = Number(ovMonth.value)
  resetElectricBatch()
  batchElectricVisible.value = true
}

function resetElectricBatch() {
  batchFileList.value = []
  batchFileName.value = ''
  batchFileBase64.value = ''
  batchError.value = ''
  batchPreviewRows.value = []
  batchSummary.value = null
  batchPreviewLoading.value = false
  batchImportLoading.value = false
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = String(reader.result ?? '')
      const comma = result.indexOf(',')
      resolve(comma >= 0 ? result.slice(comma + 1) : result)
    }
    reader.onerror = () => reject(reader.error || new Error('读取文件失败'))
    reader.readAsDataURL(file)
  })
}

async function onBatchFileChange(uploadFile) {
  batchError.value = ''
  batchPreviewRows.value = []
  batchSummary.value = null
  const raw = uploadFile?.raw
  if (!raw) {
    batchFileList.value = []
    batchFileName.value = ''
    batchFileBase64.value = ''
    return
  }
  const name = String(uploadFile?.name ?? raw.name ?? '').trim()
  if (!/\.(xlsx|xls)$/i.test(name)) {
    batchError.value = '仅支持上传 xlsx 或 xls 文件'
    batchFileList.value = []
    batchFileName.value = ''
    batchFileBase64.value = ''
    return
  }
  try {
    batchFileBase64.value = await fileToBase64(raw)
    batchFileName.value = name
    batchFileList.value = [uploadFile]
  } catch (e) {
    batchError.value = String(e?.message ?? '读取文件失败')
    batchFileList.value = []
    batchFileName.value = ''
    batchFileBase64.value = ''
  }
}

function onBatchFileRemove() {
  batchFileList.value = []
  batchFileName.value = ''
  batchFileBase64.value = ''
  batchPreviewRows.value = []
  batchSummary.value = null
  batchError.value = ''
}

/** 清除按钮：与上传组件 remove 同一套清空逻辑 */
function clearBatchFile() {
  onBatchFileRemove()
}

/** 已有文件时再选：超限则用新文件替换，保证「点击可重新选择」可用 */
async function onBatchFileExceed(files) {
  const file = files?.[0]
  if (!file) return
  await onBatchFileChange({ name: file.name, raw: file })
}

async function runBatchPreview() {
  if (!batchFileBase64.value) {
    ElMessage.warning('请先上传 Excel')
    return
  }
  batchPreviewLoading.value = true
  batchError.value = ''
  try {
    const tjDate = `${Number(batchYear.value)}-${Number(batchMonth.value)}`
    const res = await axios.post('/api/hr/dormitory/electric/batch-preview', {
      tj_date: tjDate,
      fileName: batchFileName.value,
      fileBase64: batchFileBase64.value,
    })
    const body = res.data
    if (body?.code !== 200) {
      batchError.value = String(body?.msg ?? '解析失败')
      batchPreviewRows.value = []
      batchSummary.value = null
      return
    }
    const pack = body.data ?? {}
    batchPreviewRows.value = Array.isArray(pack.rows) ? pack.rows : []
    batchSummary.value = pack.summary ?? null
    if ((pack.summary?.overwrite ?? 0) > 0) {
      ElMessage.warning(`有 ${pack.summary.overwrite} 行该月已有电费，确认导入将覆盖`)
    } else {
      ElMessage.success('解析完成')
    }
  } catch (e) {
    batchError.value = String(e?.response?.data?.msg ?? e?.message ?? '请求失败')
    batchPreviewRows.value = []
    batchSummary.value = null
  } finally {
    batchPreviewLoading.value = false
  }
}

async function confirmBatchImport() {
  if (!batchCanImport.value) {
    ElMessage.warning('没有可导入的行')
    return
  }
  const overwriteCnt = (batchPreviewRows.value ?? []).filter((r) => r.status === 'overwrite').length
  const okCnt = (batchPreviewRows.value ?? []).filter((r) => r.status === 'ok').length
  try {
    await ElMessageBox.confirm(
      overwriteCnt > 0
        ? `将导入 ${okCnt + overwriteCnt} 行（其中 ${overwriteCnt} 行覆盖已有电费）。跳过行不会写入。是否继续？`
        : `将导入 ${okCnt} 行电费数据。跳过行不会写入。是否继续？`,
      '确认导入',
      {
        type: 'warning',
        confirmButtonText: '确认导入',
        cancelButtonText: '取消',
      },
    )
  } catch {
    return
  }

  batchImportLoading.value = true
  batchError.value = ''
  try {
    const tjDate = `${Number(batchYear.value)}-${Number(batchMonth.value)}`
    const res = await axios.post('/api/hr/dormitory/electric/batch-import', {
      tj_date: tjDate,
      fileName: batchFileName.value,
      fileBase64: batchFileBase64.value,
    })
    const body = res.data
    if (body?.code !== 200) {
      batchError.value = String(body?.msg ?? '导入失败')
      return
    }
    const pack = body.data ?? {}
    const failed = Number(pack.failed_count ?? 0)
    const imported = Number(pack.imported_count ?? 0)
    if (failed > 0) {
      ElMessage.warning(`已导入 ${imported} 行，失败 ${failed} 行`)
    } else {
      ElMessage.success(`已导入 ${imported} 行电费`)
    }
    batchElectricVisible.value = false
    await loadOverview()
    emit('dorm-data-changed')
  } catch (e) {
    batchError.value = String(e?.response?.data?.msg ?? e?.message ?? '请求失败')
  } finally {
    batchImportLoading.value = false
  }
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
      staff_systemcode: String(form.value.staff_systemcode ?? '').trim(),
      room_code: String(form.value.room_code ?? '').trim(),
      room_systemcode: String(form.value.room_systemcode ?? '').trim(),
      pass: passParam.value,
      in_time: buildCheckInTime(),
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
    form.value = { staff_systemcode: '', staff_department: '', room_code: '', room_systemcode: '', in_time: todayYmd(), in_hm: '00:00', electric: 15, room_info: '' }
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
.occ-count {
  color: var(--el-color-danger);
  font-weight: 600;
}
.lodging-table :deep(.el-table__header th.el-table__cell) {
  text-align: center;
  background: var(--el-fill-color-light);
}
/* DIY：一键录入上传区已选文件态 */
.batch-electric-upload.is-file-ready :deep(.el-upload-dragger) {
  border-color: var(--el-color-success);
  background: var(--el-color-success-light-9);
}
.batch-upload-ready {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 8px 12px;
  min-height: 80px;
}
.batch-upload-ready__mark {
  /* DIY：已选勾号字号，常见 28–40px */
  font-size: 32px;
  line-height: 1;
  color: var(--el-color-success);
  font-weight: 700;
}
.batch-upload-ready__name {
  /* DIY：已选文件名字号，常见 14–18px */
  font-size: 15px;
  font-weight: 600;
  color: var(--el-text-color-primary);
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.batch-upload-ready__hint {
  font-size: 13px;
  color: var(--el-text-color-secondary);
}
</style>
