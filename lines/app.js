const dom = {
  graph: document.getElementById("graph"),
  plotBackground: document.getElementById("plotBackground"),
  gridHit: document.getElementById("gridHit"),
  clipRect: document.getElementById("clipRect"),
  gridLayer: document.getElementById("gridLayer"),
  axisLayer: document.getElementById("axisLayer"),
  lineLayer: document.getElementById("lineLayer"),
  lineShadow: document.getElementById("lineShadow"),
  line: document.getElementById("line"),
  lineHit: document.getElementById("lineHit"),
  pointLayer: document.getElementById("pointLayer"),
  snapPoint: document.getElementById("snapPoint"),
  equationText: document.getElementById("equationText"),
  resetButton: document.getElementById("resetButton"),
  snapButton: document.getElementById("snapButton"),
};

const plot = {
  x: 70,
  y: 34,
  width: 620,
  height: 420,
  minX: -10,
  maxX: 10,
  minY: -7,
  maxY: 7,
};

const VERTICAL_EPSILON = 0.03;
const SLOPE_RUN_UNITS = 1;
const MAX_FRACTION_DENOMINATOR = 12;

const state = {
  angle: Math.atan(0.5),
  intercept: 1,
  selectedPoint: null,
  slopeFormat: "decimal",
  editing: null,
  drag: null,
};

let slopeClickTimer = null;

function render() {
  renderGeometry();
  renderReadout();
}

function renderGeometry() {
  const segment = getLineSegment(state.angle, state.intercept);

  setLine(dom.line, segment);
  setLine(dom.lineShadow, segment);
  setLine(dom.lineHit, segment);
  renderPoints();
}

function renderStaticGraph() {
  dom.plotBackground.setAttribute("x", plot.x);
  dom.plotBackground.setAttribute("y", plot.y);
  dom.plotBackground.setAttribute("width", plot.width);
  dom.plotBackground.setAttribute("height", plot.height);
  dom.gridHit.setAttribute("x", plot.x);
  dom.gridHit.setAttribute("y", plot.y);
  dom.gridHit.setAttribute("width", plot.width);
  dom.gridHit.setAttribute("height", plot.height);
  dom.clipRect.setAttribute("x", plot.x);
  dom.clipRect.setAttribute("y", plot.y);
  dom.clipRect.setAttribute("width", plot.width);
  dom.clipRect.setAttribute("height", plot.height);

  dom.gridLayer.innerHTML = "";
  dom.axisLayer.innerHTML = "";

  for (let x = plot.minX; x <= plot.maxX; x += 1) {
    const line = makeSvg("line", {
      x1: worldToScreenX(x),
      y1: plot.y,
      x2: worldToScreenX(x),
      y2: plot.y + plot.height,
      class: `grid-line${x === 0 ? " is-major" : ""}`,
    });
    dom.gridLayer.append(line);

    if (x !== 0 && x % 2 === 0) {
      dom.axisLayer.append(
        makeSvg("text", {
          x: worldToScreenX(x),
          y: worldToScreenY(0) + 22,
          class: "tick-label",
          "text-anchor": "middle",
        }, String(x)),
      );
    }
  }

  for (let y = plot.minY; y <= plot.maxY; y += 1) {
    const line = makeSvg("line", {
      x1: plot.x,
      y1: worldToScreenY(y),
      x2: plot.x + plot.width,
      y2: worldToScreenY(y),
      class: `grid-line${y === 0 ? " is-major" : ""}`,
    });
    dom.gridLayer.append(line);

    if (y !== 0 && y % 2 === 0) {
      dom.axisLayer.append(
        makeSvg("text", {
          x: worldToScreenX(0) - 14,
          y: worldToScreenY(y) + 4,
          class: "tick-label",
          "text-anchor": "end",
        }, String(y)),
      );
    }
  }

  dom.axisLayer.append(
    makeSvg("line", {
      x1: worldToScreenX(0),
      y1: plot.y,
      x2: worldToScreenX(0),
      y2: plot.y + plot.height,
      class: "axis axis-y",
    }),
  );
  dom.axisLayer.append(
    makeSvg("line", {
      x1: plot.x,
      y1: worldToScreenY(0),
      x2: plot.x + plot.width,
      y2: worldToScreenY(0),
      class: "axis",
    }),
  );
  dom.axisLayer.append(
    makeSvg("text", {
      x: plot.x + plot.width + 18,
      y: worldToScreenY(0) + 5,
      class: "axis-label",
      "text-anchor": "middle",
    }, "x"),
  );
  dom.axisLayer.append(
    makeSvg("text", {
      x: worldToScreenX(0),
      y: plot.y - 14,
      class: "axis-label",
      "text-anchor": "middle",
    }, "y"),
  );

  dom.gridLayer.append(makeSvg("line", { id: "snapGuide", class: "snap-guide" }));
}

