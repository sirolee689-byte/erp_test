/**
 * 纸格资料导入：按 fileId 读取临时 Excel 并解析为预览结构（不写库）
 */
import fs from 'node:fs'
import path from 'node:path'
import * as XLSX from 'xlsx'

export const PAPER_PATTERN_IMPORT_TMP_DIR = path.join(
  process.cwd(),
  'server',
  'tmp',
  'paper-pattern-import',
)

export function ensurePaperPatternImportTmpDir() {
  try {
    fs.mkdirSync(PAPER_PATTERN_IMPORT_TMP_DIR, { recursive: true })
  } catch (e) {
    console.error('创建纸格导入临时目录失败：', e)
  }
}

/** 与 multer 生成的 fileId（UUID）一致，防路径穿越 */
export const FILE_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * @param {string} fileId
 * @returns {string|null} 绝对路径
 */
export function resolveUploadedPaperPatternFile(fileId) {
  const id = String(fileId ?? '').trim()
  if (!FILE_ID_RE.test(id)) return null
  for (const ext of ['.xlsx', '.xls']) {
    const p = path.join(PAPER_PATTERN_IMPORT_TMP_DIR, `${id}${ext}`)
    if (fs.existsSync(p) && fs.statSync(p).isFile()) return p
  }
  return null
}

/**
 * Excel 列号（1-based）→ A、B、…、AA
 * @param {number} colIndex1
 */
export function excelColumnLettersFromOneBased(colIndex1) {
  let n = Math.max(1, Math.floor(Number(colIndex1) || 1))
  let s = ''
  while (n > 0) {
    const m = (n - 1) % 26
    s = String.fromCharCode(65 + m) + s
    n = Math.floor((n - 1) / 26)
  }
  return s
}

/**
 * @param {import('xlsx').CellObject | undefined} cell
 * @returns {string}
 */
function cellToDisplayString(cell) {
  if (cell == null) return ''
  if (cell.t === 'z') return ''
  // 优先使用工作簿内缓存的显示文本（利于保留前导零等展示形态）
  if (cell.w != null && String(cell.w) !== '') return String(cell.w)
  const v = cell.v
  if (v == null || v === '') return ''
  if (cell.t === 'd' && v instanceof Date) {
    const y = v.getFullYear()
    const m = String(v.getMonth() + 1).padStart(2, '0')
    const d = String(v.getDate()).padStart(2, '0')
    return `${y}-${m}-${d}`
  }
  if (cell.t === 'b') return v ? 'TRUE' : 'FALSE'
  if (cell.t === 'e') return v != null ? String(v) : ''
  return String(v)
}

/**
 * @param {import('xlsx').WorkSheet} sheet
 * @returns {{ s: { r: number, c: number }, e: { r: number, c: number } } | null}
 */
function getSheetRange(sheet) {
  const ref = sheet['!ref']
  if (ref && typeof ref === 'string') {
    return XLSX.utils.decode_range(ref)
  }
  let maxR = 0
  let maxC = 0
  let minR = Number.POSITIVE_INFINITY
  let minC = Number.POSITIVE_INFINITY
  for (const key of Object.keys(sheet)) {
    if (key[0] === '!') continue
    const addr = XLSX.utils.decode_cell(key)
    minR = Math.min(minR, addr.r)
    minC = Math.min(minC, addr.c)
    maxR = Math.max(maxR, addr.r)
    maxC = Math.max(maxC, addr.c)
  }
  if (!Number.isFinite(minR)) return null
  return { s: { r: minR, c: minC }, e: { r: maxR, c: maxC } }
}

/**
 * @param {import('xlsx').Range[]} | undefined merges
 * @returns {Map<string, { r: number, c: number }>}
 */
function buildMergeOwnerMap(merges) {
  const owner = new Map()
  if (!Array.isArray(merges)) return owner
  for (const m of merges) {
    if (!m?.s || !m?.e) continue
    const sr = m.s.r
    const sc = m.s.c
    const er = m.e.r
    const ec = m.e.c
    for (let r = sr; r <= er; r++) {
      for (let c = sc; c <= ec; c++) {
        owner.set(`${r},${c}`, { r: sr, c: sc })
      }
    }
  }
  return owner
}

