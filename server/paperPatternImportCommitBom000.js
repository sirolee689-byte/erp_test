/**
 * 纸格导入：正式写入 Bom_000（主 BOM + 各 CUT）与 Bom_parts，单事务
 */
import crypto from 'node:crypto'
import path from 'node:path'
import sql from 'mssql'
import { getPool } from './db.js'
import { getActorAuditTripletFromReq } from './businessAuditFields.js'
import { resolveSysUsersTruenameByUsercode } from './sysUsersDb.js'
import { getRequestIp } from './operationAuditMiddleware.js'
import {
  buildCutCode,
  buildMainBomCode,
  normalizeFactoryStyleForEncoding,
} from './paperPatternImportParse.js'
import { classifyErpCodesAgainstBom000 } from './paperPatternCheckMaterial.js'
import { normalizeErpCodeDisplay } from './paperPatternErpCodeNormalize.js'
import { deletePaperPatternBomTreeByMainKcaa01InTx } from './paperPatternImportDeleteBomTree.js'
import { filterAccessoriesForCommitColor } from './paperPatternAccessoryParse.js'
import { writePaperPatternBomPartsInTx } from './paperPatternImportCommitBomParts.js'
import { fetchKcaa04Kcaa33ByKcaa01In } from './paperPatternMaterialBomFields.js'
import {
  collectMaterialErpCodesForAllColors,
  resolveCommitColorNos,
  resolveMaterialsForCommitColor,
  validateMaterialCodesByColorForCommit,
} from './paperPatternMaterialCodesByColor.js'
import { resolveUploadedPaperPatternFile } from './paperPatternImportPreview.js'
import {
  extractProjectNameFromTruefilename,
  insertPaperPatternSystemUploadFileInTx,
  pickPaperPatternArchiveFilename,
  renamePaperPatternUploadToArchive,
} from './paperPatternSystemUploadFile.js'

const INV_BOM_MASTER_TABLE = (() => {
  const raw = String(process.env.INV_BOM_MASTER_TABLE ?? 'bom_000').trim()
  return /^[A-Za-z0-9_]+$/.test(raw) ? raw : 'bom_000'
})()
const INV_BOM_MASTER_FROM = `dbo.[${INV_BOM_MASTER_TABLE}]`

/** 与 index.js 纸格导入一致：Bom_code 表名可由环境变量覆盖 */
const INV_BOM_CODE_TABLE = (() => {
  const raw = String(process.env.INV_BOM_CODE_TABLE ?? 'Bom_code').trim()
  return /^[A-Za-z0-9_]+$/.test(raw) ? raw : 'Bom_code'
})()
const INV_BOM_CODE_FROM = `dbo.[${INV_BOM_CODE_TABLE}]`

/** 与 index.js 中 formatBomColorcodeTimestamp 一致 */
function formatBomColorcodeTimestamp(date = new Date()) {
  const d = date instanceof Date ? date : new Date(date)
  const pad2 = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()} ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`
}

/** 与 index.js 中 generateInvBomSystemcode 一致 */
function generateInvBomSystemcode(uidPart) {
  const uid = String(uidPart ?? '').trim() || '0'
  const d = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  const ymd = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`
  const rnd = `${Date.now()}_${crypto.randomBytes(12).toString('hex')}_${uid}`
  const md5 = crypto.createHash('md5').update(rnd, 'utf8').digest('hex')
  const tail = (uid.replace(/\D/g, '').slice(-6) || uid.slice(0, 8)).replace(/\s+/g, '')
  const raw = `${ymd}${md5.slice(0, 22)}${tail}`
  return raw.slice(0, 88)
}

/**
 * CUT 规格 kcaa03：长*宽，各保留 4 位小数（与纸格解析长/宽规范一致）
 * @param {string|number|null|undefined} lenStr
 * @param {string|number|null|undefined} widStr
 */
export function formatPaperPatternCutKcaa03(lenStr, widStr) {
  const parseN = (x) => {
    const n = Number(String(x ?? '').replace(/,/g, '').trim())
    return Number.isFinite(n) ? n : 0
  }
  const L = parseN(lenStr)
  const W = parseN(widStr)
  return `${L.toFixed(4)}*${W.toFixed(4)}`
}

