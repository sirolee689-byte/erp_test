<template>
  <div class="lodging-history">
    <div class="search-row erp-filter-row">
      <el-input
        v-model="keyword"
        clearable
        class="keyword-input"
        placeholder="员工姓名 / 工号 / 部门 / 房间"
        @keyup.enter="search"
      />
      <el-button type="primary" :loading="loading" @click="search">查询</el-button>
      <el-button @click="reset">重置</el-button>
      <i class="divider" />
      <span>住宿状态</span>
      <el-radio-group v-model="stayStatus" @change="search">
        <el-radio-button label="all">全部</el-radio-button>
        <el-radio-button label="live">当前在住</el-radio-button>
        <el-radio-button label="out">已退宿</el-radio-button>
      </el-radio-group>
    </div>

    <el-alert v-if="error" :title="error" type="error" show-icon class="mb-12" />

    <el-table
      v-loading="loading"
      :data="rows"
      border
      stripe
      row-key="id"
      v-erp-list-h-scroll
      class="erp-list-table"
      empty-text="暂无住宿记录"
    >
      <el-table-column label="操作" fixed="left" :width="actionsWidth" align="center" class-name="erp-col-actions">
        <template #default="{ row }">
          <ErpTableActions>
            <el-button type="info" plain @click="view(row)">查看</el-button>
            <el-button v-if="isLiving(row)" v-permission="'add'" type="danger" plain @click="openCheckOut(row)">办理退宿</el-button>
          </ErpTableActions>
        </template>
      </el-table-column>
      <el-table-column prop="stay_status" label="住宿状态" min-width="100" align="center" />
      <el-table-column prop="staff_code" label="员工工号" min-width="110" align="center" show-overflow-tooltip />
      <el-table-column prop="staff_truename" label="员工姓名" min-width="100" align="center" show-overflow-tooltip />
      <el-table-column prop="staff_bm_name" label="所属部门" min-width="140" align="center" show-overflow-tooltip />
      <el-table-column prop="room_code" label="房间编码" min-width="110" align="center" show-overflow-tooltip />
      <el-table-column prop="dorm_name" label="房间名称" min-width="120" align="center" show-overflow-tooltip />
      <el-table-column prop="dorm_type" label="房间类型" min-width="100" align="center" show-overflow-tooltip />
      <el-table-column prop="room_capacity" label="床位数" min-width="90" align="center" />
      <el-table-column prop="bed" label="床位信息" min-width="110" align="center" show-overflow-tooltip />
      <el-table-column prop="in_time" label="入住时间" min-width="150" align="center" show-overflow-tooltip />
      <el-table-column prop="out_time_disp" label="退宿时间" min-width="150" align="center" show-overflow-tooltip />
      <el-table-column prop="room_info" label="备注" min-width="180" align="center" show-overflow-tooltip />
    </el-table>

    <div class="pagination-row pagination-row--bottom">
      <el-pagination
        background
        layout="total, sizes, prev, pager, next, jumper"
        :total="total"
        v-model:current-page="page"
        v-model:page-size="pageSize"
        :page-sizes="ERP_PAGE_SIZE_OPTIONS"
        @current-change="load"
        @size-change="changeSize"
      />
    </div>

    <el-dialog v-model="detailVisible" title="住宿记录" width="620px" destroy-on-close>
      <el-descriptions :column="2" border>
        <el-descriptions-item label="住宿状态">{{ detail?.stay_status || '—' }}</el-descriptions-item>
        <el-descriptions-item label="床位信息">{{ detail?.bed || '—' }}</el-descriptions-item>
        <el-descriptions-item label="员工工号">{{ detail?.staff_code || '—' }}</el-descriptions-item>
        <el-descriptions-item label="员工姓名">{{ detail?.staff_truename || '—' }}</el-descriptions-item>
        <el-descriptions-item label="所属部门">{{ detail?.staff_bm_name || '—' }}</el-descriptions-item>
        <el-descriptions-item label="房间">{{ detail?.room_code || '—' }} {{ detail?.dorm_name || '' }}</el-descriptions-item>
        <el-descriptions-item label="入住时间">{{ detail?.in_time || '—' }}</el-descriptions-item>
        <el-descriptions-item label="退宿时间">{{ detail?.out_time_disp || '—' }}</el-descriptions-item>
        <el-descriptions-item label="备注" :span="2">{{ detail?.room_info || '—' }}</el-descriptions-item>
      </el-descriptions>
    </el-dialog>

    <el-dialog v-model="checkOutVisible" title="办理退宿" width="520px" destroy-on-close>
      <el-form :model="checkOutForm" label-width="100px">
        <el-form-item label="退宿日期" required>
          <el-date-picker v-model="checkOutForm.out_date" type="date" value-format="YYYY-MM-DD" style="width: 220px" />
        </el-form-item>
        <el-form-item label="退宿时间">
          <el-time-select v-model="checkOutForm.out_hm" start="00:00" step="00:30" end="23:30" style="width: 220px" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="checkOutVisible = false">取消</el-button>
        <el-button type="danger" :loading="checkOutSubmitting" @click="submitCheckOut">确认退宿</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue'
