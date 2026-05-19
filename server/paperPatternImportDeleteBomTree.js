/**
 * 纸格导入：按主 BOM 的 kcaa01 物理清理 Bom_000 + Bom_parts（含各 CUT 子档下明细）
 * 规则与 buildMainBomCode / buildCutCode 一致：CUT 的 kcaa01 形如 CUT-{类型}{厂款号}/颜色<序号>
 */
import sql from 'mssql'
import { getPool } from './db.js'
import { normalizeErpCodeDisplay } from './paperPatternErpCodeNormalize.js'

const INV_BOM_MASTER_TABLE = (() => {
  const raw = String(process.env.INV_BOM_MASTER_TABLE ?? 'bom_000').trim()
  return /^[A-Za-z0-9_]+$/.test(raw) ? raw : 'bom_000'
})()
const INV_BOM_MASTER_FROM = `dbo.[${INV_BOM_MASTER_TABLE}]`

const INV_BOM_PARTS_TABLE = (() => {
  const raw = String(process.env.INV_BOM_PARTS_TABLE ?? 'Bom_parts').trim()
  return /^[A-Za-z0-9_]+$/.test(raw) ? raw : 'Bom_parts'
})()
const INV_BOM_PARTS_FROM = `dbo.[${INV_BOM_PARTS_TABLE}]`

/**
 * SQL LIKE 中字面匹配 % _ [ ]
 * @param {string} s
 */
