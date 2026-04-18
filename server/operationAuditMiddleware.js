/**
 * v1.1.1+：全局操作审计中间件
 * - 准备阶段：DELETE/PUT 员工前读库，生成可读中文详情（挂到 req 上）
 * - 完成阶段：POST/PUT/DELETE 且 HTTP 200 后异步写入 Sys_OperationLogs
 */
import { getPool, sql } from './db.js'
import { resolveAuditActionAndTable } from './action_map.js'

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
  const t = String(process.env.HR_STAFF_TABLE ?? 'Hr_staff').trim()
  if (!/^[A-Za-z0-9_]+$/.test(t)) return 'Hr_staff'
  return t
})()
const HR_STAFF_FROM = `dbo.[${HR_STAFF_TABLE}]`

/** 与 server/index.js 一致：部门/岗位旧表 */
const HR_LEGACY_DEPT_TABLE = (() => {
  const t = String(process.env.HR_LEGACY_DEPT_TABLE ?? 'HR_Departments').trim()
  if (!/^[A-Za-z0-9_]+$/.test(t)) return 'HR_Departments'
  return t
})()
const HR_LEGACY_DEPT_FROM = `dbo.[${HR_LEGACY_DEPT_TABLE}]`

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
 * 当前登录人展示名（用于详情句首「操作人某某」）
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
  if (!name) return `操作人${op}提交了新增部门/岗位请求（名称为空，异常请求）`
  const parentId = meaningfulStr(body.ParentID)
  const remark = meaningfulStr(body.remark)
  const isPost = parentId != null
  let s = isPost
    ? `操作人${op}新增了岗位「${name}」，所属部门编码[${parentId}]`
    : `操作人${op}新增了部门「${name}」`
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
  const bits = [`操作人${op}新增了员工档案，姓名[${name}]，卡号[${card}]`]
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

        const user = getCurrentUserFromReq(req)
        if (!user) return

        const { action, targetTable } = resolveAuditActionAndTable(method, path)

        let content = ''
        if (method === 'DELETE' && /^\/api\/hr\/staff\/.+/.test(path) && req.__auditDeleteStaff) {
          const { name, code } = req.__auditDeleteStaff
          const op = operatorDisplayName(user)
          content = `操作人${op}删除了员工档案：姓名[${displayCell(name)}]，工号[${displayCell(code)}]`
        } else if (method === 'PUT' && path === '/api/hr/staff' && req.__auditPutStaffDiff) {
          const op = operatorDisplayName(user)
          content = `操作人${op}修改了员工档案：${String(req.__auditPutStaffDiff).trim()}`
        } else if (method === 'PUT' && /^\/api\/hr\/staff\/leave\/.+/.test(path) && String(req.__auditLeaveContent ?? '').trim()) {
          // v1.1.1：员工离职专用语义化日志（由路由写入 req.__auditLeaveContent）
          content = String(req.__auditLeaveContent).trim()
        } else if (method === 'POST' && path === '/api/hr/staff') {
          content = buildPostStaffChineseSummary(user, req.body ?? {})
        } else if (method === 'POST' && path === '/api/hr/departments') {
          content = buildPostDepartmentChineseContent(user, req.body ?? {})
        } else if (method === 'PUT' && path === '/api/hr/departments' && req.__auditPutDeptDiff) {
          const op = operatorDisplayName(user)
          content = `操作人${op}修改了部门/岗位资料：${String(req.__auditPutDeptDiff).trim()}`
        } else if (method === 'PUT' && path === '/api/hr/departments/audit' && req.__auditDeptCodeName) {
          const op = operatorDisplayName(user)
          const { name, code } = req.__auditDeptCodeName
          content = `操作人${op}审核了部门/岗位「${displayCell(name)}」（编码：${displayCell(code)}）`
        } else if (method === 'PUT' && path === '/api/hr/departments/unaudit' && req.__auditDeptCodeName) {
          const op = operatorDisplayName(user)
          const { name, code } = req.__auditDeptCodeName
          content = `操作人${op}反审了部门/岗位「${displayCell(name)}」（编码：${displayCell(code)}）`
        } else if (method === 'PUT' && path === '/api/hr/departments/audit-batch') {
          const op = operatorDisplayName(user)
          const n = Array.isArray(req.__auditDeptBatchCodes) ? req.__auditDeptBatchCodes.length : 0
          const labels = String(req.__auditDeptBatchLabels ?? '').trim()
          content = labels
            ? `操作人${op}批量审核部门/岗位，共 ${n} 条：${labels}${n > 15 ? '…' : ''}`
            : `操作人${op}批量审核部门/岗位，共 ${n} 条`
        } else if (method === 'DELETE' && /^\/api\/hr\/departments\/.+/.test(path) && req.__auditDeleteDept) {
          const op = operatorDisplayName(user)
          const { name, code } = req.__auditDeleteDept
          content = `操作人${op}删除了部门/岗位「${displayCell(name)}」（编码：${displayCell(code)}）`
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
              userId: user.userId ?? null,
              userName: String(user.userName ?? user.userCode ?? '').trim() || null,
              action,
              targetTable,
              content,
              ipAddress: getRequestIp(req) || null,
            })
          } catch (err) {
            console.error('[操作审计中间件] 写入 Sys_OperationLogs 失败：', err?.message ?? err)
          }
        })()
      } catch (err) {
        console.error('[操作审计中间件] finish 回调异常：', err?.message ?? err)
      }
    })

    next()
  }
}
