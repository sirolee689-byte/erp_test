<template>
  <div class="erp-module-page">
    <el-card shadow="never" class="search-card">
      <template #header>
        <div class="card-header">
          <span class="page-title">{{ pageTitle }}</span>
          <div class="toolbar">
            <el-button :icon="Refresh" circle title="刷新" @click="fetchList" />
          </div>
        </div>
      </template>

      <div class="search-row">
        <el-input
          v-model="keyword"
          clearable
          placeholder="按 编码/名称/备注 查询（回车搜索）"
          style="max-width: 360px"
          @keyup.enter="onSearch"
        />
        <el-button type="primary" @click="onSearch">查询</el-button>
        <el-button @click="onReset">重置</el-button>

        <div class="switches">
          <div class="switch-item">
            <span class="switch-label">回收站</span>
            <el-switch v-model="showRecycle" @change="onRecycleChange" />
          </div>
          <div v-if="!showRecycle" class="switch-item">
            <span class="switch-label">显示未审核</span>
            <el-switch v-model="showUnAudited" @change="onUnAuditedChange" />
          </div>
        </div>

        <div class="grow" />

        <el-button v-if="!showRecycle" v-permission="'add'" type="success" plain @click="openCreateDialog">
          新增
        </el-button>
      </div>
    </el-card>

    <el-card shadow="never" class="table-card">
      <el-alert
        v-if="errorMessage"
        :title="errorMessage"
        type="error"
        show-icon
        :closable="false"
        style="margin-bottom: 12px"
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

      <el-skeleton :loading="loading" animated>
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
              prop="code"
              label="编码"
              min-width="160"
              align="center"
              header-align="center"
            />
            <el-table-column
              prop="name"
              label="名称"
              min-width="200"
              align="center"
              header-align="center"
            />
            <el-table-column
              prop="info"
              label="备注"
              min-width="220"
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
                <div class="erp-table-actions">
                  <template v-if="showRecycle">
                    <el-button type="primary" plain :loading="busyId === row.id" @click="onRestore(row)">恢复</el-button>
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
                </div>
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

    <el-dialog v-model="createVisible" title="新增车间与部门编码" width="520px" destroy-on-close @closed="resetCreateForm">
      <el-form ref="createFormRef" :model="createForm" :rules="createRules" label-width="100px">
        <el-form-item label="编码" prop="code">
          <el-input v-model="createForm.code" maxlength="100" show-word-limit placeholder="必填" />
        </el-form-item>
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

/** 页面标题（与左侧菜单一致） */
const pageTitle = '车间与部门编码'

const loading = ref(false)
const errorMessage = ref('')
const tableList = ref([])
const total = ref(0)
const page = ref(1)
const pageSize = ref(20)
const keyword = ref('')

const showRecycle = ref(false)
const showUnAudited = ref(false)

const busyId = ref(0)

const createVisible = ref(false)
const createSubmitting = ref(false)
const createFormRef = ref()
const createForm = ref({ code: '', name: '', info: '' })
const createRules = {
  code: [{ required: true, message: '请输入编码', trigger: 'blur' }],
  name: [{ required: true, message: '请输入名称', trigger: 'blur' }],
}

function passIsAudited(row) {
  return String(row?.pass ?? '').trim() === '1'
}

function onSearch() {
  page.value = 1
  fetchList()
}

function onReset() {
  keyword.value = ''
  page.value = 1
  fetchList()
}

function onRecycleChange() {
  page.value = 1
  if (showRecycle.value) {
    showUnAudited.value = false
  }
  fetchList()
}

function onUnAuditedChange() {
  page.value = 1
  fetchList()
}

function onPageChange(p) {
  page.value = p
  fetchList()
}

function onPageSizeChange(s) {
  pageSize.value = s
  page.value = 1
  fetchList()
}

async function fetchList() {
  loading.value = true
  errorMessage.value = ''
  try {
    const pass = showUnAudited.value ? '0' : '1'
    const params = {
      page: page.value,
      pageSize: pageSize.value,
      keyword: keyword.value,
      ...(showRecycle.value ? { recycled: '1' } : { pass }),
    }
    const res = await axios.get('/api/inventory/workshop-dept/list', { params })
    if (res?.data?.code === 200) {
      const data = res.data?.data ?? {}
      total.value = Number(data.total ?? 0) || 0
      tableList.value = Array.isArray(data.list) ? data.list : []
      return
    }
    errorMessage.value = res?.data?.msg || '读取列表失败'
  } catch (err) {
    const msg = String(err?.response?.data?.msg ?? err?.message ?? '读取列表失败')
    errorMessage.value = msg
  } finally {
    loading.value = false
  }
}

function openCreateDialog() {
  createVisible.value = true
}

