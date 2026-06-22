import { sql } from './db.js'
import { INV_BOM_MASTER_FROM } from './bomTables.js'
import { BUY_LINE_KCAA_FIELDS, normalizeBuyOrderLines } from './buyOrderLineSave.js'
import { formatSalesOrderAuditTime } from './salesOrderPiBom.js'

const SNAP_HEAD_FROM = 'dbo.[UB_ERP_Bom_buy_order]'
const SNAP_LIST_FROM = 'dbo.[UB_ERP_Bom_buy_order_list]'
const PARTS_FROM = 'dbo.[UB_ERP_Bom_parts]'

function text(v) {
  return String(v ?? '').trim()
}

function nullableText(v) {
  const s = text(v)
  return s || null
}

function nullableNumber(v) {
  if (v === '' || v == null) return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

async function fetchBomBySystemcode(db, systemcode) {
  const code = text(systemcode)
  if (!code) return null
  const r = await new sql.Request(db).input('systemcode', sql.NVarChar(500), code).query(`
    SELECT TOP 1 *
    FROM ${INV_BOM_MASTER_FROM}
    WHERE LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL([systemcode], ISNULL([GUID], N''))))) = @systemcode
      AND (ISNULL([del], N'') = N'' OR [del] = N'0')
    ORDER BY [id] DESC
  `)
  return r.recordset?.[0] ?? null
}

async function fetchParts(db, parentSystemcode) {
  const r = await new sql.Request(db).input('parent', sql.NVarChar(500), parentSystemcode).query(`
    SELECT *
    FROM ${PARTS_FROM}
    WHERE LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL([kcac01], N'')))) = @parent
      AND (ISNULL([del], N'') = N'' OR [del] = N'0')
    ORDER BY ISNULL([Seq], [seq]), [id]
  `)
  return r.recordset ?? []
}

function bindKcaa(req, row) {
  for (const col of BUY_LINE_KCAA_FIELDS) req.input(col, sql.NVarChar(500), nullableText(row?.[col]))
}

async function insertHead(db, orderNo, bom, seq, audit) {
  const req = new sql.Request(db)
  const guidAndSystemcode = text(bom.GUID ?? bom.systemcode)
  req.input('sid', sql.NVarChar(200), orderNo)
  req.input('GUID', sql.NVarChar(500), guidAndSystemcode)
  req.input('systemcode', sql.NVarChar(500), guidAndSystemcode)
  req.input('seq', sql.Int, seq)
  req.input('kcaa02_en', sql.NVarChar(500), nullableText(bom.kcaa02_en))
  req.input('type', sql.Int, nullableNumber(bom.type) ?? 1)
  req.input('location', sql.NVarChar(500), nullableText(bom.location))
  req.input('sale_price', sql.Decimal(18, 6), nullableNumber(bom.sale_price))
  req.input('cost_price', sql.Decimal(18, 6), nullableNumber(bom.cost_price))
  req.input('version', sql.Int, nullableNumber(bom.version) ?? 100)
  req.input('uid', sql.NVarChar(50), audit?.uid ?? '')
  req.input('uname', sql.NVarChar(200), audit?.uname ?? '')
  req.input('utruename', sql.NVarChar(200), audit?.utruename ?? '')
  req.input('addtime', sql.NVarChar(50), audit?.addtime ?? '')
  req.input('pass', sql.NVarChar(20), text(bom.pass) || '1')
  bindKcaa(req, bom)
  await req.query(`
    INSERT INTO ${SNAP_HEAD_FROM} ([sid], [GUID], [systemcode], [seq], [kcaa01], [kcaa02], [kcaa03], [kcaa04], [kcaa05], [kcaa06], [kcaa07], [kcaa08], [kcaa09], [kcaa10], [kcaa11], [kcaa12], [kcaa13], [kcaa14], [kcaa15], [kcaa16], [kcaa17], [kcaa18], [kcaa19], [kcaa20], [kcaa21], [kcaa22], [kcaa23], [kcaa24], [kcaa25], [kcaa26], [kcaa27], [kcaa28], [kcaa29], [kcaa30], [kcaa31], [kcaa32], [kcaa33], [kcaa34], [kcaa35], [kcaa02_en], [type], [location], [sale_price], [cost_price], [version], [uid], [uname], [utruename], [addtime], [pass])
    VALUES (@sid, @GUID, @systemcode, @seq, @kcaa01, @kcaa02, @kcaa03, @kcaa04, @kcaa05, @kcaa06, @kcaa07, @kcaa08, @kcaa09, @kcaa10, @kcaa11, @kcaa12, @kcaa13, @kcaa14, @kcaa15, @kcaa16, @kcaa17, @kcaa18, @kcaa19, @kcaa20, @kcaa21, @kcaa22, @kcaa23, @kcaa24, @kcaa25, @kcaa26, @kcaa27, @kcaa28, @kcaa29, @kcaa30, @kcaa31, @kcaa32, @kcaa33, @kcaa34, @kcaa35, @kcaa02_en, @type, @location, @sale_price, @cost_price, @version, @uid, @uname, @utruename, @addtime, @pass)
  `)
}

async function insertPart(db, orderNo, part, level, seq) {
  const req = new sql.Request(db)
  req.input('sid', sql.NVarChar(200), orderNo)
  req.input('seq', sql.Int, seq)
  req.input('kcac01', sql.NVarChar(500), nullableText(part.kcac01))
  req.input('kcac02', sql.NVarChar(500), nullableText(part.kcac02))
  req.input('kcac03', sql.NVarChar(500), nullableText(part.kcac03))
  req.input('kcaa01', sql.NVarChar(500), nullableText(part.kcaa01))
  req.input('kcaa02', sql.NVarChar(500), nullableText(part.kcaa02))
  req.input('kcaa03', sql.NVarChar(500), nullableText(part.kcaa03))
  req.input('remark', sql.NVarChar(1000), nullableText(part.remark))
  await req.query(`
    INSERT INTO ${SNAP_LIST_FROM} ([sid], [seq], [kcac01], [kcac02], [kcac03], [kcaa01], [kcaa02], [kcaa03], [remark])
    VALUES (@sid, @seq, @kcac01, @kcac02, @kcac03, @kcaa01, @kcaa02, @kcaa03, @remark)
  `)
}

async function expandParts(db, orderNo, parentSystemcode, level, state) {
  if (level > 6 || !parentSystemcode) return
  const parts = await fetchParts(db, parentSystemcode)
  for (const part of parts) {
    state.seq += 1
    await insertPart(db, orderNo, part, level, state.seq)
    const child = text(part.kcac02 ?? part.systemcode)
    if (child && !state.visited.has(`${level}:${child}`)) {
      state.visited.add(`${level}:${child}`)
      await expandParts(db, orderNo, child, level + 1, state)
    }
  }
}

export async function rewriteBuyOrderBomSnapshots({ buyOrderNo, lines, header, tx, actor = null }) {
  const orderNo = text(buyOrderNo)
  const auditActor = actor ?? { uidInt: null, uname: null, utruename: null }
  const audit = {
    uid: auditActor.uidInt != null ? String(auditActor.uidInt) : '',
    uname: text(auditActor.uname),
    utruename: text(auditActor.utruename),
    addtime: formatSalesOrderAuditTime(),
  }
  await new sql.Request(tx).input('sid', sql.NVarChar(200), orderNo).query(`
    DELETE FROM ${SNAP_HEAD_FROM} WHERE LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL([sid], N'')))) = @sid;
    DELETE FROM ${SNAP_LIST_FROM} WHERE LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL([sid], N'')))) = @sid;
  `)
  const normalized = normalizeBuyOrderLines(lines, header)
  let headSeq = 0
  const state = { seq: 0, visited: new Set() }
  for (const line of normalized) {
    const bom = await fetchBomBySystemcode(tx, line.bomSystemCode || line.systemCode)
    if (!bom) continue
    headSeq += 1
    await insertHead(tx, orderNo, bom, headSeq, audit)
    const parent = text(bom.systemcode ?? bom.GUID)
    if (parent) await expandParts(tx, orderNo, parent, 1, state)
  }
  return { headCount: headSeq, partCount: state.seq }
}
