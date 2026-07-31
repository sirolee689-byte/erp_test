<template>
  <!-- 系统研发：廖越锋 联系方式：15219855077 -->
  <div class="login-page">
    <div class="login-bg" aria-hidden="true"></div>

    <main class="login-shell">
      <section class="login-card" aria-label="登录表单">
        <div class="login-title">
          <div class="login-title-main">企业 ERP 管理系统</div>
          <div class="login-title-sub">欢迎回来，请登录后继续使用</div>
        </div>

        <el-alert
          v-if="errorText"
          class="login-error"
          :title="errorText"
          type="error"
          show-icon
          :closable="false"
        />

        <el-form
          ref="loginFormRef"
          :model="form"
          :rules="rules"
          class="login-form"
          size="large"
          @keyup.enter="onLogin"
        >
          <el-form-item prop="account">
            <el-input
              ref="accountInputRef"
              v-model="form.account"
              placeholder="请输入账号"
              clearable
              autocomplete="username"
              :prefix-icon="User"
            />
          </el-form-item>

          <el-form-item prop="password">
            <el-input
              v-model="form.password"
              placeholder="请输入密码"
              show-password
              clearable
              autocomplete="current-password"
              :prefix-icon="Lock"
            />
          </el-form-item>

          <div class="login-options">
            <el-checkbox v-model="rememberAccount">记住账号</el-checkbox>
          </div>

          <el-button
            type="primary"
            size="large"
            class="login-btn"
            :loading="loading"
            :disabled="loading"
            @click="onLogin"
          >
            {{ loading ? '登录中...' : '登录' }}
          </el-button>
        </el-form>

        <div class="login-footer">
          <div class="login-developer">系统开发：廖越锋</div>
          <div class="login-copyright">版权所有：中山市卓越皮具有限公司</div>
        </div>
      </section>
    </main>
  </div>
</template>

