<template>
  <main class="stock-in-print-page">
    <div class="stock-in-print-toolbar no-print">
      <el-button type="primary" @click="printPage">点击此处打印</el-button>
      <el-button @click="goBack">返回</el-button>
      <el-select v-model="rowsPerPage" class="stock-in-print-page-size" placeholder="打印换行页" clearable>
        <el-option
          v-for="option in rowsPerPageOptions"
          :key="option.value"
          :label="option.label"
          :value="option.value"
        />
      </el-select>
    </div>

    <el-alert v-if="loading" title="正在读取打印数据..." type="info" show-icon class="no-print" />
    <div v-else-if="errorMsg" class="stock-in-print-error">{{ errorMsg }}</div>

    <section v-else id="div_print" class="stock-in-print-area">
      <article
        v-for="doc in printBlocks"
        :key="doc.blockKey"
        class="stock-in-print-doc"
        :class="{ 'stock-in-print-doc-manual': doc.manualPageBreak }"
      >
        <header class="stock-in-print-head">
          <div class="stock-in-print-logo-wrap">
            <img v-if="logoSrc" class="stock-in-print-logo" :src="logoSrc" alt="logo" @error="handleLogoError" />
          </div>
          <div class="stock-in-print-right">
            <div class="stock-in-print-mode">
              &lt;{{ doc.printMode === '1' ? '明细' : '汇总' }}&gt;
              <span v-if="String(doc.header.pass) === '0'" class="stock-in-print-unaudited">【未审】</span>
            </div>
            <div class="stock-in-print-pages">{{ doc.pageLabel }}</div>
            <div class="stock-in-print-no">NO. {{ doc.header.kcan01 }}</div>
          </div>
        </header>

        <h1 class="stock-in-print-title">{{ printTitle(doc.header.kcan03) }}</h1>

        <section class="stock-in-print-meta">
          <div><span>{{ relatedPartyLabel(doc.header.kcan03) }}：</span>{{ blank(doc.header.kehu || doc.header.kcan05) }}</div>
          <div><span>{{ sourceOrderLabel(doc.header.kcan03) }}：</span>{{ blank(doc.header.kcan04) }}</div>
          <div><span>{{ paperNoLabel(doc.header.kcan03) }}：</span>{{ blank(doc.header.kcan08) }}</div>
          <div><span>入库日期：</span>{{ dateTimeText(doc.header.kcan02) }}</div>
        </section>

        <table class="stock-in-print-table">
          <thead>
            <tr v-if="doc.printMode === '1'">
              <th class="col-seq">序号</th>
              <th class="col-ref">厂款号/PI号</th>
              <th class="col-code">电脑编码</th>
              <th>材料名称</th>
              <th>规格</th>
              <th>颜色</th>
              <th class="col-unit">单位</th>
              <th class="col-qty">数量</th>
              <th>备注</th>
            </tr>
            <tr v-else>
              <th class="col-seq">序号</th>
              <th class="col-code">电脑编码</th>
              <th>材料名称</th>
              <th>规格</th>
              <th>颜色</th>
              <th class="col-unit">单位</th>
              <th class="col-qty">数量</th>
            </tr>
          </thead>
          <tbody>
            <template v-if="doc.printMode === '1'">
              <tr v-for="line in doc.lines" :key="line.id || `${line.seq}-${line.kcaa01}`">
                <td>{{ line.seq }}</td>
                <td>{{ blank(line.reference) }}</td>
                <td>{{ blank(line.kcaa01) }}</td>
                <td>{{ blank(line.kcaa02) }}</td>
                <td>{{ blank(line.kcaa03) }}</td>
                <td>{{ blank(line.colorText || line.kcaa11) }}</td>
                <td>{{ blank(line.kcaa04) }}</td>
                <td class="num">{{ line.quantityText }}</td>
                <td>{{ blank(line.Describe) }}</td>
              </tr>
              <tr v-if="doc.showTotal" class="stock-in-print-total">
                <td colspan="7">合计</td>
                <td class="num">{{ doc.totalQtyText }}</td>
                <td></td>
              </tr>
            </template>
            <template v-else>
              <tr v-for="line in doc.lines" :key="`${line.seq}-${line.kcaa01}-${line.kcaa11}`">
                <td>{{ line.seq }}</td>
                <td>{{ blank(line.kcaa01) }}</td>
                <td>{{ blank(line.kcaa02) }}</td>
                <td>{{ blank(line.kcaa03) }}</td>
                <td>{{ blank(line.colorText || line.kcaa11) }}</td>
                <td>{{ blank(line.kcaa04) }}</td>
                <td class="num">{{ line.quantityText }}</td>
              </tr>
              <tr v-if="doc.showTotal" class="stock-in-print-total">
                <td colspan="6">合计</td>
                <td class="num">{{ doc.totalQtyText }}</td>
              </tr>
            </template>
          </tbody>
        </table>

        <footer v-if="doc.showTotal" class="stock-in-print-sign">
          <span>制表人：{{ blank(doc.makerName) }}</span>
          <span>仓库：{{ blank(doc.header.ck || doc.header.kcan06) }}</span>
          <span>收发人：</span>
          <span>进账人：</span>
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
import { buildStockInPrintBlocks } from './printPagination.js'

