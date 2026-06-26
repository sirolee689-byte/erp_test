<template>
  <!--
    登录页整体容器
    小白版解释：
    - 这一层负责“全屏铺满”
    - 背景图也在这一层做
  -->
  <div class="login-page">
    <!--
      遮罩层
      小白版解释：
      - 背景图可能很花，遮罩层让中间表单更清晰
    -->
    <div class="login-overlay"></div>

    <!--
      内容区
      小白版解释：
      - 让登录卡片居中
    -->
    <div class="login-content">
      <!--
        登录卡片
        小白版解释：
        - 使用 Element Plus 的 el-card 做一个简约大气的面板
      -->
      <el-card class="login-card" shadow="always">
        <!-- 标题区 -->
        <div class="login-title">
          <!-- 系统名（你可以改成公司名称/项目名称） -->
          <div class="login-title-main">ERP 管理系统</div>
          <!-- 副标题（简短说明） -->
          <div class="login-title-sub">内网账号登录</div>
        </div>

        <!--
          登录表单
          小白版解释：
          - v-model 会把输入框内容“同步到变量里”
          - 点击登录时，我们把变量提交给后端 /api/login
        -->
        <el-form :model="form" class="login-form" @keyup.enter="onLogin">
          <!-- 账号输入框 -->
          <el-form-item>
            <el-input
              v-model="form.account"
              placeholder="请输入用户名或编码"
              clearable
              size="large"
              autocomplete="username"
            />
          </el-form-item>

          <!-- 密码输入框 -->
          <el-form-item>
            <el-input
              v-model="form.password"
              placeholder="请输入密码"
              show-password
              clearable
              size="large"
              autocomplete="current-password"
            />
          </el-form-item>

          <!-- 登录按钮 -->
          <el-form-item>
            <el-button
              type="primary"
              size="large"
              class="login-btn"
              :loading="loading"
              @click="onLogin"
            >
              登录
            </el-button>
          </el-form-item>

          <!-- 提示信息（可选） -->
          <div class="login-tips">
            <!-- 小白提示：这里可以放“默认账号/联系管理员”等提示 -->
            <span>如无法登录，请联系管理员确认账号是否启用。</span>
          </div>
        </el-form>
      </el-card>
    </div>
  </div>
</template>

