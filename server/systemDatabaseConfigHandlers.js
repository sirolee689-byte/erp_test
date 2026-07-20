import crypto from 'node:crypto'
import { sql } from './db.js'
import { getRequestIp } from './operationAuditMiddleware.js'
import { writeLog } from './operationLogWriter.js'

const DATABASE_CONFIG_FROM = 'dbo.[UB_ERP_System_Database_Config]'
const DATABASE_CONFIG_TABLE = 'UB_ERP_System_Database_Config'

const DEFAULT_TABLE_CONFIGS = [
  ['UB_ERP_System_Database_Config', '系统数据库配置表'],
  ['UB_ERP_System_mail', '系统邮件发送配置'],
  ['UB_ERP_System_Head', '系统打印抬头配置'],
  ['NEW_UB_ERP_System_role', '系统角色权限表'],
  ['UB_ERP_User', '操作员账号表'],
  ['UB_Date_ERP_Operation_log', '操作日志表'],
  ['UB_ERP_Bom_000', 'BOM物料主档'],
  ['UB_ERP_Bom_parts', 'BOM配件明细表'],
  ['UB_ERP_Bom_pi_cost', 'PI成本用量表'],
  ['UB_ERP_Bom_pi_consumption', 'PI用量配置表'],
  ['UB_ERP_Bom_cost', 'BOM成本表'],
  ['UB_ERP_Bom_Sales', 'BOM报价主表'],
  ['UB_ERP_Bom_Sales_list', 'BOM报价明细表'],
  ['UB_ERP_Bom_buy_order', 'BOM采购单主表'],
  ['UB_ERP_Bom_buy_order_list', 'BOM采购单明细表'],
  ['UB_ERP_Bom_code', 'BOM分类编码表'],
  ['UB_ERP_Stocks_Storage', '入库单主表'],
  ['UB_ERP_Stocks_Storage_list', '入库单明细表'],
  ['UB_ERP_Stocks_out', '出库单主表'],
  ['UB_ERP_Stocks_out_list', '出库单明细表'],
  ['UB_ERP_Stocks_acc', '库存结存辅助表'],
  ['UB_ERP_Stocks_Warehouse', '仓库编码表'],
  ['UB_ERP_Stocks_material', '材料分类表'],
  ['UB_ERP_Stocks_colorcode', '颜色编码表'],
  ['UB_ERP_Stocks_unit', '使用单位表'],
  ['UB_ERP_Stocks_unit_change', '单位转换率表'],
  ['UB_ERP_Stocks_workshop', '车间与部门编码表'],
  ['UB_ERP_Buy_order', '采购订单主表'],
  ['UB_ERP_Buy_order_list', '采购订单明细表'],
  ['UB_ERP_Buy_order_money', '采购订单金额附表'],
  ['UB_ERP_Buy_order_hb', '采购订单汇总/合并附表'],
  ['UB_ERP_Buy_order_sp', '采购订单审批附表'],
  ['UB_ERP_Buy_order_stocks_max', '采购订单库存上限附表'],
  ['UB_ERP_Buy_offer', '采购报价主表'],
  ['UB_ERP_Buy_offer_list', '采购报价明细表'],
  ['UB_ERP_Sales_order', '销售订单主表'],
  ['UB_ERP_Sales_order_list', '销售订单明细表'],
  ['UB_ERP_Dispatch_order', '派工单主表'],
  ['UB_ERP_Dispatch_order_list', '派工单明细表'],
  ['UB_ERP_assist_order', '外协订单主表'],
  ['UB_ERP_assist_order_list', '外协订单明细表'],
  ['UB_ERP_assist_order_money', '外协订单金额附表'],
  ['UB_ERP_assist_offer', '外协报价主表'],
  ['UB_ERP_assist_offer_list', '外协报价明细表'],
  ['UB_ERP_System_supplier', '供应商/外协商资料表'],
  ['UB_ERP_System_sales_customer', '销售客户资料表'],
  ['UB_ERP_System_settlement_method', '结算方式表'],
  ['UB_ERP_Customer', '旧客户资料表'],
  ['UB_ERP_Finance_currency', '币别资料表'],
  ['UB_ERP_Hr_staff', '员工档案表'],
  ['UB_ERP_Hr_department', '部门资料表'],
  ['UB_ERP_Hr_room', '宿舍房间表'],
  ['UB_ERP_Hr_room_in', '宿舍入住明细表'],
  ['UB_ERP_Hr_room_use', '宿舍入住记录表'],
  ['UB_ERP_System_currency', '系统币别配置表'],
  ['UB_ERP_System_uplod_file', '系统上传文件表'],
  ['Inv_StockIn', '新库存入库兼容表'],
  ['Sys_OperationLogs', '新系统操作日志兼容表'],
  ['Sys_Roles', '新系统角色兼容表'],
  ['Sys_Users', '新系统用户兼容表'],
  ['UB_ERP_Stock_stats_snapshot', '库存统计快照主表'],
  ['UB_ERP_Stock_stats_snapshot_line', '库存统计快照明细表'],
].map(([tableName, purpose], index) => ({
  tableName,
  purpose,
  remark: '',
  source: 'static',
  sortOrder: index + 1,
}))

