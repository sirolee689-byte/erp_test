<template>
  <div class="erp-module-page">
    <el-card shadow="never">
      <template #header>
        <div class="header-row">
          <span class="page-title">{{ pageTitle }}</span>
          <!-- 顶部按钮已移动到下方“工具栏”，这里仅保留标题 -->
        </div>
      </template>
      <p class="page-desc">当前功能：{{ pageTitle }}</p>

      <!--
        关键：顶部工具栏（参考你给的按钮栏图片）
        小白版解释：
        - 这里把常用操作做成“大方块按钮”，高度更高、内边距更大
        - 按钮太多时允许自动换行（不会挤在一行里）
        - “管理操作员 / 恢复操作员”是视图切换开关：
          - 管理操作员：切到 Status=1（在职列表）
          - 恢复操作员：切到 Status=0（回收站列表）
        - 当前选中的视图按钮会有明显激活样式（加粗/边框更深）
      -->
      <div class="operator-toolbar">
        <!--
          视图切换按钮（在职/回收站）
          小白提示：
          - “哪个方块被选中，哪个就变成橙色”，样式由 .btn-view.is-active 控制
          - 你要改橙色，就去 style 里找 .btn-view.is-active 的 background-color
        -->
        <el-button
          class="toolbar-btn btn-view"
          :class="{ 'is-active': selectedStatus === 1 }"
          @click="switchToStatus(1)"
        >
          <el-icon class="btn-icon"><Setting /></el-icon>
          管理操作员
        </el-button>

        <!-- 操作员添加（新增） -->
        <el-button class="toolbar-btn btn-action" @click="openCreateDialog">
          <el-icon class="btn-icon"><Plus /></el-icon>
          操作员添加
        </el-button>

        <!-- 搜索操作员（触发查询；输入框也支持回车查询） -->
        <!-- 恢复操作员（切换到回收站视图 Status=0） -->
        <el-button
          class="toolbar-btn btn-view"
          :class="{ 'is-active': selectedStatus === 0 }"
          @click="switchToStatus(0)"
        >
          <el-icon class="btn-icon"><RefreshLeft /></el-icon>
          恢复操作员
        </el-button>

        <!-- 刷新列表 -->
        <el-button class="toolbar-btn btn-action" :loading="loading" @click="loadUsers">
          <el-icon class="btn-icon"><Refresh /></el-icon>
          刷新列表
        </el-button>
      </div>

      <!--
        关键：标准搜索栏（位于表格上方的独立区域）
        需求：
        - 输入框提示语：“请输入工号或姓名”
        - 支持回车触发查询
        - 点击“查询”：带 keyword 重新请求后端，并把页码重置为 1
        - 点击“重置”：清空输入框并刷新列表（也回到第一页）
      -->
      <div class="search-row">
        <el-input
          v-model="keyword"
          placeholder="请输入工号或姓名"
          clearable
          style="max-width: 320px"
          @keyup.enter="onSearch"
        />
        <el-button type="primary" @click="onSearch">查询</el-button>
        <el-button @click="onReset">重置</el-button>
      </div>

      <!--
        Sys_Users 数据表展示（Element Plus 表格）
        说明：
        - 后端接口：GET /api/users
        - 后端从 SQL Server 的 Sys_Users 表查询数据（server/index.js）
        - 前端通过 axios 请求 /api/users（Vite 会把 /api 代理到本地后端端口）
        - 接口统一返回：{ code: 200, msg: 'success', list: [...], total: 123 }
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
            :data="users"
            border
            stripe
            style="width: 100%"
            :empty-text="loading ? '加载中...' : '暂无数据'"
          >
            <!-- 关键：前端固定列，确保展示字段与业务含义一致 -->
            <el-table-column prop="UserID" label="用户 ID" min-width="120" />
            <el-table-column prop="UserCode" label="工号" min-width="140" show-overflow-tooltip />
            <el-table-column prop="UserName" label="姓名" min-width="140" show-overflow-tooltip />

            <!-- v1.0.7：角色（后端 JOIN Sys_Roles 得到 RoleName） -->
            <el-table-column prop="RoleName" label="角色" min-width="120" show-overflow-tooltip>
              <template #default="{ row }">
                {{ row?.RoleName || '—' }}
              </template>
            </el-table-column>

            <!-- 关键：状态列使用标签展示，1=启用，0=禁用 -->
            <el-table-column prop="Status" label="状态" min-width="120">
              <template #default="{ row }">
                <el-tag :type="row?.Status === 1 ? 'success' : 'info'" effect="light">
                  {{ row?.Status === 1 ? '启用' : '禁用' }}
                </el-tag>
              </template>
            </el-table-column>

            <!-- 关键：创建时间展示（后端返回 CreatedAt） -->
            <el-table-column prop="CreatedAt" label="创建时间" min-width="200" :formatter="formatDateTime" />

            <!--
              关键：操作列（改 / 删=禁用）
              小白版解释：
              - “编辑”会把这一行的旧数据，填进弹窗输入框里（回显）
              - “禁用”不会真的从数据库删除，而是把 Status 改成 0（软删除）
            -->
            <el-table-column label="操作" min-width="220" fixed="right">
              <template #default="{ row }">
                <!--
                  关键：用 v-if 根据 Status 动态切换按钮
                  小白版解释：
                  - v-if 会“判断条件是否成立”，成立就显示这块，不成立就不显示
                  - 现在我们不再用 row.Status 来决定显示哪组按钮
                  - 而是用“当前视图状态 selectedStatus”来决定：
                    - 在职视图（selectedStatus=1）：显示【编辑】【禁用】
                    - 回收站视图（selectedStatus=0）：显示【恢复】【删除】
                  - 这样做的好处：按钮逻辑和“你当前看的列表类型”严格一致，不会乱
                -->
                <template v-if="Number(selectedStatus) === 1">
                  <el-button size="small" @click="openEditDialog(row)">编辑</el-button>
                  <el-button size="small" type="danger" @click="confirmDisable(row)">禁用</el-button>
                </template>
                <template v-else>
                  <el-button size="small" type="warning" @click="resumeUser(row)">恢复</el-button>
                  <el-button size="small" type="danger" @click="deleteUser(row)">删除</el-button>
                </template>
              </template>
            </el-table-column>
          </el-table>

          <!--
            关键：分页组件（el-pagination）
            小白版解释（分页参数怎么传到后端）：
            - 你点击“下一页/切换每页条数”时，这里会改 page / pageSize
            - page / pageSize 改了之后，我们会重新调用 loadUsers()
            - loadUsers 会把 page/pageSize 作为 axios 参数发到后端：/api/users?page=...&pageSize=...
            - 后端拿到 page/pageSize 后，用 SQL 的 OFFSET/FETCH 只查这一页的数据
          -->
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

    <!--
      新增/编辑操作员弹窗（el-dialog）
      数据流说明（从网页到数据库）：
      1) 用户点“新增/编辑”，前端把（空数据/旧数据）放入 createForm（这一步就叫“回显”）
      2) 用户点“确定”，前端把表单数据通过 axios 发给后端
      3) 后端根据接口（POST=新增 / PUT=编辑）写入 SQL Server 的 Sys_Users 表
      4) 保存成功后：关闭弹窗 + 刷新表格 + 弹提示
    -->
    <el-dialog
      v-model="createDialogVisible"
      :title="dialogTitle"
      width="560px"
      :close-on-click-modal="false"
    >
      <el-form
        ref="createFormRef"
        :model="createForm"
        :rules="activeRules"
        label-width="90px"
        status-icon
      >
        <!-- 关键：工号（UserCode） -->
        <el-form-item label="工号" prop="UserCode">
          <el-input v-model="createForm.UserCode" placeholder="请输入工号" clearable />
        </el-form-item>

        <!-- 关键：姓名（UserName） -->
        <el-form-item label="姓名" prop="UserName">
          <el-input v-model="createForm.UserName" placeholder="请输入姓名" clearable />
        </el-form-item>

        <!-- v1.0.7：角色（RoleID 写入 Sys_Users，对应 Sys_Roles） -->
        <el-form-item label="角色" prop="RoleID">
          <el-select v-model="createForm.RoleID" placeholder="请选择角色" style="width: 100%" clearable>
            <el-option
              v-for="r in roles"
              :key="r.RoleID"
              :label="r.Description ? `${r.RoleName}（${r.Description}）` : String(r.RoleName)"
              :value="r.RoleID"
            />
          </el-select>
        </el-form-item>

        <!-- 关键：密码（Password） -->
        <el-form-item label="密码" prop="Password">
          <el-input
            v-model="createForm.Password"
            :placeholder="dialogMode === 'edit' ? '留空表示不修改密码' : '请输入密码'"
            show-password
            clearable
          />
        </el-form-item>
      </el-form>

      <template #footer>
        <el-button @click="createDialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="creating" @click="submitCreateForm">确定</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import axios from 'axios'
