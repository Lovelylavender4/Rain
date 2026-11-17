/* Transparent projection compositing and the original CoralNeuron flow pass. */
;(() => {
  'use strict'
  class OriginalShaderPass {
    constructor() {
      this.canvas = document.createElement('canvas')
      this.canvas.width = 1400
      this.canvas.height = 800
      this.gl = this.canvas.getContext('webgl', {
        alpha: true,
        premultipliedAlpha: true,
        preserveDrawingBuffer: true,
        antialias: false,
      })
      if (!this.gl) return
      const gl = this.gl
      const vertex = `attribute vec2 aPos; attribute vec2 aUV; attribute float aSegments;
        varying vec2 uv; varying float segments;
        void main(){gl_Position=vec4(aPos,0.,1.);uv=aUV;segments=aSegments;}`
      this.projectionProgram = this.program(
        vertex,
        `precision highp float;
        varying vec2 uv; uniform sampler2D uMask;
        void main(){
          vec4 color=texture2D(uMask,uv);
          gl_FragColor=vec4(color.rgb*color.a,color.a);
        }`,
      )
      this.coralProgram = this.program(
        vertex,
        `precision highp float;
        varying vec2 uv; varying float segments; uniform sampler2D uNoise;
        uniform float uRain,uDarkness;
        void main(){
          float y=(uv.y+uRain*.1)*segments*.1;
          float h=texture2D(uNoise,vec2(uv.x*.2+uRain*2.1,y)).r+y*.5;
          h=.5+sin((h+uRain*6.)*3.14*2.);h=1.-abs(.5-h)*2.;
          float h2=texture2D(uNoise,vec2(uv.x*.5341+uRain*2.1242,-y)).r-y*.5;
          h2=.5+sin((h2+uRain*6.21)*3.14*2.);h2=1.-abs(.5-h2)*2.;
          h*=h2;h*=pow(1.-abs(.5-uv.x)*2.,.2);h=1.-abs(.5-h)*2.;
          if(h<.75)discard;
          float alpha=mix(.5,.25,uDarkness);gl_FragColor=vec4(vec3(alpha),alpha);
        }`,
      )
      this.buffer = gl.createBuffer()
      this.textures = []
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true)
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false)
      for (let i = 0; i < 4; i++) {
        const texture = gl.createTexture()
        this.textures.push(texture)
        gl.activeTexture(gl.TEXTURE0 + i)
        gl.bindTexture(gl.TEXTURE_2D, texture)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, i === 3 ? gl.LINEAR : gl.NEAREST)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, i === 3 ? gl.LINEAR : gl.NEAREST)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, i === 3 ? gl.REPEAT : gl.CLAMP_TO_EDGE)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, i === 3 ? gl.REPEAT : gl.CLAMP_TO_EDGE)
      }
      gl.clearColor(0, 0, 0, 0)
    }
    program(vertex, fragment) {
      const gl = this.gl,
        p = gl.createProgram()
      for (const [type, source] of [
        [gl.VERTEX_SHADER, vertex],
        [gl.FRAGMENT_SHADER, fragment],
      ]) {
        const s = gl.createShader(type)
        gl.shaderSource(s, source)
        gl.compileShader(s)
        if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s))
        gl.attachShader(p, s)
      }
      gl.linkProgram(p)
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p))
      return p
    }
    texture(unit, source) {
      this.textureSources ||= []
      if (unit !== 0 && this.textureSources[unit] === source) return
      this.textureSources[unit] = source
      const gl = this.gl
      gl.activeTexture(gl.TEXTURE0 + unit)
      gl.bindTexture(gl.TEXTURE_2D, this.textures[unit])
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source)
    }
    use(program, vertices) {
      const gl = this.gl
      gl.viewport(0, 0, this.canvas.width, this.canvas.height)
      gl.clear(gl.COLOR_BUFFER_BIT)
      gl.useProgram(program)
      gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer)
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertices), gl.DYNAMIC_DRAW)
      for (const [name, size, offset] of [
        ['aPos', 2, 0],
        ['aUV', 2, 8],
        ['aSegments', 1, 16],
      ]) {
        const a = gl.getAttribLocation(program, name)
        if (a >= 0) {
          gl.enableVertexAttribArray(a)
          gl.vertexAttribPointer(a, size, gl.FLOAT, false, 20, offset)
        }
      }
    }
    project(mask) {
      if (!this.gl) return null
      const gl = this.gl,
        p = this.projectionProgram
      if (this.canvas.width !== mask.width || this.canvas.height !== mask.height) {
        this.canvas.width = mask.width
        this.canvas.height = mask.height
      }
      this.use(
        p,
        [
          -1, -1, 0, 0, 0, 1, -1, 1, 0, 0, -1, 1, 0, 1, 0, -1, 1, 0, 1, 0, 1, -1, 1, 0, 0, 1, 1, 1,
          1, 0,
        ],
      )
      this.texture(0, mask)
      gl.uniform1i(gl.getUniformLocation(p, 'uMask'), 0)
      gl.disable(gl.BLEND)
      gl.drawArrays(gl.TRIANGLES, 0, 6)
      return this.canvas
    }
    coral(vertices, noise, rain, darkness) {
      if (!this.gl || !vertices.length) return null
      const gl = this.gl,
        p = this.coralProgram
      this.use(p, vertices)
      this.texture(3, noise)
      gl.uniform1i(gl.getUniformLocation(p, 'uNoise'), 3)
      gl.uniform1f(gl.getUniformLocation(p, 'uRain'), rain)
      gl.uniform1f(gl.getUniformLocation(p, 'uDarkness'), darkness)
      gl.enable(gl.BLEND)
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA)
      gl.drawArrays(gl.TRIANGLES, 0, vertices.length / 5)
      return this.canvas
    }
  }
  window.OriginalShaderPass = OriginalShaderPass
})()
