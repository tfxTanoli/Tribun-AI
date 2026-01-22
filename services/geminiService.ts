
import { GenerateContentResponse, Chat } from "@google/genai";
import { Evaluation, SimulationConfig, Speaker, ChatMessage } from '../types';

// We just mock the Chat interface since we don't have the SDK class anymore, 
// to avoid rewriting App.tsx entirely.
// ID is string, but App.tsx expects 'Chat' object. 
// We will create a fake object that holds the sessionId.
interface RemoteChatSession {
  sessionId: string;
}

const API_BASE = import.meta.env.VITE_API_URL || '';

export const generateDynamicContext = async (config: SimulationConfig): Promise<string> => {
  // Logic for prompts moved to server (or we send prompt to server). 
  // To minimize server complexity, we construct the prompt here (safe, it's just text)
  // and send it to server to get completion.

  const contextPrompt = await buildContextPrompt(config);

  const response = await fetch(`${API_BASE}/api/generate-context`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: contextPrompt })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`API Error (${response.status}): ${errorText}`);
  }

  if (!response.body) throw new Error("No response body from server");

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let fullText = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const chunk = decoder.decode(value, { stream: true });
    fullText += chunk;
  }

  return fullText.trim();
};

export const startChatSession = (config: SimulationConfig, dynamicContext: string): { session: any, streamPromise: Promise<AsyncGenerator<GenerateContentResponse>> } => {
  const systemInstruction = generateSystemInstruction(config, dynamicContext);
  const initialMessage = config.subStage === 'Calificación de la Detención'
    ? "Inicia la audiencia. Recuerda nunca hablar por el usuario."
    : `Contexto de resoluciones previas: "${dynamicContext}". Basado en esto, inicia formalmente la audiencia en la etapa de "${config.subStage}". Empieza con un breve resumen del estado actual para efectos de registro y luego otorga la palabra a quien corresponda. Recuerda nunca hablar por el usuario.`;

  // We can't await here because this function is synchronous in the original signature?
  // Actually the original returned { session, streamPromise }.
  // So we can start the fetch inside the promise.

  let sessionIdResolver: (id: string | null) => void;
  const sessionIdPromise = new Promise<string | null>(resolve => sessionIdResolver = resolve);

  // Mock session object that App.tsx will hold
  const sessionMock = {
    sessionIdPromise: sessionIdPromise
  };

  const streamPromise = (async function* () {
    let response;
    try {
      response = await fetch(`${API_BASE}/api/chat/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          systemInstruction,
          initialMessage
        })
      });
    } catch (e) {
      if (sessionIdResolver) sessionIdResolver(null); // Ensure unblock
      throw e;
    }

    if (!response.ok) {
      if (sessionIdResolver) sessionIdResolver(null); // Ensure unblock
      const errorText = await response.text();
      throw new Error(`Chat Start Error (${response.status}): ${errorText}`);
    }

    const sessId = response.headers.get('X-Session-ID');
    if (sessId && sessionIdResolver) {
      sessionIdResolver(sessId);
    } else if (sessionIdResolver) {
      console.warn("No X-Session-ID header in start response");
      sessionIdResolver(null); // Resolve with null so we don't hang, but next call might fail
    }

    if (!response.body) throw new Error("No response body from chat start");
    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const text = decoder.decode(value, { stream: true });
      if (text) {
        yield { text } as GenerateContentResponse;
      }
    }
  })();

  return { session: sessionMock, streamPromise: Promise.resolve(streamPromise) };
};

export const continueChat = async (session: any, message: string): Promise<AsyncGenerator<GenerateContentResponse>> => {
  const sessionId = await session.sessionIdPromise;

  if (!sessionId) {
    // If we never got a session ID, we can't continue the chat on the server properly.
    // However, to prevent UI freeze, we throw an error here so App.tsx catches it.
    throw new Error("Cannot continue chat: No Session ID was initialized.");
  }

  return (async function* () {
    const response = await fetch(`${API_BASE}/api/chat/continue`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId, message })
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Chat Continue Error (${response.status}): ${errorText}`);
    }

    if (!response.body) throw new Error("No response body from chat continue");
    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const text = decoder.decode(value, { stream: true });
      if (text) {
        yield { text } as GenerateContentResponse;
      }
    }
  })();
};