import axios from 'axios'
import { ElMessage } from 'element-plus'
import { ERP_PAGE_SIZE_OPTIONS } from '@/utils/erpPagination'
import { getErpTableActionsColWidthByRows } from '@/utils/erpTableActionsLayout'

const keyword = ref('')
const stayStatus = ref('all')
const page = ref(1)
const pageSize = ref(20)
const total = ref(0)
const rows = ref([])
const loading = ref(false)
const error = ref('')
const detailVisible = ref(false)
const detail = ref(null)
const checkOutVisible = ref(false)
const checkOutSubmitting = ref(false)
const checkOutForm = ref({ id: 0, out_date: '', out_hm: '00:00' })

const actionsWidth = computed(() => getErpTableActionsColWidthByRows(rows.value, (row) => (
  isLiving(row) ? ['查看', '办理退宿'] : ['查看']
), { compact: true }))

function isLiving(row) {
  return String(row?.out_room ?? '0').trim() === '0'
}

function todayYmd() {
  const date = new Date()
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

async function load() {
  loading.value = true
  error.value = ''
  try {
    const { data } = await axios.get('/api/hr/dormitory/lodging-history', {
      params: {
        page: page.value,
        pageSize: pageSize.value,
        status: stayStatus.value,
        ...(keyword.value.trim() ? { keyword: keyword.value.trim() } : {}),
      },
    })
    if (data?.code !== 200) throw new Error(data?.msg || '加载失败')
    total.value = Number(data?.data?.total || 0)
    rows.value = Array.isArray(data?.data?.list) ? data.data.list : []
  } catch (cause) {
    error.value = String(cause?.response?.data?.msg || cause?.message || '请求失败')
    total.value = 0
    rows.value = []
  } finally {
    loading.value = false
  }
}

function search() {
  page.value = 1
  load()
}

function reset() {
  keyword.value = ''
  stayStatus.value = 'all'
  page.value = 1
  load()
}

function changeSize() {
  page.value = 1
  load()
}

function view(row) {
  detail.value = row
  detailVisible.value = true
}

function openCheckOut(row) {
  checkOutForm.value = { id: Number(row.id), out_date: todayYmd(), out_hm: '00:00' }
  checkOutVisible.value = true
}

async function submitCheckOut() {
  const outDate = String(checkOutForm.value.out_date || '').trim()
  if (!outDate) return ElMessage.error('请选择退宿日期')
  checkOutSubmitting.value = true
  try {
    const { data } = await axios.put('/api/hr/dormitory/check-out', {
      id: checkOutForm.value.id,
      out_time: `${outDate} ${checkOutForm.value.out_hm || '00:00'}`,
    })
    if (data?.code !== 200) throw new Error(data?.msg || '退宿失败')
    ElMessage.success('退宿成功')
    checkOutVisible.value = false
    await load()
  } catch (cause) {
    ElMessage.error(String(cause?.response?.data?.msg || cause?.message || '请求失败'))
  } finally {
    checkOutSubmitting.value = false
  }
}

onMounted(load)
</script>

<style scoped>
.search-row { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; margin-bottom: 12px; }
.keyword-input { width: 300px; }
.divider { width: 1px; height: 24px; background: var(--el-border-color); }
.mb-12 { margin-bottom: 12px; }
</style>
