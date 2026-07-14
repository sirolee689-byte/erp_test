/**
 * 采购报价专用保存：旧报价表的主从、采购 BOM 快照及操作日志必须在同一事务内完成。
 * 外协报价仍使用 createQuotationHandlers 的通用保存逻辑。
 */
import { sql } from './db.js'
import { getRequestIp } from './operationAuditMiddleware.js'

const HEADER = 'dbo.[UB_ERP_Buy_offer]'
const LINE = 'dbo.[UB_ERP_Buy_offer_list]'
const BOM = 'dbo.[UB_ERP_Bom_000]'
const PARTS = 'dbo.[UB_ERP_Bom_parts]'
const SNAP_HEAD = 'dbo.[UB_ERP_Bom_Buy]'
const SNAP_LIST = 'dbo.[UB_ERP_Bom_Buy_list]'
const CURRENCY = 'dbo.[UB_ERP_Finance_currency]'
const OP_LOG = 'dbo.[UB_Date_ERP_Operation_log]'
const API = '/api/supply-chain/purchase-quotations'
const KCAA_FIELDS = Array.from({ length: 35 }, (_, i) => `kcaa${String(i + 1).padStart(2, '0')}`)
const BOM_COPY_FIELDS = [
  'version', 'kcaa02_en', ...KCAA_FIELDS, 'location', 'sale_price', 'cost_price',
  // 采购报价三张落库表均无 zq、mq 列；不能沿用旧系统的字段清单。
  'Customer_Name', 'remark', 'content', 'kpname',
]

function text(v) { return String(v ?? '').trim() }
function nowText(formatter) { return formatter?.() ?? new Date().toISOString().slice(0, 19).replace('T', ' ') }
function isActive(v) { const x = text(v); return x === '' || x === '0' }
function quoteDateOk(v) { return !Number.isNaN(new Date(text(v)).getTime()) }
function objectField(row, name) {
  const key = Object.keys(row ?? {}).find((x) => x.toLowerCase() === String(name).toLowerCase())
  return key ? row[key] : undefined
}
function copyFields(source, fields) {
  const out = {}
  for (const field of fields) out[field] = objectField(source, field) ?? null
  return out
}
function actorData(actor, req, timestamp) {
  const uid = actor?.uidInt != null ? String(actor.uidInt) : text(req?.user?.userId)
  const uname = text(actor?.uname) || text(actor?.utruename) || uid
  const utruename = text(actor?.utruename) || text(actor?.uname) || uid
  return { uid, uname, utruename, addtime: timestamp, ip: getRequestIp(req) || '' }
}
function parseSupplier(value) {
  const parts = text(value).split(',').map((x) => x.trim())
  if (parts.length !== 3 || !parts[0] || !parts[1]) return null
  return { code: parts[0], name: parts[1] }
}
function parseCurrency(value) {
  const parts = text(value).split(',').map((x) => x.trim())
  if (parts.length < 2 || !parts[0] || !parts[1]) return null
  return { code: parts[0], name: parts[1] }
}
function lineGuid(line) { return text(line?.materialGuid ?? line?.cgab02 ?? line?.GUID) }
function pageSeq(line, fallback) {
  const n = Number(line?.Seq ?? line?.seq)
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : fallback
}
function safeInsertValue(value) { return value === undefined || value === '' ? null : value }

async function insertObject(tx, table, row, prefix) {
  const cols = Object.keys(row).filter((key) => row[key] !== undefined)
  if (!cols.length) return
  const req = new sql.Request(tx)
  const values = []
  for (let i = 0; i < cols.length; i++) {
    const p = `${prefix}_${i}`
    values.push(`@${p}`)
    req.input(p, safeInsertValue(row[cols[i]]))
  }
  await req.query(`INSERT INTO ${table} (${cols.map((x) => `[${x}]`).join(', ')}) VALUES (${values.join(', ')})`)
}

