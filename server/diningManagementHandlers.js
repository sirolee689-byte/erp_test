import { getPool, sql } from './db.js'
import { createDiningTableRefs } from './diningDatabase.js'
import { getActorAuditTripletFromReq } from './businessAuditFields.js'

const TIME_RE = /^([01]?\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const MONTH_RE = /^\d{6}$/
const text = (value) => String(value ?? '').trim()
const nowText = () => new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Shanghai', hour12: false }).replace('T', ' ')
function fail(message, status = 400) { const error = new Error(message); error.status = status; throw error }
function actor(req) { const value = getActorAuditTripletFromReq(req); return { uid: text(value?.uidInt), uname: text(value?.uname), utruename: text(value?.utruename) } }

function requireMonth(value) {
  const month = text(value)
  if (!MONTH_RE.test(month)) fail('年份月份格式应为 YYYYMM，例如 202608')
  const year = Number(month.slice(0, 4)); const number = Number(month.slice(4, 6))
  if (year < 2000 || year > 2100 || number < 1 || number > 12) fail('年份月份无效')
  return month
}

function requireDate(value, label) {
  const date = text(value)
  if (!DATE_RE.test(date)) fail(`${label}格式不正确`)
  const [year, month, day] = date.split('-').map(Number)
  const verified = new Date(Date.UTC(year, month - 1, day))
  if (verified.getUTCFullYear() !== year || verified.getUTCMonth() !== month - 1 || verified.getUTCDate() !== day) fail(`${label}无效`)
  return date
}

export function isDiningManagementSuperAdminDeleteRequest(method, path) {
  const m = String(method || '').toUpperCase()
  const p = String(path || '').replace(/\/+$/, '')
  return m === 'DELETE' && (
    /^\/api\/canteen\/management\/blocks\/\d+$/.test(p) ||
    /^\/api\/canteen\/management\/report-months\/\d{6}$/.test(p)
  )
}

export function createDiningManagementService(options = {}) {
  const tables = options.tables || createDiningTableRefs()
  const poolProvider = options.getPool || getPool
  async function pool() { return poolProvider() }

  async function list(input = {}) {
    const monthKey = text(input.monthKey)
    const db = await pool()
    if (monthKey) requireMonth(monthKey)
    const [config, machines, reportMonths, blocks, exceptions] = await Promise.all([
      db.request().query(`SELECT TOP (1) bc,two1,two2,three1,three2 FROM ${tables.config} WHERE code=N'UB_ERP_Dining' AND del=N'0' AND pass=N'1' ORDER BY id`),
      db.request().query(`SELECT id,ip,px,name,tdname,addtime FROM ${tables.machines} WHERE LTRIM(RTRIM(ISNULL(ip,N'')))<>N'' ORDER BY CASE WHEN LTRIM(RTRIM(ISNULL(px,N'')))<>N'' AND LTRIM(RTRIM(ISNULL(px,N''))) NOT LIKE N'%[^0-9]%' THEN CONVERT(INT,px) ELSE 999999 END,id`),
      db.request().query(`SELECT month_key,enabled,addtime,edittime FROM ${tables.reportMonths} ORDER BY month_key DESC`),
      db.request().query(`SELECT id,month_key,start_date,end_date,report_status,remark,addtime,edittime FROM ${tables.reportBlocks} WHERE del=N'0' AND enabled=N'1' ORDER BY month_key DESC,start_date,id`),
      db.request().query(`SELECT id,rule_type,target_type,target_key,target_name,start_date,end_date,remark,enabled,addtime,edittime FROM ${tables.reportExceptions} WHERE del=N'0' ORDER BY rule_type,id DESC`),
    ])
    return {
      config: config.recordset?.[0] || {},
      machines: machines.recordset || [],
      reportMonths: reportMonths.recordset || [],
      blocks: blocks.recordset || [],
      exceptions: exceptions.recordset || [],
    }
  }

  async function saveConfig(input) {
    const values = ['bc', 'two1', 'two2', 'three1', 'three2'].reduce((out, key) => ({ ...out, [key]: text(input?.[key]) }), {})
    Object.entries(values).forEach(([key, value]) => { if (!TIME_RE.test(value)) fail(`${key}时间格式不正确`) })
    const db = await pool(); const request = db.request().input('now', sql.NVarChar(50), nowText())
    Object.entries(values).forEach(([key, value]) => request.input(key, sql.NVarChar(50), value))
    const result = await request.query(`UPDATE ${tables.config} SET bc=@bc,two1=@two1,two2=@two2,three1=@three1,three2=@three2,edittime=@now WHERE code=N'UB_ERP_Dining' AND del=N'0' AND pass=N'1'`)
    if (!Number(result.rowsAffected?.[0] || 0)) fail('未找到启用的饭堂配置', 404)
    return values
  }

  async function saveMachine(input, id = null) {
    const ip = text(input?.ip); const px = text(input?.px); const name = text(input?.name)
    if (!ip || ip.length > 50 || !px || !name) fail('窗口序号、窗口名称和授权 IP 不能为空')
    const db = await pool(); const request = db.request().input('ip', sql.NVarChar(50), ip).input('px', sql.NVarChar(50), px).input('name', sql.NVarChar(50), name).input('now', sql.NVarChar(50), nowText())
    if (id) { request.input('id', sql.Int, Number(id)); await request.query(`UPDATE ${tables.machines} SET ip=@ip,px=@px,name=@name,tdname=@name,dtime=@now WHERE id=@id`) }
    else await request.query(`INSERT INTO ${tables.machines}(ip,px,name,tdname,addtime,dtime) VALUES(@ip,@px,@name,@name,@now,@now)`)
  }

  async function deleteMachine(id) { const db = await pool(); await db.request().input('id', sql.Int, Number(id)).query(`DELETE FROM ${tables.machines} WHERE id=@id`) }

  async function prepareReportMonth(input, req) {
    const monthKey = requireMonth(input?.monthKey)
    const db = await pool()
    const exists = await db.request().input('monthKey', sql.NVarChar(6), monthKey).query(`SELECT TOP (1) id FROM ${tables.reportMonths} WHERE month_key=@monthKey`)
    if (exists.recordset?.length) fail('该月份已经准备，无需重复生成')
    const user = actor(req)
    await db.request()
      .input('monthKey', sql.NVarChar(6), monthKey).input('uid', sql.NVarChar(50), user.uid).input('uname', sql.NVarChar(50), user.uname).input('utruename', sql.NVarChar(50), user.utruename).input('now', sql.NVarChar(50), nowText())
      .query(`INSERT INTO ${tables.reportMonths}(month_key,enabled,uid,uname,utruename,addtime) VALUES(@monthKey,N'1',@uid,@uname,@utruename,@now)`)
  }

  async function deleteReportMonth(monthKeyRaw) {
    const monthKey = requireMonth(monthKeyRaw)
    const db = await pool()
    const transaction = new sql.Transaction(db)
    try {
      await transaction.begin(sql.ISOLATION_LEVEL.READ_COMMITTED)
      await transaction.request().input('monthKey', sql.NVarChar(6), monthKey).query(`DELETE FROM ${tables.reportBlocks} WHERE month_key=@monthKey`)
      const result = await transaction.request().input('monthKey', sql.NVarChar(6), monthKey).query(`DELETE FROM ${tables.reportMonths} WHERE month_key=@monthKey`)
      if (!Number(result.rowsAffected?.[0] || 0)) fail('未找到该月份准备记录', 404)
      await transaction.commit()
    } catch (error) {
      try { await transaction.rollback() } catch {}
      throw error
    }
  }

  async function saveBlock(input, id = null) {
    const monthKey = requireMonth(input?.monthKey)
    const start = requireDate(input?.startDate, '开始日期'); const end = requireDate(input?.endDate, '结束日期')
    const reportStatus = text(input?.reportStatus)
    if (!['allowed', 'blocked'].includes(reportStatus) || start > end || start.replaceAll('-', '').slice(0, 6) !== monthKey || end.replaceAll('-', '').slice(0, 6) !== monthKey) {
      fail('特殊日期必须在所选月份内，并选择可报餐或不可报餐')
    }
    const db = await pool()
    const prepared = await db.request().input('monthKey', sql.NVarChar(6), monthKey).query(`SELECT TOP (1) id FROM ${tables.reportMonths} WHERE month_key=@monthKey AND enabled=N'1'`)
    if (!prepared.recordset?.length) fail('请先生成本月默认规则')
    const overlapRequest = db.request().input('monthKey', sql.NVarChar(6), monthKey).input('start', sql.NVarChar(10), start).input('end', sql.NVarChar(10), end)
    if (id) overlapRequest.input('id', sql.Int, Number(id))
    const overlap = await overlapRequest.query(`SELECT TOP (1) id FROM ${tables.reportBlocks} WHERE del=N'0' AND enabled=N'1' AND month_key=@monthKey AND start_date<=@end AND end_date>=@start ${id ? 'AND id<>@id' : ''}`)
    if (overlap.recordset?.length) fail('特殊日期不能与已有日期重叠')
    const request = db.request().input('monthKey', sql.NVarChar(6), monthKey).input('start', sql.NVarChar(10), start).input('end', sql.NVarChar(10), end).input('reportStatus', sql.NVarChar(20), reportStatus).input('remark', sql.NVarChar(500), text(input?.remark)).input('now', sql.NVarChar(50), nowText())
    if (id) {
      request.input('id', sql.Int, Number(id))
      await request.query(`UPDATE ${tables.reportBlocks} SET month_key=@monthKey,start_date=@start,end_date=@end,report_status=@reportStatus,remark=@remark,edittime=@now WHERE id=@id AND del=N'0'`)
    } else {
      const user = actor(input?.req)
      request.input('uid', sql.NVarChar(50), user.uid).input('uname', sql.NVarChar(50), user.uname).input('utruename', sql.NVarChar(50), user.utruename)
      await request.query(`INSERT INTO ${tables.reportBlocks}(title,month_key,start_date,end_date,report_status,remark,enabled,del,uid,uname,utruename,addtime) VALUES(N'报餐特殊日期',@monthKey,@start,@end,@reportStatus,@remark,N'1',N'0',@uid,@uname,@utruename,@now)`)
    }
  }

  async function deleteBlock(id) { const db = await pool(); await db.request().input('id', sql.Int, Number(id)).query(`DELETE FROM ${tables.reportBlocks} WHERE id=@id AND del=N'0'`) }

  async function saveException(input, id = null) {
    const ruleType = text(input?.ruleType); const targetType = text(input?.targetType); const targetKey = text(input?.targetKey); const targetName = text(input?.targetName)
    if (!['permanent', 'temporary'].includes(ruleType) || !['department', 'staff'].includes(targetType) || !targetKey || !targetName) fail('开放规则资料不完整')
    const start = ruleType === 'temporary' ? requireDate(input?.startDate, '开始日期') : ''; const end = ruleType === 'temporary' ? requireDate(input?.endDate, '结束日期') : ''
    if (start && start > end) fail('结束日期不能早于开始日期')
    const db = await pool(); const request = db.request().input('ruleType', sql.NVarChar(20), ruleType).input('targetType', sql.NVarChar(20), targetType).input('targetKey', sql.NVarChar(50), targetKey).input('targetName', sql.NVarChar(100), targetName).input('start', sql.NVarChar(10), start || null).input('end', sql.NVarChar(10), end || null).input('remark', sql.NVarChar(500), text(input?.remark)).input('now', sql.NVarChar(50), nowText())
    if (id) { request.input('id', sql.Int, Number(id)); await request.query(`UPDATE ${tables.reportExceptions} SET rule_type=@ruleType,target_type=@targetType,target_key=@targetKey,target_name=@targetName,start_date=@start,end_date=@end,remark=@remark,enabled=N'1',edittime=@now WHERE id=@id AND del=N'0'`) }
    else { const user = actor(input?.req); request.input('uid', sql.NVarChar(50), user.uid).input('uname', sql.NVarChar(50), user.uname).input('utruename', sql.NVarChar(50), user.utruename); await request.query(`INSERT INTO ${tables.reportExceptions}(rule_type,target_type,target_key,target_name,start_date,end_date,remark,enabled,del,uid,uname,utruename,addtime) VALUES(@ruleType,@targetType,@targetKey,@targetName,@start,@end,@remark,N'1',N'0',@uid,@uname,@utruename,@now)`) }
  }

  async function deleteException(id) { const db = await pool(); await db.request().input('id', sql.Int, Number(id)).input('now', sql.NVarChar(50), nowText()).query(`UPDATE ${tables.reportExceptions} SET del=N'1',edittime=@now WHERE id=@id`) }
  async function targets() {
    const db = await pool(); const [departments, staff] = await Promise.all([
      db.request().query(`SELECT systemcode AS value,name AS label FROM ${tables.departments} WHERE del=N'0' AND pass=N'1' AND ISNULL(systemcode,N'')<>N'' ORDER BY name`),
      db.request().query(`SELECT CONVERT(NVARCHAR(50),id) AS value,name AS label,new_code AS code FROM ${tables.staff} WHERE del=N'0' AND pass=N'1' ORDER BY name`),
    ])
    return { departments: departments.recordset || [], staff: staff.recordset || [] }
  }
  return { list, saveConfig, saveMachine, deleteMachine, prepareReportMonth, deleteReportMonth, saveBlock, deleteBlock, saveException, deleteException, targets }
}

export function registerDiningManagementRoutes(app, options = {}) {
  const service = options.service || createDiningManagementService(options)
  const send = (res, error) => res.status(error?.status || 500).json({ code: error?.status || 500, msg: error?.message || '饭堂管理处理失败', data: null })
  app.get('/api/canteen/management', async (req,res)=>{ try { res.json({code:200,msg:'success',data:await service.list({monthKey:req.query.monthKey})}) } catch(e){send(res,e)} })
  app.get('/api/canteen/management/targets', async (_req,res)=>{ try { res.json({code:200,msg:'success',data:await service.targets()}) } catch(e){send(res,e)} })
  app.put('/api/canteen/management/config', async (req,res)=>{ try { res.json({code:200,msg:'保存成功',data:await service.saveConfig(req.body)}) } catch(e){send(res,e)} })
  app.post('/api/canteen/management/machines', async (req,res)=>{ try { await service.saveMachine(req.body); res.json({code:200,msg:'新增成功'}) } catch(e){send(res,e)} })
  app.put('/api/canteen/management/machines/:id', async (req,res)=>{ try { await service.saveMachine(req.body,req.params.id); res.json({code:200,msg:'保存成功'}) } catch(e){send(res,e)} })
  app.delete('/api/canteen/management/machines/:id', async (req,res)=>{ try { await service.deleteMachine(req.params.id); res.json({code:200,msg:'删除成功'}) } catch(e){send(res,e)} })
  app.post('/api/canteen/management/report-months', async (req,res)=>{ try { await service.prepareReportMonth(req.body,req); res.json({code:200,msg:'本月默认规则已生成'}) } catch(e){send(res,e)} })
  app.delete('/api/canteen/management/report-months/:monthKey', async (req,res)=>{ try { await service.deleteReportMonth(req.params.monthKey); res.json({code:200,msg:'已删除月份准备及特殊日期'}) } catch(e){send(res,e)} })
  app.post('/api/canteen/management/blocks', async (req,res)=>{ try { await service.saveBlock({...req.body,req}); res.json({code:200,msg:'新增成功'}) } catch(e){send(res,e)} })
  app.put('/api/canteen/management/blocks/:id', async (req,res)=>{ try { await service.saveBlock({...req.body,req},req.params.id); res.json({code:200,msg:'保存成功'}) } catch(e){send(res,e)} })
  app.delete('/api/canteen/management/blocks/:id', async (req,res)=>{ try { await service.deleteBlock(req.params.id); res.json({code:200,msg:'删除成功'}) } catch(e){send(res,e)} })
  app.post('/api/canteen/management/exceptions', async (req,res)=>{ try { await service.saveException({...req.body,req}); res.json({code:200,msg:'新增成功'}) } catch(e){send(res,e)} })
  app.put('/api/canteen/management/exceptions/:id', async (req,res)=>{ try { await service.saveException({...req.body,req},req.params.id); res.json({code:200,msg:'保存成功'}) } catch(e){send(res,e)} })
  app.delete('/api/canteen/management/exceptions/:id', async (req,res)=>{ try { await service.deleteException(req.params.id); res.json({code:200,msg:'删除成功'}) } catch(e){send(res,e)} })
}
