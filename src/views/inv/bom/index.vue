<template>
  <div class="erp-module-page">
    <!--
      v1.1.7：BOM 主档列表（bom_000），严格服务端分页，避免一次渲染 6.8W 行拖垮浏览器。
      性能约定：编码/名称模糊搜索仅在后端「满 3 字」时生效（参数化 LIKE），降低大表全表扫风险。
    -->
    <el-card shadow="never">
      <template #header>
        <span class="page-title">{{ pageTitle }}</span>
      </template>
      <p class="page-desc">
        数据来自物理表 <code>bom_000</code>（可通过环境变量 <code>INV_BOM_MASTER_TABLE</code> 覆盖表名）。默认每页 10 条，仅加载当前页数据。
      </p>

      <div class="search-row">
        <el-input
          v-model="code"
          placeholder="物料编码（至少 3 个字才参与模糊查询）"
          clearable
          style="max-width: 220px"
          @keyup.enter="onSearch"
        />
        <el-input
          v-model="name"
          placeholder="物料名称（至少 3 个字才参与模糊查询）"
          clearable
          style="max-width: 260px"
          @keyup.enter="onSearch"
        />
        <div class="audit-switch">
          <span class="switch-label">显示未审核</span>
          <el-switch v-model="showUnAudited" @change="onSearch" />
        </div>
        <el-button type="primary" @click="onSearch">查询</el-button>
        <el-button @click="onReset">重置</el-button>
      </div>

      <el-alert
        v-if="hintShort"
        type="info"
        show-icon
        :closable="false"
        class="hint-alert"
        title="提示：编码或名称不足 3 个字时不会作为筛选条件（避免大表慢查询）。"
      />

      <el-alert v-if="errorMessage" :title="errorMessage" type="error" show-icon class="error-alert" />

      <el-alert
        v-if="showUnAudited"
        title="当前显示：未审核（pass=0）的 BOM 行"
        type="warning"
        show-icon
        class="audit-view-alert"
      />

      <el-skeleton :loading="loading" animated :rows="8">
        <template #default>
          <el-table
            :data="tableList"
            border
            stripe
            style="width: 100%"
            row-key="rowKey"
            :empty-text="loading ? '加载中…' : '暂无数据'"
          >
            <el-table-column prop="code" label="编码" min-width="120" show-overflow-tooltip />
            <el-table-column prop="name" label="名称" min-width="160" show-overflow-tooltip />
            <el-table-column prop="spec" label="规格" min-width="120" show-overflow-tooltip />
            <el-table-column prop="unit" label="单位" width="72" show-overflow-tooltip />
            <el-table-column label="成本用量,成品用量" min-width="210">
              <template #default="{ row }">
                <div v-if="row.calcStatus === 'not_needed'" class="usage-sum-muted"></div>
                <div v-else class="usage-sum-cell">
                  <div>成本：{{ row.sumCost04 ?? '0.0000' }}，{{ row.sumCost06 ?? '0.0000' }}</div>
                  <div>成品：{{ row.sumCons04 ?? '0.0000' }}，{{ row.sumCons06 ?? '0.0000' }}</div>
                </div>
              </template>
            </el-table-column>
            <el-table-column label="是否运算用量" width="110">
              <template #default="{ row }">
                <el-tag v-if="row.calcStatus === 'done'" type="success" size="small">已运算</el-tag>
                <el-tag v-else-if="row.calcStatus === 'not_done'" type="danger" size="small">未运算</el-tag>
                <el-tag v-else type="info" size="small">不需运算</el-tag>
              </template>
            </el-table-column>
            <el-table-column prop="addtime" label="输入时间" width="150" show-overflow-tooltip>
              <template #default="{ row }">{{ formatDateTime(row.addtime) }}</template>
            </el-table-column>
            <el-table-column prop="edittime" label="修改时间" width="150" show-overflow-tooltip>
              <template #default="{ row }">{{ formatDateTime(row.edittime) }}</template>
            </el-table-column>
            <el-table-column prop="remark" label="备注" min-width="140" show-overflow-tooltip />
            <el-table-column label="采购" width="72" align="center">
              <template #default="{ row }">{{ ynText(row.isPurchase) }}</template>
            </el-table-column>
            <el-table-column label="外协" width="72" align="center">
              <template #default="{ row }">{{ ynText(row.isSubcontract) }}</template>
            </el-table-column>
            <el-table-column label="自产" width="72" align="center">
              <template #default="{ row }">{{ ynText(row.isSelfProduced) }}</template>
            </el-table-column>
            <el-table-column label="审核" width="88">
              <template #default="{ row }">
                <el-tag v-if="rowIsAudited(row)" type="success" size="small">已审</el-tag>
                <el-tag v-else type="info" size="small">未审</el-tag>
              </template>
            </el-table-column>
            <el-table-column label="操作" width="260" fixed="right">
              <template #default="{ row }">
                <el-button v-permission="'view'" size="small" @click="openDetail(row)">查看详情</el-button>
                <el-button v-permission="'view'" size="small" type="primary" plain @click="copyRow(row)">复制</el-button>
                <el-button v-permission="'edit'" size="small" :disabled="rowIsAudited(row)" @click="onEdit(row)">
                  编辑
                </el-button>
              </template>
            </el-table-column>
          </el-table>

          <div class="pagination-row">
            <el-pagination
              background
              layout="total, sizes, prev, pager, next, jumper"
              :total="total"
              :current-page="page"
              :page-size="pageSize"
              :page-sizes="[10, 20, 50, 100]"
              @size-change="onPageSizeChange"
              @current-change="onPageChange"
            />
          </div>
        </template>
      </el-skeleton>
    </el-card>

    <el-dialog v-model="detailVisible" title="BOM 行详情" width="520px" destroy-on-close>
      <el-descriptions v-if="detailRow" :column="1" border size="small">
        <el-descriptions-item label="编码">{{ detailRow.code || '—' }}</el-descriptions-item>
        <el-descriptions-item label="名称">{{ detailRow.name || '—' }}</el-descriptions-item>
        <el-descriptions-item label="规格">{{ detailRow.spec || '—' }}</el-descriptions-item>
        <el-descriptions-item label="单位">{{ detailRow.unit || '—' }}</el-descriptions-item>
        <el-descriptions-item label="输入时间">{{ formatDateTime(detailRow.addtime) }}</el-descriptions-item>
        <el-descriptions-item label="修改时间">{{ formatDateTime(detailRow.edittime) }}</el-descriptions-item>
        <el-descriptions-item label="备注">{{ detailRow.remark || '—' }}</el-descriptions-item>
        <el-descriptions-item label="采购">{{ ynText(detailRow.isPurchase) }}</el-descriptions-item>
        <el-descriptions-item label="外协">{{ ynText(detailRow.isSubcontract) }}</el-descriptions-item>
        <el-descriptions-item label="自产">{{ ynText(detailRow.isSelfProduced) }}</el-descriptions-item>
        <el-descriptions-item label="审核 pass">{{ detailRow.pass || '—' }}</el-descriptions-item>
      </el-descriptions>
    </el-dialog>
  </div>
