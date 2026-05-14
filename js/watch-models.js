/**
 * watch-models.js
 * Définition des montres disponibles et construction des modèles 3D via Three.js
 */

'use strict';

const WATCH_CATALOG = [
  {
    id: 0,
    name: 'Classic Gold',
    imagePath: 'assets/images/w1.png',
    colors: {
      case:    0xc9a96e,   // or
      dial:    0xfdf8f0,   // crème
      bezel:   0xb8860b,   // doré foncé
      strap:   0x2c1810,   // cuir brun
      hands:   0x1a1a1a,   // aiguilles sombres
      marker:  0xc9a96e,
    },
    strapColor2: 0x4a2c1a,
  },
  {
    id: 1,
    name: 'Silver Sport',
    imagePath: 'assets/images/w2.png',
    colors: {
      case:    0xd0d0d8,   // argent
      dial:    0x1a1a2e,   // bleu nuit
      bezel:   0xa0a0b0,   // argent mat
      strap:   0x303040,   // caoutchouc foncé
      hands:   0xffffff,   // aiguilles blanches
      marker:  0x4fc3f7,   // bleu clair
    },
    strapColor2: 0x404055,
  },
  {
    id: 2,
    name: 'Black Edition',
    imagePath: 'assets/images/w3.png',
    colors: {
      case:    0x2a2a2a,   // noir carbone
      dial:    0x0d0d0d,   // noir profond
      bezel:   0x1a1a1a,
      strap:   0x111111,   // bracelet noir
      hands:   0xe8c86e,   // aiguilles or
      marker:  0xe8c86e,
    },
    strapColor2: 0x1a1a1a,
  },
];

/* ────────────────────────────────────────────────────────────────
   buildWatchModel — construit un groupe THREE représentant la montre
   Renvoie un THREE.Group
────────────────────────────────────────────────────────────────── */
function buildWatchModel(THREE, watchDef) {
  const group = new THREE.Group();
  const C = watchDef.colors;

  // ── Matériaux ──────────────────────────────────────────────────
  const caseMat = new THREE.MeshStandardMaterial({
    color: C.case, metalness: 0.85, roughness: 0.2,
    envMapIntensity: 1.2,
  });
  const dialMat = new THREE.MeshStandardMaterial({
    color: C.dial, metalness: 0.1, roughness: 0.5,
  });
  const bezelMat = new THREE.MeshStandardMaterial({
    color: C.bezel, metalness: 0.9, roughness: 0.15,
  });
  const strapMat1 = new THREE.MeshStandardMaterial({
    color: C.strap, metalness: 0.05, roughness: 0.8,
  });
  const strapMat2 = new THREE.MeshStandardMaterial({
    color: watchDef.strapColor2, metalness: 0.05, roughness: 0.75,
  });
  const handsMat = new THREE.MeshStandardMaterial({
    color: C.hands, metalness: 0.6, roughness: 0.3,
  });
  const markerMat = new THREE.MeshStandardMaterial({
    color: C.marker, metalness: 0.8, roughness: 0.2,
    emissive: C.marker, emissiveIntensity: 0.15,
  });
  const glassMat = new THREE.MeshStandardMaterial({
    color: 0xffffff, transparent: true, opacity: 0.12,
    metalness: 0, roughness: 0,
  });
  const crownMat = new THREE.MeshStandardMaterial({
    color: C.bezel, metalness: 0.9, roughness: 0.2,
  });

  // ── Boitier (case) ─────────────────────────────────────────────
  const caseGeo = new THREE.CylinderGeometry(0.55, 0.52, 0.18, 64, 1);
  const caseMesh = new THREE.Mesh(caseGeo, caseMat);
  caseMesh.castShadow = true;
  group.add(caseMesh);

  // Rebord boîtier
  const rimGeo = new THREE.TorusGeometry(0.55, 0.025, 16, 64);
  const rimTop = new THREE.Mesh(rimGeo, bezelMat);
  rimTop.position.y = 0.09;
  const rimBot = new THREE.Mesh(rimGeo, caseMat);
  rimBot.position.y = -0.09;
  group.add(rimTop, rimBot);

  // ── Lunette (bezel) ────────────────────────────────────────────
  const bezelGeo = new THREE.CylinderGeometry(0.565, 0.555, 0.035, 64);
  const bezelMesh = new THREE.Mesh(bezelGeo, bezelMat);
  bezelMesh.position.y = 0.107;
  group.add(bezelMesh);

  // ── Cadran (dial) ──────────────────────────────────────────────
  const dialGeo = new THREE.CylinderGeometry(0.50, 0.50, 0.01, 64);
  const dialMesh = new THREE.Mesh(dialGeo, dialMat);
  dialMesh.position.y = 0.09;
  group.add(dialMesh);

  // ── Verre (crystal) ───────────────────────────────────────────
  const glassGeo = new THREE.CylinderGeometry(0.52, 0.52, 0.01, 64);
  const glassMesh = new THREE.Mesh(glassGeo, glassMat);
  glassMesh.position.y = 0.125;
  group.add(glassMesh);

  // ── Index / marqueurs ──────────────────────────────────────────
  for (let i = 0; i < 12; i++) {
    const angle = (i / 12) * Math.PI * 2;
    const isHour = i % 3 === 0;
    const mGeo = new THREE.BoxGeometry(
      isHour ? 0.035 : 0.02,
      0.008,
      isHour ? 0.08 : 0.05
    );
    const mMesh = new THREE.Mesh(mGeo, markerMat);
    const r = 0.41;
    mMesh.position.set(Math.sin(angle) * r, 0.096, Math.cos(angle) * r);
    mMesh.rotation.y = -angle;
    group.add(mMesh);
  }

  // ── Aiguille des heures ────────────────────────────────────────
  const hourGeo = new THREE.BoxGeometry(0.025, 0.008, 0.22);
  const hourHand = new THREE.Mesh(hourGeo, handsMat);
  hourHand.position.set(0, 0.105, -0.08);
  hourHand.name = 'hourHand';
  group.add(hourHand);

  // ── Aiguille des minutes ───────────────────────────────────────
  const minGeo = new THREE.BoxGeometry(0.018, 0.008, 0.32);
  const minHand = new THREE.Mesh(minGeo, handsMat);
  minHand.position.set(0, 0.108, -0.11);
  minHand.name = 'minHand';
  group.add(minHand);

  // ── Aiguille des secondes ──────────────────────────────────────
  const secGeo = new THREE.BoxGeometry(0.01, 0.007, 0.36);
  const secMat = new THREE.MeshStandardMaterial({
    color: watchDef.id === 2 ? 0xe8c86e : 0xe05b5b,
    metalness: 0.3, roughness: 0.4,
    emissive: watchDef.id === 2 ? 0xe8c86e : 0xe05b5b,
    emissiveIntensity: 0.4,
  });
  const secHand = new THREE.Mesh(secGeo, secMat);
  secHand.position.set(0, 0.11, -0.12);
  secHand.name = 'secHand';
  group.add(secHand);

  // Centre aiguilles
  const centGeo = new THREE.CylinderGeometry(0.025, 0.025, 0.015, 16);
  const centMesh = new THREE.Mesh(centGeo, caseMat);
  centMesh.position.y = 0.11;
  group.add(centMesh);

  // ── Couronne (crown) ───────────────────────────────────────────
  const crownGeo = new THREE.CylinderGeometry(0.03, 0.03, 0.1, 16);
  const crownMesh = new THREE.Mesh(crownGeo, crownMat);
  crownMesh.rotation.z = Math.PI / 2;
  crownMesh.position.set(0.58, 0.04, 0);
  group.add(crownMesh);

  // ── Cornes boitier (lugs) ──────────────────────────────────────
  const lugGeo = new THREE.BoxGeometry(0.12, 0.06, 0.15);
  const lugPositions = [
    { x: 0.3, z: 0.55 }, { x: -0.3, z: 0.55 },
    { x: 0.3, z: -0.55 }, { x: -0.3, z: -0.55 },
  ];
  lugPositions.forEach(p => {
    const lug = new THREE.Mesh(lugGeo, caseMat);
    lug.position.set(p.x, 0, p.z);
    lug.rotation.y = Math.abs(p.x) > 0 && p.z > 0 ? 0.2 * Math.sign(p.x) : -0.2 * Math.sign(p.x);
    group.add(lug);
  });

  // ── Bracelet haut ──────────────────────────────────────────────
  buildStrap(THREE, group, strapMat1, strapMat2, 1);   // vers le haut
  buildStrap(THREE, group, strapMat1, strapMat2, -1);  // vers le bas

  return group;
}

