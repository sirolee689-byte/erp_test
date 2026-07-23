<template>
  <main class="buy-print-page">
    <div class="buy-print-toolbar no-print">
      <el-button type="primary" @click="printPage">{{ label('print') }}</el-button>
      <el-button @click="goBack">{{ label('back') }}</el-button>
      <el-select v-model="rowsPerPage" class="buy-print-page-size" :placeholder="label('rowsPerPage')">
        <el-option v-for="opt in rowsPerPageOptions" :key="opt.value" :label="opt.label" :value="opt.value" />
      </el-select>
    </div>

    <el-alert v-if="loading" :title="label('loading')" type="info" show-icon class="no-print" />
    <div v-else-if="errorMsg" class="buy-print-error">{{ errorMsg }}</div>

    <section v-else class="buy-print-area">
      <article
        v-for="block in printBlocks"
        :key="block.blockKey"
        class="buy-print-doc"
        :class="{ 'buy-print-doc--break': block.pageNo > 1 || block.docIndex > 1 }"
      >
        <header class="buy-print-company">
          <div></div>
          <div class="buy-print-company-main">
            <img v-if="logoSrc" class="buy-print-logo" :src="logoSrc" alt="logo" @error="handleLogoError" />
            <div v-if="printHeaderHtml" class="buy-print-head-html" v-html="printHeaderHtml"></div>
            <div v-else class="buy-print-company-text">
              <strong>{{ language === '2' ? 'Unibest Leather Goods (ZhongShan) Co., Ltd.' : '中山市卓越皮具有限公司' }}</strong>
              <span>{{ language === '2' ? 'No.10 East Qiaonan Road, Sanjiao Town, Zhongshan' : '地址：中山市港口镇木河迳西路10号' }}</span>
              <span>{{ language === '2' ? 'Tel: 0760-28150063  Fax: 0760-28150050' : '电话：0760-28150063 传真：0760-28150050' }}</span>
            </div>
          </div>
          <div class="buy-print-no">
            <!-- 页码对齐出库单打印：如 1/3页；每张单据独立从 1 起算 -->
            <div>{{ block.pageNo }}/{{ block.pageTotal }}页</div>
            <div>NO. {{ block.doc.header.buyOrderNo }}</div>
            <div v-if="String(block.doc.header.pass) === '0'" class="buy-print-unaudited">{{ label('unaudited') }}</div>
          </div>
        </header>

        <h1>{{ label(block.doc.documentType === 'summary' ? 'summaryTitle' : 'title') }}</h1>

        <section class="buy-print-meta">
          <div>
            <p><span>{{ label('to') }}:</span> {{ blank(block.doc.header.supplierName || block.doc.header.supplierShortName || block.doc.header.supplierCode) }}</p>
            <p><span>{{ label('tel') }}:</span> {{ blank(block.doc.header.supplierTel) }}</p>
            <p><span>{{ label('attn') }}:</span> {{ blank(block.doc.header.supplierContact) }}</p>
          </div>
          <div>
            <p><span>{{ label('payment') }}:</span> {{ blank(block.doc.header.paymentTerms || block.doc.header.supplierPayFor) }}</p>
            <p><span>{{ label('tax') }}:</span> {{ firstTax(block.doc.lines) }}</p>
          </div>
          <div>
            <p><span>{{ label('date') }}:</span> {{ dateText(block.doc.header.buyDate) }}</p>
            <p><span>{{ label('currency') }}:</span> {{ blank(block.doc.header.currencyName || block.doc.header.currencyCode) }}</p>
            <p><span>PI:</span> {{ blank(block.doc.header.referenceNo) }}</p>
          </div>
          <p class="buy-print-meta-remark"><span>{{ label('remark') }}:</span> {{ blank(block.doc.header.remark) }}</p>
        </section>

        <table class="buy-print-table">
          <thead>
            <tr>
              <th class="col-seq">{{ label('seq') }}</th>
              <th class="col-code">{{ label('materialCode') }}</th>
              <th>{{ label('materialName') }}</th>
              <th>{{ label('spec') }}</th>
              <th class="col-color">{{ label('color') }}</th>
              <th class="col-unit">{{ label('unit') }}</th>
              <th class="col-qty">{{ label('qty') }}</th>
              <th v-if="block.doc.hasPricePermission" class="col-money">{{ label('price') }}</th>
              <th v-if="block.doc.hasPricePermission" class="col-money">{{ label('amount') }}</th>
              <th class="col-date">{{ label('delivery') }}</th>
              <th class="col-remark">{{ label('lineRemark') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in block.rows" :key="row.rowKey">
              <td>{{ row.seq }}</td>
              <td>{{ row.materialCode || row.feeCode }}</td>
              <td>{{ row.kind === 'fee' ? row.feeName : row.materialName }}</td>
              <td>{{ row.spec }}</td>
              <td>{{ row.kind === 'fee' ? '' : row.colorText }}</td>
              <td>{{ row.kind === 'fee' ? '' : row.unit }}</td>
              <td class="num">{{ row.kind === 'fee' ? '' : qty(row.quantity) }}</td>
              <td v-if="block.doc.hasPricePermission" class="num">{{ row.kind === 'fee' ? '' : price(row.taxIncludedPrice) }}</td>
              <td v-if="block.doc.hasPricePermission" class="num">{{ row.kind === 'fee' ? amount(row.money) : amount(row.taxIncludedAmount) }}</td>
              <td>{{ row.kind === 'fee' ? '' : row.deliveryDateText }}</td>
              <td>{{ row.remarkText }}</td>
            </tr>
            <tr v-if="block.showTotal && block.doc.hasPricePermission" class="buy-print-total">
              <td colspan="7" class="buy-print-delivery-cell">
                <strong>{{ label('deliveryAddress') }}:</strong>
                中山市卓越皮具有限公司
              </td>
              <td>{{ label('total') }}</td>
              <td class="num">{{ amount(block.doc.totals.taxIncludedAmount) }}</td>
              <td colspan="2"></td>
            </tr>
            <tr v-else-if="block.showTotal" class="buy-print-total">
              <td colspan="9" class="buy-print-delivery-cell">
                <strong>{{ label('deliveryAddress') }}:</strong>
                中山市卓越皮具有限公司
              </td>
            </tr>
          </tbody>
        </table>

        <section v-if="block.showTotal" class="buy-print-notes">
          <div class="buy-print-notes-title">{{ label('notes') }}</div>
          <ol>
            <li>
              {{ label('note1Before') }}
              <input v-model="noteFineRate" class="buy-print-inline-input" />
              {{ label('note1After') }}
            </li>
            <li>
              {{ label('note2Before') }}
              <input v-model="noteWarranty" class="buy-print-inline-input buy-print-inline-input--wide" />
            </li>
            <li>{{ label('note3') }}</li>
            <li>{{ label('note4') }}</li>
            <li>{{ label('note5') }}</li>
            <li>
              <div>{{ label('note6Title') }}</div>
              <div>{{ label('note6A') }}</div>
              <div>
                {{ label('note6BBefore') }}
                <input v-model="noteSpareRate" class="buy-print-inline-input buy-print-inline-input--narrow" />
                {{ label('note6BAfter') }}
              </div>
              <div>{{ label('note6C') }}</div>
            </li>
          </ol>
        </section>

        <footer v-if="block.showTotal" class="buy-print-sign">
          <span>{{ label('supplierSign') }}</span>
          <span>{{ label('check') }}</span>
          <span>{{ label('audit') }}</span>
          <span>{{ label('buyer') }}</span>
          <span></span>
          <span></span>
          <span></span>
          <span>{{ text(block.doc.makerName) }}</span>
        </footer>
      </article>
    </section>
  </main>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import axios from 'axios'
import { ElMessage } from 'element-plus'
import { formatErpMoneyDisplay, formatErpPriceDisplay, formatErpQtyDisplay, formatErpTrimDecimal } from '@/utils/erpNumberDisplay.js'

const route = useRoute()
const loading = ref(false)
const errorMsg = ref('')
const docs = ref([])
const language = ref('1')
const defaultLogoSrc = '/images/logo.png'
const logoSrc = ref(defaultLogoSrc)
const printHeaderHtml = ref('')
const rowsPerPage = ref('10')
const noteFineRate = ref('')
const noteWarranty = ref('5个月')
const noteSpareRate = ref('1')
const rowsPerPageOptions = Array.from({ length: 11 }, (_, index) => {
  const value = String(index + 3)
  return { label: `${value}行/页`, value }
})

const labels = {
  1: {
    print: '点击此处打印',
    back: '返回',
    rowsPerPage: '每页行数',
    loading: '正在读取采购单打印数据...',
    unaudited: '未审核',
    title: '采购单',
    summaryTitle: '采购单汇总',
    to: 'TO',
    tel: 'TEL',
    attn: 'ATTN',
    remark: '备注',
    payment: '结算方式',
    tax: '税点',
    date: '订购日期',
    currency: '币别',
    seq: '序号',
    materialCode: '材料编码',
    materialName: '材料名称',
    spec: '规格',
    color: '颜色',
    unit: '单位',
    qty: '数量',
    price: '单价',
    amount: '金额',
    delivery: '交期',
    lineRemark: '备注',
    total: '合计',
    deliveryAddress: '交货地址',
    notes: '注意事项',
    note1Before: '交期：必须遵循本订购之交期或本公司采购部电话及书面通知调整之交期，若有延误每过一日，扣除该批款',
    note1After: '%。',
    note2Before: '品质：按公司的合格样品要求或工程图纸。检验方法：按MIL-SID-105E正常抽样方法检查AQL=2.5% 品质保证期限：',
    note3: '不良品处理：检验后发现不良或损坏。接本厂通知后，最迟24小时内有解决方案。',
    note4: '以上物料全部要达到REACH标准（以2012年6月18日公布的REACH法规为准。）',
    note5: '甲方拥有由其支付模具费（或制版费）的模具归属权，模具在生产期间交由乙方保管，必要时，甲方有权拿回模具；乙方需无条件配合完整交还模具。',
    note6Title: '其他：',
    note6A: '（1）在收到本公司的采购单时，必须在一个工作日内签名盖章回传。',
    note6BBefore: '（2）厂商送货时应多附加物',
    note6BAfter: '%不良备品。',
    note6C: '（3）送货单必须要标注我司的产品电脑编码。包装方法需要统一数量，分类包装。',
    supplierSign: '制造商签回',
    check: '核准',
    audit: '审核',
    buyer: '订单编写',
  },
  2: {
    print: 'Print',
    back: 'Back',
    rowsPerPage: 'Rows per page',
    loading: 'Loading purchase order print data...',
    unaudited: 'Unaudited',
    title: 'Purchase Order',
    summaryTitle: 'Purchase Order Summary',
    to: 'TO',
    tel: 'TEL',
    attn: 'ATTN',
    remark: 'Remark',
    payment: 'Payment',
    tax: 'Tax',
    date: 'Order Date',
    currency: 'Currency',
    seq: 'No.',
    materialCode: 'Material Code',
    materialName: 'Material Name',
    spec: 'Spec',
    color: 'Color',
    unit: 'Unit',
    qty: 'Qty',
    price: 'Price',
    amount: 'Amount',
    delivery: 'Delivery',
    lineRemark: 'Remark',
    total: 'Total',
    deliveryAddress: 'Delivery Address',
    notes: 'Notes',
    note1Before: 'Delivery must follow this order or written notice from our purchasing department. Delay penalty',
    note1After: '%.',
    note2Before: 'Quality must follow approved samples or drawings. Inspection standard: MIL-STD-105E, AQL=2.5%. Warranty period:',
    note3: 'Defective goods must have a solution within 24 hours after notice.',
    note4: 'All materials must comply with REACH requirements.',
    note5: 'Molds paid by Party A belong to Party A. Supplier must return them when required.',
    note6Title: 'Other:',
    note6A: '(1) Supplier must sign and return the purchase order within one working day.',
    note6BBefore: '(2) Supplier delivery should include extra spare goods',
    note6BAfter: '% for defective replacement.',
    note6C: '(3) Delivery note must mark our product computer code. Packaging must use unified quantities and category packing.',
    supplierSign: 'Supplier Sign',
    check: 'Check',
    audit: 'Audit',
    buyer: 'Buyer',
  },
}

const printBlocks = computed(() => {
  const pageSize = Math.max(1, Number(rowsPerPage.value) || 10)
  const blocks = []
  docs.value.forEach((doc, docIndex) => {
    const rows = [
      ...(doc.lines || []).map((line) => ({ ...line, kind: 'line' })),
      ...(doc.fees || []).map((fee) => ({ ...fee, kind: 'fee' })),
    ]
    const totalPages = Math.max(1, Math.ceil(Math.max(rows.length, 1) / pageSize))
    for (let i = 0; i < totalPages; i += 1) {
      const chunk = rows.slice(i * pageSize, (i + 1) * pageSize)
      blocks.push({
        blockKey: `${doc.header?.buyOrderNo || docIndex}-${i}`,
        doc,
        docIndex: docIndex + 1,
        pageNo: i + 1,
        pageTotal: totalPages,
        rows: chunk.map((row, rowIndex) => ({ ...row, rowKey: `${row.kind}-${row.id || row.feeCode || row.materialCode}-${i}-${rowIndex}` })),
        showTotal: i === totalPages - 1,
      })
    }
  })
  return blocks
})

function text(value) {
  return String(value ?? '').trim()
}

function label(key) {
  return labels[language.value]?.[key] || labels[1][key] || key
}

function blank(value) {
  return text(value) || '-'
}

function qty(value) {
  return formatErpQtyDisplay(value, '')
}

function price(value) {
  return formatErpPriceDisplay(value, '')
}

function amount(value) {
  return formatErpMoneyDisplay(value, '')
}

function taxText(value) {
  return formatErpTrimDecimal(value, { maxDecimals: 4, empty: '' })
}

function dateText(value) {
  if (!value) return ''
  const d = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(d.getTime())) return text(value).slice(0, 10)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function firstTax(lines = []) {
  const line = (Array.isArray(lines) ? lines : []).find((item) => text(item.tax) !== '')
  if (!line) return '-'
  return taxText(line.tax) || '-'
}

async function loadPrintData() {
  const pSum = text(route.query.p_sum)
  if (!pSum) {
    errorMsg.value = '请选择需要打印的单据'
    return
  }
  loading.value = true
  errorMsg.value = ''
  try {
    const { data } = await axios.get('/api/buy-order/print-data', {
      params: {
        p_sum: pSum,
        print_mx: route.query.print_mx || '1',
        print_cn: route.query.print_cn || '1',
      },
    })
    docs.value = Array.isArray(data?.data?.list) ? data.data.list : []
    language.value = text(data?.data?.language) || text(route.query.print_cn) || '1'
    logoSrc.value = text(data?.data?.printConfig?.logoSrc) || defaultLogoSrc
    printHeaderHtml.value = text(data?.data?.printConfig?.headerHtml || data?.data?.printConfig?.info)
  } catch (err) {
    errorMsg.value = err?.response?.data?.msg || err.message || '读取采购单打印数据失败'
  } finally {
    loading.value = false
  }
}

function handleLogoError() {
  if (logoSrc.value !== defaultLogoSrc) {
    logoSrc.value = defaultLogoSrc
    return
  }
  logoSrc.value = ''
}

function printPage() {
  if (!docs.value.length) {
    ElMessage.warning('暂无可打印数据')
    return
  }
  document.documentElement.classList.add('print-buy-order')
  const cleanup = () => {
    document.documentElement.classList.remove('print-buy-order')
    window.removeEventListener('afterprint', cleanup)
  }
  window.addEventListener('afterprint', cleanup)
  setTimeout(() => {
    window.print()
    setTimeout(cleanup, 3000)
  }, 50)
}

	function goBack() {
	  window.close()
	  // 不是脚本打开的页签可能被浏览器拒绝关闭，关闭失败后回退到来源页。
	  setTimeout(() => {
	    if (!window.closed) window.history.back()
	  }, 100)
	}

onMounted(loadPrintData)
</script>

<style scoped>
.buy-print-page {
  min-height: 100vh;
  padding: 12px;
  background: #e8edf3;
  color: #000;
  font-family: Arial, "Microsoft YaHei", sans-serif;
}
.buy-print-toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
}
.buy-print-page-size {
  width: 128px;
}
.buy-print-error {
  padding: 18px;
  color: #b42318;
  background: #fff;
  border: 1px solid #f0b8b8;
}
.buy-print-area {
  max-width: 1620px;
  margin: 0 auto;
}
.buy-print-doc {
  padding: 18px;
  margin-bottom: 18px;
  background: #eef3f8;
}
.buy-print-doc--break {
  page-break-before: always;
}
.buy-print-company {
  display: grid;
  grid-template-columns: 220px 1fr 220px;
  align-items: start;
  min-height: 92px;
}
.buy-print-company-main {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
}
.buy-print-logo {
  max-width: 260px;
  max-height: 48px;
  object-fit: contain;
}
.buy-print-head-html {
  font-size: 16px;
  line-height: 1.3;
}
.buy-print-head-html :deep(*) {
  margin-top: 0;
  margin-bottom: 0;
}
.buy-print-company-text {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 3px;
  font-size: 18px;
}
.buy-print-company-text strong {
  font-size: 18px;
  color: #27318a;
}
.buy-print-no {
  text-align: right;
  font-size: 18px;
}
.buy-print-unaudited {
  color: #c2410c;
  font-weight: 700;
}
h1 {
  margin: 0 0 22px;
  text-align: center;
  font-size: 20px;
  letter-spacing: 8px;
}
.buy-print-meta {
  display: grid;
  grid-template-columns: 1.4fr 1fr 1fr;
  column-gap: 36px;
  row-gap: 0;
  margin-bottom: 14px;
  font-size: 14px;
}
.buy-print-meta p {
  margin: 0 0 8px;
}
.buy-print-meta-remark {
  grid-column: 1 / -1;
}
.buy-print-meta span {
  font-weight: 700;
}
.buy-print-table {
  width: 100%;
  border-collapse: collapse;
  table-layout: fixed;
  font-size: 13px;
  background: #eef3f8;
}
.buy-print-table th,
.buy-print-table td {
  border: 1px solid #000;
  padding: 6px 5px;
  text-align: center;
  vertical-align: middle;
  word-break: break-word;
}
.buy-print-table th {
  text-align: center;
  font-weight: 700;
}
.buy-print-table .num {
  text-align: center;
}
.col-seq { width: 42px; }
.col-code { width: 150px; }
.col-color { width: 65px; }
.col-unit { width: 60px; }
.col-qty { width:40px; }
.col-money { width: 60px; }
.col-date { width: 90px; }
.col-remark { width: 120px; }
.buy-print-total td {
  font-weight: 700;
}
.buy-print-table td.buy-print-delivery-cell {
  text-align: left;
  font-weight: 400;
  padding-left: 12px;
}
.buy-print-notes {
  display: grid;
  grid-template-columns: 56px 1fr;
  border: 1px solid #000;
  border-top: 0;
  font-size: 13px;
}
.buy-print-notes-title {
  display: flex;
  align-items: center;
  justify-content: center;
  border-right: 1px solid #000;
  writing-mode: vertical-rl;
  letter-spacing: 6px;
  font-size: 20px;
}
.buy-print-notes ol {
  margin: 6px 12px;
  padding-left: 20px;
}
.buy-print-notes li {
  margin: 3px 0;
}
.buy-print-inline-input {
  width: 72px;
  height: 20px;
  padding: 0 4px;
  border: 0;
  border-bottom: 1px solid #000;
  background: transparent;
  text-align: center;
  outline: none;
}
.buy-print-inline-input--wide {
  width: 86px;
}
.buy-print-inline-input--narrow {
  width: 48px;
}
.buy-print-sign {
  display: grid;
  grid-template-columns: 1fr 2.5fr 0.9fr 2.6fr;
  border-left: 1px solid #000;
  border-top: 1px solid #000;
}
.buy-print-sign span {
  min-height: 26px;
  padding: 5px 8px;
  border-right: 1px solid #000;
  border-bottom: 1px solid #000;
  text-align: center;
  font-weight: 700;
}
@media print {
  .no-print {
    display: none !important;
  }
  .buy-print-page {
    padding: 0;
    background: #eef3f8;
  }
  .buy-print-area {
    max-width: none;
  }
  .buy-print-doc {
    margin: 0;
    padding: 10mm;
    box-shadow: none;
  }
}
</style>
