/**
 * BOM 主档「一键更新」：按物料编码将 bom_000 最新基础资料批量写回 Bom_parts / bom_cost 引用行（不改用量）
 */
import sql from 'mssql'
import { getBomCostColumnSet } from './bomCostEnrichFromBom000.js'

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

const BOM_COST_TABLE = (() => {
  const raw = String(process.env.BOM_COST_TABLE ?? 'bom_cost').trim()
  return /^[A-Za-z0-9_]+$/.test(raw) ? raw : 'bom_cost'
})()
const BOM_COST_FROM = `dbo.[${BOM_COST_TABLE}]`

/** 与 index.js / bomPartsLinePersist 一致 */
export const BOM_PARTS_KCAA_SYNC_NAMES = Array.from({ length: 35 }, (_, i) =>
  `kcaa${String(i + 1).padStart(2, '0')}`,
)

/** bom_cost 一键更新可覆盖列（不含用量、树父级、运算键） */
const BOM_COST_PROPAGATE_SPECS = [
  { col: 'kcaa02', expr: (a) => `${a}.[kcaa02]` },
  { col: 'kcaa03', expr: (a) => `${a}.[kcaa03]` },
  { col: 'kcaa02_en', expr: (a) => `${a}.[kcaa02_en]` },
  { col: 'kcaa04', expr: (a) => `${a}.[kcaa04]` },
  { col: 'kcac03', expr: (a) => `${a}.[kcaa04]` },
  { col: 'kcaa05', expr: (a) => `${a}.[kcaa05]` },
  { col: 'kcaa11', expr: (a) => `${a}.[kcaa11]` },
  { col: 'kcaa12', expr: (a) => `${a}.[kcaa12]` },
  { col: 'kcaa13', expr: (a) => `${a}.[kcaa13]` },
  { col: 'kcaa14', expr: (a) => `${a}.[kcaa14]` },
  { col: 'kcaa25', expr: (a) => `${a}.[kcaa25]` },
  { col: 'kcaa26', expr: (a) => `${a}.[kcaa26]` },
  { col: 'kcaa27', expr: (a) => `${a}.[kcaa27]` },
  { col: 'kcaa28', expr: (a) => `${a}.[kcaa28]` },
  { col: 'kcaa29', expr: (a) => `${a}.[kcaa29]` },
  { col: 'kcaa30', expr: (a) => `${a}.[kcaa30]` },
  { col: 'kcaa31', expr: (a) => `${a}.[kcaa31]` },
  { col: 'kcaa32', expr: (a) => `${a}.[kcaa32]` },
  { col: 'kcaa33', expr: (a) => `${a}.[kcaa33]` },
  { col: 'kcaa34', expr: (a) => `${a}.[kcaa34]` },
  { col: 'kcaa35', expr: (a) => `${a}.[kcaa35]` },
  { col: 'location', expr: (a) => `${a}.[location]` },
  { col: 'remark', expr: (a) => `${a}.[remark]` },
  { col: 'Customer_Name', expr: (a) => `${a}.[Customer_Name]` },
  { col: 'sale_price', expr: (a) => `${a}.[sale_price]` },
  { col: 'cost_price', expr: (a) => `${a}.[cost_price]` },
  { col: 'type', expr: (a) => `${a}.[type]` },
  { col: 'version', expr: (a) => `${a}.[version]` },
]

let INV_BOM_PARTS_COLSET_PROMISE = null
let BOM_COST_HAS_DEL_PROMISE = null

/**
 * @param {import('mssql').ConnectionPool} pool
 */