function renderPoints() {
  dom.pointLayer.innerHTML = "";

  const vertical = isVerticalAngle(state.angle);
  const interceptPoint = {
    x: 0,
    y: state.intercept,
  };
  const slope = getSlope();

  if (!vertical) {
    const slopePoint = {
      x: SLOPE_RUN_UNITS,
      y: slope * SLOPE_RUN_UNITS + state.intercept,
    };

    if (!isVisibleWorldPoint(slopePoint.x, slopePoint.y)) {
      appendPoint(interceptPoint, { className: "intercept-point" });
      appendSelectedPoint();
      return;
    }

    dom.pointLayer.append(
      makeSvg("line", {
        x1: worldToScreenX(interceptPoint.x),
        y1: worldToScreenY(interceptPoint.y),
        x2: worldToScreenX(slopePoint.x),
        y2: worldToScreenY(interceptPoint.y),
        class: "slope-run",
      }),
    );
    dom.pointLayer.append(
      makeSvg("line", {
        x1: worldToScreenX(slopePoint.x),
        y1: worldToScreenY(interceptPoint.y),
        x2: worldToScreenX(slopePoint.x),
        y2: worldToScreenY(slopePoint.y),
        class: "slope-rise",
      }),
    );
    appendPoint(interceptPoint, { className: "intercept-point" });
    appendPoint(slopePoint, { className: "slope-handle", handle: "slope" });
    appendSelectedPoint();
    return;
  }

  appendPoint(interceptPoint, { className: "intercept-point" });
  appendSelectedPoint();
}

function appendSelectedPoint() {
  if (!state.selectedPoint) {
    return;
  }

  appendPoint(state.selectedPoint, { className: "selected-point", selected: true });
}

function appendPoint(point, options = {}) {
  if (!isVisibleWorldPoint(point.x, point.y)) {
    return;
  }

  const x = worldToScreenX(point.x);
  const y = worldToScreenY(point.y);
  const circle = makeSvg("circle", {
    cx: x,
    cy: y,
    r: 6,
    class: `point${options.className ? ` ${options.className}` : ""}`,
  });

  if (options.handle === "slope") {
    circle.dataset.handle = "slope";
    circle.addEventListener("pointerdown", (event) => onPointerDown(event, "slope-handle"));
  }

  if (options.selected) {
    circle.addEventListener("click", (event) => {
      event.stopPropagation();
      toggleSelectedPoint(point);
    });
  }

  dom.pointLayer.append(circle);
}

function renderReadout() {
  dom.equationText.replaceChildren(
    ...equationNodes(state.angle, state.intercept, state.selectedPoint, state.editing),
  );
}

function equationText(angle, intercept) {
  return equationNodes(angle, intercept, state.selectedPoint)
    .map((node) => node.textContent)
    .join("");
}

