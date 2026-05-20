<template>
  <div class="erp-module-page">
    <el-card shadow="never" class="block-card">
      <template #header>
        <span class="page-title">纸格资料导入</span>
      </template>
      <p class="page-desc">
        流程：选择 Excel → 上传并解析 → 按 Excel <strong>第 4 行 N 列起横向</strong>识别多款颜色，每色一块「基础资料确认区」→
        <strong>Material 列表</strong> → <strong>智能校验</strong>（通过后方可正式导入）→ CUT 预览可下拉切换颜色。
        <strong>正式导入</strong>按解析出的<strong>全部颜色</strong>同步写入（单事务）。客款号默认 L2；组别优先 M2。
      </p>

      <el-divider content-position="left">模板下载</el-divider>
      <div class="section">
        <el-button type="primary" @click="downloadTemplate">下载纸格模板</el-button>
        <span class="hint">模板路径：/template/paper-pattern-template.xlsx（由管理员维护内容）</span>
      </div>

      <el-divider content-position="left">Excel 上传</el-divider>
      <div class="section">
        <input
          ref="fileInputRef"
          type="file"
          class="hidden-file"
          accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
          @change="onFileChange"
        />
        <el-button type="primary" plain @click="triggerPickFile">选择 Excel 文件</el-button>
        <span v-if="pickedLabel" class="picked-name">{{ pickedLabel }}</span>
        <span v-else class="picked-placeholder">未选择文件</span>
        <el-button
          type="primary"
          :disabled="!pickedFile"
          :loading="uploading || parseTreeLoading"
          @click="onUploadParse"
        >
          上传并解析
        </el-button>
      </div>

      <el-alert v-if="errorMessage" class="err" :title="errorMessage" type="error" show-icon />
      <el-alert
        v-if="commitRestoreNotice"
        class="commit-restore-notice"
        :title="commitRestoreNotice"
        type="info"
        show-icon
        closable
        @close="commitRestoreNotice = ''"
      />

      <template v-if="parseResult">
        <el-alert
          v-if="parseResult.warnings?.length"
          type="warning"
          show-icon
          class="warn-block"
          title="解析提示"
        >
          <ul class="warn-list">
            <li v-for="(w, i) in parseResult.warnings" :key="i">{{ w }}</li>
          </ul>
        </el-alert>

        <div class="confirm-toolbar">
          <el-button
            type="primary"
            :disabled="!canFormalImport"
            :loading="commitLoading"
            :title="formalImportDisabledTitle"
            @click="onCommitBom000"
          >
            正式导入
          </el-button>
          <el-button type="success" plain @click="goSmartCheck">智能校验</el-button>
          <el-tag v-if="smartCheckPassed" type="success" size="small" effect="plain">智能校验已通过</el-tag>
          <el-tag v-else type="info" size="small" effect="plain">请先完成智能校验</el-tag>
          <el-button plain @click="hideBasicConfirmArea = !hideBasicConfirmArea">
            {{ hideBasicConfirmArea ? '显示各款颜色资料' : '隐藏各款颜色资料' }}
          </el-button>
          <el-button plain @click="hideMaterialTable = !hideMaterialTable">
            {{ hideMaterialTable ? '显示物料信息' : '隐藏物料信息' }}
          </el-button>
          <el-button plain @click="hideCutPreviewTable = !hideCutPreviewTable">
            {{ hideCutPreviewTable ? '显示 CUT 预览' : '隐藏 CUT 预览' }}
          </el-button>
        </div>

        <el-divider content-position="left">基础资料确认区</el-divider>
        <el-row :gutter="16" class="global-import-type-row">
          <el-col :xs="24" :sm="12" :md="8" :lg="6">
            <div class="form-field">
              <div class="form-label">导入类型（全部颜色共用）</div>
              <el-select
                v-model="sharedImportTypeFlag5"
                placeholder="请选择"
                filterable
                clearable
                class="field-control"
                :loading="importTypesLoading"
              >
                <el-option
                  v-for="it in importTypeOptions"
                  :key="it.id"
                  :label="formatImportTypeLabel(it)"
                  :value="it.flag5"
                />
              </el-select>
            </div>
          </el-col>
        </el-row>
        <div v-if="importTypesError" class="hint err-inline global-import-type-err">{{ importTypesError }}</div>

        <div v-show="!hideBasicConfirmArea">
          <p class="confirm-desc">
            颜色编码自 Excel <strong>第 4 行 N 列</strong>起向右识别（如 N4、O4）。顶部导入类型修改后同步到全部颜色；各款可分别改厂款号、颜色编码等。
            CUT 预览用下拉切换颜色。正式导入将写入<strong>全部</strong>已识别颜色。
          </p>
          <div
            v-for="(block, blockIdx) in basicFormList"
            :key="`color-block-${blockIdx}-${block.colorNo}`"
            class="color-confirm-block"
          >
            <el-divider v-if="blockIdx > 0" />
            <h4 class="color-block-title">
              第 {{ blockIdx + 1 }} 款颜色
              <span v-if="block.colorNo" class="color-block-tag">{{ block.colorNo }}</span>
            </h4>
            <el-row :gutter="16" class="confirm-grid">
              <el-col :xs="24" :sm="12" :md="8" :lg="6">
                <div class="form-field">
                  <div class="form-label">厂款号</div>
                  <el-input
                    v-model="block.factoryStyleNo"
                    clearable
                    class="field-control"
                    placeholder="如 PQ-2803H1（模板 N2）"
                  />
                </div>
              </el-col>
              <el-col :xs="24" :sm="12" :md="8" :lg="6">
                <div class="form-field">
                  <div class="form-label">组别</div>
                  <el-input
                    v-model="block.groupLabel"
                    clearable
                    class="field-control"
                    placeholder="优先 M2，否则「组别」右侧"
                  />
                </div>
              </el-col>
              <el-col :xs="24" :sm="12" :md="8" :lg="6">
                <div class="form-field">
                  <div class="form-label">客款号</div>
                  <el-input
                    v-model="block.customerStyleNo"
                    clearable
                    class="field-control"
                    placeholder="默认 L2，如 -BV2960B2A"
                  />
                </div>
              </el-col>
              <el-col :xs="24" :sm="12" :md="8" :lg="6">
                <div class="form-field">
                  <div class="form-label">颜色编码</div>
                  <el-input v-model="block.colorNo" clearable class="field-control" placeholder="如 G-TEST" />
                </div>
              </el-col>
              <el-col :xs="24" :sm="12" :md="16" :lg="12">
                <div class="form-field">
                  <div class="form-label">样品名称（仅资料确认，不写入 Bom_000）</div>
                  <el-input
                    v-model="block.sampleName"
                    clearable
                    class="field-control"
                    placeholder="默认取 Excel「样品名称」；正式导入时主 BOM 的 kcaa02 为导入类型名称（Bom_code.flag1）"
                  />
                </div>
              </el-col>
            </el-row>
            <p class="norm-hint block-norm-hint">
              编码用厂款号：<code>{{ styleNoNormalizedForBlock(block) || '—' }}</code>
              · 主 BOM：<code>{{ mainBomCodeForBlock(block) || '（请补全导入类型、厂款号、颜色编码）' }}</code>
            </p>
          </div>
        </div>

        <el-alert type="error" show-icon :closable="false" class="danger-zone">
          <template #title>测试：物理清理纸格导入数据（安全范围）</template>
          <div class="danger-zone-body">
            <p>
              仅删除<strong>精确指定</strong>的主 BOM 颜色，<strong>不会</strong>按款号
              <code>BAG-厂款号/%</code> 整款删除，避免误删库内其它颜色（如历史 b-TEST、red-TEST）。
              删除范围：该色主 BOM、该色全部 CUT、关联 <strong>Bom_parts</strong> 与 <strong>Bom_000</strong>。不涉及
              bom_cost。
            </p>
            <div class="danger-row">
              <el-input
                v-model="deleteSystemcodeInput"
                clearable
                class="danger-input"
                placeholder="bom_000.systemcode 或 Bom_parts.kcac01"
              />
              <el-button
                type="danger"
                plain
                :disabled="deleteBomTreeLoading || !String(deleteSystemcodeInput || '').trim()"
                :loading="deleteBomTreeLoading"
                @click="onDeleteBomTreeBySystemcode"
              >
                删除该 systemcode 对应的一色
              </el-button>
            </div>
            <div class="danger-row danger-row-second">
              <el-button
                type="danger"
                plain
                :disabled="deleteBomTreeLoading || !parsedMainBomCodesForDelete.length"
                :loading="deleteBomTreeLoading"
                @click="onDeleteParsedColorBomTrees"
              >
                删除本次解析的全部主 BOM（{{ parsedMainBomCodesForDelete.length }} 色）
              </el-button>
              <span v-if="parsedMainBomCodesForDelete.length" class="danger-hint-list">
                {{ parsedMainBomCodesForDelete.join('、') }}
              </span>
            </div>
          </div>
        </el-alert>

        <div class="material-top-block">
          <h3 class="sub-title material-top-title">Material 列表</h3>
          <div v-show="!hideMaterialTable">
            <p class="hint material-top-hint">材料单位与损耗来自 Bom_000；ERP 是否可导入请在顶部「智能校验」中确认。</p>
            <p v-if="materialBomFieldsLoading" class="hint">正在加载材料单位与默认损耗（Bom_000）…</p>
            <el-table :data="materialPreviewRows" border size="small" class="preview-table" empty-text="无">
              <el-table-column prop="groupNo" label="分组" width="88" />
              <el-table-column prop="materialName" label="Material 名称" min-width="140" show-overflow-tooltip />
              <el-table-column prop="materialCode" label="ERP 编码" min-width="180" show-overflow-tooltip />
              <el-table-column prop="materialUnit" label="材料单位" width="100" />
              <el-table-column label="损耗比例" min-width="140">
                <template #default="{ row }">
                  <template v-if="row.wastageEditable">
                    <el-input-number
                      :model-value="row.wastageFraction"
                      :min="0"
                      :max="1"
                      :precision="4"
                      :step="0.0001"
                      size="small"
                      controls-position="right"
                      class="wastage-input"
                      @update:model-value="(v) => onMaterialWastageFractionInput(row.rowIndex, v)"
                    />
                  </template>
                  <span v-else>{{ row.wastageReadonlyText }}</span>
                </template>
              </el-table-column>
              <el-table-column prop="remarkDisplay" label="备注" min-width="160" show-overflow-tooltip />
            </el-table>
          </div>
        </div>

        <el-divider content-position="left">编码预览（实时）</el-divider>
        <div class="code-preview-block">
          <div v-if="basicFormList.length > 1" class="cut-preview-color-row">
            <span class="k">CUT 预览颜色</span>
            <el-select v-model="cutPreviewColorNo" class="cut-preview-color-select" filterable>
              <el-option
                v-for="b in basicFormList"
                :key="b.colorNo || 'empty'"
                :label="b.colorNo || '（未填）'"
                :value="b.colorNo"
              />
            </el-select>
          </div>
          <div class="main-bom-line">
            <span class="k">主 BOM 编码</span>
            <span class="v">{{ liveMainBomCodeForCutPreview || '（请补全导入类型、厂款号、颜色编码）' }}</span>
          </div>
          <div v-show="!hideCutPreviewTable">
            <h4 class="sub-title sm">CUT 预览</h4>
            <el-table :data="liveCutsPreview" border size="small" class="preview-table cut-preview-table" empty-text="无 CUT 行">
              <el-table-column prop="cutCode" label="CUT 编码" min-width="280" fixed="left" />
              <el-table-column prop="cutNameDisplay" label="裁片名称" min-width="120" />
              <el-table-column prop="lengthDisplay" label="长" min-width="88" align="right" />
              <el-table-column prop="widthDisplay" label="宽" min-width="88" align="right" />
              <el-table-column prop="quantityDisplay" label="数量" min-width="88" align="right" />
              <el-table-column prop="fabricWidthDisplay" label="宽幅" min-width="88" align="right" />
              <el-table-column prop="unitConsumptionDisplay" label="单位用量" min-width="100" align="right" />
              <el-table-column prop="wastageDisplay" label="损耗" min-width="88" align="right" />
              <el-table-column prop="actualConsumptionDisplay" label="实际用量" min-width="100" align="right" />
              <el-table-column prop="unitPriceDisplay" label="单价" min-width="96" align="right" />
              <el-table-column prop="totalAmountDisplay" label="总价" min-width="96" align="right" />
              <el-table-column prop="matchingDisplay" label="搭配" min-width="100" />
              <el-table-column prop="unitDisplay" label="单位" min-width="72" />
            </el-table>
          </div>
        </div>

        <h3 class="sub-title">Accessory 列表</h3>
        <el-table :data="parseResult.accessories" border size="small" class="preview-table" empty-text="无">
          <el-table-column prop="seqNo" label="序号" width="72" align="center" />
          <el-table-column prop="colorNo" label="颜色" width="100" show-overflow-tooltip />
          <el-table-column prop="accessoryName" label="名称" min-width="140" show-overflow-tooltip />
          <el-table-column prop="erpCode" label="ERP 编码" min-width="220" show-overflow-tooltip />
          <el-table-column prop="usageQty" label="用量" min-width="100" align="right" />
          <el-table-column prop="wastage" label="损耗" min-width="100" align="right" />
          <el-table-column prop="lineTotal" label="合计" min-width="100" align="right" />
          <el-table-column prop="matching" label="搭配" min-width="120" show-overflow-tooltip />
        </el-table>
      </template>
    </el-card>
  </div>
