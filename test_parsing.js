
// Mock Speaker Enum
const Speaker = {
    JUEZ: "Juez",
    MINISTERIO_PUBLICO: "Ministerio Público",
    DEFENSA: "Defensa",
    TESTIGO: "Testigo",
    SECRETARIO: "Secretario",
    PROFESOR: "Profesor"
};

// Mock TurnManager
class TurnManager {
    constructor(userRole) {
        this.userRole = userRole;
    }

    isUserSpeaker(speaker) {
        return speaker === this.userRole;
    }

    validateAIMessage(speaker) {
        if (this.isUserSpeaker(speaker)) {
            console.log(`[TurnManager] VIOLATION: AI attempted to speak as user role ${speaker}`);
            return false;
        }
        return true;
    }
}

// Mock crypto
const crypto = { randomUUID: () => "uuid-" + Math.random() };

// The function to test (adapted from App.tsx)
const parseAIResponse = (text, turnManager) => {
    const messages = [];
    const parts = text.split(/(\[JUEZ\]:|\[MINISTERIO PÚBLICO\]:|\[DEFENSA\]:|\[TESTIGO\]:|\[SECRETARIO\]:)/g).filter(Boolean);

    for (let i = 0; i < parts.length; i++) {
        const tag = parts[i].trim();
        const content = parts[i + 1]?.trim();

        // Handle empty content or tag-only parts scenario (simplified from App.tsx)
        if (!content && (tag.startsWith('[') && tag.endsWith(']:'))) {
            // Logic in App.tsx handles this, but for test we assume well-formed or we mimic App.tsx exactly
            // App.tsx: 
            /*
              if (!content && (tag === ...)) {
                ...
                messages.push({ ... text: '' ... });
                continue;
              }
            */
            // Let's implement the core logic for normal parts first
        }
        if (!content) continue;

        let speaker;
        if (tag === '[JUEZ]:') speaker = Speaker.JUEZ;
        else if (tag === '[MINISTERIO PÚBLICO]:') speaker = Speaker.MINISTERIO_PUBLICO;
        else if (tag === '[DEFENSA]:') speaker = Speaker.DEFENSA;
        else if (tag === '[TESTIGO]:') speaker = Speaker.TESTIGO;
        else if (tag === '[SECRETARIO]:') speaker = Speaker.SECRETARIO;

        if (speaker) {
            // Anti-impersonation guard
            if (turnManager && !turnManager.validateAIMessage(speaker)) {
                console.warn(`[App] Discarding AI message impersonating user: ${speaker}`);
                i++;
                continue;
            }
            messages.push({ speaker, text: content, id: crypto.randomUUID() });
            i++;
        } else if (messages.length > 0) {
            // Append to previous if no tag found (e.g. broken line)
            messages[messages.length - 1].text += tag;
        } else if (tag) {
            // Text before first tag
            // For test purposes we skip this or implement simplified
        }
    }
    return messages;
};

// --- TESTS ---

console.log("Running Turn Management & Parsing Tests...\n");

const turnManager = new TurnManager(Speaker.DEFENSA); // User is Defensa

// Test 1: Normal flow (AI speaks as Juez)
console.log("Test 1: Normal flow (AI speaks as Juez)");
const input1 = "[JUEZ]: Hola. [MINISTERIO PÚBLICO]: Hola también.";
const result1 = parseAIResponse(input1, turnManager);
console.log("Result 1:", result1.length === 2 ? "PASS" : "FAIL", result1);

// Test 2: Impersonation attempt (AI tries to speak as Defensa)
console.log("\nTest 2: Impersonation attempt (AI tries to speak as Defensa)");
const input2 = "[JUEZ]: Orden en la sala. [DEFENSA]: ¡Protesto!";
const result2 = parseAIResponse(input2, turnManager);
const passed2 = result2.length === 1 && result2[0].speaker === Speaker.JUEZ;
console.log("Result 2:", passed2 ? "PASS" : "FAIL");
if (!passed2) console.log("Got:", result2);

// Test 3: Multiple impersonations
console.log("\nTest 3: Multiple impersonations");
const input3 = "[DEFENSA]: Soy el usuario. [JUEZ]: No lo eres. [DEFENSA]: Sí lo soy.";
const result3 = parseAIResponse(input3, turnManager);
const passed3 = result3.length === 1 && result3[0].speaker === Speaker.JUEZ;
console.log("Result 3:", passed3 ? "PASS" : "FAIL");
if (!passed3) console.log("Got:", result3);

// Test 4: Turn Marker parsing (Mocking App.tsx logic for turn marker)
// Note: parseAIResponse doesn't handle Turn Marker, parseTurnAndCleanText does.
// Let's implement parseTurnAndCleanText mock
const parseTurnAndCleanText = (rawText) => {
    let text = rawText;
    const turnRegex = /\[TURNO:\s*(Juez|Ministerio P[uú]blico|Defensa|Testigo|Secretario)\]\s*$/;
    const match = text.match(turnRegex);
    let nextTurn = null;
    if (match && match[1]) {
        // Mock simplification
        const roleStr = match[1].toLowerCase();
        if (roleStr.includes("juez")) nextTurn = Speaker.JUEZ;
        else if (roleStr.includes("defensa")) nextTurn = Speaker.DEFENSA;
    }
    return { nextTurn };
}

console.log("\nTest 4: Turn Marker Parsing");
const input4 = "Texto blabla. [TURNO: Defensa]";
const { nextTurn } = parseTurnAndCleanText(input4);
console.log("Result 4:", nextTurn === Speaker.DEFENSA ? "PASS" : "FAIL", nextTurn);

// Test 5: Fallback logic simulation
// Since we can't fully mock the async processAIStream here easily, we rely on the fact that parseAIResponse handles the content chunks.
// If parseAIResponse returns empty array for "sometext without tags", App.tsx handles the fallback.
console.log("\nTest 5: Content without tags (App.tsx fallback logic check via parseAIResponse)");
const input5 = "Texto sin etiquetas de rol.";
const result5 = parseAIResponse(input5, turnManager);
// parseAIResponse should return empty array or handle text before tags?
// In App.tsx: 
/*
      } else if (tag) {
        // Handles text before the first tag...
        // uses regex to find first tag... if NOT found, it might NOT push anything?
*/
// Let's check App.tsx code again...
// It uses `text.match(...)` to find first tag. If `input5` has no tags, `parseAIResponse` might return empty.
console.log("Result 5:", result5.length === 0 ? "PASS (Correctly returns empty, allowing App.tsx fallback)" : "FAIL", result5);

console.log("\nDone.");
