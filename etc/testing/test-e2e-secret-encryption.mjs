/**
 * E2E encryption round-trip test for secret conversation cloud sync.
 *
 * Verifies that:
 * 1. A blob encrypted client-side (addon-init.js logic) decrypts with the
 *    server-side logic (members-worker.js decryptSecretConversation).
 * 2. A blob encrypted server-side decrypts with the client-side logic.
 * 3. Tampered ciphertext fails to decrypt (returns null).
 *
 * Run: node etc/testing/test-e2e-secret-encryption.mjs
 */

const MAGIC = new TextEncoder().encode("G4FENC");

// --- Client-side logic (mirrors addon-init.js) ---

async function deriveConversationKey(secret) {
  const keyMaterial = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
  return crypto.subtle.importKey("raw", keyMaterial, "AES-GCM", false, ["encrypt", "decrypt"]);
}

function uint8ArrayToBase64(bytes) {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function base64ToUint8Array(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function encryptConversationBlob(conversation, secret) {
  const key = await deriveConversationKey(secret);
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const raw = new TextEncoder().encode(JSON.stringify(conversation));
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, key, raw);
  const blob = new Uint8Array(MAGIC.length + 1 + nonce.length + ciphertext.byteLength);
  blob.set(MAGIC, 0);
  blob.set([1], MAGIC.length);
  blob.set(nonce, MAGIC.length + 1);
  blob.set(new Uint8Array(ciphertext), MAGIC.length + 1 + nonce.length);
  return blob;
}

async function decryptConversationBlob(buffer, secret) {
  try {
    const bytes = new Uint8Array(buffer);
    if (bytes.length > MAGIC.length + 1 + 12 && MAGIC.every((b, i) => bytes[i] === b)) {
      if (bytes[MAGIC.length] !== 1) return null;
      const nonce = bytes.slice(MAGIC.length + 1, MAGIC.length + 13);
      const ciphertext = bytes.slice(MAGIC.length + 13);
      const key = await deriveConversationKey(secret);
      const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: nonce }, key, ciphertext);
      return JSON.parse(new TextDecoder().decode(plain));
    }
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch (e) {
    return null;
  }
}

// --- Server-side logic (mirrors members-worker.js) ---

async function deriveSecretKey(workspaceSecret) {
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.digest("SHA-256", encoder.encode(workspaceSecret));
  return crypto.subtle.importKey("raw", keyMaterial, "AES-GCM", false, ["encrypt", "decrypt"]);
}

async function encryptSecretConversation(conversation, workspaceSecret) {
  const key = await deriveSecretKey(workspaceSecret);
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const encoder = new TextEncoder();
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: nonce },
    key,
    encoder.encode(JSON.stringify(conversation))
  );
  const version = new Uint8Array([1]);
  const blob = new Uint8Array(MAGIC.length + version.length + nonce.length + ciphertext.byteLength);
  blob.set(MAGIC, 0);
  blob.set(version, MAGIC.length);
  blob.set(nonce, MAGIC.length + version.length);
  blob.set(new Uint8Array(ciphertext), MAGIC.length + version.length + nonce.length);
  return blob;
}

async function decryptSecretConversation(buffer, workspaceSecret) {
  try {
    const bytes = new Uint8Array(buffer);
    if (bytes.length <= MAGIC.length + 1 + 12) return null;
    if (!MAGIC.every((b, i) => bytes[i] === b)) {
      return JSON.parse(new TextDecoder().decode(bytes));
    }
    if (bytes[MAGIC.length] !== 1) return null;
    const nonce = bytes.slice(MAGIC.length + 1, MAGIC.length + 13);
    const ciphertext = bytes.slice(MAGIC.length + 13);
    const key = await deriveSecretKey(workspaceSecret);
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: nonce }, key, ciphertext);
    return JSON.parse(new TextDecoder().decode(plain));
  } catch (e) {
    return null;
  }
}

// --- Tests ---

const conversation = {
  id: "conv-123",
  title: "Test Conversation",
  updated: Date.now(),
  added: Date.now(),
  items: [
    { role: "user", content: "Hello, this is a secret message 🔐" },
    { role: "assistant", content: "Encrypted reply with unicode: äöü 中文" },
  ],
};

// The workspace secret as derived client-side: hex(SHA-256("userId:secret"))
const userId = "user-abc";
const userSecret = "s3cret-value";
const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${userId}:${userSecret}`));
const workspaceSecret = Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, "0")).join("");

let failures = 0;
function check(name, cond) {
  console.log(`${cond ? "PASS" : "FAIL"}: ${name}`);
  if (!cond) failures++;
}

// 1. Client encrypt → server decrypt
const clientBlob = await encryptConversationBlob(conversation, workspaceSecret);
const fromServer = await decryptSecretConversation(clientBlob, workspaceSecret);
check("server decrypts client-encrypted blob", JSON.stringify(fromServer) === JSON.stringify(conversation));

// 2. Server encrypt → client decrypt
const serverBlob = await encryptSecretConversation(conversation, workspaceSecret);
const fromClient = await decryptConversationBlob(serverBlob, workspaceSecret);
check("client decrypts server-encrypted blob", JSON.stringify(fromClient) === JSON.stringify(conversation));

// 3. E2E envelope round-trip (what actually travels over the wire)
const envelope = {
  id: conversation.id,
  title: conversation.title,
  updated: conversation.updated,
  added: conversation.added,
  items_count: conversation.items.length,
  encrypted: true,
  blob: uint8ArrayToBase64(clientBlob),
};
check("envelope has base64 blob", typeof envelope.blob === "string" && envelope.encrypted === true);
const decoded = base64ToUint8Array(envelope.blob);
const roundTrip = await decryptSecretConversation(decoded, workspaceSecret);
check("worker base64-decoded blob decrypts server-side", JSON.stringify(roundTrip) === JSON.stringify(conversation));

// 4. Wrong secret fails
const wrong = await decryptSecretConversation(clientBlob, "f".repeat(64));
check("wrong workspace secret returns null", wrong === null);

// 5. Tampered ciphertext fails
const tampered = new Uint8Array(clientBlob);
tampered[tampered.length - 1] ^= 0xff;
check("tampered ciphertext returns null", (await decryptConversationBlob(tampered, workspaceSecret)) === null);

// 6. Legacy plaintext fallback
const plainBlob = new TextEncoder().encode(JSON.stringify(conversation));
const legacy = await decryptConversationBlob(plainBlob, workspaceSecret);
check("legacy plaintext blob still readable", JSON.stringify(legacy) === JSON.stringify(conversation));

// 7. Blob does not contain plaintext
const asText = new TextDecoder().decode(clientBlob).includes("secret message");
check("ciphertext contains no plaintext", !asText);

if (failures > 0) {
  console.error(`\n${failures} test(s) failed`);
  process.exit(1);
}
console.log("\nAll E2E encryption tests passed.");
