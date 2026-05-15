'use strict';

class ThreeScene {
  constructor(canvasEl) {
    this.canvas = canvasEl;
    this.width = 0; this.height = 0;
    this.renderer = null; this.scene = null; this.camera = null;
    this.watches = [null, null, null];
    this.currentWatch = 0; this.watchGroup = null;
    this.targetPos = new THREE.Vector3();
    this.targetQuat = new THREE.Quaternion();
    this.currentPos = new THREE.Vector3();
    this.currentQuat = new THREE.Quaternion();
    this.watchVisible = false;
    this.smoothAlpha = 0.25;
    this.scaleTarget = 1.0; this.scaleSmooth = 1.0;
    this.fpsEl = document.getElementById('fps-counter');
    this.lastFpsTime = performance.now();
    this.frameCount = 0;
    this.loadedCount = 0;
    this.mixers = [];
    this.clock = new THREE.Clock();
    this._init();
  }

  _init() {
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas, alpha: true, antialias: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.outputEncoding = THREE.sRGBEncoding;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.6;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(45, 1, 0.01, 100);
    this.camera.position.set(0, 0, 5);
    this._setupLights();

    // ✅ Montre fallback IMMÉDIATE pendant que les GLB chargent
    const fallback = this._makeFallbackWatch(0);
    fallback.visible = false;
    this.scene.add(fallback);
    this.watches[0] = fallback;
    this.watchGroup  = fallback;
    console.log('Fallback montre 0 prête');

    this._loadAllWatches();
    window.addEventListener('resize', () => this._onResize(), { passive: true });
  }

  _setupLights() {
    this.scene.add(new THREE.AmbientLight(0xffffff, 3.0));
    const key = new THREE.DirectionalLight(0xffeedd, 4.0);
    key.position.set(2, 4, 3); this.scene.add(key);
    const fill = new THREE.DirectionalLight(0xffffff, 2.0);
    fill.position.set(-3, 2, -2); this.scene.add(fill);
    const bot = new THREE.DirectionalLight(0xffffff, 1.5);
    bot.position.set(0, -3, 2); this.scene.add(bot);
  }

  _makeFallbackWatch(index) {
    const colors = [
      { body:'#c9a84c', face:'#f5f0e8', bezel:'#a8892f', strap:'#3d2b1f' },
      { body:'#aaaaaa', face:'#e8e8e8', bezel:'#888888', strap:'#333333' },
      { body:'#222222', face:'#111111', bezel:'#444444', strap:'#000000' },
    ];
    const c = colors[index] || colors[0];
    const g = new THREE.Group();
    const bm = new THREE.MeshStandardMaterial({color:c.bezel, metalness:0.9, roughness:0.1});
    const fm = new THREE.MeshStandardMaterial({color:c.face,  metalness:0,   roughness:0.4});
    const sm = new THREE.MeshStandardMaterial({color:c.strap, metalness:0,   roughness:0.9});
    const hm = new THREE.MeshStandardMaterial({color:c.body,  metalness:0.8, roughness:0.2});
    const bz = new THREE.Mesh(new THREE.CylinderGeometry(0.55,0.55,0.20,48), bm);
    bz.rotation.x = Math.PI/2; g.add(bz);
    const face = new THREE.Mesh(new THREE.CircleGeometry(0.47,48), fm);
    face.position.z = 0.11; g.add(face);
    const st = new THREE.Mesh(new THREE.BoxGeometry(0.48,0.85,0.09), sm);
    st.position.y = 0.90; g.add(st);
    const sb = new THREE.Mesh(new THREE.BoxGeometry(0.48,0.85,0.09), sm);
    sb.position.y = -0.90; g.add(sb);
    const am = new THREE.MeshStandardMaterial({color:c.body, metalness:0.6, roughness:0.3});
    const hh = new THREE.Mesh(new THREE.BoxGeometry(0.04,0.28,0.04), am);
    hh.position.set(-0.04,0.11,0.13); g.add(hh);
    const mh = new THREE.Mesh(new THREE.BoxGeometry(0.03,0.40,0.04), am);
    mh.position.set(0.05,0.17,0.13); g.add(mh);
    const rm = new THREE.MeshStandardMaterial({color:'#e63946'});
    const sh = new THREE.Mesh(new THREE.BoxGeometry(0.02,0.44,0.04), rm);
    sh.position.z = 0.135; g.add(sh);
    const ct = new THREE.Mesh(new THREE.CylinderGeometry(0.04,0.04,0.06,12), hm);
    ct.rotation.x = Math.PI/2; ct.position.z = 0.13; g.add(ct);
    return g;
  }

