/**
 * 纸格导入：智能校验（ERP 物料）会话态与指纹
 * Material 校验/指纹使用 codesByColor 全码（与正式导入 Bom_parts 一致）
 */
import { erpCodeLookupKey, normalizeErpCodeDisplay } from '@/utils/paperPatternErpCodeNormalize.js'

export const ERP_WORKBENCH_STORAGE = 'paperPatternErpWorkbenchPayloadV1'
export const SMART_CHECK_PASS_STORAGE = 'paperPatternSmartCheckPassV1'
/** 导入页 fileId / 基础资料确认区（离开页面前缓存，配合 parse-tree 恢复） */
export const IMPORT_PAGE_SESSION_STORAGE = 'paperPatternImportPageSessionV1'

/**
 * @param {string[] | undefined} colorNos
 * @param {any[]} materials
 * @returns {string[]}
 */
export function resolveSmartCheckColorNos(colorNos, materials) {
  const fromArr = Array.isArray(colorNos)
    ? colorNos.map((c) => String(c ?? '').trim()).filter(Boolean)
    : []
  if (fromArr.length > 0) return [...new Set(fromArr)]
  const set = new Set()
  for (const m of materials || []) {
    for (const item of m?.codesByColor || []) {
      const c = String(item?.colorNo ?? '').trim()
      if (c) set.add(c)
    }
  }
  return [...set]
}

/**
 * 智能校验 Material 表：按分组 × 颜色展开为待写入全码行
 * @param {any[]} materials
 * @param {string[] | undefined} colorNos
 * @returns {Array<{ groupNo: string, colorNo: string, materialName: string, materialCode: string }>}
 */
export function expandMaterialRowsForSmartCheck(materials, colorNos) {
  const colors = resolveSmartCheckColorNos(colorNos, materials)
  /** @type {Array<{ groupNo: string, colorNo: string, materialName: string, materialCode: string }>} */
  const rows = []
  for (const m of materials || []) {
    const groupNo = String(m?.groupNo ?? '').trim()
    if (!groupNo) continue
    const materialName = String(m?.materialName ?? '').trim()
    const byColor = Array.isArray(m.codesByColor) ? m.codesByColor : []
    for (const colorNo of colors) {
      const hit = byColor.find((x) => String(x?.colorNo ?? '').trim() === colorNo)
      rows.push({
        groupNo,
        colorNo,
        materialName,
        materialCode: String(hit?.materialCode ?? '').trim(),
      })
    }
  }
  return rows
}

/**
 * 校验页编辑写回 materials[].codesByColor
 * @param {any[]} materials
 * @param {Array<{ groupNo?: string, colorNo?: string, materialCode?: string }>} checkRows
 */
export function mergeMaterialCheckRowsIntoMaterials(materials, checkRows) {
  const mats = Array.isArray(materials) ? materials : []
  const rows = Array.isArray(checkRows) ? checkRows : []
  const matByGroup = new Map()
  for (const m of mats) {
    const gn = String(m?.groupNo ?? '').trim()
    if (gn) matByGroup.set(gn, m)
  }
  for (const r of rows) {
    const gn = String(r?.groupNo ?? '').trim()
    const cn = String(r?.colorNo ?? '').trim()
    if (!gn || !cn) continue
    const m = matByGroup.get(gn)
    if (!m) continue
    if (!Array.isArray(m.codesByColor)) m.codesByColor = []
    const hit = m.codesByColor.find((x) => String(x?.colorNo ?? '').trim() === cn)
    const next = normalizeErpCodeDisplay(r.materialCode ?? '')
    if (hit) hit.materialCode = next
    else m.codesByColor.push({ colorNo: cn, materialCode: next })
  }
  return mats
}

/**
 * @param {any[]} materials
 * @param {any[]} accessories
 * @param {string[] | undefined} colorNos
 * @returns {string[]}
 */