<script setup>
import { nextTick, onMounted, reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import axios from 'axios'
import { ElMessage } from 'element-plus'
import { Lock, User } from '@element-plus/icons-vue'
import { isFullPathAllowedForCurrentUser } from '@/utils/menuPermission'
import { useTagsViewStore } from '@/store/modules/tagsView'

const REMEMBER_ACCOUNT_KEY = 'erp_login_remember_account'

const router = useRouter()
const route = useRoute()

const loginFormRef = ref(null)
const accountInputRef = ref(null)
const loading = ref(false)
const errorText = ref('')
const rememberAccount = ref(false)

const form = reactive({
  account: '',
  password: '',
})

const rules = {
  account: [{ required: true, message: '请输入账号', trigger: 'blur' }],
  password: [{ required: true, message: '请输入密码', trigger: 'blur' }],
}

onMounted(async () => {
  const savedAccount = String(localStorage.getItem(REMEMBER_ACCOUNT_KEY) ?? '').trim()
  if (savedAccount) {
    form.account = savedAccount
    rememberAccount.value = true
  }

  await nextTick()
  accountInputRef.value?.focus?.()
})

function saveRememberedAccount(account) {
  if (rememberAccount.value) {
    localStorage.setItem(REMEMBER_ACCOUNT_KEY, account)
  } else {
    localStorage.removeItem(REMEMBER_ACCOUNT_KEY)
  }
}

function getLoginErrorMessage(error) {
  const status = error?.response?.status
  const backendMsg = String(error?.response?.data?.msg ?? '').trim()

  if (status === 400 || status === 401 || status === 403) {
    return backendMsg || '账号或密码不正确，请重新输入'
  }
  if (status >= 500) {
    return backendMsg || '系统暂时无法登录，请稍后再试'
  }
  if (!error?.response) {
    return '登录请求失败，请检查网络或服务是否正常'
  }
  return backendMsg || '登录失败，请稍后再试'
}

async function onLogin() {
  if (loading.value) return

  errorText.value = ''
  const valid = await loginFormRef.value?.validate().catch(() => false)
  if (!valid) return

  const account = String(form.account ?? '').trim()
  const password = String(form.password ?? '').trim()

  loading.value = true
  try {
    const res = await axios.post('/api/login', {
      Account: account,
      Password: password,
    })

    const json = res.data
    if (json?.code !== 200) {
      errorText.value = json?.msg || '账号或密码不正确，请重新输入'
      form.password = ''
      return
    }

    const token = String(json?.data?.token ?? '').trim()
    if (!token) {
      errorText.value = '登录成功但没有拿到认证信息，请联系管理员'
      form.password = ''
      return
    }

    localStorage.setItem('erp_token', token)
    localStorage.setItem('erp_user', JSON.stringify(json?.data?.user ?? {}))
    saveRememberedAccount(account)
    // 换账号登录前清空上一会话标签（含 token 失效跳登录、未走退出菜单等路径）
    useTagsViewStore().delAllViews()

    ElMessage.success('登录成功')

    let redirect = String(route.query?.redirect ?? '').trim() || '/home'
    if (redirect === '/') redirect = '/home'
    if (!isFullPathAllowedForCurrentUser(redirect)) {
      redirect = '/home'
    }
    await router.replace(redirect)
  } catch (error) {
    errorText.value = getLoginErrorMessage(error)
    ElMessage.error(errorText.value)
    form.password = ''
  } finally {
    loading.value = false
  }
}
</script>

<style scoped>
/* DIY：登录页视觉令牌（方案 C · 柔蓝雾 + 悬浮卡） */
.login-page {
  /* 页面底色；雾感再淡可改成 #F8FAFC */
  --login-page-bg: #f5f8fc;
  /* 中央单层蓝雾强度：0.08～0.22 较自然，勿叠多层装饰 */
  --login-mist-alpha: 0.16;
  /* 卡片宽度上限 */
  --login-card-width: 440px;
  /* 卡片圆角：方案 C 建议 16px */
  --login-card-radius: 16px;
  /* 卡片内边距：中老年可读建议 ≥40px */
  --login-card-pad-y: 48px;
  --login-card-pad-x: 44px;
  /* 悬浮阴影（越深越“浮起”） */
  --login-card-shadow: 0 28px 64px rgba(37, 99, 235, 0.12), 0 8px 24px rgba(15, 23, 42, 0.06);
  /* 主按钮色 */
  --login-btn-from: #3b82f6;
  --login-btn-to: #2563eb;
  --login-btn-height: 56px;
  --login-title-size: 26px;
  /* 正文基准字号：副标题 / 输入框 / 记住账号 / 安全登录 统一对齐 */
  --login-body-size: 14px;

  position: relative;
  min-height: 100vh;
  overflow-y: auto;
  color: #13294b;
  background: var(--login-page-bg);
  isolation: isolate;
}

/* 单层极淡蓝雾，禁止轨道环/网点装饰 */
.login-bg {
  position: fixed;
  inset: 0;
  z-index: -1;
  pointer-events: none;
  background: radial-gradient(
    ellipse 70% 55% at 50% 42%,
    rgba(147, 197, 253, var(--login-mist-alpha)) 0%,
    transparent 72%
  );
}

.login-shell {
  position: relative;
  display: flex;
  min-height: 100vh;
  align-items: center;
  justify-content: center;
  padding: 48px 20px;
  box-sizing: border-box;
}

.login-card {
  position: relative;
  z-index: 1;
  box-sizing: border-box;
  width: min(var(--login-card-width), 100%);
  padding: var(--login-card-pad-y) var(--login-card-pad-x) 36px;
  background: #ffffff;
  border: 1px solid rgba(226, 232, 240, 0.9);
  border-radius: var(--login-card-radius);
  box-shadow: var(--login-card-shadow);
}

.login-title {
  margin-bottom: 32px;
  text-align: center;
}

.login-title-main {
  font-size: var(--login-title-size);
  line-height: 1.3;
  font-weight: 700;
  color: #0f172a;
}

.login-title-sub {
  margin-top: 10px;
  font-size: var(--login-body-size);
  line-height: 1.5;
  color: #94a3b8;
}

.login-error {
  margin-bottom: 18px;
}

.login-form :deep(.el-form-item) {
  margin-bottom: 22px;
}

.login-form :deep(.el-input__wrapper) {
  min-height: 52px;
  padding: 0 18px;
  background: #ffffff;
  border-radius: 10px;
  box-shadow: 0 0 0 1px #e2e8f0 inset;
  transition: box-shadow 0.2s ease;
}

.login-form :deep(.el-input__wrapper.is-focus) {
  background: #ffffff;
  box-shadow: 0 0 0 1px #3b82f6 inset, 0 0 0 3px rgba(59, 130, 246, 0.14);
}

.login-form :deep(.el-input__inner) {
  font-size: var(--login-body-size);
  color: #0f172a;
}

.login-form :deep(.el-input__inner::placeholder) {
  font-size: var(--login-body-size);
  color: #a3adbd;
}

.login-form :deep(.el-input__prefix),
.login-form :deep(.el-input__suffix) {
  color: #94a3b8;
}

.login-form :deep(.el-input__prefix .el-icon),
.login-form :deep(.el-input__suffix .el-icon) {
  font-size: var(--login-body-size);
}

.login-options {
  display: flex;
  align-items: center;
  min-height: 28px;
  margin: -4px 0 24px;
}

.login-options :deep(.el-checkbox),
.login-options :deep(.el-checkbox__label) {
  font-size: var(--login-body-size);
  color: #64748b;
}

.login-btn {
  box-sizing: border-box;
  width: 100%;
  height: var(--login-btn-height);
  min-height: var(--login-btn-height);
  border: 0;
  border-radius: 10px;
  font-size: var(--login-body-size);
  font-weight: 700;
  letter-spacing: 0;
  background: linear-gradient(135deg, var(--login-btn-from) 0%, var(--login-btn-to) 100%);
  box-shadow: 0 12px 28px rgba(37, 99, 235, 0.22);
  transition: background 0.2s ease, box-shadow 0.2s ease;
}

.login-form :deep(.login-btn.el-button) {
  --el-button-size: var(--login-btn-height);
  height: var(--login-btn-height);
  min-height: var(--login-btn-height);
  padding: 0 18px;
  font-size: var(--login-body-size);
}

.login-btn:hover,
.login-btn:focus {
  background: linear-gradient(135deg, #60a5fa 0%, #1d4ed8 100%);
  box-shadow: 0 14px 30px rgba(37, 99, 235, 0.28);
}

.login-footer {
  margin-top: 24px;
  text-align: center;
}

.login-developer,
.login-copyright {
  font-size: var(--login-body-size);
  line-height: 1.6;
  color: #94a3b8;
}

.login-copyright {
  margin-top: 4px;
}

@media (max-width: 520px) {
  .login-page {
    --login-card-pad-y: 36px;
    --login-card-pad-x: 24px;
    --login-title-size: 22px;
  }

  .login-shell {
    padding: 28px 16px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .login-form :deep(.el-input__wrapper),
  .login-btn {
    transition: none;
  }
}
</style>
