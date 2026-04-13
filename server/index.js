/**
 * 后端 API 服务入口
 * 目标：
 * - 连接 SQL Server
 * - 提供 Sys_Users 查询接口给前端页面使用
 */
import express from 'express'
import cors from 'cors'
import dotenv from 'dotenv'
import { getPool, sql } from './db.js'

dotenv.config()

const app = express()

// 说明：
// - 开发阶段前端通过 Vite 代理 /api，不会跨域
// - 但如果你单独访问后端，保留 cors 也更稳妥
app.use(cors())
app.use(express.json())

/**
 * 健康检查
 */
app.get('/api/health', (req, res) => {
  res.json({ ok: true })
})

/**
 * 获取用户列表（规范返回格式）
 *
 * 返回示例：
 * {
 *   "code": 200,
 *   "msg": "success",
 *   "data": [ ...用户列表 ]
 * }
 */
app.get('/api/users', async (req, res) => {
  try {
    // =========================
    // 关键：从 URL 查询参数读取分页参数
    // 小白版解释：
    // - 前端会这样请求：/api/users?page=1&pageSize=10
    // - req.query 就是把 ? 后面的参数拿出来
    // - 我们在后端把它们转成数字，带上默认值
    // =========================
    const pageRaw = req.query?.page
    const pageSizeRaw = req.query?.pageSize

    // 关键：page 默认 1（第一页）
    const page = Number(pageRaw ?? 1)
    // 关键：pageSize 默认 10（每页 10 条）
    const pageSize = Number(pageSizeRaw ?? 10)

    // 关键：对分页参数做保护，避免出现 page=0 / pageSize=999999 之类的异常
    const safePage = Number.isFinite(page) && page > 0 ? Math.floor(page) : 1
    const safePageSize =
      Number.isFinite(pageSize) && pageSize > 0 ? Math.min(Math.floor(pageSize), 200) : 10

    // 关键：OFFSET 的含义是“跳过多少条”
    // 例子：第 1 页跳过 0 条；第 2 页跳过 10 条（假设 pageSize=10）
    const offset = (safePage - 1) * safePageSize

    // =========================
    // 关键：从 URL 查询参数读取“双视图状态”status
    // 小白版解释（你要的“双视图切换”怎么影响 SQL）：
    // - 前端有一个变量 selectedStatus（在职=1，回收站=0）
    // - 前端请求时会带上 status：/api/users?status=1&page=1&pageSize=10
    // - 后端拿到 status 后，会在 SQL 里加 WHERE Status = 1 或 Status = 0
    // - 这就实现了：同一个接口，根据一个变量切换不同视图的数据
    // =========================
    const statusRaw = req.query?.status

    // 关键：status 只允许 1 或 0；如果没传或传错，默认按“在职操作员”（Status=1）
    const parsedStatus = Number(statusRaw)
    const safeStatus = parsedStatus === 0 ? 0 : 1

    // =========================
    // 关键：从 URL 查询参数读取搜索关键字 keyword（模糊搜索）
    // 小白版解释：
    // - 前端搜索框输入“001”或“张三”
    // - 点击查询后，会请求：/api/users?status=1&keyword=001&page=1&pageSize=10
    // - 后端拿到 keyword 后，会在 SQL 里加：
    //   (UserCode LIKE @key OR UserName LIKE @key)
    // =========================
    const keywordRaw = String(req.query?.keyword ?? '').trim()

    // 关键：如果 keyword 为空，就不加 LIKE 条件；如果不为空，就开启模糊搜索
    const hasKeyword = keywordRaw.length > 0

    // 关键：双视图切换后的搜索规则
    // 小白版解释：
    // - 现在不再是“搜索默认只搜启用”
    // - 而是：你在哪个视图，就只搜哪个视图的数据
    //   - 在职视图：Status=1（只搜启用）
    //   - 回收站视图：Status=0（只搜禁用）
    // - 所以这里永远会带上 Status 过滤，再按需叠加 keyword 的 LIKE
    const alwaysFilterByStatus = true

    // 关键：LIKE 的参数值写成 %关键字%（% 的意思是“任意长度的任意字符”）
    // 例子：
    // - key = '%001%'：可以匹配 '001' / 'A001B' / 'X001'
    // - key = '%张%'：可以匹配 '张三' / '小张' / '老张三'
    const likeKey = `%${keywordRaw}%`

    // 关键：把 WHERE 子句单独拼出来，便于在“总数查询”和“列表查询”里复用
    // 小白版解释（LIKE 模糊匹配怎么工作）：
    // - UserCode LIKE @key 表示“工号里包含关键字”
    // - UserName LIKE @key 表示“姓名里包含关键字”
    // - OR 表示“满足其中一个就算匹配”
    // - Status = @status 表示“只取当前视图对应的状态”
    //
    // 组合规则：
    // - 永远带 Status 过滤（由前端 status 控制）
    // - 如果 keyword 不为空，再加 LIKE 条件
    const whereSql = hasKeyword
      ? 'WHERE Status = @status AND (UserCode LIKE @key OR UserName LIKE @key)'
      : 'WHERE Status = @status'

    // =========================
    // 关键：从连接池获取可复用的数据库连接（避免每次请求都重新握手）
    // =========================
    const pool = await getPool()

    // =========================
    // 关键：先查询总条数 total（用于前端分页器显示“总条数”）
    // 小白版解释：
    // - 你要在页面底部显示 “共多少条”
    // - 所以后端必须先 COUNT 一下表里一共有多少行
    // =========================
    const totalRequest = pool.request()

    // 关键：把当前视图的状态作为参数传给 SQL（防注入）
    if (alwaysFilterByStatus) {
      totalRequest.input('status', sql.Int, safeStatus)
    }

    // 关键：如果开启了搜索，就把 @key 作为 nvarchar 参数传给 SQL（防注入 + 防中文乱码）
    if (hasKeyword) {
      totalRequest.input('key', sql.NVarChar(100), likeKey)
    }

    const totalResult = await totalRequest.query(`
      SELECT COUNT(1) AS total
      FROM Sys_Users
      ${whereSql}
    `)

    // 关键：从结果里取出 total（如果没取到就当 0）
    const total = Number(totalResult.recordset?.[0]?.total ?? 0)

    // =========================
    // 关键：分页查询用户列表（SQL Server：OFFSET ... FETCH NEXT）
    // 小白版解释：
    // - ORDER BY：先确定排序（否则分页会乱）
    // - OFFSET @offset：跳过 offset 条
    // - FETCH NEXT @pageSize：再取 pageSize 条
    // =========================
    const listRequest = pool.request()

    // 关键：把分页参数作为 SQL 参数传进去（避免拼字符串造成注入风险）
    listRequest.input('offset', sql.Int, offset)
    listRequest.input('pageSize', sql.Int, safePageSize)

    // 关键：把当前视图的状态作为参数传给 SQL（防注入）
    if (alwaysFilterByStatus) {
      listRequest.input('status', sql.Int, safeStatus)
    }

    // 关键：如果开启了搜索，就把 @key 作为 nvarchar 参数传给 SQL（防注入 + 防中文乱码）
    if (hasKeyword) {
      listRequest.input('key', sql.NVarChar(100), likeKey)
    }

    // 关键：明确列名，保证前端表格字段稳定
    // 说明：
    // - 你要求用 OFFSET...FETCH NEXT 做分页（SQL Server 2012+ 支持）
    // - 但如果你的 SQL Server 版本/兼容级别较老，会报：
    //   - “Incorrect syntax near 'OFFSET'”
    //   - “Invalid usage of the option NEXT in the FETCH statement.”
    // - 为了保证你在任何内网环境都能跑通，这里做一个“自动降级”：
    //   - 优先用 OFFSET...FETCH
    //   - 失败则改用 ROW_NUMBER() 方式分页（老版本也支持）
    let result
    try {
      // 关键：优先使用 OFFSET...FETCH NEXT（你指定的分页语法）
      result = await listRequest.query(`
        SELECT
          UserID,
          UserCode,
          UserName,
          Status,
          CreatedAt
        FROM Sys_Users
        ${whereSql}
        ORDER BY CreatedAt DESC
        OFFSET @offset ROWS
        FETCH NEXT @pageSize ROWS ONLY
      `)
    } catch (pageErr) {
      // 关键：识别“数据库不支持 OFFSET/FETCH”的典型报错
      const msg = String(pageErr?.message ?? pageErr?.originalError?.message ?? '')
      const shouldFallback =
        msg.includes("Incorrect syntax near 'OFFSET'") ||
        msg.includes('Invalid usage of the option NEXT') ||
        msg.toLowerCase().includes('offset') ||
        msg.toLowerCase().includes('fetch')

      // 关键：如果不是分页语法问题，就继续抛出，让外层 catch 处理
      if (!shouldFallback) throw pageErr

      // 关键：使用 ROW_NUMBER() 降级分页
      // 小白版解释：
      // - ROW_NUMBER() 会给每一行一个连续编号 rn（按 CreatedAt DESC 排序）
      // - 然后我们只取 rn 在某个范围内的行，就实现了“第 N 页”
      const startRow = offset + 1
      const endRow = offset + safePageSize

      const fallbackRequest = pool.request()
      fallbackRequest.input('startRow', sql.Int, startRow)
      fallbackRequest.input('endRow', sql.Int, endRow)

      // 关键：如果开启了搜索，就把 @key 作为 nvarchar 参数传给 SQL（防注入 + 防中文乱码）
      if (hasKeyword) {
        fallbackRequest.input('key', sql.NVarChar(100), likeKey)
      }
      // 关键：降级分页同样要带上 status 参数
      if (alwaysFilterByStatus) {
        fallbackRequest.input('status', sql.Int, safeStatus)
      }

      result = await fallbackRequest.query(`
        SELECT
          UserID,
          UserCode,
          UserName,
          Status,
          CreatedAt
        FROM (
          SELECT
            UserID,
            UserCode,
            UserName,
            Status,
            CreatedAt,
            ROW_NUMBER() OVER (ORDER BY CreatedAt DESC) AS rn
          FROM Sys_Users
          ${whereSql}
        ) t
        WHERE t.rn BETWEEN @startRow AND @endRow
        ORDER BY t.rn
      `)
    }

    // =========================
    // 关键：按约定格式返回（新增 total 字段）
    // =========================
    res.json({
      code: 200,
      msg: 'success',
      // 关键：列表统一用 list 字段（符合模块标准化要求）
      list: result.recordset ?? [],
      total,
    })
  } catch (err) {
    // 关键：服务端记录详细错误，便于排查（前端只拿到通用错误提示）
    console.error('查询 /api/users 失败：', err)

    // 关键：返回统一结构，前端可直接根据 code 判断是否成功
    res.status(500).json({
      code: 500,
      msg: 'error',
      list: [],
      total: 0,
    })
  }
})

