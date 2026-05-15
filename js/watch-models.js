'use strict';

const WATCH_CATALOG = [
  { id: 0, name: 'Classic Gold',   path: 'assets/models/watch1.glb' },
  { id: 1, name: 'Silver Sport',   path: 'assets/models/watch2.glb' },
  { id: 2, name: 'Black Edition',  path: 'assets/models/watch3.glb' },
];

function buildWatchModel(THREE, watchDef) {
  // Retourne un groupe vide — le GLB sera chargé dans ThreeScene
  return new THREE.Group();
}

function updateWatchHands(watchGroup) {
  // Les aiguilles dans les GLB sont animées automatiquement
}