function equationNodes(angle, intercept, point = null, editing = null) {
  if (isVerticalAngle(angle)) {
    return point ? [equationPart(`${formatValue(point.x)} = 0`)] : [equationPart("x = 0")];
  }

  const slope = getSlopeFromAngle(angle);
  const y = equationPart(point ? formatValue(point.y) : "y");

  const slopeParts = getSlopeEquationParts(slope, point, editing);
  const displayIntercept = cleanValue(intercept);
  const sign = displayIntercept < 0 ? "-" : "+";
  const interceptClass =
    displayIntercept === 0 ? "equation-intercept equation-muted-factor" : "equation-intercept";
  const interceptPart =
    editing?.target === "intercept"
      ? equationEditInput("intercept", editing.value, interceptClass)
      : editableEquationPart(
        `${sign} ${formatValue(Math.abs(displayIntercept))}`,
        interceptClass,
        "intercept",
      );

  return [
    y,
    equationPart(" = "),
    ...slopeParts,
    equationPart(" "),
    interceptPart,
  ];
}

function getSlopeEquationParts(slope, point = null, editing = null) {
  const className =
    slope === 0 || Math.abs(slope) === 1
      ? "equation-slope equation-muted-factor"
      : "equation-slope";

  const slopePart =
    editing?.target === "slope"
      ? equationEditInput("slope", editing.value, className)
      : slopeEquationPart(formatSlopeValue(slope), className);

  return [slopePart, getInsertedXPart(point)];
}

function getInsertedXPart(point) {
  return point ? equationPart(`(${formatValue(point.x)})`) : equationPart("x");
}

function slopeEquationPart(text, className = "equation-slope") {
  const span = equationPart(text, className);
  span.dataset.slopeToggle = "true";
  span.dataset.editTarget = "slope";
  span.setAttribute("role", "button");
  span.setAttribute("tabindex", "0");
  span.setAttribute("aria-label", "Toggle slope between decimal and fraction; double-click to edit");
  return span;
}

function editableEquationPart(text, className, target) {
  const span = equationPart(text, className);
  span.dataset.editTarget = target;
  return span;
}

function equationEditInput(target, value, className) {
  const input = document.createElement("input");
  input.type = "text";
  input.inputMode = "decimal";
  input.value = value;
  input.className = `${className} equation-edit-input`;
  input.dataset.editTarget = target;
  input.setAttribute("aria-label", target === "slope" ? "Edit slope" : "Edit y-intercept");
  input.setAttribute("autocomplete", "off");
  input.setAttribute("spellcheck", "false");
  resizeEquationInput(input);

  input.addEventListener("input", onEquationEditInput);
  input.addEventListener("keydown", onEquationEditKeydown);
  input.addEventListener("blur", () => commitEquationEdit());
  input.addEventListener("click", (event) => event.stopPropagation());
  input.addEventListener("dblclick", (event) => event.stopPropagation());

  return input;
}

function equationPart(text, className = "") {
  const span = document.createElement("span");
  span.textContent = text;
  if (className) {
    span.className = className;
  }
  return span;
}

function startEquationEdit(target) {
  if (target !== "slope" && target !== "intercept") {
    return;
  }

  clearSlopeClickTimer();

  if (state.editing) {
    commitEquationEdit();
  }

  state.editing = {
    target,
    value: target === "slope" ? formatSlopeValue(getSlope()) : formatSignedEditValue(state.intercept),
    startAngle: state.angle,
    startIntercept: state.intercept,
  };

  renderReadout();

  const input = dom.equationText.querySelector(`input[data-edit-target="${target}"]`);
  if (!input) {
    return;
  }

  window.requestAnimationFrame(() => {
    input.focus();
    input.select();
  });
}

function onEquationEditInput(event) {
  if (!state.editing) {
    return;
  }

  const input = event.currentTarget;
  state.editing.value = input.value;
  resizeEquationInput(input);
  const value = parseEquationNumber(input.value);
  const applied = applyEquationEdit(state.editing.target, value, input.value);
  input.classList.toggle("is-invalid", !applied && input.value.trim() !== "");
  if (applied) {
    input.classList.toggle("equation-muted-factor", isMutedEquationValue(state.editing.target, value));
  }
}

