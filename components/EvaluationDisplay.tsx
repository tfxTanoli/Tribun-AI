
import React, { useRef } from 'react';
import { Evaluation, SimulationConfig, ChatMessage, Speaker } from '../types';

// Add type declarations for libraries loaded via script tags
declare global {
  interface Window {
    html2canvas: (element: HTMLElement, options?: any) => Promise<HTMLCanvasElement>;
    jspdf: {
      jsPDF: new (options?: any) => any;
    };
  }
}

interface EvaluationDisplayProps {
  evaluation: Evaluation;
  userName: string;
  config: SimulationConfig | null;
  chatHistory: ChatMessage[];
}

const ScoreBar: React.FC<{ label: string; score: number }> = ({ label, score }) => {
  const width = score > 0 ? `${score}%` : '0%';

  return (
    <div>
      <div className="flex justify-between items-center mb-1">
        <span className="text-sm font-medium text-slate-600">{label}</span>
        <span className="text-sm font-bold text-[#00afc7]">{score} / 100</span>
      </div>
      <div className="w-full bg-slate-200 rounded-full h-2.5">
        <div className={`bg-[#00afc7] h-2.5 rounded-full transition-all duration-1000 ease-out`} style={{ width }}></div>
      </div>
    </div>
  );
};

const EvaluationDisplay: React.FC<EvaluationDisplayProps> = ({ evaluation, userName, config, chatHistory }) => {
  const evaluationRef = useRef<HTMLDivElement>(null);

  // Helper to remove asterisk markers
  const clean = (text: string) => text.replace(/\*/g, '');

  // Filter messages logic
  const isMetaMessage = (msg: ChatMessage) => {
      return msg.speaker === Speaker.PROFESOR || (msg.text.trim().startsWith('[') && msg.text.trim().endsWith(']'));
  };

  const trialMessages = chatHistory.filter(msg => !isMetaMessage(msg));
  const metaMessages = chatHistory.filter(msg => isMetaMessage(msg));

  const handleExportPDF = async () => {
    const contentElement = evaluationRef.current;
    if (!contentElement || !window.html2canvas || !window.jspdf) {
      console.error("PDF generation libraries not loaded.");
      alert("Error: No se pudieron cargar las librerías para generar el PDF.");
      return;
    }
  
    const exportButton = document.getElementById('export-pdf-button');
    if (exportButton) exportButton.textContent = "Generando...";
  
    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF({ orientation: 'p', unit: 'mm', format: 'a4' });
    const pdfWidth = pdf.internal.pageSize.getWidth();
    const pdfHeight = pdf.internal.pageSize.getHeight();
    const margin = 15;
    const contentWidth = pdfWidth - margin * 2;
    let yPos = margin;
  
    try {
      // --- Part 1: Render everything EXCEPT the transcript using html2canvas ---
      const evaluationClone = contentElement.cloneNode(true) as HTMLElement;
      
      // Remove title and transcript details for canvas rendering
      const originalTitle = evaluationClone.querySelector('h2');
      if (originalTitle) originalTitle.remove();
      
      const detailsElements = evaluationClone.querySelectorAll('details');
      detailsElements.forEach(el => el.remove());
      
      // FIX: Force fixed width (Desktop size) for PDF generation regardless of device screen
      // This ensures the grid layout is preserved (2 columns) and not stacked (mobile view), 
      // preventing the image from becoming too tall and getting cut off.
      const desktopWidth = 1000;
      evaluationClone.style.width = `${desktopWidth}px`;
      evaluationClone.style.position = 'fixed';
      evaluationClone.style.left = '-10000px'; // Hide off-screen
      evaluationClone.style.top = '0';
      
      document.body.appendChild(evaluationClone);
  
      const canvas = await window.html2canvas(evaluationClone, {
        scale: 2,
        useCORS: true,
        backgroundColor: '#f5f2e9',
        windowWidth: desktopWidth, // Trick media queries to render desktop layout
      });
  
      document.body.removeChild(evaluationClone);
      
      const imgData = canvas.toDataURL('image/png');
      const imgProps = pdf.getImageProperties(imgData);
      const imgHeight = (imgProps.height * contentWidth) / imgProps.width;
      
      // --- Part 2: Build the PDF Header & Chart ---
      pdf.setFillColor('#f5f2e9');
      pdf.rect(0, 0, pdfWidth, pdfHeight, 'F');
      
      // Add Header
      const logo = new Image();
      logo.src = "https://i.ibb.co/Pzj3VNw3/logo2.png";
      logo.crossOrigin = "anonymous";
      await new Promise(resolve => { logo.onload = resolve; logo.onerror = resolve; });
      
      const logoWidth = 80;
      const logoHeight = 30;
      pdf.addImage(logo, 'PNG', pdfWidth / 2 - (logoWidth / 2), yPos, logoWidth, logoHeight);
      yPos += logoHeight + 15;
      
      pdf.setFontSize(18);
      pdf.setFont('helvetica', 'bold');
      pdf.setTextColor('#1e293b');
      pdf.text('Evaluación de Desempeño', pdfWidth / 2, yPos, { align: 'center' });
      yPos += 8;
  
      pdf.setFontSize(12);
      pdf.setFont('helvetica', 'normal');
      pdf.setTextColor('#475569');
      pdf.text(`Participante: ${userName}`, pdfWidth / 2, yPos, { align: 'center' });
      yPos += 5;
      
      const date = new Date().toLocaleDateString('es-MX', { day: '2-digit', month: 'long', year: 'numeric' });
      pdf.setFontSize(10);
      pdf.setTextColor('#64748b');
      pdf.text(date, pdfWidth / 2, yPos, { align: 'center' });
      yPos += 8;

      // Add Stage Info in Header
      if (config) {
        pdf.setFontSize(10);
        pdf.setTextColor('#00afc7'); 
        pdf.setFont('helvetica', 'bold');
        pdf.text(`${config.stage}`, pdfWidth / 2, yPos, { align: 'center' });
        yPos += 5;
        pdf.setFont('helvetica', 'normal');
        pdf.text(`(${config.subStage})`, pdfWidth / 2, yPos, { align: 'center' });
        yPos += 10;
      } else {
         yPos += 10;
      }
  
      // Add the canvas image of the evaluation scores
      if (yPos + imgHeight > pdfHeight - margin) {
        pdf.addPage();
        pdf.setFillColor('#f5f2e9');
        pdf.rect(0, 0, pdfWidth, pdfHeight, 'F');
        yPos = margin;
      }
      pdf.addImage(imgData, 'PNG', margin, yPos, contentWidth, imgHeight);
      yPos += imgHeight + 10;
      
      const checkPageBreak = (neededHeight: number) => {
        if (yPos + neededHeight > pdfHeight - margin) {
          pdf.addPage();
          pdf.setFillColor('#f5f2e9');
          pdf.rect(0, 0, pdfWidth, pdfHeight, 'F');
          yPos = margin;
        }
      };

      // --- Part 3: Main Transcript (Trial Only) ---
      checkPageBreak(20);
  
      pdf.setFontSize(14);
      pdf.setFont('helvetica', 'bold');
      pdf.setTextColor('#1e293b');
      pdf.text('Transcripción de la Audiencia', margin, yPos);
      yPos += 10;

      for (const msg of trialMessages) {
          const speakerName = `[${msg.speaker}]:`;
          const text = clean(msg.text);

          checkPageBreak(8);
          pdf.setFont('helvetica', 'bold');
          pdf.setFontSize(11);
          pdf.setTextColor('#0f172a');
          pdf.text(speakerName, margin, yPos);
          yPos += 5;

          pdf.setFont('helvetica', 'normal');
          pdf.setFontSize(10);
          pdf.setTextColor('#334155');

          const lines = pdf.splitTextToSize(text, contentWidth);
          lines.forEach((line: string) => {
            checkPageBreak(5);
            pdf.text(line, margin, yPos);
            yPos += 5;
          });
          yPos += 3;
      }

      // --- Part 4: Meta-Procedural Questions (Professor) ---
      if (metaMessages.length > 0) {
          checkPageBreak(25);
          yPos += 5;
          pdf.setDrawColor(200, 200, 200);
          pdf.line(margin, yPos, pdfWidth - margin, yPos);
          yPos += 10;

          pdf.setFontSize(14);
          pdf.setFont('helvetica', 'bold');
          pdf.setTextColor('#b45309'); // Amber-700
          pdf.text('Consultas Meta-Procesales', margin, yPos);
          yPos += 10;

          for (const msg of metaMessages) {
              const speakerName = `[${msg.speaker}]:`;
              const text = clean(msg.text);

              checkPageBreak(8);
              pdf.setFont('helvetica', 'bold');
              pdf.setFontSize(11);
              pdf.setTextColor('#b45309'); // Amber for headers
              pdf.text(speakerName, margin, yPos);
              yPos += 5;

              pdf.setFont('helvetica', 'italic'); // Italic for meta content
              pdf.setFontSize(10);
              pdf.setTextColor('#78350f'); // Dark Amber

              const lines = pdf.splitTextToSize(text, contentWidth);
              lines.forEach((line: string) => {
                checkPageBreak(5);
                pdf.text(line, margin, yPos);
                yPos += 5;
              });
              yPos += 3;
          }
      }

      // --- Part 5: Add Simulation Conditions ---
      if (config) {
          checkPageBreak(40);
          yPos += 10;
          
          pdf.setDrawColor(200, 200, 200);
          pdf.line(margin, yPos, pdfWidth - margin, yPos);
          yPos += 10;

          pdf.setFont('helvetica', 'bold');
          pdf.setFontSize(12);
          pdf.setTextColor('#1e293b');
          pdf.text('Detalles de la Configuración Inicial', margin, yPos);
          yPos += 8;

          const configItems = [
              { label: 'Rol Asignado', value: config.userRole },
              { label: 'Etapa de Inicio', value: `${config.stage} - ${config.subStage}` },
              { label: 'Delito', value: config.crime },
              { label: 'Contexto del Hecho', value: config.crimeContext },
              { label: 'Perfil del Imputado', value: config.defendantProfile },
              { label: 'Testigo de Cargo (MP)', value: config.prosecutorWitness },
              { label: 'Testigo de Descargo (Defensa)', value: config.defenseWitness }
          ];

          configItems.forEach(item => {
              if (item.value && item.value.trim() !== '') {
                  checkPageBreak(15);
                  
                  pdf.setFont('helvetica', 'bold');
                  pdf.setFontSize(10);
                  pdf.setTextColor('#475569');
                  pdf.text(item.label, margin, yPos);
                  yPos += 5;

                  pdf.setFont('helvetica', 'normal');
                  pdf.setTextColor('#334155');
                  const lines = pdf.splitTextToSize(item.value, contentWidth);
                  lines.forEach((line: string) => {
                      checkPageBreak(5);
                      pdf.text(line, margin, yPos);
                      yPos += 5;
                  });
                  yPos += 3;
              }
          });
      }

      // --- Part 6: Footer ---
      checkPageBreak(15);
      yPos = Math.max(yPos, pdfHeight - 20);
      
      pdf.setFontSize(8);
      pdf.setTextColor('#94a3b8');
      pdf.text('Documento generado automáticamente por TribunAI', pdfWidth / 2, yPos, { align: 'center' });
      pdf.text('Esta es una simulación ficticia con fines educativos', pdfWidth / 2, yPos + 4, { align: 'center' });
      
      pdf.save(`evaluacion-${userName.replace(/\s+/g, '_')}.pdf`);
  
    } catch (error) {
      console.error("Error generating PDF:", error);
      alert("Ocurrió un error al generar el PDF.");
    } finally {
      if (exportButton) exportButton.textContent = "Exportar a PDF";
    }
  };

  const formattedTrialTranscript = trialMessages
    .map(m => `[${m.speaker}]: ${clean(m.text)}`)
    .join('\n\n');

  const formattedMetaTranscript = metaMessages
    .map(m => `[${m.speaker}]: ${clean(m.text)}`)
    .join('\n\n');

  return (
    <div className="bg-white border border-[#00afc7]/20 rounded-lg p-6 shadow-2xl animate-fade-in">
      <div ref={evaluationRef}>
        <h2 className="text-3xl font-bold text-slate-800 text-center mb-6">Evaluación de Desempeño</h2>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          <div className="space-y-6">
            <h3 className="text-xl text-slate-700 border-b-2 border-[#00afc7]/30 pb-2">Calificaciones Detalladas</h3>
            <ScoreBar label="Claridad Argumentativa" score={evaluation.feedback.argumentClarity} />
            <ScoreBar label="Fundamento Jurídico" score={evaluation.feedback.legalBasis} />
            <ScoreBar label="Coherencia Procesal" score={evaluation.feedback.proceduralCoherence} />
            <ScoreBar label="Pertinencia de Objeciones" score={evaluation.feedback.objectionPertinence} />
            <ScoreBar label="Oratoria y Lenguaje" score={evaluation.feedback.oratory} />
          </div>
          
          <div className="flex flex-col items-center justify-center bg-gradient-to-br from-slate-50 to-slate-100 p-6 rounded-lg border border-slate-200">
            <h3 className="text-lg text-slate-600">Calificación Final</h3>
            <div 
              className="text-7xl font-bold text-[#00afc7] my-2 glow-text"
            >
                {evaluation.finalScore}
            </div>
            <p className="text-slate-500">Sobre 100 Puntos</p>
          </div>
        </div>
        
        <div className="mt-8">
            <h3 className="text-xl text-slate-700 border-b-2 border-[#00afc7]/30 pb-2 mb-4">Comentarios de Mejora</h3>
            <p className="text-slate-700 bg-slate-100/50 p-4 rounded-lg whitespace-pre-wrap">{clean(evaluation.comments)}</p>
        </div>

        {/* Main Transcript Section */}
        <div className="mt-8">
          <details className="bg-slate-100/50 rounded-lg transition-all duration-300 border border-slate-200" open>
            <summary className="text-xl text-slate-700 p-4 cursor-pointer hover:bg-slate-200/50 rounded-t-lg list-none flex justify-between items-center font-bold">
              Transcripción de la Audiencia
              <svg className="w-5 h-5 transition-transform transform details-arrow" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
              </svg>
            </summary>
            <div className="p-4 border-t border-slate-200">
              <pre className="text-sm text-slate-700 whitespace-pre-wrap font-sans bg-slate-50 p-4 rounded-md max-h-96 overflow-y-auto">
                {formattedTrialTranscript}
              </pre>
            </div>
          </details>
        </div>

        {/* Meta-Procedural Section (Professor) */}
        {metaMessages.length > 0 && (
            <div className="mt-4">
            <details className="bg-amber-50/50 rounded-lg transition-all duration-300 border border-amber-200">
                <summary className="text-xl text-amber-800 p-4 cursor-pointer hover:bg-amber-100/50 rounded-t-lg list-none flex justify-between items-center font-bold">
                Consultas Meta-Procesales (Profesor)
                <svg className="w-5 h-5 transition-transform transform details-arrow text-amber-700" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
                </svg>
                </summary>
                <div className="p-4 border-t border-amber-200">
                <pre className="text-sm text-amber-900 whitespace-pre-wrap font-sans bg-amber-50/50 p-4 rounded-md max-h-64 overflow-y-auto italic">
                    {formattedMetaTranscript}
                </pre>
                </div>
            </details>
            </div>
        )}

      </div>
      <div className="mt-6 text-center">
        <button
          id="export-pdf-button"
          onClick={handleExportPDF}
          className="bg-[#00afc7] hover:bg-[#009ab0] text-white font-bold py-2 px-6 rounded-lg transition-all duration-300 ease-in-out transform hover:scale-105 shadow-lg shadow-[#00afc7]/20 hover:shadow-[#00afc7]/40"
        >
          Exportar a PDF
        </button>
      </div>
       <div className="mt-6 text-center text-xs text-slate-500">
        <p>Esta es una simulación ficticia con fines educativos</p>
        <p>TribunAI 2025 todos los derechos reservados</p>
      </div>
       <style>{`
          details summary::-webkit-details-marker {
            display: none;
          }
          details[open] .details-arrow {
            transform: rotate(180deg);
          }
        `}</style>
    </div>
  );
};

export default EvaluationDisplay;