const route = useRoute()
const loading = ref(false)
const errorMsg = ref('')
const docs = ref([])
const defaultLogoSrc = '/images/logo.png'
const logoSrc = ref(defaultLogoSrc)
const rowsPerPage = ref('')
const rowsPerPageOptions = Array.from({ length: 9 }, (_, index) => {
  const value = String(index + 2)
  return { label: `${value}行一页`, value }
})
const printBlocks = computed(() => buildStockInPrintBlocks(docs.value, rowsPerPage.value))

function text(value) {
  return String(value ?? '').trim()
}

function blank(value) {
  return text(value) || '-'
}

function dateTimeText(value) {
  if (!value) return ''
  const d = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(d.getTime())) return text(value)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  const h = d.getHours()
  const min = String(d.getMinutes()).padStart(2, '0')
  const sec = String(d.getSeconds()).padStart(2, '0')
  return `${y}-${m}-${day} ${h}:${min}:${sec}`
}

function typeText(value) {
  return String(value ?? '').trim()
}

function printTitle(type) {
  const map = {
    0: '其他入库单',
    1: '采购入库单',
    2: '外协入库单',
    3: '外协退料单',
    4: '生产入库单',
    5: '生产退料单',
    6: '销售退货单',
    7: '盘盈入库单',
    8: '加工入库单',
  }
  return map[typeText(type)] || '入库单'
}

function relatedPartyLabel(type) {
  const t = typeText(type)
  if (t === '1') return '供应商'
  if (t === '2' || t === '3') return '外协客户'
  if (t === '4' || t === '5') return '生产车间'
  if (t === '6') return '客户'
  return '关联单位'
}

function sourceOrderLabel(type) {
  const t = typeText(type)
  if (t === '1') return '采购单号'
  if (t === '2' || t === '3') return '外协单号'
  if (t === '4' || t === '5') return '派工单号'
  if (t === '6') return '订单单号'
  return '关联单号'
}

function paperNoLabel(type) {
  const t = typeText(type)
  if (t === '1' || t === '2' || t === '3') return '来货单号'
  if (t === '4' || t === '5') return 'PI号'
  if (t === '6') return 'PO号'
  return '纸质单号'
}

