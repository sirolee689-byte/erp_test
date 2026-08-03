<template>
  <div class="dining-shell">
    <aside class="desktop-sidebar">
      <DiningNavigation :active-path="route.path" @navigate="navigate" @change-password="openChangePassword" @logout="confirmLogout" />
    </aside>

    <section class="dining-main">
      <header class="dining-header">
        <el-button class="mobile-menu-button" text aria-label="打开菜单" @click="drawerVisible = true">
          <el-icon :size="24"><Menu /></el-icon>
        </el-button>
        <div class="header-main">
          <div class="header-title">{{ route.meta.title || '员工报餐系统' }}</div>
          <div class="header-user">{{ userName }}<span v-if="userCard"> · 卡号 {{ userCard }}</span></div>
        </div>
        <el-button class="header-password-button" text type="primary" :icon="Lock" @click="openChangePassword">修改密码</el-button>
      </header>

      <main class="dining-content">
        <div v-if="checking" class="loading-panel"><el-icon class="is-loading"><Loading /></el-icon> 正在确认登录状态…</div>
        <router-view v-else />
      </main>
    </section>

    <el-drawer v-model="drawerVisible" class="dining-mobile-drawer" direction="ltr" size="82%" :with-header="false">
      <DiningNavigation :active-path="route.path" @navigate="navigate" @change-password="openChangePassword" @logout="confirmLogout" />
    </el-drawer>

    <el-dialog v-model="passwordDialogVisible" title="修改密码" width="420px" :close-on-click-modal="false" destroy-on-close>
      <el-form ref="passwordFormRef" :model="passwordForm" :rules="passwordRules" label-width="88px" status-icon @submit.prevent>
        <el-form-item label="旧密码" prop="oldPassword">
          <el-input v-model="passwordForm.oldPassword" show-password autocomplete="current-password" placeholder="请输入旧密码" />
        </el-form-item>
        <el-form-item label="新密码" prop="newPassword">
          <el-input v-model="passwordForm.newPassword" show-password maxlength="50" autocomplete="new-password" placeholder="请输入新密码" />
        </el-form-item>
        <el-form-item label="确认新密码" prop="confirmPassword">
          <el-input v-model="passwordForm.confirmPassword" show-password maxlength="50" autocomplete="new-password" placeholder="请再次输入新密码" @keyup.enter="submitChangePassword" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="passwordDialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="passwordSaving" @click="submitChangePassword">确认修改</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { computed, defineComponent, h, onMounted, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { ArrowRight, KnifeFork, Loading, Lock, Menu, SwitchButton, User } from '@element-plus/icons-vue'
import { changeDiningPassword, getDiningSession, logoutDining } from '@/api/diningApi'
import { clearDiningAuth, getDiningUser, saveDiningUser } from '@/utils/diningAuthStorage'

const route = useRoute()
const router = useRouter()
const drawerVisible = ref(false)
const checking = ref(true)
const currentUser = ref(getDiningUser())
const passwordDialogVisible = ref(false)
const passwordSaving = ref(false)
const passwordFormRef = ref()
const passwordForm = reactive({ oldPassword: '', newPassword: '', confirmPassword: '' })

const menuItems = [
  { path: '/dining/meal', label: '报餐管理', icon: KnifeFork },
  { path: '/dining/profile', label: '个人中心', icon: User },
  { action: 'password', label: '修改密码', icon: Lock },
]

const DiningNavigation = defineComponent({
  props: { activePath: { type: String, required: true } },
  emits: ['navigate', 'change-password', 'logout'],
  setup(props, { emit }) {
    return () => h('div', { class: 'navigation-inner' }, [
      h('div', { class: 'navigation-brand' }, [
        h('div', { class: 'navigation-logo' }, [h(KnifeFork)]),
        h('div', [h('strong', '员工报餐系统'), h('small', 'Dining Service')]),
      ]),
      h('nav', { class: 'navigation-menu', 'aria-label': '报餐系统菜单' }, [
        ...menuItems.map((item) => h('button', {
          type: 'button',
          class: ['navigation-item', { active: item.path && props.activePath === item.path }],
          onClick: () => item.action === 'password' ? emit('change-password') : emit('navigate', item.path),
        }, [
          h('span', { class: 'navigation-icon' }, [h(item.icon)]),
          h('span', item.label),
          h('span', { class: 'item-arrow' }, [h(ArrowRight)]),
        ])),
        h('button', { type: 'button', class: 'navigation-item navigation-logout', onClick: () => emit('logout') }, [
          h('span', { class: 'navigation-icon' }, [h(SwitchButton)]), h('span', '退出系统'), h('span', { class: 'item-arrow' }, [h(ArrowRight)]),
        ]),
      ]),
    ])
  },
})

const userName = computed(() => {
  const name = String(currentUser.value?.name ?? '').trim()
  const code = String(currentUser.value?.new_code ?? '').trim()
  return name || code || '员工已登录'
})

const userCard = computed(() => String(currentUser.value?.cardNumber ?? '').trim())

const passwordRules = {
  oldPassword: [{ required: true, message: '请输入旧密码', trigger: 'blur' }],
  newPassword: [{ required: true, message: '请输入新密码', trigger: 'blur' }],
  confirmPassword: [
    { required: true, message: '请再次输入新密码', trigger: 'blur' },
    {
      validator: (_rule, value, callback) => {
        if (String(value ?? '') !== String(passwordForm.newPassword ?? '')) callback(new Error('两次输入的新密码不一致'))
        else callback()
      },
      trigger: 'blur',
    },
  ],
}

