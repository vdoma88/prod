import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createServer } from 'node:http';
import { openStore } from '../store.mjs';
import { openLanding } from '../landing.mjs';
import { createApp } from '../app.mjs';
import { openLandingMedia } from '../landing-media.mjs';

const tinyPng = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+nnXQAAAAASUVORK5CYII=';
const pathKey = '@image:#top>div:nth-of-type(1)>img:nth-of-type(1)';
const options = {type:'image',base:'assets/home/hero-courses-960.webp',src:'assets/home/hero-courses-960.webp',
  alt:'Новое фото',fit:'cover',focusX:40,focusY:55,hidden:false,zoom:115,x:10,y:0,order:0};
const blockKey = '@block:#services>div:nth-of-type(1)';
const block = {type:'block',base:'div#.bc-service',hidden:true,zoom:100,x:0,y:0,order:-1};

test('media upload: PNG signature, immutable filename, public read, path traversal rejected', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(),'sr-media-'));
  try {
    const media = openLandingMedia(root);
    const first = media.upload(tinyPng);
    const second = media.upload(tinyPng);
    assert.deepEqual(first,second);
    assert.match(first.url,/^\/account\/media\/[a-f0-9]{64}\.png$/);
    assert.equal(fs.readdirSync(root).length,1);
    assert.throws(()=>media.upload(tinyPng.replace('image/png','image/jpeg')),e=>e.status===400);
    assert.throws(()=>media.upload('data:image/svg+xml;base64,PHN2Zz48c2NyaXB0Pg=='),e=>e.status===400);
    assert.throws(()=>media.upload('data:image/png;base64,!!!'),e=>e.status===400);
    assert.throws(()=>media.upload('data:image/png;base64,'+'AAAA'.repeat(1048600)),e=>e.status===413);
    let result,body;
    const res={writeHead:(status,headers)=>{result={status,headers};},end:b=>{body=b;}};
    media.serve({method:'GET'},res,first.url.split('/').at(-1));
    assert.equal(result.status,200);
    assert.equal(result.headers['Content-Type'],'image/png');
    assert.equal(result.headers['X-Content-Type-Options'],'nosniff');
    assert.deepEqual(body,Buffer.from(tinyPng.split(',')[1],'base64'));
    assert.throws(()=>media.serve({method:'GET'},res,'../../etc/passwd'),e=>e.status===404);
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});

test('landing media options: validated and stored with text in versioned history', () => {
  const store=openStore(':memory:');
  const landing=openLanding(store.db);
  const changes={[pathKey]:options,[blockKey]:block};
  const published=landing.save('index.html',0,changes,'admin');
  assert.equal(published.revision,1);
  assert.deepEqual(landing.get('index.html').changes[pathKey],options);
  assert.deepEqual(landing.get('index.html').changes[blockKey],block);
  landing.save('index.html',1,{},'admin');
  assert.equal(landing.history('index.html').versions[0].revision,1);
  assert.deepEqual(landing.restore('index.html',2,1,'admin').changes[pathKey],options);
  const invalid = patch => assert.throws(()=>landing.save('index.html',3,{[pathKey]:{...options,...patch}},'admin'),e=>e.status===400);
  invalid({src:'https://external.example/image.jpg'});
  invalid({src:'javascript:alert(1)'});
  invalid({src:'assets/../secret.jpg'});
  invalid({alt:'a'.repeat(301)});
  invalid({focusX:120});
  invalid({zoom:999});
  invalid({hidden:'yes'});
  invalid({evil:'<script></script>'});
  assert.throws(()=>landing.save('index.html',3,{'@image:../../private':options},'admin'),e=>e.status===400);
  store.db.close();
});

test('image upload API: only authenticated administrator, same-origin; public image path',async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'sr-site-media-'));
  const store=openStore(':memory:');
  const admin=store.createUser({name:'Администратор',email:'admin@example.com',role:'admin'});
  const student=store.createUser({name:'Ученица',email:'student@example.com'});
  const srv=createServer(createApp({store,env:{PUBLIC_ORIGIN:'https://belayarod.ru',ACCOUNTS_MEDIA_DIR:root}}));
  await new Promise(ok=>srv.listen(0,'127.0.0.1',ok));
  t.after(()=>new Promise(ok=>srv.close(()=>{store.db.close();fs.rmSync(root,{recursive:true,force:true});ok();})));
  const base='http://127.0.0.1:'+srv.address().port;
  const send = (token,origin='https://belayarod.ru')=>fetch(base+'/account/api/admin/landing/media',{
    method:'POST',headers:{Origin:origin,Cookie:'sr_session='+token,'X-SR':'1','Content-Type':'application/json'},
    body:JSON.stringify({image:tinyPng})
  });
  const studentToken=store.createSession(student.id).token;
  const adminToken=store.createSession(admin.id).token;
  assert.equal((await send('')).status,401);
  assert.equal((await send(studentToken)).status,403);
  assert.equal((await send(adminToken,'https://other.example')).status,403);
  const done=await send(adminToken);
  assert.equal(done.status,201);
  const uploaded=await done.json();
  const publicImage=await fetch(base+uploaded.url);
  assert.equal(publicImage.status,200);
  assert.equal(publicImage.headers.get('content-type'),'image/png');
  assert.equal((await fetch(base+'/account/media/nope.svg')).status,404);
});