</template>

<script setup>
// 与 router name `paper-pattern-import` 一致，供布局 keep-alive 缓存
defineOptions({ name: 'paper-pattern-import' })

import { computed, nextTick, onActivated, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import axios from 'axios'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  buildCutCode,
  buildMainBomCode,
  normalizeFactoryStyleForEncoding,
} from '@/utils/paperPatternImportCodes.js'
import {
  formatPaperPatternCutNumericDisplay,
  formatPaperPatternCutTextDisplay,
} from '@/utils/paperPatternCutDisplayFormat.js'
import { erpCodeLookupKey, normalizeErpCodeDisplay } from '@/utils/paperPatternErpCodeNormalize.js'
import { canEditPaperPatternMaterialWastage } from '@/utils/paperPatternMaterialWastagePolicy.js'
import { formatFractionAsDecimalText } from '@/utils/paperPatternMaterialWastageInput.js'
import {
  applyWorkbenchEditsToParseResult,
  applyWorkbenchPayloadToParseResult,
  buildSmartCheckFingerprint,
  clearImportPageSession,
  clearSmartCheckPass,
  cloneParseResultForSessionSnapshot,
  isSmartCheckPassForImportPage,
  isSmartCheckPassValid,
  readImportPageSession,
  readWorkbenchPayload,
  saveImportPageSession,
  saveWorkbenchPayload,
} from '@/utils/paperPatternSmartCheck.js'
import { decodePaperPatternUploadFileName } from '@/utils/paperPatternUploadFileName.js'

