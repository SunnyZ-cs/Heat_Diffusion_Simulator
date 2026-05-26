/*
 * main.js
 *
 * This module implements the client-side logic for the Level 1 heat
 * diffusion simulator.  The program wires up form controls to a
 * backend API, manages polling for simulation progress, fetches
 * resulting temperature frames, and renders them on a canvas with
 * playback controls.
 *
 * Each function is documented with its intent, parameters and
 * important edge‑case considerations.  See README for overall
 * behavioural requirements.
 */

// Immediately invoked function expression to avoid polluting the global scope.
(function () {
  /**
   * Grab references to DOM elements up front.  These are cached to
   * avoid repeated lookups during event handlers.
   */
  const controls = {
    totalTime: document.getElementById('totalTime'),
    totalTimeValue: document.getElementById('totalTimeValue'),
    initialTemperature: document.getElementById('initialTemperature'),
    initialTemperatureValue: document.getElementById('initialTemperatureValue'),
    boundaryTop: document.getElementById('boundaryTop'),
    boundaryTopValue: document.getElementById('boundaryTopValue'),
    boundaryRight: document.getElementById('boundaryRight'),
    boundaryRightValue: document.getElementById('boundaryRightValue'),
    boundaryBottom: document.getElementById('boundaryBottom'),
    boundaryBottomValue: document.getElementById('boundaryBottomValue'),
    boundaryLeft: document.getElementById('boundaryLeft'),
    boundaryLeftValue: document.getElementById('boundaryLeftValue'),
    diffusivity: document.getElementById('diffusivity'),
    diffusivityValue: document.getElementById('diffusivityValue'),
    runButton: document.getElementById('runButton'),
    progressBar: document.getElementById('progressBar'),
    statusMessage: document.getElementById('statusMessage'),
    playbackControls: document.getElementById('playbackControls'),
    playPauseButton: document.getElementById('playPauseButton'),
    frameIndicator: document.getElementById('frameIndicator'),
    timeIndicator: document.getElementById('timeIndicator'),
    // Slider to scrub through simulation frames manually.  Will be
    // enabled once frames are loaded.
    frameSlider: document.getElementById('frameSlider'),
    // Material design controls
    // Subtitle element that can be clicked to return to selection mode
    selectShapeLabel: document.getElementById('selectShapeLabel'),
    toolRectangle: document.getElementById('toolRectangle'),
    toolEllipse: document.getElementById('toolEllipse'),
    shapeDiffusivity: document.getElementById('shapeDiffusivity'),
    shapeDiffusivityValue: document.getElementById('shapeDiffusivityValue'),
    shapeList: document.getElementById('shapeList'),
    clearShapesButton: document.getElementById('clearShapesButton'),
    runMaterialButton: document.getElementById('runMaterialButton'),
  };

  /**
   * Canvas setup.  We obtain the drawing context once and store
   * simulation state variables here.  The `frames` array holds
   * simulation output; `minTemp` and `maxTemp` track temperature
   * extremes across all frames for colour scaling; `animationTimer`
   * holds an interval id for playback control; and `currentFrame`
   * indexes the frame currently being displayed.
   */
  const canvas = document.getElementById('heatCanvas');
  const ctx = canvas.getContext('2d');

  // Design canvas overlay for drawing material shapes
  const designCanvas = document.getElementById('designCanvas');
  const designCtx = designCanvas ? designCanvas.getContext('2d') : null;

  /**
   * Material design state.  Shapes drawn by the user are stored in
   * the `shapes` array.  Each shape has an id (unique), type
   * ('rectangle' or 'ellipse'), geometry (coordinates on the grid),
   * diffusivity, and flags for visibility and highlighting.  The
   * variables below track the drawing process and current tool.
   */
  const shapes = [];
  let nextShapeId = 1;
  let currentTool = 'select';
  let isDrawingShape = false;
  let startPixelX = 0;
  let startPixelY = 0;
  let currentPixelX = 0;
  let currentPixelY = 0;

  // Currently selected shape and editing state.  When a shape is
  // selected (currentTool === 'select'), its id is stored in
  // selectedShapeId.  The editMode indicates whether the user is
  // moving ('move') or resizing ('resize') the shape.  dragOffsetX
  // and dragOffsetY record the pointer offset relative to the
  // shape's origin or centre when moving; these are used to
  // preserve the cursor position while dragging.  During a resize
  // operation we also track the original bounding box so that
  // proportional updates can be applied correctly.
  let selectedShapeId = null;
  let editMode = null;
  let dragOffsetX = 0;
  let dragOffsetY = 0;
  // Original bounding box for resize operations (in grid units)
  let originalShapeBounds = null;
  // Assume a fixed grid resolution for mapping shapes into simulation
  // The API uses a 100×100 grid for material design.  Grid
  // coordinates should map onto this resolution so that shapes
  // align properly with the backend's expectations.  See
  // `api_docs.md` for details on coordinate mapping【17228060284884†L215-L246】.
  const gridCols = 100;
  const gridRows = 100;


  // Colour bar canvases and contexts.  The simulation uses a temperature
  // colour bar (`colorBar`), while the material design uses a diffusivity
  // colour bar (`diffColorBar`).  Separate contexts are maintained for
  // independent rendering of temperature and diffusivity scales.
  const tempBarCanvas = document.getElementById('colorBar');
  const tempBarCtx = tempBarCanvas ? tempBarCanvas.getContext('2d') : null;
  const diffBarCanvas = document.getElementById('diffColorBar');
  const diffBarCtx = diffBarCanvas ? diffBarCanvas.getContext('2d') : null;

  // Simulation state
  let frames = [];
  let minTemp = 0;
  let maxTemp = 1;
  // Material diffusivity extremes.  These values are recalculated
  // whenever shapes are added, removed, or the base diffusivity changes.
  let minDiff = 0.01;
  let maxDiff = 1.0;
  let animationTimer = null;
  let currentFrame = 0;

  /**
   * Global colour bar ranges.  The gradient bars should not change
   * depending on the current simulation or material configuration.  Set
   * these constants to the allowed ranges of temperature and thermal
   * diffusivity as defined by the API documentation【17228060284884†L220-L235】.  The
   * temperature range covers the full possible boundary temperature
   * values (0–100 °C), and the diffusivity range spans the default
   * slider limits (0.0–10.0).  These values are used when drawing
   * the colour bars; the actual frame colours still use dynamic
   * min/max values for mapping to ensure relative contrast within a
   * simulation.
   */
  // Fixed ranges for temperature and diffusivity.  These values determine
  // the scales shown on the colour bars and are also used when
  // mapping absolute temperatures to colours.  Temperature values
  // span the allowed boundary range of 20–50 °C, and diffusivity
  // values span 0–3.0 m²/s.  These constants are independent of the
  // current simulation and material design values.
  const GLOBAL_TEMP_MIN = 20;
  const GLOBAL_TEMP_MAX = 50;
  const GLOBAL_DIFF_MIN = 0;
  const GLOBAL_DIFF_MAX = 3.0;

  // Playback speed control: lower values result in faster frame changes during
  // autoplay.  Adjust this constant in togglePlayback() for smoother or
  // snappier playback.

  // Note: We previously attempted to smooth playback by inserting
  // interpolated frames between consecutive frames, but this proved
  // ineffective because the underlying simulation produces only a few
  // significant frames.  Therefore, we reverted to using the
  // original frames as returned by the backend.

  /**
   * Draw the temperature scale on the colour bar canvas.  The bar
   * displays a vertical gradient between minTemp and maxTemp using
   * the same colour mapping as the heat map.  Tick marks and
   * numeric labels are drawn alongside the gradient to indicate
   * actual temperature values.
   */
  function drawColorBar() {
    if (!tempBarCtx || !tempBarCanvas) return;
    const width = tempBarCanvas.width;
    const height = tempBarCanvas.height;
    const gradientWidth = 20;
    // Provide vertical padding so that temperature labels at the top and bottom
    // are not clipped.  The padding should be at least half the font size
    // (approx. 6px for 12px font) to keep text completely inside the canvas.
    const padding = 15;
    const innerHeight = height - 2 * padding;
    // Clear the entire canvas
    tempBarCtx.clearRect(0, 0, width, height);
    // Draw gradient: iterate pixel rows within the padded region.  Use
    // global constants for the bar scale so that the colour bar does not
    // change with each simulation.
    for (let y = 0; y < innerHeight; y++) {
      // Compute ratio relative to innerHeight: 1 at top, 0 at bottom
      const ratio = (innerHeight - y) / innerHeight;
      const value = GLOBAL_TEMP_MIN + ratio * (GLOBAL_TEMP_MAX - GLOBAL_TEMP_MIN);
      // Map this bar value through a fixed temperature range so the bar
      // does not depend on the current frame extremes
      tempBarCtx.fillStyle = temperatureColorFromRange(
        value,
        GLOBAL_TEMP_MIN,
        GLOBAL_TEMP_MAX,
      );
      tempBarCtx.fillRect(0, padding + y, gradientWidth, 1);
    }
    // Draw tick marks and labels.  Use the padded region for positioning.
    // Use 6 intervals so that the bar displays 7 tick labels.  This
    // accommodates a fixed range of 20–50 °C with tick values at
    // 20, 25, 30, 35, 40, 45 and 50.
    const nTicks = 6;
    tempBarCtx.font = '12px Arial';
    tempBarCtx.fillStyle = '#000000';
    tempBarCtx.textBaseline = 'middle';
    for (let i = 0; i <= nTicks; i++) {
      const ratio = i / nTicks;
      // Position ticks within the padded region from bottom up
      const y = height - padding - ratio * innerHeight;
      // Draw tick mark at boundary between gradient and labels
      tempBarCtx.fillStyle = '#000000';
      tempBarCtx.fillRect(gradientWidth, y, 5, 1);
      // Tick label uses global temperature min/max for scale
      const value = GLOBAL_TEMP_MIN + ratio * (GLOBAL_TEMP_MAX - GLOBAL_TEMP_MIN);
      const text = value.toFixed(1) + '°C';
      // Draw the label with a small horizontal offset
      tempBarCtx.fillText(text, gradientWidth + 8, y);
    }
  }

  /**
   * Draw the diffusivity scale on the material colour bar canvas.  This
   * function mirrors drawColorBar() but uses the minDiff and maxDiff
   * values to determine the gradient and labels.  Shape colours are
   * matched to the same gradient stops as temperatures (blue → yellow → red).
   */
  function drawDiffColorBar() {
    if (!diffBarCtx || !diffBarCanvas) return;
    const width = diffBarCanvas.width;
    const height = diffBarCanvas.height;
    const gradientWidth = 20;
    const padding = 15;
    const innerHeight = height - 2 * padding;
    diffBarCtx.clearRect(0, 0, width, height);
    for (let y = 0; y < innerHeight; y++) {
      const ratio = (innerHeight - y) / innerHeight;
      // Use global range for diffusivity bar so it stays constant
      const value = GLOBAL_DIFF_MIN + ratio * (GLOBAL_DIFF_MAX - GLOBAL_DIFF_MIN);
      diffBarCtx.fillStyle = mapValueToColor(value, GLOBAL_DIFF_MIN, GLOBAL_DIFF_MAX);
      diffBarCtx.fillRect(0, padding + y, gradientWidth, 1);
    }
    // Use 6 intervals so that the diffusivity bar displays 7 tick labels
    // ranging from 0 to 3.0 with increments of 0.5 (0, 0.5, 1.0, 1.5, 2.0,
    // 2.5, 3.0).
    const nTicks = 6;
    diffBarCtx.font = '12px Arial';
    diffBarCtx.fillStyle = '#000000';
    diffBarCtx.textBaseline = 'middle';
    for (let i = 0; i <= nTicks; i++) {
      const ratio = i / nTicks;
      const y = height - padding - ratio * innerHeight;
      diffBarCtx.fillStyle = '#000000';
      diffBarCtx.fillRect(gradientWidth, y, 5, 1);
      // Tick label uses global diffusivity min/max
      const value = GLOBAL_DIFF_MIN + ratio * (GLOBAL_DIFF_MAX - GLOBAL_DIFF_MIN);
      const text = value.toFixed(2);
      diffBarCtx.fillText(text, gradientWidth + 8, y);
    }
  }

  /**
   * Map a scalar value to a colour using the same piecewise linear
   * gradient as temperatureToColor().  The returned colour depends
   * on the provided minimum and maximum values rather than the
   * global temperature extremes.  This helper is used for mapping
   * diffusivity values into colours.
   *
   * @param {number} value The value to map.
   * @param {number} minVal The minimum of the range.
   * @param {number} maxVal The maximum of the range.
   * @returns {string} A CSS rgb() colour string.
   */
  function mapValueToColor(value, minVal, maxVal) {
    // Map a scalar (diffusivity) to a colour for the material design preview.
    // The gradient transitions from dark blue/purple for low diffusivity to
    // yellow for high diffusivity.  If all values are equal, return a mid
    // gradient colour (a pale yellow) to avoid division by zero.  The
    // interpolation is piecewise linear between three stops.
    if (maxVal === minVal) {
      // Mid-range colour when all diffusivity values are the same
      return 'rgb(200, 200, 100)';
    }
    const ratio = (value - minVal) / (maxVal - minVal);
    const r = Math.min(Math.max(ratio, 0), 1);
    // Colour stops: dark blue/purple → medium purple → yellow
    const stops = [
      { p: 0.0, color: [13, 0, 106] },    // very dark purple/blue
      { p: 0.5, color: [139, 0, 139] },   // medium purple (magenta)
      { p: 1.0, color: [255, 255, 0] },   // yellow
    ];
    // Find bounding stops for interpolation
    let start = stops[0];
    let end = stops[stops.length - 1];
    for (let i = 0; i < stops.length - 1; i++) {
      if (r >= stops[i].p && r <= stops[i + 1].p) {
        start = stops[i];
        end = stops[i + 1];
        break;
      }
    }
    // Interpolate between the two stops
    const t = (r - start.p) / (end.p - start.p);
    const interpolate = (cStart, cEnd) => Math.round(cStart + (cEnd - cStart) * t);
    const [rVal, gVal, bVal] = [
      interpolate(start.color[0], end.color[0]),
      interpolate(start.color[1], end.color[1]),
      interpolate(start.color[2], end.color[2]),
    ];
    return `rgb(${rVal}, ${gVal}, ${bVal})`;
  }

  /**
   * Compute a colour for a temperature value given an explicit
   * temperature range.  This helper mirrors the logic used in
   * `temperatureToColor` but allows the caller to specify the
   * minimum and maximum values.  It uses the gradient stops from
   * black (coldest) through red and yellow to white (hottest).  If
   * minVal equals maxVal the function returns grey to indicate a
   * uniform temperature field.
   *
   * @param {number} value The temperature value to map.
   * @param {number} minVal The minimum of the range.
   * @param {number} maxVal The maximum of the range.
   * @returns {string} A CSS rgb() colour string.
   */
  function temperatureColorFromRange(value, minVal, maxVal) {
    if (maxVal === minVal) {
      // Uniform case: return grey
      return 'rgb(128, 128, 128)';
    }
    const ratio = (value - minVal) / (maxVal - minVal);
    const r = Math.min(Math.max(ratio, 0), 1);
    // Colour stops: black → red → yellow → white
    const stops = [
      { p: 0.0, color: [0, 0, 0] },       // black
      { p: 0.5, color: [255, 0, 0] },     // red
      { p: 0.8, color: [255, 255, 0] },   // yellow
      { p: 1.0, color: [255, 255, 255] }, // white
    ];
    let start = stops[0];
    let end = stops[stops.length - 1];
    for (let i = 0; i < stops.length - 1; i++) {
      if (r >= stops[i].p && r <= stops[i + 1].p) {
        start = stops[i];
        end = stops[i + 1];
        break;
      }
    }
    const t = (r - start.p) / (end.p - start.p);
    const interpolate = (cStart, cEnd) => Math.round(cStart + (cEnd - cStart) * t);
    const [rVal, gVal, bVal] = [
      interpolate(start.color[0], end.color[0]),
      interpolate(start.color[1], end.color[1]),
      interpolate(start.color[2], end.color[2]),
    ];
    return `rgb(${rVal}, ${gVal}, ${bVal})`;
  }

  /**
   * Update the numeric value display adjacent to a range input.
   *
   * The value is formatted based on the input's step size: values
   * between 0 and 10 are shown with two decimal places, while
   * integers are shown without decimals.  This helper centralises
   * formatting logic and can be reused for each slider.
   *
   * @param {HTMLInputElement} inputEl The range input whose value changed.
   * @param {HTMLElement} displayEl The span used to display the value.
   */
  function updateDisplay(inputEl, displayEl) {
    const step = parseFloat(inputEl.getAttribute('step') || '1');
    let value = parseFloat(inputEl.value);
    // Format value based on step; small steps imply decimals.
    if (step < 1) {
      value = value.toFixed(Math.ceil(Math.abs(Math.log10(step))));
    } else {
      value = value.toFixed(0);
    }
    displayEl.textContent = value;
  }

  /**
   * Attach input listeners to each control slider.  When the user
   * changes a slider, update the display immediately.  Doing this
   * ensures the UI stays responsive and reflects the chosen
   * parameters before the simulation runs.
   */
  function initialiseValueBindings() {
    const pairs = [
      [controls.totalTime, controls.totalTimeValue],
      [controls.initialTemperature, controls.initialTemperatureValue],
      [controls.boundaryTop, controls.boundaryTopValue],
      [controls.boundaryRight, controls.boundaryRightValue],
      [controls.boundaryBottom, controls.boundaryBottomValue],
      [controls.boundaryLeft, controls.boundaryLeftValue],
      [controls.diffusivity, controls.diffusivityValue],
    ];
    pairs.forEach(([inputEl, displayEl]) => {
      // Initialize display on load
      updateDisplay(inputEl, displayEl);
      // Update on input
      inputEl.addEventListener('input', () => updateDisplay(inputEl, displayEl));
    });

    // When the background diffusivity slider changes, update the material
    // preview and colour bar so that the base diffusivity is reflected
    // immediately.  We do not re-render simulation colour bars here; only
    // the material design preview requires this.
    if (controls.diffusivity) {
      controls.diffusivity.addEventListener('input', () => {
        // Redraw the design preview to reflect the new base diffusivity
        drawDesign();
      });
    }
  }

  /**
   * Convert a temperature value into a RGB colour.  A piecewise
   * linear gradient is defined using three colour stops: blue at
   * 0% (cold), yellow at 50% (warm), and red at 100% (hot).  The
   * function computes a ratio between `minTemp` and `maxTemp` then
   * interpolates between the nearest stops.  If all temperatures
   * are equal (min equals max) the ratio is set to 0.5 to avoid
   * division by zero and produce a mid‑range colour.
   *
   * @param {number} temperature The temperature to map.
   * @returns {string} A CSS rgb() string representing the colour.
   */
  function temperatureToColor(temperature) {
    // Map the temperature using a fixed global range so that colours
    // correspond to absolute values rather than the dynamic frame
    // extremes.  This ensures that a given temperature (e.g. 50°C)
    // always maps to the same colour, regardless of other values in
    // the simulation.  Use the global temperature constants defined
    // above (0–100 °C) for the scale.
    return temperatureColorFromRange(temperature, GLOBAL_TEMP_MIN, GLOBAL_TEMP_MAX);
  }

  /**
   * Draw a specific simulation frame on the canvas.  The frame
   * consists of a 2D array of temperatures which are mapped to
   * colours via `temperatureToColor()`.  Cell sizes are computed
   * based on canvas dimensions and the frame's shape.  This
   * function avoids reflow by drawing into an off‑screen canvas
   * first if needed; however for a modest grid resolution the
   * direct approach suffices.  If the grid is empty the canvas is
   * cleared.
   *
   * @param {number[][]} frame A 2D array of numeric temperatures.
   */
  function drawFrame(frame) {
    if (!frame || frame.length === 0 || frame[0].length === 0) {
      // Nothing to draw; clear the canvas
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      return;
    }
    const rows = frame.length;
    const cols = frame[0].length;
    const cellWidth = canvas.width / cols;
    const cellHeight = canvas.height / rows;
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        ctx.fillStyle = temperatureToColor(frame[y][x]);
        ctx.fillRect(x * cellWidth, y * cellHeight, cellWidth, cellHeight);
      }
    }
  }

  /**
   * Compute global temperature extremes across all frames.  The
   * results are stored in module‑level variables `minTemp` and
   * `maxTemp`.  If no frames are provided the extremes are
   * initialised to 0 and 1 to avoid division by zero.  Call this
   * after frames have been retrieved from the server and before
   * drawing any frames.
   */
  function computeTemperatureExtremes() {
    if (!frames || frames.length === 0) {
      minTemp = 0;
      maxTemp = 1;
      return;
    }
    let min = Infinity;
    let max = -Infinity;
    frames.forEach((frame) => {
      frame.forEach((row) => {
        row.forEach((val) => {
          if (val < min) min = val;
          if (val > max) max = val;
        });
      });
    });
    // In extremely uniform scenarios, min and max may still be equal.
    if (min === max) {
      // Widen the range slightly to avoid division by zero in colour mapping.
      minTemp = min - 0.5;
      maxTemp = max + 0.5;
    } else {
      minTemp = min;
      maxTemp = max;
    }
    // Update the colour bar now that we have new extremes
    drawColorBar();
  }

  /**
   * Compute minimum and maximum diffusivity values across the base
   * material and all shapes.  The base diffusivity comes from the
   * background diffusivity slider.  The global variables `minDiff`
   * and `maxDiff` are updated accordingly.  When no shapes exist,
   * the range is extended slightly around the base value to avoid
   * division by zero during colour mapping.
   */
  function computeDiffExtremes() {
    // Base diffusivity from simulation controls.  This slider value
    // controls the background diffusivity for both material design
    // and simulation.  Parse as float.
    const base = parseFloat(controls.diffusivity.value);
    let min = base;
    let max = base;
    shapes.forEach((shape) => {
      if (shape.diffusivity < min) min = shape.diffusivity;
      if (shape.diffusivity > max) max = shape.diffusivity;
    });
    if (min === max) {
      // Expand slightly to avoid zero range
      minDiff = min - 0.01;
      maxDiff = max + 0.01;
    } else {
      minDiff = min;
      maxDiff = max;
    }
  }

  /**
   * -------------------- Material Design Functions --------------------
   *
   * The following helper functions and event handlers implement Level 2
   * material design features.  Users can draw rectangles and ellipses
   * on a transparent overlay canvas, assign diffusivity values to each
   * shape, toggle visibility or highlighting, and remove shapes.  A
   * list of added shapes is maintained and displayed in the UI.  When
   * the user chooses to run a simulation with their custom material,
   * these shapes are submitted to the backend via the appropriate
   * API endpoints.
   */

  /**
   * Draw all visible shapes on the design canvas.  Shapes are stored
   * using grid coordinates relative to a notional grid of size
   * `gridCols` by `gridRows`.  This function converts each shape
   * back into pixel coordinates based on the current canvas size
   * before drawing.  Highlighted shapes are drawn with a distinct
   * stroke colour.  Invisible shapes are skipped entirely.
   */
  function drawDesign() {
    if (!designCtx || !designCanvas) return;
    // Compute diffusivity extremes before drawing so that colours are scaled
    // correctly.  This accounts for the base diffusivity and all shapes.
    computeDiffExtremes();
    // Clear the canvas
    designCtx.clearRect(0, 0, designCanvas.width, designCanvas.height);
    // Fill the background with the base diffusivity colour
    const baseVal = parseFloat(controls.diffusivity.value);
    designCtx.fillStyle = mapValueToColor(baseVal, minDiff, maxDiff);
    designCtx.fillRect(0, 0, designCanvas.width, designCanvas.height);
    // Draw each shape if visible: fill with diffusivity colour then outline
    shapes.forEach((shape) => {
      if (!shape.visible) return;
      // Determine pixel coordinates
      if (shape.type === 'rectangle') {
        const xPx = (shape.x / gridCols) * designCanvas.width;
        const yPx = (shape.y / gridRows) * designCanvas.height;
        const wPx = (shape.width / gridCols) * designCanvas.width;
        const hPx = (shape.height / gridRows) * designCanvas.height;
        // Fill rectangle
        designCtx.save();
        designCtx.fillStyle = mapValueToColor(shape.diffusivity, minDiff, maxDiff);
        designCtx.fillRect(xPx, yPx, wPx, hPx);
        // Draw outline for visibility and highlight
        designCtx.lineWidth = 2;
        if (shape.highlight) {
          designCtx.strokeStyle = 'rgba(255, 0, 0, 0.8)';
        } else {
          designCtx.strokeStyle = 'rgba(0, 0, 0, 0.6)';
        }
        designCtx.strokeRect(xPx, yPx, wPx, hPx);
        designCtx.restore();
      } else if (shape.type === 'ellipse') {
        const cxPx = (shape.x / gridCols) * designCanvas.width;
        const cyPx = (shape.y / gridRows) * designCanvas.height;
        const rxPx = (shape.width / gridCols) * designCanvas.width;
        const ryPx = (shape.height / gridRows) * designCanvas.height;
        designCtx.save();
        designCtx.fillStyle = mapValueToColor(shape.diffusivity, minDiff, maxDiff);
        designCtx.beginPath();
        designCtx.ellipse(cxPx, cyPx, rxPx, ryPx, 0, 0, 2 * Math.PI);
        designCtx.fill();
        // Outline
        designCtx.lineWidth = 2;
        if (shape.highlight) {
          designCtx.strokeStyle = 'rgba(255, 0, 0, 0.8)';
        } else {
          designCtx.strokeStyle = 'rgba(0, 0, 0, 0.6)';
        }
        designCtx.stroke();
        designCtx.restore();
      }
    });
    // If currently drawing a shape, draw a live preview in a lighter style
    if (isDrawingShape && (currentTool === 'rectangle' || currentTool === 'ellipse')) {
      const rectX = Math.min(startPixelX, currentPixelX);
      const rectY = Math.min(startPixelY, currentPixelY);
      const rectW = Math.abs(currentPixelX - startPixelX);
      const rectH = Math.abs(currentPixelY - startPixelY);
      designCtx.save();
      designCtx.strokeStyle = 'rgba(0, 0, 0, 0.5)';
      designCtx.lineWidth = 1;
      if (currentTool === 'rectangle') {
        designCtx.strokeRect(rectX, rectY, rectW, rectH);
      } else if (currentTool === 'ellipse') {
        const cx = rectX + rectW / 2;
        const cy = rectY + rectH / 2;
        const rx = rectW / 2;
        const ry = rectH / 2;
        designCtx.beginPath();
        designCtx.ellipse(cx, cy, Math.abs(rx), Math.abs(ry), 0, 0, 2 * Math.PI);
        designCtx.stroke();
      }
      designCtx.restore();
    }
    // Draw a bounding box around the selected shape and indicate
    // resize handle.  We draw this after the shapes so that it
    // appears on top of all other drawing.  The selected shape is
    // identified by selectedShapeId; if no shape is selected,
    // nothing is drawn.
    if (selectedShapeId !== null) {
      const sel = shapes.find((s) => s.id === selectedShapeId);
      if (sel && sel.visible) {
        let xPx, yPx, wPx, hPx;
        if (sel.type === 'rectangle') {
          xPx = (sel.x / gridCols) * designCanvas.width;
          yPx = (sel.y / gridRows) * designCanvas.height;
          wPx = (sel.width / gridCols) * designCanvas.width;
          hPx = (sel.height / gridRows) * designCanvas.height;
        } else {
          const cxPx = (sel.x / gridCols) * designCanvas.width;
          const cyPx = (sel.y / gridRows) * designCanvas.height;
          const rxPx = (sel.width / gridCols) * designCanvas.width;
          const ryPx = (sel.height / gridRows) * designCanvas.height;
          xPx = cxPx - rxPx;
          yPx = cyPx - ryPx;
          wPx = rxPx * 2;
          hPx = ryPx * 2;
        }
        designCtx.save();
        // Draw bounding outline
        designCtx.strokeStyle = 'rgba(0, 128, 255, 0.8)';
        designCtx.lineWidth = 2;
        designCtx.setLineDash([5, 3]);
        designCtx.strokeRect(xPx, yPx, wPx, hPx);
        designCtx.setLineDash([]);
        // Draw a small square handle at bottom-right corner for resizing
        const handleSize = 8;
        designCtx.fillStyle = 'rgba(0, 128, 255, 0.9)';
        designCtx.fillRect(xPx + wPx - handleSize / 2, yPx + hPx - handleSize / 2, handleSize, handleSize);
        designCtx.restore();
      }
    }
    // Update the diffusivity colour bar after drawing
    drawDiffColorBar();
  }

  /**
   * Update the HTML list of shapes displayed in the material design
   * panel.  Each list item shows the shape type, geometry and
   * diffusivity, along with controls to toggle visibility, highlight
   * the shape, or delete it.  Events for these controls are
   * delegated to a single handler in order to avoid attaching
   * separate listeners to each element.
   */
  function updateShapeList() {
    const listEl = controls.shapeList;
    if (!listEl) return;
    listEl.innerHTML = '';
    shapes.forEach((shape) => {
      const li = document.createElement('li');
      // Apply a selected class if this shape is currently selected
      li.className = 'shape-item' + (shape.id === selectedShapeId ? ' selected' : '');
      li.dataset.id = shape.id;
      const info = document.createElement('span');
      // Format geometry text differently for rectangles and ellipses
      let geometryText;
      if (shape.type === 'rectangle') {
        geometryText = `Rect ${shape.width}×${shape.height} @ (${shape.x},${shape.y})`;
      } else {
        geometryText = `Ellipse r=(${shape.width},${shape.height}) @ (${shape.x},${shape.y})`;
      }
      info.textContent = `${geometryText}, D=${shape.diffusivity.toFixed(2)}`;
      li.appendChild(info);
      const actions = document.createElement('div');
      actions.className = 'shape-actions';
      // Visibility toggle: checkbox
      const visInput = document.createElement('input');
      visInput.type = 'checkbox';
      visInput.checked = shape.visible;
      visInput.dataset.action = 'toggleVisibility';
      actions.appendChild(visInput);
      // Highlight button
      const highlightBtn = document.createElement('button');
      highlightBtn.textContent = shape.highlight ? 'Unhighlight' : 'Highlight';
      highlightBtn.className = 'highlight';
      highlightBtn.dataset.action = 'toggleHighlight';
      actions.appendChild(highlightBtn);
      // Delete button
      const deleteBtn = document.createElement('button');
      deleteBtn.textContent = 'Delete';
      deleteBtn.className = 'delete';
      deleteBtn.dataset.action = 'deleteShape';
      actions.appendChild(deleteBtn);
      li.appendChild(actions);
      listEl.appendChild(li);
    });
  }

  /**
   * Called whenever the drawing tool selection changes.  This
   * function updates which tool is active and enables or disables
   * pointer events on the design canvas accordingly.  When no
   * drawing tool is selected (select mode), pointer events are
   * disabled so the canvas does not intercept clicks intended
   * for other UI elements.
   */
  function updateDesignTool() {
    if (!designCanvas) return;
    // Always allow pointer events on the design canvas so that
    // selections, moves, and resizes can be captured even when no
    // drawing tool is active.  Previously pointer events were
    // disabled in select mode which prevented shape editing.  By
    // leaving pointerEvents enabled at all times, the event handlers
    // below can detect clicks for both drawing and editing.
    designCanvas.style.pointerEvents = 'auto';
    // Redraw design to ensure no preview persists from previous tool
    drawDesign();
  }

  /**
   * Handler for mousedown on the design canvas.  Begins the shape
   * drawing process when a drawing tool is active.  Records the
   * starting pixel coordinates and sets the drawing flag.
   *
   * @param {MouseEvent} event The mouse event.
   */
  function onDesignMouseDown(event) {
    // Determine the pointer position relative to the canvas
    const rect = designCanvas.getBoundingClientRect();
    const px = event.clientX - rect.left;
    const py = event.clientY - rect.top;
    // If a drawing tool is active, begin drawing a new shape
    if (currentTool === 'rectangle' || currentTool === 'ellipse') {
      isDrawingShape = true;
      startPixelX = px;
      startPixelY = py;
      currentPixelX = startPixelX;
      currentPixelY = startPixelY;
      drawDesign();
      return;
    }
    // Otherwise we are in select mode.  Attempt to select a shape for
    // editing (move or resize).  Reset any previous selection.
    selectedShapeId = null;
    editMode = null;
    originalShapeBounds = null;
    // Search shapes in reverse order (last drawn appears on top).
    for (let i = shapes.length - 1; i >= 0; i--) {
      const shape = shapes[i];
      if (!shape.visible) continue;
      // Compute bounding box in pixel coordinates.  For rectangles,
      // width/height represent span on the grid; for ellipses they
      // represent radii.  Use the appropriate conversion.
      let xPx, yPx, wPx, hPx;
      if (shape.type === 'rectangle') {
        xPx = (shape.x / gridCols) * designCanvas.width;
        yPx = (shape.y / gridRows) * designCanvas.height;
        wPx = (shape.width / gridCols) * designCanvas.width;
        hPx = (shape.height / gridRows) * designCanvas.height;
      } else {
        // Ellipse: bounding box based on centre and radii
        const cxPx = (shape.x / gridCols) * designCanvas.width;
        const cyPx = (shape.y / gridRows) * designCanvas.height;
        const rxPx = (shape.width / gridCols) * designCanvas.width;
        const ryPx = (shape.height / gridRows) * designCanvas.height;
        xPx = cxPx - rxPx;
        yPx = cyPx - ryPx;
        wPx = rxPx * 2;
        hPx = ryPx * 2;
      }
      // Determine if the click is inside the shape.  For ellipses,
      // check the ellipse equation; for rectangles use bounding box.
      let inside = false;
      if (shape.type === 'rectangle') {
        if (px >= xPx && px <= xPx + wPx && py >= yPx && py <= yPx + hPx) {
          inside = true;
        }
      } else {
        // Ellipse: compute normalised coordinates relative to centre
        const cx = xPx + wPx / 2;
        const cy = yPx + hPx / 2;
        const dx = px - cx;
        const dy = py - cy;
        const rx = wPx / 2;
        const ry = hPx / 2;
        if ((dx * dx) / (rx * rx) + (dy * dy) / (ry * ry) <= 1) {
          inside = true;
        }
      }
      if (inside) {
        // Select this shape
        selectedShapeId = shape.id;
        // Determine if the click is near the bottom-right corner for resizing.
        // Use a threshold of 15 pixels to make ellipse resizing easier to
        // activate.  Only rectangles and ellipses are supported.  For
        // rectangles, near the bottom-right corner means within 15px of
        // xPx + wPx and yPx + hPx.  For ellipses, we use the bounding box
        // corner similarly.
        const threshold = 15;
        const nearX = Math.abs(px - (xPx + wPx)) < threshold;
        const nearY = Math.abs(py - (yPx + hPx)) < threshold;
        if (nearX && nearY) {
          editMode = 'resize';
          // Store original bounding and size for proportional updates
          originalShapeBounds = {
            x: shape.x,
            y: shape.y,
            width: shape.width,
            height: shape.height,
            // For ellipse, width/height are radii (semi-major/minor)
          };
        } else {
          editMode = 'move';
          // Compute drag offset relative to the shape origin (top-left for
          // rectangles, centre for ellipses).  This offset keeps the
          // pointer in the same relative position while dragging.
          if (shape.type === 'rectangle') {
            dragOffsetX = px - xPx;
            dragOffsetY = py - yPx;
          } else {
            // For ellipse, use centre as reference
            const cx = xPx + wPx / 2;
            const cy = yPx + hPx / 2;
            dragOffsetX = px - cx;
            dragOffsetY = py - cy;
          }
        }
        // Update the shape list to reflect the selected state
        updateShapeList();
        break;
      }
    }
    // Redraw to show selection state (e.g. bounding box)
    drawDesign();
  }

  /**
   * Handler for mousemove on the design canvas.  Updates the
   * temporary shape preview while the user drags the mouse.
   *
   * @param {MouseEvent} event The mouse event.
   */
  function onDesignMouseMove(event) {
    const rect = designCanvas.getBoundingClientRect();
    const px = event.clientX - rect.left;
    const py = event.clientY - rect.top;
    // Handle drawing preview for new shapes
    if (isDrawingShape && (currentTool === 'rectangle' || currentTool === 'ellipse')) {
      currentPixelX = px;
      currentPixelY = py;
      drawDesign();
      return;
    }
    // Handle moving or resizing of a selected shape
    if (selectedShapeId !== null && editMode) {
      const shape = shapes.find((s) => s.id === selectedShapeId);
      if (!shape) return;
      if (editMode === 'move') {
        // Compute new origin/centre based on pointer and drag offset
        if (shape.type === 'rectangle') {
          const newX = ((px - dragOffsetX) / designCanvas.width) * gridCols;
          const newY = ((py - dragOffsetY) / designCanvas.height) * gridRows;
          // Clamp position within bounds
          shape.x = Math.max(0, Math.min(Math.round(newX), gridCols - shape.width));
          shape.y = Math.max(0, Math.min(Math.round(newY), gridRows - shape.height));
        } else {
          // Ellipse: x,y represent centre; width,height are radii.  When
          // moving an ellipse we need to ensure that its centre stays
          // within the grid boundaries so that the radii do not cause
          // it to extend beyond the [0, gridCols] × [0, gridRows]
          // region.  Clamp the centre coordinate based on the current
          // radii rather than simply clamping to 0–(gridCols − 1).  If
          // the radius is larger than the available space on either
          // side we clamp the centre accordingly.  See the API docs
          // for shape bounds【17228060284884†L215-L246】.
          const newCX = ((px - dragOffsetX) / designCanvas.width) * gridCols;
          const newCY = ((py - dragOffsetY) / designCanvas.height) * gridRows;
          const cx = Math.round(newCX);
          const cy = Math.round(newCY);
          // Ensure centre stays within [radius, grid - radius]
          shape.x = Math.max(shape.width, Math.min(cx, gridCols - shape.width));
          shape.y = Math.max(shape.height, Math.min(cy, gridRows - shape.height));
        }
      } else if (editMode === 'resize') {
        if (!originalShapeBounds) return;
        // Compute bounding in pixels from the shape's original top-left
        let originXPx, originYPx;
        if (shape.type === 'rectangle') {
          // Top-left corner remains fixed; update width and height based on pointer
          originXPx = (originalShapeBounds.x / gridCols) * designCanvas.width;
          originYPx = (originalShapeBounds.y / gridRows) * designCanvas.height;
          const newWidthPx = Math.max(5, px - originXPx);
          const newHeightPx = Math.max(5, py - originYPx);
          const newWidthGrid = Math.max(1, Math.round((newWidthPx / designCanvas.width) * gridCols));
          const newHeightGrid = Math.max(1, Math.round((newHeightPx / designCanvas.height) * gridRows));
          shape.width = Math.min(newWidthGrid, gridCols - originalShapeBounds.x);
          shape.height = Math.min(newHeightGrid, gridRows - originalShapeBounds.y);
          // Update shape origin to original origin (not changed)
          shape.x = originalShapeBounds.x;
          shape.y = originalShapeBounds.y;
        } else {
          // Ellipse: adjust radii (width/height represent radii).  When
          // resizing an ellipse we compute new radii based on pointer
          // distance from the original centre.  We then clamp these
          // radii so that the ellipse remains within the grid.  The
          // centre remains unchanged.  Ensure radius does not exceed
          // either the distance to the nearest grid edge from the
          // centre or the maximum grid size.
          const cxPx = (originalShapeBounds.x / gridCols) * designCanvas.width;
          const cyPx = (originalShapeBounds.y / gridRows) * designCanvas.height;
          const newRX = Math.max(5, Math.abs(px - cxPx));
          const newRY = Math.max(5, Math.abs(py - cyPx));
          let newRXGrid = Math.max(1, Math.round((newRX / designCanvas.width) * gridCols));
          let newRYGrid = Math.max(1, Math.round((newRY / designCanvas.height) * gridRows));
          // Clamp radii so that centre ± radius stays within [0, grid]
          const cxGrid = originalShapeBounds.x;
          const cyGrid = originalShapeBounds.y;
          newRXGrid = Math.min(newRXGrid, cxGrid, gridCols - cxGrid);
          newRYGrid = Math.min(newRYGrid, cyGrid, gridRows - cyGrid);
          shape.width = newRXGrid;
          shape.height = newRYGrid;
          // Centre remains original
          shape.x = originalShapeBounds.x;
          shape.y = originalShapeBounds.y;
        }
      }
      // During editing, redraw design to show updated shape
      drawDesign();
    }
  }

  /**
   * Handler for mouseup or mouseleave on the design canvas.  Finalises
   * the shape currently being drawn (if any) by converting the
   * pixel coordinates to grid coordinates, constructing a shape
   * object with a unique id and diffusivity, and adding it to
   * the shapes array.  If the drawn shape has zero area (e.g.
   * a click without drag), it is ignored.  After finalising, the
   * drawing flag is reset and the preview cleared.
   *
   * @param {MouseEvent} event The mouse event.
   */
  function onDesignMouseUp(event) {
    // End drawing mode if active
    if (isDrawingShape) {
      isDrawingShape = false;
      const rect = designCanvas.getBoundingClientRect();
      currentPixelX = event.clientX - rect.left;
      currentPixelY = event.clientY - rect.top;
      const dx = currentPixelX - startPixelX;
      const dy = currentPixelY - startPixelY;
      // If the user did not drag (nearly zero area), skip adding a shape
      if (Math.abs(dx) < 5 && Math.abs(dy) < 5) {
        drawDesign();
        return;
      }
      // Compute bounding rectangle in pixels
      const rectX = Math.min(startPixelX, currentPixelX);
      const rectY = Math.min(startPixelY, currentPixelY);
      const rectW = Math.abs(dx);
      const rectH = Math.abs(dy);
      // Convert bounding box to grid coordinates and create shape
      let shape;
      if (currentTool === 'rectangle') {
        const gridX = Math.round((rectX / designCanvas.width) * gridCols);
        const gridY = Math.round((rectY / designCanvas.height) * gridRows);
        const gridW = Math.max(1, Math.round((rectW / designCanvas.width) * gridCols));
        const gridH = Math.max(1, Math.round((rectH / designCanvas.height) * gridRows));
        // Clamp width and height so that the rectangle fits entirely within the grid
        const clampedW = Math.min(gridW, gridCols - gridX);
        const clampedH = Math.min(gridH, gridRows - gridY);
        shape = {
          id: nextShapeId++,
          type: 'rectangle',
          x: Math.max(0, Math.min(gridX, gridCols - 1)),
          y: Math.max(0, Math.min(gridY, gridRows - 1)),
          width: clampedW,
          height: clampedH,
          diffusivity: parseFloat(controls.shapeDiffusivity.value),
          visible: true,
          highlight: false,
        };
      } else if (currentTool === 'ellipse') {
        const cxPixel = rectX + rectW / 2;
        const cyPixel = rectY + rectH / 2;
        const rxPixel = rectW / 2;
        const ryPixel = rectH / 2;
        const gridCX = Math.round((cxPixel / designCanvas.width) * gridCols);
        const gridCY = Math.round((cyPixel / designCanvas.height) * gridRows);
        let gridRX = Math.max(1, Math.round((rxPixel / designCanvas.width) * gridCols));
        let gridRY = Math.max(1, Math.round((ryPixel / designCanvas.height) * gridRows));
        // Clamp radii so that the ellipse remains within the grid.  The
        // centre must lie between radius and grid‑radius bounds.
        gridRX = Math.min(gridRX, gridCX, gridCols - gridCX);
        gridRY = Math.min(gridRY, gridCY, gridRows - gridCY);
        shape = {
          id: nextShapeId++,
          type: 'ellipse',
          x: Math.max(gridRX, Math.min(gridCX, gridCols - gridRX)),
          y: Math.max(gridRY, Math.min(gridCY, gridRows - gridRY)),
          width: gridRX,
          height: gridRY,
          diffusivity: parseFloat(controls.shapeDiffusivity.value),
          visible: true,
          highlight: false,
        };
      }
      if (shape) {
        // Push the new shape without merging.  Shapes retain their
        // individual boundaries and do not automatically join with
        // neighbouring shapes.  Each shape is independent and may be
        // moved or resized later.
        shapes.push(shape);
        updateShapeList();
      }
      drawDesign();
      return;
    }
    // Handle editing completion for selected shape
    if (selectedShapeId !== null && editMode) {
      // Editing complete: simply clear edit mode and refresh.  We no
      // longer perform automatic merging when moving shapes; shapes are
      // merged only when drawn adjacent to another shape of equal
      // diffusivity (see creation logic below).
      editMode = null;
      originalShapeBounds = null;
      // Refresh list and redraw design to reflect updated shape
      updateShapeList();
      drawDesign();
      return;
    }
  }

  /**
   * Event handler for clicks in the shape list.  Uses event
   * delegation to determine which control (visibility toggle,
   * highlight button, delete button) was activated and updates
   * the corresponding shape accordingly.  After performing
   * the action, the shape list and design canvas are refreshed.
   *
   * @param {Event} event The click event.
   */
  function onShapeListClick(event) {
    const target = event.target;
    // Determine the list item and shape id
    const li = target.closest('li.shape-item');
    if (!li) return;
    const idStr = li.dataset.id;
    if (!idStr) return;
    const id = parseInt(idStr, 10);
    const shape = shapes.find((s) => s.id === id);
    if (!shape) return;
    const action = target.dataset.action;
    if (action === 'toggleVisibility') {
      // Checkbox toggles visibility
      shape.visible = target.checked;
      drawDesign();
    } else if (action === 'toggleHighlight') {
      shape.highlight = !shape.highlight;
      updateShapeList();
      drawDesign();
    } else if (action === 'deleteShape') {
      const idx = shapes.findIndex((s) => s.id === id);
      if (idx >= 0) shapes.splice(idx, 1);
      updateShapeList();
      drawDesign();
    }
  }

  /**
   * Remove all shapes from the design.  Clears the shapes array,
   * refreshes the shape list, and redraws the design overlay.
   */
  function clearShapes() {
    shapes.length = 0;
    updateShapeList();
    drawDesign();
  }

  /**
   * Create a material with the current shapes and run a simulation.
   * This function performs the following sequence of API calls:
   *  1. POST /api/materials/create to obtain a material identifier.
   *  2. POST /api/materials/{id}/add-rectangle or /add-ellipse for each shape.
   *  3. POST /api/simulations/with-material with the standard simulation
   *     parameters plus the material id.  If the API returns a job
   *     identifier, polling begins using the existing pollStatus().
   * During this process, UI elements are disabled to prevent
   * concurrent requests.  Progress updates and errors are
   * communicated via the status message and progress bar.  If
   * the user has not added any shapes, the function displays a
   * message and aborts.
   */
  async function runWithMaterial() {
    if (!controls.runMaterialButton) return;
    if (shapes.length === 0) {
      controls.statusMessage.textContent = 'Please add shapes before running a material simulation.';
      return;
    }
    // Reset playback and disable run buttons
    resetPlayback();
    controls.runButton.disabled = true;
    controls.runMaterialButton.disabled = true;
    controls.statusMessage.textContent = 'Creating material...';
    controls.progressBar.style.width = '0%';
    try {
      // Step 1: create material.  According to the API docs, the material
      // must specify the grid dimensions (width & height) and the base
      // diffusivity for the background.  The grid is always 100×100【17228060284884†L215-L246】.
      // Clamp base diffusivity to a small positive value when sending to
      // the backend.  The API requires a positive number, so if the
      // user-selected value is 0 we substitute 0.01.  The displayed
      // diffusivity and colour mapping still use the original value.
      const baseDiff = parseFloat(controls.diffusivity.value);
      const materialParams = {
        width: gridCols,
        height: gridRows,
        base_diffusivity: baseDiff > 0 ? baseDiff : 0.01,
      };
      const respCreate = await fetch('http://127.0.0.1:5000/api/materials/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(materialParams),
      });
      if (!respCreate.ok) {
        throw new Error(`Material create error ${respCreate.status}`);
      }
      const materialData = await respCreate.json();
      const materialId = materialData.material_id || materialData.id || materialData.job_id || materialData.id;
      if (!materialId) {
        throw new Error('Invalid material response: missing id');
      }
      // Step 2: add shapes
      for (const shape of shapes) {
        const endpoint = shape.type === 'rectangle' ? 'add-rectangle' : 'add-ellipse';
        // Construct payload according to API spec.  Rectangle payload
        // uses `rect_width` and `rect_height` for the span; ellipse
        // uses `semi_major` and `semi_minor` for radii【17228060284884†L254-L333】.
        // Clamp shape diffusivity to a small positive value for the API.  If
        // the shape's diffusivity is 0 we send 0.01 to avoid a 400 error.
        const shapeDiff = shape.diffusivity > 0 ? shape.diffusivity : 0.01;
        const body = { diffusivity: shapeDiff };
        if (shape.type === 'rectangle') {
          body.x = shape.x;
          body.y = shape.y;
          body.rect_width = shape.width;
          body.rect_height = shape.height;
        } else {
          body.center_x = shape.x;
          body.center_y = shape.y;
          body.semi_major = shape.width;
          body.semi_minor = shape.height;
          // Provide a default angle (degrees) for the ellipse.  The API
          // documentation notes this is optional and defaults to 0【17228060284884†L320-L335】.
          body.angle = 0.0;
        }
        const respAdd = await fetch(`http://127.0.0.1:5000/api/materials/${materialId}/${endpoint}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        if (!respAdd.ok) {
          throw new Error(`Error adding shape: ${respAdd.status}`);
        }
      }
      controls.statusMessage.textContent = 'Material created. Starting simulation...';
      // Step 3: start simulation with material
      // Prepare simulation parameters.  For a material simulation, the
      // request must include the material id and the same simulation
      // parameters as a standard run, but **should not** include a
      // diffusivity field.  The material's background diffusivity
      // comes from the created material【17228060284884†L386-L406】.
      const simParams = {
        total_time: parseFloat(controls.totalTime.value),
        initial_temperature: parseFloat(controls.initialTemperature.value),
        boundary_temperatures: {
          top: parseFloat(controls.boundaryTop.value),
          right: parseFloat(controls.boundaryRight.value),
          bottom: parseFloat(controls.boundaryBottom.value),
          left: parseFloat(controls.boundaryLeft.value),
        },
        material_id: materialId,
      };
      const respSim = await fetch('http://127.0.0.1:5000/api/simulations/with-material', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(simParams),
      });
      if (!respSim.ok) {
        throw new Error(`Simulation start error ${respSim.status}`);
      }
      const simData = await respSim.json();
      const jobId = simData.job_id || simData.id || simData.jobId;
      if (!jobId) {
        throw new Error('Invalid simulation response: missing job_id');
      }
      controls.statusMessage.textContent = 'Simulation started...';
      // Begin polling for status as usual
      pollStatus(jobId);
    } catch (err) {
      console.error(err);
      controls.statusMessage.textContent = `Error running material simulation: ${err.message}`;
      // Re-enable buttons to allow retry
      controls.runButton.disabled = false;
      controls.runMaterialButton.disabled = false;
    }
  }

  /**
   * Update playback UI information and draw the current frame.
   * This helper centralises the logic that must run whenever
   * `currentFrame` changes, whether due to user interaction or
   * automatic playback.  It updates text labels, computes the
   * simulated time for the frame, and paints the frame on the
   * canvas.  If there are no frames loaded the function returns
   * early.
   */
  function updatePlayback() {
    if (!frames || frames.length === 0) {
      return;
    }
    // Clamp index within valid bounds
    currentFrame = Math.min(Math.max(currentFrame, 0), frames.length - 1);
    // Draw the frame
    drawFrame(frames[currentFrame]);
    // Update frame indicator text (1-based index)
    controls.frameIndicator.textContent = `Frame ${currentFrame + 1} / ${frames.length}`;
    // Compute elapsed simulation time using totalTime slider value
    const totalTime = parseFloat(controls.totalTime.value);
    // If only one frame, time is 0
    let time = 0;
    if (frames.length > 1) {
      time = (currentFrame / (frames.length - 1)) * totalTime;
    }
    controls.timeIndicator.textContent = `Time: ${time.toFixed(3)}s`;

    // Update the frame slider to reflect the current frame
    if (controls.frameSlider && !controls.frameSlider.disabled) {
      controls.frameSlider.value = currentFrame;
    }
  }

  /**
   * Start or pause the automatic playback.  When playing, the
   * function schedules a timer that advances the frame index at
   * regular intervals (e.g. 200ms).  When paused, any existing
   * interval is cleared.  The button text reflects the current
   * state.  This function also gracefully handles one‑frame
   * simulations by disabling the timer entirely, since there is
   * nothing to animate.
   */
  function togglePlayback() {
    // No frames loaded: nothing to do
    if (!frames || frames.length <= 1) {
      return;
    }
    if (animationTimer) {
      // Currently playing; pause
      clearInterval(animationTimer);
      animationTimer = null;
      controls.playPauseButton.textContent = 'Play';
    } else {
      // Currently paused; start playing
      controls.playPauseButton.textContent = 'Pause';
      // Set the playback interval to a moderate value.  A longer interval
      // slows down the animation, making it easier to follow.  Using
      // approximately 300ms here results in about 3–4 frames per second,
      // matching the original playback speed prior to recent changes.
      animationTimer = setInterval(() => {
        currentFrame++;
        if (currentFrame >= frames.length) {
          // Loop back to start
          currentFrame = 0;
        }
        updatePlayback();
      }, 300);
    }
  }

  /**
   * Reset playback state after a new simulation starts.  This
   * clears existing frames, stops any running animation, hides
   * playback controls and displays the initial temperature field.
   */
  function resetPlayback() {
    // Stop existing animation if running
    if (animationTimer) {
      clearInterval(animationTimer);
      animationTimer = null;
    }
    // Reset frames and index
    frames = [];
    currentFrame = 0;
    // Hide playback controls until results are loaded
    controls.playbackControls.classList.add('hidden');
    // Display uniform initial temperature on canvas
    const initialTemp = parseFloat(controls.initialTemperature.value);
    // Fill entire canvas with initial temperature colour
    minTemp = initialTemp - 0.5;
    maxTemp = initialTemp + 0.5;
    drawFrame([[initialTemp]]); // 1x1 grid, will fill entire canvas
    // Update the colour bar for the uniform initial field
    drawColorBar();

    // Redraw the material overlay after resetting the canvas.  This
    // ensures that any existing shapes remain visible when the
    // user resets or starts a new simulation.
    drawDesign();

    // Reset the frame slider: disable it and reset its range to a single frame
    if (controls.frameSlider) {
      controls.frameSlider.disabled = true;
      controls.frameSlider.min = 0;
      controls.frameSlider.max = 0;
      controls.frameSlider.value = 0;
    }
  }

  /**
   * Start a new simulation by posting parameters to the backend.
   * This function assembles a JSON payload from the current
   * slider values, sends a POST request to the API, disables
   * the run button to prevent concurrent jobs, and begins polling
   * for completion.  On success, it triggers result fetching;
   * on failure, it shows an error message and re‑enables the run
   * button.
   */
  async function startSimulation() {
    // Read parameters from controls
    // Clamp values according to API requirements.  The initial temperature
    // must lie between 15 and 25 °C per the specification; if the user
    // selects a higher value we cap it at 25 when sending to the backend.
    // Diffusivity must be a positive number; values below 0.01 are
    // substituted with 0.01.  Boundary temperatures remain unmodified
    // because the API accepts 0–100 °C and our sliders enforce 20–50.
    const selectedInitial = parseFloat(controls.initialTemperature.value);
    const clampedInitial = selectedInitial > 25 ? 25 : selectedInitial;
    const selectedDiff = parseFloat(controls.diffusivity.value);
    const clampedDiff = selectedDiff > 0 ? selectedDiff : 0.01;
    const params = {
      total_time: parseFloat(controls.totalTime.value),
      initial_temperature: clampedInitial,
      boundary_temperatures: {
        top: parseFloat(controls.boundaryTop.value),
        right: parseFloat(controls.boundaryRight.value),
        bottom: parseFloat(controls.boundaryBottom.value),
        left: parseFloat(controls.boundaryLeft.value),
      },
      diffusivity: clampedDiff,
    };
    // Reset playback UI and state
    resetPlayback();
    // Disable the run button during simulation
    controls.runButton.disabled = true;
    controls.statusMessage.textContent = 'Submitting simulation request...';
    controls.progressBar.style.width = '0%';
    try {
      const response = await fetch('http://127.0.0.1:5000/api/simulations/custom', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
      });
      if (!response.ok) {
        throw new Error(`HTTP error ${response.status}`);
      }
      const data = await response.json();
      const jobId = data.job_id || data.id || data.jobId;
      if (!jobId) {
        throw new Error('Invalid response: missing job_id');
      }
      controls.statusMessage.textContent = 'Simulation started...';
      // Begin polling for status
      pollStatus(jobId);
    } catch (err) {
      console.error(err);
      controls.statusMessage.textContent = `Error starting simulation: ${err.message}`;
      controls.runButton.disabled = false;
    }
  }

  /**
   * Poll the backend for simulation progress.  This function
   * repeatedly queries the status endpoint until the job
   * completes.  It updates the progress bar and status text
   * accordingly.  When the simulation is finished it triggers
   * result retrieval.
   *
   * @param {string} jobId The unique identifier returned by the backend.
   */
  async function pollStatus(jobId) {
    try {
      const response = await fetch(`http://127.0.0.1:5000/api/simulations/${jobId}/status`);
      if (!response.ok) {
        throw new Error(`Status HTTP error ${response.status}`);
      }
      const data = await response.json();
      // Determine progress and status fields; support a few possible field names
      const status = data.status || data.state || '';
      const progressRaw = data.progress ?? data.percentage ?? 0;
      // Convert the raw progress value into a normalised 0–1 fraction.  The
      // backend may return either a ratio (0–1) or a percentage (0–100).
      // If the value exceeds 1 we interpret it as a percentage and scale
      // accordingly.  This prevents values like 50 from being clamped
      // immediately to 100%.
      let progress = 0;
      if (typeof progressRaw === 'number') {
        if (progressRaw > 1) {
          // Assume a 0–100 percentage; normalise to 0–1
          progress = progressRaw / 100;
        } else {
          progress = progressRaw;
        }
      }
      // Clamp progress to [0,1] and convert to a percentage for the bar
      const pct = Math.floor(Math.min(Math.max(progress, 0), 1) * 100);
      controls.progressBar.style.width = `${pct}%`;
      controls.statusMessage.textContent = status;
      if (/complete/i.test(status) || /finished/i.test(status) || /done/i.test(status)) {
        // Final status reached; fetch results
        controls.progressBar.style.width = '100%';
        controls.statusMessage.textContent = 'Simulation complete. Fetching results...';
        await fetchResults(jobId);
        return;
      }
      // Continue polling after a short delay
      setTimeout(() => pollStatus(jobId), 1000);
    } catch (err) {
      console.error(err);
      controls.statusMessage.textContent = `Error polling status: ${err.message}`;
      // Allow the user to attempt another run if polling fails
      controls.runButton.disabled = false;
      // If a material run was in progress, re‑enable the material run button as well
      if (controls.runMaterialButton) {
        controls.runMaterialButton.disabled = false;
      }
    }
  }

  /**
   * Fetch simulation results from the backend.  Frames are
   * requested sequentially until no more frames are available.
   * The endpoint may return an error or a 404 to signal the end
   * of the sequence.  Once all frames are collected, the
   * temperature extremes are computed and the first frame is
   * rendered.  Playback controls become visible and the run
   * button is re‑enabled.  Errors during retrieval are caught
   * and displayed.
   *
   * @param {string} jobId The job identifier.
   */
  async function fetchResults(jobId) {
    frames = [];
    currentFrame = 0;
    let frameIndex = 0;
    let gotFrame = false;

    /**
     * Attempt to extract a 2D numeric array from an arbitrary JSON object.
     * The backend may wrap the frame in different property names.  This
     * helper scans top‑level values and returns the first value that
     * appears to be an array of arrays.  If nothing suitable is found
     * the function returns null.
     *
     * @param {any} data Arbitrary JSON object or array.
     * @returns {number[][]|null} A candidate frame or null.
     */
    function extractFrame(data) {
      /**
       * Recursively search for a 2D numeric array within a JSON
       * structure.  Many APIs nest the frame data inside one or more
       * objects; this helper will traverse arrays and objects until
       * it finds a candidate matrix.  A candidate is defined as an
       * array whose first element is an array containing at least
       * one number.  The search returns the first match found or
       * null if none is found.
       *
       * @param {any} node The current node in the traversal.
       * @returns {number[][]|null}
       */
      function findFrameRecursive(node) {
        if (!node) return null;
        if (Array.isArray(node)) {
          // Check if this is a 2D numeric array
          if (node.length > 0 && Array.isArray(node[0]) && node[0].length > 0 && typeof node[0][0] === 'number') {
            return node;
          }
          // Otherwise traverse array elements
          for (const item of node) {
            const found = findFrameRecursive(item);
            if (found) return found;
          }
        } else if (typeof node === 'object') {
          for (const key of Object.keys(node)) {
            const found = findFrameRecursive(node[key]);
            if (found) return found;
          }
        }
        return null;
      }
      return findFrameRecursive(data);
    }

    try {
      // Attempt to fetch frames sequentially starting from index 0.  The
      // backend may or may not support this scheme; if it does not
      // return frames in sequence we will fall back to requesting the
      // final frame.
      while (true) {
        const url = `http://127.0.0.1:5000/api/simulations/${jobId}/results?frame=${frameIndex}`;
        // eslint-disable-next-line no-await-in-loop
        const response = await fetch(url);
        if (!response.ok) {
          // Non‑success likely means no more frames are available
          break;
        }
        // Parse the response text first to handle both JSON and non‑JSON payloads
        // eslint-disable-next-line no-await-in-loop
        const text = await response.text();
        let resultData = null;
        try {
          resultData = JSON.parse(text);
        } catch (_) {
          // Not JSON; cannot extract numeric frame from raw text
        }
        const frame = extractFrame(resultData);
        if (!frame) {
          // If no 2D numeric array found, stop iterating
          break;
        }
        frames.push(frame);
        frameIndex++;
        gotFrame = true;
      }
      // If sequential fetch yielded no frames, request the last frame as
      // fallback.  Some APIs only expose the final result at ?frame=last.
      if (!gotFrame) {
        const url = `http://127.0.0.1:5000/api/simulations/${jobId}/results?frame=last`;
        const response = await fetch(url);
        if (response.ok) {
          const text = await response.text();
          let resultData = null;
          try {
            resultData = JSON.parse(text);
          } catch (_) {
            resultData = null;
          }
          const frame = extractFrame(resultData);
          if (frame) {
            frames.push(frame);
          }
        }
      }
      if (frames.length === 0) {
        controls.statusMessage.textContent = 'No result frames available.';
      } else {
        computeTemperatureExtremes();
        updatePlayback();
        controls.statusMessage.textContent = `Loaded ${frames.length} frame${frames.length > 1 ? 's' : ''}.`;
        // Show playback controls; disable play if only one frame
        controls.playbackControls.classList.remove('hidden');
        controls.playPauseButton.disabled = frames.length <= 1;
        // Configure the frame slider to allow scrubbing through frames
        if (controls.frameSlider) {
          controls.frameSlider.min = 0;
          controls.frameSlider.max = frames.length - 1;
          controls.frameSlider.value = 0;
          controls.frameSlider.disabled = frames.length <= 1;
        }
      }
    } catch (err) {
      console.error(err);
      controls.statusMessage.textContent = `Error fetching results: ${err.message}`;
    } finally {
      // Re‑enable run controls after results have been fetched so the user can
      // start another simulation or material run.  Both run buttons are
      // reactivated here to ensure that repeated runs are possible without
      // reloading the page.
      controls.runButton.disabled = false;
      if (controls.runMaterialButton) {
        controls.runMaterialButton.disabled = false;
      }
    }
  }

  /**
   * Entry point: register event listeners and initialize UI state.
   */
  function init() {
    initialiseValueBindings();
    controls.runButton.addEventListener('click', startSimulation);
    controls.playPauseButton.addEventListener('click', togglePlayback);
    // Allow users to scrub through frames manually via the frame slider
    if (controls.frameSlider) {
      controls.frameSlider.addEventListener('input', () => {
        // Only respond if frames are loaded
        if (!frames || frames.length === 0) {
          return;
        }
        const newIndex = parseInt(controls.frameSlider.value, 10);
        if (!Number.isNaN(newIndex)) {
          // Pause playback if currently playing
          if (animationTimer) {
            clearInterval(animationTimer);
            animationTimer = null;
            controls.playPauseButton.textContent = 'Play';
          }
          currentFrame = newIndex;
          updatePlayback();
        }
      });
    }
    // Initial canvas display: fill with initial temperature
    resetPlayback();

    /* ---------------- Material design bindings ---------------- */
    // Initialise shape diffusivity display
    if (controls.shapeDiffusivity && controls.shapeDiffusivityValue) {
      updateDisplay(controls.shapeDiffusivity, controls.shapeDiffusivityValue);
      controls.shapeDiffusivity.addEventListener('input', () => {
        updateDisplay(controls.shapeDiffusivity, controls.shapeDiffusivityValue);
      });
    }
    // Tool selection radios (rectangle/ellipse).  Changing a radio sets
    // the current drawing tool.  The select mode is handled via a
    // separate button.
    const toolRadios = [controls.toolRectangle, controls.toolEllipse];
    toolRadios.forEach((radio) => {
      if (radio) {
        radio.addEventListener('change', () => {
          if (radio.checked) {
            currentTool = radio.value;
            updateDesignTool();
          }
        });
      }
    });
    // Clicking on the "Select Shape" subtitle returns to selection mode by
    // clearing any active drawing tool.  This avoids the need for a
    // separate button.
    if (controls.selectShapeLabel) {
      controls.selectShapeLabel.addEventListener('click', () => {
        currentTool = 'select';
        if (controls.toolRectangle) controls.toolRectangle.checked = false;
        if (controls.toolEllipse) controls.toolEllipse.checked = false;
        updateDesignTool();
      });
    }
    // Shape list event delegation
    if (controls.shapeList) {
      controls.shapeList.addEventListener('click', onShapeListClick);
      controls.shapeList.addEventListener('change', onShapeListClick);
    }
    // Design canvas drawing events
    if (designCanvas) {
      // Attach drawing events.  Do not attempt to match the heat canvas size;
      // the design canvas dimensions are defined in the HTML and styled via CSS.
      designCanvas.addEventListener('mousedown', onDesignMouseDown);
      designCanvas.addEventListener('mousemove', onDesignMouseMove);
      designCanvas.addEventListener('mouseup', onDesignMouseUp);
      designCanvas.addEventListener('mouseleave', onDesignMouseUp);
    }
    // Clear shapes button
    if (controls.clearShapesButton) {
      controls.clearShapesButton.addEventListener('click', clearShapes);
    }
    // Run with material button
    if (controls.runMaterialButton) {
      controls.runMaterialButton.addEventListener('click', runWithMaterial);
    }
    // Set initial tool pointer state
    updateDesignTool();
  }

  // Kick off initialization when the DOM content is fully loaded
  document.addEventListener('DOMContentLoaded', init);
})();