/**
 * 主 BOM / 裁片 kcaa03（主袋「款色路径」）与 kcaa09 用：保留厂款号中的横线（与 kcaa01 编码用去横线不同）。
 * 规则：去 *、去空白；不去横线。
 * @param {string|number|null|undefined} s
 */
export function normalizeFactoryStyleForBomPathDisplay(s) {
  return String(s ?? '')
    .replace(/\uFEFF/g, '')
    .replace(/\*/g, '')
    .replace(/\s+/g, '')
    .trim()
}

/**
 * 按 Bom_code.flag5 取 flag1（导入类型中文名，写入主 BOM kcaa02）
 * @param {import('mssql').ConnectionPool} pool
 * @param {string} flag5
 */
async function fetchBomCodeFlag1ByFlag5(pool, flag5) {
  const f5 = String(flag5 ?? '').trim()
  if (!f5) return ''
  const r = await pool.request().input('flag5', sql.NVarChar(200), f5).query(`
    SELECT TOP (1)
      LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(bc.flag1, N'')))) AS flag1
    FROM ${INV_BOM_CODE_FROM} AS bc
    WHERE bc.id <> 1
      AND LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(bc.flag5, N'')))) = @flag5
  `)
  return String(r.recordset?.[0]?.flag1 ?? '').trim()
}

async function getInvBomMasterColumnSetForCommit(pool) {
  const r = await pool.request().input('tn', sql.NVarChar(128), INV_BOM_MASTER_TABLE).query(`
    SELECT COLUMN_NAME AS name
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = N'dbo' AND TABLE_NAME = @tn
  `)
  const set = new Set()
  for (const row of r.recordset ?? []) {
    const n = String(row?.name ?? '').trim()
    if (n) set.add(n.toLowerCase())
  }
  return set
}

/**
 * 生成 Bom_000 三连键用 systemcode（与 GUID、dr_systemcode 同值）。
 * 不再对每条 CUT 查库验重：MD5+时间+随机+序号碰撞概率可忽略，且避免 CUT 多时触发 requestTimeout。
 * @param {string|number|null|undefined} actorUidPart
 * @param {number} seq 本次导入内递增序号（主 BOM=1，CUT 自 2 起）
 */
function allocatePaperPatternBomSystemcode(actorUidPart, seq) {
  const uid = String(actorUidPart ?? '').trim() || '0'
  const salt = `${Date.now()}_${seq}_${process.hrtime.bigint()}_${crypto.randomBytes(8).toString('hex')}`
  return generateInvBomSystemcode(`${uid}_${salt}`)
}

/** 在册：del 为空或 0 */
const ACTIVE_DEL_WHERE = `(ISNULL(b.del, N'') = N'' OR LTRIM(RTRIM(ISNULL(CONVERT(nvarchar(20), b.del), N''))) = N'0')`

/** 纸格导入 Bom_000：CUT 等子档 pass 默认已审核 */
export const PAPER_PATTERN_BOM000_PASS_DEFAULT = '1'
/** 纸格导入主 BOM：未审核 */
export const PAPER_PATTERN_BOM000_PASS_MAIN = '0'

/**
 * Bom_000 审计列：列存在则写入（uid 无有效登录时为 NULL；uname/utruename 允许空串）
 * @param {Set<string>} colset
 * @param {import('mssql').Request} ins
 * @param {string[]} cols
 * @param {string[]} vals
 * @param {{ actor: { uidInt: number | null, uname: string | null, utruename: string | null }, addtime: string, ip?: string }} audit
 */
export function appendBom000PaperPatternAuditColumns(colset, ins, cols, vals, audit) {
  const actor = audit?.actor ?? { uidInt: null, uname: null, utruename: null }
  const addtime = String(audit?.addtime ?? '').trim()
  const ip = String(audit?.ip ?? '').trim()

  if (colset.has('uid')) {
    cols.push('uid')
    vals.push('@ins_uid')
    const uidRaw = actor.uidInt
    const uidInt =
      uidRaw != null && Number.isFinite(Number(uidRaw)) && Number(uidRaw) > 0
        ? Math.trunc(Number(uidRaw))
        : null
    ins.input('ins_uid', sql.Int, uidInt)
  }
  if (colset.has('uname')) {
    cols.push('uname')
    vals.push('@ins_uname')
    const uname = String(actor.uname ?? '').trim()
    ins.input('ins_uname', sql.NVarChar(50), uname || null)
  }
  if (colset.has('utruename')) {
    cols.push('utruename')
    vals.push('@ins_utruename')
    const utruename = String(actor.utruename ?? '').trim()
    ins.input('ins_utruename', sql.NVarChar(50), utruename || null)
  }
  if (colset.has('addtime') && addtime) {
    cols.push('addtime')
    vals.push('@ins_addtime')
    ins.input('ins_addtime', sql.NVarChar(50), addtime)
  }
  if (colset.has('edittime') && addtime) {
    cols.push('edittime')
    vals.push('@ins_edittime')
    ins.input('ins_edittime', sql.NVarChar(50), addtime)
  }
  if (colset.has('ip')) {
    cols.push('ip')
    vals.push('@ins_ip')
    ins.input('ins_ip', sql.NVarChar(80), ip)
  }
}