  forceResize() { this._onResize(); }

  _onResize() {
    const v = this.canvas.parentElement;
    if (!v) return;
    const w = v.clientWidth, h = v.clientHeight;
    if (w === 0 || h === 0) return;
    this.width = w; this.height = h;
    this.renderer.setSize(w, h);
    this.canvas.style.width = w + 'px';
    this.canvas.style.height = h + 'px';
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  _loadAllWatches() {
    const loader = new THREE.GLTFLoader();
    WATCH_CATALOG.forEach((def, i) => {
      loader.load(
        def.path,
        (gltf) => {
          const model = gltf.scene;
          const box    = new THREE.Box3().setFromObject(model);
          const center = box.getCenter(new THREE.Vector3());
          const size   = box.getSize(new THREE.Vector3());
          const maxDim = Math.max(size.x, size.y, size.z);
          const s      = 1.0 / maxDim;
          model.scale.setScalar(s);
          model.position.sub(center.multiplyScalar(s));
          model.traverse(child => {
            if (child.isMesh) {
              child.frustumCulled = false;
              if (child.material) {
                child.material.side = THREE.DoubleSide;
                child.material.needsUpdate = true;
              }
            }
          });
          model.visible = false;

          // Supprimer le fallback de la scène avant de le remplacer
          if (this.watches[i]) {
            this.scene.remove(this.watches[i]);
          }

          this.scene.add(model);
          this.watches[i] = model;
          this.loadedCount++;

          if (gltf.animations && gltf.animations.length > 0) {
            const mixer = new THREE.AnimationMixer(model);
            gltf.animations.forEach(clip => mixer.clipAction(clip).play());
            this.mixers[i] = mixer;
          }

          // Si c'est la montre active, switcher vers le vrai GLB
          if (i === this.currentWatch) {
            this.watchGroup = model;
            this.watchGroup.visible = this.watchVisible;
            console.log('✅ GLB ' + (i+1) + ' remplace fallback, visible=' + this.watchVisible);
          } else {
            console.log('✅ GLB montre ' + (i+1) + ' chargée');
          }
        },
        null,
        (err) => {
          console.error('❌ Erreur GLB ' + (i+1) + ':', err);
          // Garder le fallback
        }
      );
    });
  }

  switchWatch(index) {
    // Cacher toutes
    this.watches.forEach(w => { if (w) w.visible = false; });
    this.currentWatch = index;

    if (this.watches[index]) {
      this.watchGroup = this.watches[index];
      this.watchGroup.visible = this.watchVisible;
    } else {
      // Créer un fallback temporaire
      const fb = this._makeFallbackWatch(index);
      fb.visible = this.watchVisible;
      this.scene.add(fb);
      this.watches[index] = fb;
      this.watchGroup = fb;
    }
  }

  updateWristPose(pose) {
    if (!pose) {
      this.watchVisible = false;
      if (this.watchGroup) this.watchGroup.visible = false;
      return;
    }
    this.watchVisible = true;
    this.targetPos.copy(pose.position);
    this.targetQuat.copy(pose.quaternion);
    this.scaleTarget = pose.scale;
  }

  render() {
    if (this.width === 0 || this.height === 0) this._onResize();

    const delta = this.clock.getDelta();
    this.mixers.forEach(m => m && m.update(delta));

    if (this.watchGroup && this.watchVisible) {
      this.currentPos.lerp(this.targetPos, this.smoothAlpha);
      this.currentQuat.slerp(this.targetQuat, this.smoothAlpha * 0.85);
      this.scaleSmooth += (this.scaleTarget - this.scaleSmooth) * 0.15;
      this.watchGroup.position.copy(this.currentPos);
      this.watchGroup.quaternion.copy(this.currentQuat);
      this.watchGroup.scale.setScalar(this.scaleSmooth);
      this.watchGroup.visible = true;
    } else if (this.watchGroup) {
      this.watchGroup.visible = false;
    }

    this.renderer.render(this.scene, this.camera);

    this.frameCount++;
    const now = performance.now();
    if (now - this.lastFpsTime >= 1000) {
      if (this.fpsEl) this.fpsEl.textContent =
        Math.round(this.frameCount * 1000 / (now - this.lastFpsTime)) + ' FPS';
      this.frameCount = 0;
      this.lastFpsTime = now;
    }
  }
}