const route = useRoute()
const router = useRouter()
const templateHref = '/template/paper-pattern-template.xlsx'

function downloadTemplate() {
  const a = document.createElement('a')
  a.href = templateHref
  a.download = 'paper-pattern-template.xlsx'
  a.rel = 'noopener'
  a.click()
}

const fileInputRef = ref(null)
const pickedFile = ref(null)
const pickedLabel = ref('')
const uploading = ref(false)
const errorMessage = ref('')
/** @type {import('vue').Ref<Array<{ id: number, flag1: string, flag5: string }>>} */
const importTypeOptions = ref([])
const importTypesLoading = ref(false)
const importTypesError = ref('')

/** 基础资料确认块（每色一块） */
/** @type {import('vue').Ref<Array<{ importTypeFlag5: string, factoryStyleNo: string, groupLabel: string, customerStyleNo: string, colorNo: string, sampleName: string }>>} */
const basicFormList = ref([])
/** 全部颜色共用的导入类型 */
const sharedImportTypeFlag5 = ref('')
/** CUT 预览所用颜色（下拉，默认第一款） */
const cutPreviewColorNo = ref('')

/** 已落盘 Excel 的 fileId（与 route.query.fileId 同步，供 parse-tree 恢复） */
const parseFileId = ref('')
const parseTreeLoading = ref(false)

/** @type {import('vue').Ref<null | { mainBom: object, cuts: any[], materials: any[], accessories: any[], warnings: string[] }>} */
const parseResult = ref(null)
/** 折叠：隐藏各款颜色资料块 */
const hideBasicConfirmArea = ref(false)
/** 折叠：仅隐藏 Material 表格区域 */
const hideMaterialTable = ref(false)
/** 折叠：仅隐藏 CUT 预览表格 */
const hideCutPreviewTable = ref(false)
const commitLoading = ref(false)
/** 从 session 恢复且曾跳过 parse-tree 时的提示（如正式导入进行中） */
const commitRestoreNotice = ref('')
/** 测试：按 systemcode / 解析色列表物理删除 */
const deleteSystemcodeInput = ref('')
const deleteBomTreeLoading = ref(false)

const parsedMainBomCodesForDelete = computed(() => {
  return basicFormList.value.map((b) => mainBomCodeForBlock(b)).filter(Boolean)
})

function formatDeleteBomTreeSuccessMessage(d) {
  const nColor = Array.isArray(d?.mainKcaa01s) ? d.mainKcaa01s.length : d?.mainKcaa01 ? 1 : 0
  const mains =
    Array.isArray(d?.mainKcaa01s) && d.mainKcaa01s.length
      ? d.mainKcaa01s.join('、')
      : String(d?.mainKcaa01 ?? '')
  const cutHint = d?.cutKcaa01Like ? `（CUT 匹配示例：${d.cutKcaa01Like}）` : ''
  return `已删除 ${nColor} 色：${mains}；Bom_parts ${d?.bomPartsDeleted ?? 0} 行，Bom_000 ${d?.bom000Deleted ?? 0} 行${cutHint}`
}

async function onDeleteBomTreeBySystemcode() {
  const code = String(deleteSystemcodeInput.value ?? '').trim()
  if (!code) {
    ElMessage.warning('请填写 systemcode 或 Bom_parts.kcac01')
    return
  }
  try {
    await ElMessageBox.confirm(
      `将根据 systemcode 解析出对应「一个」主 BOM 颜色并物理删除（不含同厂款其它颜色）。\n编码：${code}\n是否继续？`,
      '危险操作',
      { type: 'error', confirmButtonText: '确定删除', cancelButtonText: '取消' },
    )
  } catch {
    return
  }
  deleteBomTreeLoading.value = true
  try {
    const res = await axios.post('/api/paper-pattern/import/delete-bom-tree', { systemcode: code })
    const data = res?.data
    if (!data?.success) {
      ElMessage.error(String(data?.message || '删除失败'))
      return
    }
    ElMessage.success(formatDeleteBomTreeSuccessMessage(data.data || {}))
  } catch (e) {
    const msg = e?.response?.data?.message || e?.message || '删除失败'
    ElMessage.error(String(msg))
  } finally {
    deleteBomTreeLoading.value = false
  }
}

async function onDeleteParsedColorBomTrees() {
  const mains = parsedMainBomCodesForDelete.value
  if (!mains.length) {
    ElMessage.warning('请先完成解析并补全各颜色主 BOM 编码')
    return
  }
  try {
    await ElMessageBox.confirm(
      `将仅删除以下 ${mains.length} 个主 BOM 及其 CUT、Bom_parts（不会删除未列出的其它颜色）：\n${mains.join('\n')}\n是否继续？`,
      '危险操作',
      { type: 'error', confirmButtonText: '确定删除', cancelButtonText: '取消' },
    )
  } catch {
    return
  }
  deleteBomTreeLoading.value = true
  try {
    const res = await axios.post('/api/paper-pattern/import/delete-bom-tree', { mainKcaa01s: mains })
    const data = res?.data
    if (!data?.success) {
      ElMessage.error(String(data?.message || '删除失败'))
      return
    }
    ElMessage.success(formatDeleteBomTreeSuccessMessage(data.data || {}))
  } catch (e) {
    const msg = e?.response?.data?.message || e?.message || '删除失败'
    ElMessage.error(String(msg))
  } finally {
    deleteBomTreeLoading.value = false
  }
}

function formatImportTypeLabel(it) {
  const f1 = String(it?.flag1 ?? '').trim()
  const f5 = String(it?.flag5 ?? '').trim()
  if (f1 && f5) return `${f1}(${f5})`
  return f5 || f1 || '—'
}

async function loadImportTypes() {
  importTypesError.value = ''
  importTypesLoading.value = true
  try {
    const res = await axios.get('/api/paper-pattern/import-types')
    const data = res?.data
    if (!data?.success) {
      importTypesError.value = String(data?.message || '加载导入类型失败')
      importTypeOptions.value = []
      return
    }
    importTypeOptions.value = Array.isArray(data.items) ? data.items : []
  } catch (e) {
    importTypesError.value = String(
      e?.response?.data?.message || e?.response?.data?.msg || e?.message || '加载导入类型失败',
    )
    importTypeOptions.value = []
  } finally {
    importTypesLoading.value = false
  }
}

function createBasicFormBlockFromShared(shared, colorNo) {
  return {
    importTypeFlag5: String(shared.importTypeFlag5 ?? '').trim(),
    factoryStyleNo: String(shared.factoryStyleNo ?? '').trim(),
    groupLabel: String(shared.groupLabel ?? '').trim(),
    customerStyleNo: String(shared.customerStyleNo ?? '').trim(),
    colorNo: String(colorNo ?? '').trim(),
    sampleName: String(shared.sampleName ?? '').trim(),
  }
}

