<template>
  <main class="stock-in-label-print-page">
    <div class="stock-in-label-toolbar no-print">
      <el-button type="primary" @click="printPage">点击此处打印</el-button>
      <span class="stock-in-label-count">共 {{ labels.length }} 张标签</span>
    </div>

    <el-alert v-if="loading" title="正在读取标签数据..." type="info" show-icon class="no-print" />
    <div v-else-if="errorMsg" class="stock-in-label-error no-print">{{ errorMsg }}</div>

    <section v-else id="div_label_print" class="stock-in-label-area">
      <article v-for="item in labels" :key="item.key" class="stock-in-label-card">
        <div class="stock-in-label-qr">
          <img :src="qrSrc(item.qrContent)" :alt="absoluteQrUrl(item.qrContent)" />
        </div>
        <div class="stock-in-label-info">
          <div class="stock-in-label-line stock-in-label-code">编码：{{ item.materialCode }}</div>
          <div class="stock-in-label-line stock-in-label-name">{{ item.nameLabel }}</div>
          <div class="stock-in-label-line">颜色：{{ item.colorText }}</div>
          <div class="stock-in-label-line">数量：{{ item.quantityText }}</div>
          <div class="stock-in-label-line">入库时间：{{ item.inboundTime }}</div>
        </div>
      </article>
    </section>
  </main>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import axios from 'axios'
import { makeQrSvgDataUrl } from '@/utils/qrCodeSvg.js'

const route = useRoute()
const loading = ref(false)
const errorMsg = ref('')
const docs = ref([])

const labels = computed(() => docs.value.flatMap((doc) => doc.labels || []))

function absoluteQrUrl(path) {
  const raw = String(path || '').trim()
  if (/^https?:\/\//i.test(raw)) return raw
  const normalized = raw.startsWith('/') ? raw : `/${raw}`
  return `${window.location.origin}${normalized}`
}

function qrSrc(content) {
  return makeQrSvgDataUrl(absoluteQrUrl(content), { scale: 4, quiet: 4 })
}

async function loadData() {
  loading.value = true
  errorMsg.value = ''
  try {
    const { data } = await axios.get('/api/stock-in/label-print-data', {
      params: { p_sumbq: route.query.p_sumbq || '' },
    })
    docs.value = data?.data?.list || []
  } catch (err) {
    errorMsg.value = err?.response?.data?.msg || err?.message || '读取入库单标签打印数据失败'
  } finally {
    loading.value = false
  }
}

function printPage() {
  document.documentElement.classList.add('print-stock-in-label')
  const cleanup = () => {
    document.documentElement.classList.remove('print-stock-in-label')
    window.removeEventListener('afterprint', cleanup)
  }
  window.addEventListener('afterprint', cleanup)
  requestAnimationFrame(() => {
    window.print()
  })
}

onMounted(loadData)
</script>

<style scoped>
.stock-in-label-print-page {
  min-height: 100vh;
  padding: 16px 20px;
  background: #fff;
  color: #000;
  font-family: Arial, "Microsoft YaHei", sans-serif;
}
.stock-in-label-toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 16px;
}
.stock-in-label-count {
  color: var(--el-text-color-secondary);
  font-size: 13px;
}
.stock-in-label-error {
  color: #c00;
  font-size: 14px;
}
.stock-in-label-area {
  width: 257px;
  margin: 0 auto;
}
.stock-in-label-card {
  display: grid;
  grid-template-columns: 112px 1fr;
  column-gap: 8px;
  width: 257px;
  min-height: 138px;
  padding: 4px 0;
  page-break-inside: avoid;
  break-inside: avoid;
  background: #fff;
}
.stock-in-label-qr {
  width: 112px;
  height: 112px;
  display: flex;
  align-items: flex-start;
  justify-content: center;
  overflow: hidden;
}
.stock-in-label-qr img {
  width: 112px;
  height: 112px;
  image-rendering: pixelated;
}
.stock-in-label-info {
  min-width: 0;
  padding-top: 2px;
  font-size: 12px;
  line-height: 1.25;
  overflow-wrap: anywhere;
}
.stock-in-label-line {
  margin-bottom: 4px;
}
.stock-in-label-code,
.stock-in-label-name {
  font-weight: 700;
}
@media print {
  :global(html.print-stock-in-label body *) {
    visibility: hidden;
  }
  :global(html.print-stock-in-label #div_label_print),
  :global(html.print-stock-in-label #div_label_print *) {
    visibility: visible;
  }
  :global(html.print-stock-in-label body) {
    margin: 0;
    background: #fff;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  :global(html.print-stock-in-label #div_label_print) {
    position: absolute;
    left: 0;
    top: 0;
    width: 257px;
    margin: 0;
  }
  :global(html.print-stock-in-label .stock-in-label-card) {
    page-break-after: always;
    break-after: page;
  }
  :global(html.print-stock-in-label .stock-in-label-card:last-child) {
    page-break-after: auto;
    break-after: auto;
  }
  .no-print {
    display: none !important;
  }
}
</style>
