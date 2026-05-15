
'use strict';

const state = {
  stream:       null,
  threeScene:   null,
  handTracker:  null,
  currentWatch: 0,
  useFrontCam:  false,
  rearDeviceId: null,
  frontDeviceId:null,
  rafId:        null,
};

const $ = id => document.getElementById(id);
const DOM = {
  loader:           $('loader'),
  loaderMsg:        $('loader-msg'),
  loaderBar:        $('loader-bar-fill'),
  permOverlay:      $('permission-overlay'),
  btnAllowCam:      $('btn-allow-cam'),
  app:              $('app'),
  errorScreen:      $('error-screen'),
  errorMsg:         $('error-msg'),
  camFeed:          $('camera-feed'),
  threeCanvas:      $('three-canvas'),
  lmCanvas:         $('landmark-canvas'),
  statusDot:        $('status-dot'),
  statusText:       $('status-text'),
  scanReticle:      $('scan-reticle'),
  detectedBadge:    $('detected-badge'),
  btnFlip:          $('btn-flip'),
  watchThumbs:      document.querySelectorAll('.watch-thumb'),
  watchNameDisplay: $('watch-name-display'),
};

const LOAD_STEPS = [
  { msg: 'Initialisation du moteur 3D…',      pct: 15 },
  { msg: 'Chargement des modèles de montres…', pct: 35 },
  { msg: 'Activation de MediaPipe Hands…',     pct: 55 },
  { msg: 'Connexion à la caméra…',             pct: 75 },
  { msg: 'Calibration AR…',                    pct: 90 },
  { msg: 'Prêt !',                             pct: 100 },
];

function setLoaderStep(i) {
  const s = LOAD_STEPS[i];
  if (!s) return;
  DOM.loaderMsg.textContent = s.msg;
  DOM.loaderBar.style.width = s.pct + '%';
}
function hideLoader() {
  DOM.loader.classList.add('fade-out');
  setTimeout(() => DOM.loader.classList.add('hidden'), 650);
}
function setStatus(type, text) {
  DOM.statusDot.className    = 'status-dot ' + (type || '');
  DOM.statusText.textContent = text;
}
function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

/* ── Détecter caméras ── */
async function detectCameras() {
  try {
    const tmp = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
    tmp.getTracks().forEach(t => t.stop());
    const devices = await navigator.mediaDevices.enumerateDevices();
    const cams    = devices.filter(d => d.kind === 'videoinput');
    console.log('Caméras détectées:', cams.map(c => c.label));
    const rear  = cams.find(c => /back|arrière|rear|environment/i.test(c.label));
    const front = cams.find(c => /front|face|user/i.test(c.label));
    state.rearDeviceId  = rear  ? rear.deviceId  : (cams[0] ? cams[0].deviceId  : null);
    state.frontDeviceId = front ? front.deviceId : (cams[1] ? cams[1].deviceId  : null);
  } catch(e) { console.warn('detectCameras:', e); }
}

/* ── Ouvrir caméra ── */
async function requestCamera(wantRear) {
  let stream;
  const deviceId = wantRear ? state.rearDeviceId : state.frontDeviceId;

  if (deviceId) {
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { deviceId: { exact: deviceId }, width:{ideal:1280}, height:{ideal:720} },
        audio: false,
      });
      applyMirror(wantRear);
      state.useFrontCam = !wantRear;
      return stream;
    } catch(e) { console.warn('deviceId échoué:', e); }
  }
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { exact: wantRear ? 'environment' : 'user' } }, audio: false,
    });
    applyMirror(wantRear);
    state.useFrontCam = !wantRear;
    return stream;
  } catch(e) { console.warn('facingMode exact échoué:', e); }

  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: wantRear ? 'environment' : 'user' }, audio: false,
    });
    applyMirror(wantRear);
    state.useFrontCam = !wantRear;
    return stream;
  } catch(e) { console.warn('facingMode souple échoué:', e); }

  stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
  state.useFrontCam = true;
  applyMirror(false);
  return stream;
}

function applyMirror(wantRear) {
  if (wantRear) {
    DOM.camFeed.classList.add('rear');
    DOM.camFeed.style.transform = 'none';
  } else {
    DOM.camFeed.classList.remove('rear');
    DOM.camFeed.style.transform = 'scaleX(-1)';
  }
}

/* ── Flip caméra ── */
async function flipCamera() {
  if (!state.stream) return;
  if (state.handTracker) { state.handTracker.stop(); state.handTracker = null; }
  state.stream.getTracks().forEach(t => t.stop());
  DOM.camFeed.srcObject = null;
  const wantRear = state.useFrontCam;
  try {
    const stream = await requestCamera(wantRear);
    state.stream = stream;
    DOM.camFeed.srcObject = stream;
    await DOM.camFeed.play();
    await delay(300);
    DOM.lmCanvas.width  = DOM.camFeed.videoWidth  || 640;
    DOM.lmCanvas.height = DOM.camFeed.videoHeight || 480;
    state.handTracker = new HandTracker(DOM.camFeed, DOM.lmCanvas, onWristPose, onTrackingStatus);
    await state.handTracker.start(stream);
  } catch(err) {
    console.error('Flip impossible:', err);
    setStatus('', 'Changement de caméra impossible');
  }
}

