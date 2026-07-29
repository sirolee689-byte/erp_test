<template>
  <div class="database-kernel-page">
    <div class="kernel-toolbar" aria-label="系统内核配置项">
      <el-button
        v-for="item in kernelItems"
        :key="item.label"
        class="kernel-tab"
        :class="{ 'is-active': item.active }"
        :type="item.active ? 'warning' : 'primary'"
        size="small"
        @click="goKernelItem(item)"
      >
        <el-icon><CirclePlus /></el-icon>
        <span>{{ item.label }}</span>
      </el-button>
    </div>

    <section class="database-panel">
      <div class="database-panel__head">
        <h1>数据库配置</h1>
        <el-input
          v-model="keyword"
          class="database-search"
          clearable
          placeholder="搜索数据库名称、用途、备注"
        />
      </div>

      <el-alert
        v-if="loadError"
        class="database-alert"
        type="error"
        :closable="false"
        show-icon
        :title="loadError"
      />

      <el-form
        ref="formRef"
        v-loading="loading"
        class="database-form"
        :model="form"
        :rules="rules"
        label-width="118px"
      >
        <el-table
          class="database-table"
          :data="filteredRows"
          border
          stripe
          row-key="tableName"
          height="540"
          empty-text="暂无数据库配置"
        >
          <el-table-column type="index" label="序号" width="72" align="center" />
          <el-table-column label="数据库名称" prop="tableName" min-width="240">
            <template #default="{ row }">
              <code class="table-name">{{ row.tableName }}</code>
            </template>
          </el-table-column>
          <el-table-column label="用途" min-width="260">
            <template #default="{ row }">
              <el-input v-model="row.purpose" maxlength="500" placeholder="待补充" />
            </template>
          </el-table-column>
          <el-table-column label="备注" min-width="360">
            <template #default="{ row }">
              <el-input
                v-model="row.remark"
                type="textarea"
                :rows="2"
                maxlength="1000"
                placeholder="可填写来源、边界、注意事项"
              />
            </template>
          </el-table-column>
        </el-table>

        <div class="database-note">
          该功能只维护项目数据库表的用途和备注说明，不会修改系统实际读写的业务表名。涉及真实表名迁移时，需要单独按模块改造和验收。
        </div>

        <div class="database-actions">
          <el-form-item label="核心密钥" prop="key" class="database-key">
            <el-input
              v-model="form.key"
              show-password
              clearable
              maxlength="200"
              placeholder="请输入核心密钥"
              @keyup.enter="submitForm"
            />
          </el-form-item>
          <div class="database-buttons">
            <el-button
              v-permission.disable="{ action: 'edit', path: 'system/kernel/erp-core' }"
              type="primary"
              :loading="saving"
              @click="submitForm"
            >
              提交内核
            </el-button>
            <el-button :disabled="saving || loading" @click="resetForm">重置</el-button>
          </div>
        </div>
      </el-form>
    </section>
  </div>
</template>

<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import axios from 'axios'
import { ElMessage } from 'element-plus'
import { CirclePlus } from '@element-plus/icons-vue'

defineOptions({ name: 'system-kernel-database-config' })

const router = useRouter()

const kernelItems = [
  { label: 'BOM编码规则' },
  { label: '系统EMAIL设定', route: '/system/kernel/erp-core' },
  { label: '打印设定', route: '/system/kernel/print-setting' },
  { label: '数据库配置', active: true, route: '/system/kernel/database-config' },
  { label: '数据关联', route: '/system/kernel/data-relations' },
]

const formRef = ref()
const loading = ref(false)
const saving = ref(false)
const loadError = ref('')
const keyword = ref('')
const loadedRows = ref([])
const form = reactive({
  key: '',
  list: [],
})

const rules = {
  key: [{ required: true, message: '核心密钥不能为空', trigger: 'blur' }],
}

const filteredRows = computed(() => {
  const kw = keyword.value.trim().toLowerCase()
  if (!kw) return form.list
  return form.list.filter((row) =>
    [row.tableName, row.purpose, row.remark].some((value) =>
      String(value ?? '').toLowerCase().includes(kw),
    ),
  )
})

