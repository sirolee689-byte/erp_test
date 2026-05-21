<template>
  <div class="erp-module-page">
    <!--
      使用单位（Bom_unit）：与颜色编码同一套列表/审核/软删/恢复标准件；主键为数字 id。
    -->
    <el-card shadow="never">
      <template #header>
        <span class="page-title">{{ pageTitle }}</span>
      </template>
      <p class="page-desc">
        数据表 <code>Bom_unit</code>；主键 <code>id</code>；默认按 id 降序，每页 20 条；已审核行不可软删，需先反审。
      </p>

      <div class="search-row">
        <el-input
          v-model="keyword"
          placeholder="按名称或备注模糊搜索"
          clearable
          style="max-width: 360px"
          @keyup.enter="onSearch"
        />
        <div class="audit-switch">
          <span class="switch-label">回收站</span>
          <el-switch v-model="showRecycle" @change="onRecycleChange" />
        </div>
        <div v-if="!showRecycle" class="audit-switch">
          <span class="switch-label">显示未审核</span>
          <el-switch v-model="showUnAudited" @change="onSearch" />
        </div>
        <el-button type="primary" @click="onSearch">查询</el-button>
        <el-button @click="onReset">重置</el-button>
        <el-button v-if="!showRecycle" v-permission="'add'" type="success" plain @click="openCreateDialog">
          新增单位
        </el-button>
        <el-button class="btn-view" :loading="loading" @click="loadData">
          <el-icon class="btn-icon"><Refresh /></el-icon>
          刷新
        </el-button>
      </div>

      <el-alert v-if="errorMessage" :title="errorMessage" type="error" show-icon class="error-alert" />
      <el-alert
        v-if="showRecycle"
        title="当前为回收站视图：仅显示已逻辑删除（del=1）的记录，可进行恢复。"
        type="info"
        show-icon
        class="audit-alert"
      />
      <el-alert
        v-else-if="showUnAudited"
        title="当前显示：未审核（pass=0）的使用单位"
        type="warning"
        show-icon
        class="audit-alert"
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

      <el-skeleton :loading="loading" animated :rows="6">
        <template #default>
          <el-table
            v-erp-list-h-scroll
            class="erp-list-table"
            :data="tableList"
            border
            stripe
            row-key="id"
            style="width: 100%"
            :empty-text="loading ? '加载中…' : '暂无数据'"
          >
            <el-table-column prop="id" label="ID" width="88" align="center" header-align="center" />
            <el-table-column
              prop="name"
              label="名称"
              min-width="160"
              align="center"
              header-align="center"
            />
            <el-table-column
              prop="info"
              label="备注"
              min-width="200"
              align="center"
              header-align="center"
            />
            <el-table-column label="审核" width="100" align="center" header-align="center">
              <template #default="{ row }">
                <el-tag v-if="passIsAudited(row)" type="success" size="small">已审核</el-tag>
                <el-tag v-else type="warning" size="small">未审核</el-tag>
              </template>
            </el-table-column>
            <el-table-column
              label="操作"
              width="300"
              fixed="right"
              align="center"
              class-name="erp-col-actions"
            >
              <template #default="{ row }">
                <ErpTableActions>
                  <template v-if="showRecycle">
                    <el-button
                      type="primary"
                      plain
                      :loading="busyId === row.id"
                      @click="onRestore(row)"
                    >
                      恢复
                    </el-button>
                    <el-button
                      v-permission="'delete'"
                      type="danger"
                      plain
                      :loading="busyId === row.id"
                      @click="onHardDelete(row)"
                    >
                      彻底删除
                    </el-button>
                  </template>
                  <template v-else>
                    <el-button
                      type="primary"
                      plain
                      :disabled="passIsAudited(row)"
                      :loading="busyId === row.id"
                      @click="onAudit(row)"
                    >
                      审核
                    </el-button>
                    <el-button
                      type="warning"
                      plain
                      :disabled="!passIsAudited(row)"
                      :loading="busyId === row.id"
                      @click="onUnaudit(row)"
                    >
                      反审
                    </el-button>
                    <el-button
                      type="danger"
                      plain
                      :disabled="passIsAudited(row)"
                      :loading="busyId === row.id"
                      @click="onSoftDelete(row)"
                    >
                      删除
                    </el-button>
                  </template>
                </ErpTableActions>
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

    <el-dialog v-model="createVisible" title="新增使用单位" width="480px" destroy-on-close @closed="resetCreateForm">
      <el-form ref="createFormRef" :model="createForm" :rules="createRules" label-width="88px">
        <el-form-item label="名称" prop="name">
          <el-input v-model="createForm.name" maxlength="200" show-word-limit placeholder="必填" />
        </el-form-item>
        <el-form-item label="备注" prop="info">
          <el-input v-model="createForm.info" type="textarea" :rows="4" maxlength="500" show-word-limit placeholder="选填" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="createVisible = false">取消</el-button>
        <el-button type="primary" :loading="createSubmitting" @click="submitCreate">提交</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref } from 'vue'