function syncImportTypeFlag5ToAllBlocks(flag5) {
  const v = String(flag5 ?? '').trim()
  for (const block of basicFormList.value) {
    block.importTypeFlag5 = v
  }
}

watch(sharedImportTypeFlag5, (v) => {
  syncImportTypeFlag5ToAllBlocks(v)
})

/** 从解析结果填充多块确认区 */
function hydrateBasicFormListFromParseMain(main) {
  const m = main || {}
  const raw = String(m.styleNoRaw ?? '').trim()
  const sn = String(m.styleNo ?? m.styleNoNormalized ?? '').trim()
  const shared = {
    importTypeFlag5: String(m.importTypeFlag5 ?? '').trim(),
    factoryStyleNo: raw || sn,
    groupLabel: String(m.groupLabel ?? '').trim(),
    customerStyleNo: String(m.customerStyleNo ?? '').trim(),
    sampleName: String(m.sampleName ?? '').trim(),
  }
  sharedImportTypeFlag5.value = shared.importTypeFlag5
  const fromApi = Array.isArray(m.colorNos) ? m.colorNos.map((c) => String(c ?? '').trim()).filter(Boolean) : []
  const colorNos = fromApi.length > 0 ? fromApi : m.colorNo ? [String(m.colorNo).trim()] : []
  if (colorNos.length === 0) {
    basicFormList.value = [createBasicFormBlockFromShared(shared, '')]
    cutPreviewColorNo.value = ''
    return
  }
  basicFormList.value = colorNos.map((col) => createBasicFormBlockFromShared(shared, col))
  cutPreviewColorNo.value = colorNos[0]
}

function styleNoNormalizedForBlock(block) {
  return normalizeFactoryStyleForEncoding(block?.factoryStyleNo ?? '')
}

function mainBomCodeForBlock(block) {
  return buildMainBomCode({
    importTypeFlag5: block?.importTypeFlag5 ?? '',
    styleNo: styleNoNormalizedForBlock(block),
    colorNo: block?.colorNo ?? '',
  })
}

const commitBasicForm = computed(() => basicFormList.value[0] ?? null)

const allBlocksReadyForCommit = computed(() => {
  const list = basicFormList.value
  if (!list.length) return false
  return list.every((b) => Boolean(mainBomCodeForBlock(b)))
})

const smartCheckColorNos = computed(() => {
  const m = parseResult.value?.mainBom
  const fromApi = Array.isArray(m?.colorNos) ? m.colorNos.map((c) => String(c ?? '').trim()).filter(Boolean) : []
  if (fromApi.length > 0) return fromApi
  return basicFormList.value.map((b) => String(b?.colorNo ?? '').trim()).filter(Boolean)
})

const smartCheckFingerprint = computed(() => {
  if (!parseResult.value) return ''
  return buildSmartCheckFingerprint(
    parseResult.value.materials || [],
    parseResult.value.accessories || [],
    smartCheckColorNos.value,
  )
})

const smartCheckPassed = computed(() => {
  if (!parseResult.value) return false
  const fid = String(parseFileId.value ?? '').trim()
  const fp = smartCheckFingerprint.value
  if (isSmartCheckPassValid(fp, fid)) return true
  const payload = readWorkbenchPayload()
  if (!payload) return false
  const colorNos =
    Array.isArray(payload.colorNos) && payload.colorNos.length > 0
      ? payload.colorNos
      : smartCheckColorNos.value
  const payloadFp = buildSmartCheckFingerprint(payload.materials, payload.accessories, colorNos)
  return isSmartCheckPassValid(payloadFp, fid)
})

const canFormalImport = computed(
  () =>
    !!parseResult.value &&
    allBlocksReadyForCommit.value &&
    smartCheckPassed.value &&
    !commitLoading.value,
)

const formalImportDisabledTitle = computed(() => {
  if (!parseResult.value) return '请先上传并解析 Excel'
  if (!allBlocksReadyForCommit.value) return '请补全各颜色导入类型、厂款号、颜色编码'
  if (!smartCheckPassed.value) return '请先完成智能校验（Material 分色全码与 Accessory 全码须在 Bom_000 存在）'
  return ''
})

const liveMainBomCodeForCommit = computed(() => {
  if (!allBlocksReadyForCommit.value) return ''
  const list = basicFormList.value
  if (list.length === 1) return mainBomCodeForBlock(list[0])
  return `${mainBomCodeForBlock(list[0])} 等 ${list.length} 色`
})

const cutPreviewBasicForm = computed(() => {
  const list = basicFormList.value
  if (!list.length) return null
  const key = String(cutPreviewColorNo.value ?? '').trim()
  if (key) {
    const hit = list.find((b) => String(b.colorNo ?? '').trim() === key)
    if (hit) return hit
  }
  return list[0]
})

const liveMainBomCodeForCutPreview = computed(() => {
  const block = cutPreviewBasicForm.value
  return block ? mainBomCodeForBlock(block) : ''
})

const liveCutsPreview = computed(() => {
  const cuts = parseResult.value?.cuts
  if (!Array.isArray(cuts)) return []
  const block = cutPreviewBasicForm.value
  if (!block) return []
  const flag5 = block.importTypeFlag5
  const sn = styleNoNormalizedForBlock(block)
  const col = block.colorNo
  return cuts.map((c) => ({
    cutSeq: c.cutSeq,
    cutNameDisplay: formatPaperPatternCutTextDisplay(c.cutName),
    cutCode: buildCutCode({
      importTypeFlag5: flag5,
      styleNo: sn,
      colorNo: col,
      cutSeq: c.cutSeq,
    }),
    lengthDisplay: formatPaperPatternCutTextDisplay(c.length),
    widthDisplay: formatPaperPatternCutTextDisplay(c.width),
    quantityDisplay: formatPaperPatternCutNumericDisplay(c.quantity),
    fabricWidthDisplay: formatPaperPatternCutNumericDisplay(c.fabricWidth),
    unitConsumptionDisplay: formatPaperPatternCutTextDisplay(c.unitConsumption),
    wastageDisplay: formatPaperPatternCutNumericDisplay(c.wastage),
    actualConsumptionDisplay: formatPaperPatternCutNumericDisplay(c.actualConsumption),
    unitPriceDisplay: formatPaperPatternCutNumericDisplay(c.unitPrice),
    totalAmountDisplay: formatPaperPatternCutNumericDisplay(c.totalAmount),
    matchingDisplay: formatPaperPatternCutTextDisplay(c.matching),
    // CUT 裁片属纸格 BOM，单位与旧系统一致统一为「张」；预览阶段不展示 Excel 单位列
    unitDisplay: '张',
  }))
})

/** Bom_000：按 ERP 编码拉取 kcaa04 / kcaa33（仅预览） */
const materialBomFieldByKey = ref(
  /** @type {Record<string, { kcaa04?: string, kcaa33?: number | null }>} */ ({}),
)
const materialBomFieldsLoading = ref(false)
/** Material 预览行（含可编辑损耗小数，与 kcaa33 一致，不写库） */
const materialPreviewRows = ref([])

