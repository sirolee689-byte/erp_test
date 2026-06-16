/**
 * 管理纸格导入资料：UB_ERP_System_uplod_file 分页列表（只读）
 */
import sql from 'mssql'
import { getPool } from './db.js'
import { getSysUsersColumnsMeta, getSysUsersEntityPkQb } from './sysUsersDb.js'

const SYSTEM_UPLOAD_FILE_TABLE =
  String(process.env.SYSTEM_UPLOAD_FILE_TABLE ?? 'UB_ERP_System_uplod_file').trim() ||
  'UB_ERP_System_uplod_file'

/** 仅纸格相关上传（与旧系统 filepath 约定一致） */
const FILEPATH_SCOPE_LIKE = '%ub_bom%'

function escapeSqlLikePattern(s) {
  return String(s)
    .replace(/\\/g, '\\\\')
    .replace(/%/g, '\\%')
    .replace(/_/g, '\\_')
    .replace(/\[/g, '\\[')
}

/**
 * @param {string} filesizeRaw
 * @returns {number|null}
 */
export function parseSystemUploadFilesizeBytes(filesizeRaw) {
  const s = String(filesizeRaw ?? '').trim()
  if (!s || !/^\d+$/.test(s)) return null
  const n = Number(s)
  return Number.isFinite(n) && n >= 0 ? n : null
}

/**
 * 字节 → 展示用 KB（四舍五入整数，与截图一致）
 * @param {string|number} filesizeRaw
 * @returns {string}
 */
export function formatSystemUploadFilesizeKb(filesizeRaw) {
  const bytes = parseSystemUploadFilesizeBytes(filesizeRaw)
  if (bytes == null) return '—'
  return `${Math.round(bytes / 1024)} KB`
}

/**
 * 解析关键词中的文件大小搜索片段（支持 181、670 KB）
 * @param {string} keyword
 * @returns {{ mode: 'none'|'bytes'|'kb', value: string }}
 */
export function parseFilesizeKeywordPart(keyword) {
  const raw = String(keyword ?? '').trim()
  if (!raw) return { mode: 'none', value: '' }
  const kbMatch = raw.match(/^(\d+(?:\.\d+)?)\s*k\s*b?$/i)
  if (kbMatch) {
    return { mode: 'kb', value: kbMatch[1] }
  }
  if (/^\d+(?:\.\d+)?$/.test(raw)) {
    return { mode: 'bytes', value: raw }
  }
  return { mode: 'none', value: '' }
}

/**
 * 构建 filesize 模糊条件 SQL 片段（需已定义 @kw）
 * @param {string} keyword
 */
export function buildFilesizeSearchSqlFragment(keyword) {
  const part = parseFilesizeKeywordPart(keyword)
  if (part.mode === 'none') {
    return `
      OR (
        ISNUMERIC(LTRIM(RTRIM(ISNULL(f.filesize, N'')))) = 1
        AND (
          LOWER(LTRIM(RTRIM(CONVERT(nvarchar(40), f.filesize)))) LIKE @kw
          OR LOWER(LTRIM(RTRIM(CONVERT(nvarchar(20), CAST(ROUND(CAST(f.filesize AS float) / 1024.0, 0) AS int))))) LIKE @kw
        )
      )
    `
  }
  if (part.mode === 'kb') {
    const kbPat = `%${escapeSqlLikePattern(part.value)}%`
    return `
      OR (
        ISNUMERIC(LTRIM(RTRIM(ISNULL(f.filesize, N'')))) = 1
        AND LOWER(LTRIM(RTRIM(CONVERT(nvarchar(20), CAST(ROUND(CAST(f.filesize AS float) / 1024.0, 0) AS int))))) LIKE @kwKb
      )
    `
  }
  const bytesPat = `%${escapeSqlLikePattern(part.value)}%`
  return `
    OR (
      LOWER(LTRIM(RTRIM(CONVERT(nvarchar(40), ISNULL(f.filesize, N''))))) LIKE @kwBytes
      OR (
        ISNUMERIC(LTRIM(RTRIM(ISNULL(f.filesize, N'')))) = 1
        AND LOWER(LTRIM(RTRIM(CONVERT(nvarchar(40), f.filesize)))) LIKE @kwBytes
      )
    )
  `
}

/**
 * 上传者展示：优先 UB_ERP_User.truename（按 f.uid 关联），无匹配时回退 f.truename
 * @param {import('./sysUsersDb.js').SysUsersColumnsMeta} userMeta
 */
export function buildPaperPatternUploaderSql(userMeta) {
  const qPk = getSysUsersEntityPkQb(userMeta)
  const qTruename = userMeta.qb('truename')
  const joinSql = qPk
    ? `LEFT JOIN dbo.[UB_ERP_User] AS su ON LTRIM(RTRIM(CONVERT(nvarchar(50), ISNULL(f.uid, N'')))) <> N''
        AND LTRIM(RTRIM(CONVERT(nvarchar(50), ISNULL(f.uid, N'')))) = LTRIM(RTRIM(CONVERT(nvarchar(50), ISNULL(su.${qPk}, N''))))`
    : ''
  const suTruenameExpr = qTruename
    ? `LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(su.${qTruename}, N''))))`
    : `CAST(N'' AS NVARCHAR(100))`
  const fileTruenameExpr = `LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(f.truename, N''))))`
  const uploaderSql =
    qPk && qTruename
      ? `CASE WHEN ${suTruenameExpr} <> N'' THEN ${suTruenameExpr} ELSE ${fileTruenameExpr} END`
      : fileTruenameExpr
  const uploaderSearchSql =
    qPk && qTruename
      ? `OR LOWER(${suTruenameExpr}) LIKE @kw
          OR LOWER(${fileTruenameExpr}) LIKE @kw`
      : `OR LOWER(${fileTruenameExpr}) LIKE @kw`
  return { joinSql, uploaderSql, uploaderSearchSql }
}

function mapListRow(row) {
  return {
    id: row.id != null ? Number(row.id) : 0,
    uploaderName: row.truename != null ? String(row.truename) : '',
    addtime: row.addtime != null ? String(row.addtime) : '',
    truefilename: row.truefilename != null ? String(row.truefilename) : '',
    filename: row.filename != null ? String(row.filename) : '',
    filepath: row.filepath != null ? String(row.filepath) : '',
    filesizeBytes: row.filesize != null ? String(row.filesize) : '',
    filesizeDisplay: formatSystemUploadFilesizeKb(row.filesize),
  }
}

/**
 * GET /api/paper-pattern/import/files/list
 * query: page, pageSize, keyword, queryAll=1
 */
export async function handleGetPaperPatternImportFilesList(req, res) {
  try {
    const pool = await getPool()
    const userMeta = await getSysUsersColumnsMeta(pool)
    const { joinSql, uploaderSql, uploaderSearchSql } = buildPaperPatternUploaderSql(userMeta)
    const page = Math.max(1, Number(req.query?.page ?? 1) || 1)
    const pageSizeRaw = Number(req.query?.pageSize ?? 20) || 20
    const pageSize = Math.min(200, Math.max(1, pageSizeRaw))

    const queryAllRaw = String(req.query?.queryAll ?? '').trim().toLowerCase()
    const queryAll =
      queryAllRaw === '1' || queryAllRaw === 'true' || queryAllRaw === 'yes'

    const keywordRaw = String(req.query?.keyword ?? '').trim()
    const hasKeyword = !queryAll && keywordRaw.length > 0
    const kwPat = hasKeyword ? `%${escapeSqlLikePattern(keywordRaw.toLowerCase())}%` : ''

    const whereScope = `
      WHERE LOWER(LTRIM(RTRIM(CONVERT(nvarchar(max), ISNULL(f.filepath, N''))))) LIKE @scopeLike
    `

    let keywordClause = ''
    if (hasKeyword) {
      const filesizeFrag = buildFilesizeSearchSqlFragment(keywordRaw)
      keywordClause = `
        AND (
          ${uploaderSearchSql.replace(/^\s*OR\s*/, '')}
          OR LOWER(LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(f.truefilename, N''))))) LIKE @kw
          OR LOWER(LTRIM(RTRIM(CONVERT(nvarchar(50), ISNULL(f.addtime, N''))))) LIKE @kw
          ${filesizeFrag}
        )
      `
    }

    const countReq = pool.request()
    countReq.input('scopeLike', sql.NVarChar(200), FILEPATH_SCOPE_LIKE.toLowerCase())
    if (hasKeyword) {
      countReq.input('kw', sql.NVarChar(500), kwPat)
      bindFilesizeKeywordInputs(countReq, keywordRaw, kwPat)
    }
    const totalRow = await countReq.query(`
      SELECT COUNT(1) AS total
      FROM ${SYSTEM_UPLOAD_FILE_TABLE} AS f
      ${joinSql}
      ${whereScope}
      ${keywordClause}
    `)
    const total = Number(totalRow.recordset?.[0]?.total ?? 0)

    const safeOffset = (page - 1) * pageSize
    const startRow = safeOffset + 1
    const endRow = safeOffset + pageSize

    const listReq = pool.request()
    listReq.input('scopeLike', sql.NVarChar(200), FILEPATH_SCOPE_LIKE.toLowerCase())
    listReq.input('startRow', sql.Int, startRow)
    listReq.input('endRow', sql.Int, endRow)
    if (hasKeyword) {
      listReq.input('kw', sql.NVarChar(500), kwPat)
      bindFilesizeKeywordInputs(listReq, keywordRaw, kwPat)
    }

    const listResult = await listReq.query(`
      SELECT x.id, x.truename, x.addtime, x.truefilename, x.filename, x.filepath, x.filesize
      FROM (
        SELECT
          f.id,
          ${uploaderSql} AS truename,
          LTRIM(RTRIM(CONVERT(nvarchar(50), ISNULL(f.addtime, N'')))) AS addtime,
          LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(f.truefilename, N'')))) AS truefilename,
          LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(f.filename, N'')))) AS filename,
          LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(f.filepath, N'')))) AS filepath,
          LTRIM(RTRIM(CONVERT(nvarchar(50), ISNULL(f.filesize, N'')))) AS filesize,
          ROW_NUMBER() OVER (ORDER BY LTRIM(RTRIM(ISNULL(f.addtime, N''))) DESC, f.id DESC) AS rn
        FROM ${SYSTEM_UPLOAD_FILE_TABLE} AS f
        ${joinSql}
        ${whereScope}
        ${keywordClause}
      ) AS x
      WHERE x.rn BETWEEN @startRow AND @endRow
    `)

    const list = (listResult.recordset ?? []).map(mapListRow)

    res.json({
      code: 200,
      msg: 'success',
      data: { total, list, page, pageSize, queryAll: queryAll || !hasKeyword },
    })
  } catch (err) {
    console.error('GET /api/paper-pattern/import/files/list 失败：', err)
    const detail = String(err?.message ?? err?.originalError?.message ?? '数据库查询失败')
    res.status(500).json({ code: 500, msg: `读取纸格导入资料列表失败：${detail}`, data: null })
  }
}

/**
 * @param {import('mssql').Request} req
 * @param {string} keywordRaw
 * @param {string} kwPat
 */
function bindFilesizeKeywordInputs(req, keywordRaw, kwPat) {
  const part = parseFilesizeKeywordPart(keywordRaw)
  if (part.mode === 'kb') {
    req.input('kwKb', sql.NVarChar(100), `%${escapeSqlLikePattern(part.value)}%`)
    return
  }
  if (part.mode === 'bytes') {
    req.input('kwBytes', sql.NVarChar(100), `%${escapeSqlLikePattern(part.value)}%`)
    return
  }
  /* 通用关键词：filesize 字节与 KB 均用 @kw */
}
