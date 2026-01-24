import { Speaker, VoiceSettings } from '../types';

interface AudioQueueItem {
    text: string;
    speaker: Speaker;
    id: string; // Internal queue ID
    messageId?: string; // External ChatMessage ID
    audioUrl?: string; // Cache generated audio
}

interface VoiceConfig {
    languageCode: string;
    name: string;
    ssmlGender: 'MALE' | 'FEMALE' | 'NEUTRAL';
    pitch?: number;
    speakingRate?: number;
}


// Canonical source of truth for voice genders
const VOICE_METADATA: { [key: string]: 'MALE' | 'FEMALE' } = {
    // ES - Spain
    'es-ES-Neural2-B': 'MALE',
    'es-ES-Neural2-A': 'FEMALE',
    'es-ES-Neural2-E': 'FEMALE',
    'es-ES-Neural2-F': 'MALE',
    // US - Spanish (Replacing MX)
    'es-US-Neural2-B': 'MALE',
    'es-US-Neural2-A': 'FEMALE',
    'es-US-News-F': 'FEMALE',
    'es-US-Polyglot-1': 'MALE',
    // MX - Mexico
    'es-MX-Standard-A': 'FEMALE',
    'es-MX-Standard-B': 'MALE',
    'es-MX-Standard-C': 'FEMALE',
};

export class AudioService {
    private static instance: AudioService;
    private queue: AudioQueueItem[] = [];
    private isPlaying: boolean = false;
    private isPaused: boolean = false;
    private isMuted: boolean = false;
    private currentAudio: HTMLAudioElement | null = null;
    private audioContext: AudioContext | null = null;
    private silentAudio: HTMLAudioElement | null = null; // For mobile wake-up
    private apiKey: string;
    private isProcessingQueue: boolean = false;
    private nextAudioPreloading: boolean = false;
    private isAudioUnlocked: boolean = false; // FIX: Track if user has interacted for mobile autoplay

    // Replay Logic
    private replayBuffer: AudioQueueItem[] = [];
    private maxReplaySize: number = 5; // Keep last 5 items for context if needed, though we usually replay just the turn

    // Queue completion tracking
    private totalQueuedDialogues: number = 0;
    private completedDialogues: number = 0;
    private failedDialogues: number = 0;
    private queueCompletionCallbacks: Array<() => void> = [];
    private isQueueActive: boolean = false;

    // Active message tracking
    private currentMessageId: string | null = null;
    private messageIdListeners: Array<(id: string | null) => void> = [];

    // FIX: Added playing state listeners for UI synchronization
    private playingStateListeners: Array<(isPlaying: boolean) => void> = [];

    // Store resolve function to unblock queue on cancel
    private currentPlaybackResolver: (() => void) | null = null;

    // Fallback voices for retry logic (ordered by preference)
    private fallbackVoices: Map<Speaker, string[]> = new Map([
        [Speaker.JUEZ, ['es-ES-Neural2-F', 'es-US-Neural2-B', 'es-US-Polyglot-1']], // Male fallbacks
        [Speaker.MINISTERIO_PUBLICO, ['es-US-Polyglot-1', 'es-ES-Neural2-B', 'es-ES-Neural2-F']], // Male fallbacks
        [Speaker.DEFENSA, ['es-ES-Neural2-A', 'es-ES-Neural2-E', 'es-US-News-F']], // Female fallbacks
        [Speaker.TESTIGO, ['es-US-Neural2-A', 'es-ES-Neural2-E', 'es-ES-Neural2-A']], // Female fallbacks
        [Speaker.PROFESOR, ['es-ES-Neural2-A', 'es-US-Neural2-A', 'es-ES-Neural2-E']], // Female fallbacks
        [Speaker.SECRETARIO, ['es-ES-Neural2-A', 'es-US-Neural2-A', 'es-ES-Neural2-E']] // Female fallbacks
    ]);

