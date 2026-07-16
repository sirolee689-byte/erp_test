/**
 * 销售订单按行同步 BOM（issue 04）
 * 批量：服务端有限并发只写各款 PI BOM；主表 is_pur 在批量结束后只改一次，避免并发抢同一行死锁
 */
import { sql } from './db.js'
import { normKcaa01 } from './salesOrderSaveLogic.js'
import {
  createPiBomBatchSyncContext,
  deletePiBomProduct,
  formatSalesOrderAuditTime,
  preparePiBomFromMasterBom,
  replacePiBomFromMasterBom,
  writePreparedPiBomFromMasterBom,
} from './salesOrderPiBom.js'
import { SALES_ORDER_HEADER_TABLE } from './salesOrderListQuery.js'
import {
  parseSyncBomKcaa01,
  parseSyncBomKcaa01List,
  validateSyncBomLineOnOrder,
  validateSyncBomOrderState,
} from './salesOrderSyncBomLogic.js'

const HEADER_FROM = `dbo.[${SALES_ORDER_HEADER_TABLE}]`
const LINE_FROM = 'dbo.[UB_ERP_Sales_order_list]'

/** 批量同步固定并发（同 PI 写库防打满） */
export const SYNC_BOM_BATCH_CONCURRENCY = 3

/** 死锁 1205：含首次共尝试次数（批量/单款写 PI BOM 共用） */
const SYNC_BOM_DEADLOCK_MAX_ATTEMPTS = 4
/** 死锁重试退避基数（毫秒）；实际等待 = 基数 * 已失败次数 + 抖动 */
const SYNC_BOM_DEADLOCK_RETRY_BASE_MS = 120

const DEADLOCK_USER_MSG = '数据库忙冲突（死锁），请稍后重试同步该款'

/**
 * @param {import('mssql').ConnectionPool} pool
 * @param {number} id
 */
async function fetchOrderHeaderForSync(pool, id) {
  const r = await pool.request().input('id', sql.Int, id).query(`
    SELECT TOP 1
      [id],
      LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL([xsaj01], N'')))) AS piNo,
      LTRIM(RTRIM(ISNULL([pass], N''))) AS pass,
      LTRIM(RTRIM(ISNULL([del], N''))) AS del
    FROM ${HEADER_FROM}
    WHERE [id] = @id
  `)
  return r.recordset?.[0] ?? null
}

/**
 * @param {import('mssql').ConnectionPool} pool
 * @param {string} piNo
 */
async function fetchOrderLineKcaa01Set(pool, piNo) {
  const pi = normKcaa01(piNo)
  const r = await pool.request().input('pi', sql.NVarChar(200), pi).query(`
    SELECT LTRIM(RTRIM(CONVERT(nvarchar(300), ISNULL([kcaa01], N'')))) AS kcaa01
    FROM ${LINE_FROM}
    WHERE LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL([xsak01], N'')))) = @pi
  `)
  return (r.recordset ?? []).map((row) => normKcaa01(row.kcaa01)).filter(Boolean)
}

/**
 * @param {unknown} err
 */
function isSqlDeadlockError(err) {
  const num =
    Number(err?.number) ||
    Number(err?.originalError?.info?.number) ||
    Number(err?.originalError?.number) ||
    0
  if (num === 1205) return true
  return /deadlock/i.test(String(err?.message ?? err?.originalError?.message ?? ''))
}

/**
 * @param {number} ms
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * @param {{
 *   uname?: string | null,
 *   utruename?: string | null,
 *   uidInt?: number | null,
 *   ip?: string,
 * }} actorLike
 */
function buildActorRow(actorLike) {
  return {
    uname: actorLike.uname,
    utruename: actorLike.utruename,
    uid: actorLike.uidInt != null ? String(actorLike.uidInt) : '',
    ip: actorLike.ip ?? '',
  }
}

