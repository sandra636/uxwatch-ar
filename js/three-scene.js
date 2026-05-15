'use strict';

class ThreeScene {
  constructor(canvasEl) {
    this.canvas       = canvasEl;
    this.width        = 0;
    this.height       = 0;
    this.renderer     = null;
    this.scene        = null;
    this.camera       = null;
    this.watches      = [];
    this.currentWatch = 0;
    this.watchGroup   = null;
    this.debugSphere  = null;  // sphère de test
    this.targetPos    = new THREE.Vector3();
    this.targetQuat   = new THREE.Quaternion();
    this.currentPos   = new THREE.Vector3();
    this.currentQuat  = new THREE.Quaternion();
    this.watchVisible = false;
    this.smoothAlpha  = 0.25;
    this.scaleTarget  = 1.0;
    this.scaleSmooth  = 1.0;
    this.mixers       = [];
    this.clock        = new THREE.Clock();
    this.fpsEl        = document.getElementById('fps-counter');
    this.lastFpsTime  = performance.now();
    this.frameCount   = 0;
    this._init();
  }

  _init() {
    this.renderer = new THREE.WebGLRenderer({
      canvas:          this.canvas,
      alpha:           true,
      antialias:       true,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.outputEncoding      = THREE.sRGBEncoding;
    this.renderer.toneMapping         = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.4;

    this.scene  = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(45, 1, 0.01, 100);
    this.camera.position.set(0, 0, 5);

    this._setupLights();
    this._onResize();
    window.addEventListener('resize', () => this._onResize(), { passive: true });

    // Sphère rouge de debug — toujours visible pour tester le positionnement
    const sphere = new THREE.Mesh(
      new THREE.SphereGeometry(0.15, 16, 16),
      new THREE.MeshStandardMaterial({ color: '#ff0000', metalness: 0.3, roughness: 0.4 })
    );
    sphere.visible = false;
    this.scene.add(sphere);
    this.debugSphere = sphere;

    this._loadAllWatches();
  }

  _setupLights() {
    this.scene.add(new THREE.AmbientLight(0xffffff, 1.5));
    const key = new THREE.DirectionalLight(0xffeedd, 2.5);
    key.position.set(2, 4, 3);
    this.scene.add(key);
    const fill = new THREE.DirectionalLight(0xc9e0ff, 1.0);
    fill.position.set(-3, 2, -2);
    this.scene.add(fill);
    const rim = new THREE.PointLight(0xc9a96e, 2.0, 10);
    rim.position.set(0, -2, 3);
    this.scene.add(rim);
  }

  _loadAllWatches() {
    if (typeof THREE.GLTFLoader === 'undefined') {
      console.error('❌ GLTFLoader non disponible !');
      WATCH_CATALOG.forEach((def, i) => {
        const m = this._makeFallbackWatch(i);
        m.visible = false;
        this.scene.add(m);
        this.watches[i] = m;
        if (i === 0) this.watchGroup = m;
      });
      return;
    }

    const loader = new THREE.GLTFLoader();

    WATCH_CATALOG.forEach((def, i) => {
      console.log(`⏳ Chargement ${def.path}…`);

      loader.load(
        def.path,
        (gltf) => {
          const model = gltf.scene;

          // Centrer et normaliser
          const box    = new THREE.Box3().setFromObject(model);
          const center = box.getCenter(new THREE.Vector3());
          const size   = box.getSize(new THREE.Vector3());
          const maxDim = Math.max(size.x, size.y, size.z);
          const s      = 1.0 / maxDim;

          model.scale.setScalar(s);
          model.position.sub(center.multiplyScalar(s));
          model.rotation.x = Math.PI / 2;

          model.traverse(child => {
            if (child.isMesh) {
              child.castShadow    = true;
              child.receiveShadow = true;
              if (child.material) {
                child.material.side        = THREE.DoubleSide;
                child.material.needsUpdate = true;
              }
            }
          });

          model.visible = false; // caché par défaut, affiché par updateWristPose
          this.scene.add(model);
          this.watches[i] = model;

          if (gltf.animations && gltf.animations.length > 0) {
            const mixer = new THREE.AnimationMixer(model);
            gltf.animations.forEach(clip => mixer.clipAction(clip).play());
            this.mixers[i] = mixer;
          }

          if (i === 0) {
            this.watchGroup = model;
            console.log('✅ watch1.glb chargée avec succès');
          } else {
            console.log(`✅ Montre ${i+1} chargée`);
          }
        },
        (xhr) => {
          if (xhr.total > 0)
            console.log(`Montre ${i+1}: ${Math.round(xhr.loaded/xhr.total*100)}%`);
        },
        (err) => {
          console.error(`❌ Erreur montre ${i+1} (${def.path}):`, err);
          const fallback = this._makeFallbackWatch(i);
          fallback.visible = false;
          this.scene.add(fallback);
          this.watches[i] = fallback;
          if (i === 0) {
            this.watchGroup = fallback;
            console.warn('⚠️ Montre fallback activée');
          }
        }
      );
    });
  }

  _makeFallbackWatch(index) {
    const colors = [
      { body:'#c9a84c', face:'#f5f0e8', bezel:'#a8892f', strap:'#3d2b1f' },
      { body:'#aaaaaa', face:'#e8e8e8', bezel:'#888888', strap:'#222222' },
      { body:'#333333', face:'#111111', bezel:'#555555', strap:'#000000' },
    ];
    const c = colors[index] || colors[0];
    const g = new THREE.Group();
    const bezelMat = new THREE.MeshStandardMaterial({color:c.bezel,metalness:0.9,roughness:0.1});
    const faceMat  = new THREE.MeshStandardMaterial({color:c.face, metalness:0,  roughness:0.4});
    const strapMat = new THREE.MeshStandardMaterial({color:c.strap,metalness:0,  roughness:0.9});
    const bodyMat  = new THREE.MeshStandardMaterial({color:c.body, metalness:0.8,roughness:0.2});
    const bz = new THREE.Mesh(new THREE.CylinderGeometry(0.55,0.55,0.20,48),bezelMat);
    bz.rotation.x = Math.PI/2; g.add(bz);
    const face = new THREE.Mesh(new THREE.CircleGeometry(0.47,48),faceMat);
    face.position.z = 0.11; g.add(face);
    const st = new THREE.Mesh(new THREE.BoxGeometry(0.48,0.85,0.09),strapMat);
    st.position.y = 0.90; g.add(st);
    const sb = new THREE.Mesh(new THREE.BoxGeometry(0.48,0.85,0.09),strapMat);
    sb.position.y = -0.90; g.add(sb);
    const hm = new THREE.MeshStandardMaterial({color:c.body,metalness:0.6,roughness:0.3});
    const hh = new THREE.Mesh(new THREE.BoxGeometry(0.04,0.28,0.04),hm);
    hh.position.set(-0.04,0.11,0.13); g.add(hh);
    const mh = new THREE.Mesh(new THREE.BoxGeometry(0.03,0.40,0.04),hm);
    mh.position.set(0.05,0.17,0.13); g.add(mh);
    const sm = new THREE.MeshStandardMaterial({color:'#e63946'});
    const sh = new THREE.Mesh(new THREE.BoxGeometry(0.02,0.44,0.04),sm);
    sh.position.z = 0.135; g.add(sh);
    const ctr = new THREE.Mesh(new THREE.CylinderGeometry(0.04,0.04,0.06,12),bodyMat);
    ctr.rotation.x = Math.PI/2; ctr.position.z = 0.13; g.add(ctr);
    return g;
  }

  _onResize() {
    const viewport = this.canvas.parentElement;
    if (!viewport) return;
    this.width  = viewport.clientWidth;
    this.height = viewport.clientHeight;
    this.renderer.setSize(this.width, this.height);
    this.canvas.style.width  = this.width  + 'px';
    this.canvas.style.height = this.height + 'px';
    this.camera.aspect = this.width / this.height;
    this.camera.updateProjectionMatrix();
  }

  switchWatch(index) {
    if (this.watches[this.currentWatch]) {
      this.watches[this.currentWatch].visible = false;
    }
    this.currentWatch = index;
    if (this.watches[index]) {
      this.watchGroup         = this.watches[index];
      this.watchGroup.visible = this.watchVisible;
    } else {
      const iv = setInterval(() => {
        if (this.watches[index]) {
          this.watchGroup         = this.watches[index];
          this.watchGroup.visible = this.watchVisible;
          clearInterval(iv);
        }
      }, 100);
    }
  }

  updateWristPose(pose) {
    if (!pose) {
      this.watchVisible = false;
      if (this.watchGroup)  this.watchGroup.visible  = false;
      if (this.debugSphere) this.debugSphere.visible = false;
      return;
    }
    this.watchVisible = true;
    this.targetPos.copy(pose.position);
    this.targetQuat.copy(pose.quaternion);
    this.scaleTarget = pose.scale;

    // Sphère debug suit aussi le poignet
    if (this.debugSphere) {
      this.debugSphere.position.copy(pose.position);
      this.debugSphere.visible = true;
    }
  }

  render() {
    const delta = this.clock.getDelta();
    this.mixers.forEach(m => m && m.update(delta));

    if (this.watchGroup) {
      if (this.watchVisible) {
        this.currentPos.lerp(this.targetPos, this.smoothAlpha);
        this.currentQuat.slerp(this.targetQuat, this.smoothAlpha * 0.85);
        this.scaleSmooth += (this.scaleTarget - this.scaleSmooth) * 0.15;

        this.watchGroup.position.copy(this.currentPos);
        this.watchGroup.quaternion.copy(this.currentQuat);
        this.watchGroup.scale.setScalar(this.scaleSmooth);
        this.watchGroup.visible = true;
      } else {
        this.watchGroup.visible = false;
      }
    }

    this.renderer.render(this.scene, this.camera);

    this.frameCount++;
    const now = performance.now();
    if (now - this.lastFpsTime >= 1000) {
      if (this.fpsEl) this.fpsEl.textContent =
        Math.round(this.frameCount * 1000 / (now - this.lastFpsTime)) + ' FPS';
      this.frameCount  = 0;
      this.lastFpsTime = now;
    }
  }
}