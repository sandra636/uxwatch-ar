'use strict';
const WATCH_CATALOG = [
  { id: 0, name: 'Classic Gold',  path: 'models/watch1.glb' },
  { id: 1, name: 'Silver Sport',  path: 'models/watch2.glb' },
  { id: 2, name: 'Black Edition', path: 'models/watch3.glb' },
];
function updateWatchHands(group) {
  const now = new Date();
  const s = now.getSeconds() + now.getMilliseconds()/1000;
  const m = now.getMinutes() + s/60;
  const h = (now.getHours()%12) + m/60;
  const sec = group.getObjectByName('secHand');
  const min = group.getObjectByName('minHand');
  const hr  = group.getObjectByName('hourHand');
  if(sec) sec.rotation.y = -(s/60)*Math.PI*2;
  if(min) min.rotation.y = -(m/60)*Math.PI*2;
  if(hr)  hr.rotation.y  = -(h/12)*Math.PI*2;
}