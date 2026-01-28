export enum Speaker {
  JUEZ = "Juez",
  MINISTERIO_PUBLICO = "Ministerio Público",
  DEFENSA = "Defensa",
  TESTIGO = "Testigo",
  PROFESOR = "Profesor",
  SECRETARIO = "Secretario",
  IMPUTADO = "Imputado",
}

export interface VoiceOption {
  id: string;
  name: string;
  languageCode: string;
  ssmlGender: 'MALE' | 'FEMALE' | 'NEUTRAL';
}

export interface VoiceSettings {
  [Speaker.JUEZ]?: string;
  [Speaker.MINISTERIO_PUBLICO]?: string;
  [Speaker.DEFENSA]?: string;
  [Speaker.TESTIGO]?: string;
  [Speaker.SECRETARIO]?: string;
}

export interface SimulationConfig {
  userName: string;
  userRole: Speaker;
  stage: string;
  subStage: string;
  crime: string;
  crimeContext?: string;
  defendantProfile?: string;
  prosecutorWitness?: string;
  defenseWitness?: string;
  rigorLevel: string;
  voiceSettings?: VoiceSettings;
}

export interface ChatMessage {
  id?: string;
  speaker: Speaker;
  text: string;
}

export interface Evaluation {
  transcript: string;
  feedback: {
    argumentClarity: number;
    legalBasis: number;
    proceduralCoherence: number;
    objectionPertinence: number;
    oratory: number;
  };
  comments: string;
  finalScore: number;
}

export enum SimulationState {
  INITIAL = 'INITIAL',
  LOADING = 'LOADING',
  STARTED = 'STARTED',
  ENDED = 'ENDED',
  EVALUATION = 'EVALUATION',
  FINISHED = 'FINISHED',
}