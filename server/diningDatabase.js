const SAFE_DATABASE_NAME_RE = /^[A-Za-z0-9_.-]+$/

/**
 * 饭堂模块必须显式指定数据库，防止测试期间误写 ERP_UB 正式库。
 * ERP 其它模块仍使用 DB_DATABASE；饭堂上线时只切换 DINING_DB_DATABASE。
 */
export function resolveDiningDatabaseName(raw = process.env.DINING_DB_DATABASE) {
  const name = String(raw ?? '').trim()
  if (!name || !SAFE_DATABASE_NAME_RE.test(name)) {
    throw new Error('请正确配置 DINING_DB_DATABASE，只允许字母、数字、下划线、点和短横线')
  }
  return name
}

export function isDiningTerminalTestMode(
  databaseName = resolveDiningDatabaseName(),
  raw = process.env.DINING_TERMINAL_TEST_MODE,
) {
  const enabled = ['1', 'true', 'yes', 'on'].includes(String(raw ?? '').trim().toLowerCase())
  // 即使环境变量误开，正式库也绝不接受手动日期和餐别。
  return enabled && String(databaseName).trim().toUpperCase() === 'UB_ERP_V2.0'
}

export function createDiningTableRefs(databaseName = resolveDiningDatabaseName()) {
  const database = `[${String(databaseName).replaceAll(']', ']]')}]`
  return Object.freeze({
    config: `${database}.dbo.[UB_ERP_Dining]`,
    dishes: `${database}.dbo.[UB_ERP_Dining_dishes]`,
    dishItems: `${database}.dbo.[UB_ERP_Dining_dishes_list]`,
    meals: `${database}.dbo.[UB_ERP_Dining_meal]`,
    mealLogs: `${database}.dbo.[UB_ERP_Dining_meal_log]`,
    machines: `${database}.dbo.[UB_ERP_Dining_machine]`,
    reportMonths: `${database}.dbo.[UB_ERP_Dining_report_month]`,
    reportBlocks: `${database}.dbo.[UB_ERP_Dining_report_block]`,
    reportExceptions: `${database}.dbo.[UB_ERP_Dining_report_exception]`,
    staff: `${database}.dbo.[UB_ERP_Hr_staff]`,
    departments: `${database}.dbo.[UB_ERP_Hr_department]`,
  })
}
