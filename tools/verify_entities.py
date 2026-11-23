# Controllo meccanico: ogni nome, livello e numero delle 35 schede di una classe contro i dati grezzi del client.
# Uso: python -I tools/verify_entities.py data/classes/gladiator/entities.json data/raw/questlog-2026-10-06
#      python -I tools/verify_entities.py data/classes/ranger/entities.json data/raw/questlog-2026-10-10-ranger
# Esce con codice 1 se trova anche una sola differenza.
import io
import json
import os
import re
import sys

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
ent_file, raw_dir = sys.argv[1], sys.argv[2]
ents = json.load(open(ent_file, encoding='utf-8'))
canon = {re.sub(r'[^a-z0-9]+', '-', r['name'].lower().replace("'", '')).strip('-'): r
         for r in json.load(open(os.path.join(raw_dir, 'canon-en.json'), encoding='utf-8'))}
scaling = {r['name']: r for r in json.load(open(os.path.join(raw_dir, 'scaling.json'), encoding='utf-8'))}
problems, checks = [], 0


def check(cond, msg):
    global checks
    checks += 1
    if not cond:
        problems.append(msg)


def num(text):
    """'5,5%' -> 5.5 ; '+190' -> 190 ; '-15%' -> 15"""
    m = re.search(r'-?\+?(\d+(?:[.,]\d+)?)', text.replace('.', '') if re.search(r'\d\.\d{3}', text) else text)
    return float(m.group(1).replace(',', '.')) if m else None


seen = set()
for group, cat in (('skills', 'active'), ('stigma', 'stigma'), ('passive', 'passive')):
    for e in ents[group]:
        c = canon.get(e['id'])
        check(c is not None, f"{e['id']}: non esiste nei dati del client")
        if not c:
            continue
        seen.add(e['id'])
        check(c['cat'] == cat, f"{e['id']}: categoria {cat}, nel client {c['cat']}")
        check(e['name'] == c['name'], f"{e['id']}: nome '{e['name']}' diverso da '{c['name']}'")
        check(e.get('ko') == c['ko'], f"{e['id']}: nome coreano '{e.get('ko')}' diverso da '{c['ko']}'")
        specs = [(s['at'], s['text']) for s in c['specs']]
        mine = [(o['req'], o['name']) for o in e.get('options', [])] + [(u['at'], u['name']) for u in e.get('unlocks', [])]
        if cat != 'passive':
            check(sorted(mine) == sorted(specs), f"{e['id']}: specializzazioni diverse. Hub {sorted(mine)} | client {sorted(specs)}")
        meta = e.get('meta', '')
        if cat != 'passive':
            sc = scaling[c['name']]
            cd = sc['cooldown_s']
            m = re.search(r'Ricarica (\d+(?:,\d+)?) s', meta)
            if cd and cd > 0:
                check(m is not None and float(m.group(1).replace(',', '.')) == cd, f"{e['id']}: ricarica nell'hub '{meta}', nel client {cd:g} s")
            else:
                check('Nessuna ricarica' in meta, f"{e['id']}: il client dice ricarica 0, l'hub '{meta}'")
            mp = sc['mp']
            m = re.search(r'· (\d+) MP', ' · ' + meta)
            check(m is not None and int(m.group(1)) == mp, f"{e['id']}: MP nell'hub '{meta}', nel client {mp}")
            rng = c['range_m']
            if rng and rng > 0 and cat == 'active':
                # vale la gittata del campo dati oppure una distanza scritta nel testo del client ("within 5m of the caster")
                allowed = {rng} | {float(x) for x in re.findall(r'(\d+(?:\.\d+)?)m\b', c['desc'])}
                m = re.search(r'· (\d+(?:,\d+)?) m\b', ' · ' + meta)
                check(m is not None and float(m.group(1).replace(',', '.')) in allowed, f"{e['id']}: gittata nell'hub '{meta}', nel client {sorted(allowed)} m")
        # scelte: devono esistere, rispettare il livello richiesto e il numero di slot
        for mode in ('pve', 'pvp'):
            md = e.get(mode) or {}
            for p in md.get('picks', []):
                slots = 3 if p['at'] >= 20 else 2 if p['at'] >= 12 else 1 if p['at'] >= 8 else 0
                check(len(p['choose']) <= slots, f"{e['id']} {mode}: {len(p['choose'])} scelte al livello {p['at']} ({slots} slot)")
                for ch in p['choose']:
                    req = next((s['at'] for s in c['specs'] if s['text'] == ch), None)
                    check(req is not None and req <= p['at'], f"{e['id']} {mode}: '{ch}' non disponibile al livello {p['at']}")
            if cat == 'stigma' and md.get('level') is not None:
                check(1 <= int(md['level']) <= 20, f"{e['id']} {mode}: livello stigma {md['level']} fuori da 1-20")
        # passive: valori ai livelli 1, 10, 20
        if cat == 'passive':
            sc = scaling[c['name']]
            series = []
            for s in sc['scaling']:
                v = s['values']
                series.append((v.get('1'), v.get('10'), v.get('20')))
                # il client scrive alcuni numeri in millesimi e li divide quando li mostra (divide1000 nella chiave):
                # Healing Enhancement del Cleric, 22400 -> 22,4% dell'attacco
                if 'divide1000' in str(s.get('key', '')) and all(isinstance(v.get(k), (int, float)) for k in ('1', '10', '20')):
                    series.append(tuple(v[k] / 1000 for k in ('1', '10', '20')))
            # anche il danno (o la cura) scritto nella scheda, che il client calcola livello per livello: è il minimo della forbice
            for v in (sc.get('damage') or {}).values():
                series.append((v.get('1'), v.get('10'), v.get('20')))
            for row in e.get('scale', []):
                got = tuple(num(x) for x in row['v'])
                check(any(all(g is not None and t is not None and abs(g - t) < 1e-9 for g, t in zip(got, tr)) for tr in series),
                      f"{e['id']}: la riga '{row['label']}' {row['v']} non corrisponde a nessuna serie del client {series}")

