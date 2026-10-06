const dom = {
  stage: document.getElementById("stage"),
  leftSide: document.getElementById("leftSide"),
  rightSide: document.getElementById("rightSide"),
  equalsZone: document.getElementById("equalsZone"),
  ghostLayer: document.getElementById("ghostLayer"),
  goalLine: document.getElementById("goalLine"),
  ruleText: document.getElementById("ruleText"),
  stateText: document.getElementById("stateText"),
  levelButtons: [...document.querySelectorAll("[data-level]")],
  undoButton: document.getElementById("undoButton"),
  resetButton: document.getElementById("resetButton"),
  combineButton: document.getElementById("combineButton"),
  simplifyButton: document.getElementById("simplifyButton"),
  revealButton: document.getElementById("revealButton"),
  hintButton: document.getElementById("hintButton"),
};

let nextId = 1;
let dragState = null;
let animationLock = false;
let pulseTimer = null;

const DISTRIBUTION_TIMING = {
  travel: 980,
  stagger: 320,
  hold: 900,
  fade: 420,
};

const state = {
  level: "isolate",
  left: [],
  right: [],
  history: [],
  lastRule: "Ready.",
  selectedId: null,
  landedId: null,
  combinedId: null,
  pendingLandingId: null,
  distributingId: null,
};

const levels = {
  isolate: {
    goal: "Solve for x",
    make() {
      return {
        left: [linearTerm(2), constantTerm(1)],
        right: [linearTerm(3), constantTerm(8)],
      };
    },
    hint() {
      if (hasLinearValue("right", 3)) {
        return "Start by moving 3x across the equals sign. It lands as -3x.";
      }
      if (hasLikeTerms("left")) {
        return "Combine the x terms on the left.";
      }
      if (hasConstantValue("left", 1)) {
        return "Move +1 to the right. It lands as -1.";
      }
      if (hasLinearValue("left", -1)) {
        return "Reveal -x as -1 * x, then move the -1 factor across as division.";
      }
      return "Simplify any pending division.";
    },
  },
  combine: {
    goal: "Drag like terms together",
    make() {
      return {
        left: [linearTerm(2), linearTerm(3)],
        right: [constantTerm(10)],
      };
    },
    hint() {
      if (hasLikeTerms("left")) {
        return "Drag 2x onto +3x. The coefficients add, so the result is 5x.";
      }
      if (hasLinearValue("left", 5)) {
        return "Pull the 5 away from x to reveal 5 * x, then move 5 across as division.";
      }
      return "Simplify the visible division.";
    },
  },
  coefficient: {
    goal: "Expose the hidden product, then isolate x",
    make() {
      return {
        left: [linearTerm(4), constantTerm(-5)],
        right: [constantTerm(11)],
      };
    },
    hint() {
      if (hasConstantValue("left", -5)) {
        return "Move -5 across the equals sign. It lands as +5.";
      }
      if (hasLinearValue("left", 4)) {
        return "Pull the 4 away from x to reveal 4 * x, then move 4 across as division.";
      }
      return "Simplify the division on the right.";
    },
  },
  parentheses: {
    goal: "Throw the outside number into the parentheses",
    make() {
      return {
        left: [groupTerm(3, [linearTerm(1), constantTerm(2)])],
        right: [constantTerm(15)],
      };
    },
    hint() {
      if (state.left.some((term) => term.kind === "group" && !term.explicitMul)) {
        return "Pull the 3 left to reveal 3 * (x + 2), or throw it into the parentheses to distribute.";
      }
      if (state.left.some((term) => term.kind === "group")) {
        return "Throw the 3 into the parentheses. It will copy onto x and +2, then resolve.";
      }
      if (hasConstantValue("left", 6)) {
        return "Move +6 across the equals sign, then divide by 3.";
      }
      return "Keep x alone on one side.";
    },
  },
  signedParentheses: {
    goal: "Distribute while keeping signs attached",
    make() {
      return {
        left: [groupTerm(-2, [linearTerm(1), constantTerm(-3)])],
        right: [constantTerm(10)],
      };
    },
    hint() {
      if (state.left.some((term) => term.kind === "group")) {
        return "Throw -2 into the parentheses. The inner -3 keeps its sign, so (-2) * (-3) becomes +6.";
      }
      if (hasConstantValue("left", 6)) {
        return "Move +6 across the equals sign, then divide by -2.";
      }
      return "A negative times a negative becomes positive.";
    },
  },
};

function makeId(prefix = "t") {
  nextId += 1;
  return `${prefix}${nextId}`;
}

function linearTerm(coefficient, options = {}) {
  const sign = coefficient < 0 ? -1 : 1;
  const abs = Math.abs(coefficient);
  return {
    id: makeId("x"),
    kind: "linear",
    sign,
    coeff: abs,
    variable: "x",
    explicitMul: options.explicitMul ?? false,
    explicitCoeff: options.explicitCoeff ?? abs !== 1,
  };
}

function constantTerm(value, options = {}) {
  const sign = value < 0 ? -1 : 1;
  const abs = Math.abs(value);
  return {
    id: makeId("c"),
    kind: "constant",
    sign,
    value: abs,
    displayExpr: options.displayExpr ?? null,
    pendingValue: options.pendingValue ?? null,
    pendingOp: options.pendingOp ?? null,
  };
}