/* ── Sélection montre ── */
function selectWatch(index) {
  state.currentWatch = index;
  DOM.watchThumbs.forEach((btn, i) => btn.classList.toggle('active', i === index));
  if (DOM.watchNameDisplay) DOM.watchNameDisplay.textContent = WATCH_CATALOG[index].name;
  if (state.threeScene) state.threeScene.switchWatch(index);
}

/* ── Boucle AR ── */
function startARLoop() {
  if (state.rafId) cancelAnimationFrame(state.rafId);
  function loop() {
    state.rafId = requestAnimationFrame(loop);
    if (state.threeScene) state.threeScene.render();
  }
  loop();
}

/* ── Init ── */
async function init() {
  setLoaderStep(0);
  await delay(200);

  try {
    state.threeScene = new ThreeScene(DOM.threeCanvas);
  } catch(e) {
    console.error('ThreeScene error:', e);
    showError('Erreur moteur 3D. Rechargez.');
    return;
  }

  setLoaderStep(1);
  await delay(300);
  setLoaderStep(2);
  await detectCameras();

  let stream;
  try {
    stream = await requestCamera(true);
    state.stream = stream;
  } catch(err) {
    console.warn('getUserMedia échoué:', err);
    hideLoader();
    DOM.permOverlay.classList.remove('hidden');
    return;
  }
  await startWithStream(stream);
}

/* ── Démarrer avec stream ── */
async function startWithStream(stream) {
  setLoaderStep(3);
  state.stream            = stream;
  DOM.camFeed.srcObject   = stream;
  DOM.camFeed.muted       = true;
  DOM.camFeed.playsInline = true;

  await new Promise(res => {
    if (DOM.camFeed.readyState >= 1) { res(); return; }
    DOM.camFeed.onloadedmetadata = res;
    setTimeout(res, 3000);
  });
  try { await DOM.camFeed.play(); } catch(e) { console.warn('play():', e); }

  DOM.lmCanvas.width  = DOM.camFeed.videoWidth  || 640;
  DOM.lmCanvas.height = DOM.camFeed.videoHeight || 480;

  // IMPORTANT : resize Three.js APRÈS que l'app soit visible
  setLoaderStep(4);
  await delay(400);
  setStatus('scanning', 'Initialisation du suivi…');

  try {
    state.handTracker = new HandTracker(DOM.camFeed, DOM.lmCanvas, onWristPose, onTrackingStatus);
    await state.handTracker.start(stream);
  } catch(e) {
    console.error('MediaPipe error:', e);
    setStatus('', 'Erreur détection — rechargez');
  }

  setLoaderStep(5);
  await delay(400);
  hideLoader();

  // Afficher l'app AVANT de démarrer la boucle AR
  DOM.app.classList.remove('hidden');
  await delay(200); // laisser le DOM se rendre

  // Resize maintenant que l'app est visible
  if (state.threeScene) state.threeScene.forceResize();

  startARLoop();
  setStatus('scanning', 'Montrez votre main à la caméra…');
  DOM.scanReticle.classList.remove('hidden');
}

/* ── Callbacks ── */
function onWristPose(pose) {
  if (state.threeScene) state.threeScene.updateWristPose(pose);
}
function onTrackingStatus(status) {
  if (status === 'detected') {
    setStatus('active', 'Main détectée ✓');
    DOM.scanReticle.classList.add('hidden');
    DOM.detectedBadge.classList.remove('hidden');
  } else {
    setStatus('scanning', 'Montrez votre main…');
    DOM.scanReticle.classList.remove('hidden');
    DOM.detectedBadge.classList.add('hidden');
  }
}
function showError(msg) {
  hideLoader();
  DOM.errorMsg.textContent = msg;
  DOM.errorScreen.classList.remove('hidden');
}

/* ── Events ── */
DOM.btnAllowCam.addEventListener('click', async () => {
  DOM.permOverlay.classList.add('hidden');
  try {
    await detectCameras();
    const stream = await requestCamera(true);
    await startWithStream(stream);
  } catch(err) {
    showError('Accès caméra refusé. Autorisez dans les paramètres.');
  }
});
DOM.btnFlip.addEventListener('click', flipCamera);
DOM.watchThumbs.forEach((btn, i) => btn.addEventListener('click', () => selectWatch(i)));

document.addEventListener('DOMContentLoaded', () => {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    DOM.loader.classList.add('hidden');
    showError('Navigateur non supporté. Utilisez Chrome récent.');
    return;
  }
  init();
});

echo "app.js OK"
Sortie

app.js OK