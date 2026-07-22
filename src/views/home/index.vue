<template>
  <!-- 装饰首页：无 ERP 业务数据；柔蓝雾风格对齐登录页方案 C -->
  <div class="home-welcome">
    <div class="home-welcome-bg" aria-hidden="true" />

    <div class="home-welcome-card">
      <div class="home-greeting">{{ greetingText }}</div>
      <div class="home-datetime" aria-live="polite">{{ datetimeText }}</div>
      <div class="home-hint">请从左侧菜单继续，或使用下方快捷入口</div>

      <div v-if="quickMenus.length" class="home-quick">
        <button
          v-for="item in quickMenus"
          :key="item.path"
          type="button"
          class="home-quick-btn"
          @click="goMenu(item.path)"
        >
          {{ item.title }}
        </button>
      </div>
      <div v-else class="home-quick-empty">
        {{
          editableMenus.length
            ? '尚未选择常用入口，可点下方「编辑常用」'
            : '当前账号暂无可用菜单，请联系管理员分配权限'
        }}
      </div>

      <div v-if="editableMenus.length" class="home-quick-actions">
        <button type="button" class="home-edit-link" @click="openEdit">编辑常用</button>
      </div>
    </div>

    <el-dialog
      v-model="editVisible"
      title="编辑常用快捷入口"
      width="440px"
      append-to-body
      destroy-on-close
      @closed="onEditClosed"
    >
      <p class="home-edit-tip">从有权限的菜单中勾选，最多 {{ HOME_QUICK_MENU_MAX }} 个（本机按账号记住）</p>
      <el-checkbox-group v-model="editChecked" class="home-edit-list" @change="onEditCheckedChange">
        <el-checkbox
          v-for="item in editableMenus"
          :key="item.path"
          :label="item.path"
          :disabled="isEditOptionDisabled(item.path)"
        >
          {{ item.title }}
        </el-checkbox>
      </el-checkbox-group>
      <template #footer>
        <el-button @click="onRestoreDefault">恢复默认</el-button>
        <el-button @click="editVisible = false">取消</el-button>
        <el-button type="primary" @click="onSaveEdit">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import {
  HOME_QUICK_MENU_MAX,
  clearHomeQuickMenuPaths,
  listEditableHomeQuickMenus,
  readHomeQuickMenuPaths,
  resolveHomeQuickMenus,
  saveHomeQuickMenuPaths,
} from '@/utils/homeQuickMenus'

defineOptions({ name: 'home' })

const router = useRouter()
const now = ref(new Date())
let timerId = 0

/** 触发 resolve 重算（保存/恢复后 bump） */
const quickTick = ref(0)

const trueName = computed(() => {
  try {
    const user = JSON.parse(localStorage.getItem('erp_user') || '{}')
    const name = String(user?.truename ?? user?.TrueName ?? user?.AuditTruename ?? '').trim()
    return name || '同事'
  } catch {
    return '同事'
  }
})

const greetingText = computed(() => {
  const h = now.value.getHours()
  let period = '你好'
  if (h >= 5 && h < 12) period = '早上好'
  else if (h >= 12 && h < 18) period = '下午好'
  else period = '晚上好'
  return `${period}，${trueName.value}`
})

const datetimeText = computed(() => {
  const d = now.value
  const week = ['日', '一', '二', '三', '四', '五', '六'][d.getDay()]
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  const ss = String(d.getSeconds()).padStart(2, '0')
  return `${y}年${m}月${day}日 星期${week} ${hh}:${mm}:${ss}`
})

const quickMenus = computed(() => {
  void quickTick.value
  return resolveHomeQuickMenus()
})

const editableMenus = computed(() => listEditableHomeQuickMenus())

const editVisible = ref(false)
const editChecked = ref([])

function goMenu(path) {
  const p = String(path ?? '').trim()
  if (p) router.push(p)
}

function openEdit() {
  const saved = readHomeQuickMenuPaths()
  if (saved == null) {
    editChecked.value = resolveHomeQuickMenus().map((m) => m.path)
  } else {
    // 只预勾仍有权限的项
    const allowed = new Set(editableMenus.value.map((m) => m.path))
    editChecked.value = saved.filter((p) => allowed.has(p))
  }
  editVisible.value = true
}

function isEditOptionDisabled(path) {
  const checked = editChecked.value
  return checked.length >= HOME_QUICK_MENU_MAX && !checked.includes(path)
}

function onEditCheckedChange(val) {
  const list = Array.isArray(val) ? val : []
  if (list.length > HOME_QUICK_MENU_MAX) {
    editChecked.value = list.slice(0, HOME_QUICK_MENU_MAX)
    ElMessage.warning(`最多选择 ${HOME_QUICK_MENU_MAX} 个`)
  }
}

