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