function goKernelItem(item) {
  if (!item?.route || item.active) return
  router.push(item.route)
}

function cloneRows(rows) {
  return (Array.isArray(rows) ? rows : []).map((row) => ({
    tableName: String(row?.tableName ?? ''),
    purpose: String(row?.purpose ?? ''),
    remark: String(row?.remark ?? ''),
    source: String(row?.source ?? ''),
    sortOrder: Number(row?.sortOrder ?? 0) || 0,
  }))
}

function assignRows(rows) {
  const next = cloneRows(rows)
  form.list.splice(0, form.list.length, ...next)
  loadedRows.value = cloneRows(next)
  form.key = ''
}

async function loadConfig() {
  loading.value = true
  loadError.value = ''
  try {
    const { data } = await axios.get('/api/system/kernel/database-config')
    if (Number(data?.code) !== 200) throw new Error(data?.msg || '读取数据库配置失败')
    assignRows(data.data?.list)
  } catch (err) {
    const msg = err?.response?.data?.msg || err?.message || '读取数据库配置失败'
    loadError.value = msg
    ElMessage.error(msg)
  } finally {
    loading.value = false
  }
}

function resetForm() {
  assignRows(loadedRows.value)
  formRef.value?.clearValidate?.()
}

async function submitForm() {
  if (saving.value) return
  try {
    await formRef.value?.validate()
  } catch {
    return
  }
  saving.value = true
  try {
    const payload = {
      key: form.key,
      list: form.list.map((row, index) => ({
        tableName: row.tableName,
        purpose: row.purpose,
        remark: row.remark,
        sortOrder: row.sortOrder || index + 1,
      })),
    }
    const { data } = await axios.put('/api/system/kernel/database-config', payload)
    if (Number(data?.code) !== 200) throw new Error(data?.msg || '数据库配置保存失败')
    assignRows(data.data?.list)
    ElMessage.success(data.msg || '数据库配置保存成功')
  } catch (err) {
    const msg = err?.response?.data?.msg || err?.message || '数据库配置保存失败'
    ElMessage.error(msg)
  } finally {
    saving.value = false
  }
}

onMounted(loadConfig)
</script>

<style scoped>
.database-kernel-page {
  min-height: 100%;
  padding: 12px;
  background: #f5f7fa;
}

.kernel-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 12px;
  padding: 2px 0 12px;
}

.kernel-tab {
  margin-left: 0;
  border-radius: 2px;
  font-weight: 600;
}

.kernel-tab :deep(.el-icon) {
  margin-right: 4px;
}

.kernel-tab.is-active {
  border-color: #c96b10;
  background: #d87614;
}

.database-panel {
  max-width: 1240px;
  min-height: 620px;
  padding: 22px 26px 24px;
  background: var(--erp-surface, #fff);
  border: 1px solid var(--el-border-color);
}

.database-panel__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 18px;
  padding-bottom: 18px;
  margin-bottom: 18px;
  border-bottom: 1px solid #ebeef5;
}

.database-panel__head h1 {
  margin: 0;
  font-size: 20px;
  font-weight: 700;
  color: #303133;
}

.database-search {
  width: 320px;
}

.database-alert {
  margin-bottom: 16px;
}

.database-table {
  width: 100%;
}

.table-name {
  color: #1f4f82;
  font-family: Consolas, "Courier New", monospace;
  font-size: 13px;
}

.database-note {
  margin: 16px 0;
  padding: 10px 12px;
  line-height: 1.6;
  color: #8a5a00;
  background: #fff7e6;
  border: 1px solid #f3d19e;
}

.database-actions {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}

.database-key {
  width: 460px;
  margin-bottom: 0;
}

.database-buttons {
  display: flex;
  gap: 12px;
}

@media (max-width: 900px) {
  .database-panel {
    padding: 18px 14px;
  }

  .database-panel__head,
  .database-actions {
    align-items: stretch;
    flex-direction: column;
  }

  .database-search,
  .database-key {
    width: 100%;
  }
}
</style>