function onSaveEdit() {
  saveHomeQuickMenuPaths(editChecked.value)
  quickTick.value += 1
  editVisible.value = false
  ElMessage.success('常用快捷入口已保存')
}

function onRestoreDefault() {
  clearHomeQuickMenuPaths()
  quickTick.value += 1
  editVisible.value = false
  ElMessage.success('已恢复系统默认快捷入口')
}

function onEditClosed() {
  editChecked.value = []
}

onMounted(() => {
  timerId = window.setInterval(() => {
    now.value = new Date()
  }, 1000)
})

onUnmounted(() => {
  if (timerId) window.clearInterval(timerId)
})
</script>

<style scoped>
.home-welcome {
  /* DIY：与登录页同系的柔蓝雾令牌 */
  --home-page-bg: #f5f8fc;
  --home-mist-alpha: 0.16;
  --home-card-radius: 16px;
  --home-card-pad: 48px 44px 40px;
  --home-title-size: 28px;
  --home-body-size: 14px;
  --home-card-shadow: 0 28px 64px rgba(37, 99, 235, 0.12), 0 8px 24px rgba(15, 23, 42, 0.06);

  position: relative;
  box-sizing: border-box;
  display: flex;
  min-height: calc(100vh - 120px);
  align-items: center;
  justify-content: center;
  padding: 32px 20px;
  color: #0f172a;
  background: var(--home-page-bg);
  isolation: isolate;
}

.home-welcome-bg {
  position: absolute;
  inset: 0;
  z-index: 0;
  pointer-events: none;
  background: radial-gradient(
    ellipse 70% 55% at 50% 42%,
    rgba(147, 197, 253, var(--home-mist-alpha)) 0%,
    transparent 72%
  );
}

.home-welcome-card {
  position: relative;
  z-index: 1;
  box-sizing: border-box;
  width: min(560px, 100%);
  padding: var(--home-card-pad);
  text-align: center;
  background: #ffffff;
  border: 1px solid rgba(226, 232, 240, 0.9);
  border-radius: var(--home-card-radius);
  box-shadow: var(--home-card-shadow);
}

.home-greeting {
  font-size: var(--home-title-size);
  font-weight: 700;
  line-height: 1.35;
  color: #0f172a;
}

.home-datetime {
  margin-top: 14px;
  font-size: var(--home-body-size);
  line-height: 1.5;
  color: #64748b;
  font-variant-numeric: tabular-nums;
}

.home-hint {
  margin-top: 18px;
  font-size: var(--home-body-size);
  line-height: 1.5;
  color: #94a3b8;
}

.home-quick {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
  margin-top: 28px;
}

.home-quick-btn {
  box-sizing: border-box;
  min-height: 48px;
  padding: 12px 14px;
  font-size: var(--home-body-size);
  line-height: 1.4;
  color: #1e3a5f;
  cursor: pointer;
  background: #f8fbff;
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  transition: border-color 0.2s ease, background 0.2s ease, box-shadow 0.2s ease;
}

.home-quick-btn:hover,
.home-quick-btn:focus {
  color: #1d4ed8;
  background: #eff6ff;
  border-color: #93c5fd;
  box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.12);
  outline: none;
}

.home-quick-empty {
  margin-top: 28px;
  font-size: var(--home-body-size);
  line-height: 1.5;
  color: #94a3b8;
}

.home-quick-actions {
  margin-top: 18px;
}

.home-edit-link {
  padding: 0;
  font-size: var(--home-body-size);
  line-height: 1.5;
  color: #64748b;
  cursor: pointer;
  background: none;
  border: none;
  text-decoration: underline;
  text-underline-offset: 3px;
}

.home-edit-link:hover,
.home-edit-link:focus {
  color: #2563eb;
  outline: none;
}

.home-edit-tip {
  margin: 0 0 12px;
  font-size: 14px;
  line-height: 1.5;
  color: #64748b;
}

.home-edit-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: min(52vh, 420px);
  overflow: auto;
  padding: 4px 2px;
  text-align: left;
}

.home-edit-list :deep(.el-checkbox) {
  margin-right: 0;
  height: auto;
  white-space: normal;
}

@media (max-width: 520px) {
  .home-welcome {
    --home-card-pad: 36px 24px 32px;
    --home-title-size: 22px;
  }

  .home-quick {
    grid-template-columns: 1fr;
  }
}

@media (prefers-reduced-motion: reduce) {
  .home-quick-btn {
    transition: none;
  }
}
</style>
