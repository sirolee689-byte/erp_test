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

        <el-button v-permission="'add'" class="toolbar-btn btn-action" @click="openCreateDialog">
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
            :data="roleList"
            border
            stripe
            style="width: 100%"
            :empty-text="loading ? '加载中...' : '暂无数据'"
          >
            <el-table-column prop="RoleID" label="角色 ID" min-width="100" />
            <el-table-column prop="RoleName" label="角色名称" min-width="140" show-overflow-tooltip />
            <el-table-column prop="Description" label="描述" min-width="200" show-overflow-tooltip />
            <el-table-column prop="pass" label="状态" min-width="100">
              <template #default="{ row }">
                <el-tag :type="String(row?.pass ?? '') === '1' ? 'success' : 'info'" effect="light">
                  {{ String(row?.pass ?? '') === '1' ? '启用' : '禁用' }}
                </el-tag>
              </template>
            </el-table-column>

            <el-table-column label="操作" min-width="280" fixed="right">
              <template #default="{ row }">
                <template v-if="Number(selectedStatus) === 1">
                  <el-button v-permission="'edit'" size="small" @click="openEditDialog(row)">编辑</el-button>
                  <el-button v-permission="'audit'" size="small" type="primary" plain @click="openPermDialog(row)">
                    分配权限
                  </el-button>
                  <el-button v-permission="'delete'" size="small" type="danger" @click="confirmDisable(row)">禁用</el-button>
                </template>
                <template v-else>
                  <el-button v-permission="'edit'" size="small" type="warning" @click="resumeRole(row)">恢复</el-button>
                  <el-button v-permission="'delete'" size="small" type="danger" @click="deleteRole(row)">删除</el-button>
                </template>
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

    <!-- 分配菜单权限：el-tree 与 erp_structure_dump.json 同源 -->
    <el-dialog
      v-model="permDialogVisible"
      :title="`分配权限 — ${permRoleName || ''}`"
      width="920px"
      top="6vh"
      :close-on-click-modal="false"
      @closed="onPermDialogClosed"
    >
      <el-alert
        type="info"
        :closable="false"
        show-icon
        class="perm-alert"
        title="勾选一级菜单会自动勾选其下全部子菜单；也可只勾选某个子菜单。保存时若整支已全选则只记父级 path。点击节点后在右侧配置操作权限。开启「全部菜单」等价于通配 * 且操作为 all。"
      />
      <div class="perm-toolbar">
        <el-switch v-model="permFullAccess" active-text="全部菜单（*）" @change="onPermFullAccessChange" />
      </div>
      <div class="perm-split" :class="{ 'is-tree-locked': permFullAccess }">
        <div class="perm-left perm-tree-wrap">
          <el-tree
            ref="permTreeRef"
            class="perm-tree"
            :data="permTreeData"
            node-key="path"
            show-checkbox
            :props="{ label: 'label', children: 'children' }"
            default-expand-all
            @check="onPermTreeCheck"
            @node-click="onPermNodeClick"
          />
        </div>
        <div class="perm-right">
          <template v-if="permSelectedPath">
            <div class="perm-right-title">当前菜单</div>
            <div class="perm-right-path">{{ permSelectedPath }}</div>
            <div class="perm-right-sub">勾选该节点在角色权限 JSON 中对应 path 下的操作列表</div>
            <el-checkbox
              v-model="allActionChecked"
              class="perm-check-all"
              @change="onAllActionChange"
            >
              全部（all）
            </el-checkbox>
            <el-divider class="perm-divider" />
            <el-checkbox-group
              v-model="selectedPathActions"
              class="perm-action-group"
              :disabled="allActionChecked"
              @change="onGranularActionsChange"
            >
              <el-checkbox label="view">查看</el-checkbox>
              <el-checkbox label="add">新增</el-checkbox>
              <el-checkbox label="edit">编辑</el-checkbox>
              <el-checkbox label="delete">删除</el-checkbox>
              <el-checkbox label="audit">审核</el-checkbox>
            </el-checkbox-group>
          </template>
          <el-empty v-else description="请点击左侧已勾选的菜单节点，配置操作权限" :image-size="72" />
        </div>
      </div>
      <template #footer>
        <el-button @click="permDialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="permSaving" @click="submitPermDialog">保存权限</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { computed, nextTick, onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import axios from 'axios'
