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
    this.targetPos    = new THREE.Vector3();
    this.targetQuat   = new THREE.Quaternion();
    this.currentPos   = new THREE.Vector3();
    this.currentQuat  = new THREE.Quaternion();
    this.watchVisible = false;
    this.smoothAlpha  = 0.22;
    this.scaleSmooth  = 1.0;
    this.lastFpsTime  = performance.now();
    this.frameCount   = 0;
    this.fpsEl        = document.getElementById('fps-counter');
    this.mixers       = [];
    this.clock        = new THREE.Clock();
    this._init();
  }

  _init() {
    // Renderer
    this.renderer = new THREE.WebGLRenderer({
      canvas:    this.canvas,
      alpha:     true,
      antialias: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.outputEncoding    = THREE.sRGBEncoding;
    this.renderer.toneMapping       = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.4;

    // Scene
    this.scene = new THREE.Scene();

    // Camera
    this.camera = new THREE.PerspectiveCamera(45, 1, 0.01, 100);
    this.camera.position.set(0, 0, 5);

    // Lumières
    this._setupLights();

    // Resize
    this._onResize();
    window.addEventListener('resize', () => this._onResize(), { passive: true });

    // Charger les montres GLB
    this._loadAllWatches();
  }

  _setupLights() {
    this.scene.add(new THREE.AmbientLight(0xfff8f0, 0.8));

    const key = new THREE.DirectionalLight(0xffeedd, 2.0);
    key.position.set(2, 4, 3);
    key.castShadow = true;
    this.scene.add(key);

    const fill = new THREE.DirectionalLight(0xc9e0ff, 0.8);
    fill.position.set(-3, 2, -2);
    this.scene.add(fill);

    const rim = new THREE.PointLight(0xc9a96e, 1.5, 8);
    rim.position.set(0, -2, 2);
    this.scene.add(rim);
  }

  _loadAllWatches() {
    // Charger GLTFLoader depuis CDN
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/loaders/GLTFLoader.js';
    script.onload = () => {
      const loader = new THREE.GLTFLoader();
      WATCH_CATALOG.forEach((def, i) => {
        loader.load(
          def.path,
          (gltf) => {
            const model = gltf.scene;
            model.visible = (i === 0);

            // Centrer et ajuster la taille
            const box = new THREE.Box3().setFromObject(model);
            const center = box.getCenter(new THREE.Vector3());
            const size = box.getSize(new THREE.Vector3());
            const maxDim = Math.max(size.x, size.y, size.z);
            const scale = 1.0 / maxDim;

            model.scale.setScalar(scale);
            model.position.sub(center.multiplyScalar(scale));

            // Orientation correcte sur le poignet
            model.rotation.x = Math.PI / 2;

            this.scene.add(model);
            this.watches[i] = model;

            // Animations si présentes
            if (gltf.animations && gltf.animations.length > 0) {
              const mixer = new THREE.AnimationMixer(model);
              gltf.animations.forEach(clip => mixer.clipAction(clip).play());
              this.mixers[i] = mixer;
            }

            if (i === 0) {
              this.watchGroup = model;
              console.log('Montre 1 chargée ✅');
            }
          },
          (progress) => {
            console.log(`Montre ${i+1}: ${Math.round(progress.loaded/progress.total*100)}%`);
          },
          (error) => {
            console.error(`Erreur chargement montre ${i+1}:`, error);
          }
        );
      });
    };
    document.head.appendChild(script);
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
    if (!this.watches[this.currentWatch]) return;
    this.watches[this.currentWatch].visible = false;
    this.currentWatch = index;
    if (this.watches[index]) {
      this.watchGroup = this.watches[index];
      this.watchGroup.visible = true;
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

    // Mettre à jour les animations GLB
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

    // FPS
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