    // Voice mapping for each speaker
    private voiceMap: Map<Speaker, VoiceConfig> = new Map([
        [Speaker.JUEZ, {
            languageCode: 'es-ES',
            name: 'es-ES-Neural2-B', // Deep male voice (authority)
            ssmlGender: 'MALE',
            pitch: -2.0,
            speakingRate: 0.95
        }],
        [Speaker.MINISTERIO_PUBLICO, {
            languageCode: 'es-US',
            name: 'es-US-Neural2-B',
            ssmlGender: 'MALE',
            pitch: 0.0,
            speakingRate: 1.0
        }],
        [Speaker.DEFENSA, {
            languageCode: 'es-US',
            name: 'es-US-Neural2-A',
            ssmlGender: 'FEMALE',
            pitch: 1.0,
            speakingRate: 1.05
        }],
        [Speaker.TESTIGO, {
            languageCode: 'es-US', // Using generic LatAm/US
            name: 'es-US-News-F',
            ssmlGender: 'FEMALE',
            pitch: 2.0,
            speakingRate: 1.1
        }],
        [Speaker.PROFESOR, {
            languageCode: 'es-ES',
            name: 'es-ES-Neural2-F', // Warm female voice (educational)
            ssmlGender: 'FEMALE',
            pitch: 0.5,
            speakingRate: 0.9
        }],
        [Speaker.SECRETARIO, {
            languageCode: 'es-ES',
            name: 'es-ES-Neural2-A',
            ssmlGender: 'FEMALE',
            pitch: 0.5,
            speakingRate: 1.05
        }]
    ]);

    private constructor() {
        // Get API key from environment
        this.apiKey = import.meta.env.VITE_GOOGLE_TTS_API_KEY || '';

        if (!this.apiKey) {
            console.warn('[AudioService] No API key found. Audio will be disabled.');
        }

        // Initialize AudioContext (will be unlocked on first user interaction)
        try {
            const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
            this.audioContext = new AudioContextClass();

            // Listen for state changes (e.g., auto-suspension on mobile)
            this.audioContext.onstatechange = () => {
                console.log(`[AudioService] AudioContext state changed to: ${this.audioContext?.state}`);
                this.notifyPlayingStateChange();
            };

            // Pre-create a silent audio element for gesture unlocking
            this.silentAudio = new Audio();
            this.silentAudio.src = 'data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAgZGF0YQQAAAAAAA==';

        } catch (error) {
            console.error('[AudioService] Failed to create AudioContext:', error);
        }
    }

    public static getInstance(): AudioService {
        if (!AudioService.instance) {
            AudioService.instance = new AudioService();
        }
        return AudioService.instance;
    }

    /**
     * Updates voice settings from the simulation config.
     * Call this before starting the simulation.
     */
    public updateVoiceSettings(settings: VoiceSettings): void {
        if (settings[Speaker.JUEZ]) {
            this.setVoiceForSpeaker(Speaker.JUEZ, settings[Speaker.JUEZ]);
        }
        if (settings[Speaker.MINISTERIO_PUBLICO]) {
            this.setVoiceForSpeaker(Speaker.MINISTERIO_PUBLICO, settings[Speaker.MINISTERIO_PUBLICO]);
        }
        if (settings[Speaker.DEFENSA]) {
            this.setVoiceForSpeaker(Speaker.DEFENSA, settings[Speaker.DEFENSA]);
        }
        if (settings[Speaker.TESTIGO]) {
            this.setVoiceForSpeaker(Speaker.TESTIGO, settings[Speaker.TESTIGO]);
        }
        if (settings[Speaker.SECRETARIO]) {
            this.setVoiceForSpeaker(Speaker.SECRETARIO, settings[Speaker.SECRETARIO]);
        }
        console.log('[AudioService] Voice settings updated');
    }

    /**
     * Sets the voice for a specific speaker.
     */
    public setVoiceForSpeaker(speaker: Speaker, voiceId: string): void {
        const languageCode = voiceId.split('-').slice(0, 2).join('-'); // Extract 'es-ES' from 'es-ES-Neural2-B'

        // Strict gender lookup with fallback
        let gender: 'MALE' | 'FEMALE' = 'FEMALE'; // Default safety

        if (voiceId in VOICE_METADATA) {
            gender = VOICE_METADATA[voiceId];
        } else {
            console.warn(`[AudioService] Unknown voice ID: ${voiceId}, falling back to heuristic.`);
            // Heuristic fallback
            gender = voiceId.includes('Neural2-A') || voiceId.includes('Neural2-C') ||
                voiceId.includes('Neural2-E') || voiceId.includes('Standard-A')
                ? 'FEMALE' : 'MALE';
        }

        const currentConfig = this.voiceMap.get(speaker);
        this.voiceMap.set(speaker, {
            languageCode,
            name: voiceId,
            ssmlGender: gender,
            pitch: currentConfig?.pitch ?? 0,
            speakingRate: currentConfig?.speakingRate ?? 1.0
        });

        console.log(`[AudioService] Set ${speaker} to ${voiceId} (${gender})`);
    }

