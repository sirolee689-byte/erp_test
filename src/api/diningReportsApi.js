import axios from 'axios'

const request = axios.create({ baseURL: '/api' })

request.interceptors.request.use((config) => {
  const token = String(localStorage.getItem('erp_token') || '').trim()
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

export const getDiningDailyOrders = (date) => request.get('/canteen/reports/daily-orders', { params: { date } })
export const getDiningMonthlyOrders = (month) => request.get('/canteen/reports/monthly-orders', { params: { month } })
export const getDiningMissedSwipeDepartments = () => request.get('/canteen/reports/missed-swipes/departments')
export const getDiningMissedSwipes = (params) => request.get('/canteen/reports/missed-swipes', { params })
export const getDiningConsumptionSummary = (params) => request.get('/canteen/reports/consumption-summary', { params })
