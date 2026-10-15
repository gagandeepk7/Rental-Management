import { useEffect, useRef, useState } from 'react';
import {
  ACESFilmicToneMapping,
  BoxGeometry,
  CircleGeometry,
  DirectionalLight,
  HemisphereLight,
  InstancedMesh,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  PerspectiveCamera,
  PointLight,
  Scene,
  SRGBColorSpace,
  WebGLRenderer,
} from 'three';

function addTower(group, { x, width, depth, floors, floorHeight }) {
  const height = floors * floorHeight;
  const shell = new Mesh(
    new BoxGeometry(width, height, depth),
    new MeshStandardMaterial({
      color: 0x17283b,
      metalness: 0.68,
      roughness: 0.31,
    }),
  );
  shell.position.set(x, height / 2, 0);
  shell.castShadow = true;
  shell.receiveShadow = true;
  group.add(shell);

  const slabGeometry = new BoxGeometry(width + 0.12, 0.075, depth + 0.12);
  const slabMaterial = new MeshStandardMaterial({
    color: 0x91a5b8,
    metalness: 0.65,
    roughness: 0.35,
  });
  for (let floor = 0; floor <= floors; floor += 1) {
    const slab = new Mesh(slabGeometry, slabMaterial);
    slab.position.set(x, floor * floorHeight, 0);
    group.add(slab);
  }

  const columns = Math.max(2, Math.floor(width / 0.62));
  const windowGeometry = new BoxGeometry(0.34, floorHeight * 0.57, 0.035);
  const windowMaterials = [
    new MeshStandardMaterial({
      color: 0x86c9e5,
      emissive: 0x17577b,
      emissiveIntensity: 0.32,
      metalness: 0.5,
      roughness: 0.18,
    }),
    new MeshStandardMaterial({
      color: 0xffd7a0,
      emissive: 0x9c5620,
      emissiveIntensity: 0.38,
      metalness: 0.4,
      roughness: 0.2,
    }),
  ];

  const count = columns * floors;
  const windows = windowMaterials.map((material) => {
    const mesh = new InstancedMesh(windowGeometry, material, count);
    mesh.count = 0;
    group.add(mesh);
    return mesh;
  });
  const placement = new Object3D();
  const populated = [0, 0];

  for (let floor = 0; floor < floors; floor += 1) {
    for (let column = 0; column < columns; column += 1) {
      const materialIndex = (floor * 3 + column * 5) % 7 === 0 ? 1 : 0;
      placement.position.set(
        x - width / 2 + ((column + 1) * width) / (columns + 1),
        floor * floorHeight + floorHeight / 2,
        depth / 2 + 0.025,
      );
      placement.updateMatrix();
      windows[materialIndex].setMatrixAt(
        populated[materialIndex],
        placement.matrix,
      );
      populated[materialIndex] += 1;
    }
  }
  windows.forEach((mesh, index) => {
    mesh.count = populated[index];
    mesh.instanceMatrix.needsUpdate = true;
  });
}

export default function ArchitecturalScene() {
  const canvasRef = useRef(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;

    let renderer;
    let animationFrame = 0;
    let observer;
    let scene;
    let building;
    let disposed = false;
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    let pointerX = 0;
    let pointerY = 0;

    const onPointerMove = (event) => {
      if (reducedMotion.matches) return;
      const bounds = canvas.getBoundingClientRect();
      pointerX = ((event.clientX - bounds.left) / bounds.width - 0.5) * 0.35;
      pointerY = ((event.clientY - bounds.top) / bounds.height - 0.5) * 0.2;
    };

    const start = () => {
      try {
        if (disposed) return;

        renderer = new WebGLRenderer({
          canvas,
          alpha: true,
          antialias: true,
          powerPreference: 'low-power',
        });
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
        renderer.setSize(canvas.clientWidth, canvas.clientHeight, false);
        renderer.outputColorSpace = SRGBColorSpace;
        renderer.toneMapping = ACESFilmicToneMapping;
        renderer.toneMappingExposure = 1.15;
        scene = new Scene();

        const camera = new PerspectiveCamera(
          34,
          canvas.clientWidth / Math.max(canvas.clientHeight, 1),
          0.1,
          100,
        );
        camera.position.set(12, 9, 20);
        camera.lookAt(0, 4.5, 0);

        scene.add(new HemisphereLight(0xa9dbff, 0x111827, 2));
        const keyLight = new DirectionalLight(0x9be7ff, 3.2);
        keyLight.position.set(-7, 13, 9);
        scene.add(keyLight);
        const rimLight = new PointLight(0x7772ff, 45, 24);
        rimLight.position.set(7, 7, -2);
        scene.add(rimLight);

        building = new Object3D();
        scene.add(building);
        addTower(building, {
          x: 0,
          width: 5.1,
          depth: 2.8,
          floors: 11,
          floorHeight: 0.92,
        });
        addTower(building, {
          x: -4.15,
          width: 2.9,
          depth: 2.5,
          floors: 7,
          floorHeight: 0.92,
        });
        addTower(building, {
          x: 4.15,
          width: 2.7,
          depth: 2.4,
          floors: 8,
          floorHeight: 0.92,
        });

        const ground = new Mesh(
          new CircleGeometry(8, 64),
          new MeshBasicMaterial({
            color: 0x113953,
            transparent: true,
            opacity: 0.48,
          }),
        );
        ground.rotation.x = -Math.PI / 2;
        ground.position.set(0, -0.13, 0);
        scene.add(ground);

        observer = new ResizeObserver(() => {
          if (!renderer || !canvas.clientWidth || !canvas.clientHeight) return;
          renderer.setSize(canvas.clientWidth, canvas.clientHeight, false);
          camera.aspect = canvas.clientWidth / canvas.clientHeight;
          camera.updateProjectionMatrix();
          renderer.render(scene, camera);
        });
        observer.observe(canvas);
        window.addEventListener('pointermove', onPointerMove);

        const render = () => {
          if (disposed) return;
          if (!reducedMotion.matches) {
            building.rotation.y += (pointerX - building.rotation.y) * 0.018;
            building.rotation.x += (-pointerY - building.rotation.x) * 0.018;
            building.rotation.y += 0.0008;
            renderer.render(scene, camera);
            animationFrame = window.requestAnimationFrame(render);
            return;
          }
          renderer.render(scene, camera);
        };
        render();
      } catch {
        if (!disposed) setFailed(true);
      }
    };

    void start();
    return () => {
      disposed = true;
      window.cancelAnimationFrame(animationFrame);
      observer?.disconnect();
      window.removeEventListener('pointermove', onPointerMove);
      if (scene) {
        scene.traverse((object) => {
          object.geometry?.dispose();
          if (Array.isArray(object.material)) {
            object.material.forEach((material) => material.dispose());
          } else {
            object.material?.dispose();
          }
        });
      }
      renderer?.dispose();
    };
  }, []);

  return (
    <div className={`architecture-scene${failed ? ' architecture-scene--fallback' : ''}`} aria-hidden="true">
      <canvas ref={canvasRef} />
    </div>
  );
}
