<template>
  <div class="erp-module-page">
    <el-card shadow="never">
      <template #header>
        <div class="header-row">
          <span class="page-title">{{ pageTitle }}</span>
        </div>
      </template>
      <p class="page-desc">当前功能：{{ pageTitle }}</p>

      <!-- 顶部大按钮区：布局与操作员资料页一致 -->
      <div class="operator-toolbar">
        <el-button
          class="toolbar-btn btn-view"
          :class="{ 'is-active': selectedStatus === 1 }"
          @click="switchToStatus(1)"
        >
          <el-icon class="btn-icon"><Setting /></el-icon>
          管理角色
        </el-button>

        <el-button class="toolbar-btn btn-action" @click="openCreateDialog">
          <el-icon class="btn-icon"><Plus /></el-icon>
          角色添加
        </el-button>

        <el-button
          class="toolbar-btn btn-view"
          :class="{ 'is-active': selectedStatus === 0 }"
          @click="switchToStatus(0)"
        >
          <el-icon class="btn-icon"><RefreshLeft /></el-icon>
          回收角色
        </el-button>

        <el-button class="toolbar-btn btn-action" :loading="loading" @click="loadRoles">
          <el-icon class="btn-icon"><Refresh /></el-icon>
          刷新列表
        </el-button>
      </div>

      <div class="search-row">
        <el-input
          v-model="keyword"
          placeholder="请输入角色名称或描述关键词"
          clearable
          style="max-width: 320px"
          @keyup.enter="onSearch"
        />
        <el-button type="primary" @click="onSearch">查询</el-button>
        <el-button @click="onReset">重置</el-button>
      </div>

      <!--
        【Vue：如何把后端返回的角色列表渲染到表格】
        1) 脚本中 loadRoles() 请求 GET /api/roles，把接口返回的 list 赋给响应式数组 roleList。
        2) 本页使用 Element Plus 表格：`<el-table :data="roleList">`。
           el-table 内部会遍历 roleList，为每个元素生成一行（等价于对数组逐行渲染，无需手写 v-for）。
        3) 若改用原生表格，则需显式使用指令：
           `<tr v-for="row in roleList" :key="row.RoleID">...</tr>`
           其中 v-for 负责“有多少条数据就画多少行”，:key 绑定主键 RoleID，帮助 Vue 高效更新 DOM。
      -->
      <el-alert
        v-if="errorMessage"
        :title="errorMessage"
        type="error"
        show-icon
        class="error-alert"
      />

      <el-skeleton :loading="loading" animated :rows="6">
        <template #default>
          <el-table
            :data="roleList"
            border
            stripe
            style="width: 100%"
            :empty-text="loading ? '加载中...' : '暂无数据'"
          >
            <el-table-column prop="RoleID" label="角色 ID" min-width="100" />
            <el-table-column prop="RoleName" label="角色名称" min-width="140" show-overflow-tooltip />
            <el-table-column prop="Description" label="描述" min-width="200" show-overflow-tooltip />
            <el-table-column prop="Status" label="状态" min-width="100">
              <template #default="{ row }">
                <el-tag :type="row?.Status === 1 ? 'success' : 'info'" effect="light">
                  {{ row?.Status === 1 ? '启用' : '禁用' }}
                </el-tag>
              </template>
            </el-table-column>

            <el-table-column label="操作" min-width="200" fixed="right">
              <template #default="{ row }">
                <template v-if="Number(selectedStatus) === 1">
                  <el-button size="small" @click="openEditDialog(row)">编辑</el-button>
                  <el-button size="small" type="danger" @click="confirmDisable(row)">禁用</el-button>
                </template>
                <template v-else>
                  <el-button size="small" type="warning" @click="resumeRole(row)">恢复</el-button>
                  <el-button size="small" type="danger" @click="deleteRole(row)">删除</el-button>
                </template>
              </template>
            </el-table-column>
          </el-table>

          <div class="pagination-row">
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

    <el-dialog
      v-model="dialogVisible"
      :title="dialogTitle"
      width="520px"
      :close-on-click-modal="false"
    >
      <el-form ref="formRef" :model="form" :rules="formRules" label-width="96px" status-icon>
        <el-form-item label="角色名称" prop="RoleName">
          <el-input v-model="form.RoleName" placeholder="请输入角色名称（英文标识，如 CustomRole）" clearable />
        </el-form-item>
        <el-form-item label="描述" prop="Description">
          <el-input
            v-model="form.Description"
            type="textarea"
            :rows="3"
            placeholder="请输入中文描述（可空）"
            clearable
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="submitForm">确定</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import axios from 'axios'
import { Plus, Refresh, RefreshLeft, Setting } from '@element-plus/icons-vue'