import { Plus, Refresh, RefreshLeft, Setting } from '@element-plus/icons-vue'
import menuDump from '../../../../erp_structure_dump.json'

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

/** 分配权限弹窗 */
const permDialogVisible = ref(false)
const permSaving = ref(false)
const permRoleId = ref(null)
const permRoleName = ref('')
const permTreeRef = ref(null)
/** 勾选后保存通配符 *，等价于不限制菜单 */
const permFullAccess = ref(false)

/** 各菜单 path → 操作列表（与后端 Permissions 对象结构一致，见 server/permissions.js） */
const permActionsByPath = reactive({})

/** 当前在左侧树中选中的节点 path（用于右侧勾选框） */
const permSelectedPath = ref('')

/** 右侧「全部 all」是否勾选（与 granular 互斥） */
const allActionChecked = ref(false)

/** 右侧细粒度操作多选（view/add/edit/delete/audit） */
const selectedPathActions = ref([])

/**
 * 从行数据解析 Permissions，得到 { out, wildcard }
 * 兼容：数组 ["*"]、["system/a"]；对象 { "system/a": ["view","add"] }
 */
function parsePermissionsFromRow(row) {
  const out = {}
  let wildcard = false
  if (!row?.Permissions) {
    return { out, wildcard }
  }
  let data = row.Permissions
  if (typeof data === 'string') {
    try {
      data = JSON.parse(data)
    } catch {
      return { out, wildcard }
    }
  }
  if (Array.isArray(data)) {
    if (data.map(String).includes('*')) {
      wildcard = true
    } else {
      for (const p of data) {
        const path = String(p).trim()
        if (path) out[path] = ['all']
      }
    }
  } else if (data && typeof data === 'object') {
    const star = data['*']
    if (Array.isArray(star) && star.map(String).map((s) => s.toLowerCase()).includes('all')) {
      wildcard = true
    } else {
      for (const [k, v] of Object.entries(data)) {
        if (k === '*') continue
        const path = String(k).trim()
        if (!path) continue
        const arr = Array.isArray(v) ? v : []
        const acts = arr.map((x) => String(x).trim().toLowerCase()).filter(Boolean)
        if (acts.length) {
          out[path] = [...new Set(acts)]
        }
      }
    }
  }
  return { out, wildcard }
}

/**
 * 回显：库中若同时有父、子 path，仅勾选父节点（由树级联展示子级，避免误显整模块半选脏数据）
 * @param {string[]} paths
 */
function preferAncestorPermPaths(paths) {
  const list = [...new Set(paths.map((x) => String(x).trim()).filter(Boolean))]
  return list.filter(
    (p) => !list.some((ancestor) => ancestor !== p && p.startsWith(`${ancestor}/`)),
  )
}

/**
 * 收集某菜单节点在树中的全部后代 path（不含自身）
 * @param {any[]} nodeList
 * @param {string} base
 */
function collectDescendantPermPaths(nodeList, base = '') {
  const out = []
  for (const n of nodeList) {
    const path = base ? `${base}/${n.name}` : n.name
    out.push(path)
    if (n.children?.length) {
      out.push(...collectDescendantPermPaths(n.children, path))
    }
  }
  return out
}

/**
 * 保存前：父节点及其下所有后代均已勾选时，仅保留父 path 入库
 * @param {string[]} checkedPaths
 * @param {any[]} nodes
 */
