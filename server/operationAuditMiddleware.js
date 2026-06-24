/**
 * v1.1.1+：全局操作审计中间件
 * - 准备阶段：DELETE/PUT 员工前读库，生成可读中文详情（挂到 req 上）
 * - 完成阶段：POST/PUT/DELETE 且 HTTP 200 后异步写入 UB_Date_ERP_Operation_log
 */
import { getPool, sql } from './db.js'
import { resolveAuditActionAndTable } from './action_map.js'
import {
  buildPurchaseQuotationPutDiffChinese,
  fetchPurchaseQuotationHeaderFullForAudit,
  fetchPurchaseQuotationSnapshotForAudit,
} from './purchaseQuotationHandlers.js'
import {
  buildOutsourcingQuotationPutDiffChinese,
  fetchOutsourcingQuotationHeaderFullForAudit,
  fetchOutsourcingQuotationSnapshotForAudit,
} from './outsourcingQuotationHandlers.js'

export { resolveAuditActionAndTable } from './action_map.js'

/** @param {import('express').Request} req */
export function getRequestIp(req) {
  const forwarded = String(req.headers?.['x-forwarded-for'] ?? '').trim()
  if (forwarded) {
    return forwarded.split(',')[0].trim()
  }
  const candidate = req.ip || req.socket?.remoteAddress || req.connection?.remoteAddress || ''
  return String(candidate).replace(/^::ffff:/, '').trim()
}

const HR_STAFF_TABLE = (() => {
  const t = String(process.env.HR_STAFF_TABLE ?? 'UB_ERP_Hr_staff').trim()
  if (!/^[A-Za-z0-9_]+$/.test(t)) return 'UB_ERP_Hr_staff'
  return t
})()
const HR_STAFF_FROM = `dbo.[${HR_STAFF_TABLE}]`

/** 与 server/index.js 一致：部门/岗位旧表 */
const HR_LEGACY_DEPT_TABLE = (() => {
  const t = String(process.env.HR_LEGACY_DEPT_TABLE ?? 'UB_ERP_Hr_department').trim()
  if (!/^[A-Za-z0-9_]+$/.test(t)) return 'UB_ERP_Hr_department'
  return t
})()
const HR_LEGACY_DEPT_FROM = `dbo.[${HR_LEGACY_DEPT_TABLE}]`

/** 库存基本资料：颜色编码 / 使用单位（固定物理表名） */
const BOM_COLORCODE_FROM = 'dbo.[UB_ERP_Stocks_colorcode]'
const BOM_UNIT_FROM = 'dbo.[UB_ERP_Stocks_unit]'
const BOM_UNIT_CHANGE_FROM = 'dbo.[UB_ERP_Stocks_unit_change]'
const BOM_MATERIAL_FROM = 'dbo.[UB_ERP_Stocks_material]'
const BOM_STOCKS_WORKSHOP_FROM = 'dbo.[UB_ERP_Stocks_workshop]'
const SYS_ROLES_FROM = 'dbo.[UB_ERP_System_role]'
const SYS_SUPPLIER_FROM = 'dbo.[UB_ERP_System_supplier]'
const SYS_SETTLEMENT_METHOD_FROM = 'dbo.[UB_ERP_System_settlement_method]'
const SYS_SALES_CUSTOMER_FROM = 'dbo.[UB_ERP_System_sales_customer]'

const SENSITIVE_KEY_HINTS = ['password', 'token', 'authorization', 'secret', 'credential']

/**
 * 员工档案字段 → 中文（用于变更说明；可继续扩展）
 * 说明：与前端表单字段名一致（snake_case）
 */
export const STAFF_FIELD_LABELS = {
  name: '姓名',
  card_number: '卡号',
  card_no: '卡号',
  join_department: '入职部门',
  in_bm: '部门',
  dept_name: '部门',
  remark: '备注',
  new_code: '新档案编码',
  sex: '性别',
  nation: '民族',
  highest: '文化程度',
  yn_firend: '亲友在本司',
  birth: '出生日期',
  position: '岗位',
  meal_type: '饭餐类型',
  yn_history: '曾应聘记录',
  intime: '入职时间',
}

/** 供应商字段 → 中文（用于编辑变更说明） */
const SUPPLIER_FIELD_LABELS = {
  s_code: '编码',
  s_name: '名称',
  s_sname: '简称',
  s_sh: '税号',
  s_lb: '类别',
  s_address: '地址',
  s_business: '经营范围',
  s_bank: '开户行',
  s_bank_number: '银行账号',
  s_lxr: '联系人',
  s_mobile: '手机',
  s_tel: '电话',
  s_payfor: '结算方式',
  s_jh: '货期(采购)',
  s_wx_jh: '货期(外协)',
  sl: '税率',
  kplx: '发票类型-普通发票',
  kplxx: '发票类型-增值税发票',
  kplxxx: '发票类型-电子发票',
  s_info: '备注',
}

/** 销售客户字段 → 中文（用于编辑变更说明） */
const SALES_CUSTOMER_FIELD_LABELS = {
  s_code: '编码',
  s_name: '名称',
  s_address: '地址',
  s_lxr: '联系人',
  s_tel: '电话号码',
  s_mobile: '手机号码',
  s_payfor: '结算方式',
  lxr: '本厂联系人',
  s_info: '备注',
  s_business: '经营范围',
  s_lb: '类别',
}

/**
 * 递归脱敏请求体（密码类字段替换为 ***）
 * @param {any} body
 * @returns {any}
 */
export function redactBodyForOperationAudit(body) {
  if (body === null || body === undefined) return {}
  if (typeof body !== 'object') {
    return { _raw: String(body).slice(0, 500) }
  }
  if (Array.isArray(body)) {
    return body.map((item) => redactBodyForOperationAudit(item))
  }
  /** @type {Record<string, any>} */
  const out = {}
  for (const [k, v] of Object.entries(body)) {
    const lk = String(k).toLowerCase()
    const sensitive =
      SENSITIVE_KEY_HINTS.some((h) => lk.includes(h)) || lk === 'pwd' || lk.endsWith('password')
    if (sensitive) {
      out[k] = '***'
    } else if (v && typeof v === 'object') {
      out[k] = redactBodyForOperationAudit(v)
    } else {
      out[k] = v
    }
  }
  return out
}

const MAX_CONTENT_LEN = 2000

/**
 * 列表展示用：空值统一为「空」
 * @param {any} v
 */
function displayCell(v) {
  if (v === null || v === undefined) return '空'
  const s = String(v).trim()
  return s === '' ? '空' : s
}

/**
 * 请求体/数据库里「有意义的非空字符串」（空串、纯空白、null 视为无，不写入详情）
 * @param {any} v
 * @returns {string|null}
 */
function meaningfulStr(v) {
  if (v === null || v === undefined) return null
  const s = String(v).trim()
  return s === '' ? null : s
}

/**
 * 当前登录人展示名（用于详情句首直接显示姓名/工号）
 * @param {any} user
 */
function operatorDisplayName(user) {
  return String(user?.userName ?? user?.userCode ?? '未知').trim() || '未知'
}

/**
 * @param {import('mssql').ConnectionPool} pool
 * @param {string} code
 */
async function fetchDeptSnapshotForAudit(pool, code) {
  const c = String(code ?? '').trim()
  if (!c) return null
  const r = await pool.request().input('code', sql.NVarChar(50), c).query(`
    SELECT TOP (1)
      t.code AS code,
      t.name AS name,
      t.remark AS remark,
      t.ParentID AS ParentID
    FROM ${HR_LEGACY_DEPT_FROM} AS t
    WHERE t.code = @code
  `)
  return r.recordset?.[0] ?? null
}

/** 部门编辑字段 → 中文 */
const DEPT_FIELD_LABELS = {
  name: '名称',
  remark: '备注',
  ParentID: '上级编码',
}

/**
 * PUT 部门：对比旧库与请求体
 * @param {Record<string, any>} oldRow
 * @param {Record<string, any>} body
 */
export function buildPutDepartmentChineseDiff(oldRow, body) {
  if (!oldRow || !body || typeof body !== 'object') return ''
  const parts = []
  for (const key of Object.keys(DEPT_FIELD_LABELS)) {
    if (!(key in body)) continue
    const label = DEPT_FIELD_LABELS[key]
    const oldV = displayCell(oldRow[key])
    const newV = displayCell(body[key])
    if (oldV === newV) continue
    parts.push(`修改了[${label}]：由[${oldV}]改为[${newV}]`)
  }
  if (!parts.length) return '未检测到与数据库相比的字段变更。'
  return parts.join('；')
}

/**
 * POST 部门/岗位：仅展示非空字段；空 remark、ParentID 等不出现
 * @param {any} user
 * @param {Record<string, any>} body
 */
export function buildPostDepartmentChineseContent(user, body) {
  if (!body || typeof body !== 'object') return ''
  const op = operatorDisplayName(user)
  const name = meaningfulStr(body.name)
  if (!name) return `${op}提交了新增部门/岗位请求（名称为空，异常请求）`
  const parentId = meaningfulStr(body.ParentID)
  const remark = meaningfulStr(body.remark)
  const isPost = parentId != null
  let s = isPost
    ? `${op}新增了岗位「${name}」，所属部门编码[${parentId}]`
    : `${op}新增了部门「${name}」`
  if (remark) s += `，备注「${remark}」`
  return s
}

/**
 * @param {import('mssql').ConnectionPool} pool
 * @param {string} code
 */
async function fetchStaffSnapshotForAudit(pool, code) {
  const c = String(code ?? '').trim()
  if (!c) return null
  const r = await pool.request().input('code', sql.NVarChar(50), c).query(`
    SELECT TOP (1)
      s.code AS code,
      s.new_code AS new_code,
      s.name AS name,
      s.sex AS sex,
      s.nation AS nation,
      s.highest AS highest,
      s.yn_firend AS yn_firend,
      s.birth AS birth,
      s.in_bm AS in_bm,
      s.card_number AS card_number,
      s.join_department AS join_department,
      s.position AS position,
      s.meal_type AS meal_type,
      s.yn_history AS yn_history,
      s.remark AS remark,
      s.intime AS intime
    FROM ${HR_STAFF_FROM} AS s
    WHERE s.code = @code
  `)
  return r.recordset?.[0] ?? null
}

/**
 * @param {import('mssql').ConnectionPool} pool
 * @param {string} codeRaw
 */