</template>

<script setup>
import { computed, ref } from 'vue'
import axios from 'axios'
import { ElMessage } from 'element-plus'

/**
 * 默认用于「存货管理 / BOM资料查询」路由；
 * 库存菜单「inventory/basic/bom-data」以子组件方式嵌入时可传入与侧栏一致的标题。
 */
const props = defineProps({
  embeddedTitle: { type: String, default: '' },
})

const pageTitle = computed(() => {
  const t = String(props.embeddedTitle ?? '').trim()
  return t || 'BOM资料查询'
})

const loading = ref(false)
const errorMessage = ref('')
const tableList = ref([])
const total = ref(0)
const page = ref(1)
/** 默认每页 10 条：配合“按最近修改/新增优先”更符合使用习惯 */
const pageSize = ref(10)

const code = ref('')
const name = ref('')
const showUnAudited = ref(false)

const detailVisible = ref(false)
const detailRow = ref(null)

const hintShort = computed(() => {
  const c = String(code.value ?? '').trim()
  const n = String(name.value ?? '').trim()
  if (c.length > 0 && c.length < 3) return true
  if (n.length > 0 && n.length < 3) return true
  return false
})

function formatDateTime(v) {
  const s = String(v ?? '').trim()
  if (!s) return '—'
  // 常见格式：YYYY-MM-DD HH:mm:ss / YYYY-MM-DDTHH:mm:ss.sssZ / 其它字符串
  const t = s.replace('T', ' ').replace('Z', '')
  // 若包含秒，取到分钟；否则原样返回（并做长度保护）
  if (/^\d{4}-\d{1,2}-\d{1,2}\s+\d{1,2}:\d{1,2}/.test(t)) {
    const m = t.match(/^(\d{4}-\d{1,2}-\d{1,2})\s+(\d{1,2}:\d{1,2})/)
    if (m) return `${m[1]} ${m[2]}`
  }
  return t.length > 16 ? t.slice(0, 16) : t
}