<script setup>
import { reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import axios from 'axios'
import { ElMessage } from 'element-plus'
import menuStructure from '../../../erp_structure_dump.json'
import { getFirstPermittedRoutePath, isFullPathAllowedForCurrentUser } from '@/utils/menuPermission'

// =========================
// 1) 路由对象（用于跳转）
// =========================
const router = useRouter()
const route = useRoute()

// =========================
// 2) 表单数据
// =========================
const form = reactive({
  // 登录输入：旧表为 username（登录账号）或 usercode（账号编码）；ERP 表为 UserName
  account: '',
  // 密码（对应数据库 UB_ERP_User.Password）
  password: '',
})

// =========================
// 3) 加载状态（防止重复点击）
// =========================
const loading = ref(false)

/**
 * 登录按钮点击事件
 * 小白版解释：
 * - 先做前端必填校验（更快给你提示）
 * - 再请求后端 /api/login
 * - 成功后把 token 存入 localStorage，然后跳转到后台首页或原目标页面
 */
async function onLogin() {
  // 关键：去掉左右空格，避免“复制粘贴多了空格”导致登录失败
  const account = String(form.account ?? '').trim()
  const password = String(form.password ?? '').trim()

  // 关键：前端必填校验
  if (!account) {
    ElMessage.error('请输入用户名或编码')
    return
  }
  if (!password) {
    ElMessage.error('请输入密码')
    return
  }

  // 关键：开始请求，进入 loading
  loading.value = true
  try {
    // 关键：请求后端登录接口
    const res = await axios.post('/api/login', {
      // 关键：字段名保持简单清晰（后端也按这个取值）
      Account: account,
      Password: password,
    })

    // 关键：后端返回 JSON 在 res.data
    const json = res.data

    // 关键：按约定 code=200 才算成功
    if (json?.code !== 200) {
      ElMessage.error(json?.msg || '登录失败')
      return
    }

    // 关键：保存 token（这是“已登录”的标志）
    const token = json?.data?.token
    localStorage.setItem('erp_token', String(token ?? ''))

    /**
     * v1.0.7 RBAC：把「当前用户 + 角色」写入 localStorage，供后续权限判断使用
     *
     * 流程说明（从登录到前端读取）：
     * 1) 后端 POST /api/login 在校验通过后，会在 data.user 里返回 UserID/UserCode/UserName/Status，
     *    以及本阶段新增的 RoleID、RoleName（来自 UB_ERP_User 关联 UB_ERP_System_role）；
     *    **is_admin / isAdmin**（超级管理员，供出库单「开料出库配置」等前端门禁）。
     * 2) localStorage 只能存字符串，所以这里用 JSON.stringify(user) 序列化整个 user 对象。
     * 3) 写入的 key 固定为 erp_user（与布局页 ErpLayout 读取的 key 一致）。
     * 4) user.Permissions 为角色在 UB_ERP_System_role.Permissions 中配置的菜单 path JSON 字符串；
     *    侧栏与路由守卫会读取它做菜单过滤与无权限拦截（详见 @/utils/menuPermission.js）。
     * 5) 路由守卫仍以 erp_token 判断登录；Permissions 用于登录后的菜单与 URL 授权。
     */
    const user = json?.data?.user
    localStorage.setItem('erp_user', JSON.stringify(user ?? {}))

    // 关键：提示成功
    ElMessage.success('登录成功')

    // 关键：登录成功后跳转
    // 小白版解释：
    // - 你原来想去哪个页面，路由守卫会把地址塞到 ?redirect=xxx
    // - 若 redirect 指向无权限页面，则改跳到「第一个有权限的菜单」或 /403
    let redirect = String(route.query?.redirect ?? '').trim() || '/'
    if (!isFullPathAllowedForCurrentUser(redirect)) {
      redirect = getFirstPermittedRoutePath(menuStructure)
    }
    await router.replace(redirect)
  } catch (e) {
    // 关键：axios 如果收到 400/500，会把后端返回的中文 msg 放在 e.response.data.msg
    const backendMsg = e?.response?.data?.msg
    ElMessage.error(backendMsg || '登录接口请求失败：请确认后端已启动并检查网络/端口')
  } finally {
    // 关键：结束 loading
    loading.value = false
  }
}
</script>

<style scoped>
/* 全屏背景 */
.login-page {
  position: relative;
  min-height: 100vh;
  overflow: hidden;

  /* 背景（不依赖任何图片文件，开箱即用） */
  background-image: linear-gradient(120deg, rgba(15, 23, 42, 0.92), rgba(2, 132, 199, 0.62));
  background-color: #0f172a;
}

/* 遮罩层 */
.login-overlay {
  position: absolute;
  inset: 0;
  background: radial-gradient(circle at 20% 10%, rgba(255, 255, 255, 0.12), transparent 45%),
    radial-gradient(circle at 80% 40%, rgba(255, 255, 255, 0.10), transparent 55%);
  pointer-events: none;
}

/* 居中容器 */
.login-content {
  position: relative;
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
}

/* 登录卡片 */
.login-card {
  width: 420px;
  max-width: 92vw;
  border-radius: 14px;

  /* 玻璃拟态一点点（简约但高级） */
  background: rgba(255, 255, 255, 0.94);
  backdrop-filter: blur(8px);
}

/* 标题区 */
.login-title {
  margin-bottom: 18px;
  text-align: center;
}
.login-title-main {
  font-size: 22px;
  font-weight: 700;
  letter-spacing: 1px;
  color: #0f172a;
}
.login-title-sub {
  margin-top: 6px;
  font-size: 13px;
  color: rgba(15, 23, 42, 0.6);
}

/* 表单区 */
.login-form {
  margin-top: 10px;
}

/* 登录按钮 */
.login-btn {
  width: 100%;
  border-radius: 10px;
}

/* 底部提示 */
.login-tips {
  margin-top: 6px;
  font-size: 12px;
  text-align: center;
  color: rgba(15, 23, 42, 0.55);
}
</style>

