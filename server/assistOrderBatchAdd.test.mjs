import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import {
  buildAssistBatchLineKey,
  buildAssistBatchOutsourcedMaps,
  buildAssistBatchChildOutboundQtyMap,
  buildAssistBatchChildrenByParentMap,
  formatAssistBatchOutboundQtyLabel,
  resolveAssistBatchOutboundChildCodes,
  getBuyOfferPriceOrZero,
  getAssistOfferPriceOrZero,
  buildBomQtyMapFromCostLines,
  buildCurrentLineQtyMap,
  buildFirstBomQtyMapFromCostLines,
  buildPiCostPxMapFromCostLines,
  calcAvailableQty,
  classifyBatchAddMaterialPath,
  fetchAssistOrderBatchAddTree,
  filterBatchAddMaterialRows,
  kcaa01MatchesBomCodeAssistBatchPrefix,
  mergeAssistOfferPriceRows,
  mergeBuyOfferPriceRows,
  mergeBatchAddMaterialRows,
  normalizeAssistOfferPrice,
  normalizeBuyOfferPrice,
  resolveBatchAddBomQty,
  resolveBatchAddCodeColor,
  sortBatchAddMaterialRows,
} from './assistOrderBatchAdd.js'

describe('assistOrderBatchAdd', () => {
  test('buildAssistBatchLineKey normalizes parts', () => {
    const key = buildAssistBatchLineKey(' PI-01 ', ' STYLE-A ', ' M-001 ')
    assert.equal(key, 'pi-01|style-a|m-001')
  })

  test('buildBomQtyMapFromCostLines sums kcac06 * orderQty', () => {
    const map = buildBomQtyMapFromCostLines([
      { pq: 'P1', kcaa01: 'M1', kcac06: 1.1, orderQty: 100 },
      { pq: 'P1', kcaa01: 'M1', kcac06: 0.5, orderQty: 100 },
      { pq: 'P1', kcaa01: 'M2', kcac06: 2, orderQty: 100 },
    ])
    assert.equal(map.get('p1|m1'), 160)
    assert.equal(map.get('p1|m2'), 200)
  })

  test('buildCurrentLineQtyMap aggregates wxak03 by line key', () => {
    const map = buildCurrentLineQtyMap(
      [
        { piNo: 'PI1', product: 'P1', kcaa01: 'M1', wxak03: 2 },
        { piNo: 'PI1', product: 'P1', kcaa01: 'M1', wxak03: 3 },
      ],
      'PI1',
    )
    assert.equal(map.get('pi1|p1|m1'), 5)
  })

  test('calcAvailableQty never goes below zero', () => {
    assert.equal(calcAvailableQty(10, 4, 3), 3)
    assert.equal(calcAvailableQty(5, 8, 0), 0)
  })

  test('buildAssistBatchOutsourcedMaps maps wxak03 by line key', () => {
    const { outsourcedDbMap } = buildAssistBatchOutsourcedMaps([
      { piNo: 'PI-1', product: 'PQ-A', kcaa01: 'M-1', outsourcedQty: 10 },
      { piNo: 'PI-1', product: 'PQ-A', kcaa01: 'M-2', outsourcedQty: 2 },
    ])
    assert.equal(outsourcedDbMap.get('pi-1|pq-a|m-1'), 10)
    assert.equal(outsourcedDbMap.get('pi-1|pq-a|m-2'), 2)
  })

  test('buildAssistBatchChildOutboundQtyMap maps child stock-out qty to parent key (incl unaudited)', () => {
    const childrenByParent = new Map([['bp-0080/1011', ['BP-0038/-']]])
    const map = buildAssistBatchChildOutboundQtyMap(
      [
        {
          piNo: 'PI-4181',
          product: 'PQ-3796B1/N',
          kcaa01: 'BP-0080/1011',
          assistOrderNo: 'WX26062902',
        },
      ],
      childrenByParent,
      [
        { assistOrderNo: 'WX26062902', kcaa01: 'BP-0038/-', qty: 7 },
        { assistOrderNo: 'WX26062902', kcaa01: 'OTHER/-', qty: 99 },
        { assistOrderNo: 'WX-OTHER', kcaa01: 'BP-0038/-', qty: 5 },
      ],
    )
    const key = buildAssistBatchLineKey('PI-4181', 'PQ-3796B1/N', 'BP-0080/1011')
    assert.equal(map.get(key), 7)
    assert.equal(formatAssistBatchOutboundQtyLabel(map.get(key)), '7')
    assert.notEqual(formatAssistBatchOutboundQtyLabel(map.get(key)), '待开发')
  })

  test('resolveAssistBatchOutboundChildCodes falls back to parent when no bom children', () => {
    assert.deepEqual(resolveAssistBatchOutboundChildCodes('BP-SELF/-', new Map()), ['BP-SELF/-'])
    assert.deepEqual(
      resolveAssistBatchOutboundChildCodes('BP-0080/1011', new Map([['bp-0080/1011', ['BP-0038/-']]])),
      ['BP-0038/-'],
    )
  })

  test('buildAssistBatchChildrenByParentMap reads bom parts by parent systemcode', () => {
    const bomHeadMap = new Map([
      ['bp-0080/1011', { systemcode: 'PARENT-GUID-1' }],
    ])
    const bomPartsMap = new Map([
      ['parent-guid-1', [{ kcaa01: 'BP-0038/-' }, { kcaa01: 'BP-0038/-' }]],
    ])
    const children = buildAssistBatchChildrenByParentMap(bomHeadMap, bomPartsMap, ['BP-0080/1011'])
    assert.deepEqual(children.get('bp-0080/1011'), ['BP-0038/-'])
  })

  test('normalizes assist offer price values', () => {
    assert.deepEqual(
      normalizeAssistOfferPrice({ wxab04: '1.2345', wxab05: '1.3950', tax: '0.13' }),
      { wxab04: 1.2345, wxab05: 1.395, tax: 0.13 },
    )
    assert.deepEqual(normalizeAssistOfferPrice({ wxab04: 'bad' }), {
      wxab04: 0,
      wxab05: 0,
      tax: 0,
    })
  })

  test('assist offer price map prefers supplier match over material fallback', () => {
    const map = mergeAssistOfferPriceRows(
      [{ kcaa01: ' MAT-1 ', wxab04: 8, wxab05: 9.04, tax: 0.13 }],
      [
        { kcaa01: 'MAT-1', wxab04: 6, wxab05: 6.78, tax: 0.13 },
        { kcaa01: 'MAT-2', wxab04: 3, wxab05: 3.39, tax: 0.13 },
      ],
    )

    assert.deepEqual(getAssistOfferPriceOrZero(map, 'MAT-1'), {
      wxab04: 8,
      wxab05: 9.04,
      tax: 0.13,
    })
    assert.deepEqual(getAssistOfferPriceOrZero(map, 'MAT-2'), {
      wxab04: 3,
      wxab05: 3.39,
      tax: 0.13,
    })
    assert.deepEqual(getAssistOfferPriceOrZero(map, 'MAT-404'), {
      wxab04: 0,
      wxab05: 0,
      tax: 0,
    })
  })

  test('buy offer price map uses material systemcode for outbound batch add', () => {
    const map = mergeBuyOfferPriceRows([
      { systemcode: ' SYS-1 ', cgab04: '12.5', cgab05: '14.125', tax: '0.13' },
      { systemcode: 'SYS-1', cgab04: 9, cgab05: 10.17, tax: 0.13 },
      { cgab02: 'SYS-2', cgab04: 3, cgab05: 3.39, tax: 0.13 },
    ])

    assert.deepEqual(normalizeBuyOfferPrice({ cgab04: 'bad', cgab05: 2, tax: null }), {
      wxab04: 0,
      wxab05: 2,
      tax: 0,
    })
    assert.deepEqual(getBuyOfferPriceOrZero(map, 'SYS-1'), {
      wxab04: 12.5,
      wxab05: 14.125,
      tax: 0.13,
    })
    assert.deepEqual(getBuyOfferPriceOrZero(map, 'SYS-2'), {
      wxab04: 3,
      wxab05: 3.39,
      tax: 0.13,
    })
    assert.deepEqual(getBuyOfferPriceOrZero(map, 'SYS-404'), {
      wxab04: 0,
      wxab05: 0,
      tax: 0,
    })
  })

  test('assist offer price SQL uses legacy tables and SQL Server 2008 compatible syntax', async () => {
    const source = await import('node:fs/promises').then((fs) =>
      fs.readFile(new URL('./assistOrderBatchAdd.js', import.meta.url), 'utf8'),
    )
    assert.match(source, /UB_ERP_assist_offer/)
    assert.match(source, /UB_ERP_assist_offer_list/)
    assert.match(source, /UB_ERP_Buy_offer_list/)
    assert.match(source, /cgab02/)
    assert.match(source, /ROW_NUMBER\(\) OVER/)
    assert.doesNotMatch(source, /\bOFFSET\b/i)
    assert.doesNotMatch(source, /\bTRY_CONVERT\b/i)
    assert.doesNotMatch(source, /\bTRY_CAST\b/i)
  })

  test('buildFirstBomQtyMapFromCostLines uses first kcac06 only', () => {
    const map = buildFirstBomQtyMapFromCostLines([
      { pq: 'P1', kcaa01: 'M1', kcac06: 1.1, orderQty: 100 },
      { pq: 'P1', kcaa01: 'M1', kcac06: 0.5, orderQty: 100 },
      { pq: 'P1', kcaa01: 'M2', kcac06: 2, orderQty: 100 },
    ])
    assert.equal(map.get('p1|m1'), 110)
    assert.equal(map.get('p1|m2'), 200)
  })

  test('filterBatchAddMaterialRows dedupes by kcaa01 and hides non-outsource', () => {
    const rows = filterBatchAddMaterialRows([
      { kcaa01: 'M1', isOutsource: 1, kcaa02: 'first' },
      { kcaa01: 'M1', isOutsource: 1, kcaa02: 'dup' },
      { kcaa01: 'M2', isOutsource: 0, kcaa02: 'hidden' },
      { kcaa01: 'M3', isOutsource: 1, kcaa02: 'ok' },
    ])
    assert.equal(rows.length, 2)
    assert.equal(rows[0].kcaa02, 'first')
    assert.equal(rows[1].kcaa02, 'ok')
  })

  test('filterBatchAddMaterialRows prefers later outsource over earlier non-outsource same code', () => {
    const rows = filterBatchAddMaterialRows([
      { kcaa01: 'BN-0008/-', isOutsource: 0, kcaa02: 'other-cut' },
      { kcaa01: 'BN-0008/-', isOutsource: 1, kcaa02: 'under-bn0005' },
      { kcaa01: 'BN-0005/-', isOutsource: 1, kcaa02: 'parent' },
    ])
    assert.equal(rows.length, 2)
    assert.equal(rows[0].kcaa02, 'under-bn0005')
    assert.equal(rows[1].kcaa02, 'parent')
  })

  test('mergeBatchAddMaterialRows prefers outsource when same kcaa01 appears twice', () => {
    const merged = mergeBatchAddMaterialRows(
      [
        { kcaa01: 'BN-0008/-', isOutsource: 0, kcaa02: 'strap-cut' },
        { kcaa01: 'BN-0005/-', isOutsource: 1, kcaa02: 'parent' },
        { kcaa01: 'BN-0008/-', isOutsource: 1, kcaa02: 'under-bn0005' },
      ],
      [],
      'PQ-3796B1/N',
      ['BAG', 'CUT', 'PQ'],
    )
    const bn8 = merged.filter((r) => String(r.kcaa01).toUpperCase() === 'BN-0008/-')
    assert.equal(bn8.length, 1)
    assert.equal(bn8[0].isOutsource, 1)
    assert.equal(bn8[0].kcaa02, 'under-bn0005')
  })

  test('mergeBatchAddMaterialRows keeps earlier outsource when later is non-outsource', () => {
    const merged = mergeBatchAddMaterialRows(
      [
        { kcaa01: 'BN-0008/-', isOutsource: 1, kcaa02: 'under-bn0005' },
        { kcaa01: 'BN-0008/-', isOutsource: 0, kcaa02: 'other-cut' },
      ],
      [],
      'PQ-1',
      [],
    )
    assert.equal(merged.length, 1)
    assert.equal(merged[0].kcaa02, 'under-bn0005')
  })

  test('pi_cost outsource qty for BN-0008 under BN-0005 rounds to 2.62', () => {
    const map = buildFirstBomQtyMapFromCostLines([
      { pq: 'PQ-3796B1/N', kcaa01: 'BN-0005/-', kcac06: 0.02617, orderQty: 100 },
      { pq: 'PQ-3796B1/N', kcaa01: 'BN-0008/-', kcac06: 0.02617, orderQty: 100 },
    ])
    const bomQty = map.get('pq-3796b1/n|bn-0008/-')
    assert.equal(bomQty, 2.617)
    assert.equal(calcAvailableQty(bomQty, 0, 0), 2.62)
  })

  test('kcaa01MatchesBomCodeAssistBatchPrefix follows legacy bomstr', () => {
    assert.equal(kcaa01MatchesBomCodeAssistBatchPrefix('BAG-001', 'BAG'), true)
    assert.equal(kcaa01MatchesBomCodeAssistBatchPrefix('PQ-3633A1/BLU4', 'PQ'), true)
    assert.equal(kcaa01MatchesBomCodeAssistBatchPrefix('XX-OUT', 'OUT'), true)
    assert.equal(kcaa01MatchesBomCodeAssistBatchPrefix('RP-001', 'BAG'), false)
  })

  test('resolveBatchAddCodeColor uses UB_ERP_Bom_code flag5 prefix only', () => {
    const prefixes = ['PQ', 'BAG', 'OUT']
    assert.equal(
      resolveBatchAddCodeColor({ kcaa01: 'RP-001', bomCodePrefixes: prefixes }),
      'pi_cost',
    )
    assert.equal(
      resolveBatchAddCodeColor({ kcaa01: 'BAG-001', bomCodePrefixes: prefixes }),
      'sales_list',
    )
    assert.equal(
      resolveBatchAddCodeColor({ kcaa01: 'PQ-3633A1/BLU4', bomCodePrefixes: prefixes }),
      'sales_list',
    )
    assert.equal(
      resolveBatchAddCodeColor({ kcaa01: 'XX-OUT', bomCodePrefixes: prefixes }),
      'sales_list',
    )
  })

  test('mergeBatchAddMaterialRows appends semi-finished not in pkcaa01 tree', () => {
    const merged = mergeBatchAddMaterialRows(
      [{ kcaa01: 'RP-001', isOutsource: 1 }],
      [
        { product: 'PQ-1', kcaa03: 'PQ-1', kcaa01: 'BAG-001', isOutsource: 1 },
        { product: 'PQ-1', kcaa03: 'PQ-1', kcaa01: 'RP-001', isOutsource: 1 },
      ],
      'PQ-1',
      ['BAG'],
    )
    assert.equal(merged.length, 2)
    assert.equal(merged[0].kcaa01, 'RP-001')
    assert.equal(merged[1].kcaa01, 'BAG-001')
  })

  test('mergeBatchAddMaterialRows skips prefix codes in pkcaa01 subtree', () => {
    const merged = mergeBatchAddMaterialRows(
      [{ kcaa01: 'TAG-PQ-1', isOutsource: 1 }],
      [
        {
          product: 'PQ-1',
          kcaa03: 'PQ-1',
          kcaa01: 'TAG-PQ-1',
          isOutsource: 1,
          kcac04: 1.5,
        },
      ],
      'PQ-1',
      ['TAG'],
    )
    assert.equal(merged.length, 1)
    assert.equal(merged[0].kcaa01, 'TAG-PQ-1')
    assert.equal(merged[0].kcac04, 1.5)
  })

  test('classifyBatchAddMaterialPath splits three legacy paths', () => {
    const prefixes = ['TAG', 'BAG']
    assert.equal(
      classifyBatchAddMaterialPath({ kcaa01: 'RP-001' }, 'PQ-1', prefixes),
      'pi_cost_red',
    )
    assert.equal(
      classifyBatchAddMaterialPath({ kcaa01: 'TAG-001', kcaa03: 'PQ-1' }, 'PQ-1', prefixes),
      'sales_list_blue',
    )
    assert.equal(
      classifyBatchAddMaterialPath({ kcaa01: 'BAG-002', kcaa03: 'OTHER' }, 'PQ-1', prefixes),
      'pi_cost_blue',
    )
  })

  test('buildPiCostPxMapFromCostLines keeps first px per product|material', () => {
    const map = buildPiCostPxMapFromCostLines([
      { pq: 'P1', kcaa01: 'M1', px: 30 },
      { pq: 'P1', kcaa01: 'M1', px: 10 },
      { pq: 'P1', kcaa01: 'M2', px: 5 },
    ])
    assert.equal(map.get('p1|m1'), 30)
    assert.equal(map.get('p1|m2'), 5)
  })

  test('sortBatchAddMaterialRows orders red by px, sales_list blue by seq, pi_cost blue by px', () => {
    const piCostPxMap = new Map([
      ['pq-1|rp-b', 20],
      ['pq-1|rp-a', 10],
      ['pq-1|tag-w', 5],
      ['pq-1|bag-z', 15],
    ])
    const sorted = sortBatchAddMaterialRows(
      [
        { kcaa01: 'RP-B', seq: 1 },
        { kcaa01: 'RP-A', seq: 2 },
        { kcaa01: 'TAG-X', kcaa03: 'PQ-1', seq: 30 },
        { kcaa01: 'BAG-Y', kcaa03: 'PQ-1', seq: 10 },
        { kcaa01: 'BAG-Z', kcaa03: 'OTHER', seq: 99 },
        { kcaa01: 'TAG-W', kcaa03: 'OTHER', seq: 1 },
      ],
      'PQ-1',
      ['TAG', 'BAG'],
      piCostPxMap,
    )
    assert.deepEqual(
      sorted.map((r) => r.kcaa01),
      ['RP-A', 'RP-B', 'BAG-Y', 'TAG-X', 'TAG-W', 'BAG-Z'],
    )
  })

  test('resolveBatchAddBomQty uses xsak03 * kcac04 for semi-finished', () => {
    const bomQtyMap = new Map()
    const qty = resolveBatchAddBomQty({
      product: 'PQ-3672',
      material: 'TAG-PQ3672A1/G',
      matRow: { kcac04: 1.21 },
      bomQtyMap,
      orderQty: 100,
      bomCodePrefixes: ['TAG'],
    })
    assert.equal(qty, 121)
  })

  test('resolveBatchAddBomQty prefers pi_cost when key exists', () => {
    const bomQtyMap = new Map([['pq-1|m1', 50]])
    const qty = resolveBatchAddBomQty({
      product: 'PQ-1',
      material: 'M1',
      matRow: { kcac04: 2 },
      bomQtyMap,
      orderQty: 100,
      bomCodePrefixes: ['TAG'],
    })
    assert.equal(qty, 50)
  })

  test('semi-finished available qty uses kcac04 path end-to-end', () => {
    const bomQtyMap = new Map()
    const bomQty = resolveBatchAddBomQty({
      product: 'PQ-3672',
      material: 'TAG-PQ3672A1/G',
      matRow: { kcac04: 1.21 },
      bomQtyMap,
      orderQty: 100,
      bomCodePrefixes: ['TAG'],
    })
    assert.equal(calcAvailableQty(bomQty, 0, 0), 121)
  })

  test('other assist batch add reads paged UB_ERP_Bom_000 rows and defaults prices to zero', async () => {
    const queries = []
    const pool = {
      request() {
        return {
          inputs: {},
          input(name, _type, value) {
            this.inputs[name] = value
            return this
          },
          async query(sqlText) {
            queries.push({ sql: sqlText, inputs: { ...this.inputs } })
            return {
              recordset: [
                {
                  id: 9,
                  kcaa01: 'MAT-1',
                  kcaa02: '材料一',
                  kcaa02En: 'Material 1',
                  invoiceName: 'INV-MAT',
                  kcaa03: 'SPEC',
                  kcaa04: 'PCS',
                  kcaa05: 'CAT',
                  origin: 'CN',
                  kcaa10: 'G1',
                  kcaa11: 'BLUE',
                  version: '100',
                  customerSupply: '0',
                  wxab04: 0,
                  wxab05: 0,
                  tax: 0,
                  remark: 'memo',
                  totalRows: 25197,
                },
              ],
            }
          },
        }
      },
    }

    const result = await fetchAssistOrderBatchAddTree(pool, {
      assistType: '0',
      keyword: 'MAT',
      bomCodeId: '3',
      page: '2',
      pageSize: '10',
    })

    assert.equal(result.ok, true)
    assert.equal(result.assistType, '0')
    assert.equal(result.lx, '2')
    assert.equal(result.piNo, '')
    assert.match(queries[0].sql, /FROM\s+dbo\.\[UB_ERP_Bom_000\]\s+AS\s+b/i)
    assert.match(queries[0].sql, /ROW_NUMBER\(\) OVER/i)
    assert.match(queries[0].sql, /BETWEEN\s+@startRow\s+AND\s+@endRow/i)
    assert.doesNotMatch(queries[0].sql, /UB_ERP_Buy_offer_list/i)
    assert.doesNotMatch(queries[0].sql, /UB_ERP_Sales_order/i)
    assert.equal(queries[0].inputs.keyword, '%MAT%')
    assert.equal(queries[0].inputs.bomCodeId, 3)
    assert.equal(queries[0].inputs.startRow, 11)
    assert.equal(queries[0].inputs.endRow, 20)
    assert.equal(result.page, 2)
    assert.equal(result.pageSize, 10)
    assert.equal(result.total, 25197)
    assert.equal(result.styles[0].materials[0].wxab04, 0)
    assert.equal(result.styles[0].materials[0].wxab05, 0)
    assert.equal(result.styles[0].materials[0].tax, 0)
    assert.equal(result.styles[0].materials[0].availableQty, 0)
  })

  test('other assist batch add defaults to first 10 UB_ERP_Bom_000 rows', async () => {
    const queries = []
    const pool = {
      request() {
        return {
          input() {
            return this
          },
          async query(sqlText) {
            queries.push(sqlText)
            return {
              recordset: [
                {
                  id: 8,
                  kcaa01: 'MAT-2',
                  kcaa02: '材料二',
                  wxab04: 0,
                  wxab05: 0,
                  tax: 0,
                },
              ],
            }
          },
        }
      },
    }

    const result = await fetchAssistOrderBatchAddTree(pool, { assistType: '0', lx: '2' })

    assert.equal(result.ok, true)
    assert.equal(result.lx, '2')
    assert.match(queries[0], /FROM\s+dbo\.\[UB_ERP_Bom_000\]\s+AS\s+b/i)
    assert.doesNotMatch(queries[0], /UB_ERP_assist_offer/i)
    assert.equal(result.styles[0].unitPrice, 0)
    assert.equal(result.styles[0].unitPriceTax, 0)
    assert.equal(result.styles[0].materials[0].tax, 0)
  })

})
