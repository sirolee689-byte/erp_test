import axios from 'axios'
import { getDiningToken } from '@/utils/diningAuthStorage'

// 报餐系统不使用全局 axios，避免 ERP 管理员 token 覆盖员工报餐 token。
const diningRequest = axios.create({ baseURL: '/api/dining' })

diningRequest.interceptors.request.use((config) => {
  const token = getDiningToken()
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

export function loginDining(account, password) {
  return diningRequest.post('/login', { account, password })
}

export function getDiningSession() {
  return diningRequest.get('/session')
}

export function logoutDining() {
  return diningRequest.post('/logout')
}

export function getDiningMeals() {
  return diningRequest.get('/meals')
}

export function setDiningMeal(date, mealType, selected) {
  return diningRequest.put('/meals', { date, mealType, selected })
}

export function getDiningProfileMeals(scope = 'recent', page = 1) {
  return diningRequest.get('/profile/meals', { params: { scope, page } })
}

export function changeDiningPassword(oldPassword, newPassword) {
  return diningRequest.put('/password', { oldPassword, newPassword })
}