function rebuildMaterialPreviewRows() {
  const mats = parseResult.value?.materials
  if (!Array.isArray(mats) || mats.length === 0) {
    materialPreviewRows.value = []
    return
  }
  const byKey = materialBomFieldByKey.value || {}
  materialPreviewRows.value = mats.map((m, idx) => {
    const display = normalizeErpCodeDisplay(m?.materialCode ?? '')
    const key = erpCodeLookupKey(display)
    const fld = key && byKey[key] ? byKey[key] : null
    const exists = !!(key && fld)
    const unit = exists ? String(fld.kcaa04 ?? '').trim() : ''
    const dbFrac =
      fld && fld.kcaa33 !== null && fld.kcaa33 !== undefined && Number.isFinite(Number(fld.kcaa33))
        ? Number(fld.kcaa33)
        : null
    const wastageEditable = canEditPaperPatternMaterialWastage(display)
    const remarkRaw = String(m.remark ?? '').trim()
    const remarkDisplay = remarkRaw ? remarkRaw : '*'
    const wastageReadonlyText =
      dbFrac === null || dbFrac === undefined || Number.isNaN(Number(dbFrac))
        ? ''
        : formatFractionAsDecimalText(dbFrac)
    return {
      rowIndex: idx,
      groupNo: m.groupNo,
      materialName: m.materialName,
      materialCode: m?.materialCode ?? '',
      materialUnit: unit,
      remarkDisplay,
      wastageEditable,
      /** 损耗小数（如 0.06），与 Bom_000.kcaa33 一致 */
      wastageFraction: dbFrac,
      dbWastageFraction: dbFrac,
      wastageReadonlyText,
    }
  })
}

/**
 * @param {number} rowIndex
 * @param {number | null | undefined} v el-input-number（小数，如 0.06）
 */
function onMaterialWastageFractionInput(rowIndex, v) {
  const row = materialPreviewRows.value[rowIndex]
  if (!row?.wastageEditable) return
  if (v === undefined || v === null || v === '') {
    row.wastageFraction = null
    return
  }
  const n = Number(v)
  row.wastageFraction = Number.isFinite(n) ? n : null
}

/** 防止快速连续上传时旧请求覆盖新数据 */
let materialBomFetchSeq = 0

async function loadMaterialBomFieldsForPreview() {
  const mats = parseResult.value?.materials
  if (!Array.isArray(mats) || mats.length === 0) {
    materialBomFieldByKey.value = {}
    materialPreviewRows.value = []
    return
  }

  const seq = ++materialBomFetchSeq
  materialBomFieldsLoading.value = true
  // 先按当前 byKey 渲染表格（含 ERP 列），避免等待接口期间整表空白
  rebuildMaterialPreviewRows()
  try {
    const seen = new Set()
    const codeList = []
    for (const m of mats) {
      const d = normalizeErpCodeDisplay(m?.materialCode ?? '')
      const k = erpCodeLookupKey(d)
      if (!k || seen.has(k)) continue
      seen.add(k)
      codeList.push(d)
    }
    if (codeList.length === 0) {
      materialBomFieldByKey.value = {}
      return
    }

    const res = await axios.post('/api/paper-pattern/material-bom-fields', { codes: codeList })
    if (seq !== materialBomFetchSeq) return

    const data = res?.data
    const rawByKey = data?.success && data.byKey && typeof data.byKey === 'object' ? data.byKey : {}
    materialBomFieldByKey.value = { ...rawByKey }
    // 立即按新 byKey 重算预览行，避免仅依赖 finally 时序导致表格短暂空白
    rebuildMaterialPreviewRows()

    if (data?.success === false) {
      const m = String(data?.message || '接口返回失败')
      ElMessage.warning(`材料主档字段：${m}`)
    } else if (codeList.length > 0 && Object.keys(rawByKey).length === 0) {
      ElMessage.warning(
        'Bom_000 未命中任何 ERP 编码（材料单位/损耗为空）。请在后端控制台查看 [paper-pattern-material-bom-fields] 库命中= 与请求示例编码是否一致。',
      )
    }

    if (import.meta.env.DEV && Array.isArray(data?.items)) {
      console.info('[material-bom-fields] 回填命中', data.items.length, data.items)
    }
  } catch (e) {
    if (seq !== materialBomFetchSeq) return
    materialBomFieldByKey.value = {}
    const st = e?.response?.status
    const body = e?.response?.data
    const detail = body && typeof body.detail === 'string' && body.detail.trim() ? `（${body.detail.trim()}）` : ''
    const msg = body?.message || body?.msg || e?.message || '未知错误'
    console.error('[material-bom-fields] 请求失败', st, body ?? e)
    ElMessage.warning(`材料主档字段加载失败（${st || '网络'}）：${msg}${detail}`)
  } finally {
    if (seq === materialBomFetchSeq) {
      materialBomFieldsLoading.value = false
      rebuildMaterialPreviewRows()
    }
  }
}

watch(
  parseResult,
  async () => {
    await nextTick()
    await loadMaterialBomFieldsForPreview()
  },
  { deep: true },
)

/** 编辑基础资料 / 损耗后写入 session，供切标签或重挂载恢复 */
let persistSessionTimer = null
function schedulePersistImportPageSession() {
  if (!parseResult.value || !String(parseFileId.value ?? '').trim()) return
  if (persistSessionTimer) clearTimeout(persistSessionTimer)
  persistSessionTimer = setTimeout(() => {
    persistSessionTimer = null
    if (commitLoading.value) return
    persistImportPageSession()
  }, 400)
}

watch(
  [basicFormList, sharedImportTypeFlag5, cutPreviewColorNo, materialPreviewRows],
  () => schedulePersistImportPageSession(),
  { deep: true },
)

function refreshSmartCheckStateFromSession() {
  if (!parseResult.value) return
  const changed = applyWorkbenchEditsToParseResult(parseResult.value)
  if (changed) {
    rebuildMaterialPreviewRows()
    loadMaterialBomFieldsForPreview()
    persistImportPageSession()
  }
}

/**
 * 智能校验通过后回到导入页：用 session 快照或 workbench 载荷覆盖 keep-alive 内旧 parseResult
 * @returns {Promise<boolean>} 是否已同步解析树
 */
async function reconcileParseResultAfterSmartCheckReturn() {
  const fid = String(parseFileId.value ?? route.query.fileId ?? '').trim()
  if (!fid || !isSmartCheckPassForImportPage(fid)) return false

  const sess = readImportPageSession()
  if (sess?.fileId === fid && sess.parseResultSnapshot) {
    if (parseFileId.value !== fid) parseFileId.value = fid
    applyParseResultSnapshot(sess.parseResultSnapshot)
    restoreImportPageSessionOverlay()
    await loadMaterialBomFieldsForPreview()
    persistImportPageSession()
    return true
  }

  if (!parseResult.value) return false
  if (applyWorkbenchPayloadToParseResult(parseResult.value)) {
    rebuildMaterialPreviewRows()
    await loadMaterialBomFieldsForPreview()
    persistImportPageSession()
    return true
  }
  return false
}

function resolveImportTypeFlag1FromFlag5(flag5) {
  const f5 = String(flag5 ?? '').trim()
  const hit = importTypeOptions.value.find((it) => String(it?.flag5 ?? '').trim() === f5)
  return String(hit?.flag1 ?? '').trim()
}