async function readCurrencyRate(tx, code) {
  const r = await new sql.Request(tx).input('code', sql.NVarChar(50), code).query(`
    SELECT TOP 1 [rate] FROM ${CURRENCY}
    WHERE [code]=@code AND (ISNULL([del], N'')=N'' OR [del]=N'0') AND LTRIM(RTRIM(ISNULL([pass], N'')))=N'1'
    ORDER BY [id] DESC
  `)
  return text(r.recordset?.[0]?.rate) || '1'
}

async function readBom(tx, guid) {
  const r = await new sql.Request(tx).input('guid', sql.NVarChar(500), guid).query(`
    SELECT TOP 1 * FROM ${BOM}
    WHERE LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL([GUID], N''))))=@guid
      AND (ISNULL([del], N'')=N'' OR [del]=N'0')
    ORDER BY [id] DESC
  `)
  return r.recordset?.[0] ?? null
}

async function readParts(tx, parent) {
  const r = await new sql.Request(tx).input('parent', sql.NVarChar(500), parent).query(`
    SELECT * FROM ${PARTS}
    WHERE LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL([kcac01], N''))))=@parent
      AND (ISNULL([del], N'')=N'' OR [del]=N'0')
    ORDER BY [Seq], [id]
  `)
  return r.recordset ?? []
}

async function writeSnapshotTree(tx, quoteNo, bom, audit, rowNo) {
  const materialGuid = text(objectField(bom, 'GUID'))
  const materialSystemcode = text(objectField(bom, 'systemcode')) || materialGuid
  await insertObject(tx, SNAP_HEAD, {
    sid: quoteNo,
    GUID: materialGuid,
    systemcode: materialSystemcode,
    ...copyFields(bom, BOM_COPY_FIELDS),
    uid: audit.uid, uname: audit.uname, utruename: audit.utruename, addtime: audit.addtime,
    del: '0', pass: '1', type: 1,
  }, `snap_head_${rowNo}`)

  const walk = async (parent, level, state) => {
    if (level > 4 || !parent) return
    const parts = await readParts(tx, parent)
    for (const part of parts) {
      state.index += 1
      const child = text(objectField(part, 'kcac02'))
      await insertObject(tx, SNAP_LIST, {
        sid: quoteNo,
        GUID: objectField(part, 'GUID') ?? null,
        systemcode: objectField(part, 'systemcode') ?? null,
        ...copyFields(part, BOM_COPY_FIELDS),
        kcac01: objectField(part, 'kcac01') ?? null,
        kcac02: objectField(part, 'kcac02') ?? null,
        kcac03: objectField(part, 'kcaa25') ?? null,
        kcac04: objectField(part, 'kcac04') ?? null,
        kcac05: objectField(part, 'kcac05') ?? null,
        kcac06: objectField(part, 'kcac06') ?? null,
        kcac07: objectField(part, 'kcac07') ?? null,
        kcac08: objectField(part, 'kcac08') ?? null,
        seq: objectField(part, 'Seq') ?? state.index,
        Describe: objectField(part, 'Describe') ?? null,
        uid: audit.uid, uname: audit.uname, utruename: audit.utruename, addtime: audit.addtime,
        del: '0', pass: '1', type: 1,
      }, `snap_list_${rowNo}_${state.index}`)
      if (child) await walk(child, level + 1, state)
    }
  }
  await walk(materialSystemcode, 1, { index: 0 })
}

