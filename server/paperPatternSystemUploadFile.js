/**
 * 纸格正式导入成功：登记 System_uplod_file（仅 commit-bom000 成功路径）
 */
import fs from 'node:fs'
import path from 'node:path'
import sql from 'mssql'
import { getPaperPatternUploadDir } from './paperPatternFilePaths.js'

export const SYSTEM_UPLOAD_FILE_TABLE =
  String(process.env.SYSTEM_UPLOAD_FILE_TABLE ?? 'System_uplod_file').trim() ||
  'System_uplod_file'

/** 与旧系统 filepath 约定一致 */
export const PAPER_PATTERN_UPLOAD_FILEPATH_PREFIX = '\\ub_bom\\upload\\'

/**
 * 正式导入时刻 → 磁盘/库 filename（YYYYMMDDHHmmss + 扩展名）
 * @param {Date} date
 * @param {string} ext 如 .xls
 */
export function formatPaperPatternStoredFilename(date, ext) {
  const d = date instanceof Date ? date : new Date(date)
  const pad2 = (n) => String(n).padStart(2, '0')
  const stamp = `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}${pad2(d.getHours())}${pad2(
    d.getMinutes(),
  )}${pad2(d.getSeconds())}`
  const rawExt = String(ext ?? '').trim()
  const extNorm = rawExt.startsWith('.') ? rawExt.toLowerCase() : `.${rawExt.toLowerCase()}`
  if (!/^\.(xls|xlsx)$/.test(extNorm)) {
    throw new Error('仅支持 .xls / .xlsx 扩展名')
  }
  return `${stamp}${extNorm}`
}

/**
 * @param {string} filename
 */
export function buildPaperPatternSystemUploadFilepath(filename) {
  const base = String(filename ?? '').trim().replace(/\\/g, '/').split('/').pop() || ''
  return `${PAPER_PATTERN_UPLOAD_FILEPATH_PREFIX}${base}`
}

/**
 * 从原始文件名提取 project_name（仅字母数字）
 * @param {string} truefilename
 */
export function extractProjectNameFromTruefilename(truefilename) {
  const base = path.basename(String(truefilename ?? '').trim())
  const noExt = base.replace(/\.[^.]+$/i, '')
  const alnum = noExt.replace(/[^A-Za-z0-9]/g, '')
  return alnum || ''
}

/**
 * 在 upload 目录选取未占用的归档文件名（秒级冲突时顺延 1 秒，最多 60 次）
 * @param {Date} commitDate
 * @param {string} ext
 */
export function pickPaperPatternArchiveFilename(commitDate, ext) {
  const uploadDir = path.resolve(getPaperPatternUploadDir())
  let d = commitDate instanceof Date ? new Date(commitDate.getTime()) : new Date(commitDate)
  for (let i = 0; i < 60; i++) {
    const filename = formatPaperPatternStoredFilename(d, ext)
    const targetPath = path.join(uploadDir, filename)
    if (!fs.existsSync(targetPath)) {
      return {
        filename,
        filepath: buildPaperPatternSystemUploadFilepath(filename),
        targetPath,
        addtimeDate: d,
      }
    }
    d = new Date(d.getTime() + 1000)
  }
  throw new Error('ARCHIVE_FILENAME_COLLISION')
}

/**
 * UUID 落盘文件 → 时间戳归档名
 * @param {string} sourcePath
 * @param {string} targetPath
 * @returns {number} 字节数
 */
export function renamePaperPatternUploadToArchive(sourcePath, targetPath) {
  fs.renameSync(sourcePath, targetPath)
  const st = fs.statSync(targetPath)
  if (!st.isFile()) throw new Error('归档后不是有效文件')
  return st.size
}

/**
 * @param {import('mssql').Transaction} transaction
 * @param {{
 *   actor: { uidInt: number | null, uname: string | null, utruename: string | null },
 *   addtime: string,
 *   ip: string,
 *   filename: string,
 *   filepath: string,
 *   filesizeBytes: number,
 *   truefilename: string,
 *   projectName: string,
 * }} row
 */
export async function insertPaperPatternSystemUploadFileInTx(transaction, row) {
  const req = new sql.Request(transaction)
  const uidInt =
    row.actor?.uidInt != null && Number.isFinite(Number(row.actor.uidInt)) && Number(row.actor.uidInt) > 0
      ? Math.trunc(Number(row.actor.uidInt))
      : null
  req.input('uid', sql.NVarChar(50), uidInt != null ? String(uidInt) : '')
  req.input('uname', sql.NVarChar(100), String(row.actor?.uname ?? '').trim())
  req.input('truename', sql.NVarChar(100), String(row.actor?.utruename ?? '').trim())
  req.input('addtime', sql.NVarChar(50), String(row.addtime ?? '').trim())
  req.input('ip', sql.NVarChar(50), String(row.ip ?? '').trim())
  req.input('filename', sql.NVarChar(500), String(row.filename ?? '').trim())
  req.input('filepath', sql.NVarChar(500), String(row.filepath ?? '').trim())
  req.input('filesize', sql.NVarChar(50), String(Math.max(0, Math.trunc(row.filesizeBytes ?? 0))))
  req.input('truefilename', sql.NVarChar(500), String(row.truefilename ?? '').trim())
  req.input('project_name', sql.NVarChar(200), String(row.projectName ?? '').trim())

  await req.query(`
    INSERT INTO ${SYSTEM_UPLOAD_FILE_TABLE} (
      uid, uname, addtime, ip, filename, filesize, filepath, truefilename, truename,
      systemcode, project_name, project_info, project_id
    ) VALUES (
      @uid, @uname, @addtime, @ip, @filename, @filesize, @filepath, @truefilename, @truename,
      NULL, @project_name, NULL, NULL
    )
  `)
}