function onEquationEditKeydown(event) {
  event.stopPropagation();

  if (event.key === "Enter") {
    event.preventDefault();
    commitEquationEdit();
  }

  if (event.key === "Escape") {
    event.preventDefault();
    commitEquationEdit({ restore: true });
  }
}

function applyEquationEdit(target, value, rawValue) {
  if (value === null) {
    return false;
  }

  if (target === "slope") {
    state.angle = Math.atan(value);
    state.slopeFormat = rawValue.includes("/") ? "fraction" : "decimal";
  }

  if (target === "intercept") {
    state.intercept = clamp(value, plot.minY - 3, plot.maxY + 3);
  }

  renderGeometry();
  return true;
}

function isMutedEquationValue(target, value) {
  return target === "slope" ? value === 0 || Math.abs(value) === 1 : value === 0;
}

function commitEquationEdit(options = {}) {
  if (!state.editing) {
    return;
  }

  const edit = state.editing;
  if (options.restore) {
    state.angle = edit.startAngle;
    state.intercept = edit.startIntercept;
  }

  state.editing = null;
  render();
}

function parseEquationNumber(rawValue) {
  const normalized = rawValue
    .trim()
    .replace(/\u2212/g, "-")
    .replace(/,/g, ".")
    .replace(/\s+/g, "");

  if (
    !normalized ||
    normalized === "+" ||
    normalized === "-" ||
    normalized === "." ||
    normalized === "+." ||
    normalized === "-."
  ) {
    return null;
  }

  const fractionParts = normalized.split("/");
  if (fractionParts.length === 2) {
    const numerator = Number(fractionParts[0]);
    const denominator = Number(fractionParts[1]);
    if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) {
      return null;
    }
    return numerator / denominator;
  }

  if (fractionParts.length > 2) {
    return null;
  }

  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatSignedEditValue(value) {
  const clean = cleanValue(value);
  if (clean > 0) {
    return `+${formatValue(clean)}`;
  }
  if (clean < 0) {
    return `-${formatValue(Math.abs(clean))}`;
  }
  return "0";
}

function resizeEquationInput(input) {
  input.style.width = `${Math.max(1, input.value.length) + 0.8}ch`;
}

function onPointerDown(event, modeOverride = null) {
  if (event.button !== 0 && event.button !== 2) {
    return;
  }

  event.preventDefault();

  if (state.editing) {
    commitEquationEdit();
  }

  const pointer = eventToWorld(event);
  const mode = modeOverride ?? (event.button === 2 ? "slope" : "intercept");
  const pivot = { x: 0, y: state.intercept };
  const pointerAngle = getPointerAngle(pointer, pivot, state.angle);

  try {
    dom.graph.setPointerCapture(event.pointerId);
  } catch {
    // Window-level listeners keep the drag alive if capture is unavailable.
  }

  state.drag = {
    mode,
    pointerId: event.pointerId,
    startClientX: event.clientX,
    startClientY: event.clientY,
    startX: pointer.x,
    startY: pointer.y,
    startAngle: state.angle,
    currentAngle: state.angle,
    lastPointerAngle: pointerAngle,
    lastPointer: pointer,
    startIntercept: state.intercept,
    pivot,
  };

  dom.graph.classList.add("is-dragging");
  dom.graph.classList.toggle("is-slope-dragging", mode === "slope" || mode === "slope-handle");
  renderSnapGuide(shouldSnapOnRelease(event));

  window.addEventListener("pointermove", onPointerMove);
  window.addEventListener("pointerup", onPointerUp);
  window.addEventListener("pointercancel", onPointerCancel);
}

