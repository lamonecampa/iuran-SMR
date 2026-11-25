(() => {
const menuButton=document.querySelector('.menu-toggle'),nav=document.querySelector('.main-nav');
if(menuButton&&nav){menuButton.addEventListener('click',()=>{const opened=nav.classList.toggle('open');menuButton.setAttribute('aria-expanded',String(opened));menuButton.setAttribute('aria-label',opened?'Tutup menu':'Buka menu');});nav.querySelectorAll('a').forEach(a=>a.addEventListener('click',()=>{nav.classList.remove('open');menuButton.setAttribute('aria-expanded','false');}));}
const items=document.querySelectorAll('.reveal');
if('IntersectionObserver'in window){const observer=new IntersectionObserver(entries=>entries.forEach(entry=>{if(entry.isIntersecting){entry.target.classList.add('visible');observer.unobserve(entry.target);}}),{threshold:.12});items.forEach(item=>observer.observe(item));}else{items.forEach(item=>item.classList.add('visible'));}
const year=document.getElementById('year');if(year)year.textContent=new Date().getFullYear();
})();