import { Speaker } from '../types';

export type TurnOwner = 'USER' | 'AI';

// FIX: Added TurnState enum for single source of truth on turn ownership
export enum TurnState {
  AI_TURN = 'AI_TURN',           // AI is speaking or processing - user input disabled
  USER_TURN = 'USER_TURN',       // User's turn to respond - input enabled
  OBJECTION_PHASE = 'OBJECTION_PHASE', // Special UI for objection selection
  LOADING = 'LOADING'            // System is processing - input disabled
}

export class TurnManager {
  private userRole: Speaker;

  constructor(userRole: Speaker) {
    this.userRole = userRole;
  }

  isUserSpeaker(speaker: Speaker): boolean {
    return speaker === this.userRole;
  }

  isAISpeaker(speaker: Speaker): boolean {
    return speaker !== this.userRole && speaker !== Speaker.PROFESOR;
  }

  getTurnOwner(turn: Speaker | null): TurnOwner | null {
    if (turn === null) return null;
    return this.isUserSpeaker(turn) ? 'USER' : 'AI';
  }

  validateAIMessage(speaker: Speaker): boolean {
    if (this.isUserSpeaker(speaker)) {
      console.error(`[TurnManager] VIOLATION: AI attempted to speak as user role ${speaker}`);
      return false;
    }
    return true;
  }

  /**
   * FIX: Computes the unified turn state considering speaker turn, audio playback, and loading.
   * This is the SINGLE SOURCE OF TRUTH for whether user can interact.
   */
  computeTurnState(
    currentTurn: Speaker | null,
    isLoading: boolean,
    isSpeaking: boolean,
    isObjectionPhase: boolean
  ): TurnState {
    // Objection phase takes priority
    if (isObjectionPhase) {
      return TurnState.OBJECTION_PHASE;
    }

    // Loading state (waiting for AI response)
    if (isLoading) {
      return TurnState.LOADING;
    }

    // If AI audio is playing, it's still AI's turn even if currentTurn changed
    // If AI audio is playing, it's still AI's turn even if currentTurn changed
    if (isSpeaking) {
      return TurnState.AI_TURN;
    }

    // FIX: Explicitly treat IMPUTADO and MINISTERIO_PUBLICO (if not user) as AI_TURN
    // This is a safety net against simulation state glitches.
    if (currentTurn === Speaker.IMPUTADO) return TurnState.AI_TURN;
    if (currentTurn && !this.isUserSpeaker(currentTurn)) return TurnState.AI_TURN;

    // Check if it's user's turn based on speaker
    if (currentTurn !== null && this.isUserSpeaker(currentTurn)) {
      return TurnState.USER_TURN;
    }

    // Default: AI turn (AI speakers or null turn)
    return TurnState.AI_TURN;
  }

  /**
   * FIX: Returns true only when user should be able to interact with input.
   */
  canUserInteract(turnState: TurnState): boolean {
    return turnState === TurnState.USER_TURN;
  }
}
