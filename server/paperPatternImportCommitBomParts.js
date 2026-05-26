/**
 * 纸格正式导入：Bom_parts 写入编排（主 BOM：CUT 预览 + Accessory；各 CUT：同分组 Material）
 */
import { erpCodeLookupKey, normalizeErpCodeDisplay } from './paperPatternErpCodeNormalize.js'
import { fetchKcaa04Kcaa33ByKcaa01In } from './paperPatternMaterialBomFields.js'
import {
  buildPaperPatternBomPartsPrefetch,
  getBomPartsColumnSetForPaperPattern,
  getBomPartsColumnDataKindForPaperPattern,
  getBomPartsDelColumnKindForPaperPattern,
  getBomPartsColumnKindsForPaperPattern,
  insertBomPartsLinePaperPattern,
  PAPER_PATTERN_BOM_PARTS_PASS_DEFAULT,
} from './bomPartsLinePersist.js'

import { cutSeqMajorForMaterialGroup } from './paperPatternMaterialGroupMatching.js'

/** CUT 预览行写入 Bom_parts.remark（纸格导入裁片） */
export const PAPER_PATTERN_CUT_BOM_PARTS_REMARK = '纸格系统导入'

/** 纸格 Bom_parts 默认版本号 */
export const PAPER_PATTERN_BOM_PARTS_VERSION = 100

/** 与 bomPartsLinePersist 一致：纸格写入 Bom_parts.pass 默认已审核 */
export { PAPER_PATTERN_BOM_PARTS_PASS_DEFAULT }

/**
 * @param {string} cutSeq 如 3-1
 * @returns {string} 段号 3
 */
export function cutMajorFromCutSeq(cutSeq) {
  return cutSeqMajorForMaterialGroup(cutSeq)
}

/**
 * 同一主段号（如 4-1、4-2 的 4）下：取 CUT 列表中首条非空「搭配」，供子序号行与物料子件同步 Describe
 * @param {Array<{ cutSeq?: string, matching?: string }>} cuts
 * @returns {Map<string, string>}
 */
export function buildCutMatchingByMajorFirstNonEmpty(cuts) {
  /** @type {Map<string, string>} */
  const map = new Map()
  if (!Array.isArray(cuts)) return map
  for (const c of cuts) {
    const maj = cutMajorFromCutSeq(String(c?.cutSeq ?? '').trim())
    if (!maj) continue
    const m = String(c?.matching ?? '').trim()
    if (m && !map.has(maj)) map.set(maj, m)
  }
  return map
}

/**
 * CUT 行写入 Bom_parts.Describe：优先本行搭配；空则同步同主段号下父级（首条非空搭配）
 * @param {string} cutSeq
 * @param {unknown} directMatching
 * @param {Map<string, string>} matchingByMajor
 */
export function resolveCutDescribeForBomParts(cutSeq, directMatching, matchingByMajor) {
  const dm = String(directMatching ?? '').trim()
  if (dm) return dm
  const maj = cutMajorFromCutSeq(String(cutSeq ?? '').trim())
  if (!maj || !(matchingByMajor instanceof Map)) return ''
  return String(matchingByMajor.get(maj) ?? '').trim()
}

/**
 * @param {string|number} groupNo
 * @param {string} cutSeq
 */
export function materialGroupMatchesCut(groupNo, cutSeq) {
  return String(groupNo ?? '').trim() === cutMajorFromCutSeq(cutSeq)
}

/**
 * Material 列表全局序号：与纸格导入页 Material 表顺序一致（同编码取首次出现）
 * @param {Array<{ materialCode?: string }>} materials
 * @returns {Map<string, number>} erpCodeLookupKey → 1-based Seq
 */
export function buildMaterialGlobalSeqMap(materials) {
  /** @type {Map<string, number>} */
  const map = new Map()
  if (!Array.isArray(materials)) return map
  let seq = 0
  for (const m of materials) {
    const code = normalizeErpCodeDisplay(m?.materialCode ?? '')
    if (!code) continue
    const key = erpCodeLookupKey(code)
    if (!key || map.has(key)) continue
    seq += 1
    map.set(key, seq)
  }
  return map
}

/** @param {unknown} raw */
export function parsePaperPatternQty(raw) {
  const n = Number(String(raw ?? '').replace(/,/g, '').trim())
  return Number.isFinite(n) ? n : 0
}

/**
 * CUT 下子件 Bom_parts.kcac04：取 CUT 列表「单位用量」（非 CUT 预览行的数量，亦非物料表用量）
 * @param {unknown} unitConsumptionRaw CUT 行 unitConsumption
 */