export function collectErpLookupKeysForSmartCheck(materials, accessories, colorNos) {
  const keys = []
  const seen = new Set()
  const colors = resolveSmartCheckColorNos(colorNos, materials)
  for (const m of materials || []) {
    const byColor = Array.isArray(m.codesByColor) ? m.codesByColor : []
    for (const colorNo of colors) {
      const hit = byColor.find((x) => String(x?.colorNo ?? '').trim() === colorNo)
      const d = normalizeErpCodeDisplay(hit?.materialCode ?? '')
      const k = erpCodeLookupKey(d)
      if (!k || seen.has(k)) continue
      seen.add(k)
      keys.push(k)
    }
  }
  for (const a of accessories || []) {
    const d = normalizeErpCodeDisplay(a?.erpCode ?? '')
    const k = erpCodeLookupKey(d)
    if (!k || seen.has(k)) continue
    seen.add(k)
    keys.push(k)
  }
  return [...keys].sort()
}

/**
 * @param {any[]} materials
 * @param {any[]} accessories
 * @param {string[] | undefined} colorNos
 */
export function buildSmartCheckFingerprint(materials, accessories, colorNos) {
  return collectErpLookupKeysForSmartCheck(materials, accessories, colorNos).join('\u0001')
}

/**
 * @returns {{ passedAt: number, fingerprint: string } | null}
 */
export function readSmartCheckPassRecord() {
  try {
    const raw = sessionStorage.getItem(SMART_CHECK_PASS_STORAGE)
    if (!raw) return null
    const o = JSON.parse(raw)
    const fingerprint = String(o?.fingerprint ?? '')
    if (!fingerprint) return null
    return { passedAt: Number(o.passedAt) || 0, fingerprint }
  } catch {
    return null
  }
}

/** @param {string} fingerprint */
export function writeSmartCheckPass(fingerprint) {
  if (!fingerprint) return
  sessionStorage.setItem(
    SMART_CHECK_PASS_STORAGE,
    JSON.stringify({ passedAt: Date.now(), fingerprint }),
  )
}

export function clearSmartCheckPass() {
  sessionStorage.removeItem(SMART_CHECK_PASS_STORAGE)
}

/**
 * @param {{
 *   fileId?: string,
 *   fileName?: string,
 *   basicFormList?: any[],
 *   sharedImportTypeFlag5?: string,
 *   cutPreviewColorNo?: string,
 * }} data
 */
export function saveImportPageSession(data) {
  sessionStorage.setItem(
    IMPORT_PAGE_SESSION_STORAGE,
    JSON.stringify({
      savedAt: Date.now(),
      fileId: String(data?.fileId ?? '').trim(),
      fileName: String(data?.fileName ?? '').trim(),
      basicFormList: Array.isArray(data?.basicFormList) ? data.basicFormList : [],
      sharedImportTypeFlag5: String(data?.sharedImportTypeFlag5 ?? '').trim(),
      cutPreviewColorNo: String(data?.cutPreviewColorNo ?? '').trim(),
    }),
  )
}

/** @returns {{ fileId: string, fileName: string, basicFormList: any[], sharedImportTypeFlag5: string, cutPreviewColorNo: string } | null} */
export function readImportPageSession() {
  try {
    const raw = sessionStorage.getItem(IMPORT_PAGE_SESSION_STORAGE)
    if (!raw) return null
    const o = JSON.parse(raw)
    return {
      fileId: String(o?.fileId ?? '').trim(),
      fileName: String(o?.fileName ?? '').trim(),
      basicFormList: Array.isArray(o?.basicFormList) ? o.basicFormList : [],
      sharedImportTypeFlag5: String(o?.sharedImportTypeFlag5 ?? '').trim(),
      cutPreviewColorNo: String(o?.cutPreviewColorNo ?? '').trim(),
    }
  } catch {
    return null
  }
}

export function clearImportPageSession() {
  sessionStorage.removeItem(IMPORT_PAGE_SESSION_STORAGE)
}

/** @param {string} fingerprint */
export function isSmartCheckPassValid(fingerprint) {
  if (!fingerprint) return false
  const rec = readSmartCheckPassRecord()
  return !!rec && rec.fingerprint === fingerprint
}

