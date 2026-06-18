import { sql } from './db.js'
import { buildBuyOrderLogInfo, writeBuyOrderOperationLog } from './buyOrderOperationLog.js'

const HEADER_FROM = 'dbo.[UB_ERP_Buy_order]'
const LINE_FROM = 'dbo.[UB_ERP_Buy_order_list]'
const FEE_FROM = 'dbo.[UB_ERP_Buy_order_money]'
const BOM_HEAD_FROM = 'dbo.[UB_ERP_Bom_buy_order]'
const BOM_LIST_FROM = 'dbo.[UB_ERP_Bom_buy_order_list]'
const REVERSE_FROM = 'dbo.[UB_ERP_Buy_order_sp]'
const STOCK_IN_FROM = 'dbo.[UB_ERP_Stocks_Storage]'

function flag(v) {
  return String(v ?? '').trim() === '1'
}

function text(v) {
  return String(v ?? '').trim()
}

function uid(actor) {
  const n = Number(actor?.uidInt ?? actor?.uid ?? actor?.userId)
  return Number.isFinite(n) ? Math.trunc(n) : 0
}

async function fetchOrder(pool, id) {
  const r = await pool.request().input('id', sql.Int, id).query(`
    SELECT TOP 1
      [id],
      LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL([kcaj01], N'')))) AS buyOrderNo,
      LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL([kcaj04], N'')))) AS referenceNo,
      LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL([systemcode], N'')))) AS systemCode,
      LTRIM(RTRIM(ISNULL([pass], N''))) AS pass,
      LTRIM(RTRIM(ISNULL([closed], N''))) AS closed,
      LTRIM(RTRIM(ISNULL([del], N''))) AS del
    FROM ${HEADER_FROM}
    WHERE [id] = @id
  `)
  return r.recordset?.[0] ?? null
}

async function detailLineCount(pool, orderNo) {
  const r = await pool.request().input('orderNo', sql.NVarChar(200), orderNo).query(`
    SELECT COUNT(1) AS lineCount
    FROM ${LINE_FROM}
    WHERE LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL([kcak01], N'')))) = @orderNo
      AND (ISNULL([del], N'') = N'' OR [del] = N'0')
  `)
  return Number(r.recordset?.[0]?.lineCount ?? 0)
}

async function inboundCount(pool, orderNo) {
  const r = await pool.request().input('orderNo', sql.NVarChar(200), orderNo).query(`
    SELECT COUNT(1) AS inboundCount
    FROM ${STOCK_IN_FROM}
    WHERE LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL([kcan04], N'')))) = @orderNo
      AND (ISNULL([del], N'') = N'' OR [del] = N'0')
  `)
  return Number(r.recordset?.[0]?.inboundCount ?? 0)
}

async function insertReverseReason(pool, row, reason, actor) {
  const req = pool.request()
  req.input('xsaj01', sql.NVarChar(200), row.buyOrderNo)
  req.input('oid', sql.Int, Number(row.id))
  req.input('content', sql.NVarChar(1000), reason)
  req.input('truename', sql.NVarChar(200), text(actor?.utruename ?? actor?.trueName ?? actor?.userName))
  await req.query(`
    INSERT INTO ${REVERSE_FROM} ([xsaj01], [oid], [content], [addtime], [truename])
    VALUES (@xsaj01, @oid, @content, CONVERT(nvarchar(30), GETDATE(), 120), @truename)
  `)
}

function actionLogName(action) {
  return {
    audit: '审核',
    unaudit: '反审',
    close: '结案',
    unclose: '反结案',
    delete: '删除',
    restore: '恢复',
    'hard-delete': '彻底删除',
  }[action] ?? action
}