import { Plus, Refresh, RefreshLeft, Setting } from '@element-plus/icons-vue'

/** 页面标题（与左侧菜单一致） */
const pageTitle = '操作员资料'

/**
 * 页面状态
 * - users：表格数据（来自 Sys_Users）
 * - loading：加载状态
 * - errorMessage：错误提示（用于页面内展示）
 */
const users = ref([])
/** v1.0.7：角色下拉数据（GET /api/roles） */
const roles = ref([])
const loading = ref(false)
const errorMessage = ref('')

/**
 * 当前视图状态（双视图切换的核心变量）
 * 小白版解释：
 * - 这个变量会直接控制后端 SQL 的 WHERE Status = ?
 * - 1 = 在职操作员（启用）
 * - 0 = 恢复操作员（回收站/禁用）
 */
const selectedStatus = ref(1)

/**
 * 搜索关键字（前端）
 * 小白版解释：
 * - 你在输入框里打的“工号/姓名”，会放到这个变量里
 * - 查询时，我们把它作为 keyword 参数传给后端
 */
const keyword = ref('')

/**
 * 分页状态（前端）
 * 小白版解释：
 * - page：当前第几页
 * - pageSize：每页显示几条（默认 10）
 * - total：总共有多少条（由后端返回）
 */
const page = ref(1)
const pageSize = ref(10)
const total = ref(0)