async function getInvBomPartsColumnSet(pool) {
  if (INV_BOM_PARTS_COLSET_PROMISE) return INV_BOM_PARTS_COLSET_PROMISE
  const tbl = INV_BOM_PARTS_TABLE
  INV_BOM_PARTS_COLSET_PROMISE = (async () => {
    try {
      const r = await pool.request().input('tn', sql.NVarChar(128), tbl).query(`
        SELECT LOWER(COLUMN_NAME) AS col
        FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = N'dbo' AND TABLE_NAME = @tn
      `)
      return new Set((r.recordset || []).map((row) => String(row.col ?? '').trim()).filter(Boolean))
    } catch {
      return new Set()
    }
  })()
  return INV_BOM_PARTS_COLSET_PROMISE
}

/**
 * @param {import('mssql').ConnectionPool} pool
 */
async function getBomCostHasDelColumn(pool) {
  if (BOM_COST_HAS_DEL_PROMISE) return BOM_COST_HAS_DEL_PROMISE
  BOM_COST_HAS_DEL_PROMISE = (async () => {
    try {
      const r = await pool.request().input('tn', sql.NVarChar(128), BOM_COST_TABLE).query(`
        SELECT 1 AS x
        FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = N'dbo' AND TABLE_NAME = @tn AND COLUMN_NAME = N'del'
      `)
      return (r.recordset?.length ?? 0) > 0
    } catch {
      return false
    }
  })()
  return BOM_COST_HAS_DEL_PROMISE
}

function bom000NumericColSql(colName) {
  const c = String(colName ?? '').trim()
  return `CASE
          WHEN b.[${c}] IS NULL THEN NULL
          WHEN ISNUMERIC(LTRIM(RTRIM(CONVERT(nvarchar(100), b.[${c}])))) = 1
            THEN CONVERT(float, LTRIM(RTRIM(CONVERT(nvarchar(100), b.[${c}]))))
          ELSE NULL
        END`
}

function bom000IntColSql(colName) {
  const c = String(colName ?? '').trim()
  return `CASE
          WHEN b.[${c}] IS NULL THEN NULL
          WHEN ISNUMERIC(LTRIM(RTRIM(CONVERT(nvarchar(100), b.[${c}])))) = 1
            THEN CONVERT(int, LTRIM(RTRIM(CONVERT(nvarchar(100), b.[${c}]))))
          ELSE NULL
        END`
}

/** 源主档 CROSS APPLY（按 systemcode 取在册 TOP 1） */
function sqlSourceBom000CrossApply(alias = 'src') {
  // kcaa01 已在下方单独 LTRIM/RTRIM 选出，避免与 kcaa02～35 循环重复列名
  const kcaaSelect = BOM_PARTS_KCAA_SYNC_NAMES.filter((c) => c !== 'kcaa01')
    .map((c) => `b.[${c}]`)
    .join(',\n        ')
  return `CROSS APPLY (
      SELECT TOP 1
        LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(b.systemcode, N'')))) AS sub_systemcode,
        LTRIM(RTRIM(CONVERT(nvarchar(300), ISNULL(b.kcaa01, N'')))) AS kcaa01,
        LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(b.kcaa02_en, N'')))) AS kcaa02_en,
        LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(b.location, N'')))) AS location,
        LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(b.remark, N'')))) AS remark,
        LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(b.Customer_Name, N'')))) AS Customer_Name,
        ${bom000NumericColSql('sale_price')} AS sale_price,
        ${bom000NumericColSql('cost_price')} AS cost_price,
        ${bom000IntColSql('type')} AS type,
        ${bom000IntColSql('version')} AS version,
        ${kcaaSelect}
      FROM ${INV_BOM_MASTER_FROM} AS b
      WHERE LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(b.systemcode, N'')))) =
            LTRIM(RTRIM(CONVERT(nvarchar(100), @sourceSc)))
        AND (ISNULL(b.del, N'') = N'' OR LTRIM(RTRIM(ISNULL(CONVERT(nvarchar(20), b.del), N''))) = N'0')
      ORDER BY b.id DESC
    ) AS ${alias}`
}

/**
 * @param {Set<string>} partColset
 * @param {string} alias
 */