/**
 * 恢复用户（把禁用用户 Status 从 0 改回 1）
 *
 * 路由：PUT /api/users/resume
 *
 * 说明（小白版）：
 * - 禁用=Status=0
 * - 恢复=Status=1
 * - 恢复后用户会重新出现在“常规搜索结果/启用列表”里
 */
app.put('/api/users/resume', async (req, res) => {
  try {
    // 关键：从请求体读取要恢复的用户 ID
    const userId = Number(req.body?.UserID)
    if (!Number.isFinite(userId) || userId <= 0) {
      res.status(400).json({ code: 400, msg: 'UserID 不合法（必须是正整数）', data: null })
      return
    }

    // 关键：获取数据库连接池
    const pool = await getPool()

    // 关键：参数化更新（防注入）
    const request = pool.request()
    request.input('UserID', sql.Int, userId)
    request.input('Status', sql.Int, 1)

    // 关键：把 Status 更新为 1，并返回更新后的关键字段
    const result = await request.query(`
      UPDATE Sys_Users
      SET Status = @Status
      OUTPUT INSERTED.UserID, INSERTED.UserCode, INSERTED.UserName, INSERTED.Status, INSERTED.CreatedAt
      WHERE UserID = @UserID
    `)

    const updated = result.recordset?.[0]
    if (!updated) {
      res.status(404).json({ code: 404, msg: '未找到该用户（UserID 不存在）', data: null })
      return
    }

    res.json({ code: 200, msg: 'success', data: updated })
  } catch (err) {
    console.error('恢复 /api/users/resume 失败：', err)
    res.status(500).json({ code: 500, msg: '数据库写入失败，请联系管理员', data: null })
  }
})

