<template>
  <div class="dining-shell">
    <aside class="desktop-sidebar">
      <DiningNavigation :active-path="route.path" @navigate="navigate" @logout="confirmLogout" />
    </aside>

    <section class="dining-main">
      <header class="dining-header">
        <el-button class="mobile-menu-button" text aria-label="打开菜单" @click="drawerVisible = true">
          <el-icon :size="24"><Menu /></el-icon>
        </el-button>
        <div>
          <div class="header-title">{{ route.meta.title || '员工报餐系统' }}</div>
          <div class="header-user">{{ userLabel }}</div>
        </div>
      </header>

      <main class="dining-content">
        <div v-if="checking" class="loading-panel"><el-icon class="is-loading"><Loading /></el-icon> 正在确认登录状态…</div>
        <router-view v-else />
      </main>
    </section>

    <el-drawer v-model="drawerVisible" class="dining-mobile-drawer" direction="ltr" size="82%" :with-header="false">
      <DiningNavigation :active-path="route.path" @navigate="navigate" @logout="confirmLogout" />
    </el-drawer>
  </div>
</template>

<script setup>
import { computed, defineComponent, h, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessageBox } from 'element-plus'
import { ArrowRight, KnifeFork, Loading, Lock, Menu, SwitchButton, User } from '@element-plus/icons-vue'
import { getDiningSession, logoutDining } from '@/api/diningApi'
import { clearDiningAuth, getDiningUser, saveDiningUser } from '@/utils/diningAuthStorage'

const route = useRoute()
const router = useRouter()
const drawerVisible = ref(false)
const checking = ref(true)
const currentUser = ref(getDiningUser())

const menuItems = [
  { path: '/dining/meal', label: '报餐管理', icon: KnifeFork },
  { path: '/dining/profile', label: '个人中心', icon: User },
  { path: '/dining/change-password', label: '修改密码', icon: Lock },
]

const DiningNavigation = defineComponent({
  props: { activePath: { type: String, required: true } },
  emits: ['navigate', 'logout'],
  setup(props, { emit }) {
    return () => h('div', { class: 'navigation-inner' }, [
      h('div', { class: 'navigation-brand' }, [
        h('div', { class: 'navigation-logo' }, [h(KnifeFork)]),
        h('div', [h('strong', '员工报餐系统'), h('small', 'Dining Service')]),
      ]),
      h('nav', { class: 'navigation-menu', 'aria-label': '报餐系统菜单' }, [
        ...menuItems.map((item) => h('button', {
          type: 'button',
          class: ['navigation-item', { active: props.activePath === item.path }],
          onClick: () => emit('navigate', item.path),
        }, [h(item.icon), h('span', item.label), h(ArrowRight, { class: 'item-arrow' })])),
        h('button', { type: 'button', class: 'navigation-item navigation-logout', onClick: () => emit('logout') }, [
          h(SwitchButton), h('span', '退出系统'), h(ArrowRight, { class: 'item-arrow' }),
        ]),
      ]),
    ])
  },
})

const userLabel = computed(() => {
  const name = String(currentUser.value?.name ?? '').trim()
  const code = String(currentUser.value?.new_code ?? '').trim()
  return name && code ? `${name}（${code}）` : name || code || '员工已登录'
})

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
})

async function navigate(path) {
  drawerVisible.value = false
  if (route.path !== path) await router.push(path)
}

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
.dining-header { min-height: 68px; display: flex; align-items: center; gap: 12px; padding: 0 28px; box-sizing: border-box; border-bottom: 1px solid #e4edf6; background: #fff; }
.header-title { font-size: 18px; font-weight: 700; color: #183b66; }
.header-user { margin-top: 3px; font-size: 12px; color: #8294aa; }
.dining-content { padding: 28px; }
.loading-panel { min-height: 180px; display: grid; place-items: center; color: #7b8fa7; }
.mobile-menu-button { display: none; }
:deep(.navigation-inner) { min-height: 100%; box-sizing: border-box; padding: 24px 14px; color: #fff; background: #173b66; }
:deep(.navigation-brand) { display: flex; align-items: center; gap: 12px; padding: 4px 10px 28px; }
:deep(.navigation-logo) { width: 42px; height: 42px; display: grid; place-items: center; border-radius: 12px; font-size: 22px; background: #3f8fe9; }
:deep(.navigation-brand strong), :deep(.navigation-brand small) { display: block; }
:deep(.navigation-brand small) { margin-top: 4px; color: #9eb9d8; font-size: 11px; }
:deep(.navigation-menu) { display: grid; gap: 7px; }
:deep(.navigation-item) { width: 100%; min-height: 50px; display: grid; grid-template-columns: 22px 1fr 16px; align-items: center; gap: 10px; padding: 0 14px; border: 0; border-radius: 10px; color: #d8e7f7; background: transparent; font: inherit; text-align: left; cursor: pointer; }
:deep(.navigation-item:hover), :deep(.navigation-item.active) { color: #fff; background: #2b5b8f; }
:deep(.navigation-item.active) { box-shadow: inset 3px 0 #69b1ff; }
:deep(.item-arrow) { width: 14px; opacity: 0.65; }
:deep(.navigation-logout) { margin-top: 12px; border-top: 1px solid rgba(255,255,255,0.12); border-radius: 0 0 10px 10px; }
@media (max-width: 760px) {
  .desktop-sidebar { display: none; }
  .mobile-menu-button { display: inline-flex; flex: 0 0 auto; }
  .dining-header { min-height: 62px; padding: 0 14px 0 8px; }
  .header-title { font-size: 17px; }
  .dining-content { padding: 16px; }
  :deep(.el-drawer__body) { padding: 0; }
}
</style>
