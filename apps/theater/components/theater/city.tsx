'use client';
import { useEffect, useRef } from 'react';
import { DrivingEngine, roadCenter, obstacles } from '../../lib/theater/driving';
export function City({ engine, onReady }: { engine: DrivingEngine; onReady: (status: string) => void }) {
  const host=useRef<HTMLDivElement>(null);
  useEffect(()=>{
    const mount=host.current;if(!mount)return;let disposed=false;let cleanup=()=>{};
    void (async()=>{
      if(!window.isSecureContext)throw new Error('WebGPU needs HTTPS. Open the secure Tailscale link.');
      if(!Reflect.get(navigator,'gpu'))throw new Error('WebGPU is unavailable in this browser. Use a current Chrome, Edge or Safari with WebGPU.');
      const THREE=await import('three/webgpu');
      const renderer=new THREE.WebGPURenderer({antialias:true,alpha:false});
      renderer.setPixelRatio(Math.min(devicePixelRatio,2));
      const scene=new THREE.Scene();scene.background=new THREE.Color('#282a36');scene.fog=new THREE.Fog('#282a36',85,230);
      const camera=new THREE.PerspectiveCamera(52,1,.1,500);
      const geometries=new Set<InstanceType<typeof THREE.BufferGeometry>>();const materials=new Set<InstanceType<typeof THREE.Material>>();
      const cube=new THREE.BoxGeometry(1,1,1);geometries.add(cube);
      const palette=['#44475a','#44475a','#6272a4','#44475a','#6272a4'].map(color=>{const m=new THREE.MeshStandardMaterial({color,roughness:.9});materials.add(m);return m;});
      const material=(color:string)=>{const m=new THREE.MeshStandardMaterial({color,roughness:.75});materials.add(m);return m;};
      const asphalt=material('#282a36'),white=material('#6272a4'),sidewalk=material('#44475a'),green=material('#50fa7b'),glass=material('#8be9fd'),dark=material('#282a36'),carPaint=material('#bd93f9'),light=material('#f1fa8c');
      function box(parent:InstanceType<typeof THREE.Object3D>,x:number,y:number,z:number,w:number,h:number,d:number,mat:InstanceType<typeof THREE.Material>){const m=new THREE.Mesh(cube,mat);m.position.set(x,y,z);m.scale.set(w,h,d);parent.add(m);return m;}
      scene.add(new THREE.HemisphereLight('#8be9fd','#282a36',1.5));const sun=new THREE.DirectionalLight('#ff79c6',1.8);sun.position.set(-30,65,-20);scene.add(sun);
      box(scene,0,-.6,240,500,1,620,material('#282a36'));
      for(let z=-30;z<510;z+=5){const c=roadCenter(z);const angle=Math.atan2(roadCenter(z+1)-roadCenter(z-1),2);const tile=box(scene,c,0,z,13,.15,5.3,asphalt);tile.rotation.y=angle;for(const side of [-1,1]){const walk=box(scene,c+side*7.6,.15,z,2,.35,5.3,sidewalk);walk.rotation.y=angle;}if(z%10===0)box(scene,c,.13,z,.13,.025,2.5,white);}
      for(let i=0;i<80;i++){const z=-20+i*7;const c=roadCenter(z);for(const side of [-1,1]){const h=5+(i*7+(side+1)*3)%23;const x=c+side*(14+(i%3)*4);const mat=palette[(i+(side+1))%palette.length];if(!mat)continue;box(scene,x,h/2,z,7,h,5.5,mat);box(scene,x,h+.25,z,7.3,.5,5.8,white);for(let y=2;y<h-1;y+=3)for(const dz of [-1.5,1.5])box(scene,x-side*3.52,y,z+dz,.05,1.1,1.4,glass);
        if(i%2===0){box(scene,c+side*8.4,1.4,z, .25,2.8,.25,dark);const crown=new THREE.Mesh(new THREE.IcosahedronGeometry(1.5,1),green);geometries.add(crown.geometry);crown.position.set(c+side*8.4,3.7,z);scene.add(crown);}
      }}
      for(const o of obstacles){const x=roadCenter(o.z)+o.offset;box(scene,x,.8,o.z,1.7,1.2,3.6,material('#ffb86c'));box(scene,x,1.5,o.z+.1,1.45,.6,1.6,glass);}
      const car=new THREE.Group();scene.add(car);box(car,0,.65,0,1.9,.8,3.8,carPaint);box(car,0,1.22,-.15,1.55,.7,1.9,glass);box(car,0,1.62,-.15,1.6,.12,1.8,carPaint);
      for(const x of [-1,1])for(const z of [-1.15,1.15])box(car,x,.4,z,.35,.6,.65,dark);
      for(const x of [-.6,.6])box(car,x,.72,1.92,.5,.22,.06,light);
      mount.appendChild(renderer.domElement);renderer.domElement.setAttribute('aria-label','WebGPU third-person city driving');
      const resize=()=>{const {width,height}=mount.getBoundingClientRect();renderer.setSize(Math.max(1,width),Math.max(1,height));camera.aspect=width/Math.max(1,height);camera.updateProjectionMatrix();};
      const observer=new ResizeObserver(resize);observer.observe(mount);resize();
      let raf=0;
      cleanup=()=>{cancelAnimationFrame(raf);observer.disconnect();renderer.dispose();renderer.domElement.remove();geometries.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());};
      await renderer.init();
      if(!Reflect.get(renderer.backend,'isWebGPUBackend'))throw new Error('WebGPU adapter unavailable; no WebGL substitution is used.');
      if(disposed){cleanup();return;}
      camera.position.set(8,8,-13);camera.lookAt(0,1,12);
      await renderer.compileAsync(scene,camera);if(disposed){cleanup();return;}
      onReady('ready');
      const target=new THREE.Vector3();
      const frame=(now:number)=>{if(disposed)return;const s=engine.tick(now);car.position.set(s.x,0,s.z);car.rotation.y=engine.control.steer==='left'?-.13:engine.control.steer==='right'?.13:0;camera.position.set(s.x+7.5,8.5,s.z-14);target.set(s.x,1.1,s.z+14);camera.lookAt(target);renderer.render(scene,camera);raf=requestAnimationFrame(frame);};
      raf=requestAnimationFrame(frame);
    })().catch(error=>{cleanup();if(!disposed)onReady(error instanceof Error?error.message:'WebGPU initialization failed.');});
    return()=>{disposed=true;cleanup();};
  },[engine,onReady]);
  return <div className="city-canvas" ref={host} />;
}