async function fetchColorCodeSnapshotForAudit(pool, codeRaw) {
  const code = String(codeRaw ?? '').trim()
  if (!code) return null
  const r = await pool.request().input('code', sql.NVarChar(100), code).query(`
    SELECT TOP (1)
      LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(b.code, N'')))) AS code,
      LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(b.name, N'')))) AS name,
      LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(b.ename, N'')))) AS ename,
      LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(b.info, N'')))) AS info,
      LTRIM(RTRIM(CONVERT(nvarchar(10), ISNULL(b.del, N'')))) AS del
    FROM ${BOM_COLORCODE_FROM} AS b
    WHERE LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(b.code, N'')))) = @code
  `)
  return r.recordset?.[0] ?? null
}

/**
 * @param {import('mssql').ConnectionPool} pool
 * @param {number} id
 */
async function fetchUnitSnapshotForAudit(pool, id) {
  const n = Number(id)
  if (!Number.isFinite(n) || n <= 0) return null
  const r = await pool.request().input('id', sql.Int, n).query(`
    SELECT TOP (1)
      u.id AS id,
      LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(u.name, N'')))) AS name,
      LTRIM(RTRIM(CONVERT(nvarchar(10), ISNULL(u.del, N'')))) AS del
    FROM ${BOM_UNIT_FROM} AS u
    WHERE u.id = @id
  `)
  return r.recordset?.[0] ?? null
}

/**
 * @param {import('mssql').ConnectionPool} pool
 * @param {number} id
 */
async function fetchUnitChangeSnapshotForAudit(pool, id) {
  const n = Number(id)
  if (!Number.isFinite(n) || n <= 0) return null
  const r = await pool.request().input('id', sql.Int, n).query(`
    SELECT TOP (1)
      c.id AS id,
      LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(c.unit_name, N'')))) AS unit_name,
      LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(c.unit_name_tow, N'')))) AS unit_name_tow,
      LTRIM(RTRIM(CONVERT(nvarchar(50), ISNULL(c.change_bl, N'')))) AS change_bl,
      LTRIM(RTRIM(CONVERT(nvarchar(10), ISNULL(c.del, N'')))) AS del
    FROM ${BOM_UNIT_CHANGE_FROM} AS c
    WHERE c.id = @id
  `)
  return r.recordset?.[0] ?? null
}

/**
 * @param {import('mssql').ConnectionPool} pool
 * @param {number} id
 */
async function fetchMaterialSnapshotForAudit(pool, id) {
  const n = Number(id)
  if (!Number.isFinite(n) || n <= 0) return null
  const r = await pool.request().input('id', sql.Int, n).query(`
    SELECT TOP (1)
      m.id AS id,
      LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(m.code, N'')))) AS code,
      LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(m.name, N'')))) AS name,
      LTRIM(RTRIM(CONVERT(nvarchar(10), ISNULL(m.del, N'')))) AS del
    FROM ${BOM_MATERIAL_FROM} AS m
    WHERE m.id = @id
  `)
  return r.recordset?.[0] ?? null
}

/**
 * 车间与部门编码快照（用于可读操作日志）
 * @param {import('mssql').ConnectionPool} pool
 * @param {number} id
 */
async function fetchStocksWorkshopSnapshotForAudit(pool, id) {
  const rid = Number(id)
  if (!Number.isFinite(rid) || rid <= 0) return null
  const r = await pool.request().input('id', sql.Int, rid).query(`
    SELECT TOP (1)
      w.id AS id,
      LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(w.code, N'')))) AS code,
      LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(w.name, N'')))) AS name,
      LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(w.info, N'')))) AS info,
      LTRIM(RTRIM(CONVERT(nvarchar(10), ISNULL(w.pass, N'')))) AS pass,
      LTRIM(RTRIM(CONVERT(nvarchar(10), ISNULL(w.del, N'')))) AS del
    FROM ${BOM_STOCKS_WORKSHOP_FROM} AS w
    WHERE w.id = @id
  `)
  return r.recordset?.[0] ?? null
}

/**
 * 角色快照（用于可读操作日志）
 * @param {import('mssql').ConnectionPool} pool
 * @param {number} roleId
 */
async function fetchRoleSnapshotForAudit(pool, roleId) {
  const id = Number(roleId)
  if (!Number.isFinite(id) || id <= 0) return null
  const r = await pool.request().input('RoleID', sql.Int, id).query(`
    SELECT TOP (1)
      r.RoleID AS RoleID,
      LTRIM(RTRIM(CONVERT(nvarchar(50), ISNULL(r.RoleName, N'')))) AS RoleName,
      LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(r.Description, N'')))) AS Description,
      LTRIM(RTRIM(CONVERT(nvarchar(10), ISNULL(r.pass, N'')))) AS pass
    FROM ${SYS_ROLES_FROM} AS r
    WHERE r.RoleID = @RoleID
  `)
  return r.recordset?.[0] ?? null
}

/**
 * 供应商快照（用于可读操作日志）
 * @param {import('mssql').ConnectionPool} pool
 * @param {number} id
 */
async function fetchSupplierSnapshotForAudit(pool, id) {
  const rid = Number(id)
  if (!Number.isFinite(rid) || rid <= 0) return null
  const r = await pool.request().input('id', sql.Int, rid).query(`
    SELECT TOP (1)
      s.id AS id,
      LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(s.s_code, N'')))) AS s_code,
      LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(s.s_name, N'')))) AS s_name,
      LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(s.s_sname, N'')))) AS s_sname,
      LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(s.s_sh, N'')))) AS s_sh,
      LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(s.s_lb, N'')))) AS s_lb,
      LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(s.s_lxr, N'')))) AS s_lxr,
      LTRIM(RTRIM(CONVERT(nvarchar(50), ISNULL(s.s_mobile, N'')))) AS s_mobile,
      LTRIM(RTRIM(CONVERT(nvarchar(50), ISNULL(s.s_tel, N'')))) AS s_tel,
      LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(s.s_payfor, N'')))) AS s_payfor,
      LTRIM(RTRIM(CONVERT(nvarchar(50), ISNULL(s.s_jh, N'')))) AS s_jh,
      LTRIM(RTRIM(CONVERT(nvarchar(50), ISNULL(s.s_wx_jh, N'')))) AS s_wx_jh,
      LTRIM(RTRIM(CONVERT(nvarchar(50), ISNULL(s.sl, N'')))) AS sl,
      LTRIM(RTRIM(CONVERT(nvarchar(10), ISNULL(s.kplx, N'')))) AS kplx,
      LTRIM(RTRIM(CONVERT(nvarchar(10), ISNULL(s.kplxx, N'')))) AS kplxx,
      LTRIM(RTRIM(CONVERT(nvarchar(10), ISNULL(s.kplxxx, N'')))) AS kplxxx,
      LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(s.s_address, N'')))) AS s_address,
      LTRIM(RTRIM(CONVERT(nvarchar(1000), ISNULL(s.s_business, N'')))) AS s_business,
      LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(s.s_bank, N'')))) AS s_bank,
      LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(s.s_bank_number, N'')))) AS s_bank_number,
      LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(s.s_info, N'')))) AS s_info,
      LTRIM(RTRIM(CONVERT(nvarchar(10), ISNULL(s.pass, N'')))) AS pass,
      LTRIM(RTRIM(CONVERT(nvarchar(10), ISNULL(s.del, N'')))) AS del
    FROM ${SYS_SUPPLIER_FROM} AS s
    WHERE s.id = @id
  `)
  return r.recordset?.[0] ?? null
}

/**
 * 销售客户快照（用于可读操作日志）
 * @param {import('mssql').ConnectionPool} pool
 * @param {number} id
 */
async function fetchSalesCustomerSnapshotForAudit(pool, id) {
  const rid = Number(id)
  if (!Number.isFinite(rid) || rid <= 0) return null
  const r = await pool.request().input('id', sql.Int, rid).query(`
    SELECT TOP (1)
      c.id AS id,
      LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(c.s_code, N'')))) AS s_code,
      LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(c.s_name, N'')))) AS s_name,
      LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(c.s_address, N'')))) AS s_address,
      LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(c.s_lxr, N'')))) AS s_lxr,
      LTRIM(RTRIM(CONVERT(nvarchar(50), ISNULL(c.s_tel, N'')))) AS s_tel,
      LTRIM(RTRIM(CONVERT(nvarchar(50), ISNULL(c.s_mobile, N'')))) AS s_mobile,
      LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(c.s_payfor, N'')))) AS s_payfor,
      LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(c.lxr, N'')))) AS lxr,
      LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(c.s_info, N'')))) AS s_info,
      LTRIM(RTRIM(CONVERT(nvarchar(1000), ISNULL(c.s_business, N'')))) AS s_business,
      LTRIM(RTRIM(CONVERT(nvarchar(50), ISNULL(c.s_lb, N'')))) AS s_lb,
      LTRIM(RTRIM(CONVERT(nvarchar(10), ISNULL(c.pass, N'')))) AS pass,
      LTRIM(RTRIM(CONVERT(nvarchar(10), ISNULL(c.del, N'')))) AS del
    FROM ${SYS_SALES_CUSTOMER_FROM} AS c
    WHERE c.id = @id
  `)
  return r.recordset?.[0] ?? null
}

/**
 * 结算方式快照（用于可读操作日志）
 * @param {import('mssql').ConnectionPool} pool
 * @param {number} id
 */
async function fetchSettlementMethodSnapshotForAudit(pool, id) {
  const rid = Number(id)
  if (!Number.isFinite(rid) || rid <= 0) return null
  const r = await pool.request().input('id', sql.Int, rid).query(`
    SELECT TOP (1)
      m.id AS id,
      LTRIM(RTRIM(CONVERT(nvarchar(50), ISNULL(m.code, N'')))) AS code,
      LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(m.name, N'')))) AS name,
      LTRIM(RTRIM(CONVERT(nvarchar(50), ISNULL(m.payfor, N'')))) AS payfor,
      LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(m.info, N'')))) AS info,
      LTRIM(RTRIM(CONVERT(nvarchar(10), ISNULL(m.pass, N'')))) AS pass,
      LTRIM(RTRIM(CONVERT(nvarchar(10), ISNULL(m.del, N'')))) AS del
    FROM ${SYS_SETTLEMENT_METHOD_FROM} AS m
    WHERE m.id = @id
  `)
  return r.recordset?.[0] ?? null
}

/**
 * PUT 员工：对比旧库与请求体，生成中文变更句（仅列出有变化的字段）
 * @param {Record<string, any>} oldRow
 * @param {Record<string, any>} body
 */