function collapseFullyCheckedBranches(checkedPaths, nodes) {
  const checked = new Set(checkedPaths)
  const keep = new Set(checkedPaths)

  function walk(nodeList, base = '') {
    for (const n of nodeList) {
      const path = base ? `${base}/${n.name}` : n.name
      if (n.children?.length) {
        const descendants = collectDescendantPermPaths(n.children, path)
        const allDescChecked =
          descendants.length > 0 && descendants.every((d) => checked.has(d))
        if (checked.has(path) && allDescChecked) {
          for (const d of descendants) {
            keep.delete(d)
          }
        }
        walk(n.children, path)
      }
    }
  }
  walk(nodes)
  return [...keep]
}

/** 将当前选中节点的权限模型同步到右侧 UI（all与细粒度二选一展示） */
function hydrateSelectedPathActionsUi() {
  const p = permSelectedPath.value
  if (!p) {
    allActionChecked.value = false
    selectedPathActions.value = []
    return
  }
  const acts = permActionsByPath[p] || []
  if (acts.includes('all')) {
    allActionChecked.value = true
    selectedPathActions.value = []
  } else {
    allActionChecked.value = false
    selectedPathActions.value = [...acts]
  }
}

/** 把右侧勾选结果写回 permActionsByPath（须保证树节点仍为勾选状态） */
function flushSelectedPathToStore() {
  const p = permSelectedPath.value
  if (!p) return
  const tree = permTreeRef.value
  const checked = tree ? new Set(collectCheckedPermPaths()) : new Set()
  if (!checked.has(p)) {
    return
  }
  if (allActionChecked.value) {
    permActionsByPath[p] = ['all']
  } else {
    const next = [...new Set(selectedPathActions.value.map((x) => String(x).toLowerCase()))]
    permActionsByPath[p] = next.length ? next : ['view']
  }
}

/**
 * 把 erp_structure_dump 转成 el-tree 需要的节点（path 与路由 walkRoutes 规则一致）
 */
function buildPermTreeNodes(nodes, base = '') {
  return nodes.map((n) => {
    const path = base ? `${base}/${n.name}` : n.name
    const item = { label: `${n.title}（${path}）`, path }
    if (n.children?.length) {
      item.children = buildPermTreeNodes(n.children, path)
    }
    return item
  })
}

const permTreeData = computed(() => buildPermTreeNodes(menuDump))

function onPermFullAccessChange() {
  if (permFullAccess.value) {
    permTreeRef.value?.setCheckedKeys([], false)
    Object.keys(permActionsByPath).forEach((k) => delete permActionsByPath[k])
    permSelectedPath.value = ''
    allActionChecked.value = false
    selectedPathActions.value = []
  }
}

/** 左侧树勾选变化：同步「已授权 path」集合，新勾选的 path 默认 all */
function onPermTreeCheck() {
  if (permFullAccess.value) return
  nextTick(() => {
    const paths = new Set(collectCheckedPermPaths())
    for (const key of Object.keys(permActionsByPath)) {
      if (!paths.has(key)) {
        delete permActionsByPath[key]
      }
    }
    for (const path of paths) {
      if (!(path in permActionsByPath)) {
        permActionsByPath[path] = ['all']
      }
    }
    if (permSelectedPath.value && !paths.has(permSelectedPath.value)) {
      permSelectedPath.value = ''
    }
    hydrateSelectedPathActionsUi()
  })
}

function onPermNodeClick(data) {
  if (permFullAccess.value || !data?.path) return
  if (permSelectedPath.value && permSelectedPath.value !== data.path) {
    flushSelectedPathToStore()
  }
  permSelectedPath.value = data.path
  hydrateSelectedPathActionsUi()
}

function onAllActionChange() {
  if (allActionChecked.value) {
    selectedPathActions.value = []
  }
  flushSelectedPathToStore()
}

function onGranularActionsChange() {
  if (selectedPathActions.value.length) {
    allActionChecked.value = false
  }
  flushSelectedPathToStore()
}

function onPermDialogClosed() {
  permRoleId.value = null
  permRoleName.value = ''
  permFullAccess.value = false
  Object.keys(permActionsByPath).forEach((k) => delete permActionsByPath[k])
  permSelectedPath.value = ''
  allActionChecked.value = false
  selectedPathActions.value = []
}

