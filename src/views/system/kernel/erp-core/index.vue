<template>
  <div class="mail-kernel-page">
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

    <section class="mail-panel">
      <div class="mail-panel__head">
        <h1>系统EMAIL发送配置</h1>
      </div>

      <el-alert
        v-if="loadError"
        class="mail-alert"
        type="error"
        :closable="false"
        show-icon
        :title="loadError"
      />

      <el-form
        ref="formRef"
        v-loading="loading"
        class="mail-form"
        :model="form"
        :rules="rules"
        label-width="128px"
      >
        <div class="mail-grid">
          <el-form-item label="核心编码" prop="systemcode">
            <el-input v-model="form.systemcode" readonly />
          </el-form-item>
          <el-form-item label="阵列编码">
            <el-input v-model="form.code" readonly />
          </el-form-item>
          <el-form-item label="内核归属">
            <el-input v-model="form.IT_manager" disabled />
          </el-form-item>
          <el-form-item label="发件中文名">
            <el-input v-model="form.ConstFromNameCn" clearable maxlength="500" />
          </el-form-item>
          <el-form-item label="发件英文名">
            <el-input v-model="form.ConstFromNameEn" clearable maxlength="500" />
          </el-form-item>
          <el-form-item label="系统地址">
            <el-input v-model="form.ConstFrom" clearable maxlength="50" />
          </el-form-item>
          <el-form-item label="SMTP 地址">
            <el-input v-model="form.ConstMailDomain" clearable maxlength="510" />
          </el-form-item>
          <el-form-item label="邮箱登录名">
            <el-input v-model="form.ConstMailServerUserName" clearable maxlength="500" />
          </el-form-item>
          <el-form-item label="邮箱密码">
            <el-input
              v-model="form.ConstMailServerPassword"
              show-password
              clearable
              maxlength="300"
              :placeholder="passwordPlaceholder"
            />
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

        <div class="mail-note">
          该功能属于 ERP 核心配置，非授权人员不要修改，否则可能影响 ERP 邮件发送功能。
        </div>

        <div class="mail-actions">
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
    </section>
  </div>
</template>

<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import axios from 'axios'
import { ElMessage } from 'element-plus'
import { CirclePlus } from '@element-plus/icons-vue'

defineOptions({ name: 'system-kernel-erp-core' })

const router = useRouter()

const kernelItems = [
  { label: 'BOM编码规则' },
  { label: '系统EMAIL设定', active: true, route: '/system/kernel/erp-core' },
  { label: '打印设定', route: '/system/kernel/print-setting' },
  { label: '数据库配置', route: '/system/kernel/database-config' },
]

function goKernelItem(item) {
  if (!item?.route || item.active) return
  router.push(item.route)
}

const emptyForm = {
  systemcode: '',
  code: '005',
  IT_manager: 'UB_ERP_System_mail',
  ConstFromNameCn: '',
  ConstFromNameEn: '',
  ConstFrom: '',
  ConstMailDomain: '',
  ConstMailServerUserName: '',
  ConstMailServerPassword: '',
  key: '',
  hasPassword: false,
}

const formRef = ref()
const loading = ref(false)
const saving = ref(false)
const loadError = ref('')
const loaded = ref({ ...emptyForm })
const form = reactive({ ...emptyForm })

const rules = {
  key: [{ required: true, message: '核心密钥不能为空', trigger: 'blur' }],
}

const passwordPlaceholder = computed(() =>
  form.hasPassword ? '留空不修改当前邮箱密码' : '首次配置可填写邮箱密码',
)

function assignForm(data) {
  const next = { ...emptyForm, ...(data || {}) }
  next.ConstMailServerPassword = ''
  next.key = ''
  Object.assign(form, next)
  loaded.value = { ...next }
}

async function loadConfig() {
  loading.value = true
  loadError.value = ''
  try {
    const { data } = await axios.get('/api/system/kernel/mail-config')
    if (Number(data?.code) !== 200) throw new Error(data?.msg || '读取系统EMAIL配置失败')
    assignForm(data.data)
  } catch (err) {
    const msg = err?.response?.data?.msg || err?.message || '读取系统EMAIL配置失败'
    loadError.value = msg
    ElMessage.error(msg)
  } finally {
    loading.value = false
  }
}

function resetForm() {
  Object.assign(form, { ...loaded.value, ConstMailServerPassword: '', key: '' })
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
      systemcode: form.systemcode,
      ConstFromNameCn: form.ConstFromNameCn,
      ConstFromNameEn: form.ConstFromNameEn,
      ConstFrom: form.ConstFrom,
      ConstMailDomain: form.ConstMailDomain,
      ConstMailServerUserName: form.ConstMailServerUserName,
      ConstMailServerPassword: form.ConstMailServerPassword,
      key: form.key,
    }
    const { data } = await axios.put('/api/system/kernel/mail-config', payload)
    if (Number(data?.code) !== 200) throw new Error(data?.msg || '系统EMAIL配置保存失败')
    assignForm(data.data)
    ElMessage.success(data.msg || '系统EMAIL配置保存成功')
  } catch (err) {
    const msg = err?.response?.data?.msg || err?.message || '系统EMAIL配置保存失败'
    ElMessage.error(msg)
  } finally {
    saving.value = false
  }
}

onMounted(loadConfig)
</script>

<style scoped>
.mail-kernel-page {
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

.mail-panel {
  max-width: 1120px;
  min-height: 420px;
  padding: 22px 26px 24px;
  background: #fff;
  border: 1px solid #dcdfe6;
}

.mail-panel__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-bottom: 18px;
  margin-bottom: 18px;
  border-bottom: 1px solid #ebeef5;
}

.mail-panel__head h1 {
  margin: 0;
  font-size: 20px;
  font-weight: 700;
  color: #303133;
}

.mail-alert {
  margin-bottom: 16px;
}

.mail-form {
  max-width: 940px;
}

.mail-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  column-gap: 28px;
}

.mail-grid :deep(.el-form-item) {
  margin-bottom: 18px;
}

.mail-note {
  margin: 8px 0 20px 128px;
  padding: 10px 12px;
  line-height: 1.6;
  color: #8a5a00;
  background: #fff7e6;
  border: 1px solid #f3d19e;
}

.mail-actions {
  display: flex;
  gap: 12px;
  padding-left: 128px;
}

@media (max-width: 900px) {
  .mail-panel {
    padding: 18px 14px;
  }

  .mail-grid {
    grid-template-columns: 1fr;
  }

  .mail-note,
  .mail-actions {
    margin-left: 0;
    padding-left: 0;
  }
}
</style>