function resetCreateForm() {
  createSubmitting.value = false
  createForm.value = { code: '', name: '', info: '' }
  createFormRef.value?.clearValidate?.()
}

async function submitCreate() {
  if (createSubmitting.value) return
  try {
    await createFormRef.value?.validate?.()
  } catch {
    return
  }

  const payload = {
    code: String(createForm.value.code ?? '').trim(),
    name: String(createForm.value.name ?? '').trim(),
    info: String(createForm.value.info ?? '').trim(),
  }
  if (!payload.code || !payload.name) return

  try {
    createSubmitting.value = true
    const res = await axios.post('/api/inventory/workshop-dept', payload)
    if (res?.data?.code === 200) {
      ElMessage.success('录入成功，等待审核！')
      createVisible.value = false
      await fetchList()
      return
    }
    ElMessage.error(res?.data?.msg || '新增失败')
  } catch (err) {
    const msg = String(err?.response?.data?.msg ?? err?.message ?? '新增失败')
    ElMessage.error(msg)
  } finally {
    createSubmitting.value = false
  }
}

async function onAudit(row) {
  const id = Number(row?.id)
  if (!Number.isFinite(id) || id <= 0) return
  if (busyId.value) return

  try {
    await ElMessageBox.confirm('确定要审核吗？审核后如需修改请先反审。', '确认审核', { type: 'warning' })
  } catch {
    return
  }

  try {
    busyId.value = id
    const res = await axios.put('/api/inventory/workshop-dept/audit', { id })
    if (res?.data?.code === 200) {
      ElMessage.success('已审核')
      await fetchList()
      return
    }
    ElMessage.error(res?.data?.msg || '审核失败')
  } catch (err) {
    const msg = String(err?.response?.data?.msg ?? err?.message ?? '审核失败')
    ElMessage.error(msg)
  } finally {
    busyId.value = 0
  }
}

async function onUnaudit(row) {
  const id = Number(row?.id)
  if (!Number.isFinite(id) || id <= 0) return
  if (busyId.value) return

  try {
    await ElMessageBox.confirm('确定要反审吗？反审后可继续编辑/删除。', '确认反审', { type: 'warning' })
  } catch {
    return
  }

  try {
    busyId.value = id
    const res = await axios.put('/api/inventory/workshop-dept/unaudit', { id })
    if (res?.data?.code === 200) {
      ElMessage.success('已反审')
      await fetchList()
      return
    }
    ElMessage.error(res?.data?.msg || '反审失败')
  } catch (err) {
    const msg = String(err?.response?.data?.msg ?? err?.message ?? '反审失败')
    ElMessage.error(msg)
  } finally {
    busyId.value = 0
  }
}

async function onSoftDelete(row) {
  const id = Number(row?.id)
  if (!Number.isFinite(id) || id <= 0) return
  if (busyId.value) return

  try {
    await ElMessageBox.confirm('确定要删除吗？删除后可在回收站恢复。', '确认删除', { type: 'warning' })
  } catch {
    return
  }

  try {
    busyId.value = id
    const res = await axios.delete(`/api/inventory/workshop-dept/${id}`)
    if (res?.data?.code === 200) {
      ElMessage.success('已删除')
      await fetchList()
      return
    }
    ElMessage.error(res?.data?.msg || '删除失败')
  } catch (err) {
    const msg = String(err?.response?.data?.msg ?? err?.message ?? '删除失败')
    ElMessage.error(msg)
  } finally {
    busyId.value = 0
  }
}

async function onRestore(row) {
  const id = Number(row?.id)
  if (!Number.isFinite(id) || id <= 0) return
  if (busyId.value) return
  try {
    busyId.value = id
    const res = await axios.put('/api/inventory/workshop-dept/restore', { id })
    if (res?.data?.code === 200) {
      ElMessage.success('已恢复')
      await fetchList()
      return
    }
    ElMessage.error(res?.data?.msg || '恢复失败')
  } catch (err) {
    const msg = String(err?.response?.data?.msg ?? err?.message ?? '恢复失败')
    ElMessage.error(msg)
  } finally {
    busyId.value = 0
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
    const res = await axios.delete(`/api/inventory/workshop-dept/${id}/permanent`)
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

fetchList()
</script>

<style scoped>
.erp-module-page {
  min-height: 200px;
}
.page-title {
  font-size: 18px;
  font-weight: 600;
}
.card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.toolbar {
  display: flex;
  gap: 8px;
}
.search-row {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.switches {
  display: flex;
  gap: 14px;
  align-items: center;
}
.switch-item {
  display: flex;
  align-items: center;
  gap: 8px;
}
.switch-label {
  color: var(--el-text-color-secondary);
  font-size: 13px;
}
.grow {
  flex: 1;
}
</style>

