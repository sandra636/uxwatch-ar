/**
 * app.js — VERSION v5
 * Fix camera arriere : utilise deviceId pour forcer la caméra arrière
 */

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

const $  = id => document.getElementById(id);
const DOM = {
  loader:        $('loader'),
  loaderMsg:     $('loader-msg'),
  loaderBar:     $('loader-bar-fill'),
  permOverlay:   $('permission-overlay'),
  btnAllowCam:   $('btn-allow-cam'),
  app:           $('app'),
  errorScreen:   $('error-screen'),
  errorMsg:      $('error-msg'),
  camFeed:       $('camera-feed'),
  threeCanvas:   $('three-canvas'),
  lmCanvas:      $('landmark-canvas'),
  statusDot:     $('status-dot'),
  statusText:    $('status-text'),
  scanReticle:   $('scan-reticle'),
  detectedBadge: $('detected-badge'),
  btnFlip:       $('btn-flip'),
  watchThumbs:   document.querySelectorAll('.watch-thumb'),
  watchNameDisplay: $('watch-name-display'),
};

const LOAD_STEPS = [
  { msg: 'Initialisation du moteur 3D…',       pct: 15 },
  { msg: 'Chargement des modèles de montres…',  pct: 35 },
  { msg: 'Activation de MediaPipe Hands…',      pct: 55 },
  { msg: 'Connexion à la caméra…',              pct: 75 },
  { msg: 'Calibration AR…',                     pct: 90 },
  { msg: 'Prêt !',                              pct: 100 },
];

function setLoaderStep(index) {
  const step = LOAD_STEPS[index];
  if (!step) return;
  DOM.loaderMsg.textContent = step.msg;
  DOM.loaderBar.style.width = step.pct + '%';
}

function hideLoader() {
  DOM.loader.classList.add('fade-out');
  setTimeout(() => DOM.loader.classList.add('hidden'), 650);
}

function setStatus(type, text) {
  DOM.statusDot.className    = 'status-dot ' + (type || '');
  DOM.statusText.textContent = text;
}

/* ── Détecter les caméras disponibles ───────────────────────── */
async function detectCameras() {
  try {
    // Il faut d'abord obtenir une permission pour avoir les labels
    const tempStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
    tempStream.getTracks().forEach(t => t.stop());

    const devices = await navigator.mediaDevices.enumerateDevices();
    const cameras = devices.filter(d => d.kind === 'videoinput');

    console.log('Caméras trouvées:', cameras.map(c => c.label + ' | ' + c.deviceId));

    // Chercher caméra arrière par le label
    const rear = cameras.find(c =>
      c.label.toLowerCase().includes('back') ||
      c.label.toLowerCase().includes('arrière') ||
      c.label.toLowerCase().includes('rear') ||
      c.label.toLowerCase().includes('environment') ||
      c.label.toLowerCase().includes('0,') // Android: "camera2 0, facing back"
    );

    const front = cameras.find(c =>
      c.label.toLowerCase().includes('front') ||
      c.label.toLowerCase().includes('face') ||
      c.label.toLowerCase().includes('user') ||
      c.label.toLowerCase().includes('1,') // Android: "camera2 1, facing front"
    );

    // Si pas trouvé par label, prendre la première comme arrière
    state.rearDeviceId  = rear  ? rear.deviceId  : (cameras[0]  ? cameras[0].deviceId  : null);
    state.frontDeviceId = front ? front.deviceId : (cameras[1]  ? cameras[1].deviceId  : null);

    console.log('Caméra arrière deviceId:', state.rearDeviceId);
    console.log('Caméra frontale deviceId:', state.frontDeviceId);
  } catch(e) {
    console.warn('Impossible de détecter les caméras:', e);
  }
}

/* ── Ouvrir une caméra ───────────────────────────────────────── */
async function requestCamera(wantRear) {
  let constraints;

  // Méthode 1 : utiliser deviceId si disponible
  const deviceId = wantRear ? state.rearDeviceId : state.frontDeviceId;

  if (deviceId) {
    constraints = {
      video: {
        deviceId: { exact: deviceId },
        width:    { ideal: 1280 },
        height:   { ideal: 720 },
        frameRate:{ ideal: 30 },
      },
      audio: false,
    };
  } else {
    // Méthode 2 : fallback avec facingMode
    constraints = {
      video: {
        facingMode: wantRear ? 'environment' : 'user',
        width:    { ideal: 1280 },
        height:   { ideal: 720 },
        frameRate:{ ideal: 30 },
      },
      audio: false,
    };
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    state.useFrontCam = !wantRear;
    // Appliquer miroir uniquement pour caméra frontale
    if (wantRear) {
      DOM.camFeed.classList.add('rear');
      DOM.camFeed.style.transform = 'none';
    } else {
      DOM.camFeed.classList.remove('rear');
      DOM.camFeed.style.transform = 'scaleX(-1)';
    }
    return stream;
  } catch (err) {
    console.warn('Erreur caméra avec deviceId, fallback facingMode:', err);
    // Fallback ultime sans contrainte
    const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
    state.useFrontCam = true;
    DOM.camFeed.classList.remove('rear');
    DOM.camFeed.style.transform = 'scaleX(-1)';
    return stream;
  }
}