/**
 * @param {import('mssql').Transaction} tx
 * @param {string} kcaa01
 */
async function countActiveKcaa01InTx(tx, kcaa01) {
  const code = String(kcaa01 ?? '').trim()
  if (!code) return 0
  const r = await new sql.Request(tx).input('kcaa01', sql.NVarChar(300), code).query(`
    SELECT COUNT(1) AS cnt
    FROM ${INV_BOM_MASTER_FROM} AS b
    WHERE LTRIM(RTRIM(CONVERT(nvarchar(300), ISNULL(b.kcaa01, N'')))) = @kcaa01
      AND ${ACTIVE_DEL_WHERE}
  `)
  return Number(r.recordset?.[0]?.cnt ?? 0)
}

/**
 * @param {import('mssql').Transaction} tx
 * @param {string[]} codes 已 trim 的 kcaa01
 * @returns {Promise<string[]>} 已存在（在册）的编码列表（原样显示顺序按输入首次出现）
 */
async function findExistingKcaa01AmongInTx(tx, codes) {
  const uniq = [...new Set(codes.map((c) => String(c ?? '').trim()).filter(Boolean))]
  if (uniq.length === 0) return []
  const existing = []
  const seen = new Set()
  const chunk = 60
  for (let off = 0; off < uniq.length; off += chunk) {
    const slice = uniq.slice(off, off + chunk)
    const rq = new sql.Request(tx)
    const parts = []
    for (let j = 0; j < slice.length; j++) {
      const pname = `c${off}_${j}`
      rq.input(pname, sql.NVarChar(300), slice[j])
      parts.push(`@${pname}`)
    }
    const rs = await rq.query(`
      SELECT LTRIM(RTRIM(CONVERT(nvarchar(300), ISNULL(b.kcaa01, N'')))) AS k1
      FROM ${INV_BOM_MASTER_FROM} AS b
      WHERE ${ACTIVE_DEL_WHERE}
        AND LTRIM(RTRIM(CONVERT(nvarchar(300), ISNULL(b.kcaa01, N'')))) IN (${parts.join(', ')})
    `)
    for (const row of rs.recordset ?? []) {
      const k1 = String(row.k1 ?? '').trim()
      if (k1 && !seen.has(k1)) {
        seen.add(k1)
        existing.push(k1)
      }
    }
  }
  return existing
}

/**
 * @param {import('mssql').Transaction} tx
 * @param {Set<string>} colset
 * @param {{
 *   systemcodeTriple: string,
 *   kcaa01: string,
 *   kcaa02: string,
 *   kcaa03: string,
 *   kcaa04: string,
 *   kcaa05: string,
 *   kcaa06: string,
 *   kcaa07: string,
 *   kcaa08: string,
 *   kcaa09: string,
 *   kcaa10: string,
 *   kcaa11: string,
 *   kcaa14: number,
 *   kcaa15: string,
 *   kcaa25: string,
 *   kcaa26: number,
 *   kcaa27: number,
 *   cost_price?: number|null,
 *   sale_price?: number|null,
 *   passChar?: '0' | '1',
 *   remark: string,
 *   addtime: string,
 *   ip: string,
 *   actor: { uidInt: number | null, uname: string | null, utruename: string | null },
 * }} row
 */
