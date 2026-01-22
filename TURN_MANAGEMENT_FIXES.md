# Turn Management & Response Processing Fixes

## Critical Issues Fixed

### 1. Turn Ownership Enforcement
- **Created `TurnManager` utility class** to validate turn ownership
- **Anti-impersonation guard** in `parseAIResponse()` - discards any AI message attempting to speak as user role
- **Turn validation** in `processAIStream()` - ensures resolved turn is always valid

### 2. "Procesando" State Stuck
- **Guaranteed state resolution** with `finally { setIsLoading(false) }`
- **Fail-safe content parsing** - injects fallback message if AI response has no tags
- **Empty response handler** - injects error message if AI returns nothing
- **Turn resolution guarantee** - always defaults to user turn if parsing fails

### 3. AI Response Parsing Determinism
- **Enhanced system prompt** with explicit prohibition: "NEVER generate dialogue for [USER_ROLE]"
- **Parsing validation** with `hasParsedContent` flag
- **Fallback message injection** when tags are missing
- **Turn marker validation** with safe defaults

## Implementation Details

### TurnManager Class (`utils/turnManager.ts`)
```typescript
- isUserSpeaker(speaker): boolean
- isAISpeaker(speaker): boolean  
- getTurnOwner(turn): 'USER' | 'AI' | null
- validateAIMessage(speaker): boolean // Returns false if AI tries to speak as user
```

### App.tsx Changes

**Anti-Impersonation Guard (Line ~290)**
```typescript
if (turnManager && !turnManager.validateAIMessage(speaker)) {
  console.warn(`[App] Discarding AI message impersonating user: ${speaker}`);
  continue; // Skip this message
}
```

**Fail-Safe Response Processing (Line ~320-360)**
```typescript
// 1. Track if content was parsed
if (newMessages.length > 0) hasParsedContent = true;

// 2. Inject fallback if no tags found
if (!hasParsedContent && accumulatedText.trim().length > 0) {
  const fallbackMessage = { speaker: Speaker.JUEZ, text: accumulatedText, ... };
  setChatHistory(prev => [...baseHistory, fallbackMessage]);
  hasParsedContent = true;
}

// 3. Inject error if completely empty
if (!hasParsedContent) {
  setChatHistory(prev => [...prev, { 
    speaker: Speaker.JUEZ, 
    text: "[Error del sistema: La IA no generó una respuesta válida...]"
  }]);
}
```

**Turn Resolution Guarantee (Line ~370-385)**
```typescript
if (!nextTurn) {
  console.warn("[App] No turn marker found, defaulting to user");
  setCurrentTurn(simulationConfig?.userRole || Speaker.DEFENSA);
} else if (turnManagerRef.current?.isUserSpeaker(nextTurn)) {
  setCurrentTurn(nextTurn);
} else if (turnManagerRef.current?.isAISpeaker(nextTurn)) {
  setCurrentTurn(nextTurn);
} else {
  console.warn(`[App] Invalid turn ${nextTurn}, defaulting to user`);
  setCurrentTurn(simulationConfig?.userRole || Speaker.DEFENSA);
}
```

**Guaranteed State Resolution (Line ~395)**
```typescript
} finally {
  setIsLoading(false); // ALWAYS executes, even on error
}
```

### geminiService.ts Changes

**Enhanced System Prompt (Line ~450)**
```typescript
7. **ROLES PROHIBIDOS:** NUNCA generes diálogo para \`[${userRole.toUpperCase()}]:\`. 
   Este rol pertenece exclusivamente al usuario humano. 
   Si generas contenido para este rol, la simulación fallará.
```

## Testing Checklist

- [ ] User selects Defensa → AI never generates [DEFENSA]: messages
- [ ] User selects Ministerio Público → AI never generates [MINISTERIO PÚBLICO]: messages
- [ ] AI response with no tags → Fallback message appears, turn resolves to user
- [ ] AI response completely empty → Error message appears, turn resolves to user
- [ ] Network timeout → Error message appears, turn resolves to user
- [ ] AI generates invalid turn marker → Turn defaults to user
- [ ] "Procesando" state → Always clears after response (success or failure)

## State Machine Contract

```
USER TURN:
  - Input enabled
  - TTS disabled
  - AI silent
  
AI TURN:
  - Input disabled
  - TTS enabled (if not muted)
  - AI generates only its assigned roles
  
OBJECTION PHASE:
  - currentTurn = null
  - Special UI for objection selection
  
ERROR STATE:
  - Always resolves to USER TURN
  - Error message injected as JUEZ
  - isLoading = false guaranteed
```

## Logging for Debugging

All critical points now log to console:
- `[TurnManager] VIOLATION:` - AI attempted user impersonation
- `[App] Discarding AI message impersonating user:` - Message was blocked
- `[App] AI responded but no tags found` - Fallback triggered
- `[App] AI response was empty or unparseable` - Error injection
- `[App] No turn marker found, defaulting to user` - Turn resolution
- `[App] Invalid turn X, defaulting to user` - Turn validation failed
- `[App] Error in AI stream:` - Exception caught

## Performance Impact

- **Minimal overhead**: TurnManager validation is O(1)
- **No breaking changes**: Existing functionality preserved
- **Defensive programming**: Multiple layers of fail-safes
- **User experience**: No more stuck states or infinite loading
