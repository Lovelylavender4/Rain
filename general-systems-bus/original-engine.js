/* Browser adaptation of the installed game's effect rules. See docs/implementation.md. */
;(() => {
  'use strict'
  const D = window.GSB_ORIGINAL_DATA
  const PI = Math.PI,
    TAU = PI * 2
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x))
  const lerp = (a, b, t) => a + (b - a) * clamp(t, 0, 1)
  const inv = (a, b, x) => (a === b ? 0 : clamp((x - a) / (b - a), 0, 1))
  const mod = (x, n) => ((x % n) + n) % n
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y)
  const vec = (x, y) => ({ x, y })
  const norm = (x, y, length = 1) => {
    const d = Math.hypot(x, y) || 1
    return { x: (x / d) * length, y: (y / d) * length }
  }
  const limit = (x, y, max) => (Math.hypot(x, y) > max ? norm(x, y, max) : vec(x, y))
  const image = (uri) =>
    new Promise((resolve, reject) => {
      const img = new Image()
      img.onload = () => resolve(img)
      img.onerror = reject
      img.src = uri
    })
  function hsl(h, s, l) {
    h = mod(h, 1)
    const f = (n) => {
      const k = mod(n + h * 12, 12)
      return l - s * Math.min(l, 1 - l) * Math.max(-1, Math.min(k - 3, 9 - k, 1))
    }
    return [f(0) * 255, f(8) * 255, f(4) * 255]
  }
  const rgb = (c, a = 1) => `rgba(${c.map((v) => Math.round(v)).join(',')},${a})`
  const colorMix = (a, b, t) => a.map((v, i) => lerp(v, b[i], t))
  const colors = [
    { key: 'teal', label: '默认青绿', base: [59, 92, 83], probability: 0 },
    { key: 'red', label: '红色', base: [110, 74, 72], probability: 0.03 },
    { key: 'blue', label: '蓝色', base: [72, 86, 112], probability: 0.03 },
    { key: 'yellow', label: '黄色', base: [116, 108, 72], probability: 0 },
    { key: 'green', label: '绿色', base: [72, 112, 78], probability: 0 },
    { key: 'white', label: '白色', base: [150, 150, 150], probability: 0 },
  ]
  const four = [
    [-1, 0],
    [0, -1],
    [1, 0],
    [0, 1],
  ]

  class OriginalBus {
    constructor(canvas, options) {
      this.canvas = canvas
      this.ctx = canvas.getContext('2d', { alpha: true })
      this.options = options
      this.tick = 0
      this.scene = 'shaft'
      this.cameraIndex = 2
      this.pointer = null
      this.pointerCircle = null
      this.pointerTone = 0
      this.pointerToneRoll = 0.5
      this.pointerLinks = []
      this.pointerLinkStats = { created: 0, broken: 0 }
      this.grab = null
      this.signals = []
      this.totalSignals = 0
      this.seed = 1
      this.mask = document.createElement('canvas')
      this.mask.width = 1400
      this.mask.height = 800
      this.pen = this.mask.getContext('2d')
      this.projection = document.createElement('canvas')
      this.projection.width = 1400
      this.projection.height = 800
      this.proj = this.projection.getContext('2d')
      this.frame = document.createElement('canvas')
      this.frame.width = 1400
      this.frame.height = 800
      this.ink = this.frame.getContext('2d')
      this.noise = Uint8Array.from(atob(D.noise.red), (c) => c.charCodeAt(0))
      this.updateToneColors()
      this.atlas = this.makeGlyphAtlas()
      this.sprites = {}
      this.shader = new window.OriginalShaderPass()
      this.surfaceCache = new Map()
      this.visibleCells = new Uint8Array(95 * 55)
      this.cellTones = new Uint8Array(95 * 55)
      this.field = []
      this.resize()
    }
    resize() {
      this.clearPointer()
      this.signals = []
      const rect = this.canvas.getBoundingClientRect()
      const scale = clamp(this.options.scale ?? 1, 0.65, 2)
      this.viewW = Math.max(1, Math.round(rect.width / scale))
      this.viewH = Math.max(1, Math.round(rect.height / scale))
      this.cols = Math.ceil(this.viewW / 15) + 1
      this.rows = Math.ceil(this.viewH / 15) + 1
      for (const canvas of [this.mask, this.projection, this.frame]) {
        canvas.width = this.viewW
        canvas.height = this.viewH
      }
      this.visibleCells = new Uint8Array(this.cols * this.rows)
      this.cellTones = new Uint8Array(this.cols * this.rows)
      if (this.sourceCamera)
        this.camera = vec(
          this.sourceCamera.x + 700 - this.viewW / 2,
          this.sourceCamera.y + 400 - this.viewH / 2,
        )
      this.pinWallThreads()
      if (this.sourceCamera && this.cables) {
        this.layoutForeground()
        this.resetPageCursors()
        this.scans = Array.from({ length: this.scanCount }, () => this.newScan(true))
      }
      if (this.grid) this.rebuildField()
      if (this.glyphs) {
        for (const g of this.glyphs) {
          g.x = mod(g.x, this.cols)
          g.y = mod(g.y, this.rows)
        }
        this.setDensity(this.options.density)
      }
    }
    random() {
      let t = (this.seed += 0x6d2b79f5)
      t = Math.imul(t ^ (t >>> 15), t | 1)
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
    range(a, b) {
      return a + (b - a) * this.random()
    }
    int(a, b) {
      return Math.floor(this.range(a, b))
    }
    rnv(length = 1) {
      const a = this.random() * TAU
      return vec(Math.cos(a) * length, Math.sin(a) * length)
    }
    chooseTone(value = this.random()) {
      let threshold = 0
      for (let tone = 1; tone < colors.length; tone++) {
        const color = colors[tone]
        threshold += this.options[`${color.key}Probability`] ?? color.probability
        if (value < threshold) return tone
      }
      return 0
    }
    createTone(value = this.random()) {
      return { toneRoll: value, tone: this.chooseTone(value) }
    }
    setColorProbabilities(values, changed = 'red') {
      const entries = colors.slice(1).map((color) => ({
        key: color.key,
        percent: Math.round(
          clamp(
            Number(values[color.key] ?? this.options[`${color.key}Probability`] ?? color.probability) || 0,
            0,
            1,
          ) * 100,
        ),
      }))
      if (entries.reduce((sum, entry) => sum + entry.percent, 0) > 100) {
        const priority = entries.find((entry) => entry.key === changed) || entries[0],
          others = entries.filter((entry) => entry !== priority),
          total = others.reduce((sum, entry) => sum + entry.percent, 0),
          budget = 100 - priority.percent
        for (const entry of others) {
          const share = (entry.percent * budget) / total
          entry.percent = Math.floor(share)
          entry.remainder = share - entry.percent
        }
        let remaining = budget - others.reduce((sum, entry) => sum + entry.percent, 0)
        for (const entry of others.sort((a, b) => b.remainder - a.remainder))
          if (remaining-- > 0) entry.percent++
      }
      for (const entry of entries) this.options[`${entry.key}Probability`] = entry.percent / 100
      const elements = [
        ...(this.glyphs || []),
        ...(this.scans || []),
        ...(this.cursors || []),
        ...(this.circles || []),
        ...(this.circles || []).flatMap((circle) => circle.links),
        ...(this.pointerLinks || []),
        ...(this.field || []),
      ]
      for (const item of elements) {
        item.toneRoll ??= this.random()
        item.tone = this.chooseTone(item.toneRoll)
      }
      this.pointerTone = this.chooseTone(this.pointerToneRoll)
    }
    updateToneColors() {
      const adjust = (base, key) => {
        const settings = this.options.colorAdjustments?.[key],
          saturation = clamp(settings?.saturation ?? 1, 0, 2),
          grayscale = clamp(settings?.grayscale ?? 0, 0, 1),
          brightness = clamp(settings?.brightness ?? 1, 0, 2),
          luminance = base[0] * 0.2126 + base[1] * 0.7152 + base[2] * 0.0722
        return base.map((channel) => {
          const value = clamp(luminance + (channel - luminance) * saturation * (1 - grayscale), 0, 255)
          return clamp(value * brightness, 0, 255)
        })
      }
      this.toneColors = colors.map((color, tone) =>
        adjust(tone === 0 ? this.projectionColor || color.base : color.base, color.key),
      )
      const pointerBases = [[148, 183, 160], [159, 121, 118], [121, 142, 174]]
      this.pointerColors = colors.map((color, tone) =>
        adjust(pointerBases[tone] || color.base.map((channel) => channel + 44), color.key),
      )
    }
    setColorAdjustments(key, values) {
      if (!colors.some((color) => color.key === key)) return
      this.options.colorAdjustments ||= {}
      const settings = this.options.colorAdjustments[key] ||= { saturation: 1, grayscale: 0, brightness: 1 }
      for (const [property, max] of [['saturation', 2], ['grayscale', 1], ['brightness', 2]])
        if (values[property] !== undefined)
          settings[property] = clamp(Number(values[property]) || 0, 0, max)
      this.updateToneColors()
      this.atlas = this.makeGlyphAtlas()
    }
    toneColor(tone = 0, pointer = false) {
      return (pointer ? this.pointerColors : this.toneColors)[tone] || this.toneColors[0]
    }
    async init() {
      for (const [key, s] of Object.entries(D.sprites)) this.sprites[key] = await image(s.uri)
      this.noiseImage = await image(D.noise.uri)
      await this.setScene('shaft')
    }
    makeGlyphAtlas() {
      const atlas = document.createElement('canvas')
      atlas.width = 750
      atlas.height = colors.length * 30
      const c = atlas.getContext('2d'),
        pixels = c.createImageData(750, atlas.height)
      for (let y = 0; y < atlas.height; y++)
        for (let x = 0; x < 750; x++) {
          const p = (y * 750 + x) * 4,
            v = D.glyphMask[(y % 15) * 750 + x] === '1'
          const color = this.toneColor(Math.floor(y / 30))
          pixels.data[p] = color[0]
          pixels.data[p + 1] = color[1]
          pixels.data[p + 2] = color[2]
          pixels.data[p + 3] = y % 30 < 15 === v ? 255 : 0
        }
      c.putImageData(pixels, 0, 0)
      return atlas
    }
    tile(x, y) {
      const [tw, th] = this.room.tiles
      x = clamp(Math.floor(x), 0, tw - 1)
      y = clamp(Math.floor(y), 0, th - 1)
      return this.room.solid[x * th + th - 1 - y] === '1'
    }
    solid(p) {
      return this.tile(p.x / 20, p.y / 20)
    }
    wallRoot(p) {
      const tx = Math.floor(p.x / 20),
        ty = Math.floor(p.y / 20)
      let dir = null
      for (const [x, y] of four)
        if (this.tile(tx + x, ty + y)) {
          dir = vec(-x, -y)
          if (x === 0) p.y = ty * 20 + 10 - dir.y * 20
          else p.x = tx * 20 + 10 - dir.x * 20
        }
      return dir
    }
    screen(p) {
      return vec(p.x - this.camera.x, this.viewH - p.y + this.camera.y)
    }
    inView(p, pad = 50) {
      const s = this.screen(p)
      return s.x > -pad && s.x < this.viewW + pad && s.y > -pad && s.y < this.viewH + pad
    }
    meshColor(f) {
      f = Math.abs(f - 0.5) * 2
      return hsl(
        lerp(1.025, 0.9638889, 0.5 + 0.5 * f ** 3),
        lerp(1, 0.5, inv(0.8, 1, f)),
        lerp(0.5, 0.15, inv(0.7, 1, f)),
      )
    }
    point(x, y) {
      const v = this.rnv(this.random())
      return { x, y, oldx: x, oldy: y, vx: v.x, vy: v.y }
    }
    async setScene(name, camera) {
      if (!D.rooms[name]) return
      this.clearPointer()
      this.signals = []
      this.scene = name
      this.room = D.rooms[name]
      this.seed = (this.options.seed ?? Date.now()) >>> 0
      this.tick = 0
      this.wind = this.rnv(this.random())
      this.glyphs = []
      this.scans = []
      this.cursors = []
      this.pageCursorCount = undefined
      this.cables = []
      this.circles = []
      this.threads = []
      this.neurons = []
      this.neuronFlocks = []
      this.neuronFlockSource = null
      this.fuses = []
      this.sparks = []
      this.grid = {
        x: 0,
        y: 0,
        ox: 0,
        oy: 0,
        vx: 0,
        vy: 0,
        ix: this.int(100, 1000),
        iy: this.int(100, 1000),
      }
      this.amount = this.room.effects.SuperStructureProjector || 0
      this.setDensity(this.options.density)
      const scanAmount = this.amount || this.room.effects.ProjectedScanLines || 0
      this.scanCount = Math.floor(
        (((this.room.tiles[0] * this.room.tiles[1] + Math.max(...this.room.tiles)) * 0.5) / 2000) *
          10 *
          scanAmount,
      )
      for (let i = 0; i < this.scanCount; i++) this.scans.push(this.newScan(true))
      this.cursorCount = this.amount
        ? Math.max(
            1,
            Math.floor(((this.room.tiles[0] * this.room.tiles[1]) / 2000) * 1.2 * this.amount),
          )
        : 0
      for (let i = 0; i < this.cursorCount; i++) this.cursors.push(this.newCursor())
      for (const object of this.room.objects)
        if (object.type === 'CoralNeuron') this.makeCable(object)
      this.makeWallThreads()
      for (const object of this.room.objects)
        if (object.type === 'SuperStructureFuses') this.makeFuse(object)
      const count = this.options.neuronCount ?? 50
      this.setNeuronCount(count)
      for (let i = 0; i < 160; i++) this.step()
      await this.setCamera(camera ?? this.room.defaultCamera)
    }
    async setCamera(index) {
      this.clearPointer()
      this.signals = []
      this.cameraIndex = mod(index, this.room.cameras.length)
      const [x, y] = this.room.cameras[this.cameraIndex]
      this.camera = vec(x, y)
      this.sourceCamera = vec(x, y)
      this.camera = vec(x + 700 - this.viewW / 2, y + 400 - this.viewH / 2)
      this.pinWallThreads()
      this.layoutForeground()
      this.resetPageCursors()
      this.scans = Array.from({ length: this.scanCount }, () => this.newScan(true))
      this.surface = true
      this.projectionColor = this.room.projectionColors[this.cameraIndex]
      this.updateToneColors()
      this.atlas = this.makeGlyphAtlas()
      for (const g of this.glyphs) {
        g.x = this.int(0, this.cols)
        g.y = this.int(0, this.rows)
      }
      this.dust = Array.from(
        { length: Math.floor((this.room.effects.ZeroGSpecks || 0) * 200) },
        () => ({
          ...this.point(
            this.camera.x + this.range(-50, this.viewW + 50),
            this.camera.y + this.range(-50, this.viewH + 50),
          ),
          speed: this.range(0.1, 0.4),
          angle: this.random() * TAU,
          rot: this.range(-4, 4),
          radius: this.range(1, 2),
        }),
      )
      this.rebuildField()
      this.draw(1)
    }
    setDensity(density) {
      this.options.density = density
      this.idealGlyphs = Math.floor(
        (520 * this.amount * density * this.viewW * this.viewH) / (1400 * 800),
      )
      while (this.glyphs.length < this.idealGlyphs / 2) this.addGlyph()
    }
    createNeuron(index) {
      let position = vec(
        this.random() * this.room.tiles[0] * 20,
        this.random() * this.room.tiles[1] * 20,
      )
      for (let n = 0; n < 100 && this.solid(position); n++)
        position = vec(
          this.random() * this.room.tiles[0] * 20,
          this.random() * this.room.tiles[1] * 20,
        )
      const direction = this.rnv()
      return {
        ...this.point(position.x, position.y),
        dx: direction.x,
        dy: direction.y,
        lazyx: direction.x,
        lazyy: direction.y,
        rotation: this.random(),
        revolve: this.range(-1, 1) / this.range(15, 65),
        hue: [0.444444, 0.666667, 0.997222][index % 3],
        pale: this.random() < 0.25,
        life: this.int(40, 220),
      }
    }
    placeNeuron(neuron, index, count) {
      neuron.x = neuron.oldx =
        this.camera.x +
        (0.12 + mod(index * 0.61803398875 + this.cameraIndex * 0.11, 1) * 0.76) * this.viewW
      neuron.y = neuron.oldy = this.camera.y + (0.1 + ((index + 0.5) / count) * 0.8) * this.viewH
      neuron.pageLayout = true
    }
    setNeuronCount(value) {
      const number = Number(value)
      const count = clamp(Number.isFinite(number) ? Math.round(number) : 0, 0, 200)
      this.options.neuronCount = count
      this.neurons.length = Math.min(this.neurons.length, count)
      while (this.neurons.length < count) {
        const index = this.neurons.length,
          neuron = this.createNeuron(index)
        if (this.camera) this.placeNeuron(neuron, index, count)
        this.neurons.push(neuron)
      }
      return count
    }
    addGlyph(x = this.int(0, this.cols), y = this.int(0, this.rows), forceSingle = false) {
      const matrix = !forceSingle && this.random() < 0.05
      const life = this.int(10, 600)
      const g = {
        x,
        y,
        life,
        age: 0,
        selected: this.random() < 0.02,
        procreate: this.random() < 0.5 ? -1 : this.int(1, life),
        matrix,
        ...this.createTone(),
      }
      if (matrix) {
        g.maxX = Math.floor(lerp(1, 70, this.random() * this.amount))
        g.maxY = Math.floor(lerp(1, 70, this.random() * this.amount))
        g.cols = this.int(1, Math.max(2, g.maxX))
        g.rows = this.int(1, Math.max(2, g.maxY))
      }
      this.glyphs.push(g)
    }
    newScan(initial = false) {
      const vertical = this.random() > this.viewH / (this.viewW + this.viewH)
      const max = vertical ? this.viewW : this.viewH
      const origin = this.camera ? (vertical ? this.camera.x : this.camera.y) : 0
      const dir = this.random() < 0.5 ? -1 : 1
      const pos = origin + (initial ? this.random() * max : dir > 0 ? 0 : max)
      return {
        vertical,
        pos,
        old: pos,
        speed: this.range(this.amount ? 1 : 0.5, this.amount ? 7 : 3.5) * dir,
        ...this.createTone(),
      }
    }
    newCursor() {
      const size = this.int(1, 4),
        camera = this.camera || vec(0, 0)
      let x = 2,
        y = 2
      for (let attempt = 0; attempt < 24; attempt++) {
        x = this.int(2, Math.max(3, this.cols - size - 2))
        y = this.int(2, Math.max(3, this.rows - size - 2))
        const center = vec(camera.x + (x + size / 2) * 15, camera.y + (y + size / 2) * 15)
        if (
          this.circles.every(
            (c) =>
              c.cable.pageVisible === false ||
              dist(center, this.circlePosition(c, 1)) > this.circleRadius(c, 1) + size * 11,
          )
        )
          break
      }
      return {
        gx: x,
        gy: y,
        x: camera.x + x * 15 + this.grid.x,
        y: camera.y + y * 15 + this.grid.y,
        oldx: camera.x + x * 15 + this.grid.x,
        oldy: camera.y + y * 15 + this.grid.y,
        size,
        ...this.createTone(),
      }
    }
    resetPageCursors() {
      this.pageCursorCount = this.amount
        ? Math.min(
            this.cursorCount,
            Math.max(1, Math.round(((this.viewW * this.viewH) / (1400 * 800)) * 1.5)),
          )
        : 0
      this.cursors = Array.from({ length: this.pageCursorCount }, () => this.newCursor())
    }
    layoutForeground() {
      if (!this.camera || !this.sourceCamera || !this.cables) return
      const sourceCenter = vec(this.sourceCamera.x + 700, this.sourceCamera.y + 400)
      const candidates = this.cables
        .map((c) => ({
          c,
          distance: dist(
            vec((c.sourceA.x + c.sourceB.x) / 2, (c.sourceA.y + c.sourceB.y) / 2),
            sourceCenter,
          ),
        }))
        .sort((a, b) => a.distance - b.distance)
      const count = Math.min(
        candidates.length,
        clamp(Math.round(((this.viewW * this.viewH) / (1400 * 800)) * 5), 2, 7),
      )
      const columns = clamp(Math.round(Math.sqrt((count * this.viewW) / this.viewH)), 1, 3)
      const rows = Math.max(1, Math.ceil(count / columns))
      for (const c of this.cables) c.pageVisible = false
      for (let row = 0, index = 0; row < rows; row++) {
        const rowCount = Math.floor(count / rows) + (row < count % rows ? 1 : 0)
        for (let column = 0; column < rowCount; column++, index++) {
          const c = candidates[index].c
          const target = vec(
            this.camera.x + ((column + 0.5) / rowCount) * this.viewW,
            this.camera.y + (1 - (row + 0.5) / rows) * this.viewH,
          )
          const center = c.points.reduce(
            (sum, p) => vec(sum.x + p.x / c.points.length, sum.y + p.y / c.points.length),
            vec(0, 0),
          )
          const dx = target.x - center.x,
            dy = target.y - center.y
          for (const p of c.points) {
            p.x += dx
            p.oldx += dx
            p.y += dy
            p.oldy += dy
          }
          for (const p of [c.a, c.b]) {
            p.x += dx
            p.y += dy
          }
          for (const t of c.hairs) {
            for (const p of t.points) {
              p.x += dx
              p.oldx += dx
              p.y += dy
              p.oldy += dy
            }
            if (t.connection?.connection === t) t.connection.connection = null
            t.connection = null
            t.rest = 20
          }
          c.pageVisible = true
          c.pageLayout = true
        }
      }
      for (let i = 0; i < this.neurons.length; i++) {
        this.placeNeuron(this.neurons[i], i, this.neurons.length)
      }
      for (const p of this.dust || []) {
        p.x = p.oldx = this.camera.x + this.random() * this.viewW
        p.y = p.oldy = this.camera.y + this.random() * this.viewH
      }
      for (const circle of this.circles)
        for (const link of circle.links)
          if (link.point) {
            link.sourcePoint ||= { ...link.point }
            const p = link.sourcePoint,
              width = this.room.tiles[0] * 20,
              height = this.room.tiles[1] * 20
            link.point =
              p.x < 0 || p.x > width
                ? vec(
                    this.camera.x + (p.x < 0 ? -10 : this.viewW + 10),
                    this.camera.y + (p.y / height) * this.viewH,
                  )
                : vec(
                    this.camera.x + (p.x / width) * this.viewW,
                    this.camera.y + (p.y < 0 ? -10 : this.viewH + 10),
                  )
          }
    }
    makeCable(object) {
      const a = vec(object.x, object.y),
        b = vec(a.x + object.handle[0], a.y + object.handle[1])
      const length = Math.hypot(...object.handle),
        count = Math.floor(clamp(length / 20, 1, 200))
      const rootA = this.wallRoot(a),
        rootB = this.wallRoot(b)
      const c = {
        a,
        b,
        sourceA: { ...a },
        sourceB: { ...b },
        rootA,
        rootB,
        length,
        conRad: (length / count) * 1.5,
        points: [],
        hairs: [],
        bumps: [],
      }
      for (let i = 0; i < count; i++) {
        const f = i / Math.max(1, count - 1),
          v = this.rnv(this.random())
        c.points.push(this.point(lerp(a.x, b.x, f) + v.x, lerp(a.y, b.y, f) + v.y))
      }
      const pairs = Math.max(0, Math.min(count - 2, 20))
      for (let i = 0; i < pairs; i++) {
        let segment = i + 1
        if (count - 2 > pairs)
          segment =
            rootA && rootB
              ? Math.floor(count / 2 - pairs / 2) + i
              : rootA
                ? count - 1 - pairs + i
                : rootB
                  ? i + 1
                  : i < pairs / 2
                    ? i + 1
                    : count - 1 - pairs + i
        let contour =
          rootA && rootB
            ? Math.min(inv(0, 4, i), inv(pairs - 1, pairs - 5, i))
            : rootA
              ? inv(0, Math.floor(pairs / 2), i)
              : rootB
                ? inv(pairs - 1, Math.floor(pairs / 2), i)
                : Math.max(inv(10, 0, i), inv(pairs - 11, pairs - 1, i))
        for (const side of [-1, 1]) {
          const hair = this.makeThread(
            c.points[segment],
            Math.min(this.range(30, 300), lerp(30, 300, contour)),
            this.meshColor(segment / (count - 1)),
            norm(
              -(c.points[segment + 1].y - c.points[segment].y) * side,
              (c.points[segment + 1].x - c.points[segment].x) * side,
            ),
          )
          hair.cable = c
          hair.segment = segment
          hair.side = side
          c.hairs.push(hair)
        }
      }
      for (let i = 0; i < Math.floor(count * 1.2); i++)
        c.bumps.push({ f: this.random(), offset: this.range(-1, 1), ping: 0 })
      this.cables.push(c)
      if (this.amount) {
        if (!rootA && (rootB || length > 100)) this.makeCircle(c, 0)
        if (!rootB) this.makeCircle(c, count - 1)
      }
    }
    makeCircle(cable, end) {
      const r = lerp(60, 180, inv(40, 700, cable.length))
      const c = {
        cable,
        end,
        base: r,
        r,
        oldr: r,
        target: r,
        blink: 0,
        oldblink: 0,
        blinkTarget: 0,
        blinkTimer: 0,
        rotation: 0,
        oldrotation: 0,
        speed: this.range(0.2, 1) * (this.random() < 0.5 ? -1 : 1),
        spokes: Math.floor((TAU * r) / 50),
        ...this.createTone(),
        links: [],
      }
      for (let i = 0; i < this.circles.length && c.links.length < 5; i++)
        if (this.random() < 0.5)
          c.links.push({ circle: this.circles[i], blink: 0, ...this.createTone() })
      if (this.random() >= 0.5)
        for (let i = 0, n = this.int(1, 4); i < n; i++) {
          const side =
            this.random() < this.room.tiles[1] / (this.room.tiles[0] + this.room.tiles[1])
          const high = this.random() >= 0.5
          c.links.push({
            point: side
              ? vec(
                  high ? this.room.tiles[0] * 20 + 10 : -10,
                  this.random() * this.room.tiles[1] * 20,
                )
              : vec(
                  this.random() * this.room.tiles[0] * 20,
                  high ? this.room.tiles[1] * 20 + 10 : -10,
                ),
            blink: 0,
            ...this.createTone(),
          })
        }
      this.circles.push(c)
    }
    makeThread(base, length, color = [0, 0, 0], direction = null) {
      const n = clamp(Math.floor(Math.max(length, lerp(length, 40, 0.5)) / 15), 2, 20)
      const dir = direction || this.rnv(),
        points = []
      const end = vec(base.x + dir.x * length * 0.6, base.y + dir.y * length * 0.6)
      const r1 = this.rnv(),
        r2 = this.rnv(),
        ca = norm(dir.x + r1.x, dir.y + r1.y, length * 0.3),
        cb = norm(-dir.x + r2.x, -dir.y + r2.y, length * 0.3)
      ca.x += base.x
      ca.y += base.y
      cb.x += end.x
      cb.y += end.y
      for (let i = 0; i < n; i++) {
        const f = i / (n - 1),
          g = 1 - f,
          jitter = this.rnv()
        points.push(
          this.point(
            g * g * g * base.x +
              3 * g * g * f * ca.x +
              3 * g * f * f * cb.x +
              f * f * f * end.x +
              jitter.x,
            g * g * g * base.y +
              3 * g * g * f * ca.y +
              3 * g * f * f * cb.y +
              f * f * f * end.y +
              jitter.y,
          ),
        )
      }
      return { points, conRad: length / n, length, color, base, connection: null, rest: 0, side: 0 }
    }
    makeWallThreads() {
      const [tw, th] = this.room.tiles
      for (const p of this.room.objects.filter((o) => o.type === 'WallMycelia')) {
        const radius = Math.hypot(...p.handle)
        for (let x = Math.floor((p.x - radius) / 20); x <= Math.ceil((p.x + radius) / 20); x++)
          for (let y = Math.floor((p.y - radius) / 20); y <= Math.ceil((p.y + radius) / 20); y++) {
            if (x <= 0 || x >= tw || y <= 0 || y >= th || this.tile(x, y)) continue
            let dx = 0,
              dy = 0
            for (const [ox, oy] of four)
              if (this.tile(x - ox, y - oy) && !this.tile(x + ox, y + oy)) {
                dx += ox
                dy += oy
              }
            if (!dx && !dy) continue
            const d = Math.hypot(x * 20 + 10 - p.x, y * 20 + 10 - p.y)
            const n = Math.floor(lerp(this.range(1, 4), this.random(), inv(radius / 3, radius, d)))
            for (let j = 0; j < n; j++) {
              const dir = norm(dx, dy),
                base = vec(
                  x * 20 + 10 - dir.x * 10 + this.range(-7, 7),
                  y * 20 + 10 - dir.y * 10 + this.range(-7, 7),
                )
              const length = lerp(
                20 +
                  lerp(20, 180, Math.pow(inv(50, 500, radius), 0.5)) *
                    Math.pow(this.random(), 0.25),
                20,
                inv(0, radius, d),
              )
              const thread = this.makeThread(base, length, [0, 0, 0], dir)
              thread.dir = dir
              thread.sourceBase = { ...base }
              this.threads.push(thread)
            }
          }
      }
    }
    pinWallThreads() {
      if (!this.camera || !this.threads) return
      for (const thread of this.threads) {
        const original = thread.sourceBase
        const horizontal = Math.abs(thread.dir.x) >= Math.abs(thread.dir.y)
        const base = horizontal
          ? vec(this.camera.x + (thread.dir.x > 0 ? 0.5 : this.viewW - 0.5), original.y)
          : vec(original.x, this.camera.y + (thread.dir.y > 0 ? 0.5 : this.viewH - 0.5))
        const dx = base.x - thread.base.x,
          dy = base.y - thread.base.y
        for (const p of thread.points) {
          p.x += dx
          p.oldx += dx
          p.y += dy
          p.oldy += dy
        }
        if (thread.connection?.connection === thread) thread.connection.connection = null
        thread.connection = null
        thread.rest = 20
        thread.base = base
        thread.edgeAnchored = true
        // Black roots are invisible without the original wall; retain a faint continuous stem.
        thread.color = hsl(22 / 45, 0.5, 0.14)
        Object.assign(thread.points[0], {
          x: base.x,
          y: base.y,
          oldx: base.x,
          oldy: base.y,
          vx: 0,
          vy: 0,
        })
      }
    }
    makeFuse(p) {
      const x = Math.min(p.x, p.x + p.handle[0]),
        y = Math.min(p.y, p.y + p.handle[1])
      const cols = Math.max(1, Math.floor(Math.abs(p.handle[0]) / 10)),
        rows = Math.max(1, Math.floor(Math.abs(p.handle[1]) / 10))
      this.fuses.push({
        x,
        y,
        cols,
        rows,
        values: new Float32Array(cols * rows),
        previous: new Float32Array(cols * rows),
        mode: new Uint8Array(cols * rows),
        timers: new Float32Array(cols * rows),
      })
    }
    updateGlyphs() {
      const grid = this.grid
      grid.ox = grid.x
      grid.oy = grid.y
      grid.x += grid.vx
      grid.y += grid.vy
      const rn = this.rnv(),
        v = limit(grid.vx + rn.x, grid.vy + rn.y, 5)
      grid.vx = v.x
      grid.vy = v.y
      let mx = grid.x < -15 ? -2 : grid.x > 15 ? 2 : 0,
        my = grid.y < -15 ? -2 : grid.y > 15 ? 2 : 0
      if (mx || my) {
        for (const g of this.glyphs) {
          g.x = mod(g.x + mx, this.cols)
          g.y = mod(g.y + my, this.rows)
        }
        grid.x -= mx * 15
        grid.ox -= mx * 15
        grid.ix += mx
        grid.y -= my * 15
        grid.oy -= my * 15
        grid.iy += my
        this.rebuildField()
      }
      const occupied = new Set(this.glyphs.map((g) => g.x + g.y * this.cols)),
        born = []
      for (const g of this.glyphs) {
        g.age++
        if (g.matrix && this.random() < 0.05) {
          if (this.random() < 0.5)
            g.cols = clamp(g.cols + (this.random() < 0.5 ? -1 : 1), 1, g.maxX)
          else g.rows = clamp(g.rows + (this.random() < 0.5 ? -1 : 1), 1, g.maxY)
        } else if (
          !g.matrix &&
          (g.age === g.procreate ||
            (g.age === 10 && this.random() > 1 / 3 && this.glyphs.length < this.idealGlyphs))
        ) {
          const choices = four
            .map(([dx, dy]) => [g.x + dx, g.y + dy])
            .filter(
              ([x, y]) =>
                x >= 0 &&
                x < this.cols &&
                y >= 0 &&
                y < this.rows &&
                !occupied.has(x + y * this.cols),
            )
          if (choices.length) born.push(choices[this.int(0, choices.length)])
        }
      }
      this.glyphs = this.glyphs.filter((g) => g.age < g.life)
      for (const [x, y] of born) this.addGlyph(x, y, true)
      if (this.glyphs.length < this.idealGlyphs) this.addGlyph()
    }
    sampleNoise(u, v) {
      const x = mod(u * 64 - 0.5, 64),
        y = mod((1 - v) * 64 - 0.5, 64),
        ix = Math.floor(x),
        iy = Math.floor(y),
        fx = x - ix,
        fy = y - iy
      const at = (a, b) => this.noise[mod(b, 64) * 64 + mod(a, 64)] / 255
      return lerp(
        lerp(at(ix, iy), at(ix + 1, iy), fx),
        lerp(at(ix, iy + 1), at(ix + 1, iy + 1), fx),
        fy,
      )
    }
    rebuildField() {
      this.field = Array.from({ length: this.cols * this.rows }, (_, i) => {
        const x = ((i % this.cols) - this.grid.ix) / 1400,
          y = (Math.floor(i / this.cols) - this.grid.iy) / 800
        const wave = Math.sin(
          x * 12.98232 * y * 0.23532 - this.sampleNoise(0.265 + (0.9455 - 0.265) * y, 0.5),
        )
        const second =
          Math.sin(x * 7.62232 * y * 0.19532 - this.sampleNoise(0.235 + (0.973 - 0.235) * y, 0.4)) *
          102438.543
        return {
          id: Math.floor(mod(wave * 43758.5453, 1) * 50),
          cursorId: Math.floor(mod(wave * 23746.232, 1) * 50),
          threshold: mod(second, 1),
          ...this.createTone(mod(wave * 17321.729, 1)),
        }
      })
    }
    connect(a, b, length, soft = false) {
      const dx = a.x - b.x,
        dy = a.y - b.y,
        d = Math.hypot(dx, dy) || 1
      const factor = ((length - d) * 0.5 * (soft ? inv(0, length, d) : 1)) / d
      const x = dx * factor,
        y = dy * factor
      a.x += x
      a.y += y
      a.vx += x
      a.vy += y
      b.x -= x
      b.y -= y
      b.vx -= x
      b.vy -= y
    }
    pushOffWalls(p) {
      const x = Math.floor(p.x / 20),
        y = Math.floor(p.y / 20)
      let fx = 0,
        fy = 0
      for (const [dx, dy] of four)
        if (this.tile(x - dx, y - dy) && !this.tile(x + dx, y + dy)) {
          fx += dx
          fy += dy
        }
      if (fx || fy) {
        const f = norm(fx, fy, 0.3)
        p.vx += f.x
        p.vy += f.y
      }
    }
    updateCable(c) {
      const p = c.points,
        n = p.length
      for (let i = 2; i < n; i++) {
        const f = norm(p[i].x - p[i - 2].x, p[i].y - p[i - 2].y, 0.15)
        p[i - 2].vx -= f.x
        p[i - 2].vy -= f.y
        p[i].vx += f.x
        p[i].vy += f.y
      }
      for (let i = 0; i < n; i++) {
        const v = p[i],
          f = i / Math.max(1, n - 1)
        v.oldx = v.x
        v.oldy = v.y
        v.x += v.vx
        v.y += v.vy
        v.vx *= 0.999
        v.vy *= 0.999
        v.vx += this.wind.x * 0.005
        v.vy += this.wind.y * 0.005
        if (!c.pageLayout) this.pushOffWalls(v)
        const end = f < 0.5 ? c.a : c.b,
          root = f < 0.5 ? c.rootA : c.rootB
        const influence = f < 0.5 ? inv(0.25, 0, f) : inv(0.75, 1, f)
        const force = root ? vec(root.x * 0.5, root.y * 0.5) : limit(end.x - v.x, end.y - v.y, 40)
        v.vx += (force.x * influence) / (root ? 1 : 420)
        v.vy += (force.y * influence) / (root ? 1 : 420)
        if (c.pageVisible !== false && this.grab?.cable !== c) this.brushPoint(v, 100, 0.36)
      }
      const anchor = () => {
        for (const [root, end, v] of [
          [c.rootA, c.a, p[0]],
          [c.rootB, c.b, p[n - 1]],
        ])
          if (root) {
            v.x = end.x - root.x * 10
            v.y = end.y - root.y * 10
            v.vx = v.vy = 0
          }
      }
      anchor()
      for (let i = n - 1; i > 0; i--) this.connect(p[i], p[i - 1], c.conRad, true)
      anchor()
      for (let i = 1; i < n; i++) this.connect(p[i], p[i - 1], c.conRad, true)
      anchor()
      this.applyGrab(c)
      for (const hair of c.hairs) this.updateThread(hair)
      for (const b of c.bumps) {
        b.ping = Math.max(0, b.ping - 0.1)
        if (b.ping === 0 && this.random() < 1 / 60) b.ping = 1
        for (const signal of this.signals) {
          if (
            signal.cable === c &&
            Math.abs(Math.abs(b.f - signal.origin) - signal.age / 72) < 0.045
          )
            b.ping = 1
        }
      }
    }
    updateThread(t) {
      const p = t.points
      for (let i = 0; i < p.length; i++) {
        const v = p[i]
        v.oldx = v.x
        v.oldy = v.y
        v.x += v.vx
        v.y += v.vy
        v.vx *= 0.999
        v.vy *= 0.999
        if (i) this.connect(v, p[i - 1], t.conRad)
        if (i > 1) {
          const f = norm(v.x - p[i - 2].x, v.y - p[i - 2].y, 0.2)
          v.vx += f.x
          v.vy += f.y
          p[i - 2].vx -= f.x
          p[i - 2].vy -= f.y
        }
        if (!t.edgeAnchored && !t.cable?.pageLayout) this.pushOffWalls(v)
        if (i > 0 && t.cable?.pageVisible !== false) this.brushPoint(v, 115, 0.2)
      }
      let base = t.base,
        direction = t.dir
      if (t.cable) {
        const a = t.cable.points[t.segment],
          b = t.cable.points[t.segment + 1]
        base = a
        direction = norm(-(b.y - a.y) * t.side, (b.x - a.x) * t.side)
      }
      p[0].x = base.x
      p[0].y = base.y
      p[0].vx = p[0].vy = 0
      if (direction) {
        p[1].vx += direction.x
        p[1].vy += direction.y
        if (p.length > 2) {
          p[2].vx += direction.x * 0.5
          p[2].vy += direction.y * 0.5
        }
      }
      if (t.connection) {
        const other = t.connection,
          tip = p[p.length - 1],
          end = other.points[other.points.length - 1]
        if (
          other.connection !== t ||
          dist(p[0], other.points[0]) > t.length + other.length ||
          this.random() < 0.005
        ) {
          other.connection = null
          t.connection = null
          t.rest = this.int(20, 200)
        } else if (dist(tip, end) < 10) {
          this.connect(tip, end, 1)
          if (this.random() < 0.05 && this.sparks.length < 30)
            this.sparks.push({
              x: (tip.x + end.x) * 0.5,
              y: (tip.y + end.y) * 0.5,
              life: this.int(6, 20),
              age: 0,
              vx: this.range(-2, 2),
              vy: this.range(-2, 2),
            })
        } else {
          const f = limit(end.x - tip.x, end.y - tip.y, 5)
          tip.vx = lerp(tip.vx, f.x, 0.5)
          tip.vy = lerp(tip.vy, f.y, 0.5)
        }
      } else if (--t.rest < 0 && this.random() < 0.08) {
        const other = this.allThreads[this.int(0, this.allThreads.length)]
        if (
          other &&
          other !== t &&
          other.cable !== t.cable &&
          !other.connection &&
          dist(p[0], other.points[0]) < (t.length + other.length) * 0.75
        ) {
          t.connection = other
          other.connection = t
        }
      }
    }
    step() {
      this.tick++
      if (this.pointer) {
        this.pointer.vx *= 0.72
        this.pointer.vy *= 0.72
      }
      for (const signal of this.signals) signal.age++
      this.signals = this.signals.filter((signal) => signal.age < 90)
      const wind = this.rnv(this.random() * 0.2),
        w = limit(this.wind.x + wind.x, this.wind.y + wind.y, 1)
      this.wind = w
      if (this.amount) this.updateGlyphs()
      for (const s of this.scans) {
        s.old = s.pos
        s.pos +=
          s.speed +
          (this.amount ? (s.vertical ? this.grid.x - this.grid.ox : this.grid.y - this.grid.oy) : 0)
      }
      this.scans = this.scans.filter((s) => {
        const origin = this.camera ? (s.vertical ? this.camera.x : this.camera.y) : 0
        return (
          s.pos >= origin - 200 && s.pos <= origin + (s.vertical ? this.viewW : this.viewH) + 200
        )
      })
      if (this.scans.length < this.scanCount) this.scans.push(this.newScan())
      for (const c of this.cursors) {
        c.oldx = c.x
        c.oldy = c.y
        const camera = this.camera || vec(0, 0)
        const v = limit(
          camera.x + c.gx * 15 + this.grid.x - c.x,
          camera.y + c.gy * 15 + this.grid.y - c.y,
          12,
        )
        c.x += v.x
        c.y += v.y
        if (c.interactionHold > 0) c.interactionHold--
        else {
          if (this.random() < 0.1) c.gx += this.int(-1, 2)
          if (this.random() < 0.1) c.gy += this.int(-1, 2)
        }
      }
      this.cursors = this.cursors.filter(
        (c) =>
          c.gx >= 1 && c.gy >= 1 && c.gx < this.cols - c.size - 1 && c.gy < this.rows - c.size - 1,
      )
      if (this.cursors.length < (this.pageCursorCount ?? this.cursorCount))
        this.cursors.push(this.newCursor())
      this.allThreads = this.threads.concat(this.cables.flatMap((c) => c.hairs))
      for (const c of this.cables) this.updateCable(c)
      for (const t of this.threads) this.updateThread(t)
      for (const c of this.circles) this.updateProjectedCircle(c)
      if (this.pointerCircle && this.options.layers.circles)
        this.updateProjectedCircle(this.pointerCircle, 1 / 320)
      this.updatePointerLinks()
      this.updateNeurons()
      for (const f of this.fuses) {
        f.previous.set(f.values)
        for (let i = 0; i < f.values.length; i++) {
          if (f.timers[i] > 0) f.timers[i]--
          else f.mode[i] = 0
          const mode = f.mode[i]
          if (mode === 1 || mode === 5) f.values[i] = 1
          else if (mode === 2) f.values[i] = 0
          else if (mode === 3) f.values[i] = this.random()
          else if (mode === 4 && Math.floor(f.timers[i]) % 12 > 5)
            f.values[i] = f.values[i] === 0 ? 1 : 0
          else {
            let sum = f.previous[i],
              n = 1
            for (const j of [i - 1, i + 1, i - f.cols, i + f.cols])
              if (j >= 0 && j < f.values.length) {
                sum += f.previous[j]
                n++
              }
            f.values[i] = lerp(clamp(f.values[i] + this.range(-1, 1) / 10, 0, 1), sum / n, 0.5)
          }
          if (this.random() < 0.0025) {
            f.mode[i] = this.int(this.random() < 1 / 3 ? 1 : 2, 5)
            f.timers[i] = this.range(2, 80)
            if (this.random() < 1 / 8000) {
              f.mode[i] = 5
              f.timers[i] = this.range(60, 120)
            }
          }
        }
      }
      for (const p of this.dust || []) {
        p.oldx = p.x
        p.oldy = p.y
        const r = this.rnv(this.random() * 0.05),
          v = norm(p.vx, p.vy, p.speed)
        p.vx = lerp(p.vx, v.x, 0.01) + r.x
        p.vy = lerp(p.vy, v.y, 0.01) + r.y
        p.x += p.vx
        p.y += p.vy
        p.angle += (p.rot * PI) / 180
        if (p.x < this.camera.x - 200) p.x += this.viewW + 400
        if (p.x > this.camera.x + this.viewW + 200) p.x -= this.viewW + 400
        if (p.y < this.camera.y - 200) p.y += this.viewH + 400
        if (p.y > this.camera.y + this.viewH + 200) p.y -= this.viewH + 400
      }
      for (const s of this.sparks) {
        s.age++
        s.x += s.vx
        s.y += s.vy
      }
      this.sparks = this.sparks.filter((s) => s.age < s.life)
    }
    ensureNeuronFlocks() {
      if (this.neuronFlockSource === this.neurons && this.flockPopulation === this.neurons.length)
        return
      this.neuronFlockSource = this.neurons
      this.flockPopulation = this.neurons.length
      const count = Math.min(4, Math.ceil(this.neurons.length / 28))
      this.neuronFlocks = Array.from({ length: count }, () => ({
        mode: 'gather',
        age: 0,
        scatterMix: 0,
        direction: this.rnv(),
        center: vec(0, 0),
        spread: 0,
        members: 0,
        scatterEvents: 0,
        regroupEvents: 0,
      }))
      for (let i = 0; i < this.neurons.length; i++) this.neurons[i].flockIndex = i % count
    }
    updateNeuronFlocks(samples) {
      for (let index = 0; index < this.neuronFlocks.length; index++) {
        const flock = this.neuronFlocks[index],
          members = samples.filter((n) => n.flockIndex === index)
        if (!members.length) continue
        flock.members = members.length
        flock.center = members.reduce(
          (sum, n) => vec(sum.x + n.x / members.length, sum.y + n.y / members.length),
          vec(0, 0),
        )
        flock.spread = Math.sqrt(
          members.reduce((sum, n) => sum + dist(n, flock.center) ** 2, 0) / members.length,
        )
        flock.age++
        const compact = flock.spread < clamp(Math.min(this.viewW, this.viewH) * 0.13, 65, 110)
        if (members.length > 1 && flock.age % 40 === 0) {
          if (flock.mode === 'gather' && flock.age >= 160 && compact && this.random() < 0.35) {
            flock.mode = 'scatter'
            flock.age = 0
            flock.scatterEvents++
            for (let i = 0; i < this.neurons.length; i++) {
              const n = this.neurons[i]
              if (n.flockIndex !== index) continue
              const angle = i * 2.39996323 + this.range(-0.6, 0.6)
              const direction = norm(
                n.x - flock.center.x + Math.cos(angle) * 60,
                n.y - flock.center.y + Math.sin(angle) * 60,
              )
              n.scatterX = direction.x
              n.scatterY = direction.y
            }
          } else if (flock.mode === 'scatter' && flock.age >= 120 && this.random() < 0.3) {
            flock.mode = 'gather'
            flock.age = 0
            flock.regroupEvents++
          }
        }
        flock.scatterMix = lerp(flock.scatterMix, flock.mode === 'scatter' ? 1 : 0, 0.035)
        const drift = this.rnv(0.004)
        flock.direction = norm(flock.direction.x + drift.x, flock.direction.y + drift.y)
      }
    }
    updateNeurons() {
      const [tw, th] = this.room.tiles
      this.ensureNeuronFlocks()
      const samples = this.neurons.map((n) => ({
        x: n.x,
        y: n.y,
        dx: n.dx,
        dy: n.dy,
        flockIndex: n.flockIndex,
      }))
      this.updateNeuronFlocks(samples)
      for (let index = 0; index < this.neurons.length; index++) {
        const n = this.neurons[index],
          flock = this.neuronFlocks[n.flockIndex]
        const scatter = flock.scatterMix,
          gather = 1 - scatter
        n.oldx = n.x
        n.oldy = n.y
        let dx = n.dx,
          dy = n.dy,
          alignX = 0,
          alignY = 0,
          alignmentWeight = 0,
          repelX = 0,
          repelY = 0,
          neighbours = 0
        for (let j = 0; j < samples.length; j++) {
          if (j === index) continue
          const other = samples[j],
            distance = dist(n, other),
            sameFlock = other.flockIndex === n.flockIndex
          if (sameFlock && distance < 280) {
            const weight = inv(280, 0, distance)
            alignX += other.dx * weight
            alignY += other.dy * weight
            alignmentWeight += weight
          }
          const personalSpace = sameFlock ? 22 + scatter * 70 : 70
          if (distance < personalSpace) {
            const separation = norm(n.x - other.x, n.y - other.y, inv(personalSpace, 0, distance))
            repelX += separation.x
            repelY += separation.y
            neighbours++
          }
        }
        if (alignmentWeight > 0) {
          dx += (alignX / alignmentWeight - n.dx) * 0.1 * gather
          dy += (alignY / alignmentWeight - n.dy) * 0.1 * gather
        }
        if (flock.members > 1) {
          const distance = dist(n, flock.center),
            toward = norm(flock.center.x - n.x, flock.center.y - n.y)
          const cohesion = (0.04 + inv(20, 160, distance) * 0.24) * gather
          dx += toward.x * cohesion + flock.direction.x * 0.035 * gather
          dy += toward.y * cohesion + flock.direction.y * 0.035 * gather
        }
        const separation = (0.18 + scatter * 0.25) / Math.sqrt(Math.max(1, neighbours))
        dx += repelX * separation + (n.scatterX || 0) * scatter * 0.38
        dy += repelY * separation + (n.scatterY || 0) * scatter * 0.38
        const vibration = this.rnv(0.015 + scatter * 0.03)
        dx += vibration.x
        dy += vibration.y
        if (this.pointer) {
          const distance = dist(n, this.pointer),
            radius = 185 / (this.options.scale || 1)
          if (distance < radius) {
            const toward = norm(this.pointer.x - n.x, this.pointer.y - n.y),
              proximity = 1 - distance / radius
            const attraction = (this.pointer.down ? -0.55 : distance < 28 ? -0.25 : 0.5) * proximity
            dx += toward.x * attraction - toward.y * proximity * 0.08
            dy += toward.y * attraction + toward.x * proximity * 0.08
          }
        }
        const left = n.pageLayout ? this.camera.x : 0,
          bottom = n.pageLayout ? this.camera.y : 0
        const right = left + (n.pageLayout ? this.viewW : tw * 20),
          top = bottom + (n.pageLayout ? this.viewH : th * 20)
        dx += inv(55, 0, n.x - left) * 2 - inv(55, 0, right - n.x) * 2
        dy += inv(55, 0, n.y - bottom) * 2 - inv(55, 0, top - n.y) * 2
        if (!n.pageLayout && this.solid(vec(n.x + dx * 35, n.y + dy * 35))) {
          dx = -dx
          dy = -dy
        }
        const direction = norm(dx, dy)
        n.dx = direction.x
        n.dy = direction.y
        n.lazyx = lerp(n.lazyx, n.dx, 0.1)
        n.lazyy = lerp(n.lazyy, n.dy, 0.1)
        n.vx += n.dx * 0.8
        n.vy += n.dy * 0.8
        const friction = lerp(1, 0.9, inv(0.2, 3, Math.hypot(n.vx, n.vy)))
        const velocity = limit(n.vx * friction, n.vy * friction, 4.5 + scatter * 0.5)
        n.vx = velocity.x
        n.vy = velocity.y
        n.x += n.vx
        n.y += n.vy
        if (n.pageLayout) {
          n.x = clamp(n.x, left + 6, right - 6)
          n.y = clamp(n.y, bottom + 6, top - 6)
        }
        n.rotation += n.revolve
        if (--n.life <= 0) {
          n.life = this.int(40, 220)
          n.revolve = (this.random() < 0.5 ? -1 : 1) / this.range(15, 65)
          n.hue = [0.444444, 0.666667, 0.997222][this.int(0, 3)]
          n.pale = this.random() < 0.25
        }
      }
    }
    lerpPoint(p, t) {
      return vec(lerp(p.oldx, p.x, t), lerp(p.oldy, p.y, t))
    }
    circlePosition(c, t) {
      return this.lerpPoint(c.cable.points[c.end], t)
    }
    circleRadius(c, t) {
      return lerp(c.oldr, c.r, t) * lerp(1, 0.6, lerp(c.oldblink, c.blink, t))
    }
    updateProjectedCircle(c, blinkChance = 0.0009803922) {
      c.oldr = c.r
      c.oldblink = c.blink
      c.oldrotation = c.rotation
      c.r = lerp(c.r + clamp(c.target - c.r, -0.8, 0.8), c.target, 0.02)
      if (this.random() < 1 / 120) c.target = c.base * this.range(0.8, 1.2)
      if (this.random() < blinkChance) {
        c.blinkTimer = this.int(7, 230)
        c.blinkTarget = 1
      }
      if (c.blinkTimer > 0) c.blinkTimer--
      else c.blinkTarget = 0
      c.blink = lerp(c.blink + clamp(c.blinkTarget - c.blink, -1 / 30, 1 / 30), c.blinkTarget, 0.02)
      c.rotation += (c.speed * 140 * c.speed) / c.r
      for (const link of c.links) {
        if (link.blink > 0) link.blink--
        else if (this.random() < 1 / 300) link.blink = this.int(10, 50)
      }
    }
    pointerRadius(t = 1) {
      return (
        (this.pointerCircle ? this.circleRadius(this.pointerCircle, t) : 26) /
        (this.options.scale || 1)
      )
    }
    updatePointerLinks() {
      if (!this.pointer || !this.options.layers.circles) {
        this.pointerLinks = []
        return
      }
      const scale = this.options.scale || 1
      const range = clamp(Math.hypot(this.viewW, this.viewH) * scale * 0.7, 360, 900) / scale
      const eligible = (circle) => {
        if (circle.cable.pageVisible === false) return false
        const position = this.circlePosition(circle, 1),
          distance = dist(position, this.pointer)
        return (
          this.inView(position, 0) &&
          distance > this.circleRadius(circle, 1) + this.pointerRadius() + 8 / scale &&
          distance < range
        )
      }
      this.pointerLinks = this.pointerLinks.filter((link) => {
        if (!eligible(link.circle) || this.random() < 0.009) {
          this.pointerLinkStats.broken++
          return false
        }
        link.age++
        link.blink = Math.max(0, link.blink - 1)
        if (this.random() < 0.008) link.blink = this.int(4, 12)
        return true
      })
      for (const circle of this.circles) {
        if (this.pointerLinks.length >= 3) break
        if (!eligible(circle) || this.pointerLinks.some((link) => link.circle === circle)) continue
        const chance =
          0.006 + 0.004 * (1 - dist(this.circlePosition(circle, 1), this.pointer) / range)
        if (this.random() < chance) {
          this.pointerLinks.push({ circle, age: 0, blink: 6, ...this.createTone() })
          this.pointerLinkStats.created++
        }
      }
    }
    drawPointerHalo(t) {
      if (!this.pointer || !this.options.layers.circles) return
      const pen = this.proj,
        scale = this.options.scale || 1
      const center = this.screen(this.pointer),
        radius = this.pointerRadius(t)
      pen.clearRect(0, 0, this.viewW, this.viewH)
      pen.globalCompositeOperation = 'source-over'
      pen.lineCap = 'butt'
      for (const link of this.pointerLinks) {
        const circle = link.circle
        if (circle.cable.pageVisible === false) continue
        const raw = this.circlePosition(circle, t),
          end = this.screen(raw)
        const r = this.circleRadius(circle, t),
          distance = dist(raw, this.pointer)
        if (distance <= r + radius) continue
        const direction = norm(end.x - center.x, end.y - center.y)
        pen.strokeStyle = rgb(this.toneColor(link.tone).map((value) => Math.min(255, value * 1.45)))
        pen.globalAlpha = 0.7 * Math.min(1, (link.age + 1) / 6)
        pen.lineWidth = (link.blink > 0 ? 2 : 1) / scale
        pen.beginPath()
        pen.moveTo(center.x + direction.x * radius, center.y + direction.y * radius)
        pen.lineTo(end.x - direction.x * r, end.y - direction.y * r)
        pen.stroke()
      }
      // Clip only this connection layer, preserving the empty interiors of every endpoint ring.
      pen.globalAlpha = 1
      pen.globalCompositeOperation = 'destination-out'
      for (const circle of this.circles) {
        if (circle.cable.pageVisible === false) continue
        const position = this.screen(this.circlePosition(circle, t))
        pen.beginPath()
        pen.arc(
          position.x,
          position.y,
          Math.max(0, this.circleRadius(circle, t) - 0.5 / scale),
          0,
          TAU,
        )
        pen.fill()
      }
      pen.beginPath()
      pen.arc(center.x, center.y, radius, 0, TAU)
      pen.fill()
      pen.globalCompositeOperation = 'source-over'
      pen.strokeStyle = rgb(this.toneColor(this.pointerTone, true))
      pen.globalAlpha = 0.85
      const circle = this.pointerCircle
      const blink = lerp(circle.oldblink, circle.blink, t)
      const cssRadius = radius * scale
      const cssWidth = Math.min(
        cssRadius,
        (cssRadius * 4) / lerp(lerp(circle.oldr, circle.r, t), 4, Math.sqrt(blink)),
      )
      pen.lineWidth = cssWidth / scale
      pen.beginPath()
      pen.arc(center.x, center.y, Math.max(0.1, radius - pen.lineWidth / 2), 0, TAU)
      pen.stroke()
      const angle = (lerp(circle.oldrotation, circle.rotation, t) * PI) / 180
      pen.lineWidth = lerp(4, (cssRadius * PI) / circle.spokes, blink ** 1.5) / scale
      for (let i = 0; i < circle.spokes; i++) {
        const a = angle + (i / circle.spokes) * TAU
        const inner = radius - lerp(1, 5, blink) / scale
        pen.beginPath()
        pen.moveTo(center.x + Math.sin(a) * inner, center.y - Math.cos(a) * inner)
        pen.lineTo(
          center.x + Math.sin(a) * (inner + 10 / scale),
          center.y - Math.cos(a) * (inner + 10 / scale),
        )
        pen.stroke()
      }
      pen.globalAlpha = 1
      this.ink.drawImage(this.projection, 0, 0)
    }
    drawGlyphs(t) {
      const pen = this.pen,
        cells = this.visibleCells
      cells.fill(0)
      this.cellTones.fill(0)
      for (const g of this.glyphs) {
        if (!g.matrix) {
          if (g.x < this.cols && g.y < this.rows) {
            cells[g.x + g.y * this.cols] |= g.selected ? 2 : 1
            this.cellTones[g.x + g.y * this.cols] = g.tone || 0
          }
          continue
        }
        const x0 = Math.floor(g.x - g.cols / 2 - (g.cols % 2 ? 0.5 : 0)),
          y0 = Math.floor(g.y - g.rows / 2 - (g.rows % 2 ? 0.5 : 0))
        const threshold = inv(g.life, 0, g.age) * 0.5
        for (let y = Math.max(0, y0); y < Math.min(this.rows, y0 + g.rows); y++)
          for (let x = Math.max(0, x0); x < Math.min(this.cols, x0 + g.cols); x++)
            if (this.field[x + y * this.cols].threshold <= threshold) {
              cells[x + y * this.cols] |= 1
              this.cellTones[x + y * this.cols] = this.field[x + y * this.cols].tone
            }
      }
      const gx = lerp(this.grid.ox, this.grid.x, t),
        gy = lerp(this.grid.oy, this.grid.y, t)
      pen.imageSmoothingEnabled = false
      for (let i = 0; i < cells.length; i++)
        if (cells[i]) {
          const x = (i % this.cols) * 15 + gx,
            y = this.viewH - Math.floor(i / this.cols) * 15 - gy - 15
          if (cells[i] === 3) {
            pen.fillStyle = rgb(this.toneColor(this.cellTones[i]))
            pen.fillRect(x, y, 15, 15)
          } else
            pen.drawImage(
              this.atlas,
              this.field[i].id * 15,
              this.cellTones[i] * 30 + (cells[i] === 2 ? 15 : 0),
              15,
              15,
              x,
              y,
              15,
              15,
            )
        }
    }
    drawProjections(t) {
      const p = this.pen,
        layers = this.options.layers
      p.clearRect(0, 0, this.viewW, this.viewH)
      p.strokeStyle = rgb(this.toneColor())
      p.fillStyle = rgb(this.toneColor())
      p.lineCap = 'butt'
      if (layers.glyphs && this.amount) this.drawGlyphs(t)
      if (layers.scans) {
        for (const s of this.scans) {
          p.fillStyle = rgb(this.toneColor(s.tone))
          const pos = lerp(s.old, s.pos, t) - (s.vertical ? this.camera.x : this.camera.y)
          for (let j = 0; j < (this.amount ? 2 : 1); j++)
            if (s.vertical) p.fillRect(pos + j * 15 - 1, 0, 2, this.viewH)
            else p.fillRect(0, this.viewH - pos - j * 15 - 1, this.viewW, 2)
        }
        for (const c of this.cursors) {
          p.fillStyle = rgb(this.toneColor(c.tone))
          const pos = this.screen(this.lerpPoint(c, t)),
            size = c.size * 15
          p.fillRect(pos.x - 1, 0, 2, this.viewH)
          p.fillRect(pos.x + size - 1, 0, 2, this.viewH)
          p.fillRect(0, pos.y - 1, this.viewW, 2)
          p.fillRect(0, pos.y - size - 1, this.viewW, 2)
          this.drawCursorGlyphs(pos.x, pos.y - size, size, t, c.tone)
        }
      }
      if (layers.circles)
        for (const c of this.circles) {
          if (c.cable.pageVisible === false) continue
          p.strokeStyle = rgb(this.toneColor(c.tone))
          const raw = this.circlePosition(c, t),
            center = this.screen(raw),
            r = this.circleRadius(c, t),
            blink = lerp(c.oldblink, c.blink, t)
          const rotation = (lerp(c.oldrotation, c.rotation, t) * PI) / 180
          // ProjectedCircle's first sprite restores the sun-blocking disk above Shadows.
          // It clears earlier glyphs/scans without touching the later item/creature layers.
          p.globalCompositeOperation = 'destination-out'
          p.beginPath()
          p.arc(center.x, center.y, r, 0, TAU)
          p.fill()
          p.globalCompositeOperation = 'source-over'
          p.lineWidth = Math.min(r, (r * 4) / lerp(lerp(c.oldr, c.r, t), 4, Math.sqrt(blink)))
          p.beginPath()
          p.arc(center.x, center.y, r - p.lineWidth / 2, 0, TAU)
          p.stroke()
          for (let j = 0; j < c.spokes; j++) {
            const a = (j / c.spokes) * TAU + rotation
            const a1 = r - lerp(1, 5, blink),
              a2 = a1 + 10
            p.lineWidth = lerp(4, (r * PI) / c.spokes, blink ** 1.5)
            p.beginPath()
            p.moveTo(center.x + Math.sin(a) * a1, center.y - Math.cos(a) * a1)
            p.lineTo(center.x + Math.sin(a) * a2, center.y - Math.cos(a) * a2)
            p.stroke()
          }
          for (const link of c.links) {
            p.strokeStyle = rgb(this.toneColor(link.tone))
            if (link.circle?.cable.pageVisible === false) continue
            const end = link.circle ? this.circlePosition(link.circle, t) : link.point
            const r2 = link.circle ? this.circleRadius(link.circle, t) : 0,
              d = dist(raw, end)
            if (d < r + r2) continue
            const dir = norm(end.x - raw.x, end.y - raw.y),
              screenEnd = this.screen(end)
            p.lineWidth = link.blink > 0 && this.random() < 0.7 ? 4 : 2
            p.beginPath()
            p.moveTo(center.x + dir.x * r, center.y - dir.y * r)
            p.lineTo(screenEnd.x - dir.x * r2, screenEnd.y + dir.y * r2)
            p.stroke()
          }
        }
      if (this.pointer && layers.circles) {
        const center = this.screen(this.pointer)
        p.globalCompositeOperation = 'destination-out'
        p.beginPath()
        p.arc(center.x, center.y, this.pointerRadius(t), 0, TAU)
        p.fill()
        p.globalCompositeOperation = 'source-over'
      }
      const projected = this.shader.project(this.mask)
      if (projected) this.ink.drawImage(projected, 0, 0)
      else {
        this.proj.clearRect(0, 0, this.viewW, this.viewH)
        this.proj.globalCompositeOperation = 'source-over'
        this.proj.drawImage(this.mask, 0, 0)
        this.ink.drawImage(this.projection, 0, 0)
      }
    }
    drawCursorGlyphs(x, y, size, t, tone = 0) {
      const pen = this.pen
      const gx = lerp(this.grid.ox, this.grid.x, t),
        gy = lerp(this.grid.oy, this.grid.y, t)
      const x0 = Math.max(0, Math.floor((x - gx) / 15)),
        x1 = Math.min(this.cols, Math.ceil((x + size - gx) / 15))
      const y0 = Math.max(0, Math.floor((this.viewH - y - size - gy) / 15)),
        y1 = Math.min(this.rows, Math.ceil((this.viewH - y - gy) / 15))
      pen.save()
      pen.beginPath()
      pen.rect(x, y, size, size)
      pen.clip()
      pen.imageSmoothingEnabled = false
      // Cursor's default white tint selects the inverse GlyphProjection mask in the game.
      for (let row = y0; row < y1; row++)
        for (let col = x0; col < x1; col++) {
          const glyph = this.field[col + row * this.cols]
          if (glyph)
            pen.drawImage(
              this.atlas,
              glyph.cursorId * 15,
              15 + tone * 30,
              15,
              15,
              col * 15 + gx,
              this.viewH - row * 15 - gy - 15,
              15,
              15,
            )
        }
      pen.restore()
    }
    line(a, b, color, width = 1) {
      const p = this.ink
      p.beginPath()
      p.moveTo(a.x, a.y)
      p.lineTo(b.x, b.y)
      p.strokeStyle = color
      p.lineWidth = width
      p.stroke()
    }
    drawThread(thread, t) {
      const points = thread.points
      let previous = thread.cable
        ? this.lerpPoint(thread.cable.points[thread.segment], t)
        : thread.edgeAnchored
          ? thread.base
          : this.lerpPoint(points[0], t)
      for (let i = 1; i < points.length; i++) {
        const next = this.lerpPoint(points[i], t)
        const f = i / (points.length - 1)
        const color =
          i === points.length - 1 ? [0, 0, 255] : colorMix(thread.color, hsl(22 / 45, 0.5, 0.2), f)
        this.line(this.screen(previous), this.screen(next), rgb(color), 1)
        previous = next
      }
    }
    sprite(name, color, x, y, angle, sx = 1, sy = 1, anchorX = 0.5) {
      const image = this.sprites[name],
        pen = this.ink
      // Small original masks are cached by tint instead of replacing their pixel silhouettes.
      this.tintCache ||= new Map()
      const key = name + color
      if (!this.tintCache.has(key)) {
        const c = document.createElement('canvas')
        c.width = image.width
        c.height = image.height
        const ctx = c.getContext('2d')
        ctx.drawImage(image, 0, 0)
        ctx.globalCompositeOperation = 'source-in'
        ctx.fillStyle = color
        ctx.fillRect(0, 0, c.width, c.height)
        if (this.tintCache.size > 4096) this.tintCache.clear()
        this.tintCache.set(key, c)
      }
      pen.save()
      pen.translate(x, y)
      pen.rotate(angle)
      pen.scale(sx, sy)
      pen.imageSmoothingEnabled = false
      pen.drawImage(this.tintCache.get(key), -image.width * anchorX, -image.height / 2)
      pen.restore()
    }
    drawCable(c, t) {
      if (c.pageVisible === false) return
      if (!c.points.some((p) => this.inView(p, 320))) return
      const pen = this.ink,
        points = c.points
      if (this.options.layers.tendrils) {
        for (let i = 1; i < points.length; i++) {
          const a = this.screen(this.lerpPoint(points[i - 1], t)),
            b = this.screen(this.lerpPoint(points[i], t))
          const dir = norm(b.x - a.x, b.y - a.y),
            normal = vec(-dir.y, dir.x),
            length = dist(a, b) / 5
          const f = i / (points.length - 1),
            rad = lerp(0.2, 1, Math.sqrt(Math.max(0, Math.sin(f * PI))))
          pen.fillStyle = rgb(this.meshColor(f))
          pen.beginPath()
          pen.moveTo(
            a.x - dir.x * length - normal.x * 1.5 * rad,
            a.y - dir.y * length - normal.y * 1.5 * rad,
          )
          pen.lineTo(
            a.x - dir.x * length + normal.x * 1.5 * rad,
            a.y - dir.y * length + normal.y * 1.5 * rad,
          )
          pen.lineTo(
            b.x + dir.x * length + normal.x * 3.5 * rad,
            b.y + dir.y * length + normal.y * 3.5 * rad,
          )
          pen.lineTo(
            b.x + dir.x * length - normal.x * 3.5 * rad,
            b.y + dir.y * length - normal.y * 3.5 * rad,
          )
          pen.closePath()
          pen.fill()
          const coords = [
            [
              a.x - dir.x * length - normal.x * 1.5 * rad,
              a.y - dir.y * length - normal.y * 1.5 * rad,
            ],
            [
              a.x - dir.x * length + normal.x * 1.5 * rad,
              a.y - dir.y * length + normal.y * 1.5 * rad,
            ],
            [
              b.x + dir.x * length - normal.x * 3.5 * rad,
              b.y + dir.y * length - normal.y * 3.5 * rad,
            ],
            [
              b.x + dir.x * length + normal.x * 3.5 * rad,
              b.y + dir.y * length + normal.y * 3.5 * rad,
            ],
          ]
          for (const index of [0, 1, 2, 1, 2, 3])
            this.coralVertices.push(
              coords[index][0] / (this.viewW / 2) - 1,
              1 - coords[index][1] / (this.viewH / 2),
              index % 2,
              (2 * (i - 1) + (index < 2 ? 0 : 1)) / ((points.length - 1) * 2 + 1),
              points.length,
            )
        }
        for (const bump of c.bumps) {
          const index = bump.f * (points.length - 1),
            i = Math.floor(index),
            a = points[i],
            b = points[Math.min(i + 1, points.length - 1)]
          const pos = this.screen(vec(lerp(a.x, b.x, index - i), lerp(a.y, b.y, index - i))),
            normal = norm(-(b.y - a.y), b.x - a.x)
          const rad = lerp(0.2, 1, Math.sqrt(Math.max(0, Math.sin(bump.f * PI)))),
            scale = inv(0, 0.6, rad)
          pos.x += normal.x * bump.offset * 4 * rad
          pos.y -= normal.y * bump.offset * 4 * rad
          this.sprite(
            'deerEyeB',
            rgb(colorMix(this.meshColor(bump.f), [0, 0, 51], 0.25)),
            pos.x,
            pos.y,
            0,
            scale,
            scale,
          )
          pen.globalAlpha = 0.3
          this.sprite(
            'deerEyeB',
            '#ffffff',
            pos.x - 1.5 * rad,
            pos.y - 1.5 * rad,
            0,
            0.5 * scale,
            0.5 * scale,
          )
          pen.globalAlpha = 1
          this.sprite(
            'deerEyeB',
            rgb(hsl(2 / 3, 1, 0.1 + 0.9 * bump.ping)),
            pos.x,
            pos.y,
            0,
            0.5 * scale,
            0.5 * scale,
          )
        }
      }
      if (this.options.layers.mycelia) for (const thread of c.hairs) this.drawThread(thread, t)
    }
    draw(t = 1) {
      if (!this.surface) return
      const pen = this.ink,
        layers = this.options.layers
      pen.clearRect(0, 0, this.viewW, this.viewH)
      pen.globalAlpha = 1
      pen.imageSmoothingEnabled = false
      this.drawProjections(t)
      this.coralVertices = []
      for (const cable of this.cables) this.drawCable(cable, t)
      if (layers.tendrils) {
        const flow = this.shader.coral(
          this.coralVertices,
          this.noiseImage,
          0.5 + this.tick / 4000,
          this.room.darknessControl,
        )
        if (flow) pen.drawImage(flow, 0, 0)
      }
      if (layers.mycelia)
        for (const thread of this.threads)
          if (this.inView(thread.base, thread.length)) this.drawThread(thread, t)
      if (layers.neurons)
        for (const n of this.neurons)
          if (this.inView(n)) {
            const pos = this.screen(this.lerpPoint(n, t)),
              angle = Math.atan2(n.dx, n.dy),
              spin = Math.sin(n.rotation * TAU),
              cos = Math.cos(n.rotation * TAU)
            const color = rgb(hsl(n.hue, 1, n.pale ? 1 : 0.5))
            this.sprite('JetFishEyeA', color, pos.x, pos.y, angle, 0.75, 1.2)
            const opening =
              ((lerp(10, 45, inv(0.06, 0.7, Math.hypot(n.dx - n.lazyx, n.dy - n.lazyy)) ** 2) *
                PI) /
                180) *
              spin
            const lazyAngle = Math.atan2(n.lazyx, n.lazyy) + PI / 2
            for (const side of [-1, 1])
              this.sprite(
                'deerEyeA2',
                color,
                pos.x - n.dx * 4,
                pos.y + n.dy * 4,
                lazyAngle + side * opening,
                1,
                side * spin,
                0,
              )
            this.sprite(
              'JetFishEyeB',
              rgb(hsl(n.hue, n.pale ? 0 : 1, n.pale ? 0.35 : 0.85)),
              pos.x + n.dy * 2 * cos * Math.sign(spin),
              pos.y + n.dx * 2 * cos * Math.sign(spin),
              angle,
              1 - Math.abs(cos),
              1,
            )
          }
      if (layers.fuses)
        for (const f of this.fuses)
          for (let i = 0; i < f.values.length; i++) {
            const pos = this.screen(
              vec(f.x + 5 + (i % f.cols) * 10, f.y + 5 + Math.floor(i / f.cols) * 10),
            )
            if (pos.x < -10 || pos.x > 1410 || pos.y < -10 || pos.y > 810) continue
            const blue = Math.pow(Math.max(0, lerp(f.previous[i], f.values[i], t)), 2.5) * 0.3
            pen.fillStyle =
              f.mode[i] === 5
                ? `rgba(255,0,0,${Math.floor(f.timers[i]) % 8 > 3 ? 1 : 0})`
                : `rgba(0,0,255,${blue})`
            if (blue > 0.001 || f.mode[i] === 5) pen.fillRect(pos.x - 5, pos.y - 5, 10, 10)
          }
      if (layers.dust)
        for (const d of this.dust || []) {
          const p = this.screen(this.lerpPoint(d, t)),
            x = Math.cos(d.angle) * d.radius,
            y = Math.sin(d.angle) * d.radius
          this.line(vec(p.x - x, p.y - y), vec(p.x + x, p.y + y), '#c1c6d48c', 1)
        }
      if (layers.mycelia)
        for (const s of this.sparks) {
          const p = this.screen(s)
          this.line(vec(p.x - 2, p.y), vec(p.x + 2, p.y), '#c3cbff')
          this.line(vec(p.x, p.y - 2), vec(p.x, p.y + 2), '#c3cbff')
        }
      this.drawPointerHalo(t)
      const canvas = this.canvas,
        ctx = this.ctx,
        rect = canvas.getBoundingClientRect(),
        dpr = Math.min(devicePixelRatio || 1, 2)
      if (
        canvas.width !== Math.round(rect.width * dpr) ||
        canvas.height !== Math.round(rect.height * dpr)
      ) {
        canvas.width = Math.round(rect.width * dpr)
        canvas.height = Math.round(rect.height * dpr)
      }
      ctx.setTransform(1, 0, 0, 1, 0, 0)
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      ctx.imageSmoothingEnabled = false
      ctx.drawImage(this.frame, 0, 0, canvas.width, canvas.height)
      canvas.dataset.time = (this.tick / 40).toFixed(4)
      canvas.dataset.ready = 'true'
      canvas.dataset.scene = this.scene
      canvas.dataset.frames = String(Number(canvas.dataset.frames || 0) + 1)
    }
    pointerAt(x, y) {
      if (!this.camera) return
      const rect = this.canvas.getBoundingClientRect()
      const point = vec(
        clamp(x / rect.width, 0, 1) * this.viewW + this.camera.x,
        this.viewH - clamp(y / rect.height, 0, 1) * this.viewH + this.camera.y,
      )
      const previous = this.pointer
      if (!previous) {
        this.pointerToneRoll = this.random()
        this.pointerTone = this.chooseTone(this.pointerToneRoll)
        this.pointerCircle = {
          base: 26,
          r: 26,
          oldr: 26,
          target: this.range(20.8, 31.2),
          blink: 0,
          oldblink: 0,
          blinkTarget: 0,
          blinkTimer: 0,
          rotation: 0,
          oldrotation: 0,
          speed: this.range(0.2, 0.65),
          spokes: 6,
          links: [],
        }
      }
      const down = previous?.down || false
      const velocity = previous
        ? limit((point.x - previous.x) * 8, (point.y - previous.y) * 8, 90)
        : vec(0, 0)
      this.pointer = {
        ...point,
        vx: velocity.x,
        vy: velocity.y,
        down,
        startX: previous?.startX ?? point.x,
        startY: previous?.startY ?? point.y,
        dragging: previous?.dragging || false,
      }
      if (
        down &&
        Math.hypot(point.x - this.pointer.startX, point.y - this.pointer.startY) *
          (this.options.scale || 1) >
          5
      )
        this.pointer.dragging = true
      this.canvas.style.cursor =
        this.grab && this.pointer.dragging
          ? 'grabbing'
          : this.pickCablePoint(point)
            ? 'grab'
            : 'crosshair'
    }
    pickCablePoint(point) {
      const radius = 32 / (this.options.scale || 1)
      let nearest = null,
        distance = radius
      for (const cable of this.cables || []) {
        if (cable.pageVisible === false) continue
        for (let i = 0; i < cable.points.length; i++) {
          if ((i === 0 && cable.rootA) || (i === cable.points.length - 1 && cable.rootB)) continue
          const d = dist(point, cable.points[i])
          if (d < distance) {
            distance = d
            nearest = {
              cable,
              index: i,
              offsetX: cable.points[i].x - point.x,
              offsetY: cable.points[i].y - point.y,
            }
          }
        }
        for (let i = 1; i < cable.points.length; i++) {
          const a = cable.points[i - 1],
            b = cable.points[i]
          const dx = b.x - a.x,
            dy = b.y - a.y
          const fraction = clamp(
            ((point.x - a.x) * dx + (point.y - a.y) * dy) / (dx * dx + dy * dy || 1),
            0,
            1,
          )
          const d = Math.hypot(point.x - a.x - fraction * dx, point.y - a.y - fraction * dy)
          if (d >= distance) continue
          let index = fraction < 0.5 ? i - 1 : i
          if (index === 0 && cable.rootA) index = i
          if (index === cable.points.length - 1 && cable.rootB) index = i - 1
          if ((index === 0 && cable.rootA) || (index === cable.points.length - 1 && cable.rootB))
            continue
          distance = d
          nearest = {
            cable,
            index,
            offsetX: cable.points[index].x - point.x,
            offsetY: cable.points[index].y - point.y,
          }
        }
      }
      return nearest
    }
    beginPointer(x, y) {
      this.pointerAt(x, y)
      if (!this.pointer) return
      this.pointer.down = true
      this.pointer.dragging = false
      this.pointer.startX = this.pointer.x
      this.pointer.startY = this.pointer.y
      this.grab = this.pickCablePoint(this.pointer)
    }
    endPointer(x, y) {
      if (!this.pointer?.down) return
      this.pointerAt(x, y)
      const clicked = !this.pointer.dragging
      this.pointer.down = false
      this.pointer.dragging = false
      this.grab = null
      this.canvas.style.cursor = 'crosshair'
      if (clicked) this.signalAt(x, y)
    }
    clearPointer() {
      this.pointer = null
      this.pointerCircle = null
      this.pointerLinks = []
      this.grab = null
      this.canvas.style.cursor = ''
    }
    brushPoint(point, cssRadius, strength) {
      if (!this.pointer) return
      const radius = cssRadius / (this.options.scale || 1),
        distance = dist(point, this.pointer)
      if (distance >= radius) return
      const falloff = (1 - distance / radius) ** 2
      const push = norm(point.x - this.pointer.x, point.y - this.pointer.y, strength * falloff)
      point.vx += push.x + this.pointer.vx * 0.018 * falloff
      point.vy += push.y + this.pointer.vy * 0.018 * falloff
    }
    applyGrab(cable) {
      if (!this.grab || this.grab.cable !== cable || !this.pointer?.down || !this.pointer.dragging)
        return
      const point = cable.points[this.grab.index]
      const movement = limit(
        this.pointer.x + this.grab.offsetX - point.x,
        this.pointer.y + this.grab.offsetY - point.y,
        30 / (this.options.scale || 1),
      )
      for (
        let i = Math.max(0, this.grab.index - 4);
        i <= Math.min(cable.points.length - 1, this.grab.index + 4);
        i++
      ) {
        if ((i === 0 && cable.rootA) || (i === cable.points.length - 1 && cable.rootB)) continue
        const p = cable.points[i],
          weight = (1 - Math.abs(i - this.grab.index) / 5) ** 2
        p.x += movement.x * 0.65 * weight
        p.y += movement.y * 0.65 * weight
        p.vx = lerp(p.vx, movement.x * 0.04 * weight, 0.3)
        p.vy = lerp(p.vy, movement.y * 0.04 * weight, 0.3)
      }
    }
    signalAt(x, y) {
      if (!this.camera) return
      const rect = this.canvas.getBoundingClientRect()
      const point = vec(
        clamp(x / rect.width, 0, 1) * this.viewW + this.camera.x,
        this.viewH - clamp(y / rect.height, 0, 1) * this.viewH + this.camera.y,
      )
      this.totalSignals++
      const hit = this.pickCablePoint(point)
      let target = hit
      if (!target) {
        let closest = 180 / (this.options.scale || 1)
        for (const cable of this.cables || [])
          if (cable.pageVisible !== false)
            for (let i = 0; i < cable.points.length; i++) {
              const d = dist(point, cable.points[i])
              if (d < closest) {
                closest = d
                target = { cable, index: i }
              }
            }
      }
      if (this.signals.length >= 8) this.signals.shift()
      if (target) {
        const origin = target.index / Math.max(1, target.cable.points.length - 1)
        this.signals.push({ cable: target.cable, origin, age: 0 })
        for (const bump of target.cable.bumps) if (Math.abs(bump.f - origin) < 0.06) bump.ping = 1
        for (const circle of this.circles)
          if (circle.cable === target.cable) {
            circle.blinkTimer = Math.max(circle.blinkTimer, 18)
            circle.blinkTarget = 1
            circle.target = circle.base * 1.12
          }
      }
      if (this.cursors.length) {
        const cursor = this.cursors.reduce((best, c) =>
          dist(c, point) < dist(best, point) ? c : best,
        )
        cursor.gx = clamp(
          Math.round((point.x - this.camera.x - this.grid.x) / 15 - cursor.size / 2),
          1,
          this.cols - cursor.size - 2,
        )
        cursor.gy = clamp(
          Math.round((point.y - this.camera.y - this.grid.y) / 15 - cursor.size / 2),
          1,
          this.rows - cursor.size - 2,
        )
        cursor.interactionHold = Math.ceil(dist(cursor, point) / 12) + 20
      }
      for (let i = 0; i < 8 && this.sparks.length < 50; i++) {
        const v = this.rnv(this.range(0.5, 2.2))
        this.sparks.push({
          x: point.x,
          y: point.y,
          vx: v.x,
          vy: v.y,
          age: 0,
          life: this.int(12, 26),
        })
      }
    }
    diagnostics() {
      return {
        room: this.room.name,
        camera: this.cameraIndex,
        cameras: this.room.cameras.length,
        tickRate: 40,
        glyphSize: 15,
        glyphAtlas: [750, 15],
        glyphSHA256: D.glyphSHA256,
        settingsSHA256: this.room.settingsSHA256,
        glyphs: this.glyphs.length,
        matrices: this.glyphs.filter((g) => g.matrix).length,
        scans: this.scans.length,
        cursors: this.cursors.length,
        scanTarget: this.scanCount,
        cursorTarget: this.cursorCount,
        visibleCursorTarget: this.pageCursorCount,
        visibleCables: this.cables.filter((c) => c.pageVisible !== false).length,
        foregroundCenters: this.cables
          .filter((c) => c.pageVisible !== false)
          .map((c) => {
            const point = c.points.reduce(
              (sum, p) => vec(sum.x + p.x / c.points.length, sum.y + p.y / c.points.length),
              vec(0, 0),
            )
            const screen = this.screen(point)
            return [screen.x / this.viewW, screen.y / this.viewH]
          }),
        cables: this.cables.length,
        circles: this.circles.length,
        swarmers: this.neurons.length,
        neuronBehaviour: {
          flocks: (this.neuronFlocks || []).map((flock) => ({
            mode: flock.mode,
            age: flock.age,
            spread: flock.spread,
            scatterMix: flock.scatterMix,
            scatterEvents: flock.scatterEvents,
            regroupEvents: flock.regroupEvents,
          })),
        },
        cameraPosition: { ...this.camera },
        cableInputs: this.room.objects
          .filter((o) => o.type === 'CoralNeuron')
          .map((o) => [o.x, o.y, ...o.handle]),
        projectionUsesSurfaceStencil: false,
        fillsViewport: true,
        renderScale: this.canvas.clientWidth / this.viewW,
        viewSize: [this.viewW, this.viewH],
        projectionShadowMask: false,
        circleInteriorOcclusion: true,
        wallRootsAtViewport: true,
        sourceCamera: { ...this.sourceCamera },
        projectionDepthWarp: false,
        coralFlowShader: Boolean(this.shader.gl),
        interaction: {
          pointerActive: Boolean(this.pointer),
          pointerHalo: this.pointer
            ? {
                position: [
                  (this.screen(this.pointer).x * this.canvas.clientWidth) / this.viewW,
                  (this.screen(this.pointer).y * this.canvas.clientHeight) / this.viewH,
                ],
                radius: this.pointerRadius() * (this.options.scale || 1),
              }
            : null,
          pointerConnections: this.pointerLinks.length,
          connectionsCreated: this.pointerLinkStats.created,
          connectionsBroken: this.pointerLinkStats.broken,
          dragging: Boolean(this.grab && this.pointer?.dragging),
          signals: this.signals.length,
          totalSignals: this.totalSignals,
          grabPosition: this.grab
            ? (() => {
                const p = this.screen(this.grab.cable.points[this.grab.index])
                return [
                  (p.x * this.canvas.clientWidth) / this.viewW,
                  (p.y * this.canvas.clientHeight) / this.viewH,
                ]
              })()
            : null,
        },
      }
    }
  }
  OriginalBus.colors = colors
  window.OriginalBus = OriginalBus
})()
