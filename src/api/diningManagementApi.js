import axios from 'axios'

const request = axios.create({ baseURL: '/api' })
request.interceptors.request.use((config) => {
  const token = String(localStorage.getItem('erp_token') || '').trim()
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

export const getDiningManagement = (monthKey) => request.get('/canteen/management', { params: monthKey ? { monthKey } : {} })
export const getDiningManagementTargets = () => request.get('/canteen/management/targets')
export const saveDiningConfig = (data) => request.put('/canteen/management/config', data)
export const addDiningMachine = (data) => request.post('/canteen/management/machines', data)
export const updateDiningMachine = (id, data) => request.put(`/canteen/management/machines/${id}`, data)
export const deleteDiningMachine = (id) => request.delete(`/canteen/management/machines/${id}`)
export const prepareDiningReportMonth = (monthKey) => request.post('/canteen/management/report-months', { monthKey })
export const deleteDiningReportMonth = (monthKey) => request.delete(`/canteen/management/report-months/${monthKey}`)
export const addDiningBlock = (data) => request.post('/canteen/management/blocks', data)
export const updateDiningBlock = (id, data) => request.put(`/canteen/management/blocks/${id}`, data)
export const deleteDiningBlock = (id) => request.delete(`/canteen/management/blocks/${id}`)
export const addDiningException = (data) => request.post('/canteen/management/exceptions', data)
export const updateDiningException = (id, data) => request.put(`/canteen/management/exceptions/${id}`, data)
export const deleteDiningException = (id) => request.delete(`/canteen/management/exceptions/${id}`)