/**
 * 销售订单主表标未运算（is_pur=0）；批量路径只在全部款写完后调用一次
 * @param {import('mssql').ConnectionPool | import('mssql').Transaction} db
 * @param {{
 *   id: number,
 *   actor: { uidInt: number | null, uname: string | null, utruename: string | null },
 *   ip: string,
 * }} opts
 */
async function markSalesOrderUncalc(db, opts) {
  const { id, actor, ip } = opts
  const actorRow = buildActorRow({ ...actor, ip })
  const now = formatSalesOrderAuditTime()
  const up = new sql.Request(db)
  up.input('id', sql.Int, id)
  up.input('uname', sql.NVarChar(100), String(actor.uname ?? ''))
  up.input('utruename', sql.NVarChar(100), String(actor.utruename ?? ''))
  up.input('uid', sql.NVarChar(50), actorRow.uid)
  up.input('edittime', sql.NVarChar(50), now)
  up.input('ip', sql.NVarChar(100), ip)
  await up.query(`
    UPDATE ${HEADER_FROM}
    SET [is_pur] = N'0',
        [uname] = @uname,
        [utruename] = @utruename,
        [uid] = @uid,
        [edittime] = @edittime,
        [ip] = @ip
    WHERE [id] = @id
  `)
}

/**
 * 仅覆盖一款 PI BOM（不含主表 is_pur）；批量并发用，避免多事务抢同一主表行
 * @param {{
 *   pool: import('mssql').ConnectionPool,
 *   piNo: string,
 *   kcaa01: string,
 *   actor: { uidInt: number | null, uname: string | null, utruename: string | null },
 *   ip: string,
 *   syncContext?: any,
 *   prepared?: any,
 * }} opts
 */
async function writeSyncBomPiOnly(opts) {
  const { pool, piNo, kcaa01, actor, ip, syncContext, prepared } = opts
  const actorRow = buildActorRow({ ...actor, ip })
  const writeStartedAt = Date.now()

  const tx = new sql.Transaction(pool)
  await tx.begin()
  try {
    const syncResult = prepared
      ? {
          timing: {
            ...prepared.timing,
            ...(await deletePiBomProduct(tx, piNo, kcaa01)),
            ...(await writePreparedPiBomFromMasterBom(tx, prepared)),
          },
        }
      : await replacePiBomFromMasterBom(pool, tx, piNo, kcaa01, actorRow, syncContext)
    const commitStartedAt = Date.now()
    await tx.commit()
    return {
      ok: true,
      piNo,
      kcaa01,
      timing: {
        ...(syncResult?.timing ?? {}),
        commitMs: Date.now() - commitStartedAt,
        writeTransactionMs: Date.now() - writeStartedAt,
      },
    }
  } catch (err) {
    try {
      await tx.rollback()
    } catch {
      // ignore
    }
    if (err?.code === 'BOM_CYCLE' || err?.code === 'BOM_DEPTH' || err?.code === 'BOM_NOT_FOUND') {
      return { ok: false, status: 400, msg: String(err.message) }
    }
    throw err
  }
}

/**
 * 单款写库：PI BOM + 主表标未运算（同事务；单行同步用）
 * @param {{
 *   pool: import('mssql').ConnectionPool,
 *   id: number,
 *   piNo: string,
 *   kcaa01: string,
 *   actor: { uidInt: number | null, uname: string | null, utruename: string | null },
 *   ip: string,
 * }} opts
 */
async function writeSyncBomForProduct(opts) {
  const { pool, id, piNo, kcaa01, actor, ip } = opts
  const actorRow = buildActorRow({ ...actor, ip })

  const tx = new sql.Transaction(pool)
  await tx.begin()
  try {
    await replacePiBomFromMasterBom(pool, tx, piNo, kcaa01, actorRow)
    await markSalesOrderUncalc(tx, { id, actor, ip })
    await tx.commit()
    return { ok: true, piNo, kcaa01, markUncalc: true }
  } catch (err) {
    try {
      await tx.rollback()
    } catch {
      // ignore
    }
    if (err?.code === 'BOM_CYCLE' || err?.code === 'BOM_DEPTH' || err?.code === 'BOM_NOT_FOUND') {
      return { ok: false, status: 400, msg: String(err.message) }
    }
    throw err
  }
}

