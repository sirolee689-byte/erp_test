<template>
  <Teleport to="body">
    <div
      v-show="visible"
      class="erp-list-row-contextmenu-mask"
      @click="close"
      @contextmenu.prevent="close"
    />
    <ul
      v-show="visible"
      ref="menuRef"
      class="erp-list-row-contextmenu"
      role="menu"
      :style="menuStyle"
      @click.stop
      @contextmenu.prevent
    >
      <li
        v-for="item in menuItems"
        :key="item.key"
        role="menuitem"
        class="erp-list-row-contextmenu__item"
        :class="{ 'is-disabled': item.disabled }"
        @click="onItemClick(item)"
      >
        {{ item.label }}
      </li>
    </ul>
  </Teleport>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, ref } from 'vue'

defineOptions({ name: 'ErpListRowContextMenu' })

/**
 * @typedef {{
 *   key: string,
 *   label: string,
 *   disabled?: boolean,
 *   onSelect?: () => void,
 * }} ErpListRowContextMenuItem
 */

const visible = ref(false)
const posX = ref(0)
const posY = ref(0)
/** @type {import('vue').Ref<ErpListRowContextMenuItem[]>} */
const menuItems = ref([])
const menuRef = ref(null)

const menuStyle = computed(() => ({
  left: `${posX.value}px`,
  top: `${posY.value}px`,
}))

function onDocKeydown(ev) {
  if (ev.key === 'Escape') close()
}

function bindGlobalDismiss() {
  document.addEventListener('keydown', onDocKeydown)
}

function unbindGlobalDismiss() {
  document.removeEventListener('keydown', onDocKeydown)
}

function clampMenuPosition() {
  const el = menuRef.value
  if (!el) return
  const rect = el.getBoundingClientRect()
  const margin = 8
  let x = posX.value
  let y = posY.value
  if (rect.right > window.innerWidth - margin) {
    x = Math.max(margin, window.innerWidth - rect.width - margin)
  }
  if (rect.bottom > window.innerHeight - margin) {
    y = Math.max(margin, window.innerHeight - rect.height - margin)
  }
  posX.value = x
  posY.value = y
}

/**
 * 在表格行右键处弹出菜单（调用方须 event.preventDefault() 且 items 非空时再调）。
 * @param {MouseEvent} event
 * @param {ErpListRowContextMenuItem[]} items
 */
async function open(event, items) {
  const list = (items ?? []).filter((it) => it && String(it.label ?? '').trim())
  if (!list.length) return
  menuItems.value = list
  posX.value = event.clientX
  posY.value = event.clientY
  visible.value = true
  bindGlobalDismiss()
  await nextTick()
  clampMenuPosition()
}

function close() {
  if (!visible.value) return
  visible.value = false
  menuItems.value = []
  unbindGlobalDismiss()
}

/**
 * @param {ErpListRowContextMenuItem} item
 */
function onItemClick(item) {
  if (item?.disabled) return
  close()
  item?.onSelect?.()
}

onBeforeUnmount(() => {
  unbindGlobalDismiss()
})

defineExpose({ open, close })
</script>

<style scoped>
.erp-list-row-contextmenu-mask {
  position: fixed;
  inset: 0;
  z-index: calc(var(--erp-list-row-contextmenu-z, 3000) - 1);
  background: transparent;
}
.erp-list-row-contextmenu {
  position: fixed;
  z-index: var(--erp-list-row-contextmenu-z, 3000);
  min-width: var(--erp-list-row-contextmenu-min-width, 168px);
  margin: 0;
  padding: var(--erp-list-row-contextmenu-padding, 4px 0);
  list-style: none;
  background: var(--erp-surface, #fff);
  border: 1px solid var(--el-border-color-lighter);
  border-radius: var(--el-border-radius-base);
  box-shadow: var(--el-box-shadow-light);
  font-size: var(--erp-list-row-contextmenu-font-size, var(--erp-table-data-size, 14px));
  font-weight: var(--erp-font-weight-body, 400);
  color: var(--el-text-color-regular);
}
.erp-list-row-contextmenu__item {
  padding: var(--erp-list-row-contextmenu-item-padding, 8px 14px);
  line-height: 1.45;
  cursor: pointer;
  white-space: nowrap;
  user-select: none;
}
.erp-list-row-contextmenu__item:hover:not(.is-disabled) {
  background: var(--el-fill-color-light);
  color: var(--el-text-color-primary);
}
.erp-list-row-contextmenu__item.is-disabled {
  color: var(--el-text-color-disabled);
  cursor: not-allowed;
}
</style>