async function insertBom000PaperPatternRow(tx, colset, row) {
  const passVal = row.passChar != null && row.passChar !== '' ? String(row.passChar) : PAPER_PATTERN_BOM000_PASS_DEFAULT
  const cols = []
  const vals = []
  const ins = new sql.Request(tx)

  ins.input('bom_sc_triple', sql.NVarChar(100), row.systemcodeTriple)
  cols.push('systemcode', '[GUID]', 'dr_systemcode')
  vals.push('@bom_sc_triple', '@bom_sc_triple', '@bom_sc_triple')

  if (colset.has('version')) {
    ins.input('bom_version_ins', sql.Int, 100)
    cols.push('[version]')
    vals.push('@bom_version_ins')
  }
  // 纸格导入：Bom_000.[type] 显式写入 NULL，不使用默认 1
  if (colset.has('type')) {
    ins.input('bom_type_ins', sql.Int, null)
    cols.push('[type]')
    vals.push('@bom_type_ins')
  }

  const pushNv = (col, param, val, len) => {
    if (!colset.has(col.toLowerCase())) return
    const phys = col === 'decimal' ? '[decimal]' : col
    cols.push(phys)
    vals.push(`@${param}`)
    ins.input(param, sql.NVarChar(len), val ?? '')
  }

  pushNv('kcaa01', 'ins_kcaa01', row.kcaa01, 300)
  pushNv('kcaa02', 'ins_kcaa02', row.kcaa02, 500)
  pushNv('kcaa03', 'ins_kcaa03', row.kcaa03, 500)
  pushNv('kcaa04', 'ins_kcaa04', row.kcaa04, 100)
  pushNv('kcaa05', 'ins_kcaa05', row.kcaa05, 200)
  pushNv('kcaa06', 'ins_kcaa06', row.kcaa06, 300)
  pushNv('kcaa09', 'ins_kcaa09', row.kcaa09, 300)
  pushNv('kcaa10', 'ins_kcaa10', row.kcaa10, 200)
  pushNv('kcaa11', 'ins_kcaa11', row.kcaa11, 200)
  pushNv('kcaa15', 'ins_kcaa15', row.kcaa15, 50)
  pushNv('kcaa25', 'ins_kcaa25', row.kcaa25, 100)
  pushNv('remark', 'ins_remark', row.remark, 2000)
  pushNv('decimal', 'ins_bom_decimal', row.decimalStr || '3', 20)

  if (colset.has('kcaa07')) {
    cols.push('kcaa07')
    vals.push('@ins_kcaa07')
    ins.input('ins_kcaa07', sql.NVarChar(50), row.kcaa07)
  }
  if (colset.has('kcaa08')) {
    cols.push('kcaa08')
    vals.push('@ins_kcaa08')
    ins.input('ins_kcaa08', sql.NVarChar(50), row.kcaa08)
  }

  if (colset.has('kcaa14')) {
    cols.push('kcaa14')
    vals.push('@ins_kcaa14')
    ins.input('ins_kcaa14', sql.Int, row.kcaa14)
  }
  if (colset.has('kcaa26')) {
    cols.push('kcaa26')
    vals.push('@ins_kcaa26')
    ins.input('ins_kcaa26', sql.Decimal(18, 6), row.kcaa26)
  }
  if (colset.has('kcaa27')) {
    cols.push('kcaa27')
    vals.push('@ins_kcaa27')
    ins.input('ins_kcaa27', sql.Int, row.kcaa27)
  }
  if (colset.has('cost_price')) {
    cols.push('cost_price')
    vals.push('@ins_cost_price')
    const cp =
      row.cost_price === null || row.cost_price === undefined
        ? null
        : Number(row.cost_price)
    ins.input('ins_cost_price', sql.Decimal(18, 6), Number.isFinite(cp) ? cp : null)
  }
  if (colset.has('sale_price')) {
    cols.push('sale_price')
    vals.push('@ins_sale_price')
    const sp =
      row.sale_price === null || row.sale_price === undefined
        ? null
        : Number(row.sale_price)
    ins.input('ins_sale_price', sql.Decimal(18, 6), Number.isFinite(sp) ? sp : null)
  }

  if (colset.has('pass')) {
    cols.push('pass')
    vals.push('@ins_pass')
    ins.input('ins_pass', sql.NVarChar(10), passVal)
  }
  if (colset.has('del')) {
    cols.push('del')
    vals.push("N'0'")
  }
  if (colset.has('back')) {
    cols.push('back')
    vals.push('@ins_back')
    ins.input('ins_back', sql.Int, 0)
  }
  if (colset.has('is_pur')) {
    cols.push('is_pur')
    vals.push('@ins_is_pur')
    ins.input('ins_is_pur', sql.Int, 0)
  }

  appendBom000PaperPatternAuditColumns(colset, ins, cols, vals, {
    actor: row.actor,
    addtime: row.addtime,
    ip: row.ip,
  })

  if (!cols.length) {
    throw new Error('bom_000 无可用插入列')
  }

  const qr = await ins.query(`
    INSERT INTO ${INV_BOM_MASTER_FROM} (${cols.join(', ')})
    VALUES (${vals.join(', ')})
  `)
  if ((qr.rowsAffected?.[0] ?? 0) <= 0) {
    throw new Error('INSERT bom_000 未写入行')
  }
}