/**
 * 彻底删除用户（物理删除）
 *
 * 路由：DELETE /api/users/:id
 *
 * 阶梯式删除规则（你要求的）：必须先禁用（Status=0）才能删除
 * 小白版解释：
 * - 先禁用：相当于“先放回收站”
 * - 再删除：相当于“清空回收站”，不可恢复
 */
app.delete('/api/users/:id', async (req, res) => {
  try {
    // 关键：从 URL 路径参数拿到 id（:id）
    const userId = Number(req.params?.id)
    if (!Number.isFinite(userId) || userId <= 0) {
      res.status(400).json({ code: 400, msg: 'id 不合法（必须是正整数）', data: null })
      return
    }

    // 关键：获取数据库连接池
    const pool = await getPool()

    // 关键：先查一次状态，确保“必须先禁用才能删除”
    const checkReq = pool.request()
    checkReq.input('UserID', sql.Int, userId)
    const check = await checkReq.query(`
      SELECT TOP (1) UserID, Status
      FROM Sys_Users
      WHERE UserID = @UserID
    `)
    const row = check.recordset?.[0]
    if (!row) {
      res.status(404).json({ code: 404, msg: '未找到该用户（UserID 不存在）', data: null })
      return
    }

    // 关键：如果还在启用（Status=1），禁止直接物理删除
    if (Number(row.Status) === 1) {
      res.status(400).json({ code: 400, msg: '必须先禁用该用户，才能彻底删除', data: null })
      return
    }

    // 关键：执行物理删除（DELETE）
    const delReq = pool.request()
    delReq.input('UserID', sql.Int, userId)
    const del = await delReq.query(`
      DELETE FROM Sys_Users
      WHERE UserID = @UserID
    `)

    // 关键：rowsAffected[0] 表示删除了多少行（0=没删到，1=删到）
    const affected = Number(del.rowsAffected?.[0] ?? 0)
    if (affected === 0) {
      res.status(404).json({ code: 404, msg: '删除失败：未找到该用户', data: null })
      return
    }

    res.json({ code: 200, msg: 'success', data: { UserID: userId } })
  } catch (err) {
    console.error('删除 DELETE /api/users/:id 失败：', err)
    res.status(500).json({ code: 500, msg: '数据库写入失败，请联系管理员', data: null })
  }
})