function groupTerm(coefficient, innerTerms, options = {}) {
  const sign = coefficient < 0 ? -1 : 1;
  const abs = Math.abs(coefficient);
  return {
    id: makeId("g"),
    kind: "group",
    sign,
    coeff: abs,
    inner: innerTerms,
    explicitMul: options.explicitMul ?? false,
    parensVisible: options.parensVisible ?? true,
  };
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function loadLevel(levelKey) {
  const level = levels[levelKey];
  const fresh = level.make();
  state.level = levelKey;
  state.left = fresh.left;
  state.right = fresh.right;
  state.history = [];
  state.lastRule = "Ready.";
  state.selectedId = null;
  state.landedId = null;
  state.combinedId = null;
  state.pendingLandingId = null;
  state.distributingId = null;
  render();
}

function snapshot() {
  return {
    left: clone(state.left),
    right: clone(state.right),
    lastRule: state.lastRule,
    selectedId: state.selectedId,
  };
}

function pushHistory() {
  state.history.push(snapshot());
  if (state.history.length > 80) {
    state.history.shift();
  }
}

function restore(snapshotValue) {
  state.left = clone(snapshotValue.left);
  state.right = clone(snapshotValue.right);
  state.lastRule = snapshotValue.lastRule;
  state.selectedId = snapshotValue.selectedId;
  state.landedId = null;
  state.combinedId = null;
  state.pendingLandingId = null;
  state.distributingId = null;
  render();
}

function render() {
  if (dom.goalLine) {
    dom.goalLine.textContent = levels[state.level].goal;
  }
  renderSide("left", dom.leftSide);
  renderSide("right", dom.rightSide);
  dom.ruleText.textContent = state.lastRule;
  dom.stateText.textContent = getStateText();

  dom.levelButtons.forEach((button) => {
    button.classList.toggle("is-active", button.dataset.level === state.level);
  });

  dom.undoButton.disabled = state.history.length === 0;
}

function renderSide(sideName, container) {
  container.innerHTML = "";
  state[sideName].forEach((term, index) => {
    const termButton = document.createElement("button");
    termButton.type = "button";
    termButton.className = "term";
    termButton.dataset.termId = term.id;
    termButton.dataset.side = sideName;
    termButton.dataset.kind = term.kind;
    termButton.setAttribute("aria-label", termLabel(term, index));

    if (term.id === state.selectedId) {
      termButton.classList.add("is-selected");
    }
    if (term.id === state.landedId) {
      termButton.classList.add("is-landing");
    }
    if (term.id === state.combinedId) {
      termButton.classList.add("is-combined");
    }
    if (term.id === state.pendingLandingId) {
      termButton.classList.add("is-pending-landing");
    }
    if (term.id === state.distributingId) {
      termButton.classList.add("is-distributing");
    }

    appendTermContent(termButton, term, index);
    termButton.addEventListener("pointerdown", onTermPointerDown);
    container.append(termButton);
  });
}

function appendTermContent(root, term, index) {
  const sign = document.createElement("span");
  sign.className = "sign";
  sign.textContent = getSignText(term, index);
  root.append(sign);

  const body = document.createElement("span");
  body.className = "math-body";

  if (term.kind === "constant") {
    const expression = document.createElement("span");
    expression.className = term.displayExpr ? "expression" : "";
    if (term.pendingOp?.op === "divide") {
      appendPendingDivision(expression, term.pendingOp);
    } else {
      expression.textContent = term.displayExpr ?? formatNumber(term.value);
    }
    body.append(expression);
  }

  if (term.kind === "linear") {
    appendLinearBody(body, term);
  }

  if (term.kind === "group") {
    appendGroupBody(body, term);
  }

  root.append(body);
}

function appendPendingDivision(root, pendingOp) {
  root.classList.add("pending-expression");

  const left = document.createElement("span");
  left.className = "pending-part";
  left.dataset.pendingPart = "left";
  left.textContent = formatNumber(pendingOp.left);
  root.append(left);

  const operator = document.createElement("span");
  operator.className = "pending-op";
  operator.textContent = "/";
  root.append(operator);

  const right = document.createElement("span");
  right.className = "pending-part";
  right.dataset.pendingPart = "right";
  right.textContent = formatNumber(pendingOp.right);
  root.append(right);
}

function appendLinearBody(body, term) {
  const shouldShowCoeff = term.explicitCoeff || term.coeff !== 1;

  if (shouldShowCoeff) {
    const coefficient = document.createElement("span");
    coefficient.className = "factor";
    coefficient.dataset.factor = "coefficient";
    coefficient.textContent = formatNumber(term.coeff);
    body.append(coefficient);

    const operator = document.createElement("span");
    operator.className = term.explicitMul ? "operator" : "operator is-hidden";
    operator.textContent = "*";
    body.append(operator);
  }

  const variable = document.createElement("span");
  variable.className = "variable";
  variable.textContent = term.variable;
  body.append(variable);
}

function appendGroupBody(body, term) {
  const shouldShowCoeff = term.coeff !== 1 || term.explicitMul;

  if (shouldShowCoeff) {
    const coefficient = document.createElement("span");
    coefficient.className = "factor";
    coefficient.dataset.factor = "coefficient";
    coefficient.textContent = formatNumber(term.coeff);
    body.append(coefficient);

    const operator = document.createElement("span");
    operator.className = term.explicitMul ? "operator" : "operator is-hidden";
    operator.textContent = "*";
    body.append(operator);
  }

  if (term.parensVisible) {
    const open = document.createElement("span");
    open.className = "paren";
    open.textContent = "(";
    body.append(open);
  }

  const inner = document.createElement("span");
  inner.className = "group-inner";
  inner.textContent = term.inner.map((part, index) => termLabel(part, index)).join(" ");
  body.append(inner);

  if (term.parensVisible) {
    const close = document.createElement("span");
    close.className = "paren";
    close.textContent = ")";
    body.append(close);
  }
}

function getSignText(term, index, force = false) {
  if (term.kind === "constant" && term.displayExpr) {
    return "";
  }
  if (term.sign < 0) {
    return "-";
  }
  if (force || index > 0) {
    return "+";
  }
  return "";
}

function termLabel(term, index = 0, forceSign = false) {
  const sign = getSignText(term, index, forceSign);
  const prefix = sign ? `${sign}` : "";

  if (term.kind === "constant") {
    return `${prefix}${term.displayExpr ?? formatNumber(term.value)}`;
  }

  if (term.kind === "linear") {
    const shouldShowCoeff = term.explicitCoeff || term.coeff !== 1;
    if (!shouldShowCoeff) {
      return `${prefix}${term.variable}`;
    }
    const operator = term.explicitMul ? " * " : "";
    return `${prefix}${formatNumber(term.coeff)}${operator}${term.variable}`;
  }

  if (term.kind === "group") {
    const inner = term.inner.map((part, innerIndex) => termLabel(part, innerIndex)).join(" ");
    const grouped = term.parensVisible ? `(${inner})` : inner;
    if (term.coeff === 1 && !term.explicitMul) {
      return `${prefix}${grouped}`;
    }
    const operator = term.explicitMul ? " * " : "";
    return `${prefix}${formatNumber(term.coeff)}${operator}${grouped}`;
  }

  return "";
}

function equationLabel() {
  return `${sideLabel("left")} = ${sideLabel("right")}`;
}

function sideLabel(sideName) {
  return state[sideName].map((term, index) => termLabel(term, index)).join(" ") || "0";
}

function formatNumber(value) {
  if (Number.isInteger(value)) {
    return String(value);
  }
  const rounded = Math.round(value * 1000) / 1000;
  return String(rounded);
}

function signedValue(term) {
  if (term.kind === "linear") {
    return term.sign * term.coeff;
  }
  if (term.kind === "constant") {
    return term.pendingValue ?? term.sign * term.value;
  }
  if (term.kind === "group") {
    return term.sign * term.coeff;
  }
  return 0;
}

function findTerm(id) {
  for (const side of ["left", "right"]) {
    const index = state[side].findIndex((term) => term.id === id);
    if (index !== -1) {
      return { side, index, term: state[side][index] };
    }
  }
  return null;
}

function onTermPointerDown(event) {
  if (animationLock) {
    return;
  }

  if (event.button !== 0) {
    return;
  }

  const termEl = event.currentTarget;
  const termId = termEl.dataset.termId;
  const side = termEl.dataset.side;
  const pendingPartEl = event.target.closest("[data-pending-part]");
  const factorEl = event.target.closest("[data-factor]");
  const mode = pendingPartEl ? "pending-part" : factorEl ? "factor" : "term";

  try {
    termEl.setPointerCapture(event.pointerId);
  } catch {
    // Window-level listeners below keep the drag alive if capture is unavailable.
  }
  dragState = {
    mode,
    termId,
    side,
    pointerId: event.pointerId,
    termEl,
    factorEl,
    pendingPartEl,
    pendingPart: pendingPartEl?.dataset.pendingPart ?? null,
    pendingPartTarget: null,
    startX: event.clientX,
    startY: event.clientY,
    lastX: event.clientX,
    lastY: event.clientY,
    moved: false,
    revealPreview: false,
    collapsePreview: false,
    dropSide: null,
    combineTargetId: null,
    reorderTarget: null,
    distributeTargetId: null,
  };

  state.selectedId = termId;
  renderSelectionOnly(termId);

  window.addEventListener("pointermove", onPointerMove);
  window.addEventListener("pointerup", onPointerUp);
  window.addEventListener("pointercancel", onPointerCancel);
}

function onPointerMove(event) {
  if (!dragState || event.pointerId !== dragState.pointerId) {
    return;
  }

  const dx = event.clientX - dragState.startX;
  const dy = event.clientY - dragState.startY;
  const distance = Math.hypot(dx, dy);
  dragState.lastX = event.clientX;
  dragState.lastY = event.clientY;

  if (distance > 4) {
    dragState.moved = true;
    dom.stage.classList.add("is-dragging");
  }

  const dropSide =
    dragState.mode === "pending-part" ? null : getCrossSide(event.clientX, event.clientY, dragState.side);
  dragState.dropSide = dropSide;

  if (dragState.mode === "pending-part") {
    updatePendingPartPreview(event.clientX, event.clientY, dx, dy);
  }

  if (dragState.mode === "term") {
    dragState.termEl.classList.add("is-dragging");
    dragState.termEl.style.transform = `translate(${dx}px, ${dy}px) rotate(${Math.max(
      -4,
      Math.min(4, dx / 45),
    )}deg)`;

    const found = findTerm(dragState.termId);
    const sameSideTarget =
      found && !dropSide ? getSameSideDropTarget(event.clientX, event.clientY, found.side, found.term) : null;
    setSameSideTarget(sameSideTarget);
  }

  if (dragState.mode === "factor") {
    const found = findTerm(dragState.termId);
    const sameSideTarget =
      found && !dropSide ? getSameSideDropTarget(event.clientX, event.clientY, found.side, found.term) : null;
    const combineTargetId = sameSideTarget?.type === "combine" ? sameSideTarget.termId : null;
    const reorderTarget = sameSideTarget?.type === "reorder" ? sameSideTarget : null;
    const distributeTargetId =
      found && !dropSide && !sameSideTarget
        ? getDistributionTargetId(event.clientX, event.clientY, found.term)
        : null;
    setSameSideTarget(sameSideTarget);
    setDistributeTarget(distributeTargetId);

    if (combineTargetId || reorderTarget) {
      dragState.termEl.classList.add("is-dragging");
      dragState.termEl.style.transform = `translate(${dx}px, ${dy}px) rotate(${Math.max(
        -4,
        Math.min(4, dx / 45),
      )}deg)`;
      dragState.factorEl?.classList.remove("is-factor-dragging");
      if (dragState.factorEl) {
        dragState.factorEl.style.transform = "";
      }
    } else {
      updateFactorPreview(found?.term, dx, dy, dropSide || distributeTargetId);
    }
  }

  dom.leftSide.classList.toggle("is-drop-target", dropSide === "left");
  dom.rightSide.classList.toggle("is-drop-target", dropSide === "right");
}

function onPointerUp(event) {
  if (!dragState || event.pointerId !== dragState.pointerId) {
    return;
  }

  const finished = dragState;
  cleanupPointerListeners();

  const found = findTerm(finished.termId);
  if (!found) {
    resetDragVisuals(finished.termEl);
    return;
  }

  if (!finished.moved) {
    if (finished.mode === "pending-part") {
      state.lastRule = "Drag one visible number onto the other to simplify it.";
      resetDragVisuals(finished.termEl);
      render();
      return;
    }
    revealTerm(found.term);
    resetDragVisuals(finished.termEl);
    return;
  }

  if (finished.mode === "pending-part" && finished.pendingPartTarget) {
    simplifyPendingTermPart(found.side, found.index, finished);
    resetDragVisuals(finished.termEl);
    return;
  }

  if (finished.mode === "term" && finished.dropSide && finished.dropSide !== found.side) {
    moveTermAcross(found.side, found.index, finished.dropSide, finished);
    return;
  }

  if (finished.mode === "term" && finished.combineTargetId) {
    combineDraggedTerms(found.side, found.term.id, finished.combineTargetId);
    resetDragVisuals(finished.termEl);
    return;
  }

  if (finished.mode === "term" && finished.reorderTarget) {
    reorderTerm(found.side, found.term.id, finished.reorderTarget.termId, finished.reorderTarget.placement);
    resetDragVisuals(finished.termEl);
    return;
  }

  if (finished.mode === "factor" && finished.dropSide && finished.dropSide !== found.side) {
    if (canMoveFactorAcross(found.side, found.term)) {
      moveFactorAcross(found.side, found.index, finished.dropSide, finished);
    } else {
      moveTermAcross(found.side, found.index, finished.dropSide, finished);
    }
    return;
  }

  if (finished.mode === "factor" && finished.combineTargetId) {
    combineDraggedTerms(found.side, found.term.id, finished.combineTargetId);
    resetDragVisuals(finished.termEl);
    return;
  }

  if (finished.mode === "factor" && finished.reorderTarget) {
    reorderTerm(found.side, found.term.id, finished.reorderTarget.termId, finished.reorderTarget.placement);
    resetDragVisuals(finished.termEl);
    return;
  }

  if (finished.mode === "factor" && finished.distributeTargetId) {
    distributeGroupFromDrag(found.side, found.index, finished);
    resetDragVisuals(finished.termEl);
    return;
  }

  if (finished.mode === "factor" && finished.revealPreview) {
    setProductVisibility(found.term, true);
    resetDragVisuals(finished.termEl);
    return;
  }

  if (finished.mode === "factor" && finished.collapsePreview) {
    setProductVisibility(found.term, false);
    resetDragVisuals(finished.termEl);
    return;
  }

  resetDragVisuals(finished.termEl);
  state.lastRule = "That move did not change the equation.";
  render();
}

function onPointerCancel() {
  if (!dragState) {
    return;
  }
  const termEl = dragState.termEl;
  cleanupPointerListeners();
  resetDragVisuals(termEl);
  render();
}

function cleanupPointerListeners() {
  if (!dragState) {
    return;
  }
  window.removeEventListener("pointermove", onPointerMove);
  window.removeEventListener("pointerup", onPointerUp);
  window.removeEventListener("pointercancel", onPointerCancel);
  clearCombineTargetVisual();
  clearReorderTargetVisual();
  clearDistributeTargetVisual();
  clearPendingPartTargetVisual();
  dom.stage.classList.remove("is-dragging");
  dom.leftSide.classList.remove("is-drop-target");
  dom.rightSide.classList.remove("is-drop-target");
  dragState = null;
}

function resetDragVisuals(termEl) {
  termEl.classList.remove(
    "is-dragging",
    "is-piece-dragging",
    "is-reveal-preview",
    "is-collapse-preview",
    "is-distribute-preview",
  );
  termEl.style.transform = "";
  termEl.querySelectorAll(".factor").forEach((factor) => {
    factor.classList.remove("is-factor-dragging");
    factor.style.transform = "";
  });
  termEl.querySelectorAll(".pending-part").forEach((part) => {
    part.classList.remove("is-pending-dragging", "is-pending-target");
    part.style.transform = "";
  });
}

function getCrossSide(clientX, clientY, fromSide) {
  const equalsRect = dom.equalsZone.getBoundingClientRect();
  const stacked = window.matchMedia("(max-width: 760px)").matches;

  if (stacked) {
    const centerY = equalsRect.top + equalsRect.height / 2;
    const bufferY = Math.max(18, equalsRect.height * 0.25);

    if (fromSide === "left" && clientY > centerY + bufferY) {
      return "right";
    }
    if (fromSide === "right" && clientY < centerY - bufferY) {
      return "left";
    }
    return null;
  }

  const center = equalsRect.left + equalsRect.width / 2;
  const buffer = Math.max(24, equalsRect.width * 0.22);

  if (fromSide === "left" && clientX > center + buffer) {
    return "right";
  }
  if (fromSide === "right" && clientX < center - buffer) {
    return "left";
  }
  return null;
}

function renderSelectionOnly(termId) {
  document.querySelectorAll(".term").forEach((termEl) => {
    termEl.classList.toggle("is-selected", termEl.dataset.termId === termId);
  });
}

function updateFactorPreview(term, dx, dy, blockedPreview) {
  dragState.revealPreview = false;
  dragState.collapsePreview = false;
  dragState.termEl.classList.remove("is-reveal-preview", "is-collapse-preview");

  if (dragState.factorEl) {
    const followsPointer = Boolean(dragState.dropSide || dragState.distributeTargetId);
    const limitedDx = followsPointer ? dx : Math.max(-56, Math.min(56, dx));
    const limitedDy = followsPointer ? dy : 0;
    dragState.termEl.classList.add("is-piece-dragging");
    dragState.factorEl.classList.add("is-factor-dragging");
    dragState.factorEl.style.transform = `translate(${limitedDx}px, ${limitedDy}px)`;
  }

  if (!term || blockedPreview) {
    return;
  }

  if (canRevealMultiplication(term) && dx < -22) {
    dragState.revealPreview = true;
    dragState.termEl.classList.add("is-reveal-preview");
    return;
  }

  if (canHideMultiplication(term) && dx > 22) {
    dragState.collapsePreview = true;
    dragState.termEl.classList.add("is-collapse-preview");
  }
}

function updatePendingPartPreview(clientX, clientY, dx, dy) {
  if (!dragState.pendingPartEl) {
    return;
  }

  dragState.termEl.classList.add("is-piece-dragging");
  dragState.pendingPartEl.classList.add("is-pending-dragging");
  dragState.pendingPartEl.style.transform = `translate(${dx}px, ${dy}px) rotate(${Math.max(
    -5,
    Math.min(5, dx / 36),
  )}deg)`;
  setPendingPartTarget(getPendingPartTarget(clientX, clientY));
}

function setCombineTarget(termId) {
  if (dragState?.combineTargetId === termId) {
    return;
  }

  clearCombineTargetVisual();

  if (dragState) {
    dragState.combineTargetId = termId;
  }

  if (termId) {
    document.querySelector(`.term[data-term-id="${termId}"]`)?.classList.add("is-combine-target");
  }
}

function setSameSideTarget(target) {
  if (target?.type === "combine") {
    setCombineTarget(target.termId);
    setReorderTarget(null);
    return;
  }

  if (target?.type === "reorder") {
    setCombineTarget(null);
    setReorderTarget(target);
    return;
  }

  setCombineTarget(null);
  setReorderTarget(null);
}

function clearCombineTargetVisual() {
  document.querySelectorAll(".term.is-combine-target").forEach((termEl) => {
    termEl.classList.remove("is-combine-target");
  });
}

function setReorderTarget(target) {
  const current = dragState?.reorderTarget;
  if (
    current &&
    target &&
    current.termId === target.termId &&
    current.placement === target.placement
  ) {
    return;
  }

  clearReorderTargetVisual();

  if (dragState) {
    dragState.reorderTarget = target;
  }

  if (target) {
    const termEl = document.querySelector(`.term[data-term-id="${target.termId}"]`);
    termEl?.classList.add(target.placement === "before" ? "is-reorder-before" : "is-reorder-after");
  }
}

function clearReorderTargetVisual() {
  document.querySelectorAll(".term.is-reorder-before, .term.is-reorder-after").forEach((termEl) => {
    termEl.classList.remove("is-reorder-before", "is-reorder-after");
  });
}

function setDistributeTarget(termId) {
  if (dragState?.distributeTargetId === termId) {
    return;
  }

  clearDistributeTargetVisual();

  if (dragState) {
    dragState.distributeTargetId = termId;
  }

  if (termId) {
    document.querySelector(`.term[data-term-id="${termId}"]`)?.classList.add("is-distribute-preview");
  }
}

function clearDistributeTargetVisual() {
  document.querySelectorAll(".term.is-distribute-preview").forEach((termEl) => {
    termEl.classList.remove("is-distribute-preview");
  });
}

function getPendingPartTarget(clientX, clientY) {
  if (!dragState.pendingPartEl || !dragState.pendingPart) {
    return null;
  }

  const otherPart = dragState.pendingPart === "left" ? "right" : "left";
  const targetEl = dragState.termEl.querySelector(`[data-pending-part="${otherPart}"]`);
  if (!targetEl) {
    return null;
  }

  const targetRect = targetEl.getBoundingClientRect();
  const draggedRect = dragState.pendingPartEl.getBoundingClientRect();
  const pointerHitsTarget = pointInRect(clientX, clientY, targetRect, 16);
  const draggedOverlapsTarget = rectsOverlapEnough(draggedRect, targetRect, 0.38);

  return pointerHitsTarget || draggedOverlapsTarget ? otherPart : null;
}

function setPendingPartTarget(part) {
  if (dragState?.pendingPartTarget === part) {
    return;
  }

  clearPendingPartTargetVisual();

  if (dragState) {
    dragState.pendingPartTarget = part;
  }

  if (part) {
    dragState.termEl
      .querySelector(`[data-pending-part="${part}"]`)
      ?.classList.add("is-pending-target");
  }
}

function clearPendingPartTargetVisual() {
  document.querySelectorAll(".pending-part.is-pending-target").forEach((part) => {
    part.classList.remove("is-pending-target");
  });
}

function getSameSideDropTarget(clientX, clientY, sideName, draggedTerm) {
  if (!draggedTerm) {
    return null;
  }

  const terms = [...document.querySelectorAll(`.term[data-side="${sideName}"]`)];
  const termData = terms
    .filter((termEl) => termEl.dataset.termId !== draggedTerm.id)
    .map((termEl) => {
      const target = findTerm(termEl.dataset.termId);
      return { termEl, target, rect: termEl.getBoundingClientRect() };
    });

  const pointerHit = termData.find(({ target, rect }) => {
    return target && pointInRect(clientX, clientY, rect, 18);
  });
  const draggedRect = dragState?.termEl?.getBoundingClientRect();
  const overlapHit = termData.find(({ target, rect }) => {
    return (
      target &&
      canCombineTerms(draggedTerm, target.term) &&
      rectsOverlapEnough(draggedRect, rect, 0.34)
    );
  });
  const hit = pointerHit ?? overlapHit;

  if (!hit?.target) {
    return getOpenSpaceReorderTarget(clientX, clientY, sideName, termData);
  }

  const placement = getReorderPlacement(clientX, clientY, hit.rect);

  if (placement) {
    return {
      type: "reorder",
      termId: hit.target.term.id,
      placement,
    };
  }

  if (canCombineTerms(draggedTerm, hit.target.term)) {
    return {
      type: "combine",
      termId: hit.target.term.id,
    };
  }

  return {
    type: "reorder",
    termId: hit.target.term.id,
    placement: getFallbackReorderPlacement(clientX, clientY, hit.rect),
  };
}

function getOpenSpaceReorderTarget(clientX, clientY, sideName, termData) {
  const sideEl = sideName === "left" ? dom.leftSide : dom.rightSide;
  const sideRect = sideEl.getBoundingClientRect();
  const candidates = termData.filter(({ target }) => target);

  if (!candidates.length || !pointInRect(clientX, clientY, sideRect, 72)) {
    return null;
  }

  const stacked = window.matchMedia("(max-width: 760px)").matches;
  const nearest = candidates.reduce((best, candidate) => {
    const rect = candidate.rect;
    const center = stacked ? rect.top + rect.height / 2 : rect.left + rect.width / 2;
    const point = stacked ? clientY : clientX;
    const distance = Math.abs(point - center);
    return !best || distance < best.distance ? { ...candidate, distance } : best;
  }, null);

  if (!nearest?.target) {
    return null;
  }

  return {
    type: "reorder",
    termId: nearest.target.term.id,
    placement: getFallbackReorderPlacement(clientX, clientY, nearest.rect),
  };
}

function pointInRect(clientX, clientY, rect, padding = 0) {
  return (
    clientX >= rect.left - padding &&
    clientX <= rect.right + padding &&
    clientY >= rect.top - padding &&
    clientY <= rect.bottom + padding
  );
}

function rectsOverlapEnough(first, second, threshold) {
  if (!first || !second) {
    return false;
  }

  const overlapWidth = Math.max(0, Math.min(first.right, second.right) - Math.max(first.left, second.left));
  const overlapHeight = Math.max(0, Math.min(first.bottom, second.bottom) - Math.max(first.top, second.top));
  const overlapArea = overlapWidth * overlapHeight;
  const smallerArea = Math.min(first.width * first.height, second.width * second.height);

  return smallerArea > 0 && overlapArea / smallerArea >= threshold;
}

function getReorderPlacement(clientX, clientY, rect) {
  if (window.matchMedia("(max-width: 760px)").matches) {
    const edge = Math.min(rect.height * 0.35, 28);
    if (clientY <= rect.top + edge) {
      return "before";
    }
    if (clientY >= rect.bottom - edge) {
      return "after";
    }
    return null;
  }

  const edge = Math.min(rect.width * 0.35, 46);
  if (clientX <= rect.left + edge) {
    return "before";
  }
  if (clientX >= rect.right - edge) {
    return "after";
  }
  return null;
}

function getFallbackReorderPlacement(clientX, clientY, rect) {
  if (window.matchMedia("(max-width: 760px)").matches) {
    return clientY < rect.top + rect.height / 2 ? "before" : "after";
  }

  return clientX < rect.left + rect.width / 2 ? "before" : "after";
}

function getDistributionTargetId(clientX, clientY, term) {
  if (!term || term.kind !== "group" || Math.abs(signedValue(term)) === 1) {
    return null;
  }

  const termEl = document.querySelector(`.term[data-term-id="${term.id}"]`);
  const innerEl = termEl?.querySelector(".group-inner");
  const innerRect = innerEl?.getBoundingClientRect();
  const termRect = termEl?.getBoundingClientRect();

  if (!innerRect || !termRect) {
    return null;
  }

  const hotZone = {
    left: innerRect.left - 20,
    right: termRect.right + 18,
    top: termRect.top - 18,
    bottom: termRect.bottom + 18,
  };

  const inside =
    clientX >= hotZone.left &&
    clientX <= hotZone.right &&
    clientY >= hotZone.top &&
    clientY <= hotZone.bottom;

  return inside ? term.id : null;
}

function moveTermAcross(fromSide, index, toSide, drag) {
  const original = state[fromSide][index];
  const oldLabel = termLabel(original, 0, true);
  const nextTerm = clone(original);
  nextTerm.sign *= -1;
  const newLabel = termLabel(nextTerm, 0, true);
  const rule = `${oldLabel} crossed the equals sign, so its sign flipped to ${newLabel}.`;

  pushHistory();
  state.lastRule = rule;
  beginMotion();
  const sourceRect = drag.termEl.getBoundingClientRect();

  state[fromSide].splice(index, 1);
  state[toSide].push(nextTerm);
  normalizeSide(fromSide);
  normalizeSide(toSide);
  state.pendingLandingId = nextTerm.id;
  state.landedId = null;
  state.combinedId = null;
  render();
  announceMotion(rule, "The term is crossing the equals sign.");

  const landingEl = document.querySelector(`.term[data-term-id="${nextTerm.id}"]`);
  const targetRect = landingEl?.getBoundingClientRect();

  playThrowFromRect(sourceRect, oldLabel, newLabel, targetRect, toSide, { wholeTerm: true }).then(() => {
    state.pendingLandingId = null;
    state.landedId = nextTerm.id;
    state.combinedId = null;
    render();
    clearPulseIds();
    endMotion();
  });
}

function combineDraggedTerms(sideName, sourceId, targetId) {
  const source = findTerm(sourceId);
  const target = findTerm(targetId);

  if (!source || !target || source.side !== target.side || source.side !== sideName) {
    state.lastRule = "Drop like terms on the same side to combine them.";
    render();
    return;
  }

  if (!canCombineTerms(source.term, target.term)) {
    state.lastRule = "Only like terms can merge.";
    render();
    return;
  }

  const sourceLabel = termLabel(source.term, source.index, true);
  const targetLabel = termLabel(target.term, target.index, true);
  const combinedValue = signedValue(source.term) + signedValue(target.term);
  const combinedTerm =
    source.term.kind === "linear" ? linearTerm(combinedValue) : constantTerm(combinedValue);

  pushHistory();
  state[sideName] = state[sideName].filter((term) => term.id !== sourceId && term.id !== targetId);
  if (combinedValue !== 0 || state[sideName].length === 0) {
    state[sideName].push(combinedTerm);
    state.combinedId = combinedTerm.id;
  } else {
    state.combinedId = null;
  }
  normalizeSide(sideName);

  const resultLabel = combinedValue === 0 ? "0" : termLabel(combinedTerm, 0, true);
  state.lastRule = `${sourceLabel} and ${targetLabel} are like terms, so their coefficients combine into ${resultLabel}.`;
  state.landedId = state.combinedId;
  render();
  clearPulseIds();
}

function simplifyPendingTermPart(sideName, index, drag) {
  const term = state[sideName][index];

  if (!term || term.kind !== "constant" || !term.displayExpr) {
    state.lastRule = "Drop one visible number onto another pending number to simplify.";
    render();
    return;
  }

  const pendingOp = term.pendingOp;
  const result = term.pendingValue ?? signedValue(term);
  const sourceLabel = pendingOp?.[drag.pendingPart] ?? term.displayExpr;
  const targetPart = drag.pendingPart === "left" ? "right" : "left";
  const targetLabel = pendingOp?.[targetPart] ?? term.displayExpr;
  const resultTerm = constantTerm(result);

  pushHistory();
  state[sideName].splice(index, 1, resultTerm);
  normalizeSide(sideName);
  state.lastRule =
    pendingOp?.op === "divide"
      ? `${formatNumber(sourceLabel)} lands on ${formatNumber(targetLabel)}, so ${
          term.displayExpr
        } simplifies to ${termLabel(resultTerm, 0, true)}.`
      : `${term.displayExpr} simplifies to ${termLabel(resultTerm, 0, true)}.`;
  state.landedId = resultTerm.id;
  state.combinedId = resultTerm.id;
  render();
  clearPulseIds();
}

function reorderTerm(sideName, sourceId, targetId, placement) {
  const terms = state[sideName];
  const sourceIndex = terms.findIndex((term) => term.id === sourceId);
  const targetIndex = terms.findIndex((term) => term.id === targetId);

  if (sourceIndex === -1 || targetIndex === -1) {
    state.lastRule = "Drop beside another term to change the order.";
    render();
    return;
  }

  let insertIndex = targetIndex + (placement === "after" ? 1 : 0);
  if (sourceIndex < insertIndex) {
    insertIndex -= 1;
  }

  if (sourceIndex === insertIndex) {
    state.lastRule = "That term is already there.";
    render();
    return;
  }

  const sourceLabel = termLabel(terms[sourceIndex], sourceIndex, true);
  const targetLabel = termLabel(terms[targetIndex], targetIndex, true);

  pushHistory();
  const [moved] = terms.splice(sourceIndex, 1);
  terms.splice(insertIndex, 0, moved);

  state.landedId = moved.id;
  state.combinedId = null;
  state.lastRule = `${sourceLabel} moved ${placement} ${targetLabel}. Its sign moved with it, so the side now reads ${state[
    sideName
  ]
    .map((term, index) => termLabel(term, index))
    .join(" ")}.`;
  render();
  clearPulseIds();
}

function distributeGroupFromDrag(sideName, index, drag) {
  const group = state[sideName][index];

  if (!group || group.kind !== "group") {
    state.lastRule = "Drop the outside factor into its parentheses to distribute.";
    render();
    return;
  }

  const factor = signedValue(group);
  if (Math.abs(factor) === 1) {
    state.lastRule = "There is no outside number to distribute.";
    render();
    return;
  }

  const groupLabel = termLabel(group, index, true);
  const productLabels = group.inner.map((innerTerm) => productLabel(factor, innerTerm));
  const productPreview = productLabels.join(" + ");
  const distributionGeometry = getDistributionGeometry(drag);

  pushHistory();
  state.lastRule = `${groupLabel}: the outside factor copies onto each term inside the parentheses.`;
  state.landedId = group.id;
  state.combinedId = null;
  state.distributingId = group.id;

  beginMotion();
  render();
  announceMotion(state.lastRule, `${productPreview} is forming inside the parentheses.`);
  launchDistributionGhosts(distributionGeometry, productLabels);

  window.setTimeout(() => {
    const found = findTerm(group.id);
    if (!found || found.term.kind !== "group") {
      state.distributingId = null;
      render();
      endMotion();
      return;
    }

    const expanded = found.term.inner.map((innerTerm) => multiplyTerm(innerTerm, factor));
    state[found.side].splice(found.index, 1, ...expanded);
    normalizeSide(found.side);

    const expandedLabel = expanded.map((term, termIndex) => termLabel(term, termIndex)).join(" ");
    state.lastRule = `${productPreview} resolved to ${expandedLabel}. Signs stayed attached to the terms they came from.`;
    state.landedId = expanded[0]?.id ?? null;
    state.combinedId = expanded[0]?.id ?? null;
    state.distributingId = null;
    render();
    clearPulseIds();
    endMotion();
  }, getDistributionResolveDelay(productLabels.length));
}

function moveFactorAcross(fromSide, index, toSide, drag) {
  const term = state[fromSide][index];
  if (!canMoveFactorAcross(fromSide, term)) {
    resetDragVisuals(drag.termEl);
    state.lastRule = "A factor can cross as division only when it multiplies the whole side.";
    render();
    return;
  }

  const factor = signedValue(term);
  if (factor === 0 || factor === 1) {
    resetDragVisuals(drag.termEl);
    state.lastRule = "That factor is already neutral.";
    render();
    return;
  }

  const oldLabel = formatNumber(factor);
  const newLabel = `/ ${formatNumber(factor)}`;
  const rule = `${oldLabel} was a multiplying factor, so it crossed the equals sign as division.`;

  pushHistory();
  state.lastRule = rule;
  beginMotion();
  const sourceRect = (drag.factorEl ?? drag.termEl).getBoundingClientRect();

  if (term.kind === "linear") {
    term.sign = 1;
    term.coeff = 1;
    term.explicitCoeff = false;
    term.explicitMul = false;
  }

  if (term.kind === "group") {
    term.sign = 1;
    term.coeff = 1;
    term.explicitMul = false;
  }

  divideSideByFactor(toSide, factor);
  state.pendingLandingId = state[toSide][state[toSide].length - 1]?.id ?? null;
  state.landedId = null;
  state.combinedId = null;
  render();
  announceMotion(rule, "The factor is crossing as division.");

  const landingEl = state.pendingLandingId
    ? document.querySelector(`.term[data-term-id="${state.pendingLandingId}"]`)
    : null;
  const targetRect = landingEl?.getBoundingClientRect();

  playThrowFromRect(sourceRect, oldLabel, newLabel, targetRect, toSide, { wholeTerm: false }).then(() => {
    state.landedId = state.pendingLandingId;
    state.pendingLandingId = null;
    render();
    clearPulseIds();
    endMotion();
  });
}

function canRevealMultiplication(term) {
  return (term.kind === "linear" || term.kind === "group") && !term.explicitMul;
}

function canHideMultiplication(term) {
  return (term.kind === "linear" || term.kind === "group") && term.explicitMul;
}

function canMoveFactor(term) {
  return term.kind === "linear" || term.kind === "group";
}

function canMoveFactorAcross(sideName, term) {
  return canMoveFactor(term) && state[sideName].length === 1;
}

function canCombineTerms(first, second) {
  if (first.kind === "linear" && second.kind === "linear") {
    return first.variable === second.variable;
  }
  if (first.kind === "constant" && second.kind === "constant") {
    return !first.displayExpr && !second.displayExpr;
  }
  return false;
}

function productLabel(factor, term) {
  return `${productFactorLabel(factor)} * ${productOperandLabel(term)}`;
}

function productFactorLabel(value) {
  return value < 0 ? `(${formatNumber(value)})` : formatNumber(value);
}

function productOperandLabel(term) {
  const value = signedValue(term);

  if (term.kind === "linear") {
    const abs = Math.abs(value);
    const body = abs === 1 ? term.variable : `${formatNumber(abs)}${term.variable}`;
    return value < 0 ? `(-${body})` : body;
  }

  if (term.kind === "constant") {
    return value < 0 ? `(${formatNumber(value)})` : formatNumber(value);
  }

  return termLabel(term, 0);
}

function setProductVisibility(term, visible) {
  if (!term || (term.kind !== "linear" && term.kind !== "group")) {
    return;
  }

  pushHistory();
  term.explicitMul = visible;

  if (term.kind === "linear") {
    term.explicitCoeff = visible || term.coeff !== 1;
  }

  state.lastRule = visible
    ? `${termLabel(term, 0, true)} reveals the hidden product.`
    : `${termLabel(term, 0, true)} closes back into compact notation.`;
  state.landedId = term.id;
  state.combinedId = null;
  render();
  clearPulseIds();
}

function revealTerm(term) {
  if (!term) {
    return;
  }

  if (term.kind === "linear") {
    if (term.coeff === 1 && !term.explicitCoeff) {
      pushHistory();
      term.explicitCoeff = true;
      term.explicitMul = true;
      state.lastRule = `${termLabel(term, 0, true)} reveals the hidden coefficient and product.`;
      state.landedId = term.id;
      state.combinedId = null;
      render();
      clearPulseIds();
      return;
    }

    if (!term.explicitMul) {
      pushHistory();
      term.explicitMul = true;
      term.explicitCoeff = true;
      state.lastRule = `${termLabel(term, 0, true)} reveals implicit multiplication.`;
      state.landedId = term.id;
      state.combinedId = null;
      render();
      clearPulseIds();
      return;
    }
  }

  if (term.kind === "group") {
    if (!term.explicitMul && term.coeff !== 1) {
      pushHistory();
      term.explicitMul = true;
      state.lastRule = `${termLabel(term, 0, true)} reveals the hidden product next to the parentheses.`;
      state.landedId = term.id;
      state.combinedId = null;
      render();
      clearPulseIds();
      return;
    }

    pushHistory();
    expandGroup(term.id);
    return;
  }

  state.lastRule = "Nothing hidden there.";
  render();
}

function expandGroup(groupId) {
  const found = findTerm(groupId);
  if (!found || found.term.kind !== "group") {
    return;
  }

  const group = found.term;
  const factor = signedValue(group);
  const expanded = group.inner.map((innerTerm) => multiplyTerm(innerTerm, factor));
  state[found.side].splice(found.index, 1, ...expanded);
  sortSide(state[found.side]);
  state.lastRule = `${termLabel(group, 0, true)} distributed across the parentheses.`;
  state.landedId = expanded[0]?.id ?? null;
  state.combinedId = expanded[0]?.id ?? null;
  render();
  clearPulseIds();
}

function multiplyTerm(term, factor) {
  if (term.kind === "linear") {
    return linearTerm(signedValue(term) * factor, { explicitMul: false });
  }
  if (term.kind === "constant") {
    return constantTerm(signedValue(term) * factor);
  }
  return clone(term);
}

function divideSideByFactor(sideName, factor) {
  const terms = state[sideName];

  if (terms.length === 1 && terms[0].kind === "constant") {
    const raw = signedValue(terms[0]);
    const result = raw / factor;
    state[sideName] = [
      constantTerm(result, {
        displayExpr: `${formatNumber(raw)} / ${formatNumber(factor)}`,
        pendingValue: result,
        pendingOp: {
          op: "divide",
          left: raw,
          right: factor,
          result,
        },
      }),
    ];
    return;
  }

  state[sideName] = terms.map((term) => divideTerm(term, factor));
  sortSide(state[sideName]);
}

function divideTerm(term, factor) {
  if (term.kind === "constant") {
    return constantTerm(signedValue(term) / factor);
  }
  if (term.kind === "linear") {
    return linearTerm(signedValue(term) / factor, {
      explicitMul: term.explicitMul,
      explicitCoeff: true,
    });
  }
  return clone(term);
}

function combineAll() {
  pushHistory();
  const leftChanged = combineSide("left");
  const rightChanged = combineSide("right");

  if (!leftChanged && !rightChanged) {
    state.history.pop();
    state.lastRule = "There are no like terms to combine yet.";
  } else {
    state.lastRule = "Like terms collapsed into one term on each side.";
  }

  render();
  clearPulseIds();
}

function combineSide(sideName) {
  const terms = state[sideName];
  let linearTotal = 0;
  let constantTotal = 0;
  const linearTerms = [];
  const constantTerms = [];
  const untouched = [];

  for (const term of terms) {
    if (term.kind === "linear" && !term.displayExpr) {
      linearTotal += signedValue(term);
      linearTerms.push(term);
    } else if (term.kind === "constant" && !term.displayExpr) {
      constantTotal += signedValue(term);
      constantTerms.push(term);
    } else {
      untouched.push(term);
    }
  }

  const next = [];
  let changed = false;

  if (linearTerms.length > 0) {
    if (linearTerms.length > 1) {
      changed = true;
      if (linearTotal !== 0) {
        const combined = linearTerm(linearTotal);
        state.combinedId = combined.id;
        next.push(combined);
      }
    } else {
      next.push(linearTerms[0]);
    }

    if (linearTerms.length > 1 && linearTotal === 0) {
      changed = true;
    }
  }

  if (constantTerms.length > 0) {
    if (constantTerms.length > 1) {
      changed = true;
      if (constantTotal !== 0 || (next.length === 0 && untouched.length === 0)) {
        const combined = constantTerm(constantTotal);
        if (!state.combinedId) {
          state.combinedId = combined.id;
        }
        next.push(combined);
      }
    } else if (constantTotal !== 0 || (next.length === 0 && untouched.length === 0)) {
      next.push(constantTerms[0]);
    }

    if (constantTerms.length > 1 && constantTotal === 0) {
      changed = true;
    }
  }

  next.push(...untouched);
  if (next.length === 0) {
    next.push(constantTerm(0));
  }
  sortSide(next);
  state[sideName] = next;
  return changed;
}

function normalizeSide(sideName) {
  if (state[sideName].length === 0) {
    state[sideName].push(constantTerm(0));
    return;
  }

  if (state[sideName].length > 1) {
    state[sideName] = state[sideName].filter((term) => {
      return !(term.kind === "constant" && !term.displayExpr && signedValue(term) === 0);
    });
  }

  sortSide(state[sideName]);
}

function simplifyAll() {
  pushHistory();
  let changed = false;

  for (const side of ["left", "right"]) {
    state[side] = state[side].map((term) => {
      if (term.kind === "constant" && term.displayExpr) {
        changed = true;
        const simplified = constantTerm(term.pendingValue ?? signedValue(term));
        state.combinedId = simplified.id;
        return simplified;
      }
      return term;
    });
    sortSide(state[side]);
  }

  if (!changed) {
    state.history.pop();
    state.lastRule = "Nothing is waiting to simplify.";
  } else {
    state.lastRule = "The visible division simplified to a single value.";
  }

  render();
  clearPulseIds();
}

function revealAll() {
  pushHistory();
  let changed = false;

  for (const side of ["left", "right"]) {
    for (const term of state[side]) {
      if (term.kind === "linear") {
        if (!term.explicitCoeff && term.coeff === 1) {
          term.explicitCoeff = true;
          changed = true;
        }
        if (!term.explicitMul) {
          term.explicitMul = true;
          changed = true;
        }
      }
      if (term.kind === "group" && !term.explicitMul) {
        term.explicitMul = true;
        changed = true;
      }
    }
  }

  if (!changed) {
    state.history.pop();
    state.lastRule = "The hidden products are already visible.";
  } else {
    state.lastRule = "Hidden coefficients and products are visible now.";
  }

  render();
  clearPulseIds();
}

function swapEquationSides() {
  if (animationLock || dragState) {
    return;
  }

  const oldLeft = sideLabel("left");
  const oldRight = sideLabel("right");

  pushHistory();
  [state.left, state.right] = [state.right, state.left];
  state.selectedId = null;
  state.landedId = null;
  state.combinedId = null;
  state.pendingLandingId = null;
  state.lastRule = `${oldLeft} = ${oldRight} flipped to ${oldRight} = ${oldLeft}. Equality works both ways.`;
  render();
  pulseEqualsSwap();
}

function pulseEqualsSwap() {
  dom.equalsZone.classList.remove("is-swapping");
  void dom.equalsZone.offsetWidth;
  dom.equalsZone.classList.add("is-swapping");

  window.setTimeout(() => {
    dom.equalsZone.classList.remove("is-swapping");
  }, 420);
}

function sortSide(terms) {
  terms.sort((a, b) => rankTerm(a) - rankTerm(b));
}

function rankTerm(term) {
  if (term.kind === "linear") {
    return 0;
  }
  if (term.kind === "group") {
    return 1;
  }
  return 2;
}

function clearPulseIds() {
  if (pulseTimer) {
    window.clearTimeout(pulseTimer);
  }

  pulseTimer = window.setTimeout(() => {
    state.landedId = null;
    state.combinedId = null;
    pulseTimer = null;
    render();
  }, 560);
}

function beginMotion() {
  if (pulseTimer) {
    window.clearTimeout(pulseTimer);
    pulseTimer = null;
  }

  animationLock = true;
  dom.stage.classList.add("is-animating");
}

function endMotion() {
  animationLock = false;
  dom.stage.classList.remove("is-animating");
}

function announceMotion(rule, progressText) {
  dom.ruleText.textContent = rule;
  dom.stateText.textContent = progressText;
}

function playThrowFromRect(sourceRect, oldLabel, newLabel, targetRect, toSide, options = {}) {
  const stageRect = dom.stage.getBoundingClientRect();
  const target = targetRect ? getRectTarget(targetRect, sourceRect) : getThrowTarget(toSide, sourceRect);
  const startX = sourceRect.left - stageRect.left;
  const startY = sourceRect.top - stageRect.top;
  const deltaX = target.x - startX;
  const deltaY = target.y - startY;
  const arcLift = Math.min(96, Math.max(42, Math.abs(deltaX) * 0.14 + Math.abs(deltaY) * 0.1));
  const curveX = deltaX * 0.48;
  const curveY = deltaY * 0.48 - arcLift;
  const labelTurn = deltaX >= 0 ? 7 : -7;

  const flyer = document.createElement("div");
  flyer.className = options.wholeTerm ? "ghost-term flight-term" : "ghost-term flight-term factor-flight";
  flyer.style.left = `${startX}px`;
  flyer.style.top = `${startY}px`;
  flyer.style.minWidth = `${Math.max(sourceRect.width, options.wholeTerm ? 58 : 54)}px`;
  flyer.style.height = `${Math.max(sourceRect.height, options.wholeTerm ? 72 : 46)}px`;

  const label = document.createElement("span");
  label.className = "flight-label";
  label.textContent = oldLabel;
  flyer.append(label);

  dom.ghostLayer.append(flyer);

  const animation = flyer.animate(
    [
      { transform: "translate(0, 0) rotate(0deg) scale(1)", offset: 0 },
      {
        transform: `translate(${curveX}px, ${curveY}px) rotate(${labelTurn}deg) scale(1.04)`,
        offset: 0.56,
      },
      { transform: `translate(${deltaX}px, ${deltaY}px) rotate(0deg) scale(1)`, offset: 1 },
    ],
    {
      duration: 720,
      easing: "cubic-bezier(0.18, 0.82, 0.22, 1)",
      fill: "forwards",
    },
  );

  window.setTimeout(() => {
    label.textContent = newLabel;
    label.classList.add("is-flipped");
    flyer.classList.add("is-operator-flipped");
  }, 330);

  return animation.finished
    .catch(() => undefined)
    .then(() => {
      flyer.remove();
    });
}

function getRectTarget(rect, sourceRect) {
  const stageRect = dom.stage.getBoundingClientRect();

  return {
    x: rect.left - stageRect.left + rect.width / 2 - sourceRect.width / 2,
    y: rect.top - stageRect.top + rect.height / 2 - sourceRect.height / 2,
  };
}

function getThrowTarget(toSide, sourceRect) {
  const stageRect = dom.stage.getBoundingClientRect();
  const targetRect = (toSide === "left" ? dom.leftSide : dom.rightSide).getBoundingClientRect();
  const stacked = window.matchMedia("(max-width: 760px)").matches;
  const targetX = stacked
    ? targetRect.left - stageRect.left + targetRect.width / 2 - sourceRect.width / 2
    : toSide === "left"
      ? targetRect.right - stageRect.left - Math.min(170, targetRect.width * 0.38)
      : targetRect.left - stageRect.left + Math.min(92, targetRect.width * 0.22);
  const targetY = targetRect.top - stageRect.top + targetRect.height / 2 - sourceRect.height / 2;

  return {
    x: targetX,
    y: targetY,
  };
}

function getDistributionResolveDelay(count) {
  return (
    DISTRIBUTION_TIMING.travel +
    Math.max(0, count - 1) * DISTRIBUTION_TIMING.stagger +
    DISTRIBUTION_TIMING.hold
  );
}

function getDistributionCleanupDelay(count) {
  return getDistributionResolveDelay(count) + DISTRIBUTION_TIMING.fade + 140;
}

function getDistributionGeometry(drag) {
  const termRect = drag.termEl.getBoundingClientRect();

  return {
    stageRect: dom.stage.getBoundingClientRect(),
    termRect,
    innerRect: drag.termEl.querySelector(".group-inner")?.getBoundingClientRect() ?? termRect,
    factorRect: drag.factorEl?.getBoundingClientRect() ?? termRect,
  };
}

function launchDistributionGhosts(geometry, productLabels) {
  const { stageRect, termRect, innerRect, factorRect } = geometry;
  const startX = factorRect.left - stageRect.left + factorRect.width / 2 - 34;
  const startY = factorRect.top - stageRect.top + factorRect.height / 2 - 22;
  const resolveDelay = getDistributionResolveDelay(productLabels.length);
  const cleanupDelay = getDistributionCleanupDelay(productLabels.length);

  productLabels.forEach((label, index) => {
    const ghost = document.createElement("div");
    ghost.className = "ghost-term distribution-ghost";
    ghost.textContent = label;
    ghost.style.left = `${startX}px`;
    ghost.style.top = `${startY}px`;
    ghost.style.opacity = "0";
    ghost.style.transform = "translate(0, 0) scale(0.82)";
    ghost.style.setProperty("--distribution-travel", `${DISTRIBUTION_TIMING.travel}ms`);
    dom.ghostLayer.append(ghost);

    const slot = (index + 0.5) / productLabels.length;
    const targetX = innerRect.left - stageRect.left + innerRect.width * slot - 52;
    const targetY = termRect.top - stageRect.top + termRect.height / 2 - 23;
    const deltaX = targetX - startX;
    const deltaY = targetY - startY;
    const startDelay = index * DISTRIBUTION_TIMING.stagger;
    const landDelay = startDelay + DISTRIBUTION_TIMING.travel;

    window.setTimeout(() => {
      ghost.classList.add("is-flying");
      ghost.style.opacity = "1";
      ghost.style.transform = `translate(${deltaX}px, ${deltaY}px) scale(1)`;
    }, startDelay + 40);

    window.setTimeout(() => {
      ghost.classList.add("is-landed");
    }, landDelay);

    window.setTimeout(() => {
      ghost.style.opacity = "0";
      ghost.style.transform = `translate(${deltaX}px, ${deltaY}px) scale(0.78)`;
      ghost.classList.add("is-resolving");
    }, resolveDelay);

    window.setTimeout(() => {
      ghost.remove();
    }, cleanupDelay);
  });
}

function getStateText() {
  const solved = getSolvedText();
  if (solved) {
    return solved;
  }
  return equationLabel();
}

function getSolvedText() {
  const leftLinear = singleLinear("left");
  const rightLinear = singleLinear("right");
  const leftConstant = singleConstant("left");
  const rightConstant = singleConstant("right");

  if (leftLinear && rightConstant && signedValue(leftLinear) === 1 && !rightConstant.displayExpr) {
    return `Solved: x = ${formatNumber(signedValue(rightConstant))}`;
  }

  if (rightLinear && leftConstant && signedValue(rightLinear) === 1 && !leftConstant.displayExpr) {
    return `Solved: x = ${formatNumber(signedValue(leftConstant))}`;
  }

  return "";
}

function singleLinear(sideName) {
  const terms = state[sideName];
  return terms.length === 1 && terms[0].kind === "linear" ? terms[0] : null;
}

function singleConstant(sideName) {
  const terms = state[sideName];
  return terms.length === 1 && terms[0].kind === "constant" ? terms[0] : null;
}

function hasLikeTerms(sideName) {
  return state[sideName].filter((term) => term.kind === "linear").length > 1;
}

function hasLinearValue(sideName, value) {
  return state[sideName].some((term) => term.kind === "linear" && signedValue(term) === value);
}

function hasConstantValue(sideName, value) {
  return state[sideName].some((term) => term.kind === "constant" && signedValue(term) === value);
}

dom.levelButtons.forEach((button) => {
  button.addEventListener("click", () => {
    if (animationLock) {
      return;
    }
    loadLevel(button.dataset.level);
  });
});

dom.undoButton.addEventListener("click", () => {
  if (animationLock) {
    return;
  }
  const previous = state.history.pop();
  if (previous) {
    restore(previous);
  }
});

dom.resetButton.addEventListener("click", () => {
  if (!animationLock) {
    loadLevel(state.level);
  }
});
dom.combineButton.addEventListener("click", () => {
  if (!animationLock) {
    combineAll();
  }
});
dom.simplifyButton.addEventListener("click", () => {
  if (!animationLock) {
    simplifyAll();
  }
});
dom.revealButton.addEventListener("click", () => {
  if (!animationLock) {
    revealAll();
  }
});
dom.hintButton.addEventListener("click", () => {
  if (animationLock) {
    return;
  }
  state.lastRule = levels[state.level].hint();
  render();
});
dom.equalsZone.addEventListener("dblclick", (event) => {
  event.preventDefault();
  swapEquationSides();
});
dom.equalsZone.addEventListener("keydown", (event) => {
  if (event.key !== "Enter" && event.key !== " ") {
    return;
  }
  event.preventDefault();
  swapEquationSides();
});

loadLevel("isolate");