function openPermDialog(row) {
  permRoleId.value = row?.RoleID ?? null
  permRoleName.value = row?.RoleName ?? ''
  permDialogVisible.value = true

  Object.keys(permActionsByPath).forEach((k) => delete permActionsByPath[k])
  permSelectedPath.value = ''
  allActionChecked.value = false
  selectedPathActions.value = []

  const { out, wildcard } = parsePermissionsFromRow(row)
  permFullAccess.value = wildcard
  const keysToShow = preferAncestorPermPaths(Object.keys(out))
  for (const path of keysToShow) {
    permActionsByPath[path] = [...(out[path] || ['view'])]
  }
  nextTick(() => {
    permTreeRef.value?.setCheckedKeys(wildcard ? [] : keysToShow, false)
    hydrateSelectedPathActionsUi()
  })
}

async function submitPermDialog() {
  if (!permRoleId.value) {
    ElMessage.error('缺少 RoleID')
    return
  }
  let payload
  if (permFullAccess.value) {
    payload = ['*']
  } else {
    if (permSelectedPath.value) {
      flushSelectedPathToStore()
    }
    const paths = collapseFullyCheckedBranches(collectCheckedPermPaths(), menuDump)
    const obj = {}
    for (const p of paths) {
      let acts = permActionsByPath[p]
      if (!acts || acts.length === 0) {
        acts = ['view']
      }
      obj[p] = [...new Set(acts.map((x) => String(x).trim().toLowerCase()))]
    }
    payload = obj
  }
  permSaving.value = true
  try {
    const res = await axios.put('/api/roles/permissions', {
      RoleID: permRoleId.value,
      Permissions: payload,
    })
    const json = res.data
    if (json?.code !== 200) {
      ElMessage.error(json?.msg || '保存失败')
      return
    }
    ElMessage.success('权限已保存（已登录用户需重新登录后菜单与路由才会刷新）')
    permDialogVisible.value = false
    await loadRoles()
  } catch (e) {
    const backendMsg = e?.response?.data?.msg
    ElMessage.error(backendMsg || '请求失败')
  } finally {
    permSaving.value = false
  }
}

/** 收集树中已勾选节点（不含半选父节点，避免把仅点选子级时的父级写入库） */
function collectCheckedPermPaths() {
  const tree = permTreeRef.value
  if (!tree) return []
  return tree
    .getCheckedKeys(false)
    .map((x) => String(x).trim())
    .filter(Boolean)
}

/**
 * 从后端拉取 Sys_Roles 分页数据
 * 请求：GET /api/roles?page=&pageSize=&pass=&keyword=
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
        pass: selectedStatus.value,
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
    const res = await axios.put('/api/roles', { RoleID: id, pass: '0' })
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
.perm-alert {
  margin-bottom: 10px;
}
.perm-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
  margin-bottom: 10px;
}
.perm-split {
  display: flex;
  gap: 14px;
  align-items: stretch;
  min-height: 440px;
}
.perm-split.is-tree-locked {
  pointer-events: none;
  opacity: 0.55;
}
.perm-left,
.perm-right {
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 8px;
  padding: 10px;
}
.perm-left {
  flex: 1;
  min-width: 0;
}
.perm-right {
  width: 300px;
  flex-shrink: 0;
}
.perm-right-title {
  font-weight: 600;
  margin-bottom: 4px;
}
.perm-right-path {
  font-size: 13px;
  color: var(--el-text-color-regular);
  word-break: break-all;
  margin-bottom: 6px;
}
.perm-right-sub {
  font-size: 12px;
  color: var(--el-text-color-secondary);
  margin-bottom: 10px;
  line-height: 1.4;
}
.perm-check-all {
  display: flex;
  margin-bottom: 4px;
}
.perm-divider {
  margin: 8px 0;
}
.perm-action-group {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 6px;
}
.perm-tree {
  max-height: 420px;
  overflow: auto;
}
</style>
