/**
 * 纸格正式导入：Bom_parts 写入编排（主 BOM：CUT 预览 + Accessory；各 CUT：同分组 Material）
 */
import { erpCodeLookupKey, normalizeErpCodeDisplay } from './paperPatternErpCodeNormalize.js'
import { fetchKcaa04Kcaa33ByKcaa01In } from './paperPatternMaterialBomFields.js'
import {
  getBomPartsColumnSetForPaperPattern,
  getBomPartsDelColumnKindForPaperPattern,
  insertBomPartsLinePaperPattern,
} from './bomPartsLinePersist.js'

/**
 * @param {string} cutSeq 如 3-1
 * @returns {string} 段号 3
 */
export function cutMajorFromCutSeq(cutSeq) {
  const s = String(cutSeq ?? '').trim()
  const i = s.indexOf('-')
  if (i <= 0) return ''
  return s.slice(0, i)
}

/**
 * @param {string|number} groupNo
 * @param {string} cutSeq
 */
export function materialGroupMatchesCut(groupNo, cutSeq) {
  return String(groupNo ?? '').trim() === cutMajorFromCutSeq(cutSeq)
}

/** @param {unknown} raw */
export function parsePaperPatternQty(raw) {
  const n = Number(String(raw ?? '').replace(/,/g, '').trim())
  return Number.isFinite(n) ? n : 0
}

/** @param {unknown} raw */
function parseWastageFraction(raw) {
  const n = Number(String(raw ?? '').replace(/,/g, '').trim())
  return Number.isFinite(n) ? n : 0
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
 *     wastage?: string|number,
 *     matching?: string,
 *   }>,
 *   cutSystemcodeByCutCode: Map<string, string>,
 *   accessories: Array<{ erpCode?: string }>,
 *   materials: Array<{
 *     groupNo?: string|number,
 *     materialCode?: string,
 *     remark?: string,
 *     usageQty?: string|number,
 *     wastageFraction?: number | null,
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

  const mainSc = String(p.mainSystemcode ?? '').trim()
  if (!mainSc) throw new Error('主 BOM systemcode 为空')

  const cuts = Array.isArray(p.cutsResolved) ? p.cutsResolved : []
  const acc = Array.isArray(p.accessories) ? p.accessories : []
  const mats = Array.isArray(p.materials) ? p.materials : []
  const cutScMap = p.cutSystemcodeByCutCode instanceof Map ? p.cutSystemcodeByCutCode : new Map()

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
  for (const c of cuts) {
    const d = normalizeErpCodeDisplay(c?.cutCode ?? '')
    if (d) matCodes.push(d)
  }

  const bomMap = await fetchKcaa04Kcaa33ByKcaa01In(tx, matCodes)

  let inserted = 0

  // 主 BOM：CUT 预览每行 → 子件为裁片 BOM 编码；Seq=0
  for (const c of cuts) {
    const cutCode = String(c.cutCode ?? '').trim()
    if (!cutCode) continue
    const qty = parsePaperPatternQty(c.quantity)
    const loss = parseWastageFraction(c.wastage)
    const matching = String(c.matching ?? '').trim()
    const kcaa04Cut = '张'
    await insertBomPartsLinePaperPattern(tx, partColset, delColKind, mainSc, {
      kcaa01: cutCode,
      kcac04: qty,
      kcac05: loss,
      remark: '',
      seq: 0,
      describe: matching,
      kcac03FromMaster: kcaa04Cut,
    })
    inserted += 1
  }

  // 主 BOM：Accessory；Seq 自 1 递增
  let accSeq = 1
  for (const a of acc) {
    const code = normalizeErpCodeDisplay(a?.erpCode ?? '')
    if (!code) continue
    const key = erpCodeLookupKey(code)
    const row = key ? bomMap.get(key) : null
    await insertBomPartsLinePaperPattern(tx, partColset, delColKind, mainSc, {
      kcaa01: code,
      kcac04: 1,
      kcac05: 0,
      remark: '',
      seq: accSeq,
      describe: '',
      kcac03FromMaster: row?.kcaa04 ?? '',
    })
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
    let mSeq = 1
    for (const m of groupMats) {
      const code = normalizeErpCodeDisplay(m?.materialCode ?? '')
      if (!code) continue
      const key = erpCodeLookupKey(code)
      const row = key ? bomMap.get(key) : null
      const dbLoss = row && row.kcaa33 !== null && row.kcaa33 !== undefined ? Number(row.kcaa33) : 0
      const wf = m.wastageFraction
      const loss =
        wf !== undefined && wf !== null && Number.isFinite(Number(wf)) ? Number(wf) : dbLoss
      const qty = parsePaperPatternQty(m.usageQty)
      const remark = String(m.remark ?? '').trim()
      await insertBomPartsLinePaperPattern(tx, partColset, delColKind, parentSc, {
        kcaa01: code,
        kcac04: qty,
        kcac05: loss,
        remark,
        seq: mSeq,
        describe: remark,
        kcac03FromMaster: row?.kcaa04 ?? '',
      })
      mSeq += 1
      inserted += 1
    }
  }

  console.log('[paper-pattern-import-commit] bomPartsInserted', inserted)
  return inserted
}