export const askProfessor = async (question: string, contextHistory: ChatMessage[], config: SimulationConfig | null): Promise<string> => {
  const recentContext = contextHistory.slice(-4).map(m => `[${m.speaker}]: ${m.text}`).join('\n');
  const contextInfo = config ? `Etapa: ${config.stage} (${config.subStage}). Delito: ${config.crime}.` : "";

  const prompt = `
    Actúa como Profesor Experto en Derecho Penal.
    Contexto: ${contextInfo}
    Últimos mensajes: ${recentContext}
    Duda del estudiante: "${question}"
    Responde pedagógicamente y guía según el CNPP.
    `;

  const response = await fetch(`${API_BASE}/api/ask-professor`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Professor API Error (${response.status}): ${errorText}`);
  }

  const data = await response.json();
  if (!data.text) throw new Error("No text in professor response");
  return data.text;
};

export const getEvaluation = async (transcript: string, userRole: Speaker, config?: SimulationConfig): Promise<Evaluation> => {
  let rigorContext = "ESTÁNDAR PROFESIONAL.";
  if (config?.rigorLevel === 'Académico') rigorContext = "CRITERIO DIDÁCTICO: Evalúa señalando errores técnicos con fin educativo.";
  else if (config?.rigorLevel === 'Procesal') rigorContext = "CRITERIO REALISTA: Evalúa como un Juez en funciones. Baja tolerancia a fallas.";
  else if (config?.rigorLevel === 'Técnico') rigorContext = "CRITERIO ALTA COMPETENCIA: Penaliza cualquier error mínimo de técnica.";

  const prompt = `
    Actúa como Juez Evaluador Experto. Califica al usuario (${userRole}).
    
    Transcipción:
    ${transcript}
    
    Genera JSON con:
    - feedback (argumentClarity, legalBasis, proceduralCoherence, objectionPertinence, oratory) 0-100.
    - comments (crítica detallada citando errores).
    - finalScore (promedio).
    
    Nivel de exigencia: ${rigorContext}
    `;

  // Same schema definition as before to send to server
  const schema = {
    type: "OBJECT",
    properties: {
      transcript: { type: "STRING" },
      feedback: {
        type: "OBJECT",
        properties: {
          argumentClarity: { type: "NUMBER" },
          legalBasis: { type: "NUMBER" },
          proceduralCoherence: { type: "NUMBER" },
          objectionPertinence: { type: "NUMBER" },
          oratory: { type: "NUMBER" },
        },
        required: ['argumentClarity', 'legalBasis', 'proceduralCoherence', 'objectionPertinence', 'oratory']
      },
      comments: { type: "STRING" },
      finalScore: { type: "NUMBER" },
    },
    required: ['transcript', 'feedback', 'comments', 'finalScore'],
  };

  console.log("Sending transcript to evaluation (Length):", transcript.length);
  console.log("Transcript Preview:", transcript.substring(0, 200));

  const response = await fetch(`${API_BASE}/api/evaluate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt, schema })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Evaluation API Error (${response.status}): ${errorText}`);
  }

  const jsonText = await response.text();
  console.log("Raw Evaluation Response:", jsonText);

  // Clean markdown if present
  const cleanJsonText = jsonText.replace(/```json\n?|\n?```/g, '').trim();

  try {
    const parsed = JSON.parse(cleanJsonText) as Evaluation;
    console.log("Parsed Evaluation:", parsed);
    return parsed;
  } catch (e) {
    console.error("JSON Parse Error:", e);
    console.error("Failed JSON Text:", cleanJsonText);
    throw new Error("Invalid JSON evaluation response from server.");
  }
};

export const generateRandomSimulationConfig = async (difficulty?: string, crimeList?: string[]): Promise<Partial<SimulationConfig>> => {
  let prompt = `
    Genera escenario penal aleatorio (Querétaro) con ALTO NIVEL DE DETALLE FACTICO. JSON con:
    - crime, stage (Inicial, Intermedia, Juicio Oral), subStage.
    - crimeContext: Narrativa de hechos. DEBE usar ESTRICTAMENTE este formato con saltos de línea:
  TIEMPO: [Fecha exacta, hora y momento del día]
  LUGAR: [Ubicación precisa: Calle, número, Colonia, Referencias visuales]
  MODO: [Mecánica detallada de los hechos, acciones específicas, instrumentos usados]
  PARTES: [Nombre completo de la Víctima, Imputado y Testigos presenciales]
    - defendantProfile: Perfil detallado (Edad, ocupación, estado civil, antecedentes penales).
    - prosecutorWitness: Identidad y razón de su testimonio (ej. Policía aprehensor con NIP 1234).
    - defenseWitness: Identidad y razón de su testimonio.
    `;

  if (crimeList && crimeList.length > 0) {
    prompt += ` Usar delito de esta lista: ${JSON.stringify(crimeList)}`;
  }

  const schema = {
    type: "OBJECT",
    properties: {
      crime: { type: "STRING" },
      stage: { type: "STRING" },
      subStage: { type: "STRING" },
      crimeContext: { type: "STRING" },
      defendantProfile: { type: "STRING" },
      prosecutorWitness: { type: "STRING" },
      defenseWitness: { type: "STRING" },
    },
    required: ['crime', 'stage', 'subStage', 'crimeContext', 'defendantProfile', 'prosecutorWitness', 'defenseWitness'],
  };

  const response = await fetch(`${API_BASE}/api/generate-config`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt, schema })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Config Generation Error (${response.status}): ${errorText}`);
  }

  const text = await response.text();
  try {
    return JSON.parse(text) as Partial<SimulationConfig>;
  } catch (e) {
    throw new Error("Invalid JSON config response from server.");
  }
};


