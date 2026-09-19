(() => {
  const canvas = document.getElementById('tree-canvas');
  if (!canvas || !window.THREE) return;

  const stage = canvas.parentElement;
  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-5.3, 5.3, 6.0, -6.0, 0.1, 100);
  camera.position.z = 10;

  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.8));
  renderer.setClearColor(0x000000, 0);

  const group = new THREE.Group();
  group.position.set(0.5, -0.2, 0);
  scene.add(group);

  const gold = new THREE.Color('#f4bc58');
  const warm = new THREE.Color('#fff0ad');

  // Halo rings
  [3.7, 4.05].forEach((r, i) => {
    const g = new THREE.RingGeometry(r, r + (i ? .018 : .035), 128);
    const m = new THREE.MeshBasicMaterial({ color: i ? 0xffd27e : 0xffc15e, transparent: true, opacity: i ? .18 : .34, side: THREE.DoubleSide });
    const ring = new THREE.Mesh(g, m);
    ring.position.y = 1.0;
    group.add(ring);
  });

  const segPositions = [];
  const glowPositions = [];

  function branch(x, y, len, angle, depth, spreadSeed = 0) {
    if (depth <= 0 || len < 0.12) return;
    const nx = x + Math.cos(angle) * len;
    const ny = y + Math.sin(angle) * len;
    segPositions.push(x, y, 0, nx, ny, 0);
    glowPositions.push(nx, ny, 0.02);
    const drift = Math.sin((depth + spreadSeed) * 1.7) * 0.05;
    const shrink = 0.73 + (depth % 2) * 0.015;
    branch(nx, ny, len * shrink, angle + 0.43 + drift, depth - 1, spreadSeed + 1.1);
    branch(nx, ny, len * shrink, angle - 0.43 - drift, depth - 1, spreadSeed + 2.2);
    if (depth > 4) branch(nx, ny, len * 0.60, angle + drift * 2, depth - 2, spreadSeed + 3.1);
  }

  segPositions.push(0,-4.2,0, 0,-0.7,0);
  branch(0, -0.75, 1.42, Math.PI/2, 7, .5);
  branch(-0.05,-1.25,1.28,2.05,6,1.5);
  branch(0.05,-1.25,1.28,1.09,6,2.5);

  for (let i=0;i<26;i++) {
    const a = Math.PI + (i/25)*Math.PI;
    const len = 2.0 + (i%4)*0.35;
    const x2 = Math.cos(a)*len;
    const y2 = -4.2 + Math.sin(a)*.9 - (i%3)*0.12;
    segPositions.push(0,-4.15,0, x2,y2,0);
    if (i%2===0) segPositions.push(x2,y2,0,x2*1.18,y2-.18,0);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(segPositions, 3));
  const material = new THREE.LineBasicMaterial({ color: gold, transparent: true, opacity: .92, blending: THREE.AdditiveBlending });
  const lines = new THREE.LineSegments(geometry, material);
  group.add(lines);

  const glowMat = new THREE.LineBasicMaterial({ color: warm, transparent: true, opacity: .19, blending: THREE.AdditiveBlending });
  const glow = new THREE.LineSegments(geometry.clone(), glowMat);
  glow.scale.set(1.025,1.025,1);
  group.add(glow);

  const particleCount = 520;
  const p = new Float32Array(particleCount * 3);
  const base = glowPositions.length/3;
  for (let i=0;i<particleCount;i++) {
    const idx = (i % Math.max(base,1))*3;
    const bx = glowPositions[idx] || 0;
    const by = glowPositions[idx+1] || 0;
    const r = .10 + Math.random()*.45;
    const a = Math.random()*Math.PI*2;
    p[i*3] = bx + Math.cos(a)*r;
    p[i*3+1] = by + Math.sin(a)*r;
    p[i*3+2] = (Math.random()-.5)*.5;
  }
  const pg = new THREE.BufferGeometry();
  pg.setAttribute('position', new THREE.BufferAttribute(p,3));
  const pm = new THREE.PointsMaterial({ color: 0xffd27b, size: .055, transparent:true, opacity:.78, depthWrite:false, blending:THREE.AdditiveBlending });
  const points = new THREE.Points(pg, pm);
  group.add(points);

  const dustCount=160;
  const dustPos=new Float32Array(dustCount*3);
  for(let i=0;i<dustCount;i++){
    dustPos[i*3]=(Math.random()-.5)*10;
    dustPos[i*3+1]=(Math.random()-.5)*11;
    dustPos[i*3+2]=(Math.random()-.5)*3;
  }
  const dg=new THREE.BufferGeometry(); dg.setAttribute('position',new THREE.BufferAttribute(dustPos,3));
  const dm=new THREE.PointsMaterial({color:0xffe5a6,size:.045,transparent:true,opacity:.42,blending:THREE.AdditiveBlending});
  const dust=new THREE.Points(dg,dm); group.add(dust);

  let pointerX=0, pointerY=0, targetX=0, targetY=0;
  window.addEventListener('pointermove', e => {
    targetX = (e.clientX / innerWidth - .5) * .20;
    targetY = (e.clientY / innerHeight - .5) * .14;
  }, {passive:true});

  function resize(){
    const r=stage.getBoundingClientRect();
    renderer.setSize(Math.max(1,r.width),Math.max(1,r.height),false);
  }
  new ResizeObserver(resize).observe(stage); resize();

  const clock = new THREE.Clock();
  function animate(){
    const t=clock.getElapsedTime();
    pointerX += (targetX-pointerX)*.035;
    pointerY += (targetY-pointerY)*.035;
    group.rotation.z = Math.sin(t*.28)*.012 + pointerX;
    group.rotation.x = pointerY*.24;
    points.material.opacity = .69 + Math.sin(t*1.6)*.08;
    dust.rotation.z = t*.008;
    dust.position.y = Math.sin(t*.18)*.12;
    renderer.render(scene,camera);
    requestAnimationFrame(animate);
  }
  animate();
})();
