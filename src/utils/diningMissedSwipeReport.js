const WEEKDAY_LABELS = ['日', '一', '二', '三', '四', '五', '六']

export function getDiningMonthDateRange(value) {
  const match = /^(\d{4})-(\d{2})$/.exec(String(value || '').trim())
  if (!match) return null
  const year = Number(match[1])
  const month = Number(match[2])
  if (month < 1 || month > 12) return null
  const lastDay = new Date(year, month, 0).getDate()
  const monthText = String(month).padStart(2, '0')
  return {
    startDate: `${year}-${monthText}-01`,
    endDate: `${year}-${monthText}-${String(lastDay).padStart(2, '0')}`,
  }
}

export function formatDiningMealDateWithWeek(value) {
  const date = String(value || '').trim()
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date)
  if (!match) return date
  const parsed = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
  if (
    parsed.getFullYear() !== Number(match[1]) ||
    parsed.getMonth() !== Number(match[2]) - 1 ||
    parsed.getDate() !== Number(match[3])
  ) return date
  return `${date}（周${WEEKDAY_LABELS[parsed.getDay()]}）`
}
