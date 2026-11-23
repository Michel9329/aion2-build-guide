# Prova che il controllo meccanico ha i denti: inietta errori realistici in una COPIA delle schede
# e conta quanti ne trova verify_entities.py. Gli originali non vengono toccati.
# Uso: python -I tools/mutate_entities.py data/entities.json data/raw/questlog-2026-10-06 <cartella-temporanea>
import copy
import io
import json
import os
import subprocess
import sys

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
src, raw, tmp = sys.argv[1], sys.argv[2], sys.argv[3]
os.makedirs(tmp, exist_ok=True)
base = json.load(open(src, encoding='utf-8'))


def by_id(d):
    return {e['id']: e for g in ('skills', 'stigma', 'passive') for e in d[g]}


def m_cooldown(d): by_id(d)['ruinous-blow']['meta'] = by_id(d)['ruinous-blow']['meta'].replace('Ricarica 45 s', 'Ricarica 30 s')
def m_mp(d): by_id(d)['rending-blow']['meta'] = by_id(d)['rending-blow']['meta'].replace('120 MP', '100 MP')
def m_range(d): by_id(d)['leaping-slam']['meta'] = by_id(d)['leaping-slam']['meta'].replace('20 m', '25 m')
def m_spec_level(d): by_id(d)['overhead-slam']['options'][4]['req'] = 12
def m_spec_name(d): by_id(d)['rending-blow']['options'][4]['name'] = 'Restores 60 MP on landing a Critical Hit'
def m_slots(d): by_id(d)['overhead-slam']['pve']['picks'][2]['choose'].append('Critical Hit on hit')
def m_pick_early(d): by_id(d)['rending-blow']['pve']['picks'][1]['choose'][1] = 'Restores 50 MP on landing a Critical Hit'
def m_unlock(d): by_id(d)['rage-burst']['unlocks'][0]['name'] = '-10s [Rage Burst] cooldown'
def m_unlock_level(d): by_id(d)['lunge-stance']['unlocks'][3]['at'] = 15
def m_stigma_level(d): by_id(d)['lunge-stance']['pve']['level'] = 25
def m_ko(d): by_id(d)['overhead-slam']['ko'], by_id(d)['rending-blow']['ko'] = by_id(d)['rending-blow']['ko'], by_id(d)['overhead-slam']['ko']
def m_name(d): by_id(d)['zikels-blessing']['name'] = "Zikel's Blessings"
def m_passive(d): by_id(d)['attack-preparation']['scale'][0]['v'][2] = '20%'
def m_passive2(d): by_id(d)['experienced-counterstrike']['scale'][1]['v'][1] = '17%'
def m_fact(d): by_id(d)['overhead-slam']['sum'] = by_id(d)['overhead-slam']['sum'].replace('7%', '10%')
def m_fact2(d): by_id(d)['forced-restraint']['sum'] = by_id(d)['forced-restraint']['sum'].replace('75%', '50%')
def m_stigma_cd(d): by_id(d)['rage-burst']['meta'] = by_id(d)['rage-burst']['meta'].replace('Ricarica 45 s', 'Ricarica 60 s')


mutations = [m_cooldown, m_mp, m_range, m_spec_level, m_spec_name, m_slots, m_pick_early, m_unlock, m_unlock_level,
             m_stigma_level, m_ko, m_name, m_passive, m_passive2, m_fact, m_fact2, m_stigma_cd]
caught = 0
for m in mutations:
    d = copy.deepcopy(base)
    m(d)
    path = os.path.join(tmp, 'mut.json')
    json.dump(d, open(path, 'w', encoding='utf-8'), ensure_ascii=False)
    r = subprocess.run([sys.executable, '-I', os.path.join(os.path.dirname(__file__), 'verify_entities.py'), path, raw], capture_output=True)
    ok = r.returncode == 1
    caught += ok
    print(('TROVATO ' if ok else 'SFUGGITO') + '  ' + m.__name__)
r = subprocess.run([sys.executable, '-I', os.path.join(os.path.dirname(__file__), 'verify_entities.py'), src, raw], capture_output=True)
print(f'\nerrori iniettati: {len(mutations)} | trovati: {caught} | originale pulito: {r.returncode == 0}')
sys.exit(0 if caught == len(mutations) and r.returncode == 0 else 1)
