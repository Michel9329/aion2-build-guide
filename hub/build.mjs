// Genera l'hub dai dati: data/classes/gladiator/guide.json -> hub/index.html (pagina completa, si apre col doppio clic)
// e hub/artifact.html (solo contenuto, per la pubblicazione). La pagina non si modifica a mano.
// Uso: node hub/build.mjs [guide.json] [cartella-uscita]   (dalla radice del repository; AION_NO_SHOTS=1 salta le schermate)
// Il build si ferma con un errore se i dati si contraddicono: una skill citata che non esiste,
// una specializzazione scelta che non è tra le opzioni, una fonte senza voce in elenco.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { passiveTiers, tierSays } from '../lib/passive-tiers.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const rootDir = join(here, '..');
const dataFile = process.argv[2] ? resolve(process.argv[2]) : join(rootDir, 'data', 'classes', 'gladiator', 'guide.json');
const data = JSON.parse(readFileSync(dataFile, 'utf8'));
for (const f of data.include || []) Object.assign(data, JSON.parse(readFileSync(join(dirname(dataFile), f), 'utf8')));
const css = readFileSync(join(here, 'hub.css'), 'utf8');
const js = readFileSync(join(here, 'hub.js'), 'utf8');

const MODES = ['pve', 'pvp'];
const problems = [];
const fail = (msg) => { if (!problems.includes(msg)) problems.push(msg); return ''; };

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// Indici: fonti e voci (skill attive, a catena, stigma, passive) per id.
const srcIndex = new Map();
(data.sources || []).forEach((s, i) => {
  if (srcIndex.has(s.id)) fail(`fonte duplicata: ${s.id}`);
  srcIndex.set(s.id, i + 1);
});
const entities = new Map();
for (const group of ['skills', 'stigma', 'passive', 'chains']) {
  for (const e of data[group] || []) {
    if (entities.has(e.id)) fail(`id duplicato: ${e.id}`);
    entities.set(e.id, { ...e, group, _i: (data[group] || []).indexOf(e) });
  }
}

const iconCache = new Map();
// Le immagini delle skill stanno accanto ai dati della classe. Una build in più (data/classes/<classe>/builds/<id>/,
// il Cleric da cura) usa quelle della sua classe, due cartelle più su.
const classDir = /[\\/]builds[\\/][a-z0-9-]+$/.test(dirname(dataFile)) ? join(dirname(dataFile), '..', '..') : dirname(dataFile);
function iconUri(id) {
  if (iconCache.has(id)) return iconCache.get(id);
  let uri = null;
  for (const [ext, mime] of [['png', 'image/png'], ['webp', 'image/webp'], ['jpg', 'image/jpeg']]) {
    const f = join(classDir, 'icons', `${id}.${ext}`);
    if (existsSync(f)) { uri = `data:${mime};base64,${readFileSync(f).toString('base64')}`; break; }
  }
  iconCache.set(id, uri);
  return uri;
}
// Ogni icona è una classe CSS definita una volta sola, così l'immagine non si ripete nella pagina.
const usedIcons = new Set();
function iconHtml(id, name) {
  if (iconUri(id)) { usedIcons.add(id); return `<i class="ic ic-${id}" aria-hidden="true"></i>`; }
  const initials = String(name).split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
  return esc(initials);
}
function ent(id, where) {
  const e = entities.get(id);
  if (!e) { fail(`${where}: la voce "${id}" non esiste nei dati`); return { id, name: id }; }
  return e;
}

function srcSup(ids, where) {
  if (!ids || !ids.length) return '';
  const links = ids.map((id) => {
    const n = srcIndex.get(id);
    if (!n) return fail(`${where}: fonte "${id}" non in elenco`);
    return `<a href="#fonte-${n}" title="${esc(data.sources[n - 1].label)}">${n}</a>`;
  });
  return `<sup class="src">${links.join(' ')}</sup>`;
}

