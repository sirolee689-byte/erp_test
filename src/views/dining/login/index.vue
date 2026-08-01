<template>
  <main class="dining-login-page">
    <section class="dining-login-card" aria-label="员工报餐系统登录">
      <div class="brand-mark"><el-icon><KnifeFork /></el-icon></div>
      <h1>员工报餐系统</h1>
      <p class="subtitle">请使用员工工号和报餐密码登录</p>

      <el-alert
        v-if="errorText"
        class="login-error"
        :title="errorText"
        type="error"
        show-icon
        :closable="false"
      />

      <el-form ref="formRef" :model="form" :rules="rules" size="large" @keyup.enter="submitLogin">
        <el-form-item prop="account">
          <el-input
            v-model="form.account"
            autocomplete="username"
            clearable
            :prefix-icon="User"
            placeholder="请输入员工工号"
          />
        </el-form-item>
        <el-form-item prop="password">
          <el-input
            v-model="form.password"
            autocomplete="current-password"
            clearable
            show-password
            :prefix-icon="Lock"
            placeholder="请输入报餐密码"
          />
        </el-form-item>
        <el-button class="login-button" type="primary" :loading="loading" @click="submitLogin">
          登录
        </el-button>
      </el-form>

      <p class="footer-text">中山市卓越皮具有限公司</p>
    </section>
  </main>
</template>

<script setup>
import { onMounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { KnifeFork, Lock, User } from '@element-plus/icons-vue'
import { getDiningSession, loginDining } from '@/api/diningApi'
import { clearDiningAuth, getDiningToken, saveDiningAuth } from '@/utils/diningAuthStorage'

const router = useRouter()
const formRef = ref(null)
const loading = ref(false)
const errorText = ref('')
const form = reactive({ account: '', password: '' })
const rules = {
  account: [{ required: true, message: '请输入员工工号', trigger: 'blur' }],
  password: [{ required: true, message: '请输入报餐密码', trigger: 'blur' }],
}

onMounted(async () => {
  if (!getDiningToken()) return
  try {
    await getDiningSession()
    await router.replace('/dining/meal')
  } catch {
    clearDiningAuth()
  }
})

async function submitLogin() {
  if (loading.value) return
  errorText.value = ''
  const valid = await formRef.value?.validate().catch(() => false)
  if (!valid) return

  loading.value = true
  try {
    const response = await loginDining(String(form.account).trim(), String(form.password))
    const token = String(response.data?.data?.token ?? '').trim()
    const user = response.data?.data?.user
    if (!token || !user) throw new Error('登录响应不完整')
    saveDiningAuth(token, user)
    await router.replace('/dining/meal')
  } catch (error) {
    clearDiningAuth()
    form.password = ''
    errorText.value = String(error?.response?.data?.msg ?? '').trim() || '登录失败，请检查网络后重试'
  } finally {
    loading.value = false
  }
}
</script>

<style scoped>
.dining-login-page {
  min-height: 100vh;
  display: grid;
  place-items: center;
  box-sizing: border-box;
  padding: 28px 18px;
  color: #183153;
  background: linear-gradient(155deg, #eff8ff 0%, #f7fbff 48%, #eef7f2 100%);
}
.dining-login-card {
  box-sizing: border-box;
  width: min(420px, 100%);
  padding: 42px 38px 28px;
  border: 1px solid rgba(191, 219, 254, 0.75);
  border-radius: 20px;
  background: rgba(255, 255, 255, 0.97);
  box-shadow: 0 24px 65px rgba(30, 64, 175, 0.12);
}
.brand-mark {
  width: 60px;
  height: 60px;
  margin: 0 auto 18px;
  display: grid;
  place-items: center;
  border-radius: 18px;
  color: #fff;
  font-size: 30px;
  background: linear-gradient(145deg, #409eff, #2f80ed);
}
h1 { margin: 0; text-align: center; font-size: 26px; color: #16345b; }
.subtitle { margin: 10px 0 28px; text-align: center; font-size: 14px; color: #7890ad; }
.login-error { margin-bottom: 18px; }
:deep(.el-input__wrapper) { min-height: 52px; border-radius: 11px; }
.login-button { width: 100%; min-height: 52px; margin-top: 4px; border-radius: 11px; font-size: 16px; }
.footer-text { margin: 30px 0 0; text-align: center; font-size: 12px; color: #9aabba; }
@media (max-width: 520px) {
  .dining-login-page { align-items: start; padding-top: max(10vh, 52px); }
  .dining-login-card { padding: 34px 22px 24px; border-radius: 16px; }
  h1 { font-size: 24px; }
}
</style>