/**
 * @param {{ materials?: any[], accessories?: any[], colorNos?: string[] } | any[]} payload
 * @param {any[]} [accessoriesLegacy]
 */
export function saveWorkbenchPayload(payload, accessoriesLegacy) {
  const p = Array.isArray(payload)
    ? {
        materials: payload,
        accessories: Array.isArray(accessoriesLegacy) ? accessoriesLegacy : [],
        colorNos: [],
      }
    : payload || {}
  sessionStorage.setItem(
    ERP_WORKBENCH_STORAGE,
    JSON.stringify({
      savedAt: Date.now(),
      materials: Array.isArray(p.materials) ? p.materials : [],
      accessories: Array.isArray(p.accessories) ? p.accessories : [],
      colorNos: Array.isArray(p.colorNos) ? p.colorNos : [],
    }),
  )
}

/** @returns {{ materials: any[], accessories: any[], colorNos: string[] } | null} */
export function readWorkbenchPayload() {
  try {
    const raw = sessionStorage.getItem(ERP_WORKBENCH_STORAGE)
    if (!raw) return null
    const o = JSON.parse(raw)
    return {
      materials: Array.isArray(o?.materials) ? o.materials : [],
      accessories: Array.isArray(o?.accessories) ? o.accessories : [],
      colorNos: Array.isArray(o?.colorNos) ? o.colorNos : [],
    }
  } catch {
    return null
  }
}

/**
 * 将智能校验页改码写回 parseResult（Material 按 groupNo+colorNo → codesByColor；Accessory 按 seqNo+colorNo）
 * @param {{ materials?: any[], accessories?: any[] }} parseResult
 * @returns {boolean} 是否有字段变更
 */
export function applyWorkbenchEditsToParseResult(parseResult) {
  const payload = readWorkbenchPayload()
  if (!payload || !parseResult) return false
  let changed = false

  const payloadMatByKey = new Map()
  for (const m of payload.materials || []) {
    const gn = String(m?.groupNo ?? '').trim()
    for (const item of m?.codesByColor || []) {
      const cn = String(item?.colorNo ?? '').trim()
      if (!gn || !cn) continue
      payloadMatByKey.set(`${gn}\u0002${cn}`, normalizeErpCodeDisplay(item.materialCode ?? ''))
    }
  }

  if (Array.isArray(parseResult.materials)) {
    for (const m of parseResult.materials) {
      const gn = String(m?.groupNo ?? '').trim()
      if (!Array.isArray(m.codesByColor)) continue
      for (const item of m.codesByColor) {
        const cn = String(item?.colorNo ?? '').trim()
        if (!gn || !cn) continue
        const next = payloadMatByKey.get(`${gn}\u0002${cn}`)
        if (next === undefined) continue
        if (normalizeErpCodeDisplay(item.materialCode ?? '') !== next) {
          item.materialCode = next
          changed = true
        }
      }
    }
  }

  const accPayload = payload.accessories
  const accIn = parseResult.accessories
  if (Array.isArray(accIn) && Array.isArray(accPayload)) {
    const payloadAccByKey = new Map()
    for (const a of accPayload) {
      const seq = String(a?.seqNo ?? '').trim()
      const cn = String(a?.colorNo ?? '').trim()
      if (!seq || !cn) continue
      payloadAccByKey.set(`${seq}\u0002${cn}`, normalizeErpCodeDisplay(a.erpCode ?? ''))
    }
    for (const a of accIn) {
      const seq = String(a?.seqNo ?? '').trim()
      const cn = String(a?.colorNo ?? '').trim()
      if (!seq || !cn) continue
      const next = payloadAccByKey.get(`${seq}\u0002${cn}`)
      if (next === undefined) continue
      if (normalizeErpCodeDisplay(a.erpCode ?? '') !== next) {
        a.erpCode = next
        changed = true
      }
    }
  }

  return changed
}
