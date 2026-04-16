<template>
  <div class="erp-module-page">
    <!--
     旧系统部门表：主键为 code（新增由后端自增）；审核字段 pass（'1'已审）；del 为逻辑删除。
      顶部新增/刷新；搜索 name、code、remark；表格分页默认 20；已审行禁用编辑/删除。
    -->
    <el-card shadow="never">
      <template #header>
        <span class="page-title">{{ pageTitle }}</span>
      </template>
      <p class="page-desc">
        数据表由环境变量 <code>HR_LEGACY_DEPT_TABLE</code> 指定（默认 <code>HR_Departments</code>）。列表表头为中文；库内字段名仍为英文（如
        <code>pass</code>：值为 <code>1</code> 表示已审核并锁定改删）。删除为逻辑删除。
      </p>

      <div class="operator-toolbar">
        <el-button v-permission="'add'" class="toolbar-btn btn-action" @click="openCreateDept">
          <el-icon class="btn-icon"><Plus /></el-icon>
          新增部门
        </el-button>
        <el-button v-permission="'add'" class="toolbar-btn btn-post" type="info" @click="openCreatePost">
          <el-icon class="btn-icon"><Plus /></el-icon>
          新增岗位
        </el-button>
        <div class="audit-switch">
          <span class="switch-label">树形显示</span>
          <el-switch v-model="treeMode" />
        </div>
        <div class="audit-switch">
          <span class="switch-label">显示未审核</span>
          <el-switch v-model="showUnAudited" />
        </div>
        <!-- 仅“显示未审核”时出现；且只审核当前页（平铺分页） -->
        <el-button
          v-if="showUnAudited"
          v-permission="'audit'"
          class="toolbar-btn btn-batch-audit"
          type="success"
          plain
          :loading="batchAuditing"
          :disabled="batchAuditing || loading || treeMode || tableList.length === 0"
          @click="doBatchAuditCurrentPage"
        >
          批量审核（仅当前页）
        </el-button>
        <el-button class="toolbar-btn btn-view" :loading="loading" @click="loadData">
          <el-icon class="btn-icon"><Refresh /></el-icon>
          刷新
        </el-button>
      </div>

      <div class="search-row">
        <el-input
          v-model="keyword"
          placeholder="模糊搜索：名称、编码、备注"
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
        title="当前显示：【待审核】部门资料"
        type="warning"
        show-icon
        class="audit-view-alert"
      />

      <el-skeleton :loading="loading" animated :rows="8">
        <template #default>
          <el-table
            :data="tableList"
            row-key="code"
            border
            stripe
            style="width: 100%"
            :empty-text="loading ? '加载中…' : '暂无数据'"
            highlight-current-row
            :default-expand-all="treeMode"
            :tree-props="treeMode ? { children: 'children' } : undefined"
            @current-change="onCurrentRowChange"
          >
            <el-table-column prop="code" label="编码" min-width="100" show-overflow-tooltip />
            <el-table-column prop="name" label="名称" min-width="160" show-overflow-tooltip>
              <template #default="{ row }">
                <div class="name-cell">
                  <el-tag v-if="rowIsPost(row)" size="small" effect="plain" type="warning">岗</el-tag>
                  <el-tag v-else size="small" effect="plain" type="primary">部</el-tag>
                  <span class="name-text">{{ row.name ?? '—' }}</span>
                </div>
              </template>
            </el-table-column>
            <el-table-column v-if="!treeMode" label="所属部门" min-width="150" show-overflow-tooltip>
              <template #default="{ row }">
                <span v-if="rowIsPost(row)">{{ parentDeptName(row) }}</span>
                <span v-else>—</span>
              </template>
            </el-table-column>
            <el-table-column prop="remark" label="备注" min-width="120" show-overflow-tooltip>
              <template #default="{ row }">{{ row.remark ?? '—' }}</template>
            </el-table-column>
            <el-table-column prop="flag" label="标志" width="80" show-overflow-tooltip>
              <template #default="{ row }">{{ row.flag ?? '—' }}</template>
            </el-table-column>
            <el-table-column label="审核状态" min-width="96">
              <template #default="{ row }">
                <el-tag v-if="rowIsAudited(row)" type="success" effect="light">已审核</el-tag>
                <el-tag v-else type="info" effect="light">未审核</el-tag>
              </template>
            </el-table-column>
            <el-table-column prop="passutruename" label="审核人" min-width="110" show-overflow-tooltip>
              <template #default="{ row }">{{ row.passutruename ?? '—' }}</template>
            </el-table-column>
            <el-table-column prop="passtime" label="审核时间" min-width="150" show-overflow-tooltip>
              <template #default="{ row }">{{ row.passtime ?? '—' }}</template>
            </el-table-column>
            <el-table-column label="操作" min-width="320" fixed="right">
              <template #default="{ row }">
                <el-button v-permission="'edit'" size="small" :disabled="rowIsAudited(row)" @click="openEdit(row)">
                  编辑
                </el-button>
                <el-button
                  v-permission="'delete'"
                  size="small"
                  type="danger"
                  :disabled="rowIsAudited(row)"
                  @click="confirmDelete(row)"
                >
                  删除
                </el-button>
                <el-button
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

          <div v-if="!treeMode" class="pagination-row">
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

    <el-dialog v-model="dialogVisible" :title="dialogTitle" width="480px" destroy-on-close>
      <!-- :key 防止「先编辑后新增」时表单仍校验已卸载的 code 表单项 -->
      <el-form ref="formRef" :key="formDialogKey" :model="form" :rules="formRules" label-width="100px">
        <!-- 新增时编码由后端自增；仅编辑时展示主键（只读） -->
        <el-form-item v-if="dialogMode === 'edit'" label="编码" prop="code">
          <el-input v-model="form.code" disabled maxlength="50" />
        </el-form-item>
        <el-form-item :label="formLabelName" prop="name">
          <el-input v-model="form.name" maxlength="50" :placeholder="formPlaceholderName" />
        </el-form-item>
        <el-form-item v-if="dialogEntityType === 'post'" label="所属部门" prop="ParentID">
          <el-select
            v-model="form.ParentID"
            filterable
            clearable
            placeholder="请选择所属部门（必选）"
            style="width: 100%"
            :disabled="dialogMode === 'edit' && rowIsAudited(editingRow)"
          >
            <el-option
              v-for="d in deptOptions"
              :key="String(d.code ?? '')"
              :label="`${String(d.name ?? '')}（${String(d.code ?? '')}）`"
              :value="String(d.code ?? '')"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="备注" prop="remark">
          <el-input v-model="form.remark" maxlength="500" type="textarea" :rows="2" placeholder="备注（可空）" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="submitting" @click="submitForm">确定</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import axios from 'axios'