// -------------------------------------------------------------
// INTERNAL HELPERS (Kept on client to build the prompt text)
// -------------------------------------------------------------

const getProceduralStructure = (config: SimulationConfig, dynamicContext: string): string => {
  const { subStage } = config;

  const audienciaInicialStructure = `
  **Estructura Procesal Estricta de la Audiencia Inicial (Art. 307 y ss. CNPP):**
  Esta audiencia se desarrollará en etapas claras y sucesivas. Debes seguir este orden rigurosamente, anunciando el inicio de cada etapa. No puedes saltar ni mezclar etapas.
  
  1.  **Apertura de la Audiencia:**
      a. **[SECRETARIO]:** Anuncia el inicio de la grabación, la fecha, hora, lugar, número de causa y el Juez que preside. Pide a los asistentes guardar silencio y decoro.
      b. **[JUEZ]:** Se identifica formalmente, pregunta a las partes (MP y Defensa) sus generales y verifica la presencia del Imputado.
      c. **[JUEZ]:** Declara formalmente abierta la audiencia.
  2.  **Control de Legalidad de la Detención:**
      a. El Juez da el uso de la voz al Ministerio Público para que justifique las razones de la detención.
      b. El Juez da el uso de la voz a la Defensa para que debata la justificación del MP.
      c. El Juez resuelve sobre la calificación de la detención (la ratifica o la declara ilegal).
  3.  **Formulación de la Imputación:**
      a. El Juez autoriza al MP a formular la imputación.
      b. El MP comunica al imputado el hecho que se le atribuye, la calificación jurídica preliminar, la fecha, lugar y modo de comisión, y el nombre de su acusador.
      c. El Juez pregunta al imputado si ha comprendido la imputación y le explica sus derechos.
  4.  **Oportunidad de Declarar:**
      a. El Juez informa al imputado su derecho a declarar o guardar silencio.
      b. Se pregunta al imputado si es su deseo declarar en ese momento.
  5.  **Solicitud de Vinculación a Proceso:**
      a. El Juez pregunta al MP si solicitará la vinculación a proceso.
      b. Si el imputado lo solicita, puede acogerse al plazo constitucional de 72 o 144 horas. Si no, se procede.
      c. El MP expone los datos de prueba que establecen un hecho que la ley señala como delito y la probabilidad de que el imputado lo cometió o participó en su comisión.
      d. La Defensa contesta la solicitud del MP, exponiendo sus propios datos de prueba si los tuviera.
      e. El Juez resuelve sobre la vinculación a proceso.
  6.  **Debate sobre Medidas Cautelares:**
      a. El Juez abre el debate.
      b. El MP solicita y justifica la medida cautelar que considera necesaria, argumentando sobre la necesidad de cautela.
      c. La Defensa argumenta en contra o propone alternativas menos lesivas.
      d. El Juez resuelve sobre la imposición de medidas cautelares, motivando su decisión.
  7.  **Fijación del Plazo para Cierre de Investigación Complementaria:**
      a. El Juez abre el debate sobre el plazo.
      b. Las partes proponen un plazo justificado.
      c. El Juez fija el plazo de cierre.
  8.  **Cierre de la Audiencia.**`;

  const etapaIntermediaStructure = `
  **Estructura Procesal Estricta de la Etapa Intermedia (Fase Oral - Art. 344 y ss. CNPP):**
  Tu rol es simular la fase oral de la Audiencia Intermedia. Asume que la fase escrita (acusación del MP, contestación de la Defensa) ya se ha completado.
  
  1.  **Apertura de la Audiencia:**
      a. **[SECRETARIO]:** Anuncia el inicio de la audiencia de Etapa Intermedia, causa penal y juez que preside.
      b. **[JUEZ]:** Verifica la presencia de las partes y declara abierta la audiencia para la fase oral.
  2.  **Exposición Sintética:** El Juez solicita al MP y a la Defensa que expongan resumidamente sus escritos de acusación y contestación.
  3.  **Incidencias y Excepciones:** Se abre debate sobre posibles incidencias o excepciones presentadas.
  4.  **Acuerdos Probatorios:** El Juez pregunta a las partes si han celebrado acuerdos probatorios y, en su caso, los aprueba.
  5.  **Debate sobre Exclusión de Medios de Prueba:** Esta es la parte central.
      a. El Juez da la palabra al MP y Defensa para debatir sobre la exclusión de medios de prueba (Art. 346 CNPP).
      b. Se debate prueba por prueba. Tú, como Juez, debes moderar activamente y resolver sobre la pertinencia e idoneidad.
  6.  **Auto de Apertura a Juicio Oral:** El Juez resuelve sobre la admisión y exclusión de pruebas y dicta verbalmente el Auto de Apertura.
  7.  **Cierre de la Audiencia.**`;

  const juicioOralStructure = `
  **Estructura Procesal Estricta de la Audiencia de Juicio Oral (Art. 391 y ss. CNPP):**
  Simularás el debate ante el Tribunal de Enjuiciamiento.
  
  1.  **Apertura de la Audiencia de Debate:**
      a. **[SECRETARIO]:** Anuncia el inicio del Juicio Oral, cita el auto de apertura, menciona a los integrantes del Tribunal y llama a las partes y testigos (si no están segregados).
      b. **[JUEZ]:** Verifica presencia de partes y declara abierto el debate.
  2.  **Alegatos de Apertura:**
      a. El Juez cede la palabra al Ministerio Público.
      b. El Juez cede la palabra a la Defensa.
  3.  **Desahogo de Pruebas:**
      a. **Testimonial de Cargo (MP):** Interrogatorio (MP) y Contrainterrogatorio (Defensa).
      b. **Testimonial de Descargo (Defensa):** Interrogatorio (Defensa) y Contrainterrogatorio (MP).
      El Juez debe moderar el debate y calificar objeciones en todo momento.
  4.  **Alegatos de Clausura:**
      a. Clausura del MP.
      b. Clausura de la Defensa.
      c. Réplicas y Dúplicas si aplica.
  5.  **Deliberación y Fallo:** El Tribunal emite el fallo (absolutorio o condenatorio).
  6.  **Cierre de la Audiencia.**`;

  const contextInstruction = "\n\n**Instrucción de Inicio:** Antes de abrir formalmente the etapa, el Juez debe realizar un breve resumen solemne (máximo 3 líneas) de lo ocurrido en las etapas previas (según el contexto proporcionado) para efectos de registro y situación de las partes.";

  switch (subStage) {
    case 'Calificación de la Detención':
      return `${audienciaInicialStructure}\n\n**Directiva de Inicio:** La simulación se centrará en toda la Audiencia Inicial, comenzando desde el principio: etapa de **Control de Legalidad de la Detención (Calificación de la Detención)**.`;
    case 'Formulación de la Imputación':
      return `${audienciaInicialStructure}\n\n**Resoluciones Previas Asumidas:**\n${dynamicContext}${contextInstruction}\n**Directiva de Inicio:** Procede directamente a la etapa 3: **Formulación de la Imputación**.`;
    case 'Solicitud de Vinculación a Proceso':
      return `${audienciaInicialStructure}\n\n**Resoluciones Previas Asumidas:**\n${dynamicContext}${contextInstruction}\n**Directiva de Inicio:** Procede directamente a la etapa 5: **Solicitud de Vinculación a Proceso**.`;
    case 'Debate sobre Medidas Cautelares':
      return `${audienciaInicialStructure}\n\n**Resoluciones Previas Asumidas:**\n${dynamicContext}${contextInstruction}\n**Directiva de Inicio:** Procede directamente a la etapa 6: **Debate sobre Medidas Cautelares**.`;

    case 'Cierre de Investigación Complementaria':
      return `${audienciaInicialStructure}\n\n**Resoluciones Previas Asumidas:**\n${dynamicContext}${contextInstruction}\n**Directiva de Inicio:** Procede directamente a la etapa 7 de la Audiencia Inicial: **Fijación del Plazo para Cierre de Investigación Complementaria**.`;
    case 'Acuerdos Probatorios':
      return `${etapaIntermediaStructure}\n\n**Resoluciones Previas Asumidas:**\n${dynamicContext}${contextInstruction}\n**Directiva de Inicio:** Procede directamente a la etapa 4 de la Audiencia Intermedia: **Acuerdos Probatorios**.`;
    case 'Exclusión de Medios de Prueba':
      return `${etapaIntermediaStructure}\n\n**Resoluciones Previas Asumidas:**\n${dynamicContext}${contextInstruction}\n**Directiva de Inicio:** Procede directamente a la etapa 5 de la Audiencia Intermedia: **Debate sobre Exclusión de Medios de Prueba**.`;
    case 'Auto de Apertura a Juicio Oral':
      return `${etapaIntermediaStructure}\n\n**Resoluciones Previas Asumidas:**\n${dynamicContext}${contextInstruction}\n**Directiva de Inicio:** Procede directamente a la etapa 6 de la Audiencia Intermedia: **Auto de Apertura a Juicio Oral**.`;

    case 'Alegatos de Apertura':
      return `${juicioOralStructure}\n\n**Resoluciones Previas Asumidas:**\n${dynamicContext}${contextInstruction}\n**Directiva de Inicio:** Inicia en la Audiencia de Juicio Oral: **Apertura de la Audiencia de Debate**, procediendo a los **Alegatos de Apertura**.`;
    case 'Desahogo de Pruebas':
      return `${juicioOralStructure}\n\n**Resoluciones Previas Asumidas:**\n${dynamicContext}${contextInstruction}\n**Directiva de Inicio:** Procede directamente a la etapa 3 de la Audiencia de Juicio Oral: **Desahogo de Pruebas**.`;
    case 'Alegatos de Clausura':
      return `${juicioOralStructure}\n\n**Resoluciones Previas Asumidas:**\n${dynamicContext}${contextInstruction}\n**Directiva de Inicio:** Procede directamente a la etapa 4: **Alegatos de Clausura**.`;

    default:
      return 'Estructura no definida. Por favor, reinicia la simulación.';
  }
}


