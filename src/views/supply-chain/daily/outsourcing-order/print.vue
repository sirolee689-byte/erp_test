<template>
  <!-- 采购格式 / 外协格式：同一套采购订单观感；差异仅「外协内容」列（wxgs=1 显示） -->
  <main class="assist-po-print-page">
    <div class="assist-po-print-toolbar no-print">
      <el-button type="primary" :disabled="!docs.length" @click="printPage">点击此处打印</el-button>
      <el-button @click="goBack">返回</el-button>
      <el-select
        :model-value="String(setup.rowsPerPage)"
        class="assist-po-print-page-size"
        placeholder="每页行数"
        @change="onRowsPerPageChange"
      >
        <el-option v-for="opt in rowsPerPageOptions" :key="opt.value" :label="opt.label" :value="opt.value" />
      </el-select>
      <span class="assist-po-print-toolbar-label">单价小数位</span>
      <el-input-number
        v-model="setup.priceDecimals"
        :min="2"
        :max="5"
        :step="1"
        size="small"
        @change="loadPrintData"
      />
    </div>

    <el-alert v-if="loading" title="正在读取外协订单打印数据..." type="info" show-icon class="no-print" />
    <div v-else-if="errorMsg" class="assist-po-print-error no-print">{{ errorMsg }}</div>

    <section v-else class="assist-po-print-area">
      <el-empty v-if="!docs.length" description="暂无打印数据" class="no-print" />
      <template v-else>
        <template v-for="(doc, docIndex) in docs" :key="doc.header.assistOrderNo">
          <article
            v-for="page in doc.pages"
            :key="`${doc.header.assistOrderNo}-${page.pageNo}`"
            class="assist-po-print-doc"
            :class="{ 'assist-po-print-doc--break': page.pageNo > 1 || docIndex > 0 }"
          >
            <header class="assist-po-print-company">
              <div></div>
              <div class="assist-po-print-company-main">
                <img
                  v-if="printConfig.logoSrc"
                  class="assist-po-print-logo"
                  :src="printConfig.logoSrc"
                  alt="logo"
                  @error="hideLogo"
                />
                <div
                  v-if="printConfig.headerHtml"
                  class="assist-po-print-head-html"
                  v-html="printConfig.headerHtml"
                />
                <div v-else class="assist-po-print-company-text">
                  <strong>中山市卓越皮具有限公司</strong>
                  <span>地址：中山市港口镇木河迳西路10号</span>
                  <span>电话：0760-28150063 传真：0760-28150050</span>
                </div>
              </div>
              <div class="assist-po-print-no">
                <!-- 页码对齐出库单打印：如 1/2页；每张单据独立从 1 起算 -->
                <div>{{ page.pageNo }}/{{ page.pageTotal }}页</div>
                <div>NO. {{ doc.header.assistOrderNo }}</div>
              </div>
            </header>

            <h1 class="assist-po-print-title">外协单</h1>

            <section class="assist-po-print-meta">
              <div>
                <p><span>加工商:</span> {{ blank(doc.header.supplierShortName || doc.header.supplierName) }}</p>
                <p><span>电话:</span> {{ blank(doc.header.tel) }}</p>
                <p><span>联系人:</span> {{ blank(doc.header.contact) }}</p>
              </div>
              <div>
                <p><span>结算方式:</span> {{ blank(doc.header.payFor) }}</p>
                <p><span>是否含税:</span> {{ blank(doc.header.taxFlag) }}</p>
              </div>
              <div>
                <p><span>日期:</span> {{ blank(doc.header.date) }}</p>
                <p><span>币别:</span> {{ blank(doc.header.currencyName) }}</p>
                <p><span>PI:</span> {{ blank(doc.header.piNo) }}</p>
              </div>
              <p class="assist-po-print-meta-remark"><span>地址:</span> {{ blank(doc.header.address) }}</p>
              <p class="assist-po-print-meta-remark"><span>备注:</span> {{ blank(doc.header.remark) }}</p>
            </section>

            <table class="assist-po-print-table">
              <thead>
                <tr>
                  <th class="col-seq">序号</th>
                  <th class="col-code">材料编码</th>
                  <th>材料名称/规格</th>
                  <th>对应款号</th>
                  <th>配件颜色</th>
                  <th class="col-group">组别</th>
                  <th class="col-unit">单位</th>
                  <th class="col-qty">数量</th>
                  <th class="col-money">单价</th>
                  <th class="col-money">金额</th>
                  <th class="col-date">交期</th>
                  <th class="col-tax">税点</th>
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
                <!-- 末页合计行：左侧备注说明与合计同排 -->
                <tr v-if="page.pageNo === page.pageTotal" class="assist-po-print-total">
                  <td colspan="7" class="assist-po-print-remark-cell">
                    <strong>备注：</strong>仅加工，不含开料，不含包装，以上价格包含乙方送货至甲方的单程运费。
                  </td>
                  <td>合计</td>
                  <td class="num" colspan="2">
                    数量 {{ doc.totals.quantity }}　金额 {{ doc.totals.amount }}
                  </td>
                  <td :colspan="doc.showDescribeColumn ? 3 : 2"></td>
                </tr>
              </tbody>
            </table>

            <template v-if="page.pageNo === page.pageTotal">
              <!-- 合约条款+签名共用外框，避免两段各自画边线导致左右缺口 -->
              <div class="assist-po-print-bottom">
                <section class="assist-po-print-notes">
                  <div class="assist-po-print-notes-title">合约条款</div>
                  <ul>
                    <li v-for="(term, idx) in doc.contractTerms" :key="term">
                      {{ toChineseNumeral(idx + 1) }}、{{ term }}
                    </li>
                  </ul>
                </section>

                <footer class="assist-po-print-sign">
                  <div class="assist-po-print-sign-body">
                    <div class="assist-po-print-sign-col">
                      <p>甲方：</p>
                      <p>盖章：</p>
                      <p>日期：</p>
                    </div>
                    <div class="assist-po-print-sign-col">
                      <p>应付会计：</p>
                      <p>厂长：</p>
                    </div>
                    <div class="assist-po-print-sign-col">
                      <p>乙方：</p>
                      <p>盖章：</p>
                      <p>日期：</p>
                    </div>
                  </div>
                  <div class="assist-po-print-sign-meta">
                    <span>制表人：{{ blank(doc.signature?.makerName) }}</span>
                    <span class="assist-po-print-sign-check">核对：</span>
                    <span class="assist-po-print-sign-check-space"></span>
                  </div>
                </footer>
              </div>
            </template>
          </article>
        </template>
      </template>
    </section>
  </main>