/**
 * @param {() => Promise<any>} run
 */
async function withDeadlockRetry(run) {
  let lastErr
  for (let attempt = 1; attempt <= SYNC_BOM_DEADLOCK_MAX_ATTEMPTS; attempt++) {
    try {
      return await run()
    } catch (err) {
      lastErr = err
      if (!isSqlDeadlockError(err) || attempt >= SYNC_BOM_DEADLOCK_MAX_ATTEMPTS) {
        throw err
      }
      // 退避 + 小抖动，降低多款同时重试再次撞锁概率
      const jitter = Math.floor(Math.random() * 80)
      await sleep(SYNC_BOM_DEADLOCK_RETRY_BASE_MS * attempt + jitter)
    }
  }
  throw lastErr
}

/**
 * @param {Parameters<typeof writeSyncBomForProduct>[0]} opts
 */
async function writeSyncBomForProductWithDeadlockRetry(opts) {
  return withDeadlockRetry(() => writeSyncBomForProduct(opts))
}

/**
 * @param {Parameters<typeof writeSyncBomPiOnly>[0]} opts
 */
async function writeSyncBomPiOnlyWithDeadlockRetry(opts) {
  return withDeadlockRetry(() => writeSyncBomPiOnly(opts))
}

/**
 * @param {unknown} err
 */
function formatSyncBomFailureMsg(err) {
  if (isSqlDeadlockError(err)) return DEADLOCK_USER_MSG
  return String(err?.message ?? err?.originalError?.message ?? '同步失败')
}

/**
 * @param {{
 *   pool: import('mssql').ConnectionPool,
 *   id: number,
 *   kcaa01: unknown,
 *   actor: { uidInt: number | null, uname: string | null, utruename: string | null },
 *   ip: string,
 * }} opts
 */
export async function syncSalesOrderBomForLine(opts) {
  const { pool, id, actor, ip } = opts
  const parsed = parseSyncBomKcaa01(opts.kcaa01)
  if (!parsed.ok) return { ok: false, status: 400, msg: parsed.msg }

  const header = await fetchOrderHeaderForSync(pool, id)
  if (!header) return { ok: false, status: 404, msg: '记录不存在' }

  const stateErr = validateSyncBomOrderState(header)
  if (stateErr) return { ok: false, status: 400, msg: stateErr }

  const piNo = normKcaa01(header.piNo)
  const lineCodes = await fetchOrderLineKcaa01Set(pool, piNo)
  const lineErr = validateSyncBomLineOnOrder(parsed.kcaa01, lineCodes)
  if (lineErr) return { ok: false, status: 400, msg: lineErr }

  try {
    return await writeSyncBomForProductWithDeadlockRetry({
      pool,
      id,
      piNo,
      kcaa01: parsed.kcaa01,
      actor,
      ip,
    })
  } catch (err) {
    return { ok: false, status: 500, msg: formatSyncBomFailureMsg(err) }
  }
}

/**
 * 有限并发批量同步：按列表顺序取款；某款失败则不再启动后续；已在跑的允许跑完。
 * 三路并发只准备主 BOM 树；写入阶段串行且每款独立事务，避免长事务互相锁表。
 * @param {{
 *   pool: import('mssql').ConnectionPool,
 *   id: number,
 *   kcaa01List: unknown,
 *   actor: { uidInt: number | null, uname: string | null, utruename: string | null },
 *   ip: string,
 * }} opts
 */