function applyParseTreeResponse(data) {
  parseResult.value = {
    mainBom: data.mainBom || {},
    cuts: Array.isArray(data.cuts) ? data.cuts : [],
    materials: Array.isArray(data.materials) ? data.materials : [],
    accessories: Array.isArray(data.accessories) ? data.accessories : [],
    warnings: Array.isArray(data.warnings) ? data.warnings : [],
  }
  hideMaterialTable.value = false
  hideCutPreviewTable.value = false
  hydrateBasicFormListFromParseMain(data.mainBom)
  restoreImportPageSessionOverlay()
  persistImportPageSession()
}

/** 从 session 快照恢复解析树（不请求 parse-tree） */
function applyParseResultSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') return false
  parseResult.value = {
    mainBom: snapshot.mainBom || {},
    cuts: Array.isArray(snapshot.cuts) ? snapshot.cuts : [],
    materials: Array.isArray(snapshot.materials) ? snapshot.materials : [],
    accessories: Array.isArray(snapshot.accessories) ? snapshot.accessories : [],
    warnings: Array.isArray(snapshot.warnings) ? snapshot.warnings : [],
  }
  hideMaterialTable.value = false
  hideCutPreviewTable.value = false
  if (snapshot.mainBom) hydrateBasicFormListFromParseMain(snapshot.mainBom)
  return true
}

/**
 * 用 session 快照恢复界面（切标签 / 重挂载且临时 Excel 已归档时）
 * @param {{ fileId?: string, parseResultSnapshot?: any, commitInProgress?: boolean }} sess
 */
async function restoreImportUiFromSessionSnapshot(sess) {
  const fid = String(sess?.fileId ?? parseFileId.value ?? '').trim()
  const snap = sess?.parseResultSnapshot
  if (!fid || !snap) return false
  if (parseFileId.value !== fid) parseFileId.value = fid
  if (!applyParseResultSnapshot(snap)) return false
  restoreImportPageSessionOverlay()
  refreshSmartCheckStateFromSession()
  await loadMaterialBomFieldsForPreview()
  if (sess?.commitInProgress || commitLoading.value) {
    commitRestoreNotice.value =
      '正式导入可能仍在后台进行，界面已从缓存恢复；请勿重复点击「正式导入」，完成后请查看提示或刷新列表。'
  }
  return true
}

function restoreImportPageSessionOverlay() {
  const sess = readImportPageSession()
  if (!sess) return
  if (sess.fileName && !pickedLabel.value) {
    pickedLabel.value = decodePaperPatternUploadFileName(sess.fileName)
  }
  if (sess.sharedImportTypeFlag5) {
    sharedImportTypeFlag5.value = sess.sharedImportTypeFlag5
    syncImportTypeFlag5ToAllBlocks(sess.sharedImportTypeFlag5)
  }
  if (Array.isArray(sess.basicFormList) && sess.basicFormList.length > 0) {
    basicFormList.value = sess.basicFormList.map((b) => ({
      importTypeFlag5: String(b?.importTypeFlag5 ?? '').trim(),
      factoryStyleNo: String(b?.factoryStyleNo ?? '').trim(),
      groupLabel: String(b?.groupLabel ?? '').trim(),
      customerStyleNo: String(b?.customerStyleNo ?? '').trim(),
      colorNo: String(b?.colorNo ?? '').trim(),
      sampleName: String(b?.sampleName ?? '').trim(),
    }))
  }
  if (sess.cutPreviewColorNo) cutPreviewColorNo.value = sess.cutPreviewColorNo
}

function persistImportPageSession(extra = {}) {
  saveImportPageSession({
    fileId: parseFileId.value,
    fileName: pickedLabel.value,
    basicFormList: basicFormList.value,
    sharedImportTypeFlag5: sharedImportTypeFlag5.value,
    cutPreviewColorNo: cutPreviewColorNo.value,
    parseResultSnapshot: cloneParseResultForSessionSnapshot(
      parseResult.value,
      materialPreviewRows.value,
    ),
    commitInProgress:
      extra.commitInProgress !== undefined
        ? !!extra.commitInProgress
        : commitLoading.value,
  })
}

/**
 * @param {string} fileId
 * @param {{ importTypeFlag5?: string, importTypeFlag1?: string, preserveExistingOnFailure?: boolean }} [opts]
 */
async function loadParseTreeFromFileId(fileId, opts = {}) {
  const fid = String(fileId ?? '').trim()
  if (!fid) return false
  const preserveExisting = !!opts.preserveExistingOnFailure
  const hadParse = !!parseResult.value
  parseTreeLoading.value = true
  if (!preserveExisting) errorMessage.value = ''
  try {
    const flag5 = String(opts.importTypeFlag5 ?? sharedImportTypeFlag5.value ?? '').trim()
    const flag1 =
      String(opts.importTypeFlag1 ?? '').trim() || (flag5 ? resolveImportTypeFlag1FromFlag5(flag5) : '')
    const res = await axios.get('/api/paper-pattern/import/parse-tree', {
      params: {
        fileId: fid,
        ...(flag5 ? { importTypeFlag5: flag5 } : {}),
        ...(flag1 ? { importTypeFlag1: flag1 } : {}),
      },
    })
    const data = res?.data
    if (!data?.success) {
      if (!(preserveExisting && hadParse)) {
        errorMessage.value = String(data?.message || '解析失败')
        parseResult.value = null
      }
      return false
    }
    parseFileId.value = fid
    applyParseTreeResponse(data)
    refreshSmartCheckStateFromSession()
    commitRestoreNotice.value = ''
    return true
  } catch (e) {
    const msg =
      e?.response?.data?.message || e?.response?.data?.msg || e?.message || '解析失败'
    if (!(preserveExisting && hadParse)) {
      errorMessage.value = String(msg)
      parseResult.value = null
    }
    return false
  } finally {
    parseTreeLoading.value = false
  }
}

async function tryRestoreParseFromRouteOrSession() {
  const qid = String(route.query.fileId ?? '').trim()
  if (qid) parseFileId.value = qid
  const sess = readImportPageSession()
  const fid = parseFileId.value || sess?.fileId || ''
  const commitBusy = commitLoading.value || !!sess?.commitInProgress

  if (!fid) {
    if (parseResult.value) refreshSmartCheckStateFromSession()
    return
  }

  // 校验通过返回：优先 session 快照（mergeWorkbench 已写入），避免 keep-alive 旧 parseResult 导致指纹不一致
  if (isSmartCheckPassForImportPage(fid) && sess?.fileId === fid && sess.parseResultSnapshot) {
    const restored = await restoreImportUiFromSessionSnapshot(sess)
    if (restored) return
  }

  if (parseResult.value && parseFileId.value === fid) {
    restoreImportPageSessionOverlay()
    await reconcileParseResultAfterSmartCheckReturn()
    refreshSmartCheckStateFromSession()
    return
  }

  if (sess?.fileId === fid && sess.parseResultSnapshot) {
    const restored = await restoreImportUiFromSessionSnapshot(sess)
    if (restored) return
  }

  if (commitBusy) {
    if (sess?.parseResultSnapshot && sess.fileId === fid) {
      await restoreImportUiFromSessionSnapshot(sess)
    } else {
      restoreImportPageSessionOverlay()
      commitRestoreNotice.value =
        '正式导入可能仍在进行；若界面空白请稍候再切回本页，勿重复导入。'
    }
    return
  }

  const flag5 = sess?.sharedImportTypeFlag5 || sharedImportTypeFlag5.value
  const ok = await loadParseTreeFromFileId(fid, {
    importTypeFlag5: flag5,
    importTypeFlag1: flag5 ? resolveImportTypeFlag1FromFlag5(flag5) : '',
  })
  if (!ok) {
    if (sess?.parseResultSnapshot && sess.fileId === fid) {
      await restoreImportUiFromSessionSnapshot(sess)
    }
    return
  }
  restoreImportPageSessionOverlay()
  refreshSmartCheckStateFromSession()
  persistImportPageSession()
}

