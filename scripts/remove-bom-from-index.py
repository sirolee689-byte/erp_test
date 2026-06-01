"""Remove BOM blocks from index.js after extraction (reverse order)."""
from pathlib import Path

INDEX = Path(__file__).resolve().parents[1] / "server" / "index.js"
lines = INDEX.read_text(encoding="utf-8").splitlines(keepends=True)

CHUNKS = [
    (7267, 10334),
    (4262, 4331),
    (4139, 4140),
    (3502, 3790),
]

for start, end in CHUNKS:
    del lines[start:end]

INDEX.write_text("".join(lines), encoding="utf-8")
print(f"Updated {INDEX}, now {len(lines)} lines")
