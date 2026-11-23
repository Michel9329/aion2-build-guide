# Builds a SELF-REFERENTIAL reference set from a curated entities.json, so that verify_entities.py and
# mutate_entities.py can run without the third-party raw dumps (which are not in this repository).
#
# What this proves: the checker detects every injected error. What it does NOT prove: that the curated
# numbers match the game, because here the reference is derived from the curated file itself. For that you
# need real client data (see README, "Verifying against real data").
# Usage: python -I tools/make_demo_fixture.py <entities.json> <output-folder> [id-prefix]
# The id prefix picks the class table inside verify_entities.py: 11 gladiator (default), 14 ranger, 18 chanter, 17 cleric.
import io
import json
import os
import re
import sys

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
src, out = sys.argv[1], sys.argv[2]
prefix = sys.argv[3] if len(sys.argv) > 3 else '11'
os.makedirs(out, exist_ok=True)
ents = json.load(open(src, encoding='utf-8'))


def num(text):
    m = re.search(r'-?\+?(\d+(?:[.,]\d+)?)', text.replace('.', '') if re.search(r'\d\.\d{3}', text) else text)
    return float(m.group(1).replace(',', '.')) if m else None


canon, scaling = [], []
n = 0
for group, cat in (('skills', 'active'), ('stigma', 'stigma'), ('passive', 'passive')):
    for e in ents[group]:
        n += 1
        meta = e.get('meta', '')
        specs = [{'at': o['req'], 'text': o['name']} for o in e.get('options', [])] + \
                [{'at': u['at'], 'text': u['name']} for u in e.get('unlocks', [])]
        rng = re.search(r'· (\d+(?:,\d+)?) m\b', ' · ' + meta)
        canon.append({
            'id': f'{prefix}{n:05d}', 'name': e['name'], 'ko': e.get('ko'), 'cat': cat, 'specs': specs,
            'range_m': float(rng.group(1).replace(',', '.')) if rng else 0,
            # the description is the hub's own summary plus its meta line: enough to hold the numbers the hub quotes
            'desc': e.get('sum', '') + ' ' + meta,
        })
        cd = re.search(r'Ricarica (\d+(?:,\d+)?) s', meta)
        mp = re.search(r'· (\d+) MP', ' · ' + meta)
        row = {'name': e['name'], 'cooldown_s': float(cd.group(1).replace(',', '.')) if cd else 0,
               'mp': int(mp.group(1)) if mp else 0, 'scaling': [], 'damage': {}}
        for i, r in enumerate(e.get('scale', [])):
            v = [num(x) for x in r['v']]
            row['scaling'].append({'key': f'row{i}', 'values': {'1': v[0], '10': v[1], '20': v[2]}})
        scaling.append(row)
json.dump(canon, open(os.path.join(out, 'canon-en.json'), 'w', encoding='utf-8'), ensure_ascii=False)
json.dump(scaling, open(os.path.join(out, 'scaling.json'), 'w', encoding='utf-8'), ensure_ascii=False)
print(f'fixture written to {out}: {n} entries')
