// oklch -> oklab -> linear sRGB -> sRGB, then WCAG 2.1 contrast. No estimates.
const f=(t)=>t<=0.0031308?12.92*t:1.055*Math.pow(t,1/2.4)-0.055;
export function oklch(L,C,H){
  const h=H*Math.PI/180, a=C*Math.cos(h), b=C*Math.sin(h);
  const l_=L+0.3963377774*a+0.2158037573*b,
        m_=L-0.1055613458*a-0.0638541728*b,
        s_=L-0.0894841775*a-1.2914855480*b;
  const l=l_**3, m=m_**3, s=s_**3;
  const r= 4.0767416621*l-3.3077115913*m+0.2309699292*s,
        g=-1.2684380046*l+2.6097574011*m-0.3413193965*s,
        bb=-0.0041960863*l-0.7034186147*m+1.7076147010*s;
  const cl=(v)=>Math.max(0,Math.min(1,v));
  const inGamut = r>=-0.001&&r<=1.001&&g>=-0.001&&g<=1.001&&bb>=-0.001&&bb<=1.001;
  const R=Math.round(f(cl(r))*255),G=Math.round(f(cl(g))*255),B=Math.round(f(cl(bb))*255);
  return { hex:'#'+[R,G,B].map(v=>v.toString(16).padStart(2,'0')).join(''), rgb:[R,G,B], inGamut };
}
const lin=(c)=>{c/=255;return c<=0.04045?c/12.92:Math.pow((c+0.055)/1.055,2.4);};
export const lum=([r,g,b])=>0.2126*lin(r)+0.7152*lin(g)+0.0722*lin(b);
export const contrast=(a,b)=>{const [x,y]=[lum(a),lum(b)].sort((p,q)=>q-p);return (x+0.05)/(y+0.05);};