/**
 * 新增用户（操作员资料）
 *
 * 需求：
 * - 接收：UserCode（工号）、UserName（姓名）、Password（密码）
 * - 写入：Sys_Users
 * - 默认：Status = 1（启用），CreatedAt = 当前时间
 *
 * 安全说明（非常重要）：
 * - 这里使用参数化查询（request.input）防止 SQL 注入
 * - “密码”建议改为加盐哈希后存储（例如 bcrypt），当前按你的需求先直存
 *
 * 返回示例：
 * {
 *   "code": 200,
 *   "msg": "success",
 *   "data": { ...新建记录关键字段... }
 * }
 */
app.post('/api/users', async (req, res) => {
  try {
    // 关键：从请求体中读取前端提交的数据（需要 app.use(express.json()) 才能解析）
    const { UserCode, UserName, Password } = req.body ?? {}

    // 关键：做最基础的后端校验，避免插入空数据
    if (!String(UserCode || '').trim()) {
      res.status(400).json({ code: 400, msg: 'UserCode 不能为空', data: null })
      return
    }
    if (!String(UserName || '').trim()) {
      res.status(400).json({ code: 400, msg: 'UserName 不能为空', data: null })
      return
    }
    if (!String(Password || '').trim()) {
      res.status(400).json({ code: 400, msg: 'Password 不能为空', data: null })
      return
    }

    // 关键：获取数据库连接池
    const pool = await getPool()

    // 关键：使用参数化查询，避免把用户输入拼到 SQL 字符串中（防注入）
    const request = pool.request()
    request.input('UserCode', sql.NVarChar(50), String(UserCode).trim())
    request.input('UserName', sql.NVarChar(50), String(UserName).trim())
    request.input('Password', sql.NVarChar(200), String(Password))

    // 关键：执行 SQL 插入（单独 try-catch，专门把“工号重复”这种常见错误识别出来）
    let result
    try {
      // 关键：插入数据，并通过 OUTPUT 返回插入后的关键字段
      result = await request.query(`
        INSERT INTO Sys_Users (UserCode, UserName, Password, Status, CreatedAt)
        OUTPUT INSERTED.UserID, INSERTED.UserCode, INSERTED.UserName, INSERTED.Status, INSERTED.CreatedAt
        VALUES (@UserCode, @UserName, @Password, 1, GETDATE())
      `)
    } catch (dbErr) {
      // 关键：识别“唯一键冲突（工号重复）”
      // 小白版解释：
      // - SQL Server 如果违反 UNIQUE KEY，常见错误号是 2627（也可能是 2601）
      // - 有些驱动会把错误号挂在 dbErr.number / dbErr.originalError.number 上
      // - 有些情况只能从错误文本里看到 “Violation of UNIQUE KEY”
      const errNumber =
        dbErr?.number ??
        dbErr?.originalError?.number ??
        dbErr?.originalError?.info?.number ??
        dbErr?.code
      const errMessage = String(dbErr?.message ?? dbErr?.originalError?.message ?? '')

      // 关键：按你的要求，只要错误号是 2627 或文案包含 UNIQUE KEY 关键字，就当作“工号已存在”
      if (Number(errNumber) === 2627 || errMessage.includes('Violation of UNIQUE KEY')) {
        res.status(400).json({
          code: 400,
          msg: '工号已存在，请勿重复添加',
          data: null,
        })
        return
      }

      // 关键：其他数据库写入错误，返回统一中文提示（不要让小白看到一堆英文堆栈）
      console.error('数据库写入失败（POST /api/users）：', dbErr)
      res.status(500).json({
        code: 500,
        msg: '数据库写入失败，请联系管理员',
        data: null,
      })
      return
    }

    // 关键：取出插入后的记录（recordset[0]）
    const created = result.recordset?.[0] ?? null

    // 关键：按统一格式返回
    res.json({
      code: 200,
      msg: 'success',
      data: created,
    })
  } catch (err) {
    // 关键：服务端打印详细错误，便于你定位“字段不能为空/长度超限/唯一键冲突”等问题
    console.error('新增 /api/users 失败：', err)
    res.status(500).json({
      code: 500,
      msg: '数据库写入失败，请联系管理员',
      data: null,
    })
  }
})