export async function syncSalesOrderBomBatch(opts) {
  const batchStartedAt = Date.now()
  const { pool, id, actor, ip } = opts
  const parsed = parseSyncBomKcaa01List(opts.kcaa01List)
  if (!parsed.ok) return { ok: false, status: 400, msg: parsed.msg }

  const header = await fetchOrderHeaderForSync(pool, id)
  if (!header) return { ok: false, status: 404, msg: '记录不存在' }

  const stateErr = validateSyncBomOrderState(header)
  if (stateErr) return { ok: false, status: 400, msg: stateErr }

  const piNo = normKcaa01(header.piNo)
  const lineCodes = await fetchOrderLineKcaa01Set(pool, piNo)
  const list = parsed.list
  const syncContext = await createPiBomBatchSyncContext(pool, list)

  const concurrency = SYNC_BOM_BATCH_CONCURRENCY
  /** 写库必须串行，避免同表长事务互相等待；失败不阻塞已开始准备的款完成。 */
  let writeTail = Promise.resolve()
  const enqueueWrite = (run) => {
    const next = writeTail.then(run, run)
    writeTail = next.catch(() => undefined)
    return next
  }

  /** @type {string[]} */
  const succeeded = []
  /** @type {Map<string, any>} */
  const timingByKcaa01 = new Map()
  /** @type {{ kcaa01: string, msg: string } | null} */
  let failed = null
  let stopped = false
  let cursor = 0
  let active = 0

  await new Promise((resolve) => {
    const settleIfDone = () => {
      if (active === 0 && (stopped || cursor >= list.length)) resolve(undefined)
    }

    const launch = () => {
      while (active < concurrency && cursor < list.length && !stopped) {
        const code = list[cursor++]
        active += 1
        ;(async () => {
          const lineErr = validateSyncBomLineOnOrder(code, lineCodes)
          if (lineErr) {
            stopped = true
            if (!failed) failed = { kcaa01: code, msg: lineErr }
            return
          }
          try {
            const prepared = await preparePiBomFromMasterBom(pool, piNo, code, buildActorRow({ ...actor, ip }), syncContext)
            const result = await enqueueWrite(() =>
              writeSyncBomPiOnlyWithDeadlockRetry({
                pool,
                piNo,
                kcaa01: code,
                actor,
                ip,
                syncContext,
                prepared,
              }),
            )
            if (!result.ok) {
              stopped = true
              if (!failed) failed = { kcaa01: code, msg: String(result.msg ?? '同步失败') }
              return
            }
            succeeded.push(code)
            if (result.timing) timingByKcaa01.set(code, result.timing)
          } catch (err) {
            stopped = true
            if (!failed) {
              failed = {
                kcaa01: code,
                msg: formatSyncBomFailureMsg(err),
              }
            }
          }
        })().finally(() => {
          active -= 1
          if (!stopped && cursor < list.length) launch()
          else settleIfDone()
        })
      }
      settleIfDone()
    }

    launch()
  })

  // 有任一款写成功：主表只标一次未运算（与逐款同步业务结果一致）
  let markUncalc = false
  if (succeeded.length > 0) {
    try {
      await withDeadlockRetry(() => markSalesOrderUncalc(pool, { id, actor, ip }))
      markUncalc = true
    } catch (err) {
      // PI BOM 已写入成功，主表标记失败仍告知操作员；前端仍可按 succeeded 刷新
      if (!failed) {
        failed = {
          kcaa01: succeeded[succeeded.length - 1],
          msg: `PI BOM 已同步，但订单未运算标记失败：${formatSyncBomFailureMsg(err)}`,
        }
      }
    }
  }

  // batchDone：请求已受理并跑完队列（含部分失败）；与参数/订单级错误区分
  return {
    batchDone: true,
    ok: !failed,
    piNo,
    succeeded,
    failed,
    markUncalc,
    total: list.length,
    timing: {
      totalMs: Date.now() - batchStartedAt,
      sharedPrefetchMs: Number(syncContext?.timing?.sharedPrefetchMs ?? 0),
      products: list
        .filter((code) => timingByKcaa01.has(code))
        .map((code) => ({ kcaa01: code, ...timingByKcaa01.get(code) })),
    },
  }
}
