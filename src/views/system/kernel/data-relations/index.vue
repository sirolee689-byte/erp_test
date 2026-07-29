<template>
  <div class="relation-kernel-page">
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

    <section class="relation-panel">
      <div class="relation-panel__head">
        <div>
          <h1>数据关联</h1>
          <p v-if="activeModule">{{ activeModule.name }}业务动作数据流</p>
        </div>
        <el-tag v-if="catalogVersion" type="info" effect="plain">目录版本 {{ catalogVersion }}</el-tag>
      </div>

      <el-alert
        v-if="loadError"
        class="relation-alert"
        type="error"
        :closable="false"
        show-icon
        :title="loadError"
      />

      <nav
        v-if="catalog.modules.length"
        class="module-switcher"
        aria-label="数据关联业务模块"
      >
        <el-button
          v-for="module in catalog.modules"
          :key="module.id"
          class="module-switcher__button"
          :type="activeModuleId === module.id ? 'primary' : ''"
          :plain="activeModuleId !== module.id"
          @click="selectModule(module)"
        >
          {{ module.name }}
        </el-button>
      </nav>

      <div v-loading="loading" class="relation-workspace">
        <main class="flow-main">
          <div class="flow-legend" aria-label="数据流图例">
            <span><i class="legend-dot legend-dot--read"></i>读取</span>
            <span><i class="legend-dot legend-dot--write"></i>新增/更新/替换</span>
            <span><i class="legend-dot legend-dot--conditional"></i>条件性写入</span>
          </div>

          <div class="flow-scroll">
            <div class="flow-diagram">
              <div class="flow-heading">
                <span>读取数据表</span>
                <span></span>
                <span>业务动作</span>
                <span></span>
                <span>写入数据表</span>
              </div>

              <div
                v-for="action in activeModule?.actions || []"
                :key="action.id"
                class="flow-row"
              >
                <div class="table-node-list">
                  <button
                    v-for="table in action.reads"
                    :key="`${action.id}-read-${table.tableName}`"
                    type="button"
                    class="table-node table-node--read"
                    :class="{ 'is-selected': isSelectedTable(table.tableName) }"
                    @click="selectTable(table.tableName)"
                  >
                    <span>{{ table.tableName }}</span>
                    <small>{{ table.purpose }}</small>
                  </button>
                </div>

                <div class="flow-arrow flow-arrow--read" aria-hidden="true">
                  <span></span>
                  <ArrowRight />
                </div>

                <button
                  type="button"
                  class="action-node"
                  :class="{ 'is-selected': isSelectedAction(action.id) }"
                  @click="selectAction(action)"
                >
                  <DataAnalysis />
                  <strong>{{ action.name }}</strong>
                  <small>{{ action.interfaces.map((item) => item.method).join(' / ') }}</small>
                </button>

                <div class="flow-arrow flow-arrow--write" aria-hidden="true">
                  <span></span>
                  <ArrowRight />
                </div>

                <div class="table-node-list">
                  <button
                    v-for="table in action.writes"
                    :key="`${action.id}-write-${table.tableName}`"
                    type="button"
                    class="table-node"
                    :class="[
                      table.conditional ? 'table-node--conditional' : 'table-node--write',
                      { 'is-selected': isSelectedTable(table.tableName) },
                    ]"
                    @click="selectTable(table.tableName)"
                  >
                    <span>{{ table.tableName }}</span>
                    <small>{{ table.operation }}</small>
                  </button>
                </div>
              </div>
            </div>
          </div>
        </main>

        <aside class="relation-detail" aria-live="polite">
          <template v-if="selectedAction">
            <div class="detail-title">
              <DataAnalysis />
              <div>
                <span>业务动作</span>
                <h2>{{ selectedAction.name }}</h2>
              </div>
            </div>

            <dl class="detail-summary">
              <dt>触发位置</dt>
              <dd>{{ selectedAction.trigger }}</dd>
              <dt>业务结果</dt>
              <dd>{{ selectedAction.summary }}</dd>
              <dt>事务结果</dt>
              <dd>{{ selectedAction.transactionResult }}</dd>
            </dl>

            <section class="detail-section">
              <h3>对应接口</h3>
              <div
                v-for="item in selectedAction.interfaces"
                :key="`${item.method}-${item.path}`"
                class="api-line"
              >
                <el-tag size="small" effect="dark">{{ item.method }}</el-tag>
                <code>{{ item.path }}</code>
                <span>{{ item.purpose }}</span>
              </div>
            </section>

            <section class="detail-section">
              <h3>关键条件</h3>
              <ul>
                <li v-for="condition in selectedAction.conditions" :key="condition">
                  {{ condition }}
                </li>
              </ul>
            </section>
          </template>

          <template v-else-if="selectedTableDetail">
            <div class="detail-title detail-title--table">
              <Coin />
              <div>
                <span>数据表</span>
                <h2>{{ selectedTableDetail.tableName }}</h2>
              </div>
            </div>

            <dl class="detail-summary">
              <dt>用途</dt>
              <dd>{{ selectedTableDetail.purpose }}</dd>
              <dt>参与动作</dt>
              <dd>{{ selectedTableDetail.usages.length }} 项</dd>
            </dl>

            <section class="detail-section">
              <h3>业务参与关系</h3>
              <button
                v-for="usage in selectedTableDetail.usages"
                :key="`${usage.action.id}-${usage.direction}-${usage.operation || ''}`"
                type="button"
                class="usage-line"
                @click="selectAction(usage.action)"
              >
                <span
                  class="usage-direction"
                  :class="`usage-direction--${usage.direction}`"
                >
                  {{ usage.direction === 'read' ? '读取' : usage.operation }}
                </span>
                <strong>{{ usage.action.name }}</strong>
                <small>{{ usage.detail }}</small>
              </button>
            </section>
          </template>

          <el-empty v-else description="请选择业务动作或数据表" />
        </aside>
      </div>
    </section>
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import axios from 'axios'
import { ElMessage } from 'element-plus'
import { ArrowRight, CirclePlus, Coin, DataAnalysis } from '@element-plus/icons-vue'