check(len(seen) == 35, f"schede verificate {len(seen)} su 35")

# numeri citati nei testi di sintesi delle skill, confrontati col testo del client: classe per classe (la classe è
# quella delle schede: i codici delle sue skill cominciano con due cifre sue)
FACTS = {}
FACTS['14'] = {
    'deadshot': ['35%'],
    'snipe': ['120 MP'],
    'drill-dart': ['60%', '6 secondi', '100 MP'],
    'gale-arrow': ['10 secondi', '+7%'],
    'marking-shot': ['10 secondi', '+300'],
    'snare-shot': ['40%', '5 secondi'],
    'suppressing-arrow': ['40%', '3 secondi'],
    'explosion-trap': ['10 secondi', '5 metri', '3 secondi'],
    'defiance': ['5 secondi'],
    'vaizels-authority': ['+20%'],
    'bow-of-blessing': ['+200', '+100'],
    'supporting-fire': ['15 secondi'],
    'sealing-arrow': ['75%', '5 secondi'],
    'ensnaring-trap': ['30 secondi', '3 secondi'],
    'mother-natures-breath': ['6 secondi', '20%', '+200'],
    'explosive-arrow': ['20%'],
}
FACTS['11'] = {
    'overhead-slam': ['7%'],
    'aerial-snare': ['5%', '50%'],
    'ruinous-blow': ['+20%', '+10%', '+100', '+15%', '20 secondi'],
    'rage-burst': ['10 secondi', '+10%', '+5%', '10%'],
    'mocking-blade': ['3 secondi'],
    'defiance': ['5 secondi'],
    'blade-toss': ['20 metri', '10 secondi', '30%'],
    'tenaciousness': ['3 secondi'],
    'forced-restraint': ['75%', '5 secondi'],
    'keen-strike': ['100 MP'],
    'lifestealing-blade': ['10%'],
    'leaping-slam': ['20 metri'],
    'rush-strike': ['30%'],
}
FACTS['18'] = {
    'onslaught': ['100 MP'],
    'impactful-crush': ['60%', '3 secondi', '2 secondi'],
    'wave-blow': ['3 secondi', '7%'],
    'rushing-smash': ['100 MP', '20 metri'],
    'dark-crush': ['20 metri'],
    'recuperation': ['40 metri', '8 secondi'],
    'heat-wave-blow': ['40%', '3 secondi'],
    'defiance': ['5 secondi'],
    'tremor-crush': ['10 metri', '50%', '3 secondi'],
    'spinning-strike': ['+15%', '30 secondi', '2 secondi'],
    'fracturing-blow': ['30%', '5 secondi', '20%'],
    'focused-defense': ['110 MP'],
    'sprint-mantra': ['15%'],
    'healing-touch': ['40 metri'],
    'obliterate': ['50%'],
    'ensnaring-mark': ['50%', '5 secondi', '3 secondi'],
    'impeding-authority': ['16%', '20 secondi'],
    'power-of-the-storm': ['+20%', '10 secondi'],
    'marchutans-wrath': ['3 secondi'],
    'guardian-blessing': ['120 secondi'],
    'barrier-spell': ['3 secondi', '10%'],
    'assault-shock': ['30%', '3 secondi', '20%'],
    'crossguard': ['+200'],
    'protection-circle': ['10 secondi', '5 secondi'],
    'attack-preparation': ['+100'],
    'earths-promise': ['5 secondi', '10 secondi'],
}
FACTS['17'] = {
    'earths-retribution': ['110 MP', '20 metri'],
    'judgment-thunder': ['20 metri', '4 nemici'],
    'bolt': ['20 metri', '4 nemici', '35'],
    'chain-of-torment': ['5%', '10 secondi', '20 metri'],
    'debilitating-mark': ['5%', '10 secondi'],
    'light-of-regeneration': ['40 metri', '2 secondi', '30 secondi'],
    'healing-light': ['40 metri'],
    'radiant-recovery': ['40 metri'],
    'divine-aura': ['5 secondi', '20 metri'],
    'defiance': ['5 secondi'],
    'condemnation': ['4 nemici'],
    'lightning-strike-scattershot': ['20 metri'],
    'benevolence': ['20 secondi', '40 metri', '2 secondi'],
    'root': ['75%', '10 secondi'],
    'salvation': ['3 secondi'],
    'power-burst': ['50 alla barra'],
    'absolution': ['40 metri', '2 effetti'],
    'voice-of-doom': ['60%', '20 secondi'],
    'summon-resurrection': ['40 metri'],
    'earth-punishment': ['10 secondi', '20 metri'],
    'yustiels-power': ['+20%', '10 secondi', '40 metri'],
    'prayer-of-amplification': ['+20%', '10 secondi'],
    'noble-aura': ['2 secondi'],
    'assault-mark': ['30%', '20%'],
    'empyrean-lords-benediction': ['+200', '3 secondi'],
    'heal-block': ['7%', '5 secondi'],
    'prayer-of-concentration': ['+20%', '30 secondi'],
    'earths-grace': ['+100'],
    'radiant-benediction': ['40 metri', '5 secondi'],
    'survival-willpower': ['5 secondi'],
}
facts = FACTS.get(str(next(iter(canon.values()))['id'])[:2], {})
by = {e['id']: e for g in ('skills', 'stigma', 'passive') for e in ents[g]}
for sid, tokens in facts.items():
    desc = canon[sid]['desc'] + ' ' + ' '.join(s['text'] for s in canon[sid]['specs'])
    for t in tokens:
        check(t in by[sid]['sum'] or t in by[sid].get('meta', ''), f"{sid}: il testo dell'hub non contiene più '{t}'")
        n = re.sub(r'[^0-9]', '', t)
        check(re.search(r'(?<!\d)' + n + r'(?!\d)', desc) is not None, f"{sid}: il numero {n} citato dall'hub non compare nel testo del client")

print(f'controlli eseguiti: {checks} | differenze: {len(problems)}')
for p in problems:
    print(' -', p)
sys.exit(1 if problems else 0)