export function buildBomPartsPropagateSetClauses(partColset, alias = 'src') {
  const setParts = []
  for (const col of BOM_PARTS_KCAA_SYNC_NAMES) {
    if (!partColset.has(col)) continue
    setParts.push(`p.[${col}] = ${alias}.[${col}]`)
  }
  if (partColset.has('kcac02')) {
    setParts.push(
      `p.[kcac02] = ISNULL(NULLIF(LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(${alias}.sub_systemcode, N'')))), N''), p.[kcac02])`,
    )
  }
  if (partColset.has('systemcode')) {
    setParts.push(
      `p.[systemcode] = ISNULL(NULLIF(LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(${alias}.sub_systemcode, N'')))), N''), p.[systemcode])`,
    )
  }
  if (partColset.has('kcaa02_en')) {
    setParts.push(`p.[kcaa02_en] = ${alias}.[kcaa02_en]`)
  }
  if (partColset.has('location')) {
    setParts.push(`p.[location] = ${alias}.[location]`)
  }
  return setParts
}

/**
 * @param {Set<string>} costColset
 * @param {string} alias
 */
export function buildBomCostPropagateSetClauses(costColset, alias = 'src', targetAlias = 'c') {
  const setParts = []
  for (const spec of BOM_COST_PROPAGATE_SPECS) {
    if (!costColset.has(spec.col)) continue
    const rhs = spec.expr(alias)
    const colSql =
      spec.col === 'type'
        ? `${targetAlias}.[type]`
        : spec.col === 'Customer_Name'
          ? `${targetAlias}.[Customer_Name]`
          : `${targetAlias}.[${spec.col}]`
    setParts.push(`${colSql} = ${rhs}`)
  }
  return setParts
}

/**
 * @param {import('mssql').ConnectionPool | import('mssql').Transaction} poolOrTx
 * @param {string} sourceSystemcode
 * @param {Set<string>} partColset
 */
export async function propagateBom000ToBomPartsByMaterialCode(poolOrTx, sourceSystemcode, partColset) {
  const setParts = buildBomPartsPropagateSetClauses(partColset)
  if (!setParts.length) return 0

  const q = new sql.Request(poolOrTx)
  q.input('sourceSc', sql.NVarChar(100), sourceSystemcode)
  const ur = await q.query(`
    UPDATE p
    SET ${setParts.join(', ')}
    FROM ${INV_BOM_PARTS_FROM} AS p
    ${sqlSourceBom000CrossApply('src')}
    WHERE LTRIM(RTRIM(CONVERT(nvarchar(300), ISNULL(p.kcaa01, N'')))) =
          LTRIM(RTRIM(CONVERT(nvarchar(300), ISNULL(src.kcaa01, N''))))
      AND (ISNULL(p.del, N'') = N'' OR LTRIM(RTRIM(ISNULL(CONVERT(nvarchar(20), p.del), N''))) = N'0')
  `)
  return Number(ur.rowsAffected?.[0] ?? 0)
}

/**
 * @param {import('mssql').ConnectionPool | import('mssql').Transaction} poolOrTx
 * @param {string} sourceSystemcode
 * @param {Set<string>} costColset
 * @param {boolean} costHasDel
 */
export async function propagateBom000ToBomCostByMaterialCode(
  poolOrTx,
  sourceSystemcode,
  costColset,
  costHasDel,
) {
  const setParts = buildBomCostPropagateSetClauses(costColset)
  if (!setParts.length) return 0

  const delFilter = costHasDel
    ? `AND (ISNULL(c.del, N'') = N'' OR LTRIM(RTRIM(ISNULL(CONVERT(nvarchar(20), c.del), N''))) = N'0')`
    : ''

  const q = new sql.Request(poolOrTx)
  q.input('sourceSc', sql.NVarChar(100), sourceSystemcode)
  const ur = await q.query(`
    UPDATE c
    SET ${setParts.join(', ')}
    FROM ${BOM_COST_FROM} AS c
    ${sqlSourceBom000CrossApply('src')}
    WHERE LTRIM(RTRIM(CONVERT(nvarchar(300), ISNULL(c.kcaa01, N'')))) =
          LTRIM(RTRIM(CONVERT(nvarchar(300), ISNULL(src.kcaa01, N''))))
      ${delFilter}
  `)
  return Number(ur.rowsAffected?.[0] ?? 0)
}

