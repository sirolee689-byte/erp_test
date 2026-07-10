<template>
  <main class="assist-order-print-page">
    <div class="assist-order-print-toolbar no-print">
      <span>每页行数</span>
      <el-input-number v-model="setup.rowsPerPage" :min="3" :max="15" :step="1" size="small" @change="loadPrintData" />
      <span>单价小数位</span>
      <el-input-number v-model="setup.priceDecimals" :min="2" :max="5" :step="1" size="small" @change="loadPrintData" />
      <el-button type="primary" :loading="loading" @click="loadPrintData">刷新预览</el-button>
      <el-button type="success" :disabled="!docs.length" @click="printPage">打印</el-button>
    </div>

    <el-alert v-if="errorMsg" :title="errorMsg" type="error" show-icon class="no-print" />
    <el-skeleton :loading="loading" animated :rows="8">
      <template #default>
        <el-empty v-if="!errorMsg && !docs.length" description="暂无打印数据" />
        <section v-for="doc in docs" :key="doc.header.assistOrderNo" class="assist-print-doc">
          <article v-for="page in doc.pages" :key="`${doc.header.assistOrderNo}-${page.pageNo}`" class="assist-print-sheet">
            <header class="assist-print-title">
              <div class="assist-print-brand">
                <img v-if="printConfig.logoSrc" :src="printConfig.logoSrc" alt="系统抬头" @error="hideLogo" />
                <div v-if="printConfig.headerHtml" class="assist-print-header-html" v-html="printConfig.headerHtml" />
              </div>
              <div class="assist-print-title__main">
                <h1>外协单</h1>
                <span>第 {{ page.pageNo }} / {{ page.pageTotal }} 页</span>
              </div>
              <div class="assist-print-code">
                <img v-if="codeImages[doc.header.assistOrderNo]" :src="codeImages[doc.header.assistOrderNo]" alt="单号编码" />
                <strong>NO. {{ doc.header.assistOrderNo }}</strong>
              </div>
            </header>

            <div class="assist-print-head">
              <span>加工商：{{ doc.header.supplierShortName || doc.header.supplierName || '-' }}</span>
              <span>结算方式：{{ doc.header.payFor || '-' }}</span>
              <span>日期：{{ doc.header.date || '-' }}</span>
              <span>地址：{{ doc.header.address || '-' }}</span>
              <span>PI号/关联单号：{{ doc.header.piNo || '-' }}</span>
              <span>联系人：{{ doc.header.contact || '-' }}</span>
              <span>联系电话：{{ doc.header.tel || '-' }}</span>
              <span>币别：{{ doc.header.currencyName || '-' }}</span>
              <span>是否含税：{{ doc.header.taxFlag || '-' }}</span>
              <span class="assist-print-head__remark">备注：{{ doc.header.remark || '-' }}</span>
            </div>

            <table class="assist-print-table" :class="{ 'assist-print-table--purchase': doc.showDescribeColumn }">
              <thead>
                <tr>
                  <th>序号</th>
                  <th>材料编码</th>
                  <th>材料名称/规格</th>
                  <th>对应款号</th>
                  <th>配件颜色</th>
                  <th>组别</th>
                  <th>单位</th>
                  <th>数量</th>
                  <th>单价</th>
                  <th>金额</th>
                  <th>交期</th>
                  <th>税点</th>
                  <th v-if="doc.showDescribeColumn">外协内容</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="row in page.rows" :key="`${page.pageNo}-${row.seq}`">
                  <td>{{ row.seq }}</td>
                  <td>{{ row.materialCode }}</td>
                  <td>
                    <template v-if="row.type === 'fee'">
                      <div>{{ row.materialName }}</div>
                      <div v-if="row.invoiceName">开票名：{{ row.invoiceName }}</div>
                      <div v-if="row.spec">{{ row.spec }}</div>
                    </template>
                    <template v-else>
                      <div>{{ row.materialName }}</div>
                      <div>{{ row.spec }}</div>
                    </template>
                  </td>
                  <td>{{ row.product }}</td>
                  <td>{{ row.color }}</td>
                  <td>{{ row.group }}</td>
                  <td>{{ row.unit }}</td>
                  <td class="num">{{ row.quantity }}</td>
                  <td class="num">{{ row.price }}</td>
                  <td class="num">{{ row.amount }}</td>
                  <td>{{ row.deliveryDate }}</td>
                  <td>{{ row.tax }}</td>
                  <td v-if="doc.showDescribeColumn">{{ row.describe }}</td>
                </tr>
              </tbody>
            </table>

            <div v-if="page.pageNo === page.pageTotal" class="assist-print-tail">
              <p>仅加工，不含开料，不含包装，以上价格包含乙方送货至甲方的单程运费。</p>
              <div class="assist-print-total">数量合计：{{ doc.totals.quantity }}　金额合计：{{ doc.totals.amount }}</div>
              <ol class="assist-print-terms">
                <li v-for="term in doc.contractTerms" :key="term">{{ term }}</li>
              </ol>
              <div class="assist-print-sign">
                <span>甲方：</span><span>应付会计：</span><span>乙方：</span><span>盖章：</span>
                <span>厂长：</span><span>日期：</span><span>制表人：{{ doc.signature.makerName || '-' }}</span><span>核对：</span>
              </div>
            </div>
          </article>
        </section>
      </template>
    </el-skeleton>
  </main>
</template>

<script setup>
import axios from 'axios'
import QRCode from 'qrcode'
import { reactive, ref } from 'vue'
import { useRoute } from 'vue-router'
import { ElMessage } from 'element-plus'