</template>

<script setup>
import axios from 'axios'
import { computed, reactive, ref } from 'vue'
import { useRoute } from 'vue-router'
import { ElMessage } from 'element-plus'

const route = useRoute()
const loading = ref(false)
const errorMsg = ref('')
const docs = ref([])
const defaultLogoSrc = '/images/logo.png'
const printConfig = reactive({ logoSrc: '', headerHtml: '' })
const setup = reactive({ rowsPerPage: 12, priceDecimals: 2 })

/** wxgs=1 采购格式（含外协内容列）；其余为外协格式（同观感、无外协内容列） */
const isPurchaseFormat = computed(() => text(route.query.wxgs) === '1')

const rowsPerPageOptions = Array.from({ length: 11 }, (_, index) => {
  const value = String(index + 3)
  return { label: `${value}行/页`, value }
})

function text(value) {
  return String(value ?? '').trim()
}

function blank(value) {
  return text(value) || '-'
}

/** 合约条款序号：1→一 … 12→十二 */
const CHINESE_NUMERALS = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十', '十一', '十二']
function toChineseNumeral(n) {
  const i = Number(n)
  if (!Number.isFinite(i) || i < 1) return String(n)
  return CHINESE_NUMERALS[i - 1] || String(n)
}

function onRowsPerPageChange(value) {
  setup.rowsPerPage = Number(value) || 12
  loadPrintData()
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
        wxgs: isPurchaseFormat.value ? '1' : '0',
        rowsPerPage: setup.rowsPerPage,
        priceDecimals: setup.priceDecimals,
      },
    })
    docs.value = Array.isArray(data?.data?.list) ? data.data.list : []
    setup.rowsPerPage = Number(data?.data?.setup?.rowsPerPage ?? setup.rowsPerPage)
    setup.priceDecimals = Number(data?.data?.setup?.priceDecimals ?? setup.priceDecimals)
    printConfig.logoSrc = text(data?.data?.printConfig?.logoSrc) || defaultLogoSrc
    printConfig.headerHtml = text(data?.data?.printConfig?.headerHtml || data?.data?.printConfig?.info)
  } catch (err) {
    docs.value = []
    errorMsg.value = err?.response?.data?.msg || err?.message || '读取外协订单打印数据失败'
  } finally {
    loading.value = false
  }
}

function hideLogo() {
  if (printConfig.logoSrc !== defaultLogoSrc) {
    printConfig.logoSrc = defaultLogoSrc
    return
  }
  printConfig.logoSrc = ''
}

