'use strict';

class ThreeScene {
  constructor(canvasEl) {
    this.canvas = canvasEl;
    this.width = 0; this.height = 0;
    this.renderer = null; this.scene = null; this.camera = null;
    this.watches = []; this.currentWatch = 0; this.watchGroup = null;
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
          const box = new THREE.Box3().setFromObject(model);
          const center = box.getCenter(new THREE.Vector3());
          const size = box.getSize(new THREE.Vector3());
          const maxDim = Math.max(size.x, size.y, size.z);
          const s = 1.0 / maxDim;
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
          this.scene.add(model);
          this.watches[i] = model;
          if (i === 0) {
            this.watchGroup = model;
            console.log('✅ Montre ' + i + ' prête');
          } else {
            console.log('✅ Montre ' + i + ' prête');
          }
        },
        null,
        (err) => { console.error('Erreur GLB ' + i, err); }
      );
    });
  }

  switchWatch(index) {
    if (this.watches[this.currentWatch])
      this.watches[this.currentWatch].visible = false;
    this.currentWatch = index;
    if (this.watches[index]) {
      this.watchGroup = this.watches[index];
      this.watchGroup.visible = this.watchVisible;
    } else {
      const iv = setInterval(() => {
        if (this.watches[index]) {
          if (this.watches[this.currentWatch])
            this.watches[this.currentWatch].visible = false;
          this.watchGroup = this.watches[index];
          this.watchGroup.visible = this.watchVisible;
          clearInterval(iv);
        }
      }, 200);
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