watch(
  () => route.query.fileId,
  (v) => {
    const next = String(v ?? '').trim()
    if (next && next !== parseFileId.value) {
      parseFileId.value = next
      tryRestoreParseFromRouteOrSession()
    }
  },
)

onMounted(async () => {
  await loadImportTypes()
  await tryRestoreParseFromRouteOrSession()
})

onActivated(() => {
  tryRestoreParseFromRouteOrSession()
})

function goSmartCheck() {
  if (!parseResult.value) {
    ElMessage.warning('请先上传并解析 Excel')
    return
  }
  if (!parseFileId.value) {
    ElMessage.warning('缺少 fileId，请重新上传并解析 Excel')
    return
  }
  try {
    persistImportPageSession()
    saveWorkbenchPayload({
      materials: parseResult.value.materials || [],
      accessories: parseResult.value.accessories || [],
      colorNos: smartCheckColorNos.value,
    })
  } catch {
    ElMessage.warning('无法保存校验数据，请检查浏览器是否允许 sessionStorage')
    return
  }
  router.push({
    path: '/paper-pattern/import/erp-workbench',
    query: { fileId: parseFileId.value },
  })
}

function triggerPickFile() {
  errorMessage.value = ''
  fileInputRef.value?.click()
}

function resolveImportTypeFlag1ForCommit(block) {
  const f5 = String(block?.importTypeFlag5 ?? '').trim()
  const hit = importTypeOptions.value.find((it) => String(it?.flag5 ?? '').trim() === f5)
  return String(hit?.flag1 ?? '').trim()
}

function buildMaterialsPayloadForCommit() {
  const base = parseResult.value?.materials
  const preview = materialPreviewRows.value
  if (Array.isArray(preview) && preview.length > 0 && Array.isArray(base)) {
    return preview.map((row) => {
      const b = base[row.rowIndex] || {}
      return {
        groupNo: row.groupNo,
        materialName: row.materialName,
        materialCode: row.materialCode,
        codesByColor: Array.isArray(b.codesByColor) ? b.codesByColor : [],
        remark: b.remark ?? '',
        usageQty: b.usageQty ?? '',
        wastageFraction: row.wastageFraction,
      }
    })
  }
  return Array.isArray(base)
    ? base.map((m) => ({
        ...m,
        codesByColor: Array.isArray(m.codesByColor) ? m.codesByColor : [],
      }))
    : []
}

/** 正式导入请求体（多色：colorNos + 共享 cuts/materials；Material 子件按 codesByColor 写入） */
function buildCommitPayloadBody() {
  const list = basicFormList.value
  const block = list[0] ?? null
  if (!block) {
    return {
      importTypeFlag5: '',
      importTypeFlag1: '',
      factoryStyleNo: '',
      colorNo: '',
      colorNos: [],
      customerStyleNo: '',
      groupLabel: '',
      cuts: [],
      materials: [],
      accessories: [],
    }
  }
  const colorNos = list.map((b) => String(b.colorNo ?? '').trim()).filter(Boolean)
  return {
    fileId: String(parseFileId.value ?? '').trim(),
    truefilename: String(pickedLabel.value ?? '').trim(),
    importTypeFlag5: block.importTypeFlag5,
    importTypeFlag1: resolveImportTypeFlag1ForCommit(block),
    factoryStyleNo: block.factoryStyleNo,
    colorNo: colorNos[0] ?? '',
    colorNos,
    customerStyleNo: block.customerStyleNo,
    groupLabel: block.groupLabel,
    cuts: parseResult.value?.cuts ?? [],
    materials: buildMaterialsPayloadForCommit(),
    accessories: parseResult.value?.accessories || [],
  }
}

function showCommitSuccessMessage(data) {
  const codes = Array.isArray(data?.mainBomCodes) ? data.mainBomCodes : []
  const code =
    codes.length > 1 ? `${codes[0]} 等 ${codes.length} 色` : String(data?.mainBomCode ?? codes[0] ?? '')
  const nColor = data?.colorCount ?? (codes.length || 1)
  const nCut = data?.cutCount ?? 0
  const nPart = data?.bomPartsInserted ?? 0
  const rep = data?.overwriteReplaced
  let extra = ''
  const repList = Array.isArray(rep) ? rep : rep ? [rep] : []
  if (repList.length > 0) {
    const bom000Del = repList.reduce((s, r) => s + (Number(r?.bom000Deleted) || 0), 0)
    const partsDel = repList.reduce((s, r) => s + (Number(r?.bomPartsDeleted) || 0), 0)
    if (bom000Del > 0 || partsDel > 0) {
      extra = `（已覆盖旧数据：删除 Bom_000 ${bom000Del} 条、Bom_parts ${partsDel} 行）`
    }
  }
  ElMessage.success(
    `导入成功。主 BOM：${code}（${nColor} 色）；CUT 合计：${nCut}；Bom_parts：${nPart} 行${extra}`,
  )
}

async function onCommitBom000() {
  if (!parseResult.value || !allBlocksReadyForCommit.value) {
    ElMessage.warning('请先完成解析，并确保各颜色块的导入类型、厂款号、颜色编码均可生成主 BOM 编码')
    return
  }
  if (!String(parseFileId.value ?? '').trim()) {
    ElMessage.warning('缺少已上传的 Excel（fileId），请重新上传后再正式导入')
    return
  }
  if (!smartCheckPassed.value) {
    ElMessage.warning('请先完成智能校验，全部 Material / Accessory ERP 编码须在 Bom_000 中存在')
    return
  }
  const nColor = basicFormList.value.length
  try {
    await ElMessageBox.confirm(
      `将把 ${nColor} 个主 BOM、各色全套 CUT 写入 Bom_000，并写入 Bom_parts（Material 子件按颜色列全码；单事务，失败全部回滚）。是否继续？`,
      '正式导入',
      { type: 'warning', confirmButtonText: '确定导入', cancelButtonText: '取消' },
    )
  } catch {
    return
  }
  commitRestoreNotice.value = ''
  persistImportPageSession({ commitInProgress: true })
  commitLoading.value = true
  const postCommit = (overwrite) =>
    axios.post('/api/paper-pattern/import/commit-bom000', {
      ...buildCommitPayloadBody(),
      erpSmartCheckAcknowledged: true,
      ...(overwrite ? { overwrite: true } : {}),
    })
  try {
    const res = await postCommit(false)
    const data = res?.data
    if (!data?.success) {
      ElMessage.error(String(data?.message || '导入失败'))
      return
    }
    showCommitSuccessMessage(data.data)
    commitRestoreNotice.value = ''
  } catch (e) {
    const d = e?.response?.data
    if (d?.code === 'MAIN_BOM_EXISTS') {
      const codeHint = String(d?.data?.mainBomCode ?? liveMainBomCodeForCommit.value ?? '').trim()
      try {
        const codes = Array.isArray(d?.data?.mainBomCodes) ? d.data.mainBomCodes : [codeHint]
        const hint =
          codes.length > 1 ? `${codes.join('、')}` : codeHint
        await ElMessageBox.confirm(
          `Bom_000 在册记录中已存在主 BOM：${hint}。是否覆盖？\n将先物理删除对应主 BOM、CUT 及 Bom_parts，再重新导入（单事务，失败全部回滚）。`,
          '主 BOM 已存在',
          { type: 'warning', confirmButtonText: '覆盖并导入', cancelButtonText: '取消' },
        )
      } catch {
        return
      }
      try {
        const res2 = await postCommit(true)
        const data2 = res2?.data
        if (!data2?.success) {
          ElMessage.error(String(data2?.message || '导入失败'))
          return
        }
        showCommitSuccessMessage(data2.data)
        commitRestoreNotice.value = ''
      } catch (e2) {
        const d2 = e2?.response?.data
        ElMessage.error(String(d2?.message || e2?.message || '导入失败'))
      }
    } else {
      ElMessage.error(String(d?.message || e?.message || '导入失败'))
    }
  } finally {
    commitLoading.value = false
    persistImportPageSession({ commitInProgress: false })
  }
}