/**
 * 按颜色生成 CUT 写入行（cutCode 含 colorNo）
 * @param {unknown[]} cutsIn
 * @param {{ importTypeFlag5: string, styleNo: string, colorNo: string }} ctx
 */
export function resolveCutsResolvedForColor(cutsIn, ctx) {
  const importTypeFlag5 = String(ctx.importTypeFlag5 ?? '').trim()
  const styleNo = String(ctx.styleNo ?? '').trim()
  const colorNo = String(ctx.colorNo ?? '').trim()
  const clearanceOrder = ctx.clearanceOrder
  return (Array.isArray(cutsIn) ? cutsIn : []).map((c) => {
    const cutSeq = String(c?.cutSeq ?? '').trim()
    const cutName = String(c?.cutName ?? c?.cutNameDisplay ?? '').trim()
    const cutCode = buildCutCode({ importTypeFlag5, styleNo, colorNo, cutSeq, clearanceOrder })
    const kcaa03Cut = formatPaperPatternCutKcaa03(c?.length, c?.width)
    return {
      cutSeq,
      cutName,
      cutCode,
      kcaa03Cut,
      length: c?.length,
      width: c?.width,
      quantity: c?.quantity,
      unitConsumption: c?.unitConsumption,
      wastage: c?.wastage,
      matching: c?.matching,
    }
  })
}

/**
 * POST /api/paper-pattern/import/commit-bom000
 * body: { fileId, truefilename?, importTypeFlag5, colorNos[]|colorNo, factoryStyleNo, cuts[], materials[]（含 codesByColor）, accessories?, overwrite? }
 * 多色：单事务依次写入各主 BOM / CUT / Bom_parts（Material 子件按列全码；Accessory 按 colorNo 写入对应主 BOM）。
 */
