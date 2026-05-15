'use strict';

class HandTracker {
  constructor(videoEl, dbgCanvas, onPose, onStatus) {
    this.video = videoEl;
    this.dbgCanvas = dbgCanvas;
    this.dbgCtx = dbgCanvas ? dbgCanvas.getContext('2d') : null;
    this.onPose = onPose;
    this.onStatus = onStatus;
    this.hands = null;
    this.rafId = null;
    this.detected = false;
    this.framesSinceLost = 0;
    this.LOST_THRESHOLD = 10;
    this.smoothPos = null;
    this.smoothQuat = null;
    this._init();
  }

  async _init() {
    this.hands = new Hands({
      locateFile: (f) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${f}`,
    });
    this.hands.setOptions({
      maxNumHands: 1,
      modelComplexity: 0,
      minDetectionConfidence: 0.5,
      minTrackingConfidence: 0.4,
    });
    this.hands.onResults((r) => this._onResults(r));
  }

  async start(stream) {
    if (!this.video.srcObject) this.video.srcObject = stream;
    if (this.video.paused) await this.video.play().catch(() => {});
    await new Promise(res => {
      if (this.video.readyState >= 2) { res(); return; }
      this.video.onloadeddata = res;
      setTimeout(res, 2000);
    });
    const send = async () => {
      if (!this.rafId) return;
      if (this.video.readyState >= 2 && !this.video.paused) {
        try { await this.hands.send({ image: this.video }); } catch(e) {}
      }
      this.rafId = requestAnimationFrame(send);
    };
    this.rafId = requestAnimationFrame(send);
  }

  stop() {
    if (this.rafId) { cancelAnimationFrame(this.rafId); this.rafId = null; }
    if (this.hands) this.hands.close();
  }

  _onResults(results) {
    if (!results.multiHandLandmarks || !results.multiHandLandmarks.length) {
      this.framesSinceLost++;
      if (this.framesSinceLost >= this.LOST_THRESHOLD && this.detected) {
        this.detected = false;
        this.onPose(null);
        this.onStatus('lost');
      }
      return;
    }
    this.framesSinceLost = 0;
    if (!this.detected) { this.detected = true; this.onStatus('detected'); }
    const pose = this._computeWristPose(results.multiHandLandmarks[0]);
    if (pose) this.onPose(pose);
  }

  _computeWristPose(lm) {
    // Points clés
    const W  = lm[0];   // poignet
    const I  = lm[5];   // index MCP
    const P  = lm[17];  // auriculaire MCP
    const M  = lm[9];   // majeur MCP
    const W2 = lm[1];   // poignet bas (thumb CMC)

    const isRear = document.getElementById('camera-feed').classList.contains('rear');
    const mx = isRear ? -1 : 1;

    const vW = this.video.videoWidth  || 640;
    const vH = this.video.videoHeight || 480;
    const aspect = vW / vH;
    const scaleY = 2 * 5 * Math.tan(22.5 * Math.PI / 180);
    const scaleX = scaleY * aspect;

    const ts = (x, y, z) => new THREE.Vector3(
      (0.5 - x) * scaleX * mx,
      (0.5 - y) * scaleY,
      z * -1.5
    );

    const wV = ts(W.x,  W.y,  W.z);
    const iV = ts(I.x,  I.y,  I.z);
    const pV = ts(P.x,  P.y,  P.z);
    const mV = ts(M.x,  M.y,  M.z);

    // Axe principal : direction de l'avant-bras (poignet → MCP majeur)
    // C'est l'axe Y de la montre (vers le haut du cadran)
    const axisY = new THREE.Vector3().subVectors(mV, wV).normalize();

    // Axe transversal : auriculaire → index (largeur de la main)
    // C'est l'axe X de la montre
    const axisX = new THREE.Vector3().subVectors(iV, pV).normalize();

    // Axe normal : perpendiculaire au plan de la main
    // C'est l'axe Z de la montre (face du cadran)
    const axisZ = new THREE.Vector3().crossVectors(axisX, axisY).normalize();

    // Recalculer X orthogonal
    axisX.crossVectors(axisY, axisZ).normalize();

    // Construire la matrice de rotation
    const mat = new THREE.Matrix4().makeBasis(axisX, axisY, axisZ);
    const quat = new THREE.Quaternion().setFromRotationMatrix(mat);

    // La montre doit être à plat sur le poignet
    // Rotation de 90° pour que le cadran soit face à la caméra
    const r1 = new THREE.Quaternion().setFromAxisAngle(
      new THREE.Vector3(1, 0, 0), -Math.PI / 2
    );
    quat.multiply(r1);

    // Taille proportionnelle à la largeur de la main
    const wristWidth = new THREE.Vector3().subVectors(iV, pV).length();
   const scale = Math.max(3.0, Math.min(8.0, wristWidth * 13.0));

    // Position : juste au dessus du poignet (20% vers les MCP)
   const pos = new THREE.Vector3().lerpVectors(wV, mV, 0.08);

    // Lissage
    if (!this.smoothPos) {
      this.smoothPos  = pos.clone();
      this.smoothQuat = quat.clone();
    } else {
      this.smoothPos.lerp(pos, 0.35);
      this.smoothQuat.slerp(quat, 0.3);
    }

    return {
      position:   this.smoothPos.clone(),
      quaternion: this.smoothQuat.clone(),
      scale,
    };
  }
}