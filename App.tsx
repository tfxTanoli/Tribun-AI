
import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Chat, GenerateContentResponse } from '@google/genai';
import { ChatMessage as ChatMessageType, Evaluation, SimulationState, Speaker, SimulationConfig } from './types';
import { startChatSession, continueChat, getEvaluation, generateDynamicContext } from './services/geminiService';
import { audioService } from './services/audioService';
import { useSpeechRecognition } from './hooks/useSpeechRecognition';
import { GavelIcon, ProsecutorIcon, UserIcon, WitnessIcon, MicrophoneIcon, SpeakerOnIcon, SpeakerOffIcon, SkipIcon, PauseIcon, PlayIcon, ReplayIcon } from './components/icons';
import ChatMessage from './components/ChatMessage';
import EvaluationDisplay from './components/EvaluationDisplay';
import SimulationSetup from './components/SimulationSetup';
import { TurnManager, TurnState } from './utils/turnManager';

// FIX: Added complete type declarations for the Web Speech API to resolve 'Cannot find name SpeechRecognition' errors.
// The previous declarations were incomplete and circular.
// MOVED TO speech.d.ts

// FIX: Convert the generic arrow function to a standard function declaration
// to resolve TSX parsing ambiguity without needing a trailing comma on the generic type parameter.
// This resolves a cascade of type inference errors throughout the file.
function findLastIndex<T>(array: Array<T>, predicate: (value: T, index: number, obj: T[]) => boolean): number {
  let l = array.length;
  while (l--) {
    if (predicate(array[l], l, array))
      return l;
  }
  return -1;
}

const OBJECTION_TYPES = [
  'Pregunta sugestiva', 'Pregunta confusa', 'Pregunta capciosa',
  'Pregunta ambigua', 'Pregunta irrelevante', 'Pregunta impertinente',
  'Pregunta repetitiva', 'Pregunta compuesta', 'Pregunta conclusiva',
  'Pregunta que induce la respuesta', 'Pregunta especulativa',
  'Falta de pertinencia temporal', 'Pregunta engañosa', 'Pregunta basada en suposiciones'
];