/**
 * POST /api/inventory/bom/propagate-master
 * body: { systemcode }
 */
export async function handlePostBomMasterPropagate(req, res, deps) {
  const getPoolFn = deps?.getPool ?? (async () => {
    throw new Error('getPool required')
  })
  const writeLogFn = deps?.writeLog

  try {
    const sourceSc = String(req.body?.systemcode ?? '').trim()
    if (!sourceSc) {
      res.status(400).json({ code: 400, msg: '参数错误：systemcode 不能为空', data: null })
      return
    }

    const pool = await getPoolFn()
    const headRs = await pool.request().input('sc', sql.NVarChar(100), sourceSc).query(`
      SELECT TOP 1
        LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(b.systemcode, N'')))) AS systemcode,
        LTRIM(RTRIM(CONVERT(nvarchar(300), ISNULL(b.kcaa01, N'')))) AS kcaa01,
        LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(b.kcaa02, N'')))) AS kcaa02
      FROM ${INV_BOM_MASTER_FROM} AS b
      WHERE LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(b.systemcode, N'')))) = @sc
        AND (ISNULL(b.del, N'') = N'' OR LTRIM(RTRIM(ISNULL(CONVERT(nvarchar(20), b.del), N''))) = N'0')
      ORDER BY b.id DESC
    `)
    const head = headRs.recordset?.[0]
    if (!head?.systemcode) {
      res.status(404).json({ code: 404, msg: '未找到在册 BOM 主档或缺少 systemcode', data: null })
      return
    }
    const materialCode = String(head.kcaa01 ?? '').trim()
    if (!materialCode) {
      res.status(400).json({ code: 400, msg: '主档缺少物料编码 kcaa01，无法一键更新', data: null })
      return
    }

    const partColset = await getInvBomPartsColumnSet(pool)
    const costColset = await getBomCostColumnSet(pool)
    const costHasDel = await getBomCostHasDelColumn(pool)

    const tx = new sql.Transaction(pool)
    await tx.begin()
    let partsUpdated = 0
    let costUpdated = 0
    try {
      partsUpdated = await propagateBom000ToBomPartsByMaterialCode(tx, sourceSc, partColset)
      costUpdated = await propagateBom000ToBomCostByMaterialCode(tx, sourceSc, costColset, costHasDel)
      await tx.commit()
    } catch (innerErr) {
      try {
        await tx.rollback()
      } catch {
        // ignore
      }
      throw innerErr
    }

    if (writeLogFn) {
      try {
        await writeLogFn(
          req,
          'BOM主档一键更新',
          `[一键更新]物料编码：[${materialCode}]，同步配件明细 ${partsUpdated} 条、成本运算缓存 ${costUpdated} 条（用量未改、未重算）。`,
          { targetTable: 'Bom_parts' },
        )
      } catch (logErr) {
        console.warn('[BOM一键更新] 审计写入失败（不影响结果）：', logErr?.message ?? logErr)
      }
    }

    res.json({
      code: 200,
      msg: 'success',
      data: {
        materialCode,
        partsUpdated,
        costUpdated,
        /** 与提示文案「子件记录」一致：配件明细行数 */
        totalParts: partsUpdated,
      },
    })
  } catch (err) {
    console.error('POST /api/inventory/bom/propagate-master 失败：', err)
    const detail = String(err?.message ?? err?.originalError?.message ?? '数据库更新失败')
    res.status(500).json({ code: 500, msg: `一键更新失败：${detail}`, data: null })
  }
}