/**
 * 新增弹窗状态
 * - createDialogVisible：控制弹窗显示/隐藏
 * - creating：控制“确定”按钮 loading，防止重复提交
 */
const createDialogVisible = ref(false)
const creating = ref(false)

/**
 * 新增表单数据（字段名与后端一致）
 * - UserCode：工号
 * - UserName：姓名
 * - Password：密码
 */
const createForm = ref({
  // 关键：UserID 只在“编辑/禁用”时需要，用来告诉后端“改哪一行”
  UserID: undefined,
  UserCode: '',
  UserName: '',
  Password: '',
  // v1.0.7：外键 RoleID → Sys_Roles
  RoleID: undefined,
})

/**
 * 表单实例引用（用于触发表单校验）
 */
const createFormRef = ref()

/**
 * 弹窗模式（新增 / 编辑）
 * 小白版解释：
 * - 新增：没有 UserID
 * - 编辑：必须带 UserID，才能精确更新数据库里那一行
 */
const dialogMode = ref('create')

/**
 * 弹窗标题（根据模式变化）
 */
const dialogTitle = computed(() => (dialogMode.value === 'edit' ? '编辑操作员' : '新增操作员'))

/**
 * 新增表单校验规则（前端第一道防线）
 * 说明：
 * - 后端也有必填校验，前端校验是为了更快反馈用户
 */
const createRules = {
  UserCode: [{ required: true, message: '请输入工号', trigger: 'blur' }],
  UserName: [{ required: true, message: '请输入姓名', trigger: 'blur' }],
  Password: [{ required: true, message: '请输入密码', trigger: 'blur' }],
  RoleID: [{ required: true, message: '请选择角色', trigger: 'change' }],
}

/**
 * 编辑表单校验规则
 * 小白版解释：
 * - 编辑时“密码”允许不填：不填就代表“不修改密码”
 */
const editRules = {
  UserCode: [{ required: true, message: '请输入工号', trigger: 'blur' }],
  UserName: [{ required: true, message: '请输入姓名', trigger: 'blur' }],
  Password: [{ required: false, message: '', trigger: 'blur' }],
  RoleID: [{ required: true, message: '请选择角色', trigger: 'change' }],
}

/**
 * 当前生效的校验规则（随弹窗模式切换）
 */
