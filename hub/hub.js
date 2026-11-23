(function () {
  var root = document.documentElement;
  var KEY = 'aion2-hub:';

  function read(k) { try { return window.localStorage.getItem(KEY + k); } catch (e) { return null; } }
  function write(k, v) { try { window.localStorage.setItem(KEY + k, v); } catch (e) { /* senza memoria la pagina funziona lo stesso */ } }

  // Interruttore PvE / PvP: cambia livelli, scelte, macro e rotazioni in tutta la pagina.
  var buttons = Array.prototype.slice.call(document.querySelectorAll('.mode button'));
  var onMode = [];
  function setMode(mode, save) {
    if (mode !== 'pve' && mode !== 'pvp') mode = 'pve';
    root.setAttribute('data-mode', mode);
    buttons.forEach(function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-mode') === mode)); });
    if (save) write('mode', mode);
    onMode.forEach(function (fn) { fn(); });
  }
  buttons.forEach(function (b) {
    b.addEventListener('click', function () { setMode(b.getAttribute('data-mode'), true); });
  });
  setMode(read('mode') || 'pve', false);

  // Spunte dei passi da fare: restano su questo dispositivo.
  Array.prototype.slice.call(document.querySelectorAll('ol.todo input[type="checkbox"]')).forEach(function (box) {
    var li = box.closest('li');
    function paint() { if (li) li.classList.toggle('done', box.checked); }
    box.checked = read('todo:' + box.id) === '1';
    paint();
    box.addEventListener('change', function () { write('todo:' + box.id, box.checked ? '1' : '0'); paint(); });
  });

  // Percorso guidato: un argomento alla volta, un passo alla volta. Ricorda dove si era.
  Array.prototype.slice.call(document.querySelectorAll('[data-path]')).forEach(function (box) {
    var list = function (root, sel) { return Array.prototype.slice.call(root.querySelectorAll(sel)); };
    var chapters = list(box, '.chapter');
    var chips = list(box, '[data-ch]');
    var prev = box.querySelector('[data-prev]');
    var next = box.querySelector('[data-next]');
    var ch = 0;
    var st = 0;
    // Con capitoli PvP i percorsi sono due (data-mode sui capitoli): si cammina solo su quelli del modo scelto, e
    // ognuno ricorda il suo punto.
    var two = chapters.some(function (el) { return el.hasAttribute('data-mode'); });
    function open(k) { var m = chapters[k].getAttribute('data-mode'); return !m || m === root.getAttribute('data-mode'); }
    function near(k, dir) { for (var j = k + dir; j >= 0 && j < chapters.length; j += dir) if (open(j)) return j; return -1; }
    function pathKey() { return two ? 'path:' + root.getAttribute('data-mode') : 'path'; }
    function show(c, s, move) {
      ch = Math.max(0, Math.min(chapters.length - 1, c));
      if (!open(ch)) ch = near(-1, 1) < 0 ? 0 : near(-1, 1);
      var steps = list(chapters[ch], '.pstep');
      st = Math.max(0, Math.min(steps.length - 1, s));
      chapters.forEach(function (el, k) { el.hidden = k !== ch; });
      chips.forEach(function (el, k) { if (k === ch) el.setAttribute('aria-current', 'true'); else el.removeAttribute('aria-current'); });
      steps.forEach(function (el, k) { el.hidden = k !== st; });
      list(chapters[ch], '[data-go]').forEach(function (el, k) { if (k === st) el.setAttribute('aria-current', 'step'); else el.removeAttribute('aria-current'); });
      var after = near(ch, 1);
      var first = near(ch, -1) < 0 && st === 0;
      var last = after < 0 && st === steps.length - 1;
      prev.disabled = first;
      next.disabled = last;
      // all'ultimo passo di un argomento, Avanti porta al prossimo e lo dice
      next.textContent = !last && st === steps.length - 1 ? 'Avanti: ' + chips[after].lastChild.textContent : 'Avanti';
      write(pathKey(), ch + ':' + st);
      if (move && box.scrollIntoView) box.scrollIntoView({ block: 'start' });
    }
    chips.forEach(function (el) { el.addEventListener('click', function () { show(Number(el.getAttribute('data-ch')), 0, false); }); });
    chapters.forEach(function (el, c) {
      list(el, '[data-go]').forEach(function (t) { t.addEventListener('click', function () { show(c, Number(t.getAttribute('data-go')), false); }); });
    });
    prev.addEventListener('click', function () {
      var before = near(ch, -1);
      if (st > 0) show(ch, st - 1, true); else if (before >= 0) show(before, list(chapters[before], '.pstep').length - 1, true);
    });
    next.addEventListener('click', function () {
      var after = near(ch, 1);
      if (st < list(chapters[ch], '.pstep').length - 1) show(ch, st + 1, true); else if (after >= 0) show(after, 0, true);
    });
    function restore() {
      var saved = String(read(pathKey()) || '').split(':');
      show(saved.length === 2 ? Number(saved[0]) || 0 : -1, Number(saved[1]) || 0, false);
    }
    if (two) onMode.push(restore);
    restore();
  });

  // Voce di menu attiva mentre si scorre.
  var links = Array.prototype.slice.call(document.querySelectorAll('.nav a[href^="#"]'));
  var byId = {};
  links.forEach(function (a) { byId[a.getAttribute('href').slice(1)] = a; });
  if ('IntersectionObserver' in window && links.length) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (!en.isIntersecting) return;
        links.forEach(function (a) { a.classList.remove('active'); });
        var a = byId[en.target.id];
        if (a) {
          a.classList.add('active');
          if (a.scrollIntoView && window.matchMedia('(max-width: 980px)').matches) {
            a.scrollIntoView({ block: 'nearest', inline: 'center' });
          }
        }
      });
    }, { rootMargin: '-20% 0px -70% 0px' });
    Array.prototype.slice.call(document.querySelectorAll('section.sec')).forEach(function (s) { io.observe(s); });
  }
})();
