// ===============================
// frontend/js/crypto-utils.js
// Hash de senha 100% client-side usando Web Crypto (PBKDF2 + SHA-256).
// Não existe mais servidor: isto é apenas higiene básica, não uma
// fronteira de segurança real (quem tem acesso ao navegador vê tudo).
// ===============================

const PBKDF2_ITERATIONS = 100000;

function _bytesToBase64(bytes) {
  let binary = "";
  bytes.forEach((b) => (binary += String.fromCharCode(b)));
  return btoa(binary);
}

function _base64ToBytes(b64) {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function _deriveBits(password, salt) {
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    { name: "PBKDF2" },
    false,
    ["deriveBits"]
  );
  const derived = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations: PBKDF2_ITERATIONS, hash: "SHA-256" },
    keyMaterial,
    256
  );
  return new Uint8Array(derived);
}

async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const derived = await _deriveBits(password, salt);
  return `${_bytesToBase64(salt)}$${_bytesToBase64(derived)}`;
}

async function verifyPassword(password, storedHash) {
  try {
    const [saltB64, hashB64] = storedHash.split("$");
    const salt = _base64ToBytes(saltB64);
    const expected = _base64ToBytes(hashB64);
    const derived = await _deriveBits(password, salt);
    if (derived.length !== expected.length) return false;
    let diff = 0;
    for (let i = 0; i < derived.length; i++) diff |= derived[i] ^ expected[i];
    return diff === 0;
  } catch (e) {
    return false;
  }
}