/** 页面标题（与左侧菜单「角色管理」一致） */
const pageTitle = '角色管理'

/** 表格数据：对应后端 list，交给 el-table 的 :data 渲染 */
const roleList = ref([])
/** 加载中 */
const loading = ref(false)
/** 列表错误提示 */
const errorMessage = ref('')
/** 双视图：1=启用列表，0=回收站 */
const selectedStatus = ref(1)
/** 搜索关键字（模糊匹配角色名、描述） */
const keyword = ref('')
/** 当前页码 */
const page = ref(1)
/** 每页条数 */
const pageSize = ref(10)
/** 总条数 */
const total = ref(0)

/** 弹窗显示 */
const dialogVisible = ref(false)
/** 提交中 */
const saving = ref(false)
/** create | edit */
const dialogMode = ref('create')
const dialogTitle = computed(() => (dialogMode.value === 'edit' ? '编辑角色' : '新增角色'))

/** 表单引用，用于 validate */
const formRef = ref(null)
/** 弹窗表单字段（与 Sys_Roles 列对应） */
const form = ref({
  RoleID: undefined,
  RoleName: '',
  Description: '',
})

/** 校验规则 */
const formRules = {
  RoleName: [{ required: true, message: '请输入角色名称', trigger: 'blur' }],
}

/**
 * 从后端拉取 Sys_Roles 分页数据
 * 请求：GET /api/roles?page=&pageSize=&status=&keyword=
 */
async function loadRoles() {
  loading.value = true
  errorMessage.value = ''
  try {
    const res = await axios.get('/api/roles', {
      params: {
        page: page.value,
        pageSize: pageSize.value,
        keyword: String(keyword.value || '').trim() || undefined,
        status: selectedStatus.value,
      },
    })
    const json = res.data
    if (json?.code !== 200) {
      const msg = json?.msg || '读取失败'
      errorMessage.value = msg
      ElMessage.error(msg)
      roleList.value = []
      total.value = 0
      return
    }
    roleList.value = Array.isArray(json.list) ? json.list : []
    total.value = Number(json.total ?? 0)

    if (roleList.value.length === 0 && total.value > 0 && page.value > 1) {
      page.value = page.value - 1
      await loadRoles()
      return
    }
  } catch (e) {
    const msg = '接口请求失败：请确认后端已启动（npm run dev:server）'
    errorMessage.value = msg
    ElMessage.error(msg)
    roleList.value = []
    total.value = 0
  } finally {
    loading.value = false
  }
}

/** 打开新增弹窗 */
function openCreateDialog() {
  dialogMode.value = 'create'
  form.value = { RoleID: undefined, RoleName: '', Description: '' }
  dialogVisible.value = true
}

/** 打开编辑弹窗并回显 */
function openEditDialog(row) {
  dialogMode.value = 'edit'
  form.value = {
    RoleID: row?.RoleID,
    RoleName: row?.RoleName ?? '',
    Description: row?.Description ?? '',
  }
  dialogVisible.value = true
}

/** 提交新增或编辑 */
async function submitForm() {
  if (!formRef.value) return
  await formRef.value.validate(async (valid) => {
    if (!valid) return
    saving.value = true
    try {
      const isEdit = dialogMode.value === 'edit'
      const payload = {
        RoleName: form.value.RoleName,
        Description: form.value.Description,
        ...(isEdit ? { RoleID: form.value.RoleID } : {}),
      }
      const res = isEdit ? await axios.put('/api/roles', payload) : await axios.post('/api/roles', payload)
      const json = res.data
      if (json?.code !== 200) {
        ElMessage.error(json?.msg || '保存失败')
        return
      }
      ElMessage.success(isEdit ? '保存成功' : '添加成功')
      dialogVisible.value = false
      if (!isEdit) page.value = 1
      await loadRoles()
    } catch (e) {
      const backendMsg = e?.response?.data?.msg
      ElMessage.error(backendMsg || '请求失败')
    } finally {
      saving.value = false
    }
  })
}