const activeRules = computed(() => (dialogMode.value === 'edit' ? editRules : createRules))

/**
 * 关键：格式化创建时间
 * 说明：
 * - 后端通常返回 ISO 字符串或 Date 可序列化值
 * - 这里统一转成本地时间字符串，便于阅读
 */
function formatDateTime(row, column, cellValue) {
  if (!cellValue) return ''
  const d = new Date(cellValue)
  // 关键：无效日期直接返回原值，避免页面报错
  if (Number.isNaN(d.getTime())) return String(cellValue)
  return d.toLocaleString()
}

/** v1.0.7：新增操作员时默认选中 Viewer（若尚未加载角色则返回 undefined） */
function defaultRoleIdForCreate() {
  const viewer = roles.value.find((x) => String(x.RoleName) === 'Viewer')
  return viewer?.RoleID ?? roles.value[0]?.RoleID
}

/**
 * 加载角色列表（与 Sys_Roles 同步）
 */
async function loadRoles() {
  try {
    // v1.0.7：角色接口已分页；下拉框只取启用中的角色，放宽 pageSize 即可
    const res = await axios.get('/api/roles', {
      params: { page: 1, pageSize: 500, status: 1 },
    })
    const json = res.data
    if (json?.code === 200 && Array.isArray(json.list)) {
      roles.value = json.list
    } else {
      roles.value = []
    }
  } catch {
    roles.value = []
  }
}

/**
 * 从后端读取 Sys_Users
 * 数据流说明（从数据库到网页）：
 * 1) 浏览器加载本页面后触发 onMounted
 * 2) loadUsers 使用 axios 请求 GET /api/users
 * 3) Vite 开发服务器将 /api 代理到后端（vite.config.js）
 * 4) 后端 /api/users 连接 SQL Server，查询 Sys_Users 表并返回 {code,msg,data}
 * 5) 前端拿到 data 数组后赋值给 users，el-table 自动渲染到页面
 */
async function loadUsers() {
  // 关键：进入加载态，避免用户重复点击和表格闪烁
  loading.value = true
  // 关键：清空旧错误提示
  errorMessage.value = ''

  try {
    // 关键：调用后端分页接口（把 page/pageSize 作为查询参数传给后端）
    // 最终请求会长这样：/api/users?page=1&pageSize=10
    const res = await axios.get('/api/users', {
      params: {
        page: page.value,
        pageSize: pageSize.value,
        // 关键：如果 keyword 为空，就不传；如果不为空，就传给后端做模糊搜索
        keyword: String(keyword.value || '').trim() || undefined,
        // 关键：把当前视图状态传给后端（后端用它来拼 WHERE Status = @status）
        status: selectedStatus.value,
      },
    })
    // 关键：取出后端 JSON 数据（axios 会把响应体放在 res.data）
    const json = res.data

    // 关键：按约定 code=200 视为成功
    if (json?.code !== 200) {
      const msg = json?.msg || '读取失败'
      errorMessage.value = msg
      ElMessage.error(msg)
      users.value = []
      total.value = 0
      return
    }

    // 关键：将用户列表写入响应式变量，触发表格更新
    users.value = Array.isArray(json.list) ? json.list : []
    // 关键：把后端返回的 total 保存下来，分页器才能显示“总条数”
    total.value = Number(json.total ?? 0)

    // 关键：如果你在最后一页把数据禁用/编辑导致本页空了，就自动回退一页再查一次（避免出现空白页）
    if (users.value.length === 0 && total.value > 0 && page.value > 1) {
      page.value = page.value - 1
      await loadUsers()
      return
    }

    if (users.value.length === 0) {
      ElMessage.info('Sys_Users 暂无数据')
    }
  } catch (e) {
    // 典型原因：
    // - 后端服务未启动
    // - Vite 代理未生效
    // - 网络/端口被占用
    // 关键：网络错误/代理错误/后端异常都会走到这里
    const msg = '接口请求失败：请确认后端已启动（npm run dev:server）并检查 .env 配置'
    errorMessage.value = msg
    ElMessage.error(msg)
    users.value = []
    total.value = 0
  } finally {
    // 关键：结束加载态
    loading.value = false
  }
}

/**
 * 打开新增弹窗
 * 说明：
 * - 打开前清空旧表单，避免上一次输入残留
 */