function onPointerMove(event) {
  if (!state.drag || event.pointerId !== state.drag.pointerId) {
    return;
  }

  event.preventDefault();
  const distance = Math.hypot(event.clientX - state.drag.startClientX, event.clientY - state.drag.startClientY);
  if (distance > 4) {
    state.drag.moved = true;
  }
  const pointer = eventToWorld(event);
  state.drag.lastPointer = pointer;

  if (state.drag.mode === "intercept") {
    state.intercept = clamp(
      state.drag.startIntercept + pointer.y - state.drag.startY,
      plot.minY - 3,
      plot.maxY + 3,
    );
  }

  if (state.drag.mode === "slope") {
    const pointerAngle = getPointerAngle(pointer, state.drag.pivot, state.drag.lastPointerAngle);
    const deltaAngle = normalizeAngleDelta(pointerAngle - state.drag.lastPointerAngle);
    state.drag.currentAngle += deltaAngle;
    state.drag.lastPointerAngle = pointerAngle;
    state.angle = state.drag.currentAngle;
  }

  if (state.drag.mode === "slope-handle") {
    const handleY = clamp(pointer.y, plot.minY, plot.maxY);
    state.angle = Math.atan2(handleY - state.drag.pivot.y, SLOPE_RUN_UNITS);
    state.drag.currentAngle = state.angle;
  }

  renderSnapGuide(shouldSnapOnRelease(event));
  render();
}

function onPointerUp(event) {
  if (!state.drag || event.pointerId !== state.drag.pointerId) {
    return;
  }

  event.preventDefault();
  const mode = state.drag.mode;
  state.drag.lastPointer = eventToWorld(event);
  const finishedDrag = { ...state.drag };
  const shouldSnap = shouldSnapOnRelease(event);

  cleanupDrag();

  if (!finishedDrag.moved) {
    toggleSelectedPoint(getNearestGridPoint(finishedDrag.lastPointer));
    return;
  }

  if (shouldSnap) {
    snapLine(mode, finishedDrag);
  } else {
    render();
  }
}

function shouldSnapOnRelease(event) {
  return !event.ctrlKey && !event.metaKey;
}

function onGridClick(event) {
  if (state.drag) {
    return;
  }

  toggleSelectedPoint(getNearestGridPoint(eventToWorld(event)));
}

function toggleSelectedPoint(point) {
  if (state.selectedPoint && state.selectedPoint.x === point.x && state.selectedPoint.y === point.y) {
    state.selectedPoint = null;
  } else {
    state.selectedPoint = point;
  }

  render();
}

function getNearestGridPoint(point) {
  return {
    x: clamp(Math.round(point.x), plot.minX, plot.maxX),
    y: clamp(Math.round(point.y), plot.minY, plot.maxY),
  };
}

function onPointerCancel() {
  if (!state.drag) {
    return;
  }

  cleanupDrag();
  render();
}

function cleanupDrag() {
  window.removeEventListener("pointermove", onPointerMove);
  window.removeEventListener("pointerup", onPointerUp);
  window.removeEventListener("pointercancel", onPointerCancel);
  state.drag = null;
  dom.graph.classList.remove("is-dragging", "is-slope-dragging", "is-snapping");
  clearSnapGuide();
}

function snapLine(mode = "both", drag = null) {
  if (mode === "intercept" || mode === "both") {
    state.intercept = clamp(Math.round(state.intercept), plot.minY - 3, plot.maxY + 3);
  }

  if (mode === "slope" || mode === "slope-handle" || mode === "both") {
    const snapTarget = mode === "slope-handle" ? getSlopeHandleSnapTarget(drag) : getSlopeSnapTarget(drag);
    state.angle = snapTarget.angle;
  }

  render();
  pulseLine();
}

function toggleSlopeFormat() {
  if (state.editing) {
    return;
  }

  state.slopeFormat = state.slopeFormat === "decimal" ? "fraction" : "decimal";
  renderReadout();
}

function queueSlopeToggle() {
  clearSlopeClickTimer();
  slopeClickTimer = window.setTimeout(() => {
    slopeClickTimer = null;
    toggleSlopeFormat();
  }, 280);
}

