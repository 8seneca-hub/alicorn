import { oklch, contrast } from './color.mjs';
// Reduce chroma until the colour is renderable in sRGB. Hue and lightness are the
// design decision; chroma is the one that has to give.
function fit(L,C,H){
  let c=C; while(c>0 && !oklch(L,c,H).inGamut) c=+(c-0.002).toFixed(4);
  return { ...oklch(L,c,H), L, C:c, H, clamped:c<C };
}
const H_N=264, H_A=73, H_D=22;
const N=[[1,.145,.004],[2,.178,.005],[3,.213,.006],[4,.243,.007],[5,.271,.008],[6,.305,.009],
         [7,.349,.010],[8,.424,.011],[9,.551,.010],[10,.611,.009],[11,.742,.007],[12,.955,.003]];
const A=[[3,.272,.052],[6,.392,.096],[9,.774,.162],[11,.842,.132]];
const D=[[3,.262,.062],[6,.386,.112],[9,.640,.212],[11,.752,.158]];
const mk=(steps,H)=>Object.fromEntries(steps.map(([s,L,C])=>[s,fit(L,C,H)]));
const n=mk(N,H_N), a=mk(A,H_A), d=mk(D,H_D);
const show=(name,ramp)=>{console.log(`── ${name} ──`);
  for(const s of Object.keys(ramp)){const v=ramp[s];
    console.log(`  ${String(s).padStart(2)}  ${v.hex}  oklch(${v.L} ${v.C} ${v.H})${v.clamped?'  [chroma clamped to gamut]':''}`);}};
show('neutral',n); show('amber',a); show('red',d);
const pairs=[
 ['text-primary  n12 / page n1',   n[12],n[1],4.5],
 ['text-secondary n11 / page n1',  n[11],n[1],4.5],
 ['text-tertiary n10 / page n1',   n[10],n[1],4.5],
 ['text-primary  n12 / surface n3',n[12],n[3],4.5],
 ['text-secondary n11 / surface n3',n[11],n[3],4.5],
 ['on-solid n1 / solid n12',       n[1],n[12],4.5],
 ['focus-ring n11 / page n1',      n[11],n[1],3.0],
 ['border n7 / page n1',           n[7],n[1],1.0],
 ['attention a11 / page n1',       a[11],n[1],4.5],
 ['attention a11 / amber a3',      a[11],a[3],4.5],
 ['attention solid a9 / page n1',  a[9],n[1],3.0],
 ['on-attention n1 / a9',          n[1],a[9],4.5],
 ['danger d11 / page n1',          d[11],n[1],4.5],
 ['danger solid d9 / page n1',     d[9],n[1],3.0],
];
console.log('\n── measured contrast (WCAG 2.1, computed from the declared tokens) ──');
let fail=0;
for(const [label,fg,bg,min] of pairs){
  const r=contrast(fg.rgb,bg.rgb), ok=r>=min; if(!ok)fail++;
  console.log(`  ${ok?'PASS':'FAIL'} ${r.toFixed(2).padStart(6)}:1  min ${String(min).padEnd(3)} ${label}`);
}
console.log(fail?`\n${fail} FAILING`:'\nall measured pairs pass');
import { writeFileSync } from 'fs';
writeFileSync('ramps.json', JSON.stringify({neutral:n,amber:a,red:d},null,1));
