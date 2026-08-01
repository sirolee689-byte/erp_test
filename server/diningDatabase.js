const SAFE_DATABASE_NAME_RE = /^[A-Za-z0-9_.-]+$/

/**
 * 员工报餐只访问旧饭堂正式库；ERP 其它模块仍使用 DB_DATABASE 指向的当前库。
 * 数据库名不是用户输入，但仍限制字符，避免环境变量被误配成 SQL 片段。
 */
export function resolveDiningDatabaseName(raw = process.env.DINING_DB_DATABASE ?? 'ERP_UB') {
  const name = String(raw ?? '').trim()
  if (!name || !SAFE_DATABASE_NAME_RE.test(name)) {
    throw new Error('DINING_DB_DATABASE 配置无效，只允许字母、数字、下划线、点和短横线')
  }
  return name
}

export function createDiningTableRefs(databaseName = resolveDiningDatabaseName()) {
  const database = `[${String(databaseName).replaceAll(']', ']]')}]`
  return Object.freeze({
    config: `${database}.dbo.[UB_ERP_Dining]`,
    dishes: `${database}.dbo.[UB_ERP_Dining_dishes]`,
    dishItems: `${database}.dbo.[UB_ERP_Dining_dishes_list]`,
    meals: `${database}.dbo.[UB_ERP_Dining_meal]`,
    staff: `${database}.dbo.[UB_ERP_Hr_staff]`,
  })
}
