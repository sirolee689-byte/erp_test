<template>
  <el-container class="erp-layout">
    <ErpSidebar
      :aside-width="asideWidth"
      :collapsed="isCollapsed"
      :menu-nodes="filteredMenuStructure"
      :active-path="active"
    />
    <el-container class="erp-main-column">
      <el-header class="erp-header" height="56px">
        <el-button class="collapse-btn" text @click="toggleCollapse">
          <el-icon :size="18">
            <component :is="isCollapsed ? Expand : Fold" />
          </el-icon>
        </el-button>
        <span class="erp-header-title">{{ headerTitle }}</span>

        <!--
          右上角用户区（工业感 + 简洁）
          小白版解释：
          - 登录成功后，我们把用户信息写进 localStorage 的 erp_user
          - 这里负责把用户名显示出来，并提供下拉菜单（修改密码 / 退出登录）
        -->
        <div class="erp-header-right">
          <div class="erp-ui-density" title="调整字号与按钮大小，设置会保存在本浏览器">
            <span class="erp-ui-density-label">显示</span>
            <el-radio-group v-model="uiDensityModel" size="small">
              <el-radio-button :value="UI_DENSITY_COMFORTABLE">舒适</el-radio-button>
              <el-radio-button :value="UI_DENSITY_STANDARD">标准</el-radio-button>
            </el-radio-group>
          </div>
          <!--
            用户名下拉菜单（你要求的：用户名下拉里增加“修改密码”）
            小白版解释：
            - el-dropdown 是 Element Plus 的下拉组件
            - 点用户名区域，就会弹出菜单
          -->
          <el-dropdown trigger="click" @command="onUserCommand">
            <div class="erp-user erp-user-dropdown">
              <el-icon class="erp-user-icon" :size="16">
                <UserFilled />
              </el-icon>
              <span class="erp-user-text">{{ displayName }}</span>
              <el-icon class="erp-user-arrow" :size="14">
                <ArrowDown />
              </el-icon>
            </div>

            <template #dropdown>
              <el-dropdown-menu>
                <!-- 修改密码（带 Edit 图标） -->
                <el-dropdown-item command="changePassword">
                  <el-icon class="menu-icon" :size="16"><Edit /></el-icon>
                  修改密码
                </el-dropdown-item>

                <!-- 退出登录（带 SwitchButton 图标） -->
                <el-dropdown-item divided command="logout">
                  <el-icon class="menu-icon" :size="16"><SwitchButton /></el-icon>
                  退出登录
                </el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
        </div>
      </el-header>
      <ErpAppMain>
        <template #tags>
          <!-- 多标签导航：sticky 悬顶，内容区滚动时标签栏保持可见 -->
          <div v-if="visitedViews.length" class="erp-tags-wrap">
            <el-tabs
              v-model="activeTabPath"
              type="card"
              class="erp-route-tabs"
              @tab-click="onTagsTabClick"
              @tab-remove="onTagsTabRemove"
            >
              <el-tab-pane v-for="v in visitedViews" :key="v.path" :name="v.path" :closable="true">
                <template #label>
                  <el-dropdown trigger="contextmenu" @command="(cmd) => onTagMenuCommand(cmd, v)">
                    <span class="erp-tab-label">{{ v.title }}</span>
                    <template #dropdown>
                      <el-dropdown-menu>
                        <el-dropdown-item command="closeOthers">关闭其它</el-dropdown-item>
                        <el-dropdown-item command="closeAll">关闭全部</el-dropdown-item>
                        <el-dropdown-item divided command="refresh">刷新</el-dropdown-item>
                      </el-dropdown-menu>
                    </template>
                  </el-dropdown>
                </template>
              </el-tab-pane>
            </el-tabs>
          </div>
        </template>
        <router-view v-slot="{ Component, route: viewRoute }">
          <keep-alive :include="cachedAliveNames" :max="40">
            <component
              :is="resolveRouteAliveComponent(Component, viewRoute.name)"
              :key="routeComponentKey"
            />
          </keep-alive>
        </router-view>
      </ErpAppMain>
    </el-container>
  </el-container>

  <!--
    修改密码对话框（Dialog）
    需求：旧密码 / 新密码 / 确认新密码，全部支持 show-password
  -->
  <el-dialog v-model="changePwdVisible" title="修改密码" width="460px" :close-on-click-modal="false">
    <el-form ref="changePwdFormRef" :model="changePwdForm" :rules="changePwdRules" label-width="90px" status-icon>
      <el-form-item label="旧密码" prop="oldPassword">
        <el-input v-model="changePwdForm.oldPassword" show-password clearable placeholder="请输入旧密码" />
      </el-form-item>
      <el-form-item label="新密码" prop="newPassword">
        <el-input v-model="changePwdForm.newPassword" show-password clearable placeholder="请输入新密码" />
      </el-form-item>
      <el-form-item label="确认密码" prop="confirmPassword">
        <el-input v-model="changePwdForm.confirmPassword" show-password clearable placeholder="请再次输入新密码" />
      </el-form-item>
    </el-form>

    <template #footer>
      <el-button @click="changePwdVisible = false">取消</el-button>
      <el-button type="primary" :loading="changePwdSaving" @click="submitChangePassword">确定修改</el-button>
    </template>
  </el-dialog>