const route = useRoute()
const loading = ref(false)
const errorMsg = ref('')
const docs = ref([])
const codeImages = ref({})
const printConfig = reactive({ logoSrc: '', headerHtml: '' })
const setup = reactive({ rowsPerPage: 12, priceDecimals: 2 })

function text(value) {
  return String(value ?? '').trim()
}

async function loadCodeImages(list) {
  const pairs = await Promise.all((list || []).map(async (doc) => {
    const orderNo = text(doc?.header?.assistOrderNo)
    if (!orderNo) return [orderNo, '']
    try {
      return [orderNo, await QRCode.toDataURL(orderNo, { margin: 0, width: 76 })]
    } catch {
      return [orderNo, '']
    }
  }))
  codeImages.value = Object.fromEntries(pairs.filter(([key]) => key))
}

async function loadPrintData() {
  const pSum = text(route.query.p_sum)
  if (!pSum) {
    errorMsg.value = '请选择需要打印的订单'
    docs.value = []
    return
  }
  loading.value = true
  errorMsg.value = ''
  try {
    const { data } = await axios.get('/api/assist-order/print-data', {
      params: {
        p_sum: pSum,
        wxgs: route.query.wxgs === '1' ? '1' : '0',
        rowsPerPage: setup.rowsPerPage,
        priceDecimals: setup.priceDecimals,
      },
    })
    docs.value = Array.isArray(data?.data?.list) ? data.data.list : []
    setup.rowsPerPage = Number(data?.data?.setup?.rowsPerPage ?? setup.rowsPerPage)
    setup.priceDecimals = Number(data?.data?.setup?.priceDecimals ?? setup.priceDecimals)
    printConfig.logoSrc = text(data?.data?.printConfig?.logoSrc)
    printConfig.headerHtml = text(data?.data?.printConfig?.headerHtml || data?.data?.printConfig?.info)
    await loadCodeImages(docs.value)
  } catch (err) {
    docs.value = []
    codeImages.value = {}
    errorMsg.value = err?.response?.data?.msg || err?.message || '读取外协订单打印数据失败'
  } finally {
    loading.value = false
  }
}

function hideLogo() {
  printConfig.logoSrc = ''
}

function printPage() {
  if (!docs.value.length) {
    ElMessage.warning('暂无可打印数据')
    return
  }
  window.print()
}

loadPrintData()
</script>

<style scoped>
.assist-order-print-page { max-width: 1180px; margin: 0 auto; padding: 16px; color: #111; background: #fff; }
.assist-order-print-toolbar { display: flex; align-items: center; gap: 10px; margin-bottom: 16px; }
.assist-order-print-toolbar .el-input-number { width: 120px; }
.assist-print-doc { display: flex; flex-direction: column; gap: 18px; }
.assist-print-sheet { min-height: 277mm; padding: 10mm; border: 1px solid #c8c8c8; background: #fff; page-break-after: always; }
.assist-print-title { display: grid; grid-template-columns: 1fr auto 1fr; align-items: start; gap: 12px; margin-bottom: 10px; }
.assist-print-brand { min-height: 54px; font-size: 12px; }
.assist-print-brand img { display: block; max-width: 160px; max-height: 48px; object-fit: contain; }
.assist-print-header-html :deep(*) { margin: 0; font-size: 12px; }
.assist-print-title__main { text-align: center; white-space: nowrap; }
.assist-print-title__main h1 { margin: 0 0 4px; font-size: 22px; }
.assist-print-title__main span { font-size: 12px; }
.assist-print-code { justify-self: end; display: flex; flex-direction: column; align-items: end; gap: 3px; font-size: 12px; }
.assist-print-code img { width: 76px; height: 76px; }
.assist-print-head { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 6px 14px; margin-bottom: 9px; font-size: 12px; }
.assist-print-head__remark { grid-column: span 2; }
.assist-print-table { width: 100%; border-collapse: collapse; table-layout: fixed; font-size: 11px; }
.assist-print-table th, .assist-print-table td { border: 1px solid #222; padding: 4px; vertical-align: top; word-break: break-all; }
.assist-print-table th { background: #f5f5f5; text-align: center; }
.assist-print-table .num { text-align: right; }
.assist-print-table th:nth-child(1) { width: 28px; }
.assist-print-table th:nth-child(2) { width: 88px; }
.assist-print-table th:nth-child(3) { width: 118px; }
.assist-print-table th:nth-child(4) { width: 72px; }
.assist-print-table th:nth-child(5) { width: 72px; }
.assist-print-table th:nth-child(6), .assist-print-table th:nth-child(7) { width: 42px; }
.assist-print-table th:nth-child(8) { width: 48px; }
.assist-print-table th:nth-child(9), .assist-print-table th:nth-child(10) { width: 58px; }
.assist-print-table th:nth-child(11) { width: 76px; }
.assist-print-table th:nth-child(12) { width: 42px; }
.assist-print-table--purchase th:last-child { width: 90px; }
.assist-print-tail { margin-top: 10px; font-size: 12px; }
.assist-print-tail p { margin: 0 0 8px; }
.assist-print-total { text-align: right; font-weight: 700; }
.assist-print-terms { columns: 2; gap: 26px; margin: 10px 0; padding-left: 20px; line-height: 1.55; }
.assist-print-sign { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 18px 10px; margin-top: 14px; }
@media print {
  .no-print { display: none !important; }
  .assist-order-print-page { max-width: none; margin: 0; padding: 0; }
  .assist-print-sheet { min-height: 0; border: 0; padding: 8mm; }
}
</style>