import { Plus, Refresh } from '@element-plus/icons-vue'

/** 页面标题 */
const pageTitle = '部门资料'

const tableList = ref([])
const total = ref(0)
const loading = ref(false)
const errorMessage = ref('')
const keyword = ref('')
const page = ref(1)
/** 默认每页 20 条（旧表数据量可能较大） */
const pageSize = ref(20)

/** 当前选中的部门行（用于“新增岗位”默认父级） */
const currentDeptRow = ref(null)

/** 是否显示未审核（pass='0'） */
const showUnAudited = ref(false)

/** 树形显示：部门为父、岗位为子（默认开启） */
const treeMode = ref(true)
const batchAuditing = ref(false)

const dialogVisible = ref(false)
const dialogMode = ref('create')
/** 弹窗实体类型：dept=部门，post=岗位 */
const dialogEntityType = ref('dept')
const submitting = ref(false)
const formRef = ref()
/** 每次打开弹窗递增，强制重建 el-form，避免 validate 仍校验上一次的 code */
const formDialogKey = ref(0)
/** 编辑模式下缓存当前行（用于判断是否已审核锁定） */
const editingRow = ref(null)

/** 下拉：所有顶级部门（用于岗位的“所属部门”） */
const deptOptions = ref([])

const form = ref({
  code: '',
  name: '',
  remark: '',
  /** 旧库字段名对标：岗位所属部门 = ParentID（必填） */
  ParentID: '',
})

