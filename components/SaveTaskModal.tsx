import React, { useState, useEffect } from 'react';

interface SaveMapModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (note: string) => void;
}

const SaveMapModal: React.FC<SaveMapModalProps> = ({ isOpen, onClose, onSave }) => {
  const [note, setNote] = useState('');

  useEffect(() => {
    if (!isOpen) {
      setTimeout(() => setNote(''), 300); // Reset after closing animation
    }
  }, [isOpen]);

  const handleSubmit = () => {
    onSave(note || 'No note added.');
  };

  if (!isOpen) return null;

  return (
    <div 
      className="fixed inset-0 bg-black bg-opacity-60 z-[60] flex items-center justify-center p-4 transition-opacity duration-300"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="save-map-modal-title"
    >
      <div 
        className="bg-white rounded-2xl shadow-2xl p-8 w-full max-w-lg transform transition-all duration-300 scale-100"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="save-map-modal-title" className="text-2xl font-bold text-stone-800 mb-2">
          Save Momentum Map
        </h2>
        <p className="text-stone-600 mb-4">
          Add an optional note to remember your progress or context.
        </p>
        
        <div className="space-y-4">
          <div>
            <label htmlFor="note-input" className="block text-sm font-semibold text-stone-700 mb-1">
              Add a note to remember where you left off:
            </label>
            <textarea 
              id="note-input"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className="w-full h-24 p-3 border border-stone-300 rounded-md focus:ring-2 focus:ring-[#C75E4A] transition-shadow resize-y" 
              placeholder="e.g., Paused after chunk 2, continue with chunk 3 tomorrow..."
              autoFocus
            />
          </div>
        </div>

        <div className="mt-6 flex justify-end items-center space-x-4">
          <button 
            onClick={onClose} 
            className="px-6 py-2 font-semibold text-stone-700 bg-stone-100 hover:bg-stone-200 rounded-lg transition-all"
          >
            Cancel
          </button>
          <button 
            onClick={handleSubmit} 
            className="px-6 py-2 font-semibold text-white bg-[#C75E4A] rounded-lg hover:bg-opacity-90 transition-all shadow-md"
          >
            Save Map
          </button>
        </div>
      </div>
    </div>
  );
};

export default SaveMapModal;