async function insertQuoteLine(tx, quoteNo, line, bom, audit, fallbackSeq) {
  const guid = text(objectField(bom, 'GUID'))
  const systemcode = text(objectField(bom, 'systemcode')) || guid
  const note = text(line?.cgab06 ?? line?.remark)
  await insertObject(tx, LINE, {
    cgab01: quoteNo, cgab02: guid, cgab03: objectField(bom, 'kcaa05') ?? null,
    cgab04: line?.cgab04 ?? null, cgab05: line?.cgab05 ?? null, cgab06: note || null,
    Tax: line?.Tax ?? line?.tax ?? null, info: note || null, Seq: pageSeq(line, fallbackSeq),
    GUID: guid, systemcode,
    ...copyFields(bom, BOM_COPY_FIELDS),
    kcac01: guid, kcac02: systemcode, kcac03: objectField(bom, 'kcaa25') ?? null,
    kcac04: objectField(bom, 'kcac04') ?? null, kcac05: objectField(bom, 'kcac05') ?? null,
    kcac06: objectField(bom, 'kcac06') ?? null, kcac07: objectField(bom, 'kcac07') ?? null,
    kcac08: objectField(bom, 'kcac08') ?? null,
    uid: audit.uid, uname: audit.uname, utruename: audit.utruename, addtime: audit.addtime,
    del: '0', pass: '1', type: 1,
  }, `quote_line_${fallbackSeq}`)
  await writeSnapshotTree(tx, quoteNo, bom, audit, fallbackSeq)
}

async function softDeleteSnapshotTree(tx, quoteNo, rootGuid, audit) {
  const root = await new sql.Request(tx).input('sid', sql.NVarChar(50), quoteNo).input('guid', sql.NVarChar(500), rootGuid).query(`
    SELECT TOP 1 [systemcode] FROM ${SNAP_HEAD}
    WHERE [sid]=@sid AND LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL([GUID], N''))))=@guid
      AND (ISNULL([del], N'')=N'' OR [del]=N'0')
  `)
  const firstParent = text(root.recordset?.[0]?.systemcode) || rootGuid
  const seen = new Set([firstParent])
  let parents = [firstParent]
  for (let level = 1; level <= 4 && parents.length; level++) {
    const next = []
    for (const parent of parents) {
      const r = await new sql.Request(tx).input('sid', sql.NVarChar(50), quoteNo).input('parent', sql.NVarChar(500), parent).query(`
        SELECT [id], [kcac02] FROM ${SNAP_LIST}
        WHERE [sid]=@sid AND LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL([kcac01], N''))))=@parent
          AND (ISNULL([del], N'')=N'' OR [del]=N'0')
      `)
      for (const node of r.recordset ?? []) {
        const child = text(node.kcac02)
        if (child && !seen.has(child)) { seen.add(child); next.push(child) }
      }
      await new sql.Request(tx)
        .input('sid', sql.NVarChar(50), quoteNo).input('parent', sql.NVarChar(500), parent)
        .input('uid', sql.NVarChar(50), audit.uid).input('name', sql.NVarChar(50), audit.uname)
        .input('trueName', sql.NVarChar(50), audit.utruename).input('time', sql.NVarChar(50), audit.addtime)
        .query(`UPDATE ${SNAP_LIST} SET [uid]=@uid,[delname]=@name,[deltruename]=@trueName,[deltime]=@time,[del]=N'1'
          WHERE [sid]=@sid AND LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL([kcac01], N''))))=@parent
            AND (ISNULL([del], N'')=N'' OR [del]=N'0')`)
    }
    parents = next
  }
  await new sql.Request(tx)
    .input('sid', sql.NVarChar(50), quoteNo).input('guid', sql.NVarChar(500), rootGuid)
    .input('uid', sql.NVarChar(50), audit.uid).input('name', sql.NVarChar(50), audit.uname)
    .input('trueName', sql.NVarChar(50), audit.utruename).input('time', sql.NVarChar(50), audit.addtime)
    .query(`UPDATE ${SNAP_HEAD} SET [uid]=@uid,[delname]=@name,[deltruename]=@trueName,[deltime]=@time,[del]=N'1'
      WHERE [sid]=@sid AND LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL([GUID], N''))))=@guid
        AND (ISNULL([del], N'')=N'' OR [del]=N'0')`)
}

