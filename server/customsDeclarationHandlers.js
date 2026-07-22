/**
 * 海关单 API：预览匹配、确认生成生产入库
 */
import { assertUserHasAction } from './apiPermissionGate.js'
import { resolveActorAuditTripletFromReq } from './businessAuditFields.js'
import {
  previewCustomsDeclaration,
  generateCustomsStockIns,
  generateCustomsStockOuts,
} from './customsDeclarationService.js'

function getUserId(req) {
  const n = Number(req?.user?.id ?? req?.user?.userId ?? req?.user?.UserID ?? 0)
  return Number.isFinite(n) && n > 0 ? n : 0
}

/** 与入库单保存一致：查库三字段 + 令牌用户，供 createStockIn 写 kcan07/uid/uname/utruename */
async function getActor(pool, req) {
  const audit = await resolveActorAuditTripletFromReq(pool, req)
  return { ...(req.user ?? req.session?.user ?? {}), ...audit }
}

/**
 * @param {import('express').Express} app
 * @param {{ getPool: Function }} deps
 */
export function registerCustomsDeclarationRoutes(app, deps) {
  const { getPool } = deps

  /**
   * POST /api/customs-declaration/preview
   * body: { rows: [{ excelRowNo, customsNo, shipDate, excelPi, factoryStyleNo, color, declareQty, productName }] }
   */
  app.post('/api/customs-declaration/preview', async (req, res) => {
    try {
      const pool = await getPool()
      const rows = req.body?.rows
      if (!Array.isArray(rows) || !rows.length) {
        res.status(400).json({ code: 400, msg: '请先上传并解析 Excel 明细', data: null })
        return
      }
      const result = await previewCustomsDeclaration(pool, { rows })
      if (!result.ok) {
        res.status(result.status ?? 400).json({ code: result.status ?? 400, msg: result.msg, data: null })
        return
      }
      res.json({ code: 200, msg: 'success', data: result })
    } catch (err) {
      console.error('POST /api/customs-declaration/preview 失败：', err)
      const detail = String(err?.message ?? err?.originalError?.message ?? '预览失败')
      res.status(500).json({ code: 500, msg: `海关单预览失败：${detail}`, data: null })
    }
  })

  /**
   * POST /api/customs-declaration/generate
   * body: { groups: preview 返回的 groups（可改 inboundDate） }
   * 须同时具备海关单 add + 入库单 add
   */
  app.post('/api/customs-declaration/generate', async (req, res) => {
    try {
      const pool = await getPool()
      const userId = getUserId(req)
      if (!userId) {
        res.status(401).json({ code: 401, msg: '未登录', data: null })
        return
      }
      const canStockInAdd = await assertUserHasAction(pool, userId, 'inventory/daily/stock-in', 'add')
      if (!canStockInAdd) {
        res.status(403).json({
          code: 403,
          msg: '没有入库单「新增」权限，无法生成入库单',
          data: null,
        })
        return
      }
      const groups = req.body?.groups
      if (!Array.isArray(groups) || !groups.length) {
        res.status(400).json({ code: 400, msg: '没有可生成的入库组', data: null })
        return
      }
      const actor = await getActor(pool, req)
      const result = await generateCustomsStockIns(pool, { groups, actor, req })
      if (!result.ok) {
        res.status(result.status ?? 400).json({ code: result.status ?? 400, msg: result.msg, data: null })
        return
      }
      res.json({
        code: 200,
        msg: result.summary.createdCount
          ? `已生成 ${result.summary.createdCount} 张入库单`
          : '未生成任何入库单',
        data: result,
      })
    } catch (err) {
      console.error('POST /api/customs-declaration/generate 失败：', err)
      const detail = String(err?.message ?? err?.originalError?.message ?? '生成失败')
      res.status(500).json({ code: 500, msg: `海关单生成入库失败：${detail}`, data: null })
    }
  })

  /**
   * POST /api/customs-declaration/generate-outbound
   * body: { outboundGroups: preview 返回的 outboundGroups }
   * 须同时具备海关单 add + 出库单 add
   */
  app.post('/api/customs-declaration/generate-outbound', async (req, res) => {
    try {
      const pool = await getPool()
      const userId = getUserId(req)
      if (!userId) {
        res.status(401).json({ code: 401, msg: '未登录', data: null })
        return
      }
      const canStockOutAdd = await assertUserHasAction(pool, userId, 'inventory/daily/stock-out', 'add')
      if (!canStockOutAdd) {
        res.status(403).json({
          code: 403,
          msg: '没有出库单「新增」权限，无法生成出库单',
          data: null,
        })
        return
      }
      const outboundGroups = req.body?.outboundGroups
      if (!Array.isArray(outboundGroups) || !outboundGroups.length) {
        res.status(400).json({ code: 400, msg: '没有可生成的出库组', data: null })
        return
      }
      const actor = await getActor(pool, req)
      const result = await generateCustomsStockOuts(pool, { outboundGroups, actor, req })
      if (!result.ok) {
        res.status(result.status ?? 400).json({ code: result.status ?? 400, msg: result.msg, data: null })
        return
      }
      const firstErr = result.errors?.[0]?.msg
      res.json({
        code: 200,
        msg: result.summary.createdCount
          ? `已生成 ${result.summary.createdCount} 张出库单`
          : firstErr
            ? `未生成任何出库单：${firstErr}`
            : '未生成任何出库单',
        data: result,
      })
    } catch (err) {
      console.error('POST /api/customs-declaration/generate-outbound 失败：', err)
      const detail = String(err?.message ?? err?.originalError?.message ?? '生成失败')
      res.status(500).json({ code: 500, msg: `海关单生成出库失败：${detail}`, data: null })
    }
  })
}
