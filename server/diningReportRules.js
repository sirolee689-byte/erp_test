import { getPool, sql } from './db.js'
import { createDiningTableRefs } from './diningDatabase.js'

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const text = (value) => String(value ?? '').trim()
const monthKeyOf = (date) => text(date).replaceAll('-', '').slice(0, 6)

function isWeekend(date) {
  const [year, month, day] = String(date).split('-').map(Number)
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay()
  return weekday === 0 || weekday === 6
}

export function evaluateDiningReportDateRule({ date, prepared, specialRule, exception }) {
  if (!prepared) return { allowed: false, reason: '本月尚未准备报餐' }

  const baseAllowed = specialRule
    ? specialRule.report_status === 'allowed'
    : !isWeekend(date)
  if (baseAllowed) return { allowed: true, reason: specialRule ? '管理员设置可报餐' : '' }
  if (exception) {
    const type = text(exception.rule_type) === 'permanent' ? '常设' : '临时'
    return { allowed: true, reason: `${type}开放：${text(exception.target_name)}` }
  }
  if (specialRule) return { allowed: false, reason: '管理员设置不可报餐' }
  return { allowed: false, reason: '周末不可报餐' }
}

export async function getDiningReportDateRules(employee, dates, options = {}) {
  const selectedDates = [...new Set((dates || []).map(text).filter((date) => DATE_RE.test(date)))].sort()
  if (!selectedDates.length) return []
  const tables = options.tables || createDiningTableRefs()
  const pool = await (options.getPool || getPool)()
  const months = [...new Set(selectedDates.map(monthKeyOf))]
  const monthRequest = pool.request()
  const blockRequest = pool.request()
  months.forEach((monthKey, index) => {
    monthRequest.input(`month${index}`, sql.NVarChar(6), monthKey)
    blockRequest.input(`month${index}`, sql.NVarChar(6), monthKey)
  })
  const monthParams = months.map((_, index) => `@month${index}`).join(',')
  const [preparedResult, blockResult] = await Promise.all([
    monthRequest.query(`SELECT month_key FROM ${tables.reportMonths} WHERE enabled=N'1' AND month_key IN (${monthParams})`),
    blockRequest.query(`SELECT month_key,start_date,end_date,report_status FROM ${tables.reportBlocks} WHERE del=N'0' AND enabled=N'1' AND month_key IN (${monthParams})`),
  ])
  const exceptionRequest = pool.request()
    .input('staffId', sql.NVarChar(50), text(employee?.id))
    .input('department', sql.NVarChar(50), text(employee?.in_bm_systemcode))
    // 员工档案存在历史部门编码未回填的情况，部门名称作为兼容兜底。
    .input('departmentName', sql.NVarChar(50), text(employee?.in_bm))
    .input('startDate', sql.NVarChar(10), selectedDates[0])
    .input('endDate', sql.NVarChar(10), selectedDates[selectedDates.length - 1])
  const exceptionResult = await exceptionRequest.query(`
    SELECT rule_type,target_type,target_key,target_name,start_date,end_date
    FROM ${tables.reportExceptions}
    WHERE del=N'0' AND enabled=N'1'
      AND (
        (target_type=N'staff' AND target_key=@staffId)
        OR (
          target_type=N'department'
          AND (target_key=@department OR target_name=@departmentName)
        )
      )
      AND (rule_type=N'permanent' OR (rule_type=N'temporary' AND start_date<=@endDate AND end_date>=@startDate))
  `)
  const preparedMonths = new Set((preparedResult.recordset || []).map((row) => text(row.month_key)))
  const specialRules = blockResult.recordset || []
  const exceptions = exceptionResult.recordset || []
  return selectedDates.map((date) => evaluateDiningReportDateRule({
    date,
    prepared: preparedMonths.has(monthKeyOf(date)),
    specialRule: specialRules.find((row) => row.month_key === monthKeyOf(date) && row.start_date <= date && row.end_date >= date),
    exception: exceptions.find((row) => row.rule_type === 'permanent' || (row.start_date <= date && row.end_date >= date)),
  }))
}

export async function getDiningReportDateRule(employee, date, options = {}) {
  const [result] = await getDiningReportDateRules(employee, [date], options)
  return result || { allowed: false, reason: '报餐日期无效' }
}
