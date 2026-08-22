const BASES = {
  hex: { radix: 16n, digits: "0123456789ABCDEF", pattern: /^[0-9a-f]*$/i },
  dec: { radix: 10n, digits: "0123456789", pattern: /^-?[0-9]*$/ },
  oct: { radix: 8n, digits: "01234567", pattern: /^[0-7]*$/ },
  bin: { radix: 2n, digits: "01", pattern: /^[01]*$/ },
};

const state = {
  inputBase: "hex",
  wordSize: 32,
  signed: false,
  currentValue: 0n,
  storedValue: null,
  pendingOperator: null,
  awaitingNextInput: false,
  inputBuffer: "0",
  message: "",
  messageIsError: false,
};

const baseSelector = document.getElementById("base-selector");
const wordSizeSelect = document.getElementById("word-size");
const signedCheckbox = document.getElementById("signed-mode");
const statusLine = document.getElementById("status-line");
const installButton = document.getElementById("install-button");
const valueInput = document.getElementById("value-display");
const keypad = document.querySelector(".keypad-grid");
const digitButtons = Array.from(document.querySelectorAll("[data-digit]"));

let deferredInstallPrompt = null;

function maskForWordSize() {
  return (1n << BigInt(state.wordSize)) - 1n;
}

function normalize(value) {
  return value & maskForWordSize();
}

function arithmeticValue(value) {
  const normalized = normalize(value);
  return state.signed ? BigInt.asIntN(state.wordSize, normalized) : normalized;
}

function parseBaseValue(text, baseKey) {
  if (text === "" || text === "-") {
    return 0n;
  }

  if (baseKey === "dec") {
    return BigInt(text);
  }

  let result = 0n;
  const chars = text.toUpperCase();
  for (const char of chars) {
    const digit = BigInt(BASES[baseKey].digits.indexOf(char));
    if (digit < 0n) {
      throw new Error(`Invalid ${baseKey.toUpperCase()} digit: ${char}`);
    }
    result = (result * BASES[baseKey].radix) + digit;
  }
  return result;
}

function formatValue(value, baseKey) {
  const normalized = normalize(value);
  if (baseKey === "dec") {
    return arithmeticValue(normalized).toString(10);
  }
  return normalized.toString(Number(BASES[baseKey].radix)).toUpperCase();
}

function setMessage(message, isError = false) {
  state.message = message;
  state.messageIsError = isError;
}

function operatorLabel(op) {
  const labels = {
    add: "+",
    sub: "-",
    mul: "×",
    div: "÷",
    and: "AND",
    or: "OR",
    xor: "XOR",
    shl: "<<",
    shr: ">>",
  };
  return labels[op] ?? "";
}

function refreshStatus() {
  const mode = state.signed ? "Signed" : "Unsigned";
  const pending = state.pendingOperator ? ` • Pending ${operatorLabel(state.pendingOperator)}` : "";
  statusLine.textContent = state.message || `${state.inputBase.toUpperCase()} input • ${state.wordSize}-bit • ${mode}${pending}`;
  statusLine.classList.toggle("is-error", state.messageIsError);
}

function fitValueText(input) {
  const overflowThreshold = 16;
  const minFontRem = 0.8;
  const maxFontRem = 1.4;
  const length = input.value.length;
  if (length <= overflowThreshold) {
    input.style.fontSize = "";
    return;
  }
  const shrunk = maxFontRem - (length - overflowThreshold) * 0.025;
  input.style.fontSize = `${Math.max(minFontRem, shrunk)}rem`;
}

function render() {
  valueInput.value = state.awaitingNextInput
    ? formatValue(state.currentValue, state.inputBase)
    : state.inputBuffer;
  fitValueText(valueInput);

  for (const button of Array.from(baseSelector.querySelectorAll("[data-base]"))) {
    button.classList.toggle("is-active", button.dataset.base === state.inputBase);
    button.setAttribute("aria-selected", button.dataset.base === state.inputBase ? "true" : "false");
  }

  const allowedDigits = BASES[state.inputBase].digits;
  for (const button of digitButtons) {
    button.disabled = !allowedDigits.includes(button.dataset.digit);
  }

  refreshStatus();
}

