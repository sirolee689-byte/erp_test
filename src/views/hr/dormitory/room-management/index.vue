<template>
  <div class="erp-module-page">
    <!--
      v1.1.3 宿舍房间列表：Hr_room + 在住人数（Hr_room_in 未退房条数）
      - 使用状态列：s_code1（使用/闲置）；在住判定：in_room=1 且 out_room=0
    -->
    <el-card shadow="never">
      <template #header>
        <span class="page-title">{{ pageTitle }}</span>
      </template>
      <p class="page-desc">
        列表数据来自 <code>Hr_room</code>；「在住人数」统计 <code>Hr_room_in</code> 中未退房记录。默认仅显示已审核（pass=1）的房间资料。
      </p>

      <div class="operator-toolbar">
        <el-button v-permission="'add'" type="primary" class="toolbar-btn btn-action" @click="openAddDialog">
          <el-icon class="btn-icon"><Plus /></el-icon>
          添加房间
        </el-button>
        <div class="audit-switch">
          <span class="switch-label">显示未审核</span>
          <el-switch v-model="showUnAudited" />
        </div>
        <el-button class="toolbar-btn btn-view" :loading="loading" @click="loadData">
          <el-icon class="btn-icon"><Refresh /></el-icon>
          刷新
        </el-button>
      </div>

      <div class="search-row">
        <el-input
          v-model="keyword"
          placeholder="模糊搜索：房号、楼栋、名称、房型"
          clearable
          style="max-width: 380px"
          @keyup.enter="onSearch"
        />
        <el-button type="primary" @click="onSearch">查询</el-button>
        <el-button @click="onReset">重置</el-button>
      </div>

      <el-alert v-if="errorMessage" :title="errorMessage" type="error" show-icon class="error-alert" />
      <el-alert
        v-if="showUnAudited"
        title="当前显示：未审核（pass=0）的房间资料"
        type="warning"
        show-icon
        class="audit-view-alert"
      />

      <div class="pagination-row pagination-row--top">
        <el-pagination
          background
          layout="total, sizes, prev, pager, next, jumper"
          :total="total"
          :current-page="page"
          :page-size="pageSize"
          :page-sizes="[10, 20, 50, 100]"
          @size-change="onPageSizeChange"
          @current-change="onPageChange"
        />
      </div>

      <el-skeleton :loading="loading" animated :rows="8">
        <template #default>
          <el-table
            :data="tableList"
            row-key="id"
            border
            stripe
            style="width: 100%"
            :empty-text="loading ? '加载中…' : '暂无数据'"
          >
            <el-table-column prop="in_lou" label="楼栋" min-width="100" show-overflow-tooltip />
            <el-table-column prop="s_code" label="房号" min-width="90" show-overflow-tooltip />
            <el-table-column prop="code" label="房型" min-width="100" show-overflow-tooltip />
            <el-table-column prop="name" label="名称" min-width="100" show-overflow-tooltip />
            <el-table-column label="房间状态" min-width="100" show-overflow-tooltip>
              <template #default="{ row }">{{ row?.s_code1 ?? '—' }}</template>
            </el-table-column>
            <el-table-column prop="in_bad" label="床位数" width="88" />
            <el-table-column label="在住人数" width="100">
              <template #default="{ row }">
                <el-tag type="info" effect="plain">{{ Number(row?.live_in_count ?? 0) }}</el-tag>
              </template>
            </el-table-column>
            <el-table-column label="审核" width="88">
              <template #default="{ row }">
                <el-tag v-if="rowIsAudited(row)" type="success" effect="light">已审</el-tag>
                <el-tag v-else type="info" effect="light">未审</el-tag>
              </template>
            </el-table-column>
            <el-table-column label="操作" min-width="240" fixed="right">
              <template #default="{ row }">
                <el-button v-permission="'view'" size="small" type="primary" link @click="openViewDetail(row)">
                  查看
                </el-button>
                <el-button
                  v-if="showUnAudited"
                  v-permission="'audit'"
                  size="small"
                  type="success"
                  plain
                  :disabled="rowIsAudited(row)"
                  @click="doAudit(row)"
                >
                  审核
                </el-button>
                <el-button
                  v-if="!showUnAudited"
                  v-permission="'audit'"
                  size="small"
                  type="warning"
                  plain
                  :disabled="!rowIsAudited(row)"
                  @click="doUnaudit(row)"
                >
                  反审
                </el-button>
              </template>
            </el-table-column>
          </el-table>

          <div class="pagination-row pagination-row--bottom">
            <el-pagination
              background
              layout="total, sizes, prev, pager, next, jumper"
              :total="total"
              :current-page="page"
              :page-size="pageSize"
              :page-sizes="[10, 20, 50, 100]"
              @size-change="onPageSizeChange"
              @current-change="onPageChange"
            />
          </div>
        </template>
      </el-skeleton>
    </el-card>

    <el-dialog v-model="addDialogVisible" title="添加房间" width="480px" destroy-on-close @closed="resetAddForm">
      <el-form ref="addFormRef" :model="addForm" :rules="addRules" label-width="110px">
        <el-form-item label="房间号" prop="s_code">
          <el-input v-model="addForm.s_code" maxlength="50" clearable placeholder="对应 Hr_room.s_code" />
        </el-form-item>
        <el-form-item label="宿舍状态" prop="s_code1">
          <el-select v-model="addForm.s_code1" placeholder="请选择" style="width: 100%">
            <el-option v-for="o in stateOptions" :key="o" :label="o" :value="o" />
          </el-select>
        </el-form-item>
        <el-form-item label="宿舍类型" prop="code">
          <el-select v-model="addForm.code" placeholder="请选择" style="width: 100%">
            <el-option v-for="o in typeOptions" :key="o" :label="o" :value="o" />
          </el-select>
        </el-form-item>
        <el-form-item label="床位数量" prop="in_bad">
          <el-input-number v-model="addForm.in_bad" :min="1" :max="99" :step="1" controls-position="right" style="width: 100%" />
        </el-form-item>
        <el-form-item label="备注" prop="info">
          <el-input v-model="addForm.info" type="textarea" :rows="3" maxlength="500" show-word-limit placeholder="可选" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="addDialogVisible = false">取消</el-button>
        <el-button v-permission="'add'" type="primary" :loading="addSubmitting" @click="submitAddRoom">确定</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="viewDialogVisible" title="房间详情" width="520px" destroy-on-close @closed="onViewDialogClosed">
      <el-skeleton :loading="viewLoading" animated :rows="6">
        <template #default>
          <el-descriptions v-if="viewDetail" :column="1" border size="small">
            <el-descriptions-item label="房间号">{{ viewDetail.s_code ?? '—' }}</el-descriptions-item>
            <el-descriptions-item label="宿舍状态">{{ viewDetail.s_code1 ?? '—' }}</el-descriptions-item>
            <el-descriptions-item label="宿舍类型">{{ viewDetail.code ?? '—' }}</el-descriptions-item>
            <el-descriptions-item label="床位数量">{{ viewDetail.in_bad != null ? viewDetail.in_bad : '—' }}</el-descriptions-item>
            <el-descriptions-item label="备注">{{ remarkDisplay(viewDetail) }}</el-descriptions-item>
            <el-descriptions-item label="名称">{{ viewDetail.name ?? '—' }}</el-descriptions-item>
            <el-descriptions-item label="楼栋">{{ viewDetail.in_lou ?? '—' }}</el-descriptions-item>
            <el-descriptions-item label="在住人数">{{ Number(viewDetail.live_in_count ?? 0) }}</el-descriptions-item>
            <el-descriptions-item label="内部编码">{{ viewDetail.systemcode ?? '—' }}</el-descriptions-item>
            <el-descriptions-item label="审核状态">
              <el-tag v-if="String(viewDetail.pass ?? '').trim() === '1'" type="success" size="small">已审核</el-tag>
              <el-tag v-else type="info" size="small">未审核</el-tag>
            </el-descriptions-item>
            <el-descriptions-item label="创建信息">
              {{ formatCreatorLine(viewDetail) }}
            </el-descriptions-item>
            <el-descriptions-item label="审核信息">
              {{ formatAuditorLine(viewDetail) }}
            </el-descriptions-item>
          </el-descriptions>
        </template>
      </el-skeleton>
      <template #footer>
        <el-button type="primary" @click="viewDialogVisible = false">关闭</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, watch } from 'vue'
