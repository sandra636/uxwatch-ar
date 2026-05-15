'use strict';

class HandTracker {
  constructor(videoEl, dbgCanvas, onPose, onStatus) {
    this.video     = videoEl;
    this.dbgCanvas = dbgCanvas;
    this.dbgCtx    = dbgCanvas ? dbgCanvas.getContext('2d') : null;
    this.onPose    = onPose;
    this.onStatus  = onStatus;
    this.hands     = null;
    this.rafId     = null;
    this.detected  = false;
    this.framesSinceLost = 0;
    this.LOST_THRESHOLD  = 10;
    this.smoothPos  = null;
    this.smoothQuat = null;
    this._init();
  }

  async _init() {
    this.hands = new Hands({
      locateFile: (file) =>
        `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`,
    });
    this.hands.setOptions({
      maxNumHands:            1,
      modelComplexity:        0,
      minDetectionConfidence: 0.5,
      minTrackingConfidence:  0.4,
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
        catch(e) { console.warn('hands.send error:', e); }
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
    if (this.dbgCtx) this._drawDebug(results);

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

    const landmarks = results.multiHandLandmarks[0];
    const pose = this._computeWristPose(landmarks);
    if (pose) this.onPose(pose);
  }

  _computeWristPose(lm) {
    const W = lm[0];   // poignet
    const I = lm[5];   // index MCP
    const P = lm[17];  // auriculaire MCP
    const M = lm[9];   // majeur MCP

    // Caméra arrière = pas de miroir, caméra avant = miroir X
    const isRear   = document.getElementById('camera-feed').classList.contains('rear');
    const mirrorX  = isRear ? -1 : 1;  // CORRIGÉ : arrière = -1 pour compenser

    const toScene = (x, y, z) => {
      const aspect = (this.video.videoWidth  || 640) /
                     (this.video.videoHeight || 480);
      const fov    = 45 * Math.PI / 180;
      const dist   = 5;
      const scaleY = 2 * dist * Math.tan(fov / 2);
      const scaleX = scaleY * aspect;

      return new THREE.Vector3(
        (0.5 - x) * scaleX * mirrorX,
        (0.5 - y) * scaleY,
        -z * 1.5
      );
    };

    const wristV = toScene(W.x, W.y, W.z);
    const indexV = toScene(I.x, I.y, I.z);
    const pinkyV = toScene(P.x, P.y, P.z);
    const midV   = toScene(M.x, M.y, M.z);

    // Calcul rotation
    const zAxis = new THREE.Vector3().subVectors(midV, wristV).normalize();
    const xAxis = new THREE.Vector3().subVectors(indexV, pinkyV).normalize();
    const yAxis = new THREE.Vector3().crossVectors(zAxis, xAxis).normalize();
    xAxis.crossVectors(yAxis, zAxis).normalize();

    const rotMat = new THREE.Matrix4().makeBasis(xAxis, yAxis, zAxis);
    const quat   = new THREE.Quaternion().setFromRotationMatrix(rotMat);
    const fixQ   = new THREE.Quaternion().setFromAxisAngle(
      new THREE.Vector3(1, 0, 0), Math.PI / 2
    );
    quat.multiply(fixQ);

    // Taille proportionnelle à la largeur du poignet
    const wristWidth = new THREE.Vector3().subVectors(indexV, pinkyV).length();
    const targetScale = Math.max(0.3, Math.min(2.5, wristWidth * 3.2));

    // CORRIGÉ : position = moyenne poignet + milieu MCP (pas 0.45 !)
    const midpoint = new THREE.Vector3()
      .addVectors(wristV, midV)
      .multiplyScalar(0.5);  // ← CORRIGÉ : 0.5 au lieu de 0.45

    // Petit offset vers l'avant
    const offset = new THREE.Vector3().copy(zAxis).multiplyScalar(0.05 * targetScale);
    midpoint.add(offset);

    // Lissage
    if (!this.smoothPos) {
      this.smoothPos  = midpoint.clone();
      this.smoothQuat = quat.clone();
    } else {
      this.smoothPos.lerp(midpoint, 0.4);
      this.smoothQuat.slerp(quat, 0.35);
    }

    return {
      position:   this.smoothPos.clone(),
      quaternion: this.smoothQuat.clone(),
      scale:      targetScale,
    };
  }

  _drawDebug(results) {
    const ctx = this.dbgCtx;
    const W   = this.dbgCanvas.width;
    const H   = this.dbgCanvas.height;
    ctx.clearRect(0, 0, W, H);
    if (!results.multiHandLandmarks) return;

    results.multiHandLandmarks.forEach(lm => {
      const CONNECTIONS = [
        [0,1],[1,2],[2,3],[3,4],
        [0,5],[5,6],[6,7],[7,8],
        [0,9],[9,10],[10,11],[11,12],
        [0,13],[13,14],[14,15],[15,16],
        [0,17],[17,18],[18,19],[19,20],
        [5,9],[9,13],[13,17],
      ];
      ctx.strokeStyle = 'rgba(201,169,110,0.6)';
      ctx.lineWidth   = 2;
      CONNECTIONS.forEach(([a,b]) => {
        ctx.beginPath();
        ctx.moveTo(lm[a].x * W, lm[a].y * H);
        ctx.lineTo(lm[b].x * W, lm[b].y * H);
        ctx.stroke();
      });
      lm.forEach((p, i) => {
        ctx.beginPath();
        ctx.arc(p.x * W, p.y * H, i === 0 ? 6 : 3, 0, Math.PI * 2);
        ctx.fillStyle = i === 0 ? '#c9a96e' : 'rgba(255,255,255,0.7)';
        ctx.fill();
      });
    });
  }
}