// Testo con marcature leggere: **grassetto**, [[id-skill]], {{TASTO}}, [^id-fonte].
function rich(text, where = 'testo') {
  let out = esc(text);
  out = out.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/\[\[([a-z0-9-]+)\]\]/g, (_, id) => `<strong>${esc(ent(id, where).name)}</strong>`);
  out = out.replace(/\{\{(.+?)\}\}/g, '<kbd>$1</kbd>');
  out = out.replace(/\[([^\]\[]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
  out = out.replace(/\[\^([a-z0-9-,]+)\]/g, (_, ids) => srcSup(ids.split(','), where));
  return out;
}

const CONF = { high: ['', 'fonti concordi'], mid: ['mid', 'fonti in parte diverse'], low: ['low', 'da confermare in gioco'] };
function conf(e) {
  if (!e.conf) return '';
  const [cls, label] = CONF[e.conf] || fail(`${e.id}: affidabilità sconosciuta "${e.conf}"`) || ['', ''];
  const note = e.confNote ? ` title="${esc(e.confNote)}"` : '';
  return `<span class="conf ${cls}"${note}>${label}</span>`;
}

// ---- Righe: skill, stigma, passive ---------------------------------------------------------
// Skill attive: gli slot di specializzazione si aprono ai livelli 8, 12 e 20 della skill.
const slotsAt = (level) => (level >= 20 ? 3 : level >= 12 ? 2 : level >= 8 ? 1 : 0);

function picksHtml(e, mode) {
  const m = e[mode];
  const opts = e.options || [];
  let rows = '';
  if (m && (m.picks || []).length) {
    rows = [...m.picks].sort((a, b) => a.at - b.at).map((p) => {
      if (p.choose.length > slotsAt(p.at)) fail(`${e.id} (${mode}): al livello ${p.at} ci sono ${slotsAt(p.at)} slot, ne sono scelti ${p.choose.length}`);
      for (const c of p.choose) {
        const o = opts.find((x) => x.name === c);
        if (!o) fail(`${e.id} (${mode}): la specializzazione "${c}" non esiste`);
        else if (o.req > p.at) fail(`${e.id} (${mode}): "${c}" richiede il livello ${o.req}, scelta al ${p.at}`);
      }
      const target = Number(m.level) === p.at;
      return `<div class="pk ${target ? 'on' : 'off'}"><span class="at">Lv ${p.at}</span><span class="ch">${p.choose.map((c) => `<b>${esc(c)}</b>`).join(' + ')}${p.note ? ` <span class="pn">${rich(p.note, e.id)}</span>` : ''}</span></div>`;
    }).join('');
  }
  const note = m && m.note ? `<div class="note">${rich(m.note, e.id)}</div>` : '';
  let all = '';
  if (opts.length) {
    const chosen = new Set(((m && m.picks) || []).flatMap((p) => p.choose));
    const body = opts.map((o) => `<div class="${chosen.has(o.name) ? 'sel' : ''}"><span class="at">dal livello ${esc(o.req)}</span><b>${esc(o.name)}</b>${o.it ? ': ' + rich(o.it, e.id) : ''}</div>`).join('');
    all = `<details class="more"><summary>Tutte le specializzazioni</summary><div class="opts">${body}</div></details>`;
  }
  return `<div class="picks-col only-${mode}"><div class="picks">${rows}</div>${note}${all}</div>`;
}

// Stigma: un effetto in più ogni 5 livelli, senza scelta.
function unlocksHtml(e, mode) {
  const m = e[mode];
  const lv = m ? Number(m.level) || 0 : 0;
  const rows = (e.unlocks || []).map((u) => `<div class="pk ${lv >= u.at ? 'on' : 'off'}"><span class="at">Lv ${esc(u.at)}</span><span class="ch"><b>${esc(u.name)}</b>${u.it ? ` <span class="pn">${rich(u.it, e.id)}</span>` : ''}</span></div>`).join('');
  const note = m && m.note ? `<div class="note">${rich(m.note, e.id)}</div>` : '';
  return `<div class="picks-col only-${mode}"><div class="picks">${rows}</div>${note}</div>`;
}

// Passive: valori ai livelli 1, 10 e 20.
function scaleHtml(e, mode) {
  const m = e[mode];
  const head = (e.scale || []).length ? '<div class="sc hd"><span></span><span>Lv 1</span><span>Lv 10</span><span>Lv 20</span></div>' : '';
  const rows = (e.scale || []).map((s) => `<div class="sc"><span class="lb">${esc(s.label)}</span><span>${esc(s.v[0])}</span><span>${esc(s.v[1])}</span><span>${esc(s.v[2])}</span></div>`).join('');
  const note = m && m.note ? `<div class="note">${rich(m.note, e.id)}</div>` : '';
  return `<div class="picks-col only-${mode}"><div class="scale">${head}${rows}</div>${note}</div>`;
}

function bigHtml(e, mode) {
  const m = e[mode];
  if (!m) return `<div class="lv only-${mode}"><div class="n">&ndash;</div><div class="l">${e.group === 'stigma' ? 'fuori' : 'non serve'}</div></div>`;
  const value = m.level ?? m.rank;
  const label = m.label || (m.rank != null ? 'priorità' : 'livello');
  const o = m.order != null && m.order <= 3 ? `<div class="o">${esc(m.order)}ª da alzare</div>` : (m.state ? `<div class="o">${esc(m.state)}</div>` : '');
  return `<div class="lv only-${mode}"><div class="n">${value == null ? '&ndash;' : esc(value)}</div><div class="l">${esc(label)}</div>${o}</div>`;
}

function rowHtml(e) {
  const ko = e.ko ? `<span class="ko" lang="ko">${esc(e.ko)}</span>` : '';
  const meta = e.meta ? `<div class="meta">${rich(e.meta, e.id)}</div>` : '';
  const uses = MODES.map((m) => (e[m] && e[m].use ? `<div class="use only-${m}">${rich(e[m].use, e.id)}</div>` : '')).join('');
  const right = e.group === 'stigma' ? unlocksHtml : e.group === 'passive' ? scaleHtml : picksHtml;
  const pos = (m, i) => (m ? (m.pos ?? m.order ?? m.rank ?? 50) : 200 + i);
  return `<div class="skill" id="${esc(e.id)}" style="--o-pve:${pos(e.pve, e._i)};--o-pvp:${pos(e.pvp, e._i)}">
  <div class="ico">${iconHtml(e.id, e.name)}</div>
  <div><div class="nm">${esc(e.name)}${ko}</div><div class="sum">${rich(e.sum || '', e.id)}${srcSup(e.src, e.id)}</div>${meta}${uses}<div>${conf(e)}</div></div>
  ${MODES.map((m) => bigHtml(e, m)).join('')}
  ${MODES.map((m) => right(entities.get(e.id), m)).join('')}
</div>`;
}
const rowsHtml = (list) => `<div class="skills">${(list || []).map((e) => rowHtml(entities.get(e.id))).join('\n')}</div>`;

// ---- Macro e rotazioni -----------------------------------------------------------------------
// I tasti del mouse si scrivono per esteso: RMB e LMB non li capisce chi non mastica l'inglese dei giochi.
const KEY_NAMES = { RMB: 'tasto destro', LMB: 'tasto sinistro', MMB: 'rotella' };
const keyName = (k) => KEY_NAMES[k] || k;
function macroLines(mode) {
  const m = (data.macro || {})[mode];
  if (!m) return '';
  const held = (m.hold || []).map((x) => `<span><kbd>${esc(keyName(x.key))}</kbd> ${rich(x.what, 'macro')}</span>`).join('');
  const hold = held ? `<div class="hold only-${mode}"><b>Tieni premuti</b>${held}</div>` : '';
  const lines = (m.lines || []).map((ln) => {
    // I dati elencano gli slot per priorità (il primo parte per primo). Nel gioco quello slot sta in basso:
    // la pila si disegna come la si vede sulla barra, dall'alto in basso, con il numero di priorità.
    const slots = ln.slots.map((s, i) => ({ ...s, p: i + 1 })).reverse().map((s) => {
      const e = ent(s.skill, `macro ${mode}`);
      return `<li class="${s.p === 1 ? 'first' : ''}"><span class="p">${s.p}</span><span>${esc(e.name)}</span><span class="tag">${esc(s.tag || '')}</span></li>`;
    }).join('');
    return `<div class="mline"><div class="hd"><span class="ttl">${esc(ln.title)} ${ln.key ? `<kbd>${esc(keyName(ln.key))}</kbd>` : ''}</span><span class="dl">${esc(ln.delay || '')}</span></div><ol>${slots}</ol>${ln.why ? `<div class="why">${rich(ln.why, 'macro')}</div>` : ''}</div>`;
  }).join('');
  return `${hold}<div class="macro only-${mode}">${lines}</div>`;
}
function manualList(mode) {
  const m = (data.macro || {})[mode];
  if (!m || !(m.manual || []).length) return '';
  const items = m.manual.map((x) => `<li><strong>${esc(ent(x.skill, `macro ${mode}`).name)}</strong>${x.key ? ` <kbd>${esc(keyName(x.key))}</kbd>` : ''}: ${rich(x.when, 'macro')}</li>`).join('');
  return `<ul class="plain only-${mode}">${items}</ul>`;
}
function seqHtml(steps, where) {
  return `<div class="seq">${steps.map((st, i) => {
    const arrow = i ? '<span class="ar" aria-hidden="true">&rarr;</span>' : '';
    if (st.text) return `${arrow}<span class="st${st.hold ? ' hold' : ''}">&nbsp;${rich(st.text, where)}</span>`;
    const e = ent(st.skill, where);
    const ico = iconHtml(e.id, e.name);
    return `${arrow}<span class="st${st.hold ? ' hold' : ''}"><span class="i">${ico}</span>${esc(e.name)}${st.note ? ` <small>${rich(st.note, where)}</small>` : ''}</span>`;
  }).join('')}</div>`;
}
function rotations(mode, onlySheet) {
  const list = ((data.rotations || {})[mode] || []).filter((r) => !onlySheet || r.sheet);
  return list.map((r) => `<div class="rot only-${mode}"><h4>${esc(r.title)}${srcSup(r.src, r.title)}</h4>${r.when ? `<div class="when">${rich(r.when, r.title)}</div>` : ''}${seqHtml(r.steps, `rotazione ${r.title}`)}${r.expl ? `<div class="expl">${rich(r.expl, r.title)}</div>` : ''}${conf(r)}</div>`).join('\n');
}

// ---- Schermate del gioco ---------------------------------------------------------------------
// Una schermata con i numeri sopra i punti da guardare e la legenda sotto. L'immagine sta in data/shots
// e finisce dentro la pagina, che deve aprirsi anche senza rete. Le posizioni dei numeri sono in percentuale.
const usedShots = new Set();
const skippedShots = new Set();
function figHtml(b, where, cls) {
  const file = join(rootDir, 'data', 'shots', `${b.img}.webp`);
  if (!existsSync(file)) {
    // Le schermate del gioco non sono nel repository: con AION_NO_SHOTS=1 le figure si saltano e il resto dei controlli resta.
    if (process.env.AION_NO_SHOTS === '1') { skippedShots.add(b.img); return ''; }
    return fail(`${where}: manca la schermata data/shots/${b.img}.webp (senza schermate: AION_NO_SHOTS=1)`);
  }
  if (!(b.w > 0 && b.h > 0)) return fail(`${where}: la schermata ${b.img} non ha larghezza e altezza`);
  if (!b.alt || !b.credit) return fail(`${where}: la schermata ${b.img} non ha descrizione o fonte`);
  const marks = b.marks || [];
  const legend = b.legend || [];
  if (legend.length && new Set(marks.map((m) => m.n)).size !== legend.length) fail(`${where}: nella schermata ${b.img} numeri e voci della legenda non corrispondono`);
  for (const m of marks) if (!(m.x >= 0 && m.x <= 100 && m.y >= 0 && m.y <= 100)) fail(`${where}: nella schermata ${b.img} il numero ${m.n} è fuori dall'immagine`);
  usedShots.add(b.img); // l'immagine entra nella pagina una volta sola, come classe: la stessa foto può comparire in più punti
  const dots = marks.map((m) => `<span class="mk" style="left:${m.x}%;top:${m.y}%">${esc(m.n)}</span>`).join('');
  const items = legend.map((x) => `<li><div>${rich(x, where)}</div></li>`).join('');
  return `<figure class="fig${cls}${b.narrow ? ' narrow' : ''}">
  <div class="shot" style="aspect-ratio:${b.w} / ${b.h}"><div class="shimg sh-${esc(b.img)}" role="img" aria-label="${esc(b.alt)}"></div>${dots}</div>
  <figcaption>${b.cap ? `<div class="cap">${rich(b.cap, where)}</div>` : ''}${items ? `<ol class="lg">${items}</ol>` : ''}<div class="cr">${rich(b.credit, where)}</div></figcaption>
</figure>`;
}

// ---- Blocchi generici ------------------------------------------------------------------------
function blocks(list, where) {
  return (list || []).map((b) => {
    const cls = b.mode && b.mode !== 'both' ? ` only-${b.mode}` : '';
    switch (b.t) {
      case 'h3': return `<h3 class="${cls.trim()}">${rich(b.x, where)}</h3>`;
      case 'p': return `<p class="${cls.trim()}">${rich(b.x, where)}</p>`;
      case 'note': return `<p class="note${cls}">${rich(b.x, where)}</p>`;
      case 'list': return `<ul class="plain${cls}">${b.items.map((x) => `<li>${rich(x, where)}</li>`).join('')}</ul>`;
      // il testo sta in un solo contenitore: la riga è una griglia, e ogni grassetto sciolto diventerebbe una cella a sé
      case 'steps': return `<ol class="steps${cls}">${b.items.map((x) => `<li><div>${rich(x, where)}</div></li>`).join('')}</ol>`;
      case 'callout': return `<div class="callout ${esc(b.kind || '')}${cls}">${b.title ? `<span class="t">${esc(b.title)}</span>` : ''}${rich(b.x, where)}</div>`;
      case 'seq': return `<div class="${cls.trim()}">${seqHtml(b.steps, where)}</div>`;
      case 'fig': return figHtml(b, where, cls);
      // tre riquadri con le frecce: chi fa cosa, da sinistra a destra
      case 'flow': return `<div class="flow${cls}">${b.items.map((it, i) => `${i ? '<span class="fa" aria-hidden="true">&rarr;</span>' : ''}<div class="fb"><span class="fk">${esc(it.k)}</span><div>${rich(it.x, where)}</div></div>`).join('')}</div>`;
      case 'table': {
        const num = new Set(b.num || []);
        const head = b.head.map((h, i) => `<th class="${num.has(i) ? 'num' : ''}">${esc(h)}</th>`).join('');
        const body = b.rows.map((r) => `<tr>${r.map((c, i) => `<td class="${num.has(i) ? 'num' : i === 0 ? 'k' : ''}">${rich(c, where)}</td>`).join('')}</tr>`).join('');
        return `<div class="tblwrap${cls}"><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
      }
      // Le passive della classe, ognuna con che cosa farne e il livello a cui la tengono i primi: dagli stessi numeri
      // (lib/passive-tiers.mjs). Una tabella per modo, perché in PvP si cercano altre passive.
      case 'passives': return MODES.map((mode) => {
        const rows = passiveTiers(data, mode);
        if (!rows) return fail(`${where}: mancano i livelli dei primi per le passive (campi top e gear nei dati della classe)`);
        const body = rows.map((r) => `<tr><td class="k">${esc(r.name)}</td><td>${esc(tierSays(r))}</td><td class="num">${esc(String(r.top).replace('.', ','))}</td></tr>`).join('');
        return `<div class="tblwrap only-${mode}"><table><thead><tr><th>Passiva</th><th>Che cosa farne</th><th class="num">I primi ${esc((data.levels || {}).players || '')}</th></tr></thead><tbody>${body}</tbody></table></div>`;
      }).join('\n');
      default: return fail(`${where}: blocco sconosciuto "${b.t}"`);
    }
  }).join('\n');
}

// ---- Pagina ----------------------------------------------------------------------------------
const meta = data.meta || {};
const sections = [];
const add = (id, nav, title, html) => { if (html && html.trim()) sections.push({ id, nav, title, html }); };

// Percorso guidato: una cosa per schermata, con la foto e cosa cliccare. È la prima cosa della pagina.
// I capitoli sono gli argomenti (la macro, le skill, le stigma...), ognuno con i suoi passi.
function pathHtml(path) {
  const chapters = path.chapters;
  const seen = new Set();
  // Con un capitolo PvP (mode: 'pvp') i percorsi sono due: i capitoli PvP si vedono solo in PvP, gli altri solo in PvE,
  // e ognuno conta i suoi da 1 (hub.js salta quelli nascosti). Senza capitoli PvP il percorso è uno solo, come prima.
  if (chapters.some((c) => c.mode && !['pve', 'pvp'].includes(c.mode))) fail('percorso: un capitolo ha un modo che non è pve o pvp');
  const twoPaths = chapters.some((c) => c.mode === 'pvp');
  const modeOf = (c) => (!twoPaths ? '' : c.mode === 'pvp' ? 'pvp' : 'pve');
  const count = { '': 0, pve: 0, pvp: 0 };
  const num = chapters.map((c) => { count[modeOf(c)] += 1; return count[modeOf(c)]; });
  const only = (c) => (modeOf(c) ? ` class="only-${modeOf(c)}" data-mode="${modeOf(c)}"` : '');
  const chips = chapters.map((c, i) => `<button type="button" data-ch="${i}"${only(c)}><span>${num[i]}</span>${esc(c.nav)}</button>`).join('');
  const body = chapters.map((c, ci) => {
    if (!(c.steps || []).length) fail(`percorso: il capitolo "${c.id}" non ha passi`);
    const tabs = c.steps.map((s, i) => `<button type="button" data-go="${i}"><span>${i + 1}</span>${esc(s.nav)}</button>`).join('');
    const panels = c.steps.map((s, i) => {
      const key = `${c.id}/${s.id}`;
      if (seen.has(key)) fail(`percorso: passo doppio ${key}`);
      seen.add(key);
      return `<article class="pstep" data-step="${i}" hidden>
  <div class="pn">${esc(c.nav)}, passo ${i + 1} di ${c.steps.length}</div>
  <h3>${rich(s.title, 'percorso')}</h3>
  ${blocks(s.blocks, `percorso ${key}`)}
  ${s.check ? `<div class="pcheck"><b>È giusto se</b> ${rich(s.check, 'percorso')}</div>` : ''}
</article>`;
    }).join('\n');
    return `<div class="chapter" data-chapter="${ci}"${modeOf(c) ? ` data-mode="${modeOf(c)}"` : ''} hidden>
  <div class="pbar">${tabs}</div>
  ${panels}
</div>`;
  }).join('\n');
  return `<div class="path" data-path>
  <div class="chapters">${chips}</div>
  ${body}
  <div class="pnav"><button type="button" data-prev>Indietro</button><button type="button" data-next class="primary">Avanti</button></div>
</div>`;
}
if (data.path && (data.path.chapters || []).length) add('percorso', data.path.nav, data.path.title, pathHtml(data.path));

if ((data.todo || []).length) {
  const items = data.todo.map((t) => {
    const cls = t.mode && t.mode !== 'both' ? ` class="only-${t.mode}"` : '';
    const link = t.href ? ` <a href="${esc(t.href)}">Vai</a>` : '';
    return `<li${cls}><input type="checkbox" id="${esc(t.id)}" aria-label="Fatto: ${esc(t.what)}"><div class="body"><div class="what">${rich(t.what, t.id)}${link}</div><div class="why">${rich(t.why || '', t.id)}</div></div></li>`;
  }).join('\n');
  add('adesso', 'Da fare adesso', meta.todoTitle || 'Da fare adesso, in ordine', `${blocks(data.todoIntro, 'adesso')}<ol class="todo">${items}</ol>`);
}

const sheet = MODES.map((m) => `${macroLines(m)}${manualList(m) ? `<h3 class="only-${m}">A mano, fuori dalla macro</h3>${manualList(m)}` : ''}${rotations(m, true)}`).join('');
add('scheda', 'Scheda rapida', meta.sheetTitle || 'Scheda rapida', `${blocks(data.sheetIntro, 'scheda')}${sheet}`);

if (data.class) add('classe', 'La classe', data.class.title || 'Come funziona il Gladiator', blocks(data.class.blocks, 'classe'));
if ((data.skills || []).length) add('skill', 'Skill', meta.skillsTitle || 'Skill attive', `${blocks(data.skillsIntro, 'skill')}${rowsHtml(data.skills)}`);
if ((data.stigma || []).length) add('stigma', 'Stigma', meta.stigmaTitle || 'Stigma', `${blocks(data.stigmaIntro, 'stigma')}${rowsHtml(data.stigma)}`);
if ((data.passive || []).length) add('passive', 'Passive', meta.passiveTitle || 'Skill passive', `${blocks(data.passiveIntro, 'passive')}${rowsHtml(data.passive)}`);
if (data.macro) add('macro', 'Macro', data.macro.title || 'Macro: come si impostano', `${blocks(data.macro.blocks, 'macro')}${MODES.map((m) => `${macroLines(m)}${blocks((data.macro[m] || {}).blocks, 'macro')}`).join('')}`);
if (data.rotations) add('rotazioni', 'Rotazioni', data.rotations.title || 'Rotazioni', `${blocks(data.rotations.blocks, 'rotazioni')}${MODES.map((m) => rotations(m, false)).join('')}`);
for (const s of data.sections || []) add(s.id, s.nav, s.title, blocks(s.blocks, s.id));
if ((data.glossary || []).length) {
  const rows = data.glossary.map((g) => `<tr><td class="k">${esc(g.en)}</td><td lang="ko">${esc(g.ko || '')}</td><td>${rich(g.it, 'glossario')}</td></tr>`).join('');
  add('glossario', 'Glossario', 'Glossario: inglese, coreano, cosa vuol dire', `<div class="tblwrap"><table><thead><tr><th>Nel gioco</th><th>In coreano</th><th>Cosa vuol dire</th></tr></thead><tbody>${rows}</tbody></table></div>`);
}
if ((data.verify || []).length) add('verifica', 'Da controllare in gioco', data.verifyTitle || 'Da controllare in gioco', `${blocks(data.verifyIntro, 'verifica')}<ul class="plain">${data.verify.map((v) => `<li>${rich(v, 'verifica')}</li>`).join('')}</ul>`);
if ((data.sources || []).length) {
  const items = data.sources.map((s, i) => `<li id="fonte-${i + 1}"><div><strong>${esc(s.label)}</strong> <span class="d">${esc([s.kind, s.region, s.date].filter(Boolean).join(' · '))}</span><br>${s.url ? `<a href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">${esc(s.url)}</a>` : ''}${s.note ? `<div class="d">${rich(s.note, 'fonti')}</div>` : ''}</div></li>`).join('\n');
  add('fonti', 'Fonti', 'Fonti', `${blocks(data.sourcesIntro, 'fonti')}<ol class="sources">${items}</ol>`);
}

const nav = `<nav class="nav" aria-label="Sezioni">
  <div class="nav-title">${esc(meta.navTitle || 'Gladiator')}</div>
  <div class="mode" role="group" aria-label="Contenuto da mostrare"><button type="button" data-mode="pve" aria-pressed="true">PvE</button><button type="button" data-mode="pvp" aria-pressed="false">PvP</button></div>
  <ol>${sections.map((s) => `<li><a href="#${esc(s.id)}">${esc(s.nav)}</a></li>`).join('')}</ol>
  <div class="nav-meta"><b>${esc(meta.stamp || '')}</b>${esc(meta.stampNote || '')}</div>
</nav>`;
const facts = (meta.facts || []).map((f) => `<span>${rich(f, 'meta')}</span>`).join('');
const main = `<main>
  <header class="hero"><h1>${esc(meta.h1 || 'Gladiator')}</h1><p class="lead">${rich(meta.lead || '', 'meta')}</p><div class="facts">${facts}</div></header>
  ${sections.map((s) => `<section class="sec" id="${esc(s.id)}"><h2>${esc(s.title)}</h2>${s.html}</section>`).join('\n')}
</main>`;

if (problems.length) {
  console.error(`Dati incoerenti, pagina NON generata (${problems.length}):\n- ${problems.join('\n- ')}`);
  process.exit(1);
}

const shotCss = [...usedShots].map((name) => `.sh-${name}{background-image:url(data:image/webp;base64,${readFileSync(join(rootDir, 'data', 'shots', `${name}.webp`)).toString('base64')})}`).join('\n');
const iconCss = `${[...usedIcons].map((id) => `.ic-${id}{background-image:url(${iconUri(id)})}`).join('\n')}\n${shotCss}`;
const title = esc(meta.title || 'Hub Gladiator AION 2');
const body = `<div class="layout">${nav}${main}</div>\n<script>\n${js}\n</script>`;
const fragment = `<meta charset="utf-8">\n<title>${title}</title>\n<style>\n${css}\n${iconCss}\n</style>\n${body}\n`;
const full = `<!doctype html>\n<html lang="it" data-mode="pve">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n<meta name="robots" content="noindex, nofollow">\n<title>${title}</title>\n<style>\n${css}\n${iconCss}\n</style>\n</head>\n<body>\n${body}\n</body>\n</html>\n`;
const outDir = process.argv[3] ? resolve(process.argv[3]) : here;
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'index.html'), full, 'utf8');
writeFileSync(join(outDir, 'artifact.html'), fragment, 'utf8');
if (skippedShots.size) console.log(`attenzione: ${skippedShots.size} schermate del gioco saltate (AION_NO_SHOTS=1)`);
console.log(`ok: ${sections.length} sezioni, ${entities.size} voci, ${srcIndex.size} fonti, ${(full.length / 1024).toFixed(0)} KB`);