import axios from 'axios'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Plus, Refresh } from '@element-plus/icons-vue'

const pageTitle = '房间管理'

const loading = ref(false)
const errorMessage = ref('')
const tableList = ref([])
const total = ref(0)
const page = ref(1)
const pageSize = ref(20)
const keyword = ref('')
const showUnAudited = ref(false)

/** 宿舍状态下拉 */
const stateOptions = ['使用', '闲置']
/** 宿舍类型下拉（写入 Hr_room.code） */
const typeOptions = ['普通房', '空调房', '大房']

const addDialogVisible = ref(false)
const addFormRef = ref()
const addSubmitting = ref(false)
const addForm = ref({
  s_code: '',
  s_code1: '使用',
  code: '普通房',
  in_bad: 6,
  info: '',
})

const viewDialogVisible = ref(false)
const viewLoading = ref(false)
const viewDetail = ref(null)

function onViewDialogClosed() {
  viewDetail.value = null
}

function remarkDisplay(d) {
  const s = d?.info != null ? String(d.info).trim() : ''
  return s || '—'
}

function formatCreatorLine(d) {
  if (!d) return '—'
  const u = [d.uname, d.utruename].filter(Boolean).join(' / ')
  const t = d.addtime ? String(d.addtime) : ''
  if (!u && !t) return '—'
  return [u || '—', t ? `时间 ${t}` : ''].filter(Boolean).join('，')
}

