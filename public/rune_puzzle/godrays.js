import * as THREE from 'three';

const container = document.getElementById('godrays-container');
if (!container) {
  throw new Error('Missing #godrays-container');
}

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(65, window.innerWidth / window.innerHeight, 0.1, 1200);
camera.position.set(0, 0, 320);

const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setClearColor(0x000000, 0);
container.appendChild(renderer.domElement);

const sunGroup = new THREE.Group();
scene.add(sunGroup);

const core = new THREE.Mesh(
  new THREE.SphereGeometry(14, 24, 24),
  new THREE.MeshBasicMaterial({
    color: 0xa8ffdb,
    transparent: true,
    opacity: 0.95
  })
);
sunGroup.add(core);

const halo = new THREE.Mesh(
  new THREE.SphereGeometry(22, 24, 24),
  new THREE.MeshBasicMaterial({
    color: 0x5effaa,
    transparent: true,
    opacity: 0.12,
    blending: THREE.AdditiveBlending,
    depthWrite: false
  })
);
sunGroup.add(halo);

const beamGeometry = new THREE.PlaneGeometry(5, 240);
const beams = [];
for (let i = 0; i < 56; i += 1) {
  const beam = new THREE.Mesh(
    beamGeometry,
    new THREE.MeshBasicMaterial({
      color: 0x56f6b1,
      transparent: true,
      opacity: 0.055,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide
    })
  );

  beam.position.y = 120;
  beam.rotation.z = (i / 56) * Math.PI * 2;
  beam.userData = {
    baseRotation: beam.rotation.z,
    speed: 0.18 + Math.random() * 0.27,
    drift: Math.random() * Math.PI * 2
  };
  sunGroup.add(beam);
  beams.push(beam);
}

const ambience = new THREE.AmbientLight(0x8ad7ff, 0.35);
scene.add(ambience);

function onResize() {
  const width = window.innerWidth;
  const height = window.innerHeight;
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  renderer.setSize(width, height);
}

window.addEventListener('resize', onResize);

function animate() {
  const t = performance.now() * 0.001;

  core.scale.setScalar(1 + Math.sin(t * 1.35) * 0.03);
  halo.scale.setScalar(1.02 + Math.sin(t * 0.85 + 1.4) * 0.06);
  sunGroup.rotation.z = Math.sin(t * 0.22) * 0.09;
  sunGroup.position.x = Math.cos(t * 0.17) * 8;
  sunGroup.position.y = Math.sin(t * 0.13) * 6;

  beams.forEach((beam) => {
    const { baseRotation, speed, drift } = beam.userData;
    beam.rotation.z = baseRotation + Math.sin(t * speed + drift) * 0.2;
    beam.material.opacity = 0.04 + (Math.sin(t * (speed * 1.2) + drift) + 1) * 0.02;
  });

  renderer.render(scene, camera);
}

renderer.setAnimationLoop(animate);
