import axios from 'axios'

const terminalRequest = axios.create({ baseURL: '/api/dining-terminal' })

export function getDiningTerminalContext() {
  return terminalRequest.get('/context')
}

export function swipeDiningCard(cardNumber, target = {}) {
  return terminalRequest.post('/swipe', { cardNumber, ...target })
}

export function getDiningTerminalRecent(target = {}) {
  return terminalRequest.get('/recent', { params: target })
}