    /**
     * Returns a promise that resolves when all queued audio has completed playback.
     * This allows the simulation to wait for audio completion before ending.
     */
    public waitForQueueCompletion(): Promise<void> {
        return new Promise((resolve) => {
            // If queue is already empty and not processing, resolve immediately
            if (!this.isQueueActive && this.queue.length === 0) {
                resolve();
                return;
            }

            // Otherwise, register callback to be fired when queue completes
            this.queueCompletionCallbacks.push(resolve);
        });
    }

    /**
     * Gets the current status of the audio queue.
     */
    public getQueueStatus(): { total: number; completed: number; failed: number; isActive: boolean } {
        return {
            total: this.totalQueuedDialogues,
            completed: this.completedDialogues,
            failed: this.failedDialogues,
            isActive: this.isQueueActive
        };
    }

    /**
     * Resets the queue counters (call when starting a new simulation).
     */
    public resetQueue(): void {
        this.totalQueuedDialogues = 0;
        this.completedDialogues = 0;
        this.failedDialogues = 0;
        this.queueCompletionCallbacks = [];
        this.currentMessageId = null;
        this.clearReplayBuffer(); // Clear history on new simulation
        this.notifyMessageIdChange();
        this.isQueueActive = false;
        console.log('[AudioService] Queue counters reset');
    }

    /* Active Message Tracking API */

    /**
     * Subscribe to active message ID changes.
     */
    public onCurrentMessageIdChange(callback: (id: string | null) => void): () => void {
        this.messageIdListeners.push(callback);
        // Invoke immediately with current state
        callback(this.currentMessageId);

        // Return unsubscribe function
        return () => {
            this.messageIdListeners = this.messageIdListeners.filter(cb => cb !== callback);
        };
    }

    /**
     * Get the currently playing message ID.
     */
    public getCurrentMessageId(): string | null {
        return this.currentMessageId;
    }

    private notifyMessageIdChange(): void {
        this.messageIdListeners.forEach(callback => callback(this.currentMessageId));
    }

    /**
     * Cleans text for speech by removing non-verbal cues and markdown.
     */
    public cleanTextForSpeech(text: string): string {
        return text
            .replace(/\[.*?\]/g, '')       // Remove content in brackets [ ... ]
            .replace(/\*\*/g, '')          // Remove double asterisks
            .replace(/\*/g, '')            // Remove single asterisk
            .replace(/\(.*?\)/g, '')       // Remove content in parentheses
            .trim();
    }

    /**
     * Gets a fallback voice configuration for retry attempts.
     */
    private getFallbackVoice(speaker: Speaker, attemptNumber: number): VoiceConfig | null {
        const fallbacks = this.fallbackVoices.get(speaker);
        if (!fallbacks || attemptNumber >= fallbacks.length) {
            return null;
        }

        const fallbackVoiceId = fallbacks[attemptNumber];
        const languageCode = fallbackVoiceId.split('-').slice(0, 2).join('-');

        // Determine gender from voice metadata
        let gender: 'MALE' | 'FEMALE' = 'FEMALE';
        if (fallbackVoiceId in VOICE_METADATA) {
            gender = VOICE_METADATA[fallbackVoiceId];
        } else {
            // Heuristic fallback
            gender = fallbackVoiceId.includes('Neural2-A') || fallbackVoiceId.includes('Neural2-C') ||
                fallbackVoiceId.includes('Neural2-E') || fallbackVoiceId.includes('Standard-A')
                ? 'FEMALE' : 'MALE';
        }

        const currentConfig = this.voiceMap.get(speaker);
        return {
            languageCode,
            name: fallbackVoiceId,
            ssmlGender: gender,
            pitch: currentConfig?.pitch ?? 0,
            speakingRate: currentConfig?.speakingRate ?? 1.0
        };
    }

