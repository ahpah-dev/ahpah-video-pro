/*
 * AhPah Video Pro - GPU colour grading for the Lumetri Color effect.
 * One WebGL fragment shader applies, in order: sharpening, exposure, white balance, tone
 * ranges, colour wheels, contrast, an HSL secondary, saturation and vibrance, curves, fade,
 * and a 3D LUT. If WebGL is unavailable, AVP.gpuOk is false and rendering falls back to CSS
 * filters for the basic controls.
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
    uniform sampler2D curveTex;
    uniform sampler2D lutTex;
    uniform vec2 texel;
    uniform float useCurve;
    uniform float useLut;
    uniform float lutSize;
    uniform float lutAmount;
    uniform float sharpen;
    uniform float exposure;
    uniform float temperature;
    uniform float tint;
    uniform float shadows;
    uniform float highlights;
    uniform float whites;
    uniform float blacks;
    uniform vec3 wheelShadow;
    uniform vec3 wheelMid;
    uniform vec3 wheelHigh;
    uniform float contrast;
    uniform float hslOn;
    uniform float hslHue;
    uniform float hslRange;
    uniform float hslSoft;
    uniform float hslShift;
    uniform float hslSat;
    uniform float hslLum;
    uniform float saturation;
    uniform float vibrance;
    uniform float fade;

    const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);

    float hueOf(vec3 c) {
      float mx = max(c.r, max(c.g, c.b));
      float mn = min(c.r, min(c.g, c.b));
      float d = mx - mn;
      if (d < 0.00001) return 0.0;
      float h;
      if (mx == c.r) h = mod((c.g - c.b) / d, 6.0);
      else if (mx == c.g) h = (c.b - c.r) / d + 2.0;
      else h = (c.r - c.g) / d + 4.0;
      return h / 6.0;
    }

    vec3 hueRotate(vec3 c, float a) {
      float cs = cos(a);
      float sn = sin(a);
      return vec3(
        dot(c, vec3(0.213 + cs * 0.787 - sn * 0.213, 0.715 - cs * 0.715 - sn * 0.715, 0.072 - cs * 0.072 + sn * 0.928)),
        dot(c, vec3(0.213 - cs * 0.213 + sn * 0.143, 0.715 + cs * 0.285 + sn * 0.140, 0.072 - cs * 0.072 - sn * 0.283)),
        dot(c, vec3(0.213 - cs * 0.213 - sn * 0.787, 0.715 - cs * 0.715 + sn * 0.715, 0.072 + cs * 0.928 + sn * 0.072))
      );
    }

    void main() {
      vec4 src = texture2D(tex, uv);
      if (src.a < 0.001) { gl_FragColor = src; return; }
      vec3 rgb = src.rgb;

      // Sharpen: unsharp mask against the four neighbours.
      if (sharpen > 0.0) {
        vec3 blur = (texture2D(tex, uv + vec2(texel.x, 0.0)).rgb + texture2D(tex, uv - vec2(texel.x, 0.0)).rgb +
                     texture2D(tex, uv + vec2(0.0, texel.y)).rgb + texture2D(tex, uv - vec2(0.0, texel.y)).rgb) * 0.25;
        rgb = rgb + (rgb - blur) * sharpen;
      }

      // Exposure and white balance.
      rgb *= pow(2.0, exposure);
      rgb.r += temperature * 0.0025;
      rgb.b -= temperature * 0.0025;
      rgb.g += tint * 0.002;

      // Tone ranges.
      float y = dot(rgb, LUMA);
      float wS = 1.0 - smoothstep(0.0, 0.5, y);
      float wH = smoothstep(0.5, 1.0, y);
      float wW = smoothstep(0.75, 1.0, y);
      float wB = 1.0 - smoothstep(0.0, 0.25, y);
      float wM = smoothstep(0.0, 0.5, y) * (1.0 - smoothstep(0.5, 1.0, y));
      rgb += shadows / 100.0 * 0.25 * wS + highlights / 100.0 * 0.25 * wH + whites / 100.0 * 0.2 * wW + blacks / 100.0 * 0.2 * wB;

      // Colour wheels (shadows, midtones, highlights).
      rgb += wheelShadow * wS + wheelMid * wM + wheelHigh * wH;

      rgb = (rgb - 0.5) * (1.0 + contrast / 100.0) + 0.5;

      // HSL secondary: a hue range that can be shifted, saturated and lifted.
      if (hslOn > 0.5) {
        float h = hueOf(clamp(rgb, 0.0, 1.0));
        float dh = abs(h - hslHue);
        dh = min(dh, 1.0 - dh);
        float w = 1.0 - smoothstep(hslRange, hslRange + hslSoft + 0.0001, dh);
        rgb = hueRotate(rgb, hslShift * w);
        float yl = dot(rgb, LUMA);
        rgb = mix(vec3(yl), rgb, 1.0 + hslSat * w);
        rgb += hslLum * w * 0.3;
      }

      // Saturation and vibrance.
      float yv = dot(rgb, LUMA);
      float mx = max(max(rgb.r, rgb.g), rgb.b);
      float mn = min(min(rgb.r, rgb.g), rgb.b);
      float s = mx > 0.0 ? (mx - mn) / mx : 0.0;
      float sat = saturation / 100.0 + vibrance / 100.0 * (1.0 - s);
      rgb = mix(vec3(yv), rgb, sat);

      // Curves: each channel looked up in its own 256-entry table.
      if (useCurve > 0.5) {
        rgb = clamp(rgb, 0.0, 1.0);
        rgb = vec3(
          texture2D(curveTex, vec2((rgb.r * 255.0 + 0.5) / 256.0, 0.5)).r,
          texture2D(curveTex, vec2((rgb.g * 255.0 + 0.5) / 256.0, 0.5)).g,
          texture2D(curveTex, vec2((rgb.b * 255.0 + 0.5) / 256.0, 0.5)).b
        );
      }

      // Faded film: lifts the blacks and softens the whites.
      float f = fade / 100.0;
      rgb = rgb * (1.0 - f * 0.3) + f * 0.12;

      // 3D LUT, stored as a 2D atlas of blue slices; interpolated between the two nearest slices.
      if (useLut > 0.5) {
        vec3 cc = clamp(rgb, 0.0, 1.0) * (lutSize - 1.0);
        float z0 = floor(cc.b);
        float z1 = min(z0 + 1.0, lutSize - 1.0);
        float fz = cc.b - z0;
        float w = lutSize * lutSize;
        vec3 a = texture2D(lutTex, vec2((z0 * lutSize + cc.r + 0.5) / w, (cc.g + 0.5) / lutSize)).rgb;
        vec3 b = texture2D(lutTex, vec2((z1 * lutSize + cc.r + 0.5) / w, (cc.g + 0.5) / lutSize)).rgb;
        rgb = mix(rgb, mix(a, b, fz), lutAmount);
      }

      gl_FragColor = vec4(clamp(rgb, 0.0, 1.0), src.a);
    }`;

  const UNIFORMS = [
    'useCurve', 'useLut', 'lutSize', 'lutAmount', 'sharpen', 'exposure', 'temperature', 'tint', 'shadows',
    'highlights', 'whites', 'blacks', 'contrast', 'hslOn', 'hslHue', 'hslRange', 'hslSoft', 'hslShift',
    'hslSat', 'hslLum', 'saturation', 'vibrance', 'fade', 'texel',
  ];

  let canvas = null;
  let gl = null;
  let prog = null;
  let texSrc = null;
  let texCurve = null;
  let texLut = null;
  const uniforms = {};
  const fallbackLut = new Uint8Array(4);

  function compile(type, src) {
    const sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh));
    return sh;
  }

  function makeTexture() {
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
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

      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      texSrc = makeTexture();
      texCurve = makeTexture();
      texLut = makeTexture();
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, fallbackLut);

      // Texture units: 0 = frame, 1 = curves, 2 = LUT.
      gl.uniform1i(gl.getUniformLocation(prog, 'tex'), 0);
      gl.uniform1i(gl.getUniformLocation(prog, 'curveTex'), 1);
      gl.uniform1i(gl.getUniformLocation(prog, 'lutTex'), 2);
      UNIFORMS.forEach((n) => (uniforms[n] = gl.getUniformLocation(prog, n)));
      uniforms.wheelShadow = gl.getUniformLocation(prog, 'wheelShadow');
      uniforms.wheelMid = gl.getUniformLocation(prog, 'wheelMid');
      uniforms.wheelHigh = gl.getUniformLocation(prog, 'wheelHigh');
      AVP.gpuOk = true;
    } catch (err) {
      AVP.gpuOk = false;
      gl = null;
    }
  }

  // Converts the colour-wheel and HSL controls into the shader's units.
  function toShaderParams(p) {
    const C = AVP.color;
    const wheel = (x, y, l) => C.wheelOffset(p[x] || 0, p[y] || 0, p[l] || 0);
    const hsl = {
      hue: (p.hslHue || 0) / 360,
      range: ((p.hslRange == null ? 0 : p.hslRange) / 100) * 0.5,
      soft: ((p.hslSoft || 0) / 100) * 0.25,
      shift: ((p.hslShift || 0) * Math.PI) / 180,
      sat: (p.hslSat || 0) / 100,
      lum: (p.hslLum || 0) / 100,
    };
    return {
      shadow: wheel('sx', 'sy', 'sl'),
      mid: wheel('mx', 'my', 'ml'),
      high: wheel('hx', 'hy', 'hl'),
      hsl,
    };
  }

  /*
   * Grades `src` (a canvas) with the Lumetri settings in `p`. `extras` may hold
   * { curve: Uint8Array(1024) from AVP.color.curveLut, lut: { size, atlas } }.
   * Returns the WebGL canvas (same size as `src`), or null when WebGL is unavailable.
   */
  function grade(src, p, extras) {
    if (!gl) return null;
    extras = extras || {};
    if (canvas.width !== src.width || canvas.height !== src.height) {
      canvas.width = src.width;
      canvas.height = src.height;
    }
    gl.viewport(0, 0, canvas.width, canvas.height);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texSrc);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);

    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, texCurve);
    gl.uniform1f(uniforms.useCurve, extras.curve ? 1 : 0);
    if (extras.curve) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 256, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, extras.curve);

    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, texLut);
    const lut = extras.lut;
    gl.uniform1f(uniforms.useLut, lut ? 1 : 0);
    if (lut) {
      gl.uniform1f(uniforms.lutSize, lut.size);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, lut.size * lut.size, lut.size, 0, gl.RGBA, gl.UNSIGNED_BYTE, lut.atlas);
    }

    const sh = toShaderParams(p);
    gl.uniform1f(uniforms.lutAmount, (p.lutAmount == null ? 100 : p.lutAmount) / 100);
    gl.uniform1f(uniforms.sharpen, ((p.sharpen || 0) / 100) * 1.5);
    gl.uniform2f(uniforms.texel, 1 / src.width, 1 / src.height);
    gl.uniform1f(uniforms.exposure, p.exposure || 0);
    gl.uniform1f(uniforms.temperature, p.temperature || 0);
    gl.uniform1f(uniforms.tint, p.tint || 0);
    gl.uniform1f(uniforms.shadows, p.shadows || 0);
    gl.uniform1f(uniforms.highlights, p.highlights || 0);
    gl.uniform1f(uniforms.whites, p.whites || 0);
    gl.uniform1f(uniforms.blacks, p.blacks || 0);
    gl.uniform3f(uniforms.wheelShadow, sh.shadow[0], sh.shadow[1], sh.shadow[2]);
    gl.uniform3f(uniforms.wheelMid, sh.mid[0], sh.mid[1], sh.mid[2]);
    gl.uniform3f(uniforms.wheelHigh, sh.high[0], sh.high[1], sh.high[2]);
    gl.uniform1f(uniforms.contrast, p.contrast || 0);
    gl.uniform1f(uniforms.hslOn, p.hslOn ? 1 : 0);
    gl.uniform1f(uniforms.hslHue, sh.hsl.hue);
    gl.uniform1f(uniforms.hslRange, sh.hsl.range);
    gl.uniform1f(uniforms.hslSoft, sh.hsl.soft);
    gl.uniform1f(uniforms.hslShift, sh.hsl.shift);
    gl.uniform1f(uniforms.hslSat, sh.hsl.sat);
    gl.uniform1f(uniforms.hslLum, sh.hsl.lum);
    gl.uniform1f(uniforms.saturation, p.saturation == null ? 100 : p.saturation);
    gl.uniform1f(uniforms.vibrance, p.vibrance || 0);
    gl.uniform1f(uniforms.fade, p.fade || 0);

    gl.drawArrays(gl.TRIANGLES, 0, 6);
    return canvas;
  }

  AVP.gpu = { init, grade, available: () => !!gl };
  AVP.gpuOk = false;
})();