export function cutChildKcac04FromUnitConsumption(unitConsumptionRaw) {
  return bomPartRound6(parsePaperPatternQty(unitConsumptionRaw))
}

/**
 * 纸格单元格：非空则解析为数字，否则 null（用于 I 列合计是否覆盖 kcac06）
 * @param {unknown} raw
 * @returns {number|null}
 */
function parseOptionalDecimalCell(raw) {
  const s = String(raw ?? '').replace(/,/g, '').trim()
  if (s === '') return null
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

/**
 * Accessory E 列用量：空则沿用旧默认 1
 * @param {unknown} raw
 */
function accessoryUsageQtyForKcac04(raw) {
  const s = String(raw ?? '').replace(/,/g, '').trim()
  if (s === '') return 1
  return parsePaperPatternQty(raw)
}

function bomPartRound6(n) {
  if (!Number.isFinite(n)) return 0
  return Math.round(n * 1e6) / 1e6
}

/**
 * Bom_000 采购价/BOM价 → Bom_parts：六位小数；库内空/无效为 null（不写 0）
 * @param {number|null|undefined} raw
 * @returns {number|null}
 */
export function bom000PriceToBomPartsOrNull(raw) {
  if (raw === null || raw === undefined) return null
  const n = Number(raw)
  if (!Number.isFinite(n)) return null
  return bomPartRound6(n)
}

/** Excel 单元格视为空 */
function isExcelCellEmpty(raw) {
  const s = String(raw ?? '').replace(/,/g, '').trim()
  return s === ''
}

/**
 * 辅料 H 列损耗：空为 0；末尾带 % 按百分比为小数；否则按小数比例解析
 * @param {unknown} raw
 */
export function parseAccessoryWastageFraction(raw) {
  const s = String(raw ?? '').replace(/,/g, '').trim()
  if (s === '') return 0
  if (/%\s*$/.test(s)) {
    const n = Number(s.replace(/%\s*$/, '').trim())
    return Number.isFinite(n) ? n / 100 : 0
  }
  const n = Number(s)
  return Number.isFinite(n) ? n : 0
}

/**
 * 辅料 E/H/I 与 Bom_000.kcaa33 得到 kcac04/kcac05/kcac06FromExcel（六位小数）
 * 损耗与合计皆空时：kcac05=库内 kcaa33（缺省 0），kcac06 由插入层按 kcac04*(1+kcac05) 计算
 * @param {unknown} usageRaw
 * @param {unknown} wastageRaw
 * @param {unknown} lineTotalRaw
 * @param {number|null|undefined} dbKcaa33
 */
export function resolveAccessoryKcac456(usageRaw, wastageRaw, lineTotalRaw, dbKcaa33) {
  const kcac04 = bomPartRound6(accessoryUsageQtyForKcac04(usageRaw))
  const wEmpty = isExcelCellEmpty(wastageRaw)
  const iEmpty = isExcelCellEmpty(lineTotalRaw)
  if (wEmpty && iEmpty) {
    const dbLoss =
      dbKcaa33 !== null && dbKcaa33 !== undefined && Number.isFinite(Number(dbKcaa33))
        ? Number(dbKcaa33)
        : 0
    return { kcac04, kcac05: bomPartRound6(dbLoss), kcac06FromExcel: undefined }
  }
  const kcac05 = bomPartRound6(parseAccessoryWastageFraction(wastageRaw))
  const lt = parseOptionalDecimalCell(lineTotalRaw)
  const kcac06FromExcel = lt != null ? bomPartRound6(lt) : undefined
  return { kcac04, kcac05, kcac06FromExcel }
}

export function resolveMaterialWastageFraction(wastageFraction, dbKcaa33) {
  if (
    wastageFraction !== undefined &&
    wastageFraction !== null &&
    Number.isFinite(Number(wastageFraction))
  ) {
    return bomPartRound6(wastageFraction)
  }
  return dbKcaa33 !== null && dbKcaa33 !== undefined && Number.isFinite(Number(dbKcaa33))
    ? bomPartRound6(dbKcaa33)
    : 0
}

/**
 * @param {import('mssql').Transaction} tx
 * @param {import('mssql').ConnectionPool} pool
 * @param {{
 *   mainSystemcode: string,
 *   cutsResolved: Array<{
 *     cutSeq: string,
 *     cutCode: string,
 *     quantity?: string|number,
 *     unitConsumption?: string|number,
 *     wastage?: string|number,
 *     matching?: string,
 *   }>,
 *   cutSystemcodeByCutCode: Map<string, string>,
 *   accessories: Array<{
 *     erpCode?: string,
 *     accessoryName?: string,
 *     usageQty?: string|number,
 *     wastage?: string|number,
 *     lineTotal?: string|number,
 *     matching?: string,
 *   }>,
 *   materials: Array<{
 *     groupNo?: string|number,
 *     materialCode?: string,
 *     remark?: string,
 *     usageQty?: string|number,
 *     wastageFraction?: number | null,
 *   }>,
 *   actor: { uidInt: number | null, uname: string | null, utruename: string | null },
 *   addtime: string,
 *   bomMap?: Map<string, {
 *     kcaa04: string,
 *     kcaa33: number | null,
 *     kcaa02_en: string,
 *     location: string,
 *     cost_price: number | null,
 *     sale_price: number | null,
 *     remark: string,
 *   }>,
 * }} p
 * @returns {Promise<number>} 写入行数
 */
export async function writePaperPatternBomPartsInTx(tx, pool, p) {
  const partColset = await getBomPartsColumnSetForPaperPattern(pool)
  if (!partColset.has('kcac01') || !partColset.has('kcaa01')) {
    throw new Error('Bom_parts 表缺少必需列 kcac01/kcaa01，无法写入纸格配件')
  }
  const delColKind = await getBomPartsDelColumnKindForPaperPattern(pool)
  const passColKind = await getBomPartsColumnDataKindForPaperPattern(pool, 'pass')
  const columnKinds = await getBomPartsColumnKindsForPaperPattern(pool)

  const mainSc = String(p.mainSystemcode ?? '').trim()
  if (!mainSc) throw new Error('主 BOM systemcode 为空')

  const partsAudit = {
    actor: p.actor ?? { uidInt: null, uname: null, utruename: null },
    addtime: String(p.addtime ?? '').trim(),
  }

  const cuts = Array.isArray(p.cutsResolved) ? p.cutsResolved : []
  const acc = Array.isArray(p.accessories) ? p.accessories : []
  const mats = Array.isArray(p.materials) ? p.materials : []
  const cutScMap = p.cutSystemcodeByCutCode instanceof Map ? p.cutSystemcodeByCutCode : new Map()

  /** @type {Map<string, { kcaa04: string, kcaa33: number | null, kcaa02_en: string, location: string, cost_price: number | null, sale_price: number | null, remark: string }>} */
  let bomMap = p.bomMap instanceof Map ? p.bomMap : null
  if (!bomMap) {
    /** @type {string[]} */
    const matCodes = []
    for (const m of mats) {
      const d = normalizeErpCodeDisplay(m?.materialCode ?? '')
      if (d) matCodes.push(d)
    }
    for (const a of acc) {
      const d = normalizeErpCodeDisplay(a?.erpCode ?? '')
      if (d) matCodes.push(d)
    }
    bomMap = await fetchKcaa04Kcaa33ByKcaa01In(tx, matCodes)
  }

  let inserted = 0

  const cutMatchingByMajor = buildCutMatchingByMajorFirstNonEmpty(cuts)
  const materialGlobalSeqMap = buildMaterialGlobalSeqMap(mats)
  const materialGlobalSeqMax = materialGlobalSeqMap.size

  /** @type {string[]} */
  const codesForPrefetch = []
  for (const c of cuts) {
    const cutCode = normalizeErpCodeDisplay(c?.cutCode ?? '')
    if (cutCode) codesForPrefetch.push(cutCode)
  }
  for (const a of acc) {
    const code = normalizeErpCodeDisplay(a?.erpCode ?? '')
    if (code) codesForPrefetch.push(code)
  }
  for (const m of mats) {
    const code = normalizeErpCodeDisplay(m?.materialCode ?? '')
    if (code) codesForPrefetch.push(code)
  }
  const tPrefetch0 = Date.now()
  const paperPatternPrefetch = {
    ...(await buildPaperPatternBomPartsPrefetch(tx, codesForPrefetch)),
    columnKinds,
  }

  // 主 BOM：CUT 预览每行 → 子件为裁片 BOM 编码；Seq=0
  for (const c of cuts) {
    const cutCode = String(c.cutCode ?? '').trim()
    if (!cutCode) continue
    const qty = parsePaperPatternQty(c.quantity)
    const describeCut = resolveCutDescribeForBomParts(c.cutSeq, c.matching, cutMatchingByMajor)
    const kcaa04Cut = '张'
    await insertBomPartsLinePaperPattern(
      tx,
      partColset,
      delColKind,
      passColKind,
      mainSc,
      {
        kcaa01: cutCode,
        kcac04: qty,
        remark: PAPER_PATTERN_CUT_BOM_PARTS_REMARK,
        seq: 0,
        describe: describeCut,
        kcac03FromMaster: kcaa04Cut,
        useNullKcac05AndKcac06: true,
        nullPrices: true,
        version: PAPER_PATTERN_BOM_PARTS_VERSION,
      },
      partsAudit,
      paperPatternPrefetch,
    )
    inserted += 1
  }

  // 主 BOM：Accessory；Seq 自 1 递增（E/H/I 来自纸格解析；I 空则 kcac06 按公式）
  let accSeq = 1
  for (const a of acc) {
    const code = normalizeErpCodeDisplay(a?.erpCode ?? '')
    if (!code) continue
    const key = erpCodeLookupKey(code)
    const row = key ? bomMap.get(key) : null
    const { kcac04, kcac05, kcac06FromExcel } = resolveAccessoryKcac456(
      a?.usageQty,
      a?.wastage,
      a?.lineTotal,
      row?.kcaa33,
    )
    const accDescribe = String(a?.matching ?? '').trim()
    const accRemark = row ? String(row.remark ?? '').trim() : ''
    const accCost = row ? bom000PriceToBomPartsOrNull(row.cost_price) : null
    const accSale = row ? bom000PriceToBomPartsOrNull(row.sale_price) : null
    await insertBomPartsLinePaperPattern(
      tx,
      partColset,
      delColKind,
      passColKind,
      mainSc,
      {
        kcaa01: code,
        kcac04,
        kcac05,
        kcac06FromExcel,
        remark: accRemark,
        cost_price: accCost,
        sale_price: accSale,
        seq: materialGlobalSeqMax + accSeq,
        describe: accDescribe,
        kcac03FromMaster: row?.kcaa04 ?? '',
        kcaa02EnFromBom000: String(row?.kcaa02_en ?? '').trim(),
        locationFromBom000: String(row?.location ?? '').trim(),
        version: PAPER_PATTERN_BOM_PARTS_VERSION,
      },
      partsAudit,
      paperPatternPrefetch,
    )
    accSeq += 1
    inserted += 1
  }

  // 各 CUT：同分组 Material
  for (const c of cuts) {
    const cutCode = String(c.cutCode ?? '').trim()
    const cutSeq = String(c.cutSeq ?? '').trim()
    const parentSc = cutScMap.get(cutCode)
    if (!parentSc || !cutSeq) continue

    const groupMats = mats.filter((m) => materialGroupMatchesCut(m?.groupNo, cutSeq))
    for (const m of groupMats) {
      const code = normalizeErpCodeDisplay(m?.materialCode ?? '')
      if (!code) continue
      const key = erpCodeLookupKey(code)
      const row = key ? bomMap.get(key) : null
      const loss = resolveMaterialWastageFraction(m.wastageFraction, row?.kcaa33)
      const kcac04Child = cutChildKcac04FromUnitConsumption(c.unitConsumption)
      const remark = String(m.remark ?? '').trim()
      const describeMat = resolveCutDescribeForBomParts(cutSeq, c.matching, cutMatchingByMajor)
      const globalSeq = key ? materialGlobalSeqMap.get(key) : null
      await insertBomPartsLinePaperPattern(
        tx,
        partColset,
        delColKind,
        passColKind,
        parentSc,
        {
          kcaa01: code,
          kcac04: kcac04Child,
          kcac05: loss,
          remark,
          seq: globalSeq != null && Number.isFinite(Number(globalSeq)) ? Number(globalSeq) : 999999,
          describe: describeMat,
          kcac03FromMaster: row?.kcaa04 ?? '',
          version: PAPER_PATTERN_BOM_PARTS_VERSION,
        },
        partsAudit,
        paperPatternPrefetch,
      )
      inserted += 1
    }
  }

  console.log(
    '[paper-pattern-import-commit] bomPartsInserted',
    inserted,
    JSON.stringify({
      uid: partsAudit.actor.uidInt,
      uname: partsAudit.actor.uname,
      utruename: partsAudit.actor.utruename,
      addtime: partsAudit.addtime,
      prefetchMs: Date.now() - tPrefetch0,
      prefetchCodes: codesForPrefetch.length,
    }),
  )
  return inserted
}
