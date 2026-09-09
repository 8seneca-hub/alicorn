/* Router. Targets live in markup (data-go / data-tab / data-sheet / data-href /
 * data-popback) because flow-check.mjs reads markup — a link built in JS is
 * invisible to it, and to grep. */
;(function () {
  var el = document.currentScript
  // data-nav is [{id, label}] — flow-check.mjs reads `.id`, so keep that shape.
  var NAV = JSON.parse(el.getAttribute('data-nav') || '[]').map(function (t) {
    return t.id
  })
  var HOME = el.getAttribute('data-home')

  function frames() {
    return Array.prototype.slice.call(document.querySelectorAll('.frame'))
  }

  // Per-frame overrides. One page can host several applications side by side
  // (the review shell does), and each has its own root and its own tab set —
  // so a global home would send the launcher to a screen it does not have.
  function homeOf(frame) {
    return frame.getAttribute('data-home') || HOME
  }
  function navOf(frame) {
    var raw = frame.getAttribute('data-nav')
    if (!raw) {
      return NAV
    }
    try {
      return JSON.parse(raw).map(function (t) {
        return t.id
      })
    } catch {
      return NAV
    }
  }

  // Per-frame stack, so back returns inside the application the user is in.
  var stacks = new WeakMap()

  function show(frame, id, opts) {
    var scrs = frame.querySelectorAll('[data-scr]')
    for (var i = 0; i < scrs.length; i++) {
      scrs[i].setAttribute('data-active', String(scrs[i].getAttribute('data-scr') === id))
    }
    // An entry point sets the owner: derive the highlighted section from the
    // ROUTE, never from the control that was clicked.
    var nav = navOf(frame)
    var owner = nav.includes(id) ? id : (opts && opts.owner) || id
    var marks = frame.querySelectorAll('[data-navfor]')
    for (var j = 0; j < marks.length; j++) {
      marks[j].setAttribute('aria-current', String(marks[j].getAttribute('data-navfor') === owner))
    }
    var st = stacks.get(frame) || []
    if (opts && opts.push) {
      st.push(id)
    } else {
      st = [id]
    }
    stacks.set(frame, st)
  }

  function sheet(frame, id, open) {
    var w = frame.querySelector(`[data-sheetwrap="${id}"]`)
    if (w) {
      w.setAttribute('data-open', String(open))
    }
  }

  document.addEventListener('click', function (e) {
    var t = e.target.closest('[data-go],[data-tab],[data-sheet],[data-sheetclose],[data-popback]')
    if (!t) {
      return
    }
    var frame = t.closest('.frame')
    if (!frame) {
      return
    }
    e.preventDefault()

    if (t.hasAttribute('data-sheet')) {
      sheet(frame, t.getAttribute('data-sheet'), true)
      return
    }
    if (t.hasAttribute('data-sheetclose')) {
      sheet(frame, t.getAttribute('data-sheetclose'), false)
      return
    }
    if (t.hasAttribute('data-popback')) {
      var st = stacks.get(frame) || []
      st.pop()
      show(frame, st.at(-1) || homeOf(frame))
      return
    }
    if (t.hasAttribute('data-tab')) {
      show(frame, t.getAttribute('data-tab'))
      return
    }
    // A pushed screen keeps the owning section highlighted.
    show(frame, t.getAttribute('data-go'), {
      push: true,
      owner: t.getAttribute('data-owner') || undefined
    })
  })

  frames().forEach(function (f) {
    if (f.querySelector('[data-scr]')) {
      show(f, homeOf(f))
    }
  })
})()
