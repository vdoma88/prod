// Image and object editing extension for landing-editor.js. No remote images or HTML injection.
(() => {
  'use strict';
  const srcOK = s => typeof s === 'string' && (
    /^\/account\/media\/[a-f0-9]{64}\.(?:jpg|png|webp)$/.test(s) ||
    /^\/?assets\/(?!.*\.\.)[a-z0-9_./-]+\.(?:jpg|jpeg|png|webp)(?:\?v=[a-z0-9._-]+)?$/i.test(s));
  const mk = (tag,cls,text) => { const e=document.createElement(tag); if(cls)e.className=cls; if(text!=null)e.textContent=text; return e; };
  const copy = o => JSON.parse(JSON.stringify(o));
  const equals = (a,b) => a===b || (!!a && !!b && Object.keys(a).length===Object.keys(b).length && Object.keys(a).every(k=>a[k]===b[k]));
  const blockQuery = 'main > section,main .bc-service,main .service-card,main .course-card,main .portal-entry,main .format-card,main .start-card,main .home-course';
  function keyOf(node) {
    const path=[];
    for(let e=node;e && e!==document.body;e=e.parentElement) {
      if(e.id && /^[a-z][a-z0-9_-]*$/i.test(e.id)){path.unshift('#'+e.id);break;}
      let nth=1;
      for(let p=e.previousElementSibling;p;p=p.previousElementSibling) if(p.localName===e.localName) nth++;
      path.unshift(e.localName+':nth-of-type('+nth+')');
    }
    return path.join('>');
  }
  const labelOf=(node)=>String(node.getAttribute('alt') || node.querySelector?.('h2,h3,strong')?.textContent || node.getAttribute('aria-label') || node.id || node.localName).replace(/\s+/g,' ').trim().slice(0,64);
  function create() {
    const items=new Map(), initial=new Map();
    let saved={},draft={},lost={},selected='', panel, holder,controls,chooser,info,notify=()=>{},onChange=()=>{},inputs={};
    function collect() {
      const nodes=[...document.querySelectorAll('header img,main img,footer img,header svg,main svg,footer svg'),...document.querySelectorAll(blockQuery)];
      for(const node of nodes) {
        if(node.closest('dialog,#bc-service-detail,[data-sr-noedit]'))continue;
        const type=node.localName==='img'?'image':node.localName==='svg'?'svg':'block';
        const key='@'+type+':'+keyOf(node);
        if(items.has(key)||key.length>248)continue;
        const base=type==='image'?(node.getAttribute('src')||''):node.localName+'#'+(node.id||'')+'.'+[...node.classList].filter(c=>!['is-visible','is-open'].includes(c)).join('.');
        if(type==='image'&&!base)continue;
        const record={node,key,type,base,src:base,alt:node.getAttribute('alt')||'',label:(type==='image'?'Изображение: ':type==='svg'?'Графика: ':'Блок: ')+labelOf(node),
          srcset:node.getAttribute('srcset'),
          sources:type==='image'&&node.parentElement?.localName==='picture'?[...node.parentElement.querySelectorAll('source')].map(s=>[s,s.getAttribute('srcset')]):[],
          style:{display:node.style.display,transform:node.style.transform,order:node.style.order,fit:node.style.objectFit,position:node.style.objectPosition}};
        items.set(key,record);
        const value={type,base,hidden:false,zoom:100,x:0,y:0,order:0};
        if(type==='image')Object.assign(value,{src:base,alt:record.alt,fit:['cover','contain','fill'].includes(record.style.fit)?record.style.fit:'cover',focusX:50,focusY:50});
        initial.set(key,value);
      }
    }
    function applyOne(record, value) {
      const e=record.node, orig=record.style, v=value||initial.get(record.key);
      if(record.type==='image') {
        const source=srcOK(v.src)?v.src:record.src;
        if(source!==record.src) {
          e.removeAttribute('srcset');
          record.sources.forEach(([s])=>s.removeAttribute('srcset'));
        } else {
          if(record.srcset==null)e.removeAttribute('srcset'); else e.setAttribute('srcset',record.srcset);
          record.sources.forEach(([s,text])=>{if(text==null)s.removeAttribute('srcset');else s.setAttribute('srcset',text);});
        }
        if(e.getAttribute('src')!==source)e.setAttribute('src',source);
        e.alt=v.alt;
        e.style.objectFit=v.fit;
        e.style.objectPosition=v.focusX+'% '+v.focusY+'%';
      }
      e.style.display=v.hidden?'none':orig.display;
      const offset=v.x||v.y||v.zoom!==100;
      e.style.transform=offset?(orig.transform?orig.transform+' ':'')+'translate('+v.x+'px, '+v.y+'px) scale('+(v.zoom/100)+')':orig.transform;
      e.style.order=v.order?String(v.order):orig.order;
    }
    function apply(){items.forEach((record,key)=>applyOne(record,draft[key]));}
    function load(changes) {
      saved={};lost={};
      for(const [key,value] of Object.entries(changes||{})) {
        if(!key.startsWith('@'))continue;
        const item=items.get(key);
        if(item && value && value.base===item.base && value.type===item.type)saved[key]=copy(value);
        else lost[key]=value;
      }
      draft=copy(saved);apply();updateChooser();
    }
    function diff(){return [...new Set([...Object.keys(saved),...Object.keys(draft)])].filter(k=>!equals(saved[k],draft[k])).length;}
    function payload(){return {...lost,...draft};}
    function cancel(){draft=copy(saved);apply();refresh();}
    function select(key){
      selected=items.has(key)?key:'';
      items.forEach((item,id)=>item.node.classList.toggle('sr-visual-selected',selected===id));
      refresh();
    }
    function set(name,value){
      if(!selected)return;
      const item=items.get(selected);
      const next={...(draft[selected]||initial.get(selected)),[name]:value};
      if(equals(next,initial.get(selected)))delete draft[selected]; else draft[selected]=next;
      applyOne(item,draft[selected]);
      onChange();
    }
    async function optimize(file){
      if(!file || !['image/jpeg','image/png','image/webp'].includes(file.type))throw Error('Выберите JPG, PNG или WebP.');
      if(file.size>15*1024*1024)throw Error('Исходный файл должен быть меньше 15 МБ.');
      const url=URL.createObjectURL(file);
      try {
        const image=await new Promise((ok,bad)=>{const img=new Image();img.onload=()=>ok(img);img.onerror=()=>bad(Error('Не удалось открыть фотографию.'));img.src=url;});
        const ratio=Math.min(1,2200/Math.max(image.naturalWidth,image.naturalHeight));
        const canvas=document.createElement('canvas');
        canvas.width=Math.max(1,Math.round(image.naturalWidth*ratio));
        canvas.height=Math.max(1,Math.round(image.naturalHeight*ratio));
        const ctx=canvas.getContext('2d');if(!ctx)throw Error('Не удалось обработать изображение.');
        ctx.drawImage(image,0,0,canvas.width,canvas.height);
        let blob;
        for(const quality of [.85,.65,.5]) {
          blob=await new Promise(ok=>canvas.toBlob(ok,'image/webp',quality));
          if(blob && blob.size<=3*1024*1024)break;
        }
        if(!blob || blob.size>3*1024*1024)throw Error('После оптимизации фото больше 3 МБ.');
        return await new Promise((ok,bad)=>{const reader=new FileReader();reader.onload=()=>ok(reader.result);reader.onerror=()=>bad(Error('Не удалось прочитать файл.'));reader.readAsDataURL(blob);});
      } finally {URL.revokeObjectURL(url);}
    }
    function labelled(text,control){const label=mk('label','',text);label.append(control);return label;}
    function slider(name,min,max,step){const e=mk('input');e.type='range';e.min=min;e.max=max;e.step=step;e.addEventListener('input',()=>set(name,Number(e.value)));return e;}
    function updateChooser(){
      if(!chooser)return;
      chooser.replaceChildren();
      const empty=mk('option','','Выберите изображение или объект…');empty.value='';chooser.append(empty);
      items.forEach((item,key)=>{const option=mk('option','',item.label);option.value=key;chooser.append(option);});
      chooser.value=selected;
    }
    function refresh(){
      if(!controls)return;
      controls.hidden=!selected;
      if(!selected)return;
      chooser.value=selected;
      const item=items.get(selected), value=draft[selected]||initial.get(selected);
      info.textContent=item.label+(value.hidden?' — скрыто':'');
      for(const [key,input] of Object.entries(inputs)){
        if(key==='file'||key.endsWith('Wrap'))continue;
        if(input.type==='checkbox')input.checked=value[key];else input.value=value[key];
      }
      inputs.file.value='';
      inputs.imageWrap.hidden=item.type!=='image';
      inputs.altWrap.hidden=item.type!=='image';
      inputs.cropWrap.hidden=item.type!=='image';
      inputs.orderWrap.hidden=item.type!=='block'||!item.node.parentElement?.matches('.bc-grid,.service-grid,.format-grid,.courses-grid,.portal-grid,.cards-grid');
    }
    function enable(options) {
      panel=options.panel;onChange=options.changed;notify=options.message;
      holder=mk('section','sr-visual-editor');
      holder.append(mk('h3','','🖼 Фото и объекты'),mk('p','sr-copy-muted','Выберите фото, графику или блок на странице либо в списке. После правок нажмите общую кнопку «Опубликовать».'));
      chooser=mk('select');chooser.setAttribute('aria-label','Выбрать визуальный элемент');
      updateChooser();chooser.addEventListener('change',()=>select(chooser.value));holder.append(chooser);
      controls=mk('div','sr-visual-options');controls.hidden=true;
      info=mk('p','sr-copy-muted');controls.append(info);
      inputs.hidden=mk('input');inputs.hidden.type='checkbox';inputs.hidden.addEventListener('change',()=>set('hidden',inputs.hidden.checked));
      controls.append(labelled('Скрыть выбранный элемент ',inputs.hidden));
      for(const [name,label,min,max,step] of [['zoom','Масштаб, %',50,180,5],['x','Смещение вправо / влево, px',-80,80,5],['y','Смещение вниз / вверх, px',-80,80,5]]){
        inputs[name]=slider(name,min,max,step);controls.append(labelled(label,inputs[name]));
      }
      inputs.order=mk('select');
      [['0','Без изменений'],['-1','На первое место'],['1','В конец']].forEach(([v,t])=>{const option=mk('option','',t);option.value=v;inputs.order.append(option);});
      inputs.order.addEventListener('change',()=>set('order',Number(inputs.order.value)));
      inputs.orderWrap=labelled('Порядок карточки',inputs.order);controls.append(inputs.orderWrap);
      inputs.alt=mk('input');inputs.alt.type='text';inputs.alt.maxLength=300;inputs.alt.addEventListener('change',()=>set('alt',inputs.alt.value));
      inputs.altWrap=labelled('Описание фото для доступности',inputs.alt);controls.append(inputs.altWrap);
      inputs.fit=mk('select');
      [['cover','Обрезать по рамке'],['contain','Вместить целиком'],['fill','Растянуть']].forEach(([v,t])=>{const option=mk('option','',t);option.value=v;inputs.fit.append(option);});
      inputs.fit.addEventListener('change',()=>set('fit',inputs.fit.value));
      inputs.focusX=slider('focusX',0,100,5);inputs.focusY=slider('focusY',0,100,5);
      inputs.cropWrap=mk('div','sr-visual-crop');
      inputs.cropWrap.append(labelled('Размещение внутри рамки',inputs.fit),labelled('Фокус по горизонтали, %',inputs.focusX),labelled('Фокус по вертикали, %',inputs.focusY));
      controls.append(inputs.cropWrap);
      inputs.file=mk('input');inputs.file.type='file';inputs.file.accept='image/jpeg,image/png,image/webp';
      inputs.imageWrap=labelled('Заменить фото (JPG, PNG, WebP)',inputs.file);
      const upload=mk('button','sr-copy-primary','Загрузить изображение');upload.type='button';
      upload.addEventListener('click',async()=>{
        if(items.get(selected)?.type!=='image')return;
        const file=inputs.file.files[0];if(!file){notify('Выберите фотографию.',true);return;}
        upload.disabled=true;notify('Оптимизирую и загружаю фото…');
        try{
          const image=await optimize(file);
          const result=await options.api('/account/api/admin/landing/media',{image});
          set('src',result.url);notify('Фотография загружена. Нажмите «Опубликовать», чтобы посетители увидели изменение.');
        }catch(error){notify(error.message,true);}
        finally{upload.disabled=false;}
      });
      inputs.imageWrap.append(upload);controls.append(inputs.imageWrap);
      const reset=mk('button','','Исходный вид');reset.type='button';
      reset.addEventListener('click',()=>{if(!selected)return;delete draft[selected];applyOne(items.get(selected));refresh();onChange();notify('В предпросмотре восстановлен исходный элемент.');});
      controls.append(reset);holder.append(controls);
      panel.insertBefore(holder,panel.querySelector('.sr-copy-stale-box'));
      document.addEventListener('click',event=>{
        if(event.target.closest?.('[data-sr-copy-key]'))return;
        const target=event.target.closest?.('[data-sr-visual-key]');
        if(!target||panel.contains(target)||!items.has(target.dataset.srVisualKey))return;
        event.preventDefault();event.stopImmediatePropagation();select(target.dataset.srVisualKey);
      },true);
      items.forEach((item,key)=>{item.node.dataset.srVisualKey=key;item.node.classList.add('sr-visual-target');});
      document.documentElement.classList.add('sr-visual-editing');
    }
    collect();
    return {load,diff,payload,cancel,enable,refresh};
  }
  window.SRLandingVisual={create};
})();
