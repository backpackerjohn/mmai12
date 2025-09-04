import React, { useState, useEffect } from 'react';
import { Chunk, Reflection } from '../types';

interface ReflectionModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (chunkId: string, reflection: Reflection) => void;
  chunk: Chunk | null;
}

const ReflectionModal: React.FC<ReflectionModalProps> = ({ isOpen, onClose, onSave, chunk }) => {
  const [helped, setHelped] = useState('');
  const [trippedUp, setTrippedUp] = useState('');

  useEffect(() => {
    if (!isOpen) {
      // Reset fields when closing
      setTimeout(() => {
        setHelped('');
        setTrippedUp('');
      }, 300); // delay to allow for exit animation
    }
  }, [isOpen]);
  
  const handleSubmit = () => {
    if (!chunk) return;
    onSave(chunk.id, { helped, trippedUp });
  };

  if (!isOpen) return null;

  return (
    <div 
      className="fixed inset-0 bg-black bg-opacity-60 z-50 flex items-center justify-center p-4 transition-opacity duration-300"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="reflection-modal-title"
    >
      <div 
        className="bg-white rounded-2xl shadow-2xl p-8 w-full max-w-lg transform transition-all duration-300 scale-100"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="reflection-modal-title" className="text-2xl font-bold text-stone-800 mb-2">
          Chunk Complete! Time to Reflect.
        </h2>
        <p className="text-stone-600 mb-6">
            You just finished: <span className="font-semibold text-stone-700">"{chunk?.title}"</span>
        </p>
        
        <div className="space-y-4">
            <div>
                <label htmlFor="helped-input" className="block text-sm font-semibold text-stone-700 mb-1">
                    What went well with this chunk?
                </label>
                <textarea 
                    id="helped-input"
                    value={helped}
                    onChange={(e) => setHelped(e.target.value)}
                    className="w-full h-24 p-3 border border-stone-300 rounded-md focus:ring-2 focus:ring-[#C75E4A] transition-shadow resize-y" 
                    placeholder="e.g., I had all the info I needed, I was in a good flow state..."
                    autoFocus
                />
            </div>
            <div>
                <label htmlFor="tripped-up-input" className="block text-sm font-semibold text-stone-700 mb-1">
                    What was a challenge or slowed you down?
                </label>
                <textarea 
                    id="tripped-up-input"
                    value={trippedUp}
                    onChange={(e) => setTrippedUp(e.target.value)}
                    className="w-full h-24 p-3 border border-stone-300 rounded-md focus:ring-2 focus:ring-[#C75E4A] transition-shadow resize-y" 
                    placeholder="e.g., I was blocked waiting for feedback, the requirements were unclear..."
                />
            </div>
        </div>

        <div className="mt-6 flex justify-end items-center space-x-4">
          <button 
            onClick={onClose} 
            className="px-6 py-2 font-semibold text-stone-700 bg-stone-100 hover:bg-stone-200 rounded-lg transition-all"
          >
            Skip for now
          </button>
          <button 
            onClick={handleSubmit} 
            className="px-6 py-2 font-semibold text-white bg-[#C75E4A] rounded-lg hover:bg-opacity-90 transition-all shadow-md"
          >
            Save Reflection
          </button>
        </div>
      </div>
    </div>
  );
};

export default ReflectionModal;