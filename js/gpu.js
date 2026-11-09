/*
 * AhPah Video Pro - GPU colour grading for the Lumetri Color effect.
 * A single WebGL fragment shader applies exposure, white balance, tone ranges (shadows,
 * highlights, whites, blacks), contrast, saturation, vibrance and fade to a frame.
 * If WebGL is unavailable, AVP.gpuOk is false and the editor falls back to CSS filters.
 */
(function () {
  'use strict';

  const AVP = window.AVP;

  const VERTEX = `
    attribute vec2 p;
    varying vec2 uv;
    void main() {
      uv = vec2(p.x * 0.5 + 0.5, 0.5 - p.y * 0.5); // top-left origin, like the canvas
      gl_Position = vec4(p, 0.0, 1.0);
    }`;

  const FRAGMENT = `
    precision highp float;
    varying vec2 uv;
    uniform sampler2D tex;
    uniform float exposure;     // stops
    uniform float temperature;  // -100..100
    uniform float tint;         // -100..100
    uniform float shadows;      // -100..100
    uniform float highlights;   // -100..100
    uniform float whites;       // -100..100
    uniform float blacks;       // -100..100
    uniform float contrast;     // -100..100
    uniform float saturation;   // 0..200 (100 = unchanged)
    uniform float vibrance;     // -100..100
    uniform float fade;         // 0..100
    void main() {
      vec4 c = texture2D(tex, uv);
      if (c.a < 0.001) { gl_FragColor = c; return; }
      vec3 rgb = c.rgb;
      rgb *= pow(2.0, exposure);
      rgb.r += temperature * 0.0025;
      rgb.b -= temperature * 0.0025;
      rgb.g += tint * 0.002;
      float y = dot(rgb, vec3(0.2126, 0.7152, 0.0722));
      float wShadow = 1.0 - smoothstep(0.0, 0.5, y);
      float wHigh = smoothstep(0.5, 1.0, y);
      float wWhite = smoothstep(0.75, 1.0, y);
      float wBlack = 1.0 - smoothstep(0.0, 0.25, y);
      rgb += shadows / 100.0 * 0.25 * wShadow;
      rgb += highlights / 100.0 * 0.25 * wHigh;
      rgb += whites / 100.0 * 0.2 * wWhite;
      rgb += blacks / 100.0 * 0.2 * wBlack;
      rgb = (rgb - 0.5) * (1.0 + contrast / 100.0) + 0.5;
      float y2 = dot(rgb, vec3(0.2126, 0.7152, 0.0722));
      float mx = max(max(rgb.r, rgb.g), rgb.b);
      float mn = min(min(rgb.r, rgb.g), rgb.b);
      float s = mx > 0.0 ? (mx - mn) / mx : 0.0;
      float sat = saturation / 100.0 + vibrance / 100.0 * (1.0 - s);
      rgb = mix(vec3(y2), rgb, sat);
      float f = fade / 100.0;
      rgb = rgb * (1.0 - f * 0.3) + f * 0.12;
      gl_FragColor = vec4(clamp(rgb, 0.0, 1.0), c.a);
    }`;

  let canvas = null;
  let gl = null;
  let prog = null;
  let tex = null;
  let uniforms = {};

  function compile(type, src) {
    const sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh));
    return sh;
  }

  function init() {
    try {
      canvas = document.createElement('canvas');
      gl = canvas.getContext('webgl', { premultipliedAlpha: false, preserveDrawingBuffer: true });
      if (!gl) throw new Error('no webgl');
      prog = gl.createProgram();
      gl.attachShader(prog, compile(gl.VERTEX_SHADER, VERTEX));
      gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FRAGMENT));
      gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
      gl.useProgram(prog);

      const buf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
      const loc = gl.getAttribLocation(prog, 'p');
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

      tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);

      [
        'exposure', 'temperature', 'tint', 'shadows', 'highlights', 'whites', 'blacks',
        'contrast', 'saturation', 'vibrance', 'fade',
      ].forEach((n) => (uniforms[n] = gl.getUniformLocation(prog, n)));
      AVP.gpuOk = true;
    } catch (err) {
      AVP.gpuOk = false;
      gl = null;
    }
  }

  /*
   * Grades `src` (a canvas) with the Lumetri settings in `p`. Returns the WebGL canvas,
   * which has the same size as `src`, or null when WebGL is not available.
   */
  function grade(src, p) {
    if (!gl) return null;
    if (canvas.width !== src.width || canvas.height !== src.height) {
      canvas.width = src.width;
      canvas.height = src.height;
    }
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
    gl.uniform1f(uniforms.exposure, p.exposure || 0);
    gl.uniform1f(uniforms.temperature, p.temperature || 0);
    gl.uniform1f(uniforms.tint, p.tint || 0);
    gl.uniform1f(uniforms.shadows, p.shadows || 0);
    gl.uniform1f(uniforms.highlights, p.highlights || 0);
    gl.uniform1f(uniforms.whites, p.whites || 0);
    gl.uniform1f(uniforms.blacks, p.blacks || 0);
    gl.uniform1f(uniforms.contrast, p.contrast || 0);
    gl.uniform1f(uniforms.saturation, p.saturation == null ? 100 : p.saturation);
    gl.uniform1f(uniforms.vibrance, p.vibrance || 0);
    gl.uniform1f(uniforms.fade, p.fade || 0);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    return canvas;
  }

  AVP.gpu = { init, grade, available: () => !!gl };
  AVP.gpuOk = false;
})();