function clearSlopeClickTimer() {
  if (!slopeClickTimer) {
    return;
  }

  window.clearTimeout(slopeClickTimer);
  slopeClickTimer = null;
}

function renderSnapGuide(active) {
  dom.graph.classList.toggle("is-snapping", active);
  const guide = document.getElementById("snapGuide");
  if (!guide || !state.drag) {
    return;
  }

  if (!active) {
    clearSnapGuide();
    return;
  }

  if (state.drag.mode === "intercept") {
    const y = worldToScreenY(Math.round(state.intercept));
    setSvgAttributes(guide, {
      x1: plot.x,
      y1: y,
      x2: plot.x + plot.width,
      y2: y,
    });
    setSnapPoint({ x: 0, y: Math.round(state.intercept) });
    return;
  }

  if (state.drag.mode === "slope-handle") {
    const snapTarget = getSlopeHandleSnapTarget(state.drag);
    setSnapPoint(snapTarget.point);
    const segment = getLineSegment(snapTarget.angle, state.intercept);
    setLine(guide, segment);
    return;
  }

  const snapTarget = getSlopeSnapTarget(state.drag);
  setSnapPoint(snapTarget.point);
  const segment = getLineSegment(snapTarget.angle, state.intercept);
  setLine(guide, segment);
}

function clearSnapGuide() {
  const guide = document.getElementById("snapGuide");
  if (!guide) {
    return;
  }

  setSvgAttributes(guide, { x1: 0, y1: 0, x2: 0, y2: 0 });
  setSvgAttributes(dom.snapPoint, { cx: 0, cy: 0 });
  dom.snapPoint.classList.remove("is-visible");
}

function pulseLine() {
  dom.graph.classList.remove("is-snapped");
  void dom.graph.offsetWidth;
  dom.graph.classList.add("is-snapped");

  window.setTimeout(() => {
    dom.graph.classList.remove("is-snapped");
  }, 420);
}

function resetLine() {
  clearSlopeClickTimer();
  state.angle = Math.atan(0.5);
  state.intercept = 1;
  state.selectedPoint = null;
  state.editing = null;
  render();
}

function getLineSegment(angle, intercept) {
  const points = [];
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);

  if (Math.abs(dx) > 0.0001) {
    const minXT = plot.minX / dx;
    const maxXT = plot.maxX / dx;
    addCandidate(points, plot.minX, intercept + minXT * dy);
    addCandidate(points, plot.maxX, intercept + maxXT * dy);
  }

  if (Math.abs(dy) > 0.0001) {
    const minYT = (plot.minY - intercept) / dy;
    const maxYT = (plot.maxY - intercept) / dy;
    addCandidate(points, minYT * dx, plot.minY);
    addCandidate(points, maxYT * dx, plot.maxY);
  }

  if (points.length < 2) {
    return [
      { x: 0, y: plot.minY },
      { x: 0, y: plot.maxY },
    ];
  }

  return getFarthestPointPair(points);
}

function addCandidate(points, x, y) {
  const epsilon = 0.001;
  const inside =
    x >= plot.minX - epsilon &&
    x <= plot.maxX + epsilon &&
    y >= plot.minY - epsilon &&
    y <= plot.maxY + epsilon;

  if (!inside) {
    return;
  }

  const duplicate = points.some((point) => {
    return Math.abs(point.x - x) < epsilon && Math.abs(point.y - y) < epsilon;
  });

  if (!duplicate) {
    points.push({ x, y });
  }
}

function setLine(line, segment) {
  setSvgAttributes(line, {
    x1: worldToScreenX(segment[0].x),
    y1: worldToScreenY(segment[0].y),
    x2: worldToScreenX(segment[1].x),
    y2: worldToScreenY(segment[1].y),
  });
}

