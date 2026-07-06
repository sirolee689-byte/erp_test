<template>
  <div class="print-kernel-page">
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

    <section class="print-panel">
      <div class="print-panel__head">
        <h1>打印设定</h1>
      </div>

      <el-alert
        v-if="loadError"
        class="print-alert"
        type="error"
        :closable="false"
        show-icon
        :title="loadError"
      />

      <el-form
        ref="formRef"
        v-loading="loading"
        class="print-form"
        :model="form"
        :rules="rules"
        label-width="148px"
      >
        <div class="print-grid">
          <el-form-item label="核心编码" prop="systemcode">
            <el-input v-model="form.systemcode" readonly />
          </el-form-item>
          <el-form-item label="阵列编码">
            <el-input v-model="form.code" readonly />
          </el-form-item>
          <el-form-item label="内核归属">
            <el-input v-model="form.IT_manager" disabled />
          </el-form-item>
          <el-form-item label="企业中文名">
            <el-input v-model="form.qyname" clearable maxlength="500" />
          </el-form-item>
          <el-form-item label="企业英文名">
            <el-input v-model="form.qyenname" clearable maxlength="500" />
          </el-form-item>
          <el-form-item label="企业税号">
            <el-input v-model="form.sh" clearable maxlength="200" />
          </el-form-item>
          <el-form-item label="企业地址" class="is-wide">
            <el-input v-model="form.address" type="textarea" :rows="2" maxlength="500" show-word-limit />
          </el-form-item>
          <el-form-item label="系统中文名">
            <el-input v-model="form.title" clearable maxlength="120" />
          </el-form-item>
          <el-form-item label="系统英文名">
            <el-input v-model="form.entitle" clearable maxlength="120" />
          </el-form-item>
          <el-form-item label="单据 LOGO" class="is-wide">
            <div class="image-field">
              <div class="image-preview image-preview--wide">
                <img v-if="resolveImagePreview(form.logo)" :src="resolveImagePreview(form.logo)" alt="单据 LOGO" />
                <span v-else>暂无图片</span>
              </div>
              <div class="image-actions">
                <el-button size="small" type="primary" :loading="uploadingField === 'logo'" @click="pickImage('logo')">
                  更换图片
                </el-button>
                <el-button size="small" :disabled="saving" @click="clearImage('logo')">清空</el-button>
              </div>
            </div>
          </el-form-item>
          <el-form-item label="单据标头" class="is-wide">
            <div class="document-head-editor">
              <div v-if="resolveImagePreview(form.logo)" class="document-head-logo">
                <img :src="resolveImagePreview(form.logo)" alt="单据 LOGO" />
              </div>
              <div class="html-editor-shell">
                <div
                  ref="infoEditorRef"
                  class="html-editor"
                  contenteditable="true"
                  @input="syncInfoFromEditor"
                ></div>
                <div v-if="!form.info" class="html-editor-placeholder">
                  暂无单据标头，可在这里输入公司名称、地址、电话、传真等抬头文字
                </div>
              </div>
            </div>
          </el-form-item>
          <el-form-item label="核心密钥" prop="key">
            <el-input
              v-model="form.key"
              show-password
              clearable
              maxlength="200"
              placeholder="请输入核心密钥"
              @keyup.enter="submitForm"
            />
          </el-form-item>
        </div>

        <div class="print-note">
          该功能属于 ERP 核心打印配置，修改后会影响系统内所有使用统一打印抬头的单据、报表和打印页面，非授权人员不要随意修改。
        </div>

        <div class="print-actions">
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
      </el-form>
      <input
        ref="imageInputRef"
        class="hidden-file-input"
        type="file"
        accept="image/png,image/jpeg,image/gif,image/webp,image/svg+xml"
        @change="handleImagePicked"
      />
    </section>
  </div>
</template>

