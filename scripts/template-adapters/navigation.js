// Public bridge for template-native keyboard navigation, preserving counters and lazy charts.
export function templateNavigation(){
  if(typeof window.deck?.show==='function'||typeof window.presentation?.showSlide==='function')return;
  const stage=document.querySelector('deck-stage');if(stage&&typeof stage.goTo==='function'){window.presentation={get slides(){return [...stage.children].filter(n=>n.matches('section,.slide'));},showSlide:index=>stage.goTo(index)};return;}
  const slides=[...document.querySelectorAll('.slide')];if(!slides.length)return;
  window.presentation={slides,showSlide(index){
    index=Math.max(0,Math.min(slides.length-1,index));
    let current=slides.findIndex(n=>n.matches('.active,.is-active,.visible,.present'));
    if(current<0){const dots=[...document.querySelectorAll('.nav-dot,.dot')];current=dots.findIndex(n=>n.classList.contains('active'));}
    if(current<0){const positions=slides.map(n=>Math.abs(n.getBoundingClientRect().top));current=positions.indexOf(Math.min(...positions));}
    const key=index>current?'ArrowRight':'ArrowLeft';for(let n=0;n<Math.abs(index-current);n++)document.dispatchEvent(new KeyboardEvent('keydown',{key,bubbles:true}));
  }};
}