function text(value) {
  return String(value ?? '').trim()
}

function valueOrNull(value) {
  const v = String(value ?? '').trim()
  return v === '' ? null : v
}

export function formatSystemDatabaseConfigTimestamp(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

export function buildSystemDatabaseConfigSystemcode(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0')
  const ymd = `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`
  const seed = `${Date.now()}-${process.hrtime.bigint()}-${crypto.randomBytes(12).toString('hex')}`
  return `${ymd}${crypto.createHash('md5').update(seed).digest('hex').toUpperCase()}`.slice(0, 50)
}

function assertCoreKey(coreKey) {
  const expected = text(process.env.ERP_CORE_CONFIG_KEY)
  if (!expected) {
    return { ok: false, status: 500, msg: '核心密钥未配置，请在 .env 中设置 ERP_CORE_CONFIG_KEY' }
  }
  const given = text(coreKey)
  if (!given) {
    return { ok: false, status: 400, msg: '核心密钥不能为空' }
  }
  const expectedBuf = Buffer.from(expected)
  const givenBuf = Buffer.from(given)
  if (expectedBuf.length !== givenBuf.length || !crypto.timingSafeEqual(expectedBuf, givenBuf)) {
    return { ok: false, status: 403, msg: '核心密钥错误，已阻止保存' }
  }
  return { ok: true }
}

function normalizeTableName(value) {
  const tableName = text(value)
  if (!/^[A-Za-z0-9_]{1,128}$/.test(tableName)) return ''
  return tableName
}

export function getDefaultDatabaseConfigs() {
  return DEFAULT_TABLE_CONFIGS.map((item) => ({ ...item }))
}

function mergeConfigs(savedRows = []) {
  const savedByName = new Map()
  for (const row of savedRows) {
    const tableName = normalizeTableName(row?.table_name)
    if (!tableName) continue
    savedByName.set(tableName.toLowerCase(), row)
  }
  const defaults = getDefaultDatabaseConfigs()
  const used = new Set()
  const merged = defaults.map((item) => {
    const saved = savedByName.get(item.tableName.toLowerCase())
    used.add(item.tableName.toLowerCase())
    return {
      systemcode: text(saved?.systemcode) || buildSystemDatabaseConfigSystemcode(),
      tableName: item.tableName,
      purpose: saved?.purpose != null && text(saved.purpose) ? String(saved.purpose) : item.purpose || '待补充',
      remark: saved?.remark != null ? String(saved.remark) : item.remark || '',
      source: saved?.source != null && text(saved.source) ? String(saved.source) : item.source,
      sortOrder: Number(saved?.sort_order ?? item.sortOrder) || item.sortOrder,
    }
  })
  for (const row of savedRows) {
    const tableName = normalizeTableName(row?.table_name)
    if (!tableName || used.has(tableName.toLowerCase())) continue
    merged.push({
      systemcode: text(row?.systemcode) || buildSystemDatabaseConfigSystemcode(),
      tableName,
      purpose: row?.purpose != null && text(row.purpose) ? String(row.purpose) : '待补充',
      remark: row?.remark != null ? String(row.remark) : '',
      source: row?.source != null && text(row.source) ? String(row.source) : 'manual',
      sortOrder: Number(row?.sort_order ?? merged.length + 1) || merged.length + 1,
    })
  }
  return merged.sort((a, b) => Number(a.sortOrder) - Number(b.sortOrder) || a.tableName.localeCompare(b.tableName))
}

async function databaseConfigTableExists(pool) {
  const rs = await pool.request().query(`
    SELECT OBJECT_ID(N'${DATABASE_CONFIG_FROM}', N'U') AS object_id
  `)
  return Boolean(rs.recordset?.[0]?.object_id)
}

async function ensureDatabaseConfigTable(pool) {
  await pool.request().query(`
    IF OBJECT_ID(N'${DATABASE_CONFIG_FROM}', N'U') IS NULL
    BEGIN
      CREATE TABLE ${DATABASE_CONFIG_FROM} (
        id INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        systemcode NVARCHAR(50) NULL,
        table_name NVARCHAR(128) NOT NULL,
        purpose NVARCHAR(500) NULL,
        remark NVARCHAR(1000) NULL,
        source NVARCHAR(50) NULL,
        sort_order INT NULL,
        del NVARCHAR(1) NULL,
        pass NVARCHAR(1) NULL,
        addtime NVARCHAR(50) NULL,
        edittime NVARCHAR(50) NULL,
        ip NVARCHAR(256) NULL
      )
      CREATE UNIQUE INDEX UX_UB_ERP_System_Database_Config_table_name
        ON ${DATABASE_CONFIG_FROM} (table_name)
    END
  `)
}

async function fetchSavedDatabaseConfigs(pool) {
  if (!(await databaseConfigTableExists(pool))) return []
  const rs = await pool.request().query(`
    SELECT
      systemcode,
      table_name,
      purpose,
      remark,
      source,
      sort_order
    FROM ${DATABASE_CONFIG_FROM}
    WHERE ISNULL(del, N'0') <> N'1'
    ORDER BY ISNULL(sort_order, 999999), table_name
  `)
  return rs.recordset ?? []
}

function normalizePayloadRows(rows) {
  if (!Array.isArray(rows)) {
    const err = new Error('数据库配置明细不能为空')
    err.statusCode = 400
    throw err
  }
  const defaultNames = new Set(DEFAULT_TABLE_CONFIGS.map((item) => item.tableName.toLowerCase()))
  const seen = new Set()
  const normalized = []
  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i]
    const tableName = normalizeTableName(row?.tableName ?? row?.table_name)
    if (!tableName) continue
    const key = tableName.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    normalized.push({
      tableName,
      purpose: String(row?.purpose ?? '').trim() || '待补充',
      remark: String(row?.remark ?? ''),
      source: defaultNames.has(key) ? 'static' : 'manual',
      sortOrder: Number(row?.sortOrder ?? row?.sort_order ?? i + 1) || i + 1,
    })
  }
  return normalized
}