defineOptions({ name: 'system-kernel-data-relations' })

const router = useRouter()

const kernelItems = [
  { label: 'BOM编码规则' },
  { label: '系统EMAIL设定', route: '/system/kernel/erp-core' },
  { label: '打印设定', route: '/system/kernel/print-setting' },
  { label: '数据库配置', route: '/system/kernel/database-config' },
  { label: '数据关联', active: true, route: '/system/kernel/data-relations' },
]

const loading = ref(false)
const loadError = ref('')
const catalog = ref({ version: '', modules: [] })
const activeModuleId = ref('')
const selected = ref({ type: '', id: '' })

const catalogVersion = computed(() => String(catalog.value?.version || ''))
const activeModule = computed(() => (
  catalog.value?.modules?.find((module) => module.id === activeModuleId.value)
  || catalog.value?.modules?.[0]
  || null
))
const selectedAction = computed(() => {
  if (selected.value.type !== 'action') return null
  return activeModule.value?.actions?.find((action) => action.id === selected.value.id) || null
})

const selectedTableDetail = computed(() => {
  if (selected.value.type !== 'table') return null
  const tableName = selected.value.id
  const usages = []
  let purpose = ''

  for (const action of activeModule.value?.actions || []) {
    for (const item of action.reads || []) {
      if (item.tableName !== tableName) continue
      purpose ||= item.purpose
      usages.push({ action, direction: 'read', detail: item.detail })
    }
    for (const item of action.writes || []) {
      if (item.tableName !== tableName) continue
      purpose ||= item.purpose
      usages.push({
        action,
        direction: 'write',
        operation: item.operation,
        conditional: Boolean(item.conditional),
        detail: item.detail,
      })
    }
  }

  return { tableName, purpose: purpose || '待补充', usages }
})

function goKernelItem(item) {
  if (!item?.route || item.active) return
  router.push(item.route)
}

function selectModule(module) {
  if (!module?.id || activeModuleId.value === module.id) return
  activeModuleId.value = module.id
  const firstAction = module.actions?.[0]
  selected.value = firstAction
    ? { type: 'action', id: firstAction.id }
    : { type: '', id: '' }
}

function selectAction(action) {
  selected.value = { type: 'action', id: action.id }
}

function selectTable(tableName) {
  selected.value = { type: 'table', id: tableName }
}

function isSelectedAction(actionId) {
  return selected.value.type === 'action' && selected.value.id === actionId
}