async function writeLog(tx, action, quoteNo, systemcode, audit) {
  const verb = action === 'create' ? '录入成功' : '修改成功'
  await insertObject(tx, OP_LOG, {
    uid: audit.uid, uname: audit.uname, utruename: audit.utruename, code: 'UB_ERP_Buy_offer',
    addtime: audit.addtime, systemcode, ip: audit.ip,
    act_name: action === 'create' ? '采购报价单录入' : '采购报价单修改',
    act_info: `${verb}，采购报价单号：${quoteNo}，操作时间：${audit.addtime}，操作人：${audit.utruename}`,
  }, `op_log_${action}`)
}

async function resolveFinalQuoteNo(tx, requested) {
  const exists = await new sql.Request(tx).input('no', sql.NVarChar(50), requested).query(`
    SELECT COUNT(1) AS count_value FROM ${HEADER} WHERE LTRIM(RTRIM(CONVERT(nvarchar(50), ISNULL([cgaa01], N''))))=@no
  `)
  if (Number(exists.recordset?.[0]?.count_value ?? 0) === 0) return requested
  const total = await new sql.Request(tx).query(`SELECT COUNT(1) AS count_value FROM ${HEADER}`)
  return `BJ-${String(new Date().getFullYear()).slice(-2)}${Number(total.recordset?.[0]?.count_value ?? 0) + 1}`
}

function validateHeader(header) {
  const quoteNo = text(header?.cgaa01)
  const quoteDate = text(header?.cgaa02 ?? header?.quoteDate)
  const expiry = text(header?.cgaa07 ?? header?.validUntil)
  const supplier = parseSupplier(header?.supplierCombo)
  const currency = parseCurrency(header?.currencyCombo)
  if (!quoteNo) return { error: '报价单号不能为空' }
  if (!quoteDate || !quoteDateOk(quoteDate)) return { error: '报价日期不能为空' }
  if (expiry && new Date(expiry).getTime() < new Date(quoteDate).getTime()) return { error: '有效日期不能早于报价日期' }
  if (!supplier) return { error: '供应商必须从下拉选择后保存' }
  if (!currency) return { error: '币别必须从下拉选择后保存' }
  return { quoteNo, quoteDate, expiry, supplier, currency }
}

async function handleCreate(req, res, deps) {
  let tx = null
  try {
    const header = req.body?.header ?? {}
    const check = validateHeader(header)
    if (check.error) return res.status(400).json({ code: 400, msg: `新增失败：${check.error}`, data: null })
    const systemcode = text(header.systemcode)
    if (!systemcode) return res.status(400).json({ code: 400, msg: '新增失败：缺少主表系统编码', data: null })
    const pool = await deps.getPool(); tx = new sql.Transaction(pool); await tx.begin()
    const audit = actorData(deps.getActorAuditTripletFromReq(req), req, nowText(deps.formatBomColorcodeTimestamp))
    const quoteNo = await resolveFinalQuoteNo(tx, check.quoteNo)
    const rate = await readCurrencyRate(tx, check.currency.code)
    await insertObject(tx, HEADER, {
      uid: audit.uid, uname: audit.uname, utruename: audit.utruename, addtime: audit.addtime, ip: audit.ip,
      del: '0', pass: '0', type: 1, PI: header.PI ?? null, systemcode, GUID: systemcode,
      cgaa01: quoteNo, cgaa02: check.quoteDate, cgaa03: 1, cgaa04: check.supplier.code,
      cgaa05: check.currency.code, cgaa06: header.cgaa06 ?? null, cgaa07: check.expiry || null,
      kehu: check.supplier.name, rmb: check.currency.name, rmb_hl: rate, remark: header.remark ?? null,
      decimal: header.decimal ?? header.decimal_view ?? null, decimal_view: header.decimal_view ?? header.decimal ?? null,
    }, 'quote_header')
    let index = 0
    for (const line of Array.isArray(req.body?.lines) ? req.body.lines : []) {
      const guid = lineGuid(line); if (!guid) continue
      const bom = await readBom(tx, guid)
      if (!bom) throw new Error(`物料唯一标识【${guid}】不存在或已删除`)
      index += 1; await insertQuoteLine(tx, quoteNo, line, bom, audit, index)
    }
    const inserted = await new sql.Request(tx).input('no', sql.NVarChar(50), quoteNo).query(`SELECT TOP 1 [id] FROM ${HEADER} WHERE [cgaa01]=@no ORDER BY [id] DESC`)
    await writeLog(tx, 'create', quoteNo, systemcode, audit); await tx.commit()
    return res.json({ code: 200, msg: 'success', data: { id: inserted.recordset?.[0]?.id ?? null, cgaa01: quoteNo, systemcode } })
  } catch (err) {
    if (tx) try { await tx.rollback() } catch { /* ignore */ }
    return res.status(400).json({ code: 400, msg: `新增采购报价失败：${err.message ?? err}`, data: null })
  }
}