async function loadPrintData() {
  const pSum = text(route.query.p_sum)
  if (!pSum) {
    errorMsg.value = 'Error,Code:208'
    return
  }
  loading.value = true
  errorMsg.value = ''
  try {
    const { data } = await axios.get('/api/stock-in/print-data', {
      params: {
        p_sum: pSum,
        print_cn: route.query.print_cn || '2',
      },
    })
    docs.value = Array.isArray(data?.data?.list) ? data.data.list : []
    logoSrc.value = text(data?.data?.printConfig?.logoSrc) || defaultLogoSrc
  } catch (err) {
    errorMsg.value = err?.response?.data?.msg || err.message || '读取入库单打印数据失败'
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
  document.documentElement.classList.add('print-stock-in')
  const cleanup = () => {
    document.documentElement.classList.remove('print-stock-in')
    window.removeEventListener('afterprint', cleanup)
  }
  window.addEventListener('afterprint', cleanup)
  setTimeout(() => {
    window.print()
    setTimeout(cleanup, 3000)
  }, 50)
}

function goBack() {
  window.history.back()
}

onMounted(loadPrintData)
</script>

<style scoped>
.stock-in-print-page {
  min-height: 100vh;
  background: #f5f7fa;
  padding: 16px;
}

.stock-in-print-toolbar {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 0 auto 14px;
  width: 95%;
}

.stock-in-print-page-size {
  width: 138px;
}

.stock-in-print-error {
  width: 95%;
  margin: 24px auto;
  color: #c45656;
  font-size: 16px;
}

.stock-in-print-area {
  width: 95%;
  margin: 0 auto;
}

.stock-in-print-doc {
  background: #fff;
  color: #000;
  padding: 18px 18px 22px;
  margin: 0 auto 18px;
  page-break-after: always;
  font-size: 12px;
  display: flex;
  flex-direction: column;
}

.stock-in-print-doc:last-child {
  margin-bottom: 0;
}

.stock-in-print-head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
}

.stock-in-print-logo {
  width: 250px;
  max-height: 70px;
  object-fit: contain;
}

.stock-in-print-right {
  min-width: 190px;
  text-align: right;
  line-height: 1.7;
}

.stock-in-print-mode {
  font-size: 13px;
}

.stock-in-print-unaudited {
  color: #d03050;
  font-weight: 700;
  margin-left: 8px;
}

.stock-in-print-no {
  font-size: 14px;
  font-weight: 700;
}

.stock-in-print-title {
  margin: 8px 0 12px;
  text-align: center;
  font-size: 19px;
  font-weight: 700;
  letter-spacing: 0;
}

.stock-in-print-meta {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 0;
  border: 1px solid #000;
  border-bottom: 0;
  font-size: 13px;
}

.stock-in-print-meta div {
  min-height: 28px;
  line-height: 28px;
  padding: 0 8px;
  border-right: 1px solid #000;
}

.stock-in-print-meta div:last-child {
  border-right: 0;
}

.stock-in-print-meta span {
  font-weight: 700;
}

.stock-in-print-table {
  width: 100%;
  border-collapse: collapse;
  table-layout: fixed;
}

.stock-in-print-table th,
.stock-in-print-table td {
  border: 1px solid #000;
  min-height: 25px;
  line-height: 25px;
  padding: 2px;
  text-align: center;
  word-break: break-word;
}

.stock-in-print-table th {
  font-weight: 700;
}

.stock-in-print-table .col-seq {
  width: 44px;
}

.stock-in-print-table .col-ref {
  width: 105px;
}

.stock-in-print-table .col-code {
  width: 130px;
}

.stock-in-print-table .col-unit {
  width: 58px;
}

.stock-in-print-table .col-qty {
  width: 80px;
}

.stock-in-print-table .num {
  text-align: right;
  padding-right: 6px;
}

.stock-in-print-total td {
  font-weight: 700;
}

.stock-in-print-sign {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 18px;
  margin-top: auto;
  padding-top: 18px;
  font-size: 13px;
}

@media print {
  :global(html.print-stock-in body *) {
    visibility: hidden;
  }

  :global(html.print-stock-in #div_print),
  :global(html.print-stock-in #div_print *) {
    visibility: visible;
  }

  :global(html.print-stock-in body) {
    margin: 0;
    background: #fff;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }

  :global(html.print-stock-in #div_print) {
    position: absolute;
    inset: 0;
    width: 100%;
    margin: 0;
  }

  :global(html.print-stock-in .stock-in-print-doc) {
    box-shadow: none;
    margin: 0;
    padding: 0 6mm 8mm;
    min-height: 280mm;
  }

  :global(html.print-stock-in .stock-in-print-doc:last-child) {
    page-break-after: auto;
  }
}
</style>
