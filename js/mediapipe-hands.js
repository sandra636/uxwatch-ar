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
      locateFile: (file) =>
        `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`,
    });
    this.hands.setOptions({
      maxNumHands: 1,
      modelComplexity: 0,
      minDetectionConfidence: 0.5,
      minTrackingConfidence: 0.4,
    });
    this.hands.onResults((results) => this._onResults(results));
  }

  async start(stream) {
    if (!this.video.srcObject) this.video.srcObject = stream;
    if (this.video.paused) await this.video.play().catch(() => {});
    await new Promise(res => {
      if (this.video.readyState >= 2) { res(); return; }
      this.video.onloadeddata = res;
      setTimeout(res, 2000);
    });
    const sendFrame = async () => {
      if (!this.rafId) return;
      if (this.video.readyState >= 2 && !this.video.paused) {
        try { await this.hands.send({ image: this.video }); }
        catch(e) {}
      }
      this.rafId = requestAnimationFrame(sendFrame);
    };
    this.rafId = requestAnimationFrame(sendFrame);
  }

  stop() {
    if (this.rafId) { cancelAnimationFrame(this.rafId); this.rafId = null; }
    if (this.hands) this.hands.close();
  }

  _onResults(results) {
    if (!results.multiHandLandmarks || results.multiHandLandmarks.length === 0) {
      this.framesSinceLost++;
      if (this.framesSinceLost >= this.LOST_THRESHOLD && this.detected) {
        this.detected = false;
        this.onPose(null);
        this.onStatus('lost');
      }
      return;
    }
    this.framesSinceLost = 0;
    if (!this.detected) {
      this.detected = true;
      this.onStatus('detected');
    }
    const pose = this._computeWristPose(results.multiHandLandmarks[0]);
    if (pose) this.onPose(pose);
  }

  _computeWristPose(lm) {
    const W = lm[0];
    const I = lm[5];
    const P = lm[17];
    const M = lm[9];

    const isRear = document.getElementById('camera-feed').classList.contains('rear');
    const mirrorX = isRear ? -1 : 1;

    const vW = this.video.videoWidth  || 640;
    const vH = this.video.videoHeight || 480;
    const aspect = vW / vH;

    const fov  = 45 * Math.PI / 180;
    const dist = 5;
    const scaleY = 2 * dist * Math.tan(fov / 2);
    const scaleX = scaleY * aspect;

    const toScene = (x, y, z) => new THREE.Vector3(
      (0.5 - x) * scaleX * mirrorX,
      (0.5 - y) * scaleY,
      -z * 1.5
    );

    const wristV = toScene(W.x, W.y, W.z);
    const indexV = toScene(I.x, I.y, I.z);
    const pinkyV = toScene(P.x, P.y, P.z);
    const midV   = toScene(M.x, M.y, M.z);

    const zAxis = new THREE.Vector3().subVectors(midV, wristV).normalize();
    const xAxis = new THREE.Vector3().subVectors(indexV, pinkyV).normalize();
    const yAxis = new THREE.Vector3().crossVectors(zAxis, xAxis).normalize();
    xAxis.crossVectors(yAxis, zAxis).normalize();

    const rotMat = new THREE.Matrix4().makeBasis(xAxis, yAxis, zAxis);
    const quat = new THREE.Quaternion().setFromRotationMatrix(rotMat);
    const fixQ = new THREE.Quaternion().setFromAxisAngle(
      new THREE.Vector3(1, 0, 0), Math.PI / 2
    );
    quat.multiply(fixQ);

    // Taille basée sur la largeur réelle du poignet dans l'image
    const wristWidth = new THREE.Vector3().subVectors(indexV, pinkyV).length();
    // Grande échelle pour que la montre soit visible et réaliste
    const targetScale = Math.max(2.5, Math.min(8.0, wristWidth * 12.0));

    // Position exacte sur le poignet (entre wrist et MCP)
    const position = new THREE.Vector3().lerpVectors(wristV, midV, 0.35);

    if (!this.smoothPos) {
      this.smoothPos  = position.clone();
      this.smoothQuat = quat.clone();
    } else {
      this.smoothPos.lerp(position, 0.4);
      this.smoothQuat.slerp(quat, 0.35);
    }

    return {
      position:   this.smoothPos.clone(),
      quaternion: this.smoothQuat.clone(),
      scale:      targetScale,
    };
  }
}