/** Construit un segment de bracelet (haut ou bas) */
function buildStrap(THREE, group, mat1, mat2, dir) {
  // Corps principal
  const geo = new THREE.BoxGeometry(0.52, 0.055, 0.85);
  const mesh = new THREE.Mesh(geo, mat1);
  mesh.position.set(0, -0.01, dir * 0.95);
  group.add(mesh);

  // Bandes décoratives
  for (let i = 0; i < 3; i++) {
    const bandGeo = new THREE.BoxGeometry(0.52, 0.057, 0.025);
    const band = new THREE.Mesh(bandGeo, mat2);
    band.position.set(0, -0.005, dir * (0.7 + i * 0.15));
    group.add(band);
  }

  // Ardillon (boucle) sur le bas seulement
  if (dir === -1) {
    const buckleOuter = new THREE.TorusGeometry(0.09, 0.015, 8, 24);
    const buckleMesh = new THREE.Mesh(buckleOuter, mat2);
    buckleMesh.position.set(0, 0.02, dir * 1.35);
    buckleMesh.rotation.x = Math.PI / 2;
    group.add(buckleMesh);
  }
}

/** Met à jour les aiguilles en fonction de l'heure courante */
function updateWatchHands(watchGroup) {
  const now = new Date();
  const s = now.getSeconds() + now.getMilliseconds() / 1000;
  const m = now.getMinutes() + s / 60;
  const h = (now.getHours() % 12) + m / 60;

  const sec  = watchGroup.getObjectByName('secHand');
  const min  = watchGroup.getObjectByName('minHand');
  const hour = watchGroup.getObjectByName('hourHand');

  if (sec)  sec.rotation.y  = -(s / 60) * Math.PI * 2;
  if (min)  min.rotation.y  = -(m / 60) * Math.PI * 2;
  if (hour) hour.rotation.y = -(h / 12) * Math.PI * 2;
}
