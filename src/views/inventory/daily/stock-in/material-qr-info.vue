<template>
  <main class="qr-page">
    <div v-if="loading" class="qr-state">正在读取入库物料信息...</div>
    <div v-else-if="errorMsg" class="qr-state qr-state--error">{{ errorMsg }}</div>

    <section v-else class="qr-content">
      <h1>入库物料信息</h1>
      <div class="qr-material-code">【{{ info.materialCode }}】</div>

      <section class="qr-section">
        <p>入库单号： {{ valueText(info.receiptNo) }}</p>
        <p>关联单号： {{ valueText(info.sourceOrderNo) }}</p>
        <p>入库数量： {{ valueText(info.inboundQty) }}</p>
        <p>PI号： {{ valueText(info.piNo) }}</p>
      </section>

      <section class="qr-section">
        <p>中文名称： {{ valueText(info.chineseName) }}</p>
        <p>英文名称： {{ valueText(info.englishName) }}</p>
        <p>规则： {{ valueText(info.spec) }}</p>
        <p>颜色： {{ valueText(info.color) }}</p>
        <p>使用单位： {{ valueText(info.unit) }}</p>
        <p>分类： {{ valueText(info.category) }}</p>
        <p>组别： {{ valueText(info.groupName) }}</p>
        <p>产地： {{ valueText(info.origin) }}</p>
        <p>备注： {{ valueText(info.remark) }}</p>
      </section>

      <section class="qr-section">
        <h2>库存实时信息：</h2>
        <p>仓库库存数量： {{ valueText(info.inventory?.warehouseQty, '0') }}</p>
        <p>板房库存数量： {{ valueText(info.inventory?.sampleRoomQty, '0') }}</p>
      </section>

      <section class="qr-section">
        <h2>最近五条采购信息：</h2>
        <p v-if="!info.recentPurchases?.length">暂无采购信息</p>
        <p v-for="item in info.recentPurchases" :key="`p-${item.purchaseNo}-${item.date}`">
          {{ valueText(item.purchaseNo) }}，日期： {{ valueText(item.date) }}，数量： {{ valueText(item.qty) }}
        </p>
      </section>

      <section class="qr-section">
        <h2>最近五条入库信息：</h2>
        <template v-if="info.recentInbounds?.length">
          <div v-for="item in info.recentInbounds" :key="`i-${item.receiptNo}-${item.time}`" class="qr-inbound-line">
            <p>{{ valueText(item.receiptNo) }}，时间： {{ valueText(item.time) }}</p>
            <p>关联单号： {{ valueText(item.sourceOrderNo) }}，数量： {{ valueText(item.qty) }}</p>
          </div>
        </template>
        <p v-else>暂无入库信息</p>
      </section>

      <footer class="qr-footer">
        <p>卓越ERP系统--入库物料二维码信息</p>
        <p>系统唯一开发人： {{ info.developerName || '廖越锋' }}</p>
        <p>Update： {{ info.updateDate || todayText }}</p>
      </footer>
    </section>
  </main>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import axios from 'axios'

defineOptions({ name: 'stock-in-material-qr-info' })

const route = useRoute()
const loading = ref(false)
const errorMsg = ref('')
const info = ref({})

const todayText = computed(() => new Date().toISOString().slice(0, 10))

function valueText(value, fallback = '') {
  const text = String(value ?? '').trim()
  return text || fallback
}

async function loadInfo() {
  loading.value = true
  errorMsg.value = ''
  try {
    const { data } = await axios.get('/api/stock-in/material-qr-info', {
      params: {
        action: route.query.action || 'stocks',
        kcaa01: route.query.kcaa01 || '',
        kcao01: route.query.kcao01 || '',
      },
    })
    info.value = data?.data || {}
  } catch (err) {
    errorMsg.value = err?.response?.data?.msg || err?.message || '读取入库物料信息失败'
  } finally {
    loading.value = false
  }
}

onMounted(loadInfo)
</script>

<style scoped>
.qr-page {
  min-height: 100vh;
  margin: 0;
  padding: 28px 24px 40px;
  color: #f5f5f5;
  background:
    radial-gradient(circle at 20% 0%, rgba(255, 255, 255, 0.05), transparent 34%),
    linear-gradient(145deg, #2a2a2a, #141414 52%, #242424);
  font-family: Arial, "Microsoft YaHei", sans-serif;
}
.qr-content {
  max-width: 780px;
  margin: 0 auto;
}
.qr-content h1 {
  margin: 0;
  text-align: center;
  font-size: clamp(36px, 9vw, 64px);
  line-height: 1.15;
  font-weight: 800;
}
.qr-material-code {
  margin: 18px auto 46px;
  color: #ff9f16;
  text-align: center;
  font-size: clamp(42px, 10vw, 72px);
  line-height: 1.2;
  font-weight: 800;
  overflow-wrap: anywhere;
}
.qr-section {
  padding: 22px 0;
  border-bottom: 2px solid rgba(255, 255, 255, 0.72);
}
.qr-section p {
  margin: 0 0 10px;
  font-size: clamp(24px, 5.6vw, 36px);
  line-height: 1.32;
  overflow-wrap: anywhere;
}
.qr-section h2 {
  margin: 0 0 12px;
  color: #ff9f16;
  font-size: clamp(26px, 6vw, 38px);
  line-height: 1.25;
  font-weight: 500;
}
.qr-inbound-line {
  margin-bottom: 12px;
}
.qr-footer {
  padding-top: 72px;
  text-align: center;
}
.qr-footer p {
  margin: 8px 0;
  font-size: clamp(26px, 6vw, 38px);
  line-height: 1.28;
}
.qr-state {
  min-height: 70vh;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #f5f5f5;
  text-align: center;
  font-size: 24px;
}
.qr-state--error {
  color: #ffbd63;
}
@media (min-width: 900px) {
  .qr-page {
    padding-inline: 56px;
  }
}
</style>
