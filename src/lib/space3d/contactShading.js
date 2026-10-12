import * as T from 'three'

/** Near-field occlusion on a receiving surface, not a baked movable shadow.
 * Each footprint follows its actual mesh; lifting it fades the contact to zero.
 * Direct shadow direction, shadow filtering and the offline maps are untouched.
 */
export function installContactShading(material, entries, plane, planeHeight) {
  const centers=entries.map(()=>new T.Vector4()),gates=entries.map(()=>new T.Vector4())
  const point=new T.Vector3(),previous=material.onBeforeCompile
  const previousKey=material.customProgramCacheKey.call(material)
  material.onBeforeCompile=shader=>{
    previous.call(material,shader)
    shader.uniforms.spaceContacts={value:centers};shader.uniforms.spaceContactGates={value:gates}
    shader.vertexShader='varying vec3 spaceContactWorld;\n'+shader.vertexShader
    shader.vertexShader=shader.vertexShader.replace('#include <worldpos_vertex>',
      '#include <worldpos_vertex>\nspaceContactWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;')
    shader.fragmentShader=`varying vec3 spaceContactWorld;\nuniform vec4 spaceContacts[${entries.length}];\nuniform vec4 spaceContactGates[${entries.length}];\n`+shader.fragmentShader
    shader.fragmentShader=shader.fragmentShader.replace('#include <aomap_fragment>',`
      #include <aomap_fragment>
      float spaceOcclusion = 0.0;
      for (int i=0; i<${entries.length}; i++) {
        vec2 delta = spaceContactWorld.${plane==='table'?'xz':'xy'} - spaceContacts[i].xy;
        delta=mat2(spaceContactGates[i].z,-spaceContactGates[i].y,spaceContactGates[i].y,spaceContactGates[i].z)*delta;
        float corner=spaceContactGates[i].w;
        vec2 edge=abs(delta)-spaceContacts[i].zw+corner;
        float distance=length(max(edge,vec2(0.0)))+min(max(edge.x,edge.y),0.0)-corner;
        float contact=(1.0-smoothstep(0.0,0.009,distance))*spaceContactGates[i].x;
        spaceOcclusion=max(spaceOcclusion,contact);
      }
      reflectedLight.indirectDiffuse *= 1.0 - spaceOcclusion * 0.60;
      reflectedLight.indirectSpecular *= 1.0 - spaceOcclusion * 0.45;
    `)
  }
  material.customProgramCacheKey=()=>`${previousKey}:contacts:${plane}:${entries.length}`
  const update=()=>{
    for(let i=0;i<entries.length;i++){
      const entry=entries[i];if(entry.local)point.copy(entry.local);else point.set(0,0,0);entry.mesh.localToWorld(point)
      centers[i].set(point.x,plane==='table'?point.z:point.y,...entry.halfSize)
      const gap=Math.abs((plane==='table'?point.y:point.z)-planeHeight-(entry.baseOffset??0))
      const angle=plane==='table'?0:entry.mesh.rotation.z
      gates[i].set(1-T.MathUtils.smoothstep(gap,.004,.022),Math.sin(angle),Math.cos(angle),entry.round??.003)
    }
  }
  update.uniforms={centers,gates}
  return update
}