function synchronizeCurrentValueFromBuffer() {
  const parsed = parseBaseValue(state.inputBuffer, state.inputBase);
  state.currentValue = normalize(parsed);
}

function beginNewInput() {
  state.awaitingNextInput = false;
  state.inputBuffer = "0";
  state.currentValue = 0n;
}

function sanitizeInput(rawValue, baseKey) {
  if (baseKey === "dec") {
    let sanitized = rawValue.replace(/[^0-9-]/g, "");
    sanitized = sanitized.startsWith("-")
      ? `-${sanitized.slice(1).replace(/-/g, "")}`
      : sanitized.replace(/-/g, "");
    if (!state.signed) {
      sanitized = sanitized.replace(/-/g, "");
    }
    return sanitized;
  }

  return rawValue.toUpperCase().replace(new RegExp(`[^${BASES[baseKey].digits}]`, "g"), "");
}

function updateBuffer(rawValue, baseKey) {
  try {
    state.inputBase = baseKey;
    state.awaitingNextInput = false;
    state.inputBuffer = sanitizeInput(rawValue, baseKey);
    synchronizeCurrentValueFromBuffer();
    setMessage("");
  } catch (error) {
    setMessage(error.message, true);
  }
  render();
}

function appendDigit(digit) {
  if (state.awaitingNextInput) {
    beginNewInput();
  }

  const candidate = state.inputBuffer === "0"
    ? digit
    : state.inputBuffer === "-0"
      ? `-${digit}`
      : `${state.inputBuffer}${digit}`;
  updateBuffer(candidate, state.inputBase);
}

function backspace() {
  if (state.awaitingNextInput) {
    beginNewInput();
    render();
    return;
  }

  const trimmed = state.inputBuffer.length <= 1
    ? "0"
    : state.inputBuffer.slice(0, -1);
  updateBuffer(trimmed === "-" ? "0" : trimmed, state.inputBase);
}

function clearEntry() {
  state.awaitingNextInput = false;
  state.inputBuffer = "0";
  state.currentValue = 0n;
  setMessage("");
  render();
}

function clearAll() {
  state.storedValue = null;
  state.pendingOperator = null;
  clearEntry();
}

function performUnary(action) {
  try {
    if (state.awaitingNextInput) {
      state.awaitingNextInput = false;
    }

    if (action === "not") {
      state.currentValue = normalize(~state.currentValue);
    } else if (action === "negate") {
      state.currentValue = normalize(-arithmeticValue(state.currentValue));
    }

    state.inputBuffer = formatValue(state.currentValue, state.inputBase);
    setMessage("");
  } catch (error) {
    setMessage(error.message, true);
  }
  render();
}

function executeBinary(left, right, op) {
  const shiftCount = Number(normalize(right) % BigInt(state.wordSize));

  switch (op) {
    case "add":
      return normalize(arithmeticValue(left) + arithmeticValue(right));
    case "sub":
      return normalize(arithmeticValue(left) - arithmeticValue(right));
    case "mul":
      return normalize(arithmeticValue(left) * arithmeticValue(right));
    case "div":
      if (arithmeticValue(right) === 0n) {
        throw new Error("Division by zero is not allowed.");
      }
      return normalize(arithmeticValue(left) / arithmeticValue(right));
    case "and":
      return normalize(normalize(left) & normalize(right));
    case "or":
      return normalize(normalize(left) | normalize(right));
    case "xor":
      return normalize(normalize(left) ^ normalize(right));
    case "shl":
      return normalize(normalize(left) << BigInt(shiftCount));
    case "shr":
      return normalize(state.signed
        ? BigInt.asIntN(state.wordSize, normalize(left)) >> BigInt(shiftCount)
        : normalize(left) >> BigInt(shiftCount));
    default:
      throw new Error(`Unsupported operation: ${op}`);
  }
}

function queueBinary(op) {
  try {
    if (state.pendingOperator !== null && state.storedValue !== null && !state.awaitingNextInput) {
      state.currentValue = executeBinary(state.storedValue, state.currentValue, state.pendingOperator);
      state.inputBuffer = formatValue(state.currentValue, state.inputBase);
    }

    state.storedValue = state.currentValue;
    state.pendingOperator = op;
    state.awaitingNextInput = true;
    setMessage("");
  } catch (error) {
    setMessage(error.message, true);
  }
  render();
}

