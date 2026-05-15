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
    const W = lm[0];   // poignet
    const I = lm[5];   // index MCP
    const P = lm[17];  // auriculaire MCP
    const M = lm[9];   // majeur MCP

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

    const wV = ts(W.x, W.y, W.z);
    const iV = ts(I.x, I.y, I.z);
    const pV = ts(P.x, P.y, P.z);
    const mV = ts(M.x, M.y, M.z);

    // Direction avant-bras : poignet → MCP majeur
    const forearm = new THREE.Vector3().subVectors(mV, wV).normalize();

    // Direction largeur main : auriculaire → index
    const handWidth = new THREE.Vector3().subVectors(iV, pV).normalize();

    // Normale au plan de la main
    const normal = new THREE.Vector3().crossVectors(handWidth, forearm).normalize();

    // Base orthonormale propre
    const axisX = handWidth.clone();
    const axisZ = forearm.clone();
    const axisY = new THREE.Vector3().crossVectors(axisZ, axisX).normalize();

    const mat = new THREE.Matrix4().makeBasis(axisX, axisY, axisZ);
    const quat = new THREE.Quaternion().setFromRotationMatrix(mat);

    // Correction : allonger la montre dans l'axe du bras
   const corrX = new THREE.Quaternion().setFromAxisAngle(
  new THREE.Vector3(1, 0, 0), Math.PI / 2
);
const corrY = new THREE.Quaternion().setFromAxisAngle(
  new THREE.Vector3(0, 1, 0), Math.PI
);
quat.multiply(corrX);
quat.multiply(corrY);

    // Taille
    const wristWidth = new THREE.Vector3().subVectors(iV, pV).length();
   const scale = Math.max(1.0, Math.min(3.5, wristWidth * 6.0));

    // Position : sur le poignet (très proche du point 0)
  // Décaler la montre vers le bas du poignet (vers l'avant-bras)
const pos = new THREE.Vector3().lerpVectors(wV, mV, 0.15);
const downOffset = normal.clone().multiplyScalar(-0.05);
pos.add(downOffset);

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