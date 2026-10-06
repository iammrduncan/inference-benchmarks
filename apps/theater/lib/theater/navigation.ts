import { z } from 'zod';
export const junctions = Array.from({length:25}, (_, id) => ({id, x:id%5, y:Math.floor(id/5)}));
export const closedRoads = [[6,7],[11,12],[17,18],[8,13]] as const;
export function exits(at:number) {
  return [at-5,at+1,at+5,at-1].filter(n=>n>=0&&n<25&&(Math.abs(n-at)===5||Math.floor(n/5)===Math.floor(at/5))&&!closedRoads.some(([a,b])=>(a===at&&b===n)||(b===at&&a===n)))
    .map(to=>({to,cost:1+((at+to)%3),x:to%5,y:Math.floor(to/5)}));
}
export const navigationInput = z.strictObject({position:z.number().int().min(0).max(24),target:z.number().int().min(0).max(24),visited:z.array(z.number().int().min(0).max(24)).max(60)});
export type NavigationState = z.infer<typeof navigationInput>;
export function navigationContext(state:NavigationState) {
  return {...state, positionXY:{x:state.position%5,y:Math.floor(state.position/5)},targetXY:{x:state.target%5,y:Math.floor(state.target/5)},streetGraph:junctions.map(j=>({...j,roads:exits(j.id)})),closedRoads,legalNext:navigationMoves(state.position)};
}
export function fixtureNext(state:NavigationState) {
  // Fixture-only BFS. Live navigation has no pathfinder or substituted move.
  const queue=[{at:state.position,path:[state.position]}], seen=new Set<number>();
  while(queue.length){const v=queue.shift();if(!v)break;if(v.at===state.target)return v.path[1]??v.at;if(seen.has(v.at))continue;seen.add(v.at);for(const n of exits(v.at))queue.push({at:n.to,path:[...v.path,n.to]});}
  return state.position;
}

export function navigationMoves(at:number){return exits(at).map(n=>({...n,move:n.to===at-5?'north':n.to===at+5?'south':n.to===at+1?'east':'west'}));}
