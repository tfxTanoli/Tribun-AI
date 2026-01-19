
import React from 'react';
import { ChatMessage as ChatMessageType, Speaker } from '../types';
import { GavelIcon, ProsecutorIcon, UserIcon, WitnessIcon, ProfessorIcon } from './icons';

interface ChatMessageProps {
  message: ChatMessageType;
  userRole: Speaker;
}

const ChatMessage: React.FC<ChatMessageProps> = ({ message, userRole }) => {
  const isUserMessage = message.speaker === userRole;
  const isProfessor = message.speaker === Speaker.PROFESOR;

  const getIcon = (speaker: Speaker) => {
    switch (speaker) {
      case Speaker.JUEZ:
        return <GavelIcon className="w-8 h-8 text-slate-700" />;
      case Speaker.MINISTERIO_PUBLICO:
        return <ProsecutorIcon className="w-8 h-8 text-red-500" />;
      case Speaker.DEFENSA:
        return <UserIcon className="w-8 h-8 text-[#00afc7]" />;
      case Speaker.TESTIGO:
        return <WitnessIcon className="w-8 h-8 text-purple-600" />;
      case Speaker.PROFESOR:
        return <ProfessorIcon className="w-8 h-8 text-amber-600" />;
      default:
        return null;
    }
  };

  const getTextColor = (speaker: Speaker) => {
    switch (speaker) {
      case Speaker.JUEZ: return "text-slate-700";
      case Speaker.MINISTERIO_PUBLICO: return "text-red-500";
      case Speaker.DEFENSA: return "text-[#00afc7]";
      case Speaker.TESTIGO: return "text-purple-600";
      case Speaker.PROFESOR: return "text-amber-700";
      default: return "text-gray-500";
    }
  }

  const getBgColor = () => {
      if (isUserMessage) return 'bg-[#00afc7] text-white';
      if (isProfessor) return 'bg-amber-100 text-slate-800 border border-amber-200';
      return 'bg-slate-200 text-slate-800';
  }

  // Utility to remove asterisk markers from display
  const cleanDisplay = (text: string) => text.replace(/\*/g, '');

  return (
    <div className={`flex flex-col animate-fade-in ${isUserMessage ? 'items-end' : 'items-start'}`}>
      <div className={`flex items-start gap-3 ${isUserMessage ? 'flex-row-reverse' : 'flex-row'}`}>
        <div className={`flex-shrink-0 p-2 ${isProfessor ? 'bg-amber-50' : 'bg-slate-100'} rounded-full self-start`}>
            {getIcon(message.speaker)}
        </div>
        <div className="flex flex-col">
            <span className={`font-bold mb-1 ${getTextColor(message.speaker)} ${isUserMessage ? 'text-right' : ''}`}>{message.speaker}</span>
            <div
              className={`max-w-xl rounded-lg px-5 py-3 shadow-md ${getBgColor()}`}
            >
            <p className="whitespace-pre-wrap">{cleanDisplay(message.text)}</p>
            </div>
        </div>
      </div>
    </div>
  );
};

export default ChatMessage;
