import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import multer from 'multer'
import { sql } from './db.js'
import { getRequestIp } from './operationAuditMiddleware.js'
import { writeLog } from './operationLogWriter.js'

const PRINT_CONFIG_FROM = 'dbo.[UB_ERP_System_Head]'
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const DEFAULT_PRINT_IMAGE_DIR = path.resolve(__dirname, '../public/system-kernel-images')
const PRINT_IMAGE_DIR = path.resolve(process.env.ERP_PRINT_IMAGE_DIR || DEFAULT_PRINT_IMAGE_DIR)
const PRINT_IMAGE_URL_PREFIX = String(process.env.ERP_PRINT_IMAGE_URL_PREFIX || '').trim() || '/system-kernel-images'
const IMAGE_EXT_BY_MIME = new Map([
  ['image/png', '.png'],
  ['image/jpeg', '.jpg'],
  ['image/gif', '.gif'],
  ['image/webp', '.webp'],
  ['image/svg+xml', '.svg'],
])

function ensurePrintImageDir() {
  fs.mkdirSync(PRINT_IMAGE_DIR, { recursive: true })
}

const printImageUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => {
      try {
        ensurePrintImageDir()
        cb(null, PRINT_IMAGE_DIR)
      } catch (err) {
        cb(err)
      }
    },
    filename: (_req, file, cb) => {
      const ext = IMAGE_EXT_BY_MIME.get(file.mimetype) || path.extname(file.originalname || '').toLowerCase()
      cb(null, `${formatSystemPrintConfigTimestamp().replace(/[-:\s]/g, '')}-${crypto.randomBytes(8).toString('hex')}${ext || '.img'}`)
    },
  }),
  limits: { fileSize: 3 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (IMAGE_EXT_BY_MIME.has(file.mimetype)) {
      cb(null, true)
      return
    }
    cb(new Error('只允许上传 png、jpg、gif、webp、svg 图片'))
  },
})
const uploadSinglePrintImage = printImageUpload.single('image')

function text(value) {
  return String(value ?? '').trim()
}

function valueOrNull(value) {
  const v = String(value ?? '')
  return v === '' ? null : v
}

