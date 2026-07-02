/**
 * 库存统计表 API 路由
 */
import { sql } from './db.js'
import {
  deleteStockStatsSnapshot,
  fetchStockStatsWarehouseOptions,
  generateStockStatsSnapshot,
  listStockStatsSnapshotLines,
  listStockStatsSnapshots,
} from './stockStatsService.js'
import { fetchStockStatsPrintHeader } from './stockStatsPrintHeader.js'

function text(v) {
  return String(v ?? '').trim()
}

async function getActor(pool, req) {
  const uid = text(req.user?.uid ?? req.user?.userId)
  if (!uid) return req.user ?? {}
  try {
    const r = await pool.request().input('uid', sql.NVarChar(50), uid).query(`
      SELECT TOP 1 [UserID], [UserName], [Truename]
      FROM dbo.[UB_ERP_User]
      WHERE LTRIM(RTRIM(CONVERT(nvarchar(50), ISNULL([UserID], N'')))) = @uid
    `)
    const row = r.recordset?.[0]
    if (row) {
      return {
        ...req.user,
        uid: String(row.UserID),
        uname: text(row.UserName),
        utruename: text(row.Truename),
      }
    }
  } catch {
    /* 读操作员失败时沿用 token 载荷 */
  }
  return req.user ?? {}
}

export function registerStockStatsRoutes(app, { getPool }) {
  app.get('/api/stock-stats/print-header', async (req, res) => {
    try {
      const pool = await getPool()
      res.json({ code: 200, msg: 'success', data: await fetchStockStatsPrintHeader(pool) })
    } catch (err) {
      res.status(500).json({ code: 500, msg: `读取打印抬头失败：${String(err?.message ?? err)}`, data: null })
    }
  })

  app.get('/api/stock-stats/warehouse-options', async (req, res) => {
    try {
      const pool = await getPool()
      const list = await fetchStockStatsWarehouseOptions(pool, text(req.query?.keyword))
      res.json({ code: 200, msg: 'success', data: { list } })
    } catch (err) {
      res.status(500).json({ code: 500, msg: `读取仓库失败：${String(err?.message ?? err)}`, data: null })
    }
  })

  app.get('/api/stock-stats/snapshots', async (req, res) => {
    try {
      const pool = await getPool()
      const data = await listStockStatsSnapshots(pool, req.query ?? {})
      res.json({ code: 200, msg: 'success', data })
    } catch (err) {
      res.status(500).json({ code: 500, msg: `读取统计快照列表失败：${String(err?.message ?? err)}`, data: null })
    }
  })

  app.get('/api/stock-stats/snapshots/:id/lines', async (req, res) => {
    try {
      const pool = await getPool()
      const result = await listStockStatsSnapshotLines(pool, req.params?.id, req.query ?? {})
      if (!result.ok) {
        res.status(result.status ?? 400).json({ code: result.status ?? 400, msg: result.msg, data: null })
        return
      }
      res.json({ code: 200, msg: 'success', data: result })
    } catch (err) {
      res.status(500).json({ code: 500, msg: `读取统计明细失败：${String(err?.message ?? err)}`, data: null })
    }
  })

  app.post('/api/stock-stats/generate', async (req, res) => {
    try {
      const pool = await getPool()
      const actor = await getActor(pool, req)
      const started = Date.now()
      const result = await generateStockStatsSnapshot(pool, req.body ?? {}, actor)
      if (!result.ok) {
        res.status(result.status ?? 400).json({ code: result.status ?? 400, msg: result.msg, data: null })
        return
      }
      res.json({
        code: 200,
        msg: 'success',
        data: {
          snapshotId: result.snapshotId,
          rowCount: result.rowCount,
          elapsedMs: Date.now() - started,
        },
      })
    } catch (err) {
      res.status(500).json({ code: 500, msg: `生成库存统计失败：${String(err?.message ?? err)}`, data: null })
    }
  })

  app.delete('/api/stock-stats/snapshots/:id', async (req, res) => {
    try {
      const pool = await getPool()
      const result = await deleteStockStatsSnapshot(pool, req.params?.id)
      if (!result.ok) {
        res.status(result.status ?? 400).json({ code: result.status ?? 400, msg: result.msg, data: null })
        return
      }
      res.json({ code: 200, msg: 'success', data: null })
    } catch (err) {
      res.status(500).json({ code: 500, msg: `删除统计快照失败：${String(err?.message ?? err)}`, data: null })
    }
  })
}