function formatAuditorLine(d) {
  if (!d) return '—'
  if (String(d.pass ?? '').trim() !== '1') return '—'
  const u = [d.passuname, d.passutruename].filter(Boolean).join(' / ')
  return u || '—'
}

async function openViewDetail(row) {
  const id = Number(row?.id)
  if (!Number.isFinite(id) || id <= 0) {
    ElMessage.error('无法识别房间主键')
    return
  }
  viewDetail.value = null
  viewDialogVisible.value = true
  viewLoading.value = true
  try {
    const res = await axios.get(`/api/hr/dormitory/rooms/${id}`)
    const body = res.data
    if (body?.code !== 200) {
      ElMessage.error(String(body?.msg ?? '加载详情失败'))
      viewDialogVisible.value = false
      return
    }
    viewDetail.value = body.data ?? null
  } catch (e) {
    ElMessage.error(String(e?.response?.data?.msg ?? e?.message ?? '请求失败'))
    viewDialogVisible.value = false
  } finally {
    viewLoading.value = false
  }
}

/** 已审核列表中：反审（需 audit 权限） */
async function doUnaudit(row) {
  if (!rowIsAudited(row)) return
  const id = Number(row?.id)
  if (!Number.isFinite(id) || id <= 0) {
    ElMessage.error('无法识别房间主键，请刷新后重试')
    return
  }
  const roomNo = String(row?.s_code ?? '').trim() || String(id)
  try {
    await ElMessageBox.confirm(
      `确定反审房号「${roomNo}」吗？反审后将变为未审核，仅在「显示未审核」中可见。`,
      '确认反审',
      { type: 'warning' },
    )
  } catch {
    return
  }
  try {
    const res = await axios.put('/api/hr/dormitory/rooms/unaudit', { id })
    const body = res.data
    if (body?.code !== 200) {
      ElMessage.error(String(body?.msg ?? '反审失败'))
      return
    }
    ElMessage.success('反审成功')
    await loadData()
  } catch (e) {
    ElMessage.error(String(e?.response?.data?.msg ?? e?.message ?? '请求失败'))
  }
}

const addRules = {
  s_code: [{ required: true, message: '请输入房间号', trigger: 'blur' }],
  s_code1: [{ required: true, message: '请选择宿舍状态', trigger: 'change' }],
  code: [{ required: true, message: '请选择宿舍类型', trigger: 'change' }],
  in_bad: [{ required: true, message: '请填写床位数量', trigger: 'change' }],
}

function openAddDialog() {
  resetAddForm()
  addDialogVisible.value = true
}

function resetAddForm() {
  addForm.value = {
    s_code: '',
    s_code1: '使用',
    code: '普通房',
    in_bad: 6,
    info: '',
  }
  addFormRef.value?.clearValidate?.()
}