</template>

<script setup>
import { computed, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import rawMenuStructure from '../../erp_structure_dump.json'
import {
  filterMenuTreeByPermission,
  getFirstPermittedRoutePath,
  getPermissionModelFromStorage,
} from '@/utils/menuPermission'
import { useTagsViewStore } from '@/store/modules/tagsView'
import { useUiDensity } from '@/composables/useUiDensity'
import ErpAppMain from './ErpAppMain.vue'
import ErpSidebar from './ErpSidebar.vue'
import { resolveRouteAliveComponent } from './resolveRouteAliveComponent.js'
import axios from 'axios'
import { ElMessage, ElMessageBox } from 'element-plus'
import { ArrowDown, Edit, Expand, Fold, SwitchButton, UserFilled } from '@element-plus/icons-vue'

const route = useRoute()
const router = useRouter()

const {
  density: uiDensity,
  setDensity: setUiDensity,
  UI_DENSITY_COMFORTABLE,
  UI_DENSITY_STANDARD,
} = useUiDensity()

const uiDensityModel = computed({
  get: () => uiDensity.value,
  set: (v) => setUiDensity(v),
})

const active = computed(() => route.path)
const headerTitle = computed(() => (route.meta.title ? String(route.meta.title) : '首页'))

/** 多标签：与路由同步 */
const tagsStore = useTagsViewStore()
const visitedViews = computed(() => tagsStore.state.visitedViews)

watch(
  () => route.fullPath,
  () => {
    tagsStore.addVisitedView(route)
  },
  { immediate: true },
)

/** Tab v-model 与当前 path 双向对齐（点击 Tab 时 push） */
const activeTabPath = computed({
  get: () => route.path,
  set: (p) => {
    const next = String(p ?? '')
    if (next && next !== route.path) router.push(next)
  },
})

/** keep-alive 按路由 name（须与页面 defineOptions name 一致） */
const cachedAliveNames = computed(() =>
  tagsStore.state.visitedViews.map((v) => v.name).filter((n) => String(n).length > 0),
)

/** 右键「刷新」：按路由 name 递增 key，强制重挂载当前缓存页 */
const refreshTickByName = reactive({})
const routeComponentKey = computed(() => {
  const n = route.name != null ? String(route.name) : ''
  const t = n ? refreshTickByName[n] || 0 : 0
  return `${n}:${t}`
})

function bumpRefreshForRouteName(routeName) {
  const n = String(routeName ?? '')
  if (!n) return
  refreshTickByName[n] = (refreshTickByName[n] || 0) + 1
}

/** Tab 点击：Element Plus 传入 (pane, event)，路径取 pane.props.name */
function onTagsTabClick(tab) {
  const path = tab?.props?.name != null ? String(tab.props.name) : ''
  if (path && path !== route.path) router.push(path)
}

/** @param {string | number} targetPath */
function onTagsTabRemove(targetPath) {
  const p = String(targetPath)
  const closingActive = route.path === p
  const next = tagsStore.delVisitedView(p)
  if (!closingActive) return
  if (next) router.push(next.path)
  else router.push(getFirstPermittedRoutePath(rawMenuStructure))
}

/**
 * @param {'closeOthers' | 'closeAll' | 'refresh'} cmd
 * @param {{ title: string, path: string, name: string }} v
 */
function onTagMenuCommand(cmd, v) {
  if (cmd === 'closeOthers') {
    tagsStore.delOthersViews(v.path)
    if (route.path !== v.path) router.push(v.path)
    return
  }
  if (cmd === 'closeAll') {
    tagsStore.delAllViews()
    router.push(getFirstPermittedRoutePath(rawMenuStructure))
    return
  }
  if (cmd === 'refresh') {
    const go = route.path !== v.path ? router.push(v.path) : Promise.resolve()
    go.then(() => {
      bumpRefreshForRouteName(route.name)
    })
  }
}

/**
 * 根据 localStorage 中 erp_user.Permissions 递归过滤菜单树（算法见 @/utils/menuPermission.js）
 * 说明：localStorage 非响应式，登录后首次进入布局会读最新；若管理员改权限，用户需重新登录后生效。
 */
const filteredMenuStructure = computed(() => {
  const model = getPermissionModelFromStorage()
  return filterMenuTreeByPermission(rawMenuStructure, model, '')
})

const isCollapsed = ref(false)
const asideWidth = computed(() => (isCollapsed.value ? '64px' : '220px'))

function toggleCollapse() {
  isCollapsed.value = !isCollapsed.value
}

/**
 * 获取当前登录人的显示名称
 * 小白版解释：
 * - 登录成功后，我们在登录页把用户信息存进 localStorage：erp_user
 * - localStorage 里只能存字符串，所以我们用 JSON.stringify 存，读取时再 JSON.parse 还原
 */
const displayName = computed(() => {
  // 关键：读取 localStorage 里的用户信息字符串
  const raw = localStorage.getItem('erp_user')
  // 关键：如果没有存过，就给一个默认显示
  if (!raw) return '已登录'

  try {
    // 关键：把 JSON 字符串还原成对象
    const user = JSON.parse(raw)
    // 关键：优先显示姓名，其次显示工号
    const name = String(user?.UserName ?? '').trim()
    const code = String(user?.UserCode ?? '').trim()
    return name || code || '已登录'
  } catch (e) {
    // 关键：如果 JSON 解析失败（比如手动改坏了），也别让页面报错
    return '已登录'
  }
})

/**
 * 清理登录缓存（退出登录的第 1 步：清理现场）
 * 小白版解释（重点讲 clear()）：
 * - localStorage / sessionStorage 都是浏览器提供的“本地小仓库”
 * - 它们里面是一对一对的：key（钥匙名）-> value（内容）
 * - 我们登录时写了：
 *   - erp_token：登录凭证
 *   - erp_user：用户信息
 *
 * 清理方式有两种：
 * 1) removeItem(key)：只删除某一个 key（更安全，不影响别的功能缓存）
 * 2) clear()：把这个仓库里“所有 key 全部清空”（最干净，但可能误删别的模块缓存）
 *
 * 本项目为了“干净利落 + 不误伤”，优先用 removeItem 精准删除；
 * 如果你确定整个系统只有我们这几个 key，也可以改成 clear() 一键清空。
 */
function clearAuthStorage() {
  // =========================
  // 1) 精准删除（推荐）
  // =========================
  // 关键：删除 localStorage 里的 token
  localStorage.removeItem('erp_token')
  // 关键：删除 localStorage 里的用户信息
  localStorage.removeItem('erp_user')

  // 关键：如果你未来把 token 放进 sessionStorage，这里也一起清掉（避免漏清）
  sessionStorage.removeItem('erp_token')
  sessionStorage.removeItem('erp_user')

  // =========================
  // 2) 一键清空（可选，不默认启用）
  // =========================
  // 小白版解释：
  // - clear() 会把仓库里的内容全部删除
  // - 删除后：localStorage.length 会变成 0（表示一个 key 都不剩）
  // - 风险：如果你别的页面也存了缓存（比如主题色/分页大小），也会一起被清掉
  //
  // localStorage.clear()
  // sessionStorage.clear()
}

/**
 * 执行退出登录（供“菜单退出”和“改密成功强制退出”复用）
 */
async function doLogout() {
  // 关键：清理缓存（把 token 和用户信息删掉）
  clearAuthStorage()

  // 关键：强制跳转到登录页，不给留在后台的机会
  await router.push('/login')
}

/**
 * 点击“退出登录”（退出登录的完整流程）
 */
async function onLogoutClick() {
  try {
    // 关键：二次确认，避免误点
    await ElMessageBox.confirm('确定要退出系统吗？', '二次确认', {
      confirmButtonText: '确定退出',
      cancelButtonText: '取消',
      type: 'warning',
    })

    // 关键：提示用户已登出
    ElMessage.success('已退出登录')

    // 关键：强制跳转到登录页，不给留在后台的机会
    await doLogout()
  } catch (e) {
    // 关键：用户点取消时不提示错误
  }
}

/**
 * 用户下拉菜单点击事件
 * @param {'changePassword' | 'logout'} command
 */
async function onUserCommand(command) {
  if (command === 'logout') {
    await onLogoutClick()
    return
  }
  if (command === 'changePassword') {
    openChangePasswordDialog()
  }
}

// =========================
// 修改密码：对话框状态
// =========================
const changePwdVisible = ref(false)
const changePwdSaving = ref(false)
const changePwdFormRef = ref()

// 关键：表单数据（旧/新/确认）
const changePwdForm = reactive({
  oldPassword: '',
  newPassword: '',
  confirmPassword: '',
})

/**
 * 表单校验规则
 * 小白版解释：
 * - Element Plus 的表单校验会根据 rules 检查输入框
 * - confirmPassword 用自定义校验：必须与 newPassword 一致
 */
const changePwdRules = {
  oldPassword: [{ required: true, message: '请输入旧密码', trigger: 'blur' }],
  newPassword: [{ required: true, message: '请输入新密码', trigger: 'blur' }],
  confirmPassword: [
    { required: true, message: '请再次输入新密码', trigger: 'blur' },
    {
      validator: (rule, value, callback) => {
        // 关键：value 就是“确认密码”输入框当前值
        const confirm = String(value ?? '')
        const next = String(changePwdForm.newPassword ?? '')
        if (!confirm) {
          callback(new Error('请再次输入新密码'))
          return
        }
        if (confirm !== next) {
          callback(new Error('两次输入的新密码不一致'))
          return
        }
        callback()
      },
      trigger: 'blur',
    },
  ],
}

/**
 * 打开“修改密码”对话框
 */
function openChangePasswordDialog() {
  // 关键：每次打开都清空旧输入，避免上次残留
  changePwdForm.oldPassword = ''
  changePwdForm.newPassword = ''
  changePwdForm.confirmPassword = ''

  // 关键：显示对话框
  changePwdVisible.value = true
}

/**
 * 提交修改密码
 * 需求：
 * - 校验新密码与确认密码一致
 * - 调后端 PUT /api/users/change-password
 * - 成功后必须自动退出登录，让用户重新登录
 */
async function submitChangePassword() {
  // 关键：表单未挂载时直接返回（防空引用）
  if (!changePwdFormRef.value) return

  // 关键：先跑一遍表单校验（不通过就不发请求）
  await changePwdFormRef.value.validate(async (valid) => {
    if (!valid) return

    changePwdSaving.value = true
    try {
      // 关键：从 localStorage 读取 token（后端用它识别“当前是谁”）
      const token = String(localStorage.getItem('erp_token') ?? '').trim()
      if (!token) {
        ElMessage.error('未检测到登录信息，请重新登录')
        await doLogout()
        return
      }

      // 关键：调用后端接口（把 token 放到 Authorization 头里）
      const res = await axios.put(
        '/api/users/change-password',
        {
          // 关键：后端会先验证旧密码是否正确
          oldPassword: String(changePwdForm.oldPassword ?? ''),
          // 关键：后端会把密码更新为新密码
          newPassword: String(changePwdForm.newPassword ?? ''),
        },
        {
          headers: {
            // 关键：Bearer token 是最常见的写法
            Authorization: `Bearer ${token}`,
          },
        },
      )

      const json = res.data
      if (json?.code !== 200) {
        ElMessage.error(json?.msg || '修改失败')
        return
      }

      // 关键：提示成功
      ElMessage.success('密码修改成功，请重新登录')

      // 关键：关闭对话框
      changePwdVisible.value = false

      // 关键：安全要求：修改成功后必须退出登录
      await doLogout()
    } catch (e) {
      // 关键：优先显示后端返回的中文错误
      const backendMsg = e?.response?.data?.msg
      ElMessage.error(backendMsg || '修改密码接口请求失败：请确认后端已启动并检查网络/端口')
    } finally {
      changePwdSaving.value = false
    }
  })
}
</script>

<style scoped>
.erp-layout {
  min-height: 100vh;
}
/* 右侧列占满剩余宽度，避免主内容变化时挤压侧栏 */
.erp-main-column {
  flex: 1;
  min-width: 0;
}
.erp-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 12px;
  background: #fff;
  border-bottom: 1px solid var(--el-border-color-lighter);
}
.erp-header-right {
  /* 关键：把右侧用户区推到最右边 */
  margin-left: auto;
  display: inline-flex;
  align-items: center;
  gap: 12px;
}
.erp-ui-density {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 4px 8px;
  border-radius: 8px;
  background: rgba(15, 23, 42, 0.04);
  border: 1px solid rgba(15, 23, 42, 0.08);
}
.erp-ui-density-label {
  font-size: var(--erp-text-secondary-size, 13px);
  color: var(--el-text-color-regular);
  white-space: nowrap;
}
.erp-user {
  /* 关键：工业感小标签 */
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  border-radius: 10px;
  background: rgba(15, 23, 42, 0.04);
  border: 1px solid rgba(15, 23, 42, 0.08);
  max-width: 240px;
}
.erp-user-dropdown {
  /* 关键：让它看起来像“可点击的下拉” */
  cursor: pointer;
  user-select: none;
}
.erp-user-dropdown:hover {
  background: rgba(15, 23, 42, 0.06);
}
.erp-user-icon {
  color: rgba(15, 23, 42, 0.65);
}
.erp-user-arrow {
  color: rgba(15, 23, 42, 0.45);
}
.erp-user-text {
  color: rgba(15, 23, 42, 0.85);
  font-size: var(--erp-shell-user-size, 13px);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.menu-icon {
  margin-right: 6px;
}
.collapse-btn {
  height: 32px;
  width: 32px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--el-text-color-regular);
}
.collapse-btn:hover {
  background: rgba(0, 0, 0, 0.04);
}
.erp-header-title {
  font-size: var(--erp-shell-title-size, 16px);
  font-weight: 500;
  color: var(--el-text-color-primary);
}
</style>