/**
 * 修改用户（编辑 / 禁用）
 *
 * 说明（为什么只做“禁用”，不做物理删除）：
 * - 业务里删除账号往往需要留痕
 * - 所以我们用 Status=0 表示“禁用”，这就是“软删除”
 *
 * 前端会传两种不同的 payload：
 *
 * A) 编辑资料（修改工号/姓名/密码）
 * {
 *   "UserID": 1,
 *   "UserCode": "001",
 *   "UserName": "张三",
 *   "Password": "可选：不填表示不修改密码"
 * }
 *
 * B) 禁用账号（只改状态）
 * {
 *   "UserID": 1,
 *   "Status": 0
 * }
 *
 * 统一返回：
 * - 成功：{ code: 200, msg: "success", data: ... }
 * - 失败：{ code: xxx, msg: "中文原因", data: null }
 */
app.put('/api/users', async (req, res) => {
  try {
    // 关键：从请求体读取用户提交的数据（PUT 也走 JSON body）
    const body = req.body ?? {}

    // 关键：UserID 是定位“要改哪一行”的主键，必须有
    const userId = Number(body.UserID)
    if (!Number.isFinite(userId) || userId <= 0) {
      res.status(400).json({ code: 400, msg: 'UserID 不合法（必须是正整数）', data: null })
      return
    }

    // 关键：获取数据库连接池（复用连接）
    const pool = await getPool()

    // 关键：创建 request 用于参数化查询（防 SQL 注入）
    const request = pool.request()
    request.input('UserID', sql.Int, userId)

    // =========================
    // 分支 1：禁用账号（软删除）
    // =========================
    // 关键：如果前端传了 Status（并且明确要设为 0），我们就只更新状态
    if (body.Status !== undefined && body.Status !== null) {
      // 关键：把状态转为数字
      const status = Number(body.Status)

      // 关键：目前业务只要求“禁用”，即把状态改成 0
      if (status !== 0) {
        res.status(400).json({ code: 400, msg: '目前仅支持把 Status 更新为 0（禁用）', data: null })
        return
      }

      // 关键：参数化写入 Status=0
      request.input('Status', sql.Int, 0)

      // 关键：更新并返回更新后的关键字段（方便前端确认改成功了）
      const result = await request.query(`
        UPDATE Sys_Users
        SET Status = @Status
        OUTPUT INSERTED.UserID, INSERTED.UserCode, INSERTED.UserName, INSERTED.Status, INSERTED.CreatedAt
        WHERE UserID = @UserID
      `)

      // 关键：如果没有任何行被更新，说明 UserID 不存在
      const updated = result.recordset?.[0]
      if (!updated) {
        res.status(404).json({ code: 404, msg: '未找到该用户（UserID 不存在）', data: null })
        return
      }

      res.json({ code: 200, msg: 'success', data: updated })
      return
    }

    // =========================
    // 分支 2：编辑资料
    // =========================
    // 关键：读取要更新的字段
    const userCode = String(body.UserCode ?? '').trim()
    const userName = String(body.UserName ?? '').trim()
    const password = body.Password === undefined || body.Password === null ? undefined : String(body.Password)

    // 关键：后端必填校验（编辑资料必须至少有工号/姓名）
    if (!userCode) {
      res.status(400).json({ code: 400, msg: 'UserCode 不能为空', data: null })
      return
    }
    if (!userName) {
      res.status(400).json({ code: 400, msg: 'UserName 不能为空', data: null })
      return
    }

    // 关键：把要更新的字段加入参数（nvarchar 防中文乱码）
    request.input('UserCode', sql.NVarChar(50), userCode)
    request.input('UserName', sql.NVarChar(50), userName)

    // 关键：密码的处理策略（小白版解释）
    // - 我们不会从数据库把旧密码读回前端（安全原因）
    // - 所以前端“编辑弹窗”的密码默认留空
    // - 如果你在编辑时真的想改密码，就输入新密码；如果留空，就表示“不修改密码”
    const shouldUpdatePassword = !!String(password ?? '').trim()
    if (shouldUpdatePassword) {
      request.input('Password', sql.NVarChar(200), String(password))
    }

    // 关键：根据是否要改密码，拼两种 UPDATE（注意：仍然是参数化，不存在注入风险）
    const sqlText = shouldUpdatePassword
      ? `
        UPDATE Sys_Users
        SET
          UserCode = @UserCode,
          UserName = @UserName,
          Password = @Password
        OUTPUT INSERTED.UserID, INSERTED.UserCode, INSERTED.UserName, INSERTED.Status, INSERTED.CreatedAt
        WHERE UserID = @UserID
      `
      : `
        UPDATE Sys_Users
        SET
          UserCode = @UserCode,
          UserName = @UserName
        OUTPUT INSERTED.UserID, INSERTED.UserCode, INSERTED.UserName, INSERTED.Status, INSERTED.CreatedAt
        WHERE UserID = @UserID
      `

    // 关键：执行更新
    const result = await request.query(sqlText)

    // 关键：如果没有更新到行，说明 UserID 不存在
    const updated = result.recordset?.[0]
    if (!updated) {
      res.status(404).json({ code: 404, msg: '未找到该用户（UserID 不存在）', data: null })
      return
    }

    // 关键：返回更新后的记录（前端刷新列表时也能看到最新数据）
    res.json({ code: 200, msg: 'success', data: updated })
  } catch (err) {
    // 关键：数据库报错（比如唯一键冲突/长度超限）会进入这里
    console.error('修改 /api/users 失败：', err)
    res.status(500).json({ code: 500, msg: 'error', data: null })
  }
})

