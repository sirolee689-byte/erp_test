<template>
  <div class="login-page">
    <div class="login-shell">
      <section class="login-brand" aria-label="系统介绍">
        <div class="brand-mark">
          <el-icon><OfficeBuilding /></el-icon>
        </div>
        <p class="brand-kicker">企业内部管理入口</p>
        <h1>企业 ERP 管理系统</h1>
        
        <div class="brand-metrics">
          <div>
            <span>稳定</span>
            <strong>内网业务</strong>
          </div>
          <div>
            <span>清晰</span>
            <strong>权限管控</strong>
          </div>
          <div>
            <span>高效</span>
            <strong>流程协同</strong>
          </div>
        </div>
      </section>

      <section class="login-panel" aria-label="登录表单">
        <div class="login-card">
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

          <div class="login-footer">© 2026 企业 ERP 管理系统</div>
        </div>
      </section>
    </div>
  </div>
</template>

<script setup>
import { nextTick, onMounted, reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import axios from 'axios'
import { ElMessage } from 'element-plus'
import { Lock, OfficeBuilding, User } from '@element-plus/icons-vue'
import menuStructure from '../../../erp_structure_dump.json'
import { getFirstPermittedRoutePath, isFullPathAllowedForCurrentUser } from '@/utils/menuPermission'

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

    ElMessage.success('登录成功')

    let redirect = String(route.query?.redirect ?? '').trim() || '/'
    if (!isFullPathAllowedForCurrentUser(redirect)) {
      redirect = getFirstPermittedRoutePath(menuStructure)
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
.login-page {
  min-height: 100vh;
  overflow-y: auto;
  color: #0f172a;
  background:
    linear-gradient(135deg, rgba(248, 250, 252, 0.96), rgba(239, 246, 255, 0.92)),
    linear-gradient(120deg, #dbeafe 0%, #f8fafc 48%, #e0f2fe 100%);
}

.login-shell {
  position: relative;
  display: grid;
  grid-template-columns: minmax(0, 1.2fr) minmax(420px, 0.8fr);
  min-height: 100vh;
}

.login-shell::before,
.login-shell::after {
  position: absolute;
  content: '';
  pointer-events: none;
}

.login-shell::before {
  top: 9%;
  left: 7%;
  width: 32vw;
  height: 32vw;
  max-width: 420px;
  max-height: 420px;
  border: 1px solid rgba(37, 99, 235, 0.13);
  border-radius: 28px;
  transform: rotate(12deg);
}

.login-shell::after {
  right: 8%;
  bottom: 8%;
  width: 220px;
  height: 220px;
  border: 1px solid rgba(14, 165, 233, 0.18);
  border-radius: 24px;
  transform: rotate(-16deg);
}

.login-brand,
.login-panel {
  position: relative;
  z-index: 1;
}

.login-brand {
  display: flex;
  flex-direction: column;
  justify-content: center;
  padding: 72px 7vw;
}

.brand-mark {
  display: inline-flex;
  width: 56px;
  height: 56px;
  align-items: center;
  justify-content: center;
  margin-bottom: 28px;
  color: #ffffff;
  background: linear-gradient(135deg, #1d4ed8, #0f766e);
  border-radius: 14px;
  box-shadow: 0 18px 38px rgba(29, 78, 216, 0.22);
}

.brand-mark .el-icon {
  font-size: 28px;
}

.brand-kicker {
  margin: 0 0 14px;
  font-size: 14px;
  font-weight: 600;
  color: #1d4ed8;
}

.login-brand h1 {
  margin: 0;
  font-size: 44px;
  line-height: 1.18;
  font-weight: 760;
  color: #0f172a;
}

.brand-desc {
  max-width: 560px;
  margin: 22px 0 0;
  font-size: 17px;
  line-height: 1.9;
  color: #475569;
}

.brand-metrics {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 128px));
  gap: 14px;
  margin-top: 42px;
}

.brand-metrics div {
  min-height: 82px;
  padding: 16px;
  background: rgba(255, 255, 255, 0.68);
  border: 1px solid rgba(148, 163, 184, 0.22);
  border-radius: 8px;
}

.brand-metrics span {
  display: block;
  margin-bottom: 9px;
  font-size: 13px;
  color: #64748b;
}

.brand-metrics strong {
  font-size: 16px;
  color: #0f172a;
}

.login-panel {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 48px 6vw 48px 32px;
  background: rgba(255, 255, 255, 0.34);
  border-left: 1px solid rgba(148, 163, 184, 0.18);
  backdrop-filter: blur(10px);
}

.login-card {
  box-sizing: border-box;
  width: min(420px, 100%);
  padding: 38px 36px 28px;
  background: rgba(255, 255, 255, 0.92);
  border: 1px solid rgba(148, 163, 184, 0.18);
  border-radius: 12px;
  box-shadow: 0 24px 60px rgba(15, 23, 42, 0.13);
}

.login-title {
  margin-bottom: 24px;
}

.login-title-main {
  font-size: 25px;
  line-height: 1.25;
  font-weight: 760;
  color: #0f172a;
}

.login-title-sub {
  margin-top: 9px;
  font-size: 14px;
  color: #64748b;
}

.login-error {
  margin-bottom: 18px;
}

.login-form :deep(.el-input__wrapper) {
  min-height: 44px;
  border-radius: 8px;
  box-shadow: 0 0 0 1px #dbe3ef inset;
}

.login-form :deep(.el-input__wrapper.is-focus) {
  box-shadow: 0 0 0 1px #2563eb inset, 0 0 0 3px rgba(37, 99, 235, 0.12);
}

.login-options {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 30px;
  margin: -2px 0 18px;
}

.login-btn {
  box-sizing: border-box;
  width: 100%;
  min-height: 46px;
  border-radius: 8px;
  font-weight: 650;
  background: linear-gradient(135deg, #1d4ed8, #2563eb);
  border: 0;
  box-shadow: 0 14px 26px rgba(37, 99, 235, 0.23);
}

.login-btn:hover,
.login-btn:focus {
  background: linear-gradient(135deg, #1e40af, #1d4ed8);
}

.login-footer {
  margin-top: 24px;
  font-size: 12px;
  line-height: 1.6;
  text-align: center;
  color: #94a3b8;
}

@media (max-width: 920px) {
  .login-shell {
    grid-template-columns: 1fr;
  }

  .login-brand {
    display: none;
  }

  .login-panel {
    min-height: 100vh;
    padding: 32px 16px;
    border-left: 0;
  }

  .login-card {
    width: min(420px, calc(100vw - 32px));
    padding: 32px 24px 24px;
  }
}

@media (max-width: 420px) {
  .login-title-main {
    font-size: 22px;
  }

  .login-card {
    padding: 28px 20px 22px;
  }
}
</style>