function evaluate() {
  if (state.pendingOperator === null || state.storedValue === null) {
    setMessage("No pending operation.");
    render();
    return;
  }

  try {
    state.currentValue = executeBinary(state.storedValue, state.currentValue, state.pendingOperator);
    state.storedValue = null;
    state.pendingOperator = null;
    state.awaitingNextInput = true;
    state.inputBuffer = formatValue(state.currentValue, state.inputBase);
    setMessage("");
  } catch (error) {
    setMessage(error.message, true);
  }
  render();
}

function changeBase(baseKey) {
  state.inputBase = baseKey;
  state.inputBuffer = formatValue(state.currentValue, baseKey);
  setMessage("");
  render();
}

function handleKeyboard(event) {
  if (event.ctrlKey || event.metaKey || event.altKey) {
    return;
  }

  const key = event.key.toUpperCase();
  const isDigit = BASES[state.inputBase].digits.includes(key);
  const isInputFocused = document.activeElement === valueInput;

  if (isInputFocused) {
    if (key === "ENTER") {
      event.preventDefault();
      evaluate();
    }
    return;
  }

  if (isDigit) {
    event.preventDefault();
    appendDigit(key);
    return;
  }

  if (key === "ENTER" || key === "=") {
    event.preventDefault();
    evaluate();
    return;
  }

  if (key === "BACKSPACE" && !isInputFocused) {
    event.preventDefault();
    backspace();
    return;
  }

  const operatorMap = {
    "+": "add",
    "-": "sub",
    "*": "mul",
    "/": "div",
    "&": "and",
    "|": "or",
    "^": "xor",
  };

  if (operatorMap[key]) {
    event.preventDefault();
    queueBinary(operatorMap[key]);
  }
}

baseSelector.addEventListener("click", (event) => {
  const button = event.target.closest("[data-base]");
  if (button) {
    changeBase(button.dataset.base);
  }
});

wordSizeSelect.addEventListener("change", () => {
  state.wordSize = Number(wordSizeSelect.value);
  state.currentValue = normalize(state.currentValue);
  if (state.storedValue !== null) {
    state.storedValue = normalize(state.storedValue);
  }
  state.inputBuffer = formatValue(state.currentValue, state.inputBase);
  setMessage("");
  render();
});

signedCheckbox.addEventListener("change", () => {
  state.signed = signedCheckbox.checked;
  if (!state.signed && state.inputBase === "dec") {
    state.inputBuffer = state.inputBuffer.replace(/-/g, "") || "0";
    synchronizeCurrentValueFromBuffer();
  } else {
    state.inputBuffer = formatValue(state.currentValue, state.inputBase);
  }
  setMessage("");
  render();
});

valueInput.addEventListener("input", () => updateBuffer(valueInput.value, state.inputBase));

keypad.addEventListener("click", (event) => {
  const button = event.target.closest("button");
  if (!button) {
    return;
  }

  if (button.dataset.digit) {
    appendDigit(button.dataset.digit);
    return;
  }

  if (button.dataset.op) {
    queueBinary(button.dataset.op);
    return;
  }

  switch (button.dataset.action) {
    case "clear-all":
      clearAll();
      break;
    case "clear-entry":
      clearEntry();
      break;
    case "backspace":
      backspace();
      break;
    case "equals":
      evaluate();
      break;
    case "not":
    case "negate":
      performUnary(button.dataset.action);
      break;
    default:
      break;
  }
});

window.addEventListener("keydown", handleKeyboard);

window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  deferredInstallPrompt = event;
  installButton.classList.remove("hidden");
});

installButton.addEventListener("click", async () => {
  if (!deferredInstallPrompt) {
    return;
  }

  deferredInstallPrompt.prompt();
  await deferredInstallPrompt.userChoice;
  deferredInstallPrompt = null;
  installButton.classList.add("hidden");
});

window.addEventListener("appinstalled", () => {
  installButton.classList.add("hidden");
  setMessage("App installed successfully.");
  render();
});

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("sw.js").catch((error) => {
    setMessage(`Service worker registration failed: ${error.message}`, true);
    render();
  });
}

render();