export function buildStaffUpdateChineseDiff(oldRow, body) {
  if (!oldRow || !body || typeof body !== 'object') return ''
  const parts = []
  const keys = new Set([...Object.keys(STAFF_FIELD_LABELS), ...Object.keys(oldRow), ...Object.keys(body)])
  for (const key of keys) {
    if (key === 'code' || key === 'pass') continue
    const label = STAFF_FIELD_LABELS[key]
    if (!label) continue
    if (!(key in body)) continue
    const oldV = displayCell(oldRow[key])
    const newV = displayCell(body[key])
    if (oldV === newV) continue
    parts.push(`修改了[${label}]：由[${oldV}]改为[${newV}]`)
  }
  if (!parts.length) return '未检测到与数据库相比的字段变更（或仅提交了未映射字段）。'
  return parts.join('；')
}

/**
 * PUT 供应商：对比旧库与请求体，生成中文变更句（仅列出有变化的字段）
 * @param {Record<string, any>} oldRow
 * @param {Record<string, any>} body
 */
function buildSupplierUpdateChineseDiff(oldRow, body) {
  if (!oldRow || !body || typeof body !== 'object') return ''
  const parts = []
  const keys = new Set([...Object.keys(SUPPLIER_FIELD_LABELS), ...Object.keys(oldRow), ...Object.keys(body)])
  for (const key of keys) {
    const label = SUPPLIER_FIELD_LABELS[key]
    if (!label) continue
    if (!(key in body)) continue
    const oldV = displayCell(oldRow[key])
    const newV = displayCell(body[key])
    if (oldV === newV) continue
    parts.push(`修改了[${label}]：由[${oldV}]改为[${newV}]`)
  }
  if (!parts.length) return '未检测到与数据库相比的字段变更。'
  return parts.join('；')
}

/**
 * PUT 销售客户：对比旧库与请求体，生成中文变更句（仅列出有变化的字段）
 * @param {Record<string, any>} oldRow
 * @param {Record<string, any>} body
 */
function buildSalesCustomerUpdateChineseDiff(oldRow, body) {
  if (!oldRow || !body || typeof body !== 'object') return ''
  const parts = []
  const keys = new Set([...Object.keys(SALES_CUSTOMER_FIELD_LABELS), ...Object.keys(oldRow), ...Object.keys(body)])
  for (const key of keys) {
    const label = SALES_CUSTOMER_FIELD_LABELS[key]
    if (!label) continue
    if (!(key in body)) continue
    const oldV = displayCell(oldRow[key])
    const newV = displayCell(body[key])
    if (oldV === newV) continue
    parts.push(`修改了[${label}]：由[${oldV}]改为[${newV}]`)
  }
  if (!parts.length) return '未检测到与数据库相比的字段变更。'
  return parts.join('；')
}

/**
 * POST 员工：根据请求体生成简短中文（工号由服务端生成，此处不编造 code）
 * @param {any} user
 * @param {Record<string, any>} body
 */
export function buildPostStaffChineseSummary(user, body) {
  if (!body || typeof body !== 'object') return ''
  const op = operatorDisplayName(user)
  const name = displayCell(body.name)
  const card = displayCell(body.card_number ?? body.card_no)
  const dept = displayCell(body.join_department ?? body.dept_name)
  const rm = displayCell(body.remark)
  const bits = [`${op}新增了员工档案，姓名[${name}]，卡号[${card}]`]
  if (dept !== '空') bits.push(`入职部门[${dept}]`)
  if (rm !== '空') bits.push(`备注[${rm}]`)
  return `${bits.join('，')}（工号由服务端自动生成）`
}

/**
 * 删除/修改员工前：读库生成中文详情上下文（供 finish 阶段写入 Content）
 */