function openCreateDialog() {
  // 关键：重置表单字段
  createForm.value = {
    UserID: undefined,
    UserCode: '',
    UserName: '',
    Password: '',
    RoleID: defaultRoleIdForCreate(),
  }
  // 关键：标记当前是“新增模式”（后续提交用 POST）
  dialogMode.value = 'create'
  // 关键：显示弹窗
  createDialogVisible.value = true
}

/**
 * 打开编辑弹窗（回显旧数据）
 *
 * 小白版解释：你问的“旧数据怎么抓到新弹窗？”就是这里实现的：
 * - 表格每一行 row 就是这一行的旧数据
 * - 我们把 row.UserCode / row.UserName 直接赋值给 createForm
 * - createForm 又绑定在输入框 v-model 上，所以输入框就自动显示旧值（这就是回显）
 */
function openEditDialog(row) {
  // 关键：切换成“编辑模式”（后续提交用 PUT）
  dialogMode.value = 'edit'

  // 关键：把旧数据复制到表单里（输入框会立刻显示出来）
  // 注意：Password 不回显（安全原因），默认留空表示“不修改密码”
  createForm.value = {
    UserID: row?.UserID,
    UserCode: row?.UserCode ?? '',
    UserName: row?.UserName ?? '',
    Password: '',
    RoleID: row?.RoleID,
  }

  // 关键：打开弹窗
  createDialogVisible.value = true
}

/**
 * 提交新增表单
 * 说明：
 * - 先做前端校验
 * - 校验通过后调用 POST /api/users
 * - 成功后：关闭弹窗、刷新列表、提示“添加成功”
 */
async function submitCreateForm() {
  // 关键：若表单还未渲染完成，直接返回（避免空引用报错）
  if (!createFormRef.value) return

  // 关键：触发表单校验，只有通过才允许提交
  await createFormRef.value.validate(async (valid) => {
    // 关键：未通过校验则不提交
    if (!valid) return

    // 关键：进入提交中状态，防止用户重复点击
    creating.value = true
    try {
      // 关键：根据“新增/编辑”决定调用哪个接口
      // - 新增：POST /api/users
      // - 编辑：PUT /api/users
      const isEdit = dialogMode.value === 'edit'

      // 关键：准备要提交给后端的数据
      // 小白版解释：这里就是“把弹窗输入框里的新数据，打包发给后端”
      const payload = {
        // 关键：编辑必须带 UserID（否则后端不知道改哪一行）
        ...(isEdit ? { UserID: createForm.value.UserID } : {}),
        UserCode: createForm.value.UserCode,
        UserName: createForm.value.UserName,
        // 关键：编辑时 Password 留空=不改；我们仍然把它发给后端也没问题
        // 后端会判断“是否为空”，为空就不更新密码
        Password: createForm.value.Password,
        RoleID: createForm.value.RoleID,
      }

      // 关键：按模式发请求
      const res = isEdit ? await axios.put('/api/users', payload) : await axios.post('/api/users', payload)

      // 关键：解析后端返回 JSON（axios 把响应体放在 res.data）
      const json = res.data

      // 关键：按约定 code=200 视为成功
      if (json?.code !== 200) {
        ElMessage.error(json?.msg || (dialogMode.value === 'edit' ? '保存失败' : '新增失败'))
        return
      }

      // 关键：提示成功
      ElMessage.success(dialogMode.value === 'edit' ? '保存成功' : '添加成功')
      // 关键：关闭弹窗
      createDialogVisible.value = false
      // 关键：刷新表格数据，让新用户立即出现在列表里
      // 小白版解释：新增成功后，一般希望立刻在第一页看到新数据（因为我们按 CreatedAt DESC 排序）
      if (dialogMode.value === 'create') {
        page.value = 1
      }
      await loadUsers()
    } catch (e) {
      // 关键：网络异常/后端异常时给出提示（不要只提示“请求失败”，要尽量显示后端返回的中文原因）
      // 小白版解释：
      // - axios 如果收到后端返回的 400/500，会把响应放在 e.response 里
      // - 我们优先取 e.response.data.msg（这是后端写给你看的中文提示）
      // - 如果拿不到（比如真断网/后端没启动），再给一个兜底提示
      const backendMsg = e?.response?.data?.msg
      ElMessage.error(backendMsg || '请求失败：请检查后端接口 /api/users 是否正常')
    } finally {
      // 关键：退出提交中状态
      creating.value = false
    }
  })
}

