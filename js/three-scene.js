/**
 * three-scene.js
 * Initialisation de la scène Three.js et du renderer
 * Gère l'overlay AR superposé au flux caméra
 */

'use strict';

class ThreeScene {
  constructor(canvasEl) {
    this.canvas  = canvasEl;
    this.width   = 0;
    this.height  = 0;

    // Three core
    this.renderer = null;
    this.scene    = null;
    this.camera   = null;

    // Watch
    this.watchGroup    = null;
    this.currentWatch  = 0;
    this.watches       = [];   // cache des groupes construits

    // Smooth tracking
    this.targetPos     = new THREE.Vector3();
    this.targetQuat    = new THREE.Quaternion();
    this.currentPos    = new THREE.Vector3();
    this.currentQuat   = new THREE.Quaternion();
    this.watchVisible  = false;
    this.smoothAlpha   = 0.22;   // lerp strength
    this.scaleSmooth   = 1.0;

    // Timing
    this.lastFpsTime   = performance.now();
    this.frameCount    = 0;
    this.fpsEl         = document.getElementById('fps-counter');

    this._init();
  }

  /* ── Initialisation ─────────────────────────────────────────── */
  _init() {
    // Renderer
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      alpha:  true,          // fond transparent
      antialias: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled  = true;
    this.renderer.shadowMap.type     = THREE.PCFSoftShadowMap;
    this.renderer.outputEncoding     = THREE.sRGBEncoding;
    this.renderer.toneMapping        = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure= 1.4;

    // Scene
    this.scene = new THREE.Scene();

    // Camera (orthographique pour overlay AR précis)
    this.camera = new THREE.PerspectiveCamera(45, 1, 0.01, 100);
    this.camera.position.set(0, 0, 5);

    // Éclairage
    this._setupLights();

    // Env map simple via PMREMGenerator
    this._setupEnvMap();

    // Construire toutes les montres (lazy)
    WATCH_CATALOG.forEach((def, i) => {
      const g = buildWatchModel(THREE, def);
      g.visible = (i === 0);
      this.scene.add(g);
      this.watches.push(g);
    });
    this.watchGroup = this.watches[0];

    // Resize
    this._onResize();
    window.addEventListener('resize', () => this._onResize(), { passive: true });
  }

  _setupLights() {
    // Lumière ambiante douce
    const ambient = new THREE.AmbientLight(0xfff8f0, 0.6);
    this.scene.add(ambient);

    // Lumière principale (soleil simulé)
    const keyLight = new THREE.DirectionalLight(0xffeedd, 2.0);
    keyLight.position.set(2, 4, 3);
    keyLight.castShadow = true;
    keyLight.shadow.mapSize.set(512, 512);
    this.scene.add(keyLight);

    // Lumière de remplissage (fill)
    const fillLight = new THREE.DirectionalLight(0xc9e0ff, 0.8);
    fillLight.position.set(-3, 2, -2);
    this.scene.add(fillLight);

    // Lumière de dessous (rim / contre-jour)
    const rimLight = new THREE.PointLight(0xc9a96e, 1.5, 8);
    rimLight.position.set(0, -2, 2);
    this.scene.add(rimLight);
  }

  _setupEnvMap() {
    // Env sphérique minimal pour les réflexions
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    pmrem.compileEquirectangularShader();
    const envScene = new THREE.Scene();
    envScene.background = new THREE.Color(0x111118);

    // Quelques lumières sphériques pour simuler HDR
    const colors = [0xffeedd, 0xc9a96e, 0x4488cc, 0x222233];
    colors.forEach((c, i) => {
      const angle = (i / colors.length) * Math.PI * 2;
      const sph = new THREE.Mesh(
        new THREE.SphereGeometry(1, 8, 8),
        new THREE.MeshBasicMaterial({ color: c, side: THREE.BackSide })
      );
      sph.scale.setScalar(3 + i);
      sph.position.set(Math.cos(angle) * 5, (i - 1.5) * 2, Math.sin(angle) * 5);
      envScene.add(sph);
    });

    const envTarget = pmrem.fromScene(envScene);
    this.scene.environment = envTarget.texture;
    pmrem.dispose();
  }

  /* ── Resize ─────────────────────────────────────────────────── */
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

  /* ── Changement de montre ───────────────────────────────────── */
  switchWatch(index) {
    if (index === this.currentWatch) return;
    this.watches[this.currentWatch].visible = false;
    this.currentWatch = index;
    this.watchGroup   = this.watches[index];
    this.watchGroup.visible = true;
  }

  /* ── Mise à jour tracking ─────────────────────────────────────
     Appelé depuis mediapipe-hands.js avec les données de poignet
  ──────────────────────────────────────────────────────────────── */
  updateWristPose(pose) {
    if (!pose) {
      this.watchVisible = false;
      return;
    }
    this.watchVisible = true;

    // Position en coordonnées scène
    this.targetPos.copy(pose.position);

    // Orientation
    this.targetQuat.copy(pose.quaternion);

    // Échelle (distance relative)
    this.scaleSmooth += (pose.scale - this.scaleSmooth) * 0.15;
  }

  /* ── Boucle de rendu ────────────────────────────────────────── */
  render() {
    if (!this.watchGroup) return;

    // Mise à jour heure réelle sur les aiguilles
    updateWatchHands(this.watchGroup);

    if (this.watchVisible) {
      // Lerp position
      this.currentPos.lerp(this.targetPos, this.smoothAlpha);
      // Slerp orientation
      this.currentQuat.slerp(this.targetQuat, this.smoothAlpha * 0.8);

      this.watchGroup.position.copy(this.currentPos);
      this.watchGroup.quaternion.copy(this.currentQuat);
      this.watchGroup.scale.setScalar(this.scaleSmooth);
      this.watchGroup.visible = true;

      // Opacity fade-in : via le matériau on ne peut pas facilement,
      // mais le group.visible suffit.
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
      this.frameCount    = 0;
      this.lastFpsTime   = now;
    }
  }
}