export function createOperationAuditPrepareMiddleware() {
  return async function operationAuditPrepare(req, res, next) {
    const path = String(req.path || '')
    const method = String(req.method || '').toUpperCase()
    if (!path.startsWith('/api/') || path === '/api/login' || path === '/api/health') {
      return next()
    }

    try {
      const pool = await getPool()

      // === 供应商资料：审核/反审/恢复/删除/彻底删除/编辑前读库补全编码与名称 ===
      if (
        (method === 'PUT' &&
          (path === '/api/supply-chain/suppliers/audit' ||
            path === '/api/supply-chain/suppliers/unaudit' ||
            path === '/api/supply-chain/suppliers/restore' ||
            path === '/api/supply-chain/suppliers')) ||
        (method === 'DELETE' &&
          (/^\/api\/supply-chain\/suppliers\/\d+$/.test(path) ||
            /^\/api\/supply-chain\/suppliers\/\d+\/permanent$/.test(path)))
      ) {
        const id =
          method === 'DELETE'
            ? Number(path.slice('/api/supply-chain/suppliers/'.length).replace(/\/permanent$/, ''))
            : Number(req.body?.id)
        if (Number.isFinite(id) && id > 0) {
          const row = await fetchSupplierSnapshotForAudit(pool, id)
          if (row) {
            req.__auditSupplierSnapshot = {
              id: Number(row.id ?? id),
              s_code: String(row.s_code ?? ''),
              s_name: String(row.s_name ?? ''),
              pass: String(row.pass ?? ''),
              del: String(row.del ?? ''),
            }
          }
        }
      }

      if (method === 'PUT' && path === '/api/supply-chain/suppliers') {
        const id = Number(req.body?.id)
        if (Number.isFinite(id) && id > 0) {
          const oldRow = await fetchSupplierSnapshotForAudit(pool, id)
          if (oldRow) {
            req.__auditPutSupplierDiff = buildSupplierUpdateChineseDiff(oldRow, req.body ?? {})
          }
        }
      }

      // === 销售客户：审核/反审/恢复/删除/彻底删除/编辑前读库补全编码与名称 ===
      if (
        (method === 'PUT' &&
          (path === '/api/supply-chain/customers/audit' ||
            path === '/api/supply-chain/customers/unaudit' ||
            path === '/api/supply-chain/customers/restore' ||
            path === '/api/supply-chain/customers')) ||
        (method === 'DELETE' &&
          (/^\/api\/supply-chain\/customers\/\d+$/.test(path) ||
            /^\/api\/supply-chain\/customers\/\d+\/permanent$/.test(path)))
      ) {
        const id =
          method === 'DELETE'
            ? Number(path.slice('/api/supply-chain/customers/'.length).replace(/\/permanent$/, ''))
            : Number(req.body?.id)
        if (Number.isFinite(id) && id > 0) {
          const row = await fetchSalesCustomerSnapshotForAudit(pool, id)
          if (row) {
            req.__auditSalesCustomerSnapshot = {
              id: Number(row.id ?? id),
              s_code: String(row.s_code ?? ''),
              s_name: String(row.s_name ?? ''),
              pass: String(row.pass ?? ''),
              del: String(row.del ?? ''),
            }
          }
        }
      }

      if (method === 'PUT' && path === '/api/supply-chain/customers') {
        const id = Number(req.body?.id)
        if (Number.isFinite(id) && id > 0) {
          const oldRow = await fetchSalesCustomerSnapshotForAudit(pool, id)
          if (oldRow) {
            req.__auditPutSalesCustomerDiff = buildSalesCustomerUpdateChineseDiff(oldRow, req.body ?? {})
          }
        }
      }

      // === 结算方式：审核/反审/恢复/删除/彻底删除/编辑前读库补全编码与名称 ===
      if (
        (method === 'PUT' &&
          (path === '/api/supply-chain/settlement-methods/audit' ||
            path === '/api/supply-chain/settlement-methods/unaudit' ||
            path === '/api/supply-chain/settlement-methods/restore' ||
            path === '/api/supply-chain/settlement-methods')) ||
        (method === 'DELETE' &&
          (/^\/api\/supply-chain\/settlement-methods\/\d+$/.test(path) ||
            /^\/api\/supply-chain\/settlement-methods\/\d+\/permanent$/.test(path)))
      ) {
        const id =
          method === 'DELETE'
            ? Number(path.slice('/api/supply-chain/settlement-methods/'.length).replace(/\/permanent$/, ''))
            : Number(req.body?.id)
        if (Number.isFinite(id) && id > 0) {
          const row = await fetchSettlementMethodSnapshotForAudit(pool, id)
          if (row) {
            req.__auditSettlementMethodSnapshot = {
              id: Number(row.id ?? id),
              code: String(row.code ?? ''),
              name: String(row.name ?? ''),
              pass: String(row.pass ?? ''),
              del: String(row.del ?? ''),
            }
          }
        }
      }

      if (method === 'PUT' && path === '/api/supply-chain/settlement-methods') {
        const id = Number(req.body?.id)
        if (Number.isFinite(id) && id > 0) {
          const oldRow = await fetchSettlementMethodSnapshotForAudit(pool, id)
          if (oldRow) {
            const parts = []
            const body = req.body ?? {}
            if ('name' in body) parts.push(`名称[${displayCell(oldRow.name)}→${displayCell(body.name)}]`)
            if ('payfor' in body) parts.push(`天数[${displayCell(oldRow.payfor)}→${displayCell(body.payfor)}]`)
            if ('info' in body) parts.push(`备注[${displayCell(oldRow.info)}→${displayCell(body.info)}]`)
            req.__auditPutSettlementMethodDiff = parts.filter(Boolean).join('，')
          }
        }
      }

      // === 采购报价（主从）===
      if (
        (method === 'PUT' &&
          (path === '/api/supply-chain/purchase-quotations/audit' ||
            path === '/api/supply-chain/purchase-quotations/unaudit' ||
            path === '/api/supply-chain/purchase-quotations/restore' ||
            path === '/api/supply-chain/purchase-quotations')) ||
        (method === 'DELETE' &&
          (/^\/api\/supply-chain\/purchase-quotations\/[^/]+$/.test(path) ||
            /^\/api\/supply-chain\/purchase-quotations\/[^/]+\/permanent$/.test(path)))
      ) {
        if (method === 'DELETE') {
          const tail = path
            .slice('/api/supply-chain/purchase-quotations/'.length)
            .replace(/\/permanent$/, '')
          let auditId = tail
          try {
            auditId = decodeURIComponent(tail)
          } catch {
            /* ignore */
          }
          if (String(auditId).trim()) {
            const row = await fetchPurchaseQuotationSnapshotForAudit(pool, auditId)
            if (row) req.__auditPurchaseQuotationSnapshot = row
          }
        } else {
          const rawId = req.body?.id
          if (rawId !== undefined && rawId !== null && String(rawId).trim() !== '') {
            const row = await fetchPurchaseQuotationSnapshotForAudit(pool, rawId)
            if (row) req.__auditPurchaseQuotationSnapshot = row
          }
        }
      }

      if (method === 'PUT' && path === '/api/supply-chain/purchase-quotations') {
        const rawId = req.body?.id
        if (rawId !== undefined && rawId !== null && String(rawId).trim() !== '') {
          const oldRow = await fetchPurchaseQuotationHeaderFullForAudit(pool, rawId)
          if (oldRow) {
            req.__auditPutPurchaseQuotationDiff = buildPurchaseQuotationPutDiffChinese(oldRow, req.body ?? {})
          }
        }
      }

      // === 外协报价（主从）===
      if (
        (method === 'PUT' &&
          (path === '/api/supply-chain/outsourcing-quotations/audit' ||
            path === '/api/supply-chain/outsourcing-quotations/unaudit' ||
            path === '/api/supply-chain/outsourcing-quotations/restore' ||
            path === '/api/supply-chain/outsourcing-quotations')) ||
        (method === 'DELETE' &&
          (/^\/api\/supply-chain\/outsourcing-quotations\/[^/]+$/.test(path) ||
            /^\/api\/supply-chain\/outsourcing-quotations\/[^/]+\/permanent$/.test(path)))
      ) {
        if (method === 'DELETE') {
          const tail = path
            .slice('/api/supply-chain/outsourcing-quotations/'.length)
            .replace(/\/permanent$/, '')
          let auditId = tail
          try {
            auditId = decodeURIComponent(tail)
          } catch {
            /* ignore */
          }
          if (String(auditId).trim()) {
            const row = await fetchOutsourcingQuotationSnapshotForAudit(pool, auditId)
            if (row) req.__auditOutsourcingQuotationSnapshot = row
          }
        } else {
          const rawId = req.body?.id
          if (rawId !== undefined && rawId !== null && String(rawId).trim() !== '') {
            const row = await fetchOutsourcingQuotationSnapshotForAudit(pool, rawId)
            if (row) req.__auditOutsourcingQuotationSnapshot = row
          }
        }
      }

      if (method === 'PUT' && path === '/api/supply-chain/outsourcing-quotations') {
        const rawId = req.body?.id
        if (rawId !== undefined && rawId !== null && String(rawId).trim() !== '') {
          const oldRow = await fetchOutsourcingQuotationHeaderFullForAudit(pool, rawId)
          if (oldRow) {
            req.__auditPutOutsourcingQuotationDiff = buildOutsourcingQuotationPutDiffChinese(oldRow, req.body ?? {})
          }
        }
      }

      // === 角色管理：用于禁用/恢复/删/分配权限的可读日志 ===
      if (method === 'PUT' && path === '/api/roles') {
        const body = req.body ?? {}
        const roleId = Number(body.RoleID)
        // 仅当本次是“禁用分支”（body.pass/body.Status 存在）时才读库补全角色名
        const hasPass = body.pass !== undefined && body.pass !== null
        const hasStatus = body.Status !== undefined && body.Status !== null
        if ((hasPass || hasStatus) && Number.isFinite(roleId) && roleId > 0) {
          const row = await fetchRoleSnapshotForAudit(pool, roleId)
          if (row) req.__auditRoleSnapshot = row
        }
      }
      if (method === 'PUT' && (path === '/api/roles/resume' || path === '/api/roles/permissions')) {
        const roleId = Number(req.body?.RoleID)
        if (Number.isFinite(roleId) && roleId > 0) {
          const row = await fetchRoleSnapshotForAudit(pool, roleId)
          if (row) req.__auditRoleSnapshot = row
        }
      }
      if (method === 'DELETE' && /^\/api\/roles\/\d+$/.test(path)) {
        const idStr = path.slice('/api/roles/'.length)
        const roleId = Number(idStr)
        if (Number.isFinite(roleId) && roleId > 0) {
          const row = await fetchRoleSnapshotForAudit(pool, roleId)
          if (row) req.__auditRoleSnapshot = row
        }
      }

      // === 库存基本资料：颜色编码 / 使用单位（用于软删/审核等可读日志） ===
      if (method === 'DELETE' && /^\/api\/inventory\/color-code\/.+$/.test(path)) {
        // /api/inventory/color-code/:code 或 /api/inventory/color-code/:code/permanent
        const rest = path.slice('/api/inventory/color-code/'.length)
        const codeEnc = rest.replace(/\/permanent$/, '')
        const code = decodeURIComponent(codeEnc).trim()
        if (code) {
          const row = await fetchColorCodeSnapshotForAudit(pool, code)
          if (row) {
            req.__auditDeleteColorCode = { code: String(row.code ?? code), name: String(row.name ?? '') }
          }
        }
      }

      if (method === 'PUT' && (path === '/api/inventory/color-code/audit' || path === '/api/inventory/color-code/unaudit' || path === '/api/inventory/color-code/restore')) {
        const code = String(req.body?.code ?? '').trim()
        if (code) {
          const row = await fetchColorCodeSnapshotForAudit(pool, code)
          if (row) {
            req.__auditColorCodeCodeName = { code: String(row.code ?? code), name: String(row.name ?? '') }
          }
        }
      }

      if (method === 'PUT' && path === '/api/inventory/color-code') {
        const body = req.body ?? {}
        const code = String(body.code ?? '').trim()
        if (code) {
          const oldRow = await fetchColorCodeSnapshotForAudit(pool, code)
          if (oldRow) {
            const parts = []
            if ('name' in body) parts.push(`名称[${displayCell(oldRow.name)}→${displayCell(body.name)}]`)
            if ('ename' in body) parts.push(`英文名[${displayCell(oldRow.ename)}→${displayCell(body.ename)}]`)
            if ('info' in body) parts.push(`备注[${displayCell(oldRow.info)}→${displayCell(body.info)}]`)
            req.__auditPutColorCodeDiff = parts.filter(Boolean).join('，')
          }
        }
      }

      if (method === 'DELETE' && /^\/api\/inventory\/units\/\d+(\/permanent)?$/.test(path)) {
        const idStr = path.slice('/api/inventory/units/'.length).replace(/\/permanent$/, '')
        const id = Number(idStr)
        if (Number.isFinite(id) && id > 0) {
          const row = await fetchUnitSnapshotForAudit(pool, id)
          if (row) {
            req.__auditDeleteUnit = { id: Number(row.id ?? id), name: String(row.name ?? '') }
          }
        }
      }

      if (method === 'PUT' && (path === '/api/inventory/units/audit' || path === '/api/inventory/units/unaudit' || path === '/api/inventory/units/restore')) {
        const id = Number(req.body?.id)
        if (Number.isFinite(id) && id > 0) {
          const row = await fetchUnitSnapshotForAudit(pool, id)
          if (row) {
            req.__auditUnitIdName = { id: Number(row.id ?? id), name: String(row.name ?? '') }
          }
        }
      }

      // 单位转换率 UB_ERP_Stocks_unit_change
      if (method === 'DELETE' && /^\/api\/inventory\/unit-conversion\/\d+(\/permanent)?$/.test(path)) {
        const idStr = path.slice('/api/inventory/unit-conversion/'.length).replace(/\/permanent$/, '')
        const id = Number(idStr)
        if (Number.isFinite(id) && id > 0) {
          const row = await fetchUnitChangeSnapshotForAudit(pool, id)
          if (row) {
            req.__auditDeleteUnitChange = {
              id: Number(row.id ?? id),
              unit_name: String(row.unit_name ?? ''),
              unit_name_tow: String(row.unit_name_tow ?? ''),
              change_bl: String(row.change_bl ?? ''),
            }
          }
        }
      }

      if (
        method === 'PUT' &&
        (path === '/api/inventory/unit-conversion/audit' ||
          path === '/api/inventory/unit-conversion/unaudit' ||
          path === '/api/inventory/unit-conversion/restore')
      ) {
        const id = Number(req.body?.id)
        if (Number.isFinite(id) && id > 0) {
          const row = await fetchUnitChangeSnapshotForAudit(pool, id)
          if (row) {
            req.__auditUnitChangeSnapshot = {
              id: Number(row.id ?? id),
              unit_name: String(row.unit_name ?? ''),
              unit_name_tow: String(row.unit_name_tow ?? ''),
              change_bl: String(row.change_bl ?? ''),
            }
          }
        }
      }

      // 材料分类 UB_ERP_Stocks_material
      if (method === 'DELETE' && /^\/api\/inventory\/material-category\/\d+(\/permanent)?$/.test(path)) {
        const idStr = path.slice('/api/inventory/material-category/'.length).replace(/\/permanent$/, '')
        const id = Number(idStr)
        if (Number.isFinite(id) && id > 0) {
          const row = await fetchMaterialSnapshotForAudit(pool, id)
          if (row) {
            req.__auditDeleteMaterial = { id: Number(row.id ?? id), code: String(row.code ?? ''), name: String(row.name ?? '') }
          }
        }
      }

      if (
        method === 'PUT' &&
        (path === '/api/inventory/material-category/audit' ||
          path === '/api/inventory/material-category/unaudit' ||
          path === '/api/inventory/material-category/restore')
      ) {
        const id = Number(req.body?.id)
        if (Number.isFinite(id) && id > 0) {
          const row = await fetchMaterialSnapshotForAudit(pool, id)
          if (row) {
            req.__auditMaterialSnapshot = { id: Number(row.id ?? id), code: String(row.code ?? ''), name: String(row.name ?? '') }
          }
        }
      }

      // 车间与部门编码 UB_ERP_Stocks_workshop
      if (method === 'DELETE' && /^\/api\/inventory\/workshop-dept\/\d+(\/permanent)?$/.test(path)) {
        const idStr = path.slice('/api/inventory/workshop-dept/'.length).replace(/\/permanent$/, '')
        const id = Number(idStr)
        if (Number.isFinite(id) && id > 0) {
          const row = await fetchStocksWorkshopSnapshotForAudit(pool, id)
          if (row) {
            req.__auditDeleteStocksWorkshop = { id: Number(row.id ?? id), code: String(row.code ?? ''), name: String(row.name ?? '') }
          }
        }
      }

      if (
        method === 'PUT' &&
        (path === '/api/inventory/workshop-dept/audit' ||
          path === '/api/inventory/workshop-dept/unaudit' ||
          path === '/api/inventory/workshop-dept/restore')
      ) {
        const id = Number(req.body?.id)
        if (Number.isFinite(id) && id > 0) {
          const row = await fetchStocksWorkshopSnapshotForAudit(pool, id)
          if (row) {
            req.__auditStocksWorkshopSnapshot = { id: Number(row.id ?? id), code: String(row.code ?? ''), name: String(row.name ?? '') }
          }
        }
      }

      if (method === 'DELETE' && /^\/api\/hr\/staff\/[^/]+$/.test(path)) {
        const codeEnc = path.slice('/api/hr/staff/'.length)
        const code = decodeURIComponent(codeEnc).trim()
        if (code) {
          const r = await pool.request().input('code', sql.NVarChar(50), code).query(`
            SELECT TOP (1) s.name AS name, s.code AS code
            FROM ${HR_STAFF_FROM} AS s
            WHERE s.code = @code
          `)
          const row = r.recordset?.[0]
          if (row) {
            req.__auditDeleteStaff = {
              name: String(row.name ?? ''),
              code: String(row.code ?? ''),
            }
          }
        }
      }

      if (method === 'PUT' && path === '/api/hr/staff') {
        const body = req.body ?? {}
        const code = String(body.code ?? '').trim()
        if (code) {
          const oldRow = await fetchStaffSnapshotForAudit(pool, code)
          if (oldRow) {
            req.__auditPutStaffDiff = buildStaffUpdateChineseDiff(oldRow, body)
          }
        }
      }

      if (method === 'DELETE' && /^\/api\/hr\/departments\/[^/]+$/.test(path)) {
        const codeEnc = path.slice('/api/hr/departments/'.length)
        const code = decodeURIComponent(codeEnc).trim()
        if (code) {
          const row = await fetchDeptSnapshotForAudit(pool, code)
          if (row) {
            req.__auditDeleteDept = {
              name: String(row.name ?? ''),
              code: String(row.code ?? ''),
            }
          }
        }
      }

      if (method === 'PUT' && path === '/api/hr/departments') {
        const body = req.body ?? {}
        const code = String(body.code ?? '').trim()
        if (code) {
          const oldRow = await fetchDeptSnapshotForAudit(pool, code)
          if (oldRow) {
            req.__auditPutDeptDiff = buildPutDepartmentChineseDiff(oldRow, body)
          }
        }
      }

      if (method === 'PUT' && (path === '/api/hr/departments/audit' || path === '/api/hr/departments/unaudit')) {
        const code = String(req.body?.code ?? '').trim()
        if (code) {
          const row = await fetchDeptSnapshotForAudit(pool, code)
          if (row) {
            req.__auditDeptCodeName = {
              code: String(row.code ?? ''),
              name: String(row.name ?? ''),
            }
          }
        }
      }

      if (method === 'PUT' && path === '/api/hr/departments/audit-batch') {
        const codesRaw = req.body?.codes
        const codes = Array.isArray(codesRaw)
          ? [...new Set(codesRaw.map((c) => String(c ?? '').trim()).filter(Boolean))]
          : []
        req.__auditDeptBatchCodes = codes
        const labels = []
        for (const c of codes.slice(0, 15)) {
          const row = await fetchDeptSnapshotForAudit(pool, c)
          if (row && meaningfulStr(row.name)) {
            labels.push(`${String(row.name).trim()}[${c}]`)
          } else {
            labels.push(`[${c}]`)
          }
        }
        req.__auditDeptBatchLabels = labels.join('、')
      }
    } catch (err) {
      console.warn('[操作审计准备] 读库失败（将回退为 JSON 快照）：', err?.message ?? err)
    }

    next()
  }
}