<script setup>
import { nextTick, onMounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import axios from 'axios'
import { ElMessage } from 'element-plus'
import { CirclePlus } from '@element-plus/icons-vue'

defineOptions({ name: 'system-kernel-print-setting' })

const router = useRouter()

const kernelItems = [
  { label: 'BOM编码规则' },
  { label: '系统EMAIL设定', route: '/system/kernel/erp-core' },
  { label: '打印设定', active: true, route: '/system/kernel/print-setting' },
  { label: '数据库配置', route: '/system/kernel/database-config' },
]

const emptyForm = {
  systemcode: '',
  code: '002',
  IT_manager: 'UB_ERP_System_Head',
  qyname: '',
  qyenname: '',
  sh: '',
  address: '',
  title: '',
  entitle: '',
  logo: '',
  info: '',
  cnS: null,
  cnT: null,
  enUS: null,
  itIT: null,
  bc: null,
  wxs: null,
  index_logo: '',
  index_img: '',
  index_wx: '',
  key: '',
}

const formRef = ref()
const infoEditorRef = ref()
const imageInputRef = ref()
const loading = ref(false)
const saving = ref(false)
const loadError = ref('')
const uploadingField = ref('')
const pendingImageField = ref('')
const loaded = ref({ ...emptyForm })
const form = reactive({ ...emptyForm })

const rules = {
  key: [{ required: true, message: '核心密钥不能为空', trigger: 'blur' }],
}

function goKernelItem(item) {
  if (!item?.route || item.active) return
  router.push(item.route)
}

function renderInfoEditor() {
  nextTick(() => {
    if (infoEditorRef.value && infoEditorRef.value.innerHTML !== form.info) {
      infoEditorRef.value.innerHTML = form.info || ''
    }
  })
}

function assignForm(data) {
  const next = { ...emptyForm, ...(data || {}) }
  next.key = ''
  Object.assign(form, next)
  loaded.value = { ...next }
  renderInfoEditor()
}

function syncInfoFromEditor() {
  form.info = infoEditorRef.value?.innerHTML || ''
}

function decodeHtmlValue(value) {
  return String(value ?? '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
}

function extractImageSrc(value) {
  const raw = decodeHtmlValue(value).trim()
  if (!raw) return ''
  const srcMatch = raw.match(/\bsrc\s*=\s*["']([^"']+)["']/i)
  if (srcMatch?.[1]) return srcMatch[1].trim()
  if (/^<[^>]+>$/.test(raw)) return ''
  return raw
}

function resolveImagePreview(value) {
  return extractImageSrc(value)
}

function escapeAttr(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function replaceImageSrc(oldValue, newUrl) {
  const raw = String(oldValue ?? '')
  if (/<img\b/i.test(raw) && /\bsrc\s*=\s*["'][^"']*["']/i.test(raw)) {
    return raw.replace(/\bsrc\s*=\s*["'][^"']*["']/i, `src="${escapeAttr(newUrl)}"`)
  }
  if (/<img\b/i.test(raw)) {
    return raw.replace(/<img\b/i, `<img src="${escapeAttr(newUrl)}"`)
  }
  return `<img src="${escapeAttr(newUrl)}" />`
}

function pickImage(field) {
  pendingImageField.value = field
  if (imageInputRef.value) {
    imageInputRef.value.value = ''
    imageInputRef.value.click()
  }
}

async function handleImagePicked(event) {
  const file = event.target?.files?.[0]
  const field = pendingImageField.value
  if (!file || !field) return
  uploadingField.value = field
  try {
    const fd = new FormData()
    fd.append('image', file)
    const { data } = await axios.post('/api/system/kernel/print-image', fd)
    if (Number(data?.code) !== 200 || !data?.data?.url) {
      throw new Error(data?.msg || '图片上传失败')
    }
    form[field] = replaceImageSrc(form[field], data.data.url)
    ElMessage.success(data.msg || '图片上传成功')
  } catch (err) {
    const msg = err?.response?.data?.msg || err?.message || '图片上传失败'
    ElMessage.error(msg)
  } finally {
    uploadingField.value = ''
    pendingImageField.value = ''
  }
}

function clearImage(field) {
  form[field] = ''
}

async function loadConfig() {
  loading.value = true
  loadError.value = ''
  try {
    const { data } = await axios.get('/api/system/kernel/print-config')
    if (Number(data?.code) !== 200) throw new Error(data?.msg || '读取打印设定失败')
    assignForm(data.data)
  } catch (err) {
    const msg = err?.response?.data?.msg || err?.message || '读取打印设定失败'
    loadError.value = msg
    ElMessage.error(msg)
  } finally {
    loading.value = false
  }
}

function resetForm() {
  Object.assign(form, { ...loaded.value, key: '' })
  renderInfoEditor()
  formRef.value?.clearValidate?.()
}

async function submitForm() {
  if (saving.value) return
  syncInfoFromEditor()
  try {
    await formRef.value?.validate()
  } catch {
    return
  }
  saving.value = true
  try {
    const payload = {
      systemcode: form.systemcode,
      qyname: form.qyname,
      qyenname: form.qyenname,
      sh: form.sh,
      address: form.address,
      title: form.title,
      entitle: form.entitle,
      logo: form.logo,
      info: form.info,
      cnS: form.cnS,
      cnT: form.cnT,
      enUS: form.enUS,
      itIT: form.itIT,
      bc: form.bc,
      wxs: form.wxs,
      index_logo: form.index_logo,
      index_img: form.index_img,
      index_wx: form.index_wx,
      key: form.key,
    }
    const { data } = await axios.put('/api/system/kernel/print-config', payload)
    if (Number(data?.code) !== 200) throw new Error(data?.msg || '打印设定保存失败')
    assignForm(data.data)
    ElMessage.success(data.msg || '打印设定保存成功')
  } catch (err) {
    const msg = err?.response?.data?.msg || err?.message || '打印设定保存失败'
    ElMessage.error(msg)
  } finally {
    saving.value = false
  }
}

onMounted(loadConfig)
</script>

<style scoped>
.print-kernel-page {
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

.print-panel {
  max-width: 1180px;
  min-height: 520px;
  padding: 22px 26px 24px;
  background: #fff;
  border: 1px solid #dcdfe6;
}

.print-panel__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-bottom: 18px;
  margin-bottom: 18px;
  border-bottom: 1px solid #ebeef5;
}

.print-panel__head h1 {
  margin: 0;
  font-size: 20px;
  font-weight: 700;
  color: #303133;
}

.print-alert {
  margin-bottom: 16px;
}

.print-form {
  max-width: 1000px;
}

.print-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  column-gap: 28px;
}

.print-grid :deep(.el-form-item) {
  margin-bottom: 18px;
}

.print-grid .is-wide {
  grid-column: 1 / -1;
}

.print-grid :deep(.el-input-number) {
  width: 100%;
}

.html-editor-shell {
  position: relative;
  width: 100%;
}

.document-head-editor {
  width: 100%;
  padding: 10px;
  background: #f8fafc;
  border: 1px solid #dcdfe6;
}

.document-head-logo {
  display: flex;
  align-items: center;
  min-height: 64px;
  padding: 4px 8px 10px;
  margin-bottom: 8px;
  border-bottom: 1px solid #e4e7ed;
}

.document-head-logo img {
  max-width: 260px;
  max-height: 86px;
  object-fit: contain;
}

.html-editor {
  min-height: 150px;
  max-height: 420px;
  padding: 10px 12px;
  overflow: auto;
  line-height: 1.6;
  color: #303133;
  background: #fff;
  border: 1px solid #dcdfe6;
  outline: none;
}

.html-editor:focus {
  border-color: #409eff;
}

.html-editor :deep(img),
.html-editor img {
  max-width: 100%;
  max-height: 180px;
  object-fit: contain;
}

.html-editor :deep(table),
.html-editor table {
  max-width: 100%;
  border-collapse: collapse;
}

.html-editor-placeholder {
  position: absolute;
  top: 11px;
  left: 13px;
  color: #a8abb2;
  pointer-events: none;
}

.image-field {
  display: flex;
  align-items: center;
  gap: 14px;
  width: 100%;
}

.image-preview {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 180px;
  height: 96px;
  overflow: hidden;
  color: #909399;
  background: #fafafa;
  border: 1px dashed #cfd3dc;
}

.image-preview--wide {
  width: 260px;
  height: 130px;
}

.image-preview img {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
}

.image-actions {
  display: flex;
  gap: 8px;
}

.hidden-file-input {
  display: none;
}

.print-note {
  margin: 8px 0 20px 148px;
  padding: 10px 12px;
  line-height: 1.6;
  color: #8a5a00;
  background: #fff7e6;
  border: 1px solid #f3d19e;
}

.print-actions {
  display: flex;
  gap: 12px;
  padding-left: 148px;
}

@media (max-width: 900px) {
  .print-panel {
    padding: 18px 14px;
  }

  .print-grid {
    grid-template-columns: 1fr;
  }

  .print-note,
  .print-actions {
    margin-left: 0;
    padding-left: 0;
  }
}
</style>