/**
 * 禁用用户（二次确认）
 *
 * 小白版解释：为什么要二次确认？
 * - 禁用后用户就不能用了，容易误点
 * - 所以弹出确认框让你再点一次“确定”
 */
async function confirmDisable(row) {
  // 关键：先拿到要禁用的 UserID
  const userId = row?.UserID
  if (!userId) {
    ElMessage.error('禁用失败：缺少 UserID')
    return
  }

  try {
    // 关键：弹出二次确认框（用户点“取消”会直接抛出异常，我们在 catch 里忽略）
    await ElMessageBox.confirm(
      `确定要禁用工号为【${row?.UserCode ?? ''}】的用户吗？`,
      '二次确认',
      {
        confirmButtonText: '确定',
        cancelButtonText: '取消',
        type: 'warning',
      },
    )

    // 关键：调用 PUT /api/users，把 Status 更新为 0（禁用）
    const res = await axios.put('/api/users', { UserID: userId, Status: 0 })
    const json = res.data

    // 关键：按约定 code=200 视为成功
    if (json?.code !== 200) {
      ElMessage.error(json?.msg || '禁用失败')
      return
    }

    // 关键：提示成功并刷新列表
    // 小白版解释：禁用相当于“移入回收站”，并不是彻底删除
    ElMessage.success('已移入回收站')
    await loadUsers()
  } catch (e) {
    // 关键：用户点“取消”或关闭对话框，会走到这里；我们不提示错误，避免打扰
  }
}

/**
 * 切换页码（分页器事件）
 * 小白版解释：你点“下一页”时，这个函数会拿到新页码，然后重新查这一页的数据
 */
async function onPageChange(newPage) {
  page.value = Number(newPage)
  await loadUsers()
}

/**
 * 切换每页条数（分页器事件）
 * 小白版解释：你把每页从 10 改成 20 时，我们会回到第 1 页重新查（避免页码超出范围）
 */
async function onPageSizeChange(newSize) {
  pageSize.value = Number(newSize)
  page.value = 1
  await loadUsers()
}

/**
 * 点击“查询”或按回车触发搜索
 * 小白版解释：
 * - 你一旦开始搜索，就必须回到第 1 页（因为搜索结果的页数是重新计算的）
 */
async function onSearch() {
  page.value = 1
  await loadUsers()
}

/**
 * 点击“重置”清空搜索并刷新
 * 小白版解释：
 * - 把输入框清空
 * - 回到第 1 页
 * - 重新请求后端拿“完整列表”
 */
async function onReset() {
  keyword.value = ''
  page.value = 1
  await loadUsers()
}

/**
 * 恢复用户（Status 从 0 改回 1）
 */
async function resumeUser(row) {
  // 关键：拿到要恢复的 UserID
  const userId = row?.UserID
  if (!userId) {
    ElMessage.error('恢复失败：缺少 UserID')
    return
  }

  try {
    // 关键：恢复属于“重要操作”，也做一次确认（避免误点）
    await ElMessageBox.confirm(
      `确定要恢复工号为【${row?.UserCode ?? ''}】的用户吗？`,
      '二次确认',
      {
        confirmButtonText: '确定',
        cancelButtonText: '取消',
        type: 'warning',
      },
    )

    // 关键：调用后端恢复接口 PUT /api/users/resume
    const res = await axios.put('/api/users/resume', { UserID: userId })
    const json = res.data

    // 关键：按约定 code=200 视为成功
    if (json?.code !== 200) {
      ElMessage.error(json?.msg || '恢复失败')
      return
    }

    // 关键：提示成功并刷新
    ElMessage.success('已恢复在职')
    await loadUsers()
  } catch (e) {
    // 关键：用户取消时不提示
  }
}

/**
 * 彻底删除用户（物理删除）
 *
 * 小白版解释：
 * - 这个操作不可恢复，所以我们用更“危险”的确认弹窗提示你
 * - 后端也会强制检查：必须先禁用（Status=0）才能删除
 */