async function saveDatabaseConfigs(pool, req, rows) {
  await ensureDatabaseConfigTable(pool)
  const now = formatSystemDatabaseConfigTimestamp()
  const ip = getRequestIp(req) || ''
  for (const row of rows) {
    const systemcode = buildSystemDatabaseConfigSystemcode()
    const q = pool.request()
    q.input('table_name', sql.NVarChar(128), row.tableName)
    q.input('systemcode', sql.NVarChar(50), systemcode)
    q.input('purpose', sql.NVarChar(500), valueOrNull(row.purpose))
    q.input('remark', sql.NVarChar(1000), valueOrNull(row.remark))
    q.input('source', sql.NVarChar(50), valueOrNull(row.source))
    q.input('sort_order', sql.Int, Number(row.sortOrder) || 0)
    q.input('now', sql.NVarChar(50), now)
    q.input('ip', sql.NVarChar(256), ip)
    await q.query(`
      UPDATE ${DATABASE_CONFIG_FROM}
      SET
        purpose = @purpose,
        remark = @remark,
        source = @source,
        sort_order = @sort_order,
        del = N'0',
        pass = N'1',
        edittime = @now,
        ip = @ip
      WHERE table_name = @table_name

      IF @@ROWCOUNT = 0
      BEGIN
        INSERT INTO ${DATABASE_CONFIG_FROM}
          (systemcode, table_name, purpose, remark, source, sort_order, del, pass, addtime, ip)
        VALUES
          (@systemcode, @table_name, @purpose, @remark, @source, @sort_order, N'0', N'1', @now, @ip)
      END
    `)
  }
}

export function registerSystemDatabaseConfigRoutes(app, deps) {
  const { getPool } = deps

  app.get('/api/system/kernel/database-config', async (_req, res) => {
    try {
      const pool = await getPool()
      const savedRows = await fetchSavedDatabaseConfigs(pool)
      res.json({ code: 200, msg: 'success', data: { list: mergeConfigs(savedRows) } })
    } catch (err) {
      console.error('GET /api/system/kernel/database-config 失败：', err)
      const detail = String(err?.message ?? err?.originalError?.message ?? '读取失败')
      res.status(500).json({ code: 500, msg: `读取数据库配置失败：${detail}`, data: null })
    }
  })

  app.put('/api/system/kernel/database-config', async (req, res) => {
    try {
      const keyCheck = assertCoreKey(req.body?.key)
      if (!keyCheck.ok) {
        res.status(keyCheck.status).json({ code: keyCheck.status, msg: keyCheck.msg, data: null })
        return
      }
      const rows = normalizePayloadRows(req.body?.list)
      const pool = await getPool()
      await saveDatabaseConfigs(pool, req, rows)
      const savedRows = await fetchSavedDatabaseConfigs(pool)
      const list = mergeConfigs(savedRows)

      await writeLog(req, '保存数据库配置', `数据库配置保存成功，维护表数量：${rows.length}`, {
        targetTable: DATABASE_CONFIG_TABLE,
        pool,
      })

      res.json({ code: 200, msg: '数据库配置保存成功', data: { list } })
    } catch (err) {
      console.error('PUT /api/system/kernel/database-config 失败：', err)
      const detail = String(err?.message ?? err?.originalError?.message ?? '保存失败')
      const status = Number(err?.statusCode) || 500
      res.status(status).json({ code: status, msg: `保存数据库配置失败：${detail}`, data: null })
    }
  })
}