function onFileChange(ev) {
  const input = ev.target
  const file = input?.files?.[0]
  if (!file) {
    pickedFile.value = null
    pickedLabel.value = ''
    return
  }
  const name = String(file.name || '')
  const lower = name.toLowerCase()
  if (!lower.endsWith('.xlsx') && !lower.endsWith('.xls')) {
    pickedFile.value = null
    pickedLabel.value = ''
    errorMessage.value = '仅允许上传 .xlsx 或 .xls 文件'
    input.value = ''
    return
  }
  pickedFile.value = file
  pickedLabel.value = name
  input.value = ''
}

async function onUploadParse() {
  if (!pickedFile.value) return
  errorMessage.value = ''
  commitRestoreNotice.value = ''
  uploading.value = true
  parseResult.value = null
  parseFileId.value = ''
  clearSmartCheckPass()
  clearImportPageSession()
  try {
    const fd = new FormData()
    fd.append('file', pickedFile.value)
    const up = await axios.post('/api/paper-pattern/import/upload', fd)
    const upData = up?.data
    if (!upData?.success || !upData?.fileId) {
      errorMessage.value = String(upData?.message || '上传失败')
      return
    }
    const fid = String(upData.fileId).trim()
    parseFileId.value = fid
    // 保留浏览器 file.name（中文正确）；勿用 multer originalname 覆盖
    if (!pickedLabel.value && upData.fileName) {
      pickedLabel.value = decodePaperPatternUploadFileName(upData.fileName)
    }
    await router.replace({ path: '/paper-pattern/import', query: { fileId: fid } })
    const ok = await loadParseTreeFromFileId(fid)
    if (!ok) return
    persistImportPageSession()
  } catch (e) {
    const msg =
      e?.response?.data?.message ||
      e?.response?.data?.msg ||
      e?.message ||
      '上传或解析失败'
    errorMessage.value = String(msg)
  } finally {
    uploading.value = false
  }
}
</script>

<style scoped>
.erp-module-page {
  min-height: 200px;
}
.block-card {
  max-width: 1100px;
}
.confirm-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
  margin: 0 0 12px;
}
.global-import-type-row {
  margin-bottom: 4px;
}
.global-import-type-err {
  margin-bottom: 8px;
}
.color-confirm-block {
  margin-bottom: 8px;
  padding-bottom: 4px;
}
.color-block-title {
  margin: 0 0 12px;
  font-size: 15px;
  font-weight: 600;
  color: var(--el-text-color-primary);
}
.color-block-tag {
  margin-left: 8px;
  font-size: 13px;
  font-weight: 500;
  color: var(--el-color-primary);
}
.block-norm-hint {
  margin-top: 0;
}
.first-color-badge {
  margin-left: 10px;
  font-size: 12px;
  color: var(--el-color-warning);
}
.cut-preview-color-row {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 10px;
}
.cut-preview-color-row .k {
  font-size: 13px;
  color: var(--el-text-color-secondary);
  flex-shrink: 0;
}
.cut-preview-color-select {
  min-width: 160px;
}
.page-title {
  font-size: 18px;
  font-weight: 600;
}
.page-desc {
  margin: 0 0 8px;
  color: var(--el-text-color-secondary);
}
.section {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px;
  margin-bottom: 8px;
}
.err-inline {
  color: var(--el-color-danger);
}
.hidden-file {
  display: none;
}
.picked-name {
  color: var(--el-text-color-primary);
}
.picked-placeholder {
  color: var(--el-text-color-placeholder);
}
.hint {
  font-size: 13px;
  color: var(--el-text-color-secondary);
}
.warn-list {
  margin: 8px 0 0;
  padding-left: 1.2em;
}
.warn-block {
  margin-bottom: 12px;
}
.err {
  margin-bottom: 12px;
}
.commit-restore-notice {
  margin-bottom: 12px;
}
.confirm-desc {
  margin: 0 0 12px;
  font-size: 13px;
  color: var(--el-text-color-secondary);
  line-height: 1.5;
}
.confirm-grid {
  margin-bottom: 8px;
}
.form-field {
  margin-bottom: 12px;
}
.form-label {
  font-size: 13px;
  color: var(--el-text-color-regular);
  margin-bottom: 6px;
}
.field-control {
  width: 100%;
}
.norm-hint {
  margin: 0 0 16px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
.norm-hint code {
  font-size: 12px;
}
.fold-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
  margin: 0 0 16px;
}
.danger-zone {
  margin: 0 0 20px;
}
.danger-zone-body p {
  margin: 0 0 10px;
  font-size: 13px;
  line-height: 1.5;
}
.danger-row-second {
  margin-top: 10px;
  flex-wrap: wrap;
}
.danger-hint-list {
  font-size: 12px;
  color: var(--el-text-color-secondary);
  line-height: 1.5;
  word-break: break-all;
}
.danger-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
}
.danger-input {
  flex: 1;
  min-width: 220px;
  max-width: 420px;
}
.material-top-block {
  margin-bottom: 20px;
  padding: 12px 14px;
  border-radius: 6px;
  background: var(--el-fill-color-light);
  border: 1px solid var(--el-border-color-lighter);
}
.material-top-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 6px;
}
.material-top-title {
  margin: 0;
  flex: 1;
  min-width: 140px;
}
.material-top-hint {
  margin: 0 0 8px;
}
.code-preview-block {
  margin-bottom: 20px;
  padding: 12px 14px;
  border-radius: 6px;
  background: var(--el-fill-color-light);
  border: 1px solid var(--el-border-color-lighter);
}
.main-bom-line {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 10px;
  margin-bottom: 12px;
  font-size: 15px;
}
.main-bom-line .k {
  font-weight: 600;
  color: var(--el-text-color-primary);
}
.main-bom-line .v {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  color: var(--el-color-primary);
  word-break: break-all;
}
.sub-title {
  margin: 16px 0 8px;
  font-size: 15px;
  font-weight: 600;
}
.sub-title.sm {
  margin: 0 0 8px;
  font-size: 14px;
}
.preview-table {
  margin-bottom: 8px;
}
.wastage-input {
  width: 132px;
}
</style>