export function formatSystemPrintConfigTimestamp(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

export function buildSystemPrintSystemcode(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0')
  const ymd = `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`
  const seed = `${Date.now()}-${process.hrtime.bigint()}-${crypto.randomBytes(12).toString('hex')}`
  return `${ymd}${crypto.createHash('md5').update(seed).digest('hex').toUpperCase()}`.slice(0, 200)
}

export function parseNullableInt(value, fieldLabel) {
  if (value === undefined || value === null || value === '') return null
  const n = Number(value)
  if (!Number.isInteger(n)) {
    const err = new Error(`${fieldLabel} 必须是整数`)
    err.statusCode = 400
    throw err
  }
  return n
}

function assertCoreKey(coreKey) {
  const expected = text(process.env.ERP_CORE_CONFIG_KEY)
  if (!expected) {
    return { ok: false, status: 500, msg: '核心密钥未配置，请在 .env 中设置 ERP_CORE_CONFIG_KEY' }
  }
  const given = text(coreKey)
  if (!given) {
    return { ok: false, status: 400, msg: '核心密钥不能为空' }
  }
  const expectedBuf = Buffer.from(expected)
  const givenBuf = Buffer.from(given)
  if (expectedBuf.length !== givenBuf.length || !crypto.timingSafeEqual(expectedBuf, givenBuf)) {
    return { ok: false, status: 403, msg: '核心密钥错误，已阻止保存' }
  }
  return { ok: true }
}

function mapConfigRow(row) {
  return {
    id: row?.id ?? null,
    systemcode: text(row?.systemcode),
    code: '002',
    IT_manager: 'UB_ERP_System_Head',
    qyname: row?.qyname != null ? String(row.qyname) : '',
    qyenname: row?.qyenname != null ? String(row.qyenname) : '',
    sh: row?.sh != null ? String(row.sh) : '',
    address: row?.address != null ? String(row.address) : '',
    title: row?.title != null ? String(row.title) : '',
    entitle: row?.entitle != null ? String(row.entitle) : '',
    logo: row?.logo != null ? String(row.logo) : '',
    info: row?.info != null ? String(row.info) : '',
    cnS: row?.cnS ?? null,
    cnT: row?.cnT ?? null,
    enUS: row?.enUS ?? null,
    itIT: row?.itIT ?? null,
    bc: row?.bc ?? null,
    wxs: row?.wxs ?? null,
    index_logo: row?.index_logo != null ? String(row.index_logo) : '',
    index_img: row?.index_img != null ? String(row.index_img) : '',
    index_wx: row?.index_wx != null ? String(row.index_wx) : '',
  }
}

async function fetchFirstPrintConfig(poolOrTx) {
  const rs = await poolOrTx.request().query(`
    SELECT TOP (1)
      id,
      systemcode,
      qyname,
      qyenname,
      sh,
      address,
      title,
      entitle,
      logo,
      info,
      [cn-s] AS cnS,
      [cn-t] AS cnT,
      [en-US] AS enUS,
      [it-IT] AS itIT,
      bc,
      wxs,
      index_logo,
      index_img,
      index_wx
    FROM ${PRINT_CONFIG_FROM}
    ORDER BY id ASC
  `)
  return rs.recordset?.[0] ?? null
}

function resolvePayload(body, existing) {
  return {
    systemcode: text(body?.systemcode) || text(existing?.systemcode) || buildSystemPrintSystemcode(),
    qyname: String(body?.qyname ?? ''),
    qyenname: String(body?.qyenname ?? ''),
    sh: String(body?.sh ?? ''),
    address: String(body?.address ?? ''),
    title: String(body?.title ?? ''),
    entitle: String(body?.entitle ?? ''),
    logo: String(body?.logo ?? ''),
    info: String(body?.info ?? ''),
    cnS: parseNullableInt(body?.cnS, '系统中文语言包'),
    cnT: parseNullableInt(body?.cnT, '系统繁体语言包'),
    enUS: parseNullableInt(body?.enUS, '系统英文语言包'),
    itIT: parseNullableInt(body?.itIT, '系统意大利语言包'),
    bc: parseNullableInt(body?.bc, '补充标头/版次内容'),
    wxs: parseNullableInt(body?.wxs, '微信/二维码相关内容'),
    index_logo: String(body?.index_logo ?? ''),
    index_img: String(body?.index_img ?? ''),
    index_wx: String(body?.index_wx ?? ''),
  }
}

function bindPrintPayload(q, payload) {
  q.input('systemcode', sql.VarChar(200), valueOrNull(payload.systemcode))
  q.input('qyname', sql.NVarChar(500), valueOrNull(payload.qyname))
  q.input('qyenname', sql.NVarChar(500), valueOrNull(payload.qyenname))
  q.input('sh', sql.NVarChar(200), valueOrNull(payload.sh))
  q.input('address', sql.NVarChar(500), valueOrNull(payload.address))
  q.input('title', sql.NVarChar(120), valueOrNull(payload.title))
  q.input('entitle', sql.NVarChar(120), valueOrNull(payload.entitle))
  q.input('logo', sql.VarChar(sql.MAX), valueOrNull(payload.logo))
  q.input('info', sql.VarChar(sql.MAX), valueOrNull(payload.info))
  q.input('cnS', sql.Int, payload.cnS)
  q.input('cnT', sql.Int, payload.cnT)
  q.input('enUS', sql.Int, payload.enUS)
  q.input('itIT', sql.Int, payload.itIT)
  q.input('bc', sql.Int, payload.bc)
  q.input('wxs', sql.Int, payload.wxs)
  q.input('index_logo', sql.NVarChar(500), valueOrNull(payload.index_logo))
  q.input('index_img', sql.NVarChar(500), valueOrNull(payload.index_img))
  q.input('index_wx', sql.NVarChar(500), valueOrNull(payload.index_wx))
}

export function registerSystemPrintConfigRoutes(app, deps) {
  const { getPool } = deps

  app.post('/api/system/kernel/print-image', (req, res) => {
    uploadSinglePrintImage(req, res, (uploadErr) => {
      if (uploadErr) {
        res.status(400).json({ code: 400, msg: `上传图片失败：${uploadErr.message}`, data: null })
        return
      }
      if (!req.file) {
        res.status(400).json({ code: 400, msg: '请选择要上传的图片', data: null })
        return
      }
      const url = `${PRINT_IMAGE_URL_PREFIX}/${req.file.filename}`
      res.json({ code: 200, msg: '图片上传成功', data: { url } })
    })
  })

  app.get('/api/system/kernel/print-config', async (_req, res) => {
    try {
      const pool = await getPool()
      const existing = await fetchFirstPrintConfig(pool)
      const data = mapConfigRow(existing)
      if (!data.systemcode) data.systemcode = buildSystemPrintSystemcode()
      res.json({ code: 200, msg: 'success', data })
    } catch (err) {
      console.error('GET /api/system/kernel/print-config 失败：', err)
      const detail = String(err?.message ?? err?.originalError?.message ?? '读取失败')
      res.status(500).json({ code: 500, msg: `读取打印设定失败：${detail}`, data: null })
    }
  })

  app.put('/api/system/kernel/print-config', async (req, res) => {
    try {
      const keyCheck = assertCoreKey(req.body?.key)
      if (!keyCheck.ok) {
        res.status(keyCheck.status).json({ code: keyCheck.status, msg: keyCheck.msg, data: null })
        return
      }

      const pool = await getPool()
      const existing = await fetchFirstPrintConfig(pool)
      const payload = resolvePayload(req.body, existing)
      const now = formatSystemPrintConfigTimestamp()

      if (existing) {
        const q = pool.request()
        q.input('id', sql.Int, Number(existing.id))
        bindPrintPayload(q, payload)
        q.input('edittime', sql.NVarChar(50), now)
        await q.query(`
          UPDATE ${PRINT_CONFIG_FROM}
          SET
            systemcode = @systemcode,
            qyname = @qyname,
            qyenname = @qyenname,
            sh = @sh,
            address = @address,
            title = @title,
            entitle = @entitle,
            logo = @logo,
            info = @info,
            [cn-s] = @cnS,
            [cn-t] = @cnT,
            [en-US] = @enUS,
            [it-IT] = @itIT,
            bc = @bc,
            wxs = @wxs,
            index_logo = @index_logo,
            index_img = @index_img,
            index_wx = @index_wx,
            edittime = @edittime
          WHERE id = @id
        `)
      } else {
        const q = pool.request()
        bindPrintPayload(q, payload)
        q.input('addtime', sql.NVarChar(50), now)
        q.input('ip', sql.NVarChar(256), getRequestIp(req) || '')
        await q.query(`
          INSERT INTO ${PRINT_CONFIG_FROM}
            (systemcode, qyname, qyenname, sh, address, title, entitle, logo, info,
             [cn-s], [cn-t], [en-US], [it-IT], bc, wxs, index_logo, index_img, index_wx,
             addtime, ip)
          VALUES
            (@systemcode, @qyname, @qyenname, @sh, @address, @title, @entitle, @logo, @info,
             @cnS, @cnT, @enUS, @itIT, @bc, @wxs, @index_logo, @index_img, @index_wx,
             @addtime, @ip)
        `)
      }

      await writeLog(req, '保存打印设定', `打印设定保存成功，核心编码：${payload.systemcode}`, {
        targetTable: 'UB_ERP_System_Head',
        systemcode: payload.systemcode,
        pool,
      })

      res.json({
        code: 200,
        msg: '打印设定保存成功',
        data: mapConfigRow({ ...payload, id: existing?.id ?? null }),
      })
    } catch (err) {
      console.error('PUT /api/system/kernel/print-config 失败：', err)
      const detail = String(err?.message ?? err?.originalError?.message ?? '保存失败')
      const status = Number(err?.statusCode) || 500
      res.status(status).json({ code: status, msg: `保存打印设定失败：${detail}`, data: null })
    }
  })
}