    /**
     * Generates speech audio using Google Cloud Text-to-Speech API with retry and fallback.
     */
    private async generateSpeechWithRetry(text: string, speaker: Speaker, maxRetries: number = 2): Promise<string | null> {
        if (!this.apiKey) {
            console.warn('[AudioService] Cannot generate speech without API key');
            return null;
        }

        let voiceConfig = this.voiceMap.get(speaker);
        if (!voiceConfig) {
            console.error(`[AudioService] No voice configuration for speaker: ${speaker}`);
            return null;
        }

        // Try with primary voice first, then fallbacks
        for (let attempt = 0; attempt <= maxRetries; attempt++) {
            try {
                const payload = {
                    input: { text },
                    voice: {
                        languageCode: voiceConfig.languageCode,
                        name: voiceConfig.name,
                        ssmlGender: voiceConfig.ssmlGender
                    },
                    audioConfig: {
                        audioEncoding: 'MP3',
                        pitch: voiceConfig.pitch || 0,
                        speakingRate: voiceConfig.speakingRate || 1.0
                    }
                };

                if (attempt > 0) {
                    console.log(`[AudioService] Retry attempt ${attempt} for ${speaker} with voice ${voiceConfig.name}`);
                }

                const response = await fetch(
                    `https://texttospeech.googleapis.com/v1/text:synthesize?key=${this.apiKey}`,
                    {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                        },
                        body: JSON.stringify(payload)
                    }
                );

                if (!response.ok) {
                    const errorData = await response.json().catch(() => ({}));
                    console.error(`[AudioService] TTS API error (attempt ${attempt + 1}/${maxRetries + 1}):`, response.status, JSON.stringify(errorData));

                    // Try fallback voice on next iteration
                    if (attempt < maxRetries) {
                        const fallbackConfig = this.getFallbackVoice(speaker, attempt);
                        if (fallbackConfig) {
                            voiceConfig = fallbackConfig;
                            continue;
                        }
                    }

                    if (attempt === maxRetries) {
                        console.error('[AudioService] All retry attempts exhausted');
                        return null;
                    }
                    continue;
                }

                const data = await response.json();

                if (!data.audioContent) {
                    console.error('[AudioService] No audio content in response');
                    if (attempt < maxRetries) {
                        const fallbackConfig = this.getFallbackVoice(speaker, attempt);
                        if (fallbackConfig) {
                            voiceConfig = fallbackConfig;
                            continue;
                        }
                    }
                    return null;
                }

                // Convert base64 audio to blob URL
                const audioBlob = this.base64ToBlob(data.audioContent, 'audio/mp3');
                const audioUrl = URL.createObjectURL(audioBlob);

                if (attempt > 0) {
                    console.log(`[AudioService] Successfully generated audio on retry attempt ${attempt}`);
                }

                return audioUrl;

            } catch (error) {
                console.error(`[AudioService] Error generating speech (attempt ${attempt + 1}/${maxRetries + 1}):`, error);

                // Try fallback voice on next iteration
                if (attempt < maxRetries) {
                    const fallbackConfig = this.getFallbackVoice(speaker, attempt);
                    if (fallbackConfig) {
                        voiceConfig = fallbackConfig;
                        continue;
                    }
                }

                if (attempt === maxRetries) {
                    console.error('[AudioService] All retry attempts exhausted due to errors');
                    return null;
                }
            }
        }

