<template>
  <main class="stock-out-print-page">
    <div class="stock-out-print-toolbar no-print">
      <el-button type="primary" @click="printPage">点击此处打印</el-button>
      <el-button @click="goBack">返回</el-button>
      <el-select v-model="rowsPerPage" class="stock-out-print-page-size" placeholder="打印换行页" clearable>
        <el-option
          v-for="option in rowsPerPageOptions"
          :key="option.value"
          :label="option.label"
          :value="option.value"
        />
      </el-select>
    </div>

    <el-alert v-if="loading" title="正在读取打印数据..." type="info" show-icon class="no-print" />
    <div v-else-if="errorMsg" class="stock-out-print-error">{{ errorMsg }}</div>

    <section v-else id="div_print" class="stock-out-print-area">
      <article
        v-for="doc in printBlocks"
        :key="doc.blockKey"
        class="stock-out-print-doc"
        :class="{ 'stock-out-print-doc-manual': doc.manualPageBreak }"
      >
        <header class="stock-out-print-head">
          <div class="stock-out-print-logo-wrap">
            <img v-if="logoSrc" class="stock-out-print-logo" :src="logoSrc" alt="logo" @error="handleLogoError" />
          </div>
          <div class="stock-out-print-right">
            <div class="stock-out-print-mode">
              &lt;{{ doc.printMode === '1' ? '明细' : '汇总' }}&gt;
              <span v-if="String(doc.header.pass) === '0'" class="stock-out-print-unaudited">【未审】</span>
            </div>
            <div v-if="doc.pageLabel" class="stock-out-print-pages">{{ doc.pageLabel }}</div>
            <div class="stock-out-print-no">NO. {{ doc.header.kcap01 }}</div>
          </div>
        </header>

        <h1 class="stock-out-print-title">{{ printTitle(doc.header.kcap03) }}</h1>

        <section class="stock-out-print-meta">
          <div><span>{{ relatedPartyLabel(doc.header.kcap03) }}：</span>{{ blank(doc.header.kehu || doc.header.kcap05) }}</div>
          <div><span>{{ sourceOrderLabel(doc.header.kcap03) }}：</span>{{ blank(doc.header.kcap04) }}</div>
          <div><span>{{ paperNoLabel(doc.header.kcap03) }}：</span>{{ blank(doc.header.kcap08) }}</div>
          <div><span>出仓日期：</span>{{ dateText(doc.header.kcap02) }}</div>
        </section>

        <table class="stock-out-print-table">
          <thead>
            <tr v-if="doc.printMode === '1'">
              <th class="col-seq">序号</th>
              <th class="col-ref">厂款号/PI号</th>
              <th class="col-code">电脑编码</th>
              <th>材料名称</th>
              <th>规格</th>
              <th class="col-color">颜色</th>
              <th class="col-unit">单位</th>
              <th class="col-qty">数量</th>
              <th>备注</th>
            </tr>
            <tr v-else>
              <th class="col-seq">序号</th>
              <th class="col-code">电脑编码</th>
              <th>材料名称</th>
              <th>规格</th>
              <th class="col-color">颜色</th>
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
              <tr v-if="doc.showTotal" class="stock-out-print-total">
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
              <tr v-if="doc.showTotal" class="stock-out-print-total">
                <td colspan="6">合计</td>
                <td class="num">{{ doc.totalQtyText }}</td>
              </tr>
            </template>
          </tbody>
        </table>

        <footer v-if="doc.showTotal" class="stock-out-print-sign">
          <span>制表人：{{ blank(doc.makerName) }}</span>
          <span>仓库：{{ blank(doc.header.ck || doc.header.kcap06) }}</span>
          <span>领料人：</span>
          <span>发料人：</span>
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
import { buildStockOutPrintBlocks } from './printPagination.js'

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
const printBlocks = computed(() => buildStockOutPrintBlocks(docs.value, rowsPerPage.value))

function text(value) {
  return String(value ?? '').trim()
}