async function handleUpdate(req, res, deps) {
  let tx = null
  try {
    const header = req.body?.header ?? {}; const check = validateHeader(header)
    if (check.error) return res.status(400).json({ code: 400, msg: `保存失败：${check.error}`, data: null })
    const id = Number(req.body?.id); if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ code: 400, msg: '参数错误：id', data: null })
    const pool = await deps.getPool(); tx = new sql.Transaction(pool); await tx.begin()
    const audit = actorData(deps.getActorAuditTripletFromReq(req), req, nowText(deps.formatBomColorcodeTimestamp))
    const current = await new sql.Request(tx).input('id', sql.Int, id).query(`SELECT TOP 1 * FROM ${HEADER} WHERE [id]=@id AND (ISNULL([del],N'')=N'' OR [del]=N'0')`)
    const old = current.recordset?.[0]
    if (!old) throw new Error('记录不存在或已删除')
    if (text(old.pass) === '1') throw new Error('已审核记录禁止修改，请先反审')
    const quoteNo = text(old.cgaa01); const systemcode = text(header.systemcode) || text(old.systemcode)
    const rate = await readCurrencyRate(tx, check.currency.code)
    await new sql.Request(tx)
      .input('id', sql.Int, id).input('upname', sql.NVarChar(50), audit.uname).input('uptrue', sql.NVarChar(50), audit.utruename)
      .input('time', sql.NVarChar(50), audit.addtime).input('ip', sql.NVarChar(50), audit.ip).input('pi', sql.NVarChar(500), header.PI ?? '')
      .input('systemcode', sql.NVarChar(50), systemcode).input('no', sql.NVarChar(50), check.quoteNo).input('date', sql.NVarChar(50), check.quoteDate)
      .input('supplier', sql.NVarChar(50), check.supplier.code).input('currency', sql.NVarChar(50), check.currency.code).input('customerNo', sql.NVarChar(50), header.cgaa06 ?? '')
      .input('expiry', sql.NVarChar(50), check.expiry || null).input('supplierName', sql.NVarChar(500), check.supplier.name).input('currencyName', sql.NVarChar(50), check.currency.name)
      .input('rate', sql.NVarChar(50), rate).input('remark', sql.NVarChar(100), header.remark ?? '').input('decimal', sql.NVarChar(50), header.decimal ?? header.decimal_view ?? '')
      .query(`UPDATE ${HEADER} SET [upname]=@upname,[uptruename]=@uptrue,[edittime]=@time,[ip]=@ip,[PI]=@pi,[systemcode]=@systemcode,[GUID]=@systemcode,[cgaa01]=@no,[cgaa02]=@date,[cgaa04]=@supplier,[cgaa05]=@currency,[cgaa06]=@customerNo,[cgaa07]=@expiry,[kehu]=@supplierName,[rmb]=@currencyName,[rmb_hl]=@rate,[remark]=@remark,[decimal]=@decimal,[decimal_view]=@decimal WHERE [id]=@id`)
    for (const guidRaw of Array.isArray(req.body?.deletedLineGuids) ? req.body.deletedLineGuids : []) {
      const guid = text(guidRaw); if (!guid) continue
      await new sql.Request(tx).input('no', sql.NVarChar(50), quoteNo).input('guid', sql.NVarChar(500), guid).input('uid', sql.NVarChar(50), audit.uid).input('name', sql.NVarChar(50), audit.uname).input('trueName', sql.NVarChar(50), audit.utruename).input('time', sql.NVarChar(50), audit.addtime).query(`UPDATE ${LINE} SET [uid]=@uid,[delname]=@name,[deltruename]=@trueName,[deltime]=@time,[del]=N'1' WHERE [cgab01]=@no AND LTRIM(RTRIM(CONVERT(nvarchar(500),ISNULL([GUID],N''))))=@guid AND (ISNULL([del],N'')=N'' OR [del]=N'0')`)
      await softDeleteSnapshotTree(tx, quoteNo, guid, audit)
    }
    let index = 0
    for (const line of Array.isArray(req.body?.lines) ? req.body.lines : []) {
      const guid = lineGuid(line); if (!guid) continue
      index += 1
      const hit = await new sql.Request(tx).input('no', sql.NVarChar(50), quoteNo).input('guid', sql.NVarChar(500), guid).query(`SELECT TOP 1 [id] FROM ${LINE} WHERE [cgab01]=@no AND LTRIM(RTRIM(CONVERT(nvarchar(500),ISNULL([GUID],N''))))=@guid AND (ISNULL([del],N'')=N'' OR [del]=N'0')`)
      if (hit.recordset?.[0]) {
        const note = text(line?.cgab06 ?? line?.remark)
        await new sql.Request(tx).input('id', sql.Int, hit.recordset[0].id).input('no', sql.NVarChar(50), quoteNo).input('guid', sql.NVarChar(500), guid).input('category', sql.NVarChar(50), line.cgab03 ?? '').input('ex', line.cgab04 ?? null).input('inc', line.cgab05 ?? null).input('note', sql.NVarChar(100), note).input('tax', line.Tax ?? line.tax ?? null).input('seq', sql.Int, pageSeq(line, index)).input('uid', sql.NVarChar(50), audit.uid).input('uname', sql.NVarChar(50), audit.uname).input('true', sql.NVarChar(50), audit.utruename).input('time', sql.NVarChar(50), audit.addtime).input('ip', sql.NVarChar(50), audit.ip).query(`UPDATE ${LINE} SET [cgab01]=@no,[cgab02]=@guid,[cgab03]=@category,[cgab04]=@ex,[cgab05]=@inc,[cgab06]=@note,[Tax]=@tax,[info]=@note,[Seq]=@seq,[uid]=@uid,[uname]=@uname,[utruename]=@true,[addtime]=@time,[ip]=@ip WHERE [id]=@id`)
      } else {
        const bom = await readBom(tx, guid); if (!bom) throw new Error(`物料唯一标识【${guid}】不存在或已删除`)
        await insertQuoteLine(tx, quoteNo, line, bom, audit, index)
      }
    }
    await writeLog(tx, 'update', check.quoteNo, systemcode, audit); await tx.commit()
    return res.json({ code: 200, msg: 'success', data: { id } })
  } catch (err) {
    if (tx) try { await tx.rollback() } catch { /* ignore */ }
    return res.status(400).json({ code: 400, msg: `保存采购报价失败：${err.message ?? err}`, data: null })
  }
}

export function registerPurchaseQuotationSaveRoutes(app, deps) {
  app.post(API, (req, res) => handleCreate(req, res, deps))
  app.put(API, (req, res) => handleUpdate(req, res, deps))
}

export const __purchaseQuotationSaveForTest = { parseSupplier, parseCurrency, pageSeq, validateHeader, BOM_COPY_FIELDS }
