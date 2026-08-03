export function pairDiningDailyOrderRows(rows = []) {
  const pairs = []
  for (let index = 0; index < rows.length; index += 2) {
    pairs.push({ left: rows[index], right: rows[index + 1] || null })
  }
  return pairs
}
