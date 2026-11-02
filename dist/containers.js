// Containers are FlowDeco rectangles, separate from workflow tabs. Their origin
// is the top-left corner and game Y increases upwards (FlowColliderManager).
export function compactSnapshot(snapshot){
  const native=snapshot?.sections?.native;
  if(!native?.data?.Flows)return snapshot;
  return {...snapshot,sections:{...snapshot.sections,native:{...native,data:{Flows:native.data.Flows.map(f=>({Label:f.Label,Decorations:f.Decorations||[]}))}}}};
}
const vector=value=>Array.isArray(value)&&value.length===2&&value.every(Number.isFinite);
const inside=(point,container)=>vector(point)&&point[0]>=container.position[0]&&point[0]<container.position[0]+container.size[0]&&point[1]<=container.position[1]&&point[1]>container.position[1]-container.size[1];
const contains=(parent,child)=>parent.size[0]*parent.size[1]>child.size[0]*child.size[1]&&child.position[0]>=parent.position[0]&&child.position[0]+child.size[0]<=parent.position[0]+parent.size[0]&&child.position[1]<=parent.position[1]&&child.position[1]-child.size[1]>=parent.position[1]-parent.size[1];
export function groupContainers(snapshot){
  const groups=[],byBuildingId=new Map(),flows=snapshot?.sections?.factory?.data?.flows||[],native=snapshot?.sections?.native?.data?.Flows||[];
  for(const flow of flows){
    const flowName=flow.name||`Workshop ${Number(flow.index||0)+1}`;
    const decorations=flow.decorations||native[flow.index??flows.indexOf(flow)]?.Decorations||[];
    const containers=decorations.map((d,index)=>({d,index})).filter(({d})=>d.Label==null&&d.Sticker==null&&vector(d.Position)&&vector(d.Size)&&d.Size[0]>0&&d.Size[1]>0)
      .map(({d,index},number)=>({id:flow.id+':container:'+index,flowId:flow.id,flowName,index,label:'Container '+(number+1),position:d.Position,size:d.Size,style:d.StyleIndex||0,buildings:[],outside:false}));
    // Labels can straddle the top border, leaving their top-left anchor outside.
    // Use each decoration's center and give it one home in the smallest container.
    const decorationOwner=d=>{
      const point=vector(d.Position)&&vector(d.Size)&&d.Size.every(n=>n>0)?[d.Position[0]+d.Size[0]/2,d.Position[1]-d.Size[1]/2]:d.Position;
      return containers.filter(c=>inside(point,c)).sort((a,b)=>a.size[0]*a.size[1]-b.size[0]*b.size[1]||a.index-b.index)[0];
    };
    for(const d of decorations.filter(d=>typeof d.Label==='string'&&d.Label.trim())){
      const owner=decorationOwner(d);
      if(owner&&!owner.named){owner.label=d.Label.trim();owner.named=true;}
    }
    for(const d of decorations.filter(d=>d.Sticker?.Type==='IconSticker'&&/^Icons2?_\d+$/.test(d.Sticker.IconName))){
      const owner=decorationOwner(d);
      if(owner&&!owner.icon)owner.icon=d.Sticker.IconName;
    }
    for(const c of containers){c.parentId=containers.filter(p=>contains(p,c)).sort((a,b)=>a.size[0]*a.size[1]-b.size[0]*b.size[1]||a.index-b.index)[0]?.id||null;c.children=[];}
    const outside={id:flow.id+':outside',flowId:flow.id,flowName,label:'Outside containers',style:0,buildings:[],outside:true,parentId:null,children:[]};
    for(const building of flow.buildings||[]){
      // One deterministic home per building: its anchor position, choosing the
      // smallest container for nested/overlapping rectangles. Never double count.
      const owner=containers.filter(c=>inside(building.position,c)).sort((a,b)=>a.size[0]*a.size[1]-b.size[0]*b.size[1]||a.index-b.index)[0]||outside;
      owner.buildings.push(building);byBuildingId.set(building.id,owner.id);
    }
    groups.push(...containers);if(outside.buildings.length||!containers.length)groups.push(outside);
  }
  for(const group of groups){
    const types=new Map();group.machines=0;
    for(const b of group.buildings){const machines=Math.max(1,b.stackSize||1);group.machines+=machines;const row=types.get(b.type)||{type:b.type,count:0,machines:0};row.count++;row.machines+=machines;types.set(b.type,row);}
    group.types=[...types.values()].sort((a,b)=>b.count-a.count||a.type.localeCompare(b.type));
  }
  const byId=new Map(groups.map(g=>[g.id,g]));
  for(const group of groups)if(group.parentId)byId.get(group.parentId).children.push(group.id);
  function totals(group,depth=0,path=[]){
    group.depth=depth;group.path=[...path,group.label];group.buildingIds=new Set(group.buildings.map(b=>b.id));group.totalMachines=group.machines;group.descendants=0;
    for(const id of group.children){const child=byId.get(id);totals(child,depth+1,group.path);for(const buildingId of child.buildingIds)group.buildingIds.add(buildingId);group.totalMachines+=child.totalMachines;group.descendants+=1+child.descendants;}
    group.totalBuildings=group.buildingIds.size;
  }
  const roots=groups.filter(g=>!g.parentId);for(const root of roots)totals(root);
  return {groups,byBuildingId,byId,roots};
}