function printPage() {
  if (!docs.value.length) {
    ElMessage.warning('暂无可打印数据')
    return
  }
  document.documentElement.classList.add('print-assist-order-po')
  const cleanup = () => {
    document.documentElement.classList.remove('print-assist-order-po')
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
  // 不是脚本打开的页签可能被浏览器拒绝关闭，关闭失败后回退到来源页
  setTimeout(() => {
    if (!window.closed) window.history.back()
  }, 100)
}

loadPrintData()
</script>

<style scoped>
.assist-po-print-page {
  min-height: 100vh;
  padding: 12px;
  background: #e8edf3;
  color: #000;
  font-family: Arial, "Microsoft YaHei", sans-serif;
}
.assist-po-print-toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
  flex-wrap: wrap;
}
.assist-po-print-page-size {
  width: 128px;
}
.assist-po-print-toolbar-label {
  color: #606266;
  white-space: nowrap;
}
.assist-po-print-toolbar .el-input-number {
  width: 120px;
}
.assist-po-print-error {
  padding: 18px;
  color: #b42318;
  background: #fff;
  border: 1px solid #f0b8b8;
}
.assist-po-print-area {
  max-width: 1620px;
  margin: 0 auto;
}
.assist-po-print-doc {
  padding: 18px;
  margin-bottom: 18px;
  background: #eef3f8;
}
.assist-po-print-doc--break {
  page-break-before: always;
}
.assist-po-print-company {
  display: grid;
  grid-template-columns: 220px 1fr 220px;
  align-items: start;
  min-height: 92px;
}
.assist-po-print-company-main {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
}
.assist-po-print-logo {
  max-width: 260px;
  max-height: 48px;
  object-fit: contain;
}
.assist-po-print-head-html {
  font-size: 14px;
  line-height: 1.3;
}
.assist-po-print-head-html :deep(*) {
  margin-top: 0;
  margin-bottom: 0;
}
.assist-po-print-company-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
  font-size: 13px;
}
.assist-po-print-company-text strong {
  font-size: 20px;
}
.assist-po-print-no {
  text-align: right;
  font-size: 13px;
  line-height: 1.5;
}
.assist-po-print-title {
  margin: 6px 0 10px;
  text-align: center;
  font-size: 28px;
  font-weight: 700;
  letter-spacing: 8px;
}
.assist-po-print-meta {
  display: grid;
  grid-template-columns: 1.2fr 1fr 1fr;
  gap: 4px 18px;
  margin-bottom: 10px;
  font-size: 13px;
}
.assist-po-print-meta p {
  margin: 0;
  line-height: 1.55;
}
.assist-po-print-meta-remark {
  grid-column: 1 / -1;
}
.assist-po-print-meta span {
  font-weight: 700;
}
.assist-po-print-table {
  width: 100%;
  border-collapse: collapse;
  table-layout: fixed;
  font-size: 13px;
  background: #eef3f8;
}
.assist-po-print-table th,
.assist-po-print-table td {
  border: 1px solid #000;
  padding: 6px 5px;
  text-align: center;
  vertical-align: middle;
  word-break: break-word;
}
.assist-po-print-table th {
  font-weight: 700;
}
.assist-po-print-table .num {
  text-align: center;
}
.col-seq { width: 42px; }
.col-code { width: 120px; }
.col-group { width: 56px; }
.col-unit { width: 48px; }
.col-qty { width: 72px; }
.col-money { width: 88px; }
.col-date { width: 100px; }
.col-tax { width: 56px; }
.assist-po-print-total td {
  font-weight: 700;
}
.assist-po-print-remark-cell {
  text-align: left !important;
  font-weight: 400 !important;
  padding-left: 8px !important;
}
.assist-po-print-remark-cell strong {
  font-weight: 700;
}
/* 与明细表同宽：外框只画一次，条款/签名用内部分隔线 */
.assist-po-print-bottom {
  border: 1px solid #000;
  border-top: 0;
  box-sizing: border-box;
  width: 100%;
}
.assist-po-print-notes {
  border: 0;
  border-bottom: 1px solid #000;
  padding: 8px 12px 10px;
  font-size: 12px;
  line-height: 1.45;
}
.assist-po-print-notes-title {
  font-size: 14px;
  font-weight: 700;
  margin-bottom: 4px;
}
.assist-po-print-notes ul {
  margin: 0;
  padding: 0;
  list-style: none;
}
.assist-po-print-notes li {
  margin: 2px 0;
}
.assist-po-print-sign {
  margin: 0;
  border: 0;
  font-size: 13px;
}
.assist-po-print-sign-body {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  gap: 12px 24px;
  padding: 14px 16px 28px;
  min-height: 110px;
}
.assist-po-print-sign-col p {
  margin: 0 0 22px;
  font-weight: 700;
}
.assist-po-print-sign-col p:last-child {
  margin-bottom: 0;
}
.assist-po-print-sign-meta {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  align-items: center;
  padding: 8px 16px;
  border-top: 1px solid #666;
  font-weight: 700;
}
.assist-po-print-sign-check {
  justify-self: start;
  padding-left: 12%;
}
.assist-po-print-sign-check-space {
  min-height: 1em;
}

@media print {
  .no-print { display: none !important; }
  .assist-po-print-page {
    padding: 0;
    background: #eef3f8;
  }
  .assist-po-print-area {
    max-width: none;
  }
  .assist-po-print-doc {
    margin: 0;
    padding: 10mm;
    box-shadow: none;
  }
}
</style>
