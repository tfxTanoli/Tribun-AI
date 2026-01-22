import { Speaker } from '../types';

export type TurnOwner = 'USER' | 'AI';

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
}