/** 禁用（软删除入回收站） */
async function confirmDisable(row) {
  const id = row?.RoleID
  if (!id) {
    ElMessage.error('缺少 RoleID')
    return
  }
  try {
    await ElMessageBox.confirm(
      `确定要禁用角色【${row?.RoleName ?? ''}】吗？`,
      '二次确认',
      { confirmButtonText: '确定', cancelButtonText: '取消', type: 'warning' },
    )
    const res = await axios.put('/api/roles', { RoleID: id, Status: 0 })
    const json = res.data
    if (json?.code !== 200) {
      ElMessage.error(json?.msg || '禁用失败')
      return
    }
    ElMessage.success('已移入回收站')
    await loadRoles()
  } catch {
    /* 用户取消 */
  }
}

/** 从回收站恢复 */
async function resumeRole(row) {
  const id = row?.RoleID
  if (!id) {
    ElMessage.error('缺少 RoleID')
    return
  }
  try {
    await ElMessageBox.confirm(
      `确定要恢复角色【${row?.RoleName ?? ''}】吗？`,
      '二次确认',
      { confirmButtonText: '确定', cancelButtonText: '取消', type: 'warning' },
    )
    const res = await axios.put('/api/roles/resume', { RoleID: id })
    const json = res.data
    if (json?.code !== 200) {
      ElMessage.error(json?.msg || '恢复失败')
      return
    }
    ElMessage.success('已恢复启用')
    await loadRoles()
  } catch {
    /* 取消 */
  }
}

/** 物理删除（仅禁用且无用户绑定） */
async function deleteRole(row) {
  const id = row?.RoleID
  if (!id) {
    ElMessage.error('缺少 RoleID')
    return
  }
  try {
    await ElMessageBox.confirm(
      `将彻底删除角色【${row?.RoleName ?? ''}】，删除后不可恢复。\n若仍有操作员绑定该角色，删除会失败。`,
      '危险警告',
      {
        confirmButtonText: '我确认删除',
        cancelButtonText: '取消',
        type: 'error',
      },
    )
    const res = await axios.delete(`/api/roles/${id}`)
    const json = res.data
    if (json?.code !== 200) {
      ElMessage.error(json?.msg || '删除失败')
      return
    }
    ElMessage.success('删除成功')
    await loadRoles()
  } catch (e) {
    const backendMsg = e?.response?.data?.msg
    if (backendMsg) ElMessage.error(backendMsg)
  }
}

async function onPageChange(newPage) {
  page.value = Number(newPage)
  await loadRoles()
}

async function onPageSizeChange(newSize) {
  pageSize.value = Number(newSize)
  page.value = 1
  await loadRoles()
}

async function onSearch() {
  page.value = 1
  await loadRoles()
}

async function onReset() {
  keyword.value = ''
  page.value = 1
  await loadRoles()
}

async function switchToStatus(nextStatus) {
  if (selectedStatus.value === nextStatus) return
  selectedStatus.value = nextStatus
  keyword.value = ''
  page.value = 1
  pageSize.value = 10
  await loadRoles()
}

onMounted(() => {
  loadRoles()
})
</script>

<style scoped>
.erp-module-page {
  min-height: 200px;
}
.header-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.page-title {
  font-size: 18px;
  font-weight: 600;
}
.page-desc {
  margin: 0;
  color: var(--el-text-color-secondary);
}
.error-alert {
  margin: 12px 0;
}
.search-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 8px 0 12px;
}
.operator-toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin: 10px 0 12px;
}
.toolbar-btn {
  height: 45px;
  padding: 0 18px;
  border-radius: 8px;
  font-weight: 500;
}
.btn-icon {
  margin-right: 8px;
}
.btn-action {
  background-color: #d6ecff;
  border-color: #bcdfff;
  color: #1f5faa;
}
.btn-view {
  background-color: #d6ecff;
  border-color: #bcdfff;
  color: #1f5faa;
}
.toolbar-btn.is-active {
  border-width: 2px;
  box-shadow: 0 0 0 2px rgba(31, 95, 170, 0.12) inset;
  font-weight: 700;
}
.btn-view.is-active {
  background-color: #e67e22;
  border-color: #e67e22;
  color: #fff;
  box-shadow: 0 0 0 2px rgba(184, 95, 18, 0.14) inset;
}
.pagination-row {
  display: flex;
  justify-content: flex-end;
  margin-top: 12px;
}
</style>