onMounted(async () => {
  try {
    const response = await getDiningSession()
    currentUser.value = response.data?.data?.user || null
    saveDiningUser(currentUser.value)
  } catch {
    clearDiningAuth()
    await router.replace('/dining/login')
  } finally {
    checking.value = false
  }
  if (route.path === '/dining/change-password') {
    await router.replace('/dining/meal')
    openChangePassword()
  }
})

async function navigate(path) {
  drawerVisible.value = false
  if (route.path !== path) await router.push(path)
}

function openChangePassword() {
  drawerVisible.value = false
  passwordForm.oldPassword = ''
  passwordForm.newPassword = ''
  passwordForm.confirmPassword = ''
  passwordDialogVisible.value = true
}

async function submitChangePassword() {
  if (!passwordFormRef.value || passwordSaving.value) return
  try {
    await passwordFormRef.value.validate()
  } catch {
    return
  }
  passwordSaving.value = true
  try {
    const response = await changeDiningPassword(passwordForm.oldPassword, passwordForm.newPassword)
    ElMessage.success(String(response.data?.msg ?? '') || '密码修改成功，请使用新密码重新登录')
    passwordDialogVisible.value = false
    clearDiningAuth()
    await router.replace('/dining/login')
  } catch (error) {
    ElMessage.error(String(error?.response?.data?.msg ?? '').trim() || '密码修改失败，请稍后重试')
  } finally {
    passwordSaving.value = false
  }
}

watch(() => route.path, async (path) => {
  if (path !== '/dining/change-password') return
  await router.replace('/dining/meal')
  openChangePassword()
})

async function confirmLogout() {
  drawerVisible.value = false
  try {
    await ElMessageBox.confirm('确定要退出报餐系统吗？', '退出确认', {
      confirmButtonText: '确定退出',
      cancelButtonText: '取消',
      type: 'warning',
    })
  } catch {
    return
  }
  try {
    await logoutDining()
  } catch {
    // 即使网络断开也清除本机报餐登录，避免员工继续停留在页面。
  }
  clearDiningAuth()
  await router.replace('/dining/login')
}
</script>

<style scoped>
.dining-shell { min-height: 100vh; display: flex; color: #223b5d; background: #f4f8fc; overflow-x: hidden; }
.desktop-sidebar { width: 230px; flex: 0 0 230px; min-height: 100vh; background: #173b66; }
.dining-main { min-width: 0; flex: 1; }
.dining-header { position: sticky; top: 0; z-index: 20; min-height: 68px; display: flex; align-items: center; gap: 12px; padding: 0 28px; box-sizing: border-box; border-bottom: 1px solid #e4edf6; background: rgba(255,255,255,.97); box-shadow: 0 2px 12px rgba(31,72,111,.04); }
.header-main { min-width: 0; }
.header-title { font-size: 18px; font-weight: 700; color: #183b66; }
.header-user { margin-top: 3px; font-size: 12px; color: #8294aa; }
.header-password-button { margin-left: auto; flex: 0 0 auto; }
.dining-content { padding: 28px; }
.loading-panel { min-height: 180px; display: grid; place-items: center; color: #7b8fa7; }
.mobile-menu-button { display: none; }
:deep(.navigation-inner) { min-height: 100%; box-sizing: border-box; padding: 24px 14px; color: #fff; background: #173b66; }
:deep(.navigation-brand) { display: flex; align-items: center; gap: 12px; padding: 4px 10px 28px; }
:deep(.navigation-logo) { width: 42px; height: 42px; display: grid; place-items: center; border-radius: 12px; font-size: 22px; background: #3f8fe9; }
:deep(.navigation-brand strong), :deep(.navigation-brand small) { display: block; }
:deep(.navigation-brand small) { margin-top: 4px; color: #9eb9d8; font-size: 11px; }
:deep(.navigation-menu) { display: grid; gap: 7px; }
:deep(.navigation-item) { width: 100%; min-width: 0; min-height: 50px; display: grid; grid-template-columns: 22px minmax(0,1fr) 16px; align-items: center; gap: 10px; padding: 0 14px; border: 0; border-radius: 10px; color: #d8e7f7; background: transparent; font: inherit; text-align: left; cursor: pointer; }
:deep(.navigation-icon), :deep(.item-arrow) { width: 100%; height: 100%; display: grid; place-items: center; }
:deep(.navigation-icon svg) { width: 20px; height: 20px; max-width: 20px; max-height: 20px; }
:deep(.navigation-item:hover), :deep(.navigation-item.active) { color: #fff; background: #2b5b8f; }
:deep(.navigation-item.active) { box-shadow: inset 3px 0 #69b1ff; }
:deep(.item-arrow) { width: 14px; height: 14px; opacity: 0.65; }
:deep(.item-arrow svg) { width: 14px; height: 14px; }
:deep(.navigation-logout) { margin-top: 12px; border-top: 1px solid rgba(255,255,255,0.12); border-radius: 0 0 10px 10px; }
@media (max-width: 760px) {
  .desktop-sidebar { display: none; }
  .mobile-menu-button { display: inline-flex; flex: 0 0 auto; }
  .dining-header { min-height: 62px; padding: 0 10px 0 8px; }
  .header-title { font-size: 17px; }
  .header-user { max-width: 210px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .header-password-button { padding: 8px 4px; font-size: 13px; }
  .dining-content { padding: 16px; }
  :deep(.el-drawer__body) { padding: 0; }
  :deep(.el-drawer) { width: min(76vw, 300px) !important; }
  :deep(.navigation-inner) { padding: 18px 12px; }
  :deep(.navigation-brand) { padding: 4px 8px 20px; }
  :deep(.navigation-logo) { width: 38px; height: 38px; }
  :deep(.navigation-item) { min-height: 48px; padding: 0 12px; }
}
</style>
