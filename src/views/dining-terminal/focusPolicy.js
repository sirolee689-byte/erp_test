/** 刷卡机实际使用时始终把焦点留给读卡输入框。 */
export function shouldKeepDiningCardFocus(context) {
  return Boolean(context)
}
