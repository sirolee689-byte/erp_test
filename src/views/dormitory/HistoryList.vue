<template>
  <div class="history-list-root" data-testid="lodging-history-root">
    <p class="history-hint">
      全量住宿流水（<code>del='0'</code>），按<strong>入住时间倒序</strong>；支持关键词筛选与分页，不再按年月过滤。
    </p>
    <div class="history-head">
      <div class="filter-row">
        <el-input
          v-model="hiKeyword"
          clearable
          placeholder="员工工号/姓名/宿舍编码"
          style="width: 320px"
          data-testid="lodging-history-keyword"
          @keyup.enter="loadHistory"
        />
        <el-button type="primary" :loading="historyLoading" @click="loadHistory">立即查询</el-button>
        <el-button @click="resetHistoryQuery">重置</el-button>
      </div>
    </div>

    <el-alert v-if="historyError" :title="historyError" type="error" show-icon class="mb-12" />

    <el-table
      v-loading="historyLoading"
      :data="historyList"
      border
      stripe
      class="lodging-table"
      empty-text="暂无数据"
      style="width: 100%"
      data-testid="lodging-history-table"
    >
      <el-table-column prop="staff_code" label="员工档案编码" min-width="120" align="center" show-overflow-tooltip />
      <el-table-column prop="staff_truename" label="员工名称" min-width="100" align="center" show-overflow-tooltip />
      <el-table-column prop="staff_bm_name" label="所属部门" min-width="120" align="center" show-overflow-tooltip />
      <el-table-column prop="room_code" label="宿舍编码" min-width="90" align="center" show-overflow-tooltip />
      <el-table-column prop="dorm_name" label="宿舍名称" min-width="100" align="center" show-overflow-tooltip />
      <el-table-column prop="dorm_type" label="宿舍类型" min-width="100" align="center" show-overflow-tooltip />
      <el-table-column prop="in_time" label="历史入住时间" min-width="160" align="center" show-overflow-tooltip />
      <el-table-column prop="electric" label="优惠电量" min-width="90" align="center" show-overflow-tooltip>
        <template #default="{ row }">{{ row?.electric != null && String(row.electric).trim() !== '' ? row.electric : '—' }}</template>
      </el-table-column>
      <el-table-column prop="room_info" label="备注" min-width="160" align="center" show-overflow-tooltip>
        <template #default="{ row }">{{ row?.room_info?.trim?.() ? row.room_info : '—' }}</template>
      </el-table-column>
      <el-table-column prop="out_time_disp" label="历史退宿时间" min-width="160" align="center" show-overflow-tooltip>
        <template #default="{ row }">{{ row?.out_time_disp?.trim?.() ? row.out_time_disp : '—' }}</template>
      </el-table-column>
      <el-table-column prop="stay_duration_label" label="住宿时间" min-width="110" align="center" show-overflow-tooltip />
      <el-table-column label="操作" width="120" align="center" fixed="right">
        <template #default="{ row }">
          <el-button v-permission="'view'" type="primary" size="small" @click="openHistoryDetail(row)">查看详细</el-button>
        </template>
      </el-table-column>
    </el-table>

    <div class="pagination-row">
      <el-pagination
        background
        layout="total, sizes, prev, pager, next, jumper"
        :total="historyTotal"
        v-model:current-page="hiPage"
        v-model:page-size="hiPageSize"
        :page-sizes="[10, 20, 50, 100]"
        @current-change="loadHistory"
        @size-change="onHiPageSizeChange"
      />
    </div>

    <el-dialog v-model="roomDetailVisible" title="房间资料（与添加房间字段一致）" width="520px" destroy-on-close @closed="roomDetail = null">
      <el-skeleton :loading="roomDetailLoading" animated :rows="8">
        <template #default>
          <el-descriptions v-if="roomDetail" :column="1" border size="small">
            <el-descriptions-item label="房间号">{{ roomDetail.s_code ?? '—' }}</el-descriptions-item>
            <el-descriptions-item label="宿舍状态">{{ roomDetail.s_code1 ?? '—' }}</el-descriptions-item>
            <el-descriptions-item label="宿舍类型">{{ roomDetail.code ?? '—' }}</el-descriptions-item>
            <el-descriptions-item label="床位数量">{{ roomDetail.in_bad != null ? roomDetail.in_bad : '—' }}</el-descriptions-item>
            <el-descriptions-item label="备注">{{ roomRemark(roomDetail) }}</el-descriptions-item>
            <el-descriptions-item label="名称">{{ roomDetail.name ?? '—' }}</el-descriptions-item>
            <el-descriptions-item label="楼栋">{{ roomDetail.in_lou ?? '—' }}</el-descriptions-item>
            <el-descriptions-item label="在住人数">{{ Number(roomDetail.live_in_count ?? 0) }}</el-descriptions-item>
          </el-descriptions>
        </template>
      </el-skeleton>
      <template #footer>
        <el-button type="primary" @click="roomDetailVisible = false">关闭</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import axios from 'axios'
