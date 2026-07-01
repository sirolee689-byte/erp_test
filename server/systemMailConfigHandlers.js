import crypto from 'node:crypto'
import { sql } from './db.js'
import { getRequestIp } from './operationAuditMiddleware.js'
import { writeLog } from './operationLogWriter.js'

const MAIL_CONFIG_FROM = 'dbo.[UB_ERP_System_mail]'
const PASSWORD_PREFIX = 'enc:v1:'
const MAX_MAIL_PASSWORD_BYTES = 336

function text(value) {
  return String(value ?? '').trim()
}

export function formatSystemMailConfigTimestamp(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

export function buildSystemMailSystemcode(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0')
  const ymd = `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`
  const seed = `${Date.now()}-${process.hrtime.bigint()}-${crypto.randomBytes(12).toString('hex')}`
  return `${ymd}${crypto.createHash('md5').update(seed).digest('hex').toUpperCase()}`.slice(0, 50)
}

function deriveAesKey(rawKey) {
  const key = text(rawKey)
  if (!key) {
    throw new Error('邮件密码加密密钥未配置，请在 .env 中设置 ERP_MAIL_CRYPTO_KEY')
  }
  return crypto.createHash('sha256').update(key, 'utf8').digest()
}

export function encryptMailPassword(plainPassword, rawKey) {
  const plain = String(plainPassword ?? '')
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', deriveAesKey(rawKey), iv)
  const encrypted = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return `${PASSWORD_PREFIX}${iv.toString('base64')}:${tag.toString('base64')}:${encrypted.toString('base64')}`
}

function mapConfigRow(row) {
  const passwordStored = text(row?.ConstMailServerPassword)
  return {
    id: row?.id ?? null,
    systemcode: text(row?.systemcode),
    code: '005',
    IT_manager: 'UB_ERP_System_mail',
    ConstFromNameCn: row?.ConstFromNameCn != null ? String(row.ConstFromNameCn) : '',
    ConstFromNameEn: row?.ConstFromNameEn != null ? String(row.ConstFromNameEn) : '',
    ConstFrom: row?.ConstFrom != null ? String(row.ConstFrom) : '',
    ConstMailDomain: row?.ConstMailDomain != null ? String(row.ConstMailDomain) : '',
    ConstMailServerUserName:
      row?.ConstMailServerUserName != null ? String(row.ConstMailServerUserName) : '',
    hasPassword: Boolean(passwordStored),
  }
}

async function fetchFirstMailConfig(poolOrTx) {
  const rs = await poolOrTx.request().query(`
    SELECT TOP (1)
      id,
      systemcode,
      ConstFromNameCn,
      ConstFromNameEn,
      ConstFrom,
      ConstMailDomain,
      ConstMailServerUserName,
      ConstMailServerPassword
    FROM ${MAIL_CONFIG_FROM}
    ORDER BY id ASC
  `)
  return rs.recordset?.[0] ?? null
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

function resolvePayload(body, existing) {
  const password = String(body?.ConstMailServerPassword ?? '')
  const hasNewPassword = password.length > 0
  if (hasNewPassword && Buffer.byteLength(password, 'utf8') > MAX_MAIL_PASSWORD_BYTES) {
    const err = new Error('邮箱密码过长，请控制在 336 字节以内')
    err.statusCode = 400
    throw err
  }
  return {
    systemcode: text(body?.systemcode) || text(existing?.systemcode) || buildSystemMailSystemcode(),
    ConstFromNameCn: String(body?.ConstFromNameCn ?? ''),
    ConstFromNameEn: String(body?.ConstFromNameEn ?? ''),
    ConstFrom: String(body?.ConstFrom ?? ''),
    ConstMailDomain: String(body?.ConstMailDomain ?? ''),
    ConstMailServerUserName: String(body?.ConstMailServerUserName ?? ''),
    ConstMailServerPassword: hasNewPassword
      ? encryptMailPassword(password, process.env.ERP_MAIL_CRYPTO_KEY)
      : existing
        ? existing.ConstMailServerPassword
        : null,
  }
}

export function registerSystemMailConfigRoutes(app, deps) {
  const { getPool } = deps

  app.get('/api/system/kernel/mail-config', async (_req, res) => {
    try {
      const pool = await getPool()
      const existing = await fetchFirstMailConfig(pool)
      const data = mapConfigRow(existing)
      if (!data.systemcode) data.systemcode = buildSystemMailSystemcode()
      res.json({ code: 200, msg: 'success', data })
    } catch (err) {
      console.error('GET /api/system/kernel/mail-config 失败：', err)
      const detail = String(err?.message ?? err?.originalError?.message ?? '读取失败')
      res.status(500).json({ code: 500, msg: `读取系统EMAIL配置失败：${detail}`, data: null })
    }
  })

  app.put('/api/system/kernel/mail-config', async (req, res) => {
    try {
      const keyCheck = assertCoreKey(req.body?.key)
      if (!keyCheck.ok) {
        res.status(keyCheck.status).json({ code: keyCheck.status, msg: keyCheck.msg, data: null })
        return
      }

      const pool = await getPool()
      const existing = await fetchFirstMailConfig(pool)
      const payload = resolvePayload(req.body, existing)
      const now = formatSystemMailConfigTimestamp()

      if (existing) {
        const q = pool.request()
        q.input('id', sql.Int, Number(existing.id))
        q.input('systemcode', sql.NVarChar(50), payload.systemcode)
        q.input('ConstFromNameCn', sql.NVarChar(500), payload.ConstFromNameCn)
        q.input('ConstFromNameEn', sql.NVarChar(500), payload.ConstFromNameEn)
        q.input('ConstFrom', sql.NVarChar(50), payload.ConstFrom)
        q.input('ConstMailDomain', sql.NVarChar(510), payload.ConstMailDomain)
        q.input('ConstMailServerUserName', sql.NVarChar(500), payload.ConstMailServerUserName)
        q.input('ConstMailServerPassword', sql.NVarChar(500), payload.ConstMailServerPassword)
        q.input('editime', sql.NVarChar(50), now)
        await q.query(`
          UPDATE ${MAIL_CONFIG_FROM}
          SET
            systemcode = @systemcode,
            ConstFromNameCn = @ConstFromNameCn,
            ConstFromNameEn = @ConstFromNameEn,
            ConstFrom = @ConstFrom,
            ConstMailDomain = @ConstMailDomain,
            ConstMailServerUserName = @ConstMailServerUserName,
            ConstMailServerPassword = @ConstMailServerPassword,
            editime = @editime
          WHERE id = @id
        `)
      } else {
        const q = pool.request()
        q.input('systemcode', sql.NVarChar(50), payload.systemcode)
        q.input('ConstFromNameCn', sql.NVarChar(500), payload.ConstFromNameCn)
        q.input('ConstFromNameEn', sql.NVarChar(500), payload.ConstFromNameEn)
        q.input('ConstFrom', sql.NVarChar(50), payload.ConstFrom)
        q.input('ConstMailDomain', sql.NVarChar(510), payload.ConstMailDomain)
        q.input('ConstMailServerUserName', sql.NVarChar(500), payload.ConstMailServerUserName)
        q.input('ConstMailServerPassword', sql.NVarChar(500), payload.ConstMailServerPassword)
        q.input('addtime', sql.NVarChar(50), now)
        q.input('ip', sql.NVarChar(50), getRequestIp(req) || '')
        await q.query(`
          INSERT INTO ${MAIL_CONFIG_FROM}
            (systemcode, ConstFromNameCn, ConstFromNameEn, ConstFrom, ConstMailDomain,
             ConstMailServerUserName, ConstMailServerPassword, addtime, ip, del, pass)
          VALUES
            (@systemcode, @ConstFromNameCn, @ConstFromNameEn, @ConstFrom, @ConstMailDomain,
             @ConstMailServerUserName, @ConstMailServerPassword, @addtime, @ip, N'0', N'1')
        `)
      }

      await writeLog(req, '保存系统EMAIL配置', `系统EMAIL配置保存成功，核心编码：${payload.systemcode}`, {
        targetTable: 'UB_ERP_System_mail',
        systemcode: payload.systemcode,
        pool,
      })

      res.json({
        code: 200,
        msg: '系统EMAIL配置保存成功',
        data: {
          ...mapConfigRow({ ...payload, id: existing?.id ?? null }),
          hasPassword: Boolean(payload.ConstMailServerPassword),
        },
      })
    } catch (err) {
      console.error('PUT /api/system/kernel/mail-config 失败：', err)
      const detail = String(err?.message ?? err?.originalError?.message ?? '保存失败')
      const status = Number(err?.statusCode) || 500
      res.status(status).json({ code: status, msg: `保存系统EMAIL配置失败：${detail}`, data: null })
    }
  })
}
