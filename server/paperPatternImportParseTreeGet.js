/**
 * 纸格导入：按 fileId 重解析 Excel 得到 Material / Accessory 等树（不写库；不修改解析器本体）
 */
import fs from 'node:fs'
import { FILE_ID_RE, resolveUploadedPaperPatternFile } from './paperPatternImportPreview.js'
import { parsePaperPatternImportTreeFromBuffer } from './paperPatternImportParse.js'

/**
 * GET /api/paper-pattern/import/parse-tree?fileId=&importTypeFlag5=
 * importTypeFlag5 可选，仅影响 mainBom/cuts 中带前缀的编码预览；Material/Accessory 行不依赖
 */
export async function handleGetPaperPatternImportParseTree(req, res) {
  try {
    const fileId = String(req.query?.fileId ?? '').trim()
    if (!fileId || !FILE_ID_RE.test(fileId)) {
      res.status(400).json({ success: false, message: '缺少或非法参数 fileId' })
      return
    }
    const fp = resolveUploadedPaperPatternFile(fileId)
    if (!fp) {
      res.status(404).json({ success: false, message: '文件不存在' })
      return
    }
    const buf = fs.readFileSync(fp)
    const importTypeFlag5 = String(req.query?.importTypeFlag5 ?? '').trim()
    const importTypeFlag1 = String(req.query?.importTypeFlag1 ?? '').trim()
    const tree = parsePaperPatternImportTreeFromBuffer(buf, {
      importTypeFlag5,
      importTypeFlag1,
    })
    res.json({
      success: true,
      fileId,
      mainBom: tree.mainBom,
      cuts: tree.cuts,
      materials: tree.materials,
      accessories: tree.accessories,
      warnings: tree.warnings,
    })
  } catch (e) {
    console.error('GET /api/paper-pattern/import/parse-tree 失败：', e)
    res.status(500).json({ success: false, message: '解析失败' })
  }
}
