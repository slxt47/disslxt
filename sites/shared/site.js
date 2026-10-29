// disslxt-Seiten: Kopfzeile bekommt beim Scrollen eine Linie, Abschnitte blenden sanft ein,
// in der Hilfe filtert das Suchfeld die Themen. Keine Cookies, kein Speicher, keine Anfragen.
(function () {
  'use strict';
  var root = document.documentElement;
  var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  var top = document.querySelector('.top');
  if (top) {
    var onScroll = function () {
      top.classList.toggle('scrolled', window.scrollY > 8);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  }

  if (!reduced && 'IntersectionObserver' in window) {
    root.classList.add('js');
    var io = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (e) {
          if (e.isIntersecting) {
            e.target.classList.add('in');
            io.unobserve(e.target);
          }
        });
      },
      { rootMargin: '0px 0px -8% 0px' },
    );
    document.querySelectorAll('.reveal').forEach(function (el) {
      io.observe(el);
    });
  }

  // Hilfe: Themen nach Suchbegriff filtern (Titel und Text der Abschnitte).
  var search = document.getElementById('hilfe-suche');
  if (search) {
    var topics = Array.prototype.slice.call(document.querySelectorAll('.topic'));
    var links = Array.prototype.slice.call(document.querySelectorAll('.toc a'));
    var empty = document.getElementById('keine-treffer');
    var norm = function (s) {
      return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    };
    var texts = topics.map(function (t) {
      return norm(t.textContent || '');
    });
    search.addEventListener('input', function () {
      var words = norm(search.value).split(/\s+/).filter(Boolean);
      var shown = 0;
      topics.forEach(function (t, i) {
        var hit = words.every(function (w) {
          return texts[i].indexOf(w) !== -1;
        });
        t.hidden = !hit;
        if (hit) shown++;
        var link = links.filter(function (a) {
          return a.getAttribute('href') === '#' + t.id;
        })[0];
        if (link) link.parentElement.hidden = !hit;
      });
      document.querySelectorAll('.topic-group').forEach(function (g) {
        g.hidden = !g.querySelector('.topic:not([hidden])');
      });
      if (empty) empty.hidden = shown !== 0;
    });
  }
})();
