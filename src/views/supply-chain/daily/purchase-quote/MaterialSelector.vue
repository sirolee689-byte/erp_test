<template>
  <el-dialog
    :model-value="modelValue"
    title="选择物料（BOM 主档）"
    width="720px"
    destroy-on-close
    @update:model-value="(v) => $emit('update:modelValue', v)"
  >
    <p class="ms-tip">
      数据来自 <code>bom_000</code> 已审在册行；关键词至少 <strong>3 个字符</strong>，同时模糊匹配编码（<code>kcaa01</code>）与名称（<code>kcaa02</code>）。
    </p>
    <div class="ms-search">
      <el-input
        v-model="keywordKw"
        clearable
        placeholder="关键词（编码或名称）"
        class="ms-keyword-input"
        @keyup.enter="onSearch"
      />
      <el-button type="primary" :loading="loading" @click="onSearch">查询</el-button>
    </div>
    <el-table
      v-loading="loading"
      :data="rows"
      border
      size="small"
      style="width: 100%; margin-top: 10px"
      max-height="360"
      highlight-current-row
      @row-dblclick="onRowActivate"
    >
      <el-table-column prop="code" label="编码" min-width="120" show-overflow-tooltip />
      <el-table-column prop="name" label="名称" min-width="140" show-overflow-tooltip />
      <el-table-column prop="spec" label="规格" min-width="100" show-overflow-tooltip />
      <el-table-column prop="unit" label="单位" width="80" show-overflow-tooltip />
      <el-table-column label="操作" width="88" fixed="right">
        <template #default="{ row }">
          <el-button type="primary" link size="small" @click="onRowActivate(row)">选择</el-button>
        </template>
      </el-table-column>
    </el-table>
    <div class="ms-pager">
      <el-pagination
        v-model:current-page="page"
        v-model:page-size="pageSize"
        background
        layout="total, prev, pager, next"
        :total="total"
        :page-sizes="[10, 20]"
        @current-change="loadList"
        @size-change="onSizeChange"
      />
    </div>
  </el-dialog>
</template>

<script setup>
import { ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import axios from 'axios'

const props = defineProps({
  modelValue: { type: Boolean, default: false },
})

const emit = defineEmits(['update:modelValue', 'picked'])

/** 单一关键词：后端 OR 匹配 kcaa01 / kcaa02 */
const keywordKw = ref('')
const loading = ref(false)
const rows = ref([])
const total = ref(0)
const page = ref(1)
const pageSize = ref(10)

function bomField(bom, name) {
  if (!bom || !name) return ''
  const t = String(name).toLowerCase()
  for (const k of Object.keys(bom)) {
    if (String(k).toLowerCase() === t) {
      const v = bom[k]
      return v == null ? '' : String(v).trim()
    }
  }
  return ''
}

function onSizeChange() {
  page.value = 1
  loadList()
}

function onSearch() {
  page.value = 1
  loadList()
}

async function loadList() {
  const kw = String(keywordKw.value ?? '').trim()
  if (kw.length > 0 && kw.length < 3) {
    ElMessage.warning('关键词至少输入 3 个字符再查询')
    return
  }
  loading.value = true
  try {
    const res = await axios.get('/api/inv/bom/list', {
      params: {
        page: page.value,
        pageSize: pageSize.value,
        pass: '1',
        bom_cut: '0',
        ...(kw.length >= 3 ? { keyword: kw } : {}),
      },
    })
    const data = res?.data?.data ?? {}
    total.value = Number(data.total ?? 0) || 0
    rows.value = Array.isArray(data.list) ? data.list : []
  } catch (e) {
    ElMessage.error(String(e?.response?.data?.msg ?? e?.message ?? '加载失败'))
    rows.value = []
    total.value = 0
  } finally {
    loading.value = false
  }
}

/** 双击 / 选择：拉取 BOM 整行补齐颜色等字段 */
async function onRowActivate(row) {
  const code = String(row?.code ?? '').trim()
  if (!code) return
  try {
    const res = await axios.get('/api/supply-chain/purchase-quotations/bom-detail', {
      params: { kcaa01: code },
    })
    const bom = res?.data?.data?.bom ?? {}
    emit('picked', {
      kcaa01: bomField(bom, 'kcaa01') || code,
      kcaa02: bomField(bom, 'kcaa02') || String(row.name ?? '').trim(),
      kcaa03: bomField(bom, 'kcaa03') || String(row.spec ?? '').trim(),
      kcaa11: bomField(bom, 'kcaa11'),
      kcaa05: bomField(bom, 'kcaa05') || String(row.unit ?? '').trim(),
    })
    emit('update:modelValue', false)
  } catch (e) {
    const status = e?.response?.status
    if (status === 404) {
      emit('picked', {
        kcaa01: code,
        kcaa02: String(row.name ?? '').trim(),
        kcaa03: String(row.spec ?? '').trim(),
        kcaa11: '',
        kcaa05: String(row.unit ?? '').trim(),
      })
      emit('update:modelValue', false)
      ElMessage.warning('未查到完整 BOM 资料，已使用列表字段填充')
      return
    }
    ElMessage.error(String(e?.response?.data?.msg ?? e?.message ?? '加载物料资料失败'))
  }
}

watch(
  () => props.modelValue,
  (open) => {
    if (open) {
      keywordKw.value = ''
      page.value = 1
      rows.value = []
      total.value = 0
    }
  },
)
</script>

<style scoped>
.ms-tip {
  margin: 0 0 10px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
.ms-tip code {
  font-size: 12px;
}
.ms-search {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
}
.ms-keyword-input {
  flex: 1;
  min-width: 220px;
  max-width: 420px;
}
.ms-pager {
  margin-top: 12px;
  display: flex;
  justify-content: flex-end;
}
</style>