const App: React.FC = () => {
  const [simulationState, setSimulationState] = useState<SimulationState>(SimulationState.INITIAL);
  const [simulationConfig, setSimulationConfig] = useState<SimulationConfig | null>(null);
  const [userName, setUserName] = useState<string>('');
  const [contextSummary, setContextSummary] = useState<string | null>(null);
  const [chatHistory, setChatHistory] = useState<ChatMessageType[]>([]);
  const [userInput, setUserInput] = useState<string>('');
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [loadingMessage, setLoadingMessage] = useState<string>('');
  const [evaluation, setEvaluation] = useState<Evaluation | null>(null);
  const [currentTurn, setCurrentTurn] = useState<Speaker | null>(null);
  // Removed old isListening state, now using hook
  const [isTtsEnabled, setIsTtsEnabled] = useState<boolean>(true);
  // FIX: isSpeaking now synced with AudioService via onPlayingStateChange listener
  const [isSpeaking, setIsSpeaking] = useState<boolean>(false);
  const [isSpeechPaused, setIsSpeechPaused] = useState<boolean>(false);
  const [currentStageName, setCurrentStageName] = useState<string>('');
  const [isWaitingForAudio, setIsWaitingForAudio] = useState<boolean>(false);
  const [isAudioSuspended, setIsAudioSuspended] = useState<boolean>(false);
  const [hasMoreAudio, setHasMoreAudio] = useState<boolean>(false);

  // State for objection flow
  const [isObjectionPhase, setIsObjectionPhase] = useState<boolean>(false); // Replaced with logic or keep existing
  // Keeping existing state variables as they are used elsewhere
  const [showObjectionOptions, setShowObjectionOptions] = useState<boolean>(false);

  const [activeMessageId, setActiveMessageId] = useState<string | null>(null);


  const chatSessionRef = useRef<any | null>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const speechSessionRef = useRef(0);
  const prevIsLoadingRef = useRef<boolean>(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const prevTtsEnabledRef = useRef<boolean>(isTtsEnabled);
  const historyLengthBeforeLoadingRef = useRef<number>(0);
  const turnManagerRef = useRef<TurnManager | null>(null);

  const handleSpeechResult = (text: string) => {
    setUserInput(text);
  };

  const { isListening, toggleListening, stopListening } = useSpeechRecognition({
    onResult: handleSpeechResult
  });

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatHistory]);

  // Adjust textarea height on input change
  useEffect(() => {
    const textarea = textareaRef.current;
    if (textarea) {
      // Reset height to allow shrinking
      textarea.style.height = 'auto';
      // Set height based on content
      textarea.style.height = `${textarea.scrollHeight}px`;
    }
  }, [userInput]);

  // FIX: Force reset of textarea height when it becomes the user's turn
  // This ensures the "text bar" resets visually on mobile even if userInput was already empty.
  useEffect(() => {
    if (currentTurn === simulationConfig?.userRole && textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      if (textareaRef.current.value) {
        textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`;
      }
    }
  }, [currentTurn, simulationConfig?.userRole]);

  const stopSpeech = useCallback(() => {
    speechSessionRef.current += 1;
    audioService.cancel();
    // setIsSpeaking(false); // Managed by service in future, kept false for now
    // setIsSpeechPaused(false);
  }, []);

  // Función crítica para móviles: Desbloquea el audio en iOS/Android
  // Debe llamarse dentro de un evento de usuario (click/touch)
  const unlockAudio = useCallback(() => {
    audioService.unlockAudio();
  }, []);

  // Removed old effects for loading voices and speech recognition setup
  // because they are now handled by audioService (voices - placeholder) and useSpeechRecognition hook.

  // Removed cleanTextForSpeech (logic moved to AudioService)

  const speakMessagesSequentially = useCallback((messages: ChatMessageType[]) => {
    if (!isTtsEnabled || messages.length === 0) {
      return;
    }

    // Logic simplified: All playback is delegated to AudioService
    // which handles queueing and clean abstraction.
    messages.forEach(message => {
      // Filter: Don't speak Professor messages OR User's own messages (prevent echo)
      if (message.speaker !== Speaker.PROFESOR && message.speaker !== simulationConfig?.userRole) {
        audioService.speak(message.text, message.speaker, message.id);
      }
    });
  }, [isTtsEnabled]);

  useEffect(() => {
    // Also trigger speech when in ENDED state if new messages arrived
    const shouldSpeak = (simulationState === SimulationState.STARTED || simulationState === SimulationState.ENDED) && !isLoading && chatHistory.length > 0;

    if (prevIsLoadingRef.current && shouldSpeak) {
      // FIX: Slice history from the length it had *before* loading began.
      // This correctly identifies only the new messages that have arrived,
      // preventing the replay of the previous question during objection flows.
      const newAiMessages = chatHistory.slice(historyLengthBeforeLoadingRef.current);

      if (newAiMessages.length > 0) {
        speakMessagesSequentially(newAiMessages);
      }
    }
    prevIsLoadingRef.current = isLoading;
  }, [isLoading, chatHistory, simulationState, speakMessagesSequentially]);

  // FIX: Removed the old "unmute replay" effect.
  // With volume-based muting (setMuted), audio position is preserved.
  // When unmuting, volume is simply restored via audioService.setMuted(false).
  // No need to replay from beginning - queue continues where it was.



  // Subscribe to active message ID updates from AudioService
  useEffect(() => {
    const unsubscribe = audioService.onCurrentMessageIdChange((id) => {
      setActiveMessageId(id);
    });
    return unsubscribe;
  }, []);

  // FIX: Subscribe to AudioService playing state for UI synchronization
  // This is the SINGLE SOURCE OF TRUTH for isSpeaking state
  useEffect(() => {
    const unsubscribe = audioService.onPlayingStateChange((playing) => {
      setIsSpeaking(playing);
      // Also check suspension state whenever playing state changes
      setIsAudioSuspended(audioService.isAudioContextSuspended());
      // FIX: Track if there are more audio items after current
      setHasMoreAudio(audioService.hasMoreInQueue());
    });
    return unsubscribe;
  }, []);

  // Poll for audio suspension state (for mobile auto-lock detection)
  useEffect(() => {
    const interval = setInterval(() => {
      setIsAudioSuspended(audioService.isAudioContextSuspended());
    }, 2000);
    return () => clearInterval(interval);
  }, []);


  // AUTO-ADVANCE AI TURN
  // Logic: If it's AI's turn (e.g. Juez -> MP), we must trigger generation automatically.
  useEffect(() => {
    if (simulationState === SimulationState.STARTED && !isLoading && currentTurn && turnManagerRef.current?.isAISpeaker(currentTurn)) {
      const timer = setTimeout(() => {
        console.log(`[App] Auto-advancing AI turn for ${currentTurn}`);
        sendSystemMessage("");
      }, 500); // Small natural pause
      return () => clearTimeout(timer);
    }
  }, [currentTurn, isLoading, simulationState]);

  const handleListen = () => {
    // unlockAudio(); // Triggered inside toggleListening if needed logic is there, but App.tsx used to invoke it explicitly.
    // AudioService.unlockAudio() call can remain here if we want to ensure it, 
    // but the hook can also handle "prepare" logic. 
    // The original handleListen called unlockAudio() then acted.
    audioService.unlockAudio();
    toggleListening(userInput);
  };


  const parseTurnAndCleanText = (rawText: string): { cleanText: string; nextTurn: Speaker | null; detectedStage: string | null } => {
    let text = rawText;
    let detectedStage = null;

    // Parse Stage Tag: [ETAPA: Nombre]
    const stageRegex = /\[ETAPA:\s*([^\]]+)\]/i;
    const stageMatch = text.match(stageRegex);
    if (stageMatch && stageMatch[1]) {
      detectedStage = stageMatch[1].trim();
      text = text.replace(stageRegex, ''); // Remove tag from text
    }

    // Parse Turn Tag
    // FIX: Removed 'i' flag to enforce strict case matching for the tag key [TURNO: ...].
    // This prevents false positives if the AI casually mentions a role in brackets or uses a non-standard tag.
    // Also handling accent variations in regex just in case.
    const turnRegex = /\[TURNO:\s*(Juez|Ministerio P[uú]blico|Defensa|Testigo|Secretario)\]\s*$/;
    const match = text.match(turnRegex);
    let nextTurn = null;

    if (match && match[1]) {
      text = text.replace(turnRegex, '').trim();
      const roleStr = match[1].toLowerCase();

      const normalize = (str: string) => str.normalize("NFD").replace(/[\u0300-\u036f]/g, "");

      if (normalize(roleStr) === normalize(Speaker.JUEZ.toLowerCase())) nextTurn = Speaker.JUEZ;
      else if (normalize(roleStr) === normalize(Speaker.MINISTERIO_PUBLICO.toLowerCase())) nextTurn = Speaker.MINISTERIO_PUBLICO;
      else if (normalize(roleStr) === normalize(Speaker.DEFENSA.toLowerCase())) nextTurn = Speaker.DEFENSA;
      else if (normalize(roleStr) === normalize(Speaker.TESTIGO.toLowerCase())) nextTurn = Speaker.TESTIGO;
      else if (normalize(roleStr) === normalize(Speaker.SECRETARIO.toLowerCase())) nextTurn = Speaker.SECRETARIO;
    }

    return { cleanText: text, nextTurn, detectedStage };
  };

  const handleStartSimulation = async (config: SimulationConfig) => {
    unlockAudio();

    if (config.voiceSettings) {
      audioService.updateVoiceSettings(config.voiceSettings);
    }

    // Initialize turn manager
    turnManagerRef.current = new TurnManager(config.userRole);

    setSimulationConfig(config);
    setUserName(config.userName);
    setCurrentStageName(config.subStage);
    setUserInput('');
    historyLengthBeforeLoadingRef.current = 0;
    setIsLoading(true);
    setLoadingMessage('Generando contexto orgánico del caso...');
    setSimulationState(SimulationState.LOADING);
    setChatHistory([]);
    setEvaluation(null);
    setContextSummary(null);
    stopSpeech();
    audioService.resetQueue();

    try {
      // 1. Generate dynamic context first
      const dynamicContext = await generateDynamicContext(config);
      setContextSummary(dynamicContext);

      setLoadingMessage('Iniciando simulación y preparando actores virtuales...');

      // 2. Start the main chat session with the generated context
      const { session, streamPromise } = startChatSession(config, dynamicContext);
      chatSessionRef.current = session;
      setSimulationState(SimulationState.STARTED);

      const stream = await streamPromise;
      let accumulatedText = '';

      for await (const chunk of stream) {
        if (chunk.text) {
          accumulatedText += chunk.text;

          const { cleanText, detectedStage } = parseTurnAndCleanText(accumulatedText);

          if (detectedStage) {
            setCurrentStageName(detectedStage.replace(/\*/g, ''));
          }

          const parsedMessages = parseAIResponse(cleanText.replace('[PAUSA_PARA_OBJECION]', ''));
          setChatHistory(parsedMessages);
        }
      }

      if (accumulatedText.includes('[PAUSA_PARA_OBJECION]')) {
        setIsObjectionPhase(true);
        setShowObjectionOptions(false);
        setCurrentTurn(null);
      } else {
        const { nextTurn } = parseTurnAndCleanText(accumulatedText);
        setCurrentTurn(nextTurn);
      }

    } catch (error) {
      console.error("Error al iniciar la simulación:", error);
      setChatHistory([{ speaker: Speaker.JUEZ, text: "Error al iniciar la simulación. Por favor, recargue la página.", id: crypto.randomUUID() }]);
      setSimulationState(SimulationState.INITIAL);
    } finally {
      setIsLoading(false);
      setLoadingMessage('');
    }
  };

  const resetSimulation = () => {
    stopSpeech();
    if (isListening) {
      stopListening();
    }
    audioService.resetQueue();
    setSimulationState(SimulationState.INITIAL);
    setSimulationConfig(null);
    setChatHistory([]);
    setEvaluation(null);
    setContextSummary(null);
    chatSessionRef.current = null;
    setUserName('');
    setCurrentStageName('');
    setUserInput(''); // Reset input
    setIsWaitingForAudio(false);
  };

  const parseAIResponse = (text: string): ChatMessageType[] => {
    const messages: ChatMessageType[] = [];
    const parts = text.split(/(\[JUEZ\]:|\[MINISTERIO PÚBLICO\]:|\[DEFENSA\]:|\[TESTIGO\]:|\[SECRETARIO\]:)/g).filter(Boolean);
    const turnManager = turnManagerRef.current;

    for (let i = 0; i < parts.length; i++) {
      const tag = parts[i].trim();
      const content = parts[i + 1]?.trim();
      if (!content && (tag === '[JUEZ]:' || tag === '[MINISTERIO PÚBLICO]:' || tag === '[DEFENSA]:' || tag === '[TESTIGO]:' || tag === '[SECRETARIO]:')) {
        let speaker: Speaker;
        if (tag === '[JUEZ]:') speaker = Speaker.JUEZ;
        else if (tag === '[MINISTERIO PÚBLICO]:') speaker = Speaker.MINISTERIO_PUBLICO;
        else if (tag === '[DEFENSA]:') speaker = Speaker.DEFENSA;
        else if (tag === '[SECRETARIO]:') speaker = Speaker.SECRETARIO;
        else speaker = Speaker.TESTIGO;
        messages.push({ speaker, text: '', id: crypto.randomUUID() });
        i++;
        continue;
      };
      if (!content) continue;

      let speaker: Speaker | undefined;
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
        messages[messages.length - 1].text += tag;
      } else if (tag) {
        // Handles text before the first tag, attributing it to the first speaker.
        const firstMessageMatch = text.match(/(\[JUEZ\]:|\[MINISTERIO PÚBLICO\]:|\[DEFENSA\]:|\[TESTIGO\]:|\[SECRETARIO\]:)/);
        if (firstMessageMatch) {
          const firstTag = firstMessageMatch[1].trim();
          let firstSpeaker: Speaker = Speaker.JUEZ;
          if (firstTag === '[MINISTERIO PÚBLICO]:') firstSpeaker = Speaker.MINISTERIO_PUBLICO;
          if (firstTag === '[DEFENSA]:') firstSpeaker = Speaker.DEFENSA;
          if (firstTag === '[TESTIGO]:') firstSpeaker = Speaker.TESTIGO;
          if (firstTag === '[SECRETARIO]:') firstSpeaker = Speaker.SECRETARIO;
          messages.push({ speaker: firstSpeaker, text: tag, id: crypto.randomUUID() })
        }
      }
    }
    return messages;
  };

  const processAIStream = async (streamPromise: Promise<AsyncGenerator<GenerateContentResponse>>, isUserMessage: boolean = true) => {
    if (!chatSessionRef.current) return;

    historyLengthBeforeLoadingRef.current = isUserMessage ? chatHistory.length + 1 : chatHistory.length;
    setIsLoading(true);
    setCurrentTurn(null);

    const userMessageIndex = isUserMessage ? chatHistory.length : chatHistory.length - 1;

    try {
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("Timeout waiting for AI response")), 45000)
      );

      const stream = await Promise.race([streamPromise, timeoutPromise]);
      let accumulatedText = '';
      let hasParsedContent = false;

      for await (const chunk of stream) {
        if (chunk.text) {
          accumulatedText += chunk.text;

          const { cleanText, detectedStage } = parseTurnAndCleanText(accumulatedText);

          if (detectedStage) {
            setCurrentStageName(detectedStage.replace(/\*/g, ''));
          }

          const newMessages = parseAIResponse(cleanText.replace('[PAUSA_PARA_OBJECION]', ''));

          if (newMessages.length > 0) {
            hasParsedContent = true;
          }

          setChatHistory(prevHistory => {
            const baseHistory = prevHistory.slice(0, userMessageIndex + 1);
            return [...baseHistory, ...newMessages];
          });
        }
      }

      // FAIL-SAFE: Ensure content was parsed
      if (!hasParsedContent && accumulatedText.trim().length > 0) {
        console.warn("[App] AI responded but no tags found. Injecting fallback.");
        const fallbackMessage = { speaker: Speaker.JUEZ, text: accumulatedText, id: crypto.randomUUID() };
        setChatHistory(prev => {
          const baseHistory = prev.slice(0, userMessageIndex + 1);
          return [...baseHistory, fallbackMessage];
        });
        hasParsedContent = true;
      }

      // FAIL-SAFE: If still no content, inject error message
      if (!hasParsedContent) {
        console.error("[App] AI response was empty or unparseable");
        setChatHistory(prev => [...prev, {
          speaker: Speaker.JUEZ,
          text: "[Error del sistema: La IA no generó una respuesta válida. Por favor, reformule su intervención.]",
          id: crypto.randomUUID()
        }]);
      }

      if (accumulatedText.includes('[PAUSA_PARA_OBJECION]')) {
        setIsObjectionPhase(true);
        setShowObjectionOptions(false);
        setCurrentTurn(null);
      } else {
        const { nextTurn } = parseTurnAndCleanText(accumulatedText);

        if (accumulatedText.trim().toUpperCase().endsWith('FIN DE LA SIMULACIÓN')) {
          setSimulationState(SimulationState.ENDED);
          return;
        }

        // TURN RESOLUTION: Always resolve to a valid turn
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
      }

    } catch (error) {
      console.error("[App] Error in AI stream:", error);
      let errorMsg = "Ocurrió un error al procesar la respuesta.";

      if (error instanceof Error && error.message.includes("Timeout")) {
        errorMsg = "La IA está tomando más tiempo de lo esperado. Por favor, intenta de nuevo o espera un momento.";
      }

      setChatHistory(prev => [...prev, { speaker: Speaker.JUEZ, text: errorMsg, id: crypto.randomUUID() }]);

      // CRITICAL FIX: Unlock user turn on error so app doesn't freeze
      setCurrentTurn(simulationConfig?.userRole || Speaker.DEFENSA);

    } finally {
      setIsLoading(false);
    }
  };

  const sendSystemMessage = async (message: string) => {
    if (!chatSessionRef.current) return;
    const streamPromise = continueChat(chatSessionRef.current, message, chatHistory);
    await processAIStream(streamPromise, false);
  };

  const submitMessage = async () => {
    unlockAudio(); // Unlock audio on message send (Enter or Click)
    if (isListening) {
      stopListening();
    }
    const trimmedInput = userInput.trim();
    if (!trimmedInput) return;

    stopSpeech();
    audioService.clearReplayBuffer(); // FIX: Clear replay buffer on new user turn so replay button works correctly for next AI turn

    // CHECK FOR META-PROCEDURAL QUESTION (PROFESSOR MODE)
    // Pattern: Starts with [ and ends with ]
    const isMetaQuestion = trimmedInput.startsWith('[') && trimmedInput.endsWith(']');

    if (isMetaQuestion) {
      // Keep brackets in display to differentiate visually in history.
      const userMessage: ChatMessageType = { speaker: simulationConfig?.userRole || Speaker.DEFENSA, text: trimmedInput, id: crypto.randomUUID() };

      // Set the ref to the index *after* this user message will be added.
      historyLengthBeforeLoadingRef.current = chatHistory.length + 1;

      setChatHistory(prev => [...prev, userMessage]);
      setUserInput('');
      setIsLoading(true);

      // Don't change currentTurn, the trial is effectively paused/frozen
      // Don't send to chatSessionRef (Trial AI)

      try {
        // Import askProfessor dynamically or rely on module import
        const { askProfessor } = await import('./services/geminiService');

        const cleanQuestion = trimmedInput.slice(1, -1).trim();
        const responseText = await askProfessor(cleanQuestion, chatHistory, simulationConfig);

        const professorMessage: ChatMessageType = { speaker: Speaker.PROFESOR, text: responseText, id: crypto.randomUUID() };
        setChatHistory(prev => [...prev, professorMessage]);

        // NOTE: We do NOT trigger speakMessagesSequentially for Professor messages
        // based on the update in speakMessagesSequentially function.

      } catch (error) {
        console.error("Error consultando al profesor:", error);
        setChatHistory(prev => [...prev, { speaker: Speaker.PROFESOR, text: "Hubo un error al procesar tu duda. Intenta de nuevo.", id: crypto.randomUUID() }]);
      } finally {
        setIsLoading(false);
      }
      return; // EXIT EARLY: Do not continue to normal trial logic
    }

    // NORMAL TRIAL FLOW
    if (!chatSessionRef.current) return;

    const userMessage: ChatMessageType = { speaker: simulationConfig?.userRole || Speaker.DEFENSA, text: userInput, id: crypto.randomUUID() };
    setChatHistory(prev => [...prev, userMessage]);
    setUserInput('');

    const streamPromise = continueChat(chatSessionRef.current, userInput, chatHistory);
    await processAIStream(streamPromise);
  };

  const handleNoObjection = () => {
    stopSpeech();
    setIsObjectionPhase(false);
    setShowObjectionOptions(false);
    sendSystemMessage("Sin objeción");
  };

  const handleMakeObjection = () => {
    setShowObjectionOptions(true);
  };

  const handleSelectObjection = (objectionType: string) => {
    setIsObjectionPhase(false);
    setShowObjectionOptions(false);

    if (!chatSessionRef.current || !simulationConfig) return;

    const objectionMessageText = `objeción: ${objectionType.toLowerCase()}`;

    const userMessage: ChatMessageType = {
      speaker: simulationConfig.userRole,
      text: objectionMessageText,
      id: crypto.randomUUID()
    };
    setChatHistory(prev => [...prev, userMessage]);

    stopSpeech();

    const streamPromise = continueChat(
      chatSessionRef.current,
      objectionMessageText,
      chatHistory
    );
    processAIStream(streamPromise);
  };

  const handleSendMessage = (e: React.FormEvent) => {
    e.preventDefault();
    submitMessage();
  };

  const handleTextareaKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submitMessage();
    }
  };


  const handleEvaluation = async () => {
    stopSpeech();
    if (isListening) {
      stopListening();
    }
    if (!simulationConfig) {
      console.error("No se encontró la configuración de la simulación para la evaluación.");
      return;
    }

    // Check if audio is still playing
    const queueStatus = audioService.getQueueStatus();
    if (queueStatus.isActive) {
      console.log('[App] Waiting for audio queue to complete before evaluation...');
      setIsWaitingForAudio(true);

      // Wait for all audio to complete
      await audioService.waitForQueueCompletion();

      setIsWaitingForAudio(false);
      console.log('[App] Audio queue completed, proceeding with evaluation');
    }

    historyLengthBeforeLoadingRef.current = chatHistory.length;
    setIsLoading(true);
    setSimulationState(SimulationState.EVALUATION);

    // IMPORTANT: Filter out Professor/Meta messages from the transcript sent to evaluation
    // We only want to evaluate the actual trial performance.
    const trialMessages = chatHistory.filter(msg => {
      const isProfessor = msg.speaker === Speaker.PROFESOR;
      const isMetaQuestion = msg.text.trim().startsWith('[') && msg.text.trim().endsWith(']');
      return !isProfessor && !isMetaQuestion;
    });

    const transcript = trialMessages
      .map(m => `[${m.speaker}]: ${m.text}`)
      .join('\n');

    try {
      const evalResult = await getEvaluation(transcript, simulationConfig.userRole, simulationConfig);
      setEvaluation(evalResult);
      setSimulationState(SimulationState.FINISHED);
    } catch (error) {
      console.error("Error al obtener la evaluación:", error);
      // Display error in a user-friendly way
    } finally {
      setIsLoading(false);
    }
  };

  // FIX: Mute now uses AudioService.setMuted() to preserve queue and position
  // Instead of cancelling all audio, we just silence the output
  const handleMuteToggle = () => {
    setIsTtsEnabled(prev => {
      const newState = !prev;
      audioService.setMuted(!newState); // muted = !ttsEnabled
      return newState;
    });
  };

  const handlePauseResumeClick = () => {
    // AudioService handle
    if (isSpeechPaused) {
      audioService.resume();
      setIsSpeechPaused(false);
    } else {
      audioService.pause();
      setIsSpeechPaused(true);
    }
  };

  // FIX: Skip only the current audio, don't cancel entire queue
  const handleSkipCurrent = () => {
    audioService.skipCurrent();
  };

  const handleReplayClick = () => {
    // FIX: Replay only the buffer of the last turn
    audioService.replayLastTurn();
  };

  const handleResumeAudioContext = () => {
    audioService.unlockAudio();
    setIsAudioSuspended(false);
  };

  // FIX: Compute unified turn state for input control
  // This is the SINGLE SOURCE OF TRUTH for whether user can interact
  const computedTurnState = turnManagerRef.current?.computeTurnState(
    currentTurn,
    isLoading,
    isSpeaking,
    isObjectionPhase
  ) || TurnState.AI_TURN;

  const canUserInteract = computedTurnState === TurnState.USER_TURN;

  const renderContent = () => {
    switch (simulationState) {
      case SimulationState.INITIAL:
        return <SimulationSetup onStart={handleStartSimulation} />;

      case SimulationState.LOADING:
        return (
          <div className="h-full flex flex-col items-center justify-center p-8 text-center">
            <h2 className="text-2xl font-bold text-slate-700">Iniciando Simulación...</h2>
            <p className="text-slate-500 mt-2">{loadingMessage}</p>
            <div className="mt-6">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[#00afc7] mx-auto"></div>
            </div>
          </div>
        );

      case SimulationState.STARTED:
      case SimulationState.ENDED: // Included ENDED state here to keep chat visible
      case SimulationState.EVALUATION:
      case SimulationState.FINISHED:
        return (
          <div className="flex flex-col h-full max-w-6xl mx-auto bg-white/70 backdrop-blur-md sm:rounded-xl sm:shadow-2xl sm:border border-slate-200/50 overflow-hidden rounded-none shadow-none border-none">
            <header className="bg-slate-100/50 py-1 px-2 sm:p-4 border-b border-slate-200 flex items-center justify-between gap-2">
              <div className="flex-0 sm:flex-1">
                <img src="https://i.ibb.co/Pzj3VNw3/logo2.png" alt="TribunAi Logo" className="hidden sm:block h-14 w-auto opacity-85" />
              </div>

              <div className="flex-1 text-center min-w-0 flex flex-col justify-center gap-0.5 sm:gap-0">
                <h1 className="text-xs sm:text-xl font-bold text-slate-800 leading-none sm:leading-tight">Simulador de Juicio Oral</h1>
                <h2 className="text-[10px] sm:text-sm font-semibold text-slate-600 leading-none truncate sm:whitespace-normal sm:leading-normal">
                  {`${simulationConfig?.stage} - ${currentStageName || simulationConfig?.subStage}`}
                </h2>
              </div>

              {/* ALERT: Audio Suspended (Visible on Mobile & Desktop) */}
              {isAudioSuspended && (
                <button
                  onClick={handleResumeAudioContext}
                  className="absolute top-14 left-1/2 -translate-x-1/2 z-50 px-4 py-2 bg-red-500 text-white text-xs font-bold rounded-full shadow-lg animate-bounce flex items-center gap-2"
                >
                  <span>🔇</span> Toca para activar audio
                </button>
              )}

              <div className="flex-0 sm:flex-1 flex justify-end">
                {/* DESKTOP ONLY: Audio Controls in Header */}
                <div className="hidden sm:flex flex-col items-center">
                  <span className="text-xs font-semibold text-slate-500 mb-1">Controles de audio</span>
                  <div className="flex items-center gap-2">
                    {/* Button moved to main header area for mobile visibility */}

                    <button
                      type="button"
                      onClick={handleMuteToggle}
                      className="p-2 sm:p-3 rounded-lg transition-colors bg-slate-200 text-slate-700 hover:bg-slate-300"
                      aria-label={isTtsEnabled ? 'Silenciar' : 'Activar voz'}
                    >
                      {isTtsEnabled ? <SpeakerOnIcon className="w-5 h-5" /> : <SpeakerOffIcon className="w-5 h-5" />}
                    </button>
                    <button
                      type="button"
                      onClick={handlePauseResumeClick}
                      className="p-2 sm:p-3 rounded-lg transition-colors bg-slate-200 text-slate-700 hover:bg-slate-300 disabled:bg-slate-100 disabled:text-slate-400 disabled:cursor-not-allowed"
                      disabled={!isSpeaking}
                      aria-label={isSpeechPaused ? 'Reanudar audio' : 'Pausar audio'}
                    >
                      {isSpeechPaused ? <PlayIcon className="w-5 h-5" /> : <PauseIcon className="w-5 h-5" />}
                    </button>
                    <button
                      type="button"
                      onClick={handleSkipCurrent}
                      className="p-2 sm:p-3 rounded-lg transition-colors bg-slate-200 text-slate-700 hover:bg-slate-300 disabled:bg-slate-100 disabled:text-slate-400 disabled:cursor-not-allowed"
                      disabled={!isSpeaking}
                      aria-label="Omitir audio actual"
                    >
                      <SkipIcon className="w-5 h-5" />
                    </button>
                  </div>
                </div>
              </div>
            </header>

            {contextSummary && (
              <details className="border-b border-slate-200 bg-amber-50/50">
                <summary className="p-3 cursor-pointer hover:bg-amber-100/60 flex justify-between items-center">
                  <h3 className="font-bold text-amber-800 text-sm">Contexto del Juicio</h3>
                  <svg className="w-5 h-5 text-amber-700 summary-arrow" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
                  </svg>
                </summary>
                <div className="p-4 bg-amber-50 border-t border-amber-200 max-h-96 overflow-y-auto">
                  <p className="text-sm text-amber-900 mt-1 whitespace-pre-wrap">{contextSummary.replace(/\*/g, '')}</p>
                </div>
              </details>
            )}

            <div className="flex-1 p-2 sm:p-6 overflow-y-auto scroll-smooth">
              {simulationState === SimulationState.FINISHED && evaluation ? (
                <EvaluationDisplay
                  evaluation={evaluation}
                  userName={userName}
                  config={simulationConfig}
                  chatHistory={chatHistory}
                />
              ) : (
                <div className="space-y-6">
                  {chatHistory.map((msg, index) => (
                    <ChatMessage
                      key={msg.id || index}
                      message={msg}
                      userRole={simulationConfig?.userRole || Speaker.DEFENSA}
                      isActive={activeMessageId === msg.id && !!msg.id}
                    />
                  ))}
                  {isLoading && (simulationState === SimulationState.STARTED || simulationState === SimulationState.ENDED) && (
                    <div className="flex justify-start">
                      <div className="flex items-center space-x-2">
                        <div className="w-2 h-2 bg-slate-400 rounded-full animate-pulse"></div>
                        <div className="w-2 h-2 bg-slate-400 rounded-full animate-pulse animation-delay-200"></div>
                        <div className="w-2 h-2 bg-slate-400 rounded-full animate-pulse animation-delay-400"></div>
                      </div>
                    </div>
                  )}
                  <div ref={chatEndRef} />
                </div>
              )}
            </div>

            {simulationState === SimulationState.EVALUATION && (
              <div className="text-center p-8">
                <h2 className="text-2xl font-bold text-slate-700">Generando Evaluación...</h2>
                <p className="text-slate-500 mt-2">Analizando la transcripción para calificar su desempeño.</p>
                <div className="mt-6">
                  <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[#00afc7] mx-auto"></div>
                </div>
              </div>
            )}

            <footer className="p-4 bg-slate-100/50 border-t border-slate-200">
              <div className="w-full max-w-6xl mx-auto flex flex-col gap-3">
                {simulationState === SimulationState.STARTED || simulationState === SimulationState.ENDED ? (
                  <>
                    {isObjectionPhase ? (
                      <div className="w-full">
                        {showObjectionOptions ? (
                          <div className='animate-fade-in'>
                            <p className="text-center text-sm font-bold text-slate-700 mb-2">Seleccione el tipo de objeción:</p>
                            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2 max-h-48 overflow-y-auto p-2 bg-slate-50 rounded-lg border">
                              {OBJECTION_TYPES.map(type => (
                                <button
                                  key={type}
                                  onClick={() => handleSelectObjection(type)}
                                  className="w-full text-center bg-white border border-slate-300 text-slate-700 text-sm font-medium p-2 rounded-md hover:bg-[#00afc7] hover:text-white hover:border-[#00afc7] transition-colors"
                                >
                                  {type}
                                </button>
                              ))}
                              <button
                                onClick={handleNoObjection}
                                className="w-full text-center bg-slate-200 border border-slate-300 text-slate-700 text-sm font-medium p-2 rounded-md hover:bg-slate-300 transition-colors"
                              >
                                Cancelar
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div className="w-full flex flex-col sm:flex-row items-center justify-center gap-3 animate-fade-in">
                            <p className="text-center font-semibold text-slate-700">La contraparte ha formulado una pregunta. ¿Desea objetar?</p>
                            <div className="flex gap-3">
                              <button onClick={handleNoObjection} className="bg-slate-200 text-slate-800 font-bold py-3 px-6 rounded-lg hover:bg-slate-300 transition-colors">Sin Objeción</button>
                              <button onClick={handleMakeObjection} className="bg-rose-600 text-white font-bold py-3 px-6 rounded-lg hover:bg-rose-700 transition-colors">Hacer Objeción</button>
                            </div>
                          </div>
                        )}
                      </div>
                    ) : simulationState === SimulationState.ENDED ? (
                      <div className="flex-1 text-center text-slate-500 font-medium italic flex items-center justify-center h-[50px] bg-slate-50 rounded-lg border border-slate-200">
                        La audiencia ha concluido. Revise la sentencia final.
                      </div>
                    ) : (
                      <>
                        {/* MOBILE ONLY: Toolbar with Audio & Input Controls */}
                        <div className="flex sm:hidden items-center justify-between bg-white/50 p-2 rounded-lg border border-slate-200 shadow-sm">

                          {/* Audio Controls Group */}
                          <div className="flex items-center gap-1">
                            <button
                              onClick={handleMuteToggle}
                              className="p-2 rounded-md hover:bg-slate-200 text-slate-600"
                              aria-label={isTtsEnabled ? 'Silenciar' : 'Activar voz'}
                            >
                              {isTtsEnabled ? <SpeakerOnIcon className="w-5 h-5" /> : <SpeakerOffIcon className="w-5 h-5" />}
                            </button>
                            <button
                              onClick={handlePauseResumeClick}
                              disabled={!isSpeaking}
                              className="p-2 rounded-md hover:bg-slate-200 text-slate-600 disabled:opacity-30 disabled:cursor-not-allowed"
                              aria-label={isSpeechPaused ? 'Reanudar audio' : 'Pausar audio'}
                            >
                              {isSpeechPaused ? <PlayIcon className="w-5 h-5" /> : <PauseIcon className="w-5 h-5" />}
                            </button>
                            <button
                              onClick={handleSkipCurrent}
                              disabled={!isSpeaking}
                              className="p-2 rounded-md hover:bg-slate-200 text-slate-600 disabled:opacity-30 disabled:cursor-not-allowed"
                              aria-label="Omitir audio actual"
                            >
                              <SkipIcon className="w-5 h-5" />
                            </button>
                          </div>

                          {/* Input Controls Group */}
                          <div className="flex items-center gap-2">
                            <button
                              onClick={handleListen}
                              disabled={!canUserInteract}
                              className={`p-2 rounded-md transition-colors ${isListening ? 'bg-rose-600 text-white animate-pulse' : 'bg-slate-200 text-slate-700 hover:bg-slate-300 disabled:opacity-50 disabled:cursor-not-allowed'}`}
                              aria-label={isListening ? 'Detener dictado' : 'Iniciar dictado'}
                            >
                              <MicrophoneIcon className="w-5 h-5" />
                            </button>
                            <button
                              onClick={submitMessage}
                              disabled={!canUserInteract}
                              className="bg-[#00afc7] text-white text-sm font-bold py-2 px-4 rounded-md hover:bg-[#009ab0] transition-colors disabled:bg-slate-300 disabled:cursor-not-allowed shadow-sm"
                            >
                              Enviar
                            </button>
                          </div>
                        </div>

                        {/* MAIN INPUT CONTAINER (Shared Textarea, Desktop Buttons) */}
                        <div className="flex flex-col sm:flex-row items-end gap-2 w-full">
                          {canUserInteract ? (
                            <textarea
                              ref={textareaRef}
                              rows={1}
                              value={userInput}
                              onChange={(e) => setUserInput(e.target.value)}
                              onKeyDown={handleTextareaKeyDown}
                              placeholder="Escriba su argumento..."
                              className={`w-full sm:flex-1 p-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-[#00afc7] focus:outline-none transition-shadow bg-white text-base sm:text-sm text-slate-800 placeholder-slate-500 resize-none overflow-y-auto max-h-40 shadow-inner`}
                              disabled={!canUserInteract}
                            />
                          ) : (
                            <div className="w-full sm:flex-1 p-3 border border-slate-200 rounded-lg bg-slate-50 text-slate-500 text-sm text-center italic animate-pulse">
                              {isLoading ? 'Procesando...' : isSpeaking ? `Escuchando a: ${currentTurn || 'IA'}` : `Turno de: ${currentTurn || '...'}`}
                            </div>
                          )}

                          {/* DESKTOP ONLY: Controls next to textarea */}
                          <div className="hidden sm:flex items-center gap-2">
                            <button
                              onClick={handleListen}
                              disabled={!canUserInteract}
                              className={`p-3 rounded-lg transition-colors flex-shrink-0 ${isListening ? 'bg-rose-600 text-white animate-pulse' : 'bg-slate-200 text-slate-700 hover:bg-slate-300 disabled:opacity-50 disabled:cursor-not-allowed'}`}
                              aria-label={isListening ? 'Detener dictado' : 'Iniciar dictado'}
                            >
                              <MicrophoneIcon className="w-6 h-6" />
                            </button>
                            <button
                              onClick={submitMessage}
                              disabled={!canUserInteract}
                              className="bg-[#00afc7] text-white font-bold py-3 px-6 rounded-lg hover:bg-[#009ab0] transition-colors disabled:bg-slate-300 disabled:cursor-not-allowed shadow-sm"
                            >
                              Enviar
                            </button>

                            {!isObjectionPhase && (
                              <button
                                onClick={handleEvaluation}
                                className={`bg-rose-600 hover:bg-rose-700 text-white font-bold py-3 px-4 rounded-lg transition-all duration-300 disabled:bg-slate-400 disabled:cursor-not-allowed flex-shrink-0 shadow-md ${isWaitingForAudio ? 'opacity-75' : ''}`}
                                disabled={isLoading || isWaitingForAudio}
                              >
                                {isWaitingForAudio ? 'Esperando audio...' : 'Finalizar'}
                              </button>
                            )}
                          </div>
                        </div>
                      </>
                    )}

                    {/* MOBILE ONLY: Finalizar button at bottom */}
                    {!isObjectionPhase && simulationState !== SimulationState.ENDED && (
                      <button
                        onClick={handleEvaluation}
                        className={`sm:hidden w-full bg-rose-600 hover:bg-rose-700 text-white font-bold py-3 px-4 rounded-lg transition-all duration-300 disabled:bg-slate-400 disabled:cursor-not-allowed flex-shrink-0 shadow-md ${isWaitingForAudio ? 'opacity-75' : ''}`}
                        disabled={isLoading || isWaitingForAudio}
                      >
                        {isWaitingForAudio ? 'Esperando audio...' : 'Finalizar y Evaluar'}
                      </button>
                    )}
                    {/* MOBILE ONLY: View Eval button when ended */}
                    {!isObjectionPhase && simulationState === SimulationState.ENDED && (
                      <button
                        onClick={handleEvaluation}
                        className={`sm:hidden w-full bg-[#00afc7] hover:bg-[#009ab0] shadow-lg shadow-[#00afc7]/30 text-white font-bold py-3 px-4 rounded-lg transition-all duration-300 disabled:bg-slate-400 disabled:cursor-not-allowed flex-shrink-0`}
                        disabled={isLoading}
                      >
                        Ver Evaluación
                      </button>
                    )}
                  </>
                ) : (
                  <div className="flex-1 text-center">
                    <button
                      onClick={resetSimulation}
                      className="bg-slate-500 hover:bg-slate-600 text-white font-bold py-2 px-6 rounded-lg transition-colors"
                    >
                      Iniciar Nueva Simulación
                    </button>
                  </div>
                )}
              </div>
              <div className="mt-4 text-center text-xs text-slate-500">
                <p>Esta es una simulación ficticia con fines educativos</p>
                <p>TribunAI 2025 todos los derechos reservados</p>
              </div>
            </footer>
          </div>
        );

      default:
        return <div>Estado desconocido.</div>;
    }
  };

  return (
    <main className={`bg-[#f5f2e9] p-0 sm:p-8 flex flex-col sm:items-center sm:justify-center ${simulationState === SimulationState.INITIAL ? 'min-h-dvh overflow-y-auto' : 'h-dvh overflow-hidden'}`}>
      {/* Use Dynamic Viewport Height (dvh) to handle mobile keyboards and address bars better */}
      <div className={`w-full transition-all duration-300 ${simulationState === SimulationState.INITIAL ? 'flex items-center justify-center p-4 sm:p-0 my-auto' : 'h-full sm:h-[90dvh] sm:max-h-[1024px]'}`}>
        {renderContent()}
      </div>
    </main>
  );
};

export default App;