function getFarthestPointPair(points) {
  let pair = [points[0], points[1]];
  let bestDistance = -Infinity;

  for (let firstIndex = 0; firstIndex < points.length; firstIndex += 1) {
    for (let secondIndex = firstIndex + 1; secondIndex < points.length; secondIndex += 1) {
      const first = points[firstIndex];
      const second = points[secondIndex];
      const distance = Math.hypot(first.x - second.x, first.y - second.y);
      if (distance > bestDistance) {
        bestDistance = distance;
        pair = [first, second];
      }
    }
  }

  return pair;
}

function getPointerAngle(pointer, pivot, fallbackAngle) {
  const dx = pointer.x - pivot.x;
  const dy = pointer.y - pivot.y;

  if (Math.hypot(dx, dy) < 0.08) {
    return fallbackAngle;
  }

  return Math.atan2(dy, dx);
}

function getSlopeSnapTarget(drag = null) {
  const pivot = drag?.pivot ?? { x: 0, y: state.intercept };
  const pointer = drag?.lastPointer ?? getPointAlongAngle(state.angle, pivot);
  let best = null;

  for (let x = plot.minX; x <= plot.maxX; x += 1) {
    for (let y = plot.minY; y <= plot.maxY; y += 1) {
      const point = { x, y };
      const distanceFromPivot = Math.hypot(point.x - pivot.x, point.y - pivot.y);

      if (distanceFromPivot < 0.45) {
        continue;
      }

      const distanceFromPointer = Math.hypot(point.x - pointer.x, point.y - pointer.y);
      if (!best || distanceFromPointer < best.distanceFromPointer) {
        best = {
          point,
          angle: Math.atan2(point.y - pivot.y, point.x - pivot.x),
          distanceFromPointer,
        };
      }
    }
  }

  if (best) {
    return best;
  }

  return {
    point: { x: 1, y: Math.round(pivot.y + getSlopeFromAngle(state.angle)) },
    angle: state.angle,
  };
}

function getSlopeHandleSnapTarget(drag = null) {
  const pivot = drag?.pivot ?? { x: 0, y: state.intercept };
  const pointer = drag?.lastPointer ?? getPointAlongAngle(state.angle, pivot);
  const y = clamp(Math.round(pointer.y), plot.minY, plot.maxY);
  const point = { x: SLOPE_RUN_UNITS, y };

  return {
    point,
    angle: Math.atan2(point.y - pivot.y, SLOPE_RUN_UNITS),
  };
}

function getPointAlongAngle(angle, pivot) {
  return {
    x: pivot.x + Math.cos(angle) * 4,
    y: pivot.y + Math.sin(angle) * 4,
  };
}

function setSnapPoint(point) {
  if (!point || !isVisibleWorldPoint(point.x, point.y)) {
    dom.snapPoint.classList.remove("is-visible");
    return;
  }

  setSvgAttributes(dom.snapPoint, {
    cx: worldToScreenX(point.x),
    cy: worldToScreenY(point.y),
  });
  dom.snapPoint.classList.add("is-visible");
}

function normalizeAngleDelta(delta) {
  let normalized = delta;

  while (normalized > Math.PI) {
    normalized -= Math.PI * 2;
  }
  while (normalized < -Math.PI) {
    normalized += Math.PI * 2;
  }

  return normalized;
}

function isVerticalAngle(angle) {
  return Math.abs(Math.cos(angle)) < VERTICAL_EPSILON;
}

function getSlope() {
  return getSlopeFromAngle(state.angle);
}

function getSlopeFromAngle(angle) {
  return cleanValue(Math.tan(angle));
}

function eventToWorld(event) {
  const point = dom.graph.createSVGPoint();
  point.x = event.clientX;
  point.y = event.clientY;
  const matrix = dom.graph.getScreenCTM();
  const svgPoint = matrix ? point.matrixTransform(matrix.inverse()) : point;

  return {
    x: screenToWorldX(svgPoint.x),
    y: screenToWorldY(svgPoint.y),
  };
}