export async function applyBuyOrderLifecycleAction({ pool, id, action, actor = {}, reason = '' }) {
  const row = await fetchOrder(pool, id)
  if (!row) return { ok: false, status: 404, msg: '采购单不存在' }
  const isAudited = flag(row.pass)
  const isClosed = flag(row.closed)
  const isDeleted = flag(row.del)
  const linkCount = await inboundCount(pool, row.buyOrderNo)

  if (action === 'audit') {
    if (isDeleted) return { ok: false, status: 400, msg: '回收站采购单不能审核' }
    if (isAudited) return { ok: false, status: 400, msg: '采购单已审核' }
    if ((await detailLineCount(pool, row.buyOrderNo)) <= 0) return { ok: false, status: 400, msg: '采购单没有有效明细，不能审核' }
    const req = pool.request().input('id', sql.Int, id)
      .input('passuid', sql.NVarChar(50), String(uid(actor) || ''))
      .input('passuname', sql.NVarChar(200), text(actor.utruename ?? actor.uname ?? actor.userName))
    await req.query(`UPDATE ${HEADER_FROM} SET [pass]=N'1', [passuid]=@passuid, [passuname]=@passuname WHERE [id]=@id`)
  } else if (action === 'unaudit') {
    const why = text(reason)
    if (isDeleted) return { ok: false, status: 400, msg: '回收站采购单不能反审' }
    if (!isAudited) return { ok: false, status: 400, msg: '未审核采购单不能反审' }
    if (!why) return { ok: false, status: 400, msg: '请填写反审原因' }
    if (linkCount > 0) return { ok: false, status: 400, msg: '此采购单已存在入库单关联，不允许反审' }
    await insertReverseReason(pool, row, why, actor)
    await pool.request().input('id', sql.Int, id).query(`UPDATE ${HEADER_FROM} SET [pass]=N'0' WHERE [id]=@id`)
  } else if (action === 'close') {
    if (isDeleted) return { ok: false, status: 400, msg: '回收站采购单不能结案' }
    if (!isAudited) return { ok: false, status: 400, msg: '未审核采购单不能结案' }
    if (isClosed) return { ok: false, status: 400, msg: '采购单已结案' }
    if (linkCount <= 0) return { ok: false, status: 400, msg: '此采购单不存在入库单关联，不允许结案' }
    await pool.request().input('id', sql.Int, id).query(`UPDATE ${HEADER_FROM} SET [closed]=N'1' WHERE [id]=@id`)
  } else if (action === 'unclose') {
    if (!isClosed) return { ok: false, status: 400, msg: '未结案采购单不能反结案' }
    if (uid(actor) !== 1) return { ok: false, status: 403, msg: '只有超级管理员可以反结案' }
    await pool.request().input('id', sql.Int, id).query(`UPDATE ${HEADER_FROM} SET [closed]=N'0' WHERE [id]=@id`)
  } else if (action === 'delete') {
    if (isDeleted) return { ok: false, status: 400, msg: '采购单已在回收站' }
    if (isAudited) return { ok: false, status: 400, msg: '已审核采购单不能删除' }
    if (linkCount > 0) return { ok: false, status: 400, msg: '此采购单已存在入库单关联，不允许删除' }
    await pool.request().input('id', sql.Int, id)
      .input('delid', sql.NVarChar(50), String(uid(actor) || ''))
      .input('delname', sql.NVarChar(200), text(actor.uname))
      .input('deltruename', sql.NVarChar(200), text(actor.utruename))
      .query(`UPDATE ${HEADER_FROM} SET [del]=N'1', [delid]=@delid, [delname]=@delname, [deltruename]=@deltruename, [deltime]=CONVERT(nvarchar(30), GETDATE(), 120) WHERE [id]=@id`)
  } else if (action === 'restore') {
    if (!isDeleted) return { ok: false, status: 400, msg: '只有回收站采购单可以恢复' }
    if (isAudited) return { ok: false, status: 400, msg: '已审核采购单不能从回收站恢复' }
    await pool.request().input('id', sql.Int, id).query(`UPDATE ${HEADER_FROM} SET [del]=N'0' WHERE [id]=@id`)
  } else if (action === 'hard-delete') {
    if (!isDeleted) return { ok: false, status: 400, msg: '只有回收站采购单可以彻底删除' }
    if (isAudited) return { ok: false, status: 400, msg: '已审核采购单不能彻底删除' }
    if (uid(actor) !== 1) return { ok: false, status: 403, msg: '只有超级管理员可以彻底删除' }
    if (linkCount > 0) return { ok: false, status: 400, msg: '此采购单已存在入库单关联，不允许彻底删除' }
    await pool.request().input('orderNo', sql.NVarChar(200), row.buyOrderNo).input('id', sql.Int, id).query(`
      DELETE FROM ${LINE_FROM} WHERE LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL([kcak01], N'')))) = @orderNo;
      DELETE FROM ${FEE_FROM} WHERE LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL([buy_code], N'')))) = @orderNo;
      DELETE FROM ${BOM_HEAD_FROM} WHERE LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL([sid], N'')))) = @orderNo;
      DELETE FROM ${BOM_LIST_FROM} WHERE LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL([sid], N'')))) = @orderNo;
      DELETE FROM ${HEADER_FROM} WHERE [id] = @id;
    `)
  } else {
    return { ok: false, status: 400, msg: '不支持的采购单操作' }
  }

  await writeBuyOrderOperationLog(pool, {
    actName: actionLogName(action),
    info: buildBuyOrderLogInfo({ orderNo: row.buyOrderNo, referenceNo: row.referenceNo, actor, reason }),
    actor,
    orderNo: row.buyOrderNo,
    systemCode: row.systemCode,
  })
  return { ok: true, msg: `${actionLogName(action)}成功`, id, buyOrderNo: row.buyOrderNo }
}