export async function handlePostPaperPatternImportCommitBom000(req, res) {
  try {
    const body = req.body ?? {}
    const overwrite = body.overwrite === true || body.overwrite === 'true' || body.overwrite === 1
    const erpSmartCheckAcknowledged =
      body.erpSmartCheckAcknowledged === true ||
      body.erpSmartCheckAcknowledged === 'true' ||
      body.erpSmartCheckAcknowledged === 1
    if (!erpSmartCheckAcknowledged) {
      res.status(400).json({
        success: false,
        code: 'ERP_SMART_CHECK_REQUIRED',
        message: '请先完成智能校验后再正式导入',
      })
      return
    }
    const importTypeFlag5 = String(body.importTypeFlag5 ?? '').trim()
    const clearanceOrder =
      body.clearanceOrder === true || body.clearanceOrder === 'true' || body.clearanceOrder === 1
    const factoryStyleNo = String(body.factoryStyleNo ?? '').trim()
    const customerStyleNo = String(body.customerStyleNo ?? '').trim()
    const groupLabel = String(body.groupLabel ?? '').trim()
    const colorNos = resolveCommitColorNos(body)
    const cutsIn = Array.isArray(body.cuts) ? body.cuts : []
    const accessoriesIn = Array.isArray(body.accessories) ? body.accessories : []
    const materialsIn = Array.isArray(body.materials) ? body.materials : []
    const fileId = String(body.fileId ?? '').trim()
    const truefilename = String(body.truefilename ?? '').trim()

    if (!fileId) {
      res.status(400).json({ success: false, message: '缺少已上传 Excel 的 fileId' })
      return
    }
    const uploadedSourcePath = resolveUploadedPaperPatternFile(fileId)
    if (!uploadedSourcePath) {
      res.status(400).json({
        success: false,
        message: '未找到已上传的 Excel 文件，请重新上传后再正式导入',
      })
      return
    }

    if (!importTypeFlag5) {
      res.status(400).json({ success: false, message: '缺少导入类型 importTypeFlag5' })
      return
    }
    const styleNo = normalizeFactoryStyleForEncoding(factoryStyleNo)
    if (!styleNo) {
      res.status(400).json({ success: false, message: '厂款号无效或为空（编码用）' })
      return
    }
    if (colorNos.length === 0) {
      res.status(400).json({ success: false, message: '缺少颜色编码（请确认第 4 行 N 列起已填写）' })
      return
    }
    if (cutsIn.length > 5000 || materialsIn.length > 8000 || accessoriesIn.length > 2000) {
      res.status(400).json({ success: false, message: 'cuts / materials / accessories 数量超出限制' })
      return
    }

    const mainBomCodes = colorNos.map((colorNo) =>
      buildMainBomCode({ importTypeFlag5, styleNo, colorNo, clearanceOrder }),
    )
    if (mainBomCodes.some((c) => !c)) {
      res.status(400).json({ success: false, message: '无法生成主 BOM 编码（请检查导入类型、厂款号、颜色编码）' })
      return
    }

    const materialCellCheck = validateMaterialCodesByColorForCommit(materialsIn, colorNos)
    if (!materialCellCheck.ok) {
      res.status(400).json({
        success: false,
        code: materialCellCheck.code,
        message: materialCellCheck.message,
        data: materialCellCheck.data,
      })
      return
    }

    const pool = await getPool()

    let importTypeFlag1 = String(body.importTypeFlag1 ?? '').trim()
    if (!importTypeFlag1) {
      importTypeFlag1 = await fetchBomCodeFlag1ByFlag5(pool, importTypeFlag5)
    }
    if (!importTypeFlag1) {
      res.status(400).json({
        success: false,
        message: '无法读取导入类型名称（Bom_code.flag1），请检查导入类型是否有效',
      })
      return
    }

    const stylePathDisplay = normalizeFactoryStyleForBomPathDisplay(factoryStyleNo)
    if (!stylePathDisplay) {
      res.status(400).json({ success: false, message: '厂款号无效或为空（款色路径用）' })
      return
    }

    const cutsByColor = colorNos.map((colorNo) =>
      resolveCutsResolvedForColor(cutsIn, { importTypeFlag5, styleNo, colorNo, clearanceOrder }),
    )
    const badCut = cutsByColor.flat().find((x) => !x.cutCode || !x.cutSeq)
    if (badCut) {
      res.status(400).json({ success: false, message: '存在无效的 CUT 行（缺少序号或无法生成 CUT 编码）' })
      return
    }

    const erpCodesToVerify = collectMaterialErpCodesForAllColors(materialsIn, colorNos)
    for (const a of accessoriesIn) {
      const code = normalizeErpCodeDisplay(a?.erpCode ?? '')
      if (code) erpCodesToVerify.push(code)
    }

    const matCheck = await classifyErpCodesAgainstBom000(pool, erpCodesToVerify)
    if (matCheck.failed.length > 0) {
      const failedNonEmpty = matCheck.failed.filter((x) => String(x ?? '').trim())
      const msg =
        failedNonEmpty.length > 0
          ? `以下 ERP 编码在 Bom_000 中不存在：${failedNonEmpty.join('、')}`
          : '存在无效的物料或 Accessory 编码'
      res.status(400).json({
        success: false,
        code: 'MATERIAL_OR_ACCESSORY_MISSING',
        message: msg,
        data: { missing: failedNonEmpty },
      })
      return
    }

    const colset = await getInvBomMasterColumnSetForCommit(pool)
    const needCols = ['systemcode', 'guid', 'dr_systemcode', 'version']
    const miss = needCols.filter((c) => !colset.has(c))
    if (miss.length) {
      res.status(500).json({
        success: false,
        message: `bom_000 缺少必需列：${miss.join(', ')}，无法写入`,
      })
      return
    }

    const actor = getActorAuditTripletFromReq(req)
    const loginUsercode = String(req.user?.userCode ?? '').trim()
    const bomUtruename = await resolveSysUsersTruenameByUsercode(pool, loginUsercode)
    const actorForBom = { ...actor, utruename: bomUtruename }
    const commitDate = new Date()
    const clientIp = String(getRequestIp(req) ?? '').trim()

    const uploadExt = path.extname(uploadedSourcePath).toLowerCase()
    const archiveTruefilename = truefilename || `upload${uploadExt}`
    let archiveMeta
    try {
      archiveMeta = pickPaperPatternArchiveFilename(commitDate, uploadExt)
    } catch (e) {
      const code = String(e?.message ?? '')
      if (code === 'ARCHIVE_FILENAME_COLLISION') {
        res.status(409).json({
          success: false,
          message: '归档文件名冲突（同一秒内已有同名文件），请稍后重试',
        })
        return
      }
      throw e
    }
    const addtime = formatBomColorcodeTimestamp(archiveMeta.addtimeDate)
    const archiveAddtime = addtime
    const projectName = extractProjectNameFromTruefilename(archiveTruefilename)

    /** Material 全码 + Accessory：事务外批量查主档，避免多色重复扫库、且不含 CUT 编码 */
    const erpCodesForBomFields = collectMaterialErpCodesForAllColors(materialsIn, colorNos)
    for (const a of accessoriesIn) {
      const code = normalizeErpCodeDisplay(a?.erpCode ?? '')
      if (code) erpCodesForBomFields.push(code)
    }
    const bomMapPrefetched = await fetchKcaa04Kcaa33ByKcaa01In(pool, erpCodesForBomFields)

    const transaction = new sql.Transaction(pool)
    await transaction.begin()
    try {
      const existingMains = []
      for (const mainKcaa01 of mainBomCodes) {
        if ((await countActiveKcaa01InTx(transaction, mainKcaa01)) > 0) {
          existingMains.push(mainKcaa01)
        }
      }
      if (existingMains.length > 0 && !overwrite) {
        await transaction.rollback()
        res.status(400).json({
          success: false,
          code: 'MAIN_BOM_EXISTS',
          message: `主 BOM 已存在：${existingMains.join('、')}。如需覆盖请先确认（将删除各主 BOM、相关 CUT 及 Bom_parts 后重新导入）。`,
          data: { mainBomCodes: existingMains, mainBomCode: existingMains[0] },
        })
        return
      }

      /** @type {Array<{ mainKcaa01: string, cutKcaa01Like: string, bomPartsDeleted: number, bom000Deleted: number }>} */
      const overwriteReplacedList = []
      if (overwrite) {
        for (const mainKcaa01 of mainBomCodes) {
          const rep = await deletePaperPatternBomTreeByMainKcaa01InTx(transaction, mainKcaa01)
          overwriteReplacedList.push(rep)
          console.log('[paper-pattern-import-commit] overwriteDeleted', JSON.stringify(rep))
        }
      }

      const allCutCodes = cutsByColor.flat().map((c) => c.cutCode)
      const existingCuts = await findExistingKcaa01AmongInTx(transaction, allCutCodes)
      if (existingCuts.length > 0) {
        await transaction.rollback()
        res.status(400).json({
          success: false,
          code: 'CUT_EXISTS',
          message: `以下 CUT 编码已存在：${existingCuts.join('、')}`,
          data: { existingCuts },
        })
        return
      }

      let archiveFilesizeBytes
      try {
        archiveFilesizeBytes = renamePaperPatternUploadToArchive(
          uploadedSourcePath,
          archiveMeta.targetPath,
        )
      } catch (e) {
        await transaction.rollback()
        console.error('[paper-pattern-import-commit] 归档重命名失败：', e)
        res.status(500).json({ success: false, message: '归档 Excel 文件失败，请重新上传后再试' })
        return
      }

      let systemcodeSeq = 0
      const nextSystemcode = () => {
        systemcodeSeq += 1
        return allocatePaperPatternBomSystemcode(actor.uidInt ?? actor.uname ?? '', systemcodeSeq)
      }

      const kcaa02Main = importTypeFlag1
      let bomPartsInsertedTotal = 0
      let cutCountTotal = 0

      for (let ci = 0; ci < colorNos.length; ci++) {
        const colorNo = colorNos[ci]
        const mainKcaa01 = mainBomCodes[ci]
        const kcaa03PathDisplay = `${stylePathDisplay}/${colorNo}`
        const cutsResolved = cutsByColor[ci]
        const materialsForColor = resolveMaterialsForCommitColor(materialsIn, colorNo)

        const mainTriple = nextSystemcode()
        console.log(
          '[paper-pattern-import-commit] mainBomInsert',
          JSON.stringify({
            kcaa01: mainKcaa01,
            kcaa02: kcaa02Main,
            kcaa03: kcaa03PathDisplay,
            kcaa11: colorNo,
            colorIndex: ci + 1,
            colorTotal: colorNos.length,
          }),
        )

        await insertBom000PaperPatternRow(transaction, colset, {
          systemcodeTriple: mainTriple,
          kcaa01: mainKcaa01,
          kcaa02: kcaa02Main,
          kcaa03: kcaa03PathDisplay,
          kcaa04: 'PC',
          kcaa05: '02',
          kcaa06: customerStyleNo,
          kcaa07: '0',
          kcaa08: '0',
          kcaa09: kcaa03PathDisplay,
          kcaa10: groupLabel,
          kcaa11: colorNo,
          kcaa14: 1,
          kcaa15: '',
          kcaa25: 'PC',
          kcaa26: 1,
          kcaa27: 0,
          passChar: PAPER_PATTERN_BOM000_PASS_MAIN,
          remark: '纸格系统导入',
          addtime,
          ip: clientIp,
          decimalStr: '3',
          actor: actorForBom,
        })

        const cutSystemcodeByCutCode = new Map()
        for (const c of cutsResolved) {
          const cutTriple = nextSystemcode()
          cutSystemcodeByCutCode.set(c.cutCode, cutTriple)
          console.log(
            '[paper-pattern-import-commit] cutInsert',
            JSON.stringify({ kcaa01: c.cutCode, kcaa03: c.kcaa03Cut, colorNo }),
          )

          await insertBom000PaperPatternRow(transaction, colset, {
            systemcodeTriple: cutTriple,
            kcaa01: c.cutCode,
            kcaa02: c.cutName || c.cutCode,
            kcaa03: c.kcaa03Cut,
            kcaa04: '张',
            kcaa05: '02',
            kcaa06: customerStyleNo,
            kcaa07: '0',
            kcaa08: '0',
            kcaa09: kcaa03PathDisplay,
            kcaa10: groupLabel,
            kcaa11: '-',
            kcaa14: 1,
            kcaa15: '04',
            kcaa25: '张',
            kcaa26: 1,
            kcaa27: 0,
            cost_price: null,
            sale_price: null,
            passChar: PAPER_PATTERN_BOM000_PASS_DEFAULT,
            remark: '纸格系统导入',
            addtime,
            ip: clientIp,
            decimalStr: '3',
            actor: actorForBom,
          })
        }

        cutCountTotal += cutsResolved.length

        const partsInserted = await writePaperPatternBomPartsInTx(transaction, pool, {
          mainSystemcode: mainTriple,
          cutsResolved,
          cutSystemcodeByCutCode,
          accessories: filterAccessoriesForCommitColor(accessoriesIn, colorNo),
          materials: materialsForColor,
          actor: actorForBom,
          addtime,
          bomMap: bomMapPrefetched,
        })
        bomPartsInsertedTotal += partsInserted
      }

      await insertPaperPatternSystemUploadFileInTx(transaction, {
        actor,
        addtime: archiveAddtime,
        ip: clientIp,
        filename: archiveMeta.filename,
        filepath: archiveMeta.filepath,
        filesizeBytes: archiveFilesizeBytes,
        truefilename: archiveTruefilename,
        projectName,
      })

      await transaction.commit()
      res.json({
        success: true,
        message: '导入成功',
        data: {
          mainBomCode: mainBomCodes[0],
          mainBomCodes,
          colorCount: colorNos.length,
          cutCount: cutCountTotal,
          cutCountPerColor: cutsIn.length,
          bomPartsInserted: bomPartsInsertedTotal,
          overwrite: Boolean(overwrite),
          overwriteReplaced: overwriteReplacedList.length === 1 ? overwriteReplacedList[0] : overwriteReplacedList,
          uploadArchive: {
            filename: archiveMeta.filename,
            truefilename: archiveTruefilename,
            filepath: archiveMeta.filepath,
            addtime: archiveAddtime,
          },
        },
      })
    } catch (e) {
      try {
        await transaction.rollback()
      } catch (rb) {
        console.error('[paper-pattern-import-commit] rollback 失败：', rb)
      }
      throw e
    }
  } catch (e) {
    console.error('POST /api/paper-pattern/import/commit-bom000 失败：', e)
    const detail = String(e?.message ?? e?.originalError?.message ?? '写入失败')
    res.status(500).json({ success: false, message: detail })
  }
}