const dialogTitle = computed(() => {
  const n = dialogEntityType.value === 'post' ? '岗位' : '部门'
  return dialogMode.value === 'edit' ? `编辑${n}` : `新增${n}`
})

const formLabelName = computed(() => (dialogEntityType.value === 'post' ? '岗位名称' : '部门名称'))
const formPlaceholderName = computed(() =>
  dialogEntityType.value === 'post' ? '请输入岗位名称' : '请输入部门名称'
)

/** 岗位必须选所属部门；新增不校验编码（后端自增） */
const formRules = computed(() => {
  const rules = {
    name: [{ required: true, message: '请输入名称', trigger: 'blur' }],
  }
  if (dialogEntityType.value === 'post') {
    rules.ParentID = [{ required: true, message: '请选择所属部门', trigger: 'change' }]
  }
  return rules
})

/** pass === '1' 为已审核 */
function rowIsAudited(row) {
  return String(row?.pass ?? '').trim() === '1'
}

/** 岗位所属部门名称（用于列表“所属部门”列） */
function parentDeptName(row) {
  const pid = String(row?.ParentID ?? '').trim()
  if (!pid || pid === '0') return '—'
  const hit = (deptOptions.value ?? []).find((d) => String(d?.code ?? '').trim() === pid)
  // 小白版解释：正常情况一定能匹配到；匹配不到时至少把编码显示出来，避免用户不知道岗位挂在哪
  return hit?.name ? String(hit.name) : `编码=${pid}`
}

/** ParentID 非空表示岗位（二级） */
function rowIsPost(row) {
  const pid = String(row?.ParentID ?? '').trim()
  return pid !== '' && pid !== '0'
}

/** 表格选中行变更（只记录部门行） */
function onCurrentRowChange(row) {
  if (!row || rowIsPost(row)) {
    currentDeptRow.value = null
    return
  }
  currentDeptRow.value = row
}

/** 读取顶级部门下拉（给岗位弹窗用） */
async function loadDeptOptions() {
  try {
    const res = await axios.get('/api/hr/departments/options')
    const body = res.data
    if (body?.code !== 200) {
      deptOptions.value = []
      return
    }
    const list = body?.data?.list
    deptOptions.value = Array.isArray(list) ? list : []
  } catch {
    deptOptions.value = []
  }
}