function rowIsAudited(row) {
  return String(row?.pass ?? '').trim() === '1'
}

function ynText(v) {
  const s = String(v ?? '').trim()
  if (s === '1' || s.toLowerCase() === 'y' || s === '是') return '是'
  if (s === '0' || s.toLowerCase() === 'n' || s === '否') return '否'
  return s || '—'
}

function withRowKey(list) {
  return (list ?? []).map((r) => ({
    ...r,
    rowKey: `${String(r.code ?? '')}@@${String(r.version ?? '')}`,
  }))
}

async function loadData() {
  loading.value = true
  errorMessage.value = ''
  try {
    const pass = showUnAudited.value ? '0' : '1'
    const c = String(code.value ?? '').trim()
    const n = String(name.value ?? '').trim()
    const params = {
      page: page.value,
      pageSize: pageSize.value,
      pass,
      ...(c.length >= 3 ? { code: c } : {}),
      ...(n.length >= 3 ? { name: n } : {}),
    }
    const res = await axios.get('/api/inv/bom/list', { params })
    const body = res.data
    if (body?.code !== 200) {
      errorMessage.value = body?.msg || '加载失败'
      tableList.value = []
      total.value = 0
      return
    }
    const data = body.data ?? {}
    total.value = Number(data.total ?? 0)
    tableList.value = withRowKey(data.list ?? [])
  } catch (e) {
    const msg = e?.response?.data?.msg || e?.message || '网络错误'
    errorMessage.value = String(msg)
    tableList.value = []
    total.value = 0
  } finally {
    loading.value = false
  }
}

function onSearch() {
  page.value = 1
  loadData()
}

function onReset() {
  code.value = ''
  name.value = ''
  showUnAudited.value = false
  page.value = 1
  loadData()
}

function onPageChange(p) {
  page.value = p
  loadData()
}

function onPageSizeChange(ps) {
  pageSize.value = ps
  page.value = 1
  loadData()
}

function openDetail(row) {
  detailRow.value = { ...row }
  detailVisible.value = true
}

async function copyRow(row) {
  const text = JSON.stringify(
    {
      code: row.code,
      name: row.name,
      spec: row.spec,
      unit: row.unit,
      version: row.version,
      isPurchase: row.isPurchase,
      isSubcontract: row.isSubcontract,
      isSelfProduced: row.isSelfProduced,
      status: row.status,
      pass: row.pass,
    },
    null,
    2,
  )
  try {
    await navigator.clipboard.writeText(text)
    ElMessage.success('已复制到剪贴板')
  } catch {
    ElMessage.warning('复制失败，请手动选择文本复制')
  }
}

function onEdit(row) {
  if (rowIsAudited(row)) return
  ElMessage.info('编辑表单将在后续版本对接保存接口，当前仅开放列表与详情查看。')
}

loadData()
</script>

<style scoped>
.erp-module-page {
  min-height: 200px;
}
.page-title {
  font-size: 18px;
  font-weight: 600;
}
.page-desc {
  margin: 0 0 12px;
  color: var(--el-text-color-secondary);
  font-size: 13px;
}
.search-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
  margin-bottom: 12px;
}
.audit-switch {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  margin-left: 4px;
}
.switch-label {
  font-size: 13px;
  color: var(--el-text-color-regular);
}
.hint-alert,
.error-alert,
.audit-view-alert {
  margin-bottom: 12px;
}
.pagination-row {
  margin-top: 14px;
  display: flex;
  justify-content: flex-end;
}
.usage-sum-cell {
  line-height: 18px;
  font-size: 12px;
}
.usage-sum-muted {
  color: var(--el-text-color-secondary);
  font-size: 12px;
}
</style>
