/**
 * 纸格导入：智能校验（ERP 物料）会话态与指纹
 * Material 校验/指纹使用 codesByColor 全码（与正式导入 Bom_parts 一致）
 */
import { erpCodeLookupKey, normalizeErpCodeDisplay } from '@/utils/paperPatternErpCodeNormalize.js'

export const ERP_WORKBENCH_STORAGE = 'paperPatternErpWorkbenchPayloadV1'
export const SMART_CHECK_PASS_STORAGE = 'paperPatternSmartCheckPassV1'
/** 导入页 fileId / 基础资料确认区（离开页面前缓存，配合 parse-tree 恢复） */
export const IMPORT_PAGE_SESSION_STORAGE = 'paperPatternImportPageSessionV1'

export function excelColumnLettersFromIndex(index) {
  let n = Math.trunc(Number(index) || 0)
  if (n < 1) return ''
  let out = ''
  while (n > 0) {
    n -= 1
    out = String.fromCharCode(65 + (n % 26)) + out
    n = Math.floor(n / 26)
  }
  return out
}

export function materialErpPrefix(code) {
  const d = normalizeErpCodeDisplay(code)
  if (!d) return ''
  const slash = d.indexOf('/')
  return (slash >= 0 ? d.slice(0, slash) : d).trim()
}

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
 * @returns {Array<{ groupNo: string, colorNo: string, colIndex?: number, excelCol: string, materialName: string, materialCode: string }>}
 */
