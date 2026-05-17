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
 * POST /api/paper-pattern/import/delete-bom-tree
 * body: { mainKcaa01: string }
 */
export async function handlePostPaperPatternImportDeleteBomTree(req, res) {
  try {
    const mainRaw = String(req.body?.mainKcaa01 ?? '').trim()
    const parsed = parsePaperPatternMainKcaa01ForDelete(mainRaw)
    if (!parsed) {
      res.status(400).json({
        success: false,
        message:
          '主 BOM 编码无效：须为「导入类型-厂款号/颜色编码」形式（与页面生成的主 BOM 一致，如 BAG-PQ2803H1/R-TEST）；厂款号段不含「/」',
      })
      return
    }
    const pool = await getPool()
    const tx = new sql.Transaction(pool)
    await tx.begin()
    try {
      const stats = await deletePaperPatternBomTreeByMainKcaa01InTx(tx, parsed.mainKcaa01)
      await tx.commit()
      console.log('[paper-pattern-import-delete-bom-tree]', JSON.stringify(stats))
      res.json({
        success: true,
        message: '已按主 BOM 物理删除关联的 Bom_parts 与 Bom_000 行',
        data: {
          mainKcaa01: stats.mainKcaa01,
          cutKcaa01Like: stats.cutKcaa01Like,
          bomPartsDeleted: stats.bomPartsDeleted,
          bom000Deleted: stats.bom000Deleted,
        },
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