const generateSystemInstruction = (config: SimulationConfig, dynamicContext: string): string => {
  const { userRole, subStage, crime, crimeContext, defendantProfile, prosecutorWitness, defenseWitness, rigorLevel } = config;

  const roles = {
    [Speaker.JUEZ]: "Juez de Control o Tribunal de Enjuiciamiento",
    [Speaker.MINISTERIO_PUBLICO]: "Ministerio Público (MP)",
    [Speaker.DEFENSA]: "Abogado Defensor",
    [Speaker.TESTIGO]: "Testigo (Cargo o Descargo)",
    [Speaker.SECRETARIO]: "Secretario de Audiencia (Encargado de Sala)",
  };

  const aiRoles = Object.values(Speaker).filter(role => role !== userRole);
  const aiRoleNames = aiRoles.map(role => roles[role]).join(', ').replace(/,([^,]*)$/, ' y$1');
  const proceduralStructure = getProceduralStructure(config, dynamicContext);

  let rigorInstruction = '';
  switch (rigorLevel) {
    case 'Académico':
      rigorInstruction = `
            **MODO DIDÁCTICO/ACADÉMICO (Alta Tolerancia Pedagógica):**
            Tu desempeño como Juez debe ser jurídicamente PERFECTO y SOLEMNE. No cometas errores procesales.
            La diferencia está en cómo reaccionas a los errores del usuario:
            Si el usuario comete un error (ej. objeta mal, olvida un requisito legal), **mantén tu rol de Juez**, pero haz una pausa explicativa breve dentro del personaje para guiarlo.
            Ejemplo: "Abogado, su petición carece de fundamento en el artículo X. Le permito reformular su solicitud para que se ajuste a derecho."
            Permite que el usuario corrija antes de dictar una resolución negativa definitiva.`;
      break;
    case 'Procesal':
      rigorInstruction = `
            **MODO PROCESAL (Estándar Realista):**
            Tu desempeño como Juez debe ser jurídicamente PERFECTO y SOLEMNE.
            Actúa como un Juez en un día normal de trabajo. Eres eficiente y directo.
            Si el usuario se equivoca, no le des clases ni oportunidades extra de corrección. Simplemente resuelve en su contra conforme a derecho y continúa la audiencia.
            Ejemplo: "No ha lugar a su petición por falta de fundamentación. Se continúa con la audiencia."
            Es un trato profesional, frío y apegado a la ley.`;
      break;
    case 'Técnico':
      rigorInstruction = `
            **MODO TÉCNICO (Alta Exigencia en Litigación):**
            Tu desempeño como Juez debe ser jurídicamente PERFECTO y SOLEMNE.
            Tu escrutinio sobre la **técnica de litigación** del usuario es máximo.
            Aunque el fondo de su petición sea correcto, si la forma es deficiente (titubea, no cita el artículo exacto, formula mal la pregunta), deséchalo inmediatamente.
            Eres intimidante por tu conocimiento exacto de la ley. Penaliza cualquier falta de pulcritud técnica.`;
      break;
    default:
      rigorInstruction = `**MODO ESTÁNDAR:** Simula un juicio equilibrado y formal.`;
  }


  return `
  Eres un motor de simulación para audiencias penales orales en Querétaro, México.
  
  El usuario humano desempeñará el rol de: **${roles[userRole]}**.
  Tú, la IA, desempeñarás los roles de: **${aiRoleNames}**.
  
  **Nivel de Interacción:** ${rigorLevel}
  ${rigorInstruction}
  
  **IMPORTANTE:** Independientemente del nivel seleccionado, tú como Juez NUNCA te equivocas en el procedimiento ni en la ley. Mantienes siempre la formalidad, la jerarquía y el lenguaje jurídico de alto nivel.
  
  **Caso Simulado:**
  - **Inicio de la Audiencia en:** ${subStage}
  - **Delito:** ${crime}
  ${crimeContext ? `- **Contexto/Hechos:** ${crimeContext}` : ''}
  ${defendantProfile ? `- **Perfil del Imputado:** ${defendantProfile}` : ''}
  
  **Perfiles de los Testigos:**
  1. **Testigo de Cargo (MP):** ${prosecutorWitness || "Testigo genérico."}
  2. **Testigo de Descargo (Defensa):** ${defenseWitness || "Testigo genérico."}
  
  **Fuentes Jurídicas OBLIGATORIAS:**
  Constitución (CPEUM), Código Nacional de Procedimientos Penales (CNPP), Código Penal de Querétaro.
  
  **Filosofía de Actuación:**
  1.  **Rol del Juez:** Eres el rector del proceso. Fundamenta y motiva todas tus decisiones. Califica objeciones.
  2.  **Principio de Contradicción:** Fomenta el debate entre partes.
  3.  **Protocolo de Lenguaje sobre el Imputado:**
      a. **[JUEZ]:** Se refiere al procesado como "el imputado" o "el acusado".
      b. **[MINISTERIO PÚBLICO]:** Se refiere al procesado formalmente como "el imputado".
      c. **[DEFENSA]:** Se refiere al procesado como "mi cliente" o "mi representado".
  4.  **Interrogatorio y Objeciones (MECÁNICA ESPECIAL Y SOFISTICADA):**
      a. **Generación de Preguntas con Potencial de Objeción:** Para entrenar al usuario, en aproximadamente un 23% de las veces que formules una pregunta a un testigo, esta debe ser deliberadamente incorrecta y dar pie a una objeción válida (ej. ser sugestiva, capciosa, conclusiva, etc.). Cuando generes una pregunta viciada, debes saber internamente cuál es el vicio exacto que estás introduciendo.
      b. **Pausa para Objeción:** Cuando una parte (MP o Defensa) que controlas haga una pregunta a un testigo (sea correcta o viciada), formula la pregunta y AÑADE la etiqueta **[PAUSA_PARA_OBJECION]** al final de esa misma línea de diálogo.
      c. **DETÉN tu generación inmediatamente después de esa etiqueta.** No generes la respuesta del testigo.
      d. **Recepción de Respuesta del Usuario:** El usuario te responderá de dos maneras:
          i. **"Sin objeción":** Si recibes esto, el testigo debe responder la pregunta formulada. Si la pregunta era objetable y el usuario no lo notó, el testigo simplemente la responderá, evidenciando el error del usuario. Continúa el interrogatorio.
          ii. **Un tipo de objeción (ej. "objeción: pregunta sugestiva"):** Aquí tu rol como Juez es CRÍTICO. Debes:
              1.  Analizar la pregunta que la IA (MP o Defensa) acaba de formular.
              2.  Determinar si la objeción del usuario es **TÉCNICAMENTE CORRECTA** para el vicio de esa pregunta. (Ej: Si la pregunta fue "¿Usted vio al acusado huir con el arma, verdad?", la objeción correcta es "sugestiva". Una objeción de "impertinente" sería incorrecta).
              3.  Si el tipo de objeción es el correcto, resuelve **"[JUEZ]: Ha lugar a la objeción. Reformule la pregunta, por favor."**.
              4.  Si el tipo de objeción es incorrecto, o si la pregunta original era válida, resuelve **"[JUEZ]: No ha lugar. Conteste la pregunta, testigo."**.
      e. **Continuación Lógica:** Después de tu resolución como Juez, la audiencia debe continuar de manera lógica. Si admitiste la objeción, la parte que pregunta debe reformular. Si la negaste, el testigo debe responder a la pregunta original.
      f. **Respuesta del Testigo:** La respuesta del testigo, cuando ocurra, DEBE ser emitida en un bloque de diálogo separado y etiquetado con \`[TESTIGO]:\`.
  
  **PERFIL PSICOLÓGICO Y REALISMO DEL TESTIGO:**
  Para aumentar el realismo y la inmersión, los testigos (tanto de cargo como de descargo) NO deben comportarse como inteligencias artificiales perfectas o enciclopedias.
  1.  **Falibilidad de la Memoria:** Ocasionalmente (probabilidad media), haz que el testigo dude, use muletillas ("este...", "pues..."), o diga "no recuerdo bien ese detalle", "pasó muy rápido".
  2.  **Contradicciones Leves:** De forma orgánica y no exagerada, permite que el testigo caiga en pequeñas contradicciones o inexactitudes (ej. confundir un color, una hora aproximada, o cambiar ligeramente su versión ante presión). Esto da oportunidad al usuario de realizar ejercicios de evidencia de contradicción.
  3.  **Lenguaje Natural:** El testigo NO usa jerga jurídica (salvo que sea perito oficial). Usa lenguaje coloquial, expresiones naturales de Querétaro/México, y puede mostrarse nervioso, defensivo o confundido según el tipo de interrogatorio.
  
  **REGLAS DE LITIGACIÓN SOBRE PREGUNTAS SUGESTIVAS (Art. 373 CNPP):**
  Debes aplicar esta regla estrictamente para evaluar al usuario y evitar regaños injustificados:
  1.  **INTERROGATORIO DIRECTO (A testigo propio):** Las preguntas sugestivas están **PROHIBIDAS**.
      - Si el usuario interroga a su propio testigo (ej. Defensa a testigo de Defensa), **NO** permitas sugestivas. La contraparte debe objetar o el Juez corregir.
  2.  **CONTRAINTERROGATORIO (A testigo de la contraparte):** Las preguntas sugestivas están **PERMITIDAS** y son la técnica correcta.
      - Si el usuario contrainterroga al testigo contrario (ej. Defensa a testigo de Cargo), **PERMITE** las preguntas sugestivas.
      - **NO REGAÑES al usuario.** Si la contraparte objeta "sugestiva" en esta fase, el Juez debe resolver inmediatamente: "No ha lugar, es contrainterrogatorio".
  
  ${proceduralStructure ? `
  **Estructura Procesal (REGLA FUNDAMENTAL):**
  Sigue el orden de las etapas procesales descritas a continuación de manera ESTRICTA.
  ${proceduralStructure}
  ` : ''}
  
  **PROTOCOLOS DE TURNO y ANTI-SUPLANTACIÓN (CRÍTICO - REGLA DE ORO):**
  1.  **PROHIBICIÓN TOTAL DE SUPLANTACIÓN:** Tú NUNCA, bajo ninguna circunstancia, escribes diálogos, argumentos o respuestas para el usuario (**${roles[userRole]}**). 
  2.  **CERO PREDICCIÓN:** No asumas lo que el usuario va a decir. No escribas "[${userRole.toUpperCase()}]: ..." ni nada parecido. Si la etapa procesal requiere que el usuario hable, el Juez o la contraparte deben otorgarle la palabra y DETENERSE.
  3.  **MARCADOR DE TURNO:** Salvo en la mecánica de objeciones, cada vez que el Juez o la contraparte terminen de hablar y sea el momento de que el usuario intervenga, DEBES terminar tu respuesta INMEDIATamente con la etiqueta: \`[TURNO: ${userRole}]\`.
  4.  **ALTO TOTAL:** La generación de texto por tu parte debe cesar exactamente después de la etiqueta de turno. No añadas notas, no añadas pensamientos, no añadas el tag del usuario.
  5.  **MARCADOR DE ETAPA (OBLIGATORIO):** Cuando inicies una nueva fase procesal o sub-etapa definida en la estructura, inserta la etiqueta \`[ETAPA: NOMBRE_DE_ETAPA]\` al inicio de tu intervención.
  6.  **FORMATO DE DIÁLOGO (REGLA INQUEBRANTABLE Y NO NEGOCIABLE):**
      a. CADA intervención de un personaje de la IA DEBE comenzar con su etiqueta de rol EXACTA, en mayúsculas, dentro de corchetes, y seguida de dos puntos sin espacios intermedios. La fidelidad al texto de la etiqueta es absoluta.
      b. **LISTA BLANCA DE ETIQUETAS (ÚNICAS PERMITIDAS):**
          - \`[JUEZ]:\`
          - \`[MINISTERIO PÚBLICO]:\`
          - \`[DEFENSA]:\`
          - \`[TESTIGO]:\`
          - \`[SECRETARIO]:\`
      c. **Formatos INCORRECTOS (TOTALMENTE PROHIBIDOS):**
          - Errores de tipeo: \`[MINISTERIO P-UBLICO]:\`, \`[MIN-ISTERIO PÚBLICO]:\`, \`[JUES]:\`
          - Errores de acentuación: \`[MINISTERIO PUBLICO]:\` (sin acento)
          - Errores de capitalización: \`[Juez]:\` (minúsculas)
          - Errores de espaciado: \`[TESTIGO] :\`
          - Errores de sintaxis: \`TESTIGO:\`, \`[TESTIGO]\`
      d. **CONSECUENCIA:** Fallar en usar la etiqueta EXACTA de la lista blanca romperá la aplicación. Tu adherencia a este formato es crítica. NO improvises ni alteres las etiquetas bajo ninguna circunstancia.
  7.  **ROLES PROHIBIDOS:** NUNCA generes diálogo para \`[${userRole.toUpperCase()}]:\`. Este rol pertenece exclusivamente al usuario humano. Si generas contenido para este rol, la simulación fallará.
  
  Al finalizar el juicio, escribe: **FIN DE LA SIMULACIÓN**.
  
  Comienza la simulación AHORA respetando estrictamente que el usuario es quien debe responder cuando se le ceda la palabra.
  `;
};

