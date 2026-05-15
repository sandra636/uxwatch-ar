'use strict';

class ThreeScene {
  constructor(canvasEl) {
    this.canvas       = canvasEl;
    this.width        = 0;
    this.height       = 0;
    this.renderer     = null;
    this.scene        = null;
    this.camera       = null;
    this.watches      = [];          // modèles chargés
    this.loadedFlags  = [];          // true quand GLB prêt
    this.currentWatch = 0;
    this.watchGroup   = null;        // modèle actif
    this.targetPos    = new THREE.Vector3();
    this.targetQuat   = new THREE.Quaternion();
    this.currentPos   = new THREE.Vector3();
    this.currentQuat  = new THREE.Quaternion();
    this.watchVisible = false;
    this.smoothAlpha  = 0.22;
    this.scaleSmooth  = 1.0;
    this.mixers       = [];
    this.clock        = new THREE.Clock();
    this.fpsEl        = document.getElementById('fps-counter');
    this.lastFpsTime  = performance.now();
    this.frameCount   = 0;
    this._init();
  }

  _init() {
    // ── Renderer ──
    this.renderer = new THREE.WebGLRenderer({
      canvas:          this.canvas,
      alpha:           true,          // fond transparent → vidéo visible
      antialias:       true,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setClearColor(0x000000, 0);   // transparent
    this.renderer.shadowMap.enabled       = true;
    this.renderer.outputEncoding          = THREE.sRGBEncoding;
    this.renderer.toneMapping             = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure     = 1.4;

    // ── Scène ──
    this.scene = new THREE.Scene();

    // ── Caméra ──
    this.camera = new THREE.PerspectiveCamera(45, 1, 0.01, 100);
    this.camera.position.set(0, 0, 5);

    // ── Lumières ──
    this._setupLights();

    // ── Resize ──
    this._onResize();
    window.addEventListener('resize', () => this._onResize(), { passive: true });

    // ── Chargement GLB ──
    this._loadAllWatches();
  }

  _setupLights() {
    this.scene.add(new THREE.AmbientLight(0xfff8f0, 0.9));

    const key = new THREE.DirectionalLight(0xffeedd, 2.2);
    key.position.set(2, 4, 3);
    key.castShadow = true;
    this.scene.add(key);

    const fill = new THREE.DirectionalLight(0xc9e0ff, 0.9);
    fill.position.set(-3, 2, -2);
    this.scene.add(fill);

    const rim = new THREE.PointLight(0xc9a96e, 1.8, 8);
    rim.position.set(0, -2, 2);
    this.scene.add(rim);
  }

  _loadAllWatches() {
    // GLTFLoader est chargé dans le <head> — disponible immédiatement
    if (!THREE.GLTFLoader) {
      console.error('GLTFLoader introuvable ! Vérifie le script dans index.html');
      return;
    }

    const loader = new THREE.GLTFLoader();

    WATCH_CATALOG.forEach((def, i) => {
      this.loadedFlags[i] = false;

      loader.load(
        def.path,

        // ── Succès ──
        (gltf) => {
          const model = gltf.scene;

          // Centrer le modèle
          const box    = new THREE.Box3().setFromObject(model);
          const center = box.getCenter(new THREE.Vector3());
          const size   = box.getSize(new THREE.Vector3());
          const maxDim = Math.max(size.x, size.y, size.z);
          const scale  = 1.0 / maxDim;

          model.scale.setScalar(scale);
          model.position.sub(center.multiplyScalar(scale));

          // Orientation : face vers la caméra, cadran vers le haut
          model.rotation.x = Math.PI / 2;

          // Ombres
          model.traverse(child => {
            if (child.isMesh) {
              child.castShadow    = true;
              child.receiveShadow = true;
            }
          });

          // Invisible par défaut sauf montre 0
          model.visible = (i === 0);

          this.scene.add(model);
          this.watches[i]     = model;
          this.loadedFlags[i] = true;

          // Animations intégrées
          if (gltf.animations && gltf.animations.length > 0) {
            const mixer = new THREE.AnimationMixer(model);
            gltf.animations.forEach(clip => mixer.clipAction(clip).play());
            this.mixers[i] = mixer;
          }

          // La première montre devient le groupe actif
          if (i === 0) {
            this.watchGroup = model;
            console.log('✅ watch1.glb chargée');
          }

          console.log(`✅ Montre ${i + 1} (${def.name}) chargée`);
        },

        // ── Progression ──
        (xhr) => {
          if (xhr.total > 0) {
            const pct = Math.round((xhr.loaded / xhr.total) * 100);
            console.log(`Montre ${i + 1} : ${pct}%`);
          }
        },

        // ── Erreur ──
        (err) => {
          console.error(`❌ Erreur chargement montre ${i + 1} (${def.path}) :`, err);
          // Fallback : montre procédurale si GLB introuvable
          const fallback = this._makeFallbackWatch(i);
          fallback.visible = (i === 0);
          this.scene.add(fallback);
          this.watches[i]     = fallback;
          this.loadedFlags[i] = true;
          if (i === 0) this.watchGroup = fallback;
          console.warn(`⚠️ Montre ${i + 1} remplacée par fallback`);
        }
      );
    });
  }

  // Montre procédurale de secours si le GLB ne charge pas
  _makeFallbackWatch(index) {
    const colors = [
      { body: '#c9a84c', face: '#f5f0e8', bezel: '#a8892f', strap: '#3d2b1f' },
      { body: '#aaaaaa', face: '#e8e8e8', bezel: '#888888', strap: '#222222' },
      { body: '#222222', face: '#111111', bezel: '#444444', strap: '#000000' },
    ];
    const c = colors[index] || colors[0];
    const g = new THREE.Group();

    const bezelMat = new THREE.MeshStandardMaterial({ color: c.bezel, metalness: 0.9, roughness: 0.1 });
    const faceMat  = new THREE.MeshStandardMaterial({ color: c.face,  metalness: 0,   roughness: 0.5 });
    const strapMat = new THREE.MeshStandardMaterial({ color: c.strap, metalness: 0,   roughness: 0.9 });
    const bodyMat  = new THREE.MeshStandardMaterial({ color: c.body,  metalness: 0.8, roughness: 0.2 });

    // Boîtier
    const bz = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 0.20, 48), bezelMat);
    bz.rotation.x = Math.PI / 2; g.add(bz);
    // Cadran
    const face = new THREE.Mesh(new THREE.CircleGeometry(0.47, 48), faceMat);
    face.position.z = 0.11; g.add(face);
    // Bracelets
    const st = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.85, 0.09), strapMat);
    st.position.y = 0.90; g.add(st);
    const sb = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.85, 0.09), strapMat);
    sb.position.y = -0.90; g.add(sb);
    // Aiguilles
    const hm = new THREE.MeshStandardMaterial({ color: c.body, metalness: 0.6, roughness: 0.3 });
    const hh = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.28, 0.04), hm);
    hh.position.set(-0.04, 0.11, 0.13); g.add(hh);
    const mh = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.40, 0.04), hm);
    mh.position.set(0.05, 0.17, 0.13); g.add(mh);
    const sm = new THREE.MeshStandardMaterial({ color: '#e63946' });
    const sh = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.44, 0.04), sm);
    sh.position.z = 0.135; g.add(sh);
    const ctr = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.06, 12), bodyMat);
    ctr.rotation.x = Math.PI / 2; ctr.position.z = 0.13; g.add(ctr);

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
    // Cacher l'ancienne
    if (this.watches[this.currentWatch]) {
      this.watches[this.currentWatch].visible = false;
    }
    this.currentWatch = index;
    // Afficher la nouvelle si chargée
    if (this.watches[index]) {
      this.watchGroup         = this.watches[index];
      this.watchGroup.visible = this.watchVisible;
    } else {
      // Pas encore chargée — attendre
      const waitInterval = setInterval(() => {
        if (this.watches[index]) {
          this.watchGroup         = this.watches[index];
          this.watchGroup.visible = this.watchVisible;
          clearInterval(waitInterval);
        }
      }, 200);
    }
  }

  updateWristPose(pose) {
    if (!pose) {
      this.watchVisible = false;
      return;
    }
    this.watchVisible = true;
    this.targetPos.copy(pose.position);
    this.targetQuat.copy(pose.quaternion);
    this.scaleSmooth += (pose.scale - this.scaleSmooth) * 0.15;
  }

  render() {
    if (!this.watchGroup) return;

    const delta = this.clock.getDelta();
    this.mixers.forEach(m => m && m.update(delta));

    if (this.watchVisible) {
      this.currentPos.lerp(this.targetPos, this.smoothAlpha);
      this.currentQuat.slerp(this.targetQuat, this.smoothAlpha * 0.8);
      this.watchGroup.position.copy(this.currentPos);
      this.watchGroup.quaternion.copy(this.currentQuat);
      this.watchGroup.scale.setScalar(this.scaleSmooth);
      this.watchGroup.visible = true;
    } else {
      this.watchGroup.visible = false;
    }

    this.renderer.render(this.scene, this.camera);

    // FPS counter
    this.frameCount++;
    const now = performance.now();
    if (now - this.lastFpsTime >= 1000) {
      const fps = Math.round(this.frameCount * 1000 / (now - this.lastFpsTime));
      if (this.fpsEl) this.fpsEl.textContent = fps + ' FPS';
      this.frameCount  = 0;
      this.lastFpsTime = now;
    }
  }
}