/** loadData：按筛选条件读取列表（默认只看 pass='1' 已审核） */
async function loadData() {
  loading.value = true
  errorMessage.value = ''
  try {
    // 强制转换逻辑：开关关着(false)就查pass='1'，开关开了(true)就查pass='0'
    const currentPassStatus = showUnAudited.value ? '0' : '1'
    const q = String(keyword.value ?? '').trim()

    const params = {
      pass: currentPassStatus, // 必须传给后端的 pass 参数
      // 兼容你给的“name/code 搜索”写法：后端当前用 keyword 做模糊匹配
      ...(q ? { name: q, code: q, keyword: q } : {}),
    }

    // 树形模式：不分页，后端返回树结构；平铺模式：走分页接口
    const res = treeMode.value
      ? await axios.get('/api/hr/departments/tree', { params })
      : await axios.get('/api/hr/departments', { params: { ...params, page: page.value, pageSize: pageSize.value } })
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

watch(showUnAudited, () => {
  // 监听 showUnAudited 变化：立即回第一页并刷新
  // 需求：批量审核只能审核“当前页”，因此打开未审核视图时强制切到平铺分页
  if (showUnAudited.value) {
    treeMode.value = false
  }
  page.value = 1
  loadData()
})

watch(treeMode, () => {
  page.value = 1
  loadData()
})

async function doBatchAuditCurrentPage() {
  if (!showUnAudited.value) return
  if (treeMode.value) {
    ElMessage.warning('批量审核仅支持平铺分页模式，请先关闭“树形显示”')
    return
  }
  const codes = (tableList.value ?? [])
    .map((r) => String(r?.code ?? '').trim())
    .filter(Boolean)
  if (!codes.length) {
    ElMessage.warning('当前页无可审核数据')
    return
  }
  try {
    await ElMessageBox.confirm(
      `确定批量审核当前页 ${codes.length} 条记录吗？审核后将锁定编辑/删除，需反审后再操作。`,
      '确认批量审核',
      { type: 'warning' },
    )
  } catch {
    return
  }
  batchAuditing.value = true
  try {
    const res = await axios.put('/api/hr/departments/audit-batch', { codes })
    const body = res.data
    if (body?.code !== 200) {
      ElMessage.error(String(body?.msg ?? '批量审核失败'))
      return
    }
    const successCount = Number(body?.data?.successCount ?? 0)
    const failedCount = Array.isArray(body?.data?.failed) ? body.data.failed.length : 0
    if (failedCount > 0) {
      ElMessage.warning(`批量审核完成：成功 ${successCount} 条，失败 ${failedCount} 条（可打开控制台查看详情）`)
      // 仅打印概要，避免页面弹窗过长
      // eslint-disable-next-line no-console
      console.warn('[批量审核失败明细]', body?.data?.failed)
    } else {
      ElMessage.success(`批量审核完成：成功 ${successCount} 条`)
    }
    await loadData()
  } catch (e) {
    const msg = e?.response?.data?.msg
    ElMessage.error(String(msg ?? e?.message ?? '请求失败'))
  } finally {
    batchAuditing.value = false
  }
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

function openCreateDept() {
  dialogMode.value = 'create'
  dialogEntityType.value = 'dept'
  editingRow.value = null
  form.value = { code: '', name: '', remark: '', ParentID: '' }
  formDialogKey.value += 1
  dialogVisible.value = true
  void nextTick(() => formRef.value?.clearValidate?.())
}

async function openEdit(row) {
  if (rowIsAudited(row)) return
  dialogMode.value = 'edit'
  const isPost = rowIsPost(row)
  dialogEntityType.value = isPost ? 'post' : 'dept'
  editingRow.value = row ?? null
  form.value = {
    code: String(row?.code ?? ''),
    name: String(row?.name ?? ''),
    remark: String(row?.remark ?? ''),
    ParentID: isPost ? String(row?.ParentID ?? '').trim() : '',
  }
  if (isPost) {
    await loadDeptOptions()
  }
  formDialogKey.value += 1
  dialogVisible.value = true
  void nextTick(() => formRef.value?.clearValidate?.())
}

/** 新增岗位：默认所属部门为当前选中的部门 */
async function openCreatePost() {
  dialogMode.value = 'create'
  dialogEntityType.value = 'post'
  editingRow.value = null
  await loadDeptOptions()
  const defaultParent = String(currentDeptRow.value?.code ?? '').trim()
  form.value = { code: '', name: '', remark: '', ParentID: defaultParent }
  formDialogKey.value += 1
  dialogVisible.value = true
  void nextTick(() => formRef.value?.clearValidate?.())
}

async function submitForm() {
  // 只校验有规则的字段，避免整表 validate 在弹窗切换后仍去校验 code（新增由后端生成）
  const fields = ['name']
  if (dialogEntityType.value === 'post') {
    fields.push('ParentID')
  }
  try {
    await formRef.value?.validateField(fields)
  } catch {
    return
  }
  submitting.value = true
  try {
    const payload = {
      name: form.value.name.trim(),
      remark: String(form.value.remark ?? '').trim(),
      /** 旧字段名对标：ParentID（岗位必填；部门提交时传空即可） */
      ParentID: String(form.value.ParentID ?? '').trim(),
    }
    if (dialogMode.value === 'edit') {
      payload.code = form.value.code.trim()
      const res = await axios.put('/api/hr/departments', payload)
      const body = res.data
      if (body?.code !== 200) {
        ElMessage.error(String(body?.msg ?? '保存失败'))
        return
      }
      ElMessage.success('已保存')
    } else {
      const res = await axios.post('/api/hr/departments', payload)
      const body = res.data
      if (body?.code !== 200) {
        ElMessage.error(String(body?.msg ?? '新增失败'))
        return
      }
      ElMessage.success('已新增')
    }
    dialogVisible.value = false
    await loadData()
  } catch (e) {
    const msg = e?.response?.data?.msg
    ElMessage.error(String(msg ?? e?.message ?? '请求失败'))
  } finally {
    submitting.value = false
  }
}

async function confirmDelete(row) {
  if (rowIsAudited(row)) {
    ElMessage.warning('该记录已审核锁定，请反审后再操作')
    return
  }
  const code = String(row?.code ?? '')
  try {
    await ElMessageBox.confirm(`确定逻辑删除部门「${row.name}」（code=${code}）吗？`, '确认删除', {
      type: 'warning',
    })
  } catch {
    return
  }
  try {
    const res = await axios.delete(`/api/hr/departments/${encodeURIComponent(code)}`)
    const body = res.data
    if (body?.code !== 200) {
      ElMessage.error(String(body?.msg ?? '删除失败'))
      return
    }
    ElMessage.success('已删除')
    await loadData()
  } catch (e) {
    const msg = e?.response?.data?.msg
    ElMessage.error(String(msg ?? e?.message ?? '请求失败'))
  }
}

async function doAudit(row) {
  if (rowIsAudited(row)) return
  try {
    await ElMessageBox.confirm(
      `确定审核「${row.name}」（code=${row.code}）吗？审核后锁定编辑/删除，需反审才可改。`,
      '确认审核',
      { type: 'warning' }
    )
  } catch {
    return
  }
  try {
    const res = await axios.put('/api/hr/departments/audit', { code: row.code })
    const body = res.data
    if (body?.code !== 200) {
      ElMessage.error(String(body?.msg ?? '审核失败'))
      return
    }
    ElMessage.success('已审核')
    await loadData()
  } catch (e) {
    const msg = e?.response?.data?.msg
    ElMessage.error(String(msg ?? e?.message ?? '请求失败'))
  }
}

async function doUnaudit(row) {
  if (!rowIsAudited(row)) return
  try {
    await ElMessageBox.confirm(`确定反审部门「${row.name}」吗？反审后可再编辑或删除。`, '确认反审', {
      type: 'warning',
    })
  } catch {
    return
  }
  try {
    const res = await axios.put('/api/hr/departments/unaudit', { code: row.code })
    const body = res.data
    if (body?.code !== 200) {
      ElMessage.error(String(body?.msg ?? '反审失败'))
      return
    }
    ElMessage.success('已反审')
    await loadData()
  } catch (e) {
    const msg = e?.response?.data?.msg
    ElMessage.error(String(msg ?? e?.message ?? '请求失败'))
  }
}

onMounted(() => {
  // 列表里要显示岗位所属部门名称，因此进入页面时先拉一次顶级部门下拉
  void loadDeptOptions()
  loadData()
})
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
  margin: 0 0 8px;
  color: var(--el-text-color-secondary);
  line-height: 1.5;
}
.error-alert {
  margin: 12px 0;
}
.audit-view-alert {
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
.audit-switch {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 0 10px;
  border-radius: 8px;
  background: #f5f7fa;
}
.switch-label {
  font-size: 13px;
  color: var(--el-text-color-regular);
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
.btn-post {
  border-radius: 8px;
}
.btn-batch-audit {
  border-radius: 8px;
}
.name-cell {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}
.name-text {
  display: inline-block;
}
.pagination-row {
  display: flex;
  justify-content: flex-end;
  margin-top: 12px;
}
</style>