import { ElMessage } from 'element-plus'

const hiKeyword = ref('')
const hiPage = ref(1)
/** 与 .cursorrules 第 7 条一致：默认每页 20 条 */
const hiPageSize = ref(20)
const historyList = ref([])
const historyTotal = ref(0)
const historyLoading = ref(false)
const historyError = ref('')

const roomDetailVisible = ref(false)
const roomDetailLoading = ref(false)
const roomDetail = ref(null)

function roomRemark(d) {
  const s = d?.info != null ? String(d.info).trim() : ''
  return s || '—'
}

function resetHistoryQuery() {
  hiKeyword.value = ''
  hiPage.value = 1
  loadHistory()
}

function onHiPageSizeChange() {
  hiPage.value = 1
  loadHistory()
}

async function loadHistory() {
  historyLoading.value = true
  historyError.value = ''
  try {
    const params = {
      page: hiPage.value,
      pageSize: hiPageSize.value,
      ...(hiKeyword.value.trim() ? { keyword: hiKeyword.value.trim() } : {}),
    }
    const res = await axios.get('/api/hr/dormitory/lodging-history', { params })
    const body = res.data
    if (body?.code !== 200) {
      historyError.value = String(body?.msg ?? '加载失败')
      historyList.value = []
      historyTotal.value = 0
      return
    }
    const pack = body.data ?? {}
    historyList.value = Array.isArray(pack.list) ? pack.list : []
    historyTotal.value = Number(pack.total ?? 0)
  } catch (e) {
    historyError.value = String(e?.response?.data?.msg ?? e?.message ?? '请求失败')
    historyList.value = []
    historyTotal.value = 0
  } finally {
    historyLoading.value = false
  }
}

async function openHistoryDetail(row) {
  const rid = Number(row?.room_id)
  if (!Number.isFinite(rid) || rid <= 0) {
    ElMessage.warning('该记录无关联房间主键，无法查看房间资料')
    return
  }
  roomDetail.value = null
  roomDetailVisible.value = true
  roomDetailLoading.value = true
  try {
    const res = await axios.get(`/api/hr/dormitory/rooms/${rid}`)
    const body = res.data
    if (body?.code !== 200) {
      ElMessage.error(String(body?.msg ?? '加载失败'))
      roomDetailVisible.value = false
      return
    }
    roomDetail.value = body.data ?? null
  } catch (e) {
    ElMessage.error(String(e?.response?.data?.msg ?? e?.message ?? '请求失败'))
    roomDetailVisible.value = false
  } finally {
    roomDetailLoading.value = false
  }
}

onMounted(() => {
  loadHistory()
})

defineExpose({ loadHistory })
</script>

<style scoped>
.history-hint {
  margin: 0 0 10px;
  font-size: 13px;
  color: var(--el-text-color-secondary);
  line-height: 1.5;
}
.history-hint code {
  font-size: 12px;
}
.history-head {
  margin-bottom: 12px;
}
.filter-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
  margin-bottom: 8px;
}
.mb-12 {
  margin-bottom: 12px;
}
.pagination-row {
  display: flex;
  justify-content: flex-end;
  margin-top: 16px;
}
.lodging-table :deep(.el-table__header th.el-table__cell) {
  text-align: center;
  background: var(--el-fill-color-light);
}
</style>
