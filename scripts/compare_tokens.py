#!/usr/bin/env python3
"""Compare user-supplied benchmark CSV rows (no OpenCode API assumptions)."""
import csv
from collections import defaultdict
from pathlib import Path
import sys

path = Path(sys.argv[1]) if len(sys.argv) > 1 else Path('benchmarks/measurements.csv')
if not path.exists():
    raise SystemExit(f'Not found: {path}')
rows = list(csv.DictReader(path.open(newline='', encoding='utf-8')))
agg = defaultdict(list)
for row in rows:
    if not row.get('total_tokens'):
        continue
    try:
        n = int(row['total_tokens'])
    except ValueError:
        print(f'Skipped invalid token count in {row!r}', file=sys.stderr)
        continue
    if n < 0:
        raise SystemExit('Negative total_tokens is invalid')
    agg[(row['task'], row['scenario'])].append(n)
if not agg:
    print('No measured token rows yet. Fill benchmarks/measurements.csv first.')
for (task, scenario), values in sorted(agg.items()):
    print(f'{task:24} {scenario:24} runs={len(values):2} avg_tokens={sum(values)/len(values):,.0f}')
