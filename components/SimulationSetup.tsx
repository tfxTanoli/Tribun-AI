
import React, { useState } from 'react';
import { SimulationConfig, Speaker, VoiceSettings } from '../types';
import { generateRandomSimulationConfig } from '../services/geminiService';

// Available Spanish voices from Google Cloud TTS
const VOICE_OPTIONS = [
  { id: 'es-ES-Neural2-B', name: 'Male - Authoritative (Spain)', gender: 'MALE' },
  { id: 'es-ES-Neural2-A', name: 'Female - Professional (Spain)', gender: 'FEMALE' },
  { id: 'es-ES-Neural2-E', name: 'Female - Warm (Spain)', gender: 'FEMALE' },
  { id: 'es-US-Neural2-B', name: 'Male - Standard (LatAm/US)', gender: 'MALE' },
  { id: 'es-US-Neural2-A', name: 'Female - Professional (LatAm/US)', gender: 'FEMALE' },
  { id: 'es-US-News-F', name: 'Female - Soft (LatAm/US)', gender: 'FEMALE' },
  { id: 'es-US-Polyglot-1', name: 'Male - Deep (LatAm/US)', gender: 'MALE' },
];

// Default voice assignments
const DEFAULT_VOICES: VoiceSettings = {
  [Speaker.JUEZ]: 'es-ES-Neural2-B',
  [Speaker.MINISTERIO_PUBLICO]: 'es-US-Neural2-B',
  [Speaker.DEFENSA]: 'es-US-Neural2-A',
  [Speaker.TESTIGO]: 'es-US-News-F',
};

interface SimulationSetupProps {
  onStart: (config: SimulationConfig) => void;
}

const subStageOptions: { [key: string]: string[] } = {
  'Etapa Inicial': ['Calificación de la Detención', 'Formulación de la Imputación', 'Solicitud de Vinculación a Proceso', 'Debate sobre Medidas Cautelares'],
  'Etapa Intermedia': ['Cierre de Investigación Complementaria', 'Acuerdos Probatorios', 'Exclusión de Medios de Prueba', 'Auto de Apertura a Juicio Oral'],
  'Etapa de Juicio Oral': ['Alegatos de Apertura', 'Desahogo de Pruebas', 'Alegatos de Clausura'],
};

// Listas de delitos por dificultad
const CRIMES_EASY = [
  "Homicidio simple", "Lesiones", "Aborto", "Abuso sexual", "Estupro", "Acoso sexual", "Robo simple",
  "Daño en propiedad ajena", "Allanamiento", "Despojo", "Violencia familiar", "Fraude simple",
  "Portación simple de arma sin licencia*", "Alteración de documentos simples", "Uso indebido de documentos de identidad*",
  "Falsificación de documentos migratorios*", "Reproducción ilícita de obras protegidas*", "Comunicación pública no autorizada*",
  "Uso indebido de programas de cómputo*", "Encubrimiento", "Encubrimiento por receptación", "Daño culposo",
  "Quebrantamiento de sellos*", "Evasión de presos*"
];

const CRIMES_MEDIUM = [
  "Fraude específico", "Robo con violencia", "Robo equiparado", "Extorsión", "Secuestro exprés",
  "Privación ilegal de la libertad", "Trata de personas*", "Posesión de narcóticos con fines de comercio*",
  "Transporte de narcóticos*", "Ejercicio indebido del servicio público*", "Enriquecimiento ilícito*",
  "Violación simple", "Pornografía", "Daño en propiedad con dolo específico",
  "Portación de arma de fuego de uso exclusivo del Ejército*", "Contrabando simple*", "Delitos ambientales básicos*",
  "Caza ilegal*", "Tráfico de personas migrantes*", "Captación ilegal de recursos*", "Administración fraudulenta en instituciones financieras*",
  "Uso de información privilegiada*", "Falsificación de marcas*", "Competencia desleal con sanción penal*", "Feminicidio",
  "Homicidio calificado", "Lesiones calificadas", "Abuso de confianza", "Administración fraudulenta",
  "Usurpación de funciones", "Usurpación de identidad", "Allanamiento agravado", "Delitos contra el orden familiar",
  "Delitos cometidos por particulares contra servidores públicos", "Delitos contra la administración pública*",
  "Delitos contra la fe pública distintos a moneda*", "Delitos electorales distintos a compra de votos*"
];

