import { createApp } from 'vue'
import './style.css'
import ElementPlus from 'element-plus'
import 'element-plus/dist/index.css'
import zhCn from 'element-plus/es/locale/lang/zh-cn'
import axios from 'axios'
import App from './App.vue'
import router from './router'
import { permissionDirective } from './directives/permission'
import { getPermissionModelFromStorage, hasPageAction } from './utils/menuPermission'

/**
 * 所有 axios 请求自动附带登录 token，供后端 API 权限闸门识别用户身份
 */
axios.interceptors.request.use((config) => {
  const token = localStorage.getItem('erp_token')
  if (token) {
    config.headers.Authorization = `Bearer ${String(token).trim()}`
  }
  return config
})

const app = createApp(App)

app.use(router)
app.use(ElementPlus, { locale: zhCn })

/** 全局注册按钮权限指令：v-permission / v-permission.disable */
app.directive('permission', permissionDirective)

/**
 * 【Vue3 globalProperties：如何在任意页面判断权限】
 *
 * 1) 这里把 `$can` 挂到 `app.config.globalProperties` 上后：
 *    - Options API 的 `<template>` 里可以直接写 `$can('delete')`、`$can('edit', 'system/role')`；
 *    - 在选项式组件的 `methods` / `computed` 里通过 `this.$can(...)` 调用（必须用普通 function，不要用箭头函数，才能拿到 this）。
 *
 * 2) `<script setup>` 里没有 this，要用两种方式之一：
 *    - `import { getCurrentInstance } from 'vue'`，在 setup 里写 `const { proxy } = getCurrentInstance()`，再 `proxy.$can('delete')`；
 *    - 或直接 `import { getPermissionModelFromStorage, hasPageAction } from '@/utils/menuPermission'`，自己传菜单 path 调 `hasPageAction(model, 'system/operator', 'add')`。
 *
 * 3) `$can` 内部读取 localStorage 的 `erp_user.Permissions`，与当前路由 path（或你传入的第二个参数菜单 path）组合，
 *    判断角色是否具备对应操作（view / add / edit / delete / audit / all）。
 *
 * 4) 与指令 `v-permission` 的关系：指令适合包在 `<el-button>` 上自动隐藏/禁用；`$can` 适合在 `v-if`、表格列、computed 里写复杂逻辑。
 */
app.config.globalProperties.$can = function permissionCan(action, menuPath) {
  const model = getPermissionModelFromStorage()
  const path =
    menuPath ||
    String(this.$route?.path ?? '')
      .replace(/^\/+/, '')
      .replace(/\/+$/, '')
  return hasPageAction(model, path, String(action).toLowerCase())
}

app.mount('#app')
