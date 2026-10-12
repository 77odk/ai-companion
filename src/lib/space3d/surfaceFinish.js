/** Static, very weak display grain and vignette in the existing material pass.
 * No framebuffer, extra draw call, timer, image or decorative animation.
 */
export function installSurfaceFinish(material, viewport, settings) {
  const previous = material.onBeforeCompile
  const cacheKey = material.customProgramCacheKey.bind(material)
  const previousKey = cacheKey()
  material.onBeforeCompile = shader => {
    previous.call(material, shader)
    shader.uniforms.spaceViewport = { value: viewport }
    shader.uniforms.spaceFinish = { value: settings }
    shader.fragmentShader = 'uniform vec2 spaceViewport;\nuniform vec2 spaceFinish;\n' + shader.fragmentShader
    shader.fragmentShader = shader.fragmentShader.replace('#include <dithering_fragment>', `
      #include <dithering_fragment>
      vec2 spaceUV = gl_FragCoord.xy / spaceViewport;
      float spaceEdge = smoothstep(0.12, 0.72, dot(spaceUV - 0.5, spaceUV - 0.5));
      float spaceGrain = fract(sin(dot(floor(gl_FragCoord.xy), vec2(12.9898,78.233))) * 43758.5453) - 0.5;
      gl_FragColor.rgb = clamp(gl_FragColor.rgb * (1.0 - spaceFinish.x * spaceEdge) + spaceGrain * spaceFinish.y, 0.0, 1.0);
    `)
  }
  material.customProgramCacheKey = () => `${previousKey}:space-finish-075-024`
  material.needsUpdate = true
}