const CRIMES_HARD = [
  "Manipulación de sistemas informáticos*", "Revelación de secretos tecnológicos*", "Alteración de datos electrónicos*",
  "Falsificación de moneda*", "Alteración de moneda*", "Distribución de moneda falsa*", "Terrorismo*", "Sabotaje*",
  "Portación de explosivos*", "Tráfico de especies protegidas*", "Tala ilegal agravada*", "Deterioro ambiental*",
  "Manejo ilícito de materiales peligrosos*", "Operar como miembro de grupo delictivo*", "Financiamiento de organizaciones criminales*",
  "Lavado de dinero*", "Operaciones con recursos de procedencia ilícita*", "Defraudación fiscal calificada*",
  "Expedición, venta o compra de facturas falsas*", "Uso de prestanombres*", "Delincuencia organizada*",
  "Manipulación del mercado de valores*", "Operaciones bursátiles simuladas*", "Tráfico de armas*",
  "Introducción ilegal de armas al país*", "Fabricación ilegal de armas o explosivos*", "Desaparición forzada*",
  "Desaparición cometida por particulares*", "Tortura*", "Tortura equiparada*"
];

const RIGOR_LEVELS = [
  {
    id: 'Académico',
    title: 'Nivel Académico',
    desc: 'El Juez es solemne pero guía. Si te equivocas, permite reformular para aprender.'
  },
  {
    id: 'Procesal',
    title: 'Nivel Procesal',
    desc: 'Realista. El Juez no da segundas oportunidades; aplica la ley fríamente ante errores.'
  },
  {
    id: 'Técnico',
    title: 'Nivel Técnico',
    desc: 'Alta exigencia. El Juez rechaza peticiones si la técnica de litigación no es perfecta.'
  }
];