/* ── Flip caméra ─────────────────────────────────────────────── */
async function flipCamera() {
  if (!state.stream) return;

  if (state.handTracker) {
    state.handTracker.stop();
    state.handTracker = null;
  }
  state.stream.getTracks().forEach(t => t.stop());
  DOM.camFeed.srcObject = null;

  const wantRear = state.useFrontCam; // inverser

  try {
    const stream = await requestCamera(wantRear);
    state.stream = stream;
    DOM.camFeed.srcObject = stream;
    await DOM.camFeed.play();

    await delay(300);
    DOM.lmCanvas.width  = DOM.camFeed.videoWidth  || 640;
    DOM.lmCanvas.height = DOM.camFeed.videoHeight || 480;

    state.handTracker = new HandTracker(
      DOM.camFeed, DOM.lmCanvas, onWristPose, onTrackingStatus
    );
    await state.handTracker.start(stream);
  } catch (err) {
    console.error('Impossible de changer de caméra:', err);
    setStatus('', 'Changement de caméra impossible');
  }
}

/* ── Sélection montre ────────────────────────────────────────── */
function selectWatch(index) {
  state.currentWatch = index;
  DOM.watchThumbs.forEach((btn, i) => btn.classList.toggle('active', i === index));
  DOM.watchNameDisplay.textContent = WATCH_CATALOG[index].name;
  if (state.threeScene) state.threeScene.switchWatch(index);
}

/* ── Boucle AR ───────────────────────────────────────────────── */
function startARLoop() {
  function loop() {
    state.rafId = requestAnimationFrame(loop);
    if (state.threeScene) state.threeScene.render();
  }
  loop();
}

/* ── Init principale ─────────────────────────────────────────── */
async function init() {
  setLoaderStep(0);
  await delay(200);

  try {
    state.threeScene = new ThreeScene(DOM.threeCanvas);
  } catch (e) {
    console.error('Erreur Three.js:', e);
    showError('Erreur de chargement 3D. Rechargez la page.');
    return;
  }
  setLoaderStep(1);
  await delay(300);
  setLoaderStep(2);

  // Détecter les caméras disponibles
  await detectCameras();

  // Demander la caméra arrière
  let stream;
  try {
    stream = await requestCamera(true);
    state.stream = stream;
  } catch (err) {
    console.warn('getUserMedia échoué:', err);
    hideLoader();
    DOM.permOverlay.classList.remove('hidden');
    return;
  }

  await startWithStream(stream);
}

async function startWithStream(stream) {
  setLoaderStep(3);
  state.stream = stream;

  DOM.camFeed.srcObject   = stream;
  DOM.camFeed.muted       = true;
  DOM.camFeed.playsInline = true;

  await new Promise(res => {
    if (DOM.camFeed.readyState >= 1) { res(); return; }
    DOM.camFeed.onloadedmetadata = res;
  });

  try {
    await DOM.camFeed.play();
  } catch (e) {
    console.warn('play() bloqué:', e);
  }

  DOM.lmCanvas.width  = DOM.camFeed.videoWidth  || 640;
  DOM.lmCanvas.height = DOM.camFeed.videoHeight || 480;

  setLoaderStep(4);
  await delay(400);

  setStatus('scanning', 'Initialisation du suivi…');
  try {
    state.handTracker = new HandTracker(
      DOM.camFeed, DOM.lmCanvas, onWristPose, onTrackingStatus
    );
    await state.handTracker.start(stream);
  } catch (e) {
    console.error('Erreur MediaPipe:', e);
    setStatus('', 'Erreur détection — rechargez');
  }

  setLoaderStep(5);
  await delay(400);

  hideLoader();
  DOM.app.classList.remove('hidden');
  startARLoop();

  setStatus('scanning', 'Montrez votre main à la caméra…');
  DOM.scanReticle.classList.remove('hidden');
}

/* ── Callbacks MediaPipe ─────────────────────────────────────── */
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

/* ── Events ──────────────────────────────────────────────────── */
DOM.btnAllowCam.addEventListener('click', async () => {
  DOM.permOverlay.classList.add('hidden');
  try {
    await detectCameras();
    const stream = await requestCamera(true);
    await startWithStream(stream);
  } catch (err) {
    showError('Accès caméra refusé. Autorisez dans les paramètres du navigateur.');
  }
});

DOM.btnFlip.addEventListener('click', flipCamera);

DOM.watchThumbs.forEach((btn, i) => {
  btn.addEventListener('click', () => selectWatch(i));
});

/* ── Helpers ─────────────────────────────────────────────────── */
function delay(ms) {
  return new Promise(res => setTimeout(res, ms));
}

/* ── Lancement ───────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    DOM.loader.classList.add('hidden');
    showError('Votre navigateur ne supporte pas WebRTC. Utilisez Chrome récent.');
    return;
  }
  init();
});