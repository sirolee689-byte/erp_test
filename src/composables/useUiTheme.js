import { computed, ref } from 'vue'

import {

  UI_THEME_LIGHT,

  UI_THEME_WARM,

  UI_THEME_DARK,

  UI_THEME_BEANGREEN,

  UI_THEME_LIGHTBLUE,

  applyUiThemeToDocument,

  getStoredUiTheme,

  persistUiTheme,

} from '@/utils/uiTheme'



/** 全站共享的皮肤（顶栏切换共用一份状态） */

const themeRef = ref(getStoredUiTheme())



/**

 * 界面皮肤：全白 / 暖色护眼 / 暗黑 / 豆沙绿 / 淡蓝

 * @returns {{

 *   theme: import('vue').Ref<'light' | 'warm' | 'dark' | 'beangreen' | 'lightblue'>,

 *   isWarm: import('vue').ComputedRef<boolean>,

 *   setTheme: (next: 'light' | 'warm' | 'dark' | 'beangreen' | 'lightblue') => void,

 *   UI_THEME_LIGHT: 'light',

 *   UI_THEME_WARM: 'warm',

 *   UI_THEME_DARK: 'dark',

 *   UI_THEME_BEANGREEN: 'beangreen',

 *   UI_THEME_LIGHTBLUE: 'lightblue',

 * }}

 */

export function useUiTheme() {

  const isWarm = computed(() => themeRef.value !== UI_THEME_LIGHT)



  function setTheme(next) {

    const t = persistUiTheme(next)

    applyUiThemeToDocument(t)

    themeRef.value = t

  }



  return {

    theme: themeRef,

    isWarm,

    setTheme,

    UI_THEME_LIGHT,

    UI_THEME_WARM,

    UI_THEME_DARK,

    UI_THEME_BEANGREEN,

    UI_THEME_LIGHTBLUE,

  }

}