import axios from 'axios'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Refresh } from '@element-plus/icons-vue'
const pageTitle = '使用单位'

const loading = ref(false)
const errorMessage = ref('')
const tableList = ref([])
const total = ref(0)
const page = ref(1)
const pageSize = ref(20)
const keyword = ref('')
const showUnAudited = ref(false)
const showRecycle = ref(false)
/** 当前正在请求后端的行主键 id */
const busyId = ref(null)

const createVisible = ref(false)
const createSubmitting = ref(false)
const createFormRef = ref()
const createForm = ref({
  name: '',
  info: '',
})

const createRules = {
  name: [{ required: true, message: '请输入名称', trigger: 'blur' }],
}

function passIsAudited(row) {
  return String(row?.pass ?? '').trim() === '1'
}

async function loadData() {
  loading.value = true
  errorMessage.value = ''
  try {
    const pass = showUnAudited.value ? '0' : '1'
    const kw = String(keyword.value ?? '').trim()
    const params = {
      page: page.value,
      pageSize: pageSize.value,
      ...(showRecycle.value ? { recycled: '1' } : { pass }),
      ...(kw ? { keyword: kw } : {}),
    }
    const res = await axios.get('/api/inventory/units/list', { params })
    const body = res.data
    if (body?.code !== 200) {
      errorMessage.value = body?.msg || '加载失败'
      tableList.value = []
      total.value = 0
      return
    }
    const data = body.data ?? {}
    total.value = Number(data.total ?? 0)
    tableList.value = Array.isArray(data.list) ? data.list : []
  } catch (e) {
    errorMessage.value = String(e?.response?.data?.msg ?? e?.message ?? '网络错误')
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
  showUnAudited.value = false
  showRecycle.value = false
  page.value = 1
  loadData()
}

function onRecycleChange() {
  if (showRecycle.value) {
    showUnAudited.value = false
  }
  page.value = 1
  loadData()
}

function onPageChange(p) {
  page.value = p
  loadData()
}

function onPageSizeChange(ps) {
  pageSize.value = ps
  page.value = 1
  loadData()
}

async function onAudit(row) {
  const id = Number(row?.id)
  if (!Number.isFinite(id) || id <= 0) return
  try {
    await ElMessageBox.confirm(`确定审核「${row.name || id}」吗？审核后将出现在默认（已审核）列表中。`, '确认审核', {
      type: 'warning',
      confirmButtonText: '确定',
      cancelButtonText: '取消',
    })
  } catch {
    return
  }
  busyId.value = id
  try {
    const res = await axios.put('/api/inventory/units/audit', { id })
    if (res.data?.code === 200) {
      ElMessage.success('审核成功')
      await loadData()
    } else {
      ElMessage.error(res.data?.msg || '审核失败')
    }
  } catch (e) {
    ElMessage.error(String(e?.response?.data?.msg ?? e?.message ?? '审核失败'))
  } finally {
    busyId.value = null
  }
}

async function onUnaudit(row) {
  const id = Number(row?.id)
  if (!Number.isFinite(id) || id <= 0) return
  try {
    await ElMessageBox.confirm(`确定反审「${row.name || id}」吗？反审后可再删除。`, '确认反审', {
      type: 'warning',
      confirmButtonText: '确定',
      cancelButtonText: '取消',
    })
  } catch {
    return
  }
  busyId.value = id
  try {
    const res = await axios.put('/api/inventory/units/unaudit', { id })
    if (res.data?.code === 200) {
      ElMessage.success('反审成功')
      await loadData()
    } else {
      ElMessage.error(res.data?.msg || '反审失败')
    }
  } catch (e) {
    ElMessage.error(String(e?.response?.data?.msg ?? e?.message ?? '反审失败'))
  } finally {
    busyId.value = null
  }
}

async function onSoftDelete(row) {
  const id = Number(row?.id)
  if (!Number.isFinite(id) || id <= 0) return
  try {
    await ElMessageBox.confirm(
      `确定逻辑删除「${row.name || id}」吗？删除后可在「回收站」中恢复（已审核的需先反审）。`,
      '确认删除',
      { type: 'warning', confirmButtonText: '确定', cancelButtonText: '取消' },
    )
  } catch {
    return
  }
  busyId.value = id
  try {
    const res = await axios.delete(`/api/inventory/units/${id}`)
    if (res.data?.code === 200) {
      ElMessage.success('已移入回收站')
      await loadData()
    } else {
      ElMessage.error(res.data?.msg || '删除失败')
    }
  } catch (e) {
    ElMessage.error(String(e?.response?.data?.msg ?? e?.message ?? '删除失败'))
  } finally {
    busyId.value = null
  }
}

async function onRestore(row) {
  const id = Number(row?.id)
  if (!Number.isFinite(id) || id <= 0) return
  try {
    await ElMessageBox.confirm(`确定恢复「${row.name || id}」吗？恢复后将回到在册列表（按审核状态筛选）。`, '确认恢复', {
      type: 'warning',
      confirmButtonText: '确定',
      cancelButtonText: '取消',
    })
  } catch {
    return
  }
  busyId.value = id
  try {
    const res = await axios.put('/api/inventory/units/restore', { id })
    if (res.data?.code === 200) {
      ElMessage.success('恢复成功')
      await loadData()
    } else {
      ElMessage.error(res.data?.msg || '恢复失败')
    }
  } catch (e) {
    ElMessage.error(String(e?.response?.data?.msg ?? e?.message ?? '恢复失败'))
  } finally {
    busyId.value = null
  }
}

async function onHardDelete(row) {
  const id = Number(row?.id)
  if (!Number.isFinite(id) || id <= 0) return
  if (busyId.value) return

  try {
    await ElMessageBox.confirm('确定要彻底删除吗？该操作不可恢复。', '确认彻底删除', { type: 'warning' })
  } catch {
    return
  }

  try {
    busyId.value = id
    const res = await axios.delete(`/api/inventory/units/${id}/permanent`)
    if (res?.data?.code === 200) {
      ElMessage.success('已彻底删除')
      await fetchList()
      return
    }
    ElMessage.error(res?.data?.msg || '彻底删除失败')
  } catch (err) {
    const msg = String(err?.response?.data?.msg ?? err?.message ?? '彻底删除失败')
    ElMessage.error(msg)
  } finally {
    busyId.value = 0
  }
}

function openCreateDialog() {
  resetCreateForm()
  createVisible.value = true
}

function resetCreateForm() {
  createForm.value = { name: '', info: '' }
  createFormRef.value?.resetFields?.()
}

async function submitCreate() {
  const form = createFormRef.value
  if (!form) return
  try {
    await form.validate()
  } catch {
    return
  }
  createSubmitting.value = true
  try {
    const payload = {
      name: String(createForm.value.name ?? '').trim(),
      info: String(createForm.value.info ?? '').trim(),
    }
    const res = await axios.post('/api/inventory/units', payload)
    if (res.data?.code === 200) {
      ElMessage.success('保存成功')
      createVisible.value = false
      resetCreateForm()
      await loadData()
    } else {
      ElMessage.error(res.data?.msg || '保存失败')
    }
  } catch (e) {
    ElMessage.error(String(e?.response?.data?.msg ?? e?.message ?? '保存失败'))
  } finally {
    createSubmitting.value = false
  }
}

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
  font-size: 13px;
}
.search-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
  margin-bottom: 12px;
}
.audit-switch {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}
.switch-label {
  font-size: 13px;
  color: var(--el-text-color-regular);
}
.btn-view {
  margin-left: auto;
}
.btn-icon {
  margin-right: 4px;
}
.error-alert,
.audit-alert {
  margin-bottom: 12px;
}
</style>