const SimulationSetup: React.FC<SimulationSetupProps> = ({ onStart }) => {
  const [userRole, setUserRole] = useState<Speaker>(Speaker.DEFENSA);
  const [stage, setStage] = useState('Etapa Inicial');
  const [subStage, setSubStage] = useState('Calificación de la Detención');
  const [crime, setCrime] = useState('Narcomenudeo (Posesión Simple)');
  const [userName, setUserName] = useState('');
  const [crimeContext, setCrimeContext] = useState('');
  const [defendantProfile, setDefendantProfile] = useState('');
  const [prosecutorWitness, setProsecutorWitness] = useState('');
  const [defenseWitness, setDefenseWitness] = useState('');
  const [rigorLevel, setRigorLevel] = useState<string>('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [showDifficultyMenu, setShowDifficultyMenu] = useState(false);
  const [showRigorError, setShowRigorError] = useState(false);
  const [voiceSettings, setVoiceSettings] = useState<VoiceSettings>(DEFAULT_VOICES);
  const [showVoiceSettings, setShowVoiceSettings] = useState(false);

  const handleVoiceChange = (speaker: Speaker, voiceId: string) => {
    setVoiceSettings(prev => ({ ...prev, [speaker]: voiceId }));
  };

  const handleStageChange = (newStage: string) => {
    setStage(newStage);
    // Automatically reset sub-stage to the first valid option for the new stage
    if (subStageOptions[newStage] && subStageOptions[newStage].length > 0) {
      setSubStage(subStageOptions[newStage][0]);
    }
  };

  const handleSimulateConditions = async (difficulty: string, crimeList: string[]) => {
    setIsGenerating(true);
    setShowDifficultyMenu(false); // Close menu on selection
    try {
      const randomConfig = await generateRandomSimulationConfig(difficulty, crimeList);

      if (randomConfig.crime) setCrime(randomConfig.crime);
      if (randomConfig.crimeContext) setCrimeContext(randomConfig.crimeContext);
      if (randomConfig.defendantProfile) setDefendantProfile(randomConfig.defendantProfile);
      if (randomConfig.prosecutorWitness) setProsecutorWitness(randomConfig.prosecutorWitness);
      if (randomConfig.defenseWitness) setDefenseWitness(randomConfig.defenseWitness);

      // Handle Stage and SubStage
      if (randomConfig.stage && subStageOptions[randomConfig.stage]) {
        setStage(randomConfig.stage);
        if (randomConfig.subStage && subStageOptions[randomConfig.stage].includes(randomConfig.subStage)) {
          setSubStage(randomConfig.subStage);
        } else {
          setSubStage(subStageOptions[randomConfig.stage][0]);
        }
      }

    } catch (error) {
      console.error("Error generating random conditions:", error);
      alert("No se pudieron generar las condiciones aleatorias. Por favor intente de nuevo.");
    } finally {
      setIsGenerating(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (!rigorLevel) {
      setShowRigorError(true);
      // Optional: Scroll to error
      const rigorElement = document.getElementById('rigor-section');
      if (rigorElement) {
        rigorElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
      return;
    }

    onStart({
      userName,
      userRole,
      stage,
      subStage,
      crime,
      crimeContext,
      defendantProfile,
      prosecutorWitness,
      defenseWitness,
      rigorLevel,
      voiceSettings
    });
  };

  const handleRigorSelection = (levelId: string) => {
    setRigorLevel(levelId);
    setShowRigorError(false);
  };

  const formLabelClass = "block mb-2 text-sm font-medium text-slate-600";
  const formInputClass = "bg-white border border-slate-300 text-slate-800 text-base sm:text-sm rounded-lg focus:ring-[#00afc7] focus:border-[#00afc7] block w-full p-2.5 transition-colors disabled:bg-slate-100 disabled:text-slate-500";

  return (
    <div className="text-center p-8 bg-white/60 backdrop-blur-lg border border-slate-200/50 rounded-xl shadow-2xl max-w-4xl mx-auto animate-fade-in">
      <img src="https://i.ibb.co/2pVFHG5/logo1.png" alt="TribunAi Logo" className="mx-auto w-96 max-w-full h-auto mb-2" />
      <h1 className="text-3xl font-bold text-slate-800 mb-2">Simulador de Juicio Oral</h1>
      <h2 className="text-xl text-slate-700 mb-6">Querétaro, México</h2>
      <p className="mb-6 text-slate-600">
        Configure la simulación para iniciar la audiencia. Seleccione su rol, la etapa procesal y el delito a tratar. Al finalizar, recibirá una evaluación detallada de su desempeño.
      </p>

      {/* Rigor Level Selector (Mandatory) */}
      <div id="rigor-section" className={`mb-8 p-4 rounded-lg border transition-all duration-300 ${showRigorError ? 'bg-red-50 border-red-500 ring-2 ring-red-200' : 'bg-slate-50 border-slate-200'}`}>
        <h3 className={`text-sm font-bold mb-3 uppercase tracking-wide ${showRigorError ? 'text-red-600' : 'text-slate-700'}`}>
          1. Seleccione el Nivel de Rigurosidad (Obligatorio) {showRigorError && <span className="ml-2">⚠️</span>}
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {RIGOR_LEVELS.map((level) => (
            <button
              key={level.id}
              type="button"
              onClick={() => handleRigorSelection(level.id)}
              className={`p-4 rounded-lg border-2 transition-all duration-200 flex flex-col items-center gap-2 h-full ${rigorLevel === level.id
                ? 'border-[#00afc7] bg-[#00afc7]/10 ring-1 ring-[#00afc7]'
                : 'border-slate-200 bg-white hover:border-[#00afc7]/50 hover:bg-slate-50'
                }`}
            >
              <span className={`font-bold ${rigorLevel === level.id ? 'text-[#00afc7]' : 'text-slate-700'}`}>
                {level.title}
              </span>
              <span className="text-xs text-slate-500 leading-relaxed">
                {level.desc}
              </span>
              {rigorLevel === level.id && (
                <div className="mt-auto pt-2">
                  <span className="inline-block w-3 h-3 bg-[#00afc7] rounded-full"></span>
                </div>
              )}
            </button>
          ))}
        </div>
        {showRigorError && (
          <p className="text-red-600 text-xs mt-3 font-bold animate-pulse">
            Debe seleccionar un nivel de rigor para continuar.
          </p>
        )}
      </div>

      <div className="flex flex-col items-center mb-8 pb-8 border-b border-slate-200">
        <h3 className="text-sm font-bold text-slate-700 mb-3 uppercase tracking-wide">
          2. Condiciones del Caso (Opcional: Generar con IA)
        </h3>
        {!showDifficultyMenu && !isGenerating ? (
          <button
            type="button"
            onClick={() => setShowDifficultyMenu(true)}
            className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold py-2 px-6 rounded-lg transition-colors shadow-md"
          >
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 12c0-1.232-.046-2.453-.138-3.662a4.006 4.006 0 00-3.7-3.7 48.678 48.678 0 00-7.324 0 4.006 4.006 0 00-3.7 3.7c-.017.22-.032.441-.046.662M19.5 12l3-3m-3 3l-3-3m-12 3c0 1.232.046 2.453.138 3.662a4.006 4.006 0 003.7 3.7 48.656 48.656 0 007.324 0 4.006 4.006 0 003.7-3.7c.017-.22.032-.441.046-.662M4.5 12l3 3m-3-3l-3 3" />
            </svg>
            Simular condiciones iniciales
          </button>
        ) : isGenerating ? (
          <button disabled className="flex items-center gap-2 bg-indigo-600 text-white font-semibold py-2 px-6 rounded-lg shadow-md opacity-70 cursor-not-allowed">
            <svg className="animate-spin h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
            Generando caso...
          </button>
        ) : (
          <div className="animate-fade-in flex flex-col items-center gap-3 w-full">
            <p className="text-sm font-semibold text-slate-700 mb-1">Seleccione la complejidad del delito:</p>
            <div className="flex flex-wrap justify-center gap-3">
              <button
                type="button"
                onClick={() => handleSimulateConditions('Fácil', CRIMES_EASY)}
                className="bg-emerald-500 hover:bg-emerald-600 text-white font-semibold py-2 px-5 rounded-lg transition-colors shadow-sm"
              >
                Fácil
              </button>
              <button
                type="button"
                onClick={() => handleSimulateConditions('Medio', CRIMES_MEDIUM)}
                className="bg-amber-500 hover:bg-amber-600 text-white font-semibold py-2 px-5 rounded-lg transition-colors shadow-sm"
              >
                Medio
              </button>
              <button
                type="button"
                onClick={() => handleSimulateConditions('Difícil', CRIMES_HARD)}
                className="bg-rose-600 hover:bg-rose-700 text-white font-semibold py-2 px-5 rounded-lg transition-colors shadow-sm"
              >
                Difícil
              </button>
              <button
                type="button"
                onClick={() => setShowDifficultyMenu(false)}
                className="text-slate-400 hover:text-slate-600 font-medium py-2 px-3 transition-colors"
              >
                Cancelar
              </button>
            </div>
            <p className="text-xs text-slate-500 mt-2 max-w-lg">
              La dificultad del caso se determina según la complejidad del tipo penal, las pruebas requeridas y sus agravantes.
            </p>
          </div>
        )}
      </div>

      <form onSubmit={handleSubmit} className="space-y-6 text-left">
        <h3 className="text-sm font-bold text-slate-700 mb-2 uppercase tracking-wide text-center">
          3. Detalles Específicos
        </h3>
        <div>
          <label htmlFor="userName" className={formLabelClass}>Su Nombre Completo (para el reporte):</label>
          <input
            type="text"
            id="userName"
            value={userName}
            onChange={(e) => setUserName(e.target.value)}
            className={formInputClass}
            placeholder="Ej: Lic. Juan Pérez"
            required
            disabled={isGenerating}
          />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <label htmlFor="userRole" className={formLabelClass}>Seleccione su Rol:</label>
            <select
              id="userRole"
              value={userRole}
              onChange={(e) => setUserRole(e.target.value as Speaker)}
              className={formInputClass}
              disabled={isGenerating}
            >
              <option value={Speaker.DEFENSA}>Defensa</option>
              <option value={Speaker.MINISTERIO_PUBLICO}>Ministerio Público</option>
            </select>
          </div>
          <div>
            <label htmlFor="crime" className={formLabelClass}>Delito (editable):</label>
            <input
              type="text"
              id="crime"
              value={crime}
              onChange={(e) => setCrime(e.target.value)}
              className={formInputClass}
              disabled={isGenerating}
            />
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <label htmlFor="stage" className={formLabelClass}>Etapa Procesal:</label>
            <select
              id="stage"
              value={stage}
              onChange={(e) => handleStageChange(e.target.value)}
              className={formInputClass}
              disabled={isGenerating}
            >
              {Object.keys(subStageOptions).map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="subStage" className={formLabelClass}>Sub-etapa (Inicio de la Simulación):</label>
            <select
              id="subStage"
              value={subStage}
              onChange={(e) => setSubStage(e.target.value)}
              className={formInputClass}
              disabled={isGenerating}
            >
              {subStageOptions[stage]?.map(ss => <option key={ss} value={ss}>{ss}</option>)}
            </select>
          </div>
        </div>
        <div>
          <label htmlFor="crimeContext" className={formLabelClass}>Contexto Fáctico (Hechos: Tiempo, Lugar, Modo y Partes):</label>
          <textarea
            id="crimeContext"
            value={crimeContext}
            onChange={(e) => setCrimeContext(e.target.value)}
            className={`${formInputClass} h-32`}
            placeholder={`Describa los hechos detallando:\n- TIEMPO: Fecha y hora exacta del evento.\n- LUGAR: Ubicación precisa (Calle, Colonia, Referencias).\n- MODO: Descripción de la conducta y mecánica de los hechos.\n- PARTES: Víctima, Imputado y otros intervinientes.`}
            rows={5}
            disabled={isGenerating}
          ></textarea>
        </div>
        <div>
          <label htmlFor="defendantProfile" className={formLabelClass}>Perfil del Imputado (opcional):</label>
          <textarea
            id="defendantProfile"
            value={defendantProfile}
            onChange={(e) => setDefendantProfile(e.target.value)}
            className={`${formInputClass} h-24`}
            placeholder="Ej: Primodelincuente, 25 años, con trabajo estable y domicilio fijo en la ciudad..."
            rows={4}
            disabled={isGenerating}
          ></textarea>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <label htmlFor="prosecutorWitness" className={formLabelClass}>Testigo de Cargo (MP) - Opcional:</label>
            <textarea
              id="prosecutorWitness"
              value={prosecutorWitness}
              onChange={(e) => setProsecutorWitness(e.target.value)}
              className={`${formInputClass} h-32`}
              placeholder="Ej: Policía remitente que relata la detención, o víctima directa. 'Vi cuando sacó el arma...'"
              rows={4}
              disabled={isGenerating}
            ></textarea>
          </div>
          <div>
            <label htmlFor="defenseWitness" className={formLabelClass}>Testigo de Descargo (Defensa) - Opcional:</label>
            <textarea
              id="defenseWitness"
              value={defenseWitness}
              onChange={(e) => setDefenseWitness(e.target.value)}
              className={`${formInputClass} h-32`}
              placeholder="Ej: Vecino que asegura que el imputado estaba en otro lugar, o perito favorable."
              rows={4}
              disabled={isGenerating}
            ></textarea>
          </div>
        </div>

        {/* Voice Settings Section */}
        <div className="text-left pt-6 border-t border-slate-200">
          <button
            type="button"
            onClick={() => setShowVoiceSettings(!showVoiceSettings)}
            className="flex items-center gap-2 text-sm font-medium text-slate-600 hover:text-[#00afc7] transition-colors"
          >
            <span className={`transform transition-transform ${showVoiceSettings ? 'rotate-90' : ''}`}>▶</span>
            4. VOICE SETTINGS (OPTIONAL)
          </button>

          {showVoiceSettings && (
            <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4 p-4 bg-slate-50 rounded-lg">
              {/* Judge Voice */}
              <div>
                <label htmlFor="voiceJudge" className={formLabelClass}>Judge Voice:</label>
                <select
                  id="voiceJudge"
                  value={voiceSettings[Speaker.JUEZ]}
                  onChange={(e) => handleVoiceChange(Speaker.JUEZ, e.target.value)}
                  className={formInputClass}
                >
                  {VOICE_OPTIONS.map(v => (
                    <option key={v.id} value={v.id}>{v.name}</option>
                  ))}
                </select>
              </div>

              {/* Prosecutor Voice */}
              <div>
                <label htmlFor="voiceMP" className={formLabelClass}>Prosecutor Voice:</label>
                <select
                  id="voiceMP"
                  value={voiceSettings[Speaker.MINISTERIO_PUBLICO]}
                  onChange={(e) => handleVoiceChange(Speaker.MINISTERIO_PUBLICO, e.target.value)}
                  className={formInputClass}
                >
                  {VOICE_OPTIONS.map(v => (
                    <option key={v.id} value={v.id}>{v.name}</option>
                  ))}
                </select>
              </div>

              {/* Defense Voice */}
              <div>
                <label htmlFor="voiceDefense" className={formLabelClass}>Defense Voice:</label>
                <select
                  id="voiceDefense"
                  value={voiceSettings[Speaker.DEFENSA]}
                  onChange={(e) => handleVoiceChange(Speaker.DEFENSA, e.target.value)}
                  className={formInputClass}
                >
                  {VOICE_OPTIONS.map(v => (
                    <option key={v.id} value={v.id}>{v.name}</option>
                  ))}
                </select>
              </div>

              {/* Witness Voice */}
              <div>
                <label htmlFor="voiceWitness" className={formLabelClass}>Witness Voice:</label>
                <select
                  id="voiceWitness"
                  value={voiceSettings[Speaker.TESTIGO]}
                  onChange={(e) => handleVoiceChange(Speaker.TESTIGO, e.target.value)}
                  className={formInputClass}
                >
                  {VOICE_OPTIONS.map(v => (
                    <option key={v.id} value={v.id}>{v.name}</option>
                  ))}
                </select>
              </div>
            </div>
          )}
        </div>

        <div className="text-center pt-4">
          <button
            type="submit"
            className="bg-[#00afc7] hover:bg-[#009ab0] text-white font-bold py-3 px-8 rounded-lg transition-all duration-300 ease-in-out transform hover:scale-105 shadow-lg shadow-[#00afc7]/20 hover:shadow-[#00afc7]/40 disabled:opacity-50 disabled:cursor-not-allowed"
            disabled={isGenerating}
          >
            Comenzar Simulación
          </button>
        </div>
      </form>
      <div className="mt-8 text-center text-xs text-slate-500">
        <p>Esta es una simulación ficticia con fines educativos</p>
        <p>TribunAI 2025 todos los derechos reservados</p>
      </div>
    </div>
  );
};

export default SimulationSetup;