/**
 * 外协订单写接口已在业务事务内写 UB_Date_ERP_Operation_log，
 * 全局审计不再补第二行。
 * @param {string} method
 * @param {string} path
 */
function isAssistOrderBusinessLoggedWriteRoute(method, path) {
  if (method === 'POST' && path === '/api/assist-order') return true
  if (method === 'PUT' && /^\/api\/assist-order\/\d+$/.test(path)) return true
  if (method === 'POST' && /^\/api\/assist-order\/\d+\/(audit|unaudit|close|unclose|restore)$/.test(path)) {
    return true
  }
  if (method === 'DELETE' && /^\/api\/assist-order\/\d+(\/hard)?$/.test(path)) return true
  return false
}

/**
 * 派工单写接口已在业务代码里写入 UB_Date_ERP_Operation_log。
 * 全局审计跳过，避免同一个按钮产生两行日志。
 * @param {string} method
 * @param {string} path
 */
function isDispatchOrderBusinessLoggedWriteRoute(method, path) {
  if (method === 'POST' && path === '/api/dispatch-order') return true
  if (method === 'PUT' && /^\/api\/dispatch-order\/\d+$/.test(path)) return true
  if (method === 'POST' && /^\/api\/dispatch-order\/\d+\/(audit|unaudit|restore)$/.test(path)) return true
  if (method === 'DELETE' && /^\/api\/dispatch-order\/\d+(\/hard)?$/.test(path)) return true
  return false
}

function isStockInBusinessLoggedWriteRoute(method, path) {
  if (method === 'POST' && path === '/api/stock-in') return true
  if (method === 'PUT' && /^\/api\/stock-in\/\d+$/.test(path)) return true
  if (method === 'POST' && /^\/api\/stock-in\/\d+\/(audit|unaudit|review|unreview|restore)$/.test(path)) return true
  if (method === 'DELETE' && /^\/api\/stock-in\/\d+(\/hard)?$/.test(path)) return true
  return false
}

function isStockOutBusinessLoggedWriteRoute(method, path) {
  if (method === 'POST' && path === '/api/stock-out') return true
  if (method === 'PUT' && /^\/api\/stock-out\/\d+$/.test(path)) return true
  if (method === 'POST' && /^\/api\/stock-out\/\d+\/(audit|unaudit|restore)$/.test(path)) return true
  if (method === 'DELETE' && /^\/api\/stock-out\/\d+(\/hard)?$/.test(path)) return true
  return false
}

/**
 * @param {{
 *   getCurrentUserFromReq: (req: import('express').Request) => any | null,
 *   writeOperationLogAsync: (payload: {
 *     userId?: string|number|null,
 *     userName?: string|null,
 *     action: string,
 *     targetTable: string,
 *     content: string|null,
 *     ipAddress?: string|null,
 *   }) => Promise<void>,
 * }} deps
 */