/** 未审核视图下：单条审核（需菜单 audit 权限） */
async function doAudit(row) {
  if (rowIsAudited(row)) return
  const id = Number(row?.id)
  if (!Number.isFinite(id) || id <= 0) {
    ElMessage.error('无法识别房间主键，请刷新后重试')
    return
  }
  const roomNo = String(row?.s_code ?? '').trim() || String(id)
  try {
    await ElMessageBox.confirm(`确定审核房号「${roomNo}」吗？审核后将出现在默认（已审核）列表中。`, '确认审核', {
      type: 'warning',
    })
  } catch {
    return
  }
  try {
    const res = await axios.put('/api/hr/dormitory/rooms/audit', { id })
    const body = res.data
    if (body?.code !== 200) {
      ElMessage.error(String(body?.msg ?? '审核失败'))
      return
    }
    ElMessage.success('审核成功')
    await loadData()
  } catch (e) {
    ElMessage.error(String(e?.response?.data?.msg ?? e?.message ?? '请求失败'))
  }
}

async function submitAddRoom() {
  try {
    await addFormRef.value?.validate()
  } catch {
    return
  }
  addSubmitting.value = true
  try {
    const res = await axios.post('/api/hr/dormitory/rooms', {
      s_code: String(addForm.value.s_code ?? '').trim(),
      s_code1: addForm.value.s_code1,
      code: addForm.value.code,
      in_bad: addForm.value.in_bad,
      info: String(addForm.value.info ?? '').trim(),
    })
    const body = res.data
    if (body?.code !== 200) {
      ElMessage.error(String(body?.msg ?? '添加失败'))
      return
    }
    ElMessage.success('添加成功（默认未审核，可打开「显示未审核」查看）')
    addDialogVisible.value = false
    showUnAudited.value = true
    page.value = 1
    await loadData()
  } catch (e) {
    ElMessage.error(String(e?.response?.data?.msg ?? e?.message ?? '请求失败'))
  } finally {
    addSubmitting.value = false
  }
}

function rowIsAudited(row) {
  return String(row?.pass ?? '').trim() === '1'
}

async function loadData() {
  loading.value = true
  errorMessage.value = ''
  try {
    const pass = showUnAudited.value ? '0' : '1'
    const q = String(keyword.value ?? '').trim()
    const res = await axios.get('/api/hr/dormitory/rooms', {
      params: {
        page: page.value,
        pageSize: pageSize.value,
        pass,
        ...(q ? { keyword: q } : {}),
      },
    })
    const body = res.data
    if (body?.code !== 200) {
      errorMessage.value = String(body?.msg ?? '加载失败')
      tableList.value = []
      total.value = 0
      return
    }
    const pack = body.data ?? {}
    tableList.value = Array.isArray(pack.list) ? pack.list : []
    total.value = Number(pack.total ?? 0)
  } catch (e) {
    const msg = e?.response?.data?.msg
    errorMessage.value = String(msg ?? e?.message ?? '请求失败')
    tableList.value = []
    total.value = 0
  } finally {
    loading.value = false
  }
}

function onSearch() {
  page.value = 1
  loadData()
}

function onReset() {
  keyword.value = ''
  page.value = 1
  loadData()
}

function onPageSizeChange(size) {
  pageSize.value = size
  page.value = 1
  loadData()
}

function onPageChange(p) {
  page.value = p
  loadData()
}

watch(showUnAudited, () => {
  page.value = 1
  loadData()
})

loadData()
</script>

<style scoped>
.erp-module-page {
  min-height: 200px;
}
.page-title {
  font-size: 18px;
  font-weight: 600;
}
.page-desc {
  margin: 0 0 12px;
  color: var(--el-text-color-secondary);
}
.page-desc code {
  font-size: 0.9em;
}
.operator-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px;
  margin-bottom: 12px;
}
.toolbar-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.btn-icon {
  font-size: 16px;
}
.audit-switch {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}
.switch-label {
  font-size: 14px;
  color: var(--el-text-color-regular);
}
.search-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
}
.error-alert,
.audit-view-alert {
  margin-bottom: 12px;
}
</style>
