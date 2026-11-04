// The supplied template hard-coded ten slide IDs. Keep its scroll navigation
// while deriving both the destinations and the dot count from the authored DOM.
(() => {
  const container = document.getElementById('slideContainer');
  const slides = [...container.querySelectorAll('.slide')];
  const nav = document.getElementById('navDots');
  const counter = document.getElementById('slideCounter');
  let current = 0;
  const show = index => {
    const next = Math.max(0, Math.min(slides.length - 1, index));
    slides[next]?.scrollIntoView({behavior:'smooth', block:'start'});
    current = next;
    update();
  };
  const dots = slides.map((_, i) => {
    const dot = document.createElement('button');
    dot.className = 'nav-dot'; dot.dataset.slide = String(i+1);
    dot.setAttribute('aria-label', `第 ${i+1} 页`);
    dot.style.padding = '0'; dot.addEventListener('click', () => show(i));
    return dot;
  });
  nav.replaceChildren(...dots);
  function update() {
    dots.forEach((dot,i) => { dot.classList.toggle('active',i===current); dot.setAttribute('aria-current',i===current?'page':'false'); });
    counter.textContent = `${current+1} / ${slides.length}`;
  }
  document.addEventListener('keydown', event => {
    if (event.target.matches?.('input,textarea,select,[contenteditable]')) return;
    const direction = ['ArrowDown','ArrowRight',' ','PageDown'].includes(event.key) ? 1 : ['ArrowUp','ArrowLeft','PageUp'].includes(event.key) ? -1 : 0;
    if (direction || event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      show(event.key==='Home'?0:event.key==='End'?slides.length-1:current+direction);
    }
  });
  const observer = new IntersectionObserver(entries => {
    for (const entry of entries) if (entry.isIntersecting) { current = slides.indexOf(entry.target); update(); }
  }, {root:container,threshold:0.5});
  slides.forEach(slide => observer.observe(slide)); update();
})();