export function createOperationAuditMiddleware(deps) {
  const { getCurrentUserFromReq, writeOperationLogAsync } = deps

  return function operationAuditMiddleware(req, res, next) {
    const path = String(req.path || '')
    if (!path.startsWith('/api/')) {
      return next()
    }

    res.on('finish', () => {
      try {
        const method = String(req.method || '').toUpperCase()
        if (!['POST', 'PUT', 'DELETE'].includes(method)) return
        if (res.statusCode !== 200) return

        if (path === '/api/login' || path === '/api/health') return
        if (isAssistOrderBusinessLoggedWriteRoute(method, path)) return
        if (isDispatchOrderBusinessLoggedWriteRoute(method, path)) return
        if (isStockInBusinessLoggedWriteRoute(method, path)) return
        if (isStockOutBusinessLoggedWriteRoute(method, path)) return

        const user = getCurrentUserFromReq(req)
        if (!user) return

        const { action, targetTable } = resolveAuditActionAndTable(method, path)

        let content = ''
        if (method === 'POST' && path === '/api/supply-chain/suppliers') {
          const op = operatorDisplayName(user)
          const code = displayCell(req.body?.s_code)
          const name = displayCell(req.body?.s_name)
          content = `${op}录入了供应商，编号为：[${code}]，名称为：[${name}]。`
        } else if (method === 'POST' && path === '/api/supply-chain/customers') {
          const op = operatorDisplayName(user)
          const code = displayCell(req.body?.s_code)
          const name = displayCell(req.body?.s_name)
          content = `${op}录入了销售客户，编号为：[${code}]，名称为：[${name}]。`
        } else if (method === 'POST' && path === '/api/supply-chain/settlement-methods') {
          const op = operatorDisplayName(user)
          const code = displayCell(req.body?.code)
          const name = displayCell(req.body?.name)
          const payfor = displayCell(req.body?.payfor)
          content = `${op}新增了结算方式「${name}」（编码：${code}，天数：${payfor}）`
        } else if (
          method === 'DELETE' &&
          /^\/api\/supply-chain\/customers\/\d+\/permanent$/.test(path) &&
          req.__auditSalesCustomerSnapshot
        ) {
          const op = operatorDisplayName(user)
          const s = req.__auditSalesCustomerSnapshot
          content = `${op}彻底删除了销售客户「${displayCell(s.s_name)}」（编码：${displayCell(s.s_code)}）`
        } else if (method === 'DELETE' && /^\/api\/supply-chain\/suppliers\/\d+\/permanent$/.test(path) && req.__auditSupplierSnapshot) {
          const op = operatorDisplayName(user)
          const s = req.__auditSupplierSnapshot
          content = `${op}彻底删除了供应商「${displayCell(s.s_name)}」（编码：${displayCell(s.s_code)}）`
        } else if (
          method === 'DELETE' &&
          /^\/api\/supply-chain\/settlement-methods\/\d+\/permanent$/.test(path) &&
          req.__auditSettlementMethodSnapshot
        ) {
          const op = operatorDisplayName(user)
          const s = req.__auditSettlementMethodSnapshot
          content = `${op}彻底删除了结算方式「${displayCell(s.name)}」（编码：${displayCell(s.code)}）`
        } else if (method === 'PUT' && path === '/api/supply-chain/customers' && req.__auditSalesCustomerSnapshot) {
          const op = operatorDisplayName(user)
          const s = req.__auditSalesCustomerSnapshot
          const diff = String(req.__auditPutSalesCustomerDiff ?? '').trim()
          content = diff
            ? `${op}修改了销售客户，编号为：[${displayCell(s.s_code)}]，名称为：[${displayCell(s.s_name)}]。关键改动：${diff}`
            : `${op}修改了销售客户，编号为：[${displayCell(s.s_code)}]，名称为：[${displayCell(s.s_name)}]。`
        } else if (method === 'PUT' && path === '/api/supply-chain/suppliers' && req.__auditSupplierSnapshot) {
          const op = operatorDisplayName(user)
          const s = req.__auditSupplierSnapshot
          const diff = String(req.__auditPutSupplierDiff ?? '').trim()
          content = diff
            ? `${op}修改了供应商，编号为：[${displayCell(s.s_code)}]，名称为：[${displayCell(s.s_name)}]。关键改动：${diff}`
            : `${op}修改了供应商，编号为：[${displayCell(s.s_code)}]，名称为：[${displayCell(s.s_name)}]。`
        } else if (method === 'PUT' && path === '/api/supply-chain/settlement-methods' && req.__auditSettlementMethodSnapshot) {
          const op = operatorDisplayName(user)
          const s = req.__auditSettlementMethodSnapshot
          const diff = String(req.__auditPutSettlementMethodDiff ?? '').trim()
          content = diff
            ? `${op}修改了结算方式[${displayCell(s.code)}]：${diff}`
            : `${op}修改了结算方式[${displayCell(s.code)}]`
        } else if (method === 'PUT' && path === '/api/supply-chain/customers/audit' && req.__auditSalesCustomerSnapshot) {
          const op = operatorDisplayName(user)
          const s = req.__auditSalesCustomerSnapshot
          content = `${op}审核了销售客户「${displayCell(s.s_name)}」（编码：${displayCell(s.s_code)}）`
        } else if (method === 'PUT' && path === '/api/supply-chain/suppliers/audit' && req.__auditSupplierSnapshot) {
          const op = operatorDisplayName(user)
          const s = req.__auditSupplierSnapshot
          content = `${op}审核了供应商「${displayCell(s.s_name)}」（编码：${displayCell(s.s_code)}）`
        } else if (
          method === 'PUT' &&
          path === '/api/supply-chain/settlement-methods/audit' &&
          req.__auditSettlementMethodSnapshot
        ) {
          const op = operatorDisplayName(user)
          const s = req.__auditSettlementMethodSnapshot
          content = `${op}审核了结算方式「${displayCell(s.name)}」（编码：${displayCell(s.code)}）`
        } else if (method === 'PUT' && path === '/api/supply-chain/customers/unaudit' && req.__auditSalesCustomerSnapshot) {
          const op = operatorDisplayName(user)
          const s = req.__auditSalesCustomerSnapshot
          content = `${op}反审了销售客户「${displayCell(s.s_name)}」（编码：${displayCell(s.s_code)}）`
        } else if (method === 'PUT' && path === '/api/supply-chain/suppliers/unaudit' && req.__auditSupplierSnapshot) {
          const op = operatorDisplayName(user)
          const s = req.__auditSupplierSnapshot
          content = `${op}反审了供应商「${displayCell(s.s_name)}」（编码：${displayCell(s.s_code)}）`
        } else if (
          method === 'PUT' &&
          path === '/api/supply-chain/settlement-methods/unaudit' &&
          req.__auditSettlementMethodSnapshot
        ) {
          const op = operatorDisplayName(user)
          const s = req.__auditSettlementMethodSnapshot
          content = `${op}反审了结算方式「${displayCell(s.name)}」（编码：${displayCell(s.code)}）`
        } else if (method === 'PUT' && path === '/api/supply-chain/customers/restore' && req.__auditSalesCustomerSnapshot) {
          const op = operatorDisplayName(user)
          const s = req.__auditSalesCustomerSnapshot
          content = `${op}恢复了销售客户「${displayCell(s.s_name)}」（编码：${displayCell(s.s_code)}）`
        } else if (method === 'PUT' && path === '/api/supply-chain/suppliers/restore' && req.__auditSupplierSnapshot) {
          const op = operatorDisplayName(user)
          const s = req.__auditSupplierSnapshot
          content = `${op}恢复了供应商「${displayCell(s.s_name)}」（编码：${displayCell(s.s_code)}）`
        } else if (
          method === 'PUT' &&
          path === '/api/supply-chain/settlement-methods/restore' &&
          req.__auditSettlementMethodSnapshot
        ) {
          const op = operatorDisplayName(user)
          const s = req.__auditSettlementMethodSnapshot
          content = `${op}恢复了结算方式「${displayCell(s.name)}」（编码：${displayCell(s.code)}）`
        } else if (method === 'DELETE' && /^\/api\/supply-chain\/customers\/\d+$/.test(path) && req.__auditSalesCustomerSnapshot) {
          const op = operatorDisplayName(user)
          const s = req.__auditSalesCustomerSnapshot
          content = `${op}删除了销售客户「${displayCell(s.s_name)}」（编码：${displayCell(s.s_code)}，已移入回收站）`
        } else if (method === 'DELETE' && /^\/api\/supply-chain\/suppliers\/\d+$/.test(path) && req.__auditSupplierSnapshot) {
          const op = operatorDisplayName(user)
          const s = req.__auditSupplierSnapshot
          content = `${op}删除了供应商「${displayCell(s.s_name)}」（编码：${displayCell(s.s_code)}，已移入回收站）`
        } else if (
          method === 'DELETE' &&
          /^\/api\/supply-chain\/settlement-methods\/\d+$/.test(path) &&
          req.__auditSettlementMethodSnapshot
        ) {
          const op = operatorDisplayName(user)
          const s = req.__auditSettlementMethodSnapshot
          content = `${op}删除了结算方式「${displayCell(s.name)}」（编码：${displayCell(s.code)}，已移入回收站）`
        } else if (method === 'POST' && path === '/api/supply-chain/purchase-quotations') {
          const op = operatorDisplayName(user)
          const hid = req.body?.header && typeof req.body.header === 'object' ? req.body.header : {}
          const label =
            displayCell(
              hid.cgaa01 ??
                hid.systemcode ??
                hid.code ??
                hid.quotation_code ??
                hid.dh ??
                hid.djbh ??
                hid.bill_no,
            ) || '（空）'
          const sup = displayCell(hid.kehu) || '（空）'
          const lineN = Array.isArray(req.body?.lines) ? req.body.lines.length : 0
          content = `${op}录入了采购报价单，单号：[${label}]，供应商：[${sup}]；录入了采购报价单明细，共 ${lineN} 项物料。`
        } else if (
          method === 'PUT' &&
          path === '/api/supply-chain/purchase-quotations' &&
          req.__auditPurchaseQuotationSnapshot
        ) {
          const op = operatorDisplayName(user)
          const s = req.__auditPurchaseQuotationSnapshot
          const diff = String(req.__auditPutPurchaseQuotationDiff ?? '').trim()
          const label =
            displayCell(s.cgaa01 || s.systemcode || s.code || s.quotation_code || s.dh || s.djbh) ||
            `ID:${s.id}`
          const lineN = Array.isArray(req.body?.lines) ? req.body.lines.length : 0
          content = diff
            ? `${op}保存了采购报价「${label}」。${diff} 明细共 ${lineN} 项物料。`
            : `${op}保存了采购报价「${label}」（已重写明细），明细共 ${lineN} 项物料。`
        } else if (
          method === 'PUT' &&
          path === '/api/supply-chain/purchase-quotations/audit' &&
          req.__auditPurchaseQuotationSnapshot
        ) {
          const op = operatorDisplayName(user)
          const s = req.__auditPurchaseQuotationSnapshot
          const label =
            displayCell(s.cgaa01 || s.systemcode || s.code || s.quotation_code || s.dh || s.djbh) ||
            `ID:${s.id}`
          content = `${op}审核了采购报价「${label}」`
        } else if (
          method === 'PUT' &&
          path === '/api/supply-chain/purchase-quotations/unaudit' &&
          req.__auditPurchaseQuotationSnapshot
        ) {
          const op = operatorDisplayName(user)
          const s = req.__auditPurchaseQuotationSnapshot
          const label =
            displayCell(s.cgaa01 || s.systemcode || s.code || s.quotation_code || s.dh || s.djbh) ||
            `ID:${s.id}`
          content = `${op}反审了采购报价「${label}」`
        } else if (
          method === 'PUT' &&
          path === '/api/supply-chain/purchase-quotations/restore' &&
          req.__auditPurchaseQuotationSnapshot
        ) {
          const op = operatorDisplayName(user)
          const s = req.__auditPurchaseQuotationSnapshot
          const label =
            displayCell(s.cgaa01 || s.systemcode || s.code || s.quotation_code || s.dh || s.djbh) ||
            `ID:${s.id}`
          content = `${op}恢复了采购报价「${label}」（从回收站回到在册）`
        } else if (
          method === 'DELETE' &&
          /^\/api\/supply-chain\/purchase-quotations\/[^/]+\/permanent$/.test(path) &&
          req.__auditPurchaseQuotationSnapshot
        ) {
          const op = operatorDisplayName(user)
          const s = req.__auditPurchaseQuotationSnapshot
          const label =
            displayCell(s.cgaa01 || s.systemcode || s.code || s.quotation_code || s.dh || s.djbh) ||
            `ID:${s.id}`
          content = `${op}彻底删除了采购报价「${label}」（不可恢复）`
        } else if (
          method === 'DELETE' &&
          /^\/api\/supply-chain\/purchase-quotations\/[^/]+$/.test(path) &&
          req.__auditPurchaseQuotationSnapshot
        ) {
          const op = operatorDisplayName(user)
          const s = req.__auditPurchaseQuotationSnapshot
          const label =
            displayCell(s.cgaa01 || s.systemcode || s.code || s.quotation_code || s.dh || s.djbh) ||
            `ID:${s.id}`
          content = `${op}删除了采购报价「${label}」（已移入回收站）`
        } else if (method === 'POST' && path === '/api/supply-chain/outsourcing-quotations') {
          const op = operatorDisplayName(user)
          const hid = req.body?.header && typeof req.body.header === 'object' ? req.body.header : {}
          const label =
            displayCell(
              hid.wxaa01 ??
                hid.systemcode ??
                hid.code ??
                hid.quotation_code ??
                hid.dh ??
                hid.djbh ??
                hid.bill_no,
            ) || '（空）'
          const sup = displayCell(hid.kehu) || '（空）'
          const lineN = Array.isArray(req.body?.lines) ? req.body.lines.length : 0
          content = `${op}录入了外协报价单，单号：[${label}]，外协商：[${sup}]；录入了外协报价单明细，共 ${lineN} 项物料。`
        } else if (
          method === 'PUT' &&
          path === '/api/supply-chain/outsourcing-quotations' &&
          req.__auditOutsourcingQuotationSnapshot
        ) {
          const op = operatorDisplayName(user)
          const s = req.__auditOutsourcingQuotationSnapshot
          const diff = String(req.__auditPutOutsourcingQuotationDiff ?? '').trim()
          const label =
            displayCell(s.wxaa01 || s.systemcode || s.code || s.quotation_code || s.dh || s.djbh) ||
            `ID:${s.id}`
          const lineN = Array.isArray(req.body?.lines) ? req.body.lines.length : 0
          content = diff
            ? `${op}保存了外协报价「${label}」。${diff} 明细共 ${lineN} 项物料。`
            : `${op}保存了外协报价「${label}」（已重写明细），明细共 ${lineN} 项物料。`
        } else if (
          method === 'PUT' &&
          path === '/api/supply-chain/outsourcing-quotations/audit' &&
          req.__auditOutsourcingQuotationSnapshot
        ) {
          const op = operatorDisplayName(user)
          const s = req.__auditOutsourcingQuotationSnapshot
          const label =
            displayCell(s.wxaa01 || s.systemcode || s.code || s.quotation_code || s.dh || s.djbh) ||
            `ID:${s.id}`
          content = `${op}审核了外协报价「${label}」`
        } else if (
          method === 'PUT' &&
          path === '/api/supply-chain/outsourcing-quotations/unaudit' &&
          req.__auditOutsourcingQuotationSnapshot
        ) {
          const op = operatorDisplayName(user)
          const s = req.__auditOutsourcingQuotationSnapshot
          const label =
            displayCell(s.wxaa01 || s.systemcode || s.code || s.quotation_code || s.dh || s.djbh) ||
            `ID:${s.id}`
          content = `${op}反审了外协报价「${label}」`
        } else if (
          method === 'PUT' &&
          path === '/api/supply-chain/outsourcing-quotations/restore' &&
          req.__auditOutsourcingQuotationSnapshot
        ) {
          const op = operatorDisplayName(user)
          const s = req.__auditOutsourcingQuotationSnapshot
          const label =
            displayCell(s.wxaa01 || s.systemcode || s.code || s.quotation_code || s.dh || s.djbh) ||
            `ID:${s.id}`
          content = `${op}恢复了外协报价「${label}」（从回收站回到在册）`
        } else if (
          method === 'DELETE' &&
          /^\/api\/supply-chain\/outsourcing-quotations\/[^/]+\/permanent$/.test(path) &&
          req.__auditOutsourcingQuotationSnapshot
        ) {
          const op = operatorDisplayName(user)
          const s = req.__auditOutsourcingQuotationSnapshot
          const label =
            displayCell(s.wxaa01 || s.systemcode || s.code || s.quotation_code || s.dh || s.djbh) ||
            `ID:${s.id}`
          content = `${op}彻底删除了外协报价「${label}」（不可恢复）`
        } else if (
          method === 'DELETE' &&
          /^\/api\/supply-chain\/outsourcing-quotations\/[^/]+$/.test(path) &&
          req.__auditOutsourcingQuotationSnapshot
        ) {
          const op = operatorDisplayName(user)
          const s = req.__auditOutsourcingQuotationSnapshot
          const label =
            displayCell(s.wxaa01 || s.systemcode || s.code || s.quotation_code || s.dh || s.djbh) ||
            `ID:${s.id}`
          content = `${op}删除了外协报价「${label}」（已移入回收站）`
        } else if (method === 'DELETE' && /^\/api\/inventory\/color-code\/.+\/permanent$/.test(path) && req.__auditDeleteColorCode) {
          const op = operatorDisplayName(user)
          const { code, name } = req.__auditDeleteColorCode
          content = `${op}彻底删除了颜色编码「${displayCell(name)}」（编码：${displayCell(code)}）`
        } else if (method === 'DELETE' && /^\/api\/inventory\/color-code\/.+$/.test(path) && req.__auditDeleteColorCode) {
          const op = operatorDisplayName(user)
          const { code, name } = req.__auditDeleteColorCode
          content = `${op}删除了颜色编码「${displayCell(name)}」（编码：${displayCell(code)}，已移入回收站）`
        } else if (method === 'PUT' && path === '/api/inventory/color-code/audit' && req.__auditColorCodeCodeName) {
          const op = operatorDisplayName(user)
          const { code, name } = req.__auditColorCodeCodeName
          content = `${op}审核了颜色编码「${displayCell(name)}」（编码：${displayCell(code)}）`
        } else if (method === 'PUT' && path === '/api/inventory/color-code/unaudit' && req.__auditColorCodeCodeName) {
          const op = operatorDisplayName(user)
          const { code, name } = req.__auditColorCodeCodeName
          content = `${op}反审了颜色编码「${displayCell(name)}」（编码：${displayCell(code)}）`
        } else if (method === 'PUT' && path === '/api/inventory/color-code/restore' && req.__auditColorCodeCodeName) {
          const op = operatorDisplayName(user)
          const { code, name } = req.__auditColorCodeCodeName
          content = `${op}恢复了颜色编码「${displayCell(name)}」（编码：${displayCell(code)}）`
        } else if (method === 'POST' && path === '/api/inventory/color-code') {
          const op = operatorDisplayName(user)
          const code = displayCell(req.body?.code)
          const name = displayCell(req.body?.name)
          content = `${op}新增了颜色编码「${name}」（编码：${code}）`
        } else if (method === 'POST' && path === '/api/roles') {
          // 角色管理：按你要求的固定中文模板（备注为空则不显示）
          const roleName = meaningfulStr(req.body?.RoleName) ?? ''
          const desc = meaningfulStr(req.body?.Description)
          content = `新增角色成功！角色名称："${roleName}"`
          if (desc) content += `，备注："${desc}"`
        } else if (method === 'PUT' && path === '/api/roles/permissions') {
          const snap = req.__auditRoleSnapshot
          const roleName = meaningfulStr(snap?.RoleName) ?? meaningfulStr(req.body?.RoleName) ?? ''
          content = `修改角色权限成功！角色名称："${roleName}"`
        } else if (method === 'PUT' && path === '/api/roles/resume') {
          const snap = req.__auditRoleSnapshot
          const roleName = meaningfulStr(snap?.RoleName) ?? ''
          content = `恢复角色成功！角色名称："${roleName}"`
        } else if (method === 'PUT' && path === '/api/roles') {
          const body = req.body ?? {}
          const hasDisableFlag = body.pass !== undefined || body.Status !== undefined
          if (hasDisableFlag) {
            const snap = req.__auditRoleSnapshot
            const roleName = meaningfulStr(snap?.RoleName) ?? ''
            content = `禁用角色成功！角色名称："${roleName}"`
          } else {
            const roleName = meaningfulStr(body.RoleName) ?? ''
            const desc = meaningfulStr(body.Description)
            content = `修改角色成功！角色名称："${roleName}"`
            if (desc) content += `，备注："${desc}"`
          }
        } else if (method === 'PUT' && path === '/api/inventory/color-code') {
          const op = operatorDisplayName(user)
          const code = displayCell(req.body?.code)
          const diff = String(req.__auditPutColorCodeDiff ?? '').trim()
          content = diff ? `${op}修改了颜色编码[${code}]：${diff}` : `${op}修改了颜色编码[${code}]`
        } else if (method === 'DELETE' && /^\/api\/roles\/\d+$/.test(path) && req.__auditRoleSnapshot) {
          const snap = req.__auditRoleSnapshot
          const roleName = meaningfulStr(snap?.RoleName) ?? ''
          content = `删除角色成功！角色名称："${roleName}"`
        } else if (method === 'DELETE' && /^\/api\/inventory\/units\/\d+\/permanent$/.test(path) && req.__auditDeleteUnit) {
          const op = operatorDisplayName(user)
          const { id, name } = req.__auditDeleteUnit
          content = `${op}彻底删除了使用单位「${displayCell(name)}」（ID：${displayCell(id)}）`
        } else if (method === 'DELETE' && /^\/api\/inventory\/units\/\d+$/.test(path) && req.__auditDeleteUnit) {
          const op = operatorDisplayName(user)
          const { id, name } = req.__auditDeleteUnit
          content = `${op}删除了使用单位「${displayCell(name)}」（ID：${displayCell(id)}，已移入回收站）`
        } else if (method === 'PUT' && path === '/api/inventory/units/audit' && req.__auditUnitIdName) {
          const op = operatorDisplayName(user)
          const { id, name } = req.__auditUnitIdName
          content = `${op}审核了使用单位「${displayCell(name)}」（ID：${displayCell(id)}）`
        } else if (method === 'PUT' && path === '/api/inventory/units/unaudit' && req.__auditUnitIdName) {
          const op = operatorDisplayName(user)
          const { id, name } = req.__auditUnitIdName
          content = `${op}反审了使用单位「${displayCell(name)}」（ID：${displayCell(id)}）`
        } else if (method === 'PUT' && path === '/api/inventory/units/restore' && req.__auditUnitIdName) {
          const op = operatorDisplayName(user)
          const { id, name } = req.__auditUnitIdName
          content = `${op}恢复了使用单位「${displayCell(name)}」（ID：${displayCell(id)}）`
        } else if (method === 'POST' && path === '/api/inventory/unit-conversion') {
          const op = operatorDisplayName(user)
          const unitName = displayCell(req.body?.unit_name)
          const unitNameTow = displayCell(req.body?.unit_name_tow)
          const changeBl = displayCell(req.body?.change_bl)
          content = `${op}新增了单位转换率：${unitName}→${unitNameTow}（转换率：${changeBl}）`
        } else if (method === 'PUT' && path === '/api/inventory/unit-conversion/audit' && req.__auditUnitChangeSnapshot) {
          const op = operatorDisplayName(user)
          const s = req.__auditUnitChangeSnapshot
          content = `${op}审核了单位转换率[ID：${displayCell(s.id)}]：${displayCell(s.unit_name)}→${displayCell(s.unit_name_tow)}（转换率：${displayCell(s.change_bl)}）`
        } else if (method === 'PUT' && path === '/api/inventory/unit-conversion/unaudit' && req.__auditUnitChangeSnapshot) {
          const op = operatorDisplayName(user)
          const s = req.__auditUnitChangeSnapshot
          content = `${op}反审了单位转换率[ID：${displayCell(s.id)}]：${displayCell(s.unit_name)}→${displayCell(s.unit_name_tow)}（转换率：${displayCell(s.change_bl)}）`
        } else if (method === 'PUT' && path === '/api/inventory/unit-conversion/restore' && req.__auditUnitChangeSnapshot) {
          const op = operatorDisplayName(user)
          const s = req.__auditUnitChangeSnapshot
          content = `${op}恢复了单位转换率[ID：${displayCell(s.id)}]：${displayCell(s.unit_name)}→${displayCell(s.unit_name_tow)}（转换率：${displayCell(s.change_bl)}）`
        } else if (method === 'DELETE' && /^\/api\/inventory\/unit-conversion\/\d+\/permanent$/.test(path) && req.__auditDeleteUnitChange) {
          const op = operatorDisplayName(user)
          const s = req.__auditDeleteUnitChange
          content = `${op}彻底删除了单位转换率[ID：${displayCell(s.id)}]：${displayCell(s.unit_name)}→${displayCell(s.unit_name_tow)}（转换率：${displayCell(s.change_bl)}）`
        } else if (method === 'DELETE' && /^\/api\/inventory\/unit-conversion\/\d+$/.test(path) && req.__auditDeleteUnitChange) {
          const op = operatorDisplayName(user)
          const s = req.__auditDeleteUnitChange
          content = `${op}删除了单位转换率[ID：${displayCell(s.id)}]：${displayCell(s.unit_name)}→${displayCell(s.unit_name_tow)}（转换率：${displayCell(s.change_bl)}，已移入回收站）`
        } else if (method === 'POST' && path === '/api/inventory/material-category') {
          const op = operatorDisplayName(user)
          const code = displayCell(req.body?.code)
          const name = displayCell(req.body?.name)
          content = `${op}新增了材料分类「${name}」（编码：${code}）`
        } else if (method === 'PUT' && path === '/api/inventory/material-category/audit' && req.__auditMaterialSnapshot) {
          const op = operatorDisplayName(user)
          const s = req.__auditMaterialSnapshot
          content = `${op}审核了材料分类「${displayCell(s.name)}」（编码：${displayCell(s.code)}，ID：${displayCell(s.id)}）`
        } else if (method === 'PUT' && path === '/api/inventory/material-category/unaudit' && req.__auditMaterialSnapshot) {
          const op = operatorDisplayName(user)
          const s = req.__auditMaterialSnapshot
          content = `${op}反审了材料分类「${displayCell(s.name)}」（编码：${displayCell(s.code)}，ID：${displayCell(s.id)}）`
        } else if (method === 'PUT' && path === '/api/inventory/material-category/restore' && req.__auditMaterialSnapshot) {
          const op = operatorDisplayName(user)
          const s = req.__auditMaterialSnapshot
          content = `${op}恢复了材料分类「${displayCell(s.name)}」（编码：${displayCell(s.code)}，ID：${displayCell(s.id)}）`
        } else if (method === 'DELETE' && /^\/api\/inventory\/material-category\/\d+\/permanent$/.test(path) && req.__auditDeleteMaterial) {
          const op = operatorDisplayName(user)
          const s = req.__auditDeleteMaterial
          content = `${op}彻底删除了材料分类「${displayCell(s.name)}」（编码：${displayCell(s.code)}，ID：${displayCell(s.id)}）`
        } else if (method === 'DELETE' && /^\/api\/inventory\/material-category\/\d+$/.test(path) && req.__auditDeleteMaterial) {
          const op = operatorDisplayName(user)
          const s = req.__auditDeleteMaterial
          content = `${op}删除了材料分类「${displayCell(s.name)}」（编码：${displayCell(s.code)}，ID：${displayCell(s.id)}，已移入回收站）`
        } else if (method === 'POST' && path === '/api/inventory/workshop-dept') {
          // 规则 16：新增日志模板（强制中文可读）
          const code = displayCell(req.body?.code)
          const name = displayCell(req.body?.name)
          content = `录入成功,等待审核！车间与部门编码：${code}，车间/部门名称：${name}`
        } else if (method === 'PUT' && path === '/api/inventory/workshop-dept/audit' && req.__auditStocksWorkshopSnapshot) {
          const s = req.__auditStocksWorkshopSnapshot
          content = `申请通过审核！车间与部门编码：${displayCell(s.code)}，车间/部门名称：${displayCell(s.name)}`
        } else if (method === 'PUT' && path === '/api/inventory/workshop-dept/unaudit' && req.__auditStocksWorkshopSnapshot) {
          const s = req.__auditStocksWorkshopSnapshot
          content = `反审核操作！车间与部门编码：${displayCell(s.code)}，车间/部门名称：${displayCell(s.name)}`
        } else if (method === 'PUT' && path === '/api/inventory/workshop-dept/restore' && req.__auditStocksWorkshopSnapshot) {
          const s = req.__auditStocksWorkshopSnapshot
          content = `恢复操作！车间与部门编码：${displayCell(s.code)}，车间/部门名称：${displayCell(s.name)}`
        } else if (method === 'DELETE' && /^\/api\/inventory\/workshop-dept\/\d+\/permanent$/.test(path) && req.__auditDeleteStocksWorkshop) {
          const s = req.__auditDeleteStocksWorkshop
          content = `彻底删除操作！车间与部门编码：${displayCell(s.code)}，车间/部门名称：${displayCell(s.name)}`
        } else if (method === 'DELETE' && /^\/api\/inventory\/workshop-dept\/\d+$/.test(path) && req.__auditDeleteStocksWorkshop) {
          const s = req.__auditDeleteStocksWorkshop
          content = `编码删除！车间与部门编码：${displayCell(s.code)}，车间/部门名称：${displayCell(s.name)}`
        } else if (method === 'POST' && path === '/api/inventory/units') {
          const op = operatorDisplayName(user)
          const name = displayCell(req.body?.name)
          content = `${op}新增了使用单位「${name}」`
        } else if (method === 'DELETE' && /^\/api\/hr\/staff\/.+/.test(path) && req.__auditDeleteStaff) {
          const { name, code } = req.__auditDeleteStaff
          const op = operatorDisplayName(user)
          content = `${op}删除了员工档案：姓名[${displayCell(name)}]，工号[${displayCell(code)}]`
        } else if (method === 'PUT' && path === '/api/hr/staff' && req.__auditPutStaffDiff) {
          const op = operatorDisplayName(user)
          content = `${op}修改了员工档案：${String(req.__auditPutStaffDiff).trim()}`
        } else if (method === 'PUT' && /^\/api\/hr\/staff\/leave\/.+/.test(path) && String(req.__auditLeaveContent ?? '').trim()) {
          // v1.1.1：员工离职专用语义化日志（由路由写入 req.__auditLeaveContent）
          content = String(req.__auditLeaveContent).trim()
        } else if (method === 'POST' && path === '/api/hr/staff') {
          content = buildPostStaffChineseSummary(user, req.body ?? {})
        } else if (method === 'POST' && path === '/api/hr/departments') {
          content = buildPostDepartmentChineseContent(user, req.body ?? {})
        } else if (method === 'PUT' && path === '/api/hr/departments' && req.__auditPutDeptDiff) {
          const op = operatorDisplayName(user)
          content = `${op}修改了部门/岗位资料：${String(req.__auditPutDeptDiff).trim()}`
        } else if (method === 'PUT' && path === '/api/hr/departments/audit' && req.__auditDeptCodeName) {
          const op = operatorDisplayName(user)
          const { name, code } = req.__auditDeptCodeName
          content = `${op}审核了部门/岗位「${displayCell(name)}」（编码：${displayCell(code)}）`
        } else if (method === 'PUT' && path === '/api/hr/departments/unaudit' && req.__auditDeptCodeName) {
          const op = operatorDisplayName(user)
          const { name, code } = req.__auditDeptCodeName
          content = `${op}反审了部门/岗位「${displayCell(name)}」（编码：${displayCell(code)}）`
        } else if (method === 'POST' && path === '/api/hr/dormitory/check-in' && String(req.__auditDormCheckInContent ?? '').trim()) {
          // 宿舍：办理入住专用可读日志（由路由写入 req.__auditDormCheckInContent）
          content = String(req.__auditDormCheckInContent).trim()
        } else if (method === 'PUT' && path === '/api/hr/dormitory/room-in/room-info' && String(req.__auditDormRoomInfoContent ?? '').trim()) {
          // 宿舍：入住管理-备注编辑
          content = String(req.__auditDormRoomInfoContent).trim()
        } else if (method === 'PUT' && path === '/api/hr/dormitory/check-out' && String(req.__auditDormCheckOutContent ?? '').trim()) {
          // 宿舍：办理退宿专用可读日志
          content = String(req.__auditDormCheckOutContent).trim()
        } else if (method === 'PUT' && path === '/api/hr/dormitory/lodging-in/audit' && String(req.__auditDormLodgingInAuditContent ?? '').trim()) {
          content = String(req.__auditDormLodgingInAuditContent).trim()
        } else if (method === 'PUT' && path === '/api/hr/dormitory/lodging-in/reject' && String(req.__auditDormLodgingInRejectContent ?? '').trim()) {
          content = String(req.__auditDormLodgingInRejectContent).trim()
        } else if (method === 'PUT' && path === '/api/dorm/un-audit' && String(req.__auditDormUnAuditContent ?? '').trim()) {
          content = String(req.__auditDormUnAuditContent).trim()
        } else if (method === 'DELETE' && path === '/api/dorm/delete-checkin' && String(req.__auditDormDeleteCheckinContent ?? '').trim()) {
          content = String(req.__auditDormDeleteCheckinContent).trim()
        } else if (method === 'PUT' && path === '/api/hr/departments/audit-batch') {
          const op = operatorDisplayName(user)
          const n = Array.isArray(req.__auditDeptBatchCodes) ? req.__auditDeptBatchCodes.length : 0
          const labels = String(req.__auditDeptBatchLabels ?? '').trim()
          content = labels
            ? `${op}批量审核部门/岗位，共 ${n} 条：${labels}${n > 15 ? '…' : ''}`
            : `${op}批量审核部门/岗位，共 ${n} 条`
        } else if (method === 'DELETE' && /^\/api\/hr\/departments\/.+/.test(path) && req.__auditDeleteDept) {
          const op = operatorDisplayName(user)
          const { name, code } = req.__auditDeleteDept
          content = `${op}删除了部门/岗位「${displayCell(name)}」（编码：${displayCell(code)}）`
        } else {
          const snap = redactBodyForOperationAudit(req.body)
          try {
            content = JSON.stringify(snap)
          } catch {
            content = String(snap)
          }
        }

        if (content.length > MAX_CONTENT_LEN) {
          content = `${content.slice(0, MAX_CONTENT_LEN - 30)}…(已截断，共超${MAX_CONTENT_LEN}字符)`
        }

        void (async () => {
          try {
            await writeOperationLogAsync({
              uname: String(user.userCode ?? '').trim() || null,
              utruename:
                String(user.userName ?? '').trim() ||
                String(user.auditTruename ?? '').trim() ||
                String(user.userCode ?? '').trim() ||
                null,
              action,
              code: targetTable || 'ERP',
              systemcode: '',
              content,
              ip: getRequestIp(req) || null,
            })
          } catch (err) {
            console.error('[操作审计中间件] 写入 UB_Date_ERP_Operation_log 失败：', err?.message ?? err)
          }
        })()
      } catch (err) {
        console.error('[操作审计中间件] finish 回调异常：', err?.message ?? err)
      }
    })

    next()
  }
}