async function deleteUser(row) {
  // 关键：拿到要删除的 UserID
  const userId = row?.UserID
  if (!userId) {
    ElMessage.error('删除失败：缺少 UserID')
    return
  }

  try {
    // 关键：危险提示（不可恢复）
    await ElMessageBox.confirm(
      `这是危险操作：将彻底删除工号为【${row?.UserCode ?? ''}】的用户，删除后不可恢复。\n\n确定继续吗？`,
      '危险警告',
      {
        confirmButtonText: '我确认删除',
        cancelButtonText: '取消',
        type: 'error',
        dangerouslyUseHTMLString: false,
      },
    )

    // 关键：调用后端 DELETE /api/users/:id
    const res = await axios.delete(`/api/users/${userId}`)
    const json = res.data

    // 关键：按约定 code=200 视为成功
    if (json?.code !== 200) {
      ElMessage.error(json?.msg || '删除失败')
      return
    }

    ElMessage.success('删除成功')
    await loadUsers()
  } catch (e) {
    // 关键：用户取消时不提示；如果后端返回 400/500，axios 会进 catch，这里优先提示后端 msg
    const backendMsg = e?.response?.data?.msg
    if (backendMsg) ElMessage.error(backendMsg)
  }
}

/**
 * 切换视图（双视图切换的统一入口）
 *
 * 小白版解释（最重要的一句）：
 * - 你点按钮时，我们把 selectedStatus 改成 1 或 0
 * - loadUsers 请求后端时会带上 status=selectedStatus
 * - 后端 SQL 里用 WHERE Status = @status
 * - 所以“一个变量 selectedStatus”就能控制后端查在职还是回收站
 *
 * @param {0|1} nextStatus
 */
async function switchToStatus(nextStatus) {
  // 关键：如果本来就在这个视图，就不重复刷新
  if (selectedStatus.value === nextStatus) return

  // 关键：更新当前视图状态
  selectedStatus.value = nextStatus

  // 关键：切换视图时清空搜索关键字
  keyword.value = ''

  // 关键：切换视图时把分页重置为第一页
  page.value = 1

  // 关键：切换视图时每页条数回到 10（符合模块标准）
  pageSize.value = 10

  // 关键：重新加载列表
  await loadUsers()
}

onMounted(async () => {
  // v1.0.7：先拉角色字典，再加载用户列表（新增弹窗默认角色依赖 roles）
  await loadRoles()
  loadUsers()
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
.header-actions {
  display: inline-flex;
  align-items: center;
  gap: 8px;
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
  /* 关键：flex + wrap，让按钮在一行放不下时自动换行（响应式） */
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin: 10px 0 12px;
}
.toolbar-btn {
  /* 关键：把按钮变成你图片里的“大方块按钮” */
  height: 45px;
  padding: 0 18px;
  border-radius: 8px;
  font-weight: 500;
}
.btn-icon {
  margin-right: 8px;
}
.btn-action {
  /* 关键：其他按钮用浅蓝色背景（你可以在这里改颜色） */
  /* 小白提示：如果你想更浅/更深，就把这个颜色改掉 */
  background-color: #d6ecff;
  border-color: #bcdfff;
  color: #1f5faa;
}
.btn-view {
  /* 关键：视图切换按钮的“未选中”样式（默认浅蓝） */
  background-color: #d6ecff;
  border-color: #bcdfff;
  color: #1f5faa;
}
.toolbar-btn.is-active {
  /* 关键：当前选中的视图按钮“激活样式” */
  border-width: 2px;
  box-shadow: 0 0 0 2px rgba(31, 95, 170, 0.12) inset;
  font-weight: 700;
}
.btn-view.is-active {
  /* 关键：视图切换按钮“选中态”改成橙色（和你说的“管理操作员那个颜色”一致） */
  /* 小白提示：要改橙色，就改 background-color / border-color */
  background-color: #e67e22;
  border-color: #e67e22;
  color: #fff;
  /* 关键：选中态边框更深，更明显 */
  box-shadow: 0 0 0 2px rgba(184, 95, 18, 0.14) inset;
}
.pagination-row {
  display: flex;
  justify-content: flex-end;
  margin-top: 12px;
}
</style>