const getPreviousStages = (currentSubStage: string): string[] => {
  const allSubStages = [
    'Calificación de la Detención',
    'Formulación de la Imputación',
    'Solicitud de Vinculación a Proceso',
    'Debate sobre Medidas Cautelares',
    'Cierre de Investigación Complementaria',
    'Acuerdos Probatorios',
    'Exclusión de Medios de Prueba',
    'Auto de Apertura a Juicio Oral',
    'Alegatos de Apertura',
    'Desahogo de Pruebas',
    'Alegatos de Clausura'
  ];
  const currentIndex = allSubStages.indexOf(currentSubStage);
  if (currentIndex <= 0) {
    return [];
  }
  return allSubStages.slice(0, currentIndex);
}

const buildContextPrompt = async (config: SimulationConfig): Promise<string> => {
  if (config.subStage === 'Calificación de la Detención') {
    return `Actúa como Secretario de Acuerdos. Genera un Resumen de Apertura para la audiencia de Control de Detención bajo el sistema acusatorio mexicano (CNPP).
    
    Datos del Caso:
    - Delito: ${config.crime}
    - Hechos (Fáctico): ${config.crimeContext}
    - Imputado (Perfil): ${config.defendantProfile || "No especificado"}
    
    Objetivo: Redactar un resumen breve y directo de los hechos que motivan la detención, para que el Juez tenga contexto inmediato. 
    ESTILO: Narrativo, técnico-jurídico, neutral. NO expliques qué es la audiencia, ve directo a los hechos del caso.`;
  }

  const previousStages = getPreviousStages(config.subStage);

  return `
    Actúa como un Secretario de Acuerdos judicial de Querétaro redactando un resumen ejecutivo exhaustivo del expediente para el Juez que tomará la audiencia.
    
    El delito es: **${config.crime}**.
    Etapas que YA se llevaron a cabo y fueron concluidas: **${previousStages.join(', ')}**.
    La etapa que iniciará AHORA es: **${config.subStage}**.

    **REQUISITOS DEL RESUMEN (ESTRUCTURA OBLIGATORIA):**
    1.  **SÍNTESIS INTEGRAL DE LOS HECHOS (ORIGEN DEL CASO):** Redacta una narrativa detallada de los hechos delictivos originales (tiempo, lugar, modo). No omitas el origen del conflicto solo por estar en una etapa avanzada.
    2.  **IDENTIFICACIÓN DE LAS PARTES:** Detalla quién es el Imputado (Perfil: ${config.defendantProfile || "No especificado"}), la Víctima/Ofendido y los representantes.
    3.  **PERFIL DE ÓRGANOS DE PRUEBA:** Resume quiénes son los testigos y qué se espera de su testimonio.
    4.  **HISTORIAL PROCESAL COMPLETO (CRONOLOGÍA):** Resume de manera concatenada qué ocurrió en CADA UNA de las etapas previas: ${previousStages.join(', ')}. Evita enfocarte solo en la última.
    5.  **ESTADO PROCESAL ACTUAL:** Define el punto de partida exacto para la etapa de ${config.subStage}.

    Utiliza un lenguaje técnico-jurídico formal, pero asegúrate de que el Juez tenga la "película completa" del caso, no solo un fragmento.
    `;
}
