import { z } from 'zod';
export const driveDecision = z.strictObject({steer:z.enum(['left','straight','right']),throttle:z.enum(['accelerate','coast','brake'])});
export type DriveDecision=z.infer<typeof driveDecision>;
export type CarState={x:number;z:number;speed:number;collisions:number;distance:number;elapsedMs:number};
export const roadCenter=(z:number)=>Math.sin(z/45)*6+Math.sin(z/100)*4;
export const obstacles=Array.from({length:18},(_,i)=>({z:32+i*27,offset:i%3===0?-3.1:i%3===1?3.1:0}));
export const driveInput=z.strictObject({x:z.number().finite(),z:z.number().finite(),speed:z.number().min(0).max(40),collisions:z.number().int().nonnegative(),distance:z.number().nonnegative(),elapsedMs:z.number().min(0).max(10000)});
export function drivingContext(state:CarState){return{...state,laneOffset:state.x-roadCenter(state.z),roadHalfWidth:6,lookahead:[8,20,40].map(d=>({distance:d,centerX:roadCenter(state.z+d)})),obstacles:obstacles.filter(o=>o.z>state.z&&o.z-state.z<55).map(o=>({distance:o.z-state.z,x:roadCenter(o.z)+o.offset})),goal:'Drive forward through the city, stay on the road, avoid parked cars. Steer left decreases x; right increases x. Straight holds x. Accelerate when clear. No reverse.'};}
export class DrivingEngine {
  state:CarState={x:0,z:0,speed:8,collisions:0,distance:0,elapsedMs:0};
  control:DriveDecision={steer:'straight',throttle:'coast'};
  private startMs=0;private lastMs=0;private hits=new Set<number>();running=false;
  start(now:number){this.state={x:0,z:0,speed:8,collisions:0,distance:0,elapsedMs:0};this.control={steer:'straight',throttle:'coast'};this.startMs=now;this.lastMs=now;this.hits.clear();this.running=true;}
  tick(now:number){if(!this.running)return this.state;const end=Math.min(now,this.startMs+10000);let remaining=Math.max(0,(end-this.lastMs)/1000);this.lastMs=end;
    while(remaining>0){const dt=Math.min(remaining,.02);remaining-=dt;const s=this.state;s.speed=Math.max(0,Math.min(30,s.speed+(this.control.throttle==='accelerate'?5:this.control.throttle==='brake'?-12:-.6)*dt));s.x+=(this.control.steer==='left'?-4:this.control.steer==='right'?4:0)*dt;const dz=s.speed*dt;s.z+=dz;s.distance+=dz;
      const center=roadCenter(s.z);if(Math.abs(s.x-center)>5.5){s.x=center+Math.sign(s.x-center)*5.5;s.speed*=.7;if(!this.hits.has(-1)){s.collisions++;this.hits.add(-1);}}else this.hits.delete(-1);
      obstacles.forEach((o,i)=>{if(Math.abs(o.z-s.z)<2.8&&Math.abs(roadCenter(o.z)+o.offset-s.x)<1.7&&!this.hits.has(i)){s.collisions++;s.speed*=.25;this.hits.add(i);}});
    }this.state.elapsedMs=Math.min(10000,Math.max(0,end-this.startMs));if(this.state.elapsedMs>=10000)this.running=false;return this.state;}
  apply(control:DriveDecision,now:number){this.tick(now);if(this.running)this.control=driveDecision.parse(control);}
  stop(now:number){this.tick(now);this.running=false;}
}