/**
 * 从内存 buffer 读取首个工作表为扁平行（供预览与导入解析共用）
 * @param {Buffer} buf
 * @returns {{ sheetName: string, totalRows: number, rows: Array<{ rowIndex: number, cells: Array<{ colIndex: number, value: string }> }> }}
 */
export function parsePaperPatternExcelFromBuffer(buf) {
  const wb = XLSX.read(buf, {
    type: 'buffer',
    cellDates: true,
    cellText: true,
  })
  const sheetName = wb.SheetNames[0]
  if (!sheetName) {
    return { sheetName: '', totalRows: 0, rows: [] }
  }
  const sheet = wb.Sheets[sheetName]
  if (!sheet) {
    return { sheetName, totalRows: 0, rows: [] }
  }

  const range = getSheetRange(sheet)
  if (!range) {
    return { sheetName, totalRows: 0, rows: [] }
  }

  const mergeOwner = buildMergeOwnerMap(sheet['!merges'])
  const rows = []
  for (let r = range.s.r; r <= range.e.r; r++) {
    /** @type {Array<{ colIndex: number, value: string }>} */
    const cells = []
    for (let c = range.s.c; c <= range.e.c; c++) {
      const own = mergeOwner.get(`${r},${c}`) || { r, c }
      const addr = XLSX.utils.encode_cell(own)
      const cell = sheet[addr]
      const value = cellToDisplayString(cell)
      cells.push({
        colIndex: c + 1,
        value,
      })
    }
    rows.push({
      rowIndex: r + 1,
      cells,
    })
  }

  return {
    sheetName,
    totalRows: rows.length,
    rows,
  }
}

/**
 * 读取首个工作表指定 A1 地址单元格显示文本（支持合并单元格，如 N2）
 * @param {Buffer} buf
 * @param {string} a1 如 N2
 * @returns {string}
 */
export function readFirstSheetCellA1FromBuffer(buf, a1) {
  const wb = XLSX.read(buf, {
    type: 'buffer',
    cellDates: true,
    cellText: true,
  })
  const sheetName = wb.SheetNames[0]
  if (!sheetName) return ''
  const sheet = wb.Sheets[sheetName]
  if (!sheet) return ''
  const key = String(a1 ?? '')
    .trim()
    .toUpperCase()
  if (!key) return ''
  let decoded
  try {
    decoded = XLSX.utils.decode_cell(key)
  } catch {
    return ''
  }
  const mergeOwner = buildMergeOwnerMap(sheet['!merges'])
  const own = mergeOwner.get(`${decoded.r},${decoded.c}`) || decoded
  const addr = XLSX.utils.encode_cell(own)
  const cell = sheet[addr]
  return cellToDisplayString(cell)
}

/**
 * @param {string} filePath
 * @returns {{ sheetName: string, totalRows: number, rows: Array<{ rowIndex: number, cells: Array<{ colIndex: number, value: string }> }> }}
 */
export function parsePaperPatternExcelForPreview(filePath) {
  const buf = fs.readFileSync(filePath)
  return parsePaperPatternExcelFromBuffer(buf)
}

/**
 * GET /api/paper-pattern/import/preview?fileId=
 */
export function handlePaperPatternImportPreviewGet(req, res) {
  try {
    const fileId = String(req.query?.fileId ?? '').trim()
    if (!fileId) {
      res.status(400).json({ success: false, message: '缺少参数 fileId' })
      return
    }
    const fp = resolveUploadedPaperPatternFile(fileId)
    if (!fp) {
      res.status(404).json({ success: false, message: '文件不存在' })
      return
    }
    const parsed = parsePaperPatternExcelForPreview(fp)
    res.json({
      success: true,
      fileId,
      sheetName: parsed.sheetName,
      totalRows: parsed.totalRows,
      rows: parsed.rows,
    })
  } catch (e) {
    console.error('GET /api/paper-pattern/import/preview 解析失败：', e)
    res.status(500).json({ success: false, message: 'Excel解析失败' })
  }
}