function isSelectedTable(tableName) {
  return selected.value.type === 'table' && selected.value.id === tableName
}

async function loadRelations() {
  loading.value = true
  loadError.value = ''
  try {
    const { data } = await axios.get('/api/system/kernel/data-relations')
    if (Number(data?.code) !== 200) throw new Error(data?.msg || '读取数据关联失败')
    catalog.value = data.data || { version: '', modules: [] }
    const firstModule = catalog.value?.modules?.[0]
    activeModuleId.value = firstModule?.id || ''
    const firstAction = firstModule?.actions?.[0]
    selected.value = firstAction
      ? { type: 'action', id: firstAction.id }
      : { type: '', id: '' }
  } catch (err) {
    const msg = err?.response?.data?.msg || err?.message || '读取数据关联失败'
    loadError.value = msg
    ElMessage.error(msg)
  } finally {
    loading.value = false
  }
}

onMounted(loadRelations)
</script>

<style scoped>
.relation-kernel-page {
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

.relation-panel {
  min-width: 0;
  background: #fff;
  border: 1px solid #dcdfe6;
}

.relation-panel__head {
  min-height: 70px;
  padding: 14px 18px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  border-bottom: 1px solid #e4e7ed;
}

.relation-panel__head h1 {
  margin: 0;
  color: #303133;
  font-size: 20px;
  line-height: 1.4;
  letter-spacing: 0;
}

.relation-panel__head p {
  margin: 4px 0 0;
  color: #606266;
  font-size: 13px;
}

.relation-alert {
  margin: 12px 18px 0;
}

.module-switcher {
  min-height: 54px;
  padding: 10px 18px;
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  background: #f8f9fb;
  border-bottom: 1px solid #e4e7ed;
}

.module-switcher__button {
  min-width: 108px;
  margin-left: 0;
  border-radius: 3px;
  font-weight: 600;
}

.relation-workspace {
  min-height: 620px;
  display: grid;
  grid-template-columns: minmax(0, 1fr) 360px;
}

.flow-main {
  min-width: 0;
  padding: 14px 16px 24px;
}

.flow-legend {
  min-height: 30px;
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px 18px;
  color: #606266;
  font-size: 12px;
}

.flow-legend span {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.legend-dot {
  width: 9px;
  height: 9px;
  border-radius: 50%;
}

.legend-dot--read {
  background: #3b82a0;
}

.legend-dot--write {
  background: #4e8b57;
}

.legend-dot--conditional {
  background: #d47b1c;
}

.flow-scroll {
  overflow-x: auto;
  padding-bottom: 8px;
}

.flow-diagram {
  min-width: 900px;
}

.flow-heading,
.flow-row {
  display: grid;
  grid-template-columns: minmax(245px, 1fr) 46px 176px 46px minmax(245px, 1fr);
  gap: 8px;
}

.flow-heading {
  min-height: 34px;
  align-items: center;
  color: #606266;
  font-size: 13px;
  font-weight: 700;
  text-align: center;
  border-bottom: 1px solid #dcdfe6;
}

.flow-row {
  align-items: center;
  padding: 16px 0;
  border-bottom: 1px solid #ebeef5;
}

.flow-row:last-child {
  border-bottom: 0;
}

.table-node-list {
  display: grid;
  gap: 7px;
  align-content: center;
}

.table-node,
.action-node,
.usage-line {
  font: inherit;
  letter-spacing: 0;
  cursor: pointer;
}

.table-node {
  width: 100%;
  min-height: 49px;
  padding: 7px 10px;
  display: grid;
  gap: 3px;
  text-align: left;
  background: #fff;
  border: 1px solid #aebbc2;
  border-left-width: 4px;
  border-radius: 4px;
  transition: border-color 0.15s ease, background 0.15s ease;
}

.table-node span {
  color: #303133;
  font-family: Consolas, "Courier New", monospace;
  font-size: 12px;
  font-weight: 700;
  overflow-wrap: anywhere;
}

.table-node small {
  color: #606266;
  font-size: 11px;
  line-height: 1.3;
}

.table-node--read {
  border-left-color: #3b82a0;
}

.table-node--write {
  border-left-color: #4e8b57;
}

.table-node--conditional {
  border-left-color: #d47b1c;
}

.table-node:hover,
.table-node.is-selected {
  border-color: #409eff;
  background: #ecf5ff;
}

.flow-arrow {
  display: flex;
  align-items: center;
  color: #909399;
}

.flow-arrow span {
  flex: 1;
  height: 2px;
  background: currentColor;
}

.flow-arrow svg {
  width: 17px;
  height: 17px;
  margin-left: -2px;
}

.flow-arrow--read {
  color: #3b82a0;
}

.flow-arrow--write {
  color: #4e8b57;
}

.action-node {
  width: 176px;
  min-height: 92px;
  padding: 12px 9px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  color: #fff;
  background: #34495e;
  border: 2px solid #34495e;
  border-radius: 6px;
}

.action-node svg {
  width: 22px;
  height: 22px;
}

.action-node strong {
  font-size: 14px;
  line-height: 1.35;
}

.action-node small {
  color: #dce5eb;
  font-size: 11px;
}

.action-node:hover,
.action-node.is-selected {
  background: #1f6690;
  border-color: #79bbff;
  box-shadow: 0 0 0 2px rgb(64 158 255 / 16%);
}

.relation-detail {
  min-width: 0;
  padding: 18px;
  background: #fafafa;
  border-left: 1px solid #dcdfe6;
}

.detail-title {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding-bottom: 14px;
  border-bottom: 2px solid #34495e;
}

.detail-title > svg {
  width: 25px;
  height: 25px;
  color: #34495e;
  flex: 0 0 auto;
}

.detail-title span {
  color: #909399;
  font-size: 12px;
}

.detail-title h2 {
  margin: 3px 0 0;
  color: #303133;
  font-size: 17px;
  line-height: 1.4;
  letter-spacing: 0;
  overflow-wrap: anywhere;
}

.detail-title--table {
  border-bottom-color: #3b82a0;
}

.detail-title--table > svg {
  color: #3b82a0;
}

.detail-summary {
  margin: 16px 0 0;
  display: grid;
  grid-template-columns: 70px minmax(0, 1fr);
  gap: 10px 8px;
  font-size: 13px;
  line-height: 1.55;
}

.detail-summary dt {
  color: #909399;
  font-weight: 700;
}

.detail-summary dd {
  margin: 0;
  color: #303133;
  overflow-wrap: anywhere;
}

.detail-section {
  margin-top: 20px;
}

.detail-section h3 {
  margin: 0 0 10px;
  color: #303133;
  font-size: 14px;
  letter-spacing: 0;
}

.detail-section ul {
  margin: 0;
  padding-left: 19px;
  color: #303133;
  font-size: 13px;
  line-height: 1.65;
}

.api-line {
  padding: 8px 0;
  display: grid;
  grid-template-columns: 48px minmax(0, 1fr);
  gap: 4px 8px;
  border-bottom: 1px solid #e4e7ed;
}

.api-line code {
  color: #303133;
  font-size: 12px;
  overflow-wrap: anywhere;
}

.api-line > span:last-child {
  grid-column: 2;
  color: #606266;
  font-size: 12px;
}

.usage-line {
  width: 100%;
  padding: 9px 0;
  display: grid;
  grid-template-columns: 86px minmax(0, 1fr);
  gap: 3px 8px;
  color: #303133;
  text-align: left;
  background: transparent;
  border: 0;
  border-bottom: 1px solid #e4e7ed;
}

.usage-line:hover {
  background: #ecf5ff;
}

.usage-direction {
  grid-row: 1 / span 2;
  align-self: start;
  padding: 3px 5px;
  color: #fff;
  font-size: 11px;
  text-align: center;
  background: #4e8b57;
  border-radius: 3px;
}

.usage-direction--read {
  background: #3b82a0;
}

.usage-line strong {
  font-size: 13px;
}

.usage-line small {
  color: #606266;
  font-size: 11px;
  line-height: 1.45;
}

@media (max-width: 1180px) {
  .relation-workspace {
    grid-template-columns: minmax(0, 1fr);
  }

  .relation-detail {
    border-top: 1px solid #dcdfe6;
    border-left: 0;
  }
}

@media (max-width: 640px) {
  .relation-kernel-page {
    padding: 8px;
  }

  .relation-panel__head {
    align-items: flex-start;
  }

  .flow-main,
  .relation-detail {
    padding: 12px;
  }
}
</style>
