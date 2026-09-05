/* Reveal on scroll. Content is legible at rest — this only adds the lift.
   Anything already in view on load reveals immediately, so the first frame
   a visitor (or a crawler, or a link preview) sees is complete. */
(function () {
  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var els = [].slice.call(document.querySelectorAll('.reveal'));
  if (reduce || !('IntersectionObserver' in window)) {
    els.forEach(function (el) { el.classList.add('in'); });
    return;
  }
  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (e) {
      if (!e.isIntersecting) return;
      e.target.classList.add('in');
      io.unobserve(e.target);
    });
  }, { rootMargin: '0px 0px -8% 0px', threshold: 0.05 });
  els.forEach(function (el) { io.observe(el); });

  /* Count up a value once it is on screen. Digits are tabular in CSS so the
     layout does not shift while it runs. */
  var counters = [].slice.call(document.querySelectorAll('[data-count]'));
  var co = new IntersectionObserver(function (entries) {
    entries.forEach(function (e) {
      if (!e.isIntersecting) return;
      var el = e.target, to = parseFloat(el.dataset.count), dec = (el.dataset.dec | 0);
      var pre = el.dataset.pre || '', suf = el.dataset.suf || '', t0 = null;
      function step(ts) {
        if (t0 === null) t0 = ts;
        var p = Math.min(1, (ts - t0) / 900);
        var eased = 1 - Math.pow(1 - p, 3);
        el.textContent = pre + (to * eased).toFixed(dec) + suf;
        if (p < 1) requestAnimationFrame(step);
      }
      requestAnimationFrame(step);
      co.unobserve(el);
    });
  }, { threshold: 0.4 });
  counters.forEach(function (el) {
    if (reduce) { el.textContent = (el.dataset.pre || '') + parseFloat(el.dataset.count).toFixed(el.dataset.dec | 0) + (el.dataset.suf || ''); return; }
    co.observe(el);
  });

  /* Mark the current page in the nav from the URL, so no page can carry a
     stale hard-coded active state. */
  var path = location.pathname.replace(/\/$/, '') || '/index';
  [].slice.call(document.querySelectorAll('.nav__links a')).forEach(function (a) {
    var href = a.getAttribute('href').replace(/\/$/, '');
    if (href === path || (path === '/index' && href === '/')) a.setAttribute('aria-current', 'page');
  });
})();