export function expandMaterialRowsForSmartCheck(materials, colorNos) {
  const colors = resolveSmartCheckColorNos(colorNos, materials)
  /** @type {Array<{ groupNo: string, colorNo: string, colIndex?: number, excelCol: string, materialName: string, materialCode: string }>} */
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
        colIndex: hit?.colIndex,
        excelCol: excelColumnLettersFromIndex(hit?.colIndex),
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
/**
 * @param {Array<{ groupNo?: string, colorNo?: string, colIndex?: number, excelCol?: string, materialName?: string, materialCode?: string }>} rows
 */
export function validateMaterialPrefixConsistencyForSmartCheck(rows) {
  const byGroup = new Map()
  for (const row of rows || []) {
    const groupNo = String(row?.groupNo ?? '').trim()
    if (!groupNo) continue
    if (!byGroup.has(groupNo)) byGroup.set(groupNo, [])
    byGroup.get(groupNo).push(row)
  }

  const mismatches = []
  for (const groupRows of byGroup.values()) {
    const entries = groupRows
      .map((row) => {
        const materialCode = normalizeErpCodeDisplay(row?.materialCode ?? '')
        const prefix = materialErpPrefix(materialCode)
        return {
          groupNo: String(row?.groupNo ?? '').trim(),
          colorNo: String(row?.colorNo ?? '').trim(),
          colIndex: row?.colIndex,
          excelCol: String(row?.excelCol ?? '') || excelColumnLettersFromIndex(row?.colIndex),
          materialName: String(row?.materialName ?? '').trim(),
          materialCode,
          prefix,
        }
      })
      .filter((x) => x.materialCode && x.prefix)
    const base = entries[0]
    if (!base) continue
    for (const item of entries.slice(1)) {
      if (item.prefix === base.prefix) continue
      mismatches.push({
        ...item,
        expectedPrefix: base.prefix,
        expectedColorNo: base.colorNo,
        expectedColIndex: base.colIndex,
        expectedExcelCol: base.excelCol,
      })
    }
  }
  return mismatches
}

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
 * @returns {{ passedAt: number, fingerprint: string, fileId: string } | null}
 */
export function readSmartCheckPassRecord() {
  try {
    const raw = sessionStorage.getItem(SMART_CHECK_PASS_STORAGE)
    if (!raw) return null
    const o = JSON.parse(raw)
    const fingerprint = String(o?.fingerprint ?? '')
    if (!fingerprint) return null
    return {
      passedAt: Number(o.passedAt) || 0,
      fingerprint,
      fileId: String(o?.fileId ?? '').trim(),
    }
  } catch {
    return null
  }
}

/**
 * @param {string} fingerprint
 * @param {string} [fileId] 与导入页 parseFileId 绑定，防止跨文件误用通过态
 */
export function writeSmartCheckPass(fingerprint, fileId) {
  if (!fingerprint) return
  sessionStorage.setItem(
    SMART_CHECK_PASS_STORAGE,
    JSON.stringify({
      passedAt: Date.now(),
      fingerprint,
      fileId: String(fileId ?? '').trim(),
    }),
  )
}

/** @param {string} fileId */
export function isSmartCheckPassForImportPage(fileId) {
  const fid = String(fileId ?? '').trim()
  if (!fid) return false
  const rec = readSmartCheckPassRecord()
  return !!(rec?.fingerprint && rec.fileId === fid)
}

export function clearSmartCheckPass() {
  sessionStorage.removeItem(SMART_CHECK_PASS_STORAGE)
}

/**
 * 深拷贝解析树供 session 恢复（合并 Material 预览行中可编辑损耗）
 * @param {any} parseResult
 * @param {any[] | undefined} materialPreviewRows
 * @returns {any | null}
 */
export function cloneParseResultForSessionSnapshot(parseResult, materialPreviewRows) {
  if (!parseResult || typeof parseResult !== 'object') return null
  let snap
  try {
    snap = JSON.parse(JSON.stringify(parseResult))
  } catch {
    return null
  }
  const preview = Array.isArray(materialPreviewRows) ? materialPreviewRows : []
  if (Array.isArray(snap.materials)) {
    for (const row of preview) {
      const idx = row?.rowIndex
      if (idx === undefined || idx === null) continue
      const m = snap.materials[idx]
      if (!m || !row?.wastageEditable) continue
      if (row.wastageFraction !== undefined && row.wastageFraction !== null) {
        m.wastageFraction = row.wastageFraction
      }
    }
  }
  return snap
}

/**
 * @param {{
 *   fileId?: string,
 *   fileName?: string,
 *   basicFormList?: any[],
 *   sharedImportTypeFlag5?: string,
 *   sharedClearanceOrder?: boolean,
 *   cutPreviewColorNo?: string,
 *   parseResultSnapshot?: any,
 *   commitInProgress?: boolean,
 * }} data
 */
export function saveImportPageSession(data) {
  const snap = data?.parseResultSnapshot
  sessionStorage.setItem(
    IMPORT_PAGE_SESSION_STORAGE,
    JSON.stringify({
      savedAt: Date.now(),
      fileId: String(data?.fileId ?? '').trim(),
      fileName: String(data?.fileName ?? '').trim(),
      basicFormList: Array.isArray(data?.basicFormList) ? data.basicFormList : [],
      sharedImportTypeFlag5: String(data?.sharedImportTypeFlag5 ?? '').trim(),
      sharedClearanceOrder: data?.sharedClearanceOrder === true,
      cutPreviewColorNo: String(data?.cutPreviewColorNo ?? '').trim(),
      parseResultSnapshot: snap && typeof snap === 'object' ? snap : null,
      commitInProgress: !!data?.commitInProgress,
    }),
  )
}

/**
 * @returns {{
 *   fileId: string,
 *   fileName: string,
 *   basicFormList: any[],
 *   sharedImportTypeFlag5: string,
 *   sharedClearanceOrder: boolean,
 *   cutPreviewColorNo: string,
 *   parseResultSnapshot: any | null,
 *   commitInProgress: boolean,
 * } | null}
 */
export function readImportPageSession() {
  try {
    const raw = sessionStorage.getItem(IMPORT_PAGE_SESSION_STORAGE)
    if (!raw) return null
    const o = JSON.parse(raw)
    const snap = o?.parseResultSnapshot
    return {
      fileId: String(o?.fileId ?? '').trim(),
      fileName: String(o?.fileName ?? '').trim(),
      basicFormList: Array.isArray(o?.basicFormList) ? o.basicFormList : [],
      sharedImportTypeFlag5: String(o?.sharedImportTypeFlag5 ?? '').trim(),
      sharedClearanceOrder: o?.sharedClearanceOrder === true,
      cutPreviewColorNo: String(o?.cutPreviewColorNo ?? '').trim(),
      parseResultSnapshot:
        snap && typeof snap === 'object' && !Array.isArray(snap) ? snap : null,
      commitInProgress: !!o?.commitInProgress,
    }
  } catch {
    return null
  }
}

export function clearImportPageSession() {
  sessionStorage.removeItem(IMPORT_PAGE_SESSION_STORAGE)
}

/**
 * 智能校验通过后，把 workbench 中的 materials/accessories 写回导入页 session 快照
 * @param {string} [fileId]
 */
export function mergeWorkbenchIntoImportPageSession(fileId) {
  const payload = readWorkbenchPayload()
  if (!payload) return
  const fid = String(fileId ?? '').trim()
  const sess = readImportPageSession()
  const prevSnap = sess?.parseResultSnapshot
  saveImportPageSession({
    fileId: fid || sess?.fileId || '',
    fileName: sess?.fileName || '',
    basicFormList: sess?.basicFormList || [],
    sharedImportTypeFlag5: sess?.sharedImportTypeFlag5 || '',
    sharedClearanceOrder: sess?.sharedClearanceOrder === true,
    cutPreviewColorNo: sess?.cutPreviewColorNo || '',
    commitInProgress: !!sess?.commitInProgress,
    parseResultSnapshot: {
      mainBom: prevSnap?.mainBom || {},
      cuts: Array.isArray(prevSnap?.cuts) ? prevSnap.cuts : [],
      materials: Array.isArray(payload.materials) ? payload.materials : [],
      accessories: Array.isArray(payload.accessories) ? payload.accessories : [],
      warnings: Array.isArray(prevSnap?.warnings) ? prevSnap.warnings : [],
    },
  })
}

/**
 * 将 workbench 全量 materials/accessories 写回内存中的 parseResult
 * @param {{ materials?: any[], accessories?: any[] }} parseResult
 * @returns {boolean}
 */
export function applyWorkbenchPayloadToParseResult(parseResult) {
  const payload = readWorkbenchPayload()
  if (!payload || !parseResult) return false
  try {
    parseResult.materials = JSON.parse(JSON.stringify(payload.materials || []))
    parseResult.accessories = JSON.parse(JSON.stringify(payload.accessories || []))
    return true
  } catch {
    return false
  }
}

/**
 * @param {string} fingerprint
 * @param {string} [fileId]
 */
export function isSmartCheckPassValid(fingerprint, fileId) {
  if (!fingerprint) return false
  const rec = readSmartCheckPassRecord()
  if (!rec || rec.fingerprint !== fingerprint) return false
  const fid = String(fileId ?? '').trim()
  if (rec.fileId && fid && rec.fileId !== fid) return false
  return true
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

export function clearWorkbenchPayload() {
  sessionStorage.removeItem(ERP_WORKBENCH_STORAGE)
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