function worldToScreenX(x) {
  return plot.x + ((x - plot.minX) / (plot.maxX - plot.minX)) * plot.width;
}

function worldToScreenY(y) {
  return plot.y + ((plot.maxY - y) / (plot.maxY - plot.minY)) * plot.height;
}

function screenToWorldX(x) {
  return plot.minX + ((x - plot.x) / plot.width) * (plot.maxX - plot.minX);
}

function screenToWorldY(y) {
  return plot.maxY - ((y - plot.y) / plot.height) * (plot.maxY - plot.minY);
}

function isVisibleWorldPoint(x, y) {
  return x >= plot.minX && x <= plot.maxX && y >= plot.minY && y <= plot.maxY;
}

function makeSvg(tagName, attributes = {}, text = "") {
  const node = document.createElementNS("http://www.w3.org/2000/svg", tagName);
  setSvgAttributes(node, attributes);
  if (text) {
    node.textContent = text;
  }
  return node;
}

function setSvgAttributes(node, attributes) {
  Object.entries(attributes).forEach(([key, value]) => {
    node.setAttribute(key, value);
  });
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function formatValue(value) {
  const rounded = cleanValue(value);
  if (Number.isInteger(rounded)) {
    return String(rounded);
  }
  return String(rounded);
}

function formatSlopeValue(value) {
  return state.slopeFormat === "fraction" ? formatFraction(value) : formatValue(value);
}

function formatFraction(value) {
  const rounded = cleanValue(value);
  const sign = rounded < 0 ? "-" : "";
  const absolute = Math.abs(rounded);

  if (Number.isInteger(absolute)) {
    return `${sign}${absolute}`;
  }

  let bestNumerator = 0;
  let bestDenominator = 1;
  let bestError = Infinity;

  for (let denominator = 1; denominator <= MAX_FRACTION_DENOMINATOR; denominator += 1) {
    const numerator = Math.round(absolute * denominator);
    const estimate = numerator / denominator;
    const error = Math.abs(absolute - estimate);

    if (error < bestError) {
      bestNumerator = numerator;
      bestDenominator = denominator;
      bestError = error;
    }
  }

  const divisor = greatestCommonDivisor(bestNumerator, bestDenominator);
  return `${sign}${bestNumerator / divisor}/${bestDenominator / divisor}`;
}

function greatestCommonDivisor(first, second) {
  let a = Math.abs(first);
  let b = Math.abs(second);

  while (b !== 0) {
    [a, b] = [b, a % b];
  }

  return a || 1;
}

function cleanValue(value) {
  const rounded = Math.round(value * 100) / 100;

  if (Object.is(rounded, -0)) {
    return 0;
  }

  return rounded;
}

dom.lineHit.addEventListener("pointerdown", onPointerDown);
dom.gridHit.addEventListener("click", onGridClick);
dom.graph.addEventListener("contextmenu", (event) => event.preventDefault());
dom.equationText.addEventListener("click", (event) => {
  if (event.target.closest(".equation-edit-input")) {
    return;
  }

  if (event.target.closest("[data-slope-toggle]")) {
    if (event.detail > 1) {
      clearSlopeClickTimer();
      return;
    }

    queueSlopeToggle();
  }
});
dom.equationText.addEventListener("dblclick", (event) => {
  const editable = event.target.closest("[data-edit-target]");
  if (!editable || editable.classList.contains("equation-edit-input")) {
    return;
  }

  event.preventDefault();
  startEquationEdit(editable.dataset.editTarget);
});
dom.equationText.addEventListener("keydown", (event) => {
  if (state.editing) {
    return;
  }

  if (!event.target.closest("[data-slope-toggle]")) {
    return;
  }
  if (event.key !== "Enter" && event.key !== " ") {
    return;
  }
  event.preventDefault();
  toggleSlopeFormat();
});
dom.resetButton.addEventListener("click", resetLine);
dom.snapButton.addEventListener("click", () => snapLine("both"));

renderStaticGraph();
render();