/**
 * 获取 Sys_Users 列表
 *
 * 重要说明（避免 SQL 注入）：
 * - 本接口不拼接用户输入到 SQL 字符串中
 * - 如后续加入筛选条件，请使用参数化查询（request.input）
 */
app.get('/api/sys-users', async (req, res) => {
  try {
    const pool = await getPool()

    // 说明：
    // - 这里先用 SELECT * 简化展示（你已经创建了 Sys_Users 表）
    // - 生产建议明确列名，并按业务字段排序/分页
    const result = await pool.request().query('SELECT * FROM Sys_Users')

    res.json({
      ok: true,
      data: result.recordset ?? [],
    })
  } catch (err) {
    // 详细错误只写到服务端日志，前端返回可读信息，避免泄露敏感连接信息
    console.error('查询 Sys_Users 失败：', err)
    res.status(500).json({
      ok: false,
      message: '读取 Sys_Users 失败，请检查数据库连接配置与表是否存在。',
      // 开发排错用：不建议在生产环境开启
      ...(String(process.env.DEBUG_API ?? 'false').toLowerCase() === 'true'
        ? {
            debug: {
              name: err?.name,
              code: err?.code,
              message: err?.message,
            },
          }
        : {}),
    })
  }
})

// 可选：优雅关闭（例如 Ctrl+C）
process.on('SIGINT', async () => {
  try {
    await sql.close()
  } finally {
    process.exit(0)
  }
})

const port = process.env.PORT ? Number(process.env.PORT) : 3001
app.listen(port, () => {
  console.log(`API 服务已启动：http://localhost:${port}`)
})