export function escapeSqlServerLikeWildcards(s) {
  return String(s ?? '')
    .replace(/\[/g, '[[]')
    .replace(/%/g, '[%]')
    .replace(/_/g, '[_]')
}

/**
 * 从主 BOM kcaa01 解析类型、厂款号、颜色（与 buildMainBomCode 结构一致）
 * @param {string} mainRaw
 * @returns {{ mainKcaa01: string, prefix: string, styleNo: string, colorNo: string } | null}
 */
export function parsePaperPatternMainKcaa01ForDelete(mainRaw) {
  const mainKcaa01 = normalizeErpCodeDisplay(mainRaw)
  if (!mainKcaa01) return null
  const dash = mainKcaa01.indexOf('-')
  if (dash <= 0) return null
  const prefix = mainKcaa01.slice(0, dash).trim()
  const rest = mainKcaa01.slice(dash + 1).trim()
  const slash = rest.indexOf('/')
  if (slash <= 0) return null
  const styleNo = rest.slice(0, slash).trim()
  const colorNo = rest.slice(slash + 1).trim()
  if (!prefix || !styleNo || !colorNo) return null
  if (!/^[A-Za-z0-9]+$/.test(prefix)) return null
  return { mainKcaa01, prefix, styleNo, colorNo }
}

/**
 * 从 CUT 的 kcaa01 反推主 BOM kcaa01（与 buildCutCode / buildMainBomCode 一致）
 * @param {string} cutRaw
 * @returns {string | null}
 */
export function mainKcaa01FromPaperPatternCutKcaa01(cutRaw) {
  const cutKcaa01 = normalizeErpCodeDisplay(cutRaw)
  if (!cutKcaa01 || !cutKcaa01.toUpperCase().startsWith('CUT-')) return null
  const body = cutKcaa01.slice(4)
  const lt = body.indexOf('<')
  if (lt <= 0) return null
  const beforeLt = body.slice(0, lt).trim()
  const slash = beforeLt.indexOf('/')
  if (slash <= 0) return null
  const typeAndStyle = beforeLt.slice(0, slash).trim()
  const colorNo = beforeLt.slice(slash + 1).trim()
  if (!typeAndStyle || !colorNo) return null
  // 导入类型 flag5 通常 2–5 位；按短前缀优先匹配（BAG 先于 BAGPQ）
  const lens = [3, 4, 5, 2, 6].filter((l) => l < typeAndStyle.length)
  for (const len of lens) {
    const prefix = typeAndStyle.slice(0, len)
    const styleNo = typeAndStyle.slice(len)
    if (!/^[A-Za-z][A-Za-z0-9]*$/.test(prefix) || !styleNo) continue
    const candidate = `${prefix}-${styleNo}/${colorNo}`
    if (parsePaperPatternMainKcaa01ForDelete(candidate)) return candidate
  }
  return null
}

/**
 * 主 BOM 或 CUT 的 kcaa01 → 用于删除的「单色」主 BOM kcaa01
 * @param {string} kcaa01Raw
 * @returns {string | null}
 */
export function resolvePaperPatternMainKcaa01ForDeleteFromKcaa01(kcaa01Raw) {
  const kcaa01 = normalizeErpCodeDisplay(kcaa01Raw)
  if (!kcaa01) return null
  if (kcaa01.toUpperCase().startsWith('CUT-')) {
    return mainKcaa01FromPaperPatternCutKcaa01(kcaa01)
  }
  const asMain = parsePaperPatternMainKcaa01ForDelete(kcaa01)
  if (asMain) return asMain.mainKcaa01
  return null
}

/**
 * 与 buildCutCode 生成的 kcaa01 前缀匹配用 LIKE（已转义通配符）
 * @param {{ prefix: string, styleNo: string, colorNo: string }} p
 */
export function buildCutKcaa01LikePatternForDelete(p) {
  const ep = escapeSqlServerLikeWildcards(p.prefix)
  const es = escapeSqlServerLikeWildcards(p.styleNo)
  const ec = escapeSqlServerLikeWildcards(p.colorNo)
  return `CUT-${ep}${es}/${ec}<`
}

/**
 * 规范化请求中的主 BOM 列表（去重、校验）
 * @param {unknown} raw
 * @returns {string[] | null}
 */
export function normalizeMainKcaa01ListForDelete(raw) {
  const arr = Array.isArray(raw) ? raw : []
  const out = []
  const seen = new Set()
  for (const item of arr) {
    const parsed = parsePaperPatternMainKcaa01ForDelete(String(item ?? ''))
    if (!parsed) return null
    const key = parsed.mainKcaa01.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(parsed.mainKcaa01)
  }
  return out.length > 0 ? out : null
}

/**
 * 单事务内：按主 BOM kcaa01 物理删除 Bom_parts + Bom_000（主档 + 纸格 CUT 及下属明细）
 * @param {import('mssql').Transaction} tx
 * @param {string} mainKcaa01Raw 须与 buildMainBomCode 结果一致（如 BAG-PQ2803H1/R-TEST）
 * @returns {Promise<{ mainKcaa01: string, cutKcaa01Like: string, bomPartsDeleted: number, bom000Deleted: number }>}
 */
export async function deletePaperPatternBomTreeByMainKcaa01InTx(tx, mainKcaa01Raw) {
  const parsed = parsePaperPatternMainKcaa01ForDelete(mainKcaa01Raw)
  if (!parsed) {
    throw new Error(
      '主 BOM 编码无法解析：须为「导入类型-厂款号/颜色编码」形式（与页面生成的主 BOM 一致）',
    )
  }
  const cutLikePrefix = `${buildCutKcaa01LikePatternForDelete(parsed)}%`

  const rq1 = new sql.Request(tx)
  rq1.input('mainKcaa01', sql.NVarChar(300), parsed.mainKcaa01)
  rq1.input('cutLike', sql.NVarChar(500), cutLikePrefix)
  const delParts = await rq1.query(`
    DELETE p
    FROM ${INV_BOM_PARTS_FROM} AS p
    WHERE EXISTS (
      SELECT 1
      FROM ${INV_BOM_MASTER_FROM} AS b
      WHERE LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(p.kcac01, N'')))) =
            LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(b.systemcode, N''))))
        AND (
          LTRIM(RTRIM(CONVERT(nvarchar(300), ISNULL(b.kcaa01, N'')))) = @mainKcaa01
          OR LTRIM(RTRIM(CONVERT(nvarchar(300), ISNULL(b.kcaa01, N'')))) LIKE @cutLike
        )
    )
  `)
  const bomPartsDeleted = Number(delParts.rowsAffected?.[0] ?? 0)

  const rq2 = new sql.Request(tx)
  rq2.input('mainKcaa01', sql.NVarChar(300), parsed.mainKcaa01)
  rq2.input('cutLike', sql.NVarChar(500), cutLikePrefix)
  const delM = await rq2.query(`
    DELETE FROM ${INV_BOM_MASTER_FROM}
    WHERE LTRIM(RTRIM(CONVERT(nvarchar(300), ISNULL(kcaa01, N'')))) = @mainKcaa01
       OR LTRIM(RTRIM(CONVERT(nvarchar(300), ISNULL(kcaa01, N'')))) LIKE @cutLike
  `)
  const bom000Deleted = Number(delM.rowsAffected?.[0] ?? 0)

  return {
    mainKcaa01: parsed.mainKcaa01,
    cutKcaa01Like: cutLikePrefix,
    bomPartsDeleted,
    bom000Deleted,
  }
}

/**
 * 单事务内：按多个主 BOM kcaa01 依次删除（仅精确编码，不用款号 LIKE）
 * @param {import('mssql').Transaction} tx
 * @param {string[]} mainKcaa01List
 */
export async function deletePaperPatternBomTreesByMainKcaa01ListInTx(tx, mainKcaa01List) {
  /** @type {Array<{ mainKcaa01: string, cutKcaa01Like: string, bomPartsDeleted: number, bom000Deleted: number }>} */
  const perColor = []
  let bomPartsDeleted = 0
  let bom000Deleted = 0
  for (const main of mainKcaa01List) {
    const rep = await deletePaperPatternBomTreeByMainKcaa01InTx(tx, main)
    perColor.push(rep)
    bomPartsDeleted += rep.bomPartsDeleted
    bom000Deleted += rep.bom000Deleted
  }
  return {
    mode: 'mainKcaa01List',
    mainKcaa01s: perColor.map((r) => r.mainKcaa01),
    perColor,
    bomPartsDeleted,
    bom000Deleted,
  }
}

/**
 * 由 bom_000.systemcode（或 Bom_parts.kcac01）解析出待删的「单色」主 BOM kcaa01
 * @param {import('mssql').ConnectionPool | import('mssql').Transaction} db
 * @param {string} systemcodeRaw
 */
export async function resolveMainKcaa01ForDeleteBySystemcode(db, systemcodeRaw) {
  const systemcode = String(systemcodeRaw ?? '').trim()
  if (!systemcode) return null
  const rq = db instanceof sql.Transaction ? new sql.Request(db) : new sql.Request(db)
  rq.input('systemcode', sql.NVarChar(100), systemcode)
  const rs = await rq.query(`
    SELECT TOP 1
      LTRIM(RTRIM(CONVERT(nvarchar(300), ISNULL(kcaa01, N'')))) AS kcaa01
    FROM ${INV_BOM_MASTER_FROM}
    WHERE LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(systemcode, N'')))) = @systemcode
  `)
  const row = rs.recordset?.[0]
  const kcaa01 = String(row?.kcaa01 ?? '').trim()
  if (!kcaa01) return null
  return resolvePaperPatternMainKcaa01ForDeleteFromKcaa01(kcaa01)
}

/**
 * POST /api/paper-pattern/import/delete-bom-tree
 * body:
 *   - { systemcode } 仅删该 systemcode 对应的一色（安全，不用款号 %）
 *   - { mainKcaa01 } 仅删该主 BOM 一色（兼容）
 *   - { mainKcaa01s: string[] } 仅删列表中的主 BOM（本次解析多色）
 */
export async function handlePostPaperPatternImportDeleteBomTree(req, res) {
  try {
    const body = req.body ?? {}
    const systemcode = String(body.systemcode ?? body.kcac01 ?? '').trim()
    const mainList = normalizeMainKcaa01ListForDelete(body.mainKcaa01s)
    const mainSingle = parsePaperPatternMainKcaa01ForDelete(String(body.mainKcaa01 ?? '').trim())

    const pool = await getPool()
    let deletePlan = null

    if (mainList) {
      deletePlan = { kind: 'list', mainKcaa01s: mainList }
    } else if (systemcode) {
      const mainFromSc = await resolveMainKcaa01ForDeleteBySystemcode(pool, systemcode)
      if (!mainFromSc) {
        res.status(400).json({
          success: false,
          message:
            '未找到对应 Bom_000 主档，或 kcaa01 无法解析为主 BOM（请确认 systemcode / Bom_parts.kcac01 有效）',
        })
        return
      }
      deletePlan = {
        kind: 'systemcode',
        systemcode,
        mainKcaa01: mainFromSc,
      }
    } else if (mainSingle) {
      deletePlan = { kind: 'mainKcaa01', mainKcaa01: mainSingle.mainKcaa01 }
    } else {
      res.status(400).json({
        success: false,
        message:
          '请提供 systemcode（或 kcac01）、主 BOM 编码 mainKcaa01，或本次待删主 BOM 列表 mainKcaa01s',
      })
      return
    }

    const tx = new sql.Transaction(pool)
    await tx.begin()
    try {
      let stats
      if (deletePlan.kind === 'list') {
        stats = await deletePaperPatternBomTreesByMainKcaa01ListInTx(tx, deletePlan.mainKcaa01s)
      } else {
        const mainKcaa01 =
          deletePlan.kind === 'systemcode' ? deletePlan.mainKcaa01 : deletePlan.mainKcaa01
        const one = await deletePaperPatternBomTreeByMainKcaa01InTx(tx, mainKcaa01)
        stats = {
          mode: deletePlan.kind,
          systemcode: deletePlan.kind === 'systemcode' ? deletePlan.systemcode : undefined,
          mainKcaa01: one.mainKcaa01,
          mainKcaa01s: [one.mainKcaa01],
          perColor: [one],
          cutKcaa01Like: one.cutKcaa01Like,
          bomPartsDeleted: one.bomPartsDeleted,
          bom000Deleted: one.bom000Deleted,
        }
      }
      await tx.commit()
      console.log('[paper-pattern-import-delete-bom-tree]', JSON.stringify(stats))
      res.json({
        success: true,
        message:
          deletePlan.kind === 'list'
            ? `已按 ${stats.mainKcaa01s.length} 个主 BOM 物理删除（不含其它颜色）`
            : '已按主 BOM 物理删除关联的 Bom_parts 与 Bom_000 行（仅该颜色）',
        data: stats,
      })
    } catch (e) {
      try {
        await tx.rollback()
      } catch (rb) {
        console.error('[paper-pattern-import-delete-bom-tree] rollback 失败：', rb)
      }
      throw e
    }
  } catch (e) {
    console.error('POST /api/paper-pattern/import/delete-bom-tree 失败：', e)
    const detail = String(e?.message ?? e?.originalError?.message ?? e ?? '')
    res.status(500).json({
      success: false,
      message: `删除失败：${detail}`,
      data: { detail },
    })
  }
}