function blank(value) {
  return text(value) || '-'
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

function typeText(value) {
  return String(value ?? '').trim()
}

function printTitle(type) {
  const map = {
    0: '其他出库单',
    1: '采购退货单',
    2: '外协领料单',
    3: '外协退货单',
    4: '生产领料单',
    5: '生产返修单',
    6: '成品出库单',
    7: '生产领料（计划外）出库单',
    8: '生产领料（补数）出库单',
    9: '盘亏出库单',
    10: '销售出库单',
  }
  return map[typeText(type)] || '出库单'
}

function relatedPartyLabel(type) {
  const t = typeText(type)
  if (t === '1') return '供应商'
  if (t === '2' || t === '3') return '外协客户'
  if (['4', '5', '7', '8'].includes(t)) return '生产车间'
  if (t === '6') return '客户'
  return '关联单位'
}

function sourceOrderLabel(type) {
  const t = typeText(type)
  if (t === '1') return '采购单号'
  if (t === '2' || t === '3') return '外协单号'
  if (['4', '5', '7', '8'].includes(t)) return '派工单号'
  if (t === '6') return '订单单号'
  return '关联单号'
}

function paperNoLabel(type) {
  const t = typeText(type)
  if (t === '1' || t === '2' || t === '3') return '来货单号'
  if (['4', '5', '7', '8'].includes(t)) return 'PI号'
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
    const { data } = await axios.get('/api/stock-out/print-data', {
      params: {
        p_sum: pSum,
        print_cn: route.query.print_cn || '2',
      },
    })
    docs.value = Array.isArray(data?.data?.list) ? data.data.list : []
    logoSrc.value = text(data?.data?.printConfig?.logoSrc) || defaultLogoSrc
  } catch (err) {
    errorMsg.value = err?.response?.data?.msg || err.message || '读取出库单打印数据失败'
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
  setTimeout(() => {
    window.print()
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
.stock-out-print-page {
  min-height: 100vh;
  background: #f5f7fa;
  padding: 16px;
}

.stock-out-print-toolbar {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 0 auto 14px;
  width: 95%;
}

.stock-out-print-page-size {
  width: 138px;
}

.stock-out-print-error {
  width: 95%;
  margin: 24px auto;
  color: #c45656;
  font-size: 16px;
}

.stock-out-print-area {
  width: 95%;
  margin: 0 auto;
}

/* 统一纸面：宽 215mm × 高 139mm；自然分页用 min-height，内容多可高于一页 */
.stock-out-print-doc {
  box-sizing: border-box;
  width: 215mm;
  min-height: 139mm;
  background: #fff;
  color: #000;
  padding: 5mm 6mm;
  margin: 0 auto 18px;
  font-size: 12px;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.08);
}

/* 手工「N行一页」：每块固定一张纸，超出裁切避免浏览器再拆页 */
.stock-out-print-doc-manual {
  height: 139mm;
  overflow: hidden;
  break-inside: avoid;
  page-break-inside: avoid;
}

.stock-out-print-doc:last-child {
  margin-bottom: 0;
}

.stock-out-print-head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
}

.stock-out-print-logo {
  width: 250px;
  max-height: 70px;
  object-fit: contain;
}

.stock-out-print-right {
  min-width: 190px;
  text-align: right;
  line-height: 1.7;
}

.stock-out-print-mode {
  font-size: 13px;
}

.stock-out-print-unaudited {
  color: #d03050;
  font-weight: 700;
  margin-left: 8px;
}

.stock-out-print-no {
  font-size: 14px;
  font-weight: 700;
}

.stock-out-print-title {
  margin: 8px 0 12px;
  text-align: center;
  font-size: 19px;
  font-weight: 700;
  letter-spacing: 0;
}

.stock-out-print-meta {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 0;
  border: 1px solid #000;
  border-bottom: 0;
  font-size: 13px;
}

.stock-out-print-meta div {
  min-height: 28px;
  line-height: 28px;
  padding: 0 8px;
  border-right: 1px solid #000;
}

.stock-out-print-meta div:last-child {
  border-right: 0;
}

.stock-out-print-meta span {
  font-weight: 700;
}

.stock-out-print-table {
  width: 100%;
  border-collapse: collapse;
  table-layout: fixed;
}

.stock-out-print-table th,
.stock-out-print-table td {
  border: 1px solid #000;
  min-height: 25px;
  line-height: 25px;
  padding: 2px;
  text-align: center;
  word-break: break-word;
}

.stock-out-print-table th {
  font-weight: 700;
}

.stock-out-print-table .col-seq {
  width: 44px;
}

.stock-out-print-table .col-ref {
  width: 105px;
}

.stock-out-print-table .col-code {
  width: 130px;
}

/* DIY：打印「颜色」列固定宽 — print.vue .col-color */
.stock-out-print-table .col-color {
  width: 110px;
}

.stock-out-print-table .col-unit {
  width: 50px;
}

.stock-out-print-table .col-qty {
  width: 50px;
}

.stock-out-print-table .num {
  text-align: center;
  padding-right: 2px;
}

.stock-out-print-total td {
  font-weight: 700;
}

/* DIY：签名栏字号/上间距 — 紧跟表格，不贴页底 */
.stock-out-print-sign {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 18px;
  margin-top: 10px;
  font-size: 13px;
  page-break-inside: avoid;
}

@page {
  size: 215mm 139mm;
  margin: 0;
}

@media print {
  :global(body) {
    margin: 0;
    background: #fff;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }

  .no-print {
    display: none !important;
  }

  .stock-out-print-page {
    min-height: 0;
    padding: 0;
    background: #fff;
  }

  .stock-out-print-area {
    width: 100%;
    margin: 0;
  }

  .stock-out-print-doc {
    box-sizing: border-box;
    width: 100%;
    min-height: 0;
    height: auto;
    overflow: visible;
    box-shadow: none;
    margin: 0;
    padding: 5mm 6mm;
    break-after: auto;
    page-break-after: auto;
  }

  .stock-out-print-doc-manual {
    min-height: 0;
    height: auto;
    overflow: visible;
    break-inside: avoid;
    page-break-inside: avoid;
  }

  .stock-out-print-doc + .stock-out-print-doc {
    break-before: page;
    page-break-before: always;
  }
}
</style>
