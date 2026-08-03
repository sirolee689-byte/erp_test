import axios from 'axios'

const request = axios.create({ baseURL: '/api' })

request.interceptors.request.use((config) => {
  const token = String(localStorage.getItem('erp_token') || '').trim()
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

export const getDiningRecords = () => request.get('/canteen/records')

export const getDiningPeopleRecords = (params) => request.get('/canteen/records/people', { params })

export const getDiningConsumptions = (params) => request.get('/canteen/records/consumptions', { params })

export const cancelDiningPeopleRecord = ({ uid, date, mealType }) => request.delete(
  `/canteen/records/people/${encodeURIComponent(uid)}/${encodeURIComponent(date)}/${encodeURIComponent(mealType)}`,
)

export const getDiningSupplementInit = () => request.get('/canteen/records/supplements/init')

export const getDiningSupplementStaff = (params) => request.get('/canteen/records/supplements/staff', { params })

export const createDiningSupplement = (data) => request.post('/canteen/records/supplements', data)

export const getDiningOneClickSupplementPreview = (params) => request.get('/canteen/records/supplements/one-click-preview', { params })

export const createDiningOneClickSupplement = (data) => request.post('/canteen/records/supplements/one-click', data)

export const getDiningSupplementReviews = (params) => request.get('/canteen/records/supplements/reviews', { params })

export const getDiningSupplementReviewDetails = (anchorId) => request.get(`/canteen/records/supplements/reviews/${encodeURIComponent(anchorId)}/details`)

export const auditDiningSupplementReview = (anchorId) => request.put(`/canteen/records/supplements/reviews/${encodeURIComponent(anchorId)}/audit`)

export const unauditDiningSupplementReview = (anchorId) => request.put(`/canteen/records/supplements/reviews/${encodeURIComponent(anchorId)}/unaudit`)