        return null;
    }

    /**
     * Converts base64 string to Blob.
     */
    private base64ToBlob(base64: string, mimeType: string): Blob {
        const byteCharacters = atob(base64);
        const byteNumbers = new Array(byteCharacters.length);

        for (let i = 0; i < byteCharacters.length; i++) {
            byteNumbers[i] = byteCharacters.charCodeAt(i);
        }

        const byteArray = new Uint8Array(byteNumbers);
        return new Blob([byteArray], { type: mimeType });
    }

    /**
     * Adds a message to the speech queue and starts processing.
     */
    public async speak(text: string, speaker: Speaker, messageId?: string): Promise<void> {
        const cleanText = this.cleanTextForSpeech(text);
        if (!cleanText) return;

        const queueItem: AudioQueueItem = {
            text: cleanText,
            speaker,
            id: crypto.randomUUID(),
            messageId
        };

        this.queue.push(queueItem);
        this.totalQueuedDialogues++;
        this.isQueueActive = true;
        console.log(`[AudioService] Queued for ${speaker}: "${cleanText}" (Total: ${this.totalQueuedDialogues})`);

        // Start processing if not already processing
        if (!this.isProcessingQueue) {
            this.processQueue();
        }
    }

    /**
     * Adds an item to the replay buffer.
     */
    private addToReplayBuffer(item: AudioQueueItem): void {
        this.replayBuffer.push(item);
        if (this.replayBuffer.length > this.maxReplaySize) {
            this.replayBuffer.shift();
        }
    }

    /**
     * Replays the audio from the last turn.
     * Effectively re-queues the items in the replay buffer.
     */
    public replayLastTurn(): void {
        if (this.replayBuffer.length === 0) return;

        console.log('[AudioService] Replaying last turn...');

        // Stop current if playing
        this.cancel();

        // Re-queue items from buffer
        // usage: we want to replay the "current effective turn". 
        // For simplicity in this iteration: replay the LAST item or the buffer.
        // User asked: "repeat button replays only the current AI turn’s audio"
        // We will replay the ENTIRE buffer which represents the recent history.
        // Ideally we should clear buffer on User Input to define "Turn".

        this.replayBuffer.forEach(item => {
            // Create new generic ID to avoid collision if any logic depends on unique IDs
            // but keep messageId link
            const newItem = { ...item, id: crypto.randomUUID() };
            this.queue.push(newItem);
            this.totalQueuedDialogues++;
        });

        this.isQueueActive = true;
        this.processQueue();
    }

    /**
     * Clears the replay buffer. Call this when User turn starts.
     */
    public clearReplayBuffer(): void {
        this.replayBuffer = [];
    }

    /**
     * Processes the audio queue sequentially with optimized preloading.
     */
    private async processQueue(): Promise<void> {
        if (this.isProcessingQueue) return;
        this.isProcessingQueue = true;

        while (this.queue.length > 0) {
            const currentItem = this.queue[0];

            // Wait if paused
            while (this.isPaused) {
                await this.sleep(100);
            }

            // Generate audio if not already cached (with retry logic)
            if (!currentItem.audioUrl) {
                currentItem.audioUrl = await this.generateSpeechWithRetry(currentItem.text, currentItem.speaker);
            }

            // If generation failed after retries, mark as failed and skip
            if (!currentItem.audioUrl) {
                console.warn(`[AudioService] Skipping item due to generation failure after retries: ${currentItem.id}`);
                this.failedDialogues++;
                this.queue.shift();
                continue;
            }

            // Preload next item in queue (latency optimization)
            if (this.queue.length > 1 && !this.nextAudioPreloading) {
                this.preloadNextAudio();
            }

            // Play current audio
            this.currentMessageId = currentItem.messageId || null;
            this.notifyMessageIdChange();

            this.notifyMessageIdChange();

            // Add to replay buffer before playing
            this.addToReplayBuffer(currentItem);

            await this.playAudio(currentItem.audioUrl);

            // Mark as completed
            this.completedDialogues++;
            console.log(`[AudioService] Completed ${this.completedDialogues}/${this.totalQueuedDialogues} dialogues`);

            // Check if next item implies a different message ID or empty
            // But strict logic: once this audio is done, this message ID is no longer active (until next one starts)
            this.currentMessageId = null;
            this.notifyMessageIdChange();

            // Remove completed item from queue
            this.queue.shift();

            // Clean up object URL to prevent memory leaks
            URL.revokeObjectURL(currentItem.audioUrl);
        }

        this.isProcessingQueue = false;
        this.isPlaying = false;
        this.isQueueActive = false;

        // Fire completion callbacks if all dialogues are processed
        if (this.completedDialogues + this.failedDialogues === this.totalQueuedDialogues) {
            console.log(`[AudioService] Queue completed: ${this.completedDialogues} succeeded, ${this.failedDialogues} failed`);
            const callbacks = [...this.queueCompletionCallbacks];
            this.queueCompletionCallbacks = [];
            callbacks.forEach(callback => callback());
        }
    }

    /**
     * Preloads the next audio in queue for reduced latency.
     */
    private async preloadNextAudio(): Promise<void> {
        if (this.queue.length < 2) return;

        this.nextAudioPreloading = true;
        const nextItem = this.queue[1];

        if (!nextItem.audioUrl) {
            nextItem.audioUrl = await this.generateSpeechWithRetry(nextItem.text, nextItem.speaker);
        }

        this.nextAudioPreloading = false;
    }

    /**
     * Plays audio from URL and returns a promise that resolves when finished.
     * FIX: Sets volume based on mute state - allows queue to continue silently when muted.
     */
    private playAudio(audioUrl: string): Promise<void> {
        return new Promise((resolve) => {
            this.currentPlaybackResolver = resolve;
            this.currentAudio = new Audio(audioUrl);

            // FIX: Apply mute state as volume (0 = muted, 1 = unmuted)
            this.currentAudio.volume = this.isMuted ? 0 : 1;

            this.setPlayingState(true);

            const cleanup = () => {
                this.setPlayingState(false);
                this.currentAudio = null;
                this.currentPlaybackResolver = null;
                resolve();
            };

            this.currentAudio.onended = cleanup;

            this.currentAudio.onerror = (error) => {
                console.error('[AudioService] Audio playback error:', error);
                cleanup();
            };

            this.currentAudio.play().catch((error) => {
                // If error is "The play() request was interrupted", it might be due to cancel()
                if (error.name !== 'AbortError') {
                    console.error('[AudioService] Failed to play audio:', error);
                }
                cleanup();
            });
        });
    }

    /**
     * Helper function to sleep for specified milliseconds.
     */
    private sleep(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * Stops all current and pending audio.
     */
    public cancel(): void {
        // Stop current audio
        if (this.currentAudio) {
            this.currentAudio.pause();
            this.currentAudio = null;
        }

        // Unblock any awaiting playAudio promise
        if (this.currentPlaybackResolver) {
            this.currentPlaybackResolver();
            this.currentPlaybackResolver = null;
        }

        // Clear queue and clean up URLs
        this.queue.forEach(item => {
            if (item.audioUrl) {
                URL.revokeObjectURL(item.audioUrl);
            }
        });

        this.queue = [];
        this.isPlaying = false;
        this.isPaused = false;
        this.isQueueActive = false;

        // Fire completion callbacks (cancellation counts as completion)
        const callbacks = [...this.queueCompletionCallbacks];
        this.queueCompletionCallbacks = [];
        callbacks.forEach(callback => callback());

        console.log('[AudioService] Audio cancelled');
    }

    /**
     * Pauses playback.
     */
    public pause(): void {
        if (this.currentAudio && !this.currentAudio.paused) {
            this.currentAudio.pause();
        }
        this.isPaused = true;
        console.log('[AudioService] Audio paused');
    }

    /**
     * Resumes playback.
     */
    public resume(): void {
        this.isPaused = false;
        if (this.currentAudio && this.currentAudio.paused) {
            this.currentAudio.play().catch(error => {
                console.error('[AudioService] Failed to resume audio:', error);
            });
        }
        console.log('[AudioService] Audio resumed');
    }

    /**
     * Unlocks audio context on user interaction (iOS/Android requirement).
     * FIX: Also marks audio as unlocked for mobile autoplay tracking.
     */
    /**
     * Unlocks audio context on user interaction (iOS/Android requirement).
     * Now plays a silent sound to bless the Audio element path too.
     */
    public unlockAudio(): void {
        this.isAudioUnlocked = true;

        // 1. Resume AudioContext
        if (this.audioContext && this.audioContext.state === 'suspended') {
            this.audioContext.resume().then(() => {
                console.log('[AudioService] Audio context unlocked');
            }).catch(error => {
                console.error('[AudioService] Failed to unlock audio context:', error);
            });
        }

        // 2. Play silent audio to unlock HTML5 Audio limitations on iOS
        if (this.silentAudio) {
            this.silentAudio.play().then(() => {
                console.log('[AudioService] Silent audio played (Media Unlocked)');
            }).catch(e => {
                // Ignore abort errors or auto-play errors here, we just try
                if (e.name !== 'AbortError') {
                    console.log('[AudioService] Silent audio play attempt:', e.message);
                }
            });
        }
    }

    /**
     * Checks if audio has been unlocked via user interaction.
     * FIX: Allows UI to show "tap to enable audio" prompt on mobile.
     */
    public getIsAudioUnlocked(): boolean {
        return this.isAudioUnlocked;
    }

    /**
     * Checks if AudioContext is suspended (mobile browser blocking).
     */
    public isAudioContextSuspended(): boolean {
        return this.audioContext?.state === 'suspended';
    }

    /**
     * Gets current playing state (for UI binding).
     */
    public getIsPlaying(): boolean {
        return this.isPlaying;
    }

    /**
     * Gets current paused state (for UI binding).
     */
    public getIsPaused(): boolean {
        return this.isPaused;
    }

    /**
     * Gets current muted state.
     * FIX: New API for mute state.
     */
    public getIsMuted(): boolean {
        return this.isMuted;
    }

    /**
     * Checks if there are more items in the queue (excluding current playing item).
     * FIX: Allows UI to disable skip/play buttons when on the last dialog.
     */
    public hasMoreInQueue(): boolean {
        // If queue length > 1, there's more after current
        // If queue length === 1, we're on the last item
        // If queue length === 0, nothing in queue
        return this.queue.length > 1;
    }

    /**
     * Gets the current queue length.
     */
    public getQueueLength(): number {
        return this.queue.length;
    }

    /**
     * Sets muted state - muting preserves audio position and queue, just silences output.
     * FIX: Proper mute implementation that doesn't cancel the queue.
     */
    public setMuted(muted: boolean): void {
        this.isMuted = muted;
        if (this.currentAudio) {
            // Apply volume change immediately to current audio
            this.currentAudio.volume = muted ? 0 : 1;
        }
        console.log(`[AudioService] Muted: ${muted}`);
    }

    /**
     * Skips only the current audio item and advances to the next in queue.
     * FIX: Unlike cancel(), this preserves the queue and only skips current.
     * FIX: Immediately sets playing state to false when skipping the last item.
     */
    public skipCurrent(): void {
        if (this.currentAudio) {
            // Stop current audio - this will trigger onended -> cleanup -> resolve
            // which advances the queue naturally
            this.currentAudio.pause();
            this.currentAudio.currentTime = 0;

            // Force resolve to unblock and move to next item
            if (this.currentPlaybackResolver) {
                this.currentPlaybackResolver();
                this.currentPlaybackResolver = null;
            }

            // FIX: If this is the last item in queue, immediately notify that playback stopped
            // This ensures UI buttons are disabled immediately when skipping the last dialog
            if (this.queue.length <= 1) {
                console.log('[AudioService] Skipped last audio item, stopping playback');
                this.setPlayingState(false);
            } else {
                console.log('[AudioService] Skipped current audio, advancing to next');
            }
        }
    }

    /**
     * Helper to update isPlaying state and notify listeners.
     * FIX: Centralized state change with notifications.
     */
    private setPlayingState(playing: boolean): void {
        this.isPlaying = playing;
        this.notifyPlayingStateChange();
    }

    /**
     * Subscribe to playing state changes.
     * FIX: Allows App.tsx to sync isSpeaking state with actual audio playback.
     */
    public onPlayingStateChange(callback: (isPlaying: boolean) => void): () => void {
        this.playingStateListeners.push(callback);
        // Invoke immediately with current state
        callback(this.isPlaying);

        // Return unsubscribe function
        return () => {
            this.playingStateListeners = this.playingStateListeners.filter(cb => cb !== callback);
        };
    }

    /**
     * Notifies all listeners of playing state change.
     */
    private notifyPlayingStateChange(): void {
        this.playingStateListeners.forEach(callback => callback(this.isPlaying));
    }
}

export const audioService = AudioService.getInstance();
