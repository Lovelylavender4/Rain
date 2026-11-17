/* UI for the original-room renderer. */
;(() => {
  'use strict'
  const $ = (s) => document.querySelector(s)
  const canvas = $('#bus-canvas')
  const reduced = matchMedia('(prefers-reduced-motion: reduce)')
  const colors = window.OriginalBus.colors
  const defaultColorAdjustments = () =>
    Object.fromEntries(colors.map(({ key }) => [key, { saturation: 1, grayscale: 0, brightness: 1 }]))
  const state = {
    paused: reduced.matches,
    density: 1,
    speed: 1,
    scale: 1,
    neuronCount: 50,
    redProbability: 0.03,
    blueProbability: 0.03,
    yellowProbability: 0,
    greenProbability: 0,
    whiteProbability: 0,
    colorAdjustments: defaultColorAdjustments(),
    backdrop: 'dark',
    sound: false,
    layers: {
      glyphs: true,
      scans: true,
      circles: true,
      tendrils: true,
      mycelia: true,
      neurons: true,
      fuses: true,
      dust: true,
    },
  }
  const engine = new window.OriginalBus(canvas, state)
  let raf = 0,
    last = 0,
    accumulated = 0,
    toastTimer = 0,
    loading = true
  let activePointerId = null
  const audioTracks = []
  function notify(message) {
    clearTimeout(toastTimer)
    $('#toast').textContent = message
    $('#toast').classList.add('visible')
    toastTimer = setTimeout(() => $('#toast').classList.remove('visible'), 2200)
  }
  function syncAudio() {
    for (const track of audioTracks) {
      if (state.sound && !state.paused && !document.hidden)
        track.play().catch((error) => {
          if (error.name !== 'AbortError' && state.sound && !state.paused && !document.hidden)
            notify('声音暂时无法播放')
        })
      else track.pause()
    }
  }
  function loop(now) {
    raf = 0
    if (state.paused || loading || document.hidden) return
    accumulated += Math.min(last ? (now - last) / 1000 : 1 / 60, 0.15) * state.speed
    last = now
    let steps = 0
    while (accumulated >= 1 / 40 && steps++ < 12) {
      engine.step()
      accumulated -= 1 / 40
    }
    engine.draw(Math.min(1, accumulated * 40))
    raf = requestAnimationFrame(loop)
  }
  function schedule() {
    if (!raf && !loading && !state.paused && !document.hidden) {
      last = 0
      raf = requestAnimationFrame(loop)
    }
  }
  function pause(value) {
    state.paused = Boolean(value)
    cancelAnimationFrame(raf)
    raf = 0
    accumulated = 0
    $('#pause-button').setAttribute('aria-pressed', String(state.paused))
    $('#pause-button').setAttribute('aria-label', state.paused ? '继续动画' : '暂停动画')
    $('#playback-state').textContent = state.paused ? 'PAUSED' : 'LIVE'
    canvas.dataset.paused = String(state.paused)
    syncAudio()
    schedule()
  }
  async function reshuffle() {
    if (loading) return
    loading = true
    cancelAnimationFrame(raf)
    raf = 0
    try {
      await engine.setScene('shaft')
    } catch (error) {
      notify('特效数据未能载入')
      console.error(error)
    } finally {
      loading = false
      accumulated = 0
      schedule()
    }
  }
  function closeSettings(focus = true) {
    $('#settings-panel').hidden = true
    $('#settings-button').setAttribute('aria-expanded', 'false')
    $('#settings-button').setAttribute('aria-label', '打开特效设置')
    if (focus) $('#settings-button').focus({ preventScroll: true })
  }
  function setUI(hidden) {
    if (hidden) closeSettings(false)
    document.body.classList.toggle('ui-hidden', hidden)
    $('#restore-button').hidden = !hidden
    $(hidden ? '#restore-button' : '#hide-button').focus({ preventScroll: true })
  }
  async function fullscreen() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen()
      else await document.documentElement.requestFullscreen()
    } catch {
      notify('可使用浏览器的全屏功能')
    }
  }
  async function exportPNG() {
    engine.draw(1)
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'))
    if (!blob) return
    const url = URL.createObjectURL(blob),
      a = document.createElement('a')
    a.href = url
    a.download = `general-systems-bus-${Date.now()}.png`
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 10000)
    notify('已导出透明 PNG')
  }
  $('#settings-button').addEventListener('click', () => {
    if (!$('#settings-panel').hidden) return closeSettings()
    $('#settings-panel').hidden = false
    $('#settings-button').setAttribute('aria-expanded', 'true')
    $('#settings-button').setAttribute('aria-label', '关闭特效设置')
    $('#density').focus({ preventScroll: true })
  })
  $('#close-settings').addEventListener('click', () => closeSettings())
  $('#pause-button').addEventListener('click', () => pause(!state.paused))
  $('#hide-button').addEventListener('click', () => setUI(true))
  $('#restore-button').addEventListener('click', () => setUI(false))
  $('#fullscreen-button').addEventListener('click', fullscreen)
  $('#export-button').addEventListener('click', exportPNG)
  $('#density').addEventListener('input', (event) => {
    engine.setDensity(Number(event.target.value) / 100)
    $('#density-value').value = `${event.target.value}%`
    engine.draw(1)
  })
  $('#speed').addEventListener('input', (event) => {
    state.speed = Number(event.target.value) / 100
    $('#speed-value').value = `${state.speed.toFixed(1)}×`
  })
  function setScale(value) {
    state.scale = Math.round(Math.max(0.8, Math.min(1.6, value)) * 100) / 100
    $('#scale').value = String(Math.round(state.scale * 100))
    $('#scale-value').value = `${Math.round(state.scale * 100)}%`
    engine.resize()
    engine.draw(1)
  }
  $('#scale').addEventListener('input', (event) => setScale(Number(event.target.value) / 100))
  function setNeuronCount(value) {
    const count = engine.setNeuronCount(value)
    $('#neuron-count').value = String(count)
    $('#neuron-count-value').value = `${count} 个`
    engine.draw(1)
  }
  $('#neuron-count').addEventListener('input', (event) => setNeuronCount(event.target.value))
  function setColorProbabilities(red, blue, changed) {
    const values = typeof red === 'object' && red !== null ? red : { red, blue }
    engine.setColorProbabilities(values, changed || Object.keys(values)[0] || 'red')
    let remaining = 100
    for (const { key } of colors.slice(1)) {
      const percent = Math.round(state[`${key}Probability`] * 100)
      $(`#${key}-probability`).value = String(percent)
      $(`#${key}-probability-value`).value = `${percent}%`
      remaining -= percent
    }
    $('#teal-probability-value').value = `${remaining}%`
    engine.draw(1)
  }
  for (const { key } of colors.slice(1))
    $(`#${key}-probability`).addEventListener('input', (event) =>
      setColorProbabilities({ [key]: Number(event.target.value) / 100 }, undefined, key),
    )
  function syncColorAdjustments() {
    const key = $('#color-select').value,
      settings = state.colorAdjustments[key]
    for (const property of ['saturation', 'grayscale', 'brightness']) {
      const percent = Math.round(settings[property] * 100)
      $(`#color-${property}`).value = String(percent)
      $(`#color-${property}-value`).value = `${percent}%`
    }
    const tone = colors.findIndex((color) => color.key === key),
      original = tone === 0 ? engine.projectionColor || colors[0].base : colors[tone].base,
      adjusted = engine.toneColor(tone)
    for (const [name, color] of [['original', original], ['adjusted', adjusted]]) {
      $(`#color-preview-${name}`).style.backgroundColor = `rgb(${color.join(',')})`
      $(`#color-preview-${name}-value`).value =
        '#' + color.map((channel) => Math.round(channel).toString(16).padStart(2, '0')).join('')
    }
    $('.color-preview-effects').style.color = `rgb(${adjusted.join(',')})`
  }
  // Use pixels from the original atlas so the preview shows the same rune silhouettes.
  let previewGlyphs = ''
  for (const [slot, glyph] of [1, 15, 28].entries())
    for (let y = 0; y < 15; y++)
      for (let x = 0; x < 15; x++)
        if (window.GSB_ORIGINAL_DATA.glyphMask[y * 750 + glyph * 15 + x] === '1')
          previewGlyphs += `M${8 + slot * 23 + x} ${10 + y}h1v1h-1z`
  $('#color-preview-glyphs').setAttribute('d', previewGlyphs)
  function setColorAdjustments(key, values) {
    engine.setColorAdjustments(key, values)
    syncColorAdjustments()
    engine.draw(1)
  }
  $('#color-select').addEventListener('change', syncColorAdjustments)
  for (const property of ['saturation', 'grayscale', 'brightness'])
    $(`#color-${property}`).addEventListener('input', (event) =>
      setColorAdjustments($('#color-select').value, { [property]: Number(event.target.value) / 100 }),
    )
  function resetColors() {
    state.colorAdjustments = defaultColorAdjustments()
    engine.updateToneColors()
    engine.atlas = engine.makeGlyphAtlas()
    $('#color-select').value = 'teal'
    setColorProbabilities(
      Object.fromEntries(colors.slice(1).map(({ key, probability }) => [key, probability])),
    )
    syncColorAdjustments()
  }
  $('#reset-colors').addEventListener('click', resetColors)
  $('#backdrop').addEventListener('change', (event) => {
    document.body.dataset.backdrop = state.backdrop = event.target.value
  })
  document.querySelectorAll('[data-layer]').forEach((input) =>
    input.addEventListener('change', () => {
      state.layers[input.dataset.layer] = input.checked
      engine.draw(1)
    }),
  )
  $('#reset-button').addEventListener('click', async () => {
    state.density = state.speed = 1
    setNeuronCount(50)
    resetColors()
    setScale(1)
    state.backdrop = 'dark'
    document.body.dataset.backdrop = 'dark'
    $('#density').value = $('#speed').value = '100'
    $('#density-value').value = '100%'
    $('#speed-value').value = '1.0×'
    $('#backdrop').value = 'dark'
    document.querySelectorAll('[data-layer]').forEach((input) => {
      input.checked = true
      state.layers[input.dataset.layer] = true
    })
    await reshuffle()
    notify('已恢复默认设置')
  })
  $('#sound-button').addEventListener('click', () => {
    if (!audioTracks.length) {
      for (const [file, volume] of [
        ['wind', 0.35],
        ['data', 0.14],
        ['random-gods', 0.32],
      ]) {
        const audio = new Audio()
        const extension = audio.canPlayType('audio/ogg;codecs="vorbis"') ? 'ogg' : 'mp3'
        audio.src = new URL(
          `./audio/${file}.${extension}`,
          document.querySelector('script[src$="scene.js"]').src,
        ).href
        audio.loop = true
        audio.volume = volume
        audioTracks.push(audio)
      }
    }
    state.sound = !state.sound
    $('#sound-button').setAttribute('aria-pressed', String(state.sound))
    $('#sound-button').setAttribute('aria-label', state.sound ? '关闭声音' : '开启声音')
    syncAudio()
  })
  const pointerPosition = (event) => {
    const r = canvas.getBoundingClientRect()
    return { x: event.clientX - r.left, y: event.clientY - r.top }
  }
  function clearInput() {
    const id = activePointerId
    activePointerId = null
    if (id !== null && canvas.hasPointerCapture(id)) canvas.releasePointerCapture(id)
    engine.clearPointer()
    if (state.paused && !loading) engine.draw(1)
  }
  canvas.addEventListener('pointerdown', (event) => {
    if (loading || event.button !== 0 || activePointerId !== null) return
    event.preventDefault()
    const p = pointerPosition(event)
    activePointerId = event.pointerId
    engine.beginPointer(p.x, p.y)
    canvas.setPointerCapture(event.pointerId)
    $('#observatory').focus({ preventScroll: true })
    if (state.paused) engine.draw(1)
  })
  canvas.addEventListener('pointermove', (event) => {
    if (loading || (activePointerId !== null && event.pointerId !== activePointerId)) return
    const p = pointerPosition(event)
    engine.pointerAt(p.x, p.y)
    if (state.paused) {
      if (engine.grab && engine.pointer?.dragging) engine.applyGrab(engine.grab.cable)
      engine.draw(1)
    }
  })
  canvas.addEventListener('pointerleave', () => {
    if (activePointerId === null) clearInput()
  })
  canvas.addEventListener('pointerup', (event) => {
    if (event.pointerId !== activePointerId) return
    const p = pointerPosition(event)
    engine.endPointer(p.x, p.y)
    activePointerId = null
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId)
    if (event.pointerType !== 'mouse') engine.clearPointer()
    if (state.paused) engine.draw(1)
  })
  canvas.addEventListener('pointercancel', clearInput)
  canvas.addEventListener('lostpointercapture', (event) => {
    if (event.pointerId === activePointerId) clearInput()
  })
  document.addEventListener('pointerdown', (event) => {
    if (!$('#settings-panel').hidden && !event.target.closest('#settings-panel,#settings-button'))
      closeSettings(false)
  })
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      if (activePointerId !== null) {
        clearInput()
        return
      }
      if (!$('#settings-panel').hidden) closeSettings()
      else if (document.body.classList.contains('ui-hidden')) setUI(false)
      return
    }
    if (
      event.repeat ||
      event.ctrlKey ||
      event.metaKey ||
      event.altKey ||
      event.target.closest('input,select,textarea,[contenteditable="true"]')
    )
      return
    const key = event.key.toLowerCase()
    if (event.code === 'Space' && !event.target.closest('button,a')) {
      event.preventDefault()
      pause(!state.paused)
    } else if (key === 'h') setUI(!document.body.classList.contains('ui-hidden'))
    else if (key === 'f') fullscreen()
    else if (key === 'm') $('#sound-button').click()
    else if (key === 'r') reshuffle()
    else if (key === '+' || key === '=') {
      event.preventDefault()
      setScale(state.scale + 0.05)
    } else if (key === '-' || key === '_') {
      event.preventDefault()
      setScale(state.scale - 0.05)
    }
  })
  document.addEventListener('visibilitychange', () => {
    clearInput()
    cancelAnimationFrame(raf)
    raf = 0
    accumulated = 0
    syncAudio()
    schedule()
  })
  document.addEventListener('fullscreenchange', () =>
    $('#fullscreen-button').setAttribute(
      'aria-label',
      document.fullscreenElement ? '退出全屏' : '进入全屏',
    ),
  )
  window.addEventListener('pagehide', () => {
    clearInput()
    cancelAnimationFrame(raf)
    raf = 0
    for (const track of audioTracks) track.pause()
  })
  window.addEventListener('pageshow', () => {
    syncAudio()
    schedule()
  })
  window.addEventListener('resize', () => {
    clearInput()
    if (!loading) {
      engine.resize()
      engine.draw(1)
    }
  })
  reduced.addEventListener('change', (event) => {
    if (event.matches) pause(true)
  })
  window.GeneralSystemsBus = Object.freeze({
    pause: () => pause(true),
    resume: () => pause(false),
    reshuffle,
    setNeuronCount,
    setColorProbabilities,
    setColorAdjustments,
    resetColors,
    setScale,
    exportPNG,
    signal: (x, y) => {
      engine.signalAt(x, y)
      if (state.paused) engine.draw(1)
    },
    getState: () => ({
      ...state,
      layers: { ...state.layers },
      colorAdjustments: Object.fromEntries(
        Object.entries(state.colorAdjustments).map(([key, settings]) => [key, { ...settings }]),
      ),
      time: engine.tick / 40,
      width: canvas.clientWidth,
      height: canvas.clientHeight,
      ...(engine.room ? engine.diagnostics() : {}),
    }),
  })
  window.addEventListener('blur', clearInput)
  const query = new URLSearchParams(location.search)
  if (query.get('controls') === '1') document.body.classList.remove('ui-hidden')
  if (query.get('embed') === '1') {
    document.body.dataset.backdrop = state.backdrop = 'transparent'
    $('#backdrop').value = 'transparent'
    document.body.classList.add('ui-hidden')
  }
  document
    .querySelectorAll(
      '#density,#scale,#neuron-count,.palette-controls input,.palette-controls select,#reset-colors',
    )
    .forEach((el) => {
      el.disabled = true
    })
  engine
    .init()
    .then(() => {
      loading = false
      document
        .querySelectorAll(
          '#density,#scale,#neuron-count,.palette-controls input,.palette-controls select,#reset-colors',
        )
        .forEach((el) => {
          el.disabled = false
        })
      syncColorAdjustments()
      pause(state.paused)
      if (state.paused) notify('已遵循低动态偏好，点击播放可继续')
    })
    .catch((error) => {
      notify('无法载入本地场景数据')
      console.error(error)
    })
})()
